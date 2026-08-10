/**
 * Magic effects as composable data. A spell, an enchantment, a potion and an
 * alchemical ingredient are all just lists of EffectInstance — which is what
 * makes spellmaking, enchanting and alchemy open-ended instead of a menu of
 * hand-authored results.
 */
import { ATTRIBUTES, SKILLS } from './Attributes';
import type { AttributeId, SkillId } from './Attributes';

export const SCHOOLS = [
  'alteration',
  'conjuration',
  'destruction',
  'illusion',
  'mysticism',
  'restoration',
] as const;
export type School = (typeof SCHOOLS)[number];

export const SCHOOL_SKILL: Readonly<Record<School, SkillId>> = {
  alteration: 'alteration',
  conjuration: 'conjuration',
  destruction: 'destruction',
  illusion: 'illusion',
  mysticism: 'mysticism',
  restoration: 'restoration',
};

/** What the effect needs pointed at something before it means anything. */
export type EffectParam = 'none' | 'attribute' | 'skill';

/**
 * How the effect resolves once it lands. The RPG system switches on this, not
 * on the effect id, so adding an effect to the table needs no new branches.
 */
export type EffectMode =
  | 'damageHealth'
  | 'restoreHealth'
  | 'damageFatigue'
  | 'restoreFatigue'
  | 'damageMagicka'
  | 'restoreMagicka'
  | 'damageAttribute'
  | 'restoreAttribute'
  | 'fortifyAttribute'
  | 'drainAttribute'
  | 'fortifySkill'
  | 'drainSkill'
  | 'fortifyHealth'
  | 'fortifyMagicka'
  | 'fortifyFatigue'
  | 'drainHealth'
  | 'drainMagicka'
  | 'drainFatigue'
  | 'resist'
  | 'weakness'
  | 'shield'
  | 'armor'
  | 'sanctuary'
  | 'blind'
  | 'invisibility'
  | 'chameleon'
  | 'light'
  | 'nightEye'
  | 'levitate'
  | 'slowFall'
  | 'jump'
  | 'feather'
  | 'burden'
  | 'waterBreathing'
  | 'waterWalking'
  | 'swiftSwim'
  | 'lock'
  | 'open'
  | 'telekinesis'
  | 'mark'
  | 'recall'
  | 'intervention'
  | 'detect'
  | 'soultrap'
  | 'boundItem'
  | 'summon'
  | 'command'
  | 'paralyze'
  | 'silence'
  | 'sound'
  | 'charm'
  | 'social'
  | 'dispel'
  | 'cure'
  | 'absorbSpell'
  | 'reflect'
  | 'disintegrate'
  | 'turnUndead'
  | 'spellAbsorption';

export interface EffectDef {
  readonly name: string;
  readonly school: School;
  /** Feeds the cost formula directly; the whole economy of magic hangs on it. */
  readonly baseCost: number;
  readonly mode: EffectMode;
  readonly param: EffectParam;
  /** Magnitude is meaningless for e.g. Water Breathing. */
  readonly noMagnitude?: true;
  /** Duration is meaningless for e.g. Mark. */
  readonly noDuration?: true;
  /** Effects that only make sense pointed at yourself. */
  readonly selfOnly?: true;
  /** Hostile effects are what alembics strip out of a potion. */
  readonly hostile?: true;
  /** Which VFX school to hand to the visual effects system. */
  readonly vfx: string;
  /** Linear-space tint for the UI and for spell projectiles. */
  readonly tint: number;
}

