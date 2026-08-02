import * as THREE from 'three';
import type { TerrainQuery } from '../core/types';
import { TAU, clamp, damp, lerp, smoothstep } from './mathx';
import { TUNING, type PlayerTuning } from './tuning';

export type Locomotion = 'ground' | 'air' | 'swim' | 'levitate';

/** Per-frame movement request, already resolved from raw input. */
export interface MoveIntent {
  /** Local axes, magnitude <= 1. x = strafe right, y = forward. */
  x: number;
  y: number;
  yaw: number;
  pitch: number;
  run: boolean;
  sneak: boolean;
  /** Edge-triggered this frame. */
  jump: boolean;
  /** Held: ascend (swim/levitate). */
  up: boolean;
  /** Held: descend (swim/levitate). */
  down: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Kinematic capsule against a heightfield. There is no rigid-body solver in
 * this engine, so collision is resolved analytically: the terrain is a height
 * function, which means the capsule's support height can be evaluated in
 * closed form and walls are just slopes past the standing limit.
 */
export class CharacterController {
  readonly tuning: PlayerTuning = { ...TUNING };

  /** Feet position — the bottom of the capsule, not its centre. */
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly groundNormal = new THREE.Vector3(0, 1, 0);

  grounded = false;
  /** Standing on terrain steeper than the slope limit; control is reduced. */
  sliding = false;
  swimming = false;
  levitate = false;
  waterWalk = false;
  /**
   * Still sea level. Water walking and the shoreline test use this and not the
   * displaced surface below — walking on a heaving plane is nauseating, and
   * Morrowind's water walking is flat.
   */
  waterLevel = 0;
  /**
   * Wave-displaced surface height at the player's XZ, refreshed each frame by
   * PlayerSystem from the water system's own surface function. Buoyancy and the
   * swim state must be driven by the surface that is actually drawn, or they
   * disagree with the 'water:submerged' event the water system emits when the
   * eye crosses that same surface.
   */
  surfaceLevel = 0;

  /** 0 = dry, 1 = fully under. */
  submersion = 0;
  /** 0..1 blend into the swim pose. Discrete swaps pop the camera. */
  swimBlend = 0;
  /** Eye below the drawn surface — the state 'water:submerged' reports. */
  underwater = false;
  mode: Locomotion = 'air';
  /** Capsule height, blended for crouch. */
  height = TUNING.standHeight;
  /** Horizontal speed, metres/second. */
  speed = 0;
  /** Radians; one full cycle is a left+right stride pair. */
  gaitPhase = 0;
  /** 0..1 stride energy, drives head-bob and the walk animation. */
  gaitAmount = 0;
  /** Downward speed at the instant of the last landing; consumed by the rig. */
  landImpact = 0;
  /** Set for one frame when a foot plants. */
  footEvent: 0 | 1 | 2 = 0;
  crouchBlend = 0;
  /**
   * Multiplier the RPG layer drives from Speed, Athletics and encumbrance. The
   * tuning above is the *baseline* a level-one character runs at, so this sits
   * at 1 for an average starting build and scales up from there; it is not a
   * tax applied to a number that was picked assuming no tax.
   */
  speedScale = 1;

  private coyote = 0;
  private jumpLock = 0;
  private wasGrounded = false;
  private prevGaitSin = 0;
  /** Suppresses re-entry into the swim state right after a climb-out. */
  private swimLock = 0;

  private readonly wish = new THREE.Vector3();
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly probeN = new THREE.Vector3();
  private readonly sampledN = new THREE.Vector3(0, 1, 0);

  /** Fixed probe ring offsets; rotating them per frame would alias into jitter. */
  private readonly ring: Array<[number, number]> = [];

  constructor() {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.3;
      this.ring.push([Math.cos(a), Math.sin(a)]);
    }
  }

