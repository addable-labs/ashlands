import * as THREE from 'three';
import type { IAtmosphere, ITerrain } from '../core/contracts';
import type { Ctx, System, TerrainQuery, WeatherState, WorldClock } from '../core/types';
import { BOOKS, BOOK_LIST } from './Books';
import { countWitnesses, resolveJustice, type JusticeChoice, type JusticeOutcome, type WitnessActor } from './Crime';
import { FACTIONS, FACTION_LIST } from './Factions';
import { ITEMS } from './Items';
import { NPCS, NPC_LIST, whereIs } from './Npcs';
import { QUESTS, QUEST_LIST } from './QuestData';
import { TOPICS } from './Topics';
import { World, type AskResult, type PathOffer, type TalkResult } from './World';
import type {
  BookDef,
  CrimeKind,
  CrimeRecord,
  FactionDef,
  FactionId,
  JournalEntry,
  LocationId,
  NpcDef,
  NpcId,
  QuestDef,
  QuestId,
  QuestSave,
  TopicId,
} from './types';
import type { PersuasionKind, PersuasionResult } from './Persuasion';

/** Minimal structural views of the systems this one reads. */
interface PlayerLike extends System {
  readonly position: THREE.Vector3;
}
interface ActorRef extends WitnessActor {
  readonly id: number;
  readonly kind: string;
}
interface ActorsLike extends System {
  all(): readonly ActorRef[];
}

/**
 * The character sheet, if some other system owns one. Declared structurally and
 * fetched through Ctx.get so that this file never imports the RPG layer and
 * works identically when there is not one.
 */
interface SheetLike extends System {
  stats(): {
    name: string;
    race: string;
    level: number;
    attributes: Record<string, number>;
    skills: Record<string, number>;
    gold: number;
  };
  noteSkillUse(skill: string, kind?: 0 | 1 | 2 | 3, times?: number): boolean;
}

const RACES = new Set<string>([
  'dunmer',
  'imperial',
  'nord',
  'breton',
  'redguard',
  'altmer',
  'bosmer',
  'orc',
  'khajiit',
  'argonian',
]);

/** How close the player must be for an NPC to greet them. */
const GREET_RANGE = 4.5;
/** Seconds before the same NPC will greet again. */
const GREET_COOLDOWN = 25;
/** In-world hours between world-simulation ticks. */
const TICK_HOURS = 0.25;

export interface GreetingEvent {
  readonly npc: NpcId;
  readonly name: string;
  readonly text: string;
  readonly disposition: number;
  readonly topics: readonly TopicId[];
}

export interface JusticeDemand {
  readonly guard: NpcId;
  readonly bounty: number;
  readonly options: readonly JusticeChoice[];
}

/**
 * ASHLANDS — dialogue, quests, factions, crime and the daily life of Ald Sethis.
 *
 * The system itself is thin on purpose. All the rules live in World, which is a
 * plain class with no engine dependency; this file is the wiring: it mirrors the
 * world clock, resolves witnesses against real actor positions and the real
 * heightfield, moves NPCs through their schedules, and turns the rule layer's
 * outbox into bus events. Everything a UI needs is a method here that returns
 * data — no strings are rendered, no markers are placed, and the journal is
 * handed over exactly as it was written.
 */
export class QuestSystem implements System {
  readonly id = 'quest';
  readonly order = 85;

  readonly world = new World();

  private terrain: TerrainQuery | null = null;
  private actors: ActorsLike | null = null;
  private player: PlayerLike | null = null;
  private sheet: SheetLike | null = null;
  private sky: IAtmosphere | null = null;
  private bus: Ctx['bus'] | null = null;
  /**
   * The live clock, held by reference. `world.hour` is only refreshed once per
   * frame, so any query answered from it reports where everybody was on the
   * last frame rather than at the hour being asked about — which is how five
   * NPCs sampled at 03:00 and at 13:00 came back standing in the same room.
   */
  private clock: WorldClock | null = null;
  private offWeather: (() => void) | null = null;
  private offCrime: (() => void) | null = null;
  private offKill: (() => void) | null = null;

