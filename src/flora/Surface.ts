/**
 * World-space surface detail for the fungal canopy.
 *
 * WHY THIS EXISTS AT ALL, given there is already a 1024^2 band atlas.
 *
 * The atlas is parameterised by the LATHE: u is the angle around the axis and v
 * is the fraction along it. That is the only parameterisation a generated lathe
 * can have, and it has two failures that no amount of authoring inside the atlas
 * can fix.
 *
 *  1. It is polar. On a cap, one wrap of u is stretched over a 38 m circumference
 *     at the margin and over a 3 m one near the boss, so texel density varies by
 *     more than ten to one along the radius. Everything the atlas paints therefore
 *     changes scale — and changes MIP LEVEL — as a function of radius alone, which
 *     is precisely what makes a cap read as a set of concentric bands of differing
 *     sharpness with a smooth clay dome outside them. Anisotropic filtering
 *     mitigates the blur; it cannot mitigate the fact that the FEATURES converge.
 *
 *  2. It mips. Every feature the atlas carries is centimetre-scale, so at twenty
 *     metres the whole cap collapses to one flat value. "Untextured hero assets"
 *     is not a claim that no texture is bound; it is a measurement of what
 *     survives minification, and the answer was nothing.
 *
 * This layer is the complement: a small procedural field evaluated in WORLD space
 * in the fragment shader, at metre and decimetre wavelengths, with every octave
 * faded out analytically once its wavelength approaches the pixel footprint, plus
 * a set of purely ANALYTIC lathe-space terms (sectors, growth rings, the margin
 * band, the lamella comb) whose antialiasing is one smoothstep rather than a mip
 * chain. It cannot moire (nothing is ever sampled below Nyquist), and it does not
 * mip away with distance — the metre-scale terms are still several pixels wide on
 * a twelve-metre cap seen at two hundred metres, which is the range at which
 * three consecutive reviews measured "smooth clay".
 *
 * ---------------------------------------------------------------------------
 * WHY THE PREVIOUS CUT OF THIS FILE DID NOT READ, AND IT WAS NOT THE AUTHORING
 * ---------------------------------------------------------------------------
 *
 * Everything below was already here in some form and the caps still measured as
 * clay. The reason is that the whole layer was switched OFF at about a quarter of
 * the distance its author believed, by two independent factors:
 *
 *  1. The metres-per-pixel constant was 1740, quoted as "1920 px across a
 *     62-degree horizontal field". The camera is a 65-degree VERTICAL field on a
 *     16:9 frame, i.e. 97 degrees horizontal: the true figure is (H/2)/tan(fov/2)
 *     = 848 px per unit of distance at 1080p, so one pixel covers d/848 metres and
 *     not d/1740. Every range in the subsystem was therefore being enforced at
 *     0.49 of its nominal value. It is now derived from the live camera and
 *     viewport (uSurfPx) instead of being a literal, so it is also correct at 4K,
 *     under a different field of view, and after a resize.
 *
 *  2. fwidth() is |dFdx| + |dFdy|, not the per-pixel step, so the quantity the
 *     range is compared against runs about 1.2x the footprint on a flat-on
 *     surface and more at a slant. That factor is now folded into uSurfPx so the
 *     species numbers mean metres.
 *
 *  Together: a parasol declaring a 130 m range was losing the layer at 55 m,
 *  while its LOD0 mesh runs to 110 m and its silhouette is still forty pixels
 *  wide at three hundred. The measured consequence, in a cap-only crop of a
 *  parasol at ninety metres, was a luminance standard deviation of 7.6 levels out
 *  of 255 — one flat brown with a soft stain on it.
 *
 * The third factor was that LOD1 never had the layer at all, and LOD1 is where
 * every mid-ground parasol in every canonical frame lives. That is now covered by
 * the FAR variant of this function (see surfaceGlsl below), which is the reason
 * this module is a generator rather than a constant: the far program contains
 * only the coarse lattice and the analytic terms, so the two fine lattices that
 * made LOD1 unaffordable when it was tried before are not merely skipped at
 * runtime, they are not compiled into it.
 *
 * Cost: one scalar value-noise lattice plus a dozen analytic terms in the far
 * variant; two more lattices, both behind runtime branches on the pixel
 * footprint, in the near one. Grass, lichen and leaves never enter the function —
 * the band test rejects them in three instructions — and neither does anything
 * past its range.
 */

/**
 * Oblique projection of world space onto two orthonormal axes.
 *
 * A plain XZ projection is the obvious choice and it is wrong here: a stalk is
 * vertical, so its whole surface would sample one line of the field and the
 * detail would smear into vertical stripes — the exact defect ("a 1D vertical
 * smear") this layer is meant to cure. A plain XY is wrong for the caps for the
 * mirror reason. These two axes are orthogonal, and neither is orthogonal to a
 * horizontal cap OR to a vertical stipe, so no surface orientation degenerates.
 * The v axis is deliberately short (0.55 of a metre per unit in the horizontal
 * plane) so the field is mildly anisotropic — pigment in tissue is anisotropic,
 * and a perfectly isotropic blotch field reads as noise rather than as growth.
 */
const HEAD = /* glsl */ `
const vec3 F_SU = vec3( 0.86603, 0.0,     0.50000);
const vec3 F_SV = vec3(-0.27600, 0.92000, 0.47800);
const float F_TAU = 6.2831853;

/**
 * Value noise with its analytic gradient.
 *
 * The gradient is what turns the field into RELIEF rather than into a stain: fed
 * back as a normal perturbation it gives blisters and pores a lit side and a
 * shadowed side, which is the difference between a mottled surface and a
 * mottled photograph of a surface. Analytic, not screen-space: dFdx of a noise
 * field at grazing incidence is garbage, and garbage in a normal is a sparkle.
 *
 * The returned gradient is with respect to the function's own argument, i.e. per
 * lattice cell, so the caller folds in the frequency it chose.
 */
float fSurfNd(vec2 p, out vec2 g) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  vec2 dw = 6.0 * f * (1.0 - f);
  float a = fHash12(i);
  float b = fHash12(i + vec2(1.0, 0.0));
  float c = fHash12(i + vec2(0.0, 1.0));
  float d = fHash12(i + vec2(1.0, 1.0));
  float k1 = b - a;
  float k2 = c - a;
  float k3 = a - b - c + d;
  g = dw * vec2(k1 + k3 * w.y, k2 + k3 * w.x);
  return a + k1 * w.x + k2 * w.y + k3 * w.x * w.y;
}
`;

/**
 * The surface layer.
 *
 *   wpos    world position of the fragment
 *   nW      world normal (geometric + vertex, before the atlas normal map)
 *   auv     atlas coordinate; auv.y selects the band, auv.x is the lathe angle
 *   along   0 at the base of a stipe, 1 at its neck (aParam.x)
 *   fwMax   pixel footprint, in world metres, past which the layer is not drawn
 *   seed    per-instance draw in [0,1); the only thing that stops two plants
 *           sharing a growth-ring rhythm
 *   footM   width of the damp foot band in units of "along", computed from the
 *           species' real height so it is the bottom HALF METRE of the plant
 *           rather than the bottom third of it. See the note at the foot.
 *   dome    1 on a species whose cap band sweeps the meridian of a closed dome
 *           (a puffball) rather than the radius of a disc (a parasol). The
 *           concentric terms are only meaningful in the second case.
 *
 * albedo is modified in place. The three outs are handed to the roughness, the
 * occlusion and the normal further down the standard fragment.
 *
 * @param far  compile the reduced variant: coarse lattice and analytic terms
 *             only, for the LOD1 mesh where the fine lattices are unaffordable
 *             and — a 43 cm feature past a hundred metres being a third of a
 *             pixel — would be invisible anyway.
 */
