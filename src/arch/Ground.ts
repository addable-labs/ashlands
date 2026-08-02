import { MAX_DEPTH } from '../world/Heightfield';

/**
 * THE SURFACE THE CAMERA ACTUALLY SEES.
 *
 * Every generator in this directory plants against `terrain.heightAt()` — the
 * C2 B-spline reconstruction of the heightfield. That function is exact, and it
 * is NOT what is on screen.
 *
 * The terrain is drawn by a CDLOD instancer: one 33x33 lattice stretched over a
 * quadtree node, so the rasterised surface is a piecewise-linear interpolation
 * of the B-spline sampled at the node's own grid spacing. At depth 7 that
 * spacing is 0.98 m and the two agree to a centimetre. At depth 3 it is 15.6 m,
 * and a 15 m chord across a convex ridge cuts several metres BELOW the surface
 * the CPU reports. The planner deliberately puts landmarks on prominences —
 * convex maxima, where the undershoot is worst — so the drawn ground sags out
 * from under precisely the structures that were most carefully grounded, and
 * the tower that has real contact at 80 m is standing on a column of air at
 * 900 m.
 *
 * Measured on the live layout before this existed: the lowest three per cent of
 * the vertices of 56 of 110 structures stood clear of the drawn surface, by up
 * to 10.6 m at close range and 25.8 m past two kilometres.
 *
 * So: reconstruct what the vertex shader will draw, at every level it can draw
 * it at, and take the LOWEST. Anything that has to prove ground contact —
 * plinth skirts, root tips, leg feet, pylon bases — is driven under THAT rather
 * than under the CPU surface. It costs nothing at runtime (this is a build-time
 * query only) and it is invisible up close, because the extra depth is buried
 * inside the hill.
 *
 * The visible ash drift is deliberately NOT moved down here: the drift reads at
 * five metres and would simply vanish under the near surface. Contact is proved
 * twice, by two different pieces of geometry — the drift banked against the
 * wall for the near view, the plinth reaching to the LOD floor for the far one.
 */

/**
 * Quads per side of the shared CDLOD grid. Mirrors `SEG` in src/world/Terrain.ts.
 *
 * Not imported because it is private there and this module must not force a
 * change to another owner's file. A mismatch degrades gracefully rather than
 * breaking: the sampler takes a minimum over SIX adjacent levels, so being one
 * power of two out simply shifts which of them is binding.
 */
const SEG = 32;

/**
 * Node is refined while the camera is nearer than `size * LOD_K`. Mirrors
 * `LOD_K` in src/world/Quadtree.ts. See above on why it is duplicated.
 */
const LOD_K = 4.5;

/**
 * Shallowest level to consider, i.e. the coarsest lattice we bother to defend
 * against.
 *
 * Depth 2 is a 31 m lattice and is only ever the drawn level past 2.25 km. Out
 * there a hundred-metre tower is 90 px tall and sitting under most of the
 * aerial-perspective integral, so a couple of metres of daylight under it is
 * genuinely below the noise floor — while the sink needed to close it is tens
 * of metres, which is a visible plinth at every OTHER range. Depth 3 (a 15.6 m
 * lattice, binding from 1.1 km) is the right place to stop: it is the last
 * level at which a structure is still read as a structure.
 */
const MIN_DEPTH = 3;

/** Vertical query cache, keyed on a decimetre grid. Build-time only. */
const CACHE_GRID = 10;

export interface GroundOptions {
  /**
   * Hard cap on how far below the fine surface a query may be driven, metres.
   *
   * A plinth is an outcrop, not a pedestal: the drop has to be proportional to
   * the thing standing on it or the cure is worse than the float. Scale it off
   * the structure — a 110 m tower carries a 15 m skirt without comment, a 4 m
   * dome does not.
   */
  maxSink?: number;
}

/**
 * Samples the heightfield the way the terrain shader rasterises it.
 *
 * One instance per build; the cache is what keeps the cost of ~500k extra
 * reconstructions off the load time.
 */
export class GroundField {
  private cache = new Map<number, number>();

  constructor(
    private readonly heightAt: (x: number, z: number) => number,
    private readonly extent: number,
  ) {}

  /** The exact surface: physics, flora and the CPU all agree with this one. */
  fine(x: number, z: number): number {
    return this.heightAt(x, z);
  }

  /**
   * Height of the piecewise-linear surface a depth-`d` node rasterises at
   * (x, z).
   *
   * The lattice is global — a node origin is `-EXTENT + n * size` and its
   * vertices step by `size / SEG`, and `size / SEG` divides `size` — so the
   * cell can be found from the world position alone without knowing which node
   * owns it. The triangulation matches `buildGrid`: indices (a, c, b) then
   * (b, c, d), which puts the diagonal on u + v = 1.
   */
  private levelAt(x: number, z: number, d: number): number {
    const E = this.extent;
    const cell = (2 * E) / (1 << d) / SEG;
    const gx = (x + E) / cell;
    const gz = (z + E) / cell;
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const u = gx - i;
    const v = gz - j;
    const X = (k: number): number => -E + k * cell;
    const ha = this.heightAt(X(i), X(j));
    const hb = this.heightAt(X(i + 1), X(j));
    const hc = this.heightAt(X(i), X(j + 1));
    if (u + v <= 1) return ha + (hb - ha) * u + (hc - ha) * v;
    const hd = this.heightAt(X(i + 1), X(j + 1));
    return hd + (hb - hd) * (1 - v) + (hc - hd) * (1 - u);
  }

  /**
   * The lowest surface any LOD level draws at (x, z).
   *
   * Uncached and unclamped; `settle` is what callers should use.
   */
  low(x: number, z: number): number {
    let m = this.heightAt(x, z);
    for (let d = MAX_DEPTH; d >= MIN_DEPTH; d--) {
      const h = this.levelAt(x, z, d);
      if (h < m) m = h;
    }
    return m;
  }

  /**
   * Burial depth: the height a foot has to reach to be under the ground at
   * every LOD, clamped so the resulting skirt stays proportionate.
   */
  settle(x: number, z: number, opts: GroundOptions = {}): number {
    const key = (Math.round(x * CACHE_GRID) & 0x3fffff) * 0x400000 + (Math.round(z * CACHE_GRID) & 0x3fffff);
    let lo = this.cache.get(key);
    if (lo === undefined) {
      lo = this.low(x, z);
      this.cache.set(key, lo);
    }
    const cap = opts.maxSink;
    if (cap === undefined) return lo;
    const fine = this.heightAt(x, z);
    return Math.max(lo, fine - cap);
  }

  /** A `(x, z) => y` closure over `settle`, for the generators' callbacks. */
  settler(opts: GroundOptions = {}): (x: number, z: number) => number {
    return (x, z) => this.settle(x, z, opts);
  }

  /**
   * Worst-case sink under a whole footprint ring, for reporting. Placement uses
   * per-vertex `settle` — a tower on a slope must follow the slope, not sit on
   * the deepest point of it — so this is diagnostic, not a placement input.
   */
  ringDrop(points: readonly { x: number; z: number }[], ox: number, oz: number): number {
    let worst = 0;
    for (const p of points) {
      const d = this.heightAt(ox + p.x, oz + p.z) - this.low(ox + p.x, oz + p.z);
      if (d > worst) worst = d;
    }
    return worst;
  }

  get size(): number {
    return this.cache.size;
  }
}
