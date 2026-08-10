/**
 * Spells and spellmaking. A spell is nothing but a name and a list of effects,
 * which is why the player can build one nobody planned: 1 point of Jump for
 * 100 seconds is cheap, and 100 points of Jump for 1 second is affordable, and
 * exactly one of those breaks the map. Both are legal.
 */
import { SKILL_DEFS, clamp } from './Attributes';
import type { AttributeId, SkillId } from './Attributes';
import { SCHOOL_SKILL, lookupEffect, normaliseEffect, spellCost } from './Effects';
import type { EffectInstance, School } from './Effects';

export type SpellKind = 'spell' | 'power' | 'ability' | 'disease' | 'blight' | 'curse';

export interface Spell {
  readonly id: string;
  readonly name: string;
  readonly kind: SpellKind;
  readonly effects: readonly EffectInstance[];
  /** Magicka cost. Ignored for abilities (always on) and powers (once a day). */
  readonly cost: number;
  /** True when the cost tracks the effect list rather than being hand-set. */
  readonly autoCost: boolean;
  readonly custom: boolean;
}

const eff = (
  effect: EffectInstance['effect'],
  magMin: number,
  magMax: number,
  duration: number,
  range: EffectInstance['range'],
  area = 0,
  extra: Partial<EffectInstance> = {},
): EffectInstance => ({ effect, magMin, magMax, duration, area, range, ...extra });

function makeSpellDef(
  id: string,
  name: string,
  effects: readonly EffectInstance[],
  kind: SpellKind = 'spell',
): Spell {
  return { id, name, kind, effects, cost: spellCost(effects), autoCost: true, custom: false };
}

/** The spells a fresh character can plausibly have bought in Lowmarsh. */
export const STARTER_SPELLS: readonly Spell[] = [
  makeSpellDef('spell:fireBite', 'Fire Bite', [eff('fireDamage', 5, 15, 0, 'touch')]),
  makeSpellDef('spell:flameOfAnger', 'Flame of Anger', [eff('fireDamage', 8, 20, 0, 'target')]),
  makeSpellDef('spell:frostBite', 'Frostbite', [eff('frostDamage', 5, 15, 0, 'touch')]),
  makeSpellDef('spell:shockBolt', 'Shock Bolt', [eff('shockDamage', 6, 18, 0, 'target')]),
  makeSpellDef('spell:sanguineTouch', 'Sanguine Touch', [eff('absorbHealth', 5, 10, 5, 'touch')]),
  makeSpellDef('spell:healing', 'Healing Touch', [eff('restoreHealth', 10, 20, 0, 'self')]),
  makeSpellDef('spell:greaterHealing', 'Rilm’s Gift', [eff('restoreHealth', 30, 50, 0, 'self')]),
  makeSpellDef('spell:cureCommon', 'Rid Common Disease', [eff('cureCommonDisease', 0, 0, 0, 'self')]),
  makeSpellDef('spell:fortifyBody', 'Bound Vigour', [eff('fortifyAttribute', 10, 10, 60, 'self', 0, { attribute: 'strength' })]),
  makeSpellDef('spell:ondusiOpen', "Ondusi's Open Door", [eff('open', 20, 20, 0, 'touch')]),
  makeSpellDef('spell:leaping', 'Tinur’s Hoptoad', [eff('jump', 30, 30, 15, 'self')]),
  makeSpellDef('spell:levitate', 'Levitate', [eff('levitate', 10, 10, 30, 'self')]),
  makeSpellDef('spell:slowfall', 'Feather Fall', [eff('slowFall', 20, 20, 20, 'self')]),
  makeSpellDef('spell:waterWalking', 'Water Walking', [eff('waterWalking', 0, 0, 60, 'self')]),
  makeSpellDef('spell:waterBreathing', 'Fluid Lungs', [eff('waterBreathing', 0, 0, 60, 'self')]),
  makeSpellDef('spell:feather', 'Feather', [eff('feather', 50, 50, 60, 'self')]),
  makeSpellDef('spell:shield', 'Shield', [eff('shield', 10, 10, 30, 'self')]),
  makeSpellDef('spell:chameleon', 'Chameleon', [eff('chameleon', 30, 30, 30, 'self')]),
  makeSpellDef('spell:nightEye', 'Night Eye', [eff('nightEye', 40, 40, 60, 'self')]),
  makeSpellDef('spell:lightSpell', 'Light', [eff('lightSpell', 20, 20, 60, 'self')]),
  makeSpellDef('spell:soultrap', 'Soultrap', [eff('soultrap', 0, 0, 30, 'target')]),
  makeSpellDef('spell:mark', 'Mark', [eff('mark', 0, 0, 0, 'self')]),
  makeSpellDef('spell:recall', 'Recall', [eff('recall', 0, 0, 0, 'self')]),
  makeSpellDef('spell:summonScamp', 'Summon Scamp', [eff('summonScamp', 0, 0, 60, 'self')]),
  makeSpellDef('spell:boundDagger', 'Bound Dagger', [eff('boundDagger', 0, 0, 60, 'self')]),
  makeSpellDef('spell:calm', 'Calming Touch', [eff('calmHumanoid', 20, 20, 20, 'touch')]),
  makeSpellDef('spell:demoralize', 'Fearful Gaze', [eff('demoralizeHumanoid', 20, 20, 20, 'target')]),
  makeSpellDef('spell:paralyze', 'Paralysis', [eff('paralyze', 0, 0, 8, 'target')]),
  makeSpellDef('spell:dispel', 'Dispel', [eff('dispel', 40, 40, 0, 'self')]),
  makeSpellDef('spell:almsivi', 'Trine Intervention', [eff('almsiviIntervention', 0, 0, 0, 'self')]),
  makeSpellDef('spell:divine', 'Divine Intervention', [eff('divineIntervention', 0, 0, 0, 'self')]),
];

