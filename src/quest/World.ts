import { BOOKS } from './Books';
import { FACTIONS, rivals } from './Factions';
import { apply, firstMatch, matches, rank as rankRows, type Query, type WorldMut } from './Filter';
import { NPCS, whereIs } from './Npcs';
import { disposition as computeDisposition, persuade, type PersuasionKind, type PersuasionResult } from './Persuasion';
import { QUESTS } from './QuestData';
import { GREETINGS, INNATE_TOPICS, RESPONSES, TOPICS } from './Topics';
import type {
  BookDef,
  CrimeKind,
  CrimeRecord,
  Effect,
  FactionId,
  FactionStanding,
  ItemId,
  JournalEntry,
  JournalKind,
  LocationId,
  NpcDef,
  NpcId,
  PathDef,
  PlayerProfile,
  QuestDef,
  QuestId,
  QuestProgress,
  QuestSave,
  SkillId,
  StageDef,
  TopicId,
  WeatherKind,
} from './types';

const ATTRIBUTE_KEYS = [
  'strength',
  'intelligence',
  'willpower',
  'agility',
  'speed',
  'endurance',
  'personality',
  'luck',
] as const;

const SKILL_KEYS = [
  'block',
  'armorer',
  'mediumArmor',
  'heavyArmor',
  'bluntWeapon',
  'longBlade',
  'axe',
  'spear',
  'athletics',
  'enchant',
  'destruction',
  'alteration',
  'illusion',
  'conjuration',
  'mysticism',
  'restoration',
  'alchemy',
  'unarmored',
  'security',
  'sneak',
  'acrobatics',
  'lightArmor',
  'shortBlade',
  'marksman',
  'mercantile',
  'speechcraft',
  'handToHand',
] as const;

function freshProfile(): PlayerProfile {
  const attributes = {} as PlayerProfile['attributes'];
  for (const a of ATTRIBUTE_KEYS) attributes[a] = 30;
  attributes.personality = 40;
  attributes.luck = 40;
  const skills = {} as PlayerProfile['skills'];
  const progress = {} as PlayerProfile['progress'];
  for (const s of SKILL_KEYS) {
    skills[s] = 5;
    progress[s] = 0;
  }
  // A prisoner off the boat is competent at exactly nothing and may attempt
  // everything. Nothing here gates content; it only sets the odds.
  skills.speechcraft = 15;
  skills.longBlade = 15;
  skills.sneak = 10;
  skills.security = 10;
  skills.athletics = 15;
  return { name: 'Nameless', race: 'imperial', sex: 'm', level: 1, attributes, skills, progress, reputation: 0 };
}

const ORDERED_RESPONSES = rankRows(RESPONSES);
const ORDERED_GREETINGS = rankRows(GREETINGS);

export interface TalkResult {
  readonly npc: NpcId;
  readonly greeting: string;
  readonly disposition: number;
  readonly topics: readonly TopicId[];
}

export interface AskResult {
  readonly text: string;
  /** Topics this answer added to the player's list. */
  readonly learned: readonly TopicId[];
}

export interface PathOffer {
  readonly quest: QuestId;
  readonly path: PathDef;
}

/**
 * All quest-layer state, and every rule that reads or writes it.
 *
 * The engine System around this holds nothing of its own; keeping the rules in
 * a plain class means the whole RPG layer can be exercised, saved and reloaded
 * without a renderer, and that save/load is one method rather than a scatter of
 * per-feature serialisers that will drift.
 */
export class World implements WorldMut {
  hour = 7.5;
  day = 1;
  weather: WeatherKind = 'clear';
  playerLocation: LocationId = 'ald_sethis';
  profile: PlayerProfile = freshProfile();
  gold = 80;
  bounty = 0;

