import * as THREE from 'three';
import { BAND, bandV, type FloraAtlas } from './Atlas';
import { FIELD_GLSL, type TerrainField } from './Field';
import { smoothstep, toroidalPoisson } from './Noise';
import { createFloraMaterials, type FloraMaterialSet } from './Materials';

/**
 * GPU ground cover.
 *
 * The field is a ring of tiles that follows the camera. Each tile carries the
 * same toroidal Poisson-disc point set — blue noise that stays blue across tile
 * seams — reflected by a per-tile hash so the repeat is never readable. Because
 * a blade's world position is derived from its *tile* rather than from the
 * camera, the pattern is fixed in the world: nothing swims, nothing crawls, and
 * crossing a tile boundary changes only which tiles are drawn.
 *
 * Ground height, terrain normal and habitat all come from textures sampled in
 * the vertex shader, so 200k blades cost zero CPU per frame.
 */

export interface GroundOpts {
  id: string;
  /** Tile edge, metres. */
  tile: number;
  /** Blades per tile. */
  perTile: number;
  /** Tiles per side of the ring; must be odd. */
  ring: number;
  /**
   * Habitat weights dotted with the ecology texel (grass, fung, ash, rock).
   * A weight vector rather than a channel index because the interesting layers
   * are mixtures: ash scrub wants ash plus a little of the fungal ground, and
   * keying it to a single channel is what left every ash flat bare.
   */
  chan: [number, number, number, number];
  /** Decorrelates the per-layer Poisson point set. */
  seed: number;
  /** width, height, arc, terrain-normal alignment. */
  shape: [number, number, number, number];
  density: number;
  /**
   * Fraction of tufts that carry bioluminescence, 0..1. The glow itself is the
   * atlas mask; this gates it per tuft so a night field reads as scattered
   * colonies rather than a uniformly radioactive lawn.
   */
  glowFrac: number;
  windAmp: number;
  tint: THREE.Color;
  tintAlt: THREE.Color;
  tintAltAmount: number;
  sssTint: THREE.Color;
  /**
   * Ground cover is LOW-ALBEDO geometry, so the transmission term is not a
   * highlight on it — it is most of its colour.
   *
   * Measured on the vale capture at noon: a cushion's diffuse outgoing radiance
   * is (0.070, 0.061, 0.026) linear, and the subsurface term on top of it is
   * (0.013, 0.039, 0.030) — because uSssTint was a saturated teal (0x7fd0bc)
   * and thickness on that template is 0.5. The sum, (0.083, 0.100, 0.056), is
   * GREEN-DOMINANT: a green plant produced by an ochre albedo under an ochre sun,
   * in a palette that permits exactly one grey-green. That arithmetic is the
   * complete explanation for the review's "dark-green cones", "dark-teal cone"
   * and "solid dark cut-out" — nothing in the frame was ever green.
   */
  sssAmount?: number;
  glowColor: THREE.Color;
  /** Second bioluminescence hue; per-instance jitter runs between the two. */
  glowColorAlt?: THREE.Color;
  /**
   * Daytime emissive floor. The bible names bioluminescence as one of only two
   * things permitted to be vivid, and the dawn frame measured 3.3% of pixels
   * above 0.5 saturation with none of it glow — nothing to anchor the
   * desaturation against. Glow fungus carries a floor; grass barely does.
   */
  glowFloor?: number;
  /**
   * 'blade' is a grass/scrub card; 'fungus' is a small mushroom with a stipe,
   * a gilled underside and a domed cap, reshaped per instance in the shader.
   *
   * The 'mat' cushion this replaces was the single most-cited defect in the
   * review and it appeared, under six different descriptions, in seven of the
   * eight shots: a lobed dome authored crown-up with its rim on the ground is
   * geometrically a CONE, and rendered without an alpha silhouette it is a solid
   * smooth cone. "Small dark-green cones", "a single untextured cone primitive
   * instanced hundreds of times", "the same smooth low-poly cone on a thin stem",
   * "flat-shaded cone and pyramid primitives" are all this one mesh. No amount of
   * shading fixes a silhouette; the mesh had to go.
   */
  template: 'blade' | 'fungus' | 'clinker';
  /**
   * Blades per instance: 1 is a single card, 3 is a splayed tuft.
   *
   * A single card has no silhouette from its own edge, so at any azimuth where
   * the eye is near its plane it degenerates to a sliver — and a foreground full
   * of slivers is the "flat green tape strips" and "solid-fill polygon shards"
   * of the review. A tuft has a silhouette from every direction and reads as
   * several plants sharing a root, which is what ground cover is. Only worth it
   * where a card is more than a few pixels across, so the coarse outer rings
   * stay at one.
   */
  blades?: number;
  /**
   * Cross-rows in the blade template, below the tip. Three (the default) is the
   * near-field card; two halves the triangle count and is what a ring that
   * starts at forty metres should be paying. Ignored by the cushion template.
   */
  rows?: readonly number[];
  /**
   * Inner radius, metres. A layer with `distMin > 0` is a coarse outer ring: it
   * fades IN over the approach to that radius so it does not double up on the
   * fine layer underneath it. This is how the field reaches past the point where
   * a dense near-field ring stops being affordable, instead of ending at a line.
   */
  distMin?: number;
  /** Maximum lean off vertical, as a tangent. 0.16 is about 9 degrees. */
  lean?: number;
  /**
   * Species dominance slice over the shared decametre field, as [lo, hi,
   * amount]. Passing lo > hi reverses the ramp, which is how two layers are
   * given complementary halves of the same field and therefore form stands that
   * abut instead of overlapping. amount is how completely the layer defers.
   */
  dominance: [number, number, number];
  /** Fraction of blades that grow as emergent stems above the sward. */
  emergent: number;
  /**
   * Offset applied to the clumping noise. Layers that are different SPECIES must
   * differ here so their clumps land in different hollows; layers that are two
   * distance rings of the SAME species must share it, or the coarse ring would
   * clump somewhere the fine ring does not and the seam between them would be
   * visible as a change of pattern rather than of size.
   */
  patchPhase: number;
  /**
   * [cell size in metres, pull]. Gathers the layer's blades into tufts of a few
   * cards each. A pull of 0 leaves the raw Poisson set; 1 collapses every cell
   * to a point. Cushions want a large cell and almost no pull — a colony of
   * lichen is not a tuft — while grass wants a half-metre cell and a firm one.
   */
  tuft: [number, number];
}

export const GROUND_VERT_PARS = /* glsl */ `
${FIELD_GLSL}
attribute float aIdx;
uniform vec4      uGCParams;      // tile, bladesPerTile, drawDist, glowFrac
uniform vec4      uGCChan;        // habitat weights over (grass, fung, ash, rock)
uniform vec4      uGCShape;       // width, height, arc, align
uniform vec2      uGCCenterTile;
uniform vec2      uTileTexSize;
uniform float     uGCDensity;
uniform vec4      uGCVar;          // template (0 blade / 1 cushion), lean, distMin, patch phase
uniform vec4      uGCStand;        // dominance lo, dominance hi, dominance amount, emergent frac
uniform vec2      uGCTuft;         // tuft cell size (m), pull toward the tuft centre
uniform sampler2D uTileTex;
uniform sampler2D uPointTex;
uniform vec3      uEyePos;        // the EYE, valid in the shadow pass too
`;

/**
 * Killing a blade costs nothing; drawing one costs everything.
 *
 * gl_Position outside the clip volume on every vertex of a primitive removes
 * it before the rasteriser ever sees it, and because every quantity the survival
 * test reads is a function of the blade's WORLD POSITION — identical for all
 * seven vertices of the card — the whole primitive always takes the same branch.
 * There is no partial-triangle case to worry about.
 *
 * The varyings are left unwritten deliberately. A clipped primitive never runs a
 * fragment shader, so there is nothing downstream to read them.
 */
const GC_CULL = 'gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return;';

/**
 * Every random here is a hash of the blade's WORLD position, never of its
 * instance index. The instance index is camera-relative — the ring renumbers
 * itself every time the camera crosses a tile — so seeding from it would make
 * every blade in the field re-roll its height, yaw and survival as you walk.
 *
 * ── The shape of this shader is a cull ladder, and that is the point. ─────────
 *
 * The field submits about a hundred thousand instances per frame and, on a
 * typical vantage, draws a small minority of them: the rest are thinned out by
 * distance, by habitat, by the patch mask or by slope. That has always been
 * true. What was NOT true is that they were cheap — the old body computed the
 * blade's ground height, its terrain normal, six octaves of noise, seven hashes,
 * the wind field and the full bend before multiplying the result by a survival
 * flag of zero. A quarter of a million dead blades were being shaded to
 * completion and then collapsed to degenerate triangles.
 *
 * So the tests are now ordered by what they cost to evaluate, cheapest first,
 * and each one exits. Because every factor of the survival probability is in
 * [0,1] and they only ever multiply, a blade rejected at an early stage would
 * have been rejected at every later one: the surviving set is bit-for-bit the
 * set the old shader drew.
 *
 *   stage 0  tile + point + tuft            2 texture fetches   — unavoidable
 *   stage 1  distance thinning              0 fetches           — kills ~60%
 *   stage 2  habitat                        1 fetch             — kills bare rock,
 *                                                                 lava, water, and
 *                                                                 every vantage a
 *                                                                 layer does not
 *                                                                 belong on at all
 *   stage 3  patch + dominance              3 value-noise
 *   stage 4  slope                          3 fetches (height + normal)
 *   stage 5  the blade itself               everything else
 *
 * The measured effect on the ridge vantage — an ash flat carrying no ground
 * cover the eye can find — is that a subsystem which cost 19 ms to draw nothing
 * now exits at stage 2 or 3 for essentially every instance.
 */
/**
 * Stages 0 to 4 of the ladder, plus every per-instance draw that decides where
 * an instance IS and how big it is — and nothing that decides what it looks
 * like. Exported because the ground-contact ring (Contact.ts) has to select
 * *exactly* the same survivors at exactly the same world positions and sizes:
 * a contact decal that lands anywhere but under its own mushroom is worse than
 * no decal at all, and the only way to guarantee registration is for the two
 * programs to run the identical arithmetic off the identical uniforms rather
 * than two copies that drift the first time either is tuned.
 *
 * Leaves in scope: wxz (world position), gcH, gcN, gcCover, gcDist, gcDn,
 * gcBw, gcBh, gcYaw, and the hash channels.
 */
