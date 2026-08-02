import * as THREE from 'three';
// Read-only import of the prepass fragment contract. Nothing under src/render
// is modified; the point is that the MRT layout has exactly one definition.
import { PREPASS_FRAG } from '../render/shaders';
import { LMIN, MAX_DEPTH, RM_R, RM_X, RM_Z } from './Heightfield';

export interface TerrainUniforms {
  [k: string]: THREE.IUniform;
  uHeight: THREE.IUniform<THREE.Texture | null>;
  uData: THREE.IUniform<THREE.Texture | null>;
  uAlbArr: THREE.IUniform<THREE.Texture | null>;
  uNrmArr: THREE.IUniform<THREE.Texture | null>;
  uArmArr: THREE.IUniform<THREE.Texture | null>;
  uExtent: THREE.IUniform<number>;
  uRes: THREE.IUniform<number>;
  uCell: THREE.IUniform<number>;
  uGridSeg: THREE.IUniform<number>;
  uEye: THREE.IUniform<THREE.Vector3>;
  uMorph: THREE.IUniform<Float32Array>;
  uMidScale: THREE.IUniform<number>;
  uDetailScale: THREE.IUniform<number>;
  uFarScale: THREE.IUniform<number>;
  uMacroScale: THREE.IUniform<number>;
  uMesoTop: THREE.IUniform<number>;
  uMesoAmp: THREE.IUniform<number>;
  uPomStrength: THREE.IUniform<number>;
  uWetness: THREE.IUniform<number>;
  /** Weather extinction, 0 clear .. 1 full ash storm. Drives the aerial pre-emphasis. */
  uHaze: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
  uRmCenter: THREE.IUniform<THREE.Vector2>;
  uRmRadius: THREE.IUniform<number>;
  uLavaColor: THREE.IUniform<THREE.Color>;
  uDepthOffset: THREE.IUniform<number>;
  uFallbackFog: THREE.IUniform<THREE.Color>;
  uFallbackFogDensity: THREE.IUniform<number>;
}

export function makeTerrainUniforms(extent: number, res: number, cell: number, seg: number): TerrainUniforms {
  return {
    uHeight: { value: null },
    uData: { value: null },
    uAlbArr: { value: null },
    uNrmArr: { value: null },
    uArmArr: { value: null },
    uExtent: { value: extent },
    uRes: { value: res },
    uCell: { value: cell },
    uGridSeg: { value: seg },
    uEye: { value: new THREE.Vector3() },
    uMorph: { value: new Float32Array((MAX_DEPTH + 1) * 2) },
    // Texture-space frequencies: 8 m, 0.5 m, 72 m and 200 m periods.
    uMidScale: { value: 1 / 8 },
    // 0.28 m per tile. At 0.5 m a 512-texel set put one texel at 1 mm, which is
    // finer than anything a pixel resolves past arm's length, so the whole band
    // was already mipping toward its mean inside the range it was supposed to
    // own. Halving the tile puts the map's own features at 1-4 cm of world —
    // grain, not blobs — which is the scale rule 7 is asking about.
    uDetailScale: { value: 1 / 0.28 },
    // The far band exists because of a sampling fact, not a taste one. The mid
    // band tiles at 8 m over a 512-texel set, i.e. 64 texels per metre; past
    // roughly 120 m a screen pixel covers more than sixteen of them and the
    // whole layer has mipped down to its own mean. Every shot in the review
    // reported the same thing at that range — "flat matte surface shaded only by
    // a normal-dot-light gradient", "literally zero high-frequency content" —
    // because nothing in the shader carried detail there: the 0.5 m grain stops
    // at 48 m, the meso octaves were killed at 620 m, and a 200 m tint is smooth
    // by construction. At 72 m per tile the same texture's own features land at
    // 1-4 m of world, which still subtends pixels at half a kilometre.
    uFarScale: { value: 1 / 72 },
    uMacroScale: { value: 1 / 200 },
    // Longest wavelength of the per-pixel relief band. It starts where the
    // baked heightfield stops: LMIN * 2 is where Noise.bandGate has faded the
    // last geometric octave to nothing, so the two bands butt together with no
    // hole and no overlap.
    // Longest wavelength of the per-pixel relief band, raised from LMIN*2 (12 m)
    // to 22 m. The band no longer starts exactly where the bake stops, and that
    // is deliberate: Noise.bandGate rolls the last geometric octaves off
    // gradually rather than at a step, so the 12-22 m span is present in the
    // heightfield only at heavily reduced amplitude — on an eroded plain,
    // effectively not at all. Overlapping the two by an octave fills that and
    // is what gives a flat at 100 m any large-scale form to shade.
    uMesoTop: { value: 22 },
    // Amplitude of the band's first octave, and it has to track uMesoTop.
    // Roughness is amplitude over wavelength, not amplitude: when LMIN halved
    // (see Heightfield.LMIN) this band's top octave moved from 24 m to 12 m, and
    // holding 3.1 m of amplitude there would have doubled its slope — a 14-degree
    // per-pixel corrugation laid over geometry that now carries the 12 m band
    // itself. Scaling with the wavelength keeps the handoff seamless: the same
    // surface roughness, just divided differently between the bake and the pixel.
    // Tracks uMesoTop so the band's surface roughness (amplitude over
    // wavelength) is unchanged at 0.10 — the top octave still tilts the normal
    // by about six degrees, it just does it over 22 m instead of 12.
    uMesoAmp: { value: 2.2 },
    uPomStrength: { value: 0.010 },
    uWetness: { value: 0 },
    uHaze: { value: 0 },
    uTime: { value: 0 },
    uRmCenter: { value: new THREE.Vector2(RM_X, RM_Z) },
    uRmRadius: { value: RM_R },
    uLavaColor: { value: new THREE.Color(6.5, 1.35, 0.24) },
    uDepthOffset: { value: 0.45 },
    uFallbackFog: { value: new THREE.Color(0.42, 0.24, 0.18) },
    uFallbackFogDensity: { value: 0.00035 },
  };
}

const VERT_PARS = /* glsl */ `
uniform sampler2D uHeight;
uniform float uExtent;
uniform float uRes;
uniform float uGridSeg;
uniform vec3 uEye;
uniform vec2 uMorph[${MAX_DEPTH + 1}];
attribute vec4 iNode;

float thTexel(ivec2 t) {
  return texelFetch(uHeight, clamp(t, ivec2(0), ivec2(int(uRes) - 1)), 0).r;
}

// Uniform cubic B-spline basis and its derivative. Mirrors Heightfield.bsW/bsD.
vec4 bsW(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  float it = 1.0 - t;
  return vec4(it * it * it, 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) / 6.0;
}
vec4 bsD(float t) {
  float t2 = t * t;
  float it = 1.0 - t;
  return vec4(-it * it, 3.0 * t2 - 4.0 * t, -3.0 * t2 + 2.0 * t + 1.0, t2) * 0.5;
}

/**
 * Manual bicubic B-spline on a nearest-filtered R32F texture, returning the
 * height and both world-space slopes in one 4x4 fetch. Byte-identical to the
 * CPU Heightfield.heightAt/computeNormal, which is what keeps physics and
 * rendering on the same surface. (Float linear filtering is an optional WebGL2
 * extension and half-float lacks the mantissa for 1500 m of relief, so the
 * filter has to be done by hand regardless.)
 *
 * It replaces manual bilinear plus four extra bilinear taps for a central
 * difference, so it is *cheaper* — sixteen fetches per vertex against twenty —
 * as well as correct. Bilinear reconstruction is piecewise planar: its
 * curvature is an impulse on every grid line, which the renderer draws as a
 * fan of flat plates in the near field and a comb in the height statistics at
 * exactly the sample spacing. The B-spline is C2, so there is no grid to see,
 * and its analytic gradient is the true normal of the surface being drawn
 * rather than the chord of a surface that is not.
 */
vec3 thAtD(vec2 w) {
  float g = (uRes - 1.0) / (2.0 * uExtent);
  vec2 gp = clamp((w + uExtent) * g, vec2(0.0), vec2(uRes - 1.0001));
  vec2 fl = floor(gp);
  vec2 t = gp - fl;
  ivec2 i0 = ivec2(fl) - 1;
  vec4 wx = bsW(t.x);
  vec4 wy = bsW(t.y);
  vec4 dwx = bsD(t.x);
  vec4 dwy = bsD(t.y);

  // Written out rather than looped. The natural form accumulates wy[j] * row(j)
  // over a four-iteration loop, which indexes a vec4 by a loop variable; that is
  // legal in GLSL ES 3.00 but it is also the construct most likely to be
  // lowered badly, and expressing the same thing as three dot products against
  // constant swizzles is both shorter and free of the question.
  vec4 s0 = vec4(thTexel(i0 + ivec2(0, 0)), thTexel(i0 + ivec2(1, 0)), thTexel(i0 + ivec2(2, 0)), thTexel(i0 + ivec2(3, 0)));
  vec4 s1 = vec4(thTexel(i0 + ivec2(0, 1)), thTexel(i0 + ivec2(1, 1)), thTexel(i0 + ivec2(2, 1)), thTexel(i0 + ivec2(3, 1)));
  vec4 s2 = vec4(thTexel(i0 + ivec2(0, 2)), thTexel(i0 + ivec2(1, 2)), thTexel(i0 + ivec2(2, 2)), thTexel(i0 + ivec2(3, 2)));
  vec4 s3 = vec4(thTexel(i0 + ivec2(0, 3)), thTexel(i0 + ivec2(1, 3)), thTexel(i0 + ivec2(2, 3)), thTexel(i0 + ivec2(3, 3)));

  vec4 rv = vec4(dot(s0, wx), dot(s1, wx), dot(s2, wx), dot(s3, wx));
  vec4 rd = vec4(dot(s0, dwx), dot(s1, dwx), dot(s2, dwx), dot(s3, dwx));

  return vec3(dot(rv, wy), dot(rd, wy) * g, dot(rv, dwy) * g);
}
`;

const VERT_BODY = /* glsl */ `
  float invSeg = 1.0 / uGridSeg;
  vec2 gpos = position.xz * uGridSeg;
  vec2 w0 = iNode.xy + gpos * invSeg * iNode.z;
  // XZ metric, matching Quadtree.visit exactly. See the crack proof there.
  //
  // uEye, NOT cameraPosition. three rebinds cameraPosition to whatever camera
  // is rendering, so in the shadow and prepass passes it is the light's or the
  // prepass camera's origin — and the morph factor derived from it then differs
  // from the one the main pass used. The caster and the receiver are therefore
  // *different surfaces*, offset by exactly the fine-to-coarse lattice delta:
  // a perfectly periodic, two-cell checkerboard of height error that the sun
  // renders as a regular grid of self-shadowed blobs across every slope in the
  // frame. uEye is written once per selection, so every pass in a frame morphs
  // identically and the caster is the surface it is shadowing.
  float dist0 = distance(uEye.xz, w0);
  int lvl = int(iNode.w + 0.5);
  vec2 mp = uMorph[lvl];
  float mk = clamp((dist0 - mp.x) * mp.y, 0.0, 1.0);
  // Smoothstep, not the raw ramp, and this single line is what removes every
  // "chunk seam" in the review.
  //
  // The linear clamp is continuous in eye distance but its *derivative* jumps at
  // both ends of the morph band. The vertex slides along the surface at a rate
  // proportional to that derivative, so the reconstructed height — and with it
  // the analytic normal below, which is a function of the morphed position —
  // has a kink on the two surfaces dist0 == mp.x and dist0 == morphEnd. Those
  // are iso-distance cylinders around the eye, so the kink paints a shading
  // discontinuity along a *circle centred on the camera*: on a smooth dome it
  // reads as a perfectly straight hairline crease that obviously cannot be
  // geology, on an open flat it reads as concentric arcs that cross and look
  // like a quad lattice of chunk boundaries, and on a distant ridge it reads as
  // faceted plates changing shade across a mesh edge. It is not a crack — the
  // mesh is watertight — it is a Mach band, which is why it survives at
  // one-pixel width and 47 levels of contrast.
  //
  // smoothstep has the same endpoints (mk = 0 at mp.x, mk = 1 at morphEnd), so
  // the crack proof in Quadtree is untouched, and zero derivative at both, so
  // the morph is C1 across the ring and there is nothing left to see.
  mk = mk * mk * (3.0 - 2.0 * mk);
  vec2 gm = mix(gpos, floor(gpos * 0.5) * 2.0, mk);
  vec2 wxz = iNode.xy + gm * invSeg * iNode.z;
  vec3 hS = thAtD(wxz);
  // No skirt term. The grid is SEG+1 with position.y == 0 everywhere; the mesh
  // is the reconstructed surface and nothing else. See buildGrid for why the
  // curtain had to go — it was the seam, not the cure for it.
  vec3 tPos = vec3(wxz.x, hS.x, wxz.y);

  // Exact normal of the reconstructed surface. There is deliberately no
  // LOD-dependent widening here any more: the baked field is band-limited well
  // above the sample spacing, so there is nothing left for a wider stencil to
  // filter out, and a differencing width that changed with node size meant the
  // shading normal changed as a node crossed an LOD ring.
  vec3 tNrm = normalize(vec3(-hS.y, 1.0, -hS.z));
`;

