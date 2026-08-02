import * as THREE from 'three';
import { AERIAL_GLSL, aerialUniforms } from '../sky/Atmosphere';
import { VFX_BILLBOARD, VFX_COMMON, VFX_FRAG, VFX_NOISE, VFX_SPRITE, vfxUniforms } from './glsl';
import { tileUV } from './Sprites';

/**
 * Ambient world VFX — everything that is in the world whether or not anything
 * is happening in it.
 *
 * One vertex-parametric shader with five compile-time modes drives all of it.
 * Nothing is simulated on the CPU: a particle's entire trajectory is a closed
 * form of (instance seed, time), so the per-frame cost is a handful of uniform
 * writes and one instanced draw per layer. The seeds are uploaded once at
 * construction and never touched again.
 *
 *   DRIFT   wind-advected motes on a curl field, wrapped around the camera
 *   RISE    buoyant embers, gated on the local field's lava-crust channel
 *   FOG     ground-hugging banks that pool below a level line
 *   SPRAY   shoreline spray, gated on the waterline
 *   VORTEX  dust devils helixing around CPU-placed anchors
 */

export const MODE_DRIFT = 0;
export const MODE_RISE = 1;
export const MODE_FOG = 2;
export const MODE_SPRAY = 3;
export const MODE_VORTEX = 4;

export const ANCHORS = 3;

