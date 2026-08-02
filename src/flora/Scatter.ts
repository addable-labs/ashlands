import * as THREE from 'three';
import type { ITerrain } from '../core/contracts';
import type { EcoSample, TerrainField } from './Field';
import { Rng, clamp01, fbm2, smoothstep } from './Noise';

/**
 * Ecological blue-noise scatter.
 *
 * Candidates come from a jittered lattice at spacing/sqrt(2) — one candidate per
 * cell — and are rejected against a Poisson minimum distance held in a
 * single-occupancy grid. That is Bridson's guarantee without Bridson's active
 * list, and at these densities it is an order of magnitude faster while looking
 * identical: no clumps, no lattice, no visible rows.
 *
 * On top of the disc constraint sits a low-frequency patch mask, because real
 * vegetation is not evenly spaced across a habitat — it is dense in hollows and
 * absent on the shoulder ten metres away. An ecologically-correct but uniformly
 * dense field is the second-most obvious foliage defect after floating plants.
 */

/** Instance stride in the packed array. */
export const STRIDE = 10;
const OX = 0, OY = 1, OZ = 2, OYAW = 3, OSY = 4, OSXZ = 5, OTX = 6, OTZ = 7, OSEED = 8, OVAR = 9;

export { OX, OY, OZ, OYAW, OSY, OSXZ, OTX, OTZ, OSEED, OVAR };

export interface SpeciesRule {
  id: string;
  /** Poisson minimum distance, metres. */
  spacing: number;
  maxCount: number;
  variants: number;
  /** Patch mask frequency (cycles per metre) and how hard it bites. */
  patchFreq: number;
  patchBite: number;
  /** Vertical scale range applied to the built mesh. */
  scale: [number, number];
  /** How much the plant leans away from vertical toward the terrain normal, 0..1. */
  alignToNormal: number;
  /** Fraction of the base radius to sink below the surface. */
  sink: number;
  /**
   * Radius of the plant's ground footprint, metres at unit scale.
   *
   * The base is planted at the LOWEST terrain height inside this radius, not at
   * the height under the pivot. A bulb cluster is a metre and a half across; on
   * a slope, placing its origin on the surface leaves the uphill bulbs buried
   * and the downhill ones standing in mid-air, which is exactly what the review
   * found on the dawn crest.
   */
  footR: number;
  /**
   * Minimum suitability an accepted instance must clear.
   *
   * Without a floor the acceptance test `rng.next() > s` has an unbounded low
   * tail: a habitat scoring 0.01 still deals out one plant per hundred
   * candidates, which is how a single 12-pixel speck ends up alone on a sterile
   * ridge with nothing around it. Anything below the floor is not thin
   * vegetation, it is no vegetation.
   */
  floor: number;
  /** Suitability in [0,1] from ecology, terrain height and slope. */
  suit(e: EcoSample, y: number, slope: number, x: number, z: number): number;
}

export interface Scattered {
  rule: SpeciesRule;
  /** Packed SoA, STRIDE floats per instance. */
  data: Float32Array;
  count: number;
  /** Uniform bucket grid over the world, for frustum + distance culling. */
  cell: number;
  cols: number;
  /** World half-extent the bucket grid is anchored to. */
  extent: number;
  /** Prefix offsets into `order`, length cols*cols+1. */
  bucketStart: Int32Array;
  /** Instance indices sorted by bucket. */
  order: Int32Array;
  /** Per-bucket vertical bounds, for a correct bounding sphere per bucket. */
  bucketY: Float32Array;
}

const BUCKET = 128;

