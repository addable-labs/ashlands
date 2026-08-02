import * as THREE from 'three';
import type { IMaterials } from '../core/contracts';
import { LAYER_MATERIALS, NUM_LAYERS } from './Heightfield';

export interface SurfaceArrays {
  albedo: THREE.DataArrayTexture;
  normal: THREE.DataArrayTexture;
  arm: THREE.DataArrayTexture;
  dispose(): void;
}

const SIZE = 512;
const LAYER_BYTES = SIZE * SIZE * 4;

// ---------------------------------------------------------------- procedural
// Only reached when the material system cannot supply a name. It has to tile,
// so the lattice wraps on a caller-chosen period rather than the 256 baked into
// the shared Perlin.

function ihash(x: number, y: number, s: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(s, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function tileNoise(x: number, y: number, per: number, seed: number): number {
  const X = Math.floor(x);
  const Y = Math.floor(y);
  const fx = x - X;
  const fy = y - Y;
  const x0 = ((X % per) + per) % per;
  const y0 = ((Y % per) + per) % per;
  const x1 = (x0 + 1) % per;
  const y1 = (y0 + 1) % per;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = ihash(x0, y0, seed);
  const b = ihash(x1, y0, seed);
  const c = ihash(x0, y1, seed);
  const d = ihash(x1, y1, seed);
  const t = a + (b - a) * u;
  const w = c + (d - c) * u;
  return (t + (w - t) * v) * 2 - 1;
}

// gain defaults high: a 0.5 rolloff leaves the finest octave at 1.6% of the
// total, which produces a normal map so flat the surface reads as wet clay.
function tileFbm(x: number, y: number, per: number, oct: number, seed: number, ridged: boolean, gain = 0.62): number {
  let amp = 1;
  let f = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    let n = tileNoise(x * f, y * f, per * f, seed + i * 37);
    n = ridged ? 1 - Math.abs(n) : n * 0.5 + 0.5;
    sum += amp * n;
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

interface SurfCfg {
  /** Low and high albedo, sRGB 0..255. */
  lo: [number, number, number];
  hi: [number, number, number];
  /** Accent picked out by a second, sparser mask — lichen, rust, glowing crust. */
  accent: [number, number, number];
  accentAmt: number;
  base: number;
  oct: number;
  ridged: boolean;
  contrast: number;
  rough: [number, number];
  speckle: number;
}

const CFG: Record<string, SurfCfg> = {
  ash: {
    lo: [70, 66, 63], hi: [148, 141, 130], accent: [122, 96, 70], accentAmt: 0.22,
    base: 8, oct: 6, ridged: false, contrast: 0.35, rough: [0.86, 0.98], speckle: 0.06,
  },
  ash_coarse: {
    lo: [52, 48, 47], hi: [126, 118, 110], accent: [90, 74, 62], accentAmt: 0.34,
    base: 12, oct: 6, ridged: false, contrast: 0.62, rough: [0.78, 0.97], speckle: 0.2,
  },
  volcanic_rock: {
    lo: [30, 27, 26], hi: [92, 83, 76], accent: [116, 62, 38], accentAmt: 0.3,
    base: 6, oct: 7, ridged: true, contrast: 1.0, rough: [0.6, 0.9], speckle: 0.12,
  },
  basalt: {
    lo: [19, 19, 21], hi: [66, 64, 66], accent: [58, 70, 74], accentAmt: 0.18,
    base: 5, oct: 7, ridged: true, contrast: 1.15, rough: [0.45, 0.8], speckle: 0.08,
  },
  sand: {
    lo: [96, 82, 62], hi: [176, 156, 122], accent: [128, 98, 66], accentAmt: 0.16,
    base: 10, oct: 5, ridged: false, contrast: 0.3, rough: [0.8, 0.94], speckle: 0.14,
  },
  lichen_grass: {
    lo: [34, 44, 40], hi: [96, 116, 88], accent: [76, 148, 132], accentAmt: 0.42,
    base: 14, oct: 6, ridged: false, contrast: 0.7, rough: [0.82, 0.98], speckle: 0.24,
  },
  mud: {
    lo: [36, 30, 26], hi: [88, 74, 60], accent: [58, 52, 44], accentAmt: 0.3,
    base: 7, oct: 6, ridged: true, contrast: 0.8, rough: [0.35, 0.72], speckle: 0.05,
  },
  lava_crust: {
    lo: [16, 13, 13], hi: [58, 46, 42], accent: [190, 78, 26], accentAmt: 0.5,
    base: 6, oct: 7, ridged: true, contrast: 1.3, rough: [0.62, 0.92], speckle: 0.1,
  },
};

function synth(name: string, alb: Uint8Array, nrm: Uint8Array, arm: Uint8Array, off: number): void {
  const c = CFG[name] ?? CFG.ash;
  const h = new Float32Array(SIZE * SIZE);
  const inv = 1 / SIZE;
  const seed = name.length * 977 + name.charCodeAt(0) * 31;

  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const u = i * inv;
      const v = j * inv;
      let e = tileFbm(u * c.base, v * c.base, c.base, c.oct, seed, c.ridged);
      // A sparse second layer creates plates/clumps rather than uniform fizz.
      const plate = tileFbm(u * (c.base * 0.34) + 3.1, v * (c.base * 0.34) - 1.7, Math.max(2, Math.round(c.base * 0.34)), 3, seed + 811, false);
      e = e * 0.72 + plate * 0.28;
      h[j * SIZE + i] = Math.pow(Math.min(1, Math.max(0, e)), 1 + c.contrast * 0.5);
    }
  }

  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const k = j * SIZE + i;
      const o = off + k * 4;
      const u = i * inv;
      const v = j * inv;
      const hv = h[k];

      const grit = ihash(i, j, seed + 5) - 0.5;
      const acc = Math.max(0, tileFbm(u * c.base * 0.5 + 9.4, v * c.base * 0.5 + 2.2, Math.max(2, Math.round(c.base * 0.5)), 4, seed + 2131, true) - 0.55) * 2.2;

      let r = c.lo[0] + (c.hi[0] - c.lo[0]) * hv;
      let g = c.lo[1] + (c.hi[1] - c.lo[1]) * hv;
      let b = c.lo[2] + (c.hi[2] - c.lo[2]) * hv;
      const a = Math.min(1, acc) * c.accentAmt;
      r += (c.accent[0] - r) * a;
      g += (c.accent[1] - g) * a;
      b += (c.accent[2] - b) * a;
      const sp = grit * c.speckle * 255;
      alb[o] = Math.max(0, Math.min(255, r + sp)) | 0;
      alb[o + 1] = Math.max(0, Math.min(255, g + sp)) | 0;
      alb[o + 2] = Math.max(0, Math.min(255, b + sp)) | 0;
      alb[o + 3] = 255;

      const il = (i + SIZE - 1) % SIZE;
      const ir = (i + 1) % SIZE;
      const jd = (j + SIZE - 1) % SIZE;
      const ju = (j + 1) % SIZE;
      const dx = (h[j * SIZE + il] - h[j * SIZE + ir]) * (55 * c.contrast) + grit * 1.4 * c.speckle;
      const dy = (h[jd * SIZE + i] - h[ju * SIZE + i]) * (55 * c.contrast) + grit * 1.4 * c.speckle;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      nrm[o] = (((dx / len) * 0.5 + 0.5) * 255) | 0;
      nrm[o + 1] = (((dy / len) * 0.5 + 0.5) * 255) | 0;
      nrm[o + 2] = ((1 / len) * 255) | 0;
      nrm[o + 3] = 255;

      // Cavity AO from the local height deficit; cheap but reads correctly.
      const nb = (h[j * SIZE + il] + h[j * SIZE + ir] + h[jd * SIZE + i] + h[ju * SIZE + i]) * 0.25;
      const ao = Math.max(0, Math.min(1, 1 - Math.max(0, nb - hv) * 3.2 * c.contrast));
      arm[o] = (ao * 255) | 0;
      arm[o + 1] = ((c.rough[0] + (c.rough[1] - c.rough[0]) * (1 - hv)) * 255) | 0;
      arm[o + 2] = 0;
      arm[o + 3] = (hv * 255) | 0;
    }
  }
}

