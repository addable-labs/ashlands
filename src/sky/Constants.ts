/**
 * Physical atmosphere parameters, in SI (metres, per-metre). World units are
 * metres, so world-space distances feed the optical-depth integrals directly.
 *
 * Rayleigh/ozone coefficients are Bruneton's 2017 fits for 680/550/440nm.
 * The Mie term is deliberately NOT Earth's: Vvardenfell's air carries volcanic
 * ash, so scattering is biased warm and absorption eats the short wavelengths.
 * That single change is what turns a blue Earth sky into a bronze Dunmer one.
 */

export const PLANET_R = 6360e3;
export const ATMO_R = 6420e3;
export const ATMO_H = ATMO_R - PLANET_R;

export const H_RAYLEIGH = 8000;
/**
 * Aerosol scale height, metres.
 *
 * 1400, not 2600. At 2600 — twice Earth's boundary layer — the ash aerosol was
 * still the dominant scatterer at the ZENITH: the vertical Mie optical depth was
 * 0.234 in red against a Rayleigh 0.046, so the top of the dome integrated to a
 * warm neutral and every "clear" sky in the game measured under 0.15 saturation
 * with no hue difference between the horizon band and the zenith at all. A sky
 * with no hue rotation in it is a value ramp, and a value ramp is the 2002
 * gradient dome the bible forbids.
 *
 * The load itself is not the problem — the sea-level density is unchanged, so a
 * grazing ray still crosses exactly as much ash as before and the sulphur horizon
 * band is untouched. What changes is how far up it reaches: at 1400 the aerosol
 * is a boundary-layer feature, Rayleigh takes the zenith back, and the dome gets
 * a real horizon-to-zenith hue rotation (sulphur -> dusty blue-grey).
 *
 * It is also what puts light back into a sunset. Transmittance along a 2-degree
 * solar ray ran to 0.005 in RED at the old scale height, i.e. the cloud deck at
 * dusk was lit by a key three per cent of the sky's own ambient and rendered as
 * flat grey-brown lumps with no lit side. The column is now thin enough that a
 * low sun still delivers a beam.
 */
export const H_MIE = 1400;

export const BETA_RAYLEIGH: readonly [number, number, number] = [5.802e-6, 13.558e-6, 33.1e-6];

/**
 * Ash aerosol scattering.
 *
 * The grains are coarse — microns, not the sub-wavelength droplets of a water
 * haze — so scattering is very nearly wavelength-flat and only slightly warm.
 * The *magnitude* is what matters: at 4.2e-5 the aerosol out-scatters Rayleigh
 * through the whole lower atmosphere, which is what makes the sky bronze rather
 * than blue. The previous 4.2e-6 left Rayleigh dominant everywhere, so the dome
 * integrated to an Earth-blue that the grade then pushed to green-grey — the
 * "wrong hue family entirely" defect.
 */
const MIE_BASE = 4.2e-5;
/**
 * 1.30 / 1.00 / 0.66, not 1.16 / 1.00 / 0.80.
 *
 * At the old ratio the aerosol's own in-scatter was only 1.45:1 red to blue,
 * which over the short slant path of a HIGH sun is nowhere near enough to move
 * the dome off neutral: the noon vale frame measured a near-monochrome ramp from
 * (144,140,131) to (169,162,149), chroma under 8%, region mean saturation 0.137
 * — a grey sky, over the single most area-dominant element of the frame, in a
 * setting whose entire identity is a sulphur one. The bible's band is #c99a5c to
 * #7d5a3e and nothing in the frame was inside it.
 *
 * 2:1 is the ratio a micron-scale iron-oxide grain actually scatters at (the
 * absorption edge is in the blue, so what comes back out is red-biased even
 * though the geometric cross-section is grey), and green is held fixed so the
 * total scattered ENERGY, and therefore every exposure in every frame, is
 * unchanged — this moves hue only.
 */
export const BETA_MIE_S: readonly [number, number, number] = [
  MIE_BASE * 1.30,
  MIE_BASE * 1.0,
  MIE_BASE * 0.66,
];
/**
 * Absorption by the ash grains, blue-biased. Note the sign of the *net*
 * extinction: with a near-grey scattering term, adding blue-biased absorption
 * finally makes total Mie extinction rise toward the blue, which is what a
 * mineral aerosol actually does. The old coefficients had extinction highest in
 * the RED (5.80/4.20/2.44 scattering swamped 0.86/1.52/2.38 absorption), i.e.
 * the atmosphere was stripping red out of the sky — exactly backwards.
 */
const MIE_ABS = 1.4e-5;
export const BETA_MIE_E: readonly [number, number, number] = [
  BETA_MIE_S[0] + MIE_ABS * 0.30,
  BETA_MIE_S[1] + MIE_ABS * 0.70,
  BETA_MIE_S[2] + MIE_ABS * 1.50,
];

