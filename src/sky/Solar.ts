import * as THREE from 'three';
import { LATITUDE, OBLIQUITY, YEAR_DAYS, blackbodyLinear, transmittance, PLANET_R } from './Constants';

/**
 * Ephemeris for the sun and the two moons.
 *
 * Everything is driven from a real horizontal-coordinate transform: a body has
 * a right ascension that advances at its own rate and a declination, and the
 * planet's rotation supplies the hour angle. This is what gives Masser and
 * Secunda genuinely independent risings that drift ~50 minutes a day apart,
 * rather than two sprites on the same rail.
 */

export interface Body {
  /** World-space unit vector from the observer toward the body. */
  dir: THREE.Vector3;
  /** Altitude above the horizon, radians. */
  alt: number;
}

export interface Ephemeris {
  sun: Body;
  masser: Body;
  secunda: Body;
  /** Local sidereal angle, radians — rotates the star sphere. */
  lst: number;
}

const SIN_LAT = Math.sin(LATITUDE);
const COS_LAT = Math.cos(LATITUDE);

/** Masser's sidereal period, in-world days. Secunda's is deliberately coprime. */
const MASSER_PERIOD = 24;
const SECUNDA_PERIOD = 32;

/**
 * Orbital elements. These are art-directed, not derived: the nodes and epochs
 * are solved backwards from a horizontal-coordinate target at the canonical
 * night hour (day 1, 23:24).
 *
 * ---- why the previous solve had to be thrown away --------------------------
 *
 * It put Masser at 34 degrees altitude on bearing 152 — which, at 23:24, is
 * FOUR AND A HALF DEGREES from the anti-solar point. A body at opposition is a
 * full moon by definition, and a full moon has no terminator and no relief:
 * every crater on it is lit from directly behind the observer, so the shading
 * term is flat across the whole face and the disc renders as a coloured circle
 * no matter how much surface detail the shader puts under it. Measured on the
 * iter14 night plate Masser came back at 99.2% illuminated. The review's "two
 * featureless flat discs, one full-phase orange with no craters and no
 * terminator" was not a texturing failure; it was this number.
 *
 * That is a geometric constraint, not a taste one, and it cannot be fixed
 * anywhere downstream: a disc placed near the anti-solar point is full, and the
 * anti-solar point at 23:24 sits at altitude 41.5 on bearing 142 — i.e. in the
 * upper-LEFT third of the night vantage's 100-degree frame. Elongation, and so
 * phase, therefore runs as a gradient across the frame: a disc parked on the
 * left is 97% lit and one parked low on the right is 55-70% lit. There is no
 * placement that is both left-of-centre and phased.
 *
 * ---- the solve ------------------------------------------------------------
 *
 * So the two bodies swap sides.
 *
 * Masser now stands at 32 degrees altitude on bearing 224 — above and right of
 * the telvanni tower, 113 degrees of elongation, 72% illuminated. That is a
 * waning gibbous with a terminator crossing a third of the disc, which is what
 * puts a band of grazing light across the crater field and makes the relief in
 * moon() visible at all.
 *
 * The ALTITUDE is a second, separate constraint, and the first solve got it
 * wrong: 18 degrees was equally well phased and put the disc under an airmass of
 * 3.3, where the particulate layer's own forward scattering built an aureole
 * bright enough to paint over the terminator from in front. Halving the airmass
 * (and convolving the aureole lobes with the source — see hazeSrcG) is what
 * leaves a clean halo around a body instead of a lantern with a disc in it.
 *
 * Secunda inherits the slot Masser vacated: 34 degrees on bearing 152, near
 * opposition and so very nearly full. That is correct for it — a small, cold,
 * high, plain disc reads as full without complaint, and the pair now spans the
 * frame instead of crowding one side of it.
 *
 * Both solves were checked against the dusk vantage as well, because these
 * elements are shared. At 19:48 Masser has climbed out of the top of that frame
 * and Secunda sits at 3 degrees over the Inner Sea, so the dusk shot keeps the
 * low disc and the glitter path on the water that were its focal point — the
 * body carrying them is now the small pale one rather than the large ruddy one.
 *
 * The periods stay coprime (24 and 32 days) so the pair opens and closes over
 * the cycle rather than sitting on a fixed rig; day 1 is the canonical shot day.
 */
