import * as THREE from 'three';
import type { WeatherState } from '../core/types';

/**
 * Every art-directed quantity the sky exposes, as a flat bag of scalars so that
 * transitions are one lerp loop rather than eighteen hand-written blends.
 * Colours are unpacked into components for the same reason.
 */
export interface SkyParams {
  coverage: number;
  /** High ice/ash veil, independent of the cumulus deck. Never zero. */
  cirrus: number;
  density: number;
  type: number;
  sunMul: number;
  ambMul: number;
  mieMul: number;
  msBoost: number;
  hazeDensity: number;
  hazeH: number;
  /** Albedo of the particulate layer's TOP, where the fine fraction is. */
  hazeR: number;
  hazeG: number;
  hazeB: number;
  /** Albedo of its dense BASE, where the coarse fraction is. */
  deepR: number;
  deepG: number;
  deepB: number;
  tintR: number;
  tintG: number;
  tintB: number;
  wind: number;
  gust: number;
  wetness: number;
  rain: number;
  snow: number;
  ash: number;
  spore: number;
  strikeRate: number;
  starMul: number;
  audioWind: number;
  audioRoar: number;
  audioRain: number;
}

const KEYS = [
  'coverage', 'cirrus', 'density', 'type', 'sunMul', 'ambMul', 'mieMul', 'msBoost',
  'hazeDensity', 'hazeH', 'hazeR', 'hazeG', 'hazeB', 'deepR', 'deepG', 'deepB',
  'tintR', 'tintG', 'tintB',
  'wind', 'gust', 'wetness', 'rain', 'snow', 'ash', 'spore', 'strikeRate',
  'starMul', 'audioWind', 'audioRoar', 'audioRain',
] as const satisfies readonly (keyof SkyParams)[];

type Kind = WeatherState['kind'];

function p(over: Partial<SkyParams>): SkyParams {
  return {
    coverage: 0.22, cirrus: 0.30, density: 1.0, type: 0.45,
    sunMul: 1.0, ambMul: 1.0, mieMul: 1.0, msBoost: 0.9,
    hazeDensity: 8.0e-5, hazeH: 320,
    hazeR: 0.54, hazeG: 0.46, hazeB: 0.35,
    deepR: 0.54, deepG: 0.46, deepB: 0.35,
    tintR: 1.0, tintG: 1.0, tintB: 1.0,
    wind: 4, gust: 2, wetness: 0,
    rain: 0, snow: 0, ash: 0.05, spore: 0.04, strikeRate: 0,
    starMul: 1, audioWind: 0.12, audioRoar: 0, audioRain: 0,
    ...over,
  };
}

/**
 * Vvardenfell weather. Note that nothing here is green or gentle: even "clear"
 * carries a suspended ash load, and the wet states are cold and iron-coloured
 * rather than pastoral.
 */
