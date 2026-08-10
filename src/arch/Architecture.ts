import * as THREE from 'three';
import type { IAtmosphere, IMaterials, ITerrain } from '../core/contracts';
import type { Ctx, PBRSet, System, WeatherState } from '../core/types';
import { ArchMaterials } from './ArchMaterial';
import {
  daedricRuin,
  redoranShell,
  velothiDome,
  velothiTower,
  type Emitter,
  type MatKey,
  type Part,
  type Structure,
} from './Buildings';
import { GroundField } from './Ground';
import { daedricShrine, dwemerRuin, telvanniTower } from './Landmarks';
import { banner, brazier, buildDock, clayUrn, crate, dryingRack, fishingNet, type PropDef } from './Props';
import { Rng } from './Rng';
import {
  bakeAO,
  bakeBio,
  bakeCavity,
  bakeSpill,
  bakeWeathering,
  buildFoundation,
  ensureArchAttributes,
  mergeParts,
  type SpillSource,
} from './Shapes';
import { planSettlement, type LandmarkPlot, type Layout, type Plot, type PropSite } from './Site';

/**
 * ARCHITECTURE AND SETTLEMENTS
 *
 * A coastal Velothi village laid out along a real street network, plus Daedric
 * ruins and Velothi towers scattered across the province. Everything is
 * generated in code from a seed; nothing is loaded.
 *
 * Budget notes (measured at 1080p on the shots harness — see the report):
 *  - Buildings are THREE.LOD: full shell inside 26x their own radius (85-260 m),
 *    a quarter-resolution silhouette proxy out to 1500 m (2600 m for towers,
 *    which are landmarks), nothing beyond. Three's own frustum culling does the
 *    rest per mesh.
 *  - Props are InstancedMesh, grouped by (variant, material).
 *  - Point lights are a FIXED POOL OF 6. They are created once and never
 *    added or removed, because changing the light count in the scene forces
 *    every material in the game to recompile.
 */

/**
 * Hard cap on simultaneous architecture point lights.
 *
 * Six, not ten. Every light resident in the scene extends NUM_POINT_LIGHTS in
 * EVERY material's program, terrain included, so the pool is paid for over the
 * whole screen whether or not a lamp is on it. Measured on an M3 at 1080p the
 * step from 6 to 10 cost more frame time than the entire settlement geometry.
 */
const MAX_POINT_LIGHTS = 6;
/** Beyond this the nearest lights are all that survive selection. */
const LIGHT_CULL = 95;

/**
 * LOD switch distance, in multiples of the structure's own radius.
 *
 * A fixed near-plane wastes the whole budget on 5 m domes: at 280 m a dome is
 * forty pixels tall and its interior shell, reveals, sills and vents are all
 * sub-pixel. Scaling by radius keeps the switch at a constant SCREEN size,
 * which is the only thing that matters, and it is what recovered most of the
 * cost of a bird's-eye pass over the settlement.
 */
const LOD_RADII = 26;
const LOD_NEAR_MIN = 85;
const LOD_NEAR_MAX = 260;
const LOD_FAR = 1500;
const LOD_FAR_TOWER = 2600;

/**
 * Landmarks get their own LOD tier, keyed on HEIGHT rather than on radius.
 *
 * A 110 m tower and a 4 m dome are not the same problem. The dome's detail is
 * sub-pixel at 260 m and dropping it there is free; the tower is still 80 px
 * tall at 1500 m and is the subject of the shot, so it holds full detail an
 * order of magnitude further out and NEVER reaches an empty level inside the
 * playable region — a landmark that pops out of the horizon is worse than no
 * landmark at all.
 *
 * Eight heights, not a fixed distance: an 8x-height switch is a constant screen
 * size, so the crossover always lands where the reveals and window frames stop
 * resolving rather than at some distance that happens to suit one tower. Past
 * it the ~500-triangle proxy carries the silhouette, which is the part that
 * actually matters at range.
 */
const LM_LOD_HEIGHTS = 8;
const LM_LOD_NEAR_MIN = 350;
const LM_LOD_NEAR_MAX = 900;

/**
 * Prop screen-size gates, in pixels of one prop's own diameter.
 *
 * Below PROP_PX_MIN an urn is a speck that survives only as aliasing noise, and
 * a batch of them costs three to five draw calls a frame to produce it. Below
 * PROP_PX_SHADOW its cast shadow is smaller than one texel of the cascade that
 * would have to draw it.
 */
const PROP_PX_MIN = 3.0;
const PROP_PX_SHADOW = 16;

const WINDOW_HUE = new THREE.Color(1.0, 0.60, 0.25);
const FIRE_HUE = new THREE.Color(1.0, 0.45, 0.14);
/** The bible's `#3fd6c0`. The one chroma nothing in the terrain can imitate. */
const BIO_HUE = new THREE.Color(0x3fd6c0);

/**
 * Material keys that are their own light source. They carry no weathering, cast
 * no shadow and must never be handed to the curvature bake — a lit panel that
 * bleaches at its edges reads as paint, not as an opening.
 */
const EMISSIVE_KEYS: ReadonlySet<MatKey> = new Set<MatKey>(['glow', 'glowFire', 'bio']);

interface WorldEmitter extends Emitter {
  /** World-space position, resolved once at build time. */
  world: THREE.Vector3;
  phase: number;
}

export class ArchitectureSystem implements System {
  readonly id = 'arch';
  readonly order = 20;

  private group = new THREE.Group();
  private mats: ArchMaterials | null = null;
  private palette = new Map<MatKey, THREE.MeshStandardMaterial>();
  private emitters: WorldEmitter[] = [];
  private lights: THREE.PointLight[] = [];
  private layout: Layout | null = null;
  private ground: GroundField | null = null;
  private offWeather: (() => void) | null = null;
  private owned: THREE.BufferGeometry[] = [];
  private windowGlow: Record<string, THREE.IUniform> | null = null;
  private fireGlow: Record<string, THREE.IUniform> | null = null;

  private night = 0;
  /** Latest atmospheric extinction from the weather bus; drives the lamp gate. */
  private fog = 8e-5;
  private wind = new THREE.Vector2(1, 0);
  private windSpeed = 4;
  /** Distance past which even a landmark is culled. Set from terrain extent. */
  private lmFar = 6000;
  private stats = { triangles: 0, meshes: 0, structures: 0, landmarks: 0, props: 0 };
  /**
   * Instanced prop batches, with the size of ONE prop and the bounds of the
   * whole batch. Props are the near-plane detail budget; a 0.7 m urn seen from
   * the ridge is a third of a pixel, and there are forty such batches, each
   * costing a draw in the scene pass, another in the depth prepass and another
   * in every cascade it falls inside. See `cullProps`.
   */
  private propBatches: {
    mesh: THREE.InstancedMesh;
    size: number;
    centre: THREE.Vector3;
    radius: number;
    emissive: boolean;
  }[] = [];
  private tmp = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  /** Reused scratch for light selection so update() allocates nothing. */
  private cand: { e: WorldEmitter; d: number; score: number }[] = [];

