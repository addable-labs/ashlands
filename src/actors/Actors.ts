import * as THREE from 'three';
import type { IAtmosphere, IMaterials, ITerrain } from '../core/contracts';
import type { Ctx, System, TerrainQuery, WeatherState } from '../core/types';
import { makeActorMaterial, makeActorPrepassMaterial, setActorFrame } from './ActorMaterials';
import { ContactDecals } from './Contact';
import {
  applyPose,
  blendPose,
  genIdle,
  genLocomotion,
  genTurn,
  lookAt,
  makeFootStates,
  Pose,
  solveTwoBone,
  stepFoot,
  type FootState,
  type GenInput,
  type SpeciesIndex,
} from './Anim';
import { findGround, initBrain, steer, type Brain, type WorldSense } from './AI';
import { ImpostorAtlas, ImpostorBatch } from './Impostor';
import { aimBone, computeSkinning, Rig } from './Rig';
import { bestiary, ModelBuilder, type SpeciesDef } from './Species';

/**
 * ASHLANDS — creatures, NPCs, rigs and animation.
 *
 * Every actor is a real THREE.SkinnedMesh over a THREE.Bone hierarchy, with
 * skin weights derived from bone-segment distance; every pose is generated from
 * a phase, never played back from a clip; and every foot is placed by a
 * two-bone IK solve against the live heightfield with a pelvis drop when the
 * ground falls away under one leg. Those three things are the difference
 * between a world with creatures in it and a world with props sliding about.
 *
 * Budget on an M3 at 1080p: MAX_SKINNED simultaneously skinned actors. At the
 * cap the system costs roughly 1.0-1.3 ms of CPU per frame (steering, three
 * pose generators, quaternion blend, IK, bone matrices) and about 20 draw calls
 * for the skinned tier; everything beyond it is a reduced-rate body-only update
 * or a single instanced impostor draw for the entire world.
 */

export interface Actor {
  id: number;
  kind: string;
  position: THREE.Vector3;
  yaw: number;
  health: number;
  maxHealth: number;
  faction: string;
  alive: boolean;
  root: THREE.Object3D;
}

/** Hard cap on simultaneously skinned actors. Past this, reduced-bone/impostor. */
export const MAX_SKINNED = 24;

/**
 * LOD bands, in ON-SCREEN PIXELS of creature height.
 *
 * Distance bands scaled by a hand-tuned per-species constant were measuring the
 * wrong thing. What decides whether a mesh is worth drawing is how many pixels
 * it covers, and that is `size / (depth * pixelWorld)` — one expression that is
 * already correct for a 0.5 m kwama, an 8 m netch and a 20 m silt strider, at
 * any field of view and any resolution, with nothing to tune per species.
 *
 * The band that costs real money is PX_MESH: below it the creature draws as one
 * instanced billboard out of a shared batch instead of a SkinnedMesh, and a
 * SkinnedMesh costs a draw per material in the scene pass, another in the depth
 * prepass, another in every shadow cascade it falls inside, and a bone-matrix
 * texture upload per pass on top. The old bands put that switch at eight to
 * eleven pixels; the impostor is captured at 160 px per tile, so it carries a
 * twenty-pixel creature with resolution to spare and the switch belongs there.
 *
 * PX_FULL and PX_SKIN only choose the animation rate — both draw the same mesh
 * — so they are left where the old distance bands put them.
 */
const PX_FULL = 34;
const PX_SKIN = 22;
const PX_MESH = 15;
const PX_IMPOSTOR = 2.0;
/** Below this many pixels a caster cannot resolve in any cascade. */
const PX_SHADOW = 26;
/** Hard distance ceiling on the impostor tier, in metres of species scale. */
const LOD_IMPOSTOR = 900;
/**
 * Ground-contact decals fade on PROJECTED POOL SIZE, in pixels — never on
 * distance.
 *
 * Contact.ts's whole premise is that contact "cannot be something that switches
 * off with distance", and a fixed metre cut-off broke exactly that promise: a
 * kwama's pool is sub-pixel noise by 150 m while a netch's is still fourteen
 * pixels wide at 450 m, and no single distance can be right for both. Pooling
 * on the projected diameter is the same measure the LOD bands already use and
 * needs no per-species tuning. Below PX_MIN the pool cannot resolve and is
 * dropped; the ramp up to PX_FULL is what stops a distant herd reading as a
 * field of dots.
 */
const CONTACT_PX_MIN = 2.2;
const CONTACT_PX_FULL = 7;
/** Actors nearer than this get a decal per foot; further ones one under the body. */
const PER_FOOT_ACTORS = 10;

/**
 * Fraction of the meteorological visual range (3.912 / extinction — the
 * distance at which contrast falls to 2%) that an actor may be staged at.
 *
 * Staging distance has to know how far you can actually see. In an ash storm the
 * useful depth of the world is around 150 m; a silt strider placed at 290 m in
 * one is a grey smudge that no amount of shading can rescue, and the fix is to
 * bring the animal to where the air is still transparent rather than to fight
 * the atmosphere.
 */
const STAGE_VISIBILITY = 0.8;
/** Extinction assumed before the atmosphere system has published any weather. */
const CLEAR_EXTINCTION = 1e-4;

/**
 * Fraction of a species' staging band's NEAR edge an actor may cross before it
 * is pulled back out.
 *
 * The band had only ever been enforced on its far side, and the consequence is
 * the one the review opened with. A cliff racer's band starts at 40 m because
 * that is the distance at which a three-metre animal reads as an animal; nothing
 * stopped one from flying to twelve. At twelve metres, with a fourteen-metre
 * altitude ceiling above a camera that is pitched up at a mountain, its wing
 * subtends most of the upper frame, is sliced by the top edge, and covers the
 * peak — and no amount of shading fixes a creature that is simply in the wrong
 * place. Composition is a staging problem, so it is solved where staging lives.
 *
 * Ground animals are exempt: the player must be able to walk up to a guar, and
 * an actor that teleports away as you approach it is a far worse defect than a
 * badly framed one. Only actors with an authored altitude band — the fliers,
 * whose AI moves them independently of the player and whose staging band is
 * purely a composition device — are held off.
 */
const STAGE_NEAR_LEASH = 0.7;
const STAGE_NEAR_HARD = 0.45;

/**
 * Ground albedo used for the bounce irradiance fed to the creature shader, in
 * linear space. Ash, from the palette (#8a7f72 -> #4a423b): one number for the
 * whole world is right here, because the bounce is a broad, low-frequency fill
 * and the Ashlands ground is ash everywhere it is not basalt.
 */
