import * as THREE from 'three';
import type { TerrainQuery } from '../core/types';
import { clamp, coneClamp, smoothstep, swingQuat } from './mathx';
import type { ActorLike } from './Targets';

/**
 * Ragdolls.
 *
 * A compact position-based-dynamics solver rather than a physics library: the
 * whole thing is one particle per bone, Verlet integration, and three kinds of
 * constraint — distance along each bone, a cone limit at each joint, and a
 * damped twist about each bone's own axis. Twenty iterations of that over a
 * forty-bone silt strider costs less than the skinning pass that draws it, and
 * it cannot explode, because PBD projects positions rather than integrating
 * forces.
 *
 * The important part is the blend. A body that snaps from a running animation
 * into a limp doll on the frame it dies is the tell of a cheap engine. Here the
 * solver is seeded from the exact animated pose, with the animation's own
 * velocity and the killing blow's impulse, and the written-back transform
 * crossfades from animated to simulated over a quarter second. The creature
 * *becomes* dead weight instead of being replaced by it.
 *
 * Write-back is exact in position and approximate in rotation: every bone's
 * local translation is taken straight from its particle, so the drawn skeleton
 * is exactly the simulated one, while each bone's rotation is the minimal swing
 * that aims it at its primary child. A particle chain has no twist degree of
 * freedom, so the twist term is carried explicitly and applied on top.
 */

const GRAVITY = -13.5;
/** Solver iterations. Below six, long chains stretch visibly on impact. */
const ITERATIONS = 7;
const BLEND_IN = 0.26;
/** Seconds of simulation before the pose is frozen where it lies. */
const SIM_SECONDS = 9;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _qs = new THREE.Quaternion();
const _rest = new THREE.Vector3();
const _mat = new THREE.Matrix4();

interface Cone {
  /** Bone whose direction is limited. */
  child: number;
  joint: number;
  grand: number;
  limit: number;
}

export class Ragdoll {
  readonly actorId: number;
  private bones: THREE.Bone[] = [];
  private parent: Int32Array;
  private primary: Int32Array;
  private restLen: Float32Array;
  /** Rest direction of each bone in its parent's local frame. */
  private restDir: Float32Array;
  private pos: Float32Array;
  private prev: Float32Array;
  private invMass: Float32Array;
  private cones: Cone[] = [];
  private twist: Float32Array;
  private twistVel: Float32Array;
  private twistLimit: Float32Array;
  private root: THREE.Object3D;
  private scale = 1;
  private blend = 0;
  private age = 0;
  private settled = false;
  private culled = false;
  /** Rough body radius, used for the ground contact offset. */
  private thickness: Float32Array;
  /** Accumulated world rotations, one per bone. Allocated once, reused. */
  private worldQ: THREE.Quaternion[] = [];

