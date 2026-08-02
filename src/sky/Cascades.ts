import * as THREE from 'three';
import {
  CASCADE_BLEND,
  CASCADE_CASTER_DEPTH,
  CASCADE_LAMBDA,
  CASCADE_PENUMBRA,
  SHADOW_DISTANCE,
  SHADOW_NEAR,
} from './Constants';

/**
 * ASHLANDS — cascaded shadow maps.
 *
 * ## Why this exists
 *
 * A single orthographic shadow frustum cannot serve a 4 km world. Sized to
 * cover the view it resolves nothing; sized to resolve a chitin roof edge it
 * covers thirty metres and every shot reads as flat clay. The previous build
 * had the second failure — a +/-160 m box with far = 900 on a scene whose
 * visible depth is kilometres — which is why eight independent reviewers
 * counted zero cast shadows in every frame.
 *
 * ## Shape of the implementation
 *
 * three has no cascade support, but it does have everything cascades are made
 * of: N directional lights, each with its own shadow camera, its own depth
 * texture, its own per-light bias uniforms, its own frustum culling of the
 * caster set, and its own `autoUpdate`/`needsUpdate` pair. So a cascade here is
 * literally a `DirectionalLight`, and the only thing that has to be added is
 * (a) the fitting, which is this file, and (b) per-pixel cascade selection,
 * which is the ShaderChunk patch at the bottom of this file.
 *
 * Doing it this way — rather than rendering a private cascade atlas — is what
 * keeps foliage and terrain casting correctly: three's shadow pass already
 * routes every mesh through its own `customDepthMaterial`, so the flora wind
 * displacement and the terrain's procedural vertex path shadow exactly the
 * silhouette they shade. A bespoke atlas pass would have had to re-derive all
 * of that and would have got it wrong.
 *
 * ## Stability
 *
 * Each cascade is fitted to the *bounding sphere* of its slice of the view
 * frustum, not to the slice's corners. A sphere is rotation-invariant, so the
 * ortho box keeps a constant size as the camera turns; a corner fit breathes
 * with yaw and makes every shadow edge pulse. The sphere centre is then snapped
 * to whole shadow texels in light space, which is what stops the edges crawling
 * as the camera translates. Both are required — either one alone still
 * shimmers.
 */

/** One cascade: a light, its shadow, and the numbers the fit derived. */
interface Cascade {
  readonly light: THREE.DirectionalLight;
  /** How many frames between refits. 1 = every frame. */
  interval: number;
  /** Ortho half-extent in metres, from the last fit. */
  radius: number;
  /** World metres per shadow texel, from the last fit. */
  texel: number;
}

export interface CascadeTierCfg {
  /** Number of cascades. 1 degenerates to a single fitted shadow, which still works. */
  readonly count: number;
  /** Shadow map edge in texels, per cascade, nearest first. */
  readonly sizes: readonly number[];
  /** Refit interval in frames, per cascade, nearest first. */
  readonly intervals: readonly number[];
}

/**
 * Cascade budget per tier.
 *
 * `intervals` is how many frames a cascade may go without being refitted and
 * re-rendered, and it is where most of the cost control lives. The outermost
 * cascade's frustum contains very nearly the whole visible world, so its depth
 * pass is a second full scene traversal; at an interval of four it costs a
 * quarter of one. Staleness there is invisible — its texels are metres across,
 * so several frames of camera motion is a fraction of one — while cascade 0,
 * the one carrying ground contact, is never allowed to lag at all.
 *
 * `high` runs three rather than four. The fourth cascade bought texel density
 * in a distance band where aerial perspective has already taken the contrast
 * out of the shadow, and cost a whole extra caster traversal to do it.
 */
export const CASCADE_TIERS: Record<'low' | 'medium' | 'high' | 'ultra', CascadeTierCfg> = {
  low: { count: 2, sizes: [1024, 1024], intervals: [1, 3] },
  medium: { count: 3, sizes: [1536, 1024, 1024], intervals: [1, 2, 5] },
  high: { count: 3, sizes: [2048, 2048, 1536], intervals: [1, 2, 4] },
  ultra: { count: 4, sizes: [2048, 2048, 2048, 1536], intervals: [1, 1, 2, 3] },
};

