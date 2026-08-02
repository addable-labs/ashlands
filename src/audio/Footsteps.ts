import { Surface } from '../core/types';
import type { NoiseKind } from './Buffers';
import type { AudioGraph } from './Graph';
import { Rng, ad, clamp, clamp01, glide, lerp, type Vec3 } from './dsp';

/**
 * A step is a grain cloud, a resonant body and (sometimes) a transient. Which
 * of the three dominates is the whole difference between ash and stone, so the
 * table below is the sound design — the synth underneath it is generic.
 */
interface StepDef {
  readonly noise: NoiseKind;
  /** Seconds of grain cloud. */
  readonly length: number;
  /** How many discrete crunches. 1 is a single impact, 24 is loose gravel. */
  readonly grains: number;
  /** Grain envelope sharpness; high = clicky, low = soft. */
  readonly sharp: number;
  /** Body resonance. */
  readonly bodyHz: number;
  readonly bodyQ: number;
  /** Body sweep end as a ratio of bodyHz. <1 squelches downward. */
  readonly bodySweep: number;
  readonly filter: BiquadFilterType;
  /** Sine thump under the noise, 0 for surfaces that do not couple to the ground. */
  readonly thumpHz: number;
  readonly thump: number;
  /** Ringing tail after the grains — stone has one, ash does not. */
  readonly tail: number;
  readonly tailHz: number;
  readonly level: number;
  /** Semitone spread of the per-step pitch jitter. */
  readonly jitter: number;
  readonly reverb: number;
}

const STEPS: Record<Surface, StepDef> = {
  [Surface.Ash]: {
    noise: 'pink',
    length: 0.19,
    grains: 22,
    sharp: 2.2,
    bodyHz: 900,
    bodyQ: 0.8,
    bodySweep: 0.55,
    filter: 'bandpass',
    thumpHz: 78,
    thump: 0.18,
    tail: 0.05,
    tailHz: 420,
    level: 0.75,
    jitter: 2.5,
    reverb: 0.1,
  },
  [Surface.Rock]: {
    noise: 'white',
    length: 0.1,
    grains: 6,
    sharp: 7,
    bodyHz: 2100,
    bodyQ: 2.2,
    bodySweep: 0.7,
    filter: 'bandpass',
    thumpHz: 110,
    thump: 0.22,
    tail: 0.16,
    tailHz: 1650,
    level: 0.55,
    jitter: 3,
    reverb: 0.34,
  },
  [Surface.Sand]: {
    noise: 'white',
    length: 0.16,
    grains: 30,
    sharp: 1.5,
    bodyHz: 3200,
    bodyQ: 0.6,
    bodySweep: 0.4,
    filter: 'highpass',
    thumpHz: 62,
    thump: 0.1,
    tail: 0.02,
    tailHz: 900,
    level: 0.6,
    jitter: 2,
    reverb: 0.08,
  },
  [Surface.Grass]: {
    noise: 'pink',
    length: 0.17,
    grains: 18,
    sharp: 3,
    bodyHz: 1900,
    bodyQ: 0.9,
    bodySweep: 0.6,
    filter: 'bandpass',
    thumpHz: 88,
    thump: 0.16,
    tail: 0.05,
    tailHz: 700,
    level: 0.62,
    jitter: 3,
    reverb: 0.12,
  },
  [Surface.Mud]: {
    noise: 'brown',
    length: 0.24,
    grains: 4,
    sharp: 1.1,
    bodyHz: 620,
    bodyQ: 5.5,
    // The squelch is the downward sweep of a high-Q band — a wet suck, not a crunch.
    bodySweep: 0.28,
    filter: 'bandpass',
    thumpHz: 68,
    thump: 0.3,
    tail: 0.08,
    tailHz: 260,
    level: 0.78,
    jitter: 4,
    reverb: 0.1,
  },
  [Surface.Lava]: {
    noise: 'white',
    length: 0.28,
    grains: 34,
    sharp: 5,
    bodyHz: 1500,
    bodyQ: 1.2,
    bodySweep: 0.5,
    filter: 'bandpass',
    thumpHz: 46,
    thump: 0.34,
    tail: 0.22,
    tailHz: 320,
    level: 0.6,
    jitter: 3,
    reverb: 0.2,
  },
  [Surface.Snow]: {
    noise: 'white',
    length: 0.15,
    grains: 26,
    sharp: 4.5,
    bodyHz: 4200,
    bodyQ: 1.6,
    bodySweep: 0.85,
    filter: 'bandpass',
    thumpHz: 92,
    thump: 0.12,
    tail: 0.03,
    tailHz: 1200,
    level: 0.62,
    jitter: 3.5,
    reverb: 0.1,
  },
  [Surface.Stone]: {
    noise: 'white',
    length: 0.07,
    grains: 3,
    sharp: 9,
    bodyHz: 2600,
    bodyQ: 3.4,
    bodySweep: 0.8,
    filter: 'bandpass',
    thumpHz: 128,
    thump: 0.26,
    tail: 0.24,
    tailHz: 2200,
    level: 0.55,
    jitter: 2.5,
    reverb: 0.42,
  },
};

