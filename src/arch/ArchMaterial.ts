import * as THREE from 'three';
import { AERIAL_GLSL, aerialUniforms } from '../sky/Atmosphere';
import type { PBRSet } from '../core/types';

/**
 * Architecture surface shading.
 *
 * Every wall in the settlement is one MeshStandardMaterial patched with:
 *  - world-space triplanar sampling, so a curved chitin shell or an organic
 *    plaster dome never shows a stretched texel and needs no UV unwrap;
 *  - baked-curvature weathering — convex edges bleach and roughen, cavities
 *    collect dirt;
 *  - ash accumulation driven by the world normal's Y plus a drift term keyed
 *    to height above the foundation;
 *  - vertical rain streaks under ledges, from the baked `aDrip` attribute;
 *  - the sky's own aerial-perspective integral, imported rather than
 *    reimplemented, so a tower at 900 m and the sky behind it are the same air.
 */

/** Linear-space ash, matching the palette's `#8a7f72` end. */
const ASH_LINEAR = new THREE.Vector3(0.262, 0.222, 0.178);

/** sRGB authoring colour to the linear vec3 the shader works in. */
function linear(c: THREE.Color): THREE.Vector3 {
  const l = c.clone().convertSRGBToLinear();
  return new THREE.Vector3(l.r, l.g, l.b);
}