const VERT = /* glsl */ `
precision highp float;

attribute vec4 aSeed;

uniform vec3  uBox;
uniform float uBoxLift;
uniform vec2  uSize;
uniform float uLife;
uniform float uSpin;
uniform float uRise;
uniform float uGravity;
uniform vec2  uTurb;        // x = spatial frequency, y = amplitude
uniform float uGroundOff;
uniform float uFadeDist;
uniform float uNearFade;
uniform float uFogLevel;
uniform float uMinPx;
uniform float uFootComp;
uniform float uSizePow;
uniform float uAlphaVar;
/** Exposure time in seconds for the velocity-aligned smear. 0 = round sprite. */
uniform float uStretch;
uniform float uMaxElong;
/** x = ground clearance where the loft fade begins, y = where it completes. */
uniform vec2  uLoft;
uniform vec4  uAnchors[${ANCHORS}];

varying vec2  vUv;
varying vec3  vWorld;
varying vec3  vRight;
varying vec3  vUpv;
varying float vFade;
varying float vViewDist;
varying float vSeed;
/** (cos, sin) of the instance's silhouette phase; see vfxSpriteWindowR. */
varying vec2  vPhase;

${VFX_NOISE}
${VFX_COMMON}
${VFX_SPRITE}
${VFX_BILLBOARD}

/**
 * VELOCITY-ALIGNED BILLBOARD.
 *
 * A drifting mote is not a disc. Over the exposure it smears along its own
 * screen-space velocity, and the angular velocity falls off as 1/distance — so
 * near grain streaks, far grain stays round, and the field stops sharing one
 * silhouette. Both halves of that matter: the streak is what says "matter
 * moving through air" rather than "speck on the front element", and the
 * distance dependence is a depth cue the sprites otherwise have none of.
 *
 * The stretch is GEOMETRIC — the quad is elongated and the sprite window stays
 * isotropic in uv — so the alpha profile can never reach the quad edge and draw
 * a rectangle. Below the streaking threshold the orientation goes fully random,
 * because a round grain has no preferred axis and a residual alignment across a
 * whole field reads as a comb.
 */
void vfxDriftQuad(
  vec2 quad, float spin, float size, float dist, vec3 vel,
  out vec3 major, out vec3 minor, out vec3 offset, out float shrink
) {
  vec3 cr = vfxCamRight();
  vec3 cu = vfxCamUp();
  vec2 sv = vec2(dot(vel, cr), dot(vel, cu));
  float sl = length(sv);
  float sizePx = max(size * uVfxProj / dist, 1e-3);
  float elong = clamp(1.0 + sl * uVfxProj / dist * uStretch / sizePx, 1.0, uMaxElong);
  vec2 dirR = vec2(cos(spin), sin(spin));
  vec2 dirS = sl > 1e-4 ? sv / sl : dirR;
  vec2 dm = normalize(mix(dirR, dirS, smoothstep(1.04, 1.9, elong)) + vec2(1e-5));
  major = cr * dm.x + cu * dm.y;
  minor = -cr * dm.y + cu * dm.x;
  offset = major * (quad.x * size * elong) + minor * (quad.y * size);
  // Partial flux conservation over the area the smear gained.
  shrink = 1.0 / sqrt(elong);
}

/** Wrap a world point into the box that follows the camera. */
vec3 vfxWrap(vec3 p, vec3 centre) {
  return mod(p - centre + uBox * 0.5, uBox) - uBox * 0.5 + centre;
}

void main() {
  float alpha = 1.0;
  // Power-law size distribution. A layer whose seed maps linearly onto the size
  // range puts most of its population at the mean, and a field of same-sized
  // sprites reads as a texture rather than as matter; an exponent above 1 gives
  // the natural shape — mostly fine grain with a scatter of coarse.
  float size = mix(uSize.x, uSize.y, pow(aSeed.x, uSizePow));
  // Independent opacity spread, so density variation does not have to come from
  // size alone. Uncorrelated with the size draw on purpose: real particulate
  // has small dense grains and large thin ones both.
  alpha *= mix(1.0 - uAlphaVar, 1.0, aSeed.y * aSeed.y);
  float t = uVfxTime;
  vec3 pos;

#if VFX_MODE == ${MODE_DRIFT}
  // Camera-anchored volume. Lifting the centre keeps most of the field above
  // the eye rather than buried, which is where airborne ash actually is.
  vec3 centre = uVfxCamPos + vec3(0.0, uBox.y * uBoxLift, 0.0);
  pos = aSeed.xyz * uBox + uVfxWind * t * (0.45 + aSeed.y * 0.9);
  pos += vfxCurl(pos * uTurb.x + vec3(0.0, vfxNoiseT() * 0.06, 0.0), 0.7) * uTurb.y;
  pos.y += sin(t * (0.25 + aSeed.z * 0.6) + aSeed.w * 6.2831) * 0.7;
  pos = vfxWrap(pos, centre);
  float gh = vfxGroundH(pos.xz);
  // LOFT FADE. Suspended particulate is a ground-hugging load: it thins out
  // with altitude and it has to be GONE before it can be seen against the sky
  // dome. Without this the top face of the camera-anchored box is a hard
  // boundary populated with fully-opaque motes, and any one of them that
  // happens to project above the horizon is an isolated bright speck floating
  // in an empty sky with no context — indistinguishable from a stuck pixel, and
  // the reason a mote must never be allowed to survive off the ground plane.
  float clear = gh > VFX_NO_GROUND * 0.5 ? pos.y - gh : pos.y - uVfxCamPos.y + 2.0;
  alpha *= 1.0 - smoothstep(uLoft.x, uLoft.y, clear);
  if (gh > VFX_NO_GROUND * 0.5) {
    // Push out of the ground and thin out as it happens, so a slope reads as
    // motes settling against it rather than as a carpet stamped on the surface.
    float below = (gh + uGroundOff) - pos.y;
    if (below > 0.0) {
      pos.y += below;
      alpha *= exp(-below * 0.30);
    }
  }
  float spin = aSeed.w * 6.2831 + t * uSpin * (aSeed.z - 0.5);
  vec3 vel = uVfxWind * (0.45 + aSeed.y * 0.9);

#elif VFX_MODE == ${MODE_RISE}
  // Column footprint wraps in XZ only; height comes from the ground.
  vec3 centre = vec3(uVfxCamPos.x, 0.0, uVfxCamPos.z);
  vec3 foot = vec3(aSeed.x * uBox.x, 0.0, aSeed.z * uBox.z);
  foot = vfxWrap(foot, centre);
  vec4 g = vfxGround(foot.xz);
  alpha *= smoothstep(0.10, 0.45, g.g);
  float life = uLife * (0.55 + aSeed.w * 0.9);
  float ph = fract(t / life + aSeed.y);
  float age = ph * life;
  pos = foot;
  pos.y = g.r + uGroundOff;
  // Buoyancy minus drag, integrated: rises fast then slows as it cools.
  pos.y += uRise * age + 0.5 * uGravity * age * age;
  pos += vfxCurl(vec3(foot.xz * uTurb.x, vfxNoiseT() * 0.35 + aSeed.w * 11.0).xzy, 0.55)
       * uTurb.y * age;
  // Born hot and small, dying dim and large.
  alpha *= smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(0.45, 1.0, ph));
  size *= 0.55 + ph * 0.9;
  float spin = aSeed.w * 6.2831 + age * uSpin;
  vec3 vel = vec3(0.0, uRise + uGravity * age, 0.0) + uVfxWind * 0.30;

#elif VFX_MODE == ${MODE_FOG}
  vec3 centre = vec3(uVfxCamPos.x, 0.0, uVfxCamPos.z);
  pos = vec3(aSeed.x * uBox.x, 0.0, aSeed.z * uBox.z);
  pos += vec3(uVfxWind.x, 0.0, uVfxWind.z) * t * 0.10 * (0.4 + aSeed.y);
  pos = vfxWrap(pos, centre);
  vec4 g = vfxGround(pos.xz);
  // Fog is a fluid: it fills what is below the level line and nothing above it.
  float depth = uFogLevel - g.r;
  alpha *= smoothstep(0.0, 5.0, depth) * (0.35 + 0.65 * g.b);
  pos.y = g.r + uGroundOff + aSeed.y * min(depth, 6.0) * 0.8;
  pos.x += sin(t * 0.08 + aSeed.w * 6.28) * 3.0;
  pos.z += cos(t * 0.07 + aSeed.z * 6.28) * 3.0;
  if (g.r <= VFX_NO_GROUND * 0.5) alpha = 0.0;
  float spin = aSeed.w * 6.2831 + t * uSpin * 0.05;
  vec3 vel = vec3(uVfxWind.x, 0.0, uVfxWind.z) * 0.10;

#elif VFX_MODE == ${MODE_SPRAY}
  vec3 centre = vec3(uVfxCamPos.x, 0.0, uVfxCamPos.z);
  vec3 foot = vec3(aSeed.x * uBox.x, 0.0, aSeed.z * uBox.z);
  foot = vfxWrap(foot, centre);
  vec4 g = vfxGround(foot.xz);
  // The waterline: ground within a metre of sea level, and not flat — a beach
  // shelf sprays, a tidal flat does not.
  float shore = (1.0 - smoothstep(0.15, 1.6, abs(g.r)))
              * smoothstep(0.995, 0.90, g.b);
  alpha *= shore;
  float life = uLife * (0.6 + aSeed.w * 0.8);
  float ph = fract(t / life + aSeed.y);
  float age = ph * life;
  pos = foot;
  pos.y = max(g.r, 0.0) + uGroundOff;
  vec3 launch = normalize(vec3(aSeed.x - 0.5, 1.6, aSeed.z - 0.5));
  pos += launch * uRise * age;
  pos.y += 0.5 * uGravity * age * age;
  pos.xz += vec2(uVfxWind.x, uVfxWind.z) * age * 0.35;
  alpha *= smoothstep(0.0, 0.1, ph) * (1.0 - smoothstep(0.4, 1.0, ph));
  float spin = aSeed.w * 6.2831 + age * uSpin;
  vec3 vel = launch * uRise + vec3(0.0, uGravity * age, 0.0);

#else
  int ai = int(aSeed.w * float(${ANCHORS}));
  vec4 an = uAnchors[ai];
  alpha *= an.w;
  float life = uLife;
  float ph = fract(t / life + aSeed.y);
  float age = ph * life;
  // Cone: narrow and fast at the base, wide and slow at the top.
  float rad = (0.35 + 3.2 * ph) * (0.35 + 0.65 * aSeed.x);
  float ang = aSeed.z * 6.2831 + age * 7.5 / (0.5 + rad);
  pos = an.xyz + vec3(cos(ang) * rad, uRise * age, sin(ang) * rad);
  pos += vfxCurl(pos * uTurb.x + vec3(0.0, vfxNoiseT() * 0.5, 0.0), 0.6) * uTurb.y * ph;
  float gh2 = vfxGroundH(pos.xz);
  if (gh2 > VFX_NO_GROUND * 0.5) pos.y = max(pos.y, gh2 + 0.05);
  alpha *= smoothstep(0.0, 0.12, ph) * (1.0 - smoothstep(0.55, 1.0, ph));
  size *= 0.5 + 1.6 * ph;
  float spin = aSeed.w * 6.2831 + age * uSpin;
  // Tangential velocity of the helix plus the buoyant rise. The angular rate is
  // 7.5/(0.5+rad) by construction above, so this is the parcel's true velocity
  // and the smear it produces is the rotation you can see.
  float omega = 7.5 / (0.5 + rad);
  vec3 vel = vec3(-sin(ang) * rad * omega, uRise, cos(ang) * rad * omega);
#endif

  // Size and fade are decided on the CENTRE's view distance, so they are
  // constant across the quad and a sprite cannot change footprint class
  // between its own corners.
  float d = max(-(viewMatrix * vec4(pos, 1.0)).z, 0.001);
  // Minimum projected footprint, with the opacity divided by the area gained.
  //
  // THE CLAMP IS A SUB-PIXEL BACKSTOP, NOT A SIZE POLICY. Set high — 4.5 px with
  // an under-compensating exponent — it becomes the thing that DESTROYS
  // perspective: every grain past a couple of metres lands on the floor, so the
  // whole population draws at one screen size at one opacity and the layer
  // reads as a constellation of identical discs pasted over the frame at every
  // depth. That is the single mechanism behind "they are all the same screen
  // size regardless of depth" in five of the six reviews. With the floor down
  // near a pixel and the exponent back at the flux-conserving 2, a clamped
  // grain's opacity falls as 1/d^2 — the inverse-square fade the reviews asked
  // for — and everything above the floor shrinks honestly as worldRadius *
  // projScale / viewZ, which is what a world-sized sprite is supposed to do.
  alpha *= vfxFootprintPxE(size, d, uMinPx, uFootComp);
  // Transmittance of the medium in front of the grain. The volume pass is
  // composited BEFORE this layer, so without this a mote is painted on top of
  // the fog that should already have absorbed it.
  alpha *= vfxMediumT(d);

  vec3 r, u, off;
  float shrink;
  vfxDriftQuad(position.xy, spin, size, d, vel, r, u, off, shrink);
  alpha *= shrink;
  vec3 world = pos + off;

  vec4 mv = viewMatrix * vec4(world, 1.0);
  // Distance fade at the box edge, and a near fade so nothing detonates across
  // the lens as the camera walks through it.
  alpha *= smoothstep(uFadeDist, uFadeDist * 0.55, d);
  // The near fade is per-layer: a 0.1 m mote may come within a metre of the
  // lens, a 12 m sheet may not — at three metres it covers the whole viewport
  // and two hundred of them cost two hundred screens of overdraw.
  alpha *= smoothstep(uNearFade, uNearFade * 4.0, d);

  vUv = uv;
  vWorld = world;
  vRight = r;
  vUpv = u;
  vFade = alpha;
  vViewDist = d;
  vSeed = aSeed.w;
  float pw = aSeed.w * 39.7 + aSeed.z * 11.3;
  vPhase = vec2(cos(pw), sin(pw));

  // Collapse fully-faded instances off-screen: cheaper than rasterising a
  // transparent quad, and it is what keeps the gated layers (embers, spray)
  // nearly free when no lava or shoreline is in range.
  gl_Position = alpha < 0.002 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uAtlas;
uniform vec2  uTile;
uniform vec3  uColor;
uniform float uAlpha;
uniform float uRough;
uniform float uTrans;
uniform float uSoft;
uniform float uEmissive;
uniform float uNormalScale;
uniform float uMedia;
uniform float uLumCap;
uniform float uLumFloor;
uniform float uFlicker;
uniform float uGrainVar;

varying vec2  vUv;
varying vec3  vWorld;
varying vec3  vRight;
varying vec3  vUpv;
varying float vFade;
varying float vViewDist;
varying float vSeed;
varying vec2  vPhase;

${VFX_NOISE}
${AERIAL_GLSL}
${VFX_COMMON}
${VFX_SPRITE}
${VFX_FRAG}

void main() {
  // Inset by the real mip footprint, then re-impose the radial window
  // analytically. The window is what guarantees a soft edge at ANY mip: a
  // heavily reduced tile is close to uniform alpha, and without this the quad
  // itself becomes the silhouette and every small particle reads as a
  // hard-edged rectangle.
  vec4 s = texture2D(uAtlas, vfxTileUV(vUv, uTile));
  // The window is ERODED PER INSTANCE, not a smooth disc: see vfxSpriteWindowR.
  // A baked flipbook cannot fix this, because at the four-to-eight pixels a
  // grain occupies the atlas is mipped down to near-uniform alpha and whatever
  // silhouette it held is gone — which is why every review of iter13 described
  // this layer as bokeh or dirt on the lens.
  float cov = s.a * vfxSpriteWindowR(vUv, vSeed, vPhase);
  if (cov < 0.004) discard;

  vec3 eye = vWorld - uVfxCamPos;
  vec3 V = -normalize(eye);

  float a = cov * uAlpha * vFade * vfxSoft(vWorld, vViewDist, uSoft);
  if (a < 0.0025) discard;

  vec3 col;
  if (uEmissive > 0.5) {
    // Hot particulate: emissive, so only extinction applies. Adding the
    // aerial in-scatter here would double-count it against an ADD blend.
    col = uColor * (0.35 + 0.9 * s.z) * vfxAerialT(vViewDist, eye);
    // Even an emitter has a ceiling — and the ceiling is what preserves the
    // HUE. Past a few times the medium's luminance the tone curve rolls every
    // channel toward its maximum and an ember stops being #ff7a2a and becomes a
    // white dot with an orange fringe, which is the one thing the palette can
    // least afford: ember and bioluminescence are the only saturated colours in
    // the world, and they are worthless desaturated. The floor keeps that
    // ceiling meaningful at night, when the medium is nearly black and a
    // proportional cap alone would extinguish the emitters entirely.
    float capE = uLumCap * max(vfxLum(vfxMedia()), uLumFloor);
    float lE = vfxLum(col);
    if (lE > capE && lE > 1e-6) col *= capE / lE;
    // Combustion flicker, AFTER the ceiling so it is not flattened by it. Two
    // incommensurate rates per particle: a field of emitters that all pulse at
    // one frequency reads as a blinking string of lights, and a field with no
    // variation at all reads as a static texture of dots.
    if (uFlicker > 0.001) {
      float f1 = sin(uVfxTime * (4.3 + vSeed * 9.1) + vSeed * 61.0);
      float f2 = sin(uVfxTime * (1.7 + vSeed * 2.3) + vSeed * 17.0);
      col *= 1.0 - uFlicker * (0.5 - 0.5 * f1 * f2);
    }
  } else {
    // Hemisphere normal over the billboard disc, perturbed by the sprite's
    // tangent-space normal. This is the difference between a lit mote and a
    // white dot.
    vec2 c = vUv * 2.0 - 1.0;
    float z = sqrt(max(0.0, 1.0 - dot(c, c)));
    vec3 tn = s.xyz * 2.0 - 1.0;
    vec3 N = normalize(vRight * (c.x + tn.x * uNormalScale)
                     + vUpv  * (c.y + tn.y * uNormalScale)
                     + V * max(z, 0.25));
    // Coverage doubles as occlusion: the dense middle of a flake is shadowed
    // by its own edges.
    float ao = mix(1.0, 0.55, cov);
    // PER-PARTICLE ALBEDO SPREAD.
    //
    // The BRDF caps a scatterer's radiance at the surrounding medium's own
    // luminance, so a layer drawn with one albedo renders every particle at very
    // nearly the value of the background it is composited over — the alpha
    // blends and the image does not change. That is not a subtle loss: it is why
    // four thousand motes could be live in the ash-storm frame and measure as no
    // particulate at all. Real particulate is a mixture of optical densities, so
    // drawing the albedo per particle puts half the population below the haze
    // and half above it, at an unchanged mean.
    vec3 albedo = uColor * (1.0 - uGrainVar + 2.0 * uGrainVar * vfxHash11(vSeed * 91.7 + 3.1));
    vec3 lit = vfxLitParticle(albedo, N, V, uRough, ao, uTrans, uMedia, uLumCap);
    col = applyAerial(lit, vViewDist, eye);
  }

  // Premultiplied: correct compositing for both blend modes, and it keeps the
  // in-scattered haze weighted by the particle's own coverage.
  gl_FragColor = vec4(col * a, a);
}
`;

