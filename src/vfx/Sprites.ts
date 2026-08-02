import * as THREE from 'three';

/**
 * Procedural sprite synthesis for the VFX subsystem.
 *
 * Every particle sprite is a full material, not a white blob: RGB carries a
 * tangent-space normal and A carries coverage. That is what lets an ash mote be
 * *lit* — an unlit alpha disc is the classic amateur particle tell, and it is
 * immediately obvious at dawn when everything else in frame has a light
 * direction and the particles do not.
 *
 * Four tiles in one 2x2 atlas so the whole subsystem binds a single texture:
 *
 *   (0,0) FLAKE  angular ash / soot flake, crinkled relief
 *   (1,0) SPARK  hot ember core with a radial falloff
 *   (0,1) PUFF   soft billow for dust, fog and smoke, strong relief
 *   (1,1) SHARD  hexagonal frost crystal, faceted relief
 */

export const TILE_FLAKE = 0;
export const TILE_SPARK = 1;
export const TILE_PUFF = 2;
export const TILE_SHARD = 3;

/** Atlas tile origin in UV, for `TILE_*`. */
export function tileUV(tile: number): THREE.Vector2 {
  return new THREE.Vector2((tile & 1) * 0.5, (tile >> 1) * 0.5);
}

const TILE = 128;
const ATLAS = TILE * 2;

/* ------------------------------------------------------------------ noise */

function hash2(x: number, y: number, seed: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return h - Math.floor(h);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Tileable value noise on a period-`per` lattice, so a sprite has no seam. */
function vnoise(x: number, y: number, per: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const w = (a: number) => ((a % per) + per) % per;
  const a = hash2(w(xi), w(yi), seed);
  const b = hash2(w(xi + 1), w(yi), seed);
  const c = hash2(w(xi), w(yi + 1), seed);
  const d = hash2(w(xi + 1), w(yi + 1), seed);
  return a * (1 - xf) * (1 - yf) + b * xf * (1 - yf) + c * (1 - xf) * yf + d * xf * yf;
}

function fbm(x: number, y: number, per: number, oct: number, seed: number): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(x * f, y * f, per * f, seed + i * 13.7);
    f *= 2;
    amp *= 0.5;
  }
  return s;
}

/* ------------------------------------------------------------ tile shapes */

/** Signed distance to a regular n-gon of radius 1, rotated by `rot`. */
function ngon(px: number, py: number, n: number, rot: number): number {
  const a = Math.atan2(py, px) + rot;
  const r = Math.hypot(px, py);
  const seg = (Math.PI * 2) / n;
  const k = Math.cos(seg * 0.5) / Math.cos(((a % seg) + seg) % seg - seg * 0.5);
  return r * k;
}

/**
 * Fraction of the tile radius the drawn shape is allowed to occupy. Everything
 * outside `WINDOW` is forced to zero coverage, and the shape itself is
 * evaluated on coordinates scaled by 1/FIT so it comfortably clears that edge.
 *
 * This is not cosmetic. A sprite whose alpha is still non-zero where the quad
 * ends draws its own QUAD as the silhouette, and a mip-reduced tile is nearly
 * uniform alpha, so at 3-8 px on screen every particle in the game read as a
 * hard-edged rectangle — the compression-block look. Guaranteeing a smooth
 * ramp to zero strictly inside the inscribed circle is what makes a small
 * sprite read as a soft mote at every mip level, and it also means the outer
 * ring of texels is transparent, so bilinear bleed across the atlas tile
 * boundary at high mips pulls in nothing.
 *
 * The baked window is now the BACKSTOP rather than the mechanism: the shader's
 * `vfxSpriteWindow` carries a smooth falloff over the whole disc, so this one
 * only has to guarantee the outermost texels are empty. It is therefore kept
 * narrow and the shapes are drawn correspondingly larger (FIT), or every
 * particle would be attenuated twice and lose half its apparent size.
 */
const FIT = 0.88;
const WINDOW_IN = 0.86;
const WINDOW_OUT = 1.0;

/**
 * Height field per tile in [0,1] plus a coverage mask. The normal is derived
 * from the height by central differences, so relief and silhouette agree.
 */
function tileHeight(tile: number, u: number, v: number): { h: number; a: number } {
  // Radius in quad units: 1.0 is the inscribed circle, 1.414 the corners.
  const qr = Math.hypot(u * 2 - 1, v * 2 - 1);
  const win = 1 - smoothstep01(WINDOW_IN, WINDOW_OUT, qr);
  if (win <= 0) return { h: 0, a: 0 };
  const s = tileShape(tile, u, v);
  return { h: s.h * win, a: s.a * win };
}

