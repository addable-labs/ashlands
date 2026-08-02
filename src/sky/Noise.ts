import * as THREE from 'three';

/**
 * CPU-side procedural noise used to bake the cloud volume and weather map once
 * at boot. Baking beats evaluating hash noise per raymarch step by a wide
 * margin: a trilinear 3D fetch is one texture op where a 3-octave procedural
 * fbm is ~60 ALU, and the cloud march does thousands of them per frame.
 */

function hash1(n: number): number {
  // Integer avalanche; deterministic across runs so clouds are reproducible.
  let x = n | 0;
  x = (x ^ 61) ^ (x >>> 16);
  x = (x + (x << 3)) | 0;
  x = x ^ (x >>> 4);
  x = Math.imul(x, 0x27d4eb2d);
  x = x ^ (x >>> 15);
  return (x >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Tileable 3D gradient noise with lattice period `p`. */
function perlin3(x: number, y: number, z: number, p: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = fade(xf);
  const v = fade(yf);
  const w = fade(zf);

  const grad = (ix: number, iy: number, iz: number, dx: number, dy: number, dz: number) => {
    const cx = ((ix % p) + p) % p;
    const cy = ((iy % p) + p) % p;
    const cz = ((iz % p) + p) % p;
    const h = Math.floor(hash1(cx + cy * 311 + cz * 96803) * 16) & 15;
    // Perlin's 12 edge-midpoint gradients, with the standard 4 duplicates.
    const gu = h < 8 ? dx : dy;
    const gv = h < 4 ? dy : h === 12 || h === 14 ? dx : dz;
    return ((h & 1) === 0 ? gu : -gu) + ((h & 2) === 0 ? gv : -gv);
  };

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const x00 = lerp(grad(xi, yi, zi, xf, yf, zf), grad(xi + 1, yi, zi, xf - 1, yf, zf), u);
  const x10 = lerp(grad(xi, yi + 1, zi, xf, yf - 1, zf), grad(xi + 1, yi + 1, zi, xf - 1, yf - 1, zf), u);
  const x01 = lerp(grad(xi, yi, zi + 1, xf, yf, zf - 1), grad(xi + 1, yi, zi + 1, xf - 1, yf, zf - 1), u);
  const x11 = lerp(
    grad(xi, yi + 1, zi + 1, xf, yf - 1, zf - 1),
    grad(xi + 1, yi + 1, zi + 1, xf - 1, yf - 1, zf - 1),
    u,
  );
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 0.85;
}

/** Feature-point set for a tileable Worley lattice of `cells` per axis. */
function worleyPoints(cells: number, seed: number): Float32Array {
  const pts = new Float32Array(cells * cells * cells * 3);
  let i = 0;
  for (let z = 0; z < cells; z++) {
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const n = x + y * 57 + z * 3323 + seed * 7919;
        pts[i++] = x + hash1(n * 3 + 1);
        pts[i++] = y + hash1(n * 3 + 2);
        pts[i++] = z + hash1(n * 3 + 3);
      }
    }
  }
  return pts;
}

/** Inverted tileable Worley in [0,1]: 1 at feature points, 0 far from them. */
function worley(
  px: number,
  py: number,
  pz: number,
  cells: number,
  pts: Float32Array,
): number {
  const cx = Math.floor(px);
  const cy = Math.floor(py);
  const cz = Math.floor(pz);
  let best = 1e9;
  for (let dz = -1; dz <= 1; dz++) {
    const wz = ((cz + dz) % cells + cells) % cells;
    const oz = cz + dz - wz;
    for (let dy = -1; dy <= 1; dy++) {
      const wy = ((cy + dy) % cells + cells) % cells;
      const oy = cy + dy - wy;
      for (let dx = -1; dx <= 1; dx++) {
        const wx = ((cx + dx) % cells + cells) % cells;
        const ox = cx + dx - wx;
        const i = (wx + wy * cells + wz * cells * cells) * 3;
        const ex = pts[i] + ox - px;
        const ey = pts[i + 1] + oy - py;
        const ez = pts[i + 2] + oz - pz;
        const d = ex * ex + ey * ey + ez * ez;
        if (d < best) best = d;
      }
    }
  }
  return 1 - Math.min(1, Math.sqrt(best));
}

function worleyFbm(x: number, y: number, z: number, base: number, sets: Float32Array[]): number {
  const a = worley(x * base, y * base, z * base, base, sets[0]);
  const b = worley(x * base * 2, y * base * 2, z * base * 2, base * 2, sets[1]);
  const c = worley(x * base * 4, y * base * 4, z * base * 4, base * 4, sets[2]);
  return a * 0.625 + b * 0.25 + c * 0.125;
}

const SIZE = 64;

/**
 * Cloud volume, Nubis layout:
 *   R = Perlin-Worley base shape, G/B/A = Worley erosion at 2x/4x/8x.
 *
 * 64^3, tiled by the march at 8km, is ~125m per texel on the shape channel.
 * That is deliberately coarse — the march takes a second, 3.3x finer octave of
 * the same channel and then erodes with G/B/A at 9x, so the effective detail is
 * ~12m without paying 128^3 (six seconds of boot) for it. Anything below 64
 * puts the trilinear lattice itself into the cloud silhouette.
 */
