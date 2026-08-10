import * as THREE from 'three';
import type { IMaterials } from '../core/contracts';
import { AERIAL_GLSL, aerialUniforms } from '../sky/Atmosphere';
import { applyPBR } from '../mat/Materials';
import { PREPASS_FRAG, PREPASS_VERT } from '../render/shaders';

/**
 * Creature shading.
 *
 * One uber-material over MeshStandardMaterial rather than a bespoke shader per
 * species: that keeps three's shadow, skinning, IBL and prepass paths intact
 * (a hand-rolled ShaderMaterial would have to reimplement all four), while the
 * two things that make creature skin *not* look like rock — thin-film
 * iridescence on chitin and forward subsurface scattering through membranes,
 * ears and gasbags — are injected where the standard model ends.
 *
 * The sun is read from the shared aerial uniform block, never from a light this
 * module owns, so creature lighting and the sky agree by construction. The same
 * block supplies applyAerial, so a glassjaw at 300 m fades into exactly the
 * haze the terrain behind it fades into.
 */

export type ActorMatKind = 'chitin' | 'hide' | 'membrane' | 'skin' | 'cloth' | 'shell' | 'metal';

export interface ActorMaterialOpts {
  kind: ActorMatKind;
  /** Base tint multiplied over the synthesized albedo. */
  color: THREE.ColorRepresentation;
  /**
   * Anisotropic sheen gain. The lobe runs across the sweep axis carried in
   * aTan, so a leg picks up a specular line down its length and a rim along
   * both edges — which is the only thing that separates a thin dark limb from
   * a bright background without making it thicker.
   */
  sheen?: number;
  /** Sheen tint. Defaults to the chitin highlight from the palette. */
  sheenColor?: THREE.ColorRepresentation;
  /** Global iridescence gain; the per-vertex mask modulates it. */
  irid?: number;
  /** Global subsurface gain. */
  sss?: number;
  /** Colour light takes on when it passes through the surface. */
  sssColor?: THREE.ColorRepresentation;
  /** Extra roughness bias, added to the ARM map. */
  rough?: number;
  metal?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  doubleSided?: boolean;
  /** Metres of surface per texture repeat. */
  texel?: number;
}

/** Which synthesized PBR set backs each material kind. */
const SET_FOR: Record<ActorMatKind, string> = {
  chitin: 'chitin',
  hide: 'bark_fungal',
  // Plaster, not chitin. The chitin set is a lacquered elytron: hard lamellar
  // banding in the normal map and a metallic term in the ARM. Stretched over a
  // skerrin's five-metre gasbag that banding is what read as corrugated pewter.
  // A membrane wants fine dermal grain and nothing else — the transmission
  // block below is what is supposed to be carrying the surface.
  membrane: 'plaster',
  skin: 'plaster',
  cloth: 'cloth',
  shell: 'bone',
  metal: 'bronze',
};

/**
 * Frame-varying state every creature material shares. One object, referenced by
 * every compiled program, so the actor system writes it once per frame.
 *
 * `uPixelWorld` is the world size of one screen pixel at one metre of depth:
 * 2*tan(fovY/2)/heightInPixels. `uWaterY` is the sea level, or far below the
 * world when there is no water system, which disables the wet-line branch.
 *
 * `uGroundBounce` is the irradiance a downward-facing surface receives from the
 * ground — see FRAG_BOUNCE. It exists because the shared IBL does not contain
 * one: the atmosphere prefilters the sky DOME ONLY (Atmosphere.captureEnv), so
 * every direction below the horizon in `scene.environment` is empty. Terrain
 * never notices, because terrain faces up. A creature is the one thing in the
 * scene with a large downward-facing surface area — a skerrin's whole underside, a
 * drell's flank in its own shade, the underside of a fenwalker's dome and all
 * six of its legs — and with an empty lower hemisphere every one of those
 * crushes to black. That is not shading, it is a missing light.
 *
 * `uDitherPhase` advances by the golden ratio every frame and drives the
 * impostor's hashed coverage (see IMPOSTOR_FRAG). A stipple that is fixed in
 * screen space reads as a checkerboard stencil; one that rotates is noise TAA
 * integrates away.
 */
const frame = {
  uPixelWorld: { value: 0.001 },
  uWaterY: { value: -1e6 },
  uGroundBounce: { value: new THREE.Color(0, 0, 0) },
  uDitherPhase: { value: 0 },
};

/** Shared frame uniforms — same object for every actor program. */
export function actorFrameUniforms(): typeof frame {
  return frame;
}

export function setActorFrame(pixelWorld: number, waterY: number, bounce: THREE.Color): void {
  frame.uPixelWorld.value = pixelWorld;
  frame.uWaterY.value = waterY;
  (frame.uGroundBounce.value as THREE.Color).copy(bounce);
  frame.uDitherPhase.value = (frame.uDitherPhase.value + 0.6180339887) % 1;
}

const VERT_PARS = /* glsl */ `
attribute vec3 aMask;
attribute vec4 aTan;
varying vec3 vMask;
varying vec3 vWPos;
varying vec4 vTanW;
uniform float uPixelWorld;
uniform float uMinPx;
`;

/**
 * Sub-pixel limb rescue.
 *
 * A fenwalker's shin is 17 cm across; at 150 m one pixel spans 15 cm, so the
 * leg lands under the Nyquist limit and the rasteriser can only ever produce an
 * un-antialiased one-pixel polyline that stair-steps as it moves. Thickening the
 * geometry enough to fix that at 150 m would make the animal look like it stands
 * on tree trunks up close.
 *
 * So the dilation is done in the vertex shader against the actual projected
 * size: push each vertex out along its own skinned normal by however much is
 * needed for the feature it belongs to to cover `uMinPx` pixels of radius, and
 * no further. On a torso the term is identically zero — a two-metre body is
 * never near a pixel — and on a leg tip at 200 m it is a few centimetres. The
 * silhouette therefore stays inside the MSAA/TAA resolve as real geometry with
 * real coverage, instead of a line that either hits a pixel centre or vanishes.
 */
/**
 * Silhouette radius, in pixels, the dilation below guarantees. Shared by the
 * shaded and prepass paths — if the two ever disagree the G-buffer no longer
 * describes the surface that was shaded, which is the whole bug it exists to
 * avoid.
 */
export const ACTOR_MIN_PX = 1.3;

const DILATE_BODY = /* glsl */ `
  // objectNormal has already been through <skinnormal_vertex> at this point;
  // skinMatrix is still in scope, and the sweep axis has to follow the same
  // deformation or the sheen would slide across a bending limb.
  vec3 dn = objectNormal;
  float dl = length( dn );
  if ( dl > 1e-4 ) {
    dn /= dl;
    float depth = -( modelViewMatrix * vec4( transformed, 1.0 ) ).z;
    // Half-width one pixel would occupy at this depth, in WORLD metres.
    float want = uMinPx * uPixelWorld * max( depth, 0.1 );
    // ...but transformed and aTan.w are in OBJECT space, and the group carries
    // the species' size variation (0.85-1.35). Comparing a world length against
    // an object radius over-dilated a large individual by its own scale factor,
    // which is worst exactly where it shows: on the biggest animals.
    float oscale = max( 1e-4, length( modelMatrix[ 0 ].xyz ) );
    // CEILING. The term exists to keep a sub-pixel feature inside the resolve,
    // not to inflate it: unbounded, 'want' grows linearly with depth, so a silt
    // strider's 17 cm shin became an 85 cm tube at 250 m and a 1.2 m tube at
    // 900 m. Past that point the extra radius is pure extruded silhouette shell
    // — normals swung to face outward, UVs stretched over nothing — which is
    // exactly the "untextured flat-value silhouette" read the review measured
    // on the hero strider, and it is the LOD tier's job to fix, not this one's.
    // One own-radius of growth doubles a limb's coverage and stops there.
    float rad = max( aTan.w, 0.01 );
    transformed += dn * clamp( want / oscale - aTan.w, 0.0, rad );
  }
`;

