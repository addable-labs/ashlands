import * as THREE from 'three';
import type { IAtmosphere, IMaterials } from '../core/contracts';
import type { Ctx, PBRSet, WeatherState } from '../core/types';
import { MATERIAL_DEFS } from './Library';
import { EnvSynthesizer, Synthesizer, defaultEnvParams, type EnvParams } from './Synth';

export type { EnvParams } from './Synth';

/** Every set name `MaterialSystem.get` will answer to. For debug UI enumeration. */
export const MATERIAL_NAMES: readonly string[] = MATERIAL_DEFS.map((d) => d.name);

/**
 * Tiling variants share the underlying GPU texture. three keys its texture
 * cache on sampler state (wrap, filters, anisotropy, format) but *not* on
 * repeat, so a clone that only changes repeat costs one JS object and zero VRAM.
 */
const tiledCache = new WeakMap<THREE.Texture, Map<number, THREE.Texture>>();
const tiledLive = new Set<THREE.Texture>();
let tiledAnisotropy = 8;

function tiledTexture(src: THREE.Texture, repeat: number): THREE.Texture {
  let byRepeat = tiledCache.get(src);
  if (byRepeat === undefined) {
    byRepeat = new Map();
    tiledCache.set(src, byRepeat);
  }
  const hit = byRepeat.get(repeat);
  if (hit !== undefined) return hit;

  // `Texture.clone()` runs through `Texture.copy()`, whose last statement is
  // `this.needsUpdate = true` — and that setter does NOT only bump the clone. It
  // bumps `this.source.version`, and the Source is SHARED with the original by
  // construction (that sharing is the whole point of this cache).
  //
  // three gates its entire texture upload path on
  // `source.version !== sourceProperties.__version`, and the last thing that
  // path does is
  //
  //     if ( textureNeedsGenerateMipmaps( texture ) ) generateMipmap( target );
  //
  // So one clone makes the *next* bind of that source re-enter the upload path
  // and call glGenerateMipmap, which overwrites levels 1..n with the driver's
  // plain box filter — throwing away the variance-coupled chain Synth.buildMips
  // wrote by hand, on every set the moment anything asked for a tiled variant.
  //
  // This was measured on the shipped iter13 build, not deduced. Reading the ARM
  // map that the architecture system had bound, level by level, off the live
  // engine gave a roughness that was CONSTANT down the whole chain —
  //
  //     basalt   0.56 0.56 0.56 0.56 0.56 0.56
  //     chitin   0.27 0.27 0.27 0.27 0.27 0.27
  //     bark     0.80 0.80 0.81 0.81 0.81 0.81
  //
  // — which is the signature of a box average, since a box filter preserves the
  // mean exactly. The same three sets read straight off the synthesizer run
  // 0.56 -> 0.77, 0.27 -> 0.39 and 0.81 -> 1.00. Every tower, hut, landmark,
  // prop and weapon in the game was therefore shading its distant pixels with a
  // needle-sharp specular lobe over normals whose sub-texel detail had been
  // filtered out from under it: exactly the aliasing the chain exists to
  // prevent, and a material whose response at forty metres was no longer the
  // one that was authored.
  //
  // The clone genuinely needs its own `version` — that is what makes three give
  // it its own sampler state and its own uv transform. The SOURCE has not
  // changed a byte, so its version is put back. Sampler state below is kept
  // byte-identical to `makeOutputTexture` on purpose: three keys the GPU texture
  // object on exactly those fields, so matching them is what lets the clone
  // alias the original's texture instead of forcing a reallocation (which would
  // destroy the chain by a second route).
  const sourceVersion = src.source.version;
  const t = src.clone();
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = tiledAnisotropy;
  t.name = `${src.name}@${repeat}`;
  src.source.version = sourceVersion;
  byRepeat.set(repeat, t);
  tiledLive.add(t);
  return t;
}

function releaseTiled(): void {
  for (const t of tiledLive) t.dispose();
  tiledLive.clear();
}

/**
 * Wire a synthesized set onto a standard material.
 *
 * `repeat` other than 1 goes through the shared-clone cache above, so calling
 * this a thousand times with the same repeat allocates one set of clones.
 *
 * The maps are multiplicative in three's standard shader, hence the unit
 * scalars: the ARM texture is the authority on roughness and metalness.
 */
