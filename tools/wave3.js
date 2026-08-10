export const meta = {
  name: 'ashlands-wave3',
  description: 'Author gameplay systems: RPG stats, combat+physics, quests/dialogue, UI, audio',
  phases: [
    { title: 'Author', detail: 'five gameplay authors, disjoint file ownership' },
    { title: 'Typecheck', detail: 'each author repairs its own type errors' },
  ],
};

const ROOT = '/Users/peter/Development/morrowind';

const COMMON = `
You are authoring ONE subsystem of "Ashlands", a Three.js (r185, WebGL2) action-RPG that is a
follow-up installment to The Elder Scrolls III: Morrowind. TypeScript strict, Vite.

PROJECT ROOT: ${ROOT}

MANDATORY FIRST STEPS:
1. Read ${ROOT}/ART_BIBLE.md.
2. Read ${ROOT}/src/core/types.ts and ${ROOT}/src/core/contracts.ts — the integration boundary.
3. Skim the systems you depend on for their REAL APIs (do not invent method names):
   ${ROOT}/src/player/Player.ts, ${ROOT}/src/actors/Actors.ts, ${ROOT}/src/world/Terrain.ts,
   ${ROOT}/src/vfx/VFX.ts, ${ROOT}/src/sky/Atmosphere.ts.

DO NOT edit src/core/*, src/main.ts, or ANY directory other than the one you own.

DESIGN PHILOSOPHY — this is what makes it feel like an Elder Scrolls game:
- Systemic, not scripted. Rules compose; the player finds combinations the designer did not
  anticipate. Morrowind let you make a 100-point Jump potion and break the map — that is a
  feature, not a bug. Preserve that spirit.
- Skills improve BY USE, not by spending points. Swing a blade, get better at blades.
- No level scaling of the world. A place is as dangerous as it is, regardless of the player.
- The player can attempt anything anywhere from minute one, and can fail.

HARD RULES:
- Strict TypeScript, no \`any\`, no @ts-ignore.
- Data-driven: define content as typed const tables, not hardcoded branches.
- Comments explain WHY. No banner comments, no narration.
- All state must round-trip through a save/load serialisation.

VERIFY: cd ${ROOT} && npx tsc --noEmit 2>&1 | grep -E "^src/<yourdir>/" — fix every error in
YOUR directory only. Report what you wrote and anything the integrator must wire up.
`;

