import * as THREE from 'three';
import type { IAtmosphere, ITerrain } from '../core/contracts';
import type { Ctx, System } from '../core/types';
import { buildFloraAtlas, type FloraAtlas } from './Atlas';
import {
  buildAshYam,
  buildBulbFungus,
  buildKelp,
  buildMarshmerrow,
  buildParasol,
  buildStoneflower,
  buildTramaRoot,
} from './Build';
import { Canopy, GLOW_GATE, type SpeciesVisual } from './Canopy';
import { ContactPool, GroundContact } from './Contact';
import { TerrainField } from './Field';
import { GroundCover, type GroundOpts } from './Ground';
import { TerrainLod } from './Lod';
import { OSEED, OSY, OX, OY, OZ, SPECIES, STRIDE, scatter, type Scattered } from './Scatter';

/**
 * ASHLANDS — vegetation.
 *
 * Ashenreach's flora is fungal, and the silhouette is the point: an emperor
 * parasol is a swollen stalk under a wide drooping cap with gills you can see
 * from below, not a tree. Everything here is generated: the meshes are lofted
 * splines and lathes over seeded noise, the textures are a single synthesised
 * band atlas, and the placement is ecological blue noise driven by the terrain's
 * own material, slope and height.
 *
 * Three things carry the look:
 *
 *  1. One wind field, sampled identically by the canopy, the ground cover and
 *     the impostors, so a gust crosses the whole frame as one event.
 *  2. Subsurface scattering on the caps, so a low sun sets a grove alight from
 *     behind. Per pixel of effort this is worth more than any other foliage
 *     feature.
 *  3. Bioluminescence that is a suggestion by day and a light source by night.
 */

const srgb = (hex: number): THREE.Color => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

/** Bioluminescence — the only saturated colours in the palette. */
const BIO_TEAL = srgb(0x3fd6c0);
const BIO_VIOLET = srgb(0x8f6bff);

