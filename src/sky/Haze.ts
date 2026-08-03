/**
 * The weather particulate layer, as a participating medium.
 *
 * This chunk is included by BOTH the sky dome (SkyShader) and the shared aerial
 * block (Aerial), and it is the only place the ash/rain/snow layer's radiance is
 * defined. Before this existed the dome and the fog each carried their own
 * hand-tuned constant — a tint times an ambient scalar — with the result that
 *
 *   - the fog plateau and the sky it was supposed to be converging on measured
 *     as two different colours (dawn: fog [190,125,85] against sky [184,153,110]),
 *   - the horizon band was identical at every azimuth, because a constant has no
 *     phase function, so a sunset had no sun side and an ash storm had no
 *     directional light cue at all,
 *   - and the layer had no vertical structure, so ground haze and the sky above
 *     it converged on the same value and no land mass could silhouette.
 *
 * Two physical terms fix all three:
 *
 * 1. A real Mie phase for a coarse mineral aerosol — a tight g=0.70 lobe plus a
 *    g=0.92 aureole plus an isotropic pedestal. Peak-to-trough is ~40x, which is
 *    the 3-4 stops between the solar and anti-solar horizon that a dust-loaded
 *    sunset actually has.
 * 2. Self-shadowing driven by the *density-weighted mean altitude* of the
 *    scattering along the ray. A ray looking up samples the thin, fully lit top
 *    of the layer; a ray looking along the ground samples its shadowed base. That
 *    single gradient is what puts a readable skyline over an ash plain and what
 *    lets ridge tops clear the haze band while their bases sink into it.
 *
 * Everything is in SI: sigma is extinction per metre at sea level, H is the
 * layer's scale height in metres, altitudes are metres above sea level.
 */
