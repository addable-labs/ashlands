import * as THREE from 'three';
import type { FloraAtlas } from './Atlas';
import type { BuiltMesh } from './Build';
import { CANOPY_RANGE, type ContactPool } from './Contact';
import { createFloraMaterials, type FloraMaterialSet } from './Materials';
import { bakeImpostors, createImpostorSet, type ImpostorSet } from './Impostor';
import type { TerrainLod } from './Lod';
import { OSEED, OSXZ, OSY, OTX, OTZ, OVAR, OX, OY, OYAW, OZ, STRIDE, type Scattered } from './Scatter';

/**
 * Instanced canopy: everything that is a discrete plant rather than ground cover.
 *
 * One InstancedMesh per (variant, LOD). Instances are re-selected from a bucketed
 * spatial index whenever the camera moves enough to matter, which keeps the
 * steady-state cost at zero — the wind lives entirely in the vertex shader, so a
 * stationary camera never touches an instance buffer.
 */

/** Everything that distinguishes one species' *look* from another's. */
export interface SpeciesVisual {
  build(seed: number, lod: number): BuiltMesh;
  /** Mesh LOD count: 1 (small plants) or 2 (mesh + reduced). */
  meshLods: number;
  /** Distance at which LOD0 hands over to LOD1, then LOD1 to the impostor. */
  lodDist: number[];
  /** Beyond this the species is not drawn at all. */
  drawDist: number;
  /** Width of every cross-fade band, metres. */
  fadeBand: number;
  impostor: boolean;
  tint: THREE.Color;
  tintAlt: THREE.Color;
  tintAltAmount: number;
  /**
   * Per-instance hue draw, 0..1. See the anchors in CANOPY_VERT_BODY.
   *
   * Large on the parasols, which are the signature silhouette and the thing the
   * eye compares against its neighbour; small on the ground species, where forty
   * individuals inside one square metre want to read as one colony.
   */
  hueJitter?: number;
  /**
   * Distance in metres out to which the world-space surface layer is evaluated.
   * Set it from the plant's size; see FloraMaterialOpts.surfaceRange.
   */
  surfaceRange?: number;
  /**
   * Give the REDUCED surface layer to the reduced mesh LOD as well.
   *
   * Only for species big enough to still be a readable object out there. LOD1 on
   * a parasol covers 110 to 430 m, which is where every mid-ground parasol in
   * every canonical frame actually lives — and it had no surface layer at all, so
   * whatever LOD0 gained was thrown away by the hand-off. Turning it on for a 40
   * cm ash yam, whose LOD1 is four pixels tall, would be pure cost.
   */
  surfaceFar?: boolean;
  /**
   * True where the cap band sweeps the meridian of a closed dome rather than the
   * radius of a disc. See FloraMaterialOpts.capDome.
   */
  capDome?: boolean;
  sssTint: THREE.Color;
  sssAmount?: number;
  glowColor: THREE.Color;
  /** Second bioluminescence hue; a per-instance hash lerps between the two. */
  glowColorAlt?: THREE.Color;
  /**
   * Daytime emissive floor. Non-zero only on the species that ARE lamps.
   *
   * A parasol must keep zero: its largest surface is its own shade, and any
   * daytime emissive there paints mint down the one thing in the palette that has
   * to stay dark. A bulb fungus is a different object — it is the accent the
   * bible reserves colour for, and at dawn it has to carry some.
   */
  glowFloor?: number;
  /** Sway in metres per unit wind load, at unit scale. */
  windAmp: number;
  lean: number;
  /**
   * Maximum random lean of the whole plant off its growth axis, as a tangent
   * (0.14 is about 8 degrees). Distinct from `lean`, which bows the plant over
   * its own height inside the shader; this tips the instance frame itself, and
   * it is the term that stops a population sharing one up-vector.
   */
  tilt?: number;
  side?: THREE.Side;
  /**
   * Strength of the ground-contact AO decal dropped at this species' base,
   * 0 to disable. See Contact.ts.
   *
   * It is per species because the quantity being modelled is how much sky the
   * plant's own crown takes away from the ground under it, and a parasol — a
   * twelve-metre lid over a bare stipe — takes nearly all of it while a
   * marshmerrow's open fan of blades takes very little. Setting one global
   * value would either float the big plants or paint a bruise round the small
   * ones.
   */
  contactAO?: number;
  /**
   * Multiplier from the species' scatter footprint radius to the AO skirt
   * radius. The skirt has to be wider than the base or its outer edge lands on
   * the geometry it is meant to be bedding in.
   */
  contactR?: number;
  /** Per-LOD instance capacity. */
  caps: number[];
  impostorCap: number;
  castShadow: boolean;
}

