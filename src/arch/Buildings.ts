import * as THREE from 'three';
import { Rng, noise2 } from './Rng';
import {
  MeshBuilder,
  bevelBox,
  buildShell,
  mergeParts,
  placed,
  sweep,
  type HoleFrame,
  type Opening,
  type SpillSource,
} from './Shapes';

/**
 * The four Dunmer building styles.
 *
 * Variation between instances is STRUCTURAL, not scalar: footprint lobes, vent
 * count, storey count, number and placement of openings, buttress count,
 * degree of collapse and whether an annex exists are all drawn per seed. Two
 * domes from adjacent seeds have different silhouettes, not different sizes.
 */

export type MatKey =
  | 'plaster'
  | 'chitin'
  | 'basalt'
  | 'stone'
  | 'wood'
  | 'bone'
  | 'bronze'
  /**
   * Living rock: the crag a landmark stands on, and the sea stack it rises from.
   *
   * Split off `basalt` because the two are not the same surface and were being
   * asked to be. `basalt` is DRESSED stone — it carries the coursed-masonry
   * relief family, which is right for a Daedric wall and wrong for a twenty-
   * metre outcrop. On a landmark plinth that band stack rendered a brick grid
   * across the thing whose whole job is to read as the rock the tower grew out
   * of, and at half a kilometre the grid mips to one value and the plinth
   * collapses into the flat black wedge the review measured at the tower's foot.
   *
   * Same rock, no courses: the relief is the analytic shell stack instead, whose
   * vertical fibre on a near-vertical face IS columnar basalt, plus roughness
   * mottling for cavity. Surface detail, not a colour change — the tint is the
   * same palette entry `basalt` uses.
   */
  | 'crag'
  /** Telvanni tower flesh — grown, not built. Landmarks only. */
  | 'fungus'
  /** Telvanni pod hull: the same organism, older and harder. Landmarks only. */
  | 'shell'
  /**
   * Telvanni cap flesh — the thin, damp, translucent underside of the parasol.
   *
   * Separate from `fungus` because it is a different tissue and, more to the
   * point, because it is the only surface in the game that is routinely BACKLIT
   * at landmark scale. The transmission term scales with albedo, so on the
   * stalk's dark bark it lands near zero; the cap needs a pale flesh albedo of
   * its own or the free orange rim against a dusk sky is thrown away.
   */
  | 'cap'
  | 'thatch'
  | 'cloth'
  | 'banner'
  | 'ash'
  | 'interior'
  | 'glow'
  | 'glowFire'
  /**
   * Bioluminescent spore light. NOT gated on time of day.
   *
   * Window lamps are dimmed to an ember in daylight, which is right for a lamp
   * and is why a tower at 1 km at hour 10 had nothing to separate it from the
   * mountain behind it — same value, same hue, silhouette gone. Fungal
   * bioluminescence does not care what time it is, and cyan is the one chroma
   * in the palette that no terrain can match, so a handful of these read as a
   * landmark's signature at any hour and at any distance.
   */
  | 'bio';
// There is deliberately no 'bioVein' key any more. Spore veins used to be swept
// emissive tubes with their own dimmer material; three review passes running
// they came back as an artefact — "a degenerate sliver", "a z-fighting decal
// edge", "a stretched emissive texel smeared down the trunk" — because a
// two-pixel emissive thread at any radiance rasterises as a hard-cored line and
// no shaping term can prevent that. Veins are now baked into the stalk's own
// `aBio` wash instead, which is what light under a skin actually looks like.

export interface Part {
  key: MatKey;
  geo: THREE.BufferGeometry;
}

/**
 * `bio` is deliberately its own kind rather than a hue on a lantern: fungal
 * light is not gated on the clock, so it must not be dimmed with the lamps, and
 * it competes for the same fixed pool.
 */
export type EmitterKind = 'window' | 'brazier' | 'lantern' | 'bio';

export interface Emitter {
  /** Building-local position. */
  pos: THREE.Vector3;
  kind: EmitterKind;
  /** Nominal radius of influence, metres. */
  range: number;
  hue: THREE.Color;
  power: number;
}

export interface Structure {
  parts: Part[];
  /** Base ring in local XZ, y at the shell foot — drives the foundation skirt. */
  ring: THREE.Vector3[];
  emitters: Emitter[];
  radius: number;
  height: number;
  /** Very low-poly stand-in used past the LOD switch. */
  proxy: THREE.BufferGeometry;
  proxyKey: MatKey;
  /**
   * Multi-material mid LOD, used in preference to `proxy` when present.
   *
   * A silhouette-only shell is the right answer for a 4 m dome and the wrong
   * one for a landmark: past the switch the tower is still eighty pixels tall
   * and its lit windows are the whole reason it reads as architecture, so they
   * have to survive into the cheap level rather than popping out of it.
   */
  proxyParts?: Part[];
  /**
   * Spheres (xyz, radius) of this structure's own masses, for cavity baking.
   * Interpenetrating shells have no shared curvature, so their junctions need
   * an explicit occlusion term or they read as a stack of primitives.
   */
  occluders?: THREE.Vector4[];
  /**
   * Extra baked-light sources beyond the emitters — a tube light sampled along
   * its length, say. Emitters double as spill sources; these do not become
   * runtime point lights and so cannot starve the pool.
   */
  spill?: SpillSource[];
  /**
   * Bioluminescent sources, baked into `aBio` rather than `aSpill`.
   *
   * Same integral, different gate: the spill channel is dimmed with the lamps
   * and this one never is, which is what lets a cyan rim light the cap gills
   * above it at noon without turning every window in the village on at midday.
   */
  bio?: SpillSource[];
}