export function scatter(
  rule: SpeciesRule,
  field: TerrainField,
  terrain: ITerrain,
  seed: number,
): Scattered {
  const E = field.extent;
  const cellSize = rule.spacing / Math.SQRT2;
  const cols = Math.max(1, Math.floor((2 * E) / cellSize));
  const occupied = new Int32Array(cols * cols).fill(-1);
  const px = new Float32Array(rule.maxCount);
  const pz = new Float32Array(rule.maxCount);
  const data = new Float32Array(rule.maxCount * STRIDE);
  const rng = new Rng(seed);
  const eco: EcoSample = { grass: 0, fung: 0, ash: 0, rock: 0 };
  const nrm = new THREE.Vector3();
  // Radius in cells that the minimum-distance test must cover.
  const R = Math.ceil(rule.spacing / cellSize);
  let count = 0;

  /**
   * The VISIT ORDER is the defect, not the jitter.
   *
   * The candidates were already full-cell jittered, which is why the fix looked
   * unnecessary — and yet the review measured a "perfectly regular diagonal
   * cross-hatch", "caps marching in legible diagonal lines" and a periodic row
   * cadence in a row-difference analysis. Both are real, and both come from the
   * scan order rather than from the sample positions.
   *
   * Greedy dart-throwing over a lattice walked in row-major order is not
   * symmetric: a candidate is only ever rejected by neighbours that were visited
   * BEFORE it, i.e. by cells above and to the left. So acceptance is biased along
   * the scan direction, survivors line up on the diagonal that bisects the
   * rejection cone, and the result is a lattice with a constant pitch and a
   * preferred axis — exactly what was measured. Jittering harder cannot help,
   * because the anisotropy is in which points get to exist, not in where they sit
   * inside their cell.
   *
   * Shuffling the visitation order makes rejection isotropic in expectation: a
   * point is now as likely to be blocked by a neighbour below-right as
   * above-left, there is no preferred direction left for survivors to align on,
   * and the set is blue noise in the sense the Poisson radius already promised.
   *
   * It also fixes a second, quieter bug. maxCount is reached partway through the
   * scan for the dense species (bulb has 394k cells and a cap of 26k), so the
   * row-major walk simply STOPPED once it had filled up — leaving every species
   * that hits its cap present in the north of the map and absent in the south. A
   * shuffled order spends the same budget uniformly over the whole world.
   */
  const total = cols * cols;
  const order2 = new Int32Array(total);
  for (let k = 0; k < total; k++) order2[k] = k;
  for (let k = total - 1; k > 0; k--) {
    const m = (rng.next() * (k + 1)) | 0;
    const t = order2[k];
    order2[k] = order2[m];
    order2[m] = t;
  }

  for (let n = 0; n < total && count < rule.maxCount; n++) {
    {
      const cellIdx = order2[n];
      const j = (cellIdx / cols) | 0;
      const i = cellIdx - j * cols;
      const x = -E + (i + rng.next()) * cellSize;
      const z = -E + (j + rng.next()) * cellSize;

      field.ecoAt(x, z, eco);
      if (eco.grass + eco.fung + eco.ash + eco.rock < 0.02) continue;

      const y = field.heightAt(x, z);
      terrain.normalAt(x, z, nrm);
      /**
       * Reject the instance the renderer cannot draw, at the only place that
       * knows it is broken.
       *
       * The review found "near-black spiky scribbles... flattened spider-like
       * spokes rather than blades... broken instances (bad normals or a collapsed
       * transform)". A non-finite height or a zero-length terrain normal produces
       * exactly that: the instance matrix composes to NaN, every vertex collapses
       * to the same point, and the rasteriser draws the debris as a fan of
       * degenerate triangles with no usable normal — which then shades to black
       * whatever the lighting is. The heightfield repairs its own NaNs, so this
       * should never fire; an assert that never fires is the cheapest kind, and a
       * silent one that does is the difference between a defect and a mystery.
       */
      if (!Number.isFinite(y) || !Number.isFinite(nrm.x) || !Number.isFinite(nrm.y)) continue;
      if (nrm.lengthSq() < 1e-6) continue;
      const slope = 1 - clamp01(nrm.y);

      let s = rule.suit(eco, y, slope, x, z);
      if (s <= rule.floor) continue;

      // Patchiness, at two scales. The broad mask decides which hollows are
      // colonised at all; the tight one clumps the colony so the ground between
      // clumps stays bare. A single octave only ever thins — it never opens up,
      // and an evenly-thinned field reads as a crop.
      const patch = fbm2(x * rule.patchFreq, z * rule.patchFreq, 3);
      const clump = fbm2(x * rule.patchFreq * 5.7 + 31.7, z * rule.patchFreq * 5.7 - 12.3, 2);
      s *= 1 - rule.patchBite * (1 - patch * patch);
      s *= 0.35 + 0.65 * smoothstep(0.32, 0.74, clump);
      // Re-floor after masking: the masks are what generate the long tail of
      // near-zero suitabilities that produce isolated pop-in specks.
      if (s <= rule.floor) continue;
      if (rng.next() > s) continue;

      // Poisson rejection.
      let ok = true;
      const i0 = Math.max(0, i - R);
      const i1 = Math.min(cols - 1, i + R);
      const j0 = Math.max(0, j - R);
      const j1 = Math.min(cols - 1, j + R);
      for (let jj = j0; jj <= j1 && ok; jj++) {
        for (let ii = i0; ii <= i1; ii++) {
          const k = occupied[jj * cols + ii];
          if (k < 0) continue;
          const dx = px[k] - x;
          const dz = pz[k] - z;
          if (dx * dx + dz * dz < rule.spacing * rule.spacing) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;

      const o = count * STRIDE;
      const sy = rule.scale[0] + (rule.scale[1] - rule.scale[0]) * rng.next();
      // Anisotropic scale: a plant that is a fifth wider than it is tall reads
      // as a different individual even when it shares a variant mesh, and the
      // height/width independence is most of what breaks the clone read.
      const sxz = sy * rng.around(1.0, 0.22);
      // A collapsed transform is a black scribble on screen. Refuse to emit one.
      if (!(sy > 0.02) || !(sxz > 0.02)) continue;

      // Plant on the lowest ground the footprint covers, then sink. Sampling
      // only under the pivot is what puts one leg of a cluster in the air —
      // or, on the vale hero parasol, cuts the flare open against the slope and
      // leaves you looking into the unlit inside of the stipe.
      const fr = rule.footR * sxz;
      let yBase = y;
      // Two rings, twelve probes. One ring at the footprint radius misses the
      // case that actually bites: a plant standing on a convex break where the
      // ground falls away between the pivot and the rim rather than at it.
      for (let k = 0; k < 12; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.4;
        const rr = fr * (k < 6 ? 1 : 0.55);
        const hk = field.heightAt(x + Math.cos(a) * rr, z + Math.sin(a) * rr);
        if (hk < yBase) yBase = hk;
      }
      /**
       * The burial cap has to scale with the FOOTPRINT, not just the height.
       *
       * At `y - 0.34 * sy` a parasol — whose sy is a unitless 0.55 to 1.35 scale
       * — could be lowered by at most 46 cm however wide it was. Its flare is up
       * to four metres across, so on any real slope the terrain rose through the
       * skirt and cut it, which is the vale blocker exactly. Allowing the sink to
       * grow with the footprint radius means a wide-based plant is planted
       * against the lowest ground it actually covers.
       */
      yBase = Math.max(yBase, y - (0.34 * sy + 0.55 * fr));

      data[o + OX] = x;
      // A 4 cm bias on top of the species sink. Sub-pixel penetration is free
      // and hovering is not: contact is the difference between an object in the
      // world and a sticker on it.
      data[o + OY] = yBase - rule.sink * sy - 0.04;
      data[o + OZ] = z;
      data[o + OYAW] = rng.range(0, Math.PI * 2);
      data[o + OSY] = sy;
      data[o + OSXZ] = sxz;
      // Raw terrain normal; the renderer blends it toward vertical by the
      // species' alignment factor. Plants grow toward the light, so a full
      // alignment on a 20-degree slope looks wrong — but no alignment at all
      // leaves the base of a wide plant hanging out of the hillside.
      data[o + OTX] = nrm.x;
      data[o + OTZ] = nrm.z;
      data[o + OSEED] = rng.next();
      data[o + OVAR] = rng.int(rule.variants);
      px[count] = x;
      pz[count] = z;
      occupied[j * cols + i] = count;
      count++;
    }
  }

  // Bucket for culling.
  const bcols = Math.max(1, Math.ceil((2 * E) / BUCKET));
  const counts = new Int32Array(bcols * bcols);
  const bucketOf = (k: number): number => {
    const o = k * STRIDE;
    let bi = ((data[o + OX] + E) / BUCKET) | 0;
    let bj = ((data[o + OZ] + E) / BUCKET) | 0;
    if (bi < 0) bi = 0;
    else if (bi >= bcols) bi = bcols - 1;
    if (bj < 0) bj = 0;
    else if (bj >= bcols) bj = bcols - 1;
    return bj * bcols + bi;
  };
  for (let k = 0; k < count; k++) counts[bucketOf(k)]++;
  const start = new Int32Array(bcols * bcols + 1);
  for (let i = 0; i < bcols * bcols; i++) start[i + 1] = start[i] + counts[i];
  const cursor = start.slice(0, bcols * bcols);
  const order = new Int32Array(count);
  const bucketY = new Float32Array(bcols * bcols * 2);
  for (let i = 0; i < bcols * bcols; i++) {
    bucketY[i * 2] = Infinity;
    bucketY[i * 2 + 1] = -Infinity;
  }
  for (let k = 0; k < count; k++) {
    const b = bucketOf(k);
    order[cursor[b]++] = k;
    const y = data[k * STRIDE + OY];
    if (y < bucketY[b * 2]) bucketY[b * 2] = y;
    if (y > bucketY[b * 2 + 1]) bucketY[b * 2 + 1] = y;
  }

  return {
    rule,
    data,
    count,
    cell: BUCKET,
    cols: bcols,
    extent: E,
    bucketStart: start,
    order,
    bucketY,
  };
}

/* ------------------------------------------------------------ the species */

const alt = (y: number, a: number, b: number): number => 1 - smoothstep(a, b, y);

export const SPECIES: SpeciesRule[] = [
  {
    id: 'parasol',
    spacing: 32,
    maxCount: 5200,
    variants: 5,
    patchFreq: 0.0032,
    patchBite: 0.70,
    scale: [0.55, 1.35],
    alignToNormal: 0.28,
    // The flare at the foot of a parasol stipe is 2.6x the base radius, which on
    // the largest specimens is four metres across, and the old 0.9 m footprint
    // never sampled the ground under most of it. Combined with the burial cap
    // below that is what let the heightfield cut the flare open on the vale
    // slope and expose the hollow interior — the review's black hole at the
    // stalk root. Sinking is cheap; a hole is not.
    sink: 0.14,
    footR: 2.4,
    floor: 0.05,
    suit(e, y, slope) {
      // An emperor parasol is a fifteen-metre landmark, and it belongs in a
      // sheltered vale, not on an exposed strand. Weighting it toward the
      // waterline put one directly across the coast and night vantages — a
      // trunk two metres from the lens, blocking the entire composition — and
      // no headland in Vvardenfell is a mushroom forest. Hold them back from
      // the shore and let the vale floor keep them.
      if (y < 7) return 0;
      const sheltered = smoothstep(8, 22, y) * (1 - smoothstep(90, 190, y) * 0.55);
      const steep = 1 - smoothstep(0.13, 0.32, slope);
      return clamp01(e.fung * (0.45 + 0.55 * sheltered)) * steep * alt(y, 150, 380);
    },
  },
  {
    id: 'bulb',
    spacing: 9,
    maxCount: 26000,
    variants: 5,
    patchFreq: 0.0075,
    patchBite: 0.86,
    scale: [0.55, 1.6],
    alignToNormal: 0.5,
    /**
     * The floating rock on the night vantage was a BULB, and this is the line.
     *
     * buildBulbFungus lofts three to seven bulbs around the pivot, and the cap of
     * the outermost reaches about 2.2 in unit space. footR was 1.05, so the probe
     * ring below never sampled the ground under the outer half of the cluster —
     * and the placement rule plants at the LOWEST height it probed. On a convex
     * break (the crest of the night mound is exactly that) the terrain falls away
     * outside the probe radius, so the outer bulb ends up in the air with sky
     * visible under it. At LOD1 that bulb is an eight-sided lathe, which is why
     * it reads as "an angular chunk floating above a boulder" rather than as a
     * mushroom: it is one, seen with eight facets at ninety metres.
     *
     * The fix is deliberately split three ways rather than taken entirely here,
     * because footR is also what decides how DEEP a cluster is planted (the pivot
     * goes to the lowest ground the probe ring finds), and a radius large enough
     * to cover a 2.2 m cluster would bury the small bulbs of every cluster on any
     * real slope. So: the built cluster comes in to about 1.6 (Build.ts), the
     * probe radius goes out to 1.7, each bulb's buried skirt is deepened so the
     * terrain cuts solid geometry rather than showing daylight under a foot, and
     * the sink goes from 10% to 16% of the instance scale so a cluster beds into
     * the ground instead of resting tangent to it.
     */
    sink: 0.16,
    footR: 1.7,
    floor: 0.07,
    suit(e, y, slope) {
      if (y < 0.6) return 0;
      const steep = 1 - smoothstep(0.16, 0.40, slope);
      return clamp01(e.fung * 0.95 + e.grass * 0.25) * steep * alt(y, 150, 420) * 0.9;
    },
  },
  {
    id: 'trama',
    spacing: 10,
    maxCount: 26000,
    variants: 4,
    patchFreq: 0.0052,
    // Trama root is the silhouette-breaker of the ash wastes: on an open flat
    // it is the only thing between the eye and the horizon that gives scale.
    // At 0.80 the mask was eating four fifths of a habitat that is already
    // altitude-limited, and the dawn/ashstorm flats came out bare.
    patchBite: 0.72,
    scale: [0.6, 1.7],
    alignToNormal: 0.45,
    sink: 0.08,
    footR: 0.28,
    floor: 0.06,
    suit(e, y, slope) {
      if (y < 1.0) return 0;
      // Ash and cinder, and it will take a slope the mushrooms will not.
      const steep = 1 - smoothstep(0.30, 0.55, slope);
      /**
       * The high ash wastes are the trama root's HOME, and it was excluded from
       * them.
       *
       * The ridge vantage sits at roughly 800 m on the flank of Red Mountain and
       * the review's verdict on it was "there is not a single plant in the frame
       * ... the single biggest reason it reads as a heightfield tech demo". The
       * ceiling at 320-760 m is most of the reason: it put the one species with a
       * silhouette worth having on an ash flat out of range of every high
       * vantage on the map. Trama root is the plant that grows where nothing else
       * does; a cinder slope below the lava line is exactly that ground.
       *
       * The rock subtraction also goes. It was there to keep the species off bare
       * basalt, but `rock` up here marks cinder and clinker as much as bedrock,
       * and subtracting it sterilised the flanks along with the cliffs. Slope
       * already excludes anything a plant could not hold on to.
       */
      return clamp01(e.ash * 0.95 + e.rock * 0.22) * steep * alt(y, 780, 1300) * 0.8;
    },
  },
  {
    id: 'yam',
    spacing: 9,
    maxCount: 22000,
    variants: 4,
    patchFreq: 0.0105,
    patchBite: 0.85,
    scale: [0.7, 1.6],
    alignToNormal: 0.75,
    sink: 0.35,
    footR: 0.32,
    floor: 0.07,
    suit(e, y, slope) {
      if (y < 0.8) return 0;
      const steep = 1 - smoothstep(0.14, 0.34, slope);
      return clamp01(e.ash * 0.55 + e.grass * 0.55) * steep * alt(y, 200, 480);
    },
  },
  {
    id: 'marsh',
    spacing: 8,
    maxCount: 20000,
    variants: 4,
    patchFreq: 0.0125,
    patchBite: 0.86,
    scale: [0.65, 1.6],
    alignToNormal: 0.35,
    sink: 0.05,
    footR: 0.16,
    floor: 0.07,
    suit(e, y, slope) {
      // Marshmerrow is a wetland reed: a narrow band along the waterline and in
      // the mud of the vale floor, nowhere else. The littoral term is separate
      // from the habitat one — a strand is sand, so keying purely off the mud
      // and grass channels left every shoreline in the world bare.
      if (y < 0.15 || y > 46) return 0;
      const steep = 1 - smoothstep(0.10, 0.26, slope);
      const band = smoothstep(0.1, 2.5, y) * (1 - smoothstep(6, 44, y) * 0.75);
      const littoral = (1 - smoothstep(1.0, 9.0, y)) * 0.55;
      return clamp01((e.grass * 0.8 + e.fung * 0.5 + littoral) * band) * steep;
    },
  },
  {
    id: 'stone',
    spacing: 10,
    maxCount: 18000,
    variants: 4,
    patchFreq: 0.0088,
    patchBite: 0.85,
    scale: [0.7, 1.9],
    alignToNormal: 0.95,
    sink: 0.20,
    footR: 0.30,
    // The one species that colonises open rock, and therefore the one most able
    // to strand a lone instance on a bare slope with nothing around it. It needs
    // the highest floor in the table.
    floor: 0.14,
    suit(e, y, slope) {
      if (y < 1.0) return 0;
      // The one species that takes rock, and it wants some slope — a stoneflower
      // on a flat ash pan looks wrong.
      // Ceiling raised: at 480-980 m the one species that takes bare basalt died
      // out below every high vantage on the map, so a ridge shot had nothing
      // organic between the camera and the skyline to give it scale.
      const wants = smoothstep(0.08, 0.30, slope) * (1 - smoothstep(0.52, 0.78, slope));
      return clamp01(e.rock * 0.9 + e.ash * 0.18) * wants * alt(y, 620, 1250);
    },
  },
  {
    id: 'kelp',
    spacing: 10,
    maxCount: 16000,
    variants: 3,
    patchFreq: 0.0090,
    patchBite: 0.88,
    scale: [0.7, 1.6],
    alignToNormal: 0.6,
    sink: 0.05,
    footR: 0.20,
    floor: 0.06,
    suit(_e, y, slope) {
      // Off the deepest shelf where light fails, up through the intertidal and
      // just past the waterline: the last half metre is stranded wrack, and it
      // is what stops a shoreline reading as a clean geometric edge between two
      // untextured planes. The old lower bound of -1.2 m put the whole species
      // underwater, where no exterior shot can see it.
      if (y > 0.6 || y < -26) return 0;
      const steep = 1 - smoothstep(0.24, 0.5, slope);
      // Densest in the shallows, thinning both into the deep and onto dry land.
      const depth = smoothstep(-26, -13, y) * (1 - smoothstep(-0.4, 0.6, y) * 0.6);
      return steep * depth * 0.95;
    },
  },
];
