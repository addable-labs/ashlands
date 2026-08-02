import type { ItemDef, ItemId } from './types';

/**
 * Only the objects the quest layer needs to reason about. Inventory proper
 * belongs to whatever system owns loot; this table exists so that a filter can
 * ask "does the player hold the Verse of Blood" without a string typo becoming
 * a permanently unsatisfiable condition.
 */
export const ITEMS = {
  gold: { id: 'gold', name: 'drakes', value: 1, quest: false },
  sealed_packet: { id: 'sealed_packet', name: 'sealed packet, ash-waxed', value: 0, quest: true },
  verse_ash: { id: 'verse_ash', name: 'the Verse of Ash', value: 0, quest: true },
  verse_blood: { id: 'verse_blood', name: 'the Verse of Blood', value: 0, quest: true },
  verse_name: { id: 'verse_name', name: 'the Verse of Name', value: 0, quest: true },
  verse_deed: { id: 'verse_deed', name: 'the Verse of Deed', value: 0, quest: true },
  hlaalu_ledger: { id: 'hlaalu_ledger', name: 'the second Hlaalu ledger', value: 400, quest: true },
  muran_spore: { id: 'muran_spore', name: 'gallery spore of Tel Muran', value: 250, quest: true },
  guild_shipment: { id: 'guild_shipment', name: 'Fighters Guild strongbox', value: 300, quest: true },
  kwama_reagents: { id: 'kwama_reagents', name: 'kwama cuttle and scrib jelly', value: 40, quest: false },
  writ_of_execution: { id: 'writ_of_execution', name: 'Hlaalu writ of execution', value: 0, quest: true },
  ashfall_manifest: { id: 'ashfall_manifest', name: "the caravan's manifest", value: 0, quest: true },
  moon_sugar_crate: { id: 'moon_sugar_crate', name: 'crate of moon sugar', value: 500, quest: false },
  shrine_offering: { id: 'shrine_offering', name: 'sealed offering of the Seven', value: 60, quest: true },
  ancestor_ring: { id: 'ancestor_ring', name: 'Andalen ancestor ring', value: 900, quest: true },
} as const satisfies Record<ItemId, ItemDef>;