const FALLBACK = STEPS[Surface.Ash];

/** Samples in a grain envelope. 160 at 0.2 s is ~1.2 ms resolution: plenty. */
const CURVE_N = 160;

export class Footsteps {
  private rng = new Rng(0x57e95);
  /** Last two pitch offsets, so no two consecutive steps land on the same note. */
  private recent: number[] = [0, 0];

  constructor(private readonly graph: AudioGraph) {}

  /**
   * @param foot 1 or 2 — alternates the stereo bias so a walk has a gait.
   * @param speed metres/second; drives level and brightness.
   * @param submersion 0..1 from the character controller; past a third of a
   *        body the step is a splash regardless of what is underfoot.
   */
  step(surface: number, foot: number, speed: number, submersion: number, position?: Vec3 | null): void {
    if (submersion > 0.32) {
      this.splash(clamp01(submersion) * 0.6 + clamp01(speed / 6) * 0.5, position, foot);
      if (submersion > 0.8) return;
    }
    const def = STEPS[surface as Surface] ?? FALLBACK;
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;

    // Reject a repeat of either of the last two pitches. Identical consecutive
    // footsteps are the single most noticeable defect in procedural audio.
    let semis = 0;
    for (let i = 0; i < 6; i++) {
      semis = this.rng.range(-def.jitter, def.jitter);
      if (Math.abs(semis - this.recent[0]) > def.jitter * 0.35 && Math.abs(semis - this.recent[1]) > def.jitter * 0.25) break;
    }
    this.recent[1] = this.recent[0];
    this.recent[0] = semis;
    const rate = Math.pow(2, semis / 12);

    const effort = clamp01(speed / 7);
    const level = def.level * lerp(0.42, 1.05, effort) * this.rng.range(0.86, 1.14);
    const v = g.voice({
      bus: 'sfx',
      gain: level,
      position: position ?? null,
      pan: position ? 0 : (foot === 1 ? -0.16 : 0.16),
      reverb: def.reverb,
      refDistance: 3,
      maxDistance: 60,
      rolloff: 1.6,
    });
    if (!v) return;

    const t = v.t;
    const dur = def.length * rate;

    const src = ctx.createBufferSource();
    src.buffer = g.buffers?.noise(def.noise) ?? null;
    src.loop = true;
    // Reading from a random point in a 4 s bed is free extra variation.
    const off = this.rng.range(0, 3.5);
    src.playbackRate.value = rate;

    const body = ctx.createBiquadFilter();
    body.type = def.filter;
    body.Q.value = def.bodyQ;
    const hz = def.bodyHz * rate * lerp(0.85, 1.2, effort);
    glide(body.frequency, t, [
      [0, hz],
      [dur, hz * def.bodySweep],
    ]);

    const cloud = ctx.createGain();
    cloud.gain.setValueCurveAtTime(this.grainCurve(def), t, dur);

    src.connect(body).connect(cloud).connect(v.out);
    src.start(t, off);
    src.stop(t + dur + 0.02);
    v.keep(src);
    v.keep(body);
    v.keep(cloud);

    if (def.thump > 0) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const th = def.thumpHz * rate;
      glide(o.frequency, t, [
        [0, th * 1.6],
        [0.055, th],
      ]);
      const og = ctx.createGain();
      ad(og.gain, t, def.thump * lerp(0.5, 1.2, effort), 0.004, 0.09);
      o.connect(og).connect(v.out);
      o.start(t);
      o.stop(t + 0.14);
      v.keep(o);
      v.keep(og);
    }

    if (def.tail > 0.03) {
      const ring = ctx.createBiquadFilter();
      ring.type = 'bandpass';
      ring.frequency.value = def.tailHz * rate * this.rng.range(0.9, 1.12);
      ring.Q.value = 9;
      const rg = ctx.createGain();
      ad(rg.gain, t, def.tail * level * 0.8, 0.002, def.tail * 1.6);
      const rs = ctx.createBufferSource();
      rs.buffer = g.buffers?.noise('white') ?? null;
      rs.loop = true;
      rs.playbackRate.value = rate;
      rs.connect(ring).connect(rg).connect(v.out);
      rs.start(t, this.rng.range(0, 3.5));
      rs.stop(t + def.tail * 2 + 0.05);
      v.keep(rs);
      v.keep(ring);
      v.keep(rg);
    }