// ------------------------------------------------- mip-surviving coarse relief
//
// equalise() below fixes how much contrast each ARM channel has at MIP 0. It
// cannot fix where in the spectrum that contrast sits, and that is the half of
// the problem the measurements in its note actually describe:
//
//   channel      std (mip0)   std (mip2)   std (mip4)
//   arm.A ash      0.078        0.070        0.056
//   arm.R ash      0.059        0.029        0.009
//
// The cavity channel loses 85% of its contrast by mip 4 and the displacement
// channel a third, because both are dominated by texel-scale structure. Mip 4 of
// a 512 set is a 32x32 image, so a feature has to be 16 texels or wider to be
// there at all — and mip 4 is not an exotic case, it is where the 8 m mid band
// is read from at thirty metres and where the 72 m far band is read from at four
// hundred. Every band that MODULATES albedo by one of these channels (the grain
// band, the far band) therefore delivers its stated swing in the near field and
// a fraction of it everywhere else, which is the mechanism behind "the near half
// is a completely untextured matte plane" and behind a 2002 game's 256-texel map
// holding more readable surface information than ours: a 256 map's hand-painted
// blotches are 20-60 texels across and survive to the bottom of its chain.
//
// So put structure at those scales deliberately. The field below has its energy
// at 32 to 128 texels — 0.5 to 2 m of world through the mid tile, 4.5 to 18 m
// through the far one — which is still several pixels at a kilometre and is
// exactly the scale band nothing else in the pipeline occupies. It is added
// AFTER the conditioning pass, so it is genuinely additional rather than traded
// against the texel-scale detail the near field needs — see the note at the
// call site for the measurement that forced that ordering.
//
// It is authored per layer (the seed is the layer's own) and it is
// mean-preserving on every channel it touches, including albedo, where the
// modulation is a single scalar applied to R, G and B alike so the material's
// authored hue is bit-for-bit unchanged. This adds surface information; it
// cannot tint anything.
//
// Evaluated on a 128 grid and bilinearly resampled to 512, with wrap. The
// coarsest feature it carries is 128 texels and the finest 32, so a 128 lattice
// is four samples per cycle at the top of its band and nothing is lost — while
// the noise cost falls by 16x, which keeps this off the boot budget the note
// below equalise is careful about.
const COARSE_N = 128;