function tileShape(tile: number, u: number, v: number): { h: number; a: number } {
  const px = (u * 2 - 1) / FIT;
  const py = (v * 2 - 1) / FIT;
  const r = Math.hypot(px, py);

  if (tile === TILE_FLAKE) {
    // A torn sheet, not a polygon. An earlier version modulated a hexagon and
    // the hexagon read straight through at 8-10 px on screen — a regular
    // silhouette repeated four thousand times is instantly legible as one
    // sprite. The radius is therefore governed almost entirely by low-frequency
    // noise and then bitten into by a higher octave.
    const n1 = fbm(u * 3.1, v * 3.1, 3, 4, 3.1);
    const n2 = fbm(u * 7.0 + 3.0, v * 7.0 + 1.0, 7, 3, 11.3);
    const edge = r * (0.62 + 0.95 * n1) + 0.30 * (n2 - 0.5);
    const a = Math.max(0, 1 - smoothstep01(0.40, 0.88, edge));
    const crinkle = fbm(u * 11.0, v * 11.0, 11, 3, 8.4);
    return { h: a * (0.35 + 0.65 * crinkle), a };
  }

  if (tile === TILE_SPARK) {
    // Tight, but not a POINT. At exp(-26 r^2) the half-coverage radius was 0.16
    // of the tile, so an ember drawn at the 5 px minimum footprint put a ~1.4 px
    // fully-opaque core on screen with nothing around it — an unlit hard dot
    // that reads as a dead pixel, not as a spark, and that the bloom downsample
    // then smears into a fixed-size blob. Widening the core to roughly half the
    // sprite keeps the shape hot in the middle while giving the edge somewhere
    // to ramp; the bloom chain still owns the glow, not the alpha.
    const core = Math.exp(-r * r * 9.0);
    const halo = Math.exp(-r * r * 2.6) * 0.22;
    const a = Math.min(1, core + halo);
    return { h: core, a };
  }

  if (tile === TILE_PUFF) {
    // Billow. The radius warp has to be strong or a field of these reads as a
    // field of identical circles — bokeh, not smoke.
    const n = fbm(u * 2.6, v * 2.6, 3, 4, 17.9);
    const n2 = fbm(u * 6.2 + 5.0, v * 6.2 + 2.0, 6, 3, 41.7);
    const rr = r * (0.58 + 0.95 * n) + 0.16 * (n2 - 0.5);
    const a = Math.max(0, 1 - smoothstep01(0.30, 0.92, rr));
    const lump = fbm(u * 6.5, v * 6.5, 7, 4, 31.2);
    return { h: a * (0.25 + 0.75 * lump), a };
  }

  // TILE_SHARD: a hexagonal ice crystal with faceted arms.
  const hex = ngon(px, py, 6, 0.0);
  const arms = Math.abs(Math.cos(Math.atan2(py, px) * 3.0));
  const body = 1 - smoothstep01(0.30, 0.42, hex);
  const spikes = (1 - smoothstep01(0.25 + 0.62 * arms, 0.95, r)) * arms;
  const a = Math.min(1, body + spikes * 0.85);
  const facet = 0.5 + 0.5 * Math.cos(hex * 26.0);
  return { h: a * (0.45 + 0.55 * facet), a };
}

function smoothstep01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Build the 2x2 sprite atlas. 256x256 RGBA8, ~256 KB, synthesised once at init.
 */
export function buildParticleAtlas(): THREE.DataTexture {
  const data = new Uint8Array(ATLAS * ATLAS * 4);
  // Relief strength per tile: flat sparks, deep billows.
  const relief = [2.2, 0.4, 3.4, 2.6];

  for (let t = 0; t < 4; t++) {
    const ox = (t & 1) * TILE;
    const oy = (t >> 1) * TILE;
    const H = new Float32Array(TILE * TILE);
    const A = new Float32Array(TILE * TILE);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const s = tileHeight(t, (x + 0.5) / TILE, (y + 0.5) / TILE);
        H[y * TILE + x] = s.h;
        A[y * TILE + x] = s.a;
      }
    }
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const xm = (x - 1 + TILE) % TILE;
        const xp = (x + 1) % TILE;
        const ym = (y - 1 + TILE) % TILE;
        const yp = (y + 1) % TILE;
        const dx = (H[y * TILE + xp] - H[y * TILE + xm]) * relief[t];
        const dy = (H[yp * TILE + x] - H[ym * TILE + x]) * relief[t];
        const inv = 1 / Math.hypot(dx, dy, 1);
        const k = ((oy + y) * ATLAS + (ox + x)) * 4;
        data[k] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
        data[k + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
        data[k + 2] = Math.round((inv * 0.5 + 0.5) * 255);
        data[k + 3] = Math.round(Math.min(1, A[y * TILE + x]) * 255);
      }
    }
  }

  const tex = new THREE.DataTexture(data, ATLAS, ATLAS, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  // Normals and coverage are data, never colour; an sRGB decode would bend both.
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  tex.name = 'vfx:atlas';
  return tex;
}