const EFFECT_TABLE = {
  fireDamage: { name: 'Fire Damage', school: 'destruction', baseCost: 9, mode: 'damageHealth', param: 'none', hostile: true, vfx: 'fire', tint: 0xff5a1e },
  frostDamage: { name: 'Frost Damage', school: 'destruction', baseCost: 9, mode: 'damageHealth', param: 'none', hostile: true, vfx: 'frost', tint: 0x6ec2ff },
  shockDamage: { name: 'Shock Damage', school: 'destruction', baseCost: 9, mode: 'damageHealth', param: 'none', hostile: true, vfx: 'shock', tint: 0x9fc4ff },
  poison: { name: 'Poison', school: 'destruction', baseCost: 15, mode: 'damageHealth', param: 'none', hostile: true, vfx: 'illusion', tint: 0x7fbf3f },
  damageHealth: { name: 'Damage Health', school: 'destruction', baseCost: 12, mode: 'damageHealth', param: 'none', hostile: true, vfx: 'destruction', tint: 0xb02020 },
  damageMagicka: { name: 'Damage Magicka', school: 'destruction', baseCost: 8, mode: 'damageMagicka', param: 'none', hostile: true, vfx: 'mysticism', tint: 0x8f6bff },
  damageFatigue: { name: 'Damage Fatigue', school: 'destruction', baseCost: 4, mode: 'damageFatigue', param: 'none', hostile: true, vfx: 'illusion', tint: 0x8a7f72 },
  damageAttribute: { name: 'Damage Attribute', school: 'destruction', baseCost: 8, mode: 'damageAttribute', param: 'attribute', hostile: true, vfx: 'destruction', tint: 0x8f2f4f },
  damageSkill: { name: 'Damage Skill', school: 'destruction', baseCost: 10, mode: 'drainSkill', param: 'skill', hostile: true, vfx: 'destruction', tint: 0x8f2f4f },
  drainHealth: { name: 'Drain Health', school: 'destruction', baseCost: 4, mode: 'drainHealth', param: 'none', hostile: true, vfx: 'drain', tint: 0x6a1030 },
  drainMagicka: { name: 'Drain Magicka', school: 'destruction', baseCost: 2, mode: 'drainMagicka', param: 'none', hostile: true, vfx: 'drain', tint: 0x4a1060 },
  drainFatigue: { name: 'Drain Fatigue', school: 'destruction', baseCost: 1.5, mode: 'drainFatigue', param: 'none', hostile: true, vfx: 'drain', tint: 0x5a4a3a },
  drainAttribute: { name: 'Drain Attribute', school: 'destruction', baseCost: 4, mode: 'drainAttribute', param: 'attribute', hostile: true, vfx: 'drain', tint: 0x6a1030 },
  drainSkill: { name: 'Drain Skill', school: 'destruction', baseCost: 3, mode: 'drainSkill', param: 'skill', hostile: true, vfx: 'drain', tint: 0x6a1030 },
  disintegrateWeapon: { name: 'Disintegrate Weapon', school: 'destruction', baseCost: 20, mode: 'disintegrate', param: 'none', hostile: true, vfx: 'destruction', tint: 0x8a7f72 },
  disintegrateArmor: { name: 'Disintegrate Armor', school: 'destruction', baseCost: 20, mode: 'disintegrate', param: 'none', hostile: true, vfx: 'destruction', tint: 0x8a7f72 },
  weaknessToFire: { name: 'Weakness to Fire', school: 'destruction', baseCost: 2, mode: 'weakness', param: 'none', hostile: true, vfx: 'fire', tint: 0xc4551f },
  weaknessToFrost: { name: 'Weakness to Frost', school: 'destruction', baseCost: 2, mode: 'weakness', param: 'none', hostile: true, vfx: 'frost', tint: 0x6ec2ff },
  weaknessToShock: { name: 'Weakness to Shock', school: 'destruction', baseCost: 2, mode: 'weakness', param: 'none', hostile: true, vfx: 'shock', tint: 0x9fc4ff },
  weaknessToMagicka: { name: 'Weakness to Magicka', school: 'destruction', baseCost: 2, mode: 'weakness', param: 'none', hostile: true, vfx: 'mysticism', tint: 0x8f6bff },
  weaknessToPoison: { name: 'Weakness to Poison', school: 'destruction', baseCost: 2, mode: 'weakness', param: 'none', hostile: true, vfx: 'illusion', tint: 0x7fbf3f },

  restoreHealth: { name: 'Restore Health', school: 'restoration', baseCost: 15, mode: 'restoreHealth', param: 'none', vfx: 'restore', tint: 0x3fd6c0 },
  restoreMagicka: { name: 'Restore Magicka', school: 'restoration', baseCost: 10, mode: 'restoreMagicka', param: 'none', vfx: 'restore', tint: 0x8f6bff },
  restoreFatigue: { name: 'Restore Fatigue', school: 'restoration', baseCost: 3, mode: 'restoreFatigue', param: 'none', vfx: 'restore', tint: 0xd8c9a4 },
  restoreAttribute: { name: 'Restore Attribute', school: 'restoration', baseCost: 20, mode: 'restoreAttribute', param: 'attribute', vfx: 'restore', tint: 0x3fd6c0 },
  fortifyHealth: { name: 'Fortify Health', school: 'restoration', baseCost: 0.5, mode: 'fortifyHealth', param: 'none', vfx: 'restore', tint: 0x3fd6c0 },
  fortifyMagicka: { name: 'Fortify Magicka', school: 'restoration', baseCost: 0.5, mode: 'fortifyMagicka', param: 'none', vfx: 'restore', tint: 0x8f6bff },
  fortifyFatigue: { name: 'Fortify Fatigue', school: 'restoration', baseCost: 0.5, mode: 'fortifyFatigue', param: 'none', vfx: 'restore', tint: 0xd8c9a4 },
  fortifyAttribute: { name: 'Fortify Attribute', school: 'restoration', baseCost: 0.6, mode: 'fortifyAttribute', param: 'attribute', vfx: 'restore', tint: 0x3fd6c0 },
  fortifySkill: { name: 'Fortify Skill', school: 'restoration', baseCost: 0.6, mode: 'fortifySkill', param: 'skill', vfx: 'restore', tint: 0x3fd6c0 },
  fortifyMagickaMultiplier: { name: 'Fortify Maximum Magicka', school: 'restoration', baseCost: 1.5, mode: 'fortifyMagicka', param: 'none', selfOnly: true, vfx: 'restore', tint: 0x8f6bff },
  absorbHealth: { name: 'Absorb Health', school: 'mysticism', baseCost: 8, mode: 'damageHealth', param: 'none', hostile: true, vfx: 'drain', tint: 0x8f2f6f },
  absorbMagicka: { name: 'Absorb Magicka', school: 'mysticism', baseCost: 8, mode: 'damageMagicka', param: 'none', hostile: true, vfx: 'drain', tint: 0x8f2f6f },
  absorbFatigue: { name: 'Absorb Fatigue', school: 'mysticism', baseCost: 4, mode: 'damageFatigue', param: 'none', hostile: true, vfx: 'drain', tint: 0x8f2f6f },
  absorbAttribute: { name: 'Absorb Attribute', school: 'mysticism', baseCost: 8, mode: 'damageAttribute', param: 'attribute', hostile: true, vfx: 'drain', tint: 0x8f2f6f },
  absorbSkill: { name: 'Absorb Skill', school: 'mysticism', baseCost: 12, mode: 'drainSkill', param: 'skill', hostile: true, vfx: 'drain', tint: 0x8f2f6f },
  cureCommonDisease: { name: 'Cure Common Disease', school: 'restoration', baseCost: 5, mode: 'cure', param: 'none', noMagnitude: true, noDuration: true, vfx: 'restore', tint: 0x3fd6c0 },
  cureBlightDisease: { name: 'Cure Blight Disease', school: 'restoration', baseCost: 25, mode: 'cure', param: 'none', noMagnitude: true, noDuration: true, vfx: 'restore', tint: 0x3fd6c0 },
  cureParalyzation: { name: 'Cure Paralyzation', school: 'restoration', baseCost: 20, mode: 'cure', param: 'none', noMagnitude: true, noDuration: true, vfx: 'restore', tint: 0x3fd6c0 },
  curePoison: { name: 'Cure Poison', school: 'restoration', baseCost: 12, mode: 'cure', param: 'none', noMagnitude: true, noDuration: true, vfx: 'restore', tint: 0x3fd6c0 },
  resistFire: { name: 'Resist Fire', school: 'restoration', baseCost: 0.5, mode: 'resist', param: 'none', vfx: 'fire', tint: 0xc4551f },
  resistFrost: { name: 'Resist Frost', school: 'restoration', baseCost: 0.5, mode: 'resist', param: 'none', vfx: 'frost', tint: 0x6ec2ff },
  resistShock: { name: 'Resist Shock', school: 'restoration', baseCost: 0.5, mode: 'resist', param: 'none', vfx: 'shock', tint: 0x9fc4ff },
  resistMagicka: { name: 'Resist Magicka', school: 'restoration', baseCost: 0.5, mode: 'resist', param: 'none', vfx: 'mysticism', tint: 0x8f6bff },
  resistPoison: { name: 'Resist Poison', school: 'restoration', baseCost: 0.5, mode: 'resist', param: 'none', vfx: 'restore', tint: 0x7fbf3f },
  resistCommonDisease: { name: 'Resist Common Disease', school: 'restoration', baseCost: 0.5, mode: 'resist', param: 'none', vfx: 'restore', tint: 0x3fd6c0 },
  resistBlightDisease: { name: 'Resist Blight Disease', school: 'restoration', baseCost: 0.5, mode: 'resist', param: 'none', vfx: 'restore', tint: 0x3fd6c0 },
  resistParalysis: { name: 'Resist Paralysis', school: 'restoration', baseCost: 0.5, mode: 'resist', param: 'none', vfx: 'restore', tint: 0x3fd6c0 },

  shield: { name: 'Shield', school: 'alteration', baseCost: 0.5, mode: 'shield', param: 'none', vfx: 'alteration', tint: 0x6bb7ff },
  fireShield: { name: 'Fire Shield', school: 'alteration', baseCost: 0.5, mode: 'shield', param: 'none', vfx: 'fire', tint: 0xff7a2a },
  frostShield: { name: 'Frost Shield', school: 'alteration', baseCost: 0.5, mode: 'shield', param: 'none', vfx: 'frost', tint: 0x6ec2ff },
  lightningShield: { name: 'Lightning Shield', school: 'alteration', baseCost: 0.5, mode: 'shield', param: 'none', vfx: 'shock', tint: 0x9fc4ff },
  levitate: { name: 'Levitate', school: 'alteration', baseCost: 7, mode: 'levitate', param: 'none', vfx: 'alteration', tint: 0x6bb7ff },
  slowFall: { name: 'Slow Fall', school: 'alteration', baseCost: 3, mode: 'slowFall', param: 'none', vfx: 'alteration', tint: 0x6bb7ff },
  jump: { name: 'Jump', school: 'alteration', baseCost: 1.5, mode: 'jump', param: 'none', vfx: 'alteration', tint: 0x6bb7ff },
  feather: { name: 'Feather', school: 'alteration', baseCost: 1, mode: 'feather', param: 'none', vfx: 'alteration', tint: 0x6bb7ff },
  burden: { name: 'Burden', school: 'alteration', baseCost: 1, mode: 'burden', param: 'none', hostile: true, vfx: 'alteration', tint: 0x6a5a4a },
  waterBreathing: { name: 'Water Breathing', school: 'alteration', baseCost: 3, mode: 'waterBreathing', param: 'none', noMagnitude: true, vfx: 'water', tint: 0x3fd6c0 },
  waterWalking: { name: 'Water Walking', school: 'alteration', baseCost: 6, mode: 'waterWalking', param: 'none', noMagnitude: true, vfx: 'water', tint: 0x3fd6c0 },
  swiftSwim: { name: 'Swift Swim', school: 'alteration', baseCost: 1, mode: 'swiftSwim', param: 'none', vfx: 'water', tint: 0x3fd6c0 },
  open: { name: 'Open', school: 'alteration', baseCost: 6, mode: 'open', param: 'none', noDuration: true, vfx: 'alteration', tint: 0x6bb7ff },
  lock: { name: 'Lock', school: 'alteration', baseCost: 3, mode: 'lock', param: 'none', noDuration: true, hostile: true, vfx: 'alteration', tint: 0x6bb7ff },

  telekinesis: { name: 'Telekinesis', school: 'mysticism', baseCost: 2, mode: 'telekinesis', param: 'none', vfx: 'mysticism', tint: 0x8f6bff },
  mark: { name: 'Mark', school: 'mysticism', baseCost: 40, mode: 'mark', param: 'none', noMagnitude: true, noDuration: true, selfOnly: true, vfx: 'mysticism', tint: 0x8f6bff },
  recall: { name: 'Recall', school: 'mysticism', baseCost: 40, mode: 'recall', param: 'none', noMagnitude: true, noDuration: true, selfOnly: true, vfx: 'mysticism', tint: 0x8f6bff },
  divineIntervention: { name: 'Divine Intervention', school: 'mysticism', baseCost: 50, mode: 'intervention', param: 'none', noMagnitude: true, noDuration: true, selfOnly: true, vfx: 'mysticism', tint: 0xd8c9a4 },
  almsiviIntervention: { name: 'Trine Intervention', school: 'mysticism', baseCost: 30, mode: 'intervention', param: 'none', noMagnitude: true, noDuration: true, selfOnly: true, vfx: 'mysticism', tint: 0xd8c9a4 },
  detectAnimal: { name: 'Detect Animal', school: 'mysticism', baseCost: 1, mode: 'detect', param: 'none', selfOnly: true, vfx: 'mysticism', tint: 0x3fd6c0 },
  detectEnchantment: { name: 'Detect Enchantment', school: 'mysticism', baseCost: 1, mode: 'detect', param: 'none', selfOnly: true, vfx: 'mysticism', tint: 0x8f6bff },
  detectKey: { name: 'Detect Key', school: 'mysticism', baseCost: 1, mode: 'detect', param: 'none', selfOnly: true, vfx: 'mysticism', tint: 0xd8c9a4 },
  soultrap: { name: 'Soultrap', school: 'mysticism', baseCost: 20, mode: 'soultrap', param: 'none', noMagnitude: true, hostile: true, vfx: 'mysticism', tint: 0x8f6bff },
  dispel: { name: 'Dispel', school: 'mysticism', baseCost: 5, mode: 'dispel', param: 'none', noDuration: true, vfx: 'mysticism', tint: 0x8f6bff },
  spellAbsorption: { name: 'Spell Absorption', school: 'mysticism', baseCost: 1, mode: 'spellAbsorption', param: 'none', vfx: 'mysticism', tint: 0x8f6bff },
  reflect: { name: 'Reflect', school: 'mysticism', baseCost: 1.5, mode: 'reflect', param: 'none', vfx: 'mysticism', tint: 0x8f6bff },

  lightSpell: { name: 'Light', school: 'illusion', baseCost: 0.5, mode: 'light', param: 'none', vfx: 'illusion', tint: 0xffd28a },
  nightEye: { name: 'Night Eye', school: 'illusion', baseCost: 0.5, mode: 'nightEye', param: 'none', selfOnly: true, vfx: 'illusion', tint: 0x3fd6c0 },
  invisibility: { name: 'Invisibility', school: 'illusion', baseCost: 40, mode: 'invisibility', param: 'none', noMagnitude: true, vfx: 'illusion', tint: 0xa0a0c0 },
  chameleon: { name: 'Chameleon', school: 'illusion', baseCost: 0.5, mode: 'chameleon', param: 'none', vfx: 'illusion', tint: 0xa0a0c0 },
  sanctuary: { name: 'Sanctuary', school: 'illusion', baseCost: 2, mode: 'sanctuary', param: 'none', vfx: 'illusion', tint: 0x8f6bff },
  blind: { name: 'Blind', school: 'illusion', baseCost: 1, mode: 'blind', param: 'none', hostile: true, vfx: 'illusion', tint: 0x2a2622 },
  sound: { name: 'Sound', school: 'illusion', baseCost: 1.5, mode: 'sound', param: 'none', hostile: true, vfx: 'illusion', tint: 0x8f6bff },
  silence: { name: 'Silence', school: 'illusion', baseCost: 40, mode: 'silence', param: 'none', noMagnitude: true, hostile: true, vfx: 'illusion', tint: 0x4a423b },
  paralyze: { name: 'Paralyze', school: 'illusion', baseCost: 60, mode: 'paralyze', param: 'none', noMagnitude: true, hostile: true, vfx: 'illusion', tint: 0x8f6bff },
  charm: { name: 'Charm', school: 'illusion', baseCost: 1, mode: 'charm', param: 'none', vfx: 'illusion', tint: 0xff9ac0 },
  calmHumanoid: { name: 'Calm Humanoid', school: 'illusion', baseCost: 1.5, mode: 'social', param: 'none', vfx: 'illusion', tint: 0x6bb7ff },
  calmCreature: { name: 'Calm Creature', school: 'illusion', baseCost: 1.5, mode: 'social', param: 'none', vfx: 'illusion', tint: 0x6bb7ff },
  frenzyHumanoid: { name: 'Frenzy Humanoid', school: 'illusion', baseCost: 1, mode: 'social', param: 'none', hostile: true, vfx: 'illusion', tint: 0xc4551f },
  frenzyCreature: { name: 'Frenzy Creature', school: 'illusion', baseCost: 1, mode: 'social', param: 'none', hostile: true, vfx: 'illusion', tint: 0xc4551f },
  demoralizeHumanoid: { name: 'Demoralize Humanoid', school: 'illusion', baseCost: 1, mode: 'social', param: 'none', hostile: true, vfx: 'illusion', tint: 0x4a423b },
  demoralizeCreature: { name: 'Demoralize Creature', school: 'illusion', baseCost: 1, mode: 'social', param: 'none', hostile: true, vfx: 'illusion', tint: 0x4a423b },
  rallyHumanoid: { name: 'Rally Humanoid', school: 'illusion', baseCost: 0.75, mode: 'social', param: 'none', vfx: 'illusion', tint: 0xffd28a },
  rallyCreature: { name: 'Rally Creature', school: 'illusion', baseCost: 0.75, mode: 'social', param: 'none', vfx: 'illusion', tint: 0xffd28a },

  commandHumanoid: { name: 'Command Humanoid', school: 'conjuration', baseCost: 1.5, mode: 'command', param: 'none', hostile: true, vfx: 'conjure', tint: 0x8f6bff },
  commandCreature: { name: 'Command Creature', school: 'conjuration', baseCost: 1.5, mode: 'command', param: 'none', hostile: true, vfx: 'conjure', tint: 0x8f6bff },
  turnUndead: { name: 'Turn Undead', school: 'conjuration', baseCost: 1, mode: 'turnUndead', param: 'none', hostile: true, vfx: 'conjure', tint: 0xd8c9a4 },
  summonScamp: { name: 'Summon Scamp', school: 'conjuration', baseCost: 8, mode: 'summon', param: 'none', noMagnitude: true, selfOnly: true, vfx: 'conjure', tint: 0x8f6bff },
  summonClannfear: { name: 'Summon Clannfear', school: 'conjuration', baseCost: 14, mode: 'summon', param: 'none', noMagnitude: true, selfOnly: true, vfx: 'conjure', tint: 0x8f6bff },
  summonDaedroth: { name: 'Summon Daedroth', school: 'conjuration', baseCost: 30, mode: 'summon', param: 'none', noMagnitude: true, selfOnly: true, vfx: 'conjure', tint: 0x8f6bff },
  summonAncestralGhost: { name: 'Summon Ancestral Ghost', school: 'conjuration', baseCost: 10, mode: 'summon', param: 'none', noMagnitude: true, selfOnly: true, vfx: 'conjure', tint: 0xa0d0ff },
  summonBonewalker: { name: 'Summon Bonewalker', school: 'conjuration', baseCost: 12, mode: 'summon', param: 'none', noMagnitude: true, selfOnly: true, vfx: 'conjure', tint: 0xd8c9a4 },
  summonGoldenSaint: { name: 'Summon Golden Saint', school: 'conjuration', baseCost: 45, mode: 'summon', param: 'none', noMagnitude: true, selfOnly: true, vfx: 'conjure', tint: 0xffd28a },
  boundLongsword: { name: 'Bound Longsword', school: 'conjuration', baseCost: 5, mode: 'boundItem', param: 'none', noMagnitude: true, selfOnly: true, vfx: 'conjure', tint: 0x8f6bff },
  boundDagger: { name: 'Bound Dagger', school: 'conjuration', baseCost: 3, mode: 'boundItem', param: 'none', noMagnitude: true, selfOnly: true, vfx: 'conjure', tint: 0x8f6bff },
  boundSpear: { name: 'Bound Spear', school: 'conjuration', baseCost: 5, mode: 'boundItem', param: 'none', noMagnitude: true, selfOnly: true, vfx: 'conjure', tint: 0x8f6bff },
  boundBow: { name: 'Bound Bow', school: 'conjuration', baseCost: 6, mode: 'boundItem', param: 'none', noMagnitude: true, selfOnly: true, vfx: 'conjure', tint: 0x8f6bff },
  boundCuirass: { name: 'Bound Cuirass', school: 'conjuration', baseCost: 7, mode: 'boundItem', param: 'none', noMagnitude: true, selfOnly: true, vfx: 'conjure', tint: 0x8f6bff },
  boundShield: { name: 'Bound Shield', school: 'conjuration', baseCost: 4, mode: 'boundItem', param: 'none', noMagnitude: true, selfOnly: true, vfx: 'conjure', tint: 0x8f6bff },
} as const satisfies Record<string, EffectDef>;