  /**
   * Height the capsule's feet rest at over (x,z). A sphere of radius r centred
   * at c touches a terrain sample of height h at horizontal offset d when
   * c = h + sqrt(r^2 - d^2), so the supported foot height is the max of those
   * over the footprint. This is what stops the capsule sinking into ridges
   * that a single centre sample would miss.
   */
  private supportHeight(t: TerrainQuery, x: number, z: number): number {
    const r = this.tuning.radius;
    const rr = r * 0.62;
    const lift = Math.sqrt(Math.max(0, r * r - rr * rr)) - r;
    let best = t.heightAt(x, z);
    for (let i = 0; i < this.ring.length; i++) {
      const o = this.ring[i];
      const h = t.heightAt(x + o[0] * rr, z + o[1] * rr) + lift;
      if (h > best) best = h;
    }
    if (this.waterWalk && best < this.waterLevel) best = this.waterLevel;
    return best;
  }

  /** Footprint-averaged normal. A raw point normal jitters the slide state. */
  private sampleNormal(t: TerrainQuery, x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const r = this.tuning.radius * 0.7;
    t.normalAt(x, z, out);
    for (let i = 0; i < this.ring.length; i += 2) {
      const o = this.ring[i];
      t.normalAt(x + o[0] * r, z + o[1] * r, this.probeN);
      out.add(this.probeN);
    }
    if (this.waterWalk && this.position.y <= this.waterLevel + 0.05) out.set(0, 1, 0);
    return out.normalize();
  }

  step(dt: number, m: MoveIntent, t: TerrainQuery): void {
    const T = this.tuning;
    const v = this.velocity;
    const p = this.position;

    this.footEvent = 0;
    this.landImpact = 0;
    this.coyote = Math.max(0, this.coyote - dt);
    this.jumpLock = Math.max(0, this.jumpLock - dt);
    this.swimLock = Math.max(0, this.swimLock - dt);

    const wantCrouch = m.sneak && !this.levitate && !this.swimming;
    this.crouchBlend = damp(this.crouchBlend, wantCrouch ? 1 : 0, 11, dt);
    this.height = lerp(T.standHeight, T.crouchHeight, this.crouchBlend);

    // Levitation and water walking are the two spells that beat the sea, so they
    // are resolved before the water is: a levitating or water-walking mage is
    // never a swimmer, whatever the depth under them says.
    this.submersion = this.waterWalk
      ? 0
      : clamp((this.surfaceLevel - p.y) / Math.max(0.5, this.height), 0, 1);
    // Hysteresis. A single threshold makes the mode flip frame to frame in the
    // 10 cm of chop at the waterline, and every flip swaps the eye height and
    // the grounded flag — that is the shoreline jitter.
    if (this.levitate || this.waterWalk || this.swimLock > 0) this.swimming = false;
    else this.swimming = this.submersion > (this.swimming ? T.swimExit : T.swimEnter);
    this.swimBlend = damp(this.swimBlend, this.swimming ? 1 : 0, 9, dt);

    // World-space wish direction. Camera-forward at yaw 0 is -Z, matching the
    // Three.js camera basis, so the avatar and the view never disagree.
    const sy = Math.sin(m.yaw);
    const cy = Math.cos(m.yaw);
    const wx = m.x * cy - m.y * sy;
    const wz = -m.x * sy - m.y * cy;
    this.wish.set(wx, 0, wz);
    const wishLen = this.wish.length();
    if (wishLen > 1e-4) this.wish.multiplyScalar(1 / wishLen);

    if (this.levitate) {
      this.mode = 'levitate';
      this.stepLevitate(dt, m, wishLen);
    } else if (this.swimming) {
      this.mode = 'swim';
      this.stepSwim(dt, m, wishLen, t);
    } else {
      this.stepWalk(dt, m, wishLen, t);
    }

    this.integrate(dt, t);
    this.updateGait(dt);

    this.speed = Math.hypot(v.x, v.z);
    this.underwater = p.y + this.eyeHeight() < this.surfaceLevel;
  }