const ARCH_PARS = /* glsl */ `
uniform sampler2D uArchAlb;
uniform sampler2D uArchNrm;
uniform sampler2D uArchArm;
uniform float uArchScale;
uniform vec3  uArchTint;
uniform vec3  uArchAshCol;
uniform float uArchAsh;
uniform float uArchWear;
uniform float uArchStreak;
uniform float uArchIrid;
uniform float uArchWet;
uniform float uArchRough;
uniform float uArchNrmScale;
uniform float uArchOrganic;
uniform float uArchMottle;
uniform float uArchSSS;
uniform vec3  uArchSSSCol;
uniform float uArchSkyRim;
uniform float uArchSpill;
uniform vec3  uArchSpillCol;
uniform float uArchNight;
uniform float uArchTime;
uniform float uArchDbg;
uniform float uArchContrast;
uniform float uArchMetal;
uniform float uArchRing;
uniform float uArchMason;
uniform float uArchMasonAmp;
uniform float uArchAOStr;
uniform float uArchBio;
uniform vec3  uArchBioCol;

varying vec3 vArchW;
varying vec3 vArchN;
varying vec3 vArchLoc;
varying float vArchCurv;
varying float vArchDrip;
varying float vArchTintV;
varying float vArchSpillV;
varying float vArchAOV;
varying float vArchBioV;

vec3 gAlb;
vec3 gNrm;
float gRough;
float gAO;
float gMetal;
float gTrans;
vec3 gDbg;

float aHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float aVal(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(aHash(i), aHash(i + vec2(1.0, 0.0)), f.x),
             mix(aHash(i + vec2(0.0, 1.0)), aHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float aFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * aVal(p); p *= 2.07; a *= 0.5; }
  return s;
}
/**
 * Footprint-limited fbm: stop at the octave whose period is under 'cut' metres
 * per pixel and fold what is left into the running mean.
 *
 * The octaves this drops were never visible — they are below Nyquist for the
 * pixel that is asking — but they were still being evaluated, and each one is
 * four hashes. 'cut' is the world size of a pixel at this fragment, and
 * 'period' the metres per cycle of the FIRST octave, so the comparison is done
 * once in metres instead of guessing a distance.
 */
float aFbmLim(vec2 p, float period, float cut) {
  float s = 0.0;
  float a = 0.5;
  float per = period;
  // Total amplitude of all four octaves. Whatever is left when the loop stops
  // is folded in at its mean of 0.5, so the average is identical to the full
  // evaluation and no brightness step appears where the cut moves across a
  // surface.
  float rest = 0.9375;
  for (int i = 0; i < 4; i++) {
    if (per < cut * 2.0) break;
    s += a * aVal(p);
    rest -= a;
    p *= 2.07;
    a *= 0.5;
    per /= 2.07;
  }
  return s + 0.5 * rest;
}
float aSS(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

/**
 * Analytic organic-shell relief, in structure-local metres.
 *
 * This exists because a texture fetch cannot solve the problem it is aimed at.
 * A 110 m Telvanni tower is looked at from 300 m to 2 km; a 2.8 m texture
 * repeat is already below one pixel at 600 m, so the mip chain hands back a
 * flat average and the tower renders as an inflatable. Every band below is
 * evaluated per fragment from world position, so nothing mips out, and each is
 * faded against w, the world size of a pixel, so it disappears exactly when
 * it stops being resolvable and never aliases past that point.
 *
 * The bands are metre-scale on purpose: 10 m growth swells and 3 m bark ribs
 * are what still read at a kilometre, which is where this asset does its job.
 * The up argument blends the flank's vertical fibre into the cap's concentric
 * rings, which follow the radial axis of the structure it is drawn on.
 *
 * The band WEIGHTS are hoisted into archBands because they do not vary between
 * the three gradient taps this function is called for, and because each one
 * gates its own octaves. That gate is the whole optimisation: a band whose
 * weight has already faded to zero was still being evaluated — four hashes an
 * octave, four octaves a band, three taps — purely to be multiplied by zero.
 *
 * The two fine bands (30 cm and 9 cm features) are gone by the time a pixel is
 * a metre across, which is where a 110 m tower spends its entire on-screen life
 * in these shots: 600-900 m out. Skipping them there removes twenty-four value-
 * noise lookups, ninety-six hashes, per fragment of tower, and changes the
 * rendered image by nothing at all, because their weight was zero already.
 */
struct ArchBands { float b0; float b1; float b2; float b3; float ring; float sum; };

ArchBands archBands(float w) {
  ArchBands o;
  o.b0 = aSS(8.0, 3.0, w);
  o.b1 = aSS(2.8, 1.0, w);
  o.b2 = aSS(0.90, 0.30, w);
  o.b3 = aSS(0.28, 0.09, w);
  // Concentric rings belong to a cap, which is a disc grown about its own axis.
  // On a POD they are a lie: an ovoid has no radial axis, so the term drew
  // perfectly concentric contours across the bulb — read, correctly, as
  // quantised shading rather than as growth. uArchRing gates it per material.
  o.ring = aSS(6.0, 2.2, w) * uArchRing;
  o.sum = o.b0 + o.b1 + o.b2 + o.b3 + o.ring;
  return o;
}

float archShell(vec3 lp, float up, ArchBands k, float px) {
  vec2 f = lp.xz;
  float yb = lp.y * 0.05;
  float h = 0.0;
  // aFbmLim, not aFbm, and this pays for the whole masonry stack below.
  //
  // Each of these was four unconditional octaves, three of which are under
  // Nyquist for most of the range the asset is seen at — the b1 band's fourth
  // octave is a 38 cm feature and the band itself only fades out at a 2.8 m
  // pixel. Twelve value-noise lookups, forty-eight hashes, THREE TAPS, spent to
  // add a constant. The limiter drops exactly the octaves whose period is under
  // the pixel and folds them back in at their own mean, so the rendered image is
  // unchanged and the near field is unchanged; what goes away is the mid and far
  // field, which is where the tower is in every shot anyone frames it in.
  if (k.b0 > 0.002) h += 0.55 * (aVal(f * 0.10 + vec2(yb, -yb)) - 0.5) * k.b0;
  if (k.b1 > 0.002) h += 0.38 * (aFbmLim(f * 0.30 + vec2(yb * 1.7, 0.0), 3.33, px) - 0.5) * k.b1;
  if (k.b2 > 0.002) h += 0.22 * (aFbmLim(f * 0.95 + vec2(yb * 3.1, 0.0), 1.05, px) - 0.5) * k.b2;
  if (k.b3 > 0.002) h += 0.12 * (aFbmLim(f * 3.00 + vec2(yb * 6.0, 0.0), 0.33, px) - 0.5) * k.b3;
  // Concentric growth rings about the structure's own axis: the cap reads as a
  // grown disc rather than as a spun lathe the moment these appear.
  if (k.ring > 0.002) {
    float rad = length(f);
    float rings = sin(rad * 0.90 + (aVal(f * 0.14) - 0.5) * 5.0);
    h += 0.30 * rings * up * k.ring;
  }
  return h;
}

/**
 * BUILT surface relief: courses, trowel, lamellae, grain.
 *
 * The reason this exists is the same as archShell's, aimed at the other half of
 * the settlement. The triplanar fetch is a 1-2 m repeat, so it is below one
 * pixel from about eighty metres out and the mip chain hands back a flat
 * average — which is precisely "untextured clay" and "flat-shaded blockout".
 * The organic materials were given an analytic band stack for that reason and
 * the masonry ones never were, so every plaster dome, cut-stone plinth, basalt
 * ruin and chitin shell in the game was a smooth tinted solid past the near
 * plane. This is the missing half.
 *
 * Everything is evaluated from position, so nothing mips out; every band is
 * gated on the pixel footprint it stops being resolvable at, so nothing
 * aliases and nothing coarser than a pixel is paid for.
 *
 * The lateral coordinate is ARC LENGTH about the structure's own axis, not a
 * world axis. Velothi architecture is turned and grown about a vertical axis —
 * domes, drums, stalks, shells — so a course, a trowel sweep or a lamella
 * genuinely runs that way, and the coordinate is continuous over the whole of
 * a curved wall where a planar one would seam at 45 degrees.
 */
float archMason(vec3 lp, ArchBands k, float px) {
  float r = max(length(lp.xz), 0.40);
  float s = atan(lp.z, lp.x) * r;
  float y = lp.y;
  float h = 0.0;
  int m = int(uArchMason + 0.5);

  if (m == 1) {
    // ---- CUT AND COURSED STONE ------------------------------------------
    //
    // Two course heights, because Dunmer masonry is both: cyclopean basalt at
    // over a metre for a Daedric ruin, dressed ashlar at a third of that for a
    // plinth or a doorway. The coarse course is on the 2.8 m band and so is
    // still there at a couple of hundred metres, which is where the "flat
    // blockout" reading actually happens; the fine one is a near-plane detail.
    //
    // Head joints are staggered per course and the block length varies per
    // course, so no vertical line ever runs through two rows — that single
    // property is the difference between masonry and a grid.
    if (k.b1 > 0.002) {
      float CH = 1.35;
      float row = floor(y / CH);
      float len = 1.7 + 1.6 * aHash(vec2(row, 11.3));
      float u = s / len + aHash(vec2(row, 3.7)) * 4.13;
      float dv = abs(fract(y / CH) - 0.5) * 2.0;
      float du = abs(fract(u) - 0.5) * 2.0;
      float joint = max(aSS(0.80, 1.0, dv), aSS(0.86, 1.0, du));
      // Each stone sits a little proud or shy of its neighbours; without this
      // the wall is one plane with lines scribed on it.
      float set = (aHash(vec2(floor(u) * 0.37 + 5.1, row * 0.71)) - 0.5) * 0.10;
      h += (set - joint * 0.20) * k.b1;
    }
    if (k.b2 > 0.002) {
      float CH = 0.36;
      float row = floor(y / CH);
      float len = 0.50 + 0.55 * aHash(vec2(row, 7.9));
      float u = s / len + aHash(vec2(row, 2.3)) * 3.71;
      float dv = abs(fract(y / CH) - 0.5) * 2.0;
      float du = abs(fract(u) - 0.5) * 2.0;
      float joint = max(aSS(0.76, 1.0, dv), aSS(0.82, 1.0, du));
      float set = (aHash(vec2(floor(u) * 0.53 + 1.7, row * 0.29)) - 0.5) * 0.05;
      h += (set - joint * 0.11) * k.b2;
    }
    // Tooling. A chisel runs ACROSS the face of a block, so the grain here is
    // strongly anisotropic — that anisotropy is what says "worked" rather than
    // "noisy", and it is the cheapest cue in the whole function.
    if (k.b3 > 0.002) h += 0.030 * (aFbmLim(vec2(s * 15.0, y * 3.0), 0.067, px) - 0.5) * k.b3;
    return h;
  }

  if (m == 2) {
    // ---- TROWELLED PLASTER ----------------------------------------------
    //
    // A hand float leaves long curved sweeps, each a couple of metres of arc
    // with a soft ridge at its trailing edge, and the sweeps overlap. Under
    // them is the coarse aggregate of the render itself.
    if (k.b1 > 0.002) {
      float w1 = aFbmLim(vec2(s * 0.40, y * 0.58), 2.5, px);
      h += 0.085 * sin(w1 * 8.5 + s * 0.5) * k.b1;
    }
    if (k.b2 > 0.002) h += 0.055 * (aFbmLim(vec2(s * 1.6, y * 1.8), 0.62, px) - 0.5) * k.b2;
    // Pinholes and shell grit: sparse, and only pits — a render loses material,
    // it does not gain it.
    // Sparse, and no finer than about seven centimetres: at 26 cycles a metre
    // this was a three-pixel feature at conversational distance, which is a
    // shimmer generator, not a surface.
    if (k.b3 > 0.002) h -= 0.030 * aSS(0.78, 1.0, aVal(vec2(s * 14.0, y * 14.0))) * k.b3;
    return h;
  }

  if (m == 3) {
    // ---- LAMELLAR CHITIN --------------------------------------------------
    //
    // Stacked plates: each lamella swells outward along its length and drops at
    // its lip, so the surface is a stack of soft ramps with a hard shadow line
    // between them. The stack wanders, because a shell grows and a machine does
    // not.
    if (k.b2 > 0.002) {
      float LH = 0.58;
      float p = y / LH + 0.30 * aFbmLim(vec2(s * 0.33, y * 0.11), 3.0, px);
      float f = fract(p);
      h += (0.075 * f - 0.105 * aSS(0.86, 1.0, f)) * k.b2;
    }
    if (k.b3 > 0.002) h += 0.026 * (aFbmLim(vec2(s * 11.0, y * 2.0), 0.09, px) - 0.5) * k.b3;
    return h;
  }

  // ---- WEATHERED TIMBER --------------------------------------------------
  // Fibre runs with the grain and is far longer than it is wide; knots are
  // local depressions the fibre has had to flow around.
  if (k.b2 > 0.002) {
    h += 0.055 * (aFbmLim(vec2(s * 7.0, y * 0.50), 0.14, px) - 0.5) * k.b2;
    float kn = aVal(vec2(s * 1.3, y * 0.85));
    h -= 0.075 * aSS(0.87, 1.0, kn) * k.b2;
  }
  if (k.b3 > 0.002) h += 0.030 * (aVal(vec2(s * 17.0, y * 1.1)) - 0.5) * k.b3;
  return h;
}

/**
 * The whole analytic relief field, grown and built together, so both are
 * carried by ONE three-tap gradient rather than two.
 */
float archRelief(vec3 lp, float up, ArchBands k, float px) {
  float h = 0.0;
  if (uArchOrganic > 0.001) h += archShell(lp, up, k, px) * uArchOrganic;
  if (uArchMason > 0.5) h += archMason(lp, k, px) * uArchMasonAmp;
  return h;
}
`;

/**
 * Triplanar fetch + the whole weathering stack, substituted for
 * `<map_fragment>` so it runs before roughness, normal and AO are consumed.
 */
