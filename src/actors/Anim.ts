import * as THREE from 'three';
import type { TerrainQuery } from '../core/types';
import { aimBone, Rig } from './Rig';
import type { LegDef, SpeciesDef } from './Species';

/**
 * Procedural animation.
 *
 * No clips anywhere: every pose is generated from a phase, and the phases are
 * driven by how far the actor has actually travelled. That is the mechanism
 * that kills foot skate — a stance foot is pinned to a world position and the
 * body moves past it, rather than a canned cycle being played at whatever rate
 * and hoping it matches.
 *
 * Three layers, in order:
 *   1. FK pose  — idle / locomotion / turn generators, crossfaded.
 *   2. IK       — two-bone leg solve onto the terrain, then pelvis drop.
 *   3. Look-at  — head tracking inside a cone, on top of everything.
 */

/** Per-bone local rotations, laid out flat for cheap blending. */
export class Pose {
  readonly q: Float32Array;
  constructor(readonly n: number) {
    this.q = new Float32Array(n * 4);
    this.identity();
  }
  identity(): void {
    for (let i = 0; i < this.n; i++) {
      this.q[i * 4] = 0;
      this.q[i * 4 + 1] = 0;
      this.q[i * 4 + 2] = 0;
      this.q[i * 4 + 3] = 1;
    }
  }
  setEuler(i: number, x: number, y: number, z: number): void {
    // ZYX order, inlined: this runs for every bone of every actor every frame.
    const c1 = Math.cos(x * 0.5), s1 = Math.sin(x * 0.5);
    const c2 = Math.cos(y * 0.5), s2 = Math.sin(y * 0.5);
    const c3 = Math.cos(z * 0.5), s3 = Math.sin(z * 0.5);
    const o = i * 4;
    this.q[o] = s1 * c2 * c3 + c1 * s2 * s3;
    this.q[o + 1] = c1 * s2 * c3 - s1 * c2 * s3;
    this.q[o + 2] = c1 * c2 * s3 + s1 * s2 * c3;
    this.q[o + 3] = c1 * c2 * c3 - s1 * s2 * s3;
  }
}

/**
 * Normalised accumulation blend. Slerping by w/(acc+w) as each source arrives
 * gives the same answer as a weighted average without ever materialising one,
 * and it degrades gracefully when the weights do not sum to 1.
 */
export function blendPose(dst: Pose, src: Pose, w: number, acc: number): number {
  if (w <= 1e-5) return acc;
  if (acc <= 1e-5) {
    dst.q.set(src.q);
    return w;
  }
  const t = w / (acc + w);
  const n = dst.n;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let ax = dst.q[o], ay = dst.q[o + 1], az = dst.q[o + 2], aw = dst.q[o + 3];
    let bx = src.q[o], by = src.q[o + 1], bz = src.q[o + 2], bw = src.q[o + 3];
    let cos = ax * bx + ay * by + az * bz + aw * bw;
    if (cos < 0) {
      bx = -bx; by = -by; bz = -bz; bw = -bw;
      cos = -cos;
    }
    let s0: number;
    let s1: number;
    if (cos > 0.9995) {
      s0 = 1 - t;
      s1 = t;
    } else {
      const theta = Math.acos(cos);
      const sin = Math.sin(theta);
      s0 = Math.sin((1 - t) * theta) / sin;
      s1 = Math.sin(t * theta) / sin;
    }
    ax = ax * s0 + bx * s1;
    ay = ay * s0 + by * s1;
    az = az * s0 + bz * s1;
    aw = aw * s0 + bw * s1;
    const inv = 1 / (Math.hypot(ax, ay, az, aw) || 1);
    dst.q[o] = ax * inv;
    dst.q[o + 1] = ay * inv;
    dst.q[o + 2] = az * inv;
    dst.q[o + 3] = aw * inv;
  }
  return acc + w;
}

export function applyPose(rig: Rig, p: Pose): void {
  for (let i = 0; i < rig.bones.length; i++) {
    const o = i * 4;
    rig.bones[i].quaternion.set(p.q[o], p.q[o + 1], p.q[o + 2], p.q[o + 3]);
  }
}

