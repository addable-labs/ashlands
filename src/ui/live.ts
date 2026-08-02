/**
 * The bridge between the interface and the live game.
 *
 * This module exists because of a specific failure: the interface used to own a
 * character model of its own (`GameState`) and every panel rendered *that*. The
 * screens looked right and were lying — the inventory listed a sample table
 * while the real character carried something else entirely, and equipping in
 * the UI equipped nothing. Nothing here holds character data. Every number a
 * panel shows is read, on demand, from the system that owns it:
 *
 *   - `rpg`   — src/rpg/RPG.ts     — the character, its pack, its spells
 *   - `quest` — src/quest/Quests.ts — the journal, factions, dialogue
 *
 * The system interfaces are declared structurally rather than imported, because
 * engine systems never import one another; they meet at `Ctx.get`. That means
 * these declarations track the real signatures by hand. Every method below was
 * read off the two source files named above — none is invented, and if one of
 * them is renamed the call goes `undefined` at runtime rather than silently
 * returning something plausible, which is exactly the failure mode this file
 * replaces.
 *
 * When a system is absent (a harness page, a teardown), the accessors return
 * empty. Panels render "nothing is bound" instead of sample content.
 */
import type { Ctx, System } from '../core/types';
import type { ShapeId } from './preview';

/* ------------------------------------------------------------------ ids */

/** Equipment slots, in the RPG layer's own order — src/rpg/Items.ts SLOTS. */
export const LIVE_SLOTS = [
  'head',
  'cuirass',
  'greaves',
  'boots',
  'leftPauldron',
  'rightPauldron',
  'leftGauntlet',
  'rightGauntlet',
  'shield',
  'weapon',
  'ammo',
  'leftRing',
  'rightRing',
  'amulet',
  'belt',
  'shirt',
  'pants',
  'skirt',
  'robe',
  'shoes',
] as const;
export type LiveSlotId = (typeof LIVE_SLOTS)[number];

export const LIVE_ATTRIBUTES = [
  'strength',
  'intelligence',
  'willpower',
  'agility',
  'speed',
  'endurance',
  'personality',
  'luck',
] as const;
export type LiveAttributeId = (typeof LIVE_ATTRIBUTES)[number];