const ARCH_SURFACE = /* glsl */ `
  vec3 aN = normalize(vArchN);
  vec3 bw = pow(abs(aN), vec3(5.0));
  bw /= max(bw.x + bw.y + bw.z, 1e-4);

  // World size of one pixel at this fragment. Every footprint gate below reads
  // it, so it is computed once, unconditionally — a derivative taken inside
  // divergent control flow is undefined.
  float archPx = fwidth(vArchW.x) + fwidth(vArchW.y) + fwidth(vArchW.z);

  vec3 tp = vArchW * uArchScale;
  vec2 uvX = tp.zy;
  vec2 uvY = tp.xz;
  vec2 uvZ = tp.xy;

  // Triplanar, but only the planes that can be seen.
  //
  // The blend weight is |n|^5 normalised, which is deliberately sharp: on a
  // wall, a floor, or anywhere on a dome that is not within ~20 degrees of a
  // diagonal, two of the three projections are weighted below a thousandth and
  // contribute nothing but six texture fetches. Skipping those takes the common
  // case from nine fetches to three. The threshold is low enough that the
  // dropped plane is never worth more than a quarter of an LSB, so the seam it
  // could theoretically produce is below the dither floor.
  vec3 alb = vec3(0.0);
  vec4 arm = vec4(0.0);
  vec3 wn = vec3(0.0);
  if (bw.x > 0.0025) {
    alb += texture2D(uArchAlb, uvX).rgb * bw.x;
    arm += texture2D(uArchArm, uvX) * bw.x;
    vec3 nX = texture2D(uArchNrm, uvX).xyz * 2.0 - 1.0;
    wn += vec3(nX.xy * uArchNrmScale + aN.zy, abs(nX.z) * aN.x).zyx * bw.x;
  }
  if (bw.y > 0.0025) {
    alb += texture2D(uArchAlb, uvY).rgb * bw.y;
    arm += texture2D(uArchArm, uvY) * bw.y;
    vec3 nY = texture2D(uArchNrm, uvY).xyz * 2.0 - 1.0;
    wn += vec3(nY.xy * uArchNrmScale + aN.xz, abs(nY.z) * aN.y).xzy * bw.y;
  }
  if (bw.z > 0.0025) {
    alb += texture2D(uArchAlb, uvZ).rgb * bw.z;
    arm += texture2D(uArchArm, uvZ) * bw.z;
    vec3 nZ = texture2D(uArchNrm, uvZ).xyz * 2.0 - 1.0;
    wn += vec3(nZ.xy * uArchNrmScale + aN.xy, abs(nZ.z) * aN.z).xyz * bw.z;
  }

  // --- relative albedo -------------------------------------------------------
  //
  // THE fix for "flat single-value facets with no albedo map". Every colour in
  // this stack used to be a MULTIPLIER on the fetched map, and the two crushed
  // each other: the basalt set averages 0.021 in linear and the basalt tint was
  // 0.16, so the architecture rendered at a 0.34% albedo — three parts in a
  // thousand — under a weathering stack whose ash and wear terms are additive
  // constants an order of magnitude larger. The measured result was exactly the
  // review's uniform mean RGB with no texture in it, on geometry whose maps were
  // bound, sampled and mipped correctly the whole time.
  //
  // So the map is read RELATIVE to its own average — taken straight off its 1x1
  // mip, which costs one always-resident fetch and needs no constant kept in
  // sync with the synthesiser — and uArchTint IS the material's mid-tone albedo
  // rather than a tint on top of one. Value and variation are then independent:
  // a material can be as dark as the palette asks while its map still swings
  // +/-40% about that value, which is what makes a surface read as a surface.
  vec3 albMean = textureLod(uArchAlb, uvY, 12.0).rgb;
  vec3 albRel = alb / max(albMean, vec3(0.004));
  // Contrast about unity. The synthesiser's sets are authored for a multiplied
  // pipeline and several are low-variance; expanding here is free and is the
  // difference between visible stone and a tinted card.
  albRel = pow(max(albRel, vec3(0.0)), vec3(uArchContrast));

  gAlb = albRel * uArchTint;
  gRough = clamp(arm.g * uArchRough, 0.04, 1.0);
  // Baked hemisphere occlusion from the structure's own mass. This is what
  // darkens the corner of a recessed panel and the last hand's breadth where a
  // shell meets its plinth; vertex curvature is a local measure and can see
  // neither.
  gAO = arm.r * mix(1.0, vArchAOV, uArchAOStr);
  gMetal = arm.b * uArchMetal;
  gTrans = 0.0;

  // Whiteout blend: each projection's tangent normal was swizzled into world
  // space and added above, which keeps detail on 45-degree facets where a naive
  // lerp mushes.
  gNrm = normalize(wn);

  // Break the lattice: a second, much coarser fetch modulates luminance. Two
  // scales an octave and a half apart never beat visibly against each other.
  // Nine-metre features, so it survives to a very coarse footprint; its finer
  // octaves do not, and aFbmLim drops exactly those.
  float macro = aFbmLim(vArchW.xz * 0.11 + vArchW.y * 0.04, 9.0, archPx);
  gAlb *= mix(0.82, 1.18, macro);

  // --- analytic organic shell ------------------------------------------------
  // Runs before every weathering term so ash, wear and streaks all settle into
  // the relief this creates instead of floating over a smooth ovoid.
  ArchBands bands = archBands(archPx);
  if ((uArchOrganic > 0.001 || uArchMason > 0.5) && bands.sum > 0.004) {
    float up = abs(aN.y);
    // Sample the height field across a footprint of at least one pixel: below
    // that the gradient is measuring noise the screen cannot show and the
    // result sparkles under camera motion.
    //
    // The floor is per-family, and it has to be. The organic bands are metre-
    // scale, so a 30 cm step measures them fine. A mortar joint is FIVE
    // centimetres wide: a 30 cm finite difference steps straight over it and
    // reports a perfectly flat wall, which is the same flat wall the complaint
    // is about — the relief would be evaluated, paid for, and invisible. 4.5 cm
    // resolves a joint, and the band gates above already guarantee nothing
    // finer than a pixel is in the field being differenced, so the smaller step
    // cannot introduce sparkle.
    float e = max(uArchMason > 0.5 ? 0.045 : 0.30, archPx * 1.4);
    vec3 T = normalize(abs(aN.y) < 0.92 ? cross(vec3(0.0, 1.0, 0.0), aN) : vec3(1.0, 0.0, 0.0));
    vec3 B = cross(aN, T);
    // The centre tap is split so the two families can be weighted differently
    // below without evaluating either of them twice.
    float hO0 = uArchOrganic > 0.001 ? archShell(vArchLoc, up, bands, archPx) * uArchOrganic : 0.0;
    float hM0 = uArchMason > 0.5 ? archMason(vArchLoc, bands, archPx) * uArchMasonAmp : 0.0;
    float h0 = hO0 + hM0;
    float hT = archRelief(vArchLoc + T * e, up, bands, archPx);
    float hB = archRelief(vArchLoc + B * e, up, bands, archPx);
    gNrm = normalize(gNrm - (T * (hT - h0) + B * (hB - h0)) * (3.4 / e));
    // Interleaved-gradient dither on the shaded normal.
    //
    // The height field is smooth but the frame buffer is not: a 25 m bulb lit by
    // one key spans its whole shading range over a few hundred pixels, and at
    // 8 bits that is a visible contour every three or four levels — read as
    // "stepped rings, quantised normals". A sub-LSB rotation breaks the contour
    // into noise below the perceptual floor; it is the same trick as output
    // dithering, applied where the quantisation actually happens.
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    gNrm = normalize(gNrm + (vec3(ign, fract(ign * 3.7), fract(ign * 7.3)) - 0.5) * 0.012);
    // Relief reads in the albedo too: crests bleach, troughs hold dirt. Without
    // this the shape is only legible under a grazing key.
    //
    // The masonry field swings an order of magnitude less than the organic one
    // (a 5 cm mortar joint against a 3 m growth swell), so the ALBEDO and
    // CAVITY response is normalised separately: a joint that darkens by two
    // percent is not a joint. This is the term that keeps courses legible after
    // the normal has been flattened by ash or by a head-on key.
    float hA = hO0 + hM0 * 4.0;
    gAlb *= 1.0 + hA * 0.42;
    gRough = clamp(gRough - hA * 0.14, 0.04, 1.0);
    // Troughs are where a growth shell is thin and where the cavity sits, and
    // where mortar and shadow sit on a built wall.
    gAO *= mix(1.0, 0.72, clamp(-hA, 0.0, 1.0));
    gTrans = clamp(0.35 + h0 * 0.8, 0.0, 1.0);
  } else if (uArchOrganic > 0.001) {
    gTrans = 0.35;
  }

  // --- roughness mottling ----------------------------------------------------
  // A single roughness value over a 25 m pod gives one continuous specular
  // streak, which is the exact signature of blown plastic. Blotches at two
  // scales break the lobe into patches without touching its average. The finer
  // of the two is 1.2 m across and stops being a patch the moment a pixel is
  // wider than that, so it is footprint-limited rather than always paid for.
  if (uArchMottle > 0.001 && archPx < 2.4) {
    float blot = aFbmLim(vArchLoc.xz * 0.22 + vArchLoc.y * 0.05, 4.5, archPx) * 0.65
               + aFbmLim(vArchLoc.xz * 0.80 + vArchLoc.y * 0.14, 1.25, archPx) * 0.35;
    gRough = clamp(gRough * mix(1.0, mix(0.80, 1.34, blot), uArchMottle), 0.06, 1.0);
  }

  // Per-structure batch tint. Every house in a Velothi village is mixed from a
  // different pit of mud; without this the settlement reads as one extruded
  // asset stamped fifteen times, which is the tell that kills it fastest.
  gAlb *= mix(vec3(0.74, 0.72, 0.70), vec3(1.24, 1.10, 0.90), vArchTintV);

  // --- curvature-driven wear -------------------------------------------------
  //
  // Both terms are RELATIVE to the material's own value now. The old bleach was
  // gAlb * 1.55 + 0.045, and on a dark material that additive constant was
  // fifteen times the albedo it was supposed to modify — every convex edge in
  // the settlement snapped to the same flat grey regardless of what it was made
  // of, which is half of why the review could not tell basalt from plaster.
  float wear = aSS(0.05, 0.42, vArchCurv) * uArchWear;
  float cav = aSS(0.05, 0.45, -vArchCurv);
  gAlb = mix(gAlb, gAlb * 1.45 + uArchTint * 0.14, wear);
  gRough = mix(gRough, min(gRough * 1.20 + 0.06, 1.0), wear);
  gNrm = normalize(mix(gNrm, aN, wear * 0.45));
  gAlb *= mix(1.0, 0.58, cav * 0.85);
  gAO *= mix(1.0, 0.45, cav);

  // --- metal ------------------------------------------------------------------
  // Bronze that shades exactly like the ash around it is a dielectric wearing a
  // brown texture. Three things separate them and all three are curvature:
  // bare metal survives on the edges that get rubbed, crevices fill with dirt
  // that is not metal at all, and the polished edge is the only part with a
  // tight lobe.
  if (uArchMetal > 0.001) {
    gMetal = clamp(gMetal * (1.0 - cav * 0.80) + wear * uArchMetal * 0.30, 0.0, 1.0);
    gRough = mix(gRough, gRough * 0.45, wear * gMetal);
    gRough = mix(gRough, min(gRough + 0.35, 1.0), cav * 0.7);
  }

  // --- rain streaks ----------------------------------------------------------
  // Fast horizontally, slow vertically: a run of dirt, not a noise field.
  // Fourteen centimetres per streak, so the whole term is below Nyquist — and
  // therefore pure aliasing — the moment a pixel is wider than that. vArchDrip
  // is zero over most of a building anyway, which makes the gate almost free
  // where it is not taken.
  float streak = 0.0;
  float dripW = vArchDrip * (1.0 - abs(aN.y)) * uArchStreak;
  if (dripW > 0.004 && archPx < 0.07) {
    float sN = aFbmLim(vec2((vArchW.x * 0.7 + vArchW.z * 0.7) * 7.0, vArchW.y * 0.30), 0.143, archPx);
    streak = dripW * aSS(0.42, 0.86, sN) * (0.55 + 0.45 * uArchWet);
  }
  gAlb *= mix(1.0, 0.42, streak);
  gRough = mix(gRough, 0.48, streak * 0.55);

  // --- ash accumulation ------------------------------------------------------
  float grain = 0.5 + 0.5 * aFbmLim(vArchW.xz * 1.7, 0.59, archPx);
  float upness = aSS(0.22, 0.78, aN.y) * grain;
  float drift = aSS(2.1, 0.0, vArchLoc.y) * (0.35 + 0.4 * grain);
  // Cavities hold drift too — that is where windblown ash actually settles, and
  // it makes the recessed panels read as cut into something rather than printed
  // on it.
  float ash = clamp((upness + drift + cav * 0.45) * uArchAsh, 0.0, 0.9);
  ash *= 1.0 - uArchWet * 0.55;               // rain washes the ledges clean
  // Ash MODULATES; it never replaces.
  //
  // mix(gAlb, constant, 0.88) is a wipe: at any meaningful accumulation the
  // surface underneath was gone and the whole structure became one flat drift
  // colour — which is what the review measured and read, correctly, as an
  // untextured material. Carrying albRel through the drift keeps the substrate's
  // own variation visible under the ash, and the grain gives the ash a surface
  // of its own instead of a value.
  vec3 ashCol = uArchAshCol * (0.66 + 0.70 * grain) * mix(vec3(1.0), albRel, 0.45);
  gAlb = mix(gAlb, ashCol, ash * 0.78);
  gRough = mix(gRough, 0.97, ash * 0.9);
  gNrm = normalize(mix(gNrm, aN, ash * 0.75));
  gMetal *= 1.0 - ash * 0.9;                  // ash-buried bronze is not metal

  // --- iridescent lamellae (chitin only) ------------------------------------
  if (uArchIrid > 0.001) {
    vec3 V = normalize(cameraPosition - vArchW);
    float f = pow(1.0 - clamp(dot(gNrm, V), 0.0, 1.0), 3.0);
    float band = aFbmLim(vArchW.xy * 1.6 + vArchW.zy * 1.1, 0.63, archPx);
    vec3 irid = 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.34, 0.66) + f * 1.9 + band));
    gAlb = mix(gAlb, gAlb * (0.6 + 1.1 * irid), uArchIrid * (0.25 + 0.75 * f) * (1.0 - ash));
    gRough = mix(gRough, gRough * 0.55, uArchIrid * (1.0 - ash));
  }

  // --- global wetness --------------------------------------------------------
  gAlb *= mix(1.0, 0.68, uArchWet * 0.8);
  gRough = mix(gRough, 0.10, uArchWet * 0.7);
  gTrans *= 1.0 - ash * 0.85;

  diffuseColor.rgb *= gAlb;

  // Diagnostic channel. Zero in every shipping frame; a harness sets it live to
  // attribute a flat surface to its actual cause instead of guessing at one.
  gDbg = vec3(0.0);
  if (uArchDbg > 0.5) {
    vec3 dbg = gAlb;
    if (uArchDbg < 1.5)      dbg = alb;                                  // 1 raw triplanar albedo
    else if (uArchDbg < 2.5) dbg = bw;                                   // 2 blend weights
    else if (uArchDbg < 3.5) dbg = vec3(archPx * 0.25);                  // 3 pixel footprint
    else if (uArchDbg < 4.5) dbg = gNrm * 0.5 + 0.5;                     // 4 shaded normal
    else if (uArchDbg < 5.5) dbg = vec3(gAO);                            // 5 AO
    else if (uArchDbg < 6.5) dbg = vec3(vArchCurv * 0.5 + 0.5);          // 6 baked curvature
    else if (uArchDbg < 7.5) dbg = vec3(gRough);                         // 7 roughness
    else if (uArchDbg < 8.5) dbg = fract(abs(vArchW) * uArchScale);      // 8 triplanar uv
    else if (uArchDbg < 9.5) {                                           // 9 albedo at mip 0
      dbg = textureLod(uArchAlb, uvX, 0.0).rgb * bw.x
          + textureLod(uArchAlb, uvY, 0.0).rgb * bw.y
          + textureLod(uArchAlb, uvZ, 0.0).rgb * bw.z;
    } else {                                                             // 10 chosen mip level
      vec2 dx = dFdx(uvZ) * 1024.0;
      vec2 dy = dFdy(uvZ) * 1024.0;
      dbg = vec3(0.5 * log2(max(dot(dx, dx), dot(dy, dy))) / 10.0);
    }
    gDbg = dbg;
  }
`;