  private inventory = new Map<ItemId, number>();
  private stolenGoods = new Map<ItemId, number>();
  private quests = new Map<QuestId, QuestProgress>();
  private factions = new Map<FactionId, FactionStanding>();
  private dispositionDelta = new Map<NpcId, number>();
  private hostile = new Set<NpcId>();
  private deadNpcs = new Set<NpcId>();
  private topics = new Set<TopicId>(INNATE_TOPICS);
  private flags = new Set<string>();
  private crimes: CrimeRecord[] = [];
  private booksRead = new Set<string>();
  private entries: JournalEntry[] = [];
  /** Next journal sequence number. Restored from the entries themselves on load. */
  private entrySeq = 0;
  private met = new Set<NpcId>();
  private seed = 0x2f6e2b1;

  /**
   * Optional hand-off to whichever system owns the character sheet and the
   * purse. When they are set, this class stops being the authority on skills
   * and coin and becomes a caller — which is what keeps the RPG layer and the
   * quest layer from each holding half a player.
   */
  trainHook: ((s: SkillId, amount: number) => void) | null = null;
  goldHook: ((delta: number) => void) | null = null;

  /** Side effects the host system must act on: weather forcing, attacks, notes. */
  readonly outbox: {
    weather: WeatherKind | null;
    attacks: NpcId[];
    notices: string[];
    learned: TopicId[];
  } = { weather: null, attacks: [], notices: [], learned: [] };

  /* ------------------------------------------------------------------ rng */

  /** xorshift32. Deterministic and serialisable, which Math.random is not. */
  roll(): number {
    let x = this.seed | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x | 0;
    return ((x >>> 0) % 1000000) / 1000000;
  }

  /* ------------------------------------------------------------- read side */

  npc(id: NpcId): NpcDef {
    return NPCS[id];
  }

  npcLocation(id: NpcId): LocationId {
    return whereIs(NPCS[id], this.hour);
  }

  disposition(id: NpcId): number {
    return computeDisposition(NPCS[id], {
      profile: this.profile,
      bounty: this.bounty,
      rank: (f) => this.rank(f),
      expelled: (f) => this.expelled(f),
      delta: (n) => this.dispositionDelta.get(n.id) ?? 0,
    });
  }

  stage(q: QuestId): number {
    return this.quests.get(q)?.stage ?? -1;
  }

  isDone(q: QuestId): boolean {
    return this.quests.get(q)?.done === true;
  }

  isFailed(q: QuestId): boolean {
    return this.quests.get(q)?.failed === true;
  }

  knows(t: TopicId): boolean {
    return this.topics.has(t);
  }

  flag(name: string): boolean {
    return this.flags.has(name);
  }

  rank(f: FactionId): number {
    return this.factions.get(f)?.rank ?? -1;
  }

  factionRep(f: FactionId): number {
    return this.factions.get(f)?.reputation ?? 0;
  }

  expelled(f: FactionId): boolean {
    return this.factions.get(f)?.expelled === true;
  }

  count(i: ItemId): number {
    if (i === 'gold') return this.gold;
    return this.inventory.get(i) ?? 0;
  }

  stolenCount(i: ItemId): number {
    return this.stolenGoods.get(i) ?? 0;
  }

  isHostile(id: NpcId): boolean {
    return this.hostile.has(id);
  }

  isDead(id: NpcId): boolean {
    return this.deadNpcs.has(id);
  }

  knownTopics(): readonly TopicId[] {
    return [...this.topics];
  }

  journal(): readonly JournalEntry[] {
    return this.entries;
  }

  crimeRecord(): readonly CrimeRecord[] {
    return this.crimes;
  }

  hasRead(book: string): boolean {
    return this.booksRead.has(book);
  }

  private query(speaker: NpcDef | null): Query {
    return { view: this, speaker };
  }

  /* ------------------------------------------------------------ write side */

  learn(t: TopicId): void {
    if (!this.topics.has(t)) {
      this.topics.add(t);
      this.outbox.learned.push(t);
      this.outbox.notices.push(`New topic: ${TOPICS[t].label}`);
    }
  }

  setFlag(name: string, on: boolean): void {
    if (on) this.flags.add(name);
    else this.flags.delete(name);
  }

