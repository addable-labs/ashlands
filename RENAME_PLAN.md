# Rename Plan — proposal, not yet applied

**Nothing in this document has been executed.** It is an inventory of third-party material in the source and a proposed replacement vocabulary, for approval before any edit is made.

**Not legal advice.** I am not a lawyer. This is an engineering assessment of what is reproduced and what it would cost to replace. Whether to act on it, and how far, is your call — and a real lawyer's, if the stakes warrant it.

---

## 1. Why this exists

The repository is currently private. Making it public does not change what is in it, but it changes discoverability, which is the practical variable.

The distinction that matters:

- **Fine:** the README describing this as an homage to Morrowind, comparing against it, naming it as the target. That is nominative use and is normal.
- **Not fine:** shipping Morrowind's *setting vocabulary as this game's own content* — the races, houses, bestiary, cosmology and named powers. That is the protected expressive layer, not generic fantasy vocabulary.

For comparison: OpenMW reimplements the Morrowind *engine* and requires you to own the original game. Ashlands is a standalone work carrying the lore, which is the category that has historically attracted cease-and-desist letters.

**Correction to an earlier estimate.** I previously described this as "one race name, three house names, six creature names." That was wrong by an order of magnitude. The actual scope is below.

---

## 2. Inventory

~1,100 occurrences across 95 of 160 source files. Tiered by risk.

### Tier 1 — coined proper nouns, no generic equivalent. Must change.

| Category | Terms | Notes |
|---|---|---|
| **Races (10)** | Altmer, Bosmer, Dunmer, Argonian, Khajiit, Redguard, Breton, Imperial, Nord, Orc | The first six are coinages. The last four are more generic, but the *roster* is Morrowind's |
| **Great Houses (3)** | Hlaalu (×108), Redoran (×79), Telvanni (×93) | Almost none in comments — these are shipped strings |
| **Bestiary (7)** | guar (×331), netch, kwama, scrib, nix-hound, cliff racer, silt strider | Coined creature names |
| **Places (4)** | Vvardenfell, Balmora, Vivec, Tamriel | |
| **Lore & religion** | Nerevar, Nerevarine, Almsivi, Tribunal Temple, Ordinators, Ashlanders | |
| **Birthsigns (13)** | The Warrior, Mage, Thief, Serpent, Lady, Steed, Lord, Apprentice, Atronach, Ritual, Lover, Shadow, Tower | Individually some are generic; as a *constellation set* it is verbatim Morrowind |
| **Powers (24)** | Ancestor Guardian, Voice of the Emperor, Star of the West, Eye of Night, Eye of Fear, Adrenaline Rush, Dragon Skin, Highborn, Beast Tongue, Thunder Fist, Woad, Nordic Hardiness, Charioteer, Blood of the North, Trollkin, Elfborn, Wombstone, Stunted Magicka, Blessed Word, Blessed Touch, Mooncalf, Moonshadow, Tower Key, Berserk | Verbatim names |
| **Guilds (4)** | Fighters Guild, Mages Guild, Thieves Guild, Imperial Legion | Near-generic, but verbatim; cheap to change, so change them |

### Tier 2 — judgement call

| Category | Assessment |
|---|---|
| **Skills (27)** — Acrobatics, Alchemy, Alteration, Armorer, Athletics, Axe, Block, Blunt Weapon, Conjuration, Destruction, Enchant, Hand-to-hand, Heavy/Light/Medium Armor, Illusion, Long/Short Blade, Marksman, Mercantile, Mysticism, Restoration, Security, Sneak, Spear, Speechcraft, Unarmored | Individually generic — these appear across countless RPGs. The *exact set of 27* is Morrowind's arrangement. **Recommendation: keep.** Renaming them would damage the design for little risk reduction. Consider changing only `Mysticism` and `Unarmored`, the two most TES-flavoured. |
| **Magic effects** — Absorb Health, Fortify Attribute, etc. | Generic RPG vocabulary. **Keep.** |

### Tier 3 — safe, no action

- **Attributes** (Strength, Intelligence, Willpower, Agility, Speed, Endurance, Personality, Luck) — standard since D&D
- **Mechanics** — skills-by-use, ×1–×5 level multipliers, spellmaking, enchanting. Game mechanics are not copyrightable
- **README / EVALUATION references to Morrowind** — nominative use, and the honest framing of the experiment

---

## 3. Proposed replacement vocabulary

Designed as a coherent set for a volcanic island rather than arbitrary substitutions — ash, ember, glass, tide. **All of it is up for revision; treat these as first drafts.**

### Peoples