const FRAG_PARS = /* glsl */ `
uniform sampler2D uData;
uniform sampler2DArray uAlbArr;
uniform sampler2DArray uNrmArr;
uniform sampler2DArray uArmArr;
uniform float uExtent;
uniform vec3 uEye;
uniform float uMidScale;
uniform float uDetailScale;
uniform float uFarScale;
uniform float uMacroScale;
uniform float uMesoTop;
uniform float uMesoAmp;
uniform float uPomStrength;
uniform float uWetness;
uniform float uHaze;
uniform float uTime;
uniform vec2 uRmCenter;
uniform float uRmRadius;
uniform vec3 uLavaColor;
uniform vec3 uFallbackFog;
uniform float uFallbackFogDensity;

varying vec3 vWPos;
varying vec3 vWNrm;
varying float vCamDist;

// ------------------------------------------------------- fragment budget (TQ)
//
// This shader had no quality tiers at all. Every one of the four presets ran
// the identical fragment stage — the same sixteen-tap anisotropy, the same
// four-octave relief band, the same parallax march, the same eight analytic
// detail bands — and the only thing a tier changed about terrain was how many
// pixels it was asked to fill. Terrain covers most of a landscape frame, so
// that made the tier control a resolution slider with a name on it, and it is
// most of why the low tier misses 60 as badly as the high one does.
//
// A per-pixel budget cannot be a uniform. Every knob below removes CODE, not
// work: a preprocessor branch that deletes a band deletes its live registers
// with it, and on this shader that is the point. A stage this large is
// occupancy-bound before it is ALU- or texture-bound — the compiler spills, few
// waves are resident, and nothing hides a texture fetch. Removing a band with a
// runtime branch leaves the registers allocated and buys a fraction of what
// removing its text does. So these are defines, resolved at compile time, and a
// tier change recompiles.
//
// Measured, one vantage, everything else held fixed: the same frame at TQ3 and
// TQ1 came out at 164 ms and 69 ms. Nothing else in this renderer has a 2.4x in
// it, which is why this file is where the framerate work had to happen.
//
// Every knob is also a CONTINUOUS quantity (a tap budget, an octave count, a
// fade distance), never a switch on something the eye tracks across a tier
// change. A tier may make the same picture softer; it may not move a material
// boundary or flip a projection.
//
// Each knob is wrapped in its own ifndef so a single one can be overridden from
// the host — see TerrainMaterials.setBudget. That exists because working out
// what a knob costs otherwise means one full rebuild per knob, and the answers
// are not guessable: POM reads like the expensive one and is not, while the
// splat's layer-count fade reads like a detail and is most of the difference
// between the two ends of the table.
#ifndef TQ
#define TQ 2
#endif

#if TQ >= 3
  // Photo mode. Nothing is cut; this is the shader as authored.
  #define TQD_ANISO_NEAR 16.0
  #define TQD_MODAN      8.0
  #define TQD_MESO_OCT   4
  #define TQD_POM        1
  #define TQD_CELL_MID   1
  #define TQD_CELL_FAR   1
  #define TQD_GRIT2      1
  #define TQD_DEBRIS     1
  #define TQD_GRAIN      1
  #define TQD_FAR        1
  #define TQD_CRUST      1
  #define TQD_RIPPLE     1
  #define TQD_STRATA     1
  #define TQD_COLUMNAR   1
  #define TQD_RILL       1
  #define TQD_SPLATJIT   1
  #define TQD_DROP3_A    110.0
  #define TQD_DROP3_B    240.0
  #define TQD_MONO_A     420.0
  #define TQD_MONO_B     950.0
#elif TQ == 2
  // The 60 fps tier, and the one the game is judged on.
  //
  // Chosen from a measured price list, not from taste. Each knob was dialled on
  // its own against an otherwise-TQ3 shader at the dawn vantage, re-baselining
  // between every one so a drifting machine could not be read as a saving. The
  // noise floor on that method is about +/-10%, so only the entries above it
  // are quoted as fact:
  //
  //     splat collapses to one layer at 150 m rather than 420 m ... 33%
  //     relief band 4 octaves -> 2 ......................... 14%
  //     near anisotropy 16 -> 4 ............................ 12%
  //     de-tiling second cell off .......................... 10%
  //     third splat layer dropped at 40 m rather than 110 ... 9%
  //     wind ripple off ..................................... 9%
  //     parallax occlusion off .............................. 5%
  //     grit second octave off .............................. 5%
  //     strata off .......................................... 5%
  //     everything else ................................. under noise
  //
  // The uncomfortable result is that this shader is already well-priced: the
  // knobs that are cheap to LOOK at are also cheap to RUN, and the four
  // expensive ones are all things the art bible names. So the cuts here are the
  // ones where a measured saving meets a defensible loss, and no more:
  //
  //  - MESO_OCT 4 -> 3 drops the 1.6 m octave and nothing else. The band is a
  //    constant amplitude-over-wavelength ladder, so the octave removed is the
  //    one carrying the least relief, and the 0.24 m grit band and the 0.7 m
  //    wind ripple both sit inside its wavelength and are still on.
  //  - GRIT2 off drops the 9.5 cm octave; the 24 cm one stays, and the 0.28 m
  //    detail-band tile covers the same scale from a texture rather than from
  //    four hashes.
  //  - ANISO_NEAR 16 -> 10. The distance ramp already takes the budget to 2 by
  //    260 m, and limitAniso degenerates to isotropic at 2.5x the budget, so
  //    this only touches ground between about 15 and 40 m — and it halves the
  //    worst-case tap count on exactly the grazing pixels that have the most of
  //    them.
  //  - DROP3 and MONO pulled a long way in — the collapse to one layer now
  //    completes at 430 m instead of 950. This is the 33% entry, and taking it
  //    was only possible after the thing that made it fail last time was fixed
  //    rather than avoided: the collapse's visible cost was never the single
  //    layer, it was the layer INDEX flipping hard along the argmax contour and
  //    taking the whole material tint with it. The tint now cross-fades across
  //    that contour at no fetch cost (see gMonoTint in sampleTriple), so what
  //    the collapse actually removes is texture detail on an 8 m tile that has
  //    mipped to its own mean at these ranges, and the far band — which is what
  //    texturing there is past 110 m — is untouched.
  //
  // POM, the de-tiling cell blend, the ripple, the strata, the columnar
  // jointing and the rill band are all kept at this tier and all cost real
  // milliseconds. They are rules 7, 4 and 6 of the art bible respectively, and
  // the tier that is allowed to drop them is the one below this one.
  #define TQD_ANISO_NEAR 10.0
  #define TQD_MODAN      4.0
  #define TQD_MESO_OCT   3
  #define TQD_POM        1
  #define TQD_CELL_MID   1
  #define TQD_CELL_FAR   1
  #define TQD_GRIT2      0
  #define TQD_DEBRIS     1
  #define TQD_GRAIN      1
  #define TQD_FAR        1
  #define TQD_CRUST      1
  #define TQD_RIPPLE     1
  #define TQD_STRATA     1
  #define TQD_COLUMNAR   1
  #define TQD_RILL       1
  #define TQD_SPLATJIT   1
  #define TQD_DROP3_A    70.0
  #define TQD_DROP3_B    155.0
  #define TQD_MONO_A     190.0
  #define TQD_MONO_B     430.0
#elif TQ == 1
  #define TQD_ANISO_NEAR 6.0
  #define TQD_MODAN      3.0
  #define TQD_MESO_OCT   2
  #define TQD_POM        0
  #define TQD_CELL_MID   1
  #define TQD_CELL_FAR   0
  #define TQD_GRIT2      0
  #define TQD_DEBRIS     1
  #define TQD_GRAIN      1
  #define TQD_FAR        1
  #define TQD_CRUST      0
  #define TQD_RIPPLE     1
  #define TQD_STRATA     1
  #define TQD_COLUMNAR   1
  #define TQD_RILL       1
  #define TQD_SPLATJIT   1
  #define TQD_DROP3_A    45.0
  #define TQD_DROP3_B    100.0
  #define TQD_MONO_A     120.0
  #define TQD_MONO_B     280.0
#else
  #define TQD_ANISO_NEAR 4.0
  #define TQD_MODAN      2.0
  #define TQD_MESO_OCT   2
  #define TQD_POM        0
  #define TQD_CELL_MID   0
  #define TQD_CELL_FAR   0
  #define TQD_GRIT2      0
  #define TQD_DEBRIS     0
  #define TQD_GRAIN      1
  #define TQD_FAR        1
  #define TQD_CRUST      0
  #define TQD_RIPPLE     1
  #define TQD_STRATA     0
  #define TQD_COLUMNAR   1
  #define TQD_RILL       1
  #define TQD_SPLATJIT   0
  #define TQD_DROP3_A    20.0
  #define TQD_DROP3_B    55.0
  #define TQD_MONO_A     70.0
  #define TQD_MONO_B     190.0
#endif

// A host override (material.defines) lands ahead of this file, so each knob
// takes the tier's value only if nobody has already supplied one.
#ifndef TQ_ANISO_NEAR
#define TQ_ANISO_NEAR TQD_ANISO_NEAR
#endif
#ifndef TQ_MODAN
#define TQ_MODAN TQD_MODAN
#endif
#ifndef TQ_MESO_OCT
#define TQ_MESO_OCT TQD_MESO_OCT
#endif
#ifndef TQ_POM
#define TQ_POM TQD_POM
#endif
#ifndef TQ_CELL_MID
#define TQ_CELL_MID TQD_CELL_MID
#endif
#ifndef TQ_CELL_FAR
#define TQ_CELL_FAR TQD_CELL_FAR
#endif
#ifndef TQ_GRIT2
#define TQ_GRIT2 TQD_GRIT2
#endif
#ifndef TQ_DEBRIS
#define TQ_DEBRIS TQD_DEBRIS
#endif
#ifndef TQ_CRUST
#define TQ_CRUST TQD_CRUST
#endif
#ifndef TQ_GRAIN
#define TQ_GRAIN TQD_GRAIN
#endif
#ifndef TQ_FAR
#define TQ_FAR TQD_FAR
#endif
#ifndef TQ_RIPPLE
#define TQ_RIPPLE TQD_RIPPLE
#endif
#ifndef TQ_STRATA
#define TQ_STRATA TQD_STRATA
#endif
#ifndef TQ_COLUMNAR
#define TQ_COLUMNAR TQD_COLUMNAR
#endif
#ifndef TQ_RILL
#define TQ_RILL TQD_RILL
#endif
#ifndef TQ_SPLATJIT
#define TQ_SPLATJIT TQD_SPLATJIT
#endif
#ifndef TQ_DROP3_A
#define TQ_DROP3_A TQD_DROP3_A
#endif
#ifndef TQ_DROP3_B
#define TQ_DROP3_B TQD_DROP3_B
#endif
#ifndef TQ_MONO_A
#define TQ_MONO_A TQD_MONO_A
#endif
#ifndef TQ_MONO_B
#define TQ_MONO_B TQD_MONO_B
#endif

// ------------------------------------------------------------------ QA channel
//
// Zero at every tier and in every shipped build; the whole block below compiles
// out. It exists because attributing a terrain defect to one of a dozen bands by
// reading the image is guesswork, and guessing wrong has cost this file more
// rounds than any other single thing. setBudget('TQ_DBG', '3') recompiles the
// shaded material with one intermediate written straight to the film, so a
// suspect is confirmed or cleared in one capture. See tools/_tdbg.mjs.
//
//   1 splat layer index, false colour   2 albedo before lighting
//   3 shading normal                    4 uData (flow, curvature, shelter)
//   5 loose/deposition channel          6 pixel footprint, log2 metres
#ifndef TQ_DBG
#define TQ_DBG 0
#endif

// Attribution switch — see FRAG_SPLAT_STUB. QA only; no tier sets it.
#ifndef TQ_NOSPLAT
#define TQ_NOSPLAT 0
#endif

// Chroma ablation. Replaces the finished terrain albedo with its own Rec.709
// luminance, leaving value, relief, roughness, lighting and the air untouched.
//
// It answers the one question a palette measurement on a shaded frame cannot:
// how much of the frame's saturation is the GROUND, and how much is the light
// and the air it is seen through. Setting every LAYER_TINT to a grey is not the
// same experiment — the baked library maps carry chroma of their own — and
// without the separation, a terrain-material round can spend itself pushing on
// a number that is not its to move. Measured this way on the gate's five
// vantages, a perfectly achromatic ground still renders dark-ground relative
// saturation at 0.26-0.42, which is the floor this stage cannot go below and
// the reason the target band belongs partly to lighting and atmosphere.
//
// QA only, via setBudget('TQ_MONOALB', '1'). No tier sets it.
#ifndef TQ_MONOALB
#define TQ_MONOALB 0
#endif

// Restores the mid band's position-proportional scale jitter, which shipped
// until the streak fix. QA only, so the A/B that attributes the directional
// comb stays runnable: setBudget('TQ_MIDJIT', '1'). See the note beside midS.
#ifndef TQ_MIDJIT
#define TQ_MIDJIT 0
#endif

// Taps in the analytic anisotropic filter the near bands are evaluated through.
// 3 is the shipping value; 1 collapses tValD3 to a point sample and anF to fpH,
// i.e. restores the pre-fix near plane, so the A/B stays runnable. QA only —
// intermediate values are not meaningful, the helper unrolls three taps.
#ifndef TQ_ANTAP
#define TQ_ANTAP 3
#endif

vec3 gTerrNormal;
#if TQ_DBG
vec3 gTerrDbg;
#endif
float gTerrRough;
float gTerrAO;
float gLava;

// Grain-scale perturbation of the height-blend threshold, set once in
// FRAG_SPLAT and read inside sampleTriple. See the note at its assignment.
float gHBJit;

// How far the height blend has collapsed toward the plain weight blend, 0 in
// the near field and 1 once the displacement channel driving the interlock is
// under the pixel. Set in FRAG_SPLAT; see the long note there.
float gHBLin;

// The obvious two-component variant of this hash collapses: after the shared
// dot() offset both channels carry the same large term, the product is
// dominated by its square, and the result degenerates into a smooth function of
// (x+y) — i.e. diagonal banding rather than white noise. Go through three
// components so the channels stay independent.
float tHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float tVal(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = tHash(i);
  float b = tHash(i + vec2(1.0, 0.0));
  float c = tHash(i + vec2(0.0, 1.0));
  float d = tHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float ss(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Per-octave rotation. Value noise is built on the integer lattice: its cells,
// its interpolation seams and its extrema all line up with x and y, and stacking
// octaves that share that orientation reinforces the alignment instead of
// averaging it out. The visible result is a regular orthogonal (or, once the
// bilinear cells beat against each other, hexagonal-looking) lattice of blobs
// with a period locked to the base cell — which is exactly what an FFT of the
// lit terrain was reporting as a single dominant peak.
//
// 0.5171 rad per octave, whose ratio to pi/2 is irrational, so no two octaves
// ever share an axis. Lacunarity is 2.17 rather than 2.03 for the same reason:
// at exactly 2 the cell lattices are nested and re-align every octave.
#define TROT mat2(0.86924, -0.49435, 0.49435, 0.86924)

// ---------------------------------------------------------------- de-tiling
//
// A tiled texture read through a fixed UV frame repeats on a perfect lattice,
// and at 8 m tiles that lattice is legible across an entire frame — the
// "wallpaper" failure. Three scales stacked on top of each other do not fix it,
// because all three share the same orientation and origin.
//
// The fix is Heitz-Neyret in spirit: cut the plane into cells, give each cell
// its own random rotation and translation of the texture domain, and blend
// across cell boundaries. The lattice cannot survive because there is no longer
// one lattice — each cell carries a differently oriented copy and the repeat
// period becomes the cell lattice, which is itself jittered.
//
// Two taps, not the canonical three. The cells are found by a jittered-grid
// nearest/second-nearest search, so the blend weight of the runner-up is zero
// except in a narrow band along the cell walls; the second fetch is branched out
// entirely for the ~80% of pixels that sit inside a cell. That keeps the average
// texture cost near 1.2x rather than 3x, which is what the frame budget allows.
//
// Cell pitch is deliberately not a multiple of the 8 m texture period: 23 m is
// just under three tiles, so a cell never contains a whole number of repeats.
#define DT_CELL 23.0

// Two decorrelated values out of one hash pipeline rather than two runs of the
// scalar one. The nine-cell site search below is the single most expensive
// block of ALU in this shader — eighteen scalar hashes before anything is
// fetched — and half of that was the pipeline being set up twice per cell to
// produce two numbers it could have produced together. The site positions this
// lays down are a different arrangement from the old pair, which is of no
// consequence: they are arbitrary by construction, and only their statistics
// matter.
vec2 dtHash2(vec2 c) {
  vec3 q = fract(vec3(c.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}

// Returns the two nearest cell ids and the RAW wall distance d2 - d1, not a
// blend weight. The two consumers of this lattice — the 8 m mid band and the
// 72 m far band — need different blend widths at different ranges (see the call
// site), and baking one width in here is what made the far band's cell walls a
// hard discontinuity.
void dtCells(vec2 g, out vec2 cA, out vec2 cB, out float dd) {
  vec2 gi = floor(g);
  // Ranked on squared distance and rooted twice at the end rather than nine
  // times inside the loop. Ordering is identical — x -> x*x is monotone on the
  // non-negative reals — and only the two survivors are ever converted, so
  // seven of the nine square roots were being computed for a comparison that
  // did not need them.
  float d1 = 1e18;
  float d2 = 1e18;
  cA = gi;
  cB = gi + 1.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = gi + vec2(float(i), float(j));
      vec2 pc = c + 0.5 + (dtHash2(c) - 0.5) * 0.85;
      vec2 e = g - pc;
      float d = dot(e, e);
      if (d < d1) { d2 = d1; cB = cA; d1 = d; cA = c; }
      else if (d < d2) { d2 = d; cB = c; }
    }
  }
  dd = sqrt(d2) - sqrt(d1);
}

// Rotation *and*, for half the cells, a reflection.
//
// Rotation alone is not enough de-correlation to kill a readable repeat: every
// cell still carries a congruent copy of the same image, and the eye tracks a
// distinctive blob through a rotation without effort — which is what the review
// read as tiling at midground distance. A reflection produces an image that is
// not congruent to the original, costs one hash, and keeps the matrix
// orthogonal (det = -1 instead of +1), so its transpose is still its inverse
// and the tangent-normal counter-rotation at the call sites is unchanged.
mat2 dtRot(vec2 c) {
  float a = tHash(c + 5.17) * 6.2831853;
  float s = sin(a);
  float k = cos(a);
  float f = tHash(c + 47.3) < 0.5 ? -1.0 : 1.0;
  return mat2(k * f, -s, s * f, k);
}

// Per-cell scale, +/- 20%. The smooth scaleJ field already varies the mid
// tiling, but it varies it *slowly*, so two neighbouring repeats are at
// near-identical scale and still read as the same stamp. A per-cell jump breaks
// that, and because it is folded into the same matrix the derivatives and the
// parallax offset scale with it automatically.
//
// It is faded out with distance (k), and that is a correctness fix rather than a
// saving. A scale factor multiplies the UV derivatives, so it moves the mip
// level the hardware picks — by up to two thirds of a level between the extreme
// cells. Two adjacent cells therefore return the texture filtered to two
// different degrees, which means two different amounts of surviving contrast and
// two different local *means*. Near the camera that is invisible because the mip
// is sharp in both. Past a couple of hundred metres, where the whole tile is
// being read from deep in the chain, it is a flat brightness step across a
// straight Voronoi wall — and a field of those is precisely the "large flat
// facets", "faceted low-poly rock" the review measured on the cone. Confirmed by
// bisection: raising DT_CELL from 23 m to 55 m scaled the visible plates by the
// same 2.4x.
float dtScl(vec2 c, float k) {
  return mix(1.0, 0.82 + 0.40 * tHash(c + 63.1), k);
}

vec2 dtOff(vec2 c) {
  return dtHash2(c + 31.7) * 41.0;
}

// Value noise with its analytic gradient: (value, d/dp.x, d/dp.y). The quintic
// smoothstep has a closed-form derivative, so a relief field costs one tap set
// rather than the four a finite difference would need — and unlike a finite
// difference it stays exact as the octave shrinks towards the pixel.
vec3 tValD(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = tHash(i);
  float b = tHash(i + vec2(1.0, 0.0));
  float c = tHash(i + vec2(0.0, 1.0));
  float d = tHash(i + vec2(1.0, 1.0));
  float k1 = b - a;
  float k2 = c - a;
  float k3 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k3 * u.x * u.y,
              du.x * (k1 + k3 * u.y),
              du.y * (k2 + k3 * u.x));
}

// Three-tap line integral of tValD along one direction, and the reason the near
// plane can hold grain at all.
//
// Every analytic band in this shader is a POINT evaluation with no filter of any
// kind, so the only honest gate on one is the MAJOR axis of the pixel footprint
// (fpH) — anything shorter than that folds. That is correct and it is also what
// emptied the near plane. On ground seen from eye height the major axis grows as
// 1/sin(grazing angle): at 1.8 m of eye height it is 13 mm at four metres, 70 mm
// at ten and a quarter of a metre at twenty, so the two bands that OWN the first
// ten metres — grit at 24 cm and debris at 55 cm — closed their own gates about
// five metres in front of the camera's feet, on every surface that is not
// pointing straight at the lens. The detail was authored, priced and shipped;
// its anti-alias gate simply shut it off over the whole bottom third of the
// frame. Measured on the stage-6 plates: a 200x150 patch of near ground held a
// high-pass sigma of 1.2-6 levels where the same shader at four metres holds 15.
//
// A hardware anisotropic fetch answers exactly this question by walking the
// major axis and averaging, and the same answer is available analytically for
// two more evaluations. Three taps spaced along the axis are a box filter over
// it, so the field can be admitted at three times the frequency for the same
// alias margin — which moves the near bands from about five metres of reach to
// about eighteen, i.e. over the whole surface rule 7 is written about.
//
// Value AND gradient are averaged, which is not an approximation: differentiation
// is linear, so the filtered field's gradient is the average of the gradients,
// and the relief a band writes therefore stays exactly consistent with the
// cavity and albedo it writes off the same sample.
//
// The step is a world vector in the band's own projection plane, not a scalar,
// because the axis being integrated is a direction and averaging along the wrong
// one is how a filter becomes a brush.
vec3 tValD3(vec2 p, vec2 s) {
#if TQ_ANTAP == 1
  return tValD(p);
#else
  return (tValD(p - s) + tValD(p) + tValD(p + s)) * (1.0 / 3.0);
#endif
}

/**
 * World-space tangent frame for one of the three triplanar projections,
 * re-orthogonalised against the shading normal.
 *
 * Deriving the frame from dFdx(worldPos), as the detail layer used to, makes
 * the frame rotate with the camera: the same rock lit by the same sun changes
 * which way its bumps face as the player turns on the spot. The projection axis
 * is a world constant, so this one does not.
 */
void axisFrame(int ax, vec3 n, out vec3 T, out vec3 B) {
  vec3 t0 = ax == 0 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  T = t0 - n * dot(n, t0);
  float l = length(T);
  T = l > 1e-4 ? T / l : normalize(cross(n, vec3(0.0, 0.0, 1.0)) + vec3(1e-5));
  B = cross(T, n);
}

// Mirrors Heightfield.weightsAt exactly. Slope, altitude, curvature, the eroded
// flow field and the thermal deposition map all vote; nothing here is a plain
// altitude band. "lo" is the loose-material (scree) mask from the thermal pass.
void terrainWeights(float y, float s, float f, float c, float sh, float lo, float dv, out float w[8]) {
  float bare = 1.0 - lo;
  // Slope bands, in s = 1 - N.y. The old set put full rock at 43 degrees and
  // full basalt at 48, but the thermal pass caps loose material at the angle of
  // repose — about 34 degrees — so *every* surface the sim produced was below
  // the onset of exposed rock and the world came out uniformly ash. That is the
  // mechanical cause of "the terrain reads as a single flat colour family": not
  // the tints, the selection. Rock now starts at 18 and saturates at 32; basalt
  // starts at 28 and saturates at 43. Ash keeps everything under 15 outright.
  float flatness = 1.0 - ss(0.035, 0.17, s);
  // 0.088-0.230, not 0.050-0.155, and byte-identical to Heightfield.weightsAt.
  // Measured over 260k land samples, volcanic_rock — the warmest, most saturated
  // ground material in the set — won the argmax on 54.4% of the world against
  // ash's 18.4%, because 60% of the land is steeper than 35 degrees and rock
  // started at 18. That single number is most of "the terrain reads as one
  // saturated brown". See the long note on the Heightfield copy.
  float steep = ss(0.088, 0.230, s);
  float cliff = ss(0.115, 0.270, s);
  float coast = ss(14.0, -10.0, y);
  float deep = ss(-12.0, -46.0, y);
  float high = ss(430.0, 900.0, y);
  float ridge = ss(0.05, 0.55, c);
  float gully = ss(-0.05, -0.5, c);
  float lavaZone = high * ss(0.60, 0.94, dv);
  // Bedrock outcrop: convex, shedding, undeposited. See Heightfield.weightsAt.
  float outcrop = bare * ridge * ss(0.035, 0.14, s);
  // Bedrock band, 40 to 55 degrees, and it must stay byte-identical to
  // Heightfield.weightsAt. See the long note there: without it basalt loses every
  // argmax outside Red Mountain's radius and the palette's whole dark end
  // disappears from the world.
  float bedrock = ss(0.24, 0.42, s) * (0.35 + 0.65 * bare);

  w[7] = lavaZone * (0.5 + 0.5 * ridge) * 1.45;
  w[3] = (cliff * (0.35 + 0.65 * ridge) + 0.8 * outcrop) * (0.85 + 0.30 * dv) * (0.3 + 0.7 * bare) +
         high * steep * 0.55 + 1.15 * bedrock;
  w[2] = (steep + 0.5 * outcrop) * (0.4 + 0.6 * bare) * (1.0 - 0.35 * high) * (1.0 - 0.55 * bedrock);
  w[4] = flatness * coast * (0.6 + 0.4 * lo) * (1.0 - deep) * 1.9;
  // Flow threshold 0.52, not 0.30, and cinder fields keyed on bare convex ground
  // rather than on the same deposition map ash uses. Measured before the change:
  // mud won the argmax on 43% of the world and ash_coarse on 0.0% of it. See the
  // long note on the Heightfield copy — the two must stay byte-identical.
  w[6] = (1.0 - cliff) * ss(0.52, 0.94, f) * (0.35 + 0.65 * gully) * (1.0 - high) + deep * 0.85 * (1.0 - cliff);
  w[5] = flatness * sh * (0.25 + 0.75 * ss(0.15, 0.6, f)) * (1.0 - high) * (1.0 - coast * 0.7);
  w[1] = (1.0 - cliff) * (0.15 + 0.85 * bare) * (0.28 + 0.72 * ridge) * (0.45 + 0.55 * dv) *
         (1.0 - 0.9 * sh) * (1.0 - 0.85 * lavaZone) * 1.85;
  // Ash is airfall first and talus second: the deposition channel modulates it,
  // it does not gate it. See the long note on the Heightfield copy — the two
  // must stay byte-identical. Measured before the change: ash won the argmax on
  // 2.8% of the world, against 35% rock and 43% mud.
  w[0] = (0.46 + 0.54 * flatness) * (0.70 + 0.50 * lo) * (1.0 - 0.75 * sh) * (1.0 - 0.8 * coast) * (1.0 - 0.9 * lavaZone) * (1.0 - 0.85 * deep) * 1.3;
}

// Per-layer grade. The synthesized sets all land in the same mid ochre-grey
// bracket, so without this the splat is technically correct and visually
// invisible: ash, basalt and rock read as one material with slightly different
// bumps. These pull each layer onto its slot in the palette — ash pale and
// warm, basalt near-black and cool, rock rust-brown, lava crust crushed dark —
// and give each one a roughness of its own, which is what makes glassy basalt
// separate from powdered ash under the same sun.
// Layer order: 0 ash, 1 ash_coarse, 2 volcanic_rock, 3 basalt, 4 sand,
// 5 lichen_grass, 6 mud, 7 lava_crust.
// Measured, not guessed. A close-range probe (camera 3 m up, sun at noon, one
// site per layer chosen for maximum splat dominance) reported the *rendered*
// pixel of every surface in the world sitting inside one 30-degree hue wedge
// with B/R between 0.56 and 0.62 — ash 99,76,55; rock 96,78,57; mud 96,77,59;
// lava 106,85,62 — and basalt coming back at 130,119,101, i.e. the BRIGHTEST
// material in the world where the bible calls it the darkest. That is the whole
// of "monochrome oatmeal" in seven rows of numbers, and it is fixed here.
//
// Two axes matter and the previous set only moved one of them.
//
// VALUE. The illuminant is warm and the aerial-perspective term is warm, so a
// multiplier that only changes brightness cannot separate two materials by hue;
// it can only separate them by value, and it has to do that by a lot. Working
// against the *linear* mid-tone of each baked albedo (src/mat/Library.ts, which
// authors ash at #786e5e-ish -> ~0.09 linear and basalt at #2a2622 -> #141312 ->
// ~0.014 linear): ash lands at 0.137 and basalt at 0.0059. That is a 23:1 ratio
// between the flats and the cliffs against the old set's 8:1, and it is what
// makes a basalt face read as black rock rather than as ash in shadow.
//
// CHROMA — REVISED. The paragraph this replaces argued that because the
// illuminant is warm (B/R ~= 0.67) an albedo has to overshoot to land anywhere
// cool once it is lit, and used that to justify separating materials by HUE:
// ash pushed to B/R 0.84, basalt to 1.62, volcanic rock to 0.32.
//
// Measured, that reasoning does not survive. Dividing the pre-grade shaded
// frame by this shader's own accA (TQ_DBG 2) over the dark-ground pixels of the
// five gate vantages puts the effective illuminant — sun, sky, AO and the
// aerial term together — at G/R 0.91-1.12 and B/R 0.82-1.47, i.e. essentially
// NEUTRAL. The warm cast in the frame is not the light; it is this array. So an
// albedo tint does not get diluted on its way to the film, it arrives at close
// to full strength, and these eight multipliers were the dominant term in the
// measurement that sent this round: pre-grade dark-ground relative saturation
// 0.373-0.565 across the gate set against the bible's ash #8a7f72 at 0.174,
// #4a423b at 0.203 and basalt #2a2622 at 0.190. Two to three times the palette
// the ground is supposed to be made of, and the stage-6 panel read it as the
// frame splitting into scenes that do not belong together — a rust-red ridge, a
// cool-grey basalt flank and an ochre flat, none of them the same world.
//
// The baked albedos are not the problem. src/mat/Library.ts already authors
// every ground material inside the bible: ash mid #786e61 at 0.192, ash dark
// #4e463e at 0.205, basalt jet #2a2622 at 0.190, volcanic rock #443f39 at
// 0.162. Multiplying those by a chromatic tint is what takes them off it.
//
// So these tints are LUMINANCE-ONLY. Each one is its own predecessor's Rec.709
// luminance in all three channels, which leaves the value separation the note
// below describes bit-for-bit intact — ash 1.431 against basalt 0.496 is still
// 2.9:1 of tint on top of a 23:1 ratio of baked mid-tone — while every material
// now reaches the film wearing the hue its library set authored, which is one
// warm ochre-brown family for all of them.
//
// The differentiation the previous set bought with hue is bought instead by the
// three axes the bible's own swatches use, since #8a7f72, #4a423b and #2a2622
// sit within 0.03 of each other in saturation and differ almost entirely in
// value: VALUE (this array), ROUGHNESS (LAYER_ROUGH below — index 3 is vitreous
// and takes a specular lobe no ash can) and TEXTURE (each library set's own
// grain, relief and cavity). Lichen is the single exception and keeps 35% of
// its authored chroma, because verdigris #5f7a63 is a bible entry in its own
// right and sparse vegetation is meant to read green.
//
// This also removes, rather than mitigates, the argmax discontinuity the
// distance collapse note below describes: the hard-edged curve drawn across a
// flank when the top-two layer index flipped was mostly the step between
// (1.52, 1.42, 1.28) and (0.42, 0.50, 0.68), and a step between two greys of
// the same family is a fraction of that even before gMonoTint cross-fades it.
//
// A const array rather than the eight-way if-ladder it replaces. The ladder was
// read with a *dynamic* index — the layer identity comes out of the top-K
// selection — so it compiled to seven live compares and seven selects on every
// call, and it is called up to three times inside sampleTriple, which itself
// runs up to six times per pixel. That is several hundred instructions per pixel
// spent looking up a constant. Indexing a const array is a constant-buffer read.
const vec3 LAYER_TINT[8] = vec3[8](
  vec3(1.431),               // ash — was (1.52, 1.42, 1.28), the mid-value the world hangs on
  vec3(1.007),               // ash_coarse — was (1.06, 1.00, 0.92): ash plus cinder
  vec3(0.892),               // volcanic_rock — was (1.24, 0.82, 0.58); scoria reads rust from its own map
  vec3(0.496),               // basalt — was (0.42, 0.50, 0.68); near-black, and now warm-neutral like the bible
  vec3(1.092),               // sand — was (1.22, 1.08, 0.84)
  vec3(0.773, 0.885, 0.809), // lichen — verdigris, 35% of the authored (0.62, 0.94, 0.72)
  vec3(0.717),               // mud — was (0.76, 0.71, 0.66)
  vec3(0.285)                // lava_crust — was (0.30, 0.28, 0.29); crushed black, so the ember reads
);

// Chroma discipline for the analytic bands.
//
// Every band below multiplies accA by a constant vec3, and every one of those
// that is not lava was authored with hue in it — the meso band swings cool to
// warm, scour is (0.34, 0.38, 0.49) at saturation 0.306, the ferric wash is
// (1.34, 0.84, 0.56) at 0.582. Composed over one pixel they are a second,
// independent source of the same defect the array above was: the ground picks
// up chroma from six or seven structural terms none of which is on the palette.
//
// Their VALUE modulation is the part that does the work — relief, ledge, joint,
// rill, grit, crust, scour, drift and channel all exist to make structure read
// — and that part is kept exactly. This trims what is left toward the constant's
// own luminance, so a band that darkened a hollow by 38% still darkens it by
// 38% and simply stops recolouring it.
//
// TQ_CHROMA is the fraction of authored chroma each structural band keeps. Not
// zero: at 0.30 the meso swing still tips crest against hollow and the ferric
// wash still reads as rust rather than as shade, but scour lands at 0.10 of
// saturation and the wash at 0.18 — inside the bible's own band instead of
// three times outside it. Ember is exempt and passes at full strength; lava and
// bioluminescence are the only things the bible allows to be vivid.
//
// A define rather than a bare const so it can be swept with setBudget without a
// rebuild per value — TQD_CHROMA 0.0 is the ablation that prices the bands
// against the baked library maps, which is the only way to tell which of the
// two a residual belongs to. Measured that way on coast, the bands carry about
// a third of the ground's remaining chroma and src/mat/Library.ts the rest.
//
// A pure function of compile-time constants at every call site, so it folds.
#ifndef TQD_CHROMA
#define TQD_CHROMA 0.30
#endif
const float TQ_CHROMA = float(TQD_CHROMA);
vec3 chromaTrim(vec3 t, float keep) {
  return mix(vec3(dot(t, vec3(0.2126, 0.7152, 0.0722))), t, keep);
}

// Knee and asymptote of the albedo palette ceiling — see the long note at the
// use site. Both are relative saturation in LINEAR light, where the bible's
// ground swatches sit at 0.312-0.359. Sweepable with setBudget for the same
// reason TQD_CHROMA is.
#ifndef TQD_SAT_KNEE
#define TQD_SAT_KNEE 0.34
#endif
#ifndef TQD_SAT_CEIL
#define TQD_SAT_CEIL 0.46
#endif
const float TQ_SAT_KNEE = float(TQD_SAT_KNEE);
const float TQ_SAT_CEIL = float(TQD_SAT_CEIL);

// (roughness multiplier, roughness floor). Basalt and mud take a real specular
// lobe; ash and sand stay fully matte.
// Index 3 is vitreous: a basalt flow chills to glass, and the only thing that
// separates "black rock" from "a dark patch" in a still frame is that it takes a
// specular lobe the ash beside it cannot.
const vec2 LAYER_ROUGH[8] = vec2[8](
  vec2(1.04, 0.90),
  vec2(1.00, 0.82),
  vec2(0.92, 0.58),
  vec2(0.62, 0.21),
  vec2(1.00, 0.84),
  vec2(1.00, 0.78),
  vec2(0.70, 0.28),
  vec2(0.84, 0.48)
);

// ------------------------------------------------------- anisotropy limiter
//
// The surface arrays are built at 8x anisotropy (SurfaceArray.makeArray), and
// for ground seen from eye height the footprint ratio passes 8:1 within about
// fifteen metres. Every terrain pixel beyond that is therefore paying eight
// trilinear taps for each of its array fetches — with up to a dozen fetches in
// flight that is where the fragment budget actually goes, and it is invisible
// in a fetch count.
//
// Lengthening the *minor* axis of the gradient ellipse bounds the tap count
// without touching the major axis, so the mip level the hardware picks is
// unchanged and the only difference is a little blur across the direction that
// was already the short one. Near the camera the ratio stays at the full 8 —
// that is exactly what keeps grazing ground sharp, which is rule 7. Past a
// couple of hundred metres the mip being walked is already coarser than the
// features the taps are resolving and aerial perspective has taken the contrast
// out, so the taps buy nothing.
// The ramp past the budget is the fix for the near-plane "brushed metal", and
// it is the whole reason this function is not just a clamp.
//
// Clamping the minor axis to major/N asks the hardware for N taps of a mip
// sized major/N, walked along the major axis. While the true ratio is at or
// under N that is a correct anisotropic filter. Once the true ratio runs past
// it — which on ground seen from eye height happens at about forty metres, and
// then keeps going, reaching 40:1 by a hundred — the taps no longer tile the
// footprint: what comes back is a *line integral* of a partly-resolved image
// along the major axis. Every feature the mip still holds is returned smeared
// along that axis, and on a ground plane the major axis points straight away
// from the camera. The image of that is a fan of filaments converging on the
// vanishing point, which is exactly the artefact the review measured on three
// separate near planes and called a projection failure.
//
// A directional average that cannot cover its footprint is worse than an
// isotropic one that can, because the isotropic one has no direction to print.
// So the target minor length ramps from major/N up to major itself across the
// range where the clamp stops being honest. Under budget nothing changes and
// the near ground keeps every bit of its sharpness; over budget the fetch
// degenerates gracefully into a blur instead of a brush.
//
// -------------------------------------------------------------------------
// The quantity bounded here is the ratio of the footprint's SINGULAR VALUES,
// and it used to be the ratio of length(du) to length(dv). Those are different
// numbers, and the difference is the whole of the "directional comb / long
// parallel streaks running down the gradient" the stage-6 panel filed against
// every lit slope in the frame.
//
// du and dv are the images of the screen x and y axes on the texture plane.
// They are perpendicular in screen space; they are not perpendicular on the
// plane, because the projection foreshortens both of them along the SAME
// direction — the surface's own dip — so on any obliquely-seen face the angle
// between them closes. What the hardware filters over is the parallelogram the
// two SPAN, whose minor semi-axis carries a sin(theta) the lengths know nothing
// about. Two vectors of equal length can therefore span a sliver of arbitrary
// aspect, and equalising their lengths — which is all this function did — left
// the true aspect exactly where it was. Past the texture's own 16x the driver
// then line-integrates a blurred mip along the major axis, and the image of
// that on a dipping surface is a comb aligned with the fall line.
//
// Measured before touching anything, so this is attribution and not a story:
// with the budget forced to 1.0 — which under the old form set both vectors to
// the same length, i.e. requested a perfectly isotropic fetch — the streak
// coherence over a lit slope in the dawn vantage did not move (0.409 against
// 0.426 at the shipping budget, on a scale where the same crop with the splat
// stage stubbed out reads 0.10). Neither did forcing the single-layer path,
// disabling the de-tiling cell blend, the parallax march, or any of the eight
// analytic bands. A knob that does nothing at either end of its range is not
// mistuned; it is bounding the wrong quantity.
//
// So decompose properly. J = [du dv]; the semi-axes of the footprint are the
// singular values of J, i.e. the square roots of the eigenvalues of J*J^T. That
// is a symmetric 2x2 and has a closed form — about a dozen ALU ops, paid once
// per projection rather than once per fetch, against the three to nine fetches
// it governs. If the ratio is over budget, stretch the domain along the MINOR
// singular direction until it is not: J' = (I + (k-1) u2 u2^T) J is exactly
// that stretch, and because u2 is an eigenvector of J*J^T it leaves the major
// axis — and therefore the mip the hardware picks — untouched.
void limitAniso(inout vec2 du, inout vec2 dv, float maxRatio) {
  // J * transpose(J), symmetric, written as mat2(e + f, g, g, e - f).
  float a00 = du.x * du.x + dv.x * dv.x;
  float a11 = du.y * du.y + dv.y * dv.y;
  float g = du.x * du.y + dv.x * dv.y;
  float e = 0.5 * (a00 + a11);
  float f = 0.5 * (a00 - a11);
  float r = sqrt(f * f + g * g);
  float s1 = sqrt(max(e + r, 0.0));
  float s2 = sqrt(max(e - r, 0.0));
  if (s1 < 1e-9) return;
  float ratio = s1 / max(s2, 1e-9);
  if (ratio <= maxRatio) return;
  // A CLAMP, not a ramp to isotropic, and dropping that ramp is the other half
  // of the near-plane fix.
  //
  // The ramp is above under "a directional average that cannot cover its
  // footprint is worse than an isotropic one that can". That is true of a filter
  // that walks a mip finer than its own step, and it is not what the hardware
  // does. Asking for an ellipse of ratio N makes it choose lod = log2(major/N)
  // and take N taps spaced major/N along the major axis: the taps tile the
  // footprint exactly, and each one is a texel BLOCK of size major/N, which past
  // the budget is WIDER than the true minor axis. So over-budget the fetch
  // already over-blurs across; it does not under-cover along, and there is no
  // line integral of an unresolved image to be afraid of.
  //
  // What the ramp did instead was drive the requested ellipse to a circle of
  // diameter "major", i.e. lod = log2(major) — N times coarser than the clamp,
  // which at the shipping budget is more than three mip levels of extra blur,
  // applied to exactly the surface that grazes: the bottom third of every
  // landscape frame. That is the "undifferentiated dark mottle with no material
  // read at all" and the "smeared near-black slab with essentially no
  // micro-structure" the stage-6 panel measured, and it was self-inflicted.
  //
  // It was inflicted for a reason that no longer exists. The brushed-metal
  // finding the ramp was answering was the mid band's position-proportional
  // scale jitter shearing the texture MAPPING by up to ten to one (see midS);
  // blurring the fetch into a circle hid the shear by destroying everything else
  // with it. With the shear gone the filter has nothing to smear, so the honest
  // anisotropic ellipse is both sharper and cleaner, and it costs the same taps.
  float lim = s1 / maxRatio;
  float k = lim / max(s2, 1e-9);
  // Eigenvector of the MAJOR eigenvalue. (f + r, g) and (g, r - f) are the same
  // direction because g*g == (r - f)*(r + f); the first is degenerate only when
  // J*J^T is already diagonal with its long axis on v, which is the fallback.
  vec2 w = vec2(f + r, g);
  vec2 u1 = dot(w, w) > 1e-24 ? normalize(w) : vec2(0.0, 1.0);
  vec2 u2 = vec2(-u1.y, u1.x);
  float km1 = k - 1.0;
  du += u2 * (km1 * dot(u2, du));
  dv += u2 * (km1 * dot(u2, dv));
}

// Width of the height-blend window, in displacement-channel units.
#define HB_WIN 0.24

// Height-blend three layers: the ARM alpha channel is a real displacement, so
// gravel wins over ash inside its own pits instead of the two cross-fading
// into mush the way a linear alpha blend would.
//
// The albedo and normal fetches are gated on the blend weight the ARM alphas
// just produced. That gate is not an approximation: bw is clamped at zero by
// construction and the contribution of a zero-weight layer is exactly zero, so
// skipping it changes nothing about the result. It changes a great deal about
// the cost — the 0.22 height window means one of the three layers is usually
// out entirely, and each one carries two array fetches per projection, times up
// to three projections. Derivatives are explicit (textureGrad), so the branch
// is safe in non-uniform control flow.
// The fast path's tint and roughness pair, cross-faded between the top two
// layers. See the note in the fast path below for why this is not cosmetic.
vec3 gMonoTint;
vec2 gMonoRough;

void sampleTriple(vec2 uv, vec2 du, vec2 dv, ivec3 li, vec3 lw,
                  out vec3 alb, out vec3 nts, out float ao, out float rough, out float hgt) {
  // Single-layer fast path. It is the exact value of everything below when lw is
  // (1,0,0), which FRAG_SPLAT guarantees past the collapse distance, EXCEPT for
  // the tint and roughness pair — see below. Written out because the general
  // path still costs a height window, three smoothsteps, a normalisation and
  // three table reads to arrive at bw = (1,0,0), across most of the screen in
  // any landscape shot, and because the general path's fetch count is two to
  // three times this one's.
  if (lw.x >= 0.999) {
    vec4 m0 = textureGrad(uArmArr, vec3(uv, float(li.x)), du, dv);
    // gMonoTint, not LAYER_TINT[li.x], and this one substitution is what makes
    // the collapse to a single layer affordable at all.
    //
    // The collapse is continuous in the WEIGHTS — lw is ramped to (1,0,0) — but
    // the layer INDEX is an argmax, and an argmax flips instantaneously along
    // the contour where the top two weights cross. Everything keyed off that
    // index therefore steps across the contour, and the loudest thing keyed off
    // it is the tint: ash was (1.52, 1.42, 1.28) and basalt (0.42, 0.50, 0.68),
    // so the step was most of the difference between two materials, drawn
    // as a hard-edged curve across a flank. (Both are luminance-only greys now
    // — see the CHROMA note on LAYER_TINT — so the step is a step in value
    // alone, which is a fraction of what it was; this cross-fade still earns
    // its keep, but it is no longer holding back a hue break.)
    // That is the measured regression the
    // last attempt at pulling the collapse distance in produced — "you cannot
    // distinguish basalt from ash from soil anywhere in the frame", with a hard
    // argmax contour where you can — and it is why the collapse distance had to
    // be pushed back out to 950 m, which is to say switched off.
    //
    // The albedo TEXTURE can flip without being seen: at the ranges this path
    // runs, its 8 m tile has mipped most of the way to its own mean and what it
    // contributes is a level, not a pattern. The TINT is what carries material
    // identity out there. So the tint (and the roughness pair with it) is
    // cross-faded between the top two layers on the same continuous weight the
    // splat itself uses, while the fetch stays single-slice. A constant-array
    // lerp against two indices costs nothing a texture fetch would notice, and
    // it removes the only discontinuity the collapse introduces.
    alb = textureGrad(uAlbArr, vec3(uv, float(li.x)), du, dv).rgb * gMonoTint;
    nts = textureGrad(uNrmArr, vec3(uv, float(li.x)), du, dv).xyz * 2.0 - 1.0;
    ao = m0.r;
    hgt = m0.a;
    vec2 rr = gMonoRough;
    rough = mix(rr.y, 1.0, clamp(m0.g * rr.x, 0.0, 1.0));
    return;
  }
  vec4 a0 = textureGrad(uArmArr, vec3(uv, float(li.x)), du, dv);
  // The displacement channel is bounded by 1, so a layer whose splat weight is
  // far enough behind the leader cannot reach the window however tall its own
  // relief turns out to be — and that is decidable before fetching it. li.x's
  // real height is already in hand, so the test is exact rather than
  // conservative-by-a-lot, and it removes one or two array fetches on every
  // pixel of uniform ground, which is most of them.
  float hLim = a0.a + lw.x * 1.55 - (HB_WIN + 1.0);
  vec4 a1 = lw.y * 1.55 >= hLim ? textureGrad(uArmArr, vec3(uv, float(li.y)), du, dv) : vec4(0.0);
  vec4 a2 = lw.z * 1.55 >= hLim ? textureGrad(uArmArr, vec3(uv, float(li.z)), du, dv) : vec4(0.0);
  // The height stack carries a decorrelated per-layer offset, and that offset is
  // what makes a material boundary interlock instead of cutting.
  //
  // The displacement channel is a 512-texel map, so beyond fifty metres or so it
  // has mipped toward its own mean and hs collapses to lw*1.55 plus a constant.
  // A height blend against a constant is not a height blend — it is a threshold
  // on the splat weight, over a window of HB_WIN/1.55 = 0.155 of weight, and the
  // weights come out of a control map whose isolines are smooth curves. What
  // reaches the image is therefore a single clean contour with a material on
  // each side: "the transition happens over a single pixel", "straight polygonal
  // edges", "two decals butted together", "an abrupt diagonal value step with
  // essentially no blend width" — four separate findings, one mechanism.
  //
  // Pushing each layer's height by a different amount of a sub-metre field puts
  // the interlocking back: the contour is displaced by a different amount for
  // each competing layer, so the boundary breaks into fingers at the noise scale
  // and the two materials interpenetrate the way real deposition does. It is
  // deliberately applied HERE rather than to the splat weights, because the
  // weights are the contract Heightfield.weightsAt has to reproduce byte for
  // byte for footstep audio and flora placement; the blend shape is a rendering
  // detail and can differ.
  vec3 hs = vec3(a0.a, a1.a, a2.a) + lw * 1.55 + vec3(gHBJit, -0.75 * gHBJit, 0.45 * gHBJit);
  float top = max(hs.x, max(hs.y, hs.z));
  // Smooth height window, not a clamped ramp.
  //
  // The predecessor was bw = max(hs - (top - 0.22), 0.0). That is C0 but not C1:
  // its derivative with respect to the ARM displacement channel jumps from zero
  // to 1/0.22 the instant a layer enters the window. The displacement channel is
  // a 512-texel map with hard plate edges, so a layer does not fade in — it
  // snaps on along a texel-exact contour of that map, carrying its albedo *and*
  // its tangent normal with it. On ash, where the layer waiting behind is dark
  // ash_coarse, the result is the hard dark polygonal blobs the review found in
  // the near field, and they are worst at grazing sun because the normal
  // discontinuity rides in on the same contour as the albedo one.
  //
  // A smoothstep over the window has zero derivative at both ends, so a layer
  // now enters and leaves with no edge at all, and it still reaches exactly 0
  // and exactly 1 — which is what keeps the zero-weight branches below live.
  // The window stays at the old 0.24 rather than widening: a smoothstep already
  // spends half its span on the soft shoulders, so the same width now reads as a
  // considerably gentler transition, and widening further would only admit more
  // layers to the fetch gate above.
  vec3 t = clamp((hs - (top - HB_WIN)) * (1.0 / HB_WIN), 0.0, 1.0);
  vec3 bw = t * t * (3.0 - 2.0 * t);
  // A layer whose splat weight has reached zero must contribute nothing. Without
  // this gate the height blend re-admits it on the strength of its displacement
  // channel alone, which throws away the continuity the top-4 offset in
  // FRAG_SPLAT just bought: the layer identity changes, its ARM alpha does not
  // go to zero with its weight, and the surface jumps.
  bw *= smoothstep(vec3(0.0), vec3(0.045), lw);
  // li.x always carries the largest weight, so it is the safe fallback when the
  // window has excluded everything else.
  bw.x = max(bw.x, 1e-4);
  bw /= (bw.x + bw.y + bw.z);
  // Give way to the plain weight blend once the displacement field the interlock
  // is reading has gone under the pixel. See gHBLin in FRAG_SPLAT: the weight
  // blend is what a height blend integrates to, so this is the band-limited
  // answer and not an approximation of it. lw is already normalised by the
  // caller, but not on the mono path, so renormalise rather than assume.
  bw = mix(bw, lw / max(lw.x + lw.y + lw.z, 1e-4), gHBLin);

  alb = vec3(0.0);
  nts = vec3(0.0);
  if (bw.x > 0.0) {
    alb += textureGrad(uAlbArr, vec3(uv, float(li.x)), du, dv).rgb * LAYER_TINT[li.x] * bw.x;
    nts += (textureGrad(uNrmArr, vec3(uv, float(li.x)), du, dv).xyz * 2.0 - 1.0) * bw.x;
  }
  if (bw.y > 0.0) {
    alb += textureGrad(uAlbArr, vec3(uv, float(li.y)), du, dv).rgb * LAYER_TINT[li.y] * bw.y;
    nts += (textureGrad(uNrmArr, vec3(uv, float(li.y)), du, dv).xyz * 2.0 - 1.0) * bw.y;
  }
  if (bw.z > 0.0) {
    alb += textureGrad(uAlbArr, vec3(uv, float(li.z)), du, dv).rgb * LAYER_TINT[li.z] * bw.z;
    nts += (textureGrad(uNrmArr, vec3(uv, float(li.z)), du, dv).xyz * 2.0 - 1.0) * bw.z;
  }
  ao = a0.r * bw.x + a1.r * bw.y + a2.r * bw.z;

  vec2 r0 = LAYER_ROUGH[li.x];
  vec2 r1 = LAYER_ROUGH[li.y];
  vec2 r2 = LAYER_ROUGH[li.z];
  float rm = r0.x * bw.x + r1.x * bw.y + r2.x * bw.z;
  float rf = r0.y * bw.x + r1.y * bw.y + r2.y * bw.z;
  rough = mix(rf, 1.0, clamp((a0.g * bw.x + a1.g * bw.y + a2.g * bw.z) * rm, 0.0, 1.0));

  hgt = a0.a * bw.x + a1.a * bw.y + a2.a * bw.z;
}
`;

