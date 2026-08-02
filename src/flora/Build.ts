import * as THREE from 'three';
import { BAND, bandV } from './Atlas';
import { Rng, clamp01, fbm2, lerp, smoothstep } from './Noise';

/**
 * Generative flora geometry.
 *
 * Nothing here is modelled; every surface is a lofted spline or a lathe whose
 * control points are perturbed by seeded noise. A species "variant" is a whole
 * re-roll of that noise — different stalk curve, different bulb count, different
 * cap droop and gill count — so a variant pool of three or four, multiplied by
 * per-instance lean, non-uniform scale and hue jitter in the shader, gives a
 * field in which no two silhouettes repeat.
 */

/** Per-vertex attribute carried into every flora shader as `aParam`. */
export interface VertParam {
  /** 0 at the anchored base, 1 at the most compliant tip. Drives wind stiffness. */
  stiff: number;
  /** Translucency multiplier for the subsurface term. */
  thick: number;
  /** Bioluminescence multiplier. */
  glow: number;
  /** Baked self-occlusion: 1 open sky, 0 buried under the cap. */
  ao: number;
}

class Builder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uv: number[] = [];
  readonly par: number[] = [];
  readonly idx: number[] = [];

  vert(
    x: number, y: number, z: number,
    nx: number, ny: number, nz: number,
    u: number, v: number,
    p: VertParam,
  ): number {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    this.par.push(p.stiff, p.thick, p.glow, p.ao);
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, d, a, d, c);
  }

  /**
   * Lay down a (rows x cols) parametric patch and derive its normals from the
   * grid itself. Analytic normals for a noise-perturbed loft are error-prone and
   * every mistake shows up as a black facet; central differences on the emitted
   * positions cannot disagree with the geometry that is actually drawn.
   */
  patch(
    rows: number,
    cols: number,
    wrapU: boolean,
    flip: boolean,
    fn: (iu: number, iv: number, out: THREE.Vector3, uv: THREE.Vector2, p: VertParam) => void,
    /**
     * How many times the caller's uv.x wraps the atlas over one revolution.
     *
     * The duplicated seam column has to carry the u the callback WOULD have
     * produced at iu = cols, and for a caller that lays the band down more than
     * once round the lathe that is not 1. The cap wraps twice (see buildParasol)
     * and was being handed 1: the whole last quad column ran u from 1.96 back
     * down to 1.0, i.e. a full atlas width compressed backwards into a single
     * 0.8 m wedge of a twelve-metre cap. Minified by a hundred to one, that wedge
     * is a smear of the mip tail — one hard radial seam on the most-looked-at
     * surface in the project.
     */
    uWrap = 1,
  ): void {
    const nu = wrapU ? cols + 1 : cols;
    const P: number[] = [];
    const UV: number[] = [];
    const PR: VertParam[] = [];
    const v = new THREE.Vector3();
    const t = new THREE.Vector2();
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < nu; i++) {
        const iu = wrapU ? i % cols : i;
        const p: VertParam = { stiff: 0, thick: 0, glow: 0, ao: 1 };
        fn(iu, j, v, t, p);
        // The duplicated seam column must sit at the end of the wrap so the
        // atlas repeats cleanly instead of running backwards through it.
        if (wrapU && i === cols) t.x = uWrap;
        P.push(v.x, v.y, v.z);
        UV.push(t.x, t.y);
        PR.push(p);
      }
    }

    const at = (i: number, j: number, out: THREE.Vector3): THREE.Vector3 => {
      const k = (j * nu + i) * 3;
      return out.set(P[k], P[k + 1], P[k + 2]);
    };
    const a = new THREE.Vector3();
    const bb = new THREE.Vector3();
    const c = new THREE.Vector3();
    const du = new THREE.Vector3();
    const dv = new THREE.Vector3();
    const n = new THREE.Vector3();
    const base = this.pos.length / 3;

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < nu; i++) {
        const i0 = wrapU ? (i - 1 + nu) % nu : Math.max(0, i - 1);
        const i1 = wrapU ? (i + 1) % nu : Math.min(nu - 1, i + 1);
        du.subVectors(at(i1, j, a), at(i0, j, bb));
        const j0 = Math.max(0, j - 1);
        const j1 = Math.min(rows - 1, j + 1);
        dv.subVectors(at(i, j1, a), at(i, j0, bb));
        n.crossVectors(dv, du);
        if (n.lengthSq() < 1e-14) {
          // Degenerate pole ring (all columns coincide). Borrow the neighbour
          // row's tangent frame rather than emitting a zero normal.
          const jr = j === 0 ? Math.min(rows - 1, j + 1) : Math.max(0, j - 1);
          du.subVectors(at(i1, jr, a), at(i0, jr, bb));
          dv.subVectors(at(i, Math.min(rows - 1, jr + 1), a), at(i, Math.max(0, jr - 1), bb));
          n.crossVectors(dv, du);
          if (n.lengthSq() < 1e-14) n.set(0, 1, 0);
        }
        n.normalize();
        if (flip) n.negate();
        at(i, j, c);
        const k = j * nu + i;
        this.vert(c.x, c.y, c.z, n.x, n.y, n.z, UV[k * 2], UV[k * 2 + 1], PR[k]);
      }
    }

    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < nu - 1; i++) {
        const a0 = base + j * nu + i;
        const b0 = a0 + 1;
        const c0 = a0 + nu;
        const d0 = c0 + 1;
        if (flip) this.idx.push(a0, b0, c0, b0, d0, c0);
        else this.idx.push(a0, c0, b0, b0, c0, d0);
      }
    }
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aParam', new THREE.Float32BufferAttribute(this.par, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  get triangles(): number {
    return this.idx.length / 3;
  }
}

/** Catmull-Rom through a polyline of control points, evaluated at t in [0,1]. */
function spline(ctrl: THREE.Vector3[], t: number, out: THREE.Vector3): THREE.Vector3 {
  const n = ctrl.length - 1;
  const s = clamp01(t) * n;
  const i = Math.min(n - 1, Math.floor(s));
  const f = s - i;
  const p0 = ctrl[Math.max(0, i - 1)];
  const p1 = ctrl[i];
  const p2 = ctrl[i + 1];
  const p3 = ctrl[Math.min(n, i + 2)];
  const f2 = f * f;
  const f3 = f2 * f;
  return out.set(
    0.5 * (2 * p1.x + (-p0.x + p2.x) * f + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * f2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * f3),
    0.5 * (2 * p1.y + (-p0.y + p2.y) * f + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * f2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * f3),
    0.5 * (2 * p1.z + (-p0.z + p2.z) * f + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * f2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * f3),
  );
}

/** A stalk spec: the spline path plus its radius law. */
interface Stalk {
  ctrl: THREE.Vector3[];
  /** Radius at height fraction t and angle a (radians). */
  radius(t: number, a: number): number;
  height: number;
}

/**
 * Bulbous, swollen fungal stalk. Three superimposed swellings at random heights
 * over a taper, an exaggerated flare where it meets the ground (which is what
 * kills any hint of a cylinder poking out of the dirt), and per-angle lumpiness
 * so the cross-section is never a circle.
 */