  constructor(actor: ActorLike, bones: THREE.Bone[], impulse: THREE.Vector3, inherit: THREE.Vector3, hitAt: THREE.Vector3) {
    this.actorId = actor.id;
    this.root = actor.root;
    this.bones = bones;
    const n = bones.length;

    this.parent = new Int32Array(n).fill(-1);
    this.primary = new Int32Array(n).fill(-1);
    this.restLen = new Float32Array(n);
    this.restDir = new Float32Array(n * 3);
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.invMass = new Float32Array(n);
    this.twist = new Float32Array(n);
    this.twistVel = new Float32Array(n);
    this.twistLimit = new Float32Array(n);
    this.thickness = new Float32Array(n);

    const index = new Map<THREE.Bone, number>();
    for (let i = 0; i < n; i++) index.set(bones[i], i);

    this.root.updateWorldMatrix(true, true);
    _v.setFromMatrixScale(this.root.matrixWorld);
    this.scale = Math.max(0.01, (_v.x + _v.y + _v.z) / 3);

    for (let i = 0; i < n; i++) {
      const b = bones[i];
      const p = b.parent;
      const pi = p !== null && p instanceof THREE.Bone ? (index.get(p) ?? -1) : -1;
      this.parent[i] = pi;
      if (pi >= 0 && this.primary[pi] < 0) this.primary[pi] = i;

      b.getWorldPosition(_v);
      this.pos[i * 3] = _v.x;
      this.pos[i * 3 + 1] = _v.y;
      this.pos[i * 3 + 2] = _v.z;

      // Rest direction and length come from the bone's own local translation,
      // which every rig in the game restores before posing — so this is the
      // bind-pose skeleton, read without needing the rig definition.
      _rest.copy(b.position);
      const len = _rest.length();
      this.restLen[i] = len * this.scale;
      if (len > 1e-6) _rest.multiplyScalar(1 / len);
      this.restDir[i * 3] = _rest.x;
      this.restDir[i * 3 + 1] = _rest.y;
      this.restDir[i * 3 + 2] = _rest.z;

      // Mass falls off along the chain: a torso should not be flung about by
      // its own tail, but a tail must whip.
      const depth = this.depthOf(i);
      this.invMass[i] = pi < 0 ? 0.35 : clamp(0.5 + depth * 0.55, 0.5, 3.2);
      this.thickness[i] = clamp(this.restLen[i] * 0.45, 0.05, 0.4);
      this.twistLimit[i] = 0.9;
    }

    // Cone limits: every three-bone run gets one. A joint that can fold through
    // itself is the difference between a corpse and a bag of spaghetti.
    for (let i = 0; i < n; i++) {
      const j = this.parent[i];
      if (j < 0) continue;
      const g = this.parent[j];
      if (g < 0) continue;
      // Limbs hinge hard, spines bend a little, whips bend freely.
      const name = bones[i].name;
      const limit = name.endsWith('.b') || name.endsWith('.c') ? 1.5 : name.startsWith('tail') || name.startsWith('wing') ? 1.9 : 1.0;
      this.cones.push({ child: i, joint: j, grand: g, limit });
    }

    // Seed velocity: the animation's own motion plus the killing blow, falling
    // off with distance from where the blow landed so a headshot snaps the neck
    // and a leg hit sweeps the legs.
    for (let i = 0; i < n; i++) {
      _v.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      const d = _v.distanceTo(hitAt);
      const w = 1 / (1 + d * d * 2.2);
      _w.copy(inherit).addScaledVector(impulse, w * this.invMass[i]);
      this.prev[i * 3] = this.pos[i * 3] - _w.x * 0.016;
      this.prev[i * 3 + 1] = this.pos[i * 3 + 1] - _w.y * 0.016;
      this.prev[i * 3 + 2] = this.pos[i * 3 + 2] - _w.z * 0.016;
      // Tangential component of the blow becomes spin about the bone.
      this.twistVel[i] = clamp(impulse.x * 0.1 - impulse.z * 0.1, -6, 6) * w;
    }

    // The skinned bounds were computed for the bind pose; a sprawled ragdoll
    // reaches outside them and would pop out at the frustum edge.
    this.root.traverse((o) => {
      const sk = o as THREE.SkinnedMesh;
      if (sk.isSkinnedMesh) {
        sk.frustumCulled = false;
        this.culled = true;
      }
    });
  }

  private depthOf(i: number): number {
    let d = 0;
    let k = this.parent[i];
    while (k >= 0 && d < 12) {
      d++;
      k = this.parent[k];
    }
    return d;
  }

  get done(): boolean {
    return this.age > SIM_SECONDS + 6;
  }

  /** Simulate and write the result back over the animated pose. */
  step(dt: number, terrain: TerrainQuery | null): void {
    this.age += dt;
    this.blend = Math.min(1, this.blend + dt / BLEND_IN);

    if (!this.settled && this.age < SIM_SECONDS) this.integrate(dt, terrain);
    else this.settled = true;

    this.writeBack();
  }

