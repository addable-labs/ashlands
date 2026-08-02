import type { AudioGraph } from './Graph';
import { Rng, ad, ahr, clamp01, glide, lerp, noteHz, saturationCurve, type Vec3 } from './dsp';

/**
 * Schools are timbres, not samples. Every school gets its own synthesis path
 * because what distinguishes fire from frost is topology — saturated noise
 * versus a ringing partial cluster — and no amount of filtering turns one into
 * the other.
 */
export type School =
  | 'fire'
  | 'frost'
  | 'shock'
  | 'restoration'
  | 'illusion'
  | 'conjuration'
  | 'alteration'
  | 'mysticism';

export type Phase = 'charge' | 'release' | 'impact';

/** Aliases so 'vfx:spawn' effect names map straight onto a school. */
const ALIAS: Record<string, School> = {
  fire: 'fire',
  flame: 'fire',
  destruction: 'fire',
  frost: 'frost',
  ice: 'frost',
  shock: 'shock',
  lightning: 'shock',
  restore: 'restoration',
  restoration: 'restoration',
  heal: 'restoration',
  alteration: 'alteration',
  illusion: 'illusion',
  mysticism: 'mysticism',
  conjure: 'conjuration',
  conjuration: 'conjuration',
  summon: 'conjuration',
  drain: 'mysticism',
};

export function schoolOf(effect: string): School | null {
  const sep = effect.indexOf(':');
  const key = (sep < 0 ? effect : effect.slice(0, sep)).toLowerCase();
  return ALIAS[key] ?? null;
}

export function phaseOf(effect: string): Phase {
  const sep = effect.indexOf(':');
  if (sep < 0) return 'release';
  const p = effect.slice(sep + 1).toLowerCase();
  return p === 'charge' ? 'charge' : p === 'impact' || p === 'hit' ? 'impact' : 'release';
}

/** Root of each school's harmony, as a MIDI note. Shared with the score's key. */
const ROOT: Record<School, number> = {
  fire: 38,
  frost: 62,
  shock: 57,
  restoration: 50,
  illusion: 55,
  conjuration: 33,
  alteration: 45,
  mysticism: 48,
};

/** Inharmonic partial ratios for the ringing schools. */
const FROST_PARTIALS = [1, 2.41, 3.17, 4.63, 5.89, 7.31] as const;
const WARD_PARTIALS = [1, 1.5, 2.0, 3.0, 4.5] as const;

export class Magic {
  private rng = new Rng(0x3a91c);
  private hot = saturationCurve(4.5);

  constructor(private readonly graph: AudioGraph) {}

  cast(school: School, phase: Phase = 'release', position?: Vec3 | null, power = 1): void {
    const p = clamp01(power * 0.5 + 0.5);
    switch (school) {
      case 'fire':
        this.fire(phase, position, p);
        break;
      case 'frost':
        this.frost(phase, position, p);
        break;
      case 'shock':
        this.shock(phase, position, p);
        break;
      case 'restoration':
      case 'alteration':
        this.warm(phase, position, p, school);
        break;
      case 'illusion':
      case 'mysticism':
        this.shimmer(phase, position, p, school);
        break;
      case 'conjuration':
        this.conjure(phase, position, p);
        break;
    }
  }

  /** Roaring saturated noise: a lowpass falling through a driven noise bed. */
  private fire(phase: Phase, position: Vec3 | null | undefined, power: number): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const charging = phase === 'charge';
    const dur = charging ? 1.0 : 1.7;
    const v = g.voice({
      bus: 'sfx',
      gain: (charging ? 0.3 : 0.72) * power,
      position: position ?? null,
      reverb: 0.28,
      refDistance: 6,
      maxDistance: 220,
      hrtf: true,
    });
    if (!v) return;
    const t = v.t;

    const shaper = ctx.createWaveShaper();
    shaper.curve = this.hot;
    shaper.connect(v.out);
    const drive = ctx.createGain();
    drive.gain.value = 2.6;
    drive.connect(shaper);

