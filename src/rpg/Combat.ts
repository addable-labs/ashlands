/**
 * Combat arithmetic. Pure functions so the same maths resolves the player's
 * swing, an NPC's swing, and any future arena/duel simulation.
 */
import { clamp } from './Attributes';
import type { Rng } from './Rng';
import type { ItemStack, WeaponItem } from './Items';

export type SwingType = 'chop' | 'slash' | 'thrust';

export interface AttackerStats {
  readonly weaponSkill: number;
  readonly agility: number;
  readonly luck: number;
  readonly fatigueMul: number;
  /** Blind subtracts straight off the attack rating. */
  readonly blind: number;
}

export interface DefenderStats {
  readonly agility: number;
  readonly luck: number;
  readonly fatigueMul: number;
  readonly sanctuary: number;
}

/**
 * Morrowind's to-hit: skill dominates, Agility and Luck nudge, fatigue scales
 * both sides, and the defender's evasion is subtracted. There is no minimum
 * hit chance — a fumbling drunk really can miss a mudcrab all afternoon.
 */
export function hitChance(a: AttackerStats, d: DefenderStats): number {
  const attack = (a.weaponSkill + a.agility / 5 + a.luck / 10) * a.fatigueMul - a.blind;
  const evade = (d.agility / 5 + d.luck / 10) * d.fatigueMul + d.sanctuary;
  return clamp(attack - evade, 0, 100) / 100;
}

/** Fraction of the swing arc completed; a tapped attack does almost nothing. */
export function swingStrength(chargeSeconds: number, weaponSpeed: number): number {
  const full = 1 / Math.max(0.1, weaponSpeed);
  return clamp(chargeSeconds / full, 0.1, 1);
}

export const FATIGUE_PER_SWING = 6;
export const FATIGUE_PER_JUMP = 8;
export const FATIGUE_RUN_PER_SECOND = 4;
export const FATIGUE_SWIM_PER_SECOND = 2;
/** Fatigue recovered per second while standing still, before Endurance. */
export const FATIGUE_REGEN_BASE = 3;

/** Strength moves damage by ±50% across the whole attribute range. */
export function strengthMultiplier(strength: number): number {
  return strength * 0.01 + 0.5;
}

export function weaponDamage(
  def: WeaponItem,
  stack: ItemStack,
  strength: number,
  swing: SwingType,
  charge: number,
  rng: Rng,
): number {
  const range = swing === 'chop' ? def.chop : swing === 'slash' ? def.slash : def.thrust;
  const roll = rng.range(range[0], range[1]);
  const wear = def.maxCondition > 0 ? clamp(stack.condition / def.maxCondition, 0, 1) : 1;
  // A broken weapon is a club. A club is a bad weapon.
  const conditionMul = wear <= 0 ? 0.25 : 0.25 + 0.75 * wear;
  return Math.max(0, roll * charge * strengthMultiplier(strength) * conditionMul);
}

/** Bare hands do fatigue damage first, health damage only once you are spent. */
export function handToHandDamage(skill: number, strength: number, charge: number): number {
  return Math.max(0.5, skill * 0.05 + 1) * charge * strengthMultiplier(strength);
}

/**
 * Armour soak. Diminishing returns with a hard floor, so heavy plate is
 * transformative against small hits and merely useful against big ones.
 */
export const ARMOR_MIN_MULT = 0.25;

export function armorSoak(damage: number, armorRating: number): number {
  if (armorRating <= 0) return damage;
  const x = damage / (damage + armorRating);
  return damage * Math.max(ARMOR_MIN_MULT, x);
}

/** Blocking: skill, Agility, Luck and shield condition, scaled by fatigue. */
export function blockChance(
  blockSkill: number,
  agility: number,
  luck: number,
  fatigueMul: number,
  shieldWear: number,
): number {
  const raw = (blockSkill * 0.2 + agility * 0.1 + luck * 0.05) * fatigueMul * shieldWear;
  return clamp(raw, 0, 50) / 100;
}

/** Condition lost per hit. Ebony lasts; iron does not. */
export const WEAPON_WEAR_PER_HIT = 1;
export const ARMOR_WEAR_PER_HIT = 1;

/** Sneak attacks: the whole reason to own a short blade. */
export const SNEAK_DAMAGE_MULT = 4;
export const MARKSMAN_SNEAK_MULT = 2;

export function sneakChance(
  sneakSkill: number,
  agility: number,
  luck: number,
  fatigueMul: number,
  load: number,
  distance: number,
): number {
  const raw = (sneakSkill + agility / 5 + luck / 10) * fatigueMul - load * 40 + clamp(distance - 5, 0, 30);
  return clamp(raw, 0, 100) / 100;
}
