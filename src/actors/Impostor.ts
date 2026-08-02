import * as THREE from 'three';
import { makeImpostorMaterial, makeImpostorPrepassMaterial } from './ActorMaterials';

/**
 * Far-LOD billboard impostors.
 *
 * A yaw ring of pre-rendered views per species, baked once at load into two
 * atlases: albedo with coverage in alpha, and view-space normals. Because the
 * billboard turns to face the camera and the tile is chosen by the *relative*
 * yaw, the captured normals are already the normals that view would see, so the
 * impostor can be lit live by the same sun as everything else instead of
 * carrying baked-in lighting that breaks the moment the sun moves.
 *
 * Everything past the skinned and reduced-bone tiers renders here, in a single
 * instanced draw for the whole world.
 */

/** Views around the yaw ring. 8 is the point where the pop stops being visible. */
export const IMPOSTOR_TILES = 8;
const TILE = 160;
/** Capture elevation. Creatures are usually seen from slightly above. */
const ELEVATION = (12 * Math.PI) / 180;

export interface ImpostorRow {
  row: number;
  /** Half-extent the tile was framed at — the billboard's world size. */
  size: number;
  /** Height of the model's centre above its feet, for billboard placement. */
  centreY: number;
}

export class ImpostorAtlas {
  readonly albedo: THREE.WebGLRenderTarget;
  readonly normal: THREE.WebGLRenderTarget;
  readonly rows: ImpostorRow[] = [];
  private nextRow = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private capacity: number,
  ) {
    const w = IMPOSTOR_TILES * TILE;
    const h = capacity * TILE;
    const opts: THREE.RenderTargetOptions = {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    this.albedo = new THREE.WebGLRenderTarget(w, h, opts);
    this.normal = new THREE.WebGLRenderTarget(w, h, opts);
    // Linear storage on both: the impostor shader wants radiance, and the
    // normal atlas is not colour at all.
    this.albedo.texture.colorSpace = THREE.NoColorSpace;
    this.normal.texture.colorSpace = THREE.NoColorSpace;

    const prev = renderer.getRenderTarget();
    const c = new THREE.Color();
    renderer.getClearColor(c);
    const a = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    for (const rt of [this.albedo, this.normal]) {
      renderer.setRenderTarget(rt);
      renderer.clear(true, true, false);
    }
    renderer.setClearColor(c, a);
    renderer.setRenderTarget(prev);
  }

  /**
   * Bake one species. The mesh is rendered in bind pose — which is exactly the
   * rest pose the rig was authored in — from a ring of yaws.
   */
  bake(geo: THREE.BufferGeometry, materials: THREE.Material[]): ImpostorRow {
    if (this.nextRow >= this.capacity) throw new Error('[actors] impostor atlas full');
    const row = this.nextRow++;

    const box = geo.boundingBox ?? new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position') as THREE.BufferAttribute);
    const size = new THREE.Vector3();
    box.getSize(size);
    const centre = new THREE.Vector3();
    box.getCenter(centre);
    const half = Math.max(size.x, size.y, size.z) * 0.55;

    const scene = new THREE.Scene();
    // Material swaps below alternate between the per-group array and a single
    // override, so the mesh is typed for both.
    const mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]> = new THREE.Mesh(geo, materials);
    scene.add(mesh);

    // Unlit albedo: copy map and tint off the real materials so the impostor
    // matches the skinned mesh it replaces.
    const basics = materials.map((m) => {
      const s = m as THREE.MeshStandardMaterial;
      const b = new THREE.MeshBasicMaterial({
        color: s.color !== undefined ? s.color.clone() : new THREE.Color(0xffffff),
        map: s.map ?? null,
        side: s.side,
      });
      return b;
    });
    const normalMat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });

    const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, half * 8);
    const prevRT = this.renderer.getRenderTarget();
    const prevAuto = this.renderer.autoClear;
    const prevScissor = this.renderer.getScissorTest();
    // The background of every tile must stay at alpha 0 — it is the coverage
    // mask the runtime shader discards against. Whatever the renderer's clear
    // alpha happens to be when a species is baked (the pipeline leaves it at 1)
    // would otherwise fill the tile with opaque black, and each impostor would
    // draw as a solid dark quad instead of a cut-out silhouette.
    const prevClear = new THREE.Color();
    this.renderer.getClearColor(prevClear);
    const prevClearAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    this.renderer.setScissorTest(true);

    for (let t = 0; t < IMPOSTOR_TILES; t++) {
      // Tile t is the view from the direction that is t/TILES of a turn away
      // from the model's own +Z. The runtime shader inverts the same mapping.
      const yaw = (t / IMPOSTOR_TILES) * Math.PI * 2;
      const d = half * 4;
      cam.position.set(
        centre.x + Math.sin(yaw) * Math.cos(ELEVATION) * d,
        centre.y + Math.sin(ELEVATION) * d,
        centre.z + Math.cos(yaw) * Math.cos(ELEVATION) * d,
      );
      cam.up.set(0, 1, 0);
      cam.lookAt(centre);
      cam.updateMatrixWorld(true);

      const x = t * TILE;
      const y = row * TILE;

      // setRenderTarget re-applies the target's own viewport and scissor, so it
      // has to come FIRST — setting them before the bind silently discards them
      // and every tile renders across the whole atlas instead of its own cell.
      // setRenderTarget re-applies the target's own viewport, scissor and
      // scissorTest, so all three have to be (re)set AFTER the bind. Setting
      // them before is silently discarded, and leaving scissorTest to the
      // target's default (false) lets each tile's clear wipe the whole atlas —
      // which left only the very last tile baked.
      mesh.material = basics;
      this.renderer.setRenderTarget(this.albedo);
      this.renderer.setViewport(x, y, TILE, TILE);
      this.renderer.setScissor(x, y, TILE, TILE);
      this.renderer.setScissorTest(true);
      this.renderer.clear(true, true, false);
      this.renderer.render(scene, cam);

      mesh.material = normalMat;
      this.renderer.setRenderTarget(this.normal);
      this.renderer.setViewport(x, y, TILE, TILE);
      this.renderer.setScissor(x, y, TILE, TILE);
      this.renderer.setScissorTest(true);
      this.renderer.clear(true, true, false);
      this.renderer.render(scene, cam);
    }

    this.renderer.setScissorTest(prevScissor);
    this.renderer.autoClear = prevAuto;
    this.renderer.setClearColor(prevClear, prevClearAlpha);
    this.renderer.setRenderTarget(prevRT);
    // getSize reports CSS pixels and setViewport scales by the pixel ratio
    // itself; multiplying by the DPR here would apply it twice.
    const sz = new THREE.Vector2();
    this.renderer.getSize(sz);
    this.renderer.setViewport(0, 0, sz.x, sz.y);
    this.renderer.setScissor(0, 0, sz.x, sz.y);

    for (const b of basics) b.dispose();
    normalMat.dispose();
    scene.clear();

    const info: ImpostorRow = { row, size: half * 2, centreY: centre.y };
    this.rows.push(info);
    return info;
  }

  dispose(): void {
    this.albedo.dispose();
    this.normal.dispose();
  }
}

