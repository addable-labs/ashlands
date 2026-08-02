/**
 * The eight attributes and twenty-seven skills, and the arithmetic that binds
 * them. Everything here is pure data + pure functions so the same tables drive
 * character creation, the level-up screen, combat resolution and save/load.
 */

export const ATTRIBUTES = [
  'strength',
  'intelligence',
  'willpower',
  'agility',
  'speed',
  'endurance',
  'personality',
  'luck',
] as const;
export type AttributeId = (typeof ATTRIBUTES)[number];
export type AttributeSet = Record<AttributeId, number>;

export const ATTRIBUTE_NAMES: Readonly<Record<AttributeId, string>> = {
  strength: 'Strength',
  intelligence: 'Intelligence',
  willpower: 'Willpower',
  agility: 'Agility',
  speed: 'Speed',
  endurance: 'Endurance',
  personality: 'Personality',
  luck: 'Luck',
};

export function zeroAttributes(): AttributeSet {
  return {
    strength: 0,
    intelligence: 0,
    willpower: 0,
    agility: 0,
    speed: 0,
    endurance: 0,
    personality: 0,
    luck: 0,
  };
}

export function cloneAttributes(a: Readonly<AttributeSet>): AttributeSet {
  return { ...a };
}

export const SPECIALIZATIONS = ['combat', 'magic', 'stealth'] as const;
export type Specialization = (typeof SPECIALIZATIONS)[number];