const WINDOW_HUE = new THREE.Color(1.0, 0.62, 0.26);

// ---------------------------------------------------------------- helpers

/**
 * Orient a slab against the wall at a sampled surface point.
 *
 * Anchoring on the head/threshold sample rather than on centre + up*h/2 is
 * what keeps a sill flush on a curved shell; the naive version floats a
 * centimetre or two proud at the top of every dome and reads as a shelf.
 */
function slabAt(
  pos: THREE.Vector3,
  nrm: THREE.Vector3,
  right: THREE.Vector3,
  size: THREE.Vector3,
  offset: THREE.Vector3,
  bevel = 0.035,
): THREE.BufferGeometry {
  const n = nrm.clone().normalize();
  const r = right.clone().addScaledVector(n, -right.dot(n)).normalize();
  const u = new THREE.Vector3().crossVectors(n, r).normalize();
  const g = bevelBox(size.x, size.y, size.z, bevel);
  const m = new THREE.Matrix4().makeBasis(r, u, n);
  m.setPosition(
    new THREE.Vector3().copy(pos).addScaledVector(r, offset.x).addScaledVector(u, offset.y).addScaledVector(n, offset.z),
  );
  g.applyMatrix4(m);
  return g;
}

/** Threshold or sill under an opening. */
function sill(f: HoleFrame, t: number, wide: number, thick: number): THREE.BufferGeometry {
  return slabAt(f.bottom, f.bottomNormal, f.right, new THREE.Vector3(f.width * wide, thick, t * 1.6), new THREE.Vector3(0, thick * 0.1, t * 0.32));
}

/** Brow above an opening — the ledge every rain streak below it hangs from. */
function brow(f: HoleFrame, t: number, wide: number, thick: number): THREE.BufferGeometry {
  return slabAt(f.top, f.topNormal, f.right, new THREE.Vector3(f.width * wide, thick, t * 2.0), new THREE.Vector3(0, thick * 0.35, t * 0.5));
}

/**
 * A full frame standing proud of an opening: sill, brow and two jambs.
 *
 * A hole cut in a shell along cell boundaries is an axis-aligned rectangle, and
 * on a curved hull that reads instantly as a decal — the review named it as the
 * single most obvious low-effort tell in the frame. Four slabs standing off the
 * wall break that outline, self-shadow into the reveal, and give the eye the
 * depth cue that says the opening goes somewhere.
 */
export function apertureFrame(f: HoleFrame, t: number, lip: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const w = f.width;
  const h = f.height;
  // Depth is sized off the LIP, never off the wall thickness. A landmark's hull
  // is two metres thick and a frame scaled to that is a four-metre bracket
  // bolted to the outside — the frame's job is to break a hard rectangle and
  // cast a shadow into the reveal, and a hand's breadth does both.
  const d = Math.min(Math.max(t * 0.55, lip), lip * 1.8);
  out.push(
    slabAt(f.bottom, f.bottomNormal, f.right,
      new THREE.Vector3(w + lip * 2.0, lip * 0.85, d * 1.5),
      new THREE.Vector3(0, lip * 0.05, d * 0.40), lip * 0.22),
  );
  out.push(
    slabAt(f.top, f.topNormal, f.right,
      new THREE.Vector3(w + lip * 2.6, lip * 1.00, d * 1.9),
      new THREE.Vector3(0, lip * 0.34, d * 0.52), lip * 0.24),
  );
  for (const s of [-1, 1]) {
    out.push(
      slabAt(f.center, f.normal, f.right,
        new THREE.Vector3(lip * 0.85, h + lip * 0.9, d * 1.35),
        new THREE.Vector3(s * (w * 0.5 + lip * 0.42), 0, d * 0.32), lip * 0.20),
    );
  }
  // A mullion across the opening, sunk into the reveal.
  //
  // The review's word for the apertures was "stickers" — "uniform pale-cream or
  // flat dark rectangles with hard aliased borders sitting flush in the trunk
  // surface". A frame around a lit rectangle does not fix that on its own,
  // because the lit rectangle is still a single unbroken shape and single
  // unbroken shapes read as decals. A bar ACROSS it does: it splits the light
  // into panes, it casts a hard shadow of known width into the glow behind it,
  // and — the part that matters most at range — it is a person-scale object
  // silhouetted against the brightest thing on the structure, which is the
  // cheapest scale cue an asset this size has.
  //
  // Sunk to the inner face rather than standing proud, so it occludes the panel
  // instead of adding another lump to the exterior.
  {
    const inner = -(Math.max(t * 0.55, lip * 0.6));
    const bar = Math.min(lip * 0.42, w * 0.12);
    out.push(
      slabAt(f.center, f.normal, f.right,
        new THREE.Vector3(w * 0.98, bar, bar * 1.5),
        new THREE.Vector3(0, -h * 0.12, inner), bar * 0.25),
    );
    // Vertical divider only where the opening is wide enough to want one; on a
    // narrow slit it would close the aperture up entirely.
    if (w > h * 0.72) {
      out.push(
        slabAt(f.center, f.normal, f.right,
          new THREE.Vector3(bar, h * 0.94, bar * 1.5),
          new THREE.Vector3(0, 0, inner), bar * 0.25),
      );
    }
  }
  return out;
}

