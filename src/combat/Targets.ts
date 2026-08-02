import * as THREE from 'three';
import type { Ctx, System } from '../core/types';
import { BONE_REGIONS, type BodyRegion } from './Tables';
import { distSqPointSegment } from './mathx';

/**
 * The bridge to the actor system.
 *
 * Combat never imports the actor system: it reads the documented `all()` /
 * `nearest()` / `damage()` surface through a structural type and probes for it
 * at runtime, so a missing or renamed actor system degrades to "no targets"
 * rather than a boot failure.
 *
 * Hit volumes are derived from the live skeleton rather than authored per
 * species. Every rig in the game is a bone chain with world matrices already
 * updated for rendering, so one pass over the bones yields both a body capsule
 * to sweep against and — from the nearest bone to the contact point — the body
 * region that was struck. A new creature therefore gets correct headshots and
 * correct wing hits with no combat-side authoring at all.
 */

export interface ActorLike {
  id: number;
  kind: string;
  position: THREE.Vector3;
  yaw: number;
  health: number;
  maxHealth: number;
  faction: string;
  alive: boolean;
  root: THREE.Object3D;
}

export interface ActorsLike extends System {
  all(): readonly ActorLike[];
  nearest(p: THREE.Vector3, maxDist: number): ActorLike | null;
  damage(a: ActorLike, amount: number, dir: THREE.Vector3): void;
}

/** A body capsule plus the bones that generated it, in world space. */
export interface HitVolume {
  /** Bottom and top of the body axis. */
  base: THREE.Vector3;
  top: THREE.Vector3;
  radius: number;
  /** World head position of every bone, flattened xyz. Region lookup only. */
  bonePos: Float32Array;
  boneName: string[];
  /** Frame this was last rebuilt on. */
  frame: number;
}

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
/** Shared so `all()` allocates nothing on the no-actor-system path. */
const NO_ACTORS: readonly ActorLike[] = [];

function regionOfBone(name: string): BodyRegion {
  for (const r of BONE_REGIONS) if (name.startsWith(r.match)) return r.region;
  // Leg chains are named `<side><index>.a|b|c`; anything unmatched on a rig is
  // a limb, and treating an unknown bone as a limb is the conservative call.
  return 'leg';
}

export class TargetIndex {
  private actors: ActorsLike | null = null;
  private volumes = new Map<number, HitVolume>();
  private regionCache = new Map<number, BodyRegion[]>();
  private scratch: ActorLike[] = [];

  bind(ctx: Ctx): ActorsLike | null {
    if (this.actors !== null) return this.actors;
    const sys = ctx.get<ActorsLike>('actors');
    if (sys === undefined) return null;
    if (typeof sys.all !== 'function' || typeof sys.damage !== 'function') return null;
    this.actors = sys;
    return sys;
  }

  get system(): ActorsLike | null {
    return this.actors;
  }

  all(): readonly ActorLike[] {
    return this.actors?.all() ?? NO_ACTORS;
  }

  /** Living actors whose body centre is within `radius` of `p`. Reuses one array. */
  nearby(p: THREE.Vector3, radius: number, out?: ActorLike[]): ActorLike[] {
    const list = out ?? this.scratch;
    list.length = 0;
    const r2 = radius * radius;
    for (const a of this.all()) {
      if (!a.alive) continue;
      if (a.position.distanceToSquared(p) <= r2) list.push(a);
    }
    return list;
  }

