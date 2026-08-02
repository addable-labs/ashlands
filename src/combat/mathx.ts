import * as THREE from 'three';

/**
 * Geometry and numeric primitives for combat and physics.
 *
 * Everything here is allocation-free on the hot path: the scratch vectors are
 * module-local and every routine writes into caller-supplied outputs. Combat
 * runs closest-point tests on a dozen capsules per swing substep, and a single
 * `new THREE.Vector3()` in that loop is a garbage collection pause during the
 * one moment of the game where a hitch is unforgivable.
 */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Ease that starts fast and settles — the shape of a released swing. */
export function easeOutCubic(t: number): number {
  const x = 1 - clamp(t, 0, 1);
  return 1 - x * x * x;
}

/** Ease that starts slow — the shape of a windup being pulled back. */
export function easeInQuad(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x;
}

/**
 * Frame-rate independent exponential approach. `rate` is the reciprocal of the
 * time constant, so the result is identical at 30 and 144 fps.
 */
export function approach(cur: number, target: number, rate: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

export function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * Deterministic stream. Combat rolls must replay identically from a save, so
 * every random draw in the subsystem comes from one of these and the cursor is
 * serialised with the rest of the state.
 */
export class Rand {
  constructor(private state: number) {
    this.state = (state >>> 0) || 1;
  }
  next(): number {
    // xorshift32 — 4 ops, no multiply-heavy mixing needed for gameplay rolls.
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  int(n: number): number {
    return Math.min(n - 1, Math.floor(this.next() * n));
  }
  get seed(): number {
    return this.state;
  }
  set seed(v: number) {
    this.state = (v >>> 0) || 1;
  }
}

const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _bc = new THREE.Vector3();
const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _r = new THREE.Vector3();

/** Closest point on segment [a,b] to p. Returns the parameter along the segment. */
export function closestOnSegment(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3, out: THREE.Vector3): number {
  _ab.subVectors(b, a);
  const l2 = _ab.lengthSq();
  const t = l2 > 1e-12 ? clamp(_ac.subVectors(p, a).dot(_ab) / l2, 0, 1) : 0;
  out.copy(a).addScaledVector(_ab, t);
  return t;
}

/**
 * Closest points between segments [p1,q1] and [p2,q2]. Ericson's clamped
 * parametric solve — branchy but exact, and exactness matters here because a
 * near-miss and a hit are one millimetre apart at the tip of a blade.
 * Returns the squared distance between the closest points.
 */
export function closestSegSeg(
  p1: THREE.Vector3,
  q1: THREE.Vector3,
  p2: THREE.Vector3,
  q2: THREE.Vector3,
  outA: THREE.Vector3,
  outB: THREE.Vector3,
): number {
  _d1.subVectors(q1, p1);
  _d2.subVectors(q2, p2);
  _r.subVectors(p1, p2);
  const a = _d1.lengthSq();
  const e = _d2.lengthSq();
  const f = _d2.dot(_r);
  let s = 0;
  let t = 0;

  if (a <= 1e-12 && e <= 1e-12) {
    outA.copy(p1);
    outB.copy(p2);
    return _r.lengthSq();
  }
  if (a <= 1e-12) {
    t = clamp(f / e, 0, 1);
  } else {
    const c = _d1.dot(_r);
    if (e <= 1e-12) {
      s = clamp(-c / a, 0, 1);
    } else {
      const b = _d1.dot(_d2);
      const denom = a * e - b * b;
      s = denom > 1e-12 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  outA.copy(p1).addScaledVector(_d1, s);
  outB.copy(p2).addScaledVector(_d2, t);
  return outA.distanceToSquared(outB);
}

/** Squared distance from p to segment [a,b]. */
export function distSqPointSegment(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3): number {
  _ab.subVectors(b, a);
  _ac.subVectors(p, a);
  const l2 = _ab.lengthSq();
  const t = l2 > 1e-12 ? clamp(_ac.dot(_ab) / l2, 0, 1) : 0;
  _bc.copy(_ac).addScaledVector(_ab, -t);
  return _bc.lengthSq();
}

/**
 * Signed angle of `v` about `axis`, measured from `ref`. Used for attack arcs
 * and for the cone limit on ragdoll joints.
 */
export function signedAngle(v: THREE.Vector3, ref: THREE.Vector3, axis: THREE.Vector3): number {
  const c = _ab.copy(ref).cross(v).dot(axis);
  return Math.atan2(c, ref.dot(v));
}

/**
 * Constrain `dir` to lie within `maxAngle` of `axis`, in place. Returns true if
 * it had to be clamped — the ragdoll uses that to know a joint hit its stop and
 * should bleed velocity rather than bounce.
 */
export function coneClamp(dir: THREE.Vector3, axis: THREE.Vector3, maxAngle: number): boolean {
  const len = dir.length();
  if (len < 1e-9) return false;
  dir.multiplyScalar(1 / len);
  const c = clamp(dir.dot(axis), -1, 1);
  const ang = Math.acos(c);
  if (ang <= maxAngle) {
    dir.multiplyScalar(len);
    return false;
  }
  // Rotate `dir` back toward `axis` about their common perpendicular. When the
  // two are antiparallel any perpendicular will do, so pick a stable one.
  _ac.copy(axis).cross(dir);
  if (_ac.lengthSq() < 1e-12) _ac.set(axis.z, axis.x, axis.y).cross(axis);
  _ac.normalize();
  dir.copy(axis).applyAxisAngle(_ac, maxAngle).multiplyScalar(len);
  return true;
}

/**
 * Earliest intersection of a sphere of radius `rad` moving from `from` to `to`
 * against an infinite plane through `pt` with normal `n`. Returns the fraction
 * of the motion, or -1 if it does not cross.
 */
export function sweptSpherePlane(
  from: THREE.Vector3,
  to: THREE.Vector3,
  pt: THREE.Vector3,
  n: THREE.Vector3,
  rad: number,
): number {
  const d0 = _ab.subVectors(from, pt).dot(n) - rad;
  const d1 = _ac.subVectors(to, pt).dot(n) - rad;
  if (d0 <= 0) return 0;
  if (d1 > 0) return -1;
  return d0 / (d0 - d1);
}

/** Reflect `v` about the plane with normal `n`, keeping `bounce` of the normal component. */
export function reflect(v: THREE.Vector3, n: THREE.Vector3, bounce: number, friction: number): void {
  const vn = v.dot(n);
  // Split into normal and tangential parts so restitution and friction can be
  // tuned independently — a shield of iron rings and stops, sand just stops.
  _ab.copy(n).multiplyScalar(vn);
  _ac.subVectors(v, _ab);
  _ac.multiplyScalar(1 - friction);
  v.copy(_ac).addScaledVector(n, -vn * bounce);
}

const _qa = new THREE.Quaternion();
const _va = new THREE.Vector3();

/**
 * Minimal ("swing only") rotation taking `from` to `to`. A particle chain has
 * no twist degree of freedom, so deriving bone orientation this way is the only
 * choice that cannot introduce roll the solver never simulated.
 */
export function swingQuat(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const d = clamp(from.dot(to), -1, 1);
  if (d > 0.999999) return out.identity();
  if (d < -0.999999) {
    _va.set(1, 0, 0);
    if (Math.abs(from.x) > 0.9) _va.set(0, 1, 0);
    _va.cross(from).normalize();
    return out.setFromAxisAngle(_va, Math.PI);
  }
  _va.copy(from).cross(to);
  out.set(_va.x, _va.y, _va.z, 1 + d).normalize();
  return out;
}

/** Rotate `q` by `angle` about its own local `axis`. Used for the twist joint. */
export function twistAbout(q: THREE.Quaternion, axis: THREE.Vector3, angle: number): void {
  _qa.setFromAxisAngle(axis, angle);
  q.multiply(_qa);
}
