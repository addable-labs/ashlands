/**
 * Combat data tables.
 *
 * Every rule in this subsystem that a designer would want to tune lives here as
 * a typed const table, and the code that reads them contains no per-weapon or
 * per-creature branches. That is not tidiness for its own sake: an Elder
 * Scrolls game is only systemic if a new weapon material or a new creature is
 * one row, and combinations nobody planned — a silver spear against an armoured
 * netch, thrown chitin darts against a diving cliff racer — fall out of the
 * table product rather than out of a special case someone wrote.
 */

export type AttackKind = 'thrust' | 'slash' | 'chop';

export type WeaponClass =
  | 'shortblade'
  | 'longblade'
  | 'blunt'
  | 'axe'
  | 'spear'
  | 'marksman'
  | 'thrown'
  | 'handtohand';

export type WeaponMaterial =
  | 'flesh'
  | 'wood'
  | 'iron'
  | 'steel'
  | 'silver'
  | 'chitin'
  | 'bonemold'
  | 'dwemer'
  | 'glass'
  | 'ebony'
  | 'daedric';

export type ArmourMaterial =
  | 'none'
  | 'cloth'
  | 'fur'
  | 'leather'
  | 'chitin'
  | 'bonemold'
  | 'iron'
  | 'steel'
  | 'silver'
  | 'glass'
  | 'ebony'
  | 'daedric'
  | 'shell'
  | 'hide';

export type BodyRegion = 'head' | 'torso' | 'arm' | 'leg' | 'tail' | 'wing';

/** The skill the RPG layer advances when this weapon lands or misses. */
export type SkillName =
  | 'shortblade'
  | 'longblade'
  | 'blunt'
  | 'axe'
  | 'spear'
  | 'marksman'
  | 'handtohand'
  | 'block'
  | 'armour';

/* --------------------------------------------------------------- weapons */

export interface WeaponDef {
  id: string;
  name: string;
  cls: WeaponClass;
  material: WeaponMaterial;
  skill: SkillName;
  /** Metres from the hand anchor to the tip. Reach is the whole geometry of melee. */
  reach: number;
  /** Kilograms. Drives swing speed, stagger, knockback and hit-stop weight. */
  mass: number;
  /** Multiplier on windup and recovery. Below 1 is faster than the base arc. */
  speed: number;
  chop: readonly [number, number];
  slash: readonly [number, number];
  thrust: readonly [number, number];
  twoHanded: boolean;
  /** Enchanted weapons bite creatures that mundane steel cannot touch. */
  enchanted: boolean;
  /** Blade half-width for the swept capsule, metres. */
  edge: number;
  /** Launch speed for marksman/thrown weapons, m/s. */
  launch?: number;
}

const W = (d: WeaponDef): WeaponDef => d;

