/**
 * Carrying things. Weight is the only real constraint on greed: an
 * over-encumbered character does not walk, and a nearly-encumbered one wades.
 */
import { clamp } from './Attributes';
import type { Rng } from './Rng';
import {
  ARMOR_CLASS_SKILL,
  SLOTS,
  SLOT_CONFLICTS,
  enchantmentOf,
  equipSlot,
  isArmor,
  isClothing,
  isWeapon,
  itemValue,
  maxConditionOf,
  newStack,
} from './Items';
import type { ArmorItem, ItemDef, ItemRegistry, ItemStack, SlotId, WeaponItem } from './Items';

/** Metres of carrying capacity per point of Strength. */
export const ENCUMBRANCE_PER_STRENGTH = 5;
/** Below this fraction of capacity you move freely. */
export const ENCUMBRANCE_FREE = 0.5;

export interface InventorySave {
  stacks: ItemStack[];
  equipped: [SlotId, number][];
  gold: number;
}

export type EquipResult =
  | { ok: true; unequipped: readonly number[] }
  | { ok: false; reason: 'not-equippable' | 'not-found' | 'broken' | 'two-handed' };

export class Inventory {
  readonly stacks: ItemStack[] = [];
  readonly equipped = new Map<SlotId, number>();
  gold = 0;

  constructor(private readonly reg: ItemRegistry) {}

  /* ------------------------------------------------------------ contents */

  add(def: ItemDef, count = 1): ItemStack {
    // Stackables with no per-instance state merge; everything else is unique
    // because condition and charge are properties of the object, not the type.
    if (maxConditionOf(def) < 0 && !enchantmentOf(def)) {
      const existing = this.stacks.find((s) => s.def === def.id);
      if (existing) {
        existing.count += count;
        return existing;
      }
    }
    const stack = newStack(def, count);
    this.stacks.push(stack);
    return stack;
  }

  /** Null when the id names nothing this build knows, so a table edit or a
   *  renamed row cannot take down whoever was handing out the item. */
  addById(id: string, count = 1): ItemStack | null {
    const def = this.reg.find(id);
    return def ? this.add(def, count) : null;
  }

  addStack(stack: ItemStack): void {
    this.stacks.push(stack);
  }

  remove(uid: number, count = 1): boolean {
    const i = this.stacks.findIndex((s) => s.uid === uid);
    if (i < 0) return false;
    const s = this.stacks[i];
    s.count -= count;
    if (s.count <= 0) {
      this.stacks.splice(i, 1);
      for (const [slot, u] of this.equipped) if (u === uid) this.equipped.delete(slot);
    }
    return true;
  }

  find(uid: number): ItemStack | undefined {
    return this.stacks.find((s) => s.uid === uid);
  }

  /**
   * The definition behind a stack, or undefined if the table no longer has one.
   * Every caller must handle the gap: stacks outlive tables across saves, and a
   * missing row is a missing item, never a thrown exception mid-frame.
   */
  defOf(stack: ItemStack): ItemDef | undefined {
    return this.reg.find(stack.def);
  }

  countOf(defId: string): number {
    let n = 0;
    for (const s of this.stacks) if (s.def === defId) n += s.count;
    return n;
  }

  /* --------------------------------------------------------- encumbrance */

  get weight(): number {
    let w = 0;
    for (const s of this.stacks) w += (this.reg.find(s.def)?.weight ?? 0) * s.count;
    return w;
  }

  get worth(): number {
    let v = this.gold;
    for (const s of this.stacks) {
      const def = this.reg.find(s.def);
      if (def) v += itemValue(def) * s.count;
    }
    return v;
  }

  capacity(strength: number, feather: number, burden: number): number {
    return Math.max(0, strength * ENCUMBRANCE_PER_STRENGTH + feather - burden);
  }

  /**
   * 1 while light, tapering to 0 at capacity. Movement systems multiply their
   * speed by this; at zero you are standing in a pile of loot going nowhere.
   */
  mobility(strength: number, feather: number, burden: number): number {
    const cap = this.capacity(strength, feather, burden);
    if (cap <= 0) return 0;
    const load = this.weight / cap;
    if (load <= ENCUMBRANCE_FREE) return 1;
    if (load >= 1) return 0;
    return 1 - (load - ENCUMBRANCE_FREE) / (1 - ENCUMBRANCE_FREE);
  }