/**
 * Per-instance vertex path for the canopy.
 *
 * Reshaping happens in object space (a seeded lean that grows with height),
 * displacement in world space (the shared wind field). Both are folded into one
 * position so the shaded pass, the shadow caster and the prepass cannot possibly
 * disagree about where a vertex is.
 */
/**
 * Only instances whose seed clears this glow. Bioluminescence is the one vivid
 * accent in a desaturated palette; painting it on every cap underside in the
 * frame turns it into a tint and throws the saturation discipline away.
 */
export const GLOW_GATE = 0.795;

const CANOPY_VERT_PARS = /* glsl */ `
attribute vec2 iSeedFade;
`;

const CANOPY_VERT_BODY = /* glsl */ `
  fSeed = iSeedFade.x;
  fFade = iSeedFade.y;
  fParam = aParam;
  /**
   * Rotate the atlas around the lathe, per instance.
   *
   * Every band in the atlas tiles in u because u IS the lathe angle, so an
   * offset here is exactly free and cannot seam. What it buys is that two
   * neighbouring caps no longer present the same blotching, the same ring phase
   * and the same spore bloom in the same places: a stand of five variants stops
   * reading as five rubber stamps without another texel of texture memory or a
   * single extra fetch. This is the cheapest de-cloning in the subsystem.
   */
  fUv = vec2(uv.x + fSeed * 3.7, uv.y);

  /**
   * Bioluminescence is an ACCENT, and an accent applied to every object in the
   * frame is a tint. The atlas paints a glow mask on every cap underside and
   * every gill, which put a washed mint on forty mushrooms at once and destroyed
   * the saturation discipline the palette is built on. Gate it per instance so
   * roughly a fifth of a colony lights and the rest stay ochre — that is what
   * makes the lit ones read as vivid.
   */
  // Gated on the raw instance seed rather than on a hash of it, deliberately:
  // the light rig has to know which instances glow so it can hang a real point
  // light on one, and a GLSL hash is not reproducible on the CPU. fSeed is a
  // uniform [0,1) draw from the scatter, so a threshold on it is both a correct
  // fraction and something JavaScript can test with a single comparison.
  fParam.z *= step(${GLOW_GATE.toFixed(3)}, fSeed);

  float fCompliance = clamp(aParam.x, 0.0, 1.0);

  // Seeded lean: a slope added over the plant's own height, so the base stays
  // planted and the crown moves. This is the cheapest possible way to make two
  // instances of one variant read as two different individuals.
  float fLeanA = fSeed * 6.2831853;
  vec2  fLeanD = vec2(cos(fLeanA), sin(fLeanA));
  float fLeanM = (fHash11(fSeed * 91.7 + 4.3) - 0.5) * 2.0 * uLean;
  vec3 objP = position;
  objP.xz += fLeanD * (fLeanM * pow(fCompliance, 1.25) * max(position.y, 0.0));

  mat4 fIM = instanceMatrix;
  vec3 wp = (modelMatrix * fIM * vec4(objP, 1.0)).xyz;
  vec3 wBase = (modelMatrix * fIM * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float fScale = length(fIM[1].xyz);

  vec3 fWnd = floraWind(wBase.xz, fSeed);
  vec2 fDisp = fWnd.xy * (uWindAmp * fCompliance * fScale);
  wp.xz += fDisp;
  // Arc-length correction: a bent stalk is shorter. Without it the canopy
  // shears sideways instead of bowing, which reads as a broken rig.
  float fPh = max(uPlantH * fScale, 0.5);
  wp.y -= dot(fDisp, fDisp) * 0.45 / fPh;
  fWorld = wp;

  vec3 nw = normalize(mat3(modelMatrix) * mat3(fIM) * normal);
  // Rotate the shading normal with the bend, in proportion to how far this
  // vertex actually travelled; upward-facing surfaces turn the most.
  nw = normalize(nw - vec3(fDisp.x, 0.0, fDisp.y) * (0.55 * max(nw.y, 0.0) / fPh));
  fWorldN = nw;

  float fH1 = fHash11(fSeed * 13.7 + 2.1);
  float fH2 = fHash11(fSeed * 29.3 + 7.7);
  float fH3 = fHash11(fSeed * 71.9 + 5.3);
  // Value jitter first, then a hue push toward the species' alternate. +/-22% of
  // value and a per-channel skew of a few percent is enough that two instances
  // of one variant standing side by side never read as a copy-paste.
  fTint = uTint * (0.72 + 0.56 * fH1);
  fTint = mix(fTint, uTintAlt * (0.80 + 0.40 * fH1), fH2 * uTintAltAmt);
  fTint *= vec3(1.0 + (fH3 - 0.5) * 0.14, 1.0, 1.0 + (fH2 - 0.5) * 0.12);

  /**
   * Hue identity per individual — the frames are monochrome, and this is the
   * only place the palette lets that be fixed.
   *
   * The value and skew jitter above is a VALUE jitter: it makes two instances
   * different brightnesses of the same ochre, which at aerial-perspective range
   * is no difference at all, and the review measured the result as one flat hue
   * across the whole field. Real fungal pigment varies by individual far more
   * than it varies by illumination.
   *
   * Three anchors, drawn per instance: ochre, rust-red, grey-green. All three
   * sit inside chitin/bone and verdigris, i.e. inside the palette; none of them
   * is saturated, because bioluminescence and lava are the only things allowed
   * to be. They are luminance-matched to about five per cent so the draw does
   * not double as a value jitter and undo the one above.
   */
  float fHu = fHash11(fSeed * 47.3 + 19.1);
  vec3 fHueA = mix(vec3(1.055, 0.975, 0.815), vec3(1.155, 0.845, 0.660),
                   smoothstep(0.02, 0.46, fHu));
  fHueA = mix(fHueA, vec3(0.865, 0.965, 0.845), smoothstep(0.54, 0.98, fHu));
  fTint *= mix(vec3(1.0), fHueA, uHueJit);
`;

