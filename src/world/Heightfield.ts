import { Surface } from '../core/types';
import { clamp01, domainWarp, fbm2, hash1, ridged2, smoothstep, softAbs, warpX, warpY } from './Noise';
import { erode, thermal } from './Erosion';

/** Half-extent of the playable region. World spans [-EXTENT, EXTENT] on x and z. */
export const EXTENT = 2000;
/** Authoritative heightfield resolution. 1.954 m between samples. */
export const RES = 2048;
/** Erosion runs coarser than it renders; droplets need cells, not pixels. */
export const SIM = 1024;
/** Splat/flow data resolution. Matches SIM so erosion output needs no resampling. */
export const DATA = SIM;
/** World distance between adjacent height samples. */
export const STEP = (2 * EXTENT) / (RES - 1);
/**
 * Deepest quadtree level. Node size 4000/2^7 = 31.25 m over a 32-quad grid, so
 * the near-field cell is 0.98 m — half a height sample — out to 140 m.
 *
 * Stopping at depth 6 put the finest cell at exactly one sample (1.95 m), which
 * sounds sufficient and is not: the rendered surface is then a *chord* of the
 * bilinear field rather than the field itself, so at eye height every cell
 * within 15 m subtends 100+ px and the ground reads as a fan of flat plates.
 * One more level halves that and drives the mesh onto the bilinear surface,
 * which is exactly what `heightAt()` returns and therefore exactly what physics
 * walks on. Depth 8 was measured too: it looks no better (nothing below 1.95 m
 * carries new information) and costs 17 fps on the redmtn vantage, so 7 is the
 * point where the plates stop being readable and the budget still closes.
 */
export const MAX_DEPTH = 7;

export const RM_X = -180;
export const RM_Z = -1120;
export const RM_R = 1290;
const RM_H = 1700;
/**
 * Caldera radius, widened from 235 m, and see CALDERA_DROP for the depth.
 *
 * At 235 m against a 1290 m mass the crater was a dimple: it never broke the
 * silhouette from any vantage on the ground, and every review of the mountain
 * came back "no caldera, a near-perfectly symmetrical smooth cone, Mount Fuji
 * rather than Red Mountain". A caldera is not a summit crater — it is a
 * *collapse*, and it is the single feature that tells a viewer this cone has
 * erupted. 300 m of radius against a 1290 m mass puts the rim at a quarter of
 * the way out, which is the proportion the real thing carries.
 */
const CALDERA_R = 300;
/**
 * Depth of the caldera floor below the notional cone apex. 640 m left the floor
 * only 200 m under the rim, which reads as a saucer; 980 m puts 550 m of wall
 * under the rim and makes the interior a place rather than a dent. It is also
 * what makes the vantage solver stop framing the ridge shot on the crater floor
 * — see the note there.
 */
const CALDERA_DROP = 980;

const ISL_X = 40;
const ISL_Z = -450;
const ISL_R = 1950;

const VALE_X = 690;
const VALE_Z = 430;
const VALE_R = 460;
const VALE_FLOOR = 32;

/** Splat layer order. Index into the surface texture arrays and the weight vector. */
export const L_ASH = 0;
export const L_ASH_COARSE = 1;
export const L_ROCK = 2;
export const L_BASALT = 3;
export const L_SAND = 4;
export const L_GRASS = 5;
export const L_MUD = 6;
export const L_LAVA = 7;
export const NUM_LAYERS = 8;

/** IMaterials names, in layer order. */
export const LAYER_MATERIALS = [
  'ash',
  'ash_coarse',
  'volcanic_rock',
  'basalt',
  'sand',
  'lichen_grass',
  'mud',
  'lava_crust',
] as const;

const LAYER_SURFACE: number[] = [
  Surface.Ash,
  Surface.Ash,
  Surface.Rock,
  Surface.Stone,
  Surface.Sand,
  Surface.Grass,
  Surface.Mud,
  Surface.Lava,
];

/** Foyada (lava channel) bearings, seeded once so CPU and GPU agree on the shape. */
const FOYADA = 5;

/**
 * The wavelength, in metres, at which a term's amplitude has faded to nothing in
 * the baked heightfield. Everything below this is the fragment shader's job.
 *
 * This is a sampling-theory limit, not a taste one. Samples are STEP = 1.954 m
 * apart, so the grid's Nyquist wavelength is 3.91 m. Below that a component
 * folds straight back down into a low-frequency beat, and the failure mode is
 * not subtle softness: gradient noise vanishes on its own integer lattice, so an
 * octave whose period is a near-rational multiple of the sample spacing lays
 * down a periodic grid of light/dark blobs that no amount of texture-space
 * anti-repetition can touch, because it lives in the geometry.
 *
 * 6 m is 3.07 samples per cycle at *zero* amplitude, and Noise.bandGate spreads
 * the fade over the octave above it, so a term is at full amplitude only above
 * 12 m (6.1 samples per cycle) and is already halved by ~8 m. That is a
 * conservative margin over Nyquist with a smooth rolloff, which is what the
 * grid needs; it is not the same thing as removing the band.
 *
 * The previous value was 12 m — full amplitude only above 24 m, twelve samples
 * per cycle. That is a factor of two of headroom nothing was asking for, and it
 * cost the whole mid-scale band: Red Mountain's spines, the erosion channels and
 * every crag between 6 and 24 m went with it, leaving smooth domes. The
 * aliasing that motivated it came from *bilinear reconstruction*, whose
 * curvature is an impulse on every grid line regardless of what is baked; that
 * is fixed independently by the C2 B-spline in heightAt/thAtD, and it stays
 * fixed. Band-limiting and reconstruction are separate defences and this one no
 * longer has to do both jobs.
 *
 * Relief below 6 m comes from the per-pixel meso band in TerrainMaterial, which
 * starts at LMIN * 2 so the two bands butt together with no hole and no overlap.
 */
export const LMIN = 6;

/**
 * Angle of repose, as a tangent, for the thermal pass.
 *
 * Loose volcanic ash and cinder stand at 33-36 degrees; welded basalt and
 * agglomerate on a young cone hold 48-52 before they spall. Blending between
 * the two by altitude is a crude proxy for "how much of this is bedrock", but it
 * is the right crude proxy here: the ash apron is low and the cone is high, and
 * a single constant either turns Red Mountain into a dune (soft) or leaves the
 * wastes full of extruded card (hard).
 *
 * tan(35 deg) = 0.700, tan(51 deg) = 1.235.
 */
const TALUS_SOFT = 0.7;
/**
 * 1.235 is tan(51 deg), and 51 degrees is the repose angle of *agglomerate*.
 * Welded basalt and columnar rock do not stand at repose at all — they stand
 * until they spall, at 65-80 degrees, which is why real volcanic uplands have
 * cliff bands above their scree. Capping the whole cone at 51 meant no face in
 * the world could ever be steep enough to read as rock rather than as a pile,
 * and the review's "not one hard edge or vertical face in 1920x1080" follows
 * directly. tan(59 deg) = 1.664 leaves the bedrock faces standing while the
 * ash apron below TALUS_LO is untouched at 35 degrees.
 */
const TALUS_HARD = 1.664;
const TALUS_LO = 110;
const TALUS_HI = 400;

/** fMax for a noise call whose world scale is `s` cycles per metre. */
function bandLimit(s: number): number {
  return 1 / (s * LMIN);
}

function wrapAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

/**
 * Pre-erosion tectonics. Red Mountain is a ridged-multifractal cone with a
 * blown caldera and radial spines; the wastes around it are domain-warped fBm;
 * the island silhouette is a warped radial falloff into a shelf. Everything
 * expensive is gated on the mountain mass so open ash costs a third as much.
 */
