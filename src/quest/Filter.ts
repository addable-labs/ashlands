import type {
  Condition,
  Effect,
  FactionId,
  ItemId,
  LocationId,
  NpcDef,
  NpcId,
  PlayerProfile,
  QuestId,
  SkillId,
  TopicId,
  WeatherKind,
} from './types';

/**
 * The read side of the world, as dialogue filters see it. Everything a
 * condition can ask about is on this interface and nothing else is, which is
 * what lets the filter engine be written once and never touched again while
 * content grows.
 */
export interface WorldView {
  readonly hour: number;
  readonly day: number;
  readonly weather: WeatherKind;
  readonly profile: PlayerProfile;
  readonly bounty: number;
  readonly playerLocation: LocationId;
  npc(id: NpcId): NpcDef;
  npcLocation(id: NpcId): LocationId;
  disposition(id: NpcId): number;
  stage(q: QuestId): number;
  isDone(q: QuestId): boolean;
  isFailed(q: QuestId): boolean;
  knows(t: TopicId): boolean;
  flag(name: string): boolean;
  rank(f: FactionId): number;
  factionRep(f: FactionId): number;
  expelled(f: FactionId): boolean;
  count(i: ItemId): number;
}

/** The write side. Effects run against this; nothing else mutates the world. */
export interface WorldMut extends WorldView {
  learn(t: TopicId): void;
  /** True when the quest actually moved — and therefore when the journal grew. */
  setStage(q: QuestId, n: number): boolean;
  failQuest(q: QuestId): void;
  setFlag(name: string, on: boolean): void;
  nudgeDisposition(npc: NpcId, delta: number): void;
  addFactionRep(f: FactionId, delta: number): void;
  addReputation(delta: number): void;
  addGold(delta: number): void;
  addItem(i: ItemId, n: number, stolen: boolean): void;
  addBounty(delta: number): void;
  join(f: FactionId): boolean;
  expel(f: FactionId): void;
  readmit(f: FactionId): void;
  setRank(f: FactionId, n: number): void;
  makeHostile(npc: NpcId): void;
  train(s: SkillId, amount: number): void;
  setWeather(w: WeatherKind): void;
  markRead(book: string): void;
}

/** Who is being spoken to. Null for filters evaluated outside a conversation. */
export interface Query {
  readonly view: WorldView;
  readonly speaker: NpcDef | null;
}

const inRange = (v: number, min: number | undefined, max: number | undefined): boolean =>
  (min === undefined || v >= min) && (max === undefined || v <= max);

type Pick<K extends Condition['k']> = Extract<Condition, { k: K }>;
type Table = { [K in Condition['k']]: (c: Pick<K>, q: Query) => boolean };

/**
 * One row per condition kind. A table rather than a switch so that adding a
 * filter term is a data edit in two places (the union and this table) and the
 * compiler names the file when you forget the second.
 */
const TESTS: Table = {
  race: (c, q) => q.speaker !== null && q.speaker.race === c.v,
  sex: (c, q) => q.speaker !== null && q.speaker.sex === c.v,
  npc: (c, q) => q.speaker !== null && q.speaker.id === c.v,
  speakerFaction: (c, q) => q.speaker !== null && q.speaker.faction === c.v,
  speakerRank: (c, q) => q.speaker !== null && inRange(q.speaker.rank, c.min, c.max),
  speakerAt: (c, q) => q.speaker !== null && q.view.npcLocation(q.speaker.id) === c.v,
  faction: (c, q) => q.view.rank(c.v) >= 0,
  rank: (c, q) => {
    const r = q.view.rank(c.faction);
    return r >= 0 && inRange(r, c.min, c.max);
  },
  expelled: (c, q) => q.view.expelled(c.faction),
  factionRep: (c, q) => inRange(q.view.factionRep(c.faction), c.min, c.max),
  disposition: (c, q) => q.speaker !== null && inRange(q.view.disposition(q.speaker.id), c.min, c.max),
  reputation: (c, q) => inRange(q.view.profile.reputation, c.min, c.max),
  bounty: (c, q) => inRange(q.view.bounty, c.min, c.max),
  stage: (c, q) => {
    const s = q.view.stage(c.quest);
    return s >= 0 && inRange(s, c.min, c.max);
  },
  done: (c, q) => q.view.isDone(c.quest),
  failed: (c, q) => q.view.isFailed(c.quest),
  flag: (c, q) => q.view.flag(c.v),
  knows: (c, q) => q.view.knows(c.v),
  item: (c, q) => q.view.count(c.v) >= (c.min ?? 1),
  attribute: (c, q) => q.view.profile.attributes[c.v] >= c.min,
  skill: (c, q) => q.view.profile.skills[c.v] >= c.min,
  // Hours wrap: {min: 20, max: 4} means "at night".
  hour: (c, q) => (c.min <= c.max ? q.view.hour >= c.min && q.view.hour < c.max : q.view.hour >= c.min || q.view.hour < c.max),
  day: (c, q) => inRange(q.view.day, c.min, c.max),
  weather: (c, q) => q.view.weather === c.v,
  at: (c, q) => q.view.playerLocation === c.v,
  not: (c, q) => !test(c.of, q),
  any: (c, q) => c.of.some((sub) => test(sub, q)),
};

