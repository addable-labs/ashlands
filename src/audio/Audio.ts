import type { IAtmosphere, IPlayer, ITerrain } from '../core/contracts';
import { Surface, type Ctx, type System, type WeatherState } from '../core/types';
import { Ambience, type AmbienceEnv } from './Ambience';
import type { SpaceName } from './Buffers';
import { Combat, type Target, type Weapon } from './Combat';
import { Creatures, type Call, type CreatureKind } from './Creatures';
import { Footsteps } from './Footsteps';
import { AudioGraph, type BusName } from './Graph';
import { Magic, phaseOf, schoolOf, type Phase, type School } from './Magic';
import { Music, type Mood, type MusicState } from './Music';
import { clamp01, smoothstep, type Vec3 } from './dsp';

/**
 * ASHLANDS — audio.
 *
 * Everything is synthesised at runtime: oscillators, procedurally generated
 * noise beds, biquads, and convolution against impulse responses built sample
 * by sample at unlock. There are no audio assets, so nothing loads, nothing
 * pops in, and every parameter of every sound is available to game state.
 *
 * The graph is built on the first user gesture because browsers will not start
 * an AudioContext without one; until then every entry point is a no-op rather
 * than a throw, which is what keeps the screenshot harness (headless, no
 * gesture, muted) from ever seeing this system at all.
 */

/** Vec3 is readonly by contract; the per-frame listener scratch owns its own. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Mirrors world/Heightfield's RM_*; subsystems must not import each other. */
const RED_MOUNTAIN = { x: -180, z: -1120, radius: 1290 } as const;

/** Ring radii used to estimate how close the shoreline is, in metres. */
const COAST_RINGS = [40, 110, 260, 520] as const;

interface StepEvent {
  surface: number;
  foot: number;
  speed: number;
  submersion: number;
}
interface LandEvent {
  impact: number;
  surface: number;
}
interface MuffleEvent {
  amount: number;
  source?: string;
}
interface SwingEvent {
  weapon?: Weapon;
  speed?: number;
  position?: Vec3;
  dir?: Vec3;
}
interface HitEvent {
  weapon?: Weapon;
  target?: Target;
  force?: number;
  position?: Vec3;
}
interface BowEvent {
  phase?: 'draw' | 'release' | 'flight' | 'hit';
  position?: Vec3;
  dir?: Vec3;
}
interface SpellEvent {
  effect?: string;
  school?: School;
  phase?: Phase;
  position?: Vec3;
  power?: number;
}
interface VfxEvent {
  effect: string;
  position: Vec3;
  dir?: Vec3;
}
interface CreatureEvent {
  kind?: string;
  call?: Call;
  position?: Vec3;
  dir?: Vec3;
}
interface SpaceEvent {
  space?: SpaceName;
  seconds?: number;
  /** 0..1 enclosure, for the ambience bed. Defaults from the space. */
  enclosure?: number;
}
interface VolumeEvent {
  bus?: BusName | 'master';
  value?: number;
}
interface SaveEvent {
  data: Record<string, unknown>;
}

export interface AudioSave {
  master: number;
  buses: Record<BusName, number>;
  muted: boolean;
  space: SpaceName;
  music: MusicState;
}

/** How enclosed each space is, for the ambience bed's wind/hollow balance. */
const ENCLOSURE: Record<SpaceName, number> = {
  outdoor: 0,
  cave: 1,
  interior: 0.85,
  underwater: 0.6,
};

const CREATURE_KINDS: Record<string, CreatureKind> = {
  ashshrike: 'ashshrike',
  skerrin: 'skerrin',
  drell: 'drell',
  morvek: 'morvek',
  vekling: 'vekling',
  glassjaw: 'glassjaw',
  fenwalker: 'fenwalker',
};

export class AudioSystem implements System {
  readonly id = 'audio';
  readonly order = 150;

