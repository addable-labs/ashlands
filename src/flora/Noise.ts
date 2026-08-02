/**
 * Deterministic CPU noise for flora synthesis.
 *
 * Self-contained on purpose: every mushroom, every scatter point and every
 * texel of the atlas has to be reproducible from a seed, and reproducible
 * across reloads. Borrowing another subsystem's noise would couple flora to
 * edits made for terrain reasons.
 */

/** Integer avalanche hash. Returns [0,1). Cheap and free of the sin() banding. */
export function hashI(i: number): number {
  let h = i | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

/** 2D integer lattice hash. */
export function hash2I(x: number, y: number): number {
  return hashI(Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1));
}

/** mulberry32 — small, fast, and good enough that a variant pool looks organic. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = (seed | 0) >>> 0;
    // Warm up: adjacent seeds must not produce correlated first draws, which is
    // exactly what happens when variant index is used as the raw seed.
    this.s = (this.s + 0x9e3779b9) >>> 0;
    this.next();
    this.next();
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Uniform in [a,b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  /** Symmetric, triangular-ish: more mass near the middle. Reads as "natural". */
  around(mid: number, spread: number): number {
    return mid + (this.next() + this.next() - 1) * spread;
  }
  int(n: number): number {
    return Math.min(n - 1, (this.next() * n) | 0);
  }
  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise on the integer lattice. Range roughly [0,1]. */
export function value2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = fade(x - xi);
  const ty = fade(y - yi);
  const a = hash2I(xi, yi);
  const b = hash2I(xi + 1, yi);
  const c = hash2I(xi, yi + 1);
  const d = hash2I(xi + 1, yi + 1);
  const top = a + (b - a) * tx;
  const bot = c + (d - c) * tx;
  return top + (bot - top) * ty;
}

/** Fractal value noise, normalised to [0,1]. */
export function fbm2(x: number, y: number, octaves = 4, lac = 2.03, gain = 0.5): number {
  let f = 1;
  let a = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += a * value2(x * f, y * f);
    norm += a;
    f *= lac;
    a *= gain;
  }
  return sum / norm;
}

/** Tileable-in-x value noise, for atlas bands whose u wraps around a lathe. */
export function valueWrapX(x: number, y: number, period: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = fade(x - xi);
  const ty = fade(y - yi);
  const w = (i: number): number => ((i % period) + period) % period;
  const x0 = w(xi);
  const x1 = w(xi + 1);
  const a = hash2I(x0, yi);
  const b = hash2I(x1, yi);
  const c = hash2I(x0, yi + 1);
  const d = hash2I(x1, yi + 1);
  const top = a + (b - a) * tx;
  const bot = c + (d - c) * tx;
  return top + (bot - top) * ty;
}

export function fbmWrapX(x: number, y: number, period: number, octaves = 4): number {
  let f = 1;
  let a = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += a * valueWrapX(x * f, y * f, period * f);
    norm += a;
    f *= 2;
    a *= 0.5;
  }
  return sum / norm;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-9));
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Toroidal Poisson-disc set in the unit square, by dart-throwing with wrap-around
 * distance. Used as the per-tile blade pattern for ground cover: because the
 * distance metric wraps, the same set laid edge-to-edge across tiles stays
 * blue-noise across tile seams instead of clumping along them.
 */
export function toroidalPoisson(count: number, seed: number): Float32Array {
  const out = new Float32Array(count * 2);
  const rng = new Rng(seed);
  // Start optimistic and relax: guarantees `count` points without an unbounded
  // loop, and the relaxation is imperceptible at these densities.
  let r = 0.85 / Math.sqrt(count);
  let n = 0;
  let tries = 0;
  while (n < count) {
    const x = rng.next();
    const y = rng.next();
    let ok = true;
    for (let i = 0; i < n; i++) {
      let dx = Math.abs(out[i * 2] - x);
      let dy = Math.abs(out[i * 2 + 1] - y);
      if (dx > 0.5) dx = 1 - dx;
      if (dy > 0.5) dy = 1 - dy;
      if (dx * dx + dy * dy < r * r) {
        ok = false;
        break;
      }
    }
    if (ok) {
      out[n * 2] = x;
      out[n * 2 + 1] = y;
      n++;
      tries = 0;
    } else if (++tries > 48) {
      r *= 0.93;
      tries = 0;
    }
  }
  return out;
}
