import type { System } from '../core/types';
import {
  ARMOURS,
  ARMOUR_TIER,
  CLASS_CHANNEL,
  MATERIAL_TIER,
  REGION_ARMOUR,
  REGION_DAMAGE,
  RESISTANCE,
  SHIELDS,
  type ArmourMaterial,
  type AttackKind,
  type BodyRegion,
  type DotKind,
  type ShieldDef,
  type SkillName,
  type WeaponDef,
} from './Tables';
import { clamp, type Rand } from './mathx';

/**
 * Hit resolution.
 *
 * The RPG substrate is kept in full: skill, fatigue, weapon condition and luck
 * all move the numbers, and a low-skill character genuinely cannot fight. What
 * is thrown away is the *rendering* of failure. In the original a failed roll
 * produced a swing that passed through the target with no sound, no reaction
 * and no information — the single most criticised thing in the game. Here a
 * failed roll is still a failed roll, but it resolves into one of four visible,
 * audible, legible events: the blow is dodged, it rings off armour, it is
 * caught on a guard, or it grazes for a fraction. The dice are untouched; only
 * the feedback changed, and that is the whole difference.
 */

export type Outcome = 'critical' | 'hit' | 'graze' | 'deflect' | 'block' | 'parry' | 'dodge' | 'immune';

/** Everything the defender contributes to a resolution. */
export interface Defence {
  /** Worn armour material. Creatures use their hide/shell entry. */
  armour: ArmourMaterial;
  /** 0..1 condition; battered armour soaks less and deflects less. */
  armourCondition: number;
  /** Resistance table key — normally the creature kind. */
  resistKey: string;
  /** 0 = not guarding, 1 = guard fully raised. */
  guard: number;
  /** Seconds since the guard was raised; inside PARRY_WINDOW it is a parry. */
  guardAge: number;
  shield: ShieldDef;
  /** True when the blow arrives inside the guard's arc. */
  guardFacing: boolean;
  /** 0..1 evasion, from agility, fatigue and whether the defender saw it coming. */
  evade: number;
  /** Already staggered targets cannot dodge or block. */
  staggered: boolean;
  /** Body mass in kg; drives knockback and stagger resistance. */
  mass: number;
}

export interface AttackRoll {
  weapon: WeaponDef;
  kind: AttackKind;
  /** 0..1 windup charge at release. */
  charge: number;
  region: BodyRegion;
  /** 0..100 weapon skill. */
  skill: number;
  /** 0..100 agility, drives connect chance and dodge. */
  agility: number;
  /** 0..100 strength, scales damage. */
  strength: number;
  /** 0..100 luck, small tail on both ends. */
  luck: number;
  /** 0..1 remaining fatigue. Exhaustion is what loses long fights. */
  fatigue: number;
  /** 0..1 weapon condition. */
  condition: number;
  /** Extra multiplier from a sneak opening. */
  sneak: number;
}

export interface Resolution {
  outcome: Outcome;
  damage: number;
  /** Seconds the defender is staggered for. */
  stagger: number;
  /** Seconds the ATTACKER is staggered for — a parry throws them off. */
  recoil: number;
  /** Metres/second of knockback along the blow direction. */
  knockback: number;
  /** Impact weight 0..2, drives hit-stop, camera shake and VFX scale. */
  weight: number;
  sparks: boolean;
  ring: 'flesh' | 'thud' | 'ring' | 'crack' | 'chime';
  dot: DotKind | null;
  /** Skill experience to award for the attempt. Use-based improvement. */
  advance: number;
  /** Condition removed from the weapon by this blow. */
  wear: number;
}

/** Skill contribution curve. Flat at the bottom, steep in the middle, capped. */
function skillTerm(skill: number, fatigue: number, luck: number): number {
  const s = clamp(skill, 0, 100) / 100;
  // Fatigue is deliberately brutal below a third: an exhausted fighter flails.
  const f = 0.35 + 0.65 * clamp(fatigue, 0, 1);
  return clamp((0.22 + 0.78 * s) * f + (clamp(luck, 0, 100) / 100 - 0.5) * 0.08, 0.05, 1.15);
}