const GROUND_ALBEDO = new THREE.Color(0.19, 0.165, 0.135);
/**
 * How much of the ground's reflected radiance a downward-facing surface on a
 * creature actually collects. An infinite Lambertian plane below a surface
 * facing straight down delivers exactly its radiance; this discounts for the
 * animal's own body occluding most of that hemisphere and for the ground being
 * neither infinite nor flat.
 */
const BOUNCE_GAIN = 0.55;

/** Minimal view of the player system; actors only ever need where it is. */
interface PlayerLike extends System {
  readonly position: THREE.Vector3;
}

/**
 * Minimal view of the water system. Nothing in the cross-system contract
 * describes water, so this is read defensively: no water, no waterline.
 */
interface WaterLike extends System {
  readonly level: number;
}

interface SpeciesAsset {
  def: SpeciesDef;
  geo: THREE.BufferGeometry;
  materials: THREE.MeshStandardMaterial[];
  ix: SpeciesIndex;
  poses: { idle: Pose; loco: Pose; turn: Pose; out: Pose };
  impostorRow: number;
  impostorSize: number;
  impostorCentreY: number;
}

interface Agent extends Actor {
  def: SpeciesDef;
  asset: SpeciesAsset;
  rig: Rig;
  mesh: THREE.SkinnedMesh;
  group: THREE.Group;
  scale: number;
  vel: THREE.Vector3;
  desired: THREE.Vector3;
  brain: Brain;
  feet: FootState[];
  /** Gait phase in cycles, advanced by distance travelled. */
  gait: number;
  /** Normalised signed turn rate, smoothed. Drives the bank/lean blend. */
  turnRate: number;
  seed: number;
  lod: number;
  /** Smoothed blend weights — this is the crossfade. */
  wIdle: number;
  wLoco: number;
  wTurn: number;
  lookDir: THREE.Vector3;
  bodyY: number;
  tiltX: number;
  tiltZ: number;
  phaseOff: number;
  /** Engine time of the last animation update, for reduced-rate tiers. */
  lastAnim: number;
  dead: number;
  /**
   * Minimum horizontal distance this actor keeps from the camera, in metres.
   * Zero for anything that is allowed to walk right up to it. See STAGE_STANDOFF.
   */
  standoff: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _qTilt = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _focus = new THREE.Vector3();
const _spawnPt = new THREE.Vector3();
const _anchor = new THREE.Vector3();
const _sphere = new THREE.Sphere();

function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

export class ActorSystem implements System {
  readonly id = 'actors';
  readonly order = 100;

  private group = new THREE.Group();
  private assets = new Map<string, SpeciesAsset>();
  private agents: Agent[] = [];
  private nextId = 1;
  private terrain: TerrainQuery | null = null;
  private atlas: ImpostorAtlas | null = null;
  private impostors: ImpostorBatch | null = null;
  private contact: ContactDecals | null = null;
  private waterY = -1e6;
  private sunView = new THREE.Vector3(0, 1, 0);
  private sunWorld = new THREE.Vector3(0, 1, 0);
  /**
   * Darkest fraction of the incident light a contact pool may leave standing —
   * a multiplier now, not a colour to blend toward. See Contact.FRAG_POOL: the
   * decal attenuates the surface rather than tinting it, so a shadow can never
   * brighten ground that is already darker than the tint was. Floored well above
   * zero because a shadowed patch of ground still sees the whole sky.
   */
  private shadowFloor = new THREE.Color(0.14, 0.13, 0.12);
  private foamTint = new THREE.Color(0xd6cdb8);
  /** Ground-bounce irradiance handed to every creature program. See setActorFrame. */
  private bounce = new THREE.Color(0, 0, 0);
  /** Prepass depth/normal/velocity variant, shared by every actor mesh. */
  private prepassMat: THREE.ShaderMaterial | null = null;
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private wind = new THREE.Vector2(1, 0);
  private windSpeed = 4;
  private offWeather: (() => void) | null = null;
  private ready = false;
  private sense: WorldSense | null = null;
  private neighbourBuf = new Float32Array(0);
  private neighbourCount = 0;
  private relocTicket = 0;
  private sorted: { a: Agent; d: number; px: number }[] = [];
  /** Atmospheric extinction per metre, read from the sky each frame. */
  private extinction = CLEAR_EXTINCTION;
  /** Scratch output of stageBand(). */
  private stageNear = 0;
  private stageFar = 0;

  /** Live counters. Exposed for the perf HUD and for reporting the budget. */
  readonly stats = { skinned: 0, reduced: 0, impostors: 0, actors: 0, bones: 0 };

  async init(ctx: Ctx): Promise<void> {
    const mats = ctx.get<IMaterials>('materials');
    const terrain = ctx.get<ITerrain>('terrain');
    if (mats === undefined || terrain === undefined) {
      console.warn('[actors] materials or terrain missing; actor system idle');
      return;
    }
    this.terrain = terrain;
    this.group.name = 'actors';
    this.prepassMat = makeActorPrepassMaterial();
    ctx.scene.add(this.group);

    const book = bestiary();
    this.atlas = new ImpostorAtlas(ctx.renderer, book.size);

    for (const def of book.values()) {
      const mb = new ModelBuilder();
      def.build(mb);
      const { geo, keys } = mb.finish();
      computeSkinning(geo, def.bones);
      // A skinned mesh deforms outside its bind bounds; without padding, three
      // culls actors whose limbs are still on screen.
      if (geo.boundingSphere !== null) geo.boundingSphere.radius *= 1.7;

      const materials = keys.map((k) => {
        const opts = def.materials[k];
        if (opts === undefined) throw new Error(`[actors] ${def.kind} uses undeclared material "${k}"`);
        return makeActorMaterial(mats, opts);
      });

      const row = this.atlas.bake(geo, materials);
      const nameIdx = (n: string): number => {
        const i = def.bones.findIndex((b) => b.name === n);
        if (i < 0) throw new Error(`[actors] ${def.kind}: unknown bone "${n}"`);
        return i;
      };
      const ix: SpeciesIndex = {
        spine: def.spine.map(nameIdx),
        whips: def.whips.map((c) => c.map(nameIdx)),
        wings: def.wings.map((c) => c.map(nameIdx)),
        head: def.head !== null ? nameIdx(def.head) : -1,
        legs: def.legs.map((l) => ({ upper: nameIdx(l.upper), lower: nameIdx(l.lower), foot: nameIdx(l.foot) })),
        boneCount: def.bones.length,
      };
      const n = def.bones.length;

      this.assets.set(def.kind, {
        def,
        geo,
        materials,
        ix,
        poses: { idle: new Pose(n), loco: new Pose(n), turn: new Pose(n), out: new Pose(n) },
        impostorRow: row.row,
        impostorSize: row.size,
        impostorCentreY: row.centreY,
      });
      // Yield between species: seven procedural meshes plus sixteen impostor
      // renders each would otherwise freeze the loading bar in one task.
      await new Promise<void>((r) => setTimeout(r, 0));
    }

    const total = [...book.values()].reduce((a, d) => a + d.population, 0);
    this.impostors = new ImpostorBatch(this.atlas, total + 8, this.sunView, book.size);
    this.group.add(this.impostors.mesh);
    this.contact = new ContactDecals();
    this.group.add(this.contact.mesh);
    this.neighbourBuf = new Float32Array((total + 8) * 4);

    this.sense = {
      terrain,
      player: null,
      wind: this.wind,
      windSpeed: this.windSpeed,
      dt: 0,
      time: 0,
      neighbours: (p, r, fn) => this.forEachNeighbour(p, r, fn),
    };

    this.offWeather = ctx.bus.on<WeatherState>('weather', (w) => {
      this.wind.copy(w.windDir);
      if (this.wind.lengthSq() > 1e-6) this.wind.normalize();
      this.windSpeed = w.windSpeed;
    });

    this.populate(ctx);
    this.ready = true;
  }

