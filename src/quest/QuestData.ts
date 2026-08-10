import type { PathDef, QuestDef, QuestId, StageDef } from './types';

/**
 * Two of the main-spine chapters are gathering quests — four verses, three
 * trials — taken in any order through any of several doors. They were authored
 * as a single stage whose every path returned to itself, and that cost the
 * player the only record this game gives them: `World.setStage` refuses to
 * re-enter the stage it is already on, so fetching a verse wrote *nothing* in
 * the journal, and the stage's `enter` effects were skipped with it. In a game
 * with no quest markers, where re-reading the journal is how you work out where
 * to go, a quest that silently records nothing for four errands running is not
 * a quest.
 *
 * The stage number now counts what is in hand. The doors are identical at every
 * count — this helper is what keeps them identical — and only the stage they
 * lead to moves on. Every acquisition is written down, and the last one opens
 * the way out.
 */
const gatheringStage = (
  n: number,
  next: number,
  journal: string,
  doors: (here: number, next: number) => PathDef[],
): StageDef => ({ n, journal, paths: doors(n, next) });

/**
 * Every door to every one of the four verses. `here` is the stage the player is
 * standing on, so a failed roll costs them something and leaves them where they
 * were; `next` is one verse further along.
 *
 * Each verse has at least three doors and none of them is another quest. The
 * Verse of Name used to be reachable only by finishing The Hollow Star and the
 * Verse of Deed only by killing a man who is the subject of a Ironring
 * contract — so a player who had done neither had a chapter of the main quest
 * with no way through it, and a player who took the one Deed door available
 * destroyed a guild quest they had not been offered yet.
 */
const verseDoors = (here: number, next: number): PathDef[] => [
  /* -------------------------------------------- Verse of Ash: at the shrine */
  {
    id: 'ash_ask',
    label: 'Ask Curate Arvel for the Verse of Ash',
    kind: 'persuade',
    when: [{ k: 'not', of: { k: 'item', v: 'verse_ash' } }],
    skill: 'speechcraft',
    difficulty: 45,
    to: next,
    effects: [
      { k: 'item', v: 'verse_ash', n: 1 },
      { k: 'factionRep', faction: 'temple', v: -3 },
    ],
    onFail: {
      to: here,
      effects: [
        { k: 'disposition', v: -15, npc: 'curate_arvel' },
        { k: 'flag', v: 'temple_suspicious' },
      ],
    },
  },
  {
    id: 'ash_dissident',
    label: 'Get a Dissident copy from Madrel Vandas',
    kind: 'talk',
    when: [
      { k: 'not', of: { k: 'item', v: 'verse_ash' } },
      { k: 'stage', quest: 'mq4_dissident_saints', min: 20 },
    ],
    to: next,
    effects: [
      { k: 'item', v: 'verse_ash', n: 1 },
      { k: 'flag', v: 'verse_ash_is_copy' },
    ],
  },
  {
    id: 'ash_steal',
    label: 'Take the Verse of Ash from the reliquary',
    kind: 'steal',
    when: [{ k: 'not', of: { k: 'item', v: 'verse_ash' } }],
    skill: 'security',
    difficulty: 40,
    to: next,
    effects: [
      { k: 'item', v: 'verse_ash', n: 1, stolen: true },
      { k: 'factionRep', faction: 'temple', v: -10 },
    ],
    onFail: {
      to: here,
      effects: [
        { k: 'bounty', v: 300 },
        { k: 'factionRep', faction: 'temple', v: -15 },
      ],
    },
  },

  /* ------------------------------------- Verse of Blood: in the Vaelmyr library */
  {
    id: 'blood_spore',
    label: 'Fetch Nevena Telvo her gallery spore',
    kind: 'trade',
    when: [{ k: 'not', of: { k: 'item', v: 'verse_blood' } }, { k: 'item', v: 'muran_spore' }],
    to: next,
    effects: [
      { k: 'item', v: 'muran_spore', n: -1 },
      { k: 'item', v: 'verse_blood', n: 1 },
    ],
  },
  {
    id: 'blood_buy',
    label: 'Pay Nevena Telvo two thousand drakes',
    kind: 'trade',
    when: [{ k: 'not', of: { k: 'item', v: 'verse_blood' } }, { k: 'item', v: 'gold', min: 2000 }],
    to: next,
    effects: [
      { k: 'gold', v: -2000 },
      { k: 'item', v: 'verse_blood', n: 1 },
    ],
  },
  {
    id: 'blood_copy',
    label: 'Have the Ashen Conclave copy the Vaelmyr page',
    kind: 'talk',
    when: [{ k: 'not', of: { k: 'item', v: 'verse_blood' } }, { k: 'faction', v: 'mages' }],
    to: next,
    effects: [
      { k: 'item', v: 'verse_blood', n: 1 },
      { k: 'flag', v: 'verse_blood_is_copy' },
      { k: 'factionRep', faction: 'telvanni', v: -6 },
      { k: 'factionRep', faction: 'mages', v: 3 },
    ],
  },
  {
    id: 'blood_steal',
    label: 'Rob the Tel Muran library',
    kind: 'steal',
    when: [{ k: 'not', of: { k: 'item', v: 'verse_blood' } }],
    skill: 'sneak',
    difficulty: 55,
    to: next,
    effects: [
      { k: 'item', v: 'verse_blood', n: 1, stolen: true },
      { k: 'factionRep', faction: 'telvanni', v: -12 },
    ],
    onFail: {
      to: here,
      effects: [
        { k: 'attack', npc: 'nevena_telvo' },
        { k: 'factionRep', faction: 'telvanni', v: -20 },
        { k: 'flag', v: 'muran_alerted' },
      ],
    },
  },

  /* ----------------------------------- Verse of Name: the Shirenamat keep it */
  {
    id: 'name_trial',
    label: 'Claim the Verse of Name as clanfriend',
    kind: 'talk',
    when: [{ k: 'not', of: { k: 'item', v: 'verse_name' } }, { k: 'done', quest: 'mq3_hollow_star' }],
    to: next,
    effects: [{ k: 'item', v: 'verse_name', n: 1 }],
  },
  {
    id: 'name_stand',
    label: 'Ask Sul-Kanet for the verse without standing the trials',
    kind: 'persuade',
    when: [{ k: 'not', of: { k: 'item', v: 'verse_name' } }],
    skill: 'speechcraft',
    difficulty: 65,
    to: next,
    effects: [
      { k: 'item', v: 'verse_name', n: 1 },
      { k: 'factionRep', faction: 'ashlanders', v: 2 },
    ],
    onFail: {
      to: here,
      effects: [
        { k: 'disposition', v: -20, npc: 'sul_kanet' },
        { k: 'factionRep', faction: 'ashlanders', v: -5 },
      ],
    },
  },
  {
    id: 'name_take',
    label: "Take the verse out of the wise woman's tent",
    kind: 'steal',
    when: [{ k: 'not', of: { k: 'item', v: 'verse_name' } }],
    skill: 'sneak',
    difficulty: 50,
    to: next,
    effects: [
      { k: 'item', v: 'verse_name', n: 1, stolen: true },
      { k: 'factionRep', faction: 'ashlanders', v: -20 },
      { k: 'disposition', v: -50, npc: 'zabamat' },
    ],
    onFail: {
      to: here,
      effects: [
        { k: 'factionRep', faction: 'ashlanders', v: -25 },
        { k: 'disposition', v: -40, npc: 'sul_kanet' },
      ],
    },
  },

  /* ---------------------------------- Verse of Deed: sold to a smuggler for forty */
  {
    id: 'deed_buy',
    label: 'Buy the Verse of Deed from Kell Blackwater',
    kind: 'bribe',
    when: [{ k: 'not', of: { k: 'item', v: 'verse_deed' } }, { k: 'item', v: 'gold', min: 300 }],
    to: next,
    effects: [
      { k: 'gold', v: -300 },
      { k: 'item', v: 'verse_deed', n: 1 },
      { k: 'disposition', v: 10, npc: 'kell_blackwater' },
    ],
  },
  {
    id: 'deed_lift',
    label: 'Lift the page off Kell while he sleeps out the daylight',
    kind: 'sneak',
    when: [{ k: 'not', of: { k: 'item', v: 'verse_deed' } }],
    skill: 'security',
    difficulty: 45,
    to: next,
    effects: [
      { k: 'item', v: 'verse_deed', n: 1, stolen: true },
      { k: 'disposition', v: -20, npc: 'kell_blackwater' },
    ],
    onFail: {
      to: here,
      effects: [
        { k: 'disposition', v: -35, npc: 'kell_blackwater' },
        { k: 'bounty', v: 120 },
      ],
    },
  },
  {
    id: 'deed_fight',
    label: 'Take the Verse of Deed off the smugglers',
    kind: 'fight',
    when: [{ k: 'not', of: { k: 'item', v: 'verse_deed' } }],
    skill: 'longBlade',
    difficulty: 40,
    to: next,
    effects: [
      { k: 'item', v: 'verse_deed', n: 1, stolen: true },
      { k: 'attack', npc: 'kell_blackwater' },
      { k: 'fail', quest: 'fg1_shipment' },
    ],
    onFail: {
      to: here,
      effects: [
        { k: 'attack', npc: 'kell_blackwater' },
        { k: 'disposition', v: -50, npc: 'kell_blackwater' },
      ],
    },
  },
];