/* ------------------------------------------------------------- generators */

/**
 * Bone indices resolved once per species. Generators run every frame for every
 * skinned actor, so they take resolved indices rather than looking names up.
 */
export interface SpeciesIndex {
  spine: number[];
  whips: number[][];
  wings: number[][];
  head: number;
  legs: { upper: number; lower: number; foot: number }[];
  boneCount: number;
}

export interface GenInput {
  t: number;
  /** Distance-driven gait phase in cycles. */
  phase: number;
  /** Ground speed in metres/second. */
  speed: number;
  /** Signed turn rate, radians/second. */
  turn: number;
  /** 0..1 how alarmed the actor is; tightens and speeds up the idle. */
  alarm: number;
  seed: number;
}

const TAU = Math.PI * 2;

/**
 * Idle: breathing through the spine, a slow weight shift, and enough
 * asymmetry (driven by the actor's seed) that a herd does not pulse in unison.
 */
export function genIdle(ix: SpeciesIndex, def: SpeciesDef, g: GenInput, out: Pose): void {
  out.identity();
  const br = Math.sin(g.t * (0.55 + 0.2 * g.alarm) + g.seed * 6.3);
  const sway = Math.sin(g.t * 0.31 + g.seed * 4.1);

  for (let i = 0; i < ix.spine.length; i++) {
    const bi = ix.spine[i];
    const f = i / Math.max(1, ix.spine.length - 1);
    out.setEuler(bi, br * 0.022 * (1 - f * 0.4), sway * 0.03 * f, sway * 0.018);
  }
  for (const chain of ix.whips) {
    for (let i = 0; i < chain.length; i++) {
      const bi = chain[i];
      const lag = i * 0.55;
      const a = 0.05 + 0.035 * i;
      out.setEuler(bi, Math.sin(g.t * 0.7 - lag + g.seed) * a * 0.4, Math.sin(g.t * 0.5 - lag + g.seed * 2) * a, 0);
    }
  }
  for (let w = 0; w < ix.wings.length; w++) {
    const s = w === 0 ? 1 : -1;
    const chain = ix.wings[w];
    for (let i = 0; i < chain.length; i++) {
      const bi = chain[i];
      // Held out flat, not folded: a cliff racer at rest is a bird gliding, and
      // a folded-wing idle reads as a dead animal falling out of the sky.
      out.setEuler(bi, 0, 0, s * (0.05 + i * 0.015) + s * Math.sin(g.t * 0.6 - i * 0.4) * 0.045);
    }
  }
}

/**
 * Locomotion: a counter-rotating spine wave, limb-synchronised body roll, and
 * a travelling wave down every whip chain. Leg joints are NOT posed here — the
 * IK stage owns them, so the FK layer can never fight the foot placement.
 */