  /* ------------------------------------------------------------- spawning */

  /**
   * Resolve a species' authored staging band against the current atmosphere,
   * into `stageNear` / `stageFar`.
   *
   * Two things decide where a creature belongs in the frame: how big it is
   * (authored per species as `def.stage`, because on-screen height is
   * size/(distance*pixelWorld) and nothing else) and how far the air lets you
   * see today. Both have to be in the answer, or the same band that stages a
   * silt strider as a landmark on a clear morning stages it as a smudge in an
   * ash storm.
   */
  private stageBand(def: SpeciesDef): void {
    const visual = (STAGE_VISIBILITY * 3.912) / Math.max(1e-6, this.extinction);
    let far = Math.min(def.stage[1], visual);
    let near = Math.min(def.stage[0], far * 0.75);

    // ------------------------------------------- the near edge in thick air
    //
    // Only the far edge tracked the weather, and that is half an answer. The
    // review measured the ash-storm cliff racer at fifty percent contrast where
    // its depth allows ten, and a shader probe (applyAerial with the surface
    // term forced to zero) shows why: ground actors at 90-105 m converge to 0.90
    // of the background, exactly what the extinction says, so the fog function,
    // its coefficients and its depth source are provably the terrain's. The flier
    // does not, because it is at 58 m looking up, and there is no fog function
    // that will make 58 metres of ash look like the infinite column behind it.
    //
    // The animal is simply in the wrong part of the volume. When the AIR is what
    // limits the frame — when the authored far edge got clipped by visibility —
    // the near edge has to come with it, or a creature is staged in a clear
    // pocket in front of a wall of dust and is the only hard edge in the shot.
    // Two thirds of the visible depth puts it in the same air as everything else
    // while leaving it comfortably inside the range where it still resolves.
    if (visual < def.stage[1]) near = Math.max(near, far * 0.62);

    // Never so close that the animal is clipping the camera or standing inside
    // its own separation radius.
    near = Math.max(near, def.radius * 3 + 6);
    far = Math.max(far, near * 1.3);
    this.stageNear = near;
    this.stageFar = far;
  }

  private populate(ctx: Ctx): void {
    _anchor.copy(ctx.camera.position);
    _anchor.y = 0;
    for (const asset of this.assets.values()) {
      const def = asset.def;
      this.stageBand(def);
      let last: Agent | null = null;
      for (let i = 0; i < def.population; i++) {
        const seed = this.nextId * 7.13 + i;
        // Herd species arrive in loose clusters; solitaries scatter.
        const herd = def.kind === 'kwama' || def.kind === 'nixhound' || def.kind === 'guar';
        const cluster = herd && last !== null && hash(seed) < 0.65;
        _v.copy(cluster ? last!.position : _anchor);
        // A cluster member is placed against its neighbour; everything else is
        // placed against the camera, inside the species' staging band.
        const near = cluster ? def.radius * 2 + 3 : this.stageNear;
        const far = cluster ? def.radius * 8 + 20 : this.stageFar;
        if (!findGround(_spawnPt, _v, near, far, seed, this.terrain!, def.surfaces)) {
          const spread = far * 0.9;
          _spawnPt.set(_v.x + (hash(seed) - 0.5) * spread, 0, _v.z + (hash(seed + 1) - 0.5) * spread);
        }
        last = this.spawn(def.kind, _spawnPt.x, _spawnPt.z) as Agent;
      }
    }
    this.stats.actors = this.agents.length;
    this.stats.bones = this.agents.reduce((n, a) => n + a.rig.bones.length, 0);
  }

  spawn(kind: string, x: number, z: number): Actor {
    const asset = this.assets.get(kind);
    if (asset === undefined) throw new Error(`[actors] unknown kind "${kind}"`);
    const def = asset.def;
    const seed = this.nextId * 0.618 + 0.37;
    const scale = def.scaleRange[0] + hash(seed * 3.1) * (def.scaleRange[1] - def.scaleRange[0]);

    const rig = new Rig(def.bones);
    const group = new THREE.Group();
    group.name = `actor:${kind}`;
    group.add(rig.root);

    const mesh = new THREE.SkinnedMesh(asset.geo, asset.materials);
    // Bound while the group is still at the origin, so the bind matrix is
    // identity and the skeleton resolves in model space wherever the actor goes.
    mesh.bind(rig.skeleton);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // The G-buffer must describe the surface that was shaded, dilation and all —
    // see makeActorPrepassMaterial. Without this the outer shell of every
    // sub-pixel limb is a hole in depth, normal and velocity, and TAA resolves it
    // as background: the "soft haze" the review found the strider's legs
    // dissolving into instead of meeting the ridge.
    if (this.prepassMat !== null) mesh.userData.prepassMaterial = this.prepassMat;
    group.add(mesh);
    group.scale.setScalar(scale);

    const y = this.terrain !== null ? this.terrain.heightAt(x, z) : 0;
    group.position.set(x, y, z);
    this.group.add(group);

    const agent: Agent = {
      id: this.nextId++,
      kind,
      position: new THREE.Vector3(x, y, z),
      yaw: hash(seed * 5.7) * Math.PI * 2,
      health: def.maxHealth,
      maxHealth: def.maxHealth,
      faction: def.faction,
      alive: true,
      root: group,
      def,
      asset,
      rig,
      mesh,
      group,
      scale,
      vel: new THREE.Vector3(),
      desired: new THREE.Vector3(),
      brain: {
        behaviour: 'idle',
        timer: 0,
        goal: new THREE.Vector3(),
        home: new THREE.Vector3(),
        orbitRadius: 30,
        orbitDir: 1,
        orbitAngle: 0,
        alarm: 0,
        seed,
        path: [],
        pathIdx: 0,
        altitude: 0,
      },
      feet: makeFootStates(def.legs.length),
      gait: hash(seed * 11.3),
      turnRate: 0,
      seed,
      lod: 0,
      wIdle: 1,
      wLoco: 0,
      wTurn: 0,
      lookDir: new THREE.Vector3(),
      bodyY: y,
      tiltX: 0,
      tiltZ: 0,
      phaseOff: hash(seed * 17.1),
      lastAnim: -1,
      dead: 0,
      standoff: 0,
    };

    if (def.altitude !== undefined) {
      agent.position.y = y + def.altitude[0];
      group.position.y = agent.position.y;
      agent.bodyY = agent.position.y;
    }
    if (this.sense !== null) initBrain(agent.brain, def, agent.position, seed, this.sense);
    this.agents.push(agent);
    this.stats.actors = this.agents.length;
    return agent;
  }

