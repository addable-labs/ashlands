import * as THREE from 'three';
import type { IMaterials } from '../core/contracts';
import type { System } from '../core/types';
import { VIEWMODEL_NO_PREPASS, gripSection, makeMaterial } from './Gear';
import { REST_POSE, type ShieldDef, type WeaponDef } from './Tables';
import { clamp } from './mathx';

/**
 * ASHLANDS — the first-person viewmodel: an ARMOURED arm holding the weapon,
 * and the shield on the off arm. There is no skin mesh anywhere in this file;
 * the arm is plate, leather and mail from the fingertip to the edge of frame.
 *
 * Three rules the whole thing rests on.
 *
 * **Digits are RIGGED, not painted.** Every finger is a four-joint chain solved
 * in the haft's own frame, and the chain's last joint is placed INSIDE the haft
 * surface so the fingertip clamps it. Lames are then hung on the chain, one per
 * segment, each standing a step outside the one distal to it and lapping over
 * it — so the curl of the finger is the rotation of four separate plates and
 * every join casts its own occlusion shadow. Nothing here is a grid cut into a
 * surface; there is no surface to cut.
 *
 * **Steps, not skins.** No part may be a smooth taper with detail painted on
 * it. Every plate stands a measured distance outside the one it laps and turns
 * its free border outward, so the black-shape silhouette breaks at every
 * border. The vambrace is therefore a two-piece clamshell — dorsal half and
 * volar half, each split again across its length, hinged on one side and
 * buckled on the other — never one cone with hoops on it.
 *
 * **The hand is an asset; the weapon goes into it.** The gauntlet is authored
 * once in CANONICAL HAND SPACE (see the block above `HAND_DORSAL_TH`), frozen,
 * and verified in isolation. Its attitude is a constant relative to the LENS
 * (`HAND_REST`); the weapon is placed into the closed fist by a grip offset
 * (`gripOffset`) and the rig publishes the transform the weapon is drawn at. A
 * swing rotates hand and weapon together as one rigid body, so it can move the
 * rig but never turn the hand over. Nothing here is solved from the weapon's
 * frame — that inversion is what put the player's own palm in his face for
 * twelve rounds. The elbow is a constant in aim space, hard-clamped below and
 * behind the wrist. Depth is compressed into a 17.5 cm band (VIEWMODEL_DEPTH);
 * nothing casts a shadow; the whole group is hidden outside first person.
 */

/* ------------------------------------------------------------ appearance */

/** Which synthesized PBR set dresses each armour material. */
const ARMOUR_SET: Readonly<Record<string, string>> = {
  cloth: 'cloth', fur: 'cloth', hide: 'cloth', leather: 'cloth',
  shell: 'chitin', chitin: 'chitin', bonemold: 'bone', iron: 'iron', steel: 'iron',
  silver: 'bronze', glass: 'glass_volcanic', ebony: 'basalt', daedric: 'basalt',
};

/**
 * Dark iron with worn bright edges — never chrome. These tints MULTIPLY the
 * set's own albedo, so they sit high; the darkness comes from the map, the
 * vertex wear and the shader gain in `patchPlate`, not from here.
 */
const ARMOUR_LOOK: Readonly<Record<string, { color: number; rough: number; metal: number }>> = {
  cloth: { color: 0x9a8465, rough: 0.92, metal: 0 },
  fur: { color: 0x9c8368, rough: 0.95, metal: 0 },
  hide: { color: 0x8e7052, rough: 0.86, metal: 0 },
  leather: { color: 0x5b422c, rough: 0.80, metal: 0 },
  shell: { color: 0xd9c69c, rough: 0.45, metal: 0.08 },
  chitin: { color: 0xd6c194, rough: 0.4, metal: 0.1 },
  bonemold: { color: 0xe6dcc0, rough: 0.55, metal: 0 },
  iron: { color: 0xb2a08a, rough: 0.62, metal: 1 },
  steel: { color: 0xb9c0c6, rough: 0.4, metal: 1 },
  silver: { color: 0xd6d0c2, rough: 0.3, metal: 1 },
  glass: { color: 0x8fd2b6, rough: 0.18, metal: 0.35 },
  ebony: { color: 0x5c5964, rough: 0.22, metal: 0.7 },
  daedric: { color: 0x66545e, rough: 0.28, metal: 0.85 },
};

/**
 * What the character is wearing on the arms, as far as it is observable from
 * here. An absent RPG layer degrades to a plain iron vambrace, never to an
 * exception and never to bare skin.
 */
export interface ArmLook {
  race: string;
  /** Material key for the plate. */
  plate: string;
  /** Nothing armoured was equipped: dress the same plates as a leather bracer. */
  bare: boolean;
}

const DEFAULT_LOOK: ArmLook = { race: 'dunmer', plate: 'iron', bare: false };

type Bag = Record<string, unknown>;

function bagOf(o: Bag | null, key: string): Bag | null {
  if (o === null) return null;
  const v = o[key];
  return typeof v === 'object' && v !== null ? (v as Bag) : null;
}

/**
 * Read race and equipped gear off whatever the 'rpg' system turns out to be.
 * Duck-typed on purpose: combat builds against the engine contracts and nothing
 * else, so it cannot hard-import another subsystem's item tables. Gauntlet
 * slots first, then the cuirass — a Dunmer in an iron cuirass is wearing iron,
 * and showing a leather bracer because the gauntlet slot is empty is the wrong
 * answer.
 */
export function readArmLook(sys: System | undefined): ArmLook {
  const out: ArmLook = { ...DEFAULT_LOOK };
  if (sys === undefined) return out;
  const bag = sys as unknown as Bag;
  const character = bagOf(bag, 'character') ?? bag;

  const race = character.race;
  if (typeof race === 'string' && race.length > 0) out.race = race;

  const inv = bagOf(character, 'inventory');
  const equippedDef = inv === null ? null : inv.equippedDef;
  if (typeof equippedDef !== 'function') return out;
  const materialOf = (slot: string): string | null => {
    let def: Bag | null = null;
    try {
      const v = (equippedDef as (s: string) => unknown).call(inv, slot);
      def = typeof v === 'object' && v !== null ? (v as Bag) : null;
    } catch {
      return null;                       // slot this RPG layer does not know
    }
    if (def === null) return null;
    const m = def.material;
    if (typeof m === 'string' && ARMOUR_LOOK[m] !== undefined) return m;
    return def.kind === 'clothing' ? null : 'leather';
  };

  const plate = materialOf('rightGauntlet') ?? materialOf('leftGauntlet') ?? materialOf('cuirass');
  if (plate === null) out.bare = true;
  else out.plate = plate;
  return out;
}

/* ================================================ PLATE GEOMETRY — begin */

const TAU = Math.PI * 2;
const S_PLATE = 0;
const S_LEATHER = 1;
const S_TRIM = 2;

const _bv = new THREE.Vector3();
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _d0 = new THREE.Vector3();
const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _d3 = new THREE.Vector3();

function sstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Superellipse radius — every wrap in this file is measured on one. */
function radiusAt(th: number, a: number, b: number, n: number): number {
  return ((Math.abs(Math.cos(th)) / a) ** n + (Math.abs(Math.sin(th)) / b) ** n) ** (-1 / n);
}

const flat = (v: number) => (): number => v;

/**
 * Plate parts accumulated into one indexed geometry with three material groups.
 * Vertex colour is not decoration: it carries the wear that brightens turned
 * edges and darkens every recess, and `patchPlate` reads it for roughness,
 * albedo and corrosion tint.
 */
class Build {
  private readonly pos: number[] = [];
  private readonly uv: number[] = [];
  private readonly col: number[] = [];
  private readonly tri: number[][] = [[], [], []];
  private tr = 1; private tg = 1; private tb = 1;

  tint(r: number, g: number, b: number): void { this.tr = r; this.tg = g; this.tb = b; }

  vertex(p: THREE.Vector3, u: number, v: number, s: number, xf?: THREE.Matrix4): number {
    const i = this.pos.length / 3;
    _bv.copy(p);
    if (xf !== undefined) _bv.applyMatrix4(xf);
    this.pos.push(_bv.x, _bv.y, _bv.z);
    this.uv.push(u, v);
    this.col.push(s * this.tr, s * this.tg, s * this.tb);
    return i;
  }

  face(a: number, b: number, c: number, slot: number): void { this.tri[slot].push(a, b, c); }

  /** a=(row,i) b=(row+1,i) c=(row,i+1) d=(row+1,i+1) — outward for +row, +i. */
  quad(a: number, b: number, c: number, d: number, slot: number): void {
    this.tri[slot].push(a, b, c, c, b, d);
  }

  get count(): number { return this.pos.length / 3; }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const idx: number[] = [];
    for (let s = 0; s < 3; s++) {
      if (this.tri[s].length === 0) continue;
      g.addGroup(idx.length, this.tri[s].length, s);
      for (const i of this.tri[s]) idx.push(i);
    }
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
}

/** One station of a plate: axial position, mid-surface radius and half-thickness
 * per angle, a shade multiplier, and an axial drift so a lame can lean. */
interface Sect {
  y: number;
  r: (th: number) => number;
  h: (th: number) => number;
  k?: number;
  dy?: (th: number) => number;
}

interface ShellOpt {
  th0: number;
  th1: number;
  /** angular segments across the plate */
  n: number;
  /** tangential half-width of the turned edge; defaults to the half-thickness */
  bead?: number;
  slot?: number;
  xf?: THREE.Matrix4;
  /** rows in the quarter-round roll off each axial end */
  er?: number;
  /** extra darkening at the th0 / th1 borders, for an edge tucked under another */
  dark?: [number, number];
  /** UV tiles per metre; the sets are authored for architecture, so this is high */
  uvs?: number;
}

/** Interior points on each turned edge. */
const EB = 2;

/**
 * THE primitive. A plate wrapped on an arc from `th0` to `th1` about the local
 * +Y, swept through the stations and CLOSED ON ITSELF: outer face, rolled bead
 * down each long side, inner face, quarter-round off each axial end. So every
 * plate is solid — no grazing view finds an interior — and its rolled border
 * catches light on both sides, the strongest single signal of raised sheet.
 */
function shell(b: Build, st: readonly Sect[], o: ShellOpt): void {
  const { th0, th1, n } = o;
  const slot = o.slot ?? S_PLATE;
  const er = o.er ?? 3;
  const uvs = o.uvs ?? 20;
  const dk0 = o.dark?.[0] ?? 0;
  const dk1 = o.dark?.[1] ?? 0;

  const loop: { th: number; ra: number; ta: number; sh: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const near = Math.max(sstep(0.13, 0, t), sstep(0.87, 1, t));
    const dark = dk0 * sstep(0.22, 0, t) + dk1 * sstep(0.78, 1, t);
    loop.push({ th: th0 + (th1 - th0) * t, ra: 1, ta: 0, sh: (1 + 0.20 * near) * (1 - dark) });
  }
  for (let k = 1; k <= EB; k++) {
    const a = (k / (EB + 1)) * Math.PI;
    loop.push({ th: th1, ra: Math.cos(a), ta: Math.sin(a), sh: 1.30 * (1 - dk1) });
  }
  for (let i = n; i >= 0; i--) {
    loop.push({ th: th0 + (th1 - th0) * (i / n), ra: -1, ta: 0, sh: 0.40 });
  }
  for (let k = 1; k <= EB; k++) {
    const a = (k / (EB + 1)) * Math.PI;
    loop.push({ th: th0, ra: -Math.cos(a), ta: -Math.sin(a), sh: 1.30 * (1 - dk0) });
  }
  loop.push({ ...loop[0] });

  const rows: { s: Sect; hs: number; dy: number }[] = [];
  const href = (s: Sect): number => s.h((th0 + th1) * 0.5);
  for (let i = er; i >= 1; i--) {
    const a = (i / (er + 0.4)) * (Math.PI / 2);
    rows.push({ s: st[0], hs: Math.cos(a), dy: -href(st[0]) * Math.sin(a) });
  }
  for (const s of st) rows.push({ s, hs: 1, dy: 0 });
  const end = st[st.length - 1];
  for (let i = 1; i <= er; i++) {
    const a = (i / (er + 0.4)) * (Math.PI / 2);
    rows.push({ s: end, hs: Math.cos(a), dy: href(end) * Math.sin(a) });
  }

  const base = b.count;
  const L = loop.length;
  for (const row of rows) {
    const s = row.s;
    const kk = s.k ?? 1;
    let u = 0;
    for (let i = 0; i < L; i++) {
      const q = loop[i];
      const hh = s.h(q.th) * row.hs;
      const bd = Math.min(o.bead ?? hh, hh);
      const c = Math.cos(q.th);
      const sn = Math.sin(q.th);
      const R = s.r(q.th) + q.ra * hh;
      const T = q.ta * bd;
      _p0.set(c * R - sn * T, s.y + row.dy + (s.dy === undefined ? 0 : s.dy(q.th)), sn * R + c * T);
      if (i > 0) u += _p0.distanceTo(_p1) * uvs;
      _p1.copy(_p0);
      b.vertex(_p0, u, (s.y + row.dy) * uvs, kk * q.sh, o.xf);
    }
  }
  for (let r = 0; r + 1 < rows.length; r++) {
    for (let i = 0; i + 1 < L; i++) {
      const a = base + r * L + i;
      b.quad(a, a + L, a + 1, a + L + 1, slot);
    }
  }
}

/** Surface of revolution about the local +Y, from a profile of (radius, y). */
function revolve(b: Build, prof: readonly (readonly [number, number])[], seg: number,
  slot: number, sh: (t: number) => number, xf?: THREE.Matrix4): void {
  const base = b.count;
  for (let i = 0; i < prof.length; i++) {
    for (let k = 0; k <= seg; k++) {
      const th = (k / seg) * TAU;
      _e2.set(Math.cos(th) * prof[i][0], prof[i][1], Math.sin(th) * prof[i][0]);
      b.vertex(_e2, (k / seg) * 3.2, i * 0.5, sh(i / (prof.length - 1)), xf);
    }
  }
  for (let i = 0; i + 1 < prof.length; i++) {
    for (let k = 0; k < seg; k++) {
      const a = base + i * (seg + 1) + k;
      b.quad(a, a + seg + 1, a + 1, a + seg + 2, slot);
    }
  }
}

/** A closed annular collar: the profile skinned twice, either side of its own
 * plane, so capping the cuff's bore can never present a backface. */
function collar(b: Build, prof: readonly (readonly [number, number])[], seg: number,
  slot: number, sh: number, t: number, xf?: THREE.Matrix4): void {
  revolve(b, prof.map(([r, y]) => [r, y + t] as const), seg, slot, () => sh, xf);
  revolve(b, [...prof].reverse().map(([r, y]) => [r, y - t] as const), seg, slot,
    () => sh * 0.72, xf);
}