export type EffectId = keyof typeof EFFECT_TABLE;

/**
 * Widened view of the table. The literal-typed source above exists only to
 * derive EffectId; every consumer wants the uniform EffectDef shape.
 */
export const EFFECTS: Readonly<Record<EffectId, EffectDef>> = EFFECT_TABLE;

export const EFFECT_IDS = Object.keys(EFFECTS) as readonly EffectId[];

export function effectDef(id: EffectId): EffectDef {
  return EFFECTS[id];
}

export function isEffectId(v: unknown): v is EffectId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(EFFECT_TABLE, v);
}

/**
 * The only sanctioned way to reach the table from a value that has been outside
 * the type system — a UI panel, the console, a save written by a build whose
 * table had a row this one does not. Everything that used to write
 * `EFFECTS[e.effect].something` crashed the moment such a value arrived; this
 * returns null instead, and the caller decides what a missing effect means.
 */
export function lookupEffect(id: unknown): EffectDef | null {
  return isEffectId(id) ? EFFECTS[id] : null;
}

export type Range = 'self' | 'touch' | 'target';

/** One line of a spell, enchantment, potion or ingredient. */
export interface EffectInstance {
  effect: EffectId;
  /** Present when the effect's param is 'attribute'. */
  attribute?: AttributeId;
  /** Present when the effect's param is 'skill'. */
  skill?: SkillId;
  magMin: number;
  magMax: number;
  /** Seconds. Zero for instantaneous effects. */
  duration: number;
  /** Radius in metres. Zero for a single target. */
  area: number;
  range: Range;
}

