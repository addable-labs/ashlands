import type { GreetingDef, ResponseDef, TopicDef, TopicId } from './types';

/**
 * Topic-based dialogue, the Morrowind way.
 *
 * NPCs do not offer the player lines to say. They offer TOPICS, and a topic
 * learned from anyone can be put to everyone. That single rule is why the world
 * reads as an encyclopedia you may interrogate rather than a tree you may
 * traverse: the interesting move is not "which reply do I pick" but "who else
 * can I ask about this, and will they contradict the last one".
 *
 * Contradiction is deliberate. The Temple, the Shirenamat and the Dissidents
 * each tell a whole and self-consistent story about the Ash-Wake, and at most
 * one of them can be right. No narrator ever adjudicates.
 */

export const TOPICS: Record<TopicId, TopicDef> = {
  ald_sethis: { id: 'ald_sethis', label: 'Ald Sethis', innate: true },
  little_advice: { id: 'little_advice', label: 'a little advice', innate: true },
  my_trade: { id: 'my_trade', label: 'your trade', innate: true },
  background: { id: 'background', label: 'your background', innate: true },
  latest_rumours: { id: 'latest_rumours', label: 'latest rumours', innate: true },
  services: { id: 'services', label: 'services', innate: true },
  guards: { id: 'guards', label: 'the guards', innate: true },
  great_houses: { id: 'great_houses', label: 'the Great Houses', innate: true },
  the_ash_wake: { id: 'the_ash_wake', label: 'the Ash-Wake' },
  hollow_star: { id: 'hollow_star', label: 'the Hollow Star' },
  four_verses: { id: 'four_verses', label: 'the Four Verses' },
  the_ashen_gate: { id: 'the_ashen_gate', label: 'the Gate of Ash' },
  dissident_saints: { id: 'dissident_saints', label: 'the Dissident Saints' },
  tribunal_temple: { id: 'tribunal_temple', label: 'the Temple of the Trine' },
  ashlanders: { id: 'ashlanders', label: 'Shirenamat' },
  house_hlaalu: { id: 'house_hlaalu', label: 'House Varo' },
  house_redoran: { id: 'house_redoran', label: 'House Korran' },
  house_telvanni: { id: 'house_telvanni', label: 'House Vaelmyr' },
  fighters_guild: { id: 'fighters_guild', label: 'Ironring' },
  mages_guild: { id: 'mages_guild', label: 'Ashen Conclave' },
  thieves_guild: { id: 'thieves_guild', label: 'the Quiet Hand' },
  advancement: { id: 'advancement', label: 'advancement' },
  blight: { id: 'blight', label: 'the blight' },
  ash_storms: { id: 'ash_storms', label: 'ash storms' },
  smugglers: { id: 'smugglers', label: 'smugglers' },
  kaldera_mine: { id: 'kaldera_mine', label: 'Kaldera mine' },
  the_widow: { id: 'the_widow', label: "the widow's debt" },
  bad_poetry: { id: 'bad_poetry', label: 'bad poetry' },
  hlaalu_ledger: { id: 'hlaalu_ledger', label: 'the Varo ledger' },
  stolen_goods: { id: 'stolen_goods', label: 'stolen goods' },
  my_bounty: { id: 'my_bounty', label: 'my bounty' },
  fenwalker: { id: 'fenwalker', label: 'fenwalker' },
  missing_apprentice: { id: 'missing_apprentice', label: 'the missing apprentice' },
  duel_of_honour: { id: 'duel_of_honour', label: 'a duel of honour' },
  red_mountain: { id: 'red_mountain', label: 'Ember Mount' },
  books: { id: 'books', label: 'books' },
};

export const INNATE_TOPICS: readonly TopicId[] = Object.values(TOPICS)
  .filter((t) => t.innate === true)
  .map((t) => t.id);

/**
 * Responses are ordered at load time by filter count, most specific first, so
 * these may be authored in whatever order reads best.
 */