  /** Named NPCs are bound to whichever humanoid actors the actor system spawned. */
  private bodies = new Map<NpcId, ActorRef>();
  private lastGreet = new Map<NpcId, number>();
  private placed = new Map<NpcId, LocationId>();
  private nextTick = 0;
  /** Journal entries already published, so the bridge to a UI stays append-only. */
  private published = 0;
  private lastDay = 1;
  private pendingJustice: JusticeDemand | null = null;
  /** Last purse total read from the sheet, so both writers can move the same coin. */
  private sheetGold = -1;
  /** Reused across bind attempts so a townless world costs no garbage per frame. */
  private readonly pool: ActorRef[] = [];
  private nextBind = 0;

  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly crimeAt = new THREE.Vector3();

  init(ctx: Ctx): void {
    this.bus = ctx.bus;
    this.clock = ctx.clock;
    this.terrain = ctx.get<ITerrain>('terrain') ?? null;
    this.sky = ctx.get<IAtmosphere>('sky') ?? null;
    this.world.hour = ctx.clock.hour;
    this.world.day = ctx.clock.day;
    this.lastDay = ctx.clock.day;
    // Monotonic day+hour, matching the comparison in update(). Mixing the bare
    // hour in here made the first tick fire on frame one every session.
    this.nextTick = ctx.clock.day * 24 + ctx.clock.hour + TICK_HOURS;

    this.offWeather = ctx.bus.on<WeatherState>('weather', (w) => {
      this.world.weather = w.kind;
    });

    // Any system may report a crime; only this one decides whether it counts.
    this.offCrime = ctx.bus.on<{ kind: CrimeKind; value?: number; x?: number; y?: number; z?: number }>(
      'crime',
      (p) => {
        const at =
          p.x !== undefined && p.y !== undefined && p.z !== undefined
            ? this.crimeAt.set(p.x, p.y, p.z)
            : (this.player?.position ?? null);
        this.reportCrime(p.kind, p.value ?? 0, at);
      },
    );

    this.offKill = ctx.bus.on<{ npc: NpcId }>('actor:killed', (p) => {
      if (p.npc in NPCS) this.world.kill(p.npc);
    });

    // The spine starts as a rumour in a tavern, not as a summons, so nothing is
    // started here. Beginning it in init() wrote the opening entry into the
    // journal before the player had heard anything, and — because startQuest is
    // a no-op on a quest already under way — left the public start API unable
    // to produce an entry for the one quest anybody would call it on. The two
    // ways in are now both in the world: ask after rumours in the Ashen Flagon,
    // or find Seryn Othrelas on the Ashfall road yourself.
  }

  update(ctx: Ctx): void {
    const w = this.world;
    w.hour = ctx.clock.hour;
    w.day = ctx.clock.day;

    if (this.player === null) this.player = ctx.get<PlayerLike>('player') ?? null;
    if (this.actors === null) this.actors = ctx.get<ActorsLike>('actors') ?? null;
    if (this.terrain === null) this.terrain = ctx.get<ITerrain>('terrain') ?? null;
    if (this.sky === null) this.sky = ctx.get<IAtmosphere>('sky') ?? null;
    if (this.sheet === null) this.adoptSheet(ctx);
    // Retry at most once a second: before the actor system has populated the
    // world this would otherwise walk the whole roster every single frame.
    if (this.bodies.size === 0 && ctx.time.elapsed >= this.nextBind) {
      this.nextBind = ctx.time.elapsed + 1;
      this.bindBodies();
    }

    // The clock wraps at midnight, so compare on a monotonic day+hour value.
    const now = ctx.clock.day * 24 + ctx.clock.hour;
    if (now >= this.nextTick) {
      this.nextTick = now + TICK_HOURS;
      this.simulate(ctx);
    }
    if (ctx.clock.day !== this.lastDay) {
      this.lastDay = ctx.clock.day;
      ctx.bus.emit('quest:day', { day: ctx.clock.day });
    }

    this.updateLocation();
    this.greetNearby(ctx);
    this.flush(ctx);
  }

