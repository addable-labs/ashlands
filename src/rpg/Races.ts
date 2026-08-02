/**
 * Ten races and thirteen birthsigns. Race decides where you start; birthsign
 * decides what magic costs you. Neither is ever re-rolled, and nothing in the
 * world scales to compensate for a bad pick — that is the point.
 */
import type { AttributeId, AttributeSet, SkillId } from './Attributes';
import type { EffectInstance } from './Effects';

export type Gender = 'male' | 'female';

/**
 * A racial or birthsign gift. `ability` is always on and costs nothing;
 * `power` is once per day; `spell` is a real spell added to the spellbook.
 */
export interface Innate {
  readonly id: string;
  readonly name: string;
  readonly kind: 'ability' | 'power' | 'spell';
  readonly effects: readonly EffectInstance[];
}

export const RACES = [
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
export type RaceId = (typeof RACES)[number];

export interface RaceDef {
  readonly name: string;
  readonly plural: string;
  readonly male: Readonly<AttributeSet>;
  readonly female: Readonly<AttributeSet>;
  readonly skills: Readonly<Partial<Record<SkillId, number>>>;
  readonly innate: readonly Innate[];
  /** Metres; feeds the avatar and the camera height when a body agent wires it. */
  readonly height: readonly [number, number];
  readonly beast: boolean;
}

function attrs(
  strength: number,
  intelligence: number,
  willpower: number,
  agility: number,
  speed: number,
  endurance: number,
  personality: number,
  luck: number,
): AttributeSet {
  return { strength, intelligence, willpower, agility, speed, endurance, personality, luck };
}

const inst = (
  effect: EffectInstance['effect'],
  magMin: number,
  magMax: number,
  duration: number,
  range: EffectInstance['range'] = 'self',
  extra: Partial<EffectInstance> = {},
): EffectInstance => ({ effect, magMin, magMax, duration, area: 0, range, ...extra });

export const RACE_DEFS: Readonly<Record<RaceId, RaceDef>> = {
  altmer: {
    name: 'Altmer',
    plural: 'High Elves',
    male: attrs(30, 50, 40, 40, 30, 40, 40, 40),
    female: attrs(30, 50, 40, 40, 40, 30, 40, 40),
    skills: { enchant: 10, alteration: 5, conjuration: 5, destruction: 5, illusion: 5, mysticism: 5 },
    innate: [
      { id: 'highborn', name: 'Highborn', kind: 'power', effects: [inst('fortifyMagicka', 50, 50, 60)] },
      { id: 'altmerFrailty', name: 'Weakness to Magicka', kind: 'ability', effects: [inst('weaknessToMagicka', 25, 25, 0)] },
      { id: 'altmerElement', name: 'Elemental Frailty', kind: 'ability', effects: [inst('weaknessToFire', 25, 25, 0), inst('weaknessToFrost', 25, 25, 0), inst('weaknessToShock', 25, 25, 0)] },
      { id: 'altmerResistDisease', name: 'Resist Disease', kind: 'ability', effects: [inst('resistCommonDisease', 75, 75, 0)] },
    ],
    height: [1.86, 1.82],
    beast: false,
  },
  argonian: {
    name: 'Argonian',
    plural: 'Argonians',
    male: attrs(40, 40, 30, 50, 50, 30, 30, 40),
    female: attrs(40, 50, 40, 40, 40, 30, 30, 40),
    skills: { alchemy: 5, athletics: 15, illusion: 5, mediumArmor: 5, mysticism: 5, spear: 5, unarmored: 5 },
    innate: [
      { id: 'argonianBreathing', name: 'Water Breathing', kind: 'ability', effects: [inst('waterBreathing', 0, 0, 0)] },
      { id: 'argonianImmunity', name: 'Resist Disease', kind: 'ability', effects: [inst('resistCommonDisease', 75, 75, 0), inst('resistPoison', 100, 100, 0)] },
    ],
    height: [1.76, 1.72],
    beast: true,
  },
  bosmer: {
    name: 'Bosmer',
    plural: 'Wood Elves',
    male: attrs(30, 40, 30, 50, 50, 30, 40, 40),
    female: attrs(30, 40, 30, 50, 50, 30, 40, 40),
    skills: { marksman: 15, sneak: 10, lightArmor: 10, acrobatics: 5, alchemy: 5 },
    innate: [
      { id: 'beastTongue', name: 'Beast Tongue', kind: 'power', effects: [inst('commandCreature', 1, 20, 60, 'touch')] },
      { id: 'bosmerResistDisease', name: 'Resist Disease', kind: 'ability', effects: [inst('resistCommonDisease', 75, 75, 0)] },
    ],
    height: [1.68, 1.64],
    beast: false,
  },
  breton: {
    name: 'Breton',
    plural: 'Bretons',
    male: attrs(40, 50, 50, 30, 30, 30, 40, 40),
    female: attrs(30, 50, 50, 30, 40, 30, 40, 40),
    skills: { conjuration: 10, mysticism: 10, restoration: 10, alchemy: 5, alteration: 5, illusion: 5 },
    innate: [
      { id: 'dragonSkin', name: 'Dragon Skin', kind: 'power', effects: [inst('shield', 50, 50, 60)] },
      { id: 'bretonResistMagicka', name: 'Resist Magicka', kind: 'ability', effects: [inst('resistMagicka', 50, 50, 0)] },
    ],
    height: [1.78, 1.74],
    beast: false,
  },
  dunmer: {
    name: 'Dunmer',
    plural: 'Dark Elves',
    male: attrs(40, 40, 30, 40, 50, 40, 30, 40),
    female: attrs(40, 40, 30, 40, 50, 30, 40, 40),
    skills: { athletics: 5, destruction: 10, longBlade: 10, marksman: 5, mysticism: 5, shortBlade: 10, lightArmor: 5 },
    innate: [
      { id: 'ancestorGuardian', name: 'Ancestor Guardian', kind: 'power', effects: [inst('summonAncestralGhost', 0, 0, 60)] },
      { id: 'dunmerResistFire', name: 'Resist Fire', kind: 'ability', effects: [inst('resistFire', 75, 75, 0)] },
    ],
    height: [1.80, 1.76],
    beast: false,
  },
  imperial: {
    name: 'Imperial',
    plural: 'Imperials',
    male: attrs(40, 40, 30, 30, 40, 40, 50, 40),
    female: attrs(40, 40, 40, 30, 30, 40, 50, 40),
    skills: { speechcraft: 10, mercantile: 10, bluntWeapon: 5, handToHand: 5, longBlade: 5, lightArmor: 5 },
    innate: [
      { id: 'voiceOfEmperor', name: 'Voice of the Emperor', kind: 'power', effects: [inst('charm', 50, 50, 30, 'touch')] },
      { id: 'starOfWest', name: 'Star of the West', kind: 'power', effects: [inst('absorbFatigue', 200, 200, 0, 'touch')] },
    ],
    height: [1.79, 1.75],
    beast: false,
  },
  khajiit: {
    name: 'Khajiit',
    plural: 'Khajiit',
    male: attrs(40, 40, 30, 50, 40, 30, 40, 40),
    female: attrs(30, 40, 30, 50, 40, 40, 40, 40),
    skills: { acrobatics: 15, athletics: 5, handToHand: 5, lightArmor: 5, security: 5, shortBlade: 5, sneak: 5 },
    innate: [
      { id: 'eyeOfNight', name: 'Eye of Night', kind: 'power', effects: [inst('nightEye', 50, 50, 30)] },
      { id: 'eyeOfFear', name: 'Eye of Fear', kind: 'power', effects: [inst('demoralizeHumanoid', 1, 100, 30, 'touch')] },
    ],
    height: [1.74, 1.70],
    beast: true,
  },
  nord: {
    name: 'Nord',
    plural: 'Nords',
    male: attrs(50, 30, 40, 30, 40, 50, 30, 40),
    female: attrs(50, 30, 40, 40, 40, 40, 30, 40),
    skills: { axe: 10, bluntWeapon: 10, heavyArmor: 10, longBlade: 5, mediumArmor: 5, spear: 5 },
    innate: [
      { id: 'thunderFist', name: 'Thunder Fist', kind: 'power', effects: [inst('shockDamage', 20, 20, 0, 'touch')] },
      { id: 'woad', name: 'Woad', kind: 'power', effects: [inst('shield', 30, 30, 60)] },
      { id: 'nordResist', name: 'Nordic Hardiness', kind: 'ability', effects: [inst('resistFrost', 100, 100, 0), inst('resistShock', 50, 50, 0)] },
    ],
    height: [1.90, 1.84],
    beast: false,
  },
  orc: {
    name: 'Orc',
    plural: 'Orsimer',
    male: attrs(45, 30, 50, 35, 30, 50, 30, 40),
    female: attrs(45, 40, 45, 35, 30, 50, 25, 40),
    skills: { armorer: 10, block: 10, heavyArmor: 10, mediumArmor: 10, axe: 5, bluntWeapon: 5 },
    innate: [
      { id: 'berserk', name: 'Berserk', kind: 'power', effects: [inst('fortifyAttribute', 20, 20, 60, 'self', { attribute: 'strength' }), inst('fortifyFatigue', 100, 100, 60), inst('drainAttribute', 100, 100, 60, 'self', { attribute: 'agility' })] },
      { id: 'orcResistMagicka', name: 'Resist Magicka', kind: 'ability', effects: [inst('resistMagicka', 25, 25, 0)] },
    ],
    height: [1.92, 1.86],
    beast: false,
  },
  redguard: {
    name: 'Redguard',
    plural: 'Redguards',
    male: attrs(50, 30, 30, 40, 40, 50, 30, 40),
    female: attrs(40, 30, 30, 40, 40, 50, 40, 40),
    skills: { axe: 5, bluntWeapon: 10, heavyArmor: 5, longBlade: 15, mediumArmor: 5, shortBlade: 5 },
    innate: [
      { id: 'adrenalineRush', name: 'Adrenaline Rush', kind: 'power', effects: [inst('fortifyAttribute', 50, 50, 60, 'self', { attribute: 'strength' }), inst('fortifyAttribute', 50, 50, 60, 'self', { attribute: 'agility' }), inst('fortifyAttribute', 50, 50, 60, 'self', { attribute: 'endurance' }), inst('fortifyHealth', 25, 25, 60)] },
      { id: 'redguardResist', name: 'Resist Poison and Disease', kind: 'ability', effects: [inst('resistPoison', 75, 75, 0), inst('resistCommonDisease', 75, 75, 0)] },
    ],
    height: [1.84, 1.80],
    beast: false,
  },
};

export const BIRTHSIGNS = [
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
export type BirthsignId = (typeof BIRTHSIGNS)[number];

export interface BirthsignDef {
  readonly name: string;
  readonly blurb: string;
  /** Multiplies Intelligence to give maximum magicka. */
  readonly magickaMult: number;
  /** Atronachs eat magic instead of regenerating it. */
  readonly magickaRegen: number;
  readonly innate: readonly Innate[];
}

export const BIRTHSIGN_DEFS: Readonly<Record<BirthsignId, BirthsignDef>> = {
  warrior: {
    name: 'The Warrior',
    blurb: 'The Warrior is the first Guardian Constellation, and protects his charges during their hard tasks.',
    magickaMult: 1,
    magickaRegen: 1,
    innate: [
      { id: 'warwind', name: "Warwind", kind: 'power', effects: [inst('fortifyAttribute', 10, 10, 60, 'self', { attribute: 'agility' }), inst('fortifyAttribute', 10, 10, 60, 'self', { attribute: 'strength' })] },
    ],
  },
  mage: {
    name: 'The Mage',
    blurb: 'The Mage is a Guardian Constellation whose Season is the height of Sun. Her Charges are more adept at all forms of magic.',
    magickaMult: 1.5,
    magickaRegen: 1,
    innate: [],
  },
  thief: {
    name: 'The Thief',
    blurb: 'The Thief is the last Guardian Constellation. Those born under her sign are hard to catch and harder to kill.',
    magickaMult: 1,
    magickaRegen: 1,
    innate: [
      { id: 'akaviriDanger', name: 'Akaviri Danger-Sense', kind: 'ability', effects: [inst('sanctuary', 10, 10, 0)] },
    ],
  },
  serpent: {
    name: 'The Serpent',
    blurb: 'The Serpent wanders the heavens and has no season. Those born under it are the blessed and the cursed.',
    magickaMult: 1,
    magickaRegen: 1,
    innate: [
      { id: 'starCursed', name: 'Star-Cursed', kind: 'power', effects: [inst('damageHealth', 100, 100, 0, 'touch'), inst('poison', 3, 3, 30, 'touch'), inst('curePoison', 0, 0, 0)] },
    ],
  },
  lady: {
    name: 'The Lady',
    blurb: "The Lady's Charges are more good-natured and hale than the common run.",
    magickaMult: 1,
    magickaRegen: 1,
    innate: [
      { id: 'ladysFavour', name: "Lady's Favour", kind: 'ability', effects: [inst('fortifyAttribute', 25, 25, 0, 'self', { attribute: 'personality' })] },
      { id: 'ladysGrace', name: "Lady's Grace", kind: 'ability', effects: [inst('fortifyAttribute', 25, 25, 0, 'self', { attribute: 'endurance' })] },
    ],
  },
  steed: {
    name: 'The Steed',
    blurb: 'The Steed is a Charioteer Constellation. Her Charges are impatient and quick of foot.',
    magickaMult: 1,
    magickaRegen: 1,
    innate: [
      { id: 'charioteer', name: 'Charioteer', kind: 'ability', effects: [inst('fortifyAttribute', 25, 25, 0, 'self', { attribute: 'speed' })] },
    ],
  },
  lord: {
    name: 'The Lord',
    blurb: "The Lord's Season is Evening Star, first month of the year. His Charges heal quickly, and burn easily.",
    magickaMult: 1,
    magickaRegen: 1,
    innate: [
      { id: 'bloodOfNorth', name: 'Blood of the North', kind: 'power', effects: [inst('restoreHealth', 20, 20, 5)] },
      { id: 'trollKin', name: 'Trollkin', kind: 'ability', effects: [inst('weaknessToFire', 100, 100, 0)] },
    ],
  },
  apprentice: {
    name: 'The Apprentice',
    blurb: "The Apprentice's Charges have a special affinity for magic of all kinds, but are more vulnerable to magical attack.",
    magickaMult: 1.5,
    magickaRegen: 1,
    innate: [
      { id: 'elfborn', name: 'Elfborn', kind: 'ability', effects: [inst('weaknessToMagicka', 100, 100, 0)] },
    ],
  },
  atronach: {
    name: 'The Atronach',
    blurb: 'Those born under the Atronach are natural sorcerers with deep reserves of magicka, but they cannot regenerate it and must drink it from the spells of others.',
    magickaMult: 2,
    // The trade-off is the entire character build. Do not soften it.
    magickaRegen: 0,
    innate: [
      { id: 'wombstone', name: 'Wombstone', kind: 'ability', effects: [inst('spellAbsorption', 50, 50, 0)] },
      { id: 'stunted', name: 'Stunted Magicka', kind: 'ability', effects: [] },
    ],
  },
  ritual: {
    name: 'The Ritual',
    blurb: "The Ritual's Charges have a variety of abilities depending on the aspects of the moons and the Divines.",
    magickaMult: 1,
    magickaRegen: 1,
    innate: [
      { id: 'blessedWord', name: 'Blessed Word', kind: 'power', effects: [inst('turnUndead', 100, 100, 30, 'touch')] },
      { id: 'blessedTouch', name: 'Blessed Touch', kind: 'power', effects: [inst('restoreHealth', 100, 100, 1, 'touch')] },
    ],
  },
  lover: {
    name: 'The Lover',
    blurb: "The Lover's Charges are graceful and passionate.",
    magickaMult: 1,
    magickaRegen: 1,
    innate: [
      { id: 'moonAndStar', name: 'Mooncalf', kind: 'ability', effects: [inst('fortifyAttribute', 25, 25, 0, 'self', { attribute: 'agility' })] },
      { id: 'loversKiss', name: "Lover's Kiss", kind: 'power', effects: [inst('paralyze', 0, 0, 60, 'touch'), inst('damageFatigue', 200, 200, 0)] },
    ],
  },
  shadow: {
    name: 'The Shadow',
    blurb: 'The Shadow grants her Charges the power to hide in shadows from their enemies.',
    magickaMult: 1,
    magickaRegen: 1,
    innate: [
      { id: 'moonshadow', name: 'Moonshadow', kind: 'power', effects: [inst('chameleon', 100, 100, 60)] },
    ],
  },
  tower: {
    name: 'The Tower',
    blurb: 'The Tower grants its Charges the power to open locks and to find hidden things.',
    magickaMult: 1,
    magickaRegen: 1,
    innate: [
      { id: 'beggarsNose', name: "Beggar's Nose", kind: 'power', effects: [inst('detectKey', 100, 100, 30)] },
      { id: 'towerKey', name: 'Tower Key', kind: 'power', effects: [inst('open', 50, 50, 0, 'touch')] },
    ],
  },
};

export function raceAttributes(race: RaceId, gender: Gender): AttributeSet {
  const def = RACE_DEFS[race];
  return { ...(gender === 'male' ? def.male : def.female) };
}

/** Every attribute a birthsign or race permanently fortifies, for the sheet. */
export function innateAttributeBonus(innate: readonly Innate[]): Partial<Record<AttributeId, number>> {
  const out: Partial<Record<AttributeId, number>> = {};
  for (const gift of innate) {
    if (gift.kind !== 'ability') continue;
    for (const e of gift.effects) {
      if (e.effect === 'fortifyAttribute' && e.attribute) {
        out[e.attribute] = (out[e.attribute] ?? 0) + e.magMax;
      }
    }
  }
  return out;
}
