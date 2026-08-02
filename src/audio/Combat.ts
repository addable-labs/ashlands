import type { AudioGraph } from './Graph';
import { Rng, ad, clamp, clamp01, glide, lerp, saturationCurve, softClipCurve, type Vec3 } from './dsp';

export type Weapon = 'blade' | 'blunt' | 'axe' | 'spear' | 'unarmed' | 'claw' | 'arrow' | 'staff';
export type Target = 'flesh' | 'chitin' | 'bone' | 'stone' | 'metal' | 'wood' | 'water' | 'ward';

/**
 * An impact is a transient plus a resonance plus a texture. The material pair
 * decides how much of each: blade on chitin is nearly all resonance, blunt on
 * flesh is nearly all transient, blade on stone is transient plus a long
 * metallic ring.
 */
interface ImpactDef {
  /** Click energy, 0..1. */
  readonly hit: number;
  /** Resonant pitch of the struck body, Hz. */
  readonly ringHz: number;
  readonly ringQ: number;
  readonly ringTime: number;
  /** Low thud under everything. */
  readonly thudHz: number;
  readonly thud: number;
  /** Wet/granular texture: gore, grit, splinters. */
  readonly grit: number;
  readonly gritHz: number;
  /** tanh drive — metal on stone is genuinely nonlinear. */
  readonly drive: number;
  readonly level: number;
  readonly reverb: number;
}

const DEFAULT_IMPACT: ImpactDef = {
  hit: 0.7,
  ringHz: 420,
  ringQ: 4,
  ringTime: 0.12,
  thudHz: 90,
  thud: 0.4,
  grit: 0.3,
  gritHz: 1800,
  drive: 1.4,
  level: 0.7,
  reverb: 0.25,
};

/** Per-target defaults; the weapon then modifies them. Keeps the table small. */
const TARGETS: Record<Target, ImpactDef> = {
  flesh: {
    hit: 0.45,
    ringHz: 190,
    ringQ: 1.6,
    ringTime: 0.07,
    thudHz: 70,
    thud: 0.8,
    grit: 0.55,
    gritHz: 900,
    drive: 1.1,
    level: 0.55,
    reverb: 0.18,
  },
  chitin: {
    // The signature Morrowind combat sound: a dry, hollow, pitched crack.
    hit: 1.0,
    ringHz: 1150,
    ringQ: 9,
    ringTime: 0.3,
    thudHz: 130,
    thud: 0.34,
    grit: 0.28,
    gritHz: 2600,
    drive: 1.8,
    level: 0.95,
    reverb: 0.3,
  },
  bone: {
    hit: 0.85,
    ringHz: 780,
    ringQ: 6.5,
    ringTime: 0.18,
    thudHz: 110,
    thud: 0.45,
    grit: 0.4,
    gritHz: 2100,
    drive: 1.5,
    level: 0.7,
    reverb: 0.28,
  },
  stone: {
    hit: 1,
    ringHz: 2400,
    ringQ: 3,
    ringTime: 0.1,
    thudHz: 150,
    thud: 0.3,
    grit: 0.75,
    gritHz: 3400,
    drive: 2.4,
    level: 0.78,
    reverb: 0.4,
  },
  metal: {
    hit: 1,
    ringHz: 1850,
    ringQ: 22,
    ringTime: 0.9,
    thudHz: 220,
    thud: 0.22,
    grit: 0.25,
    gritHz: 4200,
    drive: 2.0,
    level: 0.72,
    reverb: 0.45,
  },
  wood: {
    hit: 0.75,
    ringHz: 520,
    ringQ: 5,
    ringTime: 0.16,
    thudHz: 95,
    thud: 0.5,
    grit: 0.45,
    gritHz: 1500,
    drive: 1.3,
    level: 0.68,
    reverb: 0.24,
  },
  water: {
    hit: 0.3,
    ringHz: 600,
    ringQ: 1.1,
    ringTime: 0.1,
    thudHz: 60,
    thud: 0.3,
    grit: 0.8,
    gritHz: 2200,
    drive: 1,
    level: 0.6,
    reverb: 0.2,
  },
  ward: {
    // A magical ward is not a material: glassy, inharmonic, slightly detuned.
    hit: 0.5,
    ringHz: 3100,
    ringQ: 26,
    ringTime: 1.1,
    thudHz: 240,
    thud: 0.15,
    grit: 0.1,
    gritHz: 5200,
    drive: 1,
    level: 0.6,
    reverb: 0.55,
  },
};