const FRAG_SPLAT = /* glsl */ `
  vec3 N = normalize(vWNrm);
  float slope = 1.0 - clamp(N.y, 0.0, 1.0);

  vec3 dpx = dFdx(vWPos);
  vec3 dpy = dFdy(vWPos);

  // --------------------------------------------------------- pixel footprint
  //
  // Two numbers, both measured on the SURFACE in metres, and both computed here
  // — before anything has chosen a projection — because the previous pair were
  // derived from the projected 2D coordinate pair and that made them
  // discontinuous.
  //
  // domDX/domDY were dpx/dpy with one component thrown away, chosen by the
  // triplanar argmax. domAx flips along the contour where two of the triplanar
  // weights cross, which on any steep flank is the locus |N.x| == |N.z| — a line
  // of constant aspect, i.e. a line running straight down the fall line, which
  // projects to a straight near-vertical line on screen. Across it the discarded
  // component changed, so the footprint stepped, and every band below is gated
  // on the footprint: one side of the line got the full analytic detail set and
  // the other side got none. That is the "pixel-hard perfectly vertical seam,
  // no detail texture left of it and the full reticulated crackle right of it"
  // in night, and the same line down the caldera wall in ridge. It is not an LOD
  // crack and there is no geometry wrong with it — the drawn mesh is watertight;
  // it is this quantity jumping.
  //
  // Taking the length of the full 3D derivative removes the projection from the
  // question entirely. It is also simply the right number: the footprint of a
  // pixel on the surface does not depend on which plane the shader later decides
  // to read a texture through.
  //
  // fp is the ANISOTROPIC mean — sqrt(major * minor) with the ratio clamped at
  // 6 — and is what a hardware anisotropic fetch genuinely resolves. It gates
  // the smooth bands and picks the tap budget.
  //
  // fpH is the MAJOR axis, unclamped, and is what an ANALYTIC band can honestly
  // resolve, because an analytic band is a point evaluation with no filter of
  // any kind: anything shorter than the long axis of the footprint folds. Every
  // sharp band below — the bedding sinusoid, the ridged-and-squared columnar and
  // crust networks, the rill notch, the debris threshold — is gated on fpH now.
  // They were gated on fp, i.e. on a number up to 2.45x smaller than the one
  // that governs whether they alias, and a full-contrast periodic evaluated at
  // 2.5x past its own Nyquist limit is a moire generator. That is the diagonal
  // comb in dusk, the wood-grain weave on the ridge caldera wall and the diamond
  // stipple band in dawn.
  float fpA = length(dpx);
  float fpB = length(dpy);
  float fpH = max(fpA, fpB) + 1e-5;
  float fpMin = clamp(min(fpA, fpB), fpH * (1.0 / 6.0), fpH);
  float fp = sqrt(fpH * fpMin);
  // Stochastic dither on the control-map lookup. uData is 1024 over 4000 m, so
  // one texel is 3.9 m; bilinear reconstruction of it is piecewise-bilinear on
  // an axis-aligned lattice, and every iso-contour the weights below take
  // through it therefore has its kinks on that lattice. Downstream of the
  // top-K selection that shows up as blocky, axis-aligned patch edges 30-60 px
  // across in the midground — read by the review as a point-filtered low-res
  // splat map. Displacing the lookup by a sub-texel amount of 9 m noise turns
  // the lattice kinks into an organic wobble at no cost. Faded out before the
  // displacement itself can become a sub-pixel signal.
  // One noise call, not two: the analytic gradient of a single field is already
  // a 2D vector, and using it as the displacement makes the warp divergence-free
  // as a bonus (it cannot fold the domain over itself).
  // Two octaves, not one, and the warp now outlives the midground.
  //
  // The single 9 m octave at 1.6 m of throw was under half a uData texel, so it
  // roughened the lattice kinks without displacing them: the isolines still ran
  // along x and z, they just wobbled on the way. And it was faded out entirely
  // by 340 m — which is where the review measured the banding. The 27 m octave
  // carries the throw past a full texel so a boundary genuinely leaves the
  // lattice it was born on, and the fade now sits at 300-900 m, where a 27 m
  // feature is finally approaching a pixel and displacing further would alias.
  //
  // Both octaves are behind the fade rather than multiplied by it. The fade
  // reaches exactly zero at 900 m and the terrain past that point is most of a
  // landscape frame, so evaluating two gradient-noise fields — eight hashes —
  // to scale them by nothing was a pure loss over the majority of the screen.
#if TQ_SPLATJIT
  float jFade = 1.0 - ss(300.0, 900.0, vCamDist);
#else
  // The lattice this warp hides is a 3.9 m control-map texel. At the tier that
  // switches it off the internal buffer is well under a third of the canvas, so
  // a texel is a couple of output pixels and the kink it is hiding is under the
  // reconstruction filter's own footprint.
  float jFade = 0.0;
#endif
  vec2 dJit = vec2(0.0);
  if (jFade > 0.002) {
    vec3 dJ1 = tValD(vWPos.xz * 0.115 + 61.7);
    vec3 dJ2 = tValD(vWPos.xz * 0.037 - 22.1);
    dJit = (dJ1.yz * 1.7 + dJ2.yz * 3.4) * jFade;
  }
  vec4 dat = texture2D(uData, (vWPos.xz + dJit + uExtent) * (0.5 / uExtent));
  float dFlow = dat.r;
  float dCurv = dat.g * 2.0 - 1.0;
  float dShelter = dat.b;
  float dLoose = dat.a;
  float dv = clamp(1.0 - length(vWPos.xz - uRmCenter) / uRmRadius, 0.0, 1.0);

  float w[8];
  terrainWeights(vWPos.y, slope, dFlow, dCurv, dShelter, dLoose, dv, w);

  // Top four, not top three. The fourth is never sampled; it is the *cutoff*.
  //
  // Ranking by raw weight and renormalising over the winners is discontinuous by
  // construction: at the instant layers 3 and 4 swap rank they hold equal weight
  // but carry completely different textures, so the shaded result jumps by the
  // full difference between two materials along the swap contour. That contour
  // runs through the bilinear control map, so it is piecewise-bilinear on the
  // 3.9 m texel lattice, and the jump prints as the axis-aligned rectangular
  // patches the review measured on the mountain foot.
  //
  // Subtracting the fourth weight from the three that survive sends any layer
  // crossing the boundary across it at *exactly* zero weight, in both
  // directions. The selection is then continuous everywhere and the patch edges
  // cannot exist, whatever the control map is doing.
  //
  // Collapse toward the dominant layer with distance. Past a couple of hundred
  // metres a three-way height blend is arguing about which material owns a
  // sub-pixel pit, and the layers it is arguing between are already averaged
  // into each other by the mip chain — but it is still paying up to six array
  // fetches to have the argument, across most of the screen in any landscape
  // shot. Ramping the two minor weights to zero is a continuous change (the
  // fetch gate in sampleTriple takes them out as they arrive at zero, not
  // before), it costs nothing visible, and it is the single largest saving in
  // this shader. The far-band and macro terms carry the distance instead.
  //
  // Once that ramp has *reached* one there is nothing left for the rank to
  // decide except which layer is on top, so the four-pass, thirty-two-compare
  // selection collapses to a single argmax — a quarter of the work, over
  // exactly the part of the frame that is cheapest to get wrong and largest in
  // area. The branch is on the same ss() that drives the ramp, so it can only
  // fire where the result is provably (1,0,0), and the two paths agree
  // identically on the boundary.
  // Two stages, not one, and the far one is five times further out than it was.
  //
  // A single ramp to one layer at 260 m is why every shot in the review reported
  // "a single material across the entire visible world", "you cannot distinguish
  // basalt from ash from soil anywhere in the frame", "steep faces shade
  // identically to flats". It was literally true past 260 m: the splat still
  // *chose* per pixel, but it could only ever show the winner, so a scree fan
  // against the bedrock face above it, or a basalt cliff against the ash apron
  // below it, resolved to whichever of the two happened to be ahead — with a
  // hard argmax contour between them. 260 m is thirty metres into a landscape
  // shot; essentially the whole frame was single-material.
  //
  // drop3 still takes the third layer out at the old range, which is where the
  // saving actually was: the third layer of a height blend is arguing about a
  // sub-pixel pit. mono — the collapse to one — now waits until 1.4 km, past
  // which two materials genuinely are averaged into each other by the mip chain.
  // The two-layer band between them is one extra ARM fetch per projection on
  // pixels where the runner-up has real weight, and by then triCollapse has
  // taken the projection count to one.
  float drop3 = ss(TQ_DROP3_A, TQ_DROP3_B, vCamDist);
  float mono = ss(TQ_MONO_A, TQ_MONO_B, vCamDist);
  ivec3 li;
  vec3 lw;
  // The top TWO weights, kept whatever the collapse does to the blend. Past the
  // collapse the splat draws one slice, but the tint it draws it with has to go
  // on cross-fading or the material identity steps along the argmax contour;
  // see gMonoTint in sampleTriple. Held separately from lw because lw is what
  // decides how many FETCHES happen and these two decide what COLOUR they come
  // out — the whole point is that those are no longer the same question.
  float lwPre1 = 0.0;
  float lwPre2 = 0.0;
  if (mono >= 1.0) {
    // Two passes over eight, not the four the general path needs: with the
    // blend collapsed, the third and fourth weights have no consumer left.
    int b0 = 0;
    float v0 = -1.0;
    for (int i = 0; i < 8; i++) {
      if (w[i] > v0) { v0 = w[i]; b0 = i; }
    }
    int b1 = b0 == 0 ? 1 : 0;
    float v1 = -1.0;
    for (int i = 0; i < 8; i++) {
      if (i != b0 && w[i] > v1) { v1 = w[i]; b1 = i; }
    }
    li = ivec3(b0, b1, b0);
    lw = vec3(1.0, 0.0, 0.0);
    lwPre1 = max(v0, 0.0);
    lwPre2 = max(v1, 0.0);
  } else {
    ivec4 li4 = ivec4(0, 1, 2, 3);
    vec4 lw4 = vec4(0.0);
    for (int p = 0; p < 4; p++) {
      int bi = 0;
      float bw = -1.0;
      for (int i = 0; i < 8; i++) {
        float wv = w[i];
        if (p > 0 && i == li4.x) wv = -1.0;
        if (p > 1 && i == li4.y) wv = -1.0;
        if (p > 2 && i == li4.z) wv = -1.0;
        if (wv > bw) { bw = wv; bi = i; }
      }
      if (p == 0) { li4.x = bi; lw4.x = bw; }
      else if (p == 1) { li4.y = bi; lw4.y = bw; }
      else if (p == 2) { li4.z = bi; lw4.z = bw; }
      else { li4.w = bi; lw4.w = bw; }
    }
    li = li4.xyz;
    lw = max(lw4.xyz - max(lw4.w, 0.0), vec3(0.0));
    // The dominant layer must survive even in the degenerate case where all
    // eight weights are equal, or the whole splat falls out of the frame.
    lw.x = max(lw.x, 1e-3);
    // RAW, not cutoff-offset, and the same quantity the collapsed branch above
    // reports — the two have to agree to the last bit at the distance where
    // mono crosses 1 or the tint steps across a ring centred on the camera.
    lwPre1 = max(lw4.x, 0.0);
    lwPre2 = max(lw4.y, 0.0);
    lw.z *= 1.0 - drop3;
    lw /= (lw.x + lw.y + lw.z);
    lw = mix(lw, vec3(1.0, 0.0, 0.0), mono);
    lw /= (lw.x + lw.y + lw.z);
  }
  // Scaled by mono, which is what keeps the fast path and the general path
  // agreeing rather than merely both being smooth.
  //
  // Below the collapse, sampleTriple only takes its fast path where lw.x has
  // reached 0.999 on its own — that is, where the runner-up genuinely has no
  // weight — and there the general path's height blend resolves to the leading
  // layer's tint alone. A cross-fade applied there would disagree with the path
  // right beside it. Multiplying by mono makes the cross-fade arrive exactly as
  // the collapse does: it is zero wherever the two paths are both reachable,
  // and full only where the general path no longer exists.
  float monoT = mono * clamp(lwPre2 / max(lwPre1 + lwPre2, 1e-4), 0.0, 1.0);
  gMonoTint = mix(LAYER_TINT[li.x], LAYER_TINT[li.y], monoT);
  gMonoRough = mix(LAYER_ROUGH[li.x], LAYER_ROUGH[li.y], monoT);

  // Drive for the height-blend interlock in sampleTriple. Two octaves, 1.7 m and
  // 5.6 m, so a boundary breaks up at two scales rather than acquiring one
  // characteristic wiggle; faded out over 260-760 m, past which 1.7 m is under a
  // pixel and displacing a contour by it would be dither rather than shape.
  gHBJit = 0.0;
  // Gated on there being a second layer at all: with only one layer in the
  // blend sampleTriple takes its fast path and never reads this, so the two
  // noise evaluations would be pure loss over the large majority of any frame.
  // Bounded by the range the height blend itself survives to: past TQ_MONO_A
  // there is one layer and sampleTriple never reads this.
  // Gated on the pixel footprint as well, and that is the second half of the
  // fix below. This is a 1.7 m field added to a THRESHOLD, so once 1.7 m stops
  // covering several pixels it is not decorating a boundary, it is choosing
  // which of two materials a pixel gets, at random, from a signal the pixel
  // cannot resolve.
  float hbFade = (1.0 - ss(min(260.0, TQ_MONO_A), min(760.0, TQ_MONO_B), vCamDist)) * step(0.02, lw.y) *
                 (1.0 - ss(0.10, 0.50, fpH));
  if (hbFade > 0.004) {
    float hb1 = tVal(vWPos.xz * 0.59 + 44.3);
    float hb2 = tVal(TROT * vWPos.xz * 0.178 - 16.9);
    gHBJit = ((hb1 * 0.55 + hb2 * 0.45) - 0.5) * 0.32 * hbFade;
  }

  // How far the height blend has to give way to the plain weight blend, and this
  // is the fix for the "hard contour terracing / corduroy" in vale.
  //
  // Measured rather than reasoned about: rendering accA straight out of the
  // triplanar loop (TQ_DBG 8) shows the corduroy in full, while the layer index
  // (TQ_DBG 1), the splat weights (TQ_DBG 5), the control map (TQ_DBG 4) and the
  // shading normal (TQ_DBG 3) are all smooth over the same ground. Forcing the
  // single-layer fast path removes it completely. So it is neither the weights
  // nor the geometry — it is the height BLEND, and specifically the fact that
  // the blend is a 0.24-wide threshold on the ARM displacement channel of an 8 m
  // tile plus a 1.7 m noise. Where the top two splat weights are within about a
  // tenth of each other, that threshold — not the terrain — decides which
  // material a pixel gets, and past thirty metres or so neither of its inputs is
  // resolvable. The two materials it was deciding between on that slope were ash
  // (1.52, 1.42, 1.28) and lichen (0.62, 0.94, 0.72), which is the widest hue
  // separation in the palette, so the unresolvable signal printed at full
  // material contrast: alternating cream and sage bands along the weight
  // isolines, which follow the landform, which is why it reads as contours.
  //
  // The correct low-passed limit of a height blend whose displacement field has
  // gone below the pixel is the plain weight blend — that is what the height
  // blend integrates to. So it fades to exactly that, continuously, over the
  // range where the 8 m tile's sub-metre relief stops being resolvable. Inside
  // that range nothing changes and gravel still wins over ash inside its own
  // pits, which is the whole point of having a height blend.
  gHBLin = ss(0.25, 1.60, fpH);

  // ------------------------------------------------- continuous top-1 layer
  //
  // Three bands below — parallax, the 0.5 m grain and the far band — read a
  // single array slice, because blending three of them at those scales is not
  // affordable. Reading li.x is what makes them quantised: li.x flips the
  // instant the top two weights cross, and that crossing contour is an isoline
  // of a bilinearly-filtered 1024 texture, i.e. a piecewise-linear path on a
  // 3.9 m lattice. The whole band jumps across it — that is the stepped splat
  // banding at the uData texel scale, and it survives the top-4 offset above
  // because the offset only makes the *weights* continuous, not the index.
  //
  // The previous build dithered the index in screen space with interleaved
  // gradient noise, on the argument that the TAA resolve would integrate the
  // stipple back into the weighted blend. It does not. IGN is a *fixed* screen
  // lattice with a 2.8 x 4.0 px diagonal period, so unless the resolve both runs
  // and accumulates over the whole jitter sequence — it is not doing so in any
  // captured frame — what reaches the image is a hard ordered crosshatch
  // switching between two entirely different materials, one pixel apart. Every
  // shot in the review measured it: high-pass std 4.3 on terrain against 1.2 on
  // everything else, and an FFT with a discrete peak at exactly that period.
  //
  // A dither that needs a resolve pass to be correct is not correct. Blend the
  // top two instead: layT is the runner-up's share of the pair, the fetch is
  // branched out when that share is negligible (which is most of the frame, so
  // the average cost is close to the single-tap version it replaces), and the
  // result is the exact expectation the stipple was only sampling.
  int layA = li.x;
  int layB = li.y;
  float layT = clamp(lw.y / max(lw.x + lw.y, 1e-4), 0.0, 1.0);
  bool layMix = layT > 0.02;

  // Anti-repetition, layer one: an ~87 m domain warp and a slowly varying scale
  // jitter. Both vary far more slowly than a texel, which is why the analytic
  // derivatives below stay valid. The scale field is evaluated here rather than
  // read from the data texture: it is a pure uniform-cost noise with no physical
  // meaning, and the baked channel it used to occupy now carries the thermal
  // deposition map, which nothing downstream can reconstruct.
  // One gradient-noise evaluation, not two value ones. tValD hands back the
  // field and both its partials for the price of one lattice fetch set, and a
  // gradient is exactly the two-component slowly-varying vector the warp wants —
  // divergence-free into the bargain, so it cannot fold the domain over itself.
  vec3 macroN = tValD(vWPos.xz * 0.0115 + 7.3);
  vec2 macroW = macroN.yz * 0.9;
  // ------------------------------------------------------------------------
  // The scale jitter is GONE, and its removal is the fix for the directional
  // comb the stage-6 panel filed against every lit slope. The claim four lines
  // up — "both vary far more slowly than a texel, which is why the analytic
  // derivatives below stay valid" — is true of the warp and false of the scale,
  // and the difference is not a matter of degree.
  //
  // A domain WARP is additive: uv = P * s + W(P), so d(uv)/dP = s * I + dW/dP,
  // and dW/dP is bounded by the warp's own amplitude over its own wavelength —
  // here about 0.0005 against s = 0.125, i.e. four parts in a thousand. Safe,
  // exactly as claimed.
  //
  // A scale jitter is multiplicative on the POSITION: uv = P * s(P), so
  // d(uv)/dP = s * I + P (x) grad(s). The second term carries |P| — the distance
  // from the world origin, which on these vantages is 700-1500 m — and it is a
  // RANK-ONE term, so what it does is shear the texture mapping along one
  // direction. Put the numbers in: grad(s) is uMidScale * 0.42 * 0.0115 * the
  // noise gradient, so |P (x) grad(s)| runs to about 1.2 against s = 0.125.
  // The 8 m tile was therefore being drawn stretched by up to TEN TO ONE along
  // a direction that turns slowly across the landscape — and a ten-to-one
  // stretch of a tiling texture is, drawn out, a comb.
  //
  // Two consequences, both of which match what was measured. The stretch is in
  // the MAPPING and not in the filter, so no anisotropy budget could touch it:
  // forcing limitAniso to request a perfectly isotropic fetch left the streak
  // coherence at 0.41 where the shipping budget gave 0.43. And the derivatives
  // handed to textureGrad omit the rank-one term entirely, so the hardware was
  // also picking a mip up to three levels too sharp for the footprint it
  // actually had, which is the second half of the same defect: aliasing along
  // the stretch direction on top of the stretch.
  //
  // Correcting the derivative instead of removing the term is not an option: it
  // is not a filtering error to be compensated, the surface really is smeared
  // ten to one, and an honest footprint would simply blur the whole mid band
  // into its own mean. The variety the jitter was buying is already bought,
  // correctly, by dtScl — a per-CELL scale, constant inside a cell, so its
  // derivative is exactly zero and the mapping stays conformal — and by the
  // per-cell rotation and reflection beside it.
#if TQ_MIDJIT
  float midS = uMidScale * (0.80 + 0.42 * macroN.x);
#else
  float midS = uMidScale;
#endif

  // The macro band's three octaves are evaluated HERE rather than at the bottom
  // of the shader, because the finest of them is needed twice: once as tone, and
  // once — as a gradient — to bend the de-tiling lattice below. Nothing about
  // the values changes; only where they are computed. See the macro band for
  // what they mean.
  float mA = tVal(vWPos.xz * (1.0 / 311.0) + 3.7);
  float mB = tVal(TROT * vWPos.xz * (1.0 / 113.0) - 9.1);
  vec3 mCd = tValD((TROT * TROT) * vWPos.xz * (1.0 / 37.0) + 21.4);
  float mC = mCd.x;

  // Anti-repetition, layer two: the per-cell stochastic frame. See dtCells.
  //
  // The lattice lookup is warped by the 37 m macro gradient before the site
  // search, and that is the second half of the de-facet fix. A jittered-grid
  // Voronoi wall is a straight segment tens of metres long; whatever residual
  // step survives across it is therefore drawn as a *straight edge*, and a field
  // of straight edges meeting at Y-junctions is read by the eye as faceted
  // geometry no matter how small the step is. Displacing the domain by ~0.3 of a
  // cell at a 37 m wavelength turns every wall into a meander, so the same
  // residual reads as mottling in the rock instead of as a plate boundary. The
  // gradient is already in hand from mCd, so this costs one multiply-add.
  vec2 dtA;
  vec2 dtB;
  float dtDD;
  dtCells(vWPos.xz * (1.0 / DT_CELL) + mCd.yz * 0.30, dtA, dtB, dtDD);
  // Two blend widths off one site search, on opposite ramps, and this is the
  // first half of the de-facet fix.
  //
  // The old single width was 0.075 of a cell — 1.7 m — which at the range the
  // cone is seen from is one screen pixel. The mid band could afford that (its
  // 8 m tile is well resolved close up, where 1.7 m is many pixels) but the far
  // band is only *used* past 30 m and dominates past 110 m, so it was being
  // cross-faded over a sub-pixel distance: an unblended discontinuity in albedo
  // AND normal along every wall.
  //
  // So the far band's band widens with distance, to 0.40 of a cell (9 m, ~7 px
  // at 1.4 km), while the mid band's narrows toward zero over the same range —
  // by 420 m the 8 m tile has mipped close to its own mean, so its cell step is
  // small and paying three extra fetches to soften it is waste. The extra taps
  // the far band takes are bought back by the ones the mid band stops taking,
  // and the far band's are the cheaper pair (two fetches against three).
  float dtFar = ss(140.0, 420.0, vCamDist);
#if TQ_CELL_MID
  float dtW = 0.5 * (1.0 - ss(0.0, 0.075, dtDD)) * (1.0 - dtFar);
#else
  // A compile-time zero, not a branch: every consumer below tests dtW > 0.02,
  // so this deletes the runner-up cell's frame setup, its three-to-nine array
  // fetches and their live registers rather than jumping over them.
  float dtW = 0.0;
#endif
  // The far band's cell blend is multiplied by dtFar as well as widened by it,
  // so inside 140 m it does not exist. That is where the fragment budget
  // actually goes — the near field still pays for parallax, the grain band and a
  // full three-layer triple splat — and it is also where the tap is least
  // needed: the mid band is at full strength there, is itself cell-blended, and
  // covers the far band's wall completely. Measured, adding the tap
  // unconditionally cost 2-3 fps on every vantage; gated this way it costs
  // nothing outside the range that had the artefact.
#if TQ_CELL_FAR
  float dtWF = 0.5 * (1.0 - ss(0.0, mix(0.075, 0.34, dtFar), dtDD)) * dtFar;
#else
  float dtWF = 0.0;
#endif
  // Orthogonal frame times a per-cell scale. The product is no longer
  // orthonormal, so nt.xy * dtR counter-rotates the tangent normal *and*
  // scales it by the cell's own factor — a +/-20% bump-strength variation that
  // is harmless (the accumulator is normalised at the end) and, if anything,
  // another axis of variety. The scale itself is faded out with distance; see
  // dtScl for why it is the single largest contributor to the plate step.
  float dtSK = 1.0 - dtFar;
  mat2 dtRA = dtRot(dtA) * dtScl(dtA, dtSK);
  vec2 dtOA = dtOff(dtA);
  // The runner-up cell's frame is five hashes, a sine and a cosine, and it is
  // read only inside a blend band along a cell wall. Both consumers' weights are
  // exactly zero everywhere else, so this is the same gate the fetches
  // themselves use, just moved up over the setup.
  mat2 dtRB = dtRA;
  vec2 dtOB = dtOA;
  if (max(dtW, dtWF) > 0.02) {
    dtRB = dtRot(dtB) * dtScl(dtB, dtSK);
    dtOB = dtOff(dtB);
  }
  // No screen-space pick between the two cells past 90 m either, for the same
  // reason as the layer index above: it was the same IGN lattice, at the same
  // period, and it printed the same crosshatch — on the *background ridge*,
  // which is where the review found it in the dawn frame. The blend band is
  // narrowed instead (see dtCells) so fewer pixels pay for the second tap, which
  // is a cost reduction with no artefact attached rather than a trade of one for
  // the other.

  // Triplanar onset. The old pair (0.86, 0.60) plus the 0.12 tail clip below
  // left a dead band: work it through for a 40-degree face and the blend still
  // comes out fully top-down planar, so every slope between about 30 and 45
  // degrees was sampling the XZ plane through a 1.15-1.41x vertical stretch.
  // That is the "brushed, mushy, stretched into long streaks running down-slope"
  // read the review found on the dune faces, and 30-45 degrees is precisely the
  // band the thermal pass fills the world with, because it is the angle of
  // repose. Starting the ramp at 10 degrees and clipping the tail at 0.07 puts
  // 8% of a real side projection onto a 40-degree face while still resolving to
  // exactly (0,1,0) below 34 degrees, so nothing flat or gently sloping pays for
  // a projection it cannot see — which is what keeps this affordable, since a
  // second projection is another three-to-nine array fetches.
  float tri = ss(0.94, 0.64, N.y);
  vec3 an2 = N * N;
  vec3 tw = an2 * an2 * an2;
  tw = mix(vec3(0.0, 1.0, 0.0), tw / max(tw.x + tw.y + tw.z, 1e-4), tri);
  tw /= (tw.x + tw.y + tw.z);
  // Clip the tail of the blend to zero. On a 30-degree slope the two off-axis
  // projections carry 4% between them; they cost two thirds of the texture
  // budget of this shader and contribute a 15% UV stretch correction nobody can
  // see. Subtracting a constant before renormalising is continuous — a
  // projection fades to zero and stays there rather than switching — and it
  // reaches exactly zero, which is what lets the fetches be skipped. A genuine
  // 45-degree corner still keeps both of its axes at 0.5, so the cases that
  // actually need blending are untouched; only the ones that were paying for a
  // projection they could not see stop paying.
  //
  // The clip widens from 0.10 to 0.30 with distance, and that is the same
  // argument applied twice. The only thing a minor projection contributes is a
  // UV-stretch correction on a steep face — reading a cliff through its own
  // plane rather than through a foreshortened one. Past a few hundred metres
  // the mip the fetch lands in is already coarser than the stretch being
  // corrected, so a quarter-weight side projection is buying a difference that
  // has been filtered away, and it costs a whole extra trip through
  // sampleTriple: three to nine array fetches, on the geometry that fills the
  // upper half of every landscape frame.
  //
  // Widening the clip rather than snapping to the dominant axis is deliberate.
  // A one-hot collapse would key the whole albedo off domAx, and domAx flips
  // across the contour where the top two weights cross — on a cone like Red
  // Mountain that contour is a long curve down the flank, and the projection
  // switching along it would print as a seam. The clip is continuous in tw and
  // stays below a third, so the leader can never be clipped out and a genuine
  // 45-degree corner keeps both of its axes at 0.5 at every distance. Only the
  // projections that were already nearly invisible stop being paid for.
  // 240-500 m, pulled in from 300-620. This is where the far band's new
  // cell-blend tap is paid for, and the argument for moving it is the one
  // already made below: the only thing a minor projection buys is a UV-stretch
  // correction on a steep face, and the mip that correction lands in is coarser
  // than the correction itself well before 300 m. A whole trip through
  // sampleTriple — three to nine array fetches — is a great deal more than the
  // two textureLods it is funding, so the net on the mountain vantages is a
  // saving rather than a cost.
  float triCollapse = ss(240.0, 500.0, vCamDist);
  tw = max(tw - mix(0.10, 0.30, triCollapse), vec3(0.0));
  tw /= max(tw.x + tw.y + tw.z, 1e-4);

  // Dominant projection, shared by the meso and detail bands below so both sit
  // in the same plane and the same world tangent frame.
  int domAx = (tw.y >= tw.x && tw.y >= tw.z) ? 1 : (tw.x >= tw.z ? 0 : 2);

  // Anisotropy budget for every array fetch below. See limitAniso.
  // 16 near, not 8, and this is a correctness fix rather than a quality dial.
  //
  // Ground seen from 1.8-3 m of eye height passes a footprint ratio of 8:1 at
  // about fifteen metres and 30:1 by forty. When the hardware cannot cover the
  // ratio it takes maxAniso taps of a mip chosen from major/maxAniso — that is,
  // it line-integrates a blurred disc along the major axis, which on a ground
  // plane points radially away from the camera. The image of that is a fan of
  // radial striations converging on the vanishing point, of width major/8 and
  // length major: "long directional brushed-metal striations converging toward
  // a point off the lower-left", in the review's words, on three separate shots.
  // Doubling the budget halves the streak width and doubles the mip resolution
  // it is drawn from, and it costs taps only on the grazing pixels that were
  // producing the artefact.
  // See TQ_ANISO_NEAR. The far end stays at 2 on every tier — past a couple of
  // hundred metres the mip being walked is coarser than the taps are resolving,
  // so the budget there was already free.
  float maxAniso = mix(TQ_ANISO_NEAR, 2.0, ss(40.0, 260.0, vCamDist));

  // Parallax occlusion, ground projection only, inside the near band. Cliffs
  // already read as deep through triplanar plus the geometric relief, and
  // marching three projections would triple the worst-case tap count.
  vec2 pomOff = vec2(0.0);
#if TQ_POM
  float nearBand = 1.0 - ss(5.0, 14.0, vCamDist);
  if (nearBand > 0.01 && tw.y > 0.55) {
    vec3 V = normalize(uEye - vWPos);
    vec3 vts = vec3(V.x, V.z, max(abs(V.y), 0.2));
    vec2 maxOff = -(vts.xy / vts.z) * (uPomStrength * nearBand);
    // uPomStrength is 0.01 UV, which at the mid tiling scale is about 8 cm of
    // parallax: 22 steps resolved it to 4 mm, an order of magnitude finer than
    // the 512-texel-per-8-m map it is marching through, and each step is an
    // array fetch. Twelve steps land one sample per texel at the near plane,
    // which is where the linear interpolation between the last two steps takes
    // over anyway.
    // Three to six. uPomStrength is 0.01 UV, about 8 cm of throw at the mid
    // tiling scale; six steps already land under one texel of the map being
    // marched, and the linear solve between the last two steps carries the rest.
    // Each step is an array fetch inside the band that also pays for the detail
    // grain and the full triple splat, so this is the most expensive fetch in
    // the shader per unit of visible effect.
    float nsteps = mix(3.0, 6.0, nearBand);
    float layerD = 1.0 / nsteps;
    // Marched in the dominant cell's frame, and the offset is returned in that
    // frame too: the loop below re-uses it before its own rotation, so the two
    // agree. (The runner-up tap gets the same offset; it is only ever half the
    // weight and only inside the narrow blend band.)
    vec2 stepUV = dtRA * maxOff * layerD;
    vec2 baseUV = dtRA * (vWPos.xz * midS + macroW * 0.85) + dtOA;
    vec2 du = dtRA * (dpx.xz * midS);
    vec2 dvv = dtRA * (dpy.xz * midS);
    // An explicit isotropic mip, not textureGrad.
    //
    // The march is a height *probe*: its samples decide where a ray stops, they
    // are never shown. Running it through the gradient path asks the hardware
    // for up to eight trilinear taps per step — and this band is inside 14 m,
    // where the footprint ratio on ground is at its most extreme, so it really
    // is eight. Eight taps times seven steps is fifty-six filtered reads to
    // resolve an 8 cm offset. The major-axis LOD is the same mip textureGrad
    // would have chosen, and averaging across the minor axis is if anything
    // *better* here: an anisotropic probe of a displacement field is what makes
    // a grazing march jitter from pixel to pixel.
    float pomLod = log2(max(max(length(du), length(dvv)) * 512.0, 1.0));
    float curLayer = 0.0;
    vec2 cur = baseUV;
    vec2 prev = baseUV;
    float curH = textureLod(uArmArr, vec3(cur, float(layA)), pomLod).a;
    float prevH = curH;
    for (int i = 0; i < 6; i++) {
      if (float(i) >= nsteps || curLayer >= 1.0 - curH) break;
      prev = cur;
      prevH = curH;
      curLayer += layerD;
      cur += stepUV;
      curH = textureLod(uArmArr, vec3(cur, float(layA)), pomLod).a;
    }
    // The previous *sample* is carried through the loop rather than re-fetched
    // after it. Refetching cost an eighth of the band's texture budget to
    // recompute a value the loop had already had in a register — and where the
    // loop never ran it was fetching a step the march never took.
    float d1 = (1.0 - curH) - curLayer;
    float d2 = (1.0 - prevH) - (curLayer - layerD);
    pomOff = mix(cur, prev, clamp(d1 / max(d1 - d2, 1e-4), 0.0, 1.0)) - baseUV;
  }
#endif

  vec3 accA = vec3(0.0);
  vec3 accN = vec3(0.0);
  float accAO = 0.0;
  float accR = 0.0;
  float accH = 0.0;
  // Roughness multiplier accumulated across the detail bands, applied once at
  // the end beside the macro term.
  //
  // Rule 5 asks for wet, dusty and glassy surfaces to be unmistakable from
  // shading alone, and until now every band in this shader wrote albedo, normal
  // and cavity and none of them wrote roughness: the only things varying it
  // were the layer table, one 311 m noise octave and the wetness uniform. A
  // surface whose specular response is constant across it is a surface with one
  // material on it, which is what "reads as untextured clay" describes — clay is
  // exactly the material with no roughness structure. Every band below that has
  // a physical reason to change the lobe now does, and it costs nothing: these
  // are multiplies against fields the bands have already evaluated.
  float rghK = 1.0;

  for (int ax = 0; ax < 3; ax++) {
    float aw = ax == 0 ? tw.x : (ax == 1 ? tw.y : tw.z);
    if (aw < 0.02) continue;
    vec2 uv;
    vec2 du;
    vec2 dvv;
    if (ax == 0) { uv = vWPos.zy; du = dpx.zy; dvv = dpy.zy; }
    else if (ax == 1) { uv = vWPos.xz; du = dpx.xz; dvv = dpy.xz; }
    else { uv = vWPos.xy; du = dpx.xy; dvv = dpy.xy; }
    uv = uv * midS + macroW * 0.85;
    du *= midS;
    dvv *= midS;
    limitAniso(du, dvv, maxAniso);

    vec3 a;
    vec3 nt;
    float ao;
    float rg;
    float hg;
    {
      vec2 uvA = dtRA * uv + dtOA;
      if (ax == 1) uvA += pomOff;
      sampleTriple(uvA, dtRA * du, dtRA * dvv, li, lw, a, nt, ao, rg, hg);
      // The texture domain was rotated, so its tangent-space normal has to be
      // counter-rotated back into the projection frame. v * M is transpose(M)*v
      // in GLSL, which is the inverse of an orthonormal rotation.
      nt.xy = nt.xy * dtRA;
      if (dtW > 0.02) {
        vec3 a2;
        vec3 nt2;
        float ao2;
        float rg2;
        float hg2;
        vec2 uvB = dtRB * uv + dtOB;
        if (ax == 1) uvB += pomOff;
        sampleTriple(uvB, dtRB * du, dtRB * dvv, li, lw, a2, nt2, ao2, rg2, hg2);
        nt2.xy = nt2.xy * dtRB;
        a = mix(a, a2, dtW);
        nt = mix(nt, nt2, dtW);
        ao = mix(ao, ao2, dtW);
        rg = mix(rg, rg2, dtW);
        hg = mix(hg, hg2, dtW);
      }
    }
    accA += a * aw;
    accAO += ao * aw;
    accR += rg * aw;
    accH += hg * aw;
    if (ax == 0) accN += vec3(nt.xy + N.zy, abs(nt.z) * N.x).zyx * aw;
    else if (ax == 1) accN += vec3(nt.xy + N.xz, abs(nt.z) * N.y).xzy * aw;
    else accN += vec3(nt.xy + N.xy, abs(nt.z) * N.z).xyz * aw;
  }

#if TQ_DBG == 8
  // The splat's own albedo, before any analytic band has touched it.
  vec3 dbgSplat = accA;
#endif

  // domAx was chosen above, before the distance collapse folded tw onto it.
  vec2 domUV = domAx == 1 ? vWPos.xz : (domAx == 0 ? vWPos.zy : vWPos.xy);
  vec2 domDX = domAx == 1 ? dpx.xz : (domAx == 0 ? dpx.zy : dpx.xy);
  vec2 domDY = domAx == 1 ? dpy.xz : (domAx == 0 ? dpy.zy : dpy.xy);
  vec3 domT;
  vec3 domB;
  axisFrame(domAx, N, domT, domB);

  // fp and fpH are computed at the top of this function, before any projection
  // has been chosen. See the note there for why they cannot be derived from
  // domDX/domDY.

  // ------------------------------------ analytic anisotropic filter, near bands
  //
  // The direction to integrate along, and the feature size that becomes
  // resolvable once a band does. See tValD3 for why this exists.
  //
  // The major axis of the footprint is taken as the longer of the two screen
  // derivatives inside the dominant projection. That is exact when they are
  // orthogonal and within a few degrees when they are not, which is all the
  // accuracy aiming a three-tap box needs — a box filter is symmetric, so a
  // small misalignment costs a little filtering, never a smear in a wrong
  // direction.
  //
  // anF is the length a filtered analytic band can honestly resolve: a third of
  // the major axis, floored at the MINOR axis, because integrating along one
  // direction buys nothing across it. Bands keep their existing gate shapes and
  // simply read anF where they read fpH — the endpoints were chosen against a
  // feature-per-pixel ratio and that ratio still means what it meant.
  vec2 anMaj = dot(domDX, domDX) >= dot(domDY, domDY) ? domDX : domDY;
  vec2 anStep = anMaj * (1.0 / float(TQ_ANTAP));
  float anF = max(fpH * (1.0 / float(TQ_ANTAP)), fpMin);

  // --------------------------------------------- aerial-perspective pre-emphasis
  //
  // Extinction is multiplicative on the surface's own contrast. At a kilometre
  // and a half the transmittance through this atmosphere is of order 0.1, so a
  // +/-25% albedo swing arrives at the film as +/-2.5% — five code values, which
  // is precisely what the review measured ("varies by fewer than 6 code values",
  // "max vertical gradient 4.3/255", "local 9x9 std below 1.5 over 76.5% of the
  // frame"). There is nothing wrong with the material at that range and nothing
  // wrong with the air; the two compose to nothing.
  //
  // So the surface's own contrast widens with range, so that what survives the
  // air is roughly constant. This is pre-emphasis on the albedo, NOT a change to
  // the fog: the fog term is untouched, the near field is untouched (the ramp is
  // exactly 1.0 inside 180 m), and the lift is bounded at 2.6x so a distant flank
  // can never leave the palette or clip. It applies only to the large-scale
  // terms — the far band and the macro drift/scour — because those are the only
  // ones whose features are still bigger than a pixel out there.
  //
  // The ramp is in OPTICAL depth, not in metres, and that is what makes it work
  // in weather.
  //
  // 180-1500 m is the right band for a clear day and completely wrong for an ash
  // storm, where the extinction coefficient is two orders of magnitude higher and
  // a 250 m path already carries the optical depth a clear kilometre and a half
  // does. In the ashstorm vantage the whole mountain mass sits inside 800 m, so
  // every surface in the frame was drawn with a pre-emphasis of 1.0 and then
  // multiplied by a transmittance of order 0.05: block-variance analysis put 92%
  // of 8x8 luminance blocks under one code value of standard deviation, which is
  // not a missing-detail finding at all — the detail is authored, it is present in
  // the albedo, and the air is deleting it before it reaches the film.
  //
  // uHaze is the weather's own extinction coefficient, normalised so clear air is
  // 0 and a full ash storm is 1, and it advances the ramp rather than widening
  // it: the bound stays exactly 2.6x, so nothing here can leave the palette or
  // clip, and a clear day is byte-identical to before.
  //
  // The haze term is allowed past the clear-air bound, and that is safe for a
  // reason that does not apply to the distance term. Extinction and
  // pre-emphasis are reciprocal here by construction: the haze term only
  // reaches its maximum where the transmittance has fallen to a few per cent, so
  // a 4x widening of the surface's own contrast arrives at the film as a small
  // fraction of one. The 25 m onset keeps it entirely off the ground under the
  // camera's feet, where the air has done nothing yet.
  float farLift = 1.0 + 1.6 * ss(180.0, 1500.0, vCamDist) + 2.4 * uHaze * ss(25.0, 400.0, vCamDist);
  farLift = min(farLift, 4.4);

  // ---------------------------------------------------------------- meso band
  //
  // Relief from uMesoTop (12 m) down to about half a metre, evaluated per pixel.
  //
  // This is the band the heightfield is forbidden to hold. Height samples are
  // 1.95 m apart, so anything under ~4 m cannot be represented there at all and
  // anything under ~6 m is represented so poorly that the reconstruction beats
  // against the sample lattice. Here there is no lattice: the octave count
  // follows the pixel footprint, so an octave is dropped the moment it stops
  // being resolvable instead of folding back down into a periodic artefact.
  // That footprint fade is the whole reason this belongs in the fragment stage
  // and not in a bake.
  //
  // Four octaves at 0.42: 22, 9.2, 3.9 and 1.6 m. The band deliberately stops
  // above a metre — below that the 0.5 m grain layer and the wind ripple are
  // already carrying the surface, and a fifth octave here was paying a full
  // gradient-noise evaluation to duplicate them.
  //
  // Amplitude is gated on slope squared: gravity sorts material, so ash flats
  // stay smooth and anything steep enough to shed rubble gets it.
  // The flat-ground floor was 0.22 * 0.5 = 0.11, which is why the near-field
  // gradient measured 7 levels out of 255 inside 8 m of the camera: on ash flats
  // the band was switched almost entirely off. Ash is powder, not polished
  // stone; it holds drift, scour and footprint relief. Floor raised and the
  // ash suppression softened.
  // Floor raised from 0.40 to 0.85 and the slope term softened from 3.1 to 1.9.
  //
  // This is the fix for the dead midground. The band was gated on slope
  // squared, so on a plain it ran at 0.40 * 0.72 = 0.29 of full strength — and
  // a plain is precisely where nothing else survives past 30 m: the ripple ends
  // at 55, the 0.5 m grain at 78, and the 8 m mid band has mipped toward its own
  // mean. That left a smooth featureless annulus between the near field and the
  // mountain, read by the review as an untextured surface with a ring around
  // the viewer. Ash flats are not smooth; they are drift, scour and deflation
  // hollows, and this band is the only thing in the shader that can carry them
  // at 60-400 m. The slope term still exists, so scree faces stay rougher than
  // the flats — it is now a modulation rather than a switch.
  // Slope response raised from 1.9 to 4.5, and the cap with it.
  //
  // At 1.9 a 50-degree basalt face ran at 0.85 + 1.9*0.36^2 = 1.10, i.e. eleven
  // per cent more relief than a dead-flat ash pan. That is not a material
  // difference, and it is why every steep face in the review came back "an
  // airbrushed silhouette", "a smooth dome", "no rock, no scree, no erosion
  // channel". Amplitude over wavelength is surface roughness: ash drift sits
  // near 0.10 and broken volcanic rock near 0.25, so the ratio between the two
  // ends has to be about 2.5 and it was 1.1. At 4.5 the same face reaches 1.43
  // and a 60-degree one 1.98, which is that ratio.
  //
  // This band is also the only thing masking the LOD lattice on the midground:
  // at 1.4 km a depth-3 node draws 15 m cells, roughly 17 px, and the review
  // read those as "large flat triangular facets" and "a perfectly straight
  // diagonal separating two regions of constant value". Per-pixel relief at 22
  // and 9 m — both of which are still ten or more pixels at that range — is what
  // breaks the plate up, and it costs nothing per triangle.
  float mesoK = (0.85 + 4.5 * slope * slope) * (1.0 - 0.12 * clamp(w[0], 0.0, 1.0));
  // 260-620 m was throwing the band away at exactly the range a landscape shot
  // lives at, and for no reason: the per-octave gate ss(2.5, 6.0, lam/fp) below
  // already drops an octave the moment its wavelength stops covering six pixels,
  // so distance is handled octave by octave and this second, blunter fade was
  // pure loss. At 800 m the 12 m and 5.5 m octaves still cover 17 and 8 pixels
  // respectively; those are the only thing giving a far hillside any relief
  // shading at all once the mid band has mipped to its mean.
  //
  // Computed *before* the octaves rather than after them, which is the only
  // reason it is up here: mesoK reaches exactly zero at 2400 m, and the band was
  // evaluating two surviving octaves — eight hashes and two gradient
  // reconstructions — out to the far clip in order to multiply them by nothing.
  mesoK = clamp(mesoK, 0.0, 2.20) * (1.0 - ss(900.0, 2400.0, vCamDist));
  vec2 mesoG = vec2(0.0);
  float mesoH = 0.0;
  float mesoNorm = 0.0;
  if (mesoK > 0.002) {
    float lam = uMesoTop;
    float amp = uMesoAmp;
    // Every octave on its own orientation. Unrotated, five octaves of value
    // noise on the same lattice sum to a corrugation whose ridges run along x
    // and z — the pillow-bump weave the review measured on the near ground.
    mat2 orot = mat2(1.0, 0.0, 0.0, 1.0);
    // TQ_MESO_OCT, dropped from the FINE end. The ladder is amplitude-over-
    // wavelength constant, so the octaves that go are the ones whose relief is
    // smallest in world terms and shortest-lived on screen; the 22 m and 9.2 m
    // octaves that carry a distant hillside's form are on every tier.
    for (int i = 0; i < TQ_MESO_OCT; i++) {
      // Against fpH — the MAJOR axis — and this is the fix for the concentric
      // rings, measured rather than argued.
      //
      // TQ_DBG 9 on the coast vantage puts dozens of nested arcs into the cavity
      // channel over ground whose splat albedo and shading normal are both clean,
      // and setting TQ_MESO_OCT to 0 removes every one of them. So the rings are
      // this band, and the mechanism is not subtle: a pixel of grazing ground at
      // 200 m from a 3 m eye has a footprint ellipse about 15 m long and 0.2 m
      // wide, and this is a POINT evaluation of an isotropic 9 m field. There is
      // no filter anywhere in it. Sampling a 9 m field once per 15 m of surface
      // is aliasing by definition, and because the sample points lie on a
      // receding plane the fold-over lands as iso-range arcs — the rings, centred
      // on the vanishing point rather than on anything in the world, which is why
      // they read as crop circles.
      //
      // fp — the geometric mean with the ratio clamped at 6 — said this octave
      // covered six pixels when along the direction that decides whether it folds
      // it covered two thirds of one. That number is right for the TEXTURE bands,
      // which have a real anisotropic filter and genuinely resolve the mean, and
      // it is meaningless for a band with no filter at all.
      //
      // What this costs is the fine octave on grazing ground past about sixty
      // metres, and that is not a loss to be recovered here: the surface out
      // there has to be carried by something that can be FILTERED, which is the
      // far band's 72 m tile (now fetched anisotropically) and the 37-311 m macro
      // octaves, both of which are far above the footprint and cannot fold. A
      // flank facing the camera keeps every octave at every range, because there
      // the footprint is round and fpH and fp are the same number.
      // Eight pixels per cycle at the onset and twenty-six at full weight, and
      // the width is not conservatism — it is forced by the normalisation four
      // lines down.
      //
      // mesoShape divides the octave sum by the sum of the weights that produced
      // it, so the band's output contrast does NOT fall as octaves drop out: it
      // is renormalised straight back to full. That is deliberate and it is what
      // stops a distant hillside going flat, but it also means the per-octave
      // gate does not attenuate anything — it only decides which octave is the
      // last one standing, and whatever that octave is, it is then presented at
      // FULL contrast. An octave admitted at three pixels per cycle is therefore
      // not a faint contribution near its sampling limit; it is a full-amplitude,
      // point-evaluated periodic below Nyquist, and on a receding ground plane
      // the fold-over of that draws nested arcs — the crop circles the review
      // measured on the coast midground, which TQ_DBG 9 puts squarely in the
      // cavity channel and TQ_MESO_OCT 0 removes entirely. The same mechanism
      // draws the wood-grain weave on the ridge caldera wall.
      //
      // A gate that is cancelled by a renormaliser has to be strict, because the
      // renormaliser will restore whatever it lets through. Nothing under eight
      // pixels per cycle now exists at all. The band keeps its contrast at every
      // range — the coarse octaves carry it, which is exactly what they are for.
      // Against anF, and filtered along the major axis where — and only where —
      // it has to be. The strictness above is right and stays right; what
      // changes is that "eight pixels per cycle" is now measured against a
      // filtered footprint rather than a point sample's. On grazing ground that
      // is the difference between this band ending at the 22 m octave and
      // carrying its 9 m and 4 m ones as well, which is the whole of the
      // featureless annulus between the near field and the mountain.
      //
      // The three-tap form is taken ONLY when the unfiltered gate would have
      // closed the octave, i.e. when the wavelength has dropped under 26 pixels
      // of the MAJOR axis. Nearer in — where the footprint is round and the
      // octave is genuinely resolved — a box would only soften a signal that is
      // already correct, and it would charge two extra evaluations per octave
      // over the part of the frame that has the most octaves alive. The test is
      // a scalar on a quantity that varies smoothly across the screen, so the
      // branch is coherent over large blocks.
      float oct = ss(8.0, 26.0, lam / anF);
      if (oct > 0.004) {
        vec2 op = orot * (domUV / lam) + float(i) * 19.37 + macroW * 0.4;
        vec3 nz = lam < 26.0 * fpH ? tValD3(op, (orot * anStep) / lam) : tValD(op);
        mesoH += amp * oct * (nz.x - 0.5);
        // The gradient comes back in the octave's own rotated frame; transpose
        // it into the projection frame before it reaches the tangent basis.
        mesoG += (amp * oct / lam) * (nz.yz * orot);
        mesoNorm += amp * oct;
      }
      // 0.42, so amplitude over wavelength — surface roughness — is identical
      // in every octave and the band is scale-invariant across its whole span.
      lam *= 0.42;
      amp *= 0.42;
      orot = TROT * orot;
    }
  }
  accN -= (domT * mesoG.x + domB * mesoG.y) * mesoK;
  // A cavity term so the relief reads as form and not only as a lighting
  // response: pits darken, crests catch the pale ash dust.
  float mesoShape = mesoNorm > 1e-4 ? clamp(mesoH / mesoNorm + 0.5, 0.0, 1.0) : 0.5;
  // The band's own dynamic range, MEASURED rather than assumed, and this is the
  // single largest reason the surfaces this band is the only thing carrying
  // still came back as untextured.
  //
  // Every modulator below is written against the [0,1] span of mesoShape and
  // quotes its endpoints as the swing it delivers ("+/-0.36 of occlusion",
  // "+/-34%"). mesoShape does not have a [0,1] distribution. It is a normalised
  // sum of four quintic value-noise octaves on a 0.42 amplitude ladder; run
  // 400k samples of exactly the field the loop above builds (tools scratch
  // measurement, same tHash, same TROT, same lacunarity) and it comes back
  //
  //     single octave   mean 0.4994   sd 0.2253
  //     four-octave sum mean 0.4995   sd 0.1487
  //
  // so the endpoints sit at 3.4 sigma and the modulators reach 15% of their
  // stated swing at one sigma. Worked through the albedo term at full strength:
  // one sigma of the field renders as +/-6.3% of albedo, which on the mid-grey
  // these vantages sit at is five or six code values — "std 3.5/255", "sd 1.4
  // over 110x100 px", "fewer than 6 code values". The content was authored, the
  // endpoints were chosen sensibly, and the field driving them was using an
  // eighth of its range.
  //
  // A gain on the DEVIATION FROM THE MEAN, with a soft knee. t/(1+t^4)^(1/4) has
  // unit slope at the origin, is still 95% linear at one sigma of the expanded
  // field and saturates smoothly at +/-1, so the bulk of the distribution gets a
  // clean 2.3x expansion and only the far tail is compressed. Deliberately not a
  // clamp: a clamped tail is a plateau, and a plateau is a flat surface, which is
  // the one failure mode this whole pass exists to remove.
  //
  // The field is symmetric about 0.5 and the knee is odd, so the mean comes out
  // at 0.5 before and after to within a rounding error: every modulator below
  // keeps exactly the level it had, and only the distance between a crest texel
  // and a pit texel changes. That is a surface-contrast operation and not a
  // grade — it cannot move the exposure, the white point or the hue of any
  // surface, only how far apart two points on the SAME surface sit.
  //
  // Measured through the albedo term at full strength: one sigma of the field
  // now renders as +/-18.6% against +/-6.3%, and two sigma at +/-27% — the
  // ratio between wind-scoured crust and the drift banked against it, which is
  // what the palette's ash range (#8a7f72 to #4a423b) is describing.
  {
    float mEx = (mesoShape - 0.5) * 4.6;
    float mEx4 = mEx * mEx * mEx * mEx;
    mesoShape = 0.5 + 0.5 * (mEx * inversesqrt(sqrt(1.0 + mEx4)));
  }
  // Clamped: mesoK now reaches 2.2 on a cliff and these two are mix() factors,
  // which extrapolate past 1. The relief itself is allowed the full range — that
  // is the point of raising it — but the cavity and tint terms are cosmetic
  // and would run out of the palette.
  float mesoT = min(mesoK, 1.35);
  // Centred and widened: 0.40 + 1.20 * shape passes through exactly 1.0 at the
  // field's own mean of 0.5, where 0.52 + 0.72 * shape passed through 0.88 —
  // i.e. the old form was a 9% ambient darkening of every surface it touched
  // wearing a cavity term's clothes, and it spent most of its range doing that
  // instead of separating a pit from a crest. The swing is now +/-0.36 of
  // occlusion at full strength against +/-0.24, and it costs nothing.
  accAO *= mix(1.0, 0.40 + 1.20 * mesoShape, mesoT * 0.60);
  // Cool in the hollows, warm on the crests. Same argument as the macro band at
  // three hundred times the wavelength: a hollow holds shadowed cinder and a
  // crest holds wind-blown fines, so this is a hue axis and not only a value
  // one, and a hue axis is the thing that survives both the mip chain and the
  // aerial-perspective term at the 1-22 m scale this band owns.
  // Endpoints widened and made symmetric about 1.0.
  //
  // This band owns 1-22 m and is the only ALBEDO term in the shader between the
  // 8 m tile (which has mipped to its own mean by thirty metres) and the 37 m
  // macro octave, so on a hillside at 60-400 m it is carrying the whole
  // midground on its own. It was running at mesoT * 0.5 between 0.66 and 1.24 —
  // a swing whose mean is 0.95, i.e. it was also quietly darkening every surface
  // it touched by five per cent. Symmetric endpoints at +/-34% with the factor
  // at 0.62 give a mean of exactly 1.0 and half again the spread, and it is a
  // hue axis as well as a value one (hollows hold shadowed cinder, crests hold
  // wind-blown fines), which is what survives both the mip chain and the
  // aerial-perspective term at this scale.
  //
  // And it carries the aerial pre-emphasis, which until now only the macro
  // scour/drift pair and the drainage term did.
  //
  // That was an oversight rather than a decision. farLift exists because
  // extinction is multiplicative on surface contrast — at a kilometre and a
  // half the transmittance through this atmosphere is of order 0.1, so a
  // +/-25% albedo swing arrives at the film as five code values — and the note
  // beside it says it applies to "the large-scale terms, because those are the
  // only ones whose features are still bigger than a pixel out there". A 1-22 m
  // relief band is exactly such a term: its top two octaves are still ten to
  // forty pixels wide at a kilometre, and on a hillside between 60 m and the far
  // plane it is the ONLY albedo variation in the shader that neither repeats
  // nor has mipped to its own mean. Leaving it un-lifted is why the midground
  // measured "a single interpolated wash the same hue as the fog".
  //
  // This is pre-emphasis on the SURFACE, not a change to the air and not a
  // tint: it scales each term's deviation from 1.0, so a mean-value pixel is
  // untouched at every range and the level of the frame cannot move.
  vec3 mesoMod = mix(vec3(1.0), mix(chromaTrim(vec3(0.66, 0.69, 0.78), TQ_CHROMA), chromaTrim(vec3(1.34, 1.27, 1.14), TQ_CHROMA), mesoShape), mesoT * 0.62);
  accA *= max(vec3(0.05), vec3(1.0) + (mesoMod - vec3(1.0)) * farLift);
  // Crests are wind-polished, hollows hold powder.
  rghK *= mix(1.0, mix(1.10, 0.90, mesoShape), mesoT * 0.55);

  // ----------------------------------------------------------- bedding band
  //
  // Strata, per pixel, on anything steep enough to expose section.
  //
  // Heightfield.stratify already terraces the bake, but its beds are 11-27 m on
  // a 1.95 m grid: that is a *landform* operator, it shapes ledges a hundred
  // metres wide and contributes nothing at the scale a flank is read at. What
  // separates rock from modelling clay in a still frame is bedding at metres,
  // and no isotropic noise band can supply it however much amplitude it is
  // given, because bedding is not isotropic. It is a purely VERTICAL
  // periodicity, so it wraps a landform in horizontal lines and every one of
  // those lines is a contour of the surface — which is the single strongest
  // "this is stone" cue there is, and the one the review asked for by name on
  // the cone ("no strata, no lava-tube ridges"), on the midground hill ("no
  // rock, no scree, no erosion channel") and on the coast slopes.
  //
  // Driven off world Y so the beds are level everywhere and agree between
  // neighbouring landforms. The phase is nudged laterally by a 17 m field, which
  // is what stops it printing as a set of perfect concentric rings — the review
  // found exactly those on the left maroon slope in coast and correctly read
  // them as a topographic map rather than as ground.
  //
  // Amplitude is stated in metres of relief and the normal tilt derived from it,
  // rather than the other way round, so the tilt scales correctly when the
  // lithology field moves the bed thickness. 0.30 m over a ~5.5 m bed is a slope
  // of 0.34, about nineteen degrees at the riser.
  float bedLam = 5.5 * (0.65 + 0.80 * mB);
  // 7-20 pixels per bed, not 1.5-6, and this single number is the whole of the
  // "corrugated cardboard / wood grain / topographic map" family of findings.
  //
  // This band is a SINUSOID at full contrast — 0.24 of albedo and a 19-degree
  // normal tilt — not a noise field whose amplitude falls with its octave. A
  // sinusoid needs a great deal more than two and a half samples per cycle
  // before it stops folding, and the old gate let it run at 1.5 px per bed. On
  // the caldera wall in the ridge vantage that put a 5 m bed at six or seven
  // pixels over a
  // surface whose depth (and therefore whose vertical rate) changes across the
  // frame, and the product of two near-Nyquist periodicities is a moire: the
  // measured artefact is a fine diagonal cross-hatch resolving into nested
  // chevrons, which is exactly what an aliased sinusoid on a curved surface
  // draws. It is not a texture repeat and it is not the geometry; it is this
  // sine being asked to exist below its own sampling limit.
  //
  // Seven pixels per bed at the onset and twenty at full strength is generous
  // Nyquist headroom, and nothing is lost by it: below that range the
  // heightfield's own stratify() pass — 11 to 27 m beds — is what carries
  // bedding, and those are still tens of pixels wherever this band has faded.
#if TQ_STRATA
  // TWO bed scales, not one, and the coarse one carries no distance fade at all.
  //
  // A sinusoid has to be given real Nyquist headroom or it folds, so the fine
  // 3.6-8.5 m bed has to switch off at range — and once it has, a distant flank
  // has nothing on it but a 72 m tile that has mipped toward its mean and a
  // handful of hundred-metre noise octaves. That is the "summit is a soft
  // gradient blob with zero texture" and the "cliff is one texture at one scale
  // over 400 px of screen" findings, and it is not something the fine band can
  // fix: at 2 km one of its beds is a third of a pixel.
  //
  // Bedding is not a single frequency in the first place. Formations are stacked
  // in members tens of metres thick, each cut into individual beds of metres, and
  // the member boundaries are the thing that is still visible from across a
  // valley. So the member scale is a band of its own at 5.2x the bed thickness —
  // 19 to 44 m — which is seven to twenty pixels wide out to the far clip on any
  // flank facing the camera and therefore never needs to be faded on distance at
  // all. It is the layer that keeps a summit reading as rock, and because its
  // phase comes from the same dipped datum as the fine beds, the two agree: the
  // fine beds resolve into the members as the camera approaches instead of
  // appearing on top of them.
  float bedMem = bedLam * 5.2;
  float strataSel = ss(0.10, 0.32, slope) * (0.30 + 0.70 * clamp(w[1] + w[2] + w[3], 0.0, 1.0));
  float strataK = strataSel * ss(7.0, 20.0, bedLam / fpH) * (1.0 - ss(1400.0, 3000.0, vCamDist));
  float memK = strataSel * ss(7.0, 20.0, bedMem / fpH);
  if (memK > 0.01) {
    // Same datum, same lateral phase break, one fifth the frequency. Amplitude
    // over wavelength is held at the fine band's value, so the member reads as a
    // broad shelf rather than as a second, louder set of beds.
    float mDatum = vWPos.y + (tVal(vWPos.xz * (1.0 / 240.0) + 8.1) - 0.5) * 46.0;
    float mPh = mDatum / bedMem + 0.55 * tVal(vWPos.xz * (1.0 / 88.0) + 3.9);
    float mc = mPh * 6.2831853;
    float mLedge = 0.80 * sin(mc) + 0.20 * sin(mc * 2.0);
    float dMem = (0.80 * cos(mc) + 0.40 * cos(mc * 2.0)) * (6.2831853 * 0.30 * 5.2 / bedMem);
    vec3 mdip = normalize(vec3(-N.x * N.y, 1.0 - N.y * N.y, -N.z * N.y) + vec3(1e-6));
    accN -= mdip * (dMem * mdip.y * memK * 0.55);
    accAO *= 1.0 - 0.20 * memK * clamp(0.5 - 0.5 * mLedge, 0.0, 1.0);
    // Carries the aerial pre-emphasis: this band exists precisely to survive a
    // kilometre of air, and at a transmittance of order 0.1 an un-lifted 20%
    // albedo swing arrives as two code values.
    vec3 memMod = mix(vec3(1.0), vec3(1.0) + chromaTrim(vec3(0.20, 0.185, 0.155), TQ_CHROMA) * mLedge, memK * 0.85);
    accA *= max(vec3(0.05), vec3(1.0) + (memMod - vec3(1.0)) * farLift);
    rghK *= mix(1.0, 1.07, memK * clamp(0.5 + 0.5 * mLedge, 0.0, 1.0));
  }
  if (strataK > 0.01) {
    // Regional dip, and it is the difference between bedding and a contour map.
    //
    // The phase was world Y alone, nudged by a 17 m field. A terrace operator on
    // altitude alone puts every riser on an exact contour of the surface, so the
    // beds run parallel to the horizon, sit at even vertical spacing, and appear
    // identically on landforms that have nothing to do with each other — which
    // is precisely how the review read them ("heightmap quantization steps, not
    // authored strata"). They are not quantisation (the height texture is R32F)
    // and they are not the LOD; they are level beds, and level beds ARE contour
    // lines. A 17 m wobble cannot fix that: it roughens the contour without
    // taking the riser off it.
    //
    // Real beds are tilted and folded. Shifting the bedding *datum* by a smooth
    // 240 m field gives the strata a regional dip that reaches about sixteen
    // degrees at its steepest and averages eight — enough that a riser crosses
    // contours obliquely and wanders hundreds of metres in altitude across a
    // frame, while still reading as level bedding rather than as noise. It costs
    // one value-noise tap inside a branch that was already taken.
    float bedDatum = vWPos.y + (tVal(vWPos.xz * (1.0 / 240.0) + 8.1) - 0.5) * 46.0;
    float bedPh = bedDatum / bedLam + 0.55 * tVal(vWPos.xz * (1.0 / 17.0) + 3.9);
    float bc = bedPh * 6.2831853;
    float ledge = 0.78 * sin(bc) + 0.22 * sin(bc * 2.0);
    // d(offset)/d(worldY), times the bed amplitude.
    float dLedge = (0.78 * cos(bc) + 0.44 * cos(bc * 2.0)) * (6.2831853 * 0.30 / bedLam);
    // Steepest-ascent direction in the tangent plane. Its y component is
    // sin(slope angle), which is exactly the chain-rule factor taking a
    // world-vertical derivative onto the surface, so it belongs in the term.
    vec3 dip = normalize(vec3(-N.x * N.y, 1.0 - N.y * N.y, -N.z * N.y) + vec3(1e-6));
    accN -= dip * (dLedge * dip.y * strataK);
    accAO *= 1.0 - 0.24 * strataK * clamp(0.5 - 0.5 * ledge, 0.0, 1.0);
    accA *= mix(vec3(1.0), vec3(1.0) + chromaTrim(vec3(0.24, 0.22, 0.19), TQ_CHROMA) * ledge, strataK * 0.75);
  }
#endif

  // -------------------------------------------------------- columnar jointing
  //
  // Basalt cools into vertical polygonal columns, and their absence is what the
  // review kept reporting as "soft rounded pillow terrain with no rock character
  // at all", "a 1990s fractal-terrain toy render", "no basalt, no columnar
  // jointing, no strata". No isotropic noise band can supply it however much
  // amplitude it is given, for the same reason no isotropic band can supply
  // bedding: jointing is not isotropic. It is a *plan-view* cell structure
  // extruded vertically — the cooling front propagates down from the surface, so
  // the cell walls are lines in world XZ and the columns are prisms — and it can
  // therefore only be built in XZ and applied to the faces steep enough to
  // expose a column side.
  //
  // Two rotated ridged value fields multiplied: each one puts a crest line along
  // every zero contour of its own noise, and the product survives only where the
  // two crest networks cross, which is a sparse polygonal cell wall rather than a
  // uniform lace. tValD returns the analytic gradient with the value, so the
  // groove's normal costs no extra taps.
  //
  // The perturbation is a world-XZ vector projected into the tangent plane, NOT
  // a tangent-space normal: the joint is vertical in the world, so its direction
  // must not rotate with the triplanar frame or the columns lean as the face
  // turns. Gated on slope (above ~35 degrees), on the rock/basalt splat weights
  // so an ash flat cannot sprout columns, and on the pixel footprint so a 1.6 m
  // cell that has stopped covering five pixels simply is not evaluated.
#if TQ_COLUMNAR
  float colLam = 1.7;
  float colK = ss(0.24, 0.44, slope) *
               (0.15 + 0.85 * clamp(w[2] + w[3], 0.0, 1.0)) *
               ss(7.0, 20.0, colLam / fpH);
  if (colK > 0.01) {
    // Seven to twenty pixels per cell, and the two frequencies at an
    // incommensurate ratio, for the same reason the bedding band above needs
    // both: this is a sharpened (squared) ridged product, so its walls are
    // narrow and high-contrast, and two narrow periodics evaluated near Nyquist
    // beat into a regular diagonal weave rather than into rock.
    vec3 c1 = tValD(vWPos.xz * (1.0 / colLam) + 5.1);
    vec3 c2 = tValD(TROT * vWPos.xz * (1.0 / (colLam * 1.63)) - 17.4);
    // Ridged fold, with its derivative: r = 1 - |2v - 1|, dr = -sign(2v-1)*2*dv.
    float s1 = c1.x * 2.0 - 1.0;
    float s2 = c2.x * 2.0 - 1.0;
    float r1 = 1.0 - abs(s1);
    float r2 = 1.0 - abs(s2);
    vec2 gr1 = -sign(s1) * 2.0 * c1.yz;
    vec2 gr2 = (-sign(s2) * 2.0 * c2.yz) * TROT;
    // Sharpened so the wall is a narrow groove between broad flat column faces
    // rather than a smooth undulation — a column is a facet, not a ripple.
    float jw = r1 * r2;
    vec2 gjw = gr1 * r2 + gr2 * r1;
    float joint = jw * jw;
    vec2 gj = 2.0 * jw * gjw;
    vec3 gw = vec3(gj.x, 0.0, gj.y) * (1.0 / colLam);
    gw -= N * dot(N, gw);
    accN -= gw * (0.62 * colK);
    // The groove holds shadow and the face does not: that contrast is what makes
    // the jointing read as geometry rather than as a painted pattern, and it is
    // the one cue that survives when the sun is behind the camera.
    accAO *= 1.0 - 0.46 * colK * joint;
    accA *= mix(vec3(1.0), chromaTrim(vec3(0.62, 0.64, 0.70), TQ_CHROMA), colK * joint * 0.85);
  }
#endif

  // ------------------------------------------------------------- rill band
  //
  // Erosion channels: the grooves that dry ravelling and ash-laden runoff cut
  // straight down the fall line of every slope on a volcanic cone.
  //
  // This is the largest single piece of missing surface information in the
  // midground, and no band above could have supplied it, for the same reason
  // none of them could supply bedding or columnar jointing: a rill is not
  // isotropic. It is periodic ACROSS the dip at a few metres and continuous
  // ALONG it for tens, so it exists only in a frame built from the surface's own
  // steepest-descent direction. Isotropic noise at the same wavelength reads as
  // gravel; the same field stretched along the fall line reads as a hillside,
  // and it is the cue that separates a rendered cone from a smooth dome at
  // every range from ten metres to most of a kilometre — which is precisely the
  // range the review kept calling "an airbrushed silhouette" and "a smooth
  // dome, no rock, no scree, no erosion channel".
  //
  // The frame is world-space. N is the heightfield's own analytic normal, so
  // the fall line at a given world point is the same vector whatever the camera
  // is doing: nothing here is parameterised in screen space and the field
  // cannot swim or crawl as the camera moves.
  //
  // uData's flow map already carries drainage, but "chan" below is gated on
  // 1 - ss(0.20, 0.48, slope) — trunk channels on near-flat ground only. Every
  // steep face in the world, which after the thermal pass is most of the world,
  // had no erosion signal on it at all.
  //
  // Cost is one gradient-noise evaluation — four hashes — inside a gate that is
  // false on flat ground, on ash, and wherever the spacing has stopped covering
  // five pixels. It is paid for by the wind-ripple reorder below.
#if TQ_RILL
  float rillLam = 3.4 * (0.62 + 0.85 * mB);
  // Patchy, on the 37 m and 311 m octaves: a slope is rilled in fans and
  // interfluves, not uniformly, and a periodic field that covers every steep
  // face at one density is corduroy.
  float rillK = ss(0.075, 0.225, slope) *
                (0.22 + 0.78 * clamp(w[1] + w[2] + w[3] + w[6], 0.0, 1.0)) *
                ss(5.0, 16.0, rillLam / fpH) *
                ss(0.26, 0.62, mC * 0.58 + mA * 0.42);
  if (rillK > 0.01) {
    // N.xz is -grad(h) for a heightfield normal, i.e. it points downhill.
    vec2 fall = N.xz;
    float fl = length(fall);
    fall = fl > 1e-4 ? fall / fl : vec2(1.0, 0.0);
    vec2 across = vec2(-fall.y, fall.x);
    // 5.6:1. Across the fall line the field has to resolve individual grooves;
    // along it they must run far enough to read as channels rather than as
    // stretched blobs. The along-slope coordinate carries world Y as well as
    // the horizontal run, so it approximates arc length down the face and a
    // groove does not stretch out as the slope steepens.
    vec2 rk = vec2(1.0 / rillLam, 1.0 / (rillLam * 5.6));
    vec2 rp = vec2(dot(vWPos.xz, across), dot(vWPos.xz, fall) - vWPos.y * 0.9) * rk;
    vec3 rz = tValD(rp + 37.9);
    // Ridged then squared: an incision with flat interfluves between it and the
    // next one, not a sinusoid. A rill is a notch.
    float sr = rz.x * 2.0 - 1.0;
    float inc = 1.0 - abs(sr);
    vec2 gInc = (-sign(sr) * 2.0) * rz.yz;
    float notch = inc * inc;
    vec2 gNo = 2.0 * inc * gInc;
    // Chain rule out of the (across, fall) frame into world XZ, then project
    // into the tangent plane. rk is already folded in, so the 0.075 * rillLam
    // depth below cancels it: amplitude over wavelength — the surface roughness
    // of the band — is the same whatever the local spacing turns out to be.
    vec2 gw2 = gNo.x * rk.x * across + gNo.y * rk.y * fall;
    vec3 gw3 = vec3(gw2.x, 0.0, gw2.y);
    gw3 -= N * dot(N, gw3);
    accN -= gw3 * (0.075 * rillLam * rillK);
    // The groove holds shadow and the interfluve does not. This is the term
    // that survives when the sun is behind the camera and the normal tilt
    // contributes nothing.
    accAO *= 1.0 - 0.44 * rillK * notch;
    // Pre-emphasised for the same reason the meso band is: a rill is a metres-
    // scale feature that stays several pixels wide out to most of a kilometre,
    // and it does not repeat, so it is one of the few things in this shader
    // that can still say something about a distant flank once the air has taken
    // nine tenths of the contrast out.
    vec3 rillMod = mix(vec3(1.0), chromaTrim(vec3(0.71, 0.72, 0.77), TQ_CHROMA), rillK * notch * 0.85);
    accA *= max(vec3(0.05), vec3(1.0) + (rillMod - vec3(1.0)) * farLift);
    // Fines wash into the channel and stay there; the interfluve between two
    // rills is scoured to bare rock. That is a roughness difference before it
    // is a colour one.
    rghK *= mix(1.0, 1.12, rillK * notch);
  }
#endif

  // ------------------------------------------------------------ grain band
  //
  // Ash grain at uDetailScale (0.28 m per tile), the layer that has to satisfy
  // rule 7 on its own. Three changes from the version the review shot.
  //
  // 1. It reads the ARM map's displacement channel, not the albedo's luminance.
  //    The albedo array is sRGB and hardware-decoded, so its luminance sits near
  //    0.17 linear for ash; lum * 2.1 therefore averaged 0.36, and mixing 40%
  //    of that into the albedo was a flat 26% darkening of every surface inside
  //    64 m dressed up as detail. The displacement channel is a normalised field
  //    with a mean near 0.45 by construction, so 0.70 + 0.66*h is mean-preserving
  //    and the same fetch also carries the cavity AO. Same tap count, no
  //    exposure shift, and the contrast is now free to be much higher.
  // 2. It is blended between the top two splat layers rather than picking one
  //    with a screen-space stipple.
  // 3. It runs to 45 m rather than 64 m but starts fading 8 m later, because the
  //    tile is now half the size.
  // 20-58 m rather than 16-45. The tile is 0.28 m, so its own texel is half a
  // millimetre and its features are 1-4 cm; with the mip now chosen off the
  // anisotropic footprint rather than the major axis (see fp) those features are
  // resolved a good deal further out than they were, and ending the band at the
  // old range threw that reach away. Not extended further than this on purpose:
  // every metre of it is two to six array fetches over a growing share of the
  // frame, and past sixty metres the far band — which is one fetch — has ramped
  // in and is carrying the surface anyway.
  // Gated on PROJECTED TEXEL DENSITY, not on world distance, and that swap is
  // the fix for the whole "flat untextured surface at the near plane" family.
  //
  // Every detail band in this shader used to be switched on a vCamDist ramp,
  // which is a statement about world distance and not about anything the image
  // can see. A ridge that is two hundred metres away in world units but fills the
  // bottom quarter of the frame therefore fell outside every one of those rings
  // and was drawn with the far band alone — the review measured exactly that
  // ("std 3.52, only 21 distinct code values over 40k pixels", "the closest
  // surface in the shot and it reads as black construction paper"), and the
  // diagnosis it offered is the right one. Conversely a metre of ground under
  // the camera's feet, seen at a grazing angle, was inside the ring and paying
  // for a band whose 0.28 m tile the footprint could not resolve.
  //
  // fp is the anisotropic pixel footprint in metres, so (tile / fp) is how many
  // pixels one tile of this band covers on screen. Gating on that is the
  // statement the band actually wants to make: exist wherever you are resolvable,
  // and nowhere else. It is also strictly cheaper on grazing ground — where fp
  // grows fastest — which is what pays for the reach it gains on near-vertical
  // faces.
#if TQ_GRAIN
  float dfade = ss(1.7, 5.2, (1.0 / uDetailScale) / fp);
  if (dfade > 0.005) {
    // Offset the detail lattice off the mid one so the two never beat together,
    // and carry it through the same per-cell stochastic frame as the mid band —
    // otherwise the grain is the one layer still printing a fixed lattice, and
    // it is the layer closest to the camera.
    vec2 duv = domUV * uDetailScale + macroW * 3.1;
    // textureGrad through limitAniso, not textureLod off a single scalar, and
    // this is one half of the fix for the whole moire family.
    //
    // The history here is a two-sided mistake and both sides are worth stating.
    // The band was first fetched anisotropically at 16 taps, which streaked: past
    // the tap budget the hardware line-integrates a blurred disc along the major
    // axis, and on ground that axis points at the vanishing point, so every
    // feature came back as a filament — the "brushed metal" finding. It was then
    // switched to an isotropic textureLod, first off the major axis (which
    // over-blurs by up to 2.45x and gave "no grain, no pebbles") and then off the
    // anisotropic mean fp (which UNDER-filters by the same factor). An isotropic
    // fetch filtered to the geometric mean of an ellipse that is 30:1 is not
    // filtered at all along its long axis: what it returns is a point sample of a
    // repeating texture, and a point sample of a repeating texture on a receding
    // ground plane is a moire pattern. That is measurable — TQ_DBG 9 on the coast
    // vantage puts dozens of nested rings straight into the cavity channel, and
    // TQ_DBG 8 shows the splat underneath it is clean — and it is the same
    // mechanism as the orthogonal plaid on the redmtn slope and the diagonal comb
    // in dusk. Nothing about it is a texture repeat being legible; it is a beat
    // between the texel grid and the pixel grid.
    //
    // There is no scalar mip level that is both alias-free and sharp on a 30:1
    // footprint, because the correct filter is not isotropic. limitAniso already
    // knows this: under the budget it hands the hardware a genuine anisotropic
    // ellipse, and past the budget it lengthens the MINOR axis up to the major so
    // the fetch degenerates into the honest isotropic blur rather than into a
    // brush. So the streak the isotropic detour was avoiding is bounded by
    // construction, the alias is gone because the fetch now covers its footprint,
    // and the sharpness inside the budget is real.
    //
    // The budget is deliberately small (TQ_MODAN, 4 at the shipping tier against
    // 10 for the base splat): this is a modulator on top of a surface that has
    // already been sampled properly, so it needs to be alias-free far more than
    // it needs to be sharp, and four taps is where the ramp in limitAniso takes
    // over on grazing ground anyway.
    vec2 gdu = domDX * uDetailScale;
    vec2 gdv = domDY * uDetailScale;
    limitAniso(gdu, gdv, TQ_MODAN);
    vec2 gduA = dtRA * gdu;
    vec2 gdvA = dtRA * gdv;
    vec2 uA = dtRA * duv + dtOA;
    vec4 dM = textureGrad(uArmArr, vec3(uA, float(layA)), gduA, gdvA);
    vec3 dN = textureGrad(uNrmArr, vec3(uA, float(layA)), gduA, gdvA).xyz * 2.0 - 1.0;
    dN.xy = dN.xy * dtRA;
    if (layMix) {
      vec4 dM2 = textureGrad(uArmArr, vec3(uA, float(layB)), gduA, gdvA);
      vec3 dN2 = textureGrad(uNrmArr, vec3(uA, float(layB)), gduA, gdvA).xyz * 2.0 - 1.0;
      dN2.xy = dN2.xy * dtRA;
      dM = mix(dM, dM2, layT);
      dN = mix(dN, dN2, layT);
    }
    if (dtW > 0.02) {
      vec2 uB = dtRB * duv + dtOB;
      vec2 gduB = dtRB * gdu;
      vec2 gdvB = dtRB * gdv;
      vec4 dMb = textureGrad(uArmArr, vec3(uB, float(layA)), gduB, gdvB);
      vec3 dNb = textureGrad(uNrmArr, vec3(uB, float(layA)), gduB, gdvB).xyz * 2.0 - 1.0;
      dNb.xy = dNb.xy * dtRB;
      dM = mix(dM, dMb, dtW);
      dN = mix(dN, dNb, dtW);
    }
    // Mean-preserving still: the displacement channel is a normalised field with
    // a mean near 0.45 by construction, so 0.66 + 0.74 h averages 1.00. The
    // contrast is what changes — this is the band that owns 16-45 m, and after
    // it fades there is nothing until the far band takes over at 30-110 m.
    //
    // The contrast here is deliberately NOT raised, and that is a measured
    // decision rather than an oversight.
    //
    // Every other band in this shader took more contrast in this pass, because
    // the review's verdict on the ground was that it is a matte plane. This one
    // was tried at 0.86 over 0.70 and then at 0.74 over 0.66, and both printed a
    // fine regular diagonal cross-hatch across the 13-30 m band: the 2x2
    // checkerboard response (energy at the pixel lattice itself) went from 1.0
    // levels to 2.9 while the six-pixel shading response only went from 1.8 to
    // 3.4, so the gain was landing on the screen grid rather than on the
    // surface.
    //
    // The reason is that everything selecting this band's fetch is derived from
    // dFdx/dFdy — the isotropic mip below, and limitAniso's hard branch upstream
    // — and screen derivatives are constant per 2x2 fragment quad. The fetch
    // result therefore already carries a small quad-granular component, and this
    // band sits at 13-30 m of grazing ground where the mip it lands in is close
    // to its own mean, so the surface signal it is supposed to be amplifying is
    // the smallest part of what it returns. Turning the gain up amplifies the
    // lattice faster than the material. The near field's contrast comes from the
    // grit band instead, which is evaluated analytically and has no fetch to
    // inherit a quad from.
    // Written about the channel's own centre now, not as an affine guess at it.
    //
    // SurfaceArray conditions the ARM channels at bake time: displacement is
    // centred on 0.5 for every layer with a spread of 0.17, cavity on 0.88 with
    // a spread of 0.13 (see the long note there for the measured before-state,
    // which was a spread of 0.078 and 0.059 respectively, and a per-layer
    // displacement mean wandering between 0.285 and 0.851). Two consequences.
    //
    // These terms are now mean-preserving BY CONSTRUCTION rather than by
    // arithmetic that happened to be tuned against a mean nobody had measured —
    // "0.70 + 0.66 * h" sat at 0.93 on ash, i.e. it was a silent 7% darkening of
    // every surface inside the band's range dressed up as detail.
    //
    // And the gain can be stated as what it is. 0.72 against a 0.17 spread is a
    // +/-12% swing at one sigma, against +/-5% before. Deliberately less than
    // the far band takes: this band's fetch is selected by an isotropic mip
    // computed from dFdx/dFdy, which is constant per 2x2 fragment quad, so a
    // share of what it returns is quad-granular and gain applies to that share
    // too. The measured symptom of pushing it is a fine diagonal cross-hatch at
    // 13-30 m. The near field's contrast comes from the crust and grit bands
    // instead, which are analytic and have no fetch to inherit a quad from.
    //
    // Raised to 1.20 / 2.00 / 1.20, and the paragraph above is why it is safe to
    // raise it NOW and was not before. Two of the three things it blames were
    // real and are gone. "The isotropic mip below" no longer exists — the fetch
    // is a textureGrad through limitAniso and has been for a while — and
    // limitAniso's own branch no longer ramps, so the quad-granular component it
    // could inherit is a step in tap COUNT rather than a step in mip level. The
    // third, the mid band having "mipped close to its own mean" at 13-30 m of
    // grazing ground, was mostly the scale jitter shearing that band's mapping
    // ten to one and the old ramp then blurring the result into a circle; both
    // are gone, so what this band is amplifying is now a surface and not a
    // filter residue.
    //
    // The near plane is the surface rule 7 is written about and the panel's
    // verdict on it was "an undifferentiated dark mottle with no material read
    // at all". 1.20 against the conditioned 0.17 spread is a +/-20% albedo swing
    // at one sigma and +/-40% at two — the distance between wind-scoured crust
    // and the drift banked against it, which is what the palette's ash range is
    // describing. The cavity term at 2.00 against a 0.13 spread is +/-26%, and
    // cavity is the half of this that survives being in shadow, where the panel
    // took its darkest samples: a normal tilt renders as nothing at all with no
    // sun on it, while an occlusion term still modulates the ambient.
    accA *= mix(vec3(1.0), vec3(1.0 + 1.20 * (dM.a - 0.5)), dfade * 0.72);
    accAO *= mix(1.0, 1.0 + 2.00 * (dM.r - 0.88), dfade * 0.72);
    accN += (domT * dN.x + domB * dN.y) * dfade * 1.20;
  }

#endif

  // ------------------------------------------------------------- grit band
  //
  // Below the grain tile there is nothing left in a texture that a screen pixel
  // can resolve, and this is the band the review called out by name: "no grain,
  // no pebbles, no debris, no parallax", "the most-magnified surface in frame
  // and it is mush". Two analytic octaves at 22 cm and 9 cm, each gated on the
  // *pixel footprint* exactly like the meso band, so an octave exists only where
  // it covers six pixels or more and simply is not evaluated anywhere else. At
  // 1.8 m eye height that is the first three to six metres of ground — which is
  // precisely the band rule 7 is about — and it costs eight hashes there and
  // nothing at all past it.
  //
  // Relief, cavity and albedo together: a normal tilt alone reads as a sheen
  // and disappears the moment the sun is behind the camera, so the same field
  // darkens the pits and lightens the crests where the dust has been blown off.
  // The gate is 4-9 pixels per cycle, tighter than the meso band's 2.5-6. Two
  // and a half samples per cycle is barely over Nyquist, which is survivable for
  // a 20 m octave whose contrast is low and whose neighbours average it out, and
  // is not survivable for a 9 cm one at full contrast on the surface nearest the
  // camera: it prints a fine regular weave, which is the same class of defect as
  // the dither this pass exists to remove.
  // The per-octave gate is 4-22 pixels per cycle, not 4-9, and the width is the
  // point rather than the endpoints.
  //
  // fp comes out of dFdx/dFdy, and screen derivatives are computed per 2x2
  // fragment quad: fp is a step function on the quad lattice, constant inside a
  // quad and discontinuous between them. Any term that is *steeply* dependent on
  // it therefore inherits that lattice — a 2 px blocky field, which is precisely
  // the diagonal cross-hatch measured here after the amplitudes below were
  // raised. The energy at the 2x2 checkerboard in the 45-70 luminance band, over
  // the 117k pixels that band covers in the dawn frame, went from 1.0 levels to
  // 3.5 while the six-pixel shading response only moved from 1.8 to 3.9. A
  // narrow gate is what turns quad-granular fp into quad-granular output; the
  // amplitude rise only made an existing sensitivity visible.
  //
  // Widening the smoothstep by a factor of four divides its slope by four, so
  // the difference in gate value between two neighbouring quads is a quarter of
  // what it was and the lattice goes back under the noise floor. It also means
  // the band does not reach full amplitude until twenty-two pixels per cycle,
  // which is generous Nyquist headroom for a full-contrast 9 cm field on the
  // surface nearest the camera — and it still starts at four, so the band's
  // reach is unchanged.
  //
  // Amplitudes raised across the board — relief 0.030/0.019 to 0.046/0.029,
  // cavity 0.30 to 0.42, albedo 0.42 to 0.68 — and the albedo term is no longer
  // achromatic. Ground inside ten metres is the most magnified surface in any
  // frame and the review's verdict on it was "mush" and "no grain, no pebbles,
  // no debris"; a normal perturbation of 0.03 tilts the surface by under two
  // degrees, which is invisible whenever the sun is not grazing and is exactly
  // nothing when it is behind the camera. Pits also cool as they darken and
  // crests warm as they catch dust, so the term carries a little hue rather than
  // only a level — the same argument as the macro band, three decades down.
  //
  // Gated on anF and evaluated through tValD3, and that pair is the fix for
  // "the ground within ten metres has no micro-structure at all". Against fpH
  // and a point sample this band reached about five metres of grazing ground and
  // then switched itself off; three taps along the footprint's major axis is a
  // real filter over the direction that was folding, so the same alias margin
  // now buys three times the reach — the whole near plane rather than the strip
  // under the camera's feet. Cost is two extra tValD evaluations, eight hashes,
  // over a band that is still zero everywhere past about twenty metres of
  // grazing ground and past a couple of hundred on a face turned toward the
  // lens. Nothing about the amplitudes changes; the band simply exists where it
  // was always meant to.
  float gritA = ss(4.0, 22.0, 0.24 / anF);
  if (gritA > 0.004) {
    vec3 g1 = tValD3(domUV * (1.0 / 0.24) + 13.1, anStep * (1.0 / 0.24));
    vec2 gG = g1.yz * (0.062 * gritA);
    float gShape = (g1.x - 0.5) * gritA;
#if TQ_GRIT2
    float gritB = ss(4.0, 22.0, 0.095 / anF);
    if (gritB > 0.004) {
      vec3 g2 = tValD3(TROT * domUV * (1.0 / 0.095) - 7.7, (TROT * anStep) * (1.0 / 0.095));
      gG += (g2.yz * TROT) * (0.029 * gritB);
      gShape += (g2.x - 0.5) * 0.55 * gritB;
    }
#endif
    accN -= (domT * gG.x + domB * gG.y);
    // Amplitudes up a third — relief 0.046 to 0.062, cavity 0.42 to 0.56, albedo
    // 0.74 to 1.02 — on the same argument the grain band above takes, and with
    // the same new licence: the band is now filtered along the axis that was
    // folding, so the ceiling on its contrast is no longer set by what a point
    // sample can get away with. 1.02 against the field's own 0.225 sigma is a
    // +/-23% albedo swing, which is grit sitting in ash rather than a sheen on
    // it, and the cavity term carries the same information into shadow where the
    // relief term carries none.
    accAO *= 1.0 - 0.56 * gritA * clamp(0.5 - gShape, 0.0, 1.0);
    accA *= mix(vec3(1.0), vec3(1.0) + chromaTrim(vec3(1.02, 0.94, 0.80), TQ_CHROMA) * gShape, gritA);
    // A crest has had its fines blown off and is rock; a pit is full of them.
    // gShape is centred on zero, so this is a spread and not a shift.
    rghK *= 1.0 - 0.30 * gritA * gShape;
  }

  // ------------------------------------------------------------ debris band
  //
  // Pebbles and ash clinker inside sixteen metres.
  //
  // Rule 7 names three things the near plane must hold — parallax, grain,
  // debris — and the first two are covered (the POM march and the grit band).
  // Debris was simply absent, which is why four separate shots reported "no
  // pebbles, no debris" in identical words on the bottom-left quadrant. It
  // cannot come from scattered instances: the density needed to read at two
  // metres is thousands per screen and that belongs to no propagation budget
  // anyone has, so the ground material has to carry its own.
  //
  // A sparse mask over a 0.55 m value field, raised into domes through the
  // mask's own analytic gradient, with a contact-darkening ring where each dome
  // meets the ground — which is rule 1 applied at pebble scale, and it is what
  // makes them sit *in* the ash rather than float on it. Gated on the footprint
  // exactly like every other analytic band, so an octave that stops covering a
  // dozen pixels stops being evaluated instead of folding into moire, and gated
  // on the loose-ground layers so a basalt cliff face does not sprout gravel.
  //
  // Eight hashes inside sixteen metres and nothing at all past it.
  // Footprint only — the world-distance ring is gone, for the reason given on
  // the grain band. A 0.55 m pebble field is worth drawing wherever 0.55 m still
  // covers three pixels, which on a face turned toward the camera is a great deal
  // further out than sixteen metres and on grazing ground is a great deal nearer.
  //
  // Filtered along the footprint's major axis and gated on anF, same as the
  // grit band and for the same reason. The pebble field is a THRESHOLD on a
  // value noise, so it is the band that folds worst of the three when it is
  // point-sampled past its limit, and it was the one whose gate closed first:
  // a 55 cm field wants fourteen pixels per cycle and got four by ten metres of
  // grazing ground. Two extra evaluations, and rule 7's third named item is
  // present over the whole near plane rather than a strip of it.
#if TQ_DEBRIS
  float debK = ss(4.0, 14.0, 0.55 / anF) *
               (0.30 + 0.70 * clamp(w[0] + w[1] + w[2], 0.0, 1.0));
  if (debK > 0.01) {
    vec3 pb = tValD3(domUV * (1.0 / 0.55) + 91.7, anStep * (1.0 / 0.55));
    // ~16% coverage. Sparser than this and the band is invisible; denser and it
    // is a gravel path rather than an ash plain with stones in it.
    float dome = ss(0.60, 0.84, pb.x);
    float ring = ss(0.46, 0.60, pb.x) * (1.0 - dome);
    accN -= (domT * pb.y + domB * pb.z) * (dome * 0.40 * debK);
    // The contact ring is the term that makes a stone sit IN the ash instead of
    // on it (rule 1 at pebble scale) and it is also the one that survives the
    // sun being anywhere at all, so it takes the larger share of the raise.
    accAO *= 1.0 - 0.70 * ring * debK;
    accA *= mix(vec3(1.0), chromaTrim(vec3(0.74, 0.73, 0.76), TQ_CHROMA), dome * debK * 0.70);
    // A stone is rained-on rock and takes a lobe; the ash matrix around it does
    // not. Sixteen per cent coverage, so this is a local contrast and not a
    // change to the scene's specular level.
    rghK *= mix(1.0, 0.84, dome * debK);
  }
#endif

  // ------------------------------------------------------------- crust band
  //
  // Cracked ash crust. An ash pan that has been rained on and dried is not a
  // powder surface — it is a welded crust that contracts and splits, and the
  // split network is the strongest close-range "this is ground, not clay" cue
  // there is, because it is the one feature on a flat that has an EDGE. Every
  // other band on flat ground here (ripple, grit, debris, macro drift) is a
  // smooth field, and a sum of smooth fields is a smooth field: the review's
  // "matte plane", "mush", "nothing is textured" is what that sums to however
  // many octaves go into it.
  //
  // A single ridged value field, sharpened to the eighth power, puts a narrow
  // connected line along every zero contour of its own noise — a meandering
  // crack network with broad plate between. Sharpening by repeated squaring
  // rather than pow(): three multiplies against a transcendental, and the
  // analytic gradient comes through the chain rule for free.
  //
  // World-space in domUV, warped by the same 87 m macro field the mid band uses
  // so the network does not read as one repeating cell size. Gated on flatness,
  // on the loose-material layers, on a 113/311 m patch mask so there are
  // uncracked pans between the cracked ones, and on the footprint at 7-24 px per
  // cell — a crack is a thin high-contrast line and it has to be given real
  // Nyquist headroom or it stipples.
#if TQ_CRUST
  // Three gate changes, all so the network actually appears on the surface the
  // panel was looking at rather than only on a mathematically flat pan.
  //
  // Flatness 0.055-0.185 to 0.075-0.260. A slope of 0.185 is a 35-degree face,
  // which sounds generous until it is read the other way: the term is already
  // half gone by 0.12, i.e. by 28 degrees, and ash pans in this world are dunes
  // with a metre or two of relief on them, not billiard tables. A dried crust
  // forms on anything that holds standing water long enough to weld, which
  // includes the whole windward back of a drift. Steep faces still get none.
  //
  // The patch mask keeps its shape but starts earlier: 0.30-0.60 on a field with
  // a mean of 0.5 and a sigma near 0.13 puts the onset at 1.5 sigma, so a third
  // of the ground reached it. There are still uncracked pans between the cracked
  // ones — that is the point of the mask and it stays — but the cracked ones now
  // outnumber them, which is the right way round for an ash flat.
  //
  // The FOOTPRINT gate is deliberately untouched and stays on fpH. Everything
  // else in the near field moved to anF and a three-tap filter; this band cannot,
  // because the eighth-power sharpening happens AFTER the field is sampled, so
  // filtering the base field band-limits the wrong signal — the crack is an
  // eighth-power feature of a smooth noise and it is many times higher in
  // frequency than the noise is. A stippled crack network is a worse defect than
  // a missing one, and 7-24 px per cell is the headroom it needs.
  float crustLam = 1.15 * (0.72 + 0.60 * mC);
  float crustK = (1.0 - ss(0.075, 0.260, slope)) *
                 (0.20 + 0.80 * clamp(w[0] + w[1] + w[6], 0.0, 1.0)) *
                 ss(7.0, 24.0, crustLam / fpH) *
                 ss(0.22, 0.52, mB * 0.55 + mA * 0.45);
  if (crustK > 0.01) {
    vec3 kz = tValD(domUV * (1.0 / crustLam) + macroW * 0.9 + 23.7);
    float sk = kz.x * 2.0 - 1.0;
    float kr = 1.0 - abs(sk);
    vec2 gkr = (-sign(sk) * 2.0) * kz.yz * (1.0 / crustLam);
    float k2 = kr * kr;
    float k4 = k2 * k2;
    float crack = k4 * k4;
    vec2 gcr = (8.0 * k4 * k2 * kr) * gkr;
    vec3 gcw = domT * gcr.x + domB * gcr.y;
    // 4 cm of relief on a 1.15 m plate. A crack is shallow; what makes it read
    // is that it is dark and narrow, not that it is deep.
    accN -= gcw * (0.040 * crustK);
    accAO *= 1.0 - 0.62 * crustK * crack;
    accA *= mix(vec3(1.0), chromaTrim(vec3(0.58, 0.58, 0.62), TQ_CHROMA), crustK * crack * 0.9);
    // The plate is wind-polished and takes a lobe; the crack is packed with
    // rock flour and takes none.
    rghK *= mix(1.0, 1.22, crustK * crack);
    rghK *= mix(1.0, 0.94, crustK * (1.0 - crack));
  }
#endif

  // ------------------------------------------------------------ wind ripple
  //
  // Rule 7: ground inside 5 m has to hold up. On ash flats it did not — the near
  // field measured a p99 horizontal gradient of 7 levels out of 255 because the
  // meso band is slope-gated and a flat is, by definition, not steep. What flat
  // ash actually carries is wind ripple, and ripple is anisotropic by
  // construction: the crests run across the prevailing wind, so a stretched
  // noise is the physically right primitive rather than an isotropic one. 0.7 m
  // across the crests, 4.2 m along them, on the same bearing as the ash-storm.
  // Patchy, not global: a ripple field that covers every flat surface in the
  // world at one bearing and one amplitude is a wallpaper, and at grazing view
  // it is the wallpaper the review read as "brushed metal / wood grain
  // striations". Real ripple lies in fields with bare scoured ground between
  // them. The 63 m mask is what puts those gaps in.
  //
  // The 63 m patch mask is evaluated AFTER the footprint gate rather than
  // before it, and that reordering is what pays for the rill band above. It is
  // a value-noise tap — four hashes — and the gate that follows it is zero over
  // every pixel past about forty metres of grazing ground, which is most of the
  // screen in every landscape vantage. Four hashes to scale a term that is
  // already known to be zero is the same waste the meso band's fade was moved
  // for.
#if TQ_RIPPLE
  float ripK = (1.0 - ss(0.09, 0.30, slope)) * (0.30 + 0.70 * clamp(w[0] + w[1], 0.0, 1.0));
  // Footprint, not distance: 0.7 m across the crests is worth drawing for as long
  // as 0.7 m covers a couple of pixels. See the grain band.
  //
  // Against anF and through tValD3, unlike the crust band beside it. The
  // distinction is what the band DOES with the field it samples: ripple uses the
  // value and its gradient directly, so band-limiting the field band-limits the
  // output and a three-tap box along the major axis is a correct filter for it.
  // Slope gate opened from 0.07-0.22 to 0.09-0.30 for the same reason as the
  // crust band's: a drift is not a plane, and ripple lives on the back of one.
  ripK *= ss(3.0, 9.0, 0.7 / anF);
  if (ripK > 0.01) ripK *= ss(0.34, 0.66, tVal(vWPos.xz * (1.0 / 63.0) + 17.3));
  if (ripK > 0.01) {
    // The bearing is a FIELD, not a constant, and this is the fix for "combed
    // mud" / "brushed corduroy" / "one directionally-uniform ripple".
    //
    // The predecessor was a single fixed world rotation, so every flat surface in
    // the world carried its ripple crests at one bearing. That is a wallpaper by
    // construction: four separate shots measured it as "long, strictly parallel,
    // axis-aligned smears", "a uniform-direction streak pattern over every
    // terrain surface", "one directionally-uniform ripple that does not vary with
    // slope, curvature or distance". Widening the patch mask cannot help — it
    // only decides *where* the one bearing appears, not that there is only one.
    //
    // Aeolian ripple takes its bearing from the local flow, and the local flow
    // curls around every obstacle in the terrain. Rotating the frame by a smooth
    // 86 m field gives a full turn of bearing across a couple of dune widths, so
    // crest lines curve and neighbouring patches run at genuinely different
    // angles; there is no longer a direction for the eye to lock onto. One value
    // noise tap, inside a branch that was already taken.
    float rAng = 6.2831853 * tVal(vWPos.xz * (1.0 / 86.0) + 51.3);
    float rSin = sin(rAng);
    float rCos = cos(rAng);
    mat2 rm = mat2(rCos, -rSin, rSin, rCos);
    // 3.4:1, and the crest line meanders. A 6:1 stretch on straight
    // noise gives every crest a 4 m run at a fixed bearing, and a few hundred of
    // those seen end-on at 2 m eye height converge on the vanishing point as a
    // fan of hard filaments — which is exactly what the near plane measured.
    // Bending the along-crest coordinate by a 9 m field turns the fan into
    // barchan-like arcs that break up long before they can read as a comb.
    vec2 rs = vec2(1.55, 0.46);
    vec2 rq = rm * domUV;
    rq.y += 2.1 * (tVal(domUV * (1.0 / 9.0) + 3.3) - 0.5);
    vec3 rz = tValD3(rq * rs + 5.9, ((rm * anStep) * rs));
    // Chain rule back out of the stretch and the rotation, in that order, so the
    // perturbation lands in the projection frame the tangent basis expects.
    vec2 rg = (rz.yz * rs) * rm;
    accN -= (domT * rg.x + domB * rg.y) * (0.062 * ripK);
    accA *= mix(vec3(1.0), vec3(0.90 + 0.20 * rz.x), ripK * 0.62);
  }
#endif

  // -------------------------------------------------------------- far band
  //
  // See uFarScale. Same material set, read at 72 m per tile so its own texel
  // features land at 1-4 m of world and still subtend pixels at half a
  // kilometre, ramping in exactly as the 8 m mid band mips out. Three fetches in
  // the dominant projection only, and only past 45 m, so the near field — which
  // is already the expensive case — pays nothing.
  //
  // Albedo modulation comes off the ARM *displacement* channel rather than off
  // the albedo map's luminance, which is what lets it be mean-preserving without
  // a third fetch to find the mean. The height channel is a normalised [0,1]
  // field with a mean near 0.45 by construction, so 0.73 + 0.60 * h sits at 1.0
  // on average: it lightens crests and darkens pits, which is the correlation
  // the albedo map has anyway, and it cannot drag the far field's exposure off
  // the value the aerial-perspective pass is balanced against. Multiplying by a
  // raw luminance — which is what the 0.5 m grain band above does — costs a
  // third of the brightness of every surface it touches.
  // 30-110 m. Starting at 45 and not reaching full strength until 150 left the
  // 50-150 m band relying on a mid layer that is already mipping out there.
#if TQ_FAR
  float ffade = ss(30.0, 110.0, vCamDist);
  if (ffade > 0.005) {
    // textureGrad through limitAniso. See the long note on the grain band: an
    // isotropic fetch cannot cover a 30:1 footprint at any mip level, and this
    // band is where that failure is loudest, because it is the only thing
    // texturing the ground past a hundred metres and it therefore owns most of
    // the pixels in a landscape frame. Rendering the cavity channel alone
    // (TQ_DBG 9) on the coast vantage draws the nested rings the review found in
    // the shaded image, at the same radii, over ground whose splat albedo
    // (TQ_DBG 8) and shading normal (TQ_DBG 3) are both clean — the rings are
    // this fetch beating against the pixel grid and nothing else.
    vec2 fdu = domDX * uFarScale;
    vec2 fdv = domDY * uFarScale;
    limitAniso(fdu, fdv, TQ_MODAN);
    vec2 fduA = dtRA * fdu;
    vec2 fdvA = dtRA * fdv;
    vec2 fscl = domUV * uFarScale;
    vec2 fuv = dtRA * fscl + dtOA;
    vec4 fArm = textureGrad(uArmArr, vec3(fuv, float(layA)), fduA, fdvA);
    vec3 fN = textureGrad(uNrmArr, vec3(fuv, float(layA)), fduA, fdvA).xyz * 2.0 - 1.0;
    if (layMix) {
      vec4 fArm2 = textureGrad(uArmArr, vec3(fuv, float(layB)), fduA, fdvA);
      vec3 fN2 = textureGrad(uNrmArr, vec3(fuv, float(layB)), fduA, fdvA).xyz * 2.0 - 1.0;
      fArm = mix(fArm, fArm2, layT);
      fN = mix(fN, fN2, layT);
    }
    fN.xy = fN.xy * dtRA;
    // The runner-up cell, and this is the tap whose absence drew the facets.
    //
    // Every other band that reads through the stochastic frame — the mid splat,
    // the 0.28 m grain — cross-fades the two cells along the wall. This one did
    // not: it took cell A and nothing else, so the 0.80-1.25 albedo swing and
    // the whole tangent-normal perturbation changed *instantaneously* along the
    // Voronoi boundary. That is a hard-edged straight-line discontinuity in both
    // albedo and shading, laid down on a 23 m lattice, over exactly the range
    // (110 m and out) where this band is the only thing texturing the surface —
    // i.e. the entire mountain. It is the "cone is visibly composed of large flat
    // facets" defect, and it is a missing four lines rather than a tuning error.
    //
    // Cell B takes layA only, no layMix. layT is non-zero in a narrow band around
    // a splat contour and dtWF is non-zero in a narrow band around a cell wall;
    // the product is a set of short segments where the two happen to cross, and
    // spending two more fetches everywhere to be exact on it is not a trade worth
    // making.
    if (dtWF > 0.02) {
      vec2 fuvB = dtRB * fscl + dtOB;
      vec2 fduB = dtRB * fdu;
      vec2 fdvB = dtRB * fdv;
      vec4 fArmB = textureGrad(uArmArr, vec3(fuvB, float(layA)), fduB, fdvB);
      vec3 fNb = textureGrad(uNrmArr, vec3(fuvB, float(layA)), fduB, fdvB).xyz * 2.0 - 1.0;
      fNb.xy = fNb.xy * dtRB;
      fArm = mix(fArm, fArmB, dtWF);
      fN = mix(fN, fNb, dtWF);
    }
    // Contrast raised from 0.73 + 0.60 h to 0.66 + 0.74 h, and the AO with it.
    //
    // This band is the only thing carrying surface variation between roughly
    // 100 m and the far plane, and the ridge vantage measured a median
    // adjacent-pixel luminance gradient of 1.3 levels out of 255 across the
    // whole 400-1000 px span of the frame — a matte plane, in the review's
    // words. Aerial perspective at that range is most of the pixel, so an albedo
    // swing of +/-22% arrives as +/-6% of the final value; it has to leave here
    // wider than it needs to look on paper in order to survive the air.
    // Widened with range by farLift so it survives the air. See the note beside
    // farLift: the swing is unchanged inside 180 m and up to 2.6x at 1.5 km,
    // which is roughly the reciprocal of the transmittance out there, so the
    // *rendered* contrast of a distant flank comes out near the contrast of a
    // near one instead of at a tenth of it.
    // NOT lifted by farLift any more, and modulated by a non-tiling macro mask.
    //
    // This band is a 72 m TILE. Its own texel features are one to four metres,
    // which at a kilometre and a half is two to five pixels, and everything
    // inside one 23 m de-tiling cell shares that cell's rotation. Multiplying it
    // by the aerial pre-emphasis — up to 2.6x — turned a +/-27% modulation into a
    // +/-71% one and made the tile the single loudest signal on the mountain: the
    // review measured "pale comma-shaped dashes, all the same size, orientation
    // and value, on an obviously regular scatter grid", which is what a repeating
    // texture looks like once it is the dominant term. An anti-repetition system
    // cannot survive a 2.6x gain on the layer that repeats; the pre-emphasis has
    // to go on the terms that do NOT repeat, which is what scour and drift below
    // are, and they carry it.
    //
    // farDen is that second half. The layer's *density* now varies on the
    // 113/37 m macro octaves and on curvature, so it banks in the concave ground
    // and thins on the convex breaks instead of scattering at one uniform rate
    // over the whole flank — which is both what a scree or airfall deposit
    // actually does and what stops the field terminating along straight edges.
    float farDen = clamp(0.28 + 1.10 * (mC * 0.44 + mB * 0.34 + (0.5 - dCurv * 0.5) * 0.22), 0.22, 1.25);
    // About the conditioned channel's centre, and at nearly twice the gain.
    //
    // This band is the ONLY thing texturing the surface past a hundred metres,
    // and the arithmetic of what it was delivering is worth writing down because
    // it is the whole of "the near half is a completely untextured matte plane".
    // "0.66 + 0.74 * h" reads as a +/-27% swing and is not: the displacement
    // channel it multiplies had a measured standard deviation of 0.078 on ash
    // and 0.070 at the mip level this band is actually read from, so the swing
    // was +/-5%, of which the far-tile lift returned +/-8% at a kilometre, of
    // which a transmittance of order 0.1 delivered under one code value.
    //
    // With the channel conditioned to a 0.17 spread (SurfaceArray.equalise) a
    // gain of 0.62 is a +/-11% swing at one sigma — twice what the band had —
    // and it is centred, so it neither darkens nor brightens the surface it is
    // texturing.
    //
    // 0.62 and not more, and this was measured rather than chosen. At 1.05 the
    // vale vantage's mountain flank came back as camouflage: soft-edged blotches
    // six metres across, all the same size, over the whole cone. That is the
    // failure the previous author documented as "pale comma-shaped dashes on an
    // obviously regular scatter grid", and it is structural, not a tuning
    // accident — the thing this term modulates is a 72 m TILE, so every decibel
    // of gain on it is a decibel of gain on a repeat. The anti-repetition
    // machinery (per-cell rotation, reflection, scale) scrambles a repeat; it
    // cannot make one quiet.
    //
    // So the far field's contrast is split: this band takes the share that can
    // be spent without the tile becoming audible, and the rest goes to terms
    // that do not repeat at all — the meso band's albedo, the rill band, and the
    // macro scour/drift pair, all of which carry the full aerial pre-emphasis.
    vec3 fMod = mix(vec3(1.0), vec3(1.0 + 0.62 * (fArm.a - 0.5)), ffade * 0.62 * farDen);
    // A bounded lift, not farLift. The band still needs *some* pre-emphasis to
    // survive a transmittance of order 0.1 at a kilometre and a half, but 2.6x is
    // what made a 72 m tile the loudest thing on the mountain. 1.5x at the far
    // plane keeps a distant flank reading while leaving the tile well below the
    // non-repeating macro terms, which carry the full farLift.
    float farTileLift = 1.0 + 0.50 * ss(180.0, 1500.0, vCamDist);
    accA *= max(vec3(0.05), vec3(1.0) + (fMod - vec3(1.0)) * farTileLift);
    // Cavity, about the conditioned centre. The old form was worse than the
    // albedo one: the cavity channel's spread was 0.059 at mip 0 and 0.009 by
    // mip 4, so "0.55 + 0.52 * r" delivered half a per cent of occlusion over
    // exactly the range where relief has to be carried by shading alone. At a
    // 0.13 spread with a floor at 0.30 a crevice can go dark.
    accAO *= mix(1.0, 1.0 + 1.45 * (fArm.r - 0.88), ffade * 0.60 * farDen);
    accN += (domT * fN.x + domB * fN.y) * ffade * 0.85 * farDen;
  }

#endif

  // ------------------------------------------------------------ macro band
  //
  // Three incommensurate periods — 311 m, 113 m and 37 m — each on its own
  // orientation. The predecessor was one fBm at 200 m, and one frequency has one
  // autocorrelation peak: the review found the same elongated pale comma streak
  // at (110,375), (600,455), (1250,430) and (1660,450), same size, same bearing,
  // and read the midground as camouflage. The ratios here (2.752 and 3.054) are
  // not near-rationals, so the sum has no period short enough to find.
  //
  // Half the tone is not noise at all. Pale ash is *deposited*: it collects in
  // concavities and blows off convex breaks, and it lies where the thermal pass
  // actually put loose material. Driving the macro mask from curvature and the
  // deposition map as well as from noise is what makes the large-scale albedo
  // agree with the landform instead of floating over it as a blob — the "bright
  // ochre streak over geometry that has no ridge or gully under it" defect.
  //
  // Nothing here fades with distance, which is the point: it is the only term
  // that keeps a plain at 1.5 km from resolving to one flat value.
  //
  // mA, mB and mC are evaluated up beside the de-tiling block; mC's gradient is
  // needed there to bend the cell walls, and evaluating the field twice to get
  // the value and the gradient in two places would be four wasted hashes.
  float m1 = mA * 0.50 + mB * 0.32 + mC * 0.18;
  // The ferric mask reuses the 37 m octave rather than evaluating a fourth
  // field: it is a mask on a mask, nobody can tell which noise it came from,
  // and it is not worth four hashes a pixel.
  float m2 = mC;
  float geoTone = clamp(0.5 - 0.55 * dCurv + 0.34 * (dLoose - 0.5), 0.0, 1.0);
  float tone = clamp(m1 * 0.60 + geoTone * 0.40, 0.0, 1.0);
  // How much of this pixel is *deposit* — powder, drift and scree — rather than
  // bedrock. Everything from here to the end of the block is scaled by it, and
  // that single change is what stops the macro terms flattening the palette.
  //
  // Each of these terms is a large-scale multiplier applied to whatever material
  // happens to be underneath. Ash, cinder and scree genuinely do vary at this
  // scale: they are laid down by wind and water in drifts, they stain, they
  // bleach. A basalt face does none of that — it is the rock the drift is lying
  // on. Applying the same swing to both is what put "an ash flat and a basalt
  // cliff at the same value whenever the noise happens to run the other way", so
  // the previous fix was to pull the swing in to 1.6x, which cost the flats
  // their variation without buying the cliffs their identity. Gating on the
  // thermal deposition map instead lets the swing go *wider* than it ever was on
  // the material that should have it, and to nothing on the material that should
  // not.
  // Deposition channel plus the splat's own opinion. dLoose has a median of
  // 0.037 — it marks talus, and talus is only one of the two ways ash arrives —
  // so on its own it left the drift term at a third of strength across the ash
  // flats, which are the surfaces it exists to describe. The ash and cinder
  // weights are already in hand and cost nothing to read.
  float depo = clamp(0.22 + 0.60 * dLoose + 0.55 * clamp(w[0] + w[1], 0.0, 1.0), 0.0, 1.0);
  // Ash over black rock, which is the sentence the whole landscape has to say.
  //
  // The predecessor here was one multiplier, mix(0.77..1.24, tone) — a pure
  // brightness swing on whatever material happened to be underneath. A shared
  // brightness swing cannot introduce hue; it can only take two materials that
  // already differ and, half the time, put them at the same value. That is
  // literally the mechanism behind "single-hue rose-brown mud bath": every
  // large-scale term in this shader was value-only, so a plain could be light or
  // dark ochre and nothing else.
  //
  // Vvardenfell's ashlands are not one powder. They are pale wind-graded fines
  // banked in the hollows, with dark scoria and clinker scoured bare on the
  // breaks between them, in patches tens to hundreds of metres across. So the
  // macro term becomes a *two-ended* ramp on the same tone field: cool near-black
  // cinder at the low end, pale warm drift at the high end, and the material's
  // own colour untouched through the middle. Both ends are on the palette —
  // (0.38,0.42,0.52) is Basalt, (1.34,1.24,1.06) is Ash — so the landscape reads
  // as ash lying over black volcanic rock rather than as one hue at two values.
  //
  // The thresholds are set against the *measured* distribution of tone, not by
  // eye: m1 is a weighted sum of three value-noise octaves, so tone has a mean
  // near 0.5 and a standard deviation near 0.10. Bands at 0.34-0.50 and
  // 0.52-0.68 therefore each engage about a quarter of the surface and saturate
  // around 1.6 sigma. A threshold set at 0.88, as a first attempt here was,
  // sits at nearly four sigma and fires essentially nowhere — which is worth
  // stating because it is the difference between this reading as a landscape and
  // reading as nothing at all.
  //
  // Only the pale end is gated on deposition: drift lies where the thermal pass
  // put loose material, but bare scoured rock is bare everywhere, including on
  // the bedrock the drift is lying against.
  // The two ends run off different fields, and that is a scale argument.
  //
  // tone is dominated by its 311 m octave, so it is very nearly constant across
  // the ground a single frame can see — at the dawn vantage the near field spans
  // 7 to 150 m, which is under half a period. Driving both ends off it would
  // give a landscape that is uniformly one thing per viewpoint, i.e. exactly the
  // complaint. Drift keeps tone, because a drift *is* a hundreds-of-metres
  // feature and it should agree with the landform through geoTone. Scour moves
  // to the 37 m and 113 m octaves plus curvature, so bare cinder appears as
  // several patches within one view and sits on the convex breaks the wind
  // actually strips — which is both the correct place for it and the thing that
  // makes it read as geology rather than as a stain.
  // Thresholds unchanged. Widening these to buy back the contrast the far band
  // gave up was tried and reverted: neither term fades with distance, so a wider
  // band engages just as much of the ground five metres from the camera as it
  // does at a kilometre, and what that produced was a cool near-black mottle over
  // the whole near field — trading a tiling defect for a blotching one. The far
  // band keeps a bounded lift of its own instead; see there.
  float scour = ss(0.54, 0.34, mC * 0.52 + mB * 0.36 + (0.5 - dCurv * 0.5) * 0.12);
  float drift = ss(0.50, 0.70, tone);
  // Both ends carry the aerial pre-emphasis. These two are the only terms in the
  // shader whose features (37-311 m) are still tens of pixels wide at a
  // kilometre, so they are the only ones that can give a distant plain any read
  // at all — and at a tenth of transmittance they were arriving as three code
  // values. Lifted, they arrive as eight to ten, which is what separates "a
  // single interpolated wash the same hue as the fog" from ground.
  vec3 scourMod = mix(vec3(1.0), chromaTrim(vec3(0.34, 0.38, 0.49), TQ_CHROMA), scour * 0.72);
  vec3 driftMod = mix(vec3(1.0), chromaTrim(vec3(1.34, 1.24, 1.06), TQ_CHROMA), drift * depo);
  accA *= max(vec3(0.05), vec3(1.0) + (scourMod - vec3(1.0)) * farLift);
  accA *= max(vec3(0.05), vec3(1.0) + (driftMod - vec3(1.0)) * farLift);
  // Red Mountain's ferric wash — now on the deposits only, and stronger there.
  //
  // It was applied to every layer inside the volcano's 1290 m radius, which is
  // to say to the whole of the dawn, redmtn and ridge vantages, and it multiplied
  // all of them by the same (1.22, 0.88, 0.68). A shared warm multiplier cannot
  // separate two materials; it can only converge them, and converge them on
  // orange. This is oxidised iron in ash and scoria, so it belongs on loose
  // material and not on a fresh basalt glass face.
  //
  // It was then pushed to a real rust — (1.34, 0.84, 0.56), saturation 0.582 —
  // on the argument that this *adds* hue spread where the old shared multiplier
  // removed it. That was true and it was the wrong trade: hue spread bought by
  // leaving the palette is what the stage-6 panel read as the frame splitting
  // into scenes that do not belong together. It keeps its full VALUE swing and
  // 30% of its chroma, which puts it at 0.18 — an oxidised ash, on the bible,
  // and still visibly rust against the grey it sits on.
  accA *= mix(vec3(1.0), chromaTrim(vec3(1.34, 0.84, 0.56), TQ_CHROMA), dv * m2 * (0.18 + 0.82 * dLoose) * 0.60);

  // ------------------------------------------------- palette ceiling on albedo
  //
  // The last chroma this stage owns and the only one it cannot fix upstream.
  //
  // LAYER_TINT and the band trims above take out everything this shader adds,
  // but the ground still arrives carrying whatever the baked library sets put
  // in it, and not all of those are on the bible: sand's dark tone is 0.302 of
  // relative saturation and mud's three tones 0.267-0.275, against #8a7f72 at
  // 0.174 and #2a2622 at 0.190. Those maps belong to src/mat/Library.ts. This
  // is the terrain's own albedo, so it is the right place to hold the ceiling
  // no matter what is authored into a set — and it is a ceiling, not a grade:
  // anything already inside the palette passes through untouched.
  //
  // The thresholds are the BIBLE's own swatches converted to linear light,
  // which is the space accA lives in. #8a7f72 is 0.333 there, #4a423b 0.359 and
  // #2a2622 0.312 — the sRGB byte figures the review quotes (0.174-0.203) are
  // the same colours after the encode. So 0.34 is "already on the palette" and
  // nothing below it moves at all; above it the excess is compressed onto an
  // asymptote at 0.46, which is a soft knee rather than a clip because a hard
  // one puts a visible contour across a flank wherever the ground crosses it.
  //
  // Luminance is preserved exactly — the scale is applied to the deviation from
  // the pixel's own Rec.709 luminance — so value, relief, cavity and roughness
  // are untouched and the material separation this file spent rounds building
  // is not what is being spent here. Only hue magnitude is.
  //
  // Placed before the ember term, so the one thing the bible allows to be vivid
  // never meets the ceiling. Glow-moss is the other: the lichen set carries a
  // #5cd6c4 bioluminescent accent, so the ceiling relaxes where that layer owns
  // the pixel rather than dragging a light source back to a rock colour.
  {
    float aMx = max(accA.r, max(accA.g, accA.b));
    float aMn = min(accA.r, min(accA.g, accA.b));
    float aS = aMx > 1e-5 ? (aMx - aMn) / aMx : 0.0;
    if (aS > TQ_SAT_KNEE) {
      const float span = TQ_SAT_CEIL - TQ_SAT_KNEE;
      float sT = TQ_SAT_KNEE + span * (1.0 - exp(-(aS - TQ_SAT_KNEE) / span));
      float bio = clamp(w[5] * 1.4, 0.0, 1.0);
      float k = mix(sT / aS, 1.0, bio);
      float aY = dot(accA, vec3(0.2126, 0.7152, 0.0722));
      accA = max(vec3(0.0), vec3(aY) + (accA - vec3(aY)) * k);
    }
  }

  // Ember. The bible allows lava and bioluminescence to be the only saturated
  // things in the world, and the review found "no pixel of the Ember palette"
  // anywhere. The fissure network below is a fraction of a percent of screen
  // area by design, so on its own it can never carry that. Heat-stained crust
  // around a live vent can: the summit rock takes a genuine #c4551f cast over
  // tens of metres, which is both what a cooling flow field looks like and the
  // one place the palette's warmest entry is allowed to appear.
  float ember = clamp(w[7] * 1.6, 0.0, 1.0);
  accA *= mix(vec3(1.0), vec3(2.10, 0.78, 0.34), ember * 0.55);
  // Roughness, from the macro octave, from the bands' own rghK, and from where
  // the fines have collected.
  //
  // The last term is free and it is the one that reads: a hollow banks
  // wind-graded powder and a convex break is scoured to bare rock, so curvature
  // and the thermal deposition map together say how dusty a pixel is, and dust
  // is the roughest thing in the world while a chilled basalt face is the
  // smoothest. Both fields are already fetched. Centred so it is a spread and
  // not a shift: a mean-value pixel comes out at 1.0.
  // Both drivers are offset by their own measured centre — dCurv is signed and
  // sits at zero, dLoose has a median of 0.037 — so a typical pixel leaves this
  // at exactly 1.0 and the term is a spread rather than a global shift. It has
  // to be: the scene's specular level is not this file's to move.
  float dusty = clamp(0.5 - 0.45 * dCurv + 0.90 * (dLoose - 0.037), 0.0, 1.0);
  accR = clamp(accR * mix(0.84, 1.16, m1) * rghK * mix(0.82, 1.18, dusty), 0.05, 1.0);

  // Drainage has to read in the albedo, not only in the geometry. A gully 3 m
  // deep subtends under a pixel at 400 m, so unless the flow-accumulation buffer
  // darkens the channel the whole erosion pass is invisible at exactly the range
  // where a landscape shot lives. Flat channel floors only — a steep face is
  // shedding, not collecting.
  // The threshold was 0.28, which on a flow map built from 220k droplets is
  // *most of the map*: every trickle in the dendritic network cleared it, at the
  // same width (one to two 3.9 m texels) and with the same near-black albedo
  // multiplier. What the near field showed was therefore a uniform-frequency
  // maze of hard black worms running across flat ground, slopes and hollows
  // alike — the review's "single loudest thing in the near field", and it read
  // as ink because it was ink: a 0.60 albedo multiply with no cavity behind it.
  //
  // Three changes. The threshold moves up to the trunk channels only; the
  // darkening halves and is paired with a cavity term so it reads as depth
  // rather than as paint; and it is gated on the deposition map, so a channel
  // darkens where silt has actually collected in it instead of everywhere water
  // has ever run.
  // The threshold now slides with range, and it has to.
  //
  // uData carries a real mip chain as of this pass (see Terrain.init), which is
  // what stopped the splat boundaries aliasing — but a mip is an average, so a
  // trunk channel one or two texels wide no longer reaches 0.62 once the fetch
  // is reading from level three or four. Held at a constant the drainage network
  // would now vanish at precisely the range a landscape shot lives at, which is
  // the range the review found it missing from: "not a single drainage line,
  // gully, talus fan or deposition apron anywhere in frame". Sliding the onset
  // down with distance tracks the mip's own attenuation and keeps the channels
  // reading out to a kilometre, where a 4 m gully is a pixel and the albedo is
  // the only thing left that can carry it.
  float chanLo = mix(0.62, 0.30, ss(150.0, 900.0, vCamDist));
  float chan = ss(chanLo, chanLo + 0.35, dFlow) * (1.0 - ss(0.20, 0.48, slope)) * (0.35 + 0.65 * dLoose);
  vec3 chanMod = mix(vec3(1.0), chromaTrim(vec3(0.79, 0.77, 0.74), TQ_CHROMA), chan * 0.8);
  accA *= max(vec3(0.05), vec3(1.0) + (chanMod - vec3(1.0)) * farLift);
  accAO *= 1.0 - 0.28 * chan;
  // Scree reads paler and dustier than the bedrock it has come off.
  accA *= mix(vec3(1.0), chromaTrim(vec3(1.14, 1.09, 1.00), TQ_CHROMA), dLoose * 0.4);

  float wet = uWetness * (0.3 + 0.7 * dFlow);
  accA *= mix(1.0, 0.6, wet);
  accR = mix(accR, 0.11, wet * 0.8);

  // A zero accumulator is reachable — every projection under the 0.02 cut, or a
  // tangent normal that cancels against the meso gradient — and normalize(0) is
  // a NaN that the G-buffer happily stores and every later pass reads back as a
  // black hole. Fall back to the geometric normal.
  float accNLen = length(accN);
  gTerrNormal = accNLen > 1e-5 ? accN / accNLen : N;
  gTerrRough = accR;
  gTerrAO = clamp(accAO, 0.0, 1.0);

  // Cooling-crust fissures.
  //
  // The previous field was pow(1 - accH, 3) of the *mid-band texture height*,
  // which lights up every low contour of an 8 m blob field. That produces
  // hundreds of glowing closed loops, hooks and spirals at one single scale
  // covering the entire crust — which is what the review measured and, quite
  // reasonably, read as a curl-noise field pretending to be erosion. It was
  // never erosion; it was a contour plot.
  //
  // A real crust cracks into a sparse polygonal network: thin incandescent lines
  // metres apart with cold plate between them, not a uniform lace. Two ridged
  // value fields at 18 m and 48 m, multiplied so a line only survives where both
  // agree, then gated hard: under a tenth of the crust glows and the network
  // reads as fracture rather than as texture. accH still modulates it so the
  // glow sits *down inside* the crack instead of on top of the plate.
  //
  // Past 150 m the individual cracks are sub-pixel; resolving toward a dull mean
  // rather than letting a high-contrast emissive alias is the difference between
  // a distant vent glow and a field of fireflies.
  float lavaW = clamp(w[7], 0.0, 1.0);
  gLava = 0.0;
  if (lavaW > 0.002) {
    float fz1 = 1.0 - abs(tVal(vWPos.xz * 0.055 + 4.3) * 2.0 - 1.0);
    float fz2 = 1.0 - abs(tVal(TROT * vWPos.xz * 0.021 - 11.7) * 2.0 - 1.0);
    float fissure = ss(0.875, 0.995, fz1 * (0.40 + 0.60 * fz2));
    fissure = mix(fissure, 0.10, ss(150.0, 420.0, vCamDist));
    gLava = 0.55 * lavaW * fissure * (1.0 - 0.65 * accH) *
            (0.72 + 0.28 * sin(uTime * 0.6 + vWPos.x * 0.04 + vWPos.z * 0.031));
  }

#if TQ_MONOALB
  // See the TQ_MONOALB note in FRAG_PARS. Compiled out unless a QA tool asks.
  accA = vec3(dot(accA, vec3(0.2126, 0.7152, 0.0722)));
#endif

  diffuseColor.rgb *= accA;

#if TQ_DBG
  // See the TQ_DBG note in FRAG_PARS. Compiled out unless a QA tool asks for it.
  vec3 dbg = vec3(0.0);
  #if TQ_DBG == 1
    float li0 = float(li.x);
    dbg = 0.5 + 0.5 * cos(6.2831853 * (li0 * 0.137 + vec3(0.0, 0.33, 0.67)));
  #elif TQ_DBG == 2
    dbg = accA;
  #elif TQ_DBG == 3
    dbg = gTerrNormal * 0.5 + 0.5;
  #elif TQ_DBG == 4
    dbg = vec3(dFlow, dCurv * 0.5 + 0.5, dShelter);
  #elif TQ_DBG == 5
    dbg = vec3(dLoose, clamp(w[5], 0.0, 1.0), clamp(w[0], 0.0, 1.0));
  #elif TQ_DBG == 7
    dbg = vec3(mesoShape, scour, drift);
  #elif TQ_DBG == 8
    dbg = dbgSplat;
  #elif TQ_DBG == 9
    dbg = vec3(gTerrAO);
  #elif TQ_DBG == 10
    // ONE array fetch, dominant projection, layer 0, no de-tiling frame, no
    // tint, no height blend, no triplanar sum. If a defect survives into this
    // it is the fetch and its filter; if it does not, it is something the splat
    // stage wraps around the fetch. Modes 11 and 12 are the other two halves of
    // that question — the triplanar weights, and the GEOMETRIC normal, which is
    // the one input to the whole stage that mode 3 (the shading normal) cannot
    // clear because the analytic bands have already written to it.
    {
      vec2 qdu = domDX * midS;
      vec2 qdv = domDY * midS;
      limitAniso(qdu, qdv, maxAniso);
      dbg = textureGrad(uAlbArr, vec3(domUV * midS, 0.0), qdu, qdv).rgb * 2.2;
    }
  #elif TQ_DBG == 11
    dbg = tw;
  #elif TQ_DBG == 12
    dbg = N * 0.5 + 0.5;
  #elif TQ_DBG == 14
    // The dominant layer index as a linear grey ramp, and the tint the compiled
    // shader is actually indexing with it. Mode 1's cosine palette is unique per
    // layer but the composite's own passes move it enough that reading an index
    // back off it is guesswork; these two are exact. 15 exists because "the
    // constant in the source is not the constant on the GPU" has to be a
    // decidable question when a palette measurement refuses to move.
    dbg = vec3(float(li.x) * (1.0 / 7.0));
  #elif TQ_DBG == 15
    dbg = LAYER_TINT[li.x] * 0.25;
  #elif TQ_DBG == 13
    // Coverage of the three bands that own the near plane: red is the 24 cm
    // grit, green the 55 cm debris, blue the 28 cm grain texture. Black ground
    // is ground with no micro-structure on it at all, which is the whole of the
    // "featureless mud" finding stated as a picture.
    // debK and dfade live inside their bands' own #if, and the lowest tier
    // compiles the debris band out, so neither can be named unconditionally.
#if TQ_DEBRIS
    dbg = vec3(gritA, debK, dfade);
#else
    dbg = vec3(gritA, 0.0, dfade);
#endif
  #else
    dbg = vec3(clamp(log2(fp) * 0.2 + 0.6, 0.0, 1.0));
  #endif
  gTerrDbg = dbg;
#endif
`;