  nudgeDisposition(npc: NpcId, delta: number): void {
    const cur = this.dispositionDelta.get(npc) ?? 0;
    this.dispositionDelta.set(npc, Math.max(-100, Math.min(100, cur + delta)));
  }

  addReputation(delta: number): void {
    this.profile.reputation += delta;
  }

  addGold(delta: number): void {
    this.gold = Math.max(0, this.gold + delta);
    this.goldHook?.(delta);
  }

  addItem(i: ItemId, n: number, stolen: boolean): void {
    if (i === 'gold') {
      this.addGold(n);
      return;
    }
    const next = Math.max(0, (this.inventory.get(i) ?? 0) + n);
    if (next === 0) this.inventory.delete(i);
    else this.inventory.set(i, next);
    if (stolen && n > 0) this.stolenGoods.set(i, (this.stolenGoods.get(i) ?? 0) + n);
    if (n < 0) {
      // Selling a stolen item clears its flag first; a fence launders the
      // specific goods handed over, not the whole inventory.
      const s = this.stolenGoods.get(i) ?? 0;
      if (s > 0) {
        const left = Math.max(0, s + n);
        if (left === 0) this.stolenGoods.delete(i);
        else this.stolenGoods.set(i, left);
      }
    }
  }

  addBounty(delta: number): void {
    this.bounty = Math.max(0, this.bounty + delta);
  }

  setWeather(w: WeatherKind): void {
    this.outbox.weather = w;
  }

  markRead(book: string): void {
    if (this.booksRead.has(book)) return;
    this.booksRead.add(book);
  }

  makeHostile(npc: NpcId): void {
    if (this.hostile.has(npc)) return;
    this.hostile.add(npc);
    this.setFlag(`hostile:${npc}`, true);
    this.nudgeDisposition(npc, -60);
    this.outbox.attacks.push(npc);
    this.outbox.notices.push(`${NPCS[npc].name} draws on you.`);
  }

  /** Permanent. Quests that depended on this person are lost with them. */
  kill(npc: NpcId): void {
    if (this.deadNpcs.has(npc)) return;
    this.deadNpcs.add(npc);
    this.hostile.delete(npc);
    this.setFlag(`dead:${npc}`, true);
    for (const q of NPCS[npc].essentialTo) {
      const p = this.quests.get(q);
      if (p !== undefined && !p.done && !p.failed) this.failQuest(q);
    }
  }

  /* ---------------------------------------------------------- skill by use */

  /**
   * Skills improve by use, and only by use. `difficulty` scales the gain: a
   * lock you can barely pick teaches you more than one you could open asleep.
   */
  train(s: SkillId, amount: number): void {
    if (this.trainHook !== null) {
      this.trainHook(s, amount);
      return;
    }
    const level = this.profile.skills[s];
    // Diminishing returns, so the first twenty points arrive fast and the last
    // twenty are a career. This is the shape the series uses and it is why
    // "swing a blade to get better at blades" does not trivialise itself.
    const gain = amount / (1 + level * 0.09);
    let p = this.profile.progress[s] + gain;
    while (p >= 1) {
      p -= 1;
      this.profile.skills[s] = Math.min(100, this.profile.skills[s] + 1);
      this.outbox.notices.push(`Your ${s} has improved to ${this.profile.skills[s]}.`);
    }
    this.profile.progress[s] = p;
  }

  /** One skill check. Uses the skill whether it passes or fails — that is the point. */
  check(s: SkillId, difficulty: number): boolean {
    const a = this.profile.attributes;
    const chance = this.profile.skills[s] + a.agility * 0.15 + a.luck * 0.1 - difficulty;
    const ok = this.roll() * 100 < Math.max(5, Math.min(95, 25 + chance));
    this.train(s, ok ? 0.6 : 1.0);
    return ok;
  }

  /* -------------------------------------------------------------- factions */

  private standing(f: FactionId): FactionStanding {
    let s = this.factions.get(f);
    if (s === undefined) {
      s = { rank: -1, reputation: 0, expelled: false };
      this.factions.set(f, s);
    }
    return s;
  }

