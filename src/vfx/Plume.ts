import * as THREE from 'three';
import { AERIAL_GLSL, aerialUniforms } from '../sky/Atmosphere';
import { VFX_BILLBOARD, VFX_COMMON, VFX_FRAG, VFX_NOISE, VFX_SPRITE, vfxUniforms } from './glsl';
import { tileUV } from './Sprites';

/**
 * RED MOUNTAIN — the caldera ash column.
 *
 * Every other particle system in this subsystem is anchored to the CAMERA: a
 * wrapped box that follows the eye, so a fixed instance count covers an
 * infinite world. That is exactly the wrong model for the one silhouette this
 * game cannot ship without. The plume is a LANDMARK — it has a fixed world
 * position, it is read from ten kilometres away, and its shape has to be the
 * same shape from every vantage or it stops being a landmark and becomes a
 * local weather effect that happens to be near a mountain.
 *
 * So this is world-anchored and parametric in exactly one variable: height
 * above the vent. Everything else — radius, buoyant rise, wind shear, opacity,
 * colour — is a closed-form function of that, evaluated per instance in the
 * vertex shader against an immutable seed, the same discipline as the rest of
 * the subsystem. There is no CPU simulation and no per-frame upload.
 *
 * THE COLUMN MODEL, bottom to top:
 *
 *  - a buoyant jet that decelerates: the vertical velocity decays with height
 *    as the column entrains cold air, so the parcels bunch up as they climb and
 *    the plume reads dense at the vent and diffuse at the cap;
 *  - a radius that opens as the square root of height, which is what an
 *    entraining plume actually does and what stops it reading as a cone;
 *  - wind shear applied as the INTEGRAL of the drift over the parcel's age, so
 *    the column leans progressively rather than tilting as a rigid body — the
 *    bent-over top is most of the silhouette's character;
 *  - a cap where the column hits its neutral buoyancy level, spreads laterally
 *    and stalls. This is the anvil, and it is the part a viewer recognises.
 *
 * LIGHTING. The underside is lit by the vent, which is treated as an
 * ember-coloured area emitter with an inverse-square falloff and a cosine
 * weight for the parcel's own facing — so the belly of the column glows
 * `#c4551f` and the light dies out a few hundred metres up. Above that the
 * parcel is lit like every other particle in the subsystem: by the sun, the
 * sky, and the shared particulate medium, so it desaturates into the sulphur
 * sky band exactly the way the aerial term takes the terrain. The two are
 * blended by height, not switched, so there is no visible line.
 */

