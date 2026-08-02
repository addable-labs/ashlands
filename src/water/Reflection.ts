import * as THREE from 'three';

/**
 * Planar reflection and refraction targets for the sea plane at y = 0.
 *
 * The reflection uses a mirrored camera with Lengyel's oblique near-plane clip,
 * which folds the water plane into the near plane of the projection matrix so
 * nothing below the surface is ever drawn into the target — no user clip planes,
 * no per-material work, and correct for arbitrary camera orientation.
 *
 * Both targets are half resolution and half-float, so they carry the same linear
 * HDR values the main pass produces (the renderer applies no output transform
 * when drawing into a render target).
 */

const REFLECTION_MAX = 1280;
/**
 * Far plane of the refraction/beach pass.
 *
 * This is not only the depth Beer-Lambert can see through — it is also the reach
 * of the screen-space beach pass, which reconstructs world position from this
 * target's depth and draws the wet-sand collar and the swash line. At 600 m a
 * shoreline anywhere but at the viewer's feet fell outside it entirely, so a
 * coast framed from a dune three hundred metres back rendered with no wet band
 * and no surf at all — the sand met the sea at exactly the same value.
 */
const REFRACTION_FAR = 1400;

function makeTarget(w: number, h: number, withDepth: boolean, mips = false): THREE.WebGLRenderTarget {
  const opts: THREE.RenderTargetOptions = {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    // A glossy reflection has to integrate the target over the cone the
    // unresolved facets span. The mip chain is that integral; without it the
    // only options are a point tap (which aliases) or throwing the reflection
    // away past the near field (which is what turned the sea into a flat
    // sheet). Three regenerates it at the end of every render into the target.
    minFilter: mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: mips,
    depthBuffer: true,
    stencilBuffer: false,
  };
  if (withDepth) {
    const d = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    d.format = THREE.DepthFormat;
    d.minFilter = THREE.NearestFilter;
    d.magFilter = THREE.NearestFilter;
    opts.depthTexture = d;
  }
  const rt = new THREE.WebGLRenderTarget(w, h, opts);
  rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
  return rt;
}

export class WaterTargets {
  readonly reflection: THREE.WebGLRenderTarget;
  readonly refraction: THREE.WebGLRenderTarget;

  /** View-projection matrices the targets were actually rendered with. Sampling
   *  by re-projecting the surface point through these keeps a stale target
   *  correctly registered when the camera has moved since. */
  readonly reflectionVP = new THREE.Matrix4();
  readonly refractionVP = new THREE.Matrix4();
  readonly refractionNearFar = new THREE.Vector2(0.1, REFRACTION_FAR);

  reflectionValid = 0;
  refractionValid = 0;

  private mirrorCam = new THREE.PerspectiveCamera();
  private refrCam = new THREE.PerspectiveCamera();
  private clipPlane = new THREE.Vector4();
  private planeCS = new THREE.Plane();
  private q = new THREE.Vector4();
  private seaPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private rot = new THREE.Matrix4();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private prevClear = new THREE.Color();

  /** Reflection-target pixels per radian, for the glossy mip select. */
  reflectionPixPerRad = 1;

  constructor(w: number, h: number) {
    const [rw, rh] = this.reflectionSize(w, h);
    this.reflection = makeTarget(rw, rh, false, true);
    this.refraction = makeTarget(Math.max(2, w >> 1), Math.max(2, h >> 1), true);
  }

  private reflectionSize(w: number, h: number): [number, number] {
    const scale = Math.min(1, REFLECTION_MAX / Math.max(1, w));
    return [Math.max(2, Math.round((w * scale) / 2)), Math.max(2, Math.round((h * scale) / 2))];
  }