function makeStalk(rng: Rng, height: number, baseR: number, lean: number): Stalk {
  const ctrl: THREE.Vector3[] = [];
  const segs = 5;
  const dirA = rng.range(0, Math.PI * 2);
  const dx = Math.cos(dirA) * lean;
  const dz = Math.sin(dirA) * lean;
  // A gentle S: the sweep reverses part way up, which is what makes a fungal
  // stalk look grown rather than extruded.
  const rev = rng.range(0.35, 0.75);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const s = t * t * (t < rev ? 1 : 1) - Math.pow(clamp01((t - rev) / (1 - rev)), 2) * 0.55;
    ctrl.push(
      new THREE.Vector3(
        dx * s * height + rng.around(0, 0.035 * height * t),
        t * height,
        dz * s * height + rng.around(0, 0.035 * height * t),
      ),
    );
  }

  const bulges = [
    { p: rng.range(0.08, 0.30), a: rng.range(0.35, 0.95), w: rng.range(0.10, 0.22) },
    { p: rng.range(0.30, 0.60), a: rng.range(0.10, 0.55), w: rng.range(0.08, 0.20) },
    { p: rng.range(0.60, 0.88), a: rng.range(-0.25, 0.30), w: rng.range(0.06, 0.16) },
  ];
  const lumpF = rng.range(2.0, 4.5);
  // 0.05-0.14 -> 0.10-0.22. At the low end the cross-section was a circle to
  // within one per cent of its radius, i.e. the stipe silhouette was a pair of
  // smooth curves however close the lens got. A tenth of the radius is what a
  // bundle of fused hyphal strands actually is, and it costs nothing: the same
  // vertices, moved.
  const lumpA = rng.range(0.10, 0.22);
  const lumpSeed = rng.range(0, 100);
  const taperP = rng.range(0.55, 0.95);

  /**
   * ANNULAR CONSTRICTIONS, in geometry rather than in shading.
   *
   * Surface.ts already writes 77 cm growth rings into the normal, and a normal
   * perturbation cannot change a silhouette: seen against the sky the stipe was
   * still a smooth taper with two curves for edges, which is the read the review
   * called "smooth matte". Real fungal stipes grow in flushes and carry a set of
   * genuine waists between them.
   *
   * The count is bounded by the loft: at LOD1 the stalk is lofted with 11 rows,
   * so anything past five rings would alias into a different set of rings on the
   * two LODs and pop across the cross-fade. Four to six is inside that on both.
   *
   * The profile is deliberately asymmetric — a raised power on the cosine — so
   * the constrictions are narrow and the swells between them broad, which is
   * what growth in flushes produces and what a plain sinusoid does not.
   */
  const ringN = 3 + rng.int(2);
  const ringA = rng.range(0.055, 0.115);
  const ringPh = rng.range(0, 1);
  /**
   * VERTICAL FLUTES, also in geometry.
   *
   * Seven ribs running the length of the stipe. Seven and not the shader's nine
   * because the LOD1 loft has 16 columns: nine ribs is 1.8 samples a cycle and
   * would beat against the lattice into a coarser, wrong-frequency corrugation.
   * Surface.ts now uses seven as well, so the shaded rib and the geometric one
   * are the same rib rather than two interfering ones.
   *
   * The amplitude closes toward the very foot, where the flare has to stay a
   * clean cone for the root skirt to seal against it.
   */
  const fluteA = rng.range(0.035, 0.075);
  const flutePh = rng.range(0, Math.PI * 2);

  return {
    ctrl,
    height,
    radius(t, a) {
      let r = baseR * Math.pow(1 - 0.70 * t, taperP);
      const flare = 1 + 1.6 * Math.exp(-(t * t) / 0.0022);
      let swell = 1;
      for (const bg of bulges) {
        const d = (t - bg.p) / bg.w;
        swell += bg.a * Math.exp(-d * d);
      }
      const ringC = 0.5 + 0.5 * Math.cos((t * ringN + ringPh) * Math.PI * 2);
      swell *= 1 - ringA * (1 - Math.pow(ringC, 1.7));
      const lump =
        1 + lumpA * (fbm2(Math.cos(a) * lumpF + lumpSeed, Math.sin(a) * lumpF + t * 2.5, 3) - 0.5) * 2;
      const flute =
        1 + fluteA * Math.cos(a * 7 + flutePh + t * 1.1) * smoothstep(0.0, 0.10, t);
      return r * flare * Math.max(0.25, swell) * lump * flute;
    },
  };
}

/**
 * Texel density along the length of a lathe, expressed as a tile count.
 *
 * The atlas is a BAND atlas: u is the lathe angle and wraps once around the
 * whole 1024-texel width, while v spans one band — the stalk band is 0.22 of the
 * atlas, i.e. 225 texels. Mapping the full height of a fifteen-metre stipe onto
 * those 225 texels while its six-metre circumference gets 1024 gives an
 * anisotropy of about ten to one, and a ten-to-one stretch of a fibre texture is
 * not "a bit soft": it is a one-dimensional vertical smear with literally zero
 * horizontal variation, which is exactly what the review measured on the hero
 * trunk (one texel row stretched across ~700 screen pixels).
 *
 * Tiling v by this factor makes the texels square. The tile is ping-ponged
 * rather than wrapped so there is no hard ring of discontinuity where the band
 * restarts, and the annuli in the band were dropped to a frequency that survives
 * being repeated this many times (see stalkSample).
 */
function stalkVTile(height: number, radius: number): number {
  const bandTexels = (BAND.stalk[1] - BAND.stalk[0]) * 1024;
  const circumference = Math.max(0.05, 2 * Math.PI * radius);
  /**
   * Capped at six, not four.
   *
   * Four still leaves a fifteen-metre stipe at better than two and a half to one
   * — the review measured it as "heavy vertical UV smearing on cap and stem",
   * and a 2.5:1 anisotropic stretch of a fibre texture really is a smear rather
   * than softness. The worry that motivated the lower cap was the annular
   * content beating against itself, and that is answered by the tile being
   * PING-PONGED: a mirrored repeat has no discontinuity to beat at, and the
   * band's annuli were already dropped to a frequency chosen to survive being
   * repeated. Six takes the worst case to about 1.7:1, which anisotropic
   * filtering handles without visible directionality.
   */
  const tiles = (height * (1024 / circumference)) / bandTexels;
  return Math.max(1, Math.min(6, tiles));
}

/** Ping-pong into [0,1]; a mirrored tile cannot seam. */
function pingPong(t: number): number {
  return 1 - Math.abs(1 - ((t % 2) + 2) % 2);
}

/**
 * Plug the foot of a lathe and push it below the origin.
 *
 * Every stalk here is an open tube: patch() lofts rings from t=0 upward and
 * closes nothing, so the bottom ring is a hole straight into the unlit interior.
 * On flat ground the terrain hides it. On any slope — and the vale hero parasol
 * stands on one — the heightfield cuts the flare and you look down the inside of
 * the stipe, which the review correctly called the ugliest hundred pixels in the
 * frame. Capping the tube is the fix; extending the cap DOWNWARD by a real skirt
 * is what makes it robust, because then the intersection with the terrain
 * happens against solid geometry no matter where the surface actually falls.
 */
function plugFoot(
  bld: Builder,
  cx: number,
  cz: number,
  cols: number,
  depth: number,
  radiusAt: (a: number) => number,
  vBand: number,
): void {
  const par: VertParam = { stiff: 0, thick: 0.05, glow: 0, ao: 0.16 };
  const hub: VertParam = { stiff: 0, thick: 0.05, glow: 0, ao: 0.05 };
  const centre = bld.vert(cx, -depth, cz, 0, -1, 0, 0.5, vBand, hub);
  const ring: number[] = [];
  for (let i = 0; i < cols; i++) {
    const a = (i / cols) * Math.PI * 2;
    // Slightly proud of the visible flare so the skirt cannot leave a hairline
    // of daylight where it meets the lofted surface.
    const r = radiusAt(a) * 1.03;
    const l = Math.hypot(Math.cos(a) * 0.55, -0.83, Math.sin(a) * 0.55);
    ring.push(
      bld.vert(
        cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r,
        (Math.cos(a) * 0.55) / l, -0.83 / l, (Math.sin(a) * 0.55) / l,
        i / cols, vBand, par,
      ),
    );
  }
  for (let i = 0; i < cols; i++) {
    bld.tri(centre, ring[(i + 1) % cols], ring[i]);
  }
}