/**
 * The three trials of the Hollow Star, on the same footing as the verses. Each
 * has a door that stands on its own: the Trial of Deed used to be reachable
 * only by finishing one of two entirely different quests, so a player who came
 * to Shirenamat first could stand two trials and then stop forever.
 */
const trialDoors = (here: number, next: number): PathDef[] => [
  {
    id: 'name_speak',
    label: 'Trial of Name — speak your case before the camp',
    kind: 'persuade',
    when: [{ k: 'not', of: { k: 'flag', v: 'trial_name' } }],
    skill: 'speechcraft',
    difficulty: 40,
    to: next,
    effects: [
      { k: 'flag', v: 'trial_name' },
      { k: 'factionRep', faction: 'ashlanders', v: 4 },
    ],
    onFail: { to: here, effects: [{ k: 'disposition', v: -10, npc: 'sul_kanet' }] },
  },
  {
    id: 'name_gift',
    label: 'Trial of Name — give the camp the ancestor ring',
    kind: 'trade',
    when: [{ k: 'not', of: { k: 'flag', v: 'trial_name' } }, { k: 'item', v: 'ancestor_ring' }],
    to: next,
    effects: [
      { k: 'flag', v: 'trial_name' },
      { k: 'item', v: 'ancestor_ring', n: -1 },
      { k: 'fail', quest: 'sq_widows_debt' },
    ],
  },
  {
    id: 'blood_fight',
    label: 'Trial of Blood — fight the gulakhan',
    kind: 'fight',
    when: [{ k: 'not', of: { k: 'flag', v: 'trial_blood' } }],
    skill: 'spear',
    difficulty: 35,
    to: next,
    effects: [
      { k: 'flag', v: 'trial_blood' },
      { k: 'factionRep', faction: 'ashlanders', v: 5 },
    ],
    onFail: {
      to: here,
      effects: [
        { k: 'disposition', v: -15, npc: 'sul_kanet' },
        { k: 'factionRep', faction: 'ashlanders', v: -3 },
      ],
    },
  },
  {
    id: 'blood_bleed',
    label: 'Trial of Blood — open your own arm and stand still',
    kind: 'talk',
    when: [{ k: 'not', of: { k: 'flag', v: 'trial_blood' } }, { k: 'attribute', v: 'willpower', min: 45 }],
    to: next,
    effects: [
      { k: 'flag', v: 'trial_blood' },
      { k: 'factionRep', faction: 'ashlanders', v: 6 },
      { k: 'disposition', v: 15, npc: 'zabamat' },
    ],
  },
  {
    id: 'deed_caravan',
    label: 'Trial of Deed — the caravan on the Ashfall road',
    kind: 'travel',
    when: [{ k: 'not', of: { k: 'flag', v: 'trial_deed' } }, { k: 'done', quest: 'sq_ashfall_caravan' }],
    to: next,
    effects: [
      { k: 'flag', v: 'trial_deed' },
      { k: 'factionRep', faction: 'ashlanders', v: 5 },
    ],
  },
  {
    id: 'deed_mine',
    label: 'Trial of Deed — bring the sealed gallery to an end',
    kind: 'fight',
    when: [{ k: 'not', of: { k: 'flag', v: 'trial_deed' } }, { k: 'done', quest: 'mg2_missing_apprentice' }],
    to: next,
    effects: [
      { k: 'flag', v: 'trial_deed' },
      { k: 'factionRep', faction: 'ashlanders', v: 4 },
    ],
  },
  {
    id: 'deed_hunt',
    label: 'Trial of Deed — the ash shrike that has been taking the herd-boys',
    kind: 'fight',
    when: [{ k: 'not', of: { k: 'flag', v: 'trial_deed' } }],
    skill: 'marksman',
    difficulty: 45,
    to: next,
    effects: [
      { k: 'flag', v: 'trial_deed' },
      { k: 'factionRep', faction: 'ashlanders', v: 5 },
      { k: 'disposition', v: 10, npc: 'sul_kanet' },
    ],
    onFail: {
      to: here,
      effects: [
        { k: 'factionRep', faction: 'ashlanders', v: -2 },
        { k: 'disposition', v: -10, npc: 'sul_kanet' },
      ],
    },
  },
];

/**
 * Eighteen quests, authored as data.
 *
 * Two rules govern every one of them. First, no stage has a single way out:
 * every gate can be met by force, by stealth, by talk, by coin, or by going to
 * somebody else entirely — and taking one door closes others for good. Second,
 * a quest that is neglected can be lost forever. A world where the widow waits
 * patiently until the player is ready is a world with no weight in it.
 *
 * The main spine is five chapters. It is a prophecy structure: rumour, text,
 * trial, schism, and the place the text was pointing at. The prophecy is never
 * confirmed by the game. Three sources describe it and they do not agree.
 */