const VERT_DILATE = /* glsl */ `
#include <skinning_vertex>
{
${DILATE_BODY}
  vec3 tw = aTan.xyz;
  #ifdef USE_SKINNING
    tw = ( skinMatrix * vec4( aTan.xyz, 0.0 ) ).xyz;
  #endif
  vTanW = vec4( ( modelMatrix * vec4( tw, 0.0 ) ).xyz, aTan.w );
}
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vMask;
varying vec3 vWPos;
varying vec4 vTanW;
uniform float uIrid;
uniform float uSSS;
uniform vec3  uSSSColor;
uniform float uFilm;
uniform float uSheen;
uniform vec3  uSheenColor;
uniform float uWaterY;
uniform vec3  uGroundBounce;

/**
 * Thin-film interference, approximated with a cosine triple rather than a
 * spectral integral. Optical path difference scales with the inverse cosine of
 * the refracted angle, so the hue sweeps toward blue at grazing incidence,
 * which is the whole reason a beetle shell reads as chitin and not plastic.
 */
vec3 thinFilm(float ndv, float thickness) {
  float opd = thickness / max(ndv, 0.08);
  return 0.5 + 0.5 * cos(6.28318 * (opd * vec3(1.0, 0.813, 0.667) + vec3(0.0, 0.33, 0.67)));
}

/**
 * Chroma discipline for ADDITIVE terms.
 *
 * "Bioluminescence and lava are the only things allowed to be vivid" is not a
 * statement about albedo, it is a statement about pixels — and every sheen, rim
 * and iridescence lobe here is driven by uAerialSkyColor, which at mid-morning
 * under cloud is the most chromatic illuminant in the frame. Multiplied onto a
 * grazing limb (where the Fresnel rim is near unity down the whole cylinder,
 * because the limb IS all silhouette) it delivered the review's slate-blue silt
 * strider legs on a chitin albedo that never left the palette. The hue survives
 * as a tint; the chroma does not survive as a colour.
 */
vec3 ashen(vec3 c, float k) {
  return mix(c, vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), k);
}

/**
 * Internal density of a gas-filled body, in world space.
 *
 * A skerrin bell is not a shell, it is a sack of float bladders, and the thing
 * that makes one read as a volume rather than as a flat translucent disc is that
 * you can see the structure of the FAR wall through the near one. Sampled twice
 * along the view ray — once at the surface, once a bell-diameter behind it —
 * this gives that parallax for two sin-triples, and it slides correctly as
 * either the animal or the camera moves.
 */
float gasSac(vec3 p) {
  float n = sin(p.x * 1.7) * sin(p.y * 2.3 + 1.1) * sin(p.z * 1.9 + 2.2);
  n += 0.55 * sin(p.x * 4.1 + 0.7) * sin(p.y * 5.3) * sin(p.z * 4.7 + 1.7);
  return clamp(0.5 + 0.34 * n, 0.0, 1.0);
}
`;

/**
 * Injected in place of <lights_physical_fragment>, where `material.roughness`
 * exists and has not yet been consumed by a BRDF.
 *
 * A carapace is not one roughness. The top of a shell is polished by rain,
 * spray and the animal's own grooming; its underside is dragged through sand
 * and grit all day. Authoring that as a per-species roughness map would be
 * seven maps that all say the same thing, because the rule is not per-species —
 * it is which way the surface faces. Driving it off the shaded world normal
 * gives every creature in the bestiary a glossy back and a scuffed belly for one
 * dot product, and it is what stops a mudcrab's shell reading as a single
 * lambertian dome with one uniform sheen over the whole of it.
 */
const FRAG_ROUGH = /* glsl */ `
#include <lights_physical_fragment>
{
  vec3 rNw = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
  float down = clamp( 0.5 - 0.5 * rNw.y, 0.0, 1.0 );
  material.roughness = clamp( material.roughness * ( 1.0 + 0.55 * down * down ), 0.05, 1.0 );
}
`;

/**
 * Injected after <lights_fragment_maps>: BOTH hemispheres of the ambient.
 *
 * `scene.environment` is a 64 px PMREM of the sky DOME ONLY (see
 * Atmosphere.captureEnv), and that has two consequences a creature — unlike
 * terrain, which faces up and is lit by its own analytic sky term — cannot
 * survive:
 *
 *   below   there is no radiance from any direction under the horizon at all,
 *           so every downward-facing surface is lit by whatever the sun still
 *           reaches and nothing else. On an animal that is most of the body:
 *           the belly, the underside of a skerrin's bell, the shaded flank of a
 *           drell, the whole length of six fenwalker legs.
 *   above   the probe is the only upper-hemisphere light the standard model
 *           has, and at a low sun it delivers a small fraction of the
 *           irradiance the atmosphere itself publishes for that same sky. That
 *           is what put three lod-0 netches into the dusk frame as pure black
 *           cut-outs over mid-value ground: measured body luminance 26-30
 *           against 110 on the ash beside them, with the only value on the
 *           whole animal on its UNDERSIDE, where the ground-bounce term below
 *           was the sole light reaching it. An animal darker on top than
 *           underneath, under an open sky, is not shading — it is a missing
 *           light, and it is the same missing light in both directions.
 *
 * So the ambient hemisphere is reconstructed here from the quantity the sky
 * already publishes. `uAerialSkyColor` is documented as hemispheric IRRADIANCE,
 * which is exactly the unit `irradiance` carries at this point, and a Lambertian
 * under a uniform sky of that irradiance with an infinite ground below it
 * receives E*(1 + N.y)/2. That is the floor: it TOPS UP whatever the probe
 * already delivered rather than adding to it, so a bright midday env that
 * already carries the full sky is untouched bit for bit and only the shortfall
 * is made good. Double counting is impossible by construction.
 *
 * `iblIrradiance` has to be in the comparison, and that is why this sits after
 * <lights_fragment_maps> rather than after <lights_fragment_begin>: on the
 * physical model the env probe's diffuse arrives through RE_IndirectSpecular's
 * cosine-weighted term, not through `irradiance`, so a floor applied before the
 * probe was sampled would double-count it exactly.
 *
 * Both terms go into `irradiance` rather than onto the final colour, so they
 * pass through the same Lambert BRDF, the same albedo and the same AO/GTAO
 * attenuation as every other ambient contribution, and neither can brighten a
 * metal or leak into the specular lobe.
 */