export function applyPBR(mat: THREE.MeshStandardMaterial, set: PBRSet, repeat = 1): void {
  const arm = repeat === 1 ? set.arm : tiledTexture(set.arm, repeat);
  mat.map = repeat === 1 ? set.albedo : tiledTexture(set.albedo, repeat);
  mat.normalMap = repeat === 1 ? set.normal : tiledTexture(set.normal, repeat);
  mat.roughnessMap = arm;
  mat.metalnessMap = arm;
  mat.aoMap = arm;
  mat.roughness = 1;
  mat.metalness = 1;
  mat.aoMapIntensity = 1;
  mat.normalScale.set(1, 1);
  mat.needsUpdate = true;
}

class SharedSet implements PBRSet {
  constructor(
    readonly albedo: THREE.Texture,
    readonly normal: THREE.Texture,
    readonly arm: THREE.Texture,
  ) {}
  dispose(): void {
    this.albedo.dispose();
    this.normal.dispose();
    this.arm.dispose();
  }
}

export interface MaterialSystemOptions {
  /** Edge length of every synthesized map. Drop to 512 for a low tier: /4 VRAM. */
  size?: number;
  /** Edge length of each face of the sky cube fed to PMREM. */
  envSize?: number;
  /**
   * Track the atmosphere system's sun and re-prefilter the IBL when it moves.
   * Off only for a diagnostic that wants a frozen environment.
   */
  followSky?: boolean;
}

/**
 * Reference conditions for the IBL tracking below: the peak component of
 * `WeatherState.sunColor` and the luminance of `WeatherState.ambient`, both
 * measured off the live atmosphere system at noon under clear weather.
 *
 * They exist so that the *reference* case reproduces the previously hand-set
 * environment exactly, and every other hour is scaled relative to it. Anything
 * else would silently re-expose the whole game off the back of a bug fix.
 */
const REF_SUN_PEAK = 2.67;
const REF_AMB_LUMA = 0.1405;

/** Authored dome anchors, scaled and tinted per weather. See syncEnv. */
const ZENITH_0 = new THREE.Color(0.052, 0.049, 0.086);
const HORIZON_0 = new THREE.Color(0.42, 0.20, 0.115);
const GROUND_0 = new THREE.Color(0.062, 0.052, 0.045);

/** Sulphur murk and ash-sheet coverage per weather kind. */
const SKY_MOOD: Record<WeatherState['kind'], readonly [number, number]> = {
  clear: [0.55, 0.45],
  cloudy: [0.62, 0.7],
  overcast: [0.72, 0.85],
  rain: [0.76, 0.9],
  thunder: [0.82, 0.95],
  ashstorm: [0.95, 0.98],
  blight: [0.86, 0.9],
  blizzard: [0.9, 0.9],
};

