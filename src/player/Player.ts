import * as THREE from 'three';
import type { IPlayer, ITerrain } from '../core/contracts';
import type { Ctx, System, TerrainQuery } from '../core/types';
import { CameraRig, type FlyIntent } from './CameraRig';
import { CharacterController, type MoveIntent } from './Controller';
import { PlayerAvatar } from './Avatar';
import { clamp } from './mathx';

/** Stand-in so the controller never has to branch on a missing terrain system. */
const VOID_TERRAIN: TerrainQuery = {
  heightAt: () => 2,
  normalAt: (_x: number, _z: number, out?: THREE.Vector3) => (out ?? new THREE.Vector3()).set(0, 1, 0),
  materialAt: () => 0,
  extent: 4096,
};

/**
 * The slice of the water system this one needs, declared structurally so the
 * player never imports the water subsystem. `heightAt` is the same displaced
 * surface the water system tests the camera against before emitting
 * 'water:submerged', which is why buoyancy must read it and not a flat plane —
 * otherwise the view goes under while the body is still officially walking.
 */
interface WaterQuery extends System {
  readonly level: number;
  heightAt(x: number, z: number, elapsed: number): number;
}

/**
 * The two RPG signals that gate locomotion, declared structurally so the player
 * never imports the RPG layer. `rpg:mobility` is encumbrance (1 free, 0 pinned);
 * `rpg:stats` carries the sheet, of which only Speed and Athletics matter here.
 */
interface MobilityEvent {
  factor?: number;
}
interface StatsEvent {
  mobility?: number;
  attributes?: Partial<Record<string, number>>;
  skills?: Partial<Record<string, number>>;
}

/**
 * Morrowind gates pace on Speed and Athletics, and so do we — but the pivot is
 * the *starting* character, not zero. A level-one build (Speed 40, Athletics 20)
 * lands on exactly 1.0, so the tuning constants are the speed the game actually
 * ships at and the RPG layer is a bonus on top rather than a hidden tax. The
 * floor keeps even a slow, unathletic Altmer inside a run that still feels like
 * running; the ceiling keeps a maxed athlete from outrunning the terrain
 * streaming and the collision sweep.
 */
const SPEED_PIVOT = 40;
const ATHLETICS_PIVOT = 20;
const SPEED_PER_POINT = 0.0022;
const ATHLETICS_PER_POINT = 0.0018;
const SCALE_MIN = 0.95;
const SCALE_MAX = 1.35;

const KEY = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  /**
   * Hold to *walk*. The default gait is a run — a player who never finds the
   * sprint key must not spend the whole game at 2.3 m/s, and every first-person
   * RPG since Oblivion has made Shift the slow modifier for exactly that reason.
   * Underwater and levitating it selects the slow, precise tier of that mode;
   * the unmodified speed there is what those modes shipped at before.
   */
  walk: ['ShiftLeft', 'ShiftRight'],
  sneak: ['ControlLeft', 'ControlRight'],
  up: ['Space'],
  slow: ['AltLeft', 'AltRight'],
};

export class PlayerSystem implements IPlayer {
  readonly id = 'player';
  readonly order = 90;

  private readonly ctrl = new CharacterController();
  private readonly rig = new CameraRig();
  private avatar: PlayerAvatar | null = null;
  private terrain: ITerrain | null = null;
  private water: WaterQuery | null = null;
  private spawned = false;
  private lastSurface = -1;
  private readonly lastEmitted = new THREE.Vector3(NaN, NaN, NaN);
  private readonly intent: MoveIntent = {
    x: 0,
    y: 0,
    yaw: 0,
    pitch: 0,
    run: false,
    sneak: false,
    jump: false,
    up: false,
    down: false,
  };
  private readonly fly: FlyIntent = { right: 0, forward: 0, up: 0, fast: false, slow: false };
  private keyGuard: ((e: KeyboardEvent) => void) | null = null;
  private ctx: Ctx | null = null;
  private bodyYaw = 0;
  private offBus: Array<() => void> = [];
  /** Encumbrance factor from the RPG layer; 1 until it says otherwise. */
  private mobility = 1;
  /** Speed/Athletics factor; 1 for a level-one character. */
  private athletic = 1;

  /** Water plane height. The water system owns the visual; this is the physics. */
  get waterLevel(): number {
    return this.ctrl.waterLevel;
  }
  set waterLevel(v: number) {
    this.ctrl.waterLevel = v;
  }