const FRAG_BOUNCE = /* glsl */ `
#include <lights_fragment_maps>
{
  vec3 bNw = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
  // Cosine-weighted fraction of the UPPER hemisphere this normal sees.
  float up = clamp( 0.5 + 0.5 * bNw.y, 0.0, 1.0 );
  irradiance += max( vec3( 0.0 ), uAerialSkyColor * up - ( irradiance + iblIrradiance ) );
  // ...and the lower one, which the probe does not contain at all. Squared, so
  // a surface facing straight up gains nothing and only genuinely down-facing
  // geometry collects the ground.
  float dw = 1.0 - up;
  irradiance += uGroundBounce * ( dw * dw );
}
`;

/**
 * Injected in place of <opaque_fragment>. Everything the standard model
 * computed is in `outgoingLight`; we add the two terms it cannot express and
 * then hand the result to the shared aerial integral.
 */
const FRAG_TAIL = /* glsl */ `
// UNCONDITIONAL, where three's own <opaque_fragment> guards this with #ifdef
// OPAQUE. A creature is opaque — the membrane branch below expresses
// translucency as light ADDED to outgoingLight, never as coverage — so there is
// no path in this shader that has a meaningful sub-unit alpha to preserve. The
// guard would only ever fire if someone flagged an actor material transparent,
// and the result of that is precisely the defect this line now forecloses: the
// body silently starts compositing whatever is behind it. Writing 1 here means
// the flag can never turn a creature into a ghost, only change which pass it
// draws in.
  diffuseColor.a = 1.0;
{
  vec3 V = normalize(cameraPosition - vWPos);
  // 'normal' is the view-space, normal-mapped, side-corrected normal the
  // standard model just lit with; rotating it back out by the view matrix is
  // what lets the sun direction stay in the one world-space form the sky
  // publishes.
  vec3 Nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  vec3 L = normalize(uAerialSunDir);
  float ndv = clamp(dot(Nw, V), 0.0, 1.0);

  #if ACTOR_MEMBRANE
  {
    // ---------------------------------------------------------- membrane
    //
    // A skerrin is a hollow sack of gas inside a wall a few centimetres thick.
    // Almost nothing you see on it is reflected light; it is light that went in
    // somewhere else and came back out here, and the surface shading model has
    // no term for that at all. Adding a polite second-order tint on top of the
    // diffuse — which is what the generic SSS block does, and it multiplies by
    // the albedo, so the glow can never be brighter than the grey it is tinting
    // — is exactly how you get a grey balloon.
    //
    // So this term is not GATED on the albedo. The interior colour is the base
    // and the body's own colour is added into it, rather than the other way
    // round, which is what lets the transmission be brighter than the surface
    // it is coming through. It is then added over the top:
    //
    //   back  the sun behind the animal, straight through the gas. This is the
    //         lantern read, and it wants a wide lobe — the whole body lights
    //         up, not a hot spot.
    //   rim   at grazing angles the sight line runs ALONG the wall instead of
    //         through it, so the path length in scattering material is longest
    //         exactly at the silhouette. That is the bright edge every real
    //         jellyfish has, and it is what separates the body from the sky.
    //   sky   the hemisphere behind it, so the animal never goes flat black
    //         when the sun is elsewhere.
    float thick = vMask.x;
    // Internal structure, seen through the wall — see gasSac. The near wall's
    // density and the far wall's, half a body apart along the sight line, so the
    // two slide against each other with the view and the bell reads as a volume
    // with something inside it rather than as a flat translucent dome.
    float sacN = gasSac(vWPos * 0.85);
    float sacF = gasSac((vWPos - V * 2.6) * 0.85);
    // INTERNAL STRUCTURE HAS TO BE SMALLER THAN THE BODY IT IS INSIDE, and this
    // weight is the whole of the skerrin's "flat unlit facet across the top".
    //
    // gasSac's lowest harmonic has a period of about 3.7 m. Over a five-metre gas
    // sack that is structure. Over anything smaller it does not vary at all — and
    // a field that does not vary across a part is not structure, it is one
    // multiplier applied to the whole of that part. The dorsal crest is 1.4 m
    // tall, so it sampled a single value out of a term that ranged 0.52 to 1.18:
    // measured, the fin rendered at a dead-uniform 140/255 against a bell at
    // 230/255 with a hard edge between them, and no geometry or material change
    // could touch it because the two parts were simply being multiplied by
    // different constants. Forcing gas to a constant made fin and bell match to
    // within a few counts, which is the proof.
    //
    // So the modulation fades out with the local feature radius aTan.w already
    // carries — 2.5 on the bell, 1.0 on a sheet, a few centimetres on a tentacle.
    // A part gets internal structure once it is big enough to contain any, and
    // below that it keeps the body's own average instead of a random sample of a
    // field it cannot resolve. Centred just under 1 rather than on 0.85, so the
    // term redistributes brightness within the bell instead of also docking every
    // part of the animal 15% of it.
    float sacW = smoothstep(0.7, 2.2, vTanW.w);
    float gas = 0.92 + (mix(sacN, sacF, 0.55) - 0.5) * 0.72 * sacW;
    float back = pow(clamp(dot(V, -L), 0.0, 1.0), 2.6);
    float rim = pow(1.0 - ndv, 2.2);
    // TWO-SIDED coupling, and this is the term that was missing.
    //
    // 'back' above is a VIEW test — it asks whether the eye is looking down-sun —
    // and 'wrap' used to be dot(Nw, L), a LIT-SIDE test. Neither of them asks the
    // only question that decides whether light comes through a sheet: is the sun
    // on the FAR side of it. Because the standard model has already flipped the
    // normal toward the camera on a double-sided surface, Nw always faces the
    // eye, so -dot(Nw, L) is exactly "the sun is behind this wall" — and it is
    // large over the whole sheet, not only at its rim.
    //
    // Without it a backlit membrane got its entire face-on transmission from a
    // 0.05 coefficient, while the standard model gave the same fragment no
    // diffuse at all (N faces the eye, the sun is behind it), so the underside of
    // a five-metre wing at mid-morning resolved to an opaque tarp. The wrap keeps
    // it continuous through the terminator instead of hard-cutting at grazing.
    float through = clamp((-dot(Nw, L) + 0.35) / 1.35, 0.0, 1.0);
    // Most of the transmitted light is the body's own colour, warmed toward the
    // interior hue. Weighted this way round on purpose: the palette allows
    // bioluminescent teal, but a five-metre animal rendered ENTIRELY in it is a
    // flat mint decal with no form left — the saturated colour has to be the
    // accent on the glow, not the glow itself.
    vec3 tint = mix(uSSSColor * (0.35 + 2.1 * diffuseColor.rgb), uSSSColor, 0.30);
    // Pulled back toward its own luminance. Ashlands is a desaturated world
    // with two licensed exceptions, and a five-metre animal in full-strength
    // bioluminescent teal does not read as one of them — it reads as a prop
    // from a different game. The hue survives; the chroma is halved.
    tint = mix(vec3(dot(tint, vec3(0.28, 0.60, 0.12))), tint, 0.52);
    // Transmission-dominant when the sun is behind, rim-dominant otherwise.
    //
    // 'through' carries the sheet; 'back' boosts it when the eye is also looking
    // down-sun (the forward-scatter peak); the rim terms keep the silhouette hot
    // at grazing angles. The face-on coefficient was 0.05 and is now 0.10-0.44
    // over the backlit range, which is the difference between a tarp and a
    // lantern. Front-lit it collapses to ~0.03 and the diffuse still describes
    // the form, so nothing that already read correctly changes.
    float amount = uSSS * thick * gas * (through * (0.10 + 0.34 * back) + rim * rim * 0.14 + back * rim * 0.20);
    // Capped, and the ceiling matters more than the gain now that the face-on
    // term is real: a fully backlit five-metre bell against a bright sky wants to
    // read as brighter than the surface it is made of and DARKER than the sky
    // behind it. Past that it stops being a lantern and becomes a white hole with
    // no form left in it — the same failure as the tarp, in the other direction.
    // Chroma discipline, and it has to scale with the term rather than be a
    // fixed pullback. Transmitted light is the illuminant filtered by the wall,
    // so the harder the wall is driven the closer the result sits to the
    // illuminant and the further from the pigment — and the Ashlands illuminant
    // is ash-warm, not saturated. Without it, raising the face-on lobe turns a
    // ash shrike's wing into the most saturated object in a frame whose palette
    // licenses exactly two of those, and a wing is not one of them.
    vec3 lit = mix(tint, vec3(dot(tint, vec3(0.28, 0.60, 0.12))), clamp(amount * 1.6, 0.0, 0.65));
    outgoingLight += min(uAerialSunColor * lit * amount, vec3(0.62));
    // Ambient through the wall — and at a low sun this is not a floor, it is the
    // entire animal.
    //
    // Every term above scales with uAerialSunColor. Measured at the dusk shot
    // that is 0.048 while the sky is 0.141: the sun has stopped being the
    // illuminant and the DOME is the light source. A transmission model that only
    // knows how to pass SUNLIGHT therefore has nothing left to work with, the
    // body falls back to albedo x ambient x AO, and for a 6% grey-brown albedo
    // under ambient occlusion that is the black cut-out the review measured —
    // three lod-0 netches at 26-30/255 over ash at 110. The face-on coefficient
    // was 0.05, i.e. a fortieth of the sky, which is a number for a rescue floor
    // and not for an illuminant.
    //
    // A thin-walled sack of gas under a bright overcast or a post-sunset sky is a
    // pale glowing thing, not a dark one; these coefficients are what say so. The
    // daylight case cannot run away with it, because the highlight ceiling below
    // is itself scaled by the sky and so tightens by exactly as much as this
    // loosens. Added after the BRDF rather than into the irradiance chain, correctly:
    // this is light that came THROUGH the body, so the ambient occlusion of the
    // surface it leaves by has no claim on it.
    outgoingLight += (uAerialSkyColor + uGroundBounce * 0.6) * tint *
                     (uSSS * thick * (0.13 + 0.20 * rim + 0.13 * through));
    // The wall itself is thin where the light comes through, so the diffuse
    // under it thins out too; without this the transmission is sitting on a
    // fully opaque body and adds up to "grey plus glow" rather than "glow".
    outgoingLight *= mix(1.0, 0.88, thick * clamp(rim + back, 0.0, 1.0));

    // ----------------------------------------------- thin-film clearcoat
    //
    // A skerrin's bell is wet. The standard lobe underneath it is at roughness
    // 0.86 — deliberately, so the five-metre sack does not read as pewter — but
    // that leaves the animal with no specular event anywhere on it, which is the
    // review's "no specular highlight" and half of why it reads as a flat mint
    // decal. A clearcoat is the correct place for the sharp lobe: one narrow
    // GGX at roughness 0.15 over the top of the matte wall, so the highlight is
    // a small hard glint on a soft body instead of a shell-wide sheen.
    vec3 Hc = normalize(L + V);
    float noh = clamp(dot(Nw, Hc), 0.0, 1.0);
    const float CA = 0.15 * 0.15 * 0.15 * 0.15;
    float dd = noh * noh * (CA - 1.0) + 1.0;
    float lobe = CA / (3.14159 * dd * dd);
    float fr = 0.03 + 0.97 * pow(1.0 - clamp(dot(V, Hc), 0.0, 1.0), 5.0);
    float litC = clamp(dot(Nw, L), 0.0, 1.0);
    // Thin-film over the coat, desaturated hard: the palette allows an oil-film
    // hue shift on a highlight, never a saturated one.
    vec3 coat = ashen(mix(vec3(1.0), thinFilm(ndv, uFilm * 0.7), 0.30), 0.35);
    outgoingLight += min(uAerialSunColor * coat * min(lobe * fr * litC, 1.6), vec3(0.42));
  }
  #elif ACTOR_SSS
  {
    // Forward scatter: light that entered the far side and left toward the eye.
    // The normal distortion is what makes a thin membrane glow along the whole
    // sheet instead of only where it is edge-on.
    vec3 Ls = normalize(-L + Nw * 0.45);
    float fwd = pow(clamp(dot(V, Ls), 0.0, 1.0), 4.0);
    float wrap = clamp((dot(Nw, L) + 0.55) / 1.55, 0.0, 1.0);
    float thick = vMask.x;
    // Grazing angles see a longer path through the surface layer, so ears and
    // the rim of a skerrin bell light up while the flat of the body does not.
    // Coefficients are deliberately small: transmission is a second-order term
    // over the diffuse, and pushed any harder it turns grey Cindren skin pink.
    float rim = pow(1.0 - ndv, 2.5);
    float amount = uSSS * thick * (fwd * 0.55 + wrap * 0.10 + rim * 0.18);
    // CEILING and chroma pullback, and this is the whole of the "hot orange
    // specks punched through the haze" defect.
    //
    // The membrane branch above has had both since it was written; this one had
    // neither, and the omission only bites when the illuminant is strong AND
    // chromatic — which is precisely dawn. The lobe is a fourth-power forward-
    // scatter lobe, so at a low sun looking down-sun it saturates to 1 over a
    // whole flank, and the term is then multiplied by a sun colour that at 6:45
    // carries several units of radiance in red and a fraction in blue. A
    // six-pixel forager acquired a 45%-brighter, 80%-more-saturated core than
    // any ground beside it, with the fog resolve — which is shared, and provably
    // correct: everything here goes through the one applyAerial below — quite
    // unable to remove light that was added after extinction was applied to the
    // surface. Cap it at what a second-order term is allowed to contribute, and
    // desaturate in proportion to how hard it is driven, exactly as the membrane
    // does: transmitted light is the illuminant filtered by the wall, and the
    // Ashlands illuminant is ash-warm, not vivid.
    vec3 tintS = mix(uSSSColor, vec3(dot(uSSSColor, vec3(0.28, 0.60, 0.12))), clamp(amount * 2.4, 0.0, 0.6));
    outgoingLight += min(uAerialSunColor * tintS * amount * diffuseColor.rgb, vec3(0.16));
    outgoingLight += uAerialSkyColor * tintS * diffuseColor.rgb * (uSSS * thick * 0.10);
  }
  #endif

  #if ACTOR_IRID
  {
    // Chitin is an oil film over a dark shell, not a soap bubble: the sheen is
    // confined to grazing angles by a fifth-power Fresnel and desaturated
    // toward white, so it reads as a shift in the specular tint rather than as
    // a saturated colour the palette does not allow.
    float f = pow(1.0 - ndv, 5.0);
    // Desaturated harder than before and capped. At a bright dusk the sky term
    // alone was enough to put a saturated blue patch on a carapace, and the
    // palette allows vivid colour on bioluminescence and lava only.
    vec3 film = mix(vec3(1.0), thinFilm(ndv, uFilm), 0.35);
    float lit = clamp(dot(Nw, L), 0.0, 1.0);
    vec3 sheenIrid = film * (uIrid * vMask.y * f) *
                     (uAerialSunColor * lit * 0.08 + ashen(uAerialSkyColor, 0.6) * 0.16);
    outgoingLight += min(sheenIrid, vec3(0.18));
  }
  #endif

  #if ACTOR_SHEEN
  {
    // Anisotropic chitin sheen, Kajiya-Kay against the sweep axis.
    //
    // A leg is a cylinder, so its highlight is not a point but a line running
    // the length of the limb, and its edges catch a rim from the sky at every
    // orientation. That is the entire difference between a limb that reads as a
    // shaded volume and one that reads as a black scratch on the image — and it
    // costs nothing in silhouette, which is why it works at distances where
    // more geometry would not.
    float aniso = 0.0;
    float tl = length(vTanW.xyz);
    if (tl > 0.5) {
      vec3 T = vTanW.xyz / tl;
      vec3 H = normalize(L + V);
      float dth = dot(T, H);
      aniso = pow(sqrt(max(0.0, 1.0 - dth * dth)), 30.0);
    }
    // Isotropic rim. Deliberately a high power: on a limb, ndv is grazing across
    // most of its width, so a soft falloff floods the whole cylinder white
    // instead of drawing its edge. Fifth power keeps it to the silhouette,
    // which is the only place it carries information.
    float rim = pow(1.0 - ndv, 5.0);
    float lit = clamp(dot(Nw, L) * 0.5 + 0.5, 0.0, 1.0);
    // The sky term is desaturated before it is used, not after. A limb is all
    // silhouette — ndv is grazing across most of its width — so the rim term is near
    // unity down the whole cylinder and this lobe, not the albedo, is what sets
    // the limb's HUE. Left chromatic it painted the strider's chitin legs the
    // colour of the sky, which under morning cloud is slate blue, and no colour
    // in this palette is blue.
    vec3 sheen = uSheenColor * uSheen *
                 (uAerialSunColor * (aniso * 0.09 + rim * lit * 0.05) + ashen(uAerialSkyColor, 0.65) * rim * 0.10);
    // Hard ceiling. An uncapped specular lobe on a curved chitin plate is what
    // punches a blown-out white patch through a thorax — and a thin limb, whose
    // every pixel is a rim pixel, is where that reads as a white stick.
    outgoingLight += min(sheen, vec3(0.13));
  }
  #endif

  // ------------------------------------------- silhouette against the haze
  //
  // applyAerial multiplies the body by transmittance and adds inscatter, so as
  // optical depth rises the animal and the air in front of it converge on one
  // value: in an ash storm (visual range ~150 m) a twenty-metre fenwalker
  // dissolves into a smudge that could equally be a rendering artifact. What
  // actually holds a silhouette in a dust-laden medium is the light the
  // particulate forward-scatters around the outline of the body — and that light
  // is generated in the intervening air, so it is NOT attenuated by it and must
  // be added AFTER the integral rather than before it, or the haze eats the very
  // term meant to survive the haze.
  //
  // Narrow on purpose (sixth power): legibility comes from local contrast at the
  // edge, not from lifting the whole body. In clear air the optical depth term is
  // ~2% at 300 m and this is invisible; at 100 m in a storm it is most of what is
  // left of the creature.
  // ------------------------------------------------------- no black holes
  //
  // "No crushed pure-black shadow" is a bar every pixel has to clear, and a
  // creature is where it is hardest. FRAG_BOUNCE now puts the correct ambient
  // into the standard model's indirect input, but everything that enters that
  // way is subsequently multiplied by the baked AO map and by the GTAO — and
  // at a horizon sun that ambient is the ONLY light most of the animal has, so
  // the occlusion term is attenuating not a fill but the whole exposure.
  //
  // The floor is not a lift, it is the part of that light no occlusion term is
  // entitled to remove: no point on a convex body is screened from more than
  // about 60% of the sky it faces, and a downward-facing surface collects the
  // ground's reflected radiance whatever else happens. uAerialSkyColor is
  // hemispheric irradiance, so it is divided by pi to become the radiance a
  // Lambertian sends back. Written as a floor so it can only ever rescue a
  // fragment that had nothing, and never brighten one that was already lit.
  {
    vec3 amb = uAerialSkyColor * (0.40 * (0.5 + 0.5 * Nw.y)) * 0.3183099 + uGroundBounce * 0.55;
    outgoingLight = max(outgoingLight, amb * diffuseColor.rgb);
  }

  // ------------------------------------------------------- backlit edge
  //
  // The one read a creature standing between the camera and a low sun lives or
  // dies on, and until now there was no term in this shader that could produce
  // it at all.
  //
  // Every lobe above gates its SUN contribution on the surface facing the sun:
  // the anisotropic sheen multiplies by clamp(dot(N,L)*0.5+0.5), the generic SSS
  // by clamp((dot(N,L)+0.55)/1.55), and both of those are ~zero over the whole
  // of a backlit animal. So at exactly the moment the animal is a dark shape on
  // a bright ground — dusk, dawn, the shot where separation matters most — the
  // sun-side edge is worth nothing and the silhouette closes up into a clump.
  //
  // Physically the term is not a highlight, it is transmission: at the
  // silhouette the sight line runs ALONG the surface rather than through it, so
  // it crosses the longest path of the thin scattering layer every animal has —
  // hide, the rind of a chitin plate, the fuzz on a limb, the wall of a
  // membrane. With the sun on the far side that path is the only route its light
  // takes to the eye. -dot(N,L) is "the sun is behind this wall" (the standard
  // model has already flipped N toward the camera on a two-sided surface), and
  // the (1-ndv) power confines it to the outline, where it carries the
  // information. The sky half is the same statement for an overcast or a
  // post-sunset sky, where the illuminant behind the animal is the dome itself.
  //
  // Capped and desaturated on the same discipline as every other additive term
  // here: this is the illuminant filtered through a wall, and the Ashlands
  // illuminant is ash-warm, never vivid.
  {
    float behind = clamp(-dot(Nw, L), 0.0, 1.0);
    float edgeT = pow(1.0 - ndv, 3.5);
    vec3 rimT = ashen(uAerialSunColor, 0.30) * (behind * edgeT * 0.20)
              + ashen(uAerialSkyColor, 0.55) * (edgeT * 0.09);
    outgoingLight += min(rimT, vec3(0.11));
  }

  // ------------------------------------------------------ highlight ceiling
  //
  // "No clipped white sky" is a bar, and the review found the frame's brightest
  // pixels were not the sky at all — they were a mudcrab's legs at luminance
  // 200+ and a strider's shins reading as white sticks. That is not a tuning
  // slip in one material: a thin cylinder is grazing across almost its whole
  // width, so on a limb the Fresnel term is near unity EVERYWHERE and the
  // specular lobe of any dielectric chitin, at any plausible roughness, lands on
  // top of a diffuse that is already lit. Capping each individual lobe (which is
  // what the sheen and iridescence ceilings do) cannot fix it, because it is
  // their sum plus the standard model's own GGX.
  //
  // So the ceiling goes where the physical statement is: the sky is the
  // illuminant, every creature surface is a dielectric reflecting a fraction of
  // it, and therefore nothing on an animal may outshine the sky. Soft-kneed
  // rather than clipped — it is an inverse curve that asymptotes at 1.6x the
  // ceiling — so a wet shell still reads as wetter than a dry one instead of
  // flat-topping into a white patch, and hue is preserved because the whole
  // triple is scaled by one factor.
  {
    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
    float lum = dot(outgoingLight, LUMA);
    float cap = max(dot(uAerialSkyColor, LUMA) * 0.72, 0.04);
    float over = lum / cap;
    if (over > 1.0) outgoingLight *= (1.0 + 0.6 * (over - 1.0) / over) / over;
  }

  vec3 toFrag = vWPos - cameraPosition;
  float haze = 1.0 - exp(-length(toFrag) * max(uAerialHazeDensity, 0.0));
  float edge = pow(1.0 - ndv, 6.0);
  float fwd = 0.35 + 0.65 * pow(clamp(dot(V, -L), 0.0, 1.0), 2.0);
  vec3 fringe = ashen(uAerialSkyColor * 0.085 + uAerialSunColor * 0.045 * fwd, 0.45) * (edge * haze);

  gl_FragColor = vec4(applyAerial(outgoingLight, toFrag) + fringe, diffuseColor.a);
}
`;

