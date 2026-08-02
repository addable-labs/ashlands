/**
 * Small DSP and scheduling helpers shared by every audio voice.
 *
 * Everything here is deterministic where it can be: the score is regenerated
 * from a saved seed, so a reloaded save must produce the same music, and a
 * reverb impulse must not change character between sessions.
 */

/** Structural, so a THREE.Vector3 satisfies it without audio importing three. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** xorshift32. Cheap, seedable, and its state is one integer to serialise. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = (seed >>> 0) || 0x9e3779b9;
  }

  next(): number {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  int(n: number): number {
    return Math.min(n - 1, Math.floor(this.next() * n));
  }

  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)];
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  get state(): number {
    return this.s;
  }

  set state(v: number) {
    this.s = (v >>> 0) || 0x9e3779b9;
  }
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6));
  return t * t * (3 - 2 * t);
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** MIDI note to Hz, A4 = 69 = 440. */
export function noteHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function cents(ratioCents: number): number {
  return Math.pow(2, ratioCents / 1200);
}

/** exponentialRamp throws on zero, and silence is -80 dB, not -inf. */
export function safe(v: number): number {
  return v > 1e-4 ? v : 1e-4;
}

/** Percussive attack/decay on a gain param, in absolute context time. */
export function ad(p: AudioParam, t: number, peak: number, attack: number, decay: number): void {
  p.setValueAtTime(1e-4, t);
  p.exponentialRampToValueAtTime(safe(peak), t + Math.max(0.0005, attack));
  p.exponentialRampToValueAtTime(1e-4, t + Math.max(0.0015, attack + decay));
}

/** Attack / hold / release, for sustained voices. */
export function ahr(
  p: AudioParam,
  t: number,
  peak: number,
  attack: number,
  hold: number,
  release: number,
): void {
  p.setValueAtTime(1e-4, t);
  p.exponentialRampToValueAtTime(safe(peak), t + Math.max(0.001, attack));
  p.setValueAtTime(safe(peak), t + attack + hold);
  p.exponentialRampToValueAtTime(1e-4, t + attack + hold + Math.max(0.002, release));
}

/** Piecewise exponential segments, times relative to `t`. */
export function glide(p: AudioParam, t: number, pts: readonly (readonly [number, number])[]): void {
  if (pts.length === 0) return;
  p.setValueAtTime(safe(pts[0][1]), t + pts[0][0]);
  for (let i = 1; i < pts.length; i++) p.exponentialRampToValueAtTime(safe(pts[i][1]), t + pts[i][0]);
}

/** tanh drive, normalised so the curve still spans [-1,1] at any amount. */
export function saturationCurve(amount: number, n = 1024) {
  const c = new Float32Array(n);
  const k = Math.max(0.001, amount);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  return c;
}

/**
 * Final safety curve after the limiter. The compressor catches programme
 * material; this catches the sample-peak overshoot it lets through, without
 * the audible pumping a lower threshold would cost.
 */
export function softClipCurve(n = 2048) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = x / (1 + Math.abs(x) * 0.35);
  }
  return c;
}