export const RESPONSES: readonly ResponseDef[] = [
  /* ------------------------------------------------------------ Ald Sethis */
  {
    topic: 'ald_sethis',
    when: [{ k: 'race', v: 'dunmer' }, { k: 'speakerFaction', v: 'hlaalu' }],
    text: 'A port. Ash on one side, water on the other, and a customs house in between taking its cut of both. Varo built the docks when the Concord said there would be no docks. Draw your own conclusion about who runs Ald Sethis.',
    effects: [{ k: 'topic', v: 'house_hlaalu' }],
  },
  {
    topic: 'ald_sethis',
    when: [{ k: 'speakerFaction', v: 'redoran' }],
    text: 'A town of scales and short memories. Korran keeps the ash-watch here because somebody must, and Varo bills us for the lamp oil.',
    effects: [{ k: 'topic', v: 'house_redoran' }],
  },
  {
    topic: 'ald_sethis',
    when: [{ k: 'speakerFaction', v: 'ashlanders' }],
    text: 'You call that stone heap a place. We buried three generations under it before the first Varo counted a coin there. The ash will have it back.',
  },
  {
    topic: 'ald_sethis',
    when: [{ k: 'hour', min: 21, max: 5 }],
    text: 'At this hour? Bar the shutters and stay out of the low streets. The lamps only reach so far, and the ash-watch only walks where the lamps reach.',
  },
  {
    topic: 'ald_sethis',
    when: [],
    text: 'Ald Sethis. Egg mines up the road, fenwalker port on the flat, a shrine, a guildhall or two, and more ash than anyone wants. It is not much, but you can eat here.',
  },

  /* ---------------------------------------------------------- small talk */
  {
    topic: 'little_advice',
    when: [{ k: 'bounty', min: 1 }],
    text: 'Here is my advice: the Legion has your name. Pay Captain Marion before she finds you, or do not be found. Those are all the options there are.',
    effects: [{ k: 'topic', v: 'my_bounty' }],
  },
  {
    topic: 'little_advice',
    when: [{ k: 'disposition', max: 25 }],
    text: 'My advice is that you go and stand somewhere else.',
  },
  {
    topic: 'little_advice',
    when: [{ k: 'weather', v: 'ashstorm' }],
    text: 'In a storm like this, stay off the flats. The ash gets into the eyes and then into the lungs, and the drell will walk you off a ledge trying to find shelter.',
    effects: [{ k: 'topic', v: 'ash_storms' }],
  },
  {
    topic: 'little_advice',
    when: [{ k: 'race', v: 'dunmer' }, { k: 'not', of: { k: 'faction', v: 'hlaalu' } }],
    text: 'Do not take a Varo contract you have not read twice. And do not read it in front of the Varo.',
  },
  {
    topic: 'little_advice',
    when: [],
    text: 'Talk to people. Everything worth knowing in this province is in somebody, and none of them will write it down for you.',
  },
  {
    // This is how the main quest begins: heard over a counter, from a woman with
    // no stake in it. The filter is "not yet past the handover" rather than
    // "already begun", because the version that required the quest to be live
    // could only ever be reached by something else having started it first.
    topic: 'latest_rumours',
    when: [{ k: 'npc', v: 'dinara_loras' }, { k: 'not', of: { k: 'stage', quest: 'mq1_ash_wake', min: 20 } }],
    text: 'A courier came off the Ashfall road bleeding and would not say from what. Ask on the road if you want; she has not moved from where she fell.',
    effects: [
      { k: 'stage', quest: 'mq1_ash_wake', v: 10 },
      { k: 'topic', v: 'the_ash_wake' },
    ],
  },
  {
    topic: 'latest_rumours',
    when: [{ k: 'npc', v: 'dinara_loras' }],
    text: 'The egg mine is short two workers and the Ashen Conclave is short one apprentice, and nobody has drawn the obvious line between those two facts. Also Llevo has written another poem. I am told it rhymes in places.',
    effects: [
      { k: 'topic', v: 'missing_apprentice' },
      { k: 'topic', v: 'bad_poetry' },
      { k: 'topic', v: 'kaldera_mine' },
    ],
  },
  {
    topic: 'latest_rumours',
    when: [{ k: 'bounty', min: 200 }],
    text: 'The rumour is you. Two hundred drakes and climbing, and the ash-watch has your description down to the boots.',
  },
  {
    topic: 'latest_rumours',
    when: [{ k: 'speakerFaction', v: 'temple' }],
    text: 'Rumours are a kind of prayer for people who cannot be bothered to kneel. But — since you ask — they say a heretic has been seen at the shrine after the doors are barred.',
    effects: [{ k: 'topic', v: 'dissident_saints' }],
  },
  {
    topic: 'latest_rumours',
    when: [],
    text: 'Ash on the wind out of the mountain, and everyone pretending it means nothing. It has meant nothing for two hundred years. It will go on meaning nothing right up until it does not.',
    effects: [{ k: 'topic', v: 'red_mountain' }],
  },
  {
    topic: 'background',
    when: [{ k: 'npc', v: 'sethri_quiet' }, { k: 'faction', v: 'thieves' }],
    text: 'Rrasa was born on a boat and has been leaving places ever since. Do not ask which places. You are one of us now; that is enough family.',
  },
  {
    topic: 'background',
    when: [{ k: 'npc', v: 'zabamat' }],
    text: 'I was a girl in a tent that is ash now, and I am an old woman in a tent that will be ash. Between the two I learned the verses. That is a whole life and it is enough.',
  },
  {
    topic: 'background',
    when: [{ k: 'race', v: 'nord' }],
    text: 'Skarnhold, then a boat, then a bad winter, then here. Same story as every Skarn south of the pass, and we all tell it like it is ours alone.',
  },
  {
    topic: 'background',
    when: [],
    text: 'Born here, will die here, and the interesting part is the middle, which is nobody’s business.',
  },
  {
    topic: 'my_trade',
    when: [{ k: 'npc', v: 'bemis_alen' }],
    text: 'I keep the strider. Twenty years on the same beast. She knows the Ashfall road better than the road knows itself, and she is worth more than the town.',
    effects: [{ k: 'topic', v: 'fenwalker' }],
  },
  {
    topic: 'my_trade',
    when: [{ k: 'npc', v: 'orrin_twopurse' }, { k: 'faction', v: 'thieves' }],
    text: 'Two purses. One for the goods with a history, one for the goods without. Bring me the first kind and we will both be pleased.',
    effects: [{ k: 'topic', v: 'stolen_goods' }],
  },
  {
    topic: 'my_trade',
    when: [{ k: 'npc', v: 'orrin_twopurse' }],
    text: 'Honest trade in a market row. Nothing else. You have a suspicious face for someone asking.',
  },
  {
    topic: 'my_trade',
    when: [{ k: 'speakerFaction', v: 'mages' }],
    text: 'Enchantment, mostly, and the paperwork of enchantment, which is nine tenths of it. The Guild is a licence and a ledger with a wizard tied to the front.',
  },
  {
    topic: 'my_trade',
    when: [],
    text: 'I work. It is not a story.',
  },
  {
    topic: 'services',
    when: [{ k: 'npc', v: 'sethri_quiet' }, { k: 'faction', v: 'thieves' }],
    text: 'I buy what others would rather not be seen buying, and I will teach you to take it without waking the house.',
  },
  {
    topic: 'services',
    when: [{ k: 'npc', v: 'curate_arvel' }],
    text: 'The shrine heals the sick, blesses the road, and asks a donation it is impolite to name. Kneel and be mended.',
  },
  {
    topic: 'services',
    when: [],
    text: 'What I have is on the counter. What I do not have, someone else in Ald Sethis does.',
  },

  /* ---------------------------------------------------------- main quest */
  {
    // The second way in. Finding the courier without having heard the rumour
    // opens the quest straight at the handover, so this must not require the
    // quest to already be live.
    topic: 'the_ash_wake',
    when: [{ k: 'npc', v: 'seryn_othrelas' }, { k: 'not', of: { k: 'stage', quest: 'mq1_ash_wake', min: 20 } }],
    text: 'Take it. The packet. I was to carry it to the wise woman at Shirenamat and I am not going to Shirenamat. They came out of the ash for it, and they were not bandits — bandits take the purse.',
    effects: [
      { k: 'stage', quest: 'mq1_ash_wake', v: 20 },
      { k: 'item', v: 'sealed_packet', n: 1 },
      { k: 'topic', v: 'ashlanders' },
    ],
  },
  {
    topic: 'the_ash_wake',
    when: [{ k: 'npc', v: 'zabamat' }, { k: 'item', v: 'sealed_packet' }],
    text: 'So it comes to me in an outlander’s hand. Of course it does; the verse says as much and I have hated that line for forty years. The Ash-Wake is not a prophecy of a hero, outlander. It is a prophecy of a *waking*, and something that wakes was asleep, and something that was asleep is still down there.',
    effects: [
      { k: 'stage', quest: 'mq1_ash_wake', v: 40 },
      { k: 'topic', v: 'four_verses' },
      { k: 'topic', v: 'hollow_star' },
    ],
  },
  {
    topic: 'the_ash_wake',
    when: [{ k: 'speakerFaction', v: 'temple' }, { k: 'rank', faction: 'temple', min: 3 }],
    text: 'Among ourselves I will say what I would not say in the nave: the Ash-Wake appears in three of our oldest codices and in none of the printed ones. The excision was a decision. I do not know whose.',
    effects: [{ k: 'topic', v: 'dissident_saints' }],
  },
  {
    topic: 'the_ash_wake',
    when: [{ k: 'speakerFaction', v: 'temple' }],
    text: 'An Shirenamat superstition. The Temple has answered the question of prophecy once and for all, and the answer is that it is finished. Do not carry that word about the shrine.',
    effects: [{ k: 'factionRep', faction: 'temple', v: -1 }],
  },
  {
    topic: 'the_ash_wake',
    when: [{ k: 'npc', v: 'madrel_vandas' }],
    text: 'The Temple will tell you the Ash-Wake was never scripture. I have held the codex it was cut from. The knife-marks are in the gutter of the page. A faith that edits its own book is not lying about the book — it is lying about itself.',
    effects: [
      { k: 'topic', v: 'dissident_saints' },
      { k: 'topic', v: 'four_verses' },
    ],
  },
  {
    topic: 'the_ash_wake',
    when: [{ k: 'speakerFaction', v: 'ashlanders' }],
    text: 'Four verses, four proofs, and a gate under the mountain. The settled folk think a prophecy is a promise. It is a *description*. Nobody promised it would be good.',
  },
  {
    topic: 'the_ash_wake',
    when: [],
    text: 'Shirenamat talk. Ash wakes, sleeper stirs, sky goes the colour of a bruise. They have been saying it since my grandmother and the sky has been that colour the whole time.',
  },
  {
    topic: 'four_verses',
    when: [{ k: 'npc', v: 'zabamat' }, { k: 'stage', quest: 'mq2_four_verses', min: 10 }],
    text: 'Ash, Blood, Name, Deed. The verse of Ash is kept at the shrine and they will not admit it. The verse of Blood is in a Vaelmyr library and Nevena Telvo will want paying. The verse of Name is ours, and you must earn it. The verse of Deed a smuggler sold for forty drakes, which tells you what the world is worth.',
  },
  {
    topic: 'four_verses',
    when: [{ k: 'npc', v: 'nevena_telvo' }, { k: 'stage', quest: 'mq2_four_verses', min: 10 }],
    text: 'The Verse of Blood, yes. I have it. It is a page. Pages have prices. Bring me a spore from the third gallery of my own tower — my apprentices are cowards — and the page is yours. Or offer me two thousand drakes and we need not speak of spores.',
    effects: [{ k: 'topic', v: 'house_telvanni' }],
  },
  {
    topic: 'four_verses',
    when: [{ k: 'speakerFaction', v: 'temple' }],
    text: 'There are no four verses. There is the Sermon of the Three, entire and sufficient. Whoever told you otherwise is selling something, probably a page.',
  },
  {
    topic: 'four_verses',
    when: [],
    text: 'Four scraps of Shirenamat verse. Collectors pay for them, which is the only reason anyone in a town has heard of them.',
  },
  {
    topic: 'hollow_star',
    when: [{ k: 'npc', v: 'zabamat' }],
    text: 'When the second moon is eaten and the sky keeps a hole where it was — that is the Hollow Star. It is not an omen of the Ash-Wake. It is the *clock*. It has been counting for a long time and it does not care whether you are ready.',
  },
  {
    topic: 'hollow_star',
    when: [{ k: 'npc', v: 'sul_kanet' }, { k: 'stage', quest: 'mq3_hollow_star', min: 10 }],
    text: 'The wise woman says you are the one the verse describes. I say the verse describes many, and most of them died proving it. Three trials, outlander. Name, blood, deed. Fail any and you are simply a man who walked into my camp.',
  },
  {
    topic: 'hollow_star',
    when: [{ k: 'speakerFaction', v: 'mages' }],
    text: 'Astronomically? Secunda occults nothing. What the Shirenamat call the Hollow Star is a period of low albedo we can predict to the hour. That it lines up with their verse is the kind of coincidence prophecy is *made* of.',
  },
  {
    topic: 'hollow_star',
    when: [],
    text: 'A dark moon. Farmers keep their drell in. That is the whole of it, as far as I ever heard.',
  },
  {
    topic: 'the_ashen_gate',
    when: [{ k: 'stage', quest: 'mq5_ashen_gate', min: 10 }],
    text: 'The Gate of Ash is not a door. It is the place where the mountain stops pretending. Go in the hour before dawn or do not go.',
  },
  {
    topic: 'the_ashen_gate',
    when: [{ k: 'speakerFaction', v: 'redoran' }],
    text: 'The ash-watch has standing orders about that place: mark it, do not enter it, do not report it to Varo. Nobody has ever explained the third order to me.',
  },
  {
    topic: 'the_ashen_gate',
    when: [],
    text: 'Never heard of it, and I would like to keep it that way.',
  },
  {
    topic: 'red_mountain',
    when: [{ k: 'speakerFaction', v: 'ashlanders' }],
    text: 'It is not a mountain. It is a wound with a mountain growing over it. We camp where the wind carries the ash away, and the wind changes.',
  },
  {
    topic: 'red_mountain',
    when: [],
    text: 'Ember Mount. You can see it from the docks on a clear day, which is not often, and you would rather not, which is always.',
    effects: [{ k: 'topic', v: 'blight' }],
  },

  /* ------------------------------------------------------ faith and history */
  {
    topic: 'tribunal_temple',
    when: [{ k: 'npc', v: 'curate_arvel' }, { k: 'rank', faction: 'temple', min: 2 }],
    text: 'You are far enough inside to hear it plainly: the Three have not answered a prayer in living memory. The Temple continues because a people need continuity more than they need answers. I believe that. Most days I believe that.',
  },
  {
    topic: 'tribunal_temple',
    when: [{ k: 'speakerFaction', v: 'temple' }],
    text: 'The Three are Almalexia the mother, Sotha Sil the mystery, Suneth the poet-king. They walk still, in their fashion, and the shrine is open from the fifth hour.',
  },
  {
    topic: 'tribunal_temple',
    when: [{ k: 'speakerFaction', v: 'ashlanders' }],
    text: 'Three thieves who ate a god and built a church over the plate. Ask them where the fourth was. Ask twice; the first answer is rehearsed.',
    effects: [{ k: 'topic', v: 'dissident_saints' }],
  },
  {
    topic: 'tribunal_temple',
    when: [],
    text: 'The Temple. You pay it, you kneel to it, and when you are sick it does mend you, which is more than the Concord manages.',
  },
  {
    topic: 'dissident_saints',
    when: [{ k: 'npc', v: 'madrel_vandas' }, { k: 'disposition', min: 55 }],
    text: 'We are not heretics. We are the archivists the Temple has stopped funding. Three generations of us have copied what the censors burned. If that is heresy then heresy is just librarianship with consequences.',
    effects: [{ k: 'stage', quest: 'mq4_dissident_saints', v: 20 }],
  },
  {
    topic: 'dissident_saints',
    when: [{ k: 'npc', v: 'curate_arvel' }, { k: 'stage', quest: 'mq4_dissident_saints', min: 20 }],
    text: 'Madrel Vandas. I taught him. He was the best of us and he asked the one question you cannot ask twice. If you bring me his codex I will burn it and weep, and both of those will be sincere.',
  },
  {
    topic: 'dissident_saints',
    when: [{ k: 'speakerFaction', v: 'temple' }],
    text: 'A polite word for people who ought to be in a cell. They preach that the Three are silent because the Three are gone. Say that in the nave and the Wardens will explain the difference between doubt and slander.',
  },
  {
    topic: 'dissident_saints',
    when: [],
    text: 'Priests who lost an argument with other priests. It has been going on longer than the town.',
  },
  {
    topic: 'ashlanders',
    when: [{ k: 'speakerFaction', v: 'ashlanders' }],
    text: 'We are the ones who did not stop. You built walls and called it civilisation and now you cannot move when the ash comes. We can.',
  },
  {
    topic: 'ashlanders',
    when: [{ k: 'speakerFaction', v: 'hlaalu' }],
    text: 'Nomads. They will not trade in coin, will not settle, will not sign. Charming people to write about and impossible people to do business with.',
  },
  {
    topic: 'ashlanders',
    when: [{ k: 'race', v: 'dunmer' }, { k: 'speakerFaction', v: 'temple' }],
    text: 'Our cousins who refused the gift. Pity them, do not romance them. Their wise women keep prophecies the way a miser keeps coin — for the counting, not the spending.',
  },
  {
    topic: 'ashlanders',
    when: [],
    text: 'They come to market twice a year, sell hide and salt, buy nothing, and leave. Nobody in town knows a single one of their names.',
  },

  /* ------------------------------------------------------------- factions */
  {
    topic: 'great_houses',
    when: [{ k: 'faction', v: 'hlaalu' }],
    text: 'You wear Varo colours, so you know the joke already: Korran has honour, Vaelmyr has power, Varo has the harbour. Guess which one the other two need.',
  },
  {
    topic: 'great_houses',
    when: [{ k: 'faction', v: 'redoran' }],
    text: 'Three Houses on Ashenreach and only one of them stands its watch. Do not let a Varo tell you that the docks are the frontier.',
  },
  {
    topic: 'great_houses',
    when: [],
    text: 'Varo trades, Korran fights, Vaelmyr does as it pleases and calls the pleasing a philosophy. You may join one. Only one — swear to a second and the first will hear of it before you finish the sentence.',
    effects: [
      { k: 'topic', v: 'house_hlaalu' },
      { k: 'topic', v: 'house_redoran' },
      { k: 'topic', v: 'house_telvanni' },
    ],
  },
  {
    topic: 'house_hlaalu',
    when: [{ k: 'npc', v: 'varo_hleran' }, { k: 'rank', faction: 'hlaalu', min: 2 }],
    text: 'Now that you are ours, the honest version: we do not bribe the Concord, we *invoice* it. Every writ that leaves this house is legal. Whether it is right is a question for Korran, who can afford it.',
    effects: [{ k: 'topic', v: 'advancement' }],
  },
  {
    topic: 'house_hlaalu',
    when: [{ k: 'faction', v: 'redoran' }],
    text: 'Do not speak that name in this hall. Kinsman of Korran does not drink with the harbour.',
    effects: [{ k: 'disposition', v: -4 }],
  },
  {
    topic: 'house_hlaalu',
    when: [{ k: 'npc', v: 'ferisa_andalen' }],
    text: 'They lent my husband eight hundred drakes at a rate he could not read, and when the mine took him they sent a clerk to the wake. A clerk. With a schedule of payments.',
    effects: [{ k: 'topic', v: 'the_widow' }],
  },
  {
    topic: 'house_hlaalu',
    when: [],
    text: 'The merchant House. Speak to Varo Hleran at the counting house if you want in, and bring a personality worth more than your sword.',
  },
  {
    topic: 'house_redoran',
    when: [{ k: 'npc', v: 'dral_seran' }, { k: 'rank', faction: 'redoran', min: 3 }],
    text: 'You have held the line long enough to be told: half the ash-watch is unpaid. Varo holds the levy and we hold the wall, and we do not speak of it because speaking of it is how a House dies.',
  },
  {
    topic: 'house_redoran',
    when: [{ k: 'faction', v: 'hlaalu' }],
    text: 'Honourable. Poor. Loud about the first because of the second.',
  },
  {
    topic: 'house_redoran',
    when: [],
    text: 'The warrior House. Dral Seran keeps the hall. He will test you before he greets you, so be ready to be tested.',
  },
  {
    topic: 'house_telvanni',
    when: [{ k: 'npc', v: 'nevena_telvo' }],
    text: 'I am a Mouth. The Master has not spoken in eleven years and I speak for him, which is either the highest office in the House or an elaborate way of being alone. Vaelmyr law: what you can hold, you own.',
  },
  {
    topic: 'house_telvanni',
    when: [{ k: 'speakerFaction', v: 'mages' }],
    text: 'Unlicensed, unaccountable and — I will say it quietly — better at this than we are. That is the Guild’s whole grievance and we dress it up as regulation.',
  },
  {
    topic: 'house_telvanni',
    when: [],
    text: 'Wizards in a tower they grew out of a mushroom. They take retainers, and the retainers are not always asked first.',
  },
  {
    topic: 'fighters_guild',
    when: [{ k: 'npc', v: 'hrafna_gulhild' }, { k: 'rank', faction: 'fighters', min: 3 }],
    text: 'Between us: half our contracts come through Varo and half of those are debt collection with the word filed off. I take the honest half. That is a choice I make every morning and you will make it too.',
    effects: [{ k: 'topic', v: 'advancement' }],
  },
  {
    topic: 'fighters_guild',
    when: [{ k: 'faction', v: 'thieves' }],
    text: 'The Guild of hired swords. They have a standing offer on people like you, so do not linger in their hall.',
  },
  {
    topic: 'fighters_guild',
    when: [],
    text: 'Contract work, and it pays on the day. Speak to Hrafna Gulhild in the hall. She will want to see you swing something before she signs anything.',
  },
  {
    topic: 'mages_guild',
    when: [{ k: 'npc', v: 'brenn_alvis' }],
    text: 'The Guild trades in three things: spells, licences, and the pretence that the second is required for the first. We are hiring. We are always hiring; the ash is hard on apprentices.',
    effects: [{ k: 'topic', v: 'advancement' }],
  },
  {
    topic: 'mages_guild',
    when: [{ k: 'faction', v: 'telvanni' }],
    text: 'You are Vaelmyr. The Guild will smile at you and write your name down. Both of those are the same gesture.',
  },
  {
    topic: 'mages_guild',
    when: [],
    text: 'Guild hall by the market. They sell spells, buy reagents, and will teleport you somewhere for a fee that assumes you cannot walk.',
  },
  {
    topic: 'thieves_guild',
    when: [{ k: 'faction', v: 'thieves' }],
    text: 'The cellar under the Flagon, after the second bell. Knock like you are tired, not like you are careful.',
  },
  {
    topic: 'thieves_guild',
    when: [{ k: 'faction', v: 'legion' }],
    text: 'There is no such organisation in Ald Sethis, ser. If there were, the Legion would have arrested it.',
  },
  {
    topic: 'thieves_guild',
    when: [{ k: 'skill', v: 'security', min: 25 }],
    text: 'You have the hands for it, so I will say this once: the Flagon has a cellar and the cellar has a second door. Sethri decides who comes through it.',
    effects: [{ k: 'disposition', v: 2 }],
  },
  {
    topic: 'thieves_guild',
    when: [],
    text: 'Never heard of them.',
  },
  {
    topic: 'advancement',
    when: [{ k: 'expelled', faction: 'fighters' }],
    text: 'You are expelled. There is no advancement for the expelled. Make amends with the Guild master and we will speak again.',
  },
  {
    topic: 'advancement',
    when: [{ k: 'speakerFaction', v: 'fighters' }, { k: 'faction', v: 'fighters' }],
    text: 'Rank comes from three things: the work you have done for us, the strength in your arm and the skill in your hand. Fall short in any one and you stay where you are, however many contracts you close.',
  },
  {
    topic: 'advancement',
    when: [{ k: 'speakerFaction', v: 'mages' }, { k: 'faction', v: 'mages' }],
    text: 'We do not promote for enthusiasm. Intelligence and willpower at the floor for the rank, two schools at the mark, and a record of service. Come back when the numbers agree with your ambition.',
  },
  {
    topic: 'advancement',
    when: [],
    text: 'Join something first. Then ask.',
  },

  /* ------------------------------------------------- trade, crime, the town */
  {
    topic: 'blight',
    when: [{ k: 'npc', v: 'gadan_sarothril' }],
    text: 'Two of my diggers came out of the fourth gallery with the ash-cough and one came out talking to somebody who was not there. I sealed it. The Guild can call that superstition; I call it a sealed gallery.',
    effects: [{ k: 'topic', v: 'kaldera_mine' }],
  },
  {
    topic: 'blight',
    when: [{ k: 'speakerFaction', v: 'temple' }],
    text: 'The blight is a sickness of beasts and a trial of the faithful. It is not, whatever you have been told on the road, a *sign*.',
  },
  {
    topic: 'blight',
    when: [],
    text: 'It comes down off the mountain in the storms. Beasts get it first and go wrong in the head. Then people.',
  },
  {
    topic: 'ash_storms',
    when: [{ k: 'weather', v: 'ashstorm' }],
    text: 'Look at it. This is a small one. In a large one the strider will not fly the road and there is no other road.',
  },
  {
    topic: 'ash_storms',
    when: [],
    text: 'Three or four a season, worse near the mountain. Wear something over your face and keep the wind on your left going out of town.',
  },
  {
    topic: 'smugglers',
    when: [{ k: 'npc', v: 'kell_blackwater' }, { k: 'disposition', min: 55 }],
    text: 'Aye, I move goods. Somebody has to; the customs house takes a fifth and gives back a receipt. If a certain Guild shipment came to me by an unofficial road, it came without a name on it.',
    effects: [{ k: 'stage', quest: 'fg1_shipment', v: 20 }],
  },
  {
    topic: 'smugglers',
    when: [{ k: 'faction', v: 'legion' }],
    text: 'Ask the Captain, not me. I have a family.',
  },
  {
    topic: 'smugglers',
    when: [{ k: 'npc', v: 'captain_selvi' }],
    text: 'Moon sugar off the south coast and Guild goods off the docks. I know who. I cannot prove who. If you should happen to come by a manifest, I would be a friend to you.',
  },
  {
    topic: 'smugglers',
    when: [],
    text: 'They work the coast north of the docks. Everyone knows. Nobody says. That is how a port works.',
  },
  {
    topic: 'kaldera_mine',
    when: [{ k: 'stage', quest: 'mg2_missing_apprentice', min: 10 }],
    text: 'The Guild girl went up there asking about spore samples and Gadan told her the fourth gallery was sealed. She has the Guild’s idea of what a seal means.',
  },
  {
    topic: 'kaldera_mine',
    when: [],
    text: 'Egg mine, half an hour up the ash road. Morvek queen, four galleries, one of them shut. Gadan Sarothril runs it and he runs it hard.',
  },
  {
    topic: 'the_widow',
    when: [{ k: 'npc', v: 'ferisa_andalen' }, { k: 'stage', quest: 'sq_widows_debt', min: 10 }],
    text: 'Eight hundred drakes by the end of the month, or the counting house takes the house. I have sixty. I am telling you because you asked, not because I expect anything.',
  },
  {
    topic: 'the_widow',
    when: [{ k: 'npc', v: 'varo_hleran' }, { k: 'stage', quest: 'sq_widows_debt', min: 10 }],
    text: 'The Andalen debt. It is a legal instrument, it was signed, and sentiment is not a form of payment. Bring the sum or bring me a reason that is worth eight hundred drakes.',
  },
  {
    topic: 'the_widow',
    when: [{ k: 'done', quest: 'sq_widows_debt' }],
    text: 'Ferisa keeps her door. People noticed who paid it. That sort of thing does not stay quiet in a town this size.',
  },
  {
    topic: 'the_widow',
    when: [{ k: 'failed', quest: 'sq_widows_debt' }],
    text: 'The Andalen house is Varo property now. She went to her sister in Suran, they say. Nobody has seen her since the strider left.',
  },
  {
    topic: 'the_widow',
    when: [],
    text: 'Ferisa Andalen. Her husband died in the mine owing money, and the debt did not die with him.',
    effects: [{ k: 'stage', quest: 'sq_widows_debt', v: 10 }],
  },
  {
    topic: 'bad_poetry',
    when: [{ k: 'npc', v: 'llevo_versifier' }],
    text: 'Bad? BAD? The Ashen Flagon has heard eleven of my cantos and applauded nine. I am composing the twelfth. It requires a rhyme for "skerrin" and I will find one if it takes the season.',
    effects: [{ k: 'stage', quest: 'sq_bad_poetry', v: 10 }],
  },
  {
    topic: 'bad_poetry',
    when: [{ k: 'npc', v: 'dinara_loras' }],
    text: 'He drinks free if he stops at three verses. He has never stopped at three verses. I am running a business and a hostage situation at the same time.',
  },
  {
    topic: 'bad_poetry',
    when: [],
    text: 'There is a poet in the Flagon. Sit near the door.',
  },
  {
    topic: 'hlaalu_ledger',
    when: [{ k: 'npc', v: 'sethri_quiet' }, { k: 'faction', v: 'thieves' }],
    text: 'The counting house keeps two ledgers, and only one of them goes to the Concord. Bring me the other and every debt in this town changes hands, quietly, in our favour.',
    effects: [{ k: 'stage', quest: 'tg1_ledger', v: 10 }],
  },
  {
    topic: 'hlaalu_ledger',
    when: [{ k: 'npc', v: 'varo_hleran' }],
    text: 'The house ledger is the property of House Varo and is not a topic of conversation. Who told you that word?',
    effects: [{ k: 'disposition', v: -6 }],
  },
  {
    topic: 'hlaalu_ledger',
    when: [],
    text: 'A book of numbers. I am told there are two of them and that is one more than there should be.',
  },
  {
    topic: 'stolen_goods',
    when: [{ k: 'npc', v: 'orrin_twopurse' }, { k: 'faction', v: 'thieves' }],
    text: 'Anything with a name on it, I will take it off. Half price, no questions, and no receipt for either of us.',
  },
  {
    topic: 'stolen_goods',
    when: [{ k: 'not', of: { k: 'faction', v: 'thieves' } }],
    text: 'I do not touch goods with a history. Neither should you; a merchant knows his own stock and the Legion knows the merchants.',
  },
  {
    topic: 'stolen_goods',
    when: [],
    text: 'There are people who buy such things. I am not one of them, and I would not name one.',
  },
  {
    topic: 'my_bounty',
    when: [{ k: 'npc', v: 'captain_selvi' }, { k: 'bounty', min: 1000 }],
    text: 'A thousand drakes and more. That is not a fine, that is a sentence. Come quietly or do not come at all — I would rather the first and I am ready for the second.',
  },
  {
    topic: 'my_bounty',
    when: [{ k: 'npc', v: 'captain_selvi' }, { k: 'bounty', min: 1 }],
    text: 'You have a price on you. Pay it here and it is closed. Refuse and the ash-watch will have opinions.',
  },
  {
    topic: 'my_bounty',
    when: [{ k: 'bounty', min: 1 }],
    text: 'Yes, everyone has heard. Pay the Legion or leave the district; those are the two doors and they are both narrow.',
  },
  {
    topic: 'my_bounty',
    when: [],
    text: 'You have no bounty. Try to keep it that way; the Legion writes in ink.',
  },
  {
    topic: 'guards',
    when: [{ k: 'faction', v: 'thieves' }],
    text: 'Ash-watch walks the lamp streets from dusk. They see what is lit. Learn the unlit way and you may as well be invisible.',
  },
  {
    topic: 'guards',
    when: [],
    text: 'Legion troopers in the square, Korran ash-watch on the wall. They will demand your fine, take you in, or take you down, in that order and no other.',
  },
  {
    topic: 'fenwalker',
    when: [{ k: 'npc', v: 'bemis_alen' }],
    text: 'She will carry you as far as the Ashfall crossing, weather permitting. In a storm she stands and I stand with her, and no fee will move either of us.',
  },
  {
    topic: 'fenwalker',
    when: [],
    text: 'The great beast at the port. Bemis drives her. Cheaper than a drell and it does not stop to eat.',
  },
  {
    topic: 'missing_apprentice',
    when: [{ k: 'npc', v: 'brenn_alvis' }, { k: 'stage', quest: 'mg2_missing_apprentice', max: 5 }],
    text: 'Falia Beren. Three days overdue from a sampling trip to Kaldera. I have written it up as unauthorised absence because the alternative is a letter to her mother in Daggerfall. Find her.',
    effects: [{ k: 'stage', quest: 'mg2_missing_apprentice', v: 10 }],
  },
  {
    topic: 'missing_apprentice',
    when: [{ k: 'failed', quest: 'mg2_missing_apprentice' }],
    text: 'They brought her down on the fourth day. The Guild paid for the pyre and Brenn Alvis has not been in the hall since.',
  },
  {
    topic: 'missing_apprentice',
    when: [],
    text: 'A Guild apprentice went up the ash road and did not come back down. It happens more than the Guild likes printed.',
  },
  {
    topic: 'duel_of_honour',
    when: [{ k: 'npc', v: 'ryn_sadras' }, { k: 'stage', quest: 'rd1_duel', min: 10 }],
    text: 'You are the one Seran sent. Good. I said what I said about his command and I will say it again on the sand. Bring a weapon or bring an apology; I do not care which.',
  },
  {
    topic: 'duel_of_honour',
    when: [{ k: 'npc', v: 'dral_seran' }],
    text: 'A Korran matter is settled on the sand, before witnesses, to first blood or to the end. Not in an alley. Not with a hireling. If you cannot tell the difference you are not Korran.',
  },
  {
    topic: 'duel_of_honour',
    when: [],
    text: 'Korran business. They still fight them, and the Legion still pretends not to notice.',
  },
  {
    topic: 'books',
    when: [{ k: 'npc', v: 'madrel_vandas' }],
    text: 'I have copies of things the shrine says were never written. Read them and read the Temple’s printing beside them. Then decide which of us is lying, and be honest that you cannot.',
  },
  {
    topic: 'books',
    when: [{ k: 'speakerFaction', v: 'temple' }],
    text: 'The shrine keeps the Sermons, the Homilies and the Lives. Everything else in this province that calls itself scripture is a forgery, some of them very old and very good.',
  },
  {
    topic: 'books',
    when: [],
    text: 'Books. Somebody in every town collects them, and it is never the person you would guess.',
  },
];