/**
 * Injected after <roughnessmap_fragment>. Anything below the waterline is wet:
 * the albedo darkens as the surface film kills backscatter and the roughness
 * collapses toward a mirror. That gradient across the legs of something standing
 * in the shallows is the wet-line, and it is the only cue that says the creature
 * is IN the water rather than floating above a picture of it.
 */
const FRAG_WET = /* glsl */ `
#include <roughnessmap_fragment>
{
  // Authored cavity/wear gradient (Mask.wear), which nothing had ever consumed.
  //
  // It is what puts an AO ramp down a tentacle — dark where it disappears into
  // the mantle, clean at the tip — and a cavity darkening where a plate overlaps
  // the shell beneath it. Squared so the values the existing bestiary already
  // carries (0.1-0.6) barely move and only a deliberately authored ramp reads.
  diffuseColor.rgb *= mix(1.0, 0.55, vMask.z * vMask.z);

  float wet = clamp((uWaterY - vWPos.y) * 3.5, 0.0, 1.0);
  diffuseColor.rgb *= mix(1.0, 0.52, wet);
  // Glossy, not mirrored. Taken all the way to a mirror the environment probe
  // aliases into single saturated pixels across a curved shell — sky-blue
  // speckle on chitin, which the palette does not allow anywhere.
  roughnessFactor = mix(roughnessFactor, 0.22, wet * 0.85);
}
`;