export interface LayerOpts {
  mode: number;
  count: number;
  box: THREE.Vector3;
  /** Fraction of the box height that sits below the camera. DRIFT only. */
  boxLift?: number;
  /** View distance at which the layer starts fading in. Defaults to 0.35 m. */
  nearFade?: number;
  size: [number, number];
  tile: number;
  color: THREE.Color;
  alpha: number;
  rough?: number;
  translucency?: number;
  soft?: number;
  emissive?: boolean;
  normalScale?: number;
  /** How much of the surrounding particulate medium's radiance this layer carries. */
  media?: number;
  /**
   * Radiance ceiling as a fraction of the medium's own luminance. Below 1 for
   * anything that must sit INSIDE the haze rather than in front of it; above 1
   * only for near-field grit in a forward-scattering storm and for emitters.
   */
  lumCap?: number;
  /**
   * Floor under the medium luminance the cap is taken against. Emissive layers
   * need one or a proportional ceiling extinguishes them after dark.
   */
  lumFloor?: number;
  /** Floor on the projected sprite diameter, in pixels. Defaults to 5. */
  minPx?: number;
  /**
   * Exponent on the min-footprint energy compensation. 2 conserves flux exactly
   * and is right for scatterers; ~1.2 for small emitters, which must stay above
   * the bloom threshold at distance instead of dimming into a bare pixel.
   */
  footComp?: number;
  /** Exponent on the size draw. >1 biases the population toward the fine end. */
  sizePow?: number;
  /** Peak-to-trough spread of the per-particle opacity draw, 0..1. */
  alphaVar?: number;
  /**
   * Shutter time in seconds for the velocity-aligned smear. 0 (the default)
   * leaves the sprite round and randomly oriented. Anything airborne wants a
   * value here: a drifting mote that does not streak reads as a static speck on
   * the front element rather than as particulate.
   */
  stretch?: number;
  /** Ceiling on that smear, as a multiple of the grain's minor axis. */
  maxElong?: number;
  /**
   * Ground clearance in metres over which the layer thins to nothing:
   * [start, end]. Keeps a camera-anchored field from putting motes against the
   * sky dome. Defaults to effectively off.
   */
  loft?: [number, number];
  /** Emissive-only combustion flicker depth, 0..1. */
  flicker?: number;
  /**
   * Peak-to-trough spread of the per-particle albedo draw, 0..1. Non-emissive
   * layers only. This is what gives a scattering layer internal contrast
   * against the medium whose luminance its ceiling is pinned to.
   */
  grainVar?: number;
  life?: number;
  spin?: number;
  rise?: number;
  gravity?: number;
  turb?: [number, number];
  groundOff?: number;
  fadeDist: number;
  renderOrder: number;
}

