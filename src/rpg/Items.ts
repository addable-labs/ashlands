/**
 * Item data. Everything the player can carry is a typed record in a table plus
 * a material multiplier, so a new material or a new weapon shape is one row,
 * not a new branch. Enchanted variants are generated from the same tables at
 * runtime and registered so they serialise like any other item.
 */
import type { SkillId } from './Attributes';
import type { EffectId, EffectInstance } from './Effects';
import { EFFECTS, enchantmentCost, spellCost } from './Effects';
import { Rng } from './Rng';

export const SLOTS = [
  'head',
  'cuirass',
  'greaves',
  'boots',
  'leftPauldron',
  'rightPauldron',
  'leftGauntlet',
  'rightGauntlet',
  'shield',
  'weapon',
  'ammo',
  'leftRing',
  'rightRing',
  'amulet',
  'belt',
  'shirt',
  'pants',
  'skirt',
  'robe',
  'shoes',
] as const;
export type SlotId = (typeof SLOTS)[number];

export const SLOT_NAMES: Readonly<Record<SlotId, string>> = {
  head: 'Head',
  cuirass: 'Cuirass',
  greaves: 'Greaves',
  boots: 'Boots',
  leftPauldron: 'Left Pauldron',
  rightPauldron: 'Right Pauldron',
  leftGauntlet: 'Left Gauntlet',
  rightGauntlet: 'Right Gauntlet',
  shield: 'Shield',
  weapon: 'Weapon',
  ammo: 'Ammunition',
  leftRing: 'Left Ring',
  rightRing: 'Right Ring',
  amulet: 'Amulet',
  belt: 'Belt',
  shirt: 'Shirt',
  pants: 'Pants',
  skirt: 'Skirt',
  robe: 'Robe',
  shoes: 'Shoes',
};

/** Slots that armour occupies; the rest are clothing, jewellery or held. */
export const ARMOR_SLOTS: readonly SlotId[] = [
  'head',
  'cuirass',
  'greaves',
  'boots',
  'leftPauldron',
  'rightPauldron',
  'leftGauntlet',
  'rightGauntlet',
  'shield',
];

/**
 * Only garments that occupy the same cloth actually fight. Armour layers over
 * clothing — a cuirass worn over a shirt is the normal case, not a conflict.
 */
export const SLOT_CONFLICTS: Readonly<Partial<Record<SlotId, readonly SlotId[]>>> = {
  robe: ['shirt', 'skirt'],
  skirt: ['pants'],
};

export type ArmorClass = 'light' | 'medium' | 'heavy';

export const ARMOR_CLASS_SKILL: Readonly<Record<ArmorClass, SkillId>> = {
  light: 'lightArmor',
  medium: 'mediumArmor',
  heavy: 'heavyArmor',
};

export const MATERIALS = [
  'fur',
  'skerrin',
  'chitin',
  'bonemold',
  'iron',
  'steel',
  'silver',
  'dwarven',
  'orcish',
  'adamantium',
  'glass',
  'ebony',
  'daedric',
] as const;
export type MaterialId = (typeof MATERIALS)[number];

export interface MaterialDef {
  readonly name: string;
  readonly weight: number;
  readonly value: number;
  /** Multiplies base durability — how long the thing survives being used. */
  readonly condition: number;
  readonly damage: number;
  readonly armor: number;
  /** Multiplies enchantment capacity. Glass and ebony hold far more charge. */
  readonly enchant: number;
  readonly armorClass: ArmorClass;
  /** Rough power tier, 0..6. Drives loot generation, never enemy scaling. */
  readonly tier: number;
  /** Silver bites things that steel cannot touch. */
  readonly bane?: 'undead' | 'daedra';
}

export const MATERIAL_DEFS: Readonly<Record<MaterialId, MaterialDef>> = {
  fur: { name: 'Fur', weight: 0.45, value: 0.3, condition: 0.5, damage: 0.5, armor: 0.35, enchant: 0.7, armorClass: 'light', tier: 0 },
  skerrin: { name: 'Skerrin Leather', weight: 0.55, value: 0.55, condition: 0.7, damage: 0.6, armor: 0.55, enchant: 1.0, armorClass: 'light', tier: 1 },
  chitin: { name: 'Chitin', weight: 0.5, value: 0.5, condition: 0.65, damage: 0.75, armor: 0.5, enchant: 1.2, armorClass: 'light', tier: 1 },
  bonemold: { name: 'Bonemold', weight: 0.8, value: 0.9, condition: 0.9, damage: 0.85, armor: 0.85, enchant: 1.3, armorClass: 'medium', tier: 2 },
  iron: { name: 'Iron', weight: 1.0, value: 0.6, condition: 0.8, damage: 0.8, armor: 0.7, enchant: 0.6, armorClass: 'heavy', tier: 1 },
  steel: { name: 'Steel', weight: 0.95, value: 1.0, condition: 1.0, damage: 1.0, armor: 1.0, enchant: 0.8, armorClass: 'heavy', tier: 2 },
  silver: { name: 'Silver', weight: 0.9, value: 1.6, condition: 0.9, damage: 0.95, armor: 0.95, enchant: 2.0, armorClass: 'heavy', tier: 3, bane: 'undead' },
  dwarven: { name: 'Dwarven', weight: 1.1, value: 2.4, condition: 1.5, damage: 1.25, armor: 1.35, enchant: 1.5, armorClass: 'medium', tier: 3 },
  orcish: { name: 'Groshic', weight: 1.25, value: 2.8, condition: 1.7, damage: 1.35, armor: 1.5, enchant: 1.2, armorClass: 'medium', tier: 4 },
  adamantium: { name: 'Adamantium', weight: 0.9, value: 3.4, condition: 2.0, damage: 1.4, armor: 1.6, enchant: 1.8, armorClass: 'medium', tier: 4 },
  glass: { name: 'Glass', weight: 0.4, value: 5.0, condition: 1.2, damage: 1.55, armor: 1.7, enchant: 3.2, armorClass: 'light', tier: 5 },
  ebony: { name: 'Ebony', weight: 1.4, value: 6.5, condition: 2.6, damage: 1.7, armor: 2.0, enchant: 3.6, armorClass: 'heavy', tier: 5 },
  daedric: { name: 'Daedric', weight: 1.6, value: 12.0, condition: 3.4, damage: 2.0, armor: 2.4, enchant: 5.0, armorClass: 'heavy', tier: 6, bane: 'daedra' },
};

