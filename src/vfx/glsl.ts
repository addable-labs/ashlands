import * as THREE from 'three';

/**
 * Shared GLSL and the live uniform block for every VFX shader.
 *
 * Mirrors the pattern sky/Aerial.ts established: the objects returned by
 * `vfxUniforms()` are module singletons that VFXSystem mutates once per frame,
 * so a dozen materials stay in lockstep with zero per-material bookkeeping.
 *
 * Two things every particle in this subsystem depends on live here:
 *
 *  - the LOCAL HEIGHTFIELD, a small RGBA-float texture of the terrain within a
 *    few dozen metres of the camera. It is what lets a vertex shader place a
 *    fog bank on the ground, gate embers on lava crust, and — critically — fade
 *    a particle out as it approaches the surface instead of slicing into it.
 *  - the SCENE DEPTH hookup, which is optional because the render pipeline does
 *    not expose one (see VFX.ts). When it is absent the heightfield carries the
 *    soft-particle fade on its own.
 */

const U: Record<string, THREE.IUniform> = {
  /** r = terrain height (m), g = lava-crust weight, b = 1-slope, a = water depth. */
  uVfxLocal: { value: null },
  /** World XZ centre of the local heightfield. */
  uVfxLocalOrigin: { value: new THREE.Vector2() },
  /** Edge length in metres of the region the heightfield covers. */
  uVfxLocalSize: { value: 192 },
  uVfxLocalValid: { value: 0 },

  /** Scene depth, if any consumer has handed us one. rgb = view normal, a = linear view depth. */
  uVfxDepth: { value: null },
  uVfxDepthTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
  uVfxDepthValid: { value: 0 },

  uVfxTime: { value: 0 },
  uVfxCamPos: { value: new THREE.Vector3() },
  /**
   * Pixels per world unit at one metre: 0.5 * viewportHeight / tan(fovY/2).
   * A particle's projected diameter is `size * uVfxProj / viewDistance`, which
   * is what the minimum-footprint clamp needs.
   */
  uVfxProj: { value: 900 },
  /** Linear radiance of the key light (sun or the brighter moon). */
  uVfxSunColor: { value: new THREE.Color(1, 1, 1) },
  uVfxSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uVfxAmbient: { value: new THREE.Color(0.1, 0.12, 0.18) },
  /** Wind velocity in m/s, world space. */
  uVfxWind: { value: new THREE.Vector3() },
  /** 0..1 surface wetness from the weather machine. */
  uVfxWetness: { value: 0 },
  /**
   * Extinction per metre of the raymarched particulate MEDIUM (`AshVolume`).
   *
   * The medium is a fullscreen pass composited before the discrete particle
   * layers, so nothing that draws after it is attenuated by it: a grain sixty
   * metres out was being painted at full strength on top of the very fog that
   * should already have swallowed it, which is why the storm's far field read
   * as a uniform carpet of motes reaching to the horizon instead of dissolving.
   * Every discrete layer multiplies its opacity by exp(-uVfxVolExt * viewDist),
   * which is exactly the transmittance the medium in front of it removes.
   */
  uVfxVolExt: { value: 0 },
};

export function vfxUniforms(): Record<string, THREE.IUniform> {
  return U;
}