/** One instanced, vertex-parametric particle layer. */
export class AmbientLayer {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private max: number;

  constructor(o: LayerOpts, atlas: THREE.Texture) {
    this.max = o.count;
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
    this.geo.instanceCount = o.count;
    // The layer follows the camera, so a bounding volume is meaningless; the
    // wrap and the per-instance fade do the culling instead.
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const anchors: THREE.Vector4[] = [];
    for (let i = 0; i < ANCHORS; i++) anchors.push(new THREE.Vector4(0, 0, 0, 0));

    this.mat = new THREE.ShaderMaterial({
      defines: { VFX_MODE: String(o.mode) },
      uniforms: {
        ...vfxUniforms(),
        ...aerialUniforms(),
        uAtlas: { value: atlas },
        uTile: { value: tileUV(o.tile) },
        uBox: { value: o.box.clone() },
        uBoxLift: { value: o.boxLift ?? 0.3 },
        uSize: { value: new THREE.Vector2(o.size[0], o.size[1]) },
        uColor: { value: o.color.clone() },
        uAlpha: { value: o.alpha },
        uRough: { value: o.rough ?? 0.85 },
        uTrans: { value: o.translucency ?? 1.0 },
        uSoft: { value: o.soft ?? 1.2 },
        uEmissive: { value: o.emissive ? 1 : 0 },
        uNormalScale: { value: o.normalScale ?? 0.6 },
        uMedia: { value: o.media ?? 1.0 },
        uLumCap: { value: o.lumCap ?? 0.85 },
        uLumFloor: { value: o.lumFloor ?? 0.045 },
        uMinPx: { value: o.minPx ?? 5.0 },
        uFootComp: { value: o.footComp ?? 2.0 },
        uSizePow: { value: o.sizePow ?? 1.0 },
        uAlphaVar: { value: o.alphaVar ?? 0.0 },
        uStretch: { value: o.stretch ?? 0.0 },
        uMaxElong: { value: o.maxElong ?? 4.0 },
        uLoft: { value: new THREE.Vector2(o.loft?.[0] ?? 1e5, o.loft?.[1] ?? 2e5) },
        uFlicker: { value: o.flicker ?? 0.0 },
        uGrainVar: { value: o.grainVar ?? 0.0 },
        uLife: { value: o.life ?? 3 },
        uSpin: { value: o.spin ?? 0.4 },
        uRise: { value: o.rise ?? 0 },
        uGravity: { value: o.gravity ?? 0 },
        uTurb: { value: new THREE.Vector2(o.turb?.[0] ?? 0.05, o.turb?.[1] ?? 0.6) },
        uGroundOff: { value: o.groundOff ?? 0.1 },
        uFadeDist: { value: o.fadeDist },
        uNearFade: { value: o.nearFade ?? 0.35 },
        uFogLevel: { value: -1e5 },
        uAnchors: { value: anchors },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      premultipliedAlpha: true,
      blending: o.emissive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.renderOrder;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    this.mesh.name = `vfx:ambient:${o.mode}`;
  }

  /** LOD/weather throttle. Drawing fewer instances is the only cost that matters. */
  setCount(n: number): void {
    const c = Math.min(this.max, Math.max(0, Math.floor(n)));
    this.geo.instanceCount = c;
    this.mesh.visible = c > 0;
  }

  get count(): number {
    return this.geo.instanceCount;
  }

  u(name: string): THREE.IUniform {
    return this.mat.uniforms[name];
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
