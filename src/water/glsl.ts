import { WAVE_COUNT } from './spectrum';

/**
 * Shared GLSL. Authored in ES 1.00 style: three rewrites ShaderMaterial sources
 * to `#version 300 es` and injects `#define texture2D texture`, so both this
 * code and any ES 3.00-style chunk pulled in from another subsystem compile.
 */

export const COMMON_GLSL = /* glsl */ `
#define WPI 3.141592653589793

float wsat(float x){ return clamp(x, 0.0, 1.0); }

float whash21(vec2 p){
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float wvnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = whash21(i);
  float b = whash21(i + vec2(1.0, 0.0));
  float c = whash21(i + vec2(0.0, 1.0));
  float d = whash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

mat2 wrot(float a){ float s = sin(a), c = cos(a); return mat2(c, s, -s, c); }

/**
 * Interleaved-gradient noise, in [-0.5, 0.5]. Used as a dither: the sea's
 * shading gradient toward the horizon can span hundreds of pixels for a couple
 * of 8-bit steps, and without a per-pixel offset that resolves as flat plateaus
 * with hard risers between them.
 */
float wIGN(vec2 frag){
  return fract(52.9829189 * fract(dot(frag, vec2(0.06711056, 0.00583715)))) - 0.5;
}

/**
 * Cox & Munk: total mean-square slope of a wind-driven sea, from the 1954
 * sun-glitter measurements. Returns (upwind, crosswind) variance — the split is
 * what stretches the glitter path along the wind rather than leaving a round
 * highlight. This is the whole slope budget; whatever the mesh and the detail
 * maps resolve at a given distance is subtracted from it and the remainder is
 * handed to the specular lobe as roughness.
 */
vec2 wSlopeVariance(float windSpeed){
  float mss = 0.003 + 0.00512 * max(windSpeed, 0.0);
  return vec2(mss * 0.54, mss * 0.46);
}

/** Falling ramp: 1 below lo, 0 above hi. GLSL leaves smoothstep undefined when
 *  edge0 >= edge1, and at least one driver in the wild takes that literally. */
float wfall(float hi, float lo, float x){ return 1.0 - smoothstep(lo, hi, x); }
vec2 wfall2(vec2 hi, vec2 lo, vec2 x){ return vec2(1.0) - smoothstep(lo, hi, x); }

/**
 * Analytic box filter of a band in some scalar field.
 *
 * Here x is the field (water column, height above the run-up line, ...), w is its
 * per-pixel rate of change, and the band runs from lo to hi. The ramp is
 * widened to at least a pixel so the edge never goes hard, and the amplitude is
 * scaled by the fraction of the pixel the band actually covers.
 *
 * That second half is the part that matters. A surf line is a fixed width in
 * metres of water column; seen at a grazing angle from 300 m it collapses far
 * below a pixel, and a term that keeps returning 1.0 inside it draws a row of
 * isolated full-brightness pixels — a 1-bit stipple that reads as a broken
 * build. Integrating the band over the footprint instead keeps the *average*
 * right, so a sub-pixel surf line dims into a thin continuous thread.
 */
float wBandAA(float x, float lo, float hi, float w){
  float width = max(hi - lo, 1e-5);
  float e = max(w, 1e-5);
  float inside = smoothstep(lo - e, lo + e, x) * (1.0 - smoothstep(hi - e, hi + e, x));
  return inside * wsat(width / (width + e));
}

/** One-sided form of the above: coverage of x below hi, over a band that starts
 *  at zero. Same footprint scaling, same reason. */
float wBelowAA(float x, float hi, float w){
  float e = max(w, 1e-5);
  return (1.0 - smoothstep(hi - e, hi + e, x)) * wsat(hi / (hi + e));
}

/**
 * Analytic coverage of "field below a threshold", antialiased the same way.
 * Used for the waterline itself, where x is the water column: past the point
 * where one pixel spans more column than the whole feathering distance, the
 * only correct answer is the fraction of the pixel that is wet, and anything
 * else stair-steps.
 */
float wRampAA(float x, float width, float w){
  return wsat(x / max(width, max(w, 1e-5)));
}

/**
 * Analytic caustics. Two counter-rotating interference lattices raised to a high
 * power give the sharp filament network of light focused by a wavy surface,
 * without a texture fetch or a precomputed animation.
 */
float wcaustics(vec2 p, float t){
  float acc = 0.0;
  vec2 q = p;
  for (int i = 0; i < 3; i++){
    float fi = float(i);
    q = wrot(1.1 + fi * 0.9) * q * 1.83 + vec2(t * (0.11 + fi * 0.05), -t * (0.09 - fi * 0.02));
    float n = sin(q.x * 1.7 + sin(q.y * 1.31 + t * 0.63)) * cos(q.y * 1.53 + cos(q.x * 1.13 - t * 0.47));
    acc += 1.0 - abs(n);
  }
  return pow(wsat(acc / 3.0), 6.0);
}
`;