/** Ranged delivery is strictly better, and Morrowind charges half again for it. */
export const RANGE_COST_MULT: Readonly<Record<Range, number>> = {
  self: 1,
  touch: 1,
  target: 1.5,
};

/** Constant-effect enchantments pay for an infinite duration up front. */
export const CONSTANT_EFFECT_MULT = 100;

export const EFFECT_COST_MULT = 0.5;

/**
 * The Morrowind spell-cost formula, kept intact because every downstream
 * balance decision — how much a Fortify Jump potion costs to cast, why
 * 100-point Jump is reachable and 100-point Damage Health is not — falls out
 * of its exact shape.
 */
export function effectCost(e: Readonly<EffectInstance>): number {
  const def = lookupEffect(e.effect);
  // An effect nobody can resolve buys nothing and costs nothing; pricing a
  // stale save must not be the thing that takes the game down.
  if (!def) return 0;
  const minMagn = def.noMagnitude ? 1 : Math.max(1, Math.round(e.magMin));
  const maxMagn = def.noMagnitude ? 1 : Math.max(1, Math.round(e.magMax));
  const duration = def.noDuration ? 0 : Math.max(0, Math.round(e.duration));
  let x = 0.5 * (minMagn + maxMagn);
  x *= 0.1 * def.baseCost;
  x *= 1 + duration;
  x += 0.05 * Math.max(1, Math.round(e.area)) * def.baseCost;
  return x * EFFECT_COST_MULT * RANGE_COST_MULT[e.range];
}

