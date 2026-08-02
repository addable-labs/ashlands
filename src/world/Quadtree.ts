import * as THREE from 'three';
import { EXTENT, MAX_DEPTH, type Heightfield } from './Heightfield';

const _camPos = new THREE.Vector3();

/**
 * Instance budget. CDLOD emits a roughly constant number of nodes per level
 * ring — about 50 with LOD_K 4.5 — so nine levels plus the shadow-caster
 * over-inclusion peaks near 700. The cap exists to bound the buffer, not to
 * shape the selection: hitting it silently drops terrain, so leave headroom.
 */
export const MAX_NODES = 4600;
/** Node is refined while the camera is nearer than size * LOD_K. */
const LOD_K = 4.5;
/** Grid morph runs over this fraction of the node's range. */
export const MORPH_START = 0.84;
export const MORPH_END = 0.97;

/**
 * CDLOD selector. Every emitted node uses the same 33x33 grid, so the whole
 * terrain is one instanced draw; only the world rectangle it covers varies.
 *
 * Cracks are closed by the vertex-shader morph, not by skirts. Two conditions
 * must hold on any edge shared by a level-d and a level-(d-1) node, at XZ
 * distance D from the eye:
 *
 *   (a) the fine node has fully collapsed onto the coarse lattice, D >= 0.97*r_d
 *   (b) the coarse node has not yet started morphing, D <= 0.84*r_(d-1) = 1.68*r_d
 *
 * (a) holds because the coarse node was only emitted once its own rectangle was
 * at least r_d away, and the shared edge lies inside that rectangle. (b) holds
 * because the shared edge sits on the boundary of a level-(d-1) rectangle whose
 * distance was under r_d, so D <= r_d + diag = r_d*(1 + 2*sqrt(2)/LOD_K) = 1.63*r_d.
 * Both bounds are why LOD_K cannot be lowered without re-deriving the morph band.
 *
 * The metric is XZ-only and so is the shader's: mixing a 2D selection with a 3D
 * morph breaks (b) the moment the eye is a kilometre below a summit, which is
 * exactly the situation this terrain is built around.
 *
 * LOD_K >= 2*sqrt(2) additionally guarantees the tree is 2:1 balanced, so a
 * level can never jump by two across an edge — the case the proof does not
 * cover and the one that actually tears holes in the mesh.
 */
export class Quadtree {
  readonly ranges = new Float32Array(MAX_DEPTH + 2);
  /**
   * vec4 per node: originX, originZ, size, depth.
   *
   * Partitioned, not merely filled: the first `count` entries are the nodes
   * whose own bounds intersect the view frustum, the next `total - count` are
   * the ones that only got in because they cast into it. Both blocks go to the
   * GPU as one contiguous instance buffer, so the two audiences are selected by
   * nothing more than the instance count the draw is issued with.
   */
  readonly instances = new Float32Array(MAX_NODES * 4);
  /** Nodes actually inside the view frustum. The shaded and prepass draws want these. */
  count = 0;
  /** Those plus the off-screen casters. The shadow cascades want all of them. */
  total = 0;

  /** Shadow-only nodes are staged at the far end and compacted down in select(). */
  private tail = 0;

  private box = new THREE.Box3();
  private shadowBox = new THREE.Box3();
  private sunOffset = new THREE.Vector3();

  constructor(private hf: Heightfield) {
    for (let d = 0; d <= MAX_DEPTH + 1; d++) {
      this.ranges[d] = ((2 * EXTENT) / (1 << d)) * LOD_K;
    }
  }

  /** Per-level (morphStart, 1/(morphEnd-morphStart)) for the vertex shader. */
  morphParams(): Float32Array {
    const out = new Float32Array((MAX_DEPTH + 1) * 2);
    for (let d = 0; d <= MAX_DEPTH; d++) {
      const r = this.ranges[d];
      const s = r * MORPH_START;
      const e = r * MORPH_END;
      out[d * 2] = s;
      out[d * 2 + 1] = 1 / Math.max(1e-3, e - s);
    }
    return out;
  }