const VISUALS: Record<string, SpeciesVisual> = {
  parasol: {
    build: buildParasol,
    meshLods: 2,
    /**
     * The hand-off distances, and why they were wrong.
     *
     * The impostor took over at 190 m. An emperor parasol is up to 22 m tall, so
     * at 190 m through a 62-degree lens it is still about 105 pixels high — a
     * tenth of the frame. A billboard at that size is not an approximation of a
     * plant, it is a picture of one, and the review called it correctly: a flat
     * unshaded cut-out standing next to shaded geometry.
     *
     * The rule this now follows is that a stage may only take over once the
     * thing it replaces is under about thirty pixels. For a 22 m plant that is
     * 430 m for the billboard and about 110 m for the reduced mesh. The extra
     * cost is close to nothing, because the parasols are scattered at 32 m and
     * an annulus from 190 to 430 m holds only a few dozen of them — a few tens
     * of thousands of triangles against the fifteen hundred triangles per
     * instance the near LOD is already paying for the ones in front of the lens.
     *
     * The fade band widens with the distance it sits at: 40 m is roughly nine
     * per cent of 430, which is the ratio at which a hashed dissolve reads as a
     * dissolve rather than as a wipe.
     */
    lodDist: [110, 430],
    drawDist: 900,
    fadeBand: 40,
    impostor: true,
    tint: srgb(0xd8c6a8),
    // Was 0xa8829a. A mauve alternate is a cool hue on the one plant whose
    // largest visible surface is its own shade, and every instance that rolled
    // toward it came out violet-grey in a frame of ochre. The blush in the cap
    // band already supplies the non-ochre note the palette allows; the instance
    // alternate should stay inside chitin/bone.
    tintAlt: srgb(0xb59079),
    tintAltAmount: 0.42,
    hueJitter: 0.85,
    /**
     * 150 -> 430, and it now covers the WHOLE mesh ladder.
     *
     * The emperor parasol is the signature silhouette of the project and it was
     * the asset three consecutive reviews called untextured clay. The reason was
     * arithmetic, not authoring: the layer's range was enforced through a
     * footprint constant that was out by a factor of two and a half (see
     * Materials.ts), so 150 was really 60 — and LOD1, which runs from 110 m to
     * 430 m and is where every mid-ground parasol in every canonical frame sits,
     * had no surface layer at all. A cap-only crop of a parasol at ninety metres
     * measured a luminance standard deviation of 7.6 levels out of 255.
     *
     * 430 is the impostor hand-off, i.e. the point at which the plant is about
     * thirty pixels tall. Out there the layer is the coarse lattice plus the
     * analytic sector, ring and margin terms — on a twelve-metre cap those are
     * five to seven pixels wide at two hundred metres, which is exactly the
     * scale the reviews were reading as flat.
     */
    surfaceRange: 430,
    surfaceFar: true,
    sssTint: srgb(0xd9793a),
    glowColor: BIO_TEAL,
    windAmp: 0.075,
    lean: 0.10,
    // A fifteen-metre plant that is visibly off plumb reads as falling over, so
    // the parasols get the smallest tilt in the table.
    tilt: 0.055,
    side: THREE.DoubleSide,
    // LOD1 now covers 110-430 m instead of 62-190, which is 5.4x the ground
    // area; the cap rises to match so the ladder cannot run dry and drop a
    // mid-distance parasol out of the frame. The impostor cap falls by the same
    // logic — it starts much further out and covers proportionally less.
    // 1500 -> 1000 on the LOD1 stage. The mesh behind it is now about 2.4x the
    // triangles it was (it has to carry the lobed margin and the annular
    // constrictions, which are the whole silhouette fix), so the cap has to come
    // down to keep the stage's worst-case triangle budget where it was. 1000 is
    // still well clear of what the 110-430 m annulus actually holds at 32 m
    // Poisson spacing under the patch mask, measured at a little under 600.
    // A twelve-metre lid over a bare stipe: the ground under an emperor parasol
    // sees almost no sky at all, and this is the largest skirt in the table.
    contactAO: 0.72,
    contactR: 1.00,
    caps: [190, 1000],
    impostorCap: 2400,
    castShadow: true,
  },
  bulb: {
    build: buildBulbFungus,
    meshLods: 2,
    lodDist: [38],
    drawDist: 150,
    fadeBand: 14,
    impostor: false,
    tint: srgb(0xd6cdb4),
    // Was 0x8fb9c0 — a saturated pale cyan, which on 45% of the population is a
    // second vivid colour in a palette that permits exactly two, neither of them
    // this. Grey-green is the one green the bible allows and it is what a
    // weathered puffball skin actually is.
    tintAlt: srgb(0xa8ae9a),
    tintAltAmount: 0.45,
    hueJitter: 0.55,
    /**
     * Left at 38 deliberately, and the arithmetic is worth writing down because
     * the obvious change here is a waste.
     *
     * It is tempting to raise this so the hero pod gets more of the surface layer.
     * It would do nothing: the range is a PIXEL FOOTPRINT threshold (38/1740 =
     * 0.0218) and the fade to it only begins at 0.70 of that, i.e. 27 m. The coast
     * hero cluster is fifteen metres from the lens, so it is already at full
     * amplitude — every octave the layer has is already being applied to it. What
     * was missing on that pod was not range; it was that the cap terms were the
     * wrong terms for a dome (see capDome), and that the finest lattice is gated
     * separately at about twelve metres inside floraSurface.
     */
    /**
     * 38 -> 150 (the draw distance), and the arithmetic that once justified 38
     * was wrong in its premise.
     *
     * The old note here argued the range was already generous because 38/1740 =
     * 0.0218 and the coast hero pod is fifteen metres out. The constant was the
     * problem: with fwidth counted honestly, 38 was being enforced at about
     * sixteen metres, so the hero pod was sitting right on the fade. And LOD1,
     * from 38 m to 150 m, had nothing. A bulb fungus is a two-metre object and it
     * is a readable one at a hundred; it gets the reduced layer out to where it
     * stops being drawn.
     */
    surfaceRange: 150,
    surfaceFar: true,
    /**
     * The cap band is a MERIDIAN here, not a radius: see capDome.
     */
    capDome: true,
    /**
     * Was 0xff9a52 — pure saturated orange, and the review read the pods as
     * "salmon pink" largely because of it.
     *
     * The subsurface term is ADDITIVE and does not answer to the albedo, so on a
     * fleshy dome under the coast's 17.6 h sun it is not a rim accent: it is a
     * large fraction of everything the lit crown emits, and it carries its own
     * chroma straight into the frame. The same mistake was found and fixed on the
     * marshmerrow and the kelp two iterations ago and the bulb was missed. This
     * is a warm ochre inside the chitin band — the transmission still bleeds warm
     * light through the cap edge at a low sun, which is the whole point of the
     * effect, without repainting the plant.
     */
    sssTint: srgb(0xd0a172),
    glowColor: BIO_TEAL,
    glowColorAlt: BIO_VIOLET,
    // A bulb fungus is a lamp, and the bible wants lamps lit. Modest, because
    // the atlas paints its glow on the cap RIM and a rim mask on a lathe is a
    // one-pixel outline as soon as the plant is small on screen — see the
    // distance fade in Materials.ts.
    glowFloor: 0.09,
    windAmp: 0.035,
    lean: 0.14,
    tilt: 0.17,
    // Closed lathes: back faces are never seen, so culling them is free.
    side: THREE.FrontSide,
    /**
     * contactR is a multiple of the species' SCATTER footprint, and for the bulb
     * fungus that number is not a radius — it is the probe ring the placement
     * code uses to find the lowest ground under a cluster, deliberately set wide
     * (1.7) so a convex break cannot leave an outer bulb in the air. Multiplying
     * it out to a skirt gave every bulb a four-metre disc on a species scattered
     * at nine-metre spacing, i.e. two thirds of the coast frame covered in
     * overlapping multiplies: the ground came out a third darker than it should
     * be, which is the one thing this pass is forbidden to do. 0.55 of the probe
     * ring is the cluster's actual footprint.
     */
    contactAO: 0.58,
    contactR: 0.55,
    caps: [430, 1300],
    impostorCap: 0,
    castShadow: true,
  },
  trama: {
    build: buildTramaRoot,
    meshLods: 2,
    // The largest thing in the near field on every ash-flat vantage, and the LOD
    // hand-off was happening at forty metres — well inside the range at which it
    // fills a third of the frame. Push the full mesh out to where it is small.
    lodDist: [80],
    drawDist: 230,
    fadeBand: 20,
    impostor: false,
    /**
     * Reflectance, not "colour".
     *
     * This tint multiplies the atlas albedo in LINEAR space, and the old value
     * (0x6b6560 => 0.147 linear) times a bark band that is already 0.17 linear
     * gave the trama root a 2.5% reflectance — charcoal. At that albedo there is
     * no lighting information left to see: the review measured a five-level
     * delta between the sunlit and shadowed limbs of the hero tree and read the
     * whole thing, correctly, as an unlit vector cutout. Nothing was bypassing
     * the light; the surface was simply too dark to carry it. Weathered ashland
     * deadwood is a bleached grey-brown, and at 0.55 linear the same bark
     * normal, the same AO and the same sun produce a real light and dark side.
     */
    tint: srgb(0xcfc2ad),
    tintAlt: srgb(0x8a7a68),
    tintAltAmount: 0.42,
    hueJitter: 0.45,
    // 60 -> 230 (the draw distance). A trama root is the largest thing in the
    // near field on every ash-flat vantage and its bark was the coast review's
    // "smooth gradient with no bark"; 60 was being enforced at about 25 m.
    surfaceRange: 230,
    surfaceFar: true,
    sssTint: srgb(0x40301f),
    glowColor: BIO_VIOLET,
    windAmp: 0.012,
    lean: 0.18,
    tilt: 0.13,
    side: THREE.FrontSide,
    // A bare woody stem: little canopy, but ash drifts hard against a trunk.
    contactAO: 0.58,
    contactR: 2.0,
    caps: [260, 1200],
    impostorCap: 0,
    castShadow: true,
  },
  yam: {
    build: buildAshYam,
    meshLods: 2,
    lodDist: [28],
    drawDist: 95,
    fadeBand: 10,
    impostor: false,
    /**
     * Reflectance, not "colour" — the same arithmetic the trama root note in
     * this file already spells out, and the leaf-bearing species were missed by
     * it. The atlas leaf band is multiplied by this tint in LINEAR space, so a
     * 0.44-linear tint on a 0.15-linear band delivered a seven-per-cent
     * reflectance: charcoal, with no lighting information left in it to see.
     * The band has come up (Atlas.ts) and the tints come up with it.
     */
    tint: srgb(0xcdc6a6),
    tintAlt: srgb(0xa6b18a),
    tintAltAmount: 0.4,
    hueJitter: 0.3,
    surfaceRange: 30,
    sssTint: srgb(0xc8a05a),
    glowColor: BIO_TEAL,
    windAmp: 0.030,
    lean: 0.10,
    tilt: 0.17,
    // A half-buried tuber sitting IN the ground already; it needs the skirt to
    // bed the rosette, not to explain a stalk.
    contactAO: 0.48,
    contactR: 1.8,
    caps: [380, 900],
    impostorCap: 0,
    castShadow: true,
  },
  marsh: {
    build: buildMarshmerrow,
    meshLods: 2,
    lodDist: [32],
    drawDist: 105,
    fadeBand: 10,
    impostor: false,
    // See the note on the ash yam's tint: this band was delivering a two-per-cent
    // reflectance on the closest object in the coast frame.
    tint: srgb(0xc7d0b4),
    tintAlt: srgb(0xc98c69),
    tintAltAmount: 0.38,
    hueJitter: 0.25,
    surfaceRange: 30,
    /**
     * Verdigris, not chartreuse.
     *
     * 0x9fd06a is a saturated yellow-green, and the transmission term is ADDITIVE
     * — it does not answer to the albedo — so on any frame where the diffuse
     * response collapses it becomes the entire signal. The night shot is exactly
     * that frame: the marshmerrow came out as green outlines on black, which is
     * both the review's blocker and a straight palette violation, since the bible
     * permits precisely one green and it is a grey one. Bounded in the shader as
     * well (see the SSS clamp in Materials.ts); this is the other half.
     */
    sssTint: srgb(0x9aa876),
    glowColor: BIO_TEAL,
    windAmp: 0.085,
    lean: 0.12,
    tilt: 0.16,
    // An open fan of blades takes very little sky away from its own root.
    contactAO: 0.38,
    contactR: 2.1,
    caps: [380, 900],
    impostorCap: 0,
    castShadow: true,
  },
  stone: {
    build: buildStoneflower,
    meshLods: 2,
    lodDist: [26],
    drawDist: 90,
    fadeBand: 10,
    impostor: false,
    tint: srgb(0xc3c6c0),
    tintAlt: srgb(0xd8c9a4),
    tintAltAmount: 0.40,
    hueJitter: 0.3,
    surfaceRange: 30,
    sssTint: srgb(0xbcc8e0),
    glowColor: BIO_VIOLET,
    glowColorAlt: BIO_TEAL,
    glowFloor: 0.08,
    windAmp: 0.018,
    lean: 0.08,
    tilt: 0.20,
    contactAO: 0.52,
    contactR: 1.8,
    caps: [340, 800],
    impostorCap: 0,
    castShadow: true,
  },
  kelp: {
    build: buildKelp,
    meshLods: 2,
    lodDist: [28],
    drawDist: 90,
    fadeBand: 10,
    impostor: false,
    tint: srgb(0xa8c0ae),
    tintAlt: srgb(0xbf8757),
    tintAltAmount: 0.45,
    hueJitter: 0.25,
    surfaceRange: 30,
    // Same reasoning as marshmerrow: a saturated transmission tint on an
    // additive term owns any frame whose diffuse falls away.
    sssTint: srgb(0x6f9e92),
    glowColor: BIO_TEAL,
    // Kelp answers to water, not air, and the swell is slow and large.
    windAmp: 0.16,
    lean: 0.20,
    tilt: 0.18,
    contactAO: 0.46,
    contactR: 2.0,
    caps: [340, 800],
    impostorCap: 0,
    castShadow: false,
  },
};