export function genLocomotion(ix: SpeciesIndex, def: SpeciesDef, g: GenInput, out: Pose): void {
  out.identity();
  const ph = g.phase * TAU;
  const gait = def.locomotion;
  const norm = THREE.MathUtils.clamp(g.speed / Math.max(def.runSpeed, 0.01), 0, 1.2);

  if (gait === 'ground') {
    const n = ix.spine.length;
    for (let i = 0; i < n; i++) {
      const bi = ix.spine[i];
      const f = i / Math.max(1, n - 1);
      // The wave travels head-ward, and the yaw component is what makes a
      // quadruped's shoulders lead its hips through a stride.
      const yaw = Math.sin(ph - f * 1.1) * 0.055 * norm;
      const pitch = Math.sin(ph * 2 - f * 0.8) * 0.03 * norm;
      const roll = Math.sin(ph - f * 0.6) * 0.05 * norm;
      out.setEuler(bi, pitch, yaw, roll);
    }
  } else if (gait === 'fly') {
    for (let w = 0; w < ix.wings.length; w++) {
      const s = w === 0 ? 1 : -1;
      const chain = ix.wings[w];
      for (let i = 0; i < chain.length; i++) {
        const bi = chain[i];
        // Each joint lags the one inboard of it. That lag IS the flap: the
        // membrane snaps taut on the downstroke and cups on the upstroke.
        const lag = i * 0.85;
        const amp = 0.85 - i * 0.16;
        const beat = Math.sin(ph - lag);
        // Asymmetric: fast down, slow recovery, like a real membranous wing.
        const shaped = beat > 0 ? Math.pow(beat, 0.7) : -Math.pow(-beat, 1.5);
        out.setEuler(bi, 0, i === 0 ? shaped * 0.12 : 0, s * (shaped * amp + 0.12));
      }
    }
    const n = ix.spine.length;
    for (let i = 0; i < n; i++) {
      const bi = ix.spine[i];
      out.setEuler(bi, Math.sin(ph * 2) * 0.05, 0, 0);
    }
  } else {
    // Drift: the netch bell pulses like a jellyfish, slowly and out of phase
    // with its own tentacles.
    for (let i = 0; i < ix.spine.length; i++) {
      const bi = ix.spine[i];
      out.setEuler(bi, Math.sin(g.t * 0.42 + g.seed) * 0.05, 0, Math.cos(g.t * 0.33 + g.seed) * 0.05);
    }
  }

  const drift = gait === 'drift';
  const whipAmp = drift ? 1.5 : 0.35 + 0.9 * norm;
  const whipRate = drift ? 0.55 : 1;
  for (let c = 0; c < ix.whips.length; c++) {
    const chain = ix.whips[c];
    const off = c * 1.9;
    for (let i = 0; i < chain.length; i++) {
      const bi = chain[i];
      const lag = i * 0.75;
      // A drifting animal's tentacles are not a tail. A tail is driven from its
      // root and damps toward the tip; a tentacle hanging in air is driven by
      // drag and damps toward the ROOT, so the amplitude has to grow down the
      // chain or the curtain is a set of rigid rods with a slight wobble at the
      // top — which is what the review measured. Compounded over four joints a
      // 0.09 -> 0.30 rad ramp is most of a right angle of curl at the tip.
      const a = drift ? (0.06 + 0.14 * i) * whipAmp : (0.06 + 0.05 * i) * whipAmp;
      const p = drift ? g.t * whipRate * TAU * 0.18 + off : ph * 0.5 + off;
      out.setEuler(bi, Math.sin(p - lag) * a * 0.6, Math.sin(p - lag + 1.2) * a, 0);
    }
  }
}

/** Turn: bank into the corner. Fliers roll hard, walkers only lean. */
export function genTurn(ix: SpeciesIndex, def: SpeciesDef, g: GenInput, out: Pose): void {
  out.identity();
  const bank = THREE.MathUtils.clamp(g.turn * (def.locomotion === 'fly' ? 1.1 : 0.35), -1.0, 1.0);
  for (let i = 0; i < ix.spine.length; i++) {
    const bi = ix.spine[i];
    const f = i / Math.max(1, ix.spine.length - 1);
    out.setEuler(bi, 0, -bank * 0.12 * (1 - f), -bank * (0.35 - 0.15 * f));
  }
  for (const chain of ix.whips) {
    for (let i = 0; i < chain.length; i++) {
      out.setEuler(chain[i], 0, bank * 0.16, -bank * 0.08);
    }
  }
}

/* -------------------------------------------------------------------- IK */

export interface FootState {
  /** World position the foot is pinned to while in stance. */
  planted: THREE.Vector3;
  /** Lift-off position of the current swing. */
  from: THREE.Vector3;
  /** Touch-down position of the current swing. */
  to: THREE.Vector3;
  /** Where the solver is actually driving the effector this frame. */
  target: THREE.Vector3;
  /** Previous cycle phase, for detecting the stance/swing transitions. */
  prevPhase: number;
  init: boolean;
}

export function makeFootStates(n: number): FootState[] {
  return Array.from({ length: n }, () => ({
    planted: new THREE.Vector3(),
    from: new THREE.Vector3(),
    to: new THREE.Vector3(),
    target: new THREE.Vector3(),
    prevPhase: 0,
    init: false,
  }));
}

const _hip = new THREE.Vector3();
const _knee = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _tmp = new THREE.Vector3();
const _anchor = new THREE.Vector3();