/**
 * Baked window spill.
 *
 * A lit aperture must brighten the wall around it, and the fixed six-light pool
 * cannot do that: the pool is culled at 95 m and a landmark tower is looked at
 * from ten times that. `aSpill` is the aperture's irradiance baked per vertex
 * at build time, so the wash around every window survives to any distance for
 * the cost of one attribute — which is also the only version of this that a 90
 * px pod on the horizon can still show.
 */
const ARCH_EMISSIVE = /* glsl */ `
  #include <emissivemap_fragment>
  // Lamps: mostly a night term, but never fully off. A Dunmer interior at noon
  // is still a lamp-lit room, and an aperture with no wash around it in daylight
  // is the "clipped white quad that contributes zero light" the review found.
  totalEmissiveRadiance += uArchSpillCol * (vArchSpillV * uArchSpill * mix(0.14, 1.0, uArchNight));
  // Bioluminescence: NOT gated on the clock, and breathing. This is the term
  // that puts light on the cap gills above the rim and on the pods below it,
  // which is what makes the ring read as a source rather than as a sticker.
  totalEmissiveRadiance += uArchBioCol *
    (vArchBioV * uArchBio * (0.74 + 0.26 * sin(uArchTime * 0.55 + vArchLoc.y * 0.09)));
`;

