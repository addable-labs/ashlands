import * as THREE from 'three';
import { FIELD_GLSL, type TerrainField } from './Field';
import { GC_LADDER, GROUND_VERT_PARS, type GroundOpts } from './Ground';
import { HASH_GLSL } from './Glsl';
import { toroidalPoisson } from './Noise';

/**
 * GROUND CONTACT.
 *
 * The art bible's rule #1 — "every object darkens where it meets the ground;
 * objects that appear to hover are the #1 amateur tell" — was being answered
 * with two things, and neither of them can do the job on its own:
 *
 *  1. baked per-vertex occlusion at the foot of each plant. That darkens the
 *     PLANT. It cannot darken the GROUND, so the terrain runs at full sunlit
 *     value right up to the intersection line and the junction reads as a decal
 *     laid on a photograph. Four separate reviews measured exactly that: "the
 *     stalk terminates at the terrain with a clean intersection line and
 *     identical albedo above and below".
 *
 *  2. the cascaded shadow map. That is a light-direction term, so it vanishes
 *     precisely when it is most needed: at night (no sun at all — the night
 *     review's blocker), under an ash storm (the key light is a fifth of its
 *     clear-sky value and fully diffuse), and whenever the sun happens to sit
 *     behind the object, where the contact shadow falls away from the camera.
 *     A contact term that only exists in one lighting condition is not a
 *     contact term.
 *
 * What was missing is the view- AND light-independent half: ambient occlusion
 * projected onto the ground. This module supplies it as a multiply-blended
 * decal that conforms to the same heightfield the plants are planted against,
 * so the darkening is registered with the geometry at any camera angle, at any
 * hour, and at any LOD — including the LODs and the frames in which no shadow
 * is being cast at all.
 *
 * Two feeders, because flora has two placement systems:
 *
 *  - `ContactPool` is CPU-fed from Canopy.select, which already walks every
 *    visible instance and already knows its footprint radius.
 *  - `GroundContact` is a GPU tile ring that re-runs the ground-cover survival
 *    ladder verbatim (see GC_LADDER in Ground.ts) so its decals land under the
 *    same mushrooms the ground-cover pass draws, without either side having to
 *    communicate.
 *
 * Cost. Both are alpha-blended with depth writes off, so the render pipeline
 * skips them in the G-buffer prepass automatically, and neither casts or
 * receives a shadow. The decal mesh is 21 vertices and 30 triangles, the
 * canopy pool is capped at 900 instances inside 90 m, and the ground ring is
 * cut to a 9x9 tile window — roughly a fifth of the radius the fungus layer
 * itself covers, because an AO skirt on a 40 cm mushroom is sub-pixel long
 * before the mushroom is.
 */

/** How far a canopy contact decal is drawn. Past this it is under a pixel. */
export const CANOPY_RANGE = 90;
/** Instance ceiling for the canopy pool. */
const CANOPY_CAP = 900;

/**
 * The occlusion colour at full strength.
 *
 * Not neutral grey, and the reason is physical rather than decorative. What a
 * contact skirt occludes is the SKY, and on this world the sky is the cool half
 * of the illuminant — so ground that cannot see it keeps proportionally more of
 * the warm bounce off the ash. A neutral multiply would take the junction
 * toward blue-grey, which on an ochre plain reads as a painted drop shadow.
 */
const AO_TINT = new THREE.Vector3(0.505, 0.485, 0.455);

/**
 * A radial disc as a triangle fan: centre, then two rings.
 *
 * Two rings rather than one because the decal has to CONFORM: the outer ring
 * samples the heightfield at its own world position, and with a single ring a
 * five-metre parasol skirt on a slope is one flat plane cutting through the
 * terrain it is meant to be lying on. The inner ring costs ten vertices and
 * halves the chord error.
 *
 * `position.xz` is the unit disc; `position.y` carries the normalised radius so
 * the fragment shader does not have to recompute it.
 */
