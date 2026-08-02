/**
 * Enchanting. Bind arbitrary effects into an item as cast-on-use, cast-on-
 * strike, or constant effect. Constant effect is priced a hundred times over,
 * because a permanent 20-point Fortify Strength ring should cost a grand soul
 * and a fortune, and should still be reachable if you are willing to pay.
 *
 * Failure destroys the soul gem and the item. That is the wager.
 */
import { clamp } from './Attributes';
import { enchantmentCost, normaliseEffect } from './Effects';
import type { EffectInstance } from './Effects';
import { enchantPointsOf } from './Items';
import type { ArmorItem, ClothingItem, Enchantment, ItemDef, ItemRegistry, ItemStack, WeaponItem } from './Items';
import type { Rng } from './Rng';

export type Enchantable = WeaponItem | ArmorItem | ClothingItem;

export interface EnchanterStats {
  readonly enchant: number;
  readonly intelligence: number;
  readonly luck: number;
  readonly fatigueMul: number;
}

export type EnchantResult =
  | { ok: true; def: ItemDef; cost: number; charge: number }
  | {
      ok: false;
      /** 'no-effect': the list was empty or named an effect this build has no row for. */
      reason: 'no-soul' | 'too-costly' | 'already-enchanted' | 'failed' | 'no-effect';
      cost: number;
      capacity: number;
    };

/** Cast-on-use items hold a charge pool worth several casts. */
export const CHARGE_POOL_MULT = 4;

export function enchantCapacity(item: Enchantable): number {
  return enchantPointsOf(item);
}

/**
 * The ceiling on what an item can hold. Constant effect must fit inside the
 * raw capacity; a charged enchantment may exceed it because each use is paid
 * for out of a finite pool.
 */
export function capacityFor(item: Enchantable, kind: Enchantment['kind']): number {
  const cap = enchantCapacity(item);
  return kind === 'constant' ? cap : cap * CHARGE_POOL_MULT;
}

export function enchantChance(cost: number, kind: Enchantment['kind'], s: EnchanterStats): number {
  const penalty = cost * (kind === 'constant' ? 0.02 : 0.4);
  const raw = (s.enchant + s.intelligence / 5 + s.luck / 10) * s.fatigueMul - penalty;
  return clamp(raw, 5, 95) / 100;
}

export function enchant(
  reg: ItemRegistry,
  base: Enchantable,
  effects: readonly EffectInstance[],
  kind: Enchantment['kind'],
  soulValue: number,
  name: string,
  stats: EnchanterStats,
  rng: Rng,
): EnchantResult {
  const capacity = capacityFor(base, kind);
  const clean: EffectInstance[] = [];
  for (const e of effects) {
    const line = normaliseEffect(kind === 'constant' ? { ...e, duration: 1 } : e);
    // Binding a rune nobody can name would burn the gem for nothing; refuse
    // before the wager is taken, not after.
    if (!line) return { ok: false, reason: 'no-effect', cost: 0, capacity };
    clean.push(line);
  }
  if (clean.length === 0) return { ok: false, reason: 'no-effect', cost: 0, capacity };
  const cost = enchantmentCost(clean, kind);

  if (base.enchantment) return { ok: false, reason: 'already-enchanted', cost, capacity };
  if (soulValue <= 0) return { ok: false, reason: 'no-soul', cost, capacity };
  if (cost > capacity) return { ok: false, reason: 'too-costly', cost, capacity };

  if (!rng.chance(enchantChance(cost, kind, stats))) {
    return { ok: false, reason: 'failed', cost, capacity };
  }

  const ench: Enchantment = {
    name,
    kind,
    effects: clean,
    cost: kind === 'constant' ? 0 : Math.max(1, Math.round(enchantmentCost(clean, 'cast'))),
    charge: kind === 'constant' ? 0 : Math.max(1, Math.round(soulValue)),
  };
  const id = reg.nextId(`${base.kind}:ench`);
  const def: ItemDef = { ...base, id, name: `${base.name} of ${name}`, enchantment: ench, generated: true };
  reg.define(def);
  return { ok: true, def, cost, charge: ench.charge };
}

/**
 * Recharge from a filled soul gem. Overfilling is wasted, which is why nobody
 * burns a grand soul on a dagger.
 */
export function recharge(
  stack: ItemStack,
  item: Enchantable,
  soulValue: number,
  enchantSkill: number,
  rng: Rng,
): number {
  const ench = item.enchantment;
  if (!ench || ench.kind === 'constant') return 0;
  const efficiency = clamp(0.3 + enchantSkill * 0.007, 0.3, 1);
  const gain = Math.round(soulValue * efficiency * rng.range(0.85, 1.15));
  const before = stack.charge;
  stack.charge = Math.min(ench.charge, Math.max(0, stack.charge) + gain);
  return stack.charge - before;
}

/** Spends the charge for one activation; constant effects never spend. */
export function drawCharge(stack: ItemStack, ench: Enchantment): boolean {
  if (ench.kind === 'constant') return true;
  if (stack.charge < ench.cost) return false;
  stack.charge -= ench.cost;
  return true;
}

/**
 * Soul capture value. Bigger creatures carry bigger souls; this is the only
 * place in the game where a thing's power is a number the player can bank.
 */
export function soulValueFor(maxHealth: number, tier: number): number {
  return Math.max(5, Math.round(maxHealth * 0.6 + tier * 25));
}
