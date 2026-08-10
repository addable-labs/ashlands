import * as THREE from 'three';
import type { IPlayer } from '../core/contracts';
import type { Ctx, System } from '../core/types';

import {
  ATTRIBUTES,
  SKILLS,
  SKILL_DEFS,
  clamp,
} from './Attributes';
import type { AttributeId, SkillId, UseKind } from './Attributes';
import { CLASS_DEFS, makeCustomClass } from './Classes';
import type { ClassDef } from './Classes';
import { Character } from './Character';
import type { CharacterSave } from './Character';
import {
  ARMOR_WEAR_PER_HIT,
  FATIGUE_PER_JUMP,
  FATIGUE_PER_SWING,
  FATIGUE_REGEN_BASE,
  FATIGUE_RUN_PER_SECOND,
  FATIGUE_SWIM_PER_SECOND,
  SNEAK_DAMAGE_MULT,
  WEAPON_WEAR_PER_HIT,
  armorSoak,
  handToHandDamage,
  hitChance,
  strengthMultiplier,
  swingStrength,
  weaponDamage,
} from './Combat';
import type { SwingType } from './Combat';
import { describeEffect, lookupEffect, parseEffects, spellCost } from './Effects';
import type { EffectId, EffectInstance, EffectLike } from './Effects';
import { NO_APPARATUS, brew, eatIngredient, knownEffectCount, readIngredient } from './Alchemy';
import type { Apparatus, BrewResult } from './Alchemy';
import { drawCharge, enchant, recharge, soulValueFor } from './Enchant';
import type { Enchantable, EnchantResult } from './Enchant';
import {
  FLORA_INGREDIENTS,
  ItemRegistry,
  SLOTS,
  enchantmentOf,
  isArmor,
  isWeapon,
  maxConditionOf,
  resetUidSeq,
  peekUidSeq,
  rollLoot,
} from './Items';
import type { ItemDef, ItemStack, SlotId } from './Items';
import { castChance, spellSkill } from './Magic';
import type { Spell } from './Magic';
import { BIRTHSIGN_DEFS, RACE_DEFS } from './Races';
import type { BirthsignId, Gender, RaceId } from './Races';
import {
  REST_COMBAT_LOCKOUT,
  REST_HOSTILE_RADIUS,
  REST_MAX_HOURS,
  blocksRest,
  refusalMessage,
  restGains,
  summaryMessage,
} from './Rest';
import type { RestKind, RestRefusal, RestResult, RestRestored, RestThreat } from './Rest';
import { Rng } from './Rng';

/**
 * Structural views of the systems this one talks to. Declared here rather than
 * imported so the RPG layer never depends on another subsystem's file.
 */
interface ActorLike {
  id: number;
  kind: string;
  position: THREE.Vector3;
  health: number;
  maxHealth: number;
  faction: string;
  alive: boolean;
}
interface ActorsLike extends System {
  all(): readonly ActorLike[];
  nearest(p: THREE.Vector3, maxDist: number): ActorLike | null;
  damage(a: ActorLike, amount: number, dir: THREE.Vector3): void;
}
interface VFXLike extends System {
  spawn(effect: string, position: THREE.Vector3, dir?: THREE.Vector3): void;
  beam(from: THREE.Vector3, to: THREE.Vector3, kind: string, seconds: number): void;
}
interface PlayerLike extends IPlayer {
  levitate: boolean;
  waterWalk: boolean;
  readonly swimming: boolean;
}

export interface StatsSnapshot {
  name: string;
  race: RaceId;
  gender: Gender;
  birthsign: BirthsignId;
  className: string;
  level: number;
  levelProgress: number;
  pendingLevelUp: boolean;
  health: number;
  maxHealth: number;
  magicka: number;
  maxMagicka: number;
  fatigue: number;
  maxFatigue: number;
  encumbrance: number;
  capacity: number;
  mobility: number;
  attributes: Record<AttributeId, number>;
  skills: Record<SkillId, number>;
  armorRating: number;
  readySpell: string | null;
  gold: number;
}

export type CastOutcome =
  | { ok: true; spell: string; cost: number; target: 'self' | 'touch' | 'target' }
  | { ok: false; reason: 'no-spell' | 'unknown' | 'silenced' | 'no-magicka' | 'fizzle' | 'spent' };

export interface RPGSave {
  version: 1;
  character: CharacterSave;
  registry: { seq: number; defs: ItemDef[] };
  rng: number;
  uidSeq: number;
}

const SAVE_KEY = 'ashlands.rpg.save';

/** Attack input is a hold-and-release swing, like the source material. */
const MAX_CHARGE_SECONDS = 1.6;

const KEY_CAST = 'KeyR';
const KEY_NEXT_SPELL = 'BracketRight';
const KEY_PREV_SPELL = 'BracketLeft';
const KEY_LEVEL = 'KeyL';

