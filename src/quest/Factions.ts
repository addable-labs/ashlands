import type { AttributeId, FactionDef, FactionId, FactionRankDef, SkillId } from './types';

/**
 * Nine factions, six of them joinable career tracks. Requirements are attribute
 * and skill floors plus faction reputation, exactly as the series does it: you
 * are not promoted for finishing quests alone, you are promoted when you are
 * *actually good enough*, which is why a Vaelmyr mouth can be a better mage
 * than an Arch-Mage's errand runner and the game never says so out loud.
 */

function ranks(
  names: readonly string[],
  attrA: AttributeId,
  attrB: AttributeId,
  skills: readonly SkillId[],
): FactionRankDef[] {
  return names.map((name, i) => {
    // Linear ramps. The primary skill outpaces the secondaries so that a
    // specialist advances and a dabbler stalls two thirds of the way up.
    const attributes: Partial<Record<AttributeId, number>> = {};
    attributes[attrA] = 22 + i * 4;
    attributes[attrB] = 18 + i * 4;
    const s: Partial<Record<SkillId, number>> = {};
    skills.forEach((k, j) => {
      s[k] = j === 0 ? 5 + i * 8 : 3 + i * 5;
    });
    return { name, attributes, skills: s, rep: i * 6 };
  });
}

export const FACTIONS = {
  fighters: {
    id: 'fighters',
    name: 'Ironring',
    blurb:
      'Valmori-chartered, paid by contract, and — say the Houses — a militia the Concord keeps in Vethmar under another name.',
    ranks: ranks(
      ['Associate', 'Apprentice', 'Journeyman', 'Swordsman', 'Protector', 'Defender', 'Warder', 'Guardian', 'Champion'],
      'strength',
      'endurance',
      ['longBlade', 'block', 'heavyArmor', 'athletics'],
    ),
    rivals: [],
    disliked: ['thieves'],
    favouredRaces: ['nord', 'orc', 'redguard', 'imperial'],
    expelAt: -12,
    hall: 'fighters_hall',
  },
  mages: {
    id: 'mages',
    name: 'Ashen Conclave',
    blurb:
      'Also Valmori-chartered, and openly resented by House Vaelmyr, who consider a guild licence an insult to the idea of a wizard.',
    ranks: ranks(
      ['Associate', 'Apprentice', 'Journeyman', 'Evoker', 'Conjurer', 'Magician', 'Warlock', 'Wizard', 'Arch-Mage'],
      'intelligence',
      'willpower',
      ['destruction', 'alteration', 'mysticism', 'alchemy'],
    ),
    rivals: [],
    disliked: ['telvanni'],
    favouredRaces: ['altmer', 'breton', 'dunmer'],
    expelAt: -12,
    hall: 'mages_hall',
  },
  thieves: {
    id: 'thieves',
    name: 'Quiet Hand',
    blurb:
      'Has no hall, no charter and no name it will admit to. Ask about it in the wrong room and nobody has heard of it.',
    ranks: ranks(
      ['Toad', 'Wet Ear', 'Footpad', 'Blackcap', 'Operative', 'Bandit', 'Captain', 'Ringleader', 'Mastermind'],
      'agility',
      'personality',
      ['security', 'sneak', 'shortBlade', 'mercantile'],
    ),
    rivals: [],
    disliked: ['fighters', 'legion'],
    favouredRaces: ['khajiit', 'bosmer', 'dunmer'],
    expelAt: -12,
    hall: 'thieves_cellar',
  },
  hlaalu: {
    id: 'hlaalu',
    name: 'House Varo',
    blurb: 'Merchants. Varo prospered under the Concord and will prosper after it, and says so without embarrassment.',
    ranks: ranks(
      ['Hireling', 'Retainer', 'Oathman', 'Lawman', 'Kinsman', 'House Cousin', 'House Brother', 'House Father', 'Grandmaster'],
      'personality',
      'speed',
      ['mercantile', 'speechcraft', 'shortBlade', 'security'],
    ),
    rivals: ['redoran', 'telvanni'],
    disliked: ['redoran'],
    favouredRaces: ['dunmer', 'imperial', 'khajiit'],
    expelAt: -10,
    hall: 'hlaalu_counting',
  },
  redoran: {
    id: 'redoran',
    name: 'House Korran',
    blurb: 'Duty, honour, and a long memory. Korran holds the ash-frontier and considers that a moral position.',
    ranks: ranks(
      ['Hireling', 'Retainer', 'Oathman', 'Lawman', 'Kinsman', 'House Cousin', 'House Brother', 'House Father', 'Archmaster'],
      'strength',
      'willpower',
      ['longBlade', 'heavyArmor', 'block', 'spear'],
    ),
    rivals: ['hlaalu', 'telvanni'],
    disliked: ['hlaalu', 'thieves'],
    favouredRaces: ['dunmer', 'nord'],
    expelAt: -8,
    hall: 'redoran_hall',
  },
  telvanni: {
    id: 'telvanni',
    name: 'House Vaelmyr',
    blurb: 'Wizards in towers they grew themselves. Vaelmyr law is that the strong do as they like and the rest are furniture.',
    ranks: ranks(
      ['Hireling', 'Retainer', 'Oathman', 'Lawman', 'Mouth', 'Spellwright', 'Wizard', 'Master', 'Archmagister'],
      'intelligence',
      'willpower',
      ['destruction', 'alchemy', 'conjuration', 'illusion'],
    ),
    rivals: ['hlaalu', 'redoran'],
    disliked: ['mages'],
    favouredRaces: ['dunmer', 'altmer', 'argonian'],
    expelAt: -10,
    hall: 'tel_muran',
  },
  temple: {
    id: 'temple',
    name: 'Temple of the Trine',
    blurb: 'The faith of the three, in the long century since the three stopped answering. Its curates preach continuity very loudly.',
    ranks: ranks(
      ['Layman', 'Novice', 'Initiate', 'Acolyte', 'Adept', 'Curate', 'Disciple', 'Diviner', 'Patriarch'],
      'willpower',
      'personality',
      ['restoration', 'alteration', 'unarmored', 'bluntWeapon'],
    ),
    rivals: [],
    disliked: ['ashlanders'],
    favouredRaces: ['dunmer'],
    expelAt: -10,
    hall: 'temple_sethis',
  },
  ashlanders: {
    id: 'ashlanders',
    name: 'Shirenamat Shirenamat',
    blurb: 'Nomads of the ash. They kept the old prophecies while the Temple was busy editing them.',
    ranks: ranks(
      ['Outlander', 'Clanfriend', 'Hearth-Guest', 'Herdsman', 'Gulakhan', 'Champion', 'Farseer', 'Wise Companion', 'Veyrane'],
      'endurance',
      'agility',
      ['spear', 'marksman', 'athletics', 'unarmored'],
    ),
    rivals: [],
    disliked: ['temple'],
    favouredRaces: ['dunmer'],
    expelAt: -6,
    hall: 'shirenamat',
  },
  legion: {
    id: 'legion',
    name: 'Valmori Cohort',
    blurb: 'Garrison, customs house and law court. Nobody in Ald Sethis loves them and everybody pays them.',
    ranks: ranks(
      ['Recruit', 'Spearman', 'Trooper', 'Agent', 'Champion', 'Knight Errant', 'Knight Bachelor', 'Knight Protector', 'Knight of the Valmori Dragon'],
      'endurance',
      'personality',
      ['longBlade', 'heavyArmor', 'block', 'speechcraft'],
    ),
    rivals: ['thieves'],
    disliked: ['thieves'],
    favouredRaces: ['imperial', 'nord', 'redguard'],
    expelAt: -20,
    hall: 'ald_sethis',
  },
} as const satisfies Record<FactionId, FactionDef>;

export const FACTION_LIST: readonly FactionDef[] = Object.values(FACTIONS);

/** True when holding rank in `a` forbids ever joining `b`. Symmetric. */
export function rivals(a: FactionId, b: FactionId): boolean {
  // Widened: `as const` types an empty rival list as `readonly []`, whose
  // element type is never, and `never[].includes` accepts nothing.
  const ra: readonly FactionId[] = FACTIONS[a].rivals;
  const rb: readonly FactionId[] = FACTIONS[b].rivals;
  return ra.includes(b) || rb.includes(a);
}