/**
 * A raised boss standing `hgt` proud of `c` along `out`, elliptical in plan and
 * optionally LEANING: six segments and a tall `hgt` make a knuckle gadling, ten
 * and a low one make a rivet. Crown shade is capped — a boss that outruns the
 * plate it sits on reads as a ball bearing.
 */
function boss(b: Build, c: THREE.Vector3, out: THREE.Vector3, along: THREE.Vector3 | null,
  rx: number, rz: number, hgt: number, seg: number, slot: number, sh: number,
  lean = 0, xf?: THREE.Matrix4): void {
  const u = _d0;
  if (along === null) u.set(out.z, out.x, out.y); else u.copy(along);
  u.addScaledVector(out, -u.dot(out));
  if (u.lengthSq() < 1e-9) u.set(-out.y, out.x, out.z).addScaledVector(out, -out.z * out.x);
  u.normalize();
  const v = _d1.crossVectors(out, u);
  const rings = 3;
  const base = b.count;
  for (let j = 0; j <= rings; j++) {
    const a = (j / rings) * (Math.PI / 2);
    const si = Math.sin(a);
    const co = Math.cos(a);
    for (let k = 0; k <= seg; k++) {
      const ph = (k / seg) * TAU;
      _d2.copy(c)
        .addScaledVector(u, rx * si * Math.cos(ph) + lean * co)
        .addScaledVector(v, rz * si * Math.sin(ph))
        .addScaledVector(out, hgt * co);
      b.vertex(_d2, k / seg, j / rings, sh * (1.12 - 0.34 * (j / rings)), xf);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let k = 0; k < seg; k++) {
      const a = base + j * (seg + 1) + k;
      b.quad(a, a + seg + 1, a + 1, a + seg + 2, slot);
    }
  }
}

/** A domed rivet. */
function dome(b: Build, c: THREE.Vector3, out: THREE.Vector3, rad: number, hgt: number,
  seg: number, slot: number, sh: number, xf?: THREE.Matrix4): void {
  boss(b, c, out, null, rad, rad, hgt, seg, slot, sh, 0, xf);
}

/** A rectangular bar from `p` to `q`. Buckle tongues, hinge pins, enarmes. */
function bar(b: Build, p: THREE.Vector3, q: THREE.Vector3, up: THREE.Vector3,
  w: number, t: number, slot: number, sh: number, xf?: THREE.Matrix4): void {
  const ax = _d0.subVectors(q, p).normalize();
  const sx = _d1.crossVectors(ax, up).normalize();
  const sy = _d2.crossVectors(sx, ax);
  const base = b.count;
  for (let e = 0; e < 2; e++) {
    for (let c = 0; c < 4; c++) {
      const a = c === 0 || c === 3 ? 1 : -1;
      const d = c < 2 ? 1 : -1;
      _d3.copy(e === 0 ? p : q).addScaledVector(sx, a * w * 0.5).addScaledVector(sy, d * t * 0.5);
      b.vertex(_d3, e * 1.4, c * 0.25, sh * (d > 0 ? 1.18 : 0.72), xf);
    }
  }
  for (let c = 0; c < 4; c++) {
    const a = base + c; const d = base + ((c + 1) % 4);
    b.quad(a, a + 4, d, d + 4, slot);
  }
  b.face(base, base + 1, base + 2, slot); b.face(base, base + 2, base + 3, slot);
  b.face(base + 4, base + 6, base + 5, slot); b.face(base + 4, base + 7, base + 6, slot);
}

/**
 * A closed tube lofted through a polyline. This is the arming glove under the
 * lames: it is what touches the haft, and it is why no view finds background
 * between two fingers or between a fingertip and the grip.
 */
function tube(b: Build, pts: readonly THREE.Vector3[], rad: readonly number[],
  seg: number, slot: number, sh: number): void {
  const base = b.count;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    _d0.subVectors(pts[Math.min(i + 1, n - 1)], pts[Math.max(i - 1, 0)]).normalize();
    _d1.set(0, 1, 0).addScaledVector(_d0, -_d0.y);
    if (_d1.lengthSq() < 1e-6) _d1.set(1, 0, 0).addScaledVector(_d0, -_d0.x);
    _d1.normalize();
    _d2.crossVectors(_d0, _d1);
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * TAU;
      _d3.copy(pts[i])
        .addScaledVector(_d1, Math.cos(a) * rad[i])
        .addScaledVector(_d2, Math.sin(a) * rad[i]);
      b.vertex(_d3, (k / seg) * 2.4, i * 0.7, sh * (0.82 + 0.30 * Math.max(0, Math.cos(a))));
    }
  }
  for (let i = 0; i + 1 < n; i++) {
    for (let k = 0; k < seg; k++) {
      const a = base + i * (seg + 1) + k;
      b.quad(a, a + seg + 1, a + 1, a + seg + 2, slot);
    }
  }
}

/** Reflect through the plane the axis lies in. Two arms ARE mirror images. */
function mirror(g: THREE.BufferGeometry, axis: 'x' | 'z'): THREE.BufferGeometry {
  const out = g.clone();
  const a = out.getAttribute('position') as THREE.BufferAttribute;
  const nm = out.getAttribute('normal') as THREE.BufferAttribute;
  for (const at of [a, nm]) {
    for (let i = 0; i < at.count; i++) {
      if (axis === 'x') at.setX(i, -at.getX(i)); else at.setZ(i, -at.getZ(i));
    }
    at.needsUpdate = true;
  }
  const idx = out.getIndex();
  if (idx !== null) {
    for (let i = 0; i < idx.count; i += 3) {
      const t = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, t);
    }
    idx.needsUpdate = true;
  }
  return out;
}

/* -------------------------------------------------------------- vambrace */

/** Wrist to elbow. The vambrace's local +Y; +Z (th = pi/2) is the BACK. */
const FORE = 0.245;
/** Plate half-thickness: 4.4 mm of iron, thick enough for the roll to read. */
const PLH = 0.0022;

function armR(y: number): number {
  const t = clamp(y, -0.07, 0.30);
  return 0.0252 + 0.128 * t - 0.150 * t * t;
}
function armSurf(th: number, y: number): number {
  const R = armR(y);
  return radiusAt(th, R * 1.10, R * 0.90, 2.7);
}

/** Dorsal shell 214 deg, volar shell 165 deg: they lap at BOTH long borders. */
const V_OUT0 = -0.30;
const V_OUT1 = 3.44;
const V_IN0 = 3.28;
const V_IN1 = 6.16;
/** Lateral hinge line, and the buckled closure opposite it. */
const V_HINGE = 3.36;
const V_BUCK = 6.10;

interface BandOpt {
  y0: number; y1: number; off: number;
  th0: number; th1: number; n: number;
  /** outward turn of the PROXIMAL border — the thing that breaks the silhouette */
  lip?: number;
  /** fraction the radius grows across the band; the elbow cop flares on this */
  grow?: number;
  /**
   * Arch of the band's two borders, in metres at the dorsal centre. Plate
   * borders that run dead square to the arm are what make a stack of bands read
   * as washers on a pipe; giving each band its own arch means no two borders in
   * the outline are parallel, which is what a real vambrace looks like.
   */
  arch?: number;
  dark?: [number, number];
}

/**
 * A plate band on the forearm, finished with an outward TURNED LIP at its
 * wrist-ward border. The lip is why the arm has a silhouette: it stands proud
 * of the band it laps, so the outline STEPS at every border.
 */
function armBand(b: Build, o: BandOpt): void {
  const grow = o.grow ?? 0;
  const arch = o.arch ?? 0;
  const at = (y: number, e: number, k: number): Sect => ({
    y,
    r: (th: number): number =>
      armSurf(th, y) * (1 + grow * sstep(o.y0, o.y1, y)) + o.off + e,
    h: flat(PLH),
    k,
    dy: arch === 0 ? undefined : (th: number): number => arch * Math.sin(th),
  });
  const st: Sect[] = [];
  const lip = o.lip ?? 0;
  if (lip > 0) st.push(at(o.y0 - 0.0080, lip, 1.26), at(o.y0 - 0.0034, lip * 0.46, 1.10));
  const rows = Math.max(2, Math.round((o.y1 - o.y0) / 0.030));
  for (let i = 0; i <= rows; i++) {
    st.push(at(o.y0 + (o.y1 - o.y0) * (i / rows), 0, i === rows ? 0.58 : 1));
  }
  shell(b, st, { th0: o.th0, th1: o.th1, n: o.n, dark: o.dark, er: 2 });
}

/** A hinge knuckle: a short barrel lying along the arm at wrap angle `th`. */
function barrel(b: Build, th: number, y: number, len: number, rad: number, off: number): void {
  const r = armSurf(th, y) + off;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const xf = new THREE.Matrix4()
    .makeBasis(new THREE.Vector3(-s, 0, c), new THREE.Vector3(0, 1, 0), new THREE.Vector3(c, 0, s))
    .setPosition(c * r, y, s * r);
  shell(b, [
    { y: -len * 0.5, r: flat(rad), h: flat(0.0011), k: 0.86 },
    { y: 0, r: flat(rad), h: flat(0.0011), k: 1.10 },
    { y: len * 0.5, r: flat(rad), h: flat(0.0011), k: 0.86 },
  ], { th0: 0, th1: TAU, n: 8, xf, er: 2, uvs: 40 });
}

/** A strap of leather with a bronze buckle, closing the shell at wrap `th`. */
function strapAt(b: Build, y: number, th0: number, th1: number, thB: number, ride: number): void {
  b.tint(0.84, 0.78, 0.72);
  const at = (t: number): number => armSurf(t, y) + ride
    - 0.0012 * (Math.exp(-(((t - thB + 0.9) / 0.18) ** 2)));
  shell(b, [
    { y: y - 0.0125, r: at, h: flat(0.0019) },
    { y: y + 0.0125, r: at, h: flat(0.0019) },
  ], { th0, th1, n: 12, slot: S_LEATHER, bead: 0.0012, er: 2, uvs: 48 });

  // A solid bronze plate lying ON the strap with two domed pins, not a frame of
  // thin bars: 3 mm rods seen edge on read as needles pushed through the arm.
  b.tint(1, 1, 1);
  shell(b, [-0.013, 0.013].map((dy) => ({
    y: y + dy, r: (t: number): number => armSurf(t, y) + ride + 0.0022, h: flat(0.0014),
  })), { th0: thB - 0.34, th1: thB + 0.34, n: 5, slot: S_TRIM, er: 2, uvs: 34 });
  for (const dy of [-0.007, 0.007]) {
    const rr = armSurf(thB, y) + ride + 0.0038;
    _p0.set(Math.cos(thB) * rr, y + dy, Math.sin(thB) * rr);
    _p1.set(Math.cos(thB), 0, Math.sin(thB));
    dome(b, _p0, _p1, 0.0030, 0.0019, 8, S_TRIM, 1.16);
  }
}

/**
 * The vambrace as a real one is made: a quilted arming liner; a CLAMSHELL of
 * two half-shells lapping 4 mm at both long borders, each cut across its length
 * into two plates so the outline steps on the dorsal AND the volar edge; hinge
 * barrels and a pin down the lateral seam; buckles down the medial one; and a
 * couter of two lames and a flared cop over the point of the elbow.
 */
function vambraceGeometry(): THREE.BufferGeometry {
  const b = new Build();

  // Quilted arming liner. Every opening in the plate above looks into this, so
  // no grazing angle ever finds interior blackness.
  b.tint(0.44, 0.40, 0.36);
  shell(b, [0.000, 0.05, 0.10, 0.15, 0.20].map((y) => ({
    y,
    r: (th: number): number => armSurf(th, y) - 0.0030 + 0.0011 * Math.cos(th * 9),
    h: flat(0.0030),
  })), { th0: 0, th1: TAU, n: 18, slot: S_LEATHER, bead: 0.0014, er: 2, uvs: 40 });

  b.tint(1, 1, 1);
  // Dorsal half, in two plates. The upper one laps the lower by 8 mm and turns
  // its wrist-ward border out, so the dorsal outline steps twice on its own.
  armBand(b, { y0: 0.004, y1: 0.098, off: 0, th0: V_OUT0, th1: V_OUT1, n: 14, lip: 0.0046, arch: -0.013, dark: [0.22, 0.22] });
  armBand(b, { y0: 0.092, y1: 0.176, off: 0.0044, th0: V_OUT0, th1: V_OUT1, n: 14, lip: 0.0040, arch: 0.011, dark: [0.22, 0.22] });
  // Volar half, tucked under the dorsal at both borders, stepped at its own
  // pitch so the two outlines do not break at the same height.
  armBand(b, { y0: 0.008, y1: 0.086, off: 0, th0: V_IN0, th1: V_IN1, n: 11, lip: 0.0042, arch: 0.009, dark: [0.5, 0.5] });
  armBand(b, { y0: 0.078, y1: 0.158, off: 0.0040, th0: V_IN0, th1: V_IN1, n: 11, lip: 0.0038, arch: -0.010, dark: [0.5, 0.5] });

  // A raised rib down the middle of each dorsal plate, and rivets along both
  // laps. Between them the shell stops being a smooth cone with a crease in it:
  // the light now has something to travel across on the way to each border.
  for (const [y0, y1, off] of [[0.010, 0.094, 0], [0.096, 0.172, 0.0044]] as const) {
    shell(b, [y0, (y0 + y1) * 0.5, y1].map((y) => ({
      y, r: (th: number): number => armSurf(th, y) + off + 0.0022, h: flat(0.0017),
    })), { th0: 1.42, th1: 1.72, n: 3, er: 2, uvs: 26 });
  }
  const rivetLine = (th: number, ys: readonly number[]): void => {
    for (const y of ys) {
      const r = armSurf(th, y) + (y > 0.090 ? 0.0044 : 0) + PLH + 0.0007;
      _p0.set(Math.cos(th) * r, y, Math.sin(th) * r);
      _p1.set(Math.cos(th), 0, Math.sin(th));
      dome(b, _p0, _p1, 0.0037, 0.0023, 8, S_PLATE, 1.08);
    }
  };
  rivetLine(V_OUT0 + 0.17, [0.020, 0.058, 0.106, 0.148]);
  rivetLine(V_OUT1 - 0.17, [0.020, 0.058, 0.106, 0.148]);

  // Lateral seam: three hinge barrels and the pin through them.
  for (const y of [0.028, 0.086, 0.146]) barrel(b, V_HINGE, y, 0.024, 0.0044, 0.0074);
  _p0.set(Math.cos(V_HINGE) * (armSurf(V_HINGE, 0.010) + 0.0074), 0.010, Math.sin(V_HINGE) * (armSurf(V_HINGE, 0.010) + 0.0074));
  _p1.set(Math.cos(V_HINGE) * (armSurf(V_HINGE, 0.166) + 0.0074), 0.166, Math.sin(V_HINGE) * (armSurf(V_HINGE, 0.166) + 0.0074));
  bar(b, _p0, _p1, _d3.set(Math.cos(V_HINGE), 0, Math.sin(V_HINGE)), 0.0034, 0.0034, S_TRIM, 1.06);

  // Medial seam: the closure. Two straps, each with its buckle on the flat.
  strapAt(b, 0.042, 3.34, 6.34, V_BUCK, 0.0026);
  strapAt(b, 0.128, 3.34, 6.34, V_BUCK, 0.0066);

  // Couter: two lames stepping out of the vambrace, then the cop itself, and a
  // volar lame so the INNER outline breaks at the elbow too.
  b.tint(1, 1, 1);
  armBand(b, { y0: 0.150, y1: 0.192, off: 0.0106, th0: V_OUT0 - 0.10, th1: V_OUT1 + 0.10, n: 15, lip: 0.0042, arch: -0.008, dark: [0.3, 0.3] });
  armBand(b, { y0: 0.186, y1: 0.252, off: 0.0150, grow: 0.20, th0: V_OUT0 - 0.20, th1: V_OUT1 + 0.20, n: 16, lip: 0.0048, arch: 0.012, dark: [0.3, 0.3] });
  armBand(b, { y0: 0.146, y1: 0.198, off: 0.0086, th0: V_IN0 + 0.10, th1: V_IN1 - 0.10, n: 11, lip: 0.0040, arch: 0.008, dark: [0.5, 0.5] });
  for (const th of [V_OUT0 + 0.44, 1.57, V_OUT1 - 0.44]) {
    const r = armSurf(th, 0.234) * 1.16 + 0.0154;
    _p0.set(Math.cos(th) * r, 0.234, Math.sin(th) * r);
    _p1.set(Math.cos(th), 0, Math.sin(th));
    boss(b, _p0, _p1, _d3.set(0, 1, 0), 0.0072, 0.0050, 0.0056, 6, S_PLATE, 1.06, 0.0016);
  }

  // BOTH ENDS CAPPED, and this is not tidiness either.
  //
  // The vambrace is four open shells round an open liner, and a swing turns
  // one bore or the other at the lens: the wrist end whenever the hand goes out
  // ahead of the elbow, the couter's mouth whenever the elbow comes up. Backface
  // culling then shows the player the ground THROUGH the forearm, which is
  // exactly the "open-ended tube" the swing capture caught — a dark ellipse
  // punched in the middle of the arm. Two domed plugs, tinted as the arming
  // liner, and there is no view down either end.
  b.tint(0.40, 0.36, 0.33);
  revolve(b, [[0.0002, -0.010], [0.0130, -0.0062], [0.0206, -0.0018], [0.0232, 0.0020]],
    16, S_LEATHER, (t) => 0.50 + 0.26 * t);
  revolve(b, [[0.0356, 0.2440], [0.0300, 0.2530], [0.0170, 0.2600], [0.0002, 0.2630]],
    16, S_LEATHER, (t) => 0.62 - 0.22 * t);
  b.tint(1, 1, 1);
  return b.build();
}

