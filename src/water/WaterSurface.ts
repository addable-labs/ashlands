import * as THREE from 'three';
import { COMMON_GLSL, GERSTNER_GLSL, GGX_GLSL, SKYFALL_GLSL, TERRAIN_GLSL } from './glsl';
import type { AerialBinding } from './aerial';

/**
 * Radial LOD disc centred on the viewer. A polar grid with geometrically
 * increasing ring radii keeps the projected triangle size roughly constant from
 * the boat's gunwale out to the horizon in a single draw call, and each vertex
 * carries its own world-space footprint so the wave sum can drop components it
 * cannot resolve.
 */
const RINGS = 176;
const SEGMENTS = 224;
const R_INNER = 0.8;
const R_OUTER = 9000;

/**
 * The sea does not stop at the LOD edge. Rings past R_OUTER carry it out to
 * R_HORIZON, which is where the atmosphere's extinction integral has fully
 * saturated in the *thinnest* weather we ship — measured at roughly 26 km on a
 * clear evening, so 60 km leaves a wide margin. Without them the last drawn
 * water sits at 9 km with about 20% of its own colour still unhazed and meets a
 * fully-scattered sky at the horizon line, which is the hard fog wall.
 *
 * All of it compresses into well under a pixel of screen, which is exactly what
 * an infinite plane does; the point is that the pixel finally contains water at
 * the right optical depth instead of water at 9 km.
 */
const HORIZON_RINGS = 22;
const R_HORIZON = 60000;
const TOTAL_RINGS = RINGS + HORIZON_RINGS;

/**
 * Far rings are drawn at a compressed distance so 60 km of sea fits inside a
 * 12 km far plane. The compression runs along the eye ray, so it changes depth
 * only — every vertex keeps its exact screen position, and the shading reads
 * the true distance from a varying.
 */
const COMPRESS_START = 6000;
const COMPRESS_MAX = 11000;

