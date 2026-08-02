import { hash1 } from './Noise';

export interface ErosionResult {
  /** Accumulated water throughput per cell, unnormalised. Drives the mud/gully splat. */
  flow: Float32Array;
  /** Net deposition (positive) / excavation (negative), unnormalised. */
  sediment: Float32Array;
}

/** 8-neighbour stencil. Diagonals carry sqrt(2) of the cell spacing. */
const TH_DX = Int32Array.from([1, -1, 0, 0, 1, 1, -1, -1]);
const TH_DY = Int32Array.from([0, 0, 1, -1, 1, -1, 1, -1]);
const TH_LEN = Float32Array.from([1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2]);

/**
 * Thermal erosion — the angle-of-repose constraint.
 *
 * Hydraulic erosion alone cannot fix a slope that is simply too steep to exist:
 * droplets accelerate down a wall and leave it a wall. Every gradient in a
 * shaped heightfield is whatever the noise happened to produce, and a ridged
 * multifractal scaled to 1700 m of relief routinely produces 70-80 degree faces
 * over a few metres. Those read as extruded card, not rock, and they are what
 * puts a near-vertical wall a few metres in front of a ground-level camera.
 *
 * The rule is local and physical: material above the repose angle slides until
 * it is not. Iterating it produces exactly the two things the silhouette needs —
 * planar talus slopes at a constant angle, and the sharp convex break at the top
 * of them where bedrock stops and scree begins.
 *
 * The angle is altitude-blended rather than constant. Loose ash sits at ~35
 * degrees; welded basalt on the cone stands at ~50 and cannot be flattened to
 * ash repose without turning a volcano into a dune. `soft` applies at and below
 * `loAlt`, `hard` at and above `hiAlt`.
 *
 * Eight neighbours, not four. A von Neumann stencil can only move material along
 * x and y, so the talus it builds is faceted onto those two axes and the result
 * is a diamond-shaped scree fan — a grid artefact of exactly the kind the rest
 * of this file is at pains to avoid. The diagonal terms carry their true sqrt(2)
 * spacing so the repose angle is the same in every direction.
 *
 * Returns the accumulated *deposition* per cell: where scree has piled up. That
 * is the mask the splat wants for loose material, and nothing else knows it.
 */
export async function thermal(
  h: Float32Array,
  res: number,
  iterations: number,
  cell: number,
  soft: number,
  hard: number,
  loAlt: number,
  hiAlt: number,
  onProgress?: (t: number) => void,
): Promise<Float32Array> {
  const talus = new Float32Array(res * res);
  const delta = new Float32Array(res * res);
  const ex = new Float32Array(8);
  // Per-cell repose threshold in metres of drop, precomputed once: it depends on
  // altitude, and altitude barely moves under this operator.
  const thr = new Float32Array(res * res);
  const invA = 1 / Math.max(1e-3, hiAlt - loAlt);
  for (let i = 0; i < h.length; i++) {
    let t = (h[i] - loAlt) * invA;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    t = t * t * (3 - 2 * t);
    thr[i] = (soft + (hard - soft) * t) * cell;
  }

  for (let it = 0; it < iterations; it++) {
    delta.fill(0);
    for (let j = 1; j < res - 1; j++) {
      const row = j * res;
      for (let i = 1; i < res - 1; i++) {
        const k = row + i;
        const hc = h[k];
        let sum = 0;
        let worst = 0;
        for (let n = 0; n < 8; n++) {
          const d = hc - h[k + TH_DY[n] * res + TH_DX[n]] - thr[k] * TH_LEN[n];
          const e = d > 0 ? d : 0;
          ex[n] = e;
          sum += e;
          if (e > worst) worst = e;
        }
        if (sum <= 0) continue;
        // Move half the worst overhang per iteration. More is unstable (the
        // cell overshoots below its neighbours and oscillates); less just costs
        // iterations.
        const move = worst * 0.5;
        const inv = move / sum;
        delta[k] -= move;
        for (let n = 0; n < 8; n++) {
          if (ex[n] <= 0) continue;
          const give = ex[n] * inv;
          delta[k + TH_DY[n] * res + TH_DX[n]] += give;
        }
      }
    }
    for (let i = 0; i < h.length; i++) {
      const d = delta[i];
      h[i] += d;
      if (d > 0) talus[i] += d;
    }
    if ((it & 7) === 7) {
      onProgress?.(it / iterations);
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }
  return talus;
}

interface Brush {
  dx: Int32Array;
  dy: Int32Array;
  w: Float32Array;
}

function buildBrush(radius: number): Brush {
  const dx: number[] = [];
  const dy: number[] = [];
  const w: number[] = [];
  let total = 0;
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d > radius) continue;
      const weight = 1 - d / radius;
      dx.push(x);
      dy.push(y);
      w.push(weight);
      total += weight;
    }
  }
  for (let i = 0; i < w.length; i++) w[i] /= total;
  return { dx: Int32Array.from(dx), dy: Int32Array.from(dy), w: Float32Array.from(w) };
}

/**
 * Droplet hydraulic erosion (Beyer's formulation). Each particle carries water,
 * speed and dissolved sediment; carrying capacity scales with how steeply it is
 * falling, so material is stripped from convex spurs and dumped in concavities
 * and on the outflow plain. Run over a few hundred thousand droplets this is
 * what produces dendritic drainage — the single strongest readability cue that
 * separates real terrain from noise.
 *
 * Yields control back to the caller periodically so the loading bar can paint.
 */