function loftStalk(
  bld: Builder,
  st: Stalk,
  rows: number,
  cols: number,
  aoTop: number,
  glow: number,
  vTile = 1,
  vPhase = 0,
): void {
  const p = new THREE.Vector3();
  bld.patch(rows, cols, true, false, (iu, iv, out, uv, par) => {
    const t = iv / (rows - 1);
    const a = (iu / cols) * Math.PI * 2;
    spline(st.ctrl, t, p);
    const r = st.radius(t, a);
    out.set(p.x + Math.cos(a) * r, p.y, p.z + Math.sin(a) * r);
    uv.set(iu / cols, bandV(BAND.stalk, 0.03 + 0.94 * pingPong(t * vTile + vPhase)));
    // Cubic stiffness: a swollen fungal stalk is rigid low down and whippy at
    // the neck, and a linear ramp makes the whole thing pivot at the ground.
    par.stiff = Math.pow(t, 1.6);
    par.thick = 0.10 + 0.22 * t;
    par.glow = glow * smoothstep(0.25, 0.9, t);
    // Ambient occlusion from the ground and from the cap overhead.
    par.ao = clamp01(smoothstep(0.0, 0.16, t) * lerp(1, aoTop, smoothstep(0.55, 1.0, t)));
  });
  // Root skirt. Depth scales with the flare, so a big plant buries a big foot.
  plugFoot(
    bld,
    st.ctrl[0].x,
    st.ctrl[0].z,
    cols,
    Math.max(0.12, st.radius(0, 0) * 0.85),
    (a) => st.radius(0, a),
    bandV(BAND.stalk, 0.02),
  );
}

/* ------------------------------------------------------- emperor parasol */

export interface BuiltMesh {
  geometry: THREE.BufferGeometry;
  /** Metres from the base to the top of the silhouette; used for LOD + impostors. */
  height: number;
  /** Horizontal half-extent, for the impostor quad and bounding spheres. */
  radius: number;
}

/**
 * Emperor parasol — the signature silhouette of the series.
 *
 * A swollen stalk carrying a wide fleshy cap that domes at the centre and droops
 * at the margin, with real radial gill fins hanging beneath it and a
 * bioluminescent rim. Everything about the proportions is deliberately wrong for
 * a tree: the mass is at the top, the stalk is fattest at a third height, and
 * the cap is wider than the plant is tall for the smaller specimens.
 */
