import * as THREE from 'three';
import type { IMaterials, ITerrain } from '../core/contracts';
import { buildArrow } from './Gear';
import type { AmmoDef } from './Tables';
import { clamp, closestSegSeg } from './mathx';
import type { ActorLike, TargetIndex } from './Targets';

/**
 * Ranged combat: real ballistics, not a hitscan with a delay.
 *
 * An arrow is a point mass under gravity and quadratic drag, integrated with a
 * step small enough that it cannot cross more than a third of a metre without
 * being tested — a 84 m/s chitin bolt at 60 fps covers 1.4 m in a frame, and
 * without substepping it would pass clean through a nix-hound. Because the
 * flight is real, everything downstream of it is real too: the drop is
 * something the player learns to aim over, the travel time is something a
 * moving target can walk out of, and hitting a diving cliff racer requires
 * leading it. That is the whole reason to simulate rather than to roll.
 *
 * Arrows that land stay landed: in terrain they bite at the angle they arrived
 * at, and in a body they ride the animation, because a quiver of arrows
 * standing out of a dead guar is worth more than any hit indicator.
 */

const GRAVITY = -9.81;
/** Metres per integration substep. Below the thinnest thing worth hitting. */
const MAX_STEP = 0.3;
const POOL = 40;
/** Seconds a stuck arrow remains before it is recycled. */
const STUCK_LIFE = 45;

export interface ProjectileHit {
  actor: ActorLike | null;
  /** True when the thing struck was the player rather than an actor or ground. */
  player: boolean;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  /** Speed along the flight direction at the moment of contact. */
  speed: number;
}

/** The player's body as a capsule, so enemy archers can actually hit them. */
export interface PlayerBody {
  base: THREE.Vector3;
  top: THREE.Vector3;
  radius: number;
}

interface Shot {
  active: boolean;
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  ammo: AmmoDef;
  /** Actor id of the shooter, or -1 for the player. */
  ownerId: number;
  /** 0..100 marksman skill at the moment of release; resolution reads it. */
  skill: number;
  /** 0..1 draw strength. Scales damage and speed. */
  draw: number;
  age: number;
  /** -1 while in flight, else the actor being ridden. */
  stuckTo: number;
  stuckLocal: THREE.Vector3;
  stuckQuat: THREE.Quaternion;
  stuckLife: number;
  spin: number;
}

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _fwd = new THREE.Vector3(0, 0, 1);

export class Projectiles {
  readonly group = new THREE.Group();
  private shots: Shot[] = [];
  private arrowAsset: { object: THREE.Object3D; dispose(): void } | null = null;
  private starAsset: { object: THREE.Object3D; dispose(): void } | null = null;

  build(mats: IMaterials | null): void {
    this.group.name = 'combat:projectiles';
    this.arrowAsset = buildArrow(0.74, mats);
    this.starAsset = buildArrow(0.18, mats);
    for (let i = 0; i < POOL; i++) {
      const mesh = this.arrowAsset.object.clone(true);
      mesh.visible = false;
      this.group.add(mesh);
      this.shots.push({
        active: false,
        mesh,
        pos: new THREE.Vector3(),
        prev: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        ammo: null as unknown as AmmoDef,
        ownerId: -1,
        skill: 0,
        draw: 1,
        age: 0,
        stuckTo: -1,
        stuckLocal: new THREE.Vector3(),
        stuckQuat: new THREE.Quaternion(),
        stuckLife: 0,
        spin: 0,
      });
    }
  }