const VERT = /* glsl */ `
precision highp float;

attribute vec4 aSeed;

uniform vec3  uOrigin;
uniform float uVentR;
uniform float uHeight;
uniform float uSpread;
uniform float uShear;
uniform float uLife;
uniform vec2  uSize;
uniform float uDensity;

uniform float uPallFrac;
uniform float uPallLife;
uniform float uPallRise;
uniform float uPallSink;
uniform float uPallSlope;
uniform float uPallBias;
uniform float uPallR0;
uniform float uPallOp;

varying vec2  vUv;
varying vec3  vWorld;
varying vec3  vRight;
varying vec3  vUpv;
varying float vFade;
varying float vViewDist;
/** Normalised height above the vent, 0 at the crater lip and 1 at the cap. */
varying float vAlt;
/** Soft-particle fade distance in metres; see the fallout branch. */
varying float vSoft;
/** 1 on a fallout parcel, 0 on a column parcel. */
varying float vPall;
/** Per-parcel hash, for silhouette break-up and per-parcel shading variation. */
varying float vSeed;
/**
 * OPTICAL DEPTH THROUGH THE COLUMN AT THIS PARCEL, 0 at the margin and 1 on the
 * axis. This is the self-shadowing term, and it is the difference between a
 * volume and a heap of billboards.
 *
 * A parcel on the axis of an eruption column has a hundred metres of ash
 * between it and every light in the sky; a parcel on the entrainment margin has
 * almost none. Shading both with the same BRDF against the same medium is what
 * made the column render as a pale mass of separate round puffs — every one of
 * them lit as if it were a single suspended flake in open air, which is exactly
 * what a lone flake looks like and nothing like what a column looks like.
 */
varying float vCore;
/** 1 where the parcel sits on the sunward side of the column axis, 0 opposite. */
varying float vSunSide;
/** (cos, sin) of the parcel's silhouette phase; see the fragment stage. */
varying vec2  vPhase;

${VFX_NOISE}
${VFX_COMMON}
${VFX_SPRITE}
${VFX_BILLBOARD}

void main() {
  vec3 pos;
  float size;
  float alpha;

  // THE PALL — the half of an eruption column a landmark actually needs.
  //
  // The column proper climbs a kilometre and a half out of the crater, which
  // means that from anywhere near the mountain it is ABOVE the top of the
  // frame: the vent alone subtends more than forty degrees of elevation, and a
  // camera that frames the mountain cannot also frame the thing venting off the
  // top of it. A shot named for Ember Mount that shows a bare cone is the
  // result, and no amount of density on the column fixes it, because the column
  // is not in the picture.
  //
  // What IS in the picture is the flank. So a fraction of the population is
  // fallout instead: it leaves the vent, stalls, and then drains DOWN the cone,
  // with its distance from the axis set by how far it has descended rather than
  // by how long it has lived. That is what keeps the sheet ON the mountain —
  // ash that ignores the cone either hangs off its shoulder in mid-air or is
  // buried inside its own volume and never rasterised. The azimuth fan is
  // biased downwind, so every flank carries some and the downwind sector
  // carries most, which is the shape of a real ash-fall footprint.
  if (vfxHash11(aSeed.x * 91.7 + aSeed.z * 37.3 + 0.5) < uPallFrac) {
    float life = uPallLife * (0.6 + aSeed.w * 0.8);
    float run = fract(uVfxTime / life + aSeed.y);

    float ang = aSeed.x * 6.2831853;
    vec3 rdir = vec3(cos(ang), 0.0, sin(ang));
    vec3 wxz = vec3(uVfxWind.x, 0.0, uVfxWind.z);
    float ws = length(wxz);
    vec3 wdir = ws > 0.05 ? wxz / ws : vec3(1.0, 0.0, 0.0);
    vec3 flow = rdir + wdir * uPallBias;
    float fl = length(flow);
    flow = fl > 1e-3 ? flow / fl : rdir;

    float sink = uPallSink * smoothstep(0.15, 1.0, run) * (0.6 + 0.8 * aSeed.w);
    float drop = sink * uHeight;
    // Mid-tone, not leaden. The column's shaft is dark because it is optically
    // thick and self-shadowing against a bright sky; the flank sheet is a thin
    // veil seen against ROCK, and graded at the shaft's value it is a dark film
    // over a dark mountain that no viewer can resolve. Ash on a flank reads pale.
    vAlt = clamp(0.45 + 0.35 * run, 0.0, 1.0);

    // ALTITUDE IS SET BY THE DESCENT, NOT BY A RISE.
    //
    // The obvious formulation — climb out of the vent, then fall — does not
    // work here: any rise worth seeing is four hundred metres, and four hundred
    // metres of lift over a cone whose radius grows one metre per metre of
    // descent leaves the whole sheet hanging in clear air off the mountain's
    // shoulder for its entire life. It never touches the flank it is supposed
    // to be draping. So the sheet's height is the descent itself, and the only
    // free term is a lift of a couple of vent radii that keeps it clear of the
    // rock and lets it billow as it runs.
    float lift = uVentR * (0.35 + 0.75 * run) * uPallRise;
    float rr = (uPallR0 + drop * uPallSlope) * 1.05 * (0.94 + 0.16 * aSeed.z);
    pos = uOrigin + flow * rr + vec3(0.0, lift - drop, 0.0);
    // TURBULENCE STAYS IN THE PLANE OF THE FLANK.
    //
    // The curl field was applied isotropically at up to 176 m of amplitude, on
    // top of a lift that reached two vent radii. A parcel could therefore end up
    // four hundred metres clear of the cone in still air, and because the sheet
    // is drawn against a bright sky at that altitude the outliers read as a
    // detached cluster of orange balls floating beside the mountain with nothing
    // connecting them to the vent. Squashing the vertical component keeps the
    // shear where it belongs — along the surface the ash is draining down.
    vec3 curl = vfxCurl(pos * 0.0022 + vec3(0.0, vfxNoiseT() * 0.04, 0.0), 0.8);
    pos += vec3(curl.x, curl.y * 0.22, curl.z) * (22.0 + 90.0 * run);

    // CONE CLEARANCE. The modelled flank drops one metre for every uPallSlope
    // metres of radius, so the surface under a parcel at horizontal distance
    // hd from the axis is at this height. Anything that has climbed clear of
    // it is no longer a sheet lying on the mountain, and fading it out is what
    // keeps the fallout attached to the thing it is falling off.
    vec2 rel = pos.xz - uOrigin.xz;
    float hd = length(rel);
    float coneY = uOrigin.y - max(hd - uPallR0, 0.0) / max(uPallSlope, 0.5);
    float clear = pos.y - coneY;
    alpha = uDensity * uPallOp
          * smoothstep(0.0, 0.07, run)
          * (1.0 - smoothstep(0.55, 1.0, run))
          * (1.0 - smoothstep(uVentR * 0.55, uVentR * 1.45, clear));

    // HALF THE COLUMN'S PARCEL. The fallout sheet is a thin veil draining down
    // a rock face, not a convective billow: its structure is finer than the
    // shaft's, and at the six hundred metres a ridge vantage sees the cone from,
    // column-sized parcels resolve individually as a scatter of pale clumps on
    // the flank — the ridge blocker. Halving the parcel quarters its fill, which
    // the budget converts straight back into four times the population, so the
    // sheet gains exactly the overlap it needs to read as a dusting.
    size = mix(uSize.x, uSize.y, aSeed.z) * 0.55 * (0.7 + 1.5 * run) * (0.55 + 0.9 * aSeed.w);
    vPall = 1.0;
    // A flank sheet is a thin veil, not a column: barely any self-shadowing.
    vCore = 0.18;
    // THE FADE DISTANCE IS THE WHOLE BALLGAME HERE. The column's parcels hang
    // in open air hundreds of metres from anything, so a forty-metre soft fade
    // costs it nothing; the fallout sheet is BY DESIGN lying on the flank, and
    // the same forty metres erases it completely — every fragment is within the
    // fade distance of the rock behind it, so the sheet integrates to zero and
    // the mountain renders inert with the effect nominally enabled. A metres-
    // scale fade still dissolves the contact and leaves the sheet visible.
    vSoft = 9.0;
  } else {
  float life = uLife * (0.7 + aSeed.w * 0.6);
  float ph = fract(uVfxTime / life + aSeed.y);

  // Buoyant rise with entrainment drag. h(ph) is concave: the parcel covers
  // most of the column early and then crawls, which is what puts the mass in
  // the cap where it belongs. The exponent is a compromise — push it much past
  // 1.4 and the uniform phase distribution piles almost every parcel into the
  // top fifth of the column, where the dispersal fade then throws them away,
  // and the shaft below reads as a thin spray of separate blobs.
  float climb = 1.0 - pow(1.0 - ph, 1.4);
  float alt = climb * uHeight;
  vAlt = climb;

  // sqrt opening. A linear radius reads as a traffic cone; entrainment goes as
  // the square root of the distance from the source.
  float rad = uVentR + uSpread * sqrt(climb) * uHeight * 0.06;
  // The cap: once the column stalls it spreads sideways instead of climbing.
  rad *= 1.0 + 2.1 * smoothstep(0.62, 1.0, climb);

  float ang = aSeed.x * 6.2831853 + climb * 2.4 * (aSeed.z - 0.5);
  float rr = rad * (0.25 + 0.75 * sqrt(aSeed.z));
  pos = uOrigin + vec3(cos(ang) * rr, alt, sin(ang) * rr);

  // Shear: the integral of the wind over the parcel's age, so the lean
  // accumulates with height and the column bends instead of tilting.
  pos.xz += vec2(uVfxWind.x, uVfxWind.z) * uShear * climb * climb * (0.6 + 0.8 * aSeed.w);

  // Turbulent break-up, in world space so the structure is attached to the
  // column and not to the screen. Two octaves: the coarse one throws the
  // billows off the axis, the fine one shears their spacing, so consecutive
  // parcels do not all sit on the same displaced streamline. A single octave is
  // a rigid warp of the whole column and leaves the parcel LATTICE intact,
  // which is what lets the eye count individual sprites.
  pos += vfxCurl(pos * 0.0035 + vec3(0.0, vfxNoiseT() * 0.05, 0.0), 0.8)
       * (14.0 + 90.0 * climb);
  pos += vfxCurl(pos * 0.0125 + vec3(0.0, vfxNoiseT() * 0.11, 31.7), 0.6)
       * (7.0 + 34.0 * climb);

  // Base raised from 0.55: parcels leaving the vent have to overlap or the
  // shaft reads as a rising string of separate discs rather than as a mass.
  size = mix(uSize.x, uSize.y, aSeed.z) * (0.95 + 1.9 * climb);
  vSoft = 40.0;
  vPall = 0.0;

  // Born at the vent, dying as it disperses into the sky band. The dispersal
  // fade has to start LATE: an eruption column is opaque almost to its cap, and
  // fading from mid-height leaves a transparent shaft that reads as a spray of
  // separate puffs rather than as a single mass.
  //
  // The radial term is the one that stops the column having an EDGE. A parcel
  // near the axis is looking through the whole thickness of the column; one out
  // at the entrainment radius is a shred on its margin, and drawing both at the
  // same opacity is what gives a plume a hard, round outline made of hard,
  // round sprites. rr/rad is exactly that normalised radius.
  float marg = 1.0 - smoothstep(0.55, 1.05, rr / max(rad, 1e-3));
  alpha = uDensity
        * smoothstep(0.0, 0.04, ph)
        * (1.0 - smoothstep(0.78, 1.0, climb))
        * (0.35 + 0.75 * marg);

  // SELF-SHADOWING. Optical depth through the column falls with the normalised
  // radius and with altitude: the shaft is thick and the cap has spread and
  // thinned. The fragment stage uses this to darken the parcel's albedo and to
  // pull its radiance ceiling down, which is what gives the column an interior
  // — a dark core reading against a lit margin — instead of one flat value that
  // the eye then resolves into individual discs.
  vCore = (1.0 - smoothstep(0.15, 0.95, rr / max(rad, 1e-3)))
        * (1.0 - 0.55 * smoothstep(0.35, 0.95, climb));
  }

  // Per-parcel opacity draw, independent of size. A population at one optical
  // depth reads as one sprite stamped repeatedly however well it is placed.
  alpha *= 0.45 + 0.85 * vfxHash11(aSeed.y * 71.3 + aSeed.z * 13.9);

  float d = max(-(viewMatrix * vec4(pos, 1.0)).z, 0.001);
  // ANGULAR SIZE GATE.
  //
  // Parcels here are HUNDREDS of metres across. Seen from the far side of the
  // map that is a 60-pixel puff; seen from the mountain's own flank the same
  // parcel subtends more than a radian, and a billboard that large is not a
  // puff of ash any more — it is a flat pale disc pasted over half the frame
  // with no internal structure, which is exactly the artefact this whole pass
  // exists to eliminate. size/d IS the angular diameter in radians, so gating
  // on it is resolution- and field-of-view-independent: parcels retire as they
  // grow too large to be honest, the small ones near the vent survive, and the
  // column thins out as you climb into it instead of swallowing the camera.
  // 0.10 to 0.30 radians, not 0.22 to 0.60. Standing on a ridge six hundred
  // metres from the cone, a parcel at the top of the size range subtended a
  // quarter of a radian — a 250-pixel soft blob — and a scatter of those over
  // the flank is the "oversized out-of-focus sprites, reads as a dirty lens"
  // blocker verbatim. Retiring anything past about seventeen degrees keeps the
  // fine parcels, which are the ones that interlock into a mass, and the
  // fill-rate budget converts the fill they release straight back into count.
  alpha *= 1.0 - smoothstep(0.10, 0.30, size / max(d, 1.0));
  alpha *= smoothstep(40.0, 220.0, d);
  alpha *= vfxFootprint(size, d);

  vec3 r, u, off;
  // Per-parcel rotation with a slow individual tumble. A field of billboards
  // that all share one screen-space orientation reads as a repeated stamp no
  // matter what is in the texture.
  float sd = vfxHash11(aSeed.x * 51.7 + aSeed.w * 27.1);
  float spin = aSeed.w * 6.2831853 + vfxNoiseT() * (sd - 0.5) * 0.10;
  vfxBillboard(position.xy, spin, size, r, u, off);
  vec3 world = pos + off;

  // Which side of the axis the parcel sits on, relative to the sun. This is the
  // large-scale lighting term a column needs and a per-billboard normal cannot
  // supply: the sunward flank of the whole shaft is bright and the far side is
  // in the shaft's own shadow, and that gradient across the silhouette is most
  // of what reads as three-dimensional mass.
  vec2 axial = pos.xz - uOrigin.xz;
  float al = length(axial);
  vSunSide = al > 1e-3
    ? clamp(dot(axial / al, normalize(uVfxSunDir.xz + vec2(1e-4))) * 0.5 + 0.5, 0.0, 1.0)
    : 0.5;

  vPhase = vec2(cos(sd * 43.1), sin(sd * 43.1));
  vSeed = sd;
  vUv = uv;
  vWorld = world;
  vRight = r;
  vUpv = u;
  vFade = alpha;
  vViewDist = d;

  gl_Position = alpha < 0.002
    ? vec4(2.0, 2.0, 2.0, 1.0)
    : projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uAtlas;
uniform vec2  uTile;
uniform vec3  uAsh;
uniform vec3  uCap;
uniform vec3  uPallCol;
uniform vec3  uEmber;
uniform float uVentGlow;
uniform float uGlowFall;
uniform vec3  uOrigin;
uniform float uHeight;

varying vec2  vUv;
varying vec3  vWorld;
varying vec3  vRight;
varying vec3  vUpv;
varying float vFade;
varying float vViewDist;
varying float vAlt;
varying float vSoft;
varying float vPall;
varying float vSeed;
varying float vCore;
varying float vSunSide;
varying vec2  vPhase;

${VFX_NOISE}
${AERIAL_GLSL}
${VFX_COMMON}
${VFX_SPRITE}
${VFX_FRAG}

void main() {
  vec4 s = texture2D(uAtlas, vfxTileUV(vUv, uTile));

  // THE SILHOUETTE IS THE DEFECT.
  //
  // vfxSpriteWindow is a perfectly circular, perfectly smooth alpha disc.
  // That is right for a mote three pixels across and catastrophic for a parcel
  // a hundred metres wide, because at that size the viewer resolves the disc
  // itself: a column built from them reads as a dozen soft balls with round
  // edges and sky between them however many of them there are. So the plume
  // gets its own window, whose CUT RADIUS is a per-parcel noise field — the
  // sprite is eroded into a ragged lobed shape, different on every instance,
  // and neighbouring parcels interlock into one turbulent mass instead of
  // tiling as circles. The noise lives in the sprite's own uv, so it rotates
  // and scales with the parcel instead of crawling across it.
  vec2 c = vUv * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  // ONE noise tap. This runs on parcels that are hundreds of pixels across and
  // the column is budgeted at several screens of blended fill, so the fragment
  // is the hottest shader in the subsystem; a second octave here costs more than
  // everything else in the pass put together and the silhouette does not need
  // it — the sprite's own alpha carries the fine detail.
  float lobe = vfxNoise(vec3(c * 4.1, vSeed * 41.0));
  // A near-free second harmonic. The noise tap gives the coarse tearing; an
  // azimuthal term at a per-parcel phase bites finger-shaped notches into it,
  // and two incommensurate scales is what stops neighbouring parcels tiling as
  // recognisable blobs. Built with the Chebyshev recurrence on a coordinate
  // pre-rotated by the parcel's phase — cos(3a) and cos(7a) in a dozen
  // multiplies — because this fragment covers several screens of blended fill
  // and an atan plus two sines here costs more than the noise tap does.
  float rl = sqrt(max(r2, 1e-8));
  vec2 q = vec2(c.x * vPhase.x - c.y * vPhase.y, c.x * vPhase.y + c.y * vPhase.x) / rl;
  float h2 = 2.0 * q.x * q.x - 1.0;
  float k2 = 2.0 * q.x * q.y;
  float h3 = h2 * q.x - k2 * q.y;
  float k3 = k2 * q.x + h2 * q.y;
  float h6 = 2.0 * h3 * h3 - 1.0;
  float k6 = 2.0 * k3 * h3;
  float h7 = h6 * q.x - k6 * q.y;
  // The amplitudes are DELIBERATELY small. A third harmonic at 0.2 turns every
  // parcel into a legible three-lobed clover, and a hundred clovers over a
  // mountain flank is a worse artefact than the circles they replaced — the
  // harmonics are here to break the outline, not to become the outline.
  lobe = clamp(lobe + 0.11 * h3 + 0.07 * h7, 0.0, 1.0);
  float rEdge = clamp(0.42 + 0.76 * lobe, 0.20, 1.0);
  float shape = 1.0 - smoothstep(rEdge * 0.10, rEdge, rl);
  // Interior structure, so a parcel is not a smooth radial ramp either. Shares
  // the field with the silhouette on purpose: a billow is thin where it is
  // ragged.
  float body = 0.40 + 1.00 * lobe;
  float cov = s.a * clamp(shape * body, 0.0, 1.0);
  if (cov < 0.004) discard;

  float a = cov * vFade * vfxSoft(vWorld, vViewDist, vSoft);
  if (a < 0.0025) discard;

  vec3 eye = vWorld - uVfxCamPos;
  vec3 V = -normalize(eye);

  float z = sqrt(max(0.0, 1.0 - r2));
  vec3 tn = s.xyz * 2.0 - 1.0;
  vec3 N = normalize(vRight * (c.x + tn.x * 0.35)
                   + vUpv  * (c.y + tn.y * 0.35)
                   + V * max(z, 0.25));

  // Sun, sky and medium — the same shading as every other ash particle in the
  // subsystem, so the column and the storm cannot drift apart in grade. The
  // albedo and the medium weight both ramp with altitude, so the cap
  // desaturates into the sulphur sky band instead of staying a grey mass
  // pasted on it.
  //
  // The ceiling is the load-bearing part. An eruption column is optically thick
  // and self-shadowing: seen against a bright sulphur sky its shaft is DARKER
  // than the sky, and only the sunlit cap approaches it. Letting the shared
  // particle BRDF run to parity with the medium — which is right for a single
  // suspended flake — turned the column into a pale plume of bright blobs, the
  // exact opposite of the silhouette. So the cap ramps with altitude: leaden at
  // the vent, sky-bright at the anvil.
  float up = smoothstep(0.15, 0.95, vAlt);
  // The fallout sheet does not share the column's altitude ramp. That ramp ends
  // at the cap colour, which is a saturated sulphur ochre chosen to dissolve
  // into the horizon band; used as an ALBEDO on a sheet seen against rock it
  // turns the flank into a field of orange discs — the one thing the palette's
  // saturation discipline exists to prevent, since ember and bioluminescence
  // are supposed to be the only vivid things in the frame.
  // Per-parcel albedo spread. Real ash billows are not one value: the ones the
  // sun has just broken over are pale and the ones in the column's own shadow
  // are nearly black, and that spread is most of what makes a plume read as
  // volume rather than as a stencil. A single albedo across the population is
  // what left "all the same orange".
  vec3 albedo = vPall > 0.5 ? uPallCol : mix(uAsh, uCap, up);
  albedo *= 0.55 + 0.95 * vSeed;
  // SELF-SHADOWING AND THE SUN SIDE. Together these are what make the column a
  // solid rather than a heap of separately-lit balls: the core is buried under
  // a hundred metres of its own ash and goes nearly to #4a423b, the margin
  // keeps the mid ash value, and the whole sunward flank of the shaft lifts
  // against the shadowed one. Applied to the radiance ceiling as well as to
  // the albedo, because the shared particle BRDF renormalises onto that
  // ceiling and a fixed one flattens any albedo spread straight back out.
  // The pall is a THIN VEIL ON ROCK, not a shaft: it has no interior to shadow
  // and it must not carry the column's sun-side modelling, or a hundred of them
  // over a lit flank read as a cluster of pale balls with a bright side — which
  // is exactly what the ridge vantage showed.
  float shade = vPall > 0.5
    ? (0.82 + 0.26 * vSunSide)
    : mix(1.0, 0.30, vCore) * (0.62 + 0.60 * vSunSide);
  albedo *= shade;
  // FORWARD SCATTER, per parcel. The translucency term in the shared particle
  // BRDF is a Henyey-Greenstein lobe through the flake, so raising it on a
  // parcel whose normal faces the sun is exactly the phase function the column
  // needs: the sunward flank of every billow brightens and the shadowed side
  // does not, which is what gives an ash column its internal modelling.
  float sunward = clamp(dot(N, uVfxSunDir) * 0.5 + 0.5, 0.0, 1.0);
  // THE CEILING NOW TOPS OUT BELOW THE MEDIUM, not at parity with it. A column
  // whose cap is allowed to reach the sky's own luminance has no silhouette
  // left — measured on redmtn/iter13 the plume's mean over the sky above the
  // summit was 240 against a sky of 237, i.e. the landmark that defines the
  // province's skyline was, to within a code value, not in the image.
  //
  // The pall gets a flat, low ceiling instead of the column's altitude ramp.
  // It is a film of ash lying on a mountain, and a film of ash on a mountain is
  // darker than the mountain, never brighter than the sky behind it.
  float cap = vPall > 0.5 ? 0.33 : mix(0.34, 0.74, up) * mix(1.0, 0.45, vCore);
  float medW = vPall > 0.5 ? 0.70 : mix(0.55, 1.15, up) * mix(1.0, 0.35, vCore);
  vec3 lit = vfxLitParticle(albedo, N, V, 1.0, mix(1.0, 0.4, cov),
                            1.1 + 1.5 * sunward * sunward,
                            medW, cap * shade * (0.80 + 0.5 * sunward));

  // The vent as an area emitter. Inverse-square in the parcel's DISTANCE from
  // the crater — not in its height above it, which was fine for a vertical
  // column and wrong the moment fallout started draining down the flanks:
  // height alone puts a parcel four hundred metres out along the cone at zero
  // separation from the vent and lights the whole lower flank as if it were
  // sitting in the crater. The cosine weight stays: the UNDERSIDE of a parcel
  // takes the light and the top does not, which is the whole reason the belly
  // of a column glows and the cap does not.
  float dv = length(vWorld - uOrigin) / max(uGlowFall, 1.0);
  float fall = 1.0 / (1.0 + dv * dv);
  float facing = clamp(-N.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 glow = uEmber * (uVentGlow * fall * (0.25 + 0.75 * facing));

  // Aerial perspective on the ash, transmittance only on the glow: the emitted
  // half must not pick up the in-scatter twice.
  vec3 col = applyAerial(lit, vViewDist, eye) + glow * vfxAerialT(vViewDist, eye);

  gl_FragColor = vec4(col * a, a);
}
`;

