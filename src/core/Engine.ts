import * as THREE from 'three';
import type { Ctx, EventBus, FrameTime, InputState, System, WorldClock } from './types';

class Bus implements EventBus {
  private map = new Map<string, Set<(p: any) => void>>();
  on<T>(evt: string, fn: (p: T) => void) {
    let s = this.map.get(evt);
    if (!s) this.map.set(evt, (s = new Set()));
    s.add(fn as any);
    return () => void s!.delete(fn as any);
  }
  once<T>(evt: string, fn: (p: T) => void) {
    const off = this.on<T>(evt, (p) => {
      off();
      fn(p);
    });
    return off;
  }
  emit<T>(evt: string, payload?: T) {
    const s = this.map.get(evt);
    if (!s) return;
    // Snapshot: handlers may unsubscribe during dispatch.
    for (const fn of [...s]) {
      try {
        fn(payload);
      } catch (e) {
        console.error(`[bus] handler for "${evt}" threw`, e);
      }
    }
  }
}

class Input implements InputState {
  held = new Set<string>();
  pressed = new Set<string>();
  buttons = new Set<number>();
  mouseDx = 0;
  mouseDy = 0;
  wheel = 0;
  pointerLocked = false;

  constructor(private el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.held.add(e.code);
      this.pressed.add(e.code);
      // Let the browser keep F-keys and devtools shortcuts.
      if (e.code.startsWith('Key') || e.code.startsWith('Digit') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.held.delete(e.code));
    // Focus loss strands held keys down; clear them.
    addEventListener('blur', () => {
      this.held.clear();
      this.buttons.clear();
    });
    el.addEventListener('mousedown', (e) => this.buttons.add(e.button));
    addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDx += e.movementX;
      this.mouseDy += e.movementY;
    });
    addEventListener('wheel', (e) => (this.wheel += e.deltaY), { passive: true });
    el.addEventListener('click', () => {
      if (!this.pointerLocked) el.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === el;
    });
  }
  /** Called by Engine after all systems have read this frame's input. */
  endFrame() {
    this.pressed.clear();
    this.mouseDx = this.mouseDy = this.wheel = 0;
  }
}

export class Engine {
  readonly ctx: Ctx;
  private systems: System[] = [];
  private byId = new Map<string, System>();
  private input: Input;
  private raf = 0;
  private last = 0;
  private started = false;

  constructor(canvas: HTMLCanvasElement) {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // TAA in the post stack handles this; MSAA would cost us the HDR target.
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping; // PostFX owns tonemapping.
    renderer.shadowMap.enabled = true;
    // NOT PCFSoftShadowMap: r185 dropped it from shadowMapTypeDefines, so programs
    // compile SHADOWMAP_TYPE_BASIC (plain sampler2D) while the map is still a
    // compare-mode depth texture. GLES3 rejects that pairing and discards the whole
    // draw — colour and depth — which silently deleted most of the world.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = true;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 12000);
    camera.position.set(0, 12, 0);

    this.input = new Input(canvas);

    const time: FrameTime = { dt: 0, elapsed: 0, frame: 0 };
    const clock: WorldClock = { hour: 7.5, day: 1, scale: 60 };

    this.ctx = {
      renderer,
      scene,
      camera,
      time,
      clock,
      bus: new Bus(),
      input: this.input,
      size: { w: innerWidth, h: innerHeight, dpr: renderer.getPixelRatio() },
      get: <T extends System>(id: string) => this.byId.get(id) as T | undefined,
    };

    addEventListener('resize', () => this.onResize());
  }

  add(...systems: System[]) {
    for (const s of systems) {
      if (this.byId.has(s.id)) throw new Error(`duplicate system id "${s.id}"`);
      this.byId.set(s.id, s);
      this.systems.push(s);
    }
    this.systems.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return this;
  }

  async init(onProgress?: (label: string, pct: number) => void) {
    for (let i = 0; i < this.systems.length; i++) {
      const s = this.systems[i];
      onProgress?.(s.id, i / this.systems.length);
      // Sequential on purpose: systems may depend on earlier ones via Ctx.get,
      // and parallel GPU uploads during synthesis thrash the driver.
      await s.init?.(this.ctx);
    }
    onProgress?.('ready', 1);
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.last = performance.now();
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      const t = this.ctx.time;
      t.dt = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      t.elapsed += t.dt;
      t.frame++;

      const c = this.ctx.clock;
      c.hour += (t.dt * c.scale) / 3600;
      if (c.hour >= 24) {
        c.hour -= 24;
        c.day++;
      }

      for (const s of this.systems) s.update?.(this.ctx);
      for (const s of this.systems) s.lateUpdate?.(this.ctx);
      this.input.endFrame();
    };
    this.raf = requestAnimationFrame(tick);
  }

  private onResize() {
    const { ctx } = this;
    ctx.size.w = innerWidth;
    ctx.size.h = innerHeight;
    ctx.size.dpr = ctx.renderer.getPixelRatio();
    ctx.camera.aspect = innerWidth / innerHeight;
    ctx.camera.updateProjectionMatrix();
    ctx.renderer.setSize(innerWidth, innerHeight, false);
    for (const s of this.systems) s.resize?.(ctx);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const s of this.systems) s.dispose?.();
    this.ctx.renderer.dispose();
  }
}