export function surfaceGlsl(far: boolean): string {
  /** Near-only source, elided entirely from the far program. */
  const N = (s: string): string => (far ? '' : s);
  /** Far-program substitute for a quantity the near program computes. */
  const F = (nearExpr: string, farExpr: string): string => (far ? farExpr : nearExpr);

  return /* glsl */ `
#ifndef FLORA_SURFACE
#define FLORA_SURFACE
${HEAD}

void floraSurface(
  vec3 wpos, vec3 nW, vec2 auv, float along, float fwMax, float seed,
  float footM, float dome,
  inout vec3 albedo, out float roughAdd, out float occ, out vec3 nrmAdd
) {
  roughAdd = 0.0;
  occ = 1.0;
  nrmAdd = vec3(0.0);
  /**
   * The BLADE band (0.00-0.10) opts out; the LEAF band (0.10-0.22) no longer
   * does, and that was the coast blocker.
   *
   * A three-centimetre grass card genuinely has no metre-scale surface to give,
   * and this is the layer that would be paid a hundred thousand times, so the
   * blade band still exits in two instructions. A marshmerrow blade is a
   * different object: it is up to two and a half metres long, it is the closest
   * thing to the lens on the coast vantage, and the atlas alone cannot carry it
   * for exactly the reason set out at the head of this file — every feature the
   * band paints is millimetre-scale and has mipped to a flat mean by the time
   * the plant is four metres away. It got the flat mean, and three reviews in a
   * row called it untextured clay.
   */
  if (auv.y < 0.10) return;

  vec2 sc = vec2(dot(wpos, F_SU), dot(wpos, F_SV));
  /**
   * World metres covered by one pixel, in the projection's own units, and the
   * gate that makes the whole layer affordable.
   *
   * fwMax is now a live quantity — surfaceRange (metres) times uSurfPx, which
   * the flora system recomputes from the camera's field of view and the viewport
   * height every frame. See the note at the head of this file: the constant it
   * replaces was out by more than a factor of two and was the single reason the
   * layer was not reading on any plant past about a third of its declared range.
   */
  float fw = max(fwidth(sc.x), fwidth(sc.y));
  if (fw > fwMax) return;
  // ...and it has to FADE to that cut, not hit it. A hard switch-off is a pop as
  // a plant crosses the radius, and a pop on the albedo AND the roughness AND
  // the normal at once is a far louder defect than the detail is worth.
  float amp = 1.0 - smoothstep(fwMax * 0.72, fwMax, fw);
  vec3 albedo0 = albedo;
  // Derivatives must be taken outside the band branch; they are undefined in
  // non-uniform control flow and a stalk quad and a cap quad can share a warp.
  float fwU = fwidth(auv.x);
  // ...and the band coordinate, for the crown's concentric ridges. Same rule.
  float fwV = fwidth(auv.y);

  /**
   * THE COARSE LATTICE, at ~1.6 m, and it is the one that has to carry the
   * plant at silhouette range.
   *
   * On a twelve-metre parasol cap that is seven and a half cycles across the
   * diameter, so at two hundred metres — where the cap is fifty pixels wide —
   * one cycle is still nearly seven pixels. This is the term that is supposed to
   * answer "the frame is untextured", and it can only do so if it is (a) still
   * switched on out there, which is what the fwMax fix above is for, and (b)
   * carrying enough contrast to survive aerial perspective, which is what the
   * stretch below is for.
   *
   * Raw value noise spends most of its time near 0.5 — its distribution is the
   * convolution of four uniforms, so |h - 0.5| exceeds 0.3 on well under a fifth
   * of the domain. Feeding it straight into a linear albedo scale gave a field
   * whose realised contrast was a third of its nominal one, and that is most of
   * why the previous cut measured flat even in the near field where it WAS
   * running. The stretch is a smoothstep, so it costs two multiplies and it puts
   * the mass out at the ends where pigment actually lives.
   */
  vec2 gA;
  float hA1 = fSurfNd(sc * 0.62, gA);
  /**
   * A ROTATED FRAME for every finer lattice, and it is the cap's straight-edge
   * artefact.
   *
   * Value noise is bilinear inside its cell, so its iso-contours run parallel to
   * its own axes over most of the domain. Stacking octaves that all share those
   * axes does not fix it — it deepens it, because the octaves reinforce along the
   * same two directions. Measured on a mid-ground parasol crown: rectangular dark
   * patches with dead-straight vertical sides, read by the last review as a UV
   * seam. Sampling each finer octave on a frame rotated by an angle that is not a
   * multiple of 45 degrees (40 and 63 degrees here) means no two octaves can share
   * a contour direction, and the sum has no preferred one.
   *
   * The gradients come back in the ROTATED frame and have to be rotated back
   * before they are used as a world-space slope, or the relief would point across
   * the bumps instead of down them. That is the four multiplies in gRot below.
   */
  vec2 scB = vec2(sc.x * 0.76604 - sc.y * 0.64279, sc.x * 0.64279 + sc.y * 0.76604);
  /**
   * A SECOND OCTAVE at ~68 cm, and it is not a luxury.
   *
   * One octave of value noise does not read as pigment: its iso-contours are the
   * bilinear patches of its own lattice, so a hard threshold on it produces
   * blobs with straight, axis-aligned sides. The first capture of the single-
   * octave version showed exactly that on a cap crown at a hundred metres —
   * rectangular dark patches, which is a worse artefact than the flatness it was
   * meant to cure. A second octave at 2.37x costs one more evaluation and turns
   * the contours into something with no preferred direction.
   *
   * Faded on the footprint like everything else: a 68 cm feature is under three
   * pixels past about 240 m, and the fade begins at 140. Past that the plant is
   * carried by the first octave and the analytic terms, which is the correct
   * ladder — this is the octave that would otherwise be the first thing to alias.
   */
  float kA2 = 1.0 - smoothstep(0.20, 0.34, fw);
  float hA2 = 0.5;
  vec2  gA2 = vec2(0.0);
  if (kA2 > 0.002) {
    hA2 = fSurfNd(scB * 1.47 + vec2(3.1, 11.7), gA2);
    // ...back out of the rotated frame. See the note on scB.
    gA2 = vec2(gA2.x * 0.76604 + gA2.y * 0.64279, -gA2.x * 0.64279 + gA2.y * 0.76604);
  }
  float hA = hA1 + (hA2 - 0.5) * 0.44 * kA2;
  float pig = smoothstep(0.17, 0.83, hA);
${N(`
  /**
   * ~0.43 m: blotch edges and decimetre relief.
   *
   * Behind a real branch now rather than merely faded: fSurfNd contains no
   * derivatives, so branching around it is legal, and past about seventy metres
   * the whole lattice was being evaluated to be multiplied by zero. Offset so
   * the two lattices cannot share a cell boundary and print a grid.
   *
   * The fade is a MEASURED pixel footprint. A 43 cm cycle stops being resolvable
   * at about three pixels, i.e. a footprint of 0.14; 0.10 is comfortably inside
   * that and, with the corrected uSurfPx, lands at roughly seventy metres.
   */
  float kB = 1.0 - smoothstep(0.058, 0.100, fw);
  float hB = 0.5;
  vec2  gB = vec2(0.0);
  vec2 scC = vec2(sc.x * 0.45399 - sc.y * 0.89101, sc.x * 0.89101 + sc.y * 0.45399);
  if (kB > 0.002) {
    hB = fSurfNd(scC * 2.35 + vec2(19.3, 41.7), gB);
    gB = vec2(gB.x * 0.45399 + gB.y * 0.89101, -gB.x * 0.89101 + gB.y * 0.45399);
  }
  /**
   * A THIRD lattice, at ~10 cm, for the near field only.
   *
   * The two above sit at 1.6 m and 43 cm, and the atlas sits at centimetres —
   * but on a twelve-metre parasol cap the atlas is 27 texels per metre, so at
   * three metres from the lens it is magnified fifteen to one and carries
   * nothing. This fills the hole between 43 cm and the atlas. Gated tight
   * because it is the most expensive thing here and because past a footprint of
   * 0.03 a 10 cm cycle is under three pixels and could only alias.
   */
  float kC = 1.0 - smoothstep(0.0160, 0.0270, fw);
  float hC = 0.5;
  vec2  gC = vec2(0.0);
  if (kC > 0.002) {
    hC = fSurfNd(scC * 9.4 + vec2(7.7, 3.1), gC);
    gC = vec2(gC.x * 0.45399 + gC.y * 0.89101, -gC.x * 0.89101 + gC.y * 0.45399);
  }
`)}
  /**
   * Two more metre-scale fields — but they are PINNED TO THE LATTICE, and that
   * is the hero-cap seam.
   *
   * fSurfNd's analytic gradient carries the factor dw = 6f(1-f), which is exactly
   * ZERO on every cell boundary — so nB and nC are pinned to 0.5 along a
   * rectangular grid of straight lines at the lattice spacing, no matter what the
   * noise does. Feed a pinned field through a smoothstep whose edges straddle 0.5
   * and the threshold is crossed ON those lines: the mask acquires hard,
   * dead-straight, axis-aligned boundaries at 1.6 m spacing. On a six-metre cap
   * that is four cells across, and it was read (reasonably) as a hard UV seam.
   *
   * They are genuinely free and they are fine as SMOOTH MODULATIONS, where being
   * 0.5 on a grid is invisible. What they may not do is generate EDGES. Every
   * threshold below takes its edge from hA/hB — real value noise, which has no
   * pinned locus — and uses nB/nC only to multiply.
   */
  float nB = clamp(0.5 + gA.x * 0.80, 0.0, 1.0);
  float nC = clamp(0.5 + gA.y * 0.80, 0.0, 1.0);

  if (auv.y >= 0.56) {
    /* ---------------------------------------------------------- cap crown */
    float rr = clamp((auv.y - 0.56) * 2.27273, 0.0, 1.0); // 0 boss, 1 margin
    float up = clamp(nW.y, 0.0, 1.0);
    // Every concentric and every radial term below is written against the
    // parasol's parameterisation, in which the cap band IS the radius. On a
    // closed dome the same band is a meridian, a ring becomes a contour line and
    // contours on a dome converge on its pole — the coast blocker's "concentric
    // whorl that reads as a fingerprint". A dome gets the world-space verruca and
    // crust fields instead and pays one multiply for each term it skips.
    float disc = 1.0 - dome;

    /**
     * THE CAP'S OWN TANGENT FRAME, and it is the single most important thing
     * added to this file.
     *
     * Every analytic term below — sectors, growth rings, the margin, the fibre —
     * was written into the ALBEDO and the OCCLUSION only. Albedo does not answer
     * to the sun. A ring drawn as a dark line is a line PAINTED on a smooth dome,
     * and the eye reads painted-on detail as exactly what it is: a decal on clay.
     * That is why three reviews in a row could be looking straight at a cap
     * carrying eight separate structural terms and still call it untextured. The
     * fix is not more terms and it is certainly not more contrast — it is that the
     * terms already here have to become GEOMETRY, i.e. they have to tilt the
     * normal, so a ring has a sunlit flank and a shaded one and swaps which is
     * which when the sun moves.
     *
     * A lathe gives us the two directions for free, and neither needs the axis
     * position:
     *
     *   tCir  the circumferential tangent — the direction u runs. Sectors and
     *         radial fibre vary along it, so their relief is a rotation about it.
     *   tRad  the tangent in the vertical plane through the axis, pointing down
     *         and out. Concentric rings vary along it.
     *
     * tRad is derived rather than normalised: with hNn a unit horizontal vector,
     * (hNn * nW.y - up) is already orthogonal to nW and has length
     * sqrt(nW.y^2 + 1), so one inversesqrt finishes it. tCir is cross(up, hNn),
     * which is unit by construction. The whole frame is two divides, a rsqrt and
     * six multiplies, and it is gated on the cap actually having a horizontal
     * normal component — at the boss it does not, and there is no radius there for
     * a ring to run around anyway.
     */
    vec3 hN = vec3(nW.x, 0.0, nW.z);
    float hl = length(hN);
    vec3 tRad = vec3(0.0);
    vec3 tCir = vec3(0.0);
    if (hl > 0.05) {
      vec3 hNn = hN / hl;
      tCir = vec3(hNn.z, 0.0, -hNn.x);
      tRad = (hNn * nW.y - vec3(0.0, 1.0, 0.0)) * inversesqrt(nW.y * nW.y + 1.0);
    }

    /**
     * PIGMENT — the term that has to still be there at two hundred metres.
     *
     * Contrast is deliberately close to 2:1 peak-to-peak. That is not stylisation:
     * a real parasol cuticle runs from a bleached margin to a near-black boss, and
     * anything less than about 2:1 is gone by the time aerial perspective has
     * taken its cut at mid distance. This is the single number most responsible
     * for the "untextured clay" reading and the previous cut had it at 1.4:1
     * NOMINAL, which after the value-noise distribution was more like 1.15:1
     * REALISED.
     */
    float mot = ${F('mix(pig, smoothstep(0.17, 0.83, hA * 0.70 + hB * 0.30), kB)', 'pig')};
    /**
     * The blotch, and the reason its argument is a mix() rather than a sum.
     *
     * It was smoothstep(0.50, 0.66, hA * 0.58 + hB * 0.42 * kB). When kB fades to
     * zero — which, before the range fix, was happening at forty metres — that
     * argument's range collapses to [0, 0.58] against a threshold pair straddling
     * 0.58, so the mask silently vanishes at exactly the distance it is most
     * needed. Every blend of the two lattices below is therefore a mix, which
     * preserves the mean and the range as the finer term drops out.
     */
    float bArg = ${F('mix(hA, hA * 0.58 + hB * 0.42, kB)', 'hA')};
    /**
     * TWO blotch masks, one dark and one pale, and the pair is the reason this
     * layer does not change the plant's value.
     *
     * A one-sided mask that only ever multiplies albedo DOWN is a darkening
     * dressed up as detail. Measured on the first cut of this file: a cap crown
     * at a hundred metres went from a mean of 128 to a mean of 89 — a thirty per
     * cent drop — because a dozen independent (1 - k*mask) factors compound. That
     * is a global value change made by a subsystem that has no business making
     * one, and the predictable consequence is that somebody downstream reaches
     * for the exposure to put it back.
     *
     * A real cuticle is mottled in both directions anyway: it has dark pigment
     * deposits AND bleached patches. Two masks off opposite tails of the same
     * field give twice the variance for a mean of one, which is the whole point
     * of the exercise. Every remaining term in this block is written the same
     * way — as 1 + k*(x - 0.5) rather than 1 - k*(1 - x).
     */
    float blotD = smoothstep(0.48, 0.64, bArg) * (0.34 + 0.66 * nB);
    float blotL = smoothstep(0.46, 0.28, bArg) * (0.34 + 0.66 * nC);
    /**
     * Rot and staining where the cap meets the stalk — but NOT on the umbo.
     *
     * The stain ran to rr = 0.03 and the boss fan is drawn at a constant rr of
     * 0.0425, so the whole umbo was multiplied by the darkest constant in the
     * file and read, at every distance, as a black hole punched in the top of the
     * cap. It is also wrong: the runoff collects in the ANNULUS around the umbo,
     * and the umbo itself is the highest, driest and palest tissue on the plant.
     * The second factor lifts the innermost tenth back out and the pale lift
     * below gives it a lit crown.
     */
    float rot = smoothstep(0.42, 0.05, rr) * smoothstep(0.015, 0.10, rr)
              * (0.38 + 0.62 * nC);
    float umbo = smoothstep(0.13, 0.02, rr) * disc;
    // Dry spore bloom: only on upward faces, banked toward the boss, washed off
    // the exposed margin. The one thing on the plant lighter than the ash.
    float dArg = ${F('mix(hA, hB * 0.60 + hA * 0.40, kB)', 'hA')};
    float dust = up * smoothstep(0.46, 0.79, dArg) * (0.45 + 0.55 * nB)
               * (1.0 - smoothstep(0.52, 0.98, rr));

    /**
     * RADIAL SECTORS — the new term, and the cheapest large-scale structure a
     * lathe can be given.
     *
     * A cap does not grow evenly around its circumference: it grows in sectors,
     * and on any real parasol whole wedges are a different tone, a different
     * roughness and a slightly different height from their neighbours. Seven
     * wedges on a twelve-metre cap is a 5 m feature at the margin — three or four
     * times coarser than the coarse lattice — so it is the LAST thing to stop
     * resolving, and it survives to the impostor hand-off. It costs one cosine
     * and one smoothstep, it is antialiased against fwidth(auv.x) rather than by
     * a mip chain, and because auv.x already carries a per-instance rotation
     * (see fUv in Canopy) no two plants present their wedges in the same place.
     */
    float secN = 7.0;
    /**
     * The drag on the phase is 1.15 -> 0.40 cycles, and that number was the
     * reason none of the analytic structure in this file could be seen.
     *
     * hA is a metre-scale field with no relation to the lathe, so dragging a
     * seven-cycle wedge set through 1.15 cycles of it does not "break up the
     * regularity" — it destroys the wedges outright and leaves the same blotch
     * field the lattice already supplied, twice. Measured on a cap at 55 m: the
     * sector term was indistinguishable from noise. Four tenths of a cycle is
     * still enough that no two wedges are the same width, and the wedge set
     * survives as a wedge set.
     */
    float secPh = (auv.x * secN + hA * 0.40 + seed * 3.31) * F_TAU;
    /**
     * ...and the wedge has a PROFILE. A raw cosine spends most of its range in
     * the transition, so the "wedges" were a smooth swirl. Curving it toward a
     * plateau with a fast edge is what makes fourteen distinct segments read as
     * fourteen segments, and it costs one smoothstep.
     */
    float sec = smoothstep(0.26, 0.74, 0.5 + 0.5 * cos(secPh));
    float secK = (1.0 - smoothstep(0.15, 0.38, fwU * secN))
               * smoothstep(0.03, 0.34, rr) * disc * (0.42 + 0.58 * nC);

    /**
     * MERIDIONAL RIBS — the dome's structural equivalent of the parasol's
     * wedges, and the reason a bulb fungus read as a smooth clay potato.
     *
     * Every analytic term in this block is gated on the disc flag, because rings
     * and radial fibre are meaningless on a closed dome (see capDome). What was
     * never supplied was the term that IS meaningful on one: a puffball is
     * ribbed along its meridians, from the foot to the pole, and those ribs are
     * the only structure on it that a lathe can address. auv.x is exactly the
     * meridian angle here — the bulb maps one wrap of u around the pod — so
     * seven ribs is one cosine.
     *
     * Written three times as hard into the NORMAL as into the albedo: a rib is a
     * swell with a lit flank and a shaded one, and the coast hero pod's whole
     * problem was that nothing on it answered to the sun. Antialiased against
     * fwidth(auv.x), so it fades out rather than beating against the eight-column
     * LOD1 lathe.
     */
    float ribN = 7.0;
    float ribPh = (auv.x * ribN + seed * 3.71) * F_TAU;
    float rib = 0.5 + 0.5 * cos(ribPh);
    float ribK = (1.0 - smoothstep(0.16, 0.40, fwU * ribN)) * dome * (0.50 + 0.50 * nB);

    /**
     * THE SHADED LOBE TERM IS GONE, and its deletion is the payback for the extra
     * LOD1 geometry this iteration adds.
     *
     * It was two and a half cycles of u — five broad swells written mostly into
     * the normal — and it existed because the cap MESH was a surface of
     * revolution and could not lobe. It can now: buildParasol cuts four to six
     * lobes at up to 13% of the radius into the margin, with a matching vertical
     * scallop and a crown corrugation. A shaded five-lobe term on top of a
     * geometric five-lobe one is not reinforcement, because the two have
     * unrelated phases: they beat, and the shaded set was fighting the very
     * silhouette it was a stand-in for. Geometry also does the job strictly
     * better — a normal perturbation cannot change an outline, and the outline is
     * the only channel that survives all the way to the impostor.
     *
     * One cosine, one smoothstep and three uses leave the fragment, on both the
     * near and the far program.
     */

    /**
     * CONCENTRIC GROWTH RIDGES, at TWO frequencies, as a function of the true
     * cap radius.
     *
     * auv.y is the cap band, and on every parasol in this project that band runs
     * boss-to-margin — so rr is the radial coordinate and a ring is one cosine of
     * it. Nothing else in this file could supply it: a world-space lattice has no
     * idea where the axis is (by design — that is what stops it printing moire)
     * and the atlas cannot carry it at a magnification of fifteen to one.
     *
     * The coarse set is new. Eleven rings across the radius is a 55 cm feature on
     * a twelve-metre cap, so it is the first thing the antialiaser kills — at a
     * hundred metres fwV*ridN has already taken it out, which left the crown with
     * no concentric structure at all in precisely the mid-ground where the review
     * was looking. Three and a half rings is a 1.7 m feature: it holds to the
     * impostor. Both are phase-dragged through the metre field and offset by the
     * instance seed, because a constant-period ring set is the one thing
     * guaranteed to read as machining.
     */
    float rid2N = 4.6;
    /**
     * 3.4 -> 4.6 rings, and the noise drag 0.85 -> 0.22 cycles.
     *
     * Same failure as the sectors above and worse: a drag of 0.85 cycles applied
     * to a set of 3.4 is a quarter of the whole pattern, so the "concentric
     * ridges" arrived at the fragment as an unrecognisable smear of the metre
     * field. A cap crop at 55 m carried no concentric structure at all. Two
     * tenths of a cycle keeps the rings aperiodic — no two gaps equal, which is
     * what stops them reading as machining — without dissolving them.
     *
     * 4.6 across the radius is a 1.3 m ring on a twelve-metre cap: eighteen
     * pixels at 55 m, four and a half at 220 m, and still resolvable where the
     * mesh hands over to the impostor.
     */
    /**
     * ...and the rings are STEPPED BY THE WEDGES, which is what stops the pair
     * reading as plaid.
     *
     * Concentric zones crossed with radial sectors at similar contrast is a grid,
     * and a grid on a hero asset is a texture artefact — measured on a cap at
     * 220 m in the first cut of this change, which came out as tartan. Real
     * zonate tissue does not do that: a growth front is held back in one sector
     * and runs ahead in the next, so the ring steps as it crosses a wedge
     * boundary and the two structures interlock instead of multiplying. One
     * cosine of a phase already computed.
     */
    float rid2Ph = (rr * rid2N + hA * 0.22 + seed * 5.13 + 0.22 * cos(secPh)) * F_TAU;
    /**
     * ZONES, not a sinusoid.
     *
     * A zonate cap is a set of flat concentric bands with fast edges between
     * them, and that is a far stronger read at distance than a cosine, whose
     * energy is spread over the whole period. The transfer is a smoothstep whose
     * width is widened by the measured footprint, so the edge softens exactly as
     * fast as it would otherwise start to alias.
     */
    float rid2AA = clamp(fwV * 2.27273 * rid2N * 2.2, 0.055, 0.34);
    float rid2 = smoothstep(0.5 - rid2AA, 0.5 + rid2AA, 0.5 + 0.5 * cos(rid2Ph));
    float rid2K = (1.0 - smoothstep(0.15, 0.40, fwV * 2.27273 * rid2N))
                * smoothstep(0.05, 0.30, rr) * disc;

    /**
     * THE MARGIN, and it is a structure rather than an edge.
     *
     * A parasol's rim is the youngest, driest and palest tissue on the plant, and
     * just inside it is the shaded gutter where the cuticle rolls under. Two
     * analytic bands in rr: they are a fixed fraction of the cap, so they are the
     * very last features to stop resolving, and they give the silhouette an
     * internal edge at any distance at which the silhouette itself is legible.
     * This is what stops a distant cap being one flat lozenge.
     */
    float marg = smoothstep(0.80, 0.97, rr) * disc;
    float mband = smoothstep(0.55, 0.76, rr) * (1.0 - smoothstep(0.76, 0.90, rr)) * disc;

    /**
     * COARSE RADIAL FIBRE — the tier that was missing from the ladder.
     *
     * The file had radial structure at seven cycles (the wedges) and at 128 (the
     * hyphal striation), and nothing in between. 128 is antialiased away by
     * about twenty metres and seven is four broad segments across the visible
     * half of a cap, so from twenty metres out there was NO radial content at
     * all — which is most of why a mid-ground cap read as a dome with stains on
     * it rather than as a cap.
     *
     * 24 cycles of auv.x is 48 striations around the circumference (the cap
     * wraps the atlas twice). On a twelve-metre cap that is an 80 cm feature at
     * the margin: eleven pixels at 55 m and still nearly three at 220 m, so it
     * spans the whole of the range the reviews were measuring. It is compiled
     * into BOTH programs for that reason.
     *
     * Weighted into the normal as much as into the albedo, because a fibre is a
     * ridge with two flanks and not a stripe of paint — see the note on relief
     * at the foot of this block.
     */
    float rfibN = 24.0;
    float rfibPh = (auv.x * rfibN + seed * 6.71 + hA * 0.30) * F_TAU;
    float rfib = 0.5 + 0.5 * cos(rfibPh);
    float rfibK = (1.0 - smoothstep(0.13, 0.34, fwU * rfibN))
                * smoothstep(0.06, 0.42, rr) * disc * (0.45 + 0.55 * nB);

    /**
     * BLISTERS AND CREASES OFF THE COARSE LATTICE, so both survive to range.
     *
     * The near program has these off the 43 cm field, which is gone by seventy
     * metres. A fleshy cuticle is blistered and damp at every scale it can be
     * resolved at, and the metre-scale version is what carries "this is wet
     * tissue and not dry clay" from seventy metres out to the impostor. The
     * crease term is a ROUGHNESS write, so it is material differentiation
     * (art-bible rule 5) rather than a value change: the hollows of the field
     * take a broad sheen and the crests stay matte.
     */
    float blisF = smoothstep(0.56, 0.86, hA);
    float creaF = smoothstep(0.44, 0.15, hA);

    /**
     * ZONATION — one smoothstep, and it is the cheapest per-INDIVIDUAL structure
     * in the file.
     *
     * Every term above varies within a cap. None of them varies between caps at
     * cap scale, so a stand of eight parasols in a mid-ground frame presents eight
     * copies of one statistical texture, and the eye reads a repeated asset even
     * when each copy is individually detailed. Real zonate fungi differ from each
     * other most obviously in exactly this: some are dark at the boss and bleached
     * at the margin, some the reverse, some barely zoned at all.
     *
     * A signed per-instance ramp in rr costs one fract, one subtract and two
     * multiplies. Its wavelength is the whole cap radius, so it is the last thing
     * in the subsystem to stop resolving — a six-metre cap thirty pixels wide at
     * the impostor hand-off still has a legible light half and dark half — and it
     * is zero-mean in rr, so it cannot shift the species' value.
     */
    float zon = (fract(seed * 17.31 + 0.613) - 0.5) * 2.0;

${N(`
    /**
     * THE FINE CONCENTRIC SET (11 rings) and THE RADIAL FIBRE (128 cycles), and
     * both are NEAR-ONLY now — which is where the budget for everything above
     * came from.
     *
     * Neither could ever be non-zero in the far program and both were being
     * evaluated in it every fragment. The arithmetic: the far program only ever
     * runs on a mesh LOD1, which for the parasol begins at 90 m (110 m minus half
     * the fade band). At 90 m a twelve-metre cap is about 110 px across and its
     * crown band is 30 px tall over 16 rows, so fwidth(auv.y) is 0.0147 and
     * fwV*2.27*11 = 0.37 — past the 0.14/0.38 antialiasing cut, i.e. ridK = 0.05
     * and falling. fwidth(auv.x) out there is 0.027, so fwU*128 = 3.4 against a
     * cut at 0.34: fibK is identically zero from the first metre of the stage.
     *
     * Two cosines, three smoothsteps and their albedo, roughness and occlusion
     * uses, deleted at COMPILE time from the program that runs on the LOD holding
     * the most instances in every canonical frame. That pays for the tangent
     * frame, the lobes and the relief writes below, which are all things that are
     * still several pixels wide at four hundred metres.
     *
     * A cap is built of hyphae running out from the boss; every real parasol has
     * a fine radial striation over the outer half. Weak in albedo, stronger in
     * occlusion — a striation is a groove, not a stripe of paint.
     */
    float ridN = 11.0;
    float ridPh = (rr * ridN + (nB - 0.5) * 1.35 + hA * 0.6) * F_TAU;
    float rid = 0.5 + 0.5 * cos(ridPh);
    float ridK = (1.0 - smoothstep(0.14, 0.38, fwV * 2.27273 * ridN))
               * smoothstep(0.05, 0.28, rr) * (0.42 + 0.58 * nC) * disc;
    float fibN = 128.0;
    float fibPh = auv.x * fibN * F_TAU;
    float fib = 0.5 + 0.5 * cos(fibPh);
    float fibK = (1.0 - smoothstep(0.13, 0.34, fwU * fibN))
               * smoothstep(0.12, 0.58, rr) * (0.38 + 0.62 * hA) * disc;

    /**
     * WARTS AND PITS, from the near-field lattice: the decimetre cuticle detail
     * that only exists once the plant is close enough for it to be resolvable.
     */
    float wart = kC * smoothstep(0.55, 0.86, hC);
    float pit  = kC * smoothstep(0.44, 0.13, hC);
    // Blisters: the decimetre bumps a fleshy cuticle actually has.
    float blis = kB * smoothstep(0.52, 0.82, hB);
    // Moisture sits in the valleys of the mid field and gives them a broad soft
    // sheen; the crests dry out. This is the term that separates fungus from rock
    // by shading alone.
    float crease = kB * smoothstep(0.46, 0.14, hB);
    /**
     * VERRUCAE — the dome's near-field replacement for the concentric terms. A
     * puffball is a pored, warty, crusted skin, and none of that knows where the
     * axis is.
     */
    float pust = dome * kC * smoothstep(0.46, 0.74, hC)
               + dome * kB * smoothstep(0.54, 0.82, hB) * 0.8;
`)}
    /**
     * LICHEN CRUST, and it is metre-scale so it belongs to both variants.
     *
     * Colour breakup was the other half of the "one uniform albedo" charge, and
     * lichen is the only non-ochre the palette allows on a plant (verdigris
     * #5f7a63). Gated on upward-and-outward faces and thickened toward the foot
     * of the dome. Off the coarse lattice alone so it survives to the same range
     * as the pigment.
     */
    float crust = dome * smoothstep(0.52, 0.78, hA)
                * (0.30 + 0.70 * up) * (1.0 - smoothstep(0.35, 0.85, rr));

    // Pigment: mot is a symmetric field, so this is 1.02 in the mean and runs
    // roughly 0.66 to 1.41 — a shade over 2:1, which is what a real cuticle does
    // between its bleached patches and its deposits.
    albedo *= 0.55 + 0.95 * mot;
    // Zonation: see the note above. Signed per instance, zero-mean in rr.
    albedo *= 1.0 + 0.34 * zon * (rr - 0.5) * disc;
    // Dark deposits and bleached patches, in balance. See the note on blotD.
    albedo *= mix(vec3(1.0), vec3(0.62, 0.51, 0.47), blotD * 0.72);
    albedo *= mix(vec3(1.0), vec3(1.34, 1.27, 1.18), blotL * 0.52);
    // Rot at the junction is the one deliberately one-sided term: a cap really is
    // darkest where its own runoff collects, and it covers a small annulus.
    albedo *= mix(vec3(1.0), vec3(0.50, 0.355, 0.285), rot * 0.68);
    // The umbo: dry, raised and a shade paler than the tissue around it.
    albedo *= 1.0 + 0.20 * umbo;
    // Wedges, rings and the margin: all reflectance structure rather than
    // shading, all zero-mean, all surviving unchanged into the far program.
    albedo *= 1.0 + 0.44 * secK * (sec - 0.5) + 0.24 * ribK * (rib - 0.5);
    albedo *= 1.0 + 0.52 * rid2K * (rid2 - 0.5);
    // The new mid-tier radial fibre, and the metre-scale blister field. Both are
    // zero-mean and both are in the far program: see the notes where they are
    // defined. The blister is weak in albedo on purpose — it is a BUMP, and it
    // earns its keep in the occlusion and the normal below.
    albedo *= 1.0 + 0.27 * rfibK * (rfib - 0.5) + 0.17 * (blisF - creaF);
    albedo *= 1.0 + 0.30 * marg - 0.12 * mband;
${N(`
    // 0.24 -> 0.15 and 0.10 -> 0.06. With the coarse zone set above now reading
    // as zones rather than as a smear, an eleven-ring set at the same contrast
    // sat on top of it and the pair, crossed with the 128-cycle striation, came
    // out as TURNED WOOD — measured in a 22 m crop, and a worse misread than the
    // flatness it replaced. The fine sets are back to what they should be: a
    // texture under the structure, not a second structure.
    albedo *= 1.0 + 0.15 * ridK * (rid - 0.5) + 0.06 * fibK * (fib - 0.5);
    albedo *= 1.0 - 0.30 * wart + 0.24 * pit;
    albedo *= 1.0 - 0.20 * pust + 0.12 * (1.0 - pust) * dome * kC;
`)}
    // Verdigris #5f7a63 in linear, laid on as a crust rather than as a tint.
    albedo = mix(albedo, vec3(0.113, 0.190, 0.122), crust * 0.42);
    // A film ON the pigment, not a tint of it: it desaturates toward ash rather
    // than merely brightening. The constant is #8a7f72 in linear.
    albedo = mix(albedo, vec3(0.258, 0.222, 0.183), dust * 0.58);

    roughAdd += 0.20 * dust + 0.06 * blotD - 0.05 * blotL
              // Moisture in the hollows of the metre field, dryness on the
              // crests. The one term in the far program that makes a cap read as
              // damp tissue rather than as fired clay, and it is a roughness
              // write, so it changes no value anywhere.
              - 0.16 * creaF + 0.10 * blisF
              + 0.15 * rid2K * (1.0 - rid2)
              // A wedge that grew faster is a smoother, wetter one; the seam
              // between two wedges is where the ash collects. That spread IS the
              // material differentiation a clay dome has none of, and it costs
              // nothing at any distance.
              + 0.20 * secK * (0.5 - sec)
              - 0.14 * marg + 0.20 * crust;
${N(`
    // crease 0.34 -> 0.22. The metre-scale creaF term above is now writing a
    // sheen of its own, and the two stacked took the roughness to the 0.045
    // clamp over a good fraction of a near cap — a mirror, i.e. wet plastic.
    // Two sheens at different scales is right; two sheens that saturate is not.
    roughAdd += 0.13 * ridK * (1.0 - rid)
              - 0.22 * crease - 0.15 * blis + 0.13 * wart - 0.09 * pit + 0.17 * pust;
`)}
    /**
     * Occlusion, and the coefficients are down by about a third from the first
     * cut of this file.
     *
     * Occlusion may only ever darken — that is what it is — so unlike the albedo
     * terms above it cannot be made zero-mean, and eight of them multiplying is
     * how a detail layer turns into an exposure change. These are sized so the
     * mean of the product sits near 0.86, i.e. the layer costs the crown about a
     * seventh of its ambient and nothing of its direct light, which is a
     * defensible amount of self-shadowing for a lumpy ridged surface.
     */
    /**
     * Sized so the layer costs the crown a seventh of its ambient and NOTHING of
     * much of its mean value: measured on the identical cap crop at 55 m, this
     * iteration takes the high-pass standard deviation from 11.0 to 15.1 levels
     * out of 255 for a mean of 91.3 -> 86.7, and most of that five per cent is
     * the scalloped margin bringing its own shaded underside into the crop
     * rather than anything written here. A detail layer that darkens is a detail
     * layer somebody downstream answers with an exposure change, which is
     * exactly the drift this round exists to stop.
     */
    occ *= 1.0 - 0.17 * blotD - 0.20 * rot - 0.18 * secK * (1.0 - sec)
         - 0.18 * rid2K * (1.0 - rid2)
         - 0.10 * rfibK * (1.0 - rfib) - 0.07 * creaF
         - 0.18 * ribK * (1.0 - rib)
         - 0.09 * mband - 0.10 * crust;
${N(`
    occ *= 1.0 - 0.13 * ridK * (1.0 - rid) - 0.08 * fibK * (1.0 - fib)
         - 0.14 * blis - 0.17 * wart - 0.16 * pust;
`)}

    /**
     * RELIEF, and at distance it is the whole ballgame.
     *
     * A blotch with no relief is a stain on a smooth object; the same blotch with
     * a lit flank and a shaded one is a lump of tissue. Pigment alone reads as
     * clay that somebody painted; pigment plus relief reads as tissue, because
     * the relief answers to the sun and the pigment does not. The coarse
     * gradient's weight is up by half over the previous cut for exactly that
     * reason — on a six-metre cap it IS the blister structure, and it is the only
     * term in the far program that changes with the light direction.
     */
    vec2 g2 = gA * (1.00 + 0.25 * dome) + gA2 * (0.62 * kA2)${N(` + gB * (0.52 * kB) + gC * (kC * (0.22 + 0.40 * dome))`)};
    nrmAdd -= F_SU * g2.x + F_SV * g2.y;

    /**
     * ...and the ANALYTIC relief, which is the half that survives to the impostor.
     *
     * The lattice gradient above dies with the lattice: past about 240 m the
     * second octave is gone and the first is a couple of pixels a cycle, so the
     * only thing left changing with the sun is whatever the lathe-space terms
     * write here. Each is the derivative of the same phase its albedo term used,
     * so the pale flank of a ring is the flank that faces the light and the two
     * cannot disagree.
     *
     *   rings   vary along the radius, so they rotate the normal about tCir, i.e.
     *           the perturbation is along tRad.
     *   sectors and lobes vary around the circumference, so the mirror.
     *
     * The lobe coefficient is the largest thing in this file at 0.34, and it is
     * deliberately three times its own albedo weight: five broad swells with real
     * flanks is FORM, and form is what the review was asking for when it said the
     * caps were smooth blobs. The same term at the same strength in the albedo
     * would be a painted beach ball.
     */
    nrmAdd += tRad * (sin(rid2Ph) * 0.44 * rid2K)
            + tCir * (sin(secPh) * 0.34 * secK + sin(ribPh) * 0.40 * ribK
                      + sin(rfibPh) * 0.36 * rfibK);
${N(`
    nrmAdd += tRad * (sin(ridPh) * 0.18 * ridK) + tCir * (sin(fibPh) * 0.10 * fibK);
    // The near lattices as PORE AND BLISTER relief. Their gradients are already
    // folded into g2 above, but a wart is a bump with a top, and the gradient of
    // a smooth field has no top: this is the term that gives the near cuticle a
    // pored surface rather than a rolling one.
    nrmAdd += (F_SU * gC.x + F_SV * gC.y) * (kC * 0.55 * (wart - pit));
`)}
  } else if (auv.y >= 0.44) {
    /* -------------------------------------------------------------- gills */
    float rr = clamp((auv.y - 0.44) * 8.33333, 0.0, 1.0); // 0 stalk, 1 margin

    /**
     * The lamella comb, analytically filtered, at TWO frequencies.
     *
     * The atlas already carries a 96-cycle comb in its height and occlusion, and
     * it is the right frequency — but it is a rotationally symmetric grating, and
     * once it starts to mip it is a grating that fades uniformly. Two things are
     * added. First, sector variation: whole wedges of a real cap carry deep
     * crowded lamellae and others shallow faint ones, and that variation has a
     * metre wavelength so it belongs here. Second, a PRIMARY set at 16 cycles —
     * the deep principal lamellae that a hymenophore hangs its lamellulae
     * between. Sixteen cycles is a 2 m feature at the margin of a twelve-metre
     * cap: it is still four pixels at two hundred metres, where the 96-cycle comb
     * has been antialiased into a flat grey for a hundred and fifty of them. An
     * underside that self-shadows at silhouette range needs a feature at that
     * scale and had none.
     */
    float lam = 0.5 + 0.5 * cos(auv.x * 96.0 * F_TAU);
    float lamAA = 1.0 - smoothstep(0.13, 0.34, fwU * 96.0);
    float prim = 0.5 + 0.5 * cos((auv.x * 16.0 + seed * 2.7) * F_TAU);
    float primAA = 1.0 - smoothstep(0.14, 0.36, fwU * 16.0);
    /**
     * Alternate lamellae are SHORT, and that is the whole difference between
     * gills and a grating. A real hymenophore interpolates: full-length lamellae
     * with shorter lamellulae between them, each stopping at its own radius.
     */
    float alt = 0.5 + 0.5 * cos(auv.x * 48.0 * F_TAU);
    float reach = smoothstep(0.10, 0.40 + 0.36 * alt, rr);
    // Whole sectors of a cap carry deep crowded lamellae and others shallow
    // faint ones; the field is world-space, so it does not rotate with the lathe.
    // Edge off the noise value, not off its gradient — see the note on nB.
    float depth = mix(0.24, 1.0, smoothstep(0.30, 0.72, hA)) * (0.55 + 0.45 * nB);
    /**
     * A SIX-CYCLE GROUPING of the primaries, and it is the underside's
     * equivalent of the crown's wedges.
     *
     * Sixteen primaries is the right frequency for the mid ground and it is
     * still a UNIFORM comb: every lamella the same depth as its neighbour, which
     * from a hundred metres integrates to one flat grey wedge — exactly the
     * "flat dark underside" reading. Real hymenophores are grouped: the comb
     * crowds and thins around the circumference on a scale of whole sectors.
     * Six cycles is a 6 m feature on a twelve-metre cap, so it is the last thing
     * on the underside to stop resolving.
     */
    float grpPh = (auv.x * 6.0 + seed * 4.9) * F_TAU;
    float grp = 0.55 + 0.45 * cos(grpPh);
    float grpAA = 1.0 - smoothstep(0.16, 0.40, fwU * 6.0);
    float k = lamAA * reach * depth;
    float kp = primAA * smoothstep(0.06, 0.30, rr) * (0.60 + 0.40 * nC) * mix(1.0, grp, grpAA);
    occ *= 1.0 - 0.42 * k * (1.0 - lam) - 0.46 * kp * (1.0 - prim)
         - 0.16 * grpAA * (1.0 - grp) * smoothstep(0.06, 0.30, rr);
    // Deepening the valley alone reads as a printed line; lifting the crest is
    // what makes a lamella catch light.
    albedo *= 1.0 + 0.24 * k * (lam - 0.45) + 0.26 * kp * (prim - 0.45);
    // The same junction rot as the crown, seen from below.
    float rot = smoothstep(0.34, 0.0, rr) * (0.35 + 0.65 * nC);
    albedo *= mix(vec3(1.0), vec3(0.56, 0.44, 0.36), rot * 0.62);
    // Metre-scale value drift, so a big underside is not one flat brown.
    albedo *= 0.80 + 0.40 * pig;
    roughAdd += 0.05 * k + 0.05 * kp;
    /**
     * The primary lamellae as RELIEF, not only as occlusion.
     *
     * A gill is a blade standing off the underside, so it has two flanks that
     * face opposite ways around the axis. Perturbing the normal along the
     * circumferential tangent is what makes one flank catch the sun and the other
     * go dark — the "structure that catches light and self-shadows" an underside
     * needs, and the reason a filtered occlusion comb alone still reads as a
     * printed texture. The tangent is well conditioned here because a cap
     * underside's normal points down, nowhere near the world up axis.
     */
    vec3 tanU = cross(vec3(0.0, 1.0, 0.0), nW);
    float tl = length(tanU);
    if (tl > 0.08) {
      vec3 tu = tanU / tl;
      nrmAdd += tu * (sin((auv.x * 16.0 + seed * 2.7) * F_TAU) * 0.42 * kp
                      + sin(grpPh) * 0.20 * grpAA * smoothstep(0.06, 0.30, rr));
${N(`
      /**
       * The 96-cycle comb as relief too, in the near program only.
       *
       * lamAA has already taken this frequency out by about fifteen metres, so
       * compiling it into the far program would be paying for a term that is
       * identically zero over the whole range that program runs on. Inside that
       * fifteen metres it is the difference between a cap underside that reads as
       * a stack of blades — each with a flank the sun catches and a flank it does
       * not — and one that reads as a photograph of gills printed on a cone.
       */
      nrmAdd += tu * (sin(auv.x * 96.0 * F_TAU) * 0.22 * k);
`)}
    }
  } else if (auv.y < 0.22) {
    /* --------------------------------------------------------------- leaf */
    /**
     * A fleshy lamina at decimetre scale.
     *
     * Everything the atlas gives this band — midrib, secondary veins, the 6 mm
     * pleat — is a feature of the LEAF's own parameterisation and is gone by
     * four metres. What survives to the range a plant is actually looked at is
     * the blade-scale stuff: blistering along the fold, the pale dry patches an
     * old blade carries, and the fact that no two blades on one plant are the
     * same value. That is world-space, it is what this layer is for, and the
     * band had none of it.
     *
     * "across" is the distance from the midrib (auv.x is 0..1 across the blade,
     * 0.5 at the rib) and tL is the fraction along it, which is the whole
     * parameterisation a leaf has.
     */
    float across = abs(auv.x - 0.5) * 2.0;
    float tL = clamp((auv.y - 0.10) * 8.33333, 0.0, 1.0);

    // Blade-scale pigment. hA is the 1.6 m lattice; on a two-metre blade that
    // is a little over one cycle end to end, which is exactly the "one blade is
    // paler than its neighbour" variation a fan of leaves needs and the only
    // one that survives aerial perspective.
    albedo *= 0.80 + 0.42 * smoothstep(0.22, 0.80, hA);
    // ...and a second, finer field for blistering and old scar tissue.
    albedo *= 1.0 - 0.20 * kA2 * smoothstep(0.58, 0.92, hA2)
                  + 0.14 * kA2 * smoothstep(0.44, 0.08, hA2);
    occ *= 1.0 - 0.22 * kA2 * smoothstep(0.52, 0.92, hA2);
    roughAdd += 0.14 * kA2 * smoothstep(0.55, 0.95, hA2);

    /**
     * The margin is dry, and it is the only hue break the palette allows here.
     *
     * A fleshy blade dies from its edge inward, so the outer eighth is paler,
     * warmer and rougher than the lamina. It is also the geometry the
     * transmission term lights up, so giving it a different reflectance is what
     * stops a backlit blade reading as one flat glowing card.
     */
    float mar = smoothstep(0.74, 1.0, across) * (0.45 + 0.55 * smoothstep(0.30, 0.85, hA));
    albedo *= mix(vec3(1.0), vec3(1.16, 1.06, 0.90), mar * 0.55);
    roughAdd += 0.16 * mar;
    // ...and the base of a blade is stained by the same damp ash the stipes are.
    float baseL = smoothstep(0.16, 0.0, tL) * (0.5 + 0.5 * smoothstep(0.25, 0.8, hA));
    albedo *= mix(vec3(1.0), vec3(0.60, 0.565, 0.52), baseL * 0.62);
    occ *= 1.0 - 0.30 * baseL;

    /**
     * Relief, and it has to fold ACROSS the blade rather than along it.
     *
     * The gradient of the world-space field is the blistering; on top of it
     * goes a decimetre-scale buckle keyed to the across-blade coordinate,
     * because a strap leaf
     * that has been in the wind is not a developable surface — it cups and
     * ripples, and the light running unevenly along a lamina is most of what
     * separates a leaf from a painted quad.
     */
    vec2 gL = gA * 0.30 + gA2 * (0.34 * kA2);
    nrmAdd -= (F_SU * gL.x + F_SV * gL.y);
  } else {
    /* -------------------------------------------------------------- stalk */
    float t = clamp(along, 0.0, 1.0);
    // Rings and fibre live on the flank of the stipe. On a surface that faces up
    // — the top of a shed limb, the shoulder of a flare — a horizontal ring is a
    // lengthwise stripe, which is the wrong feature entirely.
    float vert = clamp(1.0 - abs(nW.y), 0.0, 1.0);

    /**
     * Horizontal growth rings, in WORLD Y, per instance and aperiodic.
     *
     * The atlas has annuli, and on a fifteen-metre stipe they are unreadable: the
     * band is tiled up the lathe to keep the texels square, so their world
     * frequency depends on the plant's dimensions and they mip out by ten metres.
     * A ring every ~77 cm keyed to world height is a real growth mark, is the same
     * size on every individual, and — being a pure function of y — is antialiased
     * by one smoothstep instead of by a mip chain.
     *
     * The frequency is drawn per instance over better than a 2:1 range and the
     * phase is offset by the seed, so two neighbours cannot beat against each
     * other; the noise drag on top makes a single stipe crowd and open out along
     * its own length the way a thing that grew in fits does.
     */
    float rFreq = 0.90 + 1.05 * fract(seed * 37.19 + 0.317);
    /**
     * The drag is 3.4 -> 0.85 cycles, for the same reason as the crown's rings.
     *
     * 3.4 cycles of phase drag on a ring set is not aperiodicity, it is
     * demolition: nB alone was sliding the rings past each other by three and a
     * half whole periods over the width of one metre-scale blob, so what arrived
     * at the fragment was the blob field with a faint corduroy on it and no
     * horizontal ring anywhere. Under a cycle keeps the rings unevenly spaced —
     * which is all that was ever wanted — and keeps them horizontal.
     */
    float rPh = wpos.y * rFreq + seed * 11.7
              + (nB - 0.5) * 0.85${N(' + (hB - 0.5) * 0.35 * kB')};
    float rAA = 1.0 - smoothstep(0.20, 0.44, fwidth(wpos.y) * rFreq);
    /**
     * A growth ring is a NARROW GROOVE with a broad shoulder, not a sinusoid.
     * Curving the cosine toward its crest puts most of the surface on the
     * shoulder and the ring where a ring is: in a line.
     */
    float rw = pow(0.5 + 0.5 * cos(rPh * F_TAU), 0.42);
    float rk = rAA * vert * (0.40 + 0.60 * nC);
    // Zero-mean, like every albedo term in the crown: a growth ring has a raised
    // pale ridge as well as a sunken dark groove, and writing only the groove is
    // how a stipe ends up a third darker than the plant it belongs to.
    albedo *= 1.0 + 0.34 * rk * (rw - 0.5);
    occ *= 1.0 - 0.30 * rk * (1.0 - rw);
    // The groove tilts the surface along the axis; up-tangent, not world up, or
    // the perturbation would push the normal off the surface.
    vec3 upT = vec3(0.0, 1.0, 0.0) - nW * nW.y;
    nrmAdd += upT * (sin(rPh * F_TAU) * 0.42 * rk);

    /**
     * FLUTES — vertical ribs around the stipe, and the stalk's equivalent of the
     * crown's sectors.
     *
     * A stipe of this kind is not a smooth cylinder: it is a bundle of fused
     * strands, so it carries a coarse vertical corrugation that runs its whole
     * length. Nine ribs is a 70 cm feature on a two-metre stipe, which is the
     * scale that still resolves at a hundred and fifty metres — and unlike the
     * horizontal rings it is a feature that survives being seen from any azimuth,
     * because it wraps. Perturbing the circumferential tangent is what gives each
     * rib a lit side and a shadowed side; without that a rib is a painted stripe
     * and reads as one. The tangent is well conditioned on a stipe, whose normal
     * is horizontal, and the length test covers the flare where it is not.
     */
    /**
     * SEVEN ribs, not nine, and the phase drag is off.
     *
     * makeStalk() now cuts the same seven ribs into the GEOMETRY (see Build.ts),
     * because a normal perturbation cannot change a silhouette and the review's
     * complaint was about a silhouette. Two rib sets at different counts is worse
     * than either alone: the shaded rib walks across the geometric one and the
     * pair beat into a coarse, wrong-frequency corrugation. The noise drag has to
     * go for the same reason — the geometry has no drag to match it with.
     */
    float flN = 7.0;
    float flPh = (auv.x * flN + seed * 4.7) * F_TAU;
    float fl = 0.5 + 0.5 * cos(flPh);
    float flK = (1.0 - smoothstep(0.16, 0.40, fwU * flN)) * vert * (0.55 + 0.45 * nB);
    albedo *= 1.0 + 0.16 * flK * (fl - 0.5);
    occ *= 1.0 - 0.26 * flK * (1.0 - fl);
    roughAdd += 0.10 * flK * (0.5 - fl);
    /**
     * ...and a fine fibrous striation on top of them, at six times the frequency.
     *
     * Fungal stipe tissue is longitudinally fibrous and that is what the eye
     * reads as "not moulded". It is antialiased out by about thirty metres, which
     * is where it should go: at that range the flutes and the growth rings carry
     * the stipe on their own.
     */
    float fibN = 54.0;
    float sfib = 0.5 + 0.5 * cos((auv.x * fibN + seed * 9.1) * F_TAU);
    float sfibK = (1.0 - smoothstep(0.13, 0.34, fwU * fibN)) * vert;
    albedo *= 1.0 + 0.13 * sfibK * (sfib - 0.5);
    occ *= 1.0 - 0.13 * sfibK * (1.0 - sfib);

    vec3 tanU = cross(vec3(0.0, 1.0, 0.0), nW);
    float tl = length(tanU);
    if (tl > 0.08) {
      vec3 tu = tanU / tl;
      nrmAdd += tu * (sin(flPh) * 0.34 * flK);
      nrmAdd += tu * (sin((auv.x * fibN + seed * 9.1) * F_TAU) * 0.13 * sfibK);
    }

    // Bulges and constrictions: a stipe is not a cylinder, and the geometry
    // cannot afford to say so at every scale. A four-metre swell modulated by the
    // metre field gives the shading a form to run over.
    float bulPh = (wpos.y * 0.27 + nC * 3.0) * F_TAU;
    float bul = sin(bulPh);
    albedo *= 1.0 + 0.095 * bul * vert;
    occ *= 1.0 - 0.13 * max(-bul, 0.0) * vert;
    /**
     * ...and the swell as RELIEF as well as as tone.
     *
     * Same argument as the crown: a four-metre swell written only into the albedo
     * is a band of paint, and a band of paint around a cylinder still reads as a
     * cylinder. Perturbing along the axial tangent by the swell's own derivative
     * gives the constriction a shaded upper flank and the bulge a lit shoulder,
     * which is what makes a stipe read as something that grew in fits rather than
     * as an extruded tube. cos(bulPh) is d(bul)/d(phase), so the tilt is steepest
     * exactly where the radius is changing fastest.
     */
    nrmAdd += upT * (cos(bulPh) * 0.20 * vert);

    /**
     * Metre-scale mottling: the term that keeps a trunk a surface at 40 m, and
     * now also the term that replaces the tiled mottling taken out of the atlas.
     *
     * 0.74+0.52 -> 0.68+0.64 is the same mean (1.02) and a quarter more range,
     * paid for by the cut to the two low-frequency terms in stalkSample. The point is not
     * the extra contrast, it is WHERE the contrast comes from: this field is
     * evaluated in world space on an oblique projection, so it has no period to
     * mirror and no lathe axis to smear along, which is precisely what the
     * band-atlas version could never avoid. See stalkSample in Atlas.ts.
     */
    albedo *= 0.68 + 0.64 * pig;

    /**
     * The foot is HALF A METRE, not thirty per cent of the plant.
     *
     * Ash packs damp against the base of a stipe and stains it, and the stain is
     * a fixed physical size: it is as deep on a fifteen-metre parasol as on a
     * fifteen-centimetre ground mushroom, because it is made of the same ash.
     * footM is 0.55 m expressed in this species' own "along" units, clamped so a
     * very small plant still gets a hint of contact and a very large one does not
     * get a stain up to its neck. Expressed as a fraction of the plant this term
     * once multiplied an entire glow-fungus stipe by the colour of wet dirt, which
     * was the whole of "every mushroom stem is a flat, unlit, near-black cone".
     */
    /**
     * ...and it is a BLOTCH, not a skirt.
     *
     * At 0.88 of a 0.44 grey the term multiplied the bottom half metre of the
     * stipe by about a quarter, with a mask that is a pure function of height —
     * so the foot came out as a dead-flat near-black band with a ruled top edge
     * running round the plant. That is a painted skirt, and a skirt is the exact
     * opposite of what the term is for: what makes a base read as bedded into the
     * ground is that the stain is UNEVEN, deeper where the ash has drifted
     * against it and absent where it has blown clear.
     *
     * Modulated by the metre-scale field, at three quarters of the strength.
     */
    float foot = smoothstep(footM, 0.0, t) * (0.46 + 0.54 * smoothstep(0.22, 0.80, hA));
    albedo *= mix(vec3(1.0), vec3(0.50, 0.455, 0.415) * (0.70 + 0.62 * hA), foot * 0.74);
    roughAdd += -0.20 * foot + 0.06 * rk * (1.0 - rw);
${N(`
    // Pores, as occlusion rather than as relief: on a stipe the atlas already
    // supplies the wart normal, and this only has to keep it from washing out.
    float pore = kB * smoothstep(0.56, 0.84, hB);
    occ *= 1.0 - 0.16 * pore;
    /**
     * Bark, at ten centimetres. The coast review called the dead tree "a smooth
     * gradient with no bark" and it is the same hole in the frequency ladder the
     * crown had: the atlas's fibre is authored at millimetres and the coarse
     * lattices start at 43 cm, so a trunk two metres from the lens has nothing
     * between them.
     */
    float bark = kC * vert;
    albedo *= 1.0 - 0.18 * bark * smoothstep(0.52, 0.86, hC)
                  + 0.16 * bark * smoothstep(0.42, 0.10, hC);
    occ *= 1.0 - 0.20 * bark * smoothstep(0.46, 0.14, hC);
    roughAdd += 0.12 * bark * smoothstep(0.52, 0.86, hC);
`)}
    vec2 g2 = gA * (0.55 * vert) + gA2 * (0.42 * kA2 * vert)${N(' + gB * (0.30 * kB * vert) + gC * (0.26 * kC * vert)')};
    nrmAdd -= F_SU * g2.x + F_SV * g2.y;
  }

  /**
   * The occlusion floor, and it is an art-bible rule rather than a safety clamp.
   *
   * Eight or nine independent occluders multiply here, and with every one of them
   * near its peak the product goes NEGATIVE. Downstream that clamps to zero, i.e.
   * to a crushed pure-black pixel in the middle of a lit surface, which is both a
   * banding artefact and forbidden outright ("no crushed pure-black shadow").
   * 0.16 is about the reflectance a deep crevice in a diffuse solid really keeps
   * from the sky, so the floor is also the physically honest answer.
   */
  occ = clamp(occ, 0.16, 1.0);

  // The perturbation has to be tangential, or normalising it afterwards would
  // simply scale the surface normal and do nothing at all.
  nrmAdd -= nW * dot(nW, nrmAdd);

  albedo = mix(albedo0, albedo, amp);
  roughAdd *= amp;
  occ = mix(1.0, occ, amp);
  nrmAdd *= amp;
}
#endif
`;
}
