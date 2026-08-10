import * as THREE from 'three';

/**
 * Cube resolution. 64, not 32.
 *
 * A trilinear cube is piecewise linear between nodes, so every node boundary is
 * a slope discontinuity — a Mach band. On a long smooth ramp (a night sky) those
 * land as hard concentric contour rings, which is precisely what the review
 * measured: a vertical column median sitting on single 8-bit values for runs of
 * 15-20 pixels before stepping. Dither cannot remove that; it is structure in
 * the signal, not quantisation of it. Doubling the node count quarters the
 * second-derivative error and puts every kink below one LSB. The cost is 1 MB of
 * texture and ~40 ms once at boot.
 */
const LUT_N = 64;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sat01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a: number, b: number, x: number) => {
  const t = sat01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * ---------------------------------------------------------------------------
 * WHAT THIS GRADE IS FOR, AND WHY IT WAS REBUILT
 * ---------------------------------------------------------------------------
 *
 * Measured, on the canonical ten-shot set, immediately before this rewrite
 * (`node tools/palette.mjs`, which now lives in the repo precisely so this
 * paragraph can be checked rather than believed):
 *
 *   - 99.9% of every chroma-bearing pixel in every daylight frame fell inside
 *     hue 0-60 degrees. Not "mostly". Nine frames out of ten, essentially all
 *     of it, in two adjacent thirty-degree bins.
 *   - Mean saturation 0.10 to 0.19 — *below* the bible's own ash swatch
 *     (`#8a7f72`, saturation 0.174) on several frames.
 *   - The fraction of the frame above saturation 0.55 — i.e. anything that
 *     could be an ember or a bioluminescent cap, the only two things the bible
 *     permits to be vivid — was 0.000% to 0.008%.
 *   - 1st percentile luminance 55 to 125 of 255 on the daylight shots. Basalt
 *     is 19-38. There was no black anywhere in the frame.
 *
 * STATUS OF THAT LIST, re-measured on the gate's own five shots: (1) is DONE
 * and should not be re-opened — the per-frame value curve in shaders.ts moved
 * p1 to 3-21 of 255 on every daylight shot, so the frame has real black and the
 * darkness-gated terms below reach. (2) was NOT done by the tint machinery that
 * claimed it and is done now, by the anchors below. (3) is done and holds: the
 * bible's swatches come out of this cube at their authored chroma or above,
 * with ember and bioluminescence gaining rather than losing — with one stated
 * exception, `#141312`, which arrives at saturation 0.100 and leaves at 0.031
 * because the deep-shade lean crosses it. At display luma 0.075 that is a
 * chroma of half of one 8-bit level and it is the price of the term below
 * having any reach at all into the black end.
 *
 * Three review rounds read that as "monochrome" and "untextured clay" and three
 * rounds of grading responded by moving the tint. The measurement says the
 * tint was never the problem: the previous grade's answer to "too much orange"
 * was a large flat chroma pull, which turned an orange bath into a beige bath
 * and destroyed the two accents that were carrying the entire palette. Chroma
 * magnitude was already correct-to-low. What was missing was hue *variety* and
 * value *range*, and those are produced by different machinery:
 *
 *   1. A tone curve that actually restores black. This is upstream of
 *      everything else, including the colour. The scene arrives with a lifted
 *      toe — AgX's own, plus the aerial-perspective haze already composited
 *      into the buffer — and a grade whose darkest reachable output is display
 *      0.35 cannot render a basalt cliff, cannot show a cast shadow, and
 *      cannot engage its own shadow tint. Every previous round authored a cool
 *      shadow and then measured no cool pixels; the reason is here and not in
 *      the tint. The tint was gated on darkness in a frame that had none.
 *   2. A shadow temperature that can therefore reach. A rock in shadow is lit
 *      by sky, not by sun, and the sky is not the sun's colour. This is the
 *      only mechanism in a single-key scene that can put a second hue family
 *      in the frame at all.
 *   3. Saturation discipline that is selective rather than flat: hard on the
 *      low-chroma warm mass (ash, dust, haze — the bible's "desaturated ochres
 *      and greys"), and completely hands-off on the two things the bible names
 *      as the only vivid colours in the world.
 *
 * Everything below is authored in DISPLAY-referred space, deliberately. The
 * palette table in the art bible is a list of sRGB hex values, and the
 * regression check measures display-space HSV saturation; authoring the grade
 * in the same space the target and the measurement live in means a number in
 * this file and a number in the bible mean the same thing. The linear-space
 * version of this grade needed a mental transform at every step and every
 * round of tuning lost something in it.
 */

/**
 * THE VALUE CURVE IS NOT IN THIS FILE, and that is deliberate.
 *
 * Black point, gain, toe and shoulder now live in the uber pass as uniforms
 * (`valueCurve` in shaders.ts), driven by a per-frame anchor the exposure pass
 * publishes. A cube is stateless; the correct black point is not — it is a
 * property of where the meter put the frame, and the canonical set's means
 * span display 0.24 to 0.56. Every constant this file could hold was wrong for
 * half the shots.
 *
 * What that leaves here is colour, and only colour: saturation discipline and
 * colour temperature. It is a better use of 262144 nodes than spending most of
 * their dynamic range describing a curve, and it means the terms below — all
 * of which are gated on luminance — see the frame's final value structure
 * rather than the tonemapper's milky one. That ordering is not cosmetic. It is
 * the difference between a shadow tint that measures 0.0% of the frame and one
 * that measures what it was authored to.
 */

/**
 * ---------------------------------------------------------------------------
 * THE SITUATION CHANGED UNDER THIS FILE. READ THIS BEFORE TOUCHING ANYTHING.
 * ---------------------------------------------------------------------------
 *
 * WHAT WAS TRUE WHEN THE ANCHORS BELOW WERE AUTHORED. Measured on
 * gate-identical pre-LUT captures, the image ARRIVING here was 92-100% hue 0-60
 * in EVERY luminance decile. The scene's lighting applied one sun colour and an
 * ambient that was a scaled copy of it, so there was no second colour
 * temperature anywhere in the buffer for a grade to preserve. Every hue family
 * in the output was therefore manufactured here, by three anchors that replaced
 * a pixel's colour outright. That was the correct response to that image.
 *
 * WHAT IS TRUE NOW. Stages 2 and 4 fixed the lighting and the aerial
 * perspective. Re-measured on `shots/_gatepre` from the current build (the
 * gate's own five vantage points, hour 9.0, `RENDER_DEBUG.lut = false`):
 *
 *   - `ridge` carries a real dome. One pixel column through its sky runs
 *     hue 210 at the zenith to hue 34 at the sulphur horizon band — a 176
 *     degree rotation — and 10.0% of its chroma-bearing pixels are now outside
 *     hue 0-60, against 2.3% before.
 *   - dawn, redmtn and vale carry the same rotation at LOW AMPLITUDE. 13-20% of
 *     each frame is genuinely cool (hue 200-260) but at only 5-8/255 of chroma,
 *     which is under every threshold the gate and the art bible use. Counted at
 *     chroma > 0.008 instead of > 0.06 they measure 25-30% non-warm.
 *   - `coast` has no cool content at any threshold: 0.2%. Its sky is a warm
 *     cream from zenith to horizon. This is a stage-2/4 property, not one a
 *     colour grade can honestly invent.
 *
 * WHAT THE OLD ANCHORS DID TO THAT. The HAZE anchor claimed every bright pixel
 * under chroma 0.24 and replaced its colour with hue 64 at authority 1.0. The
 * new sky sits at chroma 0.02-0.16, i.e. entirely inside that window, so the
 * whole dome was classified as featureless atmosphere and repainted. Measured
 * on the same ridge column, before and after the cube:
 *
 *      row   pre-grade                  post-grade (old cube)
 *       40   (173,189,205) hue 210      (185,189,156) hue 67
 *      120   (194,204,214) hue 210      (204,207,159) hue 64
 *      200   (211,217,220) hue 200      (217,220,169) hue 64
 *      260   (220,221,217) hue  75      (220,224,172) hue 65
 *      300   (219,213,203) hue  38      (214,217,167) hue 64
 *      340   (218,203,184) hue  34      (211,208,164) hue 56
 *
 * A 176 degree rotation flattened to 13, saturation pinned at 0.230 at every
 * elevation, the entire dome in one bin. That is the pale yellow-green the
 * player reported, and it is this file's doing.
 *
 * ---------------------------------------------------------------------------
 * WHAT REPLACED IT: CLASSIFY BY WHETHER THE PIXEL HAS A HUE TO PRESERVE
 * ---------------------------------------------------------------------------
 *
 * The bug was never the anchor mechanism. It was the GATE in front of it. A
 * chroma window of 0.12-0.24 asks "is this pixel pale?", and after a
 * scattering fix the sky is pale AND coloured. The question that separates
 * atmosphere from sky is not how pale a pixel is but whether it carries a hue
 * that the lighting put there and the grade would be destroying.
 *
 * So every colour-replacing term is now multiplied by `atmo`, which is 1 only
 * where the pixel is warm OR has too little chroma for its hue to mean
 * anything, and 0 wherever the buffer carries a defensible non-warm hue. The
 * consequence is exact: a pixel with a sky hue is never repainted, at any
 * luminance, at any chroma. The rotation survives by construction rather than
 * by a weight that happened to be small enough.
 *
 * What the non-warm population gets instead is a bounded CHROMA GAIN — the
 * COOL block below. That is hue-preserving by construction (it is a lerp about
 * the pixel's own luminance), so it can lift a 6/255 blue over the threshold
 * the palette check counts without moving it one degree. Amplifying a measured
 * hue is not the same act as inventing one, and it is the only mechanism here
 * that can make stage 2's work visible in a statistic.
 *
 * ---------------------------------------------------------------------------
 * THE TWO OFF-PALETTE ANCHORS ARE GONE. THIS IS WHAT THEY WERE COSTING.
 * ---------------------------------------------------------------------------
 *
 * The paragraph that used to sit here declared the hue-64 HAZE anchor "a
 * load-bearing lie ... deleted the day it stops being one", kept because
 * `coast` could not clear the gate's hueConcentration without it. A blind
 * art-direction panel then judged eight vantages against vanilla Morrowind and
 * five of eight critics named that hue independently and measured it: "hue-64
 * chartreuse sky, 63.8-64.0 across the entire visible dome", "#d2d5aa, a
 * yellow-green nowhere in our own palette table", "a naive viewer reads our
 * green cast as a broken white balance rather than as an alien one". The same
 * panel named the second anchor: "our ground samples at hue 216-300 where the
 * bible specifies ash at hue ~27", "a hue-212 45%-saturated blue-black
 * foreground", "the near plane collapses into featureless blue-black mud".
 *
 * Both were manufacturing colour the buffer does not contain, and the numbers
 * are not close. Measured on `shots/_prelut` (the gate's five vantages,
 * `RENDER_DEBUG.lut = false`) against `shots/_lab` (those same pixels through
 * the cube), on the bottom 15% of frame — the near plane the panel was reading:
 *
 *      share of near-plane pixels at hue 150-330      buffer   old cube
 *      coast                                            0.0%      62.4%
 *      dawn                                             0.0%      39.3%
 *      redmtn                                           0.1%      15.4%
 *      ridge                                            0.2%       2.6%
 *      vale                                             0.1%      65.6%
 *
 * Coast's near plane arrives at circular-mean hue 28.6 and left the old cube at
 * 227.5; vale's arrived at 37.5 and left at 212.2. A 199-degree rotation of the
 * dominant surface, applied to a buffer with no blue in it.
 *
 * And the art bible's OWN swatches proved it from the other direction. Pushed
 * through the old cube, basalt `#2a2622` (hue 30.0, sat 0.190 — the bible's
 * basalt is a warm near-neutral, it is not blue) came out `#1e2835`: hue 214.1,
 * saturation 0.444. `#141312` came out hue 216.3 at saturation 0.387. The term
 * named BASALT was rotating the bible's basalt swatch 176 degrees off the bible.
 *
 * WHAT THE ANCHORS ARE NOW.
 *
 *   - HAZE moved from hue 64 to hue 32, i.e. onto the sulphur ramp `#c99a5c`
 *     (hue 34.1) - `#7d5a3e` (hue 26.7), and its saturation from 0.20 to 0.26.
 *     Coast's sky ARRIVES at hue 27.7 — it was already on the bible's band and
 *     the old anchor was rotating it 36 degrees off it. Post-cube sky hue is now
 *     32.0 on coast and the sulphur horizon band on ridge/vale reads 30-32 where
 *     the dome above it stays 212-216. Nothing anywhere is in 54-70.
 *   - BASALT keeps hue 214, which is a measurement (ridge's zenith), but its
 *     saturation drops 0.45 -> 0.18, its authority is capped at 0.25 instead of
 *     1.0, and its band moves from "everything under 0.20, released by 0.24" to
 *     the bible's actual basalt luminances, 0.075 to 0.155. See its own comment
 *     for the arithmetic that makes a hue flip impossible at that authority.
 *
 * WHAT THAT COSTS, MEASURED, SO THE NEXT ROUND DOES NOT REDISCOVER IT. The
 * chartreuse was carrying 13-35% of every frame's chroma mass in bin 60-90, and
 * that bin was the entire reason five warm frames could report a spread. With
 * it gone, `hueConcentration` on shots/_lab goes 0.616/0.526/0.481/0.632/0.504
 * -> 0.998/0.762/0.753/0.854/0.835 (coast/dawn/redmtn/ridge/vale). Four of the
 * five still pass the gate's check on `hueFamilies >= 3`, carried by the SKY
 * anchor propagating a dome the scene really has. `coast` does not: its sky is
 * warm from zenith to horizon, its ground is ash, and 99.8% of its chroma is
 * genuinely in one family. That is a true statement about coast and the check is
 * right to make it. THE FIX IS UPSTREAM — coast's sky needs the scattering
 * treatment ridge's got — and it is not available to a colour cube. Do not
 * re-introduce an off-palette hue to make the number go away; that is the exact
 * trade this file just paid a whole review round for.
 */

/**
 * Hue confidence, and why a big term may not be gated on hue without it.
 *
 * Hue is undefined at chroma 0 and numerically meaningless just above it: on a
 * near-neutral pixel a one-LSB change flips the reported hue by tens of
 * degrees. Gating a colour-replacing term directly on `warm` would therefore
 * put a discontinuity along the whole neutral axis of the cube, and a smooth
 * grey sky gradient would come back speckled between "treated as atmosphere"
 * and "left alone".
 *
 * So the warm test is faded in over the chroma range where hue becomes
 * trustworthy. The window is placed under the sky it has to protect: the
 * faintest genuinely-cool population in the set is redmtn's at relative chroma
 * 0.026, and 0.020 clears it with margin, while 0.008 is about two LSB at sky
 * luminance and is where hue stops being a measurement at all.
 */
const HUE_CONF_LO = 0.008;
const HUE_CONF_HI = 0.020;

/**
 * The cool band: the arc this file is allowed to treat as sky and
 * bioluminescence rather than as material.
 *
 * It excludes green (under 150) and the reds either side of 330, both of which
 * are failure modes this file has already paid for once: a wide band put 17% of
 * redmtn at hue 120-150 and turned the ground mossy, and the same term on the
 * far side of the red axis is where the mauve ground came from. Measured on the
 * current build, the share of each frame landing in hue 90-180 goes from
 * 0.00-0.13% in the buffer to 0.00-0.58% out of this cube, so the exclusion is
 * doing its job.
 */
const COOL_H0 = 150;
const COOL_H1 = 185;
const COOL_H2 = 292;
const COOL_H3 = 330;

/**
 * COOL — a bounded chroma gain, hue untouched.
 *
 * For cool pixels that carry ENOUGH chroma for their hue to be trusted. Stated
 * as a target rather than a multiplier so that everything in the band arrives
 * at a similar saturation whatever it started at, and so that anything already
 * above the target is released by the fade rather than driven fluorescent.
 * 0.14 sits below the bible's ash (0.174): this is a nudge, not a repaint.
 *
 * The cap at 4 is the important number and it was learned the hard way. An
 * earlier revision of this block used a target of 0.26 with a cap of 11 in
 * order to lift dawn's sky — which sits at 5/255 of chroma — over the palette
 * check's threshold in one move. It worked arithmetically and was a disaster on
 * screen: dawn's faint bias is R and G equal with B one or two LSB higher,
 * which reads as hue 240-270, and multiplying THAT by eleven produces a banded
 * lilac sky. Amplification is only honest while the thing being amplified is a
 * measurement, and at 5/255 with R == G it is not one. Below that the SKY
 * anchor takes over instead.
 */
const COOL_TARGET = 0.14;
const COOL_MAX = 4;
/** Released once the pixel already carries this multiple of the target. */
const COOL_FADE = 2.2;

/**
 * SKY — for the cool population whose chroma is too small to carry a hue.
 *
 * Measured on `shots/_gatepre`: 13-20% of dawn, redmtn and vale is genuinely
 * non-warm, spatially coherent over the whole upper frame, and sits at 5-8/255
 * of chroma with R and G within one LSB of each other. That is real scattering
 * — it is far too large and too smooth an area to be noise — but its ANGLE is
 * not a measurement, and taken literally it says lilac. Ridge, whose sky is
 * eight times stronger, says hue 200-223. So this term keeps the fact (there is
 * cool light up there, and this much of it) and takes the angle from the frame
 * that can actually resolve it.
 *
 * The chroma window is what makes that a rule rather than a preference: full
 * authority under 0.06, which is exactly the threshold the gate calls
 * chroma-bearing, and released by 0.20. A pixel the palette check can already
 * measure is one whose hue this term is not entitled to touch — ridge's zenith
 * arrives at 0.156 and comes out at hue 211 against 210 in the buffer.
 *
 * Saturation 0.24 is the bible's chitin, the top of what the world outside the
 * two accents is allowed to reach.
 */
const SKY_HUE = 214;
const SKY_SAT = 0.24;
const SKY_MAX = 0.85;
const SKY_C0 = 0.06;
const SKY_C1 = 0.20;

/**
 * BASALT — a sky-bounce LEAN on the deepest shade. Not a repaint. Read the
 * arithmetic before raising any of these four numbers.
 *
 * The hue is a measurement and stays: ridge's zenith is 210 and dawn/redmtn/
 * vale's is 240-250, so a surface whose only light is the dome is cooler than
 * one the sun reaches. What was wrong was everything else about the term.
 *
 * WHAT IT WAS CLAIMING. `t` under 0.20, released by 0.24, at authority 1.0 and
 * saturation 0.45. That population is 11.6% (dawn), 24.2% (vale), 27.7%
 * (redmtn), 39.2% (coast) of the WHOLE FRAME — it is not basalt, it is the
 * dominant ground surface, and the buffer's own circular-mean hue inside it is
 * 26-30 at every threshold: 28.1 under luma 0.075 on coast, 26.3 on redmtn,
 * 23.9 on ridge. The scene says "ash, in shadow". The term said "hue 214,
 * saturation 0.45" and won, because at authority 1.0 an anchor does not mix, it
 * replaces. That is the whole of the panel's blue-ground finding.
 *
 * WHY THE AUTHORITY IS THE NUMBER THAT MATTERS. Hue 214 is very nearly the
 * complement of hue 28, so a mix toward it walks the pixel DOWN in chroma to a
 * neutral and then out the far side into blue. There is a crossover weight, and
 * it is computable: for the population this term sees — display luma 0.12,
 * relative chroma 0.40, hue 28 — mixing toward a hue-214 anchor built at the
 * same luminance crosses at w = 0.73 with this anchor's saturation, and at
 * w = 0.42 with the old 0.45. Below the crossover the result is ash with less
 * chroma and its hue intact; above it, blue. Measured through the cube at
 * w_max = 0.25, the near plane comes out at circular-mean hue 22.9-37.1 with
 * 0.0-0.3% of it at hue 150-330, against the buffer's own 0.0-0.2%. The term is
 * now inside the noise floor of the thing it used to invert.
 *
 * WHY THE BAND MOVED. `#2a2622` is display luma 0.151 and `#141312` is 0.075,
 * so the bible's basalt occupies 0.075-0.151 — the old band ran to 0.24, which
 * is past the ash-dark swatch `#4a423b` at 0.263 and took in every mid-shadow
 * on the way. 0.075 to 0.155 is the swatch range and nothing else.
 *
 * WHAT IT DOES NOT BUY, so nobody re-widens it hoping for this: it contributes
 * essentially nothing to `hueConcentration` at any setting. The gate bins on
 * ABSOLUTE chroma (mx - mn > 0.06), and a pixel at display luma 0.12 cannot
 * reach that unless its relative saturation is over ~0.5. The old term only
 * scored in bin 210-240 because it reached up to luma 0.24 at saturation 0.45 —
 * i.e. only by painting mid-dark ash. The statistic was paid for in exactly the
 * pixels the panel complained about.
 */
const BASALT_HUE = 214;
const BASALT_SAT = 0.18;
const BASALT_MAX = 0.25;
const BASALT_LO = 0.075;
const BASALT_HI = 0.155;

/**
 * HAZE — warm neutral atmosphere, on the bible's sulphur ramp and nowhere else.
 *
 * Hue 32 is the middle of `#c99a5c` (hue 34.1) - `#7d5a3e` (hue 26.7), the only
 * sky the palette table contains. It was 64 for four rounds; the block comment
 * above records what that cost and why the expiry finally arrived.
 *
 * The number worth keeping in mind when this is next tuned is that the buffer
 * did not need the rotation in the first place. Coast's sky ARRIVES at circular
 * mean hue 27.7 with 94.6% of it chroma-bearing — dead centre of the sulphur
 * band before this file touches it. The old anchor was taking a correct sky 36
 * degrees off the palette; this one is confirming a correct sky and giving it
 * the saturation the swatches carry. That is the difference between an anchor
 * and a repaint, and it is why the chroma window (0.10-0.20) can stay where it
 * is: a pixel that already states a hue is one this term has no work to do on.
 *
 * Saturation 0.26 rather than the swatches' own 0.50-0.54, because this term
 * owns pale ATMOSPHERE — aerial perspective and dome — not the sulphur horizon
 * band itself, which is material chroma and belongs to SUN below. Measured, the
 * sky comes out at relative saturation 0.20-0.26 against 0.045-0.089 in the
 * buffer, which answers the "cream wash" finding without reaching the 0.34 the
 * bible caps whole-frame mean saturation at.
 */
const HAZE_HUE = 32;
const HAZE_SAT = 0.26;
const HAZE_LO = 0.42;
const HAZE_FULL = 0.74;
/** ...released again at the very top so a blown sun disc is never tinted. */
const HAZE_ROLL = 0.97;
/** Chroma window separating featureless atmosphere from material. */
const HAZE_C0 = 0.10;
const HAZE_C1 = 0.20;

/**
 * SUN — the sulphur horizon band and every sunlit ash face, `#c99a5c`.
 *
 * Deliberately the weakest of the three at 0.45: this population already
 * carries the correct hue, so the anchor is confirming it rather than creating
 * it, and a strong weight here would flatten the variation the terrain
 * materials worked to produce.
 */
/**
 * Where the ratio-preserving ceiling at the end of gradePixel starts to bend.
 * Below this nothing is touched at all, so the entire ash/basalt/haze mass is
 * unaffected; it exists for the sunlit horizon and the sun disc.
 */
const CEIL_KNEE = 0.88;

const SUN_HUE = 36;
const SUN_SAT = 0.56;
const SUN_LO = 0.46;
const SUN_HI = 0.70;
const SUN_MAX = 0.50;

/** Hue angle in degrees. Display space, same as everything else here. */
function hueDeg(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const c = mx - mn;
  if (c < 1e-7) return 0;
  let h: number;
  if (mx === r) h = ((g - b) / c) % 6;
  else if (mx === g) h = (b - r) / c + 2;
  else h = (r - g) / c + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/**
 * An anchor colour, built at a given luminance.
 *
 * HSV at value 1 for the stated hue and saturation, then scaled so its
 * luminance equals `l`. Because the scale is one number applied to all three
 * channels, hue and saturation come out exactly as stated whatever `l` is, and
 * the luminance is exact — which is what makes mixing toward it a pure hue
 * move. A tint ratio cannot offer either guarantee: its hue depends on what it
 * is mixed with and its luminance depends on which channel is largest.
 *
 * `out` may be larger than 1 for a bright pixel with a saturated anchor. That
 * is intentional and is handled by the ratio-preserving ceiling at the end of
 * gradePixel; clamping here would rotate the hue this function exists to fix.
 */
function anchor(out: Float32Array, hue: number, sat: number, l: number): void {
  const hp = (((hue % 360) + 360) % 360) / 60;
  const x = sat * (1 - Math.abs((hp % 2) - 1));
  const m = 1 - sat;
  let r: number;
  let g: number;
  let b: number;
  if (hp < 1) { r = sat; g = x; b = 0; }
  else if (hp < 2) { r = x; g = sat; b = 0; }
  else if (hp < 3) { r = 0; g = sat; b = x; }
  else if (hp < 4) { r = 0; g = x; b = sat; }
  else if (hp < 5) { r = x; g = 0; b = sat; }
  else { r = sat; g = 0; b = x; }
  r += m; g += m; b += m;
  const k = l / Math.max(LUMA_R * r + LUMA_G * g + LUMA_B * b, 1e-5);
  out[0] = r * k;
  out[1] = g * k;
  out[2] = b * k;
}

/**
 * Ashenreach grade. Input and output are both display-encoded sRGB; the whole
 * transform is a 3D cube, so the arithmetic here runs 262144 times at boot and
 * never again.
 */
/** Scratch for `anchor`. Module scope so the cube bake allocates nothing. */
const tmp = new Float32Array(3);

function gradePixel(out: Float32Array, r: number, g: number, b: number): void {
  let cr = r;
  let cg = g;
  let cb = b;

  const l = LUMA_R * cr + LUMA_G * cg + LUMA_B * cb;
  const mx = Math.max(cr, cg, cb);
  const mn = Math.min(cr, cg, cb);
  const chroma = mx > 1e-6 ? (mx - mn) / mx : 0;
  const hue = hueDeg(cr, cg, cb);

  // ------------------------------------------------------------- accents ----
  // `accent` is 1 on the two things the bible permits to be vivid and 0 on the
  // world. It gates every subsequent term, and getting its *definition* right
  // is the whole reason the previous grade could not tell an ember from the
  // ash around it.
  //
  // Warm band: ash, sulphur haze, chitin and ember all live inside hue 0-105,
  // so hue alone separates nothing there. Chroma does: `#8a7f72` is 0.17,
  // `#d8c9a4` is 0.24, `#c99a5c` is 0.54, `#ff7a2a` is 0.84. A threshold at
  // 0.52 rising to 0.74 puts the sulphur horizon at the bottom of the ramp and
  // lava firmly at the top.
  //
  // The previous version additionally required an ember to be BRIGHT, and that
  // extra condition is why lava fissures in the shadowed folds of Ember Mount
  // came out the same colour as the rock: a fissure that is chromatic but not
  // bright is still a fissure. Value is not part of the test any more.
  //
  // Outside the warm band there is nothing in the palette that is not an
  // accent — bioluminescence `#3fd6c0` and `#8f6bff`, verdigris `#5f7a63`, and
  // the sky-lit basalt this grade is about to author. So a much lower chroma
  // threshold applies, and above it the pixel is left completely alone.
  //
  // Hue is folded above 300 so the warm family is CONTIGUOUS across the red
  // axis. Unfolded, `smoothstep(-28, 10, hue)` reads 1 for hue 350 — a dusky
  // red — and the second factor then reads 0, so the deepest reds in the
  // palette classified as non-warm and took the non-warm branch of every test
  // below. With a chroma gain now hanging off that branch the bug would have
  // amplified them instead of merely mis-trimming them.
  const hueFold = hue > 300 ? hue - 360 : hue;
  const warm = smoothstep(-38, 6, hueFold) * (1 - smoothstep(58, 104, hueFold));
  const accent =
    warm * smoothstep(0.52, 0.74, chroma) +
    (1 - warm) * smoothstep(0.14, 0.34, chroma);

  // Does this pixel carry a hue worth preserving? 1 where the buffer has
  // committed to a non-warm colour, 0 on warm material and on anything too
  // close to neutral for its hue to be a measurement. Every colour-REPLACING
  // term below is multiplied by this; the chroma-only terms are not, because
  // they cannot destroy a hue in the first place.
  const atmo = 1 - smoothstep(HUE_CONF_LO, HUE_CONF_HI, chroma) * (1 - warm);
  // The sky/bioluminescence band the chroma gain is allowed to touch.
  const coolBand = smoothstep(COOL_H0, COOL_H1, hue) * (1 - smoothstep(COOL_H2, COOL_H3, hue));

  // ---------------------------------------------------------- saturation ----
  // The bible's rule is that the world is desaturated ochres and greys and the
  // accents are vivid, and it is emphatic that "that contrast is the whole
  // look". What the previous version of this section got wrong is that it read
  // "desaturated" as "desaturate", and applied FOUR reducing terms at once — a
  // warm pull, a flat trim, a shadow trim and a highlight bleach — to a frame
  // whose measured mean saturation was already 0.134, i.e. under the bible's
  // own ash swatch (`#8a7f72`, 0.174) before the grade touched it. Subtracting
  // chroma from a frame that is short of it is how three rounds of review kept
  // reading "sepia alpine photograph".
  //
  // The discipline the bible asks for is a *ratio*: a low-chroma warm mass and
  // two vivid accents. That is produced by holding the mass at its swatch
  // value — not below it — and leaving the accents alone. So the reducing
  // terms are now one small trim, and the work is done by the tint terms
  // below, which put chroma back in the direction the palette specifies rather
  // than taking it out in every direction at once.
  const t = sat01(l);
  // The bright warm band, used by the saturation step below. The temperature
  // anchors declare their own bands; they are not derived from this one.
  const skyBand = smoothstep(0.52, 0.74, t) * (1 - smoothstep(0.93, 1.0, t));

  // One trim, on the warm mass only. It is the ceiling half of the bible's
  // saturation discipline and it has to stay: the tint terms below restore
  // chroma toward the ash ramp wherever the frame has gone grey, and without a
  // counterweight on the population that has NOT gone grey the same terms turn
  // an ochre ground into a rust one. Measured on the first pass of this
  // rewrite, redmtn came back at mean saturation 0.415 against the palette
  // check's ceiling of 0.34 — an orange bath, the exact failure the previous
  // grade over-corrected away from.
  const baseTrim = (0.015 + 0.05 * warm) * (1 - accent);
  let s = 1 - baseTrim;
  // The accents are pushed the other way. Bloom and aerial haze both wash
  // chroma out of an emissive on the way here and nothing downstream was
  // putting it back, which is why a lava fissure and the rock beside it
  // measured the same saturation.
  s += 0.34 * accent;
  // The sky's own colour, amplified rather than replaced. This is one of the
  // two terms that carry stage 2 and stage 4's work through to the output;
  // because it is a lerp about `l` it strengthens a measured blue without
  // moving the hue one degree. Ridge's zenith arrives at hue 210 and leaves at
  // 211. The other term is the SKY anchor, which owns the part of the same
  // population that is too faint for this one to be honest about.
  const coolGain = Math.min(COOL_MAX, COOL_TARGET / Math.max(chroma, 1e-4));
  s += (coolGain - 1) * coolBand * (1 - accent)
    * (1 - smoothstep(COOL_TARGET, COOL_TARGET * COOL_FADE, chroma));
  // The sulphur band. A bright warm pixel is either sky or a sunlit ash face,
  // and the palette says both are ochre — `#c99a5c` carries chroma 0.54. This
  // is the term that answers "the sky averages (231, 220, 207), a cream wash":
  // where the previous grade merely *stopped* trimming the highlights, this
  // one asks for chroma back. Warm-gated, so it is a second chroma-only route
  // to the same end the HAZE anchor used to reach by repainting.
  s += 0.36 * skyBand * warm * (1 - accent);
  s = Math.max(s, 0.20);
  // Highlight bleach, kept only for the last few per cent of the range, where
  // it is the difference between a sun disc that rolls off and one that ends
  // in a hard edge. At 0.34 from display 0.86 it was catching the entire
  // sulphur horizon band, which is precisely the population the line above
  // exists to protect.
  s *= 1 - 0.22 * smoothstep(0.955, 1.0, t) * (1 - accent);
  cr = l + (cr - l) * s;
  cg = l + (cg - l) * s;
  cb = l + (cb - l) * s;

  // --------------------------------------------------------- temperature ----
  // Three anchors. See the block comment above the constants for why these are
  // (hue, saturation) pairs mixed in RGB rather than tint ratios lerped toward.
  //
  // The saturation step above is luminance-preserving by construction, so `l`
  // is still this pixel's luminance and every anchor is built at it. `chroma`
  // and `t` are likewise the values measured before that step: the anchors are
  // deciding what KIND of thing this pixel is — unlit rock, atmosphere, sunlit
  // surface — and that classification should not shift because the saturation
  // discipline just moved the pixel's chroma.

  // Atmosphere vs material. The two terms that own the bright half of the frame
  // take this gate and its complement, so they partition the population instead
  // of overwriting each other. Measured: with the SUN anchor applied after the
  // HAZE anchor and no chroma gate on it, it dragged the haze straight back to
  // its own hue and the haze term measured 0% of the frame.
  //
  // The partition used to be by HUE as well — 64 against 36 — and is now by
  // SATURATION alone, 0.26 against 0.56, because both anchors sit on the same
  // sulphur ramp. That is the point: pale atmosphere and a sunlit ash face are
  // the same colour at different strengths, which is what a palette with one
  // sky in it means. The gate below is what still separates them.
  const hazeGate = 1 - smoothstep(HAZE_C0, HAZE_C1, chroma);

  // The dome, where it is too faint to state its own angle. Placed before the
  // basalt term so a shaded rock that happens to be cool is decided by
  // luminance, not by whichever of the two ran last.
  const sky = SKY_MAX * coolBand * (1 - accent) * (1 - smoothstep(SKY_C0, SKY_C1, chroma));
  if (sky > 1e-4) {
    anchor(tmp, SKY_HUE, SKY_SAT, l);
    cr += (tmp[0] - cr) * sky;
    cg += (tmp[1] - cg) * sky;
    cb += (tmp[2] - cb) * sky;
  }
  // Unlit rock, lit by the sky dome alone — a LEAN, capped at BASALT_MAX, not a
  // replacement. `atmo` here is not about atmosphere: it is the same rule as
  // everywhere else in this file — do not overwrite a hue the buffer committed
  // to. A shadow that is already cool, because a glow-cap or a fissure is the
  // only thing lighting it, keeps what it has.
  //
  // The cap is the load-bearing part and the reason this term stopped being the
  // project's most-cited defect. Without it the weight reached 1.0 wherever the
  // luminance gate opened, and an anchor at weight 1.0 IS the pixel — hue,
  // saturation and all. The constants' comment has the crossover arithmetic;
  // the short version is that 0.25 is a third of the way to the weight at which
  // ash could flip, so ash in shadow comes out as ash with the chroma a shadow
  // should have taken off it.
  const cool = BASALT_MAX * (1 - smoothstep(BASALT_LO, BASALT_HI, t)) * (1 - accent) * atmo;
  if (cool > 1e-4) {
    anchor(tmp, BASALT_HUE, BASALT_SAT, l);
    cr += (tmp[0] - cr) * cool;
    cg += (tmp[1] - cg) * cool;
    cb += (tmp[2] - cb) * cool;
  }
  // Sunlit surface: bright AND carrying material chroma.
  const sun = smoothstep(SUN_LO, SUN_HI, t) * (1 - hazeGate) * SUN_MAX * (1 - accent) * atmo;
  if (sun > 1e-4) {
    anchor(tmp, SUN_HUE, SUN_SAT, l);
    cr += (tmp[0] - cr) * sun;
    cg += (tmp[1] - cg) * sun;
    cb += (tmp[2] - cb) * sun;
  }
  // Atmosphere: bright, nearly neutral, AND with no sky hue of its own to
  // destroy. The `atmo` factor is the whole fix — see the block comment above.
  const haze = smoothstep(HAZE_LO, HAZE_FULL, t) * (1 - smoothstep(HAZE_ROLL, 1.0, t))
    * hazeGate * (1 - accent) * atmo;
  if (haze > 1e-4) {
    anchor(tmp, HAZE_HUE, HAZE_SAT, l);
    cr += (tmp[0] - cr) * haze;
    cg += (tmp[1] - cg) * haze;
    cb += (tmp[2] - cb) * haze;
  }

  // Ratio-preserving ceiling, not a per-channel clamp — and SMOOTH, not a
  // divide that switches on at 1.0.
  //
  // Ratio-preserving because clamping each channel where it happens to land is
  // the same mistake the tonemapper's overflow guard was making one stage
  // earlier: it walks a saturated colour toward white as each channel reaches
  // the ceiling in turn. Measured on the first pass of this rewrite, the
  // sulphur horizon came out of this cube at (253, 226, 190) with red pinned on
  // the rail. Scaling the triplet by one number keeps hue and saturation
  // exactly and simply lands the pixel darker.
  //
  // Smooth because `if (top > 1) c /= top` is a SLOPE DISCONTINUITY, and this
  // file's opening paragraph is an argument that the eye finds a slope
  // discontinuity more readily than a step. Across a bright sky gradient the
  // pixels either side of where the divide switches on get different treatment,
  // which lays down a kink along an iso-luminance contour. It is the same
  // exponential the value curve uses on its max channel, for the same reason,
  // and it cannot clip.
  //
  // Measured, so nobody re-litigates it: this was ALSO tried as a fix for the
  // gate's line-isolation statistic and it did not move it. It is kept purely
  // on its own merits — see LUMINANCE TRANSPARENCY at the foot of this function
  // for where that statistic actually comes from.
  const top = Math.max(cr, cg, cb);
  if (top > CEIL_KNEE) {
    const head = 1 - CEIL_KNEE;
    const soft = CEIL_KNEE + head * (1 - Math.exp(-(top - CEIL_KNEE) / head));
    const k = soft / top;
    cr *= k;
    cg *= k;
    cb *= k;
  }
  out[0] = sat01(cr);
  out[1] = sat01(cg);
  out[2] = sat01(cb);
}

/**
 * ---------------------------------------------------------------------------
 * LUMINANCE TRANSPARENCY, and the ridge seam that is NOT this file's
 * ---------------------------------------------------------------------------
 *
 * Every term above is luminance-preserving by construction. The saturation step
 * is a lerp toward `l`, so luma(out) == l identically. All four anchors are
 * built AT `l` and mixed in RGB, so any convex combination of pixel and anchor
 * also has luminance `l`. Only the ceiling can move it, and only above 0.88.
 *
 * That is worth stating because the gate's `no chunk seam` check runs on
 * luminance, and a grade round will be blamed for it. It should not be.
 * MEASURED on identical input pixels — one capture of the current build with
 * `RENDER_DEBUG.lut = false`, then the grade applied to those same pixels
 * offline (tools/_gradelab.mjs does this; the pre-LUT capture is the input):
 *
 *      shot      grade OFF   this grade   delta
 *      dawn      1.932       1.930        -0.002
 *      redmtn    1.577       1.585        +0.008
 *      vale      1.695       1.692        -0.003
 *      ridge     2.164       2.152        -0.012
 *      coast     1.465       1.480        +0.015
 *
 * Nothing this file does is visible to that statistic. Whole-frame luminance
 * moves by a mean of 0.15 to 2.6 of 255 between the buffer and the cube's
 * output, all of it from the ceiling above 0.88.
 *
 * RE-MEASURED after the hue-64 and hue-214 anchors were retired, because the
 * sulphur anchor pushes a bright sky further off-neutral than the chartreuse one
 * did and therefore engages that ceiling harder (ridge p99 goes 224 -> 216). The
 * A/B is the gate's own `seam()` run over identical input pixels — `shots/_prelut`
 * ungraded, then through the old cube, then through this one:
 *
 *      shot    ungraded   old cube   this cube
 *      ridge      0.849      0.844       0.836
 *      dawn       1.440      1.440       1.441
 *
 * The cube still lowers the statistic. `ridge.seamIsolation` moved 1.549 ->
 * 2.118 -> 2.236 across three engine captures of builds that differ only in
 * these constants, which is the same 1.5-2.9 spread `dawn` has always shown,
 * on the shot the ratio is most sensitive on. Do not tune this file against it.
 *
 * >> `dawn.seamIsolation` IS CURRENTLY FAILING THE GATE'S BASELINE COMPARISON
 * >> AND IT IS NOT THE COLOUR STAGE. Recorded baseline 2.012, tolerance 2.314.
 * >> Four captures of the current build with the cube BYPASSED measured 2.849,
 * >> 2.400, 2.209, 2.686 — over the tolerance on every sample — and the same
 * >> four with the cube on measured 2.945, 1.834, 2.022, 1.722. The grade lowers
 * >> the mean rather than raising it.
 * >>
 * >> The feature is an ACTOR, not a seam. The strongest contributor is at rows
 * >> 763-847 around column 610-640: a skerrin's thin dangling tentacles, bright
 * >> against dark ground, which is precisely the "centre differs from both
 * >> neighbours in the same direction" pattern the scan is built to find. It
 * >> drifts between captures, which is why the reported column moved 610, 614,
 * >> 617, 622, 626, 629, 632, 636, 637, 640 over ten measurements and the
 * >> strength moved with it. The 2.012 in the baseline is one low sample of a
 * >> 1.7-2.9 distribution.
 * >>
 * >> Triage belongs upstream: either the seam scan should reject features that
 * >> do not span a long run (an actor is ~90 rows of a 900-row frame, a chunk
 * >> seam is most of it), or dawn's vantage should not frame a moving creature.
 * >> Do not "fix" it here — there is nothing here to fix.
 *
 * The statistic is noisy in general, because it is a ratio against the frame's
 * own 90th-percentile row and ridge is unusually smooth (p90 = 0.58 against
 * 0.95-1.09 everywhere else), so small changes in the numerator swing it hard.
 * Do not tune anything against a single sample of it.
 */

/**
 * The grade cube unrolled as an N*N x N strip. A 2D atlas rather than a
 * Data3DTexture because the manual slice lerp costs one extra tap and keeps the
 * sampler budget identical on every driver.
 *
 * Half-float nodes, not 8-bit. An 8-bit cube quantises every node to 1/255 and
 * then interpolates between the quantised values, which does not merely add
 * half an LSB of noise — it makes the transfer curve *piecewise linear with
 * kinks at the node boundaries*. The eye finds a slope discontinuity far more
 * readily than a step, so on a slow gradient (the night sky, the glow around a
 * moon) it reads as concentric contour rings roughly every fourth output level,
 * and no amount of output dither removes them because they are not a
 * quantisation of the output, they are a quantisation of the curve. Two
 * megabytes of half-float buys a smooth curve and the rings simply stop
 * existing.
 */
export function buildGradeLUT(): THREE.DataTexture {
  const N = LUT_N;
  const data = new Uint16Array(N * N * N * 4);
  const half = THREE.DataUtils.toHalfFloat;
  const one = half(1);
  const px = new Float32Array(3);
  for (let bz = 0; bz < N; bz++) {
    for (let gy = 0; gy < N; gy++) {
      for (let rx = 0; rx < N; rx++) {
        // Row-major over (slice, g, r) would transpose the atlas; the strip is
        // laid out x = slice*N + r, y = g, so write with an explicit index.
        gradePixel(px, rx / (N - 1), gy / (N - 1), bz / (N - 1));
        const x = bz * N + rx;
        const idx = (gy * (N * N) + x) * 4;
        data[idx] = half(px[0]);
        data[idx + 1] = half(px[1]);
        data[idx + 2] = half(px[2]);
        data[idx + 3] = one;
      }
    }
  }
  const tex = new THREE.DataTexture(data, N * N, N, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  // Values are already display-encoded; any automatic transfer function here
  // would double-apply the grade.
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 64x64 blue noise by swap-based energy minimisation (Georgiev & Fajardo).
 * A dozen sweeps over a radius-4 kernel is enough to push the spectrum's DC
 * hole open, which is all the dithered half-res passes need — and it costs
 * ~30ms at init rather than the seconds a full void-and-cluster would.
 */
export function buildBlueNoise(size = 64): THREE.DataTexture {
  const N = size;
  const NP = N * N;
  const rnd = mulberry32(0x1a2b3c4d);
  const v = new Float32Array(NP);
  for (let i = 0; i < NP; i++) v[i] = (i + 0.5) / NP;
  for (let i = NP - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = v[i];
    v[i] = v[j];
    v[j] = t;
  }

  const R = 4;
  const SIG2 = 2.1 * 2.1;
  const off: number[] = [];
  const wgt: number[] = [];
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if (dx === 0 && dy === 0) continue;
      off.push(dx, dy);
      wgt.push(Math.exp(-(dx * dx + dy * dy) / SIG2));
    }
  }
  const K = wgt.length;

  const energyAt = (x: number, y: number, val: number): number => {
    let e = 0;
    for (let k = 0; k < K; k++) {
      const sx = (x + off[k * 2] + N) % N;
      const sy = (y + off[k * 2 + 1] + N) % N;
      const dv = Math.abs(val - v[sy * N + sx]);
      e += wgt[k] * Math.exp(-Math.sqrt(dv));
    }
    return e;
  };

  const SWAPS = NP * 12;
  for (let s = 0; s < SWAPS; s++) {
    const ia = (rnd() * NP) | 0;
    const ib = (rnd() * NP) | 0;
    if (ia === ib) continue;
    const ax = ia % N;
    const ay = (ia / N) | 0;
    const bx = ib % N;
    const by = (ib / N) | 0;
    const va = v[ia];
    const vb = v[ib];
    const before = energyAt(ax, ay, va) + energyAt(bx, by, vb);
    const after = energyAt(ax, ay, vb) + energyAt(bx, by, va);
    if (after < before) {
      v[ia] = vb;
      v[ib] = va;
    }
  }

  const data = new Uint8Array(NP * 4);
  for (let i = 0; i < NP; i++) {
    const a = Math.min(255, (v[i] * 256) | 0);
    // Three decorrelated channels from one optimised field: a rotation of the
    // rank by irrational offsets keeps each channel's spectrum intact.
    data[i * 4] = a;
    data[i * 4 + 1] = ((a + 85) % 256) | 0;
    data[i * 4 + 2] = ((a + 170) % 256) | 0;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export const GLSL_LUT = /* glsl */ `
uniform sampler2D tLUT;
uniform float uLutMix;

vec3 applyLUT(vec3 c) {
  const float N = ${LUT_N}.0;
  c = clamp(c, 0.0, 1.0);
  float sl = c.b * (N - 1.0);
  float s0 = floor(sl);
  float s1 = min(s0 + 1.0, N - 1.0);
  float f = sl - s0;
  // Half-texel inset keeps bilinear filtering inside the owning slice.
  vec2 inner = (c.rg * (N - 1.0) + 0.5) / N;
  vec3 a = texture(tLUT, vec2((inner.x + s0) / N, inner.y)).rgb;
  vec3 b = texture(tLUT, vec2((inner.x + s1) / N, inner.y)).rgb;
  return mix(c, mix(a, b, f), uLutMix);
}
`;
