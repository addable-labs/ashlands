import * as THREE from 'three';

/**
 * Directional Gerstner spectrum for the Inner Sea.
 *
 * Twelve components sampled from a Pierson-Moskowitz-like energy curve with a
 * cos^2s directional spread about the wind axis. Angular frequencies follow the
 * deep-water dispersion relation w = sqrt(g*k); because the wavelengths are
 * drawn from an irrational geometric progression the component periods share no
 * common multiple, so the summed field has no perceptible repeat. A slow
 * per-component direction wander (recomputed on the CPU each frame, which keeps
 * the GPU and the buoyancy query bit-identical) removes the residual sense of a
 * fixed swell axis over long observation.
 */

export const WAVE_COUNT = 12;

const G = 9.81;
const LAMBDA_MAX = 240;
const LAMBDA_MIN = 1.7;

/** Total steepness budget. Above ~1.0 Gerstner crests self-intersect and pinch. */
const STEEPNESS_BUDGET = 0.88;

export interface WaveConfig {
  /** Wind bearing in radians, measured in the XZ plane from +X toward +Z. */
  windAngle: number;
  /** Metres per second. Drives both amplitude and the directional spread. */
  windSpeed: number;
  /** 0 = rolling swell, 1 = sharp pinched crests. */
  choppiness: number;
  /** Overall vertical scale multiplier, used to calm the sea in fair weather. */
  gain: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Component {
  /** Base (un-wandered) direction. */
  dx: number;
  dz: number;
  k: number;
  omega: number;
  phase: number;
  /** Wander rate and phase, in radians per second. */
  wanderRate: number;
  wanderPhase: number;
  wanderAmp: number;
  baseAmp: number;
}

export class WaveBank {
  /** xy = unit direction, z = wavenumber, w = amplitude. */
  readonly a: THREE.Vector4[] = [];
  /** x = angular frequency, y = phase, z = steepness Q, w = wavelength. */
  readonly b: THREE.Vector4[] = [];

  private comps: Component[] = [];
  private cfg: WaveConfig = { windAngle: 0.7, windSpeed: 11, choppiness: 0.72, gain: 1 };
  /** Cached for shore damping and for the CPU height query. */
  private ampScale = 1;

  constructor(seed = 0x5eab00d) {
    for (let i = 0; i < WAVE_COUNT; i++) {
      this.a.push(new THREE.Vector4());
      this.b.push(new THREE.Vector4());
    }
    this.build(seed, this.cfg);
  }

  /** Peak-to-trough of the fully developed sea, used to size bounding volumes. */
  get maxAmplitude(): number {
    let s = 0;
    for (const c of this.comps) s += c.baseAmp;
    return s * this.ampScale;
  }

  build(seed: number, cfg: WaveConfig): void {
    this.cfg = cfg;
    const rnd = mulberry32(seed);
    this.comps.length = 0;

    // Fetch-limited peak wavelength; components far from it carry little energy.
    const lPeak = Math.max(6, (0.86 * cfg.windSpeed * cfg.windSpeed) / G);

    for (let i = 0; i < WAVE_COUNT; i++) {
      const t = i / (WAVE_COUNT - 1);
      const lambda = LAMBDA_MAX * Math.pow(LAMBDA_MIN / LAMBDA_MAX, t) * (0.88 + 0.24 * rnd());
      const k = (Math.PI * 2) / lambda;

      // Long swell arrives nearly collimated; short chop is almost isotropic.
      const spread = 0.16 + 1.15 * t;
      const r = rnd() * 2 - 1;
      const theta = cfg.windAngle + r * r * r * spread;

      // PM-shaped energy in wavelength space, plus a cos^2 directional weight.
      const x = lPeak / lambda;
      const energy = Math.exp(-1.25 * x * x) * Math.pow(x, 1.1);
      const dirW = Math.pow(Math.max(0, Math.cos(r * r * r * spread)), 2.0);
      const baseAmp = Math.sqrt(Math.max(1e-6, energy * dirW)) * Math.pow(lambda, 0.55);

      this.comps.push({
        dx: Math.cos(theta),
        dz: Math.sin(theta),
        k,
        omega: Math.sqrt(G * k),
        phase: rnd() * Math.PI * 2,
        wanderRate: 0.006 + rnd() * 0.021,
        wanderPhase: rnd() * Math.PI * 2,
        wanderAmp: (0.03 + 0.09 * t) * (0.5 + rnd()),
        baseAmp,
      });
    }

    // Normalise to a significant wave height that tracks wind speed.
    let sum = 0;
    for (const c of this.comps) sum += c.baseAmp;
    const targetHs = 0.021 * cfg.windSpeed * cfg.windSpeed * cfg.gain;
    this.ampScale = targetHs / (2 * Math.max(1e-4, sum));

    // Distribute the steepness budget so that no single component pinches.
    let kaSum = 0;
    for (const c of this.comps) kaSum += c.k * c.baseAmp * this.ampScale;
    const q = (STEEPNESS_BUDGET * cfg.choppiness) / Math.max(1e-4, kaSum);

    for (let i = 0; i < WAVE_COUNT; i++) {
      const c = this.comps[i];
      const amp = c.baseAmp * this.ampScale;
      this.a[i].set(c.dx, c.dz, c.k, amp);
      this.b[i].set(c.omega, c.phase, q, (Math.PI * 2) / c.k);
    }
  }

  /** Applies the slow directional wander. Must run before any query for time t. */
  update(t: number): void {
    for (let i = 0; i < WAVE_COUNT; i++) {
      const c = this.comps[i];
      const ang = c.wanderAmp * Math.sin(c.wanderRate * t + c.wanderPhase);
      const s = Math.sin(ang);
      const co = Math.cos(ang);
      this.a[i].x = c.dx * co - c.dz * s;
      this.a[i].y = c.dx * s + c.dz * co;
    }
  }

  /**
   * Surface height at a world XZ, mirroring the vertex shader closely enough for
   * buoyancy and camera submersion. `damp` is the shoaling factor the shader
   * applies near shore; pass 1 in open water.
   */
  heightAt(x: number, z: number, t: number, damp: number): number {
    // Gerstner displaces horizontally, so the vertex whose crest lands over
    // (x,z) started somewhere else. Two fixed-point steps recover it closely
    // enough that a swimmer never pops through a crest.
    let sx = x;
    let sz = z;
    let y = 0;
    for (let pass = 0; pass < 3; pass++) {
      let dx = 0;
      let dz = 0;
      y = 0;
      for (let i = 0; i < WAVE_COUNT; i++) {
        const A = this.a[i];
        const B = this.b[i];
        const amp = A.w * damp;
        const phi = A.z * (A.x * sx + A.y * sz) - B.x * t + B.y;
        y += amp * Math.sin(phi);
        const c = B.z * amp * Math.cos(phi);
        dx += A.x * c;
        dz += A.y * c;
      }
      if (pass === 2) break;
      sx = x - dx;
      sz = z - dz;
    }
    return y;
  }
}
