import type { WeatherState } from '../core/types';
import type { NoiseKind } from './Buffers';
import type { Creatures } from './Creatures';
import type { AudioGraph } from './Graph';
import { Rng, ad, clamp01, glide, lerp, smoothstep, type Vec3 } from './dsp';

/**
 * The ambience bed. Continuous layers are always resident and only ever change
 * gain and filter frequency — starting and stopping noise sources is what makes
 * a procedural bed audibly "switch", and the world should never switch.
 *
 * Sparse events (insects, spore-fall, thunder, distant calls) are scheduled
 * instead, because a rate is a much better model of a night full of things than
 * a looping texture is.
 */

export type LayerId = 'windLow' | 'windMid' | 'grit' | 'rumble' | 'surf' | 'rain' | 'hollow';

interface LayerDef {
  readonly noise: NoiseKind;
  readonly filter: BiquadFilterType;
  readonly hz: number;
  readonly q: number;
  /** Hz added at full gust. */
  readonly gustHz: number;
  readonly trim: number;
  readonly reverb: number;
}

const LAYERS: Record<LayerId, LayerDef> = {
  // The body of the wind: felt more than heard, and the thing that makes an
  // exposed ridge different from a sheltered vale.
  windLow: { noise: 'brown', filter: 'lowpass', hz: 210, q: 0.9, gustHz: 90, trim: 0.18, reverb: 0 },
  // The audible voice of it, swept by the gust so the air reads as moving.
  windMid: { noise: 'pink', filter: 'bandpass', hz: 780, q: 0.75, gustHz: 900, trim: 0.09, reverb: 0.05 },
  // Ash on your face. Broadband, bright, and the whole character of a storm.
  grit: { noise: 'white', filter: 'highpass', hz: 1900, q: 0.7, gustHz: 1500, trim: 0.085, reverb: 0.04 },
  // Red Mountain. Sub-bass, barely modulated, always there when you are close.
  // Trimmed hard: at 0.45 this one layer was 90% of the bed's energy anywhere
  // within two mountain-radii, which is most of the island. Sub-bass that loud
  // is not "felt not heard", it is mud under the whole mix.
  rumble: { noise: 'brown', filter: 'lowpass', hz: 62, q: 2.4, gustHz: 26, trim: 0.24, reverb: 0.06 },
  surf: { noise: 'pink', filter: 'bandpass', hz: 430, q: 0.55, gustHz: 240, trim: 0.19, reverb: 0.12 },
  rain: { noise: 'white', filter: 'highpass', hz: 2400, q: 0.6, gustHz: 700, trim: 0.14, reverb: 0.08 },
  // The tone of an enclosed volume, replacing the wind indoors and underground.
  hollow: { noise: 'brown', filter: 'lowpass', hz: 150, q: 3.4, gustHz: 0, trim: 0.22, reverb: 0.3 },
};

const LAYER_IDS = Object.keys(LAYERS) as LayerId[];

interface WeatherBed {
  readonly wind: number;
  readonly grit: number;
  readonly rain: number;
  readonly roar: number;
  readonly gust: number;
  /** Mean seconds between thunder claps; 0 disables. */
  readonly thunder: number;
}

const WEATHER: Record<WeatherState['kind'], WeatherBed> = {
  clear: { wind: 0.34, grit: 0.05, rain: 0, roar: 0, gust: 0.35, thunder: 0 },
  cloudy: { wind: 0.48, grit: 0.08, rain: 0, roar: 0.05, gust: 0.5, thunder: 0 },
  overcast: { wind: 0.58, grit: 0.1, rain: 0, roar: 0.1, gust: 0.6, thunder: 0 },
  rain: { wind: 0.6, grit: 0.04, rain: 0.72, roar: 0.12, gust: 0.55, thunder: 0 },
  thunder: { wind: 0.78, grit: 0.06, rain: 0.95, roar: 0.28, gust: 0.85, thunder: 15 },
  ashstorm: { wind: 1.0, grit: 1.0, rain: 0, roar: 0.8, gust: 1.0, thunder: 0 },
  blight: { wind: 0.88, grit: 0.72, rain: 0, roar: 0.62, gust: 0.92, thunder: 55 },
  blizzard: { wind: 0.95, grit: 0.5, rain: 0.12, roar: 0.45, gust: 0.95, thunder: 0 },
};

