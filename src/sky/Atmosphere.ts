import * as THREE from 'three';
import type { Ctx, WeatherState } from '../core/types';
import type { IAtmosphere } from '../core/contracts';
import { aerialUniforms } from './Aerial';
import {
  BETA_ASH,
  BETA_MIE_E,
  BETA_MIE_S,
  BETA_RAYLEIGH,
  CIRRUS_H,
  CLOUD_ALBEDO,
  H_ASH,
  H_MIE,
  H_RAYLEIGH,
  LATITUDE,
  MIE_G,
  PLANET_R,
  SUN_E,
  blackbodyLinear,
  transmittance,
} from './Constants';
import { ShadowCascades } from './Cascades';
import { buildCloudVolume, buildWeatherMap } from './Noise';
import { SkyParticles } from './Particles';
import { CloudPass, SkyViewPass, buildTransmittanceLUT, createSkyMaterial } from './SkyShader';
import { makeEphemeris, sunCCT, sunShading, updateEphemeris, type SunShading } from './Solar';
import { PRESETS, WEATHER_NOTICE, WeatherMachine } from './Weather';
import { WindAudio } from './WindAudio';

export { AERIAL_GLSL, aerialUniforms } from './Aerial';
export type { SkyParams } from './Weather';

/**
 * Airglow floor. What is left when the sun and both moons are down.
 *
 * The day and twilight anchors that used to sit beside this — AMB_DAY
 * (0.26, 0.40, 0.72) and AMB_TWILIGHT (0.62, 0.30, 0.14), on a smoothstep of
 * the solar altitude — are gone. They were an authored guess at a quantity the
 * build already computes exactly: the dome's own scattering integral, which is
 * rendered every frame into the sky-view table for the fog to converge on. The
 * ambient is now that integral, cosine-weighted over the hemisphere (see
 * SkyViewPass.readIrradiance).
 *
 * The guess was wrong in both directions at once, which is why replacing it
 * matters rather than being tidiness. Measured against the table at 09:00 clear:
 * from a sea-level eye the true sky irradiance is (1.21, 1.04, 1.04) and the
 * anchor claimed (0.096, 0.139, 0.262) — an eighth of the magnitude and a
 * strongly blue chroma where the honest answer is nearly neutral, because a low
 * observer on Ashenreach is looking through the whole ash boundary layer in
 * every direction but straight up. From the ridge at 1320 m, above most of that
 * layer, the true answer IS blue — (0.64, 0.74, 1.01), hue 223 — and the anchor
 * gave the same fixed chroma at both, so the one vantage in the game with a
 * genuinely cool sky over it got no benefit from it.
 *
 * An eighth of the magnitude is the part with teeth. Everything that models a
 * MEDIUM — the dome's own particulate layer, the cloud deck's ambient, the
 * shared aerial-perspective chunk — is lit by this number and by the sun. At an
 * eighth strength the sky contributes ~2% of what lights the air, so the air
 * could only ever carry the SUN's chroma, and the air is what distant terrain,
 * the horizon band and the high veil all converge on. That is the mechanism
 * behind "every hue family on screen is manufactured in the colour cube": there
 * was one illuminant in the frame because the second one had been scaled down
 * until it did not matter.
 */
const AMB_NIGHT = new THREE.Color(0.013, 0.017, 0.048);
const MOON_TINT_MASSER = new THREE.Color(0.52, 0.40, 0.40);
const MOON_TINT_SECUNDA = new THREE.Color(0.52, 0.60, 0.86);
/**
 * Ambient moonlight is not the colour of the moon. Almost none of it arrives
 * along the moon's own vector — it arrives after Rayleigh scattering through the
 * whole dome, which is exactly the process that makes a moonlit night read blue
 * to a dark-adapted eye. Tinting the ambient with Masser's red-ochre albedo,
 * which is what used to happen, made every shadowed surface in the world khaki
 * and left the frame one hue from ash to water to sky. The DIRECT term keeps the
 * moon's own colour — that contrast, cool fill against a warm key, is the look.
 */
const MOON_AMB_TINT = new THREE.Color(0.26, 0.38, 0.82);

/**
 * Chroma of the moonlight that the atmospheric column SCATTERS, as opposed to
 * the chroma of the key light it delivers to surfaces.
 *
 * These are not the same quantity and conflating them is what made Masser read
 * as Earth's Moon. The aureole around a moon is single-scattered moonlight, and
 * measured off the night frame it was the brightest thing at the disc's own
 * pixels — worth (0.10, 0.065, 0.043) against a disc of (0.15, 0.021, 0.006).
 * Driving it from MOON_TINT_MASSER, which is deliberately desaturated so that
 * the world's shadowed surfaces do not all go khaki, laid a near-neutral wash
 * over the one object in the sky whose whole job is to be red: the disc left the
 * shader at 88/17/6 and arrived on screen at 236/185/151, i.e. cream.
 *
 * Light leaving Masser has Masser's spectrum, so the scattering term gets
 * Masser's spectrum. Luminance is matched to MOON_TINT_MASSER (0.41 against
 * 0.43) so the change is chroma only and the night sky's brightness is
 * unaffected. Secunda's stays as it is — a pale body really does scatter a
 * near-neutral aureole, and its slight blue is the cool half of the night's
 * warm/cool split.
 */
const MOON_GLOW_MASSER = new THREE.Color(0.86, 0.30, 0.20);

/**
 * Masser's spectrum as a KEY LIGHT on the cloud deck and the particulate layer —
 * a third quantity again, and the one that decides whether midnight reads as
 * midnight.
 *
 * MOON_GLOW_MASSER is right for the aureole, which is a few degrees of sky
 * immediately around the disc and belongs to the disc. It is badly wrong as the
 * light source for a cloud deck that fills half the frame: at 0.86/0.30/0.20 the
 * deck is lit by a 4.3:1 red-to-blue key, so 23:24 came out carrying a full warm
 * ochre band across the whole horizon (measured row-mean 98/81/69 at y=400) and
 * the entire upper hemisphere read tan. That is a thirty-minutes-after-sunset
 * sky presented as midnight, and it is the single largest art-direction miss the
 * night frame can make.
 *
 * Reflected sunlight off an ochre regolith is warm, but it is nowhere near that
 * saturated once it has been through a cloud's own multiple scattering, and the
 * eye seeing it is scotopic anyway. Luminance is matched to MOON_GLOW_MASSER
 * (0.425 against 0.412) so the deck's brightness does not move — this is a
 * chroma correction, not a dimmer.
 */
const MOON_KEY_MASSER = new THREE.Color(0.55, 0.40, 0.31);

/** Peak direct-sun irradiance multiplier. Albedo-0.5 ground lands near 0.5. */
const SUN_PEAK = 3.4;
/**
 * How much moonlight the atmospheric COLUMN scatters, in sun-equivalent units.
 *
 * Re-tuned down from 0.085 when the ash aerosol went up an order of magnitude:
 * the same moonlight now scatters far more strongly on the way down, so at the
 * old value a gibbous Masser lit the whole dome to a legible sepia and 23:24
 * read as heavy dusk rather than as night.
 */