export interface ActorMaterial {
  material: THREE.MeshStandardMaterial;
  dispose(): void;
}

/**
 * Build one creature material. Compiled once per kind+tint and shared by every
 * actor that uses it, so the whole bestiary costs a handful of programs.
 */
export function makeActorMaterial(mats: IMaterials, o: ActorMaterialOpts): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(o.color),
    roughness: 1,
    metalness: 1,
    dithering: true,
    side: o.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
  });
  // Repeat 1, not `texel`. The mesh builder already emits UVs in metres scaled
  // by texel, so asking the material system for a texel-times tiled clone on top
  // squared the frequency — up to sixty repeats per metre on a morvek carapace,
  // far past Nyquist. The normal map at that frequency is what produces the
  // specular fireflies that read as blown-out patches on a shell.
  applyPBR(m, mats.tiled(SET_FOR[o.kind], 1), 1);
  // Never silently fall back to an untextured surface.
  //
  // MeshStandardMaterial with no map multiplies the tint by 1.0, which is a
  // plausible-looking flat colour — so a missing albedo does not crash, it just
  // renders a featureless capsule that looks like a placeholder and takes a
  // reviewer and a bisect to identify. Fail loudly instead: shout on the console
  // and paint the surface magenta, which is a value the Ashlands palette does
  // not contain anywhere and so can never be mistaken for art direction.
  if (m.map === null || m.map === undefined) {
    console.error(`[actors] material set "${SET_FOR[o.kind]}" has no albedo — check IMaterials.tiled()`);
    if (import.meta.env.DEV) m.color.setHex(0xff00ff);
  }
  // Floor on roughness. Below about 0.2 a normal-mapped curved surface aliases
  // its own highlight into single blown-out pixels at any distance at all.
  m.roughness = THREE.MathUtils.clamp(o.rough ?? 0.9, 0.2, 1);
  m.metalness = THREE.MathUtils.clamp(o.metal ?? 0.0, 0, 1);
  if (o.emissive !== undefined) {
    m.emissive = new THREE.Color(o.emissive);
    m.emissiveIntensity = o.emissiveIntensity ?? 1;
  }
  m.normalScale.set(0.55, 0.55);
  // A creature is a small object with a lot of curvature; the AO map bakes
  // surface cavity, and the pipeline's GTAO supplies the rest.
  m.aoMapIntensity = 0.85;

  const irid = o.irid ?? 0;
  const sss = o.sss ?? 0;
  const sheen = o.sheen ?? 0;

  const uniforms = {
    uIrid: { value: irid },
    uSSS: { value: sss },
    uSSSColor: { value: new THREE.Color(o.sssColor ?? 0xff7a4a) },
    uFilm: { value: 0.62 },
    uSheen: { value: sheen },
    uSheenColor: { value: new THREE.Color(o.sheenColor ?? 0xd8c9a4) },
    uMinPx: { value: ACTOR_MIN_PX },
  };

  m.userData.actorUniforms = uniforms;

  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, aerialUniforms(), actorFrameUniforms(), uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${VERT_PARS}\nvoid main() {`)
      .replace('#include <skinning_vertex>', VERT_DILATE)
      // `transformed` is post-skinning here, which is the whole point: the
      // world position a fragment fogs against must be the deformed one.
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>\n  vMask = aMask;\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${AERIAL_GLSL}\n${FRAG_PARS}\nvoid main() {`)
      .replace('#include <roughnessmap_fragment>', FRAG_WET)
      .replace('#include <lights_physical_fragment>', FRAG_ROUGH)
      .replace('#include <lights_fragment_maps>', FRAG_BOUNCE)
      .replace('#include <opaque_fragment>', FRAG_TAIL);

    shader.defines = shader.defines ?? {};
  };

  const membrane = o.kind === 'membrane' && sss > 0;
  m.defines = m.defines ?? {};
  m.defines.ACTOR_MEMBRANE = membrane ? 1 : 0;
  m.defines.ACTOR_SSS = sss > 0 ? 1 : 0;
  m.defines.ACTOR_IRID = irid > 0 ? 1 : 0;
  m.defines.ACTOR_SHEEN = sheen > 0 ? 1 : 0;
  // ONE key for the whole uber-shader, and deliberately NOT one per species.
  //
  // What this key is for is narrow: three's program cache key contains the
  // material's defines, its parameters and its booleans, but it has no idea that
  // onBeforeCompile rewrote the source. Two MeshStandardMaterials that agree on
  // every parameter but inject different GLSL would therefore share one program
  // and one of them would render the other's shader. `actor` is the token that
  // says "this source is the creature uber-shader", and that is the entire job.
  //
  // It used to read `actor:${kind}:${flags}`, on the reasoning that the #if
  // branches need distinct keys — but the defines that drive those branches are
  // ALREADY in the key (measured: `physical,STANDARD,,ACTOR_MEMBRANE,1,
  // ACTOR_SSS,1,...`), so the flags were duplicated and `kind` was pure
  // fragmentation. chitin, hide and shell all resolve to ACTOR_SSS/IRID/SHEEN =
  // 0111 and compile byte-identical programs; skin and cloth both resolve to
  // 0100. Keying on the species split each of those into one program per
  // species, and then every one of those was multiplied again by the renderer's
  // own light-count and env-map permutations. Measured over a walk: 90 actor
  // programs, of which 29 were duplicates of another actor program with a
  // different `kind` in front of an identical shader.
  m.customProgramCacheKey = () => 'actor';

  return m;
}