export function test(c: Condition, q: Query): boolean {
  // The table is exhaustive over the union; the cast is what lets one call site
  // dispatch it without re-narrowing every member by hand.
  const fn = TESTS[c.k] as (cond: Condition, query: Query) => boolean;
  return fn(c, q);
}

export function matches(conds: readonly Condition[], q: Query): boolean {
  for (const c of conds) if (!test(c, q)) return false;
  return true;
}

/**
 * Morrowind selects the first response whose filters all pass, with the most
 * heavily filtered entries checked first. Sorting by filter count reproduces
 * that without asking authors to hand-order hundreds of rows: a response with
 * five conditions is by construction more situational than one with none, so it
 * gets the first look. Explicit `priority` overrides when authoring intent
 * disagrees with the count.
 */
export function rank<T extends { readonly when: readonly Condition[]; readonly priority?: number }>(
  rows: readonly T[],
): T[] {
  return rows
    .map((r, i) => ({ r, i, p: r.priority ?? r.when.length }))
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .map((e) => e.r);
}

export function firstMatch<T extends { readonly when: readonly Condition[] }>(rows: readonly T[], q: Query): T | null {
  for (const r of rows) if (matches(r.when, q)) return r;
  return null;
}

type PickE<K extends Effect['k']> = Extract<Effect, { k: K }>;
type EffectTable = { [K in Effect['k']]: (e: PickE<K>, w: WorldMut, speaker: NpcId | null) => void };

const EFFECTS: EffectTable = {
  topic: (e, w) => w.learn(e.v),
  stage: (e, w) => w.setStage(e.quest, e.v),
  fail: (e, w) => w.failQuest(e.quest),
  flag: (e, w) => w.setFlag(e.v, e.on ?? true),
  disposition: (e, w, speaker) => {
    const target = e.npc ?? speaker;
    if (target !== null) w.nudgeDisposition(target, e.v);
  },
  factionRep: (e, w) => w.addFactionRep(e.faction, e.v),
  reputation: (e, w) => w.addReputation(e.v),
  gold: (e, w) => w.addGold(e.v),
  item: (e, w) => w.addItem(e.v, e.n, e.stolen ?? false),
  bounty: (e, w) => w.addBounty(e.v),
  join: (e, w) => void w.join(e.faction),
  expel: (e, w) => w.expel(e.faction),
  readmit: (e, w) => w.readmit(e.faction),
  rank: (e, w) => w.setRank(e.faction, e.v),
  attack: (e, w, speaker) => {
    const target = e.npc ?? speaker;
    if (target !== null) w.makeHostile(target);
  },
  train: (e, w) => w.train(e.v, e.amount),
  weather: (e, w) => w.setWeather(e.v),
  book: (e, w) => w.markRead(e.v),
};

export function apply(effects: readonly Effect[] | undefined, w: WorldMut, speaker: NpcId | null): void {
  if (effects === undefined) return;
  for (const e of effects) {
    const fn = EFFECTS[e.k] as (eff: Effect, world: WorldMut, s: NpcId | null) => void;
    fn(e, w, speaker);
  }
}