function luma(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * Procedural PBR material synthesis.
 *
 * Runs at order -100 so every other visual system can call `get()` from its own
 * `init` and be certain the textures exist.
 */
export class MaterialSystem implements IMaterials {
  readonly id = 'materials';
  readonly order = -100;

  private readonly sets = new Map<string, PBRSet>();
  private readonly tiledSets = new Map<string, PBRSet>();
  private readonly size: number;
  private readonly envSize: number;
  private envSynth: EnvSynthesizer | null = null;
  private envParams: EnvParams = defaultEnvParams();
  private _env: THREE.Texture | null = null;
  private ctx: Ctx | null = null;
  private readonly followSky: boolean;
  private sky: IAtmosphere | null = null;
  /** Sun direction the current PMREM was prefiltered for. */
  private readonly envSunDir = new THREE.Vector3(NaN, NaN, NaN);
  private envSunPeak = -1;
  private envAmbLuma = -1;
  private envMood = -1;
  private envCooldown = 0;
  private readonly scratchCol = new THREE.Color();
  private readonly scratchHue = new THREE.Color();

  constructor(opts: MaterialSystemOptions = {}) {
    this.size = opts.size ?? 1024;
    this.envSize = opts.envSize ?? 128;
    this.followSky = opts.followSky ?? true;
  }

  get env(): THREE.Texture | null {
    return this._env;
  }

  async init(ctx: Ctx): Promise<void> {
    // Re-init after dispose is supported; a second init *without* dispose would
    // silently orphan 63 textures and an EnvSynthesizer, so make it a no-op.
    if (this.envSynth !== null) {
      this.ctx = ctx;
      ctx.scene.environment = this._env;
      return;
    }
    this.ctx = ctx;
    const r = ctx.renderer;
    tiledAnisotropy = Math.min(r.capabilities.getMaxAnisotropy(), 16);

    const previous = r.getRenderTarget();
    const synth = new Synthesizer(r, this.size, tiledAnisotropy);
    try {
      for (let i = 0; i < MATERIAL_DEFS.length; i++) {
        const def = MATERIAL_DEFS[i];
        this.sets.set(def.name, synth.run(def));
        ctx.bus.emit('materials:progress', {
          name: def.name,
          done: i + 1,
          total: MATERIAL_DEFS.length,
        });
        // Yield every few materials. 21 back-to-back 1024^2 noise passes in one
        // task is enough to trip a browser's GPU watchdog on a weak machine,
        // and the loading bar cannot repaint from inside a single task anyway.
        if ((i & 3) === 3) await new Promise<void>((res) => setTimeout(res, 0));
      }
    } finally {
      synth.dispose();
    }

    this.envSynth = new EnvSynthesizer(r, this.envSize);
    this._env = this.envSynth.render(this.envParams);
    // Nothing else can produce this, so install it; the render pipeline is free
    // to override scene.environmentIntensity to taste.
    ctx.scene.environment = this._env;
    r.setRenderTarget(previous);
  }

  get(name: string): PBRSet {
    const set = this.sets.get(name);
    if (set === undefined) {
      throw new Error(`[materials] unknown set "${name}" (have: ${MATERIAL_NAMES.join(', ')})`);
    }
    return set;
  }

  tiled(name: string, repeat: number): PBRSet {
    const key = `${name}@${repeat}`;
    const hit = this.tiledSets.get(key);
    if (hit !== undefined) return hit;
    const base = this.get(name);
    const set = new SharedSet(
      tiledTexture(base.albedo, repeat),
      tiledTexture(base.normal, repeat),
      tiledTexture(base.arm, repeat),
    );
    this.tiledSets.set(key, set);
    return set;
  }

  /**
   * Keep the IBL on the same sun the sky is drawing.
   *
   * Nothing in the build called `refreshEnv` — `IMaterials` does not expose it,
   * so the atmosphere system had no way to reach it even though the contract
   * says the environment is "updated by the sky system each dusk/dawn". The
   * consequence was that `scene.environment` was prefiltered ONCE, at init, from
   * `defaultEnvParams()`: a sun fixed at (0.36, 0.42, -0.83) with a fixed warm
   * dawn colour at a fixed intensity, for every hour and every weather in the
   * game. Every object in the world therefore took its ambient and its whole
   * specular response from a dawn sky no matter where the real sun was, which is
   * a straight violation of bar item 9 and is exactly the "shaded by constant
   * ambient with no directional or view-dependent term, contradicting the sun
   * position" the review measured on the backlit wreck. A frozen warm dome is
   * also why unlit surfaces carried a warm cast at midnight.
   *
   * So the material system tracks the sky itself rather than waiting to be told.
   * `Ctx.get` is the sanctioned cross-system query and `IAtmosphere.weather` is
   * the authority on sun direction, sun radiance and ambient irradiance, so no
   * contract has to change.
   *
   * Calibration: at the reference condition (noon, clear) every quantity below
   * reproduces the previously hand-set parameters exactly, and every other hour
   * scales relative to it. A fix for a lighting bug must not re-expose the game.
   */
  private syncEnv(ctx: Ctx): void {
    if (this.sky === null) {
      this.sky = ctx.get<IAtmosphere>('sky') ?? null;
      if (this.sky === null) return;
    }
    const w = this.sky.weather;
    const p = this.envParams;

    const peak = Math.max(w.sunColor.r, w.sunColor.g, w.sunColor.b);
    const ambL = Math.max(luma(w.ambient), 1e-5);
    const mood = SKY_MOOD[w.kind] ?? SKY_MOOD.clear;
    const moodKey = mood[0] * 4 + mood[1];

    // Re-prefiltering is a 6-face render plus a PMREM chain. Gate it on the sun
    // having actually moved (0.012 is about 0.7 degrees, well under a pixel of
    // highlight travel at 1080p) so a still camera pays nothing.
    const moved =
      !Number.isFinite(this.envSunDir.x) ||
      this.envSunDir.dot(w.sunDir) < 0.99993 ||
      Math.abs(peak - this.envSunPeak) > Math.max(0.02, this.envSunPeak * 0.04) ||
      Math.abs(ambL - this.envAmbLuma) > Math.max(0.004, this.envAmbLuma * 0.04) ||
      Math.abs(moodKey - this.envMood) > 1e-4;
    if (!moved) return;
    if (this.envCooldown > 0) return;
    this.envCooldown = 0.4;

    p.sunDir.copy(w.sunDir).normalize();
    // Hue only; the magnitude goes into sunIntensity so the disc, the two glow
    // lobes and the cloud rim all scale together the way they do in the sky.
    if (peak > 1e-5) p.sunColor.copy(w.sunColor).multiplyScalar(1 / peak);
    else p.sunColor.setRGB(1, 1, 1);
    p.sunIntensity = 26 * Math.min(peak / REF_SUN_PEAK, 1.25);

    // Dome: keep the authored gradient shape, scale it by how much irradiance
    // the sky says it is actually producing, and pull its hue partway toward the
    // sky's own. Fully adopting the ambient hue would throw away the sulphur
    // horizon the art direction depends on.
    const scale = Math.min(Math.max(ambL / REF_AMB_LUMA, 0.30), 2.2);
    const hue = this.scratchHue.copy(w.ambient).multiplyScalar(1 / ambL);
    hue.setRGB(0.4 + 0.6 * hue.r, 0.4 + 0.6 * hue.g, 0.4 + 0.6 * hue.b);
    p.zenith.copy(ZENITH_0).multiply(hue).multiplyScalar(scale);
    // The ground hemisphere is ash bounce, so it takes the sun's warmth rather
    // than the sky's blue: half the tint, and only half as much of it.
    const gTint = this.scratchCol.setRGB(0.7 + 0.3 * hue.r, 0.7 + 0.3 * hue.g, 0.7 + 0.3 * hue.b);
    p.ground.copy(GROUND_0).multiply(gTint).multiplyScalar(scale);
    // The horizon band is where the low sun rakes the murk, so it takes the
    // sun's colour, weighted by how low the sun is.
    const graze = 1 - Math.min(Math.abs(w.sunDir.y), 1);
    p.horizon.copy(HORIZON_0).multiplyScalar(scale);
    p.horizon.lerp(this.scratchCol.copy(HORIZON_0).multiply(p.sunColor).multiplyScalar(scale * 1.6),
      graze * graze * 0.55);

    p.haze = mood[0];
    p.ash = mood[1];

    this.envSunDir.copy(p.sunDir);
    this.envSunPeak = peak;
    this.envAmbLuma = ambL;
    this.envMood = moodKey;
    this.refreshEnv();
  }

  update(ctx: Ctx): void {
    if (!this.followSky || this.envSynth === null) return;
    if (this.envCooldown > 0) this.envCooldown -= ctx.time.dt;
    this.syncEnv(ctx);
  }

  /**
   * Re-render the sky cube and re-prefilter it. The PMREM target is reused, so
   * `env` keeps its identity and anything already holding it stays correct;
   * 'materials:env' is emitted regardless for systems that cache derived state.
   */
  refreshEnv(params: Partial<EnvParams> = {}): THREE.Texture | null {
    if (this.envSynth === null || this.ctx === null) return this._env;
    Object.assign(this.envParams, params);
    const r = this.ctx.renderer;
    const previous = r.getRenderTarget();
    this._env = this.envSynth.render(this.envParams);
    this.ctx.scene.environment = this._env;
    r.setRenderTarget(previous);
    this.ctx.bus.emit('materials:env', { texture: this._env });
    return this._env;
  }

  dispose(): void {
    this.sky = null;
    this.envSunDir.set(NaN, NaN, NaN);
    this.envSunPeak = -1;
    this.envAmbLuma = -1;
    this.envMood = -1;
    this.envCooldown = 0;
    releaseTiled();
    this.tiledSets.clear();
    for (const set of this.sets.values()) set.dispose();
    this.sets.clear();
    this.envSynth?.dispose();
    this.envSynth = null;
    if (this.ctx !== null && this.ctx.scene.environment === this._env) {
      this.ctx.scene.environment = null;
    }
    this._env = null;
    this.ctx = null;
  }
}