export function resolve(a: AttackRoll, d: Defence, rand: Rand): Resolution {
  const arm = ARMOURS[d.armour] ?? ARMOURS.none;
  const res = RESISTANCE[d.resistKey] ?? RESISTANCE.default;
  const channel = CLASS_CHANNEL[a.weapon.cls];

  const connect = skillTerm(a.skill, a.fatigue, a.luck);
  const evade = clamp(d.evade * (d.staggered ? 0.1 : 1), 0, 0.9);
  // One roll decides everything. Splitting attack and defence into two rolls
  // multiplies whiff chance, which is exactly how the original ended up with
  // fights that were mostly nothing happening.
  const roll = rand.next();
  const threshold = clamp(connect * (0.62 + 0.38 * a.charge) - evade * 0.55, 0.06, 0.97);

  const guarding = d.guard > 0.35 && d.guardFacing && !d.staggered;
  const parried = guarding && d.guardAge <= 0.26 && rand.next() < 0.5 + 0.5 * d.guard;

  let outcome: Outcome;
  if (guarding && parried) outcome = 'parry';
  else if (guarding) outcome = 'block';
  else if (roll < threshold * 0.12) outcome = 'critical';
  else if (roll < threshold) outcome = 'hit';
  else {
    // The failure branch. Which flavour of failure depends on what the defender
    // actually has: armour deflects, agility dodges, and if neither applies the
    // blow still lands badly rather than vanishing.
    const deflectChance = arm.deflect * d.armourCondition * REGION_ARMOUR[a.region];
    const tierGap = ARMOUR_TIER[d.armour] - MATERIAL_TIER[a.weapon.material];
    const deflect = clamp(deflectChance + Math.max(0, tierGap) * 0.09, 0, 0.9);
    const r2 = rand.next();
    if (r2 < evade * 0.9) outcome = 'dodge';
    else if (r2 < evade * 0.9 + deflect) outcome = 'deflect';
    else outcome = 'graze';
  }

  // ------------------------------------------------------------- magnitude
  const span = a.weapon[a.kind];
  const chargeMix = 0.45 + 0.55 * clamp(a.charge, 0, 1);
  let dmg = (span[0] + (span[1] - span[0]) * chargeMix) * (0.4 + a.condition * 0.6);
  dmg *= 0.75 + (clamp(a.strength, 0, 100) / 100) * 0.7;
  dmg *= REGION_DAMAGE[a.region];
  dmg *= res[channel];
  dmg *= a.sneak;

  // Material immunity: the reason to carry silver. Applied after the channel
  // multiplier so an immune target is immune to a critical too.
  const mundane = !a.weapon.enchanted && a.weapon.material !== 'silver';
  const matMul = mundane ? res.mundane : a.weapon.material === 'silver' ? res.silver : res.enchanted;
  dmg *= matMul;

  const OUT_SCALE: Record<Outcome, number> = {
    critical: 1.75, hit: 1, graze: 0.28, deflect: 0.1, block: 1, parry: 0, dodge: 0, immune: 0,
  };
  dmg *= OUT_SCALE[outcome];

  if (outcome === 'block' || outcome === 'parry') {
    const soak = outcome === 'parry' ? 1 : d.shield.soak * (0.6 + 0.4 * d.guard);
    dmg *= 1 - clamp(soak, 0, 0.98);
  }

  // Armour soak, saturating so heavy armour is strong but never absolute.
  if (dmg > 0) {
    const ar = arm.rating * d.armourCondition * REGION_ARMOUR[a.region];
    dmg *= 1 - clamp(ar / (ar + 46), 0, 0.86);
  }

  if (matMul <= 0.001) {
    outcome = 'immune';
    dmg = 0;
  }

  // ---------------------------------------------------------- consequences
  const massTerm = 60 / Math.max(12, d.mass);
  const heft = a.weapon.mass / 6;
  const impactWeight = clamp(
    (outcome === 'critical' ? 1.5 : outcome === 'hit' ? 1 : outcome === 'block' ? 0.7 : outcome === 'parry' ? 0.85 : 0.4) *
      (0.5 + heft) * (0.55 + 0.45 * a.charge),
    0.08,
    2,
  );

  let stagger = 0;
  let recoil = 0;
  if (outcome === 'hit' || outcome === 'critical') {
    stagger = clamp(impactWeight * massTerm * 0.34 - (d.staggered ? 0 : 0.08), 0, 1.1);
  } else if (outcome === 'block') {
    stagger = clamp(impactWeight * massTerm * 0.12, 0, 0.5);
    recoil = 0.1;
  } else if (outcome === 'parry') {
    // The payoff for timing: the attacker eats the stagger, not the defender.
    recoil = clamp(d.shield.riposte * 0.7 * (0.6 + 0.4 * a.charge), 0.2, 1.2);
  } else if (outcome === 'deflect') {
    recoil = 0.12;
  }

  const knockback = clamp(impactWeight * massTerm * 3.4, 0, 9) * (outcome === 'dodge' || outcome === 'parry' ? 0 : 1);

  // Bleeding needs an edge, a real hit and a body that has blood in it.
  const dot: DotKind | null =
    (outcome === 'critical' || outcome === 'hit') && channel === 'slice' && res.slice > 0.8 && dmg > 6 ? 'bleed' : null;

  // Use-based improvement. A landed blow teaches most, an attempt teaches
  // something, and a parried blow teaches the defender instead (handled by the
  // caller, which awards `block` from its own side).
  const ADV: Record<Outcome, number> = {
    critical: 1.4, hit: 1, graze: 0.5, deflect: 0.35, block: 0.3, parry: 0.2, dodge: 0.25, immune: 0.1,
  };

  // Striking something harder than your blade ruins the blade.
  const tierGap = ARMOUR_TIER[d.armour] - MATERIAL_TIER[a.weapon.material];
  const wear = (outcome === 'dodge' ? 0.0002 : 0.0016) * (1 + Math.max(0, tierGap) * 0.5);

  return {
    outcome,
    damage: Math.max(0, dmg),
    stagger,
    recoil,
    knockback,
    weight: impactWeight,
    sparks: arm.sparks && (outcome === 'deflect' || outcome === 'block' || outcome === 'parry' || outcome === 'graze'),
    ring: outcome === 'parry' || outcome === 'block' ? (d.shield.id === 'none' ? arm.ring : ARMOURS[d.shield.material].ring) : arm.ring,
    dot,
    advance: ADV[outcome],
    wear,
  };
}