  /* ------------------------------------------------------------------ API */

  all(): readonly Actor[] {
    return this.agents;
  }

  nearest(p: THREE.Vector3, maxDist: number): Actor | null {
    let best: Actor | null = null;
    let bd = maxDist * maxDist;
    for (const a of this.agents) {
      if (!a.alive) continue;
      const d = a.position.distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  damage(a: Actor, amount: number, dir: THREE.Vector3): void {
    const agent = a as Agent;
    if (agent.def === undefined || !agent.alive) return;
    agent.health = Math.max(0, agent.health - amount);
    agent.brain.alarm = 1;
    // Knockback scaled by a mass proxy: a kwama flies, a strider does not notice.
    const mass = Math.max(0.25, agent.def.radius * agent.scale);
    _v.copy(dir);
    _v.y = 0;
    if (_v.lengthSq() > 1e-6) agent.vel.addScaledVector(_v.normalize(), Math.min(6, amount / mass));
    if (agent.health <= 0) {
      agent.alive = false;
      agent.dead = 0;
      agent.vel.set(0, 0, 0);
    } else if (agent.def.faction !== 'predator') {
      agent.brain.behaviour = 'flee';
      agent.brain.timer = 4;
    }
  }

  /* --------------------------------------------------------------- update */

  update(ctx: Ctx): void {
    if (!this.ready || this.terrain === null || this.sense === null) return;
    const dt = ctx.time.dt;
    if (dt <= 0) return;

    const cam = ctx.camera;
    this.projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);

    const sky = ctx.get<IAtmosphere>('sky');
    if (sky !== undefined) {
      // Staging distance has to track the weather, not just the weather events:
      // reading it here means a shot harness that slams the weather over in one
      // frame gets correctly staged actors on the next.
      const fd = sky.weather.fogDensity;
      if (typeof fd === 'number' && fd > 0) this.extinction = fd;
      const sun = sky.sun;
      this.sunWorld.copy(sun.position).sub(sun.target.position);
      if (this.sunWorld.lengthSq() < 1e-8) this.sunWorld.set(0, 1, 0);
      this.sunWorld.normalize();
      this.sunView.copy(this.sunWorld).transformDirection(cam.matrixWorldInverse);
      this.updateBounce(sky.weather);
    }

    // Sea level, read defensively — the water system is not in the shared
    // contract, and without it there is simply no waterline.
    const water = ctx.get<WaterLike>('water');
    this.waterY = water !== undefined && typeof water.level === 'number' ? water.level : -1e6;
    // World size of one pixel per metre of depth. The limb dilation in the
    // actor shader needs it to know what "one pixel" means this frame.
    const pixelWorld = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, ctx.size.h);
    setActorFrame(pixelWorld, this.waterY, this.bounce);
    if (this.contact !== null) {
      this.contact.sunDir.copy(this.sunWorld);
      this.contact.waterY = water !== undefined ? this.waterY : -Infinity;
      this.contact.begin();
    }

    const player = ctx.get<PlayerLike>('player');
    this.sense.player = player !== undefined && player.position instanceof THREE.Vector3 ? player.position : null;
    this.sense.dt = dt;
    this.sense.time = ctx.time.elapsed;
    this.sense.windSpeed = this.windSpeed;

    this.buildNeighbours();

    // LOD assignment, largest ON SCREEN first. Capping the skinned tier is what
    // keeps a crowd from becoming a frame-time cliff, but the cap has to be
    // spent on the actors that are worth it — and that is decided by projected
    // size, not by distance. Sorted by distance, twenty-four half-metre kwama
    // foraging at fifteen metres exhausted the whole bone budget and demoted a
    // twenty-metre silt strider filling a third of the frame to the reduced-rate
    // tier. The landmark must outbid the beetles.
    this.sorted.length = 0;
    for (const a of this.agents) {
      const d = cam.position.distanceTo(a.position);
      this.sorted.push({ a, d, px: (a.asset.impostorSize * a.scale) / Math.max(1e-3, d * pixelWorld) });
    }
    this.sorted.sort((p, q) => q.px - p.px);

    let skinned = 0;
    let reduced = 0;
    let footBudget = PER_FOOT_ACTORS;
    this.stats.impostors = 0;
    this.impostors?.begin();

    for (let i = 0; i < this.sorted.length; i++) {
      // `px` is on-screen height in pixels; `impostorSize` is the framed extent
      // of the model, so it is the same number the impostor atlas was sized
      // against.
      const { a, d, px } = this.sorted[i];
      const s = a.def.lodScale * a.scale;

      _sphere.center.copy(a.position);
      _sphere.radius = a.def.radius * a.scale * 2.4;
      // Only ever an ANIMATION gate. Visibility must not depend on the main
      // camera's frustum: the same meshes are re-rendered by the shadow
      // cascade and by the water's mirrored reflection camera, and an actor
      // hidden because it left the main view is an actor missing from its own
      // reflection in the water it is standing in.
      const onScreen = this.frustum.intersectsSphere(_sphere);

      let lod: number;
      if (px >= PX_FULL && skinned < MAX_SKINNED) lod = 0;
      else if (px >= PX_SKIN && skinned < MAX_SKINNED) lod = 1;
      else if (px >= PX_MESH) lod = 2;
      else if (px >= PX_IMPOSTOR && d < LOD_IMPOSTOR * s) lod = 3;
      else lod = 4;

      // Streaming runs at EVERY tier. Gating it on lod >= 3 meant a landmark
      // species — whose whole point is that it stays skinned at range — could
      // never be restaged at all: a netch at 450 m is still lod 1, so it was
      // never even considered for recycling.
      this.recycle(a, cam.position, d, onScreen);

      a.lod = lod;
      if (lod <= 1) skinned++;
      else if (lod === 2) reduced++;

      this.simulate(a, dt, ctx);

      if (lod <= 2) {
        a.mesh.visible = true;
        // Shadow casting is the most expensive thing a skinned actor does — it
        // re-skins the whole mesh in the cascade pass. Past the near band the
        // cascade cannot resolve a limb anyway and the contact decals carry the
        // ground read, so drop the caster and keep the receiver.
        a.mesh.castShadow = px >= PX_SHADOW;
        // Off screen the actor still has to be posed — the reflection and
        // shadow cameras see it — but it can be posed lazily.
        const period = !onScreen ? 1 / 6 : lod === 0 ? 0 : lod === 1 ? 1 / 30 : 1 / 12;
        const since = ctx.time.elapsed - a.lastAnim;
        if (a.lastAnim < 0 || since >= period) {
          this.animate(a, ctx, lod, a.lastAnim < 0 ? dt : Math.min(0.2, since));
          a.lastAnim = ctx.time.elapsed;
        }
      } else if (lod === 3 && this.impostors !== null) {
        a.mesh.visible = false;
        this.impostors.push(
          a.position.x,
          a.group.position.y + a.asset.impostorCentreY * a.scale,
          a.position.z,
          a.asset.impostorSize * a.scale,
          a.yaw,
          a.asset.impostorRow,
        );
        this.stats.impostors++;
      } else {
        a.mesh.visible = false;
      }

      if (lod <= 3) {
        const perFoot = lod <= 1 && footBudget > 0;
        if (perFoot) footBudget--;
        this.contactFor(a, d, perFoot, pixelWorld);
      }
    }

    this.impostors?.end();
    this.contact?.end();
    this.stats.skinned = skinned;
    this.stats.reduced = reduced;
  }