export const PRESETS: Record<Kind, SkyParams> = {
  clear: p({
    // "Clear" on Vvardenfell is not an empty sky. The deck stays sparse, but the
    // standing ash load always leaves a high veil: without it the noon dome was
    // a featureless vertical ramp that could have been any hour of any day.
    // cirrus 0.32. Coverage and per-streak opacity are both driven by this one
    // number; the threshold it feeds now opens ABOVE the shape field's median
    // (see cirrusLayer), so this is a handful of distinct fallstreaks with bare
    // sky between them rather than a sheet across the whole dome.
    //
    // mieMul 1.00, not 1.65 — and the note that used to sit here was reasoning
    // about the
    // wrong end of the dome.
    //
    // The claim was that raising the aerosol load was the only way to move the
    // ZENITH into the sulphur band while leaving the horizon alone. The first
    // half is true and it is exactly the defect: at 1.65 the vertical Mie
    // optical depth is 0.16 in green against Rayleigh's 0.108, so the aerosol
    // out-scatters the molecules at the top of the dome, and because the Mie
    // forward lobe points AT the zenith whenever the sun is high, a clear noon
    // integrated to (0.057, 0.045, 0.046) — red-biased, a warm neutral, with no
    // hue rotation left anywhere in the sky. The review measured the result on
    // three separate plates: 7 levels of luminance ramp on coast, 4 on vale, no
    // blue anywhere, "a bleached cream wash that reads as overexposed haze
    // rather than a sky".
    //
    // The second half is simply false, and that is what makes this cheap. The
    // horizon band is SATURATED: the aerosol's airmass at zero elevation is 84,
    // so its optical depth there is 6 at this multiplier and 10 at the old one —
    // both far past the point where any further load changes the colour. So the
    // multiplier is a zenith control and nothing else. At 1.00 the vertical Mie
    // depth drops below Rayleigh's, the dome integrates to (0.032, 0.032, 0.039)
    // — cool, a dusty blue-grey — and #c99a5c at the horizon is untouched to
    // within a level. That IS the hue rotation the bible asks for, and it is the
    // one thing a 2002 gradient dome cannot do.
    // coverage 0.14 and cirrus 0.22, not 0.26 and 0.32 — and this is a LIGHTING
    // number, not a cloud-form one.
    //
    // Measured by ablating each layer out of the environment bake on the ridge
    // vantage: at 0.26/0.32 the cloud layers together carried 53% of the entire
    // diffuse irradiance of the world, DOUBLING the hemisphere's irradiance over
    // the cloud-free dome (0.74 -> 1.55). A deck that doubles the diffuse is four
    // to six oktas; that is what `cloudy` is authored at, and the name of this
    // preset has to mean something.
    //
    // Why it matters far more than a sky-form question should: the bake is the
    // only ambient term in the build, so it is what every shadowed surface in the
    // world is lit by. Cloud is grey and reflects whatever lights it, and at 29
    // degrees of solar altitude through this ash load that is a beam at
    // saturation 0.43. So half the world's fill light was a mirror of the key,
    // the cloud-free dome's hue 222 was outvoted by cloud at hue 31, the IBL
    // integrated to hue 24, and a surface in shadow came back the same colour as
    // a surface in sun. That is the "single-hue wash" finding, and no amount of
    // work on materials or on the grade can fix a scene with one illuminant in it.
    //
    // At 0.14/0.22 the layers fall to roughly a quarter of the bake, the dome's
    // own scattering integral is the majority illuminant again, and the sky over
    // the shoulder of a ridge is blue rather than a warm lid. The deck is not
    // deleted — a clear Ashlands noon still carries a broken line of cumulus and
    // half a dozen fallstreaks, which is what the ash load and the coverage
    // threshold's position above the shape field's median are for.
    //
    // mieMul 0.72, not 1.00, and for exactly the reason the note above already
    // gives: this is a ZENITH control. The aerosol's airmass at zero elevation is
    // 84, so its optical depth at the horizon is past the point where any further
    // load changes the colour — the sulphur band is unchanged to within a level at
    // any value in this range — while the vertical depth at the zenith is a few
    // hundredths and every bit of it competes directly with Rayleigh's.
    //
    // Measured on the pre-grade ridge plate, the middle third of the sky's area —
    // between the sulphur band and the zenith, which is most of what a landscape
    // frame actually shows — came out at (209,209,209): saturation 0.002, an
    // achromatic bright card sitting exactly where the art bible asks for a hue
    // rotation, because the aerosol's optical depth was cancelling the molecular
    // one instead of sitting under it. At 0.72 that band measures hue 206-216 at
    // saturation 0.03-0.09 and the plate runs blue at the zenith, neutral through
    // the middle, sulphur at the band. The share of the sky's chroma-bearing
    // pixels outside hue 0-60 goes from 2.6% to 27%.
    coverage: 0.14, cirrus: 0.18, type: 0.35, mieMul: 0.72,
    // 3.0e-4, not 1.0e-4. The Rayleigh + ash column alone extinguishes about 7%
    // over a kilometre, which is Earth-at-Earth-scale: correct physics for a
    // 50km vista and functionally zero for a world whose whole visible depth is
    // one to three kilometres. Measured on the coast frame it left a headland at
    // 1-2km sitting DARKER than ground five metres from the eye, i.e. aerial
    // perspective inverted and the background reading as a cardboard cutout. At
    // 3.0e-4 the total extinction over a kilometre is 0.36, so a surface there
    // hands back 30% of its own radiance to the air in front of it and both
    // desaturates and lifts toward the horizon band — the art bible's third
    // non-negotiable. Pushed to 4.5e-4 it does read as more depth, and it also
    // drags every value in the frame toward the in-scatter's own chroma, which
    // is the sun's, which at this ash load is deeply orange; 3.0e-4 is where the
    // depth cue is unambiguous and the world is still desaturated ochre rather
    // than Martian. The 300m scale height keeps it out of the upper sky: it is a
    // boundary-layer load, so it thickens the horizon and leaves the zenith.
    // 800m scale height, not 300.
    //
    // 300m is not a boundary layer, it is a ground fog, and the consequence is
    // that aerial perspective SWITCHES OFF the moment the camera climbs. On the
    // ridge vantage the eye sits at 1320m: exp(-1320/300) is 0.012, so the layer
    // contributed an optical depth of 0.01 over two and a half kilometres and
    // distant terrain kept 80% of its own radiance while the sky right above it
    // was four times brighter. That is the "hard fog wall / aerial perspective
    // inverted" reading — not too much fog, too little, and all of it in the
    // bottom three hundred metres where the horizon is not.
    //
    // Density comes down with the height so the near-field is barely touched
    // (0.20/km against 0.30/km at the boots) while a ridge-top vantage now has a
    // real layer in front of it: at 1320m the sea-level fraction goes from 1.2%
    // to 19%, i.e. sixteen times the extinction at exactly the altitude every
    // vista shot is taken from.
    // 1.2e-4 over a 1000m scale height, not 2.0e-4 over 800m — and the quantity
    // that actually changed is the layer's VERTICAL column, which is what the
    // sky sees, while its extinction at ridge altitude, which is what the vista
    // shots see, is nearly held.
    //
    // sigma * H is the whole optical depth an upward ray crosses: at 2.0e-4/800
    // it is 0.16, so a ray fifteen degrees up out of a three-metre eye still ran
    // od 0.62 of particulate and the layer owned 46% of every sky pixel a
    // sea-level frame contains. The coast vantage's sky spans elevation 0 to 27
    // degrees and nothing else, and the dome underneath that layer is hue 213 at
    // 15 degrees and 224 at 25 — a real blue with a sulphur band under it, the
    // same rotation the ridge frame is praised for. None of it survived: the
    // frame measured 0.2% non-warm content at any chroma threshold, which is the
    // "flat, sunless, cloudless wash" finding in one number.
    //
    // sigma * exp(-1320/H) is the extinction at the ridge's eye altitude, and it
    // is the constraint that stopped this being a free change — the 300m version
    // of this layer switched aerial perspective off the moment the camera
    // climbed. Raising H while lowering sigma trades against it far better than
    // lowering sigma alone: 0.16 -> 0.12 on the column costs only 0.095 -> 0.082
    // on the ridge's 2.5km vista, i.e. a seventh of the depth cue for a quarter
    // of the sky back. At the boots the layer still extinguishes 0.24 over two
    // kilometres, so a headland at that range still hands a fifth of its own
    // radiance to the air in front of it.
    //
    // The horizon band does not move at all: a level ray from sea level crosses
    // an airmass of ~90 scale heights, so its optical depth is 10 at this value
    // and 17 at the old one, and both are far past the point where any further
    // load changes the colour. #c99a5c stays exactly where the palette puts it.
    hazeDensity: 1.2e-4, hazeH: 1000, hazeR: 0.58, hazeG: 0.48, hazeB: 0.33,
    // Even on a clear day the bottom of the boundary layer carries the coarse
    // red grit and the top carries only the bleached fine fraction, so the fog
    // at the boots is a shade redder than the fog on a ridge line. It is a small
    // split — this is not weather — but it is the difference between midground
    // and background being two colours rather than one.
    //
    // TRIED AND REVERTED, with the numbers, so the next round does not spend
    // itself here. 0.507/0.370/0.253 at identical luminance (0.390) — i.e. a
    // pure chroma correction — was shipped and measured across the whole
    // ten-shot set. The reasoning was good: read as an albedo, which is what
    // this is, 0.56/0.36/0.19 is saturation 0.661 at hue 27.6 against the tint
    // above it at 0.431, and the art bible's entire ground palette (ash #8a7f72
    // to #4a423b, basalt #2a2622) sits at 0.174-0.203 in the same measure. This
    // is the reflectance of AIRBORNE GRIT, which is the same oxide dust as the
    // ground it was torn off, so authoring it three times more saturated than
    // the ground says the dust is a different mineral in the air than on the
    // floor. And 'deep' is where a landscape frame lives: the ramp is
    // mix(deep, tint, smoothstep(0.10, 1.50, hbar/H)) with H = 1000 m here, so
    // for any eye near the ground the veil past a few hundred metres is ~95%
    // this number.
    //
    // It moved nothing. Whole-frame relative saturation, before -> after, on the
    // canonical ten: dawn 0.328 -> 0.326, redmtn 0.352 -> 0.349, coast 0.365 ->
    // 0.363, night 0.327 -> 0.330, ashstorm 0.484 -> 0.483, dusk 0.152 -> 0.150,
    // vale 0.314 -> 0.319, storm 0.189 -> 0.189, underwater 0.318 -> 0.320,
    // ridge 0.435 -> 0.432. Every one of those is inside the capture-to-capture
    // spread of the framing search, and the circular-mean hue of shadowed ground
    // did not move by a degree on any shot. The gate went 1 fail -> 2 (it pushed
    // dawn's marginal column seam over its strength threshold), so it was backed
    // out under the pipeline's revert rule.
    //
    // What that measurement is worth: the veil's ALBEDO CHROMA is not the lever,
    // even though colour-tagging the veil proves the veil owns the pixel. Both
    // facts are true at once because hazeSSA already takes the bulk reflectance
    // down to a near-neutral per-event albedo (saturation 0.171 on this preset —
    // the bible's ash swatch is 0.174) for optically thin paths, and the near and
    // mid field are optically thin. The frame is warm because the light landing
    // on the veil is warm, not because the veil is.
    deepR: 0.56, deepG: 0.36, deepB: 0.19,
    // A FLAT per-channel tint cannot produce a hue rotation — it is a constant,
    // and multiplying a gradient by a constant leaves the ratio between any two
    // points on it unchanged. At 1.10/1.00/0.80 it was worth a 1.375:1 warm bias
    // over the entire dome, and measured off the sky-view table that is exactly
    // what was cancelling the rotation the scattering integral already produces:
    // the raw zenith at noon is (0.36, 0.34, 0.41) — blue — and the tint turned
    // it into (0.39, 0.34, 0.33). The reviewer's "no zenith blue, no hue shift
    // from horizon band to zenith, the same colour at both" was measuring this
    // multiply, not the atmosphere.
    //
    // The warmth belongs to the aerosol, which is altitude-dependent, so it
    // warms the horizon and leaves the zenith alone. What is left here is a
    // whisker of bronze on the direct beam (this same colour also tints the
    // sun light delivered to surfaces) and nothing that can flatten a gradient.
    tintR: 1.03, tintG: 1.00, tintB: 0.94,
    wind: 4, gust: 2, audioWind: 0.10,
  }),
  cloudy: p({
    // "Cloudy" must not mean "delete the clouds" — but 0.66 was the opposite
    // mistake. Measured off the half-res cloud buffer on the redmtn vantage it
    // closed the deck completely: 97% opaque across the entire upper half of the
    // frame, so every pixel of sky was the SHADED UNDERSIDE of an overcast and
    // the shot read as a uniform grey-beige card. That is what "overcast" is for.
    // "Cloudy" is a broken sky — 4 to 6 oktas — where the sun-facing flanks and
    // the tops are visible through the gaps and the deck has silhouette. 0.50
    // puts the coverage threshold above the shape field's median, which breaks it.
    coverage: 0.56, cirrus: 0.38, density: 1.25, type: 0.68, sunMul: 0.88, ambMul: 1.05,
    // Same rebalance as `clear` above, kept a shade heavier because a cloudy day
    // genuinely carries more suspended load: the column is 0.14 against clear's
    // 0.12 and the ridge-altitude extinction is within 8% of what it was.
    mieMul: 1.05, hazeDensity: 1.4e-4, hazeH: 1000, wind: 8, gust: 4, audioWind: 0.2,
    hazeR: 0.56, hazeG: 0.47, hazeB: 0.34, deepR: 0.54, deepG: 0.35, deepB: 0.19,
    tintR: 1.03, tintG: 0.99, tintB: 0.93,
  }),
  overcast: p({
    cirrus: 0.14, coverage: 0.94, density: 1.5, type: 0.28, sunMul: 0.30, ambMul: 1.30,
    mieMul: 1.30, hazeDensity: 4.2e-4, hazeH: 280,
    hazeR: 0.36, hazeG: 0.36, hazeB: 0.38,
    deepR: 0.36, deepG: 0.36, deepB: 0.38,
    tintR: 0.92, tintG: 0.94, tintB: 1.0,
    wind: 10, gust: 5, starMul: 0.05, audioWind: 0.3,
  }),
  rain: p({
    cirrus: 0.08, coverage: 0.97, density: 1.5, type: 0.5, sunMul: 0.25, ambMul: 1.35,
    mieMul: 1.60, hazeDensity: 6.5e-4, hazeH: 300,
    hazeR: 0.30, hazeG: 0.32, hazeB: 0.36,
    deepR: 0.30, deepG: 0.32, deepB: 0.36,
    tintR: 0.86, tintG: 0.92, tintB: 1.0,
    wind: 12, gust: 7, wetness: 1, rain: 1, starMul: 0.0,
    audioWind: 0.35, audioRain: 0.75,
  }),
  thunder: p({
    cirrus: 0.08, coverage: 0.96, density: 1.9, type: 0.95, sunMul: 0.19, ambMul: 1.45,
    mieMul: 1.80, hazeDensity: 8.5e-4, hazeH: 340,
    hazeR: 0.28, hazeG: 0.29, hazeB: 0.34,
    deepR: 0.28, deepG: 0.29, deepB: 0.34,
    tintR: 0.82, tintG: 0.90, tintB: 1.0,
    wind: 20, gust: 12, wetness: 1, rain: 1.25, strikeRate: 0.16, starMul: 0,
    audioWind: 0.5, audioRain: 0.9,
  }),
  /** The signature: a moving wall of pulverised basalt. Visibility ~120m. */
  ashstorm: p({
    // Visibility was 60m at 5.0e-2. That is defensible as weather and indefensible
    // as a shot: foreground, midground and background all landed inside a 40-level
    // value band and no land mass could silhouette against anything. 2.5e-2 puts
    // the extinction horizon near 120m, which still buries the far country and
    // still leaves three readable depth planes. The 800m scale height is what
    // gives the layer its vertical gradient — dark at the boots, two stops
    // brighter at ten degrees up — so the skyline is legible again.
    coverage: 0.62, cirrus: 0.25, density: 1.1, type: 0.75, sunMul: 0.40, ambMul: 0.85,
    mieMul: 6.0, msBoost: 1.5,
    // 1.5e-2 / 700m, down from 2.5e-2 / 800m.
    //
    // At 2.5e-2 the column above Red Mountain's 1330m summit still carried an
    // optical depth of 3.8, so the hero silhouette of the entire province
    // measured THREE luminance levels off the sky behind it — 97% in-scatter,
    // which is not aerial perspective, it is erasure. The peak now sits under an
    // optical depth near 1.0 and reads roughly 20 levels below the sky, while
    // near-field extinction (1/sigma = 67m at the boots) is still unambiguously
    // a storm. The shorter scale height is what does the work: it steepens the
    // vertical gradient so the summit rises out of the densest layer instead of
    // being buried by a slab that reaches to 2km.
    hazeDensity: 1.5e-2, hazeH: 700,
    // The signature weather's palette, and the one place the bible's sulphur
    // sky and ember belong verbatim. It used to be a single tan (0.62/0.48/0.32,
    // i.e. #cfb898 on screen) top to bottom, which is why the shot read as one
    // uniform beige card with no ash-red in it anywhere. The column is now two
    // materials: the top is the fine fraction that stays airborne, at the
    // sulphur-sky value #c99a5c, and the base is the coarse basalt grit the wind
    // is actually tearing off the ground, which is oxide red near the ember end
    // of the palette. hazeMeanH decides which one a given ray sees, so the storm
    // has a vertical hue ramp: red-brown at the boots, sulphur overhead.
    hazeR: 0.68, hazeG: 0.45, hazeB: 0.19,
    deepR: 0.56, deepG: 0.18, deepB: 0.075,
    // Ember, not amber. What direct light survives the column has been through
    // kilometres of iron oxide.
    tintR: 1.24, tintG: 0.86, tintB: 0.58,
    wind: 30, gust: 16, wetness: 0, ash: 1, spore: 0, starMul: 0,
    audioWind: 0.55, audioRoar: 1.0,
  }),
  /** Blight: the same particulate carried on a sickly, diseased air. */
  blight: p({
    cirrus: 0.38, coverage: 0.55, density: 1.2, type: 0.7, sunMul: 0.30, ambMul: 0.95,
    mieMul: 3.0, msBoost: 1.4,
    hazeDensity: 4.0e-3, hazeH: 500,
    hazeR: 0.40, hazeG: 0.44, hazeB: 0.24,
    deepR: 0.34, deepG: 0.30, deepB: 0.13,
    tintR: 1.02, tintG: 1.0, tintB: 0.72,
    wind: 16, gust: 9, ash: 0.45, spore: 1, starMul: 0.1,
    audioWind: 0.42, audioRoar: 0.55,
  }),
  blizzard: p({
    cirrus: 0.10, coverage: 0.96, density: 1.6, type: 0.35, sunMul: 0.22, ambMul: 1.5,
    mieMul: 3.2, msBoost: 1.6,
    hazeDensity: 2.0e-2, hazeH: 500,
    hazeR: 0.72, hazeG: 0.76, hazeB: 0.84,
    deepR: 0.70, deepG: 0.74, deepB: 0.84,
    tintR: 0.90, tintG: 0.95, tintB: 1.0,
    wind: 22, gust: 12, wetness: 0.35, snow: 1, ash: 0, spore: 0, starMul: 0,
    audioWind: 0.75, audioRoar: 0.25,
  }),
};