  /**
   * Launch. `dir` need not be normalised. Returns false when the pool is full,
   * which the caller treats as the shot simply not happening — better than
   * stealing an arrow already in someone's chest.
   */
  fire(from: THREE.Vector3, dir: THREE.Vector3, speed: number, ammo: AmmoDef, ownerId: number, skill: number, draw: number): boolean {
    const s = this.free();
    if (s === null) return false;
    s.active = true;
    s.pos.copy(from);
    s.prev.copy(from);
    s.vel.copy(dir).normalize().multiplyScalar(speed);
    s.ammo = ammo;
    s.ownerId = ownerId;
    s.skill = skill;
    s.draw = draw;
    s.age = 0;
    s.stuckTo = -1;
    s.stuckLife = 0;
    s.spin = ammo.id === 'star' ? 34 : 0;
    s.mesh.visible = true;
    s.mesh.scale.setScalar(ammo.length / 0.74);
    this.orient(s);
    return true;
  }

  /**
   * Integrate every shot and report contacts. The caller owns damage: this
   * module knows physics and nothing about skill, armour or factions.
   */
  step(
    dt: number,
    terrain: ITerrain | null,
    targets: TargetIndex,
    frame: number,
    onHit: (ammo: AmmoDef, ownerId: number, skill: number, draw: number, hit: ProjectileHit) => boolean,
    playerBody: PlayerBody | null,
  ): void {
    for (const s of this.shots) {
      if (!s.active) continue;

      if (s.stuckLife > 0) {
        s.stuckLife -= dt;
        if (s.stuckLife <= 0) {
          this.retire(s);
          continue;
        }
        if (s.stuckTo >= 0) this.rideActor(s, targets);
        continue;
      }

      s.age += dt;
      if (s.age > 20) {
        this.retire(s);
        continue;
      }

      const speed = s.vel.length();
      const steps = clamp(Math.ceil((speed * dt) / MAX_STEP), 1, 24);
      const h = dt / steps;
      let done = false;

      for (let i = 0; i < steps && !done; i++) {
        s.prev.copy(s.pos);
        // Quadratic drag: the term that makes a heavy iron arrow outrange a
        // light chitin one at distance despite leaving the bow slower.
        const v = s.vel.length();
        _v.copy(s.vel).multiplyScalar(-s.ammo.drag * v);
        _v.y += GRAVITY;
        s.vel.addScaledVector(_v, h);
        s.pos.addScaledVector(s.vel, h);

        // --- the player, for anything they did not fire themselves.
        if (playerBody !== null && s.ownerId >= 0) {
          const r = playerBody.radius + 0.06;
          if (closestSegSeg(s.prev, s.pos, playerBody.base, playerBody.top, _p0, _p1) <= r * r) {
            _a.copy(_p0);
            _b.subVectors(_p0, _p1);
            if (_b.lengthSq() < 1e-8) _b.copy(s.vel).multiplyScalar(-1);
            _b.normalize();
            const stopped = onHit(s.ammo, s.ownerId, s.skill, s.draw, {
              actor: null,
              player: true,
              point: _a,
              normal: _b,
              speed: s.vel.length(),
            });
            if (stopped) {
              this.retire(s);
              done = true;
              break;
            }
            s.vel.multiplyScalar(-0.2);
          }
        }

        // --- actors first: a body in front of a wall stops the arrow.
        const list = targets.nearby(s.pos, 6);
        for (const a of list) {
          if (a.id === s.ownerId) continue;
          const vol = targets.volume(a, frame);
          const d2 = closestSegSeg(s.prev, s.pos, vol.base, vol.top, _p0, _p1);
          if (d2 > (vol.radius + 0.05) * (vol.radius + 0.05)) continue;
          _a.copy(_p0);
          _b.subVectors(_p0, _p1);
          if (_b.lengthSq() < 1e-8) _b.copy(s.vel).multiplyScalar(-1);
          _b.normalize();
          const stopped = onHit(s.ammo, s.ownerId, s.skill, s.draw, {
            actor: a,
            player: false,
            point: _a,
            normal: _b,
            speed: s.vel.length(),
          });
          if (stopped) {
            this.stickToActor(s, a, _a);
          } else {
            // Deflected off armour: keep the arrow, dump most of its energy and
            // let it clatter to the ground where the player can pick it up.
            s.vel.multiplyScalar(-0.18);
            s.vel.y = Math.abs(s.vel.y) * 0.4 + 1.5;
          }
          done = stopped;
          break;
        }
        if (done) break;

        // --- terrain.
        if (terrain !== null && terrain.ready) {
          const gh = terrain.heightAt(s.pos.x, s.pos.z);
          if (s.pos.y <= gh) {
            // Bisect for the crossing so the arrow buries at the real surface
            // rather than wherever the substep happened to land.
            let lo = 0;
            let hi = 1;
            for (let b = 0; b < 12; b++) {
              const mid = (lo + hi) * 0.5;
              _v.lerpVectors(s.prev, s.pos, mid);
              if (_v.y - terrain.heightAt(_v.x, _v.z) > 0) lo = mid;
              else hi = mid;
            }
            _v.lerpVectors(s.prev, s.pos, hi);
            terrain.normalAt(_v.x, _v.z, _b);
            const impact = s.vel.length();
            // A shallow strike on hard ground skips; a steep one buries.
            const bite = -_b.dot(_a.copy(s.vel).normalize());
            onHit(s.ammo, s.ownerId, s.skill, s.draw, { actor: null, player: false, point: _v, normal: _b, speed: impact });
            if (bite > 0.35 || impact < 12) {
              s.pos.copy(_v).addScaledVector(_a, 0.06);
              this.stickToWorld(s);
            } else {
              s.pos.copy(_v).addScaledVector(_b, 0.02);
              s.vel.reflect(_b).multiplyScalar(0.35);
            }
            done = true;
            break;
          }
        }
      }

      if (s.active && s.stuckTo === -1 && s.stuckLife <= 0) this.orient(s);
    }
  }