/* ----------------------------------------------------------------- prepass */

/**
 * Depth/normal/velocity prepass variant of the creature vertex path.
 *
 * The pipeline renders its G-buffer with one blanket override material, and that
 * material knows about three's own vertex chunks — skinning included — but it
 * cannot know about the sub-pixel limb dilation above, which only exists inside
 * the actor program. So the prepass saw the UNDILATED mesh while the main pass
 * shaded the dilated one, and every millimetre of the difference was silhouette
 * that the G-buffer said was empty sky.
 *
 * What that costs is precisely the defect the review found on the hero strider:
 * the velocity target's alpha is the coverage flag, and TAA falls back to
 * camera-only reprojection wherever it is zero, so an animating leg's outer
 * shell — which at 250 m is most of the leg — reprojected as if it were the
 * ridge behind it and smeared into a soft haze instead of meeting the ground.
 * Motion blur and the depth-aware AO/volumetric upsample read the same hole.
 *
 * `userData.prepassMaterial` is the pipeline's documented opt-out for exactly
 * this ("my vertices do not come from the attributes PREPASS_VERT knows about"),
 * and it wires the same current/previous transforms in, so the motion vectors
 * land in the same space as everyone else's. The shaders themselves are the
 * pipeline's own, so the G-buffer layout can never drift from it.
 */
