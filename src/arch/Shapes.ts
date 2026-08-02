import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noise2 } from './Rng';

/**
 * Procedural mesh toolkit for Dunmer architecture.
 *
 * The centrepiece is `buildShell`: a parametric surface with REAL openings cut
 * through it. A textured blob reads as a prop; a wall with a doorway you can
 * see darkness through reads as a building, and that difference is the whole
 * reason this module exists rather than a pile of lathes.
 *
 * Everything is authored in building-local space with y=0 at the foundation
 * pad, because the weathering shader keys ash accumulation off local height.
 */

const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _e0 = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _c = new THREE.Vector3();

/** Accumulates triangles into position/normal/uv streams. */
export class MeshBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uvs: number[] = [];
  readonly sw: number[] = [];
  readonly th: number[] = [];
  readonly li: number[] = [];

  /**
   * Per-vertex wind-sway weight written into `aSway`. Set it (or `swayOf`)
   * before emitting cloth; everything else leaves it at zero and is rigid.
   */
  sway = 0;
  swayOf: ((p: THREE.Vector3) => number) | null = null;

  /**
   * Half-thickness of the feature being emitted, in metres, written to `aThick`.
   *
   * Only emissive geometry reads it, and only to answer one question: how much
   * of a pixel does this actually cover? A 40 cm glowing tube on a landmark is
   * a tenth of a pixel at a kilometre, and a rasteriser that fills a whole pixel
   * with it at full radiance is reporting ten times the light there is. Zero
   * means "not a thin feature" and disables the correction.
   */
  thick = 0;

  /**
   * Per-vertex emissive scale written into `aLit`, read only by the glow
   * material. 1 is "as authored".
   *
   * It exists because every lit aperture in a settlement was the same
   * brightness: one uniform value for every window on every structure, which is
   * what makes a hundred openings read as a repeated decal rather than as a
   * hundred rooms with people in some of them. Per-PANEL rather than per-vertex
   * variation is the point — the whole quad shares one value — so a randomised
   * subset can be warm and occupied while the rest sit at a dim ember floor.
   */
  lit = 1;

  get triangles(): number {
    return this.pos.length / 9;
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  tri(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    na?: THREE.Vector3,
    nb?: THREE.Vector3,
    nc?: THREE.Vector3,
  ): void {
    let x0 = 0;
    let y0 = 0;
    let z0 = 0;
    if (na === undefined || nb === undefined || nc === undefined) {
      _e0.subVectors(b, a);
      _e1.subVectors(c, a);
      _n.crossVectors(_e0, _e1);
      const l = _n.length();
      if (l < 1e-12) return; // degenerate; emitting it only costs a NaN normal
      _n.multiplyScalar(1 / l);
      x0 = _n.x;
      y0 = _n.y;
      z0 = _n.z;
    }
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    if (na !== undefined && nb !== undefined && nc !== undefined) {
      this.nrm.push(na.x, na.y, na.z, nb.x, nb.y, nb.z, nc.x, nc.y, nc.z);
    } else {
      this.nrm.push(x0, y0, z0, x0, y0, z0, x0, y0, z0);
    }
    this.uvs.push(0, 0, 1, 0, 1, 1);
    const f = this.swayOf;
    if (f === null) this.sw.push(this.sway, this.sway, this.sway);
    else this.sw.push(f(a), f(b), f(c));
    this.th.push(this.thick, this.thick, this.thick);
    this.li.push(this.lit, this.lit, this.lit);
  }

  quad(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    na?: THREE.Vector3,
    nb?: THREE.Vector3,
    nc?: THREE.Vector3,
    nd?: THREE.Vector3,
  ): void {
    this.tri(a, b, c, na, nb, nc);
    this.tri(a, c, d, na, nc, nd);
  }

  /**
   * Emit a quad whose winding is chosen so the face normal points toward
   * `toward`. Reveal tubes and recess side walls have eight distinct edge
   * cases; solving them by construction is error-prone and solving them by
   * measurement costs one dot product.
   */
  quadFacing(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    toward: THREE.Vector3,
  ): void {
    _e0.subVectors(b, a);
    _e1.subVectors(c, a);
    _n.crossVectors(_e0, _e1);
    _c.copy(a).add(b).add(c).add(d).multiplyScalar(0.25);
    _u.subVectors(toward, _c);
    if (_n.dot(_u) >= 0) this.quad(a, b, c, d);
    else this.quad(a, d, c, b);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sw, 1));
    g.setAttribute('aThick', new THREE.Float32BufferAttribute(this.th, 1));
    g.setAttribute('aLit', new THREE.Float32BufferAttribute(this.li, 1));
    return g;
  }
}

// ---------------------------------------------------------------- shell

/** An opening in shell cell-index space. `u` wraps; `v` runs bottom to top. */
export interface Opening {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** Round the head of the opening into an arch. Dunmer doors are never square. */
  arch?: boolean;
  /** >0 makes a blind recessed panel of this depth instead of a through-hole. */
  recess?: number;
}

export interface HoleFrame {
  /** Outer-surface centre of the opening. */
  center: THREE.Vector3;
  /** Outward surface normal at the centre. */
  normal: THREE.Vector3;
  /** Tangent along the opening's width. */
  right: THREE.Vector3;
  up: THREE.Vector3;
  width: number;
  height: number;
  /**
   * Head and threshold, sampled ON the surface with their own normals. A sill
   * placed at centre + up*h/2 floats off a curved wall; these do not.
   */
  top: THREE.Vector3;
  bottom: THREE.Vector3;
  topNormal: THREE.Vector3;
  bottomNormal: THREE.Vector3;
  /** True for through-holes (door/window), false for blind panels. */
  through: boolean;
}

export interface ShellSpec {
  nu: number;
  nv: number;
  /** Outer surface. `u` is periodic on [0,1]; `v` runs 0 (base) to 1 (apex). */
  surface: (u: number, v: number, out: THREE.Vector3) => void;
  /** Wall thickness in metres — the depth of every reveal and sill. */
  thickness: number;
  openings?: readonly Opening[];
  /** Facet the surface. Basalt towers want it; plaster domes do not. */
  flat?: boolean;
  /** Remove cells outright: collapse, breaches, ruined parapets. */
  erode?: (i: number, j: number, u: number, v: number) => boolean;
  /**
   * Cap the interior at v=0. Without it a doorway looks through the building
   * into an unlit void with no threshold, which reads as a hole cut in a card
   * rather than as a room.
   */
  floor?: boolean;
}

export interface ShellResult {
  /** Exterior surface. */
  outer: THREE.BufferGeometry | null;
  /** Interior surface, normals flipped — this is what makes a doorway dark. */
  inner: THREE.BufferGeometry | null;
  /** Reveals, jambs and recessed panel walls. */
  reveal: THREE.BufferGeometry | null;
  holes: HoleFrame[];
}

const CELL_SOLID = 0;
const CELL_HOLE = 1;
const CELL_RECESS = 2;
const CELL_GONE = 3;

/**
 * Build a closed shell with genuine openings.
 *
 * The surface is sampled on an (nu+1)x(nv+1) grid; the inner surface is the
 * outer one offset along its own normal by `thickness`. Cells covered by an
 * opening are dropped from both surfaces and replaced by a reveal tube joining
 * the two rims, so a doorway has real jambs, a real head and a real threshold,
 * and the interior shell behind it is what the eye reads as darkness.
 */