const TASKS = [
  {
    key: 'rpg',
    dir: 'src/rpg',
    label: 'rpg systems',
    prompt: `${COMMON}

YOUR SUBSYSTEM: character progression, inventory, magic. YOU OWN src/rpg/ ONLY.
Write ${ROOT}/src/rpg/RPG.ts exporting \`class RPGSystem\` implementing System (id 'rpg', order 80).

Implement the full Elder Scrolls III character model:
- **8 attributes**: Strength, Intelligence, Willpower, Agility, Speed, Endurance, Personality,
  Luck. Derived: Health (from Endurance+Strength), Magicka (Intelligence x birthsign
  multiplier), Fatigue (Str+Will+Agi+End). Fatigue must affect everything — hit chance,
  spell success, prices, persuasion. Exhausted characters flail.
- **27 skills** across Combat/Magic/Stealth, each governed by an attribute: Block, Armorer,
  Medium Armor, Heavy Armor, Blunt Weapon, Long Blade, Axe, Spear, Athletics, Enchant,
  Destruction, Alteration, Illusion, Conjuration, Mysticism, Restoration, Alchemy, Unarmored,
  Security, Sneak, Acrobatics, Light Armor, Short Blade, Marksman, Mercantile, Speechcraft,
  Hand-to-hand.
- **Skill-by-use progression** with per-skill use-increment values, and the Morrowind
  level-up rule: skill gains accumulate into attribute multipliers, and you choose 3
  attributes to raise on level-up, with a x1..x5 multiplier from how many governed skills
  advanced. This specific mechanic is series-defining — implement it faithfully.
- **10 classes** (or a custom class builder) with major/minor skills, plus **10 races** with
  attribute modifiers, starting skill bonuses and racial powers, plus **birthsigns** (The
  Warrior, The Mage, The Thief, The Lady, The Steed, The Lord, The Apprentice, The Atronach —
  Atronach must have zero magicka regen and spell absorption, that trade-off is the point).
- **Inventory**: weight-based encumbrance that actually slows and eventually immobilises you,
  equipment slots (head/cuirass/greaves/boots/left+right pauldron/gauntlets/shield/weapon/
  ring x2/amulet/clothing layers), item condition/durability, and repair via the Armorer skill.
- **Item generation**: a data table of weapons, armour, clothing, ingredients, potions,
  scrolls, books, with materials (iron/steel/silver/dwarven/ebony/glass/daedric/chitin/bonemold)
  scaling weight, value, durability and damage. Generate enchanted variants procedurally.
- **Spellcasting + spellmaking**: magic effects as composable data (effect id, magnitude range,
  duration, area, target self/touch/ranged). Spell cost derived from magnitude x duration x
  area by the real formula. Cast success = skill, attribute, fatigue and encumbrance. A
  spellmaking interface API that lets the player combine arbitrary effects and pay the cost.
- **Enchanting** (bind effects to items, cast-on-use / constant-effect / on-strike) and
  **Alchemy** (ingredients carry 4 effects; combining two ingredients that share an effect
  produces a potion whose strength depends on Alchemy skill and apparatus quality). Both must
  be genuinely open-ended.
- **Save/load**: full serialisation to a JSON-compatible structure and back.

Export the API other systems need: current stats, damage/heal, skill use notification,
equip/unequip, cast(spellId), and an event on ctx.bus for level-up and skill-up.`,
  },
  {
    key: 'combat',
    dir: 'src/combat',
    label: 'combat+physics',
    prompt: `${COMMON}

YOUR SUBSYSTEM: combat and physics. YOU OWN src/combat/ ONLY.
Write ${ROOT}/src/combat/Combat.ts exporting \`class CombatSystem\` implementing System
(id 'combat', order 110).

Combat must feel WEIGHTY and readable. Morrowind's combat is the most criticised part of the
game — dice-roll misses with no feedback. Keep the RPG substrate (skill matters) but fix the
feel: every swing must connect visually and every outcome must be legible.

- **Melee**: directional attacks driven by movement input (thrust / slash / chop, as in the
  original), hold-to-charge with a visible windup, and release power scaling with charge.
  Real swept-volume hit detection (capsule sweep along the weapon arc across the frame, so
  fast swings cannot tunnel), not a single raycast at the animation midpoint.
- **Hit resolution**: consult the RPG layer for skill/fatigue/condition, but a "miss" must be
  a visible parry, deflection off armour with a spark and a ringing sound, or a dodge — never
  a swing that passes through the target with nothing happening. That single change is the
  difference between the original's reputation and good combat.
- **Blocking and parrying** with a timing window, shield-vs-weapon differences, and stagger
  on a well-timed parry. **Stagger, knockback and hit-stop** (freeze frames on heavy impact).
- **Ranged**: bows and thrown weapons with real projectile physics — gravity, drag, travel
  time, lead-the-target. Arrows stick into surfaces and into actors.
- **Ragdolls**: a real constrained rigid-body ragdoll on death that blends out of the animated
  pose, not an instant swap. Implement a compact impulse-based solver (position-based dynamics
  with distance + cone-twist constraints is sufficient and is the right cost here) — do NOT
  add a physics library dependency; write it.
- **General rigid-body physics**: dropped items, debris, destructible clutter (urns, crates)
  with convex collision against terrain and static geometry. Sleep bodies at rest.
- **Damage model**: per-body-region multipliers, armour rating reducing damage by material and
  condition, weapon material vs armour material interactions (silver/enchanted weapons needed
  to harm certain creatures — a real Elder Scrolls rule), and damage-over-time effects.
- **Enemy AI combat**: approach, circle, feint, block, back off when low, flee, call allies.
  Read actors from ctx.get('actors') and use its damage() API. Different creatures fight
  differently: ash shrikes dive-attack and retreat, glassjaws leap, drell charge.
- Drive ctx.get('vfx') for impact effects and ctx.get('player').shake() for impact feedback.`,
  },
  {
    key: 'quests',
    dir: 'src/quest',
    label: 'quests+dialogue',
    prompt: `${COMMON}

YOUR SUBSYSTEM: dialogue, quests, factions, world simulation. YOU OWN src/quest/ ONLY.
Write ${ROOT}/src/quest/Quests.ts exporting \`class QuestSystem\` implementing System
(id 'quest', order 85).

- **Topic-based dialogue**, the Morrowind way: NPCs expose a list of TOPICS, not a branching
  tree of player lines. Topics are global, and learning a topic from one NPC lets you ask
  every other NPC about it. Responses are selected by a filter chain (race, faction, rank,
  disposition, location, quest state, previous topics) — first match wins. Implement the filter
  engine generically and data-drive the content. This system is why Morrowind's world felt like
  an encyclopedia you could interrogate; reproduce that property.
- **Disposition** per NPC, modified by race, faction, personality, reputation and by
  Persuasion attempts (admire / intimidate / taunt / bribe) that can succeed or backfire.
  Taunting an NPC into attacking you must be possible.
- **Factions**: at least six (a Fighters/Warriors guild, a Mages guild, a Thieves guild, and
  three Great Houses in the Cindren style) with ranks, rank requirements expressed as
  attribute+skill thresholds, advancement quests, and mutual exclusivity between rival houses.
  Faction reputation and expulsion.
- **Quests** as data: stages, objectives, journal entries keyed by stage, multiple solution
  paths (fight / sneak / persuade / bribe / alternate quest-giver), and consequences that
  persist. Author at least 12 real quests including a main-quest spine of 5 stages with a
  prophecy structure, plus side quests that can be failed permanently.
- **Journal**: chronological, append-only, never auto-summarised — the player must re-read and
  work out where to go. No quest markers. Provide the data; UI renders it.
- **Crime and justice**: a bounty system, witnesses (line-of-sight checks against actors),
  guards that respond and demand payment/imprisonment/resisting, and stolen-goods flagging on
  items so fences matter.
- **NPC schedules**: sleep/work/wander by ctx.clock.hour, so the settlement feels alive.
- **Books and lore**: at least 15 in-world books with real text — creation myths, faction
  propaganda, conflicting historical accounts, a bad poem, a cookbook. Contradiction between
  sources is intentional and is the single strongest worldbuilding device in the series.
- **Save/load** of all quest, faction, disposition, crime and journal state.`,
  },
  {
    key: 'ui',
    dir: 'src/ui',
    label: 'ui+hud',
    prompt: `${COMMON}

YOUR SUBSYSTEM: user interface. YOU OWN src/ui/ ONLY.
Write ${ROOT}/src/ui/UI.ts exporting \`class UISystem\` implementing System (id 'ui', order 200).

Build the UI in DOM/CSS overlaid on the canvas (it is far sharper and more maintainable than
canvas-drawn text), styled to look like carved bone, tooled leather and aged parchment. It must
look like an artefact from the world, not a web app. No rounded-rect flat-design panels, no
system font, no pure #fff on #000.

- **HUD**: the three Elder Scrolls bars (Health red, Magicka blue, Fatigue green) as weathered
  vessels that drain, not flat progress bars. Weapon/spell readied indicators, a compass strip
  showing cardinal direction, active-effect icons with remaining duration, a crosshair that
  changes on interactable hover, and a transient message log.
- **Inventory**: a paperdoll with equipment slots you drag onto, weight/encumbrance readout
  that turns red near the limit, sortable item list with real tooltips (weight, value,
  condition bar, enchantment), and item preview rendered as a live 3D thumbnail in a small
  offscreen render target — that detail is worth the effort.
- **Character sheet**: attributes, all 27 skills grouped by specialisation with progress-to-
  next-level, class/race/birthsign, level-up modal with the x1..x5 attribute multiplier choice.
- **Magic menu + spellmaking + enchanting + alchemy** interfaces: effect pickers with live
  cost/success-chance recomputation as the player drags magnitude and duration sliders.
- **Dialogue window**: NPC portrait, disposition bar, scrollable response pane on the left and
  the topic list on the right, with newly-learned topics highlighted. Persuasion sub-panel.
- **Journal and quest log**, book reading view with real page layout and a page-turn.
- **Local and world map**: render the terrain heightfield to a stylised parchment map with hill
  shading, a fog-of-war reveal mask that uncovers as the player explores, and player-placed
  map notes.
- **Menus**: main menu, pause, settings (graphics quality driving
  ctx.get('render').setQuality, audio sliders, sensitivity, FOV), save/load with named slots
  and a thumbnail from the last frame.
- **Character creation** flow: race, class (preset or custom), birthsign, appearance sliders.
- Keyboard/mouse driven with correct pointer-lock release when a menu opens. Everything must be
  reachable by keyboard alone. Respect prefers-reduced-motion for the animated transitions.
- Fonts: use CSS system serif stacks with letter-spacing and small-caps treatment. Do NOT fetch
  a webfont — there is no network.`,
  },
  {
    key: 'audio',
    dir: 'src/audio',
    label: 'audio',
    prompt: `${COMMON}

YOUR SUBSYSTEM: audio. YOU OWN src/audio/ ONLY.
Write ${ROOT}/src/audio/Audio.ts exporting \`class AudioSystem\` implementing System
(id 'audio', order 150).

EVERYTHING must be synthesised with the Web Audio API — oscillators, noise buffers, filters,
convolution with procedurally generated impulse responses. There are NO sample assets and no
network. This is a hard constraint and also an opportunity: procedural audio can be
parameterised by game state in ways samples cannot.

- **Ambience beds** that crossfade with biome, weather and time of day: wind through ash (
  filtered noise with a slowly modulated resonant band), the low seismic rumble of Ember Mount,
  distant surf at the coast, insect and spore-fall chittering near fungal groves at night,
  the rising howl and grit-blast of an ash storm. Read weather from ctx.get('sky').
- **Music**: a generative score, not a loop. Modal (Dorian/Phrygian for the Cindren flavour),
  slow, sparse, built from synthesised strings/lute/low drone/soft percussion. It must respond
  to state — combat raises intensity, discovery swells, night thins the texture — and must
  transition musically on phrase boundaries, never by hard cut or crossfade mid-bar.
- **Footsteps** synthesised per surface, driven by the 'player:surface' bus event: ash is a
  soft granular crunch, stone is a sharp transient with a short tail, water is a splash, mud
  squelches. Vary pitch/level per step; identical repeated steps are instantly noticeable.
- **Combat**: weapon whoosh (filtered noise swept by swing speed), impact by material pair
  (blade-on-chitin vs blade-on-stone vs blade-on-flesh), bowstring, arrow flight and thunk.
- **Magic**: per-school timbres — destruction fire is a roaring saturated noise burst, frost a
  crystalline ringing cluster, shock a bright transient with a decaying buzz; restoration a
  warm consonant swell; illusion a detuned shimmer.
- **Creatures**: ash shrike screech (the sound most hated in gaming history — reproduce it
  faithfully, it is iconic), skerrin groan, drell chirp, morvek clicking.
- **3D spatialisation** via PannerNode with distance attenuation and a proper cone for directional
  sources; a listener locked to the camera.
- **Reverb**: generate impulse responses procedurally for outdoor / cave / interior / underwater
  and crossfade the convolution wet mix as the player moves between spaces. Underwater also
  gets a heavy lowpass — hook the event the water system emits.
- **Mixing**: master/music/sfx/ambience buses with a limiter on the master so nothing clips,
  and ducking of ambience under combat and dialogue.
- Must handle the browser autoplay policy: build the graph lazily on first user gesture and
  never throw if the context is suspended.`,
  },
];

phase('Author');

const results = await pipeline(
  TASKS,
  (t) => agent(t.prompt, { label: t.label, phase: 'Author', effort: 'high' }),
  (report, t) =>
    agent(
      `You authored the "${t.key}" subsystem of Ashlands at ${ROOT}. Your report:
---
${report}
---
VERIFY: cd ${ROOT} && npx tsc --noEmit 2>&1 | grep -E "^${t.dir}/"
Fix every error in YOUR directory (${t.dir}) only. Repeat until clean.
Then re-read your main file and fix anything obviously broken: dead code paths, state that
never serialises, event subscriptions never cleaned up, per-frame allocations in update().
Return "CLEAN" plus one line, or describe what you could not fix and why.`,
      { label: `verify:${t.key}`, phase: 'Typecheck' },
    ),
);

return { authored: TASKS.map((t) => t.key), verify: results };
