/**
 * Tiny deterministic noise kit. Local to the player subsystem so camera shake
 * and avatar texture synthesis stay self-contained and reproducible frame to
 * frame (screenshot tooling depends on determinism).
 */

const UINT_SCALE = 1 / 4294967296;

export function hash11(n: number): number {
  let x = Math.imul(n | 0, 0x27d4eb2d) ^ 0x9e3779b9;
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) * UINT_SCALE;
}

export function hash21(x: number, y: number): number {
  return hash11((x | 0) * 374761393 + (y | 0) * 668265263);
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in [-1,1]. */
export function noise1(x: number): number {
  const i = Math.floor(x);
  const f = fade(x - i);
  const a = hash11(i);
  const b = hash11(i + 1);
  return (a + (b - a) * f) * 2 - 1;
}

/** Value noise in [0,1]. */
export function noise2(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const a = hash21(ix, iy);
  const b = hash21(ix + 1, iy);
  const c = hash21(ix, iy + 1);
  const d = hash21(ix + 1, iy + 1);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

/** Tiling value noise — the avatar atlas must wrap in u without a visible seam. */
export function noise2Tiled(x: number, y: number, px: number, py: number): number {
  const wrap = (v: number, p: number) => ((v % p) + p) % p;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const x0 = wrap(ix, px);
  const x1 = wrap(ix + 1, px);
  const y0 = wrap(iy, py);
  const y1 = wrap(iy + 1, py);
  const a = hash21(x0, y0);
  const b = hash21(x1, y0);
  const c = hash21(x0, y1);
  const d = hash21(x1, y1);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

export function fbm2(x: number, y: number, octaves: number, px = 0, py = 0): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * (px > 0 ? noise2Tiled(x * fx, y * fx, px * fx, py * fx) : noise2(x * fx, y * fx));
    norm += amp;
    amp *= 0.5;
    fx *= 2;
  }
  return sum / norm;
}

export function fbm1(x: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise1(x * f);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/** Distance to the nearest of a jittered lattice of points — chitin plates. */
export function worley2(x: number, y: number, px: number, py: number): { f1: number; f2: number } {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = ix + ox;
      const cy = iy + oy;
      const wx = px > 0 ? ((cx % px) + px) % px : cx;
      const wy = py > 0 ? ((cy % py) + py) % py : cy;
      const jx = cx + hash21(wx, wy);
      const jy = cy + hash21(wx + 7919, wy - 104729);
      const dx = jx - x;
      const dy = jy - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return { f1, f2 };
}