    const src = ctx.createBufferSource();
    src.buffer = g.buffers?.noise('brown') ?? null;
    src.loop = true;
    src.playbackRate.value = this.rng.range(0.85, 1.15);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.4;
    // Charging is the same gesture inverted: the band closes in rather than
    // blowing open. Sharing the shape is what makes the two read as one spell.
    glide(
      lp.frequency,
      t,
      charging
        ? [
            [0, 380],
            [dur, 1500],
          ]
        : [
            [0, 5200],
            [0.12, 2400],
            [dur, 260],
          ],
    );
    const gn = ctx.createGain();
    if (charging) ahr(gn.gain, t, 0.55, dur * 0.85, 0.05, 0.2);
    else ad(gn.gain, t, 1.0, 0.012, dur);
    src.connect(lp).connect(gn).connect(drive);
    src.start(t, this.rng.range(0, 3.5));
    src.stop(t + dur + 0.2);
    for (const n of [shaper, drive, src, lp, gn]) v.keep(n);

    if (!charging) {
      // The chest hit. A flame without a body is a hiss.
      const o = ctx.createOscillator();
      o.type = 'triangle';
      const f = noteHz(ROOT.fire);
      glide(o.frequency, t, [
        [0, f * 2],
        [0.18, f],
        [0.9, f * 0.5],
      ]);
      const og = ctx.createGain();
      ad(og.gain, t, 0.5 * power, 0.01, 0.75);
      o.connect(og).connect(v.out);
      o.start(t);
      o.stop(t + 1.0);
      v.keep(o);
      v.keep(og);
    }
    v.release(dur + 0.4);
  }

  /** A crystalline cluster: inharmonic partials, long decay, glassy noise on top. */
  private frost(phase: Phase, position: Vec3 | null | undefined, power: number): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const charging = phase === 'charge';
    const dur = charging ? 1.1 : 2.1;
    const v = g.voice({
      bus: 'sfx',
      gain: (charging ? 0.24 : 0.5) * power,
      position: position ?? null,
      reverb: 0.5,
      refDistance: 6,
      maxDistance: 200,
      hrtf: true,
    });
    if (!v) return;
    const t = v.t;
    const root = noteHz(ROOT.frost) * this.rng.range(0.97, 1.03);

    for (let i = 0; i < FROST_PARTIALS.length; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const hz = root * FROST_PARTIALS[i];
      if (charging) {
        glide(o.frequency, t, [
          [0, hz * 0.85],
          [dur, hz],
        ]);
      } else {
        o.frequency.value = hz;
      }
      const og = ctx.createGain();
      const amp = (0.36 / (1 + i * 0.8)) * power;
      // Higher partials die first, which is what makes it read as struck glass
      // rather than as an organ chord.
      const decay = dur / (1 + i * 0.35);
      if (charging) ahr(og.gain, t, amp * 0.6, dur * 0.8, 0.02, 0.25);
      else ad(og.gain, t, amp, 0.004 + i * 0.002, decay);
      o.connect(og).connect(v.out);
      o.start(t);
      o.stop(t + dur + 0.3);
      v.keep(o);
      v.keep(og);
    }

    const air = ctx.createBufferSource();
    air.buffer = g.buffers?.noise('white') ?? null;
    air.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5200;
    const ag = ctx.createGain();
    ad(ag.gain, t, 0.22 * power, 0.006, dur * 0.6);
    air.connect(hp).connect(ag).connect(v.out);
    air.start(t, this.rng.range(0, 3.5));
    air.stop(t + dur);
    v.keep(air);
    v.keep(hp);
    v.keep(ag);
    v.release(dur + 0.5);
  }

  /** Bright transient, then a decaying buzz: AM square through a falling filter. */
  private shock(phase: Phase, position: Vec3 | null | undefined, power: number): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const charging = phase === 'charge';
    const dur = charging ? 0.9 : 1.15;
    const v = g.voice({
      bus: 'sfx',
      gain: (charging ? 0.85 : 2.6) * power,
      position: position ?? null,
      reverb: 0.32,
      refDistance: 6,
      maxDistance: 260,
      hrtf: true,
    });
    if (!v) return;
    const t = v.t;

    const f = noteHz(ROOT.shock);
    const carrier: readonly (readonly [number, number])[] = charging
      ? [[0, f * 0.5], [dur, f * 1.6]]
      : [[0, f * 3], [dur, f * 0.9]];

    if (!charging) {
      // The strike. Half of it is a noise crack — a spark genuinely is
      // broadband — but a purely noisy transient is indistinguishable from a
      // click, so a pitched partial two octaves above the carrier goes with it.
      // That is what gives the bolt a discernible "ping" rather than a "tsh".
      const crack = ctx.createBufferSource();
      crack.buffer = g.buffers?.noise('white') ?? null;
      crack.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3000;
      const cg = ctx.createGain();
      ad(cg.gain, t, 0.7, 0.0008, 0.035);
      crack.connect(hp).connect(cg).connect(v.out);
      crack.start(t, this.rng.range(0, 3.5));
      crack.stop(t + 0.08);
      v.keep(crack);
      v.keep(hp);
      v.keep(cg);

      const ping = ctx.createOscillator();
      ping.type = 'triangle';
      glide(ping.frequency, t, [
        [0, f * 12],
        [0.14, f * 8],
      ]);
      const pg = ctx.createGain();
      ad(pg.gain, t, 0.5, 0.001, 0.13);
      ping.connect(pg).connect(v.out);
      ping.start(t);
      ping.stop(t + 0.2);
      v.keep(ping);
      v.keep(pg);
    }

    const o = ctx.createOscillator();
    o.type = 'square';
    glide(o.frequency, t, carrier);

    // Ring modulation is what makes electricity read as electricity. The
    // modulator tracks the carrier at a quarter of its frequency: sidebands
    // land at n*F +/- F/4, which is still a harmonic series (fundamental F/4),
    // so the buzz keeps a pitch. A modulator sweeping 63->128 Hz against a
    // carrier sweeping 660->198 Hz — which is what this was — passes through
    // every ratio on the way and produces a spectrum with no fundamental at
    // all. "Inharmonic" and "noise" are the same thing to a listener.
    const ring = ctx.createGain();
    ring.gain.value = 0;
    const mod = ctx.createOscillator();
    mod.type = 'sawtooth';
    glide(mod.frequency, t, carrier.map(([at, hz]) => [at, hz / 4] as const));
    const modAmt = ctx.createGain();
    modAmt.gain.value = 0.7;
    mod.connect(modAmt).connect(ring.gain);
    // Carrier bleed. At full modulation depth the mean gain collapses and the
    // buzz vanishes under everything else in the mix.
    const dc = ctx.createConstantSource();
    dc.offset.value = 0.5;
    dc.connect(ring.gain);
    dc.start(t);
    dc.stop(t + dur + 0.1);
    v.keep(dc);
    o.connect(ring);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.5;
    glide(bp.frequency, t, charging ? [[0, 900], [dur, 3400]] : [[0, 4200], [dur, 700]]);
    const gn = ctx.createGain();
    if (charging) ahr(gn.gain, t, 0.4, dur * 0.85, 0.02, 0.15);
    else ad(gn.gain, t, 0.55, 0.003, dur);
    ring.connect(bp).connect(gn).connect(v.out);
    o.start(t);
    mod.start(t);
    o.stop(t + dur + 0.1);
    mod.stop(t + dur + 0.1);
    for (const n of [o, ring, mod, modAmt, bp, gn]) v.keep(n);
    v.release(dur + 0.3);
  }

  /** Restoration and alteration: a warm consonant swell, no noise at all. */
  private warm(phase: Phase, position: Vec3 | null | undefined, power: number, school: School): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const dur = phase === 'charge' ? 1.4 : 2.4;
    const v = g.voice({
      bus: 'sfx',
      gain: 0.44 * power,
      position: position ?? null,
      reverb: 0.45,
      refDistance: 7,
      maxDistance: 160,
    });
    if (!v) return;
    const t = v.t;
    const root = noteHz(ROOT[school]);
    // Root, fifth, octave, tenth: an open consonance. Restoration is the one
    // sound in the game that is allowed to be unambiguously pleasant.
    const ratios = [1, 1.5, 2, 2.5, 3];
    for (let i = 0; i < ratios.length; i++) {
      const o = ctx.createOscillator();
      o.type = i < 2 ? 'triangle' : 'sine';
      o.frequency.value = root * ratios[i] * this.rng.range(0.997, 1.003);
      const og = ctx.createGain();
      const amp = (0.3 / (1 + i * 0.6)) * power;
      ahr(og.gain, t, amp, dur * 0.35, dur * 0.15, dur * 0.55);
      // Slow vibrato on the upper voices only; on all of them it seasicks.
      if (i >= 2) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = this.rng.range(4.2, 5.4);
        const la = ctx.createGain();
        la.gain.value = o.frequency.value * 0.004;
        lfo.connect(la).connect(o.frequency);
        lfo.start(t);
        lfo.stop(t + dur + 0.2);
        v.keep(lfo);
        v.keep(la);
      }
      o.connect(og).connect(v.out);
      o.start(t + i * 0.035);
      o.stop(t + dur + 0.3);
      v.keep(o);
      v.keep(og);
    }
    v.release(dur + 0.5);
  }

  /** Illusion and mysticism: detuned shimmer, beating against itself. */
  private shimmer(phase: Phase, position: Vec3 | null | undefined, power: number, school: School): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const dur = phase === 'charge' ? 1.3 : 2.0;
    const v = g.voice({
      bus: 'sfx',
      gain: 0.38 * power,
      position: position ?? null,
      reverb: 0.55,
      refDistance: 7,
      maxDistance: 150,
    });
    if (!v) return;
    const t = v.t;
    const root = noteHz(ROOT[school]);
    const detunes = [-17, -6, 0, 7, 19, 31];
    for (let i = 0; i < detunes.length; i++) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      const mul = school === 'mysticism' ? [1, 1.19, 1.78, 2.37, 3.11, 4.02][i] : [1, 1.5, 2, 3, 4, 6][i];
      o.frequency.value = root * mul;
      o.detune.value = detunes[i] + this.rng.range(-4, 4);
      // Slow independent drift per partial: the beats never lock, so the pad
      // never settles into a chord. That unsettledness is the effect.
      const drift = ctx.createOscillator();
      drift.frequency.value = this.rng.range(0.08, 0.31);
      const da = ctx.createGain();
      da.gain.value = this.rng.range(6, 22);
      drift.connect(da).connect(o.detune);
      const og = ctx.createGain();
      ahr(og.gain, t, (0.22 / (1 + i * 0.4)) * power, dur * 0.3, dur * 0.2, dur * 0.6);
      o.connect(og).connect(v.out);
      o.start(t);
      drift.start(t);
      o.stop(t + dur + 0.3);
      drift.stop(t + dur + 0.3);
      for (const n of [o, drift, da, og]) v.keep(n);
    }
    v.release(dur + 0.5);
  }

  /** Conjuration: a dark ward that opens, with a glassy edge on the partials. */
  private conjure(phase: Phase, position: Vec3 | null | undefined, power: number): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const dur = phase === 'charge' ? 1.6 : 2.6;
    const v = g.voice({
      bus: 'sfx',
      gain: 0.5 * power,
      position: position ?? null,
      reverb: 0.6,
      refDistance: 7,
      maxDistance: 190,
    });
    if (!v) return;
    const t = v.t;
    const root = noteHz(ROOT.conjuration);
    for (let i = 0; i < WARD_PARTIALS.length; i++) {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sawtooth' : 'sine';
      const hz = root * WARD_PARTIALS[i];
      glide(o.frequency, t, [
        [0, hz * 0.5],
        [dur * 0.4, hz],
      ]);
      const og = ctx.createGain();
      ahr(og.gain, t, (0.3 / (1 + i)) * power, dur * 0.25, dur * 0.2, dur * 0.6);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      glide(lp.frequency, t, [
        [0, 300],
        [dur * 0.5, 3000],
        [dur, 700],
      ]);
      o.connect(lp).connect(og).connect(v.out);
      o.start(t);
      o.stop(t + dur + 0.3);
      for (const n of [o, lp, og]) v.keep(n);
    }
    v.release(dur + 0.6);
  }

  /** A spell landing on something. Cheaper than a cast and always positional. */
  hit(school: School, position?: Vec3 | null, power = 1): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const v = g.voice({
      bus: 'sfx',
      gain: lerp(0.4, 0.8, clamp01(power)),
      position: position ?? null,
      reverb: 0.34,
      hrtf: true,
    });
    if (!v) return;
    const t = v.t;
    const root = noteHz(ROOT[school]);
    const o = ctx.createOscillator();
    o.type = school === 'fire' ? 'sawtooth' : 'triangle';
    glide(o.frequency, t, [
      [0, root * 3],
      [0.4, root],
    ]);
    const og = ctx.createGain();
    ad(og.gain, t, 0.7 * power, 0.004, 0.45);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    glide(lp.frequency, t, [
      [0, 6000],
      [0.4, 500],
    ]);
    o.connect(lp).connect(og).connect(v.out);
    o.start(t);
    o.stop(t + 0.6);
    for (const n of [o, lp, og]) v.keep(n);
    v.release(0.8);
  }
}