const MOON_SKY = 0.045;

/**
 * How much moonlight reaches SURFACES, as a fraction of the peak sun.
 *
 * Deliberately a different number from MOON_SKY, because the two quantities were
 * fighting each other. The review's finding was blunt: "two large moons are in
 * frame and neither casts a single photon on the world" — no rim on the dead
 * tree, no directional shading on either hill mass, no lit side on the boulders,
 * the whole lower half carried by a flat directionless ambient. Measured off that
 * frame the ground sat at 18-22/255 against a sky of 76-104, i.e. the key light
 * was a tenth of what the sky it hangs under was already delivering.
 *
 * It could not simply be raised, because ONE constant drove both the surface key
 * and the dome's second scattering source: every step up on the tree's rim light
 * was also a step up on the night sky's brightness, and the sky was already too
 * bright. Splitting them is the fix, not a bigger number — the sky keeps the
 * value it was tuned to and the world gets a key light four times stronger, which
 * is what puts a lit side and a cast shadow on everything below the horizon.
 *
 * (Reality is ~1/400000 of sunlight. Both of these are the playable lie; the
 * point is that they are allowed to be different lies.)
 */
const MOON_PEAK = 0.19;

/**
 * Fraction of the measured sky irradiance published as the ambient.
 *
 * The measurement is not a guess and this is not a tint — it is a units
 * calibration, and it has exactly one job: to stop a physics fix from
 * re-exposing the whole game in one step.
 *
 * The anchor this replaced was an eighth of the physical number, and the entire
 * exposure ladder grew up around that: SUN_PEAK, the haze layer's 0.50/pi
 * coefficient, the auto-exposure target, every preset's ambMul, and the
 * material system's REF_AMB_LUMA. Publishing the physical value outright
 * measures well on hue and badly on range — the gate's dawn vantage went from
 * p1 = 21 to p1 = 31 and lost half a stop of dynamic range, because a fill that
 * strong has nowhere left to put a black. That is a real regression and it is
 * not worth trading for.
 *
 * 0.50 is where the fill is three and a half times the old anchor — enough that
 * the sky is a first-order contributor to what lights both surfaces and the air,
 * which is the whole point — and the frame's black point is back where the
 * build was exposed for. Raising it further is a deliberate re-exposure of the
 * game and belongs in a round that re-baselines, not in this one.
 */
const SKY_FILL = 0.50;

/**
 * Headroom over the deck's diffuse energy limit, as a multiple of it.
 *
 * 1.0 is the hard physical ceiling for a conservative scatterer lit by a
 * collimated beam — it cannot hand back more radiance than E_perp * mu0 *
 * albedo / pi in any direction once the light has been isotropised. A thin
 * SUNWARD EDGE genuinely does exceed it, because that light has scattered once
 * and is still travelling forward, and that excess is the silver lining. Two is
 * where the lining is still several times the deck's own body and an order of
 * magnitude over the sky beside it, and where the brightest cloud pixel in any
 * canonical frame lands under the tonemapper's shoulder rather than on it.
 */
const DECK_KEY_HEADROOM = 2.0;

export class AtmosphereSystem implements IAtmosphere {
  readonly id = 'sky';
  readonly order = -50;

  /**
   * Cascaded sun shadows. Declared before `sun` on purpose: `sun` *is* the
   * first cascade's light, so every existing consumer of `sky.sun` — the
   * pipeline's volumetrics, the water, anything reading a direction or a
   * colour off it — keeps working unchanged while the shadow behind it becomes
   * four fitted cascades instead of one 320 m box.
   */
  readonly csm = new ShadowCascades();

  readonly sun: THREE.DirectionalLight = this.csm.key;

  readonly weather: WeatherState = {
    kind: 'clear',
    blend: 1,
    windDir: new THREE.Vector2(1, 0),
    windSpeed: 4,
    wetness: 0,
    sunColor: new THREE.Color(1, 1, 1),
    sunDir: new THREE.Vector3(0, 1, 0),
    ambient: new THREE.Color(0.1, 0.12, 0.18),
    fogDensity: 5e-5,
  };

  private machine = new WeatherMachine();
  private eph = makeEphemeris();
  private shading: SunShading = { color: new THREE.Color(1, 1, 1), luminance: 1 };

  private dome: THREE.Mesh | null = null;
  private skyMat: THREE.ShaderMaterial | null = null;
  private lut: THREE.DataTexture | null = null;
  private cloudTex: THREE.Data3DTexture | null = null;
  private weatherTex: THREE.DataTexture | null = null;
  private cloudPass: CloudPass | null = null;
  private skyView: SkyViewPass | null = null;
  private particles: SkyParticles | null = null;
  private audio: WindAudio | null = null;

  private envScene = new THREE.Scene();
  private cubeRT: THREE.WebGLCubeRenderTarget | null = null;
  private cubeCam: THREE.CubeCamera | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  /**
   * The sky state the current IBL was baked for.
   *
   * The capture used to be gated on the CLOCK alone — "re-bake if the in-world
   * hour has moved by 2 minutes" — and the dome is not a function of the clock.
   * It is a function of the sun vector, the eye's altitude and the weather, and
   * two of those three can change without the hour moving at all.
   *
   * Altitude is the one that mattered. Measured by integrating the cube itself:
   * on the ridge vantage at 1320 m and the vale vantage at sea level, at the
   * same frozen 09:00, the environment was bit-for-bit THE SAME cube —
   * (1.80, 1.46, 1.24), hue 24 — while the dome those two eyes actually see
   * integrates to (0.64, 0.74, 1.01) hue 223 and (1.21, 1.04, 1.04) hue 2
   * respectively. So the one vantage in the game that sits above the ash
   * boundary layer, and therefore has a genuinely blue sky over it, was lighting
   * its terrain with a stale ochre dome captured from somewhere else entirely.
   * That is most of the reason shadowed surfaces carried the key's hue.
   */
  private envSunDir = new THREE.Vector3(NaN, NaN, NaN);
  private envCamY = Number.NaN;
  private envHaze = Number.NaN;
  private envCover = Number.NaN;
  private envMie = Number.NaN;
  /** Real seconds since the last bake; floors the rate when everything moves. */
  private envAge = 1e9;
  /**
   * Cosine-weighted hemispheric irradiance of the dome, measured off the
   * sky-view table at the bake cadence. Seeded with the old authored day anchor
   * so the very first frame, before any bake has run, is not black.
   */
  private skyIrr = new THREE.Color(0.26, 0.40, 0.72);
  private groundIrr = new THREE.Color(0.1, 0.09, 0.07);

  private cloudWind = new THREE.Vector2();
  private hazeWind = new THREE.Vector2();
  private emitAcc = 0;
  private offQuality: (() => void) | null = null;

  private tmpV = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();
  private focus = new THREE.Vector3();
  private cloudSun = new THREE.Color();
  private cirrusSun = new THREE.Color();
  private hazeCol = new THREE.Color();
  private hazeDeepCol = new THREE.Color();
  private tmpCol = new THREE.Color();
  private mediaCol = new THREE.Color();
  private bb: [number, number, number] = [0, 0, 0];
  private starFrame = new THREE.Matrix3();
  private starRot = new THREE.Matrix4();
  private pole = new THREE.Vector3(0, Math.sin(LATITUDE), -Math.cos(LATITUDE));