/**
 * Suspended volcanic glass: pure absorption, no scattering, mixed high through
 * the column. This is the term that carries the Ashlands colour signature. It
 * takes the blue out of the Rayleigh in-scatter over a path of a few kilometres
 * without hazing the image, so a distant ridge desaturates and lifts toward the
 * sulphur band (#c99a5c) instead of toward a grey fog wall, and the zenith
 * lands warm-neutral rather than blue.
 *
 * Kept separate from BETA_MIE_E because it has its own scale height and, being
 * absorption-only, must never appear in a scattering source term.
 */
/*
 * The spectral slope here used to be [2.0e-6, 1.9e-5, 5.6e-5] — a 28:1
 * blue-to-red ratio, which is a lambda^-4 Rayleigh slope. Coarse ash is a
 * MICRON-scale grain, three orders of magnitude out of the Rayleigh regime, and
 * its absorption follows an Angstrom exponent nearer 1.3 (roughly lambda^-1.3),
 * i.e. about 2.3:1 across 680->440nm. The old slope was not a stylistic choice
 * with a physical justification, it was the wrong regime, and downstream it made
 * direct sunlight at 37 degrees elevation as red as an Earth sunset — which is
 * why raising the aerial-perspective term at all pushed every value in the frame,
 * ground included, up past 0.45 HSV saturation. The world is meant to be
 * desaturated ochre with the saturation reserved for lava and bioluminescence.
 * Same green magnitude, so the depth cue this term provides is unchanged.
 */
export const BETA_ASH: readonly [number, number, number] = [1.2e-5, 1.9e-5, 2.8e-5];
/**
 * 1800, not 2800, for the same reason as H_MIE: this is a *suspended grit* term,
 * and grit settles. At 2800 it was taking 12% of the blue out of the zenith,
 * which is precisely the channel the Rayleigh hue rotation lives in. Sea-level
 * density is unchanged, so the depth cue on distant terrain — the whole reason
 * this term exists — is exactly as strong as before.
 */
export const H_ASH = 1800;

export const BETA_OZONE: readonly [number, number, number] = [0.650e-6, 1.881e-6, 0.085e-6];
export const OZONE_CENTER = 25000;
export const OZONE_WIDTH = 15000;

export const MIE_G = 0.68;

/** Solar irradiance in engine units. Calibrated so noon zenith radiance ~0.35. */
export const SUN_E = 11.0;

/** Latitude of Vvardenfell. Northern, temperate — long low winter suns. */
export const LATITUDE = 41.5 * Math.PI / 180;
/** Axial tilt driving seasonal declination. */
export const OBLIQUITY = 23.0 * Math.PI / 180;
/** In-world days per year; declination cycles on this period. */
export const YEAR_DAYS = 372;

/**
 * Cloud slab, metres above sea level.
 *
 * Lowering the base to 1100 was tried and reverted: the hypothesis was that the
 * deck is too far away to survive the boundary layer at the 0-27 degrees of
 * elevation a horizon frame actually contains, and the measurement contradicted
 * it. Differencing a clear against an overcast render of the coast vantage shows
 * the deck present, formed and layered across that whole band — it is drawn, it
 * has silhouette, and it lands within a couple of luminance levels of the sky it
 * hangs in. The coast sky is not cloud-free, it is cloud-with-no-contrast, and
 * the lever for that is the deck's own internal lighting range (see marchClouds),
 * not its altitude.
 */
/**
 * Single-scattering albedo of the cumulus deck. Water droplets are very nearly
 * conservative scatterers.
 *
 * Shared with the shader (CLOUD_ALB in SkyShader) because the CPU now needs it
 * too: the deck's radiance ceiling — the most a conservative medium can hand
 * back for a given irradiance — is computed from it every frame and published as
 * `uCloudKeyMax`. See the note beside that uniform in Atmosphere.ts.
 */
export const CLOUD_ALBEDO = 0.96;

export const CLOUD_BOTTOM = 1750;
export const CLOUD_TOP = 4600;
/**
 * The high ice veil. Well above the deck and above nearly all of the aerosol,
 * which is why it is lit by a different beam and a different sky — see
 * uCirrusSun / uCirrusSkyUp in Atmosphere.ts. Must match CIR_H in SkyShader.
 */
export const CIRRUS_H = 7400;

/* ------------------------------------------------------------- shadows */

/**
 * Cascade coverage. See src/sky/Cascades.ts.
 *
 * `SHADOW_DISTANCE` is where cast shadows stop, not where the world stops. At
 * 700 m the aerial-perspective term has already taken most of the contrast out
 * of a silhouette, so a fifth cascade would be paying full price for something
 * the atmosphere is erasing anyway. It is deliberately far larger than the
 * +/-160 m box the previous build used, which is the whole reason that build
 * had no visible shadows at all.
 */