export function spellCost(effects: readonly EffectInstance[]): number {
  let total = 0;
  for (const e of effects) total += effectCost(e);
  return Math.max(1, Math.round(total));
}

/** Enchantment charge cost; constant effect pays the infinite-duration premium. */
export function enchantmentCost(
  effects: readonly EffectInstance[],
  kind: 'cast' | 'constant' | 'strike',
): number {
  let total = 0;
  for (const e of effects) total += effectCost(e);
  if (kind === 'constant') total *= CONSTANT_EFFECT_MULT;
  return Math.max(1, Math.round(total));
}

/** Human-readable line, e.g. "Fire Damage 10-20 pts for 5s on Touch". */
export function describeEffect(e: Readonly<EffectInstance>): string {
  const def = lookupEffect(e.effect);
  if (!def) return `Unknown Effect (${String(e.effect)})`;
  const parts: string[] = [def.name];
  if (e.attribute) parts.push(e.attribute);
  if (e.skill) parts.push(e.skill);
  if (!def.noMagnitude) {
    parts.push(e.magMin === e.magMax ? `${Math.round(e.magMin)} pts` : `${Math.round(e.magMin)}-${Math.round(e.magMax)} pts`);
  }
  if (!def.noDuration && e.duration > 0) parts.push(`for ${Math.round(e.duration)}s`);
  if (e.area > 0) parts.push(`in ${Math.round(e.area)}m`);
  parts.push(e.range === 'self' ? 'on Self' : e.range === 'touch' ? 'on Touch' : 'on Target');
  return parts.join(' ');
}