/** Everything the bed needs to know about where the player is standing. */
export interface AmbienceEnv {
  kind: WeatherState['kind'];
  /** Previous weather, for the crossfade. */
  from: WeatherState['kind'];
  blend: number;
  windSpeed: number;
  wetness: number;
  hour: number;
  /** 0 at the coast, 1 in the caldera. */
  volcanism: number;
  altitude: number;
  /** 0..1 proximity to open water. */
  coast: number;
  /** 0..1 fungal/plant cover around the listener. */
  vegetation: number;
  submerged: number;
  /** 0..1 enclosure, from the current reverb space. */
  enclosure: number;
  listener: Vec3;
}

interface Layer {
  src: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  target: number;
}

export class Ambience {
  private rng = new Rng(0xa46b1e);
  private layers = new Map<LayerId, Layer>();
  private started = false;

  /** Non-periodic gust envelope. A sine here would tick like a metronome. */
  private gust = 0.4;
  private gustVel = 0;
  private swell = 0;

  private nextChitter = 3;
  private nextSpore = 7;
  private nextDrip = 4;
  private nextThunder = 20;
  private nextDistant = 30;

  constructor(
    private readonly graph: AudioGraph,
    private readonly creatures: Creatures,
  ) {}

  /** Builds the resident layers. Called once, after the graph unlocks. */
  start(): void {
    if (this.started) return;
    const g = this.graph;
    const ctx = g.ctx;
    const bus = g.bus('ambience');
    if (!ctx || !bus) return;
    this.started = true;

    for (const id of LAYER_IDS) {
      const def = LAYERS[id];
      const filter = ctx.createBiquadFilter();
      filter.type = def.filter;
      filter.frequency.value = def.hz;
      filter.Q.value = def.q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      filter.connect(gain).connect(bus);
      if (def.reverb > 0) {
        const send = g.reverbSend('ambience');
        if (send) {
          const s = ctx.createGain();
          s.gain.value = def.reverb;
          gain.connect(s).connect(send);
        }
      }
      // Each layer reads the shared bed from a different offset, so three
      // layers of the same noise buffer do not correlate into a comb filter.
      const src = g.loop(def.noise, filter, this.rng.range(0, 3.9));
      if (!src) continue;
      this.layers.set(id, { src, filter, gain, target: 0 });
    }
  }

  /** Called every frame; only the cheap gust integration runs at full rate. */
  update(dt: number, env: AmbienceEnv): void {
    if (!this.started) return;
    const ctx = this.graph.ctx;
    if (!ctx) return;

    // Brownian gust with a restoring force toward the wind's mean strength.
    const bed = this.bed(env);
    const mean = 0.25 + bed.gust * 0.55;
    this.gustVel += (this.rng.next() - 0.5) * dt * 5.5 - (this.gust - mean) * dt * 1.6;
    this.gustVel *= Math.exp(-dt * 1.1);
    this.gust = clamp01(this.gust + this.gustVel * dt);

    // Two incommensurate periods: the surf never repeats on a bar line.
    this.swell += dt;
    const surfSwell =
      0.55 + 0.28 * Math.sin(this.swell * 0.755) + 0.17 * Math.sin(this.swell * 0.293 + 1.9);

    this.mix(ctx, env, bed, surfSwell);
    this.sparse(dt, env, bed);
  }