  private stepWalk(dt: number, m: MoveIntent, wishLen: number, t: TerrainQuery): void {
    const T = this.tuning;
    const v = this.velocity;

    // Sample the surface before moving so slide/step decisions use this frame's
    // contact, not last frame's.
    this.sampleNormal(t, this.position.x, this.position.z, this.sampledN);
    this.groundNormal.lerp(this.sampledN, 1 - Math.exp(-24 * dt)).normalize();
    const slopeCos = this.groundNormal.y;
    this.sliding = this.grounded && slopeCos < T.slopeLimitCos;

    let target = (m.sneak ? T.sneakSpeed : m.run ? T.runSpeed : T.walkSpeed) * this.speedScale;
    // Wading costs you speed long before you start swimming.
    target *= lerp(1, 0.55, clamp(this.submersion * 1.6, 0, 1));

    if (this.grounded && !this.sliding) {
      // Uphill is slower; downhill is not faster (that reads as ice).
      //
      // The terrain normal is (-dh/dx, 1, -dh/dz), so (-n.x, 0, -n.z) is the
      // gradient and points *uphill*. It was named `down` and the penalty was
      // gated on the negated dot product, which inverted the whole test: the
      // player took the hill tax running downhill and sprinted up 56-degree
      // banks at full speed. Measured, not inferred — see the slope trace.
      const uphill = this.tmpA.set(-this.groundNormal.x, 0, -this.groundNormal.z);
      if (uphill.lengthSq() > 1e-6) {
        uphill.normalize();
        const into = this.wish.dot(uphill);
        if (into > 0) {
          // Graded against the standable limit and squared, so rolling ground is
          // free and only a real bank bites. The old linear-in-(1-cos) form was
          // unbounded and taxed terrain you should run straight over.
          const grade = clamp(Math.acos(clamp(slopeCos, -1, 1)) / Math.acos(clamp(T.slopeLimitCos, -1, 1)), 0, 1);
          target *= lerp(1, T.slopeSpeedFloor, into * grade * grade);
        }
      }

      if (wishLen > 1e-3) {
        // Friction first, but only across the driven axis: see applyFriction.
        this.applyFriction(dt, T.groundFriction, T.stopSpeed, target * Math.min(1, wishLen));
        this.accelerateGround(dt, target * Math.min(1, wishLen), T.groundAccel);
      } else {
        this.applyFriction(dt, T.groundFriction, T.stopSpeed, 0);
      }
    } else if (this.sliding) {
      // Gravity along the surface: g - n(g·n), i.e. the downhill tangent.
      const n = this.groundNormal;
      const tan = this.tmpA.set(n.x * n.y, n.y * n.y - 1, n.z * n.y).normalize();
      const mag = T.gravity * Math.sqrt(Math.max(0, 1 - slopeCos * slopeCos));
      v.addScaledVector(tan, mag * dt);
      this.applyFriction(dt, 2.4, 0.8, 0);
      // Enough purchase to scramble across a too-steep face rather than be
      // pinned to it. Past the limit you still lose ground, which is the point.
      if (wishLen > 1e-3) this.accelerateAir(dt, target * 0.7, T.airAccel * 0.75);
    } else {
      if (wishLen > 1e-3) this.accelerateAir(dt, target * Math.min(1, wishLen), T.airAccel);
      const drag = Math.exp(-T.airDrag * dt);
      v.x *= drag;
      v.z *= drag;
    }

    if (this.grounded) this.coyote = T.coyoteTime;

    if (m.jump && this.coyote > 0 && this.jumpLock <= 0) {
      v.y = T.jumpSpeed * (this.crouchBlend > 0.5 ? 0.82 : 1);
      this.grounded = false;
      this.coyote = 0;
      this.jumpLock = T.jumpLockout;
    }

    // Buoyancy still applies while wading, so shallow water pushes you up the
    // bank instead of letting you clip through it.
    const g = T.gravity * (1 - this.submersion * 0.85);
    v.y -= g * dt;
    if (this.submersion > 0) {
      v.y += T.buoyancy * this.submersion * 0.35 * dt;
      const wd = Math.exp(-T.swimDrag * 0.4 * this.submersion * dt);
      v.x *= wd;
      v.z *= wd;
    }
    if (v.y < -T.terminalSpeed) v.y = -T.terminalSpeed;
  }

  /** Feet height at which a floating body comes to rest under this surface. */
  private floatHeight(): number {
    const T = this.tuning;
    return this.surfaceLevel - T.standHeight * 0.62 - T.swimEyeDepth;
  }