/**
 * Attribution stub for the splat, selected by `TQ_NOSPLAT`.
 *
 * The only way to price the surface stage on its own is to delete it while
 * leaving everything downstream — the standard lighting integral, three cascade
 * lookups, the AO and specular-occlusion terms, the aerial integral — running
 * over exactly the same pixels. Swapping the whole material for the depth
 * variant removes all of those together and cannot separate them, which is how
 * "terrain is vertex-bound" survived as long as it did. This writes plausible
 * constants into the five globals FRAG_SPLAT publishes and nothing else.
 *
 * Never selected by a tier; QA only, via `setBudget('TQ_NOSPLAT', '1')`.
 */
const FRAG_SPLAT_STUB = /* glsl */ `
  gTerrNormal = normalize(vWNrm);
  gTerrRough = 0.92;
  gTerrAO = 1.0;
  gLava = 0.0;
  diffuseColor.rgb *= vec3(0.36, 0.31, 0.26);
  #if TQ_DBG
  gTerrDbg = vec3(0.0);
  #endif
`;

interface AerialInjection {
  glsl: string;
  /** Builds the call expression given a linear colour and a world position. */
  call(color: string, worldPos: string): string;
}

/**
 * three's point-light loop with a zero-contribution early-out, for THIS material
 * only. Returns replacement text for `#include <lights_fragment_begin>`.
 *
 * ## Why
 *
 * A point light is a compile-time entry in NUM_POINT_LIGHTS, so every forward
 * material in the scene evaluates a full GGX lobe plus a Lambert term for every
 * resident light on every fragment — whether that light reaches the fragment or
 * not. This scene keeps twelve of them resident on purpose (changing the count
 * recompiles every program in the game, which was a measured hitch), and all
 * twelve have a cutoff `distance` of 4-20 m. Terrain covers most of a landscape
 * frame and essentially none of it is within 20 m of a lantern, so the whole
 * loop was being paid, in full, across the largest surface in the image, to add
 * exactly zero.
 *
 * Measured by paired ablation at medium, 1920x1080: hiding lights — which also
 * recompiles to a smaller loop — moved dawn 45.9 -> 36.8 ms for five of them.
 * That is 3-4% of the whole frame per resident light, and it is the largest
 * single cost this subsystem had.
 *
 * ## Why it is exact
 *
 * `getPointLightInfo` ends with `light.visible = ( light.color != vec3( 0.0 ) )`,
 * and `getDistanceAttenuation` returns exactly 0 at and beyond `cutoffDistance`
 * (the `saturate( 1.0 - pow4( d / cutoff ) )` factor). `RE_Direct_Physical`
 * multiplies both of its terms by `irradiance = dotNL * directLight.color`, so a
 * light with zero colour contributes bit-exact zero. Skipping it is therefore
 * not an approximation and there is no distance, tier or angle at which the two
 * paths differ. It is a *branch*, not a budget: nothing is removed from the
 * image, so nothing has to be tuned, faded or gated.
 *
 * The branch is also coherent — a light's cutoff sphere either covers a screen
 * region or does not — which is what makes it worth taking on a GPU that
 * executes both sides of a divergent one.
 *
 * Applied here rather than to `THREE.ShaderChunk` because the chunk is shared
 * output: patching it globally would change architecture, actors and water in
 * the same edit. It is exact, so a global patch would be correct — but "correct"
 * is not the same as "mine to make this round".
 *
 * Throws if three's chunk no longer has the shape this expects, so a version
 * bump fails loudly at boot instead of silently dropping every point light.
 */