interface CoarseField {
  v: Float32Array;
  gx: Float32Array;
  gy: Float32Array;
}

function buildCoarse(seed: number): CoarseField {
  const v = new Float32Array(COARSE_N * COARSE_N);
  const gx = new Float32Array(COARSE_N * COARSE_N);
  const gy = new Float32Array(COARSE_N * COARSE_N);
  // base 4 over the 0..1 tile = 128-texel cells at 512; three octaves take it to
  // 32. Ridged off, gain 0.62 so all three octaves carry real weight.
  for (let j = 0; j < COARSE_N; j++) {
    for (let i = 0; i < COARSE_N; i++) {
      const u = i / COARSE_N;
      const w = j / COARSE_N;
      v[j * COARSE_N + i] = tileFbm(u * 4, w * 4, 4, 3, seed + 6421, false);
    }
  }
  for (let j = 0; j < COARSE_N; j++) {
    for (let i = 0; i < COARSE_N; i++) {
      const il = (i + COARSE_N - 1) % COARSE_N;
      const ir = (i + 1) % COARSE_N;
      const jd = (j + COARSE_N - 1) % COARSE_N;
      const ju = (j + 1) % COARSE_N;
      gx[j * COARSE_N + i] = v[j * COARSE_N + il] - v[j * COARSE_N + ir];
      gy[j * COARSE_N + i] = v[jd * COARSE_N + i] - v[ju * COARSE_N + i];
    }
  }
  return { v, gx, gy };
}