export const WEAPONS: Readonly<Record<string, WeaponDef>> = {
  fists: W({
    id: 'fists', name: 'Bare hands', cls: 'handtohand', material: 'flesh', skill: 'handtohand',
    reach: 0.62, mass: 1.0, speed: 0.72, chop: [1, 4], slash: [1, 4], thrust: [1, 4],
    twoHanded: false, enchanted: false, edge: 0.09,
  }),
  iron_dagger: W({
    id: 'iron_dagger', name: 'Iron dagger', cls: 'shortblade', material: 'iron', skill: 'shortblade',
    reach: 0.44, mass: 1.2, speed: 0.62, chop: [2, 6], slash: [2, 7], thrust: [3, 9],
    twoHanded: false, enchanted: false, edge: 0.035,
  }),
  steel_shortsword: W({
    id: 'steel_shortsword', name: 'Steel short sword', cls: 'shortblade', material: 'steel', skill: 'shortblade',
    reach: 0.72, mass: 2.5, speed: 0.78, chop: [3, 9], slash: [3, 10], thrust: [4, 13],
    twoHanded: false, enchanted: false, edge: 0.04,
  }),
  iron_broadsword: W({
    id: 'iron_broadsword', name: 'Iron broadsword', cls: 'longblade', material: 'iron', skill: 'longblade',
    reach: 1.02, mass: 5.0, speed: 1.0, chop: [4, 14], slash: [5, 16], thrust: [3, 11],
    twoHanded: false, enchanted: false, edge: 0.055,
  }),
  silver_longsword: W({
    id: 'silver_longsword', name: 'Silver longsword', cls: 'longblade', material: 'silver', skill: 'longblade',
    reach: 1.12, mass: 4.4, speed: 0.94, chop: [5, 15], slash: [6, 18], thrust: [4, 12],
    twoHanded: false, enchanted: false, edge: 0.05,
  }),
  chitin_warhammer: W({
    id: 'chitin_warhammer', name: 'Chitin warhammer', cls: 'blunt', material: 'chitin', skill: 'blunt',
    reach: 1.24, mass: 11.0, speed: 1.55, chop: [10, 34], slash: [4, 12], thrust: [3, 9],
    twoHanded: true, enchanted: false, edge: 0.13,
  }),
  steel_battleaxe: W({
    id: 'steel_battleaxe', name: 'Steel battle axe', cls: 'axe', material: 'steel', skill: 'axe',
    reach: 1.3, mass: 9.0, speed: 1.4, chop: [9, 28], slash: [7, 22], thrust: [2, 8],
    twoHanded: true, enchanted: false, edge: 0.1,
  }),
  chitin_spear: W({
    id: 'chitin_spear', name: 'Chitin spear', cls: 'spear', material: 'chitin', skill: 'spear',
    reach: 2.05, mass: 5.5, speed: 1.05, chop: [3, 10], slash: [3, 11], thrust: [8, 24],
    twoHanded: true, enchanted: false, edge: 0.045,
  }),
  glass_dagger: W({
    id: 'glass_dagger', name: 'Glass dagger', cls: 'shortblade', material: 'glass', skill: 'shortblade',
    reach: 0.5, mass: 1.1, speed: 0.55, chop: [4, 11], slash: [5, 13], thrust: [6, 17],
    twoHanded: false, enchanted: true, edge: 0.03,
  }),
  ebony_broadsword: W({
    id: 'ebony_broadsword', name: 'Ebony broadsword', cls: 'longblade', material: 'ebony', skill: 'longblade',
    reach: 1.06, mass: 6.0, speed: 0.98, chop: [12, 30], slash: [13, 33], thrust: [9, 24],
    twoHanded: false, enchanted: false, edge: 0.055,
  }),
  short_bow: W({
    id: 'short_bow', name: 'Short bow', cls: 'marksman', material: 'wood', skill: 'marksman',
    reach: 0.4, mass: 2.0, speed: 1.0, chop: [1, 3], slash: [1, 3], thrust: [1, 3],
    twoHanded: true, enchanted: false, edge: 0.03, launch: 62,
  }),
  chitin_bow: W({
    id: 'chitin_bow', name: 'Chitin long bow', cls: 'marksman', material: 'chitin', skill: 'marksman',
    reach: 0.45, mass: 2.6, speed: 1.18, chop: [1, 3], slash: [1, 3], thrust: [1, 3],
    twoHanded: true, enchanted: false, edge: 0.03, launch: 84,
  }),
  throwing_star: W({
    id: 'throwing_star', name: 'Chitin throwing star', cls: 'thrown', material: 'chitin', skill: 'marksman',
    reach: 0.3, mass: 0.3, speed: 0.5, chop: [2, 6], slash: [2, 6], thrust: [2, 6],
    twoHanded: false, enchanted: false, edge: 0.05, launch: 34,
  }),
};

export interface AmmoDef {
  id: string;
  name: string;
  material: WeaponMaterial;
  damage: readonly [number, number];
  mass: number;
  /** Metres. Arrows are long and thin; stars are neither. */
  length: number;
  /** Aerodynamic drag coefficient over mass, 1/m. Fletching costs range for accuracy. */
  drag: number;
  /** Fraction of speed retained when it bites into a surface rather than skips. */
  stick: number;
  enchanted: boolean;
}

export const AMMO: Readonly<Record<string, AmmoDef>> = {
  iron_arrow: { id: 'iron_arrow', name: 'Iron arrow', material: 'iron', damage: [4, 9], mass: 0.05, length: 0.74, drag: 0.0055, stick: 0.9, enchanted: false },
  steel_arrow: { id: 'steel_arrow', name: 'Steel arrow', material: 'steel', damage: [6, 13], mass: 0.055, length: 0.76, drag: 0.0052, stick: 0.92, enchanted: false },
  silver_arrow: { id: 'silver_arrow', name: 'Silver arrow', material: 'silver', damage: [7, 15], mass: 0.06, length: 0.75, drag: 0.0054, stick: 0.88, enchanted: false },
  chitin_arrow: { id: 'chitin_arrow', name: 'Chitin arrow', material: 'chitin', damage: [5, 11], mass: 0.04, length: 0.72, drag: 0.0044, stick: 0.8, enchanted: false },
  glass_arrow: { id: 'glass_arrow', name: 'Glass arrow', material: 'glass', damage: [9, 20], mass: 0.045, length: 0.73, drag: 0.0046, stick: 0.94, enchanted: true },
  star: { id: 'star', name: 'Throwing star', material: 'chitin', damage: [4, 10], mass: 0.12, length: 0.16, drag: 0.011, stick: 0.6, enchanted: false },
};

/* ------------------------------------------------------------ attack arcs */