export const GC_LADDER = /* glsl */ `
  float gcK = uGCParams.y;
  float gcTi = floor(aIdx / gcK);
  float gcBi = aIdx - gcTi * gcK;

  vec2 gcTuv = vec2(
    (mod(gcTi, uTileTexSize.x) + 0.5) / uTileTexSize.x,
    (floor(gcTi / uTileTexSize.x) + 0.5) / uTileTexSize.y);
  vec2 gcTile = uGCCenterTile + texture2D(uTileTex, gcTuv).xy;

  vec2 gcPt = texture2D(uPointTex, vec2((gcBi + 0.5) / gcK, 0.5)).xy;
  // Reflect the point set per tile. A reflection maps a toroidal Poisson set to
  // another toroidal Poisson set, so the disc guarantee survives while the eye
  // loses the repeat.
  vec2 gcSym = step(vec2(0.5), fHash22(gcTile + vec2(17.3, 5.1)));
  gcPt = mix(gcPt, vec2(1.0) - gcPt, gcSym);
  vec2 wxz = (gcTile + gcPt) * uGCParams.x;

  /**
   * Tufting.
   *
   * Grass does not grow one blade at a time; it grows in tufts. A Poisson-disc
   * set is, by construction, the LEAST tufted arrangement that exists — every
   * point is the same distance from its neighbours — and thinning such a set
   * with a cover mask only turns an even sprinkle into a sparser even sprinkle.
   * That is why the field kept reading as scattered debris no matter how the
   * density was tuned: the problem was never how many cards there were, it was
   * that no two of them were ever close enough to look related.
   *
   * Pulling each blade part of the way toward the centre of a sub-metre cell
   * gathers them into clumps of three or four, while the cell centres themselves
   * stay as evenly distributed as the blades used to be — so the tufts are blue
   * noise even though the blades no longer are. One floor and one hash.
   */
  /**
   * ...AND THE TUFT LATTICE IS THE NIGHT BLOCKER. It has to be jittered by a
   * FULL cell and warped, or the tufting throws the blue noise away.
   *
   * mix(blade, cellCentre, 0.6) pulls six tenths of the way onto a REGULAR
   * GRID. The centres were jittered by +/-0.36 of a cell, so no two tuft centres
   * could ever be closer than 0.28 of a cell nor further than 1.72 — a jittered
   * lattice with a hard minimum spacing and, critically, with its rows and
   * columns still aligned to the world axes. At any range where a 55 cm cell
   * subtends a few pixels the eye integrates the individual cards away and reads
   * the lattice directly, which is exactly the review's "flawless diagonal
   * quincunx of identical instances at uniform spacing": the diagonal is the
   * lattice seen at an oblique angle. The scatter was never the problem — the
   * TUFTING was quantising it.
   *
   * Two changes, and both are needed:
   *
   *  - jitter by a full cell width (1.0, not 0.72). At that amplitude adjacent
   *    cell centres can coincide, so the minimum spacing constraint that made the
   *    grid legible is gone and clumps of two or three tufts form on their own.
   *  - warp the lattice COORDINATE by a low-frequency noise before flooring it,
   *    so the cell boundaries themselves wander. A jittered grid still has a
   *    global orientation and a constant pitch; a warped one has neither, and
   *    there is no direction left along which rows can line up. One value-noise
   *    fetch, and it is the difference between a pattern and a population.
   *
   * It is also applied AFTER the distance test rather than before it. The warp is
   * the only thing this shader added that is not a texture fetch, and paying two
   * value-noise lattices on the sixty per cent of instances the distance ladder
   * throws away would have made the layer measurably dearer for nothing. The
   * displacement is at most half a tuft cell, so neither gcDist nor the survival
   * hash can tell the difference.
   */

  /**
   * The EYE, explicitly — not three's cameraPosition.
   *
   * three binds cameraPosition from whatever camera it is rendering with, and
   * in the shadow pass that is the light: every cascade sits hundreds of metres
   * back along the sun vector, so gcDist came out at many times the layer's draw
   * distance, gcThin evaluated to zero and every instance in the shadow pass
   * collapsed to a degenerate triangle. That is why this field cast nothing at
   * all, and why the review can measure a ground fungus with lit ash visible
   * under its leading edge. Passing the eye position in as a uniform is what
   * lets the same survival ladder select the same blades in both passes.
   */
  float gcDist = distance(uEyePos.xz, wxz);

  /**
   * STAGE 1 — distance. Two-stage falloff, and now also the ring's outer
   * dissolve, which used to be a per-pixel discard in the fragment shader.
   *
   * Density has to reach ZERO at the ring edge, not 24% of it. The old ramp held
   * a quarter of the population right up to a hard threshold, which on a ridge
   * seen at a grazing angle compresses into a handful of pixels and reads as a
   * straight cull line with full-density grass on one side and bare plain on the
   * other. Thinning to nothing over the outer 40% of the ring, and only then
   * dissolving the survivors out, is what turns a line into a gradient.
   *
   * The dissolve moved here from floraDither(). Per-pixel and per-blade hashed
   * coverage are the same dissolve when a card is two pixels across, which is
   * all any card at 85-100% of the draw distance ever is — but a per-blade one
   * costs nothing, removes the blade's fragments as well as its pixels, and,
   * critically, leaves this material with NO discard in it at all. A fragment
   * shader that may discard cannot be depth-tested before it runs, and a grass
   * field seen at a grazing angle is the single most overdrawn thing in the
   * frame; getting early-Z back on it is worth more than the dither ever cost.
   */
  float gcDn = gcDist / uGCParams.z;
  /**
   * The far floor is 0.34, not 0.20.
   *
   * Thinning to a fifth of full density by the middle of the ring is a
   * reasonable cost saving and an unreasonable picture: it puts coverage well
   * under twenty per cent everywhere past about a third of the draw distance,
   * which is exactly what the vale review measured ("the bare smeared ground
   * shows through everywhere") and most of what the ridge review measured. A
   * card at that range is two pixels, so the saving per instance is real but the
   * instance is also nearly free — this is a vertex-bound layer, and the blades
   * that survive here are the two-row far template.
   */
  /**
   * The shadow pass only draws the NEAR field, and the cut is a hard exit.
   *
   * A 40 cm cap forty metres out projects a shadow well under one texel of any
   * cascade that can still see it, so every instance past that radius is three
   * cascades of vertex work for nothing an image could distinguish. Cutting
   * here — before the height fetch, before the normal, before the wind — is what
   * makes the caster affordable at all: the pass costs the near hundred or so
   * mushrooms whose contact shadow is the entire point of having it.
   */
  if (uShadowPass > 0.5 && gcDist > 38.0) { ${GC_CULL} }
  float gcThin = mix(1.0, 0.34, smoothstep(0.20, 0.86, gcDn)) * (1.0 - smoothstep(0.80, 1.0, gcDn));
  gcThin *= 1.0 - smoothstep(uGCParams.z * 0.85, uGCParams.z, gcDist);
  // A coarse outer ring fades in rather than starting at a radius, so the two
  // rings overlap through a band instead of abutting.
  if (uGCVar.z > 0.0) {
    gcThin *= smoothstep(uGCVar.z * 0.45, uGCVar.z, gcDist)
            * smoothstep(uGCVar.z * 0.45, uGCVar.z * 0.85, gcDist);
  }
  // The survival draw. Every later stage only ever multiplies the probability
  // down, so this one comparison can be repeated as the bound tightens.
  float gcPick = fHash12(wxz * 3.17 + 0.7);
  if (gcPick >= gcThin * uGCDensity) { ${GC_CULL} }

  // STAGE 1b — tufting. See the note at the top: a warped, fully-jittered cell
  // lattice, gathering blades into clumps without quantising them onto a grid.
  vec2 gcTuftW = wxz / uGCTuft.x
               + vec2(fValue2(wxz * 0.037 + 5.3), fValue2(wxz * 0.037 + 19.7)) * 1.6 - 0.8;
  vec2 gcTuftC = floor(gcTuftW);
  vec2 gcTuftP = (gcTuftC + 0.5 + (fHash22(gcTuftC + 3.1) - 0.5)) * uGCTuft.x
               + (wxz - gcTuftW * uGCTuft.x);
  wxz = mix(wxz, gcTuftP, uGCTuft.y);

  // STAGE 2 — habitat. One fetch, and it is the test that empties a whole
  // vantage: a layer keyed to grass over an ash flat, or to ash over open water,
  // rejects here before touching the heightfield.
  vec4  gcEco = fieldEco(wxz);
  float gcCover = clamp(dot(gcEco, uGCChan), 0.0, 1.0);
  if (gcPick >= gcCover * gcThin * uGCDensity) { ${GC_CULL} }

  // Two octaves of patchiness: metre-scale tufts inside decametre-scale swards.
  // The ashlands are sparse, not lush. A cover mask that only thins never opens
  // up, and a continuous carpet of identical tufts reads as a wheat field —
  // which is a worse art-direction failure than the bare ground it replaced.
  // Biting harder leaves real gaps of ash between the clumps.
  // Sward scale and clump scale. The fine octave sits at about three metres —
  // the size of a clump and, more to the point, the size of the bare ground
  // BETWEEN clumps. Negative space is what makes density read; an unbroken
  // carpet from the lens to the horizon reads as one texture however varied the
  // individual cards are.
  /**
   * The patch field is PHASED PER LAYER, and that one word is most of the fix
   * for "a uniform dark mat".
   *
   * Every layer evaluated fValue2(wxz * 0.045) — the same function at the same
   * world coordinate — so all four thinned out in exactly the same places and
   * clumped in exactly the same places. Four species stacked in perfect
   * registration are not four species: they are one mat with four card shapes in
   * it, which is precisely what the review saw. Offsetting the sample point by a
   * per-layer phase costs nothing and makes the grass clumps and the scathecraw
   * clumps land in different hollows.
   */
  vec2 gcPO = vec2(uGCVar.w, uGCVar.w * 1.73);
  float gcPatch = fValue2(wxz * 0.045 + gcPO) * 0.58 + fValue2(wxz * 0.34 + gcPO * 3.1) * 0.42;
  gcCover *= smoothstep(0.38, 0.80, gcPatch + 0.12);

  /**
   * Species dominance.
   *
   * One shared decametre field, sliced differently per layer: where the slice
   * favours scathecraw the ash grass thins away and vice versa. Because the
   * field is SHARED and the slices are complementary, the layers form stands
   * that abut along a boundary instead of three carpets laid over one another.
   * A reversed ramp is expressed by passing lo > hi — the division handles the
   * sign, which smoothstep() would not.
   */
  float gcDom = fValue2(wxz * 0.021 + 7.31);
  float gcDomT = clamp((gcDom - uGCStand.x) / (uGCStand.y - uGCStand.x), 0.0, 1.0);
  gcDomT = gcDomT * gcDomT * (3.0 - 2.0 * gcDomT);
  gcCover *= mix(1.0, gcDomT, uGCStand.z);
  gcCover *= uGCDensity;
  if (gcPick >= gcCover * gcThin) { ${GC_CULL} }

  // STAGE 4 — slope, and the first time this blade needs to know where the
  // ground is. Three fetches: one height plus the two forward differences the
  // normal is built from.
  float gcH = fieldHeight(wxz);
  vec3  gcN = fieldNormal(wxz, gcH);
  gcCover *= 1.0 - smoothstep(0.20, 0.46, 1.0 - gcN.y);
  if (gcPick >= gcCover * gcThin) { ${GC_CULL} }

  // ---- STAGE 5: this blade is drawn. Everything below runs for survivors only.

  /**
   * Three mid-scale fields off one lattice.
   *
   * Stand height, hue drift and value drift were three separate value-noise
   * evaluations at 0.052, 0.068 and 0.115 — three floors, three fracts and
   * twelve corner hashes for three numbers that are all doing the same job
   * (breaking the sward into stands at roughly the same scale). One lattice with
   * three independent channels is the same information for a third of the work.
   *
   *   x  stand height. A sward with one height class has no silhouette against
   *      the ground it stands on however much per-blade jitter it carries,
   *      because the jitter averages out over any patch bigger than a few cards.
   *      Cropped stands and rank ones ARE a shape the eye reads at a hundred
   *      metres.
   *   y  hue. Colour in STANDS, not in static — an ochre drift of dry grass
   *      running into a grey-green stand of fresh growth, with a boundary that
   *      is a shape.
   *   z  value. The sunlit crest of a clump and the shaded hollow beside it are
   *      different colours before any light touches them.
   *
   * Phased per layer for the same reason the patch field is.
   */
  vec3  gcMid = fValue2x3(wxz * 0.060 + gcPO * 0.37);
  float gcStandH = 0.62 + 0.72 * smoothstep(0.24, 0.78, gcMid.x);

  /**
   * Cards widen with distance so a sub-pixel blade still has something to cover.
   *
   * 2.6 -> 1.9, because at 2.6 the widening very nearly cancelled perspective:
   * "flat triangles at roughly constant screen size regardless of distance,
   * visible from the near plane all the way back at the same apparent scale" is
   * a direct measurement of this term overdoing its job, and a foreground detail
   * hierarchy needs things to actually get smaller. The aliasing it was fighting
   * is now handled where it belongs, by collapsing per-instance contrast into the
   * layer mean as the card shrinks (see fTint below).
   *
   * A mushroom is exempt: widening it changes its species.
   */
  float gcBoost = mix(1.0, mix(1.9, 1.20, min(uGCVar.x, 1.0)), smoothstep(0.22, 1.0, gcDn));

  /**
   * Nine per-blade draws out of two hashes.
   *
   * These were seven separate hashes of seven scaled copies of wxz, each
   * repeating the whole extract-randomness-from-a-float dance to yield one or
   * two numbers. fHash42 pays that setup once for four independent channels.
   */
  vec4  gcHA = fHash42(wxz * 7.31 + 3.7);
  vec4  gcHB = fHash42(wxz * 5.771 + 19.31);
  vec2  gcR2 = gcHA.xy;      // height, width
  float gcR3 = gcHA.z;       // yaw, wind phase, instance seed
  float gcEm = gcHA.w;       // emergent-stem draw
  vec2  gcLean = gcHB.zw;

  /**
   * Shape variants.
   *
   * One template geometry, but the profile it is bent into is rolled per
   * instance, which is cheaper than four meshes and gives more than four
   * silhouettes: a needle spike, a broad strap leaf blunted at the tip, a
   * twisted blade and a recurved arc, in every combination. Two identical
   * sprites stamped across a foreground is the defect this exists to kill.
   */
  vec2  gcVH = gcHB.xy;
  /**
   * Three templates, not two. uGCVar.x is 0 for a card, 1 for a mushroom and
   * 2 for a lump of ash clinker; the flags are derived rather than branched on
   * because the value is a UNIFORM, so every invocation in a draw takes the
   * same path and the dead ones cost a handful of ALU with no divergence.
   */
  float gcFung  = step(0.5, uGCVar.x) * step(uGCVar.x, 1.5);
  float gcRock  = step(1.5, uGCVar.x);
  float gcSolid = gcFung + gcRock;
  float gcBlade = 1.0 - gcSolid;
  // Spatulate: keeps its width to the tip instead of drawing to a point.
  float gcSpat = step(0.60, gcVH.x) * (0.45 + 0.55 * gcVH.y) * gcBlade;
  // Twist: rotates the card about its own growth axis along its length. A shear
  // in +z only worked for a single plane whose width lay in x; a rotation is the
  // same read and is correct for a crossed pair as well.
  float gcTwist = step(0.72, gcVH.y) * (0.4 + 0.6 * gcVH.x) * gcBlade;

  // Height tapers toward the draw limit as well as thinning out. Thinning
  // alone leaves a hard ring on the ground where full-height blades stop dead;
  // shrinking them as they thin makes the sward sink into the terrain's own
  // lichen texture instead of ending at a line.
  float gcFar = 1.0 - smoothstep(uGCParams.z * 0.50, uGCParams.z, gcDist);
  // Height and width vary independently over better than a 2:1 range, and the
  // spatulate variants trade height for width the way a real strap leaf does.
  // Emergent stems: a clustered minority that stands twice the height of the
  // sward around it. Real ground cover is never one canopy — it is a mat with
  // seed heads and old flower stalks poking out of it, and those are what break
  // the top edge of the field into something other than a straight line.
  float gcEmerge = step(1.0 - uGCStand.w * (0.35 + 1.30 * gcStandH), gcEm) * gcBlade;

  // The gcAlive factor that used to scale both axes is gone: a blade that
  // reaches this line has already passed every survival test, so it was a
  // multiply by one on the survivors and a full shader's worth of wasted work
  // on everyone else.
  /**
   * A LOG size distribution, not a linear one.
   *
   * "Every parasol cap in the frame is the same dome at the same size" and
   * "there is no size hierarchy, no age variation" are both this number. A
   * uniform draw over a 2:1 range puts almost every instance within a stop of the
   * mean, so a field of them has one apparent size however wide the range on
   * paper. Drawing in the exponent instead spreads the population over two and a
   * half stops with the mass in the middle, which is what a real population of
   * mixed ages actually looks like: a few tiny buttons, a few that are twice
   * everything around them, and a readable hierarchy between.
   */
  float gcSize = exp2((gcR2.x - 0.42) * 2.60);
  /**
   * ...and a mushroom is not a UNIFORM scale of one mushroom.
   *
   * The fungus path used gcSize for both axes, so every instance was the same
   * object at a different distance — which is the one kind of variation the eye
   * corrects for automatically and therefore does not see. "Identical cap
   * silhouette, identical stem taper, varying only in uniform scale and Y
   * rotation" is a direct description of that. An independent height/width draw
   * over 0.82-1.22 turns the same mesh into squat buttons and tall bells, and it
   * costs one hash channel that was already fetched.
   */
  float gcAspect = 0.82 + 0.40 * fract(gcR2.y * 7.31 + gcVH.y * 3.19);

  float gcBh = uGCShape.y * mix((0.45 + 1.05 * gcR2.x), gcSize, gcSolid)
             * (0.55 + 0.45 * gcCover)
             * mix(1.0, 0.72, gcSpat) * mix(0.42, 1.0, gcFar)
             /**
              * Emergent stalks vary over better than 2:1, not by a constant.
              *
              * mix(1.0, 2.05, gcEmerge) gave every seed stalk in the field
              * exactly twice the height of the sward, which is why the Red
              * Mountain review could measure "one twig mesh stamped hundreds of
              * times: identical 3-segment hook, identical scale". The stalks are
              * the tallest thing on an ash flat and therefore the most legible;
              * they are the last population that can afford to be uniform. The
              * draw is off gcVH.y, which is uncorrelated with the height and
              * width draws above.
              */
             * gcStandH * mix(1.0, 1.28 + 0.72 * gcVH.y, gcEmerge)
             * mix(1.0, gcAspect, gcFung);
  /**
   * A PHYSICAL CEILING on the card, and it is the ridge blocker.
   *
   * Every factor above is a plausible multiplier on its own and there are six
   * of them: the height draw (1.5), the cover term, the stand class (1.34), the
   * emergent draw (2.0) and the aspect. Multiplied out, the outer ring's
   * nominal 0.44 m card could reach two and a half metres — and the ridge
   * camera stands four metres above a slope whose near ground is twenty-five
   * metres out, so those cards are not distant slivers there, they are
   * metre-wide ribbons filling the bottom of the frame. The review read them,
   * correctly, as "bright cardboard strips glued to the hillside".
   *
   * Ash grass and scathecraw are ankle-to-knee plants and a dry seed stalk is
   * waist-high at the very most. Clamping the product to a fixed multiple of
   * the layer's own nominal size is what keeps the tail of a six-factor
   * lognormal inside the species, and it costs one instruction.
   */
  gcBh = min(gcBh, uGCShape.y * mix(1.55, 3.6, gcSolid));
  // A mushroom scales as one object; a card's height and width are independent.
  // A seed stalk is WIRY. At 0.58 of the sward's width and twice its height the
  // emergents came out as blunt planks — which, once the layer's value came up
  // into the ash's range, read as scattered straw rather than as standing stems.
  float gcBw = uGCShape.x * mix((0.62 + 0.78 * gcR2.y), gcSize, gcSolid) * gcBoost
             * mix(1.0, 0.38, gcEmerge)
             // The reciprocal of the height draw, so a tall instance is a narrow
             // bell and a short one a broad button rather than both being the
             // same object at two sizes.
             * mix(1.0, 2.04 - gcAspect, gcFung);
  // Same ceiling on the width. A blade three times the layer's nominal width is
  // not a blade, whatever the draws say.
  gcBw = min(gcBw, uGCShape.x * mix(2.15, 3.2, gcSolid));

  float gcYaw = gcR3 * 6.2831853;
  float gcCa = cos(gcYaw);
  float gcSa = sin(gcYaw);
`;