export async function erode(
  h: Float32Array,
  res: number,
  droplets: number,
  onProgress?: (t: number) => void,
): Promise<ErosionResult> {
  // Radius 4 (15.6 m at the SIM spacing), not 3.
  //
  // The brush is the width of the valley a droplet cuts. At radius 3 the
  // simulation carves at 11 m, which is only three cells: run enough droplets
  // through it and every cell in the world ends up on the side of some channel,
  // and the surface reads as crumpled foil rather than as drainage. Real
  // drainage is hierarchical — a few wide trunks, tributaries an order of
  // magnitude narrower — and the way to get that out of a droplet model is to
  // make the unit of excavation wide enough that channels have to compete for
  // territory instead of tiling it.
  const brush = buildBrush(4);
  const bn = brush.w.length;
  const flow = new Float32Array(res * res);
  const sediment = new Float32Array(res * res);

  const inertia = 0.055;
  const capacityFactor = 3.6;
  const minCapacity = 0.008;
  const erodeSpeed = 0.34;
  const depositSpeed = 0.28;
  const evaporate = 0.017;
  const gravity = 8.0;
  const maxLifetime = 72;
  const initialWater = 1.0;
  const initialSpeed = 1.0;

  // Coarse batching on purpose: setTimeout is clamped to 1 Hz in a background
  // tab, so a yield per few thousand droplets would stretch load to minutes.
  const batch = 32768;
  for (let d = 0; d < droplets; d++) {
    // Deterministic start positions.
    //
    // Uniform seeding spends the droplet budget in proportion to *area*, and on
    // this map the mountain is under a tenth of the area — so the one landform
    // that is in every single shot, and the only one whose drainage the camera
    // can actually resolve, was getting a tenth of the traffic. The ash flats
    // meanwhile received the bulk of it and have almost no relief for a droplet
    // to work with, so most of that budget did nothing.
    //
    // Drawing two candidates and keeping the higher one biases the density
    // towards the highlands as the square of the height rank: uplands get
    // roughly three times the traffic, flats keep enough to hold their channel
    // network, and the cost is two extra hashes and one array read per droplet.
    // Deterministic, so the CPU splat classifier still agrees with the bake.
    let px = 2 + hash1(d * 4 + 1) * (res - 5);
    let py = 2 + hash1(d * 4 + 2) * (res - 5);
    const qx = 2 + hash1(d * 4 + 3) * (res - 5);
    const qy = 2 + hash1(d * 4 + 4) * (res - 5);
    if (h[(qy | 0) * res + (qx | 0)] > h[(py | 0) * res + (px | 0)]) {
      px = qx;
      py = qy;
    }

    let dirX = 0;
    let dirY = 0;
    let speed = initialSpeed;
    let water = initialWater;
    let carried = 0;

    for (let life = 0; life < maxLifetime; life++) {
      const ix = px | 0;
      const iy = py | 0;
      if (ix < 1 || iy < 1 || ix >= res - 2 || iy >= res - 2) break;
      const fx = px - ix;
      const fy = py - iy;
      const i = iy * res + ix;

      const h00 = h[i];
      const h10 = h[i + 1];
      const h01 = h[i + res];
      const h11 = h[i + res + 1];

      const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
      const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
      const oldH = (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;

      // Sea floor: below the waterline there is no rainfall drainage to model.
      if (oldH < -6) break;

      dirX = dirX * inertia - gx * (1 - inertia);
      dirY = dirY * inertia - gy * (1 - inertia);
      const len = Math.sqrt(dirX * dirX + dirY * dirY);
      if (len < 1e-5) break;
      dirX /= len;
      dirY /= len;

      px += dirX;
      py += dirY;

      const nx = px | 0;
      const ny = py | 0;
      if (nx < 1 || ny < 1 || nx >= res - 2 || ny >= res - 2) break;
      const nfx = px - nx;
      const nfy = py - ny;
      const j = ny * res + nx;
      const n00 = h[j];
      const n10 = h[j + 1];
      const n01 = h[j + res];
      const n11 = h[j + res + 1];
      const newH = (n00 * (1 - nfx) + n10 * nfx) * (1 - nfy) + (n01 * (1 - nfx) + n11 * nfx) * nfy;
      const dh = newH - oldH;

      flow[i] += water;

      const capacity = Math.max(-dh * speed * water * capacityFactor, minCapacity);

      if (carried > capacity || dh > 0) {
        // Uphill: drop just enough to fill the pit, never more than we carry.
        const amount = dh > 0 ? Math.min(dh, carried) : (carried - capacity) * depositSpeed;
        carried -= amount;
        // Bilinear deposit keeps deposition smooth; erosion uses the wide brush.
        h[i] += amount * (1 - fx) * (1 - fy);
        h[i + 1] += amount * fx * (1 - fy);
        h[i + res] += amount * (1 - fx) * fy;
        h[i + res + 1] += amount * fx * fy;
        sediment[i] += amount;
      } else {
        const amount = Math.min((capacity - carried) * erodeSpeed, -dh);
        for (let b = 0; b < bn; b++) {
          const bx = ix + brush.dx[b];
          const by = iy + brush.dy[b];
          if (bx < 0 || by < 0 || bx >= res || by >= res) continue;
          const k = by * res + bx;
          const take = amount * brush.w[b];
          h[k] -= take;
          sediment[k] -= take;
        }
        carried += amount;
      }

      speed = Math.sqrt(Math.max(0, speed * speed - dh * gravity));
      water *= 1 - evaporate;
      if (water < 0.012) break;
    }

    if ((d & (batch - 1)) === batch - 1) {
      onProgress?.(d / droplets);
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  return { flow, sediment };
}
