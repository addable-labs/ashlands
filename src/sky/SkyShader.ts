import * as THREE from 'three';
import {
  ATMO_R,
  BETA_ASH,
  BETA_MIE_E,
  BETA_MIE_S,
  BETA_OZONE,
  BETA_RAYLEIGH,
  CLOUD_ALBEDO,
  CLOUD_BOTTOM,
  CLOUD_TOP,
  H_ASH,
  H_MIE,
  H_RAYLEIGH,
  MIE_G,
  PLANET_R,
  SUN_E,
  decodeMu,
  transmittance,
} from './Constants';
import { HAZE_GLSL } from './Haze';
import { NOISE_GLSL } from './Noise';

/** IEEE-754 binary32 -> binary16, for the half-float transmittance LUT. */
function toHalf(v: number): number {
  const f = new Float32Array(1);
  const i = new Int32Array(f.buffer);
  f[0] = v;
  const x = i[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 112;
  let mant = x & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant = (mant | 0x800000) >>> (1 - exp);
    return sign | (mant >>> 13);
  }
  if (exp >= 0x1f) return sign | 0x7bff;
  return sign | (exp << 10) | (mant >>> 13);
}

/**
 * 384x96, not 256x64.
 *
 * The review measured concentric arcs of 0.5-1 LSB centred on the sun across the
 * whole ash-storm sky AND continuing over the mountain mass — i.e. in the
 * scattering evaluation, not in the dome geometry. Both the dome's march and the
 * shared aerial block bilinearly interpolate this table, so its node spacing is a
 * slope discontinuity in every scattering term that reads it. Below the 8-bit
 * visibility threshold today, but it surfaces on HDR and under any brightness
 * lift. 1.5x the texels in mu and 1.5x in altitude puts the second-derivative
 * error a factor of ~2.2 down for ~0.2s of extra boot.
 */
const LUT_W = 384;
const LUT_H = 96;

/**
 * Transmittance from any altitude/sun-angle to the top of the atmosphere.
 * Baked once on the CPU: the sky march needs this at every step and computing
 * it inline would mean a nested integral per pixel. mu is square-root warped so
 * the horizon, where transmittance falls off a cliff, gets the texel density.
 */