  /**
   * World-space hit volume for an actor, rebuilt at most once per frame. Bones
   * are read straight out of the skinned mesh the actor system already posed,
   * so the volume tracks the animation exactly — a crouching nix-hound really
   * is a shorter capsule.
   */
  volume(a: ActorLike, frame: number): HitVolume {
    let v = this.volumes.get(a.id);
    if (v !== undefined && v.frame === frame) return v;

    const bones = this.bonesOf(a);
    if (v === undefined) {
      v = {
        base: new THREE.Vector3(),
        top: new THREE.Vector3(),
        radius: 0.4,
        bonePos: new Float32Array(Math.max(3, bones.length * 3)),
        boneName: bones.map((b) => b.name),
        frame: -1,
      };
      this.volumes.set(a.id, v);
      this.regionCache.set(
        a.id,
        bones.map((b) => regionOfBone(b.name)),
      );
    }
    if (v.bonePos.length < bones.length * 3) {
      v.bonePos = new Float32Array(bones.length * 3);
      v.boneName = bones.map((b) => b.name);
      this.regionCache.set(
        a.id,
        bones.map((b) => regionOfBone(b.name)),
      );
    }
    v.frame = frame;

    if (bones.length === 0) {
      // No rig resolved: fall back to a man-sized capsule on the actor origin.
      v.base.copy(a.position);
      v.top.set(a.position.x, a.position.y + 1.7, a.position.z);
      v.radius = 0.42;
      return v;
    }

    // The actor system only refreshes world matrices for actors it is animating
    // this frame; a target we are about to swing at must be current regardless.
    a.root.updateWorldMatrix(false, true);

    let minY = Infinity;
    let maxY = -Infinity;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < bones.length; i++) {
      bones[i].getWorldPosition(_v);
      v.bonePos[i * 3] = _v.x;
      v.bonePos[i * 3 + 1] = _v.y;
      v.bonePos[i * 3 + 2] = _v.z;
      cx += _v.x;
      cz += _v.z;
      if (_v.y < minY) minY = _v.y;
      if (_v.y > maxY) maxY = _v.y;
    }
    cx /= bones.length;
    cz /= bones.length;

    let spread = 0;
    for (let i = 0; i < bones.length; i++) {
      const dx = v.bonePos[i * 3] - cx;
      const dz = v.bonePos[i * 3 + 2] - cz;
      const d = Math.hypot(dx, dz);
      if (d > spread) spread = d;
    }

    // A capsule through the bone cloud: wide enough that a limb is hittable,
    // tight enough that a swing past the shoulder of a cliff racer misses.
    v.radius = Math.max(0.22, Math.min(spread * 0.62, (maxY - minY) * 0.7 + 0.25));
    v.base.set(cx, minY + v.radius * 0.35, cz);
    v.top.set(cx, Math.max(minY + v.radius * 0.4, maxY - v.radius * 0.25), cz);
    return v;
  }

  /** Body region nearest to a world contact point. */
  regionAt(a: ActorLike, point: THREE.Vector3, frame: number): BodyRegion {
    const v = this.volume(a, frame);
    const regions = this.regionCache.get(a.id);
    if (regions === undefined || regions.length === 0) return 'torso';
    let best = 0;
    let bestD = Infinity;
    const n = Math.min(regions.length, v.bonePos.length / 3);
    for (let i = 0; i < n; i++) {
      const dx = v.bonePos[i * 3] - point.x;
      const dy = v.bonePos[i * 3 + 1] - point.y;
      const dz = v.bonePos[i * 3 + 2] - point.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return regions[best];
  }

  /** Distance from a world segment to an actor's body capsule, minus radii. */
  segmentGap(a: ActorLike, p0: THREE.Vector3, p1: THREE.Vector3, frame: number, extra: number): number {
    const v = this.volume(a, frame);
    _a.copy(v.base);
    _b.copy(v.top);
    // Point-segment on both ends is enough for a capsule that is nearly always
    // vertical; the exact segment-segment case is handled by the melee sweep.
    const d0 = distSqPointSegment(_a, _b, p0);
    const d1 = distSqPointSegment(_a, _b, p1);
    return Math.sqrt(Math.min(d0, d1)) - v.radius - extra;
  }

  private bonesOf(a: ActorLike): THREE.Bone[] {
    const found: THREE.Bone[] = [];
    a.root.traverse((o) => {
      const sk = o as THREE.SkinnedMesh;
      if (found.length === 0 && sk.isSkinnedMesh && sk.skeleton) found.push(...sk.skeleton.bones);
    });
    return found;
  }

  /** Called when an actor dies or is recycled so stale volumes cannot leak. */
  forget(id: number): void {
    this.volumes.delete(id);
    this.regionCache.delete(id);
  }

  clear(): void {
    this.volumes.clear();
    this.regionCache.clear();
    this.actors = null;
  }
}
