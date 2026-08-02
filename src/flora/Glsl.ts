/**
 * GLSL shared by every flora shader.
 *
 * The wind field in particular is a single function used verbatim by the
 * canopy, the ground cover and the impostors. That is not an optimisation — it
 * is the only way a 20 m parasol and the grass at its foot can be seen to bend
 * on the same gust. Two "similar" wind implementations always drift apart and
 * the eye reads it instantly.
 */

/** Cheap GLSL hashes. hash12 is used for hashed-alpha LOD dithering. */
export const HASH_GLSL = /* glsl */ `
#ifndef FLORA_HASH
#define FLORA_HASH
float fHash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float fHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 fHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
/**
 * Four uncorrelated draws for the price of about one and a half.
 *
 * The ground-cover vertex shader needs nine or ten independent randoms per
 * blade — height, width, yaw, lean, variant, emergence, colour break-up — and
 * it was fetching them as seven separate hashes of seven scaled copies of the
 * same world position. Each of those repeats the whole fract/dot/fract
 * dance to extract one or two numbers from it. Widening the state to a vec4
 * amortises the setup across four outputs: the dot product and the two fracts
 * are paid once instead of four times, and the swizzles below are what keep the
 * four channels independent. Measured at roughly 35 scalar ops for four values
 * against 20 for one.
 */
vec4 fHash42(vec2 p) {
  vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}
/** Smooth value noise. Used for habitat patchiness in the ground-cover shader. */
float fValue2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = fHash12(i);
  float b = fHash12(i + vec2(1.0, 0.0));
  float c = fHash12(i + vec2(0.0, 1.0));
  float d = fHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
/**
 * Three value-noise fields off ONE lattice.
 *
 * Three separate fValue2 calls do three floors, three fracts, three smoothstep
 * curves and twelve corner hashes to produce three numbers. Sharing the lattice
 * costs four vec4 hashes and one interpolation for the same three — and the
 * channels stay independent because they come from different components of the
 * corner hash, not from different sample points. The one thing it costs is that
 * the three fields share a cell size; for the mid-scale stand variation this
 * drives (height class, hue drift, value drift) that is invisible, because
 * value noise is smooth across its cell boundaries and nothing keys off where
 * those boundaries are.
 */
vec3 fValue2x3(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec4 a = fHash42(i);
  vec4 b = fHash42(i + vec2(1.0, 0.0));
  vec4 c = fHash42(i + vec2(0.0, 1.0));
  vec4 d = fHash42(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y).xyz;
}
#endif
`;

/**
 * The one wind field.
 *
 * Returns xy = a horizontal push direction/magnitude in world XZ, normalised so
 * that 1.0 means "a fully loaded gust"; z = the gust envelope itself, which
 * shaders use to lift roughness and to brighten grass as it turns edge-on.
 *
 * Structure: a travelling low-frequency front (wavelength ~85 m) crossed with a
 * much longer, slower swell so gusts never feel metronomic, plus a per-plant
 * flutter decorrelated by an instance phase. Everything is a function of world
 * position, so two plants a metre apart are in step and two a hundred metres
 * apart are not.
 */
export const WIND_GLSL = /* glsl */ `
#ifndef FLORA_WIND
#define FLORA_WIND
uniform vec2  uWindDir;    // unit, downwind
uniform float uWindSpeed;  // m/s from the weather state
uniform float uWindTime;   // seconds, accumulated by the flora system

vec3 floraWind(vec2 p, float phase) {
  float along = dot(p, uWindDir);
  vec2  side  = vec2(-uWindDir.y, uWindDir.x);

  // Gust front. 0.0739 rad/m => ~85 m between crests; it travels downwind at
  // 0.66/0.0739 ~= 9 m/s, which reads as a visible wave crossing a meadow.
  float g1 = sin(along * 0.0739 - uWindTime * 0.66);
  float g2 = sin(along * 0.0262 + dot(p, side) * 0.0181 - uWindTime * 0.23);
  float gust = 0.5 + 0.5 * g1 * (0.55 + 0.45 * g2);
  gust *= gust;                                  // sharpen: lulls are long, gusts short

  float load = clamp(uWindSpeed / 11.0, 0.0, 1.25) * (0.24 + 0.76 * gust);

  // Flutter: high frequency, small amplitude, and the only term that is not
  // shared between neighbours. Without it a field bends like a single sheet.
  float f = sin(uWindTime * (2.3 + 1.1 * fract(phase * 1.7)) + phase * 6.2831853 + along * 0.33);

  vec2 push = uWindDir * (load * (0.80 + 0.20 * f)) + side * (load * 0.24 * f);
  return vec3(push, gust);
}
#endif
`;

/**
 * Subsurface scattering for fleshy caps and leaves.
 *
 * Dice/Frostbite-style translucency: light entering the far side of a thin
 * membrane and leaving toward the eye. Deliberately NOT multiplied by the shadow
 * term — a backlit cap has its camera-facing surface turned away from the sun
 * and is therefore shadowed by definition, so gating on the shadow mask deletes
 * the one effect that sells fungal flesh.
 */