/**
 * Flat panel filling a hole, pushed inside the reveal — the lit-window plane.
 *
 * It has to clear the wall's own curvature or its corners poke through the
 * plaster and read as a glowing card stuck to the outside, so the inset
 * carries an explicit sagitta term for the chord it spans.
 */
export function glowPanel(f: HoleFrame, thickness: number, radius: number, lit = 1): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  // Per-panel emissive scale. See MeshBuilder.lit: this is what turns a wall of
  // identical pale rectangles into a settlement where some rooms are occupied.
  mb.lit = lit;
  const hw = f.width * 0.26;
  const hh = f.height * 0.26;
  const sagitta = (f.width * f.width) / (8 * Math.max(radius, 0.5));
  // Sit it on the inner face: seen from outside it should read as a lit room
  // behind a deep reveal, never as a card stuck over the opening.
  const inset = thickness * 0.92 + sagitta;
  const c = new THREE.Vector3().copy(f.center).addScaledVector(f.normal, -inset);
  const a = new THREE.Vector3().copy(c).addScaledVector(f.right, -hw).addScaledVector(f.up, -hh);
  const b = new THREE.Vector3().copy(c).addScaledVector(f.right, hw).addScaledVector(f.up, -hh);
  const d = new THREE.Vector3().copy(c).addScaledVector(f.right, hw).addScaledVector(f.up, hh);
  const e = new THREE.Vector3().copy(c).addScaledVector(f.right, -hw).addScaledVector(f.up, hh);
  mb.quad(a, b, d, e);
  return mb.geometry();
}

/** Collect the v=0 ring of a surface so the foundation can chase the ground. */
export function baseRing(
  surface: (u: number, v: number, out: THREE.Vector3) => void,
  nu: number,
): THREE.Vector3[] {
  const ring: THREE.Vector3[] = [];
  for (let i = 0; i < nu; i++) {
    const p = new THREE.Vector3();
    surface(i / nu, 0, p);
    ring.push(p);
  }
  return ring;
}

/** Cheap silhouette-only stand-in: same profile, a quarter of the resolution. */
function makeProxy(
  surface: (u: number, v: number, out: THREE.Vector3) => void,
  nu: number,
  nv: number,
): THREE.BufferGeometry {
  const r = buildShell({
    nu: Math.max(6, nu >> 2),
    nv: Math.max(3, nv >> 2),
    surface,
    thickness: 0.01,
  });
  r.inner?.dispose();
  r.reveal?.dispose();
  return r.outer ?? new THREE.BufferGeometry();
}

export function pushShell(
  parts: Part[],
  res: { outer: THREE.BufferGeometry | null; inner: THREE.BufferGeometry | null; reveal: THREE.BufferGeometry | null },
  skin: MatKey,
  jamb: MatKey,
): void {
  if (res.outer) parts.push({ key: skin, geo: res.outer });
  if (res.inner) parts.push({ key: 'interior', geo: res.inner });
  if (res.reveal) parts.push({ key: jamb, geo: res.reveal });
}

// ---------------------------------------------------------------- velothi dome

export interface DomeSpec {
  seed: number;
  /** Facing of the front door, radians about +Y. */
  facing: number;
  /** Nominal footprint radius. */
  size: number;
}

/**
 * Velothi / ashlander dome: mud brick and plaster over a chitin hoop frame.
 *
 * The silhouette is the whole point — a lopsided onion with a flared foot and
 * a cluster of smoke vents off-axis. Regular revolution reads as a yurt; the
 * lobed radius and the annex are what make it Vvardenfell.
 */