/**
 * Sum-of-Gerstner evaluation shared by the surface mesh and the shoreline pass.
 * `spacing` is the world-space vertex/pixel footprint: components whose
 * wavelength approaches it are faded out so they never alias, and the detail
 * normal maps take over that band instead.
 */
export const GERSTNER_GLSL = /* glsl */ `
#define WAVE_N ${WAVE_COUNT}
uniform vec4 wWaveA[WAVE_N];
uniform vec4 wWaveB[WAVE_N];

void wGerstner(
  vec2 p, float t, float spacing, float damp,
  out vec3 disp, out vec3 nrm, out float jacobian, out float crest
){
  disp = vec3(0.0);
  vec3 tanX = vec3(1.0, 0.0, 0.0);
  vec3 tanZ = vec3(0.0, 0.0, 1.0);
  float ampSq = 1e-8;

  for (int i = 0; i < WAVE_N; i++){
    vec4 A = wWaveA[i];
    vec4 B = wWaveB[i];
    float w = smoothstep(1.9, 4.6, B.w / max(spacing, 1e-3)) * damp;
    if (w < 0.004) continue;

    float amp = A.w * w;
    float phi = A.z * dot(A.xy, p) - B.x * t + B.y;
    float s = sin(phi), c = cos(phi);
    float Q = B.z;
    float ka = A.z * amp;

    disp.xz += Q * amp * A.xy * c;
    disp.y  += amp * s;

    float qs = Q * ka * s;
    tanX.x -= qs * A.x * A.x;
    tanX.y += ka * A.x * c;
    tanX.z -= qs * A.x * A.y;
    tanZ.x -= qs * A.x * A.y;
    tanZ.y += ka * A.y * c;
    tanZ.z -= qs * A.y * A.y;

    ampSq += amp * amp;
  }

  nrm = normalize(cross(tanZ, tanX));
  // Horizontal Jacobian: below ~0.35 the surface is folding, i.e. breaking.
  jacobian = tanX.x * tanZ.z - tanX.z * tanZ.x;
  // Elevation in units of its own standard deviation. A random-phase sum of
  // sines has variance sum(amp^2)/2, so this makes the crest a proper wave
  // statistic: thresholds downstream are "how many sigma", independent of how
  // many components the bank carries or how the spectrum weights them.
  // Dividing by the amplitude *sum* instead — as this did — makes the value
  // shrink as 1/sqrt(N), so a twelve-component sea never reaches a whitecap
  // threshold tuned on a single wave.
  crest = disp.y * inversesqrt(0.5 * ampSq);
}

/** Height only, for passes that do not need a normal. */
float wGerstnerHeight(vec2 p, float t, float damp){
  float y = 0.0;
  for (int i = 0; i < WAVE_N; i++){
    vec4 A = wWaveA[i];
    vec4 B = wWaveB[i];
    y += A.w * damp * sin(A.z * dot(A.xy, p) - B.x * t + B.y);
  }
  return y;
}
`;

/**
 * Terrain heightfield lookup. `wHeightXform` is (1/(2*extent), extent). Outside
 * the baked footprint the floor is ramped down to abyssal depth so the clamped
 * border texels do not smear a coastline out to the horizon.
 */
export const TERRAIN_GLSL = /* glsl */ `
uniform sampler2D wHeightTex;
uniform vec2 wHeightXform;

float wTerrainHeight(vec2 xz){
  vec2 uv = xz * wHeightXform.x + 0.5;
  float h = texture2D(wHeightTex, clamp(uv, 0.0015, 0.9985)).r;
  vec2 d = abs(uv - 0.5);
  float outside = smoothstep(0.46, 0.5, max(d.x, d.y));
  return mix(h, -120.0, outside);
}
`;

/**
 * Sun/moon glitter off the sea.
 *
 * The distribution here is an anisotropic GAUSSIAN (Beckmann / Cox-Munk), NOT
 * GGX, and that is the whole point of the function existing.
 *
 * GGX's tail is a Cauchy tail: at a facet tilt of 30 degrees with a wind sea's
 * slope variance it still returns about one percent of its peak, where the
 * measured ocean slope distribution — the same Cox & Munk 1954 statistics this
 * file already uses for the variance itself — returns 1e-9. On a surface seen
 * at a grazing angle that difference is not academic. Every pixel of open sea,
 * from the near shore out to the horizon, sits within a few degrees of the same
 * off-specular tilt, so a Cauchy tail hands the entire ocean one nearly constant
 * value: measured on the night frame, 0.30 against a sky of 0.017, a warm
 * twenty-to-one wash with no gradient in it in any direction. That is the
 * "completely flat untextured slab, brighter than the sky above the horizon"
 * the review found, and it is also why the frame had no glitter PATH — the path
 * had been smeared over the whole sea until it stopped being one.
 *
 * With the Gaussian the same geometry gives a lobe that decays by e^-21 across
 * thirty degrees of azimuth, so the bright core stays a path, the sea either
 * side of it falls back to the reflected sky, and the metre-scale swell tilting
 * the surface by a few degrees now modulates the lobe strongly instead of
 * imperceptibly — which is what breaks the path up into moving facets.
 *
 * `ax`/`ay` are the same widths the GGX form took (alpha^2 = 2 * slope
 * variance), so the two are interchangeable at the call site, and both integrate
 * to unity over the hemisphere.
 */