export function buildCloudVolume(): THREE.Data3DTexture {
  const n = SIZE;
  const data = new Uint8Array(n * n * n * 4);

  const lowSets = [worleyPoints(3, 1), worleyPoints(6, 2), worleyPoints(12, 3)];
  const midSets = [worleyPoints(6, 11), worleyPoints(12, 12), worleyPoints(24, 13)];
  const hiSets = [worleyPoints(8, 21), worleyPoints(16, 22), worleyPoints(24, 23)];

  let i = 0;
  for (let z = 0; z < n; z++) {
    const fz = z / n;
    for (let y = 0; y < n; y++) {
      const fy = y / n;
      for (let x = 0; x < n; x++) {
        const fx = x / n;

        let p = 0;
        let amp = 0.55;
        let freq = 4;
        for (let o = 0; o < 4; o++) {
          p += perlin3(fx * freq, fy * freq, fz * freq, freq) * amp;
          freq *= 2;
          amp *= 0.5;
        }
        p = p * 0.95 + 0.5;

        const w = worleyFbm(fx, fy, fz, 3, lowSets);
        // Perlin-Worley (Schneider): remapping perlin against the inverted
        // worley fbm keeps the billowy cell structure but fills the gaps, so the
        // channel spans a usable range instead of clipping to zero.
        const pw = Math.min(1, Math.max(0, (p - w + 1) / (2 - w)));

        data[i++] = (pw * 255) | 0;
        data[i++] = (worleyFbm(fx, fy, fz, 6, midSets) * 255) | 0;
        data[i++] = (worleyFbm(fx, fy, fz, 8, hiSets) * 255) | 0;
        data[i++] = (Math.min(1, Math.max(0, p)) * 255) | 0;
      }
    }
  }

  const tex = new THREE.Data3DTexture(data, n, n, n);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Weather map: R = coverage, G = cloud-type (0 stratus .. 1 cumulonimbus),
 * B = a slow large-scale mask that carves storm cells, A = a wispiness field.
 */
export function buildWeatherMap(): THREE.DataTexture {
  const n = 256;
  const data = new Uint8Array(n * n * 4);
  let i = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n;
      const v = y / n;
      // Octave amplitudes decay at 0.73, not 0.5.
      //
      // At 0.5 the base octave carried half the field's entire energy, so
      // coverage over any window smaller than one base cell was effectively a
      // single number — and the sky a camera can see IS smaller than one base
      // cell. The consequence is a vantage lottery: the redmtn frame sat inside
      // a low blob and rendered 45% of itself as empty gradient while the
      // weather state said 'cloudy' and the preset asked for six oktas, and no
      // change to the preset could reach the screen because the map had already
      // decided. A flatter spectrum puts real mid-scale structure (2-6km cells)
      // into every window, so any vantage sees both cloud and gap. Same total
      // amplitude, so the field's range and the preset calibration are unchanged;
      // this redistributes energy across scales and costs nothing at runtime.
      let cov = 0;
      let amp = 0.34;
      let freq = 3;
      for (let o = 0; o < 5; o++) {
        cov += perlin3(u * freq, v * freq, 0.37 * freq, freq) * amp;
        freq *= 2;
        amp *= 0.73;
      }
      cov = cov * 0.7 + 0.5;

      let typ = 0;
      amp = 0.6;
      freq = 2;
      for (let o = 0; o < 3; o++) {
        typ += perlin3(u * freq + 5.1, v * freq + 2.3, 11.7, freq) * amp;
        freq *= 2;
        amp *= 0.5;
      }
      typ = typ * 0.8 + 0.5;

      const cell = perlin3(u * 2 + 31.3, v * 2 + 17.9, 3.1, 2) * 1.4 + 0.5;
      const wisp = perlin3(u * 9 + 3.3, v * 9 + 8.1, 21.5, 9) * 0.9 + 0.5;

      const cl = (t: number) => (Math.min(1, Math.max(0, t)) * 255) | 0;
      data[i++] = cl(cov);
      data[i++] = cl(typ);
      data[i++] = cl(cell);
      data[i++] = cl(wisp);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Soft particulate sprite for ash sheets and precipitation: an anisotropic
 * fbm-modulated gaussian, so a wall of ash never reads as a grid of discs.
 */
export function buildDustSprite(): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  if (!g) throw new Error('sky: 2d context unavailable for dust sprite');
  const img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n - 0.5;
      const v = (y + 0.5) / n - 0.5;
      const r = Math.sqrt(u * u + v * v) * 2;
      let f = 0;
      let amp = 0.55;
      let freq = 3;
      for (let o = 0; o < 5; o++) {
        f += perlin3((x / n) * freq, (y / n) * freq, 4.2, freq) * amp;
        freq *= 2;
        amp *= 0.5;
      }
      const shape = Math.max(0, 1 - r * r);
      const a = Math.min(1, Math.max(0, shape * shape * (0.55 + f * 1.1)));
      const o = (y * n + x) * 4;
      img.data[o] = 255;
      img.data[o + 1] = 255;
      img.data[o + 2] = 255;
      img.data[o + 3] = (a * 255) | 0;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace; // alpha mask, not colour
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** GLSL hash/noise helpers shared by the sky dome and the particle shaders. */
export const NOISE_GLSL = /* glsl */ `
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
vec3 hash33(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
                mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y);
  float b = mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y);
  return mix(a, b, f.z);
}
float fbm3(vec3 p, int oct){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++){
    if (i >= oct) break;
    s += vnoise(p) * a;
    p = p * 2.03 + vec3(17.1, 9.7, 3.3);
    a *= 0.5;
  }
  return s;
}
// Temporally stable dither: screen-space only, so it never strobes.
float igNoise(vec2 px){ return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }
`;