/**
 * An effect line as it arrives from outside the simulation: a spellmaking or
 * enchanting panel, the debug console, a mod, an old save. Every field is
 * `unknown` because none of it is trustworthy until parseEffect has looked at
 * it, and EffectInstance is assignable to this shape so internal callers that
 * already hold valid data need no conversion.
 *
 * `id` and `magnitude` exist because that is what the UI side of a spellmaking
 * screen naturally builds — one id, one magnitude — and refusing that shape
 * only moves the translation somewhere less careful.
 */
export interface EffectLike {
  readonly effect?: unknown;
  readonly id?: unknown;
  readonly attribute?: unknown;
  readonly skill?: unknown;
  readonly magnitude?: unknown;
  readonly magMin?: unknown;
  readonly magMax?: unknown;
  readonly duration?: unknown;
  readonly area?: unknown;
  readonly range?: unknown;
}

const RANGES: readonly Range[] = ['self', 'touch', 'target'];

function isRange(v: unknown): v is Range {
  return typeof v === 'string' && (RANGES as readonly string[]).includes(v);
}

function isAttributeId(v: unknown): v is AttributeId {
  return typeof v === 'string' && (ATTRIBUTES as readonly string[]).includes(v);
}

function isSkillId(v: unknown): v is SkillId {
  return typeof v === 'string' && (SKILLS as readonly string[]).includes(v);
}

