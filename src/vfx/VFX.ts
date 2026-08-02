import * as THREE from 'three';
import type { IAtmosphere, IPlayer, ITerrain } from '../core/contracts';
import { Surface, type Ctx, type System, type WeatherState } from '../core/types';
import {
  AmbientLayer,
  ANCHORS,
  MODE_DRIFT,
  MODE_FOG,
  MODE_RISE,
  MODE_SPRAY,
  MODE_VORTEX,
} from './Ambient';
import { AshStreaks, AshVolume } from './Ashstorm';
import { BEAM_LIGHTNING, BEAM_RAY, BeamPool, type BeamSpec } from './Beams';
import { Fissures } from './Fissures';
import { vfxUniforms } from './glsl';
import { LocalField, SIZE as FIELD_SIZE } from './LocalField';
import { Plume } from './Plume';
import { Portal } from './Portal';
import { HazePool, type HazeSpec } from './Screen';
import {
  LOOK_SMOKE,
  DECAL_FROST,
  DECAL_RIPPLE,
  DECAL_SCORCH,
  DECAL_SPLASH,
  DecalPool,
  LOOK_CRYSTAL,
  LOOK_FIRE,
  LOOK_PLAIN,
  LOOK_SHIMMER,
  SpellBatch,
  type DecalSpec,
  type EmitSpec,
} from './Spells';
import { TILE_FLAKE, TILE_PUFF, TILE_SHARD, TILE_SPARK, buildParticleAtlas, buildSigilTexture } from './Sprites';

/**
 * ASHLANDS — particles, VFX and magic.
 *
 * SIMULATION MODEL. Nothing here is stepped on the CPU. Every particle's
 * position, size, spin and opacity is a closed-form function of an immutable
 * per-instance seed and the global clock, evaluated in the vertex shader. A
 * spawn writes six vec4s into a uniform array; a frame writes about a dozen
 * shared uniforms. There is no per-particle attribute upload anywhere in this
 * subsystem, and no allocation on the spawn path — every pool is built at init
 * and reused by expiry.
 *
 * That choice (vertex-parametric rather than a ping-pong state texture) is
 * deliberate: these effects are all short-lived or spatially gated, none of
 * them needs inter-frame state or collision feedback, and skipping the state
 * texture also skips two render targets, two passes and a full frame of
 * latency. The one thing a parametric field cannot do — know where the ground
 * is — is supplied by `LocalField`, a small heightfield texture resampled from
 * `ITerrain` a few rows per frame.
 *
 * LIGHTING. Non-emissive particles (ash, dust, spray, fog, impact grit) run a
 * real BRDF against the sun read from `ctx.get('sky').sun`: wrapped diffuse,
 * a Henyey-Greenstein forward lobe so motes flare when backlit, a GGX sheen so
 * wet spray does not shade like chalk, and the shared `applyAerial` so their
 * fog matches the sky exactly. Emissive particles get transmittance only, so an
 * additive blend never double-counts in-scatter.
 *
 * See the file header of each collaborator for the rest.
 */

/** Render order band. Terrain is -10, sky dome 1000, sky particulate 1100-1200. */
const RO_FOG = 1290;
/** The eruption column: behind every near-field element, in front of the sky. */
const RO_PLUME = 1285;
const RO_AMBIENT = 1300;
/**
 * The particulate medium. BEFORE the discrete particle layers on purpose: it is
 * composited against the scene depth buffer, so it is correct over opaque
 * geometry regardless of draw order, and drawing it first means an ember or a
 * mote in front of the mist is not also attenuated by the full depth of it.
 */
const RO_ASH_VOL = 1295;
/**
 * The mid-field grit sheets, AFTER the volume.
 *
 * They used to share RO_FOG, i.e. they were drawn before the raymarched medium
 * and then had the medium's whole 340 m of in-scatter composited on top of
 * them — which in a full storm is an alpha near 0.7, so the layer whose job is
 * the storm's macro-motion was being erased by the storm's own extinction. The
 * sheets carry their own aerial transmittance in the fragment, so compositing
 * them after the medium is also the more correct order: a sheet sixty metres out
 * should be attenuated by sixty metres of air, not by the full slab.
 */
const RO_SHEETS = 1297;
/** Emissive veins on Red Mountain: on the terrain, so behind everything airborne. */
const RO_FISSURE = 1240;
const RO_DECAL = 1250;
const RO_SPELL_ALPHA = 1320;
const RO_SPELL_ADD = 1340;
const RO_BEAM = 1360;
const RO_PORTAL = 1330;
const RO_HAZE = 1380;
/** Grit on the lens: in front of everything, by construction. */
const RO_ASH_NEAR = 1395;

const PORTALS = 2;
const FLASHES = 3;

/** Per-tier instance budgets. `high` is the shipping target. */
const TIER_SCALE: Record<string, number> = { low: 0.30, medium: 0.60, high: 1.0, ultra: 1.35 };

interface LayerSet {
  motes: AmbientLayer;
  sheets: AmbientLayer;
  embers: AmbientLayer;
  spores: AmbientLayer;
  spray: AmbientLayer;
  fog: AmbientLayer;
  dust: AmbientLayer;
}

export class VFXSystem implements System {
  readonly id = 'vfx';
  readonly order = 120;

  private group = new THREE.Group();
  private atlas: THREE.DataTexture | null = null;
  private sigil: THREE.CanvasTexture | null = null;
  private field = new LocalField();
  private layers: LayerSet | null = null;
  private addBatch: SpellBatch | null = null;
  private alphaBatch: SpellBatch | null = null;
  private decals: DecalPool | null = null;
  private beams: BeamPool | null = null;
  private haze: HazePool | null = null;
  /** Near / mid / far grit bands. See `buildStreaks`. */
  private streaks: AshStreaks[] = [];
  private ashVol: AshVolume | null = null;
  private plume: Plume | null = null;
  private fissures: Fissures | null = null;
  /** Set once the terrain survey has found (or ruled out) a caldera. */
  private calderaSearched = false;
  private portals: Portal[] = [];
  private flashes: THREE.PointLight[] = [];
  private flashPeak: Float32Array = new Float32Array(FLASHES);
  private flashStart: Float32Array = new Float32Array(FLASHES);
  private flashLife: Float32Array = new Float32Array(FLASHES);
  private flashNext = 0;

  private terrain: ITerrain | null = null;
  private sky: IAtmosphere | null = null;
  private weather: WeatherState | null = null;
  private offWeather: (() => void) | null = null;
  private offQuality: (() => void) | null = null;
  private tier = 1.0;

  /** True once someone has bound a scene depth buffer; see `setSceneDepth`. */
  private depthOverridden = false;
  private ndRef: THREE.Texture | null = null;

  private camPos = new THREE.Vector3();
  private sunDir = new THREE.Vector3(0, 1, 0);
  private anchorTimer = 0;
  private anchorSeed = 0;
  private splashAcc = 0;
  private now = 0;
  /** Cached results of the periodic terrain survey; see `survey()`. */
  private nearLava = 0;
  private nearShore = 0;
  private nearFungal = 0;
  private surveyTimer = 0;
  /** Local ground level around the camera; see `fogLevel`. */
  private groundY = 0;

