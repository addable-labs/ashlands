import type { BookDef } from './types';

/**
 * Sixteen in-world books.
 *
 * They contradict each other, and that is the design. The Ashlander creation
 * myth and the Temple's corrected account cannot both be true; the Imperial
 * history of the ash-frontier and the Ashlander account of the same fifty years
 * describe different crimes by different people; the Dissident commentary
 * accuses the Temple of cutting a page and the Temple's own sermon quotes a
 * line that is not in the printed sermon. Nothing in the game adjudicates. A
 * player who reads all of them knows more and is certain of less, which is the
 * strongest worldbuilding device the series has and the cheapest one to build.
 */
export const BOOKS: Record<string, BookDef> = {
  ash_which_was_first: {
    id: 'ash_which_was_first',
    title: 'The Ash Which Was First',
    author: 'recited at Shirenamat; written down by an outlander, badly',
    kind: 'myth',
    teaches: ['ashlanders', 'the_ash_wake', 'red_mountain'],
    text: `Before the mountain there was the ash, and the ash was not the leaving of a fire, because there had been no fire. The ash was first. This is the part the settled folk cannot hold in their heads, and they will argue with you about it in their houses, where they are warm.

Out of the ash walked the first three, and they were not gods, they were people, which is worse. The first said, I will make a wall against the ash. The second said, I will make a book against the ash. The third said nothing and kept walking, and it is the third we are.

The wall fell. It falls in every telling and no teller says when. The book was written and rewritten and the rewriting is the whole of the history the settled folk have. And the third walked out to where the wind runs clean, and is walking, and will be walking when the wall is a line under the ash and the book is a shelf of copies of copies.

They ask us why we keep no city. We ask them what a city is for, if the ash was first and the ash is patient. They have never answered. They have built another wall instead, and invoiced us for the lamp oil.`,
  },

  making_corrected: {
    id: 'making_corrected',
    title: 'On the Making of the World, Corrected',
    author: 'Canon Serys Dram, Temple Press, twelfth printing',
    kind: 'myth',
    teaches: ['tribunal_temple'],
    skill: 'restoration',
    text: `It is necessary to state plainly, and at the outset, that the world was made and did not simply occur. The ash is not first. The ash is a residue, and a residue implies a burning, and a burning implies a fire, and a fire implies a hand that struck it. The Ashlander recitation, which begins by asserting an eternal ash, is therefore not a rival account of creation but a refusal of the question.

The Three came into their divinity by the Rite at Red Mountain, and the province was ordered by them: the roads, the calendar, the law of ancestors, the shape of the year. That there is now silence from the Three is not evidence of their absence but of their attention being elsewhere, and a faith which requires constant reassurance is a market stall, not a faith.

Of the so-called Ash-Wake, this printing says what the eleventh said: it is not scripture. It has never been scripture. The Canon has examined the codices in which certain persons claim to have found it and is satisfied that the pages in question are of a later hand and a poorer grade of vellum.

The reader will observe that this chapter is shorter than the corresponding chapter of the eleventh printing. Some material has been consolidated for clarity.`,
  },

  sermon_ninth: {
    id: 'sermon_ninth',
    title: 'The Sermon of the Three, Chapter the Ninth',
    author: 'anonymous; Temple canon',
    kind: 'history',
    teaches: ['tribunal_temple', 'red_mountain'],
    skill: 'restoration',
    text: `And the mother said: I have made you a country out of a wound, and you will not thank me, and I did not ask you to.

And the mystery said: I have made you a machine that keeps the country, and when I stop attending to it, it will keep going for some while on its own, and you will mistake that for my attention.

And the poet-king said nothing that has been recorded here, and the silence at this point in the sermon is observed in the liturgy by a pause of four breaths.

And the fourth stood at the edge of the light and said: there is a thing under the mountain and it is not one of us, and it is sleeping, and I would like it discussed.

And the sermon continues at Chapter the Tenth.

[Marginal hand, a later ink:] Four breaths, indeed. Ask the curate what the fourth's name was. Ask him what happened to the discussion. Ask him why the pause is four breaths long and not three.`,
  },

  cut_page: {
    id: 'cut_page',
    title: 'The Cut Page: a Dissident Commentary',
    author: 'Madrel Vandas, from three older hands',
    kind: 'history',
    teaches: ['dissident_saints', 'the_ash_wake', 'four_verses'],
    text: `I do not accuse the Temple of inventing the faith. I accuse it of editing the faith and then denying that faith is the sort of thing that can be edited.

Here is the evidence and the reader may weigh it. The ninth chapter of the Sermon of the Three, in the twelfth printing, runs to four hundred and six lines. In the codex at Ald Sethis — which the shrine holds, and denies holding — it runs to four hundred and sixty-one. The missing fifty-five lines are not doctrinally difficult. They are boring. They are an inventory of a descent, in the plain style, of a party of four going down into a shaft under Red Mountain to look at something, and coming back up as three.

A forger does not forge boring material. A forger forges revelations.

The excision is clean, made with a knife, and the knife-marks are in the gutter of the page where a rebinding did not quite hide them. I have held that page. I am aware that this is not proof to anyone who has not held it, and I am aware that I will not be permitted to hold it again.

To the curate who taught me, if he reads this: I am not your enemy. I am the consequence of your teaching me to check the sources.`,
  },

  hlaalu_prospects: {
    id: 'hlaalu_prospects',
    title: 'Hlaalu Prospects: An Address to New Kinsmen',
    author: 'the Council of House Hlaalu',
    kind: 'propaganda',
    teaches: ['house_hlaalu', 'great_houses'],
    skill: 'mercantile',
    text: `Welcome, kinsman. You have joined the only Great House that will tell you the truth about what a Great House is for.

Redoran will tell you a House is for honour. Ask a Redoran retainer what he ate this week. Telvanni will tell you a House is for power, by which they mean one wizard's power and your obedience to it. Hlaalu says a House is for prosperity, and prosperity is measurable, and what is measurable can be argued about honestly.

Three principles.

The first: never break a law you could instead amend. Amendment is slower and it lasts.

The second: the Empire is not our master and not our friend. It is our largest customer. Treat it as you would treat any large customer — punctually, courteously, and with a signed schedule.

The third, which the other Houses use against us and which we print anyway: a bargain that ruins the other party is a bargain you will only make once. Ruin is expensive. Leave your counterpart standing and you will trade with him for thirty years.

You will hear it said in Ald Sethis that Hlaalu takes a widow's house. Hlaalu takes what a signed note says Hlaalu takes. If you find that ugly, the remedy is in the drafting of notes, and the drafting of notes is a career, and it is yours.`,
  },

  watch_does_not_sleep: {
    id: 'watch_does_not_sleep',
    title: 'The Watch Does Not Sleep',
    author: "Archmaster's office, House Redoran",
    kind: 'propaganda',
    teaches: ['house_redoran', 'great_houses', 'ash_storms'],
    skill: 'block',
    text: `A House is judged by what it holds when holding costs it.

Hlaalu holds the harbour, which pays. Telvanni holds its towers, which nobody wants. Redoran holds the ash-frontier, which is a line on no map, cannot be sold, produces nothing, and must be walked every night in every season by people who are not thanked for it.

That is the argument. There is not a second argument and Redoran has never needed one.

The young kinsman will be told by the harbour that our poverty is a pose. Let him walk the wall from the fourth bell to the eighth in an ash storm, with the ash finding the gap between helm and gorget as it always finds it, and let him understand that we would take the money if it were offered, and that it is not offered, and that we walk anyway.

Duty is not a feeling. Duty is a rota. Read the rota. Your name is on it for the nights you did not choose.

On the matter of duels: they are lawful, they are witnessed, and they are to first blood unless both parties and the hall agree otherwise. A killing in an alley is not a duel. A hireling is not a duel. If you cannot tell the difference you are not Redoran, whatever the roll says.`,
  },

  sovereignty_of_wizards: {
    id: 'sovereignty_of_wizards',
    title: 'On the Sovereignty of Wizards',
    author: 'Archmagister Fyr-Telvo, dictated',
    kind: 'propaganda',
    teaches: ['house_telvanni', 'mages_guild'],
    skill: 'alteration',
    text: `The Mages Guild issues licences. Consider what that sentence contains.

A licence is a permission. A permission is granted by an authority. An authority over magic would have to be more capable in magic than the licensed party, or the arrangement is a fiction maintained by paperwork. Walk into any guild hall on this island and ask yourself, honestly, whether the steward at the desk could stop you doing anything at all.

Telvanni law, entire: what you can hold, you hold.

This is called barbarous by people who have never examined the alternative. The alternative is that what you can hold, you hold until a clerk in Cyrodiil writes otherwise, and then you hold it still, but you are obliged to pretend you do not. We have removed the pretence. Nothing else about the arrangement is different.

The House takes retainers. Retainers are not always asked. This is also called barbarous. Note that the Guild's apprentices are asked, and are then sent into a sealed gallery for spore samples, and that the difference between our practice and theirs is one form, filled in beforehand.

I have not spoken aloud in eleven years. My Mouth speaks for me and speaks accurately. If you find that sinister, consider how much of what you were told today was said by the person who decided it.`,
  },

  impartial_history: {
    id: 'impartial_history',
    title: 'A True and Impartial History of the Ash-Frontier',
    author: 'Praefect Gaius Voleni, Imperial Provincial Office',
    kind: 'history',
    teaches: ['ald_sethis', 'guards'],
    skill: 'speechcraft',
    text: `The pacification of the ash-frontier is the least celebrated and most instructive of the province's recent chapters.

Prior to the Imperial survey the region was, in the strict sense, unadministered. Nomadic clans moved across it on no fixed schedule and acknowledged no jurisdiction. Disputes between these clans and the settled Houses were resolved by raid. The Empire did not conquer the ash-frontier. The Empire surveyed it, adjudicated the resulting claims, and enforced the adjudications, which is the whole of what is meant by pacification.

At Ald Sethis the Legion established a customs house in the year of the survey, at the request of local merchants, and the settlement grew around it. It is worth noting that the port pre-dates the Imperial presence by some decades in the local telling; the Office has examined this claim and finds no documentary support for it.

Losses among the clans during the period of adjudication were regrettable and are recorded, where recorded, as incidental.

The frontier is now quiet. Trade moves. The strider runs on a published schedule. Whatever may be said of the method — and a great deal is said, in the Flagon, after the fourth drink — the result is a road where there was no road.`,
  },

  what_the_ashlanders_say: {
    id: 'what_the_ashlanders_say',
    title: 'What the Ashlanders Say About the Ash-Frontier',
    author: 'set down by Zabamat, Wise Woman of the Shirenamat',
    kind: 'history',
    teaches: ['ashlanders', 'ald_sethis'],
    text: `The outlander history says we were unadministered. We were administered. We administered ourselves, and the arrangement had run for longer than his Empire had existed, and he did not ask about it because he had already decided that administration is a thing done with ink.

He says the Empire surveyed. Yes. A survey is a man with a chain walking across your grazing, and then a paper that says the grazing belongs to whoever paid the man with the chain.

He says disputes were resolved by raid. Some were. Most were resolved by the wise women of two camps sitting down for four days, which is slower than a raid and cheaper, and produces no history because nothing burned.

He says the port pre-dates the Empire "in the local telling". The local telling is us. Our dead are under his customs house. We told him where they were, so he would build around them, and he built on them and wrote that no documentary support could be found.

He says the losses are recorded as incidental. I have read that page. I have counted the names on our side of it, which is a short count, because our side of it is blank.

The frontier is quiet. That is true and I will not pretend otherwise. It is the quiet of a room after an argument that one party won.`,
  },

  netch_song: {
    id: 'netch_song',
    title: 'The Netch-Song of Llevo, Canto the Fourth',
    author: 'Llevo the Versifier, unassisted',
    kind: 'poetry',
    teaches: ['bad_poetry'],
    text: `O netch! O bulbous wanderer of air!
Thou driftest where the ash-winds do not care,
Thy tentacles depend, thy bell doth swell,
Thou art a kind of jellyfish, as well.

The guar has legs. The kwama has a queen.
The cliff racer is horrible and mean.
But thou, O netch, hast neither leg nor guile —
Thou merely floatest, in thy floating style.

I saw thee once above the Ashfall road
And thought: there goes a thing without a load.
No debt, no House, no writ, no coin, no wretch
To dun thee at thy door. O happy netch!

(Here the poet intends a stanza on the subject of the netch's diet, which is not
yet written, the poet having been unable to establish what a netch eats, and the
Flagon having declined to fund a research expedition.)

O netch! O netch! O — something — netch! O netch!
I have not found a rhyme. I shall not stretch.
Eleven cantos I have set before ye:
The twelfth awaits. The word, I think, is "fetch".`,
  },

  provender: {
    id: 'provender',
    title: 'Provender of the Ash Country: Seventy Receipts',
    author: 'Dinara Loras, of the Ashen Flagon',
    kind: 'cookery',
    teaches: ['ald_sethis', 'kaldera_mine'],
    skill: 'alchemy',
    text: `SCUTTLE, PROPERLY MADE. Take the ripe cuttle of the kwama, a full hand of it, and work it with the back of a spoon until it gives. Add ash-salt, one pinch, and not two, whatever the miners tell you. Set it in a cold press under a stone for three days. It should smell like a cellar and not like a mistake. Serve on hard bread with a slice of raw saltrice. Anyone who serves it warm is either an outlander or in a hurry.

ASH-YAM, ROASTED WHOLE. Bury them in the embers, do not peel them, and do not touch them for an hour by the glass. The skin goes to charcoal and holds the whole thing together. Break it at the table. A Redoran will eat four of these and call it a light supper.

MARSHMERROW STEW WITH GUAR. Guar shoulder, cut across the grain, browned hard in its own fat. Marshmerrow, comberry, one small hackle-lo leaf, and water to cover. Three hours, and add nothing else — the fashion for putting scrib jelly in it comes from Vivec and should stay there.

ON THE BOILING OF KWAMA EGG. Do not. A kwama egg is not a chicken's egg and a boiled one is a hard grey sorrow. Bake it in its shell in a low oven with a thumb of butter dropped through the top.

ON HOSPITALITY. The Ashlanders will not eat at your table and it is not an insult; they will not eat at anyone's table. Send the food out. It comes back as an empty dish, and that is the whole of the courtesy, and it is enough.`,
  },

  locks_and_law: {
    id: 'locks_and_law',
    title: 'A Practical Treatise on Locks, Wards, and the Law Concerning Both',
    author: 'attributed to "a retired gentleman of Balmora"',
    kind: 'manual',
    teaches: ['guards', 'stolen_goods'],
    skill: 'security',
    text: `A lock is a machine for producing delay. It does not prevent. It postpones, and the value of a lock is exactly the number of minutes of postponement multiplied by the likelihood that somebody is looking during those minutes.

From which the practical man derives his whole art: attend to the second term.

On tumblers. The Vvardenfell warded lock has between three and seven pins and the pins are of unequal length by design, so that the novice, having felt two set, believes himself nearly finished. He is not nearly finished. He is at the point in the work where the maker expects him to become confident.

On the law. Under Imperial statute as applied in the province, the offence is complete at the moment of entry and is not conditional on taking anything. This surprises people, and the surprise is usually expressed in a cell. Note further that a witness is required for a bounty to be assessed, that the witness need not be the owner, and that in law a guard who sees you leave a building is a witness to your having been in it.

On fences. Goods that are known are worth a fraction of goods that are not. The fraction is set by how badly the owner wants them back, not by their value, which is why the practical man leaves the famous piece on the shelf.

On the guards of Ald Sethis specifically: they walk where the lamps are. This is not laziness. It is the rota. Learn the rota.`,
  },

  fourth_gallery_letter: {
    id: 'fourth_gallery_letter',
    title: 'Letter, unsent, found in the fourth gallery',
    author: 'Falia Beren, apprentice of the Mages Guild',
    kind: 'letter',
    teaches: ['kaldera_mine', 'missing_apprentice', 'blight'],
    text: `Mother —

Do not read the part about the seal to Father.

The gallery is sealed and I have opened it, which the Guild will call initiative if the samples are good and unauthorised entry if they are not. I have four hours of lamp and the samples are good.

The spore here is wrong in an interesting way. It fruits in the dark against a rock that is warm, and the rock should not be warm; we are eleven fathoms under a mountain that has been quiet for two hundred years and the rock at the face is warm enough to sit against, and I have been sitting against it, because I am cold and because I am a fool.

There is a sound. I have been trying for an hour to write it down in a way that does not sound like a girl frightening herself. It is regular. It is very slow — I counted eleven of my breaths to one of it — and it is not water, because water does not pause, and this pauses.

Gadan sealed this gallery because two of his diggers came out sick and one came out talking. I am not sick and I am talking to a piece of paper, so I will say it here where the Guild will not see it: I do not think the third digger was mad. I think he heard the rock and answered it, and I think that answering it is the part that ought to be sealed.

Lamp is going. I will come out at the fourth bell and post this from the town and we will both laugh.

Your Falia`,
  },

  sixteen_beasts: {
    id: 'sixteen_beasts',
    title: 'Sixteen Beasts of the Grey Waste',
    author: 'Journeyman Bemis Alen, caravaner',
    kind: 'manual',
    teaches: ['silt_strider', 'ash_storms', 'blight'],
    skill: 'marksman',
    text: `Written for carters, not for scholars. If you want the Latin, buy the Guild's book, which is prettier and will get you killed.

THE SILT STRIDER. Not a beast, a colleague. She will walk a road she knows in weather that would put a guar down, and she will refuse a road she does not know in perfect sunshine. Do not argue. She is right more often than the schedule.

THE NIX-HOUND. Pack of four to nine. They do not charge the biggest thing in the group, they charge the slowest, so the practical measure on the road is not courage, it is boots.

THE CLIFF RACER. There is nothing to be said about the cliff racer that has not been said louder by someone with a spear.

THE KWAMA. Foragers are harmless unless you are between them and the queen, which is easier to be than it sounds, because the queen is under you.

THE NETCH. Bull netch will defend a radius and the radius is bigger than you think. Betty netch will not. Learn the difference from a distance; learning it from close is how carters get famous.

THE BLIGHTED. Any of the above, but wrong. It does not flee when it should, and it comes at the noise rather than the meat. If a beast behaves out of its book, it is not brave, it is sick, and the sickness travels on the wind that brought it.

THE ASH STORM. I include it here because it hunts.`,
  },

  four_verses_text: {
    id: 'four_verses_text',
    title: 'The Four Verses of the Ash-Wake, as recited at Shirenamat',
    author: 'no author; the recitation names no author',
    kind: 'myth',
    teaches: ['the_ash_wake', 'four_verses', 'hollow_star', 'the_ashen_gate'],
    text: `THE VERSE OF ASH. Ash was first and ash is patient. What the wall keeps out, the ash keeps. What the book keeps in, the ash keeps longer. In the year the second moon goes hollow, the ash will move, and it will not be the wind that moves it.

THE VERSE OF BLOOD. Not the blood of a House and not the blood of a line. The blood of a hand opened on purpose, in front of people who did not ask for it. One will come who is not owed to us and owes us nothing, and the proof is that they give anyway.

THE VERSE OF NAME. They will have three names and none of them will be the one their mother used. The camp will give the third. A name given by a camp cannot be taken back by a Temple, and this is why the Temple does not like this verse.

THE VERSE OF DEED. Under the mountain is a shaft, and at the bottom of the shaft a thing keeps time. Go down at the hour before the sun. Wake it, and the ash goes up and the country changes and you will not be forgiven either way. Or leave it, and it keeps time, and it does not need you, and it never did.

[Zabamat's hand, on the hide:] The fourth verse is in a different ink and a steadier hand than the other three. I have said so for forty years to anyone who would sit still. Nobody has ever wanted to hear that the ending was written later.`,
  },

  ledger_practice: {
    id: 'ledger_practice',
    title: 'Ledger Practice for the Provincial Clerk',
    author: 'Varo Hleran, House Hlaalu, for internal circulation',
    kind: 'manual',
    teaches: ['hlaalu_ledger', 'house_hlaalu'],
    skill: 'mercantile',
    text: `The clerk will keep the house ledger in a single hand, in ink, with no erasure. Where a correction is required it is made by a fresh line, dated, and the original is left legible. A ledger with erasures is worth nothing in a court and worth less than nothing to the House.

The clerk will render to the customs house a true account of dutiable movement. "Dutiable" is defined by statute and the statute is narrower than the customs house believes it to be. It is not the clerk's office to educate the customs house.

The clerk will note that certain instruments — accommodation notes between kinsmen, standing obligations of the House to itself, and forward positions in kwama produce — are not movements and do not appear in the customs account. They are nonetheless obligations, they must be recorded somewhere, and the somewhere is the second book.

The second book is not a secret. It is a working paper. The distinction matters and the clerk will be able to explain it, in plain language, to a Legion officer, without hesitating.

The clerk will keep the second book in the counting house and will not carry it in the street.

The clerk will not discuss the existence of the second book in the Ashen Flagon, at any hour, at any volume, with anybody, including other clerks.`,
  },
};

export const BOOK_LIST: readonly BookDef[] = Object.values(BOOKS);
