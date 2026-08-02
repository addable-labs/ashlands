import * as THREE from 'three';
import { Rng } from './Rng';
import { MeshBuilder, bevelBox, buildShell, catenary, mergeParts, placed, sweep } from './Shapes';
import type { Emitter, Part } from './Buildings';

/**
 * Settlement dressing.
 *
 * Props carry the detail density at the near plane: urns, crates, drying
 * racks, nets, braziers and banners are what separate a street from a row of
 * buildings. Everything here is authored with y=0 at the ground so the same
 * ash-drift term in the shader piles against a crate exactly as it does
 * against a wall.
 */

const FIRE_HUE = new THREE.Color(1.0, 0.45, 0.14);
const LANTERN_HUE = new THREE.Color(1.0, 0.68, 0.32);

export interface PropDef {
  parts: Part[];
  emitters: Emitter[];
  /** Ground footprint radius, for spacing. */
  radius: number;
}

function lathe(
  profile: (v: number) => { r: number; y: number },
  nu: number,
  nv: number,
  thickness: number,
  lobes = 0,
): THREE.BufferGeometry | null {
  const res = buildShell({
    nu,
    nv,
    thickness,
    surface: (u, v, out) => {
      const th = u * Math.PI * 2;
      const p = profile(v);
      const r = p.r * (1 + lobes * Math.sin(th * 5));
      out.set(Math.cos(th) * r, p.y, Math.sin(th) * r);
    },
  });
  res.inner?.dispose();
  res.reveal?.dispose();
  return res.outer;
}

/** Clay urn — the Dunmer household object. Neck, shoulder, foot. */
export function clayUrn(rng: Rng): PropDef {
  const h = rng.range(0.42, 0.95);
  const belly = h * rng.range(0.36, 0.52);
  const neck = rng.range(0.30, 0.55);
  const g = lathe(
    (v) => {
      // sin gives the belly; the neck term pinches the top back in.
      const s = Math.sin(Math.pow(v, 0.82) * Math.PI * 0.92);
      const r = belly * (0.30 + 0.78 * s) * (1 - (1 - neck) * Math.pow(v, 3.2));
      return { r: Math.max(r, 0.02), y: v * h };
    },
    14,
    10,
    0.02,
    rng.chance(0.4) ? 0.03 : 0,
  );
  const parts: Part[] = [];
  if (g) parts.push({ key: 'plaster', geo: g });
  // Lip ring: catches light and stops the silhouette ending in a point.
  const lip = lathe((v) => ({ r: belly * neck * (1.08 + 0.16 * Math.sin(v * Math.PI)), y: h - 0.05 + v * 0.06 }), 14, 3, 0.015);
  if (lip) parts.push({ key: 'plaster', geo: lip });
  return { parts, emitters: [], radius: belly * 1.2 };
}

/** Crate: planked box with rope-lashed corners. */
export function crate(rng: Rng): PropDef {
  const w = rng.range(0.5, 0.95);
  const h = rng.range(0.4, 0.8);
  const d = rng.range(0.5, 0.9);
  const geos: THREE.BufferGeometry[] = [bevelBox(w, h, d, 0.035)];
  const planks = rng.int(2, 4);
  for (let i = 0; i < planks; i++) {
    const y = (i + 0.5) / planks;
    geos.push(placed(bevelBox(w * 1.03, h / planks * 0.62, d * 1.03, 0.012), new THREE.Vector3(0, (y - 0.5) * h, 0)));
  }
  const g = mergeParts(geos);
  const parts: Part[] = [];
  if (g) {
    g.translate(0, h * 0.5, 0);
    parts.push({ key: 'wood', geo: g });
  }
  return { parts, emitters: [], radius: Math.hypot(w, d) * 0.5 };
}