  private free(): Shot | null {
    for (const s of this.shots) if (!s.active) return s;
    // Every slot busy: reuse the oldest stuck arrow rather than dropping the shot.
    let best: Shot | null = null;
    for (const s of this.shots) {
      if (s.stuckLife <= 0) continue;
      if (best === null || s.stuckLife < best.stuckLife) best = s;
    }
    if (best !== null) this.retire(best);
    return best;
  }

  private retire(s: Shot): void {
    s.active = false;
    s.stuckTo = -1;
    s.stuckLife = 0;
    s.mesh.visible = false;
  }

  private orient(s: Shot): void {
    s.mesh.position.copy(s.pos);
    if (s.spin > 0) {
      // A thrown star tumbles about its own face rather than tracking flight.
      _v.copy(s.vel).normalize();
      _q.setFromUnitVectors(_fwd, _v);
      _q2.setFromAxisAngle(_fwd, s.age * s.spin);
      s.mesh.quaternion.copy(_q).multiply(_q2);
      return;
    }
    if (s.vel.lengthSq() > 1e-6) {
      _v.copy(s.vel).normalize();
      s.mesh.quaternion.setFromUnitVectors(_fwd, _v);
    }
  }

  private stickToWorld(s: Shot): void {
    this.orient(s);
    s.stuckTo = -1;
    s.stuckLife = STUCK_LIFE;
    s.vel.set(0, 0, 0);
  }

  private stickToActor(s: Shot, a: ActorLike, at: THREE.Vector3): void {
    this.orient(s);
    // Store the contact in the actor's own frame so the arrow rides the body
    // through every animation without being reparented into another system's
    // scene graph.
    a.root.updateWorldMatrix(true, false);
    s.stuckLocal.copy(at);
    a.root.worldToLocal(s.stuckLocal);
    s.stuckQuat.copy(s.mesh.quaternion);
    _q.copy(a.root.quaternion).invert();
    s.stuckQuat.premultiply(_q);
    s.stuckTo = a.id;
    s.stuckLife = STUCK_LIFE;
    s.vel.set(0, 0, 0);
  }

