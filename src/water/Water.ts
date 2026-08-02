import * as THREE from 'three';
import type { Ctx, System, WeatherState } from '../core/types';
import type { IAtmosphere, ITerrain } from '../core/contracts';
import { AERIAL_GLSL, aerialUniforms } from '../sky/Atmosphere';
import { bindAerial } from './aerial';
import { WaveBank, WAVE_COUNT, type WaveConfig } from './spectrum';
import { synthWaterTextures, type WaterTextures } from './textures';
import { buildDiscGeometry, buildSurfaceMaterial, DISC_TRIANGLES } from './WaterSurface';
import { WaterTargets } from './Reflection';
import { WaterComposite } from './Composite';

/** Baked terrain heightfield resolution. 1536^2 costs ~2.4M heightAt() calls at
 *  boot (tens of milliseconds) and gives ~2.6 m texels over a 2 km half-extent —
 *  the water column is a smooth field, and everything that needs a crisp edge
 *  reads it bilinearly per pixel. 4.7 MB on the GPU as R16F. */
const HEIGHT_RES = 1536;

/** Reflections update on alternate frames. The target is re-projected through
 *  the matrix it was rendered with, so a one-frame lag stays registered to the
 *  world and is invisible under the surface distortion. */
const REFLECTION_INTERVAL = 2;

/**
 * Beer-Lambert extinction per metre. Red goes first, as in any water; the green
 * window is deliberately narrower than clear ocean because the Inner Sea carries
 * suspended ash, which is also what keeps the shallows from reading as a
 * tropical lime against an ash-and-sulphur palette.
 */
const EXTINCTION = new THREE.Vector3(0.46, 0.185, 0.245);
/**
 * Volume SCATTERING coefficient of the column, per metre — the primitive, with
 * the albedo derived from it below rather than authored independently.
 *
 * Ash in suspension is a large-particle scatterer, so b is nearly flat in
 * wavelength with a slight rise toward blue; all of the colour comes from the
 * absorption that divides it. Authoring the albedo directly, as this used to,
 * left the two free to drift into a combination no water has: a sea whose
 * albedo was only 1.5:1 across the spectrum, which any warm key light then
 * flattened the rest of the way to neutral.
 */
const B_SCATTER = new THREE.Vector3(0.0230, 0.0225, 0.0245);
/**
 * Single-scattering albedo b/sigma. This is the colour deep water converges on,
 * and dividing by the extinction is what makes it a desaturated jade — the
 * Bitter Coast read — instead of whatever hue the light happened to be. Its
 * luminance is held at the old value, so this is a chroma correction and not a
 * brightening.
 */
const SCATTER = B_SCATTER.clone().divide(EXTINCTION);
/** Fallback body colour when the refraction pass was skipped. Same hue as the
 *  albedo by construction, so the two can never disagree. */
const DEEP_TINT = SCATTER.clone().multiplyScalar(0.24);
const FOAM_COLOR = new THREE.Vector3(0.76, 0.75, 0.70);
/** Horizon haze is pulled toward rust/ochre; the Inner Sea sits under sulphur. */
const HORIZON_TINT = new THREE.Vector3(1.38, 0.94, 0.70);
/** Hemispheric irradiance to average radiance, matching the aerial chunk. */
const INV_PI = 1 / Math.PI;

/**
 * Angular RADIUS of the key light, in radians — the floor on how tight the
 * glitter lobe can be, since a source of finite size spreads the set of facet
 * slopes that can reflect it into the eye.
 *
 * The atmosphere publishes one key direction and colour and does not say which
 * body it belongs to, so the two cases are told apart by the only thing that
 * separates them by two orders of magnitude: the irradiance itself. The blend is
 * smooth, which matters because the sky hands the key over from sun to moon
 * during dusk and a step here would snap the width of the glitter path.
 */
const SUN_ANG_RADIUS = 0.00465;
/** Masser and Secunda are drawn several degrees across — nothing like our Moon. */
const MOON_ANG_RADIUS = 0.030;

export class WaterSystem implements System {
  readonly id = 'water';
  readonly order = 10;

  /** Sea level. Everything in this subsystem is measured from it. */
  readonly level = 0;

  private waves = new WaveBank();
  private cfg: WaveConfig = { windAngle: 0.7, windSpeed: 10, choppiness: 0.7, gain: 1 };
  private targetCfg: WaveConfig = { ...this.cfg };