/**
 * Analytic two-bone IK.
 *
 * Solved in world space against the bone matrices three already maintains, and
 * written back as local rotations. The knee is placed by rotating the
 * hip->target direction in the plane containing the pole vector, which is what
 * stops a leg from flipping its bend direction between frames — the failure
 * that reads instantly as "amateur rig".
 */
export function solveTwoBone(
  rig: Rig,
  upper: number,
  lower: number,
  target: THREE.Vector3,
  poleWorld: THREE.Vector3,
  scale: number,
): void {
  const bUpper = rig.bones[upper];
  const bLower = rig.bones[lower];
  const l1 = rig.length(rig.defs[upper].name) * scale;
  const l2 = rig.length(rig.defs[lower].name) * scale;

  bUpper.matrixWorld.decompose(_hip, _q1, _tmp);
  _dir.subVectors(target, _hip);
  let d = _dir.length();
  if (d < 1e-5) return;
  const dMax = (l1 + l2) * 0.999;
  const dMin = Math.abs(l1 - l2) * 1.001 + 1e-4;
  d = THREE.MathUtils.clamp(d, dMin, dMax);
  _dir.normalize();

  const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const a = Math.acos(cosA);

  // Bend plane: perpendicular to (direction, pole). A pole parallel to the
  // limb axis is degenerate, so fall back to a stable world perpendicular.
  _pole.copy(poleWorld);
  _pole.addScaledVector(_dir, -_pole.dot(_dir));
  if (_pole.lengthSq() < 1e-8) {
    _pole.set(0, 1, 0).addScaledVector(_dir, -_dir.y);
    if (_pole.lengthSq() < 1e-8) _pole.set(1, 0, 0).addScaledVector(_dir, -_dir.x);
  }
  _pole.normalize();
  _axis.crossVectors(_dir, _pole).normalize();

  _q2.setFromAxisAngle(_axis, -a);
  _knee.copy(_dir).applyQuaternion(_q2);
  if (_knee.dot(_pole) < 0) {
    _q2.setFromAxisAngle(_axis, a);
    _knee.copy(_dir).applyQuaternion(_q2);
  }
  _knee.multiplyScalar(l1).add(_hip);

  const parent = bUpper.parent;
  if (parent !== null) parent.getWorldQuaternion(_q1);
  else _q1.identity();
  _tmp.subVectors(_knee, _hip);
  aimBone(rig, upper, _tmp, _q1);
  bUpper.updateMatrixWorld(true);

  bUpper.getWorldQuaternion(_q1);
  _tmp.subVectors(target, _knee);
  aimBone(rig, lower, _tmp, _q1);
  bLower.updateMatrixWorld(true);
}

/**
 * Advance one leg's gait state and produce this frame's world-space IK target.
 *
 * `phase` is in cycles and comes from distance travelled, so the stance foot is
 * genuinely stationary in world space for the whole stance — the definition of
 * not skating.
 */
