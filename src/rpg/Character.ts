/**
 * The character sheet: eight attributes, twenty-seven skills, the derived
 * pools, and the Morrowind level-up loop that turns practice into permanent
 * growth. Nothing in here ever looks at the world's difficulty — the character
 * gets better, the world does not get harder.
 */
import {
  ATTRIBUTES,
  ATTRIBUTE_CAP,
  LEVEL_UP_PICKS,
  LEVEL_UP_SKILL_COUNT,
  LUCK_MAX_MULTIPLIER,
  SKILLS,
  SKILL_CAP,
  SKILL_DEFS,
  attributeMultiplier,
  clamp,
  fatigueTerm,
  progressRequired,
  zeroAttributes,
  zeroSkills,
} from './Attributes';
import type { AttributeId, AttributeSet, SkillClassKind, SkillId, SkillSet, UseKind } from './Attributes';
import { CLASS_DEFS, classify, isBuiltinClass, startingSkills } from './Classes';
import type { ClassDef } from './Classes';
import { lookupEffect } from './Effects';
import type { EffectId, EffectInstance } from './Effects';
import { BIRTHSIGN_DEFS, RACE_DEFS, raceAttributes } from './Races';
import type { BirthsignId, Gender, RaceId } from './Races';
import { Inventory } from './Inventory';
import type { InventorySave } from './Inventory';
import { SpellBook } from './Magic';
import type { SpellBookSave } from './Magic';
import type { ItemRegistry } from './Items';

export interface ActiveEffect {
  id: number;
  effect: EffectId;
  attribute?: AttributeId;
  skill?: SkillId;
  magnitude: number;
  /** Seconds left. Infinity for abilities and constant-effect enchantments. */
  remaining: number;
  /** Spell id, item uid or ability id — used by Dispel and by unequipping. */
  source: string;
  kind: 'spell' | 'ability' | 'item' | 'potion' | 'disease';
}

/** Summed, cached view of every active effect. Recomputed when the set changes. */
export interface Modifiers {
  fortifyAttribute: AttributeSet;
  drainAttribute: AttributeSet;
  fortifySkill: SkillSet;
  drainSkill: SkillSet;
  fortifyHealth: number;
  fortifyMagicka: number;
  fortifyFatigue: number;
  drainHealth: number;
  drainMagicka: number;
  drainFatigue: number;
  shield: number;
  sanctuary: number;
  chameleon: number;
  invisible: boolean;
  blind: number;
  feather: number;
  burden: number;
  jump: number;
  levitate: number;
  slowFall: number;
  swiftSwim: number;
  waterWalking: boolean;
  waterBreathing: boolean;
  light: number;
  nightEye: number;
  telekinesis: number;
  spellAbsorption: number;
  reflect: number;
  silenced: boolean;
  paralyzed: boolean;
  resist: Partial<Record<EffectId, number>>;
  weakness: Partial<Record<EffectId, number>>;
}

function zeroModifiers(): Modifiers {
  return {
    fortifyAttribute: zeroAttributes(),
    drainAttribute: zeroAttributes(),
    fortifySkill: zeroSkills(),
    drainSkill: zeroSkills(),
    fortifyHealth: 0,
    fortifyMagicka: 0,
    fortifyFatigue: 0,
    drainHealth: 0,
    drainMagicka: 0,
    drainFatigue: 0,
    shield: 0,
    sanctuary: 0,
    chameleon: 0,
    invisible: false,
    blind: 0,
    feather: 0,
    burden: 0,
    jump: 0,
    levitate: 0,
    slowFall: 0,
    swiftSwim: 0,
    waterWalking: false,
    waterBreathing: false,
    light: 0,
    nightEye: 0,
    telekinesis: 0,
    spellAbsorption: 0,
    reflect: 0,
    silenced: false,
    paralyzed: false,
    resist: {},
    weakness: {},
  };
}

/** Which resistance answers which damage effect. */
const RESIST_FOR: Partial<Record<EffectId, EffectId>> = {
  fireDamage: 'resistFire',
  frostDamage: 'resistFrost',
  shockDamage: 'resistShock',
  poison: 'resistPoison',
  paralyze: 'resistParalysis',
};

const WEAKNESS_FOR: Partial<Record<EffectId, EffectId>> = {
  fireDamage: 'weaknessToFire',
  frostDamage: 'weaknessToFrost',
  shockDamage: 'weaknessToShock',
  poison: 'weaknessToPoison',
};

