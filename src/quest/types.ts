import type { WeatherState } from '../core/types';

/**
 * ASHLANDS — RPG domain vocabulary.
 *
 * Every id union is declared by hand rather than derived from its table, so the
 * data modules can reference each other's ids without an import cycle. The
 * tables are then written with `satisfies Record<Id, Def>`, which makes a
 * missing or misspelt entry a compile error instead of a silent undefined.
 */

export type WeatherKind = WeatherState['kind'];

export type Race =
  | 'dunmer'
  | 'imperial'
  | 'nord'
  | 'breton'
  | 'redguard'
  | 'altmer'
  | 'bosmer'
  | 'orc'
  | 'khajiit'
  | 'argonian';

export type Sex = 'm' | 'f';

export type AttributeId =
  | 'strength'
  | 'intelligence'
  | 'willpower'
  | 'agility'
  | 'speed'
  | 'endurance'
  | 'personality'
  | 'luck';

/** The twenty-seven. Named as in the series; ids are camelCase. */
export type SkillId =
  | 'block'
  | 'armorer'
  | 'mediumArmor'
  | 'heavyArmor'
  | 'bluntWeapon'
  | 'longBlade'
  | 'axe'
  | 'spear'
  | 'athletics'
  | 'enchant'
  | 'destruction'
  | 'alteration'
  | 'illusion'
  | 'conjuration'
  | 'mysticism'
  | 'restoration'
  | 'alchemy'
  | 'unarmored'
  | 'security'
  | 'sneak'
  | 'acrobatics'
  | 'lightArmor'
  | 'shortBlade'
  | 'marksman'
  | 'mercantile'
  | 'speechcraft'
  | 'handToHand';

export type FactionId =
  | 'fighters'
  | 'mages'
  | 'thieves'
  | 'hlaalu'
  | 'redoran'
  | 'telvanni'
  | 'temple'
  | 'ashlanders'
  | 'legion';

export type LocationId =
  | 'ald_sethis'
  | 'sethis_docks'
  | 'sethis_market'
  | 'flagon'
  | 'fighters_hall'
  | 'mages_hall'
  | 'thieves_cellar'
  | 'temple_sethis'
  | 'hlaalu_counting'
  | 'redoran_hall'
  | 'tel_muran'
  | 'shirenamat'
  | 'ashfall_road'
  | 'kaldera_mine'
  | 'gate_of_ash'
  | 'wilderness';

export type NpcId =
  | 'varo_hleran'
  | 'dral_seran'
  | 'nevena_telvo'
  | 'brenn_alvis'
  | 'hrafna_gulhild'
  | 'sethri_quiet'
  | 'curate_arvel'
  | 'zabamat'
  | 'sul_kanet'
  | 'dinara_loras'
  | 'captain_selvi'
  | 'orrin_twopurse'
  | 'llevo_versifier'
  | 'ferisa_andalen'
  | 'gadan_sarothril'
  | 'kell_blackwater'
  | 'falia_beren'
  | 'madrel_vandas'
  | 'bemis_alen'
  | 'ryn_sadras'
  | 'seryn_othrelas';

export type TopicId =
  | 'ald_sethis'
  | 'little_advice'
  | 'my_trade'
  | 'background'
  | 'latest_rumours'
  | 'services'
  | 'the_ash_wake'
  | 'hollow_star'
  | 'four_verses'
  | 'the_ashen_gate'
  | 'dissident_saints'
  | 'tribunal_temple'
  | 'ashlanders'
  | 'great_houses'
  | 'house_hlaalu'
  | 'house_redoran'
  | 'house_telvanni'
  | 'fighters_guild'
  | 'mages_guild'
  | 'thieves_guild'
  | 'advancement'
  | 'blight'
  | 'ash_storms'
  | 'smugglers'
  | 'kaldera_mine'
  | 'the_widow'
  | 'bad_poetry'
  | 'hlaalu_ledger'
  | 'stolen_goods'
  | 'my_bounty'
  | 'guards'
  | 'silt_strider'
  | 'missing_apprentice'
  | 'duel_of_honour'
  | 'red_mountain'
  | 'books';