const MASSER_INC = 0.3500;
const MASSER_NODE = 2.6767;
const MASSER_EPOCH = 1.8609;
const SECUNDA_INC = 0.3500;
const SECUNDA_NODE = 3.9610;
const SECUNDA_EPOCH = 3.0397;

/**
 * Art-directed civil day: the clock hours at which the disc crosses the horizon.
 *
 * The shot list asks for a low dawn sun at 6.2h AND a setting sun at 19.8h. At
 * Ashenreach's latitude the true equinox arc puts sunset at 18:00, so 19.8h
 * placed the sun 19 degrees BELOW the horizon: the "dusk" shot — briefed for
 * sunset scattering, horizon band and cloud silver lining — rendered as
 * astronomical night, with no disc, no glow and no warm band anywhere in frame.
 *
 * The fix is a clock, not a fudge of the sun's position. The disc still travels
 * a real horizontal arc for the current declination; only the mapping from the
 * in-world clock to hour angle is authored, exactly as a civil timezone offset
 * does on Earth. Sunrise lands on SUNRISE_H and sunset on SUNSET_H for every
 * declination in the year, and the map is continuous across both crossings and
 * across midnight, so nothing snaps.
 */
const SUNRISE_H = 5.8;
const SUNSET_H = 20.0;
const SOLAR_NOON_H = (SUNRISE_H + SUNSET_H) * 0.5;
const NIGHT_LEN_H = 24 - (SUNSET_H - SUNRISE_H);

/** Hour angle of the sun for the in-world clock, in radians, in (-pi, pi]. */
function solarHourAngle(hour: number, dec: number): number {
  // Half-day arc for this declination: the hour angle at horizon crossing.
  // Clamped so a polar declination cannot collapse the map to a point.
  const c = THREE.MathUtils.clamp(-Math.tan(LATITUDE) * Math.tan(dec), -0.995, 0.995);
  const H0 = Math.acos(c);
  const h = ((hour % 24) + 24) % 24;

  if (h >= SUNRISE_H && h <= SUNSET_H) {
    const f =
      h < SOLAR_NOON_H
        ? -(SOLAR_NOON_H - h) / (SOLAR_NOON_H - SUNRISE_H)
        : (h - SOLAR_NOON_H) / (SUNSET_H - SOLAR_NOON_H);
    return f * H0;
  }
  // Night runs SUNSET_H -> SUNRISE_H+24, mapped onto H0 -> 2pi-H0. Wrapped back
  // into (-pi, pi] so downstream code never sees a discontinuity at midnight.
  const t = h > SUNSET_H ? h - SUNSET_H : h + 24 - SUNSET_H;
  const ha = H0 + (t / NIGHT_LEN_H) * (2 * Math.PI - 2 * H0);
  return ha > Math.PI ? ha - 2 * Math.PI : ha;
}

function horizontal(hourAngle: number, dec: number, out: THREE.Vector3): number {
  const sinDec = Math.sin(dec);
  const cosDec = Math.cos(dec);
  const cosH = Math.cos(hourAngle);
  const sinAlt = SIN_LAT * sinDec + COS_LAT * cosDec * cosH;
  const alt = Math.asin(THREE.MathUtils.clamp(sinAlt, -1, 1));
  // Azimuth measured from north, increasing eastward.
  const az = Math.atan2(Math.sin(hourAngle), cosH * SIN_LAT - Math.tan(dec) * COS_LAT) + Math.PI;
  const ca = Math.cos(alt);
  // World convention: -Z is north, +X is east, +Y is up.
  out.set(ca * Math.sin(az), Math.sin(alt), -ca * Math.cos(az));
  return alt;
}

