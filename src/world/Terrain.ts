import * as THREE from 'three';
import type { IAtmosphere, IMaterials, ITerrain } from '../core/contracts';
import type { Ctx, WeatherState } from '../core/types';
import { AERIAL_GLSL, aerialUniforms } from '../sky/Atmosphere';
import { DATA, EXTENT, Heightfield, MAX_DEPTH, RES, STEP } from './Heightfield';
import { Quadtree } from './Quadtree';
import { buildSurfaceArrays, type SurfaceArrays } from './SurfaceArray';
import {
  createTerrainMaterials,
  makeTerrainUniforms,
  resolveAerial,
  type TerrainMaterials,
  type TerrainUniforms,
} from './TerrainMaterial';

/**
 * Quads per side of the shared LOD grid. SEG must be even: the CDLOD morph
 * collapses vertex pairs onto the parent lattice with floor(g*0.5)*2, and an
 * odd SEG would leave the last 2x2 block straddling the node edge.
 */
const SEG = 32;

/**
 * Collision proxy. A heightfield needs no triangles to be raycast against —
 * marching the bilinear surface is both cheaper than a BVH over 8M triangles
 * and exactly consistent with what the vertex shader draws.
 */
class HeightfieldCollider extends THREE.Object3D {
  constructor(private hf: Heightfield) {
    super();
    this.name = 'terrain:collider';
    this.matrixAutoUpdate = false;
  }

  override raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
    const ro = raycaster.ray.origin;
    const rd = raycaster.ray.direction;
    const far = Math.min(raycaster.far, 6000);
    let t = Math.max(raycaster.near, 0.0001);
    let px = ro.x + rd.x * t;
    let pz = ro.z + rd.z * t;
    let prevDiff = ro.y + rd.y * t - this.hf.heightAt(px, pz);
    let step = 0.75;

    for (let i = 0; i < 512 && t < far; i++) {
      const nt = Math.min(t + step, far);
      px = ro.x + rd.x * nt;
      pz = ro.z + rd.z * nt;
      const diff = ro.y + rd.y * nt - this.hf.heightAt(px, pz);
      if (prevDiff > 0 && diff <= 0) {
        let lo = t;
        let hi = nt;
        for (let b = 0; b < 24; b++) {
          const mid = (lo + hi) * 0.5;
          const d = ro.y + rd.y * mid - this.hf.heightAt(ro.x + rd.x * mid, ro.z + rd.z * mid);
          if (d > 0) lo = mid;
          else hi = mid;
        }
        const point = new THREE.Vector3(ro.x + rd.x * hi, ro.y + rd.y * hi, ro.z + rd.z * hi);
        this.hf.computeNormal(point.x, point.z);
        intersects.push({
          distance: hi,
          point,
          object: this,
          normal: new THREE.Vector3(this.hf.normalX, this.hf.normalY, this.hf.normalZ),
        });
        return;
      }
      prevDiff = diff;
      t = nt;
      // Widen as the ray leaves the near field; accuracy is recovered by the
      // bisection once a crossing is bracketed.
      step = Math.min(step * 1.06, 20);
    }
  }
}

export class TerrainSystem implements ITerrain {
  readonly id = 'terrain';
  readonly order = 0;
  readonly extent = EXTENT;

  readonly collider: THREE.Object3D;

  private hf = new Heightfield();
  private qt: Quadtree | null = null;
  private uniforms: TerrainUniforms;
  private mats: TerrainMaterials | null = null;
  private surfaces: SurfaceArrays | null = null;
  private heightTex: THREE.DataTexture | null = null;
  private dataTex: THREE.DataTexture | null = null;
  private geo: THREE.InstancedBufferGeometry | null = null;
  private mesh: THREE.Mesh | null = null;
  private nodeAttr: THREE.InstancedBufferAttribute | null = null;
  private group = new THREE.Group();
  private _ready = false;

  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private shadowShift = new THREE.Vector3(0, -1, 0);
  private sunWorld = new THREE.Vector3();
  private targetWorld = new THREE.Vector3();
  private offWeather: (() => void) | null = null;
  private prepassBound = false;

  constructor() {
    this.collider = new HeightfieldCollider(this.hf);
    this.uniforms = makeTerrainUniforms(EXTENT, RES, STEP, SEG);
  }

  get ready(): boolean {
    return this._ready;
  }

