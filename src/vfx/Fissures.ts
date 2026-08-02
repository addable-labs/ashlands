import * as THREE from 'three';
import { AERIAL_GLSL, aerialUniforms } from '../sky/Atmosphere';
import { VFX_COMMON, VFX_FRAG, VFX_NOISE, vfxUniforms } from './glsl';
import type { TerrainQuery } from '../core/types';

/**
 * RED MOUNTAIN — live fissures on the upper flanks.
 *
 * The terrain material draws its own crust fissures, but they are a close-range
 * surface detail: it cross-fades them out past a few hundred metres because at
 * that range they are sub-texel and would alias. That is correct for a lava
 * field you are standing on and catastrophic for the one landmark in the
 * province, because it means the mountain that the whole art direction hangs on
 * arrives at the camera as an untextured beige cone. The silhouette needs the
 * ember palette ON it, at a kilometre, or it is a hill.
 *
 * So this is the long-range half of the same effect, and it is a different
 * problem with a different solution:
 *
 *  - it is GEOMETRY, not a screen-space ribbon. Each vein is a chain of quads
 *    laid in the terrain's own tangent plane, at points sampled from
 *    `TerrainQuery.heightAt`, so the vein follows the relief it crosses,
 *    narrows and turns with the slope, and is depth-tested against the mountain
 *    — it breaks over a ridge and is occluded in a hollow because it is
 *    genuinely there, not because anything special was coded for it.
 *
 *  - the path is walked DOWNHILL from the crater rim on the heightfield
 *    gradient, which is where lava actually goes, and then resampled through a
 *    Catmull-Rom spline before tessellation. A raw gradient walk on a
 *    discretised heightfield produces polyline kinks at every sample; the
 *    spline is what removes them.
 *
 *  - a vein is not a constant-brightness stripe. Intensity along the arc is
 *    driven by 1-D noise over the WORLD arc length (so it is continuous across
 *    quad boundaries), the core width follows it, and a cooling ramp takes the
 *    vein from incandescent at the rim to nearly closed at the toe.
 *
 *  - each vein carries a cooled-crust band of dark basalt flanking the hot
 *    core, and a wide, very low warm halo that stands in for the emissive
 *    bounce onto the surrounding rock. Both are in the same fragment: the crust
 *    contributes coverage (it darkens what is behind it), the halo contributes
 *    radiance only (it adds without occluding), which is exactly the difference
 *    between a material and a light.
 */