/** Value noise, fbm and a curl field. Used in vertex shaders, so kept cheap. */
export const VFX_NOISE = /* glsl */ `
#ifndef ASHLANDS_VFX_NOISE
#define ASHLANDS_VFX_NOISE
const float VFX_PI = 3.141592653589793;

float vfxHash11(float n) { return fract(sin(n) * 43758.5453123); }
vec3  vfxHash31(float n) {
  return fract(sin(vec3(n, n + 1.61, n + 3.77)) * vec3(43758.5453, 22578.1459, 19642.3491));
}

float vfxNoise(vec3 x) {
  vec3 p = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n = p.x + p.y * 57.0 + 113.0 * p.z;
  return mix(mix(mix(vfxHash11(n +   0.0), vfxHash11(n +   1.0), f.x),
                 mix(vfxHash11(n +  57.0), vfxHash11(n +  58.0), f.x), f.y),
             mix(mix(vfxHash11(n + 113.0), vfxHash11(n + 114.0), f.x),
                 mix(vfxHash11(n + 170.0), vfxHash11(n + 171.0), f.x), f.y), f.z);
}

float vfxFbm(vec3 p, int oct) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) {
    if (i >= oct) break;
    s += a * vfxNoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}

vec3 vfxPotential(vec3 p) {
  return vec3(vfxNoise(p),
              vfxNoise(p + vec3(31.4, 17.2, 7.7)),
              vfxNoise(p + vec3(-9.1, 23.3, 41.5)));
}

// Divergence-free flow. Advecting on curl rather than on raw noise is what
// keeps a plume of embers coherent instead of dissolving into a fog of dots:
// a divergent field pulls particles apart, curl only shears them.
vec3 vfxCurl(vec3 p, float e) {
  vec3 p0 = vfxPotential(p);
  vec3 px = vfxPotential(p + vec3(e, 0.0, 0.0));
  vec3 py = vfxPotential(p + vec3(0.0, e, 0.0));
  vec3 pz = vfxPotential(p + vec3(0.0, 0.0, e));
  return vec3((py.z - p0.z) - (pz.y - p0.y),
              (pz.x - p0.x) - (px.z - p0.z),
              (px.y - p0.y) - (py.x - p0.x)) / e;
}
#endif
`;

/**
 * The shared uniform block and local-heightfield lookups. Safe in both stages;
 * everything that needs `gl_FragCoord` or the aerial chunk lives in VFX_FRAG.
 * Include VFX_NOISE first.
 */
export const VFX_COMMON = /* glsl */ `
#ifndef ASHLANDS_VFX_COMMON
#define ASHLANDS_VFX_COMMON

uniform sampler2D uVfxLocal;
uniform vec2      uVfxLocalOrigin;
uniform float     uVfxLocalSize;
uniform float     uVfxLocalValid;
uniform sampler2D uVfxDepth;
uniform vec2      uVfxDepthTexel;
uniform float     uVfxDepthValid;
uniform float     uVfxTime;
uniform vec3      uVfxCamPos;
uniform float     uVfxProj;
uniform vec3      uVfxSunColor;
uniform vec3      uVfxSunDir;
uniform vec3      uVfxAmbient;
uniform vec3      uVfxWind;
uniform float     uVfxWetness;
uniform float     uVfxVolExt;

/**
 * Transmittance of the raymarched medium over dist metres. Every discrete
 * particle layer draws AFTER the volume pass, so without this a mote is
 * composited on top of the fog that is meant to be in front of it.
 */
float vfxMediumT(float dist) { return exp(-uVfxVolExt * dist); }

/**
 * Wrapped clock for NOISE DOMAINS only.
 *
 * The value-noise hash is sin(n)*43758 with n = x + 57y + 113z. Feed it a
 * lattice coordinate in the thousands and float32 runs out of mantissa inside
 * the sine, at which point the "smooth" noise degenerates into hash confetti
 * and anything built on it (a lightning channel, a flame plume) falls apart
 * after a few minutes of uptime. Lifetimes still use the true monotonic clock;
 * only the noise arguments wrap.
 */
float vfxNoiseT() { return mod(uVfxTime, 128.0); }

/** Sentinel height for "outside the resident window" — never occludes. */
const float VFX_NO_GROUND = -1.0e5;

vec4 vfxGround(vec2 xz) {
  vec2 uv = (xz - uVfxLocalOrigin) / uVfxLocalSize + 0.5;
  if (uVfxLocalValid < 0.5) return vec4(VFX_NO_GROUND, 0.0, 1.0, 0.0);
  // Clamp rather than discard at the border: the field is re-centred on the
  // camera long before a visible particle can reach the edge, and clamping
  // keeps the ground plane continuous instead of punching a hole in it.
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    return vec4(VFX_NO_GROUND, 0.0, 1.0, 0.0);
  }
  return texture2D(uVfxLocal, uv);
}

float vfxGroundH(vec2 xz) { return vfxGround(xz).r; }

/** Surface normal by central differences on the resident heightfield. */
vec3 vfxGroundN(vec2 xz) {
  float e = uVfxLocalSize / 96.0;
  float hl = vfxGroundH(xz - vec2(e, 0.0));
  float hr = vfxGroundH(xz + vec2(e, 0.0));
  float hd = vfxGroundH(xz - vec2(0.0, e));
  float hu = vfxGroundH(xz + vec2(0.0, e));
  if (hl <= VFX_NO_GROUND * 0.5 || hr <= VFX_NO_GROUND * 0.5) return vec3(0.0, 1.0, 0.0);
  return normalize(vec3(hl - hr, 2.0 * e, hd - hu));
}

#endif
`;

