/**
 * Alchemy. Every ingredient carries four effects; any effect shared by two or
 * more ingredients in the mortar makes it into the potion. The player is never
 * told which combinations are "recipes" because there are no recipes — there
 * is a table of ingredients and an arithmetic rule, and everything else is the
 * player's problem and the player's discovery.
 */
import { clamp } from './Attributes';
import type { AttributeId, SkillId } from './Attributes';
import { describeEffect, lookupEffect, normaliseEffect, spellCost } from './Effects';
import type { EffectId, EffectInstance } from './Effects';
import type { ApparatusItem, IngredientItem, ItemRegistry, PotionItem } from './Items';
import type { Rng } from './Rng';

export interface Apparatus {
  mortar: ApparatusItem | null;
  alembic: ApparatusItem | null;
  calcinator: ApparatusItem | null;
  retort: ApparatusItem | null;
}

export const NO_APPARATUS: Apparatus = { mortar: null, alembic: null, calcinator: null, retort: null };

export interface AlchemistStats {
  readonly alchemy: number;
  readonly intelligence: number;
  readonly luck: number;
  readonly fatigueMul: number;
}

export type BrewResult =
  | { ok: true; def: PotionItem; power: number; effects: readonly EffectInstance[] }
  | { ok: false; reason: 'too-few' | 'too-many' | 'no-shared-effect' | 'no-mortar' | 'botched' };

export const MIN_INGREDIENTS = 2;
export const MAX_INGREDIENTS = 4;

/**
 * Brewing power below which nothing measurable comes out of the mortar. A
 * character with any mortar at all clears it; a crippled, exhausted alchemist
 * grinding with a bargain pestle does not.
 */
export const MIN_BREW_POWER = 6;

/**
 * How many of an ingredient's four effects the alchemist can read. Low-skill
 * alchemists brew half-blind, which is exactly why every apprentice has
 * poisoned themselves at least once.
 */
export function knownEffectCount(alchemy: number): number {
  if (alchemy >= 100) return 4;
  if (alchemy >= 65) return 3;
  if (alchemy >= 30) return 2;
  if (alchemy >= 15) return 1;
  return 0;
}

/** Stable key for "the same effect", including its attribute/skill parameter. */
function effectKey(e: EffectInstance): string {
  return `${e.effect}|${e.attribute ?? ''}|${e.skill ?? ''}`;
}

const QUALITY_NAMES: readonly (readonly [number, string])[] = [
  [10, 'Bargain'],
  [25, 'Cheap'],
  [45, 'Standard'],
  [70, 'Quality'],
  [100, 'Exclusive'],
  [Infinity, 'Grand'],
];

function qualityName(power: number): string {
  for (const [limit, name] of QUALITY_NAMES) if (power < limit) return name;
  return 'Grand';
}

/**
 * Brew. Power comes from Alchemy, Intelligence, Luck, fatigue and the mortar;
 * the other three apparatus shape the result rather than strengthening it,
 * which is what makes a full set worth carrying.
 */