  private rideActor(s: Shot, targets: TargetIndex): void {
    for (const a of targets.all()) {
      if (a.id !== s.stuckTo) continue;
      _v.copy(s.stuckLocal);
      a.root.localToWorld(_v);
      s.mesh.position.copy(_v);
      s.mesh.quaternion.copy(a.root.quaternion).multiply(s.stuckQuat);
      s.pos.copy(_v);
      return;
    }
    // The body was recycled out from under it; drop the arrow where it was.
    s.stuckTo = -1;
  }

  /** Live shots, for the perf HUD and for save. */
  get count(): number {
    let n = 0;
    for (const s of this.shots) if (s.active) n++;
    return n;
  }

  serialize(): number[][] {
    const out: number[][] = [];
    for (const s of this.shots) {
      if (!s.active) continue;
      out.push([
        s.pos.x, s.pos.y, s.pos.z,
        s.vel.x, s.vel.y, s.vel.z,
        s.ownerId, s.skill, s.draw, s.age, s.stuckTo, s.stuckLife,
        AMMO_INDEX.indexOf(s.ammo.id),
      ]);
    }
    return out;
  }

  deserialize(rows: number[][], ammo: Readonly<Record<string, AmmoDef>>): void {
    for (const s of this.shots) this.retire(s);
    for (const r of rows) {
      const s = this.free();
      if (s === null) return;
      const def = ammo[AMMO_INDEX[r[12]] ?? 'iron_arrow'];
      if (def === undefined) continue;
      s.active = true;
      s.pos.set(r[0], r[1], r[2]);
      s.prev.copy(s.pos);
      s.vel.set(r[3], r[4], r[5]);
      s.ownerId = r[6];
      s.skill = r[7];
      s.draw = r[8];
      s.age = r[9];
      s.stuckTo = r[10];
      s.stuckLife = r[11];
      s.ammo = def;
      s.mesh.visible = true;
      s.mesh.scale.setScalar(def.length / 0.74);
      this.orient(s);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.clear();
    this.shots.length = 0;
    this.arrowAsset?.dispose();
    this.starAsset?.dispose();
    this.arrowAsset = null;
    this.starAsset = null;
  }
}

/** Stable ordering for serialisation; append only. */
const AMMO_INDEX: readonly string[] = ['iron_arrow', 'steel_arrow', 'silver_arrow', 'chitin_arrow', 'glass_arrow', 'star'];

/**
 * Ballistic lead. Solves for the flight time to where the target *will* be, then
 * for the launch elevation that gets there under gravity, both by fixed-point
 * iteration — three passes is well inside a pixel at combat ranges and costs
 * nothing next to a closed-form quartic.
 *
 * This is what lets an archer NPC hit a running player, and what the player is
 * doing by eye when they aim ahead of a diving cliff racer.
 */
export function leadShot(
  from: THREE.Vector3,
  targetPos: THREE.Vector3,
  targetVel: THREE.Vector3,
  speed: number,
  out: THREE.Vector3,
): boolean {
  let t = from.distanceTo(targetPos) / speed;
  for (let i = 0; i < 3; i++) {
    _a.copy(targetVel).multiplyScalar(t).add(targetPos).sub(from);
    t = _a.length() / speed;
  }
  const dx = Math.hypot(_a.x, _a.z);
  const dy = _a.y;
  const v2 = speed * speed;
  const g = -GRAVITY;
  const disc = v2 * v2 - g * (g * dx * dx + 2 * dy * v2);
  if (disc < 0) {
    // Out of range at this draw: fire flat and let it fall short honestly.
    out.copy(_a).normalize();
    return false;
  }
  // Low arc: the one an archer actually uses.
  const angle = Math.atan2(v2 - Math.sqrt(disc), g * dx);
  const horiz = dx > 1e-4 ? 1 / dx : 0;
  out.set(_a.x * horiz, Math.tan(angle), _a.z * horiz).normalize();
  return true;
}