export function buildParasol(seed: number, lod: number): BuiltMesh {
  const rng = new Rng(seed);
  const bld = new Builder();

  const H = rng.range(8.0, 22.0);
  const stalkH = H * rng.range(0.64, 0.82);
  const baseR = stalkH * rng.range(0.055, 0.10);
  const lean = rng.range(0.03, 0.13);
  const st = makeStalk(rng, stalkH, baseR, lean);

  // Cap radius is deliberately capped below a third of the height. Wider than
  // that and, at the Poisson spacing that reads as a grove rather than a farm,
  // the canopy closes into a continuous ceiling: no sky, no silhouette, and an
  // overdraw bill that eats the whole frame budget.
  const capR = H * rng.range(0.22, 0.33);
  const rise = capR * rng.range(0.22, 0.40);
  const droop = capR * rng.range(0.30, 0.62);
  const droopP = rng.range(2.6, 5.0);
  const thick = capR * rng.range(0.055, 0.10);
  /**
   * THE MARGIN IS LOBED, AND THIS IS THE SINGLE BIGGEST "SMOOTH BLOB" FIX.
   *
   * waveA ran 0.02-0.075 and modulated the DROOP, not the radius; capRad carried
   * a further +/-3% of fbm. Net: at fifty metres the cap outline was a circle to
   * within a pixel, and an outline that is a circle reads as a moulded object no
   * matter what is painted inside it. A silhouette is also the ONLY channel that
   * survives to the impostor hand-off intact, so it is the cheapest detail in the
   * subsystem per metre of range.
   *
   * Four to six lobes at 9-17% of the radius, plus a matching vertical scallop so
   * the rim rises and falls as well as pushing in and out — a cap seen edge-on
   * against the sky then has a wavy edge rather than a ruled one.
   *
   * The count is bounded by LOD1's column budget (now 20 columns, i.e. 3.3
   * samples per cycle at six lobes) so the two LODs present the same silhouette
   * and the cross-fade is a fade rather than a morph.
   */
  const lobeN = 4 + rng.int(3);
  /**
   * 0.09-0.17 was measured too deep: the radial pull-in and the vertical
   * scallop are in phase, so at the top of the range the margin came to a cusp
   * between lobes and the cap read as a bat wing rather than as tissue. Seven to
   * thirteen per cent is a margin that is unmistakably wavy at fifty metres and
   * still a mushroom.
   */
  const lobeA = rng.range(0.07, 0.13);
  const lobePh = rng.range(0, Math.PI * 2);
  /** Scallop depth: how far the margin rises and falls, as a fraction of droop. */
  const scalA = rng.range(0.12, 0.24);
  const waveN = 3 + rng.int(5);
  const waveA = rng.range(0.02, 0.075);
  const capSeed = rng.range(0, 50);

  /**
   * The cap gets its own segment count, and it is nearly double the stalk's.
   *
   * A parasol cap is the largest single object in the near third of half the
   * canonical shots, and its silhouette is the read. At 26 segments the review
   * could count the facets along its left and front edges — correctly; a
   * twelve-metre disc drawn with 26 sides has a 46 cm chord on its rim, which at
   * four metres from the lens is tens of pixels of straight line. Forty-eight
   * quarters that. The stalk does not need it (its silhouette is a metre across,
   * not twelve) and paying for it there would be pure waste.
   */
  /**
   * 48 -> 72, and the number is set by the closest a cap ever gets to the lens.
   *
   * 48 sides on a twelve-metre cap is a 79 cm chord. The coast vantage puts the
   * camera a couple of metres under a cap's margin — the largest object in that
   * frame — and 79 cm at two metres is a couple of hundred pixels of dead
   * straight line, which is the review's "upper-left silhouette is a chain of
   * straight polygon facets". Normals are already derived from the grid and are
   * smooth, so this is purely a silhouette budget: 72 takes the chord to 52 cm
   * and the facet under a hundred pixels at the same range. The extra 1400
   * triangles are paid on a species scattered at 32 m whose near LOD holds only
   * a few dozen instances.
   */
  /**
   * LOD1: 14 -> 22 cap columns, 6 -> 7 rows; the stalk 10 -> 16 and 7 -> 11.
   *
   * LOD1 has to carry the lobed margin and the annular constrictions added to
   * this species, and at 14 columns six lobes is 2.3 samples a cycle — the
   * silhouette would lobe differently on the two LODs and the cross-fade would
   * read as a shape morph, which is worse than the flat outline it replaces. 22
   * gives 3.7 samples a cycle at the worst case, and the stalk's 11 rows give
   * 2.75 at four annular constrictions, which is why ringN is capped at four.
   *
   * The bill is about 450 extra triangles per LOD1 instance, and it is paid for
   * on the other side of the ledger: the LOD1 instance cap comes down from 1500
   * to 1000 (see VISUALS.parasol.caps — the 110-430 m annulus at 32 m Poisson
   * spacing holds well under 600 before the patch mask), and the shaded lobe term
   * leaves the fragment shader on both programs (see Surface.ts). Net triangle
   * budget for the stage is within ten per cent of where it was.
   */
  const capCols = lod === 0 ? 72 : 22;
  const cols = lod === 0 ? 22 : 16;
  const rows = lod === 0 ? 16 : 7;
  const stalkRows = lod === 0 ? 18 : 11;

  loftStalk(
    bld, st, stalkRows, cols, 0.35, 0.5,
    stalkVTile(stalkH, baseR),
    rng.next() * 2,
  );

  const apex = new THREE.Vector3();
  spline(st.ctrl, 1, apex);

  // The cap surface, as a function of radial fraction and angle. The margin
  // wave is what keeps the silhouette from being a perfect disc at any angle.
  const capY = (rr: number, a: number): number => {
    const wave = 1 + waveA * Math.sin(a * waveN + capSeed);
    /**
     * The scallop, and it is what makes the outline wavy AGAINST THE SKY.
     *
     * Pushing the radius in and out (capRad below) only breaks the outline when
     * the cap is seen from above. The canonical vantages are all at or below cap
     * height, where the read is the rim's HEIGHT profile — so the same lobe
     * phase also lifts and drops the margin. Keyed to rr^3 so the crown is
     * untouched and the whole displacement lands in the outer third.
     */
    const scal = scalA * Math.cos(a * lobeN + lobePh) * Math.pow(rr, 3.0);
    /**
     * ...and the crown is CORRUGATED, not a surface of revolution.
     *
     * Between the lobes the tissue is stretched and sits a little lower; over
     * them it swells. Two per cent of the radius is enough to give the dome a
     * lit flank and a shaded one per lobe, which is form the shading can answer
     * to — the thing a painted-on term can never be. It fades out at the boss
     * (where there is no radius to run around) and at the margin (where the
     * scallop above has taken over).
     */
    const corr = capR * 0.024 * Math.cos(a * lobeN * 2 + lobePh * 1.7)
               * Math.sin(Math.min(1, rr / 0.85) * Math.PI);
    return rise * (1 - Math.pow(rr, 1.7)) - droop * Math.pow(rr, droopP) * (wave + scal) + corr;
  };
  const capRad = (rr: number, a: number): number => {
    const wob = 1 + 0.06 * (fbm2(Math.cos(a) * 2.4 + capSeed, Math.sin(a) * 2.4, 3) - 0.5) * 2;
    // The lobes open out toward the margin: a cap is circular where it left the
    // veil and irregular where it has been growing for a season.
    const lobe = 1 + lobeA * Math.cos(a * lobeN + lobePh) * smoothstep(0.10, 0.95, rr);
    return capR * rr * wob * lobe;
  };
  /**
   * A cap has an EDGE, and it was a knife.
   *
   * The margin term fell to capR * 0.006 — four millimetres on a six-metre cap —
   * so the two surfaces met in a zero-thickness crease and the whole thing read
   * as a stretched umbrella rather than as a slab of flesh. Real fungal tissue is
   * centimetres thick at the margin and usually rolled under. The floor is now
   * three per cent of the radius with an inrolled lip on the outer tenth, which
   * is what gives the rim a lit top edge, a shadowed underside and a silhouette
   * with a thickness you can read.
   */
  const capThick = (rr: number): number =>
    thick * (1 - Math.pow(rr, 2.2)) + capR * 0.030 * (1 + 0.9 * smoothstep(0.86, 1.0, rr));

  /**
   * The pole is where a polar unwrap dies, so do not put geometry there.
   *
   * At rr = 0 every column of the patch collapses onto one point while its u
   * still sweeps the full atlas width, so 1024 texels of ring, wart and fibre are
   * squeezed into a single vertex — through a 2.6x normal map. That is the "dark
   * cross-shaped UV seam pinch at the cap apex" exactly. Starting the dome at a
   * small non-zero radius and closing the hole with a flat fan whose uv is
   * CONSTANT removes the singularity: the boss reads as the smooth centre of the
   * cap it actually is, and no texture is asked to converge to a point.
   */
  const RR0 = 0.085;
  const capRR = (iv: number): number => lerp(RR0, 1, Math.pow(iv / (rows - 1), 0.85));

  // Upper surface.
  bld.patch(rows, capCols, true, false, (iu, iv, out, uv, par) => {
    const rr = capRR(iv);
    const a = (iu / capCols) * Math.PI * 2;
    const rad = capRad(rr, a);
    out.set(apex.x + Math.cos(a) * rad, apex.y + capY(rr, a), apex.z + Math.sin(a) * rad);
    /**
     * The cap wraps the atlas THREE times, and that is a texel-density fix.
     *
     * u is the lathe angle and maps the full 1024-texel width onto the whole
     * circumference. On a six-metre cap that circumference is thirty-eight metres
     * — 27 texels per metre — while v gets 450 texels across a six-metre radius,
     * i.e. 75. Everything on the cap is therefore smeared azimuthally, which is
     * the review's "no texture variation beyond a smeared radial streak" on the
     * largest object in the near third. Every band in this atlas tiles in u by
     * construction, so an integer wrap count cannot seam.
     *
     * TWO, not three. Three made the texels square at the MARGIN — and squareness
     * at one radius is the wrong target on a polar map, because texel density
     * goes as 1/r: at three wraps the azimuthal frequency near the boss is over
     * thirty times the radial one, so the mip level is chosen by du alone, it
     * steps at quad boundaries, and the crown comes out as blocks of differing
     * sharpness with hard straight edges between them. The world-space surface
     * layer now carries the detail that the extra wraps were bought for (see
     * Surface.ts), so the atlas can afford to be undersampled azimuthally in
     * exchange for a mip level that varies smoothly across the whole cap.
     */
    uv.set((iu * 2) / capCols, bandV(BAND.cap, rr));
    par.stiff = 1.0;
    par.thick = 0.35 + 0.65 * smoothstep(0.15, 1.0, rr);
    par.glow = 0.35 + 0.65 * smoothstep(0.72, 1.0, rr);
    par.ao = 1;
  }, 2);

  // Central boss: one fan, constant uv, no pole.
  {
    const bossPar: VertParam = { stiff: 1, thick: 0.35, glow: 0.35, ao: 1 };
    const hub = bld.vert(
      apex.x, apex.y + capY(0, 0), apex.z,
      0, 1, 0, 0.5, bandV(BAND.cap, RR0 * 0.5), bossPar,
    );
    const ring: number[] = [];
    for (let i = 0; i < capCols; i++) {
      const a = (i / capCols) * Math.PI * 2;
      const rad = capRad(RR0, a);
      const y = apex.y + capY(RR0, a);
      // The boss is nearly flat, so a near-vertical normal is the true one and
      // matches the dome ring it abuts.
      ring.push(
        bld.vert(
          apex.x + Math.cos(a) * rad, y, apex.z + Math.sin(a) * rad,
          Math.cos(a) * 0.14, 0.99, Math.sin(a) * 0.14,
          0.5, bandV(BAND.cap, RR0), bossPar,
        ),
      );
    }
    for (let i = 0; i < capCols; i++) bld.tri(hub, ring[i], ring[(i + 1) % capCols]);
  }

  // Underside. Reversed winding, mapped into the gill band, and heavily
  // occluded — the dark under a parasol is half of why it reads as massive.
  bld.patch(rows, capCols, true, true, (iu, iv, out, uv, par) => {
    const rr = capRR(iv);
    const a = (iu / capCols) * Math.PI * 2;
    const rad = capRad(rr, a);
    out.set(
      apex.x + Math.cos(a) * rad,
      apex.y + capY(rr, a) - capThick(rr),
      apex.z + Math.sin(a) * rad,
    );
    uv.set(iu / capCols, bandV(BAND.gill, rr));
    par.stiff = 1.0;
    // Thin at the margin is what a backlit cap needs: the outer third is where
    // the light gets through, and the transmission term is keyed off this.
    par.thick = 0.45 + 0.55 * smoothstep(0.2, 1.0, rr);
    par.glow = 0.55 + 0.45 * smoothstep(0.35, 0.95, rr);
    par.ao = 0.30 + 0.45 * smoothstep(0.5, 1.0, rr);
  });

  // Close the rim: a band of quads joining the upper margin to the lower one, so
  // the cap has an actual edge rather than two coincident surfaces.
  {
    const ta = 2 * Math.PI;
    const rimPar: VertParam = { stiff: 1, thick: 0.95, glow: 0.9, ao: 0.62 };
    const top: number[] = [];
    const bot: number[] = [];
    for (let i = 0; i <= capCols; i++) {
      const a = ((i % capCols) / capCols) * ta;
      const rad = capRad(1, a);
      const yT = apex.y + capY(1, a);
      const u = i / capCols;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      top.push(bld.vert(apex.x + nx * rad, yT, apex.z + nz * rad, nx, 0.22, nz, u, bandV(BAND.cap, 0.995), rimPar));
      bot.push(
        bld.vert(
          apex.x + nx * rad, yT - capThick(1), apex.z + nz * rad,
          nx, -0.22, nz, u, bandV(BAND.gill, 0.99), rimPar,
        ),
      );
    }
    for (let i = 0; i < capCols; i++) bld.quad(top[i], bot[i], top[i + 1], bot[i + 1]);
  }

  // Radial gill fins. Only at LOD0: at LOD1 the gill texture on the underside
  // carries the read, and the fins are sub-pixel by then anyway.
  if (lod === 0) {
    const G = 20 + rng.int(16);
    const gr = 5;
    const inner = 0.20;
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    for (let g = 0; g < G; g++) {
      const a = (g / G) * Math.PI * 2 + rng.range(-0.02, 0.02);
      // Every other lamella stops short, as real gills do.
      const startR = g % 2 === 0 ? inner : lerp(inner, 0.95, 0.45);
      const depth = capR * rng.range(0.030, 0.055);
      const strip: number[] = [];
      for (let i = 0; i <= gr; i++) {
        const rr = lerp(startR, 0.965, i / gr);
        const rad = capRad(rr, a);
        const y = apex.y + capY(rr, a) - capThick(rr);
        p0.set(apex.x + Math.cos(a) * rad, y, apex.z + Math.sin(a) * rad);
        const d = depth * Math.sin((i / gr) * Math.PI * 0.92) * (0.6 + 0.4 * (rr - startR));
        p1.set(p0.x, y - d, p0.z);
        const u = (g / G) * 8.0; // walk across the gill band so lamellae differ
        const par0: VertParam = {
          stiff: 1,
          thick: 0.9,
          glow: 0.85,
          ao: 0.34 + 0.4 * (i / gr),
        };
        const par1: VertParam = { stiff: 1, thick: 1.0, glow: 1.0, ao: 0.16 + 0.3 * (i / gr) };
        const nrm = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
        strip.push(
          bld.vert(p0.x, p0.y, p0.z, nrm.x, nrm.y, nrm.z, u, bandV(BAND.gill, rr), par0),
          bld.vert(p1.x, p1.y, p1.z, nrm.x, nrm.y, nrm.z, u + 0.02, bandV(BAND.gill, rr * 0.8), par1),
        );
      }
      for (let i = 0; i < gr; i++) {
        const a0 = strip[i * 2];
        const b0 = strip[i * 2 + 1];
        const c0 = strip[i * 2 + 2];
        const d0 = strip[i * 2 + 3];
        bld.quad(a0, b0, c0, d0);
      }
    }
  }

  const geometry = bld.toGeometry();
  // The lobes push the margin out by up to lobeA of the radius, and the impostor
  // quad and the cull sphere are both sized off this number — leave it at 1.06
  // and the widest lobe of every cap is clipped off its own billboard.
  return { geometry, height: apex.y + rise, radius: capR * (1.06 + lobeA) };
}