  /**
   * Write this actor's ground contact.
   *
   * Every actor gets one, at every LOD, on land and on water alike. This is the
   * only thing in the frame that guarantees a creature is standing ON something
   * rather than in front of it — the shadow cascade gives up on a limb long
   * before the eye does.
   *
   * Two decals, because a body above the ground makes two different marks and
   * conflating them is what produced the review's "floating creature with no
   * ground shadow":
   *
   *   AO    the sky the body hides from the ground directly beneath it. This is
   *         the term that genuinely weakens and spreads with height, because the
   *         solid angle the animal subtends from that patch of ground does.
   *   CAST  the sun the body hides, which lands where the sun ray through the
   *         animal meets the ground — NOT underneath it. Its darkness is set by
   *         the sun/sky ratio and by nothing else: the sun subtends half a
   *         degree, so a three-metre netch keeps a full umbra until it is some
   *         six hundred metres up. The old code faded this by 1/(1 + 0.16h) and
   *         pinned it under the animal, which is why a netch at fifteen metres
   *         had a 16%-strength shadow in the one place a shadow could never be.
   *         The OFFSET is the whole altitude cue.
   */
  private contactFor(a: Agent, dist: number, perFoot: boolean, pixelWorld: number): void {
    const c = this.contact;
    const terrain = this.terrain;
    if (c === null || terrain === null) return;

    // The occluder's centre, not its root. A silt strider's root sits on the
    // ground while nine metres of shell sits above it, and it is the shell that
    // casts. Fliers already carry their altitude in position.y.
    const bodyY =
      a.def.altitude !== undefined ? a.position.y : a.position.y + a.def.standHeight * a.scale * 0.85;
    const ground = terrain.heightAt(a.position.x, a.position.z);
    const alt = Math.max(0, bodyY - ground);
    // Grazing light spreads the penumbra and weakens it; overhead light gives a
    // tight, dark pool. Without this a dawn shot has the same contact as noon.
    const up = Math.max(0.08, this.sunWorld.y);
    const soft = THREE.MathUtils.clamp(up, 0.25, 1);
    const r = a.def.radius * a.scale;

    // ------------------------------------------------------- the cast shadow
    //
    // March the sun ray down from the body until it is under the heightfield.
    // Two refinements are ample: the first lands on the flat-ground solution,
    // the second corrects for whatever slope it landed on.
    let sx = a.position.x;
    let sz = a.position.z;
    if (alt > 0.05) {
      // Horizontal run per metre of drop, clamped so a sun near the horizon
      // does not fling the shadow over the next ridge and out of the frame.
      const runX = THREE.MathUtils.clamp(-this.sunWorld.x / up, -6, 6);
      const runZ = THREE.MathUtils.clamp(-this.sunWorld.z / up, -6, 6);
      let drop = alt;
      for (let i = 0; i < 2; i++) {
        sx = a.position.x + runX * drop;
        sz = a.position.z + runZ * drop;
        drop = Math.max(0, bodyY - terrain.heightAt(sx, sz));
      }
    }
    // Penumbra. The sun's angular radius is 4.7 mrad, so the umbra of anything
    // creature-sized survives hundreds of metres of altitude; what actually
    // softens a high shadow is the sky's share of the light, and that is `soft`.
    const cast = r * 1.05 + alt * 0.02;
    // Fade on the pool's PROJECTED DIAMETER, never on raw distance — see
    // CONTACT_PX_MIN. This is what keeps a 15 m netch grounded at 400 m (its
    // pool is still fourteen pixels across) while a kwama's two-pixel smudge is
    // correctly dropped at a fifth of that range.
    const px = (2 * cast) / Math.max(1e-6, dist * pixelWorld);
    const range = THREE.MathUtils.clamp((px - CONTACT_PX_MIN) / (CONTACT_PX_FULL - CONTACT_PX_MIN), 0, 1);
    if (range <= 0.01) return;
    c.push(terrain, sx, sz, cast, 0.62 * soft * range, this.shadowFloor, false);

    // ---------------------------------------------------------- ambient occlusion
    //
    // Only while the body is still close enough to the ground to hide a
    // meaningful part of its sky. Past that the term is physically gone and
    // paying a decal for it would be paying for nothing.
    if (alt < r * 2.5) {
      const spread = 1 + alt * 0.25;
      const fade = 1 / (1 + (alt / Math.max(0.3, r)) * 1.6);
      c.push(terrain, a.position.x, a.position.z, r * 1.15 * spread, 0.34 * fade * range, this.shadowFloor, false);
    }

    if (!perFoot || a.def.legs.length === 0) return;
    for (let i = 0; i < a.def.legs.length; i++) {
      const st = a.feet[i];
      if (!st.init) continue;
      const fx = st.target.x;
      const fz = st.target.z;
      const gy = terrain.heightAt(fx, fz);
      // Lift the foot off the ground and the contact must let go with it — a
      // shadow that stays pinned under a swinging leg is worse than none.
      const clearance = Math.max(0, st.target.y - a.def.legs[i].lift * a.scale - gy);
      const lift = THREE.MathUtils.clamp(1 - clearance / Math.max(0.05, a.def.step * a.scale), 0, 1);
      if (lift <= 0.02) continue;
      const fr = Math.max(0.1, r * 0.34) * (1 + clearance * 1.5);
      c.push(terrain, fx, fz, fr, 0.7 * lift * soft * range, this.shadowFloor, false);

      // Below the waterline the leg pierces a surface, and a surface that is
      // pierced makes a meniscus. Without it the creature reads as standing on
      // a photograph of water.
      if (gy < c.waterY && c.waterY > -1e5) {
        const ripple = 1 + 0.35 * Math.sin(a.seed * 7.1 + i * 1.7);
        c.push(terrain, fx, fz, fr * 2.4 * ripple, 0.5 * lift * range, this.foamTint, true);
      }
    }
  }

