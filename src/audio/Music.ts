import type { AudioGraph } from './Graph';
import { Rng, ad, ahr, clamp01, lerp, noteHz, softClipCurve, type Vec3 } from './dsp';

/**
 * A generative score, not a playlist. There is no loop point because there is
 * no loop: bars are composed a phrase ahead of the playhead from a modal
 * pitch set, a per-mood density, and a seeded RNG. The seed and bar counter are
 * the entire serialised state, so a reloaded save resumes the same piece.
 *
 * Two rules matter more than the note choices:
 *   - Mood changes are committed on a bar line, phrase lines when there is
 *     time. A cut mid-bar is the one thing that unmistakably reads as "a music
 *     system", and the Elder Scrolls scores never do it.
 *   - Silence is a state. Morrowind's score is mostly not playing; a bed that
 *     never rests stops meaning anything when it swells.
 */

export type Mood = 'rest' | 'explore' | 'night' | 'discovery' | 'combat' | 'dungeon';

/** Dunmer flavour lives in the flat second and the raised sixth. */
const SCALES = {
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
} as const;

interface MoodDef {
  readonly scale: readonly number[];
  readonly bpm: number;
  /** MIDI root of the mode. D2 = 38. */
  readonly root: number;
  readonly drone: number;
  readonly strings: number;
  /** Probability per eighth-note slot. */
  readonly lute: number;
  readonly perc: number;
  /** Probability per bar of a melodic phrase. */
  readonly melody: number;
  readonly brightness: number;
  readonly reverb: number;
  /** Bar-degree progression, one entry per bar of the phrase. */
  readonly progression: readonly number[];
  /** Phrases the cue must run before it may hand over. */
  readonly minPhrases: number;
  readonly level: number;
}

const MOODS: Record<Mood, MoodDef> = {
  // Not silence: a single drone at the edge of audibility. The world still hums.
  rest: {
    scale: SCALES.dorian,
    bpm: 44,
    root: 38,
    // "The edge of audibility" is an absolute statement, so this moved when
    // DRONE_TRIM did. At 0.03 against the new trim the resting cue was audibly
    // a note being held, which is exactly what `rest` is not for.
    drone: 0.016,
    strings: 0,
    lute: 0.02,
    perc: 0,
    melody: 0,
    brightness: 700,
    reverb: 0.5,
    progression: [0],
    minPhrases: 2,
    level: 0.5,
  },
  explore: {
    scale: SCALES.dorian,
    bpm: 50,
    root: 38,
    drone: 0.075,
    strings: 0.34,
    lute: 0.22,
    perc: 0.1,
    melody: 0.3,
    brightness: 1900,
    reverb: 0.45,
    progression: [0, 5, 3, 4],
    minPhrases: 2,
    level: 1,
  },
  // Night thins the texture: no percussion, fewer plucks, darker filter.
  night: {
    scale: SCALES.aeolian,
    bpm: 42,
    root: 36,
    drone: 0.09,
    strings: 0.26,
    lute: 0.1,
    perc: 0,
    melody: 0.16,
    brightness: 1100,
    reverb: 0.6,
    progression: [0, 6, 2, 5],
    minPhrases: 2,
    level: 0.85,
  },
  discovery: {
    scale: SCALES.dorian,
    bpm: 52,
    root: 41,
    drone: 0.06,
    strings: 0.55,
    lute: 0.3,
    perc: 0.08,
    melody: 0.7,
    brightness: 3000,
    reverb: 0.55,
    progression: [0, 3, 4, 6],
    minPhrases: 1,
    level: 1.1,
  },
  combat: {
    // Phrygian dominant: the interval that says "this is going badly".
    scale: SCALES.phrygianDominant,
    bpm: 78,
    root: 38,
    drone: 0.11,
    strings: 0.4,
    lute: 0.14,
    perc: 0.75,
    melody: 0.25,
    brightness: 2600,
    reverb: 0.3,
    progression: [0, 0, 1, 0],
    minPhrases: 1,
    level: 1.25,
  },
  dungeon: {
    scale: SCALES.phrygian,
    bpm: 46,
    root: 33,
    drone: 0.12,
    strings: 0.2,
    lute: 0.06,
    perc: 0.04,
    melody: 0.1,
    brightness: 800,
    reverb: 0.75,
    progression: [0, 1, 0, 6],
    minPhrases: 2,
    level: 0.95,
  },
};