export interface SkillUpEvent {
  skill: SkillId;
  level: number;
  name: string;
}

export interface LevelUpOffer {
  attribute: AttributeId;
  multiplier: 1 | 2 | 3 | 4 | 5;
  gains: number;
}

export interface CharacterSave {
  name: string;
  race: RaceId;
  gender: Gender;
  birthsign: BirthsignId;
  classId: string;
  customClass: ClassDef | null;
  attributes: AttributeSet;
  attributeDamage: AttributeSet;
  skills: SkillSet;
  skillProgress: SkillSet;
  booksRead: string[];
  level: number;
  levelProgress: number;
  attributeGains: AttributeSet;
  healthBase: number;
  health: number;
  magicka: number;
  fatigue: number;
  active: ActiveEffect[];
  effectSeq: number;
  inventory: InventorySave;
  spells: SpellBookSave;
  bounty: number;
  reputation: number;
  markX: number;
  markY: number;
  markZ: number;
  hasMark: boolean;
}

export class Character {
  name = 'Nerevarine';
  race: RaceId = 'dunmer';
  gender: Gender = 'male';
  birthsign: BirthsignId = 'warrior';
  klass: ClassDef = CLASS_DEFS.warrior;

  readonly attributes: AttributeSet = zeroAttributes();
  /** Damage Attribute wounds; healed by Restore Attribute or by resting. */
  readonly attributeDamage: AttributeSet = zeroAttributes();
  readonly skills: SkillSet = zeroSkills();
  readonly skillProgress: SkillSet = zeroSkills();
  /** Skill books teach once, ever. */
  readonly booksRead = new Set<string>();

  level = 1;
  /** Major/minor skill-ups banked toward the next level. */
  levelProgress = 0;
  readonly attributeGains: AttributeSet = zeroAttributes();

  healthBase = 0;
  health = 0;
  magicka = 0;
  fatigue = 0;

  bounty = 0;
  reputation = 0;
  hasMark = false;
  markX = 0;
  markY = 0;
  markZ = 0;

  readonly active: ActiveEffect[] = [];
  private effectSeq = 0;
  private mods: Modifiers = zeroModifiers();

  readonly inventory: Inventory;
  readonly spells = new SpellBook();

  constructor(reg: ItemRegistry) {
    this.inventory = new Inventory(reg);
  }

  /* ------------------------------------------------------------- creation */

  create(
    name: string,
    race: RaceId,
    gender: Gender,
    birthsign: BirthsignId,
    klass: ClassDef,
  ): void {
    this.name = name;
    this.race = race;
    this.gender = gender;
    this.birthsign = birthsign;
    this.klass = klass;

    const base = raceAttributes(race, gender);
    for (const a of ATTRIBUTES) {
      this.attributes[a] = base[a];
      this.attributeDamage[a] = 0;
      this.attributeGains[a] = 0;
    }
    const start = startingSkills(klass, race);
    for (const s of SKILLS) {
      this.skills[s] = clamp(start[s], 0, SKILL_CAP);
      this.skillProgress[s] = 0;
    }
    this.level = 1;
    this.levelProgress = 0;
    this.booksRead.clear();
    this.active.length = 0;

    // Racial and birthsign abilities are permanent effects, not stat edits, so
    // Dispel cannot strip them and the sheet can always explain where a number
    // came from.
    for (const gift of RACE_DEFS[race].innate) {
      if (gift.kind === 'ability') this.applyInnate(gift.id, gift.effects);
      else if (gift.kind === 'power') this.spells.define(this.powerSpell(gift.id, gift.name, gift.effects));
    }
    for (const gift of BIRTHSIGN_DEFS[birthsign].innate) {
      if (gift.kind === 'ability') this.applyInnate(gift.id, gift.effects);
      else if (gift.kind === 'power') this.spells.define(this.powerSpell(gift.id, gift.name, gift.effects));
    }
    for (const gift of [...RACE_DEFS[race].innate, ...BIRTHSIGN_DEFS[birthsign].innate]) {
      if (gift.kind === 'power') this.spells.learn(`power:${gift.id}`);
    }

    this.recompute();
    this.healthBase = (this.attribute('strength') + this.attribute('endurance')) * 0.5;
    this.health = this.maxHealth;
    this.magicka = this.maxMagicka;
    this.fatigue = this.maxFatigue;
  }