export function buildShell(spec: ShellSpec): ShellResult {
  const { nu, nv, surface, thickness } = spec;
  const gw = nu + 1;
  const gh = nv + 1;
  const P = new Float32Array(gw * gh * 3);
  const N = new Float32Array(gw * gh * 3);
  const Q = new Float32Array(gw * gh * 3);

  const tmp = new THREE.Vector3();
  const du = new THREE.Vector3();
  const dv = new THREE.Vector3();
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const eu = 0.5 / nu;
  const ev = 0.5 / nv;

  for (let j = 0; j < gh; j++) {
    const v = j / nv;
    for (let i = 0; i < gw; i++) {
      const u = i / nu;
      const k = (j * gw + i) * 3;
      surface(u, v, tmp);
      P[k] = tmp.x;
      P[k + 1] = tmp.y;
      P[k + 2] = tmp.z;

      // Central differences give an analytic normal that is exact for the
      // smooth revolves and still sane across the faceted prisms, where the
      // per-face normal is recomputed anyway when `flat` is set.
      surface(u - eu, v, p0);
      surface(u + eu, v, p1);
      du.subVectors(p1, p0);
      surface(u, Math.max(0, v - ev), p0);
      surface(u, Math.min(1, v + ev), p1);
      dv.subVectors(p1, p0);
      tmp.crossVectors(dv, du);
      if (tmp.lengthSq() < 1e-16) tmp.set(0, 1, 0);
      else tmp.normalize();
      N[k] = tmp.x;
      N[k + 1] = tmp.y;
      N[k + 2] = tmp.z;
      Q[k] = P[k] - tmp.x * thickness;
      Q[k + 1] = P[k + 1] - tmp.y * thickness;
      Q[k + 2] = P[k + 2] - tmp.z * thickness;
    }
  }

  // ---- cell classification ------------------------------------------------
  const state = new Uint8Array(nu * nv);
  const depth = new Float32Array(nu * nv);
  const openings = spec.openings ?? [];
  const pAt = (i: number, j: number, o: THREE.Vector3): THREE.Vector3 => {
    const k = ((Math.max(0, Math.min(nv, j)) * gw + (((i % nu) + nu) % nu)) * 3) | 0;
    return o.set(P[k], P[k + 1], P[k + 2]);
  };
  /**
   * Arch height in CELLS, derived from the local world metric. A cell is a few
   * times wider than it is tall on most of these shells, so a head sized in
   * cells alone comes out as a flat lozenge; sizing it against the real chord
   * is what produces the tall Velothi arch.
   */
  const archCells = (o: Opening, cols: number, rows: number): number => {
    if (o.arch !== true) return 0;
    const ui = (o.u0 + o.u1) >> 1;
    const vj = Math.max(0, Math.min(nv - 1, (o.v0 + o.v1) >> 1));
    const a = pAt(ui, vj, tmp);
    const uCell = a.distanceTo(pAt(ui + 1, vj, p0));
    const vCell = pAt(ui, vj, p1).distanceTo(pAt(ui, vj + 1, p0));
    return Math.min(rows * 0.82, (cols * uCell * 0.60) / Math.max(vCell, 1e-3));
  };
  for (const o of openings) {
    const cols = o.u1 - o.u0;
    const rows = o.v1 - o.v0;
    if (cols <= 0 || rows <= 0) continue;
    const archH = archCells(o, cols, rows);
    const straight = rows - archH;
    for (let jj = 0; jj < rows; jj++) {
      const jv = jj + 0.5;
      for (let ii = 0; ii < cols; ii++) {
        if (jv > straight) {
          // Elliptical head: the classic Velothi pointed-round doorway.
          const dx = (ii + 0.5 - cols * 0.5) / (cols * 0.5);
          const dy = (jv - straight) / Math.max(archH, 1e-4);
          if (dx * dx + dy * dy > 1) continue;
        }
        const i = ((o.u0 + ii) % nu + nu) % nu;
        const j = o.v0 + jj;
        if (j < 0 || j >= nv) continue;
        const c = j * nu + i;
        if (o.recess !== undefined && o.recess > 0) {
          state[c] = CELL_RECESS;
          depth[c] = o.recess;
        } else {
          state[c] = CELL_HOLE;
        }
      }
    }
  }
  if (spec.erode) {
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        if (spec.erode(i, j, (i + 0.5) / nu, (j + 0.5) / nv)) state[j * nu + i] = CELL_GONE;
      }
    }
  }

  // ---- emit ---------------------------------------------------------------
  const outer = new MeshBuilder();
  const inner = new MeshBuilder();
  const reveal = new MeshBuilder();

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c2 = new THREE.Vector3();
  const d = new THREE.Vector3();
  const na = new THREE.Vector3();
  const nb = new THREE.Vector3();
  const nc = new THREE.Vector3();
  const nd = new THREE.Vector3();
  const centre = new THREE.Vector3();

  const readP = (i: number, j: number, out: THREE.Vector3): THREE.Vector3 => {
    const k = (j * gw + i) * 3;
    return out.set(P[k], P[k + 1], P[k + 2]);
  };
  const readQ = (i: number, j: number, out: THREE.Vector3): THREE.Vector3 => {
    const k = (j * gw + i) * 3;
    return out.set(Q[k], Q[k + 1], Q[k + 2]);
  };
  const readN = (i: number, j: number, out: THREE.Vector3): THREE.Vector3 => {
    const k = (j * gw + i) * 3;
    return out.set(N[k], N[k + 1], N[k + 2]);
  };
  const at = (i: number, j: number): number => {
    if (j < 0 || j >= nv) return CELL_GONE;
    const ii = ((i % nu) + nu) % nu;
    return state[j * nu + ii];
  };

  const flat = spec.flat === true;

  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const s = state[j * nu + i];
      if (s === CELL_GONE) continue;

      const off = s === CELL_RECESS ? depth[j * nu + i] : 0;
      if (s !== CELL_HOLE) {
        readP(i, j, a);
        readP(i, j + 1, b);
        readP(i + 1, j + 1, c2);
        readP(i + 1, j, d);
        readN(i, j, na);
        readN(i, j + 1, nb);
        readN(i + 1, j + 1, nc);
        readN(i + 1, j, nd);
        if (off > 0) {
          a.addScaledVector(na, -off);
          b.addScaledVector(nb, -off);
          c2.addScaledVector(nc, -off);
          d.addScaledVector(nd, -off);
        }
        if (flat) outer.quad(a, b, c2, d);
        else outer.quad(a, b, c2, d, na, nb, nc, nd);

        // Interior: same cell, reversed winding, normals inward.
        readQ(i, j, a);
        readQ(i + 1, j, b);
        readQ(i + 1, j + 1, c2);
        readQ(i, j + 1, d);
        if (flat) inner.quad(a, b, c2, d);
        else {
          inner.quad(
            a,
            b,
            c2,
            d,
            na.negate(),
            nd.clone().negate(),
            nc.clone().negate(),
            nb.clone().negate(),
          );
        }
      }

      // Reveal / recess walls: one quad per boundary edge with a neighbour that
      // is not part of the same void.
      if (s === CELL_HOLE || s === CELL_RECESS) {
        readP(i, j, centre)
          .add(readP(i + 1, j + 1, a))
          .multiplyScalar(0.5);
        if (s === CELL_RECESS) centre.addScaledVector(readN(i, j, na), -off * 0.5);
        else centre.addScaledVector(readN(i, j, na), -thickness * 0.5);

        const sides: Array<[number, number, number, number]> = [
          [i, j, i, j + 1], // -u edge
          [i + 1, j, i + 1, j + 1], // +u edge
          [i, j, i + 1, j], // -v edge
          [i, j + 1, i + 1, j + 1], // +v edge
        ];
        const nbrs: Array<[number, number]> = [
          [i - 1, j],
          [i + 1, j],
          [i, j - 1],
          [i, j + 1],
        ];
        for (let e = 0; e < 4; e++) {
          const ns = at(nbrs[e][0], nbrs[e][1]);
          if (ns === s) continue; // interior of the same void — no wall here
          if (ns === CELL_GONE && s === CELL_HOLE) continue; // opens onto a breach
          const [ax, ay, bx, by] = sides[e];
          readP(ax, ay, a);
          readP(bx, by, b);
          if (s === CELL_RECESS) {
            readP(bx, by, c2).addScaledVector(readN(bx, by, nb), -off);
            readP(ax, ay, d).addScaledVector(readN(ax, ay, na), -off);
          } else {
            readQ(bx, by, c2);
            readQ(ax, ay, d);
          }
          reveal.quadFacing(a, b, c2, d, centre);
        }
      }
    }
  }

  // ---- interior floor -----------------------------------------------------
  if (spec.floor === true) {
    const c = new THREE.Vector3();
    for (let i = 0; i < nu; i++) c.add(readQ(i, 0, a));
    c.multiplyScalar(1 / nu);
    const sky = new THREE.Vector3(c.x, c.y + 1e4, c.z);
    for (let i = 0; i < nu; i++) {
      readQ(i, 0, a);
      readQ((i + 1) % nu, 0, b);
      inner.quadFacing(c, a, b, b, sky);
    }
  }

  // ---- opening frames, for sills, lintels and window glow -----------------
  const holes: HoleFrame[] = [];
  for (const o of openings) {
    const cols = o.u1 - o.u0;
    const rows = o.v1 - o.v0;
    if (cols <= 0 || rows <= 0) continue;
    const uMid = (o.u0 + o.u1) * 0.5;
    const vMid = (o.v0 + o.v1) * 0.5;
    const centerP = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    sampleGrid(P, gw, nu, nv, uMid, vMid, centerP);
    sampleGrid(N, gw, nu, nv, uMid, vMid, nrm);
    nrm.normalize();
    const rt = new THREE.Vector3();
    const scratch = new THREE.Vector3();
    sampleGrid(P, gw, nu, nv, o.u1, vMid, rt);
    sampleGrid(P, gw, nu, nv, o.u0, vMid, scratch);
    const width = rt.distanceTo(scratch);
    rt.sub(scratch).normalize();

    const top = new THREE.Vector3();
    const bottom = new THREE.Vector3();
    const topNormal = new THREE.Vector3();
    const bottomNormal = new THREE.Vector3();
    sampleGrid(P, gw, nu, nv, uMid, o.v1, top);
    sampleGrid(N, gw, nu, nv, uMid, o.v1, topNormal);
    sampleGrid(P, gw, nu, nv, uMid, o.v0, bottom);
    sampleGrid(N, gw, nu, nv, uMid, o.v0, bottomNormal);
    topNormal.normalize();
    bottomNormal.normalize();
    const height = top.distanceTo(bottom);
    const up = new THREE.Vector3().subVectors(top, bottom).normalize();
    holes.push({
      center: centerP,
      normal: nrm,
      right: rt,
      up,
      width,
      height,
      top,
      bottom,
      topNormal,
      bottomNormal,
      through: !(o.recess !== undefined && o.recess > 0),
    });
  }

  return {
    outer: outer.empty ? null : outer.geometry(),
    inner: inner.empty ? null : inner.geometry(),
    reveal: reveal.empty ? null : reveal.geometry(),
    holes,
  };
}