export function stepFoot(
  st: FootState,
  leg: LegDef,
  def: SpeciesDef,
  phase: number,
  actorPos: THREE.Vector3,
  yawQ: THREE.Quaternion,
  vel: THREE.Vector3,
  scale: number,
  terrain: TerrainQuery,
  dt: number,
): void {
  // Neutral stance position for this leg, in world space, pushed forward by
  // half a stance so the foot lands ahead of the body and is left behind it.
  _anchor.set(leg.rest[0] * scale, 0, leg.rest[2] * scale).applyQuaternion(yawQ).add(actorPos);
  const cyclesPerSec = vel.length() / Math.max(def.stride * scale, 0.001);
  const stanceTime = cyclesPerSec > 1e-4 ? def.duty / cyclesPerSec : 0;
  _anchor.addScaledVector(vel, stanceTime * 0.5);
  _anchor.y = terrain.heightAt(_anchor.x, _anchor.z) + leg.lift * scale;

  const p = phase - Math.floor(phase);

  if (!st.init) {
    st.planted.copy(_anchor);
    st.from.copy(_anchor);
    st.to.copy(_anchor);
    st.target.copy(_anchor);
    st.prevPhase = p;
    st.init = true;
    return;
  }

  const wrapped = p < st.prevPhase;
  const enteredSwing = (st.prevPhase < def.duty && p >= def.duty) || (wrapped && st.prevPhase < def.duty);
  const enteredStance = wrapped && st.prevPhase >= def.duty;

  if (enteredSwing) {
    st.from.copy(st.planted);
    st.to.copy(_anchor);
  }
  if (enteredStance) {
    st.planted.copy(st.to);
    st.planted.y = terrain.heightAt(st.planted.x, st.planted.z) + leg.lift * scale;
  }
  st.prevPhase = p;

  if (p >= def.duty) {
    const s = (p - def.duty) / Math.max(1e-4, 1 - def.duty);
    // Re-aim the touchdown continuously; the body may have turned mid-swing.
    st.to.lerp(_anchor, Math.min(1, dt * 8));
    st.target.lerpVectors(st.from, st.to, s * s * (3 - 2 * s));
    const lift = Math.sin(s * Math.PI);
    st.target.y += def.step * scale * lift;
    // Clear the ground under the arc, not just at the endpoints — otherwise a
    // foot swings straight through a rock.
    const gy = terrain.heightAt(st.target.x, st.target.z) + leg.lift * scale;
    st.target.y = Math.max(st.target.y, gy + def.step * scale * 0.25 * lift);
  } else {
    st.planted.y = terrain.heightAt(st.planted.x, st.planted.z) + leg.lift * scale;
    st.target.copy(st.planted);
    // Standing still: drift the plant back to neutral so a stopped animal does
    // not keep a leg stranded wherever the last stride left it.
    if (cyclesPerSec < 0.05) {
      st.planted.lerp(_anchor, Math.min(1, dt * 1.6));
      st.target.copy(st.planted);
    }
  }
}

/* --------------------------------------------------------------- look-at */

const _fwd = new THREE.Vector3();
const _want = new THREE.Vector3();
const _cur = new THREE.Vector3();
const _qBefore = new THREE.Quaternion();

/**
 * Cone-limited head tracking. The head keeps its own smoothed direction rather
 * than snapping to the target, and the cone is enforced against the actor's
 * forward so nothing ever looks over its own shoulder through its neck.
 */
export function lookAt(
  rig: Rig,
  headIdx: number,
  focus: THREE.Vector3,
  forward: THREE.Vector3,
  smoothed: THREE.Vector3,
  coneCos: number,
  weight: number,
  dt: number,
): void {
  const bone = rig.bones[headIdx];
  bone.matrixWorld.decompose(_cur, _q1, _tmp);
  _want.subVectors(focus, _cur);
  if (_want.lengthSq() < 1e-6) return;
  _want.normalize();

  _fwd.copy(forward).normalize();
  const dot = _want.dot(_fwd);
  if (dot < coneCos) {
    // Outside the cone: slide the target onto the cone boundary in the plane
    // the two directions span, so tracking eases off instead of clipping.
    _tmp.copy(_want).addScaledVector(_fwd, -dot);
    if (_tmp.lengthSq() < 1e-8) _tmp.set(0, 1, 0).addScaledVector(_fwd, -_fwd.y);
    _tmp.normalize();
    const sin = Math.sqrt(Math.max(0, 1 - coneCos * coneCos));
    _want.copy(_fwd).multiplyScalar(coneCos).addScaledVector(_tmp, sin);
  }

  if (smoothed.lengthSq() < 1e-8) smoothed.copy(_fwd);
  smoothed.lerp(_want, Math.min(1, dt * 4)).normalize();

  const parent = bone.parent;
  if (parent !== null) parent.getWorldQuaternion(_q1);
  else _q1.identity();

  // Blend the aim in rather than overwriting: at weight 0 the FK pose stands.
  _qBefore.copy(bone.quaternion);
  aimBone(rig, headIdx, smoothed, _q1);
  bone.quaternion.slerp(_qBefore, 1 - THREE.MathUtils.clamp(weight, 0, 1));
  bone.updateMatrixWorld(true);
}