  private bed(env: AmbienceEnv): WeatherBed {
    const a = WEATHER[env.from] ?? WEATHER.clear;
    const b = WEATHER[env.kind] ?? WEATHER.clear;
    const t = clamp01(env.blend);
    return {
      wind: lerp(a.wind, b.wind, t),
      grit: lerp(a.grit, b.grit, t),
      rain: lerp(a.rain, b.rain, t),
      roar: lerp(a.roar, b.roar, t),
      gust: lerp(a.gust, b.gust, t),
      thunder: t > 0.5 ? b.thunder : a.thunder,
    };
  }

  private mix(ctx: AudioContext, env: AmbienceEnv, bed: WeatherBed, surfSwell: number): void {
    const t = ctx.currentTime;
    const g = this.gust;
    const open = 1 - clamp01(env.enclosure);
    const dry = 1 - clamp01(env.submerged);
    // Wind speed is a real physical quantity here and the bed should answer to
    // it, not just to the weather label the sky system is currently in.
    const windScale = lerp(0.6, 1.35, clamp01(env.windSpeed / 18));
    // Exposure: a ridge at 600 m is a different acoustic place from a vale.
    const exposure = lerp(0.75, 1.3, smoothstep(20, 520, env.altitude));
    // Wind drops at night in the ashlands. Small effect, but it is the kind of
    // thing that makes a night walk feel different from a day one.
    const diurnal = lerp(0.82, 1.05, smoothstep(4, 11, env.hour) * smoothstep(23, 16, env.hour));

    const wind = bed.wind * windScale * exposure * diurnal * open * dry;
    const targets: Record<LayerId, number> = {
      windLow: wind * (0.55 + g * 0.75) * 0.9,
      windMid: wind * (0.3 + g * 0.95) * 0.55,
      grit: bed.grit * windScale * (0.4 + g * 0.9) * open * dry,
      // Volcanism dominates the rumble; storms only add to it.
      rumble: (bed.roar * 0.55 + Math.pow(clamp01(env.volcanism), 2.2) * 1.15) * lerp(0.55, 1, dry),
      surf: clamp01(env.coast) * surfSwell * lerp(0.6, 1.1, clamp01(env.windSpeed / 14)) * lerp(0.35, 1, open),
      rain: bed.rain * lerp(0.15, 1, open) * dry,
      hollow: clamp01(env.enclosure) * 0.8 + clamp01(env.submerged) * 0.5,
    };

    for (const id of LAYER_IDS) {
      const l = this.layers.get(id);
      if (!l) continue;
      const def = LAYERS[id];
      l.target = clamp01(targets[id]) * def.trim;
      // 0.35 s is slow enough that the gust reads as air moving and not as an
      // envelope, and fast enough to follow a storm front arriving.
      l.gain.gain.setTargetAtTime(l.target, t, 0.35);
      if (def.gustHz > 0) {
        l.filter.frequency.setTargetAtTime(def.hz + def.gustHz * g, t, 0.45);
      }
    }
  }