export function velothiDome(spec: DomeSpec): Structure {
  const rng = new Rng(spec.seed);
  const R = spec.size * rng.range(0.86, 1.18);
  const H = R * rng.range(1.02, 1.46);
  const nu = 48;
  const nv = 22;

  // Lobes: two low harmonics with independent phase. A single harmonic reads
  // as a squashed sphere; two make it look hand-packed.
  const l1 = rng.range(0.05, 0.11);
  const l2 = rng.range(0.03, 0.075);
  const p1 = rng.range(0, Math.PI * 2);
  const p2 = rng.range(0, Math.PI * 2);
  const k1 = rng.int(2, 3);
  const k2 = rng.int(4, 6);
  const flare = rng.range(0.07, 0.14);
  // Superellipse exponents. Together they decide whether the dome is a beehive
  // (full shoulder, tight crown) or a squat bread loaf. A cosine profile — the
  // obvious choice — gives a cone, which is a yurt, not a Velothi dwelling.
  const pw = rng.range(2.1, 3.2);
  const qw = rng.range(0.34, 0.50);

  const surface = (u: number, v: number, out: THREE.Vector3): void => {
    const th = u * Math.PI * 2;
    const prof = Math.pow(Math.max(0, 1 - Math.pow(v, pw)), qw);
    const foot = flare * Math.exp(-v * 8.0);
    const lobe = 1 + l1 * Math.sin(k1 * th + p1) + l2 * Math.sin(k2 * th + p2);
    const r = R * (prof + foot) * lobe;
    const y = H * Math.pow(v, 0.9);
    out.set(Math.cos(th) * r, y, Math.sin(th) * r);
  };

  // ---- openings ----
  const doorU = Math.round(((spec.facing / (Math.PI * 2)) * nu + nu) % nu);
  const openings: Opening[] = [];
  // Widths are in cells; at nu=48 one cell is 7.5 degrees, so a door is a
  // 1.7-2.3 m chord and a window is barely a metre. Both were twice that
  // before, which made every dome read as a bus shelter.
  const doorW = 3;
  openings.push({ u0: doorU - (doorW >> 1), u1: doorU - (doorW >> 1) + doorW, v0: 0, v1: rng.int(8, 10), arch: true });

  const winCount = rng.int(3, 5);
  for (let w = 0; w < winCount; w++) {
    const uu = doorU + Math.round(nu * (0.20 + (w / winCount) * 0.66)) + rng.int(-2, 2);
    const v0 = rng.int(5, 10);
    openings.push({ u0: uu, u1: uu + rng.int(1, 2), v0, v1: v0 + rng.int(2, 4), arch: true });
  }
  // A blind niche or two: recessed panels catch a hard shadow and give the
  // plaster somewhere to streak from without opening the interior further.
  for (let k = 0, n = rng.int(2, 4); k < n; k++) {
    const uu = rng.int(0, nu - 1);
    const v0 = rng.int(2, 8);
    openings.push({ u0: uu, u1: uu + rng.int(2, 3), v0, v1: v0 + rng.int(2, 4), arch: true, recess: rng.range(0.10, 0.22) });
  }

  const thickness = rng.range(0.32, 0.46);
  const res = buildShell({ nu, nv, surface, thickness, openings, floor: true });

  const parts: Part[] = [];
  pushShell(parts, res, 'plaster', 'plaster');

  const emitters: Emitter[] = [];
  const trim: THREE.BufferGeometry[] = [];
  for (let i = 0; i < res.holes.length; i++) {
    const f = res.holes[i];
    if (!f.through) continue;
    const isDoor = i === 0;
    // Threshold / sill, and a brow above that actually sheds water — which is
    // what makes the rain streak below it legible instead of arbitrary.
    trim.push(sill(f, thickness, 1.08, isDoor ? 0.13 : 0.09));
    trim.push(brow(f, thickness * 0.75, 1.05, 0.09));
    parts.push({ key: 'glow', geo: glowPanel(f, thickness, R) });
    // Just OUTSIDE the reveal. A lamp parked behind the wall lights only the
    // interior; what reads at night is the warm wash it throws on the plaster
    // around the opening, and that needs the source in front of the jamb.
    emitters.push({
      pos: new THREE.Vector3().copy(f.center).addScaledVector(f.normal, 0.35),
      kind: 'window',
      range: 9,
      hue: WINDOW_HUE,
      power: isDoor ? 4.0 : 2.4,
    });
  }

  // ---- smoke vents ----
  const vents = rng.int(1, 3);
  const ventGeo: THREE.BufferGeometry[] = [];
  const tmp = new THREE.Vector3();
  for (let i = 0; i < vents; i++) {
    const u = rng.next();
    const v = rng.range(0.62, 0.93);
    surface(u, v, tmp);
    const base = tmp.clone();
    const dir = new THREE.Vector3(base.x * 0.35, 1, base.z * 0.35).normalize();
    const len = rng.range(0.55, 1.15);
    const path = [
      base.clone().addScaledVector(dir, -0.15),
      base.clone().addScaledVector(dir, len * 0.5),
      base.clone().addScaledVector(dir, len),
      base.clone().addScaledVector(dir, len + 0.12),
    ];
    const rr = rng.range(0.17, 0.28);
    ventGeo.push(sweep(path, [rr * 1.5, rr * 1.05, rr, rr * 1.22], 9));
  }

  // ---- exposed chitin hoop frame ----
  // Offset radially in XZ only. Scaling the whole position lifts the band off
  // the shell near the crown and it reads as twigs stuck into the roof.
  const hoops = rng.int(2, 4);
  for (let i = 0; i < hoops; i++) {
    const v = 0.10 + (i / hoops) * 0.60 + rng.range(-0.03, 0.03);
    const path: THREE.Vector3[] = [];
    const radii: number[] = [];
    const arc = rng.range(0.45, 0.95);
    const u0 = rng.next();
    const steps = 20;
    for (let s = 0; s <= steps; s++) {
      surface(u0 + (s / steps) * arc, v, tmp);
      const rr = Math.hypot(tmp.x, tmp.z);
      const k = rr > 1e-4 ? (rr + 0.035) / rr : 1;
      path.push(new THREE.Vector3(tmp.x * k, tmp.y, tmp.z * k));
      radii.push(0.062 * (0.55 + 0.45 * Math.sin((s / steps) * Math.PI)));
    }
    ventGeo.push(sweep(path, radii, 6));
  }
  // ---- vertical chitin ribs ----
  // The hoops alone leave the shell a blank ovoid. Ribs running foot to crown
  // are what make it read as a frame with mud packed over it, and they carry
  // the silhouette at the distance where the openings have stopped resolving.
  const ribs = rng.int(4, 7);
  const ribPhase = rng.next();
  for (let i = 0; i < ribs; i++) {
    const u = ribPhase + i / ribs + rng.range(-0.02, 0.02);
    const path: THREE.Vector3[] = [];
    const radii: number[] = [];
    const vTop = rng.range(0.78, 0.97);
    const steps = 12;
    for (let s = 0; s <= steps; s++) {
      const v = (s / steps) * vTop;
      surface(u, v, tmp);
      const rr = Math.hypot(tmp.x, tmp.z);
      const k = rr > 1e-4 ? (rr + 0.03) / rr : 1;
      path.push(new THREE.Vector3(tmp.x * k, tmp.y, tmp.z * k));
      radii.push(0.075 * (1 - 0.55 * (s / steps)));
    }
    path[0].y = -0.35; // planted, not floating on the plinth
    ventGeo.push(sweep(path, radii, 6));
  }

  const chit = mergeParts(ventGeo);
  if (chit) parts.push({ key: 'chitin', geo: chit });

  const trimGeo = mergeParts(trim);
  if (trimGeo) parts.push({ key: 'stone', geo: trimGeo });

  const ring = baseRing(surface, nu);

  // ---- optional annex: the single strongest structural variation ----
  if (rng.chance(0.45)) {
    // Behind or beside the front door, never through it: an annex that
    // intersects the entrance turns the whole facade into a pile of planes.
    const aTh = spec.facing + Math.PI * rng.range(0.45, 1.55);
    const aR = R * rng.range(0.42, 0.62);
    const aH = H * rng.range(0.42, 0.62);
    const d = R * 0.92 + aR * 0.45;
    const cx = Math.cos(aTh) * d;
    const cz = Math.sin(aTh) * d;
    const aSurf = (u: number, v: number, out: THREE.Vector3): void => {
      const th = u * Math.PI * 2;
      const prof = Math.pow(Math.max(0, 1 - Math.pow(v, 2.4)), 0.44);
      const r = aR * (prof + 0.11 * Math.exp(-v * 8.0)) * (1 + 0.07 * Math.sin(3 * th + p1));
      out.set(cx + Math.cos(th) * r, aH * Math.pow(v, 0.9), cz + Math.sin(th) * r);
    };
    const aOpen: Opening[] = [];
    const au = Math.round(((aTh / (Math.PI * 2)) * 32 + 32) % 32);
    aOpen.push({ u0: au - 1, u1: au + 2, v0: 0, v1: 9, arch: true });
    aOpen.push({ u0: au + 12, u1: au + 13, v0: 6, v1: 9, arch: true });
    const aRes = buildShell({ nu: 32, nv: 16, surface: aSurf, thickness: thickness * 0.85, openings: aOpen, floor: true });
    pushShell(parts, aRes, 'plaster', 'plaster');
    for (const f of aRes.holes) {
      if (!f.through) continue;
      parts.push({ key: 'glow', geo: glowPanel(f, thickness * 0.85, aR) });
      emitters.push({
        pos: new THREE.Vector3().copy(f.center).addScaledVector(f.normal, 0.3),
        kind: 'window',
        range: 7,
        hue: WINDOW_HUE,
        power: 2.0,
      });
    }
    // The annex ring is folded into the foundation so both feet get a skirt.
    for (let i = 0; i < 32; i++) {
      const p = new THREE.Vector3();
      aSurf(i / 32, 0, p);
      if (Math.hypot(p.x, p.z) > R * 0.95) ring.push(p);
    }
    ring.sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x));
  }

  return {
    parts,
    ring,
    emitters,
    radius: R * 1.35,
    height: H,
    proxy: makeProxy(surface, nu, nv),
    proxyKey: 'plaster',
  };
}