export const GGX_GLSL = /* glsl */ `
/** Slope width along an arbitrary azimuth, for the anisotropic Smith terms. */
float wProjAlpha(vec3 X, vec3 T, vec3 B, float ax, float ay){
  float t = dot(T, X), b = dot(B, X);
  float d = t * t + b * b;
  if (d < 1e-8) return 0.5 * (ax + ay);
  return sqrt((t * t * ax * ax + b * b * ay * ay) / d);
}

/** Smith masking for a Gaussian slope distribution: Walter et al.'s rational
 *  fit to the exact erfc form, inside 0.35% everywhere. */
float wSmithBeck(float NoX, float a){
  float s = sqrt(max(1.0 - NoX * NoX, 1e-8));
  float c = NoX / max(a * s, 1e-6);
  if (c >= 1.6) return 1.0;
  float c2 = c * c;
  return (3.535 * c + 2.181 * c2) / (1.0 + 2.276 * c + 2.577 * c2);
}

/**
 * Specular reflectance of the sea for a punctual source, WITHOUT the Fresnel
 * factor (the caller owns that, because the same Fresnel splits the reflection
 * and the water column). Multiply by the source's irradiance and by F.
 *
 * Returns D * G / (4 * NdotV): the NdotL of the rendering equation cancels
 * against the microfacet BRDF's own denominator, and the Smith term goes to zero
 * linearly in NdotV, so the grazing limit is finite rather than a division by a
 * clamped epsilon.
 */
float wOceanSpec(vec3 N, vec3 V, vec3 L, vec3 T, vec3 B, float ax, float ay){
  float NoL = dot(N, L);
  float NoV = dot(N, V);
  if (NoL <= 1e-4 || NoV <= 1e-4) return 0.0;

  vec3 H = normalize(V + L);
  float NoH = max(dot(N, H), 1e-4);
  // The half-vector as a SLOPE in the tangent frame, which is the variable the
  // Cox-Munk statistics are actually defined on.
  float sx = dot(T, H) / NoH;
  float sy = dot(B, H) / NoH;
  float e = (sx * sx) / (ax * ax) + (sy * sy) / (ay * ay);
  float NoH2 = NoH * NoH;
  float D = exp(-min(e, 64.0)) / (WPI * ax * ay * NoH2 * NoH2);

  float G = wSmithBeck(NoV, wProjAlpha(V, T, B, ax, ay))
          * wSmithBeck(NoL, wProjAlpha(L, T, B, ax, ay));
  return D * G / (4.0 * NoV);
}

float wGGXAniso(vec3 N, vec3 V, vec3 L, vec3 T, vec3 B, float ax, float ay){
  vec3 H = normalize(V + L);
  float NoH = max(dot(N, H), 0.0);
  float NoV = max(dot(N, V), 1e-4);
  float NoL = max(dot(N, L), 0.0);
  if (NoL <= 0.0) return 0.0;

  float ToH = dot(T, H) / ax;
  float BoH = dot(B, H) / ay;
  float d = ToH * ToH + BoH * BoH + NoH * NoH;
  float D = 1.0 / (WPI * ax * ay * d * d);

  float a = 0.5 * (ax + ay);
  float a2 = a * a;
  float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  float Vis = 0.5 / max(gv + gl, 1e-5);

  return D * Vis * NoL;
}
`;

/** Cheap analytic sky, used where the reflection target has no valid sample
 *  (off-screen reflections, the Snell window seen from below). */
export const SKYFALL_GLSL = /* glsl */ `
uniform vec3 wZenith;
uniform vec3 wHorizon;

vec3 wSkyApprox(vec3 R, vec3 sunDir, vec3 sunCol){
  float h = wsat(R.y);
  // Most of the gradient a shallow water reflection ever samples lives in the
  // first fifteen degrees above the horizon, so the interpolant is compressed
  // there rather than spread evenly over the hemisphere.
  vec3 c = mix(wHorizon, wZenith, pow(h, 0.40));
  float sd = max(dot(R, sunDir), 0.0);
  // Disc, aureole, and the broad forward lobe. The last term is what puts a
  // readable brightening either side of the glitter path instead of a single
  // isolated dot.
  c += sunCol * (pow(sd, 1400.0) * 4.0 + pow(sd, 14.0) * 0.075 + pow(sd, 3.0) * 0.012);
  return c;
}
`;
