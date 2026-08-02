import { Rng, clamp } from './dsp';

/**
 * Every sample in the game is generated here. There are no assets and no
 * network, so noise beds and reverb impulses are synthesised once at unlock and
 * shared by every voice that needs them.
 */

export type NoiseKind = 'white' | 'pink' | 'brown';
export type SpaceName = 'outdoor' | 'cave' | 'interior' | 'underwater';

/** Seconds of noise per loop. Long enough that the period is not a rhythm. */
const NOISE_SECONDS = 4;

interface IRParams {
  readonly seconds: number;
  /** e-folds per second of the late field. Bigger = shorter tail. */
  readonly decayRate: number;
  /** Seconds before the first energy arrives — room size, felt not heard. */
  readonly predelay: number;
  /** Seconds for the late field to reach full density. */
  readonly buildup: number;
  /** Damping-pole coefficient at t=0, 0..1. Two poles, so 12 dB/octave. */
  readonly damp: number;
  /** e-folds per second the brightness itself decays. HF dies first, always. */
  readonly dampRate: number;
  /** Early reflection taps: [seconds, gain]. */
  readonly taps: readonly (readonly [number, number])[];
  /** Room modes: [Hz, gain, decayRate]. Caves ring; open ash does not. */
  readonly modes: readonly (readonly [number, number, number])[];
  /**
   * Convolution power gain. 1.0 puts the wet return at the same level as what
   * was sent to it, so `SPACE_WET` alone decides the wet/dry balance and the
   * numbers in that table mean what they look like.
   */
  readonly gain: number;
}

/**
 * The four spaces the player moves between. Outdoor is deliberately almost dry
 * — the ashlands are open and absorptive, and a wet outdoor bed is the single
 * most common tell of a game that reverbs everything by default.
 */
const SPACES: Record<SpaceName, IRParams> = {
  outdoor: {
    seconds: 1.5,
    decayRate: 5.2,
    predelay: 0.012,
    buildup: 0.09,
    damp: 0.15,
    dampRate: 5.0,
    taps: [
      [0.031, 0.22],
      [0.058, 0.14],
      [0.121, 0.08],
    ],
    modes: [],
    gain: 1.0,
  },
  cave: {
    seconds: 3.6,
    decayRate: 1.35,
    predelay: 0.028,
    buildup: 0.05,
    damp: 0.2,
    dampRate: 1.5,
    taps: [
      [0.017, 0.5],
      [0.029, 0.38],
      [0.047, 0.3],
      [0.071, 0.24],
      [0.113, 0.17],
      [0.169, 0.12],
    ],
    // Lava tubes are long tubes: a handful of low axial modes, nothing above
    // 200 Hz, or it reads as a metal tank instead of rock.
    modes: [
      [43, 0.24, 0.7],
      [67, 0.17, 0.85],
      [104, 0.11, 1.1],
      [151, 0.07, 1.4],
    ],
    gain: 1.6,
  },
  interior: {
    seconds: 1.1,
    decayRate: 6.4,
    predelay: 0.006,
    buildup: 0.02,
    damp: 0.19,
    dampRate: 7.0,
    taps: [
      [0.007, 0.6],
      [0.013, 0.44],
      [0.021, 0.34],
      [0.034, 0.24],
      [0.052, 0.15],
    ],
    modes: [[88, 0.06, 5.0]],
    gain: 1.2,
  },
  underwater: {
    seconds: 2.2,
    decayRate: 2.6,
    predelay: 0.004,
    buildup: 0.14,
    damp: 0.05,
    dampRate: 3.0,
    taps: [[0.019, 0.2]],
    modes: [
      [58, 0.2, 1.6],
      [92, 0.12, 2.1],
    ],
    gain: 1.3,
  },
};

export class Buffers {
  private noiseCache = new Map<NoiseKind, AudioBuffer>();
  private irCache = new Map<SpaceName, AudioBuffer>();
  private rng = new Rng(0x5eed1a);

  constructor(private readonly ctx: AudioContext) {}