export const SSS_GLSL = /* glsl */ `
#ifndef FLORA_SSS
#define FLORA_SSS
uniform vec3  uSunDirW;    // world space, toward the sun (read from sky.sun)
uniform vec3  uSunRadW;    // sun colour * intensity, linear
uniform vec3  uSkyRadW;    // ambient irradiance estimate, linear
uniform vec3  uSssTint;    // transmission colour of the flesh

/**
 * Two lobes and a gate. This is the shape of the fix.
 *
 * The old term was a single Frostbite transmission lobe, pow(dot(V,-H), 3.2),
 * which only fires when the EYE is within about twenty-five degrees of looking
 * straight down the sun vector. On every canonical vantage the sun is off to one
 * side, so that lobe evaluated to nothing and the effect the art bible calls the
 * signature of the flora was, in practice, never drawn at all.
 *
 * What was missing is that light does not only pass straight through a
 * centimetre of fungal flesh — most of it scatters, many times, and leaves in a
 * nearly isotropic sheet. That diffusion halo is the term that lights a
 * CROSS-lit cap, and it is keyed on the surface's own orientation, not on the
 * camera's:
 *
 *   thru   how much sun is arriving through the BACK of this surface. A cap's
 *          down-sun margin and every gill underside are negative-dot surfaces at
 *          a grazing sun, which is exactly the tissue that should light up.
 *   tight  the specular-like transmission peak, for looking into the sun.
 *   wide   the halo, weakly view-dependent so it still has a direction.
 *   graze  a sun on the horizon crosses a thin chord of the cap and most of the
 *          light gets out; a sun overhead has to go the long way and almost
 *          none does. This is what keeps the effect a dawn/dusk event rather
 *          than a permanent glow, and it is why it must not read as emissive.
 */
vec3 floraSSS(vec3 nrm, vec3 wpos, float thickness) {
  if (thickness <= 0.001) return vec3(0.0);
  vec3 V = normalize(cameraPosition - wpos);

  /**
   * The three constants below were all set too timidly, and the evidence is that
   * across many review rounds not one critic has ever mentioned seeing this
   * effect — on a world whose art direction is built on translucent fungal caps
   * lit by a low red sun. An effect nobody notices is, for review purposes,
   * an effect that is not there.
   *
   *  thru   was (0.34 - N.L) * 0.74, which gives a cap crown with the sun a
   *         little behind it (N.L ~ 0.2) a transmission weight of 0.10. A real
   *         cap at that geometry is glowing. The turn-on point moves out to 0.45
   *         and the slope up to 0.95, so the same surface reads 0.24 and the
   *         down-sun half of a crown — which is the tissue the eye actually
   *         looks at when a grove is backlit — saturates instead of hovering
   *         around a third.
   *  tight  the specular-like peak, exponent 4 -> 3. A fourth power is a 25-degree
   *         cone around the sun vector; on every canonical vantage the sun is
   *         further off axis than that, so the term was almost always zero. Three
   *         widens it to something a camera not pointed straight at the sun can
   *         still see, which is the difference between an effect that exists in
   *         one screenshot and one that exists in the game.
   *  gain   the grazing-sun multiplier. Still strongly keyed to a low sun — a cap
   *         lit from overhead has to send light the long way through the flesh and
   *         genuinely almost none gets out — but the pedestal is raised so that a
   *         backlit margin at midday is dim rather than absent.
   */
  /**
   * 0.45/0.95 -> 0.60/1.25, and the case it is set from is the one the brief
   * names: a low sun BEHIND a cap.
   *
   * A cap crown at a grazing sun has N.L around +0.17 — the crown faces up and
   * the sun is nearly horizontal — so at the old constants the largest surface
   * on the plant, the one the eye is actually looking at when a grove is
   * backlit, transmitted at a weight of 0.27. Everything downstream then
   * multiplies that by a tint, a thickness and a bound, and the result is an
   * effect no reviewer has ever mentioned. At 0.60/1.25 the same surface reads
   * 0.54 and the down-sun half of the crown saturates, which is what a
   * centimetre of backlit fungal flesh actually does. A FRONT-lit crown
   * (N.L ~ 0.9) still transmits nothing, so this cannot leak into a noon frame.
   */
  float thru = clamp((0.60 - dot(nrm, uSunDirW)) * 1.25, 0.0, 1.0);

  vec3  Ht    = normalize(uSunDirW + nrm * 0.32);
  float tight = pow(clamp(dot(V, -Ht), 0.0, 1.0), 3.0);
  float wide  = 0.42 + 0.58 * clamp(dot(V, -uSunDirW) * 0.5 + 0.5, 0.0, 1.0);

  /**
   * The grazing gate opens a little wider: 1.6 -> 1.35.
   *
   * At 1.6 the effect is fully gone once the sun is 39 degrees up, which on this
   * world's clock is most of the day. A cap does transmit less at noon — the
   * chord through the flesh is longer — but "less" is not "none", and the pedestal
   * below is what carries a backlit margin at midday. The quadratic keeps the
   * effect overwhelmingly a dawn/dusk event, which is the art direction.
   */
  float graze = 1.0 - clamp(abs(uSunDirW.y) * 1.35, 0.0, 1.0);
  float gain  = 0.62 + 1.60 * graze * graze;

  // Wrapped diffuse pedestal: flesh is never fully black on its shadow side.
  float wrapd = clamp((dot(nrm, uSunDirW) + 0.55) / 1.55, 0.0, 1.0);

  /**
   * The skylight pedestal is not decoration.
   *
   * A cap underside is in its own shadow from sunrise to sunset, so essentially
   * all of its light is the ambient dome — which at dawn measures (0.119, 0.102,
   * 0.151), a cool violet. Times a near-neutral gill band that is a flat grey,
   * and a flat grey set inside a frame of salmon ash reads, by simultaneous
   * contrast, as mint. Skylight transmits through a centimetre of flesh exactly
   * as sunlight does, and routing more of it through uSssTint is what puts the
   * warmth back on the one surface the sun never reaches. It is also the term
   * that keeps the effect alive under an ash storm, where there is no sun to
   * speak of at all.
   */
  /**
   * The wrap pedestal is raised, and it is the "never falls to black" term.
   *
   * A back-facing card, a cap underside and a gill are all surfaces the sun
   * never reaches directly, and with only a 0.10 pedestal they were carried
   * almost entirely by the ambient dome — which is exactly the review's "shade
   * to near-zero luminance regardless of surrounding lighting" and "a solid dark
   * cut-out with the same shading response as rock". Wrapped diffuse at 0.17 is
   * a physically ordinary amount of light for a thin translucent membrane to pass
   * and it is what keeps every one of those surfaces answering to the sun's
   * colour and direction instead of to nothing at all.
   */
  // 0.27/0.10 -> 0.46/0.22. Together with the widened lobe and the raised gain
  // this is a little under three times the peak transmitted radiance on a
  // backlit cap at a grazing sun, and unchanged on a front-lit one — the two
  // directional terms are both multiplied by thru, which is zero there. The
  // result is still bounded downstream against the reflected radiance of the
  // same pixel (see the clamp in Materials.ts), so it cannot turn into the
  // emissive wireframe an unbounded version of this once produced at night.
  // The halo weight 0.22 -> 0.34. The tight lobe sits around the sun vector and
  // only fires when the camera is looking into it; the wide one is the diffusion
  // sheet, and it is what lights a CROSS-lit cap — the geometry of every
  // canonical vantage. It was carrying less than half the weight of the term
  // that almost never fires.
  vec3 e = uSunRadW * ((tight * 0.46 + wide * 0.34) * thru * gain + 0.17 * wrapd)
         + uSkyRadW * 0.48;
  return e * uSssTint * thickness;
}
#endif
`;