export function brew(
  reg: ItemRegistry,
  ingredients: readonly IngredientItem[],
  app: Apparatus,
  stats: AlchemistStats,
  rng: Rng,
): BrewResult {
  if (ingredients.length < MIN_INGREDIENTS) return { ok: false, reason: 'too-few' };
  if (ingredients.length > MAX_INGREDIENTS) return { ok: false, reason: 'too-many' };
  if (!app.mortar) return { ok: false, reason: 'no-mortar' };

  const counts = new Map<string, { e: EffectInstance; n: number }>();
  for (const ing of ingredients) {
    // An ingredient contributes each of its effects once, even if listed twice.
    const seen = new Set<string>();
    for (const e of ing.effects) {
      // An ingredient row naming an effect this build dropped is inert, not fatal.
      if (!lookupEffect(e.effect)) continue;
      const k = effectKey(e);
      if (seen.has(k)) continue;
      seen.add(k);
      const prev = counts.get(k);
      if (prev) prev.n++;
      else counts.set(k, { e, n: 1 });
    }
  }

  const shared = [...counts.values()].filter((c) => c.n >= 2);
  if (shared.length === 0) return { ok: false, reason: 'no-shared-effect' };

  const mortar = app.mortar.quality;
  const power =
    (stats.alchemy + stats.intelligence * 0.2 + stats.luck * 0.1) * stats.fatigueMul * mortar;

  /*
   * Failure is a floor, not a coin flip.
   *
   * This used to roll `power/100` and throw the ingredients away on a miss,
   * which meant a starting character — Alchemy 5, an apprentice's mortar —
   * lost four out of five mixtures to a die roll they could not read, learn
   * from or plan around. The skill that decides the outcome should decide it
   * visibly: below MIN_BREW_POWER the alchemist cannot extract a single point
   * of anything and the mixture curdles; above it they always get a potion,
   * and how feeble it is is exactly their skill, Intelligence, Luck, fatigue
   * and mortar. The punishment for brewing blind survives untouched, and it is
   * the interesting one: at low Alchemy you cannot read the ingredients, so
   * the hostile effects you did not see go into the bottle with the rest.
   */
  if (power < MIN_BREW_POWER) return { ok: false, reason: 'botched' };

  const calcinator = app.calcinator?.quality ?? 0;
  const retort = app.retort?.quality ?? 0;
  const alembic = app.alembic?.quality ?? 0;

  const out: EffectInstance[] = [];
  for (const { e, n } of shared) {
    const def = lookupEffect(e.effect);
    if (!def) continue;
    const hostile = def.hostile === true;
    // The alembic strips the poison out; a good one strips all of it.
    if (hostile && alembic >= 1 && rng.next() < clamp(alembic * 0.6, 0, 0.95)) continue;

    // More ingredients sharing an effect make it stronger.
    const stack = 1 + (n - 1) * 0.5;
    const boost = 1 + retort * (hostile ? 0 : 0.35) + calcinator * 0.25;
    const mag = Math.max(1, Math.round(power * 0.1 * stack * boost * rng.range(0.85, 1.15)));
    const dur = def.noDuration ? 0 : Math.max(1, Math.round(power * 0.25 * stack * (1 + calcinator * 0.3)));

    const line = normaliseEffect({
      effect: e.effect,
      attribute: e.attribute,
      skill: e.skill,
      magMin: def.noMagnitude ? 0 : mag,
      magMax: def.noMagnitude ? 0 : mag,
      duration: dur,
      area: 0,
      range: 'self',
    });
    if (line) out.push(line);
  }
  if (out.length === 0) return { ok: false, reason: 'no-shared-effect' };

  const primary = lookupEffect(out[0].effect);
  const name = `${qualityName(power)} Potion of ${primary?.name ?? 'Murk'}`;
  const id = reg.nextId('potion');
  const def: PotionItem = {
    id,
    name,
    kind: 'potion',
    weight: 0.5,
    value: Math.max(1, Math.round(spellCost(out) * 1.5)),
    effects: out,
    generated: true,
  };
  reg.define(def);
  return { ok: true, def, power, effects: out };
}

/** Eating a raw ingredient gives its first effect, weakly, if you can read it. */
export function eatIngredient(
  ing: IngredientItem,
  alchemy: number,
): { effect: EffectInstance } | null {
  if (knownEffectCount(alchemy) < 1) return null;
  const base = ing.effects[0];
  const def = base ? lookupEffect(base.effect) : null;
  // An ingredient with no readable first effect is just food.
  if (!base || !def) return null;
  const effect = normaliseEffect({
    effect: base.effect,
    attribute: base.attribute,
    skill: base.skill,
    magMin: def.noMagnitude ? 0 : Math.max(1, Math.round(alchemy * 0.05)),
    magMax: def.noMagnitude ? 0 : Math.max(1, Math.round(alchemy * 0.05)),
    duration: def.noDuration ? 0 : Math.max(1, Math.round(alchemy * 0.2)),
    area: 0,
    range: 'self',
  });
  return effect ? { effect } : null;
}

/** What the alchemy window shows for an ingredient at a given skill. */
export function readIngredient(ing: IngredientItem, alchemy: number): readonly string[] {
  const n = knownEffectCount(alchemy);
  return ing.effects.slice(0, n).map((e) => describeEffect(e));
}

export type { AttributeId, EffectId, SkillId };
