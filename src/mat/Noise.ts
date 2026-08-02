/**
 * GLSL noise library shared by every synthesis pass.
 *
 * Everything here is *periodic*. A texture that does not tile is worthless to
 * us, so tiling is achieved by wrapping the integer lattice key — never by
 * cross-fading two offset copies, which ghosts.
 *
 * The simplex implementation is the interesting one. Simplex noise skews the
 * input by F3 before flooring, so a translation by a period P in input space
 * only maps the skewed integer lattice onto itself when P is a multiple of 3.
 * Given that, each corner is hashed in a 6x-scaled *unskewed* lattice where the
 * coordinates stay integral and the period becomes exactly 6P, so a
 * componentwise mod there is an exact wrap. Every `rep` passed to fbm/ridged/
 * warp below is therefore a multiple of 3.
 */
export const GLSL_NOISE = /* glsl */ `
#define TAU 6.28318530718

// PCG3D (Jarzynski & Olano 2020). Preferred over the usual mod289 float hash
// because mod289 collides once lattice periods exceed 289 — which is precisely
// where our high-frequency octaves live, and the collisions read as repeats.
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

// Lattice key -> three uniform randoms in [0,1). The +65536 bias keeps negative
// lattice coordinates in range; the 24-bit mask keeps every value exactly
// representable as a float32.
vec3 hash33(vec3 key) {
  uvec3 h = pcg3d(uvec3(ivec3(key) + 65536));
  return vec3(h & uvec3(0xffffffu)) * (1.0 / 16777216.0);
}
vec3 hash32(vec2 key, float seed) { return hash33(vec3(key, seed)); }

vec3 gradient3(vec3 key) {
  vec3 r = hash33(key) * 2.0 - 1.0;
  return normalize(r + vec3(1e-4, 3e-4, 7e-4));
}

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float remap01(float x, float a, float b) { return clamp((x - a) / (b - a), 0.0, 1.0); }

vec3 srgb2lin(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
// Palette entries are authored as sRGB 0..255 because that is how anyone reads
// a colour; the shader works in linear.
#define PAL(r, g, b) srgb2lin(vec3(r, g, b) * 0.003921568627)

const float F3 = 0.3333333333;
const float G3 = 0.1666666667;

vec3 simplexKey(vec3 c, vec3 rep) {
  vec3 k = 6.0 * c - (c.x + c.y + c.z);
  vec3 p = 6.0 * rep;
  return mix(k, mod(k, max(p, vec3(1.0))), step(vec3(0.5), rep));
}

/** Simplex 3D. A rep component of 0 means "do not wrap that axis". */
float psnoise3(vec3 v, vec3 rep) {
  vec3 s = floor(v + dot(v, vec3(F3)));
  vec3 x0 = v - s + dot(s, vec3(G3));
  vec3 e = step(vec3(0.0), x0 - x0.yzx);
  vec3 i1 = e * (1.0 - e.zxy);
  vec3 i2 = 1.0 - e.zxy * (1.0 - e);
  vec3 x1 = x0 - i1 + G3;
  vec3 x2 = x0 - i2 + 2.0 * G3;
  vec3 x3 = x0 - 1.0 + 3.0 * G3;
  vec4 w = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  w = w * w; w = w * w;
  vec4 d = vec4(
    dot(gradient3(simplexKey(s, rep)), x0),
    dot(gradient3(simplexKey(s + i1, rep)), x1),
    dot(gradient3(simplexKey(s + i2, rep)), x2),
    dot(gradient3(simplexKey(s + 1.0, rep)), x3));
  return 42.0 * dot(w, d);
}

/**
 * Octave scheduling.
 *
 * Two things were wrong with the naive "r *= 2.0" ladder and both of them are
 * visible from across the room:
 *
 *  1. Every octave shared the same lattice ORIGIN. Simplex noise has a local
 *     minimum of |value| at each simplex vertex, so octaves whose lattices are
 *     nested and phase-aligned all dip together at the coarse vertices. The sum
 *     therefore carries a regular grid of grey nodes at the base period — the
 *     "hash lattice cell centres showing through as dots" the review called out.
 *     Fixing it costs nothing: translate each octave by a fixed pseudo-random
 *     offset. psnoise3 is periodic with period "r" in its own input space, so a
 *     constant translation leaves the uv-space period at exactly 1 and the tile
 *     stays seamless.
 *
 *  2. The frequency ratio was exactly 2, which re-phases every octave onto the
 *     coarse grid on a 1:1:1 schedule. LAC is 2.03 instead, snapped to the
 *     nearest legal period (a multiple of 3 — see the simplex wrap proof above),
 *     which walks the octaves off each other as the ladder climbs.
 */
#define LAC 2.03
vec2 rep3(vec2 r) { return max(vec2(3.0), floor(r * (1.0 / 3.0) + 0.5) * 3.0); }
// Deterministic, decorrelated, and constant per octave: three irrational-ish
// multipliers wrapped to the unit square. Any fixed sequence works; what matters
// is only that consecutive octaves do not share a phase.
vec2 octShift(int i) {
  float f = float(i) + 1.0;
  return fract(vec2(f * 0.7548776662, f * 0.5698402909) + vec2(0.371, 0.827));
}

/** Signed fBm in [-1,1]. rep is the per-axis period across uv 0..1. */
float fbm(vec2 uv, vec2 rep, int oct, float gain, float z) {
  float sum = 0.0, amp = 0.5, nrm = 0.0;
  vec2 r = rep3(rep);
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    sum += amp * psnoise3(vec3(uv * r + octShift(i) * r, z + float(i) * 19.73), vec3(r, 0.0));
    nrm += amp; amp *= gain; r = rep3(r * LAC);
  }
  return sum / max(nrm, 1e-5);
}

/** Absolute-value fBm — puffy, cumulus-like lobes. Returns [0,1]. */
float billow(vec2 uv, vec2 rep, int oct, float gain, float z) {
  float sum = 0.0, amp = 0.5, nrm = 0.0;
  vec2 r = rep3(rep);
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    sum += amp * abs(psnoise3(vec3(uv * r + octShift(i) * r, z + float(i) * 13.11), vec3(r, 0.0)));
    nrm += amp; amp *= gain; r = rep3(r * LAC);
  }
  return sum / max(nrm, 1e-5);
}

/**
 * Ridged multifractal. Each octave is weighted by the previous one, which is
 * what concentrates detail on the crests and leaves the valleys smooth — the
 * signature of eroded volcanic terrain. Returns [0,1].
 */
float ridged(vec2 uv, vec2 rep, int oct, float gain, float z) {
  float sum = 0.0, amp = 0.5, nrm = 0.0, prev = 1.0;
  vec2 r = rep3(rep);
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    float n = 1.0 - abs(psnoise3(vec3(uv * r + octShift(i) * r, z + float(i) * 11.37), vec3(r, 0.0)));
    n *= n;
    sum += amp * n * prev;
    prev = clamp(n, 0.0, 1.0);
    nrm += amp; amp *= gain; r = rep3(r * LAC);
  }
  return sum / max(nrm, 1e-5);
}

/**
 * Domain warp. Periodicity survives: w(uv+1) = uv+1+f(uv) = w(uv)+1, so any
 * field with the same period stays seamless when evaluated at w.
 */
vec2 warp(vec2 uv, vec2 rep, float amp, float z) {
  return uv + amp * vec2(fbm(uv, rep, 3, 0.5, z), fbm(uv, rep, 3, 0.5, z + 61.7));
}

/**
 * Two-level domain warp: a coarse displacement feeding a finer one. One level
 * only shears the field; two make the streamlines fold back on themselves,
 * which is what stops any remaining lattice direction from being readable.
 * Same periodicity argument as "warp" — each level adds a periodic field to uv.
 */
vec2 warp2(vec2 uv, vec2 rep, float amp, float z) {
  vec2 a = warp(uv, rep, amp, z);
  return a + (amp * 0.42) * vec2(fbm(a, rep * 2.0, 3, 0.5, z + 133.1),
                                 fbm(a, rep * 2.0, 3, 0.5, z + 197.3));
}

/**
 * Micro-grain: three decorrelated high-frequency bands summed to [0,1] with a
 * mean of 0.5.
 *
 * "base" is deliberately modest. The terrain packs these tiles into a 512-texel
 * array layer, so anything above ~150 cycles per tile is below three texels and
 * is destroyed by the downsample before it ever reaches a screen; the useful
 * grain band for the 0.5 m detail projection is 48-192, which lands at roughly
 * 2-10 mm of world-space feature. Put the energy there, not at 288.
 */
float microGrain(vec2 uv, float base, float z) {
  vec2 r = vec2(base);
  // Coefficients are sized so the result has a standard deviation near 0.20,
  // not near 0.09. An fBm sum of unit-variance simplex octaves at gain 0.5 has
  // a std of roughly 0.26, so a 0.27/0.16/0.10 stack lands at 0.086 — a 2.6%
  // albedo modulation once a caller multiplies it in, which is below the eight
  // bits the map is stored in and is why the first attempt at "grain" was
  // invisible in the frame. Grain has to be an order of magnitude louder than
  // that to survive mipping down to a 512 array layer and a tonemap.
  return clamp(0.5
    + 0.62 * fbm(uv, r, 2, 0.5, z)
    + 0.38 * fbm(uv, r * 2.06, 2, 0.5, z + 31.3)
    + 0.24 * fbm(uv, r * 4.19, 1, 0.5, z + 57.9), 0.0, 1.0);
}

/**
 * Scattered clasts — pebbles, lapilli, vesicles, scree.
 *
 * "worleyUV" thresholded at a fixed distance is the wrong tool for this and it
 * is what produced the polka-dot field the review flagged: every cell carries a
 * blob, every blob is the same radius, and a jitter of one cell still leaves the
 * centres within half a cell of a regular grid. Three things fix it, and all
 * three are needed:
 *
 *   - a per-cell existence test against "density", so most cells are empty;
 *   - a per-cell radius drawn from a squared random, so the size distribution
 *     has a long tail of small stones and only the occasional large one — real
 *     clast populations are power-law, not monodisperse;
 *   - a jitter that can push a centre clear across the cell boundary.
 *
 * "density" may vary across the tile (feed it a low-frequency mask) to get
 * clumping rather than an even sprinkle. Returns
 * (coverage 0..1, per-clast random, per-clast radius, rim 0..1).
 */
vec4 clasts(vec2 uv, vec2 rep, float density, float sizeLo, float sizeHi, float seed) {
  vec2 p = uv * rep;
  vec2 ip = floor(p), fp = p - ip;
  float cov = 0.0, id = 0.0, rad = 0.0, rim = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 key = mod(ip + o, rep);
      vec3 hs = hash32(key, seed);
      vec3 h2 = hash32(key, seed + 17.31);
      if (h2.x >= density) continue;
      vec2 c = o + 0.5 + (hs.xy - 0.5) * 1.30 - fp;
      // Squash each clast on its own axis: perfectly round stones read as dots.
      float a = hs.z * TAU;
      c = rot2(a) * c * vec2(1.0, mix(0.55, 1.0, h2.z));
      float r = mix(sizeLo, sizeHi, h2.y * h2.y);
      float d = length(c) / max(r, 1e-3);
      float k = 1.0 - smoothstep(0.55, 1.0, d);
      if (k > cov) { cov = k; id = hs.z; rad = r; rim = smoothstep(0.35, 0.95, d) * k; }
    }
  }
  return vec4(cov, id, rad, rim);
}

/**
 * Worley/cellular. Returns (F1, F2, per-cell random). Distances are in cell
 * units. Cell ids wrap on rep, so the field tiles for any integer rep.
 */
vec3 worleyUV(vec2 uv, vec2 rep, float jitter, float seed) {
  vec2 p = uv * rep;
  vec2 ip = floor(p), fp = p - ip;
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec3 hs = hash32(mod(ip + o, rep), seed);
      vec2 r = o + 0.5 + (hs.xy - 0.5) * jitter - fp;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; id = hs.z; }
      else if (d < f2) { f2 = d; }
    }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}

/** 3D cellular on a slice. F2-F1 gives strut networks rather than blobs. */
vec2 worley3(vec3 p, vec2 repXY, float jitter, float seed) {
  vec3 ip = floor(p), fp = p - ip;
  float f1 = 8.0, f2 = 8.0;
  for (int k = -1; k <= 1; k++) {
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec3 o = vec3(float(i), float(j), float(k));
        vec3 c = ip + o;
        vec3 hs = hash33(vec3(mod(c.xy, repXY), c.z + seed));
        vec3 r = o + 0.5 + (hs - 0.5) * jitter - fp;
        float d = length(r);
        if (d < f1) { f2 = f1; f1 = d; }
        else if (d < f2) { f2 = d; }
      }
    }
  }
  return vec2(f1, f2);
}

/**
 * Offset-row hexagonal Voronoi — columnar jointing, scale plates, honeycomb.
 * n = (columns, rows); rows must be EVEN for the odd-row offset to tile, and
 * rows ~= 1.155*columns keeps the cells close to regular hexagons.
 * Returns (F1, F2, cellRandom, cellRandom2) with distances in uv units.
 */
vec4 hexCells(vec2 uv, vec2 n, float jitter, float seed) {
  vec2 P = uv * n;
  float f1 = 9.0, f2 = 9.0;
  vec2 idr = vec2(0.0);
  float jf = floor(P.y);
  for (int dj = -1; dj <= 1; dj++) {
    float rowf = jf + float(dj);
    float row = mod(rowf, n.y);
    float xoff = 0.5 * mod(row, 2.0);
    float base = floor(P.x - xoff);
    for (int di = -1; di <= 1; di++) {
      float colf = base + float(di);
      float col = mod(colf, n.x);
      vec3 hs = hash32(vec2(col, row), seed);
      vec2 c = vec2(colf + xoff + 0.5 + (hs.x - 0.5) * jitter,
                    rowf + 0.5 + (hs.y - 0.5) * jitter);
      float d = length((P - c) / n);
      if (d < f1) { f2 = f1; f1 = d; idr = vec2(hs.z, hs.x); }
      else if (d < f2) { f2 = d; }
    }
  }
  return vec4(f1, f2, idr);
}

/**
 * Ashlar courses. n = (blocks per row, rows), both integers. Rows are shifted
 * by a hashed fraction so vertical joints never line up.
 * Returns (localU, localV, blockRandom, distance to nearest joint in uv units).
 */
vec4 brickCells(vec2 uv, vec2 n, float offsetJitter, float seed) {
  float ry = uv.y * n.y;
  float row = floor(ry);
  float rf = ry - row;
  float off = hash32(vec2(mod(row, n.y), 0.0), seed).x * offsetJitter;
  float rx = uv.x * n.x + off;
  float col = floor(rx);
  float cf = rx - col;
  vec3 hs = hash32(vec2(mod(col, n.x), mod(row, n.y)), seed + 1.0);
  float dx = min(cf, 1.0 - cf) / n.x;
  float dy = min(rf, 1.0 - rf) / n.y;
  return vec4(cf, rf, hs.z, min(dx, dy));
}
`;