/** Canonical order: nine combat, nine magic, nine stealth. */
export const SKILLS = [
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
export type SkillId = (typeof SKILLS)[number];
export type SkillSet = Record<SkillId, number>;

/**
 * Which of a skill's four use slots is being exercised. Morrowind stores four
 * distinct use values per skill because "hit something with an axe" and "block
 * a blow with an axe-arm" are not worth the same practice.
 */
export type UseKind = 0 | 1 | 2 | 3;

export interface SkillDef {
  readonly name: string;
  readonly attribute: AttributeId;
  readonly spec: Specialization;
  /** Progress granted per use, indexed by UseKind. */
  readonly use: readonly [number, number, number, number];
  /** What each use slot means. Keeps call sites legible and self-documenting. */
  readonly useNames: readonly [string, string, string, string];
}

const NO_USE = ['-', '-', '-', '-'] as const;

export const SKILL_DEFS: Readonly<Record<SkillId, SkillDef>> = {
  block: {
    name: 'Block',
    attribute: 'agility',
    spec: 'combat',
    use: [1, 0, 0, 0],
    useNames: ['blocked a blow', '-', '-', '-'],
  },
  armorer: {
    name: 'Armorer',
    attribute: 'strength',
    spec: 'combat',
    use: [1, 0, 0, 0],
    useNames: ['repaired an item', '-', '-', '-'],
  },
  mediumArmor: {
    name: 'Medium Armor',
    attribute: 'endurance',
    spec: 'combat',
    use: [1, 0, 0, 0],
    useNames: ['took a hit in medium armour', '-', '-', '-'],
  },
  heavyArmor: {
    name: 'Heavy Armor',
    attribute: 'endurance',
    spec: 'combat',
    use: [1, 0, 0, 0],
    useNames: ['took a hit in heavy armour', '-', '-', '-'],
  },
  bluntWeapon: {
    name: 'Blunt Weapon',
    attribute: 'strength',
    spec: 'combat',
    use: [0.5, 1, 1.5, 0],
    useNames: ['swung', 'struck', 'struck for full damage', '-'],
  },
  longBlade: {
    name: 'Long Blade',
    attribute: 'strength',
    spec: 'combat',
    use: [0.5, 1, 1.5, 0],
    useNames: ['swung', 'struck', 'struck for full damage', '-'],
  },
  axe: {
    name: 'Axe',
    attribute: 'strength',
    spec: 'combat',
    use: [0.5, 1, 1.5, 0],
    useNames: ['swung', 'struck', 'struck for full damage', '-'],
  },
  spear: {
    name: 'Spear',
    attribute: 'endurance',
    spec: 'combat',
    use: [0.5, 1, 1.5, 0],
    useNames: ['thrust', 'struck', 'struck for full damage', '-'],
  },
  athletics: {
    name: 'Athletics',
    attribute: 'speed',
    spec: 'combat',
    // Per second of running / swimming, so these are deliberately tiny.
    use: [0.02, 0.02, 0, 0],
    useNames: ['ran a second', 'swam a second', '-', '-'],
  },
  enchant: {
    name: 'Enchant',
    attribute: 'intelligence',
    spec: 'magic',
    use: [1, 2, 1, 1],
    useNames: ['recharged an item', 'enchanted an item', 'used an enchantment', 'captured a soul'],
  },
  destruction: {
    name: 'Destruction',
    attribute: 'willpower',
    spec: 'magic',
    use: [1, 0, 0, 0],
    useNames: ['cast a Destruction spell', '-', '-', '-'],
  },
  alteration: {
    name: 'Alteration',
    attribute: 'willpower',
    spec: 'magic',
    use: [1, 0, 0, 0],
    useNames: ['cast an Alteration spell', '-', '-', '-'],
  },
  illusion: {
    name: 'Illusion',
    attribute: 'personality',
    spec: 'magic',
    use: [1, 0, 0, 0],
    useNames: ['cast an Illusion spell', '-', '-', '-'],
  },
  conjuration: {
    name: 'Conjuration',
    attribute: 'intelligence',
    spec: 'magic',
    use: [1, 0, 0, 0],
    useNames: ['cast a Conjuration spell', '-', '-', '-'],
  },
  mysticism: {
    name: 'Mysticism',
    attribute: 'willpower',
    spec: 'magic',
    use: [1, 0, 0, 0],
    useNames: ['cast a Mysticism spell', '-', '-', '-'],
  },
  restoration: {
    name: 'Restoration',
    attribute: 'willpower',
    spec: 'magic',
    use: [1, 0, 0, 0],
    useNames: ['cast a Restoration spell', '-', '-', '-'],
  },
  alchemy: {
    name: 'Alchemy',
    attribute: 'intelligence',
    spec: 'magic',
    // Gathering is how a field alchemist learns a reagent, so picking counts —
    // less than brewing, because handling a plant is not understanding it.
    use: [1, 2, 0.5, 0],
    useNames: ['brewed a potion', 'ate an ingredient', 'gathered a reagent', '-'],
  },
  unarmored: {
    name: 'Unarmored',
    attribute: 'speed',
    spec: 'magic',
    use: [1, 0, 0, 0],
    useNames: ['took a hit unarmoured', '-', '-', '-'],
  },
  security: {
    name: 'Security',
    attribute: 'intelligence',
    spec: 'stealth',
    use: [1, 1, 0, 0],
    useNames: ['picked a lock', 'disarmed a trap', '-', '-'],
  },
  sneak: {
    name: 'Sneak',
    attribute: 'agility',
    spec: 'stealth',
    use: [1, 1.5, 0, 0],
    useNames: ['moved unseen', 'picked a pocket', '-', '-'],
  },
  acrobatics: {
    name: 'Acrobatics',
    attribute: 'strength',
    spec: 'stealth',
    use: [0.5, 1, 0, 0],
    useNames: ['jumped', 'fell and landed well', '-', '-'],
  },
  lightArmor: {
    name: 'Light Armor',
    attribute: 'agility',
    spec: 'stealth',
    use: [1, 0, 0, 0],
    useNames: ['took a hit in light armour', '-', '-', '-'],
  },
  shortBlade: {
    name: 'Short Blade',
    attribute: 'speed',
    spec: 'stealth',
    use: [0.5, 1, 1.5, 0],
    useNames: ['swung', 'struck', 'struck for full damage', '-'],
  },
  marksman: {
    name: 'Marksman',
    attribute: 'agility',
    spec: 'stealth',
    use: [0.5, 1, 1.5, 0],
    useNames: ['loosed', 'struck', 'struck for full damage', '-'],
  },
  mercantile: {
    name: 'Mercantile',
    attribute: 'personality',
    spec: 'stealth',
    use: [1, 1, 0, 0],
    useNames: ['haggled', 'bartered', '-', '-'],
  },
  speechcraft: {
    name: 'Speechcraft',
    attribute: 'personality',
    spec: 'stealth',
    use: [1, 1, 1, 0],
    useNames: ['persuaded', 'bribed', 'intimidated', '-'],
  },
  handToHand: {
    name: 'Hand-to-hand',
    attribute: 'speed',
    spec: 'stealth',
    use: [0.5, 1, 1.5, 0],
    useNames: ['swung', 'struck', 'knocked out', '-'],
  },
};

export function zeroSkills(): SkillSet {
  const out = {} as SkillSet;
  for (const s of SKILLS) out[s] = 0;
  return out;
}

/** Skills whose training the character's class rewards. */
export type SkillClassKind = 'major' | 'minor' | 'misc';

/**
 * Practice needed to advance a skill by one point. Higher skill costs more,
 * class focus costs less, and a specialisation match costs less still — this
 * is why a Nord who fights with an axe is an axeman by level five and a Nord
 * who dabbles in Alchemy is still a bad alchemist at level twenty.
 */
export const CLASS_PROGRESS_FACTOR: Readonly<Record<SkillClassKind, number>> = {
  major: 0.75,
  minor: 1.0,
  misc: 1.25,
};
export const SPECIALIZATION_PROGRESS_FACTOR = 0.8;

export function progressRequired(
  skillLevel: number,
  kind: SkillClassKind,
  specialised: boolean,
): number {
  const spec = specialised ? SPECIALIZATION_PROGRESS_FACTOR : 1;
  return (skillLevel + 1) * CLASS_PROGRESS_FACTOR[kind] * spec;
}

/**
 * How many skill-ups a governing attribute has banked, mapped to the raise you
 * are offered at level-up. This table is the reason Morrowind characters are
 * planned rather than accumulated.
 */
export function attributeMultiplier(gains: number): 1 | 2 | 3 | 4 | 5 {
  if (gains >= 10) return 5;
  if (gains >= 8) return 4;
  if (gains >= 5) return 3;
  if (gains >= 2) return 2;
  return 1;
}

/** Skill-ups in major/minor skills needed for a level. */
export const LEVEL_UP_SKILL_COUNT = 10;
/** Attributes you may raise per level. */
export const LEVEL_UP_PICKS = 3;
/** Nothing raises Luck faster than one point a level. It is luck. */
export const LUCK_MAX_MULTIPLIER = 1;

export const ATTRIBUTE_CAP = 100;
export const SKILL_CAP = 100;

/**
 * Fatigue scales nearly every roll in the game: 1.25x when fresh, 0.75x when
 * spent. An exhausted character misses, fumbles spells, and gets fleeced.
 */
export const FATIGUE_BASE = 1.25;
export const FATIGUE_MULT = 0.5;

export function fatigueTerm(current: number, max: number): number {
  const n = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  return FATIGUE_BASE - FATIGUE_MULT * (1 - n);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export { NO_USE };