const GROUND: GroundOpts[] = [
  {
    id: 'ashgrass',
    tile: 5,
    /**
     * 255 -> 165, and the cards are crossed and wider instead.
     *
     * The review read this layer as "confetti", "scattered plastic debris" and
     * "flat green tape strips with visible straight polygon edges", and all three
     * are the same defect: a single flat card has no silhouette from its own
     * edge, so a third of any field of them is presenting a two-pixel sliver.
     * More slivers is not more vegetation. Crossing the card doubles its
     * triangles, so the instance count comes down to pay for it — the layer costs
     * about what it did and every surviving instance reads as a tuft with a
     * front, a side and a shadow rather than as a chip of plastic.
     */
    perTile: 92,
    blades: 3,
    // Two cross-rows, not three.
    //
    // The cull ladder in this shader runs per VERTEX, not per instance, so the
    // template's vertex count multiplies the cost of every blade the field
    // rejects as well as every one it draws. Crossing the card doubles that
    // count, and paying it on top of three rows would have made the layer
    // dearer than the single card it replaces. Dropping the middle row takes the
    // pair to ten vertices against the old seven — and with the instance count
    // trimmed to match, the whole layer now costs fewer vertex invocations than
    // iteration 7 did while carrying a silhouette from every azimuth. The arc
    // reads as a curve with one interior row; the tip vertex is the one the eye
    // actually follows.
    rows: [0, 0.42],
    ring: 27,
    chan: [1.0, 0.30, 0.0, 0.0],
    seed: 0,
    // Narrow. A card 10 cm wide and 31 cm tall is a leaf, and crossing two of
    // them at that aspect builds a squat four-sided pyramid — which is the cone
    // this layer was rebuilt to get away from. At 5.5 cm the pair reads as what
    // it is meant to be: a few blades standing together.
    shape: [0.115, 0.31, 0.66, 0.85],
    density: 0.95,
    windAmp: 0.55,
    tint: srgb(0xdaceac),
    tintAlt: srgb(0x9da986),
    tintAltAmount: 0.42,
    // Was 0xc8d07a at full strength. On a card whose diffuse reflectance is a
    // tenth of a linear unit, a saturated yellow-green transmission is not a
    // rim effect — it is the surface colour, and it is what turned the dry tips
    // into the cream flecks the review counted as litter.
    sssTint: srgb(0xb0ab84),
    sssAmount: 0.82,
    glowColor: BIO_TEAL,
    glowColorAlt: BIO_VIOLET,
    /**
     * 0.055/0.05 -> 0.022/0.0, and the night review is right that this was the
     * wrong surface to put it on.
     *
     * The emissive is normalised to its brightest channel before the gain is
     * applied, so #3fd6c0 reaches the frame as (0.075, 1.0, 0.89) — and on a
     * three-centimetre card at night, where the diffuse response is essentially
     * zero, that normalised triple is the ENTIRE signal. A field of them
     * therefore renders as a mass of green vertical slivers with a hard top
     * edge where the sward stops, which is exactly what was measured ("hard-
     * edged green quads with straight vertical striping"). It is also a palette
     * violation by volume: bioluminescence is meant to be the rarest thing in
     * the frame and it was on a hundred thousand instances.
     *
     * The glow fungus is the lamp (glowFrac 0.32, glowFloor 0.44 below) and it
     * has a cap to carry it. Grass keeps a trace so a damp hollow still has
     * something in it, and no daytime floor at all.
     */
    glowFrac: 0.022,
    glowFloor: 0.0,
    template: 'blade',
    lean: 0.17,
    // Ash grass takes the high half of the dominance field.
    dominance: [0.32, 0.66, 0.70],
    emergent: 0.11,
    patchPhase: 11.7,
    tuft: [0.55, 0.60],
  },
  {
    /**
     * The outer sward.
     *
     * A dense near ring can only afford about sixty metres, and beyond that
     * radius the field used to stop dead — on the vale ridge that boundary runs
     * across the frame as a straight line with full-density grass on one side
     * and bare plain on the other, which is the review's blocker. Extending the
     * fine ring is not the answer: cost goes as the square of the radius.
     *
     * This is the vegetation's own LOD. Tiles are two and a half times wider,
     * the cards two and a half times bigger and a quarter as numerous, and it
     * fades in under the near ring rather than starting at it. The result is a
     * continuous size and density gradient out to a hundred and thirty metres,
     * for a fifth of the instances the equivalent fine ring would need.
     */
    id: 'ashgrass_far',
    tile: 13,
    perTile: 130,
    ring: 23,
    /**
     * The outer sward answers to ASH as well as to grass, and that is the ridge
     * blocker.
     *
     * At an ash weight of 0.30 this ring effectively did not exist on an ash
     * flat, and the near rings stop at fifty-five metres — so every vantage
     * whose ground is ash carried nothing at all between there and the horizon.
     * The ridge shot is the extreme case ("zero vegetation of any kind ...
     * nothing gives scale reference"), but the same hole is what makes the
     * dawn, dusk and coast midgrounds read as bare. Scathecraw is precisely the
     * plant that colonises open cinder; the far ring is its LOD as much as it is
     * the grass's, so it has to be keyed to the same habitat.
     */
    chan: [0.80, 0.45, 0.70, 0.10],
    seed: 3,
    /**
     * 0.145 x 0.64 -> 0.115 x 0.42, and it is the ridge blocker's other half.
     *
     * The outer ring's cards were authored two and a half times the size of the
     * near ring's on the argument that they live between 46 and 130 m, where
     * the tallest of them is six pixels. That argument holds for a camera
     * standing ON the ground. The ridge vantage stands four metres above a
     * steep flank whose near ground is twenty-five metres out — inside this
     * ring's fade-in — so a card the height chain could take to two and a half
     * metres was presented to the lens as a metre-wide ribbon a third of the
     * frame tall. Sixty-per-cent bigger than the near ring is enough to hold a
     * distance gradient; two and a half times was never a size, it was a
     * licence for the multiplier chain (now also ceilinged in Ground.ts).
     */
    shape: [0.115, 0.42, 0.70, 0.85],
    density: 0.86,
    windAmp: 0.5,
    tint: srgb(0xd7c9a9),
    tintAlt: srgb(0x9da781),
    tintAltAmount: 0.42,
    sssTint: srgb(0xa9a87c),
    // Weaker still than the near ring. Every card out here is under six pixels,
    // and a transmission term on a sub-pixel object cannot be seen as
    // transmission — only as an offset in value, i.e. as aliasing.
    sssAmount: 0.62,
    glowColor: BIO_TEAL,
    glowColorAlt: BIO_VIOLET,
    glowFrac: 0.014,
    glowFloor: 0.0,
    template: 'blade',
    // The outer ring's cards live between 46 and 130 m, where the tallest of
    // them subtends about six pixels. Three cross-rows buy an arc nothing at
    // that size can resolve; two cut the ring's triangle count by 40% and its
    // vertex invocations by 29% across twenty thousand instances.
    rows: [0, 0.5],
    distMin: 46,
    lean: 0.18,
    // Same species as ashgrass, so the same slice and — critically — the same
    // patch phase. The outer ring has to clump in the same hollows the inner one
    // does or the hand-off shows up as a change of pattern.
    // Weakly sliced. The near rings split the dominance field between grass and
    // scathecraw because at ten metres you can tell them apart; at ninety you
    // cannot, and slicing the far ring only reopens the hole the ash weight
    // above exists to close.
    dominance: [0.32, 0.66, 0.30],
    emergent: 0.09,
    patchPhase: 11.7,
    tuft: [1.30, 0.55],
  },
  {
    /**
     * Scathecraw: the dry stiff scrub of the ash wastes.
     *
     * The single largest hole in iteration 1. ashgrass keys off the grass
     * habitat and the moss cushions are sparse by design, so an ash flat — which
     * is what the dawn, ashstorm and ridge vantages all sit on — carried no
     * ground cover at all inside five metres. The ashlands are sparse, not bare:
     * this is the layer that gives them a near plane.
     */
    id: 'ashscrub',
    tile: 5,
    perTile: 104,
    blades: 3,
    rows: [0, 0.42],
    ring: 25,
    chan: [0.30, 0.40, 1.0, 0.30],
    seed: 1,
    // Shorter, wider and much stiffer than ash grass: scathecraw is a woody
    // rosette, and giving it the grass arc turns the wastes into a hayfield.
    shape: [0.130, 0.22, 0.34, 0.85],
    density: 0.96,
    windAmp: 0.22,
    tint: srgb(0xd6c19f),
    tintAlt: srgb(0xa0947c),
    tintAltAmount: 0.40,
    sssTint: srgb(0xb0946c),
    sssAmount: 0.82,
    glowColor: BIO_TEAL,
    glowColorAlt: BIO_VIOLET,
    glowFrac: 0.018,
    glowFloor: 0.0,
    template: 'blade',
    // Scathecraw takes the LOW half of the same field the grass takes the high
    // half of. Reversed edges (lo > hi) are deliberate.
    dominance: [0.68, 0.34, 0.72],
    // Woody rosettes throw up dry seed stalks, and they are the tallest thing on
    // an ash flat between the ground and a trama root.
    emergent: 0.15,
    patchPhase: 143.2,
    tuft: [0.60, 0.58],
  },
  {
    /**
     * ASH CLINKER — the near-plane debris layer, and the only ground layer that
     * survives where nothing grows.
     *
     * "Zero vegetation and zero ground debris in the entire frame ... a smooth
     * empty dune field that gives the eye nothing to measure scale against" was
     * the dusk verdict, and it is a fair one: every other layer here is keyed to
     * grass, fungal ground or ash scrub, and a high sand-and-cinder shoulder has
     * none of those. The art bible's rule 7 asks for parallax, grain and debris
     * inside five metres on EVERY vantage, which means at least one layer whose
     * habitat is "ground".
     *
     * It is deliberately the cheapest layer in the table: a twenty-metre ring,
     * a thirteen-vertex lump, no wind, no subsurface term, no glow, and a
     * habitat test that most instances fail at stage 2. What it buys is the one
     * thing a heightfield cannot fake — a foreground object of known size, with
     * a shadow and an occluded underside, that the eye can measure the ground
     * against.
     */
    id: 'clinker',
    /**
     * Forty metres of ring, not twenty, and the dusk vantage is why.
     *
     * "Near plane" is not a fixed radius: it is wherever the bottom of the frame
     * lands, and that depends on the camera's height and pitch. The dusk camera
     * stands six metres up looking out along a shallow flank, so the ground at
     * the bottom edge of the frame is thirty to fifty metres away — outside a
     * twenty-metre ring entirely, which is why the first cut of this layer left
     * that shot as bare as it found it. Five-metre tiles across nineteen of them
     * reach forty, for the same instance count per square metre.
     */
    tile: 5,
    perTile: 30,
    ring: 19,
    // Ash and rock, with a little of everything else: cinder blows everywhere.
    chan: [0.18, 0.16, 1.0, 0.92],
    seed: 5,
    // width, height, arc (unused), terrain-normal alignment. A chip lies FLAT
    // on the slope it is resting on — alignment 1.0 — or it stands proud of a
    // hillside like a tombstone.
    shape: [0.20, 0.16, 0.0, 1.0],
    density: 0.52,
    windAmp: 0,
    // Basalt shading toward ash: the two ends of the palette's rock ramp.
    // Inside the ash ramp (#8a7f72 -> #4a423b) rather than below it. A chip
    // that reads a stop under the ground it lies on is not debris, it is a
    // speck — and a field of specks is the "confetti" this subsystem has been
    // told about before.
    tint: srgb(0x9a9084),
    tintAlt: srgb(0x6b635a),
    tintAltAmount: 0.45,
    sssTint: srgb(0x3a352f),
    // Rock does not transmit. The template's thickness is 0.02 and this takes
    // the remainder to nothing, so the term is not merely small — it is gone.
    sssAmount: 0,
    glowColor: BIO_TEAL,
    glowFrac: 0,
    template: 'clinker',
    lean: 0,
    // Barely sliced: debris is not a species and does not defer to one.
    dominance: [0.20, 0.55, 0.18],
    emergent: 0,
    patchPhase: 57.3,
    // Clinker drifts into hollows and against obstacles in loose scatters, so a
    // wide cell with a gentle pull: a few chips together, bare ground between.
    tuft: [1.60, 0.30],
  },
  {
    /**
     * Glow fungus — small ground mushrooms, and the palette's only vivid colour.
     *
     * This was a lobed moss cushion and it was the subsystem's worst asset: a
     * dome authored crown-up with its rim on the ground is a cone, and every
     * review shot named it. A cone cannot be shaded into a plant. What Ashenreach
     * ground actually wants is fungus, so it is fungus now — see fungusTemplate()
     * for the mesh and the vertex shader for the per-instance cap width, rim lobe
     * count, stipe length, size (over two and a half stops), yaw and tilt that
     * make a field of them a population.
     *
     * It is also the one thing in the frame allowed to be saturated, and by day
     * it now IS: glowFloor keeps a real emissive on the lit colonies at noon and
     * at dawn, where uGlowNight alone left the whole world at 3.3% saturated
     * pixels and none of them bioluminescent.
     */
    id: 'glowcap',
    tile: 7,
    // A quarter of the cushions' instance count. This mesh is four times the
    // triangles of a blade card, and — more to the point — sparse is what the
    // bible asks for. A hundred discrete mushrooms with bare ash between them
    // reads as an ecology; four hundred reads as a lawn.
    perTile: 24,
    ring: 19,
    chan: [0.35, 0.90, 0.45, 0.22],
    seed: 2,
    // width, height, arc (unused for fungus), terrain-normal alignment. The
    // template's cap radius is 0.405 of this and its per-instance width draw
    // tops out at 1.34x, so a unit-size instance is about a 40 cm cap on a
    // 15 cm stipe, and the shader's log size draw runs that from roughly 20 cm
    // to 90 cm across. Height is up from 0.30: the rebuilt cap has a real crown
    // above the margin instead of a lid, and it needs the room to be a dome
    // rather than the plate the review measured.
    shape: [0.33, 0.38, 0.0, 0.55],
    density: 0.74,
    windAmp: 0.06,
    tint: srgb(0xdcd1b5),
    tintAlt: srgb(0xb0baa8),
    tintAltAmount: 0.44,
    // Fungal flesh really is translucent and this is the one ground layer where
    // that is worth saying — but in verdigris, which is where the palette puts
    // its only green, not in the teal that belongs to the emissive.
    sssTint: srgb(0x9ebfae),
    sssAmount: 0.70,
    glowColor: BIO_TEAL,
    // The bioluminescence band, end to end. Per-instance hue jitter runs between
    // them so a colony is teal shading to violet rather than one flat mint.
    glowColorAlt: BIO_VIOLET,
    // Colonial: the fraction is of six-metre CELLS rather than of individual
    // plants, so a quarter of the cells lighting up reads as scattered colonies
    // with dark ash between them.
    glowFrac: 0.32,
    /**
     * Measured, not guessed.
     *
     * At 0.26 the daytime floor read cleanly at dawn (teal pixels appear where
     * there were none) and disappeared completely in the ash storm — which is a
     * BRIGHT frame: a high-key ochre wash whose ground sits around 0.3 linear, so
     * a 0.26 emissive is a fifth of a stop and vanishes. The bible names
     * bioluminescence as one of only two things permitted to be vivid and the
     * storm shot measured literally zero saturated pixels, so the floor has to be
     * set against the brightest scene it must survive, not the darkest. 0.45 is
     * still well under the tone curve's shoulder, still gated to a third of the
     * six-metre cells, and still only on the cap margin.
     */
    /**
     * 0.62 -> 0.44 with the cap rebuild, and it is a conservation-of-energy
     * argument rather than a retreat. The old cap put the atlas's emissive band
     * on a 4 cm rim wall and nothing else — a hairline, so the floor had to be
     * enormous for the total to be visible at all, and the result was the
     * "teal-rimmed flat plate" the coast review measured in broad daylight. The
     * crown now walks the cap band from 0.10 to 0.995, so the same mask covers
     * the outer third of the cap and falls off across it. Four times the area at
     * 0.7x the intensity is more light in the frame, distributed over a shape
     * instead of an outline.
     */
    glowFloor: 0.44,
    template: 'fungus',
    // Up to about fifteen degrees off plumb. Mushrooms lean; a field of them at
    // one attitude is the loudest instancing tell there is.
    lean: 0.27,
    dominance: [0.28, 0.70, 0.38],
    // No emergent stems: the shader gates that on gcBlade anyway, and stating it
    // as zero keeps the intent in the data.
    emergent: 0,
    patchPhase: 271.9,
    // A large cell with a firm-ish pull: fungus fruits in troops, and a troop is
    // half a dozen caps of assorted ages within a couple of metres.
    tuft: [2.10, 0.34],
  },
];