function sampleGrid(
  src: Float32Array,
  gw: number,
  nu: number,
  nv: number,
  fi: number,
  fj: number,
  out: THREE.Vector3,
): void {
  const i = Math.max(0, Math.min(nu, Math.round(((fi % nu) + nu) % nu)));
  const j = Math.max(0, Math.min(nv, Math.round(fj)));
  const k = (j * gw + i) * 3;
  out.set(src[k], src[k + 1], src[k + 2]);
}

// ---------------------------------------------------------------- weathering

/**
 * Bake the two weathering attributes the architecture shader reads.
 *
 * `aCurv` is a discrete mean-curvature proxy: positive on convex edges, which
 * is where plaster chips and stone bleaches, negative in cavities, which is
 * where dirt and ash collect. `aDrip` measures how far a point sits below the
 * nearest overhanging geometry, which is where rain streaks start.
 *
 * Both are baked once at build time; per-pixel curvature from derivatives is
 * an option but it aliases badly on faceted stone and costs four taps.
 */
export function bakeWeathering(geos: readonly THREE.BufferGeometry[]): void {
  if (geos.length === 0) return;

  // Shared top-down max-height field over all pieces of the structure, so a
  // wall knows about the eave above it even though they are separate meshes.
  const box = new THREE.Box3();
  for (const g of geos) {
    g.computeBoundingBox();
    if (g.boundingBox) box.union(g.boundingBox);
  }
  const GRID = 40;
  const sx = Math.max(box.max.x - box.min.x, 1e-3);
  const sz = Math.max(box.max.z - box.min.z, 1e-3);
  const top = new Float32Array(GRID * GRID).fill(-1e9);
  const cellOf = (x: number, z: number): number => {
    const i = Math.min(GRID - 1, Math.max(0, ((x - box.min.x) / sx) * GRID) | 0);
    const j = Math.min(GRID - 1, Math.max(0, ((z - box.min.z) / sz) * GRID) | 0);
    return j * GRID + i;
  };
  for (const g of geos) {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const c = cellOf(p.getX(i), p.getZ(i));
      const y = p.getY(i);
      if (y > top[c]) top[c] = y;
    }
  }

  for (const g of geos) bakeOne(g, top, box, GRID, sx, sz);
}

function bakeOne(
  g: THREE.BufferGeometry,
  top: Float32Array,
  box: THREE.Box3,
  GRID: number,
  sx: number,
  sz: number,
): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  const n = pos.count;

  // Weld by 1 cm cells. A hash collision merges two unrelated vertices, which
  // costs one slightly wrong curvature sample out of hundreds of thousands.
  const weld = new Int32Array(n);
  const map = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const x = Math.round(pos.getX(i) * 100);
    const y = Math.round(pos.getY(i) * 100);
    const z = Math.round(pos.getZ(i) * 100);
    let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b9);
    h = (Math.imul(h ^ (h >>> 15), 0x2545f491) ^ (h >>> 13)) | 0;
    const hit = map.get(h);
    if (hit === undefined) {
      map.set(h, i);
      weld[i] = i;
    } else {
      weld[i] = hit;
    }
  }

  const avgN = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const w = weld[i] * 3;
    avgN[w] += nrm.getX(i);
    avgN[w + 1] += nrm.getY(i);
    avgN[w + 2] += nrm.getZ(i);
  }
  for (let i = 0; i < n; i++) {
    const w = weld[i] * 3;
    const l = Math.hypot(avgN[w], avgN[w + 1], avgN[w + 2]);
    if (l > 1e-6 && weld[i] === i) {
      avgN[w] /= l;
      avgN[w + 1] /= l;
      avgN[w + 2] /= l;
    }
  }

  const sum = new Float32Array(n);
  const cnt = new Float32Array(n);
  const index = g.index;
  const tris = index ? index.count / 3 : n / 3;
  const idx = (t: number, k: number): number => (index ? index.getX(t * 3 + k) : t * 3 + k);

  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) {
      const ai = idx(t, k);
      const bi = idx(t, (k + 1) % 3);
      const wa = weld[ai];
      const wb = weld[bi];
      if (wa === wb) continue;
      const dx = pos.getX(bi) - pos.getX(ai);
      const dy = pos.getY(bi) - pos.getY(ai);
      const dz = pos.getZ(bi) - pos.getZ(ai);
      const l = Math.hypot(dx, dy, dz);
      if (l < 1e-6) continue;
      const w = wa * 3;
      // Neighbour below the tangent plane => convex edge.
      sum[wa] += -(dx * avgN[w] + dy * avgN[w + 1] + dz * avgN[w + 2]) / l;
      cnt[wa] += 1;
    }
  }

  const curv = new Float32Array(n);
  const drip = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = weld[i];
    curv[i] = cnt[w] > 0 ? Math.max(-1, Math.min(1, (sum[w] / cnt[w]) * 3.2)) : 0;

    const gi = Math.min(GRID - 1, Math.max(0, ((pos.getX(i) - box.min.x) / sx) * GRID) | 0);
    const gj = Math.min(GRID - 1, Math.max(0, ((pos.getZ(i) - box.min.z) / sz) * GRID) | 0);
    const above = top[gj * GRID + gi] - pos.getY(i);
    // Streaks bloom right under a ledge and are gone about three metres down.
    drip[i] = above > 0.35 ? Math.exp(-(above - 0.35) / 2.6) : 0;
  }

  g.setAttribute('aCurv', new THREE.Float32BufferAttribute(curv, 1));
  g.setAttribute('aDrip', new THREE.Float32BufferAttribute(drip, 1));
}

