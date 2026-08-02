import * as THREE from 'three';
import type { TerrainQuery } from '../core/types';
import type { CharacterController } from './Controller';
import { Oscillator, Spring1, clamp, damp, lerp, smoothstep } from './mathx';
import { fbm1 } from './noise';

const DEG = Math.PI / 180;
const PITCH_LIMIT = 89.2 * DEG;

/**
 * Degrees of vertical FOV added at a full run. This does more for the sense of
 * speed than the velocity does — the old +4.5 eased in over ~0.4 s read as a
 * lens drifting rather than as acceleration.
 */
const FOV_RUN_KICK = 7;
/** Asymmetric: the kick has to land with the acceleration, and leave gently. */
const FOV_RATE_IN = 16;
const FOV_RATE_OUT = 8;

interface ShakeEvent {
  amp: number;
  dur: number;
  t: number;
}

/** Free-fly axes in camera space; y is world up so the flight stays level. */
export interface FlyIntent {
  right: number;
  forward: number;
  up: number;
  fast: boolean;
  slow: boolean;
}

export interface RigFrame {
  dt: number;
  ctrl: CharacterController;
  terrain: TerrainQuery;
  camera: THREE.PerspectiveCamera;
  /** Raw strafe axis, for the lean roll. */
  strafe: number;
  wheel: number;
  fly: FlyIntent | null;
}

/**
 * Owns everything between the character's feet and the projection matrix:
 * mouse look, head bob, landing recoil, the third-person boom with its terrain
 * sweep, trauma-based shake and the detached screenshot camera.
 */
export class CameraRig {
  view: 'first' | 'third' = 'first';
  freeFly = false;
  /** Radians of yaw per pixel of pointer movement. */
  sensitivity = 0.0022;
  invertY = false;
  yaw = 0;
  pitch = 0;
  /** Third-person boom length in metres. */
  distance = 4.0;
  flySpeed = 14;

  private readonly pivot = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly probe = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  private readonly px = new Spring1();
  private readonly py = new Spring1();
  private readonly pz = new Spring1();
  private readonly boom = new Spring1();
  private readonly dip = new Oscillator(150, 17);
  private roll = 0;
  private bobX = 0;
  private bobY = 0;
  private bobPitch = 0;
  private stepOffset = 0;
  private prevFeetY = 0;
  private fovBase = 0;

  /**
   * Base field of view before the run kick and swim trim. The settings slider
   * MUST come through here: the rig rewrites `camera.fov` from `fovBase` every
   * frame, so anything that assigns `camera.fov` directly is overwritten on the
   * next tick and the control appears to do nothing.
   */
  get baseFov(): number {
    return this.fovBase;
  }
  set baseFov(v: number) {
    this.fovBase = clamp(v, 40, 120);
  }
  private fovCur = 0;
  private shakes: ShakeEvent[] = [];
  private trauma = 0;
  private readonly flyPos = new THREE.Vector3();
  private readonly flyVel = new THREE.Vector3();
  private flyPrimed = false;
  private teleported = true;

  /** Camera-space shake, exposed so the post stack could reuse the trauma. */
  get shakeTrauma(): number {
    return this.trauma;
  }

  look(dx: number, dy: number): void {
    this.yaw -= dx * this.sensitivity;
    this.pitch -= (this.invertY ? -dy : dy) * this.sensitivity;
    // Wrap yaw to keep float precision sane over long sessions.
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
    this.pitch = clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  /** Point the view along a world direction. Used by screenshot tooling. */
  setView(dir: THREE.Vector3): void {
    const d = this.probe.copy(dir);
    if (d.lengthSq() < 1e-8) return;
    d.normalize();
    this.pitch = clamp(Math.asin(clamp(d.y, -1, 1)), -PITCH_LIMIT, PITCH_LIMIT);
    this.yaw = Math.atan2(-d.x, -d.z);
  }

  /** Adds trauma; overlapping calls stack but saturate. */
  shake(amplitude: number, seconds: number): void {
    if (amplitude <= 0 || seconds <= 0) return;
    if (this.shakes.length > 8) this.shakes.shift();
    this.shakes.push({ amp: amplitude, dur: seconds, t: 0 });
  }

  /** Suppresses one frame of smoothing after a teleport so nothing streaks. */
  snap(): void {
    this.teleported = true;
    this.flyPrimed = false;
  }

  setFreeFly(on: boolean, camera: THREE.PerspectiveCamera | null): boolean {
    if (on === this.freeFly) return this.freeFly;
    this.freeFly = on;
    if (on && camera) {
      this.flyPos.copy(camera.position);
      this.flyVel.set(0, 0, 0);
      this.flyPrimed = true;
    } else if (on) {
      this.flyPrimed = false;
    } else {
      // Rejoin the body without streaking the boom across the map.
      this.teleported = true;
    }
    return this.freeFly;
  }

  toggleFreeFly(camera: THREE.PerspectiveCamera): boolean {
    return this.setFreeFly(!this.freeFly, camera);
  }

  update(f: RigFrame): void {
    const { dt, ctrl, camera } = f;
    if (this.fovBase === 0) {
      this.fovBase = camera.fov;
      this.fovCur = camera.fov;
    }

    this.updateTrauma(dt);

    if (this.freeFly) {
      this.updateFreeFly(f);
    } else if (this.view === 'first') {
      this.updateFirst(f);
    } else {
      this.updateThird(f);
    }

    this.applyOrientation(camera);
    this.updateFov(camera, ctrl, dt);
    this.prevFeetY = ctrl.position.y;
    this.teleported = false;
  }

  private updateTrauma(dt: number): void {
    let sum = 0;
    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const s = this.shakes[i];
      s.t += dt;
      if (s.t >= s.dur) {
        this.shakes.splice(i, 1);
        continue;
      }
      const k = 1 - s.t / s.dur;
      sum += s.amp * k * k;
    }
    this.trauma = Math.min(1.5, sum);
  }

