import * as THREE from 'three';
import type { IAtmosphere, IPipeline } from '../core/contracts';
import type { ShadowCascades } from '../sky/Cascades';
import type { Ctx } from '../core/types';
import { Blit, GpuProfiler, fsMaterial, makeRT, type Uniforms } from './gpu';
import { buildBlueNoise, buildGradeLUT } from './grade';
import { installSpecularAA } from './specularAA';
import {
  AO_BLUR_FRAG,
  AO_FRAG,
  BLOOM_DOWN_FRAG,
  BLOOM_UP_FRAG,
  CAS_FRAG,
  COMPOSITE_FRAG,
  DOF_COC_FRAG,
  DOF_COMPOSITE_FRAG,
  DOF_GATHER_FRAG,
  EXPOSURE_FRAG,
  HALFRES_FRAG,
  MBLUR_FRAG,
  METER_FRAG,
  PREPASS_FRAG,
  PREPASS_VERT,
  TAA_FRAG,
  UBER_FRAG,
  VOL_BLUR_FRAG,
  VOL_FRAG,
} from './shaders';

/**
 * Cross-fade band between the two cascades the volumetric march samples, as a
 * fraction of the cascade's ortho box. Wider than the lit pass's band on
 * purpose: the fog is a smooth, low-frequency term, so any discontinuity in it
 * reads as a shape in its own right rather than as noise on a surface.
 */
const VOL_CASCADE_BAND = 0.12;

// Renderer-wide shading policy, installed at module scope because a ShaderChunk
// is read at program-compile time and several systems compile programs from
// inside their own init(). See specularAA.ts.
installSpecularAA();

/**
 * Depth bias for a volumetric shadow tap, in metres of world depth along the
 * light. A fog sample is not a surface, so this is not about acne: it is about
 * the occluder's recorded depth being quantised to the cascade's texel, which
 * at metre-wide texels reads as a shaft standing a metre or two off its caster.
 * Returned in metres so the caller can divide by each cascade's own depth span
 * — the same normalised number means wildly different world offsets across a
 * cascade set, and that difference is visible as a step in the fog.
 */
function volumeBiasMetres(texel: number): number {
  return 0.5 + texel;
}

/** Exposure meter tile grid. 32x18 tiles x 4x4 taps = 9216 samples per frame. */
const METER_W = 32;
const METER_H = 18;
const METER_TAPS = 4;

/**
 * Per-pass kill switches for visual QA. Live-toggleable from the console:
 * `RENDER_DEBUG.ao = false`. The `show*` flags are mutually exclusive views
 * that replace the final image with an intermediate buffer.
 */
export const RENDER_DEBUG: Record<string, boolean> = {
  prepass: true,
  // Freezes the cascade set where it stands. Purely a measurement switch: it
  // isolates the cost of *rendering* the shadow maps from the cost of sampling
  // them, which is the only way to attribute the shadow budget on a driver
  // whose timer queries serialise the pipe (ANGLE/Metal does).
  shadowRefresh: true,
  ao: true,
  contactShadows: true,
  volumetrics: true,
  taa: true,
  motionBlur: true,
  dof: true,
  bloom: true,
  tonemap: true,
  lut: true,
  /** Bypasses the per-frame black point, i.e. the frame's whole value curve. */
  blackPoint: true,
  /** Restores the pre-fix bilateral upsample weight, for A/B measurement. */
  bilateralLegacy: false,
  grain: true,
  chromatic: true,
  vignette: true,
  cas: true,
  autoExposure: true,

  showAO: false,
  showContact: false,
  showNormals: false,
  showVelocity: false,
  showVolumetrics: false,
  showBloom: false,
  showDepth: false,
  showLinearDepth: false,
  showPrepassDepth: false,
};

// The doc comment above promises console access; without this line it was a
// promise the build did not keep, and every visual-QA session had to rebuild
// with a source edit to isolate a pass.
Object.assign(globalThis as Record<string, unknown>, { RENDER_DEBUG });

/**
 * The sky system as this pipeline needs to see it. `IAtmosphere` is the shared
 * contract and stays untouched; the cascade set is an implementation detail of
 * the sky that the volumetric pass and the shadow scheduling both need, so it
 * is declared here structurally rather than pushed into the core contracts file.
 */
interface CascadedSky extends IAtmosphere {
  readonly csm?: ShadowCascades;
}

type Tier = 'low' | 'medium' | 'high' | 'ultra';

interface TierCfg {
  scale: number;
  maxPixels: number;
  prepass: boolean;
  aoDirs: number;
  aoSteps: number;
  contact: boolean;
  csSteps: number;
  volumetrics: boolean;
  volSteps: number;
  taa: boolean;
  jitterCount: number;
  motionBlur: boolean;
  mbSamples: number;
  dof: boolean;
  dofTaps: number;
  bloomMips: number;
  cas: boolean;
}

/**
 * WHAT EACH TIER PROMISES.
 *
 * The table used to be four points on one curve with no statement of intent
 * attached, and it showed: `low` came back at 41.9 fps mean and `ultra` at
 * 18.0, so no tier hit the art bible's 60, and the one the game is judged on
 * missed it by a factor of nearly three. A tier list with no target in it is a
 * list of guesses. These are the targets:
 *
 *   low     — the floor. Runs on integrated graphics. Everything optional is
 *             off; nothing here is expected to look like the marketing shot.
 *   medium  — 60 fps at 1080p on modest discrete hardware.
 *   high    — 60 fps at 1080p on an Apple M3. THE tier the game ships on and
 *             the one every review shot is taken at.
 *   ultra   — PHOTO MODE. Native resolution, every band, every tap. It does not
 *             target 60 and is not expected to reach it; it exists so a capture
 *             can be taken without a budget in the way.
 *
 * That last line is the one honest change in this table. Everything previously
 * had to fit one budget, so the budget was met nowhere and the shader carried
 * a photo-mode feature set at gameplay framerates. Splitting them lets `high`
 * be cut hard without anything being lost — it is all still there, one tier up.
 */
const TIERS: Record<Tier, TierCfg> = {
  low: {
    scale: 0.58, maxPixels: 0.95e6, prepass: false,
    aoDirs: 2, aoSteps: 3, contact: false, csSteps: 6,
    volumetrics: true, volSteps: 8, taa: true, jitterCount: 8,
    motionBlur: false, mbSamples: 5, dof: false, dofTaps: 16,
    bloomMips: 4, cas: true,
  },
  medium: {
    scale: 0.72, maxPixels: 1.35e6, prepass: true,
    aoDirs: 2, aoSteps: 4, contact: true, csSteps: 6,
    volumetrics: true, volSteps: 10, taa: true, jitterCount: 8,
    motionBlur: true, mbSamples: 6, dof: true, dofTaps: 22,
    bloomMips: 4, cas: true,
  },
  // `high` renders NATIVE, and the reason is measured rather than aesthetic.
  //
  // THIS RENDERER IS NOT PIXEL-BOUND AT 1080p ON AN M3. That single fact
  // invalidates most of what previous rounds spent on resolution, so it is
  // worth stating how it was established. `medium` was temporarily made a
  // byte-identical clone of this tier at scale 1.0 and the two were alternated
  // inside one session, three rounds each, at all five canonical vantages — so
  // the ONLY difference between the two measurements was the internal buffer
  // size, and machine drift cancelled. Cutting 28% of the pixels returned:
  //
  //     dawn 0.89x   vale 0.97x   ridge 1.00x   redmtn 0.99x   coast 1.00x
  //
  // Median 0.99x. Not "a small gain" — no gain, and a loss at the vantage with
  // the most terrain in it. Resolution is free to be spent on the image here
  // because the frame is waiting on something else (see the report: terrain
  // vertex processing), and a scale below 1 buys nothing but softness and the
  // resampling artefacts three review rounds have already caught.
  //
  // So the tier stays at 1.0, and it stays there for a reason that can be
  // re-tested in ten minutes rather than because of a taste argument. The
  // `decohere` helper below is still live and still correct — `medium` and
  // `low` do upscale, and on hardware that IS fill-bound they should — but it
  // is inert at this tier.
  //
  // The AO and contact-shadow budgets are NOT touched either. Ground contact is
  // item one on the art bible's list and has been reported missing in a
  // previous round; it is not the budget to raid, least of all to buy time that
  // the measurement above says is not there to buy. What this tier does give up
  // against `ultra` is the fog march (48 -> 10 steps, on a quarter-res buffer
  // that is bilaterally blurred afterwards), one bloom mip, and the terrain
  // fragment budget at TQ2 rather than TQ3.
  high: {
    scale: 1.0, maxPixels: 2.4e6, prepass: true,
    aoDirs: 2, aoSteps: 5, contact: true, csSteps: 8,
    volumetrics: true, volSteps: 10, taa: true, jitterCount: 16,
    motionBlur: true, mbSamples: 6, dof: true, dofTaps: 24,
    // Four mips, not five. The chain is nine passes at five and seven at four,
    // and on a tile-based GPU a pass costs a tile flush before it costs a
    // fragment. The dropped mip is the 60x34 one — a bloom radius of two thirds
    // of the screen, under a bright-pass threshold of two stops over midtone,
    // which is a term that only the sun disc ever reaches and that the mip below
    // it already carries.
    bloomMips: 4, cas: true,
  },
  // Photo mode. Native, every band, every tap, no 60 fps promise. Everything
  // `high` gives up is here.
  ultra: {
    scale: 1.0, maxPixels: 4.3e6, prepass: true,
    aoDirs: 4, aoSteps: 6, contact: true, csSteps: 16,
    volumetrics: true, volSteps: 48, taa: true, jitterCount: 16,
    motionBlur: true, mbSamples: 12, dof: true, dofTaps: 55,
    bloomMips: 7, cas: true,
  },
};