  /**
   * Irradiance reaching a downward-facing surface on a creature from the ground.
   *
   * `scene.environment` is prefiltered from the sky dome alone — see
   * Atmosphere.captureEnv, "sky dome only" — so its entire lower hemisphere is
   * empty. Terrain never notices, because terrain faces up. A creature is the
   * one class of object in the frame with large downward-facing surfaces, and
   * with nothing below the horizon every one of them resolves to black: the
   * netch underside the review called an opaque tarp, the guar on the coast
   * hillside it could not read at all, and all six of the hero strider's legs.
   *
   * So it is reconstructed here from quantities the sky already publishes, in
   * the same linear space: irradiance landing on horizontal ground, times the
   * ground's albedo, times how much of that hemisphere a belly actually sees.
   * The result is a single colour shared by every creature program — this is a
   * broad, low-frequency fill, and paying per-actor for it would buy nothing.
   */
  private updateBounce(w: WeatherState): void {
    const up = Math.max(0, this.sunWorld.y);
    const s = w.sunColor;
    const a = w.ambient;
    // Direct sun on flat ground plus the sky's own hemispheric irradiance.
    const er = s.r * up + a.r;
    const eg = s.g * up + a.g;
    const eb = s.b * up + a.b;
    this.bounce.setRGB(
      er * GROUND_ALBEDO.r * BOUNCE_GAIN,
      eg * GROUND_ALBEDO.g * BOUNCE_GAIN,
      eb * GROUND_ALBEDO.b * BOUNCE_GAIN,
      THREE.LinearSRGBColorSpace,
    );
  }

  /* ------------------------------------------------------------ mechanics */

  private buildNeighbours(): void {
    const b = this.neighbourBuf;
    let n = 0;
    for (const a of this.agents) {
      if (n * 4 + 3 >= b.length) break;
      b[n * 4] = a.position.x;
      b[n * 4 + 1] = a.position.y;
      b[n * 4 + 2] = a.position.z;
      b[n * 4 + 3] = a.def.radius * a.scale;
      n++;
    }
    this.neighbourCount = n;
  }

  private forEachNeighbour(
    p: THREE.Vector3,
    r: number,
    fn: (x: number, y: number, z: number, radius: number) => void,
  ): void {
    const b = this.neighbourBuf;
    const r2 = r * r * 4;
    for (let i = 0; i < this.neighbourCount; i++) {
      const x = b[i * 4];
      const z = b[i * 4 + 2];
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz > r2 || (dx === 0 && dz === 0)) continue;
      fn(x, b[i * 4 + 1], z, b[i * 4 + 3]);
    }
  }

  /** Steering and integration. Runs at every LOD, including impostors. */
  private simulate(a: Agent, dt: number, ctx: Ctx): void {
    const def = a.def;
    const terrain = this.terrain!;

    if (!a.alive) {
      a.dead += dt;
      a.vel.multiplyScalar(Math.max(0, 1 - dt * 3));
      a.group.position.y -= dt * 0.35 * a.scale;
      if (a.dead > 12) {
        a.alive = true;
        a.health = a.maxHealth;
        a.dead = 0;
        this.relocate(a, ctx.camera.position);
      }
      return;
    }

    _fwd.set(Math.sin(a.yaw), 0, Math.cos(a.yaw));
    steer(a.desired, a.brain, def, a.position, _fwd, this.sense!);

    // ------------------------------------------------------------ standoff
    //
    // A cliff racer is a predator, so AI.steer puts it in 'approach' inside 48 m
    // and 'dive' stoops it straight at the player — which in a screenshot, where
    // the player IS the camera, means it flies into the lens and parks there.
    // That is the whole of the review's first defect: a wing at a dozen metres,
    // at fourteen metres of altitude, therefore at forty degrees of elevation,
    // sliced by the top frame edge and covering the peak. No shading fixes it.
    //
    // The animal keeps its distance instead. This is a steering term, never a
    // teleport: it adds an outward component that ramps in over the last of the
    // standoff radius, so a stoop still reads as a stoop and then pulls up and
    // past. Ground actors have a zero standoff and are untouched — walking up to
    // a guar has to keep working.
    if (a.standoff > 0) {
      _v2.subVectors(a.position, ctx.camera.position);
      _v2.y = 0;
      const hd = _v2.length();
      if (hd > 1e-3 && hd < a.standoff) {
        const push = 1 - hd / a.standoff;
        _v2.multiplyScalar((def.runSpeed * push) / hd);
        a.desired.x += _v2.x;
        a.desired.z += _v2.z;
        // Clamped back to the species' own top speed: the standoff decides where
        // an animal goes, never how fast it can fly.
        const sp = Math.hypot(a.desired.x, a.desired.z);
        if (sp > def.runSpeed) {
          a.desired.x *= def.runSpeed / sp;
          a.desired.z *= def.runSpeed / sp;
        }
      }
    }

    // Acceleration limit: mass reads through the ramp, not through the mesh.
    const accel = (def.runSpeed * (def.locomotion === 'ground' ? 2.6 : 1.1)) / Math.max(1, def.radius * 0.35);
    a.vel.lerp(a.desired, Math.min(1, dt * accel));
    a.position.addScaledVector(a.vel, dt);

    const e = terrain.extent - 30;
    a.position.x = THREE.MathUtils.clamp(a.position.x, -e, e);
    a.position.z = THREE.MathUtils.clamp(a.position.z, -e, e);

    // Yaw follows velocity under a species turn limit. A silt strider that can
    // spin like a kwama destroys its own sense of scale.
    const horiz = Math.hypot(a.vel.x, a.vel.z);
    const maxTurn = THREE.MathUtils.clamp(3.4 / Math.max(0.4, def.radius * 0.7), 0.22, 3.2);
    if (horiz > 0.05) {
      const want = Math.atan2(a.vel.x, a.vel.z);
      let diff = want - a.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const rate = THREE.MathUtils.clamp(diff * 4, -maxTurn, maxTurn);
      a.yaw += rate * dt;
      a.turnRate += (rate / maxTurn - a.turnRate) * Math.min(1, dt * 5);
    } else {
      a.turnRate += (0 - a.turnRate) * Math.min(1, dt * 3);
    }

    // Gait phase advances with DISTANCE, never with time. That is the whole
    // reason a stance foot can be pinned in world space and never skate.
    a.gait += (horiz * dt) / Math.max(0.01, def.stride * a.scale);

    a.group.position.x = a.position.x;
    a.group.position.z = a.position.z;
    if (def.locomotion !== 'ground') {
      a.group.position.y = a.position.y;
    } else if (a.lod >= 3) {
      // Height for a walker normally comes out of the pelvis solve in animate(),
      // which the impostor tier never runs. Without this the billboard keeps
      // whatever height it had when it was last skinned and slides up out of the
      // hillside — or down into it — as it wanders across the terrain.
      const h = terrain.heightAt(a.position.x, a.position.z);
      a.position.y = h;
      a.bodyY = h;
      a.group.position.y = h;
    }
  }

