import * as THREE from 'three';
import { AERIAL_GLSL, aerialUniforms } from '../sky/Atmosphere';
import type { FloraAtlas } from './Atlas';
import { DITHER_GLSL, HASH_GLSL, SSS_GLSL, WIND_GLSL } from './Glsl';
import { surfaceGlsl } from './Surface';

/**
 * The flora material factory.
 *
 * Every flora surface — canopy, ground cover, impostor — is a patched
 * MeshStandardMaterial. That buys three's shadow receiving, IBL and BRDF for
 * free and, critically, keeps flora on the same lighting model as everything
 * else in the world. What is added on top:
 *
 *  - the shared wind field, applied in world space in the vertex shader;
 *  - subsurface scattering driven by a baked per-vertex thickness times the
 *    atlas translucency channel;
 *  - bioluminescence from the atlas blue channel, gated by a day/night scalar;
 *  - the sky system's aerial perspective, replacing three's fog entirely;
 *  - hashed-alpha LOD cross-fade.
 *
 * Three materials come out of every call: the shaded one, a depth variant so
 * shadow casters bend with exactly the same wind (a canopy whose shadow does not
 * move is worse than no wind at all), and a prepass variant so the deferred
 * G-buffer sees the displaced geometry rather than the rest pose.
 */

export interface FloraUniforms {
  [k: string]: THREE.IUniform;
}

/**
 * three's point-light loop with a zero-contribution early-out, for the flora
 * materials only. Returns replacement text for `#include <lights_fragment_begin>`.
 *
 * A point light is a compile-time entry in NUM_POINT_LIGHTS, so every forward
 * material evaluates a full GGX lobe and a Lambert term for every resident light
 * on every fragment, reached or not. The scene keeps twelve resident on purpose
 * — changing the count recompiles every program in the game — and every one of
 * them has a cutoff `distance` between four and twenty metres, so on the great
 * majority of fragments the whole loop is paid in full to add exactly zero.
 * Priced by paired ablation at medium/1080p: about 3-4% of the frame per
 * resident light (see GLOW_LIGHTS in Flora.ts for the numbers).
 *
 * Exact, not approximate. `getPointLightInfo` sets
 * `light.visible = ( light.color != vec3( 0.0 ) )`, `getDistanceAttenuation`
 * returns exactly zero at and beyond the cutoff, and `RE_Direct_Physical`
 * multiplies both of its terms by `dotNL * directLight.color`. A skipped light
 * therefore contributes bit-exact zero, so there is no range, tier or angle at
 * which the branch changes the image.
 *
 * Deliberately NOT applied to `THREE.ShaderChunk` globally. It would be correct
 * there — the argument does not depend on the material — but the chunk is shared
 * output and architecture, actors and water belong to other owners this round.
 *
 * Duplicated in src/world/TerrainMaterial.ts rather than shared, for the same
 * ownership reason: the two directories do not import from each other, and a
 * twenty-line self-checking helper is a smaller cost than a cross-subsystem
 * dependency. Both copies throw if three's chunk stops having the shape they
 * expect, so a version bump fails loudly at boot rather than silently dropping
 * every point light in the world.
 */
function pointLightEarlyOut(): string {
  const chunk = (THREE.ShaderChunk as unknown as Record<string, string>).lights_fragment_begin;
  const CALL =
    'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
  const head = chunk.indexOf('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )');
  const tail = chunk.indexOf('#if ( NUM_SPOT_LIGHTS > 0 )', head);
  if (head < 0 || tail < 0) throw new Error('flora: lights_fragment_begin has no point-light block');
  const block = chunk.slice(head, tail);
  if (block.split(CALL).length !== 2) {
    throw new Error('flora: point-light block does not contain exactly one RE_Direct call');
  }
  // No declarations inside the guard: `unroll_loop_start` pastes the body n
  // times into ONE scope, so a local here would be redeclared by pass two.
  const guarded = block.replace(CALL, `if ( directLight.visible ) { ${CALL} }`);
  return chunk.slice(0, head) + guarded + chunk.slice(tail);
}

export interface FloraMaterialSet {
  material: THREE.MeshStandardMaterial;
  depth: THREE.MeshDepthMaterial;
  prepass: THREE.ShaderMaterial;
  uniforms: FloraUniforms;
  dispose(): void;
}

