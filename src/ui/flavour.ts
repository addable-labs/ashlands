/**
 * Prose the game has no home for.
 *
 * This file is what is left of a much larger one. It used to hold a sample
 * world — items, spells, skills, effects, a starting kit — and the screens read
 * it instead of the game, which is how the inventory came to list an
 * Apprentice's Lockpick and a Skerrin Leather Cuirass while the character was
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
  { id: 'dunmer', name: 'Dark Elf', desc: 'Ash-born, distrusted everywhere and at home only here. The blood remembers Ember Mount.' },
  { id: 'altmer', name: 'High Elf', desc: 'Golden, tall, and quite certain of it. Magicka comes easily; so does everything else being fatal.' },
  { id: 'bosmer', name: 'Wood Elf', desc: 'Sylvath Wood-born. Small, fast, and better with a bow than you will ever be.' },
  { id: 'breton', name: 'Halvorn', desc: 'Half a drop of elven blood and an enormous amount of nerve.' },
  { id: 'imperial', name: 'Valmori', desc: 'The Concord got here by talking first. It is still the fastest weapon they carry.' },
  { id: 'nord', name: 'Skarn', desc: 'Skarnhold sends its sons south with an axe and no coat. They do not need one.' },
  { id: 'redguard', name: 'Sahiri', desc: 'The finest natural warriors in Ammaris, and entirely aware of it.' },
  { id: 'orc', name: 'Grosh', desc: 'Orsimer. Smiths and shock troops, and no patience for either reputation.' },
  { id: 'khajiit', name: 'Rrasa', desc: 'Rrasa Reach-born, and every guard on the island has already decided what you are.' },
  { id: 'argonian', name: 'Vethuk', desc: 'Saxhleel. The marsh made you, and the sea holds no terror at all.' },
];

/** Keyed by src/rpg/Races.ts BIRTHSIGNS. */
export const BIRTHSIGN_BLURBS: readonly Blurb[] = [
  { id: 'warrior', name: 'The Spear', desc: 'The Spear is the first Guardian Constellation, and protects his charges during their hour of need.' },
  { id: 'mage', name: 'The Ember', desc: 'The Ember is a Guardian Constellation whose charges are the students of magicka.' },
  { id: 'thief', name: 'The Ashfall', desc: 'The Ashfall is the last Guardian Constellation, and her charges are the least likely to die a violent death.' },
  { id: 'serpent', name: 'The Coil', desc: 'The Coil wanders the heavens and has no season. Those born under it are the most blessed and the most cursed.' },
  { id: 'lady', name: 'The Hearth', desc: 'The Hearth is one of the Warrior\'s Charges, and represents mercy and grace.' },
  { id: 'steed', name: 'The Courser', desc: 'The Courser is one of the Warrior\'s Charges, and represents impatience and drive.' },
  { id: 'lord', name: 'The Anvil', desc: 'The Anvil\'s Season is Second Seed, when the Trueflame of Alessia was lit.' },
  { id: 'apprentice', name: 'The Kindling', desc: 'The Kindling\'s Season is Sun\'s Height. Those born have greater magical ability but are more vulnerable to magic.' },
  { id: 'atronach', name: 'The Hollow', desc: 'A natural sorcerer with inborn abilities — but magicka that does not return on its own. You must take it from others.' },
  { id: 'ritual', name: 'The Chant', desc: 'The Chant\'s Season is Morning Star. Its charges have the ability to turn undead and heal wounds.' },
  { id: 'lover', name: 'The Tether', desc: 'The Tether\'s Season is Sun\'s Dusk. Her charges are graceful and passionate.' },
  { id: 'shadow', name: 'The Veil', desc: 'The Veil\'s Season is Frostfall. She grants her charges the ability to hide in shadows.' },
  { id: 'tower', name: 'The Spire', desc: 'The Spire\'s Season is Rain\'s Hand. Its charges have a knack for finding gold and a talent with locks.' },
];
