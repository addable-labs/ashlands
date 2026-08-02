import * as THREE from 'three';
import type { IMaterials, ITerrain } from '../core/contracts';
import { buildClutter, type ClutterAsset } from './Gear';
import { CLUTTER, SURFACE_PHYSICS, type ClutterDef } from './Tables';
import { clamp, Rand } from './mathx';

/**
 * Rigid bodies: dropped gear, knocked-over clutter, and the debris it becomes.
 *
 * An impulse-based solver with one contact manifold per body, resolved against
 * the heightfield analytically and against static architecture by a short cast
 * along the motion. Bodies carry a real angular state — inertia, angular
 * velocity, a torque arm at each contact — because a crate that slides without
 * ever tipping is instantly readable as fake, and tipping is the entire visual
 * payoff of having rigid bodies at all.
 *
 * Contact points come from the same convex hull that generated the mesh
 * (fourteen support directions), so an urn rests on its base, a plank rests on
 * its face, and nothing floats. Bodies at rest are put to sleep after their
 * kinetic energy stays under threshold for half a second and cost nothing until
 * something wakes them, which is what makes a room full of clutter free.
 */

const GRAVITY = -14.2;
/** Kinetic energy under which a body is a candidate for sleep. */
const SLEEP_ENERGY = 0.045;
const SLEEP_DELAY = 0.5;
const MAX_BODIES = 96;

export interface Body {
  id: number;
  kind: string;
  active: boolean;
  sleeping: boolean;
  sleepTimer: number;
  mass: number;
  invMass: number;
  invInertia: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  quat: THREE.Quaternion;
  mesh: THREE.Mesh;
  asset: ClutterAsset;
  def: ClutterDef;
  /** Accumulated damage; at `toughness` it breaks. */
  stress: number;
  /** Seconds before debris fades out. Infinity for placed clutter. */
  life: number;
}

const _v = new THREE.Vector3();
const _r = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _c = new THREE.Vector3();
const _vp = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _ray = new THREE.Raycaster();

export type BreakHandler = (at: THREE.Vector3, energy: number, def: ClutterDef) => void;

export class BodyWorld {
  readonly group = new THREE.Group();
  private bodies: Body[] = [];
  private assets = new Map<string, ClutterAsset>();
  private statics: THREE.Object3D[] = [];
  private nextId = 1;
  private castCursor = 0;
  private rand = new Rand(0x51ed270b);

  build(mats: IMaterials | null): void {
    this.group.name = 'combat:bodies';
    for (const key of Object.keys(CLUTTER)) this.assets.set(key, buildClutter(CLUTTER[key], mats));
  }

  setStatics(objs: THREE.Object3D[]): void {
    this.statics = objs;
  }

  get count(): number {
    let n = 0;
    for (const b of this.bodies) if (b.active) n++;
    return n;
  }

  get awake(): number {
    let n = 0;
    for (const b of this.bodies) if (b.active && !b.sleeping) n++;
    return n;
  }