interface WeaponMod {
  readonly hit: number;
  readonly ring: number;
  readonly thud: number;
  readonly pitch: number;
  readonly grit: number;
  /** Swing whoosh character. */
  readonly swishHz: number;
  readonly swishQ: number;
  readonly swishLen: number;
}

const WEAPONS: Record<Weapon, WeaponMod> = {
  blade: { hit: 1.1, ring: 1.2, thud: 0.8, pitch: 1.15, grit: 0.9, swishHz: 2400, swishQ: 1.5, swishLen: 0.26 },
  axe: { hit: 1.2, ring: 0.9, thud: 1.25, pitch: 0.9, grit: 1.2, swishHz: 1500, swishQ: 1.1, swishLen: 0.34 },
  blunt: { hit: 1.3, ring: 0.55, thud: 1.5, pitch: 0.75, grit: 0.8, swishHz: 1100, swishQ: 0.9, swishLen: 0.38 },
  spear: { hit: 0.9, ring: 1.05, thud: 0.7, pitch: 1.25, grit: 0.7, swishHz: 2900, swishQ: 1.9, swishLen: 0.2 },
  unarmed: { hit: 0.8, ring: 0.4, thud: 1.2, pitch: 0.85, grit: 0.6, swishHz: 900, swishQ: 0.8, swishLen: 0.22 },
  claw: { hit: 1.0, ring: 0.7, thud: 0.8, pitch: 1.35, grit: 1.4, swishHz: 3200, swishQ: 1.7, swishLen: 0.18 },
  arrow: { hit: 0.95, ring: 0.8, thud: 0.5, pitch: 1.4, grit: 1.0, swishHz: 3600, swishQ: 2.2, swishLen: 0.14 },
  staff: { hit: 0.7, ring: 0.6, thud: 1.1, pitch: 0.8, grit: 0.7, swishHz: 1300, swishQ: 1.0, swishLen: 0.36 },
};

export class Combat {
  private rng = new Rng(0xc0b47);
  private curve = saturationCurve(2.2);
  private loopClip = softClipCurve(512);

  constructor(private readonly graph: AudioGraph) {}

  /**
   * @param speed 0..2 relative swing speed. Faster is shorter, brighter and
   *        sweeps further — the same gesture the arm makes.
   */
  swing(weapon: Weapon, speed = 1, position?: Vec3 | null, dir?: Vec3 | null): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const w = WEAPONS[weapon] ?? WEAPONS.blade;
    const s = clamp(speed, 0.35, 2.2);
    const v = g.voice({
      bus: 'sfx',
      gain: 1.6 * lerp(0.6, 1.25, clamp01((s - 0.35) / 1.6)),
      position: position ?? null,
      reverb: 0.14,
      refDistance: 4,
      maxDistance: 70,
      orientation: dir ?? undefined,
      coneInner: 120,
      coneOuter: 300,
      coneOuterGain: 0.5,
    });
    if (!v) return;
    const t = v.t;
    const dur = w.swishLen / s;

    const src = ctx.createBufferSource();
    src.buffer = g.buffers?.noise('white') ?? null;
    src.loop = true;
    src.playbackRate.value = this.rng.range(0.9, 1.1);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = w.swishQ;
    const top = w.swishHz * s * this.rng.range(0.9, 1.1);
    // The Doppler arc of a blade past your ear: up into the pass, down out of it.
    glide(bp.frequency, t, [
      [0, top * 0.32],
      [dur * 0.52, top],
      [dur, top * 0.28],
    ]);

    const gn = ctx.createGain();
    gn.gain.setValueAtTime(1e-4, t);
    gn.gain.exponentialRampToValueAtTime(0.9, t + dur * 0.55);
    gn.gain.exponentialRampToValueAtTime(1e-4, t + dur * 1.15);