// ---------------------------------------------------------------- redoran shell

/**
 * Redoran chitin shell: a hollowed emperor-crab carapace set on bone footings.
 *
 * The read comes from the segmentation. Radius carries a sawtooth in v, so
 * each lamella overhangs the one below and the silhouette is a stack of
 * plates; the bone buttresses arch over the whole thing like ribs.
 */
export function redoranShell(spec: DomeSpec): Structure {
  const rng = new Rng(spec.seed ^ 0x5bd1e995);
  const R = spec.size * rng.range(1.0, 1.42);
  const H = R * rng.range(0.78, 1.12);
  const nu = 44;
  const nv = 24;
  const plates = rng.int(5, 8);
  const plateAmt = rng.range(0.035, 0.075);
  const squash = rng.range(0.62, 0.9); // carapaces are wider than they are long
  const tilt = rng.range(0.05, 0.16);
  const ph = rng.range(0, Math.PI * 2);

  const surface = (u: number, v: number, out: THREE.Vector3): void => {
    const th = u * Math.PI * 2;
    const prof = Math.sqrt(Math.max(0, 1 - v * v * 0.985));
    // Sawtooth in v: each plate's lower lip stands proud of the plate beneath.
    const seg = plateAmt * (1 - (v * plates - Math.floor(v * plates)));
    const lobe = 1 + 0.10 * Math.cos(2 * th + ph) + 0.05 * Math.cos(4 * th - ph);
    const r = R * (prof + seg) * lobe;
    const y = H * Math.pow(v, 0.86);
    out.set(Math.cos(th) * r + tilt * y * y * 0.18, y, Math.sin(th) * r * squash);
  };

  const doorU = Math.round(((spec.facing / (Math.PI * 2)) * nu + nu) % nu);
  const openings: Opening[] = [];
  openings.push({ u0: doorU - 3, u1: doorU + 3, v0: 0, v1: rng.int(8, 10), arch: true });
  // Slit windows sit between plates, never across one — that is what makes the
  // segmentation read as structure rather than as a decal.
  const slits = rng.int(3, 6);
  for (let i = 0; i < slits; i++) {
    const band = rng.int(1, plates - 1);
    const v0 = Math.round((band / plates) * nv) + 1;
    const uu = rng.int(0, nu - 1);
    openings.push({ u0: uu, u1: uu + rng.int(2, 3), v0, v1: v0 + rng.int(2, 3), arch: rng.chance(0.5) });
  }
  for (let i = 0, n = rng.int(2, 4); i < n; i++) {
    const uu = rng.int(0, nu - 1);
    const v0 = rng.int(3, 14);
    openings.push({ u0: uu, u1: uu + rng.int(3, 5), v0, v1: v0 + 2, recess: rng.range(0.08, 0.16) });
  }

  const thickness = rng.range(0.20, 0.32);
  const res = buildShell({ nu, nv, surface, thickness, openings, floor: true });
  const parts: Part[] = [];
  pushShell(parts, res, 'chitin', 'chitin');

  const emitters: Emitter[] = [];
  const boneGeo: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  for (let i = 0; i < res.holes.length; i++) {
    const f = res.holes[i];
    if (!f.through) continue;
    trim.push(sill(f, thickness, 1.14, 0.10));
    parts.push({ key: 'glow', geo: glowPanel(f, thickness, R) });
    emitters.push({
      pos: new THREE.Vector3().copy(f.center).addScaledVector(f.normal, 0.35),
      kind: 'window',
      range: i === 0 ? 10 : 7,
      hue: WINDOW_HUE,
      power: i === 0 ? 3.8 : 2.2,
    });
  }

  // ---- bone buttresses ----
  const ribs = rng.int(3, 6);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < ribs; i++) {
    const u = (i + rng.range(0.1, 0.9)) / ribs;
    const path: THREE.Vector3[] = [];
    const radii: number[] = [];
    const steps = 9;
    for (let s = 0; s <= steps; s++) {
      const v = (s / steps) * rng.range(0.62, 0.94);
      surface(u, v, tmp);
      const out = 1 + 0.075 * Math.sin((s / steps) * Math.PI);
      path.push(new THREE.Vector3(tmp.x * out, tmp.y, tmp.z * out));
      radii.push(0.20 * (1 - 0.62 * (s / steps)) + 0.035);
    }
    // Splay the foot outward so the rib plants on the ground, not on the wall.
    path[0].multiplyScalar(1.14);
    path[0].y = -0.5;
    boneGeo.push(sweep(path, radii, 7, rng.range(-0.3, 0.3)));
  }
  const bone = mergeParts(boneGeo);
  if (bone) parts.push({ key: 'bone', geo: bone });
  const trimGeo = mergeParts(trim);
  if (trimGeo) parts.push({ key: 'stone', geo: trimGeo });

  return {
    parts,
    ring: baseRing(surface, nu),
    emitters,
    radius: R * 1.3,
    height: H,
    proxy: makeProxy(surface, nu, nv),
    proxyKey: 'chitin',
  };
}