  private textures: WaterTextures | null = null;
  private heightTex: THREE.DataTexture | null = null;
  private heights: Float32Array | null = null;
  private extent = 2048;

  private mesh: THREE.Mesh | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private targets: WaterTargets | null = null;
  private composite: WaterComposite | null = null;

  private shared: Record<string, THREE.IUniform> = {};
  private surfaceUniforms: Record<string, THREE.IUniform> = {};

  private terrain: ITerrain | undefined;
  private sky: IAtmosphere | undefined;
  private skyHull: THREE.Object3D | null = null;
  private hiddenRefl: THREE.Object3D[] = [];
  private hiddenRefr: THREE.Object3D[] = [];
  private offWeather: (() => void) | null = null;

  private submerged = 0;
  private wasUnder = false;
  private visible = true;
  private shoreNear = true;
  private shallowNear = true;
  private compositeNeeded = false;
  private dbSize = new THREE.Vector2();
  private scratch = new THREE.Vector3();
  private camPos = new THREE.Vector3();

  /** True while the eye is below the displaced surface. */
  get isSubmerged(): boolean {
    return this.submerged > 0.5;
  }

  async init(ctx: Ctx): Promise<void> {
    this.terrain = ctx.get<ITerrain>('terrain');
    this.sky = ctx.get<IAtmosphere>('sky');

    const maxAniso = ctx.renderer.capabilities.getMaxAnisotropy();
    const aniso = Math.max(1, Math.min(8, maxAniso));
    this.textures = await synthWaterTextures(aniso);
    await this.bakeHeightfield();

    const aerial = bindAerial(AERIAL_GLSL);
    if (!aerial.foreign) {
      console.warn('[water] no aerial-perspective entry point found in the sky chunk; using local haze');
    }

    this.shared = {
      wTime: { value: 0 },
      wWaveA: { value: this.waves.a },
      wWaveB: { value: this.waves.b },
      wHeightTex: { value: this.heightTex },
      wHeightXform: { value: new THREE.Vector2(1 / (2 * this.extent), this.extent) },
      wSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.7).normalize() },
      wSunColor: { value: new THREE.Vector3(2.6, 1.9, 1.4) },
      wAmbient: { value: new THREE.Vector3(0.10, 0.11, 0.14) },
      wWindDir: { value: new THREE.Vector2(1, 0) },
      wWindSpeed: { value: 10 },
      wSunAbove: { value: 1 },
      wKeyAngle: { value: SUN_ANG_RADIUS },
      wWetness: { value: 0 },
      wExtinction: { value: EXTINCTION.clone() },
      wScatter: { value: SCATTER.clone() },
      wFoam: { value: this.textures.foam },
      wFoamColor: { value: FOAM_COLOR.clone() },
    };

    ctx.renderer.getDrawingBufferSize(this.dbSize);
    this.targets = new WaterTargets(this.dbSize.x, this.dbSize.y);

    this.surfaceUniforms = {
      ...this.shared,
      wDetail: { value: this.textures.detail },
      wAniso: { value: aniso },
      wReflTex: { value: this.targets.reflection.texture },
      wReflVP: { value: this.targets.reflectionVP },
      wReflValid: { value: 0 },
      wReflPix: { value: 1 },
      wRefrTex: { value: this.targets.refraction.texture },
      wRefrDepth: { value: this.targets.refraction.depthTexture },
      wRefrVP: { value: this.targets.refractionVP },
      wRefrNearFar: { value: this.targets.refractionNearFar },
      wRefrValid: { value: 0 },
      wDeepTint: { value: DEEP_TINT.clone() },
      wFoamAmount: { value: 1 },
      wZenith: { value: new THREE.Vector3(0.05, 0.07, 0.12) },
      wHorizon: { value: new THREE.Vector3(0.30, 0.20, 0.14) },
      wAerialTint: { value: new THREE.Vector3(0.30, 0.20, 0.14) },
      wAerialDensity: { value: 0.00042 },
    };
    this.mergeAerialUniforms();

    this.geometry = buildDiscGeometry();
    this.material = buildSurfaceMaterial(this.surfaceUniforms, aerial);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = 'inner-sea';
    ctx.scene.add(this.mesh);

    this.composite = new WaterComposite(this.shared, this.dbSize.x, this.dbSize.y);
    this.composite.uniforms.wDepth.value = this.targets.refraction.depthTexture;

    this.offWeather = ctx.bus.on<WeatherState>('weather', (w) => this.applyWeather(w));
    if (this.sky) this.applyWeather(this.sky.weather);
  }

  /**
   * Shares the atmosphere's own uniform objects by reference so the sky system
   * keeps driving them; only names the water pass does not already own are
   * taken, which keeps the two GLSL namespaces from colliding.
   */
  private mergeAerialUniforms(): void {
    const src = aerialUniforms as unknown;
    const foreign: unknown = typeof src === 'function' ? (src as () => unknown)() : src;
    if (typeof foreign !== 'object' || foreign === null) return;
    for (const [k, v] of Object.entries(foreign as Record<string, unknown>)) {
      if (k in this.surfaceUniforms) continue;
      if (typeof v === 'object' && v !== null && 'value' in v) {
        this.surfaceUniforms[k] = v as THREE.IUniform;
      }
    }
  }

  private async bakeHeightfield(): Promise<void> {
    const t = this.terrain;
    this.extent = t ? t.extent : 2048;
    const N = HEIGHT_RES;
    const heights = new Float32Array(N * N);
    const data = new Uint16Array(N * N);
    const step = (2 * this.extent) / N;

    if (t && !t.ready) console.warn('[water] terrain reported not ready at bake time');

    for (let j = 0; j < N; j++) {
      const z = -this.extent + (j + 0.5) * step;
      for (let i = 0; i < N; i++) {
        const x = -this.extent + (i + 0.5) * step;
        const h = t ? t.heightAt(x, z) : -40;
        heights[j * N + i] = h;
        // Half-float keeps the bake at 1.1 MB; clamping to +-2 km holds the
        // quantisation near sea level under 3 cm, which is where it matters.
        data[j * N + i] = THREE.DataUtils.toHalfFloat(Math.min(2048, Math.max(-2048, h)));
      }
      if ((j & 31) === 31) await new Promise<void>((r) => setTimeout(r, 0));
    }

    this.heights = heights;
    const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.HalfFloatType);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    this.heightTex = tex;
  }

  /** Bilinear read of the baked bed, matching what the shaders see. */
  private bedAt(x: number, z: number): number {
    const h = this.heights;
    if (!h) return -40;
    const N = HEIGHT_RES;
    const u = ((x / (2 * this.extent)) + 0.5) * N - 0.5;
    const v = ((z / (2 * this.extent)) + 0.5) * N - 0.5;
    const i0 = Math.min(N - 1, Math.max(0, Math.floor(u)));
    const j0 = Math.min(N - 1, Math.max(0, Math.floor(v)));
    const i1 = Math.min(N - 1, i0 + 1);
    const j1 = Math.min(N - 1, j0 + 1);
    const fu = Math.min(1, Math.max(0, u - i0));
    const fv = Math.min(1, Math.max(0, v - j0));
    const a = h[j0 * N + i0];
    const b = h[j0 * N + i1];
    const c = h[j1 * N + i0];
    const d = h[j1 * N + i1];
    return (a + (b - a) * fu) + ((c + (d - c) * fu) - (a + (b - a) * fu)) * fv;
  }

  /** Instantaneous surface height at a world XZ. Public for buoyancy/swimming. */
  heightAt(x: number, z: number, elapsed: number): number {
    const still = -this.bedAt(x, z);
    // Must match the shoaling curve in WaterSurface's vertex shader exactly, or
    // buoyancy and camera submersion drift away from the drawn surface.
    const d = Math.min(1, Math.max(0, still / 1.6));
    const s = d * d * (3 - 2 * d) * (1 + 0.35 * Math.exp(-Math.abs(still - 3) * 0.55));
    return this.waves.heightAt(x, z, elapsed, s);
  }

  private applyWeather(w: WeatherState): void {
    const speed = Math.max(1.5, w.windSpeed);
    this.targetCfg.windAngle = Math.atan2(w.windDir.y, w.windDir.x);
    this.targetCfg.windSpeed = speed;
    this.targetCfg.choppiness = 0.55 + 0.35 * Math.min(1, speed / 16);
    // Storms and ashfall both whip the Inner Sea up; blight adds a heavy swell.
    this.targetCfg.gain =
      w.kind === 'thunder' ? 1.55 : w.kind === 'ashstorm' || w.kind === 'blight' ? 1.35 : w.kind === 'rain' ? 1.15 : 1.0;
    this.shared.wWetness.value = w.wetness;
  }

  /**
   * Finds the atmosphere's camera-pinned sky hull, so the planar reflection can
   * be rendered without it.
   *
   * The hull is a small closed shell (ten metres) parented to the MAIN camera
   * and drawn last. The mirror eye sits two camera-heights below it, so for any
   * viewer more than five metres above the sea it is OUTSIDE that shell — and a
   * shell seen from outside is not a sky, it is a sphere subtending a cone. The
   * reflection target therefore came back with a disc of sky in the middle and
   * nothing around it, and the shader composited that disc over the analytic sky
   * integral. The two do not agree (the hull also carries the cloud march, the
   * integral does not), so the join drew a hard-edged ellipse across the near
   * water with a mirror-sharp, streaked interior — the "blocky, quantized
   * light/dark rectangles" along the waterline and the hard wedge across the
   * near sea. Nothing in the mirror pass is a correct sky for a plane at y=0;
   * only the geometry in it is worth having, and the analytic integral — which
   * is the atmosphere's own, run along the reflected ray — is strictly better
   * for the rest. Dropping the hull also takes the cloud raymarch out of a
   * half-resolution full-screen pass that runs every other frame, which is where
   * the extra detail octave's cost comes back from.
   *
   * Identified structurally rather than by name: the sky subsystem contracts
   * only its interface, not its scene graph. If nothing matches, the pass simply
   * behaves as it did before.
   */
  private findSkyHull(scene: THREE.Scene): THREE.Object3D | null {
    let found: THREE.Object3D | null = null;
    let bestOrder = -Infinity;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.type !== 'Mesh' || !m.geometry) return;
      // Drawn after the world, and small enough that it can only be pinned to
      // the eye — real scenery at this size never sorts last.
      if (m.renderOrder < 500 || m.frustumCulled) return;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const r = m.geometry.boundingSphere?.radius ?? 0;
      if (r <= 0 || r > 64) return;
      if (m.renderOrder > bestOrder) {
        bestOrder = m.renderOrder;
        found = o;
      }
    });
    return found;
  }

  private seaInView(camera: THREE.PerspectiveCamera): boolean {
    if (this.camPos.y <= 1.0) return true;
    if (this.camPos.y > 1400) return false;
    const corners: [number, number][] = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    for (const [cx, cy] of corners) {
      this.scratch.set(cx, cy, 0.5).unproject(camera);
      if (this.scratch.y - this.camPos.y < 0) return true;
    }
    return false;
  }

  /**
   * Coarse scan of the baked bed around the viewer. Out in open water there is
   * no shoreline to draw and nothing shallow enough for refraction to survive
   * Beer-Lambert, so both the half-res scene pass and the full-screen composite
   * can be dropped entirely. 32 bilinear taps, once every eight frames.
   */
  private updateProximity(): void {
    let shore = false;
    let shallow = false;
    // The radii reach out to the beach pass's own far plane rather than to the
    // couple of hundred metres a swimmer cares about: what these gate is whether
    // a shoreline is on SCREEN, and a coast shot frames one four hundred metres
    // out as a matter of course. Scanning only to 260 m switched the wet sand and
    // the swash line off for exactly the shots that exist to show them.
    for (const r of [30, 90, 170, 260, 420, 660, 950]) {
      for (let a = 0; a < 8; a++) {
        const th = (a / 8) * Math.PI * 2;
        const b = this.bedAt(this.camPos.x + Math.cos(th) * r, this.camPos.z + Math.sin(th) * r);
        if (b > -6 && b < 6) shore = true;
        if (b > -26) shallow = true;
      }
    }
    const here = this.bedAt(this.camPos.x, this.camPos.z);
    this.shoreNear = shore || Math.abs(here) < 6;
    this.shallowNear = shallow || here > -26;
  }

  update(ctx: Ctx): void {
    const mat = this.material;
    const targets = this.targets;
    const mesh = this.mesh;
    const composite = this.composite;
    if (!mat || !targets || !mesh || !composite) return;

    const t = ctx.time.elapsed;
    const dt = ctx.time.dt;

    // Ease the spectrum toward the weather rather than snapping; the bank is
    // rebuilt from a fixed seed so a continuous config gives a continuous sea.
    const k = 1 - Math.exp(-dt * 0.35);
    let dAng = this.targetCfg.windAngle - this.cfg.windAngle;
    dAng = Math.atan2(Math.sin(dAng), Math.cos(dAng));
    this.cfg.windAngle += dAng * k;
    this.cfg.windSpeed += (this.targetCfg.windSpeed - this.cfg.windSpeed) * k;
    this.cfg.choppiness += (this.targetCfg.choppiness - this.cfg.choppiness) * k;
    this.cfg.gain += (this.targetCfg.gain - this.cfg.gain) * k;
    this.waves.build(0x5eab00d, this.cfg);
    this.waves.update(t);

    this.shared.wTime.value = t;
    (this.shared.wWindDir.value as THREE.Vector2).set(Math.cos(this.cfg.windAngle), Math.sin(this.cfg.windAngle));
    this.shared.wWindSpeed.value = this.cfg.windSpeed;
    // Whitecap coverage is derived from the *eased* spectrum rather than set
    // from the weather event, so foam grows in with the swell that produces it
    // instead of snapping the instant the front arrives.
    this.surfaceUniforms.wFoamAmount.value = Math.min(
      1.6,
      0.55 + 0.75 * Math.min(1, this.cfg.windSpeed / 15) + 0.5 * (this.cfg.gain - 1),
    );
    this.syncLighting();

    this.camPos.setFromMatrixPosition(ctx.camera.matrixWorld);

    // Snap the disc so the tessellation does not crawl under the wave field.
    mesh.position.set(Math.round(this.camPos.x * 2) / 2, 0, Math.round(this.camPos.z * 2) / 2);
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);

    const surfaceY = this.heightAt(this.camPos.x, this.camPos.z, t);
    const below = surfaceY - this.camPos.y;
    const target = Math.min(1, Math.max(0, (below + 0.12) / 0.24));
    this.submerged += (target - this.submerged) * Math.min(1, dt * 14);
    composite.uniforms.wSubmerged.value = this.submerged;

    const nowUnder = this.submerged > 0.5;
    if (nowUnder !== this.wasUnder) {
      this.wasUnder = nowUnder;
      // Audio is somebody else's subsystem; publish the state and the amount of
      // low-pass they should apply, and let them own the filter.
      ctx.bus.emit('water:submerged', { submerged: nowUnder, depth: Math.max(0, -this.camPos.y) });
      ctx.bus.emit('audio:muffle', { amount: nowUnder ? 1 : 0, source: 'water' });
    }

    this.visible = this.seaInView(ctx.camera);
    mesh.visible = this.visible;
    if (!this.visible) {
      this.surfaceUniforms.wReflValid.value = 0;
      this.surfaceUniforms.wRefrValid.value = 0;
      this.compositeNeeded = false;
      return;
    }

    if (ctx.time.frame % 8 === 0) this.updateProximity();
    const wantRefraction = this.shallowNear || this.submerged > 0.001;

    // The sky subsystem builds its hull in its own init, which may land after
    // ours; resolve it lazily and cache.
    if (!this.skyHull) {
      this.skyHull = this.findSkyHull(ctx.scene);
      this.hiddenRefr = [mesh];
      this.hiddenRefl = this.skyHull ? [mesh, this.skyHull] : [mesh];
    }
    const prevAutoClear = ctx.renderer.autoClear;
    const prevShadowAuto = ctx.renderer.shadowMap.autoUpdate;
    // Shadow maps are shared and already resolved for this frame's sun; the
    // side passes must not pay to rebuild them.
    ctx.renderer.shadowMap.autoUpdate = false;
    ctx.renderer.autoClear = true;

    if (wantRefraction) {
      targets.renderRefraction(ctx.renderer, ctx.scene, ctx.camera, this.hiddenRefr);
    }
    // Gate on what the target actually holds, not on what we asked for: if the
    // pass is ever skipped the shader must fall back to the deep tint rather
    // than sample a stale frame registered to an old view matrix.
    this.surfaceUniforms.wRefrValid.value = wantRefraction ? targets.refractionValid : 0;

    if (this.submerged < 0.6 && ctx.time.frame % REFLECTION_INTERVAL === 0) {
      targets.renderReflection(ctx.renderer, ctx.scene, ctx.camera, this.hiddenRefl);
    }
    this.surfaceUniforms.wReflValid.value = this.submerged < 0.6 ? targets.reflectionValid : 0;
    this.surfaceUniforms.wReflPix.value = targets.reflectionPixPerRad;

    ctx.renderer.autoClear = prevAutoClear;
    ctx.renderer.shadowMap.autoUpdate = prevShadowAuto;

    (composite.uniforms.wNearFar.value as THREE.Vector2).copy(targets.refractionNearFar);
    composite.uniforms.wShoreFade.value = this.shoreNear && wantRefraction ? 1 : 0;
    this.compositeNeeded = wantRefraction && (this.shoreNear || this.submerged > 0.001);
  }

  private syncLighting(): void {
    const sky = this.sky;
    const sunDir = this.shared.wSunDir.value as THREE.Vector3;
    const sunCol = this.shared.wSunColor.value as THREE.Vector3;
    const amb = this.shared.wAmbient.value as THREE.Vector3;

    if (sky) {
      const w = sky.weather;
      sunDir.copy(w.sunDir).normalize();
      if (sunDir.lengthSq() < 1e-6) sunDir.copy(sky.sun.position).normalize();
      // weather.sunColor already carries the light's intensity — do not scale.
      sunCol.set(w.sunColor.r, w.sunColor.g, w.sunColor.b);
      amb.set(w.ambient.r, w.ambient.g, w.ambient.b);
      this.surfaceUniforms.wAerialDensity.value = Math.max(1e-5, w.fogDensity || 0.00042);
    }

    const above = Math.min(1, Math.max(0, (sunDir.y + 0.05) / 0.17));
    this.shared.wSunAbove.value = above;

    const keyLum = 0.2126 * sunCol.x + 0.7152 * sunCol.y + 0.0722 * sunCol.z;
    const isSun = Math.min(1, Math.max(0, (keyLum - 0.18) / 0.37));
    const s = isSun * isSun * (3 - 2 * isSun);
    this.shared.wKeyAngle.value = MOON_ANG_RADIUS + (SUN_ANG_RADIUS - MOON_ANG_RADIUS) * s;

    // Sky RADIANCE for the analytic reflection fallback. The atmosphere
    // publishes `ambient` as hemispheric sky IRRADIANCE — its own aerial chunk
    // divides by pi to get a source radiance — so anything that treats the same
    // number as a radiance runs a factor of pi hot. This did, by 7x, and every
    // reflection tap that fell outside the planar target came back that much
    // brighter than the one next to it: a hard vertical seam down both sides of
    // the sea, and at night a pale band where the water should be near black.
    const zen = this.surfaceUniforms.wZenith.value as THREE.Vector3;
    const hor = this.surfaceUniforms.wHorizon.value as THREE.Vector3;
    const tint = this.surfaceUniforms.wAerialTint.value as THREE.Vector3;
    zen.copy(amb).multiplyScalar(INV_PI * 0.85);
    hor.copy(amb).multiplyScalar(INV_PI * 2.2).multiply(HORIZON_TINT);
    // The local haze fallback is a *fogged* colour rather than a sky radiance,
    // and is only ever used when the atmosphere exports no aerial entry point.
    tint.copy(amb).multiplyScalar(3.2).multiply(HORIZON_TINT);
  }

  lateUpdate(ctx: Ctx): void {
    const composite = this.composite;
    const targets = this.targets;
    if (!composite || !targets) return;
    if (!this.compositeNeeded) return;
    composite.run(ctx.renderer, ctx.camera, targets.refractionVP);
  }

  resize(ctx: Ctx): void {
    ctx.renderer.getDrawingBufferSize(this.dbSize);
    this.targets?.resize(this.dbSize.x, this.dbSize.y);
    this.composite?.resize(this.dbSize.x, this.dbSize.y);
    if (this.targets && this.composite) {
      this.composite.uniforms.wDepth.value = this.targets.refraction.depthTexture;
      this.surfaceUniforms.wRefrTex.value = this.targets.refraction.texture;
      this.surfaceUniforms.wRefrDepth.value = this.targets.refraction.depthTexture;
      this.surfaceUniforms.wReflTex.value = this.targets.reflection.texture;
    }
  }

  dispose(): void {
    this.offWeather?.();
    this.offWeather = null;
    this.mesh?.removeFromParent();
    this.geometry?.dispose();
    this.material?.dispose();
    this.textures?.dispose();
    this.heightTex?.dispose();
    this.targets?.dispose();
    this.composite?.dispose();
    this.mesh = null;
    this.geometry = null;
    this.material = null;
    this.textures = null;
    this.heightTex = null;
    this.targets = null;
    this.composite = null;
    this.heights = null;
  }

  /** Triangles the sea surface costs, for the render budget readout. */
  static get surfaceTriangles(): number {
    return DISC_TRIANGLES;
  }

  static get waveCount(): number {
    return WAVE_COUNT;
  }
}