export class ShadowCascades {
  private readonly cascades: Cascade[] = [];
  /** View-space split distances; length is count + 1. */
  private readonly splits: number[] = [];
  private cfg: CascadeTierCfg = CASCADE_TIERS.high;
  private scene: THREE.Scene | null = null;
  private lastAspect = 0;
  private lastFov = 0;

  private readonly ax = new THREE.Vector3();
  private readonly ay = new THREE.Vector3();
  private readonly az = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly centre = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();

  constructor(tier: keyof typeof CASCADE_TIERS = 'high') {
    this.cfg = CASCADE_TIERS[tier];
    this.build();
  }

  /**
   * The light every other system means when it says "the sun". Carries the full
   * sun colour and intensity; so do the rest, but only this one's contribution
   * is evaluated (see the shader patch — the others exist to own shadow maps).
   */
  get key(): THREE.DirectionalLight {
    return this.cascades[0].light;
  }

  get lights(): THREE.DirectionalLight[] {
    return this.cascades.map((c) => c.light);
  }

  get count(): number {
    return this.cascades.length;
  }

  /** Shadow map + matrix for a cascade, for consumers outside the lit pass. */
  depthTexture(i: number): THREE.DepthTexture | null {
    const map = this.cascades[Math.min(i, this.cascades.length - 1)]?.light.shadow.map;
    const dt = map ? map.depthTexture : null;
    return dt && dt.isDepthTexture ? dt : null;
  }

  shadowMatrix(i: number): THREE.Matrix4 {
    return this.cascades[Math.min(i, this.cascades.length - 1)].light.shadow.matrix;
  }

  /** World metres per shadow texel for a cascade, as of its last fit. */
  texelSize(i: number): number {
    return this.cascades[Math.min(i, this.cascades.length - 1)].texel;
  }

  /**
   * Depth span of a cascade's ortho frustum, in metres. A consumer that wants a
   * bias in metres has to divide by this — the cascades differ by more than a
   * factor of two, so one shared normalised bias means one shared *visible*
   * bias only by accident.
   */
  depthRange(i: number): number {
    const sc = this.cascades[Math.min(i, this.cascades.length - 1)].light.shadow.camera;
    return Math.max(1e-3, sc.far - sc.near);
  }

  attach(scene: THREE.Scene): void {
    this.scene = scene;
    for (const c of this.cascades) scene.add(c.light, c.light.target);
  }

  setQuality(tier: keyof typeof CASCADE_TIERS): void {
    const next = CASCADE_TIERS[tier];
    if (next === this.cfg) return;
    const scene = this.scene;
    this.detach();
    this.disposeCascades();
    this.cfg = next;
    this.build();
    if (scene) this.attach(scene);
  }

  /**
   * Fit every cascade due this frame. `dir` points from the world *toward* the
   * key light, which is the convention the rest of the sky system uses.
   */
  update(camera: THREE.PerspectiveCamera, dir: THREE.Vector3, frame: number): void {
    if (camera.fov !== this.lastFov || camera.aspect !== this.lastAspect) {
      this.lastFov = camera.fov;
      this.lastAspect = camera.aspect;
      this.computeSplits();
    }

    // Light-space basis. It has to be *exactly* the basis three's
    // `LightShadow.updateMatrices` will build from `lookAt`, or the texel snap
    // below quantises along the wrong axes and does nothing.
    this.az.copy(dir).normalize();
    this.up.set(0, 1, 0);
    if (Math.abs(this.az.y) > 0.995) this.up.set(0, 0, 1);
    this.ax.copy(this.up).cross(this.az).normalize();
    this.ay.copy(this.az).cross(this.ax).normalize();

    camera.getWorldPosition(this.camPos);
    camera.getWorldDirection(this.fwd);

    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const tanX = tanY * camera.aspect;
    const k2 = tanX * tanX + tanY * tanY;
    const k = Math.sqrt(k2);

    for (let i = 0; i < this.cascades.length; i++) {
      const c = this.cascades[i];
      // Cascade 0 must never be stale — it is the one carrying contact.
      if (i > 0 && frame % c.interval !== 0) continue;
      c.light.up.copy(this.up);
      // `lookAt` inside three's LightShadow.updateMatrices reads the shadow
      // *camera's* up, not the light's — setting the light's alone was a no-op.
      // It matters at the pole-flip case handled above: the fit would build its
      // basis from (0,0,1) while three built the matrix from (0,1,0), so the
      // texel snap quantised along axes the map was not sampled on and every
      // shadow edge crawled with the camera at high sun.
      c.light.shadow.camera.up.copy(this.up);
      this.fitOne(c, this.splits[i], this.splits[i + 1], k, k2, i === this.cascades.length - 1);
      c.light.shadow.needsUpdate = true;
    }
  }