  /**
   * Swimming is a movement mode, not a fall with extra steps. Vertically it is
   * a saturating buoyancy spring against quadratic drag: constant lift while
   * deep, tapering to zero at the float line so the swimmer settles with the
   * eye just under the waterline instead of bobbing through it. Horizontally it
   * is stroke thrust against the same quadratic drag, so terminal speed is the
   * swim speed by construction.
   */
  private stepSwim(dt: number, m: MoveIntent, wishLen: number, t: TerrainQuery): void {
    const T = this.tuning;
    const v = this.velocity;
    const p = this.position;
    this.grounded = false;
    this.sliding = false;

    const target = (m.run ? T.swimFastSpeed : T.swimSpeed) * this.speedScale;

    // Gaze steering fades in with depth. At the surface you swim flat however
    // the camera is pitched — otherwise every glance at your own feet would
    // pull you under and buoyancy would shove you straight back, which is the
    // classic waterline fight.
    const gaze = clamp((this.submersion - T.swimEnter) / 0.25, 0, 1);
    const dir = this.tmpB.copy(this.wish);
    if (wishLen > 1e-3) {
      dir.y = Math.sin(m.pitch) * m.y * gaze;
      const l = dir.length();
      if (l > 1e-5) dir.multiplyScalar(1 / l);
      // thrust = c * target^2 is exactly the force the quadratic drag balances
      // at `target`, so the stroke has one tuning knob and no speed clamp.
      v.addScaledVector(dir, T.swimDragH * target * target * Math.min(1, wishLen) * dt);
    }

    // Deliberate vertical: space climbs, sneak dives. Diving also empties the
    // lungs — without cutting buoyancy you could never hold yourself down.
    let want = ((m.up ? 1 : 0) - (m.down ? 1 : 0)) * T.swimVertSpeed;
    // You cannot tread water higher than the water: the ascent fades out as the
    // head clears, so holding the key at the surface holds you there instead of
    // pumping you back and forth across the swim/walk threshold every frame.
    if (want > 0) want *= clamp((this.submersion - T.swimExit) / 0.2, 0, 1);
    if (want !== 0) v.y += (want - v.y) * Math.min(1, 6 * dt);
    const buoyScale = m.down ? 0.06 : 1;

    // Breaching: at the surface, jump either pulls you out onto adjacent land
    // or gives a small hop. Underwater it does nothing; `up` is the ascent.
    if (m.jump && this.jumpLock <= 0 && this.submersion <= T.swimEnter + 0.14) {
      if (!this.climbOut(t, m)) {
        v.y = Math.max(v.y, T.swimHopSpeed);
        this.jumpLock = T.jumpLockout;
      }
      return;
    }

    const sat = clamp((this.floatHeight() - p.y) / T.buoyancyDepth, -1, 1);
    v.y += T.buoyancy * sat * buoyScale * dt;
    // Critical damping of that spring, applied only inside the band and only
    // when the swimmer is not driving vertically. It is what makes an idle
    // swimmer settle at the waterline instead of bobbing; it must not brake the
    // long climb from the deep (quadratic drag already bounds that), and it
    // must not fight a deliberate dive, which would feel like treacle.
    const crit = want !== 0 ? 0 : 2 * Math.sqrt(T.buoyancy / T.buoyancyDepth) * (1 - Math.abs(sat));
    v.y *= Math.exp(-crit * dt);

    // Implicit form of dv/dt = -c*v*|v|. Explicit quadratic drag reverses the
    // velocity outright when c*|v|*dt > 1, which a 100 ms stall during a fast
    // dive entry reaches easily; this form cannot overshoot at any dt.
    v.y /= 1 + T.swimDragV * Math.abs(v.y) * dt;
    const hs = Math.hypot(v.x, v.z);
    if (hs > 1e-5) {
      const k = 1 / (1 + T.swimDragH * hs * dt);
      v.x *= k;
      v.z *= k;
    }
  }

