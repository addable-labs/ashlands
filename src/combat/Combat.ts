import * as THREE from 'three';
import type { IMaterials, ITerrain } from '../core/contracts';
import type { Ctx, System, TerrainQuery } from '../core/types';
import { CombatAI, type AiSense, type Dot, type Fighter } from './Ai';
import { BodyWorld, type BreakHandler } from './Bodies';
import { Feedback, type PlayerLike } from './Feedback';
import { buildWeapon, VIEWMODEL_DEPTH, VIEWMODEL_NO_PREPASS, type WeaponMesh } from './Gear';
import { Viewmodel, type ViewmodelFrame } from './Viewmodel';
import { attackFromMovement, Guard, Swing, type AimBasis, type SwingPose } from './Melee';
import { leadShot, Projectiles, type PlayerBody, type ProjectileHit } from './Projectiles';
import { resolve, Rpg, shieldOf, type Defence, type AttackRoll, type Resolution } from './Resolve';
import { Ragdoll } from './Ragdoll';
import { TargetIndex, type ActorLike } from './Targets';
import {
  AMMO,
  ARCS,
  ARMOURS,
  CLUTTER,
  CREATURE_DEFAULT,
  FATIGUE_COST,
  WEAPONS,
  type AmmoDef,
  type ArmourMaterial,
  type AttackKind,
  type BodyRegion,
  type CreatureCombat,
  type WeaponDef,
} from './Tables';
import { clamp, closestSegSeg, Rand } from './mathx';

/**
 * ASHLANDS — combat and physics.
 *
 * The design problem this subsystem exists to solve: Morrowind's combat is the
 * most criticised thing about an otherwise beloved game, and the criticism is
 * almost entirely about *legibility*, not about the underlying rules. Swinging
 * a blade through a mudcrab and being told nothing happened is what people
 * remember. The rules themselves — that skill matters, that fatigue matters,
 * that a silver weapon is the answer to a specific problem, that the world is
 * as dangerous as it is regardless of your level — are what made it an Elder
 * Scrolls game.
 *
 * So the substrate is kept and the presentation is rebuilt:
 *
 *  - Every swing is a real swept volume along the weapon's real arc. If the
 *    blade passed through a body, the code tested that body.
 *  - Every resolution produces a visible, audible event. A failed roll is a
 *    parry, a deflection with sparks and a ring, a dodge, or a graze — never
 *    silence. `Resolve.ts` has no branch that returns nothing.
 *  - Weight is communicated physically: hit-stop on the combat clock, camera
 *    shake scaled by impact and distance, stagger, knockback, and a ragdoll
 *    that blends out of the animated pose rather than replacing it.
 *  - Ranged weapons are ballistic, not hitscan, so leading a target is a skill
 *    the player has rather than a number the game rolls.
 *
 * Ordering: 110, immediately after actors (100) and before VFX (120). Actors
 * have posed their skeletons by then — combat reads those bones for hit volumes
 * and writes ragdoll poses over them — and VFX has not yet consumed the frame's
 * spawn requests.
 */

/**
 * Weapons the player can cycle with the number row. Bare hands are a real
 * weapon with a real skill behind them, so they get a slot rather than being
 * the thing that happens when nothing is equipped.
 */
const LOADOUT: readonly string[] = [
  'iron_broadsword',
  'chitin_spear',
  'chitin_warhammer',
  'silver_longsword',
  'glass_dagger',
  'chitin_bow',
  'fists',
];

const THROWN = 'throwing_star';

/** Pre-built so the weapon-select scan does not build six strings every frame. */
const DIGIT_CODES: readonly string[] = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'];

/** How far from the hand a swing can possibly reach, for broad-phase culling. */
const BROAD_PHASE_PAD = 2.5;
const MAX_RAGDOLLS = 4;

interface Ammo {
  id: string;
  count: number;
}

interface Snapshot {
  v: 1;
  weapon: number;
  armour: ArmourMaterial;
  shield: string;
  ammo: Ammo[];
  seed: number;
  rpg: Record<string, number>;
  bodies: number[][];
  shots: number[][];
  fighters: number[][];
  clutterPlaced: boolean;
}

const _aim: AimBasis = {
  origin: new THREE.Vector3(),
  forward: new THREE.Vector3(0, 0, -1),
  right: new THREE.Vector3(1, 0, 0),
  up: new THREE.Vector3(0, 1, 0),
};
const _pose: SwingPose = { hilt: new THREE.Vector3(), tip: new THREE.Vector3(), axis: new THREE.Vector3() };
const _prevPose: SwingPose = { hilt: new THREE.Vector3(), tip: new THREE.Vector3(), axis: new THREE.Vector3() };
const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _face = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _eye = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _playerBody: PlayerBody = { base: new THREE.Vector3(), top: new THREE.Vector3(), radius: 0.4 };

export class CombatSystem implements System {
  readonly id = 'combat';
  readonly order = 110;
  /**
   * Combat is authoritative for the player's swing, block and ranged attack.
   * Announced on the bus at init as 'combat:ready' so any other system reading
   * the attack button can stand down rather than resolving the same blow twice.
   */
  readonly ownsMelee = true;

  private targets = new TargetIndex();
  private ai = new CombatAI();
  private bodies = new BodyWorld();
  private shots = new Projectiles();
  private feedback = new Feedback();
  private rpg = new Rpg();
  private rand = new Rand(0x9e3779b1);

  private terrain: ITerrain | null = null;
  private mats: IMaterials | null = null;
  private player: PlayerLike | null = null;

  private weaponIndex = 0;
  private weapon: WeaponDef = WEAPONS[LOADOUT[0]];
  private visual: WeaponMesh | null = null;
  private visuals = new Map<string, WeaponMesh>();
  private group = new THREE.Group();
  private viewmodel: Viewmodel | null = null;
  private readonly vmFrame: ViewmodelFrame = {
    origin: new THREE.Vector3(),
    right: new THREE.Vector3(),
    up: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    handPos: new THREE.Vector3(),
    handQuat: new THREE.Quaternion(),
    weapon: WEAPONS[LOADOUT[0]],
    shield: shieldOf('wooden_shield'),
    guard: 0,
    swinging: false,
    draw: 0,
  };
  /** Whether the held weapon currently casts. See driveVisual. */
  private weaponCasts = true;
  /**
   * Whether the held weapon is currently opted out of the depth prepass, or
   * null when the answer is not known for the visual now equipped. Cleared on
   * every equip, because the flag lives on the mesh and the mesh has changed.
   */
  private weaponBanded: boolean | null = null;

