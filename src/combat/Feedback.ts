import * as THREE from 'three';
import type { Ctx, System } from '../core/types';
import type { Outcome, Resolution } from './Resolve';
import { clamp } from './mathx';

/**
 * Impact feedback: the layer that decides what the player sees, feels and hears
 * for every combat event.
 *
 * The rule this subsystem is built around is that *no outcome is silent*. A
 * dodge throws dust off the ground where the blade passed, a deflection throws
 * sparks and rings, a block thumps and shoves, a hit stops time for two frames.
 * Nothing — not one branch in `impact()` — returns without emitting something.
 *
 * Hit-stop is local to combat rather than a global time scale: the engine owns
 * dt and other subsystems (weather, sky, water) must not stutter because a
 * warhammer connected. Everything that reads as *impact* — the swing, the
 * ragdoll, the projectile, the actor lunge — runs on the scaled clock; the
 * world keeps its own time.
 */

interface VfxLike extends System {
  spawn(effect: string, position: THREE.Vector3, dir?: THREE.Vector3): void;
  beam(from: THREE.Vector3, to: THREE.Vector3, kind: string, seconds: number): void;
}

export interface PlayerLike extends System {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly grounded: boolean;
  readonly view: 'first' | 'third';
  /** Noclip screenshot camera. Combat must be invisible and inert while it is up. */
  readonly freefly: boolean;
  shake(amplitude: number, seconds: number): void;
}

/** Payload published on the bus for audio, UI and any future gore system. */
export interface ImpactEvent {
  outcome: Outcome;
  x: number;
  y: number;
  z: number;
  /** 0..2 impact weight. */
  weight: number;
  damage: number;
  ring: Resolution['ring'];
  sparks: boolean;
  /** Actor id, or -1 when the player was the one struck. */
  targetId: number;
  attackerId: number;
  material: string;
}

/** Which VFX school dresses each outcome. Data, not a switch. */
const OUTCOME_VFX: Readonly<Record<Outcome, string>> = {
  critical: 'impact',
  hit: 'impact',
  graze: 'impact',
  deflect: 'impact',
  block: 'impact',
  parry: 'impact',
  dodge: 'impact',
  immune: 'frost',
};

/** Seconds of hit-stop per unit of impact weight, by outcome. */
const OUTCOME_FREEZE: Readonly<Record<Outcome, number>> = {
  critical: 0.075,
  hit: 0.042,
  graze: 0.012,
  deflect: 0.03,
  block: 0.036,
  parry: 0.09,
  dodge: 0,
  immune: 0.02,
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class Feedback {
  private vfx: VfxLike | null = null;
  private player: PlayerLike | null = null;
  private freeze = 0;
  private sparkBudget = 0;

  bind(ctx: Ctx): void {
    if (this.vfx === null) {
      const v = ctx.get<VfxLike>('vfx');
      if (v !== undefined && typeof v.spawn === 'function' && typeof v.beam === 'function') this.vfx = v;
    }
    if (this.player === null) {
      const p = ctx.get<PlayerLike>('player');
      if (p !== undefined && typeof p.shake === 'function') this.player = p;
    }
  }

  get playerSystem(): PlayerLike | null {
    return this.player;
  }

  /** Combat's own clock. Hit-stop bites here and nowhere else. */
  scaledDt(dt: number): number {
    if (this.freeze <= 0) return dt;
    this.freeze = Math.max(0, this.freeze - dt);
    // Not a hard zero: a frozen-solid frame reads as a dropped frame, whereas
    // 8% speed reads as weight.
    return dt * 0.08;
  }

  frameStart(): void {
    // One spark burst per frame keeps the six-slot beam pool available for magic.
    this.sparkBudget = 1;
  }

  /**
   * The one entry point for "something connected". `dir` points from attacker to
   * target; `normal` is the surface the blow arrived on, used to throw sparks
   * back along the reflection.
   */
  impact(ctx: Ctx, at: THREE.Vector3, dir: THREE.Vector3, r: Resolution, ev: Omit<ImpactEvent, 'x' | 'y' | 'z'>): void {
    const vfx = this.vfx;
    const school = OUTCOME_VFX[r.outcome];

    if (vfx !== null) {
      // Spray goes back along the incoming blow, lifted, so it reads against the
      // target rather than being swallowed by it.
      _v.copy(dir).multiplyScalar(-1);
      _v.y += 0.55;
      if (_v.lengthSq() < 1e-6) _v.set(0, 1, 0);
      _v.normalize();
      vfx.spawn(school, at, _v);

      if (r.sparks && this.sparkBudget > 0) {
        // Two short streaks along the deflection: the readable signature of
        // steel skating off armour, and the reason a "miss" is never nothing.
        this.sparkBudget--;
        for (let i = 0; i < 2; i++) {
          const a = (i * 2.3 + ctx.time.elapsed * 7.7) % (Math.PI * 2);
          _w.copy(_v).multiplyScalar(0.5 + 0.3 * Math.sin(a * 1.7));
          _w.x += Math.cos(a) * 0.45;
          _w.z += Math.sin(a) * 0.45;
          _w.add(at);
          vfx.beam(at, _w, 'default', 0.07);
        }
      }
    }

    // Camera shake falls off with distance and rises with weight. The player
    // being hit is worth twice what hitting something is.
    const p = this.player;
    if (p !== null) {
      const d = p.position.distanceTo(at);
      const near = clamp(1 - d / 9, 0, 1);
      const mine = ev.targetId < 0 ? 1.9 : 1;
      const amp = clamp(r.weight * 0.16 * near * mine, 0, 0.55);
      if (amp > 0.005) p.shake(amp, 0.1 + r.weight * 0.07);
    }

    const f = OUTCOME_FREEZE[r.outcome] * clamp(r.weight, 0.2, 2);
    // Only freeze for blows the player is party to; two cliff racers scrapping
    // across the valley must not stutter the frame.
    if (f > this.freeze && (ev.targetId < 0 || ev.attackerId < 0)) this.freeze = f;

    ctx.bus.emit<ImpactEvent>('combat:impact', { ...ev, x: at.x, y: at.y, z: at.z });
  }

  /** A swing that reached nothing still costs breath and still moves air. */
  whiff(ctx: Ctx, at: THREE.Vector3, dir: THREE.Vector3, weight: number): void {
    ctx.bus.emit('combat:whiff', { x: at.x, y: at.y, z: at.z, weight });
    if (this.vfx !== null && weight > 0.9) {
      _v.copy(dir).normalize();
      this.vfx.spawn('impact', at, _v);
    }
  }

  /** Non-combat physical noise: a crate landing, an urn shattering, an arrow biting wood. */
  thud(ctx: Ctx, at: THREE.Vector3, energy: number, material: string, broke: boolean): void {
    ctx.bus.emit('combat:thud', { x: at.x, y: at.y, z: at.z, energy, material, broke });
    if (broke && this.vfx !== null) {
      _v.set(0, 1, 0);
      this.vfx.spawn('impact', at, _v);
    }
    const p = this.player;
    if (p !== null && broke) {
      const near = clamp(1 - p.position.distanceTo(at) / 12, 0, 1);
      if (near > 0) p.shake(clamp(energy * 0.002 * near, 0, 0.2), 0.16);
    }
  }

  reset(): void {
    this.freeze = 0;
    this.vfx = null;
    this.player = null;
  }
}
