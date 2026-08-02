import { Buffers, type NoiseKind, type SpaceName } from './Buffers';
import { clamp, clamp01, softClipCurve, type Vec3 } from './dsp';

export type BusName = 'music' | 'sfx' | 'ambience' | 'ui';

export interface VoiceOptions {
  bus?: BusName;
  gain?: number;
  /** World-space emitter position. Omit for a head-locked, non-positional voice. */
  position?: Vec3 | null;
  /** 0..1 send into the current space's convolver. */
  reverb?: number;
  /** Stereo placement for non-positional voices, -1..1. */
  pan?: number;
  /** HRTF costs real CPU; reserve it for voices the player must localise. */
  hrtf?: boolean;
  refDistance?: number;
  maxDistance?: number;
  rolloff?: number;
  /** Directional cone. A screech aimed away from you must be quieter. */
  orientation?: Vec3;
  coneInner?: number;
  coneOuter?: number;
  coneOuterGain?: number;
}

/** Handle a synth function writes into. Never constructed directly. */
export interface Voice {
  readonly ctx: AudioContext;
  readonly out: GainNode;
  /** Absolute context time the voice should begin at. */
  readonly t: number;
  keep(node: AudioNode): void;
  /** Tear the voice down `seconds` after `t`. Idempotent. */
  release(seconds: number): void;
}

/**
 * Past this the mix is mud anyway, and every extra node costs a graph
 * traversal. Dropping the newest voice is correct: the transient you already
 * hear masks the one you would have added.
 */
const MAX_VOICES = 56;

/**
 * The ambience bed is resident and never stops, so its fader is not a taste
 * setting — it is the noise floor every other sound in the game has to be
 * heard over. At 0.7 it measured louder than the score it was supposed to sit
 * behind (bed 0.070 RMS against music 0.048), which is the balance a listener
 * describes as "constant hiss with something happening in it".
 */
const BUS_DEFAULTS: Record<BusName, number> = {
  music: 0.62,
  sfx: 0.92,
  ambience: 0.22,
  ui: 0.8,
};

/** Wet trim per space, applied on top of each voice's own send amount. */
const SPACE_WET: Record<SpaceName, number> = {
  outdoor: 0.28,
  cave: 1.0,
  interior: 0.62,
  underwater: 0.85,
};

class VoiceHandle implements Voice {
  private nodes: AudioNode[] = [];
  private done = false;

  constructor(
    readonly ctx: AudioContext,
    readonly out: GainNode,
    readonly t: number,
    private readonly graph: AudioGraph,
  ) {}

  keep(node: AudioNode): void {
    if (!this.done) this.nodes.push(node);
  }

  release(seconds: number): void {
    if (this.done) return;
    this.done = true;
    const ms = Math.max(0, (this.t + seconds - this.ctx.currentTime) * 1000) + 180;
    this.graph.retire(this, ms);
  }

  /** Called by the graph's timer. Disconnects everything the voice allocated. */
  teardown(): void {
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* already detached */
      }
    }
    this.nodes.length = 0;
    this.out.disconnect();
  }
}

/**
 * The mixer. Master / music / sfx / ambience / ui buses, a limiter and soft
 * clipper on the master, a global muffle filter for submersion, and an A/B
 * convolver pair so the space can crossfade rather than switch.
 *
 * Nothing here is built until `unlock()` succeeds. Browsers refuse to start
 * audio without a user gesture, and constructing a context that will never run
 * just leaks a hardware stream.
 */
export class AudioGraph {
  private _ctx: AudioContext | null = null;
  private _buffers: Buffers | null = null;

  private preMaster: GainNode | null = null;
  private master: GainNode | null = null;
  private muffleLp: BiquadFilterNode | null = null;
  private muffleShelf: BiquadFilterNode | null = null;
  private buses = new Map<BusName, GainNode>();
  /** Ambience and music sit behind a second gain so ducking never fights volume. */
  private ducks = new Map<BusName, GainNode>();
  /**
   * Post-fader aux sends, one per bus, whose gains mirror the bus fader and its
   * duck. Without them, muting a bus leaves its reverb tail audible — an
   * ambience bed feeding a convolver never stops just because you turned the
   * bed down.
   */
  private sendIn = new Map<BusName, GainNode>();
  private sendDucks = new Map<BusName, GainNode>();

