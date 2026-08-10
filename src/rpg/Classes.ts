/**
 * Classes. Ten pre-built, plus a builder that makes an arbitrary one — the
 * class is not a straitjacket, it only decides what practice is cheap. A
 * Warrior who only ever casts Destruction will still, eventually, be a mage.
 */
import { SKILL_DEFS, SKILLS, zeroSkills } from './Attributes';
import type { AttributeId, SkillClassKind, SkillId, SkillSet, Specialization } from './Attributes';
import { RACE_DEFS } from './Races';
import type { RaceId } from './Races';

export interface ClassDef {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly spec: Specialization;
  readonly favored: readonly [AttributeId, AttributeId];
  readonly major: readonly SkillId[];
  readonly minor: readonly SkillId[];
  /** Custom classes are serialised whole; built-ins are serialised by id. */
  readonly custom: boolean;
}

export const CLASS_IDS = [
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
export type BuiltinClassId = (typeof CLASS_IDS)[number];

function cls(
  id: BuiltinClassId,
  name: string,
  blurb: string,
  spec: Specialization,
  favored: readonly [AttributeId, AttributeId],
  major: readonly SkillId[],
  minor: readonly SkillId[],
): ClassDef {
  return { id, name, blurb, spec, favored, major, minor, custom: false };
}

export const CLASS_DEFS: Readonly<Record<BuiltinClassId, ClassDef>> = {
  warrior: cls(
    'warrior',
    'Warrior',
    'Warriors are the professional men-at-arms of Ammaris, and trust to steel over sorcery.',
    'combat',
    ['strength', 'endurance'],
    ['bluntWeapon', 'longBlade', 'heavyArmor', 'block', 'athletics'],
    ['armorer', 'mediumArmor', 'axe', 'spear', 'acrobatics'],
  ),
  knight: cls(
    'knight',
    'Knight',
    'Knights are the elite of the Valmori nobility, sworn to courtesy as much as to combat.',
    'combat',
    ['personality', 'strength'],
    ['longBlade', 'heavyArmor', 'block', 'speechcraft', 'restoration'],
    ['bluntWeapon', 'mercantile', 'armorer', 'athletics', 'enchant'],
  ),
  barbarian: cls(
    'barbarian',
    'Barbarian',
    'Barbarians hold the civilised arts in contempt, and carry axes larger than most men.',
    'combat',
    ['strength', 'speed'],
    ['axe', 'mediumArmor', 'bluntWeapon', 'athletics', 'block'],
    ['armorer', 'marksman', 'unarmored', 'acrobatics', 'spear'],
  ),
  mage: cls(
    'mage',
    'Mage',
    'Mages survey the arcane arts as scholars, and rely on wits and reserves of magicka.',
    'magic',
    ['intelligence', 'willpower'],
    ['alteration', 'destruction', 'illusion', 'mysticism', 'restoration'],
    ['alchemy', 'conjuration', 'enchant', 'unarmored', 'shortBlade'],
  ),
  battlemage: cls(
    'battlemage',
    'Battlemage',
    'Battlemages meet the enemy with a blade in one hand and ruin in the other.',
    'magic',
    ['intelligence', 'strength'],
    ['destruction', 'alteration', 'conjuration', 'longBlade', 'heavyArmor'],
    ['bluntWeapon', 'mysticism', 'enchant', 'alchemy', 'axe'],
  ),
  sorcerer: cls(
    'sorcerer',
    'Sorcerer',
    'Sorcerers hoard magic items and bound souls, and prefer their power stored rather than studied.',
    'magic',
    ['intelligence', 'endurance'],
    ['enchant', 'conjuration', 'destruction', 'mysticism', 'alteration'],
    ['illusion', 'alchemy', 'restoration', 'heavyArmor', 'bluntWeapon'],
  ),
  healer: cls(
    'healer',
    'Healer',
    'Healers are concerned with the physical and mental well-being of others, and are rarely armed.',
    'magic',
    ['personality', 'willpower'],
    ['restoration', 'alteration', 'alchemy', 'illusion', 'unarmored'],
    ['mysticism', 'speechcraft', 'mercantile', 'handToHand', 'shortBlade'],
  ),
  thief: cls(
    'thief',
    'Thief',
    'Thieves prefer stealth to violence, and other people’s property to their own.',
    'stealth',
    ['agility', 'speed'],
    ['security', 'sneak', 'acrobatics', 'lightArmor', 'shortBlade'],
    ['marksman', 'mercantile', 'speechcraft', 'handToHand', 'block'],
  ),
  assassin: cls(
    'assassin',
    'Assassin',
    'Assassins are the sharp end of a contract. They kill quietly and are gone before the body cools.',
    'stealth',
    ['speed', 'intelligence'],
    ['shortBlade', 'marksman', 'sneak', 'lightArmor', 'acrobatics'],
    ['alchemy', 'security', 'block', 'athletics', 'illusion'],
  ),
  nightblade: cls(
    'nightblade',
    'Nightblade',
    'Nightblades use magic to enhance mobility, concealment and stealthy close combat.',
    'stealth',
    ['willpower', 'speed'],
    ['illusion', 'destruction', 'shortBlade', 'sneak', 'lightArmor'],
    ['alteration', 'mysticism', 'restoration', 'security', 'handToHand'],
  ),
};

export const STARTING_SKILL_BASE = 5;
export const MAJOR_SKILL_BONUS = 25;
export const MINOR_SKILL_BONUS = 10;
export const SPECIALIZATION_SKILL_BONUS = 5;

export function classify(def: ClassDef, skill: SkillId): SkillClassKind {
  if (def.major.includes(skill)) return 'major';
  if (def.minor.includes(skill)) return 'minor';
  return 'misc';
}

/**
 * Starting skills: base, plus class focus, plus specialisation, plus race.
 * A Sahiri Warrior swings a Long Blade at 45 on day one; a Halvorn Healer
 * swings the same blade at 5 and will bleed for every point of it.
 */
export function startingSkills(def: ClassDef, race: RaceId): SkillSet {
  const out = zeroSkills();
  const racial = RACE_DEFS[race].skills;
  for (const s of SKILLS) {
    let v = STARTING_SKILL_BASE;
    const kind = classify(def, s);
    if (kind === 'major') v += MAJOR_SKILL_BONUS;
    else if (kind === 'minor') v += MINOR_SKILL_BONUS;
    if (SKILL_DEFS[s].spec === def.spec) v += SPECIALIZATION_SKILL_BONUS;
    v += racial[s] ?? 0;
    out[s] = v;
  }
  return out;
}

export class CustomClassError extends Error {}

/**
 * Build an arbitrary class. Rejected only for structural nonsense — the same
 * skill twice, wrong counts — never for being a bad idea. Bad ideas are the
 * player's prerogative.
 */
export function makeCustomClass(
  name: string,
  spec: Specialization,
  favored: readonly [AttributeId, AttributeId],
  major: readonly SkillId[],
  minor: readonly SkillId[],
  blurb = 'A class of your own devising.',
): ClassDef {
  if (major.length !== 5) throw new CustomClassError('a class needs exactly five major skills');
  if (minor.length !== 5) throw new CustomClassError('a class needs exactly five minor skills');
  if (favored[0] === favored[1]) throw new CustomClassError('favoured attributes must differ');
  const seen = new Set<SkillId>();
  for (const s of [...major, ...minor]) {
    if (seen.has(s)) throw new CustomClassError(`${SKILL_DEFS[s].name} is listed twice`);
    seen.add(s);
  }
  return {
    id: `custom:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    blurb,
    spec,
    favored,
    major: [...major],
    minor: [...minor],
    custom: true,
  };
}

export function isBuiltinClass(id: string): id is BuiltinClassId {
  return (CLASS_IDS as readonly string[]).includes(id);
}