  private graph = new AudioGraph();
  private music = new Music(this.graph);
  private creatures = new Creatures(this.graph);
  private ambience = new Ambience(this.graph, this.creatures);
  private steps = new Footsteps(this.graph);
  private combat = new Combat(this.graph);
  private magic = new Magic(this.graph);

  private offs: (() => void)[] = [];
  private gesture: (() => void) | null = null;
  private visibility: (() => void) | null = null;
  private booted = false;

  private lastSurface: number = Surface.Ash;
  private submerged = 0;
  private muffleTarget = 0;
  private space: SpaceName = 'outdoor';
  /** Where to return to when the player surfaces — water is a temporary space. */
  private spaceBeforeWater: SpaceName = 'outdoor';
  private enclosure = 0;

  private combatActive = false;
  private dialogueActive = false;
  private duckAmount = 0;
  private duckHold = 0;
  private night = false;
  private pendingSave: AudioSave | null = null;

  private env: AmbienceEnv = {
    kind: 'clear',
    from: 'clear',
    blend: 1,
    windSpeed: 4,
    wetness: 0,
    hour: 12,
    volcanism: 0,
    altitude: 0,
    coast: 0,
    vegetation: 0,
    submerged: 0,
    enclosure: 0,
    listener: { x: 0, y: 0, z: 0 },
  };
  private weatherFrom: WeatherState['kind'] = 'clear';
  private weatherKind: WeatherState['kind'] = 'clear';

  // Scratch listener vectors. setListener and env.listener are read
  // synchronously and never retained, so these are reused every frame rather
  // than allocating four objects per frame for the life of the process.
  private readonly lPos: Mutable<Vec3> = { x: 0, y: 0, z: 0 };
  private readonly lFwd: Mutable<Vec3> = { x: 0, y: 0, z: -1 };
  private readonly lUp: Mutable<Vec3> = { x: 0, y: 1, z: 0 };