function pointLightEarlyOut(): string {
  const chunk = (THREE.ShaderChunk as unknown as Record<string, string>).lights_fragment_begin;
  const CALL =
    'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
  const head = chunk.indexOf('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )');
  const tail = chunk.indexOf('#if ( NUM_SPOT_LIGHTS > 0 )', head);
  if (head < 0 || tail < 0) throw new Error('terrain: lights_fragment_begin has no point-light block');
  const block = chunk.slice(head, tail);
  if (block.split(CALL).length !== 2) {
    throw new Error('terrain: point-light block does not contain exactly one RE_Direct call');
  }
  // No declarations inside the guard: `unroll_loop_start` pastes the body n
  // times into ONE scope, so a local here would be redeclared by pass two.
  const guarded = block.replace(CALL, `if ( directLight.visible ) { ${CALL} }`);
  return chunk.slice(0, head) + guarded + chunk.slice(tail);
}

function fallbackAerial(): AerialInjection {
  return {
    glsl: /* glsl */ `
vec3 terrainFallbackFog(vec3 c, vec3 wp) {
  float d = length(wp - cameraPosition);
  float f = 1.0 - exp(-d * d * uFallbackFogDensity * uFallbackFogDensity);
  return mix(c, uFallbackFog, clamp(f, 0.0, 1.0));
}
`,
    call: (c, p) => `terrainFallbackFog(${c}, ${p})`,
  };
}