export const WEAPON_TYPES = [
  'dagger',
  'tanto',
  'shortsword',
  'wakizashi',
  'longsword',
  'broadsword',
  'claymore',
  'dai-katana',
  'warAxe',
  'battleAxe',
  'club',
  'mace',
  'warhammer',
  'staff',
  'spear',
  'halberd',
  'shortBow',
  'longBow',
  'crossbow',
  'dart',
  'arrow',
  'bolt',
] as const;
export type WeaponTypeId = (typeof WEAPON_TYPES)[number];

export interface WeaponTypeDef {
  readonly name: string;
  readonly skill: SkillId;
  readonly weight: number;
  readonly value: number;
  /** Metres of reach. Spears out-range blades; that is the whole point of them. */
  readonly reach: number;
  /** Swings per second at full fatigue. */
  readonly speed: number;
  readonly chop: readonly [number, number];
  readonly slash: readonly [number, number];
  readonly thrust: readonly [number, number];
  readonly condition: number;
  readonly enchant: number;
  readonly twoHanded: boolean;
  readonly ranged: boolean;
  /** Ammunition and thrown weapons are consumed. */
  readonly stackable: boolean;
}

export const WEAPON_DEFS: Readonly<Record<WeaponTypeId, WeaponTypeDef>> = {
  dagger: { name: 'Dagger', skill: 'shortBlade', weight: 3, value: 20, reach: 0.9, speed: 1.6, chop: [1, 8], slash: [1, 7], thrust: [1, 8], condition: 150, enchant: 10, twoHanded: false, ranged: false, stackable: false },
  tanto: { name: 'Tanto', skill: 'shortBlade', weight: 3, value: 30, reach: 0.9, speed: 1.7, chop: [1, 6], slash: [1, 6], thrust: [2, 12], condition: 200, enchant: 12, twoHanded: false, ranged: false, stackable: false },
  shortsword: { name: 'Short Sword', skill: 'shortBlade', weight: 8, value: 60, reach: 1.1, speed: 1.4, chop: [1, 10], slash: [1, 11], thrust: [1, 12], condition: 250, enchant: 14, twoHanded: false, ranged: false, stackable: false },
  wakizashi: { name: 'Wakizashi', skill: 'shortBlade', weight: 9, value: 90, reach: 1.15, speed: 1.35, chop: [1, 12], slash: [1, 13], thrust: [1, 10], condition: 300, enchant: 15, twoHanded: false, ranged: false, stackable: false },
  longsword: { name: 'Long Sword', skill: 'longBlade', weight: 14, value: 120, reach: 1.4, speed: 1.1, chop: [1, 14], slash: [1, 16], thrust: [1, 12], condition: 400, enchant: 18, twoHanded: false, ranged: false, stackable: false },
  broadsword: { name: 'Broadsword', skill: 'longBlade', weight: 16, value: 110, reach: 1.35, speed: 1.0, chop: [1, 16], slash: [1, 14], thrust: [1, 10], condition: 420, enchant: 18, twoHanded: false, ranged: false, stackable: false },
  claymore: { name: 'Claymore', skill: 'longBlade', weight: 26, value: 200, reach: 1.75, speed: 0.75, chop: [1, 22], slash: [1, 24], thrust: [1, 16], condition: 550, enchant: 24, twoHanded: true, ranged: false, stackable: false },
  'dai-katana': { name: 'Dai-Katana', skill: 'longBlade', weight: 24, value: 260, reach: 1.8, speed: 0.8, chop: [1, 20], slash: [1, 26], thrust: [1, 18], condition: 520, enchant: 26, twoHanded: true, ranged: false, stackable: false },
  warAxe: { name: 'War Axe', skill: 'axe', weight: 16, value: 90, reach: 1.25, speed: 1.0, chop: [1, 18], slash: [1, 12], thrust: [1, 6], condition: 380, enchant: 16, twoHanded: false, ranged: false, stackable: false },
  battleAxe: { name: 'Battle Axe', skill: 'axe', weight: 32, value: 180, reach: 1.6, speed: 0.7, chop: [1, 28], slash: [1, 18], thrust: [1, 8], condition: 500, enchant: 22, twoHanded: true, ranged: false, stackable: false },
  club: { name: 'Club', skill: 'bluntWeapon', weight: 10, value: 15, reach: 1.0, speed: 1.3, chop: [1, 10], slash: [1, 10], thrust: [1, 5], condition: 200, enchant: 8, twoHanded: false, ranged: false, stackable: false },
  mace: { name: 'Mace', skill: 'bluntWeapon', weight: 18, value: 100, reach: 1.2, speed: 1.0, chop: [1, 17], slash: [1, 15], thrust: [1, 7], condition: 420, enchant: 16, twoHanded: false, ranged: false, stackable: false },
  warhammer: { name: 'Warhammer', skill: 'bluntWeapon', weight: 38, value: 220, reach: 1.55, speed: 0.6, chop: [1, 32], slash: [1, 20], thrust: [1, 8], condition: 560, enchant: 22, twoHanded: true, ranged: false, stackable: false },
  staff: { name: 'Staff', skill: 'bluntWeapon', weight: 12, value: 60, reach: 1.7, speed: 1.15, chop: [1, 9], slash: [1, 9], thrust: [1, 11], condition: 260, enchant: 30, twoHanded: true, ranged: false, stackable: false },
  spear: { name: 'Spear', skill: 'spear', weight: 20, value: 110, reach: 2.1, speed: 0.95, chop: [1, 8], slash: [1, 10], thrust: [1, 22], condition: 400, enchant: 18, twoHanded: true, ranged: false, stackable: false },
  halberd: { name: 'Halberd', skill: 'spear', weight: 34, value: 200, reach: 2.3, speed: 0.7, chop: [1, 24], slash: [1, 20], thrust: [1, 26], condition: 520, enchant: 24, twoHanded: true, ranged: false, stackable: false },
  shortBow: { name: 'Short Bow', skill: 'marksman', weight: 8, value: 70, reach: 24, speed: 1.2, chop: [1, 8], slash: [1, 8], thrust: [1, 8], condition: 200, enchant: 14, twoHanded: true, ranged: true, stackable: false },
  longBow: { name: 'Long Bow', skill: 'marksman', weight: 12, value: 140, reach: 42, speed: 0.9, chop: [1, 14], slash: [1, 14], thrust: [1, 14], condition: 300, enchant: 18, twoHanded: true, ranged: true, stackable: false },
  crossbow: { name: 'Crossbow', skill: 'marksman', weight: 20, value: 250, reach: 50, speed: 0.5, chop: [1, 22], slash: [1, 22], thrust: [1, 22], condition: 380, enchant: 20, twoHanded: true, ranged: true, stackable: false },
  dart: { name: 'Dart', skill: 'marksman', weight: 0.2, value: 2, reach: 14, speed: 1.8, chop: [1, 5], slash: [1, 5], thrust: [1, 5], condition: 1, enchant: 4, twoHanded: false, ranged: true, stackable: true },
  arrow: { name: 'Arrow', skill: 'marksman', weight: 0.1, value: 1, reach: 0, speed: 1, chop: [1, 6], slash: [1, 6], thrust: [1, 6], condition: 1, enchant: 4, twoHanded: false, ranged: false, stackable: true },
  bolt: { name: 'Bolt', skill: 'marksman', weight: 0.15, value: 2, reach: 0, speed: 1, chop: [1, 9], slash: [1, 9], thrust: [1, 9], condition: 1, enchant: 5, twoHanded: false, ranged: false, stackable: true },
};