export function makeActorPrepassMaterial(): THREE.ShaderMaterial {
  const vert = PREPASS_VERT.replace(
    '#include <skinning_vertex>',
    `#include <skinning_vertex>\n{\n${DILATE_BODY}}\n`,
  ).replace(
    '#include <common>',
    `#include <common>\nattribute vec4 aTan;\nuniform float uPixelWorld;\nuniform float uMinPx;`,
  );
  const m = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: vert,
    fragmentShader: PREPASS_FRAG,
    uniforms: {
      // The pipeline overwrites these three every frame via wirePrepassUniforms;
      // they only have to exist under the right names.
      uPrevModel: { value: new THREE.Matrix4() },
      uCurrVP: { value: new THREE.Matrix4() },
      uPrevVP: { value: new THREE.Matrix4() },
      ...actorFrameUniforms(),
      uMinPx: { value: ACTOR_MIN_PX },
    },
    // Matches the pipeline's own prepass material: a double-sided membrane must
    // not punch a hole in the normal buffer, and this target is never blended.
    side: THREE.DoubleSide,
    blending: THREE.NoBlending,
    toneMapped: false,
  });
  return m;
}

/* --------------------------------------------------------------- impostors */

/**
 * Far-LOD billboard shader.
 *
 * Impostor tiles are captured from a ring of yaws, so the tile chosen for a
 * given view already holds the normals that view would see; lighting is a
 * single N-dot-L in view space against the same sun the skinned meshes use,
 * plus the same aerial integral. The alternative — baking lighting into the
 * atlas — falls apart the moment the sun moves, which in this game it does.
 */