export interface ArcDef {
  kind: AttackKind;
  /** Blade axis in aim space (+x right, +y up, +z forward) at the start of the live window. */
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  /** Hand offset along the blade axis at the start and end of the live window. */
  pushStart: number;
  pushEnd: number;
  /** Where the hand sits at rest and at the top of the windup, in aim space. */
  restOffset: readonly [number, number, number];
  windOffset: readonly [number, number, number];
  /**
   * Where the hand sits at the END of the live window, if that is not simply
   * back at `restOffset`. Defaults to `restOffset`.
   *
   * THIS IS THE ONLY FREE LEVER ON SWING FRAMING, and it is worth understanding
   * why, because everything else that looks like one is not. The tip is
   * `hand + blade * ( push + reach )`, so hand and tip are rigidly linked: any
   * change that lifts the hand out of the bottom of the frame lifts the tip out
   * of the creature by the same amount. Raising `to`, shortening `pushEnd` and
   * raising `restOffset` were all tried and all cost reach.
   *
   * Pushing the hand FORWARD does not. Screen height is `y / z`, so 25 cm of
   * extra depth raises a hand at y = -0.48 from -0.96 to -0.71 in half-screens
   * — a quarter of the frame — while `y` itself, and therefore how deep the tip
   * gets, is untouched. Forward reach goes UP rather than down. It is also what
   * an arm actually does at the bottom of a chop: it extends.
   */
  endOffset?: readonly [number, number, number];
  /** Seconds, before the weapon's speed multiplier. */
  windup: number;
  active: number;
  recover: number;
  /** Extra radius on the swept capsule. A chop forgives aim; a thrust does not. */
  forgive: number;
  /** Fraction of full damage carried at zero charge. */
  baseScale: number;
  /** Hit-stop and stagger weight relative to a slash. */
  impact: number;
}

/**
 * THE REST POSE — where the weapon hand sits when nothing is happening, in aim
 * space (+x right, +y up, +z forward from the eye).
 *
 * ONE SOURCE OF TRUTH. This used to be several constants in two files —
 * `REST_DIR` in `Melee`, `REST_BLADE`/`REST_ELBOW` in `Viewmodel` — kept in
 * step by a comment saying they had to match. When they drift, the arm rig and
 * the swing arc disagree about where the hand starts.
 *
 * EVERY NUMBER BELOW IS A SCREEN NUMBER. At 65 degrees vertical on 16:9 an
 * aim-space point projects to
 *     ndc = ( x / z / 1.133, y / z / 0.637 )
 * in half-screens from centre, and the pose was tuned by measuring the projected
 * bounding box of the gauntlet mesh in the live scene, not by eye. As authored
 * it lands the gauntlet at x 0.31..0.48, y -0.79..-0.28 — a quarter of the frame
 * height, wholly inside the lower-right quadrant, with the nearest part of it a
 * third of the screen away from the crosshair.
 *
 * The pose it replaced put the grip 0.62 m down the view axis with the blade
 * 78 per cent forward, so the camera looked STRAIGHT DOWN the hand: all a player
 * ever saw was the wrist cuff end-on with the knuckles hidden behind it. Eight
 * review rounds called that "the arm is a tube". It was never the geometry.
 */
export const REST_POSE = {
  /**
   * Where the grip sits. Closer than it was (0.55 m, not 0.62) because the hand
   * has to be big enough on screen to read as a hand.
   *
   * It came UP from -0.34. At -0.34 the hilt projected to y = -0.56 and the
   * cuff, which hangs a further 4 cm down the haft, ran off the bottom edge:
   * armour pixels on the last row of the frame, which reads as a clipping bug
   * and not as an arm. At -0.30 the gauntlet's own bounding box lands inside
   * y -0.78..-0.19 with the cuff lip clear of the edge, and the FOREARM — which
   * is meant to leave frame — is the only thing the bottom edge cuts.
   */
  hand: [0.35, -0.29, 0.51] as [number, number, number],
  /**
   * Unit blade direction: up, across the body, and only moderately away. The
   * forward component is the whole ball game — the hand's long axis is
   * perpendicular to the grip, so a blade aimed down the view axis is a hand
   * seen end-on. At 0.45 the fist is three-quarters on and the finger lames
   * wrapping the haft are in silhouette against the ground.
   */
  blade: [-0.24, 0.86, 0.45] as [number, number, number],
  /**
   * Wrist toward elbow. Mostly OUTBOARD and down, with only a little BACK: a
   * forearm aimed back at the lens foreshortens into a cone that widens as it
   * approaches, which is the other half of what read as a pipe. Out-and-down
   * instead, and MORE out than it was (0.72, not 0.52), because the measured
   * exit point matters: at 0.52 the forearm crossed y = -1 at x = 0.60, i.e.
   * straight down through the bottom edge two thirds of the way across, which
   * looks like the arm was cut off. At 0.72 it crosses at x = 0.80 — the
   * lower-right CORNER — and the length of the forearm is on screen the whole
   * way there.
   */
  elbow: [0.72, -0.66, -0.22] as [number, number, number],
  /**
   * WHICH FACE OF THE HAND THE PLAYER SEES IS NO LONGER SET HERE, and the fact
   * that it once was is worth a note rather than a constant.
   *
   * It lived here as `faceTh`, a wrap angle about the haft, and was consumed by
   * a roll SOLVED against `Viewmodel.WRIST_AXIS` and the aim-space elbow
   * reference — so it was a property of the weapon's frame and two other
   * frames, and never a property of the hand. Re-aiming `WRIST_AXIS` for the
   * cuff turned every gauntlet 97 degrees with nothing recording it, and the
   * last value it carried, 0.86, is a third of the way down the FINGER CURL:
   * the dorsal plate was edge on and the lens got the closed fingers. That is
   * what a player calls "the palm perspective", and no amount of re-tuning the
   * number could have fixed it, because the palm PADS were correctly measured
   * as facing away the whole time.
   *
   * The hand is now an ASSET in its own canonical space, frozen and verified in
   * isolation, and what it shows the lens is `Viewmodel.HAND_DORSAL_TH +
   * HAND_TWIST` — an asset constant plus one framing dial, both in the file
   * that owns the hand. `blade`, `hand` and `elbow` above are still shared with
   * `Melee` and still belong here; the hand's own attitude does not.
   */
};

