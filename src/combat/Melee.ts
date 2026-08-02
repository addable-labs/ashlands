import * as THREE from 'three';
import { ARCS, REST_POSE, type ArcDef, type AttackKind, type ShieldDef, type WeaponDef } from './Tables';
import { clamp, easeInQuad, easeOutCubic, smoothstep } from './mathx';

/**
 * Melee: the swing itself.
 *
 * Two decisions carry the whole feel.
 *
 * First, the weapon is a real object with a real position every frame, and the
 * hit test uses that object's segment — hilt to tip — swept along the arc
 * across the frame. A swing is sampled at up to eight intermediate poses chosen
 * from how far the tip actually travelled, so a warhammer at the bottom of a
 * chop cannot skip past a nix-hound between two frames. What the player sees
 * pass through a body is what the code tested.
 *
 * Second, the arc is a continuous function of one scalar `s`: negative through
 * the windup, 0..1 through the live window, above 1 through the recovery. There
 * is no state machine handing off between animations, so charge level can
 * stretch the windup arbitrarily without a blend seam, and the swept sampler
 * can evaluate the pose at any fractional time it likes.
 */

export interface AimBasis {
  origin: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

export interface SwingPose {
  hilt: THREE.Vector3;
  tip: THREE.Vector3;
  /** Unit blade axis, hilt toward tip. */
  axis: THREE.Vector3;
}

export type SwingPhase = 'idle' | 'wind' | 'active' | 'recover';

/**
 * Seconds the pose is given to finish travelling to the cocked position after
 * the button comes up. This is the whole of the tap latency.
 *
 * It is not zero, and it is not the windup. Releasing at `s = -0.9` and jumping
 * straight to `s = 0` teleports the hand from near-rest to fully cocked in one
 * frame, which is a visible pop and looks like a dropped animation; waiting for
 * the windup to finish on its own — which is what this code used to do, because
 * `release()` was only reached once `s` had already reached 0 — costs the
 * player the entire windup on every tap. 60 ms covers the remaining travel fast
 * enough to read as instant and slow enough to see.
 */
const RELEASE_SNAP = 0.06;

/**
 * Charge a tap is credited with. A blow the player asked for is a light attack,
 * not a zero-damage flail; holding is what earns the rest.
 */
const TAP_CHARGE = 0.35;

/** Fraction of the recovery that must elapse before another swing may start. */
const RECOVER_CANCEL = 0.5;

/**
 * Where the blade sits when nothing is happening: angled up and slightly across
 * the body, so it reads as a shape rather than as a point. A weapon aimed down
 * the view axis is seen end-on and looks like a smear at the corner of the
 * screen — the most common mistake in a first-person hand model.
 */
const REST_DIR = REST_POSE.blade;
const _d0 = new THREE.Vector3();
const _d1 = new THREE.Vector3();
const _h = new THREE.Vector3();

function dirLerp(a: readonly [number, number, number], b: readonly [number, number, number], k: number, out: THREE.Vector3): void {
  out.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k).normalize();
}

/** The attack the player's feet are asking for, exactly as the original did it. */
export function attackFromMovement(forward: number, strafe: number): AttackKind {
  if (Math.abs(strafe) > Math.abs(forward) && Math.abs(strafe) > 0.2) return 'slash';
  if (Math.abs(forward) > 0.2) return 'thrust';
  return 'chop';
}

export class Swing {
  phase: SwingPhase = 'idle';
  kind: AttackKind = 'chop';
  weapon: WeaponDef;
  /** 0..1 windup charge, frozen at release. */
  charge = 0;
  /** Arc parameter: <0 winding, 0..1 live, >1 recovering. */
  s = 2;
  /** Value of `s` at the end of the previous frame, for the swept test. */
  prevS = 2;
  /** Actors already struck by this swing. One swing, one hit per body. */
  readonly hit = new Set<number>();
  /** Seconds until the fighter may start another swing. */
  cooldown = 0;
  /** Seconds of stagger; a staggered fighter cannot start or continue a swing. */
  stagger = 0;

  constructor(weapon: WeaponDef) {
    this.weapon = weapon;
  }

  get arc(): ArcDef {
    return ARCS[this.kind];
  }

  get live(): boolean {
    return this.phase === 'active';
  }