/**
 * Thin-shell transmission.
 *
 * Deliberately unshadowed and taken straight off the key light: what is being
 * modelled is light that entered the far side of a 3 cm fungal cap and came out
 * this one, so the near face being in shadow is the precondition, not a
 * disqualifier. The rim term is what makes a backlit cap glow orange at its
 * edge instead of going flat black against the sky.
 *
 * THE 1/PI IS NOT COSMETIC. Every other diffuse path in this material goes
 * through three's `BRDF_Lambert`, which divides albedo by pi; this term is
 * pushed straight into `reflectedLight.indirectDiffuse` after the lighting
 * loop and so skipped it, which made it PI TIMES brighter than a fully sunlit
 * front face for the same nominal strength. On a backlit trunk at dusk that
 * pins the output above the display range, and since the term is added
 * independently of the surface normal, everything the normal was carrying —
 * albedo variation, the analytic shell relief, the roughness break-up, the
 * shading on a bracket standing off the trunk — is flattened underneath it.
 * That is the whole of the "flat smooth red gradient with no albedo texture, no
 * normal and no roughness variation, reads as untextured clay, and the extruded
 * fitting on it is unshaded" blocker: the geometry and the maps were correct
 * and one un-normalised light term was sitting on top of them.
 */
/**
 * Sky-lit rim.
 *
 * A silhouette that does not separate from what is behind it is not a value
 * problem to be solved with a grade — it is a MISSING LIGHT. At dusk the sun is
 * under the horizon and the key light is gone, but the sky dome is still the
 * brightest emitter in the scene, and a horizontal disc twenty-five metres
 * across turns its whole upper edge at it. Nothing in the standard stack
 * delivers that: the environment probe is one prefiltered cube evaluated in the
 * REFLECTION direction, which on a matte dielectric contributes almost nothing
 * at grazing incidence, and there is no irradiance term that knows which way
 * the sky is bright.
 *
 * So sample the atmosphere's own sky-view LUT — the same texture the sky dome
 * and the aerial integral read — in the direction the surface faces, biased
 * upward, and weight it by how close to the silhouette the fragment is. That is
 * a real irradiance term at the real bearing for the real hour: it swings warm
 * on the sunset side and cold on the other, it vanishes at noon when the
 * surface is already lit, and it costs one texture fetch on the two materials
 * that ask for it.
 *
 * `uArchSkyRim` is off by default, so nothing but the cap pays for it.
 */
const ARCH_SKYRIM = /* glsl */ `
  if (uArchSkyRim > 0.001) {
    vec3 srN = normalize(normal);
    // Biased up: the top edge of a cap sees the whole dome, not just the
    // sliver its own normal points at.
    vec3 srDir = normalize(srN + vec3(0.0, 0.60, 0.0));
    vec3 srSky = texture(uAerialSkyView, aerialSkyUV(srDir)).rgb;
    // Grazing: strongest exactly where the silhouette edge is, which is the
    // pixel the separation is measured on.
    float srGraze = pow(1.0 - clamp(abs(dot(srN, geometryViewDir)), 0.0, 1.0), 2.0);
    // Upper surfaces only. The underside of a parasol sees ground, not sky, and
    // lighting it from the dome would flatten the gills the cap exists to shade.
    float srUp = clamp(srN.y * 0.5 + 0.5, 0.0, 1.0);
    reflectedLight.indirectDiffuse +=
      srSky * gAlb * RECIPROCAL_PI * (uArchSkyRim * srGraze * srUp * srUp);
  }
`;

const ARCH_TRANSMIT = /* glsl */ `
  #include <lights_fragment_end>
  #if NUM_DIR_LIGHTS > 0
  if (uArchSSS > 0.001) {
    vec3 archL = directionalLights[0].direction;
    float back = pow(clamp(dot(-geometryViewDir, archL), 0.0, 1.0), 3.0);
    float wrap = clamp(0.35 - dot(normal, archL) * 0.35, 0.0, 1.0);
    float rim = pow(1.0 - clamp(abs(dot(normal, geometryViewDir)), 0.0, 1.0), 1.7);
    // RIM ONLY. The constant that used to sit beside the rim term (a flat 0.30
    // of the full backlight over the whole away-facing hemisphere, plus a 0.22
    // wrap) is not transmission — it is a body wash, and a body wash is exactly
    // what this term must never be. Transmission is light that entered the far
    // side of the tissue and came out this one, so it scales with how SHORT the
    // path through the shell is, and the only cheap measure of that available
    // here is how close the fragment is to the silhouette. Twenty-five metres
    // of pod hull transmits nothing at all through its middle.
    //
    // Measured: with the constant in, a Telvanni tower backlit by the red moon
    // rendered as a flat saturated maroon mass with no albedo variation, no
    // normal and no roughness break-up — the "untextured clay" failure, this
    // time on the pods, and with the palette's saturation discipline broken by
    // an unshaded red the size of the frame's subject. The rim itself is
    // unchanged in strength, so the orange edge on a backlit cap at dusk — the
    // best thing in the asset — survives intact.
    reflectedLight.indirectDiffuse +=
      directionalLights[0].color * uArchSSSCol * gAlb * RECIPROCAL_PI *
      (uArchSSS * gTrans * rim * (1.10 * back + 0.14 * wrap));
  }
  #endif
  ${ARCH_SKYRIM}
`;