/**
 * Morrowind chose the attack from your movement — walk forward and you thrust,
 * strafe and you slash, stand still and you chop. Keeping that mapping keeps
 * the muscle memory; the difference here is that the three arcs are visibly
 * different swings with different reach and different timing, so the choice is
 * legible rather than a hidden damage-table lookup.
 */
/**
 * Swing timings, seconds, before the per-weapon `speed` multiplier.
 *
 * Retuned after "attacking is slow". The old numbers were 0.20/0.24/0.30 of
 * windup and 0.26/0.30/0.34 of recovery, and — much worse — a released button
 * did nothing until the windup had run to full charge anyway (see
 * `Swing.advance`), so a TAP cost the entire windup before the blade began to
 * move: 300 ms of nothing for a chop. The windups below are the 0.15-0.25 s a
 * light attack is allowed, the button now cuts the windup short the instant it
 * comes up, and half the recovery is cancellable. Holding still charges to full
 * for the heavy blow.
 */
export const ARCS: Readonly<Record<AttackKind, ArcDef>> = {
  thrust: {
    kind: 'thrust',
    from: [0.06, -0.04, 1], to: [0, 0, 1],
    // `pushStart` came up from -0.28. A thrust cocks by pulling the hilt BACK
    // along a blade that points down the view axis, so -0.28 put the fist 0.34 m
    // from the eye and at y = -0.87 in half-screens: the bottom-right corner,
    // half of it under the edge, and the near half of it big enough to fill an
    // eighth of the frame. -0.18 keeps 10 cm of the cock — the thrust still
    // visibly loads — with the fist inside the frame the whole time.
    pushStart: -0.18, pushEnd: 0.7,
    restOffset: REST_POSE.hand, windOffset: [0.32, -0.10, 0.64],
    windup: 0.16, active: 0.10, recover: 0.17,
    forgive: 0.02, baseScale: 0.55, impact: 0.8,
  },
  // All three `windOffset`s below were re-tuned once there were arms attached to
  // the hand, and the numbers are screen positions, not taste: at 65 degrees
  // vertical and 16:9, the wound-up hilt used to project to (0.52, 1.68) for a
  // chop, (1.29, -0.21) for a slash and (4.0, -6.8) for a thrust in
  // half-screens from centre. Every one of them is outside the frame. That was
  // invisible when the only thing at the hand was a weapon seen end-on; with an
  // arm attached it is a bare forearm running off the edge of the screen with
  // nothing on the end of it, which is what the first capture of this showed.
  // A windup the player cannot see also telegraphs nothing, which is the other
  // half of the reason to move it.
  //
  // They were re-measured again after the review that reported "the swing
  // animation loses the arm entirely". Two of the three cocked poses put the
  // GAUNTLET — not just the hilt — outside the frustum: a chop cocked to
  // y = +0.49 with a 20 cm gauntlet hanging further up the blade cleared the
  // top edge, and a thrust cocked to y = -0.88 cleared the bottom one. The
  // three now land the hilt at (0.56, -0.15) chop, (0.73, -0.24) slash and
  // (0.61, -0.17) thrust, all with the whole hand a comfortable margin inside
  // the edges, and all still visibly cocked in three different directions.
  // Only the START of the live window moves; the push profile is untouched.
  slash: {
    kind: 'slash',
    from: [0.86, 0.34, 0.38], to: [-0.86, -0.2, 0.46],
    pushStart: 0.2, pushEnd: 0.2,
    restOffset: REST_POSE.hand, windOffset: [0.32, -0.16, 0.52],
    // A slash ends across the body and low, and `push` drags it lower still:
    // measured, the gauntlet's own box swept to y = -0.99 in half-screens for
    // the back half of the live window, i.e. the knuckles ON the bottom row of
    // pixels. Ending 6 cm higher and 4 cm further out keeps the whole hand
    // inside the lower-right quadrant for the entire arc. A slash is
    // horizontal, so unlike the chop this costs no vertical reach worth
    // measuring — the tip's height moves by the same 6 cm on a 1.1 m sword.
    endOffset: [0.33, -0.23, 0.55],
    windup: 0.18, active: 0.12, recover: 0.19,
    forgive: 0.07, baseScale: 0.5, impact: 1.0,
  },
  chop: {
    kind: 'chop',
    // DO NOT RAISE `to` TO KEEP THE HAND IN FRAME. It was tried, at -0.34, to
    // fix the review frame that caught the arm leaving the bottom edge, and it
    // is the one number here that cannot move: the tip lands at
    // `hand + to * (pushEnd + reach)`, so a shallower `to` is directly a
    // shorter and higher reach, and a chop at a kwama — a knee-high creature at
    // 1.6 m — stops connecting. Measured, and not by eye: the end-to-end
    // playthrough went from 2 hits in 8 swing cycles to 0, i.e. from PASS to
    // PARTIAL, on this number alone. The framing was fixed with `endOffset`
    // instead, which moves the hand without moving where the tip can reach.
    from: [-0.1, 0.92, 0.38], to: [0.06, -0.62, 0.78],
    pushStart: 0.18, pushEnd: 0.3,
    restOffset: REST_POSE.hand, windOffset: [0.38, -0.22, 0.50],
    // The chop is the only arc that needs one: it is the only one whose `to`
    // points steeply down, and it was measured leaving the frame at y = -1.26
    // for the back half of its live window — the whole hand under the edge.
    // 40 cm of extra depth puts the gauntlet's own bounding box back inside at
    // -0.85 without moving the tip's y by a millimetre, and buys 41 cm of extra
    // forward reach on the way: the playthrough's chop went from 2 hits in 8
    // swing cycles to 3.
    endOffset: [0.42, -0.29, 0.95],
    windup: 0.22, active: 0.13, recover: 0.21,
    forgive: 0.05, baseScale: 0.45, impact: 1.35,
  },
};