export const ARMOR_PIECES = [
  'helm',
  'cuirass',
  'greaves',
  'boots',
  'pauldron',
  'gauntlet',
  'towerShield',
  'shield',
  'buckler',
] as const;
export type ArmorPieceId = (typeof ARMOR_PIECES)[number];

export interface ArmorPieceDef {
  readonly name: string;
  /** Fixed for a piece; left/right variants are chosen at construction. */
  readonly slot: SlotId;
  readonly weight: number;
  readonly value: number;
  /** Base armour rating before the material multiplier. */
  readonly armor: number;
  readonly condition: number;
  readonly enchant: number;
  /** Fraction of incoming damage this piece is asked to stop. */
  readonly coverage: number;
}

export const ARMOR_PIECE_DEFS: Readonly<Record<ArmorPieceId, ArmorPieceDef>> = {
  helm: { name: 'Helm', slot: 'head', weight: 6, value: 60, armor: 12, condition: 250, enchant: 12, coverage: 0.1 },
  cuirass: { name: 'Cuirass', slot: 'cuirass', weight: 24, value: 200, armor: 20, condition: 500, enchant: 24, coverage: 0.3 },
  greaves: { name: 'Greaves', slot: 'greaves', weight: 12, value: 100, armor: 14, condition: 300, enchant: 16, coverage: 0.15 },
  boots: { name: 'Boots', slot: 'boots', weight: 10, value: 80, armor: 12, condition: 250, enchant: 12, coverage: 0.1 },
  pauldron: { name: 'Pauldron', slot: 'leftPauldron', weight: 8, value: 70, armor: 12, condition: 250, enchant: 12, coverage: 0.1 },
  gauntlet: { name: 'Gauntlet', slot: 'leftGauntlet', weight: 4, value: 40, armor: 10, condition: 200, enchant: 8, coverage: 0.05 },
  towerShield: { name: 'Tower Shield', slot: 'shield', weight: 22, value: 220, armor: 24, condition: 500, enchant: 20, coverage: 0.0 },
  shield: { name: 'Shield', slot: 'shield', weight: 14, value: 140, armor: 18, condition: 380, enchant: 16, coverage: 0.0 },
  buckler: { name: 'Buckler', slot: 'shield', weight: 8, value: 90, armor: 12, condition: 260, enchant: 12, coverage: 0.0 },
};

export type ItemKind =
  | 'weapon'
  | 'armor'
  | 'clothing'
  | 'ingredient'
  | 'potion'
  | 'scroll'
  | 'book'
  | 'apparatus'
  | 'tool'
  | 'misc';

/** An enchantment bound into an item. */
export interface Enchantment {
  readonly name: string;
  readonly kind: 'cast' | 'constant' | 'strike';
  readonly effects: readonly EffectInstance[];
  /** Charge consumed per use; constant effects never spend it. */
  readonly cost: number;
  /** Maximum stored charge. */
  readonly charge: number;
}

interface ItemBase {
  readonly id: string;
  readonly name: string;
  readonly kind: ItemKind;
  readonly weight: number;
  readonly value: number;
  /** Non-null when the item was generated at runtime and must be saved whole. */
  readonly generated?: true;
}

export interface WeaponItem extends ItemBase {
  readonly kind: 'weapon';
  readonly type: WeaponTypeId;
  readonly material: MaterialId;
  readonly skill: SkillId;
  readonly reach: number;
  readonly speed: number;
  readonly chop: readonly [number, number];
  readonly slash: readonly [number, number];
  readonly thrust: readonly [number, number];
  readonly maxCondition: number;
  readonly enchantPoints: number;
  readonly twoHanded: boolean;
  readonly ranged: boolean;
  readonly stackable: boolean;
  readonly bane?: 'undead' | 'daedra';
  readonly enchantment?: Enchantment;
}

export interface ArmorItem extends ItemBase {
  readonly kind: 'armor';
  readonly piece: ArmorPieceId;
  readonly material: MaterialId;
  readonly slot: SlotId;
  readonly armor: number;
  readonly armorClass: ArmorClass;
  readonly coverage: number;
  readonly maxCondition: number;
  readonly enchantPoints: number;
  readonly enchantment?: Enchantment;
}

export interface ClothingItem extends ItemBase {
  readonly kind: 'clothing';
  readonly slot: SlotId;
  readonly enchantPoints: number;
  readonly enchantment?: Enchantment;
}

export interface IngredientItem extends ItemBase {
  readonly kind: 'ingredient';
  /** Exactly four, in the order the alchemist learns them. */
  readonly effects: readonly EffectInstance[];
}

export interface PotionItem extends ItemBase {
  readonly kind: 'potion';
  readonly effects: readonly EffectInstance[];
}

export interface ScrollItem extends ItemBase {
  readonly kind: 'scroll';
  readonly effects: readonly EffectInstance[];
  readonly castCost: number;
}

export interface BookItem extends ItemBase {
  readonly kind: 'book';
  readonly text: string;
  /** A skill book raises its skill once, ever. */
  readonly teaches?: SkillId;
}

export type ApparatusKind = 'mortar' | 'alembic' | 'calcinator' | 'retort';

export interface ApparatusItem extends ItemBase {
  readonly kind: 'apparatus';
  readonly apparatus: ApparatusKind;
  readonly quality: number;
}

export interface ToolItem extends ItemBase {
  readonly kind: 'tool';
  readonly tool: 'repair' | 'lockpick' | 'probe';
  readonly quality: number;
  readonly uses: number;
}

export interface MiscItem extends ItemBase {
  readonly kind: 'misc';
  readonly misc: 'gold' | 'soulgem' | 'light' | 'key' | 'junk';
  readonly soulCapacity?: number;
}

export type ItemDef =
  | WeaponItem
  | ArmorItem
  | ClothingItem
  | IngredientItem
  | PotionItem
  | ScrollItem
  | BookItem
  | ApparatusItem
  | ToolItem
  | MiscItem;