  /** Pose generation, blending, IK and look-at. */
  private animate(a: Agent, ctx: Ctx, lod: number, dt: number): void {
    const def = a.def;
    const rig = a.rig;
    const ix = a.asset.ix;
    const p = a.asset.poses;
    const terrain = this.terrain!;

    const speed = Math.hypot(a.vel.x, a.vel.z);
    const gi: GenInput = {
      t: ctx.time.elapsed + a.phaseOff * 20,
      phase: a.gait,
      speed,
      turn: a.turnRate,
      alarm: a.brain.alarm,
      seed: a.seed,
    };

    // Crossfade weights, smoothed in time. Both generators are continuous
    // functions of the same phase, so the blend can never pop — a real blend
    // tree, not a state machine with hard cuts.
    const moving = THREE.MathUtils.clamp(speed / Math.max(def.walkSpeed * 0.5, 0.05), 0, 1);
    const rate = Math.min(1, dt * 5);
    a.wLoco += (moving - a.wLoco) * rate;
    a.wIdle += (1 - moving - a.wIdle) * rate;
    a.wTurn += (Math.min(1, Math.abs(a.turnRate) * 1.4) - a.wTurn) * rate;

    genIdle(ix, def, gi, p.idle);
    genLocomotion(ix, def, gi, p.loco);
    genTurn(ix, def, gi, p.turn);

    let acc = blendPose(p.out, p.idle, a.wIdle, 0);
    acc = blendPose(p.out, p.loco, a.wLoco, acc);
    blendPose(p.out, p.turn, a.wTurn * 0.85, acc);
    applyPose(rig, p.out);

    // ------------------------------------------------------ root transform
    _qYaw.setFromAxisAngle(UP, a.yaw);

    if (def.locomotion === 'ground') {
      const n = def.legs.length;
      let sum = 0;
      let min = Infinity;
      let sx = 0;
      let sz = 0;
      let sxh = 0;
      let sx2 = 1e-3;
      let szh = 0;
      let sz2 = 1e-3;
      for (let i = 0; i < n; i++) {
        const l = def.legs[i];
        _v.set(l.rest[0] * a.scale, 0, l.rest[2] * a.scale).applyQuaternion(_qYaw);
        const h = terrain.heightAt(a.position.x + _v.x, a.position.z + _v.z);
        sum += h;
        if (h < min) min = h;
        const lx = l.rest[0] * a.scale;
        const lz = l.rest[2] * a.scale;
        sx += lx;
        sz += lz;
        sxh += lx * h;
        sx2 += lx * lx;
        szh += lz * h;
        sz2 += lz * lz;
      }
      const mean = n > 0 ? sum / n : terrain.heightAt(a.position.x, a.position.z);
      if (n === 0) min = mean;

      // Pelvis drop. When one foot is much lower than the others the body must
      // come down or that leg simply cannot reach — the clearest single tell
      // between a rig standing on the ground and one hovering above it.
      const targetY = mean + (min - mean) * 0.45;
      a.bodyY += (targetY - a.bodyY) * Math.min(1, dt * 10);
      a.group.position.y = a.bodyY;
      a.position.y = a.bodyY;

      if (n > 1) {
        // Least-squares slope of the ground plane through the foot contacts,
        // centred so an asymmetric leg layout does not bias the fit.
        const slopeX = THREE.MathUtils.clamp((sxh - mean * sx) / sx2, -1.2, 1.2);
        const slopeZ = THREE.MathUtils.clamp((szh - mean * sz) / sz2, -1.2, 1.2);
        a.tiltZ += (Math.atan(slopeX) * 0.7 - a.tiltZ) * Math.min(1, dt * 6);
        a.tiltX += (-Math.atan(slopeZ) * 0.7 - a.tiltX) * Math.min(1, dt * 6);
      }
    } else {
      // Fliers bank into the turn and pitch with their climb rate.
      const bank = THREE.MathUtils.clamp(-a.turnRate * (def.locomotion === 'fly' ? 0.9 : 0.25), -1.1, 1.1);
      const pitch = THREE.MathUtils.clamp(-a.vel.y * 0.08, -0.5, 0.5);
      a.tiltZ += (bank - a.tiltZ) * Math.min(1, dt * 4);
      a.tiltX += (pitch - a.tiltX) * Math.min(1, dt * 4);
      a.group.position.copy(a.position);
    }

    _e.set(a.tiltX, 0, a.tiltZ, 'XYZ');
    _qTilt.setFromEuler(_e);
    a.group.quaternion.copy(_qYaw).multiply(_qTilt);
    a.group.updateMatrixWorld(true);

    // ------------------------------------------------------------- leg IK
    // Runs at the reduced tier too. Holding the last solve was the wrong call:
    // an actor that has NEVER been closer than the reduced band has no last
    // solve at all, so its legs sit in bind pose — splayed at fixed offsets that
    // punch straight through any slope. That is the single reason midground
    // creatures read as decals stuck on a hillside rather than standing on it.
    if (lod <= 2 && def.legs.length > 0) {
      for (let i = 0; i < def.legs.length; i++) {
        const leg = def.legs[i];
        const st = a.feet[i];
        stepFoot(st, leg, def, a.gait + leg.phase, a.position, _qYaw, a.vel, a.scale, terrain, dt);

        _pole.set(leg.pole[0], leg.pole[1], leg.pole[2]).applyQuaternion(a.group.quaternion).normalize();
        const li = ix.legs[i];
        solveTwoBone(rig, li.upper, li.lower, st.target, _pole, a.scale);

        // Point the toe at the ground contact, so an insect leg ends on a tip
        // and a guar foot lies flat, without paying for a third IK segment.
        const foot = rig.bones[li.foot];
        const parent = foot.parent;
        if (parent !== null) {
          foot.matrixWorld.decompose(_v, _q, _v2);
          _v2.copy(st.target);
          _v2.y -= leg.lift * a.scale * 1.8;
          _v2.sub(_v);
          if (_v2.lengthSq() > 1e-6) {
            parent.getWorldQuaternion(_q);
            aimBone(rig, li.foot, _v2, _q);
            foot.updateMatrixWorld(true);
          }
        }
      }
    }

    // ---------------------------------------------------------- look-at IK
    const playerPos = this.sense!.player;
    if (lod === 0 && ix.head >= 0 && playerPos !== null) {
      const d = playerPos.distanceTo(a.position);
      if (d < 45) {
        _focus.copy(playerPos);
        _fwd.set(Math.sin(a.yaw), 0, Math.cos(a.yaw));
        const w = THREE.MathUtils.clamp(1 - d / 45, 0, 1) * (0.3 + 0.6 * a.brain.alarm);
        lookAt(rig, ix.head, _focus, _fwd, a.lookDir, Math.cos(1.05), w, dt);
      }
    }
  }