const ARCH_VERT_PARS = /* glsl */ `
attribute float aCurv;
attribute float aDrip;
attribute float aTint;
attribute float aSpill;
attribute float aAO;
attribute float aBio;
varying vec3 vArchW;
varying vec3 vArchN;
varying vec3 vArchLoc;
varying float vArchCurv;
varying float vArchDrip;
varying float vArchTintV;
varying float vArchSpillV;
varying float vArchAOV;
varying float vArchBioV;
`;

const ARCH_VERT_BODY = /* glsl */ `
  #ifdef USE_INSTANCING
    vec4 archLocal = instanceMatrix * vec4(transformed, 1.0);
    mat3 archNM = mat3(modelMatrix) * mat3(instanceMatrix);
  #else
    vec4 archLocal = vec4(transformed, 1.0);
    mat3 archNM = mat3(modelMatrix);
  #endif
  vArchW = (modelMatrix * archLocal).xyz;
  vArchN = normalize(archNM * objectNormal);
  // Structure-local, not world: the organic relief has to stay welded to the
  // asset, and every structure is authored about its own origin.
  vArchLoc = archLocal.xyz;
  vArchCurv = aCurv;
  vArchDrip = aDrip;
  vArchTintV = aTint;
  vArchSpillV = aSpill;
  vArchAOV = aAO;
  vArchBioV = aBio;
`;

/** Entry point of the sky's aerial chunk, discovered rather than assumed. */
function aerialCall(color: string, worldPos: string): string {
  const two = /vec3\s+([A-Za-z_]\w*[Aa]erial\w*)\s*\(\s*vec3\s+\w+\s*,\s*vec3\s+\w+\s*\)/.exec(AERIAL_GLSL);
  if (two) return `${two[1]}(${color}, ${worldPos} - cameraPosition)`;
  const three = /vec3\s+([A-Za-z_]\w*[Aa]erial\w*)\s*\(\s*vec3\s+\w+\s*,\s*float\s+\w+\s*,\s*vec3\s+\w+\s*\)/.exec(
    AERIAL_GLSL,
  );
  if (three) return `${three[1]}(${color}, length(${worldPos} - cameraPosition), ${worldPos} - cameraPosition)`;
  return color;
}

export interface ArchMatOptions {
  /** Synthesized set name, e.g. 'plaster'. */
  set: string;
  /** World metres per texture repeat. Lower = larger features. */
  tile?: number;
  /**
   * The material's MID-TONE ALBEDO, not a tint on the map.
   *
   * The map is read relative to its own average, so this is the colour the
   * surface actually is and the map supplies the variation about it. Author it
   * straight from the palette: chitin/bone `#d8c9a4`-`#8f7d5a`, basalt
   * `#2a2622`-`#141312`, verdigris `#5f7a63`.
   */
  tint?: THREE.Color;
  /** Albedo contrast about the map's mean. >1 expands a low-variance set. */
  contrast?: number;
  /** Metalness multiplier on the ARM map's blue channel. 0 forces dielectric. */
  metal?: number;
  /**
   * Environment-map intensity. A conductor has no diffuse term at all, so the
   * probe is the ONLY thing lighting it outside the sun's specular lobe; a metal
   * left at the dielectric default reads as a black hole in the frame.
   */
  env?: number;
  /** Weight of the concentric growth-ring relief. Caps and discs only. */
  ring?: number;
  /**
   * Analytic BUILT relief family: 0 none, 1 coursed stone, 2 trowelled plaster,
   * 3 lamellar chitin, 4 weathered timber. See `archMason`.
   *
   * This is the answer to "reads as untextured clay" on everything that is not
   * grown. The triplanar set is under a pixel from eighty metres out and mips
   * to its own average; these bands are evaluated from position and are what
   * put mortar courses, trowel sweeps, lamellae and grain on a wall at the
   * range the frame is actually judged at.
   */
  mason?: number;
  /** Amplitude of the `mason` relief. 1 is as authored. */
  masonAmp?: number;
  /** Strength of the baked hemisphere AO in `aAO`. */
  ao?: number;
  /** Strength of the ungated bioluminescent wash baked into `aBio`. */
  bio?: number;
  bioColor?: THREE.Color;
  /** 0..1 ash accumulation strength. Ashlander domes want ~1, docks ~0.3. */
  ash?: number;
  /**
   * What accumulates. Ash by default — but the same integral, tinted verdigris,
   * IS the patina on oxidised bronze: it collects where ash collects, for the
   * same reason, and it is the cue that separates a metal from a brown rock.
   */
  ashColor?: THREE.Color;
  wear?: number;
  streak?: number;
  irid?: number;
  roughMul?: number;
  normalScale?: number;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  side?: THREE.Side;
  /** Vertex wind sway, for banners and hanging cloth. */
  sway?: number;
  /**
   * Analytic metre-scale shell relief, 0..1. Grown architecture only — this is
   * what keeps a Telvanni pod from mipping down to a smooth egg at range.
   */
  organic?: number;
  /** Roughness blotching, 0..1. Breaks a continuous specular streak into patches. */
  mottle?: number;
  /** Thin-shell backlight transmission, 0..1. */
  sss?: number;
  sssColor?: THREE.Color;
  /**
   * Sky-dome irradiance at the silhouette edge, 0..1. See `ARCH_SKYRIM`.
   *
   * For upward-facing surfaces whose dark shape has to separate from a dark
   * horizon — a Telvanni cap against a dusk sky is the case it exists for.
   */
  skyRim?: number;
  /** Strength of the baked `aSpill` window wash. */
  spill?: number;
  spillColor?: THREE.Color;
}

/** Shaping knobs for an emissive panel or tube. All 0..1. */
export interface GlowOptions {
  /** Break the emissive into soft-ended patches of irregular length. */
  dash?: number;
  /** Slow breathing amplitude. Fungus is alive; a lamp is not. */
  pulse?: number;
  /** Falloff toward the silhouette, so the shape has no stroked edge. */
  soft?: number;
  /**
   * Luminance at which the core starts rolling toward neutral. Default 1.05.
   *
   * A property of the SOURCE, not of the display. A forge pip is a small
   * blackbody and genuinely reads white-hot a stop over the display range; a
   * fungal rim is a dim wide emitter whose entire job is to carry the palette's
   * one saturated accent, and desaturating it at the same luminance is what
   * turned every gain in its radiance into a white line. Raise it on anything
   * whose chroma matters more than its heat.
   */
  hot?: number;
}

/**
 * Owns every architecture material and the uniforms they share.
 *
 * One instance per ArchitectureSystem; materials are cached by their full
 * option signature so a hundred urns and a dozen domes still compile a handful
 * of programs.
 */
export class ArchMaterials {
  private cache = new Map<string, THREE.MeshStandardMaterial>();
  private owned: THREE.Material[] = [];

  /** Live, shared across every architecture material. */
  readonly shared: Record<string, THREE.IUniform> = {
    uArchWet: { value: 0 },
    uArchTime: { value: 0 },
    uArchWind: { value: new THREE.Vector3(1, 0, 0) },
    uArchNight: { value: 0 },
    /** Diagnostic channel; see ARCH_SURFACE. Always 0 in a shipping frame. */
    uArchDbg: { value: 0 },
  };

  constructor(private readonly getSet: (name: string, repeat: number) => PBRSet) {}