/** Guarantee the weathering attributes exist so the shader never reads garbage. */
export function ensureArchAttributes(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = (g.attributes.position as THREE.BufferAttribute).count;
  if (!g.attributes.aCurv) g.setAttribute('aCurv', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  if (!g.attributes.aDrip) g.setAttribute('aDrip', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  if (!g.attributes.aSway) g.setAttribute('aSway', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  if (!g.attributes.aThick) g.setAttribute('aThick', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  if (!g.attributes.aLit) g.setAttribute('aLit', new THREE.Float32BufferAttribute(new Float32Array(n).fill(1), 1));
  if (!g.attributes.aTint) g.setAttribute('aTint', new THREE.Float32BufferAttribute(new Float32Array(n).fill(0.5), 1));
  if (!g.attributes.aSpill) g.setAttribute('aSpill', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  if (!g.attributes.aBio) g.setAttribute('aBio', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  if (!g.attributes.aAO) g.setAttribute('aAO', new THREE.Float32BufferAttribute(new Float32Array(n).fill(1), 1));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

/**
 * Bake real hemisphere occlusion into `aAO`.
 *
 * Vertex curvature knows about the edge a vertex sits on and nothing else. It
 * cannot see that a recessed panel has four walls standing around it, that a pod
 * is tucked under a cap, or that a shell foot is buried in its own ash drift —
 * so every one of those junctions came out of the bake as bright as open wall,
 * which is the "relief reads as a decal painted on a flat surface" and the "no
 * contact AO, objects pasted onto the slope" the review found in four shots.
 *
 * The method is deliberately the cheap one: voxelise the structure's own
 * triangles into an occupancy grid, then march a short cosine-weighted bundle of
 * rays from every vertex. At a 25 cm voxel and a 2.5 m reach this resolves a
 * door reveal and a panel corner, which is the scale that matters, and it costs
 * a few milliseconds per structure at build time and nothing at all at runtime.
 *
 * `groundAt` is optional and is the other half of ground contact: a vertex a
 * hand's breadth above the terrain is occluded by the terrain whether or not any
 * of this structure's own triangles are near it.
 */
export function bakeAO(
  geos: readonly THREE.BufferGeometry[],
  opts: {
    origin?: THREE.Vector3;
    groundAt?: (x: number, z: number) => number;
    reach?: number;
    /**
     * Height over which the terrain-contact term grades out, metres. Defaults
     * to 2% of the structure's own span, clamped to 0.75-2.5 m.
     */
    contact?: number;
  } = {},
): void {
  if (geos.length === 0) return;

  const box = new THREE.Box3();
  for (const g of geos) {
    g.computeBoundingBox();
    if (g.boundingBox) box.union(g.boundingBox);
  }
  const span = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
  if (!isFinite(span) || span <= 0) return;

  // Voxel size tracks the structure so an urn and a 130 m tower both get a
  // 64-cell grid: the interesting occluders on either are a fortieth of its own
  // size, which is what "a panel reveal" means at any scale.
  const N = 64;
  const cell = span / N;
  const inv = 1 / cell;
  const ox = box.min.x;
  const oy = box.min.y;
  const oz = box.min.z;
  const occ = new Uint8Array(N * N * N);
  const idx = (i: number, j: number, k: number): number => (k * N + j) * N + i;
  const mark = (x: number, y: number, z: number): void => {
    const i = ((x - ox) * inv) | 0;
    const j = ((y - oy) * inv) | 0;
    const k = ((z - oz) * inv) | 0;
    if (i < 0 || j < 0 || k < 0 || i >= N || j >= N || k >= N) return;
    occ[idx(i, j, k)] = 1;
  };

  // Rasterise each triangle by splatting its vertices, edge midpoints and
  // centroid. Exact conservative voxelisation is not worth it here: the grid is
  // an occluder proxy, and a triangle larger than a voxel is a wall, which the
  // vertices of its neighbours fill in anyway.
  const ax = new THREE.Vector3();
  const bx = new THREE.Vector3();
  const cx = new THREE.Vector3();
  for (const g of geos) {
    const p = g.attributes.position as THREE.BufferAttribute;
    const index = g.index;
    const tris = index ? index.count / 3 : p.count / 3;
    for (let t = 0; t < tris; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      ax.set(p.getX(i0), p.getY(i0), p.getZ(i0));
      bx.set(p.getX(i1), p.getY(i1), p.getZ(i1));
      cx.set(p.getX(i2), p.getY(i2), p.getZ(i2));
      mark(ax.x, ax.y, ax.z);
      mark(bx.x, bx.y, bx.z);
      mark(cx.x, cx.y, cx.z);
      // Subdivide long edges so a single big wall quad still fills its voxels.
      for (const [u, v] of [[ax, bx], [bx, cx], [cx, ax]] as const) {
        const len = u.distanceTo(v);
        const steps = Math.min(24, Math.ceil(len * inv));
        for (let s = 1; s < steps; s++) {
          const f = s / steps;
          mark(u.x + (v.x - u.x) * f, u.y + (v.y - u.y) * f, u.z + (v.z - u.z) * f);
        }
      }
      mark((ax.x + bx.x + cx.x) / 3, (ax.y + bx.y + cx.y) / 3, (ax.z + bx.z + cx.z) / 3);
    }
  }

  // A fixed cosine-ish bundle in the tangent frame. Twelve rays is coarse for a
  // lightmap and ample for a per-vertex term that is then interpolated across a
  // triangle and multiplied into indirect only.
  const DIRS: number[][] = [];
  for (let i = 0; i < 12; i++) {
    // Golden-angle spiral over the hemisphere, weighted toward the normal.
    const t = (i + 0.5) / 12;
    const r = Math.sqrt(t);
    const phi = i * 2.399963;
    DIRS.push([r * Math.cos(phi), Math.sqrt(Math.max(0, 1 - t)), r * Math.sin(phi)]);
  }
  const reach = opts.reach ?? Math.max(1.2, Math.min(span * 0.10, 6));
  /**
   * Contact band, scaled to the structure.
   *
   * A fixed 60-75 cm is right for a 4 m dome and is nothing at all on a 110 m
   * tower: on a landmark the terrain-contact darkening finished inside the
   * first metre of a twenty-metre plinth, so the foot terminated in a hard
   * black step with a flat interior instead of grading into the hill — the
   * "shadow-map hole" the review measured at the tower's base. Two per cent of
   * the structure's own span puts the grade at ~2.2 m on a landmark and leaves
   * every house in the settlement exactly where it was.
   */
  const contact = opts.contact ?? Math.max(0.75, Math.min(span * 0.02, 2.5));
  const STEPS = 10;
  const T = new THREE.Vector3();
  const B = new THREE.Vector3();
  const Nv = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const alt = new THREE.Vector3(1, 0, 0);

  for (const g of geos) {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nrm = g.attributes.normal as THREE.BufferAttribute | undefined;
    const n = pos.count;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      if (nrm) Nv.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).normalize();
      else Nv.copy(up);
      T.crossVectors(Math.abs(Nv.y) < 0.92 ? up : alt, Nv);
      if (T.lengthSq() < 1e-8) T.set(1, 0, 0);
      T.normalize();
      B.crossVectors(Nv, T);

      let open = 0;
      for (const d of DIRS) {
        const dx = T.x * d[0] + Nv.x * d[1] + B.x * d[2];
        const dy = T.y * d[0] + Nv.y * d[1] + B.y * d[2];
        const dz = T.z * d[0] + Nv.z * d[1] + B.z * d[2];
        let hit = 0;
        for (let s = 1; s <= STEPS; s++) {
          const f = (s / STEPS) * reach;
          const qx = px + dx * f;
          const qy = py + dy * f;
          const qz = pz + dz * f;
          const gi = ((qx - ox) * inv) | 0;
          const gj = ((qy - oy) * inv) | 0;
          const gk = ((qz - oz) * inv) | 0;
          if (gi < 0 || gj < 0 || gk < 0 || gi >= N || gj >= N || gk >= N) break;
          if (occ[idx(gi, gj, gk)] === 1) {
            // Nearer occluders shadow harder; a wall two metres off is sky.
            hit = 1 - (s - 1) / STEPS;
            break;
          }
        }
        open += 1 - hit;
      }
      let ao = open / DIRS.length;

      // Terrain contact. The heightfield is not in the occupancy grid — it is a
      // different subsystem's mesh — so it is sampled directly. Everything
      // inside the contact band darkens, which is the term that stops a pod
      // meeting the ash along a clean bright line.
      const gnd = opts.groundAt;
      if (gnd) {
        const org = opts.origin;
        const h = gnd(px + (org ? org.x : 0), pz + (org ? org.z : 0)) - (org ? org.y : 0);
        const above = py - h;
        if (above < contact) {
          const t2 = Math.max(0, Math.min(1, above / contact));
          // Upward faces are not occluded by the ground they stand on.
          const facing = 1 - Math.max(0, Nv.y);
          ao *= 1 - (1 - t2 * t2) * 0.62 * facing;
        }
      }
      out[i] = Math.max(0.12, Math.min(1, ao));
    }
    g.setAttribute('aAO', new THREE.Float32BufferAttribute(out, 1));
  }
}

/**
 * Bake an ungated bioluminescent wash into `aBio`.
 *
 * Same integral as `bakeSpill`, different channel and different politics: the
 * spill channel is a lamp and is dimmed with the clock, and a fungus is not.
 * Keeping them apart is what lets a cyan rim light the gills above it at noon
 * without also turning every window in the settlement on at midday.
 */
export function bakeBio(geos: readonly THREE.BufferGeometry[], sources: readonly SpillSource[]): void {
  if (geos.length === 0 || sources.length === 0) return;
  // Binned, exactly as bakeSpill is, and for the same reason.
  //
  // This used to be an all-pairs loop, which was survivable while the only bio
  // sources were sixteen stations round one cap rim. The spore veins moved into
  // this channel and each tower now hands it ~90, against a sixty-thousand
  // vertex trunk, forty times over — measured at seventeen extra seconds of
  // build, i.e. seventeen seconds of load screen, for a term that touches a few
  // hundred vertices per source.
  const bins = binSources(sources);
  for (const g of geos) {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nrm = g.attributes.normal as THREE.BufferAttribute | undefined;
    const n = pos.count;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const near = bins.at(px, py, pz);
      if (near === undefined) continue;
      let acc = 0;
      for (const s of near) {
        const dx = px - s.pos.x;
        const dy = py - s.pos.y;
        const dz = pz - s.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > s.range * s.range) continue;
        const dist = Math.sqrt(d2);
        const invd = 1 / Math.max(dist, 1e-4);
        let nl = 1;
        if (nrm) nl = Math.max(0, (dx * nrm.getX(i) + dy * nrm.getY(i) + dz * nrm.getZ(i)) * invd);
        const t = 1 - dist / s.range;
        acc += s.power * nl * t * t;
      }
      out[i] = Math.min(1.4, acc);
    }
    g.setAttribute('aBio', new THREE.Float32BufferAttribute(out, 1));
  }
}

/** A point light baked into vertex irradiance rather than lit at runtime. */
export interface SpillSource {
  /** Structure-local position of the aperture, just outside its reveal. */
  pos: THREE.Vector3;
  /** Outward facing, so a window does not wash the wall it is set into from behind. */
  dir?: THREE.Vector3;
  /** Metres at which the wash has fallen to nothing. */
  range: number;
  power: number;
}

/**
 * Bake aperture irradiance into `aSpill`.
 *
 * The runtime light pool is six lights culled at 95 m, which is the right
 * budget and the wrong tool for this: a landmark tower is looked at from 300 m
 * to 2 km and its windows must still throw a wash on the hull around them, or
 * they read as rectangles pasted on a curved surface — the single most obvious
 * low-effort tell there is. An n-dot-l point integral evaluated per vertex at
 * build time costs one float per vertex and is correct at every distance.
 */
/**
 * Spatial index over a set of point light sources.
 *
 * A tower carries forty apertures over two hundred thousand vertices and the
 * wash from each reaches twenty metres, so the naive all-pairs loop spends 99%
 * of its time proving that a root is not near a window. Bin the sources into a
 * grid at their own reach and each vertex tests a handful.
 */
interface SourceBins {
  at(x: number, y: number, z: number): SpillSource[] | undefined;
}

function binSources(sources: readonly SpillSource[]): SourceBins {
  let cell = 0;
  for (const s of sources) cell = Math.max(cell, s.range);
  // Half the longest reach: every source then spans at most a 5x5x5 stamp, so
  // binning stays bounded however wide a single lamp throws.
  cell = Math.max(3, cell * 0.5);
  const bins = new Map<number, SpillSource[]>();
  const key = (i: number, j: number, k: number): number =>
    (((i & 1023) << 20) | ((j & 1023) << 10) | (k & 1023)) >>> 0;
  for (const s of sources) {
    const r = Math.ceil(s.range / cell);
    const ci = Math.floor(s.pos.x / cell);
    const cj = Math.floor(s.pos.y / cell);
    const ck = Math.floor(s.pos.z / cell);
    for (let i = ci - r; i <= ci + r; i++) {
      for (let j = cj - r; j <= cj + r; j++) {
        for (let k = ck - r; k <= ck + r; k++) {
          const h = key(i, j, k);
          const list = bins.get(h);
          if (list) list.push(s);
          else bins.set(h, [s]);
        }
      }
    }
  }
  return {
    at: (x, y, z) => bins.get(key(Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell))),
  };
}

export function bakeSpill(geos: readonly THREE.BufferGeometry[], sources: readonly SpillSource[]): void {
  if (geos.length === 0 || sources.length === 0) return;
  const bins = binSources(sources);

  for (const g of geos) {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nrm = g.attributes.normal as THREE.BufferAttribute | undefined;
    const n = pos.count;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const near = bins.at(px, py, pz);
      if (near === undefined) continue;
      let acc = 0;
      for (const s of near) {
        const dx = px - s.pos.x;
        const dy = py - s.pos.y;
        const dz = pz - s.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > s.range * s.range) continue;
        const dist = Math.sqrt(d2);
        const inv = 1 / Math.max(dist, 1e-4);
        // Faces turned away from the opening get nothing; the wash has to fall
        // off across a curved hull or it reads as a uniform coloured patch.
        let nl = 1;
        if (nrm) {
          nl = Math.max(0, (dx * nrm.getX(i) + dy * nrm.getY(i) + dz * nrm.getZ(i)) * inv);
        }
        if (s.dir) nl *= Math.max(0, -(dx * s.dir.x + dy * s.dir.y + dz * s.dir.z) * inv) * 0.35 + 0.65;
        const t = 1 - dist / s.range;
        acc += (s.power * nl * t * t) / (1 + d2 * 0.18);
      }
      out[i] = Math.min(1.6, acc);
    }
    g.setAttribute('aSpill', new THREE.Float32BufferAttribute(out, 1));
  }
}

