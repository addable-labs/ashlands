import { FACTIONS } from './Factions';
import type { FactionId, NpcDef, PlayerProfile, Race } from './types';

/** Everything the disposition formula reads that is not on the NPC itself. */
export interface DispositionInput {
  readonly profile: PlayerProfile;
  readonly bounty: number;
  rank(f: FactionId): number;
  expelled(f: FactionId): boolean;
  /** Accumulated per-NPC modifier from dialogue, quests and persuasion. */
  delta(npc: NpcDef): number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Disposition is derived, not stored. Only the delta is persisted, so joining a
 * House, gaining a bounty or raising Personality shifts how the whole province
 * treats you without anyone having to write an update rule. That is the
 * difference between a stat and a relationship.
 */
export function disposition(npc: NpcDef, w: DispositionInput): number {
  let d = npc.baseDisposition;

  if (npc.race === w.profile.race) d += 8;

  const f = npc.faction;
  if (f !== null) {
    const def = FACTIONS[f];
    const favoured: readonly Race[] = def.favouredRaces;
    if (favoured.includes(w.profile.race)) d += 5;
    const mine = w.rank(f);
    if (mine >= 0) {
      // Rank inside their own faction reads as standing, but outranking them
      // reads as authority, and authority is not warmth.
      d += 6 + Math.min(mine, npc.rank) * 2;
      if (w.expelled(f)) d -= 30;
    }
    for (const other of def.disliked) {
      const r = w.rank(other);
      if (r >= 0) d -= 6 + r * 2;
    }
    for (const rival of def.rivals) {
      if (w.rank(rival) >= 0) d -= 10;
    }
  }

  d += (w.profile.attributes.personality - 40) * 0.25;
  d += clamp(w.profile.reputation, -20, 40) * 0.5;
  d -= Math.min(35, w.bounty / 40);
  d += w.delta(npc);

  return clamp(Math.round(d), 0, 100);
}

export type PersuasionKind = 'admire' | 'intimidate' | 'taunt' | 'bribe';

export interface PersuasionResult {
  readonly kind: PersuasionKind;
  readonly success: boolean;
  /** Applied to the NPC's stored delta by the caller. */
  readonly delta: number;
  /** Gold the attempt consumed; a failed bribe still costs. */
  readonly cost: number;
  /** True when the NPC has decided to settle this with a weapon. */
  readonly attacks: boolean;
  readonly text: string;
}

const LINES: Record<PersuasionKind, { ok: string; bad: string }> = {
  admire: {
    ok: 'They take the compliment as if they had earned it, which — they will tell you — they had.',
    bad: 'The flattery lands flat and stays there. They have heard better from people who wanted less.',
  },
  intimidate: {
    ok: 'Something goes out of their shoulders. They will do it, and they will not forget being made to.',
    bad: 'They look at you the way you look at weather. Whatever you threatened, they have decided it is not coming.',
  },
  taunt: {
    ok: 'It lands exactly where you aimed it. Their hand has gone somewhere it should not have gone.',
    bad: 'They let it pass, and letting it pass costs them nothing, which is the worst outcome for you.',
  },
  bribe: {
    ok: 'The coin goes away so smoothly you could believe it was never offered.',
    bad: 'They look at the coin, and then at you, and the second look is the expensive one.',
  },
};

/**
 * One roll, four verbs, and every one of them can go wrong. Taunt is the reason
 * this exists: a player must be able to talk a stranger into drawing on them,
 * because a world where conversation cannot start a fight is a world where
 * conversation is a menu.
 */
export function persuade(
  kind: PersuasionKind,
  npc: NpcDef,
  disp: number,
  profile: PlayerProfile,
  roll: number,
  bribeAmount = 0,
): PersuasionResult {
  const speech = profile.skills.speechcraft;
  const per = profile.attributes.personality;
  const luck = profile.attributes.luck;

  // Player term versus NPC term, as a percentage chance. Disposition helps the
  // gentle verbs and hurts the hostile ones: it is hard to frighten a friend.
  const player = speech + per * 0.4 + luck * 0.2;
  const target = npc.personality * 0.5 + npc.willpower * 0.5;
  const lean =
    kind === 'admire' ? disp * 0.3 : kind === 'bribe' ? disp * 0.15 : kind === 'intimidate' ? (50 - disp) * 0.25 : (60 - disp) * 0.2;

  let chance = 35 + (player - target) * 0.9 + lean;

  if (kind === 'bribe') {
    // A bribe is judged against what the NPC is used to handling, not against a
    // flat price. Ten drakes insults a factor and buys a miner outright.
    const scale = Math.max(20, npc.purse * 0.25);
    chance += clamp((bribeAmount / scale) * 40, -20, 45);
  }

  const success = roll * 100 < clamp(chance, 5, 95);
  const magnitude = 4 + Math.round(Math.abs(player - target) * 0.15);

  let delta: number;
  let attacks = false;
  switch (kind) {
    case 'admire':
      delta = success ? magnitude : -Math.round(magnitude * 0.7);
      break;
    case 'intimidate':
      // Fear works and is remembered as a debt. Failing to frighten someone is
      // how you find out they were never afraid.
      delta = success ? magnitude * 2 : -magnitude * 2;
      attacks = !success && disp < 25 && npc.willpower > 55;
      break;
    case 'taunt':
      delta = success ? -magnitude * 2 : -Math.round(magnitude * 0.5);
      attacks = success && disp - magnitude * 2 < 30;
      break;
    case 'bribe':
      delta = success ? magnitude + Math.round(bribeAmount / 40) : -magnitude;
      break;
  }

  return {
    kind,
    success,
    delta,
    cost: kind === 'bribe' ? bribeAmount : 0,
    attacks: attacks && !npc.guard,
    text: success ? LINES[kind].ok : LINES[kind].bad,
  };
}