export type QuestId =
  | 'mq1_ash_wake'
  | 'mq2_four_verses'
  | 'mq3_hollow_star'
  | 'mq4_dissident_saints'
  | 'mq5_ashen_gate'
  | 'fg1_shipment'
  | 'fg2_nixhound_den'
  | 'mg1_reagents'
  | 'mg2_missing_apprentice'
  | 'tg1_ledger'
  | 'tg2_fence_run'
  | 'hl1_writ'
  | 'rd1_duel'
  | 'tv1_spore'
  | 'sq_widows_debt'
  | 'sq_bad_poetry'
  | 'sq_ashfall_caravan'
  | 'sq_pilgrim_seven';

export type ItemId =
  | 'gold'
  | 'sealed_packet'
  | 'verse_ash'
  | 'verse_blood'
  | 'verse_name'
  | 'verse_deed'
  | 'hlaalu_ledger'
  | 'muran_spore'
  | 'guild_shipment'
  | 'kwama_reagents'
  | 'writ_of_execution'
  | 'ashfall_manifest'
  | 'moon_sugar_crate'
  | 'shrine_offering'
  | 'ancestor_ring';

/* ------------------------------------------------------------------ filters */

/**
 * A dialogue/quest filter term. An array of these is an AND; `any` gives OR and
 * `not` gives negation, so arbitrary boolean expressions are expressible in
 * plain data with no code per topic. Everything that varies about the world —
 * who is speaking, what the player has done, what hour it is — is reachable
 * from here. That reach is the whole point: content is authored as tables.
 */
export type Condition =
  | { readonly k: 'race'; readonly v: Race }
  | { readonly k: 'sex'; readonly v: Sex }
  | { readonly k: 'npc'; readonly v: NpcId }
  | { readonly k: 'speakerFaction'; readonly v: FactionId }
  | { readonly k: 'speakerRank'; readonly min?: number; readonly max?: number }
  | { readonly k: 'speakerAt'; readonly v: LocationId }
  | { readonly k: 'faction'; readonly v: FactionId }
  | { readonly k: 'rank'; readonly faction: FactionId; readonly min?: number; readonly max?: number }
  | { readonly k: 'expelled'; readonly faction: FactionId }
  | { readonly k: 'factionRep'; readonly faction: FactionId; readonly min?: number; readonly max?: number }
  | { readonly k: 'disposition'; readonly min?: number; readonly max?: number }
  | { readonly k: 'reputation'; readonly min?: number; readonly max?: number }
  | { readonly k: 'bounty'; readonly min?: number; readonly max?: number }
  | { readonly k: 'stage'; readonly quest: QuestId; readonly min?: number; readonly max?: number }
  | { readonly k: 'done'; readonly quest: QuestId }
  | { readonly k: 'failed'; readonly quest: QuestId }
  | { readonly k: 'flag'; readonly v: string }
  | { readonly k: 'knows'; readonly v: TopicId }
  | { readonly k: 'item'; readonly v: ItemId; readonly min?: number }
  | { readonly k: 'attribute'; readonly v: AttributeId; readonly min: number }
  | { readonly k: 'skill'; readonly v: SkillId; readonly min: number }
  | { readonly k: 'hour'; readonly min: number; readonly max: number }
  | { readonly k: 'day'; readonly min?: number; readonly max?: number }
  | { readonly k: 'weather'; readonly v: WeatherKind }
  | { readonly k: 'at'; readonly v: LocationId }
  | { readonly k: 'not'; readonly of: Condition }
  | { readonly k: 'any'; readonly of: readonly Condition[] };

/** A world mutation. Same shape discipline as Condition: data, not callbacks. */
export type Effect =
  | { readonly k: 'topic'; readonly v: TopicId }
  | { readonly k: 'stage'; readonly quest: QuestId; readonly v: number }
  | { readonly k: 'fail'; readonly quest: QuestId }
  | { readonly k: 'flag'; readonly v: string; readonly on?: boolean }
  | { readonly k: 'disposition'; readonly v: number; readonly npc?: NpcId }
  | { readonly k: 'factionRep'; readonly faction: FactionId; readonly v: number }
  | { readonly k: 'reputation'; readonly v: number }
  | { readonly k: 'gold'; readonly v: number }
  | { readonly k: 'item'; readonly v: ItemId; readonly n: number; readonly stolen?: boolean }
  | { readonly k: 'bounty'; readonly v: number }
  | { readonly k: 'join'; readonly faction: FactionId }
  | { readonly k: 'expel'; readonly faction: FactionId }
  | { readonly k: 'readmit'; readonly faction: FactionId }
  | { readonly k: 'rank'; readonly faction: FactionId; readonly v: number }
  | { readonly k: 'attack'; readonly npc?: NpcId }
  | { readonly k: 'train'; readonly v: SkillId; readonly amount: number }
  | { readonly k: 'weather'; readonly v: WeatherKind }
  | { readonly k: 'book'; readonly v: string };

