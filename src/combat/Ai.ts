import * as THREE from 'three';
import type { TerrainQuery } from '../core/types';
import { CREATURES, CREATURE_DEFAULT, type CreatureCombat, type DotKind, DOTS } from './Tables';
import { approach, clamp, Rand } from './mathx';
import type { ActorLike, TargetIndex } from './Targets';

/**
 * Enemy combat behaviour.
 *
 * The actor system owns wandering, herding and flight; this owns what happens
 * once something has decided to fight. The two compose rather than compete: a
 * fighter's steering here is an additive impulse on top of whatever the actor's
 * own brain is doing, so a nix-hound that is fleeing and a nix-hound that is
 * closing both still look like a nix-hound.
 *
 * The state machine is deliberately small — approach, circle, commit, recover,
 * guard, retreat, flee — because the interesting behaviour comes from the
 * species table rather than from more states. A cliff racer and a guar run the
 * same seven states; what differs is that one of them commits from thirty
 * metres up at twenty-two metres a second and does not stop, and the other
 * lowers its head and ploughs.
 */

export type FightState = 'idle' | 'approach' | 'circle' | 'commit' | 'recover' | 'guard' | 'retreat' | 'flee';

export interface Dot {
  kind: DotKind;
  remain: number;
  stacks: number;
  tick: number;
}

export interface Fighter {
  id: number;
  kind: string;
  profile: CreatureCombat;
  state: FightState;
  timer: number;
  /** 0..1 commitment to the fight. Decays out of combat, spikes when hurt. */
  aggro: number;
  /** Seconds since the target was last within line of sight distance. */
  lost: number;
  /** Additive combat velocity, decayed every frame. */
  vel: THREE.Vector3;
  /** 0..1 guard, and how long it has been up — the parry window works both ways. */
  guard: number;
  guardAge: number;
  stagger: number;
  /** Seconds until it may commit again. */
  cadence: number;
  /** -1 or 1; which way it circles. Flipping it is what makes a fight read. */
  circleDir: number;
  /** True while the current commit has not yet delivered its blow. */
  pending: boolean;
  /** True when this commit is a feint and will be pulled at the last moment. */
  feinting: boolean;
  dots: Dot[];
  /** Last known health, for detecting damage from any source. */
  lastHealth: number;
  /** Seconds of slow left from a frost effect and the like. */
  slow: number;
  /**
   * Where this fighter was left standing at the end of the previous combat
   * update. Differencing against it recovers the displacement the actor
   * system applied in between, which is the only handle combat has on the
   * ambient brain it does not own.
   */
  lastPos: THREE.Vector3;
  /** True once `lastPos` holds a real sample; false on the first frame. */
  tracked: boolean;
}

export interface AiSense {
  dt: number;
  now: number;
  targetPos: THREE.Vector3;
  targetVel: THREE.Vector3;
  /** True when the player is a legitimate target — alive and not noclipping. */
  targetValid: boolean;
  terrain: TerrainQuery | null;
}

/** Committed movement per fighting style. Everything about pacing lives here. */
const COMMIT: Readonly<
  Record<
    CreatureCombat['style'],
    { rise: number; forward: number; through: number; hold: number; turnLock: boolean }
  >
> = {
  // Climbs, then falls on the target and keeps going past it.
  dive: { rise: 6, forward: 1, through: 1.5, hold: 0.35, turnLock: true },
  // A crouch and a parabolic pounce.
  leap: { rise: 3.4, forward: 1, through: 0.4, hold: 0.2, turnLock: true },
  // Head down, straight line, does not steer once started.
  charge: { rise: 0, forward: 1, through: 1.1, hold: 0.5, turnLock: true },
  brawler: { rise: 0, forward: 1, through: 0.15, hold: 0.12, turnLock: false },
  drift: { rise: 0.4, forward: 0.5, through: 0.1, hold: 0.4, turnLock: false },
};