export function buildTransmittanceLUT(): THREE.DataTexture {
  const data = new Uint16Array(LUT_W * LUT_H * 4);
  let i = 0;
  for (let y = 0; y < LUT_H; y++) {
    const r = PLANET_R + ((y + 0.5) / LUT_H) * (ATMO_R - PLANET_R);
    for (let x = 0; x < LUT_W; x++) {
      const mu = decodeMu((x + 0.5) / LUT_W);
      const T = transmittance(r, mu);
      data[i++] = toHalf(T[0]);
      data[i++] = toHalf(T[1]);
      data[i++] = toHalf(T[2]);
      data[i++] = toHalf(1);
    }
  }
  // Fail loudly rather than binding a zeroed texture: a zero LUT makes every
  // scattering term integrate to nothing and the whole dome renders black,
  // which is indistinguishable from "the sky pass never ran". The zenith of the
  // top row must transmit essentially everything.
  const zenith = transmittance(ATMO_R - 1, 1);
  if (!(zenith[0] > 0.5 && zenith[1] > 0.5 && zenith[2] > 0.5)) {
    throw new Error(
      `sky: transmittance LUT degenerate (top-of-atmosphere zenith = ${zenith.join(', ')}) — ` +
        'check the scattering coefficients in Constants.ts',
    );
  }

  const tex = new THREE.DataTexture(data, LUT_W, LUT_H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Pin to the far plane so the dome never clips and always loses the depth
  // test against real geometry, giving us free early-z on covered pixels.
  gl_Position = clip.xyww;
}
`;

/** Fullscreen triangle for the half-resolution cloud pass. */
const PASS_VERT = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;

uniform mat3 uCamBasis;     // camera world rotation
uniform vec2 uTanHalf;      // tan(fovX/2), tan(fovY/2)
// 1 / half-res buffer size. Used for the jittered upsample fetch, and — because
// uTanHalf.y * uCloudTexel.y is exactly the angle one FULL-resolution screen
// pixel subtends — as the filter width for every analytically antialiased point
// or disc in this shader. Declared for both programs: the star and moon code is
// shared source and the cloud pass compiles it too.
uniform vec2  uCloudTexel;
// Both offscreen passes (the half-res cloud march and the sky-view table) are
// fullscreen triangles and address themselves in NDC; only the dome itself has a
// world-space hull behind it.
#if defined(CLOUD_PASS) || defined(SKYVIEW_PASS)
varying vec2 vNdc;
#else
varying vec3 vWorld;
uniform sampler2D uCloudBuf;
uniform float uCloudMode;   // 1 = read the half-res buffer, 0 = march inline
#endif

uniform vec3  uSunDir;
uniform vec3  uSunTint;       // weather/haze tint applied to direct sunlight
uniform float uSunE;
uniform float uSunAng;
uniform sampler2D uTrans;
uniform float uCamY;

uniform vec3  uBetaR;
uniform vec3  uBetaMS;
uniform vec3  uBetaME;
uniform vec3  uBetaO;
uniform vec3  uBetaA;       // suspended ash: absorption only, never a source
uniform vec3  uScaleH;      // scale heights (rayleigh, mie, ash)
uniform float uMieG;
uniform float uMieMul;
uniform float uMsBoost;
uniform vec3  uGroundAlbedo;
uniform vec3  uSkyAmbient;    // CPU-estimated hemispheric irradiance
uniform float uExposure;
/**
 * 1 while the dome is being rendered into the environment cube for the IBL.
 *
 * The IBL is the *indirect* half of the lighting and the directional light is
 * the direct half; the solar disc and its aureole belong to the second, so they
 * must not appear in the first. Leaving them in is not a small error — the disc
 * alone carries ~0.28 of irradiance and the aureole several units, against a
 * whole-sky irradiance near 0.14, so an environment captured with them in it is
 * dominated by the sun's own spectrum and the "ambient" becomes a scaled copy of
 * the key. That is precisely the state this uniform exists to end: with the
 * solar term removed, what the cube integrates is the sky's own radiance, which
 * has a different spectrum from the beam by construction.
 */
uniform float uEnvCapture;

uniform vec3  uMasserDir;
uniform vec3  uSecundaDir;
uniform vec2  uMoonAng;
uniform vec3  uMasserTint;
uniform vec3  uSecundaTint;
uniform vec2  uMoonBright;    // per-disc radiance scale (masser, secunda)
uniform vec3  uMasserLight;   // moonlight reaching the column, sun-equivalent
uniform vec3  uSecundaLight;

uniform mat3  uStarFrame;
uniform float uStarBright;
uniform float uTime;

uniform sampler3D uCloudTex;
uniform sampler2D uWeather;
uniform vec2  uCloudWind;
/**
 * Wind direction times the deck's shear rate, metres of downwind displacement
 * per unit of normalised cloud height. Without it every billow is radially
 * symmetric about its own column and the deck reads as a scatter of lozenges
 * rather than as a wind-driven sky.
 */
uniform vec2  uCloudShear;
uniform float uCoverage;
uniform float uCloudDensity;
uniform float uCloudType;
uniform float uCloudBottom;
uniform float uCloudTop;
uniform int   uCloudSteps;
uniform int   uLightSteps;
uniform vec3  uCloudLightDir; // sun by day, the brighter moon by night
/**
 * Angular RADIUS of whatever uCloudLightDir points at, radians. 0.0125 for the
 * sun, 0.075 for Masser. Every forward-scattering lobe in the cloud and veil
 * passes is widened by it (see srcG) — without that, a four-degree moon is fed
 * through a two-degree lobe and the result is a blown blob welded to the disc.
 */
uniform float uCloudSrcAng;
/**
 * That same body's own peak radiance. Ceiling for what the deck and the veil may
 * scatter back (see capToSource): effectively infinite by day, and Masser's own
 * capped disc value at night.
 */
uniform float uCloudKeyMax;
uniform vec3  uCloudSun;      // key-light radiance at cloud altitude
uniform vec3  uCloudAmb;      // sky radiance lighting the cloud tops
uniform vec3  uCloudAmbDn;    // ground bounce lighting the cloud bases
uniform float uLightning;
uniform float uCirrus;      // high ice/ash veil coverage, 0..1
uniform vec3  uCirrusSun;   // key irradiance at 7.4km — NOT the deck's beam
uniform vec3  uCirrusSkyUp; // radiance of the clean Rayleigh column above it
uniform vec3  uCirrusSkyDn; // radiance of the planet under it
uniform vec2  uWindDir;     // unit horizontal wind vector; the veil's shear axis
uniform vec3  uHazeTint;
uniform vec3  uHazeDeep;   // albedo of the particulate layer's dense base
uniform float uHazeDensity;
uniform float uHazeH;
uniform vec3  uHazeSun;    // key radiance below the deck; == uAerialSunColor
uniform vec3  uHazeSunDir; // key direction below the deck; == uAerialSunDir
uniform vec2  uHazeWind;   // advection of the storm's sheets; == uAerialHazeWind

const float PI = 3.141592653589793;
const float Rg = ${PLANET_R.toFixed(1)};
const float Rt = ${ATMO_R.toFixed(1)};

${NOISE_GLSL}
${HAZE_GLSL}

/**
 * The stochastic offset every dithered sample in this shader uses.
 *
 * igNoise on its own is an ORDERED, screen-locked pattern — an interleaved
 * gradient, which is a rotated Bayer grid by another name. Frozen in place it is
 * exactly the "unmistakable checkerboard texel pattern with 2-4px diagonal
 * stair-stepping" the review measured through every cloud edge: TAA cannot
 * integrate an error that is identical on every frame, so the pattern survives
 * the resolve instead of averaging out.
 *
 * Adding a per-frame golden-ratio rotation makes the sequence low-discrepancy in
 * TIME as well as in space. Successive frames land on different points of the
 * step interval, the residual becomes high-frequency and zero-mean, and TAA
 * resolves it into a smooth density integral. Costs one fract.
 */
float ditherBN(vec2 px) {
  float f = fract(uTime * 60.0);
  return fract(igNoise(px + vec2(f * 71.31, f * 113.17)) + f * 0.6180339887);
}

float hgPhase(float c, float g) { return hazeHG(c, g); }
float rayleighPhase(float c) { return (3.0 / (16.0 * PI)) * (1.0 + c * c); }

/**
 * Henyey-Greenstein asymmetry, widened for a source of finite angular radius.
 *
 * A phase function is only ever observed CONVOLVED with the source lighting it,
 * and that matters the moment the source stops being a point. The sun is 0.7
 * degrees of radius, so for it the convolution is a rounding error and every
 * lobe in this shader is effectively exact. Masser is 4.3 degrees of radius —
 * six times wider — and the deck's silver-lining lobe (g = 0.96) has a half
 * width of 2.2 degrees, i.e. it is NARROWER THAN THE MOON. Evaluating it as
 * though the moon were a point claims a forward peak that no source in this sky
 * can deliver, and it is the whole of the "malformed glow blob attached to
 * Masser that a viewer reads as damage" defect: a single cumulus puff sitting a
 * few degrees off the disc was returning 28x isotropic against the 0.019 the
 * rest of the deck was getting, i.e. a five-hundred-fold local spike, which
 * clipped to white and fused itself to the moon.
 *
 * Widening rather than clamping, because the energy is real — it just arrives
 * over the source's cone instead of over the lobe's. The HG half width at half
 * maximum is 0.766 * (1 - g) / sqrt(g) for g near 1; add the source radius in
 * quadrature and invert (s = sqrt(g) solves s^2 + k s - 1 = 0). Integral is
 * preserved by construction, so the deck's total response to the beam is
 * untouched and only the peak comes down.
 *
 * Meaningless for a backward lobe and not used there — g must be positive.
 */
float srcG(float g, float alpha) { return hazeSrcG(g, alpha); }

/**
 * Hue-preserving soft limit of a scattered radiance against the radiance of the
 * body that lit it. A passive scatterer returns at most what falls on it, so a
 * cloud CANNOT out-shine the disc beside it; when it does, the frame reads as
 * damage rather than as weather. Rolls the max channel off with a Reinhard
 * shoulder and scales all three by the same factor, so chromaticity is fixed.
 *
 * Inert by day: uCloudKeyMax carries the solar disc's own radiance, which is
 * three orders of magnitude above anything the deck can return.
 */
vec3 capToSource(vec3 c, float maxR) {
  float m = max(c.r, max(c.g, c.b));
  return c * (m / (1.0 + m / maxR)) / max(m, 1e-6);
}
float remap(float v, float a, float b, float c, float d) {
  return c + (clamp(v, a, b) - a) * (d - c) / max(b - a, 1e-5);
}

vec2 lutUV(float r, float mu) {
  float h = clamp((r - Rg) / (Rt - Rg), 0.0, 1.0);
  float s = mu < 0.0 ? -1.0 : 1.0;
  return vec2(clamp(0.5 + 0.5 * s * sqrt(abs(mu)), 0.001, 0.999), h);
}
vec3 sunTransmittance(float r, float mu) { return texture(uTrans, lutUV(r, mu)).rgb; }

float distToTop(float r, float mu) {
  float d = r * r * (mu * mu - 1.0) + Rt * Rt;
  return max(0.0, -r * mu + sqrt(max(d, 0.0)));
}
// Far root of the intersection with a shell of radius R; negative when missed.
float shellFar(float r, float mu, float R) {
  float d = r * r * (mu * mu - 1.0) + R * R;
  if (d < 0.0) return -1.0;
  return -r * mu + sqrt(d);
}
float distToGround(float r, float mu) {
  float d = r * r * (mu * mu - 1.0) + Rg * Rg;
  if (d < 0.0) return -1.0;
  float t = -r * mu - sqrt(d);
  return t > 0.0 ? t : -1.0;
}

vec3 blackbody(float T) {
  float t = clamp(T, 1000.0, 20000.0) / 100.0;
  vec3 c;
  if (t <= 66.0) {
    c.r = 255.0;
    c.g = 99.4708 * log(t) - 161.1196;
    c.b = t <= 19.0 ? 0.0 : 138.5177 * log(t - 10.0) - 305.0448;
  } else {
    c.r = 329.6987 * pow(t - 60.0, -0.13320);
    c.g = 288.1222 * pow(t - 60.0, -0.07551);
    c.b = 255.0;
  }
  c = clamp(c / 255.0, 0.0, 1.0);
  c = c * c * (0.8 + 0.2 * c);          // cheap sRGB -> linear
  return c / max(max(c.r, max(c.g, c.b)), 1e-4);
}

// ---------------------------------------------------------------- stars ----

vec3 starLayer(vec3 d, float scale, float thresh, float sizeMul, float seed, float airmass) {
  vec3 p = d * scale;
  vec3 id = floor(p);
  // Only cells straddling the unit sphere shell can hold a visible star;
  // without this every cell in the volume would project one onto the sky.
  if (abs(length(id + 0.5) - scale) > 0.95) return vec3(0.0);
  float h = hash13(id + seed);
  if (h > thresh) return vec3(0.0);

  vec3 jit = hash33(id + seed + 3.7) - 0.5;
  vec3 q = normalize(id + 0.5 + jit * 0.55);
  float ang = length(d - q);

  float mag = hash13(id + seed + 11.3);
  // A real magnitude distribution: many faint, very few bright. Paired with the
  // energy-conserving PSF below this is a ~200:1 flux range across the field
  // rather than the ~3:1 the old peak-clamped profile actually delivered.
  float bright = pow(mag, 8.0) * 0.995 + 0.005;
  // Tight cores. One screen pixel subtends uTanHalf.y * uCloudTexel.y radians
  // (the cloud texel is half-res, so that product is 2*tanHalfY/height), and the
  // profile is a Gaussian in ang with sigma = size. Anchoring size to the
  // pixel rather than to a constant in radians is what keeps a star a ~2px core
  // at any resolution or field of view instead of a 5px blob at 1080p.
  float px = max(uTanHalf.y * uCloudTexel.y, 1e-5);
  float size = px * (0.78 + 0.55 * pow(mag, 4.0)) * sizeMul;

  // Energy-conserving PSF: the core integrates to a constant, so a faint star
  // gets DIMMER rather than staying white and merely getting narrower. Without
  // the 1/size^2 the whole field rendered at very nearly the same peak value and
  // the magnitude distribution never reached the screen.
  float ref = px;
  float norm = (ref * ref) / (size * size);
  float core = exp(-(ang * ang) / (size * size)) * norm;
  // A faint airy skirt at 2.2x the core width — one soft pixel of halo, no more.
  float halo = 0.045 * exp(-(ang * ang) / (size * size * 5.0)) * norm;
  // No diffraction spikes. A four-point cross drawn at a 5x-core arm length is
  // three or four pixels of axis-aligned bar, and at this scale a plus sign
  // resolves as a square or a rectangle — which is precisely the "axis-aligned
  // square stars" defect. Real naked-eye stars have no spikes; only a camera
  // with a spider vane does, and this frame is not one.
  float shape = core + halo;

  // Scintillation grows with air mass: horizon stars boil, zenith stars sit still.
  float f1 = 4.0 + 9.0 * mag, f2 = 2.7 + 5.0 * h;
  float tw = 1.0 + 0.55 * min(airmass, 6.0) * 0.16 *
             (sin(uTime * f1 + h * 61.0) * sin(uTime * f2 + mag * 113.0));

  // A real field is mostly white with a scattering of orange giants and blue
  // supergiants. The exponent biases the draw toward the blue-white end so the
  // field survives the long slant path through the ash layer — an unbiased
  // draw came out of the atmosphere as a swarm of orange embers, which reads as
  // drifting dust, not as a clear night, and steals the saturation the palette
  // reserves for bioluminescence and lava.
  // Per-star colour temperature over the range a naked eye can actually
  // separate: orange giants at 4000K through blue-white supergiants at 9000K.
  float temp = mix(4000.0, 9000.0, pow(hash13(id + seed + 21.1), 0.72));
  // Scotopic desaturation, but far less of it than before. At mix 0.20 the whole
  // field arrived white, the ash column then reddened all of it by the same
  // amount, and the result read as one uniform sepia — dust specks on a lens
  // rather than a star field. Half the chroma at the faint end and nearly all of
  // it at the bright end is what puts visibly different colours in the sky.
  vec3 chroma = mix(vec3(1.0), blackbody(temp), 0.50 + 0.45 * bright);
  return chroma * shape * bright * max(tw, 0.0);
}

vec3 stars(vec3 dir) {
  // uStarBright is faded to zero by daylight on the CPU, so this single test
  // removes the whole star cost from every daytime pixel.
  if (dir.y < -0.03 || uStarBright < 0.004) return vec3(0.0);
  vec3 d = normalize(uStarFrame * dir);
  float airmass = 1.0 / (max(dir.y, 0.0) + 0.12);

  // Population thresholds roughly a third of what they were. At 0.052/0.016/
  // 0.005 the field carried several thousand discs above the visibility floor
  // over the hemisphere, which is denser than a real dark sky by an order of
  // magnitude and is why the sky read as speckled rather than as stars.
  vec3 c = starLayer(d, 140.0, 0.018, 1.0, 0.0, airmass);
  c += starLayer(d, 310.0, 0.0055, 0.80, 17.0, airmass);
  c += starLayer(d, 620.0, 0.0017, 0.66, 43.0, airmass);

  // A galactic band, tilted off the celestial equator. Dust lanes come from a
  // second, higher-frequency fbm subtracted from the glow.
  //
  // Scale, not shape, is what matters here. Integrated starlight is only about
  // one magnitude per square arcsecond above a dark sky — a couple of times the
  // background, no more. At 0.14 the band peaked around 0.05 radiance against a
  // moonlit sky background of 4e-4, i.e. a hundred times too bright, and since
  // exp(-(dot*3.4)^2) is still 0.35 a third of the way to the galactic pole it
  // was not even confined to a band: it washed the entire hemisphere into a lit
  // sepia field with the stars buried in it. Tighter falloff and a scale that
  // puts the peak a few times over the background instead.
  vec3 pole = normalize(vec3(0.42, 0.63, -0.65));
  // Wide enough to cross the frame as a band rather than as a thread, and bright
  // enough to be seen: at 0.0040 with a 5.2 falloff it sat under the ash haze and
  // 65% of the frame that is sky had nothing in it at all.
  float band = exp(-pow(dot(d, pole) * 3.4, 2.0));
  float g = fbm3(d * 6.0, 4);
  float lanes = smoothstep(0.30, 0.62, fbm3(d * 13.0 + 5.1, 3));
  // Integrated starlight is the average of a whole population, so it is close
  // to white; only the dust reddens it, and the ash column does that already.
  vec3 mw = mix(vec3(0.72, 0.76, 0.88), vec3(0.88, 0.80, 0.70), fbm3(d * 3.0 + 21.0, 2));
  c += mw * band * (0.25 + g * 0.9) * (1.0 - lanes * 0.75) * 0.0125;

  // Hue-preserving ceiling on the peak of the point-spread function.
  //
  // A star is a point source, so its peak is set entirely by the PSF's width —
  // and the energy-conserving profile above puts the brightest stars at ~0.6
  // radiance in a single pixel. At the metered night exposure (4.2, pinned to
  // exposureMaxNight) that is 2.5 in exposed units, which clears the bloom
  // pass's bright-pass threshold of 2.0. The bloom threshold is authored for the
  // sun disc, emissives and specular glints; letting a naked-eye star over it
  // gives every bright star a wide, low, multi-mip halo, and because bloom is
  // composited over the RESOLVED frame that halo lands on top of whatever is in
  // front of the star — which is the "fourteen bright specks inside the black
  // cliff silhouette" and the "stars over the lit cloud deck" the review
  // measured. The stars themselves are correctly depth-tested; their bloom was
  // not, and could not be.
  //
  // Rolling the MAX channel off keeps the chromaticity of every star exactly
  // where the blackbody put it and only moves the brightest few percent of the
  // field, which still lands near display 210 — unmistakably the brightest
  // points in the frame, and now below the threshold at which they smear.
  float mx = max(c.r, max(c.g, c.b));
  c *= (mx / (1.0 + mx / 0.30)) / max(mx, 1e-6);

  return c * uStarBright * smoothstep(-0.03, 0.10, dir.y);
}

// ---------------------------------------------------------------- moons ----

// Crater height field on the unit sphere, with an analytic gradient so the
// normal perturbation costs nothing extra.
float craters(vec3 sp, float freq, float seed, inout vec3 grad) {
  vec3 p = sp * freq;
  vec3 base = floor(p);
  float h = 0.0;
  for (int k = 0; k < 27; k++) {
    vec3 o = vec3(float(k % 3), float((k / 3) % 3), float(k / 9)) - 1.0;
    vec3 cell = base + o;
    vec3 rnd = hash33(cell + seed);
    if (rnd.z > 0.62) continue;                 // sparse: not every cell craters
    vec3 fp = cell + 0.15 + rnd * 0.7;
    vec3 diff = p - fp;
    float d = length(diff);
    float R = 0.28 + 0.62 * rnd.z;
    if (d >= R) continue;
    float u = d / R;
    float rim = exp(-pow((u - 0.80) / 0.16, 2.0));
    float prof = -(1.0 - u * u) * 0.55 + rim * 0.85;
    float dprof = (2.0 * u) * 0.55 + rim * (-2.0 * (u - 0.80) / (0.16 * 0.16)) * 0.85;
    h += prof;
    grad += (diff / max(d, 1e-4)) * (dprof / R) * freq;
  }
  return h;
}

/**
 * Cellular fracture network on the unit sphere: F2 - F1 of a jittered lattice,
 * which is zero exactly on the walls between cells.
 *
 * This is the term that separates a BROKEN body from a merely cratered one. A
 * lunar surface is a scatter of unconnected circles; a shattered one is a
 * connected network of lineations that runs across the whole disc and does not
 * care where the craters are. The eye tells the two apart instantly, and it is
 * the single strongest cue available for "this is not Earth's Moon".
 *
 * Same 3x3x3 neighbourhood as craters(), and like craters() it only ever runs
 * for fragments inside a disc a hundred-odd pixels across.
 */
float fractures(vec3 sp, float freq, float seed) {
  vec3 p = sp * freq;
  vec3 base = floor(p);
  float f1 = 1e9;
  float f2 = 1e9;
  for (int k = 0; k < 27; k++) {
    vec3 o = vec3(float(k % 3), float((k / 3) % 3), float(k / 9)) - 1.0;
    vec3 cell = base + o;
    float d = length(p - (cell + hash33(cell + seed)));
    f2 = min(f2, max(d, f1));
    f1 = min(f1, d);
  }
  return f2 - f1;
}

/**
 * A moon disc. 'alien' is 1 for Masser and 0 for Secunda and selects the whole
 * surface treatment, not a blend: the two bodies have nothing in common beyond
 * being spheres lit by the same sun, and the brief for each is the opposite of
 * the other's.
 */
vec3 moon(vec3 rd, vec3 md, float ang, vec3 tint, float seed, float bright, float alien) {
  float cd = dot(rd, md);
  if (cd < cos(ang * 7.0)) return vec3(0.0);

  vec3 tx = normalize(cross(md, abs(md.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
  vec3 ty = cross(md, tx);
  vec2 uv = vec2(dot(rd, tx), dot(rd, ty)) / ang;
  float r2 = dot(uv, uv);

  // Hazy aureole: ash near the horizon smears the moons into lanterns.
  //
  // One halo model for both bodies, with the radius scaled by the disc as it
  // always was but the MAGNITUDE no longer discounted for the small moon. At
  // 0.024 against Masser's 0.030, and with Secunda's disc a third the area, the
  // review measured "Secunda has no glow halo at all" — and it did not, to
  // within a level. A moon's aureole is a property of the air, not of the moon,
  // so the coefficient is now shared and only the angular scale differs.
  //
  // Two exponentials rather than one: a tight skirt that hugs the limb and a
  // wide, faint shoulder that carries a few disc radii. A single 5.0 decay is
  // gone within a third of a radius, which reads as a rim light on the disc
  // rather than as light in the atmosphere around it.
  float halo = 0.030;
  float rr = sqrt(r2);
  vec3 glow = tint * halo
            * (exp(-(rr - 1.0) * 5.0) + 0.22 * exp(-(rr - 1.0) * 1.15))
            * smoothstep(0.0, 1.0, rr);

  // See the limb note at the bottom of this function. The cull has to sit
  // OUTSIDE the antialiasing band or the smoothstep is cut in half and the
  // "antialiased" limb is a hard step at 50% coverage.
  //
  // 1.6 pixels of filter width, not 3. On Secunda — 0.031 rad, ~33 screen pixels
  // of radius — three pixels is a tenth of the disc, so the limb was a wide grey
  // ramp rather than an edge and the body read as a smudge with a visibly
  // non-circular lower right. 1.6 still straddles the pixel centre either side,
  // which is all antialiasing needs.
  float px = uTanHalf.y * uCloudTexel.y;
  float fw = max(1.6 * px / max(ang, 1e-4), 1e-5);
  if (r2 > 1.0 + fw) return glow * bright;

  float z = sqrt(max(0.0, 1.0 - min(r2, 1.0)));
  vec3 n = normalize(tx * uv.x + ty * uv.y - md * z);

  // Masser is a battered body and Secunda a smooth one, so the relief amplitude
  // and the crater lattice differ in both directions — but "smoother" is not
  // "flat". At 0.30 Secunda's relief moved its albedo by 14%, which at its screen
  // size is under two 8-bit levels: the disc arrived as a featureless cream
  // circle with one vague smudge in it, beside a neighbour rendered to a
  // completely different standard. 0.62 is still visibly the calmer of the two
  // bodies and puts real craters on it.
  float roughAmp = mix(0.62, 1.0, alien);
  float craterFreq = mix(12.0, 4.2, alien);

  vec3 grad = vec3(0.0);
  float h = craters(n, craterFreq, seed, grad) * roughAmp;
  h += craters(n, craterFreq * 2.7, seed + 9.0, grad) * roughAmp * mix(0.45, 0.28, alien);
  // Regolith micro-relief keeps the terminator from reading as smooth plastic.
  float micro = fbm3(n * 55.0 + seed, 3) - 0.5;

  vec3 albedo;
  if (alien > 0.5) {
    // Masser. Three things, together, make it impossible to read as our Moon.
    //
    // 1. Basins at a scale our Moon does not have relative to its disc. A lunar
    //    photograph is a uniform sprinkle of similar-sized circles; Masser is
    //    dominated by two or three impacts wide enough to deform its own limb,
    //    with the fine field only filling in between them.
    h += craters(n, 1.55, seed + 31.0, grad) * 2.30;

    // 2. The fracture network. Two octaves: a coarse set of continent-scale
    //    rifts and a fine crazing over them, both dark and both MORE saturated
    //    than the surface they cut, because a fault wall exposes unweathered
    //    oxide rather than the sun-bleached dust on top of it.
    // Narrower walls, and the coarse set carries most of the weight. At 0.24 the
    // F2-F1 band was a fifth of a cell wide, so the "fracture network" rendered
    // as a filled honeycomb rather than as lineations — measured by the review as
    // "pale orange bubble-wrap", which is exactly what a Worley cell diagram
    // looks like when its walls are as wide as its cells. A rift is a LINE.
    float crack = (1.0 - smoothstep(0.0, 0.105, fractures(n, 3.6, seed * 1.7)))
                + 0.42 * (1.0 - smoothstep(0.0, 0.042, fractures(n, 9.0, seed * 2.9 + 4.0)));
    // The rifts are trenches, not paint: they take the surface down with them, so
    // they self-shade at the terminator and read as structure rather than decal.
    h -= clamp(crack, 0.0, 1.4) * 0.55;

    // 3. Hue and value move TOGETHER. Our Moon's dark maria are *less* saturated
    //    than its highlands, which is exactly what makes a grey-and-cream disc
    //    read as a photograph of it; on an iron-oxide body the low ground is the
    //    deepest, reddest material and the highlands are bleached dust, so the
    //    disc never enters the grey family at any value.
    float dust = smoothstep(0.26, 0.74,
                            fbm3(n * 2.3 + seed * 0.7, 4) + clamp(h, -0.7, 0.9) * 0.20);
    albedo = mix(tint * vec3(0.46, 0.24, 0.18), tint * vec3(1.42, 0.96, 0.72), dust);

    // Latitudinal oxide belts, warped by a low fbm so they are not perfect rings.
    float lat = dot(n, vec3(0.19, 0.96, 0.21));
    float belt = sin(lat * 11.0 + fbm3(n * 1.6 + seed, 3) * 5.5)
               + 0.55 * sin(lat * 26.0 + fbm3(n * 3.1 + seed * 1.7, 2) * 7.0);
    albedo *= mix(vec3(0.72, 0.46, 0.36), vec3(1.16, 1.03, 0.90),
                  smoothstep(-0.8, 0.8, belt));

    albedo = mix(albedo, albedo * vec3(0.46, 0.19, 0.13), clamp(crack, 0.0, 1.0) * 0.82);
  } else {
    // Secunda. Smoother and paler than Masser, but NOT featureless: rendered as
    // a flat cream disc beside a heavily cratered one it read as two bodies
    // authored to completely different standards, which is exactly what the
    // review called out. It gets the same pipeline, at a third of the amplitude
    // and with an icy rather than an oxide palette.
    //
    // Mare mask: a few large, low-albedo basins over a bright highland. This is
    // the strongest cue that a disc is a SURFACE rather than a lit circle,
    // because it survives at any size — it is what the eye recognises on our own
    // moon from across a room.
    float mare = smoothstep(0.44, 0.68, fbm3(n * 1.55 + seed * 0.7, 4)
                                        + clamp(h, -0.6, 0.6) * 0.16);
    albedo = tint * mix(vec3(1.06, 1.03, 0.96), vec3(0.62, 0.62, 0.66), mare);

    // A handful of large basins, the same structural cue Masser gets. Without a
    // feature whose scale is a sizeable fraction of the disc, a small moon has
    // nothing the eye can resolve at all and reads as a lit circle.
    h += craters(n, 2.6, seed + 23.0, grad) * 0.95;

    // Highland speckle at a finer scale, so the bright ground is not flat either.
    albedo *= 0.88 + 0.24 * fbm3(n * 6.2 + seed * 1.9, 3);

    // Ejecta rays from the two or three youngest craters: bright, radial,
    // wavelength-independent streaks that cross the mare without regard for it.
    // Cheap — one fbm on a radial coordinate — and unmistakable.
    float rays = smoothstep(0.62, 0.90, fbm3(n * 11.0 + seed * 3.3, 2));
    albedo += tint * rays * 0.16 * smoothstep(-0.2, 0.5, h);
  }

  vec3 gt = grad - n * dot(grad, n);
  // 0.030, not 0.013.
  //
  // This is the entire relief signal: the crater field's analytic gradient,
  // tilting the shading normal. At 0.013 a rim tilted the normal by ~20 degrees,
  // which on a body at 99% phase — where the incidence cosine is pinned near one
  // over the whole face — moves the reflectance by six per cent, i.e. under two
  // 8-bit levels through the night exposure. That is the "featureless flat disc"
  // reading, and it was a photometry problem, not a missing-detail one: the
  // craters were always there and nothing could see them. With Masser now at 70%
  // phase (see Solar.ts) most of the visible face is lit at a real slant, so the
  // same tilt does visible work, and the amplitude can go up without the disc
  // turning into noise.
  vec3 nn = normalize(n - gt * 0.042 * roughAmp + (fbm3(n * 130.0, 2) - 0.5) * 0.028);

  // Relief drives ALBEDO as well as shading. A crater floor is shadowed regolith
  // that has never been gardened by the same amount of micrometeorite bombardment
  // as the highland around it, so it is darker as material and not only as
  // shading — which is why the maria on a photograph of our own full Moon are
  // plainly visible even though the lighting on them is flat. That is precisely
  // the cue a 256px 2002 billboard carries and this shader did not: 0.78 + 0.46h
  // spans a 1.5:1 albedo range and only reaches its ends at extreme h.
  albedo *= 0.66 + 0.72 * clamp(h, -0.6, 0.9) + micro * 0.18;

  // Lommel-Seeliger, which is the correct lobe for a dark, porous regolith and
  // the reason a photograph of a full moon is nearly FLAT across its face while
  // a Lambertian sphere of the same albedo falls off visibly toward its limb.
  // The reflectance is mu0 / (mu0 + mu), where mu is the cosine of the emission
  // angle — which on a sphere seen from far away is exactly z.
  //
  // The surface normal used for the lobe is the CRATERED one, but the shadow-side
  // cutoff is driven by the smooth geometric normal: letting metre-scale regolith
  // noise decide which pixels are lit is what turns a terminator into a stipple.
  float ndlS = dot(n, uSunDir);
  // The blend band is 0.07..0.0 of ndl, not 0.16..0.03.
  //
  // Its job is to stop metre-scale regolith noise deciding which pixels are lit,
  // because that turns a terminator into a stipple. At 0.16 it was doing far more
  // than that: it faded the cratered normal out over a nine-degree band either
  // side of the terminator — a fifth of the disc radius — which is exactly the
  // band where the light is grazing and where crater relief is the ONLY place on
  // a phased body that casts a real shadow. It was suppressing the feature it was
  // meant to protect. Four degrees is still wider than the micro-relief.
  float mu0 = max(mix(dot(nn, uSunDir), ndlS, smoothstep(0.07, 0.0, abs(ndlS))), 0.0);
  // Floored so the limb-brightening the lobe correctly produces stays a lift
  // rather than a ring: at mu = z the denominator goes to zero at the very edge.
  float mu = max(z, 0.22);
  // A real terminator is tens of kilometres of shadowed relief, not a line. The
  // old hard smoothstep over 0.09 of ndl bit a visibly straight-edged chunk out
  // of Secunda's disc, which is why a gibbous phase was measured as "a squashed,
  // rotated ELLIPSE" rather than read as a phase at all.
  float term = smoothstep(-0.09, 0.16, ndlS);
  float lit = 2.0 * mu0 / (mu0 + mu) * term;
  // Limb darkening, on top of the Lommel-Seeliger lobe.
  //
  // L-S is the right reflectance for a porous regolith and it is very nearly
  // FLAT across the face — which is why a full moon photographs as a disc rather
  // than as a sphere, and why the review read both bodies as "fully lit" cutouts.
  // A real limb is not flat though: at grazing emission the surface's own metre
  // scale roughness shadows itself, and that shows as a darkening confined to the
  // outer fifth of the disc. Weak, and only where z is small, so the mid-disc
  // photometry the lobe gets right is untouched.
  lit *= mix(1.0, pow(max(z, 0.0), 0.34), 0.42);
  vec3 c = albedo * lit;
  // Ashen light: the planet's own albedo lighting the moon's night side. Real,
  // and it is what keeps the unlit limb attached to the disc instead of letting
  // the terminator cut the silhouette in half.
  c += albedo * (0.016 + 0.030 * (1.0 - term));

  // Analytic limb. fwidth() cannot be used here: this function has already
  // taken two early returns (the 7-radius cull and the glow branch), so any
  // quad straddling the limb has at least one lane that never reached the
  // derivative and the result is undefined — which is exactly the "edge
  // dissolves into scattered isolated pixels" defect on the small moon. One
  // screen pixel subtends uTanHalf.y * uCloudTexel.y radians; d(r2)/d(angle) is
  // 2*rr/ang at the limb, so the filter width in r2 units is closed form and
  // correct for every moon at every size and field of view.
  float edge = 1.0 - smoothstep(1.0 - fw, 1.0 + fw, r2);

  // Hue-preserving highlight shoulder on the disc.
  //
  // The moons are the only objects in the frame whose radiance is fixed
  // independently of the exposure the rest of the scene metered to, so they are
  // the one thing that can land above the tonemapper's shoulder in a SINGLE
  // channel. Measured on the night frame Masser's crater highlights sat at
  // 254/181/144 across 1036 pixels with red pinned at 255: the red channel had
  // clipped while green and blue had not, so the disc core hue-shifted toward
  // white and a rust-red body rendered as cream — the exact failure the review
  // reported. Rolling the MAX channel off with a Reinhard shoulder and scaling
  // all three by the same factor caps the peak without moving the chromaticity
  // one degree, which is what keeps the ember tint in the brightest part of the
  // disc instead of only in its shadows.
  float mx = max(c.r, max(c.g, c.b));
  // The knee is 0.45 in radiance, i.e. the disc's brightest channel asymptotes
  // there no matter what the surface underneath it does. Combined with the
  // per-moon scale below it puts a full Masser's peak near 0.14 and its mid-disc
  // near 0.09, which lands at roughly 0.85 and 0.7 display through the metered
  // night exposure — bright, unmistakably the brightest object in frame, and with
  // three quarters of a stop of headroom still under the clip.
  c *= (mx / (1.0 + mx / 0.45)) / max(mx, 1e-6);

  return (c * edge + glow) * bright;
}

/**
 * Coverage of a moon's disc along a view ray, antialiased over one screen pixel.
 * Used to occlude the star field: the moons and the stars are both additive
 * terms in the same 'space' accumulator, so without this a star drawn behind a
 * moon is composited ON TOP of it. Nothing may ever draw over a moon.
 */
float moonCover(vec3 rd, vec3 md, float ang) {
  float a = acos(clamp(dot(rd, md), -1.0, 1.0));
  float px = max(uTanHalf.y * uCloudTexel.y, 1e-5);
  return 1.0 - smoothstep(ang - px, ang + px, a);
}

// --------------------------------------------------------------- clouds ----

float heightGrad(float hf, float type) {
  float stratus = smoothstep(0.0, 0.06, hf) * (1.0 - smoothstep(0.12, 0.30, hf));
  float cumulus = smoothstep(0.0, 0.20, hf) * (1.0 - smoothstep(0.55, 0.98, hf));
  float tower   = smoothstep(0.0, 0.10, hf) * (1.0 - smoothstep(0.88, 1.0, hf));
  return mix(mix(stratus, cumulus, smoothstep(0.0, 0.55, type)),
             tower, smoothstep(0.55, 1.0, type));
}

/**
 * Cloud medium, in SI. Extinction is per metre at density 1: 0.0042 gives a
 * 2.85km deck an optical depth around 30, which is a real cumulus — opaque
 * through the body, translucent for the last hundred metres at the edge. The
 * previous 0.055 was five times that: transmittance collapsed inside a single
 * step, so the alpha was a hard isosurface of the trilinear lattice (hence the
 * stair-stepped cutout edge) and the sun optical depth ran to e^-85 — every
 * cloud pixel was lit by ambient alone, which is why they had no
 * self-shadowing, no silver lining and no internal structure at all.
 */
const float CLOUD_EXT = 0.0105;
/** Water droplets are very nearly conservative scatterers. */
const float CLOUD_ALB = ${CLOUD_ALBEDO.toFixed(4)};
/** Tile of the baked shape volume, metres. 64^3 over this is ~125m/texel. */
const float SHAPE_SCALE = 1.0 / 8000.0;

/** (coverage, type, wispiness) from the weather map. */
vec3 weatherAt(vec2 wp) {
  // 3.0e-5, i.e. a 33km tile, not 80km.
  //
  // The map's base octave is three cells per tile, so at 80km one coverage
  // feature was 27km across — and the deck a camera can actually see spans
  // 2-15km over most of the frame. The consequence is that a shot did not sample
  // a cloud FIELD at all, it sampled one arbitrary point of a very slow one, and
  // whether the sky had weather in it was decided by where in an 80km lottery
  // the vantage happened to sit. That is why redmtn could be in weather state
  // 'cloudy', with the preset asking for six oktas, and render 45% of the frame
  // as empty gradient: its column of the map reads low, and nothing about the
  // authored coverage could reach the screen. At 33km the visible sky spans two
  // to four coverage cells, so a broken deck is broken WITHIN the frame — cloud
  // and gap in the same shot, which is what 4-6 oktas means.
  vec4 wm = texture(uWeather, wp * 3.0e-5);
  // A second, 3.4x finer coverage octave was tried here and reverted.
  //
  // The premise was sound and the measurement did not support it. The map's
  // spectrum puts most of its energy in an 11km base octave, so a landscape frame
  // spans about three coverage features and whether a given bearing carries cloud
  // is close to a coin toss; a 3.3km octave would put a dozen across the same sky.
  // Measured on the coast vantage it moved the sky's luminance sd by 0.0 levels,
  // because that frame's problem is not that the deck is absent — differencing a
  // clear against an overcast render shows it present, layered and formed across
  // the whole visible band — but that it renders within two levels of the sky it
  // hangs in. Redistributing WHERE the cloud is cannot fix cloud you cannot see,
  // and the storm-mask relaxation that came with it raised the whole-map mean
  // coverage, which is exactly the ambient-irradiance budget the 0.14 was set by.
  // The lever for this is the deck's internal lighting range (see the ambient
  // depth term in marchClouds), and that is where it now lives.
  // uCoverage IS the mean coverage, and the map only modulates around it.
  //
  // The old mapping was wm.r*(0.25+cov*1.5) + cov*0.45 - 0.30, which at the
  // "cloudy" preset's 0.50 lands a mean of 0.35 — and cloudDensity then only
  // makes cloud where the shape channel exceeds 1-0.35 = 0.65, which the erosion
  // pass promptly eats. Measured on redmtn that is a weather state named
  // 'cloudy' with two faint smudges in it and 45% of the frame empty. Anchoring
  // the mean ON uCoverage and letting the map supply the +/-0.2 of spatial
  // variation makes the preset table mean what it says: 0.26 clear is a sparse
  // sky with real gaps, 0.50 cloudy is a broken 4-6 okta deck, 0.94 overcast is
  // closed. Same cost, one multiply-add.
  float cov = clamp((wm.r - 0.5) * (0.5 + uCoverage) + uCoverage, 0.0, 1.0);
  // The storm-cell mask carves holes in broken skies but must not punch through
  // a genuine overcast, so it fades out as coverage approaches 1.
  cov *= mix(mix(0.5, 1.0, wm.b), 1.0, uCoverage * uCoverage);
  return vec3(cov, clamp(wm.g * uCloudType * 1.4, 0.0, 1.0), wm.a);
}

// The alt argument is the true radial altitude, not p.y: at the 100km ranges a
// grazing ray reaches, curvature drops the layer far below the flat-plane
// height and the deck would otherwise stop dead a degree above the horizon.
//
// 'detail' is the authority the caller is willing to give the high frequencies,
// 0..1, and it is a CONTINUOUS weight rather than an integer LOD on purpose. It
// is driven by the step length (see marchClouds), and an integer ladder would
// put a hard ring in the sky at whatever distance the step crosses a threshold.
// At 0 the medium collapses to its band-limited base shape; at 1 it carries two
// shape octaves plus the erosion channels.
//
// The light cone spends most of its samples deep inside the medium where only
// the low frequencies survive the exponential anyway, so it asks for very little
// detail; that is most of the difference between this march fitting in the frame
// budget and not.
float cloudDensity(vec3 p, float alt, vec3 wm, float detail) {
  float hf = clamp((alt - uCloudBottom) / (uCloudTop - uCloudBottom), 0.0, 1.0);

  float hg = heightGrad(hf, wm.y);
  if (hg <= 0.002) return 0.0;

  // Wind shear. The top of a deck moves faster than its base, so a billow leans
  // downwind by the better part of a kilometre over its own depth. Without this
  // every shape is symmetric about its own vertical axis, which is what makes a
  // cloud field read as a scatter of soft lozenges dropped on a flat sky rather
  // than as weather with a direction in it.
  vec2 wp = p.xz + uCloudWind + uCloudShear * hf;

  // Low-frequency domain warp, one octave, applied only where the caller wants
  // detail. Advecting the SAMPLE POSITION rather than scrolling UVs is what
  // stops the noise lattice showing through as a field of near-identical soft
  // circular blobs at uniform spacing: a warp of a couple of kilometres at a
  // 25km period shears and forks the cells so no two read the same.
  // The warp source is the baked volume's own two low-frequency channels, not a
  // pair of procedural vnoise calls: vnoise is eight hashes, and this function
  // runs some fifty times per pixel between the view march and the light cone —
  // measured, the procedural version cost four fifths of the frame. One extra
  // trilinear fetch at a quarter of the shape frequency buys the same thing.
  //
  // Gated above 0.45 so the light cone, which never asks for more than 0.30,
  // never pays for it at all.
  if (detail > 0.45) {
    vec4 wv = texture(uCloudTex, vec3(wp.x, alt * 1.4, wp.y) * (SHAPE_SCALE * 0.31)
                                + vec3(0.61, 0.29, 0.13));
    wp += (wv.ra - 0.5) * 2900.0;
  }

  vec3 sp = vec3(wp.x, alt * 1.7, wp.y) * SHAPE_SCALE;

  // Two octaves of the Perlin-Worley shape channel. A single fetch at cloud
  // scale is ~125m per texel, coarse enough that the texture's own lattice
  // shows up as facets in the silhouette; the second octave is 3.3x finer and
  // offset so the two lattices never align. 3.13 rather than 3.3, and 8.7 rather
  // than 9.0 below: an integer-ish ratio between octaves lines the two lattices
  // up every few cells and re-creates the very grid the second octave is there
  // to hide.
  float shape = texture(uCloudTex, sp).r;
  if (detail > 0.02) {
    // The second octave can only move the shape by +/-0.15, so a sample that
    // far below the coverage threshold cannot become cloud. Testing the bound
    // before fetching skips the octave on every empty step, and in a broken sky
    // most steps are empty — this is the single biggest saving in the march.
    if (remap(shape + 0.15, 1.0 - wm.x, 1.0, 0.0, 1.0) * hg <= 0.002) return 0.0;
    float oct = texture(uCloudTex, sp * 3.13 + vec3(0.37, 0.11, 0.83)).r;
    shape = clamp(shape + (oct - 0.5) * 0.30 * detail, 0.0, 1.0);
  }

  float d = remap(shape, 1.0 - wm.x, 1.0, 0.0, 1.0) * hg;
  if (d <= 0.002) return 0.0;

  if (detail > 0.35) {
    vec4 det = texture(uCloudTex, sp * 8.7 + vec3(0.0, uTime * 0.0022, 0.0));
    float e = det.g * 0.625 + det.b * 0.25 + det.a * 0.125;
    // Wispy shreds at the base, cauliflower billows above.
    e = mix(1.0 - e, e, smoothstep(0.12, 0.72, hf));
    // Erosion strength is a direct frame-cost lever, not just a look knob:
    // every notch of extra erosion thins the medium, which keeps transmittance
    // above the early-out for more steps. 0.52 is where the silhouette reads as
    // fractal and the march still terminates. Scaling it by 'detail' is what
    // makes the LOD fade continuous: as the step grows past what can resolve the
    // erosion the remap tends to the identity instead of switching off.
    float amt = 0.52 * smoothstep(0.35, 0.85, detail);
    d = remap(d, e * amt * mix(1.0, 0.5, wm.z), 1.0, 0.0, 1.0);
  }
  return clamp(d, 0.0, 1.0);
}

vec4 marchClouds(vec3 ro, vec3 rd, float dither, out float cloudDist) {
  cloudDist = 0.0;
  if (rd.y < -0.02 || uCoverage < 0.005) return vec4(0.0, 0.0, 0.0, 1.0);

  float r0 = Rg + max(ro.y, 1.0);
  float t0 = max(shellFar(r0, rd.y, Rg + uCloudBottom), 0.0);
  float t1 = shellFar(r0, rd.y, Rg + uCloudTop);
  if (t1 <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  // Clamp the crossing. 40km, not 70: a grazing path transmits ~3% at 40km (see
  // the opacity fade in cloudLayer), so everything past it was contributing
  // nothing except to stretch the same fixed step budget over another 30km — the
  // steps ran to 3km, the density integral quantised, and the band above the
  // horizon turned to speckle. Shortening the range shortens every step in it.
  t1 = min(t1, t0 + 40000.0);
  if (t1 <= t0) return vec4(0.0, 0.0, 0.0, 1.0);

  int N = uCloudSteps;
  float span = t1 - t0;
  // Step length grows linearly with depth into the slab: near samples resolve
  // the silhouette, far samples are sub-pixel. Deriving it from t in closed
  // form (rather than compounding a growth factor per iteration) means an
  // empty-space skip cannot desynchronise step length from distance, which is
  // what used to leave the far half of a broken sky marched at kilometre steps.
  float ds0 = span / (float(N) * 4.5);
  // Hard ceiling on the step, in metres.
  //
  // A grazing ray spans the full 70km of clamped deck, so at the old 8x growth
  // its last steps ran to nearly 3km — twenty times the shortest wavelength in
  // the density field, with a per-pixel stochastic offset on top. Neighbouring
  // pixels therefore landed on opposite sides of the same 200m billow and the
  // band just above the horizon came out as dark speckle (measured per-row std
  // ~22 against a smooth background), which reads as video static rather than as
  // cloud. 1300m is the longest step the detail fade below can still band-limit.
  const float DS_MAX = 800.0;
  float t = t0 + ds0 * dither;

  float cosT = dot(rd, uCloudLightDir);
  // Three lobes. 0.72 is the body of the cloud; the tight 0.96 lobe is the
  // silver lining you get looking toward the sun through a thin edge; the
  // small backward lobe keeps the anti-solar side from reading as flat paper.
  //
  // Both forward lobes are widened by the source's angular radius (see srcG).
  // For the sun that moves g by four parts in ten thousand and nothing in any
  // daylight frame changes; for a moon six times wider than the silver-lining
  // lobe it takes the forward peak from 28x isotropic to 5x, which is what
  // stops a cumulus puff a few degrees off Masser from rendering as a clipped
  // white growth attached to the disc.
  float phase = 0.60 * hgPhase(cosT, srcG(0.72, uCloudSrcAng))
              + 0.28 * hgPhase(cosT, srcG(0.96, uCloudSrcAng))
              + 0.12 * hgPhase(cosT, -0.42);

  float sigT = CLOUD_EXT * uCloudDensity;
  float sigS = sigT * CLOUD_ALB;

  float T = 1.0;
  vec3 scat = vec3(0.0);
  float firstHit = -1.0;

  for (int i = 0; i < 96; i++) {
    // Matched to the transmittance remap at the bottom of this function: below
    // 0.04 the layer is composited as fully opaque anyway, so continuing to
    // march is work with no visible result.
    if (i >= N || T < 0.04 || t >= t1) break;
    float ds = min(ds0 * (1.0 + 7.0 * (t - t0) / span), DS_MAX);
    // Band-limit the medium to the step. An erosion octave whose features are
    // ~12m across cannot be resolved by a 900m step; it can only alias, one
    // pixel to the next, and that aliasing IS the speckle. Fading the high
    // frequencies out as the step grows is the volumetric equivalent of a mip
    // level, and it is both the fix for the near-horizon noise band and a large
    // saving on the far half of every grazing ray.
    // The thresholds are the medium's own Nyquist limits, not taste: the erosion
    // channels carry ~14m features and the second shape octave ~40m, so a step of
    // 90m is already past both and a step of 420m is past the 125m base shape as
    // well. Above the horizon a typical step is 30-100m and nothing is lost;
    // through the grazing band, where the step runs to several hundred metres,
    // the medium correctly collapses to its smooth base and the speckle with it.
    float detail = 1.0 - smoothstep(90.0, 420.0, ds);

    vec3 p = ro + rd * t;
    float alt = length(vec3(0.0, r0, 0.0) + rd * t) - Rg;
    vec3 wm = weatherAt(p.xz + uCloudWind);
    float d = cloudDensity(p, alt, wm, detail);

    if (d <= 0.002) {
      // Outside the medium: stride, and skip the light march entirely. 1.5, not
      // 2.1 — a stride of two full steps can jump clean over a thin deck, and
      // whether it does depends on the per-pixel dither offset, so the deck
      // dissolves into a binary hit/miss pattern at exactly the grazing angles
      // where it is thinnest.
      t += ds * 1.5;
      continue;
    }
    if (firstHit < 0.0) firstHit = t;

    // Widening cone toward the sun for self-shadowing. The weather sample is
    // reused across the cone: it varies over ~300m where the cone spans 4km,
    // and re-fetching it per light step doubles the cost of the whole march
    // for a difference no one can see.
    // Distant samples are sub-pixel, and once the view ray is already three
    // quarters extinguished nothing behind it survives to be shaded — both get
    // a cheap constant-path estimate instead of a cone. The cone is by far the
    // most expensive thing in the march, so gating it is what buys the step
    // budget that makes the silhouette soft in the first place.
    float od;
    if (T > 0.22) {
      int lsteps = t > 22000.0 ? min(uLightSteps, 3) : uLightSteps;
      od = 0.0;
      float ls = 150.0;
      vec3 lp = p;
      float la = alt;
      vec3 lwm = wm;
      for (int j = 0; j < 8; j++) {
        if (j >= lsteps) break;
        lp += uCloudLightDir * ls;
        la += uCloudLightDir.y * ls;
        // Re-read the weather map once, halfway along the cone. Holding the
        // sample's own coverage for the whole 3km of light path is fine for a
        // high sun, where the cone is nearly vertical and stays in one column —
        // and badly wrong for a grazing one, where it runs kilometres sideways
        // and every sample under a cloudy column was shadowed as if the entire
        // horizon were solid deck. That is why a sunset produced flat grey-brown
        // lumps with no lit sunward edge: the silver lining was being shadowed
        // by cloud that is not there. One extra fetch per cone.
        if (j == 2) lwm = weatherAt(lp.xz + uCloudWind);
        od += cloudDensity(lp, la, lwm, j < 2 ? 0.30 * detail : 0.0) * ls;
        ls *= 1.72;
      }
    } else {
      od = d * 900.0;
    }

    // Wrenninge multiple-scattering octaves: each octave sees a thinner, more
    // isotropic medium, which is what stops thick clouds going black.
    //
    // Three octaves at (a,b,c) = (0.62, 0.28, 0.55) was worth a *ceiling* of
    // 0.076 in 'light' at zero sun-optical-depth and about 0.017 at the depth a
    // real deck actually reaches. Against an ash sky measuring 0.28 radiance
    // that put a fully sunlit cumulus at 0.2 — DARKER than the sky behind it —
    // which is why every cloudy frame read as a flat card with faint smears on
    // it rather than as a deck with form. A conservative scatterer lit at 37
    // degrees should reflect on the order of E*mu0*albedo/pi, i.e. several times
    // the sky beside it; six octaves with a much slower decay of both the weight
    // and the transmittance exponent is what reaches that number. The last
    // octaves carry almost isotropic phase and b ~ 0.02, so a genuinely thick
    // core still saturates at roughly sky level instead of collapsing to black —
    // that difference between a lit face and a shaded one IS the form.
    //
    // The weight now decays at 0.55 rather than 0.72, because the series overshot
    // the very number it was aiming at. A conservative medium cannot return more
    // than the light falling on it: the ceiling is E_perp * mu0 * albedo / pi,
    // which on the coast frame is 0.70 radiance. The 0.72 series summed to 3.07
    // in weight and put a lit face at 2.2 — three times that limit. At 2.2 a
    // sunlit deck is eight times the metered frame mean, so the auto-exposure
    // closes down, the deck sits on the tonemapper's shoulder where AgX
    // compresses the last of its chroma out, and two fifths of the frame measures
    // above display 200 at a saturation of 0.02. A "featureless white void" is
    // what a cloud looks like when it is emitting three times what it receives.
    float tau = od * sigT;
    float local = d * sigT * 120.0;
    vec3 light = vec3(0.0);
    float a = 1.0, b = 1.0, c = 1.0;
    for (int o = 0; o < 6; o++) {
      float beer = exp(-tau * b);
      // Powder (the dark-edge term) is a backscatter effect: it must fade out
      // toward the sun or it eats the silver lining it is meant to sit beside.
      float powder = 1.0 - exp(-2.0 * local * b);
      light += a * beer * mix(1.0, powder, 0.45 - 0.45 * cosT) * mix(phase, 0.0796, 1.0 - c);
      a *= 0.55; b *= 0.45; c *= 0.50;
    }

    float hf = clamp((alt - uCloudBottom) / (uCloudTop - uCloudBottom), 0.0, 1.0);
    // Sky from above, ground bounce from below, and a depth term so the middle
    // of a thick deck is not lit as brightly as its surface.
    vec3 amb = mix(uCloudAmbDn, uCloudAmb, smoothstep(0.0, 0.85, hf));
    // 0.16 + 0.84*exp(-tau*0.30), not 0.30 + 0.70*exp(-tau*0.14) — and this is
    // the deck's CONTRAST, which is the reason several daylight skies measured as
    // cloudless.
    //
    // Differencing a clear against an overcast render of the coast vantage shows
    // the deck is there and has real silhouette, and that it renders within a
    // couple of luminance levels of the sky behind it: mean 213.8 with sd 3.2 at
    // coverage 0.14 against 218.4 with sd 4.3 at 0.94. A layer that cannot be
    // told from the sky it hangs in is, to a viewer, not there — "a flat, sunless,
    // cloudless wash with zero incident" is the review's description of a deck
    // whose lit face and shaded face are the same value.
    //
    // The term is the ambient reaching depth tau into the medium, and at a floor
    // of 0.30 a fully buried sample still received a third of the open sky. That
    // is not a small error for form: it is a pedestal under every shaded face in
    // the deck, and a cumulus whose flanks and base sit a third of the way up
    // toward its own sunlit top has no modelling in it. A real deck's shaded side
    // is several times darker than its lit one — that ratio IS the form. The
    // faster decay costs nothing (the same exponential) and the lower floor is
    // still well clear of black, so a thick core saturates to a legible grey
    // rather than a hole.
    amb *= 0.16 + 0.84 * exp(-tau * 0.30);
    // The key term, ceilinged at the source's own radiance. sigS/sigT is the
    // single-scattering albedo, so for an optically thick sample this integrates
    // to (key + amb) * 0.96 — capping the key here caps the cloud's radiance,
    // which is exactly the quantity that must not exceed the moon's.
    vec3 S = (capToSource(uCloudSun * light, uCloudKeyMax) + amb) * d * sigS;
    S += vec3(0.62, 0.72, 1.0) * uLightning * 22.0 * d * sigS;

    float ext = max(d * sigT, 1e-7);
    float tr = exp(-ext * ds);
    scat += T * S * (1.0 - tr) / ext;
    T *= tr;
    t += ds;
  }

  cloudDist = firstHit < 0.0 ? t0 : firstHit;
  // The march early-outs at T < 0.02 and simply stops, so an optically infinite
  // deck still hands back 2% transmittance. Stars peak three orders of magnitude
  // above the night sky, so 2% of a star is still a clearly visible dot — which
  // is exactly the "stars composited over the cloud bank" defect. Rescaling the
  // residual to zero costs nothing anywhere else (a deck at T=0.5 moves to 0.48)
  // and makes an opaque cloud genuinely opaque.
  return vec4(scat, max(0.0, (T - 0.04) / 0.96));
}

/**
 * Transmittance of the air between the eye and a layer d metres away. Clouds
 * sit at 1.7-7.4km, inside the column the dome integrates; a closed form for the
 * slab below them is a one-lookup approximation of doing it in-loop, and is
 * exact for an exponential atmosphere.
 */
vec3 slabT(vec3 rd, float d) {
  float ody = max(rd.y, 0.004);
  float hR = uScaleH.x, hM = uScaleH.y, hA = uScaleH.z;
  float aR = exp(-uCamY / hR) * (hR / ody) * (1.0 - exp(-ody * d / hR));
  float aM = exp(-uCamY / hM) * (hM / ody) * (1.0 - exp(-ody * d / hM)) * uMieMul;
  float aA = exp(-uCamY / hA) * (hA / ody) * (1.0 - exp(-ody * d / hA)) * uMieMul;
  return exp(-(uBetaR * aR + uBetaME * aM + uBetaA * aA));
}

// --------------------------------------------------------------- cirrus ----

/**
 * A thin high veil at 7.4km, present in EVERY weather including "clear".
 *
 * The cumulus march below 4.6km is the right model for a deck and the wrong one
 * for a sheet: at "clear" coverage the march produces two or three isolated
 * puffs and the other 95% of the dome is a bare gradient with no scale cue and
 * no time-of-day read — the same image at noon and at four o'clock. A sheet is
 * a two-dimensional object, so it costs a plane intersection and a warped fbm
 * rather than a volume march, and it is what gives the sky depth and lets the
 * sun's position be legible from the sky alone.
 *
 * Ice crystals scatter far more forward than water droplets, so the sun-facing
 * side of every filament lights up while the anti-solar side stays a flat grey
 * — that asymmetry is the whole reason to have the layer at all.
 *
 * Returns (radiance, coverage alpha).
 */
vec4 cirrusLayer(vec3 rd, out float cirDist) {
  cirDist = 0.0;
  if (rd.y < 0.010 || uCirrus < 0.004) return vec4(0.0);
  const float CIR_H = 7400.0;
  float t = (CIR_H - uCamY) / rd.y;
  // 3.2e5, not 8e5. sqrt(2*Rg*7400) is 307km — the geometric horizon of a sheet
  // at this altitude — so anything past it is not sheet, it is extrapolation.
  if (t <= 0.0 || t > 3.2e5) return vec4(0.0);
  cirDist = t;

  // ---- band limit --------------------------------------------------------
  //
  // t runs from 7km overhead to 300km at the horizon, so the sample position
  // sweeps forty times faster per screen pixel down there than it does at the
  // zenith. Every field below — the bend, both warps, all four fbm octaves — is
  // then sampled far past its Nyquist limit, and a rotation field aliased over
  // full turns does not read as noise, it reads as a MOIRE: concentric whorls
  // and long curved combed streaks across the upper sky. This is the volumetric
  // 'detail' fade of the cloud march applied to a sheet, and for the same
  // reason: a feature smaller than a pixel can only alias, so the honest thing
  // is to let the medium collapse to its band-limited mean.
  //
  // The thresholds are the FINEST octave's Nyquist limit, not the base one's.
  // d(sample)/d(pixel) is |wp| * px / rd.y, and wp = rd.xz * t, so the measure
  // below is in base-frequency periods per screen pixel; the fourth fbm octave
  // sits 2.13^3 = 9.7x finer and the across-streak squash a further 1.55x, so it
  // aliases once this exceeds about 1/15 of a period. Thresholds set from that,
  // which is why they look small.
  float cpx = max(uTanHalf.y * uCloudTexel.y, 1e-5);
  float fp = t * cpx * 1.9e-4 / max(rd.y, 0.03);   // base periods per pixel
  float detail = 1.0 - smoothstep(0.02, 0.12, fp);

  // 1.9e-4 per metre: a filament is ~2.5km across and ~12km long, so a clear
  // Ashlands noon carries half a dozen readable ash-cirrus streaks.
  vec2 wp = vec2(rd.x * t, rd.z * t) + uCloudWind * 2.6;
  vec3 p = vec3(wp.x, 0.0, wp.y) * 1.9e-4;

  // ---- the shear frame ---------------------------------------------------
  //
  // What was here stretched the noise along WORLD X — a constant, global axis —
  // and then warped inside that stretched space. Two consequences, and the
  // review measured both: every filament in the sky ran at the same screen
  // angle, and because the warp was applied to an already-anisotropic domain it
  // could only slide the streaks along themselves, never bend one relative to
  // its neighbour. The result is a family of exactly parallel, constant-pitch,
  // razor-edged ribbons crossing the whole frame, including a dead-straight
  // needle at (1050,390)-(1700,340) on the dusk plate. Real cirrus is never a
  // set of parallel lines.
  //
  // Three changes, in order of how much each one matters:
  //
  // 1. The axis is the WIND, not world X. Fallstreaks lie along the flow, so
  //    this is also the only physically defensible choice, and it means the
  //    streak angle changes with the weather instead of being baked in.
  // 2. The axis BENDS — but only slightly, and this is a trap worth naming.
  //    Anisotropic noise whose ORIENTATION follows a smooth vector field is the
  //    standard way to synthesise a fingerprint, and that is exactly what a
  //    +/-40 degree bend produced: whorls and concentric ring systems across the
  //    upper sky, which is a worse artefact than the stripes it replaced.
  //    Whorls appear at every critical point of the orientation field at any
  //    amplitude, so the amplitude has to stay inside the range where the family
  //    reads as gently curved rather than as a flow map. +/-13 degrees does.
  // 3. The variation that actually kills "parallel and constant width" is the
  //    WARP, not the rotation: cross-streak displacement breaks a filament,
  //    forks it and varies its thickness without ever defining an orientation
  //    field, so it cannot whorl. That is where the amplitude went instead.
  vec2 ax = normalize(uWindDir + vec2(1e-4, 0.0));
  float bend = (vnoise(p * 0.055 + 4.3) - 0.5) * 0.46 * detail;
  float cb = cos(bend), sb = sin(bend);
  vec2 axr = vec2(ax.x * cb - ax.y * sb, ax.x * sb + ax.y * cb);
  // Local frame: e.x runs ALONG the streak, e.y across it.
  vec2 e = vec2(dot(p.xz, axr), dot(p.xz, vec2(-axr.y, axr.x)));

  // Isotropic domain warp, two octaves at incommensurate frequencies. Both
  // components displace both axes, which is what breaks a filament into
  // branches rather than merely bending it.
  vec2 w1 = vec2(vnoise(vec3(e * 0.62, 11.0)), vnoise(vec3(e * 0.62, 37.0))) - 0.5;
  vec2 w2 = vec2(vnoise(vec3(e * 0.17, 5.7)), vnoise(vec3(e * 0.17, 61.3))) - 0.5;

  // Anisotropy last: 3.6:1, not 5:1 — a 5:1 lattice is a needle, and the review
  // measured one ("a needle-thin dead-straight dark line at (1050,390)").
  // Applied in the bent frame, with the warp added in the SQUASHED domain so the
  // cross-streak displacement is a known number of filament widths rather than
  // being multiplied up by the squash factor.
  vec3 q = vec3(e.x * 0.36, uTime * 0.0016, e.y * 1.30);
  // Cross-streak amplitude (the .y component) is now larger than a filament is
  // wide, which is what makes one break into several and each one change
  // thickness along its length.
  q.xz += (w1 * vec2(1.7, 1.6) + w2 * vec2(5.5, 3.4)) * detail;

  // fbm with a ROTATION between octaves and a non-integer lacunarity. fbm3
  // offsets each octave by a constant and doubles it, so every octave's features
  // sit at the same angle and on a commensurate lattice — the octaves reinforce
  // one another into a single direction instead of breaking it up. 2.13 with a
  // 37-degree turn per octave is enough that no two octaves ever line up.
  const mat2 ROT = mat2(0.7986, -0.6018, 0.6018, 0.7986);
  // Octaves are accumulated ZERO-MEAN about a fixed pedestal, so rolling the
  // higher ones off as they go sub-pixel changes the field's variance and never
  // its mean. Each octave is 2.13x finer than the last, hence 2.13x sooner past
  // Nyquist, which is what the geometric fade below expresses.
  float f = 0.5155;
  float amp = 0.55;
  float k = mix(0.28, 1.0, detail);
  vec3 qq = q;
  for (int i = 0; i < 4; i++) {
    f += (vnoise(qq) - 0.5) * amp;
    qq.xz = ROT * qq.xz * 2.13;
    qq.y += 4.7;
    amp *= 0.50 * k;
  }

  // Per-streak opacity. A real cirrus field has fallstreaks of very different
  // thickness side by side; a single threshold gives them all the same one.
  float vary = 0.45 + 1.15 * mix(0.5, vnoise(p * 0.21 + 91.4), detail);
  // ---- coverage, and the reason the sky was a cream card ------------------
  //
  // The old threshold was smoothstep(0.60 - cirrus*0.34, 0.80, ...) against a
  // field whose mean is 0.52, i.e. it opened BELOW the median: measured over the
  // dome, more than half of every "clear" sky carried veil at 0.25-0.58 alpha,
  // and near the horizon the slant term took that to the 0.86 ceiling. The
  // reviewer's "sky" on the coast and vale plates was therefore not the sky at
  // all — it was a warm, near-uniform sheet hung in front of it, two to three
  // times the dome's own radiance, with no structure of its own because a
  // smoothstep sitting in the middle of a noise field returns mid-grey almost
  // everywhere. That is the entire "bleached cream wash, no blue, no cloud, 44%
  // of the frame carries no information" finding, and it is one number.
  //
  // Opening ABOVE the median instead leaves two thirds of the dome genuinely
  // bare, so the scattering integral underneath is what the eye reads, and the
  // veil becomes a set of distinct fallstreaks with sky between them — which is
  // both what cirrus is and the "readable cloud form" the upper frame needs.
  //
  // The threshold band also WIDENS as the field goes sub-pixel. A hard threshold
  // on a band-limited field is still a hard threshold: it turns the residual
  // low-frequency wobble into a binary covered/bare decision and puts a ragged
  // edge across the far sky. Widening it converts the same wobble into a smooth
  // opacity ramp, which is what an unresolved sheet actually looks like.
  float wide = 0.55 * (1.0 - detail);
  float cov = smoothstep(0.615 - uCirrus * 0.20 - wide, 0.86 + wide,
                         f * (0.78 + 0.36 * vary));
  if (cov <= 0.002) return vec4(0.0);
  cov *= vary;
  // A grazing ray crosses far more sheet than a vertical one, which is what
  // packs the layer toward the horizon and sells the distance. Capped at 2.1,
  // not 3.2: the sulphur horizon band is the one part of the dome the palette
  // names explicitly, and it cannot be seen through a sheet at the opacity
  // ceiling.
  float slant = clamp(0.34 / max(rd.y, 0.075), 1.0, 2.1);
  // Ceiling 0.55, not 0.86. A cirrus sheet is optically THIN — you see blue
  // through it — and an 0.86 ceiling is a stratus deck wearing a cirrus name.
  float a = (1.0 - exp(-cov * uCirrus * 4.6 * slant)) * 0.55;

  float c = dot(rd, uCloudLightDir);
  // Ice: a hard forward lobe, a broad halo-ish shoulder, an isotropic floor.
  // Widened by the source's angular radius for the same reason the deck's lobes
  // are — see srcG. The 0.82 lobe is 8 degrees wide, so a moon only takes a
  // fifth off its peak, but the veil is the layer that hangs immediately around
  // the disc and it is the one that must not brighten toward it faster than the
  // disc itself does.
  float ph = 0.52 * hgPhase(c, srcG(0.82, uCloudSrcAng))
           + 0.28 * hgPhase(c, srcG(0.38, uCloudSrcAng)) + 0.20 * 0.0796;
  // Soft-limit the forward lobe, exactly as the dome does for its own Mie peak.
  //
  // hgPhase(1, 0.82) is 4.48 — 56x isotropic — and a moon is a four-degree
  // source, not a point, so nothing in the sky can actually deliver that peak.
  // Left uncapped it put the veil immediately around Masser at 2.4x the moon's
  // own capped disc radiance: the review's "overexposed white plume fused to the
  // moon, by far the brightest thing in the frame, reads as a comet tail". The
  // asymptote is 1.8x isotropic-times-20, which is still an unmistakable silver
  // lining and is under the disc.
  ph = ph / (1.0 + ph * 0.55);
  // Silver lining proper: it is the THIN edge of a filament that lights up,
  // because that is where the forward-scattered beam gets out again. Weighting
  // the sunward lobe by how little sheet the ray crossed is that, for one mad.
  ph *= 0.72 + 0.75 * (1.0 - cov);

  // Radiance PER UNIT of the coverage this function also returns.
  //
  // The caller composites L * a, so L is the source term of an optically thin
  // slab: sunRadiance * phase, plus a small in-sheet multiple-scattering term
  // that grows with how much sheet there is. The 3.4 - 2.0 * cov that used to
  // sit here is not a scattering quantity at all — it is a flat 2.4x to 3.4x
  // gain — and it is the single reason every "clear" sky in the build measured
  // as an achromatic cream field. On the coast frame the veil arrived at 2.6
  // radiance against a dome of 0.25, i.e. ten times the sky it hangs in, so it
  // buried the scattering integral, sat on the tonemapper's shoulder where AgX
  // takes the last of the chroma out, and put two fifths of the frame above
  // display 200 with a measured saturation of 0.02. A veil is a THIN layer: it
  // cannot return more than the light falling on it, and at the phase angles
  // these frames sit at that is around 0.1 to 1.0, not 2.6.
  //
  // Self-shadowing along the LIGHT path, not the view path.
  //
  // Without it every filament in the sheet is lit identically no matter how much
  // ice the beam had to cross to reach it, so the veil has exactly one colour —
  // the sun's — over the whole dome, and the only variation left is the phase
  // function, which is a smooth function of angle and therefore paints a single
  // radial ramp. A sheet whose optical depth runs from 0 to 3 across a filament
  // cannot be uniformly lit. The 0.45 is the diffusion-corrected extinction of a
  // strongly forward-scattering medium (similarity, at ice's g~0.85): most of
  // what is "removed" from the beam is still going forward, so a cirrus does not
  // go black at depth, it goes DIFFUSE — which is precisely the regime where the
  // sky terms below take over.
  float lz = max(abs(uCloudLightDir.y), 0.12);
  float sunT = exp(-min(cov * uCirrus * 4.6 * (0.34 / lz) * 0.45, 20.0));

  // Radiance PER UNIT of the coverage this function also returns.
  //
  // The caller composites L * a, so L is the source term of an optically thin
  // slab: sunRadiance * phase, plus a small in-sheet multiple-scattering term
  // that grows with how much sheet there is. The 3.4 - 2.0 * cov that used to
  // sit here is not a scattering quantity at all — it is a flat 2.4x to 3.4x
  // gain — and it is the single reason every "clear" sky in the build measured
  // as an achromatic cream field. On the coast frame the veil arrived at 2.6
  // radiance against a dome of 0.25, i.e. ten times the sky it hangs in, so it
  // buried the scattering integral, sat on the tonemapper's shoulder where AgX
  // takes the last of the chroma out, and put two fifths of the frame above
  // display 200 with a measured saturation of 0.02. A veil is a THIN layer: it
  // cannot return more than the light falling on it, and at the phase angles
  // these frames sit at that is around 0.1 to 1.0, not 2.6.
  //
  // The sky term is now a real hemispheric integral of two real illuminants
  // rather than 'uCloudAmb * 0.20'. Ice is conservative and grey, so what a
  // filament returns is the light falling on it, redistributed: a source term of
  // 0.5 * L per hemisphere, because the phase function integrates to one over the
  // sphere and each hemisphere is half of it. uCirrusSkyUp is the deep blue of
  // the Rayleigh column over 7.4km and uCirrusSkyDn is the warm planet under it,
  // so the veil carries an honest top-to-bottom hue split, and where sunT has cut
  // the beam the two of them are ALL the filament has — which is why a shaded
  // fallstreak now reads markedly cooler than a sunlit one instead of being the
  // same cream at a different exposure.
  vec3 L = capToSource(uCirrusSun * (ph * sunT + 0.30 * cov * 0.0796 * sunT),
                       uCloudKeyMax)
         + (uCirrusSkyUp + uCirrusSkyDn) * 0.5;
  return vec4(L * a, a);
}

/**
 * Everything above the haze, as it should be composited over the finished sky:
 * scattered radiance already attenuated by the air between the eye and each
 * layer, plus the combined transmittance. Doing the attenuation here rather than
 * at the compositing site is what lets the half-resolution pass write a buffer
 * the dome can use with a single texture fetch and no extra channels.
 *
 * The veil is at 7.4km and the deck tops out at 4.6km, so the deck is always in
 * front and occludes it.
 */
vec4 cloudLayer(vec3 rd, float dither) {
  float cirDist;
  vec4 cir = cirrusLayer(rd, cirDist);

  float cd;
  vec4 cl = marchClouds(vec3(0.0, uCamY, 0.0), rd, dither, cd);

  vec3 Tcl = slabT(rd, cd);
  vec3 rgb = cl.rgb * Tcl;
  vec3 Tci = vec3(1.0);
  if (cir.a > 0.002) {
    Tci = slabT(rd, cirDist);
    // Extinction without its in-scatter is the ABSORBING limit, and the column
    // under a 7.4km veil does not absorb — it scatters.
    //
    // A grazing ray to the veil crosses three hundred kilometres of air. slabT
    // over that is (0.6, 0.35, 0.09): the sheet's blue is essentially deleted and
    // nothing is put back, so the veil emerged at an ORANGE more saturated than
    // any illuminant in the scene. Measured by ablating it out of the environment
    // bake, the veil was 4.4% of the world's diffuse irradiance and 22% of that
    // irradiance's saturation, and its net contribution had a NEGATIVE blue
    // channel — a layer of ice that removes blue light from the sky.
    //
    // What a real column does is replace the removed radiance with its own
    // airlight, which is why a distant cloud goes pale blue-grey and never dark
    // red. The deck gets exactly that treatment at the compositing site; the veil
    // could not, because the half-res buffer has no channel left to carry a
    // second distance. So it converges here on the hemispheric sky radiance
    // instead — the same uSkyAmbient / PI the particulate layer is driven by, so
    // the two cannot disagree about what the air between things is worth. It is
    // directionless where the compositing site's is not, which is an
    // approximation and is a far smaller error than deleting the blue outright.
    //
    // Only the part of the column the compositing site does NOT already account
    // for: it grants the airlight in front of the DECK to everything the layers
    // occlude, and the veil's own column is the deck's plus the rest.
    vec3 front = vec3(1.0) - slabT(rd, max(shellFar(Rg + max(uCamY, 1.0), rd.y, Rg + uCloudBottom), 0.0));
    vec3 air = max(vec3(1.0) - Tci - front, vec3(0.0));
    rgb += (cir.rgb * Tci + uSkyAmbient * (1.0 / PI) * cir.a * air) * cl.a;
  }

  // The layers' TRUE combined transmittance. Not an aerial-faded one.
  //
  // What used to be returned here was 1 - (1 - cl.a) * mean(Tcl), i.e. the
  // deck's opacity multiplied down by the transmittance of the air in front of
  // it, so that a grazing deck at 40km — where slabT hands back 3% — dissolved
  // into the horizon band instead of rendering as a hard black slab. The intent
  // was right and the mechanism was wrong: an opaque cumulus is opaque, and
  // lowering its ALPHA does not make the air in front of it glow, it makes the
  // cloud transparent to everything BEHIND it. Measured on the night frame, that
  // is a full star field composited over the darkest part of the cloud bank at
  // undiminished brightness across the whole width of the deck — a body of water
  // vapour a kilometre thick with stars visible through it.
  //
  // So the deck now occludes honestly and the compositing site (see main) puts
  // the airlight back where it belongs: in FRONT of the cloud, added, not
  // subtracted from the cloud's own opacity. Silhouettes still dissolve into the
  // haze on the same schedule the terrain under them does; the stars no longer
  // come with them.
  return vec4(rgb, clamp(cl.a * (1.0 - cir.a), 0.0, 1.0));
}

// ------------------------------------------------------------ atmosphere ----

#ifdef CLOUD_PASS

// Half-resolution cloud pass. No atmosphere, no stars, no moons: just the
// march, written premultiplied-by-nothing as (scattered radiance, layer
// transmittance) for the dome to composite.
void main() {
  vec3 rd = normalize(uCamBasis * vec3(vNdc.x * uTanHalf.x, vNdc.y * uTanHalf.y, -1.0));
  gl_FragColor = cloudLayer(rd, ditherBN(gl_FragCoord.xy));
}

#else

/**
 * The atmosphere's in-scattered radiance along the ray, with the view transmittance
 * and the ground/horizon bookkeeping the dome needs on top of it.
 *
 * Lifted out of main() so the SKY-VIEW pass (below) can evaluate EXACTLY this
 * function into a small directional table, which the shared aerial block then
 * uses as the value distant geometry converges on. Terrain-at-infinity and the
 * sky it is silhouetted against are then the same number by construction rather
 * than by two models tuned to agree — which is what removes the 21-level step
 * across the horizon line the review measured on the ridge frame.
 */
vec3 atmosphere(vec3 rd, out vec3 Tview, out float gFade, out float tG,
                out float tMax, out float cosS) {
  float r0 = Rg + max(uCamY, 1.0);
  float mu = rd.y;

  tG = distToGround(r0, mu);
  float tSky = distToTop(r0, mu);

  // Whether a ray intersects the planet is a hard boolean, and integrating to a
  // different endpoint either side of it is a hard STEP in radiance: a grazing
  // ray that misses the surface carries another four hundred kilometres of
  // Rayleigh in-scatter that one terminating at the tangent point does not.
  // Measured on the ridge frame that landed as a 21-level jump in blue inside a
  // single row at the skyline, with a 4px flat band above it — the "hard fog wall
  // with a terrain/sky fog mismatch" the review called an instant fail, and it is
  // the DOME's, not the fog's.
  //
  // Real terrain relief at horizon distance subtends far more than the zero width
  // this transition has, so blending the endpoint (and, in main, the ground's own
  // albedo term) across about a degree and a half of elevation is both the fix
  // and the physically honest description. Everything downstream — the integral,
  // the haze path length, the sky-view table the fog converges on — is then
  // continuous through the horizon by construction.
  float hMu = -sqrt(max(0.0, 1.0 - (Rg * Rg) / (r0 * r0)));
  // Anchored AT the horizon and ramping downward only, not straddling it.
  //
  // A symmetric band around hMu is wrong for a low eye: at three metres above
  // the sea hMu is 0.09 degrees, so a band of +/-1.3 degrees put half its weight
  // on directions that do not intersect the planet at all, where tG is not a
  // distance but the tangent fallback — and geometrically interpolating toward a
  // meaningless endpoint collapsed tMax from 700km to 950m in the two texel rows
  // either side of level. Below the horizon every ray really does hit the
  // ground, so the ground endpoint and the ground albedo are both defined over
  // the whole band, and smoothstep is C1 at the top of it.
  gFade = smoothstep(hMu, hMu - 0.026, mu);
  // The ground endpoint has to be CONTINUOUS across the horizon or the blend has
  // nothing to blend: distToGround returns -1 the instant the ray misses, and
  // falling back to the sky endpoint there re-creates the same step one blend
  // later. The tangent distance -r*mu is exactly what tG converges to as the ray
  // grazes, and it is defined on both sides, so extending the ground branch with
  // it makes the endpoint C0 through the crossing.
  tG = tG > 0.0 ? tG : max(-r0 * mu, 0.0);
  // GEOMETRIC blend of the two endpoints, not linear — and this, not the width
  // of the band above, is what actually removed the wall.
  //
  // The two endpoints are not the same order of magnitude: from a coastal eye
  // tSky is 800 km and tG, half a degree below level, is 600 m. A linear mix of
  // numbers 1300:1 apart is the LARGER one until the weight is within a percent
  // of 1, so the whole transition collapsed into the last few percent of the
  // blend no matter how wide the band was made. Measured off the sky-view table
  // on the night vantage, the radiance sat flat at 0.0080 down to 0.67 degrees
  // below level and was 0.00076 one texel later: a factor of ten inside a
  // quarter of a degree, i.e. four pixels. That IS the razor-straight fog wall,
  // and every fogged surface in the game converges on this table, so the wall
  // was in the terrain as well as in the dome.
  //
  // In-scatter saturates as 1 - exp(-sigma * L), so it is log(L), not L, that
  // the eye reads linearly. Interpolating the endpoint geometrically spreads the
  // hand-off evenly across the whole band, and is exact at both ends.
  tMax = min(exp(mix(log(max(tSky, 1.0)), log(max(tG, 1.0)), gFade)), 2.0e6);

  // 18, not 22. Two LUT fetches per step over every sky pixel is the dome's
  // dominant cost, and the integrand is smooth: measured against the 22-step
  // result the gradient moves by well under one 8-bit level anywhere, which the
  // dither at the bottom of this function covers on its own.
  const int N = 18;
  vec4 od = vec4(0.0);
  vec3 inscat = vec3(0.0);
  vec3 multi = vec3(0.0);
  cosS = dot(rd, uSunDir);
  float pr = rayleighPhase(cosS);
  // Dual-lobe Mie. Ash is a much coarser aerosol than water haze, and coarse
  // aerosol has a forward peak an order of magnitude tighter than a single
  // g=0.68 lobe can express. That second lobe is the solar aureole — the
  // burning halo around the disc that makes a dust-loaded sunset read as
  // Ashenreach rather than as a generic gradient.
  float pm = mix(hgPhase(cosS, uMieG), hgPhase(cosS, 0.94), 0.22);
  // Soft-limit the forward lobe. Single-scattering Henyey-Greenstein runs to
  // ~7x isotropic inside a few degrees of the disc, and at that radiance every
  // channel clears the tonemapper's shoulder together, so the aureole — the one
  // part of the sky that should be the most saturated amber in the frame —
  // renders as neutral milky white (measured 250,250,244 on the coast shot with
  // the sun just off-frame). Physically the peak is also exactly where single
  // scattering stops describing the light: at this aerosol load the near-solar
  // radiance is dominated by photons that have scattered several times and the
  // lobe is broadened and capped. The asymptote is 23x isotropic, which is a
  // bright aureole that still leaves the blue channel below saturation, so the
  // lobe now burns out in the sun's own chromaticity.
  pm = pm / (1.0 + pm * 0.55);
  float prev = 0.0;
  Tview = vec3(1.0);

  for (int i = 1; i <= N; i++) {
    float f = float(i) / float(N);
    float t = tMax * f * f;
    float ds = t - prev;
    float mid = (t + prev) * 0.5;
    prev = t;

    vec3 p = vec3(0.0, r0, 0.0) + rd * mid;
    float rs = length(p);
    float h = max(rs - Rg, 0.0);

    float dR = exp(-h / uScaleH.x);
    float dM = exp(-h / uScaleH.y) * uMieMul;
    float dO = max(0.0, 1.0 - abs(h - 25000.0) / 15000.0);
    // The ash load rides the same weather multiplier as the aerosol: an ash
    // storm is more suspended glass, not just more scattering.
    float dA = exp(-h / uScaleH.z) * uMieMul;

    od += vec4(dR, dM, dO, dA) * ds;
    Tview = exp(-(uBetaR * od.x + uBetaME * od.y + uBetaO * od.z + uBetaA * od.w));

    float muS = dot(p / rs, uSunDir);
    vec3 Ts = sunTransmittance(rs, muS);
    // Sunlight that still reaches 42km even when this sample is in the
    // planet's shadow. This is the second-order source: it keeps twilight
    // alive after the ground has gone dark, and — critically — it goes to zero
    // once the sun is more than ~7 degrees down, which a constant floor never
    // did. That floor was worth 0.027 of permanent grey radiance at the zenith,
    // and it was the entire reason the night sky was a flat olive wash with the
    // star field buried under it.
    vec3 TsHi = sunTransmittance(min(rs + 42000.0, Rt - 1.0), muS);

    vec3 sR = uBetaR * dR;
    vec3 sM = uBetaMS * dM;
    inscat += Tview * Ts * (sR * pr + sM * pm) * ds;
    // Isotropic stand-in for higher scattering orders. Without it twilight
    // collapses to black and thick haze loses its glow.
    multi += Tview * (sR + sM) * (Ts * 0.50 + TsHi * 0.17) * 0.0796 * ds;
  }

  vec3 sky = (inscat + multi * uMsBoost) * uSunE * uSunTint;

  // Moonlight scattered by the same column. Cheap, because the moons are never
  // bright enough to need a second march: one evaluation against the optical
  // depth already accumulated is indistinguishable. This is what makes a
  // moonlit sky a deep blue instead of black, and what makes the moons read as
  // light sources rather than as decals pasted on a dark backdrop.
  //
  // Skipped entirely whenever no moon is above the horizon — which is every
  // daylight frame, because setMoonLight writes black once the disc sets. The
  // branch is on a uniform, so every lane in every wave takes the same side of
  // it and it costs nothing; what it saves is two Henyey-Greenstein evaluations,
  // two Rayleigh phases and a dozen vec3 products on every one of the two
  // million sky pixels of a day shot. That pays for the extra arithmetic the
  // particulate layer picked up below, several times over, on six of the eight
  // canonical shots.
  if (uMasserLight.r + uMasserLight.g + uMasserLight.b
    + uSecundaLight.r + uSecundaLight.g + uSecundaLight.b > 1e-6) {
  float cM = dot(rd, uMasserDir);
  float cS = dot(rd, uSecundaDir);
  // Closed-form single scatter along the column. Two things this gets right
  // that the previous beta*od*Tview form did not: od.y already carries uMieMul
  // from the march, so multiplying by it again counted the weather load twice
  // (a 6x over-estimate in an ash storm); and beta*od has no saturation, so an
  // optically thick column kept growing without bound instead of tending to the
  // single-scattering albedo. The (1-T)/ext factor is exactly the one the
  // shared aerial block uses, so the sky and the fog cannot drift apart.
  // The 0.75 stands in for the moonlight's own extinction, which varies along
  // the path where uMasserLight is a single value for the whole column.
  vec3 odExt = uBetaR * od.x + uBetaME * od.y + uBetaO * od.z + uBetaA * od.w;
  vec3 msat = 0.75 * (1.0 - Tview) / max(odExt, vec3(1e-6));
  vec3 moonR = uBetaR * od.x * msat;
  vec3 moonM = uBetaMS * od.y * msat;
  // Once the ash column is no longer optically thin, most of what arrives has
  // been scattered more than once and has forgotten the forward lobe. Without
  // this the g=0.68 peak is applied to the whole column and the moon paints a
  // 60-degree lit aureole across the night sky.
  //
  // The moons get their OWN asymmetry, not the sun's. g=0.68 is the aerosol's
  // bulk phase and its lobe is ~40 degrees wide; hung off a source as weak as a
  // moon it produced a wash that lifted the whole left half of the dome by 3x
  // and was still 2.4x the far-side sky 450px from the disc. A lunar aureole is
  // a tight forward feature — a few degrees of scattered light around the disc,
  // not a quadrant of lit sky — so the moon term uses g=0.90, whose lobe falls
  // off inside about 8 degrees. Same medium, correct grain size for the feature.
  //
  // The lobe is also CAPPED. Henyey-Greenstein diverges as g -> 1 on axis: at
  // g=0.90 it returns 15.1 at zero degrees, 190x the isotropic value, and since
  // the moon's disc is only four degrees wide that spike sits entirely ON the
  // disc. A real polydisperse aerosol has no such spike — averaging the
  // diffraction lobe over a size distribution flattens the first few degrees —
  // and the unflattened version was measured laying more green and blue over
  // Masser's pixels than Masser's own surface was emitting, which is precisely
  // how a red body renders cream. 4.5 keeps a ten-degree aureole and stops
  // hallucinating a searchlight in the middle of it.
  //
  // ...and the lobe is also WIDENED by each moon's own angular radius (srcG).
  // The 3.0 clamp above stops the divergence but leaves a hard-edged plateau of
  // constant radiance over the whole four-degree disc — which is a searchlight
  // with a flat top, and it is what filled Masser's terminator in and buried its
  // crater field under a wash of in-scattered light. A source that large simply
  // cannot produce a lobe narrower than itself.
  float mfwd = exp(-odExt.g);
  float phM = mix(0.0796, min(hgPhase(cM, srcG(0.90, uMoonAng.x)), 3.0), mfwd);
  float phS = mix(0.0796, min(hgPhase(cS, srcG(0.90, uMoonAng.y)), 3.0), mfwd);
  sky += uSunTint * (
      uMasserLight * (moonR * rayleighPhase(cM) + moonM * phM)
    + uSecundaLight * (moonR * rayleighPhase(cS) + moonM * phS));
  }

  // ---- night terms -------------------------------------------------------
  //
  // Below the horizon there is no solar in-scatter left to set the sky's colour,
  // so whatever the ash layer's multiple-scattering pedestal happens to be
  // becomes the whole night sky — which is how 23:24 came out a warm neutral
  // beige at 66/63/62, i.e. an underexposed overcast afternoon. Two things a
  // real night has that this did not:
  //
  //  - airglow. A faint 557.7nm oxygen band, brightest at 10-15 degrees where
  //    the line of sight runs longest through the emitting layer at 95km, and
  //    genuinely green-cyan.
  //  - the Purkinje shift. Below about 0.01 cd/m2 the rods take over and the
  //    perceived hue of everything slides toward blue. This is a perceptual
  //    effect, so it is applied as a hue rotation weighted by how far BELOW
  //    scotopic threshold the pixel already is, and it leaves anything bright
  //    enough for the cones — the moons, the lit cloud tops — untouched.
  float night = 1.0 - smoothstep(-0.16, 0.02, uSunDir.y);
  if (night > 0.002) {
    float el = max(rd.y, 0.0);
    // sec(z) growth of the emitting-layer path, cut off at the horizon where
    // the column below the layer absorbs it.
    float glowBand = exp(-pow((el - 0.21) / 0.20, 2.0)) * smoothstep(0.0, 0.06, el);
    sky += vec3(0.10, 0.42, 0.34) * 0.0016 * glowBand * night;
  }

  return sky;
}

/**
 * The particulate layer, composited over whatever is behind it along the view ray.
 * Shared verbatim by the dome, by the sky-view table and — through the identical
 * hazeRadiance call in Aerial.ts — by every distance-fogged surface in the game.
 */
vec3 applyHaze(vec3 col, vec3 rd, float tMax) {
  if (uHazeDensity <= 1e-7) return col;
  // Same path length above and below the horizon; a constant here would put a
  // hard seam exactly along the skyline.
  float dist = min(tMax, 2.0e5);
  float odH;
  vec3 hs = hazeRadiance(uHazeTint, uHazeDeep, uHazeDensity, uHazeH, uCamY, rd, dist,
                         uHazeSunDir, uCloudSrcAng, uHazeSun,
                         uSkyAmbient * (1.0 / PI), uHazeWind, odH);
  float Th = exp(-odH);
  return col * Th + hs * (1.0 - Th);
}

/**
 * The Purkinje shift. Below roughly 1e-3 of the noon zenith's radiance the rods
 * carry the image and the cones do not, and rod spectral sensitivity peaks 50nm
 * blue of photopic — which is why a moonlit landscape is SEEN as blue-grey no
 * matter what the physical spectrum of the moonlight is. The weight is driven by
 * the pixel's own luminance, so the moons and any moonlit cloud top stay in cone
 * territory and keep their real colour while the sky around them goes cool.
 */
vec3 purkinje(vec3 col) {
  if (uSunDir.y >= 0.02) return col;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  // Upper bound 0.055, not 0.030. The mesopic range is roughly three decades of
  // luminance, and a moonlit cloud top sits in the middle of it, not above it:
  // at 0.030 the deck was already fully photopic, kept every degree of its key
  // light's warmth, and the night sky read as an underexposed afternoon. The
  // moons themselves and any lightning stay far above this and are untouched.
  float rods = (1.0 - smoothstep(-0.16, 0.02, uSunDir.y))
             * (1.0 - smoothstep(0.0012, 0.055, lum));
  return mix(col, vec3(lum * 0.58, lum * 0.90, lum * 1.86), rods * 0.72);
}

/**
 * The analytic ground disc: the radiance of the planet's own surface in a
 * direction that intersects it, before the air in front of it.
 *
 * Lifted out of main() because the SKY-VIEW table needs it too, and that is the
 * second half of the fog wall. The table is what every fogged surface in the
 * game converges on at optical infinity, and it was integrating the atmosphere
 * ALONE — so below the horizon, where the column is truncated by the ground a
 * few hundred metres out, it handed back near-black. A ridge at two kilometres
 * was therefore told to converge toward a value darker than the ground in front
 * of it, which is the review's "aerial perspective running backwards", and the
 * table's own horizon row was a ten-to-one step, which is the wall. Below the
 * horizon the answer is the ground, and now the table says so.
 */
vec3 groundDisc(vec3 rd, float r0, float tG, float gFade) {
  if (gFade <= 0.002) return vec3(0.0);
  vec3 gn = normalize(vec3(0.0, r0, 0.0) + rd * tG);
  vec3 Tg = sunTransmittance(Rg + 1.0, max(dot(gn, uSunDir), -0.2));
  float ndl = max(dot(gn, uSunDir), 0.0);
  return uGroundAlbedo * (Tg * uSunE * uSunTint * ndl / PI + uSkyAmbient * 0.5) * gFade;
}

#ifdef SKYVIEW_PASS

/**
 * Sky-view table: the dome's own radiance, as a function of direction only.
 *
 * 256x128 of RGBA16F, re-rendered every frame. Everything the aerial block needs
 * distant geometry to converge on — the scattering integral and the particulate
 * layer, in that order, with the same night terms — and nothing it must not: no
 * clouds, no moons, no stars, because those sit BEHIND the fog, not inside it.
 *
 * Elevation is square-root warped about the horizon so the band where the value
 * changes fastest, and where every fogged silhouette in the game sits, gets the
 * texels. Azimuth wraps, so the table is Repeat in x and there is no seam.
 */
void main() {
  vec2 uv = vNdc * 0.5 + 0.5;
  float az = (uv.x - 0.5) * 6.283185307;
  float ev = uv.y * 2.0 - 1.0;
  float el = sign(ev) * ev * ev * 1.5707963268;
  float ce = cos(el);
  vec3 rd = normalize(vec3(cos(az) * ce, sin(el), sin(az) * ce));

  vec3 Tview; float gFade, tG, tMax, cosS;
  vec3 sky = atmosphere(rd, Tview, gFade, tG, tMax, cosS);
  float r0 = Rg + max(uCamY, 1.0);
  sky += groundDisc(rd, r0, tG, gFade) * Tview;
  gl_FragColor = vec4(max(purkinje(applyHaze(sky, rd, tMax)), 0.0), 1.0);
}

#else

void main() {
  vec3 rd = normalize(vWorld);
  vec3 Tview; float gFade, tG, tMax, cosS;
  vec3 sky = atmosphere(rd, Tview, gFade, tG, tMax, cosS);
  float r0 = Rg + max(uCamY, 1.0);

  // Everything beyond the atmosphere, attenuated by the full column. The two
  // branches CROSS-FADE over the same band the endpoint blend uses, so neither
  // the ground's albedo nor the star field switches on at a line: the analytic
  // ground disc must not appear at the horizon like a light. Whether a ray
  // intersects the planet is a hard boolean, but the radiance either side of it
  // is very nearly continuous — a ray that grazes the surface and one that
  // misses it by a metre have travelled through the same air — and adding the
  // albedo as a step put a 21-level jump in blue into a single row at the
  // skyline. Ramping it over a degree of elevation, which is more than the
  // angular scale real relief at horizon distance subtends, makes the crossing
  // a gradient. Shared verbatim with the sky-view table (see groundDisc), so
  // the fog converges on exactly what the dome draws.
  vec3 space = groundDisc(rd, r0, tG, gFade);
  if (gFade < 0.998) {
    // A star is only visible against a sky darker than it is. Fading the field
    // against the in-scattered radiance this pixel already carries is the
    // physical version of that, and it is what stops a dusk frame — sky still
    // at 160/255 — from carrying a full field of hot single pixels, and stops
    // the moon's own aureole from having stars drawn on top of it.
    // Everything in this block is night-only, and the gate is a uniform, so every
    // lane in every wave takes the same side of it. On a day frame it removes two
    // acos, the whole star evaluation and the veiling term's exponentials from
    // every one of the two million sky pixels.
    vec3 sp = vec3(0.0);
    if (uStarBright > 0.004) {
      float skyLum = dot(sky, vec3(0.2126, 0.7152, 0.0722));
      // ...but that is the scattering integral ALONE, and after dusk almost all
      // of the brightness a star has to compete with is the particulate layer,
      // which is composited further down. That is why a full field survived into
      // the horizon glow at (1500-1900, 380-450) at undiminished brightness. The
      // layer's own optical depth along this ray is a closed form (two
      // exponentials — hazeOD carries no noise and no march), so folding its
      // share of the ambient into the veiling term costs almost nothing and makes
      // the field fade into the horizon band the way a real one does.
      float odVeil = uHazeDensity * hazeOD(uCamY, rd.y, min(tMax, 2.0e5), uHazeH);
      float veil = skyLum
                 + dot(uSkyAmbient, vec3(0.2126, 0.7152, 0.0722))
                   * (1.0 - exp(-min(odVeil, 40.0))) * 0.25;
      // A moon is an OPAQUE body 380,000km away; the stars are behind it. Both
      // are additive terms in this accumulator, so the star field has to be
      // masked by the discs explicitly or it composites straight through them —
      // the "star specks sitting on top of the lit crater field" defect. (The
      // cloud deck already occludes them correctly: the composite below
      // multiplies everything here by the deck's transmittance.)
      float occ = max(moonCover(rd, uMasserDir, uMoonAng.x),
                      moonCover(rd, uSecundaDir, uMoonAng.y));
      sp = stars(rd) * exp(-veil * 40.0) * (1.0 - occ);
    }
    sp += moon(rd, uMasserDir, uMoonAng.x, uMasserTint, 3.1, uMoonBright.x, 1.0);
    sp += moon(rd, uSecundaDir, uMoonAng.y, uSecundaTint, 71.3, uMoonBright.y, 0.0);

    float ang = acos(clamp(cosS, -1.0, 1.0));
    float spx = max(uTanHalf.y * uCloudTexel.y, 1e-5);
    // One pixel of angular footprint, not 3% of the angular radius: at a 0.0125
    // rad disc 3% is a third of a pixel, i.e. a hard cutout with a staircase rim.
    float disc = 1.0 - smoothstep(uSunAng - spx, uSunAng + spx, ang);
    float x = sqrt(max(0.0, 1.0 - pow(min(ang / uSunAng, 1.0), 2.0)));
    float limb = 0.36 + 0.64 * pow(x, 0.45);
    // The disc on its own is a blown dot with nothing around it: measured on the
    // dawn frame, 41 pixels of pure 255 and essentially no falloff, so it read as
    // a hole punched in the image rather than as a source. What a real low sun
    // has instead is an AUREOLE — a forward-scattered skirt carrying several
    // degrees of graded radiance, which is what the bloom needs to work with and
    // what makes the disc read as an object with size. Three exponentials, all
    // hung off uSunAng so they scale with the disc, and all attenuated by the
    // view column below (space * Tview) so an ash storm eats them exactly as
    // it eats the disc.
    //
    // The peak comes down from 130 to 52 at the same time: 1430 units of radiance
    // was several stops above anything the tonemapper's shoulder could roll off,
    // so all three channels saturated together and the sun had no colour left.
    float aur = 0.155 * exp(-ang / (uSunAng * 2.2))
              + 0.032 * exp(-ang / (uSunAng * 9.0))
              + 0.008 * exp(-ang / (uSunAng * 34.0));
    sp += uSunTint * uSunE * 52.0 * (disc * limb + aur) * (1.0 - uEnvCapture);
    space += sp * (1.0 - gFade);
  }

  vec3 spaceLit = space * Tview;

  // The march itself runs at half resolution in its own pass; this is a single
  // bilinear fetch of that buffer. uCloudMode drops back to an inline march for
  // the 64px environment cube capture, which has no buffer to read from.
  // Inverting the pass's own ray construction, rather than dividing
  // gl_FragCoord by a resolution uniform: the HDR target is scaled by the
  // pipeline's render scale and the device pixel ratio and is TAA-jittered, so
  // a screen-space mapping would drift. This one is exact by construction.
  vec4 cl;
  if (uCloudMode > 0.5) {
    vec3 vv = rd * uCamBasis;                       // transpose(basis) * rd
    vec2 ndc = vec2(vv.x / (uTanHalf.x * max(-vv.z, 1e-4)),
                    vv.y / (uTanHalf.y * max(-vv.z, 1e-4)));
    // Reconstruction filter, not a stochastic blit.
    //
    // What was here jittered a single bilinear fetch by up to a full half-res
    // texel and left TAA to integrate the error away. That works only while TAA
    // is converging on a static frame; the instant the buffer's own content is
    // noisy (which, at grazing angles, it is) the jitter ADDS variance instead of
    // removing it, and the result is the "checkerboard texel pattern with 2-4px
    // diagonal stair-stepping through every cloud edge" the review measured. A
    // plain bilinear magnification is no better: it is a 2x2 block.
    //
    // Catmull-Rom instead, as five bilinear taps (Sigg & Hadwiger's factorisation
    // of the 4x4 kernel). It is C1 and interpolating, so a half-res edge
    // magnifies into a smooth full-resolution ramp with no blocking and no added
    // noise, and it costs four extra fetches on sky pixels only.
    vec2 texSize = 1.0 / uCloudTexel;
    vec2 uv = ndc * 0.5 + 0.5;
    vec2 tc = uv * texSize - 0.5;
    vec2 fxy = fract(tc);
    tc = floor(tc);

    vec2 w0 = fxy * (-0.5 + fxy * (1.0 - 0.5 * fxy));
    vec2 w1 = 1.0 + fxy * fxy * (-2.5 + 1.5 * fxy);
    vec2 w2 = fxy * (0.5 + fxy * (2.0 - 1.5 * fxy));
    vec2 w3 = fxy * fxy * (-0.5 + 0.5 * fxy);

    vec2 w12 = w1 + w2;
    vec2 o12 = w2 / max(w12, vec2(1e-5));
    vec2 t0 = (tc - 1.0 + 0.5) * uCloudTexel;
    vec2 t3 = (tc + 2.0 + 0.5) * uCloudTexel;
    vec2 t12 = (tc + 0.5 + o12) * uCloudTexel;

    // Nine taps (3x3 of bilinear fetches), not the usual five. The five-tap
    // factorisation drops the four corners of the 4x4 kernel, so its weights do
    // not sum to one and it loses a little energy wherever the sub-texel
    // position is near a diagonal — which on a transmittance buffer shows up as
    // a faint diagonal lattice, i.e. the artefact this is meant to remove.
    cl  = texture(uCloudBuf, vec2(t0.x,  t0.y))  * (w0.x  * w0.y);
    cl += texture(uCloudBuf, vec2(t12.x, t0.y))  * (w12.x * w0.y);
    cl += texture(uCloudBuf, vec2(t3.x,  t0.y))  * (w3.x  * w0.y);
    cl += texture(uCloudBuf, vec2(t0.x,  t12.y)) * (w0.x  * w12.y);
    cl += texture(uCloudBuf, vec2(t12.x, t12.y)) * (w12.x * w12.y);
    cl += texture(uCloudBuf, vec2(t3.x,  t12.y)) * (w3.x  * w12.y);
    cl += texture(uCloudBuf, vec2(t0.x,  t3.y))  * (w0.x  * w3.y);
    cl += texture(uCloudBuf, vec2(t12.x, t3.y))  * (w12.x * w3.y);
    cl += texture(uCloudBuf, vec2(t3.x,  t3.y))  * (w3.x  * w3.y);
    // Catmull-Rom overshoots on a hard alpha edge; transmittance below zero or
    // above one would composite as negative light.
    cl = vec4(max(cl.rgb, vec3(0.0)), clamp(cl.a, 0.0, 1.0));
  } else {
    cl = cloudLayer(rd, ditherBN(gl_FragCoord.xy));
  }
  // Composite the deck. Two different occlusions, because there are two
  // different things behind it.
  //
  // The sun, the moons and the stars are genuinely BEHIND the cloud, so they get
  // the layer's true transmittance and nothing else — that is what stops a star
  // field being drawn over a kilometre of water vapour.
  //
  // The column's own in-scatter is not behind it: most of it, for a distant
  // deck, is in FRONT. That airlight is what dissolves a 40km silhouette into
  // the horizon band, and it must be added rather than faked by thinning the
  // cloud. slabT over the geometric distance to the deck's base is exactly the
  // fraction of the column the deck cannot occlude, and it is the same closed
  // form the layer's own attenuation uses, so the two cannot disagree.
  // ...and that fraction is PER CHANNEL, which is not a detail: it is most of
  // why a cloud deck was the warmest thing in the frame.
  //
  // slabT over a grazing path to the deck is (0.75, 0.55, 0.25) — Rayleigh takes
  // three times as much blue as red — and the scalar mean of that is 0.52 in
  // every channel. So the deck's own radiance was correctly reddened by the
  // column in front of it, and then the blue airlight that column scatters INTO
  // the same path, which is what makes a distant cloud go pale blue-grey rather
  // than orange, was added back at the mean instead of at 0.75 in blue and 0.25
  // in red. Every distant cloud therefore kept the full chromatic extinction and
  // got only an achromatic fraction of the compensation.
  //
  // Measured on the ridge bake, the deck is 47% of the entire diffuse irradiance
  // of the world and came back at hue 31, saturation 0.73 — more saturated than
  // the sun that lights it, which is impossible for a grey medium and is exactly
  // the signature of extinction without its in-scatter. Since that half of the
  // IBL is what every shadowed surface in the game is lit by, an achromatic
  // approximation here is why nothing in shadow could differ in hue from
  // anything in sun.
  //
  // (The high veil at 7.4km has a far longer column than this and is compensated
  // only by the deck's much shorter one; it is 5% of the bake rather than 47%, so
  // it is left for a pass that can carry a second distance through the half-res
  // buffer.)
  float dDeck = max(shellFar(r0, rd.y, Rg + uCloudBottom), 0.0);
  vec3 front = vec3(1.0) - slabT(rd, dDeck);
  vec3 col = spaceLit * cl.a + sky * mix(vec3(cl.a), vec3(1.0), front) + cl.rgb;

  // Weather particulate, integrated over the whole ray so the sky itself
  // vanishes into ochre during an ash storm. uHazeSun / uHazeSunDir are literally
  // the same two values the shared aerial block reads, and applyHaze is literally
  // the function the sky-view table runs, so the fog and the sky it converges on
  // cannot drift apart: neither owns the number.
  col = purkinje(applyHaze(col, rd, tMax));

  // Triangular-PDF dither, relative to the local value. The HDR target is
  // half-float so this is not about the store: it is to decorrelate the
  // trilinear terraces of the grade LUT downstream, which is where a gradient
  // this smooth actually picks up its horizontal banding.
  //
  // 0.010, not 0.004. Relative amplitude has to be read against the SLOPE of the
  // display transfer at the value in question: at a display 0.65 sky one 8-bit
  // level is about 1.4% of the linear value, so 0.004 peak-to-peak was a third of
  // an LSB — enough to break a contour, not enough to be a proper noise floor
  // under one. At 0.010 the TPDF spans a full level, which is the amplitude at
  // which triangular dither actually decorrelates the quantiser. Animated with
  // the frame so TAA integrates it toward the true value rather than freezing a
  // fixed pattern into the plate.
  float d1 = ditherBN(gl_FragCoord.xy);
  float d2 = ditherBN(gl_FragCoord.xy + 23.71);
  col *= 1.0 + (d1 + d2 - 1.0) * 0.010;

  gl_FragColor = vec4(max(col * uExposure, 0.0), 1.0);
}

#endif
#endif
`;

export interface SkyUniforms {
  [k: string]: THREE.IUniform;
}

export function createSkyMaterial(
  lut: THREE.DataTexture,
  cloudTex: THREE.Data3DTexture,
  weather: THREE.DataTexture,
): THREE.ShaderMaterial {
  const v3 = (c: readonly [number, number, number]) => new THREE.Vector3(c[0], c[1], c[2]);
  const uniforms: SkyUniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunTint: { value: new THREE.Color(1, 1, 1) },
    uSunE: { value: SUN_E },
    uSunAng: { value: 0.0125 },
    uEnvCapture: { value: 0 },
    uTrans: { value: lut },
    uCamY: { value: 10 },

    uBetaR: { value: v3(BETA_RAYLEIGH) },
    uBetaMS: { value: v3(BETA_MIE_S) },
    uBetaME: { value: v3(BETA_MIE_E) },
    uBetaO: { value: v3(BETA_OZONE) },
    uBetaA: { value: v3(BETA_ASH) },
    uScaleH: { value: new THREE.Vector3(H_RAYLEIGH, H_MIE, H_ASH) },
    uMieG: { value: MIE_G },
    uMieMul: { value: 1 },
    uMsBoost: { value: 0.9 },
    /**
     * The analytic ground the dome draws below the horizon, and the value the
     * lower hemisphere of the IBL capture therefore carries.
     *
     * 0.075 is a 7.5% albedo — asphalt. The ash plain the palette names is
     * #8a7f72, which is 0.25/0.21/0.17 linear, and the consequence of being a
     * factor of three under it was a strip of near-black between the skyline and
     * the nearest terrain wherever the eye was high enough to see one. Kept a
     * little below the palette value because this is a whole-hemisphere average
     * and includes basalt.
     */
    uGroundAlbedo: { value: new THREE.Color(0.16, 0.135, 0.11) },
    uSkyAmbient: { value: new THREE.Color(0.05, 0.06, 0.08) },
    uExposure: { value: 1 },

    uMasserDir: { value: new THREE.Vector3(0, 1, 0) },
    uSecundaDir: { value: new THREE.Vector3(0, 1, 0) },
    // Secunda is up from 0.026: at 0.026 it subtended fewer than 60 screen
    // pixels at the night vantage's 68-degree field and a reviewer reported the
    // frame as having ONE moon in it. It stays clearly the smaller body — the
    // pair is still 2.4:1 by diameter — but it is now unmissable.
    uMoonAng: { value: new THREE.Vector2(0.075, 0.031) },
    // Masser is a rust-ochre body, not Earth's Moon. #8a4a30 -> #5a3020 in the
    // palette; this is the bright end of that range as a linear albedo, and the
    // dust/belt/fracture terms in moon() carry it down to the low end. A neutral
    // grey disc with a recognisable mare pattern is the single most obvious
    // art-direction miss this sky can make, because Masser is the most
    // recognisable object in the setting's night sky.
    uMasserTint: { value: new THREE.Color(0.88, 0.17, 0.065) },
    /** Secunda: pale bone, #d8c9a4. Cool-neutral, never blue-white. */
    uSecundaTint: { value: new THREE.Color(0.82, 0.79, 0.70) },
    uMoonBright: { value: new THREE.Vector2(1, 1) },
    uMasserLight: { value: new THREE.Color(0, 0, 0) },
    uSecundaLight: { value: new THREE.Color(0, 0, 0) },

    uStarFrame: { value: new THREE.Matrix3() },
    uStarBright: { value: 1 },
    uTime: { value: 0 },

    uCloudTex: { value: cloudTex },
    uWeather: { value: weather },
    uCloudWind: { value: new THREE.Vector2() },
    uCloudShear: { value: new THREE.Vector2() },
    uCoverage: { value: 0.25 },
    uCloudDensity: { value: 1 },
    uCloudType: { value: 0.5 },
    uCloudBottom: { value: CLOUD_BOTTOM },
    uCloudTop: { value: CLOUD_TOP },
    uCloudSteps: { value: 44 },
    uLightSteps: { value: 5 },
    uCloudLightDir: { value: new THREE.Vector3(0, 1, 0) },
    uCloudSrcAng: { value: 0.0125 },
    uCloudKeyMax: { value: 1.0e4 },
    uCloudSun: { value: new THREE.Color(1, 1, 1) },
    uCloudAmb: { value: new THREE.Color(0.1, 0.12, 0.16) },
    uCloudAmbDn: { value: new THREE.Color(0.06, 0.06, 0.06) },
    uLightning: { value: 0 },
    uCirrus: { value: 0.2 },
    uCirrusSun: { value: new THREE.Color(1, 1, 1) },
    uCirrusSkyUp: { value: new THREE.Color(0.01, 0.02, 0.05) },
    uCirrusSkyDn: { value: new THREE.Color(0.06, 0.05, 0.04) },
    uWindDir: { value: new THREE.Vector2(0.82, 0.57) },
    uHazeTint: { value: new THREE.Color(0.55, 0.42, 0.26) },
    uHazeDeep: { value: new THREE.Color(0.55, 0.42, 0.26) },
    uHazeDensity: { value: 0 },
    uHazeH: { value: 420 },
    uHazeSun: { value: new THREE.Color(0, 0, 0) },
    uHazeSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uHazeWind: { value: new THREE.Vector2() },

    // Half-res cloud buffer plumbing. Shared with the pass material, so one
    // write to any of these lands in both programs.
    uCloudBuf: { value: null },
    uCloudMode: { value: 1 },
    uCloudTexel: { value: new THREE.Vector2(1 / 960, 1 / 540) },
    uCamBasis: { value: new THREE.Matrix3() },
    uTanHalf: { value: new THREE.Vector2(1, 1) },
  };

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
}