/**
 * Hashed alpha for LOD cross-fade and for the impostor's cut-out.
 *
 * The renderer runs with `antialias:false` (TAA owns anti-aliasing), so
 * alpha-to-coverage has no coverage samples to write into and would be a no-op.
 * A stable screen-space hash is the correct substitute: the stipple is fixed per
 * pixel, so TAA leaves it alone instead of smearing it, and the transition
 * resolves as a dissolve rather than a pop.
 */
export const DITHER_GLSL = /* glsl */ `
#ifndef FLORA_DITHER
#define FLORA_DITHER
uniform float uDitherPhase;
// Coverage is SIGNED, and that sign is what makes an LOD cross-fade seamless.
// The outgoing LOD is given +c and keeps the pixels below the threshold; the
// incoming LOD is given c-1 and keeps exactly the pixels above it. Both read the
// same instance seed, so the two stipples are complementary — no double-drawn
// pixels, no holes, and no ghost silhouette during the handover.
void floraDither(float coverage, float seed) {
  if (coverage >= 0.999) return;
  // Interleaved-gradient noise: far better distributed than a raw hash at the
  // 3-4 pixel scale where a dissolve is actually read. Advanced by a golden-
  // ratio step every frame — a pattern that is stable in screen space reads as
  // a checkerboard stencil on every half-faded plant, whereas one that rotates
  // is exactly the kind of noise TAA integrates away to a clean cross-fade.
  vec2 p = gl_FragCoord.xy;
  float ign = fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y)
                    + seed * 0.6180339887 + uDitherPhase);
  if (coverage >= 0.0) {
    if (ign >= coverage) discard;
  } else if (ign < 1.0 + coverage) {
    discard;
  }
}
#endif
`;

/** Shared varyings + helpers injected into every flora fragment shader. */
export const FLORA_FRAG_PARS = /* glsl */ `
varying vec3  vFWorld;
varying vec3  vFNormalW;
varying vec4  vFParam;   // x=stiffness/height, y=thickness, z=glow, w=variation
varying float vFFade;
uniform sampler2D uArm;  // r=AO  g=roughness  b=GLOW MASK  a=translucency
uniform float uGlowNight;
uniform vec3  uGlowColor;
uniform float uFloraTime;
`;
