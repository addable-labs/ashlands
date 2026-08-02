/**
 * RESTING — the only way back to full health.
 *
 * Health does not trickle back while you walk. That is deliberate: if it did,
 * every wound would be a short pause rather than a decision, and the ash would
 * stop being dangerous the moment you turned your back on it. So the loop is
 * the one the source material used — you take a wound, you carry it until you
 * can afford to lie down, and lying down costs you hours of the world's time.
 *
 * Three things follow from that, and they are the whole design:
 *
 *   1. Rest heals in proportion to HOURS SLEPT and to ENDURANCE. Roughly a
 *      tenth of your maximum health per hour at Endurance 50, less if you are
 *      frail, more if you are not.
 *   2. You cannot sleep with something hunting you, and you cannot sleep in
 *      the ten seconds after a fight. Refusals carry a reason so the interface
 *      can say why instead of doing nothing.
 *   3. YOU ONLY GAIN A LEVEL WHEN YOU SLEEP IN A BED. Wilderness rest patches
 *      you up at a penalty; it does not advance you. That rule is what makes a
 *      bed worth walking back to, and it is series-defining, so it is enforced
 *      here rather than left to the interface to remember.
 *
 * This module is pure arithmetic and vocabulary. RPGSystem owns the world
 * queries (who is nearby, what the clock says) and applies the result.
 */

/** Sleeping heals and levels; waiting only passes time. */
export type RestKind = 'sleep' | 'wait';

/** Why a rest was refused. The interface maps these to whatever it likes. */
export type RestRefusal =
  | 'bad-hours'
  | 'dead'
  | 'enemies-near'
  | 'in-combat'
  | 'paralyzed'
  | 'swimming';

/** How much of each pool a rest actually put back. */
export interface RestRestored {
  health: number;
  magicka: number;
  fatigue: number;
  /** Points of Damage Attribute shaken off across every attribute. */
  attributes: number;
}

/** What was in the way, when something was. */
export interface RestThreat {
  kind: string;
  distance: number;
}

export interface RestResult {
  ok: boolean;
  kind: RestKind;
  /** Hours actually spent. Zero on a refusal — no time passes if you cannot rest. */
  hours: number;
  inBed: boolean;
  reason?: RestRefusal;
  /** Ready-to-display sentence for the refusal, or the summary on success. */
  message: string;
  restored: RestRestored;
  /** The nearest hostile, when that is what stopped you. */
  threat?: RestThreat;
  /** True when this sleep applied a level-up. */
  leveled?: boolean;
  level?: number;
  /** A level is earned and the bed has authorised it; the UI should now ask
   *  which three attributes to raise and call `levelUp(picks)`. */
  levelReady?: boolean;
  /** World clock after the rest. */
  hour: number;
  day: number;
}

/* ------------------------------------------------------------- constants */

/** Metres. Something hostile inside this refuses sleep, as it does in Vvardenfell. */
export const REST_HOSTILE_RADIUS = 30;

/** Seconds after the last blow — struck or taken — before you can lie down. */
export const REST_COMBAT_LOCKOUT = 10;

/** Longest single rest. Past a day it stops being sleep and starts being a coma. */
export const REST_MAX_HOURS = 24;

/** Fraction of max health returned per hour, at Endurance 50, in a bed. */
export const REST_HEALTH_PER_HOUR = 0.1;
/** Fraction of max magicka per hour. Sleep is what a mage's rest is for. */
export const REST_MAGICKA_PER_HOUR = 0.2;
/** Fraction of max fatigue per hour. Two hours on your back is a full wind. */
export const REST_FATIGUE_PER_HOUR = 0.5;

/** A roof, a mattress and no need to keep one eye open. */
export const BED_HEALTH_MULT = 1;
/** Rough ground, ash in the blankets, half an ear on the dark. */
export const WILD_HEALTH_MULT = 0.6;
export const WILD_MAGICKA_MULT = 0.75;
/** Waiting is sitting up with your eyes open: it winds you, it does not mend you. */
export const WAIT_HEALTH_MULT = 0.1;
export const WAIT_MAGICKA_MULT = 0.5;