  /* ------------------------------------------------------------- equipping */

  equippedStack(slot: SlotId): ItemStack | undefined {
    const uid = this.equipped.get(slot);
    return uid === undefined ? undefined : this.find(uid);
  }

  equippedDef(slot: SlotId): ItemDef | undefined {
    const s = this.equippedStack(slot);
    return s ? this.reg.find(s.def) : undefined;
  }

  equip(uid: number): EquipResult {
    const stack = this.find(uid);
    if (!stack) return { ok: false, reason: 'not-found' };
    const def = this.reg.find(stack.def);
    if (!def) return { ok: false, reason: 'not-found' };
    const slot = equipSlot(def);
    if (!slot) return { ok: false, reason: 'not-equippable' };
    if (maxConditionOf(def) > 0 && stack.condition <= 0) return { ok: false, reason: 'broken' };

    const removed: number[] = [];
    const drop = (s: SlotId) => {
      const prev = this.equipped.get(s);
      if (prev !== undefined) {
        removed.push(prev);
        this.equipped.delete(s);
      }
    };

    // Rings are the one slot with two openings; fill the empty one first.
    let target = slot;
    if (slot === 'leftRing' && this.equipped.has('leftRing') && !this.equipped.has('rightRing')) target = 'rightRing';

    drop(target);
    for (const conflict of SLOT_CONFLICTS[target] ?? []) drop(conflict);
    // A two-handed weapon and a shield cannot both be held.
    if (target === 'weapon' && isWeapon(def) && def.twoHanded) drop('shield');
    if (target === 'shield') {
      const held = this.equippedDef('weapon');
      if (held && isWeapon(held) && held.twoHanded) drop('weapon');
    }
    for (const [s, conflicts] of Object.entries(SLOT_CONFLICTS) as [SlotId, readonly SlotId[]][]) {
      if (conflicts.includes(target) && this.equipped.has(s)) drop(s);
    }

    this.equipped.set(target, uid);
    return { ok: true, unequipped: removed };
  }

  unequip(slot: SlotId): number | null {
    const uid = this.equipped.get(slot);
    if (uid === undefined) return null;
    this.equipped.delete(slot);
    return uid;
  }

  unequipItem(uid: number): boolean {
    for (const [slot, u] of this.equipped) {
      if (u === uid) {
        this.equipped.delete(slot);
        return true;
      }
    }
    return false;
  }

  isEquipped(uid: number): boolean {
    for (const u of this.equipped.values()) if (u === uid) return true;
    return false;
  }

  get weapon(): WeaponItem | null {
    const d = this.equippedDef('weapon');
    return d && isWeapon(d) ? d : null;
  }

  /* --------------------------------------------------------------- armour */

  /**
   * Weighted armour rating, plus the armour skill actually being exercised.
   * A bare patch counts as Unarmored, which is why a pyjama-clad monk is not
   * simply naked in the mechanical sense.
   */
  armorRating(skills: Readonly<Record<string, number>>, unarmoredSkill: number): {
    rating: number;
    dominant: 'light' | 'medium' | 'heavy' | 'unarmored';
  } {
    let rating = 0;
    let covered = 0;
    const classWeight = { light: 0, medium: 0, heavy: 0 };
    for (const slot of SLOTS) {
      const def = this.equippedDef(slot);
      if (!def || !isArmor(def)) continue;
      if (def.coverage <= 0) continue;
      const stack = this.equippedStack(slot);
      const wear = stack && def.maxCondition > 0 ? clamp(stack.condition / def.maxCondition, 0, 1) : 1;
      const skill = skills[ARMOR_CLASS_SKILL[def.armorClass]] ?? 0;
      // Skill scales the plate: the same cuirass stops more on a veteran.
      rating += def.armor * wear * (0.4 + 0.006 * skill) * def.coverage;
      covered += def.coverage;
      classWeight[def.armorClass] += def.coverage;
    }
    // Unarmoured skin over the uncovered fraction.
    const bare = Math.max(0, 1 - covered);
    rating += bare * unarmoredSkill * 0.08;

    let dominant: 'light' | 'medium' | 'heavy' | 'unarmored' = 'unarmored';
    let best = bare;
    for (const k of ['light', 'medium', 'heavy'] as const) {
      if (classWeight[k] > best) {
        best = classWeight[k];
        dominant = k;
      }
    }
    return { rating, dominant };
  }