/* ------------------------------------------------------------ RPG bridge */

/**
 * The RPG layer owns skills, attributes, fatigue and item condition; combat
 * only reads them. It is authored by a different subsystem and may not exist
 * yet, so this binds by structural probe rather than by import: whatever
 * methods are present are used, whatever is missing falls back to a competent
 * novice. Combat must never be the reason the game fails to boot.
 */
export interface RpgBridge {
  skill(name: SkillName): number;
  attribute(name: 'strength' | 'agility' | 'endurance' | 'luck' | 'speed' | 'willpower'): number;
  /** 0..1 remaining fatigue. */
  fatigue(): number;
  /** Spend fatigue points. Returns the new 0..1 value. */
  spend(points: number): number;
  /** Use-based improvement: the whole reason to swing at a mudcrab for an hour. */
  advance(name: SkillName, amount: number): void;
  condition(itemId: string): number;
  wear(itemId: string, amount: number): void;
  /** Player health, 0..1 of max. */
  healthFraction(): number;
  hurt(points: number): void;
  /** True when the bridge is talking to a real RPG system rather than the stub. */
  readonly live: boolean;
}

type Probe = Partial<Record<string, unknown>> & System;
type Bag = Partial<Record<string, unknown>>;

/**
 * The names combat uses are its own; the RPG layer's are its own. This is the
 * only place the two vocabularies meet, and it is a table rather than a set of
 * calls so that a renamed skill on either side is one row to fix.
 */
const SKILL_ALIAS: Readonly<Record<SkillName, readonly string[]>> = {
  shortblade: ['shortblade', 'shortBlade'],
  longblade: ['longblade', 'longBlade'],
  blunt: ['blunt', 'bluntWeapon'],
  axe: ['axe'],
  spear: ['spear'],
  marksman: ['marksman'],
  handtohand: ['handtohand', 'handToHand'],
  block: ['block'],
  armour: ['armour', 'lightArmor', 'armorer'],
};