export interface FloraMaterialOpts {
  /**
   * Unique per species/LOD. three's default program cache key is
   * onBeforeCompile.toString(), and every material minted by this factory
   * shares that source text — without an explicit key the second species would
   * silently reuse the first species' compiled program, wind body and all.
   */
  cacheKey: string;
  atlas: FloraAtlas;
  /** Declarations placed before main() in the vertex shader. */
  vertPars: string;
  /**
   * Vertex body. Must assign, in world space:
   *   fWorld  (vec3)  final displaced position
   *   fWorldN (vec3)  final normal
   *   fParam  (vec4)  stiffness / thickness / glow / baked AO
   *   fSeed   (float) per-instance seed in [0,1)
   *   fFade   (float) LOD coverage in [0,1]
   *   fTint   (vec3)  per-instance albedo multiplier
   *   fUv     (vec2)  atlas coordinates
   */
  vertBody: string;
  /** Extra uniforms merged into all three materials. */
  extra?: FloraUniforms;
  side?: THREE.Side;
  /** Species albedo tint, and an alternate the per-instance hash blends toward. */
  tint: THREE.Color;
  tintAlt: THREE.Color;
  tintAltAmount: number;
  /** Transmission colour of the flesh, for the subsurface term. */
  sssTint: THREE.Color;
  /** Emissive colour of the bioluminescence. */
  glowColor: THREE.Color;
  /**
   * Second bioluminescence hue. A per-instance hash lerps between the two, so a
   * colony breathes across the band the palette allows (#3fd6c0 -> #8f6bff)
   * instead of every cap in the frame emitting the identical teal. Defaults to
   * glowColor, i.e. no jitter.
   */
  glowColorAlt?: THREE.Color;
  /**
   * Daytime emissive floor, in the same scene-linear units as uGlowNight.
   *
   * The night term alone is correct for a fleshy cap — a parasol underside is
   * the darkest surface in the world and any daytime emissive on it paints mint
   * stripes down the one thing the palette wants dark. But it is WRONG for the
   * glow fungus itself: the art bible names bioluminescence as the only vivid
   * colour permitted, and a dawn frame in which literally nothing is saturated
   * has nothing to anchor the desaturation against. The floor is therefore a
   * per-species property, not a global one: lamps get one, flesh does not.
   */
  glowFloor?: number;
  /**
   * Scales the subsurface term.
   *
   * A six-metre translucent cap and a three-centimetre lichen frond are not the
   * same optical problem. At full strength the transmission tint dominates the
   * shading of any surface whose albedo is low — which is every piece of ground
   * cover — so the cushions came out reading as their SSS colour rather than
   * their own, i.e. as saturated green cones scattered over ochre ash. Ground
   * cover wants a fraction of what a cap wants.
   */
  sssAmount?: number;
  /** Metres of horizontal sway per unit of wind load, at unit instance scale. */
  windAmp: number;
  /** Nominal plant height, for the arc-length correction on a bent stalk. */
  plantHeight: number;
  /** Per-instance lean, as a slope added over the plant's height. */
  lean: number;
  /**
   * 'full' writes normals and velocity into the deferred G-buffer. 'none'
   * declares a prepass material that draws nothing, which is how a mesh opts
   * OUT — the render pipeline replaces any material it does not recognise with
   * a generic override that knows nothing about our attributes, so "no prepass
   * material" is not the same as "skip me".
   */
  prepassMode?: 'full' | 'none';
  /**
   * Where the LOD/coverage dissolve is resolved.
   *
   * 'fragment' is the hashed-alpha stipple: the right answer for the canopy,
   * where a single instance covers thousands of pixels and has to hand over to
   * its next LOD without either popping or double-drawing.
   *
   * 'vertex' means the caller has already resolved coverage stochastically per
   * INSTANCE and no per-pixel dissolve is wanted. That is the right answer for
   * ground cover, where a dissolving card is two pixels across so the two are
   * visually the same thing — and where it matters enormously, because omitting
   * the stipple is what leaves the compiled fragment shader with no discard in
   * it. A shader that may discard cannot have its depth test hoisted ahead of
   * it, and the one surface in this world with genuinely severe overdraw is a
   * grass field seen along the ground. Getting early-Z back on 100k blades is
   * worth far more than the dissolve costs.
   */
  ditherMode?: 'fragment' | 'vertex';
  /**
   * Enable the world-space surface layer (see Surface.ts).
   *
   * Opt-in rather than always-on, and the reason is the grass. Ground cover is
   * 100k instances of a three-centimetre card: there is no metre-scale surface
   * to give it, its band is rejected by the function's first test anyway, and
   * every instruction in that shader is multiplied by the one genuinely
   * overdraw-bound surface in the world. Canopy species and the ground fungus
   * take it; blades and lichen do not, and their program does not even contain
   * the code.
   */
  surface?: boolean;
  /**
   * Distance in metres past which the surface layer is not evaluated at all.
   *
   * Set it from the size of the plant, not from taste: the layer's coarsest term
   * has a 1.6 m wavelength, so it stops being resolvable once the plant is a
   * couple of dozen pixels, and past that the noise is pure cost. A 22 m parasol
   * earns it out to the whole of its mesh ladder; a 40 cm ground mushroom does
   * not earn it past thirty.
   *
   * METRES, and it now really is metres. The number is multiplied by uSurfPx —
   * the live metres-of-footprint-per-metre-of-distance for the current camera and
   * viewport — inside the shader, replacing a baked constant that was out by more
   * than a factor of two and was silently enforcing every range in the subsystem
   * at 0.4 of its nominal value. See the head of Surface.ts.
   */
  surfaceRange?: number;
  /**
   * Compile the reduced far variant of the surface layer.
   *
   * The two fine lattices are dropped at compile time and only the coarse (1.6 m)
   * lattice and the analytic lathe-space terms — sectors, growth rings, the
   * margin band, the flutes, the primary lamellae — remain. That is the right
   * trade for a mesh LOD that starts at a hundred metres, where a 43 cm feature
   * is a third of a pixel: it is most of the visible benefit for a fraction of
   * the instruction count, and it is what makes running the layer on LOD1 at all
   * affordable. Running the FULL layer there was measured at 23 -> 12 fps.
   */
  surfaceFar?: boolean;
  /**
   * 1 for a species whose cap band sweeps the meridian of a closed dome rather
   * than the radius of a disc — the bulb fungus and nothing else at present.
   *
   * Everything concentric in the surface layer (growth ridges, radial fibre) is
   * written against the parasol's parameterisation, where the cap band IS the
   * radius. Replaying it on a puffball turns a growth ring into a contour line on
   * a dome, and contours on a dome converge on the pole: the coast blocker's
   * "concentric whorl that reads as a fingerprint". A dome gets a world-space
   * verruca and lichen field instead. See Surface.ts.
   */
  capDome?: boolean;
  /**
   * How far a per-instance hue draw is allowed to move the species tint.
   *
   * 0 keeps every individual on the species hue, which is what a field of grass
   * wants. On the parasols it is the difference between one flat ochre repeated
   * forty times and a stand in which some caps are rust, some ochre and some
   * grey-green — the only hue variation the palette permits outside
   * bioluminescence and lava, and the one the review asked for by name.
   */
  hueJitter?: number;
}