const VERT = /* glsl */ `
precision highp float;

attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec3 aTan;
/** x = half-length (m), y = core half-width (m), z = heat 0..1, w = arc length (m). */
attribute vec4 aParam;

uniform float uWidth;
/** Quad half-width as a multiple of the core half-width. Sets the halo reach. */
uniform float uHalo;
/** Floor on the projected width of the INCANDESCENT CORE, in pixels. */
uniform float uCoreMinPx;

varying vec2  vUv;
varying vec3  vWorld;
varying float vViewDist;
varying float vHeat;
varying float vArc;
/** Core half-width as a fraction of the quad's half-width. */
varying float vCoreFrac;

${VFX_NOISE}
${VFX_COMMON}

void main() {
  vec3 N = normalize(aNrm);
  // Gram-Schmidt: the CPU tangent is the path direction in the XZ plane, which
  // is not in the surface tangent plane on a slope.
  vec3 T = aTan - N * dot(N, aTan);
  T = length(T) > 1e-4 ? normalize(T) : normalize(cross(N, vec3(0.0, 0.0, 1.0)));
  vec3 B = normalize(cross(N, T));

  float len = aParam.x;

  vec3 centre = aPos;
  float d = max(-(viewMatrix * vec4(centre, 1.0)).z, 0.001);

  // MINIMUM PROJECTED WIDTH IS A PROPERTY OF THE CORE, NOT OF THE QUAD.
  //
  // The clamp used to be applied to the halo quad, which is uHalo times wider
  // than the hot core it carries. A quad comfortably eight pixels across
  // therefore never triggered it while the core inside it was a fifth of a
  // pixel — and a sub-pixel emissive line rasterises as a constant-width,
  // constant-value stroke with no falloff and no bloom, which is exactly the
  // "five parallel orange strokes" read. Clamping the CORE means the vein is
  // always at least a couple of pixels of real gradient wide, so it has an
  // inside and an outside and the bloom prefilter can find it.
  float coreHalf = aParam.y * uWidth;
  float corePx = coreHalf * 2.0 * uVfxProj / d;
  float cGrow = max(1.0, uCoreMinPx / max(corePx, 1e-4));
  coreHalf *= cGrow;
  float wid = coreHalf * uHalo;

  // Partial energy compensation, not the full 1/grow. Exact flux conservation
  // divides a distant vein's radiance by the growth and drops it back under the
  // bloom threshold, which is the whole thing we are widening it to reach.
  vHeat = aParam.z / pow(cGrow, 1.15);
  vCoreFrac = 1.0 / max(uHalo, 1.0);

  // Lift off the surface. Constant at close range so the vein hugs the ground,
  // proportional at long range so depth quantisation cannot make it z-fight
  // with the terrain it is painted on.
  vec3 world = centre + N * (0.04 + d * 0.0016)
             + T * (position.x * 2.0 * len)
             + B * (position.y * 2.0 * wid);

  vec4 mv = viewMatrix * vec4(world, 1.0);
  vUv = position.xy * 2.0;
  vWorld = world;
  vViewDist = max(-mv.z, 0.001);
  vArc = aParam.w + position.x * 2.0 * len;

  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform vec3  uEmber;
uniform vec3  uEmberDeep;
uniform vec3  uCoreHot;
uniform vec3  uCrust;
uniform float uGlow;
uniform float uCrustA;
uniform float uBounce;

varying vec2  vUv;
varying vec3  vWorld;
varying float vViewDist;
varying float vHeat;
varying float vArc;
varying float vCoreFrac;

${VFX_NOISE}
${AERIAL_GLSL}
${VFX_COMMON}
${VFX_FRAG}

void main() {
  // Across the vein, -1 at the halo edge. Along the vein, in metres, continuous
  // across quad boundaries because it is a world arc length.
  float u = vUv.y;
  float a1 = vArc * 0.055;
  float a2 = vArc * 0.23;

  // Intensity and width along the arc. The low octave opens and closes the
  // vein; the high one gives it grain. Without this a vein is a constant
  // ribbon, which is the single loudest tell that it was drawn rather than
  // erupted.
  float nA = vfxNoise(vec3(a1, 0.0, 0.0));
  float nB = vfxNoise(vec3(a2, 11.3, 0.0));
  float open = smoothstep(0.14, 0.46, nA);
  float heat = vHeat * mix(0.40, 1.0, nA) * (0.72 + 0.42 * nB) * open;

  // Core width tracks the intensity: a choked stretch of vein is thin AND dim,
  // never thin and bright. The base fraction arrives from the vertex stage so
  // that a vein whose core has been widened to the pixel floor keeps a real
  // profile instead of a hard stroke.
  float w = vCoreFrac * mix(0.42, 1.0, nA);
  float x = u / max(w, 1e-3);
  float core = exp(-x * x * 2.0);
  // Chilled basalt shoulder: dark, matte, flanking the core out to ~3 widths.
  float sh = u / max(w * 3.2, 1e-3);
  float crust = (1.0 - core) * exp(-sh * sh);
  // Emissive bounce onto the surrounding rock. Radiance only — it must not
  // occlude the surface it is lighting. This is the term that makes the rock
  // BESIDE a vein brighter than rock a hundred pixels away; at the old 0.075
  // weight over a seven-width profile it contributed nothing measurable and the
  // fissures read as decals with no light coming off them.
  float bo = u / max(w * 8.0, 1e-3);
  float bounce = exp(-bo * bo * 0.85);

  // Convective flicker, decorrelated by arc position so a vein shimmers along
  // its length rather than pulsing as one object.
  float ph = fract(vArc * 0.0137) * 6.2831853;
  float flick = 0.86 + 0.14 * sin(uVfxTime * 2.3 + ph) * sin(uVfxTime * 0.71 + ph * 2.3);

  float cA = crust * uCrustA;
  float a = clamp(cA + core * 0.92, 0.0, 1.0);
  if (a < 0.004 && heat < 0.004) discard;

  // BLACKBODY GRADIENT ACROSS THE PROFILE.
  //
  // Lava is not one colour. The open channel is white-hot (#fff2d0), the skin
  // over it is #ff7a2a, the cooling shoulder is #c4551f and the rind is basalt.
  // Drawing the whole core in a single ember hue is what makes a fissure read as
  // an orange line drawn on the rock rather than as molten rock seen through a
  // crack, and it also caps the peak radiance at the ember's own luminance —
  // well under the bloom prefilter, so the veins carried no halo at all.
  // The temp term combines the across-vein profile with the along-arc cooling ramp, so
  // a hot upper stretch shows white in its middle and a spent lower stretch
  // never gets past the deep ember.
  float temp = clamp(core * (0.35 + 0.85 * heat), 0.0, 1.0);
  vec3 grad = mix(uEmberDeep, uEmber, smoothstep(0.06, 0.48, temp));
  grad = mix(grad, uCoreHot, smoothstep(0.58, 0.98, temp));

  float drive = uGlow * heat * flick;
  vec3 emit = grad * (drive * core) + uEmberDeep * (drive * bounce * uBounce);

  // Aerial perspective: transmittance on both halves, in-scatter weighted by
  // the coverage only. An emitter must not pick the in-scatter up twice.
  vec3 eye = vWorld - uVfxCamPos;
  vec3 T = vfxAerialT(vViewDist, eye);
  vec3 ins = applyAerial(vec3(0.0), vViewDist, eye);

  vec3 opaque = uCrust * cA;
  gl_FragColor = vec4(opaque * T + ins * a + emit * T, a);
}
`;