const _v = new THREE.Vector3();
const _to = new THREE.Vector3();
const _side = new THREE.Vector3();
const _ext = new THREE.Vector3();

/**
 * Exponential decay applied to steering velocity. The impulse a state adds is
 * scaled by this same rate, so a state that asks for 2.4 m/s settles at 2.4 m/s
 * rather than at some fraction of it that depends on the drag constant.
 */
const STEER_DRAG = 4.5;
/** Committed motion coasts: that is what makes a lunge read as committed. */
const COMMIT_DRAG = 0.7;
/**
 * Ceiling on the retreat this module will cancel out of a fighter, in metres
 * per second. Above any creature's run speed, but low enough that a teleport,
 * an actor-id recycle or a respawn cannot be mistaken for the ambient brain
 * walking away and dragged back.
 */
const MAX_HOLD_SPEED = 12;

/**
 * Metres at which a swing that cut only air is registered. Comfortably beyond
 * any weapon's reach, because the point is the creature that just stepped out
 * of it.
 */
const WHIFF_NOTICE = 8;

/** States in which combat, not the ambient brain, decides where the actor goes. */
function engaging(state: FightState): boolean {
  return state === 'approach' || state === 'circle' || state === 'commit' || state === 'guard';
}

export class CombatAI {
  private fighters = new Map<number, Fighter>();
  private rand = new Rand(0x2f6d1a3b);
  /** Own broad-phase buffer, so alerting cannot walk the shared scratch array. */
  private heard: ActorLike[] = [];
  /** Called when a committed attack reaches its strike frame. */
  onStrike: ((a: ActorLike, f: Fighter) => void) | null = null;
  /** Called when a damage-over-time effect ticks. */
  onDot: ((a: ActorLike, f: Fighter, d: Dot, amount: number) => void) | null = null;
  /** Called when an archer looses. Combat owns the ballistics; AI owns the when. */
  onLoose: ((a: ActorLike, f: Fighter) => void) | null = null;

  profileFor(kind: string): CreatureCombat {
    return CREATURES[kind] ?? CREATURE_DEFAULT;
  }

  fighter(a: ActorLike): Fighter {
    let f = this.fighters.get(a.id);
    if (f === undefined) {
      f = {
        id: a.id,
        kind: a.kind,
        profile: this.profileFor(a.kind),
        state: 'idle',
        timer: 0,
        aggro: 0,
        lost: 0,
        vel: new THREE.Vector3(),
        guard: 0,
        guardAge: 99,
        stagger: 0,
        cadence: 0,
        circleDir: this.rand.next() < 0.5 ? -1 : 1,
        pending: false,
        feinting: false,
        dots: [],
        lastHealth: a.health,
        slow: 0,
        lastPos: new THREE.Vector3(),
        tracked: false,
      };
      this.fighters.set(a.id, f);
    } else if (f.kind !== a.kind) {
      // The actor system recycles ids onto relocated actors; rebind rather than
      // let a guar inherit a cliff racer's fight.
      f.kind = a.kind;
      f.profile = this.profileFor(a.kind);
      f.state = 'idle';
      f.aggro = 0;
      f.dots.length = 0;
      f.tracked = false;
    }
    return f;
  }

  /** Pull a creature into the fight, and optionally its neighbours with it. */
  alert(a: ActorLike, targets: TargetIndex, amount = 1): void {
    const f = this.fighter(a);
    f.aggro = clamp(f.aggro + amount, 0, 1);
    f.lost = 0;
    if (f.state === 'idle') f.state = 'approach';
    if (!f.profile.callsAllies || amount < 0.9) return;
    // A call for help is the single most effective way to make a fight feel
    // like a place rather than a duel.
    for (const other of targets.nearby(a.position, 22)) {
      if (other.id === a.id || other.faction !== a.faction) continue;
      const g = this.fighter(other);
      if (g.aggro >= 0.5) continue;
      g.aggro = clamp(g.aggro + 0.7, 0, 1);
      g.lost = 0;
      if (g.state === 'idle') g.state = 'approach';
    }
  }

