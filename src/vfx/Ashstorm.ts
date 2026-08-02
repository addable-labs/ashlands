import * as THREE from 'three';
import { AERIAL_GLSL, aerialUniforms } from '../sky/Atmosphere';
import { VFX_BILLBOARD, VFX_COMMON, VFX_FRAG, VFX_NOISE, VFX_SPRITE, vfxUniforms } from './glsl';
import { tileUV } from './Sprites';

/**
 * ASH STORM — the near-field and the volume.
 *
 * The signature weather of the province is a layered read, and no single
 * particle system can carry it. `AmbientLayer` supplies the individually-lit
 * mid-field grain and the drifting sheets; this file supplies the two things it
 * structurally cannot:
 *
 *  - `AshStreaks`, the NEAR field: fast grit inside a few metres of the lens,
 *    drawn as motion-blurred streaks whose long axis is the storm's velocity
 *    projected into screen space. Elongation is geometric — the quad itself is
 *    stretched along the streak and the sprite stays a soft isotropic blob — so
 *    there is no way for the profile to reach the quad edge and draw a
 *    rectangle. This is the layer that gives the storm its speed; without it an
 *    ash storm reads as a static dust haze no matter how many motes are in it.
 *
 *  - `AshVolume`, the DENSITY: a fullscreen extinction-plus-inscatter pass
 *    marched along the eye ray against the pipeline's linear view depth. This
 *    is what makes the far mass genuinely *occluded* rather than tinted — the
 *    frame behind it is multiplied by transmittance, so silhouettes dissolve
 *    into the medium at the correct rate instead of being painted over. The
 *    density field is 3-D noise advected by the same wind vector as the
 *    particles, which is what stops it reading as a flat fog wall: sheets of
 *    grit visibly pass between the camera and the ridge.
 *
 * All three layers plus the sheets read `uVfxWind`, so the whole storm has one
 * direction.
 */

/* ============================================================== near field */