  /**
   * Pulls the swimmer out of the water onto a bank in front of them. A
   * heightfield has no ledges to grab, so "climbable" is: dry-ish ground within
   * arm's reach that is not more than a body's pull above the waterline.
   */
  private climbOut(t: TerrainQuery, m: MoveIntent): boolean {
    const T = this.tuning;
    const p = this.position;
    let dx = this.wish.x;
    let dz = this.wish.z;
    if (Math.hypot(dx, dz) < 1e-3) {
      // Not steering: climb out the way you are looking.
      dx = -Math.sin(m.yaw);
      dz = -Math.cos(m.yaw);
    }
    for (let i = 0; i < 2; i++) {
      const reach = T.radius + (i === 0 ? 0.4 : 0.95);
      const x = p.x + dx * reach;
      const z = p.z + dz * reach;
      const h = this.supportHeight(t, x, z);
      if (h < this.surfaceLevel - 0.35 || h - p.y > T.swimClimbHeight) continue;
      // Never pull out onto ground the walker cannot stand on: the slide state
      // would drop us straight back in, which reads as the water rejecting you.
      if (this.sampleNormal(t, x, z, this.sampledN).y < T.slopeLimitCos) continue;
      // Exactly on the surface, not above it: integrate() then grounds us this
      // same frame instead of letting a 2 cm gap read as a fall.
      p.set(x, h, z);
      this.velocity.set(0, 0, 0);
      this.swimming = false;
      // swimBlend is left to damp out on its own: the eye rises from the
      // waterline to standing height over the pull-out, which is the motion.
      this.grounded = true;
      this.wasGrounded = true;
      this.submersion = clamp((this.surfaceLevel - p.y) / T.standHeight, 0, 1);
      // One frame of walking before the water may claim us again, so the
      // handover cannot ping-pong on the first chop that laps the bank.
      this.swimLock = 0.2;
      this.jumpLock = T.jumpLockout;
      this.sampleNormal(t, x, z, this.groundNormal);
      return true;
    }
    return false;
  }

  private stepLevitate(dt: number, m: MoveIntent, wishLen: number): void {
    const T = this.tuning;
    const v = this.velocity;
    this.grounded = false;
    this.sliding = false;
    this.swimming = false;

    const target = m.run ? T.levitateFastSpeed : T.levitateSpeed;
    const dir = this.tmpB.copy(this.wish);
    if (wishLen > 1e-3) {
      // Forward follows the gaze: looking up and walking forward gains altitude,
      // which is the whole point of the spell.
      dir.y = Math.sin(m.pitch) * m.y;
      dir.normalize();
      v.addScaledVector(dir, T.levitateAccel * dt * Math.min(1, wishLen));
    }
    let vy = 0;
    if (m.up) vy += target * 0.8;
    if (m.down) vy -= target * 0.8;
    if (vy !== 0) v.y += (vy - v.y) * Math.min(1, 6 * dt);

    const d = Math.exp(-T.levitateDrag * dt);
    v.multiplyScalar(d);
    const sp = v.length();
    if (sp > target) v.multiplyScalar(target / sp);
  }

  /**
   * Quake-style friction: a floor on the control speed guarantees a hard stop
   * instead of an exponential tail that never quite reaches zero.
   *
   * `keepAlong` is the speed the player is actively asking for along `wish`,
   * and that component is exempt. Braking a driven axis at the same time as
   * accelerating it makes the two terms a tug of war whose top speed is
   * whatever their ratio happens to land on — with the old 8.5 friction against
   * 62 accel, friction was already eating 90% of the accelerator at the top of
   * a run, so friction could not be raised for a crisper stop and the target
   * speed was not actually reachable once the RPG layer scaled it up. Splitting
   * it means friction owns the stop and the accelerator owns the top speed, and
   * neither number lies about what it does.
   */
  private applyFriction(dt: number, friction: number, stopSpeed: number, keepAlong: number): void {
    const v = this.velocity;
    const s = Math.hypot(v.x, v.z);
    if (s < 1e-4) {
      v.x = v.z = 0;
      return;
    }
    const drop = Math.max(s, stopSpeed) * friction * dt;
    if (keepAlong <= 0) {
      const k = Math.max(0, s - drop) / s;
      v.x *= k;
      v.z *= k;
      return;
    }
    const ax = this.wish.x;
    const az = this.wish.z;
    let along = v.x * ax + v.z * az;
    let px = v.x - ax * along;
    let pz = v.z - az * along;
    // Sideways scrub always brakes — that is what kills the skid out of a turn.
    const ps = Math.hypot(px, pz);
    if (ps > 1e-5) {
      const k = Math.max(0, ps - drop) / ps;
      px *= k;
      pz *= k;
    }
    // Along the drive: brake only an overspeed (a downhill run-out, or letting
    // go of sprint) or motion opposing the input.
    if (along > keepAlong) along = Math.max(keepAlong, along - drop);
    else if (along < 0) along = Math.min(0, along + drop);
    v.x = px + ax * along;
    v.z = pz + az * along;
  }