| Was | Proposed | Rationale |
|---|---|---|
| Dunmer | **Cindren** | Native ash-dwellers; cinder |
| Altmer | **Aurin** | Tall, golden, insufferable |
| Bosmer | **Sylvath** | Forest kin |
| Argonian | **Vethuk** | Marsh-born, water-breathing |
| Khajiit | **Rrasa** | Feline, night-eyed |
| Breton | **Halvorn** | Half-blood tradition of magic resistance |
| Imperial | **Valmori** | The occupying administrative power |
| Nord | **Skarn** | Cold-country, hardy |
| Orc | **Grosh** | |
| Redguard | **Sahiri** | Desert-descended warriors |

### Great Houses

| Was | Proposed | Character retained |
|---|---|---|
| House Hlaalu | **House Varo** | Merchants, bribes, Imperial accommodation |
| House Redoran | **House Korran** | Martial honour, duty |
| House Telvanni | **House Vaelmyr** | Wizard-lords in grown towers |

### Bestiary

| Was | Proposed |
|---|---|
| guar | **drell** |
| netch | **skerrin** |
| kwama | **morvek** |
| scrib | **morvek grub** |
| nix-hound | **glassjaw** |
| cliff racer | **ash shrike** |
| silt strider | **fenwalker** |

### Places and lore

| Was | Proposed |
|---|---|
| Vvardenfell | **Ashenreach** |
| Balmora | **Kethrin** |
| Vivec (city) | **Suneth** |
| Tamriel | **Ammaris** |
| Nerevar / Nerevarine | **Veyra / the Veyrane** |
| Almsivi / Tribunal Temple | **the Trine / Temple of the Trine** |
| Ordinators | **Wardens of the Trine** |
| Ashlanders | **the Shirenamat** (already partly original) |

### Guilds

| Was | Proposed |
|---|---|
| Fighters Guild | **the Ironring** |
| Mages Guild | **the Ashen Conclave** |
| Thieves Guild | **the Quiet Hand** |
| Imperial Legion | **the Valmori Cohort** |

### Birthsigns

Keeping the mechanical structure, replacing the constellation set:

| Was | Proposed | | Was | Proposed |
|---|---|---|---|---|
| The Warrior | **The Spear** | | The Apprentice | **The Kindling** |
| The Mage | **The Ember** | | The Atronach | **The Hollow** |
| The Thief | **The Ashfall** | | The Ritual | **The Chant** |
| The Serpent | **The Coil** | | The Lover | **The Tether** |
| The Lady | **The Hearth** | | The Shadow | **The Veil** |
| The Steed | **The Courser** | | The Tower | **The Spire** |
| The Lord | **The Anvil** | | | |

### Powers

The 24 named powers need individual replacement. Proposed pattern: keep the mechanical effect, rename to the new vocabulary — e.g. *Ancestor Guardian* → **Cinder-Kin Ward**, *Voice of the Emperor* → **Valmori Authority**, *Star of the West* → **Westlight**, *Woad* → **Warpaint**, *Trollkin* → **Slow-Mending**, *Wombstone* → **Stoneborn**, *Moonshadow* → **Duskstep**, *Tower Key* → **Spire Key**. Full list to be drafted on approval of the vocabulary above.

---

## 4. Effort and risk

- **Mechanical, but wide.** 95 files. Most changes are string and identifier substitutions; the engine, renderer, verification harness and evaluation are entirely original and unaffected.
- **The gate protects this.** Renames should not move a single pixel. Any metric that changes indicates a real bug — a string was load-bearing somewhere it should not have been.
- **Risk of breakage** is mainly in quest logic keyed by id (`hlaalu_ledger`, `kwama_reagents`). Ids and display names should be changed together, and `node tools/quests.mjs` re-run to confirm all 18 quests still complete.
- **Suggested order:** ids and display names per category, gate after each category, quests.mjs at the end.

---

## 5. Also required before going public

- **Add a LICENSE.** Public with no license means all-rights-reserved: people may read but not use or fork it. This should come *after* the rename, since content containing third-party IP cannot be cleanly licensed.
- **Commit email.** Every commit carries a personal address which will be public and scraped. Optional: switch to a GitHub `noreply` address for future commits.
- **Docs are ready.** README, EVALUATION, PIPELINE, ART_BIBLE need no work.
- **Clean otherwise.** No secrets, no credentials, no binary assets; 290 tracked text files, 3.9 MB of history.

---

## 6. Decision needed

1. Approve, amend, or reject the vocabulary in §3
2. Confirm the Tier 2 recommendation — keep the 27 skill names
3. Choose a license for §5

No edits will be made until you say so.