/* ---------------------------------------------------------- bulb fungus */

/** Squat clustered bulbs — the mid-storey filler between parasols and grass. */
export function buildBulbFungus(seed: number, lod: number): BuiltMesh {
  const rng = new Rng(seed);
  const bld = new Builder();
  const n = 3 + rng.int(5);
  /**
   * 14 -> 16 columns, 10 -> 11 rows, and it is the highlight stepping.
   *
   * A hero pod is two metres across and sits ten metres from the lens on the
   * coast vantage, where the whole cluster fills a fifth of the frame width. At
   * 14 columns the dome's shading normal turns by 26 degrees between one vertex
   * ring and the next, and a specular lobe interpolated across that is a
   * staircase — "the lit crowns show visibly quantized highlight stepping" is a
   * direct measurement of the tessellation, not of the tone curve. 18 x 12 takes
   * the angular step to 20 degrees and halves the meridional one.
   *
   * The cost is paid on LOD0 only, which is capped at 430 instances inside 38 m,
   * and it is bought back by the pore below removing the plugFoot fan from every
   * bell (see there). LOD1 — 1300 instances from 38 to 150 m — is untouched.
   */
  const cols = lod === 0 ? 16 : 8;
  const rows = lod === 0 ? 11 : 6;
  let maxH = 0;
  let maxR = 0;

  for (let k = 0; k < n; k++) {
    const ang = (k / n) * Math.PI * 2 + rng.range(-0.5, 0.5);
    /**
     * 1.15 -> 0.80, and it is the night blocker.
     *
     * The scatter plants a cluster at the LOWEST ground inside `footR` (see
     * SpeciesRule) precisely so no member of it can end up in the air. A
     * satellite at 1.15 plus its own 0.7 radius reaches 1.85 in unit space while
     * the rule's footR is 1.05, so the outermost bulb of a cluster stood over
     * ground the placement never sampled — and on a convex break, which is what
     * the crest of the night mound is, that ground falls away. The result is a
     * detached octagonal chunk hanging over a boulder with daylight under it.
     *
     * Two halves to the fix and both are needed: the offsets come in so the
     * cluster fits inside a footprint that can be probed affordably, and footR
     * goes out to 2.0 with a deeper sink (see Scatter.ts) so the probe ring
     * actually covers what is drawn.
     */
    const off = k === 0 ? 0 : rng.range(0.22, 0.80);
    const cx = Math.cos(ang) * off;
    const cz = Math.sin(ang) * off;
    const bh = rng.range(0.55, 2.3) * (k === 0 ? 1.25 : 1);
    const br = bh * rng.range(0.34, 0.62);
    const stalkH = bh * rng.range(0.22, 0.42);
    const stalkR = br * rng.range(0.28, 0.45);
    const nipple = rng.range(0.05, 0.22);
    const lumpS = rng.range(0, 40);
    const tilt = rng.range(0, 0.18);
    const tiltA = rng.range(0, 6.283);

    /**
     * Cap silhouette.
     *
     * One profile stamped across a whole population is the loudest clone tell
     * there is, and no amount of yaw or scale jitter hides it — the outline is
     * what the eye matches on. Four genuinely different profiles, rolled per
     * bulb rather than per plant, so even a single cluster carries a mixture:
     *
     *   0 puffball  — the original swollen bulb
     *   1 parasol   — a flat wide disc on a slim stipe
     *   2 conical   — tall, narrow, drawn to a point
     *   3 bell      — a deep skirt with an inrolled margin
     */
    const style = rng.int(4);
    const capT = style === 1 ? 0.52 : style === 2 ? 0.22 : style === 3 ? 0.44 : 0.30;
    const capW = style === 1 ? 1.45 : style === 2 ? 0.52 : style === 3 ? 1.20 : 1.0;

    /** Lathe radius at height fraction t, before the per-angle lump. */
    const profR = (t: number): number => {
      if (t < capT) return lerp(stalkR * 1.7, stalkR, Math.pow(t / capT, 0.6));
      const s = (t - capT) / (1 - capT);
      let r: number;
      if (style === 2) {
        // Conical: a straight-sided spire, not a dome.
        r = br * capW * (1 - Math.pow(s, 0.72));
      } else if (style === 3) {
        // Bell: widest a third of the way up, then tucked under.
        r = br * capW * Math.sin(Math.pow(s, 0.62) * Math.PI * 0.94);
      } else {
        r = br * capW * Math.sin(s * Math.PI) * (1 + nipple * Math.pow(s, 3));
      }
      return Math.max(r, stalkR * (1 - s) * 0.9);
    };
    const profY = (t: number): number =>
      t < capT
        ? (t / capT) * stalkH
        : stalkH + (bh - stalkH) * (0.5 - 0.5 * Math.cos(((t - capT) / (1 - capT)) * Math.PI));
    const lumpAt = (a: number, t: number): number =>
      1 + 0.13 * (fbm2(Math.cos(a) * 2.2 + lumpS, Math.sin(a) * 2.2 + t * 3, 3) - 0.5) * 2;
    const swayAt = (t: number): number => Math.pow(t, 1.8) * tilt * bh;

    bld.patch(rows, cols, true, false, (iu, iv, out, uv, par) => {
      const t = iv / (rows - 1);
      const a = (iu / cols) * Math.PI * 2;
      const r = profR(t) * lumpAt(a, t);
      const y = profY(t);
      const sway = swayAt(t);
      out.set(cx + Math.cos(a) * r + Math.cos(tiltA) * sway, y, cz + Math.sin(a) * r + Math.sin(tiltA) * sway);
      /**
       * The cap band's v is WARPED AZIMUTHALLY on a pod, and this is the other
       * half of the fingerprint.
       *
       * capSample() paints 28 concentric growth rings across the cap band — dead
       * right on a parasol, where that band is the radius of a disc, and dead
       * wrong here, where it is swept up the meridian of a closed dome. A ring in
       * a meridional coordinate is a horizontal contour line, and contour lines
       * on a dome converge on its pole: 28 of them is the "low-octave concentric
       * whorl that reads as a fingerprint" the review measured on the near pod.
       * Disabling the world-space ridge term (see capDome in Surface.ts) removes
       * one source; this removes the other, and it has to be done here because
       * the atlas is shared with the parasol, which needs its rings.
       *
       * Perturbing the band coordinate by a smooth function of the ANGLE turns
       * every one of those contours into an irregular closed blotch. The
       * amplitude is 0.30 of the band against a ring period of 1/28, so a ring is
       * displaced by up to eight periods around the circumference: there is no
       * concentric structure left to read. It stays a smooth, low-frequency
       * mapping, so texel density and mip selection are barely affected — which a
       * noise-indexed lookup would not be.
       */
      const capS = (t - capT) / (1 - capT);
      const warp = fbm2(Math.cos(a) * 4.2 + lumpS * 0.5, Math.sin(a) * 4.2 + capS * 4.6, 3) - 0.5;
      uv.set(
        iu / cols,
        t < capT
          ? bandV(BAND.stalk, t / capT)
          : bandV(BAND.cap, clamp01(capS * 0.72 + 0.14 + warp * 0.90)),
      );
      par.stiff = Math.pow(t, 1.4);
      par.thick = 0.35 + 0.65 * t;
      // Glow concentrated on the upper third of the bulb: these are the little
      // lamps that make a night vale readable.
      par.glow = smoothstep(0.45, 1.0, t) * rng.range(0.7, 1.0);
      par.ao = clamp01(smoothstep(0.0, 0.12, t) * (k === 0 ? 1 : 0.85));
    });

    /**
     * THE APICAL PORE, and it is why the near pod has holes cut in it.
     *
     * patch() closes nothing in v, so the top ring of the lathe is an open mouth
     * wherever the profile does not converge. Three of the four styles taper to
     * r = 0 and are therefore self-closing; the BELL does not — sin(0.94 pi) is
     * 0.187, so it ends on a ring of about a fifth of the cap radius. That ring
     * is a hole straight into the unlit interior of a back-face-culled lathe, and
     * from above it renders as exactly what the review measured: "two perfectly
     * flat, hard-edged dark ellipses punched into the top with no interior
     * geometry, no rim and no AO gradient". It was never a texture; it was a
     * hole.
     *
     * Closing it flat would be the cheap answer and the wrong one, because a
     * puffball really does have an ostiole and it is the most characterful thing
     * on the plant. So it gets the real article: a thickened lip rolled slightly
     * proud of the flank, a funnel that descends into the body, and a hub at the
     * bottom. The baked occlusion walks 0.55 at the lip down to 0.04 in the
     * throat, which is the interior AO gradient the review asked for by name —
     * and because it is geometry rather than a painted disc, it self-shadows and
     * turns with the plant.
     */
    const rTop = profR(1);
    if (rTop > br * 0.05) {
      const yTop = profY(1);
      const sway = swayAt(1);
      const ox = cx + Math.cos(tiltA) * sway;
      const oz = cz + Math.sin(tiltA) * sway;
      const depth = Math.min(rTop * 1.6, (bh - stalkH) * 0.38);
      /**
       * Radius decreases monotonically and the height rises before it falls, so
       * one winding builds the whole thing: an outer roll (radius in, height up)
       * that reads as a raised papilla, then the inner lip, then the throat. The
       * first ring is COINCIDENT with the lathe's top ring, which is what seals
       * the mouth rather than leaving a hairline crack around it.
       */
      const rings: { r: number; y: number; nOut: number; nUp: number; ao: number; v: number }[] = [
        { r: 1.00, y: 0.00, nOut: 0.88, nUp: 0.47, ao: 0.60, v: 0.995 },
        { r: 0.90, y: 0.16, nOut: 0.42, nUp: 0.91, ao: 0.48, v: 0.92 },
        { r: 0.72, y: 0.06, nOut: -0.62, nUp: 0.78, ao: 0.26, v: 0.70 },
        { r: 0.44, y: -0.42, nOut: -0.93, nUp: 0.37, ao: 0.11, v: 0.42 },
        { r: 0.18, y: -0.82, nOut: -0.84, nUp: 0.54, ao: 0.05, v: 0.20 },
      ].map((g) => ({ ...g, r: rTop * g.r, y: yTop + depth * g.y }));
      const idx: number[][] = [];
      for (const rg of rings) {
        const row: number[] = [];
        const par: VertParam = { stiff: 1, thick: 0.30, glow: 0.15, ao: rg.ao };
        for (let i = 0; i < cols; i++) {
          const a = (i / cols) * Math.PI * 2;
          const rr = rg.r * lumpAt(a, 1);
          const l = Math.hypot(rg.nOut, rg.nUp) || 1;
          row.push(
            bld.vert(
              ox + Math.cos(a) * rr, rg.y, oz + Math.sin(a) * rr,
              (Math.cos(a) * rg.nOut) / l, rg.nUp / l, (Math.sin(a) * rg.nOut) / l,
              i / cols, bandV(BAND.gill, rg.v), par,
            ),
          );
        }
        idx.push(row);
      }
      for (let b = 0; b < idx.length - 1; b++) {
        for (let i = 0; i < cols; i++) {
          const j = (i + 1) % cols;
          bld.quad(idx[b][i], idx[b + 1][i], idx[b][j], idx[b + 1][j]);
        }
      }
      const floorPar: VertParam = { stiff: 1, thick: 0.25, glow: 0.10, ao: 0.03 };
      const hub = bld.vert(ox, yTop - depth, oz, 0, 1, 0, 0.5, bandV(BAND.gill, 0.12), floorPar);
      const last = idx[idx.length - 1];
      for (let i = 0; i < cols; i++) bld.tri(hub, last[(i + 1) % cols], last[i]);
    }
    // Same open-tube problem as the parasol stipe, and the same fix: a bulb
    // cluster sits on ground that is never flat under all of it, so any bulb
    // whose foot the heightfield cuts would otherwise show its hollow inside.
    /**
     * A DEEP buried skirt, for the same reason the parasol has one.
     *
     * At stalkR * 1.2 the plug reached about a fifth of a bulb radius below the
     * cluster origin. A cluster is planted at one height but its members stand on
     * ground that varies by tens of centimetres across it, so a satellite whose
     * local ground is lower than the pivot showed daylight under its foot — the
     * gap the night review measured. Extending the skirt to nearly half a bulb
     * radius means the heightfield CUTS solid geometry wherever it happens to
     * fall, which is the only robust answer: no placement rule can predict the
     * terrain under every member of a cluster, but a foot that continues below
     * the surface does not care.
     */
    plugFoot(bld, cx, cz, cols, Math.max(0.10, br * 0.45), () => stalkR * 1.7, bandV(BAND.stalk, 0.04));
    maxH = Math.max(maxH, bh);
    // The CAP's half-extent, not the bulb's. A style-1 disc is 1.45x its own
    // radius, so reporting `br` under-stated the cluster by nearly half — and
    // this number is what the placement rule's footprint has to cover if no
    // member of the cluster is to end up standing over unsampled ground.
    maxR = Math.max(maxR, off + br * Math.max(1, capW));
  }

  return { geometry: bld.toGeometry(), height: maxH, radius: maxR };
}