const GROUND_VERT_BODY = /* glsl */ `
${GC_LADDER}
  float gcT = position.y;

  /**
   * The card path and the fungus path, blended by the template flag.
   *
   * Both branches are evaluated. That is deliberate: uGCVar.x is a uniform, so
   * every invocation in a draw takes the same side and the dead half costs a few
   * ALU ops with no divergence — whereas a branch around a block that writes
   * gcLp would leave the compiler unable to prove the write happens.
   */
  // -- card: scale the whole cross-section, so a crossed pair stays crossed.
  /**
   * 2.4 -> 1.15 on the spatulate flare.
   *
   * A strap leaf keeps its width toward the tip; it does not TRIPLE it. At 2.4
   * the widest variant of the outer ring's card came out 0.4 m across and,
   * combined with the height chain below, presented the ridge vantage with a
   * solid quad the better part of a metre wide and two metres long — the
   * review's "large solid parallelograms with no alpha shaping at all", and it
   * is a correct description of a card that size. The variant still reads as a
   * blunt strap rather than a needle, which is all it was ever for.
   */
  float gcWs = mix(1.0, 1.0 + 1.15 * gcT * gcT, gcSpat)
  // Flare the foot. A zero-thickness card seen edge-on at the base is a paper
  // sliver standing in the dirt; splaying the lowest few centimetres gives it a
  // footprint from every azimuth and hides the entry point in its own shadow.
  // Cards only: a clinker chip's silhouette IS its shape.
             * mix(1.0, mix(1.45, 1.0, smoothstep(0.0, 0.16, gcT)), gcBlade);
  vec2 gcCardXZ = position.xz * gcWs;
  // Twist about the growth axis rather than shearing in z.
  float gcTwA = gcTwist * gcT * 1.5;
  float gcTwC = cos(gcTwA);
  float gcTwS = sin(gcTwA);
  gcCardXZ = vec2(gcTwC * gcCardXZ.x - gcTwS * gcCardXZ.y, gcTwS * gcCardXZ.x + gcTwC * gcCardXZ.y);

  // -- fungus: per-instance cap width, rim outline and stipe length.
  float gcRad = length(position.xz);
  vec2  gcDir = gcRad > 1e-5 ? position.xz / gcRad : vec2(1.0, 0.0);
  /**
   * Per-instance lobe count and phase, so no two caps present the same rim — and
   * the frequency has to stay clear of the ring's Nyquist limit.
   *
   * 3.0 + floor(gcVH.x * 4.0) gave {3,4,5,6} on a ten-sided ring: 5 IS the
   * Nyquist frequency there, so every cap that drew it collapsed into a perfect
   * five-pointed star, and 4 and 6 folded to a square and a triangle. That is the
   * "flat low-poly star polygon" both the dawn and the coast reviews called the
   * frame's most amateur object, and no amount of shading could have fixed it —
   * it is an outline. {3,5,7} against SEG = 16 has no integer ratio, so the lobe
   * is resolved as a lobe. The amplitude comes down with it: at 0.24 the rim
   * modulation was a quarter of the radius, which is a flower, not a margin.
   */
  float gcLobe = 1.0 + 0.115 * sin(atan(gcDir.y, gcDir.x) * (3.0 + 2.0 * floor(gcVH.x * 3.0))
                                   + gcVH.y * 6.2831853);
  // 0.74x to 1.34x. Narrower than the old 0.70-1.55 because the cap's HEIGHT
  // does not scale with it: a 1.55x draw on a 0.40 radius made a plate 2.9 times
  // as wide as the crown was deep, which reads as a disc on a stick however it
  // is shaded.
  float gcCapW = (0.74 + 0.60 * gcVH.x) * gcLobe;
  /**
   * The cap-open ramp must be COMPLETE before the first cap ring, not across it.
   *
   * At smoothstep(0.46, 0.57) the underside margin (y = 0.545) and the rim's
   * upper ring (y = 0.585) were being scaled by 0.91 and 1.00 of the same
   * per-instance width — so the 4 cm vertical wall between them was sheared
   * outward at the top by nine per cent of the cap radius, alternating with the
   * lobe phase. That is the "regular comb/sawtooth pattern along its lower edge"
   * the night review measured at 1:1: it is not coincident triangle edges, it is
   * a rim wall whose two rings disagree about how wide the cap is. Ramping from
   * 0.46 to 0.53 puts every cap ring at exactly 1.0 and leaves the stipe at 0.
   */
  float gcCapOpen = smoothstep(0.46, 0.53, gcT);
  vec2 gcFungXZ = gcDir * (gcRad * mix(1.0, gcCapW, gcCapOpen));
  // Stretch the stipe only, so a squat button and a long-stemmed bell are the
  // same mesh. Height above the cap junction is left alone or the cap itself
  // would squash with it.
  float gcStipeY = min(gcT, 0.50) * ((0.55 + 1.30 * gcVH.y) - 1.0);
  /**
   * A wide cap is a DEEPER cap, not a flatter one.
   *
   * Scaling only the radius means every draw of gcCapW makes the crown
   * shallower in proportion, so the widest instances — the ones that dominate a
   * near-field frame — are the flattest. Lifting the crown with the width keeps
   * the profile roughly similar across the population, which is what a real
   * troop of one species looks like.
   */
  float gcCapLift = (gcCapW - 1.0) * 0.42 * smoothstep(0.50, 0.62, gcT);

  vec2 gcShapeXZ = mix(mix(gcCardXZ, gcFungXZ, gcFung), position.xz, gcRock);
  vec3 gcLp = vec3(gcShapeXZ.x * gcBw,
                   (gcT + (gcStipeY + gcCapLift) * gcFung) * gcBh,
                   gcShapeXZ.y * gcBw);
  float gcArc = (0.05 + 0.95 * gcR2.y) * uGCShape.z * gcBlade;
  // A stone does not lean off its growth axis and it does not bend in the wind;
  // the two terms below are gated so the layer costs nothing it cannot use.
  float gcStiff = gcBlade + gcFung;
  gcLp.z += gcArc * gcBh * gcT * gcT;
  vec3 gcRp = vec3(gcCa * gcLp.x + gcSa * gcLp.z, gcLp.y, -gcSa * gcLp.x + gcCa * gcLp.z);
  vec3 gcLn = normal;
  // The card's normal has to follow its own twist or a twisted blade lights as
  // if it were flat.
  vec2 gcLnXZ = mix(
    vec2(gcTwC * gcLn.x - gcTwS * gcLn.z, gcTwS * gcLn.x + gcTwC * gcLn.z),
    gcLn.xz, gcSolid);
  gcLn = vec3(gcLnXZ.x, gcLn.y, gcLnXZ.y);
  vec3 gcRn = vec3(gcCa * gcLn.x + gcSa * gcLn.z, gcLn.y, -gcSa * gcLn.x + gcCa * gcLn.z);
  // As the blade arches over, its face turns skyward.
  gcRn = normalize(gcRn + vec3(0.0, 1.0, 0.0) * (gcArc * gcT * 1.3));

  // Sit on the terrain's tangent plane first, then lean the growth axis toward
  // the normal. The first term is what stops a wide lichen mat from burying its
  // uphill edge; the second is what stops a blade standing plumb in a hillside.
  float gcNy = max(gcN.y, 0.35);
  gcRp.y -= dot(gcN.xz, gcRp.xz) / gcNy * uGCShape.w;
  gcRp.xz += gcN.xz * (gcRp.y / gcNy) * uGCShape.w;

  // Per-instance lean off the growth axis. A field in which every blade is
  // plumb traces the terrain contour as a repeating sawtooth along any crest,
  // which advertises instancing louder than the repetition itself does.
  float gcLa = gcLean.x * 6.2831853;
  // A tall thin seed stalk leans MUCH harder than the mat it grows out of: it is
  // older, drier and carrying weight at the top. Standing them all plumb is
  // exactly what made the ash plain read as one twig stamped across it.
  float gcLeanAmt = uGCVar.y * (1.0 + 2.1 * gcEmerge) * gcStiff;
  gcRp.xz += vec2(cos(gcLa), sin(gcLa)) * (gcLeanAmt * (gcLean.y - 0.5) * 2.0 * max(gcRp.y, 0.0));

  vec3 gcWnd = floraWind(wxz, gcR3);
  vec2 gcDisp = gcWnd.xy * (uWindAmp * gcStiff * gcT * gcT * max(gcBh, 0.001));
  gcRp.xz += gcDisp;
  gcRp.y -= dot(gcDisp, gcDisp) * 0.5 / max(gcBh, 0.05);

  // Sunk five centimetres. Sub-pixel penetration costs nothing; a card whose
  // base meets the ground exactly shows a hairline of terrain between it and
  // its own contact shadow the moment the heightfield and the drawn triangle
  // disagree by a millimetre.
  fWorld = vec3(wxz.x + gcRp.x, gcH + gcRp.y - 0.05, wxz.y + gcRp.z);
  // Blend toward the ground normal: a field of independently-normalled blades
  // shimmers under any specular at all, and real turf reads as one surface.
  /**
   * A card is a stand-in for a tuft and wants to shade like the turf it is part
   * of; a mushroom is a solid object and has to keep its own dome.
   *
   * 0.32 -> 0.55 for cards. The old value left the shading normal dominated by a
   * plane that is, by construction, edge-on to an overhead sun, so the sward was
   * lit by ambient alone and read three stops darker than the ground it grows
   * out of. Ground cover is a volume being approximated by planes; its shading
   * has to answer to the volume.
   */
  /**
   * 0.55 -> 0.66 for cards.
   *
   * A vertical card's true normal is HORIZONTAL, so at the vale's noon sun N.L
   * on it is essentially zero and the whole sward is lit by ambient alone while
   * the ground beside it takes the full sun — which is the vale blocker
   * verbatim, "every blade is a black hole" at (600-900, 760-880). The card is a
   * stand-in for a volume of folded translucent ribbon whose aggregate
   * scattering behaves far more like a surface facing the sky than like the one
   * plane a quad describes, so its shading normal has to answer to the turf. Two
   * thirds keeps the left-right difference that tells the eye which way a blade
   * faces and stops the field going three stops under the ash it grows out of.
   */
  fWorldN = normalize(mix(gcRn, gcN, mix(0.60, 0.08, gcSolid)));
  fParam = aParam;
  // Contact. The baked gradient darkens the root of every card; on top of it the
  // local cover density deepens the occlusion, because a blade standing in a
  // dense clump sees far less sky at its base than a lone one on open ash. This
  // is what stops the sward reading as decals lying on the ground.
  fParam.w *= mix(1.0, 0.55 + 0.45 * aParam.w, clamp(gcCover, 0.0, 1.0));
  // Bioluminescence is colonial: whole tufts glow or none of them do, and the
  // colonies sit in the same damp hollows the cover is densest in. Gating on a
  // world-space hash (not on the instance index) keeps a given colony lit as
  // the ring renumbers itself underfoot.
  // Hashing the raw world position makes the gate per-BLADE: two neighbours
  // twenty centimetres apart get uncorrelated draws, so the field lights up as
  // an even sprinkle of isolated lamps rather than as colonies. Hashing a
  // quantised six-metre cell instead gives the patch structure the word colony
  // implies, and leaves genuine dark ground between the lit patches — which is
  // the contrast the whole night composition rests on.
  /**
   * The colony gate is binary; the density modulation is not a fifth.
   *
   * The old factor (0.35 + 0.65 * gcCover) was written as "a denser patch glows
   * brighter", but
   * gcCover at this point is a SURVIVAL PROBABILITY, and on real ground it runs
   * 0.1 to 0.3 — so the term was a near-constant 0.5x on everything, silently
   * halving every emissive in the subsystem. Combined with the atlas mask that
   * put the peak daytime glow at about a tenth of a linear unit against ground
   * sitting at three tenths: measurably invisible, which is exactly what the
   * ash-storm frame showed (zero teal pixels anywhere in it).
   *
   * Rescaling so a typical cover reaches most of full strength keeps the intent
   * — a thin colony on bare rock still glows less than a thick one in a hollow —
   * without the effect being an accident of how the probability happens to be
   * normalised.
   */
  fParam.z *= step(1.0 - uGCParams.w, fHash12(floor(wxz / 6.0) + 61.7))
            * (0.62 + 0.38 * clamp(gcCover * 3.5, 0.0, 1.0));
  /**
   * ROTATE THE ATLAS PER INSTANCE, exactly as the canopy does.
   *
   * This read fUv = uv, so every one of the four hundred ground mushrooms in
   * the coast midground presented the atlas at the SAME lathe angle: the same
   * radial streak, the same mottle, the same spore bloom, in the same place on
   * every cap. Per-instance yaw does not help — the mesh turns and the texture
   * turns with it, so the streak stays registered to the cap. That is the
   * review's "the same radial streak texture in the same orientation on every
   * single cap", and it is the loudest clone tell the field has, because a
   * texture that repeats is read faster than a silhouette that repeats.
   *
   * Every band in this atlas tiles in u by construction (u IS the lathe angle),
   * so an offset is exactly free and cannot seam. One add.
   */
  fUv = vec2(uv.x + gcR3 * 3.7, uv.y);
  fSeed = gcR3;
  // The outer dissolve is no longer a per-pixel coverage: it is folded into
  // gcThin at the top, so a blade that got here is drawn in full. Leaving this
  // at one is what lets the ground-cover material compile with no discard in
  // it and get early-Z back.
  fFade = 1.0;
  /**
   * Colour in STANDS, not in static.
   *
   * The species mix was rolled from fHash12(wxz * 2.13) — a per-blade hash. At
   * any distance where a card is a pixel or two that averages straight back to
   * one colour, so a field of two tints reads as a single mat of their mean:
   * the review's "uniform dark mat" is, in colour terms, exactly this. The mix
   * is now driven by a mid-scale noise field, so an ochre drift of dry grass
   * runs into a grey-green stand of fresh growth and the boundary between them
   * is a shape. The per-blade term survives only as a small break-up, which is
   * what stops the stand boundary itself looking painted — it now comes off a
   * channel of a hash already fetched rather than off a hash of its own.
   */
  float gcMix = clamp(smoothstep(0.34, 0.72, gcMid.y) + (gcHA.z - 0.5) * 0.30, 0.0, 1.0);
  // Value also drifts in stands: the sunlit crest of a clump and the shaded
  // hollow beside it are different colours before any light touches them.
  float gcVal = 0.74 + 0.52 * mix(gcMid.z, gcR2.x, 0.45);
  fTint = mix(uTint, uTintAlt, gcMix * uTintAltAmt) * gcVal;
  // Hue jitter, +/-12%, decorrelated from the value jitter above. A carpet in
  // which every card shares one hue reads as a texture, not as a population.
  fTint *= vec3(1.0 + (gcVH.x - 0.5) * 0.24, 1.0, 1.0 + (gcVH.y - 0.5) * 0.20);
  /**
   * Hue identity per individual — the same three anchors the canopy uses.
   *
   * The jitter above is a percentage skew of one hue, which makes a warmer and a
   * cooler copy of the same ochre. This picks between an ochre, a rust and a
   * grey-green cap, which is the difference between forty of one mushroom and a
   * troop of assorted ages. Zero for the grass layers, where the collapse term
   * below would fight it anyway.
   */
  float gcHu = fHash11(gcR3 * 53.7 + 3.1);
  vec3 gcHue = mix(vec3(1.055, 0.975, 0.815), vec3(1.155, 0.845, 0.660),
                   smoothstep(0.02, 0.46, gcHu));
  gcHue = mix(gcHue, vec3(0.865, 0.965, 0.845), smoothstep(0.54, 0.98, gcHu));
  fTint *= mix(vec3(1.0), gcHue, uHueJit);
  /**
   * Contrast collapse with distance, and it is the LOD this layer never had.
   *
   * Per-instance value and hue jitter is what makes a near-field sward read as a
   * population. Past the range where a card covers more than a pixel or two it
   * does the exact opposite: the jitter no longer resolves as individual plants,
   * it resolves as NOISE, and a field of uncorrelated bright and dark specks
   * strewn over smooth ground is read as litter lying on a surface — the review's
   * "confetti", "scattered plastic debris" and "flakes at constant screen size
   * regardless of distance", all of which are the same measurement.
   *
   * Collapsing every per-instance draw back toward the layer mean as the card
   * shrinks is the correct answer and it is free: it costs one mix, it removes
   * the aliasing at source rather than filtering it afterwards, and combined with
   * the height taper above it makes the field sink into the terrain's own colour
   * instead of speckling on top of it.
   */
  fTint = mix(fTint, uTint * 0.94, smoothstep(0.20, 0.78, gcDn) * 0.78);
  // A gust visibly crosses the sward as well as bending it: blades turning
  // edge-on catch the sky. The canopy and the ground cover read the same
  // envelope out of the same wind field, so the pale wave that runs across the
  // grass is the same event that tips the caps above it.
  // Dry standing stems are older and greyer than the mat they came out of, and
  // they are also the tallest thing in the layer — so if they sit above the ash
  // in value they are the first thing the eye finds, which is not what a seed
  // stalk should be.
  fTint *= mix(1.0, 0.80, gcEmerge);
  fTint *= 1.0 + 0.11 * gcWnd.z;
`;