  /** Refuses on rivalry. Swearing to two Great Houses is not a thing you may do. */
  join(f: FactionId): boolean {
    const s = this.standing(f);
    if (s.rank >= 0) return true;
    for (const other of FACTIONS[f].rivals) {
      if (this.rank(other) >= 0) {
        this.outbox.notices.push(`${FACTIONS[f].name} will not take a sworn member of ${FACTIONS[other].name}.`);
        return false;
      }
    }
    for (const [id, st] of this.factions) {
      if (st.rank >= 0 && rivals(f, id)) return false;
    }
    s.rank = 0;
    s.expelled = false;
    this.outbox.notices.push(`You are now ${FACTIONS[f].ranks[0].name} of the ${FACTIONS[f].name}.`);
    return true;
  }

  setRank(f: FactionId, n: number): void {
    const s = this.standing(f);
    s.rank = Math.max(-1, Math.min(FACTIONS[f].ranks.length - 1, n));
  }

  expel(f: FactionId): void {
    const s = this.standing(f);
    if (s.rank < 0) return;
    s.expelled = true;
    this.outbox.notices.push(`You have been expelled from the ${FACTIONS[f].name}.`);
  }

  readmit(f: FactionId): void {
    const s = this.standing(f);
    s.expelled = false;
    if (s.reputation < 0) s.reputation = 0;
  }

  addFactionRep(f: FactionId, delta: number): void {
    const s = this.standing(f);
    s.reputation += delta;
    if (s.rank >= 0 && !s.expelled && s.reputation <= FACTIONS[f].expelAt) this.expel(f);
  }

  /** What blocks the next promotion, or null if nothing does. */
  promotionBlockers(f: FactionId): readonly string[] {
    const s = this.standing(f);
    if (s.rank < 0) return ['You are not a member.'];
    if (s.expelled) return ['You are expelled.'];
    const next = FACTIONS[f].ranks.at(s.rank + 1);
    if (next === undefined) return ['There is no rank above yours.'];
    const out: string[] = [];
    for (const [k, v] of Object.entries(next.attributes)) {
      if (v === undefined) continue;
      const key = k as keyof PlayerProfile['attributes'];
      if (this.profile.attributes[key] < v) out.push(`${k} ${this.profile.attributes[key]}/${v}`);
    }
    for (const [k, v] of Object.entries(next.skills)) {
      if (v === undefined) continue;
      const key = k as SkillId;
      if (this.profile.skills[key] < v) out.push(`${k} ${this.profile.skills[key]}/${v}`);
    }
    if (s.reputation < next.rep) out.push(`standing ${s.reputation}/${next.rep}`);
    return out;
  }

  /** Promotes if and only if every requirement is met. Never scales to the player. */
  tryPromote(f: FactionId): boolean {
    if (this.promotionBlockers(f).length > 0) return false;
    const s = this.standing(f);
    s.rank += 1;
    this.outbox.notices.push(`You are raised to ${FACTIONS[f].ranks[s.rank].name} of the ${FACTIONS[f].name}.`);
    return true;
  }

  /* ---------------------------------------------------------------- quests */

  private progress(q: QuestId): QuestProgress {
    let p = this.quests.get(q);
    if (p === undefined) {
      p = { stage: -1, done: false, failed: false, since: this.day, paths: [] };
      this.quests.set(q, p);
    }
    return p;
  }

  private stageDef(def: QuestDef, n: number): StageDef | null {
    for (const s of def.stages) if (s.n === n) return s;
    return null;
  }

  /**
   * The one place that writes the journal. Append-only, timestamped, never
   * edited and never summarised: re-reading old entries is how the player works
   * out where to go, because there are no markers and there will not be any.
   */
  private note(def: QuestDef, stage: number, text: string, kind: JournalKind): void {
    this.entries.push({
      seq: this.entrySeq++,
      day: this.day,
      hour: this.hour,
      quest: def.id,
      stage,
      title: def.name,
      text,
      kind,
    });
  }