/** The twenty-seven, in the RPG layer's canonical order (nine per specialisation). */
export const LIVE_SKILLS = [
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
export type LiveSkillId = (typeof LIVE_SKILLS)[number];

export type LiveSpec = 'combat' | 'magic' | 'stealth';

/** The ten playable bloods — src/rpg/Races.ts RACE_DEFS. */
export const LIVE_RACES = [
  'altmer',
  'argonian',
  'bosmer',
  'breton',
  'dunmer',
  'imperial',
  'khajiit',
  'nord',
  'orc',
  'redguard',
] as const;
export type LiveRaceId = (typeof LIVE_RACES)[number];

/** The thirteen constellations — src/rpg/Races.ts BIRTHSIGNS. */
export const LIVE_BIRTHSIGNS = [
  'warrior',
  'mage',
  'thief',
  'serpent',
  'lady',
  'steed',
  'lord',
  'apprentice',
  'atronach',
  'ritual',
  'lover',
  'shadow',
  'tower',
] as const;
export type LiveBirthsignId = (typeof LIVE_BIRTHSIGNS)[number];

/** The built-in callings — src/rpg/Classes.ts CLASS_IDS. */
export const LIVE_CLASSES = [
  'warrior',
  'knight',
  'barbarian',
  'mage',
  'battlemage',
  'sorcerer',
  'healer',
  'thief',
  'assassin',
  'nightblade',
] as const;
export type LiveClassId = (typeof LIVE_CLASSES)[number];

/**
 * Display labels only. The values, the ordering and the governing attribute all
 * come from the live character; these are the words next to them. Keyed by the
 * real ids so an unmapped id is a compile error here rather than a blank row.
 */
export const ATTRIBUTE_LABELS: Readonly<Record<LiveAttributeId, string>> = {
  strength: 'Strength',
  intelligence: 'Intelligence',
  willpower: 'Willpower',
  agility: 'Agility',
  speed: 'Speed',
  endurance: 'Endurance',
  personality: 'Personality',
  luck: 'Luck',
};

export interface SkillLabel {
  readonly name: string;
  readonly attribute: LiveAttributeId;
  readonly spec: LiveSpec;
}

export const SKILL_LABELS: Readonly<Record<LiveSkillId, SkillLabel>> = {
  block: { name: 'Block', attribute: 'agility', spec: 'combat' },
  armorer: { name: 'Armorer', attribute: 'strength', spec: 'combat' },
  mediumArmor: { name: 'Medium Armor', attribute: 'endurance', spec: 'combat' },
  heavyArmor: { name: 'Heavy Armor', attribute: 'endurance', spec: 'combat' },
  bluntWeapon: { name: 'Blunt Weapon', attribute: 'strength', spec: 'combat' },
  longBlade: { name: 'Long Blade', attribute: 'strength', spec: 'combat' },
  axe: { name: 'Axe', attribute: 'strength', spec: 'combat' },
  spear: { name: 'Spear', attribute: 'endurance', spec: 'combat' },
  athletics: { name: 'Athletics', attribute: 'speed', spec: 'combat' },
  enchant: { name: 'Enchant', attribute: 'intelligence', spec: 'magic' },
  destruction: { name: 'Destruction', attribute: 'willpower', spec: 'magic' },
  alteration: { name: 'Alteration', attribute: 'willpower', spec: 'magic' },
  illusion: { name: 'Illusion', attribute: 'personality', spec: 'magic' },
  conjuration: { name: 'Conjuration', attribute: 'intelligence', spec: 'magic' },
  mysticism: { name: 'Mysticism', attribute: 'willpower', spec: 'magic' },
  restoration: { name: 'Restoration', attribute: 'willpower', spec: 'magic' },
  alchemy: { name: 'Alchemy', attribute: 'intelligence', spec: 'magic' },
  unarmored: { name: 'Unarmored', attribute: 'speed', spec: 'magic' },
  security: { name: 'Security', attribute: 'intelligence', spec: 'stealth' },
  sneak: { name: 'Sneak', attribute: 'agility', spec: 'stealth' },
  acrobatics: { name: 'Acrobatics', attribute: 'strength', spec: 'stealth' },
  lightArmor: { name: 'Light Armor', attribute: 'agility', spec: 'stealth' },
  shortBlade: { name: 'Short Blade', attribute: 'speed', spec: 'stealth' },
  marksman: { name: 'Marksman', attribute: 'agility', spec: 'stealth' },
  mercantile: { name: 'Mercantile', attribute: 'personality', spec: 'stealth' },
  speechcraft: { name: 'Speechcraft', attribute: 'personality', spec: 'stealth' },
  handToHand: { name: 'Hand to Hand', attribute: 'speed', spec: 'stealth' },
};

export const SLOT_LABELS: Readonly<Record<LiveSlotId, string>> = {
  head: 'Helm',
  cuirass: 'Cuirass',
  greaves: 'Greaves',
  boots: 'Boots',
  leftPauldron: 'Left Pauldron',
  rightPauldron: 'Right Pauldron',
  leftGauntlet: 'Left Gauntlet',
  rightGauntlet: 'Right Gauntlet',
  shield: 'Shield',
  weapon: 'Weapon',
  ammo: 'Ammunition',
  leftRing: 'Left Ring',
  rightRing: 'Right Ring',
  amulet: 'Amulet',
  belt: 'Belt',
  shirt: 'Shirt',
  pants: 'Pants',
  skirt: 'Skirt',
  robe: 'Robe',
  shoes: 'Shoes',
};

/* --------------------------------------------- structural system shapes */

export type LiveRange = 'self' | 'touch' | 'target';

/** Mirrors src/rpg/Effects.ts `EffectInstance`. */
export interface LiveEffect {
  effect: string;
  attribute?: string;
  skill?: string;
  magMin: number;
  magMax: number;
  duration: number;
  area: number;
  range: LiveRange;
}

/** Mirrors src/rpg/Items.ts `Enchantment`. */
export interface LiveEnchantment {
  readonly name: string;
  readonly kind: 'cast' | 'constant' | 'strike';
  readonly effects: readonly LiveEffect[];
  readonly cost: number;
  readonly charge: number;
}

/**
 * Mirrors the `ItemDef` union in src/rpg/Items.ts, flattened: every member's
 * fields appear here as optional, which is what a renderer actually wants.
 */
export interface LiveItemDef {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly weight: number;
  readonly value: number;
  readonly slot?: LiveSlotId;
  readonly material?: string;
  readonly type?: string;
  readonly piece?: string;
  readonly skill?: string;
  readonly armor?: number;
  readonly armorClass?: string;
  readonly coverage?: number;
  readonly chop?: readonly [number, number];
  readonly slash?: readonly [number, number];
  readonly thrust?: readonly [number, number];
  readonly reach?: number;
  readonly speed?: number;
  readonly maxCondition?: number;
  readonly enchantPoints?: number;
  readonly twoHanded?: boolean;
  readonly ranged?: boolean;
  readonly stackable?: boolean;
  readonly enchantment?: LiveEnchantment;
  readonly effects?: readonly LiveEffect[];
  readonly castCost?: number;
  readonly text?: string;
  readonly teaches?: string;
  readonly apparatus?: string;
  readonly quality?: number;
  readonly tool?: string;
  readonly uses?: number;
  readonly misc?: string;
  readonly soulCapacity?: number;
}

/** Mirrors src/rpg/Items.ts `ItemStack` — a physical instance in the pack. */
export interface LiveStack {
  readonly uid: number;
  readonly def: string;
  readonly count: number;
  readonly condition: number;
  readonly charge: number;
  readonly soul: number;
  readonly soulName?: string;
}

export interface LiveInventory {
  readonly stacks: readonly LiveStack[];
  readonly equipped: ReadonlyMap<LiveSlotId, number>;
  readonly gold: number;
  readonly weight: number;
  readonly worth: number;
  find(uid: number): LiveStack | undefined;
  /** Undefined when the definition table no longer has the row this stack names. */
  defOf(stack: LiveStack): LiveItemDef | undefined;
  equippedStack(slot: LiveSlotId): LiveStack | undefined;
  isEquipped(uid: number): boolean;
  remove(uid: number, count?: number): boolean;
  /** Null when the id names nothing this build knows. */
  addById(id: string, count?: number): LiveStack | null;
}

export interface LiveSpell {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly effects: readonly LiveEffect[];
  readonly cost: number;
  readonly custom: boolean;
}

export interface LiveSpellBook {
  ready: string | null;
  known(): readonly LiveSpell[];
  castable(): readonly LiveSpell[];
  get(id: string): LiveSpell | undefined;
}

export interface LiveActiveEffect {
  readonly effect: string;
  readonly magnitude: number;
  readonly remaining: number;
  readonly source: string;
  readonly kind: string;
}

export interface LiveClass {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly spec: LiveSpec;
  readonly favored: readonly LiveAttributeId[];
  readonly major: readonly LiveSkillId[];
  readonly minor: readonly LiveSkillId[];
}

export interface LiveLevelOffer {
  readonly attribute: LiveAttributeId;
  readonly multiplier: number;
  readonly gains: number;
}

/** Mirrors src/rpg/Character.ts `Character`, in the parts a panel reads. */
export interface LiveCharacter {
  readonly name: string;
  readonly race: string;
  readonly gender: string;
  readonly birthsign: string;
  readonly klass: LiveClass;
  readonly inventory: LiveInventory;
  readonly spells: LiveSpellBook;
  readonly active: readonly LiveActiveEffect[];
  readonly skillProgress: Readonly<Record<LiveSkillId, number>>;
  readonly attributeGains: Readonly<Record<LiveAttributeId, number>>;
  readonly levelProgress: number;
  readonly pendingLevelUp: boolean;
  readonly booksRead: ReadonlySet<string>;
  classOf(skill: LiveSkillId): 'major' | 'minor' | 'misc';
  levelUpOffers(): readonly LiveLevelOffer[];
}

/** Mirrors src/rpg/RPG.ts `StatsSnapshot`. */
export interface Sheet {
  readonly name: string;
  readonly race: string;
  readonly gender: string;
  readonly birthsign: string;
  readonly className: string;
  readonly level: number;
  readonly levelProgress: number;
  readonly pendingLevelUp: boolean;
  readonly health: number;
  readonly maxHealth: number;
  readonly magicka: number;
  readonly maxMagicka: number;
  readonly fatigue: number;
  readonly maxFatigue: number;
  readonly encumbrance: number;
  readonly capacity: number;
  readonly mobility: number;
  readonly attributes: Readonly<Record<LiveAttributeId, number>>;
  readonly skills: Readonly<Record<LiveSkillId, number>>;
  readonly armorRating: number;
  readonly readySpell: string | null;
  readonly gold: number;
}

export type LiveBrewResult =
  | { ok: true; def: LiveItemDef; power: number; effects: readonly LiveEffect[] }
  | { ok: false; reason: string };

export type LiveEnchantResult =
  | { ok: true; def: LiveItemDef; cost: number; charge: number }
  | { ok: false; reason: string; cost: number; capacity: number };

export type LiveApparatus = Readonly<Record<string, LiveItemDef | null>>;

/** The subset of src/rpg/RPG.ts `RPGSystem` the interface drives. */
export interface RpgLike extends System {
  readonly character: LiveCharacter;
  readonly knownIngredientEffects: number;
  stats(): Sheet;
  equip(uid: number): boolean;
  unequip(slot: LiveSlotId): boolean;
  consume(uid: number): boolean;
  useEnchantment(uid: number): boolean;
  repair(uid: number): boolean;
  identify(uid: number): readonly string[];
  createSpell(name: string, effects: readonly LiveEffect[]): LiveSpell | null;
  priceSpell(effects: readonly LiveEffect[]): { cost: number; lines: string[] };
  brewPotion(ingredientUids: readonly number[]): LiveBrewResult;
  apparatus(): LiveApparatus;
  enchantItem(
    itemUid: number,
    soulGemUid: number,
    effects: readonly LiveEffect[],
    kind: 'cast' | 'constant' | 'strike',
    name: string,
  ): LiveEnchantResult;
  rechargeItem(itemUid: number, soulGemUid: number): number;
  bestPicks(): LiveAttributeId[];
  levelUp(picks: readonly LiveAttributeId[]): { level: number } | null;
  /** Re-rolls the character. Everything downstream re-derives from this. */
  recreate(
    name: string,
    race: string,
    gender: string,
    birthsign: string,
    klass: LiveClass | string,
  ): void;
  buildClass(
    name: string,
    spec: LiveSpec,
    favored: readonly [LiveAttributeId, LiveAttributeId],
    major: readonly LiveSkillId[],
    minor: readonly LiveSkillId[],
  ): LiveClass | null;
}

/* ----------------------------------------------------------- quest layer */

export interface LiveJournalEntry {
  readonly day: number;
  readonly hour: number;
  readonly quest: string | null;
  readonly stage: number;
  readonly title: string;
  readonly text: string;
}

export interface LiveFactionRank {
  readonly name: string;
}

export interface LiveFaction {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly ranks: readonly LiveFactionRank[];
}

export interface LiveNpc {
  readonly id: string;
  readonly name: string;
  readonly race: string;
  readonly sex: string;
  readonly faction: string | null;
  readonly rank: number;
}

export interface LiveTalk {
  readonly npc: string;
  readonly greeting: string;
  readonly disposition: number;
  readonly topics: readonly string[];
}

export interface LiveAsk {
  readonly text: string;
  readonly learned: readonly string[];
}

export interface LivePersuasion {
  readonly kind: string;
  readonly success: boolean;
  readonly delta: number;
  readonly cost: number;
  readonly attacks: boolean;
  readonly text: string;
}

export interface LiveQuestDef {
  readonly id: string;
  readonly name: string;
}

/** The subset of src/quest/Quests.ts `QuestSystem` the interface drives. */
export interface QuestLike extends System {
  journal(): readonly LiveJournalEntry[];
  quests(): readonly LiveQuestDef[];
  questDef(id: string): LiveQuestDef | undefined;
  factions(): readonly LiveFaction[];
  rankName(f: string): string | null;
  promotionBlockers(f: string): readonly string[];
  tryPromote(f: string): boolean;
  join(f: string): boolean;
  knownTopics(): readonly string[];
  topicLabel(t: string): string;
  talk(npc: string): LiveTalk;
  ask(npc: string, topic: string): LiveAsk | null;
  persuade(npc: string, kind: string, bribe?: number): LivePersuasion;
  disposition(npc: string): number;
  npcs(): readonly LiveNpc[];
  npcDef(id: string): LiveNpc | undefined;
  npcLocation(id: string): string;
  readonly bounty: number;
}

/* ------------------------------------------------------------ item views */

/** Everything a row, a tooltip or a paperdoll cell needs about one stack. */
export interface ItemView {
  readonly uid: number;
  readonly defId: string;
  readonly name: string;
  readonly kind: string;
  readonly count: number;
  readonly weight: number;
  readonly value: number;
  readonly slot: LiveSlotId | null;
  readonly equippedIn: LiveSlotId | null;
  /** 0..1 wear, or -1 for things that do not wear out. */
  readonly condition: number;
  readonly maxCondition: number;
  readonly charge: number;
  readonly maxCharge: number;
  readonly enchantment: LiveEnchantment | null;
  readonly soul: number;
  readonly soulName: string | null;
  /** One line of the numbers that matter for this kind, from the real def. */
  readonly detail: string;
  readonly glyph: string;
  readonly shape: PreviewShape;
  readonly tint: number;
  readonly metal: number;
  readonly rough: number;
  readonly def: LiveItemDef;
}

/** The procedural preview meshes, owned by the previewer that builds them. */
export type PreviewShape = ShapeId;

/**
 * Presentation only: colour, roughness and which procedural mesh stands in for
 * an item in the preview box. The RPG layer has no notion of how anything
 * looks, so this table is the interface's own — but it is keyed off the real
 * material and weapon-type ids, so it describes the actual item rather than
 * substituting for it. An unmapped material falls through to plain iron and the
 * name and numbers are still the character's own.
 */
const MATERIAL_LOOK: Readonly<Record<string, { tint: number; metal: number; rough: number }>> = {
  fur: { tint: 0x6f5537, metal: 0.0, rough: 0.85 },
  netch: { tint: 0x9c8558, metal: 0.02, rough: 0.6 },
  chitin: { tint: 0xc0a878, metal: 0.05, rough: 0.45 },
  bonemold: { tint: 0xcbbb92, metal: 0.08, rough: 0.55 },
  iron: { tint: 0x9aa0a6, metal: 0.9, rough: 0.45 },
  steel: { tint: 0xb8bec6, metal: 0.95, rough: 0.28 },
  silver: { tint: 0xd8dce2, metal: 1.0, rough: 0.18 },
  dwarven: { tint: 0xb08d4f, metal: 0.95, rough: 0.3 },
  orcish: { tint: 0x6d7a53, metal: 0.9, rough: 0.35 },
  adamantium: { tint: 0x8fa3a8, metal: 0.95, rough: 0.25 },
  glass: { tint: 0x63c7b8, metal: 0.4, rough: 0.12 },
  ebony: { tint: 0x2a2b31, metal: 0.85, rough: 0.2 },
  daedric: { tint: 0x3a2320, metal: 0.9, rough: 0.22 },
};

const IRON_LOOK = { tint: 0x9aa0a6, metal: 0.9, rough: 0.45 };

/** Which procedural mesh stands in for each real weapon type. */
const WEAPON_SHAPE: Readonly<Record<string, PreviewShape>> = {
  dagger: 'dagger',
  tanto: 'dagger',
  shortsword: 'dagger',
  wakizashi: 'blade',
  longsword: 'blade',
  broadsword: 'blade',
  claymore: 'greatblade',
  'dai-katana': 'greatblade',
  warAxe: 'axe',
  battleAxe: 'axe',
  club: 'mace',
  mace: 'mace',
  warhammer: 'mace',
  staff: 'staff',
  spear: 'spear',
  halberd: 'spear',
  shortBow: 'bow',
  longBow: 'bow',
  crossbow: 'bow',
  dart: 'dagger',
  arrow: 'spear',
  bolt: 'spear',
};

const ARMOR_SHAPE: Readonly<Record<string, PreviewShape>> = {
  helm: 'helm',
  cuirass: 'cuirass',
  greaves: 'greaves',
  boots: 'boots',
  pauldron: 'pauldron',
  gauntlet: 'gauntlet',
  towerShield: 'shield',
  shield: 'shield',
  buckler: 'shield',
};

const SLOT_SHAPE: Readonly<Partial<Record<LiveSlotId, PreviewShape>>> = {
  leftRing: 'ring',
  rightRing: 'ring',
  amulet: 'amulet',
  belt: 'belt',
  shirt: 'cuirass',
  pants: 'greaves',
  skirt: 'greaves',
  robe: 'cuirass',
  shoes: 'boots',
};

const KIND_GLYPH: Readonly<Record<string, string>> = {
  weapon: '⚔',
  armor: '⛨',
  clothing: '👕',
  ingredient: '🌿',
  potion: '⚗',
  scroll: '📜',
  book: '📕',
  apparatus: '⚱',
  tool: '🔧',
  misc: '◈',
};

const WEAPON_GLYPH: Readonly<Record<string, string>> = {
  dagger: '🗡',
  tanto: '🗡',
  shortsword: '🗡',
  wakizashi: '🗡',
  dart: '🗡',
  warAxe: '🪓',
  battleAxe: '🪓',
  club: '🔨',
  mace: '🔨',
  warhammer: '🔨',
  staff: '🪄',
  spear: '🔱',
  halberd: '🔱',
  shortBow: '🏹',
  longBow: '🏹',
  crossbow: '🏹',
  arrow: '➶',
  bolt: '➶',
};

const MISC_GLYPH: Readonly<Record<string, string>> = {
  gold: '🪙',
  soulgem: '💎',
  light: '🕯',
  key: '🔑',
  junk: '◈',
};

function lookOf(def: LiveItemDef): { tint: number; metal: number; rough: number } {
  const m = def.material === undefined ? undefined : MATERIAL_LOOK[def.material];
  if (m !== undefined) return m;
  if (def.kind === 'potion') return { tint: 0x8f4a7a, metal: 0.0, rough: 0.15 };
  if (def.kind === 'ingredient') return { tint: 0x7f8f4a, metal: 0.0, rough: 0.7 };
  if (def.kind === 'book' || def.kind === 'scroll') return { tint: 0x8a5a33, metal: 0.0, rough: 0.75 };
  if (def.kind === 'clothing') return { tint: 0xa79372, metal: 0.0, rough: 0.8 };
  return IRON_LOOK;
}

function shapeOf(def: LiveItemDef): PreviewShape {
  if (def.kind === 'weapon' && def.type !== undefined) return WEAPON_SHAPE[def.type] ?? 'blade';
  if (def.kind === 'armor' && def.piece !== undefined) return ARMOR_SHAPE[def.piece] ?? 'cuirass';
  if (def.slot !== undefined) {
    const s = SLOT_SHAPE[def.slot];
    if (s !== undefined) return s;
  }
  if (def.kind === 'potion') return 'potion';
  if (def.kind === 'ingredient') return 'ingredient';
  if (def.kind === 'book') return 'book';
  if (def.kind === 'scroll') return 'scroll';
  if (def.kind === 'apparatus') return 'mortar';
  if (def.kind === 'tool') return 'lockpick';
  if (def.misc === 'soulgem') return 'soulgem';
  if (def.misc === 'gold') return 'coin';
  return 'ingredient';
}

function glyphOf(def: LiveItemDef): string {
  if (def.kind === 'weapon' && def.type !== undefined) return WEAPON_GLYPH[def.type] ?? '⚔';
  if (def.kind === 'misc' && def.misc !== undefined) return MISC_GLYPH[def.misc] ?? '◈';
  if (def.kind === 'armor' && def.piece === 'boots') return '👢';
  if (def.kind === 'armor' && def.piece === 'helm') return '⛑';
  return KIND_GLYPH[def.kind] ?? '◈';
}

function range(r: readonly [number, number] | undefined): string {
  if (r === undefined) return '—';
  return r[0] === r[1] ? String(r[1]) : `${r[0]}-${r[1]}`;
}

/** One line of the numbers that actually distinguish this item, off the real def. */
function detailOf(def: LiveItemDef): string {
  if (def.kind === 'weapon') {
    return `Chop ${range(def.chop)} · Slash ${range(def.slash)} · Thrust ${range(def.thrust)}`;
  }
  if (def.kind === 'armor') {
    const cls = def.armorClass === undefined ? '' : `${def.armorClass} · `;
    return `${cls}Armour ${Math.round(def.armor ?? 0)}`;
  }
  if (def.kind === 'apparatus') return `${def.apparatus ?? 'apparatus'} · quality ${(def.quality ?? 0).toFixed(2)}`;
  if (def.kind === 'tool') return `${def.tool ?? 'tool'} · quality ${(def.quality ?? 0).toFixed(2)}`;
  if (def.kind === 'misc' && def.misc === 'soulgem') return `Holds ${def.soulCapacity ?? 0} soul`;
  if (def.kind === 'book') return def.teaches === undefined ? 'A book' : `Teaches ${labelSkill(def.teaches)}`;
  return '';
}

export function labelSkill(id: string): string {
  const s = SKILL_LABELS[id as LiveSkillId];
  return s === undefined ? id : s.name;
}

/**
 * Effect ids arrive as the RPG layer's camelCase keys. Splitting them into
 * words is a display transform of the real id, so a badge or a sheet row names
 * the effect that is genuinely running rather than looking it up in a table of
 * the interface's own that could disagree with it.
 */
export function prettyEffectId(id: string): string {
  const spaced = id.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function labelAttribute(id: string): string {
  const a = ATTRIBUTE_LABELS[id as LiveAttributeId];
  return a === undefined ? id : a;
}

/**
 * Skill practice needed for the next point. This mirrors `progressRequired` in
 * src/rpg/Attributes.ts and exists only to draw the progress bar — every number
 * rendered as text comes from the character itself. Kept as one function so the
 * duplication is visible rather than smeared through the panel.
 */
function progressNeeded(level: number, kind: 'major' | 'minor' | 'misc', specialised: boolean): number {
  const classFactor = kind === 'major' ? 0.75 : kind === 'minor' ? 1 : 1.25;
  return (level + 1) * classFactor * (specialised ? 0.8 : 1);
}

/* ---------------------------------------------------------------- link */

/**
 * Resolves the live systems and hands panels normalised views of them. One
 * instance is owned by the UI system and shared by every panel; panels hold the
 * link, never a copy of what it returned.
 */
export class GameLink {
  private rpgSys: RpgLike | null = null;
  private questSys: QuestLike | null = null;

  /** Called every frame until both systems have registered. Cheap once bound. */
  resolve(ctx: Ctx): void {
    if (this.rpgSys === null) this.rpgSys = ctx.get<RpgLike>('rpg') ?? null;
    if (this.questSys === null) this.questSys = ctx.get<QuestLike>('quest') ?? null;
  }

  release(): void {
    this.rpgSys = null;
    this.questSys = null;
  }

  get rpg(): RpgLike | null {
    return this.rpgSys;
  }

  get quest(): QuestLike | null {
    return this.questSys;
  }

  /** True once a character exists to render. Panels show their empty state otherwise. */
  get bound(): boolean {
    return this.rpgSys !== null;
  }

  // ------------------------------------------------------------- character

  sheet(): Sheet | null {
    return this.rpgSys?.stats() ?? null;
  }

  character(): LiveCharacter | null {
    return this.rpgSys?.character ?? null;
  }

  /** 0..1 toward the next point in a skill, for the sheet's progress bars. */
  skillProgress(skill: LiveSkillId): number {
    const c = this.character();
    if (c === null) return 0;
    const banked = c.skillProgress[skill] ?? 0;
    const need = progressNeeded(
      this.rpgSys?.stats().skills[skill] ?? 0,
      c.classOf(skill),
      SKILL_LABELS[skill].spec === c.klass.spec,
    );
    return need <= 0 ? 0 : Math.min(1, banked / need);
  }

  // ------------------------------------------------------------ inventory

  /** Every stack in the character's pack, as view models. Never fabricated. */
  items(): ItemView[] {
    const c = this.character();
    if (c === null) return [];
    const inv = c.inventory;
    const equippedBy = new Map<number, LiveSlotId>();
    for (const [slot, uid] of inv.equipped) equippedBy.set(uid, slot);

    const out: ItemView[] = [];
    for (const stack of inv.stacks) {
      // A stack whose definition vanished (a table edit, a stale save) is
      // skipped rather than drawn with invented values.
      const def = inv.defOf(stack);
      if (def === undefined) continue;
      const look = lookOf(def);
      const maxCondition = def.maxCondition ?? -1;
      const ench = def.enchantment ?? null;
      out.push({
        uid: stack.uid,
        defId: stack.def,
        name: def.name,
        kind: def.kind,
        count: stack.count,
        weight: def.weight,
        value: itemWorth(def),
        slot: equipSlotOf(def),
        equippedIn: equippedBy.get(stack.uid) ?? null,
        condition: maxCondition > 0 ? Math.max(0, Math.min(1, stack.condition / maxCondition)) : -1,
        maxCondition,
        charge: stack.charge,
        maxCharge: ench?.charge ?? -1,
        enchantment: ench,
        soul: stack.soul,
        soulName: stack.soulName ?? null,
        detail: detailOf(def),
        glyph: glyphOf(def),
        shape: shapeOf(def),
        tint: look.tint,
        metal: look.metal,
        rough: look.rough,
        def,
      });
    }
    return out;
  }

  item(uid: number): ItemView | null {
    for (const v of this.items()) if (v.uid === uid) return v;
    return null;
  }

  /** What is worn in each slot right now, keyed by the RPG layer's slot ids. */
  worn(): Map<LiveSlotId, ItemView> {
    const out = new Map<LiveSlotId, ItemView>();
    for (const v of this.items()) if (v.equippedIn !== null) out.set(v.equippedIn, v);
    return out;
  }

  /** Delegates to the RPG system; the UI never moves an item itself. */
  equip(uid: number): boolean {
    return this.rpgSys?.equip(uid) ?? false;
  }

  unequip(uid: number): boolean {
    const rpg = this.rpgSys;
    if (rpg === null) return false;
    for (const [slot, u] of rpg.character.inventory.equipped) {
      if (u === uid) return rpg.unequip(slot);
    }
    return false;
  }

  unequipSlot(slot: LiveSlotId): boolean {
    return this.rpgSys?.unequip(slot) ?? false;
  }

  /** Drink, eat, read or fire an enchantment — whichever the item actually is. */
  use(uid: number): boolean {
    const rpg = this.rpgSys;
    if (rpg === null) return false;
    if (rpg.consume(uid)) return true;
    return rpg.useEnchantment(uid);
  }

  repair(uid: number): boolean {
    return this.rpgSys?.repair(uid) ?? false;
  }

  /**
   * Puts a real item into the real pack. The id must name a row the RPG layer's
   * registry knows; an unknown id adds nothing rather than conjuring a stand-in.
   */
  give(defId: string, count = 1): ItemView | null {
    const stack = this.rpgSys?.character.inventory.addById(defId, count) ?? null;
    return stack === null ? null : this.item(stack.uid);
  }

  /** What the alchemist can currently read off an ingredient, from the RPG layer. */
  identify(uid: number): readonly string[] {
    return this.rpgSys?.identify(uid) ?? [];
  }

  /**
   * Dropping is removal from the pack. There is no world-container system to
   * hand the stack to yet, so this is honest about what it does: the item is
   * gone from the character, and nothing pretends a sack appeared on the floor.
   */
  discard(uid: number, count: number): boolean {
    const rpg = this.rpgSys;
    if (rpg === null) return false;
    for (const [slot, u] of rpg.character.inventory.equipped) {
      if (u === uid) rpg.unequip(slot);
    }
    return rpg.character.inventory.remove(uid, count);
  }

  // -------------------------------------------------------------- effects

  /**
   * Effect ids this character may build a spell from: Morrowind's rule, that
   * you can only compose from magic you already know. Drawn from the live
   * spellbook, so the picker cannot offer something the character never saw.
   */
  knownEffects(): string[] {
    const c = this.character();
    if (c === null) return [];
    const seen = new Set<string>();
    for (const sp of c.spells.known()) for (const e of sp.effects) seen.add(e.effect);
    return [...seen].sort();
  }

  /**
   * The real name and shape of an effect, obtained by pricing a probe instance
   * through the RPG layer. `priceSpell` runs the authoritative describe/
   * normalise pair, so the label, the self-only rule and whether magnitude,
   * duration and area count are all answered by the system that owns them —
   * the UI keeps no effect table of its own.
   */
  describeEffectId(id: string): EffectFacts {
    const rpg = this.rpgSys;
    const fallback: EffectFacts = {
      id,
      label: id,
      usesMagnitude: true,
      usesDuration: true,
      usesArea: true,
      selfOnly: false,
      usesAttribute: false,
      usesSkill: false,
    };
    if (rpg === null) return fallback;
    const probe: LiveEffect = { effect: id, magMin: 1, magMax: 1, duration: 1, area: 1, range: 'target' };
    const line = rpg.priceSpell([probe]).lines[0];
    if (line === undefined) return fallback;
    // Whether an effect takes an attribute or a skill is answered by asking for
    // two different ones and seeing whether the system's own description
    // changed. Anything it ignores, it normalises away.
    const withLuck = rpg.priceSpell([{ ...probe, attribute: 'luck' }]).lines[0];
    const withSneak = rpg.priceSpell([{ ...probe, skill: 'sneak' }]).lines[0];
    const usesMagnitude = line.includes(' 1 pts');
    const usesDuration = line.includes('for 1s');
    const usesArea = line.includes('in 1m');
    const selfOnly = line.endsWith('on Self');
    const cut = line.search(/ 1 pts| for 1s| in 1m| on (Self|Touch|Target)/);
    return {
      id,
      label: cut > 0 ? line.slice(0, cut) : line,
      usesMagnitude,
      usesDuration,
      usesArea,
      selfOnly,
      usesAttribute: withLuck !== line,
      usesSkill: withSneak !== line,
    };
  }

  describeEffect(e: LiveEffect): string {
    return this.rpgSys?.priceSpell([e]).lines[0] ?? e.effect;
  }

  priceSpell(effects: readonly LiveEffect[]): { cost: number; lines: string[] } {
    return this.rpgSys?.priceSpell(effects) ?? { cost: 0, lines: [] };
  }

  // -------------------------------------------------------------- journal

  journal(): readonly LiveJournalEntry[] {
    return this.questSys?.journal() ?? [];
  }

  factions(): readonly LiveFaction[] {
    return this.questSys?.factions() ?? [];
  }

  rankName(id: string): string | null {
    return this.questSys?.rankName(id) ?? null;
  }

  knownTopics(): readonly string[] {
    return this.questSys?.knownTopics() ?? [];
  }

  topicLabel(t: string): string {
    return this.questSys?.topicLabel(t) ?? t;
  }
}

export interface EffectFacts {
  readonly id: string;
  readonly label: string;
  readonly usesMagnitude: boolean;
  readonly usesDuration: boolean;
  readonly usesArea: boolean;
  readonly selfOnly: boolean;
  readonly usesAttribute: boolean;
  readonly usesSkill: boolean;
}

/**
 * Which slot an item occupies, mirroring `equipSlot` in src/rpg/Items.ts:
 * stackable weapons are ammunition, everything else that can be worn carries
 * its own slot.
 */
function equipSlotOf(def: LiveItemDef): LiveSlotId | null {
  if (def.kind === 'weapon') return def.stackable === true ? 'ammo' : 'weapon';
  if (def.slot !== undefined) return def.slot;
  return null;
}

/** Value including the enchantment premium, mirroring `itemValue` in src/rpg/Items.ts. */
function itemWorth(def: LiveItemDef): number {
  const ench = def.enchantment;
  if (ench === undefined) return def.value;
  return Math.round(def.value + ench.cost * (ench.kind === 'constant' ? 1.2 : 3.4));
}

/**
 * Where each real slot sits on the paperdoll, as percentages of the doll box.
 * All twenty slots the RPG layer defines are here — the figure shows what the
 * character can actually wear, not a reduced set the interface invented.
 */
export const DOLL_LAYOUT: readonly {
  readonly slot: LiveSlotId;
  readonly ghost: string;
  readonly at: readonly [number, number];
}[] = [
  { slot: 'head', ghost: '⛑', at: [50, 2] },
  { slot: 'amulet', ghost: '⚭', at: [28, 13] },
  { slot: 'robe', ghost: '🧥', at: [72, 13] },
  { slot: 'leftPauldron', ghost: '◤', at: [8, 24] },
  { slot: 'cuirass', ghost: '⛊', at: [50, 24] },
  { slot: 'rightPauldron', ghost: '◥', at: [92, 24] },
  { slot: 'shirt', ghost: '👕', at: [28, 35] },
  { slot: 'belt', ghost: '➰', at: [72, 35] },
  { slot: 'leftGauntlet', ghost: '✋', at: [8, 46] },
  { slot: 'greaves', ghost: '⌷', at: [50, 46] },
  { slot: 'rightGauntlet', ghost: '🤚', at: [92, 46] },
  { slot: 'pants', ghost: '👖', at: [28, 57] },
  { slot: 'skirt', ghost: '⌆', at: [72, 57] },
  { slot: 'weapon', ghost: '⚔', at: [8, 68] },
  { slot: 'boots', ghost: '👢', at: [50, 68] },
  { slot: 'shield', ghost: '⛨', at: [92, 68] },
  { slot: 'shoes', ghost: '👞', at: [28, 79] },
  { slot: 'ammo', ghost: '➶', at: [72, 79] },
  { slot: 'leftRing', ghost: '○', at: [8, 90] },
  { slot: 'rightRing', ghost: '○', at: [92, 90] },
];