  private integrate(dt: number, terrain: TerrainQuery | null): void {
    const n = this.bones.length;
    const p = this.pos;
    const q = this.prev;
    // Verlet with velocity damping folded into the previous-position blend.
    const damp = Math.exp(-1.1 * dt);
    const g = GRAVITY * dt * dt;

    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const vx = (p[k] - q[k]) * damp;
      const vy = (p[k + 1] - q[k + 1]) * damp;
      const vz = (p[k + 2] - q[k + 2]) * damp;
      q[k] = p[k];
      q[k + 1] = p[k + 1];
      q[k + 2] = p[k + 2];
      p[k] += vx;
      p[k + 1] += vy + g;
      p[k + 2] += vz;
      this.twist[i] += this.twistVel[i] * dt;
      this.twistVel[i] *= Math.exp(-4.5 * dt);
      const lim = this.twistLimit[i];
      if (this.twist[i] > lim) {
        this.twist[i] = lim;
        this.twistVel[i] *= -0.2;
      } else if (this.twist[i] < -lim) {
        this.twist[i] = -lim;
        this.twistVel[i] *= -0.2;
      }
    }

    for (let it = 0; it < ITERATIONS; it++) {
      // --- distance: the bones themselves.
      for (let i = 0; i < n; i++) {
        const j = this.parent[i];
        if (j < 0 || this.restLen[i] < 1e-5) continue;
        const a = i * 3;
        const b = j * 3;
        let dx = p[a] - p[b];
        let dy = p[a + 1] - p[b + 1];
        let dz = p[a + 2] - p[b + 2];
        const d = Math.hypot(dx, dy, dz);
        if (d < 1e-6) continue;
        const err = (d - this.restLen[i]) / d;
        const wi = this.invMass[i];
        const wj = this.invMass[j];
        const sum = wi + wj;
        if (sum < 1e-6) continue;
        dx *= err;
        dy *= err;
        dz *= err;
        const fi = wi / sum;
        const fj = wj / sum;
        p[a] -= dx * fi;
        p[a + 1] -= dy * fi;
        p[a + 2] -= dz * fi;
        p[b] += dx * fj;
        p[b + 1] += dy * fj;
        p[b + 2] += dz * fj;
      }

      // --- cone: how far a joint may fold.
      for (const c of this.cones) {
        const a = c.child * 3;
        const b = c.joint * 3;
        const g2 = c.grand * 3;
        _axis.set(p[b] - p[g2], p[b + 1] - p[g2 + 1], p[b + 2] - p[g2 + 2]);
        if (_axis.lengthSq() < 1e-10) continue;
        _axis.normalize();
        _dir.set(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]);
        if (coneClamp(_dir, _axis, c.limit)) {
          p[a] = p[b] + _dir.x;
          p[a + 1] = p[b + 1] + _dir.y;
          p[a + 2] = p[b + 2] + _dir.z;
        }
      }