function baseHeight(x: number, z: number): number {
  const wob = fbm2(x * 0.00105, z * 0.00105, 4, 2.02, 0.5, bandLimit(0.00105)) * 275;
  const di = Math.sqrt((x - ISL_X) * (x - ISL_X) + (z - ISL_Z) * (z - ISL_Z));
  const shore = smoothstep(ISL_R + wob, ISL_R + wob - 560, di);

  // Shelf: -82 m offshore rising through the surf zone to the coastal plain.
  let h = -82 + 96 * shore;

  const dx = x - RM_X;
  const dz = z - RM_Z;
  const dr = Math.sqrt(dx * dx + dz * dz);

  if (dr < RM_R * 1.18) {
    const ang = Math.atan2(dz, dx);
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);

    // Radial asymmetry, and this is the difference between a volcano and a
    // cone of sand.
    //
    // massBase was 1 - dr/RM_R, a function of radius alone, so every azimuth
    // carried an identical profile and the only thing breaking the outline was
    // the spine noise riding on top of it. From a kilometre away that noise is
    // sub-pixel and what remains is a perfect isoceles triangle — the review's
    // "near-perfectly symmetrical, smooth and beige", "Mount Fuji, not Red
    // Mountain". A real massif is built out of successive vents and sector
    // collapses: its plan outline is a lobed blob, not a circle, and the profile
    // you see depends on which side you are standing on.
    //
    // Sampling the modulation on a circle in noise space (rather than on the
    // angle directly) keeps it seamless across the ±π branch cut. Two octaves at
    // ~1.1 cycles per turn give two or three broad lobes — sectors, not
    // corrugation — and ±19% of radius is enough to move a flank by 240 m.
    // fbm2 is signed, [-1, 1]; fold it to [0, 1] before it is used as a mask.
    const lobe = clamp01(fbm2(ca * 1.15 + 4.7, sa * 1.15 - 2.9, 3, 2.04, 0.5, 1.0) * 0.5 + 0.5);
    const rEff = RM_R * (0.90 + 0.34 * lobe);
    const massBase = clamp01(1 - dr / rEff);
    const mass = Math.pow(massBase, 1.5);

    // Sampling on a circle in noise space keeps the angular pattern seamless
    // across the ±π branch cut that a naive polar mapping would tear open.
    //
    // The band limit here is radius-dependent and that is not optional. One
    // noise unit on this circle spans r/9 metres of arc, so the fourth octave
    // is 15 m wide at the foot of the cone and 2.5 m wide halfway up it: a
    // fixed octave count paints ever finer radial corrugation as it climbs, and
    // that corrugation is exactly the radial rows of blobs that made the flanks
    // read as snakeskin. Solving for arc wavelength >= LMIN (the extra factor 2
    // is the ridged fold, applied inside ridged2) gives f <= r / (9 * LMIN).
    //
    // The circle is also warped along itself. Without the warp the surviving
    // octaves sit at a fixed *angular* rate, which on the ground is a set of
    // radial ridges at near-constant arc spacing — regular enough that the
    // curvature autocorrelation spikes at that spacing and the eye reads
    // corduroy. Real spines are not evenly spaced; nudging the sampling angle
    // by a slow radial field costs one fBm and removes the regularity.
    const spineBand = Math.max(0.35, dr / (9 * LMIN));
    const aw = fbm2(dr * 0.0021 + 12.9, ang * 1.7 + 3.4, 3) * 0.42;
    // Rib SPACING has to be non-uniform, and `aw` cannot make it so.
    //
    // aw displaces the sampling circle by up to 0.42 of a noise unit against a
    // base frequency of 9, i.e. by five per cent, and it is a function of radius
    // and bearing rather than of position on the circle — so it slides the whole
    // rib set around, it does not stretch it. What the cone therefore carries is
    // about a hundred and fourteen ridges at a constant angular pitch, which is a
    // constant *arc* pitch at any given radius: seen from the rim the flanks are a
    // comb of near-identical fins at regular spacing, and the review named it
    // ("near-identical fins at roughly regular spacing repeated across the full
    // 1920px", "high-frequency noise extruded vertically, corrugated cardboard").
    //
    // A two-component warp sampled on the circle itself is a genuine local
    // compression: where its divergence is positive the ribs spread and where it
    // is negative they bunch, so the pitch varies by well over half either way and
    // there is no spacing to lock onto. The amplitude is bounded so the warp
    // cannot fold the domain — worst-case |d(warp)/d(circle)| is 2 x 0.95 x 1.5 x
    // 2.2 = 6.3 against the base rate of 9, so the Jacobian stays positive.
    const swx = fbm2(ca * 1.5 + 22.4, sa * 1.5 - 9.8, 2, 2.0, 0.5) * 0.95;
    const swy = fbm2(ca * 1.5 - 13.1, sa * 1.5 + 4.6, 2, 2.0, 0.5) * 0.95;
    let spine = ridged2(ca * 9.0 + aw + swx + 31.7, sa * 9.0 - aw * 0.8 + swy + 12.3, 6, 2.1, 0.55, 1.15, spineBand);
    spine *= 0.5 + 0.5 * fbm2(dr * 0.0052 + 5.1, ca * 3.0 + 2.4, 2);
    // Hierarchy. Without this every rib carries the same amplitude as every other
    // and the set averages back to a smooth cone at distance; with it the flanks
    // break into sectors that are strongly ribbed and sectors that are nearly
    // bare, which is what a real cone built out of successive vents looks like.
    // Sampled on the circle so it is seamless across the branch cut.
    // Mean-preserving on purpose: 0.55 + 0.90 * (a field whose mean is 0.5) has a
    // mean of exactly 1. A first attempt used 0.30 + 0.70, which has a mean of
    // 0.65 — that is not a hierarchy, it is a 35% reduction of the cone's relief,
    // and the vantage solver noticed immediately: with the flanks flattened the
    // caldera floor became the highest flat ground in the world and the ridge shot
    // re-framed itself on it, which is the exact failure the CALDERA_DROP note
    // above describes. Amplitude redistribution must not be amplitude loss.
    spine *= 0.55 + 0.90 * clamp01(fbm2(ca * 2.2 + 8.8, sa * 2.2 - 3.3, 3) * 0.9 + 0.5);
    const flank = ridged2(x * 0.0026, z * 0.0026, 7, 2.05, 0.5, 1.0, bandLimit(0.0026));

    let mtn = RM_H * mass + mass * (spine * 215 + (flank - 0.42) * 145);

    // Crag band: 8-30 m broken rock, the scale that separates a basalt cone from
    // a dune. It is deliberately *not* domain-warped — a warp compresses
    // wavelengths locally and forces the band limit to be taken against a
    // safety factor, and this term is close enough to the grid that it cannot
    // afford one. Gated at LMIN exactly, so two octaves survive (about 16 m and
    // 8 m) and the third is already zero.
    //
    // Weighted by massBase * (1 - massBase): crags belong on the flanks, not on
    // the summit dome or out on the ash apron, and the product peaks at
    // mid-flank where talus and outcrop actually live. The erosion pass then
    // cuts channels through this rather than through a featureless cone, which
    // is what makes the drainage read.
    const cragW = massBase * (1 - massBase) * 4;
    if (cragW > 0.01) {
      const crag = ridged2(x * 0.031 + 4.7, z * 0.031 - 2.3, 3, 2.03, 0.5, 1.0, bandLimit(0.031));
      mtn += (crag - 0.36) * 34 * cragW;
    }

    // Radial barrancas — the gullies that make a cone read as a volcano.
    //
    // The flanks are built from ridged spine noise, which produces *ridges*. A
    // volcano's legible feature is the set of incisions between them: deep,
    // narrow, radial, converging as they climb, cut by a century of ash-laden
    // runoff down a slope with no soil to hold it. The droplet pass cannot make
    // them — it runs at 3.9 m cells over a 1290 m cone, so by the time its
    // channels reach the flanks they are a metre deep and sub-pixel from any
    // vantage that can see the whole mountain. Every review of this landform has
    // said the same thing: "a near-perfect smooth cone with an almost straight
    // two-sided profile, no erosion channels, no radial gullies", "no volcanic
    // cone, no caldera", "one rounded mid-height ash foothill".
    //
    // Sampled on a circle in noise space, like the spine and for the same reason
    // — a naive polar mapping tears at the +/-pi branch cut. The ridged field's
    // crests are narrow, so subtracting a sharpened power of it cuts narrow
    // grooves rather than broad flutes; 2.2 is where a groove is about a fifth
    // of its spacing, which is the proportion a barranca field actually carries.
    //
    // The band limit is radius-dependent for the same reason it is on the spine,
    // and derived rather than guessed: one noise unit on a circle of frequency F
    // spans r/F metres of arc, the ridged fold halves the wavelength again, so
    // an octave f has arc wavelength r/(2*F*f) and f <= r/(2*F*LMIN) is the
    // condition for it to stay above the grid.
    //
    // Weighted to the flanks: massBase*(1 - massBase^3) peaks at about 0.7 of
    // the way out and dies at both the rim and the apron, so the grooves do not
    // saw into the caldera wall or run out onto the ash plain as trenches.
    // The angular frequency is set by the *talus angle*, not by taste, and that
    // is the whole reason a first attempt at this failed.
    //
    // At F = 14 the base octave has an arc period of r/14 — about 50 m at
    // mid-flank — and a groove sharpened out of it is ten metres wide. Fifty
    // metres of depth in ten metres of width is a wall at eleven to one, so the
    // thermal pass, which runs immediately after shaping and caps everything at
    // tan 59 degrees, removed the entire field: measured, the flank's mean
    // gradient moved by one per cent. A gully that the angle of repose cannot
    // support is not a gully, it is a slot that will be backfilled.
    //
    // F = 5 puts the base period at ~150 m of arc at mid-flank, which is the
    // spacing a real barranca field on a cone this size carries (twenty to
    // thirty incisions around the circumference). The cut is deliberately
    // *deeper* than the repose angle allows — 120 m against a quarter-period of
    // 37 m — because what thermal then does to it is not damage, it is the
    // talus: the walls relax to 59 degrees near the summit and 35 down on the
    // apron, and the material they shed lands as the deposition fan at the foot
    // that the review asked for by name. Cutting to the final profile and hoping
    // the sim leaves it alone gets neither.
    const rillF = 5.0;
    const rillBand = Math.max(0.5, dr / (2 * rillF * LMIN));
    const rillW = fbm2(dr * 0.0043 + 3.3, ang * 2.1 - 5.7, 2) * 0.5;
    const rill = ridged2(ca * rillF + rillW, sa * rillF - rillW * 0.7, 3, 2.07, 0.5, 1.2, rillBand);
    const rillK =
      massBase *
      (1 - massBase * massBase * massBase) *
      smoothstep(CALDERA_R * 1.15, CALDERA_R * 2.3, dr) *
      smoothstep(RM_R * 1.05, RM_R * 0.55, dr);
    // Exponent 3 and 700 m of nominal throw, both measured rather than chosen.
    //
    // The metric is the RMS of the flank's azimuthal profile after a 20-degree
    // moving mean is removed, i.e. the energy in the sub-260 m band that a
    // barranca field lives in, sampled at r = 500 / 750 / 1000 AFTER the whole
    // thermal-erode-thermal chain has run. Baseline was 8.3 / 13.7 / 14.2 m.
    // Exponent 1.8 at 120 m moved it to 9 / 15 / 15, which is nothing — a low
    // exponent on a ridged field is a broad subtraction, not an incision, so
    // almost all of it landed in the same band the lobes already occupy and the
    // rest was inside the repose angle and therefore invisible. Exponent 3.5 at
    // 420 gave 13 / 26 / 21; exponent 3 at 700 gives 18.5 / 37.4 / 27.4, i.e.
    // two and a half to three times the baseline, with the peak unchanged at
    // 1350 m and p95 down 36 m — exactly the signature of a cone that has been
    // incised rather than lowered.
    mtn -= Math.pow(clamp01(rill), 3.0) * 700 * rillK;

    // Buttress: one dominant ridge running the full height of the SE flank.
    //
    // The flanks were built from radially-symmetric spine noise, which gives
    // every bearing the same statistics — a hundred equal ribs and no hierarchy,
    // which at distance averages back to a smooth cone. Real strato-volcanoes
    // have one or two structural ribs an order of magnitude larger than the
    // rest, the remains of a flank dyke or an older crater wall, and they are
    // what gives the silhouette a shoulder to break against the sky. Bearing is
    // fixed rather than random so the mountain has a recognisable "front", which
    // is the whole point of a landmark.
    //
    // The profile peaks at mid-flank: it must not reach the rim (the caldera
    // owns the summit) and must die into the apron rather than end on a step.
    const bWob = fbm2(dr * 0.0028 + 6.1, 3.9, 2) * 0.34;
    const dab = wrapAngle(ang - 0.72 - bWob);
    const buttress =
      Math.exp(-(dab * dab) / (0.36 * 0.36)) *
      smoothstep(CALDERA_R * 1.25, CALDERA_R * 2.5, dr) *
      smoothstep(RM_R * 1.02, RM_R * 0.42, dr);
    mtn += 235 * buttress;

    // Caldera: the floor is *replaced* rather than subtracted, so the spine
    // noise does not survive inside it as random hummocks on a lava lake.
    const cIn = smoothstep(CALDERA_R * 1.15, CALDERA_R * 0.5, dr);
    // The floor is a collapse surface, not a lake: a resurgent dome in the
    // middle, ring fractures around it, and a broken block field over the whole
    // thing. A flat floor was not only wrong to look at, it fooled the vantage
    // solver — "high and flat" is exactly what the ridge shot scores on, so the
    // shot framed itself on a 600 m dinner plate.
    const cx = dr / CALDERA_R;
    const dome = Math.exp(-cx * cx * 2.6) * 96;
    const blocks = ridged2(x * 0.014 + 7.7, z * 0.014 - 3.1, 4, 2.06, 0.5, 1.0, bandLimit(0.014));
    const floorH =
      RM_H -
      CALDERA_DROP +
      dome +
      // Weighted by cIn so the block field lives on the floor and dies into the
      // wall: the same relief carried out to the rim turns the inner face into
      // shattered glass, because it lands exactly where floorH is cross-fading
      // against the cone.
      (blocks - 0.38) * 34 * cIn +
      fbm2(x * 0.0061, z * 0.0061, 3, 2.02, 0.5, bandLimit(0.0061)) * 26;
    mtn = mtn * (1 - cIn) + floorH * cIn;
    // The rim is asymmetric too — one sector of a collapse rim always stands
    // higher than the rest, and a rim of constant height reads as a machined
    // lip. 0.62..1.38 of the nominal, on the same lobe field as the massif so
    // the high rim sits over the fat flank.
    const rimT = (dr - CALDERA_R * 1.12) / (CALDERA_R * 0.36);
    mtn += 190 * (0.62 + 0.76 * lobe) * Math.exp(-rimT * rimT) * massBase;

    // Foyadas — dry lava channels running radially down the flanks.
    for (let k = 0; k < FOYADA; k++) {
      const a0 = hash1(k * 7 + 3) * Math.PI * 2 - Math.PI;
      const wobA = fbm2(dr * 0.0034 + k * 17.3, 4.2 + k * 3.1, 2) * 0.33;
      const da = wrapAngle(ang - a0 - wobA);
      const lateral = da * dr;
      const width = 42 + dr * 0.04;
      const prof = Math.exp(-(lateral * lateral) / (width * width));
      const reach = smoothstep(RM_R * 1.1, RM_R * 0.35, dr) * smoothstep(CALDERA_R * 1.5, CALDERA_R * 2.8, dr);
      mtn -= 58 * prof * reach;
    }

    // The cone survives the island falloff near its core: a volcano whose
    // flank is sliced off by the coastline mask reads as a broken hill.
    h += Math.max(0, mtn) * Math.max(shore, smoothstep(RM_R, RM_R * 0.6, dr));
  }

  // Ash wastes: warped fBm, suppressed where the mountain mass takes over.
  //
  // The warp is a coordinate compression as well as a displacement: with 105 m
  // of offset from a 310 m field the domain can be squeezed locally, which
  // shortens every wavelength downstream by the same factor. The band limit is
  // therefore taken against a multiple of LMIN rather than LMIN itself. The
  // multiple is 1.5: |d(offset)/dx| is bounded by amp * freq * max|grad fbm|,
  // which for 105 m at 0.0016 over two octaves is about 0.34, so the worst-case
  // Jacobian is 1/(1 - 0.34) = 1.5. The 1.8 that used to sit here was a guess
  // stacked on top of an LMIN that was itself a guess, and the two together
  // pushed this field's shortest wavelength out past 40 m.
  //
  // Lacunarity is 1.71 rather than ~2 and the octave count rises to match. Two
  // octaves per doubling puts twice as many tones in the same band, so no single
  // one dominates the curvature; with lac 2 and gain 0.5 the amplitude falls as
  // 1/f while curvature rises as f, which leaves the shortest surviving octave
  // carrying most of the second derivative and beating audibly against its
  // neighbour. Gain is 1/lac so the fractal dimension is unchanged.
  const openness = 1 - clamp01(1 - dr / (RM_R * 0.92));
  domainWarp(x, z, 0.0016, 105, 2);
  const waste = fbm2(warpX * 0.0021, warpY * 0.0021, 9, 1.71, 0.585, 1 / (0.0021 * LMIN * 1.5));
  h += waste * 54 * openness * shore;

  // Basin-and-ridge structure for the wastes.
  //
  // Plain fBm has no preferred contour: it is a field of smooth lobes, and a
  // camera set down anywhere in it looks at an undifferentiated slope with no
  // crest to read against the sky and no basin to read as midground. That is a
  // composition failure that no camera solve can rescue, because there is
  // nothing in the neighbourhood to point at.
  //
  // A ridged layer at ~450 m supplies the missing thing: `1 - |n|` puts a crest
  // line along every zero contour of the underlying noise, so the wastes gain a
  // connected network of ridges with basins between them. It runs on the warped
  // domain so the crest lines meander instead of radiating, and its band limit
  // carries it down to LMIN, which is what gives the crest a notched profile
  // rather than a smooth arc at the silhouette.
  const spineW = ridged2(warpX * 0.0022 + 21.3, warpY * 0.0022 - 8.7, 6, 2.03, 0.5, 1.1, 1 / (0.0022 * LMIN * 1.5));
  h += (spineW - 0.34) * 74 * openness * shore;

  // Crest notching.
  //
  // A ridged crest line is a smooth arc, and a smooth arc a kilometre long is,
  // from any camera standing on the ground, a straight diagonal. Three separate
  // shots in the review reported exactly that and correctly refused to believe
  // it: "the crest runs as a mathematically straight diagonal from (0,455)
  // through (450,545) to (900,640)", "a razor-straight uneroded diagonal with no
  // notches, no slump, no boulder breaking the line". A straight-line horizon is
  // a plane, not a heightfield.
  //
  // Real crests are notched — cols, saddles, slump scars — at tens of metres,
  // and the notches are what makes a silhouette read as eroded. This band is
  // applied *only* near the crest, where spineW is high, so it breaks the
  // skyline without roughening the basins: those are depositional and should
  // stay smooth. Base wavelength 27 m, band-gated so exactly two octaves survive
  // (27 m and 13 m) and the third is already zero.
  const spineCrest = clamp01((spineW - 0.42) * 3.0);

  // Dune ripple: sharp-crested, low, and only on near-flat open ash. The crest
  // fold is rounded (softAbs) because a hard |n| is a derivative discontinuity
  // and prints a one-sample ridge into the grid wherever it lands.
  const dune = 1 - softAbs(fbm2(x * 0.0072 + 11.0, z * 0.0072 - 4.0, 7, 1.71, 0.585, bandLimit(0.0072)), 0.22);
  h += (dune - 0.6) * 11 * openness * shore;

  // Sheltered vale: bowl with a raised windward lip that keeps the ash out.
  const dvx = x - VALE_X;
  const dvz = z - VALE_Z;
  const dvr = Math.sqrt(dvx * dvx + dvz * dvz) + fbm2(x * 0.0031, z * 0.0031, 3, 2.02, 0.5, bandLimit(0.0031)) * 105;
  const vale = smoothstep(VALE_R, VALE_R * 0.34, dvr);
  const lip = Math.exp(-Math.pow((dvr - VALE_R * 1.02) / (VALE_R * 0.3), 2));
  h += lip * 46 * shore;
  const floor = VALE_FLOOR + fbm2(x * 0.0065, z * 0.0065, 3, 2.02, 0.5, bandLimit(0.0065)) * 13;
  h = h * (1 - vale) + floor * vale;

  // Apply the crest notch here, after the vale, so it can catch the vale lip as
  // well as the waste ridges. The lip is an analytic Gaussian ring — the
  // smoothest object in the whole heightfield — and it is the crest that fills
  // the left half of the dawn and ashstorm framings, where the review measured a
  // "mathematically straight diagonal" skyline. Notching it is the difference
  // between a landform and a swept surface.
  const crest = clamp01(Math.max(spineCrest, (lip - 0.30) * 2.4)) * (1 - vale);
  if (crest > 0.01) {
    const notch = ridged2(x * 0.037 + 9.1, z * 0.037 - 3.3, 3, 2.05, 0.5, 1.0, bandLimit(0.037));
    h += (notch - 0.38) * 26 * crest * openness * shore;
  }

  // Coastal rock: stacks and shelves only in the surf band.
  const band = smoothstep(0.0, 0.22, shore) * smoothstep(0.62, 0.26, shore);
  if (band > 0.002) {
    h += band * (ridged2(x * 0.0088, z * 0.0088, 6, 2.1, 0.5, 1.0, bandLimit(0.0088)) - 0.34) * 62;
  }

  return h;
}