/**
 * Adds the coarse field to one layer's albedo, normal and ARM images.
 *
 * Amplitudes are stated against each channel's own measured spread. Displacement
 * gets 0.55 of field range, which is 0.068 of standard deviation against the
 * 0.078 the channel already had, so a little under half the variance is now
 * mip-surviving; cavity gets 0.42, against a channel whose own spread was 0.059
 * and which loses six sevenths of it by mip 4. Albedo gets a +/-11% luminance
 * swing at one sigma — blotching at half a metre to two metres, which is what a
 * hand-painted ash or scoria map has and a procedural one built from a single
 * fBm does not.
 *
 * The normal takes the field's gradient as well, because relief that only exists
 * in a cavity channel reads as a stain rather than as form: at grazing sun a
 * half-metre swell has to catch light on one side and lose it on the other. The
 * gradient is scaled to keep the same amplitude-over-wavelength the fine detail
 * already has, so this does not change how rough the surface looks, only at what
 * scale it is rough.
 *
 * This runs eight times over 512x512 during boot, in front of a loading screen,
 * so it is written the way the equalise() note asks for rather than the way it
 * reads best: the three fields share one set of bilinear weights (they are three
 * channels of one image sampled at one point), SIZE/COARSE_N is exactly 4 so the
 * lattice index and the fraction are a shift and a mask rather than a floor and a
 * modulo, the row indices are hoisted out of the inner loop, and the byte writes
 * truncate rather than calling Math.round. Measured on the target machine at
 * 121-164 ms for all eight layers — two million texels — against a 57 s boot.
 */
function injectCoarse(alb: Uint8Array, nrm: Uint8Array, arm: Uint8Array, off: number, seed: number): void {
  const f = buildCoarse(seed);
  const v = f.v;
  const gx = f.gx;
  const gy = f.gy;
  const SH = 2; // SIZE / COARSE_N === 4
  for (let j = 0; j < SIZE; j++) {
    const y0 = j >> SH;
    const fy = (j & 3) * 0.25;
    const r0 = y0 * COARSE_N;
    const r1 = ((y0 + 1) % COARSE_N) * COARSE_N;
    for (let i = 0; i < SIZE; i++) {
      const x0 = i >> SH;
      const fx = (i & 3) * 0.25;
      const x1 = (x0 + 1) % COARSE_N;
      const i00 = r0 + x0;
      const i10 = r0 + x1;
      const i01 = r1 + x0;
      const i11 = r1 + x1;

      const pv = v[i00] + (v[i10] - v[i00]) * fx;
      const qv = v[i01] + (v[i11] - v[i01]) * fx;
      const m = pv + (qv - pv) * fy - 0.5;

      const o = off + (j * SIZE + i) * 4;

      // Displacement, cavity, roughness. The conditioning pass has already run,
      // so these are additive and their own floors have to be respected here:
      // cavity keeps a floor of 0.20 (a crevice may go dark, not black) and
      // roughness stays inside the dielectric range.
      const d = arm[o + 3] + m * 140.25;
      arm[o + 3] = d < 4 ? 4 : d > 250 ? 250 : (d + 0.5) | 0;
      const c = arm[o] + m * 107.1;
      arm[o] = c < 51 ? 51 : c > 255 ? 255 : (c + 0.5) | 0;
      // Roughness: a hollow holds fines and shades matte, a swell is scoured.
      const rg = arm[o + 1] - m * 40.8;
      arm[o + 1] = rg < 5 ? 5 : rg > 255 ? 255 : (rg + 0.5) | 0;

      // Albedo, luminance only. One scalar on all three channels, so R:G:B — the
      // material's colour — is untouched by construction.
      const k = 1.0 + m * 0.9;
      const ar = alb[o] * k;
      const ag = alb[o + 1] * k;
      const ab = alb[o + 2] * k;
      alb[o] = ar > 255 ? 255 : (ar + 0.5) | 0;
      alb[o + 1] = ag > 255 ? 255 : (ag + 0.5) | 0;
      alb[o + 2] = ab > 255 ? 255 : (ab + 0.5) | 0;

      // Normal. The stored map is tangent-space with z up; adding a slope to the
      // xy pair and renormalising is the same operation the synth path performs.
      const px = gx[i00] + (gx[i10] - gx[i00]) * fx;
      const qx = gx[i01] + (gx[i11] - gx[i01]) * fx;
      const py = gy[i00] + (gy[i10] - gy[i00]) * fx;
      const qy = gy[i01] + (gy[i11] - gy[i01]) * fx;
      const nx = nrm[o] * (2 / 255) - 1 + (px + (qx - px) * fy) * 2.6;
      const ny = nrm[o + 1] * (2 / 255) - 1 + (py + (qy - py) * fy) * 2.6;
      const nzr = nrm[o + 2] * (2 / 255) - 1;
      const nz = nzr < 0.05 ? 0.05 : nzr;
      const il = 127.499 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nrm[o] = (nx * il + 128.0) | 0;
      nrm[o + 1] = (ny * il + 128.0) | 0;
      nrm[o + 2] = (nz * il + 128.0) | 0;
    }
  }
}