interface LodMesh {
  mesh: THREE.InstancedMesh;
  seedFade: THREE.InstancedBufferAttribute;
  count: number;
  cap: number;
}

const UP = new THREE.Vector3(0, 1, 0);

export class Canopy {
  readonly group = new THREE.Group();
  private mats: FloraMaterialSet[] = [];
  private lods: LodMesh[][] = []; // [lod][variant]
  private impostor: ImpostorSet | null = null;
  private impCount = 0;
  private built: BuiltMesh[][] = [];
  private maxHeight = 1;
  /** Upper distance of each LOD ladder stage; the last is the draw distance. */
  private bounds: number[] = [];
  private leanMax = 0.13;

  private tmpV = new THREE.Vector3();
  private tmpUp = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private tmpS = new THREE.Vector3();
  private tmpM = new THREE.Matrix4();
  private box = new THREE.Box3();

  constructor(
    private scat: Scattered,
    private vis: SpeciesVisual,
    atlas: FloraAtlas,
    renderer: THREE.WebGLRenderer,
    private lod: TerrainLod,
    private contact: ContactPool | null = null,
  ) {
    const rule = scat.rule;
    this.group.name = `flora:${rule.id}`;
    this.leanMax = vis.tilt ?? 0.13;

    // Variant pool. Each is an independent roll of the generator, so the pool
    // is genuinely different plants rather than one plant at four scales.
    for (let l = 0; l < vis.meshLods; l++) {
      const row: BuiltMesh[] = [];
      for (let v = 0; v < rule.variants; v++) row.push(vis.build(v * 7919 + 13, l));
      this.built.push(row);
    }
    for (const m of this.built[0]) this.maxHeight = Math.max(this.maxHeight, m.height);

    for (let l = 0; l < vis.meshLods; l++) {
      const set = createFloraMaterials({
        cacheKey: `flora:${rule.id}:${l}`,
        atlas,
        vertPars: CANOPY_VERT_PARS,
        vertBody: CANOPY_VERT_BODY,
        side: vis.side ?? THREE.DoubleSide,
        tint: vis.tint,
        tintAlt: vis.tintAlt,
        tintAltAmount: vis.tintAltAmount,
        sssTint: vis.sssTint,
        sssAmount: vis.sssAmount ?? 1,
        glowColor: vis.glowColor,
        glowColorAlt: vis.glowColorAlt,
        glowFloor: vis.glowFloor,
        windAmp: vis.windAmp,
        plantHeight: this.maxHeight,
        lean: vis.lean,
        /**
         * LOD0 gets the full layer; LOD1 gets the reduced one, on the big species
         * only. Both halves of that sentence are perf constraints.
         *
         * The canopy fragment shader has no early-Z — it discards, for the LOD
         * dissolve — so every canopy pixel behind another canopy pixel is still
         * shaded, and a mid-distance stand of parasols is several full screens of
         * overdraw. Running the FULL layer on LOD1 was measured at 23 -> 12 fps on
         * dawn and 45 -> 27 on the ridge, and that is why it was switched off
         * there.
         *
         * Switching it off entirely was the wrong conclusion, and it is most of
         * why three reviews in a row said the caps were untextured. LOD1 on a
         * parasol runs from 110 m to 430 m; a 22 m plant at 200 m is still ninety
         * pixels tall and is the object the eye is actually looking at in every
         * wide frame. What it cannot afford is the two fine lattices, whose
         * features are a third of a pixel out there anyway. The far variant drops
         * them at COMPILE time and keeps the coarse lattice plus the analytic
         * lathe-space terms — sectors, two ring sets, the margin, the flutes, the
         * primary lamellae — all of which are metre-scale and antialiased by a
         * smoothstep rather than by a mip chain. See surfaceGlsl in Surface.ts.
         */
        surface: l === 0 || (vis.surfaceFar === true && (vis.surfaceRange ?? 0) > 0),
        surfaceFar: l > 0,
        /**
         * Per LOD, and each stage's range is its own outer bound.
         *
         * The layer fades out over the last quarter of this distance, and pinning
         * it to the stage boundary makes that fade coincide with the mesh's own
         * dissolve into the next stage: full strength while the stage is solid,
         * zero by the time it has finished stippling away. Either boundary alone
         * would pop; made to land on top of each other, neither does.
         *
         * The species number is the distance at which the coarsest term (1.6 m)
         * stops resolving on THAT plant, a few times its own height, and it caps
         * the far stage as well — an ash yam does not earn a surface layer at two
         * hundred metres however big its LOD1 bound happens to be. These are
         * genuine metres now; see the note on the footprint scale in Materials.ts,
         * which is why the numbers in Flora.ts moved.
         */
        surfaceRange:
          l === 0
            ? Math.min(vis.surfaceRange ?? 40, vis.lodDist[0] + vis.fadeBand * 0.5)
            : Math.min(vis.surfaceRange ?? 40, vis.lodDist[l] ?? vis.drawDist),
        capDome: vis.capDome === true,
        hueJitter: vis.hueJitter ?? 0,
      });
      this.mats.push(set);

      const row: LodMesh[] = [];
      // Capacity is split across the variant pool; each variant gets a share
      // plus slack, because ecology does not deal them out evenly.
      const cap = Math.max(24, Math.ceil((vis.caps[l] / rule.variants) * 1.6));
      for (let v = 0; v < rule.variants; v++) {
        const geo = this.built[l][v].geometry;
        const mesh = new THREE.InstancedMesh(geo, set.material, cap);
        mesh.name = `${rule.id}:v${v}:l${l}`;
        mesh.count = 0;
        mesh.frustumCulled = false; // bucket culling below is far tighter
        mesh.castShadow = vis.castShadow;
        mesh.receiveShadow = true;
        mesh.customDepthMaterial = set.depth;
        mesh.userData.prepassMaterial = set.prepass;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        const sf = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
        sf.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('iSeedFade', sf);
        this.group.add(mesh);
        row.push({ mesh, seedFade: sf, count: 0, cap });
      }
      this.lods.push(row);
    }

    if (vis.impostor) {
      // Bake from the cheapest mesh LOD: at impostor range the gill fins and the
      // fine cap rings are long gone, and baking the heavy mesh only costs time.
      const src = this.built[this.built.length - 1];
      const baked = bakeImpostors(renderer, src, atlas, vis.tint);
      const boxes = src.map((m) => new THREE.Vector2(m.radius, m.height));
      this.impostor = createImpostorSet(
        baked,
        this.mats[0].uniforms,
        boxes,
        vis.windAmp * 0.5,
        vis.impostorCap,
      );
      this.group.add(this.impostor.mesh);
    }

    const stages = vis.meshLods + (this.impostor ? 1 : 0);
    for (let i = 0; i < stages - 1; i++) this.bounds.push(vis.lodDist[i] ?? vis.drawDist);
    this.bounds.push(vis.drawDist);
  }