  /** Scheduled one-shots. Rates, not loops. */
  private sparse(dt: number, env: AmbienceEnv, bed: WeatherBed): void {
    const night = smoothstep(19.5, 21.5, env.hour) + smoothstep(6.5, 4.5, env.hour);
    const nightAmt = clamp01(night);
    const open = 1 - clamp01(env.enclosure);
    const dry = 1 - clamp01(env.submerged);

    // Insects and spore-fall live in the groves, at night, out of the storm.
    const grove = clamp01(env.vegetation) * nightAmt * open * dry * (1 - clamp01(bed.grit));
    this.nextChitter -= dt * (0.15 + grove * 5.5);
    if (this.nextChitter <= 0) {
      this.nextChitter = this.rng.range(0.4, 1.8);
      if (grove > 0.08) this.chitter(env, grove);
    }

    this.nextSpore -= dt * (0.05 + clamp01(env.vegetation) * open * dry * 1.6);
    if (this.nextSpore <= 0) {
      this.nextSpore = this.rng.range(1.2, 4.5);
      if (env.vegetation > 0.1) this.spore(env);
    }

    // Water in an enclosed space. The single most effective cave cue there is.
    this.nextDrip -= dt * clamp01(env.enclosure) * (0.8 + clamp01(env.wetness));
    if (this.nextDrip <= 0) {
      this.nextDrip = this.rng.range(1.5, 7);
      if (env.enclosure > 0.4) this.drip(env);
    }

    if (bed.thunder > 0) {
      this.nextThunder -= dt;
      if (this.nextThunder <= 0) {
        this.nextThunder = this.rng.range(bed.thunder * 0.5, bed.thunder * 1.8);
        this.thunder(env, open);
      }
    } else {
      this.nextThunder = Math.max(this.nextThunder, 8);
    }

    // Distant life. A cliff racer three hundred metres away is the sound of
    // Vvardenfell, and the fact that it is coming for you is the point.
    this.nextDistant -= dt * open * dry * lerp(0.35, 1, 1 - clamp01(bed.grit));
    if (this.nextDistant <= 0) {
      this.nextDistant = this.rng.range(22, 70);
      this.distantCall(env, nightAmt);
    }
  }

  private around(env: AmbienceEnv, minR: number, maxR: number, minY: number, maxY: number): Vec3 {
    const a = this.rng.range(0, Math.PI * 2);
    const r = lerp(minR, maxR, Math.sqrt(this.rng.next()));
    return {
      x: env.listener.x + Math.cos(a) * r,
      y: env.listener.y + this.rng.range(minY, maxY),
      z: env.listener.z + Math.sin(a) * r,
    };
  }

  /** A burst of insect stridulation: fast AM on a narrow high band. */
  private chitter(env: AmbienceEnv, amount: number): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const v = g.voice({
      bus: 'ambience',
      gain: this.rng.range(0.1, 0.28) * amount,
      position: this.around(env, 2, 22, -1, 2.5),
      reverb: 0.18,
      refDistance: 2.5,
      maxDistance: 40,
      rolloff: 1.7,
    });
    if (!v) return;
    const t = v.t;
    const pulses = 4 + this.rng.int(9);
    const rate = this.rng.range(16, 34);
    const dur = pulses / rate;
    const hz = this.rng.range(3200, 6200);

