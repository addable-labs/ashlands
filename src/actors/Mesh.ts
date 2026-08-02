import * as THREE from 'three';

/**
 * Procedural surface construction for creature bodies.
 *
 * Every creature in the bestiary is built from parametric patches rather than
 * hand-placed triangles: a patch knows its own analytic derivatives, so normals
 * come out exact and seams close by construction. Primitives never share
 * vertices, which is deliberate — it gives hard edges between a chitin plate
 * and the hide beneath it for free, while every patch stays smooth internally.
 */

export type V3 = readonly [number, number, number];

/** Per-vertex shading mask. Drives the actor uber-shader without extra draws. */
export interface Mask {
  /** 0..1 subsurface thickness — high on membranes, ears, gasbags. */
  trans: number;
  /** 0..1 thin-film iridescence strength — high on chitin, zero on cloth. */
  irid: number;
  /** 0..1 wear/dirt darkening toward the ground. */
  wear: number;
}

const DEFAULT_MASK: Mask = { trans: 0, irid: 0, wear: 0 };

export interface PatchOpts {
  /** Segments across u (the wrapping direction for tubes). */
  nu: number;
  /** Segments across v. */
  nv: number;
  /** u wraps: the last column reuses column 0's position but keeps its own uv. */
  closedU?: boolean;
  /** UV scale in metres of texture per unit of (u, v). */
  uv?: (u: number, v: number, p: THREE.Vector3) => [number, number];
  /**
   * Outward hint. Winding and normal sign are resolved against this so a patch
   * can be written without worrying which way its cross product points.
   */
  hint?: (u: number, v: number, p: THREE.Vector3) => V3;
  /** Per-vertex mask override. */
  mask?: (u: number, v: number, p: THREE.Vector3) => Mask;
  /**
   * True when v runs along a genuine sweep axis (a limb, a tail, a torso), so
   * the v-derivative is the direction chitin fibres and plate ridges follow.
   * The shader uses it for the anisotropic sheen; patches where v is a polar
   * angle (blobs) leave it off and fall back to an isotropic rim.
   */
  axial?: boolean;
}

const _p = new THREE.Vector3();
const _pu = new THREE.Vector3();
const _pv = new THREE.Vector3();
const _n = new THREE.Vector3();
const _h = new THREE.Vector3();