/**
 * Darken `aCurv` where a structure's own masses occlude each other.
 *
 * Vertex curvature is a local measure and cannot see that a pod is welded onto
 * a trunk: the two are separate shells that merely interpenetrate, so the
 * junction between them comes out of the bake as flat as open wall. Folding an
 * analytic sphere-occlusion term into the same attribute makes those seams read
 * as folds, which is what turns a stack of primitives back into one organism.
 */
export function bakeCavity(geos: readonly THREE.BufferGeometry[], occluders: readonly THREE.Vector4[]): void {
  if (geos.length === 0 || occluders.length === 0) return;
  for (const g of geos) {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nrm = g.attributes.normal as THREE.BufferAttribute | undefined;
    const attr = g.attributes.aCurv as THREE.BufferAttribute | undefined;
    if (!attr) continue;
    const n = pos.count;
    for (let i = 0; i < n; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      let occ = 0;
      for (const o of occluders) {
        const dx = o.x - px;
        const dy = o.y - py;
        const dz = o.z - pz;
        const dist = Math.hypot(dx, dy, dz);
        // Inside its own occluder: this vertex belongs to that mass.
        if (dist < o.w * 0.92) continue;
        const inv = 1 / Math.max(dist, 1e-4);
        let nl = 1;
        if (nrm) nl = dx * inv * nrm.getX(i) + dy * inv * nrm.getY(i) + dz * inv * nrm.getZ(i);
        if (nl <= 0) continue;
        // Solid angle of a sphere of radius w seen from `dist`.
        const s = o.w / dist;
        occ += nl * (1 - Math.sqrt(Math.max(0, 1 - s * s)));
      }
      if (occ <= 0) continue;
      attr.setX(i, Math.max(-1, attr.getX(i) - Math.min(0.95, occ * 1.15)));
    }
    attr.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- primitives

/** Merge, tolerating nulls and empty lists. Ownership of inputs transfers. */
export function mergeParts(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  const live = parts.filter((p) => (p.attributes.position as THREE.BufferAttribute | undefined) !== undefined);
  if (live.length === 0) return null;
  if (live.length === 1) return live[0];
  const normalized = live.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    if (g !== p) p.dispose();
    // mergeGeometries requires every input to carry the same attribute set.
    const n = (g.attributes.position as THREE.BufferAttribute).count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.attributes.aSway) g.setAttribute('aSway', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
    // aThick is authored by the primitive that emitted the triangle and cannot
    // be recovered afterwards, so unlike the weathering attributes it has to
    // survive the merge rather than being baked over it.
    if (!g.attributes.aThick) g.setAttribute('aThick', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
    // aLit is authored per emitted panel and, like aThick, cannot be recovered
    // once the panels are merged into one buffer.
    if (!g.attributes.aLit) g.setAttribute('aLit', new THREE.Float32BufferAttribute(new Float32Array(n).fill(1), 1));
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'aSway' && k !== 'aThick' && k !== 'aLit') {
        g.deleteAttribute(k);
      }
    }
    return g;
  });
  const merged = mergeGeometries(normalized, false);
  for (const g of normalized) g.dispose();
  return merged;
}