const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _from = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export class RPGSystem implements System {
  readonly id = 'rpg';
  readonly order = 80;

  readonly registry = new ItemRegistry();
  readonly character = new Character(this.registry);
  readonly rng = new Rng(0x5eed1a11);

  private ctx: Ctx | null = null;
  private player: PlayerLike | null = null;
  private actors: ActorsLike | null = null;
  private vfx: VFXLike | null = null;

  private charging = false;
  private charge = 0;
  private swingCooldown = 0;
  private castCooldown = 0;
  private lastMobility = 1;
  private statsAccum = 0;
  private athleticsAccum = 0;
  private lastLevitate = false;
  private lastWaterWalk = false;
  private announcedLevel = false;
  private probedCombat = false;
  /** `ctx.time.elapsed` until which the player counts as "still in the fight". */
  private combatUntil = 0;
  /** Actor id -> elapsed time until which it counts as personally provoked. */
  private readonly provoked = new Map<number, number>();
  /**
   * A bed has authorised one level-up. Set by sleeping in a bed with a level
   * earned, spent by `levelUp()`. This is the enforcement of the series rule
   * that you advance in your sleep and nowhere else.
   */
  private sleepCredit = false;
  /** True for the duration of a rest, so the report cannot re-enter the command. */
  private resting = false;
  /** False once a dedicated combat system is present to own the mouse. */
  private ownsAttackInput = true;
  /** Bus unsubscribers, so a dispose/re-init cycle cannot double-handle events. */
  private readonly subs: (() => void)[] = [];

  /* ---------------------------------------------------------------- boot */

  init(ctx: Ctx): void {
    this.ctx = ctx;

    this.character.create('Veyrane', 'dunmer', 'male', 'warrior', CLASS_DEFS.warrior);
    this.giveStartingKit();

    this.subs.push(
      ctx.bus.on<{ impact: number; surface: number }>('player:land', (p) => this.onLand(p.impact)),
      ctx.bus.on<{ spell?: string }>('rpg:cast', (p) => void this.cast(p?.spell)),
      ctx.bus.on<{ amount: number; effect?: EffectId; physical?: boolean }>('rpg:damage', (p) =>
        void this.damage(p.amount, p.effect ?? null, p.physical === true),
      ),
      // Any system that makes the player do something skilful says so here rather
      // than reaching into the character sheet.
      ctx.bus.on<{ skill: SkillId; kind?: UseKind; times?: number }>('rpg:skilluse', (p) => {
        if (p && SKILL_DEFS[p.skill]) this.noteSkillUse(p.skill, p.kind ?? 0, p.times ?? 1);
      }),
      // Resting and waiting. The interface owns the key and the bed prompt; this
      // layer owns whether it is allowed and what it is worth.
      // 'rpg:rest'/'rpg:wait' are commands in; 'rpg:rested' is the report out.
      // Separate names, plus a re-entrancy guard, so a listener that rests from
      // inside the report cannot drive the loop back through itself.
      ctx.bus.on<{ hours?: number; inBed?: boolean; picks?: AttributeId[] }>('rpg:rest', (p) => {
        if (this.resting) return;
        this.rest(p?.hours ?? 8, p?.inBed === true, p?.picks);
      }),
      ctx.bus.on<{ hours?: number }>('rpg:wait', (p) => {
        if (this.resting) return;
        this.wait(p?.hours ?? 1);
      }),
      // Anything that decides the player has picked a fight with a particular
      // actor says so here; that actor then blocks rest even if its faction is
      // otherwise placid.
      ctx.bus.on<{ actor?: number }>('rpg:provoked', (p) => {
        if (typeof p?.actor === 'number') this.markCombat(p.actor);
      }),
      // Picking a plant. The world owns which plant was clicked; this layer
      // owns what a plant is worth, so the payload is only a species id.
      ctx.bus.on<{ species?: string; count?: number }>('world:harvest', (p) => {
        if (p?.species) this.harvest(p.species, p.count ?? 0);
      }),
      // Shared save convention: whoever owns the save screen fires these.
      ctx.bus.on<{ data: Record<string, unknown> }>('save:collect', (p) => {
        if (p?.data) p.data.rpg = this.serialise();
      }),
      ctx.bus.on<{ data: Record<string, unknown> }>('save:apply', (p) => {
        const s = p?.data?.rpg;
        if (s !== undefined) this.deserialise(s as RPGSave);
      }),
    );

    // The debug console is the only "UI" this subsystem ships; a real inventory
    // screen belongs to whoever owns src/ui.
    const api = {
      rpg: this,
      character: this.character,
      sheet: () => this.stats(),
    };
    Object.assign(globalThis as unknown as Record<string, unknown>, api);

    this.publishStats(ctx);
  }

  private resolveDeps(ctx: Ctx): void {
    if (!this.player) this.player = ctx.get<PlayerLike>('player') ?? null;
    if (!this.actors) this.actors = ctx.get<ActorsLike>('actors') ?? null;
    if (!this.vfx) this.vfx = ctx.get<VFXLike>('vfx') ?? null;
    if (!this.probedCombat) {
      this.probedCombat = true;
      // A dedicated combat system, if one is registered, owns the mouse and the
      // swing simulation; this layer then only supplies the numbers it asks for
      // via 'rpg:skilluse' and 'rpg:damage'.
      this.ownsAttackInput = ctx.get<System>('combat') === undefined;
    }
  }

  /**
   * A class-appropriate kit. Deliberately modest: the world is not scaled to
   * the player, so what you start with is what you scraped together, not what
   * the encounter budget says you deserve.
   */
  private giveStartingKit(): void {
    const c = this.character;
    const inv = c.inventory;
    const best = (skills: readonly SkillId[]): SkillId =>
      skills.reduce((a, b) => (c.skills[a] >= c.skills[b] ? a : b));

    const weaponFor: Readonly<Partial<Record<SkillId, string>>> = {
      longBlade: 'weapon:iron:longsword',
      shortBlade: 'weapon:iron:shortsword',
      bluntWeapon: 'weapon:iron:club',
      axe: 'weapon:iron:warAxe',
      spear: 'weapon:chitin:spear',
      marksman: 'weapon:iron:shortBow',
      handToHand: undefined,
    };
    const armorFor: Readonly<Partial<Record<SkillId, readonly string[]>>> = {
      heavyArmor: ['armor:iron:cuirass', 'armor:iron:helm', 'armor:iron:boots'],
      mediumArmor: ['armor:bonemold:cuirass', 'armor:bonemold:boots'],
      lightArmor: ['armor:chitin:cuirass', 'armor:chitin:boots'],
    };

    // A missing row is a table bug, not a reason to start the game naked, so
    // every grant is best-effort and the character keeps whatever resolved.
    const give = (id: string, count = 1, wear = false): void => {
      const stack = inv.addById(id, count);
      if (stack && wear) inv.equip(stack.uid);
    };

    const wSkill = best(['longBlade', 'shortBlade', 'bluntWeapon', 'axe', 'spear', 'marksman', 'handToHand']);
    const wId = weaponFor[wSkill];
    if (wId) give(wId, 1, true);

    const aSkill = best(['heavyArmor', 'mediumArmor', 'lightArmor']);
    for (const id of armorFor[aSkill] ?? []) give(id, 1, true);

    give('clothing:commonShirt', 1, true);
    give('clothing:commonPants', 1, true);
    give('clothing:commonShoes', 1, true);

    give('tool:armorersHammer');
    give('tool:apprenticeLockpick');
    give('app:mortarApprentice');
    give('misc:torch', 2);
    give('misc:soulgemPetty', 2);

    // A pouch of common flora. Two of these share Restore Fatigue and two more
    // share Restore Health, so the first mortar session teaches the rule the
    // whole of alchemy runs on without the player having to forage first.
    give('ingredient:ashYam', 3);
    give('ingredient:saltrice', 3);
    give('ingredient:scribJelly', 2);
    give('ingredient:corkbulb', 2);
    give('ingredient:marshmerrow', 2);
    give('ingredient:stoneflower', 2);
    give('ingredient:trama', 2);
    inv.gold = 60;

    // Two spells whose schools match the class, so every build can cast something.
    const magicSkills: readonly SkillId[] = ['destruction', 'restoration', 'alteration', 'illusion', 'mysticism', 'conjuration'];
    const school = best(magicSkills);
    const opening: Readonly<Record<string, readonly string[]>> = {
      destruction: ['spell:fireBite', 'spell:frostBite'],
      restoration: ['spell:healing', 'spell:cureCommon'],
      alteration: ['spell:ondusiOpen', 'spell:leaping'],
      illusion: ['spell:lightSpell', 'spell:calm'],
      mysticism: ['spell:soultrap', 'spell:almsivi'],
      conjuration: ['spell:boundDagger', 'spell:summonScamp'],
    };
    for (const id of opening[school] ?? []) c.spells.learn(id);
    c.spells.learn('spell:healing');
    c.recompute();
    c.health = c.maxHealth;
    c.magicka = c.maxMagicka;
    c.fatigue = c.maxFatigue;
  }

  /* -------------------------------------------------------------- update */

  update(ctx: Ctx): void {
    const dt = ctx.time.dt;
    if (dt <= 0) return;
    this.resolveDeps(ctx);

    const c = this.character;
    c.tickEffects(dt);
    this.regen(dt);
    this.exertion(dt);
    this.driveMobility(ctx);
    this.driveMagicalMovement();

    this.swingCooldown = Math.max(0, this.swingCooldown - dt);
    this.castCooldown = Math.max(0, this.castCooldown - dt);

    this.readInput(ctx, dt);

    // Earning a level is not gaining one. The bar fills in the field; it is
    // paid out in a bed, and only there — so this announces the debt and the
    // 'rpg:levelup:ready' that opens the pick-three panel waits for the sleep.
    if (c.pendingLevelUp && !this.announcedLevel) {
      this.announcedLevel = true;
      ctx.bus.emit('notify', {
        text: `You have learned enough to advance. Sleep in a bed to reach level ${c.level + 1}. [L]`,
        kind: 'quest',
      });
    }

    this.statsAccum += dt;
    if (this.statsAccum > 0.25) {
      this.statsAccum = 0;
      this.publishStats(ctx);
    }
  }

  /**
   * Fatigue is the master resource: it regenerates fast when you stand still
   * and gates everything when it does not. Magicka regenerates slowly off
   * Willpower — unless you are an Atronach, who regenerates none at all and
   * must drink it from other people's spells.
   *
   * HEALTH IS DELIBERATELY ABSENT and must stay absent. A wound closes by
   * sleeping (`rest`), by a Restore Health effect, or not at all; if it also
   * closed by walking around, no fight would ever have a lasting cost. See
   * Rest.ts.
   */
  private regen(dt: number): void {
    const c = this.character;
    const player = this.player;
    const moving = player ? _tmp.copy(player.velocity).setY(0).length() > 0.5 : false;
    const rate = FATIGUE_REGEN_BASE * (0.4 + c.attribute('endurance') / 100) * (moving ? 0.25 : 1);
    c.restoreFatigue(rate * dt);

    const regen = BIRTHSIGN_DEFS[c.birthsign].magickaRegen;
    if (regen > 0 && c.magicka < c.maxMagicka) {
      c.restoreMagicka(regen * (0.4 + c.attribute('willpower') / 120) * dt);
    }
  }

  /** Running, swimming and jumping cost fatigue and train Athletics. */
  private exertion(dt: number): void {
    const player = this.player;
    if (!player) return;
    const c = this.character;
    const speed = _tmp.copy(player.velocity).setY(0).length();
    if (speed < 0.5) return;

    const swimming = player.swimming;
    const running = speed > 3.4;
    if (swimming) {
      c.spendFatigue(FATIGUE_SWIM_PER_SECOND * dt);
      this.trainAthletics(dt, 1);
    } else if (running) {
      c.spendFatigue(FATIGUE_RUN_PER_SECOND * dt * (1 + c.encumbranceLoad));
      this.trainAthletics(dt, 0);
    }
  }

  private trainAthletics(dt: number, kind: UseKind): void {
    // Batch the tiny per-second increments so a skill-up is one clean event.
    this.athleticsAccum += dt;
    if (this.athleticsAccum < 1) return;
    const whole = Math.floor(this.athleticsAccum);
    this.athleticsAccum -= whole;
    this.noteSkillUse('athletics', kind, whole);
  }

  /** Encumbrance and Burden slow you; at capacity you do not move at all. */
  private driveMobility(ctx: Ctx): void {
    const m = this.character.mobility;
    if (Math.abs(m - this.lastMobility) < 0.01) return;
    const wasStuck = this.lastMobility <= 0;
    this.lastMobility = m;
    // The player controller owns locomotion; it reads this to scale speed.
    ctx.bus.emit('rpg:mobility', { factor: m });
    if (m <= 0 && !wasStuck) {
      ctx.bus.emit('notify', { text: 'You are carrying too much to move.', kind: 'warn' });
    }
  }

  /** Spell effects that the player controller already knows how to honour. */
  private driveMagicalMovement(): void {
    const player = this.player;
    if (!player) return;
    const m = this.character.modifiers;
    const lev = m.levitate > 0;
    if (lev !== this.lastLevitate) {
      this.lastLevitate = lev;
      player.levitate = lev;
    }
    const ww = m.waterWalking;
    if (ww !== this.lastWaterWalk) {
      this.lastWaterWalk = ww;
      player.waterWalk = ww;
    }
  }

  private readInput(ctx: Ctx, dt: number): void {
    const input = ctx.input;
    const player = this.player;
    if (player?.freefly) {
      this.charging = false;
      this.charge = 0;
      return;
    }

    if (input.pressed.has(KEY_NEXT_SPELL)) this.cycleSpell(ctx, 1);
    if (input.pressed.has(KEY_PREV_SPELL)) this.cycleSpell(ctx, -1);
    if (input.pressed.has(KEY_CAST)) this.cast();
    if (input.pressed.has(KEY_LEVEL)) this.tryLevelUp(ctx);

    if (!input.pointerLocked || !this.ownsAttackInput) {
      this.charging = false;
      this.charge = 0;
      return;
    }
    const down = input.buttons.has(0);
    if (down) {
      this.charging = true;
      this.charge = Math.min(MAX_CHARGE_SECONDS, this.charge + dt);
    } else if (this.charging) {
      this.charging = false;
      const held = this.charge;
      this.charge = 0;
      if (this.swingCooldown <= 0) this.attack(ctx, held);
    }
  }

  /* -------------------------------------------------------------- combat */

  /** The player's melee/ranged swing, resolved against the nearest actor. */
  attack(ctx: Ctx, chargeSeconds: number): void {
    const c = this.character;
    if (c.modifiers.paralyzed) return;
    const weapon = c.inventory.weapon;
    const stack = c.inventory.equippedStack('weapon');
    const skill: SkillId = weapon ? weapon.skill : 'handToHand';
    const speed = weapon ? weapon.speed : 1.5;
    const reach = weapon ? weapon.reach : 1.0;

    this.swingCooldown = 1 / Math.max(0.2, speed);
    c.spendFatigue(FATIGUE_PER_SWING * (weapon ? weapon.weight * 0.05 + 0.7 : 0.5));
    // Swinging at air still teaches you how the thing swings.
    this.noteSkillUse(skill, 0);

    const charge = swingStrength(chargeSeconds, speed);
    const target = this.pickTarget(ctx, reach + 1.2);
    if (!target) return;
    // Swinging at something is picking a fight with it, hit or miss.
    this.markCombat(target.id);

    const chance = hitChance(
      {
        weaponSkill: c.skill(skill),
        agility: c.attribute('agility'),
        luck: c.attribute('luck'),
        fatigueMul: c.fatigueMul,
        blind: c.modifiers.blind,
      },
      // Actors do not publish a sheet; a modest fixed evasion keeps early
      // fights honest without pretending to know their attributes.
      { agility: 30, luck: 40, fatigueMul: 1, sanctuary: 0 },
    );
    _dir.copy(target.position).sub(this.eye(ctx)).normalize();

    if (!this.rng.chance(chance)) {
      this.vfx?.spawn('splash:impact', target.position, _dir);
      return;
    }

    let dmg: number;
    if (weapon && stack) {
      dmg = weaponDamage(weapon, stack, c.attribute('strength'), this.swingTypeFor(weapon.type), charge, this.rng);
      if (c.inventory.damageItem(stack, WEAPON_WEAR_PER_HIT)) {
        ctx.bus.emit('notify', { text: `Your ${weapon.name} has broken.`, kind: 'warn' });
      }
    } else {
      dmg = handToHandDamage(c.skill('handToHand'), c.attribute('strength'), charge);
    }

    this.noteSkillUse(skill, charge > 0.95 ? 2 : 1);
    this.actors?.damage(target, dmg, _dir);
    this.vfx?.spawn('splash:impact', target.position, _dir);
    ctx.bus.emit('rpg:hit', { actor: target.id, damage: dmg, skill });

    // Cast-on-strike enchantments discharge into whatever you just hit.
    if (weapon && stack) {
      const ench = enchantmentOf(weapon);
      if (ench && ench.kind === 'strike' && drawCharge(stack, ench)) {
        this.noteSkillUse('enchant', 2);
        for (const e of ench.effects) this.applyToActor(ctx, target, e, _dir);
      }
    }
  }

  private swingTypeFor(type: string): SwingType {
    if (type === 'spear' || type === 'halberd' || type === 'tanto') return 'thrust';
    if (type === 'warAxe' || type === 'battleAxe' || type === 'mace' || type === 'warhammer') return 'chop';
    return 'slash';
  }

  private eye(ctx: Ctx): THREE.Vector3 {
    return _from.copy(ctx.camera.position);
  }

  /** Nearest live actor inside `reach` and roughly in front of the camera. */
  private pickTarget(ctx: Ctx, reach: number): ActorLike | null {
    const actors = this.actors;
    if (!actors) return null;
    ctx.camera.getWorldDirection(_dir);
    const eye = this.eye(ctx);
    let best: ActorLike | null = null;
    let bestScore = -Infinity;
    for (const a of actors.all()) {
      if (!a.alive) continue;
      _to.copy(a.position).sub(eye);
      const dist = _to.length();
      if (dist > reach) continue;
      const facing = _to.normalize().dot(_dir);
      if (facing < 0.55) continue;
      const score = facing * 2 - dist / reach;
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best;
  }

  /** Fall damage, offset by Acrobatics. A good tumbler walks off a cliff. */
  private onLand(impact: number): void {
    const c = this.character;
    this.noteSkillUse('acrobatics', 1);
    const acro = c.skill('acrobatics');
    const excess = impact - 8 - acro * 0.12;
    if (excess <= 0) return;
    const slow = c.modifiers.slowFall;
    const dmg = Math.max(0, excess * excess * 0.35 * Math.max(0, 1 - slow / 100));
    if (dmg <= 0) return;
    this.damage(dmg, null);
    this.player?.shake(clamp(dmg / 60, 0, 0.5), 0.25);
  }

  /* ------------------------------------------------------------- magic */

  private cycleSpell(ctx: Ctx, dir: 1 | -1): void {
    const s = this.character.spells.cycle(dir);
    if (s) ctx.bus.emit('notify', { text: `${s.name} — ${s.cost} magicka`, kind: 'info' });
  }

  /**
   * Cast. Magicka is spent whether or not the spell takes, because the whole
   * risk of a low skill is watching your reserves burn on nothing.
   */
  cast(spellId?: string): CastOutcome {
    const ctx = this.ctx;
    const c = this.character;
    const id = spellId ?? c.spells.ready;
    if (!id) return { ok: false, reason: 'no-spell' };
    const spell = c.spells.get(id);
    if (!spell) return { ok: false, reason: 'unknown' };
    if (this.castCooldown > 0) return { ok: false, reason: 'spent' };
    if (c.modifiers.silenced) {
      ctx?.bus.emit('notify', { text: 'You cannot cast while silenced.', kind: 'warn' });
      return { ok: false, reason: 'silenced' };
    }

    if (spell.kind === 'power') {
      const day = ctx?.clock.day ?? 0;
      if (c.spells.powerSpent(spell.id, day)) {
        ctx?.bus.emit('notify', { text: `${spell.name} is spent until tomorrow.`, kind: 'warn' });
        return { ok: false, reason: 'spent' };
      }
      c.spells.spendPower(spell.id, day);
      this.deliver(spell);
      ctx?.bus.emit('notify', { text: spell.name, kind: 'info' });
      return { ok: true, spell: spell.id, cost: 0, target: this.primaryRange(spell) };
    }

    const cost = spell.cost;
    if (c.magicka < cost) {
      ctx?.bus.emit('notify', { text: 'You lack the magicka.', kind: 'warn' });
      return { ok: false, reason: 'no-magicka' };
    }
    c.spendMagicka(cost);
    this.castCooldown = 0.5;
    c.spendFatigue(cost * 0.2);

    const skill = spellSkill(spell);
    const chance = castChance(cost, {
      skill: c.skill(skill),
      willpower: c.attribute('willpower'),
      luck: c.attribute('luck'),
      fatigueMul: c.fatigueMul,
      load: c.encumbranceLoad,
      silenced: false,
    });

    if (!this.rng.chance(chance)) {
      ctx?.bus.emit('notify', { text: 'The spell fails.', kind: 'warn' });
      if (ctx) this.vfx?.spawn('illusion:charge', this.eye(ctx));
      return { ok: false, reason: 'fizzle' };
    }

    this.noteSkillUse(skill, 0);
    this.deliver(spell);
    return { ok: true, spell: spell.id, cost, target: this.primaryRange(spell) };
  }

  private primaryRange(spell: Spell): 'self' | 'touch' | 'target' {
    for (const e of spell.effects) if (e.range !== 'self') return e.range;
    return 'self';
  }

  /** Routes each effect of a cast spell to self or to whatever is in front. */
  private deliver(spell: Spell): void {
    const ctx = this.ctx;
    for (const e of spell.effects) {
      const def = lookupEffect(e.effect);
      // A spell line naming an effect this build has no row for delivers
      // nothing rather than throwing halfway through the cast.
      if (!def) continue;
      if (e.range === 'self') {
        this.applyToSelf(e, `spell:${spell.id}`, 'spell');
        if (ctx) this.vfx?.spawn(`${def.vfx}:release`, this.eye(ctx));
        continue;
      }
      if (!ctx) continue;
      const reach = e.range === 'touch' ? 2.2 : 60;
      const target = this.pickTarget(ctx, reach);
      const eye = this.eye(ctx);
      if (!target) {
        ctx.camera.getWorldDirection(_dir);
        _to.copy(eye).addScaledVector(_dir, Math.min(reach, 12));
        this.vfx?.spawn(`${def.vfx}:release`, _to, _dir);
        continue;
      }
      _dir.copy(target.position).sub(eye).normalize();
      if (e.range === 'target') this.vfx?.beam(eye, target.position, def.vfx, 0.25);
      this.vfx?.spawn(`${def.vfx}:impact`, target.position, _dir);
      this.applyToActor(ctx, target, e, _dir);
    }
  }

  /** Effects landing on an actor. Actors keep no sheet, so this is damage-shaped. */
  private applyToActor(ctx: Ctx, target: ActorLike, e: EffectInstance, dir: THREE.Vector3): void {
    const def = lookupEffect(e.effect);
    if (!def) return;
    const mag = this.rng.rangeInt(Math.min(e.magMin, e.magMax), Math.max(e.magMin, e.magMax));
    switch (def.mode) {
      case 'damageHealth':
      case 'drainHealth':
        this.actors?.damage(target, Math.max(1, mag), dir);
        if (e.effect === 'absorbHealth') this.character.heal(mag);
        break;
      case 'restoreHealth':
        target.health = Math.min(target.maxHealth, target.health + mag);
        break;
      case 'soultrap':
        // Marking the soul is cheap; collecting it happens on the kill.
        ctx.bus.emit('rpg:soultrap', { actor: target.id, seconds: e.duration });
        this.noteSkillUse('enchant', 3);
        break;
      case 'command':
      case 'social':
      case 'charm':
      case 'turnUndead':
        ctx.bus.emit('rpg:influence', { actor: target.id, effect: e.effect, magnitude: mag, seconds: e.duration });
        break;
      case 'paralyze':
        ctx.bus.emit('rpg:paralyze', { actor: target.id, seconds: e.duration });
        break;
      default:
        ctx.bus.emit('rpg:effect', { actor: target.id, effect: e.effect, magnitude: mag, seconds: e.duration });
        break;
    }
  }

  /** Effects landing on the player. Instantaneous ones resolve now. */
  applyToSelf(e: EffectInstance, source: string, kind: 'spell' | 'item' | 'potion' | 'ability' | 'disease'): void {
    const c = this.character;
    const def = lookupEffect(e.effect);
    if (!def) return;
    const mag = this.rng.rangeInt(Math.min(e.magMin, e.magMax), Math.max(e.magMin, e.magMax));
    const ctx = this.ctx;

    switch (def.mode) {
      case 'restoreHealth':
        c.heal(mag);
        return;
      case 'restoreMagicka':
        c.restoreMagicka(mag);
        return;
      case 'restoreFatigue':
        c.restoreFatigue(mag);
        return;
      case 'damageHealth':
        this.damage(mag, e.effect);
        return;
      case 'damageMagicka':
        c.spendMagicka(Math.min(c.magicka, mag));
        return;
      case 'damageFatigue':
        c.spendFatigue(mag);
        return;
      case 'damageAttribute':
        if (e.attribute) c.damageAttribute(e.attribute, mag);
        return;
      case 'restoreAttribute':
        if (e.attribute) c.restoreAttribute(e.attribute, mag);
        return;
      case 'dispel':
        c.dispel(mag);
        return;
      case 'mark':
        if (this.player) {
          c.hasMark = true;
          c.markX = this.player.position.x;
          c.markY = this.player.position.y;
          c.markZ = this.player.position.z;
          ctx?.bus.emit('notify', { text: 'The place is marked.', kind: 'info' });
        }
        return;
      case 'recall':
        if (this.player && c.hasMark) {
          this.player.teleport(c.markX, c.markZ, Math.max(0, c.markY - 0));
          ctx?.bus.emit('notify', { text: 'You are recalled.', kind: 'info' });
        } else {
          ctx?.bus.emit('notify', { text: 'You have set no mark.', kind: 'warn' });
        }
        return;
      case 'intervention':
        if (this.player) {
          // No settlements are placed yet; step toward the map origin, which is
          // where the architecture system builds first.
          this.player.teleport(0, 0, 1);
          ctx?.bus.emit('notify', { text: 'A god hears you.', kind: 'quest' });
        }
        return;
      case 'cure':
        c.removeSource('disease');
        return;
      case 'open':
        ctx?.bus.emit('rpg:open', { magnitude: mag });
        return;
      default:
        break;
    }

    if (e.duration <= 0) return;
    c.addEffect(e.effect, mag, e.duration, source, kind === 'ability' ? 'ability' : kind, e.attribute, e.skill);
  }

  /* ------------------------------------------------------------ exported */

  /** Damage the player, after Shield, resistances and armour. */
  damage(amount: number, effect: EffectId | null = null, physical = false): number {
    const c = this.character;
    let dmg = amount;
    if (physical) {
      const { rating, dominant } = c.inventory.armorRating(c.skills, c.skill('unarmored'));
      dmg = armorSoak(dmg, rating);
      // Taking a hit is how armour skills are learned. Every armour skill.
      this.noteSkillUse(dominant === 'unarmored' ? 'unarmored' : dominant === 'light' ? 'lightArmor' : dominant === 'medium' ? 'mediumArmor' : 'heavyArmor', 0);
      const piece = c.inventory.hitPiece(this.rng);
      if (piece && c.inventory.damageItem(piece.stack, ARMOR_WEAR_PER_HIT)) {
        this.ctx?.bus.emit('notify', { text: `Your ${piece.def.name} has broken.`, kind: 'warn' });
      }
    }
    const taken = c.damage(dmg, effect);
    if (taken > 0) this.markCombat();
    this.player?.shake(clamp(taken / 40, 0, 0.4), 0.18);
    if (c.dead) this.ctx?.bus.emit('rpg:death', { name: c.name, level: c.level });
    if (this.ctx) this.publishStats(this.ctx);
    return taken;
  }

  heal(amount: number): number {
    const n = this.character.heal(amount);
    if (this.ctx) this.publishStats(this.ctx);
    return n;
  }

  /** Skill-by-use. Emits 'rpg:skillup' and a notification when a point lands. */
  noteSkillUse(skill: SkillId, kind: UseKind = 0, times = 1): boolean {
    const up = this.character.useSkill(skill, kind, times);
    if (!up) return false;
    const ctx = this.ctx;
    if (ctx) {
      ctx.bus.emit('rpg:skillup', up);
      ctx.bus.emit('notify', { text: `${up.name} increased to ${up.level}.`, kind: 'info' });
    }
    return true;
  }

  equip(uid: number): boolean {
    const r = this.character.inventory.equip(uid);
    if (!r.ok) return false;
    this.syncConstantEffects();
    if (this.ctx) this.publishStats(this.ctx);
    return true;
  }

  unequip(slot: SlotId): boolean {
    const uid = this.character.inventory.unequip(slot);
    if (uid === null) return false;
    this.syncConstantEffects();
    if (this.ctx) this.publishStats(this.ctx);
    return true;
  }

  /** Constant-effect enchantments live and die with the item being worn. */
  private syncConstantEffects(): void {
    const c = this.character;
    for (let i = c.active.length - 1; i >= 0; i--) {
      if (c.active[i].source.startsWith('item:')) c.active.splice(i, 1);
    }
    for (const slot of SLOTS) {
      const stack = c.inventory.equippedStack(slot);
      if (!stack) continue;
      const def = c.inventory.defOf(stack);
      const ench = def ? enchantmentOf(def) : undefined;
      if (!ench || ench.kind !== 'constant') continue;
      for (const e of ench.effects) {
        c.active.push({
          id: -stack.uid,
          effect: e.effect,
          attribute: e.attribute,
          skill: e.skill,
          magnitude: e.magMax,
          remaining: Infinity,
          source: `item:${stack.uid}`,
          kind: 'item',
        });
      }
    }
    c.recompute();
  }

  /** Cast-on-use from a worn or held enchanted item. */
  useEnchantment(uid: number): boolean {
    const c = this.character;
    const stack = c.inventory.find(uid);
    if (!stack) return false;
    const def = c.inventory.defOf(stack);
    if (!def) return false;
    const ench = enchantmentOf(def);
    if (!ench || ench.kind !== 'cast') return false;
    if (!drawCharge(stack, ench)) {
      this.ctx?.bus.emit('notify', { text: `${def.name} has no charge left.`, kind: 'warn' });
      return false;
    }
    this.noteSkillUse('enchant', 2);
    for (const e of ench.effects) {
      if (e.range === 'self') this.applyToSelf(e, `use:${uid}`, 'item');
      else if (this.ctx) {
        const target = this.pickTarget(this.ctx, e.range === 'touch' ? 2.2 : 60);
        if (target) {
          _dir.copy(target.position).sub(this.eye(this.ctx)).normalize();
          this.applyToActor(this.ctx, target, e, _dir);
        }
      }
    }
    return true;
  }

  /** Drink a potion, eat an ingredient, read a book — one entry point. */
  consume(uid: number): boolean {
    const c = this.character;
    const stack = c.inventory.find(uid);
    if (!stack) return false;
    const def = c.inventory.defOf(stack);
    if (!def) return false;
    if (def.kind === 'potion') {
      for (const e of def.effects) this.applyToSelf(e, `potion:${def.id}`, 'potion');
      c.inventory.remove(uid, 1);
      return true;
    }
    if (def.kind === 'ingredient') {
      const bite = eatIngredient(def, c.skill('alchemy'));
      if (bite) this.applyToSelf(bite.effect, `ingredient:${def.id}`, 'potion');
      this.noteSkillUse('alchemy', 1);
      c.inventory.remove(uid, 1);
      return true;
    }
    if (def.kind === 'scroll') {
      for (const e of def.effects) this.applyToSelf(e, `scroll:${def.id}`, 'spell');
      c.inventory.remove(uid, 1);
      return true;
    }
    if (def.kind === 'book') {
      if (def.teaches && !c.booksRead.has(def.id)) {
        c.booksRead.add(def.id);
        const up = c.trainSkill(def.teaches, 1);
        if (up && this.ctx) {
          this.ctx.bus.emit('rpg:skillup', up);
          this.ctx.bus.emit('notify', { text: `${up.name} increased to ${up.level}.`, kind: 'quest' });
        }
      }
      this.ctx?.bus.emit('rpg:read', { id: def.id, text: def.text });
      return true;
    }
    return false;
  }

  repair(uid: number): boolean {
    const c = this.character;
    const stack = c.inventory.find(uid);
    if (!stack) return false;
    const hammer = c.inventory.stacks.find((s) => {
      const d = c.inventory.defOf(s);
      return d?.kind === 'tool' && d.tool === 'repair';
    });
    const r = c.inventory.repair(
      stack,
      hammer ?? null,
      c.skill('armorer'),
      c.attribute('strength'),
      c.attribute('luck'),
      c.fatigueMul,
      this.rng,
    );
    this.noteSkillUse('armorer', 0);
    if (this.ctx) {
      if (r.failed) this.ctx.bus.emit('notify', { text: 'You fumble the repair.', kind: 'warn' });
      else this.ctx.bus.emit('notify', { text: `Repaired ${r.repaired} points.`, kind: 'info' });
      if (r.broke) this.ctx.bus.emit('notify', { text: 'Your repair tool breaks.', kind: 'warn' });
    }
    return !r.failed;
  }

  /**
   * Why the last spellmaking or enchanting request was refused. A creation API
   * that returns null owes the caller a reason it can put on screen.
   */
  lastCraftError: string | null = null;

  private refuse(reason: string): null {
    this.lastCraftError = reason;
    this.ctx?.bus.emit('notify', { text: reason, kind: 'warn' });
    this.ctx?.bus.emit('rpg:spellfailed', { reason });
    return null;
  }

  /**
   * Spellmaking: any effects, any magnitudes. The cost is the only judge.
   *
   * The effect list arrives from a UI panel or the console, so it is parsed
   * rather than trusted — an unrecognised effect id used to walk straight into
   * the effect table and take the frame down with it. A creation API answers
   * bad input with null and a reason, never with an exception.
   */
  createSpell(name: string, effects: readonly EffectLike[]): Spell | null {
    this.lastCraftError = null;
    const parsed = parseEffects(effects);
    if (!parsed.ok) return this.refuse(parsed.reason);
    try {
      const spell = this.character.spells.create(name, parsed.effects);
      this.ctx?.bus.emit('notify', { text: `${spell.name} — ${spell.cost} magicka`, kind: 'quest' });
      this.ctx?.bus.emit('rpg:spellmade', { id: spell.id, name: spell.name, cost: spell.cost });
      return spell;
    } catch (e) {
      // SpellmakingError is the guild refusing the commission (too many
      // effects, none at all); anything else is a bug and still must not
      // escape into the frame loop.
      return this.refuse(String(e instanceof Error ? e.message : e));
    }
  }

  /**
   * Preview a spellmaking result without buying it. `error` is non-null exactly
   * when createSpell would refuse the same list, so a panel can grey out the
   * buy button instead of discovering the refusal on click.
   */
  priceSpell(effects: readonly EffectLike[]): { cost: number; lines: string[]; error: string | null } {
    const parsed = parseEffects(effects);
    if (!parsed.ok) return { cost: 0, lines: [], error: parsed.reason };
    return {
      cost: spellCost(parsed.effects),
      lines: parsed.effects.map(describeEffect),
      error: null,
    };
  }

  brewPotion(ingredientUids: readonly number[]): BrewResult {
    const c = this.character;
    const app = this.apparatus();
    // Only real ingredients go in the mortar, and only they can come out of the
    // pack: the uid list arrives from a UI panel, and grinding away a uid that
    // turned out to be the player's sword is not a failure mode a crafting
    // screen is allowed to have.
    const defs = [];
    const used: number[] = [];
    for (const uid of ingredientUids) {
      const stack = c.inventory.find(uid);
      if (!stack) continue;
      const def = c.inventory.defOf(stack);
      if (def?.kind !== 'ingredient') continue;
      defs.push(def);
      used.push(uid);
    }
    const result = brew(this.registry, defs, app, {
      alchemy: c.skill('alchemy'),
      intelligence: c.attribute('intelligence'),
      luck: c.attribute('luck'),
      fatigueMul: c.fatigueMul,
    }, this.rng);

    // Nothing was ground unless the mixture was actually attempted: a refusal
    // the player could see coming (too few reagents, no mortar) costs nothing,
    // while a curdled mixture costs everything in it.
    const attempted = result.ok || result.reason === 'botched' || result.reason === 'no-shared-effect';
    if (attempted) {
      for (const uid of used) c.inventory.remove(uid, 1);
      this.noteSkillUse('alchemy', 0);
    }

    if (result.ok) {
      c.inventory.add(result.def, 1);
      this.ctx?.bus.emit('notify', { text: `You brew ${result.def.name}.`, kind: 'quest' });
    } else {
      this.ctx?.bus.emit('notify', { text: 'The mixture curdles and is lost.', kind: 'warn' });
    }
    return result;
  }

  /** The best apparatus of each type in the pack, which is what you brew with. */
  apparatus(): Apparatus {
    const c = this.character;
    const out: Apparatus = { ...NO_APPARATUS };
    for (const stack of c.inventory.stacks) {
      const def = c.inventory.defOf(stack);
      if (def?.kind !== 'apparatus') continue;
      const slot = def.apparatus;
      const cur = out[slot];
      if (!cur || cur.quality < def.quality) out[slot] = def;
    }
    return out;
  }

  enchantItem(
    itemUid: number,
    soulGemUid: number,
    effects: readonly EffectLike[],
    kind: 'cast' | 'constant' | 'strike',
    name: string,
  ): EnchantResult {
    const c = this.character;
    const stack = c.inventory.find(itemUid);
    const gem = c.inventory.find(soulGemUid);
    const fail = (reason: 'no-soul' | 'too-costly' | 'already-enchanted' | 'failed'): EnchantResult => ({
      ok: false,
      reason,
      cost: 0,
      capacity: 0,
    });
    // Parsed before the gem is risked: an effect nobody can name must cost the
    // player nothing, and an enchanting panel is as untrusted as a spell panel.
    const parsed = parseEffects(effects);
    if (!parsed.ok) {
      this.lastCraftError = parsed.reason;
      this.ctx?.bus.emit('notify', { text: parsed.reason, kind: 'warn' });
      return { ok: false, reason: 'no-effect', cost: 0, capacity: 0 };
    }
    if (!stack || !gem) return fail('no-soul');
    const def = c.inventory.defOf(stack);
    if (!def) return fail('no-soul');
    if (!isWeapon(def) && !isArmor(def) && def.kind !== 'clothing') return fail('already-enchanted');

    const result = enchant(
      this.registry,
      def as Enchantable,
      parsed.effects,
      kind,
      gem.soul,
      name,
      {
        enchant: c.skill('enchant'),
        intelligence: c.attribute('intelligence'),
        luck: c.attribute('luck'),
        fatigueMul: c.fatigueMul,
      },
      this.rng,
    );

    if (result.ok) {
      c.inventory.remove(itemUid, 1);
      c.inventory.remove(soulGemUid, 1);
      const made = c.inventory.add(result.def, 1);
      this.noteSkillUse('enchant', 1);
      this.ctx?.bus.emit('notify', { text: `You bind ${result.def.name}.`, kind: 'quest' });
      this.ctx?.bus.emit('rpg:enchanted', { uid: made.uid, id: result.def.id });
    } else if (result.reason === 'failed') {
      // The wager: a botched binding takes the gem and the item with it.
      c.inventory.remove(itemUid, 1);
      c.inventory.remove(soulGemUid, 1);
      this.noteSkillUse('enchant', 1);
      this.ctx?.bus.emit('notify', { text: 'The binding shatters. Gem and item are lost.', kind: 'warn' });
    }
    return result;
  }

  rechargeItem(itemUid: number, soulGemUid: number): number {
    const c = this.character;
    const stack = c.inventory.find(itemUid);
    const gem = c.inventory.find(soulGemUid);
    if (!stack || !gem || gem.soul <= 0) return 0;
    const def = c.inventory.defOf(stack);
    if (!def) return 0;
    if (!isWeapon(def) && !isArmor(def) && def.kind !== 'clothing') return 0;
    const gained = recharge(stack, def as Enchantable, gem.soul, c.skill('enchant'), this.rng);
    if (gained > 0) {
      gem.soul = 0;
      this.noteSkillUse('enchant', 0);
    }
    return gained;
  }

  /** Fills the smallest gem that can hold the soul, as the source material does. */
  captureSoul(maxHealth: number, tier: number, name: string): boolean {
    const value = soulValueFor(maxHealth, tier);
    const c = this.character;
    let best: ItemStack | null = null;
    let bestCap = Infinity;
    for (const stack of c.inventory.stacks) {
      const def = c.inventory.defOf(stack);
      if (def?.kind !== 'misc' || def.misc !== 'soulgem') continue;
      const cap = def.soulCapacity ?? 0;
      if (stack.soul > 0 || cap < value || cap >= bestCap) continue;
      best = stack;
      bestCap = cap;
    }
    if (!best) return false;
    best.soul = value;
    best.soulName = name;
    this.noteSkillUse('enchant', 3);
    this.ctx?.bus.emit('notify', { text: `The soul of ${name} is bound.`, kind: 'quest' });
    return true;
  }

  /** Loot generated from a place's own danger, never from the player's level. */
  generateLoot(tier: number, count: number): ItemStack[] {
    return rollLoot(this.registry, tier, this.rng, count);
  }

  /* ---------------------------------------------------------- foraging */

  /** The ingredient a species of placed flora yields, or null if it yields none. */
  harvestable(species: string): ItemDef | null {
    const id = FLORA_INGREDIENTS[species];
    return id ? this.registry.find(id) ?? null : null;
  }

  /**
   * Pick a plant. The ingredient economy has to start on the map — alchemy that
   * can only be supplied from loot piles is a menu, not a system — so the
   * vegetation the world already scatters is the vegetation you gather from.
   *
   * Whoever owns the activate/interact code fires 'world:harvest' with the
   * scatter rule's species id; this layer decides what falls out of it.
   */
  harvest(species: string, count = 0): ItemStack | null {
    const def = this.harvestable(species);
    if (!def) return null;
    // A yam is a yam; a stand of trama yields what the picker's hands find.
    const n = count > 0 ? count : 1 + (this.rng.next() < 0.35 ? 1 : 0);
    const stack = this.character.inventory.add(def, n);
    // Handling reagents is how a field alchemist learns them, which is why a
    // wandering herbalist reads ingredients an armchair one never will.
    this.noteSkillUse('alchemy', 2);
    this.ctx?.bus.emit('notify', { text: `${def.name} (${n}) taken.`, kind: 'info' });
    return stack;
  }

  /* -------------------------------------------------------------- resting */

  /**
   * Note that the player is in a fight, and optionally with whom. Called when a
   * blow is struck or taken; keeps `canRest` honest for ten seconds afterwards.
   */
  markCombat(actorId?: number): void {
    const now = this.ctx?.time.elapsed ?? 0;
    this.combatUntil = now + REST_COMBAT_LOCKOUT;
    // A provoked actor stays a reason to keep watch long after the exchange.
    if (typeof actorId === 'number') this.provoked.set(actorId, now + 60);
  }

  /** The nearest thing that will not let the player sleep, if there is one. */
  private nearestThreat(): RestThreat | null {
    const actors = this.actors;
    if (!actors) return null;
    const origin = this.player?.position ?? this.ctx?.camera.position;
    if (!origin) return null;
    const now = this.ctx?.time.elapsed ?? 0;
    let best: RestThreat | null = null;
    for (const a of actors.all()) {
      if (!a.alive) continue;
      const dist = _tmp.copy(a.position).sub(origin).length();
      if (dist > REST_HOSTILE_RADIUS) continue;
      if (!blocksRest(a.faction, (this.provoked.get(a.id) ?? 0) > now)) continue;
      if (!best || dist < best.distance) best = { kind: a.kind, distance: dist };
    }
    return best;
  }

  /**
   * Can the player rest right now? Exposed so the interface can grey out the
   * key and say why, rather than letting the player press it into silence.
   */
  canRest(hours = 8): { ok: boolean; reason?: RestRefusal; message?: string; threat?: RestThreat } {
    const c = this.character;
    const deny = (reason: RestRefusal, threat?: RestThreat): { ok: false; reason: RestRefusal; message: string; threat?: RestThreat } =>
      threat
        ? { ok: false, reason, message: refusalMessage(reason, threat), threat }
        : { ok: false, reason, message: refusalMessage(reason) };

    if (!(hours > 0) || hours > REST_MAX_HOURS) return deny('bad-hours');
    if (c.dead) return deny('dead');
    if (c.modifiers.paralyzed) return deny('paralyzed');
    if (this.player?.swimming === true) return deny('swimming');
    const now = this.ctx?.time.elapsed ?? 0;
    if (now < this.combatUntil) return deny('in-combat');
    const threat = this.nearestThreat();
    if (threat) return deny('enemies-near', threat);
    return { ok: true };
  }

  /**
   * Sleep. Restores health, magicka and fatigue in proportion to the hours slept
   * and to Endurance, advances the world clock so the sun and everyone's daily
   * round move with you, and — in a bed only — pays out an earned level.
   *
   * Pass `picks` to take the three attribute rises in the same call; leave it
   * out and the level is merely authorised, `levelReady` comes back true and
   * 'rpg:levelup:ready' fires so the interface can ask which three.
   *
   * Every outcome, refusal included, is also published on 'rpg:rested'.
   */
  rest(hours = 8, inBed = false, picks?: readonly AttributeId[]): RestResult {
    return this.doRest(hours, inBed, 'sleep', picks);
  }

  /** Pass time without sleeping. Winds you back; barely touches a wound. */
  wait(hours = 1): RestResult {
    return this.doRest(hours, false, 'wait');
  }

  private doRest(
    hours: number,
    inBed: boolean,
    kind: RestKind,
    picks?: readonly AttributeId[],
  ): RestResult {
    this.resting = true;
    try {
      return this.restNow(hours, inBed, kind, picks);
    } finally {
      this.resting = false;
    }
  }

  private restNow(
    hours: number,
    inBed: boolean,
    kind: RestKind,
    picks?: readonly AttributeId[],
  ): RestResult {
    const ctx = this.ctx;
    const c = this.character;
    const empty: RestRestored = { health: 0, magicka: 0, fatigue: 0, attributes: 0 };

    const gate = this.canRest(hours);
    if (!gate.ok) {
      const refused: RestResult = {
        ok: false,
        kind,
        hours: 0,
        inBed,
        reason: gate.reason,
        message: gate.message ?? 'You cannot rest.',
        restored: empty,
        hour: ctx?.clock.hour ?? 0,
        day: ctx?.clock.day ?? 0,
      };
      if (gate.threat) refused.threat = gate.threat;
      if (ctx) {
        ctx.bus.emit('rpg:rested', refused);
        ctx.bus.emit('notify', { text: refused.message, kind: 'warn' });
      }
      return refused;
    }

    const h = Math.min(REST_MAX_HOURS, hours);
    const gains = restGains(h, kind, inBed, {
      maxHealth: c.maxHealth,
      maxMagicka: c.maxMagicka,
      maxFatigue: c.maxFatigue,
      endurance: c.attribute('endurance'),
    });

    // Time passes first: spell durations, disease and the daily reset of
    // once-a-day powers all belong to the hours you were unconscious for.
    c.tickEffects(h * 3600);
    if (ctx) {
      ctx.clock.hour += h;
      while (ctx.clock.hour >= 24) {
        ctx.clock.hour -= 24;
        ctx.clock.day++;
      }
    }

    const restored: RestRestored = {
      health: c.heal(gains.health),
      magicka: c.restoreMagicka(gains.magicka),
      fatigue: c.restoreFatigue(gains.fatigue),
      attributes: 0,
    };
    if (gains.attributes > 0) {
      for (const a of ATTRIBUTES) {
        const before = c.attributeDamage[a];
        if (before <= 0) continue;
        c.restoreAttribute(a, gains.attributes);
        restored.attributes += before - c.attributeDamage[a];
      }
    }
    // Nothing is chasing you and nothing has hit you, so the fight is over.
    this.provoked.clear();

    const result: RestResult = {
      ok: true,
      kind,
      hours: h,
      inBed,
      message: summaryMessage(kind, h, inBed, restored),
      restored,
      hour: ctx?.clock.hour ?? 0,
      day: ctx?.clock.day ?? 0,
    };

    // The series rule: a level is gained in a bed, asleep, and nowhere else.
    if (kind === 'sleep' && inBed && c.pendingLevelUp) {
      this.sleepCredit = true;
      if (picks && picks.length > 0) {
        const up = this.levelUp(picks);
        if (up) {
          result.leveled = true;
          result.level = up.level;
          result.message += ` You have reached level ${up.level}.`;
        } else {
          result.levelReady = true;
        }
      } else {
        result.levelReady = true;
      }
      if (result.levelReady && ctx) {
        ctx.bus.emit('rpg:levelup:ready', { level: c.level + 1, offers: c.levelUpOffers() });
      }
    }

    if (ctx) {
      ctx.bus.emit('rpg:rested', result);
      ctx.bus.emit('notify', { text: result.message, kind: result.leveled ? 'quest' : 'info' });
      this.publishStats(ctx);
    }
    return result;
  }

  /* ---------------------------------------------------------- level-up */

  /**
   * The [L] key. It no longer levels you where you stand — it puts you to bed,
   * which is the only place levelling happens. A refusal (enemies, a fight just
   * finished) comes back through the same reason channel as any other rest.
   */
  private tryLevelUp(ctx: Ctx): void {
    const c = this.character;
    if (!c.pendingLevelUp) {
      ctx.bus.emit('notify', { text: `${c.levelProgress}/10 toward level ${c.level + 1}.`, kind: 'info' });
      return;
    }
    // Picks are supplied here so the debug key does not also open the interface's
    // pick-three panel on a credit it is about to spend itself. A UI that wants
    // the panel calls `rest(8, true)` with no picks and reads `levelReady`.
    // The sleep announces itself, so nothing more is said here.
    this.rest(8, true, this.bestPicks());
  }

  /** Default picks: the three attributes your practice actually earned. */
  bestPicks(): AttributeId[] {
    return [...this.character.levelUpOffers()]
      .sort((a, b) => b.multiplier - a.multiplier || b.gains - a.gains)
      .slice(0, 3)
      .map((o) => o.attribute);
  }

  /**
   * Applies an earned level. Requires a bed: `rest(hours, true)` grants the
   * credit this spends, so the pick-three panel can open after the sleep and
   * still land on the same rule. Returns null if nothing has authorised it.
   */
  levelUp(picks: readonly AttributeId[]): { level: number; raised: { attribute: AttributeId; by: number }[] } | null {
    if (!this.sleepCredit) {
      if (this.character.pendingLevelUp) {
        this.ctx?.bus.emit('notify', { text: 'You must sleep in a bed to advance.', kind: 'warn' });
      }
      return null;
    }
    const r = this.character.levelUp(picks);
    if (!r) return null;
    this.sleepCredit = false;
    this.announcedLevel = false;
    // The restoring was done by the sleep that authorised this; levelling adds
    // only the Endurance-bought health the character sheet grants on its own.
    if (this.ctx) {
      this.ctx.bus.emit('rpg:levelup', r);
      this.publishStats(this.ctx);
    }
    return r;
  }

  /* ------------------------------------------------------- introspection */

  stats(): StatsSnapshot {
    const c = this.character;
    const attributes = {} as Record<AttributeId, number>;
    for (const a of ATTRIBUTES) attributes[a] = c.attribute(a);
    const skills = {} as Record<SkillId, number>;
    for (const s of SKILLS) skills[s] = c.skill(s);
    const armor = c.inventory.armorRating(c.skills, c.skill('unarmored'));
    return {
      name: c.name,
      race: c.race,
      gender: c.gender,
      birthsign: c.birthsign,
      className: c.klass.name,
      level: c.level,
      levelProgress: c.levelProgress,
      pendingLevelUp: c.pendingLevelUp,
      health: c.health,
      maxHealth: c.maxHealth,
      magicka: c.magicka,
      maxMagicka: c.maxMagicka,
      fatigue: c.fatigue,
      maxFatigue: c.maxFatigue,
      encumbrance: c.inventory.weight,
      capacity: c.inventory.capacity(c.attribute('strength'), c.modifiers.feather, c.modifiers.burden),
      mobility: c.mobility,
      attributes,
      skills,
      armorRating: armor.rating,
      readySpell: c.spells.ready ? (c.spells.get(c.spells.ready)?.name ?? null) : null,
      gold: c.inventory.gold,
    };
  }

  private publishStats(ctx: Ctx): void {
    ctx.bus.emit('rpg:stats', this.stats());
  }

  /** One line of sheet for the corner log; the UI owns the real panel (C). */
  announceSheet(ctx: Ctx): void {
    const s = this.stats();
    ctx.bus.emit('notify', {
      text: `${s.name}, level ${s.level} ${s.className} — ${Math.round(s.health)}/${s.maxHealth} health, ${Math.round(s.magicka)}/${s.maxMagicka} magicka`,
      kind: 'info',
    });
  }

  /** Re-roll the character. Everything downstream re-derives from this. */
  recreate(
    name: string,
    race: RaceId,
    gender: Gender,
    birthsign: BirthsignId,
    klass: ClassDef | string,
  ): void {
    const def = typeof klass === 'string' ? (CLASS_DEFS[klass as keyof typeof CLASS_DEFS] ?? CLASS_DEFS.warrior) : klass;
    this.character.create(name, race, gender, birthsign, def);
    this.character.inventory.stacks.length = 0;
    this.character.inventory.equipped.clear();
    this.giveStartingKit();
    this.syncConstantEffects();
    if (this.ctx) this.publishStats(this.ctx);
  }

  /** Custom class builder, surfaced so a creation UI has one call to make. */
  buildClass(
    name: string,
    spec: ClassDef['spec'],
    favored: readonly [AttributeId, AttributeId],
    major: readonly SkillId[],
    minor: readonly SkillId[],
  ): ClassDef | null {
    try {
      return makeCustomClass(name, spec, favored, major, minor);
    } catch (e) {
      this.ctx?.bus.emit('notify', { text: String(e instanceof Error ? e.message : e), kind: 'warn' });
      return null;
    }
  }

  /** What an alchemist can read off an ingredient at their current skill. */
  identify(uid: number): readonly string[] {
    const c = this.character;
    const stack = c.inventory.find(uid);
    if (!stack) return [];
    const def = c.inventory.defOf(stack);
    if (!def) return [];
    if (def.kind === 'ingredient') return readIngredient(def, c.skill('alchemy'));
    if (def.kind === 'potion') return def.effects.map(describeEffect);
    const ench = enchantmentOf(def);
    if (ench) return ench.effects.map(describeEffect);
    return [];
  }

  get knownIngredientEffects(): number {
    return knownEffectCount(this.character.skill('alchemy'));
  }

  /* ---------------------------------------------------------------- save */

  serialise(): RPGSave {
    return {
      version: 1,
      character: this.character.serialise(),
      registry: this.registry.serialise(),
      rng: this.rng.state,
      uidSeq: peekUidSeq(),
    };
  }

  deserialise(save: RPGSave): void {
    // Generated item definitions must exist before the inventory references them.
    this.registry.deserialise(save.registry);
    resetUidSeq(save.uidSeq);
    this.character.deserialise(save.character);
    this.rng.state = save.rng;
    this.syncConstantEffects();
    // Force every "only on change" broadcast to fire once against the loaded
    // sheet: the listeners on the other side were reset by the load too.
    this.lastLevitate = !this.character.modifiers.levitate;
    this.lastWaterWalk = !this.character.modifiers.waterWalking;
    this.lastMobility = -1;
    this.announcedLevel = false;
    this.charging = false;
    this.charge = 0;
    this.swingCooldown = 0;
    this.castCooldown = 0;
    this.athleticsAccum = 0;
    if (this.ctx) this.publishStats(this.ctx);
  }

  save(key = SAVE_KEY): boolean {
    try {
      localStorage.setItem(key, JSON.stringify(this.serialise()));
      this.ctx?.bus.emit('notify', { text: 'Saved.', kind: 'info' });
      return true;
    } catch (e) {
      console.error('[rpg] save failed', e);
      return false;
    }
  }

  load(key = SAVE_KEY): boolean {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as RPGSave;
      if (parsed.version !== 1) return false;
      this.deserialise(parsed);
      this.ctx?.bus.emit('notify', { text: 'Loaded.', kind: 'info' });
      return true;
    } catch (e) {
      console.error('[rpg] load failed', e);
      return false;
    }
  }

  dispose(): void {
    for (const off of this.subs) off();
    this.subs.length = 0;
    for (const k of ['rpg', 'character', 'sheet']) {
      delete (globalThis as unknown as Record<string, unknown>)[k];
    }
    this.ctx = null;
    this.player = null;
    this.actors = null;
    this.vfx = null;
    // Dependency probes must run again against whatever registry we re-init into.
    this.probedCombat = false;
    this.ownsAttackInput = true;
    this.charging = false;
    this.charge = 0;
  }
}

export { SKILL_DEFS, maxConditionOf, strengthMultiplier, FATIGUE_PER_JUMP };
export { EFFECTS } from './Effects';