    src.connect(bp).connect(gn).connect(v.out);
    src.start(t, this.rng.range(0, 3.5));
    src.stop(t + dur * 1.3);
    v.keep(src);
    v.keep(bp);
    v.keep(gn);
    v.release(dur * 1.3 + 0.15);
  }

  /** @param force 0..1+; scales level, drive and the low thud, not the pitch. */
  impact(weapon: Weapon, target: Target, force = 1, position?: Vec3 | null): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const base = TARGETS[target] ?? DEFAULT_IMPACT;
    const w = WEAPONS[weapon] ?? WEAPONS.blade;
    const f = clamp(force, 0.15, 2);
    const jitter = Math.pow(2, this.rng.range(-1.6, 1.6) / 12);

    const v = g.voice({
      bus: 'sfx',
      gain: base.level * lerp(0.5, 1.15, clamp01(f / 1.6)) * this.rng.range(0.9, 1.1),
      position: position ?? null,
      reverb: base.reverb,
      refDistance: 5,
      maxDistance: 140,
      hrtf: true,
    });
    if (!v) return;
    const t = v.t;

    const shaper = ctx.createWaveShaper();
    shaper.curve = this.curve;
    shaper.connect(v.out);
    v.keep(shaper);
    const drive = ctx.createGain();
    drive.gain.value = clamp(base.drive * w.hit * (0.6 + f * 0.5), 0.3, 4);
    drive.connect(shaper);
    v.keep(drive);

    // Transient: a very short noise burst, high-passed so it reads as contact
    // rather than as a thump. This is what makes a hit feel like it connected.
    const clickDur = 0.012 + 0.02 * (1 - base.hit);
    const click = ctx.createBufferSource();
    click.buffer = g.buffers?.noise('white') ?? null;
    click.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200 * w.pitch;
    const cg = ctx.createGain();
    ad(cg.gain, t, base.hit * w.hit, 0.001, clickDur);
    click.connect(hp).connect(cg).connect(drive);
    click.start(t, this.rng.range(0, 3.5));
    click.stop(t + clickDur + 0.03);
    v.keep(click);
    v.keep(hp);
    v.keep(cg);

    // Resonance: the struck body ringing. High Q and a long time constant is
    // chitin; low Q and a short one is meat.
    const ringTime = base.ringTime * w.ring;
    if (ringTime > 0.02) {
      const rs = ctx.createBufferSource();
      rs.buffer = g.buffers?.noise('white') ?? null;
      rs.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = base.ringHz * w.pitch * jitter;
      bp.Q.value = base.ringQ;
      const bp2 = ctx.createBiquadFilter();
      bp2.type = 'bandpass';
      // A second partial at a non-integer ratio: real shells are inharmonic.
      bp2.frequency.value = base.ringHz * w.pitch * jitter * 2.37;
      bp2.Q.value = base.ringQ * 0.7;
      const rg = ctx.createGain();
      ad(rg.gain, t, 0.55 * w.ring, 0.002, ringTime * 2);
      rs.connect(bp).connect(rg);
      rs.connect(bp2).connect(rg);
      rg.connect(drive);
      rs.start(t, this.rng.range(0, 3.5));
      rs.stop(t + ringTime * 2.2 + 0.05);
      v.keep(rs);
      v.keep(bp);
      v.keep(bp2);
      v.keep(rg);
    }

    if (base.thud * w.thud > 0.05) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const hz = base.thudHz * w.pitch;
      glide(o.frequency, t, [
        [0, hz * 2.1],
        [0.05, hz],
        [0.2, hz * 0.7],
      ]);
      const og = ctx.createGain();
      ad(og.gain, t, base.thud * w.thud * f * 0.8, 0.003, 0.16);
      o.connect(og).connect(v.out);
      o.start(t);
      o.stop(t + 0.25);
      v.keep(o);
      v.keep(og);
    }

    const grit = base.grit * w.grit;
    if (grit > 0.08) {
      const gs = ctx.createBufferSource();
      gs.buffer = g.buffers?.noise(target === 'flesh' ? 'brown' : 'white') ?? null;
      gs.loop = true;
      const gf = ctx.createBiquadFilter();
      gf.type = 'bandpass';
      gf.Q.value = 0.8;
      glide(gf.frequency, t, [
        [0, base.gritHz * w.pitch],
        [0.12, base.gritHz * 0.4],
      ]);
      const gg = ctx.createGain();
      ad(gg.gain, t, grit * 0.4, 0.004, 0.11);
      gs.connect(gf).connect(gg).connect(v.out);
      gs.start(t, this.rng.range(0, 3.5));
      gs.stop(t + 0.2);
      v.keep(gs);
      v.keep(gf);
      v.keep(gg);
    }

    v.release(Math.max(0.4, ringTime * 2.4) + 0.2);
  }

  /** Bowstring under tension: creak of the limbs plus the arrow on the rest. */
  bowDraw(position?: Vec3 | null): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const v = g.voice({ bus: 'sfx', gain: 0.4, position: position ?? null, reverb: 0.12 });
    if (!v) return;
    const t = v.t;
    const src = ctx.createBufferSource();
    src.buffer = g.buffers?.noise('pink') ?? null;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 6;
    glide(bp.frequency, t, [
      [0, 420],
      [0.55, 900],
    ]);
    const gn = ctx.createGain();
    // Creak is stick-slip: a slow tremolo, not a smooth swell.
    gn.gain.setValueCurveAtTime(this.creakCurve(), t, 0.55);
    src.connect(bp).connect(gn).connect(v.out);
    src.start(t, this.rng.range(0, 3.5));
    src.stop(t + 0.6);
    v.keep(src);
    v.keep(bp);
    v.keep(gn);
    v.release(0.7);
  }

  /** The release: string twang, limb thock, and the arrow leaving. */
  bowRelease(position?: Vec3 | null, dir?: Vec3 | null): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const v = g.voice({ bus: 'sfx', gain: 0.7, position: position ?? null, reverb: 0.2, hrtf: true });
    if (!v) return;
    const t = v.t;

    // Karplus-Strong string. The 128-sample subtraction compensates for the
    // block latency Web Audio adds to any feedback loop; without it every
    // plucked pitch comes out flat.
    const hz = this.rng.range(96, 118);
    const block = 128 / ctx.sampleRate;
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = Math.max(1 / ctx.sampleRate, 1 / hz - block);
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2600;
    // Below 1/sqrt(2) the filter has no resonant peak, so the loop gain is
    // bounded by fb alone. Above it, the delay line diverges.
    damp.Q.value = 0.5;
    const fb = ctx.createGain();
    fb.gain.value = 0.88;
    const limit = ctx.createWaveShaper();
    limit.curve = this.loopClip;
    delay.connect(damp).connect(limit).connect(fb).connect(delay);

    const ex = ctx.createBufferSource();
    ex.buffer = g.buffers?.burst(1 / hz) ?? null;
    const eg = ctx.createGain();
    eg.gain.value = 0.85;
    ex.connect(eg).connect(delay);
    damp.connect(v.out);
    ex.start(t);
    v.keep(ex);
    v.keep(eg);
    v.keep(delay);
    v.keep(damp);
    v.keep(limit);
    v.keep(fb);

    // Limb thock: the bow itself, a broadband knock.
    const k = ctx.createBufferSource();
    k.buffer = g.buffers?.noise('brown') ?? null;
    k.loop = true;
    const kf = ctx.createBiquadFilter();
    kf.type = 'bandpass';
    kf.frequency.value = 260;
    kf.Q.value = 2.4;
    const kg = ctx.createGain();
    ad(kg.gain, t, 0.6, 0.002, 0.09);
    k.connect(kf).connect(kg).connect(v.out);
    k.start(t, this.rng.range(0, 3.5));
    k.stop(t + 0.14);
    v.keep(k);
    v.keep(kf);
    v.keep(kg);
    v.release(0.9);

    this.arrowFlight(position, dir);
  }

  /** Fletching in the air: a narrow band that falls in pitch as it recedes. */
  arrowFlight(position?: Vec3 | null, dir?: Vec3 | null): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const v = g.voice({
      bus: 'sfx',
      gain: 0.26,
      position: position ?? null,
      reverb: 0.08,
      refDistance: 3,
      maxDistance: 60,
      orientation: dir ?? undefined,
      coneInner: 60,
      coneOuter: 220,
      coneOuterGain: 0.25,
    });
    if (!v) return;
    const t = v.t + 0.02;
    const dur = 0.42;
    const src = ctx.createBufferSource();
    src.buffer = g.buffers?.noise('white') ?? null;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 5.5;
    glide(bp.frequency, t, [
      [0, 4200],
      [dur, 1500],
    ]);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(1e-4, t);
    gn.gain.exponentialRampToValueAtTime(0.7, t + 0.03);
    gn.gain.exponentialRampToValueAtTime(1e-4, t + dur);
    src.connect(bp).connect(gn).connect(v.out);
    src.start(t, this.rng.range(0, 3.5));
    src.stop(t + dur + 0.05);
    v.keep(src);
    v.keep(bp);
    v.keep(gn);
    v.release(dur + 0.2);
  }

  private creakCurve() {
    const n = 96;
    const c = new Float32Array(n);
    let phase = this.rng.next() * 6.28;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      phase += 0.45 + this.rng.range(-0.12, 0.12);
      c[i] = (0.25 + 0.75 * u) * (0.55 + 0.45 * Math.sin(phase)) * 0.5;
    }
    c[n - 1] = 0;
    return c;
  }
}