  /**
   * Copy the key light's colour and intensity onto every other cascade. Only
   * cascade 0's contribution is evaluated, but a set that disagreed about the
   * sun would be a live trap the day someone adds a light to this scene.
   */
  syncKeyLight(): void {
    const key = this.key;
    for (let i = 1; i < this.cascades.length; i++) {
      const l = this.cascades[i].light;
      l.color.copy(key.color);
      l.intensity = key.intensity;
    }
  }

  /** Mark every cascade for a refresh — after a teleport, or a quality change. */
  invalidate(): void {
    for (const c of this.cascades) c.light.shadow.needsUpdate = true;
  }

  dispose(): void {
    this.detach();
    this.disposeCascades();
  }

  /* ------------------------------------------------------------- internals */

  private build(): void {
    for (let i = 0; i < this.cfg.count; i++) {
      const light = new THREE.DirectionalLight(0xffffff, 3);
      light.name = `sun.cascade${i}`;
      light.castShadow = true;
      light.shadow.mapSize.setScalar(this.cfg.sizes[i] ?? 1024);
      // The fit drives these every frame; three only reads them when it renders
      // the cascade, so they are always in step with the map they describe.
      light.shadow.autoUpdate = false;
      light.shadow.needsUpdate = true;
      const sc = light.shadow.camera;
      sc.near = 1;
      sc.far = 1000;
      sc.updateProjectionMatrix();
      // Matrices are driven from here, and the lights sit at the world origin's
      // scene node, so nothing else may recompute them out from under us.
      light.matrixAutoUpdate = true;
      light.target.matrixAutoUpdate = true;
      this.cascades.push({
        light,
        interval: Math.max(1, this.cfg.intervals[i] ?? 1),
        radius: 1,
        texel: 1,
      });
    }
    this.lastFov = 0;
    this.lastAspect = 0;
    this.computeSplits();
  }

  private detach(): void {
    for (const c of this.cascades) {
      c.light.removeFromParent();
      c.light.target.removeFromParent();
    }
  }

  private disposeCascades(): void {
    for (const c of this.cascades) {
      c.light.shadow.map?.dispose();
      c.light.shadow.map = null;
      c.light.dispose();
    }
    this.cascades.length = 0;
  }