  init(ctx: Ctx): void {
    // Autoplay policy: the context is not created until the player touches
    // something. Every gesture type, because pointer lock eats clicks.
    const unlock = () => this.unlock();
    this.gesture = unlock;
    for (const evt of ['pointerdown', 'keydown', 'touchstart', 'mousedown'] as const) {
      addEventListener(evt, unlock, { passive: true });
    }

    // A backgrounded tab should not keep an ash storm running.
    this.visibility = () => {
      if (document.hidden) this.graph.suspend();
      else this.graph.resume();
    };
    document.addEventListener('visibilitychange', this.visibility);

    const on = ctx.bus.on.bind(ctx.bus);
    this.offs.push(
      on<WeatherState>('weather', (w) => {
        if (w.kind !== this.weatherKind) {
          this.weatherFrom = this.weatherKind;
          this.weatherKind = w.kind;
        }
      }),
      on<{ surface: number }>('player:surface', (p) => {
        this.lastSurface = p.surface;
      }),
      on<StepEvent>('player:step', (p) => {
        this.steps.step(p.surface ?? this.lastSurface, p.foot ?? 1, p.speed ?? 3, p.submersion ?? 0, null);
      }),
      on<LandEvent>('player:land', (p) => {
        this.steps.land(p.impact ?? 0, p.surface ?? this.lastSurface, null);
      }),
      on<MuffleEvent>('audio:muffle', (p) => {
        this.muffleTarget = clamp01(p?.amount ?? 0);
      }),
      on<{ submerged: boolean }>('water:submerged', (p) => {
        // Water publishes the boolean; the muffle event carries the amount.
        if (p?.submerged) {
          if (this.space !== 'underwater') this.spaceBeforeWater = this.space;
          this.setSpace('underwater', 0.7);
        } else if (this.space === 'underwater') {
          this.setSpace(this.spaceBeforeWater, 0.7);
        }
      }),
      on<SpaceEvent>('audio:space', (p) => {
        if (p?.space) this.setSpace(p.space, p.seconds ?? 1.4, p.enclosure);
      }),
      on<VolumeEvent>('audio:volume', (p) => {
        if (!p?.bus || p.value === undefined) return;
        if (p.bus === 'master') this.graph.setMasterVolume(p.value);
        else this.graph.setVolume(p.bus, p.value);
      }),
      on<{ muted?: boolean }>('audio:mute', (p) => this.graph.setMuted(p?.muted ?? !this.graph.muted)),
      on<SwingEvent>('combat:swing', (p) => {
        this.combat.swing(p?.weapon ?? 'blade', p?.speed ?? 1, p?.position ?? null, p?.dir ?? null);
      }),
      on<HitEvent>('combat:impact', (p) => {
        this.combat.impact(p?.weapon ?? 'blade', p?.target ?? 'flesh', p?.force ?? 1, p?.position ?? null);
        this.duck(0.3, 0.15);
      }),
      on<BowEvent>('combat:bow', (p) => {
        const phase = p?.phase ?? 'release';
        if (phase === 'draw') this.combat.bowDraw(p?.position ?? null);
        else if (phase === 'release') this.combat.bowRelease(p?.position ?? null, p?.dir ?? null);
        else if (phase === 'flight') this.combat.arrowFlight(p?.position ?? null, p?.dir ?? null);
        else this.combat.impact('arrow', 'flesh', 1, p?.position ?? null);
      }),
      on<{ active?: boolean }>('combat:begin', () => this.setCombat(true)),
      on<{ active?: boolean }>('combat:end', () => this.setCombat(false)),
      on<{ active?: boolean }>('dialogue:begin', () => (this.dialogueActive = true)),
      on<{ active?: boolean }>('dialogue:end', () => (this.dialogueActive = false)),
      on<SpellEvent>('spell:cast', (p) => {
        const school = p?.school ?? (p?.effect ? schoolOf(p.effect) : null);
        if (school) this.magic.cast(school, p?.phase ?? 'release', p?.position ?? null, p?.power ?? 1);
      }),
      // The VFX system already broadcasts every spell it draws; hearing what
      // you can see costs the gameplay layer nothing to wire up.
      on<VfxEvent>('vfx:spawn', (p) => {
        if (!p?.effect) return;
        const school = schoolOf(p.effect);
        if (!school) return;
        const phase = phaseOf(p.effect);
        if (phase === 'impact') this.magic.hit(school, p.position ?? null, 1);
        else this.magic.cast(school, phase, p.position ?? null, 1);
      }),
      on<CreatureEvent>('actor:call', (p) => {
        const kind = CREATURE_KINDS[(p?.kind ?? '').toLowerCase()];
        if (kind) this.creatures.call(kind, p?.call ?? 'idle', p?.position ?? null, p?.dir ?? null);
        else this.creatures.grunt(p?.position ?? null, 0.4);
      }),
      on<CreatureEvent>('actor:hurt', (p) => {
        const kind = CREATURE_KINDS[(p?.kind ?? '').toLowerCase()];
        if (kind) this.creatures.call(kind, 'hurt', p?.position ?? null);
        else this.creatures.grunt(p?.position ?? null, 0.75);
      }),
      on<CreatureEvent>('actor:died', (p) => {
        const kind = CREATURE_KINDS[(p?.kind ?? '').toLowerCase()];
        if (kind) this.creatures.call(kind, 'die', p?.position ?? null);
        else this.creatures.grunt(p?.position ?? null, 0.9);
      }),
      on<{ mood?: Mood; urgent?: boolean }>('music:mood', (p) => {
        if (p?.mood) this.music.request(p.mood, p.urgent ?? false);
      }),
      on<{ kind?: 'levelup' | 'quest' | 'death' }>('music:sting', (p) => this.music.sting(p?.kind ?? 'quest')),
      on<unknown>('discovery', () => this.music.discovery()),
      on<{ kind?: string }>('notify', (p) => {
        if (p?.kind === 'quest') this.music.discovery();
      }),
      on<SaveEvent>('save:collect', (p) => {
        if (p?.data) p.data.audio = this.serialize();
      }),
      on<SaveEvent>('save:apply', (p) => {
        if (p?.data) this.deserialize(p.data.audio);
      }),
    );
  }

