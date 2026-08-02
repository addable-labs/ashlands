import type { AudioGraph } from './Graph';
import { Rng, ad, ahr, clamp01, glide, lerp, saturationCurve, type Vec3 } from './dsp';

export type CreatureKind =
  | 'cliffracer'
  | 'netch'
  | 'guar'
  | 'kwama'
  | 'nixhound'
  | 'siltstrider'
  | 'scrib';

export type Call = 'idle' | 'alert' | 'attack' | 'hurt' | 'die';

/** How far each voice carries and how directional it is. */
interface Presence {
  readonly ref: number;
  readonly max: number;
  readonly rolloff: number;
  readonly cone: number;
  readonly reverb: number;
}

const PRESENCE: Record<CreatureKind, Presence> = {
  cliffracer: { ref: 18, max: 900, rolloff: 0.8, cone: 0.4, reverb: 0.4 },
  netch: { ref: 16, max: 900, rolloff: 0.7, cone: 0.6, reverb: 0.5 },
  guar: { ref: 8, max: 300, rolloff: 1.1, cone: 0.5, reverb: 0.25 },
  kwama: { ref: 7, max: 120, rolloff: 1.2, cone: 0.6, reverb: 0.3 },
  nixhound: { ref: 6, max: 220, rolloff: 1.2, cone: 0.45, reverb: 0.28 },
  siltstrider: { ref: 30, max: 2400, rolloff: 0.55, cone: 0.8, reverb: 0.6 },
  scrib: { ref: 7, max: 110, rolloff: 1.2, cone: 0.7, reverb: 0.25 },
};

export class Creatures {
  private rng = new Rng(0xcafe17);
  private harsh = saturationCurve(6);
  /**
   * Gentler than `harsh` and used only by the cliff racer. tanh(6) on a
   * sawtooth generates harmonics well past Nyquist, which fold back as
   * inharmonic aliases — the one kind of distortion that really does turn a
   * pitched source into noise, and it measured a 4.8 kHz centroid.
   */
  private screech = saturationCurve(3.2);

  constructor(private readonly graph: AudioGraph) {}

  call(kind: CreatureKind, call: Call = 'idle', position?: Vec3 | null, dir?: Vec3 | null): void {
    switch (kind) {
      case 'cliffracer':
        this.cliffRacer(call, position, dir);
        break;
      case 'netch':
        this.netch(call, position, dir);
        break;
      case 'guar':
        this.guar(call, position, dir);
        break;
      case 'kwama':
      case 'scrib':
        this.kwama(call, position, dir, kind);
        break;
      case 'nixhound':
        this.nixHound(call, position, dir);
        break;
      case 'siltstrider':
        this.siltStrider(call, position, dir);
        break;
    }
  }

  private open(kind: CreatureKind, gain: number, position?: Vec3 | null, dir?: Vec3 | null) {
    const p = PRESENCE[kind];
    return this.graph.voice({
      bus: 'sfx',
      gain,
      position: position ?? null,
      reverb: p.reverb,
      refDistance: p.ref,
      maxDistance: p.max,
      rolloff: p.rolloff,
      hrtf: true,
      orientation: dir ?? undefined,
      coneInner: 70,
      coneOuter: 300,
      coneOuterGain: p.cone,
    });
  }

  /**
   * The cliff racer. A voiced shriek, not a hiss: two detuned sawtooths supply
   * a dense harmonic series, two peaking formants give it a throat, and a
   * ring modulator adds the rasp.
   *
   * The modulator runs at a fifth of the carrier and follows the same pitch
   * contour. That ratio is the whole trick. Ring-modulating a harmonic series
   * at F with a sine at F/5 puts every sideband at n*F +/- F/5 — still an exact
   * harmonic series, just one with a fundamental of F/5, so the cry keeps a
   * pitch the ear can lock onto. The previous version modulated at a fixed
   * 140-190 Hz against a carrier sweeping 800-2500 Hz: the ratio changed
   * continuously, no sideband landed on a harmonic of anything, and what came
   * out measured as noise (11.9 dB of harmonic structure, against 57 dB for the
   * score) because it *was* noise, however deliberately it was built.
   *
   * It is the most hated sound in the series and it is supposed to be — but it
   * is hated for being a piercing pitched screech, not for being a hiss.
   */
  private cliffRacer(call: Call, position?: Vec3 | null, dir?: Vec3 | null): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const dying = call === 'die';
    const dur = dying ? 0.85 : call === 'attack' ? 0.44 : 0.62;
    const twice = call !== 'die' && this.rng.chance(0.55);
    const gap = dur + this.rng.range(0.1, 0.26);
    const end = twice ? gap + 0.36 : dur + 0.1;
    const v = this.open('cliffracer', call === 'idle' ? 2.2 : 3.0, position, dir);
    if (!v) return;
    const t = v.t;