/** Transform in place; the generators author in convenient local frames. */
export function xform(g: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  g.applyMatrix4(m);
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

export function placed(
  g: THREE.BufferGeometry,
  pos: THREE.Vector3,
  quat?: THREE.Quaternion,
  scale?: THREE.Vector3,
): THREE.BufferGeometry {
  _m.compose(pos, quat ?? _q.identity(), scale ?? _s.set(1, 1, 1));
  return xform(g, _m);
}

/**
 * Chamfered box: six inset faces, twelve edge strips, eight corner triangles.
 *
 * A razor-sharp box edge is the second-strongest amateur tell after hovering
 * geometry — nothing in a weathered settlement has one, and the chamfer also
 * gives the curvature bake something to find, so corners bleach correctly.
 */
export function bevelBox(w: number, h: number, d: number, bev: number): THREE.BufferGeometry {
  const X = w * 0.5;
  const Y = h * 0.5;
  const Z = d * 0.5;
  const b = Math.max(1e-4, Math.min(bev, X * 0.45, Y * 0.45, Z * 0.45));
  const half = [X, Y, Z];
  const mb = new MeshBuilder();
  const S = [-1, 1];
  // `axis` names the coordinate that stays at full extent for this vertex.
  const V = (sg: readonly number[], axis: number): THREE.Vector3 =>
    new THREE.Vector3(
      sg[0] * (half[0] - (axis === 0 ? 0 : b)),
      sg[1] * (half[1] - (axis === 1 ? 0 : b)),
      sg[2] * (half[2] - (axis === 2 ? 0 : b)),
    );
  const far = (...c: number[]): THREE.Vector3 => new THREE.Vector3(c[0], c[1], c[2]).multiplyScalar(100);

  for (let axis = 0; axis < 3; axis++) {
    const o = [0, 1, 2].filter((a) => a !== axis);
    for (const s of S) {
      const corners = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([p, q]) => {
        const sg = [0, 0, 0];
        sg[axis] = s;
        sg[o[0]] = p;
        sg[o[1]] = q;
        return V(sg, axis);
      });
      const out = [0, 0, 0];
      out[axis] = s;
      mb.quadFacing(corners[0], corners[1], corners[2], corners[3], far(...out));
    }
    for (const s0 of S) {
      for (const s1 of S) {
        const a0 = [0, 0, 0];
        const a1 = [0, 0, 0];
        a0[o[0]] = a1[o[0]] = s0;
        a0[o[1]] = a1[o[1]] = s1;
        a0[axis] = -1;
        a1[axis] = 1;
        const out = [0, 0, 0];
        out[o[0]] = s0;
        out[o[1]] = s1;
        mb.quadFacing(V(a0, o[0]), V(a1, o[0]), V(a1, o[1]), V(a0, o[1]), far(...out));
      }
    }
  }
  for (const sx of S) {
    for (const sy of S) {
      for (const sz of S) {
        const sg = [sx, sy, sz];
        mb.quadFacing(V(sg, 0), V(sg, 1), V(sg, 2), V(sg, 2), far(sx, sy, sz));
      }
    }
  }
  return mb.geometry();
}

/**
 * Sweep a closed polygonal cross-section along a path with per-station radius
 * and twist. Bone buttresses, rope, timber piles and drying racks are all this.
 */
export function sweep(
  path: readonly THREE.Vector3[],
  radii: readonly number[],
  sides: number,
  twist = 0,
): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const n = path.length;
  if (n < 2) return mb.geometry();
  const frames: THREE.Vector3[][] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const tan = new THREE.Vector3();
  const rt = new THREE.Vector3();
  const bi = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(n - 1, i + 1)];
    tan.subVectors(b, a);
    if (tan.lengthSq() < 1e-10) tan.set(0, 1, 0);
    tan.normalize();
    rt.crossVectors(Math.abs(tan.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up, tan).normalize();
    bi.crossVectors(tan, rt).normalize();
    const ring: THREE.Vector3[] = [];
    for (let s = 0; s < sides; s++) {
      const th = (s / sides) * Math.PI * 2 + twist * (i / (n - 1));
      ring.push(
        new THREE.Vector3()
          .copy(path[i])
          .addScaledVector(rt, Math.cos(th) * radii[i])
          .addScaledVector(bi, Math.sin(th) * radii[i]),
      );
    }
    frames.push(ring);
  }
  for (let i = 0; i < n - 1; i++) {
    // Screen-coverage weight for emissive tubes: the local radius is exactly the
    // half-thickness the glow shader needs to know it is sub-pixel.
    mb.thick = (radii[i] + radii[i + 1]) * 0.5;
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      const c = new THREE.Vector3().addVectors(path[i], path[i + 1]).multiplyScalar(0.5);
      const q0 = frames[i][s];
      const q1 = frames[i][s2];
      const q2 = frames[i + 1][s2];
      const q3 = frames[i + 1][s];
      _c.copy(q0).add(q1).add(q2).add(q3).multiplyScalar(0.25);
      _u.subVectors(_c, c).multiplyScalar(2).add(_c);
      mb.quadFacing(q0, q1, q2, q3, _u);
    }
  }
  // Caps keep the silhouette closed where a sweep ends in mid-air.
  const caps: Array<[THREE.Vector3[], THREE.Vector3]> = [
    [frames[0], new THREE.Vector3().copy(path[0]).multiplyScalar(2).sub(path[1])],
    [frames[n - 1], new THREE.Vector3().copy(path[n - 1]).multiplyScalar(2).sub(path[n - 2])],
  ];
  for (const [ring, outward] of caps) {
    mb.thick = radii[ring === frames[0] ? 0 : n - 1];
    const c = new THREE.Vector3();
    for (const p of ring) c.add(p);
    c.multiplyScalar(1 / ring.length);
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      mb.quadFacing(c, ring[s], ring[s2], ring[s2], outward);
    }
  }
  return mb.geometry();
}

/**
 * A drift of ash banked against ONE support, in structure-local coordinates.
 *
 * The foundation skirt only covers the shell's own footprint. Everything that
 * stands on legs — a Telvanni tower's roots, a fallen Dwemer machine's shorn
 * struts, a shrine's gate pylons — puts its feet metres OUTSIDE that ring, and
 * a leg entering bare ground on a clean silhouette edge is read as a leg
 * ending in air whether or not the vertex is technically below the surface. It
 * is the same failure the shell had before it got a skirt, one support at a
 * time.
 *
 * So every foot gets its own bank: a low lobed cone, apex against the leg,
 * toe driven under the surface so there is no lip, and a material change from
 * the leg's own to `ash` — which is what actually sells the junction, because
 * contact is a change of material and not merely a change of depth.
 *
 * `ground` is the visible surface (the mound must sit ON it); `deep`, when
 * given, is the LOD floor the toe is driven to so the bank does not lift off
 * its own ground at distance.
 */