  stagger(a: ActorLike, seconds: number): void {
    const f = this.fighter(a);
    f.stagger = Math.max(f.stagger, seconds);
    if (seconds > 0.15) {
      f.state = 'recover';
      f.timer = seconds;
      f.pending = false;
      f.guard = 0;
    }
  }

  applyDot(a: ActorLike, kind: DotKind): void {
    const f = this.fighter(a);
    const def = DOTS[kind];
    const cur = f.dots.find((d) => d.kind === kind);
    if (cur !== undefined) {
      cur.remain = def.seconds;
      cur.stacks = Math.min(def.maxStacks, cur.stacks + 1);
      return;
    }
    f.dots.push({ kind, remain: def.seconds, stacks: 1, tick: 0 });
  }

  /** Whether an actor currently has its guard inside the parry window. */
  guardOf(a: ActorLike): { guard: number; age: number } {
    const f = this.fighters.get(a.id);
    return f === undefined ? { guard: 0, age: 99 } : { guard: f.guard, age: f.guardAge };
  }

  update(targets: TargetIndex, sense: AiSense): void {
    const dt = sense.dt;
    const seen = new Set<number>();

    for (const a of targets.all()) {
      seen.add(a.id);
      if (!a.alive) {
        const dead = this.fighters.get(a.id);
        if (dead !== undefined && dead.state !== 'idle') {
          dead.state = 'idle';
          dead.aggro = 0;
          dead.vel.set(0, 0, 0);
          dead.dots.length = 0;
        }
        continue;
      }

      const f = this.fighter(a);
      this.tickDots(a, f, dt);

      // Damage from any source — a spell, a trap, another creature — pulls the
      // victim into the fight without the source having to tell us.
      if (a.health < f.lastHealth - 0.001) this.alert(a, targets, 0.9);
      f.lastHealth = a.health;

      f.stagger = Math.max(0, f.stagger - dt);
      f.cadence = Math.max(0, f.cadence - dt);
      f.slow = Math.max(0, f.slow - dt);
      f.guardAge += dt;

      const dist = sense.targetValid ? a.position.distanceTo(sense.targetPos) : Infinity;
      const prof = f.profile;

      // Ambient aggression: a cliff racer needs no reason.
      if (f.state === 'idle' && sense.targetValid && dist < prof.notice) {
        if (this.rand.next() < prof.aggression * dt * 0.9) {
          f.aggro = clamp(f.aggro + 0.8, 0, 1);
          f.state = 'approach';
        }
      }

      if (f.aggro > 0) {
        f.lost = dist > prof.notice * 1.6 ? f.lost + dt : 0;
        f.aggro = clamp(f.aggro - dt * (f.lost > 4 ? 0.25 : 0.02), 0, 1);
        if (f.aggro < 0.05) f.state = 'idle';
      }

      this.think(a, f, sense, dist, dt);
      this.integrate(a, f, sense, dt);
    }

    // Fighters whose actor is gone must not keep their bleed running forever.
    if (this.fighters.size > seen.size + 32) {
      for (const id of [...this.fighters.keys()]) if (!seen.has(id)) this.fighters.delete(id);
    }
  }