// ------------------------------------------------------------- equalisation
//
// Every band in the terrain shader that has to carry surface information past
// arm's length is a MODULATOR: it multiplies the shaded albedo by some function
// of the ARM map's displacement or cavity channel (see the far band and the
// grain band in TerrainMaterial). A modulator can only deliver as much contrast
// as the channel driving it actually has, and measured off the live arrays the
// channels have almost none:
//
//   channel      mean        std (mip0)   std (mip2)   std (mip4)
//   arm.A ash    0.354       0.078        0.070        0.056
//   arm.R ash    0.899       0.059        0.029        0.009
//   arm.A basalt 0.645       0.130        0.120        0.090
//   arm.R lava   0.899       0.066        0.036        0.012
//
// So `0.66 + 0.74 * h`, which the shader's comments describe as a +/-27% swing,
// is in fact a +/-5% swing on ash, and the cavity term is +/-3% at mip0 falling
// to +/-0.5% by mip4 — i.e. exactly zero everywhere past twenty metres. That is
// the mechanical cause of "the near half is a completely untextured matte
// plane" and "a 2002 game with 256px diffuse maps holds more surface
// information than this": the maps hold the information, the channels that
// broadcast it to the mid and far bands do not.
//
// Two channels are also badly mis-CENTRED, which is a correctness problem
// rather than a contrast one. The displacement channel's per-layer mean runs
// from 0.285 (ash_coarse) to 0.851 (lava_crust), and the height blend in
// sampleTriple compares layers on `a.a + weight * 1.55` over a 0.24 window. A
// 0.57 gap between two layers' means is two and a half windows, so lava_crust
// beats ash_coarse on *every* texel whatever the splat says, until the weights
// differ by 0.37. The blend was not blending on relief; it was blending on a
// per-layer constant.
//
// This pass fixes both, at bake time, for nothing at runtime. It is a linear
// gain around a chosen centre with a soft (tanh) limiter, so the multi-scale
// structure — and therefore the way the channel survives the mip chain — is
// preserved exactly; only its amplitude changes. The limiter matters: a hard
// clamp would flatten the tails into plateaus, which is the one thing that
// would genuinely destroy detail.
//
// `centre < 0` means "keep this layer's own mean" — used for the roughness
// channel, where every layer's mean is a deliberate material property and only
// its spread is wrong.
// Everything below runs 8 x 512 x 512 times per channel during boot, on the
// main thread, in front of a loading screen the player is already looking at.
// Written naively it is twelve million calls to Math.pow and six million to
// Math.tanh, which measured at over a second of added boot and was enough to
// make the end-to-end harness's first physics step land before the player was
// grounded. Both transforms are one-dimensional functions of a bounded input,
// so both are tables: the tanh knee over +/-8 sigma at 1/128 sigma, and the two
// sRGB transfers at byte and 1/4096 resolution. Built once for the whole
// process, not per layer.
const SOFT_KNEE = 2.3;
const KNEE_RANGE = 8;
const KNEE_N = 2048;
const KNEE_LUT = ((): Float32Array => {
  const t = new Float32Array(KNEE_N + 1);
  for (let i = 0; i <= KNEE_N; i++) {
    const x = (i / KNEE_N) * 2 * KNEE_RANGE - KNEE_RANGE;
    t[i] = Math.tanh(x / SOFT_KNEE) * SOFT_KNEE;
  }
  return t;
})();
function softKnee(x: number): number {
  const t = ((x + KNEE_RANGE) / (2 * KNEE_RANGE)) * KNEE_N;
  const i = t <= 0 ? 0 : t >= KNEE_N ? KNEE_N : t | 0;
  return KNEE_LUT[i];
}