/** Drying rack: forked poles, a crossbar, and strips of hide hanging in wind. */
export function dryingRack(rng: Rng): PropDef {
  const w = rng.range(1.6, 3.0);
  const h = rng.range(1.4, 2.1);
  const wood: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const lean = rng.range(-0.12, 0.12);
    wood.push(
      sweep(
        [
          new THREE.Vector3(s * w * 0.5, -0.25, 0),
          new THREE.Vector3(s * w * 0.5 + lean, h * 0.6, 0),
          new THREE.Vector3(s * w * 0.5 + lean * 1.6, h, 0),
        ],
        [0.075, 0.055, 0.045],
        6,
      ),
    );
  }
  wood.push(sweep(catenary(new THREE.Vector3(-w * 0.52, h, 0), new THREE.Vector3(w * 0.52, h, 0), 0.06, 6), new Array(7).fill(0.035), 5));
  const g = mergeParts(wood);
  const parts: Part[] = [];
  if (g) parts.push({ key: 'wood', geo: g });

  const cloth = new MeshBuilder();
  const strips = rng.int(3, 6);
  for (let i = 0; i < strips; i++) {
    const x = -w * 0.42 + (i / Math.max(1, strips - 1)) * w * 0.84;
    const sw = rng.range(0.16, 0.32);
    const sh = rng.range(0.5, 1.15);
    const nx = 2;
    const ny = 3;
    // Pinned at the crossbar, free at the hem.
    cloth.swayOf = (p) => Math.min(1, Math.max(0, (h - 0.04 - p.y) / sh));
    for (let a = 0; a < nx; a++) {
      for (let b = 0; b < ny; b++) {
        const x0 = x + (a / nx - 0.5) * sw;
        const x1 = x + ((a + 1) / nx - 0.5) * sw;
        const y0 = h - 0.04 - (b / ny) * sh;
        const y1 = h - 0.04 - ((b + 1) / ny) * sh;
        cloth.quad(
          new THREE.Vector3(x0, y0, 0),
          new THREE.Vector3(x1, y0, 0),
          new THREE.Vector3(x1, y1, 0),
          new THREE.Vector3(x0, y1, 0),
        );
      }
    }
  }
  parts.push({ key: 'banner', geo: cloth.geometry() });
  return { parts, emitters: [], radius: w * 0.6 };
}

/** Fishing net slung between two stakes: catenary cords, coarse mesh. */
export function fishingNet(rng: Rng): PropDef {
  const w = rng.range(1.8, 3.4);
  const h = rng.range(1.1, 1.8);
  const geos: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    geos.push(
      sweep(
        [new THREE.Vector3(s * w * 0.5, -0.3, 0), new THREE.Vector3(s * w * 0.5 + rng.range(-0.1, 0.1), h, 0)],
        [0.07, 0.05],
        5,
      ),
    );
  }
  const g = mergeParts(geos);
  const parts: Part[] = [];
  if (g) parts.push({ key: 'wood', geo: g });

  // The net itself: a slack grid, each cord a real catenary, coarse enough to
  // stay a couple of hundred triangles.
  const cords: THREE.BufferGeometry[] = [];
  const rows = rng.int(3, 5);
  for (let i = 0; i <= rows; i++) {
    const y = h - (i / rows) * h * 0.8;
    cords.push(
      sweep(
        catenary(new THREE.Vector3(-w * 0.5, y, 0), new THREE.Vector3(w * 0.5, y, 0), 0.1 + i * 0.05, 7),
        new Array(8).fill(0.018),
        4,
      ),
    );
  }
  const cols = rng.int(4, 7);
  for (let i = 0; i <= cols; i++) {
    const x = -w * 0.5 + (i / cols) * w;
    const sag = 0.1 + Math.sin((i / cols) * Math.PI) * 0.22;
    cords.push(
      sweep(
        [new THREE.Vector3(x, h, 0), new THREE.Vector3(x + sag * 0.2, h - h * 0.42, 0.05), new THREE.Vector3(x, h - h * 0.8, 0)],
        [0.016, 0.016, 0.016],
        4,
      ),
    );
  }
  const net = mergeParts(cords);
  if (net) parts.push({ key: 'cloth', geo: net });
  return { parts, emitters: [], radius: w * 0.55 };
}

/** Brazier: bronze bowl on a tripod, glowing coals, a real point light. */
export function brazier(rng: Rng): PropDef {
  const h = rng.range(0.7, 1.15);
  const r = rng.range(0.26, 0.42);
  const parts: Part[] = [];
  const legs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const th = (i / 3) * Math.PI * 2 + rng.range(-0.1, 0.1);
    legs.push(
      sweep(
        [
          new THREE.Vector3(Math.cos(th) * r * 0.9, -0.1, Math.sin(th) * r * 0.9),
          new THREE.Vector3(Math.cos(th) * r * 0.45, h * 0.55, Math.sin(th) * r * 0.45),
          new THREE.Vector3(Math.cos(th) * r * 0.2, h, Math.sin(th) * r * 0.2),
        ],
        [0.055, 0.04, 0.05],
        5,
      ),
    );
  }
  const bowl = lathe((v) => ({ r: r * (0.42 + 0.58 * v), y: h + v * r * 0.6 }), 16, 5, 0.025);
  if (bowl) legs.push(bowl);
  const g = mergeParts(legs);
  if (g) parts.push({ key: 'bronze', geo: g });

  const coals = lathe((v) => ({ r: r * 0.86 * Math.sqrt(Math.max(0, 1 - v)), y: h + r * 0.42 + v * 0.1 }), 12, 3, 0.01);
  if (coals) parts.push({ key: 'glowFire', geo: coals });

  return {
    parts,
    emitters: [{ pos: new THREE.Vector3(0, h + r * 0.6, 0), kind: 'brazier', range: 14, hue: FIRE_HUE, power: 9 }],
    radius: r * 1.4,
  };
}