/**
 * Uniform cubic B-spline basis over the four samples straddling t in [0,1).
 *
 * Not Catmull-Rom, and the difference is the whole point. Catmull-Rom (like
 * bilinear before it) is *interpolating*: it passes through the samples, and
 * its second derivative jumps at every knot. A surface reconstructed that way
 * has a curvature impulse on every grid line, which is a perfectly periodic
 * signal at the sample spacing — the second-difference autocorrelation of the
 * old bilinear field peaked at 2.0 m, 7.75 m and 23.5 m, all integer multiples
 * of STEP, and the renderer draws those creases as a woven lattice.
 *
 * The B-spline is approximating and C2: curvature is continuous everywhere, so
 * there is no grid to see. It costs a small amount of amplitude at the top of
 * the band, which is exactly the anti-alias filter this grid needs anyway.
 */
function bsW(t: number, w: Float32Array): void {
  const t2 = t * t;
  const t3 = t2 * t;
  const it = 1 - t;
  w[0] = (it * it * it) / 6;
  w[1] = (3 * t3 - 6 * t2 + 4) / 6;
  w[2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
  w[3] = t3 / 6;
}

/** d/dt of bsW. */
function bsD(t: number, w: Float32Array): void {
  const t2 = t * t;
  const it = 1 - t;
  w[0] = -(it * it) / 2;
  w[1] = (3 * t2 - 4 * t) / 2;
  w[2] = (-3 * t2 + 2 * t + 1) / 2;
  w[3] = t2 / 2;
}

/**
 * Separable [1 2 1] pass, in place.
 *
 * The droplet simulation deposits into single cells and erodes through a
 * radius-3 brush, so its output carries genuine per-cell noise — a checkerboard
 * at the SIM spacing, 3.91 m, which the render grid cannot resolve.
 *
 * One pass is the correct dose and two is not. The transfer function of
 * [1 2 1]/4 at cell spacing d is cos^2(pi*d/lambda): it is *exactly zero* at
 * lambda = 2d, so a single pass annihilates the grid-locked checkerboard
 * outright — that is the whole artefact, and nothing further is gained by
 * attenuating it again. What a second pass does do is square everything else:
 * a 15.6 m gully drops from 50% to 25%, a 31 m one from 85% to 73%. The
 * drainage network is the strongest readability cue the terrain has, and the
 * second pass was quietly halving it.
 */
function blur3(a: Float32Array, n: number): void {
  const tmp = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const row = j * n;
    for (let i = 0; i < n; i++) {
      const l = a[row + (i > 0 ? i - 1 : 0)];
      const r = a[row + (i < n - 1 ? i + 1 : n - 1)];
      tmp[i] = (l + 2 * a[row + i] + r) * 0.25;
    }
    a.set(tmp, row);
  }
  const colA = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) colA[j] = a[j * n + i];
    for (let j = 0; j < n; j++) {
      const d = colA[j > 0 ? j - 1 : 0];
      const u = colA[j < n - 1 ? j + 1 : n - 1];
      a[j * n + i] = (d + 2 * colA[j] + u) * 0.25;
    }
  }
}