  make(o: ArchMatOptions): THREE.MeshStandardMaterial {
    const key = JSON.stringify([
      o.set,
      o.tile ?? 1,
      o.tint?.getHex() ?? 0xffffff,
      o.ash ?? 0.5,
      o.ashColor?.getHex() ?? 0,
      o.wear ?? 0.6,
      o.streak ?? 0.7,
      o.irid ?? 0,
      o.roughMul ?? 1,
      o.normalScale ?? 1,
      o.emissive?.getHex() ?? 0,
      o.emissiveIntensity ?? 1,
      o.side ?? THREE.FrontSide,
      o.sway ?? 0,
      o.organic ?? 0,
      o.mottle ?? 0,
      o.sss ?? 0,
      o.sssColor?.getHex() ?? 0,
      o.skyRim ?? 0,
      o.spill ?? 0,
      o.spillColor?.getHex() ?? 0,
      o.contrast ?? 1.3,
      o.metal ?? 1,
      o.ring ?? 0,
      o.mason ?? 0,
      o.masonAmp ?? 1,
      o.ao ?? 1,
      o.bio ?? 0,
      o.bioColor?.getHex() ?? 0,
      o.env ?? 1,
    ]);
    const hit = this.cache.get(key);
    if (hit) return hit;

    // repeat 1: the triplanar sampler does its own scaling in world space, so
    // all this clone buys is RepeatWrapping and full anisotropy.
    const set = this.getSet(o.set, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 1,
      side: o.side ?? THREE.FrontSide,
      dithering: true,
      emissive: o.emissive ?? new THREE.Color(0, 0, 0),
      emissiveIntensity: o.emissiveIntensity ?? 1,
      envMapIntensity: o.env ?? 1,
    });

    const sway = o.sway ?? 0;
    const uniforms: Record<string, THREE.IUniform> = {
      uArchAlb: { value: set.albedo },
      uArchNrm: { value: set.normal },
      uArchArm: { value: set.arm },
      uArchScale: { value: 1 / (o.tile ?? 1) },
      // Mid-tone albedo. Defaulted to the palette's chitin/bone midpoint rather
      // than to white: with relative albedo an absent tint is no longer a no-op,
      // it is a request for a perfectly reflective surface.
      uArchTint: { value: linear(new THREE.Color(0xa89a80)) },
      uArchAshCol: { value: o.ashColor ? linear(o.ashColor) : ASH_LINEAR.clone() },
      uArchAsh: { value: o.ash ?? 0.5 },
      uArchWear: { value: o.wear ?? 0.6 },
      uArchStreak: { value: o.streak ?? 0.7 },
      uArchIrid: { value: o.irid ?? 0 },
      uArchRough: { value: o.roughMul ?? 1 },
      uArchNrmScale: { value: o.normalScale ?? 1 },
      uArchSway: { value: sway },
      uArchOrganic: { value: o.organic ?? 0 },
      uArchMottle: { value: o.mottle ?? 0 },
      uArchSSS: { value: o.sss ?? 0 },
      uArchSSSCol: { value: linear(o.sssColor ?? new THREE.Color(1, 0.48, 0.16)) },
      uArchSkyRim: { value: o.skyRim ?? 0 },
      uArchSpill: { value: o.spill ?? 0 },
      uArchSpillCol: { value: linear(o.spillColor ?? new THREE.Color(1, 0.55, 0.22)) },
      uArchContrast: { value: o.contrast ?? 1.3 },
      uArchMetal: { value: o.metal ?? 1 },
      uArchRing: { value: o.ring ?? 0 },
      uArchMason: { value: o.mason ?? 0 },
      uArchMasonAmp: { value: o.masonAmp ?? 1 },
      uArchAOStr: { value: o.ao ?? 1 },
      uArchBio: { value: o.bio ?? 0 },
      uArchBioCol: { value: linear(o.bioColor ?? new THREE.Color(0x3fd6c0)) },
    };
    if (o.tint) {
      const c = o.tint.clone().convertSRGBToLinear();
      (uniforms.uArchTint.value as THREE.Vector3).set(c.r, c.g, c.b);
    }

    // Exposed so a diagnostic pass can A/B a single term of the weathering
    // stack live, without a rebuild. Nothing at runtime reads it.
    mat.userData.archUniforms = uniforms;
    mat.userData.archSet = o.set;

    mat.onBeforeCompile = (shader) => {
      for (const k in uniforms) shader.uniforms[k] = uniforms[k];
      for (const k in this.shared) shader.uniforms[k] = this.shared[k];
      const A = aerialUniforms();
      for (const k in A) if (!(k in shader.uniforms)) shader.uniforms[k] = A[k];

      shader.vertexShader = shader.vertexShader
        .replace('void main() {', `${ARCH_VERT_PARS}\n${sway > 0 ? SWAY_PARS : ''}\nvoid main() {`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>\n${sway > 0 ? SWAY_BODY : ''}\n${ARCH_VERT_BODY}`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', `${ARCH_PARS}\n${AERIAL_GLSL}\nvoid main() {`)
        .replace('#include <map_fragment>', ARCH_SURFACE)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * gMetal;')
        .replace(
          '#include <normal_fragment_maps>',
          'normal = normalize((viewMatrix * vec4(gNrm, 0.0)).xyz);',
        )
        .replace('#include <emissivemap_fragment>', ARCH_EMISSIVE)
        .replace('#include <lights_fragment_end>', ARCH_TRANSMIT)
        .replace(
          '#include <aomap_fragment>',
          `float ambientOcclusion = gAO;
          reflectedLight.indirectDiffuse *= ambientOcclusion;
          #if defined( USE_ENVMAP ) && defined( STANDARD )
            float dotNVao = saturate( dot( geometryNormal, geometryViewDir ) );
            reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNVao, ambientOcclusion, material.roughness );
          #endif`,
        )
        .replace(
          '#include <opaque_fragment>',
          `#ifdef OPAQUE
          diffuseColor.a = 1.0;
          #endif
          gl_FragColor = uArchDbg > 0.5
            ? vec4(gDbg, 1.0)
            : vec4(${aerialCall('outgoingLight', 'vArchW')}, diffuseColor.a);`,
        );
    };
    // Programs are keyed on this; without it every material shares one cache
    // slot and the first compiled variant is handed to all of them.
    mat.customProgramCacheKey = () => key;