/**
 * Bioluminescent light pools.
 *
 * Emissive pixels alone do not make a night frame: a glowing cushion that lights
 * nothing around it reads as a sticker. These follow the nearest glowing
 * colonies and put real falloff on the ground beside them, which is what gives
 * the night shot a value hierarchy. The count is fixed for the life of the
 * scene — three recompiles every material in the world when a light count
 * changes, so a rig that grew and shrank with the view would hitch on every
 * step.
 */
/**
 * MUST stay constant at runtime. three's `projectObject` skips lights whose
 * `visible` is false, so toggling visibility changes `numPointLights`, which is
 * part of every material's program cache key — the whole scene then recompiles
 * on each change. Measured: walking cycled this 9..13 and accumulated 357
 * duplicate programs (of 512), each compile a visible stall. "Off" is
 * `intensity = 0`, never `visible = false`.
 *
 * 5 -> 3, AND THIS IS THE SINGLE LARGEST COST IN THE SUBSYSTEM. The note this
 * replaces claimed a resident light "costs nothing at all — no recompile, no new
 * draw". That is true of the CPU and false of every pixel in the frame: a point
 * light is a compile-time entry in `NUM_POINT_LIGHTS`, so every forward material
 * in the game — terrain, which covers most of a landscape frame, included —
 * evaluates a full attenuation and GGX lobe for it per fragment whether its
 * intensity is 21 or 0.
 *
 * Measured by paired ablation at medium, 1920x1080, each variant against its own
 * immediately-preceding baseline: making these five invisible (and taking the
 * recompile, so the number is the steady-state one) returned
 *
 *     dawn  45.9 -> 36.8 ms   20%
 *     ridge  39.7 -> 34.6 ms   13%
 *
 * i.e. about 3-4% of the whole frame per resident light. Nothing else in this
 * subsystem is worth 4% a unit. The scene carries fourteen of them in total —
 * six from `src/arch`, three from `src/vfx`, these — so the resident point-light
 * budget is plausibly a third of the frame, which nobody had priced.
 *
 * The count drops rather than the rig because the pools are now MERGED: see
 * pumpGlowLights. Colonies cluster, and at a 22 m night radius the pools of five
 * neighbouring caps overlap almost completely, so three lights placed at cluster
 * centroids carry the same illumination as five placed on individual caps. What
 * is lost is the ability to light six *separated* colonies at once, which the
 * search radius makes rare.
 */