export const QUESTS = {
  /* --------------------------------------------------------- the main spine */
  mq1_ash_wake: {
    id: 'mq1_ash_wake',
    name: 'The Ash-Wake',
    giver: 'seryn_othrelas',
    faction: null,
    advancement: false,
    stages: [
      {
        n: 10,
        journal:
          'They are saying in the Ashen Flagon that a courier came off the Ashfall road bleeding and would not say what did it. She has not moved from where she fell.',
        // The opening had no paths at all: the only way out of the rumour was to
        // find Seryn Othrelas and ask her about it, which lives in Topics and is
        // therefore invisible to the quest log, to a journal UI, and to anything
        // that reads the stage graph. Going to look for her is an act the player
        // takes, so it is a path like any other, and asking after her in the
        // Flagon is the second door the opening of the main quest was missing.
        paths: [
          { id: 'road', label: 'Walk the Ashfall road and find the courier', kind: 'travel', to: 20 },
          {
            id: 'flagon_round',
            label: 'Buy the common room a round and let it talk',
            kind: 'bribe',
            when: [{ k: 'item', v: 'gold', min: 25 }],
            to: 20,
            effects: [
              { k: 'gold', v: -25 },
              { k: 'topic', v: 'latest_rumours' },
              { k: 'disposition', v: 10, npc: 'dinara_loras' },
            ],
          },
          {
            id: 'press_dinara',
            label: 'Press Dinara Loras for the part she left out',
            kind: 'persuade',
            skill: 'speechcraft',
            difficulty: 30,
            to: 20,
            effects: [
              { k: 'topic', v: 'the_ash_wake' },
              { k: 'disposition', v: 5, npc: 'dinara_loras' },
            ],
            onFail: { to: 20, effects: [{ k: 'disposition', v: -15, npc: 'dinara_loras' }] },
          },
        ],
      },
      {
        n: 20,
        journal:
          'Seryn Othrelas gave me a packet sealed with ash-wax. She was to carry it to a wise woman called Zabamat at the Shirenamat camp of Shirenamat, and she says whoever stopped her on the road wanted the packet and not her purse. She would not say more, and I am not sure she knows more.',
        paths: [
          {
            id: 'carry',
            label: 'Carry the packet to Shirenamat',
            kind: 'travel',
            to: 30,
          },
          {
            id: 'open',
            label: 'Break the seal and read it',
            kind: 'sneak',
            skill: 'security',
            difficulty: 25,
            to: 30,
            effects: [
              { k: 'flag', v: 'mq1_read_packet' },
              { k: 'topic', v: 'four_verses' },
              { k: 'disposition', v: -25, npc: 'zabamat' },
            ],
            onFail: {
              to: 30,
              effects: [
                { k: 'flag', v: 'mq1_broke_seal' },
                { k: 'disposition', v: -40, npc: 'zabamat' },
              ],
            },
          },
          {
            id: 'sell',
            label: 'Sell the packet to Nevena Telvo',
            kind: 'trade',
            to: 35,
            effects: [
              { k: 'gold', v: 500 },
              { k: 'item', v: 'sealed_packet', n: -1 },
              { k: 'flag', v: 'mq1_sold_packet' },
              { k: 'disposition', v: -30, npc: 'zabamat' },
              { k: 'factionRep', faction: 'telvanni', v: 3 },
            ],
          },
        ],
      },
      {
        n: 35,
        journal:
          'I sold the packet to Nevena Telvo of Tel Muran for five hundred drakes. She did not ask where I had it from, which I take to mean she already knew. If I want it back it will cost more than she paid, and word of what I did will reach Shirenamat before I do.',
        paths: [
          {
            id: 'buyback',
            label: 'Buy the packet back from Nevena Telvo',
            kind: 'trade',
            when: [{ k: 'item', v: 'gold', min: 1500 }],
            to: 30,
            effects: [
              { k: 'gold', v: -1500 },
              { k: 'item', v: 'sealed_packet', n: 1 },
            ],
          },
          {
            id: 'steal_back',
            label: 'Steal it back from the tower',
            kind: 'steal',
            skill: 'sneak',
            difficulty: 45,
            to: 30,
            effects: [
              { k: 'item', v: 'sealed_packet', n: 1, stolen: true },
              { k: 'factionRep', faction: 'telvanni', v: -8 },
            ],
            onFail: { to: 35, effects: [{ k: 'bounty', v: 400 }, { k: 'disposition', v: -30, npc: 'nevena_telvo' }] },
          },
        ],
      },
      {
        n: 30,
        journal:
          'I have the packet and the road to Shirenamat. The camp lies out on the ash flats where the wind carries clean, and the Shirenamat do not post a gate because they do not need one.',
        // Second dead end: arriving at the camp had no exit either, for the same
        // reason — the handover was authored only as a line of dialogue.
        paths: [
          { id: 'deliver', label: "Put the packet in Zabamat's hands", kind: 'travel', to: 40 },
          {
            id: 'to_ashkhan',
            label: 'Give it to Sul-Kanet the Ashkhan instead',
            kind: 'talk',
            to: 38,
            effects: [
              { k: 'factionRep', faction: 'ashlanders', v: 2 },
              { k: 'disposition', v: -20, npc: 'zabamat' },
              { k: 'topic', v: 'ashlanders' },
            ],
          },
        ],
      },
      {
        n: 38,
        journal:
          'I put the packet in the Ashkhan\'s hand and not the wise woman\'s, which I understood to be a mistake about four seconds after I did it. Sul-Kanet looked at the seal, did not open it, and carried it to Zabamat himself. She read it in her own tent with the flap shut and sent word out that the outlander may come in. I have been told twice since, by two different people, that the order of those two acts matters.',
        finished: true,
      },
      {
        n: 40,
        journal:
          'Zabamat opened the packet in front of me and read it without surprise. It is a page of the Ash-Wake — a prophecy the Temple says was never written. She says the Ash-Wake is not the promise of a hero. It is the description of a waking, and she says the word "waking" the way other people say the word "fire".',
        finished: true,
      },
    ],
  },

  mq2_four_verses: {
    id: 'mq2_four_verses',
    name: 'The Four Verses',
    giver: 'zabamat',
    faction: null,
    advancement: false,
    stages: [
      gatheringStage(
        10,
        11,
        'Zabamat wants the four verses of the Ash-Wake brought together: Ash, Blood, Name and Deed. The Verse of Ash is at the shrine in Ald Sethis, though the Temple denies holding it. The Verse of Blood is in the Vaelmyr library at Tel Muran. The Verse of Name belongs to the Shirenamat and must be earned. The Verse of Deed was sold to a smuggler for forty drakes, which she told me twice.',
        verseDoors,
      ),
      gatheringStage(
        11,
        12,
        'One of the four is in my hands. It is a single hide leaf, written across rather than down, and the ash has got into the fibre so deep that the letters stand up out of it. Zabamat did not say what happens when the four are laid together. I notice I still have not asked.',
        verseDoors,
      ),
      gatheringStage(
        12,
        13,
        'Two verses. They are not in the same hand and they are not the same age, and the older of the two is not the one the Temple would tell you is older. I have started reading them at night, the way other people check a door is locked.',
        verseDoors,
      ),
      gatheringStage(
        13,
        14,
        'Three. Whatever the fourth one says, these three already agree on a place and on an hour, and they agree in language that does not leave much room for a metaphor.',
        verseDoors,
      ),
      {
        n: 14,
        journal:
          'All four verses are in my pack. They are heavier than paper. Zabamat is at Shirenamat and she has been waiting on this since before I was born, and I have spent the walk out deciding whether to tell her about the fourth.',
        paths: [
          { id: 'gathered', label: 'Lay the four verses before Zabamat', kind: 'travel', to: 50 },
          {
            id: 'sell_set',
            label: 'Sell the set to Nevena Telvo',
            kind: 'trade',
            to: 45,
            effects: [
              { k: 'item', v: 'verse_ash', n: -1 },
              { k: 'item', v: 'verse_blood', n: -1 },
              { k: 'item', v: 'verse_name', n: -1 },
              { k: 'item', v: 'verse_deed', n: -1 },
              { k: 'gold', v: 2500 },
              { k: 'factionRep', faction: 'telvanni', v: 12 },
              { k: 'factionRep', faction: 'ashlanders', v: -20 },
              { k: 'disposition', v: -60, npc: 'zabamat' },
              { k: 'reputation', v: -5 },
            ],
          },
        ],
      },
      {
        n: 45,
        journal:
          'Nevena Telvo has the complete Ash-Wake and I have two thousand five hundred drakes, and she counted them out slowly enough that I had time to change my mind and did not. She will not read it aloud and she will not let it out of the tower. Word reached Shirenamat inside a day. Zabamat has not sent for me and she will not.',
        finished: true,
      },
      {
        n: 50,
        journal:
          'Zabamat laid the four verses out on hide in the order Ash, Blood, Name, Deed, and read them through twice without speaking. Then she said the thing I have not been able to put down since: that the fourth verse is in a different hand, and that the different hand is more recent than the Temple, and that somebody wrote the ending of this prophecy after the beginning had already started coming true.',
        finished: true,
      },
    ],
  },

  mq3_hollow_star: {
    id: 'mq3_hollow_star',
    name: 'The Hollow Star',
    giver: 'sul_kanet',
    faction: 'ashlanders',
    advancement: false,
    stages: [
      gatheringStage(
        10,
        11,
        'Sul-Kanet, Ashkhan of the Shirenamat, will not take Zabamat\'s word for me. He sets three trials, the same three the verses name: Name, Blood and Deed. He was careful to say that many have been described by the verse and most of them died proving it.',
        trialDoors,
      ),
      gatheringStage(
        11,
        12,
        'One trial stood. Nobody in the camp said anything about it afterwards, which I am told is the correct response and not a slight, and I have decided to believe that.',
        trialDoors,
      ),
      gatheringStage(
        12,
        13,
        'Two of the three. The camp has started leaving a place at the fire that is neither the guest place nor a clan place, and Zabamat watched them do it and said nothing at all.',
        trialDoors,
      ),
      {
        n: 13,
        journal:
          'Name, Blood and Deed, all three of them behind me. Sul-Kanet knows. He has known since the second one and he has been letting the camp arrive at it in its own time, which I understand now is what an Ashkhan is for.',
        paths: [
          {
            id: 'trials_done',
            label: 'Stand before Sul-Kanet with all three trials behind you',
            kind: 'talk',
            to: 40,
            effects: [
              { k: 'join', faction: 'ashlanders' },
              { k: 'factionRep', faction: 'ashlanders', v: 10 },
              { k: 'reputation', v: 8 },
              { k: 'topic', v: 'the_ashen_gate' },
            ],
          },
          {
            id: 'trials_refused',
            label: 'Stand the trials and decline the name',
            kind: 'talk',
            to: 38,
            effects: [
              { k: 'factionRep', faction: 'ashlanders', v: 4 },
              { k: 'reputation', v: 3 },
              { k: 'topic', v: 'the_ashen_gate' },
              { k: 'disposition', v: -15, npc: 'sul_kanet' },
            ],
          },
        ],
      },
      {
        n: 38,
        journal:
          'I stood the three trials and then would not take the name, and I could not have told you why while I was doing it. Sul-Kanet took it better than the camp did. He said a clan is not a debt and that I had discharged nothing by refusing, and then he gave me the Verse of Name anyway, which I think was the point he was making.',
        finished: true,
      },
      {
        n: 40,
        journal:
          'Sul-Kanet named me clanfriend of the Shirenamat in front of the whole camp, and then said, quietly and only to me, that he still did not believe the verse and that believing it was not required of him. Zabamat gave me the Verse of Name. She says the Gate of Ash is real and that it is not a door.',
        finished: true,
      },
    ],
  },

  mq4_dissident_saints: {
    id: 'mq4_dissident_saints',
    name: 'The Dissident Saints',
    giver: 'madrel_vandas',
    faction: null,
    advancement: false,
    stages: [
      {
        n: 10,
        journal:
          'There is a heretic in Ald Sethis. The Temple calls Madrel Vandas a Dissident; Curate Arvel taught him and will not say more than that. He keeps to the shrine after the doors are barred, and to Tel Muran in the day, which is a strange pair of addresses for a man of the faith.',
        // As with the opening of mq1, the only exit here was a line of dialogue
        // gated on Madrel's disposition, so the stage graph itself was a dead
        // end. His two addresses are two doors, and Arvel is a third — the
        // journal entry names all three and now the quest actually has them.
        paths: [
          { id: 'tel_muran_day', label: 'Ask for him at Tel Muran, where he works the day', kind: 'talk', to: 20 },
          {
            id: 'shrine_night',
            label: 'Wait at the shrine after the doors are barred',
            kind: 'sneak',
            when: [{ k: 'hour', min: 21, max: 5 }],
            to: 20,
            effects: [
              { k: 'flag', v: 'madrel_trusts' },
              { k: 'disposition', v: 15, npc: 'madrel_vandas' },
            ],
          },
          {
            id: 'ask_arvel',
            label: 'Ask Curate Arvel what it was he taught him',
            kind: 'persuade',
            skill: 'speechcraft',
            difficulty: 40,
            to: 20,
            effects: [
              { k: 'topic', v: 'tribunal_temple' },
              { k: 'factionRep', faction: 'temple', v: 2 },
            ],
            onFail: {
              to: 20,
              effects: [
                { k: 'flag', v: 'temple_suspicious' },
                { k: 'disposition', v: -10, npc: 'curate_arvel' },
              ],
            },
          },
        ],
      },
      {
        n: 20,
        journal:
          'Madrel Vandas showed me his codex. It is a copy of a copy, three generations of scribes deep, of scripture the Temple has printed without the pages he is holding. He does not claim the Temple is lying about the Three. He claims the Temple is lying about the Temple. I cannot tell whether those are different accusations.',
        paths: [
          {
            id: 'to_temple',
            label: 'Take the codex to Curate Arvel',
            kind: 'talk',
            to: 30,
            effects: [
              { k: 'flag', v: 'codex_burned' },
              { k: 'factionRep', faction: 'temple', v: 15 },
              { k: 'factionRep', faction: 'ashlanders', v: -8 },
              { k: 'disposition', v: -60, npc: 'madrel_vandas' },
            ],
          },
          {
            id: 'protect',
            label: 'Warn Madrel and get him out of the district',
            kind: 'persuade',
            skill: 'speechcraft',
            difficulty: 35,
            to: 31,
            effects: [
              { k: 'flag', v: 'codex_hidden' },
              { k: 'factionRep', faction: 'temple', v: -12 },
              { k: 'disposition', v: 30, npc: 'madrel_vandas' },
              { k: 'topic', v: 'books' },
            ],
            onFail: {
              to: 32,
              effects: [{ k: 'flag', v: 'madrel_taken' }, { k: 'factionRep', faction: 'temple', v: -4 }],
            },
          },
          {
            id: 'publish',
            label: 'Have the Ashen Conclave copy and circulate it',
            kind: 'trade',
            when: [{ k: 'faction', v: 'mages' }],
            to: 33,
            effects: [
              { k: 'flag', v: 'codex_published' },
              { k: 'factionRep', faction: 'temple', v: -25 },
              { k: 'factionRep', faction: 'mages', v: 8 },
              { k: 'reputation', v: 6 },
            ],
          },
        ],
      },
      {
        n: 30,
        journal:
          'Curate Arvel took the codex, read four lines of it, and put it in the brazier. He wept while it burned and he did not stop it burning. He says I have done the Temple a service and he does not thank me for it.',
        finished: true,
      },
      {
        n: 31,
        journal:
          'Madrel Vandas is gone north with the codex under his coat and a Korran ash-watch escort I did not arrange and he will not explain. The Temple knows a name and no longer knows a face.',
        finished: true,
      },
      {
        n: 32,
        journal:
          'I was too slow, or too loud. The Wardens took Madrel Vandas out of the shrine before the fourth bell and nobody in Ald Sethis saw it happen, which is not the same as nobody knowing.',
        finished: true,
      },
      {
        n: 33,
        journal:
          'The Ashen Conclave copied the codex eleven times before the Temple heard the presses. Brenn Alvis says he did it for the scholarship. He also said it with a straight face, which is how I know he did it for the pleasure of it.',
        finished: true,
      },
    ],
  },

  mq5_ashen_gate: {
    id: 'mq5_ashen_gate',
    name: 'The Gate of Ash',
    giver: 'zabamat',
    faction: null,
    advancement: false,
    stages: [
      {
        n: 10,
        journal:
          'The four verses agree on a place under Ember Mount that the Shirenamat call the Gate of Ash, and they agree on an hour: the hour before dawn, when the second moon is dark. Zabamat will not come. She says the verse names one, and that she has spent forty years being certain it was not her.',
        paths: [
          {
            id: 'descend',
            label: 'Go down at the hour before dawn',
            kind: 'travel',
            when: [{ k: 'hour', min: 4, max: 6 }],
            to: 20,
          },
          {
            id: 'descend_wrong',
            label: 'Go down whenever you please',
            kind: 'travel',
            to: 15,
          },
        ],
      },
      {
        n: 15,
        journal:
          'The Gate was shut. Not locked — shut, the way a face is shut. I have learned that the verses meant the hour literally, which the Temple would find very funny if the Temple believed any of this.',
        // This stage had exactly one way out and it was gated on the same hour
        // that had just been missed, so for twenty-two hours of every day the
        // last chapter of the main quest had no exit at all. Waiting at the
        // shaft head *is* how a player reaches the hour; it costs a day and it
        // always works. The second door costs a walk instead.
        paths: [
          { id: 'wait', label: 'Sit out the day at the shaft head and go down at the hour', kind: 'travel', to: 20 },
          {
            id: 'ask_zabamat',
            label: 'Walk back to Shirenamat and ask what the hour means',
            kind: 'talk',
            to: 20,
            effects: [
              { k: 'topic', v: 'the_ashen_gate' },
              { k: 'disposition', v: 10, npc: 'zabamat' },
            ],
          },
        ],
      },
      {
        n: 20,
        journal:
          'It is not a door. It is a shaft of settled ash a thousand years deep, and it is warm, and there is a sound at the bottom of it that is exactly as regular as breathing and exactly as slow as a tide. Whatever the Ash-Wake describes, it is down there, and it has been down there the entire time anyone has been arguing about the text.',
        paths: [
          {
            id: 'wake',
            label: 'Wake it, as the verse describes',
            kind: 'talk',
            to: 40,
            effects: [
              { k: 'flag', v: 'gate_woke' },
              { k: 'weather', v: 'ashstorm' },
              { k: 'reputation', v: 20 },
              { k: 'factionRep', faction: 'ashlanders', v: 15 },
              { k: 'factionRep', faction: 'temple', v: -20 },
            ],
          },
          {
            id: 'seal',
            label: 'Seal the shaft and let it sleep',
            kind: 'fight',
            skill: 'alteration',
            difficulty: 45,
            to: 41,
            effects: [
              { k: 'flag', v: 'gate_sealed' },
              { k: 'reputation', v: 12 },
              { k: 'factionRep', faction: 'temple', v: 20 },
              { k: 'factionRep', faction: 'ashlanders', v: -15 },
            ],
            onFail: { to: 42, effects: [{ k: 'flag', v: 'gate_botched' }, { k: 'weather', v: 'blight' }] },
          },
          {
            id: 'leave',
            label: 'Climb out and tell nobody',
            kind: 'sneak',
            to: 43,
            effects: [{ k: 'flag', v: 'gate_left' }, { k: 'reputation', v: -4 }],
          },
        ],
      },
      {
        n: 40,
        journal:
          'It woke. The ash went up off the whole western flank in one breath and came down for a day and a night, and Ald Sethis shuttered and held. Zabamat says the verse is fulfilled. Curate Arvel says a volcano did what volcanoes do. Both of them are describing the same afternoon and I was standing in it, and I could not tell you which of them is wrong.',
        finished: true,
      },
      {
        n: 41,
        journal:
          'I sealed the shaft. The sound stopped, or the sound is now on the other side of a great deal of stone, and there is no way at all to know which. The Temple has been generous. The Shirenamat have struck the camp and moved east without a word to me.',
        finished: true,
      },
      {
        n: 42,
        journal:
          'The seal took badly. The shaft is closed and the mountain is not right — the wind off it carries blight now where it did not, and it will carry it for a season at least. I have made something worse in the course of trying to make it safe, and there is no page of verse about that.',
        finished: true,
      },
      {
        n: 43,
        journal:
          'I climbed out. Nothing happened, which is what happens most of the time. The verses are on hide in a tent on the ash flats and the sound is still down there keeping its time, and one day it will not need me.',
        finished: true,
      },
    ],
  },

  /* ------------------------------------------------------------ guild work */
  fg1_shipment: {
    id: 'fg1_shipment',
    name: 'The Missing Strongbox',
    giver: 'hrafna_gulhild',
    faction: 'fighters',
    advancement: true,
    stages: [
      {
        n: 10,
        journal:
          'Hrafna Gulhild says a Guild strongbox left the docks and never reached the hall. She wants it back and she does not want the Legion involved, which she said before I asked.',
        paths: [
          { id: 'ask_docks', label: 'Ask on the docks after the smugglers', kind: 'talk', to: 15, effects: [{ k: 'topic', v: 'smugglers' }] },
          {
            id: 'to_legion',
            label: 'Take it to Captain Selvi instead',
            kind: 'talk',
            to: 60,
            effects: [
              { k: 'factionRep', faction: 'legion', v: 10 },
              { k: 'factionRep', faction: 'fighters', v: -14 },
              { k: 'disposition', v: -35, npc: 'hrafna_gulhild' },
              { k: 'reputation', v: 3 },
            ],
          },
        ],
      },
      {
        n: 15,
        journal:
          'The name on the docks is Kell Blackwater, a Skarn who works the north coast and sleeps by the ash-quay in daylight hours.',
        paths: [
          {
            id: 'fight',
            label: 'Take the strongbox by force',
            kind: 'fight',
            skill: 'longBlade',
            difficulty: 35,
            to: 40,
            effects: [{ k: 'item', v: 'guild_shipment', n: 1 }, { k: 'attack', npc: 'kell_blackwater' }],
            onFail: { to: 15, effects: [{ k: 'attack', npc: 'kell_blackwater' }, { k: 'bounty', v: 100 }] },
          },
          {
            id: 'persuade',
            label: 'Persuade Kell that the Guild is worse than the Legion',
            kind: 'persuade',
            skill: 'speechcraft',
            difficulty: 40,
            to: 40,
            effects: [{ k: 'item', v: 'guild_shipment', n: 1 }, { k: 'disposition', v: 10, npc: 'kell_blackwater' }],
            onFail: { to: 15, effects: [{ k: 'disposition', v: -20, npc: 'kell_blackwater' }] },
          },
          {
            id: 'bribe',
            label: 'Buy it back with your own coin',
            kind: 'bribe',
            when: [{ k: 'item', v: 'gold', min: 250 }],
            to: 40,
            effects: [{ k: 'gold', v: -250 }, { k: 'item', v: 'guild_shipment', n: 1 }, { k: 'disposition', v: 15, npc: 'kell_blackwater' }],
          },
          {
            id: 'sneak',
            label: 'Lift it off the quay at night',
            kind: 'sneak',
            when: [{ k: 'hour', min: 22, max: 4 }],
            skill: 'sneak',
            difficulty: 35,
            to: 40,
            effects: [{ k: 'item', v: 'guild_shipment', n: 1 }],
            onFail: { to: 15, effects: [{ k: 'attack', npc: 'kell_blackwater' }, { k: 'bounty', v: 200 }] },
          },
        ],
      },
      {
        n: 40,
        journal: 'I have the strongbox. Hrafna Gulhild is in the Ironring hall until the evening bell.',
        paths: [
          {
            id: 'return',
            label: 'Return it to Hrafna',
            kind: 'talk',
            to: 50,
            effects: [
              { k: 'item', v: 'guild_shipment', n: -1 },
              { k: 'gold', v: 300 },
              { k: 'factionRep', faction: 'fighters', v: 8 },
              { k: 'reputation', v: 2 },
            ],
          },
          {
            id: 'keep',
            label: 'Keep it and fence it',
            kind: 'trade',
            when: [{ k: 'faction', v: 'thieves' }],
            to: 61,
            effects: [
              { k: 'item', v: 'guild_shipment', n: -1 },
              { k: 'gold', v: 450 },
              { k: 'factionRep', faction: 'fighters', v: -20 },
              { k: 'factionRep', faction: 'thieves', v: 8 },
              { k: 'expel', faction: 'fighters' },
            ],
          },
        ],
      },
      { n: 50, journal: 'Hrafna paid me three hundred drakes and did not ask how I got it back. I take that to be the arrangement.', finished: true },
      { n: 60, journal: 'Captain Selvi recovered the strongbox and the Legion holds it pending an inquiry. The Guild hall has gone quiet on me.', finished: true },
      { n: 61, journal: 'I sold the Guild its own strongbox through a fence. Hrafna will have my name off the roll by morning.', finished: true },
      {
        // Hrafna and Kell are both `essentialTo` this contract, and either of
        // them can be killed — by the player, or by a path in another quest that
        // settles a different argument with the same man. Without an authored
        // stage the journal closed on the engine's own apology instead of on the
        // world's voice, and the quest read afterwards as one that had never
        // been offered at all.
        n: 90,
        journal:
          'Kell Blackwater is past being asked anything and the Guild strongbox went into the ash-shallows with his boat. Hrafna Gulhild struck the contract off the board herself. She did not ask me a single question about it, which is a great deal worse than if she had.',
        failed: true,
      },
    ],
  },

  fg2_nixhound_den: {
    id: 'fg2_nixhound_den',
    name: 'The Den on the Ashfall Road',
    giver: 'hrafna_gulhild',
    faction: 'fighters',
    advancement: true,
    stages: [
      {
        n: 10,
        journal:
          'A glassjaw pack has denned within sight of the Ashfall road and taken two drell and a carter. The Guild has a contract on it from the caravaners.',
        paths: [
          {
            id: 'clear',
            label: 'Clear the den',
            kind: 'fight',
            skill: 'longBlade',
            difficulty: 30,
            to: 30,
            effects: [{ k: 'factionRep', faction: 'fighters', v: 6 }, { k: 'gold', v: 200 }],
            onFail: { to: 10, effects: [{ k: 'factionRep', faction: 'fighters', v: -2 }] },
          },
          {
            id: 'lure',
            label: 'Draw them off with tainted morvek meat',
            kind: 'sneak',
            skill: 'alchemy',
            difficulty: 35,
            to: 31,
            effects: [{ k: 'factionRep', faction: 'fighters', v: 4 }, { k: 'gold', v: 200 }, { k: 'factionRep', faction: 'ashlanders', v: 3 }],
            onFail: { to: 10, effects: [{ k: 'disposition', v: -8, npc: 'hrafna_gulhild' }] },
          },
          {
            id: 'move_road',
            label: 'Persuade the caravaners to move the road instead',
            kind: 'persuade',
            skill: 'speechcraft',
            difficulty: 45,
            to: 32,
            effects: [{ k: 'factionRep', faction: 'fighters', v: -3 }, { k: 'factionRep', faction: 'ashlanders', v: 6 }, { k: 'disposition', v: 15, npc: 'bemis_alen' }],
            onFail: { to: 10, effects: [{ k: 'disposition', v: -10, npc: 'bemis_alen' }] },
          },
        ],
      },
      { n: 30, journal: 'The den is empty and the contract is closed. Hrafna counted the ears without comment.', finished: true },
      { n: 31, journal: 'The pack has moved off east after the bait and the road is open. Hrafna paid, though she made a point of saying the contract said "clear".', finished: true },
      { n: 32, journal: 'The caravaners will take the low crossing until the pack moves on. It cost them two hours a run and cost me the contract fee, and there is a den full of living animals on the Ashfall road.', finished: true },
    ],
  },

  mg1_reagents: {
    id: 'mg1_reagents',
    name: 'Reagents from Kaldera',
    giver: 'brenn_alvis',
    faction: 'mages',
    advancement: true,
    stages: [
      {
        n: 10,
        journal: 'Brenn Alvis needs morvek cuttle and vekling jelly from the Kaldera mine, and he needs it before the Guild\'s enchanting stock runs out.',
        paths: [
          { id: 'gather', label: 'Go into the mine and gather it', kind: 'travel', to: 20, effects: [{ k: 'item', v: 'kwama_reagents', n: 1 }] },
          {
            id: 'buy',
            label: 'Buy it from Gadan Sarothril',
            kind: 'trade',
            when: [{ k: 'item', v: 'gold', min: 120 }],
            skill: 'mercantile',
            difficulty: 25,
            to: 20,
            effects: [{ k: 'gold', v: -120 }, { k: 'item', v: 'kwama_reagents', n: 1 }],
            onFail: { to: 10, effects: [{ k: 'gold', v: -200 }, { k: 'item', v: 'kwama_reagents', n: 1 }, { k: 'disposition', v: -5, npc: 'gadan_sarothril' }] },
          },
          {
            id: 'steal',
            label: 'Take it out of the mine store',
            kind: 'steal',
            skill: 'sneak',
            difficulty: 30,
            to: 20,
            effects: [{ k: 'item', v: 'kwama_reagents', n: 1, stolen: true }],
            onFail: { to: 10, effects: [{ k: 'bounty', v: 80 }, { k: 'disposition', v: -25, npc: 'gadan_sarothril' }] },
          },
        ],
      },
      {
        n: 20,
        journal: 'I have the reagents.',
        paths: [
          {
            id: 'deliver',
            label: 'Deliver to Brenn Alvis',
            kind: 'talk',
            to: 30,
            effects: [{ k: 'item', v: 'kwama_reagents', n: -1 }, { k: 'gold', v: 150 }, { k: 'factionRep', faction: 'mages', v: 6 }],
          },
        ],
      },
      { n: 30, journal: 'Delivered. Brenn says the Guild will remember it, which in his mouth is a technical term.', finished: true },
    ],
  },

  mg2_missing_apprentice: {
    id: 'mg2_missing_apprentice',
    name: 'The Apprentice at Kaldera',
    giver: 'brenn_alvis',
    faction: 'mages',
    advancement: true,
    stages: [
      {
        n: 10,
        journal:
          'Falia Beren, an apprentice of the Guild, went to Kaldera four days ago for spore samples and has not come back. Gadan Sarothril sealed the fourth gallery after two diggers came out of it with the ash-cough. She will have gone in anyway.',
        paths: [
          {
            id: 'ask_gadan',
            label: 'Get the gallery key from Gadan',
            kind: 'persuade',
            skill: 'speechcraft',
            difficulty: 30,
            to: 20,
            onFail: { to: 10, effects: [{ k: 'disposition', v: -10, npc: 'gadan_sarothril' }] },
          },
          {
            id: 'pay_gadan',
            label: 'Pay Gadan for the key',
            kind: 'bribe',
            when: [{ k: 'item', v: 'gold', min: 100 }],
            to: 20,
            effects: [{ k: 'gold', v: -100 }],
          },
          {
            id: 'break_seal',
            label: 'Break the seal on the fourth gallery',
            kind: 'steal',
            skill: 'security',
            difficulty: 35,
            to: 20,
            effects: [{ k: 'disposition', v: -20, npc: 'gadan_sarothril' }, { k: 'bounty', v: 50 }],
            onFail: { to: 10, effects: [{ k: 'bounty', v: 100 }] },
          },
        ],
      },
      {
        n: 20,
        journal: 'The fourth gallery is open. It smells of ash and something sweeter underneath it.',
        paths: [
          {
            id: 'rescue',
            label: 'Bring Falia out',
            kind: 'travel',
            to: 40,
            effects: [{ k: 'factionRep', faction: 'mages', v: 10 }, { k: 'reputation', v: 4 }, { k: 'disposition', v: 40, npc: 'falia_beren' }],
          },
        ],
      },
      {
        n: 40,
        journal:
          'Falia Beren is alive, blind in one eye and coughing ash, and she will not stop talking about what she heard in the gallery — a sound at the bottom of the rock like slow breathing. Brenn Alvis has written it up as exposure.',
        finished: true,
      },
      {
        n: 90,
        journal:
          'They brought Falia Beren down from Kaldera on the fourth day. She had been dead for two of them. Brenn Alvis wrote the letter to Daggerfall himself and has not been in the guild hall since.',
        failed: true,
      },
    ],
    expiry: [{ afterDays: 4, maxStage: 20, to: 90 }],
  },

  /* --------------------------------------------------------------- thieves */
  tg1_ledger: {
    id: 'tg1_ledger',
    name: 'The Second Ledger',
    giver: 'sethri_quiet',
    faction: 'thieves',
    advancement: true,
    stages: [
      {
        n: 10,
        journal:
          'Sethri wants the second Varo ledger — the one that does not go to the Concord. Varo Hleran keeps it in the counting house and keeps himself there too, at every hour I have checked.',
        paths: [
          {
            id: 'night_lift',
            label: 'Lift it after the second bell',
            kind: 'sneak',
            when: [{ k: 'hour', min: 1, max: 5 }],
            skill: 'security',
            difficulty: 45,
            to: 30,
            effects: [{ k: 'item', v: 'hlaalu_ledger', n: 1, stolen: true }],
            onFail: { to: 10, effects: [{ k: 'bounty', v: 500 }, { k: 'disposition', v: -40, npc: 'varo_hleran' }, { k: 'factionRep', faction: 'hlaalu', v: -10 }] },
          },
          {
            id: 'clerk',
            label: 'Persuade the night clerk to look elsewhere',
            kind: 'persuade',
            skill: 'speechcraft',
            difficulty: 50,
            to: 30,
            effects: [{ k: 'item', v: 'hlaalu_ledger', n: 1, stolen: true }, { k: 'flag', v: 'clerk_complicit' }],
            onFail: { to: 10, effects: [{ k: 'disposition', v: -20, npc: 'varo_hleran' }, { k: 'flag', v: 'counting_house_alert' }] },
          },
          {
            id: 'bribe_clerk',
            label: 'Buy the clerk outright',
            kind: 'bribe',
            when: [{ k: 'item', v: 'gold', min: 400 }],
            to: 30,
            effects: [{ k: 'gold', v: -400 }, { k: 'item', v: 'hlaalu_ledger', n: 1, stolen: true }, { k: 'flag', v: 'clerk_complicit' }],
          },
          {
            id: 'inside_job',
            label: 'Walk in as a Varo kinsman and take it off the shelf',
            kind: 'steal',
            when: [{ k: 'rank', faction: 'hlaalu', min: 4 }],
            to: 30,
            effects: [{ k: 'item', v: 'hlaalu_ledger', n: 1, stolen: true }, { k: 'factionRep', faction: 'hlaalu', v: -20 }],
          },
        ],
      },
      {
        n: 30,
        journal: 'I have the second ledger. Every debt in Ald Sethis is written in it, including a few I recognise.',
        paths: [
          {
            id: 'to_sethri',
            label: 'Give it to Sethri',
            kind: 'talk',
            to: 40,
            effects: [{ k: 'item', v: 'hlaalu_ledger', n: -1 }, { k: 'gold', v: 400 }, { k: 'factionRep', faction: 'thieves', v: 10 }],
          },
          {
            id: 'to_legion',
            label: 'Give it to Captain Selvi',
            kind: 'talk',
            to: 41,
            effects: [
              { k: 'item', v: 'hlaalu_ledger', n: -1 },
              { k: 'factionRep', faction: 'legion', v: 15 },
              { k: 'factionRep', faction: 'hlaalu', v: -25 },
              { k: 'factionRep', faction: 'thieves', v: -20 },
              { k: 'expel', faction: 'thieves' },
              { k: 'reputation', v: 5 },
            ],
          },
          {
            id: 'ransom',
            label: 'Sell it back to Varo Hleran',
            kind: 'trade',
            to: 42,
            effects: [
              { k: 'item', v: 'hlaalu_ledger', n: -1 },
              { k: 'gold', v: 1200 },
              { k: 'factionRep', faction: 'thieves', v: -12 },
              { k: 'factionRep', faction: 'hlaalu', v: 6 },
              { k: 'disposition', v: 20, npc: 'varo_hleran' },
            ],
          },
          {
            id: 'burn_widow',
            label: "Tear out the Andalen page and burn it",
            kind: 'steal',
            when: [{ k: 'stage', quest: 'sq_widows_debt', min: 10 }],
            to: 30,
            effects: [{ k: 'flag', v: 'andalen_debt_void' }, { k: 'reputation', v: 3 }, { k: 'disposition', v: 30, npc: 'ferisa_andalen' }],
          },
        ],
      },
      { n: 40, journal: 'Sethri has the ledger and I have four hundred drakes. He says the town will feel it in a month and not know why.', finished: true },
      { n: 41, journal: 'The Legion has the second ledger. Varo will be a year in the courts, the Guild has struck my name, and Sethri will not be in the cellar when I next knock.', finished: true },
      { n: 42, journal: 'Varo Hleran bought his own ledger back for twelve hundred drakes and shook my hand. Sethri has heard. Sethri hears everything.', finished: true },
      {
        n: 91,
        journal:
          'Varo Hleran is dead and the counting house is sealed under Legion writ pending an audit that will take a year. Whatever the second ledger said, it is evidence now, and Sethri will not go near it.',
        failed: true,
      },
    ],
    expiry: [{ when: [{ k: 'flag', v: 'dead:varo_hleran' }], maxStage: 30, to: 91 }],
  },

  tg2_fence_run: {
    id: 'tg2_fence_run',
    name: 'Goods With a History',
    giver: 'orrin_twopurse',
    faction: 'thieves',
    advancement: true,
    stages: [
      {
        n: 10,
        journal:
          'Orrin Two-Purse will take anything off my hands that has a name on it, at half value, provided I bring it to the ash-quay after dark and not to the market row in daylight.',
        paths: [
          {
            id: 'fence',
            label: 'Fence stolen goods on the quay',
            kind: 'trade',
            when: [{ k: 'hour', min: 19, max: 3 }],
            to: 20,
            effects: [{ k: 'factionRep', faction: 'thieves', v: 5 }],
          },
          {
            // Without this the stage had two doors and, for most of the day,
            // one: after dark `fence` is free, but in daylight everything hung
            // on a single Mercantile roll whose failure branch is this same
            // stage. A bad roll at noon left the quest with nothing offered that
            // could move it. Sitting on hot goods until dark is what a thief
            // actually does, and it always works.
            id: 'wait_dark',
            label: 'Sit on the goods until dark, then take them to the quay',
            kind: 'travel',
            when: [{ k: 'not', of: { k: 'hour', min: 19, max: 3 } }],
            to: 20,
            effects: [{ k: 'factionRep', faction: 'thieves', v: 4 }],
          },
          {
            id: 'daylight',
            label: 'Try to sell them in market row',
            kind: 'trade',
            skill: 'mercantile',
            difficulty: 55,
            to: 20,
            effects: [{ k: 'factionRep', faction: 'thieves', v: 2 }],
            onFail: { to: 10, effects: [{ k: 'bounty', v: 250 }, { k: 'factionRep', faction: 'thieves', v: -5 }] },
          },
        ],
      },
      { n: 20, journal: 'Orrin paid and asked nothing. The Guild counts a clean run.', finished: true },
    ],
  },

  /* ---------------------------------------------------------- Great Houses */
  hl1_writ: {
    id: 'hl1_writ',
    name: 'A Writ, Properly Filed',
    giver: 'varo_hleran',
    faction: 'hlaalu',
    advancement: true,
    stages: [
      {
        n: 10,
        journal:
          'Varo Hleran has given me a writ of execution against Ryn Sadras of House Korran, correctly sealed and, he was careful to say, entirely legal. Varo does not murder. Varo files.',
        enter: [{ k: 'item', v: 'writ_of_execution', n: 1 }],
        paths: [
          {
            id: 'serve',
            label: 'Serve the writ',
            kind: 'fight',
            skill: 'shortBlade',
            difficulty: 35,
            to: 30,
            effects: [
              { k: 'item', v: 'writ_of_execution', n: -1 },
              { k: 'factionRep', faction: 'hlaalu', v: 10 },
              { k: 'factionRep', faction: 'redoran', v: -20 },
              { k: 'flag', v: 'ryn_dead' },
              { k: 'fail', quest: 'rd1_duel' },
            ],
            onFail: { to: 10, effects: [{ k: 'attack', npc: 'ryn_sadras' }, { k: 'factionRep', faction: 'redoran', v: -10 }] },
          },
          {
            id: 'warn',
            label: 'Warn Ryn Sadras instead',
            kind: 'talk',
            to: 31,
            effects: [
              { k: 'factionRep', faction: 'hlaalu', v: -15 },
              { k: 'factionRep', faction: 'redoran', v: 12 },
              { k: 'disposition', v: 40, npc: 'ryn_sadras' },
              { k: 'disposition', v: -40, npc: 'varo_hleran' },
            ],
          },
          {
            id: 'buyout',
            label: 'Settle the debt behind the writ with your own coin',
            kind: 'bribe',
            when: [{ k: 'item', v: 'gold', min: 600 }],
            to: 32,
            effects: [
              { k: 'gold', v: -600 },
              { k: 'item', v: 'writ_of_execution', n: -1 },
              { k: 'factionRep', faction: 'hlaalu', v: 4 },
              { k: 'factionRep', faction: 'redoran', v: 4 },
              { k: 'reputation', v: 4 },
            ],
          },
          {
            id: 'forge',
            label: 'Return a forged receipt and keep the writ',
            kind: 'steal',
            skill: 'security',
            difficulty: 50,
            to: 33,
            effects: [{ k: 'factionRep', faction: 'hlaalu', v: 6 }, { k: 'flag', v: 'writ_forged' }],
            onFail: { to: 10, effects: [{ k: 'expel', faction: 'hlaalu' }, { k: 'disposition', v: -50, npc: 'varo_hleran' }] },
          },
        ],
      },
      { n: 30, journal: 'The writ is served. Korran has said nothing at all, which from Korran is the loudest thing available.', finished: true },
      { n: 31, journal: 'Ryn Sadras is gone to Ald Ruhn with a Korran escort. Varo Hleran did not raise his voice, and that was worse.', finished: true },
      { n: 32, journal: 'I paid Ryn Sadras\'s debt out of my own purse. Varo filed the receipt. Both Houses think I am a fool and both of them will take my call.', finished: true },
      { n: 33, journal: 'I filed a forged receipt and kept the writ. It is in my pack. It is still sealed, and it is still legal.', finished: true },
    ],
  },

  rd1_duel: {
    id: 'rd1_duel',
    name: 'On the Sand',
    giver: 'dral_seran',
    faction: 'redoran',
    advancement: true,
    stages: [
      {
        n: 10,
        journal:
          'Ryn Sadras said in the hall that Dral Seran has held the ash-watch too long and holds it badly. Seran will not answer a kinsman himself. He has asked me to answer for him, on the sand, before witnesses.',
        paths: [
          {
            id: 'duel',
            label: 'Fight him on the sand to first blood',
            kind: 'fight',
            skill: 'longBlade',
            difficulty: 40,
            to: 30,
            effects: [{ k: 'factionRep', faction: 'redoran', v: 10 }, { k: 'reputation', v: 4 }],
            onFail: { to: 31, effects: [{ k: 'factionRep', faction: 'redoran', v: -6 }] },
          },
          {
            id: 'taunt',
            label: 'Goad him into striking first in the hall',
            kind: 'persuade',
            skill: 'speechcraft',
            difficulty: 45,
            to: 32,
            effects: [
              { k: 'attack', npc: 'ryn_sadras' },
              { k: 'factionRep', faction: 'redoran', v: -8 },
              { k: 'disposition', v: -20, npc: 'dral_seran' },
            ],
            onFail: { to: 10, effects: [{ k: 'disposition', v: -15, npc: 'ryn_sadras' }] },
          },
          {
            id: 'reconcile',
            label: 'Get Ryn to withdraw the words',
            kind: 'persuade',
            when: [{ k: 'disposition', min: 60 }],
            skill: 'speechcraft',
            difficulty: 55,
            to: 33,
            effects: [{ k: 'factionRep', faction: 'redoran', v: 6 }, { k: 'disposition', v: 25, npc: 'ryn_sadras' }, { k: 'reputation', v: 3 }],
            onFail: { to: 10, effects: [{ k: 'disposition', v: -10, npc: 'ryn_sadras' }] },
          },
        ],
      },
      { n: 30, journal: 'First blood on the sand, and Ryn Sadras took it well, which he was obliged to do and did anyway.', finished: true },
      { n: 31, journal: 'He took first blood off me in four passes. Korran does not despise a loss, but it remembers one.', finished: true },
      { n: 32, journal: 'I said the thing about his mother and he drew in the hall, in front of the ash-watch, which is exactly what I wanted and exactly what Dral Seran did not.', finished: true },
      { n: 33, journal: 'Ryn Sadras withdrew the words before witnesses. Nobody bled and nobody is quite satisfied, which Seran says is what a settled matter feels like.', finished: true },
      {
        n: 92,
        journal:
          'Ryn Sadras is dead, and not on the sand. There is no duel to fight and no honour to settle, and Dral Seran will hear how it was done before the day is out.',
        failed: true,
      },
    ],
    expiry: [
      {
        when: [{ k: 'any', of: [{ k: 'flag', v: 'ryn_dead' }, { k: 'flag', v: 'dead:ryn_sadras' }] }],
        maxStage: 20,
        to: 92,
      },
    ],
  },

  tv1_spore: {
    id: 'tv1_spore',
    name: 'The Third Gallery',
    giver: 'nevena_telvo',
    faction: 'telvanni',
    advancement: true,
    stages: [
      {
        n: 10,
        journal:
          'Nevena Telvo wants a spore cut from the third gallery of Tel Muran. Her own apprentices will not go, and she told me why with some relish: the gallery grew a guardian and the House considers that the gallery\'s business.',
        paths: [
          {
            id: 'kill',
            label: 'Kill the guardian',
            kind: 'fight',
            skill: 'destruction',
            difficulty: 40,
            to: 30,
            effects: [{ k: 'item', v: 'muran_spore', n: 1 }, { k: 'factionRep', faction: 'telvanni', v: 8 }],
            onFail: { to: 10, effects: [{ k: 'factionRep', faction: 'telvanni', v: -3 }] },
          },
          {
            id: 'slip',
            label: 'Cut the spore without waking it',
            kind: 'sneak',
            skill: 'sneak',
            difficulty: 45,
            to: 30,
            effects: [{ k: 'item', v: 'muran_spore', n: 1 }, { k: 'factionRep', faction: 'telvanni', v: 10 }],
            onFail: { to: 10, effects: [{ k: 'factionRep', faction: 'telvanni', v: -3 }] },
          },
          {
            id: 'quiet',
            label: 'Put it to sleep with a decoction',
            kind: 'trade',
            skill: 'alchemy',
            difficulty: 40,
            to: 30,
            effects: [{ k: 'item', v: 'muran_spore', n: 1 }, { k: 'factionRep', faction: 'telvanni', v: 12 }, { k: 'disposition', v: 15, npc: 'nevena_telvo' }],
            onFail: { to: 10, effects: [{ k: 'factionRep', faction: 'telvanni', v: -3 }] },
          },
        ],
      },
      {
        n: 30,
        journal: 'The spore is cut. It is warm and it is still faintly moving, and Nevena wants it in her hand and not on her table.',
        paths: [
          {
            id: 'hand_over',
            label: 'Give the spore to Nevena Telvo',
            kind: 'talk',
            to: 40,
            effects: [{ k: 'item', v: 'muran_spore', n: -1 }, { k: 'gold', v: 350 }, { k: 'factionRep', faction: 'telvanni', v: 8 }],
          },
          {
            id: 'keep_spore',
            label: 'Keep it — she wants the verse traded for it',
            kind: 'trade',
            when: [{ k: 'stage', quest: 'mq2_four_verses', min: 10 }],
            to: 41,
          },
        ],
      },
      { n: 40, journal: 'Nevena paid in coin and in something closer to respect, which from a Mouth of Vaelmyr is an accounting error in my favour.', finished: true },
      { n: 41, journal: 'I am keeping the spore. She wants it badly enough to part with a page of the Ash-Wake for it, and pages do not grow back.', finished: true },
      {
        n: 90,
        journal:
          'Nevena Telvo is dead and Tel Muran has closed itself. The tower does not answer, the stair is not there any more, and the third gallery is the House\'s business again in the way that it was always going to be.',
        failed: true,
      },
    ],
  },

  /* ------------------------------------------------------------ side work */
  sq_widows_debt: {
    id: 'sq_widows_debt',
    name: "The Widow's Debt",
    giver: 'ferisa_andalen',
    faction: null,
    advancement: false,
    stages: [
      {
        n: 10,
        journal:
          'Ferisa Andalen owes House Varo eight hundred drakes on a note her husband signed and could not read. It falls due at the end of the month. She has sixty drakes and an ancestor ring she will not sell.',
        paths: [
          {
            id: 'pay',
            label: 'Pay the eight hundred',
            kind: 'trade',
            when: [{ k: 'item', v: 'gold', min: 800 }],
            to: 40,
            effects: [{ k: 'gold', v: -800 }, { k: 'reputation', v: 6 }, { k: 'disposition', v: 60, npc: 'ferisa_andalen' }],
          },
          {
            id: 'argue',
            label: 'Argue the note down with Varo Hleran',
            kind: 'persuade',
            skill: 'speechcraft',
            difficulty: 60,
            to: 41,
            effects: [{ k: 'reputation', v: 4 }, { k: 'factionRep', faction: 'hlaalu', v: -4 }],
            onFail: { to: 10, effects: [{ k: 'disposition', v: -15, npc: 'varo_hleran' }] },
          },
          {
            id: 'void',
            label: 'Void the debt in the second ledger',
            kind: 'steal',
            when: [{ k: 'flag', v: 'andalen_debt_void' }],
            to: 42,
            effects: [{ k: 'reputation', v: 3 }],
          },
          {
            id: 'house',
            label: 'Have House Varo forgive it as a favour',
            kind: 'talk',
            when: [{ k: 'rank', faction: 'hlaalu', min: 5 }],
            to: 43,
            effects: [{ k: 'factionRep', faction: 'hlaalu', v: -6 }, { k: 'reputation', v: 5 }],
          },
          {
            id: 'take_ring',
            label: 'Take the ancestor ring and settle it yourself',
            kind: 'steal',
            skill: 'security',
            difficulty: 25,
            to: 44,
            effects: [{ k: 'item', v: 'ancestor_ring', n: 1, stolen: true }, { k: 'reputation', v: -6 }, { k: 'disposition', v: -70, npc: 'ferisa_andalen' }],
            onFail: { to: 10, effects: [{ k: 'bounty', v: 200 }, { k: 'disposition', v: -90, npc: 'ferisa_andalen' }] },
          },
        ],
      },
      { n: 40, journal: 'I paid the Andalen note in full. Ferisa keeps her door and the whole of market row watched me do it.', finished: true },
      { n: 41, journal: 'Varo Hleran restruck the note at a rate a widow can carry. He did it because I gave him a reason that cost him nothing, which he pointed out.', finished: true },
      { n: 42, journal: 'The Andalen page is ash. There is no debt because there is no record of a debt, and the counting house will spend a season not understanding that.', finished: true },
      { n: 43, journal: 'House Varo has forgiven the Andalen note as a courtesy to a kinsman. It cost the House eight hundred drakes and cost me some standing in it.', finished: true },
      { n: 44, journal: 'I took the ring off her mantel and settled the note with it. The debt is closed. She knows. She has not said a word to me since and she will not.', finished: true },
      {
        n: 90,
        journal:
          'The month turned. The counting house took the Andalen house on the first morning, in daylight, with a clerk and two of the ash-watch. She went to her sister in Suran on the noon strider. There is nothing left to do about it.',
        failed: true,
      },
    ],
    expiry: [{ afterDays: 12, to: 90 }],
  },

  sq_bad_poetry: {
    id: 'sq_bad_poetry',
    name: 'A Rhyme for Skerrin',
    giver: 'llevo_versifier',
    faction: null,
    advancement: false,
    stages: [
      {
        n: 10,
        journal:
          'Llevo the Versifier is stuck on the twelfth canto of his epic. He requires a rhyme for "skerrin". Dinara Loras has offered me free lodging for a week if I can get him to stop.',
        paths: [
          {
            id: 'rhyme',
            label: 'Give him a rhyme',
            kind: 'persuade',
            skill: 'speechcraft',
            difficulty: 25,
            to: 30,
            effects: [{ k: 'disposition', v: 30, npc: 'llevo_versifier' }, { k: 'disposition', v: -15, npc: 'dinara_loras' }, { k: 'train', v: 'speechcraft', amount: 2 }],
            onFail: { to: 10 },
          },
          {
            id: 'book',
            label: 'Give him a real book of verse',
            kind: 'trade',
            when: [{ k: 'knows', v: 'books' }],
            to: 31,
            effects: [{ k: 'disposition', v: 20, npc: 'llevo_versifier' }, { k: 'disposition', v: 25, npc: 'dinara_loras' }],
          },
          {
            id: 'heckle',
            label: 'Tell him the truth about the eleven cantos',
            kind: 'persuade',
            skill: 'speechcraft',
            difficulty: 40,
            to: 32,
            effects: [{ k: 'flag', v: 'llevo_silenced' }, { k: 'disposition', v: -60, npc: 'llevo_versifier' }, { k: 'disposition', v: 40, npc: 'dinara_loras' }],
            onFail: { to: 10, effects: [{ k: 'disposition', v: -20, npc: 'llevo_versifier' }, { k: 'reputation', v: -2 }] },
          },
        ],
      },
      { n: 30, journal: 'I gave him "wretch". He has written forty more lines and Dinara has stopped speaking to me.', finished: true },
      { n: 31, journal: 'He read four pages of somebody competent, went very quiet, and has not recited since. Dinara says it is the kindest thing anyone has done in that room.', finished: true },
      { n: 32, journal: 'I told Llevo the Versifier what the Flagon actually thinks of the eleven cantos. He has burned the twelfth. The common room is quiet and I do not feel as good about it as I expected.', finished: true },
    ],
  },

  sq_ashfall_caravan: {
    id: 'sq_ashfall_caravan',
    name: 'The Caravan in the Storm',
    giver: 'bemis_alen',
    faction: null,
    advancement: false,
    stages: [
      {
        n: 10,
        journal:
          'A caravan is out on the Ashfall road and the storm has closed the crossing. Bemis Alen will not fly the strider in this and says so without shame. If anyone is going out to them it is on foot, now, in the storm.',
        paths: [
          {
            id: 'go',
            label: 'Walk out into the storm',
            kind: 'travel',
            when: [{ k: 'any', of: [{ k: 'weather', v: 'ashstorm' }, { k: 'weather', v: 'blight' }] }],
            skill: 'athletics',
            difficulty: 30,
            to: 20,
            effects: [{ k: 'item', v: 'ashfall_manifest', n: 1 }],
            onFail: { to: 10, effects: [{ k: 'reputation', v: -1 }] },
          },
          {
            id: 'wait',
            label: 'Wait for the storm to break and go then',
            kind: 'travel',
            when: [{ k: 'not', of: { k: 'weather', v: 'ashstorm' } }],
            to: 21,
          },
        ],
      },
      {
        n: 20,
        journal: 'I found them in the lee of a basalt shelf, four of them alive, and walked them back down the road on a rope.',
        finished: true,
      },
      {
        n: 21,
        journal:
          'The storm broke in the night and I went up at first light. There was ash over the crates to the depth of a hand. I brought down the manifest and nothing else worth bringing down.',
        finished: true,
      },
      {
        n: 90,
        journal:
          'Three days of storm and nobody went up the Ashfall road. The strider found them on the next run. Bemis Alen read the manifest out in the Flagon and nobody looked at anybody.',
        failed: true,
      },
    ],
    expiry: [{ afterDays: 3, maxStage: 15, to: 90 }],
  },

  sq_pilgrim_seven: {
    id: 'sq_pilgrim_seven',
    name: 'The Offering of the Seven',
    giver: 'curate_arvel',
    faction: 'temple',
    advancement: true,
    stages: [
      {
        n: 10,
        journal:
          'Curate Arvel has given me a sealed offering to carry to the shrine-stone above Kaldera on foot, unarmed and unaccompanied, in the manner of the Seven Pilgrims. He says the walk is the offering and the offering is incidental, and then he sealed the offering very carefully.',
        enter: [{ k: 'item', v: 'shrine_offering', n: 1 }],
        paths: [
          {
            id: 'walk',
            label: 'Walk it, as instructed',
            kind: 'travel',
            to: 30,
            effects: [{ k: 'item', v: 'shrine_offering', n: -1 }, { k: 'factionRep', faction: 'temple', v: 8 }, { k: 'train', v: 'restoration', amount: 3 }],
          },
          {
            id: 'ride',
            label: 'Take the strider most of the way',
            kind: 'travel',
            when: [{ k: 'item', v: 'gold', min: 40 }],
            to: 31,
            effects: [{ k: 'gold', v: -40 }, { k: 'item', v: 'shrine_offering', n: -1 }, { k: 'factionRep', faction: 'temple', v: 2 }],
          },
          {
            id: 'open',
            label: 'Open the offering first',
            kind: 'steal',
            skill: 'security',
            difficulty: 20,
            to: 32,
            effects: [{ k: 'flag', v: 'offering_opened' }, { k: 'topic', v: 'dissident_saints' }, { k: 'factionRep', faction: 'temple', v: -10 }],
            onFail: { to: 32, effects: [{ k: 'flag', v: 'offering_opened' }, { k: 'factionRep', faction: 'temple', v: -18 }] },
          },
        ],
      },
      { n: 30, journal: 'I walked it. Four hours up and three down, and I have no explanation for why I feel steadier than I did.', finished: true },
      { n: 31, journal: 'I rode most of it. The stone received the offering all the same. Arvel asked how the walk was and I said it was long, which was not a lie.', finished: true },
      {
        n: 32,
        journal:
          'The sealed offering of the Seven contains a list of names, four of them struck through, and a note in the Curate\'s hand asking the shrine-keeper to watch the fifth. Madrel Vandas is the fifth. I resealed it badly.',
        finished: true,
      },
    ],
  },
} as const satisfies Record<QuestId, QuestDef>;

export const QUEST_LIST: readonly QuestDef[] = Object.values(QUESTS);