export function ashMound(
  cx: number,
  cz: number,
  ground: (x: number, z: number) => number,
  opts: { radius: number; height: number; seed?: number; deep?: (x: number, z: number) => number },
): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const R = Math.max(0.25, opts.radius);
  const H = Math.max(0.1, opts.height);
  const sd = opts.seed ?? 3;
  const deep = opts.deep ?? ground;
  const SIDES = 10;
  const ROWS = 3;
  const rows: THREE.Vector3[][] = [];
  for (let r = 0; r <= ROWS; r++) rows.push([]);
  for (let i = 0; i < SIDES; i++) {
    const th = (i / SIDES) * Math.PI * 2;
    // Two harmonics: a bank is deeper on its lee side and scalloped at the toe.
    const lobe = 0.55 + 0.55 * (0.5 + 0.5 * Math.sin(th * 2 + sd)) + 0.30 * noise2(th * 3.7 + sd, sd * 0.7);
    for (let r = 0; r <= ROWS; r++) {
      // Offset so the innermost row is a small ring rather than a degenerate
      // point; the support itself fills the hole.
      const t = (r + 0.35) / (ROWS + 0.35);
      const rr = R * lobe * t;
      const x = cx + Math.cos(th) * rr;
      const z = cz + Math.sin(th) * rr;
      // Angle of repose, eased, feathering into the ground at the toe rather
      // than meeting it at a hard cut.
      const rise = H * Math.pow(1 - t, 1.6) * (0.72 + 0.5 * noise2(th * 5.1 + r * 2.3 + sd, sd + r));
      const base = r === ROWS ? deep(x, z) - 0.22 : ground(x, z);
      rows[r].push(new THREE.Vector3(x, base + rise, z));
    }
  }
  const up = new THREE.Vector3(0, 1e4, 0);
  for (let i = 0; i < SIDES; i++) {
    const j = (i + 1) % SIDES;
    for (let r = 0; r < ROWS; r++) {
      mb.quadFacing(rows[r][i], rows[r][j], rows[r + 1][j], rows[r + 1][i], up);
    }
  }
  return mb.geometry();
}

/** Catenary between two points. Rope and net lines hang, they do not stretch. */
export function catenary(a: THREE.Vector3, b: THREE.Vector3, sag: number, segs: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= Math.sin(t * Math.PI) * sag;
    out.push(p);
  }
  return out;
}

/**
 * A skirt joining a ring of shell-base points down to the terrain, plus the
 * ash drift that has piled against it.
 *
 * The terrain is owned by another subsystem and cannot be flattened, so the
 * foundation reaches *down* to meet the ground at every angle instead. That is
 * what removes the hovering-object tell without touching a heightfield.
 *
 * TWO ground functions, and the split is the whole fix for "the tower hovers in
 * midair with its legs ending in empty space".
 *
 *  - `groundAt` is the exact CPU surface. The ash drift is banked against THAT,
 *    because the drift is a near-field read and one buried under the visible
 *    ground is no drift at all.
 *  - `groundDeep` (see GroundField.settle) is the lowest surface any terrain
 *    LOD level rasterises here, which past a few hundred metres is metres below
 *    the CPU one. The PLINTH is driven to that. Up close the extra depth is
 *    inside the hill and invisible; at range it is the only thing standing
 *    between the shell foot and open sky.
 *
 * The plinth is battered rather than vertical for the same reason: with the
 * deep reach it can be ten metres tall on a landmark, and a ten-metre vertical
 * collar reads as a plinth someone built, where a stepped, jittered, outward-
 * leaning one reads as the outcrop the structure was raised on.
 */