const GLOW_LIGHTS = 3;
const GLOW_RANGE = 52;
/**
 * Candidates within this of an already-claimed pool are folded into it rather
 * than claiming a light of their own. Half the night pool radius: two caps
 * closer together than that are inside each other's falloff, so one light at
 * their centroid is not an approximation of two, it is very nearly the sum.
 */
const GLOW_MERGE = 11;

export class FloraSystem implements System {
  readonly id = 'flora';
  readonly order = 20;

  private group = new THREE.Group();
  private atlas: FloraAtlas | null = null;
  private field = new TerrainField();
  private terrainLod: TerrainLod | null = null;
  private canopies: Canopy[] = [];
  private ground: GroundCover[] = [];
  private contact: ContactPool | null = null;
  private groundContact: GroundContact[] = [];
  private scats: Scattered[] = [];

  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private camPos = new THREE.Vector3();
  private lastPos = new THREE.Vector3(1e9, 1e9, 1e9);
  private lastDir = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private sunDir = new THREE.Vector3(0, 1, 0);
  private sunRad = new THREE.Color();
  private windDir = new THREE.Vector2(1, 0);
  private ready = false;

  private glowLights: THREE.PointLight[] = [];
  private glowSources: Scattered[] = [];
  private glowNight = 0;
  private glowCand: { x: number; y: number; z: number; d: number; c: THREE.Color }[] = [];
  /** Cluster representatives, one per light. See pumpGlowLights. */
  private glowMerged: { x: number; y: number; z: number; d: number; c: THREE.Color; n: number }[] = [];

