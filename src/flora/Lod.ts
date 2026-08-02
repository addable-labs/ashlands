import type { TerrainField } from './Field';

/**
 * The surface the terrain *draws*, as opposed to the one it *reports*.
 *
 * `terrain.heightAt` evaluates the analytic heightfield. The terrain mesh does
 * not: it is a CDLOD quadtree whose vertices sample that same field on a lattice
 * whose spacing doubles with every level, and which slides between two lattices
 * across a morph band. Between vertices the drawn surface is the *linear*
 * interpolant of that lattice, and on a ridge at three hundred metres that
 * interpolant sits a metre or more below the analytic surface.
 *
 * Scattering props against the analytic surface therefore leaves them hanging in
 * the air over exactly the geometry the eye can see them against — the single
 * most-cited defect in the review, and the reason it appears only on far slopes
 * and never in the near field. This class reproduces the terrain's selection and
 * morph so a prop can be placed on the surface that is actually rasterised.
 *
 * The constants mirror the terrain subsystem (world/Quadtree LOD_K and the morph
 * band, world/Heightfield MAX_DEPTH, world/Terrain SEG). They are duplicated
 * rather than imported: flora is not allowed to depend on another subsystem's
 * module graph, and the contract in core/contracts.ts exposes none of them. If
 * terrain re-tunes its LOD ladder these move with it — a mismatch degrades
 * gracefully to the old behaviour rather than breaking anything.
 */

/** Quads per side of the shared terrain LOD grid. */
const SEG = 32;
/** A node refines while the camera is nearer than nodeSize * LOD_K. */
const LOD_K = 4.5;
/** Deepest quadtree level. */
const MAX_DEPTH = 7;
/** Fraction of a level's range over which its grid collapses onto the coarser one. */
const MORPH_START = 0.84;
const MORPH_END = 0.97;

function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1e-9)));
  return t * t * (3 - 2 * t);
}

export class TerrainLod {
  /** Refinement radius per level, metres. */
  private ranges: Float64Array;
  /** Vertex spacing of each level's grid, metres. */
  private cells: Float64Array;
  private E: number;
  /** Below this distance the drawn lattice is finer than our own field. */
  private nearCut: number;

  constructor(private field: TerrainField) {
    this.E = field.extent;
    this.ranges = new Float64Array(MAX_DEPTH + 2);
    this.cells = new Float64Array(MAX_DEPTH + 1);
    for (let d = 0; d <= MAX_DEPTH + 1; d++) {
      this.ranges[d] = ((2 * this.E) / (1 << d)) * LOD_K;
    }
    for (let d = 0; d <= MAX_DEPTH; d++) {
      this.cells[d] = (2 * this.E) / (1 << d) / SEG;
    }
    this.nearCut = this.ranges[MAX_DEPTH] * MORPH_START;
  }

  /**
   * Height of the drawn surface minus the height of the analytic one.
   *
   * Add this to any placement derived from `heightAt` and the prop follows the
   * geometry through every LOD transition instead of swimming off it. It is
   * continuous: at the boundary between level d and level d+1 the finer level is
   * fully morphed onto the coarser level's lattice, so both branches evaluate
   * the identical interpolant.
   */
  offset(x: number, z: number, eyeX: number, eyeZ: number): number {
    const dx = x - eyeX;
    const dz = z - eyeZ;
    const D = Math.sqrt(dx * dx + dz * dz);
    if (D <= this.nearCut * 0.72) return 0;

    let d = 0;
    while (d < MAX_DEPTH && D < this.ranges[d + 1]) d++;
    const r = this.ranges[d];
    const mk = Math.min(1, Math.max(0, (D - r * MORPH_START) / (r * (MORPH_END - MORPH_START))));

    const c = this.cells[d];
    const hf = this.lattice(x, z, c);
    const h = mk > 0 ? hf + (this.lattice(x, z, c * 2) - hf) * mk : hf;
    // Ramp the correction in over the last stretch of the near field so a plant
    // crossing into the corrected band slides rather than steps. Inside it the
    // drawn lattice is sub-metre and the correction is a centimetre anyway.
    return (h - this.field.heightAt(x, z)) * smooth01(this.nearCut * 0.72, this.nearCut, D);
  }

  /**
   * Bilinear reconstruction on a lattice of spacing `c` anchored at -extent —
   * exactly what the terrain's triangles interpolate between their vertices.
   */
  private lattice(x: number, z: number, c: number): number {
    const E = this.E;
    const gx = (x + E) / c;
    const gz = (z + E) / c;
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const tx = gx - i;
    const tz = gz - j;
    const x0 = i * c - E;
    const z0 = j * c - E;
    const f = this.field;
    const a = f.heightAt(x0, z0);
    const b = f.heightAt(x0 + c, z0);
    const p = f.heightAt(x0, z0 + c);
    const q = f.heightAt(x0 + c, z0 + c);
    const top = a + (b - a) * tx;
    const bot = p + (q - p) * tx;
    return top + (bot - top) * tz;
  }
}