  /** Idempotent; safe from any handler. Builds the graph and starts the beds. */
  unlock(): void {
    if (!this.graph.unlock()) return;
    if (!this.booted) {
      this.booted = true;
      this.ambience.start();
      this.music.start();
      if (this.pendingSave) {
        this.applySave(this.pendingSave);
        this.pendingSave = null;
      }
    }
    if (this.gesture) {
      for (const evt of ['pointerdown', 'keydown', 'touchstart', 'mousedown'] as const) {
        removeEventListener(evt, this.gesture);
      }
      this.gesture = null;
    }
  }

  update(ctx: Ctx): void {
    if (ctx.input.pressed.has('KeyM')) {
      // Needs the graph up before it can mute anything, and a keypress is a
      // gesture, so this doubles as the last-resort unlock path.
      this.unlock();
      this.graph.setMuted(!this.graph.muted);
      ctx.bus.emit('notify', { text: this.graph.muted ? 'Sound off' : 'Sound on', kind: 'info' });
    }
    if (!this.graph.running) return;

    const dt = ctx.time.dt;
    this.updateListener(ctx);

    // Muffle follows the water system's amount, but with its own smoothing so
    // a boolean toggle still sounds like a head going under.
    this.submerged += (this.muffleTarget - this.submerged) * Math.min(1, dt * 6);
    this.graph.applyMuffle(this.submerged);

    if (ctx.time.frame % 6 === 0) this.sampleEnvironment(ctx);
    this.env.submerged = this.submerged;
    this.env.enclosure = Math.max(this.enclosure, this.submerged * 0.5);
    this.ambience.update(dt, this.env);

    // Hold, then decay. A pure decay makes a long duck impossible; a pure
    // timer makes every duck end with a step.
    if (this.duckHold > 0) this.duckHold -= dt;
    else this.duckAmount *= Math.exp(-dt * 1.8);
    const ambDuck = Math.max(
      this.combatActive ? 0.4 : 0,
      this.dialogueActive ? 0.6 : 0,
      this.duckAmount,
    );
    this.graph.setDuck('ambience', ambDuck);
    this.graph.setDuck('music', this.dialogueActive ? 0.65 : 0);

    this.music.update();
  }

  private updateListener(ctx: Ctx): void {
    const e = ctx.camera.matrixWorld.elements;
    // Column-major; a THREE camera looks down its local -Z.
    this.lPos.x = e[12];
    this.lPos.y = e[13];
    this.lPos.z = e[14];
    this.lFwd.x = -e[8];
    this.lFwd.y = -e[9];
    this.lFwd.z = -e[10];
    this.lUp.x = e[4];
    this.lUp.y = e[5];
    this.lUp.z = e[6];
    this.graph.setListener(this.lPos, this.lFwd, this.lUp);
    this.env.listener = this.lPos;
  }