  /* ------------------------------------------------------------- world sim */

  /**
   * Binds the roster to actor bodies. The actor system spawns an ambient
   * humanoid population; naming those bodies is what turns a crowd into a town,
   * and it costs nothing but a map.
   */
  private bindBodies(): void {
    if (this.actors === null) return;
    const pool = this.pool;
    pool.length = 0;
    for (const a of this.actors.all()) if (a.kind === 'dunmer') pool.push(a);
    if (pool.length === 0) return;
    NPC_LIST.forEach((npc, i) => {
      const body = pool[i % pool.length];
      if (body !== undefined) this.bodies.set(npc.id, body);
    });
    pool.length = 0;
  }

  /**
   * If a character-sheet system is present, defer to it: dialogue filters then
   * read the same Strength the combat system reads, and Speechcraft practised
   * by talking counts toward the same level-up.
   */
  private adoptSheet(ctx: Ctx): void {
    const rpg = ctx.get<SheetLike>('rpg');
    if (rpg === undefined || typeof rpg.stats !== 'function') return;
    this.sheet = rpg;
    this.world.trainHook = (s, amount) => {
      // amount is in "uses"; the sheet owns what a use is worth per skill.
      rpg.noteSkillUse(s, 0, Math.max(1, Math.round(amount)));
    };
    this.world.goldHook = (delta) => ctx.bus.emit('quest:gold', { delta });
    this.mirrorSheet();
  }

  private mirrorSheet(): void {
    const rpg = this.sheet;
    if (rpg === null) return;
    const s = rpg.stats();
    const p = this.world.profile;
    p.name = s.name;
    p.level = s.level;
    if (RACES.has(s.race)) p.race = s.race as typeof p.race;
    for (const k of Object.keys(p.attributes)) {
      const v = s.attributes[k];
      if (typeof v === 'number') p.attributes[k as keyof typeof p.attributes] = v;
    }
    for (const k of Object.keys(p.skills)) {
      const v = s.skills[k];
      if (typeof v === 'number') p.skills[k as keyof typeof p.skills] = v;
    }
    // Two systems can move coin: quest rewards here, loot and trade there. Take
    // the sheet's *change* rather than its absolute, or every quest payout is
    // silently reverted on the next mirror.
    if (this.sheetGold < 0) this.world.gold = s.gold;
    else if (s.gold !== this.sheetGold) this.world.gold = Math.max(0, this.world.gold + (s.gold - this.sheetGold));
    this.sheetGold = s.gold;
  }

  private simulate(ctx: Ctx): void {
    this.mirrorSheet();
    this.world.tickQuests();
    // Schedules. Publishing the transition lets any interior/streaming system
    // move the body; the quest layer only ever owns the fact of it.
    for (const npc of NPC_LIST) {
      const at = whereIs(npc, ctx.clock.hour);
      if (this.placed.get(npc.id) !== at) {
        this.placed.set(npc.id, at);
        ctx.bus.emit('quest:schedule', { npc: npc.id, at, hour: ctx.clock.hour });
      }
    }
  }

  private updateLocation(): void {
    const p = this.player;
    if (p === null) {
      return;
    }
    let best: LocationId = 'wilderness';
    let bestD = 18 * 18;
    for (const [id, body] of this.bodies) {
      if (!body.alive) continue;
      const d = body.position.distanceToSquared(p.position);
      if (d < bestD) {
        bestD = d;
        best = whereIs(NPCS[id], this.hour());
      }
    }
    this.world.playerLocation = best;
  }