export function buildDiscGeometry(): THREE.BufferGeometry {
  const vertCount = 1 + TOTAL_RINGS * SEGMENTS;
  const pos = new Float32Array(vertCount * 3);
  const spacing = new Float32Array(vertCount);

  const radii = new Float32Array(TOTAL_RINGS);
  const growth = Math.pow(R_OUTER / R_INNER, 1 / (RINGS - 1));
  for (let j = 0; j < RINGS; j++) radii[j] = R_INNER * Math.pow(growth, j);
  const hGrowth = Math.pow(R_HORIZON / R_OUTER, 1 / HORIZON_RINGS);
  for (let j = 0; j < HORIZON_RINGS; j++) radii[RINGS + j] = R_OUTER * Math.pow(hGrowth, j + 1);

  spacing[0] = R_INNER;
  let v = 1;
  for (let j = 0; j < TOTAL_RINGS; j++) {
    const r = radii[j];
    const radial = j === 0 ? r : r - radii[j - 1];
    const angular = (Math.PI * 2 * r) / SEGMENTS;
    // Anisotropy-aware vertex footprint: the GEOMETRIC MEAN of the radial and
    // angular steps, not the larger of the two.
    //
    // The disc is seen at a grazing angle, so its two spacings do not project to
    // anything like the same thing on screen. At 400 m from a three-metre eye a
    // radial step of 21 m covers three quarters of a pixel while the 11 m
    // angular step covers twenty-six of them. Taking the max quoted the mesh's
    // resolving power as 21 m and made the wave sum drop every component shorter
    // than about 96 m — the entire 20-to-80 m band, which is the only part of
    // the spectrum with both enough amplitude to modulate a grazing Fresnel and
    // a short enough wavelength to read as texture rather than as a gradient.
    // That is why the far sea rendered as a featureless plate: not because the
    // waves were not there, but because the LOD gate was measuring the mesh
    // along the one axis that costs nothing on screen. The geometric mean is the
    // same argument the fragment shader already makes for its texture footprint.
    const sp = Math.sqrt(Math.max(radial, angular) * Math.max(Math.min(radial, angular), 1e-4));
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      pos[v * 3] = Math.cos(a) * r;
      pos[v * 3 + 1] = 0;
      pos[v * 3 + 2] = Math.sin(a) * r;
      spacing[v] = sp;
      v++;
    }
  }

  const triCount = SEGMENTS + (TOTAL_RINGS - 1) * SEGMENTS * 2;
  const idx = new Uint32Array(triCount * 3);
  let t = 0;
  for (let i = 0; i < SEGMENTS; i++) {
    idx[t++] = 0;
    idx[t++] = 1 + ((i + 1) % SEGMENTS);
    idx[t++] = 1 + i;
  }
  for (let j = 0; j < TOTAL_RINGS - 1; j++) {
    const a0 = 1 + j * SEGMENTS;
    const b0 = 1 + (j + 1) * SEGMENTS;
    for (let i = 0; i < SEGMENTS; i++) {
      const i1 = (i + 1) % SEGMENTS;
      idx[t++] = a0 + i;
      idx[t++] = b0 + i1;
      idx[t++] = b0 + i;
      idx[t++] = a0 + i;
      idx[t++] = a0 + i1;
      idx[t++] = b0 + i1;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSpacing', new THREE.BufferAttribute(spacing, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R_HORIZON * 1.02);
  return g;
}

export const DISC_TRIANGLES = SEGMENTS + (TOTAL_RINGS - 1) * SEGMENTS * 2;

const VERT = /* glsl */ `
attribute float aSpacing;

uniform float wTime;

varying vec3 vWorld;
varying vec3 vNrm;
varying float vJac;
varying float vCrest;
varying float vDist;
varying vec3 vViewDir;

${COMMON_GLSL}
${GERSTNER_GLSL}
${TERRAIN_GLSL}

void main(){
  vec3 anchor = (modelMatrix * vec4(position, 1.0)).xyz;
  float floorY = wTerrainHeight(anchor.xz);
  float still = -floorY;

  // Shoaling. A wave feeling the bed shortens and *grows* before it breaks
  // (Green's law), and only collapses in the last metre or so; damping
  // monotonically from 3.4 m instead left a hundred-metre band of dead glass in
  // front of every shore, which is the opposite of what a coast looks like.
  float damp = smoothstep(0.0, 1.6, still) * (1.0 + 0.35 * exp(-abs(still - 3.0) * 0.55));

  vec3 disp, nrm;
  float jac, crest;
  wGerstner(anchor.xz, wTime, aSpacing, damp, disp, nrm, jac, crest);

  vec3 world = anchor + disp;
  vec3 ray = world - cameraPosition;
  float d = max(length(ray), 1e-4);

  vWorld = world;
  vNrm = nrm;
  vJac = jac;
  vCrest = crest;
  vDist = d;
  vViewDir = ray / d;

  // Fold the horizon rings inside the far plane. The compression is a soft knee
  // applied *along the eye ray*, so it is monotonic in depth (no ring can swap
  // in front of its neighbour) and leaves the projected position untouched.
  float drawn = d;
  if (d > ${COMPRESS_START.toFixed(1)}){
    float span = ${(COMPRESS_MAX - COMPRESS_START).toFixed(1)};
    drawn = ${COMPRESS_START.toFixed(1)} + span * (1.0 - exp(-(d - ${COMPRESS_START.toFixed(1)}) / span));
  }

  gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + vViewDir * drawn, 1.0);
}
`;

function fragment(aerial: AerialBinding): string {
  return /* glsl */ `
precision highp float;

varying vec3 vWorld;
varying vec3 vNrm;
varying float vJac;
varying float vCrest;
varying float vDist;
varying vec3 vViewDir;

uniform float wTime;
uniform vec3 wSunDir;
uniform vec3 wSunColor;
uniform vec3 wAmbient;
uniform vec2 wWindDir;
uniform float wWindSpeed;
uniform float wSunAbove;
/** Angular RADIUS of the key light, radians. Sun by day, brighter moon by night. */
uniform float wKeyAngle;

uniform sampler2D wReflTex;
uniform mat4 wReflVP;
uniform float wReflValid;
/** Pixels per radian of the reflection target, for the glossy mip select. */
uniform float wReflPix;

uniform sampler2D wRefrTex;
uniform sampler2D wRefrDepth;
uniform mat4 wRefrVP;
uniform vec2 wRefrNearFar;
uniform float wRefrValid;

uniform sampler2D wDetail;
uniform sampler2D wFoam;
/** Anisotropy actually bound on wDetail. Decides how much of a grazing pixel's
 *  slope spectrum the hardware filter can still resolve. */
uniform float wAniso;

uniform vec3 wExtinction;
uniform vec3 wScatter;
uniform vec3 wDeepTint;
uniform vec3 wFoamColor;
uniform float wFoamAmount;

${COMMON_GLSL}
${GERSTNER_GLSL}
${TERRAIN_GLSL}
${GGX_GLSL}
${SKYFALL_GLSL}
${aerial.glsl}

/**
 * Sky radiance along a reflected ray, for every tap the planar reflection
 * cannot serve (off-screen, behind the camera, the Snell window from below).
 *
 * This is the ATMOSPHERE'S OWN integral, run along the reflected direction over
 * the whole air column, rather than a two-colour ramp built from the published
 * ambient irradiance and then tinted. The ramp was a constant fill with a
 * hand-picked rust multiplier on it: it had no phase function, so the sea
 * carried no brightening toward the sun or the moon except through the specular
 * lobe, and its colour was free to drift away from the sky dome every time
 * either side was retuned — which is the "water fogged differently from the
 * sky" failure the art bible calls an instant fail.
 *
 * The trick that makes one call cover the whole hemisphere is that the aerial
 * chunk integrates an exponential atmosphere along a segment, and that integral
 * CONVERGES as the segment grows for any upward ray. Passing a slant path of
 * 40 km / sin(elevation) therefore evaluates ~99% of the true air column for
 * every direction alike, and degenerates — correctly — into full saturation at
 * the horizon, which is exactly the radiance the sky dome converges on. That is
 * what makes the sea meet the sky at the horizon line with no step in it.
 */
vec3 wSkyRadiance(vec3 R, vec3 L, vec3 seed){
  // Clamp below the horizontal: a wave normal can throw the reflected ray into
  // the ground, and the optical-depth integral has no meaning there.
  vec3 Rs = normalize(vec3(R.x, max(R.y, 0.012), R.z));
${
  aerial.foreign
    ? /* glsl */ `  float dSky = min(5.0e6, 4.0e4 / Rs.y);
  // Seeded with a measurement of the sky rather than with black.
  //
  // The aerial chunk holds a floor on transmittance so that a silhouette never
  // loses all its contrast, which means it always hands back a few percent of
  // whatever colour it was given — a deliberate and correct property for a
  // SURFACE. There is no surface at the end of this ray, so passing black
  // asserted that the sky reflects some fraction less than one of itself, and
  // the sea came out that much darker than the dome above it at every grazing
  // angle. \`seed\` is the dome's own radiance sampled off the frame where one is
  // available (zero where it is not, which is the old behaviour), so the floor
  // now returns sky instead of subtracting it.
  vec3 sky = ${aerial.call('seed', 'dSky', 'Rs', 'L')};
  // The aerial chunk carries only the scattered field, so the disc and its tight
  // aureole are added here; they are what put a sun (or a moon) at the far end
  // of the glitter path instead of a smooth gradient.
  float sd = max(dot(Rs, L), 0.0);
  sky += wSunColor * (pow(sd, 1400.0) * 4.0 + pow(sd, 26.0) * 0.06);
  return sky;`
    : /* glsl */ `  // No aerial entry point in the sky chunk: fall back to the local two-colour
  // ramp, run through the local haze so it at least saturates at the horizon.
  vec3 approx = max(wSkyApprox(Rs, L, wSunColor), seed);
  float dSky = min(5.0e6, 4.0e4 / Rs.y);
  return ${aerial.call('approx', 'dSky', 'Rs', 'L')};`
}
}

float linearDepth(float rawDepth){
  float ndc = rawDepth * 2.0 - 1.0;
  float n = wRefrNearFar.x, f = wRefrNearFar.y;
  return (2.0 * n * f) / (f + n - ndc * (f - n));
}

/**
 * Four rotated, differently-scrolling taps of the same tileable normal map,
 * each warped by the tap above it. The rotation angles are mutually irrational
 * multiples of the scale ratio, which is what stops the lattice from beating
 * back into visible tiles at any distance.
 *
 * The out parameter reports how much of the slope spectrum survived the
 * anti-alias fades at this distance. The remainder is not discarded — the caller folds it
 * into the specular roughness, which is the only way the far field can carry
 * the sea's texture once every wavelength is sub-pixel. Flattening to a mirror
 * instead is what turns the horizon into a pair of constant-colour plateaus.
 */
vec2 detailSlope(vec2 p, float dist, float foot, float windN, out float resolved, out float gust){
  vec2 w = normalize(wWindDir + vec2(1e-5));
  vec2 perp = vec2(-w.y, w.x);
  float t = wTime;

  // The map's noise lattice has a period of one eighth of the tile, so a tap at
  // tile T carries features of about T/8 metres. That is the number every fade
  // below is quoted against.
  //
  // Swell scale. The 641 m tap (80 m features) is the one that has to survive to
  // the horizon: at 400 m from a three-metre eye a pixel covers 27 m along the
  // eye ray and 0.4 m across it, so an 80 m wave is still ninety pixels wide
  // across the ray while a 2 m wave is long gone. Without it the only octave
  // left past a couple of hundred metres was the 151 m tap's 19 m features, and
  // those are half a pixel across the ray at 3 km — i.e. nothing. That is the
  // "flat featureless plate" the far sea was rendering: not an absent normal
  // map, an octave ladder whose longest rung stopped an octave short of the
  // distances these shots actually frame.
  vec4 tS = texture2D(wDetail, (wrot(-0.37) * p) / 641.0 + w * t * 0.0043);
  vec4 t0 = texture2D(wDetail, (wrot(0.61) * p) / 151.0 + w * t * 0.011 + (tS.xy - 0.5) * 0.06);
  vec4 t1 = texture2D(wDetail, p / 17.3 + w * t * 0.048 + (t0.xy - 0.5) * 0.12);
  vec2 warp = (t1.xy - 0.5) * 0.30;

  vec4 t2 = texture2D(wDetail, (wrot(2.1) * p) / 4.71 + w * t * 0.115 + warp);
  vec4 t3 = texture2D(wDetail, (wrot(-1.27) * p) / 1.29 - perp * t * 0.19 + (t2.xy - 0.5) * 0.42);

  // Each tap fades out an octave before its texel footprint reaches a pixel.
  //
  // The gate is the world-space SCREEN FOOTPRINT, not the distance. Those are
  // the same thing only for a surface seen face-on; a sea is seen at a grazing
  // angle, where one pixel spans metres along the eye ray while still spanning
  // centimetres across it. Gating on distance therefore kept the 1.3 m and 4.7 m
  // octaves fully switched on over a shoreline whose pixels each covered thirty
  // metres of water — a normal map running an order of magnitude above Nyquist,
  // which is not "detail", it is a per-pixel random slope. Fed into a specular
  // lobe that is a delta function in the same limit, that is precisely the band
  // of cyan-white fireflies the sea was rendering instead of a surface.
  //
  // The footprint passed in is the geometric mean of the pixel's major and minor
  // axes, which is what an anisotropic texture filter actually resolves; using
  // the major axis alone would flatten a grazing sea a good deal further than the
  // hardware filter does and throw away detail that is genuinely there across the
  // ray. Whatever each octave loses here is not discarded — the resolved fraction
  // reports it and the caller turns it into microfacet roughness.
  float fS = 1.0 - smoothstep(16.0, 108.0, foot);
  float f0 = min(1.0 - smoothstep(9000.0, 34000.0, dist), 1.0 - smoothstep(3.8, 25.0, foot));
  float f1 = min(1.0 - smoothstep(900.0, 3400.0, dist), 1.0 - smoothstep(0.43, 2.90, foot));
  float f2 = min(1.0 - smoothstep(90.0, 320.0, dist), 1.0 - smoothstep(0.118, 0.79, foot));
  float f3 = min(1.0 - smoothstep(16.0, 74.0, dist), 1.0 - smoothstep(0.032, 0.215, foot));

  // The long tap's amplitude is the slope of a 1.5 m swell over 80 m, which is
  // an order of magnitude larger than the grazing angle the far sea is viewed
  // at — so it modulates the Fresnel term and displaces the specular lobe
  // strongly enough to break the glitter band into individual facets instead of
  // leaving a smooth wash.
  vec2 s = (tS.xy - 0.5) * 2.0 * 0.23 * fS;
  s += (t0.xy - 0.5) * 2.0 * 0.26 * f0;
  s += (t1.xy - 0.5) * 2.0 * 0.82 * f1;
  s += (t2.xy - 0.5) * 2.0 * 0.60 * f2;
  s += (t3.xy - 0.5) * 2.0 * 0.44 * f3;

  // Variance is additive, so the resolved fraction weights each band by the
  // square of its fade rather than by the fade itself.
  resolved = wsat(0.08 * fS * fS + 0.09 * f0 * f0 + 0.25 * f1 * f1 + 0.27 * f2 * f2 + 0.34 * f3 * f3);

  // GUSTINESS, in [0,1] about a mean of 0.5. The two longest taps' height
  // channels, so it costs no extra fetch.
  //
  // This is the one piece of sea texture that survives to any distance, and its
  // absence is why every review of the far field says "flat untextured slab".
  // The argument is a counting one: past a kilometre every wave the normal map
  // carries is below Nyquist and the fades above have correctly folded all of it
  // into a single broad roughness, which is a SMOOTH function of position — so
  // the sea becomes a gradient, and no amount of extra normal detail can change
  // that without aliasing. But wind does not arrive uniformly. It lands in cat's
  // paws tens to hundreds of metres across, and inside one the mean-square slope
  // is several times what it is in the slick between them. A 60 m gust is still
  // sixty pixels across at a kilometre and six at ten kilometres: it is
  // resolvable exactly where the wave normals are not.
  //
  // What it modulates is ROUGHNESS, not the normal, which is why it does not
  // alias — it changes the WIDTH of the specular lobe and therefore the balance
  // between reflected sky and sun glitter, so it reads as the long light and
  // dark streaks a real sea carries and it breaks the glitter path into a chain
  // of separate bright patches instead of a gaussian smear. As the footprint
  // grows past the gust scale the taps mip to their own mean and the modulation
  // fades to unity by itself, which is the correct antialiasing for a variance.
  gust = tS.a * 0.62 + t0.a * 0.38;

  // The resolved slope rides the same modulation, so a slick is smooth in the
  // detail band as well as in the unresolved one and total slope energy still
  // tracks the local wind rather than the average of it.
  return s * (0.45 + 0.55 * windN) * (0.55 + 0.90 * gust);
}

/** Samples a screen-space target and reports how far inside the frame the tap
 *  landed, so off-screen reflections dissolve into the analytic sky instead of
 *  smearing the border texels. */
vec3 boxSample(sampler2D tex, vec2 uv, out float valid){
  vec2 e = smoothstep(vec2(0.0), vec2(0.045), uv) * wfall2(vec2(1.0), vec2(0.955), uv);
  valid = e.x * e.y;
  return texture2D(tex, clamp(uv, 0.002, 0.998)).rgb;
}

/**
 * As above, at an explicit mip: the glossy reflection integrates the target
 * over the cone the unresolved facets span rather than point-sampling it.
 *
 * The validity feather is deliberately tight — a couple of texels, not the
 * 4.5% of frame the refraction tap uses. The mirror camera shares the main
 * camera's field of view, so a surface point at the edge of the screen
 * reprojects to the edge of the reflection target and its sample is perfectly
 * good; fading it out there only swapped a correct reflection for the analytic
 * fallback and drew a hard vertical seam down both sides of the sea.
 */
vec4 boxSampleLod(sampler2D tex, vec2 uv, float lod, out float valid){
  vec2 e = smoothstep(vec2(-0.003), vec2(0.006), uv) * wfall2(vec2(1.003), vec2(0.994), uv);
  valid = e.x * e.y;
  return textureLod(tex, clamp(uv, 0.002, 0.998), lod);
}

void main(){
  vec3 V = -vViewDir;
  vec3 L = normalize(wSunDir);
  float windN = wsat(wWindSpeed / 18.0);

  // Water column under this fragment, measured from the *displaced* surface so
  // the waterline advances and retreats with the swell — and the screen-space
  // footprint of this pixel, both in world metres.
  //
  // Taken here rather than where they are used: derivatives inside conditional
  // control flow are undefined unless the whole quad takes the same branch, and
  // every branch below is exactly the kind a shoreline straddles.
  float column = max(vWorld.y - wTerrainHeight(vWorld.xz), 0.0);
  vec2 ddx = dFdx(vWorld.xz);
  vec2 ddy = dFdy(vWorld.xz);
  float footA = length(ddx);
  float footB = length(ddy);
  float footprint = max(max(footA, footB), 1e-4);
  // Anisotropy-aware footprint: on a plane seen at a grazing angle the pixel
  // covers metres along the eye ray and centimetres across it. What an
  // anisotropic filter resolves is the MINOR axis, right up until the ratio of
  // the two exceeds the number of taps it is allowed — past that it is the major
  // axis divided by that tap count. It is not the geometric mean, which is what
  // this used and which is only correct at exactly one ratio.
  //
  // The error is one-sided and large in the band that matters. A sea seen from a
  // headland at 1 km covers 6.8 m along the ray and 0.97 m across it: eight taps
  // resolve 0.85 m, so the true limit is the 0.97 m minor axis, while the
  // geometric mean claimed 2.6 m and switched the 2 m octave off at 6% strength.
  // That is a factor of nearly three of resolving power thrown away over the
  // entire mid-field — the part of the sea that fills a quarter of a coastal
  // frame — and it is why the water there read as a smooth plate while the
  // hardware was perfectly capable of filtering the detail correctly.
  float footAniso = max(max(min(footA, footB), max(footA, footB) / max(wAniso, 1.0)), 1e-4);
  float colFw = max(fwidth(column), 1e-4);

  float resolved, gust;
  vec2 slope = detailSlope(vWorld.xz, vDist, footAniso, windN, resolved, gust);
  vec3 N = normalize(vNrm - vec3(slope.x, 0.0, slope.y) * 0.55);

  // Local wind speed inside the gust field. Cox-Munk's slope variance is linear
  // in wind speed, so scaling the speed is the physically meaningful way to
  // apply the modulation rather than scaling the variance by an invented factor.
  float gustWind = wWindSpeed * (0.45 + 1.10 * gust);

  // Slope the shading no longer resolves. It becomes microfacet roughness
  // below, so total slope energy is conserved across the LOD transition
  // instead of being thrown away and leaving a mirror.
  float unres = 1.0 - resolved;

  // Curvature of the shading normal across this pixel, as a variance. The mesh
  // itself aliases at a grazing view — one pixel can straddle a whole wave — and
  // the wave sum's own LOD gate is per-vertex, so it cannot know about it. This
  // is the standard filtered-normal (Kaplanyan) term and it is the second half
  // of the same energy argument the detail fades make: slope the pixel cannot
  // resolve has to widen the specular lobe, never disappear from it, or the
  // remaining delta-function highlight lands on isolated pixels and reads as a
  // firefly. Taken here, in uniform control flow, before any branch.
  vec3 dNx = dFdx(N);
  vec3 dNy = dFdy(N);
  float normalVar = 0.25 * (dot(dNx, dNx) + dot(dNy, dNy));

  bool topSide = gl_FrontFacing;
  if (!topSide) N = -N;

  float NoV = max(dot(N, V), 1e-3);

  // ---- underside: Snell's window and total internal reflection ------------
  if (!topSide){
    vec3 up = vec3(0.0, 1.0, 0.0);
    float cosI = wsat(dot(V, up));
    float sinI = sqrt(max(0.0, 1.0 - cosI * cosI));
    float sinT = 1.333 * sinI;

    vec3 murk = wScatter * (wAmbient + wSunColor * 0.12) * 3.0;
    vec3 col = murk;

    if (sinT < 1.0){
      // Inside the window the sky is compressed into a ~97 degree cone.
      float cosT = sqrt(max(0.0, 1.0 - sinT * sinT));
      vec3 axis = normalize(V - up * cosI);
      vec3 R = normalize(up * cosT + axis * sinT);
      vec3 sky = wSkyRadiance(R, L, vec3(0.0));
      float edge = wfall(1.0, 0.86, sinT);
      col = mix(murk, sky, edge * 0.94);
    } else {
      // Beyond the critical angle the surface mirrors the water column, which
      // reads as a shifting sheet of caustic light.
      float caus = wcaustics(vWorld.xz * 0.35 + N.xz * 2.0, wTime * 1.3);
      col = murk * (1.0 + caus * 1.4 * wSunAbove);
    }
    vec3 uT = normalize(vec3(wWindDir.x, 0.0, wWindDir.y) - N * dot(N, vec3(wWindDir.x, 0.0, wWindDir.y)) + vec3(1e-5));
    col += wSunColor * wGGXAniso(N, V, L, uT, cross(N, uT), 0.22, 0.10) * 0.18 * wSunAbove;
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  // ---- microfacet width ---------------------------------------------------
  // Slope variance the mesh and the detail maps could not resolve at this
  // distance, converted to a GGX width by alpha^2 = 2*sigma^2. The floors are
  // the capillary ripple no map ever resolves — about 0.04 upwind — so the near
  // field keeps a tight, readable glint and the far field opens out to the full
  // Cox-Munk width rather than to an arbitrary multiple of it. Computed here
  // rather than next to the specular because the *reflection* needs it too.
  vec3 windAxis = normalize(vec3(wWindDir.x, 0.0, wWindDir.y) + vec3(1e-5));
  vec3 T = normalize(windAxis - N * dot(N, windAxis));
  vec3 B = cross(N, T);
  vec2 mss = wSlopeVariance(gustWind) * unres;
  // Plus the mesh's own unresolved curvature, converted to the same units. Both
  // contributions are variances, so they add.
  float aGeo = min(2.0 * normalVar, 0.20);
  // ...and the KEY LIGHT'S OWN SOLID ANGLE. A source of angular radius r spreads
  // the set of facet slopes that can reflect it into the eye by r/2, and that is
  // a hard floor on how tight the glitter lobe can physically be. For the sun
  // (0.27 deg) it is nothing next to the capillary ripple; for Masser, which
  // subtends several degrees, it is what makes the moonglade a soft broad band
  // rather than a thread, and it is also what keeps a mirror-calm near field from
  // resolving the lobe onto isolated pixels.
  float aSrc = 0.5 * wKeyAngle * wKeyAngle;
  float ax = sqrt(2.0 * mss.x + 0.0016 + aGeo + aSrc);
  float ay = sqrt(2.0 * mss.y + 0.0007 + aGeo + aSrc);
  float rough = sqrt(0.5 * (ax * ax + ay * ay));

  // ---- the sky this pixel MIRRORS, as the frame actually drew it ------------
  //
  // A sea seen at a grazing angle is, in the limit, a mirror: at NdotV -> 0 the
  // Fresnel term is one and every photon leaving the surface toward the eye came
  // from the sky at the specularly mirrored direction. That direction is the eye
  // ray reflected about y = 0 — for any fragment below the horizon it points
  // just ABOVE the horizon, which is sky and nothing else.
  //
  // The frame already contains that sky. The refraction target is the same scene
  // from the same eye with the sea removed, and the sky dome is a small sphere
  // pinned to the camera and drawn at the far plane, so a direction maps to the
  // dome's pixel simply by projecting a point along it. Wherever that texel's
  // depth comes back cleared, the tap is a direct measurement of the sky the
  // frame is showing — cloud deck, horizon glow, sunset band and all — with no
  // second model of the atmosphere involved.
  //
  // Sampled at the MIRROR direction rather than at this fragment's own screen
  // position on purpose: below the horizon the dome draws its analytic ground
  // disc, not sky, and converging the sea onto an ash-albedo ground disc is a
  // different wrong answer from the one this replaces.
  //
  // Two things below need it, and both are places where the atmosphere's own
  // model of the sky and the sky it draws are allowed to disagree: the analytic
  // reflection fallback, and the value the aerial integral saturates on.
  vec3 bgDir = normalize(vec3(vViewDir.x, max(-vViewDir.y, 0.004), vViewDir.z));
  vec4 bc = wRefrVP * vec4(cameraPosition + bgDir * 500.0, 1.0);
  vec2 buv = bc.xy / max(abs(bc.w), 1e-4) * 0.5 + 0.5;
  vec3 bgTap = texture2D(wRefrTex, clamp(buv, 0.002, 0.998)).rgb;
  float bgRaw = texture2D(wRefrDepth, clamp(buv, 0.002, 0.998)).x;
  // In frame, in front of the eye, and nothing opaque drawn there.
  vec2 be = step(vec2(0.004), buv) * (vec2(1.0) - step(vec2(0.996), buv));
  float bgOk = wRefrValid * step(0.0, bc.w) * be.x * be.y * step(0.999995, bgRaw);

  // ---- reflection ---------------------------------------------------------
  vec3 R = reflect(-V, N);
  vec4 rc = wReflVP * vec4(vWorld, 1.0);
  vec2 ruv = rc.xy / max(abs(rc.w), 1e-4) * 0.5 + 0.5;
  // Distortion in screen space must shrink with distance or the far field
  // smears; 6 cm of slope at 1 m is a whole screen at 1 km.
  ruv += N.xz * (0.075 / (1.0 + vDist * 0.010));

  // Unresolved slope does not *delete* the reflection, it blurs it: the pixel
  // covers many facets, so it integrates the target over the cone they span.
  // Fading the tap out instead — which is what the old gloss term did, to zero
  // by about 250 m — replaced every reflection past the near field with a
  // two-colour analytic gradient. That is the whole reason the bay rendered as
  // a flat diffuse plane with no tower, no dune and no sky structure in it.
  // The cone half-angle is the GGX width; dividing by the target's angular
  // pixel size gives the footprint in reflection texels, and log2 of that is
  // the mip that averages exactly those texels.
  // Capped at two and a half mips. The physically-correct cone for a
  // wind-roughened sea is far wider than that, but the mip chain averages the
  // whole target — sky above the mirrored horizon, land below it — and past
  // this point it hands back a single flat grey, which is worse in every way
  // than a slightly-too-sharp reflection that at least still contains the
  // tower, the dune and the cloud deck.
  float lod = min(2.5, log2(1.0 + rough * wReflPix * 0.12));
  float rOk;
  vec4 rTap = boxSampleLod(wReflTex, ruv, lod, rOk);

  // The sky this fragment reflects: the atmosphere's own integral along the
  // reflected ray, seeded with the measured dome radiance so the contrast floor
  // in the aerial chunk returns sky rather than subtracting a fixed fraction of
  // it. (Substituting the measured tap for the integral outright was tried and
  // is not an improvement — the tap is a point sample of a dome that carries the
  // key light's disc and aureole, and the microfacet lobe below already owns
  // those, so the two double-count along the whole glitter path.)
  vec3 skyCol = wSkyRadiance(R, L, bgTap * bgOk);

  // Composite the planar target OVER the analytic sky using the target's own
  // coverage, rather than trusting it wherever the reprojection happens to land.
  //
  // The mirror pass only ever contains geometry: the sky dome is a 10 m sphere
  // parented to the main camera, and the mirror eye is two camera-heights below
  // it, so above about five metres of freeboard the mirror camera is outside the
  // dome and renders no sky whatsoever. Treating that emptiness as a reflection
  // is what made the night sea reflect 0.0005 against a sky of 0.017 — near
  // black under a lit sky, and a step at the horizon in the wrong direction.
  //
  // The mip chain averages alpha alongside colour, so a partly-covered tap
  // arrives coverage-premultiplied; dividing it back out recovers the mean
  // radiance of whatever WAS there and leaves the rest to the sky integral. That
  // integral is the atmosphere's own — measured at 0.015 against the dome's
  // 0.017 in the same frame — so the sea and the sky meet with nothing between
  // them regardless of how the sky subsystem chooses to draw itself.
  float reflCov = wsat(rTap.a) * rOk * wReflValid * step(0.0, rc.w);
  // ...and only out to the range where the mirror pass actually holds an answer.
  //
  // Past a few kilometres the reflected ray is within a fraction of a degree of
  // the horizontal, so the texels it lands on are the last row or two of the
  // mirror target — the mirrored coastline compressed into nothing — and a
  // mip-2.5 tap of that row is one smeared band of land stretched along the
  // whole horizon. Reprojecting a point tens of kilometres out through the
  // mirror's projection is badly conditioned there as well. Measured on the dusk
  // frame the tap came back 40% brighter than the sky integral at the same
  // direction and drove the last rows of sea to twice the radiance of the sky
  // above them, which is the horizon step from the bright side. Everything at
  // that range reflects sky and only sky, so hand it to the sky.
  reflCov *= 1.0 - smoothstep(2500.0, 7000.0, vDist);
  vec3 reflCol = rTap.rgb * (reflCov / max(rTap.a, 1e-4)) + skyCol * (1.0 - reflCov);

  // ---- refraction ---------------------------------------------------------
  vec4 fc = wRefrVP * vec4(vWorld, 1.0);
  vec2 fuvBase = fc.xy / max(abs(fc.w), 1e-4) * 0.5 + 0.5;

  float shallowK = wsat(column * 0.55);

  vec2 fuv = fuvBase + N.xz * (0.055 * shallowK / (1.0 + vDist * 0.006));
  float dOk;
  vec3 sceneCol = boxSample(wRefrTex, fuv, dOk);
  vec3 sceneStraight = texture2D(wRefrTex, clamp(fuvBase, 0.002, 0.998)).rgb;
  sceneCol = mix(sceneStraight, sceneCol, dOk);

  // Geometric depth against everything (rocks, piers, actors), used only for
  // the soft intersection so nothing gets a hard z-clip line.
  //
  // The gap is only MEANINGFUL where the depth pass actually resolved something.
  // Its far plane is a few hundred metres past the shoreline it exists to serve,
  // so over open water it clears to 1.0, and linearDepth of a cleared texel is
  // that far plane — a value NEARER than any sea past it. Fed straight into the
  // soft-intersection ramp, that reads as "the water is behind solid geometry"
  // and erases it: measured, the sea went to alpha 0 in every row beyond 1.4 km,
  // i.e. everything from four pixels below the horizon upward. That is why a
  // coast shot had no horizon line and no water between the headlands — the band
  // there was the sky and the far shore showing through a hole in the ocean — and
  // it is the same hole that put a hard step at the sea/sky junction at night.
  //
  // Two ways for the pass to know nothing: it drew nothing at this texel, or the
  // surface point is past its far plane in the first place. Either way the only
  // honest answer is "no geometry in the way".
  //
  // The second test is against vDist rather than against the reprojected depth,
  // because the reprojection of a point tens of kilometres out through a 1.4 km
  // projection is 1400.1 - 1400.096 in single precision: the answer is whatever
  // survives the cancellation. vDist is the true eye distance carried down from
  // the vertex stage, and it is never smaller than the view-space depth, so the
  // gate is conservative in the safe direction.
  float rawFloor = texture2D(wRefrDepth, clamp(fuv, 0.002, 0.998)).x;
  float floorZ = linearDepth(rawFloor);
  float surfZ = linearDepth(fc.z / max(abs(fc.w), 1e-4) * 0.5 + 0.5);
  float floorKnown = (1.0 - step(0.999995, rawFloor)) * (1.0 - step(wRefrNearFar.y * 0.98, vDist));
  float geomGap = mix(1.0e6, max(floorZ - surfZ, 0.0), floorKnown);

  // Beer-Lambert along the refracted ray rather than straight down.
  vec3 Rr = refract(-V, N, 1.0 / 1.333);
  float pathLen = column / max(abs(Rr.y), 0.22);
  pathLen = min(pathLen, 90.0);
  vec3 transmit = exp(-wExtinction * pathLen);

  // Caustics land on the bed, so evaluate them where the ray actually hits.
  vec2 bedXZ = vWorld.xz + Rr.xz * pathLen;
  float caus = wcaustics(bedXZ * 0.42, wTime) * exp(-column * 0.20) * wSunAbove;
  sceneCol *= 1.0 + caus * 2.1;

  // ---- irradiance delivered INTO the column --------------------------------
  //
  // The key light has to cross the surface before it can scatter, and at a low
  // sun almost none of it does: Fresnel at three degrees of elevation turns 74%
  // of it straight back out to sea, and the cosine projection takes most of what
  // is left. Feeding the column wSunColor * 0.35 regardless of elevation —
  // which is what this did — handed the water body the key light's own chroma,
  // and since wScatter then only *tints* that product, the sea came out the
  // colour of the light in front of it. Measured on the sunset frame: a water
  // body of (0.061, 0.069, 0.054), i.e. neutral beige, sitting under a sunset it
  // was supposed to be absorbing. That is the "featureless beige disc with no
  // depth-absorption gradient" and the "sea the same hue as the sky" finding,
  // and no amount of retuning wScatter fixes it, because the error is in the
  // irradiance and not in the albedo.
  //
  // With the transmission in, what survives into the water at a low sun is the
  // SKY's downwelling, which is blue — which is exactly why a real sea goes
  // darker and bluer as the sun sets instead of following it warm.
  float cosSun = max(L.y, 0.0);
  float Fsurf = 0.02 + 0.98 * pow(1.0 - cosSun, 5.0);
  // Half, because only the downward hemisphere of the sky's irradiance enters
  // and the backscattered fraction leaves through the same rough interface.
  vec3 Edown = (wAmbient + wSunColor * cosSun * (1.0 - Fsurf) * wSunAbove) * 0.5;

  vec3 waterBody = sceneCol * transmit + wScatter * Edown * (1.0 - transmit);
  vec3 refrCol = mix(wDeepTint * Edown, waterBody, wRefrValid);

  // ---- fresnel + specular -------------------------------------------------
  float F0 = 0.020;
  // Fresnel against a ROUGH surface. Schlick on the macro normal drives to 1.0
  // at grazing, and a shoreline shot is nothing but grazing angles — that is
  // what buried the water column entirely, so the bay carried no depth
  // gradient and no wet/dry read at all. On a wind-roughened sea the facets
  // that would have to be exactly grazing are shadowed by their neighbours, so
  // the grazing limit is capped at (1 - roughness), the standard rough-Fresnel
  // correction. With the far field at roughly 0.25 that hands about a quarter
  // of the radiance back to the body of the water, which is where Beer-Lambert
  // finally becomes visible.
  //
  // Half the roughness, not all of it. The full (1 - roughness) form comes from
  // prefiltered image-based lighting, where the reflection has already been
  // averaged over the whole lobe; on a real sea at grazing incidence the facets
  // you can still SEE are the ones tilted toward you, and the light meets those
  // at a high angle anyway, so the directional albedo runs close to unity. At
  // roughness 0.19 the full form took a fifth of the sky's radiance out of the
  // horizon and put nothing back — a ten-percent dark band along the join, for
  // the same reason the old grazing-Fresnel-of-1.0 buried the shallows. Near the
  // shore, where the water column has to read, roughness is small and NdotV is
  // not grazing, so this changes almost nothing there.
  //
  // ...and the cap itself has to relax back to unity at TRUE grazing. The
  // shadowing argument that justifies capping it is an argument about facets you
  // can still see at a moderate angle; as NdotV goes to zero the only facets
  // with any projected area left are the ones tilted toward the eye, the light
  // meets those near normal incidence, and the directional albedo of a rough
  // dielectric runs to one. Holding the cap at 1 - rough/2 all the way down
  // instead left the last rows of sea before the horizon reflecting three
  // quarters of the sky and handing the rest to a water body that is nearly
  // black — a dark band along the join, which is the same instant fail from the
  // other side. The relaxation uses the same Schlick power, so it is continuous
  // and changes nothing anywhere the cap was doing useful work.
  float gz = pow(1.0 - NoV, 5.0);
  float cap = mix(max(1.0 - rough * 0.5, F0), 1.0, gz);
  float F = F0 + (cap - F0) * gz;

  // No fudge factor. wSunColor is the key light's irradiance and wOceanSpec is a
  // normalised BRDF, so anything multiplying the pair is inventing energy — the
  // 1.6 that used to sit here was 60% of it.
  float spec = wOceanSpec(N, V, L, T, B, ax, ay);
  // Energy bound, not a magic number. wSunColor is the source's IRRADIANCE, so
  // the radiance the water can send back is at most E / solid-angle-of-source —
  // a mirror. Anything above that is the BRDF's delta limit landing on a single
  // pixel, which is the coarse specular sparkle along the waterline. The bound
  // is only ever reached where the surface is locally near-mirror, so it clips
  // fireflies without touching the glitter path, whose peak sits well under it.
  spec = min(spec, 1.0 / max(WPI * wKeyAngle * wKeyAngle, 1e-6));

  // ---- subsurface on backlit crests ---------------------------------------
  // vCrest is in standard deviations of surface elevation; light gets through
  // the water from behind on the upper part of a wave, so gate from ~0.6 sigma.
  float steep = wsat((1.0 - vJac) * 1.6);
  float lift = wsat((vCrest - 0.6) * 0.7);
  float back = pow(wsat(dot(V, -L + N * 0.55)), 3.0);
  vec3 sss = wScatter * wSunColor * (back * lift * (0.35 + steep) * 3.4 * wSunAbove);

  vec3 col = mix(refrCol + sss, reflCol, F);
  col += wSunColor * spec * F;

  // ---- foam ---------------------------------------------------------------
  vec2 wdir = normalize(wWindDir + vec2(1e-5));

  // Every shoreline term below is integrated against footprint and colFw.
  // Without that, the surf band — which is a fixed width in metres of water
  // column — collapses under a pixel at a grazing view while still returning
  // full brightness, and the erosion threshold turns that into isolated on/off
  // pixels: a hashed-alpha stipple in everything but name, which is exactly
  // what ran unbroken along both banks.
  vec4 fA = texture2D(wFoam, vWorld.xz / 6.1 + wdir * wTime * 0.030);
  vec4 fB = texture2D(wFoam, wrot(1.9) * vWorld.xz / 1.63 + wdir * wTime * 0.085);
  float sheet = fA.r * 0.6 + fB.r * 0.4;
  float thresh = fA.a * 0.55 + fB.a * 0.45;
  // How much of the threshold texture this pixel can still resolve. Past that
  // the tap is a mip average and comparing against it is a per-pixel coin
  // flip. The compare is therefore crossfaded out with the contrast that feeds
  // it, leaving the raw analog coverage — the erosion tears the *near* edge,
  // where there is detail to tear, and does nothing at all where there is not.
  float tRes = wsat(1.0 - footprint / 1.63) * 0.55 + wsat(1.0 - footprint / 6.1) * 0.45;

  // Whitecaps need both a raised crest and a folding Jacobian; either alone is
  // just a swell, and foaming on crest height alone frosts the whole sea.
  // Monahan puts measurable whitecap coverage from about 4 m/s, not 6. The
  // crest gate is in sigma: breaking starts around 1.1 sigma of elevation, and
  // the Jacobian decides whether that crest is actually folding over.
  float crestFoam = smoothstep(1.05, 2.05, vCrest) * wfall(0.90, 0.34, vJac) * smoothstep(3.5, 11.0, wWindSpeed);
  // Depth-below-water shoreline mask: the surf band is as wide as the run-up.
  // Two overlapping bands — a bright inner swash right at the waterline and a
  // wider outer band over the breaker zone — so the surf reads as a line rather
  // than as an even wash across the whole shallows. Both are box-filtered
  // against colFw, so a band the pixel only partly covers contributes only its
  // share instead of firing at full value.
  //
  // The band's width in water column is NOT a constant. Iribarren: the surf zone
  // is as wide as the wave takes to dissipate, so a gentle bed spreads a
  // spilling breaker over a long shallow run and a steep bed collapses it into a
  // plunging line right at the waterline. Driving the thresholds off the local
  // bed gradient is what turns a piped bead of constant width into a shore that
  // changes character with the ground under it — and it is also what stops a
  // lagoon whose far edge drops into deep water from carrying the same rope of
  // foam as its beach, because there the gradient is steep and the band closes.
  float bedAhead = wTerrainHeight(vWorld.xz + wdir * 6.0);
  float bedBehind = wTerrainHeight(vWorld.xz - wdir * 6.0);
  float grad = abs(bedAhead - bedBehind) / 12.0;
  // 1 on a beach flatter than ~1:14, falling to a third on anything cliff-like.
  float surfWidth = mix(1.0, 0.30, wsat(grad * 3.6));
  // ...and a narrower band is a BRIGHTER one, not an absent one.
  //
  // Iribarren narrows the surf zone on a steep bed; it does not stop the wave
  // breaking. The same energy is dissipated over less water, so the foam
  // concentrates. Without saying so the two filters below multiply: wBelowAA
  // scales a band by the fraction of the pixel it covers (correct, and the only
  // thing stopping a sub-pixel surf line from stippling), and surfWidth shrinks
  // the band before it gets there — so on a steep shore seen at a grazing angle
  // the product went to a few percent and the sea met the rock at a bare
  // polygon edge with no surf on it at all. That is the night inlet finding.
  // Compensating by the square root keeps the foam's integral across the shore
  // roughly constant while still letting the LINE get thinner, which is what
  // separates a plunging break from a spilling one.
  float surfGain = inversesqrt(surfWidth);
  float shoreBand = (wBelowAA(column, 0.55 * surfWidth, colFw) * 0.78
                  +  wBelowAA(column, 2.20 * surfWidth, colFw) * 0.34) * surfGain;
  // Breaking is driven by shoaling, so lift the band where the bed is rising
  // fastest under the wave. A mild boost, not a gate: a gentle beach is where
  // the run-up reaches furthest, not where it disappears.
  float shoal = wsat((bedAhead - bedBehind) * 0.30);
  // Swash: the run-up line advances and retreats with the long swell.
  float swash = 0.45 + 0.85 * wsat(0.5 + wGerstnerHeight(vWorld.xz * 0.35, wTime, 1.0) * 0.55);
  // Advection: the sheet is carried shoreward and torn apart as it goes, so the
  // band breaks into scallops with a dissipation tail rather than tracing the
  // contour at constant brightness.
  float scallop = 0.55 + 0.90 * fA.b;
  float shoreFoam = shoreBand * swash * (0.85 + 0.45 * shoal) * scallop;

  // Analytic screen coverage of the water surface itself, not a fixed 0.42 m
  // feather: at a grazing view one pixel spans several metres of column, and a
  // feather narrower than that leaves the waterline as a hard stair-stepped
  // vector cut.
  //
  // Foam is a fraction *of the water surface*, so it multiplies this rather
  // than overriding it. Forcing alpha up to 0.85 wherever foam fired — which is
  // what this did — is what let a pixel that is fifteen percent water come out
  // as full-brightness white with the terrain still visible around it, i.e. the
  // 1-bit checker along both banks.
  float fadeTerrain = wRampAA(column, 0.42, colFw);
  float fadeGeom = wRampAA(geomGap, 0.55, colFw);
  float alpha = wsat(min(fadeTerrain, mix(1.0, fadeGeom, wRefrValid)));

  float coverage = wsat(max(crestFoam, shoreFoam)) * wFoamAmount;
  float cov = wsat(coverage * (0.22 + 1.05 * sheet));
  // The erosion threshold tears the edge; it must not also veto the sheet, so
  // the ramp is centred on the coverage rather than sitting above it — and it
  // is only applied to the extent the texture that drives it is resolvable.
  float foam = mix(cov, smoothstep(thresh - 0.26, thresh + 0.26, cov), tRes);
  foam *= 1.0 - smoothstep(1400.0, 4000.0, vDist);

  // Foam is a dense bubble raft: a bright *diffuse* medium, not an emitter. It
  // has to obey the same N.L and the same sun/moon irradiance as everything
  // else in the frame, or it clips to paper white by day (it was reading 250,
  // 250, 240 against terrain at 90, 70, 40) and floats free of the moon at
  // night. A wrapped term stands in for the multiple scattering inside the
  // raft, which is what keeps it from going black on the shadowed side.
  float foamWrap = wsat((dot(N, L) + 0.35) / 1.35);
  // 1/pi, not a hand-picked multiplier: wFoamColor is the raft's albedo and
  // wSunColor its irradiance, so anything larger is inventing energy — which is
  // how a shoreline ended up as clipped 250,250,240 white against terrain at
  // 90,70,40 with a low sun.
  vec3 foamCol = wFoamColor * (wAmbient * 1.15 + wSunColor * foamWrap * 0.32 * wSunAbove);
  // Sub-pixel bubble shading: the speckle channel keeps foam from reading flat.
  foamCol *= 0.78 + 0.42 * (fA.g * 0.5 + fB.g * 0.5);
  col = mix(col, foamCol, foam);


  // ---- aerial perspective --------------------------------------------------
  //
  // Aerial perspective, from the same uniform block and the same integral the
  // sky dome and the terrain use, evaluated against the *true* path length —
  // which past the compression knee is tens of kilometres, and that is what lets
  // the last rings saturate into the sky instead of ending in a wall.
  //
  // It is applied to the CONTRAST against the background, not to the absolute
  // radiance, and that is the whole of the fix for the dark bar at the horizon.
  //
  // applyAerial is affine in its input colour: applyAerial(c) = c*Tf + K, with
  // Tf the (contrast-floored) transmittance and K the atmosphere's own airlight.
  // Calling it once therefore says that this surface converges, at infinite
  // optical depth, on K/(1-Tf) — the FOG MODEL's asymptote. For every other
  // surface in the game that costs nothing, because nothing else is more than a
  // couple of kilometres away and Tf never approaches its floor. The sea is an
  // infinite plane: its far rings sit tens of kilometres out with the path fully
  // saturated, so they land exactly on that asymptote — and the asymptote is not
  // the sky the dome draws. Measured on the dusk frame at 19.8h, the saturated
  // aerial value is 52% of the dome's own radiance one degree above the same
  // horizon (the sky-view table the fog converges on carries no cloud deck,
  // while the dome composites one), which drew a 13-row bar at y 588-600 sitting
  // at 25/255 between a sky of 42 and a sea of 61. Art bible #9, from the one
  // subsystem that can actually reach optical infinity.
  //
  // Evaluating the same function on the BACKGROUND as well and differencing
  // takes the asymptote out of the answer entirely:
  //
  //     out = A(col) - A(bg) + bg  =  col*Tf + bg*(1 - Tf)
  //
  // At Tf = 1 that is exactly col, so the near and mid field do not move at all;
  // as the path saturates it converges exactly on bg, whatever bg is and
  // whatever the fog model believes the sky to be. No constant of the sky's is
  // duplicated here and no term is invented — the two calls share every input
  // but the colour, so this is one extra evaluation of a closed-form integral.
  //
  // bg is the drawn sky where the frame gave us one and the analytic reflected
  // sky where it did not; in the latter case the identity degenerates to the
  // sea converging on its own reflection, which is still the right answer, just
  // a less well-measured one.
  vec3 bg = mix(skyCol, bgTap, bgOk);
  col = max(${aerial.call('col', 'vDist', 'vViewDir', 'L')}
          - ${aerial.call('bg', 'vDist', 'vViewDir', 'L')}
          + bg, vec3(0.0));

  // Break residual quantisation. The gradient from the horizon down can cover
  // hundreds of rows for two or three 8-bit steps, which without a dither
  // resolves as flat plateaus with a hard riser between them.
  col *= 1.0 + wIGN(gl_FragCoord.xy) * 0.006;

  gl_FragColor = vec4(col, alpha);
}
`;
}

export interface SurfaceUniforms {
  [name: string]: THREE.IUniform;
}

export function buildSurfaceMaterial(uniforms: SurfaceUniforms, aerial: AerialBinding): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: fragment(aerial),
    transparent: true,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
    lights: false,
  });
}