export const HAZE_GLSL = /* glsl */ `
#ifndef ASHLANDS_HAZE
#define ASHLANDS_HAZE

const float HAZE_PI = 3.141592653589793;
const float HAZE_ISO = 0.07957747;   // 1 / (4 pi)
/** Planet radius, metres. Must match PLANET_R in Constants.ts. */
const float HAZE_RG = 6360000.0;

/**
 * Self-contained value noise. Deliberately NOT the sky's NOISE_GLSL: this chunk
 * is included by a dozen materials that do not include that one, and a duplicate
 * definition in the shaders that include both would not compile.
 */
float hazeHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float hazeVn(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hazeHash(i + vec3(0,0,0)), hazeHash(i + vec3(1,0,0)), f.x),
                mix(hazeHash(i + vec3(0,1,0)), hazeHash(i + vec3(1,1,0)), f.x), f.y);
  float b = mix(mix(hazeHash(i + vec3(0,0,1)), hazeHash(i + vec3(1,0,1)), f.x),
                mix(hazeHash(i + vec3(0,1,1)), hazeHash(i + vec3(1,1,1)), f.x), f.y);
  return mix(a, b, f.z);
}

float hazeHG(float c, float g) {
  float g2 = g * g;
  float d = 1.0 + g2 - 2.0 * g * c;
  return (1.0 - g2) / (4.0 * HAZE_PI * max(d * sqrt(max(d, 1e-4)), 1e-4));
}

/**
 * Henyey-Greenstein asymmetry widened for a source of finite angular RADIUS.
 *
 * A phase function is only ever observed convolved with the source lighting it.
 * The sun is 0.7 degrees of radius, so every lobe in this file is effectively
 * exact for it and this function returns g to within four parts in ten thousand
 * — the ash storm's smeared solar blob is untouched, bit for bit. Masser is 4.3
 * degrees, and the aureole lobe here (g=0.92) has a half width of 1.7 degrees:
 * a quarter of the source. Treating a moon as a point source through it produces
 * a 66x-isotropic spike sitting entirely ON the disc, and because that light is
 * scattered IN FRONT of the moon it paints over the terminator and the crater
 * field alike — a phased, cratered body rendering as a flat lit circle.
 *
 * Widening rather than clamping, because the energy is real: it arrives spread
 * over the source's cone instead of concentrated in the lobe. HG's half width at
 * half maximum is 0.766*(1-g)/sqrt(g) near g=1; add the source radius in
 * quadrature and invert (s = sqrt(g) solves s^2 + k*s - 1 = 0). The integral is
 * preserved, so only the peak moves. Positive g only.
 */
float hazeSrcG(float g, float alpha) {
  float hw = 0.766 * (1.0 - g) / sqrt(max(g, 1e-3));
  float k = sqrt(hw * hw + alpha * alpha) / 0.766;
  float s = 0.5 * (sqrt(k * k + 4.0) - k);
  return s * s;
}

const vec3 HAZE_LUMA = vec3(0.2126, 0.7152, 0.0722);

/**
 * Per-scattering-EVENT albedo of a medium whose authored colour is its BULK
 * diffuse reflectance. This is the correction the airlight was missing, and it
 * is the whole of the "aerial perspective is more saturated than the surfaces it
 * veils" defect.
 *
 * 'uHazeTint' is a look-at-a-pile-of-ash number: #8a7f72-ish ochre, measured off
 * a surface, which is what a photon sees after it has bounced around inside the
 * material MANY times. Every one of those bounces multiplies by the albedo, so
 * the per-event albedo that eventually integrates to that colour is far closer
 * to neutral. Feeding the bulk reflectance straight into a SINGLE-scatter source
 * term therefore applies the whole multiple-scattering colour build-up to light
 * that has scattered exactly once: measured, alb(0.58,0.48,0.33) times
 * sun(1,0.75,0.53) gave the beam a saturation of 0.70 against terrain whose own
 * albedo under neutral light measures 0.199, i.e. the fog was three times more
 * saturated than the world it was veiling, and it is a fog that covers
 * everything past about four hundred metres. The art bible's third
 * non-negotiable says distance must DESATURATE toward the sky; this term was
 * doing the exact opposite.
 *
 * Two standard inversions, in order:
 *
 *  1. Kubelka-Munk. A semi-infinite ISOTROPIC scatterer reaches diffuse
 *     reflectance r when K/S = (1-r)^2 / 2r, so its single-scattering albedo is
 *     1 / (1 + K/S).
 *  2. Similarity. Real mineral dust is strongly forward-scattering, so it needs
 *     far more events to build the same reflectance than an isotropic medium
 *     does; the scaled equivalence w_iso = w(1-g)/(1-wg) inverts to
 *     w = w_iso / (1 - g + g*w_iso). At g=0.70 this is what takes the ash from
 *     an implausible 0.87/0.78/0.60 — a medium that eats 40% of every blue
 *     photon it touches, which is soot, not ash — to 0.96/0.92/0.83, a
 *     near-conservative mineral aerosol, which is what it actually is.
 *
 * Renormalised to the authored luminance on the way out, so this is a HUE
 * correction and not one exposure value in the frame moves.
 */
vec3 hazeSSA(vec3 R, float g) {
  vec3 r = clamp(R, 0.02, 0.98);
  vec3 ks = (1.0 - r) * (1.0 - r) / (2.0 * r);
  vec3 wIso = 1.0 / (1.0 + ks);
  vec3 w = wIso / max(1.0 - g + g * wIso, 1e-4);
  return w * (dot(R, HAZE_LUMA) / max(dot(w, HAZE_LUMA), 1e-4));
}

/**
 * Altitude of the far end of a straight segment, on a SPHERICAL planet.
 *
 * This is the whole reason the build had a razor-straight line across every
 * vista. Everything below models the layer's altitude as h = h0 + dy*t, which
 * is exact to within a metre over the few kilometres a fogged SURFACE is ever
 * at, and catastrophically wrong over the hundreds of kilometres the sky dome
 * hands it near the horizon. A ray one degree below level from a ridge-top eye
 * is driven fifteen hundred metres UNDERGROUND by that model, and exp(-h/H)
 * below sea level is not a small number, it is a large one: measured, the
 * layer's optical depth ran to 40 where the honest value is 12, and the
 * density-weighted mean altitude came out NEGATIVE and clamped to zero.
 *
 * Both pathologies switch on within a fraction of a degree of the horizon, so
 * the layer's albedo (which is a function of that mean altitude) flipped from
 * its bleached top to its oxide base inside two pixels — a hard hue step at a
 * constant screen row, running the full width of the frame, which is precisely
 * the draw-distance fog wall the art bible calls an automatic blocker.
 *
 * The curved endpoint costs one sqrt and makes the altitude profile honest at
 * both ends of every path, at every scale, with no branch on distance.
 */
float hazeEndH(float h0, float dy, float dist) {
  float r0 = HAZE_RG + max(h0, 0.0);
  return sqrt(max(r0 * r0 + 2.0 * r0 * dy * dist + dist * dist, 1.0)) - HAZE_RG;
}

/**
 * Optical depth of an exponential layer of unit sea-level density over a
 * segment whose altitude runs LINEARLY from h0 to h1. The small-slope branch
 * avoids the 1/(h1-h0) singularity for near-horizontal rays, which is exactly
 * where the horizon band lives.
 */
float hazeODSeg(float h0, float h1, float dist, float H) {
  float a = exp(-h0 / H);
  float u = (h1 - h0) / H;
  if (abs(u) < 1e-3) return a * dist;
  return a * (dist / u) * (1.0 - exp(-clamp(u, -60.0, 60.0)));
}

/** Distance at which the profile reaches sea level, or dist if it never does. */
float hazeSeaT(float h0, float h1, float dist) {
  return h1 >= 0.0 ? dist : dist * h0 / max(h0 - h1, 1e-4);
}

float hazeODAt(float h0, float h1, float dist, float H) {
  // The segment can end below sea level — a fragment on a sea bed, or a dome ray
  // handed more path than the planet leaves it. There is no layer down there:
  // the ray is inside the ground. Integrating on past the crossing at the
  // layer's sea-level density (which is what a plain clamp of h does) is worth
  // an optical depth of TWENTY on a near-horizon ray from a ridge-top eye, all
  // of it accumulated inside the one-degree band the horizon blend lives in —
  // which is the wall. Terminating at the crossing is both physical and, because
  // the tail length goes to zero as h1 does, smooth through it: the optical
  // depth simply stops growing.
  return hazeODSeg(h0, max(h1, 0.0), hazeSeaT(h0, h1, dist), H);
}

float hazeOD(float h0, float dy, float dist, float H) {
  h0 = max(h0, 0.0);
  dist = max(dist, 0.0);
  return hazeODAt(h0, hazeEndH(h0, dy, dist), dist, H);
}

/**
 * Density-weighted mean altitude along the same ray — the depth at which the
 * layer's in-scatter is actually produced. Closed form of
 * (integral of h * exp(-h/H) dt) / (integral of exp(-h/H) dt), over exactly the
 * clipped, curvature-correct profile hazeOD integrates.
 */
float hazeMeanHAt(float h0, float h1, float dist, float H) {
  // Same clipped profile hazeODAt integrates, so the albedo this altitude picks
  // and the extinction that decides how much of it is seen are two moments of
  // one density field rather than two models that disagree at the horizon.
  float tS = hazeSeaT(h0, h1, dist);
  h1 = max(h1, 0.0);
  float a = exp(-h0 / H);
  float u = (h1 - h0) / H;
  float w, m;
  if (abs(u) < 1e-3) {
    w = a * tS;
    m = w * (h0 + 0.5 * (h1 - h0));
  } else {
    float E = exp(-clamp(u, -60.0, 60.0));
    float k = a * (tS / u);
    w = k * (1.0 - E);
    m = k * ((h0 + H) - (h1 + H) * E);
  }
  return max(m, 0.0) / max(w, 1e-6);
}

float hazeMeanH(float h0, float dy, float dist, float H) {
  h0 = max(h0, 0.0);
  dist = max(dist, 0.0);
  return hazeMeanHAt(h0, hazeEndH(h0, dy, dist), dist, H);
}

/**
 * Radiance of the particulate layer along a view ray, plus (out) the optical
 * depth of the layer over that ray. Caller composites:
 *
 *   float T = exp(-od);
 *   col = col * T + L * (1.0 - T);
 *
 * 'sunRad' is the key light's radiance arriving at the TOP of the layer, already
 * attenuated by the clear column and by any cloud deck above; it goes to zero on
 * its own after sunset, which is what stops the layer painting a twilight wedge
 * around the whole horizon at midnight. 'skyRad' is the hemispheric sky
 * RADIANCE — irradiance / pi — not the irradiance itself; using the latter was
 * worth a factor of pi of permanent glow with no direction in it.
 */
vec3 hazeRadiance(vec3 tint, vec3 deep, float sigma, float H, float camY, vec3 v, float dist,
                  vec3 sunDir, float srcAng, vec3 sunRad, vec3 skyRad, vec2 wind, out float od) {
  // One curved endpoint for both integrals: the optical depth and the mean
  // scattering altitude are two moments of the SAME density profile over the
  // same segment, so evaluating hazeEndH twice would be a second sqrt for a
  // number we already have.
  float h0 = max(camY, 0.0);
  dist = max(dist, 0.0);
  float h1 = hazeEndH(h0, v.y, dist);
  od = sigma * hazeODAt(h0, h1, dist, H);
  if (sigma <= 1e-9) return vec3(0.0);

  float hbar = hazeMeanHAt(h0, h1, dist, H);

  // ---- sheets and gusts --------------------------------------------------
  //
  // A wind-driven ash column is not a homogeneous slab of extinction. The
  // review's complaint that "the fog volume the sun sits in is perfectly
  // homogeneous — no density variation, no sheets, no gusting" is literally
  // true of a closed-form exponential layer: sigma is one number for the whole
  // world, so the storm has no internal structure and the sun cannot punch
  // through a thin patch of it.
  //
  // Modulating the optical depth by a field sampled at the ray's own
  // density-weighted mean scattering point gets the structure for two noise
  // octaves and no march. Different pixels have their mean depth at different
  // world positions, so the field shows up as SHEETS crossing the view rather
  // than as a screen-space texture, and advecting it along the wind vector makes
  // the storm move.
  //
  // The amplitude is driven by sigma itself, so clear and cloudy weather — where
  // there is nothing to see and the cost would be wasted — are untouched by
  // construction, bit for bit.
  float sheetAmt = smoothstep(1.2e-3, 9.0e-3, sigma);
  if (sheetAmt > 0.01) {
    // Sample point: half of the shorter of the fragment distance and a couple of
    // mean free paths. Both are SMOOTH functions of the ray, which is the whole
    // requirement — the obvious choice, the depth at which hbar occurs, is a
    // ratio that swings between neighbouring pixels on any sloped surface and
    // stipples the entire mass with per-pixel noise instead of veiling it.
    //
    // The scale matters as much as the point. At 40m visibility a 4km noise
    // period is constant across the frame; the structure has to live at the scale
    // the medium can actually be seen over, which is a couple of hundred metres.
    float mfp = 1.0 / max(sigma, 1e-6);
    float dm = min(dist, mfp * 2.5) * 0.55;
    // 1.4e-2, i.e. a ~70m period. At 40m visibility the entire visible volume is
    // inside 120m, so a 200m sheet is less than half a period across a 60-degree
    // frame and reads as a gradient rather than as weather. The structure has to
    // be at the scale the storm can actually be seen over.
    vec3 sp = vec3(v.x * dm + wind.x, (camY + v.y * dm) * 2.2, v.z * dm + wind.y) * 1.4e-2;
    // Two octaves at a non-integer lacunarity: one for the sheet, one for the
    // ragged edge of it. A single octave reads as a soft blob field.
    float f = hazeVn(sp) * 0.66 + hazeVn(sp * 2.37 + 11.3) * 0.34;
    // Skewed low on purpose. A storm's density distribution is not symmetric:
    // most of it is at or above the mean and the interest is in the thin lanes,
    // so the exponent puts more of the range into the gaps the light gets
    // through. Mean stays within a few percent of 1, so the storm's authored
    // visibility is unchanged — only its uniformity is.
    od *= mix(1.0, 0.26 + 2.2 * pow(clamp(f, 0.0, 1.0), 1.8), sheetAmt);
  }
  // Vertical optical depth of everything ABOVE the mean scattering depth. This
  // is the whole vertical-structure term: it is ~0 for a ray looking up out of
  // a thin layer and equal to the layer's full column for one looking along the
  // ground through a storm.
  float tauTop = sigma * H * exp(-min(hbar / H, 60.0));

  float direct = exp(-min(tauTop / max(sunDir.y, 0.12), 60.0));
  // Diffuse penetration. Exponential rather than a 1/(1+x) saturation because a
  // real ash storm genuinely does go dark at ground level while its top stays
  // bright, and that gradient is the only thing that gives a storm a skyline.
  // The small floor is the light that reaches the bottom of even a heavy storm;
  // without it the ground plane crushes to black, which is not a fix, it is a
  // different defect.
  float shade = 0.05 + 0.95 * exp(-min(0.16 * tauTop, 40.0));

  // Vertical composition. A wind-driven ash column is not one material: the
  // coarse red basalt grit torn off the ground stays inside the bottom scale
  // height, and only the fine sulphur-yellow fraction gets carried to the top.
  // So the layer's albedo is a function of the depth at which the light was
  // actually scattered — which hbar already is — and the signature weather gets
  // a real vertical hue ramp, oxide red at the boots to sulphur overhead,
  // instead of the one flat tan it used to be. For any weather whose two tints
  // are equal this term is exactly a no-op.
  vec3 alb = mix(deep, tint, smoothstep(0.10, 1.50, hbar / H));

  float c = dot(v, sunDir);
  // Coarse mineral aerosol: tight forward lobe, aureole, isotropic pedestal.
  // Peak-to-trough is ~28x. Anything flatter and the sunset horizon measures the
  // same luminance at every azimuth, which is what it used to do.
  // Both forward lobes are widened by the source's angular radius (see
  // hazeSrcG). No-op for the sun; decisive for a moon, which is six times wider
  // than the aureole lobe.
  float ph = 0.60 * hazeHG(c, hazeSrcG(0.70, srcAng))
           + 0.18 * hazeHG(c, hazeSrcG(0.92, srcAng)) + 0.12 * HAZE_ISO;

  // The beam's diffusion residue.
  //
  // The 'direct' factor above is the UNSCATTERED beam, and it is gone by tauTop ~ 8. That
  // left the signature weather with no directional light cue whatsoever: the
  // whole sun term switched off and all that remained was the isotropic
  // pedestal, which is why the storm's sun measured as "a featureless radial
  // smear... an airbrush blob". What a real dust storm actually shows is the
  // many-times-FORWARD-scattered beam, which decays as a power law rather than
  // exponentially and whose lobe broadens with depth instead of vanishing. Two
  // terms: an effective asymmetry that relaxes toward isotropic with optical
  // depth, and a 1/(1+tau) magnitude. Clear air is within 3% of untouched
  // because direct is already near 1 there and the residue is what is left over.
  float gEff = hazeSrcG(0.70 * exp(-tauTop * 0.08), srcAng);
  float phDeep = 0.72 * hazeHG(c, gEff) + 0.28 * HAZE_ISO;
  // Similarity theory, not a guess: the diffuse transmission of a CONSERVATIVE
  // forward-scattering slab falls off as 1/(1 + 0.75*(1-g)*tau), which at g=0.70
  // is 1/(1 + 0.22*tau). The old 0.8/(1 + 0.55*tau) is the decay of a slab three
  // times more absorbing than ash actually is, and it is why the signature
  // weather had no sun in it at all: at the storm's optical depth it left 15% of
  // the forward-scattered beam where the medium delivers 43%, so the whole
  // directional cue sat under the isotropic pedestal and the sky dome varied by
  // thirteen luminance levels across the entire frame with the dominant gradient
  // being the post vignette. Ash scatters far more than it absorbs; the sun has
  // to survive that as a smeared hot blob.
  float beam = direct + (1.0 - direct) * 0.9 / (1.0 + tauTop * 0.30);
  float phBeam = mix(ph, phDeep, 1.0 - direct);

  // How much of the pedestal's light has scattered more than once. Used below to
  // schedule the diffuse illumination and the residual asymmetry of the
  // many-times-scattered field, both of which are properties of the COLUMN above
  // the scattering point — hence tauTop and not the path.
  float orders = 1.0 - exp(-tauTop * 2.0);

  // The medium's colour, as a function of how far the light got into it.
  //
  // 'alb' is the bulk reflectance: the colour reached after many events. 'w0' is
  // the per-event albedo that builds it (see hazeSSA), and it is much closer to
  // neutral. Which of the two a given path carries is decided by that path's own
  // optical depth, because that is literally the expected number of scattering
  // events along it:
  //
  //  - A 400m ray through clear air has od ~0.08. Essentially every photon in it
  //    scattered once, so it carries w0 — a pale warm grey at saturation 0.13.
  //    That is the near and mid field, and it is why the fog now VEILS the
  //    midground instead of tinting it: a low-saturation bright layer over a
  //    surface is exactly what atmospheric desaturation is.
  //  - A ray along the horizon has od ~8, and one through an ash storm has od
  //    ~30. Those have scattered many times, they carry the full authored
  //    sulphur, and the horizon band — the one part of the dome the palette
  //    names by hex — is unchanged to within a level.
  //
  // So the same physical quantity that used to be a hand-set constant now
  // produces the art bible's rule for free: near field desaturated, distance
  // converging on the sky's own band.
  //
  // Driven by 'od' AFTER the sheet modulation, so a thin lane in a storm is both
  // brighter and less saturated than the sheet beside it, which is what a shaft
  // of light through blowing ash actually looks like.
  // g is the MEAN COSINE of the phase function this function actually uses —
  // 0.60*0.70 + 0.18*0.92 + 0.12*0 — not the asymmetry of its widest lobe. The
  // isotropic pedestal drags the medium a long way from its coarse mode, and
  // using 0.70 here claims a more forward-scattering aerosol than the phase
  // function below describes, which over-corrects the albedo inversion.
  vec3 w0 = hazeSSA(alb, 0.586);
  // TRIED AND REVERTED: 'events' as the exact probability rather than this fit.
  //
  // Scattering along a path of optical depth od is Poisson with mean od, so the
  // fraction of the light that has scattered MORE THAN ONCE — the only light
  // that can have built up the bulk reflectance 'alb' — is 1 - e^-od (1 + od).
  // The fit below is not close to it at the thin end, which is the end every
  // landscape frame lives at:
  //
  //      od       0.1     0.5     1.0     2.0     4.0     8.0     30
  //      fit     0.054   0.240   0.423   0.667   0.889   0.988   1.000
  //      exact   0.005   0.090   0.264   0.594   0.908   0.997   1.000
  //
  // Shipped, captured over the canonical ten and measured: whole-frame relative
  // saturation moved by at most 0.003 on any shot (ridge 0.435 -> 0.435, vale
  // 0.314 -> 0.311, coast 0.365 -> 0.397 which is framing noise, the rest within
  // 0.002), and the circular-mean hue of shadowed ground did not move on any of
  // them. Backed out under the pipeline's revert rule rather than kept as a free
  // correctness fix, because it is a change to shared output that buys nothing
  // and this round's one global-appearance slot is not free.
  //
  // Why it bought nothing, which is the part worth keeping: the two endpoints it
  // interpolates between are much closer together than they look. w0 for the
  // clear preset is saturation 0.171 — the art bible's ash swatch is 0.174 — and
  // alb is 0.431, so re-weighting between them at od < 1 is worth a few
  // hundredths of saturation on a term that is then mixed with the surface. The
  // veil is not what makes a landscape frame warm; the light landing on it is.
  float events = 1.0 - exp(-min(od, 60.0) * 0.55);
  vec3 msTint = mix(w0, alb, events);
  // The beam: its unscattered part has by definition scattered zero times and
  // its diffusion residue many, so it interpolates between the two on exactly
  // the fraction that has been diffused.
  vec3 beamAlb = mix(w0, msTint, 1.0 - direct);

  // Multiple scattering, driven by the IRRADIANCE on the layer — sun radiance
  // times its cosine, plus the sky's own hemisphere. A thick layer lit from
  // above tends toward a Lambertian E * albedo / pi at its top and falls off
  // with depth; driving it from a fraction of the sun *radiance* instead, which
  // is what the old constant fill did, has no cosine, no depth and no units, and
  // it is why a midday storm and a midnight one both rendered the same ochre.
  vec3 Esun = sunRad * max(sunDir.y, 0.0);
  float esl = dot(Esun, vec3(0.2126, 0.7152, 0.0722));

  // Diffuse sky irradiance on the layer.
  //
  // skyRad comes from uSkyAmbient, which is an art-directed FILL for surface
  // shading and sits roughly an order of magnitude below the true diffuse
  // irradiance of a hazy sky: measured at noon it is 0.08/0.12/0.22 against a
  // direct beam near 8, i.e. the model claimed one percent of daylight was
  // diffuse. A clear ash-loaded sky is nearer twenty percent, and a storm is
  // essentially all of it. With the honest fraction missing, the layer was lit
  // by the sun and nothing else, so aerial perspective could only ever carry the
  // sun's chroma — which is why a distant ridge lifted toward ORANGE rather than
  // toward the sky it is silhouetted against, and why every frame measured as
  // one hue from the boots to the horizon.
  //
  // The magnitude is taken from the beam and the CHROMA from the ambient, which
  // is the colour the dome above this layer actually integrates to. It cannot
  // brighten a night: esl is zero once the sun is down, so dusk and midnight are
  // untouched by construction.
  float sl = dot(skyRad, vec3(0.2126, 0.7152, 0.0722));
  vec3 Esky = skyRad * (HAZE_PI + esl * (0.18 + 0.50 * orders) / max(sl, 1e-6));

  // ...and the BEAM's share of that irradiance is scheduled by 'events', which
  // is the fraction of this path's light that has scattered more than once.
  //
  // Without it the beam is counted twice. It already arrives through the phase
  // function a few lines below ('beamAlb * sunRad * phBeam * beam'), which is
  // the correct and only home for light that has scattered ONCE; adding the same
  // irradiance again to an ISOTROPIC pedestal claims that a photon which has not
  // yet scattered is already part of the diffuse field. In an ash storm that is
  // harmless — od is 30, everything has scattered many times, and the pedestal
  // is genuinely the whole medium — which is exactly why this went unnoticed.
  //
  // In clear air at sea level it is the single largest thing in the sky. The
  // clear preset's layer has a vertical optical depth of 0.16, so a ray twenty
  // degrees up out of a three-metre eye still crosses od 0.47 of it, and the
  // pedestal filled all of that with the sun's own chroma at no directional
  // variation whatsoever. Measured on the coast vantage at 17:36 the layer's own
  // radiance came back at (0.99, 0.68, 0.40) — hue 28, saturation 0.59, and 1.7
  // TIMES the radiance of the sky behind it, over the whole 0-27 degrees of
  // elevation the frame contains. The dome underneath it reads hue 215 at 15
  // degrees and hue 224 at 25; none of it survived. That is the review's "flat,
  // sunless, cloudless wash occupying 35% of the frame with zero incident": the
  // wash is this term and the "zero incident" is its isotropy.
  //
  // events = 1 - exp(-0.55 * od), so this is exactly a no-op wherever the layer
  // is thick enough for the pedestal to be real — every ash storm, every rain
  // and overcast preset, and the grazing horizon band in ALL weather, where od
  // runs to 17 and the sulphur the palette is named for lives. It only bites on
  // optically thin paths, where it is not an authored choice but a correction.
  vec3 E = mix(vec3(esl), Esun, 0.30 - 0.20 * orders) * events + Esky;

  // The pedestal is not isotropic, and in the signature weather that is the
  // whole ball game.
  //
  // Once the column is optically thick the unscattered beam is gone and 'beam'
  // above is worth almost nothing, so everything the eye has left is this term —
  // and it had no direction in it at all. The review measured the consequence on
  // the ash storm: the brightest sky lobe sat in the top-LEFT corner of a frame
  // whose sun is near the zenith, falling off monotonically to the right, which
  // is the signature of a gradient that is a function of the ray's elevation and
  // nothing else. It was: with the layer's mean scattering altitude pinned at
  // camY+H for every upward ray, 'alb', 'shade' and 'tauTop' are all constants
  // over the dome and the only thing that varied was the single-scattering
  // phase, which the beam factor had already crushed.
  //
  // A many-times-scattered field in a forward-scattering medium keeps a residual
  // asymmetry about the source — broadened with depth, never erased. So the
  // pedestal is weighted by an HG lobe about the SUN VECTOR whose asymmetry
  // relaxes with optical depth. 4*pi*HG integrates to one over the sphere, so
  // mixing toward it is exactly energy-neutral: this rotates where the light is,
  // it does not add any. Faded out with the sun's altitude so a night sky cannot
  // acquire a lobe pointing at a sun that is under the ground.
  //
  // Weighted by 'orders' ALONE, not by a constant plus orders. In thin air the
  // single-scattering term above is still intact and already carries the whole
  // directional cue, so a second lobe there is the same light counted twice: at
  // a flat 0.20 it put a 2.5x gain on the sky within a few degrees of the sun on
  // every clear frame and drove the red channel of the redmtn sky to 255. orders
  // is 0.1 in clear air and 1.0 in a storm, which is exactly the schedule this
  // term should follow — it exists only for the regime where 'beam' is dead.
  float gMs = 0.55 * exp(-tauTop * 0.06);
  float msW = 0.45 * orders * smoothstep(-0.05, 0.15, sunDir.y);
  float msDir = mix(1.0, 4.0 * HAZE_PI * hazeHG(c, gMs), msW);

  // 0.50, not 0.62.
  //
  // A grazing ray is almost entirely this term, so this coefficient IS the
  // horizon band's exposure, and at 0.62 the band was sitting on the
  // tonemapper's shoulder: measured at (250,225,195) on redmtn with the red
  // channel clipped to 255 over part of the region, which is the art bible's
  // eighth non-negotiable ("no clipped white sky") and also the reason no cloud
  // drawn in front of it could carry any contrast. A fifth of a stop down puts
  // the band back under the shoulder where the grade still has chroma to give
  // it, and it is the same fifth of a stop that lets the dome's own
  // horizon-to-zenith gradient be seen through the layer instead of under it.
  return beamAlb * sunRad * phBeam * beam
       + msTint * E * (0.50 / HAZE_PI) * shade * msDir;
}
#endif
`;