/**
 * The sky publishes its scattering integral as source, not as a fixed symbol,
 * so probe for the (colour, eyeToFragment) entry point rather than hard-coding
 * a name that could drift. Terrain fog then *is* the sky's code, which is the
 * only way a rock at 400 m and the sky behind it agree on colour.
 */
export function resolveAerial(glsl: string | undefined): AerialInjection | null {
  if (!glsl) return null;
  const twoArg = /vec3\s+([A-Za-z_]\w*[Aa]erial\w*)\s*\(\s*vec3\s+\w+\s*,\s*vec3\s+\w+\s*\)/.exec(glsl);
  if (twoArg) {
    const n = twoArg[1];
    return { glsl, call: (c, p) => `${n}(${c}, ${p} - cameraPosition)` };
  }
  const threeArg = /vec3\s+([A-Za-z_]\w*[Aa]erial\w*)\s*\(\s*vec3\s+\w+\s*,\s*float\s+\w+\s*,\s*vec3\s+\w+\s*\)/.exec(glsl);
  if (threeArg) {
    const n = threeArg[1];
    return { glsl, call: (c, p) => `${n}(${c}, length(${p} - cameraPosition), ${p} - cameraPosition)` };
  }
  return null;
}

export interface TerrainMaterials {
  material: THREE.MeshStandardMaterial;
  depth: THREE.MeshDepthMaterial;
  distance: THREE.MeshDistanceMaterial;
  /** Depth/normal/velocity prepass variant. Hung on `mesh.userData`. */
  prepass: THREE.ShaderMaterial;
  /**
   * Select the fragment budget. 0-3, matching the render tiers low..ultra; see
   * the TQ block in FRAG_PARS. Recompiles the shaded material and nothing else
   * — the depth, distance and prepass variants are vertex-only and identical at
   * every tier, which is what keeps the caster and the receiver the same
   * surface across a tier change.
   */
  setQuality(level: number): void;
  /**
   * QA hook: override one fragment-budget macro, or pass null to hand it back
   * to the tier. See the TQ block in FRAG_PARS for the names.
   *
   * Recompiles, so this is a settings-change operation and not something to
   * call per frame — but it is the only way to price a single knob without a
   * rebuild per knob, and the tier table above was chosen with it.
   */
  setBudget(key: string, value: string | null): void;
  dispose(): void;
}