/* -------------------------------------------------------------- gauntlet */

interface Grip { x: number; z: number }

const GRIP_N = 2.6;
/**
 * Where the wrist joint sits, and the direction it leaves toward the elbow.
 *
 * The offset from the haft axis is the number that decides whether the weapon
 * has a bottom end. It was 34 mm, and 34 mm is not where a wrist is: the haft
 * runs through the palm, and the wrist centre sits on the FAR side of the palm
 * from the fingers, a good 5 cm out. At 34 mm the cuff — a bell 48 mm in radius
 * hung on this point — reached across the haft axis and swallowed the pommel
 * whole. Captured with the hand hidden, the hilt is a clean dark bar with a
 * wheel pommel on the end of it; captured with the hand shown, everything below
 * the crossguard disappeared into the cuff. That IS the review's "the blade
 * simply emerges from the cuff".
 *
 * 52 mm out, and the bell now passes entirely OUTBOARD of the haft: the pommel
 * stands clear against it instead of inside it.
 */
const WRIST_P = new THREE.Vector3(-0.052, -0.012, -0.004);
const WRIST_AXIS = new THREE.Vector3(-0.30, -0.94, -0.16).normalize();

/** The metacarpal heads sit here on the wrap; the fingers curl off decreasing. */
const TH_MCP = 1.36;
/**
 * Along the haft: index near the guard, little finger at the pommel.
 *
 * The pitch is 18 mm, not the 21 mm it was. Four fingers at 21 mm plus a palm
 * put the gauntlet's span along the haft at 11 cm, which is longer than a
 * one-handed hilt: the fist ATE the weapon, crossguard flush on the knuckles
 * and pommel flush under the heel, and no length of haft was ever visible
 * entering or leaving the hand. 18 mm is the real pitch of a gauntleted hand
 * and it brings the span to 10 cm, which — against the 14 cm hilt in `Gear` —
 * leaves two centimetres of ferruled haft proud at each end.
 */
const FY = [0.0690, 0.0510, 0.0330, 0.0150];
/** Reach and girth per finger. */
const FS = [1.00, 1.06, 0.99, 0.85];
const FR = [1.00, 1.02, 0.97, 0.87];
/**
 * Wrap consumed by each of the four digit segments — proximal, middle, distal,
 * fingertip. They sum to 3.08 rad: the finger curls 176 degrees from the
 * knuckle, which is what closing on a 34 mm haft actually costs.
 */
const DTH = [0.98, 0.98, 0.80, 0.32];
/** Arming-glove radius at each of the five joints. */
const DR = [0.0096, 0.0092, 0.0086, 0.0078, 0.0066];
/**
 * Stand-off of each joint's CENTRELINE from the haft surface. Read them against
 * DR: from the middle joint on, centreline + radius is LESS than the haft
 * radius, so the glove is inside the haft surface and the finger is clamped on
 * it. That is the whole grip, and it is checked by arithmetic, not by eye.
 */
const DOFF = [0.0098, 0.0092, 0.0080, 0.0064, 0.0050];
/** Gadling scale per finger: the index knuckle is the one that lands blows. */
const KS = [1.00, 0.93, 0.85, 0.75];
/** Each lame stands this much outside the one distal to it. */
const LSTEP = 0.0007;
/** Clearance between the glove and the inside of the lame above it. */
const LGAP = 0.0005;
/** Lame half-thickness: 2.6 mm, so the rolled edge is a 2.6 mm bright line. */
const LH = 0.0009;

/* ==================================================== CANONICAL HAND SPACE
 *
 * THE HAND IS AN ASSET, NOT A SOLUTION. This is the whole architecture, and it
 * is the opposite of what this file used to do.
 *
 * It used to declare the WEAPON's local space (`Gear`: origin at the hand, +Y
 * along the blade) and then SOLVE the hand's attitude to match it, every frame,
 * through two intermediate frames — a "rest frame" built out of `WRIST_AXIS`
 * and an aim-space reference built out of `REST_ELBOW` — with a roll angle
 * between them. Nothing in that chain was a property of the hand, so every
 * convention error in it came out as the hand facing the wrong way, and any
 * change to the weapon frame silently rotated the hand: re-aiming `WRIST_AXIS`
 * to carry the cuff off the haft turned every gauntlet by 97 degrees, and the
 * only thing that recorded it was the player saying he could see his palm.
 * Twelve rounds of adjusting angles never converged because the quantity being
 * adjusted was not the quantity being drawn.
 *
 * So the hand is now authored ONCE, in its own space, verified in isolation and
 * frozen. Weapons are placed INTO it (`gripOffset`) and it is placed relative
 * to the CAMERA (`HAND_REST`). Nothing solves it from a blade direction.
 *
 * CANONICAL RIGHT-HAND SPACE — right handed, and axis for axis the same
 * convention as a three.js camera, which is the space it is ultimately shown in:
 *
 *   +Y   THE GRIP AXIS. The reference cylinder the fist is closed on runs along
 *        it; +Y points from the pommel toward the blade. The metacarpal heads
 *        lie along it too — index at the guard end, little finger at the pommel
 *        — because that is what closing a hand on a hilt does.
 *   +Z   THE DORSAL NORMAL, straight out of the back of the hand. A three.js
 *        camera looks down its own -Z, so a lens on +Z sees the BACK OF THE
 *        HAND. That is the one fact this whole rebuild exists to guarantee.
 *   +X   knuckle-ward, = cross(+Y, +Z). It appears on the RIGHT of frame.
 *
 * CHIRALITY, checked on the geometry and not by eye. With F the extended-finger
 * ray (wrist -> middle metacarpal head), T the abducted-thumb ray (little
 * metacarpal head -> index metacarpal head) and N the palm's outward normal
 * (= -dorsal, i.e. canonical -Z), a RIGHT hand has cross(T, F) . N > 0. The
 * authored gauntlet measures +0.986 there. `HandGeo.chirality` carries it, the
 * constructor asserts on it, and the left hand is this asset mirrored in X —
 * which negates the triple product and keeps +Y and +Z meaning what they say.
 *
 * The plate below is AUTHORED in a WRAP frame: the grip axis is already +Y, and
 * every plate is placed by a wrap angle `th` about it, measured from +X toward
 * +Z. Going round: back of the hand 1.30..2.96, palm and heel 2.96..4.63,
 * fingers 4.63..7.71 (i.e. -1.65 at the tips up to 1.43 at the knuckles), the
 * gadlings on the metacarpal heads at 1.505..1.64, the thumb crossing the
 * fingers from 3.84 to 6.96. `HAND_CANON` rotates that frame into canonical
 * space ONCE, at build time. After it, nothing may turn the hand about its own
 * axes again.
 */

/**
 * The wrap angle of the BACK OF THE HAND — the outward normal of the two
 * dorsal plates, which span 1.30..2.96 and are centred here. `HAND_CANON` sends
 * this direction to canonical +Z, so at rest it is the direction pointing at
 * the lens.
 *
 * This is an ASSET CONSTANT: it says which part of the authored wrap is the
 * back of the hand. It is not a framing dial. What the lens is shown is
 * `HAND_DORSAL_TH + HAND_TWIST`, and the dial is the twist.
 */
const HAND_DORSAL_TH = 2.13;

/**
 * Authored wrap frame -> canonical hand space. A rotation about the grip axis
 * by `HAND_DORSAL_TH - pi/2`: `makeRotationY(a)` carries the direction at wrap
 * angle `th` to the direction at `th - a`, so wrap `HAND_DORSAL_TH` lands on
 * pi/2, which is +Z.
 */
const HAND_CANON = new THREE.Matrix4().makeRotationY(HAND_DORSAL_TH - Math.PI / 2);

/**
 * The landmarks the chirality test is taken on, in canonical hand space. Kept
 * on the asset rather than recomputed by a tool, so the check the constructor
 * runs and the check the isolation render draws are the same numbers.
 */
export interface HandLandmarks {
  /** Wrist joint. */
  wrist: THREE.Vector3;
  /** Metacarpal heads, index..little. */
  mcp: THREE.Vector3[];
  /** Fingertips, index..little. */
  tip: THREE.Vector3[];
  /** Tip of the thumb. */
  thumbTip: THREE.Vector3;
  /** F — the extended-finger ray. */
  fingers: THREE.Vector3;
  /** T — the abducted-thumb (radial) ray. */
  thumb: THREE.Vector3;
  /** N — the palm's outward normal, = -dorsal. */
  palm: THREE.Vector3;
}

interface HandGeo {
  geo: THREE.BufferGeometry;
  wrist: THREE.Vector3;
  axis: THREE.Vector3;
  dorsal: THREE.Vector3;
  landmarks: HandLandmarks;
  /** cross(T, F) . N. Positive is a right hand; see the header above. */
  chirality: number;
  triangles: number;
}

/**
 * One lame: a thick plate wrapped over the digit from `a` to `e`, its trailing
 * end shaded dark because it is tucked under the lame behind it and its leading
 * end FLARED, so the turned edge lights up and drops a shadow on the next lame.
 */
function lameAt(b: Build, a: THREE.Vector3, e: THREE.Vector3, out: THREE.Vector3,
  ra: number, rb: number, arc: number, slot = S_PLATE, flare = 1.15): void {
  const len = _d0.subVectors(e, a).length();
  if (len < 1e-5) return;
  _d0.multiplyScalar(1 / len);
  _d2.copy(out).addScaledVector(_d0, -out.dot(_d0));
  if (_d2.lengthSq() < 1e-9) return;
  _d2.normalize();
  _d1.crossVectors(_d0, _d2);
  const xf = new THREE.Matrix4()
    .makeBasis(_d1.clone(), _d0.clone(), _d2.clone())
    .setPosition(a.x, a.y, a.z);
  const mid = ra + (rb - ra) * 0.34;
  // A superelliptic section, NOT a circular one. A lame is sheet raised over a
  // finger: it is broad and nearly flat across its back with the corners turned
  // down at the sides. A circular section is a piece of pipe, and a hand made
  // of pipe is the exact failure this rebuild exists to end.
  const sec = (r: number) => (th: number): number => radiusAt(th, r * 1.12, r * 0.88, 3.0);
  shell(b, [
    { y: 0, r: sec(ra), h: flat(LH), k: 0.62 },
    { y: len * 0.34, r: sec(mid), h: flat(LH), k: 0.94 },
    { y: len * 0.90, r: sec(rb), h: flat(LH), k: 1.04 },
    { y: len, r: sec(rb * flare), h: flat(LH * 0.84), k: 1.22 },
  ], {
    th0: Math.PI / 2 - arc, th1: Math.PI / 2 + arc, n: 6, xf,
    er: 2, bead: LH, uvs: 44, slot, dark: [0.34, 0.34],
  });
}

/** The five joints of finger `i`, in the haft's own frame. */
function fingerChain(g: Grip, i: number): THREE.Vector3[] {
  let th = TH_MCP + 0.07 - 0.045 * i;
  const out: THREE.Vector3[] = [];
  for (let s = 0; s <= 4; s++) {
    const r = radiusAt(th, g.x, g.z, GRIP_N) + DOFF[s] * FR[i];
    // Fingers converge slightly toward the tips, as a real fist does.
    const y = FY[i] + (0.0420 - FY[i]) * 0.16 * (s / 4);
    out.push(new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r));
    if (s < 4) th -= DTH[s] * FS[i];
  }
  return out;
}

/** Radially outward from the haft axis at a point. */
function radialOf(p: THREE.Vector3, q: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.set(p.x + q.x, 0, p.z + q.z).normalize();
}