function fnOf<T extends unknown[]>(o: Bag | null, key: string): ((...a: T) => unknown) | null {
  if (o === null) return null;
  const v = o[key];
  return typeof v === 'function' ? (v as (...a: T) => unknown).bind(o) : null;
}
function numOf(o: Bag | null, key: string): number | null {
  if (o === null) return null;
  const v = o[key];
  return typeof v === 'number' ? v : null;
}
function bagOf(o: Bag | null, key: string): Bag | null {
  if (o === null) return null;
  const v = o[key];
  return typeof v === 'object' && v !== null ? (v as Bag) : null;
}

/**
 * Try every alias against a single-argument numeric getter. The first one that
 * returns a number wins, and the answer is cached by the caller, so a
 * mismatched vocabulary costs one failed call per skill per session.
 */
function tryAliases(get: ((id: string) => unknown) | null, aliases: readonly string[]): number | null {
  if (get === null) return null;
  for (const a of aliases) {
    const v = get(a);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/** Self-contained fallback so combat is playable with no RPG system present. */
class StubRpg implements RpgBridge {
  readonly live = false;
  private skills = new Map<string, number>();
  private cond = new Map<string, number>();
  private _fatigue = 1;
  private _health = 1;

  skill(name: SkillName): number {
    return this.skills.get(name) ?? 30;
  }
  attribute(): number {
    return 40;
  }
  fatigue(): number {
    return this._fatigue;
  }
  spend(points: number): number {
    this._fatigue = clamp(this._fatigue - points / 160, 0, 1);
    return this._fatigue;
  }
  advance(name: SkillName, amount: number): void {
    const cur = this.skills.get(name) ?? 30;
    // Diminishing returns with level, so a novice improves visibly in one fight
    // and a master does not gain a point from a rat.
    this.skills.set(name, Math.min(100, cur + (amount * 0.55) / (1 + cur * 0.06)));
  }
  condition(itemId: string): number {
    return this.cond.get(itemId) ?? 1;
  }
  wear(itemId: string, amount: number): void {
    this.cond.set(itemId, clamp((this.cond.get(itemId) ?? 1) - amount, 0, 1));
  }
  healthFraction(): number {
    return this._health;
  }
  hurt(points: number): void {
    this._health = clamp(this._health - points / 120, 0, 1);
  }
  regen(dt: number): void {
    this._fatigue = clamp(this._fatigue + dt * 0.055, 0, 1);
    this._health = clamp(this._health + dt * 0.004, 0, 1);
  }
  save(): Record<string, number> {
    const out: Record<string, number> = { fatigue: this._fatigue, health: this._health };
    for (const [k, v] of this.skills) out[`s:${k}`] = v;
    for (const [k, v] of this.cond) out[`c:${k}`] = v;
    return out;
  }
  load(data: Record<string, number>): void {
    this.skills.clear();
    this.cond.clear();
    for (const k of Object.keys(data)) {
      const v = data[k];
      if (k.startsWith('s:')) this.skills.set(k.slice(2), v);
      else if (k.startsWith('c:')) this.cond.set(k.slice(2), v);
    }
    this._fatigue = data.fatigue ?? 1;
    this._health = data.health ?? 1;
  }
}

/**
 * Adapter over a live RPG system, with the stub filling every hole.
 *
 * Two shapes are supported: a flat system that exposes `skill()`/`attribute()`
 * itself, and one that keeps them on a `character` object. Everything is probed
 * once and cached, so the per-swing cost is a property read.
 */
class BoundRpg implements RpgBridge {
  readonly live = true;
  private readonly sheet: Bag | null;
  private readonly getSkill: ((id: string) => unknown) | null;
  private readonly getAttr: ((id: string) => unknown) | null;
  private readonly note: ((id: string, kind: number, times: number) => unknown) | null;
  private readonly spendFatigue: ((n: number) => unknown) | null;
  private readonly hurtFn: ((n: number, e: null, physical: boolean) => unknown) | null;
  private readonly skillIds = new Map<SkillName, string>();

  constructor(
    private readonly stub: StubRpg,
    p: Probe,
  ) {
    const bag = p as Bag;
    this.sheet = bagOf(bag, 'character') ?? bag;
    this.getSkill = fnOf<[string]>(this.sheet, 'skill') as ((id: string) => unknown) | null;
    this.getAttr = fnOf<[string]>(this.sheet, 'attribute') as ((id: string) => unknown) | null;
    this.note = (fnOf<[string, number, number]>(bag, 'noteSkillUse') ??
      fnOf<[string, number, number]>(bag, 'advance') ??
      fnOf<[string, number, number]>(bag, 'useSkill')) as ((id: string, k: number, t: number) => unknown) | null;
    this.spendFatigue = (fnOf<[number]>(this.sheet, 'spendFatigue') ?? fnOf<[number]>(bag, 'spendFatigue')) as
      | ((n: number) => unknown)
      | null;
    this.hurtFn = (fnOf<[number, null, boolean]>(bag, 'damage') ?? fnOf<[number, null, boolean]>(bag, 'hurt')) as
      | ((n: number, e: null, physical: boolean) => unknown)
      | null;
  }

  /** Resolve and remember which of the aliases this RPG layer answers to. */
  private idFor(name: SkillName): string | null {
    const known = this.skillIds.get(name);
    if (known !== undefined) return known;
    if (this.getSkill === null) return null;
    for (const a of SKILL_ALIAS[name]) {
      const v = this.getSkill(a);
      if (typeof v === 'number' && Number.isFinite(v)) {
        this.skillIds.set(name, a);
        return a;
      }
    }
    return null;
  }

  skill(name: SkillName): number {
    const v = tryAliases(this.getSkill, SKILL_ALIAS[name]);
    return v ?? this.stub.skill(name);
  }
  attribute(name: 'strength' | 'agility' | 'endurance' | 'luck' | 'speed' | 'willpower'): number {
    const v = this.getAttr?.(name);
    return typeof v === 'number' ? v : 40;
  }
  fatigue(): number {
    const cur = numOf(this.sheet, 'fatigue');
    const max = numOf(this.sheet, 'maxFatigue');
    if (cur !== null && max !== null && max > 0) return clamp(cur / max, 0, 1);
    const mul = numOf(this.sheet, 'fatigueMul');
    if (mul !== null) return clamp((mul - 0.75) / 0.5, 0, 1);
    return this.stub.fatigue();
  }
  spend(points: number): number {
    if (this.spendFatigue !== null) {
      this.spendFatigue(points);
      return this.fatigue();
    }
    return this.stub.spend(points);
  }
  advance(name: SkillName, amount: number): void {
    const id = this.idFor(name);
    if (this.note !== null && id !== null) {
      // Use kinds are the RPG layer's own quantisation of practice; a full-power
      // landed blow is worth more than a swing at air, which is all combat can
      // usefully say about it.
      this.note(id, amount >= 1 ? 1 : 0, 1);
      return;
    }
    this.stub.advance(name, amount);
  }
  condition(itemId: string): number {
    return this.stub.condition(itemId);
  }
  wear(itemId: string, amount: number): void {
    this.stub.wear(itemId, amount);
  }
  healthFraction(): number {
    const cur = numOf(this.sheet, 'health');
    const max = numOf(this.sheet, 'maxHealth');
    if (cur !== null && max !== null && max > 0) return clamp(cur / max, 0, 1);
    return this.stub.healthFraction();
  }
  hurt(points: number): void {
    if (this.hurtFn !== null) this.hurtFn(points, null, true);
    else this.stub.hurt(points);
  }
}

export class Rpg {
  private readonly stub = new StubRpg();
  private bridge: RpgBridge;

  constructor() {
    this.bridge = this.stub;
  }

  /** Re-probe for an RPG system. Cheap; called once at init and once on demand. */
  bind(sys: System | undefined): void {
    if (sys === undefined) {
      this.bridge = this.stub;
      return;
    }
    this.bridge = new BoundRpg(this.stub, sys as Probe);
  }

  get it(): RpgBridge {
    return this.bridge;
  }

  /** Only the stub regenerates; a live RPG layer owns its own recovery curves. */
  tick(dt: number): void {
    if (!this.bridge.live) this.stub.regen(dt);
  }

  save(): Record<string, number> {
    return this.stub.save();
  }
  load(data: Record<string, number>): void {
    this.stub.load(data);
  }
}

/** Shield lookup that never throws on an unknown id. */
export function shieldOf(id: string): ShieldDef {
  return SHIELDS[id] ?? SHIELDS.none;
}