/** Catmull-Rom on a uniform knot vector. */
function catmull(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  t: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const a = -0.5 * t3 + t2 - 0.5 * t;
  const b = 1.5 * t3 - 2.5 * t2 + 1.0;
  const c = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
  const d = 0.5 * t3 - 0.5 * t2;
  return out.set(
    p0.x * a + p1.x * b + p2.x * c + p3.x * d,
    p0.y * a + p1.y * b + p2.y * c + p3.y * d,
    p0.z * a + p1.z * b + p2.z * c + p3.z * d,
  );
}

export interface FissureOpts {
  renderOrder: number;
  /** Upper bound on tessellated nodes; the buffers are sized once from this. */
  maxNodes: number;
}

/**
 * World-anchored emissive veins draped on a mountain's flanks. Inert (and not
 * drawn) until `build` is handed a summit.
 */
export class Fissures {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private max: number;
  private aPos: THREE.InstancedBufferAttribute;
  private aNrm: THREE.InstancedBufferAttribute;
  private aTan: THREE.InstancedBufferAttribute;
  private aParam: THREE.InstancedBufferAttribute;
  private bPos: Float32Array;
  private bNrm: Float32Array;
  private bTan: Float32Array;
  private bParam: Float32Array;
  private built = false;

  constructor(o: FissureOpts) {
    this.max = o.maxNodes;
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

    this.bPos = new Float32Array(o.maxNodes * 3);
    this.bNrm = new Float32Array(o.maxNodes * 3);
    this.bTan = new Float32Array(o.maxNodes * 3);
    this.bParam = new Float32Array(o.maxNodes * 4);
    this.aPos = new THREE.InstancedBufferAttribute(this.bPos, 3);
    this.aNrm = new THREE.InstancedBufferAttribute(this.bNrm, 3);
    this.aTan = new THREE.InstancedBufferAttribute(this.bTan, 3);
    this.aParam = new THREE.InstancedBufferAttribute(this.bParam, 4);
    this.geo.setAttribute('aPos', this.aPos);
    this.geo.setAttribute('aNrm', this.aNrm);
    this.geo.setAttribute('aTan', this.aTan);
    this.geo.setAttribute('aParam', this.aParam);
    this.geo.instanceCount = 0;
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...vfxUniforms(),
        ...aerialUniforms(),
        uWidth: { value: 1 },
        // Halo reach as a multiple of the core half-width. Wide, because this
        // quad is the only place the vein's light can reach the rock around it:
        // there is no emissive bounce in the deferred lighting for a forward
        // transparent, so the bounce lobe in the fragment IS the illumination.
        uHalo: { value: 9 },
        uGlow: { value: 1 },
        uCrustA: { value: 0.85 },
        // A vein is at least this many pixels of hot core wide. Below about two
        // the profile has no gradient left and rasterises as a hard stroke.
        uCoreMinPx: { value: 2.4 },
        // Emissive bounce weight — how much of the vein's radiance lands on the
        // surrounding rock rather than in the channel itself.
        uBounce: { value: 0.48 },
        // The blackbody ramp, all in linear and all driven above 1 so the bloom
        // prefilter registers them.
        // #fff2d0 — the open channel.
        uCoreHot: { value: new THREE.Color(5.0, 4.35, 3.05) },
        // #ff7a2a in linear, driven hot enough to survive the tone curve and to
        // land above the bloom threshold so each vein carries a real halo.
        uEmber: { value: new THREE.Color(3.2, 0.62, 0.075) },
        // #c4551f — the cooling shoulder and the light thrown onto the rock.
        uEmberDeep: { value: new THREE.Color(1.15, 0.20, 0.030) },
        // #141312 — chilled basalt, the darkest value in the palette.
        uCrust: { value: new THREE.Color(0.0065, 0.0058, 0.0053) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      premultipliedAlpha: true,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = true;
    this.mesh.renderOrder = o.renderOrder;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    this.mesh.name = 'vfx:fissures';
  }

  get anchored(): boolean {
    return this.built;
  }

  /**
   * Walk a set of veins downhill from a crater rim and tessellate them.
   *
   * @param t      terrain to sample; only `heightAt`/`normalAt` are used.
   * @param summit crater centre, at the terrain surface.
   * @param ventR  crater radius; veins start just outside it.
   * @param drop   how far below the summit the veins are allowed to run.
   */
  build(t: TerrainQuery, summit: THREE.Vector3, ventR: number, drop: number): void {
    const VEINS = 12;
    const STEP = 16;
    const MAX_STEPS = 72;
    const SPACING = 7;
    /** Core half-width at the rim, in metres. */
    const W0 = 1.7;
    /**
     * Lateral reach of the drainage probe, in metres.
     *
     * This is the term that turns a gradient walk into flow accumulation. Pure
     * steepest descent on a smooth cone is exactly radial, which is why nine
     * veins came out as nine screen-straight parallel strokes no matter how much
     * random wander was piled on top: the wander is symmetric, so it averages
     * back to the radial line. Sampling the surface a couple of stencil widths
     * to either side and steering toward the LOWER one is a one-tap
     * approximation of "which way does water go from here" — it makes a vein
     * fall into a gully and stay in it, veins that start near each other
     * converge into the same channel, and the set follows the relief instead of
     * ignoring it.
     */
    const PROBE = 26;

    const raw: THREE.Vector3[] = [];
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    const n = new THREE.Vector3();
    let seed = 0x9e3779b1;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    let written = 0;
    for (let v = 0; v < VEINS && written < this.max; v++) {
      // Golden-angle spacing with jitter: even coverage of the cone without the
      // rotational symmetry that a regular fan would read as.
      const a0 = v * 2.39996 + rnd() * 0.5;
      const r0 = ventR * (1.05 + rnd() * 0.35);
      // Per-vein calibre. A set of veins all cut to the same gauge is the other
      // half of "five parallel strokes of constant width": the along-arc noise
      // in the fragment varies a vein against ITSELF but leaves every vein in
      // the same size class as its neighbour.
      const vScale = 0.55 + rnd() * 1.15;
      const vPhase = rnd() * 6.28;
      p.set(summit.x + Math.cos(a0) * r0, 0, summit.z + Math.sin(a0) * r0);
      p.y = t.heightAt(p.x, p.z);

      raw.length = 0;
      raw.push(p.clone());
      let wander = rnd() * 6.28;
      for (let s = 0; s < MAX_STEPS; s++) {
        // Downhill on the heightfield gradient, biased outward so a vein cannot
        // stall in a local hollow, plus a slow lateral wander so the set does
        // not read as nine radial spokes.
        const e = STEP * 0.5;
        const gx = t.heightAt(p.x + e, p.z) - t.heightAt(p.x - e, p.z);
        const gz = t.heightAt(p.x, p.z + e) - t.heightAt(p.x, p.z - e);
        let dx = -gx;
        let dz = -gz;
        const gl = Math.hypot(dx, dz);
        if (gl > 1e-4) {
          dx /= gl;
          dz /= gl;
        } else {
          dx = Math.cos(a0);
          dz = Math.sin(a0);
        }
        // Drainage: probe across the direction of travel and steer downhill in
        // the cross-slope as well as the down-slope. `chan` is positive when the
        // left-hand side is lower, and it is normalised by the probe span so the
        // steer is a slope, not a height.
        const nx = -dz;
        const nz = dx;
        const hL = t.heightAt(p.x + nx * PROBE, p.z + nz * PROBE);
        const hR = t.heightAt(p.x - nx * PROBE, p.z - nz * PROBE);
        const chan = THREE.MathUtils.clamp((hR - hL) / PROBE, -1, 1);

        const ox = p.x - summit.x;
        const oz = p.z - summit.z;
        const ol = Math.max(Math.hypot(ox, oz), 1e-4);
        wander += (rnd() - 0.5) * 0.55;
        const wx = -Math.sin(wander);
        const wz = Math.cos(wander);
        // Gradient dominates, the drainage steer bends the path into the relief,
        // and the outward bias and the wander are only there to stop a vein
        // stalling in a closed hollow or tracing a perfectly smooth arc.
        let mx = dx * 0.68 + nx * chan * 0.85 + (ox / ol) * 0.10 + wx * 0.16;
        let mz = dz * 0.68 + nz * chan * 0.85 + (oz / ol) * 0.10 + wz * 0.16;
        const ml = Math.max(Math.hypot(mx, mz), 1e-4);
        mx /= ml;
        mz /= ml;

        p.x += mx * STEP;
        p.z += mz * STEP;
        p.y = t.heightAt(p.x, p.z);
        raw.push(p.clone());
        if (summit.y - p.y > drop) break;
      }
      if (raw.length < 4) continue;

      // Catmull-Rom resample. The gradient walk is a polyline on a discretised
      // heightfield and every sample is a potential kink; the spline is what
      // makes the vein read as a flow rather than as a drawn path.
      const total = raw.length - 1;
      const arcBase = v * 977.3 + rnd() * 400;
      let arc = 0;
      const prev = new THREE.Vector3().copy(raw[0]);
      const cur = new THREE.Vector3();
      const segs = Math.max(1, Math.round((total * STEP) / SPACING));
      for (let i = 0; i <= segs && written < this.max; i++) {
        const u = (i / segs) * total;
        const k = Math.min(total - 1, Math.floor(u));
        const f = u - k;
        catmull(
          raw[Math.max(0, k - 1)],
          raw[k],
          raw[Math.min(total, k + 1)],
          raw[Math.min(total, k + 2)],
          f,
          cur,
        );
        // Re-seat on the surface: the spline cuts corners in Y as well as XZ,
        // and a vein floating a metre over a hollow is the exact artefact this
        // whole class exists to avoid.
        cur.y = t.heightAt(cur.x, cur.z);
        if (i === 0) {
          prev.copy(cur);
          continue;
        }
        q.copy(cur).sub(prev);
        const seg = Math.max(q.length(), 1e-3);
        arc += seg;

        t.normalAt(cur.x, cur.z, n);
        if (n.lengthSq() < 1e-8) n.set(0, 1, 0);
        // Cooling ramp: incandescent at the rim, nearly closed at the toe.
        const life = 1 - (summit.y - cur.y) / Math.max(drop, 1);
        // Shallow exponent: the along-arc noise and the choke term in the
        // fragment already cut a vein down hard, and a steep cooling ramp on
        // top of them leaves the veins clustered in the first hundred metres
        // below the rim instead of running the length of the upper flank.
        const heat = Math.pow(THREE.MathUtils.clamp(life, 0, 1), 0.5);
        // Slope narrows a vein: on a steep face the flow is fast and thin, on a
        // bench it ponds and spreads. On top of that, a slow swell along the arc
        // so a single vein widens into pools and chokes back to a thread.
        const swell = 0.62 + 0.68 * (0.5 + 0.5 * Math.sin(arc * 0.011 + vPhase));
        const wid =
          W0 *
          vScale *
          swell *
          (0.42 + 0.85 * THREE.MathUtils.clamp(n.y, 0, 1)) *
          (0.75 + 0.5 * heat);

        const o3 = written * 3;
        const o4 = written * 4;
        this.bPos[o3] = (prev.x + cur.x) * 0.5;
        this.bPos[o3 + 1] = (prev.y + cur.y) * 0.5;
        this.bPos[o3 + 2] = (prev.z + cur.z) * 0.5;
        this.bNrm[o3] = n.x;
        this.bNrm[o3 + 1] = n.y;
        this.bNrm[o3 + 2] = n.z;
        this.bTan[o3] = q.x / seg;
        this.bTan[o3 + 1] = q.y / seg;
        this.bTan[o3 + 2] = q.z / seg;
        // Half-length overshoots half the spacing so consecutive quads overlap
        // and the ribbon has no gaps on a curve.
        this.bParam[o4] = seg * 0.72;
        this.bParam[o4 + 1] = wid;
        this.bParam[o4 + 2] = heat;
        this.bParam[o4 + 3] = arcBase + arc;
        written++;
        prev.copy(cur);
      }
    }

    this.aPos.needsUpdate = true;
    this.aNrm.needsUpdate = true;
    this.aTan.needsUpdate = true;
    this.aParam.needsUpdate = true;
    this.geo.instanceCount = written;
    // Anchored geometry, so a real bounding sphere is worth having: the mesh is
    // frustum-culled outright whenever the mountain is not on screen.
    this.geo.boundingSphere = new THREE.Sphere(summit.clone(), ventR + STEP * MAX_STEPS + 64);
    this.built = written > 0;
    this.mesh.visible = this.built;
  }

  /** @param glow overall emissive drive; 0 hides the veins. */
  set(glow: number, width: number): void {
    this.mat.uniforms.uGlow.value = glow;
    this.mat.uniforms.uWidth.value = width;
    this.mesh.visible = this.built && glow > 0.002;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
