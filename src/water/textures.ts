import * as THREE from 'three';

/**
 * Procedural, tileable data textures for the sea surface. Everything here is
 * generated from integer hashes with an explicit lattice period so the result
 * wraps exactly; the shader then breaks the visible repeat with domain warping
 * and three differently-rotated sampling scales.
 */

function hash2i(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function wrap(v: number, p: number): number {
  return ((v % p) + p) % p;
}

/** Value noise on a lattice of the given integer period. */
function pnoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const x0 = wrap(xi, period);
  const x1 = wrap(xi + 1, period);
  const y0 = wrap(yi, period);
  const y1 = wrap(yi + 1, period);
  const a = hash2i(x0, y0, seed);
  const b = hash2i(x1, y0, seed);
  const c = hash2i(x0, y1, seed);
  const d = hash2i(x1, y1, seed);
  const ab = a + (b - a) * u;
  const cd = c + (d - c) * u;
  return ab + (cd - ab) * v;
}

/** Periodic Worley F1, used for bubble cells in the foam sheet. */
function pworley(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let best = 4;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = xi + ox;
      const cy = yi + oy;
      const px = cx + hash2i(wrap(cx, period), wrap(cy, period), seed);
      const py = cy + hash2i(wrap(cx, period), wrap(cy, period), seed ^ 0x9e37);
      const dx = px - x;
      const dy = py - y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

function fbm(x: number, y: number, basePeriod: number, octaves: number, seed: number, lacunarity = 2): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  let p = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * pnoise(x * f, y * f, p, seed + o * 131);
    norm += amp;
    amp *= 0.5;
    f *= lacunarity;
    p *= lacunarity;
  }
  return sum / norm;
}

async function yieldFrame(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}

export interface WaterTextures {
  /** RGB = tangent-space normal, A = height. Data map: never sRGB. */
  detail: THREE.DataTexture;
  /** R = bubble cells, G = fine speckle, B = clump mask, A = erosion threshold. */
  foam: THREE.DataTexture;
  dispose(): void;
}

const DETAIL_SIZE = 512;
/** Exported: passes that must select a mip by hand need the texel count. */
export const FOAM_SIZE = 512;

export async function synthWaterTextures(anisotropy: number): Promise<WaterTextures> {
  const detail = await buildDetail(anisotropy);
  const foam = await buildFoam(anisotropy);
  return {
    detail,
    foam,
    dispose() {
      detail.dispose();
      foam.dispose();
    },
  };
}

async function buildDetail(anisotropy: number): Promise<THREE.DataTexture> {
  const N = DETAIL_SIZE;
  const basePeriod = 8;
  const height = new Float32Array(N * N);

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x / N) * basePeriod;
      const v = (y / N) * basePeriod;
      // Ridged low band gives the long capillary lines that run across chop;
      // the smooth high band supplies the sub-centimetre grain.
      const ridged = 1 - Math.abs(fbm(u, v, basePeriod, 3, 11) * 2 - 1);
      const grain = fbm(u * 2.7, v * 2.7, basePeriod * 3, 4, 907);
      height[y * N + x] = ridged * 0.62 + grain * 0.38;
    }
    if ((y & 63) === 0) await yieldFrame();
  }

  const data = new Uint8Array(N * N * 4);
  const STRENGTH = 2.6;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const l = height[y * N + ((x - 1 + N) % N)];
      const r = height[y * N + ((x + 1) % N)];
      const d = height[((y - 1 + N) % N) * N + x];
      const t = height[((y + 1) % N) * N + x];
      let nx = (l - r) * STRENGTH;
      let ny = (d - t) * STRENGTH;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      nx *= inv;
      ny *= inv;
      const i = (y * N + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(inv * 255);
      data[i + 3] = Math.round(Math.min(1, Math.max(0, height[y * N + x])) * 255);
    }
  }

  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

async function buildFoam(anisotropy: number): Promise<THREE.DataTexture> {
  const N = FOAM_SIZE;
  const data = new Uint8Array(N * N * 4);
  const cellPeriod = 24;
  const clumpPeriod = 4;

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x / N) * cellPeriod;
      const v = (y / N) * cellPeriod;

      // Warping the Worley lattice turns regular cells into irregular bubbles.
      const wx = fbm(u * 0.4, v * 0.4, cellPeriod * 0.4, 3, 3301) - 0.5;
      const wy = fbm(u * 0.4 + 17, v * 0.4 - 9, cellPeriod * 0.4, 3, 5501) - 0.5;
      const f1 = pworley(u + wx * 1.4, v + wy * 1.4, cellPeriod, 71);
      const bubbles = Math.min(1, Math.max(0, 1 - f1 * 1.35));

      const speckle = fbm(u * 3.1, v * 3.1, cellPeriod * 3, 4, 1607);
      const clump = fbm((x / N) * clumpPeriod, (y / N) * clumpPeriod, clumpPeriod, 4, 233);
      // Erosion threshold: dissolving foam by comparing coverage against this
      // gives ragged, physically plausible edges instead of a soft alpha ramp.
      const thresh = clump * 0.65 + speckle * 0.35;

      const i = (y * N + x) * 4;
      data[i] = Math.round(bubbles * 255);
      data[i + 1] = Math.round(speckle * 255);
      data[i + 2] = Math.round(clump * 255);
      data[i + 3] = Math.round(Math.min(1, Math.max(0, thresh)) * 255);
    }
    if ((y & 63) === 0) await yieldFrame();
  }

  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