  private swing = new Swing(WEAPONS[LOADOUT[0]]);
  private guard = new Guard(shieldOf('wooden_shield'));
  private armour: ArmourMaterial = 'leather';
  private playerStagger = 0;
  private attackHeld = false;
  private throwHeld = false;
  private ammo: Ammo[] = [
    { id: 'iron_arrow', count: 40 },
    { id: 'chitin_arrow', count: 20 },
    { id: 'star', count: 12 },
  ];

  private ragdolls: Ragdoll[] = [];
  private candidates: ActorLike[] = [];
  private creatureWeapons = new Map<string, WeaponDef>();
  private ammoWeapons = new Map<string, WeaponDef>();
  private clutterPlaced = false;
  private offSave: (() => void)[] = [];

  /**
   * The frame's context, parked so the hot-loop callbacks below can be built
   * once at construction instead of re-closing over `ctx` on every update().
   */
  private ctx: Ctx | null = null;

  /** Reused AI input record — one object for the lifetime of the system. */
  private readonly sense: AiSense = {
    dt: 0,
    now: 0,
    targetPos: new THREE.Vector3(),
    targetVel: new THREE.Vector3(),
    targetValid: false,
    terrain: null,
  };

  private readonly onProjectileHit = (
    ammo: AmmoDef,
    ownerId: number,
    skill: number,
    draw: number,
    hit: ProjectileHit,
  ): boolean => {
    const ctx = this.ctx;
    // No frame context means the shot cannot be resolved; retire it rather than
    // leaving it to fly through the world untested.
    if (ctx === null) return true;
    return this.projectileHit(ctx, ammo, ownerId, skill, draw, hit);
  };

  private readonly onBodyBreak: BreakHandler = (at, energy, def) => {
    const ctx = this.ctx;
    if (ctx === null) return;
    this.feedback.thud(ctx, at, energy, def.material, true);
    ctx.bus.emit('notify', { text: `The ${def.id} shatters`, kind: 'info' });
  };

  /** Live counters for the perf HUD and for reporting the budget. */
  readonly stats = { bodies: 0, awake: 0, shots: 0, ragdolls: 0, hits: 0, swings: 0 };

  async init(ctx: Ctx): Promise<void> {
    this.mats = ctx.get<IMaterials>('materials') ?? null;
    this.terrain = ctx.get<ITerrain>('terrain') ?? null;
    this.rpg.bind(ctx.get('rpg'));

    this.group.name = 'combat';
    ctx.scene.add(this.group);

    this.bodies.build(this.mats);
    this.shots.build(this.mats);
    this.group.add(this.bodies.group, this.shots.group);

    // The first-person arms. They live in the scene, not on the camera, so the
    // prepass sees honest world-space motion for them and TAA resolves them
    // without smearing.
    const vm = new Viewmodel(this.mats);
    vm.refresh(ctx.get('rpg'));
    vm.setShield(this.guard.shield);
    this.viewmodel = vm;
    this.group.add(vm.group);

    // Static collision for rigid bodies: whatever the architecture system put
    // in the scene. Looked up by name so combat never imports it.
    const arch = ctx.scene.getObjectByName('architecture');
    if (arch !== undefined) this.bodies.setStatics([arch]);

    this.equip(0);
    // Combat owns the player's melee, ranged and block input. Anything else
    // that reads mouse-1 as an attack must defer to this.
    ctx.bus.emit('combat:ready', { ownsMelee: true, ownsRanged: true, ownsBlock: true });

    this.ai.onStrike = (a, f) => this.creatureStrike(ctx, a, f);
    this.ai.onDot = (a, f, d, amount) => this.dotTick(ctx, a, f, d, amount);
    this.ai.onLoose = (a, f) => this.creatureLoose(ctx, a, f);

    this.offSave.push(
      ctx.bus.on<{ data: Record<string, unknown> }>('save:collect', (p) => {
        if (p?.data) p.data.combat = this.serialize();
      }),
    );
    this.offSave.push(
      ctx.bus.on<{ data: Record<string, unknown> }>('save:apply', (p) => {
        const s = p?.data?.combat;
        if (s !== undefined) this.deserialize(s as Snapshot);
      }),
    );
    this.offSave.push(
      ctx.bus.on<{ kind: string; x: number; y: number; z: number }>('combat:clutter', (p) => {
        if (p === undefined || CLUTTER[p.kind] === undefined) return;
        this.bodies.spawn(p.kind, _v.set(p.x, p.y, p.z), null);
      }),
    );
  }

  /* ----------------------------------------------------------- equipment */

  equip(index: number): void {
    this.weaponIndex = clamp(index, 0, LOADOUT.length - 1) | 0;
    const def = WEAPONS[LOADOUT[this.weaponIndex]] ?? WEAPONS.fists;
    this.weapon = def;
    this.swing.weapon = def;
    let vis = this.visuals.get(def.id);
    if (vis === undefined) {
      vis = buildWeapon(def, this.mats);
      this.visuals.set(def.id, vis);
      this.group.add(vis.object);
    }
    if (this.visual !== null && this.visual !== vis) this.visual.object.visible = false;
    this.visual = vis;
    vis.object.visible = true;
    // The prepass opt-out is a per-mesh flag and these are different meshes.
    this.weaponBanded = null;
    this.applyWeaponShadows();
    // Changing weapons is also when a gauntlet or a sleeve is most likely to
    // have changed, and re-reading the character sheet is a few property gets.
    const vm = this.viewmodel;
    if (vm !== null && this.ctx !== null) vm.refresh(this.ctx.get('rpg'));
  }

  /** Swap the shield the guard uses, and the one drawn on the off arm with it. */
  setShield(id: string): void {
    this.guard.shield = shieldOf(id);
    this.viewmodel?.setShield(this.guard.shield);
  }