/**
 * A single tapered blade, and no alpha test anywhere.
 *
 * rows is the cross-row count below the tip, and it is a LOD dial. Three rows
 * (7 vertices, 5 triangles) is what a card needs when it is a hand's width from
 * the lens and its arc has to read as a curve rather than as a dog-leg. The
 * coarse outer rings do not: their cards live between forty and a hundred and
 * thirty metres out, where the whole blade is two pixels wide and six tall, and
 * two rows (5 vertices, 3 triangles) is a 29% cut in vertex invocations across
 * twenty thousand instances for a silhouette difference nothing can resolve.
 * The tip vertex stays either way — that is the one the eye actually reads.
 */
function bladeTemplate(
  rows: readonly number[] = [0, 0.34, 0.68],
  blades = 1,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const par: number[] = [];
  /** Width axis of the blade currently being emitted, and its splay direction. */
  let ux = 1;
  let uz = 0;
  let px = 0;
  let pz = 1;
  /** Half-width scale and outward lean of the current blade. */
  let wScale = 1;
  let splay = 0;
  const push = (x: number, y: number, nx: number, ny: number, nz: number, u: number, t: number): void => {
    const s = splay * t * t;
    pos.push(ux * x * wScale + px * s, y, uz * x * wScale + pz * s);
    const l = Math.hypot(nx, ny, nz);
    // The card's plane normal is the splay axis, so the local (nx, ny, nz) frame
    // maps onto (width axis, up, plane normal) exactly.
    nrm.push((ux * nx + px * nz) / l, ny / l, (uz * nx + pz * nz) / l);
    uv.push(u, bandV(BAND.blade, t));
    // Stiff at the root, whippy at the tip.
    //
    // The fourth channel is the contact gradient, and it has to be a GRADIENT
    // concentrated in the bottom third rather than a gentle ramp over the whole
    // blade: what makes a card read as growing out of the ground rather than
    // lying on it is a hard darkening in the last few centimetres, where the
    // soil, the neighbours and the card's own footprint occlude it. Spreading
    // the same total darkening over the full height instead dims the whole
    // sward, which is what made it read as a decal.
    /**
     * The contact gradient, and it was biting a third of the card.
     *
     * A hard darkening in the last few centimetres is what makes a card read as
     * growing out of the ground. But t is NORMALISED height, so on a thirty-
     * centimetre blade a ramp over the bottom third darkens ten centimetres —
     * most of what the eye sees of a short card — and once the cards are crossed
     * (two planes, no gaps for the ground to show through) that darkening stops
     * reading as contact and starts reading as a black spike. Same shape, tighter
     * and shallower: the contact stays, the field comes back into the ash's value
     * range where it belongs.
     */
    par.push(t, 0.85, 0.20 + 0.70 * t * t, 0.48 + 0.52 * smoothstep(0, 0.24, t));
  };
  const idx: number[] = [];
  /**
   * One card is a shard; two crossed cards are a cone; three splayed blades are
   * a tuft.
   *
   * The crossed pair was the obvious answer to "a flat card has no silhouette
   * from its own edge" and it was wrong, for a reason that only shows up on
   * screen: the card tapers to a point, so crossing two of them builds an X of
   * two triangles which fills in, at any distance, as a solid dark cone. That is
   * the exact silhouette this whole rebuild exists to delete — the review found
   * it once already on the moss cushion and would have found it again here.
   *
   * A tuft is what grass actually is. Three narrow blades on one root, each at a
   * different azimuth and each leaning out as it rises, has a silhouette from
   * every direction (which is what the cross was for), reads as several plants
   * rather than one object (which the cross did not), and never closes into a
   * solid shape because the blades separate as they go up. Narrower blades also
   * mean the taper is no longer most of the card's area.
   */
  const splayOut = blades > 1 ? 0.42 : 0;
  const wide = blades > 1 ? 0.44 : 1;
  for (let p = 0; p < blades; p++) {
    // Not evenly spaced: 0, 62 and 133 degrees. Three blades at exactly 120
    // apart is a rotationally symmetric stamp, and the eye finds symmetry.
    const phi = p === 0 ? 0 : p === 1 ? 1.08 : 2.32;
    ux = Math.cos(phi);
    uz = Math.sin(phi);
    px = -Math.sin(phi);
    pz = Math.cos(phi);
    wScale = wide * (p === 0 ? 1 : p === 1 ? 0.84 : 0.92);
    splay = splayOut * (p === 0 ? 1 : p === 1 ? 0.78 : 1.15);
    const base = p * (rows.length * 2 + 1);
    /**
     * The card's normal leans SKYWARD, and that is not a cheat.
     *
     * Measured on the first crossed build: foreground blades came out at sRGB
     * (35,32,28) against ground at (120,95,55) — three and a half stops down, a
     * field of black spikes. The cause is geometric and unavoidable for a flat
     * card: a blade stands vertical, so its true normal is HORIZONTAL, and at
     * noon N·L is essentially zero. The card then receives ambient only, while
     * the ground beside it receives the full sun.
     *
     * A real blade is not flat. It is a folded, curved, translucent ribbon whose
     * aggregate scattering behaves far more like a surface facing the sky than
     * like the plane a single quad describes — which is why every grass shader
     * worth the name tilts the shading normal toward up. Doing it in the TEMPLATE
     * (rather than only in the mix toward the terrain normal below) keeps the
     * left-right lighting difference that tells the eye which way the blade
     * faces, and adds the vertical response that stops the field going black.
     */
    for (const t of rows) {
      const w = 0.5 * (1 - t * t * 0.82);
      push(-w, t, -0.42, 0.62, 0.66, 0, t);
      push(w, t, 0.42, 0.62, 0.66, 1, t);
    }
    push(0, 1, 0, 0.72, 0.69, 0.5, 1);

    // Quad strip up the rows, then the closing pair into the tip.
    for (let r = 0; r + 1 < rows.length; r++) {
      const a = base + r * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const last = base + (rows.length - 1) * 2;
    idx.push(last, last + 1, last + 2);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aParam', new THREE.Float32BufferAttribute(par, 4));
  g.setIndex(idx);
  return g;
}

/**
 * A small ground fungus: flared stipe, gilled underside, domed cap.
 *
 * This replaces the moss cushion, and the reason is silhouette. A cushion is a
 * lobed dome with its crown up and its rim on the ground, which is a CONE — and a
 * cone drawn without an alpha cut-out is a solid smooth cone whatever is painted
 * on it. Seven of the eight review shots named it, under seven different
 * descriptions ("dark-green cones", "a single untextured cone primitive", "the
 * same smooth low-poly cone on a thin stem", "flat-shaded cone and pyramid
 * primitives", "identical caps in a row"), and every one of those descriptions is
 * correct. Shading cannot fix an outline.
 *
 * What the frame actually needs on Ashenreach ground is fungus — that is the
 * province's signature — so this is a real one, with the three features that make
 * the read: a stipe you can see daylight beside, an underside that is darker than
 * the top and carries the gill band, and a margin that overhangs. Everything that
 * distinguishes one instance from another is rolled in the VERTEX SHADER off the
 * instance hash (cap width 0.62-1.66x, a lobed rim with a per-instance lobe count
 * and phase, stipe length 0.55-1.85x, overall size over two and a half stops,
 * free yaw and up to fifteen degrees of tilt), so a field of these is a
 * population and not a stamp, for one 41-vertex mesh.
 *
 *   ring Z  buried skirt           ring Cm  underside mid
 *   ring A  stipe foot, flared     ring Co  underside margin (drooped)
 *   ring B  stipe neck             ring Cu  margin, upper — the rim wall
 *   ring Ci underside, at stipe    ring Dm  cap flank      ring D  shoulder
 *                                  hub      apex
 */
function fungusTemplate(): THREE.BufferGeometry {
  /**
   * Sixteen, not ten, and the count is an ALIASING fix rather than a smoothness
   * one.
   *
   * The vertex shader modulates the cap radius by
   * `1 + a * sin(theta * L + phase)` to give every instance its own lobed rim.
   * At SEG = 10 that sinusoid is sampled ten times per revolution, and the lobe
   * count L was drawn from {3,4,5,6} — so L = 5 lands exactly on the Nyquist
   * limit and every cap that rolled it came out as a perfect five-pointed STAR,
   * which is precisely what the dawn and coast reviews measured ("a flat low-poly
   * star polygon"). L = 4 aliases to a square at 8, and 6 to a triangle. The
   * lobe frequency is now drawn from {3,5,7}, none of which divides 16, and the
   * amplitude is halved: the rim reads as an irregular margin instead of as a
   * cut-out star, and a 40 cm cap at two metres no longer shows a decagon.
   */
  const SEG = 16;
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const par: number[] = [];
  const idx: number[] = [];

  /** Emit one ring; returns the index of its first vertex. */
  const ring = (
    y: number,
    r: number,
    nOut: number,
    nUp: number,
    v: number,
    p: readonly [number, number, number, number],
  ): number => {
    const base = pos.length / 3;
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      const l = Math.hypot(nOut, nUp) || 1;
      nrm.push((Math.cos(a) * nOut) / l, nUp / l, (Math.sin(a) * nOut) / l);
      uv.push(i / SEG, v);
      par.push(p[0], p[1], p[2], p[3]);
    }
    return base;
  };
  const band = (a: number, b: number): void => {
    for (let i = 0; i < SEG; i++) {
      const j = (i + 1) % SEG;
      idx.push(a + i, b + i, b + j, a + i, b + j, a + j);
    }
  };

  // aParam = (height param -> wind stiffness + the shader's cap/stipe split,
  //           SSS thickness, glow mask multiplier, baked occlusion).
  // The occlusion floors are set so the stipe reads as a lit object standing in
  // its own shade, not as a black stick. It is a narrow surface almost entirely
  // under the cap; taking it to 0.26 at the foot on top of the shader's contact
  // multiply and the atlas occlusion crushed it to near-zero luminance.
  /**
   * The BURIED SKIRT is the whole answer to "this mushroom is hovering".
   *
   * The old mesh started at y = 0 with a 0.185 stipe and was sunk five
   * centimetres into the heightfield, which means the widest thing anywhere near
   * the ground was seven centimetres across and, on a cap up to half a metre
   * wide seen from above, completely hidden by its own cap. There was nothing in
   * the silhouette that explained where the plant met the ground — and with the
   * layer casting no shadow either (see the caster note in the constructor) the
   * result is exactly the review's blocker: a plate with lit ground visible under
   * its leading edge.
   *
   * Two changes fix it, and both are geometry rather than shading:
   *
   *  - the foot flares to 0.46 and continues to y = -0.34, well below the
   *    surface. The terrain therefore CUTS the cone instead of abutting it, so
   *    the contact is a real intersection at whatever height the heightfield
   *    happens to be and cannot show daylight underneath at any camera angle;
   *  - the flare carries the darkest baked occlusion in the mesh (0.08 at the
   *    buried ring, 0.16 at the foot), which is the per-instance base AO the
   *    review asked for. Ash holds moisture against a stipe; the ring of dark
   *    around the foot of a real mushroom is most of what makes it read as
   *    planted.
   */
  const Z = ring(-0.34, 0.46, 0.94, -0.34, bandV(BAND.stalk, 0.02), [0.00, 0.05, 0.00, 0.10]);
  /**
   * The stipe's baked occlusion is LIGHTER than it was, because the cap above it
   * now casts a real shadow.
   *
   * Before this pass the layer cast nothing, so the whole "this stalk stands in
   * its own shade" read had to be painted into aParam.w. It is now being paid for
   * twice — the cascade puts the cap's shadow on the stipe AND the baked term
   * darkens it — which is what turns a lit brown stalk into a black cone. Baked
   * occlusion should only ever carry what the shadow map cannot resolve: here
   * that is the ash packed against the foot, and nothing above it.
   */
  const A = ring(0.10, 0.235, 0.98, 0.20, bandV(BAND.stalk, 0.09), [0.06, 0.14, 0.00, 0.44]);
  const B = ring(0.46, 0.110, 1.0, 0.10, bandV(BAND.stalk, 0.38), [0.44, 0.22, 0.06, 0.92]);
  band(Z, A);
  band(A, B);

  // The underside, as its own rings so it can carry the gill band and a downward
  // normal without dragging the stipe's uv with it. This is the surface that has
  // to be dark: the shadow a cap casts on its own gills is most of what makes
  // even a ten-centimetre mushroom read as a solid object.
  //
  // Three rings, not two. A single quad from the stipe to the margin gives the
  // underside one flat facet, so a cap seen from below at any angle at all is a
  // hexagonal plate; the middle ring is what lets the gill surface curve away
  // from the stipe the way a real hymenophore does.
  const Ci = ring(0.600, 0.115, 0.20, -0.98, bandV(BAND.gill, 0.05), [0.57, 0.80, 0.30, 0.26]);
  const Cm = ring(0.585, 0.290, 0.26, -0.96, bandV(BAND.gill, 0.52), [0.58, 0.92, 0.55, 0.38]);
  const Co = ring(0.545, 0.400, 0.34, -0.94, bandV(BAND.gill, 0.98), [0.58, 1.00, 0.95, 0.54]);
  band(Ci, Cm);
  band(Cm, Co);

  /**
   * Cap: margin -> flank -> shoulder -> apex, and it is a DOME.
   *
   * Two problems the review named are both in this block.
   *
   *  1. "no cap geometry ... the same sprite shape repeats". Margin -> shoulder
   *     -> apex is two quad rows over the whole crown, and with the shoulder at
   *     0.78 of the height the profile between them is a straight line: a cone
   *     frustum with a lid. Adding the flank ring gives the crown a curve the
   *     light can actually run across, which is what turns a bent quad into a cap.
   *
   *  2. the margin now DROOPS. Co sits below Cu, so the outer rim rolls under
   *     the way a real parasol margin does; the silhouette then has an overhang
   *     to cast its own shade into rather than terminating in a knife edge.
   *
   * The v coordinates walk the cap band from 0.10 at the boss to 0.995 at the
   * margin. That matters for more than texture: the atlas paints the
   * bioluminescent margin as smoothstep(0.66, 0.99) of this band, so spreading
   * the crown across the band is what makes the emissive FALL OFF across the cap
   * instead of terminating in the hard 5 cm ribbon the night shot measured.
   */
  const Cu = ring(0.585, 0.405, 0.82, 0.56, bandV(BAND.cap, 0.995), [0.59, 0.80, 1.00, 0.92]);
  const Dm = ring(0.720, 0.360, 0.62, 0.78, bandV(BAND.cap, 0.75), [0.72, 0.66, 0.82, 0.98]);
  const D = ring(0.870, 0.235, 0.42, 0.91, bandV(BAND.cap, 0.45), [0.87, 0.52, 0.38, 1.00]);
  // Close the rim so the cap is a slab, not two coincident sheets.
  band(Co, Cu);
  band(Cu, Dm);
  band(Dm, D);
  const hub = pos.length / 3;
  pos.push(0, 1.0, 0);
  nrm.push(0, 1, 0);
  uv.push(0.5, bandV(BAND.cap, 0.10));
  par.push(1.0, 0.42, 0.16, 1.0);
  for (let i = 0; i < SEG; i++) idx.push(D + i, hub, D + ((i + 1) % SEG));

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aParam', new THREE.Float32BufferAttribute(par, 4));
  g.setIndex(idx);
  return g;
}

/**
 * A lump of ash clinker — the near-plane debris layer.
 *
 * The dusk review's finding was "zero vegetation and zero ground debris in the
 * entire frame ... not one loose rock anywhere on ~450,000 pixels of terrain,
 * including the near plane below 5 m", and the art bible asks for exactly that
 * ("micro-detail at the near plane: ground within 5 m must hold up — parallax,
 * grain, debris"). Neither ash grass nor scathecraw can supply it, because both
 * are keyed to habitats that a high sand-and-cinder shoulder does not have; a
 * clinker field, on the other hand, is what an ash waste IS. This layer is
 * therefore keyed almost entirely to the ash and rock channels and is the one
 * ground layer that survives on ground where nothing grows.
 *
 * It is also the answer to the dawn review's other note, "the small dark
 * rock/debris flakes scattered through the near field are flat, blurred, zero
 * occlusion beneath them — as blurred flat sprites they read as dirt on the
 * lens". These are real geometry: an irregular seven-sided lump with a buried
 * skirt, its own normal, its own baked occlusion under the overhang, and a
 * shadow. The instruction was "give them real geometry or delete them".
 *
 *   ring Z  buried skirt, well under the surface
 *   ring A  the widest course, just above ground — this is the silhouette
 *   ring B  the shoulder
 *   apex    an off-centre crown, so no two chips are the same lump
 */
function clinkerTemplate(): THREE.BufferGeometry {
  const SEG = 7;
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const par: number[] = [];
  const idx: number[] = [];
  // Per-vertex radial jitter, fixed in the template: a lathe with a constant
  // radius is a cone or a drum, and either reads as a primitive at once. Seven
  // sides with a deterministic wobble reads as a fractured lump.
  const jitter = [1.0, 0.78, 1.14, 0.86, 1.05, 0.72, 0.94];
  const ring = (
    y: number,
    r: number,
    nOut: number,
    nUp: number,
    v: number,
    p: readonly [number, number, number, number],
  ): number => {
    const base = pos.length / 3;
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const rr = r * jitter[i];
      pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
      const l = Math.hypot(nOut, nUp) || 1;
      nrm.push((Math.cos(a) * nOut) / l, nUp / l, (Math.sin(a) * nOut) / l);
      uv.push(i / SEG, v);
      par.push(p[0], p[1], p[2], p[3]);
    }
    return base;
  };
  const band = (a: number, bIdx: number): void => {
    for (let i = 0; i < SEG; i++) {
      const j = (i + 1) % SEG;
      idx.push(a + i, bIdx + i, bIdx + j, a + i, bIdx + j, a + j);
    }
  };
  // stiffness 0 (never bends), thickness 0.02 (rock does not transmit),
  // glow 0, occlusion dark under the overhang and full on the crown.
  const Z = ring(-0.42, 0.44, 0.92, -0.38, bandV(BAND.stalk, 0.06), [0, 0.02, 0, 0.10]);
  const A = ring(0.06, 0.50, 0.96, 0.28, bandV(BAND.stalk, 0.20), [0, 0.02, 0, 0.34]);
  const B = ring(0.52, 0.34, 0.62, 0.78, bandV(BAND.stalk, 0.52), [0, 0.02, 0, 0.86]);
  band(Z, A);
  band(A, B);
  const hub = pos.length / 3;
  // Off-centre crown. A chip whose apex is over its own centroid is a dome.
  pos.push(0.11, 0.86, -0.07);
  nrm.push(0.18, 0.97, -0.12);
  uv.push(0.5, bandV(BAND.stalk, 0.78));
  par.push(0, 0.02, 0, 1.0);
  for (let i = 0; i < SEG; i++) idx.push(B + i, hub, B + ((i + 1) % SEG));

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aParam', new THREE.Float32BufferAttribute(par, 4));
  g.setIndex(idx);
  return g;
}