/* ----------------------------------------------------------- trama root */

/** Thorny, twisted, grey-black. Grows in ash; nothing about it is soft. */
export function buildTramaRoot(seed: number, lod: number): BuiltMesh {
  const rng = new Rng(seed);
  const bld = new Builder();
  const arms = 2 + rng.int(3);
  // Twelve sides, not eight. At the size this thing occupies in a near-field
  // frame its silhouette is read directly, and an octagonal bole draws four
  // hard straight facet edges down its own length — the "cut cardboard" the
  // review named. The normals were always smooth; the outline was not.
  const cols = lod === 0 ? 12 : 6;
  const rows = lod === 0 ? 16 : 7;
  let maxH = 0;
  let maxR = 0;
  const p = new THREE.Vector3();

  for (let k = 0; k < arms; k++) {
    const H = rng.range(1.4, 4.2);
    const baseR = H * rng.range(0.045, 0.080);
    const a0 = (k / arms) * Math.PI * 2 + rng.range(-0.6, 0.6);
    const twist = rng.range(1.4, 3.6) * rng.sign();
    const outward = rng.range(0.18, 0.55);
    const ctrl: THREE.Vector3[] = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      // A helix that opens outward and whips back: the coiled, arthritic look.
      const ang = a0 + twist * t * t;
      const rad = outward * H * Math.pow(t, 1.3) * (1 - 0.35 * t);
      ctrl.push(
        new THREE.Vector3(
          Math.cos(ang) * rad + rng.around(0, 0.06 * H * t),
          t * H * (1 - 0.18 * t),
          Math.sin(ang) * rad + rng.around(0, 0.06 * H * t),
        ),
      );
    }
    // Texel density along the limb, from its own dimensions rather than from a
    // constant. A trama root is a 4 m limb with a 15 cm butt, so it needs far
    // more tiles than a fat parasol stipe of the same height does.
    const vTile = stalkVTile(H, baseR);
    const vPhase = rng.next() * 2;
    bld.patch(rows, cols, true, false, (iu, iv, out, uv, par) => {
      const t = iv / (rows - 1);
      const a = (iu / cols) * Math.PI * 2;
      spline(ctrl, t, p);
      // Real taper: a limb that keeps 15% of its butt radius all the way to the
      // tip reads as a ribbon of constant width. This one comes to a point.
      let r = baseR * Math.pow(1 - 0.94 * t, 0.72);
      r *= 1 + 1.4 * Math.exp(-(t * t) / 0.004);
      // Longitudinal ridges: a trama root is fluted, not round. Two
      // incommensurate flute counts so the cross-section is never an n-gon, and
      // a slow twist up the limb so the flutes spiral the way grain does.
      r *= 1 + 0.20 * Math.cos(a * 5 + t * 4.0) + 0.11 * Math.cos(a * 8 - t * 6.3);
      // Knots: local swellings where a branch was shed.
      r *= 1 + 0.16 * Math.exp(-Math.pow((t - 0.34) / 0.07, 2)) +
           0.13 * Math.exp(-Math.pow((t - 0.62) / 0.05, 2));
      out.set(p.x + Math.cos(a) * r, p.y, p.z + Math.sin(a) * r);
      // Two tiles of bark up the limb rather than one stretched over four
      // metres: at 0.5-1 m per repeat the fibre and the annular wrinkles are
      // the size they are supposed to be instead of a smear. Ping-ponged, not
      // wrapped — a wrap would put a hard ring of discontinuity round the bole
      // at half height, which is a louder defect than the smear it fixes.
      uv.set(iu / cols, bandV(BAND.stalk, 0.05 + 0.80 * pingPong(t * vTile + vPhase)));
      par.stiff = Math.pow(t, 2.1); // woody: barely moves
      par.thick = 0.04;
      par.glow = 0;
      // Cavity darkening. The flute valleys and the crotch where the limbs
      // leave the base are the two places a dead limb self-occludes, and
      // without them the bole is one flat value from root to tip.
      const cav = 0.5 + 0.5 * Math.cos(a * 5 + t * 4.0);
      par.ao = clamp01(smoothstep(0.0, 0.16, t) * (0.62 + 0.38 * cav) *
                       (0.55 + 0.45 * smoothstep(0.05, 0.30, t)));
    });
    // Close the butt of the limb and sink it. FrontSide culling means an open
    // tube reads as a hole punched in the plant from any angle above it.
    plugFoot(
      bld, ctrl[0].x, ctrl[0].z, cols, Math.max(0.05, baseR * 1.5),
      (a) => baseR * 2.4 * (1 + 0.20 * Math.cos(a * 5) + 0.11 * Math.cos(a * 8)),
      bandV(BAND.stalk, 0.04),
    );

    // Thorns: three-sided spikes along the outer face of each arm.
    if (lod === 0) {
      const thorns = 5 + rng.int(7);
      for (let i = 0; i < thorns; i++) {
        const t = rng.range(0.12, 0.92);
        const a = rng.range(0, Math.PI * 2);
        spline(ctrl, t, p);
        const r = baseR * Math.pow(1 - 0.85 * t, 0.8) * (1 + 0.22 * Math.cos(a * 5 + t * 4.0));
        const len = H * rng.range(0.035, 0.075);
        const ox = Math.cos(a);
        const oz = Math.sin(a);
        const tipY = p.y + rng.range(0.1, 0.5) * len;
        const par0: VertParam = { stiff: Math.pow(t, 2.1), thick: 0.03, glow: 0, ao: 0.7 };
        const tip = bld.vert(
          p.x + ox * (r + len), tipY, p.z + oz * (r + len),
          ox, 0.35, oz, 0.5, bandV(BAND.stalk, 0.2), par0,
        );
        const ring: number[] = [];
        for (let s = 0; s < 3; s++) {
          const sa = a + (s / 3) * Math.PI * 2 * 0.28 - 0.28;
          const rr = r * 0.9;
          const yy = p.y + (s - 1) * len * 0.22;
          ring.push(
            bld.vert(
              p.x + Math.cos(sa) * rr, yy, p.z + Math.sin(sa) * rr,
              Math.cos(sa), 0, Math.sin(sa), 0.5, bandV(BAND.stalk, 0.15), par0,
            ),
          );
        }
        bld.tri(ring[0], ring[1], tip);
        bld.tri(ring[1], ring[2], tip);
        bld.tri(ring[2], ring[0], tip);
      }
    }
    maxH = Math.max(maxH, H);
    maxR = Math.max(maxR, outward * H);
  }
  return { geometry: bld.toGeometry(), height: maxH, radius: Math.max(maxR, 0.4) };
}