/* -------------------------------------------------------------- defences */

export interface ArmourDef {
  material: ArmourMaterial;
  /** Points of damage soaked at full condition, before region and skill terms. */
  rating: number;
  /**
   * 0..1 chance a glancing blow skates off instead of biting. Plate deflects;
   * cloth does not. This is what turns "you missed" into "it rang off his pauldron".
   */
  deflect: number;
  /** Impact signature: what the player hears and sees when a blow lands on it. */
  ring: 'flesh' | 'thud' | 'ring' | 'crack' | 'chime';
  /** Sparks only come off hard mineral and metal. */
  sparks: boolean;
}

const A = (d: ArmourDef): ArmourDef => d;

export const ARMOURS: Readonly<Record<ArmourMaterial, ArmourDef>> = {
  none: A({ material: 'none', rating: 0, deflect: 0.0, ring: 'flesh', sparks: false }),
  cloth: A({ material: 'cloth', rating: 1, deflect: 0.02, ring: 'flesh', sparks: false }),
  fur: A({ material: 'fur', rating: 3, deflect: 0.05, ring: 'thud', sparks: false }),
  hide: A({ material: 'hide', rating: 5, deflect: 0.09, ring: 'thud', sparks: false }),
  leather: A({ material: 'leather', rating: 8, deflect: 0.12, ring: 'thud', sparks: false }),
  shell: A({ material: 'shell', rating: 14, deflect: 0.3, ring: 'crack', sparks: true }),
  chitin: A({ material: 'chitin', rating: 18, deflect: 0.34, ring: 'crack', sparks: true }),
  bonemold: A({ material: 'bonemold', rating: 24, deflect: 0.3, ring: 'crack', sparks: false }),
  iron: A({ material: 'iron', rating: 26, deflect: 0.42, ring: 'ring', sparks: true }),
  steel: A({ material: 'steel', rating: 34, deflect: 0.48, ring: 'ring', sparks: true }),
  silver: A({ material: 'silver', rating: 38, deflect: 0.46, ring: 'chime', sparks: true }),
  glass: A({ material: 'glass', rating: 48, deflect: 0.55, ring: 'chime', sparks: true }),
  ebony: A({ material: 'ebony', rating: 58, deflect: 0.6, ring: 'ring', sparks: true }),
  daedric: A({ material: 'daedric', rating: 72, deflect: 0.66, ring: 'ring', sparks: true }),
};

/** Where a blow lands matters more than what swung it. */
export const REGION_DAMAGE: Readonly<Record<BodyRegion, number>> = {
  head: 2.1,
  torso: 1.0,
  arm: 0.72,
  leg: 0.68,
  tail: 0.55,
  wing: 0.6,
};

/** Armour covers the torso best and the extremities worst. */
export const REGION_ARMOUR: Readonly<Record<BodyRegion, number>> = {
  head: 0.9,
  torso: 1.15,
  arm: 0.8,
  leg: 0.8,
  tail: 0.4,
  wing: 0.25,
};