  /** Which armour piece eats a hit, chosen by coverage. Feeds skill-by-use. */
  hitPiece(rng: Rng): { stack: ItemStack; def: ArmorItem } | null {
    const worn: { stack: ItemStack; def: ArmorItem; w: number }[] = [];
    let total = 0;
    for (const slot of SLOTS) {
      const def = this.equippedDef(slot);
      const stack = this.equippedStack(slot);
      if (!def || !stack || !isArmor(def) || def.coverage <= 0) continue;
      worn.push({ stack, def, w: def.coverage });
      total += def.coverage;
    }
    if (total <= 0) return null;
    let r = rng.next() * 1;
    if (r > total) return null;
    for (const w of worn) {
      r -= w.w;
      if (r <= 0) return { stack: w.stack, def: w.def };
    }
    return null;
  }

  /* ----------------------------------------------------------- condition */

  damageItem(stack: ItemStack, amount: number): boolean {
    const def = this.reg.find(stack.def);
    if (!def || maxConditionOf(def) <= 0) return false;
    const before = stack.condition;
    stack.condition = Math.max(0, stack.condition - amount);
    if (stack.condition === 0 && before > 0) {
      this.unequipItem(stack.uid);
      return true;
    }
    return false;
  }

  /**
   * Repair. Success and amount both scale with Armorer, Strength, Luck and
   * fatigue, and with the quality of the hammer — a Master Repair Tool in the
   * hands of an exhausted novice is still mostly wasted.
   */
  repair(
    stack: ItemStack,
    hammer: ItemStack | null,
    armorer: number,
    strength: number,
    luck: number,
    fatigueMul: number,
    rng: Rng,
  ): { repaired: number; broke: boolean; failed: boolean } {
    const def = this.reg.find(stack.def);
    const max = def ? maxConditionOf(def) : -1;
    if (max <= 0 || stack.condition >= max) return { repaired: 0, broke: false, failed: true };
    const tool = hammer ? this.reg.find(hammer.def) ?? null : null;
    const quality = tool && tool.kind === 'tool' && tool.tool === 'repair' ? tool.quality : 0.35;

    const chance = clamp((armorer + strength / 5 + luck / 10) * fatigueMul * 0.01, 0.05, 0.98);
    let broke = false;
    if (hammer) {
      hammer.condition = hammer.condition < 0 ? -1 : hammer.condition - 1;
      if (hammer.condition === 0) {
        this.remove(hammer.uid, hammer.count);
        broke = true;
      }
    }
    if (!rng.chance(chance)) return { repaired: 0, broke, failed: true };

    const amount = Math.max(1, Math.round((armorer * 0.6 + strength * 0.2 + 5) * quality * fatigueMul * rng.range(0.6, 1.4)));
    const applied = Math.min(amount, max - stack.condition);
    stack.condition += applied;
    return { repaired: applied, broke, failed: false };
  }

  /* ---------------------------------------------------------------- save */

  serialise(): InventorySave {
    return {
      stacks: this.stacks.map((s) => ({ ...s })),
      equipped: [...this.equipped.entries()],
      gold: this.gold,
    };
  }

  deserialise(s: InventorySave): void {
    this.stacks.length = 0;
    for (const st of s.stacks) {
      // Drop anything whose definition vanished rather than throwing on load.
      if (this.reg.find(st.def)) this.stacks.push({ ...st });
    }
    this.equipped.clear();
    for (const [slot, uid] of s.equipped) if (this.find(uid)) this.equipped.set(slot, uid);
    this.gold = s.gold;
  }
}

export { isArmor, isClothing, isWeapon };