  /**
   * The single entry point for quest progression. Returns whether the quest
   * actually moved, which is also exactly when a journal entry was written.
   */
  setStage(q: QuestId, n: number): boolean {
    const def = QUESTS[q];
    const p = this.progress(q);
    if (p.done || p.failed) return false;
    const st = this.stageDef(def, n);
    if (st === null) return false;
    // Re-entering the stage you are already on is not progress. Hub stages —
    // mq2's four verses, mq3's three proofs — route every path back to
    // themselves, so without this the same paragraph is written into the
    // journal once per errand and the stage's `enter` effects, documented as
    // once-only, fire again with them.
    if (p.stage === n) return false;
    const opening = p.stage < 0;
    if (opening) p.since = this.day;
    p.stage = n;
    const kind: JournalKind =
      st.failed === true ? 'failed' : st.finished === true ? 'done' : opening ? 'begin' : 'stage';
    this.note(def, n, st.journal, kind);
    if (st.enter !== undefined) apply(st.enter, this, null);
    if (st.finished === true) {
      p.done = true;
      this.onQuestClosed(def, true);
    }
    if (st.failed === true) {
      p.failed = true;
      this.onQuestClosed(def, false);
    }
    return true;
  }

  private onQuestClosed(def: QuestDef, success: boolean): void {
    if (!success) return;
    this.profile.reputation += def.advancement ? 1 : 2;
    if (def.faction !== null && def.advancement) {
      this.addFactionRep(def.faction, 4);
      this.tryPromote(def.faction);
    }
  }

  failQuest(q: QuestId): void {
    const p = this.progress(q);
    if (p.done || p.failed) return;
    const def: QuestDef = QUESTS[q];
    // Prefer an authored failure stage so the journal says what went wrong in
    // the world's own voice rather than in the engine's.
    for (const st of def.stages) {
      if (st.failed === true && this.setStage(q, st.n)) return;
    }
    p.failed = true;
    // A quest can be lost before it was ever entered — the giver is murdered on
    // day one — so the closing note carries the stage it died at, not -1, which
    // would sort as "before the beginning" in a grouped view.
    this.note(def, Math.max(0, p.stage), 'Whatever this was, it has gone past me. There is nothing left to do about it.', 'failed');
  }

  /** Begins a quest at its first stage. False if it was already under way. */
  startQuest(q: QuestId): boolean {
    if (this.stage(q) >= 0) return false;
    const first = QUESTS[q].stages[0];
    return this.setStage(q, first.n);
  }

  /** Every path the player could take right now, across every live quest. */
  offers(): readonly PathOffer[] {
    const out: PathOffer[] = [];
    const qy = this.query(null);
    for (const def of Object.values(QUESTS) as QuestDef[]) {
      const p = this.quests.get(def.id);
      if (p === undefined || p.done || p.failed) continue;
      const st = this.stageDef(def, p.stage);
      if (st === null || st.paths === undefined) continue;
      for (const path of st.paths) {
        if (path.when !== undefined && !matches(path.when, qy)) continue;
        out.push({ quest: def.id, path });
      }
    }
    return out;
  }

  /**
   * Takes a path. A skill path rolls once; failure routes to its own branch,
   * which may be the same stage with a consequence attached. There is no retry
   * that costs nothing.
   */
  takePath(q: QuestId, pathId: string): boolean {
    const def = QUESTS[q];
    const p = this.quests.get(q);
    if (p === undefined || p.done || p.failed) return false;
    const st = this.stageDef(def, p.stage);
    if (st === null || st.paths === undefined) return false;
    const path = st.paths.find((x) => x.id === pathId);
    if (path === undefined) return false;
    if (path.when !== undefined && !matches(path.when, this.query(null))) return false;

    const ok = path.skill === undefined ? true : this.check(path.skill, path.difficulty ?? 30);
    p.paths.push(`${p.stage}:${pathId}:${ok ? 'ok' : 'fail'}`);
    if (ok) {
      apply(path.effects, this, null);
      this.setStage(q, path.to);
    } else {
      const f = path.onFail;
      if (f !== undefined) {
        apply(f.effects, this, null);
        // Most failure branches route back to the same stage; setStage now
        // recognises that as "no movement" and writes nothing.
        this.setStage(q, f.to);
      }
    }
    return ok;
  }