function gcd(a: number, b: number): number {
  while (b > 0) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/**
 * Pick an internal buffer dimension that cannot print a short screen lattice.
 *
 * Upscaling by out/n resamples with a phase that repeats every out/gcd(out, n)
 * output pixels. That period is what the eye reads as a screen door, and it is
 * short exactly when the two sizes share a large factor — which they almost
 * always do, because both come from round numbers. 1920 -> 1536 (scale 0.8)
 * shares 384 and repeats every 5 pixels. 1920 -> 1632 (scale 0.85) shares 96
 * and repeats every 20.
 *
 * Moving the internal size by a pixel or two changes nothing anyone can see
 * about the resolution and changes the period completely: 1920 -> 1633 shares
 * 1 and does not repeat inside the frame at all. So the search below takes the
 * nearest candidate within four pixels whose gcd with the canvas is smallest,
 * and the artefact stops being something to trade resolution against.
 *
 * This does not make a bilinear stretch flat — it spreads its modulation over
 * hundreds of phases instead of five, so that what was a visible dot screen
 * becomes a gradient far below the noise floor. Combined with the Catmull-Rom
 * reconstruction, which is close to flat across the passband to begin with,
 * the phase fold comes out even. Verify, do not assume: tools/phase.mjs.
 */
function decohere(n: number, out: number): number {
  if (n >= out) return out;
  let best = n;
  let bestG = gcd(out, n);
  for (let d = 1; d <= 4 && bestG > 1; d++) {
    for (const c of [n - d, n + d]) {
      if (c < 8 || c >= out) continue;
      const g = gcd(out, c);
      if (g < bestG) {
        bestG = g;
        best = c;
      }
    }
  }
  return best;
}

function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/** Ashlands HDR pipeline. Owns the frame from scene submission to the canvas. */
export class RenderPipeline implements IPipeline {
  readonly id = 'render';
  readonly order = 900;
  readonly composer: unknown;

  /**
   * Manual exposure trim. This is a *multiplier on the metered exposure*, not
   * the exposure itself — 1.0 means "whatever the meter says". There used to be
   * no meter at all and this constant was the entire exposure path, which is why
   * every shot in the review was however many stops off the scene happened to
   * be: nothing anywhere was measuring the image.
   */
  exposure = 1.0;

  /**
   * Auto-exposure. `key` is the linear luminance the metered region is driven
   * toward before the tonemapper — roughly middle grey. `adapt` is how much of
   * the way there we actually go: 1.0 is full adaptation, which flattens night
   * and day into the same picture, so it sits below 1 on purpose. `rate` is the
   * adaptation speed in e-folds per second.
   */
  autoExposure = true;
  /**
   * 0.11, not 0.085. The meter drives the log-average of the weighted region to
   * this value; a scene's log-average sits roughly half a stop under middle
   * grey, so 0.11-0.13 is where a correctly exposed exterior lands. At 0.085 the
   * whole set metered a stop and a bit dark, which is the "median luminance
   * 52/255, nothing above 208" measurement — not a tonemap fault, an exposure
   * one.
   */
  exposureKey = 0.11;
  exposureAdapt = 0.78;
  /**
   * Hard EV bounds. The ceiling is what keeps midnight from resolving as an
   * overcast afternoon: unbounded metering on a scene five stops down produces a
   * technically correct exposure and an artistically wrong picture. A dark iris
   * only opens so far.
   */
  exposureMin = 0.25;
  /**
   * The ceiling was 5.0, and dawn, dusk and night all sat *exactly* on it —
   * measured, not inferred: `readExposure()` returned 5.000 with a metered
   * target of 6.2, 5.7 and 7.0 respectively. A cap that three of the eight
   * canonical shots are pinned against is not a safety rail, it is the exposure
   * control, and it was holding the shots the art direction cares about most a
   * third to a half stop under.
   *
   * Night still resolves as night without it: `exposureAdapt` below 1 is the
   * mechanism that keeps a dark scene dark (a scene five stops down gets four
   * stops back and stays a stop under), and unlike a hard cap it scales
   * smoothly instead of flattening every dark hour onto the same value.
   *
   * There are two ceilings because there are two regimes. Above the horizon the
   * eye is photopic and the meter should be trusted; below it, it is not — and
   * a scene whose ground plane is genuinely unlit (the bioluminescent field
   * emits into the colour buffer and into no light list, which is not this
   * system's to fix) drags the log-average low enough that an honest meter
   * resolves midnight's sky as dusk. That is measured: night's sky sat at a
   * median of 81/255 on a single 6.5 ceiling. The ceiling is interpolated on
   * the world clock, so it is a property of the hour rather than a number that
   * has to be wrong for half the day to be right for the other half.
   *
   * The clock and not the key light's elevation, deliberately: after dusk the
   * sky system repoints the key at whichever moon is up, so the "sun" vector
   * has a perfectly respectable positive elevation at midnight and a test on it
   * silently puts night on the day branch — which is exactly what the first
   * attempt at this did.
   */
  exposureMaxDay = 7.0;
  exposureMaxNight = 4.2;
  /** Resolved from sun elevation each frame; read by the exposure pass. */
  private exposureMax = 7.0;
  exposureRate = 5.0;

  /**
   * Highlight placement, the other half of the exposure decision.
   *
   * `exposureKey` says where mid-grey goes; on its own that is the entire
   * reason eight consecutive reviews measured "no highlight population
   * anywhere". A log-average meter is indifferent to the top of the range, so a
   * scene whose brightest content is two stops over its own mean is exposed
   * identically to one with a sun disc in it — measured, the ridge frame's
   * absolute maximum was 152/255 and vale's 95th percentile was 164/255, i.e.
   * nothing in either frame had any highlight energy at all.
   *
   * `highlightKey` is the exposed radiance the *bright population* (0.6-2.6
   * stops over the scene mean) is steered toward. 1.05 puts the *mean* of that
   * population at roughly sRGB 205, so its own top half reaches 220-240 — a sky
   * with a highlight in it rather than a sky at two thirds of white.
   * `highlightMaxLift` caps how far the highlight solution may pull the mid-grey
   * one, in linear multiples; 1.42 is half a stop. Both are deliberately modest:
   * at 2.2 and 1.9 the same mechanism drove 6.8% of the dawn frame's red channel
   * to 255, which is the opposite failure and a worse one.
   *
   * The lift is strictly one-directional — it can open the stop, never close it
   * — so a shot that already has highlights (the coast glint, p95 248) is left
   * exactly where the log-average meter put it.
   */
  // 0.90, was 1.05. With a real black point under the frame the value curve's
  // gain now does part of the work this number used to do alone, and at 1.05
  // the two together drove the sulphur horizon past display 0.9 — where the
  // shoulder compresses it and it desaturates toward cream. The bible's sky is
  // `#c99a5c`, a mid-value ochre, not a white one.
  // 0.70, was 0.90.
  //
  // The bible's sky is `#c99a5c` — luma 159 of 255, a MID-value ochre. At 0.90
  // the bright population landed the sulphur horizon at display luma 229 with
  // red pinned at 253, i.e. a white sky with a warm tint on it, which is
  // simultaneously the "cream wash rather than sulphur" finding and a clipped
  // highlight the bible forbids outright. No amount of grading recovers chroma
  // from a channel that is on the rail; the fix has to be to stop putting it
  // there. 0.70 is a third of a stop down and puts the same population in the
  // 195-215 band, which is where a sky with a sun somewhere else in it belongs
  // and where the grade's sulphur term has room to work.
  highlightKey = 0.70;
  highlightMaxLift = 1.42;
  highlightMinLift = 0.72;

  /**
   * Black placement — the third leg, and the one that was missing entirely.
   *
   * `exposureKey` says where mid-grey goes and `highlightKey` says where the
   * top of the range goes. Nothing said where the bottom goes, and the
   * measurement of that omission is stark: across the canonical set the 1st
   * percentile of every daylight frame landed between 55 and 125 of 255. The
   * bible's basalt is 19 to 38. There was no black anywhere in the picture, on
   * any shot, for three review rounds — which is simultaneously the "entire
   * image lives in a 0.66 stop band" finding, the reason nothing read as a
   * cast shadow, and the reason the grade's own shadow tint measured 0.0% cool
   * pixels while being applied at full strength (it is gated on darkness, and
   * there was none to gate on).
   *
   * This is a *fraction of where the scene's own metered mean lands on
   * display*, resolved per frame in the exposure pass, not a display value.
   * The canonical shots' means span display 0.24 to 0.56; a constant that
   * gives the daylight frames a real black turns twenty metres of water into
   * mud, and one safe for the water frame does nothing for daylight. As a
   * ratio, 0.55 is right for both, and right at every hour without a schedule.
   *
   * 0.46 specifically. The gain that restores the midtone is 1/(1 - this), so
   * the number sets the whole frame's contrast, not just its floor — and at
   * 0.55 the 2.2x gain that followed drove the sulphur horizon to 246/255 on
   * three shots and Ember Mount's near slope to a 1st percentile of 8. The
   * bible forbids a clipped white sky and a crushed pure black in the same
   * breath, and 0.55 was producing both in one frame. At 0.46 the gain is 1.85,
   * the toe still reaches the basalt band (p1 lands 20-40 on the daylight set,
   * against `#2a2622` at 38) and the sky stays an ochre rather than a white.
   */
  blackRel = 0.46;

  /**
   * The other black-point anchor, and the one that has to exist because
   * `blackRel` measures from the mean.
   *
   * A fraction of the mean is the right place to put black when the frame has
   * a floor somewhere under its mean. The ashstorm vantage does not: it is
   * optically thick from the near plane out, so its darkest content and its
   * average are the same handful of values, and 46% under the mean lands well
   * ABOVE the darkest rock in the picture. Measured, that is the frame running
   * 76 to 192 of 255 and never touching either end of the range — the "1.9
   * stops and one hue" finding — and no amount of tuning `blackRel` fixes it,
   * because the number it is a fraction OF is wrong for this frame.
   *
   * So the meter now reports the frame's own shadow population as well as its
   * mean (METER_FRAG attachment 1), and the black point is the higher of the
   * two anchors: place the darkest population at this display value, or take
   * `blackRel` of the mean, whichever asks for more. On every frame that has
   * blacks the second wins and nothing changes; on the ones that do not, this
   * is the only thing that can see the problem.
   */
  darkFloor = 0.05;
  /**
   * Ceiling on the value curve's gain, which is now derived from wherever the
   * black point landed rather than being the constant 1/(1 - blackRel). A
   * frame with almost no range would otherwise ask for an unbounded stretch
   * and get its own sampling noise back, magnified. 2.6 is half a stop of
   * headroom over the nominal 1.85.
   */
  gainMax = 2.6;

  /**
   * Highlight rolloff knee and toe width for the frame's value curve, both
   * display-referred. Fields rather than constants baked into the material
   * because they are the shape of the top and bottom of the curve and both had
   * to be swept against real frames to establish what the shoulder was actually
   * costing; see agx() in shaders.ts for what that measurement found.
   */
  shoulder = 0.70;
  toeKnee = 0.075;
  /**
   * Fraction of AgX's own highlight desaturation to undo, hue-exactly. See
   * agx() in shaders.ts for what the number means and what it is measured
   * against. 0 is stock AgX.
   */
  hueRestore = 0.85;
  /**
   * When the metered region's own dynamic range exceeds this many stops, the
   * key stops being solved against the weighted log-average and starts being
   * solved against the midpoint of the range, ramping to fully so by
   * `keyRangeHi`. See the key block in EXPOSURE_FRAG.
   *
   * 3.4 and 4.6 because that is where the canonical set separates: coast
   * measures 4.84 stops between its shadow and highlight populations, redmtn
   * 3.08, vale 2.60, ridge 2.35, dawn 1.56. Only the frame with a four-stop
   * step at its own horizon line is affected, and it is affected fully.
   */
  keyRangeLo = 3.4;
  keyRangeHi = 4.6;
  /**
   * Display value the bright population is held under, and the gain floor that
   * serves it — both active only on frames past the range gate above. See the
   * third-anchor block in EXPOSURE_FRAG for why this is gated and not global.
   */
  highlightCeil = 0.86;
  gainMin = 1.30;

  /**
   * Aperture control, 0..1. Zero is the gameplay default and means a *stopped
   * down* lens, not a disabled effect: the same physical model runs, it simply
   * resolves to a sub-pixel circle of confusion everywhere past the near plane.
   * 1 is a wide-open cinematic aperture for cutscenes and photo mode.
   *
   * The old default (0.12 with a 26 m focus and an 85 mm focal length hard-coded
   * against a 55-70 degree render FOV) put a ten-pixel circle of confusion on
   * everything inside 5 m and veiled the whole frame. Focal length is now
   * derived from the projection so the lens agrees with the picture it forms.
   */
  dofStrength = 0;
  /** Metres. A landscape default — the hyperfocal near limit lands under 2 m. */
  focusDistance = 1200;
  /** Sensor height in metres (Super-35-ish). Sets focal length from the FOV. */
  readonly sensorHeight = 0.024;
  /** Aperture at dofStrength 0 and 1, in f-numbers. */
  readonly fStopDeep = 22;
  readonly fStopWide = 1.8;
  /**
   * Circles of confusion below this many pixels are rounding, not defocus, and
   * are ramped to zero. Without the deadband a sub-pixel CoC still drags the
   * near-field gather in at low opacity and the frame never reads as sharp.
   */
  readonly cocDeadband = 1.15;

  /**
   * 0.075, was 0.055. The review found Ember Mount's fissures reading as
   * "pale pink threads ... with no meaningful bloom"; the colour half of that
   * is the tonemapper (see valueCurve in shaders.ts) and this is the other
   * half. The bright-pass threshold sits two stops over the metered key, which
   * after the exposure change below is comfortably above the sulphur horizon,
   * so nothing but genuine emissives and specular events reaches this term —
   * the halo-on-every-silhouette failure that set 0.055 cannot recur from the
   * threshold side.
   */
  bloomIntensity = 0.075;
  /**
   * Bright-pass threshold in EXPOSED units, i.e. multiples of the metered key.
   * At 1.05 this sat barely two and a half stops over midtone, which put the
   * whole sky through the bright pass — and since the composite is a lerp
   * toward bloom, a few percent of a bright sky landing on a dark ridge crest
   * is a pale halo that traces every silhouette. Raised so only genuinely
   * specular events (sun disc, emissives, glints) bloom at all.
   */
  bloomThreshold = 2.0;
  volumetricDensity = 1.0;
  /**
   * Weight of the participating medium this pass composites, applied to its
   * transmittance and its in-scattering together. See COMPOSITE_FRAG.
   */
  volumetricStrength = 1.0;
  /**
   * How much of the volumetric march's bulk term the sky subsystem has already
   * accounted for in `applyAerial`, and which this pass must therefore not add
   * again. `applyAerial` is included by terrain, water, architecture and flora,
   * and the sky dome integrates the same atmosphere for itself, so the honest
   * answer is "all of it" and this buffer's job is the shadow residual —
   * i.e. the godray — and nothing else. See VOL_FRAG.
   */
  volumetricBulkRemove = 1.0;
  /**
   * Extinction per metre of the clear-air medium `applyAerial` always
   * integrates, whatever the weather. Anything this march's density has ABOVE
   * this number is weather the sky's analytic model does not carry — a dust
   * front, a blight cloud — and is genuinely this buffer's to add; anything up
   * to it has already been drawn once and is subtracted. That ratio is what
   * drives `uBulkRemove`, so clear hours get shafts only and an ashstorm keeps
   * its wall of ash.
   */
  aerialBaseDensity = 5e-4;
  /** Single-scatter albedo of the particulate medium, for the MS approximation. */
  multiScatterAlbedo = 0.9;
  aoStrength = 1.0;
  /**
   * GTAO sampling radius in METRES of world space, and the contrast power on
   * the resulting visibility. Physical units on purpose: contact darkening
   * should look the same whatever the FOV or the render resolution. Exposed
   * rather than hard-coded so a scene can be dialled in without a rebuild.
   *
   * A metre-scale radius is what "contact" means. Anything larger stops being
   * ambient occlusion and starts being a very slow, very wrong global
   * illumination approximation that occludes across whole hillsides.
   */
  aoRadius = 1.4;
  aoPower = 2.0;
  /**
   * Darkest multiplier the occlusion terms may apply. Occlusion attenuates the
   * indirect term; a surface in a crevice still sees sky, so neither pass gets
   * to reach zero.
   *
   * These were 0.42 / 0.30, which capped the deepest possible contact darkening
   * at 58% / 70% of open ground — and that is *before* the multi-bounce fit and
   * the strength lerp, which between them halve it again. A 20 px disc under a
   * tree trunk could not have read 18% darker than its surroundings no matter
   * what the occlusion buffer contained. The floors still exist (a crevice does
   * see sky), they are just no longer doing the job of a strength control.
   */
  aoFloor = 0.20;
  /**
   * The contact floor is deliberately well above the AO floor. A screen-space
   * contact ray and the cascade can both find the same occluder — a stalk base
   * is shadowed by cascade 0 *and* by the trace — and the two multiply. The
   * floor is what stops that compounding into a hole: worst case now lands at
   * ~0.4 of open ground from the contact term rather than 0.3.
   */
  contactFloor = 0.28;
  /**
   * Screen-space contact-shadow trace length in metres, and the depth window a
   * hit must fall inside to count as an occluder rather than a distant object.
   * Sub-cascade-resolution contact — the 30 cm under a stalk or a boulder —
   * lives here and nowhere else.
   */
  contactLength = 1.25;
  contactThickness = 1.0;
  /**
   * Floor on the same trace, in HALF-RES PIXELS, so it never degenerates into a
   * sub-texel no-op at distance. Measured on the dusk vantage, the contact
   * buffer read a flat 1.0 (no occlusion at all) over everything past about
   * fifteen metres with a world-only length — a whole art-bible item silently
   * switched off for 90% of every frame. Ten pixels is the smallest reach that
   * still resolves a stalk against its own ground at the far end of the
   * midground, and costs nothing extra: the step count is unchanged, only where
   * the steps land.
   */
  contactMinPixels = 10;
  /**
   * Luminance ceiling applied to a pixel before the temporal resolve, as a
   * multiple of its own 3x3 mean. Sub-pixel specular highlights on mipped
   * normal maps land as isolated pixels several times brighter than anything
   * around them; the temporal filter cannot integrate that away, it only makes
   * it crawl.
   */
  fireflyClamp = 2.5;
  /**
   * Peak lateral chromatic aberration at the extreme corner, in pixels, falling
   * off as radius squared to exactly zero on axis. Sub-pixel by design — a fast
   * cine prime is corrected to well under a pixel at this format, and anything
   * above about 1 px reads as a mis-registered render target rather than glass.
   *
   * DEFAULT ZERO, deliberately.
   *
   * With the mask rebuilt (see sampleCA) the effect is finally well behaved,
   * and at a third of a pixel it is very nearly invisible — which is exactly
   * the problem. Measured against a no-CA reference on the dawn vantage it
   * still moves R minus B by up to 74/255 on the gill fins of a foreground
   * mushroom, because a two-pixel-period pattern is the one thing a sub-pixel
   * lateral displacement can visibly recolour. Everywhere else it does nothing
   * a viewer can see.
   *
   * So the trade is: a defect two review rounds have now cited, in exchange for
   * an effect the art bible never asks for. The implementation stays — a photo
   * or cutscene mode can dial it in — but the game ships with the lens
   * corrected. Zero also skips nine texture fetches per pixel in the uber pass.
   */
  caPixels = 0;

  /**
   * Film grain amplitude in sRGB-encoded units, peak of the triangular
   * distribution at midtone. ~1.15 display LSB — visible as texture on a flat
   * sky, invisible as a pattern. Applied by the output pass at canvas
   * resolution, so this number means the same thing at every render scale.
   */
  filmGrain = 0.0045;

  /** Current tier; read by the settings UI to reflect the active preset. */
  quality: Tier = 'high';
  private cfg: TierCfg = TIERS.high;
  private ready = false;

  /**
   * Overrides the tier's internal render scale when non-null. Exists so the
   * scale can be A/B'd against a live frame from the console or a capture
   * harness — the one measurement that a rebuild-per-value loop makes
   * impossible to take back-to-back, and the one that decided the value in
   * TIERS.high.
   */
  private scaleOverride: number | null = null;

  private renderer!: THREE.WebGLRenderer;
  /** Kept from init so `setQuality` can announce the tier; see publishQuality. */
  private bus: Ctx['bus'] | null = null;
  private blit = new Blit();

  private w = 1;
  private h = 1;
  private hw = 1;
  private hh = 1;
  private qw = 1;
  private qh = 1;
  private outW = 1;
  private outH = 1;

  private rtHDR!: THREE.WebGLRenderTarget;
  private depthTex!: THREE.DepthTexture;
  private rtND!: THREE.WebGLRenderTarget;
  private rtHalf!: THREE.WebGLRenderTarget;
  private rtAO!: THREE.WebGLRenderTarget;
  private rtAOTmp!: THREE.WebGLRenderTarget;
  private rtVol!: THREE.WebGLRenderTarget;
  private rtVolTmp!: THREE.WebGLRenderTarget;
  private rtA!: THREE.WebGLRenderTarget;
  private rtB!: THREE.WebGLRenderTarget;
  private hist: THREE.WebGLRenderTarget[] = [];
  private rtDofIn!: THREE.WebGLRenderTarget;
  private rtDofOut!: THREE.WebGLRenderTarget;
  private rtMeter!: THREE.WebGLRenderTarget;
  private rtExp: THREE.WebGLRenderTarget[] = [];
  private expIdx = 0;
  private bloomDown: THREE.WebGLRenderTarget[] = [];
  private bloomUp: THREE.WebGLRenderTarget[] = [];

  private prepassMat!: THREE.ShaderMaterial;
  private mHalf!: THREE.ShaderMaterial;
  private mAO!: THREE.ShaderMaterial;
  private mAOBlur!: THREE.ShaderMaterial;
  private mVol!: THREE.ShaderMaterial;
  private mVolBlur!: THREE.ShaderMaterial;
  private mComposite!: THREE.ShaderMaterial;
  private mTAA!: THREE.ShaderMaterial;
  private mMB!: THREE.ShaderMaterial;
  private mDofCoc!: THREE.ShaderMaterial;
  private mDofGather!: THREE.ShaderMaterial;
  private mDofComp!: THREE.ShaderMaterial;
  private mBloomPre!: THREE.ShaderMaterial;
  private mBloomDown!: THREE.ShaderMaterial;
  private mBloomUp!: THREE.ShaderMaterial;
  private mMeter!: THREE.ShaderMaterial;
  private mExposure!: THREE.ShaderMaterial;
  private mUber!: THREE.ShaderMaterial;
  private mCAS!: THREE.ShaderMaterial;

  private lut!: THREE.DataTexture;
  private noise!: THREE.DataTexture;
  private dummyDepth!: THREE.DataTexture;

  // Camera state carried across frames for reprojection.
  private prevVP = new THREE.Matrix4();
  private currVP = new THREE.Matrix4();
  /**
   * Inverse of the UNJITTERED current view-projection. The reprojection
   * fallback in TAA and motion blur has to agree with the prepass velocity
   * buffer, which is built from unjittered clip positions on both ends; feeding
   * the jittered inverse in instead offset the two by the jitter itself.
   */
  private invVP = new THREE.Matrix4();
  private prevCamPos = new THREE.Vector3();
  private prevModel = new THREE.Matrix4();
  private prevMatrices = new WeakMap<THREE.Object3D, THREE.Matrix4>();
  private jitterNdc = new THREE.Vector2();
  private jitterIdx = 0;
  private resetHistory = 2;
  private histIdx = 0;

  private sunView = new THREE.Vector3(0, 1, 0);
  private sunWorld = new THREE.Vector3(0, 1, 0);
  private sunColor = new THREE.Color(1, 0.62, 0.42);
  private ambient = new THREE.Color(0.12, 0.13, 0.17);
  private fogDensity = 0.004;
  private hasShadowMap = false;
  private shadowCompare = false;
  private csm: ShadowCascades | null = null;
  private profiler: GpuProfiler | null = null;

  private hiddenDuringPrepass: THREE.Object3D[] = [];
  private prepassOptOut: { mesh: THREE.Mesh; saved: THREE.Material | THREE.Material[] }[] = [];
  private savedClear = new THREE.Color();

  constructor() {
    this.composer = {
      pipeline: this,
      passes: [
        'prepass', 'scene', 'halfres', 'gtao', 'ao-blur', 'volumetrics', 'vol-blur',
        'composite', 'taa', 'motion-blur', 'dof', 'meter', 'exposure', 'bloom', 'uber', 'cas',
      ],
    };
  }

  init(ctx: Ctx): void {
    this.renderer = ctx.renderer;
    this.bus = ctx.bus;
    this.normaliseShadowMapType(ctx.renderer);
    this.lut = buildGradeLUT();
    this.noise = buildBlueNoise(64);
    this.dummyDepth = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.dummyDepth.needsUpdate = true;

    this.buildMaterials();
    this.computeSize(ctx);
    this.buildTargets();
    this.profiler = new GpuProfiler(ctx.renderer);
    this.ready = true;
    // Publish the boot tier. Every listener below is written to be idempotent,
    // and without this the systems that only learn the tier from the bus spend
    // the first frames on whatever their constructor happened to pick.
    this.publishQuality();

    // The kill switches are only useful if a human (or a capture harness) can
    // reach them; they were documented as console-toggleable but never exposed.
    // The pipeline and the three namespace go with them so a QA script can read
    // an intermediate buffer or drop a probe object into the scene without a
    // rebuild — which is how the depth-scale fault below was localised.
    Object.assign(globalThis, { RENDER_DEBUG, RENDER_PIPELINE: this, RENDER_THREE: THREE });
  }

  /**
   * Force the renderer onto a shadow map type the shader compiler still knows.
   *
   * three r185 dropped PCFSoftShadowMap from its shadow-define table. A renderer
   * left on that value compiles every lit material with SHADOWMAP_TYPE_BASIC,
   * which declares `uniform sampler2D directionalShadowMap[]` — while
   * WebGLShadowMap goes on allocating the map as a DEPTH texture with
   * compareFunction set. GLES3 forbids reading a compare-mode depth texture
   * through a non-shadow sampler, so every draw call issued with such a program
   * raises GL_INVALID_OPERATION and is **discarded whole**: no colour, no depth,
   * no warning past the first. That is how an object can be in the render list,
   * reach renderBufferDirect with the right geometry and instance count, and
   * still contribute nothing to the frame.
   *
   * WebGLShadowMap.render() repairs `type` itself, but only on its first call —
   * by which point the boot passes (env synthesis, impostor bakes, the water
   * reflection/refraction views that run before this system's update) have
   * already compiled and cached the poisoned programs, and a cached program is
   * never revisited unless the lights state changes. So the repair has to happen
   * before anything renders, which is here: init() completes for every system
   * before Engine.start() queues the first frame.
   *
   * Anything outside three's table gets the same treatment three's own
   * deprecation path applies — PCF.
   */
  private normaliseShadowMapType(renderer: THREE.WebGLRenderer): void {
    const supported: THREE.ShadowMapType[] = [THREE.PCFShadowMap, THREE.VSMShadowMap];
    if (!supported.includes(renderer.shadowMap.type)) renderer.shadowMap.type = THREE.PCFShadowMap;
  }

  setQuality(tier: Tier): void {
    if (!TIERS[tier]) return;
    this.quality = tier;
    this.cfg = TIERS[tier];
    if (!this.ready) return;
    this.applyTierDefines();
    this.disposeTargets();
    this.computeSizeFromRenderer();
    this.buildTargets();
    this.resetHistory = 2;
    this.publishQuality();
  }

  /**
   * Announce the tier on the bus.
   *
   * This call did not exist, and its absence was not a missing nicety — it was
   * the reason three of the four tiers did nothing outside this file. The sky
   * (`Atmosphere`), the shadow cascade set (`Cascades`, reached through the
   * sky) and the particle system (`VFX`) all subscribe to `quality` and all
   * three were built with a listener that had never once fired: the cloud
   * raymarch ran its 44 primary and 5 light steps at `low`, the cascade set
   * stayed on whatever its constructor chose, and the storm particulate kept
   * its full spawn rate. Selecting `low` therefore bought a smaller render
   * target and nothing else, which is exactly what the tier table's measured
   * behaviour looks like: `low` at 0.38 of `high`'s pixel count came back at
   * 1.96x its framerate rather than the ~2.6x the pixel budget implies, and the
   * shortfall is these three systems refusing to move.
   *
   * The pipeline is the only place that knows the tier, so it is the only place
   * that can say so. Emitted from `init` as well as from `setQuality` because a
   * listener registered after the first call would otherwise never hear it.
   */
  private publishQuality(): void {
    this.bus?.emit<{ tier: Tier }>('quality', { tier: this.quality });
  }

  /**
   * QA hook: force the internal render scale, or pass null to go back to the
   * tier's own value. Rebuilds every render target, so this is a settings-change
   * operation, not something to call per frame.
   */
  setRenderScale(scale: number | null): void {
    this.scaleOverride = scale === null ? null : THREE.MathUtils.clamp(scale, 0.4, 1.0);
    if (!this.ready) return;
    this.disposeTargets();
    this.computeSizeFromRenderer();
    this.buildTargets();
    this.resetHistory = 2;
  }

  /** The internal resolution actually in use, for the settings UI and QA. */
  get renderScale(): number {
    return this.w / Math.max(this.outW, 1);
  }

  /** Cinematic control: 0 keeps everything sharp, 1 is a wide-open aperture. */
  setDof(strength: number, focusDistance?: number): void {
    this.dofStrength = THREE.MathUtils.clamp(strength, 0, 1);
    if (focusDistance !== undefined) this.focusDistance = Math.max(0.5, focusDistance);
  }

  /** f-number for the current aperture setting. Geometric, so f/22 -> f/1.8 is even in stops. */
  private fStop(): number {
    const t = THREE.MathUtils.clamp(this.dofStrength, 0, 1);
    return this.fStopDeep * Math.pow(this.fStopWide / this.fStopDeep, t);
  }

  /**
   * Signed circle of confusion in full-res pixels at a given view distance —
   * the JS twin of `cocPixels` in GLSL_COC, used to decide whether the DOF
   * chain is worth running at all this frame.
   */
  private cocPixelsAt(d: number): number {
    const f = this.focalLen;
    const A = f / this.fStop();
    const c = (A * f * (d - this.focusDistance)) / Math.max(d * (this.focusDistance - f), 1e-5);
    return c * (this.h / this.sensorHeight);
  }

  resize(ctx: Ctx): void {
    if (!this.ready) return;
    this.disposeTargets();
    this.computeSize(ctx);
    this.buildTargets();
    this.resetHistory = 2;
  }

  update(ctx: Ctx): void {
    if (!this.ready) return;
    const r = this.renderer;
    const cam = ctx.camera;

    this.syncSky(ctx);
    this.syncDebugDefines();

    // Unjittered view-projection first: motion vectors must not inherit the
    // sub-pixel jitter or TAA would resolve against a moving target.
    this.currVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.invVP.copy(this.currVP).invert();

    const tanX = 1 / cam.projectionMatrix.elements[0];
    const tanY = 1 / cam.projectionMatrix.elements[5];
    this.tanHalfY = tanY;
    this.camStep = this.prevCamPos.distanceTo(cam.position);
    this.prevFwd.copy(this.camFwd);
    this.camFwd.set(0, 0, -1).applyQuaternion(cam.quaternion);

    // The lens must form the picture we are actually rendering. Fixing a focal
    // length independently of the FOV is what made the old DOF blow out: CoC
    // scales with f-squared, so an 85 mm lens driving a 55-degree frame
    // over-defocused by two orders of magnitude.
    this.focalLen = (this.sensorHeight * 0.5) / Math.max(tanY, 1e-4);

    const jitterOn = this.cfg.taa && RENDER_DEBUG.taa;
    let jx = 0;
    let jy = 0;
    if (jitterOn) {
      const n = (this.jitterIdx % this.cfg.jitterCount) + 1;
      jx = halton(n, 2) - 0.5;
      jy = halton(n, 3) - 0.5;
      this.jitterIdx++;
    }
    this.jitterNdc.set((2 * jx) / this.w, (2 * jy) / this.h);
    const e = cam.projectionMatrix.elements;
    const savedM02 = e[8];
    const savedM12 = e[9];
    e[8] -= this.jitterNdc.x;
    e[9] -= this.jitterNdc.y;

    // A teleport invalidates every history sample at once; reprojection would
    // otherwise smear the old world across the new one for several frames.
    if (this.prevCamPos.distanceToSquared(cam.position) > 400) this.resetHistory = 1;

    this.setSharedDepthUniforms(tanX, tanY);

    const p = this.profiler;

    const usePrepass = this.cfg.prepass && RENDER_DEBUG.prepass;
    if (usePrepass) {
      p?.begin('prepass');
      this.renderPrepass(ctx);
      p?.end();
    }

    // Shadows are rendered explicitly, before the main pass and outside it.
    //
    // three would happily do this from inside `render()`, but then the cascade
    // set is welded to the same clock as the frame, cannot be timed on its own,
    // and — as the review build proved — one stray `needsUpdate` in the wrong
    // place silently freezes every shadow in the game. Owning the call means the
    // per-cascade schedule in ShadowCascades is the only thing that decides when
    // a cascade re-renders, and the pass shows up in the profile by name.
    // Shadow maps are refreshed inside this render and nowhere else; the
    // per-cascade schedule decides how many of them actually redraw.
    this.scheduleShadows(ctx);

    p?.begin('scene+shadows');
    r.setRenderTarget(this.rtHDR);
    r.render(ctx.scene, cam);
    p?.end();

    e[8] = savedM02;
    e[9] = savedM12;

    p?.begin('halfres');
    this.renderHalfRes();
    p?.end();

    const useAO = RENDER_DEBUG.ao;
    const useCS = this.cfg.contact && RENDER_DEBUG.contactShadows;
    if (useAO || useCS) {
      p?.begin('gtao');
      this.renderAO(ctx);
      this.blurAO();
      p?.end();
    }

    const useVol = this.cfg.volumetrics && RENDER_DEBUG.volumetrics;
    if (useVol) {
      p?.begin('volumetrics');
      this.renderVolumetrics(ctx);
      p?.end();
    }

    p?.begin('composite');
    let src = this.composite(useAO, useCS, useVol);
    p?.end();

    if (this.cfg.taa && RENDER_DEBUG.taa) {
      p?.begin('taa');
      src = this.resolveTAA(src);
      p?.end();
    }
    if (this.cfg.motionBlur && RENDER_DEBUG.motionBlur && this.cameraMoved()) {
      p?.begin('motion-blur');
      src = this.renderMotionBlur(src, ctx);
      p?.end();
    }
    if (this.cfg.dof && RENDER_DEBUG.dof && this.dofNeeded()) {
      p?.begin('dof');
      src = this.renderDof(src);
      p?.end();
    }

    // Metering reads the resolved frame, so it sees exactly the image the
    // tonemapper will see; bloom's bright pass then reads the same exposure.
    p?.begin('exposure');
    this.renderExposure(src, ctx);
    p?.end();
    if (RENDER_DEBUG.bloom) {
      p?.begin('bloom');
      this.renderBloom(src);
      p?.end();
    }

    p?.begin('uber');
    src = this.renderUber(src, ctx);
    p?.end();
    p?.begin('cas');
    this.renderOutput(src, ctx);
    p?.end();
    p?.collect();

    r.setRenderTarget(null);
    this.prevVP.copy(this.currVP);
    this.prevCamPos.copy(cam.position);
    this.resetHistory = Math.max(0, this.resetHistory - 1);
  }

  dispose(): void {
    this.profiler?.dispose();
    this.profiler = null;
    this.disposeTargets();
    this.disposeExposure();
    this.blit.dispose();
    this.lut.dispose();
    this.noise.dispose();
    this.dummyDepth.dispose();
    for (const m of [
      this.prepassMat, this.mHalf, this.mAO, this.mAOBlur, this.mVol, this.mVolBlur,
      this.mComposite, this.mTAA, this.mMB, this.mDofCoc, this.mDofGather, this.mDofComp,
      this.mBloomPre, this.mBloomDown, this.mBloomUp, this.mMeter, this.mExposure,
      this.mUber, this.mCAS,
    ]) {
      m?.dispose();
    }
    this.ready = false;
  }

  /* ------------------------------------------------------------- sizing */

  private computeSize(ctx: Ctx): void {
    const dpr = ctx.renderer.getPixelRatio();
    this.outW = Math.max(1, Math.round(ctx.size.w * dpr));
    this.outH = Math.max(1, Math.round(ctx.size.h * dpr));
    this.applyScale();
  }

  private computeSizeFromRenderer(): void {
    const v = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.outW = Math.max(1, Math.round(v.x));
    this.outH = Math.max(1, Math.round(v.y));
    this.applyScale();
  }

  private applyScale(): void {
    const px = this.outW * this.outH;
    // Two independent caps: the tier's nominal scale, and an absolute pixel
    // budget so a 5K retina canvas cannot quietly cost 4x the target frame.
    let s = this.scaleOverride ?? this.cfg.scale;
    if (px * s * s > this.cfg.maxPixels) s = Math.sqrt(this.cfg.maxPixels / px);
    s = THREE.MathUtils.clamp(s, 0.4, 1.0);
    this.w = decohere(Math.max(8, Math.round(this.outW * s)), this.outW);
    this.h = decohere(Math.max(8, Math.round(this.outH * s)), this.outH);
    this.hw = Math.max(4, Math.ceil(this.w / 2));
    this.hh = Math.max(4, Math.ceil(this.h / 2));
    this.qw = Math.max(2, Math.ceil(this.hw / 2));
    this.qh = Math.max(2, Math.ceil(this.hh / 2));
  }

  /* ------------------------------------------------------------ targets */

  private buildTargets(): void {
    const { w, h, hw, hh, qw, qh } = this;

    this.rtHDR = makeRT(w, h, { depth: true });
    this.depthTex = new THREE.DepthTexture(w, h, THREE.FloatType);
    this.depthTex.format = THREE.DepthFormat;
    this.depthTex.minFilter = THREE.NearestFilter;
    this.depthTex.magFilter = THREE.NearestFilter;
    this.rtHDR.depthTexture = this.depthTex;

    // Attachment 0: view normal + linear view depth. Attachment 1: motion
    // vectors in UV units, alpha flagging prepass coverage. Tiers without a
    // prepass never render into this, so allocate a stub rather than two
    // full-res RGBA16F surfaces nothing will ever write (~17 MB at `low`).
    // Gating on cfg.prepass alone is safe: RENDER_DEBUG.prepass can only turn
    // the prepass off, never on, so it cannot outvote this allocation.
    const ndW = this.cfg.prepass ? w : 1;
    const ndH = this.cfg.prepass ? h : 1;
    this.rtND = makeRT(ndW, ndH, { count: 2, depth: true, filter: THREE.NearestFilter });

    this.rtHalf = makeRT(hw, hh, { filter: THREE.NearestFilter });
    this.rtAO = makeRT(hw, hh, { type: THREE.UnsignedByteType });
    this.rtAOTmp = makeRT(hw, hh, { type: THREE.UnsignedByteType });
    // Quarter res. The volumetric buffer holds in-scattered radiance through a
    // participating medium: it is band-limited by the medium itself, has no
    // edges of its own, and is bilaterally blurred immediately afterwards. Four
    // times fewer ray marches for a buffer whose highest spatial frequency is
    // the silhouette of a shaft, which survives the upsample intact.
    this.rtVol = makeRT(qw, qh);
    this.rtVolTmp = makeRT(qw, qh);

    this.rtA = makeRT(w, h);
    this.rtB = makeRT(w, h);
    this.hist = [makeRT(w, h), makeRT(w, h)];

    this.rtDofIn = makeRT(hw, hh);
    this.rtDofOut = makeRT(hw, hh, { count: 2 });

    // The exposure pair is resolution-independent and ping-pongs across frames
    // for eye adaptation, so it survives a resize with only a history reset.
    // Two attachments: the mean/highlight grid and the shadow grid. See
    // METER_FRAG — the second one is what lets the black point find a frame's
    // own floor rather than assuming it sits a fixed fraction under the mean.
    this.rtMeter = makeRT(METER_W, METER_H, { filter: THREE.NearestFilter, count: 2 });
    if (this.rtExp.length === 0) {
      // Full float, not half: this is the one target QA reads back, and
      // readRenderTargetPixels types its buffer from the texture.
      const o = { filter: THREE.NearestFilter, type: THREE.FloatType };
      this.rtExp = [makeRT(1, 1, o), makeRT(1, 1, o)];
    }

    this.bloomDown = [];
    this.bloomUp = [];
    let bw = Math.max(2, hw);
    let bh = Math.max(2, hh);
    for (let i = 0; i < this.cfg.bloomMips; i++) {
      if (bw < 6 || bh < 6) break;
      this.bloomDown.push(makeRT(bw, bh));
      bw = Math.max(2, Math.floor(bw / 2));
      bh = Math.max(2, Math.floor(bh / 2));
    }
    for (let i = 0; i < this.bloomDown.length - 1; i++) {
      this.bloomUp.push(makeRT(this.bloomDown[i].width, this.bloomDown[i].height));
    }

    this.wireStaticUniforms();
    this.resetHistory = 2;
  }

  private disposeTargets(): void {
    const all = [
      this.rtHDR, this.rtND, this.rtHalf, this.rtAO, this.rtAOTmp, this.rtVol, this.rtVolTmp,
      this.rtA, this.rtB, this.rtDofIn, this.rtDofOut, this.rtMeter,
      ...this.hist, ...this.bloomDown, ...this.bloomUp,
    ];
    for (const t of all) t?.dispose();
    this.depthTex?.dispose();
    this.hist = [];
    this.bloomDown = [];
    this.bloomUp = [];
  }

  private disposeExposure(): void {
    for (const t of this.rtExp) t?.dispose();
    this.rtExp = [];
  }

  /* ---------------------------------------------------------- materials */

  private buildMaterials(): void {
    this.prepassMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: PREPASS_VERT,
      fragmentShader: PREPASS_FRAG,
      uniforms: {
        uPrevModel: { value: this.prevModel },
        uCurrVP: { value: this.currVP },
        uPrevVP: { value: this.prevVP },
      },
      // Foliage and chitin panels are routinely double-sided; culling here
      // would punch holes in the normal buffer that AO reads as gaps.
      side: THREE.DoubleSide,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
    this.prepassMat.onBeforeRender = (_r, _s, _c, _g, object) => {
      const prev = this.prevMatrices.get(object);
      if (prev) {
        this.prevModel.copy(prev);
        prev.copy(object.matrixWorld);
      } else {
        this.prevModel.copy(object.matrixWorld);
        this.prevMatrices.set(object, object.matrixWorld.clone());
      }
      // ShaderMaterial uniforms are otherwise uploaded once per program bind;
      // this forces the per-object previous transform through.
      this.prepassMat.uniformsNeedUpdate = true;
    };

    const depthU = (): Uniforms => ({
      uNearFar: { value: new THREE.Vector2(0.1, 1000) },
      uTanHalf: { value: new THREE.Vector2(1, 1) },
      uJitterNdc: { value: this.jitterNdc },
    });

    this.mHalf = fsMaterial(HALFRES_FRAG, {
      tDepth: { value: null },
      tND: { value: null },
      uTexelFull: { value: new THREE.Vector2() },
      ...depthU(),
    });

    this.mAO = fsMaterial(AO_FRAG, {
      tHalf: { value: null },
      tNoise: { value: this.noise },
      uHalfSize: { value: new THREE.Vector2() },
      uNoiseScale: { value: new THREE.Vector2() },
      uFrame: { value: 0 },
      uRadius: { value: 1.25 },
      uPower: { value: 1.15 },
      uProjScale: { value: 500 },
      uSunView: { value: this.sunView },
      uCsLength: { value: this.contactLength },
      uCsThickness: { value: this.contactThickness },
      uCsMinPix: { value: this.contactMinPixels },
      ...depthU(),
    });

    this.mAOBlur = fsMaterial(AO_BLUR_FRAG, {
      tAO: { value: null },
      tHalf: { value: null },
      uDir: { value: new THREE.Vector2() },
      uDepthSigma: { value: 6.0 },
    });

    this.mVol = fsMaterial(VOL_FRAG, {
      tHalf: { value: null },
      tNoise: { value: this.noise },
      tShadow: { value: this.dummyDepth },
      tShadowFar: { value: this.dummyDepth },
      uShadowMat: { value: new THREE.Matrix4() },
      uShadowMatFar: { value: new THREE.Matrix4() },
      uShadowBias: { value: new THREE.Vector2(0.0015, 0.0015) },
      uShadowBand: { value: VOL_CASCADE_BAND },
      uInvView: { value: new THREE.Matrix4() },
      uNoiseScale: { value: new THREE.Vector2() },
      uFrame: { value: 0 },
      uSunWorld: { value: this.sunWorld },
      uSunColor: { value: new THREE.Vector3(1, 0.6, 0.4) },
      uAmbient: { value: new THREE.Vector3(0.02, 0.022, 0.03) },
      uMulti: { value: new THREE.Vector3(0, 0, 0) },
      uDensity: { value: 0.008 },
      uHeightFalloff: { value: 240 },
      uBaseY: { value: 0 },
      uMaxDist: { value: 900 },
      uAniso: { value: 0.72 },
      uBulkRemove: { value: 1.0 },
      ...depthU(),
    });

    this.mVolBlur = fsMaterial(VOL_BLUR_FRAG, {
      tVol: { value: null },
      tHalf: { value: null },
      uDir: { value: new THREE.Vector2() },
      uDepthSigma: { value: 4.0 },
    });

    this.mComposite = fsMaterial(COMPOSITE_FRAG, {
      tScene: { value: null },
      tAO: { value: null },
      tVol: { value: null },
      tHalf: { value: null },
      tDepth: { value: null },
      uHalfSize: { value: new THREE.Vector2() },
      uQuarterSize: { value: new THREE.Vector2() },
      uAoStrength: { value: 0.9 },
      uAoFloor: { value: 0.42 },
      uCsFloor: { value: 0.3 },
      uCsStrength: { value: 0.75 },
      uVolStrength: { value: 0.8 },
      uVolFog: { value: 0.3 },
      // Bilateral tolerance MULTIPLIER, not a depth scale — the term it
      // multiplies is already in the right units (see COMPOSITE_FRAG). 2.0
      // means "twice the depth disagreement two adjacent pixels would show
      // anyway is still the same surface".
      uBilateralK: { value: 2.0 },
      uBilateralLegacy: { value: 0 },
      uSunView: { value: this.sunView },
      ...depthU(),
    });

    this.mTAA = fsMaterial(TAA_FRAG, {
      tCurrent: { value: null },
      tHistory: { value: null },
      tVel: { value: null },
      tDepth: { value: null },
      uPrevVP: { value: this.prevVP },
      uInvVP: { value: this.invVP },
      uTexel: { value: new THREE.Vector2() },
      uSize: { value: new THREE.Vector2() },
      uFeedback: { value: 0.92 },
      uReset: { value: 0 },
      uFireflyClamp: { value: this.fireflyClamp },
      ...depthU(),
    });

    this.mMB = fsMaterial(MBLUR_FRAG, {
      tColor: { value: null },
      tVel: { value: null },
      tDepth: { value: null },
      uPrevVP: { value: this.prevVP },
      uInvVP: { value: this.invVP },
      uTexel: { value: new THREE.Vector2() },
      uSize: { value: new THREE.Vector2() },
      uShutter: { value: 0.5 },
      uMaxRadius: { value: 32 },
      uFrame: { value: 0 },
      ...depthU(),
    });

    const cocU = (): Uniforms => ({
      uFocalLen: { value: this.focalLen },
      uFStop: { value: this.fStopDeep },
      uFocusDist: { value: this.focusDistance },
      uCocScale: { value: 1 / this.sensorHeight },
      uMaxCoc: { value: 16 },
      uCocMin: { value: this.cocDeadband },
    });

    this.mDofCoc = fsMaterial(DOF_COC_FRAG, {
      tColor: { value: null },
      tDepth: { value: null },
      uTexelFull: { value: new THREE.Vector2() },
      ...depthU(),
      ...cocU(),
    });

    this.mDofGather = fsMaterial(DOF_GATHER_FRAG, {
      tIn: { value: null },
      uHalfSize: { value: new THREE.Vector2() },
      uMaxCoc: { value: 16 },
      uFrame: { value: 0 },
    });

    this.mDofComp = fsMaterial(DOF_COMPOSITE_FRAG, {
      tColor: { value: null },
      tFar: { value: null },
      tNear: { value: null },
      tDepth: { value: null },
      ...depthU(),
      ...cocU(),
    });

    this.mMeter = fsMaterial(METER_FRAG, {
      tSrc: { value: null },
      tPrev: { value: null },
      uTileSize: { value: new THREE.Vector2(1 / METER_W, 1 / METER_H) },
    }, { METER_TAPS: String(METER_TAPS) });

    this.mExposure = fsMaterial(EXPOSURE_FRAG, {
      tMeter: { value: null },
      tMeterDark: { value: null },
      tPrev: { value: null },
      uMeterSize: { value: new THREE.Vector2(METER_W, METER_H) },
      uKey: { value: this.exposureKey },
      uAdapt: { value: this.exposureAdapt },
      uMinExp: { value: this.exposureMin },
      uMaxExp: { value: this.exposureMax },
      uRate: { value: this.exposureRate },
      uDt: { value: 1 / 60 },
      uReset: { value: 1 },
      uHiKey: { value: this.highlightKey },
      uMaxLift: { value: this.highlightMaxLift },
      uMinLift: { value: this.highlightMinLift },
      uBlackRel: { value: this.blackRel },
      uDarkFloor: { value: this.darkFloor },
      uGainMax: { value: this.gainMax },
      uRangeLo: { value: this.keyRangeLo },
      uRangeHi: { value: this.keyRangeHi },
      uHiCeil: { value: this.highlightCeil },
      uGainMin: { value: this.gainMin },
      uTrim: { value: 1.0 },
    }, { METER_W: String(METER_W), METER_H: String(METER_H), METER_TAPS: String(METER_TAPS) });

    const bloomU = (): Uniforms => ({
      tSrc: { value: null },
      tExposure: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uThreshold: { value: this.bloomThreshold },
      uKnee: { value: 0.55 },
      // Ceiling on a single bloom-source pixel, in exposed units — roughly
      // eight times the metered key. It was 24, i.e. seven stops over midtone,
      // which is no ceiling at all: one hot texel on an ash sprite survives the
      // Karis average, is spread by the 13-tap chain along whichever mip row it
      // lands in, and comes back as a one-pixel streak across whatever geometry
      // is behind it. Clamping the *input* is the only place that can be fixed
      // without also flattening real specular rolloff.
      uClamp: { value: 8 },
    });
    this.mBloomPre = fsMaterial(BLOOM_DOWN_FRAG, bloomU(), { PREFILTER: '' });
    this.mBloomDown = fsMaterial(BLOOM_DOWN_FRAG, bloomU());
    this.mBloomUp = fsMaterial(BLOOM_UP_FRAG, {
      tSmall: { value: null },
      tBig: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uRadius: { value: 1.0 },
    });

    this.mUber = fsMaterial(UBER_FRAG, {
      tColor: { value: null },
      tBloom: { value: null },
      tExposure: { value: null },
      tLUT: { value: this.lut },
      uLutMix: { value: 1.0 },
      uBloomIntensity: { value: 0.055 },
      uExposure: { value: 1.0 },
      // Peak per-channel displacement at the extreme corner, in PIXELS, falling
      // off as r^2 to exactly zero on axis. Sub-pixel everywhere by design: the
      // previous UV-denominated 0.0022 worked out to two to three pixels of
      // R-versus-B separation at 1080p, which is a doubled image, not a lens.
      uCaPixels: { value: this.caPixels },
      uTexel: { value: new THREE.Vector2() },
      uVignette: { value: 0.11 },
      uShoulder: { value: this.shoulder },
      uToeKnee: { value: this.toeKnee },
      uHueRestore: { value: this.hueRestore },
    });

    this.mCAS = fsMaterial(CAS_FRAG, {
      tColor: { value: null },
      tDebug: { value: this.noise },
      tBlue: { value: this.noise },
      tAO: { value: null },
      tVol: { value: null },
      tBloomDbg: { value: null },
      tDepth: { value: null },
      tHalf: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uSrcSize: { value: new THREE.Vector2() },
      ...depthU(),
      // Enough to recover the sub-pixel detail TAA integrates away, not enough
      // to re-harden a resolved silhouette back into a staircase.
      uSharpness: { value: 0.30 },
      // Film grain, in sRGB-encoded units — a shade over 1 LSB peak in the
      // midtones, tapering to the dither floor in blacks and highlights. Laid
      // down here rather than in the uber pass so it is exactly one canvas pixel
      // wide whatever the internal render scale is, and so the sharpen upstream
      // of it cannot multiply it.
      uGrain: { value: this.filmGrain },
      uFrame: { value: 0 },
      uDebugMode: { value: 0 },
    });

    this.applyTierDefines();
  }

  private setDefine(m: THREE.ShaderMaterial, key: string, on: boolean, value = ''): void {
    const has = m.defines[key] !== undefined;
    if (has === on && (!on || m.defines[key] === value)) return;
    if (on) m.defines[key] = value;
    else delete m.defines[key];
    m.needsUpdate = true;
  }

  private applyTierDefines(): void {
    const c = this.cfg;
    this.setDefine(this.mAO, 'AO_DIRS', true, String(c.aoDirs));
    this.setDefine(this.mAO, 'AO_STEPS', true, String(c.aoSteps));
    this.setDefine(this.mAO, 'CS_STEPS', true, String(c.csSteps));
    this.setDefine(this.mVol, 'VOL_STEPS', true, String(c.volSteps));
    this.setDefine(this.mMB, 'MB_SAMPLES', true, String(c.mbSamples));
    this.setDefine(this.mDofGather, 'DOF_TAPS', true, String(c.dofTaps));
  }

  private syncDebugDefines(): void {
    const c = this.cfg;
    this.setDefine(this.mAO, 'CONTACT_SHADOWS', c.contact && RENDER_DEBUG.contactShadows);
    this.setDefine(this.mComposite, 'USE_AO', RENDER_DEBUG.ao);
    this.setDefine(this.mComposite, 'CONTACT_SHADOWS', c.contact && RENDER_DEBUG.contactShadows);
    this.setDefine(this.mComposite, 'USE_VOLUMETRICS', c.volumetrics && RENDER_DEBUG.volumetrics);
    this.setDefine(this.mUber, 'USE_BLOOM', RENDER_DEBUG.bloom);
    this.setDefine(this.mUber, 'USE_TONEMAP', RENDER_DEBUG.tonemap);
    this.setDefine(this.mUber, 'USE_LUT', RENDER_DEBUG.lut);
    this.setDefine(this.mUber, 'USE_VIGNETTE', RENDER_DEBUG.vignette);
    this.setDefine(this.mCAS, 'USE_CAS', c.cas && RENDER_DEBUG.cas);
    // The sharpen and the reconstruction filter are alternatives, not a chain.
    // Sharpening a non-integer upscale with taps spaced one source texel apart
    // is what resonated with the resampling lattice and printed a screen-door
    // over every surface; see the comment on `reconstruct` in CAS_FRAG.
    this.setDefine(this.mCAS, 'UPSCALING', this.w < this.outW || this.h < this.outH);
    this.setDefine(this.mHalf, 'HAS_PREPASS', c.prepass && RENDER_DEBUG.prepass);
    // Without a prepass there is no velocity buffer; both consumers must fall
    // back to depth reprojection rather than sampling an unbound sampler.
    const hasVel = c.prepass && RENDER_DEBUG.prepass;
    this.setDefine(this.mTAA, 'HAS_VELOCITY', hasVel);
    this.setDefine(this.mMB, 'HAS_VELOCITY', hasVel);
    this.setDefine(this.mVol, 'HAS_SHADOWMAP', this.hasShadowMap);
    this.setDefine(this.mVol, 'SHADOW_COMPARE', this.hasShadowMap && this.shadowCompare);
  }

  private wireStaticUniforms(): void {
    const texFull = new THREE.Vector2(1 / this.w, 1 / this.h);
    const half = new THREE.Vector2(this.hw, this.hh);

    this.mHalf.uniforms.tDepth.value = this.depthTex;
    this.mHalf.uniforms.tND.value = this.rtND.textures[0];
    this.mHalf.uniforms.uTexelFull.value = texFull.clone();

    this.mAO.uniforms.tHalf.value = this.rtHalf.texture;
    this.mAO.uniforms.uHalfSize.value = half.clone();
    this.mAO.uniforms.uNoiseScale.value = new THREE.Vector2(this.hw / 64, this.hh / 64);

    this.mAOBlur.uniforms.tHalf.value = this.rtHalf.texture;
    this.mVol.uniforms.tHalf.value = this.rtHalf.texture;
    this.mVol.uniforms.uNoiseScale.value = new THREE.Vector2(this.qw / 64, this.qh / 64);
    this.mVolBlur.uniforms.tHalf.value = this.rtHalf.texture;

    this.mComposite.uniforms.tHalf.value = this.rtHalf.texture;
    this.mComposite.uniforms.tDepth.value = this.depthTex;
    this.mComposite.uniforms.uHalfSize.value = half.clone();
    this.mComposite.uniforms.uQuarterSize.value = new THREE.Vector2(this.qw, this.qh);

    this.mTAA.uniforms.tDepth.value = this.depthTex;
    this.mTAA.uniforms.tVel.value = this.rtND.textures[1];
    this.mTAA.uniforms.uTexel.value = texFull.clone();
    this.mTAA.uniforms.uSize.value = new THREE.Vector2(this.w, this.h);

    this.mMB.uniforms.tDepth.value = this.depthTex;
    this.mMB.uniforms.tVel.value = this.rtND.textures[1];
    this.mMB.uniforms.uTexel.value = texFull.clone();
    this.mMB.uniforms.uSize.value = new THREE.Vector2(this.w, this.h);
    this.mMB.uniforms.uMaxRadius.value = Math.max(12, this.h * 0.03);

    this.mDofCoc.uniforms.tDepth.value = this.depthTex;
    this.mDofCoc.uniforms.uTexelFull.value = texFull.clone();
    this.mDofGather.uniforms.uHalfSize.value = half.clone();
    this.mDofComp.uniforms.tDepth.value = this.depthTex;
    this.mDofComp.uniforms.tFar.value = this.rtDofOut.textures[0];
    this.mDofComp.uniforms.tNear.value = this.rtDofOut.textures[1];

    this.mUber.uniforms.uTexel.value = texFull.clone();
    this.mCAS.uniforms.uTexel.value = texFull.clone();
    this.mCAS.uniforms.uSrcSize.value = new THREE.Vector2(this.w, this.h);
    this.mCAS.uniforms.tDepth.value = this.depthTex;
    this.mCAS.uniforms.tHalf.value = this.rtHalf.texture;

    const maxCoc = Math.max(6, Math.round(this.h * 0.014));
    this.mDofCoc.uniforms.uMaxCoc.value = maxCoc;
    this.mDofComp.uniforms.uMaxCoc.value = maxCoc;
    this.mDofGather.uniforms.uMaxCoc.value = maxCoc;
    // Pixels per metre of sensor: the one place render resolution enters the
    // optical model, so a resolution change never changes the depth of field.
    const cocScale = this.h / this.sensorHeight;
    this.mDofCoc.uniforms.uCocScale.value = cocScale;
    this.mDofComp.uniforms.uCocScale.value = cocScale;
  }

  private setSharedDepthUniforms(tanX: number, tanY: number): void {
    const mats = [
      this.mHalf, this.mAO, this.mVol, this.mComposite, this.mTAA, this.mMB,
      this.mDofCoc, this.mDofComp,
    ];
    for (const m of mats) {
      const u = m.uniforms;
      if (u.uNearFar) u.uNearFar.value.set(this.near, this.far);
      if (u.uTanHalf) u.uTanHalf.value.set(tanX, tanY);
      if (u.uJitterNdc) u.uJitterNdc.value = this.jitterNdc;
    }
  }

  private near = 0.1;
  private far = 12000;
  /** Metres. Derived every frame from the projection, never authored by hand. */
  private focalLen = 0.024;

  /* -------------------------------------------------------------- passes */

  private syncSky(ctx: Ctx): void {
    this.near = ctx.camera.near;
    this.far = ctx.camera.far;

    const sky = ctx.get<CascadedSky>('sky');
    if (sky) {
      const sun = sky.sun;
      this.sunWorld.copy(sun.position).sub(sun.target.position);
      if (this.sunWorld.lengthSq() < 1e-8) this.sunWorld.set(0, 1, 0);
      this.sunWorld.normalize();
      this.sunColor.copy(sky.weather.sunColor);
      this.ambient.copy(sky.weather.ambient);
      this.fogDensity = sky.weather.fogDensity;

      // Volumetrics read two cascades: the second one for shaft *shape* near the
      // camera, the last one for reach. See VOL_FRAG.
      this.csm = sky.csm ?? null;
      const csm = this.csm;
      const nearIdx = csm ? Math.min(1, csm.count - 1) : 0;
      const farIdx = csm ? csm.count - 1 : 0;
      const dtNear = csm ? csm.depthTexture(nearIdx) : null;
      const dtFar = csm ? csm.depthTexture(farIdx) : null;
      const usable = dtNear !== null && dtFar !== null;
      this.hasShadowMap = usable;
      this.shadowCompare = usable && dtNear.compareFunction !== null;
      this.mVol.uniforms.tShadow.value = usable ? dtNear : this.dummyDepth;
      this.mVol.uniforms.tShadowFar.value = usable ? dtFar : this.dummyDepth;
      if (usable && csm) {
        this.mVol.uniforms.uShadowMat.value.copy(csm.shadowMatrix(nearIdx));
        this.mVol.uniforms.uShadowMatFar.value.copy(csm.shadowMatrix(farIdx));
        // One bias in *metres*, converted into each cascade's own normalised
        // depth. The two cascades' frusta differ by more than 2x in depth span
        // and by ~10x in texel size, so a single normalised number meant two
        // very different world offsets and the fog stepped in brightness
        // wherever the march crossed from one map to the other.
        const bias = this.mVol.uniforms.uShadowBias.value as THREE.Vector2;
        bias.set(
          volumeBiasMetres(csm.texelSize(nearIdx)) / csm.depthRange(nearIdx),
          volumeBiasMetres(csm.texelSize(farIdx)) / csm.depthRange(farIdx),
        );
      }
    } else {
      this.csm = null;
      this.hasShadowMap = false;
      this.shadowCompare = false;
      this.mVol.uniforms.tShadow.value = this.dummyDepth;
      this.mVol.uniforms.tShadowFar.value = this.dummyDepth;
    }
    this.sunView.copy(this.sunWorld).transformDirection(ctx.camera.matrixWorldInverse);

    // Exposure ceiling by hour. The ramps sit outside civil twilight at both
    // ends so dawn (6.2) and dusk (19.8) — the two shots whose whole subject is
    // a sun on the horizon — keep the daylight ceiling, and only the genuinely
    // starlit hours are held back.
    const h = ctx.clock.hour;
    const day = THREE.MathUtils.smoothstep(h, 4.2, 6.0) * (1 - THREE.MathUtils.smoothstep(h, 20.4, 22.2));
    this.exposureMax = THREE.MathUtils.lerp(this.exposureMaxNight, this.exposureMaxDay, day);
  }

  /**
   * Feed the shared prepass matrices into an opted-out material. The terrain (or
   * any other system with a bespoke vertex path) authors its own prepass shader;
   * all we owe it is the same current/previous transforms the generic path gets,
   * so its motion vectors land in the same space as everyone else's.
   */
  private wirePrepassUniforms(mat: THREE.Material, obj: THREE.Object3D): void {
    const sm = mat as Partial<THREE.ShaderMaterial>;
    const u = sm.uniforms;
    if (!u) return;
    if (u.uCurrVP) u.uCurrVP.value = this.currVP;
    if (u.uPrevVP) u.uPrevVP.value = this.prevVP;
    if (u.uPrevModel) {
      const prev = this.prevMatrices.get(obj);
      if (prev) {
        this.prevModel.copy(prev);
        prev.copy(obj.matrixWorld);
      } else {
        this.prevModel.copy(obj.matrixWorld);
        this.prevMatrices.set(obj, obj.matrixWorld.clone());
      }
      const dst: unknown = u.uPrevModel.value;
      if (dst instanceof THREE.Matrix4) dst.copy(this.prevModel);
      else u.uPrevModel.value = this.prevModel.clone();
    }
    sm.uniformsNeedUpdate = true;
  }

  /**
   * Decide which cascades re-render this frame.
   *
   * three renders shadows from inside `render()`, gated by two independent
   * pairs of flags: the global `shadowMap.autoUpdate`/`needsUpdate`, and each
   * `LightShadow`'s own pair. The global pair is opened here for the main pass
   * only — never for the prepass, which would otherwise pay for the whole thing
   * twice — and the per-cascade pair, set by ShadowCascades during its fit, is
   * what actually selects the work.
   *
   * This is where the review build broke: it set the global `needsUpdate` on
   * alternate frames from inside the same function that had already forced
   * `autoUpdate = false` for the prepass, and the alternate-frame branch never
   * fired. The map was rendered once at boot and frozen, which is why every
   * critic reported zero cast shadows. Splitting the two decisions apart — the
   * prepass closes the gate, the main pass opens it, the cascades decide what
   * goes through — makes that class of mistake structurally impossible.
   */
  private scheduleShadows(ctx: Ctx): void {
    const r = this.renderer;
    if (this.resetHistory > 0) this.csm?.invalidate();
    r.shadowMap.autoUpdate = false;
    const csm = this.csm;
    if (!RENDER_DEBUG.shadowRefresh) {
      if (csm) for (const l of csm.lights) l.shadow.needsUpdate = false;
      r.shadowMap.needsUpdate = false;
      return;
    }
    let due = false;
    if (csm) {
      for (const l of csm.lights) if (l.shadow.needsUpdate) due = true;
    } else {
      due = true;
    }
    r.shadowMap.needsUpdate = due;
  }

  /**
   * GPU cost per pass in milliseconds. Returns an empty list on drivers without
   * EXT_disjoint_timer_query_webgl2; `profiling` has to be switched on first,
   * and takes a few frames to fill.
   */
  gpuBreakdown(): { pass: string; ms: number }[] {
    return this.profiler?.report() ?? [];
  }

  set profiling(on: boolean) {
    if (this.profiler) this.profiler.enabled = on;
  }

  get profiling(): boolean {
    return this.profiler?.enabled ?? false;
  }

  get profilingSupported(): boolean {
    return this.profiler?.supported ?? false;
  }

  private renderPrepass(ctx: Ctx): void {
    const r = this.renderer;
    const scene = ctx.scene;

    // Two classes of object need special handling before the blanket override
    // goes on:
    //
    //  - Opt-outs. `userData.prepassMaterial` means "my vertices do not come
    //    from the attributes PREPASS_VERT knows about" — instanced heightfield
    //    fetches, procedural displacement, anything the generic shader would
    //    silently collapse to the origin. Render those with the material they
    //    supplied, and clear `allowOverride` so three cannot swap it back out.
    //  - Alpha-blended objects, which would write opaque normals and velocity
    //    through the override material; a particle sheet doing that ruins AO
    //    for the frame.
    this.hiddenDuringPrepass.length = 0;
    this.prepassOptOut.length = 0;
    scene.traverseVisible((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (!mat) return;

      const custom = (o.userData as Record<string, unknown>).prepassMaterial;
      if (custom instanceof THREE.Material) {
        custom.allowOverride = false;
        this.wirePrepassUniforms(custom, o);
        this.prepassOptOut.push({ mesh, saved: mat });
        mesh.material = custom;
        return;
      }

      // The G-buffer has to describe the same surface the depth attachment
      // does. Anything that is alpha-blended, or that draws without writing
      // depth (the sky dome, particle sheets), would otherwise stamp normals
      // and velocity over pixels whose depth belongs to the geometry behind it
      // — a sky dome six metres from the camera reporting zero motion is enough
      // to freeze the whole sky in the TAA history while the camera pans.
      const list = Array.isArray(mat) ? mat : [mat];
      if (list.some((x) => x.transparent || x.depthWrite === false)) {
        this.hiddenDuringPrepass.push(o);
      }
    });
    for (const o of this.hiddenDuringPrepass) o.visible = false;

    const bg = scene.background;
    scene.background = null;
    const prevOverride = scene.overrideMaterial;
    scene.overrideMaterial = this.prepassMat;

    r.getClearColor(this.savedClear);
    const savedAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = false;

    r.setRenderTarget(this.rtND);
    r.render(scene, ctx.camera);

    r.setClearColor(this.savedClear, savedAlpha);
    scene.overrideMaterial = prevOverride;
    scene.background = bg;
    for (const o of this.hiddenDuringPrepass) o.visible = true;
    for (const e of this.prepassOptOut) e.mesh.material = e.saved;
    this.hiddenDuringPrepass.length = 0;
    this.prepassOptOut.length = 0;
  }

  private renderHalfRes(): void {
    // Always bind a real texture; the HAS_PREPASS define decides whether it is
    // read. Binding null hands three its empty texture, which samples opaque
    // black rather than reading as "absent".
    this.mHalf.uniforms.tND.value = this.rtND.textures[0];
    this.blit.draw(this.renderer, this.mHalf, this.rtHalf);
  }

  private renderAO(ctx: Ctx): void {
    const u = this.mAO.uniforms;
    u.uFrame.value = ctx.time.frame % 4096;
    u.uProjScale.value = (0.5 * this.hh) / (1 / ctx.camera.projectionMatrix.elements[5]);
    u.uRadius.value = this.aoRadius;
    u.uPower.value = this.aoPower;
    u.uCsLength.value = this.contactLength;
    u.uCsThickness.value = this.contactThickness;
    u.uCsMinPix.value = this.contactMinPixels;
    this.blit.draw(this.renderer, this.mAO, this.rtAO);
  }

  private blurAO(): void {
    const u = this.mAOBlur.uniforms;
    u.tAO.value = this.rtAO.texture;
    u.uDir.value.set(1 / this.hw, 0);
    this.blit.draw(this.renderer, this.mAOBlur, this.rtAOTmp);
    u.tAO.value = this.rtAOTmp.texture;
    u.uDir.value.set(0, 1 / this.hh);
    this.blit.draw(this.renderer, this.mAOBlur, this.rtAO);
  }

  private renderVolumetrics(ctx: Ctx): void {
    const u = this.mVol.uniforms;
    u.uFrame.value = ctx.time.frame % 4096;
    u.uInvView.value.copy(ctx.camera.matrixWorld);
    u.uSunColor.value.set(this.sunColor.r, this.sunColor.g, this.sunColor.b);
    u.uAmbient.value.set(this.ambient.r * 0.05, this.ambient.g * 0.05, this.ambient.b * 0.055);
    // The sky system already owns bulk aerial perspective; this buffer exists
    // for shafts, so the extinction coefficient stays in the "visible haze"
    // band rather than the "milk" band no matter what weather reports.
    const dens = THREE.MathUtils.clamp(this.fogDensity * 1.2, 5e-4, 9e-3) * this.volumetricDensity;
    u.uDensity.value = dens;
    // Multiple scattering, ramped in with the medium's own thickness — a thin
    // haze scatters once, a dust front many times. Albedo-weighted sun plus sky
    // fill, isotropic. See VOL_FRAG.
    const thick = THREE.MathUtils.clamp((dens - this.aerialBaseDensity) / 4e-3, 0, 1);
    const ms = this.multiScatterAlbedo * thick;
    u.uMulti.value.set(
      (this.sunColor.r * 0.8 + this.ambient.r) * ms,
      (this.sunColor.g * 0.8 + this.ambient.g) * ms,
      (this.sunColor.b * 0.8 + this.ambient.b) * ms,
    );
    u.uMaxDist.value = Math.min(this.far * 0.25, 1200);
    u.uBulkRemove.value = THREE.MathUtils.clamp(
      this.volumetricBulkRemove * (this.aerialBaseDensity / Math.max(dens, 1e-6)),
      0,
      1,
    );
    this.blit.draw(this.renderer, this.mVol, this.rtVol);

    const b = this.mVolBlur.uniforms;
    b.tVol.value = this.rtVol.texture;
    b.uDir.value.set(1.4 / this.qw, 0);
    this.blit.draw(this.renderer, this.mVolBlur, this.rtVolTmp);
    b.tVol.value = this.rtVolTmp.texture;
    b.uDir.value.set(0, 1.4 / this.qh);
    this.blit.draw(this.renderer, this.mVolBlur, this.rtVol);
  }

  private composite(useAO: boolean, useCS: boolean, useVol: boolean): THREE.WebGLRenderTarget {
    const u = this.mComposite.uniforms;
    u.tScene.value = this.rtHDR.texture;
    u.tAO.value = this.rtAO.texture;
    u.tVol.value = this.rtVol.texture;
    u.uAoStrength.value = useAO ? this.aoStrength : 0;
    u.uAoFloor.value = this.aoFloor;
    u.uCsFloor.value = this.contactFloor;
    u.uBilateralLegacy.value = RENDER_DEBUG.bilateralLegacy ? 1 : 0;
    u.uCsStrength.value = useCS ? 0.85 : 0;
    // ONE weight for the medium. Both uniforms exist because the shader reads
    // extinction and in-scattering separately; they must never be given
    // different values, or the pass stops modelling a medium and starts
    // modelling a lift.
    u.uVolStrength.value = useVol ? this.volumetricStrength : 0;
    u.uVolFog.value = useVol ? this.volumetricStrength : 0;
    this.blit.draw(this.renderer, this.mComposite, this.rtA);
    return this.rtA;
  }

  private resolveTAA(src: THREE.WebGLRenderTarget): THREE.WebGLRenderTarget {
    const cur = this.hist[this.histIdx];
    const prev = this.hist[1 - this.histIdx];
    const u = this.mTAA.uniforms;
    u.tCurrent.value = src.texture;
    u.tHistory.value = prev.texture;
    u.tVel.value = this.rtND.textures[1];
    u.uReset.value = this.resetHistory > 0 ? 1 : 0;
    u.uFeedback.value = 0.93;
    u.uFireflyClamp.value = this.fireflyClamp;
    this.blit.draw(this.renderer, this.mTAA, cur);
    this.histIdx = 1 - this.histIdx;
    return cur;
  }

  /**
   * Has the view changed enough for motion blur to produce anything? The shader
   * early-outs per pixel below 0.6 px of motion, but it still costs a full-res
   * pass with a depth fetch per sample to discover that. Comparing the current
   * and previous view-projection is one matrix walk and skips the whole thing on
   * a stationary camera — which is every frame the capture harness photographs.
   */
  private cameraMoved(): boolean {
    const a = this.currVP.elements;
    const b = this.prevVP.elements;
    let d = 0;
    for (let i = 0; i < 16; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    if (d <= 1e-6) return false;

    // "Different" is not "enough to blur". The per-pixel shader early-outs below
    // 0.6 px of motion, but only after a full-res pass with a depth fetch per
    // sample has run to discover it — so the frames that produce nothing are the
    // frames that pay full price for discovering it, and at a walking pace with
    // the mouse still that is most of them. Estimate the largest displacement
    // the frame can hold and skip the pass outright when it is sub-pixel.
    const pxPerRad = this.h / (2 * Math.max(this.tanHalfY, 1e-4));
    const cosT = THREE.MathUtils.clamp(this.camFwd.dot(this.prevFwd), -1, 1);
    const rotPix = Math.acos(cosT) * pxPerRad;
    // Translation parallax, bounded by the nearest depth the frame can hold.
    // Two metres is the ground under the player's own feet.
    const transPix = (this.camStep / 2.0) * pxPerRad;
    return rotPix + transPix > 0.75;
  }

  private readonly camFwd = new THREE.Vector3(0, 0, -1);
  private readonly prevFwd = new THREE.Vector3(0, 0, -1);
  /** Camera translation since the previous frame, in metres. */
  private camStep = 0;
  private tanHalfY = 1;

  private renderMotionBlur(src: THREE.WebGLRenderTarget, ctx: Ctx): THREE.WebGLRenderTarget {
    const dst = this.pick(src);
    const u = this.mMB.uniforms;
    u.tColor.value = src.texture;
    u.uFrame.value = ctx.time.frame % 4096;
    // Shutter is expressed as a fraction of the frame interval; scaling by the
    // real dt keeps blur length stable when the framerate wobbles.
    u.uShutter.value = 0.5 * THREE.MathUtils.clamp(ctx.time.dt * 60, 0.25, 2.0);
    this.blit.draw(this.renderer, this.mMB, dst);
    return dst;
  }

  /**
   * The whole three-pass DOF chain is skipped unless the lens can actually
   * resolve a defocus somewhere in the useful depth range. At the gameplay
   * default (f/22 focused a kilometre out) the near limit sits under a metre,
   * so the answer is no and the frame goes to the tonemapper untouched.
   */
  private dofNeeded(): boolean {
    // A closed aperture means no depth of field, full stop. The old gate only
    // short-circuited when the focus distance was also past 10 km, so at the
    // gameplay/capture default it fell through to the optical test — which, at a
    // narrow FOV, lands a hair over the deadband and switches the whole
    // three-pass chain on for a circle of confusion of about a fiftieth of a
    // pixel. That put a half-resolution near-field gather over the entire frame
    // at low opacity, which is the "nothing anywhere is in focus" finding on
    // every vista shot: a landscape at f/22 must be bit-for-bit untouched.
    if (this.dofStrength <= 0.001) return false;
    const nearest = Math.abs(this.cocPixelsAt(Math.max(this.near, 1.0)));
    const farthest = Math.abs(this.cocPixelsAt(Math.max(this.far, 1e4)));
    // Two pixels, not one: at one pixel the gather is still indistinguishable
    // from a resolve artefact and costs three passes to produce it.
    return Math.max(nearest, farthest) > Math.max(this.cocDeadband, 2.0);
  }

  private renderDof(src: THREE.WebGLRenderTarget): THREE.WebGLRenderTarget {
    const fStop = this.fStop();
    for (const m of [this.mDofCoc, this.mDofComp]) {
      m.uniforms.uFStop.value = fStop;
      m.uniforms.uFocusDist.value = this.focusDistance;
      m.uniforms.uFocalLen.value = this.focalLen;
      m.uniforms.uCocMin.value = this.cocDeadband;
    }
    this.mDofCoc.uniforms.tColor.value = src.texture;
    this.blit.draw(this.renderer, this.mDofCoc, this.rtDofIn);

    this.mDofGather.uniforms.tIn.value = this.rtDofIn.texture;
    this.mDofGather.uniforms.uFrame.value = (this.jitterIdx % 4096);
    this.blit.draw(this.renderer, this.mDofGather, this.rtDofOut);

    const dst = this.pick(src);
    this.mDofComp.uniforms.tColor.value = src.texture;
    this.blit.draw(this.renderer, this.mDofComp, dst);
    return dst;
  }

  /**
   * Two-pass histogram-free auto-exposure: tile-reduce the resolved HDR frame to
   * a 32x18 grid of weighted log-luminance sums, then collapse that to a single
   * adapted exposure multiplier held in a 1x1 target.
   *
   * Nothing leaves the GPU. The obvious implementation reads the result back to
   * drive a uniform, which costs a full pipeline flush per frame; instead the
   * 1x1 target is bound straight into the bloom prefilter and the uber pass, and
   * ping-ponged against itself so adaptation is a shader-side lerp.
   */
  private renderExposure(src: THREE.WebGLRenderTarget, ctx: Ctx): void {
    const cur = this.rtExp[this.expIdx];
    const prev = this.rtExp[1 - this.expIdx];

    if (RENDER_DEBUG.autoExposure && this.autoExposure) {
      this.mMeter.uniforms.tSrc.value = src.texture;
      // The meter needs last frame's metered average to decide what counts as a
      // highlight in THIS frame; exposure is temporally smoothed, so a one-frame
      // lag in the reference is well below the adaptation time constant.
      this.mMeter.uniforms.tPrev.value = prev.texture;
      this.blit.draw(this.renderer, this.mMeter, this.rtMeter);

      const u = this.mExposure.uniforms;
      u.tMeter.value = this.rtMeter.textures[0];
      u.tMeterDark.value = this.rtMeter.textures[1];
      u.tPrev.value = prev.texture;
      u.uKey.value = this.exposureKey;
      u.uHiKey.value = this.highlightKey;
      u.uMaxLift.value = this.highlightMaxLift;
      u.uMinLift.value = this.highlightMinLift;
      u.uBlackRel.value = RENDER_DEBUG.blackPoint ? this.blackRel : 0;
      u.uDarkFloor.value = this.darkFloor;
      u.uGainMax.value = RENDER_DEBUG.blackPoint ? this.gainMax : 1;
      u.uRangeLo.value = this.keyRangeLo;
      u.uRangeHi.value = this.keyRangeHi;
      u.uHiCeil.value = this.highlightCeil;
      u.uGainMin.value = RENDER_DEBUG.blackPoint ? this.gainMin : 1;
      u.uTrim.value = this.exposure;
      u.uAdapt.value = this.exposureAdapt;
      u.uMinExp.value = this.exposureMin;
      u.uMaxExp.value = this.exposureMax;
      u.uRate.value = this.exposureRate;
      u.uDt.value = Math.min(Math.max(ctx.time.dt, 1e-4), 0.25);
      u.uReset.value = this.resetHistory > 0 || this.expPrimed === false ? 1 : 0;
      this.blit.draw(this.renderer, this.mExposure, cur);
      this.expPrimed = true;
    } else {
      // Manual mode still has to publish a value, or the passes downstream would
      // read whatever stale exposure was left in the target.
      const u = this.mExposure.uniforms;
      u.tMeter.value = this.rtMeter.textures[0];
      u.tMeterDark.value = this.rtMeter.textures[1];
      u.tPrev.value = prev.texture;
      u.uMinExp.value = 1;
      u.uMaxExp.value = 1;
      u.uReset.value = 1;
      u.uBlackRel.value = RENDER_DEBUG.blackPoint ? this.blackRel : 0;
      u.uDarkFloor.value = this.darkFloor;
      u.uGainMax.value = RENDER_DEBUG.blackPoint ? this.gainMax : 1;
      u.uRangeLo.value = this.keyRangeLo;
      u.uRangeHi.value = this.keyRangeHi;
      u.uHiCeil.value = this.highlightCeil;
      u.uGainMin.value = RENDER_DEBUG.blackPoint ? this.gainMin : 1;
      u.uTrim.value = this.exposure;
      this.blit.draw(this.renderer, this.mExposure, cur);
      this.expPrimed = true;
    }

    this.mUber.uniforms.tExposure.value = cur.texture;
    this.mBloomPre.uniforms.tExposure.value = cur.texture;
    this.expIdx = 1 - this.expIdx;
  }

  /**
   * Debug/QA hook: pull the metered exposure back to the CPU. Stalls the
   * pipeline, so this is for the capture harness and the console, never the
   * frame loop. Returns the adapted multiplier, the metered scene luminance,
   * and the value curve's two published anchors.
   */
  readExposure(): { exposure: number; avgLuminance: number; gain: number; black: number } {
    const rt = this.rtExp[1 - this.expIdx];
    const buf = new Float32Array(4);
    try {
      if (rt) this.renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, buf);
    } catch {
      // Some drivers refuse a FLOAT readback; the frame is unaffected either way.
    }
    return { exposure: buf[0], avgLuminance: buf[1], gain: buf[2], black: buf[3] };
  }

  /**
   * Debug/QA hook: pull the meter's tile grid back to the CPU.
   *
   * The point of this is that a metering scheme is an argument about a
   * *distribution*, and every previous argument about this one was made from the
   * final 8-bit image — which is the distribution after the meter, the
   * tonemapper and the value curve have all had their say, i.e. the one piece of
   * evidence that cannot distinguish between them. This returns the frame's own
   * spatial log-luminance map, 32x18 tiles, in SCENE radiance, so a candidate
   * weighting can be evaluated offline over the canonical set before any of it
   * is written into a shader.
   *
   * Stalls the pipeline twice. Capture harness only.
   */
  readMeterGrid(): { w: number; h: number; logL: Float32Array } {
    // Half float, so the readback buffer is typed to match the texture and the
    // values are decoded here. A Float32Array against a HALF_FLOAT attachment
    // comes back as zeros with no error, which is how this returned a grid of
    // "-12 everywhere" the first time it was run.
    const buf = new Uint16Array(METER_W * METER_H * 4);
    try {
      this.renderer.readRenderTargetPixels(this.rtMeter, 0, 0, METER_W, METER_H, buf, undefined, 1);
    } catch {
      // Some drivers refuse the readback; the frame is unaffected either way.
    }
    const logL = new Float32Array(METER_W * METER_H);
    for (let i = 0; i < logL.length; i++) {
      const n = THREE.DataUtils.fromHalfFloat(buf[i * 4 + 3]);
      logL[i] = n > 0 ? THREE.DataUtils.fromHalfFloat(buf[i * 4 + 2]) / n : -12;
    }
    return { w: METER_W, h: METER_H, logL };
  }

  private expPrimed = false;

  private renderBloom(src: THREE.WebGLRenderTarget): void {
    const n = this.bloomDown.length;
    if (n === 0) return;

    this.mBloomPre.uniforms.tSrc.value = src.texture;
    this.mBloomPre.uniforms.uThreshold.value = this.bloomThreshold;
    this.mBloomPre.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
    this.blit.draw(this.renderer, this.mBloomPre, this.bloomDown[0]);

    for (let i = 1; i < n; i++) {
      const s = this.bloomDown[i - 1];
      this.mBloomDown.uniforms.tSrc.value = s.texture;
      this.mBloomDown.uniforms.uTexel.value.set(1 / s.width, 1 / s.height);
      this.blit.draw(this.renderer, this.mBloomDown, this.bloomDown[i]);
    }

    for (let i = n - 2; i >= 0; i--) {
      const small = i === n - 2 ? this.bloomDown[n - 1] : this.bloomUp[i + 1];
      this.mBloomUp.uniforms.tSmall.value = small.texture;
      this.mBloomUp.uniforms.tBig.value = this.bloomDown[i].texture;
      this.mBloomUp.uniforms.uTexel.value.set(1 / small.width, 1 / small.height);
      this.blit.draw(this.renderer, this.mBloomUp, this.bloomUp[i]);
    }
  }

  private renderUber(src: THREE.WebGLRenderTarget, ctx: Ctx): THREE.WebGLRenderTarget {
    const dst = this.pick(src);
    const u = this.mUber.uniforms;
    u.tColor.value = src.texture;
    const bloomTex = this.bloomUp.length > 0 ? this.bloomUp[0] : this.bloomDown[0];
    u.tBloom.value = bloomTex ? bloomTex.texture : null;
    u.uBloomIntensity.value = RENDER_DEBUG.bloom ? this.bloomIntensity : 0;
    u.uExposure.value = this.exposure;
    u.uShoulder.value = this.shoulder;
    u.uToeKnee.value = this.toeKnee;
    u.uHueRestore.value = this.hueRestore;
    u.uCaPixels.value = RENDER_DEBUG.chromatic ? this.caPixels : 0;
    this.blit.draw(this.renderer, this.mUber, dst);
    return dst;
  }

  private renderOutput(src: THREE.WebGLRenderTarget, ctx: Ctx): void {
    const u = this.mCAS.uniforms;
    u.tColor.value = src.texture;
    u.uFrame.value = ctx.time.frame % 4096;
    // Zero, not a define: the dither floor inside the same expression has to
    // survive the grain being switched off, or turning grain off reintroduces
    // 8-bit contouring in every sky.
    u.uGrain.value = RENDER_DEBUG.grain ? this.filmGrain : 0;
    u.tAO.value = this.rtAO.texture;
    u.tVol.value = this.rtVol.texture;
    const bloomTex = this.bloomUp.length > 0 ? this.bloomUp[0] : this.bloomDown[0];
    u.tBloomDbg.value = bloomTex ? bloomTex.texture : this.noise;

    let mode = 0;
    if (RENDER_DEBUG.showAO) mode = 1;
    else if (RENDER_DEBUG.showContact) mode = 2;
    else if (RENDER_DEBUG.showNormals) mode = 3;
    else if (RENDER_DEBUG.showVelocity) mode = 4;
    else if (RENDER_DEBUG.showVolumetrics) mode = 5;
    else if (RENDER_DEBUG.showBloom) mode = 6;
    else if (RENDER_DEBUG.showDepth) mode = 7;
    else if (RENDER_DEBUG.showLinearDepth) mode = 8;
    else if (RENDER_DEBUG.showPrepassDepth) mode = 9;
    u.uDebugMode.value = mode;
    u.tDebug.value = mode === 4 ? this.rtND.textures[1] : this.rtND.textures[0];

    this.blit.draw(this.renderer, this.mCAS, null);
  }

  private pick(src: THREE.WebGLRenderTarget): THREE.WebGLRenderTarget {
    return src === this.rtA ? this.rtB : this.rtA;
  }
}