/** Finite number or nothing; NaN and Infinity are not magnitudes. */
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * The single gate between untrusted effect data and the simulation. Returns
 * null for anything that cannot be made into a legal line — an unknown effect
 * id above all — so callers can report a failure instead of propagating a
 * half-built object that explodes three frames later.
 */
export function parseEffect(input: unknown): EffectInstance | null {
  if (typeof input !== 'object' || input === null) return null;
  const e = input as EffectLike;
  const def = lookupEffect(e.effect ?? e.id);
  if (!def) return null;
  const id = (e.effect ?? e.id) as EffectId;

  const magnitude = num(e.magnitude, Number.NaN);
  const rawMin = num(e.magMin, magnitude);
  const rawMax = num(e.magMax, Number.isFinite(magnitude) ? magnitude : rawMin);
  const magMin = def.noMagnitude ? 0 : Math.max(0, Math.round(num(rawMin, 0)));
  const magMax = def.noMagnitude ? 0 : Math.max(magMin, Math.round(num(rawMax, magMin)));

  return {
    effect: id,
    // A parameterised effect pointed at nothing still has to point somewhere;
    // the defaults are the cheapest legal target, never a crash.
    attribute: def.param === 'attribute' ? (isAttributeId(e.attribute) ? e.attribute : 'strength') : undefined,
    skill: def.param === 'skill' ? (isSkillId(e.skill) ? e.skill : 'block') : undefined,
    magMin,
    magMax,
    duration: def.noDuration ? 0 : Math.max(0, Math.round(num(e.duration, 0))),
    area: Math.max(0, Math.round(num(e.area, 0))),
    range: def.selfOnly ? 'self' : isRange(e.range) ? e.range : 'self',
  };
}

/**
 * Sanitises a caller-built effect line. Null when the line names an effect this
 * build has no row for — the caller must decide whether that is a skipped line
 * or a refused spell.
 */
export function normaliseEffect(e: Readonly<EffectLike>): EffectInstance | null {
  return parseEffect(e);
}

export type ParsedEffects =
  | { ok: true; effects: EffectInstance[] }
  | { ok: false; reason: string };

/** Parses a whole effect list, naming the first line that does not resolve. */
export function parseEffects(input: unknown): ParsedEffects {
  if (!Array.isArray(input)) return { ok: false, reason: 'effects must be a list' };
  const effects: EffectInstance[] = [];
  for (let i = 0; i < input.length; i++) {
    const parsed = parseEffect(input[i] as unknown);
    if (!parsed) {
      const raw = input[i] as EffectLike | null;
      const named = raw && typeof raw === 'object' ? String(raw.effect ?? raw.id) : String(raw);
      return { ok: false, reason: `effect ${i + 1} names no known magic effect ("${named}")` };
    }
    effects.push(parsed);
  }
  return { ok: true, effects };
}
