/**
 * Deterministic pseudo-randomness for the architecture generators.
 *
 * Every structure is authored from a single integer seed so a settlement is
 * reproducible frame-to-frame and across reloads — the shots harness re-frames
 * against a live heightfield, and a settlement that reshuffled itself between
 * captures would make visual regressions impossible to read.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    // 0 is a fixed point of mulberry32's state update; bias it away.
    this.s = (seed >>> 0) || 0x9e3779b9;
  }

  /** Uniform in [0,1). mulberry32 — 2^32 period, passes smallcrush, 4 ops. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Integer in [a,b] inclusive. */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))];
  }

  /** Symmetric jitter, ±m. */
  jitter(m: number): number {
    return (this.next() * 2 - 1) * m;
  }

  /** Derive an independent stream. Used so adding a prop never reshuffles walls. */
  fork(salt: number): Rng {
    return new Rng((Math.imul(this.s ^ salt, 0x85ebca6b) ^ 0x27d4eb2f) >>> 0);
  }
}

/** Stable scalar hash of two integers, in [0,1). For grid-driven variation. */
export function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise on the CPU. Drives silhouette lumps, not textures. */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}