  private powerSpell(id: string, name: string, effects: readonly EffectInstance[]) {
    return {
      id: `power:${id}`,
      name,
      kind: 'power' as const,
      effects,
      cost: 0,
      autoCost: false,
      custom: false,
    };
  }

  private applyInnate(id: string, effects: readonly EffectInstance[]): void {
    for (const e of effects) {
      this.active.push({
        id: ++this.effectSeq,
        effect: e.effect,
        attribute: e.attribute,
        skill: e.skill,
        magnitude: e.magMax,
        remaining: Infinity,
        source: `ability:${id}`,
        kind: 'ability',
      });
    }
  }

  /* ------------------------------------------------------------ derived */

  get modifiers(): Readonly<Modifiers> {
    return this.mods;
  }

  attribute(id: AttributeId): number {
    const m = this.mods;
    return clamp(
      this.attributes[id] - this.attributeDamage[id] + m.fortifyAttribute[id] - m.drainAttribute[id],
      0,
      ATTRIBUTE_CAP + m.fortifyAttribute[id],
    );
  }

  skill(id: SkillId): number {
    const m = this.mods;
    return Math.max(0, this.skills[id] + m.fortifySkill[id] - m.drainSkill[id]);
  }

  get magickaMultiplier(): number {
    return BIRTHSIGN_DEFS[this.birthsign].magickaMult;
  }

  get maxHealth(): number {
    return Math.max(1, Math.floor(this.healthBase + this.mods.fortifyHealth - this.mods.drainHealth));
  }

  get maxMagicka(): number {
    return Math.max(
      0,
      Math.floor(this.attribute('intelligence') * this.magickaMultiplier + this.mods.fortifyMagicka - this.mods.drainMagicka),
    );
  }

  get maxFatigue(): number {
    return Math.max(
      1,
      Math.floor(
        this.attribute('strength') +
          this.attribute('willpower') +
          this.attribute('agility') +
          this.attribute('endurance') +
          this.mods.fortifyFatigue -
          this.mods.drainFatigue,
      ),
    );
  }

  /** 0.75 exhausted, 1.25 fresh. Multiplies nearly every roll in the game. */
  get fatigueMul(): number {
    return fatigueTerm(this.fatigue, this.maxFatigue);
  }

  get encumbranceLoad(): number {
    const cap = this.inventory.capacity(this.attribute('strength'), this.mods.feather, this.mods.burden);
    return cap <= 0 ? 1 : clamp(this.inventory.weight / cap, 0, 1);
  }

  get mobility(): number {
    return this.inventory.mobility(this.attribute('strength'), this.mods.feather, this.mods.burden);
  }

  get dead(): boolean {
    return this.health <= 0;
  }

  /* ------------------------------------------------------------- effects */

  addEffect(
    effect: EffectId,
    magnitude: number,
    duration: number,
    source: string,
    kind: ActiveEffect['kind'],
    attribute?: AttributeId,
    skill?: SkillId,
  ): ActiveEffect {
    const e: ActiveEffect = {
      id: ++this.effectSeq,
      effect,
      attribute,
      skill,
      magnitude,
      remaining: duration,
      source,
      kind,
    };
    this.active.push(e);
    this.recompute();
    return e;
  }