  /**
   * True when this frame's motion covers any part of the live window [0,1].
   *
   * `live` alone is not enough to drive the hit test. `advance()` flips the
   * phase to 'recover' on the same frame that `s` crosses 1, so a test gated on
   * `live` silently drops the interval between the previous frame's `s` and
   * 1.0 — the end of the arc, which for a chop is the bottom of the swing and
   * the only part of it low enough to reach a kwama. The blade visibly passed
   * through the target and nothing was ever tested there.
   */
  get sweeping(): boolean {
    return this.phase !== 'idle' && this.phase !== 'wind' && this.prevS < 1 && this.s > 0;
  }

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  /**
   * True when the player may start another swing.
   *
   * Not the negation of `busy`: the back half of the recovery is cancellable.
   * A recovery the player cannot act out of is the difference between a combat
   * system that feels heavy and one that feels unresponsive, and only the front
   * half of it carries any of the weight.
   */
  get ready(): boolean {
    if (this.stagger > 0 || this.cooldown > 0) return false;
    if (this.phase === 'idle') return true;
    return this.phase === 'recover' && this.s >= 1 + RECOVER_CANCEL;
  }

  /** Begin winding up. The attack kind is locked at the moment the button goes down. */
  begin(kind: AttackKind, weapon: WeaponDef): void {
    if (!this.ready) return;
    this.kind = kind;
    this.weapon = weapon;
    this.phase = 'wind';
    this.charge = 0;
    this.s = -1;
    this.prevS = -1;
    this.hit.clear();
  }

  /** Let it go. Charge is whatever the windup reached. */
  release(): void {
    if (this.phase !== 'wind') return;
    this.phase = 'active';
    this.prevS = 0;
    this.s = 0;
    this.hit.clear();
  }

  /** Cut the swing short — what a parry or a heavy blow does to an attacker. */
  interrupt(seconds: number): void {
    this.stagger = Math.max(this.stagger, seconds);
    if (this.phase !== 'idle') {
      this.phase = 'recover';
      this.s = Math.max(this.s, 1.05);
      this.prevS = this.s;
    }
    this.cooldown = Math.max(this.cooldown, seconds * 0.6);
  }

  /**
   * Advance the arc. `holding` keeps a windup pinned at full charge instead of
   * releasing on its own — the visible tell that the blow is ready.
   */
  advance(dt: number, holding: boolean): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.stagger = Math.max(0, this.stagger - dt);
    this.prevS = this.s;
    if (this.phase === 'idle') return;
    if (this.stagger > 0) return;

    const arc = this.arc;
    const spd = Math.max(0.2, this.weapon.speed);

    if (this.phase === 'wind') {
      if (holding) {
        // Still charging. A full charge hangs at the top rather than firing on
        // its own: without the hang the player cannot tell a charged blow from
        // an uncharged one.
        this.s = Math.min(0, this.s + dt / (arc.windup * spd));
        this.charge = clamp(1 + this.s, 0, 1);
        if (this.s >= 0) this.s = 0;
        return;
      }
      // The button is up, so the blow is going NOW. Charge is frozen at
      // whatever the hold earned (floored, so a tap is a light attack rather
      // than a zero-damage flail) and only the POSE is allowed to finish
      // travelling, at the snap rate. Maximum added latency is RELEASE_SNAP,
      // regardless of how briefly the button was down.
      this.charge = Math.max(this.charge, TAP_CHARGE);
      this.s = Math.min(0, this.s + dt / RELEASE_SNAP);
      if (this.s >= 0) this.release();
      return;
    }

    if (this.phase === 'active') {
      this.s += dt / (arc.active * spd);
      if (this.s >= 1) this.phase = 'recover';
      return;
    }