/**
 * G-buffer prepass fragment.
 *
 * Deliberately a local copy rather than an import of the render subsystem's
 * shader: the only thing flora must agree with is the *layout* (attachment 0 =
 * view normal + linear view depth, attachment 1 = motion vector in UV units with
 * alpha as the coverage flag), and duplicating fifteen lines is cheaper than
 * coupling to another subsystem's string constants. A GLSL3 ShaderMaterial gets
 * no implicit gl_FragColor from three, so both attachments are declared here.
 */
const FLORA_PREPASS_FRAG = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 gNormalDepth;
layout(location = 1) out vec4 gVelocity;

in vec3 vViewNormal;
in float vViewDepth;
in vec4 vCurClip;
in vec4 vPrevClip;
in float vFadeP;
in float vSeedP;

${HASH_GLSL}
${DITHER_GLSL}

void main() {
  floraDither(vFadeP, vSeedP);
  vec3 n = normalize(vViewNormal);
  if (!gl_FrontFacing) n = -n;
  gNormalDepth = vec4(n, vViewDepth);
  vec2 cur = vCurClip.xy / max(abs(vCurClip.w), 1e-6) * sign(vCurClip.w);
  vec2 prv = vPrevClip.xy / max(abs(vPrevClip.w), 1e-6) * sign(vPrevClip.w);
  gVelocity = vec4((cur - prv) * 0.5, 0.0, 1.0);
}
`;

const DECL = /* glsl */ `
  vec3  fWorld  = vec3(0.0);
  vec3  fWorldN = vec3(0.0, 1.0, 0.0);
  vec4  fParam  = vec4(0.0, 0.0, 0.0, 1.0);
  float fSeed   = 0.0;
  float fFade   = 1.0;
  vec3  fTint   = vec3(1.0);
  vec2  fUv     = vec2(0.0);