  /**
   * `shadowShift` must point away from the sun, i.e. along the cast direction.
   * Returns the total node count; `count` is the view-visible prefix of it.
   */
  select(camera: THREE.Camera, frustum: THREE.Frustum, shadowShift: THREE.Vector3): number {
    this.count = 0;
    this.tail = 0;
    // Terrain behind the camera still casts into the view. Rather than build a
    // second light frustum, accept any node whose bounds, slid along the cast
    // direction, would enter the view — cheap and errs towards correctness.
    this.sunOffset.copy(shadowShift).multiplyScalar(Math.min(900, this.hf.peak * 1.4 + 120));
    const cam = camera.getWorldPosition(_camPos);
    this.visit(0, 0, 0, cam, frustum);
    // Slide the shadow-only block down so the buffer is one contiguous run.
    // The destination always starts at or before the source, so the overlap is
    // a forward move and copyWithin's memmove semantics handle it.
    this.instances.copyWithin(this.count * 4, (MAX_NODES - this.tail) * 4, MAX_NODES * 4);
    this.total = this.count + this.tail;
    return this.total;
  }

  private visit(depth: number, ni: number, nj: number, cam: THREE.Vector3, frustum: THREE.Frustum): void {
    if (this.count + this.tail >= MAX_NODES) return;
    const n = 1 << depth;
    const size = (2 * EXTENT) / n;
    const ox = -EXTENT + ni * size;
    const oz = -EXTENT + nj * size;
    const k = nj * n + ni;
    const lo = this.hf.nodeMin[depth][k];
    const hi = this.hf.nodeMax[depth][k];

    this.box.min.set(ox, lo, oz);
    this.box.max.set(ox + size, hi, oz + size);

    const seen = frustum.intersectsBox(this.box);
    if (!seen) {
      // The SWEPT volume, not the box at one displacement.
      //
      // Testing `box + sunOffset` accepts a node only if its shadow lands in the
      // view after being slid the full caster distance — 900 m. A node 200 m
      // behind the visible ground, whose shadow falls straight across the frame,
      // is slid 900 m past it and rejected. So is everything else that casts
      // from an intermediate distance, which at a low sun is most of the terrain
      // outside the frustum. Those nodes are simply absent from the shadow map,
      // and absent caster means lit receiver: the frame gets a hard-edged patch
      // of sunlight sitting inside a shadow, bounded by the node's own
      // rectangle. A quadtree node is an axis-aligned world-space square, which
      // is why the review measured "a perfect right-angle notch", "hard
      // axis-aligned rectangular step", "two straight-line facet edges meeting
      // at a clean vertical notch" and read all of them as chunk seams. The
      // drawn mesh was watertight throughout; the shadow map had holes in it.
      //
      // The union of the box and the displaced box contains every intermediate
      // position, so one test now covers the whole sweep. It over-includes —
      // the union of two boxes is larger than their convex hull's AABB only in
      // the degenerate case, but the hull is still fatter than the swept
      // silhouette — and over-inclusion is the correct direction: the cost is a
      // node drawn into a cascade that did not need it, and the alternative is
      // a hole in the sunlight.
      this.shadowBox.copy(this.box);
      this.shadowBox.min.add(this.sunOffset);
      this.shadowBox.max.add(this.sunOffset);
      this.shadowBox.union(this.box);
      if (!frustum.intersectsBox(this.shadowBox)) return;
    }

    if (depth < MAX_DEPTH) {
      const dx = Math.max(ox - cam.x, 0, cam.x - (ox + size));
      const dz = Math.max(oz - cam.z, 0, cam.z - (oz + size));
      if (Math.sqrt(dx * dx + dz * dz) < this.ranges[depth + 1]) {
        const c = depth + 1;
        this.visit(c, ni * 2, nj * 2, cam, frustum);
        this.visit(c, ni * 2 + 1, nj * 2, cam, frustum);
        this.visit(c, ni * 2, nj * 2 + 1, cam, frustum);
        this.visit(c, ni * 2 + 1, nj * 2 + 1, cam, frustum);
        return;
      }
    }

    // A node that only survived the shadow test contributes no pixel to the
    // shaded or prepass image — its bounds, halo included, are outside the view
    // frustum — but its whole 33x33 grid was still being transformed there, at
    // sixteen height texel fetches a vertex. At a low sun the caster offset is
    // 900 m of horizontal slide, so that set is not a rounding error: it is a
    // second ring of the terrain drawn twice a frame to be clipped.
    const o = (seen ? this.count++ : MAX_NODES - ++this.tail) * 4;
    this.instances[o] = ox;
    this.instances[o + 1] = oz;
    this.instances[o + 2] = size;
    this.instances[o + 3] = depth;
  }
}