    v.release(dur + def.tail * 2 + 0.2);
  }

  /** Hard landing: the same surface, hit far harder, plus a body thud. */
  land(impact: number, surface: number, position?: Vec3 | null): void {
    const force = clamp01((impact - 2) / 14);
    this.step(surface, 1, 7 + force * 6, 0, position);
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx || force < 0.05) return;
    const v = g.voice({ bus: 'sfx', gain: 0.5 + force * 0.7, position: position ?? null, reverb: 0.2 });
    if (!v) return;
    const t = v.t;
    const o = ctx.createOscillator();
    o.type = 'sine';
    glide(o.frequency, t, [
      [0, 120],
      [0.09, 44],
      [0.3, 30],
    ]);
    const og = ctx.createGain();
    ad(og.gain, t, 0.8, 0.005, 0.3);
    o.connect(og).connect(v.out);
    o.start(t);
    o.stop(t + 0.4);
    v.keep(o);
    v.keep(og);
    v.release(0.5);
  }

  splash(strength: number, position?: Vec3 | null, foot = 1): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const s = clamp(strength, 0.15, 1.6);
    const v = g.voice({
      bus: 'sfx',
      gain: 0.8 * s,
      position: position ?? null,
      pan: position ? 0 : (foot === 1 ? -0.2 : 0.2),
      reverb: 0.22,
      refDistance: 4,
      maxDistance: 90,
    });
    if (!v) return;
    const t = v.t;
    const dur = 0.16 + s * 0.2;

    const src = ctx.createBufferSource();
    src.buffer = g.buffers?.noise('white') ?? null;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    // Up fast, down slow: the sheet of water rises then falls back.
    glide(bp.frequency, t, [
      [0, 700],
      [0.03, 3400 * (0.7 + s * 0.5)],
      [dur, 500],
    ]);
    const gn = ctx.createGain();
    ad(gn.gain, t, 0.9, 0.006, dur);
    src.connect(bp).connect(gn).connect(v.out);
    src.start(t, this.rng.range(0, 3.5));
    src.stop(t + dur + 0.05);
    v.keep(src);
    v.keep(bp);
    v.keep(gn);

    // Droplets. Three or four short high plinks scattered after the sheet.
    const drops = 2 + this.rng.int(3);
    for (let i = 0; i < drops; i++) {
      const dt = this.rng.range(0.04, 0.24) * (0.6 + s);
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f = this.rng.range(1400, 3600);
      glide(o.frequency, t + dt, [
        [0, f],
        [0.05, f * 1.5],
      ]);
      const og = ctx.createGain();
      ad(og.gain, t + dt, 0.1 * s * this.rng.range(0.5, 1), 0.002, 0.05);
      o.connect(og).connect(v.out);
      o.start(t + dt);
      o.stop(t + dt + 0.09);
      v.keep(o);
      v.keep(og);
    }
    v.release(dur + 0.5);
  }

  /**
   * Amplitude curve for the grain cloud. Each grain is an exponential spike;
   * the cloud as a whole decays. Regenerated per step, which is why no two
   * footsteps on ash are ever the same.
   */
  private grainCurve(def: StepDef) {
    const c = new Float32Array(CURVE_N);
    const n = Math.max(1, Math.round(def.grains * this.rng.range(0.7, 1.3)));
    for (let gi = 0; gi < n; gi++) {
      // Bias grains toward the start: a foot lands, it does not fade in.
      const u = Math.pow(this.rng.next(), 1.6);
      const pos = u * (CURVE_N - 2);
      const amp = this.rng.range(0.35, 1) * (1 - u * 0.55);
      const width = Math.max(1, CURVE_N / (def.sharp * 6));
      const from = Math.max(0, Math.floor(pos));
      for (let i = from; i < CURVE_N; i++) {
        const d = (i - pos) / width;
        if (d > 6) break;
        c[i] += amp * Math.exp(-d * d * 0.9);
      }
    }
    let peak = 1e-4;
    for (let i = 0; i < CURVE_N; i++) {
      c[i] *= 1 - i / CURVE_N;
      if (c[i] > peak) peak = c[i];
    }
    const k = 1 / peak;
    for (let i = 0; i < CURVE_N; i++) c[i] *= k;
    c[CURVE_N - 1] = 0;
    return c;
  }
}