`;

export function createFloraMaterials(opts: FloraMaterialOpts): FloraMaterialSet {
  const aerial = aerialUniforms();
  const dissolve = (opts.ditherMode ?? 'fragment') === 'fragment';
  const surf = opts.surface === true;
  const surfFar = opts.surfaceFar === true;
  /**
   * The range, in METRES, multiplied in the shader by the live footprint scale.
   *
   * What used to be here was `range / 1740`, justified as "1920 px across a
   * 62-degree horizontal field". The camera is a 65-degree VERTICAL field on a
   * 16:9 frame — 97 degrees horizontal — so the correct figure at 1080p is
   * (1080/2)/tan(32.5 deg) = 848 px per unit of distance, i.e. one pixel covers
   * d/848 metres. On top of that the shader compares against fwidth(), which is
   * |dFdx| + |dFdy| and therefore runs about 1.2x the bare footprint. The two
   * errors compound in the same direction: every range in this subsystem was
   * being enforced at roughly 0.4 of its stated value, which is why a parasol
   * declaring 130 m lost the layer at 55 m and read as clay everywhere beyond.
   *
   * uSurfPx carries the whole conversion and is recomputed from ctx.camera and
   * ctx.size every frame, so this is now correct at 4K, under a different field
   * of view, and after a resize — none of which a baked literal could be.
   */
  const surfRange = (opts.surfaceRange ?? 120).toFixed(1);
  /**
   * The damp foot band, converted from metres into this species' own `along`
   * units, because `along` is normalised by the plant's height and the ash that
   * stains a stipe is not. 0.55 m is the depth of ash that packs against a base;
   * the clamp keeps a 15 cm mushroom from having no contact at all and a 22 m
   * parasol from being stained to its neck.
   */
  const footBand = Math.max(0.05, Math.min(0.30, 0.55 / Math.max(0.2, opts.plantHeight))).toFixed(4);
  const capDome = opts.capDome === true ? '1.0' : '0.0';
  /** Injected after three's alpha test — or not at all, which is the point. */
  const ditherCall = dissolve ? '\n  floraDither(vFFade, vFSeed);' : '';
  const ditherDecl = dissolve ? `${HASH_GLSL}\n${DITHER_GLSL}\n` : '';

  const shared: FloraUniforms = {
    uArm: { value: opts.atlas.arm },
    uWindDir: { value: new THREE.Vector2(1, 0) },
    uWindSpeed: { value: 4 },
    uWindTime: { value: 0 },
    uSunDirW: { value: new THREE.Vector3(0, 1, 0) },
    uSunRadW: { value: new THREE.Color(1, 1, 1) },
    uSkyRadW: { value: new THREE.Color(0.1, 0.12, 0.18) },
    uSssTint: { value: opts.sssTint.clone() },
    uSssAmount: { value: opts.sssAmount ?? 1 },
    uGlowColor: { value: opts.glowColor.clone() },
    uGlowColorAlt: { value: (opts.glowColorAlt ?? opts.glowColor).clone() },
    uGlowFloor: { value: opts.glowFloor ?? 0 },
    uGlowNight: { value: 0.06 },
    uFloraTime: { value: 0 },
    uDitherPhase: { value: 0 },
    uTint: { value: opts.tint.clone() },
    uTintAlt: { value: opts.tintAlt.clone() },
    uTintAltAmt: { value: opts.tintAltAmount },
    uHueJit: { value: opts.hueJitter ?? 0 },
    /**
     * Metres of pixel footprint per metre of distance, times the fwidth factor.
     *
     * Written every frame by FloraSystem.syncEnvironment from the camera's field
     * of view and the post-DPR viewport height. A surfaceRange of 300 becomes a
     * threshold of 300 * uSurfPx, and a fragment 300 m away has fwidth() of about
     * that, so the comparison in the shader is a comparison in metres.
     */
    uSurfPx: { value: 1.47e-3 },
    uWindAmp: { value: opts.windAmp },
    uPlantH: { value: opts.plantHeight },
    uLean: { value: opts.lean },
    /**
     * 0 in the colour and prepass programs, 1 in the depth one.
     *
     * The vertex body is a single string shared by all three programs, so the
     * only way it can know which pass it is in is a uniform — and the only way to
     * give one program a different value is to hand it its own IUniform object
     * after the shared set has been bound. That is done in the depth material's
     * onBeforeCompile below. Ground cover uses it to cut the shadow-caster ring
     * down to the near field; anything that ignores it costs one dead uniform.
     */
    uShadowPass: { value: 0 },
    ...(opts.extra ?? {}),
  };

  const bindAll = (target: FloraUniforms): void => {
    for (const k in shared) target[k] = shared[k];
    for (const k in aerial) if (!(k in target)) target[k] = aerial[k];
  };

  const VERT_HEAD = `