  /**
   * Reads the world the ambience bed answers to. Terrain queries are the only
   * expensive part, so the shoreline search runs a tenth as often as the rest.
   */
  private sampleEnvironment(ctx: Ctx): void {
    const sky = ctx.get<IAtmosphere>('sky');
    const w = sky?.weather;
    if (w) {
      // Same from-tracking as the event handler: polling must not clobber the
      // outgoing weather, or a transition the bus missed crossfades from itself.
      if (w.kind !== this.weatherKind) {
        this.weatherFrom = this.weatherKind;
        this.weatherKind = w.kind;
      }
      this.env.kind = this.weatherKind;
      this.env.windSpeed = w.windSpeed;
      this.env.wetness = w.wetness;
      this.env.blend = clamp01(w.blend);
    }
    this.env.from = this.weatherFrom;
    this.env.hour = ctx.clock.hour;
    // Hysteresis on the boundary: the clock crosses 20:00 once, but a player
    // standing still at 19:59 must not flip the cue back and forth.
    const h = ctx.clock.hour;
    if (!this.night && (h > 20 || h < 5)) this.night = true;
    else if (this.night && h > 6 && h < 19) this.night = false;
    this.music.setNight(this.night);

    const player = ctx.get<IPlayer>('player');
    const p = player?.position ?? this.env.listener;
    const dx = p.x - RED_MOUNTAIN.x;
    const dz = p.z - RED_MOUNTAIN.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    // Audible well beyond the mountain's own radius — a volcano is felt from
    // the far side of the island, and that is most of its presence in the mix.
    this.env.volcanism = clamp01(1 - d / (RED_MOUNTAIN.radius * 1.9));
    this.env.altitude = p.y;

    const terrain = ctx.get<ITerrain>('terrain');
    if (terrain?.ready && ctx.time.frame % 60 === 0) {
      let veg = 0;
      let samples = 0;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = 6 + (i % 3) * 9;
        const m = terrain.materialAt(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
        if (m === Surface.Grass) veg += 1;
        else if (m === Surface.Mud) veg += 0.55;
        samples++;
      }
      this.env.vegetation = samples > 0 ? veg / samples : 0;

      // Shoreline distance by expanding rings; the first ring that finds water
      // wins, so flat coast and cliff coast both read correctly.
      let found = Infinity;
      for (const r of COAST_RINGS) {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + r * 0.37;
          if (terrain.heightAt(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r) < -0.5) {
            found = r;
            break;
          }
        }
        if (found < Infinity) break;
      }
      const near = Math.min(found, p.y < 1 ? 20 : found);
      this.env.coast = smoothstep(560, 30, near);
    }
  }

  // ---- public API -------------------------------------------------------

  setSpace(space: SpaceName, seconds = 1.4, enclosure?: number): void {
    this.space = space;
    this.enclosure = enclosure ?? ENCLOSURE[space];
    this.graph.setSpace(space, seconds);
    this.music.setEnclosed(space === 'cave' || space === 'interior');
  }

  get currentSpace(): SpaceName {
    return this.space;
  }

  /** True once a gesture has built the graph. */
  get ready(): boolean {
    return this.graph.running;
  }

  /** Post-limiter RMS, for a settings-menu meter and for smoke tests. */
  get level(): number {
    return this.graph.level;
  }

  get voices(): number {
    return this.graph.voiceCount;
  }

  setCombat(on: boolean): void {
    this.combatActive = on;
    this.music.setCombat(on);
  }

  /** 0..1. Drives the drone weight without changing the cue. */
  setIntensity(x: number): void {
    this.music.setIntensity(x);
  }

  setMood(mood: Mood, urgent = false): void {
    this.music.request(mood, urgent);
  }

  setVolume(bus: BusName | 'master', v: number): void {
    if (bus === 'master') this.graph.setMasterVolume(v);
    else this.graph.setVolume(bus, v);
  }

  getVolume(bus: BusName | 'master'): number {
    return bus === 'master' ? this.graph.masterVolume : this.graph.getVolume(bus);
  }

  setMuted(m: boolean): void {
    this.graph.setMuted(m);
  }

  get muted(): boolean {
    return this.graph.muted;
  }

  /** Ducks ambience by `amount` for `seconds`, then releases. Ducks compose. */
  duck(amount: number, seconds: number): void {
    this.duckAmount = Math.max(this.duckAmount, clamp01(amount));
    this.duckHold = Math.max(this.duckHold, Math.max(0, seconds));
  }

  footstep(surface: number, foot = 1, speed = 3, submersion = 0, position?: Vec3 | null): void {
    this.steps.step(surface, foot, speed, submersion, position ?? null);
  }

  splash(strength: number, position?: Vec3 | null): void {
    this.steps.splash(strength, position ?? null);
  }

  swing(weapon: Weapon, speed = 1, position?: Vec3 | null, dir?: Vec3 | null): void {
    this.combat.swing(weapon, speed, position ?? null, dir ?? null);
  }

  impact(weapon: Weapon, target: Target, force = 1, position?: Vec3 | null): void {
    this.combat.impact(weapon, target, force, position ?? null);
  }

  bow(phase: 'draw' | 'release' | 'flight', position?: Vec3 | null, dir?: Vec3 | null): void {
    if (phase === 'draw') this.combat.bowDraw(position ?? null);
    else if (phase === 'release') this.combat.bowRelease(position ?? null, dir ?? null);
    else this.combat.arrowFlight(position ?? null, dir ?? null);
  }

  spell(school: School, phase: Phase = 'release', position?: Vec3 | null, power = 1): void {
    this.magic.cast(school, phase, position ?? null, power);
  }

  creature(kind: CreatureKind, call: Call = 'idle', position?: Vec3 | null, dir?: Vec3 | null): void {
    this.creatures.call(kind, call, position ?? null, dir ?? null);
  }

  sting(kind: 'levelup' | 'quest' | 'death'): void {
    this.music.sting(kind);
  }

  // ---- persistence ------------------------------------------------------

  serialize(): AudioSave {
    return {
      master: this.graph.masterVolume,
      buses: {
        music: this.graph.getVolume('music'),
        sfx: this.graph.getVolume('sfx'),
        ambience: this.graph.getVolume('ambience'),
        ui: this.graph.getVolume('ui'),
      },
      muted: this.graph.muted,
      // Underwater is a transient space the water system re-asserts on load;
      // persisting it would leave a drowned mix on a player standing on land.
      space: this.space === 'underwater' ? this.spaceBeforeWater : this.space,
      music: this.music.serialize(),
    };
  }

  /** Tolerates anything: a save from an older build must not brick audio. */
  deserialize(raw: unknown): void {
    const s = this.coerce(raw);
    if (!s) return;
    if (!this.booted) {
      // The graph does not exist until a gesture; hold the state until it does.
      this.pendingSave = s;
      return;
    }
    this.applySave(s);
  }

  private applySave(s: AudioSave): void {
    this.graph.setMasterVolume(s.master);
    for (const bus of ['music', 'sfx', 'ambience', 'ui'] as const) this.graph.setVolume(bus, s.buses[bus]);
    this.graph.setMuted(s.muted);
    this.setSpace(s.space, 0.1);
    // Otherwise a load followed by a dive would surface into the pre-load space.
    this.spaceBeforeWater = s.space === 'underwater' ? 'outdoor' : s.space;
    this.music.deserialize(s.music);
  }

  private coerce(raw: unknown): AudioSave | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Partial<AudioSave>;
    const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const buses = (r.buses ?? {}) as Partial<Record<BusName, number>>;
    const music = (r.music ?? {}) as Partial<MusicState>;
    const space: SpaceName =
      r.space === 'cave' || r.space === 'interior' || r.space === 'underwater' ? r.space : 'outdoor';
    return {
      master: clamp01(num(r.master, 0.9)),
      buses: {
        music: clamp01(num(buses.music, 0.62)),
        sfx: clamp01(num(buses.sfx, 0.92)),
        ambience: clamp01(num(buses.ambience, 0.22)),
        ui: clamp01(num(buses.ui, 0.8)),
      },
      muted: r.muted === true,
      space,
      music: {
        seed: num(music.seed, 0x4d05e) >>> 0,
        mood: typeof music.mood === 'string' ? (music.mood as Mood) : 'explore',
        bar: num(music.bar, 0),
        phrasesInMood: num(music.phrasesInMood, 0),
        restBars: num(music.restBars, 0),
      },
    };
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    if (this.gesture) {
      for (const evt of ['pointerdown', 'keydown', 'touchstart', 'mousedown'] as const) {
        removeEventListener(evt, this.gesture);
      }
      this.gesture = null;
    }
    if (this.visibility) {
      document.removeEventListener('visibilitychange', this.visibility);
      this.visibility = null;
    }
    this.ambience.dispose();
    this.music.dispose();
    this.graph.dispose();
    this.booted = false;
  }
}