/** One instanced draw for every impostor in the world. */
export class ImpostorBatch {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private posScale: THREE.InstancedBufferAttribute;
  private yawTile: THREE.InstancedBufferAttribute;
  private material: THREE.ShaderMaterial;
  private prepassMat: THREE.ShaderMaterial;
  private n = 0;

  constructor(atlas: ImpostorAtlas, capacity: number, sunView: THREE.Vector3, rows: number) {
    const quad = new THREE.PlaneGeometry(1, 1, 1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    this.geo.setIndex(quad.getIndex());
    quad.dispose();

    this.posScale = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.yawTile = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    this.posScale.setUsage(THREE.DynamicDrawUsage);
    this.yawTile.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPosScale', this.posScale);
    this.geo.setAttribute('iYawTile', this.yawTile);
    this.geo.instanceCount = 0;
    // Billboards are re-centred every frame in the shader; a bounding sphere
    // that covers the world stops three from culling the whole batch.
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    this.material = makeImpostorMaterial(
      atlas.albedo.texture,
      atlas.normal.texture,
      IMPOSTOR_TILES,
      rows,
      sunView,
      new THREE.Vector2(atlas.albedo.width, atlas.albedo.height),
    );
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.name = 'actors:impostors';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // Drawn last within the opaque pass. The batch is entirely far geometry, so
    // letting everything nearer lay depth down first is free early-z; it also
    // preserves the draw position the old `transparent` flag used to give it.
    this.mesh.renderOrder = 5;
    // The billboard's vertices come from iPosScale/iYawTile, which the
    // pipeline's blanket prepass override cannot read — see
    // makeImpostorPrepassMaterial. This is the opt-out the flag used to buy.
    this.prepassMat = makeImpostorPrepassMaterial();
    this.mesh.userData.prepassMaterial = this.prepassMat;
  }

  begin(): void {
    this.n = 0;
  }

  push(x: number, y: number, z: number, scale: number, yaw: number, row: number): void {
    const i = this.n;
    if (i * 4 + 3 >= this.posScale.array.length) return;
    const a = this.posScale.array as Float32Array;
    const b = this.yawTile.array as Float32Array;
    a[i * 4] = x;
    a[i * 4 + 1] = y;
    a[i * 4 + 2] = z;
    a[i * 4 + 3] = scale;
    b[i * 2] = yaw;
    b[i * 2 + 1] = row;
    this.n++;
  }

  end(): void {
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n === 0) return;
    this.posScale.clearUpdateRanges();
    this.posScale.addUpdateRange(0, this.n * 4);
    this.posScale.needsUpdate = true;
    this.yawTile.clearUpdateRanges();
    this.yawTile.addUpdateRange(0, this.n * 2);
    this.yawTile.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
    this.prepassMat.dispose();
  }
}