    this.cache.set(key, mat);
    this.owned.push(mat);
    return mat;
  }

  /**
   * Interior shell material. Deliberately near-black and matte: what sells a
   * doorway is that you cannot see into it, and the point light behind the
   * window is then the only thing that reads at night.
   */
  interior(): THREE.MeshStandardMaterial {
    const key = 'arch:interior';
    const hit = this.cache.get(key);
    if (hit) return hit;
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.085, 0.070, 0.058),
      roughness: 0.95,
      metalness: 0,
      side: THREE.FrontSide,
      dithering: true,
    });
    mat.onBeforeCompile = (shader) => {
      const A = aerialUniforms();
      for (const k in A) if (!(k in shader.uniforms)) shader.uniforms[k] = A[k];
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'varying vec3 vArchW;\nvoid main() {')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vArchW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', `varying vec3 vArchW;\n${AERIAL_GLSL}\nvoid main() {`)
        .replace(
          '#include <opaque_fragment>',
          `#ifdef OPAQUE
          diffuseColor.a = 1.0;
          #endif
          gl_FragColor = vec4(${aerialCall('outgoingLight', 'vArchW')}, diffuseColor.a);`,
        );
    };
    mat.customProgramCacheKey = () => key;
    this.cache.set(key, mat);
    this.owned.push(mat);
    return mat;
  }

  /**
   * Emissive panel behind a window or inside a brazier. Still a standard
   * material and still fogged by the shared aerial chunk — an unfogged glow at
   * 400 m is exactly the mismatch the art bible calls an instant fail.
   */
  glow(color: THREE.Color, intensity: number, o: GlowOptions = {}): THREE.MeshStandardMaterial {
    const dash = o.dash ?? 0;
    const pulse = o.pulse ?? 0;
    const soft = o.soft ?? 0;
    const hot = o.hot ?? 1.05;
    const key = `arch:glow:${color.getHexString()}:${intensity.toFixed(2)}:${dash}:${pulse}:${soft}:${hot}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: color,
      // Deliberately allowed above 1. The bloom pass keys on radiance over the
      // threshold, and an emissive clamped under it gets a hard vector edge and
      // no lobe — which is exactly how a glowing fungus ends up reading as a
      // stroked outline.
      emissiveIntensity: intensity,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
      dithering: true,
    });
    const u: Record<string, THREE.IUniform> = { uGlowMul: { value: 1 } };
    mat.userData.glowUniforms = u;
    mat.onBeforeCompile = (shader) => {
      const A = aerialUniforms();
      for (const k in A) if (!(k in shader.uniforms)) shader.uniforms[k] = A[k];
      shader.uniforms.uGlowMul = u.uGlowMul;
      shader.uniforms.uArchTime = this.shared.uArchTime;
      shader.vertexShader = shader.vertexShader
        .replace(
          'void main() {',
          'attribute float aThick;\nattribute float aLit;\nvarying vec3 vArchW;\nvarying vec3 vArchN;\nvarying float vThick;\nvarying float vLit;\nvoid main() {',
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec4 gLoc = instanceMatrix * vec4(transformed, 1.0);
            vArchN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
          #else
            vec4 gLoc = vec4(transformed, 1.0);
            vArchN = normalize(mat3(modelMatrix) * objectNormal);
          #endif
          vArchW = (modelMatrix * gLoc).xyz;
          vThick = aThick;
          vLit = aLit;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'void main() {',
          `varying vec3 vArchW;
          varying vec3 vArchN;
          varying float vThick;
          varying float vLit;
          uniform float uGlowMul;
          uniform float uArchTime;
          ${GLOW_NOISE}
          ${AERIAL_GLSL}
          void main() {`,
        )
        .replace(
          '#include <opaque_fragment>',
          `#ifdef OPAQUE
          diffuseColor.a = 1.0;
          #endif
          // A uniformly bright rectangle reads as a decal. Breaking it up in
          // world space makes it read as firelight past a shutter — the
          // brightness varies across the opening the way a real room does.
          float gN = gFbm(vArchW.xy * 5.5 + vArchW.zy * 3.7);
          // Per-panel occupancy from aLit (1 = as authored). Everything that is
          // not a window panel leaves it at 1 and is unaffected.
          float gAmt = uGlowMul * vLit * (0.45 + 0.85 * gN);

          // --- sub-pixel coverage -------------------------------------------
          //
          // A 40 cm emissive tube on a 110 m tower is a tenth of a pixel wide at
          // a kilometre, but the rasteriser still fills a whole pixel with it at
          // full radiance. That is the "jagged 1-2px cyan hairline at identical
          // intensity over the tower and the terrain" — not a depth bug, an
          // energy bug: the line was reporting a hundred times the light it
          // covers. Scaling radiance by the fraction of the pixel the tube
          // actually occupies is what a correctly filtered line does, and with
          // the bloom lobe below the result is a soft glow that fades with
          // distance instead of an aliased scratch that does not.
          float gPx = fwidth(vArchW.x) + fwidth(vArchW.y) + fwidth(vArchW.z);
          if (vThick > 0.0) gAmt *= clamp((vThick * 2.0) / max(gPx, 1e-4), 0.0, 1.0);

          // --- soft edge ------------------------------------------------------
          // Emissive geometry seen at its silhouette is thin in the view
          // direction and should fall off there. Without this the tube has a
          // hard stroked outline, which is the single strongest "vector overlay"
          // tell there is.
          float gF = 1.0;
          if (${soft.toFixed(3)} > 0.001) {
            vec3 gV = normalize(cameraPosition - vArchW);
            float gNV = abs(dot(normalize(vArchN), gV));
            gF = mix(1.0, smoothstep(0.0, 0.55, gNV) * 0.75 + 0.25, ${soft.toFixed(3)});
          }
          // --- dashes ---------------------------------------------------------
          // Irregular length, soft ends. A constant-length dash pattern is a
          // stroke style; fungus grows in patches.
          if (${dash.toFixed(3)} > 0.001) {
            float gD = gFbm(vArchW.xz * 0.55 + vArchW.y * 0.31);
            gF *= mix(1.0, smoothstep(0.30, 0.58, gD) * 0.92 + 0.08, ${dash.toFixed(3)});
          }
          // --- breathing ------------------------------------------------------
          if (${pulse.toFixed(3)} > 0.001) {
            float gPh = uArchTime * 0.42 + vArchW.y * 0.05 + gN * 2.0;
            gF *= 1.0 + ${pulse.toFixed(3)} * (0.6 * sin(gPh) + 0.4 * sin(gPh * 0.63 + 1.9));
          }

          vec3 archOut = outgoingLight * gAmt * gF;
          // --- hot cores desaturate --------------------------------------------
          //
          // A source bright enough to clip does not clip in ONE channel. Pinning
          // red at 255 while green and blue sit at 40 is what a stuck pixel looks
          // like, and it is exactly what the review measured on the forge pip: a
          // hard-edged 12x8 blob with no lobe. Rolling the excess toward neutral
          // at constant luminance is what a real emitter does above the display
          // range — the core reads white-hot, the falloff keeps the hue, and the
          // bloom pass gets a gradient instead of a step.
          float gL = dot(archOut, vec3(0.2126, 0.7152, 0.0722));
          archOut = mix(archOut, vec3(gL), clamp(gL - ${hot.toFixed(3)}, 0.0, 1.0) * 0.55);
          gl_FragColor = vec4(${aerialCall('archOut', 'vArchW')}, diffuseColor.a);`,
        );
    };
    mat.customProgramCacheKey = () => key;
    this.cache.set(key, mat);
    this.owned.push(mat);
    return mat;
  }

  setWetness(w: number): void {
    this.shared.uArchWet.value = w;
  }

  /** 0 = full daylight, 1 = lamps lit. Gates the baked window spill. */
  setNight(n: number): void {
    this.shared.uArchNight.value = n;
  }

  /** Diagnostic channel; 0 = off. See ARCH_SURFACE for the mode list. */
  setDebug(mode: number): void {
    this.shared.uArchDbg.value = mode;
  }

  setTime(t: number, windX: number, windZ: number, speed: number): void {
    this.shared.uArchTime.value = t;
    (this.shared.uArchWind.value as THREE.Vector3).set(windX, speed, windZ);
  }

  dispose(): void {
    for (const m of this.owned) m.dispose();
    this.owned.length = 0;
    this.cache.clear();
  }
}

const GLOW_NOISE = /* glsl */ `
float gHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float gVal(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x),
             mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float gFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * gVal(p); p *= 2.11; a *= 0.5; }
  return s;
}
`;

const SWAY_PARS = /* glsl */ `
attribute float aSway;
uniform float uArchTime;
uniform vec3 uArchWind;
uniform float uArchSway;
`;

/**
 * Cloth sway.
 *
 * `aSway` is baked per vertex: 0 where the cloth is nailed to its pole, 1 at
 * the free hem. Driving amplitude from that rather than from a local
 * coordinate means the cloth can be merged into a building at any offset and
 * still flap about the right edge. The phase runs along the cloth so the
 * result is a travelling ripple, not a rigid rotation.
 */
const SWAY_BODY = /* glsl */ `
  {
    float amp = uArchSway * aSway * (0.35 + 0.65 * clamp(uArchWind.y / 12.0, 0.0, 1.0));
    float ph = uArchTime * (2.1 + uArchWind.y * 0.28)
             - dot(transformed.xz, uArchWind.xz) * 2.4 + transformed.y * 1.1;
    float w = sin(ph) + 0.45 * sin(ph * 2.13 + 1.7);
    transformed.x += uArchWind.x * amp * w * 0.5;
    transformed.z += uArchWind.z * amp * w * 0.5;
    transformed.y -= abs(w) * amp * 0.14;
  }
`;