  private greetNearby(ctx: Ctx): void {
    const p = this.player;
    if (p === null) return;
    const t = ctx.time.elapsed;
    for (const [id, body] of this.bodies) {
      if (!body.alive || this.world.isDead(id)) continue;
      if (body.position.distanceToSquared(p.position) > GREET_RANGE * GREET_RANGE) continue;
      if (t - (this.lastGreet.get(id) ?? -1e9) < GREET_COOLDOWN) continue;
      this.lastGreet.set(id, t);
      const res = this.world.talk(id);
      const payload: GreetingEvent = {
        npc: id,
        name: NPCS[id].name,
        text: res.greeting,
        disposition: res.disposition,
        topics: res.topics,
      };
      ctx.bus.emit('quest:greeting', payload);
      ctx.bus.emit('notify', { text: `${NPCS[id].name}: ${res.greeting}`, kind: 'info' });
      if (NPCS[id].guard) this.demandJustice(id);
      break;
    }
  }

  /** Drains the rule layer's outbox onto the bus and into the sky system. */
  private flush(ctx: Ctx): void {
    const out = this.world.outbox;
    if (out.weather !== null) {
      this.sky?.setWeather(out.weather, 20);
      out.weather = null;
    }
    if (out.attacks.length > 0) {
      for (const npc of out.attacks) {
        const body = this.bodies.get(npc);
        ctx.bus.emit('quest:hostile', { npc, actor: body?.id ?? -1 });
      }
      out.attacks.length = 0;
    }
    if (out.learned.length > 0) {
      for (const topic of out.learned) ctx.bus.emit('quest:topic', { topic, label: TOPICS[topic].label });
      out.learned.length = 0;
    }
    if (out.notices.length > 0) {
      for (const text of out.notices) ctx.bus.emit('notify', { text, kind: 'quest' });
      out.notices.length = 0;
    }

    // Journal entries are published one at a time and never revised, so a UI
    // can append them blind and will always match what the player wrote down.
    // done/failed come off the entry itself rather than off the live quest:
    // asking the world would mark every earlier entry of a finished quest as
    // its ending, and would do it differently before and after a reload.
    const log = this.world.journal();
    for (; this.published < log.length; this.published++) {
      const e = log[this.published];
      const giver = e.quest === null ? '' : NPCS[QUESTS[e.quest].giver].name;
      ctx.bus.emit('quest:journal', {
        seq: e.seq,
        quest: e.quest,
        title: e.title,
        giver,
        stage: e.stage,
        day: e.day,
        hour: e.hour,
        text: e.text,
        kind: e.kind,
        done: e.kind === 'done',
        failed: e.kind === 'failed',
      });
      // The interface layer's documented inbound surface. Without this the
      // journal panel is fed by nothing at all and stays empty for the whole
      // game, which is how eighteen quests' worth of writing went unread.
      ctx.bus.emit('ui:journal', {
        id: e.quest ?? 'misc',
        name: e.title,
        giver,
        text: e.text,
        done: e.kind === 'done',
      });
    }
  }

  /* ------------------------------------------------------------------ API */

  /** Everything a dialogue UI needs to open a conversation. */
  talk(npc: NpcId): TalkResult {
    this.mirrorSheet();
    return this.world.talk(npc);
  }

  ask(npc: NpcId, topic: TopicId): AskResult | null {
    this.mirrorSheet();
    return this.world.ask(npc, topic);
  }

  persuade(npc: NpcId, kind: PersuasionKind, bribe = 0): PersuasionResult {
    this.mirrorSheet();
    const res = this.world.attempt(npc, kind, bribe);
    this.bus?.emit('quest:persuade', { npc, kind, success: res.success, delta: res.delta });
    return res;
  }

  disposition(npc: NpcId): number {
    return this.world.disposition(npc);
  }

  knownTopics(): readonly TopicId[] {
    return this.world.knownTopics();
  }

  topicLabel(t: TopicId): string {
    return TOPICS[t].label;
  }

  /** Chronological, append-only, unsummarised. The UI renders; it does not edit. */
  journal(): readonly JournalEntry[] {
    return this.world.journal();
  }

  offers(): readonly PathOffer[] {
    this.mirrorSheet();
    return this.world.offers();
  }