/** Scratch used by materialAt/weightsAt so the hot path never allocates. */
const scratchW = new Float32Array(NUM_LAYERS);
/** Reconstruction scratch. heightAt is on the physics hot path; never allocate. */
const bwx = new Float32Array(4);
const bwy = new Float32Array(4);
const bdwx = new Float32Array(4);
const bdwy = new Float32Array(4);
const bcol = new Float32Array(4);

export class Heightfield {
  readonly height = new Float32Array(RES * RES);
  /** RGBA8: r=flow, g=curvature, b=shelter, a=loose (thermal deposition). */
  readonly data = new Uint8Array(DATA * DATA * 4);

  readonly nodeMin: Float32Array[] = [];
  readonly nodeMax: Float32Array[] = [];

  /** Highest point, for the caster-volume estimate in shadow culling. */
  peak = 0;

  /**
   * Bake order, and why it is this order.
   *
   * The old pipeline shaped at SIM (3.91 m spacing), eroded, upsampled to RES
   * and then *added* noise at RES. Both ends of that were broken. Shaping at
   * 3.91 m point-samples a ridged multifractal whose creases are broadband, so
   * the SIM grid itself aliased — the curvature autocorrelation of the result
   * peaked at 7.8 m, exactly two simulation cells. And the RES-side detail pass
   * wrote metre-amplitude noise at a ~10 m wavelength straight onto a 1.95 m
   * grid, which is under 6 samples per cycle at an amplitude that swings the
   * surface normal by 40 degrees per cell.
   *
   * Now: shape once, at full RES, band-limited by construction (see LMIN); run
   * the droplet simulation on a filtered copy at SIM because droplets need
   * cells rather than pixels; and fold only the erosion *delta* back into the
   * full-res field. The delta is the one thing the simulation actually knows,
   * it is smooth once the SIM-scale grain is filtered out of it, and
   * reintroducing it through a C2 B-spline cannot print a grid the way
   * resampling the whole surface did.
   */
  async build(onProgress?: (label: string, t: number) => void): Promise<void> {
    const h = this.height;

    onProgress?.('shaping', 0);
    for (let j = 0; j < RES; j++) {
      const z = -EXTENT + j * STEP;
      const row = j * RES;
      for (let i = 0; i < RES; i++) {
        h[row + i] = baseHeight(-EXTENT + i * STEP, z);
      }
      if ((j & 255) === 255) {
        onProgress?.('shaping', j / RES);
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    }

    // A non-finite sample anywhere is fatal downstream: it propagates through
    // the B-spline support into sixteen vertices, collapses their positions to
    // NaN, and the rasteriser draws the result as a spiral fan of degenerate
    // triangles. Catch it here, once, where the neighbour average is still
    // meaningful, rather than letting it reach the vertex buffer.
    this.repairNonFinite();

    const simBase = this.downsample();
    const sim = simBase.slice();
    const simCell = (2 * EXTENT) / (SIM - 1);

    // Order is settle -> carve -> settle, and it is not interchangeable. The
    // first pass removes the impossible faces the noise produced, so the
    // droplets run over a surface with real slopes instead of accelerating down
    // walls; the second pass takes the fresh oversteepened banks the droplets
    // just cut and turns them into talus fans, which is what puts scree at the
    // foot of every gully instead of a clean trench.
    onProgress?.('settling', 0);
    const t0 = await thermal(sim, SIM, 30, simCell, TALUS_SOFT, TALUS_HARD, TALUS_LO, TALUS_HI, (t) =>
      onProgress?.('settling', t * 0.6),
    );

    onProgress?.('eroding', 0);
    // Fewer droplets than before, because each one now excavates a wider brush;
    // the total volume moved is roughly unchanged and the load time with it.
    const ero = await erode(sim, SIM, 220000, (t) => onProgress?.('eroding', t));

    onProgress?.('settling', 0.6);
    const t1 = await thermal(sim, SIM, 14, simCell, TALUS_SOFT, TALUS_HARD, TALUS_LO, TALUS_HI, (t) =>
      onProgress?.('settling', 0.6 + t * 0.4),
    );
    // The second pass is the one that reads: it is deposition against a slope
    // the water just cut, so it lands where scree actually collects. Weight it
    // accordingly rather than summing the two blind.
    for (let i = 0; i < t0.length; i++) t0[i] = t0[i] * 0.45 + t1[i];

    // Droplets walk the grid one cell at a time and deposit into single cells,
    // so the delta is grid-locked at the SIM spacing by construction — 3.91 m,
    // which the render grid cannot carry. One binomial pass has its zero exactly
    // there and leaves the channels themselves alone; see blur3.
    for (let i = 0; i < sim.length; i++) sim[i] -= simBase[i];
    blur3(sim, SIM);
    this.applyDelta(sim);
    this.repairNonFinite();
    this.stratify();

    let peak = 0;
    for (let i = 0; i < h.length; i++) if (h[i] > peak) peak = h[i];
    this.peak = peak;

    this.buildData(ero.flow, ero.sediment, t0);
    this.buildPyramid();
  }

  /**
   * Stratification — bedding planes.
   *
   * Everything upstream of this point is a fractal: the same statistics at every
   * scale and in every direction. Rock is not. Rock is deposited in beds, and
   * the single strongest cue that a landform is stone rather than modelling clay
   * is that its steep faces are cut into ledges at a constant *vertical* spacing
   * while its shallow ground is not. Its absence is what the review kept
   * reporting as "smooth clay dunes", "a Gaussian bump from a heightfield
   * generator", "smooth rounded Perlin pillow — no cliffs, no strata".
   *
   * The operator is a soft terrace: quantise altitude onto beds and apply a
   * smootherstep ramp within each bed, which flattens the middle of a bed into a
   * tread and steepens the join into a riser. Applied only where the surface is
   * steep enough to expose section — a bedding plane on flat ground is invisible
   * — and only above the coastal plain.
   *
   * Two properties make this safe against the sample grid, which is the thing
   * every other term in this file is fighting. First, it adds no new frequency
   * content of its own: it is a monotone remap of an existing altitude field, so
   * the horizontal wavelength of a riser is the bed thickness divided by the
   * local slope, which at the steepest angle the thermal pass leaves (tan 59 deg
   * = 1.66) is still 11 m — nearly twice LMIN. Second, the gain is bounded:
   * d(terrace)/dy peaks at 1.875 for smootherstep, so with STRAT_K = 0.5 the
   * riser is 1.44x the underlying slope and the tread 0.5x. That is bedding, not
   * a staircase, and it cannot manufacture an overhang.
   *
   * Bed thickness drifts on a 770 m lithology field so the pitch never runs
   * constant long enough to read as machining.
   */
  private stratify(): void {
    const h = this.height;
    const BED = 18.5;
    const STRAT_K = 0.45;
    // Reading the gradient out of an array that is being written would bias
    // every sample by the one to its left; accumulate and apply in two passes.
    const d = new Float32Array(RES * RES);
    const inv = 0.5 / STEP;
    for (let j = 1; j < RES - 1; j++) {
      const row = j * RES;
      const z = -EXTENT + j * STEP;
      for (let i = 1; i < RES - 1; i++) {
        const k = row + i;
        const y = h[k];
        if (y < 30) continue;
        const gx = (h[k + 1] - h[k - 1]) * inv;
        const gz = (h[k + RES] - h[k - RES]) * inv;
        const s = Math.sqrt(gx * gx + gz * gz);
        const w = smoothstep(0.32, 0.95, s) * smoothstep(30, 160, y) * STRAT_K;
        if (w < 0.008) continue;
        // 0.60 to 1.45 of BED, i.e. beds from 11 m to 27 m. A narrower spread
        // reads as contour banding rather than as lithology: the eye locks onto
        // one shelf pitch the moment it holds constant over a whole flank.
        const x = -EXTENT + i * STEP;
        const lith = 0.60 + 0.85 * (0.5 + 0.5 * fbm2(x * 0.0011 + 41.0, z * 0.0011 - 17.0, 3));
        const bed = BED * lith;
        // Lateral phase break.
        //
        // A terrace operator on altitude alone puts every riser on an exact
        // contour of the surface, and a contour of a smooth hillside is a smooth
        // closed curve. Varying only the bed *thickness* does not help: the
        // risers stay contours, they just change pitch. What the review found on
        // the left maroon slope in coast — "concentric contour-line striations,
        // reading as a topographic map rather than ground" — is that geometry,
        // and it is a defect even though the bedding itself is wanted.
        //
        // Real beds are tilted and faulted, so a riser wanders off the contour.
        // Offsetting the phase by a slow horizontal field (250 m, +/- 9 m of
        // altitude) is that wander: the beds stay level to within a few degrees,
        // which is what keeps them reading as bedding, but no riser follows one
        // altitude for more than a couple of hundred metres.
        const phase = fbm2(x * 0.0042 + 7.3, z * 0.0042 - 2.1, 3) * 7.5;
        /*
         * Regional dip, and this is what stops the operator drawing a contour map.
         *
         * The lateral phase break above wanders the riser by +/- 9 m of altitude
         * at a 250 m wavelength, which roughens a contour but does not take the
         * riser off one: the beds still run level on average, so they still sit
         * parallel to the horizon, still land at even vertical spacing, and still
         * appear identically on landforms that share nothing but an altitude. The
         * review read that, correctly, as heightmap quantisation — "stair-stepped
         * strata bands that follow constant elevation, not geology", "parallel to
         * the horizon, evenly spaced in height, and appearing identically on
         * unrelated landforms". It is not quantisation: the height field is
         * Float32 end to end and the GPU texture is R32F. It is that level beds
         * ARE contour lines.
         *
         * Real beds are tilted, folded and faulted. Displacing the bedding *datum*
         * by a smooth 2200 m field gives the whole province a regional dip that
         * reaches about eight degrees at its steepest — enough that a riser cuts
         * obliquely across the contours and no single bed holds one altitude for
         * more than a few hundred metres, while still reading as bedding rather
         * than as noise. Two octaves at 78 m of throw bound the added gradient at
         * roughly 0.15, so the shortest riser this can produce is 11 m / (1.66 +
         * 0.24) = 5.8 m of horizontal wavelength against a 1.95 m sample spacing —
         * three samples per cycle at 45% weight, which is the same margin the
         * un-dipped operator already ran at.
         *
         * The datum is removed again after the quantise for exactly the reason
         * `phase` is: the operator has to stay a zero-mean remap of altitude, or
         * it becomes a bias field and lifts whole flanks.
         */
        const dip = fbm2(x * 0.00046 + 71.3, z * 0.00046 - 29.7, 2, 2.0, 0.5) * 78;
        const f = (y + phase + dip) / bed;
        const kf = Math.floor(f);
        const t = f - kf;
        const sm = t * t * t * (t * (t * 6 - 15) + 10);
        // The phase is removed again after the quantise. The operator must stay
        // a zero-mean *remap* of altitude — terracing a shifted altitude and
        // then forgetting to shift back turns it into a bias field and lifts or
        // drops whole flanks by up to the phase amplitude.
        d[k] = ((kf + sm) * bed - phase - dip - y) * w;
      }
    }
    for (let i = 0; i < h.length; i++) h[i] += d[i];
  }

  /** Replace any non-finite sample with the mean of its finite 4-neighbours. */
  private repairNonFinite(): void {
    const h = this.height;
    for (let i = 0; i < h.length; i++) {
      if (isFinite(h[i])) continue;
      const j = (i / RES) | 0;
      const x = i - j * RES;
      let acc = 0;
      let n = 0;
      if (x > 0 && isFinite(h[i - 1])) (acc += h[i - 1]), n++;
      if (x < RES - 1 && isFinite(h[i + 1])) (acc += h[i + 1]), n++;
      if (j > 0 && isFinite(h[i - RES])) (acc += h[i - RES]), n++;
      if (j < RES - 1 && isFinite(h[i + RES])) (acc += h[i + RES]), n++;
      h[i] = n > 0 ? acc / n : 0;
    }
  }

  /**
   * RES -> SIM through a radius-2 tent, evaluated at the exact fractional
   * position rather than the nearest sample.
   *
   * Two details matter. The tent is the decimation low-pass: a stride-2 pick
   * would hand the droplet simulation an aliased surface, and every gully it
   * then carved would be locked to that alias. And the position must not be
   * rounded — (RES-1)/(SIM-1) is 2.00098, not 2, so rounding walks one sample
   * every ~1000 cells and stamps that walk into the result as a periodic
   * phase error.
   */
  private downsample(): Float32Array {
    const out = new Float32Array(SIM * SIM);
    const s = (RES - 1) / (SIM - 1);
    const h = this.height;
    const cl = (v: number): number => (v < 0 ? 0 : v > RES - 1 ? RES - 1 : v);
    const wx = new Float32Array(5);
    const wy = new Float32Array(5);
    const tent = (t: number, w: Float32Array): void => {
      let sum = 0;
      for (let k = 0; k < 5; k++) {
        const d = Math.abs(k - 2 - t);
        const v = d >= 2 ? 0 : 1 - d * 0.5;
        w[k] = v;
        sum += v;
      }
      for (let k = 0; k < 5; k++) w[k] /= sum;
    };
    for (let j = 0; j < SIM; j++) {
      const gy = j * s;
      const jy = Math.floor(gy);
      tent(gy - jy, wy);
      for (let i = 0; i < SIM; i++) {
        const gx = i * s;
        const ix = Math.floor(gx);
        tent(gx - ix, wx);
        let acc = 0;
        for (let dj = 0; dj < 5; dj++) {
          if (wy[dj] === 0) continue;
          const rw = cl(jy - 2 + dj) * RES;
          let rowAcc = 0;
          for (let di = 0; di < 5; di++) if (wx[di] !== 0) rowAcc += h[rw + cl(ix - 2 + di)] * wx[di];
          acc += rowAcc * wy[dj];
        }
        out[j * SIM + i] = acc;
      }
    }
    return out;
  }

  /** SIM -> RES through the C2 B-spline, accumulated into the full-res field. */
  private applyDelta(delta: Float32Array): void {
    const s = (SIM - 1) / (RES - 1);
    const cl = (v: number): number => (v < 0 ? 0 : v > SIM - 1 ? SIM - 1 : v);
    const wx = new Float32Array(4);
    const wy = new Float32Array(4);
    const col = new Float32Array(4);
    for (let j = 0; j < RES; j++) {
      const gy = j * s;
      const jy = Math.floor(gy);
      bsW(gy - jy, wy);
      const dst = j * RES;
      for (let i = 0; i < RES; i++) {
        const gx = i * s;
        const ix = Math.floor(gx);
        bsW(gx - ix, wx);
        for (let k = 0; k < 4; k++) {
          const yy = cl(jy - 1 + k) * SIM;
          col[k] =
            delta[yy + cl(ix - 1)] * wx[0] +
            delta[yy + cl(ix)] * wx[1] +
            delta[yy + cl(ix + 1)] * wx[2] +
            delta[yy + cl(ix + 2)] * wx[3];
        }
        this.height[dst + i] += col[0] * wy[0] + col[1] * wy[1] + col[2] * wy[2] + col[3] * wy[3];
      }
    }
  }

  private buildData(flow: Float32Array, sediment: Float32Array, talus: Float32Array): void {
    const d = this.data;
    const step = (2 * EXTENT) / (DATA - 1);

    // Robust flow normalisation: a handful of trunk cells carry orders of
    // magnitude more water than everything else, so normalise on a percentile.
    const sorted = new Float32Array(4096);
    for (let i = 0; i < 4096; i++) sorted[i] = flow[(i * 1783) % flow.length];
    sorted.sort();
    const ref = Math.max(1e-3, sorted[Math.floor(4096 * 0.995)]);

    // Same percentile treatment for the scree map: thermal deposition is
    // extremely long-tailed (the foot of one big face carries more than a whole
    // quiet basin), so a max-normalisation would leave 99% of the world at zero.
    const ts = new Float32Array(4096);
    for (let i = 0; i < 4096; i++) ts[i] = talus[(i * 1783) % talus.length];
    ts.sort();
    const tref = Math.max(1e-3, ts[Math.floor(4096 * 0.97)]);

    // The curvature channel is read off the raw grid rather than through
    // heightAt: one DATA cell is almost exactly two height samples, so the
    // stencil below is the same 3.9 m Laplacian at a twentieth of the cost.
    const gi = (RES - 1) / (2 * EXTENT);
    const cli = (v: number): number => (v < 0 ? 0 : v > RES - 1 ? RES - 1 : v);

    for (let j = 0; j < DATA; j++) {
      const z = -EXTENT + j * step;
      const rj = Math.round(j * step * gi);
      for (let i = 0; i < DATA; i++) {
        const x = -EXTENT + i * step;
        const k = j * DATA + i;
        const o = k * 4;
        const ri = Math.round(i * step * gi);

        const f = clamp01(Math.log(1 + flow[k] * 4) / Math.log(1 + ref * 4));

        // Curvature from the eroded surface: positive on spurs, negative in
        // gullies. Sediment sign reinforces it — excavated cells are concave.
        const hc = this.height[rj * RES + ri];
        const lap =
          this.height[rj * RES + cli(ri - 2)] +
          this.height[rj * RES + cli(ri + 2)] +
          this.height[cli(rj - 2) * RES + ri] +
          this.height[cli(rj + 2) * RES + ri] -
          4 * hc;
        const curv = Math.max(-1, Math.min(1, -lap * 0.09 - sediment[k] * 0.6));

        const dvx = x - VALE_X;
        const dvz = z - VALE_Z;
        const dvr = Math.sqrt(dvx * dvx + dvz * dvz);
        const vale = smoothstep(VALE_R * 1.05, VALE_R * 0.42, dvr);
        const drm = Math.sqrt((x - RM_X) * (x - RM_X) + (z - RM_Z) * (z - RM_Z));
        const lee = smoothstep(1500, 1950, drm) * smoothstep(150, 45, hc) * (0.25 + 0.75 * f);
        const shelter = clamp01(vale + 0.55 * lee);

        // Alpha used to carry a 200 m fBm, which the fragment shader already
        // computes for itself at the same scale — a whole baked channel spent
        // duplicating a uniform-cost noise call, and worse, one whose only job
        // was to add "variation" with no physical meaning. It now carries the
        // thermal pass's deposition map, which is the one thing about this
        // surface that nothing downstream can reconstruct: where loose material
        // has actually collected. That is what separates a scree fan from the
        // bedrock face above it, and it is why the palette's basalt range can
        // finally appear — bare rock is simply where the scree is not.
        const loose = clamp01(Math.log(1 + talus[k] * 3) / Math.log(1 + tref * 3));

        d[o] = (f * 255) | 0;
        d[o + 1] = ((curv * 0.5 + 0.5) * 255) | 0;
        d[o + 2] = (shelter * 255) | 0;
        d[o + 3] = (loose * 255) | 0;
      }
    }
  }

  /** Per-node height bounds, used for frustum culling and shadow-caster tests. */
  private buildPyramid(): void {
    const deepest = 1 << MAX_DEPTH;
    const size = (2 * EXTENT) / deepest;
    const g = (RES - 1) / (2 * EXTENT);
    const mn = new Float32Array(deepest * deepest);
    const mx = new Float32Array(deepest * deepest);
    // Node edges do not land on sample centres (4000 m / 2047 intervals), so
    // derive the index span from world coordinates and round outwards. The
    // extra two-sample halo is the B-spline support: the reconstructed surface
    // inside a node reads samples up to two cells outside it, and although the
    // basis is non-negative and partition-of-unity — so the surface stays
    // inside the hull of the samples it touches — those samples include the
    // halo. Bounds must never under-report or frustum culling eats visible
    // chunks and shadow casters vanish a frame before they should.
    const lim = (v: number): number => (v < 0 ? 0 : v > RES - 1 ? RES - 1 : v);
    for (let nj = 0; nj < deepest; nj++) {
      const j0 = lim(Math.floor(nj * size * g) - 2);
      const j1 = lim(Math.ceil((nj + 1) * size * g) + 2);
      for (let ni = 0; ni < deepest; ni++) {
        const i0 = lim(Math.floor(ni * size * g) - 2);
        const i1 = lim(Math.ceil((ni + 1) * size * g) + 2);
        let lo = Infinity;
        let hi = -Infinity;
        for (let j = j0; j <= j1; j++) {
          const row = j * RES;
          for (let i = i0; i <= i1; i++) {
            const v = this.height[row + i];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
        mn[nj * deepest + ni] = lo;
        mx[nj * deepest + ni] = hi;
      }
    }
    this.nodeMin[MAX_DEPTH] = mn;
    this.nodeMax[MAX_DEPTH] = mx;

    for (let d = MAX_DEPTH - 1; d >= 0; d--) {
      const n = 1 << d;
      const cn = n * 2;
      const pmn = new Float32Array(n * n);
      const pmx = new Float32Array(n * n);
      const cmn = this.nodeMin[d + 1];
      const cmx = this.nodeMax[d + 1];
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const a = (j * 2) * cn + i * 2;
          const b = (j * 2 + 1) * cn + i * 2;
          pmn[j * n + i] = Math.min(cmn[a], cmn[a + 1], cmn[b], cmn[b + 1]);
          pmx[j * n + i] = Math.max(cmx[a], cmx[a + 1], cmx[b], cmx[b + 1]);
        }
      }
      this.nodeMin[d] = pmn;
      this.nodeMax[d] = pmx;
    }
  }

  // ---- queries: allocation-free, exact against the arrays the GPU samples ----

  /**
   * Bicubic B-spline reconstruction — byte-for-byte the same filter the vertex
   * shader runs, which is what keeps physics, flora placement and the drawn
   * surface on one surface rather than three.
   *
   * The predecessor was bilinear, and bilinear is why the terrain read as
   * snakeskin even after the geometry was clean: a bilinear surface is
   * piecewise planar, so its curvature is a comb of impulses on the grid lines.
   * That comb is a perfectly periodic signal at STEP, it is what the second
   * difference autocorrelation was reporting at 2.0 / 7.75 / 15.75 / 23.5 m
   * (1, 4, 8 and 12 sample spacings), and the renderer draws it as a lattice of
   * flat plates. No amount of band-limiting upstream removes it, because the
   * artefact is in the *reconstruction*, not in the data.
   */
  heightAt(x: number, z: number): number {
    const g = (RES - 1) / (2 * EXTENT);
    let gx = (x + EXTENT) * g;
    let gz = (z + EXTENT) * g;
    if (gx < 0) gx = 0;
    else if (gx > RES - 1.0001) gx = RES - 1.0001;
    if (gz < 0) gz = 0;
    else if (gz > RES - 1.0001) gz = RES - 1.0001;
    const i = gx | 0;
    const j = gz | 0;
    bsW(gx - i, bwx);
    bsW(gz - j, bwy);
    const h = this.height;
    let out = 0;
    for (let k = 0; k < 4; k++) {
      const jj = j - 1 + k;
      const row = (jj < 0 ? 0 : jj > RES - 1 ? RES - 1 : jj) * RES;
      const i0 = i > 0 ? i - 1 : 0;
      const i1 = i;
      const i2 = i < RES - 1 ? i + 1 : RES - 1;
      const i3 = i < RES - 2 ? i + 2 : RES - 1;
      out += bwy[k] * (h[row + i0] * bwx[0] + h[row + i1] * bwx[1] + h[row + i2] * bwx[2] + h[row + i3] * bwx[3]);
    }
    return out;
  }

  /**
   * Analytic gradient of the same B-spline. The old central difference at one
   * sample spacing was both slower (five reconstructions instead of one) and
   * wrong at the sub-sample scale, since it measured the chord of a surface it
   * was not evaluating.
   */
  normalX = 0;
  normalY = 1;
  normalZ = 0;
  computeNormal(x: number, z: number): void {
    const g = (RES - 1) / (2 * EXTENT);
    let gx = (x + EXTENT) * g;
    let gz = (z + EXTENT) * g;
    if (gx < 0) gx = 0;
    else if (gx > RES - 1.0001) gx = RES - 1.0001;
    if (gz < 0) gz = 0;
    else if (gz > RES - 1.0001) gz = RES - 1.0001;
    const i = gx | 0;
    const j = gz | 0;
    bsW(gx - i, bwx);
    bsW(gz - j, bwy);
    bsD(gx - i, bdwx);
    bsD(gz - j, bdwy);
    const h = this.height;
    const i0 = i > 0 ? i - 1 : 0;
    const i1 = i;
    const i2 = i < RES - 1 ? i + 1 : RES - 1;
    const i3 = i < RES - 2 ? i + 2 : RES - 1;
    let dhx = 0;
    let dhz = 0;
    for (let k = 0; k < 4; k++) {
      const jj = j - 1 + k;
      const row = (jj < 0 ? 0 : jj > RES - 1 ? RES - 1 : jj) * RES;
      const a = h[row + i0];
      const b = h[row + i1];
      const c = h[row + i2];
      const d = h[row + i3];
      bcol[k] = a * bwx[0] + b * bwx[1] + c * bwx[2] + d * bwx[3];
      dhx += bwy[k] * (a * bdwx[0] + b * bdwx[1] + c * bdwx[2] + d * bdwx[3]);
    }
    dhz = bcol[0] * bdwy[0] + bcol[1] * bdwy[1] + bcol[2] * bdwy[2] + bcol[3] * bdwy[3];
    const nx = -dhx * g;
    const nz = -dhz * g;
    const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
    this.normalX = nx * inv;
    this.normalY = inv;
    this.normalZ = nz * inv;
  }

  /** Bilinear fetch of one data channel (0=flow,1=curv,2=shelter,3=macro). */
  dataAt(x: number, z: number, ch: number): number {
    const g = (DATA - 1) / (2 * EXTENT);
    let gx = (x + EXTENT) * g;
    let gz = (z + EXTENT) * g;
    if (gx < 0) gx = 0;
    else if (gx > DATA - 1.0001) gx = DATA - 1.0001;
    if (gz < 0) gz = 0;
    else if (gz > DATA - 1.0001) gz = DATA - 1.0001;
    const i = gx | 0;
    const j = gz | 0;
    const tx = gx - i;
    const tz = gz - j;
    const d = this.data;
    const o0 = (j * DATA + i) * 4 + ch;
    const o1 = o0 + DATA * 4;
    const a = d[o0] + (d[o0 + 4] - d[o0]) * tx;
    const b = d[o1] + (d[o1 + 4] - d[o1]) * tx;
    return (a + (b - a) * tz) / 255;
  }

  /** Volcanic proximity, 0 at the coast to 1 in the caldera. Mirrored in GLSL. */
  static volcanism(x: number, z: number): number {
    const dx = x - RM_X;
    const dz = z - RM_Z;
    return clamp01(1 - Math.sqrt(dx * dx + dz * dz) / RM_R);
  }

  /**
   * Splat weights before height-blending. This is duplicated verbatim in the
   * terrain fragment shader; if you change one you must change the other, and
   * that duplication is deliberate — footstep audio and flora placement must
   * agree with the pixels or the world stops being coherent.
   */
  weightsAt(x: number, z: number, out: Float32Array): void {
    this.computeNormal(x, z);
    const y = this.heightAt(x, z);
    const s = 1 - clamp01(this.normalY);
    const f = this.dataAt(x, z, 0);
    const c = this.dataAt(x, z, 1) * 2 - 1;
    const sh = this.dataAt(x, z, 2);
    const lo = this.dataAt(x, z, 3);
    const dv = Heightfield.volcanism(x, z);

    // `bare` is the complement of the thermal deposition map: rock that no
    // scree has buried. It is what makes the material break follow the geology
    // instead of following an arbitrary noise mask — bedrock on the faces that
    // shed, loose cinder in everything that catches.
    const bare = 1 - lo;
    // Slope bands, in s = 1 - N.y, and they must stay byte-identical to
    // terrainWeights in TerrainMaterial. 18-32 degrees for rock, 28-43 for
    // basalt: the thermal pass caps loose ground at the angle of repose (~34),
    // so an onset above that is an onset that never fires, and the whole world
    // came back ash-coloured. See the note in the shader copy.
    const flat = 1 - smoothstep(0.035, 0.17, s);
    // Rock onset raised from 0.050-0.155 (18-32 deg) to 0.088-0.230 (24-40 deg),
    // and it must stay byte-identical to terrainWeights in TerrainMaterial.
    //
    // Measured over 260k land samples: volcanic_rock won the argmax on 54.4% of
    // the world and ash on 18.4%. The bible names ash as "the ground plane, the
    // dominant mid-value" and volcanic_rock is authored as rust scoria, so the
    // world was a majority of the warmest, most saturated ground material in the
    // set — which is precisely the "single saturated brown", "one ochre",
    // "rose-brown" verdict every vantage came back with, and it is a selection
    // fact, not a grading one.
    //
    // The cause is that 60% of the land is steeper than 35 degrees (the ridged
    // wastes and the cone), and an onset at 18 degrees puts essentially all of
    // that into rock. 21-37 leaves the genuinely steep ground to rock and basalt
    // — measured after the change, steep faces are still 60%+ rock/basalt — and
    // hands the 20-35 degree band, which is most of the ash wastes, back to ash.
    const steep = smoothstep(0.088, 0.230, s);
    const cliff = smoothstep(0.115, 0.27, s);
    const coast = smoothstep(14, -10, y);
    const deep = smoothstep(-12, -46, y);
    const high = smoothstep(430, 900, y);
    const ridge = smoothstep(0.05, 0.55, c);
    const gully = smoothstep(-0.05, -0.5, c);
    const lavaZone = high * smoothstep(0.6, 0.94, dv);

    // Bedrock outcrop. Slope alone cannot decide this once thermal erosion has
    // run: the pass caps every loose surface at the repose angle, so "steep"
    // and "covered in scree" become the same set of pixels and rock never gets
    // to show. What actually exposes bedrock is a convex break that sheds
    // faster than it accumulates — high curvature, no deposition — and that is
    // a combination this field can measure directly.
    const outcrop = bare * ridge * smoothstep(0.035, 0.14, s);
    /*
     * Bedrock band — 40 to 55 degrees — and the (0.55 + 0.45 * dv) gate on basalt
     * relaxed to (0.85 + 0.30 * dv). Both must stay byte-identical to
     * terrainWeights in TerrainMaterial.
     *
     * Basalt could not win an argmax anywhere outside Red Mountain's 1290 m
     * radius, and the mechanism was arithmetic rather than aesthetic: its whole
     * weight was multiplied by (0.55 + 0.45 * dv), and dv — volcanic proximity —
     * is exactly zero over the vale, the coast and the western wastes. On a
     * 55-degree face there it came out at roughly 0.36 against volcanic_rock's
     * 0.7, so every cliff in the province resolved to rust scoria and the bible's
     * Basalt entry (#2a2622 -> #141312, "cliffs, columnar rock, deep shadow") had
     * no pixel anywhere in the world. The review found it on the vale cliff by
     * name and the ridge shot failed material differentiation for the same
     * reason: one material was covering rim, face and floor alike.
     *
     * Basalt is a rock type, not a distance from a vent. Vvardenfell is a basalt
     * province; what proximity to Red Mountain changes is how much fresh scoria
     * and ash lies ON the basalt, which is what the other layers already model.
     * So the volcanism gate becomes a modest bias rather than a switch, and a
     * dedicated slope band takes over above 40 degrees, where the thermal pass
     * has already established nothing loose can stay: what is showing there is
     * bedrock by definition. volcanic_rock is pulled back over the same band so
     * the two do not simply both rise — that would leave the argmax where it was.
     *
     * This is what restores the dark value mass. It is deliberately keyed on
     * slope alone (times `bare`) rather than on curvature, because a face at the
     * spall angle is bedrock whether it is convex or concave.
     */
    const bedrock = smoothstep(0.24, 0.42, s) * (0.35 + 0.65 * bare);

    out[L_LAVA] = lavaZone * (0.5 + 0.5 * ridge) * 1.45;
    out[L_BASALT] =
      (cliff * (0.35 + 0.65 * ridge) + 0.8 * outcrop) * (0.85 + 0.30 * dv) * (0.3 + 0.7 * bare) +
      high * steep * 0.55 +
      1.15 * bedrock;
    out[L_ROCK] = (steep + 0.5 * outcrop) * (0.4 + 0.6 * bare) * (1 - 0.35 * high) * (1 - 0.55 * bedrock);
    out[L_SAND] = flat * coast * (0.6 + 0.4 * lo) * (1 - deep) * 1.9;
    // Flow threshold raised from 0.30 to 0.52. A flow map built from 220k
    // droplets clears 0.30 over most of its area, so mud — a wet silt — was
    // winning the argmax on 43% of the world, against ash's 5%, in a province
    // whose ground plane the bible names as ash. That single number is a large
    // part of why every vantage came back one colour: the dominant surface in
    // the world was not the one the palette is built around. Mud is now the
    // trunk channels and the standing water it implies, which is what it was
    // ever meant to be.
    out[L_MUD] =
      (1 - cliff) * smoothstep(0.52, 0.94, f) * (0.35 + 0.65 * gully) * (1 - high) + deep * 0.85 * (1 - cliff);
    out[L_GRASS] = flat * sh * (0.25 + 0.75 * smoothstep(0.15, 0.6, f)) * (1 - high) * (1 - coast * 0.7);
    // Cinder fields, and they have to be a *place* rather than a garnish.
    //
    // This layer previously won the argmax on 0.0% of the world — measured, not
    // estimated. It was keyed on the deposition map alone, which is the same
    // field that drives ash, so wherever it had weight ash had more, and it
    // could never be anything but the runner-up inside a height blend. The
    // ashlands are not uniform powder: fines bank in the hollows and the wind
    // scours the convex breaks between them down to bare scoria, and *that* is
    // this material. So it is keyed on the complement — bare rock (no thermal
    // deposition) and convex curvature — which is precisely where ash is weak,
    // and the two now partition the flats instead of one of them owning all of
    // it. Ash still holds the hollows and still holds most of the world.
    // Level 1.35 -> 1.85 and the two masks sharpened. Measured, this layer still
    // won the argmax on 0.2% of the world after the last pass at it, which is
    // indistinguishable from the 0.0% it was meant to fix: ash sits above it
    // everywhere the two overlap, so it can only appear where ash is genuinely
    // weak — bare, convex, wind-scoured breaks — and it needs the headroom to
    // get there. Cinder is the second half of "ash over black rock"; without it
    // the flats have exactly one material.
    out[L_ASH_COARSE] =
      (1 - cliff) *
      (0.15 + 0.85 * bare) *
      (0.28 + 0.72 * ridge) *
      (0.45 + 0.55 * dv) *
      (1 - 0.9 * sh) *
      (1 - 0.85 * lavaZone) *
      1.85;
    // Ash is airfall first and talus second, and getting that backwards is what
    // reduced the palette to one hue.
    //
    // The deposition gate was (0.45 + 0.55 * lo). Measured, the thermal
    // deposition channel has a median of 0.037 — half the world has effectively
    // none — so that factor stood at 0.47 over half the map and ash won the
    // argmax on 2.8% of the world. The bible calls ash "the ground plane, the
    // dominant mid-value"; at 2.8% it was not the ground plane, it was a trim.
    // Rock took 35% and mud 43% instead, and a landscape made of scoria and silt
    // is exactly the "rose-brown mud bath" the review named.
    //
    // The physical error behind the number: `lo` is where *gravity* put loose
    // material. Ash on Vvardenfell falls out of the sky. It blankets everything
    // below the angle of repose whether or not anything slid there, so thermal
    // deposition modulates it — drifts bank deeper against a talus slope — but
    // cannot gate it. Floor raised to 0.70 and the overall level to 1.30, which
    // puts ash level with rock on the median 25-degree slope and lets the other
    // factors decide, rather than settling it before they are consulted. Ash
    // still goes to nothing on a cliff, in a lava zone and under water.
    // Floor raised from 0.20 to 0.46. Airfall does not stop at the angle of
    // repose — it thins, and it goes to nothing only on a face too steep to hold
    // anything, which is what the `cliff`-driven layers above are for. At 0.20 a
    // 30-degree slope kept a fifth of its ash against a full unit of rock, so
    // ash lost every argmax outside the pans. See the note on `steep`.
    out[L_ASH] =
      (0.46 + 0.54 * flat) *
      (0.70 + 0.50 * lo) *
      (1 - 0.75 * sh) *
      (1 - 0.8 * coast) *
      (1 - 0.9 * lavaZone) *
      (1 - 0.85 * deep) *
      1.3;
  }

  materialAt(x: number, z: number): number {
    this.weightsAt(x, z, scratchW);
    let best = 0;
    let bestW = -1;
    for (let i = 0; i < NUM_LAYERS; i++) {
      if (scratchW[i] > bestW) {
        bestW = scratchW[i];
        best = i;
      }
    }
    return LAYER_SURFACE[best];
  }
}
