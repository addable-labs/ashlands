import * as THREE from 'three';
import type { TerrainQuery } from '../core/types';
import { AERIAL_GLSL, aerialUniforms } from '../sky/Atmosphere';

/**
 * Ground contact for actors.
 *
 * The shadow cascade cannot solve this on its own. A cascade wide enough to
 * cover the streaming radius resolves a kwama's foot at well under a texel, so
 * past a few tens of metres a creature's own shadow simply disappears and it
 * starts to hover — and where the ground is water there is no shadow receiver in
 * the cascade at all. Hovering objects are the single loudest amateur tell in
 * the art bible, so contact cannot be something that switches off with distance.
 *
 * So contact is authored, not derived: every actor writes a small ground-
 * conforming decal under each foot and a broader one under its body, at every
 * LOD including impostors. The decals are rebuilt into one dynamic mesh each
 * frame — a few hundred triangles for the whole world.
 *
 * Where a foot is below sea level the decal moves up to the waterline and gains
 * a foam ring, so the creature reads as standing IN the water: a shadow on the
 * surface, a bright meniscus where the leg pierces it, and (with the wet-line in
 * the actor shader) a darkened, glossy leg below it.
 */

/** Vertices per side of a decal patch. 4x4 conforms to terrain slope cheaply. */
const GRID = 4;
const VERTS_PER = GRID * GRID;
const TRIS_PER = (GRID - 1) * (GRID - 1) * 2;

/**
 * Hard cap on decals per frame. Well above what is ever visible at once.
 *
 * Headroom for two body decals per actor — the sun-projected cast shadow and
 * the ambient pool underneath it are different marks in different places (see
 * ActorSystem.contactFor) — plus a foot decal per leg on the near tier.
 */
const MAX_DECALS = 320;

/** Metres the waterline decals float above the sea plane, to clear the swell. */
const WATER_LIFT = 0.12;

const VERT = /* glsl */ `
precision highp float;
attribute vec3 aTint;
attribute vec3 aParam;   // x radial 0..1, y strength, z ring (0 pool, 1 ring)
varying vec3 vTint;
varying vec3 vParam;
varying vec3 vWPos;
void main() {
  vTint = aTint;
  vParam = aParam;
  vWPos = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

/**
 * Two profiles, two blend operators — and that split is the fix for "there is no
 * darkening of the ridge surface at any contact point".
 *
 * The pool is an OCCLUSION term. It was being alpha-blended toward a fixed dark
 * tint that had itself been through the aerial integral, which is an operator
 * that pulls the surface TOWARD a colour rather than attenuating the light
 * reaching it. On bright ground that darkens, so it looked right at noon; on
 * ground already darker than the tint — a ridge in its own shade at dusk, the
 * shadowed flank of a coastal hillside at 17:40 — the same decal LIFTS the pixel,
 * and the contact shadow reads as a faint bright smudge or as nothing at all.
 * That is unconditionally wrong: a shadow cannot make a surface brighter.
 *
 * So the pool is composited as what it physically is. Occluding a fraction
 * (1 - m) of the incident light gives, after the terrain's own aerial integral,
 *
 *   result = (surface * m) * T + inscatter
 *          = fogged * m + inscatter * (1 - m)
 *
 * which is exactly `dst * m + src` with src = inscatter * (1 - m) and a blend
 * function of (ONE, SRC_ALPHA) carrying m in alpha. It can only ever darken, and
 * because the refill is the in-scattered air over the same path, a contact pool
 * at 500 m washes out into the haze on its own instead of staying a hard disc —
 * the same aerial perspective every other surface in the frame obeys.
 *
 * The ring is the opposite: a meniscus is specular lift where a limb pierces the
 * water, so it genuinely adds light and keeps ordinary alpha blending.
 */
const FRAG_POOL = /* glsl */ `
precision highp float;
varying vec3 vTint;
varying vec3 vParam;
varying vec3 vWPos;