export class GroundCover {
  readonly mesh: THREE.Mesh;
  readonly drawDist: number;
  private geo: THREE.InstancedBufferGeometry;
  private mat: FloraMaterialSet;
  private tileTex: THREE.DataTexture;
  private tileData: Float32Array;
  private pointTex: THREE.DataTexture;
  private offs: { x: number; y: number; d: number }[] = [];
  private readonly tile: number;
  private readonly perTile: number;
  private readonly total: number;
  private readonly distMin: number;
  private live = 0;
  private box = new THREE.Box3();
  private field: TerrainField;

  constructor(opts: GroundOpts, field: TerrainField, atlas: FloraAtlas) {
    this.tile = opts.tile;
    this.perTile = opts.perTile;
    this.field = field;
    const half = (opts.ring - 1) / 2;
    // One tile of margin so the fade-out always completes inside the ring.
    this.drawDist = (half - 1) * opts.tile;

    // Ring offsets, nearest first. The visible subset is re-derived every time
    // the camera moves, so instanceCount alone selects the drawn set.
    const offs = this.offs;
    for (let j = -half; j <= half; j++) {
      for (let i = -half; i <= half; i++) offs.push({ x: i, y: j, d: i * i + j * j });
    }
    offs.sort((a, b) => a.d - b.d);
    const tw = Math.ceil(Math.sqrt(offs.length));
    const tdata = new Float32Array(tw * tw * 4);
    for (let i = 0; i < offs.length; i++) {
      tdata[i * 4] = offs[i].x;
      tdata[i * 4 + 1] = offs[i].y;
    }
    this.tileData = tdata;
    this.tileTex = new THREE.DataTexture(tdata, tw, tw, THREE.RGBAFormat, THREE.FloatType);
    this.tileTex.minFilter = THREE.NearestFilter;
    this.tileTex.magFilter = THREE.NearestFilter;
    this.tileTex.needsUpdate = true;

    const pts = toroidalPoisson(opts.perTile, 0x51fa + opts.seed * 7717);
    const pdata = new Float32Array(opts.perTile * 4);
    for (let i = 0; i < opts.perTile; i++) {
      pdata[i * 4] = pts[i * 2];
      pdata[i * 4 + 1] = pts[i * 2 + 1];
    }
    this.pointTex = new THREE.DataTexture(pdata, opts.perTile, 1, THREE.RGBAFormat, THREE.FloatType);
    this.pointTex.minFilter = THREE.NearestFilter;
    this.pointTex.magFilter = THREE.NearestFilter;
    this.pointTex.needsUpdate = true;

    this.total = offs.length * opts.perTile;
    this.distMin = opts.distMin ?? 0;

    const src =
      opts.template === 'blade'
        ? bladeTemplate(opts.rows, opts.blades ?? 1)
        : opts.template === 'fungus'
          ? fungusTemplate()
          : clinkerTemplate();
    const geo = new THREE.InstancedBufferGeometry();
    for (const name of ['position', 'normal', 'uv', 'aParam']) {
      geo.setAttribute(name, src.getAttribute(name));
    }
    geo.setIndex(src.getIndex());
    const idxArr = new Float32Array(this.total);
    for (let i = 0; i < this.total; i++) idxArr[i] = i;
    geo.setAttribute('aIdx', new THREE.InstancedBufferAttribute(idxArr, 1));
    geo.instanceCount = this.total;
    // The whole field is rebuilt around the camera every frame; three's own
    // frustum test on a static sphere would be meaningless.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = geo;

    const extra = {
      uGCParams: {
        value: new THREE.Vector4(opts.tile, opts.perTile, this.drawDist, opts.glowFrac),
      },
      uGCChan: { value: new THREE.Vector4(...opts.chan) },
      uGCShape: { value: new THREE.Vector4(...opts.shape) },
      uGCCenterTile: { value: new THREE.Vector2() },
      uGCDensity: { value: opts.density },
      uGCVar: {
        value: new THREE.Vector4(
          opts.template === 'fungus' ? 1 : opts.template === 'clinker' ? 2 : 0,
          opts.lean ?? 0.16,
          opts.distMin ?? 0,
          opts.patchPhase,
        ),
      },
      uGCStand: {
        value: new THREE.Vector4(
          opts.dominance[0],
          opts.dominance[1],
          opts.dominance[2],
          opts.emergent,
        ),
      },
      uGCTuft: { value: new THREE.Vector2(opts.tuft[0], opts.tuft[1]) },
      uEyePos: { value: new THREE.Vector3() },
      uTileTex: { value: this.tileTex },
      uPointTex: { value: this.pointTex },
      uTileTexSize: { value: new THREE.Vector2(tw, tw) },
      uHeightTex: { value: field.heightTex },
      uEcoTex: { value: field.ecoTex },
      uFieldParams: { value: field.params() },
    };

    this.mat = createFloraMaterials({
      cacheKey: `flora:ground:${opts.id}`,
      atlas,
      vertPars: GROUND_VERT_PARS,
      vertBody: GROUND_VERT_BODY,
      extra,
      side: THREE.DoubleSide,
      tint: opts.tint,
      tintAlt: opts.tintAlt,
      tintAltAmount: opts.tintAltAmount,
      sssTint: opts.sssTint,
      sssAmount: opts.sssAmount ?? 1,
      glowColor: opts.glowColor,
      glowColorAlt: opts.glowColorAlt,
      glowFloor: opts.glowFloor,
      windAmp: opts.windAmp,
      plantHeight: opts.shape[1],
      lean: 0,
      /**
       * The world-space surface layer, on the fungus template only.
       *
       * The ground mushrooms are the "salmon-coloured blob covered in concentric
       * moire rings" the review named: an eighty-centimetre cap drawn as three
       * rings of a polar lathe, so the cap band's radial content is spread over
       * two quad rows and reads as nothing but concentric arcs converging on the
       * apex. They are also the densest large-ish surface in the near field, so
       * they are worth the shader.
       *
       * The blade layers are not: their band is rejected by floraSurface's first
       * test anyway, and leaving the code out of a program that runs on a quarter
       * of a million overdrawn cards is worth more than the symmetry.
       */
      surface: opts.template !== 'blade',
      /**
       * 30 -> 22, and it is an increase.
       *
       * The threshold used to be baked as range/1740 against a camera whose real
       * figure is nearer 1/700 once fwidth's |dFdx|+|dFdy| is accounted for, so
       * "30" was being enforced at about twelve metres. It is now genuine metres
       * (see uSurfPx in Materials.ts), and twenty-two is where a 40 cm cap is
       * fifteen pixels — still worth the shader, and set here rather than at the
       * nominal thirty because this is the one place the layer is paid across
       * eight thousand instances and the area it covers goes as the square.
       */
      surfaceRange: 22,
      // Small: forty mushrooms inside a couple of metres are one troop and want
      // to read as one, but a troop that is a single hue is a rubber stamp.
      hueJitter: opts.template === 'blade' ? 0 : 0.40,
      // Ground cover skips the G-buffer. A quarter of a million blades in the
      // prepass doubles the field's vertex cost for a normal buffer that the
      // half-res pass can reconstruct from the main depth attachment anyway,
      // and for velocity that camera reprojection already gets right — grass is
      // static in world space, and the wind displacement is sub-pixel at any
      // distance where TAA can see it.
      prepassMode: 'none',
      // Coverage is resolved per blade in the vertex shader, which is what
      // leaves this material with no discard in it. See FloraMaterialOpts.
      ditherMode: 'vertex',
    });

    const mesh = new THREE.Mesh(geo, this.mat.material);
    mesh.name = `flora:ground:${opts.id}`;
    mesh.frustumCulled = false;
    /**
     * The ground FUNGUS casts; the blade layers still do not.
     *
     * The previous iteration turned casting off for the whole subsystem, and the
     * measurement behind that was sound but the conclusion was not. gcDist was
     * `distance(cameraPosition.xz, wxz)`, and in the shadow pass three binds the
     * camera it is rendering with — the light, hundreds of metres back along the
     * sun vector — so gcThin evaluated to zero and every instance collapsed to a
     * degenerate triangle. The pass really did emit nothing. The fix for a pass
     * that emits nothing is to make it emit something, not to delete it: gcDist
     * now reads uEyePos, which is the eye in every pass.
     *
     * Which layers get it is a cost decision, and it is decided by instance
     * count. The fungus ring is 361 tiles of 24 — under nine thousand instances
     * before any thinning, and the survivors are 40 cm objects with a real
     * silhouette whose missing contact shadow the review named as the frame's
     * single most amateur tell on two separate shots. The blade layers are a
     * quarter of a million cards three centimetres across; their contact is
     * carried by the baked gradient in aParam.w and the cover-density term that
     * deepens it, and a sub-texel caster could not have improved on that for
     * three cascades' worth of vertex work.
     */
    /**
     * The fungus and the clinker cast; the blade layers still do not.
     *
     * Both of the solid templates are small OBJECTS with a real silhouette and a
     * real contact — a pebble that does not darken the ash beside it is the same
     * defect as a mushroom that does not, and the near plane is where the eye
     * measures it. Both rings are under ten thousand instances before thinning
     * and the shadow pass cuts hard at 38 m (see the exit at the head of the
     * ladder), so the cost is the near hundred or so casters whose contact
     * shadow is the entire point of having the pass.
     */
    mesh.castShadow = opts.template !== 'blade';
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = this.mat.depth;
    mesh.userData.prepassMaterial = this.mat.prepass;
    this.mesh = mesh;
  }