    const shaper = ctx.createWaveShaper();
    shaper.curve = this.screech;
    shaper.oversample = '4x';
    // Formants, not a bandpass. A narrow band pass plus a 700 Hz high-pass
    // removed the first three harmonics outright; peaking filters colour the
    // series instead of deleting the bottom of it.
    const f1 = ctx.createBiquadFilter();
    f1.type = 'peaking';
    f1.frequency.value = this.rng.range(1150, 1400);
    f1.Q.value = 1.8;
    f1.gain.value = 10;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'peaking';
    // 3.2 kHz is where the ear is most sensitive; that is not an accident here.
    f2.frequency.value = 3200;
    f2.Q.value = 1.4;
    f2.gain.value = 6;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 320;
    hp.Q.value = 0.7;
    // A vocal tract is a low-pass. Without this the saturated saws run flat to
    // Nyquist and the cry reads as a hiss with a note somewhere inside it.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5000;
    lp.Q.value = 0.7;
    const gn = ctx.createGain();
    ad(gn.gain, t, 1, 0.008, dur);
    shaper.connect(f1).connect(f2).connect(hp).connect(lp).connect(gn).connect(v.out);

    // One ring stage PER carrier, not one shared by both. The two saws are
    // detuned against each other by 20 cents, so a single modulator can only be
    // in an exact 5:1 ratio with one of them — and 5:1.012 is not a ratio, it
    // is a beat. Each carrier gets its own modulator carrying the same detune
    // and the same vibrato, which is the only way the ratio survives.
    const ring = ctx.createGain();
    ring.gain.value = 1;
    ring.connect(shaper);
    // A DC offset alongside each modulator keeps some carrier through, so it is
    // a scream with a rasp on it rather than a pure ring-mod artefact.
    const dc = ctx.createConstantSource();
    dc.offset.value = 0.5;

    const base = this.rng.range(880, 1050) * (dying ? 0.8 : 1);
    // A held note in the middle. The old contour swept continuously from the
    // attack to the release, which leaves no part of the cry at a settled
    // pitch — a bird of prey holds the note, and a held note is what carries.
    const contour: readonly (readonly [number, number])[] = dying
      ? [
          [0, base * 2.2],
          [0.12, base * 1.7],
          [dur, base * 0.55],
        ]
      : [
          [0, base * 0.85],
          [0.05, base * 2.3],
          [0.16, base * 1.95],
          [dur * 0.75, base * 1.88],
          [dur, base * 1.15],
        ];

    const subContour = contour.map(([at, hz]) => [at, hz / 5] as const);
    for (let i = 0; i < 2; i++) {
      const detune = i === 0 ? -9 : 11;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = detune;
      glide(o.frequency, t, contour);
      // The waver. ~19 Hz is fast enough to be a rasp, slow enough to be heard
      // as a separate wobble rather than a timbre. A quarter tone of depth,
      // not the full tone it used to have — at +-120 cents every partial is
      // smeared across an eighth of an octave and the pitch stops existing.
      const vib = ctx.createOscillator();
      vib.frequency.value = this.rng.range(17, 22);
      const vibAmt = ctx.createGain();
      vibAmt.gain.value = this.rng.range(22, 38);
      vib.connect(vibAmt);

      const mod = ctx.createOscillator();
      mod.type = 'sine';
      mod.detune.value = detune;
      glide(mod.frequency, t, subContour);
      const modAmt = ctx.createGain();
      modAmt.gain.value = 0.7;
      mod.connect(modAmt);

      // Detune in cents is a ratio, so applying the same cents to carrier and
      // modulator leaves the 5:1 exact. Same for the vibrato.
      vibAmt.connect(o.detune);
      vibAmt.connect(mod.detune);

      const stage = ctx.createGain();
      stage.gain.value = 0;
      modAmt.connect(stage.gain);
      dc.connect(stage.gain);
      o.connect(stage).connect(ring);

      o.start(t);
      vib.start(t);
      mod.start(t);
      o.stop(t + end);
      vib.stop(t + end);
      mod.stop(t + end);
      for (const n of [o, vib, vibAmt, mod, modAmt, stage]) v.keep(n);
    }