  /**
   * Re-select visible instances. Buckets are 128 m; anything whose bucket box
   * misses the frustum is skipped wholesale, which is what makes a 26,000
   * instance species cost a fraction of a millisecond.
   */
  select(camPos: THREE.Vector3, frustum: THREE.Frustum): void {
    const { scat, vis } = this;
    for (const row of this.lods) for (const lm of row) lm.count = 0;
    this.impCount = 0;

    const E = scat.extent;
    const far = vis.drawDist;
    const cell = scat.cell;
    const cols = scat.cols;
    let bi0 = Math.floor((camPos.x - far + E) / cell);
    let bi1 = Math.floor((camPos.x + far + E) / cell);
    let bj0 = Math.floor((camPos.z - far + E) / cell);
    let bj1 = Math.floor((camPos.z + far + E) / cell);
    if (bi0 < 0) bi0 = 0;
    if (bj0 < 0) bj0 = 0;
    if (bi1 > cols - 1) bi1 = cols - 1;
    if (bj1 > cols - 1) bj1 = cols - 1;

    const bounds = this.bounds;
    const stages = bounds.length;
    const W = vis.fadeBand;
    const hMax = this.maxHeight * scat.rule.scale[1];
    const contactAO = vis.contactAO ?? 0;
    const contactR = vis.contactR ?? 1.5;

    for (let bj = bj0; bj <= bj1; bj++) {
      const z0 = -E + bj * cell;
      for (let bi = bi0; bi <= bi1; bi++) {
        const b = bj * cols + bi;
        const s = scat.bucketStart[b];
        const e = scat.bucketStart[b + 1];
        if (e <= s) continue;
        const x0 = -E + bi * cell;
        // Cheap reject on the bucket's nearest corner before the frustum test.
        const dx = Math.max(x0 - camPos.x, 0, camPos.x - (x0 + cell));
        const dz = Math.max(z0 - camPos.z, 0, camPos.z - (z0 + cell));
        if (dx * dx + dz * dz > far * far) continue;
        // Generous vertical margin: the LOD-morph correction below moves
        // instances by metres on a far ridge, and a bucket box that did not
        // cover the moved position would cull a plant that is on screen.
        this.box.min.set(x0, scat.bucketY[b * 2] - 8, z0);
        this.box.max.set(x0 + cell, scat.bucketY[b * 2 + 1] + hMax + 8, z0 + cell);
        if (!frustum.intersectsBox(this.box)) continue;

        for (let k = s; k < e; k++) {
          const idx = scat.order[k];
          const o = idx * STRIDE;
          const px = scat.data[o + OX];
          const py = scat.data[o + OY];
          const pz = scat.data[o + OZ];
          const ex = px - camPos.x;
          const ey = py - camPos.y;
          const ez = pz - camPos.z;
          const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
          if (d > far) continue;

          const variant = scat.data[o + OVAR] | 0;
          const seed = scat.data[o + OSEED];

          /**
           * The contact skirt, dropped once per INSTANCE rather than once per
           * emitted LOD stage.
           *
           * During a cross-fade `emit` runs twice for the same plant, and two
           * coincident multiply decals darken the ground twice — a ring that
           * visibly deepens and lifts every time a plant crosses a LOD
           * boundary. Doing it here, before the ladder is walked, makes the
           * skirt a property of the plant and not of how it happens to be
           * being drawn.
           */
          if (contactAO > 0 && this.contact && d < CANOPY_RANGE) {
            this.contact.push(
              px,
              pz,
              Math.max(0.28, scat.rule.footR * scat.data[o + OSXZ] * contactR),
              contactAO,
            );
          }

          // Follow the geometry through the LOD morph. The scatter placed this
          // instance against the analytic heightfield; the terrain draws a
          // linear interpolant of a lattice that coarsens with distance, and the
          // gap between the two is what leaves a mushroom hanging in fog with
          // clear sky under its legs.
          const dy = this.lod.offset(px, pz, camPos.x, camPos.z);

          // Walk the LOD ladder to the stage this distance belongs in.
          let stage = 0;
          while (stage < stages - 1 && d >= bounds[stage]) stage++;
          const t = (bounds[stage] - d) / W;
          if (t >= 1) {
            this.emit(stage, variant, o, seed, 1, dy);
          } else {
            // Coverage is signed: the outgoing stage keeps the pixels below the
            // dither threshold, the incoming one keeps exactly the rest. The
            // last stage has no successor and simply dissolves away.
            this.emit(stage, variant, o, seed, t, dy);
            if (stage + 1 < stages) this.emit(stage + 1, variant, o, seed, t - 1, dy);
          }
        }
      }
    }

    for (const row of this.lods) {
      for (const lm of row) {
        lm.mesh.count = lm.count;
        /**
         * An InstancedMesh with count 0 is still a draw.
         *
         * three walks it in projectObject, sorts it into a render list, binds
         * its program and its VAO and issues drawElementsInstanced with an
         * instance count of zero. With seven species times four or five variants
         * times two LODs that is up to seventy no-op draws per pass, and flora
         * is drawn three times a frame (shadow, prepass, colour). Toggling
         * `visible` removes them at the traversal, before any of that. It is the
         * single cheapest draw-call saving available here and it pays for the
         * shading added elsewhere in this pass.
         */
        lm.mesh.visible = lm.count > 0;
        if (lm.count > 0) {
          lm.mesh.instanceMatrix.needsUpdate = true;
          lm.seedFade.needsUpdate = true;
        }
      }
    }
    if (this.impostor) {
      this.impostor.geometry.instanceCount = this.impCount;
      this.impostor.mesh.visible = this.impCount > 0;
      if (this.impCount > 0) {
        this.impostor.iPos.needsUpdate = true;
        this.impostor.iData.needsUpdate = true;
      }
    }
  }