  async init(ctx: Ctx): Promise<void> {
    await this.hf.build();

    this.heightTex = new THREE.DataTexture(this.hf.height, RES, RES, THREE.RedFormat, THREE.FloatType);
    this.heightTex.minFilter = THREE.NearestFilter;
    this.heightTex.magFilter = THREE.NearestFilter;
    this.heightTex.wrapS = THREE.ClampToEdgeWrapping;
    this.heightTex.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTex.generateMipmaps = false;
    this.heightTex.needsUpdate = true;

    this.dataTex = new THREE.DataTexture(this.hf.data, DATA, DATA, THREE.RGBAFormat, THREE.UnsignedByteType);
    // MIPPED, and this is the fix for the stair-stepped splat boundaries.
    //
    // uData is 1024 texels over 4000 m — 3.9 m per texel — and it was bound with
    // LinearFilter as the *minification* filter, i.e. no mip chain at all. Every
    // fragment past about 60 m therefore covers more than one texel and got a
    // single bilinear tap out of the middle of its footprint. That is point
    // sampling of a minified image: the flow, curvature, shelter and deposition
    // channels all alias, the splat weights computed from them alias with them,
    // and because the top-K selection is a *threshold* on those weights the
    // aliasing lands on the image as a hard, jagged, one-pixel-wide staircase
    // along every material boundary — the review's "pasted sticker" edge at
    // x 900-1150 in dusk and the "straight polygonal edges" on the far hill.
    // The jitter in FRAG_SPLAT was displacing that boundary organically and then
    // handing it to an aliasing fetch, so it could never help.
    //
    // With a mip chain the fetch returns the mean of the footprint, which is the
    // correct low-passed control value, and the boundary becomes a smooth curve
    // that the height blend can then interlock at grain scale. Anisotropy is
    // worth having here for the same reason it is on the surface arrays: the
    // ground plane is seen at 20:1 or worse and an isotropic mip would blur the
    // control map across the view direction far more than across the screen.
    this.dataTex.minFilter = THREE.LinearMipmapLinearFilter;
    this.dataTex.magFilter = THREE.LinearFilter;
    this.dataTex.wrapS = THREE.ClampToEdgeWrapping;
    this.dataTex.wrapT = THREE.ClampToEdgeWrapping;
    this.dataTex.generateMipmaps = true;
    this.dataTex.anisotropy = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy());
    this.dataTex.colorSpace = THREE.NoColorSpace;
    this.dataTex.needsUpdate = true;

    this.surfaces = await buildSurfaceArrays(ctx.renderer, ctx.get<IMaterials>('materials'));

    this.uniforms.uHeight.value = this.heightTex;
    this.uniforms.uData.value = this.dataTex;
    this.uniforms.uAlbArr.value = this.surfaces.albedo;
    this.uniforms.uNrmArr.value = this.surfaces.normal;
    this.uniforms.uArmArr.value = this.surfaces.arm;

    this.qt = new Quadtree(this.hf);
    this.uniforms.uMorph.value.set(this.qt.morphParams());

    // Module singletons: the sky mutates these in place every frame, so sharing
    // the objects (not copies) is what keeps terrain and sky in lockstep.
    const aerialU = aerialUniforms();
    this.mats = createTerrainMaterials(this.uniforms, resolveAerial(AERIAL_GLSL), aerialU);