  spawn(kind: string, at: THREE.Vector3, vel: THREE.Vector3 | null, life = Infinity): Body | null {
    const def = CLUTTER[kind];
    const asset = this.assets.get(kind);
    if (def === undefined || asset === undefined) return null;

    let body = this.bodies.find((b) => !b.active);
    if (body === undefined) {
      if (this.bodies.length >= MAX_BODIES) {
        // Recycle the oldest finite-lifetime body: debris is expendable,
        // hand-placed clutter is not.
        body = this.bodies.find((b) => b.life !== Infinity) ?? this.bodies[0];
        body.mesh.removeFromParent();
      } else {
        const mesh = new THREE.Mesh(asset.geo, asset.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        body = {
          id: 0, kind, active: false, sleeping: false, sleepTimer: 0,
          mass: 1, invMass: 1, invInertia: 1,
          pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(),
          quat: new THREE.Quaternion(), mesh, asset, def, stress: 0, life: Infinity,
        };
        this.bodies.push(body);
      }
    }

    body.id = this.nextId++;
    body.kind = kind;
    body.def = def;
    body.asset = asset;
    body.active = true;
    body.sleeping = false;
    body.sleepTimer = 0;
    body.mass = def.mass;
    body.invMass = 1 / def.mass;
    body.invInertia = 1 / (def.mass * asset.inertia * asset.radius * asset.radius);
    body.pos.copy(at);
    body.vel.copy(vel ?? _v.set(0, 0, 0));
    body.spin.set(this.rand.range(-2, 2), this.rand.range(-2, 2), this.rand.range(-2, 2));
    body.quat.setFromAxisAngle(_v.set(0, 1, 0), this.rand.range(0, Math.PI * 2));
    body.stress = 0;
    body.life = life;
    body.mesh.geometry = asset.geo;
    body.mesh.material = asset.material;
    body.mesh.visible = true;
    body.mesh.position.copy(at);
    body.mesh.quaternion.copy(body.quat);
    if (body.mesh.parent === null) this.group.add(body.mesh);
    return body;
  }

  /** Wake a body and shove it. Used by melee, arrows and explosions alike. */
  push(b: Body, at: THREE.Vector3, impulse: THREE.Vector3): void {
    b.sleeping = false;
    b.sleepTimer = 0;
    b.vel.addScaledVector(impulse, b.invMass);
    _r.subVectors(at, b.pos);
    _v.copy(_r).cross(impulse).multiplyScalar(b.invInertia);
    b.spin.add(_v);
    b.stress += impulse.length() * 0.5;
  }

  /** Nearest body whose bounding sphere the segment [p0,p1] passes through. */
  hitTest(p0: THREE.Vector3, p1: THREE.Vector3, out: THREE.Vector3): Body | null {
    let best: Body | null = null;
    let bestT = Infinity;
    _v.subVectors(p1, p0);
    const len2 = _v.lengthSq();
    if (len2 < 1e-9) return null;
    for (const b of this.bodies) {
      if (!b.active) continue;
      _r.subVectors(b.pos, p0);
      const t = clamp(_r.dot(_v) / len2, 0, 1);
      _c.copy(p0).addScaledVector(_v, t);
      const rad = b.asset.radius;
      if (_c.distanceToSquared(b.pos) > rad * rad) continue;
      if (t < bestT) {
        bestT = t;
        best = b;
        out.copy(_c);
      }
    }
    return best;
  }

  step(dt: number, terrain: ITerrain | null, onBreak: BreakHandler): void {
    if (dt <= 0) return;
    for (const b of this.bodies) {
      if (!b.active) continue;

      if (b.life !== Infinity) {
        b.life -= dt;
        if (b.life <= 0) {
          b.active = false;
          b.mesh.visible = false;
          continue;
        }
      }

      if (b.sleeping) continue;

      b.vel.y += GRAVITY * dt;
      // Air drag keeps thrown debris from reading as weightless.
      b.vel.multiplyScalar(Math.exp(-0.25 * dt));
      b.spin.multiplyScalar(Math.exp(-0.9 * dt));
      b.pos.addScaledVector(b.vel, dt);

      const w = b.spin.length();
      if (w > 1e-5) {
        _q.setFromAxisAngle(_v.copy(b.spin).multiplyScalar(1 / w), w * dt);
        b.quat.premultiply(_q).normalize();
      }

      const energy = this.resolve(b, terrain, dt);
      if (energy > 0 && b.def.toughness !== Infinity) {
        b.stress += energy;
        if (b.stress > b.def.toughness) {
          this.shatter(b, onBreak);
          continue;
        }
      }

      const ke = 0.5 * b.vel.lengthSq() + 0.15 * b.spin.lengthSq();
      if (ke < SLEEP_ENERGY) {
        b.sleepTimer += dt;
        if (b.sleepTimer > SLEEP_DELAY) {
          b.sleeping = true;
          b.vel.set(0, 0, 0);
          b.spin.set(0, 0, 0);
        }
      } else {
        b.sleepTimer = 0;
      }

      b.mesh.position.copy(b.pos);
      b.mesh.quaternion.copy(b.quat);
    }
  }

  /**
   * Contact resolution against the heightfield and, for fast bodies, against
   * static architecture. Returns the impact energy delivered this step, which
   * is what decides whether an urn survives the fall.
   */
  private resolve(b: Body, terrain: ITerrain | null, dt: number): number {
    if (terrain === null || !terrain.ready) return 0;
    const hull = b.asset.hull;
    let energy = 0;
    let deepest = 0;

    const surf = terrain.materialAt(b.pos.x, b.pos.z);
    const phys = SURFACE_PHYSICS[surf] ?? SURFACE_PHYSICS[0];

    for (let i = 0; i < hull.length; i += 3) {
      _c.set(hull[i], hull[i + 1], hull[i + 2]).applyQuaternion(b.quat).add(b.pos);
      const h = terrain.heightAt(_c.x, _c.z);
      const pen = h - _c.y;
      if (pen <= 0) continue;
      if (pen > deepest) deepest = pen;
      terrain.normalAt(_c.x, _c.z, _n);

      _r.subVectors(_c, b.pos);
      _vp.copy(b.spin).cross(_r).add(b.vel);
      const vn = _vp.dot(_n);
      if (vn >= 0) continue;

      // Impulse magnitude with the angular term: j = -(1+e)vn / (1/m + |r x n|^2 / I)
      _v.copy(_r).cross(_n);
      const denom = b.invMass + _v.lengthSq() * b.invInertia;
      const j = (-(1 + phys.bounce) * vn) / Math.max(denom, 1e-6);
      energy += 0.5 * b.mass * vn * vn;

      _v.copy(_n).multiplyScalar(j);
      b.vel.addScaledVector(_v, b.invMass);
      _t.copy(_r).cross(_v).multiplyScalar(b.invInertia);
      b.spin.add(_t);

      // Coulomb friction on the tangential component of the same contact.
      _vp.copy(b.spin).cross(_r).add(b.vel);
      _t.copy(_vp).addScaledVector(_n, -_vp.dot(_n));
      const tl = _t.length();
      if (tl > 1e-5) {
        _t.multiplyScalar(1 / tl);
        _v.copy(_r).cross(_t);
        const dt2 = b.invMass + _v.lengthSq() * b.invInertia;
        const jt = clamp(-tl / Math.max(dt2, 1e-6), -phys.friction * j, phys.friction * j);
        _v.copy(_t).multiplyScalar(jt);
        b.vel.addScaledVector(_v, b.invMass);
        _t.copy(_r).cross(_v).multiplyScalar(b.invInertia);
        b.spin.add(_t);
      }
    }

    if (deepest > 0) {
      // Positional correction, biased so a stack settles rather than jitters.
      b.pos.y += deepest * 0.85;
    }

    // Static geometry: one short cast per frame across the awake set. Bodies
    // spend almost all their life asleep on the ground, so this is nearly free.
    if (this.statics.length > 0 && b.vel.lengthSq() > 1.0) {
      this.castCursor++;
      if (this.castCursor % 3 === 0) {
        const speed = b.vel.length();
        _ray.set(b.pos, _v.copy(b.vel).multiplyScalar(1 / speed));
        _ray.near = 0;
        _ray.far = speed * dt + b.asset.radius;
        const hits = _ray.intersectObjects(this.statics, true);
        const hit = hits.length > 0 ? hits[0] : undefined;
        if (hit !== undefined && hit.normal !== undefined) {
          _n.copy(hit.normal).transformDirection(hit.object.matrixWorld);
          b.pos.copy(hit.point).addScaledVector(_n, b.asset.radius * 0.9);
          energy += 0.5 * b.mass * b.vel.lengthSq();
          b.vel.reflect(_n).multiplyScalar(0.28);
          b.spin.multiplyScalar(0.5);
        }
      }
      // A body falling through the world is worse than a body that vanishes.
      if (b.pos.y < -80) {
        b.active = false;
        b.mesh.visible = false;
      }
    }

    return energy;
  }

  private shatter(b: Body, onBreak: BreakHandler): void {
    const def = b.def;
    b.active = false;
    b.mesh.visible = false;
    onBreak(b.pos, b.stress, def);
    for (let i = 0; i < def.shards; i++) {
      const a = (i / def.shards) * Math.PI * 2 + this.rand.range(0, 1);
      _v.set(Math.cos(a) * this.rand.range(1.2, 3.4), this.rand.range(1.5, 4.5), Math.sin(a) * this.rand.range(1.2, 3.4));
      _c.copy(b.pos);
      _c.y += def.size * 0.6;
      const s = this.spawn('shard', _c, _v, 22 + this.rand.range(0, 10));
      if (s !== null) s.spin.set(this.rand.range(-9, 9), this.rand.range(-9, 9), this.rand.range(-9, 9));
    }
  }

  serialize(): number[][] {
    const out: number[][] = [];
    for (const b of this.bodies) {
      if (!b.active) continue;
      out.push([
        KIND_INDEX.indexOf(b.kind),
        b.pos.x, b.pos.y, b.pos.z,
        b.quat.x, b.quat.y, b.quat.z, b.quat.w,
        b.vel.x, b.vel.y, b.vel.z,
        b.spin.x, b.spin.y, b.spin.z,
        b.sleeping ? 1 : 0, b.stress, b.life === Infinity ? -1 : b.life,
      ]);
    }
    return out;
  }

  deserialize(rows: number[][]): void {
    for (const b of this.bodies) {
      b.active = false;
      b.mesh.visible = false;
    }
    for (const r of rows) {
      const kind = KIND_INDEX[r[0]] ?? 'urn';
      _v.set(r[1], r[2], r[3]);
      _c.set(r[8], r[9], r[10]);
      const b = this.spawn(kind, _v, _c, r[16] < 0 ? Infinity : r[16]);
      if (b === null) continue;
      b.quat.set(r[4], r[5], r[6], r[7]);
      b.spin.set(r[11], r[12], r[13]);
      b.sleeping = r[14] === 1;
      b.stress = r[15];
      b.mesh.quaternion.copy(b.quat);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.clear();
    this.bodies.length = 0;
    for (const a of this.assets.values()) {
      a.geo.dispose();
      a.material.dispose();
    }
    this.assets.clear();
    this.statics = [];
  }
}

/** Stable ordering for serialisation; append only. */
const KIND_INDEX: readonly string[] = ['urn', 'pot', 'crate', 'shard', 'plank'];