    const src = ctx.createBufferSource();
    src.buffer = g.buffers?.noise('white') ?? null;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = hz;
    bp.Q.value = this.rng.range(8, 22);
    const am = ctx.createGain();
    am.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = rate;
    const la = ctx.createGain();
    la.gain.value = 0.5;
    const env2 = ctx.createGain();
    ad(env2.gain, t, 1, 0.02, dur);
    lfo.connect(la).connect(am.gain);
    src.connect(bp).connect(am).connect(env2).connect(v.out);
    src.start(t, this.rng.range(0, 3.5));
    lfo.start(t);
    src.stop(t + dur + 0.1);
    lfo.stop(t + dur + 0.1);
    for (const n of [src, bp, am, lfo, la, env2]) v.keep(n);
    v.release(dur + 0.3);
  }

  /** Spore-fall: a soft, low, almost-inaudible tick with a long room around it. */
  private spore(env: AmbienceEnv): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const v = g.voice({
      bus: 'ambience',
      gain: this.rng.range(0.06, 0.16),
      position: this.around(env, 1.5, 14, -1.5, 4),
      reverb: 0.35,
      refDistance: 2,
      maxDistance: 28,
      rolloff: 2,
    });
    if (!v) return;
    const t = v.t;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f = this.rng.range(180, 520);
    glide(o.frequency, t, [
      [0, f * 1.7],
      [0.08, f],
    ]);
    const gn = ctx.createGain();
    ad(gn.gain, t, 0.6, 0.004, 0.11);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    o.connect(lp).connect(gn).connect(v.out);
    o.start(t);
    o.stop(t + 0.2);
    for (const n of [o, lp, gn]) v.keep(n);
    v.release(0.4);
  }

  private drip(env: AmbienceEnv): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const v = g.voice({
      bus: 'ambience',
      gain: this.rng.range(0.14, 0.3),
      position: this.around(env, 2, 18, -2, 3),
      reverb: 0.7,
      refDistance: 2,
      maxDistance: 40,
    });
    if (!v) return;
    const t = v.t;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f = this.rng.range(900, 2200);
    // The rising pitch is the Helmholtz resonance of the cavity closing behind
    // the drop. Getting the direction wrong makes it a plink, not a drip.
    glide(o.frequency, t, [
      [0, f * 0.65],
      [0.055, f * 1.35],
    ]);
    const gn = ctx.createGain();
    ad(gn.gain, t, 0.55, 0.002, 0.075);
    o.connect(gn).connect(v.out);
    o.start(t);
    o.stop(t + 0.14);
    v.keep(o);
    v.keep(gn);
    v.release(0.3);
  }

  private thunder(env: AmbienceEnv, open: number): void {
    const g = this.graph;
    const ctx = g.ctx;
    if (!ctx) return;
    const near = this.rng.next() < 0.25;
    const v = g.voice({
      bus: 'ambience',
      gain: (near ? 0.85 : 0.45) * lerp(0.35, 1, open),
      position: this.around(env, near ? 60 : 300, near ? 200 : 1400, 120, 500),
      reverb: 0.5,
      refDistance: 120,
      maxDistance: 4000,
      rolloff: 0.5,
    });
    if (!v) return;
    const t = v.t;
    const dur = near ? 2.6 : this.rng.range(3.5, 6.5);

    const src = ctx.createBufferSource();
    src.buffer = g.buffers?.noise('brown') ?? null;
    src.loop = true;
    src.playbackRate.value = this.rng.range(0.7, 1.05);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.2;
    glide(lp.frequency, t, [
      [0, near ? 2600 : 320],
      [dur * 0.35, near ? 420 : 150],
      [dur, 70],
    ]);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(1e-4, t);
    gn.gain.exponentialRampToValueAtTime(1, t + (near ? 0.01 : 0.5));
    // Rolling, not a single decay: the tail rides a slow tremble.
    gn.gain.exponentialRampToValueAtTime(0.35, t + dur * 0.45);
    gn.gain.exponentialRampToValueAtTime(0.6, t + dur * 0.62);
    gn.gain.exponentialRampToValueAtTime(1e-4, t + dur);
    src.connect(lp).connect(gn).connect(v.out);
    src.start(t, this.rng.range(0, 3.5));
    src.stop(t + dur + 0.1);
    for (const n of [src, lp, gn]) v.keep(n);
    v.release(dur + 0.4);
  }

  private distantCall(env: AmbienceEnv, night: number): void {
    // Silt striders call by day and carry for kilometres; racers hunt in the
    // open at any hour; netches drift over the coast.
    const roll = this.rng.next();
    if (roll < 0.42) {
      this.creatures.call('cliffracer', 'idle', this.around(env, 70, 260, 20, 70));
    } else if (roll < 0.62 && night < 0.5) {
      this.creatures.call('siltstrider', 'idle', this.around(env, 400, 1400, 10, 60));
    } else if (roll < 0.8 && env.coast > 0.25) {
      this.creatures.call('netch', 'idle', this.around(env, 60, 320, 5, 40));
    } else if (roll < 0.92) {
      this.creatures.call('nixhound', 'idle', this.around(env, 40, 180, -2, 6));
    } else {
      this.creatures.call('guar', 'idle', this.around(env, 30, 140, -2, 4));
    }
  }

  dispose(): void {
    for (const l of this.layers.values()) {
      try {
        l.src.stop();
      } catch {
        /* already stopped */
      }
      l.src.disconnect();
      l.filter.disconnect();
      l.gain.disconnect();
    }
    this.layers.clear();
    this.started = false;
  }
}