      // --- ground: the only external collider a corpse needs.
      if (terrain !== null) {
        for (let i = 0; i < n; i++) {
          const k = i * 3;
          const h = terrain.heightAt(p[k], p[k + 2]) + this.thickness[i];
          if (p[k + 1] < h) {
            p[k + 1] = h;
            // Tangential friction: dead things do not slide down the ash.
            const fx = (p[k] - q[k]) * 0.55;
            const fz = (p[k + 2] - q[k + 2]) * 0.55;
            q[k] = p[k] - fx * 0.35;
            q[k + 2] = p[k + 2] - fz * 0.35;
            q[k + 1] = p[k + 1];
          }
        }
      }
    }
  }

  /**
   * Convert particles to bone transforms and crossfade onto whatever the
   * animation system left in the skeleton this frame.
   */
  private writeBack(): void {
    const n = this.bones.length;
    if (n === 0) return;
    this.root.updateWorldMatrix(true, false);
    _mat.copy(this.root.matrixWorld).invert();

    const t = smoothstep(this.blend);
    const worldQ = this.worldQ;
    while (worldQ.length < n) worldQ.push(new THREE.Quaternion());

    this.root.getWorldQuaternion(_qp);

    for (let i = 0; i < n; i++) {
      const bone = this.bones[i];
      const pi = this.parent[i];
      const parentWorld = pi >= 0 ? worldQ[pi] : _qp;

      // Orientation: aim this bone at its primary child, in world space.
      const c = this.primary[i];
      if (c >= 0) {
        _rest.set(this.restDir[c * 3], this.restDir[c * 3 + 1], this.restDir[c * 3 + 2]);
        _w.copy(_rest).applyQuaternion(parentWorld);
        _dir.set(this.pos[c * 3] - this.pos[i * 3], this.pos[c * 3 + 1] - this.pos[i * 3 + 1], this.pos[c * 3 + 2] - this.pos[i * 3 + 2]);
        if (_dir.lengthSq() > 1e-10) {
          _dir.normalize();
          swingQuat(_w, _dir, _qs);
          worldQ[i].copy(_qs).multiply(parentWorld);
          // Twist has no representation in a particle chain, so it is carried
          // as an explicit scalar and folded in about the bone's own axis.
          if (this.twist[i] !== 0) {
            _qs.setFromAxisAngle(_dir, this.twist[i]);
            worldQ[i].premultiply(_qs);
          }
        } else {
          worldQ[i].copy(parentWorld);
        }
      } else {
        worldQ[i].copy(parentWorld);
      }

      // local = parentWorld^-1 * world
      _q.copy(parentWorld).invert().multiply(worldQ[i]);
      bone.quaternion.slerp(_q, t);

      if (pi >= 0) {
        // Position straight from the particles, so what is drawn is exactly
        // what was simulated — no drift between solver and skeleton.
        _v.set(this.pos[i * 3] - this.pos[pi * 3], this.pos[i * 3 + 1] - this.pos[pi * 3 + 1], this.pos[i * 3 + 2] - this.pos[pi * 3 + 2]);
        _q.copy(worldQ[pi]).invert();
        _v.applyQuaternion(_q).multiplyScalar(1 / this.scale);
        bone.position.lerp(_v, t);
      } else {
        _v.set(this.pos[0], this.pos[1], this.pos[2]).applyMatrix4(_mat);
        bone.position.lerp(_v, t);
      }
    }
    // Refresh the whole actor subtree: the actor system already ran this frame,
    // so its matrices describe the animated pose, not the one just written.
    this.root.updateMatrixWorld(true);
  }

  /** Add a late impulse — an arrow into a body that is already falling. */
  push(at: THREE.Vector3, impulse: THREE.Vector3): void {
    const n = this.bones.length;
    this.settled = false;
    this.age = Math.min(this.age, SIM_SECONDS - 1.5);
    for (let i = 0; i < n; i++) {
      _v.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      const w = 1 / (1 + _v.distanceToSquared(at) * 3);
      this.prev[i * 3] -= impulse.x * w * 0.016;
      this.prev[i * 3 + 1] -= impulse.y * w * 0.016;
      this.prev[i * 3 + 2] -= impulse.z * w * 0.016;
    }
  }

  release(): void {
    if (this.culled) {
      this.root.traverse((o) => {
        const sk = o as THREE.SkinnedMesh;
        if (sk.isSkinnedMesh) sk.frustumCulled = true;
      });
      this.culled = false;
    }
  }

  serialize(): number[] {
    const out: number[] = [this.actorId, this.age, this.blend, this.settled ? 1 : 0, this.bones.length];
    for (let i = 0; i < this.pos.length; i++) out.push(this.pos[i]);
    for (let i = 0; i < this.prev.length; i++) out.push(this.prev[i]);
    return out;
  }

  restore(data: number[]): void {
    const n = data[4] | 0;
    if (n !== this.bones.length) return;
    this.age = data[1];
    this.blend = data[2];
    this.settled = data[3] === 1;
    let k = 5;
    for (let i = 0; i < this.pos.length && k < data.length; i++, k++) this.pos[i] = data[k];
    for (let i = 0; i < this.prev.length && k < data.length; i++, k++) this.prev[i] = data[k];
  }
}