/**
 * The drone is four oscillators summed *before* its gain node, so the table's
 * values are four times louder than they read. Trimming here keeps the mood
 * table expressing musical intent rather than gain staging.
 */
const DRONE_TRIM = 0.62;

/**
 * The drone's partials, as multiples of the root, with the oscillator shape
 * each one uses. A sawtooth root supplies the dense low series; the octave and
 * twelfth are added explicitly so the harmonic structure survives the mood
 * filter even when `brightness` is down at 700 Hz for the rest and dungeon
 * cues. Detunes are in cents and are what produces the slow beating — a single
 * oscillator per partial sounds like a test tone.
 */
const DRONE_PARTIALS: readonly (readonly [number, OscillatorType, number, number])[] = [
  [1, 'sawtooth', -7, 1.0],
  [1, 'triangle', 6, 0.8],
  [2, 'triangle', 12, 0.5],
  [3, 'sine', -11, 0.28],
];

const BEATS_PER_BAR = 4;
const BARS_PER_PHRASE = 4;
/** How far ahead bars are composed. Must exceed one frame at 10 fps. */
const LOOKAHEAD = 0.75;

function degreeHz(root: number, scale: readonly number[], degree: number): number {
  const n = scale.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return noteHz(root + oct * 12 + scale[idx]);
}

export interface MusicState {
  seed: number;
  mood: Mood;
  bar: number;
  phrasesInMood: number;
  restBars: number;
}

export class Music {
  private rng = new Rng(0x4d05e);
  private loopClip = softClipCurve(512);
  private mood: Mood = 'rest';
  private pending: Mood | null = null;
  private pendingUrgent = false;
  private phrasesInMood = 0;
  private restBars = 0;
  private bar = 0;
  private nextBarTime = 0;
  private started = false;
  private enabled = true;