const STREAK_VERT = /* glsl */ `
precision highp float;

attribute vec4 aSeed;

uniform vec3  uBox;
uniform vec3  uDrift;   // wind displacement, accumulated and wrapped on the CPU
uniform float uAhead;
uniform vec2  uSize;
/** Shutter time in seconds. Sets how far a grain smears during the exposure. */
uniform float uExposure;
uniform float uFall;
uniform float uGust;
/** Spatial gust field: x = lattice frequency (1/m), y = depth of modulation. */
uniform vec2  uGustField;
uniform vec2  uTurb;
uniform float uNear;
uniform float uFar;
uniform float uMinPx;
/** Ceiling on the motion smear, as a multiple of the grain's minor axis. */
uniform float uMaxElong;
/** Exponent on the min-footprint energy compensation; see vfxFootprintPxE. */
uniform float uFootComp;

varying vec2  vUv;
varying float vFade;
varying float vViewDist;
varying vec3  vWorld;
/** Per-grain hash: albedo spread, so the field has internal contrast. */
varying float vGrain;
/** (cos, sin) of the grain's silhouette phase; see vfxSpriteWindowR. */
varying vec2  vPhase;

${VFX_NOISE}
${VFX_COMMON}
${VFX_SPRITE}
${VFX_BILLBOARD}

void main() {
  vec3 cr = vfxCamRight();
  vec3 cu = vfxCamUp();
  // Rows of the view matrix are the camera basis; row 2 points BEHIND the eye.
  vec3 cf = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);

  // Velocity of the medium. Gust is a slow global swell so the storm breathes
  // instead of running at a constant rate.
  float gust = 1.0 + uGust * sin(uVfxTime * 0.37) * 0.5;
  vec3 vel = uVfxWind * gust + vec3(0.0, -uFall, 0.0);

  // Camera-anchored slab, biased forward so most of the grain is in the
  // frustum rather than behind the eye. The displacement arrives pre-wrapped
  // from the CPU: wind * elapsed runs into the tens of thousands of metres
  // within the hour and float32 quantises a 3 mm grain's position to
  // centimetres long before that.
  // THE SLAB IS BIASED FORWARD, NOT ALONG THE VIEW AXIS.
  //
  // Offsetting by the full camera forward sinks the whole field the moment the
  // camera pitches down: the box drops with the look vector, upward rays leave
  // it within a couple of metres, and the top half of the frame — which on a
  // vista shot is most of it — ends up with no grain in it at all while the
  // ground half is fully populated. That is not a subtle bias; on the ashstorm
  // vantage it was the difference between a storm and an empty sky. Biasing on
  // the horizontal heading only keeps the slab level with the world it is
  // suspended in, which is where airborne ash actually is.
  vec2 fwd = cf.xz;
  float fl2 = length(fwd);
  vec3 lead = fl2 > 1e-3 ? vec3(fwd.x / fl2, 0.0, fwd.y / fl2) : vec3(0.0, 0.0, -1.0);
  vec3 centre = uVfxCamPos + lead * uAhead;
  // Every grain moves at the medium's velocity — the drift is wrapped to one
  // box period, so a per-particle speed multiplier would make the wrap visible
  // as a field-wide jump. Individuality comes from the curl below instead.
  vec3 pos = aSeed.xyz * uBox + uDrift;
  // TURBULENCE ON THREE TAPS, NOT TWELVE.
  //
  // vfxCurl costs four evaluations of a three-component potential — twelve
  // noise lookups, ~96 sines — and buys a divergence-free field. That property
  // is worth paying for on the eruption column, whose parcels have to stay a
  // coherent mass over a two-minute life; it is worth nothing at all on a grain
  // whose entire displacement here is a couple of centimetres and which is
  // re-randomised by the wrap every few seconds. Dropping to the raw potential
  // is a quarter of the vertex cost, and that saving is exactly what pays for
  // the population this layer has to carry — see the counts in VFX.buildStreaks.
  pos += (vfxPotential(pos * uTurb.x + vec3(0.0, vfxNoiseT() * 0.05, 0.0)) - 0.5) * (2.0 * uTurb.y);
  pos = mod(pos - centre + uBox * 0.5, uBox) - uBox * 0.5 + centre;

  float d = max(-(viewMatrix * vec4(pos, 1.0)).z, 0.001);
  // Squared, not cubed. A cube on a uniform seed puts three quarters of the
  // population in the bottom eighth of the size range, and with the range's
  // floor already under the minimum projected footprint that meant three
  // quarters of the field was being grown to the pixel floor and then having
  // its opacity divided by the square of the growth — i.e. deleted. The storm
  // still wants mostly fine grain, but it has to be fine grain that is actually
  // drawn.
  // POWER 1.6, NOT 2. Squared put two thirds of the population in the bottom
  // fifth of the range, i.e. under the footprint floor, where the energy
  // compensation then deletes it. The storm still wants mostly fine grain, but
  // it has to be grain that survives being drawn.
  float sz = pow(aSeed.x, 1.6);
  float size = mix(uSize.x, uSize.y, sz);
  // A streak is legitimately thin: the floor applies to the MINOR axis only,
  // and the elongation below is what makes it readable.
  //
  // PARTIAL energy compensation. Exact flux conservation (comp = 2) is right for
  // a mid-field mote whose contribution really is negligible; applied to the
  // near-lens grit it is what made the signature weather of the province render
  // as two dozen faint smudges. This grain is a metre from the eye and it is
  // supposed to be the thing you cannot see past.
  float alpha = vfxFootprintPxE(size, d, uMinPx, uFootComp);
  // OPACITY DISTRIBUTION, drawn independently of size. Airborne ash is a
  // mixture of optical depths — a translucent flake and a dense clot of the
  // same diameter look nothing alike — and a field where every grain carries
  // the layer's peak alpha reads as one sprite stamped at several scales, which
  // is exactly what a uniform draw produces. The hash is derived rather than
  // taken from a seed channel because all four are already spoken for.
  float ao = vfxHash11(dot(aSeed.xyz, vec3(127.1, 311.7, 74.7)));
  alpha *= 0.45 + 0.55 * ao;
  vGrain = vfxHash11(dot(aSeed.xyw, vec3(269.5, 183.3, 246.1)));
  float pw = vGrain * 39.7 + aSeed.z * 11.3;
  vPhase = vec2(cos(pw), sin(pw));

  // Streak axis: the velocity projected onto the film plane. A stationary
  // projection (dead-on downwind) collapses to a round mote, which is exactly
  // what a real streak does when it points at the lens.
  vec2 sv = vec2(dot(vel, cr), dot(vel, cu));
  float sl = length(sv);
  vec2 dirS = sl > 1e-3 ? sv / sl : vec2(0.0, 1.0);

  // ELONGATION FROM ACTUAL SCREEN-SPACE SPEED, not from a constant.
  //
  // Motion blur is (angular velocity x exposure), and angular velocity falls
  // off as 1/distance: a grain half a metre from the lens smears across the
  // frame, the same grain five metres out barely moves. Driving the stretch off
  // a fixed uElong uniform gave every grain in the field the same length AND the same
  // angle, which is what made the storm read as dirt on the lens rather than as
  // matter moving through air. With the real 1/d term — and the per-grain
  // tumble factor, which is what a grain spinning during the exposure does to
  // its own smear — the near grit streaks hard, the far and the slow grit stay
  // round motes, and the field stops sharing one silhouette.
  //
  // THE CEILING IS LOAD-BEARING AND IT IS NOT 20.
  //
  // A Vvardenfell ash storm blows at forty metres a second. At half a metre from
  // the lens that is a smear of well over a hundred pixels, so every near grain
  // pinned itself to the old clamp of 20x — and since a streak's opacity is
  // divided by sqrt(elong) to conserve flux over the area it gained, the entire
  // near field was drawn at a fifth of its nominal alpha as 60-pixel threads. A
  // handful of nearly invisible long streaks is precisely what the storm shot
  // showed. A smear of a few times the grain's own width still reads
  // unmistakably as speed and costs a factor of two, not five.
  float sizePx = max(size * uVfxProj / max(d, 1e-3), uMinPx);
  float smearPx = sl * uVfxProj / max(d, 1e-3) * uExposure;
  float tumble = 0.15 + 1.4 * aSeed.w * aSeed.w;
  float elong = clamp(1.0 + smearPx / sizePx * tumble, 1.0, uMaxElong);

  // Rotation. A round grain has no preferred axis, so as the streak collapses
  // toward 1 the orientation must become fully random over 360 degrees or the
  // residual alignment still reads as a comb. Stretched grains keep the
  // velocity axis with a few degrees of tumble on top.
  float rnd = aSeed.z * 6.2831853;
  vec2 dirR = vec2(cos(rnd), sin(rnd));
  // THE ALIGNMENT THRESHOLD WAS THE BUG, NOT THE ELONGATION.
  //
  // With the old 1.15-3.0 ramp a grain had to smear to three times its own
  // width before it took the wind axis at all, and at the shutter this layer
  // runs most of the population sits between 1.3 and 2 — so most of the storm
  // was drawn at a RANDOM angle, which is precisely the "no wind alignment,
  // no velocity streaking" read the ashstorm review reported. A grain that is
  // measurably longer than it is wide already has a direction and must point
  // along it; only the genuinely round ones may tumble freely.
  float streaky = smoothstep(1.03, 1.55, elong);
  vec2 dm = normalize(mix(dirR, dirS, streaky) + vec2(1e-5));
  float jit = (aSeed.y - 0.5) * 0.42 * streaky;
  float cj = cos(jit);
  float sj = sin(jit);
  vec2 dj = vec2(dm.x * cj - dm.y * sj, dm.x * sj + dm.y * cj);

  vec3 major = cr * dj.x + cu * dj.y;
  vec3 minor = -cr * dj.y + cu * dj.x;
  vec3 world = pos + major * (position.y * size * elong) + minor * (position.x * size);

  // Near fade so nothing detonates across the lens, far fade at the slab edge.
  //
  // THE FAR FADE USED TO START AT 0.55 OF THE BAND. In a shell whose volume goes
  // as r^3 that threw away four fifths of every band's population: for the near
  // band, everything from 3.6 m to 6.5 m — and since the bands are authored to
  // overlap (0.35-6.5, 4.5-26, 14-62) there was never anything to hide, only
  // grain to lose. Fading over the last fifth keeps the handover invisible and
  // keeps the grain.
  alpha *= smoothstep(uNear, uNear * 3.0, d) * smoothstep(uFar, uFar * 0.82, d);

  // GUSTS. A storm is not a uniform suspension; it arrives in sheets. One
  // low-frequency tap on a field translated by the wind means bands of dense
  // grit visibly sweep through the frame at the storm's own speed, which is the
  // difference between weather that is happening and a constant density of dots.
  // The field is shared by all three depth bands (same frequency, same
  // advection, same clock) so a gust is one event seen at three distances rather
  // than three unrelated modulations.
  float gustN = vfxNoise((pos - uVfxWind * vfxNoiseT() * 0.10) * uGustField.x);
  alpha *= mix(1.0, 0.16 + 1.95 * gustN, uGustField.y);
  // DEPTH FADE AGAINST THE MEDIUM ITSELF. The raymarched volume is composited
  // before this layer, so a grain sixty metres out was being drawn at full
  // strength on top of the fog that has already saturated in front of it —
  // which is exactly why the storm's grain reached uniformly into the far
  // distance instead of dissolving. This is the transmittance the volume pass
  // removed from everything else in the frame.
  alpha *= vfxMediumT(d);
  // Longer streaks are thinner in flux terms. TOKEN compensation only: the
  // exact 1/sqrt is a further factor of two off the near field's opacity on top
  // of everything else the pixel-floor machinery already takes, and a storm
  // whose grit is transparent is not a storm. Measured on the ashstorm vantage:
  // with the grains forced to pure black at their real opacity the whole layer
  // moved four per cent of the frame. Flux conservation is the right instinct
  // for a mid-field scatterer and it is not what this layer is for.
  alpha /= pow(elong, 0.18);

  vUv = uv;
  vFade = alpha;
  vViewDist = d;
  vWorld = world;
  gl_Position = alpha < 0.002 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const STREAK_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uAtlas;
uniform vec2  uTile;
uniform vec3  uColor;
uniform float uAlpha;
uniform float uTrans;
uniform float uMedia;
uniform float uLumCap;
/**
 * The per-grain radiance draw, as multiples of the medium's own luminance:
 * the darkest grain in the population and the palest. See the fragment body.
 */
uniform float uGrainLo;
uniform float uGrainHi;
/** Extra radiance on grains seen against the sun, as a fraction of the draw. */
uniform float uFlare;

varying vec2  vUv;
varying float vFade;
varying float vViewDist;
varying vec3  vWorld;
varying float vGrain;
varying vec2  vPhase;

${VFX_NOISE}
${AERIAL_GLSL}
${VFX_COMMON}
${VFX_SPRITE}
${VFX_FRAG}

void main() {
  // Eroded per grain rather than a smooth disc; see vfxSpriteWindowR. The
  // stretch is geometric, so the window stays isotropic in uv and the ragged
  // outline is carried along the streak instead of being flattened by it.
  float cov = texture2D(uAtlas, vfxTileUV(vUv, uTile)).a * vfxSpriteWindowR(vUv, vGrain, vPhase);
  float a = clamp(cov * uAlpha * vFade, 0.0, 1.0);
  if (a < 0.0025) discard;

  // THE GRAIN IS SHADED AND THEN PUT THROUGH THE SAME AERIAL TRANSFORM AS THE
  // TERRAIN. That sentence is the whole fix for a signature-weather shot with no
  // particulate in it.
  //
  // What was here instead: the grain's radiance was renormalised, after the
  // BRDF, onto an explicit multiple of vfxMedia()'s own luminance — the theory
  // being that this guarantees agreement with the background. It guarantees the
  // opposite of a storm. vfxMedia() is a reconstruction of the *background*
  // (the sky's in-scatter plus the volume's), so pinning every grain to a
  // multiple of it makes the layer a scaled copy of what is already behind it,
  // and with the counts a storm needs, the overlapping population integrates
  // straight back to a smooth wash. Measured on this exact frame: the layer
  // changed 99.6% of pixels and produced a near-constant grey offset with a
  // peak-to-peak of five code values. Not "too few particles" — the wrong
  // radiance model, in which no count, size or opacity can ever produce grain.
  //
  // Aerial perspective already does the job correctly and physically. A grain
  // two metres from the eye has two metres of air in front of it, so it keeps
  // its own dark basaltic value against a background carrying three hundred
  // metres of in-scatter; a grain sixty metres out has largely converged on the
  // haze. That is aerial perspective doing what it does to everything else in
  // the frame, and it is the reason the near band reads as MATTER and the far
  // band reads as air, from one expression instead of a hand-tuned per-band
  // level.
  //
  // The normal is NOT the view vector. Facing the sprite straight at the eye
  // pinned the wrapped-diffuse term to a constant and put the Henyey-Greenstein
  // lobe at the same value for every grain in the frame, so the whole field
  // shaded flat.
  vec3 eye = vWorld - uVfxCamPos;
  vec3 V = -normalize(eye);
  vec2 c = vUv * 2.0 - 1.0;
  float z = sqrt(max(0.0, 1.0 - dot(c, c)));
  vec3 cr = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 cuv = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 N = normalize(cr * c.x * 0.9 + cuv * c.y * 0.9 + V * max(z, 0.30));

  // PER-GRAIN OPTICAL CLASS, applied to the albedo and carried through to the
  // energy ceiling. Real airborne ash is dense black basaltic grit and porous
  // pale pumice in the same cubic metre, and that MIXTURE is what reads as
  // matter. Scaling uLumCap by the same draw is what keeps it: the shared BRDF
  // ends in "if (l > cap) outR *= cap/l" against a single medium-derived
  // ceiling, and a fixed ceiling flattens an albedo spread back to one value —
  // the documented reason the previous author gave up on varying the albedo.
  float cls = mix(uGrainLo, uGrainHi, vGrain);
  // Grains between the eye and the sun scatter forward hard; that flare is most
  // of what makes near-field grit read as lit rather than as dirt on the lens.
  float flare = pow(clamp(dot(-V, uVfxSunDir), 0.0, 1.0), 3.0);
  cls *= 1.0 + uFlare * flare;

  vec3 lit = vfxLitParticle(uColor * cls, N, V, 0.95, 0.8, uTrans, uMedia, uLumCap * cls);

  gl_FragColor = vec4(applyAerial(lit, vViewDist, eye) * a, a);
}
`;