/**
 * Greetings fire on approach. The first matching line is what the NPC says, and
 * teaching topics from a greeting is how the world seeds the player's topic
 * list without an exposition dump.
 */
export const GREETINGS: readonly GreetingDef[] = [
  {
    when: [{ k: 'bounty', min: 1000 }, { k: 'npc', v: 'captain_selvi' }],
    text: 'Stop where you are. You are wanted for a thousand drakes and I have run out of patience for outlanders.',
    effects: [{ k: 'topic', v: 'my_bounty' }],
  },
  {
    when: [{ k: 'bounty', min: 200 }, { k: 'speakerFaction', v: 'legion' }],
    text: 'Halt. There is a bounty on your head, criminal scum. Pay the fine or come with me.',
    effects: [{ k: 'topic', v: 'my_bounty' }],
  },
  {
    when: [{ k: 'bounty', min: 40 }],
    text: 'I want no trouble with you. The watch is looking for someone with your face.',
    effects: [{ k: 'topic', v: 'my_bounty' }],
  },
  {
    when: [{ k: 'npc', v: 'seryn_othrelas' }, { k: 'not', of: { k: 'stage', quest: 'mq1_ash_wake', min: 20 } }],
    text: 'You — outlander. Come here. No, do not call for help, there is no help on this road. Take the packet. Take it and go to the ashlanders.',
    effects: [{ k: 'topic', v: 'the_ash_wake' }],
  },
  {
    when: [{ k: 'npc', v: 'zabamat' }, { k: 'item', v: 'sealed_packet' }],
    text: 'I felt you on the road before I saw you. Ash sticks to some people differently. Give me what you carry, outlander.',
    effects: [{ k: 'topic', v: 'the_ash_wake' }],
  },
  {
    when: [{ k: 'speakerFaction', v: 'ashlanders' }, { k: 'not', of: { k: 'faction', v: 'ashlanders' } }, { k: 'disposition', max: 30 }],
    text: 'You walk into a camp that did not invite you. Say your business and be short with it.',
  },
  {
    when: [{ k: 'speakerFaction', v: 'telvanni' }, { k: 'disposition', max: 35 }],
    text: 'You are in my tower. That is either an appointment I have forgotten or a mistake you are about to make.',
  },
  {
    when: [{ k: 'faction', v: 'thieves' }, { k: 'speakerFaction', v: 'thieves' }],
    text: 'Quiet night. Quieter with you in it.',
  },
  {
    when: [{ k: 'faction', v: 'redoran' }, { k: 'speakerFaction', v: 'hlaalu' }],
    text: 'Korran. In a counting house. Well, the door is a door.',
  },
  {
    when: [{ k: 'faction', v: 'hlaalu' }, { k: 'speakerFaction', v: 'redoran' }],
    text: 'Varo colours in the hall of the watch. State your business and keep your hands where the lamp is.',
  },
  {
    when: [{ k: 'disposition', max: 15 }],
    text: 'What do you want.',
  },
  {
    when: [{ k: 'disposition', min: 80 }],
    text: 'Ah — it is good to see you. Sit, sit. Ask me anything you like.',
  },
  {
    when: [{ k: 'disposition', min: 60 }],
    text: 'Well met. What can I do for you?',
  },
  {
    when: [{ k: 'race', v: 'dunmer' }, { k: 'reputation', max: 4 }],
    text: 'Another outlander off the boat. Do not touch anything and we will get along.',
  },
  {
    when: [{ k: 'reputation', min: 30 }],
    text: 'I know your name. Half the coast knows your name. What brings it to my door?',
  },
  {
    when: [{ k: 'hour', min: 22, max: 5 }],
    text: 'It is late. Whatever it is, be quick.',
  },
  {
    when: [{ k: 'weather', v: 'ashstorm' }],
    text: 'Inside, quickly — nobody talks in this. Shut the door behind you.',
  },
  {
    when: [{ k: 'weather', v: 'blight' }],
    text: 'Blight wind. Cover your face and do not breathe deep. What do you need?',
  },
  {
    when: [],
    text: 'Yes?',
  },
];