/** Back-of-hand plate surface: high over the knuckles, falling to the wrist. */
function backR(g: Grip, th: number, y: number): number {
  return radiusAt(th, g.x, g.z, GRIP_N) + 0.0148 + 0.0132 * sstep(2.94, 1.36, th)
    + 0.0038 * Math.sin(Math.PI * clamp((y + 0.004) / 0.092, 0, 1));
}

/**
 * A whole gauntlet, closed on `g`.
 *
 * Order matters: the grip wrap goes down FIRST, so the haft inside the fist is
 * dark leather and no gap between two fingers can ever show sky; then the
 * arming glove; then the plate on top of it.
 */
function gauntletGeometry(g: Grip): HandGeo {
  const b = new Build();
  const gr = (th: number): number => radiusAt(th, g.x, g.z, GRIP_N);

  // --- grip wrap. A skin of dark leather ON the haft, shaded near-black under
  // the fist and lifting at the ends: it is the contact shadow the hand casts
  // on the weapon, and it closes the last sliver of background.
  b.tint(0.52, 0.46, 0.42);
  shell(b, ([[-0.003, 0.86], [0.010, 0.44], [0.048, 0.34], [0.084, 0.44], [0.092, 0.84]] as const)
    .map(([y, k]) => ({ y, r: (th: number): number => gr(th) + 0.0008, h: flat(0.0005), k })),
    { th0: 0, th1: TAU, n: 16, slot: S_LEATHER, bead: 0.0005, er: 1, uvs: 70 });

  // --- palm and heel: three lapping leather pads, the material break the plate
  // reads against. Their inner faces lie ON the haft.
  b.tint(0.70, 0.64, 0.58);
  for (const [t0, t1, off, y0, y1] of [
    [-1.98, -2.62, 0.0000, -0.002, 0.080],
    [-2.54, -3.10, 0.0022, -0.004, 0.082],
    [-3.02, -3.62, 0.0044, -0.002, 0.078],
  ] as const) {
    shell(b, [y0, (y0 + y1) * 0.5, y1].map((y, i) => ({
      y, r: (th: number): number => gr(th) + 0.0034 + off, h: flat(0.0058),
      k: i === 1 ? 1 : 0.84,
    })), { th0: t1, th1: t0, n: 6, slot: S_LEATHER, bead: 0.0026, er: 3, uvs: 46 });
  }

  // --- back of the hand: two lapping plates, the knuckle plate carried right
  // out to the metacarpal heads so the finger junction is covered by armour.
  b.tint(1, 1, 1);
  for (const [t0, t1, off, dk] of [
    [2.02, 2.96, 0.0000, [0.40, 0.20]],
    [1.30, 2.18, 0.0036, [0.34, 0.00]],
  ] as const) {
    shell(b, [-0.004, 0.014, 0.036, 0.060, 0.086].map((y, i) => ({
      y, r: (th: number): number => backR(g, th, y) + off, h: flat(PLH),
      dy: i === 0 ? (t: number): number => 0.006 * sstep(2.6, 1.5, t)
        : i === 4 ? (t: number): number => -0.006 * sstep(2.6, 1.5, t) : undefined,
    })), { th0: t0, th1: t1, n: 7, dark: dk as [number, number] });
  }
  for (const y of [0.004, 0.078]) {
    for (const th of [2.30, 2.78]) {
      const rr = backR(g, th, y) + 0.0036 + PLH;
      _p0.set(Math.cos(th) * rr, y, Math.sin(th) * rr);
      _p1.set(Math.cos(th), 0, Math.sin(th));
      dome(b, _p0, _p1, 0.0032, 0.0020, 8, S_PLATE, 1.10);
    }
  }

  // --- the four fingers. Chain first, then the glove that touches the haft,
  // then four lames marching round it, each stepped out over the next.
  const chains = [0, 1, 2, 3].map((i) => fingerChain(g, i));
  b.tint(0.72, 0.66, 0.60);
  for (let i = 0; i < 4; i++) {
    const p = chains[i];
    _d3.subVectors(p[1], p[0]).normalize();
    const head = p[0].clone().addScaledVector(_d3, -0.014);
    _d3.subVectors(p[4], p[3]).normalize();
    const tail = p[4].clone().addScaledVector(_d3, 0.005);
    tube(b, [head, ...p, tail],
      [DR[0] * FR[i] * 0.94, ...DR.map((r) => r * FR[i]), 0.0012], 8, S_LEATHER, 0.80);
  }
  b.tint(1, 1, 1);
  for (let i = 0; i < 4; i++) {
    const p = chains[i];
    for (let s = 0; s < 4; s++) {
      const step = (3 - s) * LSTEP;
      _d3.subVectors(p[s + 1], p[s]).normalize();
      const end = p[s + 1].clone().addScaledVector(_d3, s < 3 ? 0.0038 : 0.0012);
      radialOf(p[s], p[s + 1], _e2);
      lameAt(b, p[s], end, _e2,
        DR[s] * FR[i] + LGAP + step + LH,
        DR[s + 1] * FR[i] + LGAP + step + LH,
        1.18 - 0.04 * s, S_PLATE, s === 3 ? 1.03 : 1.10);
    }
    // Fingertip cap: closes the last lame's bore, so no view ever looks down
    // the inside of a finger, and gives the tip a shape to end on.
    _d3.subVectors(p[4], p[3]).normalize();
    radialOf(p[3], p[4], _e2);
    _p0.copy(p[4]).addScaledVector(_d3, 0.0012);
    const rt = DR[4] * FR[i] + LGAP + LH;
    boss(b, _p0, _d3, _e2, rt, rt * 0.94, 0.0042, 7, S_PLATE, 1.02);
    // Gadling: a faceted spike on the metacarpal head, leaning down the finger,
    // tall enough to notch the outline from the front and from above.
    const th = TH_MCP + 0.28 - 0.045 * i;
    const rr = backR(g, th, FY[i]) + 0.0036 + PLH;
    _p0.set(Math.cos(th) * rr, FY[i], Math.sin(th) * rr);
    _p1.set(Math.cos(th), 0, Math.sin(th));
    _d3.set(Math.sin(th), 0, -Math.cos(th));
    boss(b, _p0, _p1, _d3, 0.0126 * KS[i], 0.0092 * KS[i], 0.0104 * KS[i], 6, S_PLATE,
      1.04, 0.0026 * KS[i]);
  }

  // --- thumb: a scaled thenar plate hinged off the metacarpal, then three
  // lames laid ACROSS the haft from the side OPPOSITE the fingers, the distal
  // one climbing up and over the index's middle lame. The opposition IS the
  // grip; without it a gauntlet is a mitten on a stick, and every review of
  // this arm has said so.
  //
  // Two numbers decide whether it is seen at all, and both were wrong before.
  //
  // WRAP. The lens is shown th = HAND_DORSAL_TH + HAND_TWIST = 1.90, i.e. the
  // back of the hand, and the visible window runs roughly 0.3..3.4 — so the
  // thumb has to reach up out of the palm zone and across the fingers to be in
  // the picture at all. The thumb used to die at th = 0.38, which
  // put its tip 27 degrees short of the view axis and hard against the
  // crossguard — on the shoulder of the fist and unreadable, and a capture with
  // the thumb deleted showed no difference at all in that region. It now runs
  // right through the view axis to th = 0.68 with the distal joint CLIMBING to
  // 36 mm of stand-off, which is 2 mm proud of the index's proximal lame: the
  // last lame is the nearest thing on the whole hand, and it crosses the index
  // in front of the lens instead of beside it.
  //
  // HEIGHT. Dropped 7 mm down the haft. At y = 0.10 the thumb sat exactly where
  // the crossguard crosses the frame and was read as part of the guard; at
  // 0.080-0.093 it is clear of the guard, above the index knuckle, and lapping
  // the index's middle lame at the tip — which is where a thumb closed on a
  // hilt actually lies.
  //
  // Read the offsets against TR: at the first two joints offset MINUS radius is
  // 1.0 mm and -0.2 mm, so the thumb pad lies ON the haft and is clamped to it;
  // from the interphalangeal joint on it climbs to +9 mm and +25 mm, which
  // carries the distal lame over the index finger from the far side.
  const tJ: THREE.Vector3[] = ([
    [-2.44, 0.0898, 0.0138],
    [-1.20, 0.0884, 0.0120],
    [-0.24, 0.0842, 0.0212],
    [0.68, 0.0778, 0.0362],
  ] as const).map(([th, y, off]) =>
    new THREE.Vector3(Math.cos(th) * (gr(th) + off), y, Math.sin(th) * (gr(th) + off)));
  const TR = [0.0128, 0.0122, 0.0112, 0.0098];
  b.tint(0.72, 0.66, 0.60);
  {
    _d3.subVectors(tJ[1], tJ[0]).normalize();
    const head = tJ[0].clone().addScaledVector(_d3, -0.016);
    _d3.subVectors(tJ[3], tJ[2]).normalize();
    const tail = tJ[3].clone().addScaledVector(_d3, 0.005);
    tube(b, [head, ...tJ, tail], [0.0118, ...TR, 0.0014], 8, S_LEATHER, 0.80);
  }
  // Thenar plate: three scales over the ball of the thumb, lapping toward it.
  b.tint(1, 1, 1);
  for (const [y0, y1, off, k] of [
    [0.066, 0.086, 0.0000, 0.90], [0.074, 0.092, 0.0030, 1.0],
  ] as const) {
    shell(b, [y0, (y0 + y1) * 0.5, y1].map((y, i) => ({
      y, r: (th: number): number => gr(th) + 0.0100 + off + 0.0062 * sstep(-3.2, -2.2, th),
      h: flat(PLH), k: i === 1 ? k : k * 0.8,
    })), { th0: -3.24, th1: -2.16, n: 7, dark: [0.4, 0.2] });
  }
  for (let s = 0; s < 3; s++) {
    const step = (2 - s) * LSTEP;
    _d3.subVectors(tJ[s + 1], tJ[s]).normalize();
    const end = tJ[s + 1].clone().addScaledVector(_d3, s < 2 ? 0.0044 : 0.0014);
    radialOf(tJ[s], tJ[s + 1], _e2);
    lameAt(b, tJ[s], end, _e2, TR[s] + LGAP + step + LH, TR[s + 1] + LGAP + step + LH,
      1.36 - 0.04 * s, S_PLATE, s === 2 ? 1.03 : 1.10);
  }
  {
    _d3.subVectors(tJ[3], tJ[2]).normalize();
    radialOf(tJ[2], tJ[3], _e2);
    _p0.copy(tJ[3]).addScaledVector(_d3, 0.0016);
    boss(b, _p0, _d3, _e2, (TR[3] + LGAP + LH) * 1.12, (TR[3] + LGAP + LH) * 1.02, 0.0064, 8,
      S_PLATE, 1.06);
  }

  // --- cuff: a bell in the wrist's own frame, flared to 1.35x the vambrace and
  // rolled at the lip so it is a hard step in the black shape. Deliberately
  // loose: the vambrace behind it is aimed at a CLAMPED elbow and the two axes
  // need not agree, so the cuff has to swallow whatever the clamp left.
  //
  // It is 1.1 cm SHORTER down the arm than it was, and that is the wrist break.
  // A cuff that runs 4.5 cm past the wrist joint reaches the far side of the
  // pommel and, worse, meets the vambrace at nearly the vambrace's own width,
  // so hand and forearm come out as one unbroken cone — the "studded plate
  // stuck on a tube" every review has reported. Ending at 3.4 cm leaves the
  // vambrace's first band standing 11 mm proud of nothing at the mouth, with a
  // dark rolled collar over the step: an edge, a shadow, and then the arm.
  const A = WRIST_AXIS.clone();
  const dz = new THREE.Vector3(-1, 0, 0);
  dz.addScaledVector(A, -dz.dot(A)).normalize();
  const dx = new THREE.Vector3().crossVectors(A, dz).normalize();
  const xf = new THREE.Matrix4().makeBasis(dx, A, dz).setPosition(WRIST_P);
  const wall = (R: number) => (th: number): number => radiusAt(th, 1, 0.96, 2.4) * R;
  // Quilted voider first, filling the bore, so the cuff never shows an inside.
  b.tint(0.70, 0.64, 0.58);
  shell(b, ([[-0.030, 0.0230], [-0.012, 0.0272], [0.008, 0.0320], [0.028, 0.0362]] as const)
    .map(([y, R]) => ({
      y, r: (th: number): number => wall(R)(th) + 0.0012 * Math.cos(th * 8), h: flat(0.0026),
    })), { th0: 0, th1: TAU, n: 18, slot: S_LEATHER, bead: 0.0013, er: 2, uvs: 40, xf });
  b.tint(1, 1, 1);
  // Three lapping bands, not one bell: a megaphone has no silhouette events,
  // and this is the piece a side view spends most of its pixels on.
  for (const p of [
    [[-0.036, 0.0272, 0.56], [-0.027, 0.0284, 0.90], [-0.018, 0.0298, 1], [-0.010, 0.0310, 0.68]],
    [[-0.014, 0.0322, 0.62], [-0.004, 0.0338, 0.94], [0.006, 0.0356, 1], [0.014, 0.0372, 0.72]],
    [[0.008, 0.0392, 0.70], [0.018, 0.0414, 1], [0.027, 0.0436, 1.20], [0.034, 0.0452, 1.44]],
  ] as const) {
    shell(b, p.map(([y, R, k]) => ({ y, r: wall(R), h: flat(PLH), k })),
      { th0: 0, th1: TAU, n: 20, xf, er: 2 });
    // Rivets round the band's proximal border, where it laps the one below.
    for (let i = 0; i < 7; i++) {
      const th = (i / 7) * TAU + 0.2;
      const R = wall(p[0][1])(th) + PLH + 0.0007;
      _p0.set(Math.cos(th) * R, p[0][0] + 0.004, Math.sin(th) * R);
      _p1.set(Math.cos(th), 0, Math.sin(th));
      dome(b, _p0, _p1, 0.0034, 0.0021, 8, S_PLATE, 1.08, xf);
    }
  }
  // The mouth collar is DARK, and deliberately so: it is the shadow gap. The
  // arm leaves the hand through it, and a bright lip there welds the two into
  // one cone. Rolled over and shaded to a third, it reads as the underside of a
  // turned edge with the vambrace stepping out of it.
  b.tint(0.42, 0.38, 0.35);
  collar(b, [[0.0414, 0.0340], [0.0356, 0.0306], [0.0286, 0.0282], [0.0244, 0.0274]],
    18, S_LEATHER, 0.62, 0.0009, xf);
  // And a plug across what the collar leaves. The cuff is a bell open at the
  // elbow end, the voider inside it is a shell open at both, and a hand turned
  // even 30 degrees off the forearm points that bore at the lens: the unarmed
  // guard captured as a bright bell with a hole punched through the arm. The
  // plug sits INSIDE the vambrace in any pose where the two agree, so it costs
  // nothing, and closes the bore in every pose where they do not.
  b.tint(0.38, 0.35, 0.32);
  // Profile in order of INCREASING y, which is the direction that makes
  // `revolve` face outward — the sleeve is built that way and is the reference.
  // Written the other way round it is a perfectly good cap pointing into the
  // cuff, i.e. a backface, i.e. invisible, which is how the bore survived the
  // first attempt at closing it.
  revolve(b, [[0.0262, 0.0340], [0.0230, 0.0372], [0.0140, 0.0408], [0.0002, 0.0442]],
    16, S_LEATHER, (t) => 0.60 - 0.20 * t, xf);
  b.tint(0.66, 0.60, 0.55);
  collar(b, [[0.0286, -0.0294], [0.0244, -0.0236], [0.0140, -0.0180], [0.0, -0.0156]],
    18, S_LEATHER, 0.78, 0.0009, xf);
  b.tint(1, 1, 1);

  // --- freeze it. Everything above is authored in the WRAP frame; one rotation
  // carries it into canonical hand space and nothing downstream may turn it
  // again. `applyMatrix4` takes the normals with it.
  const geo = b.build();
  geo.applyMatrix4(HAND_CANON);
  const idx = geo.getIndex();

  const canon = (p: THREE.Vector3): THREE.Vector3 => p.clone().applyMatrix4(HAND_CANON);
  const marks: HandLandmarks = {
    wrist: canon(WRIST_P),
    mcp: chains.map((c) => canon(c[0])),
    tip: chains.map((c) => canon(c[4])),
    thumbTip: canon(tJ[3]),
    fingers: new THREE.Vector3(),
    thumb: new THREE.Vector3(),
    // The palm's outward normal is the antipode of the dorsal normal, i.e.
    // canonical -Z. Not the radial at the palm PADS: those wrap the haft and
    // face it, and a fist's pads are not where an open hand's palm points.
    palm: new THREE.Vector3(0, 0, -1),
  };
  marks.fingers.subVectors(marks.mcp[1], marks.wrist).normalize();
  marks.thumb.subVectors(marks.mcp[0], marks.mcp[3]).normalize();
  const chirality = _d0.crossVectors(marks.thumb, marks.fingers).normalize().dot(marks.palm);

  return {
    geo,
    wrist: canon(WRIST_P),
    axis: WRIST_AXIS.clone().applyMatrix4(HAND_CANON).normalize(),
    // The back of the forearm is the back of the HAND continued, which in
    // canonical space is simply +Z. It used to be a vector derived from
    // `WRIST_AXIS`, which is a wrist-anatomy number and about a radian off the
    // dorsal plates it was supposed to line the vambrace up with.
    dorsal: new THREE.Vector3(0, 0, 1),
    landmarks: marks,
    chirality,
    triangles: idx === null ? 0 : idx.count / 3,
  };
}