  private send: GainNode | null = null;
  private convA: ConvolverNode | null = null;
  private convB: ConvolverNode | null = null;
  private wetA: GainNode | null = null;
  private wetB: GainNode | null = null;
  private activeIsA = true;
  private _space: SpaceName = 'outdoor';

  private analyser: AnalyserNode | null = null;
  private meter: Float32Array<ArrayBuffer> | null = null;

  private volumes: Record<BusName, number> = { ...BUS_DEFAULTS };
  private _masterVolume = 0.9;
  private _muted = false;
  private muffle = 0;
  private live = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private failed = false;

  get ctx(): AudioContext | null {
    return this._ctx;
  }

  get buffers(): Buffers | null {
    return this._buffers;
  }

  get running(): boolean {
    return this._ctx !== null && this._ctx.state === 'running';
  }

  get space(): SpaceName {
    return this._space;
  }

  get voiceCount(): number {
    return this.live;
  }

  /** Post-limiter RMS of the last frame, 0..1. */
  get level(): number {
    const a = this.analyser;
    const m = this.meter;
    if (!a || !m) return 0;
    a.getFloatTimeDomainData(m);
    let sum = 0;
    for (let i = 0; i < m.length; i++) sum += m[i] * m[i];
    return Math.sqrt(sum / m.length);
  }