  /** Route a ladder stage to its mesh LOD or to the impostor layer. */
  private emit(
    stage: number,
    variant: number,
    o: number,
    seed: number,
    fade: number,
    dy: number,
  ): void {
    if (stage < this.vis.meshLods) this.push(stage, variant, o, seed, fade, dy);
    else this.pushImpostor(o, variant, seed, fade, dy);
  }

  private push(
    lod: number,
    variant: number,
    o: number,
    seed: number,
    fade: number,
    dy: number,
  ): void {
    const lm = this.lods[lod]?.[variant];
    if (!lm || lm.count >= lm.cap) return;
    const d = this.scat.data;
    const a = this.scat.rule.alignToNormal;
    const nx = d[o + OTX];
    const nz = d[o + OTZ];
    const ny = Math.sqrt(Math.max(0, 1 - nx * nx - nz * nz));
    // Terrain normal, blended toward vertical by the species' phototropism, then
    // knocked off plumb by a per-instance lean. A whole population sharing one
    // up-vector is the loudest single tell that a field is instanced — and a
    // few degrees costs nothing.
    const h = seed * 6.2831853 * 3.7;
    const tilt = (0.5 - ((seed * 7.13) % 1)) * 2 * this.leanMax;
    const ca = Math.cos(h);
    const sa = Math.sin(h);
    this.tmpUp
      .set(nx * a + ca * tilt, 1 + (ny - 1) * a, nz * a + sa * tilt)
      .normalize();
    this.tmpQ.setFromUnitVectors(UP, this.tmpUp);
    this.tmpQ2.setFromAxisAngle(UP, d[o + OYAW]);
    this.tmpQ.multiply(this.tmpQ2);
    this.tmpV.set(d[o + OX], d[o + OY] + dy, d[o + OZ]);
    this.tmpS.set(d[o + OSXZ], d[o + OSY], d[o + OSXZ]);
    this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
    this.tmpM.toArray(lm.mesh.instanceMatrix.array as Float32Array, lm.count * 16);
    const sf = lm.seedFade.array as Float32Array;
    sf[lm.count * 2] = seed;
    sf[lm.count * 2 + 1] = fade;
    lm.count++;
  }