/**
 * Prepass variant of the terrain.
 *
 * The generic prepass override in src/render knows nothing about `iNode` or the
 * height texel fetch, so under `scene.overrideMaterial` the whole terrain
 * collapses to a stack of coincident unit quads at the origin and SSAO, contact
 * shadows and TAA all see a world with no ground in it. This material runs the
 * *same* VERT_BODY as the shaded pass — the same morph, off the same uEye — so
 * the G-buffer surface is the surface that gets shaded, to the last vertex.
 *
 * The fragment stage is imported from src/render verbatim rather than copied:
 * the MRT layout is that module's contract, and a copy would silently rot the
 * first time location 1 changes meaning.
 */
const PREPASS_VERT_TERRAIN = /* glsl */ `
${VERT_PARS}
uniform mat4 uCurrVP;
uniform mat4 uPrevVP;

out vec3 vViewNormal;
out float vViewDepth;
out vec4 vCurClip;
out vec4 vPrevClip;

void main() {
${VERT_BODY}
  vec4 mv = modelViewMatrix * vec4(tPos, 1.0);
  // The jittered projection, exactly as the shaded pass sees it, so depth and
  // normals land on the same pixels as the colour they describe.
  gl_Position = projectionMatrix * mv;

  vViewNormal = normalMatrix * tNrm;
  vViewDepth = -mv.z;

  // Motion vectors from the UNjittered matrices. The terrain group never moves,
  // so its previous world transform is its current one and the whole velocity
  // is camera reprojection — which is exactly right: a given world point on the
  // heightfield does not move even though the vertex that carries it does, as
  // the LOD morph slides vertices along a surface that is itself static.
  vec4 wp = modelMatrix * vec4(tPos, 1.0);
  vCurClip = uCurrVP * wp;
  vPrevClip = uPrevVP * wp;
}
`;