  removeSource(source: string): number {
    let n = 0;
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i].source === source) {
        this.active.splice(i, 1);
        n++;
      }
    }
    if (n) this.recompute();
    return n;
  }

  /**
   * Dispel strips temporary magic it can overpower. Abilities and constant
   * effects survive — you cannot dispel being a Dunmer.
   */
  dispel(power: number): number {
    let n = 0;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      if (e.kind === 'ability' || e.remaining === Infinity) continue;
      if (power < e.magnitude) continue;
      this.active.splice(i, 1);
      n++;
    }
    if (n) this.recompute();
    return n;
  }

  tickEffects(dt: number): void {
    if (this.active.length === 0) return;
    let changed = false;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      if (e.remaining === Infinity) continue;
      e.remaining -= dt;
      if (e.remaining <= 0) {
        this.active.splice(i, 1);
        changed = true;
      }
    }
    if (changed) this.recompute();
  }

  recompute(): void {
    const m = zeroModifiers();
    for (const e of this.active) {
      // recompute() runs every frame something changes, over effects that may
      // have come out of a save file; an unresolvable one is inert, not fatal.
      const def = lookupEffect(e.effect);
      if (!def) continue;
      const mag = e.magnitude;
      switch (def.mode) {
        case 'fortifyAttribute':
          if (e.attribute) m.fortifyAttribute[e.attribute] += mag;
          break;
        case 'drainAttribute':
          if (e.attribute) m.drainAttribute[e.attribute] += mag;
          break;
        case 'fortifySkill':
          if (e.skill) m.fortifySkill[e.skill] += mag;
          break;
        case 'drainSkill':
          if (e.skill) m.drainSkill[e.skill] += mag;
          break;
        case 'fortifyHealth':
          m.fortifyHealth += mag;
          break;
        case 'fortifyMagicka':
          m.fortifyMagicka += mag;
          break;
        case 'fortifyFatigue':
          m.fortifyFatigue += mag;
          break;
        case 'drainHealth':
          m.drainHealth += mag;
          break;
        case 'drainMagicka':
          m.drainMagicka += mag;
          break;
        case 'drainFatigue':
          m.drainFatigue += mag;
          break;
        case 'shield':
          m.shield += mag;
          break;
        case 'sanctuary':
          m.sanctuary += mag;
          break;
        case 'chameleon':
          m.chameleon += mag;
          break;
        case 'invisibility':
          m.invisible = true;
          break;
        case 'blind':
          m.blind += mag;
          break;
        case 'feather':
          m.feather += mag;
          break;
        case 'burden':
          m.burden += mag;
          break;
        case 'jump':
          m.jump += mag;
          break;
        case 'levitate':
          m.levitate += mag;
          break;
        case 'slowFall':
          m.slowFall += mag;
          break;
        case 'swiftSwim':
          m.swiftSwim += mag;
          break;
        case 'waterWalking':
          m.waterWalking = true;
          break;
        case 'waterBreathing':
          m.waterBreathing = true;
          break;
        case 'light':
          m.light += mag;
          break;
        case 'nightEye':
          m.nightEye += mag;
          break;
        case 'telekinesis':
          m.telekinesis += mag;
          break;
        case 'spellAbsorption':
          m.spellAbsorption += mag;
          break;
        case 'reflect':
          m.reflect += mag;
          break;
        case 'silence':
          m.silenced = true;
          break;
        case 'paralyze':
          m.paralyzed = true;
          break;
        case 'resist':
          m.resist[e.effect] = (m.resist[e.effect] ?? 0) + mag;
          break;
        case 'weakness':
          m.weakness[e.effect] = (m.weakness[e.effect] ?? 0) + mag;
          break;
        default:
          break;
      }
    }
    this.mods = m;
    // Pools can only shrink into a smaller maximum, never silently exceed it.
    this.health = Math.min(this.health, this.maxHealth);
    this.magicka = Math.min(this.magicka, this.maxMagicka);
    this.fatigue = Math.min(this.fatigue, this.maxFatigue);
  }

  /**
   * Resistance and weakness stack the way Morrowind's do — additively, and
   * without a floor at zero, so 100% Weakness to Fire really does double the
   * damage and the Lord birthsign really is a liability.
   */
  resistanceFactor(effect: EffectId): number {
    const r = RESIST_FOR[effect];
    const w = WEAKNESS_FOR[effect];
    const resist = r ? (this.mods.resist[r] ?? 0) : 0;
    const weak = w ? (this.mods.weakness[w] ?? 0) : 0;
    // Resist Magicka applies on top of the elemental line, because every one of
    // these arrives as a spell.
    const magickaResist = this.mods.resist.resistMagicka ?? 0;
    const magickaWeak = this.mods.weakness.weaknessToMagicka ?? 0;
    const net = resist - weak + magickaResist - magickaWeak;
    return Math.max(0, 1 - net / 100);
  }

  /* -------------------------------------------------------------- pools */

  /** Returns damage actually taken after Shield and resistance. */
  damage(amount: number, effect: EffectId | null = null): number {
    let dmg = amount;
    if (effect) dmg *= this.resistanceFactor(effect);
    // Shield is a flat percentage reduction, as it is in the source material.
    dmg *= Math.max(0, 1 - this.mods.shield / 100);
    dmg = Math.max(0, dmg);
    this.health = Math.max(0, this.health - dmg);
    return dmg;
  }

  heal(amount: number): number {
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + Math.max(0, amount));
    return this.health - before;
  }

  spendMagicka(amount: number): boolean {
    if (this.magicka < amount) return false;
    this.magicka -= amount;
    return true;
  }

  restoreMagicka(amount: number): number {
    const before = this.magicka;
    this.magicka = Math.min(this.maxMagicka, this.magicka + Math.max(0, amount));
    return this.magicka - before;
  }

  spendFatigue(amount: number): void {
    this.fatigue = Math.max(0, this.fatigue - Math.max(0, amount));
  }

  restoreFatigue(amount: number): number {
    const before = this.fatigue;
    this.fatigue = Math.min(this.maxFatigue, this.fatigue + Math.max(0, amount));
    return this.fatigue - before;
  }

  damageAttribute(id: AttributeId, amount: number): void {
    this.attributeDamage[id] = clamp(this.attributeDamage[id] + amount, 0, ATTRIBUTE_CAP);
    this.recompute();
  }

  restoreAttribute(id: AttributeId, amount: number): void {
    this.attributeDamage[id] = clamp(this.attributeDamage[id] - amount, 0, ATTRIBUTE_CAP);
    this.recompute();
  }

  /* ---------------------------------------------------------- progression */

  classOf(skill: SkillId): SkillClassKind {
    return classify(this.klass, skill);
  }

  /**
   * Practice. Returns the skill-up if one happened. Every skill counts toward
   * its governing attribute's level-up multiplier; only major and minor skills
   * move the level bar — which is why a well-planned character levels slowly
   * and a badly-planned one levels fast and weak.
   */
  useSkill(skill: SkillId, kind: UseKind = 0, times = 1): SkillUpEvent | null {
    const def = SKILL_DEFS[skill];
    const gain = def.use[kind] * times;
    if (gain <= 0) return null;
    if (this.skills[skill] >= SKILL_CAP) return null;

    const cls = this.classOf(skill);
    const specialised = def.spec === this.klass.spec;
    this.skillProgress[skill] += gain;

    let event: SkillUpEvent | null = null;
    for (let guard = 0; guard < 32; guard++) {
      const need = progressRequired(this.skills[skill], cls, specialised);
      if (this.skillProgress[skill] < need) break;
      this.skillProgress[skill] -= need;
      this.skills[skill] = Math.min(SKILL_CAP, this.skills[skill] + 1);
      this.attributeGains[def.attribute]++;
      if (cls !== 'misc') this.levelProgress++;
      event = { skill, level: this.skills[skill], name: def.name };
      if (this.skills[skill] >= SKILL_CAP) break;
    }
    return event;
  }

  /** Raises a skill outright — trainers, skill books, quest rewards. */
  trainSkill(skill: SkillId, points = 1): SkillUpEvent | null {
    if (this.skills[skill] >= SKILL_CAP) return null;
    const def = SKILL_DEFS[skill];
    const cls = this.classOf(skill);
    for (let i = 0; i < points; i++) {
      if (this.skills[skill] >= SKILL_CAP) break;
      this.skills[skill]++;
      this.attributeGains[def.attribute]++;
      if (cls !== 'misc') this.levelProgress++;
    }
    return { skill, level: this.skills[skill], name: def.name };
  }

  get pendingLevelUp(): boolean {
    return this.levelProgress >= LEVEL_UP_SKILL_COUNT;
  }

  /**
   * What the level-up screen offers. The multiplier is earned by the skills you
   * actually practised, not chosen — this is the mechanic the whole progression
   * system exists to serve.
   */
  levelUpOffers(): readonly LevelUpOffer[] {
    return ATTRIBUTES.map((a) => {
      const gains = this.attributeGains[a];
      const mult = a === 'luck' ? LUCK_MAX_MULTIPLIER : attributeMultiplier(gains);
      return { attribute: a, multiplier: mult as 1 | 2 | 3 | 4 | 5, gains };
    });
  }

  /** Applies a level-up. Rejects the wrong number of picks or duplicates. */
  levelUp(picks: readonly AttributeId[]): { level: number; raised: { attribute: AttributeId; by: number }[] } | null {
    if (!this.pendingLevelUp) return null;
    if (picks.length !== LEVEL_UP_PICKS) return null;
    if (new Set(picks).size !== picks.length) return null;

    const offers = new Map(this.levelUpOffers().map((o) => [o.attribute, o.multiplier]));
    const raised: { attribute: AttributeId; by: number }[] = [];
    for (const a of picks) {
      const by = Math.min(offers.get(a) ?? 1, ATTRIBUTE_CAP - this.attributes[a]);
      if (by > 0) this.attributes[a] += by;
      raised.push({ attribute: a, by: Math.max(0, by) });
    }

    this.level++;
    this.levelProgress -= LEVEL_UP_SKILL_COUNT;
    for (const a of ATTRIBUTES) this.attributeGains[a] = 0;
    // Endurance at the moment of levelling is what buys health, which is why
    // veterans raise Endurance early and regret it if they do not.
    this.healthBase += this.attributes.endurance * 0.1;
    this.recompute();
    this.health = Math.min(this.maxHealth, this.health + this.attributes.endurance * 0.1);
    return { level: this.level, raised };
  }

  /** Sleeping restores everything and heals attribute damage slowly. */
  rest(hours: number): void {
    const h = Math.max(0, hours);
    this.health = Math.min(this.maxHealth, this.health + this.maxHealth * 0.1 * h * (this.attribute('endurance') / 50));
    this.magicka = Math.min(this.maxMagicka, this.magicka + this.maxMagicka * 0.2 * h);
    this.fatigue = this.maxFatigue;
    for (const a of ATTRIBUTES) {
      this.attributeDamage[a] = Math.max(0, this.attributeDamage[a] - h);
    }
    this.recompute();
  }

  /* --------------------------------------------------------------- save */

  serialise(): CharacterSave {
    return {
      name: this.name,
      race: this.race,
      gender: this.gender,
      birthsign: this.birthsign,
      classId: this.klass.id,
      customClass: this.klass.custom ? this.klass : null,
      attributes: { ...this.attributes },
      attributeDamage: { ...this.attributeDamage },
      skills: { ...this.skills },
      skillProgress: { ...this.skillProgress },
      booksRead: [...this.booksRead],
      level: this.level,
      levelProgress: this.levelProgress,
      attributeGains: { ...this.attributeGains },
      healthBase: this.healthBase,
      health: this.health,
      magicka: this.magicka,
      fatigue: this.fatigue,
      active: this.active.map((e) => ({ ...e, remaining: e.remaining === Infinity ? -1 : e.remaining })),
      effectSeq: this.effectSeq,
      inventory: this.inventory.serialise(),
      spells: this.spells.serialise(),
      bounty: this.bounty,
      reputation: this.reputation,
      markX: this.markX,
      markY: this.markY,
      markZ: this.markZ,
      hasMark: this.hasMark,
    };
  }

  deserialise(s: CharacterSave): void {
    this.name = s.name;
    this.race = s.race;
    this.gender = s.gender;
    this.birthsign = s.birthsign;
    this.klass = s.customClass ?? (isBuiltinClass(s.classId) ? CLASS_DEFS[s.classId] : CLASS_DEFS.warrior);
    for (const a of ATTRIBUTES) {
      this.attributes[a] = s.attributes[a];
      this.attributeDamage[a] = s.attributeDamage[a];
      this.attributeGains[a] = s.attributeGains[a];
    }
    for (const k of SKILLS) {
      this.skills[k] = s.skills[k];
      this.skillProgress[k] = s.skillProgress[k];
    }
    this.booksRead.clear();
    for (const b of s.booksRead) this.booksRead.add(b);
    this.level = s.level;
    this.levelProgress = s.levelProgress;
    this.healthBase = s.healthBase;
    this.effectSeq = s.effectSeq;
    this.active.length = 0;
    for (const e of s.active) this.active.push({ ...e, remaining: e.remaining < 0 ? Infinity : e.remaining });
    this.inventory.deserialise(s.inventory);
    // Powers are re-registered from the race/birthsign tables before the
    // spellbook is restored, so a save never has to carry them.
    for (const gift of [...RACE_DEFS[this.race].innate, ...BIRTHSIGN_DEFS[this.birthsign].innate]) {
      if (gift.kind === 'power') this.spells.define(this.powerSpell(gift.id, gift.name, gift.effects));
    }
    this.spells.deserialise(s.spells);
    this.bounty = s.bounty;
    this.reputation = s.reputation;
    this.markX = s.markX;
    this.markY = s.markY;
    this.markZ = s.markZ;
    this.hasMark = s.hasMark;
    this.recompute();
    this.health = s.health;
    this.magicka = s.magicka;
    this.fatigue = s.fatigue;
  }
}