export interface PlumeOpts {
  renderOrder: number;
  count: number;
}

/**
 * World-anchored eruption column. Inert (and not drawn) until `place` is given
 * a caldera position, so a world with no volcano costs one hidden mesh.
 */
export class Plume {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private max: number;
  private placed = false;
  private origin = new THREE.Vector3();
  /** Radius of the drawn column, for the cheap CPU visibility gate. */
  private reach = 1;
  /** Typical parcel diameter in metres, for the fill-rate budget. */
  private parcel = 100;

  constructor(o: PlumeOpts, atlas: THREE.Texture, tile: number) {
    this.max = o.count;
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
        3,
      ),
    );
    this.geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);

    const seed = new Float32Array(o.count * 4);
    for (let i = 0; i < o.count * 4; i++) seed[i] = Math.random();
    this.geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    this.geo.instanceCount = 0;
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...vfxUniforms(),
        ...aerialUniforms(),
        uAtlas: { value: atlas },
        uTile: { value: tileUV(tile) },
        uOrigin: { value: new THREE.Vector3(0, -1e5, 0) },
        uVentR: { value: 130 },
        uHeight: { value: 1500 },
        uSpread: { value: 2.6 },
        // WIND SHEAR. 26 gave a two-kilometre column a hundred-metre lean in a
        // four-metre wind — a straight vertical cone, which is what the vale
        // review called it. A real column bends over hard once it is out of the
        // buoyant jet; the lean is integrated over the parcel's age, so it
        // accumulates with altitude and the shaft curves instead of tilting.
        uShear: { value: 62 },
        uLife: { value: 150 },
        uSize: { value: new THREE.Vector2(70, 170) },
        uDensity: { value: 0.55 },
        // Fallout. Two fifths of the population, because the flank sheet is
        // what is actually in frame from anywhere near the mountain.
        uPallFrac: { value: 0.52 },
        uPallLife: { value: 190 },
        // Lift above the flank, in vent radii. This is a hugging offset, not a
        // buoyant climb; see the vertex stage.
        uPallRise: { value: 1.0 },
        uPallSink: { value: 0.85 },
        uPallSlope: { value: 1.35 },
        uPallBias: { value: 0.85 },
        uPallR0: { value: 160 },
        uPallOp: { value: 0.34 },
        // Basalt-dark, not ash-pale: the shaft is the silhouette.
        uAsh: { value: new THREE.Color(0.17, 0.145, 0.125) },
        // #8a7f72 — the ash mid-value the bible names, not the sulphur band.
        // The aerial in-scatter is what dissolves the cap into the horizon, and
        // an albedo that reaches for the sky colour as well double-counts it and
        // leaves the column with no silhouette at all.
        uCap: { value: new THREE.Color(0.30, 0.258, 0.205) },
        // Ash on a flank: desaturated, mid-value, the dominant palette grey.
        uPallCol: { value: new THREE.Color(0.33, 0.295, 0.255) },
        // #c4551f in linear. Driven above 1 so it survives the tone curve, but
        // not so far that the belly of the column clips to a field of orange
        // discs — the vent is a rim light on the ash, not a second sun.
        uEmber: { value: new THREE.Color(1.15, 0.28, 0.055) },
        uVentGlow: { value: 1.0 },
        uGlowFall: { value: 260 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      premultipliedAlpha: true,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.renderOrder;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    this.mesh.name = 'vfx:plume';
  }

  get anchored(): boolean {
    return this.placed;
  }

  get position(): THREE.Vector3 {
    return this.origin;
  }

  /**
   * Anchor the column on a caldera.
   *
   * @param at     World position of the vent, at the crater floor.
   * @param ventR  Radius of the crater in metres; sets the base of the column.
   * @param height How far the column climbs before it stalls and spreads.
   * @param lipR   Crater lip radius; where the flank fallout starts.
   * @param slope  Metres of radius per metre of descent on the flank, measured
   *               off the heightfield. The fallout sheet tracks this, so it
   *               drapes whatever cone the world generator actually built.
   * @param drop   How far below the vent the flank runs before it flattens out.
   */
  place(
    at: THREE.Vector3,
    ventR: number,
    height: number,
    lipR: number,
    slope: number,
    drop: number,
  ): void {
    this.origin.copy(at);
    (this.mat.uniforms.uOrigin.value as THREE.Vector3).copy(at);
    this.mat.uniforms.uVentR.value = ventR;
    this.mat.uniforms.uHeight.value = height;
    // Parcel diameter. Was 0.85-2.0 vent radii, i.e. two-hundred-metre billows:
    // at that size a fill-rate budget can only afford a hundred or so of them
    // and the column stops being a mass and becomes a scatter of separate
    // discs, each one individually legible as a sprite. Halving the parcel
    // quadruples the count for the same cost, which is what buys coherence.
    // Halved again, to ventR*0.24..0.60. The column's coherence is bought by
    // OVERLAP COUNT, not by parcel size: at a fixed fill-rate budget the number
    // of parcels goes as 1/size^2, so cutting the parcel in half quadruples the
    // population for the same cost and quadruples the number of silhouettes any
    // one gap has to be covered by. A dozen large discs will always read as a
    // dozen discs, however they are shaded.
    this.mat.uniforms.uSize.value = new THREE.Vector2(ventR * 0.07, ventR * 0.20);
    // The ember reach. At a tenth of the column height the vent light died out
    // inside the crater and no part of the plume that is ever in frame carried
    // it; the bottom fifth of the shaft is the part that should glow.
    this.mat.uniforms.uGlowFall.value = Math.max(200, height * 0.22);
    this.mat.uniforms.uPallR0.value = lipR;
    const sk = THREE.MathUtils.clamp(drop / Math.max(height, 1), 0.15, 1.2);
    this.mat.uniforms.uPallSlope.value = THREE.MathUtils.clamp(slope, 1.0, 4.0);
    // The sheet reaches the foot of the cone and no further.
    this.mat.uniforms.uPallSink.value = sk;
    this.reach = Math.max(ventR * 4 + height, lipR + drop * slope);
    // Mean of the size range times the mean of the vertex stage's growth ramp.
    // Mean over BOTH populations: the column's parcels at full size and the
    // fallout sheet's at 0.55 of it, weighted by uPallFrac.
    this.parcel = ventR * 0.105 * 1.65;
    this.placed = true;
  }

  /**
   * Instance count that keeps the column inside a fill-rate budget.
   *
   * These parcels are hundreds of metres across. Seen from the far side of the
   * map that is a 100-pixel sprite and a thousand of them costs nothing; seen
   * from the flank of the mountain the same sprite is 700 pixels and the same
   * thousand is two hundred screens of blended overdraw — the difference
   * between 30 fps and 3. Solving for a constant number of DRAWN PIXELS instead
   * of a constant number of parcels keeps the cost flat from any vantage, and
   * the image degrades the right way: close up you see a few enormous billows,
   * which is what a plume looks like from underneath anyway.
   *
   * @param screenPx viewport area in pixels.
   * @param overdraw how many full screens of blended fill the column may use.
   */
  budgetCount(dist: number, proj: number, screenPx: number, overdraw: number): number {
    const px = (this.parcel * proj) / Math.max(dist, 1);
    const area = Math.max(px * px, 1);
    return THREE.MathUtils.clamp((screenPx * overdraw) / area, 24, this.max);
  }

  /**
   * @param density peak opacity of a parcel; 0 hides the column entirely.
   * @param glow    vent emitter strength.
   */
  set(density: number, glow: number, count: number): void {
    this.mat.uniforms.uDensity.value = density;
    this.mat.uniforms.uVentGlow.value = glow;
    const c = Math.min(this.max, Math.max(0, Math.floor(count)));
    this.geo.instanceCount = c;
    this.mesh.visible = this.placed && c > 0 && density > 0.002;
  }

  /**
   * Cheap CPU gate. The column is a single draw of large, heavily overdrawn
   * quads; it is worth one distance-and-halfspace test per frame to skip it
   * when the mountain is behind the camera or over the horizon.
   */
  inView(camPos: THREE.Vector3, camFwd: THREE.Vector3, maxDist: number): boolean {
    if (!this.placed) return false;
    const dx = this.origin.x - camPos.x;
    const dz = this.origin.z - camPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > maxDist + this.reach) return false;
    // Behind the eye, and further away than the column is wide: cannot be on
    // screen at any field of view.
    const ahead = dx * camFwd.x + dz * camFwd.z;
    return ahead > -this.reach;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