  /**
   * Build the graph. Safe to call repeatedly and from any gesture handler; if
   * the platform refuses, the whole subsystem degrades to silence rather than
   * throwing into somebody else's event handler.
   */
  unlock(): boolean {
    if (this._ctx) {
      if (this._ctx.state === 'suspended') void this._ctx.resume().catch(() => undefined);
      return true;
    }
    if (this.failed || typeof AudioContext === 'undefined') return false;
    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this._ctx = ctx;
      this._buffers = new Buffers(ctx);
      this.build(ctx);
      void ctx.resume().catch(() => undefined);
      return true;
    } catch {
      this.failed = true;
      this._ctx = null;
      return false;
    }
  }

  private build(ctx: AudioContext): void {
    const master = ctx.createGain();
    master.gain.value = this._muted ? 0 : this._masterVolume;

    // Limiter, not a compressor: high ratio, hard knee, fast attack. It exists
    // so a spell landing during an ash storm cannot clip the bus, and it must
    // be inaudible until it is needed.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;

    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = '2x';

    master.connect(limiter).connect(clip).connect(ctx.destination);

    // Side-chain tap, not in the signal path: gives the settings UI a meter and
    // gives automated tests something to assert on other than "did not throw".
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    clip.connect(analyser);
    this.analyser = analyser;
    this.meter = new Float32Array(analyser.fftSize);

    // Submersion filtering sits before the master so it catches the reverb
    // returns too — a dry world under twelve feet of water is uncanny.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 20000;
    lp.Q.value = 0.7;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 1400;
    shelf.gain.value = 0;

    const pre = ctx.createGain();
    pre.connect(lp).connect(shelf).connect(master);

    const send = ctx.createGain();
    send.gain.value = 1;

    for (const name of ['music', 'sfx', 'ambience', 'ui'] as const) {
      const g = ctx.createGain();
      g.gain.value = this.volumes[name];
      const s = ctx.createGain();
      s.gain.value = this.volumes[name];
      if (name === 'ui') {
        // UI must stay legible while the player is underwater.
        g.connect(master);
        s.connect(send);
      } else if (name === 'music' || name === 'ambience') {
        const duck = ctx.createGain();
        duck.gain.value = 1;
        g.connect(duck).connect(pre);
        const sduck = ctx.createGain();
        sduck.gain.value = 1;
        s.connect(sduck).connect(send);
        this.ducks.set(name, duck);
        this.sendDucks.set(name, sduck);
      } else {
        g.connect(pre);
        s.connect(send);
      }
      this.buses.set(name, g);
      this.sendIn.set(name, s);
    }

    const convA = ctx.createConvolver();
    const convB = ctx.createConvolver();
    convA.normalize = false;
    convB.normalize = false;
    const wetA = ctx.createGain();
    const wetB = ctx.createGain();
    convA.buffer = this._buffers!.impulse(this._space);
    wetA.gain.value = SPACE_WET[this._space];
    wetB.gain.value = 0;
    send.connect(convA).connect(wetA).connect(pre);
    send.connect(convB).connect(wetB).connect(pre);

    this.preMaster = pre;
    this.master = master;
    this.muffleLp = lp;
    this.muffleShelf = shelf;
    this.send = send;
    this.convA = convA;
    this.convB = convB;
    this.wetA = wetA;
    this.wetB = wetB;
    this.applyMuffle(0);
  }

  /** Allocates a voice, or null if audio is not running or the pool is full. */
  voice(opts: VoiceOptions = {}): Voice | null {
    const ctx = this._ctx;
    if (!ctx || ctx.state !== 'running') return null;
    if (this.live >= MAX_VOICES) return null;
    const bus = this.buses.get(opts.bus ?? 'sfx');
    if (!bus) return null;

    const out = ctx.createGain();
    out.gain.value = opts.gain ?? 1;

    let tail: AudioNode = out;
    if (opts.position) {
      const p = ctx.createPanner();
      p.panningModel = opts.hrtf ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = opts.refDistance ?? 6;
      p.maxDistance = opts.maxDistance ?? 900;
      p.rolloffFactor = opts.rolloff ?? 1.1;
      p.positionX.value = opts.position.x;
      p.positionY.value = opts.position.y;
      p.positionZ.value = opts.position.z;
      if (opts.orientation) {
        p.orientationX.value = opts.orientation.x;
        p.orientationY.value = opts.orientation.y;
        p.orientationZ.value = opts.orientation.z;
        p.coneInnerAngle = opts.coneInner ?? 90;
        p.coneOuterAngle = opts.coneOuter ?? 250;
        p.coneOuterGain = opts.coneOuterGain ?? 0.35;
      }
      out.connect(p);
      tail = p;
    } else if (opts.pan !== undefined && opts.pan !== 0) {
      const sp = ctx.createStereoPanner();
      sp.pan.value = clamp(opts.pan, -1, 1);
      out.connect(sp);
      tail = sp;
    }

    tail.connect(bus);
    const wet = opts.reverb ?? 0;
    const aux = this.sendIn.get(opts.bus ?? 'sfx');
    if (wet > 0 && aux) {
      const s = ctx.createGain();
      s.gain.value = wet;
      tail.connect(s).connect(aux);
      // Kept on the handle so teardown drops the send with the voice.
      const handle = new VoiceHandle(ctx, out, ctx.currentTime, this);
      handle.keep(s);
      if (tail !== out) handle.keep(tail);
      this.live++;
      return handle;
    }

    const handle = new VoiceHandle(ctx, out, ctx.currentTime, this);
    if (tail !== out) handle.keep(tail);
    this.live++;
    return handle;
  }

  /** Internal: schedules a handle's teardown. */
  retire(handle: VoiceHandle, ms: number): void {
    const id = setTimeout(() => {
      this.timers.delete(id);
      this.live = Math.max(0, this.live - 1);
      handle.teardown();
    }, ms);
    this.timers.add(id);
  }

  /** A looping noise source already connected to `dest`, started immediately. */
  loop(kind: NoiseKind, dest: AudioNode, offset = 0): AudioBufferSourceNode | null {
    const ctx = this._ctx;
    const buffers = this._buffers;
    if (!ctx || !buffers) return null;
    const src = ctx.createBufferSource();
    src.buffer = buffers.noise(kind);
    src.loop = true;
    src.connect(dest);
    src.start(ctx.currentTime, offset % (src.buffer?.duration ?? 1));
    return src;
  }

  bus(name: BusName): GainNode | null {
    return this.buses.get(name) ?? null;
  }

  /** Post-fader aux input for a bus. Resident voices send here, never to the
   * convolvers directly. */
  reverbSend(bus: BusName): GainNode | null {
    return this.sendIn.get(bus) ?? null;
  }

  setVolume(name: BusName, v: number): void {
    this.volumes[name] = clamp01(v);
    const ctx = this._ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.buses.get(name)?.gain.setTargetAtTime(this.volumes[name], t, 0.05);
    this.sendIn.get(name)?.gain.setTargetAtTime(this.volumes[name], t, 0.05);
  }

  getVolume(name: BusName): number {
    return this.volumes[name];
  }

  get masterVolume(): number {
    return this._masterVolume;
  }

  setMasterVolume(v: number): void {
    this._masterVolume = clamp01(v);
    if (this.master && this._ctx) {
      this.master.gain.setTargetAtTime(this._muted ? 0 : this._masterVolume, this._ctx.currentTime, 0.05);
    }
  }

  get muted(): boolean {
    return this._muted;
  }

  setMuted(m: boolean): void {
    this._muted = m;
    this.setMasterVolume(this._masterVolume);
  }

  /** 0 = dry air, 1 = fully submerged. Also darkens the reverb returns. */
  applyMuffle(amount: number): void {
    this.muffle = clamp01(amount);
    const ctx = this._ctx;
    if (!ctx || !this.muffleLp || !this.muffleShelf) return;
    const t = ctx.currentTime;
    // 20 kHz -> 380 Hz is roughly what a head under water actually does.
    const hz = 20000 * Math.pow(380 / 20000, this.muffle);
    this.muffleLp.frequency.setTargetAtTime(hz, t, 0.12);
    this.muffleLp.Q.setTargetAtTime(0.7 + this.muffle * 2.4, t, 0.12);
    this.muffleShelf.gain.setTargetAtTime(-16 * this.muffle, t, 0.12);
  }

  /** Ducks a bus by `amount` (0..1) with a slow release. */
  setDuck(name: 'music' | 'ambience', amount: number, attack = 0.08, release = 0.5): void {
    const ctx = this._ctx;
    const g = this.ducks.get(name);
    const s = this.sendDucks.get(name);
    if (!ctx || !g) return;
    const target = 1 - clamp01(amount);
    const tau = target < g.gain.value ? attack : release;
    g.gain.setTargetAtTime(target, ctx.currentTime, tau);
    s?.gain.setTargetAtTime(target, ctx.currentTime, tau);
  }

  /**
   * Crossfades to a new space over `seconds`. The two convolvers exist so the
   * old tail can ring out while the new one builds; swapping one buffer would
   * cut every reflection in the room dead.
   */
  setSpace(space: SpaceName, seconds = 1.4): void {
    if (space === this._space) return;
    this._space = space;
    const ctx = this._ctx;
    if (!ctx || !this.convA || !this.convB || !this.wetA || !this.wetB || !this._buffers) return;
    const nextIsA = !this.activeIsA;
    const conv = nextIsA ? this.convA : this.convB;
    const rising = nextIsA ? this.wetA : this.wetB;
    const falling = nextIsA ? this.wetB : this.wetA;
    conv.buffer = this._buffers.impulse(space);
    const t = ctx.currentTime;
    rising.gain.cancelScheduledValues(t);
    falling.gain.cancelScheduledValues(t);
    rising.gain.setValueAtTime(rising.gain.value, t);
    falling.gain.setValueAtTime(falling.gain.value, t);
    rising.gain.linearRampToValueAtTime(SPACE_WET[space], t + seconds);
    falling.gain.linearRampToValueAtTime(0, t + seconds);
    this.activeIsA = nextIsA;
  }

  /** Listener follows the camera. Vectors come straight off its world matrix. */
  setListener(pos: Vec3, forward: Vec3, up: Vec3): void {
    const ctx = this._ctx;
    if (!ctx) return;
    const l = ctx.listener;
    // Older engines expose only the legacy setters; the param path is the one
    // that interpolates, so prefer it and quietly accept the fallback.
    if (l.positionX) {
      const t = ctx.currentTime;
      const tau = 0.02;
      l.positionX.setTargetAtTime(pos.x, t, tau);
      l.positionY.setTargetAtTime(pos.y, t, tau);
      l.positionZ.setTargetAtTime(pos.z, t, tau);
      l.forwardX.setTargetAtTime(forward.x, t, tau);
      l.forwardY.setTargetAtTime(forward.y, t, tau);
      l.forwardZ.setTargetAtTime(forward.z, t, tau);
      l.upX.setTargetAtTime(up.x, t, tau);
      l.upY.setTargetAtTime(up.y, t, tau);
      l.upZ.setTargetAtTime(up.z, t, tau);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  suspend(): void {
    if (this._ctx?.state === 'running') void this._ctx.suspend().catch(() => undefined);
  }

  resume(): void {
    if (this._ctx?.state === 'suspended') void this._ctx.resume().catch(() => undefined);
  }

  dispose(): void {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.buses.clear();
    this.ducks.clear();
    this.sendIn.clear();
    this.sendDucks.clear();
    this._buffers?.dispose();
    this._buffers = null;
    const ctx = this._ctx;
    this._ctx = null;
    if (ctx) void ctx.close().catch(() => undefined);
  }
}