export const IMPOSTOR_VERT = /* glsl */ `
precision highp float;
uniform float uTiles;
attribute vec4 iPosScale;   // xyz world position of the base, w uniform scale
attribute vec2 iYawTile;    // x actor yaw, y species tile row
varying vec2 vUv;
varying vec3 vWPos;
varying float vRow;

void main() {
  // Face the camera about Y only. Creatures stand upright; a full spherical
  // billboard would visibly roll as the camera pitches.
  vec3 toCam = cameraPosition - iPosScale.xyz;
  float camYaw = atan(toCam.x, toCam.z);
  vec3 right = vec3(cos(camYaw), 0.0, -sin(camYaw));
  vec3 up = vec3(0.0, 1.0, 0.0);

  vec3 world = iPosScale.xyz + (right * position.x + up * position.y) * iPosScale.w;

  // Which capture yaw is nearest to the direction we are being viewed from.
  float rel = camYaw - iYawTile.x;
  float frac = rel / 6.283185307 + 0.5;
  frac = frac - floor(frac);
  float tile = floor(frac * uTiles + 0.5);
  tile = mod(tile, uTiles);

  vUv = vec2((uv.x + tile) / uTiles, uv.y);
  vRow = iYawTile.y;
  vWPos = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export const IMPOSTOR_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uAlbedo;
uniform sampler2D uNormal;
uniform vec3 uSunView;
uniform float uRows;
uniform float uTiles;
uniform vec2 uAtlasTexel;   // 1 / atlas size, in texels
uniform vec3 uGroundBounce;
uniform float uDitherPhase;
varying vec2 vUv;
varying vec3 vWPos;
varying float vRow;

void main() {
  // Clamp the sample inside this tile.
  //
  // The atlas packs eight yaws across and one species per row with no gutter,
  // and the sampler is LINEAR — so at u=0 and u=1 the bilinear tap reaches into
  // the NEIGHBOURING tile, and at v=0/1 into the neighbouring species. That is
  // the review's "white stippled hard-alpha edges": the coverage a fragment
  // discards against is half its own silhouette and half the shoulder of the
  // creature in the next cell along, so the alpha test cuts a dotted line
  // through the edge instead of a clean one. Half a texel of inset makes the
  // tile self-contained, which it always should have been.
  vec2 lo = vec2(floor(vUv.x * uTiles) / uTiles, vRow / uRows) + uAtlasTexel * 0.5;
  vec2 hi = vec2((floor(vUv.x * uTiles) + 1.0) / uTiles, (vRow + 1.0) / uRows) - uAtlasTexel * 0.5;
  vec2 uvv = clamp(vec2(vUv.x, (vUv.y + vRow) / uRows), lo, hi);
  vec4 a = texture2D(uAlbedo, uvv);
  // HASHED coverage, not blended coverage.
  //
  // The soft edge is still wanted — a hard threshold on a bilinear alpha edge is
  // the crunchy cut-out this is trying to leave behind, and the renderer runs
  // with antialias:false (TAA owns AA) so alpha-to-coverage has no samples to
  // write into. What is NOT wanted is paying for it with alpha blending, which
  // is what the previous "gl_FragColor.a = cov" on a material flagged
  // transparent actually did: every partially-covered fragment composited the
  // terrain behind it, and the whole billboard moved into three's sorted
  // transparent pass, behind every opaque object in the frame. On a creature
  // that is 2-15 px tall the partial-coverage band is a large share of the
  // sprite, so the animal read as a ghost.
  //
  // Discarding with probability 1-cov against an interleaved-gradient hash
  // produces the same expected coverage from an OPAQUE draw. The phase advances
  // by the golden ratio every frame (see setActorFrame), so the stipple is noise
  // TAA integrates away rather than a screen-locked stencil it preserves.
  float cov = clamp((a.a - 0.30) * 2.6, 0.0, 1.0);
  if (cov < 0.02) discard;
  if (cov < 0.999) {
    vec2 dp = gl_FragCoord.xy;
    float ign = fract(52.9829189 * fract(0.06711056 * dp.x + 0.00583715 * dp.y) + uDitherPhase);
    if (ign >= cov) discard;
  }
  vec3 n = texture2D(uNormal, uvv).xyz * 2.0 - 1.0;
  float l = length(n);
  n = l > 0.2 ? n / l : vec3(0.0, 0.0, 1.0);

  // Wrapped, not clamped. A hard N.L terminator on a 160-pixel capture of a
  // whole animal turns half the silhouette to black, which at this range reads
  // as a hole rather than as shading; wrapping it keeps the far side of the body
  // in the same value range the skinned tier hands off from.
  float ndl = clamp((dot(n, uSunView) + 0.32) / 1.32, 0.0, 1.0);
  // A hemispherical wrap stands in for the sky term the skinned meshes get from
  // the IBL, so an impostor does not turn black the instant it faces away.
  float sky = 0.5 + 0.5 * n.y;
  // The same ground bounce the skinned tier gets from FRAG_BOUNCE, on the same
  // hemispheric weight. Without it a creature would visibly darken as it crossed
  // into the impostor band, which is a LOD pop in value rather than in shape and
  // therefore the harder one to see and the harder one to forgive.
  vec3 bounce = uGroundBounce * (1.0 - sky) * (1.0 - sky);
  // Edge rim, matching the chitin sheen the skinned tier carries, so a creature
  // does not lose its separation from the background as it crosses the LOD.
  float rim = pow(1.0 - clamp(abs(n.z), 0.0, 1.0), 2.4);
  vec3 col = a.rgb * (uAerialSunColor * ndl + uAerialSkyColor * sky * 0.9 + bounce)
           + uAerialSkyColor * rim * 0.12;
  // Ambient floor, matching the skinned tier's (see FRAG_TAIL). At two or three
  // pixels a creature has no shading left to read, and if the tile it minifies
  // to happens to be a dark one it collapses to an unshaded black dot on the
  // ridgeline — which is exactly where a silhouette is most conspicuous. A
  // floored silhouette still reads as a lit figure at that size; a black speck
  // reads as a dead pixel.
  col = max(col, (uAerialSkyColor * 0.030 + uGroundBounce * 0.55) * a.rgb);
  // Same highlight ceiling as the skinned tier (see FRAG_TAIL), so a creature
  // does not change value as it crosses the LOD.
  {
    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
    float lum = dot(col, LUMA);
    float cap = max(dot(uAerialSkyColor, LUMA) * 0.72, 0.04);
    float over = lum / cap;
    if (over > 1.0) col *= (1.0 + 0.6 * (over - 1.0) / over) / over;
  }

  // Post-aerial silhouette fringe, matching the skinned tier's exactly (see
  // FRAG_TAIL) so a creature does not gain or lose its separation from the haze
  // as it crosses the LOD.
  vec3 toFrag = vWPos - cameraPosition;
  float haze = 1.0 - exp(-length(toFrag) * max(uAerialHazeDensity, 0.0));
  float edge = pow(1.0 - clamp(abs(n.z), 0.0, 1.0), 6.0);
  vec3 fringe = ashenI(uAerialSkyColor * 0.085 + uAerialSunColor * 0.045, 0.45) * (edge * haze);

  // Alpha 1, always. Coverage was resolved by the discard above; anything less
  // than 1 here would be read as a blend factor the moment someone flags this
  // material transparent again.
  gl_FragColor = vec4(applyAerial(col, toFrag) + fringe, 1.0);
}
`;

export function makeImpostorMaterial(
  albedo: THREE.Texture,
  normal: THREE.Texture,
  tiles: number,
  rows: number,
  sunView: THREE.Vector3,
  atlasSize: THREE.Vector2,
): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    vertexShader: IMPOSTOR_VERT,
    fragmentShader: `${AERIAL_GLSL}\nvec3 ashenI(vec3 c, float k){return mix(c, vec3(dot(c, vec3(0.2126,0.7152,0.0722))), k);}\n${IMPOSTOR_FRAG}`,
    uniforms: {
      uAlbedo: { value: albedo },
      uNormal: { value: normal },
      uSunView: { value: sunView },
      uTiles: { value: tiles },
      uRows: { value: rows },
      uAtlasTexel: { value: new THREE.Vector2(1 / Math.max(1, atlasSize.x), 1 / Math.max(1, atlasSize.y)) },
      ...aerialUniforms(),
      ...actorFrameUniforms(),
    },
    // OPAQUE. This was flagged transparent, on the reasoning that the flag was
    // the way to keep an alpha-tested billboard out of the depth/normal prepass
    // and that the shader "always outputs alpha 1 so the pass is order
    // independent anyway". Both halves were wrong:
    //
    //   - the shader did NOT output alpha 1. It output `cov`, the soft coverage
    //     ramp, so every fragment on the outline of every impostor was alpha
    //     blended with the terrain behind it. At the 2-15 px the impostor tier
    //     actually draws at, that band is a large fraction of the animal, and a
    //     large fraction of an animal compositing the ground behind it is the
    //     "creatures look translucent" report.
    //   - `transparent` is not a prepass switch. It enables blending and moves
    //     the draw into three's sorted transparent pass, after every opaque
    //     object in the frame, where creature-vs-creature depth ordering comes
    //     from buffer order rather than from depth.
    //
    // Prepass exclusion is a separate concern with its own sanctioned mechanism
    // — `userData.prepassMaterial`, see makeImpostorPrepassMaterial and the
    // identical arrangement on flora's billboards. Coverage is now resolved by a
    // hashed discard in the shader instead of by the blender.
    transparent: false,
    depthWrite: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  return mat;
}

/**
 * Prepass opt-out for the impostor batch.
 *
 * The pipeline replaces the material of anything it does not recognise with one
 * blanket override built on PREPASS_VERT, which has never heard of `iPosScale`
 * or `iYawTile` — it would collapse every billboard in the world onto the origin
 * and stamp that pile over the normal and velocity buffers. Declaring a prepass
 * material is the documented way to say "skip me", and skipping is the right
 * answer at this tier for the same reason it is for flora: an impostor is 2-15
 * px of creature at 100 m or more, which is past the shadow cascade and past any
 * useful AO radius.
 *
 * Note this is exactly what the `transparent: true` flag was being used for.
 * Doing it here instead costs one throwaway program and leaves the visible
 * material free to be what it actually is, which is opaque.
 */
export function makeImpostorPrepassMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: 'void main() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }',
    fragmentShader: 'precision highp float;\nvoid main() { discard; }',
    colorWrite: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
}