    dc.start(t);
    // Must outlive the second cry. It gates every stage: each `stage.gain` has
    // an intrinsic value of 0 and is driven entirely by its modulator and this
    // offset, so stopping it at the end of the first cry silenced the second
    // one completely.
    dc.stop(t + end);
    for (const n of [shaper, f1, f2, hp, lp, ring, dc, gn]) v.keep(n);

    // The second, shorter cry. Cliff racers do not call once.
    if (twice) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      glide(o.frequency, t + gap, [
        [0, base * 1.6],
        [0.05, base * 2.1],
        [0.26, base * 1.4],
      ]);
      const og = ctx.createGain();
      ad(og.gain, t + gap, 0.55, 0.006, 0.28);
      o.connect(og).connect(ring);
      o.start(t + gap);
      o.stop(t + gap + 0.36);
      v.keep(o);
      v.keep(og);
      v.release(gap + 0.5);
      return;
    }
    v.release(dur + 0.4);
  }

  /** Netch: a vast, slow, gas-filled groan. Almost all of it is below 200 Hz. */
  private netch(call: Call, position?: Vec3 | null, dir?: Vec3 | null): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const dur = call === 'die' ? 3.4 : 2.6;
    const v = this.open('netch', 0.66, position, dir);
    if (!v) return;
    const t = v.t;
    const base = this.rng.range(38, 48);

    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      const mul = [1, 1.503, 2.98][i];
      glide(
        o.frequency,
        t,
        call === 'die'
          ? [
              [0, base * mul],
              [dur, base * mul * 0.55],
            ]
          : [
              [0, base * mul * 0.86],
              [dur * 0.45, base * mul * 1.12],
              [dur, base * mul * 0.9],
            ],
      );
      const og = ctx.createGain();
      ahr(og.gain, t, 0.42 / (1 + i * 0.9), dur * 0.3, dur * 0.25, dur * 0.5);
      // Slow tremolo: the bell of the creature flexing.
      const trem = ctx.createOscillator();
      trem.frequency.value = this.rng.range(2.8, 4.2);
      const ta = ctx.createGain();
      ta.gain.value = 0.12 / (1 + i);
      trem.connect(ta).connect(og.gain);
      o.connect(og).connect(v.out);
      o.start(t);
      trem.start(t);
      o.stop(t + dur + 0.3);
      trem.stop(t + dur + 0.3);
      for (const n of [o, og, trem, ta]) v.keep(n);
    }

    // Breath through the formants, so it is an animal and not a synth pad.
    const air = ctx.createBufferSource();
    air.buffer = g.buffers?.noise('pink') ?? null;
    air.loop = true;
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 190;
    f1.Q.value = 5;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 480;
    f2.Q.value = 7;
    const ag = ctx.createGain();
    ahr(ag.gain, t, 0.2, dur * 0.35, dur * 0.2, dur * 0.5);
    air.connect(f1).connect(ag);
    air.connect(f2).connect(ag);
    ag.connect(v.out);
    air.start(t, this.rng.range(0, 3.5));
    air.stop(t + dur + 0.2);
    for (const n of [air, f1, f2, ag]) v.keep(n);
    v.release(dur + 0.6);
  }

  /** Guar: a short warbling FM chirp. Domestic, faintly ridiculous, likeable. */
  private guar(call: Call, position?: Vec3 | null, dir?: Vec3 | null): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const dur = call === 'hurt' ? 0.34 : 0.24;
    const v = this.open('guar', call === 'idle' ? 0.8 : 1.05, position, dir);
    if (!v) return;
    const t = v.t;
    const carrier = this.rng.range(360, 470) * (call === 'die' ? 0.7 : 1);

    const o = ctx.createOscillator();
    o.type = 'sine';
    glide(o.frequency, t, [
      [0, carrier * 0.8],
      [dur * 0.3, carrier * 1.25],
      [dur, carrier * (call === 'die' ? 0.5 : 0.95)],
    ]);
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = carrier * 0.21;
    const idx = ctx.createGain();
    ad(idx.gain, t, carrier * 1.4, 0.01, dur);
    mod.connect(idx).connect(o.frequency);

    const gn = ctx.createGain();
    ad(gn.gain, t, 0.7, 0.008, dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = carrier * 1.6;
    bp.Q.value = 1.2;
    o.connect(bp).connect(gn).connect(v.out);
    o.start(t);
    mod.start(t);
    o.stop(t + dur + 0.1);
    mod.stop(t + dur + 0.1);
    for (const n of [o, mod, idx, bp, gn]) v.keep(n);

    if (this.rng.chance(0.4)) {
      const gap = dur + this.rng.range(0.08, 0.18);
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      glide(o2.frequency, t + gap, [
        [0, carrier * 1.1],
        [0.16, carrier * 0.8],
      ]);
      const g2 = ctx.createGain();
      ad(g2.gain, t + gap, 0.4, 0.008, 0.16);
      o2.connect(g2).connect(v.out);
      o2.start(t + gap);
      o2.stop(t + gap + 0.24);
      v.keep(o2);
      v.keep(g2);
    }
    v.release(dur + 0.6);
  }

  /** Kwama and scrib: chitinous clicking, irregular, in bursts. */
  private kwama(call: Call, position: Vec3 | null | undefined, dir: Vec3 | null | undefined, kind: CreatureKind): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const v = this.open(kind, call === 'idle' ? 2.2 : 3.0, position, dir);
    if (!v) return;
    const t = v.t;
    const n = call === 'attack' ? 5 + this.rng.int(6) : 3 + this.rng.int(5);
    const pitch = kind === 'scrib' ? 1.5 : 1;
    let at = 0;
    for (let i = 0; i < n; i++) {
      const src = ctx.createBufferSource();
      src.buffer = g.buffers?.noise('white') ?? null;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = this.rng.range(2400, 4200) * pitch;
      bp.Q.value = this.rng.range(4, 9);
      const gn = ctx.createGain();
      ad(gn.gain, t + at, this.rng.range(0.4, 1) * (1 - i / (n * 1.6)), 0.001, this.rng.range(0.02, 0.05));
      src.connect(bp).connect(gn).connect(v.out);
      src.start(t + at, this.rng.range(0, 3.5));
      src.stop(t + at + 0.06);
      for (const node of [src, bp, gn]) v.keep(node);
      // Irregular spacing. Evenly spaced clicks read as a machine.
      at += this.rng.range(0.022, 0.075);
    }
    v.release(at + 0.3);
  }

  /** Nix-hound: a low rasping growl with a fast amplitude flutter. */
  private nixHound(call: Call, position?: Vec3 | null, dir?: Vec3 | null): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const dur = call === 'attack' ? 0.5 : 0.95;
    const v = this.open('nixhound', 0.6, position, dir);
    if (!v) return;
    const t = v.t;
    const base = this.rng.range(62, 82);

    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    glide(o.frequency, t, [
      [0, base],
      [dur * 0.5, base * 1.25],
      [dur, base * (call === 'die' ? 0.5 : 0.95)],
    ]);
    const flutter = ctx.createOscillator();
    flutter.type = 'square';
    flutter.frequency.value = this.rng.range(24, 33);
    const fa = ctx.createGain();
    fa.gain.value = 0.35;
    const am = ctx.createGain();
    am.gain.value = 0.65;
    flutter.connect(fa).connect(am.gain);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = call === 'attack' ? 1400 : 620;
    lp.Q.value = 2.2;
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.harsh;
    const gn = ctx.createGain();
    ahr(gn.gain, t, 0.7, 0.03, dur * 0.5, dur * 0.5);
    o.connect(am).connect(lp).connect(shaper).connect(gn).connect(v.out);

    const air = ctx.createBufferSource();
    air.buffer = g.buffers?.noise('pink') ?? null;
    air.loop = true;
    const ab = ctx.createBiquadFilter();
    ab.type = 'bandpass';
    ab.frequency.value = 1100;
    ab.Q.value = 1.4;
    const ag = ctx.createGain();
    ahr(ag.gain, t, 0.22, 0.05, dur * 0.4, dur * 0.5);
    air.connect(ab).connect(ag).connect(v.out);

    o.start(t);
    flutter.start(t);
    air.start(t, this.rng.range(0, 3.5));
    o.stop(t + dur + 0.2);
    flutter.stop(t + dur + 0.2);
    air.stop(t + dur + 0.2);
    for (const n of [o, flutter, fa, am, lp, shaper, gn, air, ab, ag]) v.keep(n);
    v.release(dur + 0.5);
  }

  /** Silt strider: the long mournful moan that carries across a whole region. */
  private siltStrider(call: Call, position?: Vec3 | null, dir?: Vec3 | null): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const dur = 4.2;
    const v = this.open('siltstrider', 0.7, position, dir);
    if (!v) return;
    const t = v.t;
    const base = this.rng.range(58, 68);
    const up = this.rng.chance(0.5) ? 4 / 3 : 3 / 2;

    for (let i = 0; i < 5; i++) {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sawtooth' : 'triangle';
      const mul = i + 1;
      glide(o.frequency, t, [
        [0, base * mul * 0.94],
        [dur * 0.28, base * mul * up],
        [dur * 0.7, base * mul * up * 0.98],
        [dur, base * mul * 0.88],
      ]);
      const og = ctx.createGain();
      ahr(og.gain, t, 0.28 / (1 + i * 0.85), dur * 0.22, dur * 0.4, dur * 0.38);
      o.connect(og).connect(v.out);
      o.start(t);
      o.stop(t + dur + 0.4);
      v.keep(o);
      v.keep(og);
    }

    // A formant pair around 300/700 Hz gives it a throat.
    const air = ctx.createBufferSource();
    air.buffer = g.buffers?.noise('pink') ?? null;
    air.loop = true;
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 300;
    f1.Q.value = 6;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 720;
    f2.Q.value = 9;
    const ag = ctx.createGain();
    ahr(ag.gain, t, 0.16, dur * 0.3, dur * 0.3, dur * 0.4);
    air.connect(f1).connect(ag);
    air.connect(f2).connect(ag);
    ag.connect(v.out);
    air.start(t, this.rng.range(0, 3.5));
    air.stop(t + dur + 0.3);
    for (const n of [air, f1, f2, ag]) v.keep(n);
    v.release(dur + 0.8);
  }

  /** Non-verbal hurt reaction for humanoids: a short breath, not a word. */
  grunt(position?: Vec3 | null, effort = 0.5): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const v = g.voice({ bus: 'sfx', gain: lerp(0.3, 0.6, clamp01(effort)), position: position ?? null, reverb: 0.2 });
    if (!v) return;
    const t = v.t;
    const dur = lerp(0.16, 0.42, clamp01(effort));
    const base = this.rng.range(105, 165);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    glide(o.frequency, t, [
      [0, base * 1.2],
      [dur, base * 0.75],
    ]);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = this.rng.range(520, 780);
    f.Q.value = 2.6;
    const gn = ctx.createGain();
    ad(gn.gain, t, 0.6, 0.012, dur);
    o.connect(f).connect(gn).connect(v.out);
    o.start(t);
    o.stop(t + dur + 0.1);
    for (const n of [o, f, gn]) v.keep(n);
    v.release(dur + 0.3);
  }
}
