/**
 * Deterministic gradient noise. Everything the terrain is made of derives from
 * this, so it must be seeded and reproducible: the CPU heightfield and the CPU
 * splat classifier have to agree bit-for-bit with what was baked into the GPU
 * textures, and a Math.random() anywhere in the chain would break that.
 */

const PERM = new Uint8Array(512);

/** Gradient set: 8 directions, cheap to index with a 3-bit hash. */
const GRAD = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1]);

export function seedNoise(seed: number): void {
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

seedNoise(0x5ed1f1);

/** Cheap seeded scalar hash, for feature placement (vents, foyada angles). */
export function hash1(n: number): number {
  let t = (n * 0x9e3779b1) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

/** Classic Perlin, ~[-1,1] after the 1.4 normalisation. */
export function perlin2(x: number, y: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const xf = x - fx;
  const yf = y - fy;
  const xi = fx & 255;
  const yi = fy & 255;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);

  const a = PERM[xi] + yi;
  const b = PERM[xi + 1] + yi;
  const g00 = (PERM[a] & 7) << 1;
  const g01 = (PERM[a + 1] & 7) << 1;
  const g10 = (PERM[b] & 7) << 1;
  const g11 = (PERM[b + 1] & 7) << 1;

  const n00 = GRAD[g00] * xf + GRAD[g00 + 1] * yf;
  const n10 = GRAD[g10] * (xf - 1) + GRAD[g10 + 1] * yf;
  const n01 = GRAD[g01] * xf + GRAD[g01 + 1] * (yf - 1);
  const n11 = GRAD[g11] * (xf - 1) + GRAD[g11 + 1] * (yf - 1);

  const x1 = n00 + u * (n10 - n00);
  const x2 = n01 + u * (n11 - n01);
  return (x1 + v * (x2 - x1)) * 1.4;
}

/**
 * Per-octave band-limit gate.
 *
 * `fMax` is the noise-space frequency at which an octave is fully gone; the
 * fade occupies the octave below it. Callers derive fMax from the shortest
 * wavelength the *sample grid* they are baking into can carry, so no octave
 * ever lands near Nyquist. This is the single most important knob in the whole
 * terrain: gradient noise is identically zero on its own integer lattice, so an
 * octave whose period approaches the sample spacing does not merely alias, it
 * prints a regular lattice of bumps into the geometry.
 *
 * The fade is a full octave wide rather than a hard cut so that the amplitude
 * spectrum rolls off smoothly; a brick-wall cut rings.
 */
function bandGate(f: number, fMax: number): number {
  if (f * 2 <= fMax) return 1;
  if (f >= fMax) return 0;
  const t = (fMax - f) / (0.5 * fMax);
  return t * t * (3 - 2 * t);
}

/**
 * Per-octave lattice decorrelation.
 *
 * Gradient noise is not isotropic: `perlin2` is built on the integer lattice and
 * its extrema, its zero contours and its interpolation creases all line up with
 * the x and y axes. Summing octaves that share that orientation does not average
 * the anisotropy away — every octave reinforces the same two axes, and the sum
 * carries a residual orthogonal grid whose period is the *coarsest* octave. That
 * is the corrugated-cardboard / woven-basketry read: an FFT of the result shows
 * dominant peaks on the axes at multiples of the base cell rather than a flat
 * spectral floor.
 *
 * Rotating each octave by a fixed angle whose ratio to pi/2 is irrational means
 * no two octaves ever share an axis and the ensemble is isotropic to within the
 * octave count. 0.5171 rad is ~29.6 degrees, so nine octaves sweep 266 degrees
 * without any pair landing within 10 degrees of each other or of the axes.
 *
 * The offset matters as much as the angle: rotation alone leaves every octave
 * with a lattice *node* at the origin, and the terrain has features near the
 * origin. Translating by an irrational vector per octave breaks that too.
 */
const ROT_C = Math.cos(0.5171);
const ROT_S = Math.sin(0.5171);
const OFF_X = 7.318;
const OFF_Y = 3.947;

export function fbm2(x: number, y: number, octaves: number, lac = 2.02, gain = 0.5, fMax = Infinity): number {
  let a = 1;
  let f = 1;
  let sum = 0;
  let norm = 0;
  let px = x;
  let py = y;
  for (let i = 0; i < octaves; i++) {
    const w = bandGate(f, fMax);
    // norm counts the octave whether or not it survives: dropping high octaves
    // must lower the amplitude, not renormalise the surviving ones back up.
    norm += a;
    if (w <= 0) {
      // f only rises, so the gate can never reopen. Finish the normaliser as a
      // geometric series and stop paying for octaves that contribute nothing —
      // this is what makes a high octave count affordable.
      for (let k = i + 1; k < octaves; k++) {
        a *= gain;
        norm += a;
      }
      break;
    }
    sum += a * w * perlin2(px * f, py * f);
    a *= gain;
    f *= lac;
    const nx = px * ROT_C - py * ROT_S + OFF_X;
    py = px * ROT_S + py * ROT_C + OFF_Y;
    px = nx;
  }
  return sum / norm;
}

/**
 * Rounded absolute value. `1 - |n|` creates a derivative discontinuity along
 * every zero contour of n, which is broadband by construction and therefore
 * prints a one-sample crease into any grid it is baked onto. Rounding the fold
 * over a width k keeps the crest shape and bounds the curvature.
 */
export function softAbs(v: number, k: number): number {
  return Math.sqrt(v * v + k * k) - k;
}

/**
 * Ridged multifractal. The per-octave weight term is what makes ridges sharpen
 * where the previous octave was already high — that self-similar crest network
 * is what gives Red Mountain its radial spines rather than lumpy blobs.
 */
export function ridged2(
  x: number,
  y: number,
  octaves: number,
  lac = 2.07,
  gain = 0.5,
  sharp = 1.0,
  fMax = Infinity,
): number {
  let a = 1;
  let f = 1;
  let sum = 0;
  let norm = 0;
  let weight = 1;
  let px = x;
  let py = y;
  for (let i = 0; i < octaves; i++) {
    // The 1-|n| fold doubles the feature rate, so an octave of ridged noise
    // occupies twice the band a plain fBm octave does. Gate on 2f or every
    // ridged call limits itself to half the resolution it actually needs.
    const w = bandGate(f * 2, fMax);
    if (w <= 0) {
      for (let k = i; k < octaves; k++) {
        norm += a;
        a *= gain;
      }
      break;
    }
    // The fold is what makes a ridge, and it is also a derivative
    // discontinuity: `1 - |p|` is infinitely sharp, so every ridged octave
    // radiates energy across the *whole* spectrum, not just its own band. Those
    // creases are what the band gate cannot catch — it scales an octave, it
    // cannot smooth one — and on the grid they land as one-sample ridges.
    //
    // Rounding the fold in proportion to how close the octave sits to the band
    // edge keeps the big crests as knife-edged as they ever were while the
    // small ones, the ones the grid cannot hold, arrive already blunt.
    const k = fMax === Infinity ? 0 : 0.42 * Math.min(1, (2 * f) / fMax);
    const raw = perlin2(px * f, py * f);
    let n = 1 - (k > 0 ? softAbs(raw, k) : Math.abs(raw));
    n *= n;
    n *= weight;
    // The weight chain is deliberately left ungated: it is the multifractal
    // coupling that sharpens crests, and breaking it changes the *shape* of the
    // surviving octaves rather than just their amplitude.
    weight = Math.min(1, n * 2.4 * sharp);
    norm += a;
    if (w > 0) sum += a * w * n;
    a *= gain;
    f *= lac;
    // Same decorrelation as fbm2, and it matters more here: the `1 - |n|` fold
    // turns every zero contour of the octave into a crest, and the zero contours
    // of axis-aligned gradient noise are themselves biased onto the axes. Stacked
    // unrotated, ridged octaves build an orthogonal mesh of creases — the exact
    // basketry read the review measured. See the constants above.
    const nx = px * ROT_C - py * ROT_S + OFF_X;
    py = px * ROT_S + py * ROT_C + OFF_Y;
    px = nx;
  }
  return sum / norm;
}

/** Domain-warp scratch: avoids allocating a vector per sample in hot loops. */
export let warpX = 0;
export let warpY = 0;

export function domainWarp(x: number, y: number, freq: number, amp: number, octaves = 3): void {
  const qx = fbm2(x * freq, y * freq, octaves);
  const qy = fbm2(x * freq + 5.2, y * freq + 1.3, octaves);
  const rx = fbm2(x * freq + 4.0 * qx + 1.7, y * freq + 4.0 * qy + 9.2, octaves);
  const ry = fbm2(x * freq + 4.0 * qx + 8.3, y * freq + 4.0 * qy + 2.8, octaves);
  warpX = x + amp * rx;
  warpY = y + amp * ry;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