    this.geo = buildGrid();
    this.nodeAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.qt.instances.length), 4);
    this.nodeAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iNode', this.nodeAttr);
    this.geo.instanceCount = 0;

    const mesh = new THREE.Mesh(this.geo, this.mats.material);
    mesh.name = 'terrain';
    mesh.frustumCulled = false; // the quadtree culls per node; the mesh is the whole world
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = this.mats.depth;
    mesh.customDistanceMaterial = this.mats.distance;
    // The render pipeline prefers this over scene.overrideMaterial, and marks
    // the shaded material non-overridable once it sees the property. Without it
    // the generic prepass shader — which has never heard of iNode or uHeight —
    // draws the terrain as coincident unit quads at the origin, and every
    // consumer of the depth/normal buffer (SSAO, contact shadows, TAA
    // reprojection) works on a world with no ground in it.
    mesh.userData.prepassMaterial = this.mats.prepass;
    mesh.renderOrder = -10; // lay down depth before the transparent/forward work
    const mainCamera = ctx.camera;
    mesh.onBeforeRender = (_r, _s, camera) => {
      if (camera === mainCamera) {
        this.selectNodes(camera);
        return;
      }
      // Any other camera — the water mirror, the refraction pass — has its own
      // frustum, so the view-culled prefix chosen for the main camera is not
      // safe for it. Hand it the whole set, which is a superset of anything it
      // can need, exactly as it received before the split.
      if (this.geo && this.qt) this.geo.instanceCount = this.qt.total;
    };
    // Casters that never reach the shaded image still have to reach the cascades.
    //
    // Handing each cascade only the nodes its own ortho box can record was
    // tried and reverted. The arithmetic said it should be the biggest win
    // available — 291 nodes against 130 visible, times a 33x33 grid, is 317k
    // vertices per cascade against 142k for the shaded pass, so three quarters
    // of all terrain vertex work in the frame is here — and the measurement
    // said 0.99x, median over five vantages, alternated three times each. The
    // per-cascade refresh schedule (ShadowCascades intervals 1/2/4) is most of
    // why: cascades one and two only redraw on every second and fourth frame,
    // so the standing cost is far below the headline number. A change that
    // cannot be shown to pay for itself is not worth the risk of a cascade
    // hole, which on this project has repeatedly printed as a hard-edged patch
    // of sunlight inside a shadow.
    mesh.onBeforeShadow = () => {
      if (this.geo && this.qt) this.geo.instanceCount = this.qt.total;
    };
    this.mesh = mesh;

    this.group.add(mesh);
    this.group.add(this.collider);
    ctx.scene.add(this.group);

    // Terrain self-shadowing at grazing sun angles is the classic acne source;
    // the caster offset in the depth material handles most of it, and a modest
    // normal bias covers the receiver side without visibly detaching contact.
    const sky = ctx.get<IAtmosphere>('sky');
    if (sky?.sun?.shadow && sky.sun.shadow.normalBias < 0.4) sky.sun.shadow.normalBias = 0.4;

    this.offWeather = ctx.bus.on<WeatherState>('weather', (w) => {
      this.uniforms.uWetness.value = w.wetness;
      // Weather extinction, normalised for the aerial pre-emphasis in the
      // fragment shader. Clear air publishes about 1e-4 and a full ash storm
      // 1.5e-2; the offset takes the clear case to exactly zero so a clear day
      // is unchanged, and the divisor puts a storm at 1. This is read ONLY to
      // decide how much the surface's own contrast has to be widened before the
      // air multiplies it down — it does not touch the fog, which belongs to the
      // sky and is applied verbatim.
      this.uniforms.uHaze.value = Math.min(1, Math.max(0, (w.fogDensity - 3e-4) / 6e-3));
    });

    // Seed a selection so the first shadow pass, which runs before any
    // onBeforeRender, has terrain to cast with.
    ctx.camera.updateMatrixWorld();
    ctx.camera.matrixWorldInverse.copy(ctx.camera.matrixWorld).invert();
    this.selectNodes(ctx.camera);

    this._ready = true;
  }

  /**
   * Adopt the pipeline's own view-projection uniform *objects* so the terrain's
   * prepass velocity is derived from the same unjittered matrices, at the same
   * frame phase, as every other object in the G-buffer. Copying the values
   * would work for one frame and then drift by one; sharing the reference
   * cannot drift. Deferred to update() because the pipeline is order 900 and
   * has not built its materials yet when terrain init runs.
   */
  private bindPrepassMatrices(ctx: Ctx): void {
    if (this.prepassBound || !this.mats) return;
    // TS `private` is compile-time only; the field is the pipeline's, we only
    // read it, and nothing under src/render is modified.
    const host = ctx.get('render') as unknown as { prepassMat?: THREE.ShaderMaterial } | undefined;
    const src = host?.prepassMat?.uniforms;
    if (!src) return;
    const dst = this.mats.prepass.uniforms;
    for (const k of ['uCurrVP', 'uPrevVP'] as const) {
      if (src[k]) dst[k] = src[k];
    }
    this.prepassBound = true;
  }

  /**
   * Follow the render pipeline's tier into the terrain fragment budget.
   *
   * Polled rather than driven off the `quality` bus event on purpose: this
   * system is order 0 and the pipeline is order 900, so at boot the event fires
   * from the pipeline's init *after* ours has run and a subscription registered
   * here would miss the only emission that matters. A tier change is a
   * once-in-a-session user action, so a string compare per frame is the right
   * price for not having an ordering dependency.
   */
  private tq = -1;
  private syncQuality(ctx: Ctx): void {
    const tier = (ctx.get('render') as unknown as { quality?: string } | undefined)?.quality ?? 'high';
    const lvl = tier === 'low' ? 0 : tier === 'medium' ? 1 : tier === 'ultra' ? 3 : 2;
    if (lvl === this.tq) return;
    this.tq = lvl;
    this.mats?.setQuality(lvl);
  }

  update(ctx: Ctx): void {
    if (!this._ready) return;

    this.bindPrepassMatrices(ctx);
    this.syncQuality(ctx);
    this.uniforms.uTime.value = ctx.time.elapsed;

    const sun = ctx.get<IAtmosphere>('sky')?.sun;
    if (sun) {
      sun.getWorldPosition(this.sunWorld);
      sun.target.getWorldPosition(this.targetWorld);
      this.shadowShift.subVectors(this.targetWorld, this.sunWorld);
      const l2 = this.shadowShift.lengthSq();
      if (l2 > 1e-6 && isFinite(l2)) this.shadowShift.multiplyScalar(1 / Math.sqrt(l2));
      else this.shadowShift.set(0, -1, 0);
    }
  }

  /**
   * LOD runs from onBeforeRender rather than update(): terrain is order 0 but
   * the player moves the camera at order 90, so selecting here is the only way
   * to avoid a frame of lag in the near-field tessellation. The shadow pass,
   * which three renders earlier, reuses the previous selection — acceptable
   * because the selection already over-includes along the cast direction.
   */
  private selectNodes(camera: THREE.Camera): void {
    if (!this.qt || !this.nodeAttr || !this.geo) return;
    // uEye is written here and nowhere else, so the vertex morph is a function
    // of the same eye point that chose the node set. The shadow pass runs
    // before this and therefore uses the previous frame's pair — self-consistent,
    // which is what matters; a caster morphed to a *different* eye than its
    // receiver is what lays a periodic acne lattice over every slope.
    camera.getWorldPosition(this.uniforms.uEye.value);
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const n = this.qt.select(camera, this.frustum, this.shadowShift);
    const arr = this.nodeAttr.array as Float32Array;
    arr.set(this.qt.instances.subarray(0, n * 4));
    this.nodeAttr.clearUpdateRanges();
    this.nodeAttr.addUpdateRange(0, n * 4);
    this.nodeAttr.needsUpdate = true;
    // The shaded pass and the prepass draw only the visible prefix; the shadow
    // cascades re-raise this to qt.total in onBeforeShadow. Both blocks are
    // uploaded either way, so the pair is one buffer and one draw call still.
    this.geo.instanceCount = this.qt.count;
  }

  // ---------------------------------------------------------------- queries

  heightAt(x: number, z: number): number {
    return this.hf.heightAt(x, z);
  }

  normalAt(x: number, z: number, out?: THREE.Vector3): THREE.Vector3 {
    this.hf.computeNormal(x, z);
    const v = out ?? new THREE.Vector3();
    return v.set(this.hf.normalX, this.hf.normalY, this.hf.normalZ);
  }

  materialAt(x: number, z: number): number {
    return this.hf.materialAt(x, z);
  }

  dispose(): void {
    this.offWeather?.();
    this.offWeather = null;
    this.group.removeFromParent();
    this.group.clear();
    this.geo?.dispose();
    this.mats?.dispose();
    this.surfaces?.dispose();
    this.heightTex?.dispose();
    this.dataTex?.dispose();
    this.geo = null;
    this.mesh = null;
    this.mats = null;
    this.surfaces = null;
    this.heightTex = null;
    this.dataTex = null;
    this._ready = false;
  }
}