  /**
   * Step-ups and ground snaps move the feet instantly; carrying the jump as a
   * decaying offset is what keeps stairs and rubble from strobing the view.
   */
  private absorbStep(ctrl: CharacterController, dt: number): void {
    if (this.teleported) {
      this.stepOffset = 0;
      return;
    }
    if (ctrl.grounded && ctrl.landImpact === 0) {
      const predicted = this.prevFeetY + ctrl.velocity.y * dt;
      const delta = ctrl.position.y - predicted;
      if (Math.abs(delta) > 0.002) this.stepOffset = clamp(this.stepOffset + delta, -0.65, 0.65);
    }
    this.stepOffset = damp(this.stepOffset, 0, 15, dt);
  }

  private updateBob(ctrl: CharacterController, strafe: number, dt: number): void {
    const T = ctrl.tuning;
    const sp = ctrl.speed;
    const runK = smoothstep(T.walkSpeed, T.runSpeed * 0.92, sp);
    // Amplitude tracks real speed across the whole range. gaitAmount saturates
    // just above a walk — using it as the amplitude meant a sprint bobbed no
    // harder than a jog — so it is demoted to the fade in and out of the cycle,
    // and speed itself drives the size. Subtle by design at the low end: >5cm of
    // vertical travel reads as a camera bug rather than as effort.
    const settle = clamp(ctrl.gaitAmount, 0, 1);
    let amp = lerp(0.021, 0.048, smoothstep(T.walkSpeed * 0.55, T.runSpeed, sp)) * settle;
    amp *= lerp(1, 0.45, ctrl.crouchBlend);
    if (!ctrl.grounded) amp = 0;

    const p = ctrl.gaitPhase;
    const tgtY = Math.sin(p * 2) * amp;
    const tgtX = Math.sin(p) * amp * 0.85;
    const tgtPitch = Math.sin(p * 2 + 0.7) * amp * 0.16;

    // The vertical bob is already ~3 Hz at a run; a 22 rate is a lowpass that
    // quietly took a quarter of the amplitude back off at exactly the speed it
    // was needed. 40 passes the cycle and still smooths amplitude changes.
    const rate = 40;
    this.bobY = damp(this.bobY, tgtY, rate, dt);
    this.bobX = damp(this.bobX, tgtX, rate, dt);
    this.bobPitch = damp(this.bobPitch, tgtPitch, rate, dt);

    const leanTarget = -strafe * 1.15 * DEG * lerp(0.35, 1, runK) + Math.sin(p) * 0.7 * DEG * settle;
    this.roll = damp(this.roll, leanTarget, 9, dt);
  }

  private updateFirst(f: RigFrame): void {
    const { ctrl, camera, dt } = f;
    this.absorbStep(ctrl, dt);
    this.updateBob(ctrl, f.strafe, dt);

    if (ctrl.landImpact > 1.5) this.dip.kick(-clamp(ctrl.landImpact, 0, 22) * 0.014);
    if (ctrl.footEvent !== 0) this.dip.kick(-0.0055 * ctrl.gaitAmount);
    this.dip.step(dt);

    ctrl.eye(this.desired);
    this.desired.y -= this.stepOffset;
    this.desired.y += this.bobY + clamp(this.dip.value, -0.3, 0.12);

    // Lateral bob rides the yaw basis, otherwise it would swing in world space.
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    this.desired.x += cy * this.bobX;
    this.desired.z += -sy * this.bobX;

    camera.position.copy(this.desired);
  }