export function makeEphemeris(): Ephemeris {
  return {
    sun: { dir: new THREE.Vector3(0, 1, 0), alt: 0 },
    masser: { dir: new THREE.Vector3(0, 1, 0), alt: 0 },
    secunda: { dir: new THREE.Vector3(0, 1, 0), alt: 0 },
    lst: 0,
  };
}

export function updateEphemeris(hour: number, day: number, e: Ephemeris): void {
  const t = day + hour / 24;
  const yearPhase = (t / YEAR_DAYS) * Math.PI * 2;

  // Solar declination from the obliquity; equinox at day 0.
  const decSun = Math.asin(Math.sin(OBLIQUITY) * Math.sin(yearPhase));
  const raSun = yearPhase;
  e.sun.alt = horizontal(solarHourAngle(hour, decSun), decSun, e.sun.dir);
  // Sidereal time stays on the *uniform* clock, not the civil-remapped one:
  // the star sphere and the moons must turn at a constant rate or the whole sky
  // would visibly speed up at dusk and stall at noon.
  e.lst = (hour - 12) * (Math.PI / 12) + raSun;

  // Moons: inclined orbits with different ascending nodes, so their tracks
  // cross the sky at visibly different angles.
  const raM = (t / MASSER_PERIOD) * Math.PI * 2 + MASSER_EPOCH;
  const decM = Math.sin(raM - MASSER_NODE) * MASSER_INC;
  e.masser.alt = horizontal(e.lst - raM, decM, e.masser.dir);

  const raS = (t / SECUNDA_PERIOD) * Math.PI * 2 + SECUNDA_EPOCH;
  const decS = Math.sin(raS - SECUNDA_NODE) * SECUNDA_INC;
  e.secunda.alt = horizontal(e.lst - raS, decS, e.secunda.dir);
}

/**
 * Correlated colour temperature of direct sunlight, BEFORE the atmosphere.
 *
 * This used to run 1800K on the horizon to 6500K at the zenith — but 1800K IS
 * the reddening the atmosphere does, and `sunShading` below multiplies this by
 * the real spectral transmittance immediately afterwards. Applying both counted
 * the extinction twice: at 37 degrees elevation, where the transmittance alone
 * gives a perfectly ordinary warm afternoon sun, the pair of them produced a
 * light as red as an Earth sunset and dragged the whole frame monochrome orange.
 *
 * The extraterrestrial sun is ~5900K. The residual drop toward the horizon
 * stands in for the *aerosol* forward-scattering the single-column LUT does not
 * resolve, not for the extinction, so it is shallow.
 */
export function sunCCT(alt: number): number {
  const s = Math.max(0, Math.sin(alt));
  return 4600 + 1500 * s ** 0.5;
}

const _bb: [number, number, number] = [0, 0, 0];

export interface SunShading {
  /** Linear-space chroma of the light, normalised so max channel = 1. */
  color: THREE.Color;
  /** Scalar radiance multiplier in [0,1] before art-directed gain. */
  luminance: number;
}

/**
 * Direct sun colour: blackbody chroma at the altitude-derived CCT, multiplied
 * by the true atmospheric transmittance along the solar ray. The transmittance
 * term is what makes a Ashenreach sunset burn — the ash-loaded Mie extinction
 * strips blue far harder than Earth's would.
 */
export function sunShading(alt: number, camY: number, out: SunShading): SunShading {
  blackbodyLinear(sunCCT(alt), _bb);
  const mu = Math.sin(alt);
  const T = transmittance(PLANET_R + Math.max(0, camY), mu);
  const r = _bb[0] * T[0];
  const g = _bb[1] * T[1];
  const b = _bb[2] * T[2];
  const m = Math.max(r, g, b, 1e-5);
  out.color.setRGB(r / m, g / m, b / m, THREE.LinearSRGBColorSpace);
  out.luminance = Math.min(1, m);
  return out;
}