function equalise(data: Uint8Array, off: number, ch: number, centre: number, targetSd: number, lo: number, hi: number): void {
  let sum = 0;
  let sum2 = 0;
  for (let q = 0; q < SIZE * SIZE; q++) {
    const v = data[off + q * 4 + ch];
    sum += v;
    sum2 += v * v;
  }
  const n = SIZE * SIZE;
  const mean = sum / n / 255;
  const sd = Math.sqrt(Math.max(0, sum2 / n / 65025 - mean * mean));
  if (sd < 1e-4) return;
  const c = centre < 0 ? mean : centre;
  for (let q = 0; q < n; q++) {
    const o = off + q * 4 + ch;
    const x = (data[o] / 255 - mean) / sd;
    // tanh(x/K)*K is the identity to within 3% out to |x| = 0.8 sigma and
    // saturates at K sigma, so the bulk of the distribution is a pure gain and
    // only the outliers are compressed.
    const y = softKnee(x);
    const v = c + y * targetSd;
    data[o] = Math.max(0, Math.min(255, Math.round(Math.max(lo, Math.min(hi, v)) * 255)));
  }
}

// sRGB transfer, both directions. The albedo array is flagged sRGB and gets a
// hardware decode when the terrain samples it, so the only place its contrast
// means anything is in LINEAR light — which is also the only space in which an
// expansion can be made exactly mean-preserving.
const TO_LIN = ((): Float32Array => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();
// Inverse transfer, tabulated in LINEAR light. 4096 entries over [0,1] puts the
// worst quantisation at the very bottom of the curve, where the encode is
// steepest — and 1/4096 of linear is a fifth of a code value even there, so the
// round trip is exact to the byte.
const TO_SRGB_N = 4096;
const TO_SRGB = ((): Uint8Array => {
  const t = new Uint8Array(TO_SRGB_N + 1);
  for (let i = 0; i <= TO_SRGB_N; i++) {
    const l = i / TO_SRGB_N;
    const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
    t[i] = Math.max(0, Math.min(255, Math.round(c * 255)));
  }
  return t;
})();
function toSrgb(l: number): number {
  const i = l <= 0 ? 0 : l >= 1 ? TO_SRGB_N : Math.round(l * TO_SRGB_N);
  return TO_SRGB[i];
}

/**
 * Expands each layer's albedo contrast about its own mean linear luminance,
 * without moving that mean and without touching hue or chroma.
 *
 * This is a surface-detail operation, not a grade: it is per-layer, it is
 * mean-preserving in linear light to within a rounding error (the residual is
 * divided out at the end), and every channel is scaled by the SAME factor per
 * texel, so the ratio R:G:B — the material's colour — is bit-for-bit what the
 * material library authored. What changes is how far a light texel is from a
 * dark one on the same surface, which is the quantity the review measured as
 * "std 3.5 over 110x100 px" and compared unfavourably with a 2002 256px map.
 *
 * Multiplicative (a power law on luminance) rather than additive: albedo is a
 * reflectance, it is bounded below by zero and its natural variation is
 * proportional, so a gamma about the mean cannot drive a texel negative and
 * keeps the dark end from crushing into a flat black the way an additive
 * expansion of a 0.017-mean basalt would.
 */
function expandAlbedo(alb: Uint8Array, off: number, gain: number): void {
  const n = SIZE * SIZE;
  const lin = new Float32Array(n * 3);
  let ym = 0;
  for (let q = 0; q < n; q++) {
    const o = off + q * 4;
    const r = TO_LIN[alb[o]];
    const g = TO_LIN[alb[o + 1]];
    const b = TO_LIN[alb[o + 2]];
    lin[q * 3] = r;
    lin[q * 3 + 1] = g;
    lin[q * 3 + 2] = b;
    ym += 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  ym /= n;
  if (ym < 1e-5) return;
  // Pass one: the power law. Pass two: divide out whatever it did to the mean.
  const scale = new Float32Array(n);
  let ym2 = 0;
  for (let q = 0; q < n; q++) {
    const y = 0.2126 * lin[q * 3] + 0.7152 * lin[q * 3 + 1] + 0.0722 * lin[q * 3 + 2];
    const s = y > 1e-6 ? (ym * Math.pow(y / ym, gain)) / y : 1;
    scale[q] = s;
    ym2 += y * s;
  }
  const norm = ym / (ym2 / n);
  for (let q = 0; q < n; q++) {
    const o = off + q * 4;
    const s = scale[q] * norm;
    alb[o] = toSrgb(Math.min(1, lin[q * 3] * s));
    alb[o + 1] = toSrgb(Math.min(1, lin[q * 3 + 1] * s));
    alb[o + 2] = toSrgb(Math.min(1, lin[q * 3 + 2] * s));
  }
}

// -------------------------------------------------------------------- blit

const BLIT_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BLIT_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uDecode;
varying vec2 vUv;
vec3 srgbToLin(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
void main() {
  vec4 t = texture2D(uMap, vUv);
  gl_FragColor = vec4(mix(t.rgb, srgbToLin(t.rgb), uDecode), t.a);
  #include <colorspace_fragment>
}
`;

function makeArray(data: Uint8Array, colorSpace: THREE.ColorSpace, aniso: number): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(data, SIZE, SIZE, NUM_LAYERS);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.colorSpace = colorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/**
 * Collapses the eight terrain surfaces into three sampler2DArrays. Binding
 * 8x3 = 24 individual samplers would blow past MAX_TEXTURE_IMAGE_UNITS and
 * would forbid the per-pixel top-K layer selection the splat depends on, so
 * the sets are rasterised through a render target and read back into one
 * contiguous array image.
 */
export async function buildSurfaceArrays(
  renderer: THREE.WebGLRenderer,
  materials: IMaterials | undefined,
): Promise<SurfaceArrays> {
  const albData = new Uint8Array(LAYER_BYTES * NUM_LAYERS);
  const nrmData = new Uint8Array(LAYER_BYTES * NUM_LAYERS);
  const armData = new Uint8Array(LAYER_BYTES * NUM_LAYERS);

  const quad = new THREE.BufferGeometry();
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  quad.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const blit = new THREE.ShaderMaterial({
    vertexShader: BLIT_VERT,
    fragmentShader: BLIT_FRAG,
    uniforms: { uMap: { value: null }, uDecode: { value: 0 } },
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(quad, blit);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const cam = new THREE.Camera();

  const rt = new THREE.WebGLRenderTarget(SIZE, SIZE, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });

  const prevTarget = renderer.getRenderTarget();

  const capture = async (src: THREE.Texture, isAlbedo: boolean, dst: Uint8Array, off: number): Promise<void> => {
    // Round-tripping through the source's own colour space makes the copy
    // byte-exact; only albedo is forced to sRGB so the array can be flagged
    // sRGB and get hardware decode when the terrain samples it.
    rt.texture.colorSpace = isAlbedo ? THREE.SRGBColorSpace : src.colorSpace;
    blit.uniforms.uMap.value = src;
    blit.uniforms.uDecode.value = isAlbedo && src.colorSpace !== THREE.SRGBColorSpace ? 1 : 0;
    blit.needsUpdate = true;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    await renderer.readRenderTargetPixelsAsync(rt, 0, 0, SIZE, SIZE, dst.subarray(off, off + LAYER_BYTES));
  };

  try {
    for (let layer = 0; layer < NUM_LAYERS; layer++) {
      const name = LAYER_MATERIALS[layer];
      const off = layer * LAYER_BYTES;
      let set: ReturnType<IMaterials['get']> | null = null;
      try {
        set = materials ? materials.get(name) : null;
      } catch {
        set = null;
      }
      if (set) {
        // A readback failure on one layer must not cost the whole terrain: fall
        // back to the procedural surface for that layer and carry on.
        try {
          await capture(set.albedo, true, albData, off);
          await capture(set.normal, false, nrmData, off);
          await capture(set.arm, false, armData, off);
        } catch {
          synth(name, albData, nrmData, armData, off);
        }
      } else {
        synth(name, albData, nrmData, armData, off);
      }
    }
  } finally {
    // These are GPU-side and are useless past this point whether or not the
    // capture loop threw; leaking a render target here leaks 1 MB and an FBO.
    renderer.setRenderTarget(prevTarget);
    rt.dispose();
    blit.dispose();
    quad.dispose();
  }

  // Channel conditioning, per layer. See the long note on equalise() for the
  // measurements this is answering.
  //
  //  - Displacement (A) is centred on 0.5 for EVERY layer, because the height
  //    blend compares layers against each other and a per-layer mean offset is
  //    a thumb on that scale. 0.17 of spread over a 0.24 window means relief
  //    genuinely decides which material owns a pit, which is what the blend is
  //    for, and it is also the channel the far and grain bands modulate albedo
  //    with — at 0.17 they can finally deliver a visible swing.
  //  - Cavity (R) keeps a mean near where the maps already put it (0.88, against
  //    a measured 0.85-0.93) so nothing about the scene's ambient level moves,
  //    and gets 0.13 of spread against a measured 0.06. The floor at 0.30 is
  //    what lets a crevice actually go dark instead of asymptoting at 0.8.
  //  - Roughness (G) keeps each layer's OWN mean — a material's average
  //    roughness is authored, not incidental — and only has its spread doubled,
  //    so wet, dusty and glassy patches of the same surface stop shading
  //    identically.
  for (let layer = 0; layer < NUM_LAYERS; layer++) {
    const off = layer * LAYER_BYTES;
    equalise(armData, off, 3, 0.5, 0.17, 0.02, 0.98);
    equalise(armData, off, 0, 0.88, 0.13, 0.30, 1.0);
    equalise(armData, off, 1, -1, 0.09, 0.02, 1.0);
    // 1.55 raises ash's albedo std from 15.4 to ~23 code values at mip 0 and,
    // because the gain is scale-free, by the same factor at every mip — 8.1 to
    // ~12 at mip 4, which is the level the mid band is read from at thirty
    // metres. Not pushed further: past about 1.7 the darkest texels of basalt
    // start to crush, and a crushed tail is flat.
    expandAlbedo(albData, off, 1.55);
    // AFTER the conditioning, not before, and the ordering is the whole point.
    //
    // equalise() normalises a channel's standard deviation to a fixed target, so
    // anything added ahead of it is not added at all — it is traded. Injected
    // first, the coarse field's 0.068 of spread went into the same 0.17 budget
    // as the map's own texel-scale detail and the gain fell from 2.18 to 1.65,
    // i.e. the near field lost a quarter of its fine contrast to buy the
    // midground its coarse contrast. Measured on the dawn vantage's foreground:
    // band-limited relative contrast fell from 4.5% to 3.3% at 5-9 px and from
    // 6.1% to 4.2% at 9-17 px. That is rule 7 being paid for with rule 4's
    // money, and both are required.
    //
    // Added afterwards it is additive: the fine detail keeps exactly the spread
    // the conditioning gave it and the mip-surviving band is new information on
    // top. The cost is that this channel's total spread is no longer exactly the
    // equalise target — it is the quadrature sum — which is correct, because the
    // target was chosen for what survives to mip 0 and this is about what
    // survives to mip 4.
    injectCoarse(albData, nrmData, armData, off, LAYER_MATERIALS[layer].length * 977 + LAYER_MATERIALS[layer].charCodeAt(0) * 31);
  }

  // 16, not 8. The terrain shader budgets its own ratio per pixel (see
  // limitAniso), so this is the ceiling that budget can spend against, and at 8
  // it was the binding constraint on every grazing ground pixel inside forty
  // metres — the hardware fell back to line-integrating along the major axis and
  // drew the near plane as radial streaks. Beyond the near band the shader's own
  // limiter takes the ratio back down to 2, so raising the cap costs taps only
  // where the artefact was.
  const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const albedo = makeArray(albData, THREE.SRGBColorSpace, aniso);
  const normal = makeArray(nrmData, THREE.NoColorSpace, aniso);
  const arm = makeArray(armData, THREE.NoColorSpace, aniso);

  return {
    albedo,
    normal,
    arm,
    dispose() {
      albedo.dispose();
      normal.dispose();
      arm.dispose();
    },
  };
}