  async init(ctx: Ctx): Promise<void> {
    this.lut = buildTransmittanceLUT();
    this.cloudTex = buildCloudVolume();
    this.weatherTex = buildWeatherMap();

    this.skyMat = createSkyMaterial(this.lut, this.cloudTex, this.weatherTex);
    this.cloudPass = new CloudPass(this.skyMat.uniforms);
    // Shares the dome's uniform objects, so it is the same function of the same
    // state by construction — which is the whole point of it.
    this.skyView = new SkyViewPass(this.skyMat.uniforms);
    aerialUniforms().uAerialSkyView.value = this.skyView.texture;
    // Direction is exact at any tessellation — the camera sits at the centre,
    // so a coarse hull costs nothing in accuracy.
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), this.skyMat);
    this.dome.frustumCulled = false;
    // Opaque queue, drawn last: covered pixels are killed by early-z before the
    // cloud march ever runs.
    this.dome.renderOrder = 1000;
    ctx.scene.add(this.dome);

    // Cascades own their own frusta, biases and filter radii; everything the
    // old single-box setup hard-coded here is now derived per cascade, per
    // frame, from the view frustum it actually has to cover.
    this.csm.attach(ctx.scene);

    this.particles = new SkyParticles();
    ctx.scene.add(this.particles.group);

    this.audio = new WindAudio();

    // 128, not 64. This cube is now the scene's only environment (see
    // captureEnv), so it carries the specular response of every dielectric and
    // every piece of metal in the world as well as the diffuse irradiance. 64
    // was ample for the second and visibly mushy for the first.
    this.cubeRT = new THREE.WebGLCubeRenderTarget(128, {
      type: THREE.HalfFloatType,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.cubeCam = new THREE.CubeCamera(1, 2.0e6, this.cubeRT);
    this.pmrem = new THREE.PMREMGenerator(ctx.renderer);
    this.pmrem.compileCubemapShader();

    this.offQuality = ctx.bus.on<{ tier: 'low' | 'medium' | 'high' | 'ultra' }>('quality', (q) =>
      this.setQuality(q?.tier ?? 'high'),
    );

    // Scattering coefficients are physical constants; consumers of the aerial
    // block only need them uploaded once.
    const A = aerialUniforms();
    (A.uAerialBetaR.value as THREE.Vector3).set(BETA_RAYLEIGH[0], BETA_RAYLEIGH[1], BETA_RAYLEIGH[2]);
    (A.uAerialBetaMS.value as THREE.Vector3).set(BETA_MIE_S[0], BETA_MIE_S[1], BETA_MIE_S[2]);
    (A.uAerialBetaME.value as THREE.Vector3).set(BETA_MIE_E[0], BETA_MIE_E[1], BETA_MIE_E[2]);
    (A.uAerialBetaA.value as THREE.Vector3).set(BETA_ASH[0], BETA_ASH[1], BETA_ASH[2]);
    (A.uAerialScaleH.value as THREE.Vector3).set(H_RAYLEIGH, H_MIE, H_ASH);
    A.uAerialMieG.value = MIE_G;

    // One full evaluation before the first frame so nothing pops at boot. The
    // sky-view table has to be rendered first: captureEnv integrates it for the
    // ambient, and an unrendered target reads back as zero, which would publish
    // a black ambient for the frame the loading screen hands over on.
    this.step(ctx, 0);
    this.skyView.render(ctx.renderer);
    this.captureEnv(ctx);
    // ...and once more, so the ambient the second pass measures is the one the
    // dome was actually drawn with. The loop's gain is well under one (see
    // readIrradiance), so a single extra iteration is convergence, not a fixed
    // point chased forever.
    this.step(ctx, 0);
    this.skyView.render(ctx.renderer);
    this.captureEnv(ctx);
  }

  setWeather(kind: WeatherState['kind'], seconds = 25): void {
    this.machine.set(kind, seconds);
  }

  private setQuality(tier: 'low' | 'medium' | 'high' | 'ultra'): void {
    const m = this.skyMat;
    if (!m) return;
    // The march is the whole cloud model now, not a decoration on top of a
    // billboard, so the step budget is where quality actually lives. Below ~40
    // the density integration is too coarse to resolve an edge softly and the
    // silhouette starts to facet again.
    // Trimmed from 24/40/56/80. Breaking the "cloudy" deck open (see Weather.ts)
    // means a view ray now crosses gaps instead of extinguishing in the first
    // few hundred metres, so the same step budget buys far more marching — the
    // redmtn vantage went from 33fps to 10. The silhouette still reads soft at
    // 44 because the erosion octave, not the step count, is what resolves an
    // edge; below about 36 it starts to facet.
    const steps = { low: 20, medium: 32, high: 44, ultra: 64 }[tier];
    const light = { low: 3, medium: 4, high: 5, ultra: 6 }[tier];
    m.uniforms.uCloudSteps.value = steps;
    m.uniforms.uLightSteps.value = light;
    this.csm.setQuality(tier);
  }

  update(ctx: Ctx): void {
    this.step(ctx, ctx.time.dt);
    // Both ahead of the main pass, so the dome's fetch and every fogged surface
    // read THIS frame's sky rather than last frame's. The sky-view table has to
    // go first of all: terrain, water, flora and props are all drawn before the
    // dome and all of them sample it.
    this.skyView?.render(ctx.renderer);
    this.cloudPass?.render(ctx.renderer, ctx.camera, ctx.size.w, ctx.size.h);

    this.envAge += ctx.time.dt;
    if (this.envStale(ctx)) this.captureEnv(ctx);

    // The sky owns the environment, and it has to say so every frame.
    //
    // Two systems were writing `scene.environment`: this one, from a PMREM of
    // the live dome, and the material system, from a separately-authored
    // procedural dome whose horizon anchor is (0.42, 0.20, 0.115) — eight times
    // the radiance of its zenith and deeply orange, with a sun disc baked into
    // it on top. Whichever wrote last won, and because the material system runs
    // at order -100 and re-prefilters whenever the sun moves, in practice it was
    // that one: measured on all five gate vantages, `scene.environment` was the
    // synthetic dome every time.
    //
    // The consequence is the whole of the stage-2 finding. There is no ambient
    // light and no hemisphere light in this scene, so that dome was the ONLY
    // indirect term on every standard material in the game — and it was a warm,
    // horizon-dominated, sun-tinted dome. Lit and shadowed surfaces therefore
    // differed in brightness and not in hue, 92-100% of chroma-bearing pixels
    // landed in hue 0-60 in every luminance decile, and the colour stage was
    // being asked to manufacture in a LUT a separation that did not exist in the
    // lit image.
    //
    // A one-pointer compare per frame is what makes the ownership deterministic
    // instead of a race, and it is free.
    if (this.envRT !== null && ctx.scene.environment !== this.envRT.texture) {
      ctx.scene.environment = this.envRT.texture;
    }
  }

  private step(ctx: Ctx, dt: number): void {
    const m = this.skyMat;
    if (!m || !this.dome) return;
    const u = m.uniforms;
    const A = aerialUniforms();
    const p = this.machine.params;

    // Compare against what was last published, so a setWeather() between
    // frames is reported just like an autonomous roll.
    const published = this.weather.kind;
    this.machine.update(dt, ctx.time.elapsed);
    const changed = this.machine.kind !== published;

    updateEphemeris(ctx.clock.hour, ctx.clock.day, this.eph);
    const camPos = ctx.camera.getWorldPosition(this.tmpV);
    const camY = Math.max(camPos.y, 0);

    // ---- direct light ------------------------------------------------------
    sunShading(this.eph.sun.alt, camY, this.shading);
    const sinAlt = Math.sin(this.eph.sun.alt);
    const dayFade = THREE.MathUtils.smoothstep(sinAlt, -0.09, 0.05);
    const sunW = SUN_PEAK * this.shading.luminance * p.sunMul * dayFade;

    // Phase-illuminated moons; the brighter one becomes the key light at night
    // so the world keeps a real shadow direction after dusk.
    const illumM = 0.5 * (1 - this.eph.masser.dir.dot(this.eph.sun.dir));
    const illumS = 0.5 * (1 - this.eph.secunda.dir.dot(this.eph.sun.dir));
    const upM = THREE.MathUtils.smoothstep(Math.sin(this.eph.masser.alt), -0.02, 0.18);
    const upS = THREE.MathUtils.smoothstep(Math.sin(this.eph.secunda.alt), -0.02, 0.18);
    // What SURFACES are lit by...
    const moonW = MOON_PEAK * illumM * upM;
    const secW = MOON_PEAK * 0.3 * illumS * upS;
    // ...and what the MEDIUM (sky column, cloud deck, haze) is lit by. See the
    // note on MOON_PEAK: one constant for both is what forced the world to stay
    // black in order to keep the night sky from reading as dusk.
    const moonSkyW = MOON_SKY * illumM * upM;
    const secSkyW = MOON_SKY * 0.3 * illumS * upS;

    const nightKey = moonW >= secW ? this.eph.masser : this.eph.secunda;
    const nightCol = moonW >= secW ? MOON_TINT_MASSER : MOON_TINT_SECUNDA;
    // What the MEDIUM is lit by. Surfaces keep the softened nightCol (see
    // MOON_TINT_MASSER); the air, the haze layer and the cloud deck get the
    // moon's real spectrum, because a veil of moonlit cirrus drawn in front of a
    // red moon in near-neutral grey is what buried Masser's chroma: measured on
    // the night frame the veil at the limb was (0.064, 0.069, 0.043) linear —
    // more green in it than the disc itself was emitting.
    const nightMedia = moonW >= secW ? MOON_KEY_MASSER : MOON_TINT_SECUNDA;
    const nightW = Math.max(moonW, secW) * p.sunMul;
    /** The same key, in the medium's (much dimmer) units. */
    const nightMediaW = Math.max(moonSkyW, secSkyW) * p.sunMul;

    if (sunW >= nightW) {
      this.sun.color.copy(this.shading.color);
      this.weather.sunDir.copy(this.eph.sun.dir);
    } else {
      this.sun.color.copy(nightCol);
      this.weather.sunDir.copy(nightKey.dir);
    }
    // Same tint the sky dome uses, so lit surfaces sit in the same air.
    this.sun.color.multiply(this.tmpCol.setRGB(p.tintR, p.tintG, p.tintB, THREE.LinearSRGBColorSpace));
    // Dip through the hand-off so the shadow direction never visibly snaps.
    const sep = Math.abs(sunW - nightW) / (sunW + nightW + 1e-5);
    this.sun.intensity = Math.max(sunW, nightW) * (0.55 + 0.45 * sep);
    this.weather.sunColor.copy(this.sun.color).multiplyScalar(this.sun.intensity);

    // Every cascade carries the same colour and intensity. Only the first one's
    // contribution is evaluated (see the shader patch in Cascades.ts), but a
    // mismatched set would be a trap for anyone who later adds a fifth light.
    this.csm.syncKeyLight();
    this.csm.update(ctx.camera, this.weather.sunDir, ctx.time.frame);

    // ---- ambient -----------------------------------------------------------
    //
    // Measured off the dome, not authored. `skyIrr` is the cosine-weighted
    // hemispheric irradiance of the sky-view table, refreshed alongside the IBL
    // bake; it already contains the day/twilight/night schedule, the eye's
    // altitude and the weather, because it is the scattering integral itself.
    // See the note on AMB_NIGHT for what it replaced and why.
    //
    // SKY_FILL is a units calibration and nothing else: it is the one number
    // that says how much of the physical answer this build's exposure is drawn
    // against. It is NOT a per-shot tuning knob and must not become one.
    const amb = this.weather.ambient;
    amb.copy(this.skyIrr).multiplyScalar(SKY_FILL);
    // Driven by the MEDIUM's weight, not the key's, and this is not a detail.
    //
    // The night sky is very nearly all haze-layer radiance — the solar integral
    // is dead, the moon's own aureole is small and the airglow is tiny — and the
    // haze layer is lit by uSkyAmbient, which is this. Hanging the ambient off
    // the surface key instead put the whole thing in a loop: raising the key to
    // light the world raised the ambient, which raised the sky by the same
    // factor, which left the ground exactly as dark relative to it as before
    // (measured: sky 76 -> 131 while the hills went 22 -> 36). The key is the
    // only term that must move.
    const moonAmb = (moonSkyW + secSkyW) * 1.9;
    amb.r += AMB_NIGHT.r + MOON_AMB_TINT.r * moonAmb;
    amb.g += AMB_NIGHT.g + MOON_AMB_TINT.g * moonAmb;
    amb.b += AMB_NIGHT.b + MOON_AMB_TINT.b * moonAmb;
    amb.multiplyScalar(p.ambMul);
    // Heavy particulate recolours the entire ambient dome — this is why an ash
    // storm makes even shadowed rock read ochre.
    this.hazeCol.setRGB(p.hazeR, p.hazeG, p.hazeB, THREE.LinearSRGBColorSpace);
    this.hazeDeepCol.setRGB(p.deepR, p.deepG, p.deepB, THREE.LinearSRGBColorSpace);
    const hazeMix = THREE.MathUtils.clamp(p.hazeDensity / 0.006, 0, 0.85);
    this.tmpCol.copy(this.hazeCol).multiplyScalar(amb.r + amb.g + amb.b);
    amb.lerp(this.tmpCol, hazeMix * 0.7);
    amb.addScalar(this.machine.lightning * 0.5);

    // ---- sky dome uniforms -------------------------------------------------
    this.dome.position.copy(camPos);
    (u.uSunDir.value as THREE.Vector3).copy(this.eph.sun.dir);
    (u.uSunTint.value as THREE.Color).setRGB(p.tintR, p.tintG, p.tintB, THREE.LinearSRGBColorSpace);
    u.uCamY.value = camY;
    u.uMieMul.value = p.mieMul;
    u.uMsBoost.value = p.msBoost;
    (u.uSkyAmbient.value as THREE.Color).copy(amb);
    u.uTime.value = ctx.time.elapsed;

    (u.uMasserDir.value as THREE.Vector3).copy(this.eph.masser.dir);
    (u.uSecundaDir.value as THREE.Vector3).copy(this.eph.secunda.dir);
    // A moon disc at 0.95 sat every channel of the tonemapper the moment the
    // metered exposure opened up for a night frame, so Masser came out a flat
    // white circle and threw away its own colour — and fed the bloom a source
    // three stops over the threshold, which is what put a 60-degree halo across
    // the left half of the dome.
    //
    // 0.30 was still too hot for the BIG disc: measured off the night frame,
    // Masser's lit face landed at 243/196/158 with the red channel peaking at
    // 254, i.e. sitting on the shoulder of the AgX sigmoid, where the last of
    // its chroma is compressed out. A rust-red body rendered as cream is how the
    // frame earned "the hero element is a stock photograph of Earth's moon".
    // Masser therefore runs two thirds of a stop darker so its lit face lands
    // mid-shoulder and keeps its oxide chroma; Secunda, which is small, pale and
    // was the moon nobody noticed, runs correspondingly brighter. The pair still
    // reads big-and-dim against small-and-bright, which is the correct relation
    // for a large low-albedo body beside a small icy one.
    // Down again, from 0.26/0.40, now that moon() rolls the disc's own highlights
    // off with a hue-preserving shoulder: the shoulder stops the RED channel
    // clipping on its own, and this lands the compressed peak near 0.92 display
    // instead of on top of it.
    // Down again, 0.31 -> 0.235 on Masser, and this one is about CONTRAST rather
    // than clipping. Measured on the re-solved night frame the disc came back at
    // 233/171/119 — not clipped, but far enough onto the AgX shoulder that the
    // crater field's own albedo range compressed to three or four levels across
    // the whole face, so a body that is rendering relief correctly still read as
    // a flat orange circle. The moon is the only object in the frame whose
    // radiance is fixed independently of what the scene metered to, so it is the
    // one thing that can be placed deliberately: at 0.235 the lit face lands near
    // 205 with its mid-tones off the shoulder, which is where a 2:1 albedo ratio
    // between highland and basin is worth thirty levels instead of four.
    (u.uMoonBright.value as THREE.Vector2).set(0.235, 0.44);
    // Stars belong to astronomical twilight, not to sunset. The old window
    // opened at sinAlt -0.12 (about 7 degrees down), which put a full star
    // field over a sky that still had the sun on the horizon.
    u.uStarBright.value =
      0.80 * p.starMul * (1 - THREE.MathUtils.smoothstep(sinAlt, -0.26, -0.05));

    // Moonlight in sun-equivalent units, for the dome's second scattering
    // source. The moons are lit by the same sun, so their colour is the moon's
    // own albedo tint times the sunlight that reaches them, and it reddens
    // through the column exactly as the disc does.
    const moonScale = (SUN_E * MOON_SKY) / SUN_PEAK;
    this.setMoonLight(
      u.uMasserLight.value as THREE.Color,
      MOON_GLOW_MASSER,
      illumM,
      this.eph.masser.alt,
      moonScale * p.sunMul,
    );
    this.setMoonLight(
      u.uSecundaLight.value as THREE.Color,
      MOON_TINT_SECUNDA,
      illumS,
      this.eph.secunda.alt,
      moonScale * 0.3 * p.sunMul,
    );

    // Star sphere rotates about the celestial pole once per sidereal day.
    this.starRot.makeRotationAxis(this.pole, -this.eph.lst);
    this.starFrame.setFromMatrix4(this.starRot);
    (u.uStarFrame.value as THREE.Matrix3).copy(this.starFrame);

    // Wrap on the common period of the weather map (80km) and the cloud volume
    // (80km / 6), so the offset never grows past float32's useful precision and
    // the wrap itself is invisible.
    this.cloudWind.addScaledVector(this.machine.windDir, -this.machine.windSpeed * 2.4 * dt);
    this.cloudWind.x = ((this.cloudWind.x % 80000) + 80000) % 80000;
    this.cloudWind.y = ((this.cloudWind.y % 80000) + 80000) % 80000;
    (u.uCloudWind.value as THREE.Vector2).copy(this.cloudWind);
    // Deck shear: the top of a cumulus deck outruns its base by roughly its own
    // depth over an hour, so a billow leans downwind by the better part of a
    // kilometre. This is the difference between a sky of wind-driven forms and
    // the "soft orange lozenges, radially symmetric" the review measured.
    (u.uCloudShear.value as THREE.Vector2)
      .copy(this.machine.windDir)
      .multiplyScalar(-90 * this.machine.windSpeed);
    // The ash sheets advect on the same wind, an order of magnitude slower than
    // the cloud deck because they are a boundary-layer feature, not a 3km one.
    this.hazeWind.addScaledVector(this.machine.windDir, -this.machine.windSpeed * 0.55 * dt);
    this.hazeWind.x = ((this.hazeWind.x % 60000) + 60000) % 60000;
    this.hazeWind.y = ((this.hazeWind.y % 60000) + 60000) % 60000;
    (u.uHazeWind.value as THREE.Vector2).copy(this.hazeWind);
    u.uCoverage.value = p.coverage;
    u.uCirrus.value = p.cirrus;
    // The veil's shear axis. Fallstreaks lie along the flow, so the streak
    // direction is the wind's and turns with it, instead of being pinned to
    // world X — which is what made every filament in every frame run at the same
    // screen angle.
    (u.uWindDir.value as THREE.Vector2).copy(this.machine.windDir);
    u.uCloudDensity.value = p.density;
    u.uCloudType.value = p.type;
    u.uLightning.value = this.machine.lightning;

    // Cloud tops sit above most of the extinction, so they keep burning long
    // after the ground has gone blue.
    blackbodyLinear(sunCCT(this.eph.sun.alt), this.bb);
    const Tc = transmittance(PLANET_R + 3000, sinAlt);
    this.cloudSun.setRGB(
      this.bb[0] * Tc[0],
      this.bb[1] * Tc[1],
      this.bb[2] * Tc[2],
      THREE.LinearSRGBColorSpace,
    );
    // No 1.25 gain. This is the solar irradiance arriving at cloud altitude; a
    // multiplier on it is a claim that the sun is a quarter brighter for clouds
    // than for everything else in the frame, and it lands on top of the octave
    // series' own overshoot (see marchClouds).
    this.cloudSun.multiplyScalar(SUN_E * Math.max(dayFade, 0.0));
    // The high veil is at 7.4km and was being handed the deck's beam, i.e. the
    // sun as it arrives at 3km. That is four and a half kilometres of extra
    // Rayleigh applied to a layer that is above it: measured at 09:00 it made the
    // veil's key a sixth redder in blue than the light actually reaching that
    // altitude. A veil that carries 65% of the frame's red-channel irradiance in
    // some weather cannot be lit by the wrong beam.
    const Tv = transmittance(PLANET_R + CIRRUS_H, sinAlt);
    this.cirrusSun.setRGB(
      this.bb[0] * Tv[0],
      this.bb[1] * Tv[1],
      this.bb[2] * Tv[2],
      THREE.LinearSRGBColorSpace,
    );
    this.cirrusSun.multiplyScalar(SUN_E * Math.max(dayFade, 0.0));
    // The deck needs its own key direction: after dusk the sun is below the
    // horizon, so marching the light cone along it drives every sample into the
    // slab and the whole deck goes black. Handing the cone to the brighter moon
    // instead is what gives a night sky moonlit cloud tops and a shadowed
    // underside rather than a uniform grey lid.
    if (sunW >= nightW) {
      (u.uCloudLightDir.value as THREE.Vector3).copy(this.eph.sun.dir);
      // A 0.7-degree source: srcG moves g by four parts in ten thousand for a
      // body this small, so the widening term is inert by day, deliberately.
      u.uCloudSrcAng.value = u.uSunAng.value as number;
      // The energy ceiling, which is NOT inert by day and used to be.
      //
      // At 1.0e4 the deck's key term was unbounded, and the thing it was unbound
      // by is a diffraction peak. marchClouds' phase function carries a g=0.96
      // lobe at weight 0.28; Henyey-Greenstein at that asymmetry returns 97x
      // isotropic on axis, so a view ray passing within a few degrees of the sun
      // through thin cloud came back at a radiance of 68-74 against a clear-sky
      // peak of 1.1 — six stops over anything the tonemapper's shoulder can roll
      // off, i.e. a white hole in the sky with speckle around it. That is the
      // same "hallucinating a searchlight in the middle of it" the moon path
      // already rejects a few lines below, and for the same reason: a real
      // polydisperse droplet population averages its diffraction lobe out over
      // the first couple of degrees, which is inside the solar disc's own
      // angular size and is therefore already carried by the direct beam.
      //
      // It matters far beyond the sky's own pixels, because this cube IS the
      // scene's only indirect light. Measured by ablation on the ridge vantage
      // at 09:00 clear: the cloud-free dome integrates to (0.45, 0.64, 1.00),
      // hue 219 — a blue hemisphere — and the full environment cube integrated
      // to (2.19, 1.87, 1.73), hue 18. The deck was 65% of the world's entire
      // fill light and its chroma was the SUN's to within half a degree of hue,
      // so a surface in shadow and a surface in sun differed in brightness and
      // not in colour. Ablating the near-solar lobe alone accounts for over half
      // of that: with the ceiling armed the same cube reads (1.21, 1.12, 1.19).
      //
      // The number is the physical one the marchClouds octave series already
      // names — a conservative medium cannot return more than the irradiance
      // falling on it, so E_perp * mu0 * albedo / pi is the diffuse limit — with
      // a factor of two of headroom on top, because a THIN sunward edge legally
      // does exceed the diffuse limit in the forward direction and that excess
      // is the silver lining. Two is where the lining still reads at several
      // times the deck's body against a sky an order of magnitude below it, and
      // where nothing in the frame is beyond the shoulder.
      u.uCloudKeyMax.value =
        DECK_KEY_HEADROOM *
        Math.max(this.cloudSun.r, this.cloudSun.g, this.cloudSun.b) *
        Math.max(sinAlt, 0.02) *
        (CLOUD_ALBEDO / Math.PI);
    } else {
      (u.uCloudLightDir.value as THREE.Vector3).copy(nightKey.dir);
      // ...and at night both bite. The key is a four-degree body whose own disc
      // is capped by moon() at 0.45 radiance times its per-body scale, so that
      // is the ceiling for anything scattering its light. Without this a puff a
      // few degrees off Masser measured 3.1 radiance against a disc of 0.14 —
      // twenty times the brightness of the object lighting it.
      const keyIsMasser = moonW >= secW;
      const moonAng = u.uMoonAng.value as THREE.Vector2;
      const moonBright = u.uMoonBright.value as THREE.Vector2;
      u.uCloudSrcAng.value = keyIsMasser ? moonAng.x : moonAng.y;
      u.uCloudKeyMax.value = 0.45 * (keyIsMasser ? moonBright.x : moonBright.y);
      const mw = ((SUN_E * nightMediaW) / SUN_PEAK) * 0.85;
      this.cloudSun.setRGB(
        nightMedia.r * mw,
        nightMedia.g * mw,
        nightMedia.b * mw,
        THREE.LinearSRGBColorSpace,
      );
      this.cirrusSun.copy(this.cloudSun);
    }
    (u.uCloudSun.value as THREE.Color).copy(this.cloudSun);
    (u.uCirrusSun.value as THREE.Color).copy(this.cirrusSun);

    // What lights the veil when the sun does not.
    //
    // A cirrus sheet hangs in a very particular place: above essentially all of
    // the aerosol and two thirds of the molecular column, and below nothing at
    // all. So the two hemispheres it sees are as different as two illuminants in
    // one scene ever get, and the veil's shaded filaments and its sunlit tops
    // should not be the same colour. What was here instead was `uCloudAmb * 0.20`
    // — a fifth of a deliberately-neutralised deck ambient, i.e. a sixteenth of a
    // hemispheric integral, carrying no spectrum of its own. With that as the
    // only competition, every filament in the sky was the sun's chroma times an
    // ochre, which is exactly the cream sheet the reviews kept filing.
    //
    // ABOVE the veil there is only the clean Rayleigh column, and what it sends
    // down is half of what it scatters: 0.5 * E_perp * tau, with tau the vertical
    // molecular depth over 7.4km. That is (0.018, 0.043, 0.105) — a deep blue at
    // a few percent of the beam, and it is the only genuinely cool light in a
    // daylight frame of this world.
    const tv = H_RAYLEIGH * Math.exp(-CIRRUS_H / H_RAYLEIGH);
    const skyUp = u.uCirrusSkyUp.value as THREE.Color;
    skyUp.setRGB(
      this.cirrusSun.r * BETA_RAYLEIGH[0] * tv,
      this.cirrusSun.g * BETA_RAYLEIGH[1] * tv,
      this.cirrusSun.b * BETA_RAYLEIGH[2] * tv,
      THREE.LinearSRGBColorSpace,
    );
    skyUp.multiplyScalar(0.5 / Math.PI);
    // BELOW it there is the entire planet — the ash plain and the whole haze
    // column over it, which is warm. The sky-view table's LOWER hemisphere is
    // measured, not authored, and it is exactly that: ground disc plus sub-horizon
    // air. Radiance, so irradiance / pi.
    (u.uCirrusSkyDn.value as THREE.Color).copy(this.groundIrr).multiplyScalar(1.0 / Math.PI);
    // The sky is what lights a cloud, and the sky is not grey.
    //
    // What was here neutralised this term twice over — 62% of the way toward its
    // own luminance, then a further 34% toward the ash albedo — on the argument
    // that "light bouncing inside a thick deck is spectrally flat". The premise
    // is true and the conclusion does not follow: water and ice are grey, so the
    // deck's internal transport is achromatic, and a grey medium multiplying a
    // blue illuminant emits BLUE. What the neutralisation actually did was throw
    // away the illuminant.
    //
    // That mattered far more than it looks, because the cloud layers are not a
    // decoration on the lighting — measured by ablating them out of the
    // environment bake on the ridge vantage, the deck and the veil together are
    // 53% of the entire diffuse irradiance of the world. So the ONE illuminant in
    // this scene that differs in hue from the sun was being fed to half of the
    // indirect light with its hue removed, and every surface in shadow came back
    // the same colour as every surface in sun. The cloud-free dome integrates to
    // hue 223 and the frame's IBL measured hue 24.
    //
    // `amb` is already the honest answer: it is the sky-view table's own cosine
    // integral, so it carries the scattering integral's blue on a clear day AND
    // it has already been pulled toward the ash albedo in proportion to the
    // particulate load a few lines above (see hazeMix). The ash storm therefore
    // still lights its deck with an ochre hemisphere — by schedule rather than by
    // a flat constant — while a clear noon lights it with the sky.
    const cloudAmb = u.uCloudAmb.value as THREE.Color;
    cloudAmb.copy(amb).multiplyScalar(1.1);
    // The base of a deck sees the GROUND, so its radiance is the ash plain's:
    // albedo/pi times the total downward irradiance. Deriving it from the sky
    // ambient instead — which is what a 0.45 multiplier on cloudAmb did — left
    // the underside at 0.05 against a sky of 0.28, i.e. a black lid, and there
    // is no such thing as a black overcast at midday over a bright desert. The
    // real number is within a stop of the sky, which is exactly why a cloud base
    // reads as a lit ceiling with modelling in it rather than as a silhouette.
    const bounce = u.uCloudAmbDn.value as THREE.Color;
    bounce
      .copy(this.shading.color)
      .multiplyScalar(SUN_E * this.shading.luminance * Math.max(dayFade, 0) * p.sunMul * Math.max(sinAlt, 0));
    bounce.r += amb.r;
    bounce.g += amb.g;
    bounce.b += amb.b;
    // GROUND_ALBEDO / pi, times the ash plain's own warm-neutral chroma.
    bounce
      .multiplyScalar(0.16 / Math.PI)
      .multiply(this.tmpCol.setRGB(0.92, 0.82, 0.68, THREE.LinearSRGBColorSpace));

    (u.uHazeTint.value as THREE.Color).copy(this.hazeCol);
    (u.uHazeDeep.value as THREE.Color).copy(this.hazeDeepCol);
    u.uHazeDensity.value = p.hazeDensity;
    u.uHazeH.value = p.hazeH;

    // ---- shared aerial block ----------------------------------------------
    // One key light for the whole medium, sun by day and the brighter moon by
    // night, published once and read by the fog, the sky dome's haze layer and
    // the directional light alike. Before this the aerial block's key went to
    // zero at dusk while this.sun switched to the moon, so after dark the world
    // had a moonlit shadow direction and fog that knew about no light at all.
    const keyIsSun = sunW >= nightW;
    (A.uAerialSunDir.value as THREE.Vector3).copy(keyIsSun ? this.eph.sun.dir : nightKey.dir);
    const keyRad = A.uAerialSunColor.value as THREE.Color;
    if (keyIsSun) {
      keyRad
        .copy(this.shading.color)
        .multiplyScalar(SUN_E * this.shading.luminance * Math.max(dayFade, 0.0) * p.sunMul);
    } else {
      keyRad.copy(nightMedia).multiplyScalar((SUN_E * nightMediaW) / SUN_PEAK);
    }
    // The angular size of that key, so the fog's forward lobes are convolved
    // with the source the same way the dome's and the deck's are. uCloudSrcAng
    // is set from the same keyIsSun test a few lines above, so the two cannot
    // disagree and the air either side of the horizon line is one atmosphere.
    A.uAerialSrcAng.value = u.uCloudSrcAng.value as number;
    // The dome's particulate layer reads exactly these, so there is one number.
    (u.uHazeSun.value as THREE.Color).copy(keyRad);
    (u.uHazeSunDir.value as THREE.Vector3).copy(A.uAerialSunDir.value as THREE.Vector3);
    (A.uAerialSkyColor.value as THREE.Color).copy(amb);
    A.uAerialMieMul.value = p.mieMul;
    A.uAerialCamY.value = camY;
    (A.uAerialHazeTint.value as THREE.Color).copy(this.hazeCol);
    (A.uAerialHazeDeep.value as THREE.Color).copy(this.hazeDeepCol);
    A.uAerialHazeDensity.value = p.hazeDensity;
    A.uAerialHazeH.value = p.hazeH;
    (A.uAerialHazeWind.value as THREE.Vector2).copy(this.hazeWind);
    A.uAerialLightning.value = this.machine.lightning;

    // ---- particulate + audio ----------------------------------------------
    ctx.camera.getWorldDirection(this.fwd);
    const toSun = THREE.MathUtils.clamp(this.fwd.dot(this.eph.sun.dir), 0, 1) ** 2;

    // Radiance of the particulate medium itself, mirroring the sky dome's haze
    // term. Individual motes must be lit by this or an ash storm draws its own
    // ash as black specks against a glowing ochre sky.
    const hazeSelf = (1 / (1 + p.hazeDensity * p.hazeH)) ** 0.30;
    // 0.30 of the sun's RADIANCE, with no 1/pi anywhere, made the medium three
    // times brighter than the sky it hangs in: individual motes came out as
    // white specks over both the ground and the dome, which is the "isolated
    // bright dots that read as stuck pixels" defect on redmtn and the snowstorm
    // of white flecks over the ash storm. A diffuse grain returns albedo/pi of
    // the irradiance on it, and 0.11 is that number for an ash albedo of ~0.35.
    this.mediaCol
      .copy(this.shading.color)
      .multiplyScalar(SUN_E * this.shading.luminance * 0.11 * Math.max(dayFade, 0) * hazeSelf);
    // Ambient contribution to the medium. At 3x this out-ran the night sky
    // itself, so a light dusting of ash at midnight rendered as a swarm of
    // glowing embers brighter than the stars behind them.
    this.mediaCol.r += amb.r * 1.0;
    this.mediaCol.g += amb.g * 1.0;
    this.mediaCol.b += amb.b * 1.0;
    this.mediaCol
      .multiply(this.hazeCol)
      .multiply(this.tmpCol.setRGB(p.tintR, p.tintG, p.tintB, THREE.LinearSRGBColorSpace));
    this.particles?.update(
      p,
      ctx.camera,
      this.machine.windDir,
      this.machine.windSpeed,
      ctx.time.elapsed,
      ctx.size.h,
      this.sun.color,
      this.sun.intensity,
      amb,
      toSun,
      this.mediaCol,
    );
    const gust = THREE.MathUtils.clamp((this.machine.windSpeed - p.wind) / (p.gust + 1e-3), 0, 1);
    this.audio?.update(p.audioWind, p.audioRoar, p.audioRain, gust);

    // ---- publish -----------------------------------------------------------
    this.weather.kind = this.machine.kind;
    this.weather.blend = this.machine.blend;
    this.weather.windDir.copy(this.machine.windDir);
    this.weather.windSpeed = this.machine.windSpeed;
    this.weather.wetness = this.machine.wetness;
    this.weather.fogDensity = p.hazeDensity + BETA_MIE_E[1] * p.mieMul;

    this.emitAcc += dt;
    if (changed) {
      ctx.bus.emit('notify', { text: WEATHER_NOTICE[this.machine.kind], kind: 'info' });
    }
    if (changed || this.emitAcc >= 0.5) {
      this.emitAcc = 0;
      ctx.bus.emit('weather', this.weather);
    }
  }

  /**
   * Moonlight arriving at the top of the column, in the same units as SUN_E, so
   * the dome's scattering integral can treat a moon exactly like a second sun.
   * The transmittance term is what turns a moon sitting on the horizon into a
   * blood-orange lamp instead of a white one.
   */
  private setMoonLight(
    out: THREE.Color,
    tint: THREE.Color,
    illum: number,
    alt: number,
    scale: number,
  ): void {
    const s = Math.sin(alt);
    const w = illum * scale * THREE.MathUtils.smoothstep(s, -0.02, 0.18);
    if (w <= 1e-5) {
      out.setRGB(0, 0, 0, THREE.LinearSRGBColorSpace);
      return;
    }
    const T = transmittance(PLANET_R, Math.max(s, 0.02));
    out.setRGB(tint.r * T[0] * w, tint.g * T[1] * w, tint.b * T[2] * w, THREE.LinearSRGBColorSpace);
  }

  /**
   * Re-bake the IBL from the live sky, sky dome only. Runs at ~0.5Hz of in-world
   * time, not per frame — the diffuse irradiance simply does not change fast
   * enough to justify more.
   *
   * This cube is the whole of the scene's indirect lighting. Nothing else in the
   * build adds an ambient or hemisphere light, and terrain, architecture, actors
   * and gear are all `MeshStandardMaterial`, so `scene.environment` IS the
   * ambient term for every surface in the world. That is why it has to be the
   * sky's own radiance and not a second, separately-authored dome: what a
   * surface in shadow is lit by is exactly what is captured here.
   */
  /**
   * Has the dome changed enough since the last bake to be worth six face renders
   * and a PMREM chain?
   *
   * Every threshold is the point at which the *irradiance* moves by roughly a
   * percent, not the point at which a pixel of the dome moves:
   *
   *  - 0.7 degrees of sun travel, which is about three in-world minutes and is
   *    also what the old 2/60-hour clock gate was worth.
   *  - 6% of altitude, or 25 m, whichever is larger. The dome's composition is
   *    governed by exp(-y / 800) through the particulate layer, so a sixteenth of
   *    a scale height is the point at which the horizon band starts to change
   *    colour; below 25 m the eye is inside the densest part of the layer and
   *    nothing much moves.
   *  - 4% on the weather's optical parameters, which is well inside a
   *    transition's own blend and stops a settled preset re-baking forever.
   *
   * `envAge` floors the whole thing at 2.5 Hz. Six 128px faces marched inline
   * plus a PMREM chain is not free, and the old gate — 2 minutes of in-world
   * time — was worth about 0.5 Hz at a typical clock scale; nothing above a
   * couple of hertz is perceptible on a quantity this smooth.
   */
  private envStale(ctx: Ctx): boolean {
    if (this.envRT === null) return true;
    if (this.envAge < 0.4) return false;
    const p = this.machine.params;
    const camY = Math.max(ctx.camera.getWorldPosition(this.tmpV).y, 0);
    const rel = (a: number, b: number, f: number, abs: number): boolean =>
      Math.abs(a - b) > Math.max(abs, Math.abs(b) * f);
    return (
      !Number.isFinite(this.envSunDir.x) ||
      this.envSunDir.dot(this.weather.sunDir) < 0.99993 ||
      rel(camY, this.envCamY, 0.06, 25) ||
      rel(p.hazeDensity, this.envHaze, 0.04, 1e-6) ||
      rel(p.coverage, this.envCover, 0.04, 0.004) ||
      rel(p.mieMul, this.envMie, 0.04, 0.01)
    );
  }

  private captureEnv(ctx: Ctx): void {
    const { cubeCam, cubeRT, pmrem, dome } = this;
    if (!cubeCam || !cubeRT || !pmrem || !dome) return;

    const p = this.machine.params;
    this.envSunDir.copy(this.weather.sunDir);
    this.envCamY = Math.max(dome.position.y, 0);
    this.envHaze = p.hazeDensity;
    this.envCover = p.coverage;
    this.envMie = p.mieMul;
    this.envAge = 0;

    // Integrate the dome BEFORE re-rendering it: the table on the GPU right now
    // is this frame's, rendered at the top of update(), and it is the same
    // function of the same uniforms the cube is about to be baked from.
    this.skyView?.readIrradiance(ctx.renderer, this.skyIrr, this.groundIrr);

    // The cube faces have no half-res buffer behind them, so the dome marches
    // inline for the capture. Six 128x128 faces at 0.5Hz is nothing.
    const mode = this.skyMat?.uniforms.uCloudMode;
    if (mode) mode.value = 0;
    // ...and the solar disc and its aureole come out, because the sun is already
    // in the scene as a directional light. See uEnvCapture in SkyShader.
    const envFlag = this.skyMat?.uniforms.uEnvCapture;
    if (envFlag) envFlag.value = 1;

    // Isolate the dome: the capture must see sky and nothing else, and moving
    // one object between scenes is cheaper than any layer-mask dance.
    const parent = dome.parent;
    this.envScene.add(dome);
    cubeCam.position.copy(dome.position);
    cubeCam.updateMatrixWorld(true);

    const prevTarget = ctx.renderer.getRenderTarget();
    cubeCam.update(ctx.renderer, this.envScene);
    ctx.renderer.setRenderTarget(prevTarget);

    this.envRT = pmrem.fromCubemap(cubeRT.texture, this.envRT);
    ctx.scene.environment = this.envRT.texture;

    if (mode) mode.value = 1;
    if (envFlag) envFlag.value = 0;
    if (parent) parent.add(dome);
  }

  dispose(): void {
    this.offQuality?.();
    this.dome?.geometry.dispose();
    this.skyMat?.dispose();
    this.lut?.dispose();
    this.cloudTex?.dispose();
    this.weatherTex?.dispose();
    this.cloudPass?.dispose();
    this.skyView?.dispose();
    this.particles?.dispose();
    this.audio?.dispose();
    this.csm.dispose();
    this.cubeRT?.dispose();
    this.envRT?.dispose();
    this.pmrem?.dispose();
    this.dome?.removeFromParent();
    this.particles?.group.removeFromParent();
    this.dome = null;
    this.skyMat = null;
    this.envRT = null;
  }
}

/** Preset table is exported for debug UI; mutating it changes the game feel. */
export { PRESETS as WEATHER_PRESETS };
