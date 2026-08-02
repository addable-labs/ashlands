/**
 * Prose the game has no home for.
 *
 * This file is what is left of a much larger one. It used to hold a sample
 * world — items, spells, skills, effects, a starting kit — and the screens read
 * it instead of the game, which is how the inventory came to list an
 * Apprentice's Lockpick and a Netch Leather Cuirass while the character was
 * carrying an iron longsword and iron plate. Every one of those tables is gone.
 *
 * What remains is only description, keyed by the RPG layer's own ids: the RPG
 * system publishes a race and a birthsign as an id and a set of numbers, and
 * nothing to read. Nothing here supplies a value, a name the game already has,
 * or an entry the game could disagree with — an id with no row simply has no
 * blurb, and the screen shows the id's own name instead.
 */

export interface Blurb {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
}

/** Keyed by src/rpg/Races.ts RACE_DEFS. */
export const RACE_BLURBS: readonly Blurb[] = [
  { id: 'dunmer', name: 'Dark Elf', desc: 'Ash-born, distrusted everywhere and at home only here. The blood remembers Red Mountain.' },
  { id: 'altmer', name: 'High Elf', desc: 'Golden, tall, and quite certain of it. Magicka comes easily; so does everything else being fatal.' },
  { id: 'bosmer', name: 'Wood Elf', desc: 'Valenwood-born. Small, fast, and better with a bow than you will ever be.' },
  { id: 'breton', name: 'Breton', desc: 'Half a drop of elven blood and an enormous amount of nerve.' },
  { id: 'imperial', name: 'Imperial', desc: 'The Empire got here by talking first. It is still the fastest weapon they carry.' },
  { id: 'nord', name: 'Nord', desc: 'Skyrim sends its sons south with an axe and no coat. They do not need one.' },
  { id: 'redguard', name: 'Redguard', desc: 'The finest natural warriors in Tamriel, and entirely aware of it.' },
  { id: 'orc', name: 'Orc', desc: 'Orsimer. Smiths and shock troops, and no patience for either reputation.' },
  { id: 'khajiit', name: 'Khajiit', desc: 'Elsweyr-born, and every guard on the island has already decided what you are.' },
  { id: 'argonian', name: 'Argonian', desc: 'Saxhleel. The marsh made you, and the sea holds no terror at all.' },
];

/** Keyed by src/rpg/Races.ts BIRTHSIGNS. */
export const BIRTHSIGN_BLURBS: readonly Blurb[] = [
  { id: 'warrior', name: 'The Warrior', desc: 'The Warrior is the first Guardian Constellation, and protects his charges during their hour of need.' },
  { id: 'mage', name: 'The Mage', desc: 'The Mage is a Guardian Constellation whose charges are the students of magicka.' },
  { id: 'thief', name: 'The Thief', desc: 'The Thief is the last Guardian Constellation, and her charges are the least likely to die a violent death.' },
  { id: 'serpent', name: 'The Serpent', desc: 'The Serpent wanders the heavens and has no season. Those born under it are the most blessed and the most cursed.' },
  { id: 'lady', name: 'The Lady', desc: 'The Lady is one of the Warrior\'s Charges, and represents mercy and grace.' },
  { id: 'steed', name: 'The Steed', desc: 'The Steed is one of the Warrior\'s Charges, and represents impatience and drive.' },
  { id: 'lord', name: 'The Lord', desc: 'The Lord\'s Season is Second Seed, when the Trueflame of Alessia was lit.' },
  { id: 'apprentice', name: 'The Apprentice', desc: 'The Apprentice\'s Season is Sun\'s Height. Those born have greater magical ability but are more vulnerable to magic.' },
  { id: 'atronach', name: 'The Atronach', desc: 'A natural sorcerer with inborn abilities — but magicka that does not return on its own. You must take it from others.' },
  { id: 'ritual', name: 'The Ritual', desc: 'The Ritual\'s Season is Morning Star. Its charges have the ability to turn undead and heal wounds.' },
  { id: 'lover', name: 'The Lover', desc: 'The Lover\'s Season is Sun\'s Dusk. Her charges are graceful and passionate.' },
  { id: 'shadow', name: 'The Shadow', desc: 'The Shadow\'s Season is Frostfall. She grants her charges the ability to hide in shadows.' },
  { id: 'tower', name: 'The Tower', desc: 'The Tower\'s Season is Rain\'s Hand. Its charges have a knack for finding gold and a talent with locks.' },
];