  private applyWeaponShadows(): void {
    const cast = this.weaponCasts;
    for (const v of this.visuals.values()) {
      v.object.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = cast;
      });
    }
  }

  private ammoFor(w: WeaponDef): Ammo | null {
    const want = w.cls === 'thrown' ? 'star' : w.material === 'chitin' ? 'chitin_arrow' : 'iron_arrow';
    const exact = this.ammo.find((a) => a.id === want && a.count > 0);
    if (exact !== undefined) return exact;
    return this.ammo.find((a) => a.count > 0 && (w.cls === 'thrown') === (a.id === 'star')) ?? null;
  }

  /* --------------------------------------------------------------- frame */

  update(ctx: Ctx): void {
    const raw = ctx.time.dt;
    if (raw <= 0) return;
    this.ctx = ctx;
    this.feedback.bind(ctx);
    this.feedback.frameStart();
    const dt = this.feedback.scaledDt(raw);

    if (this.terrain === null) this.terrain = ctx.get<ITerrain>('terrain') ?? null;
    this.player = this.feedback.playerSystem;
    this.targets.bind(ctx);
    this.rpg.tick(raw);

    this.stepViewmodel(ctx, raw);
    this.updateAim(ctx);
    const wasLive = this.swing.live;
    this.readInput(ctx, dt);

    this.playerStagger = Math.max(0, this.playerStagger - dt);
    this.swing.advance(dt, this.attackHeld);
    // A swing is counted when it goes live, not when the button goes down: a
    // windup the player holds and cancels never became a swing.
    if (this.swing.live && !wasLive) this.stats.swings++;
    if (this.swing.sweeping) this.sweep(ctx);
    this.driveVisual(dt);

    this.updateAi(ctx, dt);

    this.shots.step(dt, this.terrain, this.targets, ctx.time.frame, this.onProjectileHit, this.playerBody());
    this.bodies.step(dt, this.terrain, this.onBodyBreak);
    this.stepRagdolls(dt);
    this.placeClutter(ctx);

    this.stats.bodies = this.bodies.count;
    this.stats.awake = this.bodies.awake;
    this.stats.shots = this.shots.count;
    this.stats.ragdolls = this.ragdolls.length;
  }

  /** Aim basis: the camera decides where the blade goes, in both view modes. */
  private updateAim(ctx: Ctx): void {
    ctx.camera.getWorldDirection(_aim.forward);
    _aim.right.copy(_aim.forward).cross(_up);
    if (_aim.right.lengthSq() < 1e-6) _aim.right.set(1, 0, 0);
    _aim.right.normalize();
    _aim.up.copy(_aim.right).cross(_aim.forward).normalize();

    const p = this.player;
    if (p !== null && p.view === 'third') {
      // Third person: the hand is on the body, not at the camera, or the sword
      // hangs in front of the lens like a UI element.
      _aim.origin.copy(p.position);
      _aim.origin.y += 1.36;
      _aim.origin.addScaledVector(_aim.forward, 0.15);
    } else {
      _aim.origin.copy(ctx.camera.position);
      // Idle motion is added to the ANCHOR, not to the drawing. A sway applied
      // to the mesh alone would be exactly the drift between what is drawn and
      // what is tested that this system is built to make impossible; applied
      // here, the hand, the blade, the arm and the swept capsule all move
      // together, and the swing is tested wherever the hand actually is.
      const vm = this.viewmodel;
      if (vm !== null && !this.freeCam()) {
        _aim.origin
          .addScaledVector(_aim.right, vm.offset.x)
          .addScaledVector(_aim.up, vm.offset.y)
          .addScaledVector(_aim.forward, vm.offset.z);
      }
    }
    _eye.copy(p !== null ? p.position : ctx.camera.position);
    if (p !== null) _eye.y += 1.5;
  }

  /** True when nothing may be drawn at the lens: the screenshot camera is up. */
  private freeCam(): boolean {
    const p = this.player;
    return p === null || p.freefly === true;
  }

  /**
   * Advance the viewmodel's idle motion for the frame. Runs on the RAW clock:
   * hit-stop is a property of the blow, and a breathing sway that stutters
   * every time a warhammer connects reads as a dropped frame.
   */
  private stepViewmodel(ctx: Ctx, raw: number): void {
    const vm = this.viewmodel;
    if (vm === null) return;
    const p = this.player;
    const first = p !== null && p.view === 'first' && !p.freefly;
    if (!first) {
      vm.offset.set(0, 0, 0);
      return;
    }
    ctx.camera.getWorldDirection(_v);
    const yaw = Math.atan2(_v.x, _v.z);
    const pitch = Math.asin(clamp(_v.y, -1, 1));
    const speed = Math.hypot(p.velocity.x, p.velocity.z);
    vm.step(raw, yaw, pitch, speed, p.grounded, p.velocity.y);
  }

  private readInput(ctx: Ctx, dt: number): void {
    const input = ctx.input;
    // Before pointer lock the first click is the player asking for the mouse,
    // not asking to swing; and with the free camera up there is no body to
    // swing with, so combat input is suspended entirely.
    const armed = input.pointerLocked && this.player !== null && !this.player.freefly;
    if (!armed) {
      // Releasing the button while unarmed must not fire the swing that was
      // being held when the camera detached.
      this.attackHeld = false;
      this.throwHeld = false;
      this.guard.set(false, dt);
      return;
    }

    for (let i = 0; i < LOADOUT.length; i++) {
      if (input.pressed.has(DIGIT_CODES[i])) {
        this.equip(i);
        ctx.bus.emit('notify', { text: this.weapon.name, kind: 'info' });
      }
    }

    const attack = armed && input.buttons.has(0);
    const block = armed && input.buttons.has(2);

    this.guard.set(block && this.playerStagger <= 0, dt);

    const fwd = (input.held.has('KeyW') ? 1 : 0) - (input.held.has('KeyS') ? 1 : 0);
    const strafe = (input.held.has('KeyD') ? 1 : 0) - (input.held.has('KeyA') ? 1 : 0);

    // `ready`, not `!busy`: the back half of a recovery is cancellable, so a
    // player who taps twice gets two swings rather than one swing and a
    // swallowed input.
    if (attack && !this.attackHeld && this.swing.ready && this.playerStagger <= 0 && !block) {
      const kind: AttackKind = this.weapon.cls === 'marksman' ? 'thrust' : attackFromMovement(fwd, strafe);
      this.swing.begin(kind, this.weapon);
      // Winding up in front of a wary creature is what makes it raise a guard.
      this.ai.telegraph(this.targets, _eye, 6);
    }
    // A melee swing is NOT released here. `Swing.advance` sees the button state
    // for this frame and runs the last of the windup at the snap rate, so the
    // pose finishes travelling instead of teleporting to the cocked position.
    // A bow has no arc to finish and looses on the frame the button comes up.
    if (!attack && this.attackHeld && this.swing.phase === 'wind' && this.weapon.cls === 'marksman') {
      this.loose(ctx);
    }
    this.attackHeld = attack;

    const throwNow = armed && input.pressed.has('KeyF');
    if (throwNow && !this.throwHeld) this.throwWeapon(ctx);
    this.throwHeld = throwNow;
  }

  /* ---------------------------------------------------------------- melee */

  /**
   * The swept test. The blade is re-posed at up to eight intermediate points
   * between last frame's arc parameter and this frame's, and each pose is a
   * capsule tested against every candidate body capsule. This is the reason a
   * fast swing cannot pass through a target, and the reason a spear tip that
   * visibly clears a nix-hound's back does not register.
   */
  private sweep(ctx: Ctx): void {
    const frame = ctx.time.frame;
    const arc = ARCS[this.swing.kind];
    const radius = this.weapon.edge + arc.forgive;

    // The tested interval is this frame's motion clipped to the live window.
    // The upper clip matters: on the frame the swing crosses out of the live
    // window `s` is already past 1, and posing there would test the blade on
    // its way back up, where it must not damage anything.
    const s0 = clamp(this.swing.prevS, 0, 1);
    const s1 = clamp(this.swing.s, 0, 1);

    this.swing.pose(s0, _aim, _prevPose);
    this.swing.pose(s1, _aim, _pose);
    const travel = _prevPose.tip.distanceTo(_pose.tip);
    const steps = this.swing.substeps(travel);

    // Into a dedicated array: resolving a hit alerts the victim's allies, which
    // re-runs the shared broad-phase scratch buffer underneath this loop.
    const list = this.targets.nearby(_eye, this.weapon.reach + BROAD_PHASE_PAD, this.candidates);

    for (let k = 1; k <= steps; k++) {
      const s = s0 + ((s1 - s0) * k) / steps;
      this.swing.pose(s, _aim, _pose);

      for (const a of list) {
        if (!a.alive || this.swing.hit.has(a.id)) continue;
        const vol = this.targets.volume(a, frame);
        const reach = radius + vol.radius;
        const d2 = closestSegSeg(_pose.hilt, _pose.tip, vol.base, vol.top, _pa, _pb);
        if (d2 > reach * reach) continue;
        this.swing.hit.add(a.id);
        _pt.copy(_pa).add(_pb).multiplyScalar(0.5);
        _dir.subVectors(_pt, _aim.origin);
        if (_dir.lengthSq() < 1e-6) _dir.copy(_aim.forward);
        _dir.normalize();
        this.strikeActor(ctx, a, _pt, _dir, frame);
      }

      // Rigid bodies take the same swing. Knocking an urn off a shelf with a
      // spear is exactly the kind of thing nobody planned and everybody tries.
      const body = this.bodies.hitTest(_pose.hilt, _pose.tip, _pt);
      if (body !== null) {
        _dir.copy(_pose.tip).sub(_prevPose.tip);
        if (_dir.lengthSq() < 1e-6) _dir.copy(_aim.forward);
        _dir.normalize().multiplyScalar(this.weapon.mass * (1.4 + this.swing.charge * 2.2));
        this.bodies.push(body, _pt, _dir);
        this.feedback.thud(ctx, _pt, _dir.length() * 4, body.def.material, false);
      }
    }

    // Ground contact: burying a warhammer in the ash should say so.
    if (this.terrain !== null && this.terrain.ready && this.swing.hit.size === 0) {
      const h = this.terrain.heightAt(_pose.tip.x, _pose.tip.z);
      if (_pose.tip.y < h) {
        this.terrain.normalAt(_pose.tip.x, _pose.tip.z, _dir);
        this.feedback.thud(ctx, _pose.tip, this.weapon.mass * 6, 'ground', false);
        this.swing.interrupt(0.12);
      }
    }

    if (this.swing.s >= 1 && this.swing.hit.size === 0) {
      this.feedback.whiff(ctx, _pose.tip, _pose.axis, this.weapon.mass / 6);
      // A blade going past its head is noticed — including by the creature that
      // has just backed out of reach, which is why this is not limited to the
      // broad-phase candidates the swing was actually tested against.
      this.ai.noticeAttack(this.targets, _eye);
    }
  }

  private strikeActor(ctx: Ctx, a: ActorLike, at: THREE.Vector3, dir: THREE.Vector3, frame: number): void {
    const prof = this.ai.profileFor(a.kind);
    const roll = this.playerRoll(a, frame, at);
    const def = this.creatureDefence(a, prof, dir);
    const r = resolve(roll, def, this.rand);

    this.applyToActor(ctx, a, at, dir, r, prof, -1);
    this.rpg.it.advance(this.weapon.skill, r.advance);
    this.rpg.it.wear(this.weapon.id, r.wear);
    this.rpg.it.spend(FATIGUE_COST.swing);
    this.stats.hits++;

    // The parry that throws the player off is the mirror of the one the player
    // can land, and it is what makes an armoured dunmer worth respecting.
    if (r.outcome === 'parry' || r.outcome === 'block') {
      this.swing.interrupt(r.recoil);
      if (this.player !== null) this.player.shake(clamp(r.recoil * 0.4, 0, 0.4), 0.18);
    }
  }

  private playerRoll(a: ActorLike, frame: number, at: THREE.Vector3): AttackRoll {
    const rpg = this.rpg.it;
    return {
      weapon: this.weapon,
      kind: this.swing.kind,
      charge: this.swing.charge,
      region: this.targets.regionAt(a, at, frame),
      skill: rpg.skill(this.weapon.skill),
      agility: rpg.attribute('agility'),
      strength: rpg.attribute('strength'),
      luck: rpg.attribute('luck'),
      fatigue: rpg.fatigue(),
      condition: rpg.condition(this.weapon.id),
      // A blow landed on something that has not noticed you is a different
      // proposition entirely — the sneak multiplier is the whole reason to
      // approach a silt strider from behind.
      sneak: this.ai.guardOf(a).guard < 0.05 && this.ai.fighter(a).aggro < 0.1 ? 1.8 : 1,
    };
  }

  private creatureDefence(a: ActorLike, prof: CreatureCombat, dir: THREE.Vector3): Defence {
    const g = this.ai.guardOf(a);
    const f = this.ai.fighter(a);
    _face.set(Math.sin(a.yaw), 0, Math.cos(a.yaw));
    const facing = -(_face.x * dir.x + _face.z * dir.z) > Math.cos(1.1);
    return {
      armour: prof.armour,
      armourCondition: 1,
      resistKey: a.kind,
      guard: g.guard,
      guardAge: g.age,
      shield: shieldOf('parry'),
      guardFacing: facing,
      // Light, alert creatures slip a blow; a silt strider cannot.
      evade: clamp(0.34 - prof.mass / 1400, 0.02, 0.34) * (f.aggro > 0.2 ? 1 : 0.45),
      staggered: f.stagger > 0,
      mass: prof.mass,
    };
  }

  /** Damage, reaction, feedback and death, shared by melee, arrows and DoTs. */
  private applyToActor(
    ctx: Ctx,
    a: ActorLike,
    at: THREE.Vector3,
    dir: THREE.Vector3,
    r: Resolution,
    prof: CreatureCombat,
    attackerId: number,
  ): void {
    const sys = this.targets.system;
    const wasAlive = a.alive;
    if (r.damage > 0 && sys !== null) sys.damage(a, r.damage, dir);

    this.ai.alert(a, this.targets, r.damage > 0 ? 1 : 0.6);
    if (r.stagger > 0) this.ai.stagger(a, r.stagger);
    if (r.dot !== null) this.ai.applyDot(a, r.dot);

    this.feedback.impact(ctx, at, dir, r, {
      outcome: r.outcome,
      weight: r.weight,
      damage: r.damage,
      ring: r.ring,
      sparks: r.sparks,
      targetId: a.id,
      attackerId,
      material: prof.armour,
    });

    if (r.outcome === 'immune') {
      ctx.bus.emit('notify', { text: `Your ${this.weapon.name.toLowerCase()} passes through it`, kind: 'warn' });
    }

    if (wasAlive && !a.alive) {
      _v.copy(dir).multiplyScalar(r.knockback * 1.6);
      _v.y += 2.2;
      this.spawnRagdoll(a, _v, at);
      ctx.bus.emit('combat:kill', { id: a.id, kind: a.kind, x: a.position.x, y: a.position.y, z: a.position.z });
    }
  }

  /* ----------------------------------------------------------- creatures */

  private creatureWeapon(kind: string, prof: CreatureCombat): WeaponDef {
    let w = this.creatureWeapons.get(kind);
    if (w === undefined) {
      w = {
        id: `natural:${kind}`,
        name: kind,
        cls: 'handtohand',
        material: 'flesh',
        skill: 'handtohand',
        reach: prof.reach,
        mass: clamp(prof.mass / 14, 0.5, 14),
        speed: 1,
        chop: prof.damage,
        slash: prof.damage,
        thrust: prof.damage,
        twoHanded: false,
        enchanted: false,
        edge: 0.12,
      };
      this.creatureWeapons.set(kind, w);
    }
    return w;
  }

  /** A creature's committed attack has reached its strike frame. */
  private creatureStrike(ctx: Ctx, a: ActorLike, f: Fighter): void {
    const p = this.player;
    if (p === null) return;
    _v.copy(p.position);
    _v.y += 0.9;
    const gap = a.position.distanceTo(_v);
    const prof = f.profile;
    if (gap > prof.reach + 1.4) {
      this.feedback.whiff(ctx, a.position, _dir.subVectors(_v, a.position).normalize(), prof.mass / 90);
      return;
    }

    _dir.subVectors(_v, a.position);
    _dir.y = 0;
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1);
    _dir.normalize();

    const w = this.creatureWeapon(a.kind, prof);
    const rpg = this.rpg.it;
    const roll: AttackRoll = {
      weapon: w,
      kind: 'chop',
      charge: 0.65,
      region: 'torso',
      skill: 30 + prof.aggression * 45,
      agility: 45,
      strength: clamp(30 + prof.mass / 12, 20, 95),
      luck: 40,
      fatigue: 1,
      condition: 1,
      sneak: 1,
    };
    const r = resolve(roll, this.playerDefence(_dir), this.rand);

    _pt.copy(_v).addScaledVector(_dir, -0.35);
    this.feedback.impact(ctx, _pt, _dir, r, {
      outcome: r.outcome,
      weight: r.weight,
      damage: r.damage,
      ring: r.ring,
      sparks: r.sparks,
      targetId: -1,
      attackerId: a.id,
      material: this.armour,
    });

    if (r.damage > 0) {
      rpg.hurt(r.damage);
      rpg.spend(FATIGUE_COST.hit);
      // Knockback goes through the character controller's own velocity, so the
      // player slides and recovers with the same physics as a jump landing.
      p.velocity.addScaledVector(_dir, r.knockback * 0.55);
      p.velocity.y += Math.min(2.2, r.knockback * 0.2);
    }
    if (r.stagger > 0) this.playerStagger = Math.max(this.playerStagger, r.stagger);

    if (r.outcome === 'parry' || r.outcome === 'block') {
      rpg.advance('block', r.outcome === 'parry' ? 1.4 : 0.6);
      rpg.spend(r.outcome === 'parry' ? FATIGUE_COST.parry : FATIGUE_COST.block);
      // The whole point of the timing window: a clean parry staggers the thing
      // that swung, and the player gets a free opening.
      if (r.recoil > 0) this.ai.stagger(a, r.recoil);
      ctx.bus.emit('notify', { text: r.outcome === 'parry' ? 'Parried' : 'Blocked', kind: 'info' });
    } else if (r.damage > 0) {
      rpg.advance('armour', 0.4);
    }
  }

  private updateAi(ctx: Ctx, dt: number): void {
    const p = this.player;
    const s = this.sense;
    s.dt = dt;
    s.now = ctx.time.elapsed;
    s.targetPos.copy(p !== null ? p.position : ctx.camera.position);
    if (p !== null) s.targetVel.copy(p.velocity);
    else s.targetVel.set(0, 0, 0);
    s.targetValid = p !== null && this.rpg.it.healthFraction() > 0;
    s.terrain = this.terrain !== null && this.terrain.ready ? this.terrain : null;
    this.ai.update(this.targets, s);
  }

  private dotTick(ctx: Ctx, a: ActorLike, f: Fighter, d: Dot, amount: number): void {
    const sys = this.targets.system;
    if (sys === null || !a.alive) return;
    _dir.set(0, 1, 0);
    const wasAlive = a.alive;
    sys.damage(a, amount, _dir);
    _pt.copy(a.position);
    _pt.y += 0.6;
    ctx.bus.emit('combat:dot', { id: a.id, kind: d.kind, amount });
    if (wasAlive && !a.alive) {
      _v.set(0, 1.5, 0);
      this.spawnRagdoll(a, _v, _pt);
    }
  }

  /* ---------------------------------------------------------------- ranged */

  /** Release a drawn bow. Draw strength comes from the same charge as a swing. */
  private loose(ctx: Ctx): void {
    const w = this.weapon;
    const ammo = this.ammoFor(w);
    this.swing.interrupt(0.05);
    if (ammo === null) {
      ctx.bus.emit('notify', { text: 'No ammunition', kind: 'warn' });
      return;
    }
    const def = AMMO[ammo.id];
    if (def === undefined) return;
    const draw = clamp(this.swing.charge, 0.15, 1);
    const speed = (w.launch ?? 55) * (0.4 + 0.6 * draw);
    _v.copy(_aim.origin).addScaledVector(_aim.forward, 0.5).addScaledVector(_aim.up, -0.1);
    // Skill shows up as cone, not as a hidden roll: a novice's arrows scatter
    // and the player can see exactly how much.
    const spread = (1 - this.rpg.it.skill('marksman') / 100) * 0.055 * (1.25 - draw * 0.5);
    _dir.copy(_aim.forward)
      .addScaledVector(_aim.right, (this.rand.next() - 0.5) * spread)
      .addScaledVector(_aim.up, (this.rand.next() - 0.5) * spread)
      .normalize();
    if (this.shots.fire(_v, _dir, speed, def, -1, this.rpg.it.skill('marksman'), draw)) {
      ammo.count--;
      this.rpg.it.spend(FATIGUE_COST.swing * 0.6);
    }
  }

  private throwWeapon(ctx: Ctx): void {
    const w = WEAPONS[THROWN];
    const ammo = this.ammo.find((a) => a.id === 'star' && a.count > 0);
    if (ammo === null || ammo === undefined) {
      ctx.bus.emit('notify', { text: 'Nothing to throw', kind: 'warn' });
      return;
    }
    const def = AMMO.star;
    _v.copy(_aim.origin).addScaledVector(_aim.forward, 0.4);
    _dir.copy(_aim.forward);
    if (this.shots.fire(_v, _dir, w.launch ?? 34, def, -1, this.rpg.it.skill('marksman'), 1)) {
      ammo.count--;
      this.rpg.it.spend(FATIGUE_COST.swing * 0.5);
    }
  }

  /** An archer looses at the player, leading them under real ballistics. */
  private creatureLoose(ctx: Ctx, a: ActorLike, f: Fighter): void {
    const p = this.player;
    if (p === null) return;
    const def = AMMO.iron_arrow;
    const speed = 48;
    _v.copy(a.position);
    _v.y += 1.4;
    _pt.copy(p.position);
    _pt.y += 0.9;
    // No solution means the shot cannot physically reach; an archer that knows
    // that holds its arrow instead of firing into the dirt.
    if (!leadShot(_v, _pt, p.velocity, speed, _dir)) return;
    const skill = 25 + f.profile.aggression * 45;
    const spread = (1 - skill / 100) * 0.06;
    _dir.x += (this.rand.next() - 0.5) * spread;
    _dir.y += (this.rand.next() - 0.5) * spread;
    _dir.z += (this.rand.next() - 0.5) * spread;
    _dir.normalize();
    if (this.shots.fire(_v, _dir, speed, def, a.id, skill, 1)) {
      ctx.bus.emit('combat:loose', { id: a.id, kind: a.kind });
    }
  }

  /** The player as a capsule, so enemy arrows have something to hit. */
  private playerBody(): PlayerBody | null {
    const p = this.player;
    if (p === null) return null;
    _playerBody.base.copy(p.position);
    _playerBody.base.y += 0.4;
    _playerBody.top.copy(p.position);
    _playerBody.top.y += 1.5;
    return _playerBody;
  }

  /** A projectile reached something. Returns true when it should stop there. */
  private projectileHit(
    ctx: Ctx,
    ammo: AmmoDef,
    ownerId: number,
    skill: number,
    draw: number,
    hit: { actor: ActorLike | null; player: boolean; point: THREE.Vector3; normal: THREE.Vector3; speed: number },
  ): boolean {
    _pt.copy(hit.point);

    if (hit.player) {
      _dir.copy(hit.normal).multiplyScalar(-1).normalize();
      const r = resolve(this.arrowRoll(ammo, skill, draw, hit.speed, 'torso'), this.playerDefence(_dir), this.rand);
      this.feedback.impact(ctx, _pt, _dir, r, {
        outcome: r.outcome,
        weight: r.weight,
        damage: r.damage,
        ring: r.ring,
        sparks: r.sparks,
        targetId: -1,
        attackerId: ownerId,
        material: this.armour,
      });
      if (r.damage > 0) this.rpg.it.hurt(r.damage);
      if (r.stagger > 0) this.playerStagger = Math.max(this.playerStagger, r.stagger);
      if (r.outcome === 'block' || r.outcome === 'parry') this.rpg.it.advance('block', 0.8);
      return r.outcome !== 'deflect' && r.outcome !== 'dodge';
    }

    if (hit.actor === null) {
      // Terrain. A bite into the ash is quiet; a strike on basalt is not.
      this.feedback.thud(ctx, _pt, hit.speed * ammo.mass * 4, 'ground', false);
      const body = this.bodies.hitTest(_pt, _pt, _v);
      if (body !== null) {
        _dir.copy(hit.normal).multiplyScalar(-ammo.mass * hit.speed);
        this.bodies.push(body, _pt, _dir);
      }
      return true;
    }

    const a = hit.actor;
    const prof = this.ai.profileFor(a.kind);
    _dir.copy(hit.normal).multiplyScalar(-1);
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1);
    _dir.normalize();

    const roll = this.arrowRoll(ammo, skill, draw, hit.speed, this.targets.regionAt(a, _pt, ctx.time.frame));
    // An arrow into something that has not noticed you is the whole of archery.
    roll.sneak = this.ai.fighter(a).aggro < 0.1 ? 1.9 : 1;
    const def = this.creatureDefence(a, prof, _dir);
    const r = resolve(roll, def, this.rand);
    this.applyToActor(ctx, a, _pt, _dir, r, prof, ownerId);
    if (ownerId < 0) this.rpg.it.advance('marksman', r.advance);

    // An arrow that deflects keeps flying; one that bites stays in the body.
    return r.outcome !== 'deflect' && r.outcome !== 'dodge';
  }

  /**
   * A flying arrow is a weapon of its own material, not of the bow that threw
   * it — which is how a silver arrow answers a wraith regardless of what fired
   * it, and why the arrow tables and the weapon tables share a resolver.
   */
  private arrowRoll(ammo: AmmoDef, skill: number, draw: number, speed: number, region: BodyRegion): AttackRoll {
    let w = this.ammoWeapons.get(ammo.id);
    if (w === undefined) {
      w = {
        ...WEAPONS.short_bow,
        id: ammo.id,
        name: ammo.name,
        material: ammo.material,
        enchanted: ammo.enchanted,
        cls: 'marksman',
        skill: 'marksman',
        mass: ammo.mass * 24,
        chop: ammo.damage,
        slash: ammo.damage,
        thrust: ammo.damage,
      };
      this.ammoWeapons.set(ammo.id, w);
    }
    const rpg = this.rpg.it;
    return {
      weapon: w,
      kind: 'thrust',
      // Draw strength and arrival speed both matter: a spent arrow at the end
      // of its arc does almost nothing, exactly as it should.
      charge: clamp(draw * clamp(speed / 55, 0.25, 1.2), 0, 1),
      region,
      skill,
      agility: rpg.attribute('agility'),
      strength: rpg.attribute('strength'),
      luck: rpg.attribute('luck'),
      fatigue: rpg.fatigue(),
      condition: 1,
      sneak: 1,
    };
  }

  /** The player's own defence, shared by incoming blows and incoming arrows. */
  private playerDefence(dir: THREE.Vector3): Defence {
    const rpg = this.rpg.it;
    return {
      armour: this.armour,
      armourCondition: rpg.condition('armour'),
      resistKey: 'default',
      guard: this.guard.amount,
      guardAge: this.guard.age,
      shield: this.guard.shield,
      guardFacing: this.guard.covers(_aim.forward, dir),
      evade: clamp((rpg.attribute('agility') / 100) * 0.3 * rpg.fatigue(), 0, 0.35),
      staggered: this.playerStagger > 0,
      mass: 82,
    };
  }

  /* -------------------------------------------------------------- ragdoll */

  private spawnRagdoll(a: ActorLike, impulse: THREE.Vector3, at: THREE.Vector3): void {
    for (const r of this.ragdolls) if (r.actorId === a.id) return;
    const bones: THREE.Bone[] = [];
    a.root.traverse((o) => {
      const sk = o as THREE.SkinnedMesh;
      if (bones.length === 0 && sk.isSkinnedMesh && sk.skeleton) bones.push(...sk.skeleton.bones);
    });
    if (bones.length < 3) return;
    if (this.ragdolls.length >= MAX_RAGDOLLS) {
      const oldest = this.ragdolls.shift();
      if (oldest !== undefined) {
        oldest.release();
        // Same cleanup the retirement path does: without this the evicted
        // actor's hit volume and bone-region cache outlive its ragdoll.
        this.targets.forget(oldest.actorId);
      }
    }
    _v.set(0, 0, 0);
    this.ragdolls.push(new Ragdoll(a, bones, impulse, _v, at));
  }

  private stepRagdolls(dt: number): void {
    if (this.ragdolls.length === 0) return;
    const terrain: TerrainQuery | null = this.terrain !== null && this.terrain.ready ? this.terrain : null;
    const live = this.targets.all();
    for (let i = this.ragdolls.length - 1; i >= 0; i--) {
      const r = this.ragdolls[i];
      // The actor system revives and relocates its dead after a while; when it
      // does, the doll must let go of the skeleton immediately.
      let revived = true;
      for (const a of live) {
        if (a.id !== r.actorId) continue;
        revived = a.alive;
        break;
      }
      if (revived || r.done) {
        r.release();
        this.ragdolls.splice(i, 1);
        this.targets.forget(r.actorId);
        continue;
      }
      r.step(dt, terrain);
    }
  }

  /* -------------------------------------------------------------- clutter */

  /**
   * A handful of breakable clutter near where the player wakes up. Not set
   * dressing for its own sake: without something in the world that reacts to
   * being hit, the rigid-body solver is invisible, and a system the player
   * cannot find is a system that does not exist.
   */
  private placeClutter(ctx: Ctx): void {
    if (this.clutterPlaced) return;
    const t = this.terrain;
    const p = this.player;
    if (t === null || !t.ready || p === null || p.position.lengthSq() < 1e-6) return;

    const kinds = ['urn', 'crate', 'pot', 'urn', 'crate', 'pot'];
    let placed = 0;
    for (let i = 0; i < 40 && placed < kinds.length; i++) {
      const ang = this.rand.range(0, Math.PI * 2);
      const rad = this.rand.range(4, 11);
      const x = p.position.x + Math.cos(ang) * rad;
      const z = p.position.z + Math.sin(ang) * rad;
      t.normalAt(x, z, _v);
      if (_v.y < 0.965) continue;
      const h = t.heightAt(x, z);
      if (h < 1) continue;
      _pt.set(x, h, z);
      const b = this.bodies.spawn(kinds[placed], _pt, null);
      if (b !== null) {
        // Placed at rest, not dropped: a crate that visibly settles on load is
        // the tell of a physics system with no initial state.
        b.sleeping = true;
        b.spin.set(0, 0, 0);
        b.quat.setFromAxisAngle(_up, this.rand.range(0, Math.PI * 2));
        b.mesh.quaternion.copy(b.quat);
        placed++;
      }
    }
    // Nothing flat enough here: try again next frame rather than giving up for
    // the session. Spawning on a cliff face is a matter of luck, not of design.
    if (placed === 0) return;
    this.clutterPlaced = true;
    ctx.bus.emit('notify', { text: 'Combat ready — mouse to strike, right mouse to guard', kind: 'info' });
  }

  /* ------------------------------------------------------------- visuals */

  /** Put the weapon where the hit test says it is. Never a separate animation. */
  private driveVisual(dt: number): void {
    const vis = this.visual;
    if (vis === null) return;
    const p = this.player;
    // The held weapon is hidden in free-fly: the screenshot camera is not a
    // person and must not have a sword bolted to it.
    const hidden = p === null || p.freefly === true;
    const first = !hidden && p !== null && p.view === 'first';
    // Bare hands ARE the fist mesh. The stub the weapon builder makes for a
    // handtohand "weapon" would be a block floating inside the knuckles.
    vis.object.visible = !hidden && this.weapon.cls !== 'handtohand';

    // The depth band is a first-person device. In third person the weapon is an
    // object in the world at its real distance and must be depth-tested against
    // the world like anything else, so the band is switched off wholesale.
    VIEWMODEL_DEPTH.value.set(first ? 0.105 : 0, 0.175, 0.85);
    // And with the band, the G-buffer opt-out: a weapon drawn in the band is at
    // a depth it does not really occupy, and the screen-space occlusion built
    // on the prepass then blacks it out and haloes whatever is behind it. See
    // VIEWMODEL_NO_PREPASS. Off again in third person, where the weapon is an
    // ordinary object at its real distance and belongs in the G-buffer.
    if (this.weaponBanded !== first) {
      this.weaponBanded = first;
      vis.object.traverse((o) => {
        if ((o as THREE.Mesh).isMesh !== true) return;
        if (first) o.userData.prepassMaterial = VIEWMODEL_NO_PREPASS;
        else delete o.userData.prepassMaterial;
      });
    }
    const vm = this.viewmodel;
    if (vm !== null) vm.visible = first;
    // Shadows, decided once and applied on the frame the view mode changes.
    //
    // In third person the body casts and the weapon casts with it. In first
    // person the avatar is hidden, so the player casts NOTHING — and a lone
    // sword shadow tracking across the ash with no-one holding it is a worse
    // artefact than the missing one, in exactly the way a floating forearm
    // shadow would be. Neither the weapon nor the arms cast here.
    if (this.weaponCasts !== !first) {
      this.weaponCasts = !first;
      this.applyWeaponShadows();
    }
    if (hidden) return;

    this.swing.pose(this.swing.s, _aim, _pose);

    if (this.weapon.cls === 'marksman') {
      // A bow is held across the body, limbs vertical, and is drawn back toward
      // the cheek — it does not swing, so it must not follow the swing arc.
      const draw = this.swing.phase === 'wind' ? this.swing.charge : 0;
      _basis.makeBasis(_aim.right, _aim.up, _aim.forward);
      _q.setFromRotationMatrix(_basis);
      vis.object.quaternion.slerp(_q, 1 - Math.exp(-30 * dt));
      vis.object.position
        .copy(_aim.origin)
        .addScaledVector(_aim.right, 0.3 + 0.06 * draw)
        .addScaledVector(_aim.up, -0.24)
        .addScaledVector(_aim.forward, 0.88 - 0.24 * draw);
      this.driveViewmodel(vis.object.position, vis.object.quaternion);
      return;
    }

    vis.object.position.copy(_pose.hilt);
    _q.setFromUnitVectors(_up, _pose.axis);
    vis.object.quaternion.slerp(_q, 1 - Math.exp(-45 * dt));

    // A raised guard pulls the weapon across the body; blocking with a blade
    // has to look like blocking with a blade.
    // (-0.12, not the -0.22 this was tuned at with nothing visible at the hand
    // and not the -0.17 it went to next: the rest pose now holds the grip 48 cm
    // from the eye rather than 62, and at that depth the same lateral offset
    // covers half again as much screen. Measured, the guarded gauntlet used to
    // reach x = 0.01 in half-screens from centre — i.e. onto the crosshair. It
    // now stops at 0.10, and a guard the player cannot aim out of is not a
    // guard.)
    if (this.guard.amount > 0.01 && !this.swing.live) {
      vis.object.position.addScaledVector(_aim.right, -0.12 * this.guard.amount);
      vis.object.position.addScaledVector(_aim.up, 0.10 * this.guard.amount);
    }

    this.driveViewmodel(vis.object.position, vis.object.quaternion);

    // THE HAND OWNS THE WEAPON, not the other way round. Everything above
    // decides where the SWING is — a hilt point and a blade axis, the same two
    // numbers `sweep()` runs the hit test on. The rig closes a fixed hand round
    // that and publishes the transform the weapon has to have to be in it; the
    // mesh is drawn there and nowhere else, so the blade the player sees and
    // the blade the sweep tests are the same object by construction.
    //
    // The published origin and axis are the ones handed in — see
    // `Viewmodel.gripOffset` — so this moves nothing the hit test can see. What
    // it does move is the ROLL about the blade, which used to be whatever
    // `setFromUnitVectors` left behind and is now the grip's.
    const rig = this.viewmodel;
    if (rig !== null && rig.visible && rig.weaponHeld) {
      vis.object.position.copy(rig.weaponPos);
      vis.object.quaternion.copy(rig.weaponQuat);
    }
  }

  /**
   * Hand the arms the weapon's final transform for the frame — the same two
   * numbers the mesh was just posed by, after the guard offset and after the
   * slerp, so there is no order of operations in which the grip can be a frame
   * behind the hilt.
   */
  private driveViewmodel(handPos: THREE.Vector3, handQuat: THREE.Quaternion): void {
    const vm = this.viewmodel;
    if (vm === null || !vm.visible) return;
    const f = this.vmFrame;
    f.origin.copy(_aim.origin);
    f.right.copy(_aim.right);
    f.up.copy(_aim.up);
    f.forward.copy(_aim.forward);
    f.handPos.copy(handPos);
    f.handQuat.copy(handQuat);
    f.weapon = this.weapon;
    f.shield = this.guard.shield;
    f.guard = this.guard.amount;
    f.swinging = this.swing.busy;
    f.draw = this.swing.phase === 'wind' ? this.swing.charge : 0;
    vm.update(f);
  }

  /* ------------------------------------------------------ serialisation */

  serialize(): Snapshot {
    return {
      v: 1,
      weapon: this.weaponIndex,
      armour: this.armour,
      shield: this.guard.shield.id,
      ammo: this.ammo.map((a) => ({ id: a.id, count: a.count })),
      seed: this.rand.seed,
      rpg: this.rpg.save(),
      bodies: this.bodies.serialize(),
      shots: this.shots.serialize(),
      fighters: this.ai.serialize(),
      clutterPlaced: this.clutterPlaced,
    };
  }

  deserialize(s: Snapshot | null | undefined): void {
    // Public entry point for a save system that does not use the bus events, so
    // it must survive a missing or foreign-versioned blob rather than throw
    // during load and take the whole boot with it.
    if (s === null || s === undefined || s.v !== 1) return;
    this.equip(s.weapon ?? 0);
    this.armour = s.armour ?? 'leather';
    this.guard.shield = shieldOf(s.shield ?? 'wooden_shield');
    this.viewmodel?.setShield(this.guard.shield);
    if (Array.isArray(s.ammo)) this.ammo = s.ammo.map((a) => ({ id: a.id, count: a.count }));
    this.rand.seed = s.seed ?? 1;
    this.rpg.load(s.rpg ?? {});
    this.bodies.deserialize(s.bodies ?? []);
    this.shots.deserialize(s.shots ?? [], AMMO);
    this.ai.deserialize(s.fighters ?? [], this.targets);
    this.clutterPlaced = s.clutterPlaced === true;
    // Ragdolls are mid-simulation state over skeletons the actor system may
    // have recycled; dropping them on load is correct, and the bodies they
    // belonged to are already dead.
    for (const r of this.ragdolls) r.release();
    this.ragdolls.length = 0;
  }

  /* -------------------------------------------------------------- teardown */

  dispose(): void {
    for (const r of this.ragdolls) r.release();
    this.ragdolls.length = 0;
    for (const off of this.offSave) off();
    this.offSave.length = 0;
    for (const v of this.visuals.values()) {
      v.object.removeFromParent();
      v.dispose();
    }
    this.visuals.clear();
    this.visual = null;
    this.viewmodel?.dispose();
    this.viewmodel = null;
    // The depth band is a module singleton shared with Gear's materials. Leaving
    // it armed after combat is torn down would squash the next thing that
    // compiles against it into the near plane.
    VIEWMODEL_DEPTH.value.set(0, 0.175, 0.85);
    this.shots.dispose();
    this.bodies.dispose();
    this.targets.clear();
    this.ai.clear();
    this.feedback.reset();
    this.group.removeFromParent();
    this.group.clear();
    this.ctx = null;
    this.terrain = null;
    this.mats = null;
    this.player = null;
  }
}

/** Re-exported so an inventory or UI system can read the same tables. */
export { WEAPONS, AMMO, ARMOURS, CREATURE_DEFAULT };
export type { Snapshot as CombatSave };