  /**
   * Ambient population streaming.
   *
   * The keep radius used to be the RENDERING ceiling (LOD_IMPOSTOR * lodScale),
   * which for a netch worked out at 2.6 km — so an animal that started 450 m
   * away simply stayed there for the whole session, and what ended up in frame
   * was whatever happened to be lying around rather than anything staged. The
   * radius that matters is the composition one: an actor outside its species'
   * staging band is, by construction, at a distance where it cannot read.
   *
   * Out-of-band actors are first LEASHED — their wander goal and home are pulled
   * back toward the camera so they walk or drift home on their own, which costs
   * nothing and never pops. Only an actor that is grossly out of band is
   * teleported, and then preferentially while it is off screen.
   */
  private recycle(a: Agent, camPos: THREE.Vector3, dist: number, visible: boolean): void {
    this.stageBand(a.def);
    const far = this.stageFar;
    const near = this.stageNear;
    // Published to simulate(), which turns it into a steering term. Fliers only.
    a.standoff = a.def.altitude !== undefined ? near * STAGE_NEAR_LEASH : 0;

    // ------------------------------------------------------- the near side
    //
    // The band has two edges and only one of them was ever enforced. See
    // STAGE_NEAR_LEASH: a flier inside its own near edge is the defect the
    // review opened with — a wing filling the top of the frame, cut by the edge,
    // over the mountain it was supposed to be flying past. Fliers only; walking
    // up to a guar has to keep working.
    if (a.def.altitude !== undefined && dist < near * STAGE_NEAR_LEASH) {
      // Same leash geometry as below, aimed outward instead of inward: a point
      // in the middle of the band along the line the actor came in on.
      _v.subVectors(a.position, camPos);
      _v.y = 0;
      if (_v.lengthSq() < 1e-6) _v.set(Math.cos(a.seed * 6.28), 0, Math.sin(a.seed * 6.28));
      _v.normalize().multiplyScalar((near + far) * 0.5).add(camPos);
      a.brain.home.set(_v.x, this.terrain!.heightAt(_v.x, _v.z), _v.z);
      if (a.brain.behaviour !== 'flee' && a.brain.behaviour !== 'approach') a.brain.goal.copy(a.brain.home);
      // Inside the hard margin it is already too big to frame, and a flier that
      // is leashed but still closing will hang there for several seconds. Off
      // screen this is free; on screen it is still the lesser defect, because the
      // alternative is a creature sliced by the frame edge.
      // Never a teleport while it is on screen. A flier that has closed this far
      // is already framed; popping it out is a worse artifact than the framing,
      // and the standoff in simulate() is what actually clears it — by flying
      // away, which is what the animal would do.
      if (!visible && dist < near * STAGE_NEAR_HARD) this.relocate(a, camPos);
      return;
    }

    if (dist <= far * 1.1) return;

    // Leash: a point back inside the band, along the line the actor drifted out
    // on, so it comes home the way it left instead of cutting across the world.
    _v.subVectors(a.position, camPos);
    _v.y = 0;
    const l = Math.max(1e-3, _v.length());
    _v.multiplyScalar(((this.stageNear + far) * 0.5) / l).add(camPos);
    a.brain.home.set(_v.x, this.terrain!.heightAt(_v.x, _v.z), _v.z);
    if (a.brain.behaviour !== 'flee' && a.brain.behaviour !== 'approach') a.brain.goal.copy(a.brain.home);

    // Hard relocation. Off screen it is free; on screen it is still the right
    // call past this margin, because an actor at more than twice its staging
    // distance is smaller than the band was ever designed to make legible and
    // leaving it there is precisely what produced the placeholder blob.
    if (dist > far * (visible ? 2.2 : 1.4)) this.relocate(a, camPos);
  }

  private relocate(a: Agent, camPos: THREE.Vector3): void {
    const def = a.def;
    this.stageBand(def);
    const near = this.stageNear;
    const far = this.stageFar;
    _anchor.copy(camPos);
    _anchor.y = 0;
    // The search is deterministic in its seed, so the seed has to move on every
    // attempt: a fixed seed that happens to find no valid ground would fail
    // identically on every subsequent frame and strand the actor for good.
    const seed = a.seed + camPos.x * 0.011 + camPos.z * 0.017 + this.relocTicket++ * 0.731;
    if (!findGround(_spawnPt, _anchor, near, far, seed, this.terrain!, def.surfaces)) return;

    a.position.copy(_spawnPt);
    if (def.altitude !== undefined) a.position.y = _spawnPt.y + def.altitude[0] + hash(a.seed * 3.3) * 8;
    a.group.position.copy(a.position);
    a.vel.set(0, 0, 0);
    a.bodyY = a.position.y;
    a.lastAnim = -1;
    for (const f of a.feet) f.init = false;
    if (this.sense !== null) initBrain(a.brain, def, a.position, a.seed, this.sense);
  }

  dispose(): void {
    this.offWeather?.();
    this.offWeather = null;
    for (const a of this.agents) {
      a.group.removeFromParent();
      a.rig.skeleton.dispose();
    }
    this.agents.length = 0;
    for (const asset of this.assets.values()) {
      asset.geo.dispose();
      for (const m of asset.materials) m.dispose();
    }
    this.assets.clear();
    this.impostors?.dispose();
    this.impostors = null;
    this.contact?.dispose();
    this.contact = null;
    this.atlas?.dispose();
    this.atlas = null;
    this.group.removeFromParent();
    this.group.clear();
    this.ready = false;
  }
}