/** Markov weights for autonomous weather. Ash storms brew out of dry cloud. */
const CHAIN: Record<Kind, Partial<Record<Kind, number>>> = {
  clear: { clear: 3, cloudy: 5, ashstorm: 1.2, blight: 0.3 },
  cloudy: { clear: 4, cloudy: 2, overcast: 4, ashstorm: 1.6, rain: 1.2, blight: 0.4 },
  overcast: { cloudy: 4, rain: 4, thunder: 1.2, blizzard: 0.6, ashstorm: 0.8 },
  rain: { overcast: 5, thunder: 2, cloudy: 2 },
  thunder: { rain: 5, overcast: 3 },
  ashstorm: { cloudy: 4, clear: 3, blight: 1.2, ashstorm: 1 },
  blight: { ashstorm: 2, cloudy: 3, clear: 2 },
  blizzard: { overcast: 5, cloudy: 2 },
};

export const WEATHER_NOTICE: Record<Kind, string> = {
  clear: 'The haze thins. The sky burns clean.',
  cloudy: 'Cloud gathers off the Inner Sea.',
  overcast: 'The light goes flat and grey.',
  rain: 'Rain comes in off the water.',
  thunder: 'Thunder walks the ashlands.',
  ashstorm: 'An ash storm rises out of the west. Find shelter.',
  blight: 'Blight winds. The air tastes of corruption.',
  blizzard: 'Snow, driven hard. Sheogorath is laughing.',
};