  private think(a: ActorLike, f: Fighter, sense: AiSense, dist: number, dt: number): void {
    const prof = f.profile;
    if (f.stagger > 0) {
      f.guard = approach(f.guard, 0, 12, dt);
      return;
    }
    if (f.state === 'idle' || !sense.targetValid) {
      f.guard = approach(f.guard, 0, 6, dt);
      return;
    }

    const lowHealth = a.health / Math.max(1, a.maxHealth) < prof.breakAt;
    if (lowHealth && f.state !== 'flee' && f.state !== 'commit') {
      // Morale: things that can run, run. That the world does not scale is only
      // interesting if the things in it know when they are losing.
      f.state = 'flee';
      f.timer = 4 + this.rand.next() * 4;
    }

    f.timer -= dt;

    switch (f.state) {
      case 'approach': {
        f.guard = approach(f.guard, prof.guard * 0.5, 5, dt);
        // An archer would rather keep the distance it already has. Closing to
        // sword range with a bow in hand is what makes ranged enemies harmless.
        if (prof.ranged && dist > prof.reach * 3 && dist < 45 && f.cadence <= 0) {
          this.onLoose?.(a, f);
          f.cadence = prof.cadence * (1.4 + this.rand.next());
          f.state = 'circle';
          f.timer = 1.2 + this.rand.next();
          break;
        }
        if (dist <= prof.reach + 0.4 && f.cadence <= 0) this.beginCommit(f);
        else if (dist <= prof.reach * 2.2 && f.timer <= 0) {
          f.state = 'circle';
          f.timer = 0.6 + this.rand.next() * 1.6;
          if (this.rand.next() < 0.4) f.circleDir = -f.circleDir;
        }
        break;
      }
      case 'circle': {
        f.guard = approach(f.guard, prof.guard, 6, dt);
        if (f.timer <= 0 || dist > prof.reach * 3) {
          f.state = 'approach';
          f.timer = 0.4;
        } else if (dist <= prof.reach + 0.3 && f.cadence <= 0 && this.rand.next() < dt * 2.2) {
          this.beginCommit(f);
        }
        break;
      }
      case 'commit': {
        f.guard = approach(f.guard, 0, 14, dt);
        if (f.pending && f.timer <= prof.active) {
          f.pending = false;
          // A feint reaches the strike frame and pulls it — the tell that a
          // creature is baiting the player's block.
          if (!f.feinting) this.onStrike?.(a, f);
          f.state = 'recover';
          f.timer = prof.recover * (f.feinting ? 0.55 : 1);
          f.cadence = prof.cadence * (0.7 + this.rand.next() * 0.6);
        }
        break;
      }
      case 'recover': {
        f.guard = approach(f.guard, prof.guard * 0.8, 7, dt);
        if (f.timer <= 0) {
          f.state = dist > prof.reach * 2 ? 'approach' : this.rand.next() < 0.45 ? 'circle' : 'retreat';
          f.timer = 0.5 + this.rand.next();
          if (f.state === 'circle' && this.rand.next() < 0.5) f.circleDir = -f.circleDir;
        }
        break;
      }
      case 'guard': {
        if (f.guard < 0.9) {
          f.guardAge = 0;
        }
        f.guard = approach(f.guard, 1, 16, dt);
        if (f.timer <= 0) {
          f.state = 'approach';
          f.timer = 0.4;
        }
        break;
      }
      case 'retreat': {
        f.guard = approach(f.guard, prof.guard, 8, dt);
        if (f.timer <= 0 || dist > prof.reach * 2.6) {
          f.state = 'approach';
          f.timer = 0.5;
        }
        break;
      }
      case 'flee': {
        f.guard = approach(f.guard, 0, 6, dt);
        if (f.timer <= 0) {
          // Cornered or recovered: turn and fight again, but warier.
          f.state = a.health / Math.max(1, a.maxHealth) < prof.breakAt * 0.6 ? 'flee' : 'approach';
          f.timer = 3;
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * A blow that was thrown and cut only air.
   *
   * Without this the only way a creature enters a fight it did not start is the
   * ambient aggression roll in `update()`, which takes a second or two to come
   * up — and a skittish animal spends that time running. The player can stand
   * over a kwama swinging and never begin the fight at all, which is the point
   * at which combat stops looking like combat.
   *
   * Deliberately only on a miss. A blow that lands alerts through
   * `applyToActor` instead, after the sneak multiplier has already been read
   * off the unaware defender, so the opening for a first strike survives.
   */
  noticeAttack(targets: TargetIndex, at: THREE.Vector3): void {
    for (const a of targets.nearby(at, WHIFF_NOTICE, this.heard)) this.alert(a, targets, 0.6);
  }

  /** The player winding up is what makes a defensive creature raise its guard. */
  telegraph(targets: TargetIndex, at: THREE.Vector3, radius: number): void {
    for (const a of targets.nearby(at, radius)) {
      const f = this.fighters.get(a.id);
      if (f === undefined || f.aggro < 0.2 || f.state === 'commit') continue;
      if (this.rand.next() > f.profile.guard) continue;
      f.state = 'guard';
      f.timer = 0.5 + this.rand.next() * 0.5;
      f.guardAge = 0;
    }
  }

  private beginCommit(f: Fighter): void {
    f.state = 'commit';
    f.pending = true;
    f.feinting = this.rand.next() < f.profile.feint;
    f.timer = f.profile.windup + f.profile.active;
    f.guardAge = 99;
  }

  /**
   * Combat steering, added on top of the actor system's own motion. Only the
   * horizontal plane is driven directly; vertical impulses are left to decay so
   * a leap arcs under the actor system's own gravity handling.
   */
  private integrate(a: ActorLike, f: Fighter, sense: AiSense, dt: number): void {
    const prof = f.profile;
    if (f.state !== 'idle' && sense.targetValid) {
      _to.subVectors(sense.targetPos, a.position);
      _to.y = 0;
      const d = _to.length();
      if (d > 1e-4) _to.multiplyScalar(1 / d);
      _side.set(-_to.z, 0, _to.x).multiplyScalar(f.circleDir);

      // Hold the ground the fight is happening on.
      //
      // The actor system owns ambient motion, and part of that is a flight
      // reflex: a wild ground animal backs away from anything player-shaped
      // inside its comfort radius, at its *run* speed. That reflex is correct
      // for a creature minding its own business and wrong for one that has
      // decided to fight — and it wins, because the steering below is an
      // additive impulse that tops out below every species' run speed. The
      // result is a creature that is committed to the fight, faces the player,
      // and reverses out of both its own reach and the player's for as long as
      // the fight lasts: every swing the player throws tests an empty
      // candidate list and combat looks broken.
      //
      // So while combat is the one deciding where this actor goes, take back
      // the component of externally applied motion that carries it directly
      // away from its target. Only that component: lateral drift, terrain
      // avoidance and being shoved off a ledge all still happen. Retreat,
      // flee and stagger are combat's own decisions to give ground and are
      // deliberately excluded, so morale and knockback still move a fighter
      // backwards.
      if (f.tracked && engaging(f.state) && f.stagger <= 0) {
        _ext.subVectors(a.position, f.lastPos);
        _ext.y = 0;
        const away = -_ext.dot(_to);
        if (away > 0) a.position.addScaledVector(_to, Math.min(away, MAX_HOLD_SPEED * dt));
      }

      const speedScale = f.slow > 0 ? 0.6 : 1;
      let want = 0;
      switch (f.state) {
        case 'approach':
          want = 2.4;
          _v.copy(_to);
          break;
        case 'circle':
          want = 1.7;
          _v.copy(_side).addScaledVector(_to, d > prof.reach * 1.6 ? 0.55 : -0.15).normalize();
          break;
        case 'retreat':
          want = 2.0;
          _v.copy(_to).multiplyScalar(-1);
          break;
        case 'flee':
          want = 3.6;
          _v.copy(_to).multiplyScalar(-1);
          break;
        case 'guard':
          want = 0.5;
          _v.copy(_side);
          break;
        default:
          _v.set(0, 0, 0);
          break;
      }
      if (f.stagger > 0) want = 0;
      // Scaled by the drag it decays against, so `want` is the speed the state
      // actually settles at. With the old fixed gain of 3.4 every state topped
      // out at three quarters of its number — an approach at 1.8 m/s, slower
      // than any ground creature walks away.
      if (want > 0) f.vel.addScaledVector(_v, want * speedScale * dt * STEER_DRAG);

      // Commit: a single hard push, once, at the top of the windup.
      if (f.state === 'commit' && f.pending && f.timer <= prof.active + 0.02) {
        const c = COMMIT[prof.style];
        f.vel.addScaledVector(_to, prof.lunge * c.forward);
        f.vel.y += c.rise;
      }

      // Face the fight. The actor system re-derives yaw from velocity, so this
      // only holds while combat is the dominant motion — which is correct.
      if (f.state !== 'flee' && f.state !== 'retreat' && d > 1e-4) a.yaw = Math.atan2(_to.x, _to.z);
    }

    // Drag. Committed motion carries through; steering pressure does not.
    const drag = f.state === 'commit' ? COMMIT_DRAG : STEER_DRAG;
    f.vel.multiplyScalar(Math.exp(-drag * dt));
    if (f.vel.lengthSq() < 1e-6) {
      f.vel.set(0, 0, 0);
      f.lastPos.copy(a.position);
      f.tracked = true;
      return;
    }
    a.position.addScaledVector(f.vel, dt);

    // Ground creatures may not be pushed under the world by their own lunge.
    const t = sense.terrain;
    if (t !== null && prof.style !== 'dive' && prof.style !== 'drift') {
      const h = t.heightAt(a.position.x, a.position.z);
      if (a.position.y < h) {
        a.position.y = h;
        if (f.vel.y < 0) f.vel.y = 0;
      }
    }

    f.lastPos.copy(a.position);
    f.tracked = true;
  }

  private tickDots(a: ActorLike, f: Fighter, dt: number): void {
    if (f.dots.length === 0) return;
    for (let i = f.dots.length - 1; i >= 0; i--) {
      const d = f.dots[i];
      const def = DOTS[d.kind];
      d.remain -= dt;
      d.tick += dt;
      if (d.tick >= 0.5) {
        const amount = def.rate * d.stacks * d.tick;
        d.tick = 0;
        this.onDot?.(a, f, d, amount);
      }
      if (def.slow < 1) f.slow = Math.max(f.slow, 0.2);
      if (d.remain <= 0) f.dots.splice(i, 1);
    }
  }

  serialize(): number[][] {
    const out: number[][] = [];
    for (const f of this.fighters.values()) {
      if (f.aggro <= 0 && f.dots.length === 0) continue;
      const row = [f.id, STATE_INDEX.indexOf(f.state), f.timer, f.aggro, f.guard, f.guardAge, f.stagger, f.cadence, f.circleDir, f.dots.length];
      for (const d of f.dots) row.push(DOT_INDEX.indexOf(d.kind), d.remain, d.stacks);
      out.push(row);
    }
    return out;
  }

  deserialize(rows: number[][], targets: TargetIndex): void {
    this.fighters.clear();
    const byId = new Map<number, ActorLike>();
    for (const a of targets.all()) byId.set(a.id, a);
    for (const r of rows) {
      const a = byId.get(r[0]);
      if (a === undefined) continue;
      const f = this.fighter(a);
      f.state = STATE_INDEX[r[1]] ?? 'idle';
      f.timer = r[2];
      f.aggro = r[3];
      f.guard = r[4];
      f.guardAge = r[5];
      f.stagger = r[6];
      f.cadence = r[7];
      f.circleDir = r[8];
      const n = r[9] | 0;
      f.dots.length = 0;
      for (let i = 0; i < n; i++) {
        const base = 10 + i * 3;
        const kind = DOT_INDEX[r[base]];
        if (kind === undefined) continue;
        f.dots.push({ kind, remain: r[base + 1], stacks: r[base + 2], tick: 0 });
      }
    }
  }

  clear(): void {
    this.fighters.clear();
  }
}

const STATE_INDEX: readonly FightState[] = ['idle', 'approach', 'circle', 'commit', 'recover', 'guard', 'retreat', 'flee'];
const DOT_INDEX: readonly DotKind[] = ['bleed', 'poison', 'burn', 'frostbite', 'blight'];