  private accelerateGround(dt: number, target: number, accel: number): void {
    const v = this.velocity;
    const cur = Math.hypot(v.x, v.z);
    // Punchier off the mark, tapering in — a constant rate feels like ice.
    const curve = 1 + 0.75 * (1 - Math.min(1, cur / Math.max(0.01, target)));
    const dx = this.wish.x * target - v.x;
    const dz = this.wish.z * target - v.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) return;
    const maxDelta = accel * curve * dt;
    const k = Math.min(1, maxDelta / len);
    v.x += dx * k;
    v.z += dz * k;
  }

  /** Quake air control: only the component that adds speed up to `target`. */
  private accelerateAir(dt: number, target: number, accel: number): void {
    const v = this.velocity;
    const proj = v.x * this.wish.x + v.z * this.wish.z;
    const add = Math.min(Math.max(0, target - proj), accel * dt);
    if (add <= 0) return;
    v.x += this.wish.x * add;
    v.z += this.wish.z * add;
  }

  private integrate(dt: number, t: TerrainQuery): void {
    const T = this.tuning;
    const p = this.position;
    const v = this.velocity;

    const dx = v.x * dt;
    const dz = v.z * dt;
    if (dx !== 0 || dz !== 0) this.moveHorizontal(dx, dz, t);

    p.y += v.y * dt;

    const ground = this.supportHeight(t, p.x, p.z);
    const noclipTerrain = this.levitate;

    if (p.y <= ground) {
      p.y = ground;
      if (v.y < 0) {
        // Touching down on the seabed is not a landing: the water took the fall,
        // so no camera dip and no 'player:land'.
        if (!this.wasGrounded && !this.swimming) this.landImpact = -v.y;
        v.y = 0;
      }
      this.grounded = !noclipTerrain && !this.swimming;
    } else if (
      this.wasGrounded &&
      !this.swimming &&
      !noclipTerrain &&
      this.jumpLock <= 0 &&
      v.y <= 0.6 &&
      p.y - ground <= T.snapDistance
    ) {
      // Ground snap: set the position outright rather than nudging with
      // velocity, so gentle slopes cannot oscillate around contact.
      p.y = ground;
      v.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    if (noclipTerrain && p.y < ground + 0.02) p.y = ground + 0.02;

    const ext = t.extent - 2;
    p.x = clamp(p.x, -ext, ext);
    p.z = clamp(p.z, -ext, ext);

    this.wasGrounded = this.grounded;
  }

  /**
   * Horizontal sweep with step-up and contour sliding. A heightfield has no
   * walls, so "blocked" means the support height rose more than we can step
   * over; the escape is to project the motion onto the local contour line.
   */
  private moveHorizontal(dx: number, dz: number, t: TerrainQuery): void {
    const T = this.tuning;
    const p = this.position;
    // A floating body is not blocked by the bed: it is blocked by ground that
    // rises out of the water. Using the walker's 8 cm air allowance here is what
    // pinned swimmers against every shoaling beach, unable to reach the shore.
    const climb = this.swimming
      ? Math.max(T.stepHeight, this.surfaceLevel + T.stepHeight - p.y)
      : this.grounded
        ? T.stepHeight
        : 0.08;

    let nx = p.x + dx;
    let nz = p.z + dz;
    let h = this.supportHeight(t, nx, nz);

    if (h - p.y > climb) {
      // Blocked. The horizontal part of the surface normal points downhill,
      // so removing the motion along it leaves motion along the contour.
      t.normalAt(nx, nz, this.probeN);
      const hx = this.probeN.x;
      const hz = this.probeN.z;
      const hl = Math.hypot(hx, hz);
      if (hl > 1e-4) {
        const ux = hx / hl;
        const uz = hz / hl;
        const d = dx * ux + dz * uz;
        const sx = dx - ux * d;
        const sz = dz - uz * d;
        nx = p.x + sx;
        nz = p.z + sz;
        h = this.supportHeight(t, nx, nz);
        if (h - p.y > climb) return; // Corner: give up this frame rather than tunnel.
        // Kill the velocity we just discarded so it cannot build up into the wall.
        const vd = this.velocity.x * ux + this.velocity.z * uz;
        this.velocity.x -= ux * vd;
        this.velocity.z -= uz * vd;
      } else {
        return;
      }
    }

    p.x = nx;
    p.z = nz;
    if (this.grounded && h > p.y) p.y = h; // Step up onto the ledge.
  }

  private updateGait(dt: number): void {
    const T = this.tuning;
    const v = this.velocity;
    const hs = Math.hypot(v.x, v.z);

    // Stride length blends with speed instead of switching at a threshold. A
    // discrete swap means every speed between the two gaits gets the wrong
    // cadence — a 4 m/s jog was footfalling at a walk's 84 steps/min, and a slow
    // cadence reads as slow movement no matter what the velocity is.
    const stride = this.crouchBlend > 0.5
      ? T.strideSneak
      : lerp(T.strideWalk, T.strideRun, smoothstep(T.walkSpeed, T.runSpeed, hs));
    const moving = this.grounded && !this.sliding && hs > 0.35;
    if (moving) this.gaitPhase = (this.gaitPhase + (hs / stride) * Math.PI * dt) % TAU;

    const targetAmount = moving ? clamp(hs / T.walkSpeed, 0, 1.35) : 0;
    this.gaitAmount = damp(this.gaitAmount, targetAmount, moving ? 11 : 7, dt);

    // Foot plant at the extremes of the swing, not at the crossings.
    const s = Math.sin(this.gaitPhase);
    if (moving && this.gaitAmount > 0.25) {
      if (this.prevGaitSin > 0 && s <= 0) this.footEvent = 1;
      else if (this.prevGaitSin < 0 && s >= 0) this.footEvent = 2;
    }
    this.prevGaitSin = s;
  }

  /** Places the feet `lift` metres above the resting surface at (x,z); clears motion. */
  place(t: TerrainQuery, x: number, z: number, lift = 0): void {
    const T = this.tuning;
    const bed = this.supportHeight(t, x, z);
    // The surface a body rests on at (x,z) is the seabed only where it can
    // stand there. Over open water it is the water: that is the equilibrium of
    // the buoyancy model below, and it is the only reading that does not drop
    // spawns and screenshot framings eighty metres under the Inner Sea.
    const rest = this.levitate || this.waterWalk ? bed : Math.max(bed, this.floatHeight());
    this.position.set(x, rest + 0.02 + Math.max(0, lift), z);
    this.velocity.set(0, 0, 0);
    this.submersion = this.waterWalk
      ? 0
      : clamp((this.surfaceLevel - this.position.y) / T.standHeight, 0, 1);
    this.swimming = !this.levitate && !this.waterWalk && this.submersion > T.swimEnter;
    // No blend after a teleport: the first frame has to be usable as-is.
    this.swimBlend = this.swimming ? 1 : 0;
    this.underwater = this.position.y + this.eyeHeight() < this.surfaceLevel;
    this.grounded = lift <= 0 && !this.swimming && rest <= bed;
    this.wasGrounded = this.grounded;
    this.sliding = false;
    this.gaitAmount = 0;
    this.gaitPhase = 0;
    this.coyote = 0;
    this.jumpLock = 0;
    this.swimLock = 0;
    this.sampleNormal(t, x, z, this.groundNormal);
  }

  /** Eye height above the feet, blended across the swim transition. */
  private eyeHeight(): number {
    const T = this.tuning;
    const stand = this.height + T.eyeOffset;
    // Swimming lowers the eye to the waterline; a hard swap pops the view by
    // half a metre at the exact moment the mode changes.
    return lerp(stand, Math.min(stand, T.standHeight * 0.62), this.swimBlend);
  }

  /** Eye position in world space, before bob/shake. */
  eye(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + this.eyeHeight(), this.position.z);
  }

  /** Unused axis kept for readability at call sites that need world up. */
  static get UP(): THREE.Vector3 {
    return UP;
  }
}