  /** Series-defining toggles the RPG layer drives from spell effects. */
  get levitate(): boolean {
    return this.ctrl.levitate;
  }
  set levitate(v: boolean) {
    this.ctrl.levitate = v;
  }
  get waterWalk(): boolean {
    return this.ctrl.waterWalk;
  }
  set waterWalk(v: boolean) {
    this.ctrl.waterWalk = v;
  }

  get position(): THREE.Vector3 {
    return this.ctrl.position;
  }
  get velocity(): THREE.Vector3 {
    return this.ctrl.velocity;
  }
  get grounded(): boolean {
    return this.ctrl.grounded;
  }
  get view(): 'first' | 'third' {
    return this.rig.view;
  }
  get swimming(): boolean {
    return this.ctrl.swimming;
  }
  /** Eye below the drawn surface — matches the water system's 'water:submerged'. */
  get underwater(): boolean {
    return this.ctrl.underwater;
  }
  /** Noclip screenshot camera. The body is parked while this is on. */
  get freefly(): boolean {
    return this.rig.freeFly;
  }
  set freefly(v: boolean) {
    this.rig.setFreeFly(v, this.ctx?.camera ?? null);
  }
  /** Radians/pixel of pointer travel. */
  /** Base FOV in degrees. Route the settings slider here, not to camera.fov. */
  get fov(): number {
    return this.rig.baseFov;
  }
  set fov(v: number) {
    this.rig.baseFov = v;
  }
  get sensitivity(): number {
    return this.rig.sensitivity;
  }
  set sensitivity(v: number) {
    this.rig.sensitivity = v;
  }
  get yaw(): number {
    return this.rig.yaw;
  }
  get pitch(): number {
    return this.rig.pitch;
  }

  init(ctx: Ctx): void {
    this.ctx = ctx;
    // The browser steals F1 for its help pane, and the engine's input layer
    // deliberately only guards Key*/Digit*/Space.
    this.keyGuard = (e: KeyboardEvent) => {
      if (e.code === 'F1') e.preventDefault();
    };
    addEventListener('keydown', this.keyGuard, { capture: true });

    const aniso = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy());
    this.avatar = new PlayerAvatar(aniso);
    this.avatar.visible = false;
    ctx.scene.add(this.avatar.object);

    this.offBus.push(
      ctx.bus.on<MobilityEvent>('rpg:mobility', (p) => {
        this.mobility = clamp(Number.isFinite(p?.factor) ? (p?.factor ?? 1) : 1, 0, 1);
        this.applyRpgSpeed();
      }),
      ctx.bus.on<StatsEvent>('rpg:stats', (p) => {
        if (Number.isFinite(p?.mobility)) this.mobility = clamp(p?.mobility ?? 1, 0, 1);
        const speed = p?.attributes?.speed;
        const athletics = p?.skills?.athletics;
        this.athletic = clamp(
          1 +
            (Number.isFinite(speed) ? ((speed ?? SPEED_PIVOT) - SPEED_PIVOT) * SPEED_PER_POINT : 0) +
            (Number.isFinite(athletics)
              ? ((athletics ?? ATHLETICS_PIVOT) - ATHLETICS_PIVOT) * ATHLETICS_PER_POINT
              : 0),
          SCALE_MIN,
          SCALE_MAX,
        );
        this.applyRpgSpeed();
      }),
    );