/** Hanging lantern on a hook — the dock light. */
export function lantern(rng: Rng): PropDef {
  const s = rng.range(0.16, 0.26);
  const parts: Part[] = [];
  const cage: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const th = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
    cage.push(
      sweep(
        [
          new THREE.Vector3(Math.cos(th) * s * 0.7, -s, Math.sin(th) * s * 0.7),
          new THREE.Vector3(Math.cos(th) * s, -s * 0.2, Math.sin(th) * s),
          new THREE.Vector3(Math.cos(th) * s * 0.5, s * 0.9, Math.sin(th) * s * 0.5),
        ],
        [0.016, 0.016, 0.014],
        4,
      ),
    );
  }
  const cap = lathe((v) => ({ r: s * (1.1 - v * 0.9), y: s * 0.85 + v * s * 0.5 }), 10, 3, 0.012);
  if (cap) cage.push(cap);
  const g = mergeParts(cage);
  if (g) parts.push({ key: 'bronze', geo: g });
  const flame = lathe((v) => ({ r: s * 0.62 * Math.sin(Math.max(v, 0.02) * Math.PI), y: -s * 0.6 + v * s * 1.4 }), 8, 4, 0.008);
  if (flame) parts.push({ key: 'glowFire', geo: flame });
  return {
    parts,
    emitters: [{ pos: new THREE.Vector3(0, 0, 0), kind: 'lantern', range: 11, hue: LANTERN_HUE, power: 5 }],
    radius: s,
  };
}

/** House banner: a pole, a crossbar and a cloth that the wind shader moves. */
export function banner(rng: Rng): PropDef {
  const poleH = rng.range(2.6, 4.2);
  const w = rng.range(0.6, 1.0);
  const drop = rng.range(1.3, 2.4);
  const parts: Part[] = [];
  const wood = mergeParts([
    sweep(
      [new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(rng.range(-0.05, 0.05), poleH * 0.5, 0), new THREE.Vector3(rng.range(-0.1, 0.1), poleH, 0)],
      [0.075, 0.055, 0.045],
      6,
    ),
    sweep([new THREE.Vector3(-w * 0.6, poleH - 0.1, 0), new THREE.Vector3(w * 0.6, poleH - 0.1, 0)], [0.03, 0.03], 5),
  ]);
  if (wood) parts.push({ key: 'wood', geo: wood });

  // The cloth is authored hanging from y=0 so the sway shader's "distance below
  // the crossbar" term is just -y; the mesh is then lifted into place.
  const mb = new MeshBuilder();
  const nx = 5;
  const ny = 7;
  // Free at the hem and at the outer edge, pinned to the crossbar and the pole.
  mb.swayOf = (p) => Math.min(1, (-p.y / drop) * 0.75 + Math.abs(p.x / (w * 0.5)) * 0.4);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const x0 = (i / nx - 0.5) * w;
      const x1 = ((i + 1) / nx - 0.5) * w;
      // Swallow-tail hem: a rectangle reads as a texture sample, not a banner.
      const hem = (t: number): number => -drop * (1 - 0.22 * Math.cos(t * Math.PI * 2) * 0.5 - 0.11);
      const y0 = (j / ny) * hem((i + 0.5) / nx);
      const y1 = ((j + 1) / ny) * hem((i + 0.5) / nx);
      mb.quad(
        new THREE.Vector3(x0, y0, 0),
        new THREE.Vector3(x1, y0, 0),
        new THREE.Vector3(x1, y1, 0),
        new THREE.Vector3(x0, y1, 0),
      );
    }
  }
  const cloth = mb.geometry();
  cloth.translate(0, poleH - 0.16, 0.02);
  parts.push({ key: 'banner', geo: cloth });
  return { parts, emitters: [], radius: w * 0.6 };
}

// ---------------------------------------------------------------- docks

export interface DockSpec {
  /** Shore end and sea end, world XZ. */
  from: THREE.Vector2;
  to: THREE.Vector2;
  seed: number;
  width: number;
  groundAt: (x: number, z: number) => number;
}

/**
 * Timber pier walking out over the water.
 *
 * Every piling is driven to the actual seabed under it, so the pier reads as
 * built rather than floated; the deck rides at a constant height above sea
 * level and the ramp at the shore end takes up the difference.
 */
