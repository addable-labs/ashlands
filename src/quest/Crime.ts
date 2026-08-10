import type * as THREE from 'three';
import type { TerrainQuery } from '../core/types';
import type { CrimeKind, SkillId, WeatherKind } from './types';

/**
 * Crime is only crime if somebody saw it. That single rule is what makes theft
 * a skill rather than a menu option, and it is why witnesses are resolved
 * against real actor positions with a real line-of-sight test rather than a
 * radius check: a wall must actually work.
 */

/** The minimum an actor system must expose for witnessing to function. */
export interface WitnessActor {
  readonly position: THREE.Vector3;
  readonly alive: boolean;
  readonly faction: string;
  readonly yaw: number;
}

export interface WitnessSource {
  all(): readonly WitnessActor[];
}

export const CRIME_BOUNTY: Record<CrimeKind, number> = {
  trespass: 5,
  pickpocket: 25,
  theft: 0, // value-based; the goods set the fine
  assault: 40,
  murder: 1000,
};

/**
 * Actor factions that cannot testify. A glassjaw watching you cut a purse is
 * not a witness, and before this the actor list was walked whole — so a crime
 * committed alone in the ashlands with a drell in line of sight earned a real
 * bounty from nobody. Unknown factions still count, so a new kind of person is
 * a witness by default rather than silently exempt.
 */
const BEASTS: ReadonlySet<string> = new Set(['wild', 'predator', 'pack', 'tame']);

/** How far a witness can register a crime at all, before any other modifier. */
const SIGHT = 34;
/** Eye height above the actor's root, and above the crime scene. */
const EYE = 1.55;
const SAMPLES = 12;

/**
 * Segment-marches the heightfield between two eye points. Cheap enough to run
 * for a dozen candidates on the frame a crime happens, and never per-frame.
 */
export function hasLineOfSight(
  from: THREE.Vector3,
  to: THREE.Vector3,
  terrain: TerrainQuery | null,
  scratch: THREE.Vector3,
): boolean {
  if (terrain === null) return true;
  for (let i = 1; i < SAMPLES; i++) {
    const t = i / SAMPLES;
    scratch.lerpVectors(from, to, t);
    // A small bias keeps a grazing sightline along a slope from self-occluding.
    if (terrain.heightAt(scratch.x, scratch.z) > scratch.y + 0.25) return false;
  }
  return true;
}

export interface WitnessQuery {
  readonly at: THREE.Vector3;
  readonly hour: number;
  readonly weather: WeatherKind;
  /** Player Sneak. High enough and a crime in a crowded market goes unseen. */
  readonly sneak: number;
  readonly source: WitnessSource | null;
  readonly terrain: TerrainQuery | null;
  /** [0,1) per candidate, so the result round-trips with the save's RNG. */
  roll(): number;
  scratchA: THREE.Vector3;
  scratchB: THREE.Vector3;
  scratchC: THREE.Vector3;
}

/**
 * Counts who actually saw it. Distance, facing, darkness, ash in the air and
 * the player's Sneak all reduce the chance independently — which is why a
 * pickpocket at noon in the market is a different proposition from the same
 * pickpocket at the fourth bell in an ash storm, without a single special case.
 */
export function countWitnesses(q: WitnessQuery): number {
  if (q.source === null) return 0;
  const night = q.hour >= 21 || q.hour < 5;
  const murk = q.weather === 'ashstorm' || q.weather === 'blizzard' || q.weather === 'blight';
  const rain = q.weather === 'rain' || q.weather === 'thunder' || q.weather === 'overcast';

  let seen = 0;
  const eye = q.scratchA.copy(q.at);
  eye.y += EYE;

  for (const a of q.source.all()) {
    if (!a.alive || BEASTS.has(a.faction)) continue;
    const d = a.position.distanceTo(q.at);
    if (d > SIGHT) continue;

    let chance = 1 - d / SIGHT;
    if (night) chance *= 0.35;
    if (murk) chance *= 0.3;
    else if (rain) chance *= 0.7;
    chance *= Math.max(0.05, 1 - q.sneak / 130);

    // Facing cone: an actor looking the other way is a poor witness even at
    // arm's length. Actors carry yaw as their facing about +Y.
    const dx = q.at.x - a.position.x;
    const dz = q.at.z - a.position.z;
    const len = Math.hypot(dx, dz);
    if (len > 0.01) {
      const dot = (Math.sin(a.yaw) * dx + Math.cos(a.yaw) * dz) / len;
      chance *= dot > 0.25 ? 1 : dot > -0.2 ? 0.45 : 0.12;
    }

    if (q.roll() > chance) continue;

    const other = q.scratchB.copy(a.position);
    other.y += EYE;
    if (!hasLineOfSight(other, eye, q.terrain, q.scratchC)) continue;
    seen++;
  }
  return seen;
}

export type JusticeChoice = 'pay' | 'jail' | 'resist';

export interface JusticeOutcome {
  readonly choice: JusticeChoice;
  readonly goldPaid: number;
  /** In-world days spent in the cell. The caller advances the clock. */
  readonly daysServed: number;
  readonly bountyCleared: boolean;
  readonly hostile: boolean;
  /** A term inside costs you a point of something. It always has. */
  readonly skillLost: SkillId | null;
  readonly text: string;
}

/** Skills that atrophy in a cell, in the order the warden takes them. */
const CELL_ROT: readonly SkillId[] = [
  'speechcraft',
  'mercantile',
  'athletics',
  'acrobatics',
  'longBlade',
  'destruction',
  'security',
  'alchemy',
];

export function resolveJustice(choice: JusticeChoice, bounty: number, gold: number, roll: number): JusticeOutcome {
  if (choice === 'pay') {
    const affordable = gold >= bounty;
    return {
      choice,
      goldPaid: affordable ? bounty : 0,
      daysServed: 0,
      bountyCleared: affordable,
      hostile: false,
      skillLost: null,
      text: affordable
        ? 'The fine is counted, written down, and closed. The trooper does not look up as you go.'
        : 'You cannot cover it. The trooper has heard that before and is already reaching for your arm.',
    };
  }
  if (choice === 'jail') {
    const days = Math.max(1, Math.round(bounty / 100));
    const idx = Math.min(CELL_ROT.length - 1, Math.floor(roll * CELL_ROT.length));
    return {
      choice,
      goldPaid: 0,
      daysServed: days,
      bountyCleared: true,
      hostile: false,
      skillLost: CELL_ROT[idx],
      text: `${days} day${days === 1 ? '' : 's'} in the Ald Sethis cells. You come out with the bounty cleared and something gone out of your hands.`,
    };
  }
  return {
    choice,
    goldPaid: 0,
    daysServed: 0,
    bountyCleared: false,
    hostile: true,
    skillLost: null,
    text: 'You refuse. The trooper steps back to give herself room, and every guard in the district now knows your face.',
  };
}