function decalDisc(): THREE.BufferGeometry {
  const SEG = 10;
  const pos: number[] = [0, 0, 0];
  const idx: number[] = [];
  for (let r = 1; r <= 2; r++) {
    const rr = r / 2;
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      pos.push(Math.cos(a) * rr, rr, Math.sin(a) * rr);
    }
  }
  for (let i = 0; i < SEG; i++) {
    const j = (i + 1) % SEG;
    idx.push(0, 1 + i, 1 + j);
    idx.push(1 + i, 1 + SEG + i, 1 + SEG + j, 1 + i, 1 + SEG + j, 1 + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/**
 * The shared fragment.
 *
 * `vAO` is the occlusion this fragment applies, already faded by range and by
 * the instance's own strength. The output is a MULTIPLIER on the framebuffer
 * (MultiplyBlending), which is what makes this a darkening of whatever the
 * terrain shader decided rather than a grey sprite laid over it — the two
 * differ the moment the ground is wet, lit by a fissure, or in shadow already.
 *
 * The falloff is quartic-ish rather than linear. A linear ramp has a visible
 * outer edge because the eye finds the discontinuity in the derivative; taking
 * the square of a smoothstep puts the whole transition inside the noise floor.
 */
const DECAL_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uAoTint;
varying float vAO;
void main() {
  if (vAO <= 0.002) discard;
  gl_FragColor = vec4(mix(vec3(1.0), uAoTint, vAO), 1.0);
}
`;

function decalMaterial(uniforms: Record<string, THREE.IUniform>, vert: string): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: DECAL_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.MultiplyBlending,
    /**
     * Required, and three warns loudly without it: MultiplyBlending is
     * implemented as blendFuncSeparate(ZERO, SRC_COLOR, ZERO, SRC_ALPHA), and
     * the separate alpha term is only set up on the premultiplied path. Without
     * this flag the state manager falls back and the decal writes its own
     * colour instead of scaling the framebuffer's — i.e. the AO skirt renders
     * as a white slab, which is what it did the first time this was captured.
     */
    premultipliedAlpha: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  return m;
}

/* ------------------------------------------------------------- canopy pool */

const CANOPY_DECAL_VERT = /* glsl */ `
${FIELD_GLSL}
uniform vec3  uEyePos;
// x,z = world centre, y = radius (m), w = strength
attribute vec4 iDecal;
varying float vAO;
void main() {
  float rN = position.y;
  vec2 wp = iDecal.xy + position.xz * iDecal.z;
  /**
   * The decal samples the SAME heightfield the plant was planted against, at
   * its own world position, so it follows the ground under a wide skirt on a
   * slope instead of being one plane through it.
   *
   * The lift is a function of the radius, not a constant: the terrain the decal
   * sits on is a CDLOD interpolant of this field and the two disagree by more
   * over a wider span. Two centimetres plus a percent of the radius keeps a
   * five-metre parasol skirt above the triangles it lies on without ever being
   * far enough off the ground to be seen as a floating disc — nothing is drawn
   * here except a multiplier.
   */
  float h = fieldHeight(wp) + 0.02 + iDecal.z * 0.012;
  vec4 mv = viewMatrix * vec4(wp.x, h, wp.y, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = distance(uEyePos.xz, iDecal.xy);
  float fade = 1.0 - smoothstep(${(CANOPY_RANGE * 0.55).toFixed(1)}, ${CANOPY_RANGE.toFixed(1)}, d);
  float k = 1.0 - smoothstep(0.0, 1.0, rN);
  vAO = iDecal.w * k * k * fade;
}
`;

/**
 * One instanced disc shared by every canopy species.
 *
 * Fed per frame from Canopy.select, which is already walking the visible set —
 * so the whole rig costs one buffer upload and one draw call, and nothing at
 * all on a frame where the camera has not moved (the selection is skipped).
 */
export class ContactPool {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private attr: THREE.InstancedBufferAttribute;
  private data: Float32Array;
  private n = 0;
  private mat: THREE.ShaderMaterial;

  constructor(field: TerrainField) {
    const src = decalDisc();
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', src.getAttribute('position'));
    geo.setIndex(src.getIndex());
    this.data = new Float32Array(CANOPY_CAP * 4);
    this.attr = new THREE.InstancedBufferAttribute(this.data, 4);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iDecal', this.attr);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = geo;

    this.mat = decalMaterial(
      {
        uAoTint: { value: AO_TINT.clone() },
        uEyePos: { value: new THREE.Vector3() },
        uHeightTex: { value: field.heightTex },
        uEcoTex: { value: field.ecoTex },
        uFieldParams: { value: field.params() },
      },
      CANOPY_DECAL_VERT,
    );
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.name = 'flora:contact:canopy';
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // Before every other transparent surface in the world. A darkening applied
    // after a water sheet or a dust plume would darken THEM, and the thing it
    // is meant to darken is the ground under a mushroom.
    mesh.renderOrder = -50;
    this.mesh = mesh;
  }

  begin(camPos: THREE.Vector3): void {
    this.n = 0;
    (this.mat.uniforms.uEyePos.value as THREE.Vector3).copy(camPos);
  }

  /** `r` is the plant's ground footprint radius in metres. */
  push(x: number, z: number, r: number, strength: number): void {
    if (this.n >= CANOPY_CAP) return;
    const o = this.n * 4;
    this.data[o] = x;
    this.data[o + 1] = z;
    this.data[o + 2] = r;
    this.data[o + 3] = strength;
    this.n++;
  }

  end(): void {
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n > 0) this.attr.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.removeFromParent();
  }
}

/* -------------------------------------------------------- ground-cover ring */

/**
 * The decal placement, appended to the shared ladder.
 *
 * Everything above this in the program is GC_LADDER — byte for byte the code
 * the ground-cover pass runs — so `wxz`, `gcH`, `gcN` and `gcBw` here are the
 * same numbers that mushroom is drawn with. The disc is 0.78 of the instance's
 * own width draw, which is about 1.4x the widest the cap ever opens to, and it
 * lies on the terrain's TANGENT PLANE: over a sixty-centimetre span the
 * heightfield's departure from its own tangent is well under a millimetre, so
 * a second set of texture fetches would buy nothing.
 */
const GROUND_DECAL_VERT = /* glsl */ `
${HASH_GLSL}
${GROUND_VERT_PARS}
uniform float uShadowPass;
uniform float uGCContactRange;
varying float vAO;
void main() {
${GC_LADDER}
  float rN = position.y;
  float rad = gcBw * 0.66;
  vec2 dxz = position.xz * rad;
  float yC = gcH - dot(gcN.xz, dxz) / max(gcN.y, 0.35) + 0.018;
  vec4 mv = viewMatrix * vec4(wxz.x + dxz.x, yC, wxz.y + dxz.y, 1.0);
  gl_Position = projectionMatrix * mv;
  float fade = 1.0 - smoothstep(uGCContactRange * 0.6, uGCContactRange, gcDist);
  float k = 1.0 - smoothstep(0.0, 1.0, rN);
  // Deeper under a big cap than under a button: a wider cap shades more ground.
  /**
   * Modest, because these MULTIPLY.
   *
   * A troop of ground fungus is half a dozen caps inside a couple of metres, so
   * three or four skirts overlap on the same texel routinely; at the strength a
   * single isolated decal would want, the product under a troop goes to a
   * crushed black hole. A third under one cap compounds to roughly a half under
   * three, which is what a real colony's shaded floor looks like — and the art
   * bible forbids crushed black outright.
   */
  vAO = (0.21 + 0.13 * clamp(gcBw * 1.6, 0.0, 1.0)) * k * k * fade;
}
`;

/**
 * The AO ring for the ground fungus.
 *
 * Constructed from the SAME GroundOpts object as its GroundCover, and handed
 * that layer's own draw distance, because `uGCParams.z` is an input to the
 * survival ladder: give the ring a different one and it thins a different set
 * of instances, and the decals stop landing under the mushrooms. The only
 * thing that differs is how many TILES are submitted, which is a pure CPU-side
 * window and cannot change which instances survive.
 */
export class GroundContact {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private tileTex: THREE.DataTexture;
  private tileData: Float32Array;
  private pointTex: THREE.DataTexture;
  private offs: { x: number; y: number; d: number }[] = [];
  private readonly tile: number;
  private readonly perTile: number;
  private readonly range: number;
  private box = new THREE.Box3();
  private field: TerrainField;

  constructor(opts: GroundOpts, field: TerrainField, layerDrawDist: number, ring: number) {
    this.tile = opts.tile;
    this.perTile = opts.perTile;
    this.field = field;
    const half = (ring - 1) / 2;
    this.range = (half - 1) * opts.tile;

    for (let j = -half; j <= half; j++) {
      for (let i = -half; i <= half; i++) this.offs.push({ x: i, y: j, d: i * i + j * j });
    }
    this.offs.sort((a, b) => a.d - b.d);
    const tw = Math.ceil(Math.sqrt(this.offs.length));
    this.tileData = new Float32Array(tw * tw * 4);
    this.tileTex = new THREE.DataTexture(this.tileData, tw, tw, THREE.RGBAFormat, THREE.FloatType);
    this.tileTex.minFilter = THREE.NearestFilter;
    this.tileTex.magFilter = THREE.NearestFilter;
    this.tileTex.needsUpdate = true;

    // Identical call to the one GroundCover makes, so the point set is the same
    // point set. Anything else and every decal is offset by a random vector.
    const pts = toroidalPoisson(opts.perTile, 0x51fa + opts.seed * 7717);
    const pdata = new Float32Array(opts.perTile * 4);
    for (let i = 0; i < opts.perTile; i++) {
      pdata[i * 4] = pts[i * 2];
      pdata[i * 4 + 1] = pts[i * 2 + 1];
    }
    this.pointTex = new THREE.DataTexture(pdata, opts.perTile, 1, THREE.RGBAFormat, THREE.FloatType);
    this.pointTex.minFilter = THREE.NearestFilter;
    this.pointTex.magFilter = THREE.NearestFilter;
    this.pointTex.needsUpdate = true;

    const total = this.offs.length * opts.perTile;
    const src = decalDisc();
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', src.getAttribute('position'));
    geo.setIndex(src.getIndex());
    const idxArr = new Float32Array(total);
    for (let i = 0; i < total; i++) idxArr[i] = i;
    geo.setAttribute('aIdx', new THREE.InstancedBufferAttribute(idxArr, 1));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = geo;

    this.mat = decalMaterial(
      {
        uAoTint: { value: AO_TINT.clone() },
        uGCContactRange: { value: this.range },
        uShadowPass: { value: 0 },
        uGCParams: {
          value: new THREE.Vector4(opts.tile, opts.perTile, layerDrawDist, opts.glowFrac),
        },
        uGCChan: { value: new THREE.Vector4(...opts.chan) },
        uGCShape: { value: new THREE.Vector4(...opts.shape) },
        uGCCenterTile: { value: new THREE.Vector2() },
        uGCDensity: { value: opts.density },
        uGCVar: {
          value: new THREE.Vector4(
            opts.template === 'fungus' ? 1 : 0,
            opts.lean ?? 0.16,
            opts.distMin ?? 0,
            opts.patchPhase,
          ),
        },
        uGCStand: {
          value: new THREE.Vector4(
            opts.dominance[0],
            opts.dominance[1],
            opts.dominance[2],
            opts.emergent,
          ),
        },
        uGCTuft: { value: new THREE.Vector2(opts.tuft[0], opts.tuft[1]) },
        uEyePos: { value: new THREE.Vector3() },
        uTileTex: { value: this.tileTex },
        uPointTex: { value: this.pointTex },
        uTileTexSize: { value: new THREE.Vector2(tw, tw) },
        uHeightTex: { value: field.heightTex },
        uEcoTex: { value: field.ecoTex },
        uFieldParams: { value: field.params() },
      },
      GROUND_DECAL_VERT,
    );

    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.name = `flora:contact:${opts.id}`;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = -50;
    this.mesh = mesh;
  }

  update(camPos: THREE.Vector3, frustum: THREE.Frustum): void {
    const T = this.tile;
    const cx = Math.floor(camPos.x / T);
    const cz = Math.floor(camPos.z / T);
    const u = this.mat.uniforms;
    (u.uGCCenterTile.value as THREE.Vector2).set(cx, cz);
    (u.uEyePos.value as THREE.Vector3).copy(camPos);

    const far = this.range + T;
    const far2 = far * far;
    let n = 0;
    for (const o of this.offs) {
      const x0 = (cx + o.x) * T;
      const z0 = (cz + o.y) * T;
      const dx = Math.max(x0 - camPos.x, 0, camPos.x - (x0 + T));
      const dz = Math.max(z0 - camPos.z, 0, camPos.z - (z0 + T));
      if (dx * dx + dz * dz > far2) continue;
      const h = this.field.heightAt(x0 + T * 0.5, z0 + T * 0.5);
      this.box.min.set(x0, h - T, z0);
      this.box.max.set(x0 + T, h + T, z0 + T);
      if (!frustum.intersectsBox(this.box)) continue;
      this.tileData[n * 4] = o.x;
      this.tileData[n * 4 + 1] = o.y;
      n++;
    }
    this.tileTex.needsUpdate = true;
    this.geo.instanceCount = n * this.perTile;
    this.mesh.visible = n > 0;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.tileTex.dispose();
    this.pointTex.dispose();
    this.mesh.removeFromParent();
  }
}