export const SHADOW_DISTANCE = 700;
export const SHADOW_NEAR = 0.5;
/**
 * Log/uniform split blend. 1.0 is pure logarithmic (perfect texel density,
 * absurdly tight near cascade); 0 is pure uniform (near cascade far too coarse).
 */
export const CASCADE_LAMBDA = 0.9;
/**
 * How far behind a cascade's own volume the light is pulled back, in metres.
 * This is the reach of an occluder that is outside the cascade but still casts
 * into it — a mountain flank or a telvanni tower at a raking dawn sun.
 */
export const CASCADE_CASTER_DEPTH = 520;
/** Blend band at a cascade border, as a fraction of the cascade's box. */
export const CASCADE_BLEND = 0.09;
/** Target penumbra width in metres; sets each cascade's PCF radius in texels. */
export const CASCADE_PENUMBRA = 0.055;

/** Densities (rayleigh, mie, ozone, ash) at altitude h, metres above sea level. */
export function densities(h: number): [number, number, number, number] {
  const oz = Math.max(0, 1 - Math.abs(h - OZONE_CENTER) / OZONE_WIDTH);
  return [Math.exp(-h / H_RAYLEIGH), Math.exp(-h / H_MIE), oz, Math.exp(-h / H_ASH)];
}

/**
 * Distance from a point at radius `r` travelling with cos-zenith `mu` to the
 * top of the atmosphere. Negative discriminant is impossible inside the shell.
 */
export function distanceToTop(r: number, mu: number): number {
  const d = r * r * (mu * mu - 1) + ATMO_R * ATMO_R;
  return Math.max(0, -r * mu + Math.sqrt(Math.max(0, d)));
}

export function hitsPlanet(r: number, mu: number): boolean {
  return mu < 0 && r * r * (mu * mu - 1) + PLANET_R * PLANET_R >= 0;
}

/**
 * Optical depth (rayleigh, mie, ozone) from radius `r`, cos-zenith `mu`, to the
 * atmosphere boundary. Quadratic step distribution puts resolution near the
 * dense lower atmosphere where it matters.
 */
export function opticalDepth(
  r: number,
  mu: number,
  steps = 48,
): [number, number, number, number] {
  if (hitsPlanet(r, mu)) return [1e9, 1e9, 1e9, 1e9];
  const L = distanceToTop(r, mu);
  let odR = 0;
  let odM = 0;
  let odO = 0;
  let odA = 0;
  let prevT = 0;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const t = L * f * f;
    const ds = t - prevT;
    const mid = (t + prevT) * 0.5;
    prevT = t;
    const h = Math.sqrt(r * r + mid * mid + 2 * r * mid * mu) - PLANET_R;
    const [dr, dm, doz, da] = densities(Math.max(0, h));
    odR += dr * ds;
    odM += dm * ds;
    odO += doz * ds;
    odA += da * ds;
  }
  return [odR, odM, odO, odA];
}

export function transmittance(r: number, mu: number): [number, number, number] {
  const [odR, odM, odO, odA] = opticalDepth(r, mu);
  const e = (i: 0 | 1 | 2) =>
    Math.exp(
      -(
        BETA_RAYLEIGH[i] * odR +
        BETA_MIE_E[i] * odM +
        BETA_OZONE[i] * odO +
        BETA_ASH[i] * odA
      ),
    );
  return [e(0), e(1), e(2)];
}

/**
 * The transmittance LUT parameterisation, shared verbatim with the shader.
 * mu is warped by a square root so the horizon — where transmittance changes
 * fastest — gets most of the texels.
 */
export function encodeMu(mu: number): number {
  const s = mu < 0 ? -1 : 1;
  return 0.5 + 0.5 * s * Math.sqrt(Math.abs(mu));
}
export function decodeMu(u: number): number {
  const d = u - 0.5;
  const s = d < 0 ? -1 : 1;
  return s * (2 * Math.abs(d)) ** 2;
}

/**
 * Blackbody colour in linear sRGB, normalised so the brightest channel is 1.
 * Bartlett's rational fit to the Planckian locus; accurate enough between
 * 1000K and 15000K, which covers horizon sun through hot stars.
 */
export function blackbodyLinear(kelvin: number, out: [number, number, number] = [0, 0, 0]) {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * (t - 60) ** -0.1332047592;
    g = 288.1221695283 * (t - 60) ** -0.0755148492;
    b = 255;
  }
  const srgb = [r / 255, g / 255, b / 255].map((c) => Math.min(1, Math.max(0, c)));
  const lin = srgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const m = Math.max(lin[0], lin[1], lin[2], 1e-4);
  out[0] = lin[0] / m;
  out[1] = lin[1] / m;
  out[2] = lin[2] / m;
  return out;
}