${HASH_GLSL}
${WIND_GLSL}
uniform float uWindAmp;
uniform float uPlantH;
uniform float uLean;
uniform float uShadowPass;
uniform vec3  uTint;
uniform vec3  uTintAlt;
uniform float uTintAltAmt;
uniform float uHueJit;
attribute vec4 aParam;
varying vec3  vFWorld;
varying vec3  vFNormalW;
varying vec4  vFParam;
varying float vFFade;
varying float vFSeed;
varying vec3  vFTint;
${opts.vertPars}
`;

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    side: opts.side ?? THREE.DoubleSide,
    map: opts.atlas.albedo,
    normalMap: opts.atlas.normal,
    dithering: true,
  });
  material.normalScale.set(1, 1);
  material.customProgramCacheKey = () => opts.cacheKey;

  material.onBeforeCompile = (shader) => {
    bindAll(shader.uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${VERT_HEAD}\nvoid main() {\n${DECL}\n${opts.vertBody}\n
  vFWorld = fWorld;
  vFNormalW = fWorldN;
  vFParam = fParam;
  vFFade = fFade;
  vFSeed = fSeed;
  vFTint = fTint;
`)
      // The atlas coordinate is authored by the body, not by three's uv chunk:
      // ground cover synthesises its uv from the blade parameterisation and has
      // no uv attribute worth the bandwidth.
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = fUv;\n#endif\n#ifdef USE_NORMALMAP\n  vNormalMapUv = fUv;\n#endif`)
      .replace(
        '#include <defaultnormal_vertex>',
        `vec3 transformedNormal = normalize((viewMatrix * vec4(fWorldN, 0.0)).xyz);
        #ifdef FLIP_SIDED
          transformedNormal = -transformedNormal;
        #endif`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = viewMatrix * vec4(fWorld, 1.0);
         gl_Position = projectionMatrix * mvPosition;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
           vec4 worldPosition = vec4(fWorld, 1.0);
         #endif`,
      );

    shader.fragmentShader = shader.fragmentShader
      // See pointLightEarlyOut. Bit-exact; it skips a BRDF that adds zero.
      .replace('#include <lights_fragment_begin>', pointLightEarlyOut())
      .replace(
        'void main() {',
        `${HASH_GLSL}
${SSS_GLSL}
${surf ? surfaceGlsl(surfFar) : ''}
${dissolve ? DITHER_GLSL : ''}
${AERIAL_GLSL}
uniform sampler2D uArm;
uniform float uSurfPx;
uniform vec3  uGlowColor;
uniform vec3  uGlowColorAlt;
uniform float uGlowFloor;
uniform float uGlowNight;
uniform float uSssAmount;
uniform float uFloraTime;
varying vec3  vFWorld;
varying vec3  vFNormalW;
varying vec4  vFParam;
varying float vFFade;
varying float vFSeed;
varying vec3  vFTint;
void main() {`,
      )
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>${ditherCall}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         vec4 fArm = texture2D(uArm, vMapUv);
         diffuseColor.rgb *= vFTint;
         /**
          * The world-space surface layer, and where it has to sit.
          *
          * Before the contact multiply, because its occlusion is real geometric
          * occlusion (a blister's flank, a lamella's valley, a growth ring's
          * groove) and belongs in the same product as the atlas's; and before
          * the roughness and normal chunks, which read the two outs it leaves
          * behind. See Surface.ts for what it is and why the atlas cannot do it.
          */
         vec3  fSurfN = vec3(0.0);
         float fSurfR = 0.0;
         float fSurfO = 1.0;