export interface SpellBookSave {
  known: string[];
  custom: Spell[];
  ready: string | null;
  /** Powers are once per day; this records the day each was last spent. */
  powersUsed: [string, number][];
}

export class SpellmakingError extends Error {}

/** Guild limits. High enough that the interesting exploits stay reachable. */
export const MAX_EFFECTS_PER_SPELL = 8;
export const MAX_MAGNITUDE = 1000;
export const MAX_DURATION = 3600;
export const MAX_AREA = 100;

export class SpellBook {
  private readonly defs = new Map<string, Spell>();
  private readonly knownIds = new Set<string>();
  private readonly powersUsed = new Map<string, number>();
  private seq = 0;
  /** The spell that fires when the player casts. */
  ready: string | null = null;

  constructor() {
    for (const s of STARTER_SPELLS) this.defs.set(s.id, s);
  }

  define(spell: Spell): Spell {
    this.defs.set(spell.id, spell);
    return spell;
  }

  get(id: string): Spell | undefined {
    return this.defs.get(id);
  }

  learn(id: string): boolean {
    if (!this.defs.has(id)) return false;
    if (this.knownIds.has(id)) return false;
    this.knownIds.add(id);
    if (this.ready === null && this.defs.get(id)?.kind === 'spell') this.ready = id;
    return true;
  }

  forget(id: string): void {
    this.knownIds.delete(id);
    if (this.ready === id) this.ready = this.known()[0]?.id ?? null;
  }

  knows(id: string): boolean {
    return this.knownIds.has(id);
  }

  known(): readonly Spell[] {
    const out: Spell[] = [];
    for (const id of this.knownIds) {
      const s = this.defs.get(id);
      if (s) out.push(s);
    }
    return out;
  }

  castable(): readonly Spell[] {
    return this.known().filter((s) => s.kind === 'spell' || s.kind === 'power');
  }

  /** Cycles the readied spell; returns the new one. */
  cycle(dir: 1 | -1): Spell | null {
    const list = this.castable();
    if (list.length === 0) return null;
    const i = list.findIndex((s) => s.id === this.ready);
    const n = (i + dir + list.length * 2) % list.length;
    this.ready = list[n].id;
    return list[n];
  }

  powerSpent(id: string, day: number): boolean {
    return this.powersUsed.get(id) === day;
  }

  spendPower(id: string, day: number): void {
    this.powersUsed.set(id, day);
  }