    this.s += dt / (arc.recover * spd);
    if (this.s >= 2) {
      this.phase = 'idle';
      this.s = 2;
      this.prevS = 2;
      this.cooldown = Math.max(this.cooldown, 0.02);
    }
  }

  /**
   * Blade pose at arc parameter `s`. Continuous across every phase boundary,
   * which is what lets the swept test sample between frames.
   */
  pose(s: number, aim: AimBasis, out: SwingPose): void {
    const arc = this.arc;
    let push: number;
    let hx: number;
    let hy: number;
    let hz: number;

    if (s < 0) {
      const k = easeInQuad(clamp(1 + s, 0, 1));
      dirLerp(REST_DIR, arc.from, k, _d0);
      hx = arc.restOffset[0] + (arc.windOffset[0] - arc.restOffset[0]) * k;
      hy = arc.restOffset[1] + (arc.windOffset[1] - arc.restOffset[1]) * k;
      hz = arc.restOffset[2] + (arc.windOffset[2] - arc.restOffset[2]) * k;
      push = 0.14 + (arc.pushStart - 0.14) * k;
    } else if (s <= 1) {
      const k = easeOutCubic(clamp(s, 0, 1));
      dirLerp(arc.from, arc.to, k, _d0);
      // The hand drives forward out of the wound-up position through the live
      // window; that translation is most of what makes a swing read as force.
      // It travels toward `endOffset`, which for a chop is well ahead of the
      // rest position — see the note on `ArcDef.endOffset`.
      const end = arc.endOffset ?? arc.restOffset;
      const t = k * 0.85;
      hx = arc.windOffset[0] + (end[0] - arc.windOffset[0]) * t;
      hy = arc.windOffset[1] + (end[1] - arc.windOffset[1]) * t;
      hz = arc.windOffset[2] + (end[2] - arc.windOffset[2]) * t;
      push = arc.pushStart + (arc.pushEnd - arc.pushStart) * k;
    } else {
      const k = smoothstep(clamp(s - 1, 0, 1));
      dirLerp(arc.to, REST_DIR, k, _d0);
      // The follow-through: the hand travels back from wherever the strike left
      // it to the rest position, rather than snapping there, which is what
      // gives a blow its weight.
      //
      // It used to be authored the other way round — pinned at `restOffset` and
      // then DIPPED, 4 cm down and 10 cm back — and on a chop, whose `to`
      // direction points steeply DOWN so that `push` drags the hand further
      // down still, that stacked into a hilt at y = -1.30 in half-screens at
      // k = 0. The arm left the bottom of the frame for the front half of every
      // recovery and came back, which reads as a dropped animation rather than
      // as weight, and it is the frame the review caught with "no arm and no
      // weapon at all". It was also a discontinuity: the live window ends at
      // `endOffset` and the recovery began somewhere else entirely.
      //
      // Now it eases from `endOffset` to `restOffset` and is continuous at the
      // boundary by construction. A chop therefore recovers up and back from
      // the extended position it struck in, which is both the readable motion
      // and the true one.
      const end = arc.endOffset ?? arc.restOffset;
      hx = end[0] + (arc.restOffset[0] - end[0]) * k;
      hy = end[1] + (arc.restOffset[1] - end[1]) * k;
      hz = end[2] + (arc.restOffset[2] - end[2]) * k;
      push = arc.pushEnd + (0.14 - arc.pushEnd) * k;
    }

    // Aim space to world.
    _d1.set(0, 0, 0)
      .addScaledVector(aim.right, _d0.x)
      .addScaledVector(aim.up, _d0.y)
      .addScaledVector(aim.forward, _d0.z)
      .normalize();

    _h.copy(aim.origin)
      .addScaledVector(aim.right, hx)
      .addScaledVector(aim.up, hy)
      .addScaledVector(aim.forward, hz)
      .addScaledVector(_d1, push);

    out.hilt.copy(_h);
    out.axis.copy(_d1);
    out.tip.copy(_h).addScaledVector(_d1, this.weapon.reach);
  }

  /**
   * How many substeps this frame's motion needs so the tip cannot tunnel. Based
   * on the distance the tip actually covered against the blade's own thickness:
   * a slow spear thrust costs one test, a released warhammer chop costs eight.
   */
  substeps(tipTravel: number): number {
    const grain = Math.max(0.05, this.weapon.edge * 2 + 0.06);
    return clamp(Math.ceil(tipTravel / grain), 1, 8);
  }
}

/**
 * A raised guard. Blocking is a held state with an age, because the age is the
 * mechanic: a guard raised in the last quarter second is a parry and throws the
 * attacker off; a guard that has been up for three seconds is a wall you hide
 * behind, and hiding costs fatigue and gives no riposte.
 */
export class Guard {
  raised = false;
  /** Seconds since it went up. */
  age = 0;
  shield: ShieldDef;
  /** 0..1 smoothed rise, so the arm has weight and cannot flicker. */
  amount = 0;

  constructor(shield: ShieldDef) {
    this.shield = shield;
  }

  set(raised: boolean, dt: number): void {
    if (raised && !this.raised) this.age = 0;
    else if (raised) this.age += dt;
    this.raised = raised;
    const target = raised ? 1 : 0;
    // Coming up is faster than going down: dropping a guard should feel like a
    // commitment, and a shield that snaps down instantly makes blocking free.
    const rate = raised ? 14 : 6;
    this.amount += (target - this.amount) * (1 - Math.exp(-rate * dt));
  }

  /** True when an incoming blow from `dir` (attacker -> defender) is inside the arc. */
  covers(facing: THREE.Vector3, dir: THREE.Vector3): boolean {
    if (this.amount < 0.35) return false;
    // The blow travels toward the defender, so the defender must be facing back
    // along it. Dot of facing against the reversed blow direction.
    const c = -(facing.x * dir.x + facing.y * dir.y + facing.z * dir.z);
    return c > Math.cos(this.shield.arc);
  }
}