export function buildFoundation(
  ring: readonly THREE.Vector3[],
  origin: THREE.Vector3,
  groundAt: (x: number, z: number) => number,
  opts: {
    bury: number;
    flare: number;
    drift: number;
    seed?: number;
    /** Lowest surface any terrain LOD draws here. Defaults to `groundAt`. */
    groundDeep?: (x: number, z: number) => number;
    /**
     * Boulder apron straddling the plinth toe, as a fraction of the plinth's own
     * drop. 0 (the default) is the settlement behaviour: a scatter of shed stone
     * sized off the drift.
     *
     * Landmarks need the other thing. A twenty-metre battered skirt meets the
     * hill along a POLYGON EDGE, and at half a kilometre a straight intersection
     * line between two dark masses is the single strongest "geometry punched
     * through the terrain" tell there is — the review measured exactly that at
     * the tower's foot. Half-buried rock the size of a house, sitting across
     * that line, is what a real founded structure has and what makes the seam
     * unfindable. Sized off the drop rather than off the drift, because the drop
     * is how tall the seam is.
     */
    apron?: number;
  },
): { plinth: THREE.BufferGeometry; drift: THREE.BufferGeometry; rubble: THREE.BufferGeometry } {
  const plinth = new MeshBuilder();
  const drift = new MeshBuilder();
  const n = ring.length;
  const c = new THREE.Vector3();
  for (const p of ring) c.add(p);
  c.multiplyScalar(1 / n);
  const sd = opts.seed ?? 17;
  const deepAt = opts.groundDeep ?? groundAt;

  // Three rings, not two.
  //
  // A single quad strip from the wall to the ground is one long flat facet with
  // a straight outer edge, and it renders as an untextured pale card lying in
  // the grass — which is exactly what the review picked out. Two intermediate
  // rings with independently jittered reach and height give the bank a crown, a
  // toe and a wandering outline, and give the triplanar something with varying
  // normals to shade.
  const RINGS = 3;
  const rows: THREE.Vector3[][] = [];
  for (let r = 0; r <= RINGS; r++) rows.push([]);
  const lo: THREE.Vector3[] = [];
  const mid: THREE.Vector3[] = [];
  const rad = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    const p = ring[i];
    rad.set(p.x - c.x, 0, p.z - c.z);
    if (rad.lengthSq() < 1e-8) rad.set(1, 0, 0);
    rad.normalize();
    const gx = origin.x + p.x + rad.x * opts.flare;
    const gz = origin.z + p.z + rad.z * opts.flare;
    const gy = groundAt(gx, gz) - origin.y;
    const th0 = Math.atan2(rad.z, rad.x);
    // The LOD floor, not the CPU surface. See the header: this is the only
    // number in the module that answers the hovering blocker at distance.
    const dy = deepAt(gx, gz) - origin.y;
    // Clamped to stay UNDER the shell foot. On the uphill side of a landmark
    // the pad sits several metres below the local ground, so the unclamped
    // skirt vertex lands above the ring it hangs from and the quad flips into a
    // pale fin standing three metres up the trunk.
    const loY = Math.min(dy - opts.bury, p.y - 0.25);
    // Batter: the toe leans out as it descends, by a fraction of how far down it
    // actually has to go, so a deep skirt reads as an outcrop rather than as a
    // vertical collar. Jittered per bearing so the outline is not a circle.
    const drop = Math.max(0, p.y - loY);
    // Three harmonics of lobing on top of the batter, not one band of value
    // noise.
    //
    // With a single smooth jitter the toe is a scaled copy of the ring it hangs
    // from — a cone. A cone lit from behind is one dark mass with a smooth
    // convex outline, and at half a kilometre that is precisely the "flat black
    // wedge" the review measured under the tower: the surface detail was fine,
    // the SHAPE had nothing in it. Low harmonics push the plan out into spurs
    // and pull it back into clefts, so the outcrop has a broken outline from
    // every bearing and the light finds edges inside it. Costs no triangles.
    const crag =
      1 +
      0.30 * Math.sin(th0 * 2 + sd * 0.9) +
      0.20 * Math.sin(th0 * 3 - sd * 1.7) +
      0.26 * (noise2(th0 * 1.9 + sd, sd * 0.4) - 0.5) * 2;
    const batter = drop * (0.20 + 0.16 * noise2(th0 * 2.7 + sd * 1.1, sd * 0.6)) * Math.max(0.35, crag);
    lo.push(
      new THREE.Vector3(
        p.x + rad.x * (opts.flare + batter),
        loY,
        p.z + rad.z * (opts.flare + batter),
      ),
    );
    // One intermediate course, pulled in slightly and jittered in height, so the
    // batter is a broken step rather than a cone.
    const midT = 0.42 + 0.2 * noise2(th0 * 4.1 - sd, sd * 1.7);
    mid.push(
      new THREE.Vector3(
        p.x + rad.x * (opts.flare + batter * midT * 0.75),
        p.y - drop * midT,
        p.z + rad.z * (opts.flare + batter * midT * 0.75),
      ),
    );

    // Two low harmonics plus value noise: the bank is deeper on the lee side
    // and scalloped along its toe, never a circle offset from a circle.
    const th = Math.atan2(rad.z, rad.x);
    const lobe =
      0.62 +
      0.5 * (0.5 + 0.5 * Math.sin(th * 2 + sd * 0.7)) +
      0.32 * (0.5 + 0.5 * Math.sin(th * 5 - sd * 1.3)) +
      0.35 * noise2(th * 3.1 + sd, sd * 0.31);
    const reach = opts.drift * lobe;

    // Inner crown rides up the wall; each successive ring steps outward and
    // down, the last one driven under the surface so there is no visible lip.
    rows[0].push(
      new THREE.Vector3(
        p.x + rad.x * opts.flare * 0.55,
        Math.max(gy, p.y) + opts.drift * (0.62 + 0.42 * noise2(th * 2.3 - sd, sd)),
        p.z + rad.z * opts.flare * 0.55,
      ),
    );
    for (let r = 1; r <= RINGS; r++) {
      const t = r / RINGS;
      const dr = opts.flare + reach * t;
      const dx = origin.x + p.x + rad.x * dr;
      const dz = origin.z + p.z + rad.z * dr;
      const dy = groundAt(dx, dz) - origin.y;
      // Angle of repose, eased: steep against the wall, feathering into the
      // ground rather than meeting it at a hard straight cut.
      const rise = opts.drift * 0.62 * Math.pow(1 - t, 1.7) * (0.7 + 0.6 * noise2(th * 4.7 + r * 3.3 + sd, sd + r));
      rows[r].push(new THREE.Vector3(p.x + rad.x * dr, dy + rise - (r === RINGS ? 0.5 : 0.04), p.z + rad.z * dr));
    }
  }

  // Mean drop of the skirt, i.e. how tall the plinth/terrain seam actually is.
  // The apron is sized off this so a shrine with a two-metre footing gets
  // knee-high rock and a tower with a twelve-metre one gets boulders.
  let dropMean = 0;
  for (let i = 0; i < n; i++) dropMean += Math.max(0, ring[i].y - lo[i].y);
  dropMean /= Math.max(1, n);

  const far = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1e4, 0);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    far.copy(ring[i]).sub(c).multiplyScalar(6).add(c);
    plinth.quadFacing(ring[i], ring[j], mid[j], mid[i], far);
    plinth.quadFacing(mid[i], mid[j], lo[j], lo[i], far);
    for (let r = 0; r < RINGS; r++) {
      drift.quadFacing(rows[r][i], rows[r][j], rows[r + 1][j], rows[r + 1][i], up);
    }
  }

  // Debris skirt. Nothing in a settlement meets the ground along a clean line;
  // a scatter of shed stone at the toe of the bank is what makes the contact
  // read as buried rather than as geometry set down on a lawn.
  const rubble = new MeshBuilder();
  const stones = Math.min(48, Math.max(10, Math.round(n * 0.55)));
  const q = new THREE.Quaternion();
  for (let k = 0; k < stones; k++) {
    const i = Math.floor((k / stones) * n) % n;
    const p = ring[i];
    rad.set(p.x - c.x, 0, p.z - c.z);
    if (rad.lengthSq() < 1e-8) rad.set(1, 0, 0);
    rad.normalize();
    const h1 = noise2(k * 1.7 + sd, sd * 0.7);
    const h2 = noise2(k * 3.1 - sd, sd * 1.9);
    const h3 = noise2(k * 5.3 + sd * 2.1, sd);
    const th = Math.atan2(rad.z, rad.x) + (h3 - 0.5) * 0.5;
    const dr = opts.flare + opts.drift * (0.35 + h1 * 1.15);
    const s = Math.max(0.16, opts.drift * (0.10 + h2 * 0.26));
    const gx = origin.x + c.x + Math.cos(th) * (Math.hypot(p.x - c.x, p.z - c.z) + dr);
    const gz = origin.z + c.z + Math.sin(th) * (Math.hypot(p.x - c.x, p.z - c.z) + dr);
    const gy = groundAt(gx, gz) - origin.y;
    q.setFromEuler(new THREE.Euler((h1 - 0.5) * 1.1, th + h2 * 3.0, (h3 - 0.5) * 1.1));
    const g = bevelBox(s * (0.8 + h1), s * (0.45 + h2 * 0.5), s * (0.7 + h3), s * 0.16);
    const geo = placed(g, new THREE.Vector3(gx - origin.x, gy - s * (0.15 + h2 * 0.3), gz - origin.z), q);
    appendInto(rubble, geo);
    geo.dispose();
  }

  // Boulder apron across the seam. See `opts.apron`.
  const apron = opts.apron ?? 0;
  if (apron > 0.001 && dropMean > 0.5) {
    const blocks = Math.min(40, Math.max(12, Math.round(n * 0.55)));
    for (let k = 0; k < blocks; k++) {
      // Deliberately not aligned to the plinth's own vertices: a boulder per
      // facet is a decorated polygon, and the facet is the thing being hidden.
      const u = (k + 0.5) / blocks;
      const fi = u * n;
      const i = Math.floor(fi) % n;
      const j = (i + 1) % n;
      const f = fi - Math.floor(fi);
      const h1 = noise2(k * 2.3 - sd * 0.9, sd * 1.3);
      const h2 = noise2(k * 4.7 + sd * 1.7, sd * 0.4);
      const h3 = noise2(k * 7.1 - sd * 2.3, sd * 2.2);
      // Ride the TOE of the skirt, then push out past it by up to a boulder's
      // width so the stone straddles the intersection instead of standing
      // beside it.
      const tx = lo[i].x + (lo[j].x - lo[i].x) * f;
      const tz = lo[i].z + (lo[j].z - lo[i].z) * f;
      rad.set(tx - c.x, 0, tz - c.z);
      if (rad.lengthSq() < 1e-8) rad.set(1, 0, 0);
      rad.normalize();
      const s = dropMean * apron * (0.34 + h1 * 0.9);
      const push = s * (h2 - 0.15);
      const bx = tx + rad.x * push;
      const bz = tz + rad.z * push;
      const gy = groundAt(origin.x + bx, origin.z + bz) - origin.y;
      // Half-buried, and never above the toe it is covering: a boulder perched
      // on top of the seam advertises it.
      const by = Math.min(gy + s * (0.10 + h3 * 0.22), lo[i].y + dropMean * 0.55) - s * 0.42;
      q.setFromEuler(
        new THREE.Euler((h2 - 0.5) * 0.8, Math.atan2(rad.z, rad.x) + h1 * 3.1, (h3 - 0.5) * 0.8),
      );
      const g = bevelBox(s * (1.0 + h2 * 0.8), s * (0.62 + h1 * 0.5), s * (0.85 + h3 * 0.7), s * 0.14);
      const geo = placed(g, new THREE.Vector3(bx, by, bz), q);
      appendInto(rubble, geo);
      geo.dispose();
    }
  }

  return { plinth: plinth.geometry(), drift: drift.geometry(), rubble: rubble.geometry() };
}

/** Copy a geometry's triangle soup into a builder, so scatters stay one mesh. */
function appendInto(mb: MeshBuilder, g: THREE.BufferGeometry): void {
  const p = g.attributes.position as THREE.BufferAttribute;
  const nn = g.attributes.normal as THREE.BufferAttribute | undefined;
  for (let i = 0; i < p.count; i++) {
    mb.pos.push(p.getX(i), p.getY(i), p.getZ(i));
    if (nn) mb.nrm.push(nn.getX(i), nn.getY(i), nn.getZ(i));
    else mb.nrm.push(0, 1, 0);
    mb.uvs.push((i % 3) === 1 ? 1 : 0, (i % 3) === 2 ? 1 : 0);
    mb.sw.push(0);
    mb.th.push(0);
  }
}