  takePath(quest: QuestId, path: string): boolean {
    this.mirrorSheet();
    return this.world.takePath(quest, path);
  }

  /** Begins a quest at its opening stage. False if it was already under way. */
  startQuest(quest: QuestId): boolean {
    return this.world.startQuest(quest);
  }

  /** The stage a quest stands at, or -1 if it has not begun. */
  questStage(quest: QuestId): number {
    return this.world.stage(quest);
  }

  questDef(id: QuestId): QuestDef {
    return QUESTS[id];
  }

  quests(): readonly QuestDef[] {
    return QUEST_LIST;
  }

  npcDef(id: NpcId): NpcDef {
    return NPCS[id];
  }

  npcs(): readonly NpcDef[] {
    return NPC_LIST;
  }

  /** Where an NPC is right now: their schedule, read against the live clock. */
  npcLocation(id: NpcId): LocationId {
    return whereIs(NPCS[id], this.hour());
  }

  /** Where an NPC would be at a given hour. Used to plan a visit, or to test one. */
  npcLocationAt(id: NpcId, hour: number): LocationId {
    return whereIs(NPCS[id], hour);
  }

  /** The hour the world is standing at, from the clock itself if there is one. */
  private hour(): number {
    return this.clock?.hour ?? this.world.hour;
  }

  factions(): readonly FactionDef[] {
    return FACTION_LIST;
  }

  factionDef(id: FactionId): FactionDef {
    return FACTIONS[id];
  }

  rankName(f: FactionId): string | null {
    const r = this.world.rank(f);
    return r < 0 ? null : FACTIONS[f].ranks[r].name;
  }

  join(f: FactionId): boolean {
    return this.world.join(f);
  }

  /** Empty means the next promotion is available; otherwise these are the gaps. */
  promotionBlockers(f: FactionId): readonly string[] {
    return this.world.promotionBlockers(f);
  }

  tryPromote(f: FactionId): boolean {
    return this.world.tryPromote(f);
  }

  books(): readonly BookDef[] {
    return BOOK_LIST;
  }

  read(book: string): BookDef | null {
    return this.world.read(book);
  }

  bookIds(): readonly string[] {
    return Object.keys(BOOKS);
  }

  itemName(i: keyof typeof ITEMS): string {
    return ITEMS[i].name;
  }

  /* ---------------------------------------------------------------- crime */

  /**
   * Resolves a crime against the live world: who was near, who was facing, what
   * the terrain occluded, how dark it was, how well the player sneaks. Returns
   * the bounty added, which is zero if nobody saw it.
   */
  reportCrime(kind: CrimeKind, value = 0, at: THREE.Vector3 | null = null): number {
    const where = at ?? this.player?.position ?? this.a.set(0, 0, 0);
    const source = this.actors;
    const witnesses = countWitnesses({
      at: where,
      hour: this.world.hour,
      weather: this.world.weather,
      sneak: this.world.profile.skills.sneak,
      source,
      terrain: this.terrain,
      roll: () => this.world.roll(),
      scratchA: this.a,
      scratchB: this.b,
      scratchC: this.c,
    });
    const added = this.world.commitCrime(kind, value, witnesses);
    this.bus?.emit('quest:crime', { kind, value, witnesses, bounty: this.world.bounty });
    return added;
  }

  /**
   * What the Legion currently wants from the player, in drakes. This was a
   * getter, which meant the one number the whole crime system produces could be
   * read by nothing that treats the quest layer as an API — a UI could not
   * display it and a test could not assert on it. It is a method now, like
   * every other reading off this facade.
   */
  bounty(): number {
    return this.world.bounty;
  }

  /** Every crime the player has committed, witnessed or not, in order. */
  crimes(): readonly CrimeRecord[] {
    return this.world.crimeRecord();
  }