  /**
   * Re-centre the ring and cull it against the frustum.
   *
   * Snapping the centre to whole tiles is what keeps blades static in the world.
   * The frustum pass is what makes 200k blades affordable: at a 65-degree field
   * of view roughly two thirds of a camera-centred ring is behind or beside the
   * eye, and the vertex shader is expensive enough per blade (five texture
   * fetches into the heightfield and the ecology map) that running it on those
   * is the single largest avoidable cost in the subsystem. Rewriting the tile
   * table is a 16 KB upload; skipping the tiles saves millions of invocations.
   */
  update(camPos: THREE.Vector3, frustum: THREE.Frustum): void {
    const T = this.tile;
    const cx = Math.floor(camPos.x / T);
    const cz = Math.floor(camPos.z / T);
    (this.mat.uniforms.uGCCenterTile.value as THREE.Vector2).set(cx, cz);
    // The eye, for the survival ladder. Shared by the colour, depth and prepass
    // programs, and the only one of the three that is handed the right camera.
    (this.mat.uniforms.uEyePos.value as THREE.Vector3).copy(camPos);

    const far = this.drawDist + T;
    const far2 = far * far;
    const lift = this.mat.uniforms.uGCShape.value as THREE.Vector4;
    let n = 0;
    for (const o of this.offs) {
      const tx = cx + o.x;
      const tz = cz + o.y;
      const x0 = tx * T;
      const z0 = tz * T;
      const dx = Math.max(x0 - camPos.x, 0, camPos.x - (x0 + T));
      const dz = Math.max(z0 - camPos.z, 0, camPos.z - (z0 + T));
      if (dx * dx + dz * dz > far2) continue;
      // A coarse outer ring draws nothing inside its fade-in radius; skipping
      // those tiles outright is what keeps a second layer nearly free.
      if (this.distMin > 0) {
        const fx = Math.max(Math.abs(x0 - camPos.x), Math.abs(x0 + T - camPos.x));
        const fz = Math.max(Math.abs(z0 - camPos.z), Math.abs(z0 + T - camPos.z));
        if (fx * fx + fz * fz < this.distMin * this.distMin * 0.2025) continue;
      }
      // Terrain relief inside one 5-8 m tile is small; a generous slab around
      // the centre height is both cheap and safe against under-reporting.
      //
      // A CPU-side habitat cull was tried here and removed. `dot(eco, chan)` is
      // a sound upper bound on survival, but the ecology field is sampled every
      // 7.8 m and read bilinearly, so a bound that holds everywhere inside a
      // tile has to be a max over a 5x5 texel window — and a max over 39 m of
      // landscape is almost never small enough to fire. Measured: 1,530 of
      // 101,009 instances removed at dawn and none at all at Ember Mount. The
      // GPU rejects those same blades for one texture fetch at stage 2, which is
      // where the test belongs.
      const h = this.field.heightAt(x0 + T * 0.5, z0 + T * 0.5);
      this.box.min.set(x0, h - T, z0);
      this.box.max.set(x0 + T, h + T + lift.y * 2, z0 + T);
      if (!frustum.intersectsBox(this.box)) continue;
      this.tileData[n * 4] = o.x;
      this.tileData[n * 4 + 1] = o.y;
      n++;
    }
    this.tileTex.needsUpdate = true;
    this.live = n * this.perTile;
    this.geo.instanceCount = this.live;
    // An empty ring is still a bound program, a bound VAO and a draw call in
    // each of the shadow, prepass and colour passes. Looking away from a layer's
    // habitat should cost nothing at all.
    this.mesh.visible = this.live > 0;
  }

  get materials(): FloraMaterialSet {
    return this.mat;
  }

  get instances(): number {
    return this.total;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.tileTex.dispose();
    this.pointTex.dispose();
    this.mesh.removeFromParent();
  }
}