void main() {
  float r = clamp(vParam.x, 0.0, 1.6);
  // A soft-edged occlusion well, densest directly under the contact and falling
  // off faster than linear — which is what an integrated visibility cone
  // actually does, and why a hard-edged blob reads as a sticker.
  float pool = pow(clamp(1.0 - r, 0.0, 1.0), 1.7);
  float occ = vParam.y * pool;
  if (occ < 0.004) discard;
  // vTint is the floor the occluded surface may reach: a shadowed patch of
  // ground still sees the sky, so the multiplier never goes to zero.
  vec3 m = mix(vec3(1.0), vTint, clamp(occ, 0.0, 1.0));
  vec3 inscatter = applyAerial(vec3(0.0), vWPos - cameraPosition);
  // Alpha carries the multiplier; the blend func is (ONE, SRC_ALPHA). One
  // channel of alpha for three of multiplier is a compromise — luminance is the
  // right scalar for an occlusion term, and a shadow does not change hue.
  float ml = clamp(dot(m, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  gl_FragColor = vec4(inscatter * (1.0 - ml), ml);
}
`;

const FRAG_RING = /* glsl */ `
precision highp float;
varying vec3 vTint;
varying vec3 vParam;
varying vec3 vWPos;

void main() {
  float r = clamp(vParam.x, 0.0, 1.6);
  // The meniscus where a limb pierces the surface. Narrow, and brightest just
  // outside the intersection.
  float ring = exp(-pow((r - 0.62) * 4.2, 2.0));
  float a = vParam.y * ring;
  if (a < 0.004) discard;
  gl_FragColor = vec4(applyAerial(vTint, vWPos - cameraPosition), clamp(a, 0.0, 1.0));
}
`;

/**
 * One dynamic mesh holding every contact decal in the world.
 *
 * Ground-conforming rather than projected: each patch samples the heightfield at
 * its own sixteen vertices, so a shadow pool on a slope lies along the slope
 * instead of intersecting it and clipping into a straight edge.
 */
/** One dynamic patch buffer plus the mesh that draws it. */
class DecalBatch {
  readonly mesh: THREE.Mesh;
  readonly geo = new THREE.BufferGeometry();
  readonly pos: THREE.BufferAttribute;
  readonly tint: THREE.BufferAttribute;
  readonly param: THREE.BufferAttribute;
  n = 0;

  constructor(material: THREE.ShaderMaterial, name: string, renderOrder: number) {
    this.pos = new THREE.BufferAttribute(new Float32Array(MAX_DECALS * VERTS_PER * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.tint = new THREE.BufferAttribute(new Float32Array(MAX_DECALS * VERTS_PER * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.param = new THREE.BufferAttribute(new Float32Array(MAX_DECALS * VERTS_PER * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('aTint', this.tint);
    this.geo.setAttribute('aParam', this.param);

    // The index buffer never changes: decal i always owns the same slot.
    const idx = new Uint32Array(MAX_DECALS * TRIS_PER * 3);
    let k = 0;
    for (let d = 0; d < MAX_DECALS; d++) {
      const base = d * VERTS_PER;
      for (let j = 0; j < GRID - 1; j++) {
        for (let i = 0; i < GRID - 1; i++) {
          const a = base + j * GRID + i;
          idx[k++] = a;
          idx[k++] = a + GRID;
          idx[k++] = a + 1;
          idx[k++] = a + 1;
          idx[k++] = a + GRID;
          idx[k++] = a + GRID + 1;
        }
      }
    }
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    // Decals move every frame and are always near the camera-relevant actors;
    // a world-sized sphere is cheaper than recomputing bounds.
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
  }

  end(): void {
    this.mesh.visible = this.n > 0;
    this.geo.setDrawRange(0, this.n * TRIS_PER * 3);
    if (this.n === 0) return;
    const count = this.n * VERTS_PER;
    for (const a of [this.pos, this.tint, this.param]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, count * 3);
      a.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geo.dispose();
  }
}

export class ContactDecals {
  /** Scene node holding both decal batches. Added to the actor group. */
  readonly mesh: THREE.Object3D;
  private pool: DecalBatch;
  private ring: DecalBatch;
  private poolMat: THREE.ShaderMaterial;
  private ringMat: THREE.ShaderMaterial;

  /** Sun direction, world space, pointing from the ground toward the sun. */
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  /** Sea level, or -Infinity when there is no water system. */
  waterY = -Infinity;

  constructor() {
    const shared = {
      vertexShader: VERT,
      depthTest: true,
      // Never occlude anything: a contact shadow is a modification of the
      // surface it lies on, not a surface of its own.
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    } as const;

    this.poolMat = new THREE.ShaderMaterial({
      ...shared,
      fragmentShader: `${AERIAL_GLSL}\n${FRAG_POOL}`,
      uniforms: { ...aerialUniforms() },
      transparent: true,
      // dst * srcAlpha + src — see FRAG_POOL. An occlusion term composited any
      // other way can brighten the surface it is supposed to be shadowing.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.SrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.ringMat = new THREE.ShaderMaterial({
      ...shared,
      fragmentShader: `${AERIAL_GLSL}\n${FRAG_RING}`,
      uniforms: { ...aerialUniforms() },
      transparent: true,
    });

    // After the water surface (5) so a shadow lands ON the sea rather than
    // under it, and after the impostor batch so it is never depth-rejected by
    // its own actor's billboard. The meniscus is drawn after the pool it sits
    // in, so a foot in the shallows reads dark ring-out-to-bright.
    this.pool = new DecalBatch(this.poolMat, 'actors:contact:pool', 7);
    this.ring = new DecalBatch(this.ringMat, 'actors:contact:ring', 8);
    this.mesh = new THREE.Group();
    this.mesh.name = 'actors:contact';
    this.mesh.add(this.pool.mesh, this.ring.mesh);
  }

  begin(): void {
    this.pool.n = 0;
    this.ring.n = 0;
  }

  /**
   * Emit one decal centred on (x, z), conformed to whatever surface is there.
   *
   * `strength` is the peak opacity; `ring` selects the waterline meniscus
   * profile over the occlusion pool. The patch is stretched away from the sun
   * so a contact shadow leans the way the light says it should instead of
   * sitting as a symmetric disc under everything.
   */
  push(
    terrain: TerrainQuery,
    x: number,
    z: number,
    radius: number,
    strength: number,
    tint: THREE.Color,
    ring: boolean,
  ): void {
    const batch = ring ? this.ring : this.pool;
    if (batch.n >= MAX_DECALS || strength <= 0.004 || radius <= 0) return;

    // Stretch along the ground-projected sun direction. At a high sun this is
    // nearly a disc; at a grazing sun the pool elongates the way the real
    // penumbra does.
    let sx = -this.sunDir.x;
    let sz = -this.sunDir.z;
    const sl = Math.hypot(sx, sz);
    let ex = 1;
    let ez = 0;
    let stretch = 1;
    if (sl > 1e-4) {
      ex = sx / sl;
      ez = sz / sl;
      const up = Math.max(0.12, Math.abs(this.sunDir.y));
      stretch = THREE.MathUtils.clamp(1 / up, 1, 2.2);
      sx = ex * radius * (stretch - 1) * 0.45;
      sz = ez * radius * (stretch - 1) * 0.45;
    } else {
      sx = 0;
      sz = 0;
    }
    // A ring marks the actual intersection with the surface and must not lean.
    if (ring) {
      sx = 0;
      sz = 0;
      stretch = 1;
    }

    const rx = radius * stretch;
    const rz = radius;
    const base = batch.n * VERTS_PER;
    const pa = batch.pos.array as Float32Array;
    const ta = batch.tint.array as Float32Array;
    const qa = batch.param.array as Float32Array;
    const cx = x + sx;
    const cz = z + sz;

    for (let j = 0; j < GRID; j++) {
      // Sample the unit square out to 1.15 so the falloff has reached zero
      // before the patch edge and no seam is visible.
      const v = (j / (GRID - 1)) * 2.3 - 1.15;
      for (let i = 0; i < GRID; i++) {
        const u = (i / (GRID - 1)) * 2.3 - 1.15;
        // Local axes: u along the sun-projected direction, v across it.
        const px = cx + (ex * u * rx - ez * v * rz);
        const pz = cz + (ez * u * rx + ex * v * rz);
        let py = terrain.heightAt(px, pz);
        if (py < this.waterY) py = this.waterY + WATER_LIFT;
        else py += 0.02;

        const o = (base + j * GRID + i) * 3;
        pa[o] = px;
        pa[o + 1] = py;
        pa[o + 2] = pz;
        ta[o] = tint.r;
        ta[o + 1] = tint.g;
        ta[o + 2] = tint.b;
        qa[o] = Math.hypot(u, v);
        qa[o + 1] = strength;
        qa[o + 2] = ring ? 1 : 0;
      }
    }
    batch.n++;
  }

  end(): void {
    this.pool.end();
    this.ring.end();
  }

  dispose(): void {
    this.pool.dispose();
    this.ring.dispose();
    this.poolMat.dispose();
    this.ringMat.dispose();
  }
}