  /** Reported to the console once at boot; the budget claim has to be checkable. */
  stats = { instances: 0, blades: 0, uniqueTris: 0 };

  async init(ctx: Ctx): Promise<void> {
    const terrain = ctx.get<ITerrain>('terrain');
    if (!terrain || !terrain.ready) {
      console.warn('[flora] no terrain — vegetation disabled');
      return;
    }

    const aniso = Math.min(ctx.renderer.capabilities.getMaxAnisotropy(), 16);
    this.atlas = await buildFloraAtlas(aniso);

    // Float textures are only filterable with this extension. It is present on
    // every target GPU; the fallback exists so the failure mode is a visible
    // stepping rather than a black screen.
    const floatLinear = ctx.renderer.extensions.has('OES_texture_float_linear');
    await this.field.build(terrain, floatLinear);
    this.terrainLod = new TerrainLod(this.field);

    /**
     * Built before the canopies, because every Canopy holds a reference to it
     * and feeds it during selection. See Contact.ts: this is the view- and
     * light-independent half of ground contact, and it is what makes a plant
     * read as planted at night, under an ash storm, and when the sun is behind
     * it — the three cases a shadow map cannot cover.
     */
    this.contact = new ContactPool(this.field);
    this.group.add(this.contact.mesh);

    for (const rule of SPECIES) {
      const vis = VISUALS[rule.id];
      if (!vis) continue;
      const scat = scatter(rule, this.field, terrain, 0x5eed + rule.spacing * 977);
      this.scats.push(scat);
      this.stats.instances += scat.count;
      if (scat.count === 0) continue;
      const canopy = new Canopy(scat, vis, this.atlas, ctx.renderer, this.terrainLod, this.contact);
      this.stats.uniqueTris += canopy.triangleBudget;
      this.canopies.push(canopy);
      this.group.add(canopy.group);
      // Yield: seven species of mesh synthesis plus an impostor bake in one
      // task is long enough to be reported as a hang.
      await new Promise<void>((r) => setTimeout(r, 0));
    }

    for (const g of GROUND) {
      const layer = new GroundCover(g, this.field, this.atlas);
      this.ground.push(layer);
      this.stats.blades += layer.instances;
      this.group.add(layer.mesh);
      /**
       * The ground fungus gets a contact ring; the blade layers do not.
       *
       * A mushroom is a solid object with a cap wider than its stipe, and the
       * night review's #1 blocker is precisely that every cap in the field sits
       * on unshaded terrain. A three-centimetre grass card has no cap and no
       * gap: its contact is the baked gradient in aParam.w, and a decal a
       * quarter of the size of one texel would cost a hundred thousand
       * instances for nothing an image could resolve.
       *
       * Nine tiles across (about 24 m) rather than the layer's own nineteen —
       * an AO skirt on a 40 cm mushroom is under a pixel long before the
       * mushroom is, and the survivor set is unchanged because the ladder is
       * handed the LAYER's draw distance and only the tile window is cut.
       */
      if (g.template === 'fungus') {
        const gc = new GroundContact(g, this.field, layer.drawDist, 9);
        this.groundContact.push(gc);
        this.group.add(gc.mesh);
      }
    }

    // Bulb fungus is the teal colony; stoneflower the violet one. Both sit at
    // ground level, which is where a light pool has something to land on.
    this.glowSources = this.scats.filter((s) => s.rule.id === 'bulb' || s.rule.id === 'stone');
    for (let i = 0; i < GLOW_LIGHTS; i++) {
      const l = new THREE.PointLight(BIO_TEAL.getHex(), 0, GLOW_RANGE * 0.42, 2);
      l.name = `flora:glow:${i}`;
      l.castShadow = false;
      // Resident for the lifetime of the system — see GLOW_LIGHTS.
      l.visible = true;
      this.glowLights.push(l);
      this.group.add(l);
    }

    this.group.name = 'flora';
    ctx.scene.add(this.group);
    this.ready = true;

    console.info(
      `[flora] ${this.stats.instances} plants, ${this.stats.blades} ground-cover instances, ` +
        `${Math.round(this.stats.uniqueTris)} unique triangles`,
    );

    // One full selection before the first frame so nothing pops in at boot.
    this.refresh(ctx, true);
  }

  update(ctx: Ctx): void {
    if (!this.ready) return;
    this.syncEnvironment(ctx);
    this.refresh(ctx, false);
    this.pumpGlowLights();
  }