  private updateThird(f: RigFrame): void {
    const { ctrl, camera, terrain, dt } = f;
    this.absorbStep(ctrl, dt);
    this.updateBob(ctrl, f.strafe, dt);
    if (ctrl.landImpact > 1.5) this.dip.kick(-clamp(ctrl.landImpact, 0, 22) * 0.009);
    this.dip.step(dt);

    if (f.wheel !== 0) this.distance = clamp(this.distance + f.wheel * 0.004, 1.6, 9);

    const px = ctrl.position.x;
    const py = ctrl.position.y - this.stepOffset + ctrl.height * 0.86 + this.dip.value * 0.5;
    const pz = ctrl.position.z;
    if (this.teleported) {
      this.px.set(px);
      this.py.set(py);
      this.pz.set(pz);
      this.boom.set(this.distance);
    }
    this.pivot.set(this.px.step(px, 0.05, dt), this.py.step(py, 0.11, dt), this.pz.step(pz, 0.05, dt));

    this.dirFromAngles(this.fwd);
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // Over-the-shoulder offset, faded out as the camera looks straight down so
    // the character does not slide off frame.
    const shoulder = 0.42 * (1 - smoothstep(-0.4, -1.1, this.pitch));
    this.desired.copy(this.pivot).addScaledVector(this.right, shoulder);

    const wanted = this.sweepBoom(terrain, this.desired, this.fwd, this.distance);
    // Pull in instantly (never clip the hillside), ease back out.
    let d: number;
    if (wanted < this.boom.value) {
      this.boom.set(wanted);
      d = wanted;
    } else {
      d = this.boom.step(wanted, 0.22, dt);
    }

    camera.position.copy(this.desired).addScaledVector(this.fwd, -d);
    const floor = terrain.heightAt(camera.position.x, camera.position.z) + 0.35;
    if (camera.position.y < floor) camera.position.y = floor;
  }

  /**
   * Marches the boom against the heightfield. A ray/mesh raycast would be
   * exact but costs a BVH query per frame; 10 height samples are cheaper and
   * the heightfield is the only occluder that matters outdoors.
   */
  private sweepBoom(terrain: TerrainQuery, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    const steps = 10;
    const clearance = 0.5;
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * maxDist;
      const x = origin.x - dir.x * t;
      const y = origin.y - dir.y * t;
      const z = origin.z - dir.z * t;
      if (y < terrain.heightAt(x, z) + clearance) {
        return Math.max(0.6, ((i - 1) / steps) * maxDist);
      }
    }
    return maxDist;
  }

  private updateFreeFly(f: RigFrame): void {
    const { dt, camera } = f;
    const fly = f.fly ?? { right: 0, forward: 0, up: 0, fast: false, slow: false };
    if (!this.flyPrimed) {
      this.flyPos.copy(camera.position);
      this.flyVel.set(0, 0, 0);
      this.flyPrimed = true;
    }
    if (f.wheel !== 0) this.flySpeed = clamp(this.flySpeed * Math.exp(-f.wheel * 0.0012), 0.5, 900);

    this.dirFromAngles(this.fwd);
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const speed = this.flySpeed * (fly.fast ? 5 : 1) * (fly.slow ? 0.15 : 1);
    this.desired
      .set(0, 0, 0)
      .addScaledVector(this.fwd, fly.forward)
      .addScaledVector(this.right, fly.right);
    this.desired.y += fly.up;
    const l = this.desired.length();
    if (l > 1e-4) this.desired.multiplyScalar(speed / l);

    // Damped, not instant: smooth acceleration is what makes flythrough
    // screenshots and capture passes usable.
    const k = 1 - Math.exp(-9 * dt);
    this.flyVel.lerp(this.desired, k);
    this.flyPos.addScaledVector(this.flyVel, dt);
    camera.position.copy(this.flyPos);
  }

  private dirFromAngles(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  private applyOrientation(camera: THREE.PerspectiveCamera): void {
    let yaw = this.yaw;
    let pitch = this.pitch + this.bobPitch;
    let roll = this.roll;

    if (this.trauma > 0.0001) {
      // trauma^2 keeps small hits gentle and big ones violent.
      const s = this.trauma * this.trauma;
      const t = performance.now() * 0.001;
      yaw += fbm1(t * 23.0, 3) * 0.035 * s;
      pitch += fbm1(t * 21.0 + 91.3, 3) * 0.030 * s;
      roll += fbm1(t * 19.0 + 411.7, 3) * 0.055 * s;
      camera.position.x += fbm1(t * 27.0 + 13.0, 2) * 0.05 * s;
      camera.position.y += fbm1(t * 29.0 + 77.0, 2) * 0.05 * s;
      camera.position.z += fbm1(t * 31.0 + 141.0, 2) * 0.05 * s;
    }

    this.euler.set(pitch, yaw, roll, 'YXZ');
    camera.quaternion.setFromEuler(this.euler);
  }

  private updateFov(camera: THREE.PerspectiveCamera, ctrl: CharacterController, dt: number): void {
    const T = ctrl.tuning;
    let target = this.fovBase;
    if (!this.freeFly) {
      // Anchored below runSpeed on purpose. Gating the kick on the theoretical
      // top speed means it almost never fires outdoors, where a hillside or a
      // shallow ford keeps you a few tenths under it all the time.
      const run = smoothstep(T.walkSpeed * 1.15, T.runSpeed * 0.88, ctrl.speed);
      target += run * FOV_RUN_KICK;
      if (ctrl.swimming) target -= 2.5;
    }
    this.fovCur = damp(this.fovCur, target, this.fovCur < target ? FOV_RATE_IN : FOV_RATE_OUT, dt);
    if (Math.abs(camera.fov - this.fovCur) > 0.01) {
      camera.fov = this.fovCur;
      camera.updateProjectionMatrix();
    }
  }
}