// ---------------------------------------------------------------- velothi tower

export interface TowerSpec {
  seed: number;
  facing: number;
  size: number;
  /** 0 = intact, 1 = little left standing. */
  collapse: number;
  /** Daedric ruins are squatter, wider and carry deeper relief. */
  daedric?: boolean;
}

/**
 * Velothi tower / Daedric ruin: basalt, angular, asymmetric, half swallowed.
 *
 * Flat-shaded polygonal prism with per-face radius offsets, a lean, deep
 * recessed relief and a collapse profile that eats the crown unevenly. The
 * rubble at the foot is not decoration — a clean break at the top with a clean
 * floor below it is the single fastest way to make a ruin look like a prop.
 */
export function velothiTower(spec: TowerSpec): Structure {
  const rng = new Rng(spec.seed ^ 0x1b873593);
  const daedric = spec.daedric === true;
  const sides = daedric ? rng.int(4, 6) : rng.int(5, 7);
  const R = spec.size * (daedric ? rng.range(1.0, 1.5) : rng.range(0.7, 1.05));
  const H = R * (daedric ? rng.range(2.4, 3.6) : rng.range(3.2, 5.4));
  const nu = sides * 6;
  const nv = daedric ? 18 : 24;
  const taper = rng.range(0.42, 0.68);
  const lean = rng.range(-0.09, 0.09);
  const alpha = (Math.PI * 2) / sides;

  // Per-face radius bias: a regular polygon is a machined part, and reads it.
  const faceBias: number[] = [];
  for (let i = 0; i < sides; i++) faceBias.push(rng.range(0.9, 1.12));

  const surface = (u: number, v: number, out: THREE.Vector3): void => {
    const th = u * Math.PI * 2;
    const fi = Math.floor((th / alpha) % sides + sides) % sides;
    const local = th - (fi + 0.5) * alpha;
    // 1/cos turns the angular sweep into a straight face; the tiny epsilon on
    // the exponent keeps the corner from going singular at the seam.
    const flatR = 1 / Math.max(Math.cos(local), 0.55);
    const shrink = 1 - taper * Math.pow(v, 1.25);
    const step = 1 + 0.055 * Math.cos(v * Math.PI * (daedric ? 3 : 5));
    const r = R * flatR * shrink * step * faceBias[fi];
    const y = H * v;
    out.set(Math.cos(th) * r + lean * y * y / H, y, Math.sin(th) * r);
  };

  // ---- collapse: a jagged crown that differs face to face ----
  const cSeed = rng.range(0, 100);
  const crown = (u: number): number => {
    const n = noise2(u * sides * 1.7 + cSeed, cSeed);
    const n2 = noise2(u * sides * 4.3 - cSeed, cSeed * 0.5);
    return 1 - spec.collapse * (0.35 + 0.85 * n) * (0.7 + 0.6 * n2);
  };
  const breachU = rng.next();
  const breachW = rng.range(0.06, 0.16);
  const breachTop = rng.range(0.35, 0.75);
  const erode = (i: number, j: number, u: number, v: number): boolean => {
    if (v > crown(u)) return true;
    // One wall breach low down, so the interior darkness is visible from afar.
    const du = Math.abs(((u - breachU + 1.5) % 1) - 0.5);
    return du < breachW && v < breachTop && v > 0.06 * (1 - du / breachW);
  };

  // ---- openings: slit windows and deep carved relief ----
  const openings: Opening[] = [];
  const doorU = Math.round(((spec.facing / (Math.PI * 2)) * nu + nu) % nu);
  if (spec.collapse < 0.7) {
    openings.push({ u0: doorU - 2, u1: doorU + 2, v0: 0, v1: Math.round(nv * 0.22), arch: !daedric });
  }
  const wins = rng.int(2, 6);
  for (let i = 0; i < wins; i++) {
    const uu = rng.int(0, nu - 1);
    const v0 = rng.int(Math.round(nv * 0.2), Math.round(nv * 0.75));
    openings.push({ u0: uu, u1: uu + 2, v0, v1: v0 + rng.int(2, 4), arch: !daedric });
  }
  // Geometric relief: stacked recessed bands, one per face, offset per face.
  const bands = rng.int(2, 5);
  for (let b = 0; b < bands; b++) {
    const v0 = Math.round(nv * (0.10 + (b / bands) * 0.7));
    const h = rng.int(2, 3);
    for (let f = 0; f < sides; f++) {
      if (rng.chance(0.25)) continue;
      const u0 = f * 6 + 1;
      openings.push({ u0, u1: u0 + 4, v0, v1: v0 + h, recess: rng.range(0.14, 0.30) * (daedric ? 1.6 : 1) });
    }
  }

  const thickness = R * rng.range(0.16, 0.26);
  const res = buildShell({ nu, nv, surface, thickness, openings, flat: true, erode, floor: true });
  const parts: Part[] = [];
  pushShell(parts, res, 'basalt', 'basalt');

  const emitters: Emitter[] = [];
  const extra: THREE.BufferGeometry[] = [];
  const tmp = new THREE.Vector3();

  for (let i = 0; i < res.holes.length; i++) {
    const f = res.holes[i];
    if (!f.through) continue;
    if (f.center.y > H * crown(0.5)) continue; // opening was eaten by the collapse
    extra.push(brow(f, thickness, 1.35, 0.16));
    if (rng.chance(0.55)) {
      parts.push({ key: 'glow', geo: glowPanel(f, thickness, R * 2.0) });
      emitters.push({
        pos: new THREE.Vector3().copy(f.center).addScaledVector(f.normal, 0.35),
        kind: 'window',
        range: 8,
        hue: WINDOW_HUE,
        power: 2.0,
      });
    }
  }

  // ---- asymmetric buttresses ----
  const butts = rng.int(2, sides);
  for (let i = 0; i < butts; i++) {
    const fi = rng.int(0, sides - 1);
    const th = (fi + 0.5) * alpha + rng.range(-0.12, 0.12);
    const topV = rng.range(0.28, 0.66);
    surface(th / (Math.PI * 2), topV, tmp);
    const top = tmp.clone();
    surface(th / (Math.PI * 2), 0, tmp);
    const foot = tmp.clone().multiplyScalar(1.0);
    const out = new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
    const reach = R * rng.range(0.55, 1.15);
    const path = [
      new THREE.Vector3(foot.x + out.x * reach, -0.6, foot.z + out.z * reach),
      new THREE.Vector3(foot.x + out.x * reach * 0.8, top.y * 0.30, foot.z + out.z * reach * 0.8),
      new THREE.Vector3(top.x + out.x * reach * 0.28, top.y * 0.78, top.z + out.z * reach * 0.28),
      new THREE.Vector3(top.x, top.y, top.z),
    ];
    extra.push(sweep(path, [R * 0.22, R * 0.17, R * 0.11, R * 0.06], 4, Math.PI * 0.25));
  }

  // ---- rubble at the foot, and slabs shed from the crown ----
  const rubble = rng.int(6, 16);
  for (let i = 0; i < rubble; i++) {
    const th = rng.range(0, Math.PI * 2);
    const d = R * rng.range(1.0, 2.6);
    const s = R * rng.range(0.10, 0.34);
    const g = bevelBox(s * rng.range(0.7, 2.0), s * rng.range(0.4, 1.1), s * rng.range(0.7, 1.8), s * 0.12);
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rng.range(-0.5, 0.5), rng.range(0, 6.28), rng.range(-0.5, 0.5)),
    );
    extra.push(placed(g, new THREE.Vector3(Math.cos(th) * d, -s * rng.range(0.1, 0.5), Math.sin(th) * d), q));
  }

  const merged = mergeParts(extra);
  if (merged) parts.push({ key: 'basalt', geo: merged });

  return {
    parts,
    ring: baseRing(surface, nu),
    emitters,
    radius: R * 2.2,
    height: H * crown(0.5),
    proxy: makeProxy(surface, nu, nv),
    proxyKey: 'basalt',
  };
}