/* ------------------------------------------------------- leafy species */

interface LeafOpts {
  count: number;
  length: number;
  width: number;
  arch: number;
  twist: number;
  segs: number;
  cols: number;
  band: readonly [number, number];
  thick: number;
  yBase: number;
  spread: number;
  glow: number;
}

/** A fan of arching fleshy leaves. Shared by marshmerrow, ash yam and kelp. */
function addLeaves(bld: Builder, rng: Rng, o: LeafOpts): { h: number; r: number } {
  let maxH = 0;
  let maxR = 0;
  for (let k = 0; k < o.count; k++) {
    const a = (k / o.count) * Math.PI * 2 + rng.range(-0.35, 0.35);
    const L = o.length * rng.range(0.7, 1.25);
    const W = o.width * rng.range(0.75, 1.3);
    const arch = o.arch * rng.range(0.6, 1.5);
    const tw = o.twist * rng.range(-1, 1);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    bld.patch(o.segs, o.cols, false, false, (iu, iv, out, uv, par) => {
      const t = iv / (o.segs - 1);
      const s = iu / (o.cols - 1);
      // Lanceolate outline: widest a third of the way up, drawn to a point.
      const w = W * Math.sin(Math.pow(t, 0.55) * Math.PI * 0.96) * (1 - 0.15 * t);
      const lateral = (s - 0.5) * w;
      const along = o.spread + L * t;
      // Arch: rises then bends over under its own weight.
      const y = o.yBase + L * (arch * t - (arch + 0.35) * t * t * 0.85);
      // The blade folds along its midrib, which is what stops a leaf reading as
      // a flat card the moment the sun moves off-axis.
      const fold = -Math.abs(lateral) * 0.28 * (1 - 0.5 * t);
      const twistY = lateral * Math.sin(t * 3.0 + tw) * 0.35;
      out.set(
        ca * along - sa * lateral,
        y + fold + twistY,
        sa * along + ca * lateral,
      );
      uv.set(s, bandV(o.band, t));
      par.stiff = Math.pow(t, 1.15);
      par.thick = o.thick * (0.6 + 0.4 * t);
      par.glow = o.glow * t;
      par.ao = clamp01(0.35 + 0.65 * t);
    });
    maxH = Math.max(maxH, o.yBase + L * arch * 0.55);
    maxR = Math.max(maxR, o.spread + L * 0.85);
  }
  return { h: maxH, r: maxR };
}