  resize(w: number, h: number): void {
    const [rw, rh] = this.reflectionSize(w, h);
    this.reflection.setSize(rw, rh);
    this.refraction.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));
  }

  /**
   * Renders the scene mirrored about y = 0 with an oblique clip. `hide` is
   * toggled off for the duration so the water never reflects itself.
   */
  renderReflection(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    hide: THREE.Object3D[],
  ): void {
    const cam = this.mirrorCam;
    // Shallow copy: Object3D.copy clones the child list by default, and the
    // player rig hangs things off the camera.
    cam.copy(camera, false);

    // Build the virtual camera from a mirrored eye/target/up rather than by
    // premultiplying a reflection matrix: lookAt re-orthonormalises into a
    // right-handed basis, so triangle winding — and therefore backface culling —
    // stays correct without touching material state.
    this.tmpA.setFromMatrixPosition(camera.matrixWorld);
    this.rot.extractRotation(camera.matrixWorld);
    this.tmpB.set(0, 0, -1).applyMatrix4(this.rot).add(this.tmpA);

    cam.position.set(this.tmpA.x, -this.tmpA.y, this.tmpA.z);
    cam.up.set(0, 1, 0).applyMatrix4(this.rot);
    cam.up.y = -cam.up.y;
    cam.lookAt(this.tmpB.x, -this.tmpB.y, this.tmpB.z);
    cam.updateMatrixWorld(true);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    cam.projectionMatrix.copy(camera.projectionMatrix);

    // Lengyel oblique near plane, expressed in the mirror camera's view space.
    this.planeCS.copy(this.seaPlane).applyMatrix4(cam.matrixWorldInverse);
    this.clipPlane.set(this.planeCS.normal.x, this.planeCS.normal.y, this.planeCS.normal.z, this.planeCS.constant);

    const p = cam.projectionMatrix.elements;
    this.q.set(
      (Math.sign(this.clipPlane.x) + p[8]) / p[0],
      (Math.sign(this.clipPlane.y) + p[9]) / p[5],
      -1,
      (1 + p[10]) / p[14],
    );
    const c = this.clipPlane.multiplyScalar(2 / this.clipPlane.dot(this.q));
    p[2] = c.x;
    p[6] = c.y;
    // Small bias: without it, geometry sitting exactly on the waterline gets
    // clipped and opens a hairline gap along every shore in the reflection.
    p[10] = c.z + 1 - 0.0025;
    p[14] = c.w;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();

    const prevSide = renderer.getRenderTarget();
    const restore = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;

    // Clear to a *transparent* black, so the target's alpha channel comes back
    // as a per-texel coverage mask: 1 where the mirrored scene drew something,
    // 0 where the mirror camera saw nothing at all.
    //
    // It sees nothing far more often than one would expect, and that is the
    // reason this matters. The sky is a dome of radius 10 m pinned to the MAIN
    // camera; the mirror eye sits 2*height below it, which for any viewer more
    // than five metres above the sea is outside that dome entirely. The mirror
    // pass therefore renders no sky at all, and everything below the water plane
    // is removed by the oblique clip — so the target is very nearly empty, and a
    // shader that trusted it unconditionally was multiplying the Fresnel term by
    // black. Measured on the night frame: reflected radiance 0.0005 against a sky
    // of 0.017, i.e. the sea reflecting a thirtieth of what was above it.
    //
    // With coverage carried in alpha the shader composites the target OVER the
    // analytic sky radiance instead, which is the same atmosphere integral the
    // dome itself runs. Nothing here depends on how the sky subsystem chooses to
    // draw itself.
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.prevClear);
    renderer.setClearColor(0x000000, 0);

    renderer.setRenderTarget(this.reflection);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevSide);

    renderer.setClearColor(this.prevClear, prevAlpha);
    for (let i = 0; i < hide.length; i++) hide[i].visible = restore[i];

    this.reflectionVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.reflectionValid = 1;
    // Angular pixel size of the target, which is what converts a GGX width into
    // a mip level in the shader.
    this.reflectionPixPerRad = this.reflection.height / (2 * Math.tan((cam.fov * Math.PI) / 360));
  }

  /**
   * Scene colour + depth from the main viewpoint with the water removed. The far
   * plane is pulled in hard: refraction only ever reads geometry a few tens of
   * metres away, and the shortened frustum culls most of the island.
   */
  renderRefraction(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    hide: THREE.Object3D[],
  ): void {
    const cam = this.refrCam;
    cam.copy(camera, false);
    cam.far = REFRACTION_FAR;
    cam.updateProjectionMatrix();
    // Decompose rather than assign matrixWorld: the main camera may be parented
    // to the player rig, so its local transform is not its world transform.
    camera.matrixWorld.decompose(cam.position, cam.quaternion, cam.scale);
    cam.updateMatrixWorld(true);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();

    const prevTarget = renderer.getRenderTarget();
    const restore = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;

    renderer.setRenderTarget(this.refraction);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);

    for (let i = 0; i < hide.length; i++) hide[i].visible = restore[i];

    this.refractionVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.refractionNearFar.set(cam.near, cam.far);
    this.refractionValid = 1;
  }

  dispose(): void {
    this.reflection.depthTexture?.dispose();
    this.refraction.depthTexture?.dispose();
    this.reflection.dispose();
    this.refraction.dispose();
  }
}