/**
 * Blended weather with smooth transitions, gusting wind, and a lightning
 * generator. Purely numeric — it owns no GPU state.
 */
export class WeatherMachine {
  readonly params: SkyParams = p({});
  kind: Kind = 'clear';
  blend = 1;

  readonly windDir = new THREE.Vector2(0.82, 0.57);
  windSpeed = 4;
  wetness = 0;
  /** 0..1 flash energy this frame; drives cloud emission and a light spike. */
  lightning = 0;

  private from: SkyParams = p({});
  private to: SkyParams = PRESETS.clear;
  private t = 1;
  private dur = 1;
  private dwell = 0;
  private heading = Math.atan2(0.57, 0.82);
  private strikeIn = 4;
  private flash = 0;
  private flashSeq = 0;
  private flashGap = 0;

  constructor() {
    Object.assign(this.params, PRESETS.clear);
    Object.assign(this.from, PRESETS.clear);
    this.dwell = 240;
  }

  set(kind: Kind, seconds = 25): void {
    // Reset the dwell timer first: a roll that lands on the current state must
    // still push the next roll out, or the scheduler spins every frame.
    this.dwell = 180 + Math.random() * 420;
    if (kind === this.kind && this.t >= 1) return;
    Object.assign(this.from, this.params);
    this.to = PRESETS[kind];
    this.kind = kind;
    this.dur = Math.max(0.001, seconds);
    this.t = 0;
    this.blend = 0;
  }