/** A physical instance in someone's pack. */
export interface ItemStack {
  uid: number;
  def: string;
  count: number;
  /** Current durability; -1 for items without condition. */
  condition: number;
  /** Current enchantment charge; -1 for items without one. */
  charge: number;
  /** Value of the soul trapped inside a soul gem, 0 if empty. */
  soul: number;
  /** Which creature the soul came from, for the inventory label. */
  soulName?: string;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function makeWeapon(type: WeaponTypeId, material: MaterialId, id?: string): WeaponItem {
  const t = WEAPON_DEFS[type];
  const m = MATERIAL_DEFS[material];
  const scale = (r: readonly [number, number]): [number, number] => [
    Math.max(1, Math.round(r[0] * m.damage)),
    Math.max(1, Math.round(r[1] * m.damage)),
  ];
  return {
    id: id ?? `weapon:${material}:${type}`,
    name: `${m.name} ${t.name}`,
    kind: 'weapon',
    weight: round1(t.weight * m.weight),
    value: Math.round(t.value * m.value),
    type,
    material,
    skill: t.skill,
    reach: t.reach,
    speed: t.speed,
    chop: scale(t.chop),
    slash: scale(t.slash),
    thrust: scale(t.thrust),
    maxCondition: Math.round(t.condition * m.condition),
    enchantPoints: Math.round(t.enchant * m.enchant),
    twoHanded: t.twoHanded,
    ranged: t.ranged,
    stackable: t.stackable,
    bane: m.bane,
  };
}

export function makeArmor(
  piece: ArmorPieceId,
  material: MaterialId,
  side: 'left' | 'right' = 'left',
  id?: string,
): ArmorItem {
  const p = ARMOR_PIECE_DEFS[piece];
  const m = MATERIAL_DEFS[material];
  let slot = p.slot;
  if (side === 'right') {
    if (slot === 'leftPauldron') slot = 'rightPauldron';
    else if (slot === 'leftGauntlet') slot = 'rightGauntlet';
  }
  const sideTag = piece === 'pauldron' || piece === 'gauntlet' ? `:${side}` : '';
  const sideName = piece === 'pauldron' || piece === 'gauntlet' ? `${side === 'left' ? 'Left' : 'Right'} ` : '';
  return {
    id: id ?? `armor:${material}:${piece}${sideTag}`,
    name: `${m.name} ${sideName}${p.name}`,
    kind: 'armor',
    weight: round1(p.weight * m.weight),
    value: Math.round(p.value * m.value),
    piece,
    material,
    slot,
    armor: Math.round(p.armor * m.armor),
    armorClass: m.armorClass,
    coverage: p.coverage,
    maxCondition: Math.round(p.condition * m.condition),
    enchantPoints: Math.round(p.enchant * m.enchant),
  };
}

interface ClothingRow {
  readonly id: string;
  readonly name: string;
  readonly slot: SlotId;
  readonly weight: number;
  readonly value: number;
  readonly enchant: number;
}

const CLOTHING_ROWS: readonly ClothingRow[] = [
  { id: 'clothing:commonShirt', name: 'Common Shirt', slot: 'shirt', weight: 1, value: 8, enchant: 5 },
  { id: 'clothing:extravagantShirt', name: 'Extravagant Shirt', slot: 'shirt', weight: 1.5, value: 120, enchant: 20 },
  { id: 'clothing:commonPants', name: 'Common Pants', slot: 'pants', weight: 1, value: 8, enchant: 5 },
  { id: 'clothing:extravagantPants', name: 'Extravagant Pants', slot: 'pants', weight: 1.5, value: 110, enchant: 18 },
  { id: 'clothing:commonSkirt', name: 'Common Skirt', slot: 'skirt', weight: 1, value: 9, enchant: 5 },
  { id: 'clothing:commonShoes', name: 'Common Shoes', slot: 'shoes', weight: 2, value: 10, enchant: 6 },
  { id: 'clothing:extravagantShoes', name: 'Extravagant Shoes', slot: 'shoes', weight: 2, value: 90, enchant: 16 },
  { id: 'clothing:commonRobe', name: 'Common Robe', slot: 'robe', weight: 2, value: 30, enchant: 12 },
  { id: 'clothing:expensiveRobe', name: 'Expensive Robe', slot: 'robe', weight: 2.5, value: 180, enchant: 30 },
  { id: 'clothing:extravagantRobe', name: 'Extravagant Robe', slot: 'robe', weight: 3, value: 400, enchant: 45 },
  { id: 'clothing:commonBelt', name: 'Common Belt', slot: 'belt', weight: 0.5, value: 12, enchant: 8 },
  { id: 'clothing:exquisiteBelt', name: 'Exquisite Belt', slot: 'belt', weight: 0.6, value: 220, enchant: 30 },
  { id: 'clothing:commonRing', name: 'Common Ring', slot: 'leftRing', weight: 0.1, value: 25, enchant: 20 },
  { id: 'clothing:exquisiteRing', name: 'Exquisite Ring', slot: 'leftRing', weight: 0.1, value: 300, enchant: 60 },
  { id: 'clothing:commonAmulet', name: 'Common Amulet', slot: 'amulet', weight: 0.2, value: 40, enchant: 25 },
  { id: 'clothing:exquisiteAmulet', name: 'Exquisite Amulet', slot: 'amulet', weight: 0.2, value: 450, enchant: 70 },
];

function clothing(row: ClothingRow): ClothingItem {
  return {
    id: row.id,
    name: row.name,
    kind: 'clothing',
    weight: row.weight,
    value: row.value,
    slot: row.slot,
    enchantPoints: row.enchant,
  };
}

/** Four effects each, in the order an alchemist learns them by skill. */
interface IngredientRow {
  readonly id: string;
  readonly name: string;
  readonly weight: number;
  readonly value: number;
  readonly effects: readonly [EffectInstance, EffectInstance, EffectInstance, EffectInstance];
}

const ing = (effect: EffectInstance['effect'], extra: Partial<EffectInstance> = {}): EffectInstance => ({
  effect,
  magMin: 1,
  magMax: 1,
  duration: 0,
  area: 0,
  range: 'self',
  ...extra,
});

const INGREDIENT_ROWS: readonly IngredientRow[] = [
  { id: 'ingredient:ashYam', name: 'Ash Yam', weight: 1, value: 5, effects: [ing('restoreFatigue'), ing('fortifyAttribute', { attribute: 'intelligence' }), ing('resistCommonDisease'), ing('drainAttribute', { attribute: 'personality' })] },
  { id: 'ingredient:bloat', name: 'Bloat', weight: 0.5, value: 5, effects: [ing('restoreFatigue'), ing('drainAttribute', { attribute: 'agility' }), ing('lightSpell'), ing('paralyze')] },
  { id: 'ingredient:corkbulb', name: 'Corkbulb Root', weight: 1, value: 4, effects: [ing('restoreHealth'), ing('drainAttribute', { attribute: 'intelligence' }), ing('cureParalyzation'), ing('fortifyAttribute', { attribute: 'endurance' })] },
  { id: 'ingredient:comberry', name: 'Comberry', weight: 0.1, value: 3, effects: [ing('restoreMagicka'), ing('drainFatigue'), ing('fireDamage'), ing('resistMagicka')] },
  { id: 'ingredient:kwamaCuttle', name: 'Morvek Cuttle', weight: 0.5, value: 3, effects: [ing('restoreHealth'), ing('drainAttribute', { attribute: 'agility' }), ing('curePoison'), ing('damageAttribute', { attribute: 'personality' })] },
  { id: 'ingredient:marshmerrow', name: 'Marshmerrow', weight: 1, value: 2, effects: [ing('restoreHealth'), ing('drainAttribute', { attribute: 'speed' }), ing('restoreMagicka'), ing('drainAttribute', { attribute: 'willpower' })] },
  { id: 'ingredient:muck', name: 'Muck', weight: 1, value: 1, effects: [ing('drainAttribute', { attribute: 'strength' }), ing('resistCommonDisease'), ing('drainAttribute', { attribute: 'speed' }), ing('poison')] },
  { id: 'ingredient:saltrice', name: 'Saltrice', weight: 0.5, value: 4, effects: [ing('restoreFatigue'), ing('restoreHealth'), ing('drainAttribute', { attribute: 'luck' }), ing('fortifyFatigue')] },
  { id: 'ingredient:scribJelly', name: 'Vekling Jelly', weight: 0.5, value: 6, effects: [ing('restoreFatigue'), ing('cureCommonDisease'), ing('curePoison'), ing('restoreHealth')] },
  { id: 'ingredient:trama', name: 'Trama Root', weight: 1, value: 2, effects: [ing('drainAttribute', { attribute: 'willpower' }), ing('telekinesis'), ing('lightSpell'), ing('drainAttribute', { attribute: 'personality' })] },
  { id: 'ingredient:willowAnther', name: 'Willow Anther', weight: 0.1, value: 4, effects: [ing('restoreFatigue'), ing('resistBlightDisease'), ing('curePoison'), ing('fortifyAttribute', { attribute: 'speed' })] },
  { id: 'ingredient:hacklelo', name: 'Hackle-lo Leaf', weight: 1, value: 5, effects: [ing('restoreFatigue'), ing('restoreHealth'), ing('drainAttribute', { attribute: 'intelligence' }), ing('paralyze')] },
  { id: 'ingredient:goldKanet', name: 'Gold Kanet', weight: 0.1, value: 3, effects: [ing('drainAttribute', { attribute: 'strength' }), ing('restoreAttribute', { attribute: 'endurance' }), ing('paralyze'), ing('damageHealth')] },
  { id: 'ingredient:roobrush', name: 'Roobrush', weight: 0.2, value: 2, effects: [ing('drainAttribute', { attribute: 'intelligence' }), ing('curePoison'), ing('detectAnimal'), ing('damageAttribute', { attribute: 'endurance' })] },
  { id: 'ingredient:firePetal', name: 'Fire Petal', weight: 0.1, value: 8, effects: [ing('fireDamage'), ing('resistFire'), ing('fortifyAttribute', { attribute: 'willpower' }), ing('lightSpell')] },
  { id: 'ingredient:stoneflower', name: 'Stoneflower Petals', weight: 0.1, value: 3, effects: [ing('restoreFatigue'), ing('fortifyAttribute', { attribute: 'strength' }), ing('drainAttribute', { attribute: 'intelligence' }), ing('restoreAttribute', { attribute: 'strength' })] },
  { id: 'ingredient:blackLichen', name: 'Black Lichen', weight: 1, value: 6, effects: [ing('drainAttribute', { attribute: 'endurance' }), ing('resistPoison'), ing('drainAttribute', { attribute: 'agility' }), ing('restoreAttribute', { attribute: 'intelligence' })] },
  { id: 'ingredient:daedraHeart', name: "Aetherim's Heart", weight: 3, value: 60, effects: [ing('restoreHealth'), ing('fortifyAttribute', { attribute: 'strength' }), ing('drainAttribute', { attribute: 'personality' }), ing('damageHealth')] },
  { id: 'ingredient:voidSalts', name: 'Void Salts', weight: 0.2, value: 90, effects: [ing('drainHealth'), ing('resistParalysis'), ing('spellAbsorption'), ing('damageAttribute', { attribute: 'endurance' })] },
  { id: 'ingredient:bonemeal', name: 'Bonemeal', weight: 1, value: 15, effects: [ing('restoreFatigue'), ing('resistCommonDisease'), ing('drainAttribute', { attribute: 'willpower' }), ing('summonAncestralGhost')] },
  { id: 'ingredient:diamond', name: 'Diamond', weight: 0.2, value: 400, effects: [ing('restoreAttribute', { attribute: 'endurance' }), ing('shield'), ing('drainAttribute', { attribute: 'luck' }), ing('reflect')] },
  { id: 'ingredient:ruby', name: 'Ruby', weight: 0.2, value: 100, effects: [ing('drainFatigue'), ing('resistFire'), ing('fortifyAttribute', { attribute: 'personality' }), ing('lightSpell')] },
  { id: 'ingredient:pearl', name: 'Pearl', weight: 0.1, value: 60, effects: [ing('restoreFatigue'), ing('waterBreathing'), ing('drainAttribute', { attribute: 'strength' }), ing('resistCommonDisease')] },
  { id: 'ingredient:rawEbony', name: 'Raw Ebony', weight: 8, value: 300, effects: [ing('drainMagicka'), ing('fortifyMagicka'), ing('drainAttribute', { attribute: 'speed' }), ing('reflect')] },
  { id: 'ingredient:ashSalts', name: 'Ash Salts', weight: 0.2, value: 30, effects: [ing('drainAttribute', { attribute: 'intelligence' }), ing('resistBlightDisease'), ing('drainFatigue'), ing('nightEye')] },
  { id: 'ingredient:shalkResin', name: 'Shalk Resin', weight: 0.5, value: 12, effects: [ing('fortifyAttribute', { attribute: 'strength' }), ing('drainAttribute', { attribute: 'speed' }), ing('shield'), ing('fireShield')] },
  { id: 'ingredient:codaFlower', name: 'Coda Flower', weight: 0.2, value: 9, effects: [ing('restoreMagicka'), ing('damageFatigue'), ing('paralyze'), ing('nightEye')] },
  { id: 'ingredient:bittergreen', name: 'Bittergreen Petals', weight: 0.1, value: 12, effects: [ing('restoreMagicka'), ing('drainAttribute', { attribute: 'intelligence' }), ing('damageHealth'), ing('fortifyAttribute', { attribute: 'agility' })] },
  { id: 'ingredient:luminousRussula', name: 'Luminous Russula', weight: 0.5, value: 6, effects: [ing('drainFatigue'), ing('detectKey'), ing('poison'), ing('lightSpell')] },
  { id: 'ingredient:violetCoprinus', name: 'Violet Coprinus', weight: 0.5, value: 7, effects: [ing('drainFatigue'), ing('poison'), ing('waterWalking'), ing('restoreAttribute', { attribute: 'agility' })] },
  { id: 'ingredient:bunglersBane', name: "Bungler's Bane", weight: 0.5, value: 5, effects: [ing('drainAttribute', { attribute: 'intelligence' }), ing('drainAttribute', { attribute: 'agility' }), ing('telekinesis'), ing('damageAttribute', { attribute: 'strength' })] },
  { id: 'ingredient:hyphaFacia', name: 'Hypha Facia', weight: 0.5, value: 10, effects: [ing('drainHealth'), ing('nightEye'), ing('damageAttribute', { attribute: 'endurance' }), ing('restoreMagicka')] },
];

/**
 * What each species of placed flora yields when a player picks it. The keys are
 * the scatter rules' own species ids, so the vegetation the world already
 * renders is the vegetation alchemy is supplied from — an ingredient economy
 * that exists on the map rather than only in loot tables.
 */
export const FLORA_INGREDIENTS: Readonly<Record<string, string>> = {
  yam: 'ingredient:ashYam',
  marsh: 'ingredient:marshmerrow',
  stone: 'ingredient:stoneflower',
  trama: 'ingredient:trama',
  bulb: 'ingredient:luminousRussula',
  parasol: 'ingredient:hyphaFacia',
  kelp: 'ingredient:hacklelo',
};

function ingredient(row: IngredientRow): IngredientItem {
  return {
    id: row.id,
    name: row.name,
    kind: 'ingredient',
    weight: row.weight,
    value: row.value,
    effects: row.effects,
  };
}

const STATIC_MISC: readonly ItemDef[] = [
  { id: 'misc:gold', name: 'Gold', kind: 'misc', weight: 0, value: 1, misc: 'gold' },
  { id: 'misc:soulgemPetty', name: 'Petty Soul Gem', kind: 'misc', weight: 0.5, value: 10, misc: 'soulgem', soulCapacity: 60 },
  { id: 'misc:soulgemLesser', name: 'Lesser Soul Gem', kind: 'misc', weight: 0.5, value: 25, misc: 'soulgem', soulCapacity: 120 },
  { id: 'misc:soulgemCommon', name: 'Common Soul Gem', kind: 'misc', weight: 0.5, value: 60, misc: 'soulgem', soulCapacity: 200 },
  { id: 'misc:soulgemGreater', name: 'Greater Soul Gem', kind: 'misc', weight: 0.5, value: 150, misc: 'soulgem', soulCapacity: 300 },
  { id: 'misc:soulgemGrand', name: 'Grand Soul Gem', kind: 'misc', weight: 0.5, value: 400, misc: 'soulgem', soulCapacity: 500 },
  { id: 'misc:torch', name: 'Torch', kind: 'misc', weight: 1, value: 5, misc: 'light' },
  { id: 'misc:lantern', name: 'Lantern', kind: 'misc', weight: 2, value: 20, misc: 'light' },
  { id: 'tool:repairProngs', name: 'Repair Prongs', kind: 'tool', weight: 2, value: 25, tool: 'repair', quality: 0.6, uses: 15 },
  { id: 'tool:armorersHammer', name: "Armorer's Hammer", kind: 'tool', weight: 3, value: 40, tool: 'repair', quality: 1.0, uses: 30 },
  { id: 'tool:masterRepairTool', name: 'Master Repair Tool', kind: 'tool', weight: 3, value: 220, tool: 'repair', quality: 2.5, uses: 60 },
  { id: 'tool:apprenticeLockpick', name: 'Apprentice Lockpick', kind: 'tool', weight: 0.5, value: 10, tool: 'lockpick', quality: 0.5, uses: 12 },
  { id: 'tool:secretMasterLockpick', name: "Secret Master's Lockpick", kind: 'tool', weight: 0.5, value: 150, tool: 'lockpick', quality: 1.6, uses: 50 },
  { id: 'tool:apprenticeProbe', name: 'Apprentice Probe', kind: 'tool', weight: 0.5, value: 10, tool: 'probe', quality: 0.5, uses: 12 },
  { id: 'tool:secretMasterProbe', name: "Secret Master's Probe", kind: 'tool', weight: 0.5, value: 150, tool: 'probe', quality: 1.6, uses: 50 },
  { id: 'app:mortarApprentice', name: "Apprentice's Mortar and Pestle", kind: 'apparatus', weight: 2, value: 50, apparatus: 'mortar', quality: 0.8 },
  { id: 'app:mortarJourneyman', name: "Journeyman's Mortar and Pestle", kind: 'apparatus', weight: 2, value: 150, apparatus: 'mortar', quality: 1.2 },
  { id: 'app:mortarGrandmaster', name: "Grandmaster's Mortar and Pestle", kind: 'apparatus', weight: 2, value: 800, apparatus: 'mortar', quality: 2.0 },
  { id: 'app:alembicJourneyman', name: "Journeyman's Alembic", kind: 'apparatus', weight: 2, value: 150, apparatus: 'alembic', quality: 1.2 },
  { id: 'app:calcinatorJourneyman', name: "Journeyman's Calcinator", kind: 'apparatus', weight: 2, value: 150, apparatus: 'calcinator', quality: 1.2 },
  { id: 'app:retortJourneyman', name: "Journeyman's Retort", kind: 'apparatus', weight: 2, value: 150, apparatus: 'retort', quality: 1.2 },
];

const STATIC_BOOKS: readonly BookItem[] = [
  { id: 'book:36lessons', name: 'The Forty Verses of Suneth, Verse One', kind: 'book', weight: 3, value: 50, text: 'And the Hortator said unto the ash: I am the sword and the wound both.' },
  { id: 'book:wolfQueen', name: 'The Ash Queen, Book One', kind: 'book', weight: 3, value: 40, text: 'Vaelith stood at the window of her chambers and watched the Valmori City burn.', teaches: 'speechcraft' },
  { id: 'book:armorersChallenge', name: "The Armorer's Challenge", kind: 'book', weight: 3, value: 90, text: 'Heat, fold, quench. There is no fourth step and no shortcut past the second.', teaches: 'armorer' },
  { id: 'book:withersnap', name: 'Counterturn', kind: 'book', weight: 3, value: 90, text: 'A treatise on walking the wrong way round a shrine, and what answers.', teaches: 'alteration' },
  { id: 'book:mysteriousAkavir', name: 'Mysterious Oth-Karan', kind: 'book', weight: 3, value: 90, text: 'Of the four nations of Oth-Karan, only the Tsaesci are known to still exist.', teaches: 'longBlade' },
];

/** Loot-table shapes, kept honest: a place is as dangerous as it is. */
export const LOOT_TIERS: readonly (readonly MaterialId[])[] = [
  ['fur', 'skerrin', 'iron', 'chitin'],
  ['iron', 'steel', 'chitin', 'bonemold'],
  ['steel', 'bonemold', 'silver', 'dwarven'],
  ['dwarven', 'silver', 'orcish', 'adamantium'],
  ['orcish', 'adamantium', 'glass', 'ebony'],
  ['glass', 'ebony', 'daedric'],
];

/** Enchantment name fragments; the loot generator picks from the effect. */
const ENCHANT_SUFFIX: Readonly<Partial<Record<keyof typeof EFFECTS, string>>> = {
  fireDamage: 'Firebite',
  frostDamage: 'Frostbite',
  shockDamage: 'Storms',
  damageHealth: 'Wounding',
  absorbHealth: 'Leeching',
  absorbMagicka: 'the Sated',
  drainHealth: 'the Ghoul',
  poison: 'Venom',
  restoreHealth: 'Mending',
  restoreFatigue: 'the Second Wind',
  fortifyAttribute: 'the Giant',
  fortifyHealth: 'Vitality',
  fortifyMagicka: 'Deep Wells',
  shield: 'Warding',
  fireShield: 'the Salamander',
  frostShield: 'the Rime',
  lightningShield: 'the Tempest',
  levitate: 'the Kite',
  jump: 'the Ash Shrike',
  feather: 'the Porter',
  waterWalking: 'the Strider',
  waterBreathing: 'the Drowned',
  chameleon: 'the Shade',
  invisibility: 'the Unseen',
  nightEye: 'the Owl',
  sanctuary: 'Sanctuary',
  paralyze: 'Binding',
  soultrap: 'Soul Snare',
  telekinesis: 'the Long Reach',
  resistMagicka: 'the Sceptic',
  resistFire: 'the Ember',
  resistFrost: 'the Hearth',
  silence: 'the Mute',
  reflect: 'the Mirror',
  lightSpell: 'the Lantern',
};

/**
 * Registry. Static tables are built once; generated items (enchanted loot,
 * brewed potions, spellmade scrolls) are added at runtime and serialised whole
 * so a save never resolves to a missing definition.
 */
export class ItemRegistry {
  private readonly defs = new Map<string, ItemDef>();
  private seq = 0;