/** Marshmerrow — tall wet-ground reed with a fan of red-based blades. */
export function buildMarshmerrow(seed: number, lod: number): BuiltMesh {
  const rng = new Rng(seed);
  const bld = new Builder();
  const L = rng.range(1.1, 2.6);
  const r = addLeaves(bld, rng, {
    count: 5 + rng.int(6),
    length: L,
    width: L * rng.range(0.10, 0.17),
    arch: rng.range(1.05, 1.4),
    twist: 0.9,
    segs: lod === 0 ? 7 : 4,
    // FIVE columns across the lamina at LOD0, not three.
    //
    // Three columns is two quads across a blade that is twenty-five centimetres
    // wide and, on the coast vantage, two metres from the lens — so the fold
    // along the midrib is a single crease between two flat facets and the
    // review reads exactly what is there: "visibly faceted quad segments with
    // straight-line borders". The cross-section is a fold, a curve and a rolled
    // margin; it needs four spans to be any of those. LOD1 keeps three, where
    // the whole blade is under six pixels.
    cols: lod === 0 ? 5 : 3,
    band: BAND.leaf,
    thick: 0.85,
    yBase: 0.02,
    spread: L * 0.04,
    glow: 0,
  });
  return { geometry: bld.toGeometry(), height: r.h, radius: r.r };
}

/** Ash yam — a half-buried tuber with a low rosette of broad leaves. */
export function buildAshYam(seed: number, lod: number): BuiltMesh {
  const rng = new Rng(seed);
  const bld = new Builder();
  const tr = rng.range(0.16, 0.34);
  const cols = lod === 0 ? 12 : 7;
  const rows = lod === 0 ? 8 : 5;
  const lumpS = rng.range(0, 30);
  // The tuber breaks the surface: a dome, not a sphere, so it never floats.
  bld.patch(rows, cols, true, false, (iu, iv, out, uv, par) => {
    const t = iv / (rows - 1);
    const a = (iu / cols) * Math.PI * 2;
    const th = t * Math.PI * 0.62;
    const lump = 1 + 0.22 * (fbm2(Math.cos(a) * 2.6 + lumpS, Math.sin(a) * 2.6 + t * 2, 3) - 0.5) * 2;
    const r = tr * Math.sin(Math.PI * 0.5 + th) * lump;
    out.set(Math.cos(a) * r, tr * 0.62 * (1 - Math.cos(th)) * lump - tr * 0.10, Math.sin(a) * r);
    uv.set(iu / cols, bandV(BAND.stalk, 0.1 + 0.5 * t));
    par.stiff = 0;
    par.thick = 0.08;
    par.glow = 0;
    par.ao = clamp01(0.25 + 0.75 * t);
  });
  const L = rng.range(0.45, 0.95);
  const r = addLeaves(bld, rng, {
    count: 4 + rng.int(4),
    length: L,
    width: L * rng.range(0.28, 0.42),
    arch: rng.range(0.55, 0.9),
    twist: 0.6,
    segs: lod === 0 ? 6 : 4,
    cols: lod === 0 ? 5 : 3,
    band: BAND.leaf,
    thick: 0.7,
    yBase: tr * 0.5,
    spread: tr * 0.7,
    glow: 0,
  });
  return { geometry: bld.toGeometry(), height: Math.max(r.h, tr), radius: Math.max(r.r, tr) };
}

/** Stoneflower — squat rock-dweller: a woody boss ringed with fleshy pads. */
export function buildStoneflower(seed: number, lod: number): BuiltMesh {
  const rng = new Rng(seed);
  const bld = new Builder();
  const R = rng.range(0.18, 0.42);
  const pads = 5 + rng.int(5);
  const cols = lod === 0 ? 5 : 3;
  const rows = lod === 0 ? 5 : 3;
  let maxR = R;
  for (let k = 0; k < pads; k++) {
    const a = (k / pads) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const L = R * rng.range(1.5, 2.6);
    const W = R * rng.range(0.7, 1.15);
    const lift = rng.range(0.25, 0.7);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    bld.patch(rows, cols, false, false, (iu, iv, out, uv, par) => {
      const t = iv / (rows - 1);
      const s = iu / (cols - 1);
      const w = W * Math.sin(Math.pow(t, 0.5) * Math.PI * 0.95);
      const lateral = (s - 0.5) * w;
      const along = R * 0.35 + L * t;
      const y = R * 0.22 + L * (lift * t - lift * 1.35 * t * t);
      out.set(ca * along - sa * lateral, y - Math.abs(lateral) * 0.2, sa * along + ca * lateral);
      uv.set(s, bandV(BAND.leaf, 0.15 + 0.8 * t));
      par.stiff = Math.pow(t, 1.3);
      par.thick = 0.55;
      // A pale glow at the pad tips; stoneflowers are the ones you see first on
      // a night cliff face.
      par.glow = 0.55 * smoothstep(0.5, 1.0, t);
      par.ao = clamp01(0.4 + 0.6 * t);
    });
    maxR = Math.max(maxR, R * 0.35 + L);
  }
  // Woody boss.
  bld.patch(4, 8, true, false, (iu, iv, out, uv, par) => {
    const t = iv / 3;
    const a = (iu / 8) * Math.PI * 2;
    const r = R * (0.85 - 0.5 * t) * (1 + 0.9 * Math.exp(-(t * t) / 0.02));
    out.set(Math.cos(a) * r, t * R * 0.5, Math.sin(a) * r);
    uv.set(iu / 8, bandV(BAND.stalk, 0.1));
    par.stiff = 0;
    par.thick = 0.05;
    par.glow = 0;
    par.ao = clamp01(0.3 + 0.7 * t);
  });
  return { geometry: bld.toGeometry(), height: R * 1.4, radius: maxR };
}

/** Kelp and coral — the only flora below sea level. Tall, limp, wide fronds. */
export function buildKelp(seed: number, lod: number): BuiltMesh {
  const rng = new Rng(seed);
  const bld = new Builder();
  const L = rng.range(1.2, 4.0);
  const r = addLeaves(bld, rng, {
    count: 4 + rng.int(5),
    length: L,
    width: L * rng.range(0.14, 0.26),
    arch: rng.range(1.15, 1.5),
    twist: 1.6,
    segs: lod === 0 ? 8 : 4,
    cols: lod === 0 ? 5 : 3,
    band: BAND.leaf,
    thick: 1.0,
    yBase: 0.05,
    spread: L * 0.05,
    glow: 0.55, // reef bioluminescence, visible through the water column
  });
  // Holdfast, so it is anchored rather than sprouting from nothing.
  bld.patch(3, 7, true, false, (iu, iv, out, uv, par) => {
    const t = iv / 2;
    const a = (iu / 7) * Math.PI * 2;
    const rr = L * 0.075 * (1.7 - t) * (1 + 0.25 * Math.cos(a * 3));
    out.set(Math.cos(a) * rr, t * L * 0.06, Math.sin(a) * rr);
    uv.set(iu / 7, bandV(BAND.stalk, 0.05));
    par.stiff = 0;
    par.thick = 0.2;
    par.glow = 0.2;
    par.ao = 0.35 + 0.4 * t;
  });
  return { geometry: bld.toGeometry(), height: r.h, radius: r.r };
}