/**
 * Bone-name prefix to body region. The actor rigs name their chains
 * `spine/chest/neck/head/crown/abdomen/tail<n>/<leg>.a|b|c/wing.*`, so region
 * detection is a prefix match against the nearest bone rather than a per-species
 * hitbox authoring pass.
 */
export const BONE_REGIONS: readonly { readonly match: string; readonly region: BodyRegion }[] = [
  { match: 'crown', region: 'head' },
  { match: 'head', region: 'head' },
  { match: 'neck', region: 'head' },
  { match: 'probo', region: 'head' },
  { match: 'jaw', region: 'head' },
  { match: 'tail', region: 'tail' },
  { match: 'wing', region: 'wing' },
  { match: 'arm', region: 'arm' },
  { match: 'hand', region: 'arm' },
  { match: 'bell', region: 'torso' },
  { match: 'chest', region: 'torso' },
  { match: 'spine', region: 'torso' },
  { match: 'abdomen', region: 'torso' },
  { match: 'root', region: 'torso' },
];

/* --------------------------------------------------- material interaction */

/**
 * Hardness tier. A blow from a weapon two tiers under the armour it strikes is
 * far more likely to skate off, and grinds the weapon's condition down faster —
 * which is why an iron dagger against ebony plate is a losing proposition and
 * the player works that out without being told.
 */
export const MATERIAL_TIER: Readonly<Record<WeaponMaterial, number>> = {
  flesh: 0, wood: 1, chitin: 2, iron: 3, bonemold: 3, steel: 4, silver: 4, dwemer: 5, glass: 6, ebony: 7, daedric: 8,
};

export const ARMOUR_TIER: Readonly<Record<ArmourMaterial, number>> = {
  none: 0, cloth: 0, fur: 1, hide: 1, leather: 2, shell: 2, chitin: 2, bonemold: 3, iron: 3, steel: 4, silver: 4, glass: 6, ebony: 7, daedric: 8,
};

/**
 * The rule that makes a silver weapon worth carrying: some things simply cannot
 * be hurt by ordinary metal. `mundane` is the multiplier applied to a weapon
 * that is neither silver nor enchanted — at 0 the blade passes through with a
 * cold ripple and the player learns what they need to go and find.
 */
export interface ResistanceDef {
  mundane: number;
  silver: number;
  enchanted: number;
  /** Blunt trauma against a shell is a different proposition to a blade. */
  blunt: number;
  slice: number;
  pierce: number;
}

const R = (d: ResistanceDef): ResistanceDef => d;

const FLESH = R({ mundane: 1, silver: 1, enchanted: 1, blunt: 1, slice: 1, pierce: 1 });

export const RESISTANCE: Readonly<Record<string, ResistanceDef>> = {
  default: FLESH,
  // Chitinous things shrug off cuts and hate being hit with a hammer.
  kwama: R({ mundane: 1, silver: 1, enchanted: 1, blunt: 1.35, slice: 0.7, pierce: 0.95 }),
  nixhound: R({ mundane: 1, silver: 1, enchanted: 1, blunt: 1.2, slice: 0.85, pierce: 1.0 }),
  cliffracer: R({ mundane: 1, silver: 1, enchanted: 1, blunt: 0.9, slice: 1.15, pierce: 1.1 }),
  // A netch's gasbag is a bad target for a spear and a fine one for a blade.
  netch: R({ mundane: 1, silver: 1, enchanted: 1.2, blunt: 0.75, slice: 1.25, pierce: 0.6 }),
  siltstrider: R({ mundane: 1, silver: 1, enchanted: 1, blunt: 1.3, slice: 0.6, pierce: 0.8 }),
  // The old rule, kept exactly: the restless dead do not care about steel.
  ghost: R({ mundane: 0, silver: 1, enchanted: 1, blunt: 1, slice: 1, pierce: 1 }),
  ancestorghost: R({ mundane: 0, silver: 1, enchanted: 1, blunt: 1, slice: 1, pierce: 1 }),
  wraith: R({ mundane: 0, silver: 1.15, enchanted: 1, blunt: 1, slice: 1, pierce: 1 }),
  bonewalker: R({ mundane: 0.35, silver: 1.3, enchanted: 1.2, blunt: 1.4, slice: 0.5, pierce: 0.4 }),
  skeleton: R({ mundane: 0.6, silver: 1.1, enchanted: 1.1, blunt: 1.6, slice: 0.4, pierce: 0.35 }),
  daedra: R({ mundane: 0.5, silver: 1, enchanted: 1.35, blunt: 1, slice: 1, pierce: 1 }),
};

/** Which damage channel each weapon class delivers, for the resistance table. */
export const CLASS_CHANNEL: Readonly<Record<WeaponClass, 'blunt' | 'slice' | 'pierce'>> = {
  shortblade: 'slice',
  longblade: 'slice',
  blunt: 'blunt',
  axe: 'slice',
  spear: 'pierce',
  marksman: 'pierce',
  thrown: 'pierce',
  handtohand: 'blunt',
};

/* -------------------------------------------------------- creature combat */