/**
 * One grid, reused by every node at every level. Positions are normalised to
 * [0,1]; the vertex shader maps them into the node's world rectangle. That is
 * what collapses the whole terrain to a single instanced draw call.
 */
function buildGrid(): THREE.InstancedBufferGeometry {
  // SEG+1. There is no skirt, and there must not be one.
  //
  // The previous build walled every node in with a vertical curtain 2 m + 6% of
  // the node size deep. That does close a crack, but a curtain is not invisible:
  // it hangs *down* from the node boundary, so wherever the ground falls away on
  // the far side of a boundary — a plateau lip, the back of a dune, any convex
  // break — the curtain stands proud of the surface behind it and clips it. The
  // boundary is a straight line in world space, so what the frame shows is a
  // dead-straight cut across the landform with everything behind it missing.
  // That is exactly the "chunk seam running the full frame width" and the 1 px
  // seams the review measured; at depth 3 the curtain is 32 m tall and can eat a
  // whole ridge. Hiding a crack behind an artefact that is larger than the crack
  // is not a fix.
  //
  // The morph in VERT_BODY is watertight on its own, and provably so — see the
  // derivation in Quadtree plus the block-parity argument there. What the old
  // comment here listed as uncovered cases do not in fact reach the frame: the
  // instance cap is 2600 against a measured worst case near 300, and the node
  // bounds in Heightfield.buildPyramid already carry the two-sample B-spline
  // halo so a node cannot be culled while its surface is on screen. The shadow
  // pass runs a frame-stale *pair* (node set and uEye together), which is
  // self-consistent and therefore also watertight.
  const n = SEG + 1;
  const pos = new Float32Array(n * n * 3);
  const nor = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      pos[k * 3] = i / SEG;
      pos[k * 3 + 1] = 0;
      pos[k * 3 + 2] = j / SEG;
      nor[k * 3 + 1] = 1;
      uvs[k * 2] = i / SEG;
      uvs[k * 2 + 1] = j / SEG;
    }
  }
  const idx = new Uint16Array((n - 1) * (n - 1) * 6);
  let o = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      idx[o++] = a;
      idx[o++] = c;
      idx[o++] = b;
      idx[o++] = b;
      idx[o++] = c;
      idx[o++] = d;
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.5, 0, 0.5), 1);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 1));
  return g;
}

export { MAX_DEPTH };