  /**
   * Practical split scheme: a logarithmic series (equal texel density per
   * cascade, which is what the projection actually wants) blended toward a
   * uniform one (which stops the near cascade collapsing to centimetres and
   * wasting a whole 2048^2 map on the player's boots).
   */
  private computeSplits(): void {
    const n = Math.max(1, this.cfg.count);
    const near = SHADOW_NEAR;
    const far = SHADOW_DISTANCE;
    this.splits.length = 0;
    this.splits.push(near);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const log = near * Math.pow(far / near, t);
      const uni = near + (far - near) * t;
      this.splits.push(CASCADE_LAMBDA * log + (1 - CASCADE_LAMBDA) * uni);
    }
    this.splits[n] = far;
  }

  private fitOne(c: Cascade, near: number, far: number, k: number, k2: number, last: boolean): void {
    // Minimal sphere enclosing the frustum slice. Centred on the view axis at
    // d = (f + n)(k^2 + 1) / 2 unless that lands past the far cap, in which case
    // the far cap's own circumscribed circle is already minimal.
    let d = 0.5 * (far + near) * (k2 + 1);
    let r: number;
    if (d >= far) {
      d = far;
      r = far * k;
    } else {
      r = Math.sqrt(far * far * k2 + (far - d) * (far - d));
    }
    // A hair of slack so the blend band at the cascade border always has
    // geometry on both sides of it.
    //
    // The outermost cascade needs a whole band's worth rather than a hair. Its
    // authority ramps to zero at its own wall — that ramp *is* the end of shadow
    // coverage, and it has to happen outside the distance we promised to shadow,
    // not inside it. Sized so the frustum slice's bounding sphere sits entirely
    // within the full-authority core, the fade lands beyond SHADOW_DISTANCE
    // where aerial perspective has already erased the contrast.
    r *= last ? 1.02 / (1 - 2 * CASCADE_BLEND) : 1.02;

    this.centre.copy(this.camPos).addScaledVector(this.fwd, d);

    const size = c.light.shadow.mapSize.x;
    const texel = (2 * r) / size;
    const px = Math.round(this.centre.dot(this.ax) / texel) * texel;
    const py = Math.round(this.centre.dot(this.ay) / texel) * texel;
    const pz = this.centre.dot(this.az);

    const target = c.light.target.position;
    target.set(0, 0, 0).addScaledVector(this.ax, px).addScaledVector(this.ay, py).addScaledVector(this.az, pz);

    // Pull the light back far enough that a mountain or a telvanni tower
    // standing outside the slice still casts into it at a raking sun. This is
    // the difference between "long dawn shadows across the ash" and "objects
    // pop out of shadow as you walk toward them".
    const back = r + CASCADE_CASTER_DEPTH;
    c.light.position.copy(target).addScaledVector(this.az, back);

    const sc = c.light.shadow.camera;
    sc.left = -r;
    sc.right = r;
    sc.top = r;
    sc.bottom = -r;
    // Negative near, i.e. the frustum reaches *past* the light plane as well.
    // With a high sun the light plane sits only a few hundred metres above the
    // slice, and Red Mountain is 1.4 km tall — a near of 1 clips the very
    // occluders whose shadows carry the composition.
    sc.near = -CASCADE_CASTER_DEPTH;
    sc.far = back + r;
    sc.updateProjectionMatrix();

    const depthRange = sc.far - sc.near;
    // Normal-offset bias, in metres, scaled to this cascade's texel. This is the
    // term that actually kills acne: pushing the lookup along the surface
    // normal by a texel's worth of world space moves it off the quantised
    // depth plane without moving it away from the ground, which is what a large
    // constant depth bias does (that is what peter-panning *is*, and why the
    // 0.4 the previous build used erased every contact in the frame).
    c.light.shadow.normalBias = 1.05 * texel;
    // Small constant depth bias on top; the slope term is computed per pixel
    // from the receiver plane in the shader patch below, where it belongs.
    c.light.shadow.bias = -(0.35 * texel) / depthRange;
    // Constant world-space penumbra across cascades, so the filter does not
    // visibly change width when a shadow crosses a split.
    c.light.shadow.radius = THREE.MathUtils.clamp(CASCADE_PENUMBRA / texel, 1.0, 2.4);

    c.radius = r;
    c.texel = texel;
  }
}

/* ------------------------------------------------------- the shader patch */