/**
 * The frozen canonical right hand, for the isolation render that verifies it.
 * The tool draws THIS — not a copy of the maths — so a render that shows the
 * back of the hand is a statement about the asset the game mounts.
 */
export function canonicalHandAsset(section: { x: number; z: number }
= { x: 0.0168, z: 0.0134 }): HandGeo {
  return gauntletGeometry(section);
}

/* ----------------------------------------------------- sleeve and shield */

/**
 * The upper arm: a padded arming sleeve PINNED AT THE ELBOW and running off
 * frame, wearing a rerebrace of three hoops with turned lower lips and two
 * strapped closures. Full wraps rather than a 240 degree shell because the
 * sleeve is aimed by a single vector and its roll is therefore free.
 */
const UPPER = 0.26;

function sleeveGeometry(): THREE.BufferGeometry {
  const b = new Build();
  b.tint(0.52, 0.47, 0.43);
  // Both ends run to the axis, so neither is a bore: the elbow end is inside the
  // couter for most of the pose range but a swing turns it out, and 2 mm of
  // hole 40 cm from the eye is a bright dot on a dark plate.
  revolve(b, [
    [0.0002, -0.050], [0.036, -0.038], [0.058, -0.024], [0.070, -0.006],
    [0.071, 0.016], [0.074, 0.07], [0.074, 0.16], [0.069, UPPER], [0.0002, UPPER + 0.004],
  ], 16, S_LEATHER, (t) => 0.72 + 0.30 * Math.exp(-(((t - 0.28) / 0.22) ** 2)));

  b.tint(1, 1, 1);
  const hoop = (y0: number, y1: number, r0: number, r1: number, lip: number): void => {
    shell(b, [
      { y: y0 - 0.0074, r: flat(r0 + lip), h: flat(PLH), k: 1.26 },
      { y: y0 - 0.0032, r: flat(r0 + lip * 0.46), h: flat(PLH), k: 1.10 },
      { y: y0, r: flat(r0), h: flat(PLH), k: 1 },
      { y: (y0 + y1) * 0.5, r: flat((r0 + r1) * 0.5), h: flat(PLH), k: 1 },
      { y: y1, r: flat(r1), h: flat(PLH), k: 0.58 },
    ], { th0: 0, th1: TAU, n: 16, er: 2 });
  };
  hoop(0.034, 0.102, 0.0768, 0.0790, 0.0034);
  hoop(0.096, 0.166, 0.0806, 0.0820, 0.0036);
  hoop(0.160, 0.232, 0.0842, 0.0836, 0.0038);

  for (const [y, r] of [[0.070, 0.0806], [0.150, 0.0846]] as const) {
    b.tint(0.84, 0.78, 0.72);
    shell(b, [
      { y: y - 0.011, r: flat(r), h: flat(0.0020) },
      { y: y + 0.011, r: flat(r), h: flat(0.0020) },
    ], { th0: 0, th1: TAU, n: 14, slot: S_LEATHER, bead: 0.0013, er: 2, uvs: 48 });
    b.tint(1, 1, 1);
    const th = 0.9;
    shell(b, [-0.012, 0.012].map((dy) => ({
      y: y + dy, r: flat(r + 0.0030), h: flat(0.0014),
    })), { th0: th - 0.16, th1: th + 0.16, n: 4, slot: S_TRIM, er: 2, uvs: 34 });
    for (const dy of [-0.006, 0.006]) {
      _p0.set(Math.cos(th) * (r + 0.0044), y + dy, Math.sin(th) * (r + 0.0044));
      _p1.set(Math.cos(th), 0, Math.sin(th));
      dome(b, _p0, _p1, 0.0032, 0.0020, 8, S_TRIM, 1.14);
    }
  }
  return b.build();
}

/**
 * The shield. Local +Z is toward the player, so the boss stands off -Z and the
 * enarmes the hand grips run across +Z. The three slots mean something
 * different here — the mesh is mounted [board, enarme leather, iron] — because a
 * shield's body is its own material and only the boss and rim studs are plate.
 */
function shieldGeometry(radius: number): THREE.BufferGeometry {
  const b = new Build();
  const BOARD = S_PLATE;
  const STRAP = S_LEATHER;
  const IRON = S_TRIM;
  const xf = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0),
  );
  b.tint(1, 1, 1);
  revolve(b, [
    [0.048, -0.022], [0.10, -0.023], [radius * 0.72, -0.019], [radius * 0.95, -0.010],
    [radius, -0.002], [radius, 0.010], [radius * 0.94, 0.017], [radius * 0.5, 0.023],
    [0.001, 0.026],
  ], 24, BOARD, (t) => 0.86 + 0.42 * Math.exp(-(((t - 0.5) / 0.14) ** 2)), xf);
  revolve(b, [
    [0.002, -0.057], [0.024, -0.052], [0.038, -0.042], [0.046, -0.032],
    [0.050, -0.027], [0.048, -0.022],
  ], 20, IRON, (t) => 1.22 - 0.42 * t, xf);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    _p0.set(Math.cos(a) * radius * 0.93, Math.sin(a) * radius * 0.93, -0.013);
    _p1.set(0, 0, -1);
    dome(b, _p0, _p1, 0.0060, 0.0034, 7, IRON, 1.06);
  }
  b.tint(0.88, 0.83, 0.78);
  const uz = new THREE.Vector3(0, 0, 1);
  for (const y of [-0.07, 0.07]) {
    _p0.set(-0.085, y, 0.046); _p1.set(0.085, y, 0.046);
    bar(b, _p0, _p1, uz, 0.030, 0.008, STRAP, 1);
  }
  b.tint(1, 1, 1);
  return b.build();
}

/* ------------------------------------------------------- plate materials */

/**
 * Six additions on top of the shared viewmodel patch, every one of them judged
 * against the ash in the same frame rather than in isolation.
 *
 * SCRATCHES — the set's own normal map resampled at two aspects: a coarse layer
 * running the LENGTH of each part, the direction a vambrace drags on a scabbard
 * and a gauntlet on a haft, and a fine cross layer confined to the worn high
 * points, where impacts actually score metal.
 *
 * GRADE — the iron set runs 0.07 to 0.28 linear with an orange oxide bloom.
 * Fine on a wall; on a conductor 50 cm from the eye it read as a chalky white
 * brighter than any terrain at the same depth, and pulling it down naively made
 * a black stick, because a metal's albedo IS its F0. `lift` (<1) raises the
 * map's floor, `gain` sets the level, `desat` holds chroma back — and `desat`
 * is low here on purpose, because the arm has to take the scene's sepia cast.
 *
 * CAVITY — the vertex colour that brightens turned edges also darkens recesses,
 * so it doubles as occlusion: used on albedo AND as a warm corrosion tint,
 * because the pitting under a lap is rust.
 *
 * POLISH — the same channel mixed toward rubbed metal on turned edges and boss
 * crowns. The threshold starts high on purpose, so a knuckle boss can no longer
 * come out a mirrored pearl.
 *
 * WEAR — roughness DOWN on the edges, UP in the recesses, floored well above
 * mirror. Worn steel, not chrome.
 *
 * BOUNCE — a warm gradient on the albedo keyed to the WORLD normal: faces
 * looking at the ash take its ochre, faces looking at the sulphur sky take
 * that. A multiplier, never an addition, so it cannot glow at night.
 *
 * RIM — a grazing-angle add, and the one term here that exists purely for
 * READABILITY, on top of the shared view-space rig in `Gear.VIEWMODEL_RIG`.
 * The rig lights the whole viewmodel; this term lights the ROLLED EDGES
 * specifically. `vColor.g` is the channel the shell builder spikes on a turned
 * border, so weighting the Fresnel lobe by it puts the highlight where a real
 * piece of raised sheet carries one — the lip of every lame, the border of
 * every band, the crown of every boss — and leaves the flats to the rig. That
 * is what makes an armoured hand in front of a blown-out sky resolve into
 * separate plates instead of one black shape. Keyed to `irradiance` and not to
 * a constant, so a night interior gets a dim version of the same edges and it
 * can never look like the armour is glowing.
 */
function patchPlate(m: THREE.MeshStandardMaterial, desat: number, lift: number, gain: number,
  polish = 0, bounce = 1, rim = 0): void {
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer): void => {
    base(shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <normal_fragment_maps>',
        `#ifdef USE_NORMALMAP_TANGENTSPACE
          vec3 scrA = texture2D( normalMap, vNormalMapUv * vec2( 11.0, 0.16 ) ).xyz * 2.0 - 1.0;
          vec3 scrB = texture2D( normalMap, vNormalMapUv * vec2( 0.20, 7.0 ) ).xyz * 2.0 - 1.0;
        #endif
        #include <normal_fragment_maps>
        #ifdef USE_NORMALMAP_TANGENTSPACE
          normal = normalize( normal + tbn * vec3(
            ( scrA.xy * 0.40 + scrB.xy * 0.22 * smoothstep( 0.96, 1.20, vColor.g ) ), 0.0 ) );
        #endif`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float vmCav = smoothstep( 1.00, 0.44, vColor.g );
        float vmPol = smoothstep( 1.02, 1.30, vColor.g );
        diffuseColor.rgb = mix( diffuseColor.rgb,
          vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), ${desat.toFixed(2)} );
        diffuseColor.rgb = pow( diffuseColor.rgb, vec3( ${lift.toFixed(2)} ) ) * ${gain.toFixed(3)};
        diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.56, 0.42, 0.32 ), vmCav );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.58, 0.52, 0.43 ),
          vmPol * ${polish.toFixed(2)} );`,
      )
      // The world normal only exists this late in the chain, so the ground
      // bounce is applied here, one include before diffuseColor is consumed.
      .replace(
        '#include <lights_physical_fragment>',
        `vec3 vmNW = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
        diffuseColor.rgb *= mix(
          mix( vec3( 1.00, 0.99, 0.97 ), vec3( 1.10, 1.00, 0.84 ), clamp( vmNW.y, 0.0, 1.0 ) ),
          vec3( 1.18, 0.97, 0.74 ), clamp( -vmNW.y, 0.0, 1.0 ) * ${bounce.toFixed(2)} );
        #include <lights_physical_fragment>`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float vmWear = clamp( ( vColor.g - 0.96 ) * 2.4, -1.0, 1.0 );
        roughnessFactor = clamp( roughnessFactor * ( 1.0 - 0.42 * vmWear ), 0.29, 0.96 );`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        #if ${rim > 0 ? 1 : 0}
        {
          // irradiance + iblIrradiance, never irradiance alone: see the note on
          // Gear.VIEWMODEL_RIG. This term used to read the first accumulator
          // only, and three keeps the environment in the second, so in a scene
          // with no ambient light and no light probe -- which is every scene in
          // this game -- it was multiplying by zero and drawing nothing.
          vec3 vmEdgeLev = irradiance + iblIrradiance;
          float vmEdge = pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 2.2 );
          totalEmissiveRadiance += vmEdgeLev * vec3( 1.10, 1.03, 0.90 )
            * ( vmEdge * ${rim.toFixed(3)} * ( 0.30 + 2.20 * vmPol ) );
        }
        #endif`,
      );
  };
  m.needsUpdate = true;
}

/* ================================================== PLATE GEOMETRY — end */

/* ---------------------------------------------------------------- the rig */

/**
 * The authored rest pose, in aim space. Derived from `Tables.REST_POSE` — the
 * one table this file and `Melee` both read — so the arm rig and the weapon it
 * is gripping cannot drift apart. Tune the framing there, not here.
 */
const REST_BLADE = new THREE.Vector3().fromArray(REST_POSE.blade).normalize();
const REST_ELBOW = new THREE.Vector3().fromArray(REST_POSE.elbow).normalize();