/* ------------------------------------------------------------------ sigil */

/**
 * Daedric conjuration sigil: two concentric rings, a ring of angular glyphs and
 * a radial tick pattern. Drawn with 2D canvas paths from a fixed seed, so it is
 * generated in code like everything else and is identical every run.
 *
 * R = glyph mask (the emissive), G = ring mask, B = unused, A = union.
 */
export function buildSigilTexture(size = 512): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const g = cv.getContext('2d');
  if (!g) throw new Error('[vfx] 2D context unavailable for sigil synthesis');

  g.clearRect(0, 0, size, size);
  const c = size * 0.5;
  let seed = 1337;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return ((seed >>> 8) & 0xffffff) / 0xffffff;
  };

  g.lineCap = 'butt';
  g.lineJoin = 'miter';

  // Rings, in green so the shader can treat structure and glyphs differently.
  g.strokeStyle = 'rgba(0,255,0,1)';
  for (const [r, w] of [[0.94, 0.010], [0.885, 0.004], [0.60, 0.006], [0.55, 0.016], [0.30, 0.004]]) {
    g.lineWidth = size * w;
    g.beginPath();
    g.arc(c, c, c * r, 0, Math.PI * 2);
    g.stroke();
  }

  // Radial ticks between the outer pair of rings.
  g.lineWidth = size * 0.006;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const len = i % 6 === 0 ? 0.055 : 0.028;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * c * 0.885, c + Math.sin(a) * c * 0.885);
    g.lineTo(c + Math.cos(a) * c * (0.885 + len), c + Math.sin(a) * c * (0.885 + len));
    g.stroke();
  }

  // Glyph band. Daedric letterforms are angular, closed, and asymmetric; a
  // stroke walk over a jittered polar lattice reproduces that character without
  // needing an actual alphabet.
  g.strokeStyle = 'rgba(255,0,0,1)';
  g.lineWidth = size * 0.013;
  const GLYPHS = 18;
  for (let i = 0; i < GLYPHS; i++) {
    const a0 = (i / GLYPHS) * Math.PI * 2;
    g.save();
    g.translate(c + Math.cos(a0) * c * 0.725, c + Math.sin(a0) * c * 0.725);
    g.rotate(a0 + Math.PI * 0.5);
    const s = size * 0.055;
    const strokes = 3 + Math.floor(rnd() * 3);
    g.beginPath();
    let px = (rnd() - 0.5) * s;
    let py = (rnd() - 0.5) * s;
    g.moveTo(px, py);
    for (let k = 0; k < strokes; k++) {
      // Quantised to eighth-turns: the hard angles are the whole look.
      const dir = Math.floor(rnd() * 8) * (Math.PI / 4);
      const len = s * (0.5 + rnd() * 0.75);
      px += Math.cos(dir) * len;
      py += Math.sin(dir) * len;
      g.lineTo(px, py);
    }
    g.stroke();
    // A closing bar, which is what makes the forms read as letters not scribbles.
    if (rnd() > 0.4) {
      g.beginPath();
      g.moveTo(-s * 0.5, py);
      g.lineTo(s * 0.5, py);
      g.stroke();
    }
    g.restore();
  }

  // Inner sigil: an eight-pointed star of straight chords.
  g.strokeStyle = 'rgba(255,0,0,1)';
  g.lineWidth = size * 0.009;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const b = a + Math.PI * (3 / 8) * 2;
    g.moveTo(c + Math.cos(a) * c * 0.30, c + Math.sin(a) * c * 0.30);
    g.lineTo(c + Math.cos(b) * c * 0.30, c + Math.sin(b) * c * 0.30);
  }
  g.stroke();

  // Composite alpha: the union of everything drawn.
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    d[i + 2] = 0;
    d[i + 3] = a;
  }
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.name = 'vfx:sigil';
  return tex;
}