  async init(ctx: Ctx): Promise<void> {
    const terrain = ctx.get<ITerrain>('terrain');
    const materials = ctx.get<IMaterials>('materials');
    if (!terrain || !materials || !terrain.ready) {
      console.warn('[arch] terrain or materials unavailable; skipping settlement');
      return;
    }

    this.mats = new ArchMaterials((name: string, repeat: number): PBRSet => materials.tiled(name, repeat));
    this.buildPalette();

    this.group.name = 'architecture';
    ctx.scene.add(this.group);

    // The pool is created once and lives for the whole session. Point lights
    // entering or leaving the scene change NUM_POINT_LIGHTS, which invalidates
    // every compiled program including the terrain's — a hitch far worse than
    // the cost of six always-resident lights.
    for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 20, 2);
      l.castShadow = false; // six shadow-casting point lights is 36 cube faces
      l.visible = true;
      this.lights.push(l);
      // Parented to the scene, NOT to this system's group. Toggling the group
      // would otherwise change NUM_POINT_LIGHTS and force every material in the
      // game to recompile — which is both a hitch and a trap for any profiling
      // that hides the settlement to measure its cost.
      ctx.scene.add(l);
    }

    const t0 = performance.now();
    const groundAt = (x: number, z: number): number => terrain.heightAt(x, z);
    // The surface the CAMERA sees, which is not the one heightAt() reports past
    // a few hundred metres. Everything that has to prove ground contact is
    // driven under this instead. See src/arch/Ground.ts.
    this.ground = new GroundField(groundAt, terrain.extent);
    // Diagonal of the playable region: a landmark must never be culled while it
    // is still inside the world, whatever corner the camera is standing in.
    this.lmFar = terrain.extent * 3;
    // Landmark budget raised with the octant pass on the summit approaches: the
    // forced passes alone now ask for fourteen, and starving the stratified
    // sweep behind them is how quadrants go empty again.
    // Landmark budget raised again with the silhouette-coverage pass. That pass
    // is demand-driven — it places one only when a view cone has nothing in it
    // — so the cap is a ceiling, not a target, and starving it means shipping
    // the empty horizons the review threw out. Distant landmarks sit at the
    // mid LOD, so the marginal cost of the tail is the silhouette and nothing
    // else.
    this.layout = planSettlement(terrain, { seed: 0x1d0c, maxBuildings: 20, maxRuins: 34, maxLandmarks: 62 });

    for (const plot of this.layout.plots) this.buildPlot(plot, groundAt);
    for (const lm of this.layout.landmarks) this.buildLandmark(lm, groundAt);
    this.buildProps(this.layout.props);
    if (this.layout.dock) {
      this.buildDockGroup(this.layout.dock.from, this.layout.dock.to, groundAt);
    }

    this.offWeather = ctx.bus.on<WeatherState>('weather', (w) => {
      this.mats?.setWetness(w.wetness);
      this.wind.copy(w.windDir);
      this.windSpeed = w.windSpeed;
      this.fog = w.fogDensity;
    });
    const sky = ctx.get<IAtmosphere>('sky');
    if (sky) {
      this.mats.setWetness(sky.weather.wetness);
      this.wind.copy(sky.weather.windDir);
      this.windSpeed = sky.weather.windSpeed;
      this.fog = sky.weather.fogDensity;
    }

    console.info(
      `[arch] build ${(performance.now() - t0).toFixed(0)} ms; ` +
        `${this.stats.structures} structures, ${this.stats.landmarks} landmarks, ` +
        `${this.stats.props} props, ` +
        `${this.stats.meshes} meshes, ${(this.stats.triangles / 1000).toFixed(0)}k tris, ` +
        `${MAX_POINT_LIGHTS} point lights`,
    );
  }

  /**
   * Diagnostic channel for the visual-QA harness. 0 = off, which is what every
   * shipping frame runs at; anything else replaces the architecture's albedo
   * with one term of the surface stack so a defect can be attributed to a
   * binding, a footprint gate or a bake rather than guessed at.
   */
  debug(mode: number): void {
    this.mats?.setDebug(mode);
  }

  // ------------------------------------------------------------- materials

  private buildPalette(): void {
    const m = this.mats;
    if (!m) return;
    const P = this.palette;
    // Tile sizes are in metres per repeat; they are chosen against the real
    // feature size of each synthesized set, which is what stops a 4 m dome
    // reading as a 40 m one.
    const SPILL = new THREE.Color(0xff8a3a);
    // `mason` is the analytic BUILT relief family (see ArchMatOptions.mason),
    // and it is the direct answer to the review's "untextured clay" and
    // "flat-shaded blockout" on everything that is not grown. The synthesized
    // sets are 1-2 m repeats: below one pixel from eighty metres out, at which
    // point the mip chain hands back a single value and every plaster dome,
    // dressed plinth and basalt ruin in the province becomes a tinted solid.
    // The grown materials have had an analytic band stack for exactly this
    // reason since the fungus fix; the built ones never did, which is why the
    // complaint kept coming back to the settlement and the ruins.
    //
    // Nothing here is a colour change. Every band is relief, cavity and
    // roughness only, evaluated about the material's existing value.
    // `tint` is the material's MID-TONE ALBEDO now, not a multiplier on the map
    // (see ArchMatOptions). Every value below is read straight off the bible's
    // palette table, and the map supplies variation about it rather than value.
    // Before this the two multiplied: the basalt set averages 0.021 linear and
    // the old basalt "tint" was 0.16, which rendered the Daedric structures at a
    // 0.34% albedo — under a weathering stack of additive constants an order of
    // magnitude larger. That is the whole of the untextured-facets blocker.
    P.set('plaster', m.make({ set: 'plaster', tile: 1.3, ash: 0.50, wear: 0.9, streak: 1.1, roughMul: 1.0, normalScale: 1.5, mason: 2, masonAmp: 1.0, tint: new THREE.Color(0xc0ad8b), contrast: 1.45, metal: 0, spill: 0.30, spillColor: SPILL }));
    P.set('chitin', m.make({ set: 'chitin', tile: 1.9, ash: 0.36, wear: 0.75, streak: 0.7, irid: 0.55, roughMul: 0.8, normalScale: 1.4, mason: 3, masonAmp: 1.0, tint: new THREE.Color(0xb5a173), contrast: 1.35, metal: 0.12, spill: 0.30, spillColor: SPILL }));
    // Daedric basalt. The bible's `#2a2622` end is a silhouette value and reads
    // as a hole at close range, so the ruins sit a stop above it and let the
    // curvature wear carry the highlights; the deep end is still where the
    // cavities land after the ash term.
    P.set('basalt', m.make({ set: 'basalt', tile: 2.4, ash: 0.45, wear: 1.0, streak: 0.9, roughMul: 0.9, normalScale: 1.7, mason: 1, masonAmp: 1.25, tint: new THREE.Color(0x453f38), contrast: 1.5, metal: 0, spill: 0.26, spillColor: SPILL }));
    // Living rock. See the `crag` MatKey: same stone as `basalt`, same palette
    // entry, and deliberately NOT the coursed-masonry relief family — an
    // outcrop has no courses, and the brick grid that band stack drew across
    // every landmark plinth is what made the tower's foot read as a built black
    // wedge rather than as the crag it stands on.
    //
    // The relief it gets instead is the analytic shell stack at metre scale.
    // That is the answer to "flat interior, no gradient": on a near-vertical
    // face its vertical fibre reads as columnar basalt — which is the bible's
    // own description of the rock — and it is evaluated from position, so
    // unlike the 2.4 m texture repeat it does not mip to a single value at the
    // 600 m the landmark is actually judged at. Coarse tile for the same
    // reason: this is a twenty-metre mass, not a wall.
    P.set('crag', m.make({
      set: 'basalt', tile: 5.5, ash: 0.34, wear: 1.0, streak: 0.55,
      roughMul: 0.95, normalScale: 1.9, mason: 0,
      tint: new THREE.Color(0x453f38), contrast: 1.6, metal: 0,
      organic: 0.85, mottle: 0.95, ring: 0,
      spill: 0.26, spillColor: SPILL,
    }));
    P.set('stone', m.make({ set: 'cut_stone', tile: 1.1, ash: 0.42, wear: 0.95, streak: 1.0, normalScale: 1.5, mason: 1, masonAmp: 1.0, tint: new THREE.Color(0x9c9182), contrast: 1.4, metal: 0, spill: 0.26, spillColor: SPILL }));
    P.set('wood', m.make({ set: 'wood_weathered', tile: 0.9, ash: 0.32, wear: 0.85, streak: 1.25, normalScale: 1.5, mason: 4, masonAmp: 1.0, tint: new THREE.Color(0x7c6b51), contrast: 1.45, metal: 0 }));
    P.set('bone', m.make({ set: 'bone', tile: 1.3, ash: 0.35, wear: 1.0, streak: 0.6, roughMul: 0.85, normalScale: 1.3, mason: 3, masonAmp: 0.55, tint: new THREE.Color(0xd2c39c), contrast: 1.35, metal: 0 }));
    // Bronze, and the one genuinely metallic surface in the game.
    //
    // metal 1 with the ARM map's own blue channel behind it, roughness pulled
    // into the 0.35-0.55 band, and the accumulation term re-tinted VERDIGRIS so
    // the patina collects exactly where ash would — in the crevices and on the
    // up-faces. That is what separates it from a brown rock: a dielectric cannot
    // produce a coloured specular, and a rock has no reason to go green in its
    // cavities.
    P.set('bronze', m.make({
      set: 'bronze', tile: 0.6, ash: 0.42, wear: 1.0, streak: 0.5, roughMul: 0.85,
      normalScale: 1.2, tint: new THREE.Color(0xc79a5c), contrast: 1.3,
      // 0.82, not a hard 1. A wreck that has lain in the ash for an era is
      // metal under oxide, and a pure conductor has NO diffuse term at all — on
      // an object this size, lit mostly by a low-intensity environment probe, a
      // metalness of exactly one renders as a black hole in the frame. The ash
      // term knocks the rest of the way down to dielectric wherever drift sits.
      metal: 0.82, env: 1.6,
      ashColor: new THREE.Color(0x5f7a63),
      spill: 0.30, spillColor: SPILL,
    }));
    // Vaelmyr tower flesh. Tiled coarse — this is a 100 m organism, and a
    // brick-sized repeat on it is the fastest way to destroy the scale read the
    // landmark exists to provide. Dark enough to hold a black silhouette
    // against the sulphur band, which is the whole job at 1.5 km.
    //
    // `organic` is the part that actually fixes the tower. The texture set is
    // fine and completely invisible past 500 m, because a 2.8 m repeat mips to
    // its own average long before then; the analytic band stack in the shader
    // is what carries bark, growth rings and cavity from there out to 2 km.
    // `sss` gives the cap the thin-film transmission that makes a backlit rim
    // burn orange instead of going flat.
    //
    // The TILE is the fix the review's "flat matte solid fill" was actually
    // asking for, and it is a scale bug, not a binding one: the set was bound,
    // sampled and mipped correctly the whole time. `bark_fungal` puts its
    // largest features at 3-12 cycles per repeat, so at a 2.8 m repeat the
    // coarsest thing in it is a 23 cm welt. The hero tower is looked at from
    // 45 m (vale) to 1.1 km (redmtn), where one pixel spans 5 cm to 1.3 m —
    // every feature the set owns is at or under Nyquist for the entire range
    // the asset is ever seen at, so the mip chain hands back the average and
    // the trunk renders as one value. Measured: swapping only the three
    // samplers for a set whose features are larger relative to its repeat
    // restored the surface completely, with every other uniform unchanged.
    //
    // Nine metres. This is a hundred-metre organism, so a 9 m repeat puts the
    // welts and shed scales at 0.7-3 m — person-to-door scale, which is both
    // what a fungal stalk that size would actually have and what still resolves
    // at a kilometre. It also removes the tiling read for free: at 9 m the
    // repeat is bigger than most of the geometry it lands on.
    P.set('fungus', m.make({
      set: 'bark_fungal', tile: 9.0, ash: 0.40, wear: 0.6, streak: 0.95,
      roughMul: 1.0, normalScale: 1.6, tint: new THREE.Color(0x8f7d5a),
      contrast: 1.5, metal: 0, ring: 0,
      // 0.28, not 0.85. Transmission scales with albedo, and the relative-albedo
      // fix raised the stalk's from 0.003 to its real value — which turned a
      // term tuned against a near-black surface into a hundred-metre trunk
      // glowing orange from the inside at dusk. A stalk this thick transmits
      // almost nothing; the CAP is the thin tissue and keeps the full term.
      // sss is in POST-NORMALISATION units now: the transmission term picked up
      // the 1/pi every other diffuse path in this material already had, so it
      // is ~3.1x weaker for the same number. 0.30 here is deliberately still
      // well under a third of the old 0.28 in real terms — a sixteen-metre
      // stalk transmits essentially nothing, and this term overwhelming the
      // trunk's shading at dusk was the untextured-clay blocker.
      organic: 0.95, mottle: 0.8, sss: 0.30, sssColor: new THREE.Color(0xff7a2a),
      spill: 0.20, spillColor: new THREE.Color(0xff7a2a),
      // The stalk carries the veins, so it takes their wash. Ungated, because
      // fungal light does not check the clock.
      //
      // 0.05, not 0.06 — but the CHANNEL now carries the veins as well as the
      // rim spill (see telvanniTower), so the term does about twice the work
      // for a slightly lower coefficient. Measured up from 0.13 at dusk: a
      // hundred-metre trunk with a broad green column down it is the same
      // reading failure as the emissive tube it replaced, just softer. What is
      // wanted is a hint of cold under warm bark, not a stripe.
      bio: 0.05, bioColor: BIO_HUE,
    }));
    // Cap flesh. Pale, damp, thin — and the only surface here that is regularly
    // seen against the sun.
    //
    // Two numbers do the work. The tint is lifted well above the stalk's, and
    // `sss` is at full: the transmission term is proportional to albedo, so on
    // the stalk's 0.15 bark it evaluated to nothing and the cap rendered as the
    // crushed near-black the review found at dusk. Ash is nearly off — a
    // parasol sheds, and a cap frosted with drift is the fastest way to kill
    // both the translucency and the silhouette's dark-against-sky read.
    P.set('cap', m.make({
      set: 'bark_fungal', tile: 6.5, ash: 0.10, wear: 0.45, streak: 0.7,
      roughMul: 0.92, normalScale: 1.9, tint: new THREE.Color(0xd8c9a4),
      contrast: 1.5, metal: 0,
      // The one surface that IS a grown disc, so the only one the concentric
      // ring relief belongs on.
      ring: 1,
      // 2.4 in post-1/pi units, i.e. ~0.76 of the old effective strength. The
      // cap IS the thin tissue and the free orange rim it gets against a dusk
      // sky is the best thing in the asset; it just must not be worth more than
      // a fully sunlit face, which is what dropping the pi was fixing.
      organic: 1.0, mottle: 0.9, sss: 2.4, sssColor: new THREE.Color(0xff8f3a),
      spill: 0.42, spillColor: new THREE.Color(0xffa040),
      // The gills hang directly over the bio rim and this is the term that puts
      // its light on them. Without it the brightest object in the frame threw
      // no light at all on the surface 2 m above it.
      bio: 0.07, bioColor: BIO_HUE,
      // Sky-lit rim on the crown. THE fix for "the cap's dark silhouette sits
      // directly on the near-black horizon bar and does not separate": at dusk
      // the sun is gone and the transmission term above has nothing to work
      // with, but the sky dome is still the brightest thing in the scene and a
      // 25 m parasol's upper edge is turned straight at it. Sampled from the
      // atmosphere's own sky-view LUT in the direction the edge faces, so it is
      // the real sky radiance at the real bearing and it tracks the hour for
      // free — not an invented outline colour.
      skyRim: 0.85,
    }));
    // Pod hull: the same organism where it has hardened into shell.
    //
    // Built on `bone`, not on `chitin`. The chitin set is a lacquered elytron —
    // roughness 0.13 at the plate edges and a 0.14 metallic term — which on a
    // 25 m sphere is one continuous specular streak, and that is precisely the
    // "polished vinyl / blown plastic" the review named in two shots. Bone runs
    // 0.5-0.9 rough, dielectric, and its ivory-to-cream range IS the bible's
    // #d8c9a4 -> #8f7d5a chitin/bone entry.
    P.set('shell', m.make({
      // 5 m, not 2.4. Same Nyquist argument as the stalk: a pod is 25 m across
      // and is read from 300 m upward, so a brick-scale repeat on it is gone
      // before the asset is ever on screen. At 5 m the shell plates are a metre
      // and carry to the mid LOD.
      set: 'bone', tile: 5.0, ash: 0.38, wear: 0.7, streak: 0.85,
      roughMul: 1.05, normalScale: 1.8, tint: new THREE.Color(0xb8a578),
      contrast: 1.45, metal: 0,
      // Explicitly OFF. A pod is an ovoid and has no radial axis, so concentric
      // rings on it are the stepped contour banding the review measured.
      ring: 0,
      organic: 1.0, mottle: 1.0, sss: 0.55, sssColor: new THREE.Color(0xff8a3a),
      spill: 0.26, spillColor: new THREE.Color(0xff7a2a),
      bio: 0.08, bioColor: BIO_HUE,
    }));
    P.set('thatch', m.make({ set: 'thatch', tile: 1.0, ash: 0.7, wear: 0.5, streak: 0.8, tint: new THREE.Color(0xa08b60), contrast: 1.4, metal: 0 }));
    P.set('cloth', m.make({ set: 'cloth', tile: 0.9, ash: 0.45, wear: 0.5, streak: 0.7, side: THREE.DoubleSide, tint: new THREE.Color(0x8f7d5a), contrast: 1.3, metal: 0 }));
    P.set('banner', m.make({ set: 'cloth', tile: 0.8, ash: 0.28, wear: 0.4, streak: 0.5, side: THREE.DoubleSide, sway: 0.55, tint: new THREE.Color(0x8c4a3a), contrast: 1.3, metal: 0 }));
    // Slightly under the open ground's value so the drift reads as a bank of
    // ash against the wall rather than as a bright collar around the building.
    // Tint pulled well down from the old 0xa89a86: at that value the bank read
    // as a pale cream sheet lying on the ground rather than as drifted ash, and
    // a landmark's skirt is tens of metres across, so it was the brightest
    // thing in the lower third of the frame.
    //
    // `ash` down from 0.85 too. The accumulation term REPLACES albedo with the
    // shared drift colour, so at 0.85 this material's own tint was doing
    // nothing at all and the bank was pinned to the palette's lightest ash
    // whatever it was set to — which is why darkening the tint alone changed
    // the render by nothing.
    P.set('ash', m.make({ set: 'ash_coarse', tile: 1.1, ash: 0.30, wear: 0.15, streak: 0.05, roughMul: 1.0, normalScale: 1.8, tint: new THREE.Color(0x6b6152), contrast: 1.5, metal: 0 }));
    P.set('interior', m.interior());

    // Emissives.
    //
    // Every one of these is now above the bloom threshold and soft-edged, which
    // is the difference between a light source and a sticker. `soft` fades the
    // panel toward its own silhouette so nothing has a stroked outline; the
    // sub-pixel coverage correction in the glow shader does the rest at range.
    // 0.38, and the per-panel `aLit` term (0.06-1.6) does the rest.
    //
    // At a flat 0.72 every aperture in the world sat at one radiance, over the
    // clip point at night, and the tonemapper's highlight rolloff took it to
    // neutral — a wall of identical pale-cream rectangles, which is exactly
    // what the review measured at 6x and read as stickers. Lowering the base
    // and putting the variation in the attribute keeps the brightest occupied
    // room roughly where the old value was while the median window drops well
    // inside the display range and keeps its amber.
    // 0.85, not 0.38 — a shade over 1.1 stops, and the DAYLIGHT floor drops by
    // the same factor (see `uGlowMul` in update) so this is a night-and-dusk
    // gain only and the noon window is pixel-identical to before.
    //
    // The review's dusk note is the one being answered: a tower at 650 m whose
    // windows sit at 0.13 radiance under a sky at 0.16 has no lit read at all,
    // and with the towers that marginal the frame has no subject. A Cindren
    // window at dusk is not dimmer than the sky behind it; it is the one thing
    // in the frame that is brighter, and it has to clear the bloom threshold to
    // say so. The per-panel `aLit` scatter (0.06-1.6) still decides which rooms
    // are awake, so this raises the lit ones without turning the hull into a
    // lightbox.
    const win = m.glow(WINDOW_HUE, 0.85, { soft: 0.5 });
    const fire = m.glow(FIRE_HUE, 4.0, { soft: 0.35, pulse: 0.10 });
    P.set('glow', win);
    P.set('glowFire', fire);
    // Bioluminescence. Held at a constant multiplier — see the 'bio' MatKey.
    //
    // The one saturated accent the palette permits, so it has to be a light and
    // not an outline.
    //
    // 1.35, not 0.95 — over the bloom threshold so the pass has a
    // lobe to find, which is what the review meant by "no bloom, no falloff".
    // Blowing to white is prevented by the SOFT term rather than by holding the
    // peak under one: the core is hot, the silhouette falls off, so the bloom
    // kernel gets a gradient to work with and the colour survives at the edges
    // where the chroma actually reads.
    //
    // `dash` gives the rim irregular, soft-ended patches instead of the even
    // hard-edged ticks that read as a stroke style; `pulse` breathes it.
    // 0.95, not 1.35. The rim is the one emissive that is REQUIRED to keep its
    // chroma — it is the palette's only permitted saturated accent — and the
    // tonemapper rolls a clipped channel toward neutral, so anything held far
    // enough over the display range comes out white and the accent is lost.
    // Measured at dusk the rim and the lamp ring both read (242,235,227): pure
    // white, on the two objects whose entire job is to be teal and amber. It is
    // still comfortably over the bloom threshold at its core.
    //
    // 1.55, not 0.95, WITH the hot-core knee moved out to match. Those two
    // numbers have to move together and that is why the previous pass had to
    // give the gain back: at the default 1.05 knee the rim's own luminance is
    // already past it at 0.95, so every further stop bought bloom and paid for
    // it in chroma, and the accent the palette exists for came out white. The
    // knee is a property of the SOURCE, not of the tonemapper — a fungal rim is
    // a dim wide emitter, not a forge pip, so it is allowed to sit well over
    // the display range before it desaturates. With the knee at 2.2 the core is
    // a strong teal at 1.55 rather than a white line, and the soft term still
    // gives the bloom kernel the gradient it needs.
    P.set('bio', m.glow(BIO_HUE, 1.55, { soft: 0.9, dash: 0.7, pulse: 0.22, hot: 2.2 }));
    this.windowGlow = win.userData.glowUniforms as Record<string, THREE.IUniform>;
    this.fireGlow = fire.userData.glowUniforms as Record<string, THREE.IUniform>;
  }

  /**
   * Merge parts by material, bake the weathering attributes over the whole
   * structure at once (so a wall knows about the eave above it), and hand back
   * one geometry per material.
   */
  private compile(
    parts: readonly Part[],
    tint = 0.5,
    light?: {
      spill?: readonly SpillSource[];
      occluders?: readonly THREE.Vector4[];
      /** Ungated bioluminescent sources; washed onto the hull via `aBio`. */
      bio?: readonly SpillSource[];
      /** Enables the terrain-contact half of the AO bake. */
      origin?: THREE.Vector3;
      groundAt?: (x: number, z: number) => number;
      /** Skip the hemisphere AO bake — proxies and prop libraries do not need it. */
      noAO?: boolean;
    },
  ): Map<MatKey, THREE.BufferGeometry> {
    const byKey = new Map<MatKey, THREE.BufferGeometry[]>();
    for (const p of parts) {
      const list = byKey.get(p.key);
      if (list) list.push(p.geo);
      else byKey.set(p.key, [p.geo]);
    }
    const out = new Map<MatKey, THREE.BufferGeometry>();
    const bake: THREE.BufferGeometry[] = [];
    for (const [k, list] of byKey) {
      const merged = mergeParts(list);
      if (!merged) continue;
      out.set(k, merged);
      // Emissive panels have no weathering and no curvature worth measuring.
      if (!EMISSIVE_KEYS.has(k)) bake.push(merged);
    }
    bakeWeathering(bake);
    // Order matters: the cavity term folds into the curvature the weathering
    // pass just wrote, so it has to run after it and before the attributes are
    // handed to the shader.
    if (light?.occluders?.length) bakeCavity(bake, light.occluders);
    if (light?.spill?.length) bakeSpill(bake, light.spill);
    if (light?.bio?.length) bakeBio(bake, light.bio);
    // Hemisphere AO over the structure's own mass. This is what darkens the
    // corner of a recessed panel, the inside of a reveal and the last hand's
    // breadth where a shell meets its drift — none of which vertex curvature
    // can see, because all three are occlusion BETWEEN surfaces rather than
    // curvature of one.
    if (light?.noAO !== true) {
      bakeAO(bake, { origin: light?.origin, groundAt: light?.groundAt });
    }
    for (const g of out.values()) {
      ensureArchAttributes(g);
      // One constant per structure, read by the shader as a batch tint. Doing
      // it here rather than per material keeps a building's walls, jambs and
      // trim on the same mix of mud.
      const n = (g.attributes.position as THREE.BufferAttribute).count;
      g.setAttribute('aTint', new THREE.Float32BufferAttribute(new Float32Array(n).fill(tint), 1));
    }
    return out;
  }

  private meshesFor(geos: Map<MatKey, THREE.BufferGeometry>, parent: THREE.Object3D): void {
    for (const [k, g] of geos) {
      const mat = this.palette.get(k);
      if (!mat) continue;
      const mesh = new THREE.Mesh(g, mat);
      // Named so a diagnostic pass can attribute a pixel to a material key
      // without a debug shader. Costs nothing and has repeatedly been the
      // difference between fixing a binding and guessing at one.
      mesh.name = `arch:${k}`;
      const emissive = EMISSIVE_KEYS.has(k);
      // The interior shell is enclosed by the exterior one, so casting from it
      // buys nothing and doubles this building's cost in the shadow pass.
      mesh.castShadow = !emissive && k !== 'interior';
      mesh.receiveShadow = !emissive;
      parent.add(mesh);
      this.owned.push(g);
      this.stats.meshes++;
      this.stats.triangles += (g.attributes.position as THREE.BufferAttribute).count / 3;
    }
  }

  // ------------------------------------------------------------- structures

  private makeStructure(plot: Plot): Structure {
    switch (plot.style) {
      case 'redoran':
        return redoranShell({ seed: plot.seed, facing: plot.facing, size: plot.size });
      case 'tower':
        return velothiTower({ seed: plot.seed, facing: plot.facing, size: plot.size, collapse: new Rng(plot.seed).range(0.05, 0.55) });
      case 'daedric':
        return daedricRuin({ seed: plot.seed, facing: plot.facing, size: plot.size, collapse: new Rng(plot.seed).range(0.22, 0.58) });
      default:
        return velothiDome({ seed: plot.seed, facing: plot.facing, size: plot.size });
    }
  }

  private buildPlot(plot: Plot, groundAt: (x: number, z: number) => number): void {
    const st = this.makeStructure(plot);
    const origin = new THREE.Vector3(plot.x, plot.y, plot.z);

    // Foundation. The terrain belongs to another subsystem and cannot be
    // flattened, so the plinth reaches DOWN to meet the ground at every angle
    // and an ash drift is piled against it. That is what removes the hovering
    // tell and gives every building real contact AO.
    //
    // `groundDeep` is the terrain-LOD floor rather than the CPU surface. A 4 m
    // dome is allowed a skirt of about half its own radius and no more: past
    // that the cure — a visible pedestal under every house in the village — is
    // worse than the couple of metres of daylight it is closing.
    const found = buildFoundation(st.ring, origin, groundAt, {
      bury: 0.45 + plot.fill * 1.1,
      flare: 0.10,
      drift: Math.max(0.42, st.radius * 0.11),
      seed: plot.seed % 997,
      groundDeep: this.ground?.settler({ maxSink: Math.max(1.2, st.radius * 0.6) }),
    });
    const proxyPlinth = found.plinth.clone();
    st.parts.push({ key: 'stone', geo: found.plinth });
    st.parts.push({ key: 'ash', geo: found.drift });
    st.parts.push({ key: 'stone', geo: found.rubble });

    const geos = this.compile(st.parts, hash01(plot.seed), {
      spill: spillOf(st),
      bio: st.bio,
      origin,
      groundAt,
    });
    const detail = new THREE.Group();
    this.meshesFor(geos, detail);

    const near = Math.max(LOD_NEAR_MIN, Math.min(LOD_NEAR_MAX, st.radius * LOD_RADII));
    const lod = new THREE.LOD();
    lod.position.copy(origin);
    lod.addLevel(detail, 0);

    // Mid LOD, compiled through the SAME path as the detail level.
    //
    // It used to be merged and handed straight to a material with only
    // `ensureArchAttributes` — which fills aCurv, aDrip, aSpill and aTint with
    // defaults. Every weathering term in the shader is driven by those, so the
    // proxy came out with no curvature wear, no drip, no light wash and, worst
    // of all, a batch tint of zero for every building in the village: fifteen
    // structures at one flat value, which is exactly the "uniform pale-beige
    // cones and boxes, untextured greybox" the review found in the settlement
    // at dusk. Half of a Velothi village is always past the switch, so this
    // level IS the settlement in most frames and it cannot be the cheap one in
    // any sense but triangles.
    //
    // The plinth stays a separate key so the mid level keeps a dark skirt under
    // a pale shell rather than melting into one silhouette at the ground line.
    const proxyParts: Part[] = st.proxyParts?.length
      ? [...st.proxyParts, { key: 'stone' as MatKey, geo: proxyPlinth }]
      : [
          { key: st.proxyKey, geo: st.proxy },
          { key: 'stone' as MatKey, geo: proxyPlinth },
        ];
    const mid = new THREE.Group();
    this.meshesFor(
      this.compile(proxyParts, hash01(plot.seed), { spill: spillOf(st), bio: st.bio, origin, groundAt }),
      mid,
    );
    if (mid.children.length > 0) lod.addLevel(mid, near);
    // Empty terminal level: towers are landmarks and hold their silhouette far
    // longer than a 4 m dome, which vanishes into aerial perspective anyway.
    lod.addLevel(new THREE.Object3D(), plot.style === 'dome' ? LOD_FAR : LOD_FAR_TOWER);

    this.group.add(lod);
    this.stats.structures++;

    for (const e of st.emitters) {
      this.emitters.push({
        ...e,
        world: new THREE.Vector3().copy(e.pos).add(origin),
        phase: (plot.seed % 1000) / 159.15,
      });
    }
  }

  // ------------------------------------------------------------- landmarks

  /**
   * Raise one skyline landmark.
   *
   * Same pipeline as a plot — compile, found, LOD — with three differences that
   * matter. The generator is handed a LOCAL ground function so its roots,
   * standing stones and gate pylons plant on the real heightfield instead of on
   * an imagined flat pad; the foundation is scaled to the structure rather than
   * to a house, so a 110 m tower gets a plinth and an ash drift proportional to
   * it; and the LOD tier is the landmark one, so the silhouette survives to the
   * far side of the map.
   */
  private buildLandmark(lp: LandmarkPlot, groundAt: (x: number, z: number) => number): void {
    const origin = new THREE.Vector3(lp.x, lp.y, lp.z);
    // The asset is built in its own unrotated frame and the LOD node carries the
    // yaw, so every terrain query the generator makes has to be rotated into
    // world space by hand — otherwise the roots, the plinth ring and the gate
    // pylons are planted against the ground at the WRONG bearing and the yaw
    // trades a repeat tell for a floating tell.
    const cy = Math.cos(lp.yaw);
    const sy = Math.sin(lp.yaw);
    const local = (x: number, z: number): number =>
      groundAt(origin.x + x * cy + z * sy, origin.z + z * cy - x * sy) - origin.y;
    // The LOD floor in the same local, counter-rotated frame. A landmark is
    // read from a kilometre and its feet are the first thing that gives it
    // away, so its allowance is generous — a fifth of the tower's own height,
    // which on a hundred-metre tower is a plinth that reads as the crag it grew
    // out of, and on a forty-metre shrine is eight metres of buried footing.
    const sink = Math.max(3, lp.height * 0.20);
    const deepAbs = this.ground?.settler({ maxSink: sink }) ?? groundAt;
    const localDeep = (x: number, z: number): number =>
      deepAbs(origin.x + x * cy + z * sy, origin.z + z * cy - x * sy) - origin.y;
    const spec = {
      seed: lp.seed,
      facing: lp.facing,
      height: lp.height,
      ground: local,
      groundDeep: localDeep,
    };
    const st =
      lp.kind === 'telvanni' ? telvanniTower(spec) : lp.kind === 'dwemer' ? dwemerRuin(spec) : daedricShrine(spec);

    // The plinth chases the ground down at every angle and the drift banks ash
    // against it. This is what proves ground contact at landmark scale, where a
    // 20 m footprint can span several metres of relief.
    // Drift is scaled off the FOOT, not off st.radius: a shrine's radius is its
    // standing-stone ring, and banking ash to that width would put a five-metre
    // dune round a sixteen-metre plinth.
    let foot = 0;
    for (const p of st.ring) foot += Math.hypot(p.x, p.z);
    foot /= Math.max(1, st.ring.length);

    // Same rotation as `local`, in the world-coordinate form buildFoundation and
    // the AO bake expect.
    const groundRot = (wx: number, wz: number): number => {
      const x = wx - origin.x;
      const z = wz - origin.z;
      return groundAt(origin.x + x * cy + z * sy, origin.z + z * cy - x * sy);
    };

    const deepRot = (wx: number, wz: number): number => {
      const x = wx - origin.x;
      const z = wz - origin.z;
      return deepAbs(origin.x + x * cy + z * sy, origin.z + z * cy - x * sy);
    };

    const found = buildFoundation(st.ring, origin, groundRot, {
      bury: Math.max(1.2, lp.height * 0.03),
      flare: Math.max(0.30, lp.height * 0.006),
      // A sea stack has no ash bank: drift is wind-blown material piled against
      // a wall, and there is no wind-blown material three metres under water.
      // What the rock needs instead is the boulder apron, and it gets a heavier
      // one because a waterline seam is the one a camera looks straight at.
      drift: lp.stack ? Math.max(0.6, foot * 0.05) : Math.max(1.0, foot * 0.16),
      seed: lp.seed % 997,
      groundDeep: deepRot,
      // See buildFoundation's `apron`. Landmarks only — a 4 m dome's skirt is a
      // hand's breadth and does not need house-sized rock across it.
      apron: lp.stack ? 0.85 : 0.62,
    });
    const proxyPlinth = found.plinth.clone();
    // Living rock, not the settlement's dressed stone and no longer the DAEDRIC
    // basalt either. A landmark plinth is tens of metres wide; in pale cut
    // stone it reads at distance as a bright sheet lying under the structure,
    // and in coursed basalt it reads as a brick wall that mips to a flat black
    // wedge. See the `crag` MatKey.
    st.parts.push({ key: 'crag', geo: found.plinth });
    st.parts.push({ key: 'ash', geo: found.drift });
    st.parts.push({ key: 'crag', geo: found.rubble });

    const light = { spill: spillOf(st), occluders: st.occluders, bio: st.bio, origin, groundAt: groundRot };
    const geos = this.compile(st.parts, hash01(lp.seed), light);
    const detail = new THREE.Group();
    this.meshesFor(geos, detail);

    const lod = new THREE.LOD();
    // Named so a diagnostic pass can find one landmark of a given kind without
    // reverse-engineering it from its material set.
    lod.name = `lm:${lp.kind}`;
    lod.position.copy(origin);
    lod.rotation.y = lp.yaw;
    lod.addLevel(detail, 0);

    const near = Math.max(LM_LOD_NEAR_MIN, Math.min(LM_LOD_NEAR_MAX, lp.height * LM_LOD_HEIGHTS));
    if (st.proxyParts && st.proxyParts.length > 0) {
      // Multi-material mid level: the lit windows and the lamp ring are the
      // only thing the eye has left at this range, so they cross the switch
      // with the geometry instead of vanishing at it.
      st.proxyParts.push({ key: 'crag', geo: proxyPlinth });
      const mid = new THREE.Group();
      this.meshesFor(this.compile(st.proxyParts, hash01(lp.seed), light), mid);
      lod.addLevel(mid, near);
      st.proxy.dispose();
    } else {
      const proxyGeo = mergeParts([st.proxy, proxyPlinth]);
      if (proxyGeo) {
        ensureArchAttributes(proxyGeo);
        const pm = new THREE.Mesh(proxyGeo, this.palette.get(st.proxyKey) ?? this.palette.get('basalt')!);
        pm.castShadow = true;
        pm.receiveShadow = true;
        lod.addLevel(pm, near);
        this.owned.push(proxyGeo);
        this.stats.meshes++;
      }
    }
    lod.addLevel(new THREE.Object3D(), this.lmFar);

    this.group.add(lod);
    this.stats.landmarks++;

    for (const e of st.emitters) {
      this.emitters.push({
        ...e,
        // Through the same yaw the mesh carries, or the point light behind a
        // window ends up lighting the far side of the trunk.
        world: new THREE.Vector3(
          origin.x + e.pos.x * cy + e.pos.z * sy,
          origin.y + e.pos.y,
          origin.z + e.pos.z * cy - e.pos.x * sy,
        ),
        phase: (lp.seed % 1000) / 159.15,
      });
    }
  }

  // ------------------------------------------------------------- props

  /**
   * Props are instanced. A variant library gives structural variety (each
   * variant is a differently seeded generator run), and every site picks one,
   * so a hundred urns are a handful of draw calls but not a hundred clones of
   * the same urn.
   */
  private buildProps(sites: readonly PropSite[]): void {
    const VARIANTS = 5;
    const makers: Record<PropSite['kind'], (r: Rng) => PropDef> = {
      urn: clayUrn,
      crate,
      rack: dryingRack,
      net: fishingNet,
      brazier,
      banner,
    };

    // key -> variant geometries, per material
    const lib = new Map<string, { geos: Map<MatKey, THREE.BufferGeometry>; emitters: Emitter[] }>();
    const rng = new Rng(0x51ed270b);
    for (const kind of Object.keys(makers) as PropSite['kind'][]) {
      for (let v = 0; v < VARIANTS; v++) {
        const def = makers[kind](rng.fork(v * 977 + kind.length * 31));
        // A brazier has to light its own bowl and the crate beside it even when
        // the six-light pool is busy elsewhere in the village.
        const spill = def.emitters.map((e) => ({ pos: e.pos, range: 3.2, power: 0.9 }));
        // No AO bake: a prop is instanced at a hundred different sites, so a
        // hemisphere term baked in its own local frame would be wrong at every
        // one of them, and at urn scale the curvature bake already carries it.
        lib.set(`${kind}:${v}`, {
          geos: this.compile(def.parts, rng.next(), { spill, noAO: true }),
          emitters: def.emitters,
        });
      }
    }

    // Bucket the placements so each (variant, material) becomes one draw.
    const buckets = new Map<string, THREE.Matrix4[]>();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    for (const s of sites) {
      const v = s.seed % VARIANTS;
      const key = `${s.kind}:${v}`;
      const entry = lib.get(key);
      if (!entry) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y, s.z), q, one);
      const list = buckets.get(key);
      if (list) list.push(m);
      else buckets.set(key, [m]);
      for (const e of entry.emitters) {
        const w = e.pos.clone().applyMatrix4(m);
        this.emitters.push({ ...e, world: w, phase: (s.seed % 997) / 159.15 });
      }
      this.stats.props++;
    }

    for (const [key, mats] of buckets) {
      const entry = lib.get(key);
      if (!entry) continue;
      for (const [mk, geo] of entry.geos) {
        const material = this.palette.get(mk);
        if (!material) continue;
        const im = new THREE.InstancedMesh(geo, material, mats.length);
        for (let i = 0; i < mats.length; i++) im.setMatrixAt(i, mats[i]);
        im.instanceMatrix.needsUpdate = true;
        const emissive = EMISSIVE_KEYS.has(mk);
        im.castShadow = !emissive;
        im.receiveShadow = !emissive;
        // Without this the instanced bounds are the single-instance bounds and
        // three culls the whole batch the moment the prototype leaves view.
        im.computeBoundingSphere();
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        const bs = im.boundingSphere;
        this.propBatches.push({
          mesh: im,
          size: (geo.boundingSphere?.radius ?? 0.5) * 2,
          centre: bs ? bs.center.clone() : new THREE.Vector3(),
          radius: bs ? bs.radius : 0,
          emissive,
        });
        this.group.add(im);
        this.owned.push(geo);
        this.stats.meshes++;
        this.stats.triangles += ((geo.attributes.position as THREE.BufferAttribute).count / 3) * mats.length;
      }
    }

    // Unplaced variants would otherwise leak their geometry.
    for (const [key, entry] of lib) {
      if (buckets.has(key)) continue;
      for (const g of entry.geos.values()) g.dispose();
    }
  }

  private buildDockGroup(from: THREE.Vector2, to: THREE.Vector2, groundAt: (x: number, z: number) => number): void {
    const dock = buildDock({ from, to, seed: 0x9e37, width: 3.4, groundAt });
    const geos = this.compile(dock.parts);
    const g = new THREE.Group();
    g.position.copy(dock.origin);
    this.meshesFor(geos, g);
    this.group.add(g);
    for (const e of dock.emitters) {
      this.emitters.push({ ...e, world: e.pos.clone().add(dock.origin), phase: e.pos.x * 0.7 });
    }
  }

  // ------------------------------------------------------------- runtime

  update(ctx: Ctx): void {
    const m = this.mats;
    if (!m) return;

    const sky = ctx.get<IAtmosphere>('sky');
    // Lamp gate from the KEY LIGHT'S INTENSITY, not from the clock and not
    // from weather.sunDir — after dusk the atmosphere repoints that vector at
    // whichever moon is brighter, so its Y is happily positive at midnight and
    // every window in the settlement stays dark. Intensity has no such
    // ambiguity: daylight is order 1, moonlight is order 0.05, and a blotted
    // sun in an ash storm lands between the two, which is exactly when a
    // Cindren household would light the lamps anyway.
    const key = sky ? sky.sun.intensity : 3;
    // Lamps also come on when the AIR closes in, not only when the sun goes
    // down.
    //
    // The review's ashstorm note is the whole reason: "in an ashstorm the towers
    // glowing through the murk IS the Morrowind shot, and we render three grey
    // mushrooms". At hour 13 in a storm the key light is only knocked to 40%, so
    // the clock-and-intensity gate held every lamp in the province at its
    // daytime floor while visibility was 120 m — a settlement nobody in it would
    // be sitting in the dark in. Extinction is the right signal: clear air runs
    // 8e-5, an ashstorm 1.5e-2, so the crossover below is unambiguous and
    // nothing but genuinely blinding weather trips it. Held under 1 so a storm
    // at noon is still a lit storm, not night.
    const gloom = smooth(this.fog, 1.2e-3, 6.0e-3);
    this.night = Math.max(1 - smooth(key, 0.10, 0.50), gloom * 0.85);

    m.setTime(ctx.time.elapsed, this.wind.x, this.wind.y, this.windSpeed);
    m.setNight(this.night);

    // Window panels dim in daylight but never to nothing.
    //
    // At 0.02 a daytime window is a black rectangle in a hole, which is what a
    // flat unlit quad looks like from any distance — the review caught it in
    // three separate shots. A Cindren interior at noon is still a lamp-lit room
    // with no other opening, so a low ember floor is both physically right and
    // the only thing that gives an aperture a value read against a same-value
    // hull at hour 10.
    const flickerAll = 0.86 + 0.14 * Math.sin(ctx.time.elapsed * 7.3);
    // 0.34 floor, not 0.22. The review's dawn note is the one to answer: at
    // 6.2 h "not one of them is lit, which discards the strongest available
    // reading cue for the settlement's scale and habitation". A Cindren tower at
    // first light has lamps burning in the rooms that are awake; the per-panel
    // `aLit` scatter decides which, and this sets how far the unlit ones fall.
    // 0.152 floor, not 0.34, because the panel's base radiance went up by 2.24x
    // with the dusk fix: 0.85 * 0.152 is the same 0.129 the old 0.38 * 0.34
    // produced, so daylight is unchanged to the last digit and the whole of the
    // gain lands at dusk and at night, which is where the review measured the
    // towers failing to hold against the sky.
    if (this.windowGlow) this.windowGlow.uGlowMul.value = 0.152 + 0.848 * this.night;
    if (this.fireGlow) this.fireGlow.uGlowMul.value = flickerAll * (0.75 + 0.35 * this.night);

    this.cullProps(ctx);
    this.assignLights(ctx);
  }

  /**
   * Screen-size cull for the instanced prop batches.
   *
   * Props exist to carry detail density within a few tens of metres. Past that
   * they are sub-pixel, and three's frustum culling cannot help: the batch's
   * bounds enclose the whole village, so looking at the village from anywhere
   * draws every batch. Gating on the projected size of ONE prop — measured
   * against the nearest point of the batch, so nothing vanishes while it is
   * still legible — removes them from the scene pass, the depth prepass and
   * every cascade at once.
   */
  private cullProps(ctx: Ctx): void {
    if (this.propBatches.length === 0) return;
    ctx.camera.getWorldPosition(this.camPos);
    // Pixels per radian: what one metre at one metre of depth covers.
    const pxPerM = ctx.size.h / (2 * Math.tan((ctx.camera.fov * Math.PI) / 360));
    for (const b of this.propBatches) {
      const d = Math.max(1, this.camPos.distanceTo(b.centre) - b.radius);
      const px = (b.size * pxPerM) / d;
      b.mesh.visible = px >= PROP_PX_MIN;
      // A shadow needs several pixels of prop to read as anything but noise,
      // and the cascade covering that distance has metre-wide texels anyway.
      const cast = !b.emissive && px >= PROP_PX_SHADOW;
      if (b.mesh.castShadow !== cast) b.mesh.castShadow = cast;
    }
  }

  /**
   * Fill the fixed light pool with the most important nearby emitters.
   *
   * Importance is power over distance, gated on time of day for windows. The
   * intensity fades to zero at the cull radius rather than switching off, so a
   * lamp leaving the pool does not pop.
   */
  private assignLights(ctx: Ctx): void {
    ctx.camera.getWorldPosition(this.camPos);
    const cand = this.cand;
    cand.length = 0;
    for (const e of this.emitters) {
      const gate = e.kind === 'window' ? this.night : 1;
      if (gate < 0.02) continue;
      const d = this.camPos.distanceTo(e.world);
      if (d > LIGHT_CULL) continue;
      cand.push({ e, d, score: (e.power * gate) / (1 + d * d * 0.004) });
    }
    cand.sort((a, b) => b.score - a.score);

    const t = ctx.time.elapsed;
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const c = i < cand.length ? cand[i] : null;
      if (!c) {
        l.intensity = 0;
        continue;
      }
      const e = c.e;
      const gate = e.kind === 'window' ? this.night : 1;
      // Fire wobbles on two incommensurate frequencies; a single sine reads as
      // a machine, which is exactly what a hearth must not read as.
      const flick =
        e.kind === 'window'
          ? 0.94 + 0.06 * Math.sin(t * 1.7 + e.phase)
          : e.kind === 'bio'
            ? // Fungus breathes; it does not flicker. Same period as the
              // emissive's own pulse so the light and the surface agree.
              0.78 + 0.22 * (0.6 * Math.sin(t * 0.42 + e.phase) + 0.4 * Math.sin(t * 0.26 + e.phase * 1.9))
            : 0.72 + 0.28 * (0.6 * Math.sin(t * 9.1 + e.phase) + 0.4 * Math.sin(t * 3.7 + e.phase * 2.1));
      const fade = 1 - smooth(c.d, LIGHT_CULL * 0.8, LIGHT_CULL);
      l.position.copy(e.world);
      l.color.copy(e.hue);
      l.distance = e.range;
      l.decay = 2;
      l.intensity = e.power * gate * flick * fade;
    }
  }

  dispose(): void {
    this.offWeather?.();
    this.offWeather = null;
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    for (const g of this.owned) g.dispose();
    this.owned.length = 0;
    this.group.clear();
    for (const l of this.lights) {
      l.removeFromParent();
      l.dispose();
    }
    this.lights.length = 0;
    this.mats?.dispose();
    this.mats = null;
    this.palette.clear();
    this.emitters.length = 0;
    this.layout = null;
  }
}

/**
 * Baked-light sources for one structure: every emitter, plus whatever the
 * generator declared that must NOT become a runtime point light.
 */
function spillOf(st: Structure): SpillSource[] {
  const out: SpillSource[] = [];
  for (const e of st.emitters) {
    // Bio emitters have their own ungated channel and a cyan colour; folding
    // them in here would wash the cap in the lamp's orange instead.
    if (e.kind === 'bio') continue;
    out.push({
      pos: e.pos,
      range: Math.min(e.range, 13),
      power: e.kind === 'brazier' ? e.power * 0.22 : e.power * 0.30,
    });
  }
  if (st.spill) out.push(...st.spill);
  return out;
}

/** Stable 0..1 from an integer seed, for the per-structure batch tint. */
function hash01(seed: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(x: number, a: number, b: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