/** The pools a rest needs to know about, so this file never imports Character. */
export interface RestVitals {
  maxHealth: number;
  maxMagicka: number;
  maxFatigue: number;
  endurance: number;
}

export interface RestGains {
  health: number;
  magicka: number;
  fatigue: number;
  /** Points of attribute damage healed, per attribute. */
  attributes: number;
}

/**
 * Endurance is the whole of a body's capacity to knit itself back together.
 * Fifty is the reference constitution; a floor keeps a Drain Endurance curse
 * from making sleep useless rather than merely slow.
 */
export function enduranceScale(endurance: number): number {
  return Math.max(0.2, endurance / 50);
}

/** How much a rest of `hours` puts back. Pure; caller clamps to the pools. */
export function restGains(
  hours: number,
  kind: RestKind,
  inBed: boolean,
  v: RestVitals,
): RestGains {
  const h = Math.max(0, Math.min(REST_MAX_HOURS, hours));
  const end = enduranceScale(v.endurance);
  const healthMult = kind === 'wait' ? WAIT_HEALTH_MULT : inBed ? BED_HEALTH_MULT : WILD_HEALTH_MULT;
  const magickaMult = kind === 'wait' ? WAIT_MAGICKA_MULT : inBed ? 1 : WILD_MAGICKA_MULT;
  return {
    health: v.maxHealth * REST_HEALTH_PER_HOUR * h * end * healthMult,
    magicka: v.maxMagicka * REST_MAGICKA_PER_HOUR * h * magickaMult,
    fatigue: v.maxFatigue * REST_FATIGUE_PER_HOUR * h,
    // Wounded attributes mend only in real sleep, and faster in a bed.
    attributes: kind === 'wait' ? 0 : h * (inBed ? 1 : 0.5),
  };
}

/** Factions whose members will not let you sleep. */
const HOSTILE_FACTIONS: ReadonlySet<string> = new Set(['predator', 'daedra', 'undead', 'hostile']);

/**
 * Whether an actor blocks rest. Faction is the standing case; `provoked` covers
 * anything you have personally picked a fight with, whatever its nature — a
 * guar you decided to rob is as much a reason to stay awake as a nix-hound.
 */
export function blocksRest(faction: string, provoked: boolean): boolean {
  return provoked || HOSTILE_FACTIONS.has(faction);
}

/** The sentence the interface shows when a rest is refused. */
export function refusalMessage(reason: RestRefusal, threat?: RestThreat): string {
  switch (reason) {
    case 'enemies-near':
      return threat
        ? `You cannot rest with a ${threat.kind} ${Math.round(threat.distance)}m away.`
        : 'You cannot rest with enemies nearby.';
    case 'in-combat':
      return 'You are still winded from the fight.';
    case 'paralyzed':
      return 'You cannot move, let alone sleep.';
    case 'swimming':
      return 'You cannot sleep in the water.';
    case 'dead':
      return 'You are beyond rest.';
    case 'bad-hours':
      return `Choose between 1 and ${REST_MAX_HOURS} hours.`;
  }
}

/** The sentence shown after a rest that worked. */
export function summaryMessage(kind: RestKind, hours: number, inBed: boolean, r: RestRestored): string {
  const h = hours === 1 ? '1 hour' : `${Math.round(hours * 10) / 10} hours`;
  const verb = kind === 'wait' ? 'You wait' : inBed ? 'You sleep' : 'You sleep rough';
  const parts: string[] = [];
  if (r.health >= 0.5) parts.push(`${Math.round(r.health)} health`);
  if (r.magicka >= 0.5) parts.push(`${Math.round(r.magicka)} magicka`);
  if (r.fatigue >= 0.5) parts.push(`${Math.round(r.fatigue)} fatigue`);
  return parts.length ? `${verb} for ${h} and recover ${parts.join(', ')}.` : `${verb} for ${h}.`;
}