/* -------------------------------------------------------------------- defs */

export interface FactionRankDef {
  readonly name: string;
  /** Two attribute floors and two skill floors, exactly as the series does it. */
  readonly attributes: Partial<Record<AttributeId, number>>;
  readonly skills: Partial<Record<SkillId, number>>;
  /** Faction reputation needed. Earned by finishing that faction's quests. */
  readonly rep: number;
}

export interface FactionDef {
  readonly id: FactionId;
  readonly name: string;
  readonly blurb: string;
  readonly ranks: readonly FactionRankDef[];
  /** Joining any of these makes joining this one impossible, and vice versa. */
  readonly rivals: readonly FactionId[];
  /** Members of these factions like you less per rank you hold here. */
  readonly disliked: readonly FactionId[];
  /** Races that get a disposition bonus from members of this faction. */
  readonly favouredRaces: readonly Race[];
  /** Faction reputation below which you are thrown out. */
  readonly expelAt: number;
  readonly hall: LocationId;
}

export interface ScheduleEntry {
  /** Inclusive start hour; wraps if `to` is smaller. */
  readonly from: number;
  readonly to: number;
  readonly at: LocationId;
}

export interface NpcDef {
  readonly id: NpcId;
  readonly name: string;
  readonly race: Race;
  readonly sex: Sex;
  readonly faction: FactionId | null;
  readonly rank: number;
  /** 0..100. High personality NPCs are harder to intimidate, easier to admire. */
  readonly personality: number;
  readonly willpower: number;
  /** Base disposition before every modifier. */
  readonly baseDisposition: number;
  /** Gold on hand; caps bribes and what a fence will pay. */
  readonly purse: number;
  readonly schedule: readonly ScheduleEntry[];
  /** Topics this NPC will teach on greeting, if their filters pass. */
  readonly teaches: readonly TopicId[];
  readonly services: readonly ('trade' | 'fence' | 'train' | 'travel' | 'heal' | 'repair')[];
  /** True for guards: they act on bounty rather than talk. */
  readonly guard: boolean;
  /** Killing or angering this NPC permanently breaks these quests. */
  readonly essentialTo: readonly QuestId[];
}

export interface ResponseDef {
  readonly topic: TopicId;
  readonly when: readonly Condition[];
  readonly text: string;
  readonly effects?: readonly Effect[];
  /** Higher wins ties. Defaults to the filter count, i.e. most specific first. */
  readonly priority?: number;
}

export interface GreetingDef {
  readonly when: readonly Condition[];
  readonly text: string;
  readonly effects?: readonly Effect[];
  readonly priority?: number;
}

export interface TopicDef {
  readonly id: TopicId;
  readonly label: string;
  /** Known from the start of the game — the handful everyone can ask about. */
  readonly innate?: boolean;
}

/** One way through a stage. Quests must always offer more than one. */
export interface PathDef {
  readonly id: string;
  readonly label: string;
  readonly kind: 'fight' | 'sneak' | 'persuade' | 'bribe' | 'steal' | 'trade' | 'talk' | 'travel';
  /** Must all pass for the path to be offered at all. */
  readonly when?: readonly Condition[];
  /** Skill rolled against `difficulty`; absent means the path always works. */
  readonly skill?: SkillId;
  readonly difficulty?: number;
  readonly to: number;
  readonly effects?: readonly Effect[];
  /** Taken when the skill roll fails. Failure must be a real branch, not a retry. */
  readonly onFail?: { readonly to: number; readonly effects?: readonly Effect[] };
}