export class SurfaceBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uv: number[] = [];
  readonly msk: number[] = [];
  /**
   * Per vertex: xyz the sweep-axis direction (zero where the patch has none),
   * w the local feature radius in metres. Feeds the anisotropic sheen and the
   * sub-pixel limb dilation.
   */
  readonly tan: number[] = [];
  readonly idx: number[] = [];

  private cur: Mask = DEFAULT_MASK;

  setMask(m: Mask): void {
    this.cur = m;
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  /**
   * Tessellate p(u,v) over the unit square. Normals are central differences of
   * the same function, so a patch cannot disagree with itself the way separately
   * authored positions and normals do.
   */
  patch(f: (u: number, v: number, out: THREE.Vector3) => void, o: PatchOpts): void {
    const { nu, nv } = o;
    const base = this.vertexCount;
    const hu = 0.5 / nu;
    const hv = 0.5 / nv;

    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      for (let i = 0; i <= nu; i++) {
        const u = o.closedU === true && i === nu ? 0 : i / nu;
        f(u, v, _p);

        // Central differences, one-sided at the borders. A degenerate tangent
        // (a pole, a pinched tip) falls back to the outward hint.
        const u0 = Math.max(0, u - hu);
        const u1 = Math.min(1, u + hu);
        f(u0, v, _pu);
        f(u1, v, _n);
        _pu.subVectors(_n, _pu);

        const v0 = Math.max(0, v - hv);
        const v1 = Math.min(1, v + hv);
        f(u, v0, _pv);
        f(u, v1, _n);
        _pv.subVectors(_n, _pv);

        _n.crossVectors(_pu, _pv);
        if (_n.lengthSq() < 1e-14) {
          // Pole or pinched tip: the surface has no area here, so take the
          // frame one step inside and reuse it. Visually identical, and it
          // avoids a NaN normal propagating into the lighting.
          const vi = v < 0.5 ? Math.min(1, v + 2 * hv) : Math.max(0, v - 2 * hv);
          f(Math.max(0, u - hu), vi, _pu);
          f(Math.min(1, u + hu), vi, _n);
          _pu.subVectors(_n, _pu);
          f(u, Math.max(0, vi - hv), _pv);
          f(u, Math.min(1, vi + hv), _n);
          _pv.subVectors(_n, _pv);
          _n.crossVectors(_pu, _pv);
          f(u, v, _p);
        }
        _n.normalize();

        // Distance from the vertex to the patch's own axis (a tube's spine, a
        // blob's centre) — i.e. how thick the feature is right here. The
        // shader needs it to know which parts of a creature are at risk of
        // falling below a pixel. Patches with no hint (sheets) never do.
        let feature = 1;
        if (o.hint !== undefined) {
          const hh = o.hint(u, v, _p);
          _h.set(hh[0], hh[1], hh[2]);
          feature = _h.length();
          if (_n.dot(_h) < 0) _n.negate();
        }
        if (!isFinite(_n.x) || _n.lengthSq() < 0.5) _n.set(0, 1, 0);

        const uvv = o.uv !== undefined ? o.uv(i / nu, v, _p) : [i / nu, v];
        const m = o.mask !== undefined ? o.mask(u, v, _p) : this.cur;

        this.pos.push(_p.x, _p.y, _p.z);
        this.nrm.push(_n.x, _n.y, _n.z);
        this.uv.push(uvv[0], uvv[1]);
        this.msk.push(m.trans, m.irid, m.wear);
        // `_pv` still holds the v-derivative: crossVectors reads it without
        // writing, so the sweep axis is free here rather than a second eval.
        if (o.axial === true && _pv.lengthSq() > 1e-12) {
          _pv.normalize();
          // Orthogonalise against the normal so the sheen tangent lies in the
          // surface even where the sweep is not perpendicular to it.
          _pv.addScaledVector(_n, -_pv.dot(_n));
          const l = _pv.length();
          if (l > 1e-5) this.tan.push(_pv.x / l, _pv.y / l, _pv.z / l, feature);
          else this.tan.push(0, 0, 0, feature);
        } else {
          this.tan.push(0, 0, 0, feature);
        }
      }
    }

    // Winding is chosen once per patch by testing the first non-degenerate quad
    // against its own vertex normal; that keeps backface culling valid whichever
    // way the parameterisation happens to run.
    const row = nu + 1;
    let flip = false;
    outer: for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * row + i;
        const b = a + 1;
        const c = a + row;
        const ax = this.pos[a * 3], ay = this.pos[a * 3 + 1], az = this.pos[a * 3 + 2];
        const e1x = this.pos[b * 3] - ax, e1y = this.pos[b * 3 + 1] - ay, e1z = this.pos[b * 3 + 2] - az;
        const e2x = this.pos[c * 3] - ax, e2y = this.pos[c * 3 + 1] - ay, e2z = this.pos[c * 3 + 2] - az;
        const cx = e1y * e2z - e1z * e2y;
        const cy = e1z * e2x - e1x * e2z;
        const cz = e1x * e2y - e1y * e2x;
        if (cx * cx + cy * cy + cz * cz < 1e-16) continue;
        flip = cx * this.nrm[a * 3] + cy * this.nrm[a * 3 + 1] + cz * this.nrm[a * 3 + 2] < 0;
        break outer;
      }
    }

    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * row + i;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        if (flip) this.idx.push(a, b, c, b, d, c);
        else this.idx.push(a, c, b, b, c, d);
      }
    }
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aMask', new THREE.Float32BufferAttribute(this.msk, 3));
    g.setAttribute('aTan', new THREE.Float32BufferAttribute(this.tan, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/* ------------------------------------------------------------- primitives */

/** Smooth spine with parallel-transport frames. Cheap to sample at any v. */
export class Spine {
  private curve: THREE.CatmullRomCurve3;
  private tan: THREE.Vector3[];
  private nor: THREE.Vector3[];
  private bin: THREE.Vector3[];
  private segs: number;

  constructor(points: readonly V3[], segs = 48) {
    this.curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
      false,
      'catmullrom',
      0.5,
    );
    this.segs = segs;
    const fr = this.curve.computeFrenetFrames(segs, false);
    this.tan = fr.tangents;
    this.nor = fr.normals;
    this.bin = fr.binormals;
  }

  point(v: number, out: THREE.Vector3): THREE.Vector3 {
    return this.curve.getPoint(THREE.MathUtils.clamp(v, 0, 1), out);
  }

  /** Interpolated frame at v. Linear blend is ample at 48 segments. */
  frame(v: number, n: THREE.Vector3, b: THREE.Vector3, t: THREE.Vector3): void {
    const x = THREE.MathUtils.clamp(v, 0, 1) * this.segs;
    const i = Math.min(this.segs, Math.floor(x));
    const j = Math.min(this.segs, i + 1);
    const f = x - i;
    n.copy(this.nor[i]).lerp(this.nor[j], f).normalize();
    b.copy(this.bin[i]).lerp(this.bin[j], f).normalize();
    t.copy(this.tan[i]).lerp(this.tan[j], f).normalize();
  }
}

export interface TubeOpts {
  nu?: number;
  nv?: number;
  /** Radius along the spine, v in [0,1]. */
  radius: (v: number) => number;
  /** Cross-section multiplier; a in [0,1) around. Use for keels, flat tails. */
  section?: (a: number, v: number) => number;
  /** Metres of texture per metre of surface. */
  texel?: number;
  mask?: (u: number, v: number, p: THREE.Vector3) => Mask;
  /** Round the ends into caps instead of leaving them open. */
  capA?: boolean;
  capB?: boolean;
}

const _sn = new THREE.Vector3();
const _sb = new THREE.Vector3();
const _st = new THREE.Vector3();
const _sp = new THREE.Vector3();

/**
 * Hard floor on any swept radius, in metres.
 *
 * Two jobs. It stops a taper from pinching into a degenerate ring (see the cap
 * note in `tube`), and it puts a lower bound on how thin a limb can be authored
 * — a 2 mm leg is below the Nyquist limit at any distance at all and can only
 * ever resolve as an aliased polyline.
 */
export const MIN_TUBE_RADIUS = 0.01;

/**
 * Swept generalised cylinder. Limbs, tails, necks, tentacles and most torsos
 * are one of these; the section callback is what turns a tube into a keeled
 * abdomen or a flattened paddle without a second code path.
 */
export function tube(b: SurfaceBuilder, spine: Spine, o: TubeOpts): void {
  const nu = o.nu ?? 14;
  const nv = o.nv ?? 20;
  const texel = o.texel ?? 2.0;
  const capA = o.capA === true;
  const capB = o.capB === true;

  const f = (u: number, v: number, out: THREE.Vector3): void => {
    // Cap regions bend the last eighth of the tube into a hemispherical end so
    // the silhouette closes without a separate patch and a visible seam.
    let vv = v;
    let squash = 1;
    // The cap must never close to a mathematical point. A row of nu+1 vertices
    // collapsed onto one position still carries nu+1 distinct texture
    // coordinates, so dFdx(position) goes to zero while dFdx(uv) does not and
    // the derivative tangent frame the normal map is perturbed in becomes
    // singular — which renders as a blown-out white speck that reads as a hole
    // in the model. Flooring the taper at a few percent of the local radius
    // leaves a disc far below a pixel and keeps the frame well conditioned.
    const CAP_FLOOR = 0.045;
    if (capA && v < 0.12) {
      const t = v / 0.12;
      squash = Math.max(CAP_FLOOR, Math.sin(t * Math.PI * 0.5));
      vv = 0.12 * (1 - Math.cos(t * Math.PI * 0.5));
    } else if (capB && v > 0.88) {
      const t = (1 - v) / 0.12;
      squash = Math.max(CAP_FLOOR, Math.sin(t * Math.PI * 0.5));
      vv = 1 - 0.12 * (1 - Math.cos(t * Math.PI * 0.5));
    }
    spine.point(vv, _sp);
    spine.frame(vv, _sn, _sb, _st);
    const a = u;
    const ang = a * Math.PI * 2;
    const r = Math.max(
      MIN_TUBE_RADIUS,
      o.radius(vv) * squash * (o.section !== undefined ? o.section(a, vv) : 1),
    );
    out.set(
      _sp.x + (_sn.x * Math.cos(ang) + _sb.x * Math.sin(ang)) * r,
      _sp.y + (_sn.y * Math.cos(ang) + _sb.y * Math.sin(ang)) * r,
      _sp.z + (_sn.z * Math.cos(ang) + _sb.z * Math.sin(ang)) * r,
    );
  };

  const hintV = new THREE.Vector3();
  b.patch(f, {
    nu,
    nv,
    closedU: true,
    axial: true,
    uv: (u, v, p) => [u * texel * Math.PI * 2 * Math.max(o.radius(v), 0.05), v * texel],
    hint: (u, v, p) => {
      spine.point(v, hintV);
      return [p.x - hintV.x, p.y - hintV.y, p.z - hintV.z];
    },
    mask: o.mask,
  });
}

export interface BlobOpts {
  nu?: number;
  nv?: number;
  centre: V3;
  radii: V3;
  /** Optional radial modulation, e.g. ribbing or a taper. */
  warp?: (theta: number, phi: number, r: THREE.Vector3) => void;
  texel?: number;
  mask?: (u: number, v: number, p: THREE.Vector3) => Mask;
}

/** Ellipsoid with an optional warp — heads, gasbags, egg sacs, carapaces. */
export function blob(b: SurfaceBuilder, o: BlobOpts): void {
  const nu = o.nu ?? 20;
  const nv = o.nv ?? 14;
  const texel = o.texel ?? 2.0;
  const c = new THREE.Vector3(o.centre[0], o.centre[1], o.centre[2]);
  const rad = new THREE.Vector3();

  b.patch(
    (u, v, out) => {
      const th = u * Math.PI * 2;
      const ph = v * Math.PI;
      rad.set(o.radii[0], o.radii[1], o.radii[2]);
      if (o.warp !== undefined) o.warp(th, ph, rad);
      out.set(
        c.x + rad.x * Math.sin(ph) * Math.cos(th),
        c.y + rad.y * Math.cos(ph),
        c.z + rad.z * Math.sin(ph) * Math.sin(th),
      );
    },
    {
      nu,
      nv,
      closedU: true,
      uv: (u, v) => [u * texel * o.radii[0] * 3, v * texel * o.radii[1] * 3],
      hint: (u, v, p) => [p.x - c.x, p.y - c.y, p.z - c.z],
      mask: o.mask,
    },
  );
}

export interface MembraneOpts {
  nu?: number;
  nv?: number;
  /** Leading edge, u in [0,1]. */
  edgeA: (u: number, out: THREE.Vector3) => void;
  /** Trailing edge. */
  edgeB: (u: number, out: THREE.Vector3) => void;
  /** Slack in the sheet, in metres, peaking mid-span. */
  sag?: (u: number, v: number) => number;
  /**
   * Out-of-plane displacement of the sheet, in metres, world axes, added to the
   * ruled surface between the two edges. `s` runs 0 at edgeA to 1 at edgeB.
   *
   * Without this a membrane is a RULED surface: every point is a straight-line
   * blend of two curves, so its normal is pinned to the plane those curves span
   * and a sheet whose edges are both authored flat has one constant normal over
   * its entire area. That is not a subtle shading error — it is a hard-edged
   * uniform-value plate stuck on the model, which is exactly what the netch's
   * dorsal crest was. Curvature has to come from somewhere, and a ruled surface
   * cannot supply it; this is where it comes from.
   *
   * Applied inside the surface function, so the analytic normals, the thickness
   * direction and the sweep tangent all follow it.
   */
  bow?: (u: number, s: number, out: THREE.Vector3) => void;
  /** Sheet half-thickness; membranes are solids so they can cast shadows. */
  thickness?: number;
  texel?: number;
  mask?: (u: number, v: number, p: THREE.Vector3) => Mask;
}

const _ma = new THREE.Vector3();
const _mb = new THREE.Vector3();
const _mbow = new THREE.Vector3();

/**
 * A thin sheet stretched between two edges — wing membranes, netch fins, the
 * scalloped hem of a robe. Given real thickness rather than a plane: a
 * zero-volume sheet self-shadows into z-fighting stripes at grazing sun.
 */
export function membrane(b: SurfaceBuilder, o: MembraneOpts): void {
  const nu = o.nu ?? 18;
  const nv = o.nv ?? 10;
  const th = o.thickness ?? 0.012;
  const texel = o.texel ?? 1.5;

  // v in [0,0.5) is the top face, [0.5,1] the bottom, so the sheet is a closed
  // solid and the two faces share a rim.
  const surf = (u: number, s: number, out: THREE.Vector3): void => {
    o.edgeA(u, _ma);
    o.edgeB(u, _mb);
    out.lerpVectors(_ma, _mb, s);
    if (o.bow !== undefined) {
      o.bow(u, s, _mbow);
      out.add(_mbow);
    }
  };

  const _t1 = new THREE.Vector3();
  const _t2 = new THREE.Vector3();
  const _sn2 = new THREE.Vector3();
  const _tmp2 = new THREE.Vector3();
  const H = 1e-3;

  b.patch(
    (u, v, out) => {
      const top = v < 0.5;
      const s = top ? v * 2 : (1 - v) * 2;
      // Rim taper: the sheet thins to nothing at s=0 and s=1 so the two faces
      // meet cleanly instead of forming a visible open edge.
      const rim = Math.sin(Math.min(1, s) * Math.PI);
      surf(u, s, out);
      const sag = o.sag !== undefined ? o.sag(u, s) : 0;
      out.y -= sag * rim;

      // Thickness has to go along the sheet's OWN normal, not along Y. Offsetting
      // a vertical fin — a guar's dorsal frill, a netch crest, a Dunmer ear —
      // along Y turns it into a horizontal plate, which is exactly what a wing
      // membrane must not become.
      surf(Math.max(0, u - H), s, _t1);
      surf(Math.min(1, u + H), s, _tmp2);
      _t1.subVectors(_tmp2, _t1);
      surf(u, Math.max(0, s - H), _t2);
      surf(u, Math.min(1, s + H), _tmp2);
      _t2.subVectors(_tmp2, _t2);
      _sn2.crossVectors(_t1, _t2);
      if (_sn2.lengthSq() < 1e-16) _sn2.set(0, 1, 0);
      else _sn2.normalize();
      out.addScaledVector(_sn2, (top ? 1 : -1) * th * rim);
    },
    {
      nu,
      nv: nv * 2,
      uv: (u, v, p) => [u * texel * 2, v * texel * 2],
      mask: o.mask,
    },
  );
}

/** Tapered spike — barbs, spines, horns, mandibles, claws. */
export function spike(b: SurfaceBuilder, from: V3, to: V3, r0: number, curve: number, mask?: Mask): void {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const len = Math.hypot(dx, dy, dz) || 1e-4;
  const mid: V3 = [
    (from[0] + to[0]) * 0.5,
    (from[1] + to[1]) * 0.5 + curve * len,
    (from[2] + to[2]) * 0.5,
  ];
  const s = new Spine([from, mid, to], 16);
  if (mask !== undefined) b.setMask(mask);
  tube(b, s, {
    nu: 8,
    nv: 12,
    radius: (v) => r0 * Math.pow(1 - v, 0.7) + 0.002,
    capA: true,
    texel: 3,
  });
}