export function buildDock(spec: DockSpec): { parts: Part[]; emitters: Emitter[]; origin: THREE.Vector3 } {
  const rng = new Rng(spec.seed ^ 0x2545f491);
  const dir = new THREE.Vector2().subVectors(spec.to, spec.from);
  const len = dir.length();
  dir.normalize();
  const side = new THREE.Vector2(-dir.y, dir.x);
  const deckY = 1.55;
  const origin = new THREE.Vector3(spec.from.x, 0, spec.from.y);

  const timber: THREE.BufferGeometry[] = [];
  const rope: THREE.BufferGeometry[] = [];
  const emitters: Emitter[] = [];
  const parts: Part[] = [];

  const bays = Math.max(3, Math.round(len / 3.2));
  const postTops: THREE.Vector3[] = [];

  for (let i = 0; i <= bays; i++) {
    const t = (i / bays) * len;
    for (const s of [-1, 1]) {
      const px = dir.x * t + side.x * s * spec.width * 0.5;
      const pz = dir.y * t + side.y * s * spec.width * 0.5;
      const bed = spec.groundAt(origin.x + px, origin.z + pz);
      const top = deckY + rng.range(0.0, 0.55);
      const lean = rng.range(-0.06, 0.06);
      timber.push(
        sweep(
          [
            new THREE.Vector3(px, bed - 0.9, pz),
            new THREE.Vector3(px + lean * 0.5, (bed + top) * 0.5, pz + lean * 0.5),
            new THREE.Vector3(px + lean, top, pz + lean),
          ],
          [0.19, 0.16, 0.14],
          6,
        ),
      );
      postTops.push(new THREE.Vector3(px + lean, top, pz + lean));
    }
    // Cross brace under the deck, so the pier is not a table of unconnected legs.
    if (i > 0 && rng.chance(0.75)) {
      const a = new THREE.Vector3(dir.x * t - side.x * spec.width * 0.5, deckY - 0.35, dir.y * t - side.y * spec.width * 0.5);
      const b = new THREE.Vector3(
        dir.x * (t - len / bays) + side.x * spec.width * 0.5,
        deckY - 0.65,
        dir.y * (t - len / bays) + side.y * spec.width * 0.5,
      );
      timber.push(sweep([a, b], [0.075, 0.075], 4));
    }
  }

  // Deck planks, individually jittered — a continuous slab reads as plastic.
  const planks = Math.round(len / 0.42);
  for (let i = 0; i < planks; i++) {
    const t = (i + 0.5) * (len / planks);
    const g = bevelBox(spec.width + rng.range(-0.06, 0.12), 0.10, len / planks * rng.range(0.82, 0.95), 0.018);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dir.x, dir.y));
    const p = new THREE.Vector3(dir.x * t, deckY + rng.range(-0.025, 0.025), dir.y * t);
    timber.push(placed(g, p, q));
  }

  // Railing posts and rope, with a lantern every few bays.
  for (let i = 1; i <= bays; i++) {
    const t = (i / bays) * len;
    for (const s of [-1, 1]) {
      const px = dir.x * t + side.x * s * spec.width * 0.5;
      const pz = dir.y * t + side.y * s * spec.width * 0.5;
      const hh = rng.range(0.85, 1.15);
      timber.push(sweep([new THREE.Vector3(px, deckY, pz), new THREE.Vector3(px, deckY + hh, pz)], [0.06, 0.05], 5));
      if (i > 1) {
        const pt = ((i - 1) / bays) * len;
        const a = new THREE.Vector3(dir.x * pt + side.x * s * spec.width * 0.5, deckY + hh * 0.95, dir.y * pt + side.y * s * spec.width * 0.5);
        const b = new THREE.Vector3(px, deckY + hh * 0.95, pz);
        rope.push(sweep(catenary(a, b, 0.14, 6), new Array(7).fill(0.022), 4));
      }
      if (i % 3 === 0 && s > 0) {
        const lp = new THREE.Vector3(px, deckY + hh + 0.1, pz);
        const l = lantern(rng.fork(i));
        for (const part of l.parts) parts.push({ key: part.key, geo: part.geo.translate(lp.x, lp.y - 0.3, lp.z) });
        for (const e of l.emitters) emitters.push({ ...e, pos: e.pos.clone().add(lp).setY(deckY + hh - 0.2) });
      }
    }
  }

  const tg = mergeParts(timber);
  if (tg) parts.push({ key: 'wood', geo: tg });
  const rg = mergeParts(rope);
  if (rg) parts.push({ key: 'cloth', geo: rg });

  return { parts, emitters, origin };
}