  // Scratch. The spawn path must not allocate.
  private sEmit: EmitSpec = {
    origin: new THREE.Vector3(),
    dir: new THREE.Vector3(0, 1, 0),
    dirBias: 0.4,
    color: new THREE.Color(1, 1, 1),
    life: 1,
    size: 0.2,
    intensity: 1,
    speed: 3,
    gravity: 0,
    converge: 0,
    swirl: 0.5,
    turbFreq: 0.5,
    tile: TILE_SPARK,
    look: LOOK_PLAIN,
    soft: 0.5,
  };
  private sDecal: DecalSpec = {
    centre: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 1, 0),
    radius: 1,
    life: 4,
    kind: DECAL_SCORCH,
    color: new THREE.Color(1, 1, 1),
  };
  private sHaze: HazeSpec = { centre: new THREE.Vector3(), radius: 1, life: 1, strength: 0.02 };
  private sBeam: BeamSpec = {
    from: new THREE.Vector3(),
    to: new THREE.Vector3(),
    color: new THREE.Color(1, 1, 1),
    width: 0.05,
    life: 0.5,
    kind: BEAM_LIGHTNING,
    intensity: 4,
    jitter: 0.1,
  };
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  /* ---------------------------------------------------------------- init */

  init(ctx: Ctx): void {
    this.atlas = buildParticleAtlas();
    this.sigil = buildSigilTexture(512);
    this.terrain = ctx.get<ITerrain>('terrain') ?? null;
    this.sky = ctx.get<IAtmosphere>('sky') ?? null;

    const U = vfxUniforms();
    U.uVfxLocal.value = this.field.texture;
    U.uVfxLocalSize.value = FIELD_SIZE;

    ctx.camera.getWorldPosition(this.camPos);
    if (this.terrain) this.field.prime(this.terrain, this.camPos.x, this.camPos.z);
    (U.uVfxLocalOrigin.value as THREE.Vector2).copy(this.field.origin);
    U.uVfxLocalValid.value = this.field.valid ? 1 : 0;

    this.layers = this.buildLayers(this.atlas);
    for (const k of Object.keys(this.layers) as (keyof LayerSet)[]) {
      this.group.add(this.layers[k].mesh);
    }

    this.addBatch = new SpellBatch(this.atlas, true, RO_SPELL_ADD);
    this.alphaBatch = new SpellBatch(this.atlas, false, RO_SPELL_ALPHA);
    this.decals = new DecalPool(RO_DECAL);
    this.beams = new BeamPool(RO_BEAM);
    this.haze = new HazePool(RO_HAZE);
    this.streaks = this.buildStreaks(this.atlas);
    this.ashVol = new AshVolume(RO_ASH_VOL);
    this.plume = new Plume({ renderOrder: RO_PLUME, count: 20000 }, this.atlas, TILE_PUFF);
    this.fissures = new Fissures({ renderOrder: RO_FISSURE, maxNodes: 2600 });
    this.group.add(
      this.addBatch.mesh,
      this.alphaBatch.mesh,
      this.decals.mesh,
      this.beams.mesh,
      this.haze.mesh,
      this.ashVol.mesh,
      this.plume.mesh,
      this.fissures.mesh,
    );
    for (const s of this.streaks) this.group.add(s.mesh);

    for (let i = 0; i < PORTALS; i++) {
      const p = new Portal(this.sigil, RO_PORTAL);
      this.portals.push(p);
      this.group.add(p.mesh);
    }

    // Flash lights are created ONCE and left in the scene at zero intensity.
    // Adding and removing lights changes the light counts three keys its
    // program cache on, so a spell cast would otherwise recompile every
    // material in the world mid-frame.
    for (let i = 0; i < FLASHES; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 40, 2);
      l.castShadow = false;
      l.visible = true;
      l.name = `vfx:flash${i}`;
      this.flashes.push(l);
      this.group.add(l);
    }

    this.group.name = 'vfx';
    ctx.scene.add(this.group);

    this.offWeather = ctx.bus.on<WeatherState>('weather', (w) => {
      this.weather = w;
    });
    this.offQuality = ctx.bus.on<{ tier: string }>('quality', (q) => {
      this.tier = TIER_SCALE[q?.tier ?? 'high'] ?? 1;
    });

    // A cast anywhere in the game can be routed here without importing us.
    ctx.bus.on<{ effect: string; position: THREE.Vector3; dir?: THREE.Vector3 }>('vfx:spawn', (p) => {
      if (p?.position) this.spawn(p.effect, p.position, p.dir);
    });
  }

  /**
   * THE STORM'S PARTICULATE, in three depth bands.
   *
   * A single camera-anchored slab five metres deep is grit on the lens and
   * nothing else; everything past it was left to the `motes` layer, whose
   * millimetric grains all sit under the minimum projected footprint and are
   * therefore drawn at a few percent opacity after energy compensation. That is
   * why the signature weather shot measured 0.13% high-frequency detail with
   * three and a half thousand instances live.
   *
   * Each band's WORLD grain size is scaled with its distance so that every band
   * lands in the same 2-6 px class on screen — which is the size that reads as
   * grit rather than as snow — and each is elongated by its own screen-space
   * velocity, so the near band streaks hard and the far band stays a drifting
   * mote field. All three read `uVfxWind`, so the whole storm has one direction,
   * and all three share the ash albedo and ceiling with the ambient motes.
   *
   * THE COUNTS ARE WHAT THEY ARE BECAUSE THE SLAB IS NOT THE FRUSTUM.
   *
   * Each band is a camera-anchored world-axis box, and a box that contains a
   * band of radius R has volume (2R)^3 while the frustum inside it has about
   * 1.85/3 * R^3 — so at 70 degrees only about SEVEN PER CENT of any band's
   * population is ever on screen. Add the sub-band the far fade used to throw
   * away and the near band was drawing roughly one grain in seventy. Twelve
   * thousand instances across three bands is therefore a few hundred visible
   * grains covering under two per cent of the frame, which is exactly the
   * measured result: a signature-weather shot with no particulate in it.
   *
   * The honest fix is population, because the cost is not where it looks like it
   * is. An off-screen instance costs four vertex invocations and no fragments;
   * the fragment cost — the only one that matters here — is proportional to
   * DRAWN coverage, which is the thing being bought. Tripling the counts and
   * dropping vfxCurl to a raw potential tap (a quarter of the vertex cost, see
   * STREAK_VERT) leaves the vertex load slightly BELOW where it was while
   * raising on-screen grain density by an order of magnitude.
   */
  private buildStreaks(atlas: THREE.Texture): AshStreaks[] {
    return [
      // ~2 m. The grit going past your face.
      new AshStreaks(
        {
          count: 26000,
          renderOrder: RO_ASH_NEAR,
          band: [0.35, 6.5],
          box: [13, 16, 13],
          ahead: 2.6,
          speed: 0.010,
          // 1.2-6.0 cm, not 0.8-3.4 mm.
          //
          // MEASURED, not guessed: with the old range the near band drew 2.5%
          // of the frame at a mean effective alpha under 0.2, because almost
          // every grain landed under the 3 px footprint floor and had its
          // opacity divided back out by the energy compensation. A layer that
          // covers half a per cent of the image cannot be the subject of a shot
          // however many instances are behind it. Airborne ash in a forty-metre
          // gale is lapilli, not dust — this is the size at which a grain a
          // couple of metres from the eye is a legible piece of matter rather
          // than a sub-pixel spike, and the value grading below is what keeps it
          // reading as dark grit instead of as snow.
          // The top of the range is the "few large fast near-plane streaks"
          // the ashstorm review asked for and did not get. It is self-limiting:
          // the smear is (screen speed x exposure) / grain width, so a coarse
          // grain streaks LESS than a fine one and cannot run away to a bar
          // across the frame — a 12 cm grain a metre from the eye lands at a
          // 150-400 px streak, which is exactly the read.
          size: [0.022, 0.14],
        },
        atlas,
        TILE_FLAKE,
      ),
      // ~10 m. The band that separates the near grit from the fog, and the one
      // that was missing entirely.
      new AshStreaks(
        {
          count: 18000,
          renderOrder: RO_ASH_NEAR - 1,
          band: [4.5, 26],
          box: [48, 46, 48],
          ahead: 13,
          speed: 0.025,
          size: [0.115, 0.430],
        },
        atlas,
        TILE_FLAKE,
      ),
      // ~30 m. Shreds and wisps rather than individual grains, but drawn by the
      // same shader off the same wind so they cannot drift apart in grade.
      new AshStreaks(
        {
          count: 11000,
          renderOrder: RO_ASH_NEAR - 2,
          band: [14, 62],
          box: [100, 96, 100],
          ahead: 27,
          speed: 0.060,
          size: [0.30, 1.05],
        },
        atlas,
        TILE_FLAKE,
      ),
    ];
  }

  private buildLayers(atlas: THREE.Texture): LayerSet {
    return {
      // Near-field airborne ash. The sky subsystem owns the far precipitation
      // field; this layer is the close, individually-lit grain that catches the
      // sun and gives the air a scale the distant field cannot.
      motes: new AmbientLayer(
        {
          mode: MODE_DRIFT,
          count: 5200,
          box: new THREE.Vector3(72, 26, 72),
          boxLift: 0.26,
          // Airborne ash is MILLIMETRES. A 13 cm flake five metres from the eye
          // is an 18-pixel disc, and at the radiance the medium hands it that
          // disc is a cream-white blob hanging over the grass — the vale
          // blocker. The minimum-footprint clamp already guarantees a grain
          // stays legible at distance without inflating its world size.
          size: [0.014, 0.062],
          // Mostly fine grain with a scatter of coarse, and an opacity spread
          // that is not tied to it. A layer drawn from a flat distribution puts
          // its whole population in one visual size class, which is what makes
          // airborne ash read as a repeated sprite rather than as matter.
          sizePow: 2.2,
          alphaVar: 0.6,
          tile: TILE_FLAKE,
          // ONE ASH MATERIAL. These five numbers are shared verbatim with the
          // near-field streaks in Ashstorm.ts: the two layers are the same
          // substance at two distances, and when their albedo or their ceiling
          // diverge the frame shows pale blobs close in and dark shards far
          // out, which is not a storm, it is two effects.
          color: new THREE.Color(0.42, 0.365, 0.30),
          alpha: 0.55,
          rough: 0.95,
          translucency: 1.40,
          media: 1.0,
          // A mote must dissolve into the ground it drifts against rather than
          // stamp a disc on it; half a metre was not enough to read as a fade.
          soft: 1.2,
          // Just under parity with the medium. A suspended flake cannot
          // out-radiate the sky that lights it, and at parity the layer's pale
          // tail sat on top of shadowed basalt as the brightest thing in frame.
          lumCap: 0.90,
          // Ash does not survive against the sky. Anything that lofts more than
          // ~16 m off the ground is gone before it can clear the horizon line
          // and become an unexplained bright speck in an empty sky.
          loft: [9, 16],
          // 1.8 px, not 4.5. The clamp is a sub-pixel backstop and nothing more.
          // At 4.5 the entire population past two metres landed on the floor, so
          // every mote in the frame drew at exactly 4.5 px whatever its depth —
          // the "same screen size regardless of depth" every reviewer measured.
          minPx: 1.8,
          // Back to the flux-conserving 2. Under-compensating was the other half
          // of the same defect: a mote grown five times over still carried most
          // of its opacity, so a grain thirty metres out was as bright and as
          // large as one at arm's length. At 2 a clamped grain's radiance falls
          // as 1/d^2, which is the inverse-square distance fade the reviews
          // asked for and the only honest answer for a scatterer.
          footComp: 2.0,
          // 1/140 s shutter. Airborne grain streaks along the wind, and the
          // streak is what distinguishes particulate from a speck of dirt on
          // the front element. Near grain smears, far grain stays round —
          // angular velocity goes as 1/d — so this is a depth cue as well.
          stretch: 0.0072,
          maxElong: 5.0,
          // Half the population reads below the haze and half above it. Without
          // it the whole layer sits at exactly the medium's luminance, i.e. at
          // exactly the value of the background it is drawn over.
          grainVar: 0.55,
          normalScale: 0.75,
          spin: 1.3,
          turb: [0.045, 1.5],
          groundOff: 0.06,
          fadeDist: 34,
          renderOrder: RO_AMBIENT,
        },
        atlas,
      ),
      // Mid-field: sheets of suspended grit, metres across, advected on the
      // same wind as everything else. This is the scale between the individual
      // mote and the sky system's hundred-metre ash wall, and it is what makes
      // a storm read as MOVING — coherent masses passing between the eye and
      // the ridge, rather than a uniform veil of dots.
      sheets: new AmbientLayer(
        {
          mode: MODE_DRIFT,
          count: 190,
          box: new THREE.Vector3(190, 78, 190),
          boxLift: 0.30,
          size: [4.0, 11],
          tile: TILE_PUFF,
          color: new THREE.Color(0.50, 0.44, 0.36),
          alpha: 0.12,
          rough: 1.0,
          translucency: 1.2,
          media: 1.05,
          lumCap: 0.90,
          grainVar: 0.40,
          soft: 6.0,
          normalScale: 0.30,
          spin: 0.22,
          turb: [0.012, 5.0],
          groundOff: 1.2,
          // A sheet this size is only ever a mid-field element: inside 22 m it
          // fills the viewport, and a hundred of those is a hundred screens of
          // overdraw for an effect nobody can read.
          nearFade: 22,
          fadeDist: 165,
          renderOrder: RO_SHEETS,
        },
        atlas,
      ),
      // Embers over lava crust, gated entirely by the local field's lava mask.
      embers: new AmbientLayer(
        {
          mode: MODE_RISE,
          count: 1600,
          box: new THREE.Vector3(110, 1, 110),
          // A real world radius, 1-7 cm, drawn power-law so the population is
          // mostly fine sparks with a scatter of clots. This is the term that
          // makes an ember SCALE: with a 3.5 cm floor and a 7 px minimum
          // footprint every ember past four metres was clamped to exactly the
          // same projected size, so near and far embers occupied identical
          // pixel footprints and the field read as a sheet of stuck pixels.
          size: [0.018, 0.075],
          sizePow: 2.4,
          alphaVar: 0.45,
          tile: TILE_SPARK,
          // #ff7a2a driven hot. Embers are one of exactly two things the bible
          // lets off the desaturation leash.
          color: new THREE.Color(3.0, 0.86, 0.16),
          alpha: 1,
          emissive: true,
          // An ember IS allowed to be the brightest thing in frame — but not
          // without limit, or the tone curve and the bloom downsample turn each
          // one into a white dot with an orange fringe and the ember colour,
          // one of the two the palette lets off the leash, is thrown away.
          lumCap: 2.6,
          lumFloor: 0.55,
          // 2.6 px, not 7. The clamp exists so a sub-pixel emitter does not
          // alias into a crawling speck; set high it becomes the thing that
          // destroys perspective, because every ember in the mid-field lands on
          // the floor and stops shrinking with distance.
          minPx: 2.6,
          // Partial energy compensation. Full 1/grow^2 conservation on a clamped
          // emitter divides a far ember's radiance by the square of the growth,
          // which drops it under the bloom prefilter threshold — and an ember
          // with no bloom halo is a hot pixel, not a spark. At 1.25 a far ember
          // still dims with distance but keeps its halo.
          footComp: 1.25,
          // Combustion, not a light bulb.
          flicker: 0.45,
          soft: 0.7,
          life: 5.5,
          rise: 2.4,
          gravity: -0.16,
          turb: [0.085, 1.1],
          groundOff: 0.25,
          spin: 2.0,
          fadeDist: 70,
          renderOrder: RO_AMBIENT,
        },
        atlas,
      ),
      // Bioluminescent spore drift. Vivid on purpose — with lava it is the only
      // saturated thing the art bible allows.
      spores: new AmbientLayer(
        {
          mode: MODE_DRIFT,
          count: 1800,
          box: new THREE.Vector3(48, 16, 48),
          boxLift: 0.32,
          // #3fd6c0 in linear, driven above 1 so it survives the tone curve as
          // a saturated accent rather than washing to white.
          size: [0.03, 0.09],
          tile: TILE_SPARK,
          color: new THREE.Color(0.16, 1.15, 0.88),
          alpha: 1,
          emissive: true,
          // Vivid, never blown: a spore that clips to white has thrown away the
          // only saturated hue in the palette.
          lumCap: 4.0,
          lumFloor: 0.09,
          minPx: 3.0,
          footComp: 1.3,
          sizePow: 1.8,
          alphaVar: 0.4,
          flicker: 0.25,
          soft: 0.6,
          spin: 0.5,
          turb: [0.07, 1.1],
          groundOff: 0.4,
          // Spore drift is a ground-level phenomenon; nothing in this layer may
          // be seen against the sky either.
          loft: [5, 10],
          fadeDist: 26,
          renderOrder: RO_AMBIENT,
        },
        atlas,
      ),
      spray: new AmbientLayer(
        {
          mode: MODE_SPRAY,
          count: 1100,
          box: new THREE.Vector3(120, 1, 120),
          size: [0.10, 0.42],
          tile: TILE_PUFF,
          color: new THREE.Color(0.74, 0.80, 0.84),
          alpha: 0.55,
          // Water: much smoother than dust, which is what separates the two.
          rough: 0.28,
          translucency: 2.4,
          media: 0.65,
          // Spray genuinely can catch a highlight above the haze; it is water,
          // not ash. Still capped, so a backlit sheet does not clip.
          lumCap: 1.25,
          soft: 1.0,
          normalScale: 0.9,
          // A droplet is world-sized like everything else: the default 5 px
          // floor pinned the whole sheet to one screen size past ten metres.
          minPx: 2.0,
          // Spray is launched, not drifting: it streaks along its own ballistic
          // velocity, which is what separates a burst of surf from a haze.
          stretch: 0.0060,
          maxElong: 4.0,
          life: 1.7,
          rise: 3.4,
          gravity: -9.0,
          groundOff: 0.05,
          spin: 1.0,
          fadeDist: 60,
          renderOrder: RO_AMBIENT,
        },
        atlas,
      ),
      // Ground mist, FALLBACK PATH ONLY.
      //
      // A mist bank made of billboards is a lie that shows: the card has a
      // silhouette of its own, it terminates on a line wherever the soft fade
      // runs out of occluder to fade against, and because it is a lit sprite
      // rather than a medium it ends up the brightest thing in the midground
      // instead of the dimmest. The shipping path is the raymarched height fog
      // in `AshVolume`, which is a real medium with real depth. This layer is
      // only used on tiers that render no depth prepass, where the raymarch
      // cannot run at all — see `tuneAmbient`. It is graded well under the
      // medium so that even the fallback cannot out-read the terrain.
      fog: new AmbientLayer(
        {
          mode: MODE_FOG,
          count: 420,
          box: new THREE.Vector3(190, 1, 190),
          size: [10, 26],
          sizePow: 1.6,
          alphaVar: 0.5,
          tile: TILE_PUFF,
          color: new THREE.Color(0.50, 0.47, 0.44),
          alpha: 0.11,
          rough: 1.0,
          translucency: 1.6,
          media: 0.85,
          lumCap: 0.55,
          soft: 8.0,
          normalScale: 0.3,
          spin: 0.4,
          groundOff: 0.5,
          fadeDist: 135,
          renderOrder: RO_FOG,
        },
        atlas,
      ),
      dust: new AmbientLayer(
        {
          mode: MODE_VORTEX,
          // A DEVIL IS A MASS OF GRAIN, NOT A STACK OF DISCS.
          //
          // 900 puffs of 0.45-2.4 m project, at the 34-97 m the anchors are
          // placed at, as twenty to eighty pixel soft circles — individually
          // resolvable, individually out of focus against a frame in which
          // nothing else is, and with no visible source. That is the ridge
          // blocker verbatim, and it is also what put "large soft circular
          // sprites" over dawn's near ground and redmtn's rock formation.
          //
          // The cost of a billboard field is DRAWN COVERAGE, which goes as
          // count * size^2. Cutting the sprite by a factor of four and raising
          // the count by three leaves this layer at under a fifth of its old
          // fill while giving any one gap in the column a dozen silhouettes to
          // be covered by — which is what makes it read as suspended grain
          // instead of as a handful of pasted discs.
          count: 2600,
          box: new THREE.Vector3(1, 1, 1),
          size: [0.09, 0.55],
          sizePow: 1.8,
          alphaVar: 0.5,
          tile: TILE_PUFF,
          color: new THREE.Color(0.44, 0.38, 0.31),
          // A dust puff must never be the brightest thing in a lit exterior.
          // 0.34 alpha over a forward lobe of 2.4 is what put four pale discs
          // on the ridge that out-read the terrain under them.
          alpha: 0.16,
          rough: 0.95,
          translucency: 1.3,
          media: 0.85,
          lumCap: 0.62,
          soft: 1.6,
          minPx: 1.8,
          footComp: 2.0,
          // The grain in a devil is going round the column fast. Streaking it
          // along that velocity is most of what makes the thing read as a
          // rotating volume rather than as a cloud of static blobs.
          stretch: 0.0072,
          maxElong: 5.0,
          normalScale: 0.5,
          life: 7,
          rise: 3.0,
          turb: [0.05, 1.4],
          spin: 0.9,
          fadeDist: 95,
          renderOrder: RO_AMBIENT,
        },
        atlas,
      ),
    };
  }

  /* -------------------------------------------------------------- update */

  update(ctx: Ctx): void {
    const L = this.layers;
    if (!L) return;
    this.now = ctx.time.elapsed;
    ctx.camera.getWorldPosition(this.camPos);

    if (this.terrain?.ready) this.field.update(this.terrain, this.camPos);
    this.syncShared(ctx);
    this.bindPipelineDepth(ctx);
    this.survey(ctx.time.dt);
    this.findCaldera();
    this.tuneAmbient(ctx, L);
    this.tunePlume(ctx);
    this.driveWeatherEvents(ctx);

    this.addBatch?.update(this.now);
    this.alphaBatch?.update(this.now);
    this.decals?.update(this.now);
    this.beams?.update(this.now);
    this.haze?.update(this.now);
    for (const p of this.portals) p.update(this.now);
    this.updateFlashes();
  }

  /** One write per frame into the module-singleton uniform block. */
  private syncShared(ctx: Ctx): void {
    const U = vfxUniforms();
    U.uVfxTime.value = ctx.time.elapsed;
    (U.uVfxCamPos.value as THREE.Vector3).copy(this.camPos);
    // Pixels per world unit at one metre. Every sprite's minimum-footprint
    // clamp is expressed in pixels, so this has to track the real viewport and
    // the real field of view, not a constant.
    U.uVfxProj.value =
      (0.5 * Math.max(ctx.size.h, 1)) / Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) * 0.5);
    (U.uVfxLocalOrigin.value as THREE.Vector2).copy(this.field.origin);
    U.uVfxLocalValid.value = this.field.valid ? 1 : 0;

    // The sun object is the contract; never a light of our own.
    const sun = this.sky?.sun;
    if (sun) {
      this.sunDir.copy(sun.position).sub(sun.target.position);
      if (this.sunDir.lengthSq() < 1e-8) this.sunDir.set(0, 1, 0);
      this.sunDir.normalize();
      (U.uVfxSunDir.value as THREE.Vector3).copy(this.sunDir);
      (U.uVfxSunColor.value as THREE.Color).copy(sun.color).multiplyScalar(sun.intensity);
    }
    const w = this.weather ?? this.sky?.weather ?? null;
    if (w) {
      (U.uVfxAmbient.value as THREE.Color).copy(w.ambient);
      (U.uVfxWind.value as THREE.Vector3).set(
        w.windDir.x * w.windSpeed,
        0,
        w.windDir.y * w.windSpeed,
      );
      U.uVfxWetness.value = w.wetness;
    }
  }

  /**
   * Opportunistic scene-depth binding.
   *
   * THE RENDER PIPELINE EXPOSES NO DEPTH TARGET. `RenderPipeline.depthTex` (the
   * DepthTexture on the HDR target) and `rtND` (attachment 0 of the prepass:
   * view normal in rgb, LINEAR view depth in a) are both private, and
   * `IPipeline.composer` turned out to be a descriptive object literal rather
   * than the registration API its doc comment implies. Until that contract
   * gains a getter, this reads `rtND` through the same read-only escape hatch
   * `TerrainSystem.bindPrepassMatrices` already uses — nothing under src/render
   * is written, and the binding is dropped silently if the field is absent.
   *
   * `rtND` is the right source rather than the depth attachment: it is a
   * separate target that is NOT bound while the main pass draws, so sampling it
   * from a forward material is not a framebuffer feedback loop, and its alpha
   * is already linear view depth in metres. Tiers without a prepass allocate it
   * as a 1x1 stub, which is what the size check rejects.
   */
  private bindPipelineDepth(ctx: Ctx): void {
    if (this.depthOverridden) return;
    const host = ctx.get('render') as unknown as { rtND?: THREE.WebGLRenderTarget } | undefined;
    const rt = host?.rtND;
    const U = vfxUniforms();
    if (!rt || rt.width < 8 || rt.textures.length === 0) {
      if (this.ndRef !== null) {
        this.ndRef = null;
        U.uVfxDepth.value = null;
        U.uVfxDepthValid.value = 0;
      }
      return;
    }
    const tex = rt.textures[0];
    if (tex === this.ndRef) return;
    this.ndRef = tex;
    U.uVfxDepth.value = tex;
    (U.uVfxDepthTexel.value as THREE.Vector2).set(1 / rt.width, 1 / rt.height);
    U.uVfxDepthValid.value = 1;
  }

  /**
   * Explicit hook for whoever owns the depth buffer. Once called, the
   * opportunistic binding above stands down permanently.
   *
   * @param tex   RGBA target whose ALPHA channel is linear view depth in metres,
   *              zero where nothing was rasterised. Pass null to disable.
   * @param width Pixel dimensions of that target.
   */
  setSceneDepth(tex: THREE.Texture | null, width: number, height: number): void {
    this.depthOverridden = true;
    const U = vfxUniforms();
    U.uVfxDepth.value = tex;
    U.uVfxDepthValid.value = tex ? 1 : 0;
    (U.uVfxDepthTexel.value as THREE.Vector2).set(1 / Math.max(width, 1), 1 / Math.max(height, 1));
  }

  /**
   * Weather- and time-of-day response. Everything here is a count or a scalar;
   * no geometry is rebuilt and nothing is re-uploaded.
   */
  private tuneAmbient(ctx: Ctx, L: LayerSet): void {
    const w = this.weather ?? this.sky?.weather;
    const hour = ctx.clock.hour;
    const k = this.tier;
    const kind = w?.kind ?? 'clear';
    const blend = w?.blend ?? 1;
    const wind = w?.windSpeed ?? 3;
    const wet = w?.wetness ?? 0;
    this.groundY = this.fogLevel();

    // --- airborne ash -------------------------------------------------------
    //
    // TWO SEPARATE QUANTITIES, and conflating them is what produced six
    // independent "reads as dirt on the lens" reports against iter13.
    //
    //  `load` is the province's permanent atmospheric ASH LOAD. It is real and
    //  it is what makes Vvardenfell's aerial perspective read as ash rather
    //  than as generic distance haze — but it is a MEDIUM, and a medium is
    //  rendered by `AshVolume`, which marches it against the depth buffer and
    //  produces extinction and in-scatter. It must never be rendered as
    //  individually resolvable sprites: a suspended load that is thin enough to
    //  see a kilometre through cannot also be a field of legible discs, and any
    //  attempt to draw it that way lands on the lens as bokeh. That is what was
    //  happening on every clear and cloudy shot.
    //
    //  `fall` is ASHFALL: discrete grain large enough and dense enough to be
    //  resolved as matter. It happens in ash weather and essentially nowhere
    //  else. Clear weather gets none — no sprites at all — and cloudy gets a
    //  whisper, which is what the dawn / dusk / coast / ridge / vale reviews
    //  asked for in as many words.
    let load = 0.22;
    if (kind === 'ashstorm') load = 0.40 + 0.65 * blend;
    else if (kind === 'blight') load = 0.34 + 0.35 * blend;
    else if (kind === 'cloudy' || kind === 'overcast') load = 0.28;
    else if (kind === 'rain' || kind === 'thunder' || kind === 'blizzard') load = 0.05;
    load *= THREE.MathUtils.clamp(0.55 + wind * 0.075, 0.4, 1.6);

    let fall = 0;
    if (kind === 'ashstorm') fall = 0.35 + 0.65 * blend;
    else if (kind === 'blight') fall = 0.22 + 0.38 * blend;
    else if (kind === 'cloudy' || kind === 'overcast') fall = 0.05 * blend;
    fall *= THREE.MathUtils.clamp(0.6 + wind * 0.030, 0.5, 1.5);

    L.motes.setCount(5200 * Math.min(1, fall * 1.5) * k);
    // Ramped from zero, not from a baseline: at `fall` = 0 the layer is not
    // drawn at all, and the count above has already collapsed it.
    L.motes.u('uAlpha').value = 0.22 + 0.50 * fall;
    // In a storm the field must close in, or the "wall" reads as sparse specks.
    L.motes.u('uFadeDist').value = THREE.MathUtils.lerp(30, 20, THREE.MathUtils.clamp(fall, 0, 1));
    // Grain size in METRES, and it stays millimetric even in a full storm — the
    // storm's read comes from count, extinction and the near-field streaks, not
    // from inflating individual motes into discs.
    (L.motes.u('uSize').value as THREE.Vector2).set(0.014, 0.048 + 0.030 * fall);

    // --- the storm proper ---------------------------------------------------
    // One scalar, one wind vector, three layers. `fall` is zero on a clear day,
    // so nothing below is paid for.
    const storm = THREE.MathUtils.clamp((fall - 0.10) / 0.9, 0, 1);
    const gW = (vfxUniforms().uVfxWind.value as THREE.Vector3);

    L.sheets.setCount(190 * k * storm);
    L.sheets.u('uAlpha').value = 0.05 + 0.17 * storm;

    // NO FLOOR. The grit bands used to carry a 0.12 floor so that "the
    // province's permanently loaded air" showed as grain on every shot; what it
    // actually produced was two to three hundred hard tan specks scattered over
    // clear-weather frames at every depth, sitting in front of shadowed basalt
    // as the brightest thing in the region. The permanent load is the medium's
    // job — see `load` above and `AshVolume` below — and the medium renders it
    // correctly, as extinction, with no sprite anywhere near the lens.
    const grit = storm;
    for (let i = 0; i < this.streaks.length; i++) {
      const s = this.streaks[i];
      // Far bands carry less: they are seen through more of the medium, and a
      // distant band at near-field opacity reads as a second, closer storm.
      const w = [1.0, 0.85, 0.7][i] ?? 0.7;
      s.setCount([26000, 18000, 11000][i] * k * grit);
      s.u('uAlpha').value = (0.30 + 3.40 * storm) * w;
      // The value spread each band is drawn over, as multiples of the medium's
      // luminance. It OPENS with the storm: on a clear day the grain is a faint
      // texture in the air and must not read as specks on the lens, in a full
      // storm it is the subject of the shot and has to carry real contrast. It
      // also narrows with distance, because a far band is seen through more of
      // the medium and its grains genuinely converge on the medium's own value.
      const near = 1 - i / Math.max(this.streaks.length - 1, 1);
      // Asymmetric on purpose: the population runs a long way DOWN from the
      // medium and only a little way up. Ash is dark, and a field whose pale
      // tail reaches too far reads as snow — the failure mode this subsystem
      // has been dragged back from twice already.
      // The population's OPTICAL CLASS spread, as a multiplier on the ash
      // albedo — dense black basaltic grit at the bottom of the draw, porous
      // pale pumice at the top. It opens with the storm (on a clear day the
      // grain is a faint texture in the air and must not read as specks on the
      // lens) and it is WIDER on the near band, because that is the band whose
      // grains keep their own value: the aerial transform has converged the far
      // band onto the haze whatever albedo it started from.
      s.u('uGrainLo').value = THREE.MathUtils.lerp(0.70, 0.24 - 0.14 * near, storm);
      s.u('uGrainHi').value = THREE.MathUtils.lerp(1.15, 1.45 + 0.55 * near, storm);
      // GUST DEPTH. The wind-direction cue a storm actually reads on is not the
      // streak angle — that is a static property of the frame — it is density
      // that ARRIVES: sheets of grit sweeping through at the wind's own speed.
      // Zero on a calm day (an even haze of grain, no false weather), deep in a
      // gale. The lattice frequency opens with distance so a far band's gusts
      // are the same physical size as a near band's, i.e. one storm.
      (s.u('uGustField').value as THREE.Vector2).set(
        [0.030, 0.013, 0.006][i] ?? 0.006,
        0.85 * storm,
      );
      s.advance(ctx.time.dt, gW);
    }

    // --- embers -------------------------------------------------------------
    // Gated in the shader by the lava mask, but the vertex shader still runs
    // for every collapsed instance, so cut the draw entirely when there is no
    // lava within reach. Same for spray and the shoreline.
    L.embers.setCount(1600 * k * this.nearLava);

    // --- spores -------------------------------------------------------------
    // Where the ground supports fungus. Night is when the drift is a field of
    // lanterns, but killing it outright in daylight threw away the only
    // saturated hue the palette allows — a desaturated ochre world with NO
    // vivid accent to play against is, per the bible, a failure of the look and
    // not a neutral choice. So daylight keeps a quarter of the population at a
    // fraction of the intensity: enough that #3fd6c0 exists in the frame,
    // nowhere near enough to read as glowing.
    const night = 1 - THREE.MathUtils.smoothstep(this.sunDir.y, -0.06, 0.16);
    const fungal = this.nearFungal;
    L.spores.setCount(1800 * k * (0.24 + 0.76 * night) * fungal);
    L.spores.u('uAlpha').value = 0.30 + 0.70 * night;
    L.spores.u('uLumCap').value = 1.1 + 3.2 * night;

    // --- shoreline spray ----------------------------------------------------
    const surf = THREE.MathUtils.clamp(0.25 + wind * 0.09, 0.2, 1.3);
    L.spray.setCount(1100 * k * surf * this.nearShore);
    L.spray.u('uAlpha').value = 0.35 + 0.35 * surf;

    // --- ground mist --------------------------------------------------------
    // Radiation fog forms on still, damp air around dawn and burns off with the
    // sun; a gale scours it away entirely.
    const dawn = Math.exp(-(((hour - 5.9) / 1.5) ** 2)) + 0.55 * Math.exp(-(((hour - 20.4) / 1.4) ** 2));
    const still = THREE.MathUtils.clamp(1 - (wind - 3) / 9, 0.15, 1);
    const fogAmt = THREE.MathUtils.clamp(dawn * still * (0.55 + 0.75 * wet), 0, 1);
    const depthBound = (vfxUniforms().uVfxDepthValid.value as number) > 0.5;

    if (this.ashVol) {
      this.ashVol.advance(ctx.time.dt, gW);
      // The mist is a MEDIUM, marched against the depth buffer, not a stack of
      // cards. 0.035 per metre inside the body, times the noise duty cycle, is
      // roughly one optical depth across the full march: enough to bury a
      // hollow and grade the midground, nowhere near enough to be the wall of
      // white that "just crank the fog" produces.
      this.ashVol.setFog(0.035 * fogAmt, this.groundY + 4.5);
      // Suspended ash, always. This is now the ONLY thing that renders the
      // province's permanent load, and it is the right thing to render it with:
      // a marched medium produces extinction and in-scatter, which is what a
      // kilometre of thin suspended ash actually does to an image, whereas the
      // sprite layers that used to share the job produced resolvable discs,
      // which is what a kilometre of thin suspended ash conspicuously does not.
      const vol = Math.max(storm, THREE.MathUtils.clamp(load * 0.62, 0, 0.42));
      const ext = 0.0033 * vol;
      this.ashVol.set(ext, this.groundY, ctx.camera, depthBound);
      // Hand the same extinction to every discrete layer, so a grain drawn
      // after the volume pass is attenuated by the volume in front of it. Zero
      // when the raymarch cannot run, or the sprites would be dimmed by a
      // medium that is not on screen.
      vfxUniforms().uVfxVolExt.value = depthBound ? ext * 0.95 : 0;
    }

    // Billboard fallback, drawn only where the raymarch cannot run. See the
    // layer's own comment in `buildLayers`.
    L.fog.setCount(depthBound ? 0 : 420 * k * fogAmt);
    L.fog.u('uAlpha').value = 0.08 + 0.10 * fogAmt;
    // The level line: fog fills what lies below the local ground, so sample a
    // few points around the camera and take a low quantile.
    L.fog.u('uFogLevel').value = this.groundY + 5.5;

    // --- dust devils --------------------------------------------------------
    //
    // A dust devil is a convective vortex, and it needs a wind to exist. The
    // old gate opened at 2.5 m/s — below the clear-weather baseline — so every
    // clear shot in the game had three of them running somewhere in the
    // midground, drawn as half-metre-to-two-metre puffs which at thirty metres
    // are twenty to eighty pixel discs with no visible source. Four of the six
    // major reviews of iter13 were looking at these: the "60-80px soft white
    // discs" on the ridge, the blobs over the redmtn rock formation, and the
    // large soft circles across dawn's near ground are all this layer.
    //
    // The threshold is now above the calm-weather wind entirely, so a devil
    // only appears when the air is genuinely moving, and `placeAnchors` still
    // has to find flat dry open ash to put it on.
    this.anchorTimer -= ctx.time.dt;
    if (this.anchorTimer <= 0) {
      this.anchorTimer = 9 + Math.random() * 7;
      this.placeAnchors(L.dust, wind, kind);
    }
    const gale = THREE.MathUtils.clamp((wind - 9.5) / 9, 0, 1);
    const devils = kind === 'rain' || kind === 'thunder' || kind === 'blizzard' ? 0 : gale;
    L.dust.setCount(2600 * k * devils);
    L.dust.u('uAlpha').value = 0.10 + 0.10 * devils;
  }

  /**
   * Locate Red Mountain once, from the heightfield, and anchor the eruption
   * column on it.
   *
   * The caldera is not authored anywhere this subsystem can see — `ITerrain`
   * exposes height, normal and material and nothing else — so the summit is
   * found the only way the contract allows: a coarse sweep for the highest
   * point in the playable region, refined locally. One pass of ~4k height
   * queries at startup, never repeated.
   *
   * The prominence test is what keeps this honest. On a world with no volcano
   * the highest point is just a hill, and planting a two-kilometre ash column
   * on a hill would be worse than having none; the column is only placed if the
   * summit stands more than 350 m above the surrounding mean.
   */
  private findCaldera(): void {
    if (this.calderaSearched) return;
    const t = this.terrain;
    const p = this.plume;
    if (!t?.ready || !p) return;
    this.calderaSearched = true;

    const R = t.extent;
    const N = 56;
    let bx = 0;
    let bz = 0;
    let best = -Infinity;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x = -R + ((i + 0.5) / N) * 2 * R;
        const z = -R + ((j + 0.5) / N) * 2 * R;
        const h = t.heightAt(x, z);
        sum += h;
        n++;
        if (h > best) {
          best = h;
          bx = x;
          bz = z;
        }
      }
    }
    const mean = sum / Math.max(n, 1);

    // Refine: two shrinking local sweeps around the coarse maximum.
    let step = (2 * R) / N;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = -3; i <= 3; i++) {
        for (let j = -3; j <= 3; j++) {
          const x = bx + i * step * 0.34;
          const z = bz + j * step * 0.34;
          const h = t.heightAt(x, z);
          if (h > best) {
            best = h;
            bx = x;
            bz = z;
          }
        }
      }
      step *= 0.34;
    }

    if (best - mean < 350) return;

    // Crater radius from the terrain's own shape: walk outward until the
    // surface has dropped an eighth of the summit's prominence. That is the lip
    // the column has to come out of, and reading it off the heightfield means
    // the plume fits whatever mountain the world generator actually built.
    const prom = best - mean;
    let lip = 60;
    for (let r = 40; r <= 600; r += 20) {
      let lo = Infinity;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        lo = Math.min(lo, t.heightAt(bx + Math.cos(a) * r, bz + Math.sin(a) * r));
      }
      lip = r;
      if (best - lo > prom * 0.125) break;
    }

    // Mean flank slope, in metres of radius per metre of descent. The fallout
    // sheet and the fissure veins both need it: an ash curtain or a lava vein
    // that ignores the shape of the cone it is draped on either floats off the
    // shoulder or is buried inside the rock and never drawn. Measured off the
    // heightfield rather than assumed, so it fits whatever the world generator
    // built.
    const drop = prom * 0.55;
    let footR = lip + drop;
    for (let r = lip; r <= lip + drop * 6; r += Math.max(20, drop * 0.06)) {
      // The MEAN over the ring, not the minimum. A single azimuth that happens
      // to look down a foyada drops hundreds of metres in one step, and taking
      // the minimum lets that one gully claim the whole mountain is vertical —
      // which collapses the fallout sheet's radius and buries it inside the
      // cone, where it is never rasterised and the mountain reads as inert.
      let sumH = 0;
      const K = 12;
      for (let k = 0; k < K; k++) {
        const a = (k / K) * Math.PI * 2;
        sumH += t.heightAt(bx + Math.cos(a) * r, bz + Math.sin(a) * r);
      }
      footR = r;
      if (best - sumH / K > drop) break;
    }
    const slope = Math.max(footR - lip, 1) / Math.max(drop, 1);

    // The vent sits inside the crater, not on the rim, so the base of the
    // column is occluded by the mountain from below — which is what makes the
    // silhouette read as a mountain venting rather than a smoke sprite in the
    // air above one.
    const height = THREE.MathUtils.clamp(prom * 1.25, 700, 2400);
    this.tmpA.set(bx, best - Math.min(70, prom * 0.06), bz);
    // The vent has to be wide enough to read at range: a 70 m throat under a
    // two-kilometre column is a thread, and the parcels coming out of it never
    // overlap into a mass.
    p.place(this.tmpA, Math.max(lip * 0.55, height * 0.075), height, lip, slope, drop);

    // Live fissures on the upper flanks. This is the other half of making the
    // mountain read: the ash column supplies the silhouette, the veins supply
    // the ember palette, and without them the terrain material's own crust
    // fissures have long since cross-faded out at this range and the landmark
    // arrives as an untextured beige cone.
    this.tmpB.set(bx, best, bz);
    this.fissures?.build(t, this.tmpB, lip, drop * 0.85);
  }

  /**
   * Column density and vent glow. The plume never stops — Red Mountain is
   * always erupting — but it thickens in ash weather and the vent glow lifts
   * as the sun goes down, which is when an ember-lit underside actually reads.
   */
  private tunePlume(ctx: Ctx): void {
    const p = this.plume;
    if (!p?.anchored) return;
    const w = this.weather ?? this.sky?.weather;
    const kind = w?.kind ?? 'clear';
    const blend = w?.blend ?? 1;

    // OPTICAL DEPTH, not a wash. On iter13 the column's mean over the sky above
    // the summit measured 240 against a sky of 237 — the landmark that defines
    // the province's silhouette was, to within a code value, not in the image.
    // A real eruption column is opaque: the sky behind the shaft has to darken.
    let load = 0.62;
    if (kind === 'ashstorm') load = 0.80 + 0.18 * blend;
    else if (kind === 'blight') load = 0.74;
    else if (kind === 'rain' || kind === 'thunder') load = 0.46;

    // Night doubles the vent glow: the same emitter against a dark sky is the
    // difference between a warm rim and the frame's only light source.
    const dark = 1 - THREE.MathUtils.smoothstep(this.sunDir.y, -0.10, 0.25);
    // The daylight floor is not decoration. Ember under-light on the belly of
    // the column is the one thing that says VOLCANO rather than smoke, and at
    // 0.26 it was invisible at every hour a shot is actually taken at.
    const glow = 0.62 + 1.05 * dark;

    // Veins lift after dark for the same reason, but they never go out: lava is
    // incandescent at noon too, it just loses the contest with the sky. The
    // daylight floor is what keeps #ff7a2a in the frame at all — the palette
    // allows exactly two saturated colours and a world showing neither is,
    // per the art bible, a failure of the look rather than a neutral choice.
    // Rain quenches the surface and the veins crust over.
    const wet = w?.wetness ?? 0;
    this.fissures?.set((0.78 + 1.05 * dark) * (1 - 0.45 * wet), 1);

    ctx.camera.getWorldDirection(this.tmpA);
    if (!p.inView(this.camPos, this.tmpA, 9000)) {
      p.set(0, glow, 0);
      return;
    }
    const dist = this.camPos.distanceTo(p.position);
    const proj = vfxUniforms().uVfxProj.value as number;
    const screenPx = Math.max(ctx.size.w * ctx.size.h, 1);
    p.set(load, glow, p.budgetCount(dist, proj, screenPx, 4.0 * this.tier));
  }

  /**
   * Periodic survey of what is actually around the camera, so gated layers can
   * be dropped to zero instances instead of paying a vertex invocation per
   * particle to discover there is no lava for a kilometre. 48 terrain taps
   * every 0.75 s, which is nothing next to the per-frame heightfield refill.
   */
  private survey(dt: number): void {
    this.surveyTimer -= dt;
    if (this.surveyTimer > 0) return;
    this.surveyTimer = 0.75;
    const t = this.terrain;
    if (!t?.ready) {
      this.nearLava = this.nearShore = this.nearFungal = 0;
      return;
    }
    let lava = 0;
    let shore = 0;
    let fungal = 0;
    const N = 24;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 * 3.3;
      const r = 6 + (i / N) * 90;
      const x = this.camPos.x + Math.cos(a) * r;
      const z = this.camPos.z + Math.sin(a) * r;
      const m = t.materialAt(x, z);
      if (m === Surface.Lava) lava++;
      if (m === Surface.Grass || m === Surface.Mud) fungal++;
      const h = t.heightAt(x, z);
      if (h > -2.5 && h < 2.5) shore++;
    }
    // Saturating, not proportional: one lava cell in range is enough to want a
    // full ember field over it.
    this.nearLava = Math.min(1, lava / 2);
    this.nearShore = Math.min(1, shore / 3);
    this.nearFungal = fungal / N;
  }

  /** Low quantile of the ground height around the camera — the hollows. */
  private fogLevel(): number {
    const t = this.terrain;
    if (!t?.ready) return this.camPos.y - 2;
    let lo = Infinity;
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = 20 + (i % 3) * 28;
      const h = t.heightAt(this.camPos.x + Math.cos(a) * r, this.camPos.z + Math.sin(a) * r);
      lo = Math.min(lo, h);
      sum += h;
    }
    // Between the lowest sample and the mean: fog that only ever filled the
    // absolute minimum would be invisible on gently rolling ground.
    return lo * 0.6 + (sum / 12) * 0.4;
  }

  /**
   * Place the dust-devil anchors on flat, dry, open ash within view. Anchors
   * are re-rolled every ten seconds or so, which is also how long a real dust
   * devil lasts.
   */
  private placeAnchors(dust: AmbientLayer, wind: number, kind: string): void {
    const t = this.terrain;
    const arr = dust.u('uAnchors').value as THREE.Vector4[];
    // Same threshold the instance count uses: a devil needs a wind, and the
    // clear-weather baseline of 4-6 m/s is not one.
    const strength = THREE.MathUtils.clamp((wind - 9.5) / 9, 0, 1) * (kind === 'ashstorm' ? 1.4 : 1);
    for (let i = 0; i < ANCHORS; i++) {
      const a = arr[i];
      if (!t?.ready || strength <= 0.02) {
        a.set(0, -1e5, 0, 0);
        continue;
      }
      this.anchorSeed = (this.anchorSeed * 1664525 + 1013904223) >>> 0;
      const ang = ((this.anchorSeed >>> 8) / 0xffffff) * Math.PI * 2;
      const rad = 34 + ((this.anchorSeed >>> 4) & 63);
      const x = this.camPos.x + Math.cos(ang) * rad;
      const z = this.camPos.z + Math.sin(ang) * rad;
      const h = t.heightAt(x, z);
      const n = t.normalAt(x, z, this.tmpA);
      const m = t.materialAt(x, z);
      const ok =
        h > 1.5 && n.y > 0.93 && (m === Surface.Ash || m === Surface.Sand || m === Surface.Rock);
      a.set(x, h, z, ok ? strength : 0);
    }
  }

  /** Rain impacts: splash decals and ripple rings on the ground near the player. */
  private driveWeatherEvents(ctx: Ctx): void {
    const w = this.weather ?? this.sky?.weather;
    const t = this.terrain;
    if (!w || !t?.ready || !this.decals) return;
    const raining = w.kind === 'rain' || w.kind === 'thunder';
    if (!raining) {
      this.splashAcc = 0;
      return;
    }
    // ~22 impacts/second inside 16 m. Enough to read as rain hitting the
    // ground; the pool caps how many can be live at once regardless.
    this.splashAcc += ctx.time.dt * 34 * w.blend * this.tier;
    let n = Math.floor(this.splashAcc);
    this.splashAcc -= n;
    n = Math.min(n, 6);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 14;
      const x = this.camPos.x + Math.cos(a) * r;
      const z = this.camPos.z + Math.sin(a) * r;
      const h = t.heightAt(x, z);
      this.sDecal.centre.set(x, h, z);
      t.normalAt(x, z, this.sDecal.normal);
      this.sDecal.radius = 0.20 + Math.random() * 0.22;
      this.sDecal.life = 0.55;
      // Standing water rings; dry ground throws a crown.
      this.sDecal.kind = h < 0.4 ? DECAL_RIPPLE : DECAL_SPLASH;
      this.sDecal.color.setRGB(0.62, 0.68, 0.74, THREE.LinearSRGBColorSpace);
      this.decals.add(this.sDecal, this.now);
    }
  }

  /* --------------------------------------------------------------- spawn */

  /**
   * Fire a one-shot effect.
   *
   * `effect` is `school` or `school:phase`, where phase is `charge` (an inward
   * gather that telegraphs the cast), `release` (the discharge) or `impact`.
   * Bare names are treated as a release. Unknown names fall back to a neutral
   * dust puff rather than throwing — a missing VFX must never take the frame
   * down with it.
   */
  spawn(effect: string, position: THREE.Vector3, dir?: THREE.Vector3): void {
    const add = this.addBatch;
    const alpha = this.alphaBatch;
    if (!add || !alpha) return;

    const sep = effect.indexOf(':');
    const school = (sep < 0 ? effect : effect.slice(0, sep)).toLowerCase();
    const phase = sep < 0 ? 'release' : effect.slice(sep + 1).toLowerCase();
    const d = this.tmpB.copy(dir ?? this.tmpA.set(0, 1, 0));
    if (d.lengthSq() < 1e-8) d.set(0, 1, 0);
    d.normalize();

    const e = this.sEmit;
    e.origin.copy(position);
    e.dir.copy(d);
    e.converge = 0;
    e.look = LOOK_PLAIN;
    e.soft = 0.5;
    e.turbFreq = 0.5;
    e.tile = TILE_SPARK;

    // A charge-up is the same palette played inward and quiet; a release is the
    // same palette played outward and loud. Sharing the table is what keeps the
    // two phases obviously the same spell.
    const charging = phase === 'charge';

    switch (school) {
      case 'fire':
      case 'destruction':
      case 'flame': {
        // Hue in the tint, brightness in the intensity. Baking both into the
        // colour is what blew the first pass out to white.
        e.color.setRGB(1.0, 0.34, 0.07, THREE.LinearSRGBColorSpace);
        e.life = charging ? 1.1 : 1.75;
        e.size = charging ? 0.26 : 0.78;
        e.intensity = charging ? 2.0 : 3.2;
        e.speed = charging ? 0 : 3.4;
        e.gravity = charging ? 0 : 1.1;
        e.converge = charging ? 1.3 : 0;
        e.swirl = charging ? 2.2 : 1.5;
        e.dirBias = charging ? 0.2 : 0.45;
        e.turbFreq = 0.55;
        e.look = LOOK_FIRE;
        e.tile = TILE_PUFF;
        add.emit(e, this.now);
        if (!charging) {
          // Soot: the cold half of a flame, alpha-blended over the hot half.
          e.color.setRGB(0.09, 0.075, 0.068, THREE.LinearSRGBColorSpace);
          e.size = 0.95;
          e.life = 2.3;
          e.speed = 1.9;
          e.gravity = 0.8;
          e.intensity = 1;
          e.look = LOOK_SMOKE;
          e.soft = 1.0;
          alpha.emit(e, this.now);
          this.addHaze(position, 1.2, 1.3, 0.030);
          this.stamp(position, DECAL_SCORCH, 1.5, 9, 0.10, 0.055, 0.04);
          this.flash(position, 8.0, 0xffb066, 0.34);
        } else {
          this.addHaze(position, 0.8, 1.0, 0.020);
          this.flash(position, 2.4, 0xff9a4a, 0.9);
        }
        break;
      }

      case 'frost':
      case 'ice': {
        e.color.setRGB(0.26, 0.60, 1.0, THREE.LinearSRGBColorSpace);
        e.life = charging ? 1.0 : 1.3;
        e.size = charging ? 0.16 : 0.40;
        e.intensity = charging ? 1.7 : 2.8;
        e.speed = charging ? 0 : 6.5;
        e.gravity = charging ? 0 : -1.2;
        e.converge = charging ? 1.2 : 0;
        e.swirl = 1.1;
        e.dirBias = charging ? 0.15 : 0.55;
        e.look = LOOK_CRYSTAL;
        e.tile = TILE_SHARD;
        add.emit(e, this.now);
        if (!charging) {
          // Rime dust: cold, pale, and LIT, so it separates from the glints.
          e.color.setRGB(0.72, 0.80, 0.88, THREE.LinearSRGBColorSpace);
          e.size = 0.34;
          e.life = 1.8;
          e.speed = 3.0;
          e.gravity = -2.4;
          e.intensity = 1;
          e.look = LOOK_PLAIN;
          e.tile = TILE_PUFF;
          e.soft = 0.8;
          alpha.emit(e, this.now);
          this.stamp(position, DECAL_FROST, 1.9, 12, 0.40, 0.66, 1.05);
          this.flash(position, 5.0, 0x8fd0ff, 0.30);
        } else {
          this.flash(position, 1.8, 0x8fd0ff, 0.9);
        }
        break;
      }

      case 'shock':
      case 'lightning': {
        e.color.setRGB(0.48, 0.70, 1.0, THREE.LinearSRGBColorSpace);
        e.life = charging ? 0.9 : 0.85;
        e.size = charging ? 0.13 : 0.26;
        e.intensity = charging ? 2.6 : 4.4;
        e.speed = charging ? 0 : 11;
        e.gravity = charging ? 0 : -1.0;
        e.converge = charging ? 1.0 : 0;
        e.swirl = 3.0;
        e.dirBias = charging ? 0.1 : 0.3;
        add.emit(e, this.now);
        if (!charging) {
          // Four ground-seeking arcs. Real forks, resolved in the vertex shader.
          for (let i = 0; i < 4; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = 3.5 + Math.random() * 5.5;
            this.tmpA.set(
              position.x + Math.cos(a) * r,
              position.y + (Math.random() - 0.35) * 3,
              position.z + Math.sin(a) * r,
            );
            this.beamRaw(position, this.tmpA, 'shock', 0.35 + Math.random() * 0.25);
          }
          this.flash(position, 26.0, 0xaaccff, 0.16);
        } else {
          this.flash(position, 3.0, 0x88aaff, 0.9);
        }
        break;
      }

      case 'restore':
      case 'restoration':
      case 'alteration':
      case 'heal': {
        // Golden motes converging inward — the school's whole visual identity.
        e.color.setRGB(1.0, 0.66, 0.26, THREE.LinearSRGBColorSpace);
        e.life = charging ? 1.6 : 2.2;
        e.size = 0.30;
        e.intensity = 3.0;
        e.speed = 0;
        e.gravity = 0;
        e.converge = charging ? 1.6 : 2.6;
        e.swirl = 2.4;
        e.dirBias = 0.0;
        e.tile = TILE_SPARK;
        add.emit(e, this.now);
        // A second, slower, much softer shell. The pinpoints alone read as
        // sparks; the diffuse body is what makes it read as a benediction.
        e.tile = TILE_PUFF;
        e.size = 0.85;
        e.intensity = 0.55;
        e.converge = charging ? 1.9 : 3.0;
        e.swirl = 1.1;
        e.life += 0.4;
        add.emit(e, this.now);
        this.flash(position, 3.6, 0xffd28a, 0.7);
        break;
      }

      case 'illusion':
      case 'mysticism': {
        e.color.setRGB(0.58, 0.24, 1.0, THREE.LinearSRGBColorSpace);
        e.life = 1.8;
        e.size = 0.55;
        e.intensity = 2.6;
        e.speed = charging ? 0 : 2.6;
        e.gravity = 0;
        e.converge = charging ? 1.4 : 0;
        e.swirl = 2.0;
        e.dirBias = 0.1;
        e.look = LOOK_SHIMMER;
        e.tile = TILE_PUFF;
        add.emit(e, this.now);
        // The refraction is the point: illusion bends what is behind it.
        this.addHaze(position, 1.9, 1.5, 0.026);
        this.flash(position, 3.0, 0xb07aff, 0.55);
        break;
      }

      case 'conjure':
      case 'conjuration':
      case 'summon': {
        const p = this.freePortal();
        if (p) p.open(position, d, charging ? 1.4 : 2.6, charging ? 1.6 : 4.5, this.now);
        e.color.setRGB(0.60, 0.22, 1.0, THREE.LinearSRGBColorSpace);
        e.life = charging ? 1.6 : 4.2;
        e.size = 0.26;
        e.intensity = 2.8;
        e.speed = 0;
        e.gravity = 0;
        e.converge = charging ? 1.0 : 1.9;
        e.swirl = 5.0;
        e.dirBias = 0;
        e.tile = TILE_SPARK;
        add.emit(e, this.now);
        this.flash(position, 5.0, 0xa060ff, 0.8);
        break;
      }

      case 'splash':
      case 'water': {
        e.color.setRGB(0.70, 0.78, 0.84, THREE.LinearSRGBColorSpace);
        e.life = 1.1;
        e.size = 0.16;
        e.intensity = 1;
        e.speed = 4.2;
        e.gravity = -9.0;
        e.dirBias = 0.35;
        e.tile = TILE_PUFF;
        e.soft = 0.5;
        alpha.emit(e, this.now);
        this.stamp(position, DECAL_SPLASH, 0.9, 0.7, 0.60, 0.68, 0.75);
        break;
      }

      default: {
        // Impact grit. Lit, alpha-blended, ground-coloured.
        e.color.setRGB(0.52, 0.46, 0.39, THREE.LinearSRGBColorSpace);
        e.life = 1.4;
        e.size = 0.3;
        e.intensity = 1;
        e.speed = 3.4;
        e.gravity = -5.5;
        e.dirBias = 0.25;
        e.tile = TILE_PUFF;
        e.soft = 0.8;
        alpha.emit(e, this.now);
        break;
      }
    }
  }

  /**
   * Draw a beam. `kind` selects the discharge model: `shock` (and `lightning`)
   * branch and re-strike; everything else is a steady ray.
   */
  beam(from: THREE.Vector3, to: THREE.Vector3, kind: string, seconds: number): void {
    this.beamRaw(from, to, kind.toLowerCase(), seconds);
  }

  private beamRaw(from: THREE.Vector3, to: THREE.Vector3, kind: string, seconds: number): void {
    const pool = this.beams;
    if (!pool) return;
    const b = this.sBeam;
    b.from.copy(from);
    b.to.copy(to);
    b.life = Math.max(0.05, seconds);

    switch (kind) {
      case 'shock':
      case 'lightning':
        b.color.setRGB(0.30, 0.58, 1.0, THREE.LinearSRGBColorSpace);
        b.width = 0.145;
        b.kind = BEAM_LIGHTNING;
        b.intensity = 3.4;
        b.jitter = 0.085;
        this.flash(to, 14, 0x9fc4ff, Math.min(seconds, 0.2));
        break;
      case 'fire':
      case 'flame':
        b.color.setRGB(1.0, 0.32, 0.07, THREE.LinearSRGBColorSpace);
        b.width = 0.15;
        b.kind = BEAM_RAY;
        b.intensity = 2.6;
        b.jitter = 0.035;
        this.addHaze(to, 1.4, Math.min(seconds, 1.5), 0.028);
        break;
      case 'frost':
        b.color.setRGB(0.32, 0.66, 1.0, THREE.LinearSRGBColorSpace);
        b.width = 0.11;
        b.kind = BEAM_RAY;
        b.intensity = 2.4;
        b.jitter = 0.02;
        break;
      case 'drain':
      case 'illusion':
      case 'mysticism':
        b.color.setRGB(0.52, 0.18, 1.0, THREE.LinearSRGBColorSpace);
        b.width = 0.09;
        b.kind = BEAM_RAY;
        b.intensity = 2.2;
        b.jitter = 0.05;
        break;
      default:
        b.color.setRGB(1.0, 0.68, 0.26, THREE.LinearSRGBColorSpace);
        b.width = 0.08;
        b.kind = BEAM_RAY;
        b.intensity = 2.4;
        b.jitter = 0.03;
        break;
    }
    pool.fire(b, this.now);
  }

  /* ------------------------------------------------------------- helpers */

  private addHaze(at: THREE.Vector3, radius: number, life: number, strength: number): void {
    if (!this.haze) return;
    this.sHaze.centre.copy(at);
    this.sHaze.radius = radius;
    this.sHaze.life = life;
    this.sHaze.strength = strength;
    this.haze.add(this.sHaze, this.now);
  }

  /** Project a decal onto the ground under `at`, aligned to the real surface. */
  private stamp(
    at: THREE.Vector3,
    kind: number,
    radius: number,
    life: number,
    r: number,
    g: number,
    b: number,
  ): void {
    const t = this.terrain;
    if (!this.decals) return;
    const d = this.sDecal;
    if (t?.ready) {
      const h = t.heightAt(at.x, at.z);
      // Only stamp if the effect actually happened near the ground; a fireball
      // detonating in mid-air must not scorch the floor ten metres below.
      if (at.y - h > radius * 2.5 + 1.5) return;
      d.centre.set(at.x, h, at.z);
      t.normalAt(at.x, at.z, d.normal);
    } else {
      d.centre.copy(at);
      d.normal.set(0, 1, 0);
    }
    d.radius = radius;
    d.life = life;
    d.kind = kind;
    d.color.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
    this.decals.add(d, this.now);
  }

  private freePortal(): Portal | null {
    for (const p of this.portals) if (p.free) return p;
    let oldest = this.portals[0] ?? null;
    for (const p of this.portals) if (oldest && p.expiresAt < oldest.expiresAt) oldest = p;
    return oldest;
  }

  /** Round-robin over the fixed light pool. Never adds or removes a light. */
  private flash(at: THREE.Vector3, peak: number, hex: number, life: number): void {
    if (this.flashes.length === 0) return;
    let idx = -1;
    for (let i = 0; i < this.flashes.length; i++) {
      const k = (this.flashNext + i) % this.flashes.length;
      if (this.flashStart[k] + this.flashLife[k] <= this.now) {
        idx = k;
        break;
      }
    }
    if (idx < 0) {
      idx = this.flashNext % this.flashes.length;
      for (let i = 0; i < this.flashes.length; i++) {
        if (this.flashPeak[i] < this.flashPeak[idx]) idx = i;
      }
    }
    this.flashNext = (idx + 1) % this.flashes.length;
    const l = this.flashes[idx];
    l.position.copy(at);
    l.color.setHex(hex, THREE.SRGBColorSpace);
    l.distance = Math.max(12, peak * 3.5);
    this.flashPeak[idx] = peak;
    this.flashStart[idx] = this.now;
    this.flashLife[idx] = life;
  }

  private updateFlashes(): void {
    for (let i = 0; i < this.flashes.length; i++) {
      const life = this.flashLife[i];
      if (life <= 0) continue;
      const u = (this.now - this.flashStart[i]) / life;
      if (u >= 1) {
        this.flashes[i].intensity = 0;
        this.flashLife[i] = 0;
        this.flashPeak[i] = 0;
        continue;
      }
      // Instant attack, exponential decay: what a discharge actually does.
      const env = Math.exp(-u * 4.2) * Math.min(1, u / 0.05);
      this.flashes[i].intensity = this.flashPeak[i] * env;
    }
  }

  /* ------------------------------------------------------------- teardown */

  dispose(): void {
    this.offWeather?.();
    this.offQuality?.();
    this.offWeather = null;
    this.offQuality = null;
    if (this.layers) {
      for (const k of Object.keys(this.layers) as (keyof LayerSet)[]) this.layers[k].dispose();
    }
    this.layers = null;
    this.addBatch?.dispose();
    this.alphaBatch?.dispose();
    this.decals?.dispose();
    this.beams?.dispose();
    this.haze?.dispose();
    for (const s of this.streaks) s.dispose();
    this.ashVol?.dispose();
    this.plume?.dispose();
    this.fissures?.dispose();
    for (const p of this.portals) p.dispose();
    this.portals = [];
    for (const l of this.flashes) l.dispose();
    this.flashes = [];
    this.field.dispose();
    this.atlas?.dispose();
    this.sigil?.dispose();
    this.atlas = null;
    this.sigil = null;
    this.addBatch = null;
    this.alphaBatch = null;
    this.decals = null;
    this.beams = null;
    this.haze = null;
    this.streaks = [];
    this.ashVol = null;
    this.plume = null;
    this.fissures = null;
    this.calderaSearched = false;
    this.group.removeFromParent();
    this.group.clear();
    const U = vfxUniforms();
    U.uVfxLocal.value = null;
    U.uVfxDepth.value = null;
    U.uVfxDepthValid.value = 0;
    U.uVfxLocalValid.value = 0;
  }
}

/** Re-exported so a caller can `shake` on release without importing player. */
export type { IPlayer };