/**
 * A Daedric shrine: a squat, deeply carved monolith ringed by leaning slabs.
 * Built on the tower generator so the relief and collapse machinery is shared,
 * then dressed with a stone circle that gives it a completely different plan.
 */
export function daedricRuin(spec: TowerSpec): Structure {
  const st = velothiTower({ ...spec, daedric: true });
  const rng = new Rng(spec.seed ^ 0x27d4eb2f);
  const n = rng.int(4, 8);
  const geos: THREE.BufferGeometry[] = [];
  const ringR = st.radius * rng.range(1.35, 1.9);
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2 + rng.range(-0.18, 0.18);
    // Standing stones, not kerbstones: tall enough to read as a shrine ring
    // from a distance and thin enough to keep the monolith the silhouette.
    const h = st.height * rng.range(0.45, 0.95);
    const w = st.radius * rng.range(0.13, 0.24);
    const g = bevelBox(w, h, w * rng.range(0.40, 0.7), w * 0.12);
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rng.range(-0.22, 0.22), -th, rng.range(-0.26, 0.26)),
    );
    geos.push(
      placed(g, new THREE.Vector3(Math.cos(th) * ringR, h * 0.5 - rng.range(0.3, 1.1), Math.sin(th) * ringR), q),
    );
  }
  const merged = mergeParts(geos);
  if (merged) st.parts.push({ key: 'basalt', geo: merged });
  st.radius = ringR * 1.25;
  return st;
}