export interface StreakOpts {
  count: number;
  renderOrder: number;
  /**
   * Depth band this layer occupies, in metres: [near fade-in, far fade-out].
   *
   * ONE STREAK LAYER CANNOT CARRY A STORM. A camera-anchored slab that reaches
   * five metres puts every grain it owns inside arm's length, and the band from
   * there out to the fog is left to the mid-field motes, whose millimetric
   * grains are all under the pixel floor and are therefore drawn at a few
   * percent opacity. The result is grit on the lens and nothing between it and
   * the horizon. Instancing this class two or three times at different depths —
   * with the world grain size scaled so each band lands in the same 2-6 px
   * class — is what makes the storm read as a volume you are inside rather than
   * as dirt on the front element.
   */
  band?: [number, number];
  /** Camera-anchored slab dimensions in metres. Defaults to the near band's. */
  box?: [number, number, number];
  /** Grain diameter range in metres. */
  size?: [number, number];
  /** Distance the slab is pushed along the view direction. */
  ahead?: number;
  /**
   * Fraction of the wind the grains are ADVECTED at. Not a fudge, and not the
   * same number as the wind the streaks are stretched by.
   *
   * A Vvardenfell gale runs at forty-five metres a second. A grain two metres
   * from the lens therefore crosses the entire frame in a tenth of a second,
   * which means that at any frame rate the renderer actually achieves it lands
   * in a completely different place every frame — and a temporal resolve
   * presented with a speck that never appears twice in the same neighbourhood
   * has nothing to accumulate and averages it into the background. That is not
   * a hypothetical: it is why the near field measured as two dozen faint
   * smudges however much opacity was thrown at it.
   *
   * It is also not what a real storm looks like. Grit at that speed is a smear,
   * not a moving dot, and the smear is already modelled — geometrically, by the
   * streak elongation, which keeps reading the FULL wind. Advecting the grain
   * itself at a fraction of it separates the two: the field still points and
   * streaks along the storm's velocity, and it stays on screen long enough to
   * be resolved. The fraction rises with distance because angular velocity
   * falls as 1/d, so the far band can afford to run at nearly the true rate.
   */
  speed?: number;
}