  private drone: { osc: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private isNight = false;
  private inCombat = false;

  constructor(private readonly graph: AudioGraph) {}

  get currentMood(): Mood {
    return this.mood;
  }

  start(): void {
    if (this.started) return;
    const g = this.graph;
    const ctx = g.ctx;
    const bus = g.bus('music');
    if (!ctx || !bus) return;
    this.started = true;
    this.nextBarTime = ctx.currentTime + 0.2;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = MOODS[this.mood].brightness;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    filter.connect(gain).connect(bus);
    const send = g.reverbSend('music');
    if (send) {
      const s = ctx.createGain();
      s.gain.value = 0.4;
      gain.connect(s).connect(send);
    }

    const osc: OscillatorNode[] = [];
    const hz = noteHz(MOODS[this.mood].root);
    for (const [mul, type, detune, level] of DRONE_PARTIALS) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz * mul;
      o.detune.value = detune;
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og).connect(filter);
      o.start(ctx.currentTime);
      osc.push(o);
    }
    this.drone = { osc, gain, filter };
    this.applyMood(ctx.currentTime, 2.5);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    const ctx = this.graph.ctx;
    if (this.drone && ctx) {
      this.drone.gain.gain.setTargetAtTime(on ? MOODS[this.mood].drone * DRONE_TRIM : 0, ctx.currentTime, 1.2);
    }
  }

  /** Requests a mood. Never takes effect mid-bar. */
  request(mood: Mood, urgent = false): void {
    if (mood === this.mood && !this.pending) return;
    this.pending = mood;
    this.pendingUrgent = urgent;
  }

  setCombat(on: boolean): void {
    if (on === this.inCombat) return;
    this.inCombat = on;
    if (on) this.request('combat', true);
    else this.request(this.isNight ? 'night' : 'explore');
  }

  discovery(): void {
    if (this.inCombat) return;
    this.request('discovery', true);
  }

  setNight(night: boolean): void {
    if (night === this.isNight) return;
    this.isNight = night;
    if (this.inCombat) return;
    if (this.mood === 'explore' || this.mood === 'night') this.request(night ? 'night' : 'explore');
  }

  /** Enters and leaves the dungeon cue; caves get their own colour. */
  setEnclosed(enclosed: boolean): void {
    if (this.inCombat) return;
    if (enclosed) this.request('dungeon');
    else if (this.mood === 'dungeon') this.request(this.isNight ? 'night' : 'explore');
  }

  update(): void {
    if (!this.started || !this.enabled) return;
    const ctx = this.graph.ctx;
    if (!ctx || ctx.state !== 'running') return;
    // A suspended tab leaves currentTime behind the schedule; resync rather
    // than dumping fifty bars into the queue at once.
    if (this.nextBarTime < ctx.currentTime - 1) this.nextBarTime = ctx.currentTime + 0.1;

    while (this.nextBarTime < ctx.currentTime + LOOKAHEAD) {
      // Commit before the tempo is read: a mood change is also a tempo change,
      // and the new bar must be the new length or the grid slips.
      this.commit(this.nextBarTime);
      const def = MOODS[this.mood];
      this.composeBar(this.nextBarTime, def);
      this.nextBarTime += (60 / def.bpm) * BEATS_PER_BAR;
      this.bar++;
      if (this.bar % BARS_PER_PHRASE === 0) {
        this.phrasesInMood++;
        this.considerRest();
      }
    }
  }

  /** Applies a pending mood on the bar line, preferring a phrase line. */
  private commit(t: number): void {
    if (!this.pending) return;
    const onPhrase = this.bar % BARS_PER_PHRASE === 0;
    if (!onPhrase && !this.pendingUrgent) return;
    if (this.pending === this.mood) {
      this.pending = null;
      return;
    }
    this.mood = this.pending;
    this.pending = null;
    this.pendingUrgent = false;
    this.phrasesInMood = 0;
    this.restBars = 0;
    // Realign so the new cue starts its progression at bar zero of a phrase.
    this.bar = 0;
    this.applyMood(t, this.mood === 'combat' ? 0.6 : 2.2);
  }

  private applyMood(t: number, seconds: number): void {
    const d = this.drone;
    const ctx = this.graph.ctx;
    if (!d || !ctx) return;
    const def = MOODS[this.mood];
    const hz = noteHz(def.root);
    for (let i = 0; i < d.osc.length; i++) {
      const target = hz * DRONE_PARTIALS[i][0];
      d.osc[i].frequency.cancelScheduledValues(t);
      d.osc[i].frequency.setValueAtTime(d.osc[i].frequency.value, t);
      d.osc[i].frequency.exponentialRampToValueAtTime(target, t + seconds);
    }
    d.gain.gain.cancelScheduledValues(t);
    d.gain.gain.setValueAtTime(Math.max(1e-4, d.gain.gain.value), t);
    d.gain.gain.linearRampToValueAtTime(this.enabled ? def.drone * DRONE_TRIM : 0, t + seconds);
    d.filter.frequency.cancelScheduledValues(t);
    d.filter.frequency.setValueAtTime(d.filter.frequency.value, t);
    d.filter.frequency.exponentialRampToValueAtTime(def.brightness, t + seconds);
  }

  /** After a cue has said its piece, let the world be quiet for a while. */
  private considerRest(): void {
    if (this.inCombat || this.pending) return;
    const def = MOODS[this.mood];
    if (this.mood === 'rest') {
      this.restBars -= BARS_PER_PHRASE;
      if (this.restBars <= 0) this.request(this.isNight ? 'night' : 'explore');
      return;
    }
    if (this.phrasesInMood < def.minPhrases) return;
    if (this.rng.chance(0.55)) {
      // 6 to 18 phrases of near-silence. Long, deliberately.
      this.restBars = (6 + this.rng.int(13)) * BARS_PER_PHRASE;
      this.request('rest');
    }
  }

  private composeBar(t: number, def: MoodDef): void {
    const beat = 60 / def.bpm;
    const barIdx = this.bar % BARS_PER_PHRASE;
    const degree = def.progression[barIdx % def.progression.length];

    if (def.strings > 0.01 && (barIdx === 0 || this.rng.chance(0.45))) {
      const voicing = [degree, degree + 2, degree + 4, degree + 7];
      for (let i = 0; i < voicing.length; i++) {
        if (i > 1 && !this.rng.chance(0.7)) continue;
        const hz = degreeHz(def.root + 12, def.scale, voicing[i]);
        this.bowed(t + i * this.rng.range(0, 0.09), hz, beat * BEATS_PER_BAR * this.rng.range(0.8, 1.15), def, def.strings / (1 + i * 0.5));
      }
    }

    if (def.perc > 0.01) {
      for (let b = 0; b < BEATS_PER_BAR; b++) {
        const accent = b === 0 ? 1 : b === 2 ? 0.6 : 0.35;
        if (this.rng.next() < def.perc * accent) {
          this.drum(t + b * beat + this.rng.range(-0.012, 0.012), accent * def.level);
        }
      }
    }

    if (def.lute > 0.01) {
      for (let s = 0; s < BEATS_PER_BAR * 2; s++) {
        if (!this.rng.chance(def.lute)) continue;
        // Lute lives an octave below the strings and stays in the mode; the
        // occasional leap of a fourth is what stops it sounding like a scale.
        const step = degree + this.rng.pick([0, 2, 4, -3, 3, 6]);
        const hz = degreeHz(def.root, def.scale, step);
        this.pluck(t + s * beat * 0.5 + this.rng.range(-0.02, 0.02), hz, beat * this.rng.range(1.2, 2.6), def, 0.5 * def.level);
      }
    }

    if (this.rng.chance(def.melody) && barIdx !== 3) {
      this.phrase(t, beat, degree, def);
    }
  }

  /** A short solo line. Sparse, and always leaves the bar before it ends. */
  private phrase(t: number, beat: number, degree: number, def: MoodDef): void {
    const n = 2 + this.rng.int(4);
    let step = degree + this.rng.pick([0, 2, 4]);
    let at = this.rng.pick([0, 1, 1.5, 2]) * beat;
    for (let i = 0; i < n; i++) {
      const hz = degreeHz(def.root + 24, def.scale, step);
      const dur = beat * this.rng.pick([0.5, 1, 1, 1.5, 2]);
      this.reed(t + at, hz, dur, def, 0.3 * def.level);
      at += dur;
      if (at > beat * (BEATS_PER_BAR - 0.5)) break;
      // Stepwise motion with the odd leap: a melody, not a random walk.
      step += this.rng.chance(0.72) ? this.rng.pick([-1, 1]) : this.rng.pick([-3, 2, 3, -2]);
    }
  }

  /** Bowed string: detuned saw pair through a slowly opening filter. */
  private bowed(t: number, hz: number, dur: number, def: MoodDef, level: number): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const v = g.voice({ bus: 'music', gain: level * 0.26, reverb: def.reverb, pan: this.rng.range(-0.45, 0.45) });
    if (!v) return;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.1;
    lp.frequency.setValueAtTime(hz * 1.5, t);
    lp.frequency.linearRampToValueAtTime(def.brightness, t + dur * 0.4);
    lp.frequency.linearRampToValueAtTime(hz * 2, t + dur);
    const gn = ctx.createGain();
    ahr(gn.gain, t, 0.5, dur * 0.35, dur * 0.25, dur * 0.55);
    lp.connect(gn).connect(v.out);

    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz;
      o.detune.value = i === 0 ? -6 : 7;
      const vib = ctx.createOscillator();
      vib.frequency.value = this.rng.range(4.4, 5.6);
      const va = ctx.createGain();
      va.gain.value = 5;
      vib.connect(va).connect(o.detune);
      o.connect(lp);
      o.start(t);
      vib.start(t);
      o.stop(t + dur + 0.4);
      vib.stop(t + dur + 0.4);
      for (const n of [o, vib, va]) v.keep(n);
    }
    // Bow noise. Two saws alone are an organ. Kept narrow (Q 2.6) and low, and
    // tracking the note rather than sitting at a fixed band, so it reads as
    // rosin on a string instead of as a hiss layered over the score.
    const air = ctx.createBufferSource();
    air.buffer = g.buffers?.noise('pink') ?? null;
    air.loop = true;
    const ab = ctx.createBiquadFilter();
    ab.type = 'bandpass';
    ab.frequency.value = hz * 4;
    ab.Q.value = 2.6;
    const ag = ctx.createGain();
    ahr(ag.gain, t, 0.028, dur * 0.3, dur * 0.2, dur * 0.5);
    air.connect(ab).connect(ag).connect(v.out);
    air.start(t, this.rng.range(0, 3.5));
    air.stop(t + dur + 0.3);
    for (const n of [lp, gn, air, ab, ag]) v.keep(n);
    v.release(dur + 0.9);
  }

  /**
   * Karplus-Strong lute. The delay line is the string; the loop filter is the
   * body's damping. Web Audio inserts a 128-sample block delay into any cycle,
   * so the tuning has to be compensated or every note plays flat — and the
   * residual means pitches above about 350 Hz cannot be tuned at all, hence the
   * octave fold.
   */
  private pluck(t: number, hzIn: number, dur: number, def: MoodDef, level: number): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    let hz = hzIn;
    while (hz > 330) hz *= 0.5;
    const block = 128 / ctx.sampleRate;
    const period = 1 / hz;
    if (period <= block) return;

    const v = g.voice({ bus: 'music', gain: level * 0.28, reverb: def.reverb, pan: this.rng.range(-0.5, 0.5) });
    if (!v) return;

    const delay = ctx.createDelay(0.1);
    delay.delayTime.value = period - block;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = lerp(1400, 4200, this.rng.next());
    // Q must stay under 1/sqrt(2) or the filter's resonant peak pushes the loop
    // gain above unity, and a delay line with gain > 1 runs away to Infinity in
    // a couple of seconds and poisons the whole graph with NaN.
    damp.Q.value = 0.5;
    const fb = ctx.createGain();
    // T60 from the loop gain: fb = 10^(-3 * period / dur).
    fb.gain.value = Math.min(0.985, Math.pow(10, (-3 * period) / dur));
    // Soft clip inside the loop: bounds the string even if anything upstream
    // ever hands it a hot excitation, and adds the nonlinearity a real
    // plucked string has anyway.
    const limit = ctx.createWaveShaper();
    limit.curve = this.loopClip;
    delay.connect(damp).connect(limit).connect(fb).connect(delay);

    const ex = ctx.createBufferSource();
    ex.buffer = g.buffers?.burst(period) ?? null;
    const eg = ctx.createGain();
    eg.gain.value = 0.8;
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 320;
    body.Q.value = 1.2;
    body.gain.value = 5;
    ex.connect(eg).connect(delay);
    damp.connect(body).connect(v.out);
    ex.start(t);
    for (const n of [delay, damp, limit, fb, ex, eg, body]) v.keep(n);
    v.release(dur + 0.6);
  }

  /** Soft reed/flute for the melody: sine plus a breathy third harmonic. */
  private reed(t: number, hz: number, dur: number, def: MoodDef, level: number): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const v = g.voice({ bus: 'music', gain: level * 0.5, reverb: def.reverb, pan: this.rng.range(-0.25, 0.25) });
    if (!v) return;
    const gn = ctx.createGain();
    ahr(gn.gain, t, 0.5, Math.min(0.18, dur * 0.3), dur * 0.3, dur * 0.5);
    gn.connect(v.out);
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = hz * (i === 0 ? 1 : 3);
      const og = ctx.createGain();
      og.gain.value = i === 0 ? 1 : 0.12;
      const vib = ctx.createOscillator();
      vib.frequency.value = this.rng.range(4.8, 6.2);
      const va = ctx.createGain();
      va.gain.value = 7;
      vib.connect(va).connect(o.detune);
      o.connect(og).connect(gn);
      o.start(t);
      vib.start(t);
      o.stop(t + dur + 0.3);
      vib.stop(t + dur + 0.3);
      for (const n of [o, og, vib, va]) v.keep(n);
    }
    // Breath. Pink rather than white — a flute's air is not flat — and narrow
    // enough that it stays part of the note instead of a wash across the top.
    const air = ctx.createBufferSource();
    air.buffer = g.buffers?.noise('pink') ?? null;
    air.loop = true;
    const ab = ctx.createBiquadFilter();
    ab.type = 'bandpass';
    ab.frequency.value = hz * 2.5;
    ab.Q.value = 3.5;
    const ag = ctx.createGain();
    ahr(ag.gain, t, 0.035, 0.08, dur * 0.4, dur * 0.4);
    air.connect(ab).connect(ag).connect(v.out);
    air.start(t, this.rng.range(0, 3.5));
    air.stop(t + dur + 0.2);
    for (const n of [gn, air, ab, ag]) v.keep(n);
    v.release(dur + 0.6);
  }

  /** Frame drum: a pitched membrane thump with a skin transient on top. */
  private drum(t: number, level: number): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const v = g.voice({ bus: 'music', gain: 0.24 * level, reverb: 0.3, pan: this.rng.range(-0.12, 0.12) });
    if (!v) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f = this.rng.range(68, 82);
    o.frequency.setValueAtTime(f * 2.4, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    const og = ctx.createGain();
    ad(og.gain, t, 0.9, 0.003, 0.34);
    o.connect(og).connect(v.out);
    o.start(t);
    o.stop(t + 0.45);

    const skin = ctx.createBufferSource();
    skin.buffer = g.buffers?.noise('white') ?? null;
    skin.loop = true;
    const sf = ctx.createBiquadFilter();
    sf.type = 'bandpass';
    sf.frequency.value = 1400;
    sf.Q.value = 1.1;
    const sg = ctx.createGain();
    ad(sg.gain, t, 0.22, 0.001, 0.05);
    skin.connect(sf).connect(sg).connect(v.out);
    skin.start(t, this.rng.range(0, 3.5));
    skin.stop(t + 0.1);
    for (const n of [o, og, skin, sf, sg]) v.keep(n);
    v.release(0.7);
  }

  /** A stinger for quest beats. Bypasses the schedule; it is not part of the piece. */
  sting(kind: 'levelup' | 'quest' | 'death', position?: Vec3 | null): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const v = g.voice({ bus: 'music', gain: 0.3, reverb: 0.6, position: position ?? null });
    if (!v) return;
    const t = v.t;
    const def = MOODS[this.mood];
    const degrees = kind === 'death' ? [0, 1, -4] : kind === 'levelup' ? [0, 4, 7] : [0, 3, 5];
    for (let i = 0; i < degrees.length; i++) {
      const hz = degreeHz(def.root + (kind === 'death' ? 0 : 24), def.scale, degrees[i]);
      const o = ctx.createOscillator();
      o.type = kind === 'death' ? 'sawtooth' : 'triangle';
      o.frequency.value = hz;
      const og = ctx.createGain();
      const at = t + i * (kind === 'death' ? 0.5 : 0.16);
      ahr(og.gain, at, 0.3, kind === 'death' ? 0.5 : 0.02, 0.3, 1.4);
      o.connect(og).connect(v.out);
      o.start(at);
      o.stop(at + 2.2);
      v.keep(o);
      v.keep(og);
    }
    v.release(3.2);
  }

  /** Combat intensity 0..1 nudges the drone without changing the cue. */
  setIntensity(x: number): void {
    const ctx = this.graph.ctx;
    if (!this.drone || !ctx) return;
    const def = MOODS[this.mood];
    this.drone.gain.gain.setTargetAtTime(
      this.enabled ? def.drone * DRONE_TRIM * lerp(0.8, 1.6, clamp01(x)) : 0,
      ctx.currentTime,
      0.8,
    );
  }

  serialize(): MusicState {
    return {
      seed: this.rng.state,
      mood: this.mood,
      bar: this.bar,
      phrasesInMood: this.phrasesInMood,
      restBars: this.restBars,
    };
  }

  deserialize(s: MusicState): void {
    this.rng.state = s.seed >>> 0;
    this.mood = MOODS[s.mood] ? s.mood : 'explore';
    this.bar = Math.max(0, Math.floor(s.bar) || 0);
    this.phrasesInMood = Math.max(0, Math.floor(s.phrasesInMood) || 0);
    this.restBars = Math.max(0, Math.floor(s.restBars) || 0);
    this.pending = null;
    const ctx = this.graph.ctx;
    if (ctx && this.drone) {
      this.nextBarTime = ctx.currentTime + 0.1;
      this.applyMood(ctx.currentTime, 1.5);
    }
  }

  dispose(): void {
    const d = this.drone;
    if (d) {
      for (const o of d.osc) {
        try {
          o.stop();
        } catch {
          /* already stopped */
        }
        o.disconnect();
      }
      d.filter.disconnect();
      d.gain.disconnect();
    }
    this.drone = null;
    this.started = false;
  }
}