${surf ? `         floraSurface(vFWorld, normalize(vFNormalW), vMapUv, vFParam.x, ${surfRange} * uSurfPx,
                      vFSeed, ${footBand}, ${capDome},
                      diffuseColor.rgb, fSurfR, fSurfO, fSurfN);` : ''}
         float fOcc = clamp(fArm.r * fSurfO * vFParam.w, 0.0, 1.0);
         /**
          * Contact darkening.
          *
          * The baked occlusion channel used to reach only the indirect term,
          * which on a sunlit slope is a fifth of the light — so the root of
          * every blade and the foot of every stalk stayed as bright as its tip
          * and the whole field read as decals laid on the ground. Occlusion at
          * this scale (a blade in its own tuft, a stalk in its own flare) is
          * geometry the shading model cannot resolve, and folding it into the
          * albedo is the standard and correct stand-in. Partial, so it deepens
          * contact without flattening the surface into a painted gradient.
          */
         diffuseColor.rgb *= mix(1.0, fOcc, 0.62);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        'float roughnessFactor = clamp(roughness * fArm.g + fSurfR, 0.045, 1.0);',
      )
      // Nothing in flora is metallic; the slot carries the glow mask instead.
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace(
        '#include <emissivemap_fragment>',
        /**
         * Bioluminescence, as an HDR value with a ceiling.
         *
         * uGlowColor is normalised to its brightest channel before the
         * intensity is applied. Without that the emissive is a colour times a
         * gain, so the green channel — 13x the red for #3fd6c0 — reaches the
         * tone curve's shoulder while red and blue are still in its linear
         * stretch. Every cap then loses all its green modulation while red and
         * blue keep theirs, which is precisely the per-channel clipping the
         * review saw as a yellow-green top edge and a cyan bottom edge on the
         * same four-pixel cap. Separating chroma from intensity means the whole
         * triple rolls off together and the caps stay the bible's teal.
         *
         * The ceiling keeps the peak inside the range bloom is meant to bloom
         * FROM rather than the range it clips at.
         */
        `float fGlow = fArm.b * vFParam.z;
         float fPulse = 0.70 + 0.30 * sin(uFloraTime * 0.65 + vFSeed * 37.0 + vFWorld.y * 0.35);
         /**
          * Per-instance hue AND intensity, so a colony breathes.
          *
          * One emissive colour times one global gain gives a field of identical
          * lamps, which is what the review read at +4.5EV: "unmistakably a single
          * mesh instanced a few thousand times". The hue lerp walks the band the
          * palette allows and nothing outside it; the intensity draw is a
          * separate hash so a bright violet and a dim teal can stand next to each
          * other.
          */
         float fGh = fHash11(vFSeed * 23.71 + 1.93);
         vec3  fGlowHue = mix(uGlowColor, uGlowColorAlt, fGh);
         vec3  fGlowChroma = fGlowHue / max(max(fGlowHue.r, fGlowHue.g), max(fGlowHue.b, 1e-4));
         float fGlowVar = 0.55 + 0.90 * fHash11(vFSeed * 61.3 + 7.1);
         /**
          * The daytime floor is a NEAR-FIELD accent and has to die with distance.
          *
          * Bioluminescence by day is worth having because it puts the palette's
          * one permitted saturation into the near ground. Fifty metres out it
          * cannot compete with the sky and it stops reading as a glow at all: on
          * the first build with a floor, the rim glow mask on a distant fungus
          * cluster resolved to a single-pixel saturated cyan OUTLINE traced round
          * its cap, sitting on a hillside otherwise deep in aerial perspective —
          * a wireframe, not a light. Night is exempt: after dark these really are
          * the light sources and they must read across the whole valley.
          */
         float fGlowD = length(vFWorld - cameraPosition);
         float fGlowNear = 1.0 - smoothstep(35.0, 110.0, fGlowD);
         // Lamps carry a daytime floor; flesh does not. See FloraMaterialOpts.
         float fGlowGain = max(uGlowNight, uGlowFloor * fGlowNear);
         totalEmissiveRadiance += fGlowChroma * min(fGlow * fPulse * fGlowVar * fGlowGain, 1.15);`,
      )
      .replace(
        '#include <aomap_fragment>',
        `float fAO = fOcc;
         reflectedLight.indirectDiffuse *= fAO;
         #if defined( USE_ENVMAP ) && defined( STANDARD )
           float fDotNV = saturate(dot(geometryNormal, geometryViewDir));
           reflectedLight.indirectSpecular *= computeSpecularOcclusion(fDotNV, fAO, material.roughness);
         #endif`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#ifdef OPAQUE
           diffuseColor.a = 1.0;
         #endif
         vec3 fN = normalize(vFNormalW);
         /**
          * Transmission is coloured by the FLESH, not by the reflectance.
          *
          * The term was floraSSS(...) * diffuseColor.rgb, which attenuates it
          * by the surface albedo — about 0.15 linear on an ash-ochre cap — on
          * top of the transmission tint (0.3) and the thickness (0.8). Three
          * multiplicative attenuations of an effect that is meant to be the
          * loudest thing on the plant. It is also wrong: light that has
          * travelled through a centimetre of cap is coloured by what it passed
          * THROUGH, which is what uSssTint already encodes, not by what the
          * front face happens to reflect. The albedo survives only as a weak
          * modulation, so a dark instance still transmits less than a pale one.
          */
         /**
          * Modulated by the INSTANCE's reflectance, not by the TEXEL's occlusion.
          *
          * The stated intent of this factor is that a dark instance should
          * transmit less than a pale one. That is a property of the plant, and
          * the plant is vFTint. It was reading diffuseColor, which by this point
          * has the atlas occlusion folded into it — so on a cap underside the
          * factor was the gill comb, and it was the second of the two things
          * amplitude-modulating a near-monochromatic red at lamella frequency.
          * See gillSample() in Atlas.ts for the measurement and the first.
          *
          * Note that killing the modulation costs the gills nothing they should
          * have had: their contrast comes from the occlusion and the normal map,
          * both untouched, acting on the REFLECTED light. What goes away is a
          * saturated transmission that was pulsing in step with them and dragging
          * the hue along with it.
          *
          * The constants are not a guess. vFTint is an unoccluded reflectance,
          * several times the value the occluded texel carried, so the pair was
          * fitted against the measured mean: differencing captures against an
          * SSS-off build puts the transmitted red on the gills at 0.051 linear at
          * dawn and 0.039 in the vale, and (0.30, 0.26) lands within about a
          * tenth of both. The mean strength of the effect is preserved — the
          * backlit cap the art bible asks for is untouched — and only the
          * lamella-frequency modulation of it goes away.
          */
         /**
          * Transmission cannot exceed absorption, and that is what was wrong.
          *
          * floraSSS is a purely ADDITIVE term built out of uSunRadW and
          * uSkyRadW: nothing in it answers to the surface's own reflectance, and
          * nothing bounds it against the diffuse response of the same pixel. On
          * a well-lit frame that is invisible, because the diffuse dominates. On
          * a night frame the diffuse collapses to near zero while the
          * transmission keeps its full ambient pedestal — and because the term
          * peaks on NEGATIVE N.L, it peaks exactly on the geometry that faces
          * away from the light, i.e. on the silhouette. The result is the
          * review's blocker: a plant drawn as green OUTLINES with hollow black
          * interiors, which reads as a debug wireframe.
          *
          * Two bounds, and both are physics rather than taste:
          *
          *  - a texel that reflects almost nothing also transmits almost
          *    nothing. Light that gets through a membrane is light that was not
          *    absorbed, so the transmitted radiance has to fall with the
          *    albedo. fTr is the texel's own reflectance, gently curved so a
          *    mid-tone cap loses little and a black texel loses everything.
          *  - the transmitted radiance cannot outrun the reflected radiance by
          *    an unbounded factor. A backlit cap legitimately reads several
          *    times brighter than its front-lit shading, which is the whole
          *    point of the effect, so the ceiling is generous — six times the
          *    reflected light plus a pedestal that SCALES WITH THE AMBIENT. The
          *    pedestal has to scale: a fixed one either strangles a backlit blade
          *    at noon or lets the night wireframe straight back through. Tied to
          *    uSkyRadW it is 0.35 of a bright sky (which forbids nothing real) and
          *    a fiftieth of that after dark (which forbids exactly the case the
          *    review measured).
          */
         float fTr = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
         fTr = smoothstep(0.0, 0.085, fTr);
         vec3 fSSS = floraSSS(fN, vFWorld, vFParam.y * fArm.a)
                   * (0.30 + 0.26 * vFTint) * (uSssAmount * fTr);
         // 6x -> 9x of the reflected radiance. The ceiling exists to stop the
         // transmission being drawn where there is no reflected light to bound
         // it — the night silhouette-wireframe failure — and that job is done by
         // the PEDESTAL, which is unchanged and is what scales with the ambient.
         // The multiplier only decides how much brighter than its own front face
         // a backlit cap is allowed to be, and six was clipping the effect on the
         // one geometry it exists for: a cap crown whose front face is in its own
         // shadow, which is by definition the darkest reflected value on the
         // plant. Nine is still a bound a real membrane does not reach.
         /**
          * The ceiling, and why a ceiling written against outgoingLight ALONE is
          * the reason nobody has ever mentioned seeing this effect.
          *
          * outgoingLight on the one geometry subsurface scattering exists for — a
          * cap crown with a low sun behind it — is the crown's own SHADOWED front
          * face, i.e. the darkest reflected value anywhere on the plant. So the
          * bound tightens by an order of magnitude at exactly the moment the
          * effect should be at its loudest, and a term that was carefully widened,
          * raised and re-lobed upstream was being clipped straight back down here.
          * Raising the multiplier does not fix it either: 9x of nearly nothing is
          * nearly nothing, and 30x of a lit surface would be a blowout.
          *
          * The physical bound is against what ARRIVES, not against what the front
          * face happens to reflect. A membrane cannot transmit more than the light
          * incident on its far side, and 45% of it through a centimetre of fungal
          * flesh is already generous. uSunRadW is the same radiance every other
          * system in the frame is lit by, so this cannot drift from the rest of
          * the lighting; and it collapses on its own after dark, which is what
          * keeps the night silhouette-wireframe failure closed — at 23:24 the key
          * light is a moon whose radiance is a fiftieth of the sun's, so the
          * max() below simply falls through to the old outgoingLight branch.
          */
         // 0.45 -> 0.62 of the incident sun. The bound is against what ARRIVES,
         // and it was the thing actually deciding how bright a backlit cap gets
         // on every canonical vantage — raising the lobe upstream without raising
         // this simply moved the clip. 62% of the incident radiance through a
         // centimetre of fungal flesh is still a bound a real membrane does not
         // reach, and because it is written against uSunRadW it collapses on its
         // own after dark, which is what keeps the night wireframe closed.
         fSSS = min(fSSS, max(outgoingLight * 9.0, uSunRadW * uSssTint * 0.62)
                          + uSkyRadW * 0.35);
         /**
          * The sky floor, and it is the other half of the outline blocker.
          *
          * Clamping the rim term stops a leaf being drawn as an outline; it does
          * not stop the INTERIOR being drawn as a hole. Every flora surface sees
          * at least a sliver of the dome — an occluded one sees less, which is
          * what fOcc is for — and a plant whose lamina renders at literally zero
          * has no shape for the silhouette to be the silhouette OF. Read off the
          * atmosphere's own ambient estimate, the same value the transmission and
          * the terrain use, so it cannot drift from the rest of the frame's
          * lighting.
          */
         vec3 fLit = outgoingLight + fSSS + uSkyRadW * (0.18 * fOcc) * diffuseColor.rgb;
         vec3 fEye = vFWorld - cameraPosition;
         gl_FragColor = vec4(applyAerial(fLit, length(fEye), fEye), diffuseColor.a);`,
      );

    if (surf) {
      /**
       * The surface layer's relief, folded in AFTER the atlas normal map.
       *
       * Order matters and this is the correct one: the atlas supplies the
       * lathe-space micro-relief (fibre, lamella, annulus) and this supplies the
       * decimetre-and-up world-space relief (blisters, pores, growth rings), so
       * the two are different frequency bands of the same surface and simply
       * add. Doing it here rather than perturbing the tangent frame keeps it out
       * of every shader that does not want it, and the transform is a rotation,
       * so a world-space tangential offset stays tangential in view space.
       */
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         normal = normalize(normal + (viewMatrix * vec4(fSurfN, 0.0)).xyz);`,
      );
    }
  };

  // ---- shadow caster ------------------------------------------------------
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.side = opts.side ?? THREE.DoubleSide;
  depth.customProgramCacheKey = () => `${opts.cacheKey}:depth`;
  depth.onBeforeCompile = (shader) => {
    bindAll(shader.uniforms);
    // Its OWN object, replacing the shared reference bindAll just installed —
    // this is the one program that must see the flag set.
    shader.uniforms.uShadowPass = { value: 1 };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${VERT_HEAD}\nvoid main() {\n${DECL}\n${opts.vertBody}\n  vFFade = fFade;\n  vFSeed = fSeed;`)
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = viewMatrix * vec4(fWorld, 1.0);
         gl_Position = projectionMatrix * mvPosition;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
           vec4 worldPosition = vec4(fWorld, 1.0);
         #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `${ditherDecl}varying float vFFade;\nvarying float vFSeed;\nvoid main() {`,
      )
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>${ditherCall}`);
  };

  // ---- depth/normal/velocity prepass --------------------------------------
  const prepassUniforms: FloraUniforms = {
    uCurrVP: { value: new THREE.Matrix4() },
    uPrevVP: { value: new THREE.Matrix4() },
  };
  bindAll(prepassUniforms);

  /**
   * The opt-out prepass: a program that pushes every vertex outside the clip
   * volume and writes nothing. Declaring *some* prepass material is how a mesh
   * tells the render pipeline "do not substitute your generic override on me";
   * this one additionally says "and draw nothing at all".
   */
  const nullPrepass = (): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: 'void main() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }',
      fragmentShader: 'precision highp float;\nvoid main() { discard; }',
      colorWrite: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });

  const fullPrepass = (): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: prepassUniforms,
      side: opts.side ?? THREE.DoubleSide,
      blending: THREE.NoBlending,
      toneMapped: false,
      vertexShader: `
${VERT_HEAD}
uniform mat4 uCurrVP;
uniform mat4 uPrevVP;
out vec3 vViewNormal;
out float vViewDepth;
out vec4 vCurClip;
out vec4 vPrevClip;
out float vFadeP;
out float vSeedP;
void main() {
${DECL}
${opts.vertBody}
  vec4 mv = viewMatrix * vec4(fWorld, 1.0);
  gl_Position = projectionMatrix * mv;
  vViewNormal = (viewMatrix * vec4(fWorldN, 0.0)).xyz;
  vViewDepth = -mv.z;
  // Flora is static in world space; everything that moves is the wind, and the
  // wind is already inside fWorld. Feeding the same point through the previous
  // frame's view-projection therefore gives the correct camera motion plus the
  // (small, real) foliage motion in one term.
  vCurClip = uCurrVP * vec4(fWorld, 1.0);
  vPrevClip = uPrevVP * vec4(fWorld, 1.0);
  vFadeP = fFade;
  vSeedP = fSeed;
  vFWorld = fWorld;
  vFNormalW = fWorldN;
  vFParam = fParam;
  vFFade = fFade;
  vFSeed = fSeed;
  vFTint = fTint;
}
`,
      fragmentShader: FLORA_PREPASS_FRAG,
    });

  const prepass = opts.prepassMode === 'none' ? nullPrepass() : fullPrepass();

  return {
    material,
    depth,
    prepass,
    uniforms: shared,
    dispose(): void {
      material.dispose();
      depth.dispose();
      prepass.dispose();
    },
  };
}