export interface StageDef {
  readonly n: number;
  /** Verbatim journal text. Never summarised, never rewritten. */
  readonly journal: string;
  readonly finished?: boolean;
  readonly failed?: boolean;
  /** Applied once, when the stage is first entered. */
  readonly enter?: readonly Effect[];
  readonly paths?: readonly PathDef[];
}

export interface QuestDef {
  readonly id: QuestId;
  readonly name: string;
  readonly giver: NpcId;
  readonly faction: FactionId | null;
  /** Advancement quests raise faction reputation and unlock the next rank. */
  readonly advancement: boolean;
  readonly stages: readonly StageDef[];
  /**
   * Checked every world tick while the quest is live; first match wins. This is
   * how a quest is permanently failed by neglect. `afterDays` is measured from
   * the day the quest started, which is why QuestProgress records it.
   */
  readonly expiry?: readonly {
    readonly when?: readonly Condition[];
    readonly afterDays?: number;
    readonly minStage?: number;
    readonly maxStage?: number;
    readonly to: number;
  }[];
}

export interface BookDef {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly kind: 'myth' | 'history' | 'propaganda' | 'poetry' | 'cookery' | 'manual' | 'letter';
  /** Reading it teaches these topics — books are a dialogue source like any NPC. */
  readonly teaches: readonly TopicId[];
  /** Reading raises this skill a little, as books do in the series. */
  readonly skill?: SkillId;
  readonly text: string;
}

export interface ItemDef {
  readonly id: ItemId;
  readonly name: string;
  readonly value: number;
  readonly quest: boolean;
}

/* ------------------------------------------------------------------- state */

export interface PlayerProfile {
  name: string;
  race: Race;
  sex: Sex;
  level: number;
  attributes: Record<AttributeId, number>;
  skills: Record<SkillId, number>;
  /** Fractional progress toward the next point in each skill. Improve by use. */
  progress: Record<SkillId, number>;
  reputation: number;
}

export type CrimeKind = 'trespass' | 'pickpocket' | 'theft' | 'assault' | 'murder';

export interface CrimeRecord {
  readonly kind: CrimeKind;
  readonly day: number;
  readonly hour: number;
  readonly bounty: number;
  readonly witnessed: boolean;
  readonly witnesses: number;
}

/**
 * What an entry did to its quest, recorded at the moment it was written.
 *
 * Without this a reader has to ask the live world whether the quest is finished,
 * which retroactively relabels every earlier entry the moment it closes — the
 * exact revisionism the journal exists to prevent. Stamping it here means an
 * entry means the same thing forever, including after a reload.
 */
export type JournalKind = 'begin' | 'stage' | 'done' | 'failed';

export interface JournalEntry {
  /**
   * Write order. Day+hour is not a key — several things can be written down in
   * the same in-world minute — so a UI that wants to group by quest and still
   * render in time order sorts on this, and only this.
   */
  readonly seq: number;
  readonly day: number;
  readonly hour: number;
  readonly quest: QuestId | null;
  readonly stage: number;
  readonly title: string;
  readonly text: string;
  readonly kind: JournalKind;
}

export interface QuestProgress {
  stage: number;
  done: boolean;
  failed: boolean;
  /** Day the quest first advanced past zero, for relative expiry windows. */
  since: number;
  /** Path ids already taken, so consequences can key off *how* it was solved. */
  paths: string[];
}

export interface FactionStanding {
  rank: number;
  reputation: number;
  expelled: boolean;
}

/** Everything the quest layer owns, in a shape that is already JSON. */
export interface QuestSave {
  readonly version: 1;
  clock: { hour: number; day: number };
  profile: PlayerProfile;
  gold: number;
  inventory: Record<string, number>;
  stolen: Record<string, number>;
  quests: Record<string, QuestProgress>;
  factions: Record<string, FactionStanding>;
  disposition: Record<string, number>;
  /** NPCs the player has turned hostile, and therefore cannot talk to again. */
  hostile: string[];
  dead: string[];
  topics: string[];
  flags: string[];
  journal: JournalEntry[];
  bounty: number;
  crimes: CrimeRecord[];
  booksRead: string[];
  location: LocationId;
  /** PRNG state, so a reloaded save re-rolls the same persuasion attempt. */
  rng: number;
}