  constructor() {
    for (const type of WEAPON_TYPES) {
      for (const material of MATERIALS) {
        // Ammunition and thrown weapons only exist in the plainer materials.
        if (WEAPON_DEFS[type].stackable && MATERIAL_DEFS[material].tier > 3) continue;
        const w = makeWeapon(type, material);
        this.defs.set(w.id, w);
      }
    }
    for (const piece of ARMOR_PIECES) {
      for (const material of MATERIALS) {
        if (piece === 'pauldron' || piece === 'gauntlet') {
          for (const side of ['left', 'right'] as const) {
            const a = makeArmor(piece, material, side);
            this.defs.set(a.id, a);
          }
        } else {
          const a = makeArmor(piece, material);
          this.defs.set(a.id, a);
        }
      }
    }
    for (const row of CLOTHING_ROWS) this.defs.set(row.id, clothing(row));
    for (const row of INGREDIENT_ROWS) this.defs.set(row.id, ingredient(row));
    for (const m of STATIC_MISC) this.defs.set(m.id, m);
    for (const b of STATIC_BOOKS) this.defs.set(b.id, b);
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  get(id: string): ItemDef {
    const d = this.defs.get(id);
    if (!d) throw new Error(`unknown item "${id}"`);
    return d;
  }

  /** Undefined instead of throwing, for save files that outlived a table edit. */
  find(id: string): ItemDef | undefined {
    return this.defs.get(id);
  }

  all(): readonly ItemDef[] {
    return [...this.defs.values()];
  }

  ids(): readonly string[] {
    return [...this.defs.keys()];
  }

  byKind<K extends ItemKind>(kind: K): readonly Extract<ItemDef, { kind: K }>[] {
    const out: Extract<ItemDef, { kind: K }>[] = [];
    for (const d of this.defs.values()) {
      if (d.kind === kind) out.push(d as Extract<ItemDef, { kind: K }>);
    }
    return out;
  }

  /** Registers a runtime-generated definition and returns its id. */
  define(def: ItemDef): string {
    this.defs.set(def.id, def);
    return def.id;
  }

  nextId(prefix: string): string {
    return `${prefix}#${++this.seq}`;
  }

  /** Only generated defs need saving; the static tables rebuild themselves. */
  serialise(): { seq: number; defs: ItemDef[] } {
    const defs: ItemDef[] = [];
    for (const d of this.defs.values()) if (d.generated) defs.push(d);
    return { seq: this.seq, defs };
  }

  deserialise(s: { seq: number; defs: readonly ItemDef[] }): void {
    this.seq = s.seq;
    for (const d of s.defs) this.defs.set(d.id, d);
  }
}

export function isWeapon(d: ItemDef): d is WeaponItem {
  return d.kind === 'weapon';
}
export function isArmor(d: ItemDef): d is ArmorItem {
  return d.kind === 'armor';
}
export function isClothing(d: ItemDef): d is ClothingItem {
  return d.kind === 'clothing';
}

export function equipSlot(d: ItemDef): SlotId | null {
  if (isWeapon(d)) return d.stackable ? 'ammo' : 'weapon';
  if (isArmor(d)) return d.slot;
  if (isClothing(d)) return d.slot;
  return null;
}

export function maxConditionOf(d: ItemDef): number {
  if (isWeapon(d)) return d.maxCondition;
  if (isArmor(d)) return d.maxCondition;
  return -1;
}

export function enchantmentOf(d: ItemDef): Enchantment | undefined {
  if (isWeapon(d) || isArmor(d) || isClothing(d)) return d.enchantment;
  return undefined;
}

export function enchantPointsOf(d: ItemDef): number {
  if (isWeapon(d) || isArmor(d) || isClothing(d)) return d.enchantPoints;
  return 0;
}

/** Value including the enchantment; enchanted gear is worth far more than steel. */
export function itemValue(d: ItemDef): number {
  const ench = enchantmentOf(d);
  if (!ench) return d.value;
  return Math.round(d.value + ench.cost * (ench.kind === 'constant' ? 1.2 : 3.4));
}

export interface GeneratedItem {
  readonly def: ItemDef;
  readonly stack: ItemStack;
}

/** Effects worth binding into found loot; hostile ones go on weapons only. */
const LOOT_EFFECTS: readonly EffectId[] = [
  'fireDamage',
  'frostDamage',
  'shockDamage',
  'absorbHealth',
  'damageHealth',
  'poison',
  'paralyze',
  'soultrap',
] as const;

const LOOT_WEARABLE_EFFECTS: readonly EffectId[] = [
  'fortifyAttribute',
  'fortifyHealth',
  'fortifyMagicka',
  'shield',
  'resistFire',
  'resistFrost',
  'resistMagicka',
  'sanctuary',
  'chameleon',
  'nightEye',
  'jump',
  'feather',
  'levitate',
  'waterWalking',
  'waterBreathing',
  'lightSpell',
  'telekinesis',
  'restoreHealth',
] as const;

const LOOT_ATTRIBUTES = ['strength', 'intelligence', 'willpower', 'agility', 'speed', 'endurance', 'personality', 'luck'] as const;

/**
 * Procedural enchanted loot. Power comes from the material tier and the roll,
 * never from the player's level — walk into the wrong barrow at level one and
 * the ebony longsword on the wall is still an ebony longsword.
 */
export function generateEnchanted(
  reg: ItemRegistry,
  base: WeaponItem | ArmorItem | ClothingItem,
  rng: Rng,
  power: number,
): ItemDef {
  const capacity = base.enchantPoints;
  const onStrike = base.kind === 'weapon' && !base.stackable && rng.next() < 0.7;
  const constant = !onStrike && base.kind !== 'weapon' && rng.next() < 0.45;
  const kind: Enchantment['kind'] = onStrike ? 'strike' : constant ? 'constant' : 'cast';

  const pool: readonly EffectId[] = base.kind === 'weapon' ? LOOT_EFFECTS : LOOT_WEARABLE_EFFECTS;
  const pick = pool[rng.int(pool.length)];
  const def = EFFECTS[pick];

  const mag = Math.max(1, Math.round(rng.range(2, 6 + power * 5)));
  const dur = def.noDuration ? 0 : kind === 'constant' ? 1 : Math.max(1, Math.round(rng.range(2, 4 + power * 12)));
  const effect: EffectInstance = {
    effect: pick,
    attribute: def.param === 'attribute' ? LOOT_ATTRIBUTES[rng.int(LOOT_ATTRIBUTES.length)] : undefined,
    skill: undefined,
    magMin: def.noMagnitude ? 0 : mag,
    magMax: def.noMagnitude ? 0 : mag,
    duration: dur,
    area: 0,
    range: base.kind === 'weapon' ? 'touch' : 'self',
  };

  let cost = enchantmentCost([effect], kind);
  // Scale the roll down until it actually fits the item, rather than refusing:
  // a fur helm can carry a small enchantment and should be allowed to.
  let guard = 0;
  while (cost > capacity * (kind === 'constant' ? 1 : 4) && guard++ < 24) {
    if (effect.magMax > 1) {
      effect.magMax = Math.max(1, Math.floor(effect.magMax * 0.7));
      effect.magMin = Math.min(effect.magMin, effect.magMax);
    } else if (effect.duration > 1) {
      effect.duration = Math.max(1, Math.floor(effect.duration * 0.7));
    } else break;
    cost = enchantmentCost([effect], kind);
  }

  const suffix = ENCHANT_SUFFIX[pick] ?? def.name;
  const ench: Enchantment = {
    name: `${def.name}`,
    kind,
    effects: [effect],
    cost: kind === 'constant' ? 0 : Math.max(1, Math.round(spellCost([effect]))),
    charge: Math.max(1, Math.round(capacity * 10)),
  };

  const id = reg.nextId(`${base.kind}:ench`);
  const name = `${base.name} of ${suffix}`;
  if (base.kind === 'weapon') {
    return reg.get(reg.define({ ...base, id, name, enchantment: ench, generated: true }));
  }
  if (base.kind === 'armor') {
    return reg.get(reg.define({ ...base, id, name, enchantment: ench, generated: true }));
  }
  return reg.get(reg.define({ ...base, id, name, enchantment: ench, generated: true }));
}

const LOOT_WEAPON_TYPES: readonly WeaponTypeId[] = WEAPON_TYPES.filter((t) => !WEAPON_DEFS[t].stackable);

/** A whole loot pile for a tier, with no reference to the player at all. */
export function rollLoot(reg: ItemRegistry, tier: number, rng: Rng, count: number): ItemStack[] {
  const mats = LOOT_TIERS[Math.max(0, Math.min(LOOT_TIERS.length - 1, tier))];
  const out: ItemStack[] = [];
  for (let i = 0; i < count; i++) {
    const roll = rng.next();
    let def: ItemDef;
    if (roll < 0.35) {
      // Ammunition is not loot in its own right, and only exists in the plainer
      // materials, so drawing from the full type list would miss the table.
      def = reg.get(`weapon:${mats[rng.int(mats.length)]}:${LOOT_WEAPON_TYPES[rng.int(LOOT_WEAPON_TYPES.length)]}`);
    } else if (roll < 0.7) {
      const piece = ARMOR_PIECES[rng.int(ARMOR_PIECES.length)];
      const side = rng.next() < 0.5 ? 'left' : 'right';
      const tag = piece === 'pauldron' || piece === 'gauntlet' ? `:${side}` : '';
      def = reg.get(`armor:${mats[rng.int(mats.length)]}:${piece}${tag}`);
    } else {
      const ings = reg.byKind('ingredient');
      def = ings[rng.int(ings.length)];
    }
    if ((isWeapon(def) || isArmor(def)) && rng.next() < 0.08 + tier * 0.03) {
      def = generateEnchanted(reg, def, rng, tier / 6);
    }
    out.push(newStack(def, 1, 0));
  }
  return out;
}

let uidSeq = 0;

export function newStack(def: ItemDef, count = 1, uid = 0): ItemStack {
  const cond = maxConditionOf(def);
  const ench = enchantmentOf(def);
  return {
    uid: uid || ++uidSeq,
    def: def.id,
    count,
    condition: cond,
    charge: ench ? ench.charge : -1,
    soul: 0,
  };
}

export function resetUidSeq(v: number): void {
  uidSeq = Math.max(uidSeq, v);
}

export function peekUidSeq(): number {
  return uidSeq;
}