export type FightStyle = 'brawler' | 'dive' | 'leap' | 'charge' | 'drift';

export interface CreatureCombat {
  /** 0..1. How readily it starts a fight it was not offered. */
  aggression: number;
  /** 0..1. Below this fraction of health it breaks and runs. */
  breakAt: number;
  /** 0..1 chance per opening that it feints instead of committing. */
  feint: number;
  /** 0..1 chance it raises a guard when the player winds up. */
  guard: number;
  /** Metres at which it will commit to a strike, from body surface. */
  reach: number;
  /** Metres at which it notices a hostile. */
  notice: number;
  windup: number;
  active: number;
  recover: number;
  damage: readonly [number, number];
  style: FightStyle;
  armour: ArmourMaterial;
  /** Body mass proxy in kg, for knockback, stagger resistance and ragdoll. */
  mass: number;
  /** Speed of the committed lunge/dive/leap, m/s. */
  lunge: number;
  /** Seconds it will hold off between committed attacks. */
  cadence: number;
  /** Calls nearby allies of the same faction into the fight. */
  callsAllies: boolean;
  /** Carries a bow and will use it at range, leading a moving target. */
  ranged: boolean;
}

const C = (d: CreatureCombat): CreatureCombat => d;

export const CREATURE_DEFAULT: CreatureCombat = C({
  aggression: 0.4, breakAt: 0.25, feint: 0.1, guard: 0.15, reach: 1.4, notice: 24,
  windup: 0.42, active: 0.16, recover: 0.5, damage: [3, 9], style: 'brawler',
  armour: 'hide', mass: 90, lunge: 5, cadence: 1.3, callsAllies: false, ranged: false,
});

export const CREATURES: Readonly<Record<string, CreatureCombat>> = {
  // Dives from altitude, hits once, and is gone before you can answer — the
  // single most recognisable combat pattern in the whole province.
  cliffracer: C({
    aggression: 0.95, breakAt: 0.12, feint: 0.25, guard: 0.02, reach: 1.5, notice: 55,
    windup: 0.3, active: 0.14, recover: 1.5, damage: [3, 8], style: 'dive',
    armour: 'shell', mass: 26, lunge: 22, cadence: 2.6, callsAllies: true, ranged: false,
  }),
  nixhound: C({
    aggression: 0.85, breakAt: 0.2, feint: 0.3, guard: 0.1, reach: 1.9, notice: 34,
    windup: 0.34, active: 0.14, recover: 0.62, damage: [5, 13], style: 'leap',
    armour: 'chitin', mass: 70, lunge: 12, cadence: 1.0, callsAllies: true, ranged: false,
  }),
  guar: C({
    aggression: 0.2, breakAt: 0.35, feint: 0.05, guard: 0.2, reach: 2.3, notice: 26,
    windup: 0.55, active: 0.2, recover: 0.9, damage: [8, 18], style: 'charge',
    armour: 'hide', mass: 420, lunge: 9, cadence: 2.2, callsAllies: false, ranged: false,
  }),
  kwama: C({
    aggression: 0.7, breakAt: 0.15, feint: 0.08, guard: 0.05, reach: 1.2, notice: 18,
    windup: 0.3, active: 0.12, recover: 0.44, damage: [3, 8], style: 'brawler',
    armour: 'chitin', mass: 45, lunge: 6, cadence: 0.9, callsAllies: true, ranged: false,
  }),
  netch: C({
    aggression: 0.15, breakAt: 0.3, feint: 0.0, guard: 0.0, reach: 3.2, notice: 30,
    windup: 0.9, active: 0.3, recover: 1.4, damage: [10, 22], style: 'drift',
    armour: 'hide', mass: 900, lunge: 3, cadence: 3.0, callsAllies: false, ranged: false,
  }),
  siltstrider: C({
    aggression: 0.02, breakAt: 0.05, feint: 0, guard: 0, reach: 6, notice: 40,
    windup: 1.4, active: 0.4, recover: 2.4, damage: [14, 30], style: 'charge',
    armour: 'shell', mass: 9000, lunge: 4, cadence: 4, callsAllies: false, ranged: false,
  }),
  dunmer: C({
    aggression: 0.3, breakAt: 0.3, feint: 0.35, guard: 0.55, reach: 1.8, notice: 30,
    windup: 0.4, active: 0.16, recover: 0.55, damage: [4, 14], style: 'brawler',
    armour: 'bonemold', mass: 78, lunge: 6.5, cadence: 1.1, callsAllies: true, ranged: true,
  }),
};

/* ------------------------------------------------------- damage over time */

export type DotKind = 'bleed' | 'poison' | 'burn' | 'frostbite' | 'blight';

export interface DotDef {
  kind: DotKind;
  /** Damage per second at one stack. */
  rate: number;
  seconds: number;
  /** Stacks beyond this are refreshed rather than added. */
  maxStacks: number;
  /** VFX school name passed to the vfx system on each tick. */
  vfx: string;
  /** Multiplier on the victim's movement while it runs. */
  slow: number;
}