  /** Expiry sweep. Called once per in-world tick, not per frame. */
  tickQuests(): void {
    const qy = this.query(null);
    for (const def of Object.values(QUESTS) as QuestDef[]) {
      if (def.expiry === undefined) continue;
      const p = this.quests.get(def.id);
      if (p === undefined || p.done || p.failed || p.stage < 0) continue;
      for (const e of def.expiry) {
        if (e.minStage !== undefined && p.stage < e.minStage) continue;
        if (e.maxStage !== undefined && p.stage > e.maxStage) continue;
        if (e.afterDays !== undefined && this.day - p.since < e.afterDays) continue;
        if (e.when !== undefined && !matches(e.when, qy)) continue;
        this.setStage(def.id, e.to);
        break;
      }
    }
  }

  /* -------------------------------------------------------------- dialogue */

  /** Topics this NPC has something to say about, out of what the player knows. */
  topicsFor(id: NpcId): readonly TopicId[] {
    const speaker = NPCS[id];
    const qy = this.query(speaker);
    const out: TopicId[] = [];
    for (const t of this.topics) {
      for (const r of ORDERED_RESPONSES) {
        if (r.topic !== t) continue;
        if (!matches(r.when, qy)) continue;
        out.push(t);
        break;
      }
    }
    return out.sort((a, b) => TOPICS[a].label.localeCompare(TOPICS[b].label));
  }

  talk(id: NpcId): TalkResult {
    const speaker = NPCS[id];
    const g = firstMatch(ORDERED_GREETINGS, this.query(speaker));
    if (g !== null) apply(g.effects, this, id);
    if (!this.met.has(id)) {
      this.met.add(id);
      for (const t of speaker.teaches) this.learn(t);
    }
    return {
      npc: id,
      greeting: g?.text ?? '...',
      disposition: this.disposition(id),
      topics: this.topicsFor(id),
    };
  }

  ask(id: NpcId, topic: TopicId): AskResult | null {
    if (!this.topics.has(topic)) return null;
    const speaker = NPCS[id];
    const qy = this.query(speaker);
    for (const r of ORDERED_RESPONSES) {
      if (r.topic !== topic) continue;
      if (!matches(r.when, qy)) continue;
      const before = new Set(this.topics);
      apply(r.effects, this, id);
      const learned = [...this.topics].filter((t) => !before.has(t));
      // Talking is a use of Speechcraft even when nothing is being persuaded.
      this.train('speechcraft', 0.05);
      return { text: r.text, learned };
    }
    return null;
  }

  attempt(id: NpcId, kind: PersuasionKind, bribe = 0): PersuasionResult {
    const speaker = NPCS[id];
    if (kind === 'bribe' && bribe > this.gold) bribe = this.gold;
    const res = persuade(kind, speaker, this.disposition(id), this.profile, this.roll(), bribe);
    this.nudgeDisposition(id, res.delta);
    if (res.cost > 0) this.addGold(-res.cost);
    this.train('speechcraft', res.success ? 0.8 : 1.2);
    if (kind === 'bribe') this.train('mercantile', 0.5);
    if (res.attacks) this.makeHostile(id);
    return res;
  }

  /* ------------------------------------------------------------------ books */

  read(bookId: string): BookDef | null {
    const b = BOOKS[bookId];
    if (b === undefined) return null;
    for (const t of b.teaches) this.learn(t);
    if (b.skill !== undefined && !this.booksRead.has(bookId)) this.train(b.skill, 1.2);
    this.markRead(bookId);
    return b;
  }

  /* ------------------------------------------------------------------ crime */