  /** @returns true when the autonomous scheduler picked a new state. */
  update(dt: number, elapsed: number): boolean {
    let changed = false;
    this.dwell -= dt;
    if (this.dwell <= 0) {
      this.set(this.roll(), 20 + Math.random() * 40);
      changed = true;
    }

    if (this.t < 1) this.t = Math.min(1, this.t + dt / this.dur);
    // Smoothstep: weather should ease in, not ramp linearly. Run every frame,
    // not only while blending, so `params` is always a pure function of
    // (from, to, t) and the gust below can modulate it without compounding.
    const s = this.t * this.t * (3 - 2 * this.t);
    for (const k of KEYS) this.params[k] = this.from[k] + (this.to[k] - this.from[k]) * s;
    this.blend = this.t;

    // Gusting. A storm is not a homogeneous slab of extinction: it arrives in
    // surges, and the visibility opens and closes with them. Without this the
    // ash storm is one flat absorption term that never changes — the medium
    // reads as a fog constant rather than as weather, which is the whole
    // complaint against the signature shot. Two incommensurate periods plus a
    // faster third, so the cycle never repeats audibly or visibly, and scaled by
    // the ash load so ordinary weather is unaffected.
    const surge =
      Math.sin(elapsed * 0.21) * Math.sin(elapsed * 0.083 + 1.1) +
      0.55 * Math.sin(elapsed * 0.43 + 2.3);
    const stormy = THREE.MathUtils.clamp(this.params.ash + this.params.snow, 0, 1);
    this.params.hazeDensity *= 1 + 0.28 * surge * stormy;
    this.params.mieMul *= 1 + 0.14 * surge * stormy;

    // Wind heading wanders; speed gusts on two incommensurate periods so it
    // never falls into an audible or visible loop.
    this.heading += (Math.sin(elapsed * 0.037) * 0.5 + Math.sin(elapsed * 0.011) * 0.5) * dt * 0.09;
    this.windDir.set(Math.cos(this.heading), Math.sin(this.heading));
    const gust =
      0.5 + 0.5 * Math.sin(elapsed * 0.31) * Math.sin(elapsed * 0.137 + 1.7) +
      0.25 * Math.sin(elapsed * 0.91 + 0.4);
    this.windSpeed = this.params.wind + this.params.gust * gust;

    // Ground dries slowly and wets fast.
    const target = this.params.wetness;
    const rate = target > this.wetness ? 0.35 : 0.045;
    this.wetness += THREE.MathUtils.clamp(target - this.wetness, -rate * dt, rate * dt);

    this.updateLightning(dt);
    return changed;
  }

  private updateLightning(dt: number): void {
    const rate = this.params.strikeRate;
    if (rate <= 0.0001 && this.flash <= 0.001 && this.flashSeq <= 0) {
      this.lightning = 0;
      return;
    }
    this.strikeIn -= dt * rate * 12;
    if (this.strikeIn <= 0) {
      this.strikeIn = 1 + Math.random() * 4;
      this.flashSeq = 1 + ((Math.random() * 3) | 0);
      this.flashGap = 0;
    }
    if (this.flashSeq > 0) {
      this.flashGap -= dt;
      if (this.flashGap <= 0) {
        this.flash = 0.6 + Math.random() * 0.4;
        this.flashSeq--;
        this.flashGap = 0.06 + Math.random() * 0.16;
      }
    }
    // Fast exponential decay: a strike is a stab of light, not a fade-in.
    this.flash *= Math.exp(-dt * 9);
    this.lightning = this.flash;
  }

  private roll(): Kind {
    const w = CHAIN[this.kind];
    let total = 0;
    for (const k in w) total += w[k as Kind] ?? 0;
    let r = Math.random() * total;
    for (const k in w) {
      r -= w[k as Kind] ?? 0;
      if (r <= 0) return k as Kind;
    }
    return 'cloudy';
  }
}