/**
 * The sky-view table: the dome's radiance as a function of direction alone.
 *
 * Why this exists. Aerial perspective and the sky have to agree at infinity or
 * there is a step across the horizon line — and there was one: the ridge frame
 * measured a 4px flat band at (153,143,127) on the sky side stepping in a single
 * row to (150,129,106) on the terrain side, 21 levels in blue. That is not a
 * tuning error, it is two different models: the dome marches the full column with
 * LUT sun transmittance, ozone and multiple scattering, while applyAerial has a
 * closed-form exponential over a finite path. No amount of tuning makes two
 * different functions equal.
 *
 * So the fog stops guessing. This pass evaluates the DOME's own function into a
 * small directional table once per frame, and applyAerial hands over to it as the
 * path saturates. Terrain at infinity is then exactly the sky behind it, by
 * construction, and the step cannot exist.
 *
 * 256x128 RGBA16F is 128kB and ~33k invocations of an 18-step march — well under
 * a tenth of a millisecond, and it replaces per-pixel work the fog was doing
 * badly anyway.
 */
export class SkyViewPass {
  readonly material: THREE.ShaderMaterial;
  private rt: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  /** Lazily allocated readback staging for readIrradiance. */
  private readBuf: Uint16Array | null = null;

  constructor(uniforms: SkyUniforms) {
    this.material = new THREE.ShaderMaterial({
      uniforms,
      defines: { SKYVIEW_PASS: '' },
      vertexShader: PASS_VERT,
      fragmentShader: FRAG,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.rt = new THREE.WebGLRenderTarget(256, 128, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      // Azimuth wraps: clamping would put a seam down one compass bearing.
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
    this.rt.texture.colorSpace = THREE.NoColorSpace;
  }

  get texture(): THREE.Texture {
    return this.rt.texture;
  }

  render(renderer: THREE.WebGLRenderer): void {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prev);
  }

  /**
   * Cosine-weighted hemispheric irradiance of the dome, up and down, by reading
   * this table back and integrating it.
   *
   * This is the honest answer to "what is a shadowed surface lit by", and it is
   * a different number from the sun by construction rather than by authorship:
   * the table IS the scattering integral, evaluated for the eye's own altitude
   * and the current weather, and it contains no solar disc, no aureole, no
   * moons and no stars — only the medium's own radiance and the ground disc.
   *
   * Clouds are deliberately not in it. The deck's own illumination is
   * `uCloudAmb` / `uCloudAmbDn`, which are derived from this number, so feeding
   * the deck's radiance back in as the fill that lights it is a positive
   * feedback loop with a gain that depends on coverage — the exact shape of
   * instability that makes an overcast sky run away to white.
   *
   * A readback stalls the pipe, so the caller runs this at the environment
   * capture's cadence (at most 4 Hz, and in practice only when the dome has
   * actually changed), never per frame.
   */
  readIrradiance(renderer: THREE.WebGLRenderer, sky: THREE.Color, ground: THREE.Color): void {
    const w = this.rt.width;
    const h = this.rt.height;
    if (this.readBuf === null) this.readBuf = new Uint16Array(w * h * 4);
    const buf = this.readBuf;
    renderer.readRenderTargetPixels(this.rt, 0, 0, w, h, buf);

    // Matches the pass's own parameterisation exactly: azimuth is linear over
    // 2pi, elevation is sqrt-warped about the horizon. The Jacobian of that warp
    // is |d(el)/d(ev)| = pi * |ev|, and the solid angle is cos(el) d(el) d(az).
    const dAz = (2 * Math.PI) / w;
    const dEv = 2 / h;
    let ur = 0, ug = 0, ub = 0, dr = 0, dg = 0, db = 0;
    const f = THREE.DataUtils.fromHalfFloat;
    for (let j = 0; j < h; j++) {
      const ev = ((j + 0.5) / h) * 2 - 1;
      const el = Math.sign(ev) * ev * ev * (Math.PI / 2);
      // |cos(theta)| for a normal along the pole, times the solid angle.
      const weight = Math.abs(Math.sin(el)) * Math.cos(el) * (Math.PI * Math.abs(ev) * dEv) * dAz;
      if (weight <= 0) continue;
      let rr = 0, gg = 0, bb = 0;
      const row = j * w * 4;
      for (let i = 0; i < w; i++) {
        const k = row + i * 4;
        rr += f(buf[k]);
        gg += f(buf[k + 1]);
        bb += f(buf[k + 2]);
      }
      if (el >= 0) { ur += rr * weight; ug += gg * weight; ub += bb * weight; }
      else { dr += rr * weight; dg += gg * weight; db += bb * weight; }
    }
    sky.setRGB(ur, ug, ub, THREE.LinearSRGBColorSpace);
    ground.setRGB(dr, dg, db, THREE.LinearSRGBColorSpace);
  }

  dispose(): void {
    this.rt.dispose();
    this.quad.geometry.dispose();
    this.material.dispose();
    this.readBuf = null;
  }
}

/**
 * The cloud march, run at half resolution into its own target.
 *
 * At 1080p a full-resolution march of a cloudy sky costs about 35ms — fine on
 * the canonical vantages, where terrain covers most of the frame and early-z
 * kills the dome, and catastrophic the moment the player looks up. Quartering
 * the pixel count brings it to ~9ms. There is no depth discontinuity to
 * preserve here (the layer is always behind every piece of geometry), so the
 * upsample is a plain bilinear fetch rather than a bilateral one.
 */
export class CloudPass {
  readonly material: THREE.ShaderMaterial;
  private rt: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private basis = new THREE.Matrix3();

  constructor(uniforms: SkyUniforms) {
    this.material = new THREE.ShaderMaterial({
      uniforms,
      defines: { CLOUD_PASS: '' },
      vertexShader: PASS_VERT,
      fragmentShader: FRAG,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.rt = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
    uniforms.uCloudBuf.value = this.rt.texture;
  }

  render(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    w: number,
    h: number,
  ): void {
    const hw = Math.max(1, w >> 1);
    const hh = Math.max(1, h >> 1);
    if (this.rt.width !== hw || this.rt.height !== hh) this.rt.setSize(hw, hh);

    const u = this.material.uniforms;
    (u.uCloudTexel.value as THREE.Vector2).set(1 / hw, 1 / hh);
    // Ray basis, taken from the unjittered camera: the pass must not inherit
    // the TAA sub-pixel offset or the whole layer would shimmer.
    this.basis.setFromMatrix4(camera.matrixWorld);
    (u.uCamBasis.value as THREE.Matrix3).copy(this.basis);
    const ty = Math.tan((camera.fov * Math.PI) / 360);
    (u.uTanHalf.value as THREE.Vector2).set(ty * camera.aspect, ty);

    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prev);
  }

  dispose(): void {
    this.rt.dispose();
    this.quad.geometry.dispose();
    this.material.dispose();
  }
}