/* ------------------------------------------- the hand's place in the frame */

/**
 * CAMERA-BASIS CONSTANTS. `REST_POSE` is authored in (right, up, FORWARD), and
 * forward points into the scene; a three.js camera's own third axis points the
 * other way. The pair (right, up, -forward) is orthonormal and RIGHT HANDED —
 * `right = forward x worldUp` and `up = right x forward` give `right x up =
 * -forward` — so it is a rotation, which (right, up, forward) is not: that
 * triple is a reflection and a quaternion read out of it turns the hand into
 * its own mirror image. Everything about the hand's attitude is done in the
 * right-handed one.
 */
const REST_BLADE_CAM = new THREE.Vector3(
  REST_POSE.blade[0], REST_POSE.blade[1], -REST_POSE.blade[2]).normalize();

/** Canonical +Y, the grip axis. Twists are taken about it. */
const GRIP_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * THE ONLY FRAMING DIAL ON THE HAND, and it turns the hand about its own grip
 * axis: which wrap angle the lens is shown. `HAND_DORSAL_TH + HAND_TWIST`.
 *
 * At 0 the two dorsal plates are square to the lens. Their span is 1.30..2.96,
 * the gadlings sit at 1.505..1.64 and the thumb's distal joint at 0.68, so
 * everything below the dorsal centre appears on the RIGHT of the fist and
 * everything above it on the LEFT (a point at wrap `th` sits at canonical angle
 * `th - HAND_DORSAL_TH + pi/2`, whose x — screen right — is
 * `cos` of that, i.e. positive for `th` below the facing angle).
 *
 * -0.23 shows the lens wrap 1.90. The dorsal plate still fills the face, but
 * the knuckle row comes to +0.38 of the hand's radius RIGHT of centre instead
 * of +0.56, the thumb's last lame stays inside the near edge at +0.94, and the
 * palm and heel — 2.96..4.63 — are pushed round to grazing incidence at the far
 * LEFT edge, where they are silhouette and nothing else.
 *
 * This replaces `REST_POSE.faceTh`, which named the same kind of quantity but
 * was consumed through a solved roll against `WRIST_AXIS`. The value it carried,
 * 0.86, is a third of the way down the FINGER CURL: the dorsal plate was edge
 * on and what the lens got was the closed fingers, which is what a player calls
 * "the palm perspective" even though the palm PADS were correctly measured as
 * facing away. The measurement was of the pads and the complaint was about the
 * face; both were right.
 */
const HAND_TWIST = -0.23;

/**
 * THE HAND'S REST ATTITUDE, in the camera's own basis, and it is a CONSTANT.
 *
 * The minimal rotation from the grip axis onto the rest blade, then the twist.
 * Minimal is the point: of all the rotations that put the grip where the blade
 * is, it is the one that moves every other axis least, so the dorsal normal
 * stays as near the lens as the blade angle allows. Measured on the shipped
 * rest blade and twist, canonical +Z comes out at (-0.277, 0.383, 0.881) in
 * camera space — 28 degrees off the view axis, tilted up, which is the back of
 * a hand held out and seen slightly from below. Canonical +X comes out at
 * (0.930, 0.336, 0.147), i.e. all but exactly screen right, so the knuckle side
 * is the right side.
 *
 * One property worth stating because the whole rig rests on it: because
 * `HAND_REST` carries +Y onto the rest blade and the transport carries the rest
 * blade onto this frame's, `handQuat . (0,1,0)` IS the blade direction, to
 * 2e-15 over a dense sweep of arc directions. That identity is what makes the
 * published weapon transform land back on the swing's own hilt and axis.
 */
const HAND_REST = new THREE.Quaternion()
  .setFromUnitVectors(GRIP_AXIS, REST_BLADE_CAM)
  .multiply(new THREE.Quaternion().setFromAxisAngle(GRIP_AXIS, HAND_TWIST));

/** How much of a swing's rotation the elbow inherits before the clamp. */
const ELBOW_FOLLOW = 0.5;
/**
 * The elbow may never be less than this far below / behind / outboard.
 *
 * DOWN and OUT are both framing numbers, not anatomy. The vambrace ends in a
 * flared couter whose mouth opens toward the shoulder; whenever a windup lifts
 * the wrist and the elbow comes up with it, that mouth rotates into view and
 * the player looks straight down an open pipe — the single loudest source of
 * the "the arm is a tube" reading. Holding the elbow 0.58 below and 0.30
 * outboard of the wrist keeps the couter under the bottom edge in every pose
 * the swing can reach, and keeps the forearm crossing the frame on a diagonal
 * instead of dropping straight down out of it.
 */
const ELBOW_MIN_DOWN = 0.58;
const ELBOW_MIN_BACK = 0.10;
const ELBOW_MIN_OUT = 0.30;
/**
 * The most the forearm may disagree with the hand's own wrist axis, radians.
 * A real wrist gives about 60 degrees of extension and rather less of flexion;
 * 1.05 rad is that limit, and it is applied AFTER the framing clamp because a
 * broken wrist is the one thing that reads worse than a badly framed arm.
 */
const WRIST_MAX = 0.78;

/**
 * Environment intensity for a viewmodel conductor. At 1.9 the plate read as a
 * chalky near-white against ash the exposure is metered on; the world's metals
 * sit near 1, and the viewmodel has to sit with them or it looks pasted on. It
 * came down again from 1.45 when the metalness dropped: with more diffuse in
 * the mix, the same environment blew the plate out to a median 198/255 the
 * moment the player looked at the ground and the exposure opened up.
 *
 * And down once more, from 1.28, when the viewmodel got its own light rig. The
 * rig guarantees a floor, so the environment no longer has to be run hot to
 * keep a backlit plate off the black point, and running it hot was costing the
 * look-down frame — the one view where every plate face is turned at the sky
 * and the exposure is metered on dark basalt.
 */
const PLATE_ENV = 1.15;

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _g0 = new THREE.Vector3();
const _g1 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _m0 = new THREE.Matrix4();
const _m1 = new THREE.Matrix4();
const _wrist = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _anchor = new THREE.Vector3();

/**
 * How far down the haft the gauntlet sits from the weapon's own hand anchor.
 *
 * It was 1.6 cm, and it was doing the wrong job. Sliding the fist toward the
 * pommel buys bare grip at the guard end by burying the pommel at the other,
 * and the pommel is the end the cuff is nearest: the gauntlet ate it whole and
 * the review read the hilt as vanishing into the wrist. The length now comes
 * from the HILT — `Gear.HILT_Y0` starts the bare haft 2.2 cm below the anchor
 * and the grip runs 14 cm — so the fist can sit almost on the anchor and still
 * have two ferruled centimetres proud of it at each end. 4 mm of bias toward
 * the pommel, no more, because the guard end is the lit one.
 */
const GRIP_SHOW = 0.006;

/** How far the vambrace cuff laps back over the gauntlet's wrist. See armFor. */
const WRIST_LAP = 0.015;

/**
 * The unarmed fist is NOT the weapon hand with the weapon deleted.
 *
 * A hand closed on a sword is a cylinder seen from the side: the haft runs up
 * the frame and the fist is a band round it. Take the sword away and that same
 * pose is a flat paddle bent square at the wrist, which is what the last review
 * saw. A real fist is seen down its own axis — knuckles toward the target, the
 * whole curl of every finger stacked behind them — so the imaginary haft has to
 * swing round to point across the frame and AWAY, and the roll has to come
 * round with it so the back of the hand and the gadlings stay uppermost.
 *
 * The axis is in aim space, right/up/forward. The twist is about the fist's own
 * grip axis, in the same units as `HAND_TWIST`: the lens is shown wrap angle
 * `HAND_DORSAL_TH + FIST_TWIST` = 1.59, the middle of the gadling row, which
 * the geometry lays at 1.505..1.64 on the metacarpal heads. That is the
 * striking surface, and the rest of the curl stacks up behind it.
 */
const FIST_AXIS = new THREE.Vector3(-0.16, 0.80, 0.58).normalize();
const FIST_TWIST = 1.59 - HAND_DORSAL_TH;
const _fistDir = new THREE.Vector3();

/**
 * WHERE THE WEAPON SITS IN THE HAND — the second half of the inversion.
 *
 * The hand is the fixed thing. A weapon does not carry the hand around; it
 * declares where IT goes in the closed fist, in CANONICAL HAND SPACE, and the
 * rig then publishes the world transform the mesh is drawn at.
 *
 * `along` slides the weapon's own origin — `Gear`'s hand anchor, the point the
 * hilt is measured from — up the grip axis from the hand's origin. `roll` turns
 * the weapon about that axis, which is the quantity that used to be free: the
 * weapon was aimed with `setFromUnitVectors`, whose roll is whatever the
 * minimal transport happens to give, and the hand was then solved to match it.
 * Now the hand decides and the flat of the blade follows the grip, which is
 * what a hand closed on a hilt does.
 *
 * Position and axis are UNCHANGED by this — `along` is exactly the offset the
 * hand was placed by, so the published origin lands back on the swing's own
 * hilt and the published +Y is the swing's own blade axis, to the bit. The
 * melee sweep tests that segment, so the drawn blade and the tested blade
 * cannot diverge; only the roll about it is now the grip's business.
 */
interface GripOffset {
  along: number;
  roll: number;
  /** False for a weapon the fist does not close on; the rig publishes nothing. */
  gripped: boolean;
}

/**
 * THE ROLL IS NOT A TUNED NUMBER. It is forced, and this is the check.
 *
 * The gauntlet's fingers, palm pads and thumb are all placed by a wrap angle on
 * a superellipse of `gripSection(def)` — the SAME section `Gear` builds the
 * haft prism from, in the SAME frame: haft along +Y, wide axis +X, so a
 * cruciform sword's quillons and the long axis of its grip oval both run along
 * +X. So in the AUTHORED wrap frame the weapon sits at the identity: that is
 * what "the lames close on the surface that is actually drawn" means.
 *
 * Canonicalising the hand turned it by `HAND_CANON`. Putting the weapon back
 * where the fingers were closed on it therefore means turning the weapon by
 * exactly the same angle, and any other value is the fist gripping the flat of
 * its own hilt. There is nothing here to iterate on.
 */
const GRIP_ROLL = HAND_DORSAL_TH - Math.PI / 2;

const GRIP_CLOSED: GripOffset = { along: GRIP_SHOW, roll: GRIP_ROLL, gripped: true };
/**
 * A bow is not gripped down its own axis at all: the riser is held across the
 * fist with the limbs vertical, and `Combat` aims it off the camera rather than
 * off the swing arc. The rig places the hands ON it and leaves it alone.
 */
const GRIP_BOW: GripOffset = { along: 0, roll: 0, gripped: false };

function gripOffset(def: WeaponDef): GripOffset {
  return def.cls === 'marksman' ? GRIP_BOW : GRIP_CLOSED;
}

/**
 * Orthonormal, right-handed frame from an axis and a hint. Everything goes
 * through here rather than `makeBasis(right, up, forward)`: the aim basis is
 * LEFT handed, and a quaternion read out of it is a reflection.
 */
function frameOf(y: THREE.Vector3, hint: THREE.Vector3, out: THREE.Matrix4): void {
  _g0.copy(hint).addScaledVector(y, -hint.dot(y));
  if (_g0.lengthSq() < 1e-8) {
    _g0.set(y.z, y.x, y.y);
    _g0.addScaledVector(y, -_g0.dot(y));
  }
  _g0.normalize();
  _g1.crossVectors(y, _g0);
  out.makeBasis(_g1, y, _g0);
}

interface Hand {
  mesh: THREE.Mesh;
  wrist: THREE.Vector3;
  axis: THREE.Vector3;
  dorsal: THREE.Vector3;
}

/** Everything the viewmodel needs to know about the frame it is drawing. */
export interface ViewmodelFrame {
  /** Camera position and basis. `origin` already carries the idle sway. */
  origin: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  forward: THREE.Vector3;
  /** World transform of the held weapon, i.e. the hand anchor. */
  handPos: THREE.Vector3;
  handQuat: THREE.Quaternion;
  weapon: WeaponDef;
  shield: ShieldDef;
  /** 0..1 smoothed guard. */
  guard: number;
  /** True while the swing is in its live window; the off hand tucks in. */
  swinging: boolean;
  /** 0..1 bow draw. Only a marksman weapon ever sets it. */
  draw: number;
}

export class Viewmodel {
  readonly group = new THREE.Group();

  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly mats: IMaterials | null;

  private plateMat!: THREE.MeshStandardMaterial;
  private leatherMat!: THREE.MeshStandardMaterial;
  private trimMat!: THREE.MeshStandardMaterial;
  private shieldMat!: THREE.MeshStandardMaterial;
  private armour!: THREE.Material[];

  private rVamb!: THREE.Mesh;
  private lVamb!: THREE.Mesh;
  private rUpper!: THREE.Mesh;
  private lUpper!: THREE.Mesh;
  private rHand!: Hand;
  private lHand!: Hand;
  private rFist!: Hand;
  private lFist!: Hand;
  private lStrap!: Hand;
  private shield!: THREE.Mesh;

  /** Gauntlets are built around the haft they close on, so they cache per section. */
  private readonly gripCache = new Map<string, HandGeo>();
  private gripKey = '';

  /**
   * WHERE THE WEAPON IS, published by the rig. `Combat` draws the weapon at
   * this transform, so the mesh cannot be anywhere but in the fist. It is
   * meaningful only after `update()` and only when `weaponHeld` is true; a bow
   * keeps its own placement.
   */
  readonly weaponPos = new THREE.Vector3();
  readonly weaponQuat = new THREE.Quaternion();
  weaponHeld = false;

  private look: ArmLook = { ...DEFAULT_LOOK };

  /* Idle motion state. All of it in aim space: right, up, forward. */
  private bobPhase = 0;
  private breathe = 0;
  private readonly sway = new THREE.Vector3();
  private readonly swayVel = new THREE.Vector3();
  private lastYaw = 0;
  private lastPitch = 0;
  private landDip = 0;
  private landVel = 0;
  private wasGrounded = true;
  /** Aim-space offset the caller adds to the hand anchor. Small by design. */
  readonly offset = new THREE.Vector3();

  constructor(mats: IMaterials | null) {
    this.mats = mats;
    this.group.name = 'viewmodel';
    this.group.frustumCulled = false;
    this.build();
  }

  private mat(setName: string, color: number, rough: number, metal: number, env = 1): THREE.MeshStandardMaterial {
    const m = makeMaterial(this.mats, setName, color, rough, metal, true);
    m.vertexColors = true;
    // aoMap defaults to the second UV set, which this geometry does not carry;
    // the vertex colour already holds every recess and overlap that matters.
    m.aoMap = null;
    m.envMapIntensity = env;
    this.materials.push(m);
    return m;
  }