  /**
   * Spellmaking. Any combination of effects, any magnitudes, any durations —
   * the price is the only judge. Guilds cap the effect count, nothing else.
   */
  create(name: string, effects: readonly EffectInstance[]): Spell {
    if (effects.length === 0) throw new SpellmakingError('a spell needs at least one effect');
    if (effects.length > MAX_EFFECTS_PER_SPELL) {
      throw new SpellmakingError(`no enchanter will bind more than ${MAX_EFFECTS_PER_SPELL} effects`);
    }
    const clean: EffectInstance[] = [];
    for (const e of effects) {
      const line = normaliseEffect({
        ...e,
        magMin: clamp(e.magMin, 0, MAX_MAGNITUDE),
        magMax: clamp(e.magMax, 0, MAX_MAGNITUDE),
        duration: clamp(e.duration, 0, MAX_DURATION),
        area: clamp(e.area, 0, MAX_AREA),
      });
      // No guild binds a rune it cannot name. Refusing the whole spell beats
      // quietly selling the player a shorter one than they paid for.
      if (!line) throw new SpellmakingError(`no such magic effect: ${String(e.effect)}`);
      clean.push(line);
    }
    const id = `spell:custom#${++this.seq}`;
    const spell: Spell = {
      id,
      name,
      kind: 'spell',
      effects: clean,
      cost: spellCost(clean),
      autoCost: true,
      custom: true,
    };
    this.defs.set(id, spell);
    this.knownIds.add(id);
    return spell;
  }

  serialise(): SpellBookSave {
    const custom: Spell[] = [];
    for (const s of this.defs.values()) if (s.custom) custom.push(s);
    return {
      known: [...this.knownIds],
      custom,
      ready: this.ready,
      powersUsed: [...this.powersUsed.entries()],
    };
  }

  deserialise(s: SpellBookSave): void {
    for (const c of s.custom) {
      this.defs.set(c.id, c);
      const n = Number(c.id.split('#')[1] ?? 0);
      if (Number.isFinite(n)) this.seq = Math.max(this.seq, n);
    }
    this.knownIds.clear();
    for (const id of s.known) if (this.defs.has(id)) this.knownIds.add(id);
    this.powersUsed.clear();
    for (const [id, day] of s.powersUsed) this.powersUsed.set(id, day);
    this.ready = s.ready && this.defs.has(s.ready) ? s.ready : null;
  }
}

/** Which school a spell is judged by: the school of its costliest effect. */
export function spellSchool(spell: Spell): School {
  let best: School = 'destruction';
  let bestCost = -1;
  for (const e of spell.effects) {
    const def = lookupEffect(e.effect);
    if (def && def.baseCost > bestCost) {
      bestCost = def.baseCost;
      best = def.school;
    }
  }
  return best;
}

export function spellSkill(spell: Spell): SkillId {
  return SCHOOL_SKILL[spellSchool(spell)];
}

/** Everything the cast roll needs, so Magic never has to import Character. */
export interface CasterStats {
  readonly skill: number;
  readonly willpower: number;
  readonly luck: number;
  /** Output of fatigueTerm(): 0.75 spent, 1.25 fresh. */
  readonly fatigueMul: number;
  /** 0..1 fraction of carrying capacity in use. */
  readonly load: number;
  /** Sum of Silence magnitudes; anything above zero and nothing comes out. */
  readonly silenced: boolean;
}

/** Encumbrance costs up to 25 percentage points of spell success. */
export const LOAD_CAST_PENALTY = 25;

/**
 * Morrowind's cast formula, kept exact: skill dominates, Willpower and Luck
 * nudge, cost punishes, and fatigue multiplies the lot. A tired mage in full
 * ebony fails cantrips.
 */
export function castChance(cost: number, s: CasterStats): number {
  if (s.silenced) return 0;
  const raw = (s.skill * 2 - cost + s.willpower / 5 + s.luck / 10) * s.fatigueMul - s.load * LOAD_CAST_PENALTY;
  return clamp(raw, 0, 100) / 100;
}

/** Enchanted items and scrolls never fail; that is what you pay for. */
export function scrollAlwaysWorks(): true {
  return true;
}

export function describeSpell(spell: Spell): string {
  return `${spell.name} (${spell.cost} magicka)`;
}

export function isSelfOnly(spell: Spell): boolean {
  return spell.effects.every((e) => e.range === 'self');
}

/** Governing skill display name, for the notification text. */
export function spellSkillName(spell: Spell): string {
  return SKILL_DEFS[spellSkill(spell)].name;
}

export type { AttributeId };