/**
 * Fragment-only helpers: the soft-particle fade (needs `gl_FragCoord`), the
 * particle BRDF, and the aerial transmittance extractor (needs AERIAL_GLSL).
 * Include VFX_NOISE, AERIAL_GLSL and VFX_COMMON before this.
 */
export const VFX_FRAG = /* glsl */ `
#ifndef ASHLANDS_VFX_FRAG
#define ASHLANDS_VFX_FRAG

/**
 * Atlas fetch inset by the ACTUAL mip footprint rather than by a fixed texel.
 *
 * The four sprite tiles share one 256x256 texture, so a bilinear tap taken
 * near a tile boundary at a reduced mip reaches into the neighbouring tile —
 * at 8 px on screen the sampled level has each tile down to 8x8 texels and a
 * fixed one-texel inset is nowhere near enough. fwidth() gives the per-pixel
 * span of the tile UV, which is exactly the footprint the sampler will use.
 */
vec2 vfxTileUV(vec2 uv, vec2 tile) {
  vec2 d = fwidth(uv);
  // The clamp is a SQUARE region, so a large pad turns the outer ring of the
  // quad into a constant-alpha plateau whose silhouette is a rounded square.
  // Cropped by the radial window that produced a readable OCTAGON on every
  // sprite in the frame. The pad now only ever covers the bilinear footprint,
  // and vfxSpriteWindow carries the falloff over the whole disc instead of
  // over the last two texels.
  float pad = clamp(max(d.x, d.y) * 0.75, 0.006, 0.10);
  return tile + clamp(uv, pad, 1.0 - pad) * 0.5;
}

float vfxLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

/**
 * Interleaved-gradient noise — the cheap stand-in for a blue-noise texture.
 *
 * A raymarch with a handful of steps and a fixed step phase draws its own
 * sampling lattice as concentric banding. Offsetting the first sample by a
 * per-pixel value in [0,1) turns that banding into high-frequency noise, which
 * the temporal resolve then integrates away. IGN is used rather than a hash
 * because its spectrum is close to blue over a 3x3 neighbourhood, so what is
 * left after the resolve is grain rather than clumping. The frame term keeps
 * the pattern moving so TAA has something to average.
 */
float vfxBlueNoise(vec2 fragCoord, float frame) {
  vec2 p = fragCoord + frame * 5.588238;
  return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
}

/**
 * Soft-particle coverage in [0,1].
 *
 * Two independent occluders, whichever is nearer wins:
 *  - the resident terrain heightfield, which always exists;
 *  - the pipeline's linear view depth, when something has bound one.
 *
 * softM is the fade distance in METRES. Fading on a world distance rather than
 * on a raw depth delta is what keeps the softness constant as the camera
 * moves, which is the whole point of the effect.
 */
float vfxSoft(vec3 worldPos, float viewDist, float softM) {
  float f = 1.0;

  float gh = vfxGroundH(worldPos.xz);
  if (gh > VFX_NO_GROUND * 0.5) {
    f = min(f, smoothstep(0.0, softM, worldPos.y - gh));
  }

  if (uVfxDepthValid > 0.5) {
    vec2 uv = gl_FragCoord.xy * uVfxDepthTexel;
    float sceneZ = texture2D(uVfxDepth, uv).a;
    // Zero means the prepass never covered this pixel (sky): no occluder.
    if (sceneZ > 0.001) f = min(f, smoothstep(0.0, softM, sceneZ - viewDist));
  }
  return clamp(f, 0.0, 1.0);
}

/**
 * Radiance of the particulate MEDIUM the motes are suspended in, rebuilt from
 * the atmosphere's own aerial uniforms so it tracks the sky dome exactly.
 *
 * This is the term that stops an ash storm from drawing its own ash as black
 * specks against a glowing ochre sky. In heavy particulate almost all the light
 * a mote receives has already been scattered by the medium around it; the
 * direct sun is largely blocked, and lighting the mote from the sun alone gets
 * the answer wrong by an order of magnitude.
 */
vec3 vfxMedia() {
  float hazeSelf = pow(1.0 / (1.0 + uAerialHazeDensity * uAerialHazeH), 0.30);
  vec3 m = uAerialSunColor * (0.30 * hazeSelf) + uAerialSkyColor * 1.4;
  return m * uAerialHazeTint;
}

/**
 * Radiance leaving a lit particulate mote.
 *
 * A dust flake is an optically thin scatterer, not a Lambertian disc, so the
 * diffuse term is wrapped and a forward-scattering lobe is added: motes between
 * the eye and the sun must flare, which is exactly the read that sells airborne
 * ash. The GGX term is small but not optional — without it wet spray shades
 * identically to dry dust.
 */
vec3 vfxLitParticle(vec3 albedo, vec3 N, vec3 V, float rough, float ao, float translucency, float mediaMul, float lumCap) {
  float ndl = dot(N, uVfxSunDir);
  const float wrap = 0.45;
  float diff = max(0.0, (ndl + wrap) / ((1.0 + wrap) * (1.0 + wrap)));

  // Henyey-Greenstein forward lobe through the flake, NORMALISED so its
  // forward peak is exactly 1. Unnormalised, HG at g=0.72 peaks at 1.75, so
  // translucency was silently a 1.75x larger multiplier than it reads as and
  // a 0.1 m mote could leave four times the sun's radiance — which is how a
  // field of sunlit ash turned into clipped specks at dusk.
  float c = dot(-V, uVfxSunDir);
  float g = 0.72;
  float denom = 1.0 + g * g - 2.0 * g * c;
  float hg = pow((1.0 - g) * (1.0 - g) / max(denom, 1e-4), 1.5);
  vec3 direct = uVfxSunColor * (diff / VFX_PI + hg * translucency);

  vec3 H = normalize(uVfxSunDir + V);
  float a = max(rough * rough, 0.008);
  float a2 = a * a;
  float nh = max(dot(N, H), 0.0);
  float d = a2 / (VFX_PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
  float spec = d * 0.04 * max(ndl, 0.0);

  vec3 med = vfxMedia();
  vec3 outR = albedo * (direct + uVfxAmbient * ao + med * mediaMul) + uVfxSunColor * spec;

  // ENERGY CEILING. A dust flake is a scatterer, not a source: whatever the
  // phase function does, the light leaving it came from the medium and the sun
  // that already light the sky behind it, and a mote cannot out-radiate that
  // medium by a factor of three. Without this the normalised forward lobe times
  // a translucency of 2+ let a 0.1 m mote hanging over dark grass clip to cream
  // white — a hard bright disc that reads as a bug, which is exactly the defect
  // this cap exists to make unrepresentable. lumCap is the layer's allowance
  // as a fraction of the medium's own luminance: below 1 for anything that must
  // sit inside the haze (dust, fog, ambient ash), a little above 1 for near
  // grit in a forward-scattering storm, which legitimately out-scatters the
  // multiply-scattered background it is seen against.
  float cap = vfxLum(med) * lumCap;
  float l = vfxLum(outR);
  if (l > cap && l > 1e-6) outR *= cap / l;
  return outR;
}

/**
 * Transmittance along the eye ray, extracted from the shared aerial chunk.
 * applyAerial(c) = c*T + inscatter, so the difference of the unit and zero
 * responses is exactly T — which is what additive (emissive) particles need,
 * since inscatter must not be added twice on top of an ADD blend.
 */
vec3 vfxAerialT(float dist, vec3 viewDir) {
  return applyAerial(vec3(1.0), dist, viewDir) - applyAerial(vec3(0.0), dist, viewDir);
}
#endif
`;