  /**
   * Metalness for a viewmodel plate, and why it is not 1. A pure conductor has
   * no diffuse response, so it is lit entirely by the prefiltered environment,
   * which leaves an iron vambrace black next to the ash the exposure is metered
   * on.
   *
   * It was 0.80, and 0.80 measured out at a median luminance of 50/255 on the
   * gauntlet against ash sitting at 100 — a hole in the frame, not an object.
   * Three fifths conductor is the point where the plate faces carry a real
   * mid-tone (about 100, the same as the ground it is held over) and the
   * specular still says metal rather than painted wood.
   */
  private static readonly PLATE_METAL = 0.62;

  private build(): void {
    this.plateMat = this.mat('iron', ARMOUR_LOOK.iron.color, ARMOUR_LOOK.iron.rough, 1);
    // The set's ARM map takes metalness to zero wherever it decided there is
    // oxide, which turns half a vambrace into brown plastic. Plate is metal
    // everywhere; the oxide is albedo and roughness, not conductivity.
    this.plateMat.metalnessMap = null;
    this.plateMat.metalness = Viewmodel.PLATE_METAL;
    this.plateMat.roughness = ARMOUR_LOOK.iron.rough;
    this.plateMat.envMapIntensity = PLATE_ENV;
    patchPlate(this.plateMat, 0.10, 0.60, 0.64, 0.46, 1, 0.24);
    this.leatherMat = this.mat('cloth', ARMOUR_LOOK.leather.color, 0.88, 0);
    this.leatherMat.metalnessMap = null;
    this.leatherMat.metalness = 0;
    patchPlate(this.leatherMat, 0.16, 1.00, 0.66, 0.06, 1.2, 0.10);
    this.trimMat = this.mat('bronze', 0xc8a874, 0.46, 1, PLATE_ENV);
    this.trimMat.metalnessMap = null;
    this.trimMat.metalness = Viewmodel.PLATE_METAL;
    this.trimMat.roughness = 0.46;
    patchPlate(this.trimMat, 0.06, 0.72, 0.72, 0.10, 1, 0.28);
    this.shieldMat = this.mat('wood_weathered', 0x8d7558, 0.88, 0);
    patchPlate(this.shieldMat, 0.16, 0.88, 0.82, 0, 1, 0.10);
    this.armour = [this.plateMat, this.leatherMat, this.trimMat];

    const vg = vambraceGeometry();
    this.geos.push(vg);
    const vgl = mirror(vg, 'x');
    this.geos.push(vgl);
    this.rVamb = this.add(new THREE.Mesh(vg, this.armour), 'vm-vambrace-r');
    this.lVamb = this.add(new THREE.Mesh(vgl, this.armour), 'vm-vambrace-l');

    const sg = sleeveGeometry();
    this.geos.push(sg);
    this.rUpper = this.add(new THREE.Mesh(sg, this.armour), 'vm-sleeve-r');
    this.lUpper = this.add(new THREE.Mesh(sg, this.armour), 'vm-sleeve-l');

    const blade = this.handPair('168x134', { x: 0.0168, z: 0.0134 });
    this.rHand = this.mount(blade.r, 'vm-gauntlet-r');
    this.lHand = this.mount(blade.l, 'vm-gauntlet-l');
    const fist = this.handPair('#fist', { x: 0.0095, z: 0.0085 });
    this.rFist = this.mount(fist.r, 'vm-fist-r');
    this.lFist = this.mount(fist.l, 'vm-fist-l');
    this.lStrap = this.mount(this.handPair('#strap', { x: 0.0190, z: 0.0140 }).l, 'vm-gauntlet-strap');
    this.gripKey = '168x134';

    const shg = shieldGeometry(0.21);
    this.geos.push(shg);
    this.shield = this.add(new THREE.Mesh(shg, [this.shieldMat, this.leatherMat, this.plateMat]), 'vm-shield');
  }

  private add(m: THREE.Mesh, name: string): THREE.Mesh {
    m.name = name;
    m.castShadow = false;
    m.receiveShadow = true;
    m.frustumCulled = false;
    // Out of the G-buffer entirely: see VIEWMODEL_NO_PREPASS. Screen-space
    // occlusion computed against a depth the viewmodel does not actually draw
    // at was what took the gauntlet to a black silhouette.
    m.userData.prepassMaterial = VIEWMODEL_NO_PREPASS;
    this.group.add(m);
    return m;
  }

  /**
   * The canonical right hand and its mirror.
   *
   * MIRRORED IN X, not in Z, and that is a consequence of canonical space
   * rather than a preference. +Y is the grip axis and +Z is the dorsal normal;
   * reflecting X leaves both of them saying exactly what they said, so the left
   * hand is a left hand in a space with the same two meanings and takes the
   * SAME pose quaternion — no per-side sign anywhere in the rig. Reflecting Z
   * instead, which is what this did while the hand lived in the authored wrap
   * frame, turns the dorsal normal into a palm normal and hands the left arm a
   * mirrored facing that then had to be undone with a side factor.
   */
  private handPair(key: string, section: Grip): { r: HandGeo; l: HandGeo } {
    let r = this.gripCache.get(key);
    if (r === undefined) {
      r = gauntletGeometry(section);
      // The asset's own statement about which hand it is. It is checked here
      // and not in a tool, because a tool can be out of date with the file.
      if (r.chirality <= 0.5) {
        throw new Error(`viewmodel: authored gauntlet is not a right hand (cross(T,F).N = ${r.chirality.toFixed(3)})`);
      }
      this.gripCache.set(key, r);
    }
    let l = this.gripCache.get(`${key}:L`);
    if (l === undefined) {
      const mx = (v: THREE.Vector3): THREE.Vector3 => new THREE.Vector3(-v.x, v.y, v.z);
      l = {
        geo: mirror(r.geo, 'x'),
        wrist: mx(r.wrist),
        axis: mx(r.axis),
        dorsal: mx(r.dorsal),
        landmarks: {
          wrist: mx(r.landmarks.wrist),
          mcp: r.landmarks.mcp.map(mx),
          tip: r.landmarks.tip.map(mx),
          thumbTip: mx(r.landmarks.thumbTip),
          fingers: mx(r.landmarks.fingers),
          thumb: mx(r.landmarks.thumb),
          palm: mx(r.landmarks.palm),
        },
        chirality: -r.chirality,
        triangles: r.triangles,
      };
      this.gripCache.set(`${key}:L`, l);
    }
    return { r, l };
  }

  private mount(h: HandGeo, name: string): Hand {
    const mesh = this.add(new THREE.Mesh(h.geo, this.armour), name);
    // The asset's own landmarks, on the object that carries it. A capture probe
    // then reads which way THIS mesh is facing off the mesh, rather than
    // re-deriving the hand's geometry from constants and measuring a quantity
    // the renderer never saw — which is how a measured "palm hidden" and a
    // player looking at his own palm coexisted for three rounds.
    mesh.userData.hand = { landmarks: h.landmarks, dorsalTh: HAND_DORSAL_TH, chirality: h.chirality };
    return { mesh, wrist: h.wrist.clone(), axis: h.axis.clone(), dorsal: h.dorsal.clone() };
  }

  /**
   * Re-close the gauntlets round the haft now held. The section comes from
   * `Gear.gripSection`, which the haft prisms are built from too, so the lames
   * close on the surface that is actually drawn.
   */
  private ensureGrip(def: WeaponDef): void {
    const section = gripSection(def);
    const key = `${Math.round(section.x * 1e4)}x${Math.round(section.z * 1e4)}`;
    if (key === this.gripKey) return;
    this.gripKey = key;
    const pair = this.handPair(key, section);
    for (const [hand, geo] of [[this.rHand, pair.r], [this.lHand, pair.l]] as const) {
      hand.mesh.geometry = geo.geo;
      hand.wrist.copy(geo.wrist);
      hand.axis.copy(geo.axis);
      hand.dorsal.copy(geo.dorsal);
    }
  }

  /** Re-dress a material for an armour material key: tint, finish and maps. */
  private dress(m: THREE.MeshStandardMaterial, key: string): void {
    const look = ARMOUR_LOOK[key] ?? ARMOUR_LOOK.iron;
    m.color.setHex(look.color);
    m.roughness = Math.min(1, look.rough * 1.6);
    const conductor = look.metal > 0.5;
    m.metalness = conductor ? Viewmodel.PLATE_METAL : Math.min(1, look.metal * 1.25);
    if (conductor) m.roughness = look.rough;
    m.envMapIntensity = conductor ? PLATE_ENV : 1;
    if (this.mats === null) return;
    try {
      const set = this.mats.get(ARMOUR_SET[key] ?? 'iron');
      m.map = set.albedo;
      m.normalMap = set.normal;
      m.roughnessMap = set.arm;
      m.needsUpdate = true;
    } catch {
      // A set this build does not synthesize leaves the tint doing the work,
      // which is a duller vambrace and not a broken one.
    }
  }

  /** Re-read the equipped gear. Cheap enough to call on every equip. */
  refresh(rpg: System | undefined): void {
    this.look = readArmLook(rpg);
    this.dress(this.plateMat, this.look.bare ? 'leather' : this.look.plate);
  }

  /** The material set a shield of this definition should be dressed in. */
  setShield(def: ShieldDef): void {
    this.dress(this.shieldMat, def.material);
  }

  /**
   * Idle motion, published on `offset` in aim space. The caller adds it to the
   * hand anchor BEFORE the swing is posed, so the swept hit test moves with the
   * hand rather than against it.
   */
  step(dt: number, yaw: number, pitch: number, speed: number, grounded: boolean, fallSpeed: number): void {
    this.breathe += dt;

    const moving = grounded ? clamp(speed / 4.2, 0, 1.25) : 0;
    this.bobPhase += dt * (2.4 + speed * 0.75);
    if (this.bobPhase > Math.PI * 2) this.bobPhase -= Math.PI * 2;
    const bobX = Math.sin(this.bobPhase) * 0.011 * moving;
    const bobY = Math.sin(this.bobPhase * 2) * 0.008 * moving;

    const br = 1 - moving * 0.6;
    const breatheY = Math.sin(this.breathe * 1.15) * 0.0055 * br;
    const breatheX = Math.sin(this.breathe * 0.57) * 0.004 * br;

    // Turn lag: the hand trails the head. The one motion a player reads as "the
    // arms have weight", and the only one worth a spring.
    let dYaw = yaw - this.lastYaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const dPitch = pitch - this.lastPitch;
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    const kick = 1 / Math.max(dt, 1e-3);
    this.swayVel.x += clamp(dYaw * 0.9, -0.06, 0.06) * kick * dt;
    this.swayVel.y += clamp(dPitch * 0.55, -0.05, 0.05) * kick * dt;
    this.swayVel.x -= (this.sway.x * 90 + this.swayVel.x * 17) * dt;
    this.swayVel.y -= (this.sway.y * 90 + this.swayVel.y * 17) * dt;
    this.sway.x = clamp(this.sway.x + this.swayVel.x * dt, -0.028, 0.028);
    this.sway.y = clamp(this.sway.y + this.swayVel.y * dt, -0.026, 0.026);

    if (grounded && !this.wasGrounded) {
      // SET, never accumulate: `grounded` chatters for a frame or two on a
      // slope, and a kick per transition compounds into a hand drop.
      this.landVel = Math.min(this.landVel, -clamp(Math.abs(fallSpeed) * 0.009, 0.008, 0.075));
    }
    this.wasGrounded = grounded;
    this.landVel -= (this.landDip * 90 + this.landVel * 13) * dt;
    this.landDip = clamp(this.landDip + this.landVel * dt, -0.05, 0.02);

    this.offset.set(bobX + breatheX + this.sway.x, bobY + breatheY + this.sway.y + this.landDip, 0);
  }

  /** Pose everything. Called after the weapon has been posed for the frame. */
  update(f: ViewmodelFrame): void {
    const twoHanded = f.weapon.twoHanded;
    const unarmed = f.weapon.cls === 'handtohand';
    const bow = f.weapon.cls === 'marksman';
    const hasShield = !twoHanded && !bow && f.shield.id !== 'none' && f.shield.id !== 'parry';
    if (!unarmed) this.ensureGrip(f.weapon);

    const rHand = unarmed ? this.rFist : this.rHand;
    this.rHand.mesh.visible = !unarmed;
    this.rFist.mesh.visible = unarmed;

    const lHand = unarmed || (!twoHanded && !hasShield && !bow)
      ? this.lFist
      : (hasShield ? this.lStrap : this.lHand);
    this.lHand.mesh.visible = lHand === this.lHand;
    this.lFist.mesh.visible = lHand === this.lFist;
    this.lStrap.mesh.visible = lHand === this.lStrap;
    this.shield.visible = hasShield;

    // --- right hand: welded to the weapon anchor, with OUR roll, not its own.
    //
    // Not AT the anchor, though: GRIP_SHOW down the haft from it. The gauntlet
    // spans 11.8 cm along the grip and a one-handed hilt is 10.8 cm, so a hand
    // planted on the anchor swallows the haft whole — crossguard flush on the
    // knuckles, pommel flush under the heel, and no hilt anywhere between them.
    // That is the "the hilt simply disappears" the last review reported: the
    // eye never sees the weapon go INTO the hand, so it reads the two as
    // adjacent rather than as a grip. Dropped, a segment of bare grip stands
    // clear above the index knuckle with the thumb lame crossing it, and the
    // pommel comes out from under the little finger with a gap of its own.
    const grip = gripOffset(f.weapon);
    _v0.set(0, 1, 0).applyQuaternion(f.handQuat).normalize();
    const anchor = _anchor.copy(f.handPos).addScaledVector(_v0, unarmed ? 0 : -grip.along);
    rHand.mesh.position.copy(anchor);
    this.poseHand(f, _v0, rHand.mesh.quaternion);
    if (unarmed) this.poseFist(f, rHand);

    // --- left hand.
    if (twoHanded) {
      _v1.set(0, 0.17, 0).applyQuaternion(rHand.mesh.quaternion).add(anchor);
      lHand.mesh.position.copy(_v1);
      this.poseHand(f, _v0, lHand.mesh.quaternion);
    } else if (bow) {
      // The bow is held in the left hand at its own anchor; the right draws the
      // string back toward the cheek, so the two hands swap roles.
      lHand.mesh.position.copy(f.handPos);
      this.poseHand(f, _v0, lHand.mesh.quaternion);
      rHand.mesh.position
        .copy(f.handPos)
        .addScaledVector(f.forward, -(0.20 + 0.16 * f.draw))
        .addScaledVector(f.right, 0.13)
        .addScaledVector(f.up, -0.03);
    } else if (hasShield) {
      this.poseShield(f, lHand);
    } else {
      // Empty off hand: a loose fist carried low, brought up to cover the face
      // when guarding — deliberately off the right hand's beat, because two
      // mirrored hands breathing in phase is the loudest bind-pose tell there is.
      const off = Math.sin(this.breathe * 0.93 + 1.9) * (1 - f.guard * 0.7);
      const tuck = f.swinging ? 0.04 : 0;
      // Carried where the frame can hold ALL of it. At (-0.30, -0.325, 0.55)
      // this projected to y = -0.93 in half-screens, which put the bottom half
      // of the fist under the frame edge: a sliver of knuckle lame at the
      // bottom-left that reads as a clipping bug rather than as a hand. Raised
      // again to match the weapon hand, which also came up: the pair has to sit
      // on the same line or the unarmed stance looks lopsided. It now anchors
      // at (-0.42, -0.53) with the cuff lip still clear of the bottom edge.
      lHand.mesh.position.copy(f.origin)
        .addScaledVector(f.right, -0.27 + f.guard * 0.07 + tuck + off * 0.006)
        .addScaledVector(f.up, -0.185 + f.guard * 0.17 + off * 0.009)
        .addScaledVector(f.forward, 0.54 - f.guard * 0.12 - off * 0.005);
      _v1.copy(f.up).multiplyScalar(0.66).addScaledVector(f.forward, 0.52)
        .addScaledVector(f.right, -0.26 + f.guard * 0.22).normalize();
      this.poseHand(f, _v1, lHand.mesh.quaternion, FIST_TWIST);
    }

    // --- and NOW the weapon, placed into the hand that is holding it.
    //
    // The hand was posed above from the camera and the arc; the weapon is
    // whatever that hand's grip offset says. `Combat` draws it here, so there
    // is no second opinion about where the hilt is. See `gripOffset`: `along`
    // is the same slide the hand was placed by, so this lands back on the
    // swing's own hilt with the swing's own axis, and only the roll about that
    // axis is new.
    this.weaponHeld = grip.gripped && !unarmed;
    if (this.weaponHeld) {
      this.weaponQuat.copy(rHand.mesh.quaternion)
        .multiply(_q2.setFromAxisAngle(GRIP_AXIS, grip.roll));
      this.weaponPos.copy(rHand.mesh.position)
        .addScaledVector(_v1.set(0, 1, 0).applyQuaternion(rHand.mesh.quaternion), grip.along);
    }

    this.armFor(f, 0, rHand, this.rVamb, this.rUpper);
    this.armFor(f, 1, lHand, this.lVamb, this.lUpper);
  }