/** Positive modulo. */
function wrap(x: number, period: number): number {
  return period > 1e-6 ? ((x % period) + period) % period : 0;
}

/** Near-lens grit: motion-blurred streaks aligned to the storm's velocity. */
export class AshStreaks {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private max: number;
  private speed: number;

  constructor(o: StreakOpts, atlas: THREE.Texture, tile: number) {
    this.max = o.count;
    this.speed = o.speed ?? 1;
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
        3,
      ),
    );
    this.geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);

    const seed = new Float32Array(o.count * 4);
    for (let i = 0; i < o.count * 4; i++) seed[i] = Math.random();
    this.geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    this.geo.instanceCount = 0;
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...vfxUniforms(),
        ...aerialUniforms(),
        uAtlas: { value: atlas },
        uTile: { value: tileUV(tile) },
        uBox: { value: new THREE.Vector3(o.box?.[0] ?? 11, o.box?.[1] ?? 8, o.box?.[2] ?? 11) },
        uDrift: { value: new THREE.Vector3() },
        uAhead: { value: o.ahead ?? 2.6 },
        // 7x spread, cubed on the seed, so the field is mostly fine grain with
        // a scatter of coarse grit rather than one uniform particle size. The
        // top of the range was 0.021 m, which put the whole population inside
        // one visual size class once the min-footprint clamp had lifted the
        // fine end; widening it is what gives the field a readable range of
        // footprints instead of one blob at several scales.
        // The floor is what matters here, and 4.5 mm was under the pixel clamp
        // at every distance in the band — see the size draw in the vertex stage.
        uSize: { value: new THREE.Vector2(o.size?.[0] ?? 0.010, o.size?.[1] ?? 0.042) },
        // 1/140 s — a 180-degree shutter at the tier's own frame rate, which is
        // what the rest of the frame is implicitly exposed at. 1/400 was chosen
        // to keep the near field off the elongation ceiling, but it took the
        // whole population below the alignment threshold as well: the grains
        // stopped streaking, stopped pointing downwind, and the signature
        // weather shot came back reading as round motes. The ceiling is the
        // right place to bound the smear, not the shutter.
        uExposure: { value: 0.0072 },
        uFall: { value: 0.9 },
        uGust: { value: 0.35 },
        // ~55 m gust cells, and the depth is driven per frame off the storm
        // term: a clear day gets an even haze of grain, a full storm breathes.
        uGustField: { value: new THREE.Vector2(0.018, 0.0) },
        uTurb: { value: new THREE.Vector2(0.35, 0.35) },
        uMaxElong: { value: 13.0 },
        // 1.25, not 2. See the vertex stage.
        uFootComp: { value: 1.25 },
        // Driven per frame off the storm term; see VFXSystem.tuneAmbient.
        uGrainLo: { value: 0.55 },
        uGrainHi: { value: 1.25 },
        uFlare: { value: 0.9 },
        uNear: { value: o.band?.[0] ?? 0.35 },
        uFar: { value: o.band?.[1] ?? 6.5 },
        // 2 px minor axis put a one-pixel hard core on every grain, which the
        // TAA resolve turns into a crawling speck. Three is the floor at which
        // a sprite can still show a falloff.
        uMinPx: { value: 3.0 },
        // THE NEAR AND FAR ASH SHARE ONE MATERIAL. These four numbers are the
        // same as the `motes` ambient layer's, deliberately: near grit and
        // mid-field grain are the same substance seen at two distances, and any
        // divergence between the two shows up immediately as a frame where the
        // close ash is a set of pale blobs and the far ash a set of dark
        // shards. Whatever difference exists between them has to come out of
        // the geometry — the streak elongation — and out of the phase function,
        // never out of the albedo or the ceiling.
        uColor: { value: new THREE.Color(0.42, 0.365, 0.30) },
        // Driven per frame off the storm term; see VFXSystem.tuneAmbient.
        uAlpha: { value: 0.44 },
        uTrans: { value: 1.40 },
        // At parity with the medium the phase function decides, per grain, which
        // side of the background it lands on: grains angled toward the sun flare
        // above the haze, grains angled away sink below it.
        uMedia: { value: 1.0 },
        // A scatterer may out-radiate the multiply-scattered background it is
        // seen against, but only just. 1.45 let every near grain clip to cream.
        uLumCap: { value: 1.02 },
      },
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      premultipliedAlpha: true,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.renderOrder;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    this.mesh.name = `vfx:ash:streaks:${Math.round(o.band?.[1] ?? 6.5)}`;
  }

  setCount(n: number): void {
    const c = Math.min(this.max, Math.max(0, Math.floor(n)));
    this.geo.instanceCount = c;
    this.mesh.visible = c > 0;
  }

  /**
   * Integrate the wind displacement in double precision and keep it inside one
   * box period, so the vertex shader never sees a large coordinate.
   */
  advance(dt: number, wind: THREE.Vector3): void {
    const u = this.mat.uniforms;
    const box = u.uBox.value as THREE.Vector3;
    const d = u.uDrift.value as THREE.Vector3;
    const fall = u.uFall.value as number;
    const s = this.speed;
    d.x = wrap(d.x + wind.x * s * dt, box.x);
    d.y = wrap(d.y + (wind.y * s - fall) * dt, box.y);
    d.z = wrap(d.z + wind.z * s * dt, box.z);
  }

  u(name: string): THREE.IUniform {
    return this.mat.uniforms[name];
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/* ================================================================= volume */

const VOL_VERT = /* glsl */ `
precision highp float;

uniform vec3 uRayR;
uniform vec3 uRayU;
uniform vec3 uRayF;

varying vec3 vDir;

void main() {
  // The quad is authored in clip space; the interpolated corner rays give a
  // per-pixel view direction without ever touching gl_FragCoord.
  vDir = uRayF + uRayR * position.x + uRayU * position.y;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const VOL_FRAG = /* glsl */ `
precision highp float;

uniform float uDensity;
uniform vec3  uTint;
uniform float uBase;
uniform float uScaleH;
uniform float uFreq;
uniform float uMaxDist;
uniform float uSkyMul;
uniform vec3  uRayF;
uniform vec3  uDrift;

uniform float uFog;
uniform float uFogLevel;
uniform float uFogH;
uniform float uFogFreq;
uniform vec3  uFogTint;

varying vec3 vDir;

${VFX_NOISE}
${AERIAL_GLSL}
${VFX_COMMON}
${VFX_FRAG}

#define VOL_STEPS 8

void main() {
  vec3 dir = normalize(vDir);
  float cosF = max(dot(dir, normalize(uRayF)), 1e-3);

  // Distance to the first opaque surface along this ray. Sky (no prepass
  // coverage) marches the full slab at a reduced weight — the atmosphere
  // already owns most of the sky's own extinction, and doubling it would flood
  // the frame instead of thickening the air in front of the geometry.
  float dist = uMaxDist;
  float w = uSkyMul;
  float z = texture2D(uVfxDepth, gl_FragCoord.xy * uVfxDepthTexel).a;
  if (z > 0.001) {
    dist = min(z / cosF, uMaxDist);
    w = 1.0;
  }

  // Phase functions. Ash is strongly forward-scattering, water mist much less
  // so — that difference is most of what separates the two media on screen.
  float c = dot(dir, uVfxSunDir);
  float gA = 0.55;
  float phA = pow((1.0 - gA) * (1.0 - gA) / max(1.0 + gA * gA - 2.0 * gA * c, 1e-4), 1.5);
  float gF = 0.40;
  float phF = pow((1.0 - gF) * (1.0 - gF) / max(1.0 + gF * gF - 2.0 * gF * c, 1e-4), 1.5);

  vec3 med = vfxMedia();
  vec3 LA = med * uTint * (0.85 + 0.9 * phA);
  // GROUND MIST IS THE DIMMEST THING IN THE MIDGROUND, by construction. It is a
  // thin, cold layer lit by the sky and by a grazing sun; it does not have a
  // radiance of its own and it must never out-read the terrain it is lying on.
  // The coefficients here are the ceiling on that, and they sit below the
  // medium's own luminance at every scattering angle short of straight into
  // the sun.
  vec3 LF = med * uFogTint * (0.34 + 0.40 * phF);

  float dt = dist / float(VOL_STEPS);
  // Blue-noise offset on the first sample. Eight steps with a fixed phase draw
  // the marching lattice into the image as concentric bands across the whole
  // frame; a per-pixel offset converts that into grain, which the temporal
  // resolve then integrates away.
  float jit = vfxBlueNoise(gl_FragCoord.xy, mod(uVfxTime * 60.0, 64.0));

  float Tr = 1.0;
  vec3 Lacc = vec3(0.0);
  for (int i = 0; i < VOL_STEPS; i++) {
    vec3 p = uVfxCamPos + dir * (dt * (float(i) + jit));
    float dA = 0.0;
    float dF = 0.0;
    // Both branches are uniform across the frame, so they cost a skipped block
    // rather than divergence: clear weather pays nothing for the ash field and
    // a midday gale pays nothing for the mist.
    if (uDensity > 1e-6) {
      float h = exp(-max(p.y - uBase, 0.0) / uScaleH);
      // GUSTS IN THE MEDIUM, at the same scale the discrete grit is modulated
      // at. The old field ran at 0.011 (~90 m cells) and was advected at a third
      // of the wind: over a 340 m march that averages out along every eye ray,
      // which is why the storm's density read as a constant. At 160 m cells,
      // advected at nearly the true wind, the ray integral keeps the structure
      // and whole sheets of the medium sweep across the mountain. The
      // coefficients are chosen so the population MEAN is unchanged — this adds
      // contrast, it does not add fog.
      dA = uDensity * h * (0.08 + 2.32 * vfxFbm((p - uDrift) * uFreq, 2)) * w;
    }
    if (uFog > 1e-6) {
      // A fluid, not a height-independent haze: density falls off sharply above
      // the level line and the low-frequency noise is what gives the body its
      // shape, so the mist pools and thins instead of reading as a slab.
      float h = exp(-max(p.y - uFogLevel, 0.0) / uFogH);
      float n = vfxNoise((p - uDrift * 0.25) * uFogFreq + vec3(0.0, vfxNoiseT() * 0.02, 0.0));
      dF = uFog * h * smoothstep(0.28, 0.86, n);
    }
    float dTau = (dA + dF) * dt;
    if (dTau > 1e-6) {
      // Front-to-back: each slab's in-scatter is attenuated by everything
      // already integrated in front of it. This is what gives the mist real
      // depth — a near bank occludes a far one instead of summing with it.
      vec3 Ls = (LA * dA + LF * dF) / max(dA + dF, 1e-9);
      float aStep = 1.0 - exp(-dTau);
      Lacc += Tr * aStep * Ls;
      Tr *= 1.0 - aStep;
    }
  }

  float a = 1.0 - Tr;
  if (a < 0.003) discard;

  gl_FragColor = vec4(Lacc, a);
}
`;

/**
 * Fullscreen wind-advected ash density. Requires a bound linear-view-depth
 * buffer; `active` is false and the pass draws nothing without one.
 */
export class AshVolume {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private geo: THREE.PlaneGeometry;
  private rayR = new THREE.Vector3();
  private rayU = new THREE.Vector3();
  private rayF = new THREE.Vector3();

  constructor(renderOrder: number) {
    // Clip-space quad: PlaneGeometry(2,2) puts position.xy in [-1,1].
    this.geo = new THREE.PlaneGeometry(2, 2);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...vfxUniforms(),
        ...aerialUniforms(),
        uRayR: { value: new THREE.Vector3(1, 0, 0) },
        uRayU: { value: new THREE.Vector3(0, 1, 0) },
        uRayF: { value: new THREE.Vector3(0, 0, -1) },
        uDrift: { value: new THREE.Vector3() },
        uDensity: { value: 0 },
        uTint: { value: new THREE.Color(0.86, 0.74, 0.58) },
        uBase: { value: 0 },
        uScaleH: { value: 190 },
        uFreq: { value: 0.0062 },
        uMaxDist: { value: 340 },
        uSkyMul: { value: 0.45 },
        uFog: { value: 0 },
        uFogLevel: { value: 0 },
        // Radiation fog is metres deep, not tens of metres. A scale height much
        // above this and the "mist" is a haze the camera stands inside of.
        uFogH: { value: 3.4 },
        uFogFreq: { value: 0.022 },
        // Cold and slightly blue against the ochre world; the sun colour
        // arrives through vfxMedia(), so this is only the medium's own bias.
        uFogTint: { value: new THREE.Color(0.92, 0.94, 1.0) },
      },
      vertexShader: VOL_VERT,
      fragmentShader: VOL_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      premultipliedAlpha: true,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    this.mesh.name = 'vfx:ash:volume';
  }

  /**
   * Integrate the density field's advection on the CPU. Wrapped generously —
   * the value-noise hash loses its mantissa once the lattice coordinate runs
   * into the tens of thousands, and the wrap period is long enough that the
   * reshuffle is invisible in a field this low-contrast.
   */
  advance(dt: number, wind: THREE.Vector3): void {
    const d = this.mat.uniforms.uDrift.value as THREE.Vector3;
    const P = 8192;
    d.x = wrap(d.x + wind.x * dt * 0.85, P);
    d.z = wrap(d.z + wind.z * dt * 0.85, P);
  }

  /**
   * Ground mist, marched in the same pass as the ash.
   *
   * @param density extinction per metre inside the mist body.
   * @param level   world Y of the top of the body; density falls off above it.
   */
  setFog(density: number, level: number): void {
    this.mat.uniforms.uFog.value = density;
    this.mat.uniforms.uFogLevel.value = level;
  }

  /** True when the pass will actually run — i.e. a depth buffer is bound. */
  get active(): boolean {
    return this.mesh.visible;
  }

  /**
   * @param density extinction per metre at the base of the layer, before the
   *                noise modulation. Zero disables the pass entirely.
   */
  set(density: number, groundY: number, camera: THREE.PerspectiveCamera, depthBound: boolean): void {
    const u = this.mat.uniforms;
    u.uDensity.value = density;
    u.uBase.value = groundY;
    const any = density > 1e-5 || (u.uFog.value as number) > 1e-5;
    this.mesh.visible = any && depthBound;
    if (!this.mesh.visible) return;

    // Corner rays: the camera basis in world space, scaled by the frustum's
    // half-extents at unit depth.
    const e = camera.matrixWorld.elements;
    this.rayR.set(e[0], e[1], e[2]);
    this.rayU.set(e[4], e[5], e[6]);
    this.rayF.set(-e[8], -e[9], -e[10]);
    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
    (u.uRayR.value as THREE.Vector3).copy(this.rayR).multiplyScalar(tanY * camera.aspect);
    (u.uRayU.value as THREE.Vector3).copy(this.rayU).multiplyScalar(tanY);
    (u.uRayF.value as THREE.Vector3).copy(this.rayF);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