/**
 * SMALL-SPRITE HYGIENE. Include after VFX_COMMON.
 *
 * Two halves of one problem: a world-space sprite whose projected footprint
 * falls to a handful of pixels.
 *
 * VERTEX — `vfxFootprint` grows anything under `VFX_MIN_PX` up to that size and
 * divides its opacity by the area it gained, so the particle's total flux is
 * unchanged and it stops being a one-pixel spike that the TAA resolve, the DOF
 * kernel and the chromatic-aberration pass each turn into a hard artefact. It
 * also fades out anything still under about a pixel: a sub-pixel particle
 * cannot be drawn honestly, and drawing it anyway is what produced specks that
 * read as dead pixels rather than as motes.
 *
 * FRAGMENT — `vfxTileUV` insets the atlas fetch by the actual mip footprint
 * rather than by a fixed texel, so bilinear filtering at a reduced mip cannot
 * reach across the tile boundary; `vfxSpriteWindow` re-applies the radial
 * window analytically, which guarantees a soft edge at every mip regardless of
 * what the texture ended up containing.
 */
export const VFX_SPRITE = /* glsl */ `
#ifndef ASHLANDS_VFX_SPRITE
#define ASHLANDS_VFX_SPRITE
#define VFX_MIN_PX 5.0

/**
 * @param size  world-space sprite diameter, modified in place
 * @param dist  view distance in metres
 * @param minPx floor on the projected diameter, in pixels
 * @param comp  compensation exponent on the area gained; see below
 * @return      opacity multiplier: energy compensation and the sub-pixel fade
 *
 * comp = 2 conserves flux exactly: the sprite was grown by "grow" in each
 * axis, so its radiance is divided by grow^2 and the integral over the sprite
 * is unchanged. That is right for a SCATTERER — a distant ash mote genuinely
 * contributes less light per pixel — and wrong for a small EMITTER, because an
 * ember whose radiance has been divided by nine no longer clears the bloom
 * threshold, and an ember with no bloom halo is a hot pixel rather than a
 * spark. An exponent slightly above 1 keeps a far ember dimmer than a near one
 * (so distance still reads) while leaving it inside the bloom prefilter, which
 * is what gives it a halo instead of an aliasing dot.
 */
float vfxFootprintPxE(inout float size, float dist, float minPx, float comp) {
  float px = size * uVfxProj / max(dist, 1e-3);
  float grow = max(1.0, minPx / max(px, 1e-4));
  size *= grow;
  // Nothing below ~0.5 px, full weight by ~1.6x the floor.
  return smoothstep(minPx * 0.10, minPx * 0.5, px) / pow(grow, comp);
}

float vfxFootprintPx(inout float size, float dist, float minPx) {
  return vfxFootprintPxE(size, dist, minPx, 2.0);
}

float vfxFootprint(inout float size, float dist) {
  return vfxFootprintPxE(size, dist, VFX_MIN_PX, 2.0);
}

/**
 * Radial falloff over the WHOLE disc, 1 at the centre and 0 with zero slope at
 * the inscribed circle.
 *
 * The previous window rolled off between r=0.79 and r=1.0 of the quad — about
 * half a pixel on a 5 px sprite. Combined with the square uv clamp in
 * vfxTileUV (which flattens the outer ring of the tile fetch to a constant)
 * every small particle in the game drew a hard-edged, faintly octagonal disc:
 * the blown-out cream blob over the vale grass and the "low-poly heptagon"
 * dust billboards on the ridge were both this, not the atlas and not the
 * geometry. Spreading the falloff over the full radius means the silhouette is
 * a smooth gradient at ANY mip and at any projected size, whatever the tile
 * happens to contain.
 */
float vfxSpriteWindow(vec2 uv) {
  vec2 c = uv * 2.0 - 1.0;
  float r2 = clamp(1.0 - dot(c, c), 0.0, 1.0);
  // r2^1.5: gentle shoulder in the core, long soft tail into the edge.
  return r2 * sqrt(r2);
}

/**
 * PER-INSTANCE ERODED SILHOUETTE — the fix for "reads as bokeh, not as ash".
 *
 * The smooth window above is a perfect Gaussian-ish disc, and because it is
 * applied on top of the atlas fetch it DOMINATES the silhouette: at the four to
 * eight pixels an airborne grain actually occupies, the sampled mip of the
 * flake tile is close to uniform alpha, so every particle in the frame ends up
 * as the same soft circle whatever the texture contains. A field of identical
 * soft circles at identical sizes is the definition of dirt on the front
 * element, and six independent reviews of iter13 said exactly that.
 *
 * A flipbook does not fix it, because the defect is mip reduction: any BAKED
 * shape converges to a disc once the tile is filtered down to 8x8 texels. So
 * the silhouette is synthesised analytically instead, which is resolution- and
 * mip-independent by construction:
 *
 *  - a per-instance ANISOTROPY, because a torn flake tumbling in air projects
 *    as an ellipse at a random aspect, never as a circle;
 *  - a cut radius modulated by three azimuthal harmonics whose phases and
 *    weights come from the instance seed, so neighbouring grains have visibly
 *    different outlines rather than one outline at several scales.
 *
 * NO atan AND NO SINES. This runs on every particle fragment in the subsystem,
 * which in a storm is a couple of screens of blended fill, so the harmonics are
 * built with the Chebyshev recurrence on a coordinate pre-rotated by the
 * instance's own phase: cos(3a) and cos(7a) in a dozen multiplies. The phase
 * argument is (cos, sin) of that rotation, computed once per vertex.
 *
 * Sub-pixel grains never reach here — the footprint fade has already removed
 * them — so the shape is always evaluated at a size where it is visible.
 */
float vfxSpriteWindowR(vec2 uv, float seed, vec2 phase) {
  vec2 c = uv * 2.0 - 1.0;
  float h = vfxHash11(seed * 37.13 + 5.31);
  float e = 0.62 + 0.80 * h;
  c = vec2(c.x * e, c.y / e);
  float r2 = dot(c, c);
  if (r2 >= 1.0) return 0.0;
  float r = sqrt(max(r2, 1e-8));
  // Unit vector at azimuth a, rotated into the instance's own frame.
  vec2 q = vec2(c.x * phase.x - c.y * phase.y, c.x * phase.y + c.y * phase.x) / r;
  float c2 = 2.0 * q.x * q.x - 1.0;
  float s2 = 2.0 * q.x * q.y;
  float c3 = c2 * q.x - s2 * q.y;
  float s3 = s2 * q.x + c2 * q.y;
  float c6 = 2.0 * c3 * c3 - 1.0;
  float s6 = 2.0 * s3 * c3;
  float c7 = c6 * q.x - s6 * q.y;
  float lobe = c3 * (0.30 + 0.34 * fract(h * 17.0)) + c7 * 0.20;
  float rEdge = clamp(0.86 + 0.30 * lobe, 0.26, 1.0);
  // A CORE PLUS A RAMP, not a ramp from the centre. The mean coverage of a
  // sprite is what its layer's opacity was tuned against: a pure linear ramp
  // inside an eroded edge integrates to under 40% of the smooth window this
  // replaced, so swapping one for the other silently took two thirds of the
  // light out of every particle layer in the subsystem. Holding full coverage
  // out to ~38% of the cut radius and ramping over the rest puts the integral
  // back where it was while keeping the irregular outline that is the point.
  float t = clamp((rEdge - r) / (rEdge * 0.62), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
#endif
`;

/**
 * Billboard construction shared by every particle vertex shader. Emits the
 * spin-rotated world-space basis so the fragment stage can build a hemisphere
 * normal and light the particle properly.
 */
export const VFX_BILLBOARD = /* glsl */ `
#ifndef ASHLANDS_VFX_BILLBOARD
#define ASHLANDS_VFX_BILLBOARD
// Rows of the view matrix are the camera basis in world space.
vec3 vfxCamRight() { return vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]); }
vec3 vfxCamUp()    { return vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]); }

void vfxBillboard(vec2 quad, float spin, float size, out vec3 r, out vec3 u, out vec3 offset) {
  vec3 cr = vfxCamRight();
  vec3 cu = vfxCamUp();
  float s = sin(spin);
  float c = cos(spin);
  r = (cr * c + cu * s);
  u = (cu * c - cr * s);
  offset = (r * quad.x + u * quad.y) * size;
}
#endif
`;