  /**
   * The camera's own basis as a ROTATION: canonical hand space -> world.
   *
   * `makeBasis(right, up, -forward)`, never `(right, up, forward)`. The second
   * is what the aim basis literally is and it is left handed — its determinant
   * is -1 — so `setFromRotationMatrix` on it returns the rotation part of a
   * REFLECTION, i.e. a right hand drawn as a left one. Half the sign errors
   * this rebuild replaces came in through that door.
   */
  private aimQuat(f: ViewmodelFrame, out: THREE.Quaternion): THREE.Quaternion {
    _v3.copy(f.forward).negate();
    _m1.makeBasis(f.right, f.up, _v3);
    return out.setFromRotationMatrix(_m1);
  }

  /**
   * THE ONE PLACE A HAND IS ORIENTED. Three factors, in this order:
   *
   *   world  =  transport(rest blade -> this frame's blade)  .  camera basis  .  HAND_REST
   *
   * `HAND_REST` is a constant: the hand's attitude relative to the LENS, which
   * is where a viewmodel's orientation belongs. The camera basis carries it into
   * the world. The transport is the swing, and it moves the whole rig — hand,
   * weapon and all — as one rigid body, so an arc can change where the hand is
   * and which way the blade points but can never change which face of the hand
   * the player is looking at. There is no roll solved from anything, no
   * reference to `WRIST_AXIS`, and no mirroring by side: the left hand is the
   * same asset mirrored in X and takes the same quaternion.
   *
   * `twist` turns the hand about its own grip axis, in wrap-angle units, and is
   * the only per-pose freedom. Zero shows the lens the wrap angle
   * `HAND_DORSAL_TH + HAND_TWIST`.
   */
  private poseHand(f: ViewmodelFrame, blade: THREE.Vector3, out: THREE.Quaternion,
    twist = 0): void {
    this.aimQuat(f, _q0);
    _v2.copy(REST_BLADE_CAM).applyQuaternion(_q0);
    _q1.setFromUnitVectors(_v2, blade);
    out.copy(_q1).multiply(_q0).multiply(HAND_REST);
    if (twist !== 0) out.multiply(_q2.setFromAxisAngle(GRIP_AXIS, twist));
  }

  /**
   * Re-aim an already-posed right hand as a FIST rather than as a grip.
   *
   * The turn is expressed as a fixed rotation from the rest blade onto
   * `FIST_AXIS` and then applied to whatever the arc is doing this frame, so a
   * punch still travels along its arc and still lands where the swept test
   * says it does — only the hand's own attitude changes.
   */
  private poseFist(f: ViewmodelFrame, hand: Hand): void {
    _v1.set(0, 0, 0)
      .addScaledVector(f.right, REST_BLADE.x)
      .addScaledVector(f.up, REST_BLADE.y)
      .addScaledVector(f.forward, REST_BLADE.z)
      .normalize();
    _fistDir.set(0, 0, 0)
      .addScaledVector(f.right, FIST_AXIS.x)
      .addScaledVector(f.up, FIST_AXIS.y)
      .addScaledVector(f.forward, FIST_AXIS.z)
      .normalize();
    _q3.setFromUnitVectors(_v1, _fistDir);
    _fistDir.set(0, 1, 0).applyQuaternion(f.handQuat).normalize().applyQuaternion(_q3);
    this.poseHand(f, _fistDir, hand.mesh.quaternion, FIST_TWIST);
  }

  /**
   * The arm behind a posed gauntlet. The elbow direction is a CONSTANT in aim
   * space, blended halfway toward the hand's own wrist axis so it follows a
   * swing, then clamped — unconditionally, and last — below, behind and outboard
   * of the wrist. The vambrace is rigid, aimed from the wrist at that elbow; the
   * cuff is a bell wide enough to swallow whatever the clamp left behind.
   */
  private armFor(f: ViewmodelFrame, side: number, hand: Hand, vamb: THREE.Mesh, upper: THREE.Mesh): void {
    const s = side === 0 ? 1 : -1;
    _wrist.copy(hand.wrist).applyQuaternion(hand.mesh.quaternion).add(hand.mesh.position);
    _v1.copy(hand.axis).applyQuaternion(hand.mesh.quaternion).normalize();
    _v0.set(0, 0, 0)
      .addScaledVector(f.right, REST_ELBOW.x * s)
      .addScaledVector(f.up, REST_ELBOW.y)
      .addScaledVector(f.forward, REST_ELBOW.z)
      .lerp(_v1, ELBOW_FOLLOW);
    if (_v0.lengthSq() < 1e-6) _v0.copy(_v1);
    _v0.normalize();

    // THE CLAMP. Nothing after this line may move the elbow. An elbow above the
    // wrist is a broken arm; an elbow in front of it is a broken arm seen from
    // the side; an elbow across the body is a dislocated shoulder.
    let u = _v0.dot(f.right);
    let v = _v0.dot(f.up);
    let w = _v0.dot(f.forward);
    if (v > -ELBOW_MIN_DOWN) v = -ELBOW_MIN_DOWN;
    if (w > -ELBOW_MIN_BACK) w = -ELBOW_MIN_BACK;
    if (u * s < ELBOW_MIN_OUT) u = ELBOW_MIN_OUT * s;
    _v0.set(0, 0, 0).addScaledVector(f.right, u).addScaledVector(f.up, v)
      .addScaledVector(f.forward, w).normalize();

    // THE WRIST. The clamp above is a framing rule and knows nothing about the
    // hand; the cuff is welded to the hand and the vambrace to the elbow, so
    // the two can and did end up pointing opposite ways — a chop drives the
    // blade DOWN, which turns the gauntlet's wrist axis UP, while the clamp
    // holds the elbow below the wrist regardless. The capture of that frame is
    // the review's "the forearm is an open-ended tube": the cuff's bore turned
    // at the lens with the vambrace nowhere near it, and every plate on the arm
    // read as detached. The unarmed guard did the same thing standing still.
    //
    // A wrist bends about 60 degrees and no further. Rotating the elbow
    // direction back toward the hand's own axis until it is inside that cone
    // costs the framing nothing in any pose that was already legal, and makes
    // the divergent ones anatomically possible instead of impossible.
    const cosw = clamp(_v0.dot(_v1), -1, 1);
    const over = Math.acos(cosw) - WRIST_MAX;
    if (over > 0) {
      _v2.crossVectors(_v0, _v1);
      if (_v2.lengthSq() > 1e-8) _v0.applyAxisAngle(_v2.normalize(), over).normalize();
      else _v0.copy(_v1);
    }
    _elbow.copy(_wrist).addScaledVector(_v0, FORE);

    // The vambrace's own +Z is the back of the forearm, taken from the back of
    // the hand so the plate on the arm continues the plate on the hand.
    _v3.copy(hand.dorsal).applyQuaternion(hand.mesh.quaternion).normalize();
    frameOf(_v0, _v3, _m0);
    // Seated WRIST_LAP up the forearm from the wrist joint, not on it. The
    // vambrace is aimed at a clamped elbow and the gauntlet at the weapon, so
    // the two axes disagree by design; a cuff that starts exactly at the joint
    // therefore leaves a wedge of daylight on the outboard side of the wrist,
    // and the last review saw sky through it and read the hand as detached. A
    // centimetre and a half of overlap closes the seam across the whole pose
    // range, and the cuff's bell is wide enough that nothing intersects.
    vamb.position.copy(_wrist).addScaledVector(_v0, -WRIST_LAP);
    vamb.quaternion.setFromRotationMatrix(_m0);

    // The sleeve hangs off the elbow and points at the shoulder, at a fixed
    // length: it only has to leave the frame, and a scaled one collapses.
    this.armRoot(f, s, hand.mesh.position, _v1);
    _v2.subVectors(_v1, _elbow);
    if (_v2.lengthSq() < 1e-6) _v2.copy(f.up).negate();
    upper.position.copy(_elbow);
    upper.quaternion.setFromUnitVectors(_up, _v2.normalize());
  }

  /**
   * Where the arm leaves the frame. Not an anatomical shoulder: below the bottom
   * edge and AHEAD of the eye, because a shoulder behind the lens is 80 cm from
   * a hand a 56 cm arm has to reach.
   */
  private armRoot(f: ViewmodelFrame, side: number, hand: THREE.Vector3, out: THREE.Vector3): void {
    _g0.subVectors(hand, f.origin);
    // The root used to sit 0.36-0.9 m AHEAD of the eye so a 56 cm arm could reach
    // the hand. That put the forearm almost parallel to the view direction, which
    // foreshortens it into a featureless cone and hides the hand behind the wrist
    // — eight review rounds blamed the geometry for what was purely this pose.
    // Pull the root out to the side and back toward the lens so the forearm
    // crosses the lower-right of frame diagonally and the hand reads clearly.
    // The upper arm simply leaves frame, which is what it does in every
    // first-person game; nobody sees the shoulder.
    //
    // It is still not far enough out. At (0.46, -0.40, 0.02) the root sat
    // almost exactly behind the elbow — elbow minus root came out as
    // (0.01, 0.02, 0.57), i.e. 57 cm of upper arm pointing DOWN THE LENS and
    // 2 cm of it across the screen. That is a cone, and a cone is what the last
    // review called a pipe. Out to 0.62 and down to 0.74 and the same vector is
    // (-0.10, 0.37, 0.26): the upper arm now leaves the elbow across and down,
    // so what little of it the frame catches has a direction.
    const lead = clamp(_g0.dot(f.forward) - 0.72, -0.16, 0.9) * 0.30;
    out.copy(f.origin)
      .addScaledVector(f.right, 0.62 * side)
      .addScaledVector(f.up, -0.74)
      .addScaledVector(f.forward, 0.30 + lead);
  }

  /** The shield: a relaxed carry at the hip, a real guard in front of the face. */
  private poseShield(f: ViewmodelFrame, hand: Hand): void {
    const g = f.guard;
    _v0.copy(f.origin)
      .addScaledVector(f.right, -0.40 + g * 0.06)
      .addScaledVector(f.up, -0.36 + g * 0.30)
      .addScaledVector(f.forward, 0.45 + g * 0.06);

    _fwd.copy(f.forward)
      .multiplyScalar(0.35 + g * 0.6)
      .addScaledVector(f.right, -0.55 + g * 0.25)
      .addScaledVector(f.up, -0.5 + g * 0.42)
      .normalize();
    _v1.copy(f.up).addScaledVector(_fwd, -f.up.dot(_fwd));
    if (_v1.lengthSq() < 1e-6) _v1.copy(f.right);
    _v1.normalize();
    _v2.crossVectors(_v1, _fwd).normalize();
    _m0.makeBasis(_v2, _v1, _fwd);
    _q0.setFromRotationMatrix(_m0);
    this.shield.position.copy(_v0);
    this.shield.quaternion.copy(_q0);

    // The hand is placed off the shield, never the other way round. It grips the
    // lower enarme, which runs ACROSS the shield, so the grip axis is the
    // shield's own X, and the three offsets below are the enarme's local origin.
    hand.mesh.position
      .copy(_v0)
      .addScaledVector(_v2, 0.050)
      .addScaledVector(_v1, -0.07)
      .addScaledVector(_fwd, 0.050);
    this.poseHand(f, _v0.copy(_v2).negate(), hand.mesh.quaternion);
  }

  set visible(v: boolean) { this.group.visible = v; }
  get visible(): boolean { return this.group.visible; }

  /** Triangle count, for the budget report. */
  get triangles(): number {
    let n = 0;
    for (const g of this.geos) {
      const i = g.getIndex();
      n += i === null ? 0 : i.count / 3;
    }
    for (const h of this.gripCache.values()) n += h.triangles;
    return n;
  }

  /** Triangles actually submitted this frame, which is the number that costs. */
  get drawnTriangles(): number {
    let n = 0;
    this.group.traverseVisible((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const i = o.geometry.getIndex();
      n += i === null ? 0 : i.count / 3;
    });
    return n;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    this.geos.length = 0;
    for (const h of this.gripCache.values()) h.geo.dispose();
    this.gripCache.clear();
    for (const m of this.materials) m.dispose();
    this.materials.length = 0;
    this.group.removeFromParent();
    this.group.clear();
  }
}