/**
 * Rewrite three's directional-light block so that, when more than one
 * directional light casts a shadow, the set is treated as cascades of one sun:
 * one BRDF evaluation, one blended visibility term, sampled from whichever
 * cascade owns the pixel.
 *
 * Two properties make this safe without any new uniforms:
 *
 *  - Cascade choice comes from `vDirectionalShadowCoord[i]` itself. A fragment
 *    belongs to the first cascade whose unit cube contains it, and the weight
 *    ramps down inside a blend band at the border, so the hand-off between two
 *    texel densities is a gradient a few metres wide instead of a hard line.
 *    Nothing has to tell the shader where the splits are.
 *  - Cascade *order* is the order the lights were added to the scene. three
 *    sorts lights with a comparator that returns 0 for any two shadow-casting
 *    directional lights, and Array.prototype.sort is stable, so insertion order
 *    survives into `directionalShadowMap[]`.
 *
 * The patch is installed at module evaluation time, which is before any system
 * is constructed and therefore before the first material compiles. It is a
 * targeted splice into three's own chunk text and throws if the text it expects
 * is not there, so a three upgrade that reshapes the chunk fails loudly instead
 * of silently dropping every shadow in the game.
 */
function installCascadeChunks(): void {
  const CSM_HELPERS = /* glsl */ `
#if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 1 ) && defined( SHADOWMAP_TYPE_PCF )

	#define CSM_BLEND ${CASCADE_BLEND.toFixed(3)}

	// Fraction of this cascade's authority at a point: 1 well inside its box,
	// falling to 0 at the lateral border over CSM_BLEND of the box.
	//
	// Laterally only. The third coordinate is depth along the light, and a
	// cascade's depth range is dominated by how far the light is pulled back to
	// catch distant occluders — several hundred metres — so every receiver sits
	// near the far end of it. Feeding z into the same blend band put the near
	// cascade's authority at a third of what it should be everywhere, and the
	// whole frame silently fell through to the coarsest cascade: terrain-scale
	// shadows appeared, object-scale ones did not. Depth is a hard in/out test.
	float csmAuthority( vec3 c ) {

		if ( c.z < 0.0 || c.z > 1.0 ) return 0.0;
		vec2 d = min( c.xy, 1.0 - c.xy );
		return smoothstep( 0.0, CSM_BLEND, min( d.x, d.y ) );

	}

	// Receiver-plane depth gradient: how fast shadow-map depth changes per unit
	// of shadow-map UV across this surface. Gives an exact slope-scaled bias for
	// free — a wall raking away from the sun gets the bias it needs while flat
	// ground gets almost none, which a constant bias can never do.
	vec2 csmDepthGradient( vec3 c ) {

		vec3 dx = dFdx( c );
		vec3 dy = dFdy( c );
		float det = dx.x * dy.y - dx.y * dy.x;
		if ( abs( det ) < 1e-9 ) return vec2( 0.0 );
		return vec2( dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z ) / det;

	}

	float getCascadedShadow() {

		float occl = 0.0;
		float rem = 1.0;

		// The inner braces are load-bearing: three's loop unroller pastes the body
		// n times into one scope, so every local in it has to own a block or the
		// second cascade redefines the first one's variables and nothing compiles.
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		{
			vec4 sc = vDirectionalShadowCoord[ i ];
			vec3 cc = sc.xyz / sc.w;
			// Every cascade, the outermost included, is weighted by its own
			// authority. Letting the last one take all the leftover weight
			// instead looked equivalent — a fragment past the last split is lit
			// either way, because getShadow returns 1 outside its map — but it
			// put the transition *at the box wall*, so shadow coverage ended on
			// a plane in light space: a hard axis-aligned rectangle drawn across
			// whatever geometry happened to straddle it. Weighting it like the
			// rest turns that wall into the same ramp used at every other
			// cascade border, and unclaimed weight is simply lit.
			float w = min( csmAuthority( cc ), rem );
			rem -= w;
			// Everything below is skipped for the cascades that own no part of
			// this pixel, which is all but one of them outside a blend band.
			if ( w > 0.0 ) {
				vec2 grad = csmDepthGradient( cc );
				vec2 tx = vec2( 1.0 ) / directionalLightShadows[ i ].shadowMapSize;
				float slope = dot( abs( grad ), tx * ( directionalLightShadows[ i ].shadowRadius + 1.0 ) );
				// A silhouette pixel has a near-infinite gradient; clamping keeps
				// it from punching a lit hole through the occluder behind it. The
				// cap is expressed in multiples of this cascade's own constant
				// bias, which is already a fixed number of texels of world depth —
				// so the ceiling scales with the cascade instead of being a magic
				// constant that is too tight near and too loose far.
				sc.z -= min( slope, 12.0 * max( abs( directionalLightShadows[ i ].shadowBias ), 1e-7 ) ) * sc.w;
				float s = getShadow(
					directionalShadowMap[ i ],
					directionalLightShadows[ i ].shadowMapSize,
					directionalLightShadows[ i ].shadowIntensity,
					directionalLightShadows[ i ].shadowBias,
					directionalLightShadows[ i ].shadowRadius,
					sc );
				occl += w * ( 1.0 - s );
			}
		}
		}
		#pragma unroll_loop_end

		return 1.0 - occl;

	}

#endif
`;

  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;

  const parsFrag = chunks.shadowmap_pars_fragment;
  if (typeof parsFrag !== 'string' || !parsFrag.includes('float getShadow( sampler2DShadow shadowMap')) {
    throw new Error('ShadowCascades: three shadowmap_pars_fragment is not the shape this patch expects');
  }
  chunks.shadowmap_pars_fragment = parsFrag + CSM_HELPERS;

  // Splice inside the directional block only. Locating it by its own `#if`
  // rather than matching a whole verbatim stanza keeps the patch working
  // against both three's source chunks and the bundled build, which strips
  // blank lines — a verbatim needle silently fails against exactly one of them.
  const src = chunks.lights_fragment_begin;
  const HEAD = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
  const TAIL = '#pragma unroll_loop_end';
  const from = typeof src === 'string' ? src.indexOf(HEAD) : -1;
  const to = from < 0 ? -1 : src.indexOf(TAIL, from);
  if (from < 0 || to < 0) {
    throw new Error('ShadowCascades: cannot find three directional-light block to patch');
  }
  let block = src.slice(from, to);

  const SHADOW_CALL = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow(';
  const si = block.indexOf(SHADOW_CALL);
  const se = si < 0 ? -1 : block.indexOf('\n', si);
  if (si < 0 || se < 0) {
    throw new Error('ShadowCascades: cannot find three directional shadow lookup to patch');
  }
  const shadowLine = block.slice(si, se);
  block =
    block.slice(0, si) +
    [
      '#if ( NUM_DIR_LIGHT_SHADOWS > 1 ) && defined( SHADOWMAP_TYPE_PCF )',
      '\t\t#if UNROLLED_LOOP_INDEX == 0',
      // Cascade slices of one sun: slice 0 samples the whole set and carries
      // the light. Slices 1..n exist only to own a shadow map.
      '\t\tdirectLight.color *= ( directLight.visible && receiveShadow ) ? getCascadedShadow() : 1.0;',
      '\t\t#endif',
      '\t\t#else',
      '\t\t' + shadowLine.trimStart(),
      '\t\t#endif',
    ].join('\n') +
    block.slice(se);

  const RE_DIRECT = 'RE_Direct( directLight,';
  const ri = block.indexOf(RE_DIRECT);
  const re = ri < 0 ? -1 : block.indexOf('\n', ri);
  if (ri < 0 || re < 0) {
    throw new Error('ShadowCascades: cannot find three directional RE_Direct call to patch');
  }
  const reLine = block.slice(ri, re);
  block =
    block.slice(0, ri) +
    [
      '#if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 1 ) && defined( SHADOWMAP_TYPE_PCF ) && ( UNROLLED_LOOP_INDEX > 0 ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )',
      '\t\t// cascade slave — folded into slice 0 above, contributes nothing here',
      '\t\t#else',
      '\t\t' + reLine.trimStart(),
      '\t\t#endif',
    ].join('\n') +
    block.slice(re);

  chunks.lights_fragment_begin = src.slice(0, from) + block + src.slice(to);
}

installCascadeChunks();