  /**
   * Commits a crime. Unwitnessed crime costs nothing but still marks the goods,
   * which is what makes a fence a distinct profession rather than a discount.
   */
  commitCrime(kind: CrimeKind, value: number, witnesses: number): number {
    const table: Record<CrimeKind, number> = {
      trespass: 5,
      pickpocket: 25,
      theft: Math.max(5, Math.round(value)),
      assault: 40,
      murder: 1000,
    };
    const amount = table[kind];
    const seen = witnesses > 0;
    this.crimes.push({ kind, day: this.day, hour: this.hour, bounty: seen ? amount : 0, witnessed: seen, witnesses });
    if (seen) {
      this.addBounty(amount);
      this.outbox.notices.push(`Your crime has been reported. Bounty: ${this.bounty}.`);
      // Guild loyalty is not the same as immunity, but the Thieves Guild does
      // not mind, and the Legion minds a great deal.
      this.addFactionRep('legion', -2);
      if (this.rank('thieves') >= 0 && kind !== 'murder') this.addFactionRep('thieves', 1);
    }
    return seen ? amount : 0;
  }

  clearBounty(): void {
    this.bounty = 0;
  }

  /* ------------------------------------------------------------- serialise */

  save(): QuestSave {
    const obj = <K extends string, V>(m: Map<K, V>): Record<string, V> => {
      const o: Record<string, V> = {};
      for (const [k, v] of m) o[k] = v;
      return o;
    };
    return {
      version: 1,
      clock: { hour: this.hour, day: this.day },
      profile: structuredClone(this.profile),
      gold: this.gold,
      inventory: obj(this.inventory),
      stolen: obj(this.stolenGoods),
      quests: obj(this.quests),
      factions: obj(this.factions),
      disposition: obj(this.dispositionDelta),
      hostile: [...this.hostile],
      dead: [...this.deadNpcs],
      topics: [...this.topics],
      flags: [...this.flags],
      journal: this.entries.slice(),
      bounty: this.bounty,
      crimes: this.crimes.slice(),
      booksRead: [...this.booksRead],
      location: this.playerLocation,
      rng: this.seed,
    };
  }

  load(s: QuestSave): void {
    this.hour = s.clock.hour;
    this.day = s.clock.day;
    this.profile = structuredClone(s.profile);
    this.gold = s.gold;
    this.bounty = s.bounty;
    this.playerLocation = s.location;
    this.seed = s.rng | 0;

    this.inventory.clear();
    for (const [k, v] of Object.entries(s.inventory)) this.inventory.set(k as ItemId, v);
    this.stolenGoods.clear();
    for (const [k, v] of Object.entries(s.stolen)) this.stolenGoods.set(k as ItemId, v);
    this.quests.clear();
    for (const [k, v] of Object.entries(s.quests)) this.quests.set(k as QuestId, { ...v, paths: v.paths.slice() });
    this.factions.clear();
    for (const [k, v] of Object.entries(s.factions)) this.factions.set(k as FactionId, { ...v });
    this.dispositionDelta.clear();
    for (const [k, v] of Object.entries(s.disposition)) this.dispositionDelta.set(k as NpcId, v);

    this.hostile = new Set(s.hostile as NpcId[]);
    this.deadNpcs = new Set(s.dead as NpcId[]);
    this.topics = new Set(s.topics as TopicId[]);
    this.flags = new Set(s.flags);
    this.entries = s.journal.slice();
    // Sequence numbers are the journal's ordering key, so the counter has to
    // resume above the highest restored one or a post-load entry sorts into the
    // middle of the past.
    this.entrySeq = this.entries.reduce((m, e) => Math.max(m, e.seq + 1), 0);
    this.crimes = s.crimes.slice();
    this.booksRead = new Set(s.booksRead);
    // Greetings teach on first meeting; anyone in the journal has been met, and
    // re-teaching is idempotent anyway.
    this.met.clear();
    this.outbox.weather = null;
    this.outbox.attacks.length = 0;
    this.outbox.notices.length = 0;
    this.outbox.learned.length = 0;
  }

  /** Applies a raw effect list. Used by other systems through the facade. */
  effects(list: readonly Effect[], speaker: NpcId | null = null): void {
    apply(list, this, speaker);
  }
}