export const DOTS: Readonly<Record<DotKind, DotDef>> = {
  bleed: { kind: 'bleed', rate: 1.6, seconds: 6, maxStacks: 4, vfx: 'impact', slow: 1 },
  poison: { kind: 'poison', rate: 2.2, seconds: 10, maxStacks: 3, vfx: 'illusion', slow: 0.9 },
  burn: { kind: 'burn', rate: 4.0, seconds: 4, maxStacks: 3, vfx: 'fire', slow: 1 },
  frostbite: { kind: 'frostbite', rate: 1.8, seconds: 7, maxStacks: 3, vfx: 'frost', slow: 0.7 },
  blight: { kind: 'blight', rate: 1.0, seconds: 60, maxStacks: 1, vfx: 'illusion', slow: 0.95 },
};

/* ------------------------------------------------------ blocking tuning */

export interface ShieldDef {
  id: string;
  name: string;
  material: ArmourMaterial;
  /** Half-angle of the block cone, radians. A shield covers more than a blade. */
  arc: number;
  /** Fraction of incoming damage removed on a plain block. */
  soak: number;
  /** Stagger dealt back to the attacker on a perfect parry. */
  riposte: number;
  mass: number;
}

export const SHIELDS: Readonly<Record<string, ShieldDef>> = {
  none: { id: 'none', name: 'Nothing', material: 'none', arc: 0.5, soak: 0.25, riposte: 0.35, mass: 0 },
  // A weapon parry covers a narrow line but throws the attacker hard off it.
  parry: { id: 'parry', name: 'Weapon', material: 'steel', arc: 0.62, soak: 0.55, riposte: 1.0, mass: 2 },
  wooden_shield: { id: 'wooden_shield', name: 'Wooden shield', material: 'leather', arc: 1.15, soak: 0.7, riposte: 0.45, mass: 4 },
  chitin_towershield: { id: 'chitin_towershield', name: 'Chitin tower shield', material: 'chitin', arc: 1.4, soak: 0.86, riposte: 0.5, mass: 9 },
  ebony_shield: { id: 'ebony_shield', name: 'Ebony shield', material: 'ebony', arc: 1.25, soak: 0.94, riposte: 0.7, mass: 7 },
};

/** Seconds after raising a guard during which a block becomes a true parry. */
export const PARRY_WINDOW = 0.26;
/** Seconds of stagger applied per unit of riposte. */
export const STAGGER_PER_RIPOSTE = 0.7;
/** Fatigue cost table, in points. Fatigue is what makes a long fight go badly. */
export const FATIGUE_COST = { swing: 4.5, block: 2.5, parry: 1.0, hit: 3.0, sprint: 1.2 } as const;

/* --------------------------------------------------------- rigid clutter */

export interface ClutterDef {
  id: string;
  /** Which synthesized PBR set dresses it. */
  material: string;
  /** Convex hull kind used for both the draw mesh and the collision proxy. */
  shape: 'urn' | 'crate' | 'shard' | 'plank' | 'pot';
  size: number;
  mass: number;
  /** Impact energy in joules that breaks it. Infinity is indestructible. */
  toughness: number;
  /** How many debris chunks it throws when it breaks. */
  shards: number;
  ring: ArmourDef['ring'];
}

export const CLUTTER: Readonly<Record<string, ClutterDef>> = {
  urn: { id: 'urn', material: 'plaster', shape: 'urn', size: 0.34, mass: 6, toughness: 22, shards: 7, ring: 'crack' },
  pot: { id: 'pot', material: 'plaster', shape: 'pot', size: 0.26, mass: 3.5, toughness: 14, shards: 5, ring: 'crack' },
  crate: { id: 'crate', material: 'wood_weathered', shape: 'crate', size: 0.42, mass: 22, toughness: 90, shards: 6, ring: 'thud' },
  shard: { id: 'shard', material: 'pumice', shape: 'shard', size: 0.13, mass: 0.7, toughness: Infinity, shards: 0, ring: 'thud' },
  plank: { id: 'plank', material: 'wood_weathered', shape: 'plank', size: 0.3, mass: 2.4, toughness: Infinity, shards: 0, ring: 'thud' },
};

/** Restitution and friction per terrain surface index (see core Surface enum). */
export const SURFACE_PHYSICS: readonly { readonly bounce: number; readonly friction: number }[] = [
  { bounce: 0.06, friction: 0.62 }, // ash — everything dies in it
  { bounce: 0.34, friction: 0.34 }, // rock
  { bounce: 0.08, friction: 0.58 }, // sand
  { bounce: 0.18, friction: 0.5 },  // grass
  { bounce: 0.04, friction: 0.74 }, // mud
  { bounce: 0.2, friction: 0.44 },  // lava crust
  { bounce: 0.12, friction: 0.4 },  // snow
  { bounce: 0.38, friction: 0.3 },  // stone
];