  private pushImpostor(
    o: number,
    variant: number,
    seed: number,
    fade: number,
    dy: number,
  ): void {
    const imp = this.impostor;
    if (!imp || this.impCount >= imp.capacity) return;
    const d = this.scat.data;
    const p = imp.iPos.array as Float32Array;
    const q = imp.iData.array as Float32Array;
    const i = this.impCount * 4;
    p[i] = d[o + OX];
    p[i + 1] = d[o + OY] + dy;
    p[i + 2] = d[o + OZ];
    p[i + 3] = d[o + OSY];
    q[i] = d[o + OYAW];
    q[i + 1] = variant;
    q[i + 2] = seed;
    q[i + 3] = fade;
    this.impCount++;
  }

  /** Live uniform blocks, so the system can drive wind and sun in one sweep. */
  get uniformSets(): FloraMaterialSet[] {
    return this.mats;
  }

  get impostorMaterial(): THREE.ShaderMaterial | null {
    return this.impostor?.material ?? null;
  }

  get triangleBudget(): number {
    let t = 0;
    for (const row of this.built) for (const m of row) t += (m.geometry.getIndex()?.count ?? 0) / 3;
    return t;
  }

  dispose(): void {
    for (const row of this.lods) for (const lm of row) lm.mesh.dispose();
    for (const row of this.built) for (const m of row) m.geometry.dispose();
    for (const s of this.mats) s.dispose();
    this.impostor?.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