  /** Stereo, decorrelated per channel, and seam-crossfaded so the loop is inaudible. */
  noise(kind: NoiseKind): AudioBuffer {
    const hit = this.noiseCache.get(kind);
    if (hit) return hit;

    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * NOISE_SECONDS);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      // Voss-McCartney approximation: three leaky integrators summed with the
      // white source gives a flat-to-the-ear -3 dB/octave slope.
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let brown = 0;
      for (let i = 0; i < len; i++) {
        const w = this.rng.next() * 2 - 1;
        if (kind === 'white') {
          d[i] = w * 0.55;
        } else if (kind === 'pink') {
          b0 = 0.99765 * b0 + w * 0.099046;
          b1 = 0.963 * b1 + w * 0.2965164;
          b2 = 0.57 * b2 + w * 1.0526913;
          d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
        } else {
          brown = (brown + w * 0.028) * 0.998;
          d[i] = brown * 3.2;
        }
      }
      // The loop point is the one place a synthesised bed can betray itself.
      const fade = Math.floor(sr * 0.08);
      for (let i = 0; i < fade; i++) {
        const a = i / fade;
        d[i] = d[i] * a + d[len - fade + i] * (1 - a);
      }
    }
    this.noiseCache.set(kind, buf);
    return buf;
  }

  /** A short mono burst, used as the excitation for plucked-string voices. */
  burst(seconds: number): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const len = Math.max(8, Math.floor(sr * seconds));
    const buf = this.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (this.rng.next() * 2 - 1) * (1 - i / len);
    return buf;
  }

  impulse(space: SpaceName): AudioBuffer {
    const hit = this.irCache.get(space);
    if (hit) return hit;

    const p = SPACES[space];
    const sr = this.ctx.sampleRate;
    const len = Math.max(64, Math.floor(sr * p.seconds));
    const buf = this.ctx.createBuffer(2, len, sr);
    const rng = new Rng(0xa11e0 + space.length * 7919);

    const raw = new Float32Array(len);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const pre = Math.floor(p.predelay * sr * (1 + ch * 0.11));
      raw.fill(0);
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sr;
        const env = Math.exp(-t * p.decayRate);
        // Density ramp: a real tail starts sparse and fills in. Without it the
        // onset is a click of full-bandwidth noise.
        const build = Math.min(1, t / p.buildup);
        raw[i] = (rng.next() * 2 - 1) * env * build;
      }
      // Taps go in BEFORE the damping, not after. A tap written straight into
      // the finished buffer is a one-sample impulse — perfectly white, and
      // audible as a tick of hiss on the front of every reverberated sound.
      // Real early reflections have bounced off the same absorbent rock as the
      // rest of the field and must be filtered with it.
      for (const [dt, g] of p.taps) {
        const i = pre + Math.floor(dt * sr * (1 + ch * 0.07));
        // Sign-flip the right channel's taps: identical early reflections in
        // both ears collapse the image to the centre.
        if (i < len) raw[i] += g * (ch === 1 ? -1 : 1);
      }

      // Two cascaded poles, not one. A 6 dB/octave tail still has most of its
      // energy above 2 kHz and that is what a listener calls "hiss"; 12 dB
      // gets the late field dark enough to read as a room instead of a noise
      // generator with an envelope on it.
      let lp1 = 0;
      let lp2 = 0;
      let dc = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sr;
        const a = clamp(p.damp * Math.exp(-t * p.dampRate) + 0.02, 0.01, 0.99);
        lp1 += a * (raw[i] - lp1);
        lp2 += a * (lp1 - lp2);
        dc += 0.0016 * (lp2 - dc);
        d[i] = lp2 - dc;
      }

      for (const [hz, g, rate] of p.modes) {
        const w = (2 * Math.PI * hz) / sr;
        const phase = rng.next() * Math.PI * 2;
        for (let i = pre; i < len; i++) {
          const t = (i - pre) / sr;
          d[i] += Math.sin(w * (i - pre) + phase) * g * Math.exp(-t * rate);
        }
      }
    }

    // Normalise by ENERGY, which is the only normalisation a convolver
    // respects. Convolving with a noise-like IR multiplies the signal by
    // sqrt(sum of h^2) — for the old RMS-normalised buffers that was
    // sqrt(72000) * 0.055 = 14.8x outdoors and 66x in a cave, i.e. +23 dB and
    // +36 dB of white-noise-convolved signal added to everything with a reverb
    // send. That single line was the bulk of the "the game sounds like white
    // noise" report: the wet return was measured at four times the level of the
    // dry score it was supposed to be sitting behind.
    let energy = 0;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) energy += d[i] * d[i];
    }
    // Channels are convolved independently, so the gain each one applies is set
    // by its own energy, not the sum of both.
    const k = p.gain / (Math.sqrt(energy / 2) || 1);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] *= k;
    }

    this.irCache.set(space, buf);
    return buf;
  }

  dispose(): void {
    this.noiseCache.clear();
    this.irCache.clear();
  }
}