export function createTerrainMaterials(
  uniforms: TerrainUniforms,
  aerialIn: AerialInjection | null,
  extraUniforms: Record<string, THREE.IUniform> | null,
): TerrainMaterials {
  const aerial = aerialIn ?? fallbackAerial();

  const bind = (target: { [k: string]: THREE.IUniform }): void => {
    for (const k in uniforms) target[k] = uniforms[k];
    if (extraUniforms) for (const k in extraUniforms) if (!(k in target)) target[k] = extraUniforms[k];
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    // three's `dithering` adds a fixed screen-space ordered pattern to the
    // output. It is only ±0.5/255, but this material is the one the review
    // measured an ordered crosshatch on, the pipeline grades and dithers at the
    // end of the chain anyway, and a terrain-only screen lattice is exactly the
    // thing that must not exist here.
    dithering: false,
  });
  // Fragment budget, replaced by setQuality. three folds `defines` into the
  // program cache key, so changing this genuinely recompiles rather than
  // handing back the cached program with the old text in it.
  const defines: Record<string, string> = { TQ: '2' };
  material.defines = defines;

  material.onBeforeCompile = (shader) => {
    bind(shader.uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `${VERT_PARS}\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\nvarying float vCamDist;\nvoid main() {`,
      )
      .replace('#include <beginnormal_vertex>', `${VERT_BODY}\n  vec3 objectNormal = tNrm;`)
      .replace(
        '#include <begin_vertex>',
        `  vec3 transformed = tPos;\n  vWPos = tPos;\n  vWNrm = tNrm;\n  vCamDist = distance(uEye, tPos);`,
      );

    shader.fragmentShader = shader.fragmentShader
      // See pointLightEarlyOut. Bit-exact; it skips a BRDF that adds zero.
      .replace('#include <lights_fragment_begin>', pointLightEarlyOut())
      .replace('void main() {', `${FRAG_PARS}\n${aerial.glsl}\nvoid main() {`)
      .replace('#include <map_fragment>', `#if TQ_NOSPLAT\n${FRAG_SPLAT_STUB}\n#else\n${FRAG_SPLAT}\n#endif`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * gTerrRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness;')
      .replace(
        '#include <normal_fragment_maps>',
        'normal = normalize((viewMatrix * vec4(gTerrNormal, 0.0)).xyz);',
      )
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += uLavaColor * gLava;')
      .replace(
        '#include <aomap_fragment>',
        `float ambientOcclusion = gTerrAO;
        reflectedLight.indirectDiffuse *= ambientOcclusion;
        #if defined( USE_ENVMAP ) && defined( STANDARD )
          float dotNVao = saturate( dot( geometryNormal, geometryViewDir ) );
          reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNVao, ambientOcclusion, material.roughness );
        #endif`,
      )
      // The terrain's shaded result, with the sky's own scattering integral
      // applied so a flank at 400 m and the sky behind it are the same number.
      //
      // This line used to read `gl_FragColor = vec4(gTerrDbg, ...)`, where
      // gTerrDbg was a greyscale visualisation of the mip level the mid band's
      // fetch was landing in — a debugging aid that was left wired to the output.
      // It discarded `outgoingLight` entirely: every albedo fetch, every tangent
      // normal, the cavity term, the roughness split, all eight layers of the
      // splat and the whole lighting integral were computed and then thrown away,
      // and what reached the film was log2(footprint)/9 in all three channels,
      // multiplied by whatever the fog stage did to it afterwards.
      //
      // That single expression is the whole of "untextured clay", "nothing is
      // textured", "a flat cutout at std 3.5/255" and "a 2002 game with 256px
      // diffuse maps holds more surface information than this": literally no
      // texture was reaching the frame. It is also "a constant-screen-scale
      // worm-noise sweater" — a mip level is a function of screen-space
      // derivatives, so the pattern was parameterised in screen space by
      // construction and swam with the camera exactly as the review described.
      // And because terrain fills most of every landscape frame, a monochrome
      // ramp under a warm fog is what every colour-grade pass upstream has spent
      // three rounds tuning against.
      .replace(
        '#include <opaque_fragment>',
        `#ifdef OPAQUE
        diffuseColor.a = 1.0;
        #endif
        #if TQ_DBG
        gl_FragColor = vec4(gTerrDbg, 1.0);
        #else
        gl_FragColor = vec4(${aerial.call('outgoingLight', 'vWPos')}, diffuseColor.a);
        #endif`,
      );
  };

  const patchVertexOnly = (mat: THREE.Material, offsetAlongNormal: boolean): void => {
    mat.onBeforeCompile = (shader) => {
      bind(shader.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', `${VERT_PARS}\nuniform float uDepthOffset;\nvoid main() {`)
        .replace(
          '#include <begin_vertex>',
          // The caster offset has to track the *shadow texel*, not a constant.
          // A single cascade covers hundreds of metres at 2048², so one texel is
          // of order a metre on the ground; on a 50-degree flank the depth
          // varies by more than that across one texel, and a flat 0.45 m push
          // cannot cover it — the result is textbook acne on the shadow map's
          // own grid.
          //
          // But it must scale with something CONTINUOUS, and iNode.z is not.
          // Node size steps by a factor of two at every LOD ring, so the offset
          // stepped with it: 0.8 m of push inside a 15 m node against 11 m
          // inside a 500 m one. The caster surface therefore had a metres-deep
          // cliff along every quadtree boundary — and a quadtree boundary is an
          // axis-aligned world-space rectangle. What the shadow edge did as it
          // crossed one was jump sideways by that amount and then turn a perfect
          // right angle to follow the node edge. That is the "hard axis-aligned
          // rectangular step", the "perfect right-angle notch", and the
          // "razor-straight shading discontinuity" the review found in coast and
          // ridge, and it is why they looked like a chunk seam without being one:
          // the drawn mesh is watertight, it was the shadow that was not.
          //
          // dist0 is the same eye distance the CDLOD morph runs on, so it is
          // continuous across every node boundary by construction (a shared edge
          // vertex has one unmorphed position and therefore one dist0, whichever
          // node evaluates it). 0.011 per metre reproduces the old magnitude at
          // every range — LOD_K is 4.5 over a 32-quad grid, so a node's cell was
          // dist/144 and the old term was 1.5 times that — without the steps.
          `${VERT_BODY}\n  vec3 transformed = tPos${
            offsetAlongNormal ? ' + tNrm * (uDepthOffset * (1.0 + dist0 * 0.011))' : ''
          };`,
        );
    };
  };

  // Pushing the shadow caster along its own normal is a slope-scaled bias that
  // costs nothing and cannot acne, unlike a constant depth bias which either
  // leaks on the flats or peter-pans on the cone.
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  patchVertexOnly(depth, true);

  const distance = new THREE.MeshDistanceMaterial();
  patchVertexOnly(distance, true);

  const prepassUniforms: { [k: string]: THREE.IUniform } = {
    uCurrVP: { value: new THREE.Matrix4() },
    uPrevVP: { value: new THREE.Matrix4() },
  };
  bind(prepassUniforms);

  const prepass = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: PREPASS_VERT_TERRAIN,
    fragmentShader: PREPASS_FRAG,
    uniforms: prepassUniforms,
    // Single-sided, unlike the generic prepass: the heightfield has no back
    // faces, and admitting them would write normals pointing into the ground.
    side: THREE.FrontSide,
    blending: THREE.NoBlending,
    toneMapped: false,
  });

  return {
    material,
    depth,
    distance,
    prepass,
    setQuality(level: number) {
      const tq = String(Math.max(0, Math.min(3, Math.round(level))));
      if (defines.TQ === tq) return;
      defines.TQ = tq;
      material.needsUpdate = true;
    },
    setBudget(key: string, value: string | null) {
      // 'TQ_', not 'TQD_', was the test, and every knob in the tier table is
      // named TQD_*. So this hook silently accepted nothing and returned for
      // every key it was ever given — the one tool for pricing a single knob
      // without a rebuild per knob has never once had an effect. The two
      // prefixes in use are TQD_ (the budget table) and TQ_ (the QA switches
      // TQ_DBG and TQ_NOSPLAT), so admit both and nothing else.
      if (!key.startsWith('TQD_') && !key.startsWith('TQ_')) return;
      if (value === null) {
        if (!(key in defines)) return;
        delete defines[key];
      } else {
        if (defines[key] === value) return;
        defines[key] = value;
      }
      material.needsUpdate = true;
    },
    dispose() {
      material.dispose();
      depth.dispose();
      distance.dispose();
      prepass.dispose();
    },
  };
}