  /**
   * Point the bioluminescent light rig at the nearest glowing colonies.
   *
   * Candidate search is over the two 128 m buckets' worth of instances around
   * the camera, which is a few dozen distance tests — the rig is re-aimed only
   * when it will actually contribute, i.e. after dusk.
   */
  private pumpGlowLights(): void {
    const lights = this.glowLights;
    if (lights.length === 0) return;
    const night = this.glowNight;
    /**
     * The rig runs BY DAY as well, and that is the coast review's "the
     * bioluminescence is inert — it is currently a decal".
     *
     * Gating the whole rig on darkness meant that on every daylit vantage the
     * caps carried an emissive that lit precisely nothing: no ground bounce, no
     * rim on a neighbour, no contribution to the ambient under any of them. The
     * bible names bioluminescence as one of two things permitted to be vivid and
     * therefore as the strongest art-direction hook the frame has, and a vivid
     * colour that does not touch anything around it is a sticker.
     *
     * The daytime pool is a different object from the night one and is set up as
     * one below: a couple of per cent of the intensity over a three-metre radius
     * rather than a bonfire over twenty-two. That is the "tint the ash within
     * about a metre of each cap" the review asked for, and because the lights
     * already exist for the life of the scene it costs nothing at all — no
     * recompile, no new draw, eight more entries in a light list that is already
     * being built.
     */
    const dayPool = 1 - night;
    if (night < 0.06 && dayPool < 0.06) {
      for (const l of lights) l.intensity = 0;
      return;
    }

    const cand = this.glowCand;
    cand.length = 0;
    const R2 = GLOW_RANGE * GLOW_RANGE;
    for (const s of this.glowSources) {
      const col = s.rule.id === 'stone' ? BIO_VIOLET : BIO_TEAL;
      const bi = Math.floor((this.camPos.x + s.extent) / s.cell);
      const bj = Math.floor((this.camPos.z + s.extent) / s.cell);
      for (let j = bj - 1; j <= bj + 1; j++) {
        if (j < 0 || j >= s.cols) continue;
        for (let i = bi - 1; i <= bi + 1; i++) {
          if (i < 0 || i >= s.cols) continue;
          const b = j * s.cols + i;
          for (let k = s.bucketStart[b]; k < s.bucketStart[b + 1]; k++) {
            const o = s.order[k] * STRIDE;
            // Only the instances the shader actually lights. Hanging a light on
            // a cap that is not emitting is what makes a "glow" read as a
            // painted decal beside an unexplained pool of teal on the ash.
            if (s.data[o + OSEED] < GLOW_GATE) continue;
            const dx = s.data[o + OX] - this.camPos.x;
            const dz = s.data[o + OZ] - this.camPos.z;
            const d = dx * dx + dz * dz;
            if (d > R2) continue;
            cand.push({
              x: s.data[o + OX],
              // The emissive tissue is on the cap, not at the root; lifting the
              // pool off the ground is what makes it fall *onto* the ground.
              y: s.data[o + OY] + s.data[o + OSY] * 0.8,
              z: s.data[o + OZ],
              d,
              c: col,
            });
          }
        }
      }
    }
    cand.sort((a, b) => a.d - b.d);

    // Fold neighbours into the pool that already covers them.
    //
    // The rig used to take the N nearest caps, one light each. Bulb and
    // stoneflower are colonial — the scatter puts them down in patches — so the
    // N nearest caps are very often N caps of ONE patch, several of them inside
    // a couple of metres. Five lights were therefore being spent lighting one
    // clump from five points inside it, which is indistinguishable from lighting
    // it from its centre with the sum, while a second clump ten metres away got
    // nothing. Merging both fixes that and is what pays for the count coming
    // down: a light is worth 3-4% of the frame (see GLOW_LIGHTS), so a duplicate
    // pool is the most expensive redundancy in the subsystem.
    //
    // Greedy over the distance-sorted list, so the representative is always the
    // nearest member of its cluster and the merge is stable as the camera moves:
    // a cap can only ever be absorbed by one that is already closer, and that
    // ordering does not flicker.
    const merged = this.glowMerged;
    merged.length = 0;
    const mergeR2 = GLOW_MERGE * GLOW_MERGE;
    for (const c of cand) {
      let host: (typeof merged)[number] | null = null;
      for (const m of merged) {
        const dx = m.x - c.x;
        const dy = m.y - c.y;
        const dz = m.z - c.z;
        if (dx * dx + dy * dy + dz * dz <= mergeR2) {
          host = m;
          break;
        }
      }
      if (host) {
        // Intensity-summed, position-averaged. `n` is capped when it is read so
        // a forty-cap clump does not become a searchlight; what is wanted is the
        // brightness of a few overlapping pools, not of all of them.
        host.n++;
        const k = 1 / host.n;
        host.x += (c.x - host.x) * k;
        host.y += (c.y - host.y) * k;
        host.z += (c.z - host.z) * k;
        host.c.lerp(c.c, k);
        continue;
      }
      if (merged.length >= lights.length) continue;
      merged.push({ x: c.x, y: c.y, z: c.z, d: c.d, c: c.c.clone(), n: 1 });
    }

    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      const c = merged[i];
      if (!c) {
        l.intensity = 0;
        continue;
      }
      l.position.set(c.x, c.y, c.z);
      l.color.copy(c.c);
      // Merged pools ADD, up to a ceiling. Two caps in one clump really are
      // twice the emitter and the pool has to be twice as bright or the merge is
      // a dimming disguised as an optimisation; forty caps are not forty times a
      // readable pool, they are one bright patch, and a light sitting at their
      // centroid would blow out anything standing next to it. Exact below the
      // cap, saturating above it. 2.6 is well inside what the old rig could
      // already produce — five separate lights at 21 could sum to 105 in the
      // middle of a clump, against 55 here — so this cannot be brighter than the
      // thing it replaces.
      const gain = Math.min(2.6, c.n);
      // Fade with range as well as with night so a colony entering the search
      // radius brightens in rather than switching on.
      const near = 1 - THREE.MathUtils.smoothstep(Math.sqrt(c.d), GLOW_RANGE * 0.55, GLOW_RANGE);
      // The pool has to be readable ON THE GROUND, not just on the cap: an
      // emissive that lights nothing is the definition of a sticker.
      //
      // Two regimes out of one rig. After dark the colony is a real light
      // source and has to reach across a valley; by day it can only ever be a
      // tint on the ash it is standing on, so the radius collapses to about a
      // metre and a half of useful reach. Blending the radius rather than
      // switching it keeps dusk continuous.
      l.distance = GLOW_RANGE * (0.42 * night + 0.075 * dayPool);
      l.intensity = (21 * night + 1.6 * dayPool) * near * gain;
    }
  }

  /**
   * Push sun, sky and wind into every flora material.
   *
   * The sun is *read* from the atmosphere system — flora never creates a light —
   * and the aerial-perspective uniforms are the atmosphere's own module
   * singletons, already bound by the material factory, so fog cannot drift.
   */
  private syncEnvironment(ctx: Ctx): void {
    /**
     * The pixel-footprint scale the surface layer's ranges are measured in.
     *
     * One pixel at distance d covers d * 2*tan(fov/2) / height metres, and the
     * shader compares that against fwidth(), which is |dFdx| + |dFdy| and so runs
     * about 1.2x the bare footprint on a surface facing the lens (more at a
     * slant). Both factors live here so a species' surfaceRange is in metres.
     *
     * This replaces a baked 1/1740 that was justified as "1920 px across a
     * 62-degree horizontal field". The camera is 65 degrees VERTICAL on 16:9,
     * i.e. 97 horizontal, so the true figure at 1080p is 848 px per unit of
     * distance — the constant was out by 2.05x, and with the fwidth factor on top
     * every range in the subsystem was being enforced at roughly 0.4 of its
     * stated value. That single number is most of why the caps read as clay:
     * the parasol's declared 130 m was a real 55 m.
     *
     * Derived per frame rather than baked, so it stays correct at 4K, at a
     * different field of view, and after a resize.
     */
    const px =
      ((2 * Math.tan((ctx.camera.fov * Math.PI) / 360) * 1.2) / Math.max(1, ctx.size.h)) *
      ((globalThis as unknown as { __floraPx?: number }).__floraPx ?? 1); // AB-TEMP
    // Its own pass, deliberately: everything below is inside `if (sky)`, and a
    // frame without an atmosphere system must not be a frame in which every plant
    // silently loses its surface detail.
    for (const set of this.allUniforms()) set.uSurfPx.value = px;

    const sky = ctx.get<IAtmosphere>('sky');
    if (sky) {
      const sun = sky.sun;
      this.sunDir.copy(sun.position).sub(sun.target.position);
      if (this.sunDir.lengthSq() < 1e-8) this.sunDir.set(0, 1, 0);
      this.sunDir.normalize();
      this.sunRad.copy(sun.color).multiplyScalar(sun.intensity);
      const w = sky.weather;
      this.windDir.copy(w.windDir);
      if (this.windDir.lengthSq() < 1e-6) this.windDir.set(1, 0);
      this.windDir.normalize();

      // Night factor from the ambient irradiance rather than from the clock:
      // an ash storm at noon is dark, and the fungus should answer to the light
      // it actually stands in.
      const amb = w.ambient;
      const lum = amb.r * 0.25 + amb.g * 0.5 + amb.b * 0.25;
      /**
       * The ambient, and ONLY the ambient.
       *
       * It is tempting to gate this on the key light's elevation instead, on the
       * theory that fungus should not glow while the sun is up. It is also
       * wrong: after dusk the atmosphere system re-points the same
       * DirectionalLight at whichever moon is highest, so sky.sun at 23:24 is
       * a moon sitting at 0.56 elevation. Anything reading that vector as a sun
       * altitude concludes it is the middle of the day and switches the
       * bioluminescence off in the one frame that exists to show it. Measured:
       * ambient luminance runs 0.118 at dawn, 0.132 at noon and 0.072 at night,
       * which separates the cases on its own and does so for an ash storm at
       * midday as well.
       */
      const day = THREE.MathUtils.smoothstep(lum, 0.030, 0.105);
      // Emissive intensity, in scene-linear units, and it has to sit BELOW the
      // point where the tone curve stops being linear or the caps lose all
      // their modulation in the brightest channel and go chroma-fringed white.
      // At 1.2 the hottest tissue lands around 1.05 linear — several times the
      // night scene's white, so it still blooms, but with the whole triple still
      // on the curve and the bible's #3fd6c0 intact.
      /**
       * The daytime floor has to be measured against the DARKEST surface it
       * lands on, not the average one.
       *
       * 0.05 sounds like nothing. On a cap underside it is not: the gill band's
       * occlusion takes the diffuse there to about 0.002 in scene-linear units,
       * while the emissive is 0.05 times a normalised teal — twenty times
       * larger. So the "suggestion of bioluminescence by day" was in fact the
       * dominant term on every parasol underside in the game, painting mint
       * stripes down the one surface the art bible wants dark, in frames whose
       * every other pixel is ochre. Emissive floors must be set relative to the
       * shadow they sit in; this one lands at roughly a quarter of the local
       * diffuse, which is a suggestion.
       */
      const glow = 0.005 + 1.195 * (1 - day);
      this.glowNight = 1 - day;

      for (const set of this.allUniforms()) {
        (set.uSunDirW.value as THREE.Vector3).copy(this.sunDir);
        (set.uSunRadW.value as THREE.Color).copy(this.sunRad);
        (set.uSkyRadW.value as THREE.Color).copy(amb);
        (set.uWindDir.value as THREE.Vector2).copy(this.windDir);
        set.uWindSpeed.value = w.windSpeed;
        set.uWindTime.value = ctx.time.elapsed;
        set.uFloraTime.value = ctx.time.elapsed;
        set.uGlowNight.value = glow;
        // Golden-ratio rotation of the LOD dissolve pattern. Any period that
        // divides the TAA history length would beat against it and show up as a
        // crawling stipple instead of a dissolve.
        set.uDitherPhase.value = (ctx.time.frame % 64) * 0.6180339887 % 1;
      }
    }
  }

  private *allUniforms(): Generator<Record<string, THREE.IUniform>> {
    for (const c of this.canopies) {
      for (const s of c.uniformSets) yield s.uniforms;
      // Impostors carry their own material but share the uniform objects, so
      // they are already updated by the loop above. Nothing to do here.
    }
    for (const g of this.ground) yield g.materials.uniforms;
  }

  /**
   * Re-select visible instances.
   *
   * Skipped entirely while the camera is still: the wind is a pure function of
   * world position and time inside the vertex shader, so a stationary view costs
   * nothing at all on the CPU.
   */
  private refresh(ctx: Ctx, force: boolean): void {
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    cam.getWorldPosition(this.camPos);
    cam.getWorldDirection(this.fwd);
    const moved = this.camPos.distanceToSquared(this.lastPos) > 0.5 * 0.5;
    const turned = this.fwd.dot(this.lastDir) < 0.9997;
    if (!force && !moved && !turned) return;
    this.lastPos.copy(this.camPos);
    this.lastDir.copy(this.fwd);

    this.projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    this.contact?.begin(this.camPos);
    for (const c of this.canopies) c.select(this.camPos, this.frustum);
    this.contact?.end();
    for (const g of this.ground) g.update(this.camPos, this.frustum);
    for (const g of this.groundContact) g.update(this.camPos, this.frustum);
  }

  dispose(): void {
    for (const c of this.canopies) c.dispose();
    for (const g of this.ground) g.dispose();
    for (const g of this.groundContact) g.dispose();
    this.groundContact = [];
    this.contact?.dispose();
    this.contact = null;
    this.canopies = [];
    this.ground = [];
    this.scats = [];
    for (const l of this.glowLights) l.dispose();
    this.glowLights = [];
    this.glowSources = [];
    this.glowCand.length = 0;
    this.field.dispose();
    this.atlas?.dispose();
    this.atlas = null;
    this.group.removeFromParent();
    this.group.clear();
    this.ready = false;
  }
}
