import * as THREE from 'three';

export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Framerate-independent exponential approach. `rate` is the reciprocal of the
 * time constant, so the result is identical at 30fps and 144fps — a plain
 * `lerp(a, b, k)` is not, and produces visibly different camera feel per
 * machine.
 */
export function damp(cur: number, target: number, rate: number, dt: number): number {
  return target + (cur - target) * Math.exp(-rate * dt);
}

export function dampVec(out: THREE.Vector3, target: THREE.Vector3, rate: number, dt: number): THREE.Vector3 {
  const k = Math.exp(-rate * dt);
  out.x = target.x + (out.x - target.x) * k;
  out.y = target.y + (out.y - target.y) * k;
  out.z = target.z + (out.z - target.z) * k;
  return out;
}

/**
 * Critically damped spring (Unity's SmoothDamp integrator). Used instead of a
 * raw exponential where we need velocity continuity — the third-person boom
 * overshoots and snaps without a real velocity term.
 */
export class Spring1 {
  value = 0;
  vel = 0;

  set(v: number): void {
    this.value = v;
    this.vel = 0;
  }

  step(target: number, smoothTime: number, dt: number, maxSpeed = Infinity): number {
    const omega = 2 / Math.max(1e-4, smoothTime);
    const x = omega * dt;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    let change = this.value - target;
    const maxChange = maxSpeed * smoothTime;
    change = clamp(change, -maxChange, maxChange);
    const goal = this.value - change;
    const temp = (this.vel + omega * change) * dt;
    this.vel = (this.vel - omega * temp) * exp;
    let out = goal + (change + temp) * exp;
    // Kill the sign flip that SmoothDamp produces when it overshoots the goal.
    if (target - this.value > 0 === out > target) {
      out = target;
      this.vel = (out - target) / dt;
    }
    this.value = out;
    return out;
  }
}

export class Spring3 {
  readonly value = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  private readonly sx = new Spring1();
  private readonly sy = new Spring1();
  private readonly sz = new Spring1();

  set(v: THREE.Vector3): void {
    this.value.copy(v);
    this.vel.set(0, 0, 0);
    this.sx.set(v.x);
    this.sy.set(v.y);
    this.sz.set(v.z);
  }

  step(target: THREE.Vector3, smoothTime: number, dt: number): THREE.Vector3 {
    this.value.set(
      this.sx.step(target.x, smoothTime, dt),
      this.sy.step(target.y, smoothTime, dt),
      this.sz.step(target.z, smoothTime, dt),
    );
    this.vel.set(this.sx.vel, this.sy.vel, this.sz.vel);
    return this.value;
  }
}

/** Second-order harmonic oscillator, for the landing dip and weapon-less lean. */
export class Oscillator {
  value = 0;
  vel = 0;

  constructor(
    private stiffness: number,
    private damping: number,
  ) {}

  kick(impulse: number): void {
    this.vel += impulse;
  }

  step(dt: number): number {
    // Substep so a 100ms stall cannot make a stiff spring explode.
    const steps = Math.min(4, 1 + Math.floor(dt / 0.02));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.vel += (-this.stiffness * this.value - this.damping * this.vel) * h;
      this.value += this.vel * h;
    }
    return this.value;
  }
}