    this.terrain = ctx.get<ITerrain>('terrain') ?? null;
    this.rig.setView(new THREE.Vector3(0.35, -0.06, -1));
    this.ctrl.position.set(0, 8, 0);
  }

  /**
   * Encumbrance multiplies rather than replaces: a mobility of 0 is the RPG
   * layer saying "you are at capacity", and it must still mean you cannot walk.
   */
  private applyRpgSpeed(): void {
    this.ctrl.speedScale = this.athletic * this.mobility;
  }

  update(ctx: Ctx): void {
    const dt = ctx.time.dt;
    if (dt <= 0) return;
    if (!this.terrain) this.terrain = ctx.get<ITerrain>('terrain') ?? null;
    const terrain: TerrainQuery = this.terrain?.ready ? this.terrain : VOID_TERRAIN;
    this.sampleSurface(ctx, this.ctrl.position.x, this.ctrl.position.z);

    if (!this.spawned && this.terrain?.ready) {
      this.spawnNear(this.terrain, 0, 0);
      this.spawned = true;
    }

    const input = ctx.input;
    if (input.mouseDx !== 0 || input.mouseDy !== 0) this.rig.look(input.mouseDx, input.mouseDy);

    const held = input.held;
    const any = (codes: string[]) => codes.some((c) => held.has(c));
    const fwd = (any(KEY.forward) ? 1 : 0) - (any(KEY.back) ? 1 : 0);
    const strafe = (any(KEY.right) ? 1 : 0) - (any(KEY.left) ? 1 : 0);
    const run = !any(KEY.walk);
    const sneak = any(KEY.sneak);

    if (input.pressed.has('KeyV') && !this.rig.freeFly) {
      this.rig.view = this.rig.view === 'first' ? 'third' : 'first';
      this.rig.snap();
      ctx.bus.emit('notify', { text: this.rig.view === 'first' ? 'First person' : 'Third person', kind: 'info' });
    }
    if (input.pressed.has('KeyT')) {
      this.ctrl.levitate = !this.ctrl.levitate;
      ctx.bus.emit('notify', { text: this.ctrl.levitate ? 'Levitate' : 'Levitate ends', kind: 'info' });
    }
    if (input.pressed.has('KeyG')) {
      this.ctrl.waterWalk = !this.ctrl.waterWalk;
      ctx.bus.emit('notify', { text: this.ctrl.waterWalk ? 'Water walking' : 'Water walking ends', kind: 'info' });
    }
    if (input.pressed.has('F1')) {
      const on = this.rig.toggleFreeFly(ctx.camera);
      ctx.bus.emit('notify', { text: on ? 'Free camera' : 'Camera returned', kind: 'info' });
    }

    if (this.rig.freeFly) {
      this.fly.forward = fwd;
      this.fly.right = strafe;
      this.fly.up = (any(KEY.up) ? 1 : 0) - (sneak ? 1 : 0);
      // The free camera keeps Shift as its boost. It is a screenshot tool with
      // no gait to be slow in, and every capture script already holds Shift.
      this.fly.fast = any(KEY.walk);
      this.fly.slow = any(KEY.slow);
      // The body is parked while the camera is detached: no drowning, no
      // falling off the cliff you flew away from, and no phantom footsteps.
      this.ctrl.velocity.set(0, 0, 0);
      this.ctrl.footEvent = 0;
      this.ctrl.landImpact = 0;
    } else {
      const m = this.intent;
      // Normalise the diagonal so W+D is not 41% faster than W.
      const len = Math.hypot(fwd, strafe);
      const k = len > 1 ? 1 / len : 1;
      m.x = strafe * k;
      m.y = fwd * k;
      m.yaw = this.rig.yaw;
      m.pitch = this.rig.pitch;
      m.run = run;
      m.sneak = sneak;
      m.jump = input.pressed.has('Space');
      m.up = any(KEY.up);
      m.down = sneak;
      this.ctrl.step(dt, m, terrain);
      this.bodyYaw = this.rig.yaw;
    }

    this.rig.update({
      dt,
      ctrl: this.ctrl,
      terrain,
      camera: ctx.camera,
      strafe: this.rig.freeFly ? 0 : strafe,
      wheel: input.wheel,
      fly: this.rig.freeFly ? this.fly : null,
    });

    if (this.avatar) {
      // Free-fly is the noclip/screenshot camera and it starts co-located with the
      // body, so drawing the avatar there fills the frame with point-blank cloth.
      this.avatar.visible = this.rig.view === 'third' && !this.rig.freeFly;
      // Free-flying must not spin the parked body around with the camera.
      this.avatar.update(this.ctrl, this.bodyYaw, this.rig.freeFly ? 0 : this.rig.pitch, dt);
    }

    this.publish(ctx, terrain);
  }

  /**
   * Refreshes the wave-displaced water height under (x,z). The swell is applied
   * as an offset from the water system's own still level so a caller that moves
   * `waterLevel` (interiors, flooded ruins) still gets the right surface.
   */
  private sampleSurface(ctx: Ctx, x: number, z: number): void {
    if (!this.water) this.water = ctx.get<WaterQuery>('water') ?? null;
    const w = this.water;
    if (!w) {
      this.ctrl.surfaceLevel = this.ctrl.waterLevel;
      return;
    }
    const y = w.heightAt(x, z, ctx.time.elapsed);
    // The bake is async and the wave sum is float work; a single NaN here would
    // poison the position and there is no way back from that.
    this.ctrl.surfaceLevel = Number.isFinite(y) ? this.ctrl.waterLevel + (y - w.level) : this.ctrl.waterLevel;
  }

  private publish(ctx: Ctx, terrain: TerrainQuery): void {
    const p = this.ctrl.position;
    if (p.distanceToSquared(this.lastEmitted) > 1e-4 || Number.isNaN(this.lastEmitted.x)) {
      this.lastEmitted.copy(p);
      ctx.bus.emit('player:moved', { x: p.x, y: p.y, z: p.z });
    }

    const surface = terrain.materialAt(p.x, p.z);
    if (surface !== this.lastSurface) {
      this.lastSurface = surface;
      ctx.bus.emit('player:surface', { surface });
    }
    // Not part of the core Events map, but footstep audio needs the impulse and
    // only the controller knows when a foot actually plants.
    if (this.ctrl.footEvent !== 0) {
      ctx.bus.emit('player:step', {
        surface,
        foot: this.ctrl.footEvent,
        speed: this.ctrl.speed,
        submersion: this.ctrl.submersion,
      });
    }
    if (this.ctrl.landImpact > 2) {
      ctx.bus.emit('player:land', { impact: this.ctrl.landImpact, surface });
      // Hard landings kick the camera; the RPG layer can add more on damage.
      this.rig.shake(clamp((this.ctrl.landImpact - 6) / 26, 0, 0.5), 0.22);
    }
  }

  /**
   * Screenshot tooling entry point: drops the player on the terrain at (x,z)
   * and cancels every smoothing term so the very next frame is usable.
   */
  teleport(x: number, z: number, height = 0): void {
    const terrain: TerrainQuery = this.terrain?.ready ? this.terrain : VOID_TERRAIN;
    // The destination's water, not the one we are standing in: place() needs the
    // float line at (x,z) to decide whether there is anything to stand on there.
    if (this.ctx) this.sampleSurface(this.ctx, x, z);
    this.ctrl.place(terrain, x, z, height);
    if (this.rig.freeFly && this.ctx) {
      // With the free camera up, the camera is what the caller wants moved.
      this.ctx.camera.position.set(this.ctrl.position.x, this.ctrl.position.y + 1.6, this.ctrl.position.z);
    }
    // snap() also unprimes the free camera, which re-seeds it from ctx.camera.
    this.rig.snap();
    this.spawned = true;
  }

  /** Absolute look angles. Yaw 0 faces -Z; positive pitch looks up. */
  setLook(yaw: number, pitch: number): void {
    this.rig.yaw = yaw;
    this.rig.pitch = clamp(pitch, -1.5567, 1.5567);
    this.rig.snap();
  }

  /** Aims the view along a world-space direction. */
  setView(dir: THREE.Vector3): void {
    this.rig.setView(dir);
  }

  /** Camera trauma, 0..1 amplitude. Explosions, impacts, spell feedback. */
  shake(amplitude: number, seconds: number): void {
    this.rig.shake(amplitude, seconds);
  }

  /**
   * Picks a landing spot: dry, not too steep, not on a mountain top, as close
   * to the requested point as possible. Spawning inside a cliff on a
   * procedurally generated island is otherwise a matter of luck.
   */
  private spawnNear(terrain: TerrainQuery, x: number, z: number): void {
    const n = new THREE.Vector3();
    let bestX = x;
    let bestZ = z;
    let bestScore = -Infinity;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < 360; i++) {
      const r = 6 * Math.sqrt(i);
      const a = i * golden;
      const px = clamp(x + Math.cos(a) * r, -terrain.extent + 8, terrain.extent - 8);
      const pz = clamp(z + Math.sin(a) * r, -terrain.extent + 8, terrain.extent - 8);
      const h = terrain.heightAt(px, pz);
      if (h < 1.5 || h > 90) continue;
      terrain.normalAt(px, pz, n);
      if (n.y < 0.93) continue;
      const score = n.y * 20 - r * 0.08 - Math.abs(h - 12) * 0.06;
      if (score > bestScore) {
        bestScore = score;
        bestX = px;
        bestZ = pz;
      }
    }
    this.ctrl.place(terrain, bestX, bestZ);
    this.rig.snap();
  }

  dispose(): void {
    if (this.keyGuard) removeEventListener('keydown', this.keyGuard, { capture: true } as EventListenerOptions);
    this.keyGuard = null;
    for (const off of this.offBus) off();
    this.offBus = [];
    this.avatar?.dispose();
    this.avatar = null;
    this.terrain = null;
    this.water = null;
    // Holds the scene, renderer and camera; leaving it set pins the whole graph.
    this.ctx = null;
  }
}