  /**
   * A guard stops the player over an outstanding bounty. Returns the demand, or
   * null when there is nothing to answer for. `greetNearby` calls this when a
   * guard walks into range; it is public so that a dialogue UI — or a test —
   * can stage the confrontation instead of waiting for one to happen.
   */
  demandJustice(guard: NpcId | null = null): JusticeDemand | null {
    if (this.world.bounty <= 0) return null;
    const who = guard ?? this.nearestGuard();
    if (who === null) return null;
    this.pendingJustice = { guard: who, bounty: this.world.bounty, options: ['pay', 'jail', 'resist'] };
    this.bus?.emit('quest:justice', this.pendingJustice);
    return this.pendingJustice;
  }

  /**
   * Whichever guard is closest, or — before the actor system has bodies to
   * measure against — simply the first one on the roster who is still alive.
   */
  private nearestGuard(): NpcId | null {
    const p = this.player;
    let best: NpcId | null = null;
    let bestD = Infinity;
    for (const npc of NPC_LIST) {
      if (!npc.guard || this.world.isDead(npc.id)) continue;
      const body = this.bodies.get(npc.id);
      const d = p !== null && body !== undefined ? body.position.distanceToSquared(p.position) : Infinity;
      if (best === null || d < bestD) {
        best = npc.id;
        bestD = d;
      }
    }
    return best;
  }

  justiceDemand(): JusticeDemand | null {
    return this.pendingJustice;
  }

  /** Pay, serve, or fight. Resisting is always available and always costly. */
  answerJustice(choice: JusticeChoice): JusticeOutcome {
    const bounty = this.world.bounty;
    const out = resolveJustice(choice, bounty, this.world.gold, this.world.roll());
    if (out.goldPaid > 0) this.world.effects([{ k: 'gold', v: -out.goldPaid }]);
    if (out.bountyCleared) this.world.clearBounty();
    if (out.skillLost !== null) {
      const s = out.skillLost;
      this.world.profile.skills[s] = Math.max(1, this.world.profile.skills[s] - 1);
    }
    if (out.daysServed > 0) this.bus?.emit('quest:jailed', { days: out.daysServed });
    if (out.hostile) {
      this.world.effects([{ k: 'factionRep', faction: 'legion', v: -10 }]);
      const guard = this.pendingJustice?.guard;
      if (guard !== undefined) this.world.makeHostile(guard);
    }
    // A player who says "I will pay" and cannot is still standing in front of a
    // trooper. Clearing the demand there would have let an empty purse walk away
    // from the confrontation, so it only closes when something actually settled it.
    if (out.bountyCleared || out.hostile) this.pendingJustice = null;
    this.bus?.emit('notify', { text: out.text, kind: 'quest' });
    return out;
  }

  /* ------------------------------------------------------------ save/load */

  save(): QuestSave {
    return this.world.save();
  }

  load(s: QuestSave): void {
    this.world.load(s);
    this.lastGreet.clear();
    this.placed.clear();
    this.pendingJustice = null;
    // The save's purse is authoritative for the quest layer; re-baseline against
    // the sheet instead of resetting to -1, which would have made the next mirror
    // overwrite the restored gold with whatever the sheet happened to hold.
    this.sheetGold = this.sheet === null ? -1 : this.sheet.stats().gold;
    // A load can move the clock backwards or forwards by days. Force the next
    // update to re-baseline, or the world simulation stalls until the restored
    // clock catches back up to the pre-load deadline.
    this.nextTick = -Infinity;
    this.nextBind = 0;
    // A load replaces the journal wholesale; republish it so a UI attached
    // after the fact ends up with exactly the entries the save holds.
    this.published = 0;
  }

  dispose(): void {
    this.offWeather?.();
    this.offCrime?.();
    this.offKill?.();
    this.offWeather = null;
    this.offCrime = null;
    this.offKill = null;
    this.bodies.clear();
    this.lastGreet.clear();
    this.placed.clear();
    this.pool.length = 0;
    this.pendingJustice = null;
    this.terrain = null;
    this.actors = null;
    this.player = null;
    this.sheet = null;
    this.world.trainHook = null;
    this.world.goldHook = null;
    this.sky = null;
    this.bus = null;
    this.clock = null;
  }
}
