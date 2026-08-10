import * as THREE from 'three';
import { clamp01, fbm2, fbmWrapX, hash2I, lerp, smoothstep, valueWrapX } from './Noise';

/**
 * One PBR set for the whole of flora, laid out as horizontal bands.
 *
 * Every band is full-width and tileable in u, because u is *always* an angle
 * around a lathe (stalk, cap, gills) or a normalised width (leaf, blade). One
 * atlas means one material and one draw call per species/LOD instead of one per
 * surface type, which is the difference between 30 draw calls of vegetation and
 * 200.
 *
 * The ARM texture repurposes its blue channel: nothing in flora is metallic, so
 * b carries the BIOLUMINESCENCE MASK instead of metalness, and a carries
 * translucency for the subsurface term. Both are fetched manually by the flora
 * shaders — they never go through three's metalnessMap/aoMap plumbing.
 */
export const BAND = {
  /** Ground cover: grass blade / lichen frond. */
  blade: [0.0, 0.1] as const,
  /** Broad fleshy leaf: marshmerrow, ash yam foliage, kelp. */
  leaf: [0.1, 0.22] as const,
  /** Stalk / trama root bark. */
  stalk: [0.22, 0.44] as const,
  /** Cap underside, gill structure. */
  gill: [0.44, 0.56] as const,
  /** Cap upper surface, centre at the bottom of the band, rim at the top. */
  cap: [0.56, 1.0] as const,
};

/** Map a band-local v in [0,1] into atlas v. */
export function bandV(band: readonly [number, number], t: number): number {
  return band[0] + (band[1] - band[0]) * t;
}

export interface FloraAtlas {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  arm: THREE.Texture;
  dispose(): void;
}

const SIZE = 1024;

/** sRGB byte from a 0..1 value already in sRGB space. */
function b(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

interface Sample {
  r: number;
  g: number;
  bl: number;
  height: number;
  ao: number;
  rough: number;
  glow: number;
  trans: number;
}

const S: Sample = { r: 0, g: 0, bl: 0, height: 0, ao: 1, rough: 0.8, glow: 0, trans: 0 };

/** Cellular ("warty") pattern — F1 distance to a jittered lattice, wrapping in x. */
function warts(u: number, v: number, cells: number): number {
  const cx = u * cells;
  const cy = v * cells;
  const ix = Math.floor(cx);
  const iy = Math.floor(cy);
  let best = 9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = ix + dx;
      const gy = iy + dy;
      const wx = ((gx % cells) + cells) % cells;
      const px = gx + hash2I(wx, gy);
      const py = gy + hash2I(wx + 977, gy - 31);
      const d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

/* --------------------------------------------------------------- bands */

function capSample(u: number, t: number, out: Sample): void {
  // t: 0 at the cap centre, 1 at the rim.
  const grain = fbmWrapX(u * 17, t * 11 + 3.1, 17, 4);
  // Concentric growth rings, warped so they never read as machined circles.
  // Frequency matters: a big cap is 12 m across, so 17 rings put a metre of
  // stripe between each and the whole plant reads as a beach umbrella. The
  // warp has to be strong and *azimuthal* — a radially-warped ring is still a
  // ring, and the bullseye survives. Two incommensurate ring sets on top of
  // that break the remaining periodicity.
  const warp = fbmWrapX(u * 6, t * 5 - 7.7, 6, 3) - 0.5;
  const swirl = (fbmWrapX(u * 3, t * 1.6 + 19.0, 3, 3) - 0.5) * 9.0;
  /**
   * Ring frequency is a SAMPLING budget, not a taste decision.
   *
   * The cap band is 450 texels tall. At 46 rings that is under ten texels per
   * cycle in a map that then drives a 2.6x normal — so the first mip level
   * already destroys them, and because the cap is a lathe seen at a grazing
   * angle the mip level changes from one quad of the mesh to the next. The
   * result was a grid of tone blocks across the crown: not the noise showing
   * its cells, but the FILTER showing the geometry's parameterisation. Twenty-
   * eight rings gives sixteen texels a cycle, which survives two more levels and
   * still puts a ring every twenty centimetres on a six-metre radius.
   */
  const ringA = Math.sin((t * 28 + warp * 6.0 + swirl + grain * 2.2) * Math.PI * 2);
  const ringB = Math.sin((t * 17.3 - warp * 4.5 + swirl * 0.6) * Math.PI * 2);
  const ring = 0.5 + 0.35 * ringA + 0.15 * ringB;
  /**
   * Radial fibre.
   *
   * Was 150 cycles at full albedo strength. u is the lathe angle, so on a
   * twelve-metre cap that is an eight-centimetre light/dark stripe running from
   * the boss to the margin, at a contrast the eye reads before it reads the
   * form — the review's "ribbed" cap is this term and nothing else. Fibre is a
   * RELIEF feature: it belongs in the height field where the normal map turns
   * it into a direction the light answers to. In the albedo, at that frequency,
   * it is corduroy.
   */
  // 56 -> 34. The cap lays this band down twice around its own circumference to
  // fix the azimuthal stretch, so the authored frequency has to come down by the
  // same factor or the fibre lands below what survives minification and turns
  // into a moire.
  const streak = valueWrapX(u * 34, t * 3.5, 34);
  const wart = 1 - clamp01(warts(u, t * 0.5, 46) * 1.6);

  /**
   * Mottling — the term that makes the cap a surface at any distance.
   *
   * Rings, fibre and warts are all centimetre features. Twenty metres out they
   * are inside the mip chain and every cap collapses to a single flat value,
   * which is precisely what "flat matte clay" describes: the material was there
   * but none of it survived minification. Variation that survives to silhouette
   * range has to have a wavelength of a METRE, i.e. three to eight cycles
   * around the circumference of a big cap.
   *
   * Two decorrelated octaves for the soft drift, plus a hard-edged blotch mask
   * on top. The edge is load-bearing: soft noise alone reads as dirty lighting,
   * whereas a blotch with a boundary reads as pigment IN the tissue.
   */
  const mottleA = fbmWrapX(u * 3, t * 2.1 + 41.0, 3, 4);
  const mottleB = fbmWrapX(u * 7, t * 4.4 - 13.0, 7, 3);
  const mottle = mottleA * 0.62 + mottleB * 0.38;
  const blotch = smoothstep(0.44, 0.62, mottleA) * smoothstep(0.70, 0.46, mottleB);

  /**
   * Spore dust.
   *
   * A parasol sheds onto its own upper surface and onto its neighbours: a pale,
   * matte, grey-ochre bloom that banks up around the boss and in the ring
   * valleys and is washed off the exposed margin. It is the one thing on the
   * plant that is lighter than the ash, and it is what stops the cap reading as
   * a single moulded object.
   */
  const dustN = fbmWrapX(u * 5 + 61.0, t * 3.0 + 7.7, 5, 3);
  const dust = clamp01(
    smoothstep(0.40, 0.86, dustN) * (1 - smoothstep(0.22, 0.86, t)) * (0.45 + 0.55 * (1 - ring)),
  );

  // Ash-ochre flesh; the deep tone is a red-brown, not a neutral grey, so a low
  // sun raking across the cap turns it amber rather than muddy. Ring contrast
  // lives almost entirely in the height field — in the albedo it would be a
  // zebra stripe visible from a kilometre away.
  const base = 0.30 + 0.13 * grain + 0.040 * ring + 0.20 * (mottle - 0.5);
  const dark = smoothstep(0.55, 0.05, t) * 0.14; // sun-bleached toward the rim
  const l = clamp01(base - dark - 0.085 * blotch + 0.028 * streak);
  /**
   * CHITIN AND BONE, not salmon — and the channel weights are the whole of it.
   *
   * At (0.86, 0.72, 0.55) a mid-tone texel comes out at a red:green:blue ratio of
   * 1 : 0.78 : 0.60. The bible's chitin band runs #d8c9a4 to #8f7d5a, i.e.
   * 1 : 0.93 : 0.76 to 1 : 0.87 : 0.63 — this band was a full step more saturated
   * and a step redder than the palette permits anywhere, and under the coast's
   * 17.6 h sun (which is itself warm) the product is the review's "salmon pink
   * against a bible that allows only desaturated ochre". Saturation discipline is
   * not a grading pass; it has to be true of the reflectance.
   *
   * These weights land a mid-tone at 1 : 0.87 : 0.69, inside the band at both
   * ends, and they leave the value untouched — the cap is not darker, it is less
   * chromatic, which is what "desaturated ochre" means.
   */
  out.r = l * 0.84 + 0.105;
  out.g = l * 0.76 + 0.082;
  out.bl = l * 0.62 + 0.060;
  // Violet blush in the deeper ring valleys — Ashenreach parasols are not
  // uniformly tan, and this is where the only non-ochre hue is allowed. Tied to
  // the mottle so the blush pools in patches instead of following every ring.
  // Halved with the desaturation above: a magenta lift on a band that is now
  // inside the chitin range is the one thing that could put it back outside it.
  const blush =
    clamp01((0.35 - ring) * 1.6) * smoothstep(0.15, 0.75, t) * (0.30 + 0.70 * mottleB) * 0.5;
  out.r = lerp(out.r, out.r * 0.94 + 0.055, blush);
  out.bl = lerp(out.bl, out.bl * 1.04 + 0.062, blush);
  // The bloom lies ON TOP of the pigment rather than tinting it — a film, so it
  // desaturates toward ash #8a7f72 instead of just brightening.
  out.r = lerp(out.r, out.r * 0.42 + 0.400, dust * 0.78);
  out.g = lerp(out.g, out.g * 0.42 + 0.372, dust * 0.78);
  out.bl = lerp(out.bl, out.bl * 0.42 + 0.325, dust * 0.78);

  /**
   * Mottling is PIGMENT and must stay out of the height field.
   *
   * Feeding it in put a metre-wavelength ramp into a map that is differentiated
   * at 1024 samples and amplified 2.6x, and value noise is only C0 at its cell
   * boundaries — so the derivative is piecewise constant and the cap came out
   * tiled with flat quadrilateral facets, a worse artefact than the flatness it
   * was added to cure. Relief in this band comes from the rings, the grain, the
   * radial fibre and the warts, all of which are high frequency enough that
   * their cell structure is below a texel.
   */
  /**
   * The rings step DOWN, and the reason is that they are the concentric term.
   *
   * `ring` is a pure function of t, i.e. of radius, so every gram of relief and
   * occlusion it carries is a perfect circle centred on the boss. Through a polar
   * parameterisation whose mip level is also a function of radius, that is the
   * "concentric moire rings" the review measured: not an aliasing artefact laid
   * over a good surface, but the surface itself being rotationally symmetric and
   * then filtered rotationally symmetrically. A real cap does have concentric
   * structure and it should not go away — but at 0.55 of the height field and a
   * 38% occlusion swing it was the ONLY structure, and everything else on the cap
   * was a modulation of it.
   *
   * What replaces it is the world-space surface layer (see Surface.ts), whose
   * blotching and blistering know nothing about the axis and therefore break the
   * symmetry at exactly the scale the eye reads it.
   */
  out.height = ring * 0.34 + grain * 0.36 + streak * 0.26 + wart * 0.42 * smoothstep(0.5, 0.0, t);
  out.ao = clamp01(0.76 + 0.24 * ring) * (1 - 0.25 * wart) * (1 - 0.10 * blotch);
  /**
   * Moisture, and the sheen it buys.
   *
   * A fungal cuticle is not uniformly matte. Water sits in the ring valleys and
   * gives them a broad soft highlight; the exposed crests dry out; spore dust is
   * the dustiest thing in the frame. At one roughness everywhere the specular
   * says nothing at all about the form, which is the other half of why the cap
   * read as unfired clay. This spread is 0.55 to 0.99 — a genuine gloss range.
   */
  const crease = clamp01((0.46 - ring) * 2.1);
  /**
   * A waxy cuticle, so the cap separates from the rock by shading alone.
   *
   * The review's charge is "zero material differentiation between fungus and
   * stone anywhere in frame", and it is fair: at 0.90 base roughness a fungal cap
   * returns the same broad diffuse-ish lobe basalt does. Fungal cuticle is a
   * genuinely low-roughness film — it is the reason a real cap catches a long
   * soft sheen along its dome. Widening the spread downward (0.86 floor, deeper
   * creases, a much glossier margin) is what buys that read, and it costs
   * nothing: the roughness map is already fetched.
   */
  out.rough = clamp01(
    0.86 - 0.34 * crease - 0.26 * smoothstep(0.55, 1.0, t) - 0.06 * grain + 0.11 * dust,
  );
  // Bioluminescence lives on the margin and in the ring valleys, never as an
  // even wash — an evenly glowing cap reads as a lamp, not as an organism.
  /**
   * The glowing margin is a BAND, not a hairline.
   *
   * At smoothstep(0.80, 0.995) the emissive lived in the outer fifth of the cap
   * band, which on a small ground fungus is a one-pixel ring round the rim: at
   * night the field read as scattered neon dashes rather than as lit caps, and by
   * day the same ring traced a saturated cyan outline round distant clusters. A
   * margin roughly a third of the radius deep is what a real bioluminescent cap
   * does, it survives minification, and it gives the light somewhere to come from.
   */
  const rim = smoothstep(0.66, 0.99, t);
  out.glow = clamp01(rim * (0.45 + 0.55 * (1 - ring)) * (0.5 + 0.5 * grain));
  // Thin at the margin, thick over the stalk: exactly the thickness profile
  // that makes a low sun set the edge of the cap alight. Dust blocks it, which
  // is what keeps the transmission on the clean margin where it belongs.
  out.trans = clamp01(
    smoothstep(0.08, 0.92, t) * (0.72 + 0.28 * (1 - ring)) * (1 - 0.35 * dust),
  );
}

function gillSample(u: number, t: number, out: Sample): void {
  // t: 0 at the stalk, 1 at the cap margin. Gills radiate, so they are a pure
  // function of u with a slow angular drift plus forked interstitial lamellae.
  const drift = (fbmWrapX(u * 3, t * 1.7, 3, 2) - 0.5) * 0.35;
  const phase = (u + drift * 0.02) * 96.0;
  const lam = 0.5 + 0.5 * Math.cos(phase * Math.PI * 2);
  // Short gills that only reach part way in, so the pattern is not a perfect comb.
  const forked = 0.5 + 0.5 * Math.cos(phase * Math.PI * 4 + 1.7);
  const reach = smoothstep(0.15, 0.55, t);
  // Sectoral variation. Without it every gill sector is the same pale chitin at
  // the same depth and the underside is a rotationally symmetric barcode — a
  // machined grating rather than tissue. This modulates both the colour and the
  // DEPTH of the lamellae, so whole sectors of the cap have crowded deep gills
  // and others have shallow faint ones.
  const sector = fbmWrapX(u * 4 + 31.0, t * 2.2 - 6.0, 4, 3);
  const g = clamp01(lerp(0.5, lam * 0.75 + forked * 0.25 * reach, 0.45 + 0.55 * sector));
  const grime = fbmWrapX(u * 7, t * 6 + 21.0, 7, 3);

  /**
   * Lamella contrast lives in RELIEF, not in pigment.
   *
   * At 0.42 + 0.44g the albedo swung nearly three to one at 132 cycles around
   * the cap, which renders as a hard black-and-white comb — a machined grating,
   * not tissue. Real gills are all one pale colour and are legible entirely
   * through self-shadowing, so the swing moves into ao and the normal map and
   * the albedo keeps only enough to stop the underside going dead flat.
   */
  /**
   * Dark, and deliberately so.
   *
   * Lifting this band to 0.52 with an occlusion floor of 0.34 was chasing "gill
   * detail catching light" and it overshot twice over. The underside of a
   * parasol is the deepest shadow the plant owns and half of why a twenty-metre
   * cap reads as massive rather than as an umbrella; brightening it threw that
   * away AND, because the only light reaching it is a cool ambient dome, turned
   * it into a large pale neutral inside a frame of salmon ash, which the eye
   * reads as mint. The detail the review asked for comes from the lamella
   * RELIEF and the sectoral variation below, not from raising the floor.
   */
  const l = 0.42 + 0.22 * g - 0.13 * grime * (1 - t) + 0.13 * (sector - 0.5);
  /**
   * Chitin, and warmer than it was.
   *
   * A cap underside is in its own shadow all day, so almost all of its light is
   * the ambient dome — and at dawn that dome measures (0.119, 0.102, 0.151),
   * a cool violet. Multiplied by a near-neutral band it produced a grey with a
   * slight green bias which, set inside a frame of salmon ash, read as mint:
   * simultaneous contrast doing what the palette explicitly forbids. The band
   * itself has to carry the warmth, because the light will not.
   */
  out.r = clamp01(l * 0.94 + 0.11);
  out.g = clamp01(l * 0.82 + 0.082);
  out.bl = clamp01(l * 0.56 + 0.058);
  out.height = g * 0.9 + grime * 0.1;
  // Deep self-occlusion between the lamellae is most of what makes gills read.
  // Floored well above black: at 0.14 the valleys clipped to pure shadow and
  // took every trace of the sun's colour with them.
  out.ao = clamp01(0.17 + 0.83 * Math.pow(g, 1.30));
  /**
   * The most matte surface on the plant, and it has to be.
   *
   * At 0.80-0.92 the gill band still returned a broad specular lobe, and what it
   * was reflecting is the sky IBL — which at dawn is a cool blue-grey overhead.
   * On a surface that is in its own shadow all day that reflection is a large
   * fraction of everything the underside emits, and it dragged the whole cap
   * bottom to a neutral that read as mint inside a salmon frame. Dry
   * spore-bearing tissue is genuinely near-Lambertian: taking the roughness to
   * the top of the range removes the cool sky lobe and lets the band's own warm
   * reflectance carry the surface.
   */
  out.rough = clamp01(0.99 - 0.05 * g);
  // Blotchy, not a lampshade: the light comes from patches of tissue between
  // the lamellae, and an evenly glowing underside reads as a painted decal.
  const patch = fbmWrapX(u * 5 + 3.3, t * 4 - 1.7, 5, 3);
  out.glow = clamp01((1 - g) * smoothstep(0.28, 0.85, patch) * 1.25 * smoothstep(0.1, 0.6, t));
  /**
   * The red/green gill striping, and why it was never the lens.
   *
   * Measured on the dawn hero parasol by differencing a capture against one with
   * the subsurface term forced to zero: transmission contributes (0.051, 0.016,
   * 0.013) of linear radiance to the cap underside — a ratio of 1 : 0.31 : 0.26,
   * i.e. about a third of everything the red channel there emits and a fifth of
   * the green. It is a strongly RED light laid over near-neutral chitin. That on
   * its own is fine; it is the whole point of the effect.
   *
   * What is not fine is that the same measurement shows its amplitude swinging
   * by twenty per cent at dawn and thirty-eight in the vale ACROSS A LAMELLA.
   * A saturated red whose strength combs at ninety-six cycles around the cap,
   * added to a base that does not comb the same way, moves the ratio between the
   * channels — and the ratio between the channels IS hue. So the gills came out
   * banded red and green. Chromatic aberration could not have caused it and
   * turning chromatic aberration off could not have cured it: the fringe is in
   * the shading, and it was in the shading all along.
   *
   * Half of that swing was this line. It read `0.55 + 0.45 * g` — the lamella
   * comb itself. Transmission is a DIFFUSION property: light that has scattered
   * through a centimetre of fungal flesh cannot remember which lamella it went
   * in by, because the mean free path in that tissue is orders of magnitude
   * longer than a lamella is wide. That is exactly why a real backlit cap glows
   * as one smooth sheet with the gills reading as shadow ON it. (The other half
   * was the occlusion reaching the term through diffuseColor; see Materials.ts.)
   *
   * The sectoral field keeps the same range and very nearly the same mean, so
   * the cap still transmits unevenly — whole sectors really are thinner than
   * others — but now only at the scale flesh can diffuse across. The lamellae
   * keep every bit of their relief (height) and their self-occlusion (ao), which
   * is where the gill structure belongs and where it does the visible work.
   */
  out.trans = clamp01(0.55 + 0.45 * sector);


}

function stalkSample(u: number, t: number, out: Sample): void {
  /**
   * THIS BAND IS TILED, SO NOTHING IN IT MAY BE A FUNCTION OF POSITION ALONG THE
   * PLANT. That single rule is the whole fix for the vale stem blocker.
   *
   * loftStalk lays this band down `stalkVTile` times up a stipe (up to six) and
   * ping-pongs the coordinate so the repeat has no hard seam. What it cannot do
   * is make an AUTHORED GRADIENT tile: every term below that read `t` as "how far
   * up the plant am I" — the soil stain at the foot, the damp-to-dry roughness
   * ramp, the glow that fades in toward the neck, the annulus frequency taper —
   * was being replayed once per tile. Six copies of a dark foot stain up a
   * fifteen-metre stipe IS the review's "hard horizontal band pattern that
   * visibly repeats along its length", and it is the loudest of them because a
   * ping-pong makes each repeat a mirror pair, i.e. a symmetric dark band rather
   * than a soft ramp. No amount of phase jitter can hide a gradient that has been
   * tiled; the gradient has to leave the band.
   *
   * Everything positional now lives where the plant's real extent is known: the
   * baked aParam ramps in Build.ts, and the world-space foot/ring terms in
   * Surface.ts, which are keyed to metres and to a per-instance seed and are
   * therefore aperiodic by construction.
   *
   * What is left here is stationary tissue: fibre, pores, coarse mottling and a
   * weak annular wrinkle. All four are statistically identical at every t, so the
   * tile boundary is not a feature.
   *
   * t: a stationary coordinate across the band. Not a height.
   */
  // Fibres are long in v and narrow in u. The obvious way to get that — one
  // fBm with a 46:3 aspect ratio — does NOT work: value noise stretched that
  // far turns its own lattice into a herringbone, and a fifteen-metre stalk
  // ends up looking like woven basketwork. What does work is a high-frequency
  // *azimuthal* band whose phase is dragged slowly up the stalk, which is
  // literally how the fibres grow.
  // Keep the phase drag small. At five texels of lateral wander the fibres
  // cross each other and the stalk turns into a chevron weave — which is the
  // exact artefact this whole formulation exists to avoid.
  const drag = (fbmWrapX(u * 4, t * 0.9 + 2.2, 4, 3) - 0.5) * 1.4;
  const fibre =
    0.58 * valueWrapX(u * 150 + drag, t * 0.35 + 9.4, 150) +
    0.42 * valueWrapX(u * 330 + drag * 1.6, t * 0.7 - 4.0, 330);
  const coarse = fbmWrapX(u * 8, t * 2.2 - 3.3, 8, 4);
  /**
   * Annular growth wrinkles, at an IRREGULAR spacing.
   *
   * `sin(t * 26 + ...)` is 26 evenly spaced bands up a fifteen-metre stipe, and
   * evenly spaced is the whole problem: the review read the stalk as a stack of
   * machined rings because that is exactly what a constant-period sine is. A
   * stipe grows in fits, so the annuli crowd where it grew slowly and open out
   * where it grew fast. Integrating the phase through a noise field instead of
   * leaving it linear in t costs one fBm and removes the tell entirely.
   *
   * The azimuthal wander must still stay well under one cycle: at +/-3 cycles
   * the rings slide past each other around the stalk and it reads as a chevron
   * weave, which is a louder artefact than the wrinkles are worth.
   */
  /**
   * Frequency is set by the TILING, not by the band.
   *
   * The stalk band is now laid down several times up a stipe (see loftStalk's
   * vTile: mapping a fifteen-metre stalk onto one 225-texel band gives a ten-to-
   * one anisotropy and the trunk renders as a pure vertical smear). Twenty-one
   * annuli per band repeated six times is 126 rings up the stalk — six-centimetre
   * stripes, well below what survives minification, so they alias into a moire
   * and read as the machined banding the review measured. Seven per band lands at
   * roughly a ring every twenty-five centimetres on a real stipe, which is what a
   * growth mark actually is.
   */
  const annPhase = t * 7 + (fbmWrapX(u * 2 + 5.0, t * 2.4, 2, 3) - 0.5) * 1.6 + coarse * 0.55;
  // Amplitude modulated by a slow field: a stipe does not band uniformly from
  // root to neck, and an annulus that is present everywhere at one strength is
  // exactly what makes a repeat legible.
  const annMask = 0.25 + 0.75 * fbmWrapX(u * 1.0 + 17.0, t * 1.3 + 31.0, 1, 3);
  // Stationary: the frequency taper `(1 - 0.35 * t)` was a function of height up
  // the plant, and under tiling it became a saw — the annuli crowded and opened
  // out once per tile, which is a periodic beat rather than a growth record.
  const ann = 0.5 + 0.5 * Math.sin(annPhase * Math.PI * 2) * annMask;
  const pore = 1 - clamp01(warts(u, t * 1.6, 30) * 2.2);
  // Metre-scale blotching, so the stalk still has a surface once the fibre and
  // the annuli are inside the mip chain.
  const mott = fbmWrapX(u * 3 + 23.0, t * 2.0 - 9.0, 3, 3);

  /**
   * 0.30 -> 0.39, and it is the same multiply that was missed on the ground
   * cover two iterations ago.
   *
   * This band is the entire surface of every mushroom stipe in the world, and it
   * is multiplied by a species tint in LINEAR space before it ever reaches the
   * light: 0.72 linear for the glow fungus, 0.55 for the trama root. At a base of
   * 0.30 the band lands at 0.355 sRGB = 0.107 linear, so the reflectance that
   * actually shades is 0.077 against ash at a quarter — a stop and three quarters
   * down, which is the measurement behind "a flat, unlit, near-black cone",
   * "luminance 50.0 with sd 7.63" and "a solid black trapezoid". Nothing was
   * bypassing the lighting; there was no reflectance left for the lighting to act
   * on. A fungal stipe is a pale thing — bone to weathered ochre — and at 0.39 the
   * same fibre, the same occlusion and the same sun produce a readable terminator
   * across a cylinder.
   *
   * The soil stain that used to sit under this is gone; see the band note above.
   */
  /**
   * The two LOW-FREQUENCY terms are cut by nearly half, and that is the hero
   * trunk's vertical smear.
   *
   * `coarse` is eight cells around the circumference against 2.2 up the band,
   * and the band is ping-ponged up to six times along the stipe — so a mirrored
   * repeat joins each blob to its own reflection and the pair reads as one
   * continuous dark stripe running the whole height of the plant. At 0.16 plus
   * `mott` at 0.17 that is a third of the band's whole albedo range spent on
   * structure that can only ever be vertical.
   *
   * It is not that the stalk should have less mottling — it is that the mottling
   * has to come from somewhere that does not tile. Surface.ts evaluates a metre
   * scale field in WORLD space on the same surface and its weight goes up to
   * match (see the pigment line in the stalk block): three dimensions, no period,
   * no mirror, and a per-instance offset.
   *
   * The base rises by 0.035 to hold the band's mean reflectance exactly where the
   * note below set it — this is a redistribution, not a value change.
   */
  const l = clamp01(0.425 + 0.09 * coarse + 0.18 * fibre - 0.05 * ann + 0.11 * (mott - 0.5));
  out.r = l * 0.80 + 0.085;
  out.g = l * 0.74 + 0.076;
  out.bl = l * 0.63 + 0.062;
  // Blotching stays out of the height field for the same reason it does on the
  // cap: a low-frequency value-noise ramp differentiated at texel scale facets.
  // The annuli also drop from 0.45 to 0.30 — at full strength a bark band this
  // strong (3.4x) turned them into machined grooves rather than growth marks.
  // Cross-grain wrinkle, at a scale between the fibre and the annuli. A stipe
  // that carries only lengthwise fibre has literally zero horizontal variation,
  // which is the other half of the "1D vertical smear" the review measured on
  // the hero trunk: with the V axis tiled the fibre now has correct texel
  // density, but it still has to have something to cross.
  //
  // The amplitude is small on purpose. At 0.26 it met the lengthwise fibre at
  // comparable contrast and the two crossed into a legible plaid — the
  // basketwork this whole formulation exists to avoid, and the first tiled build
  // of the hero trunk showed exactly that. Cross-grain has to be a WHISPER
  // against the grain, not an equal partner.
  const wrinkle = fbmWrapX(u * 9 + 47.0, t * 17 - 3.0, 9, 3);
  out.height = fibre * 0.52 + ann * 0.08 + pore * 0.22 + wrinkle * 0.11;
  /**
   * The annulus keeps its relief and loses most of its OCCLUSION.
   *
   * Occlusion is folded into the diffuse at 0.62 (see Materials.ts), so a 38%
   * swing here is a 24% swing in reflectance at a fixed frequency in a band that
   * is tiled up to six times — the strongest periodic signal on the stipe and
   * three quarters of what makes the banding legible at a glance. Growth marks
   * belong in the world-space ring term in Surface.ts, which is keyed to metres
   * and to a per-instance seed and so has no period to read. What is left here is
   * the fibre's own self-shadowing, which is stationary.
   */
  out.ao = clamp01(0.70 + 0.22 * (0.35 + 0.65 * fibre) + 0.08 * (1 - ann)) * (1 - 0.25 * pore);
  // Stationary. The damp-foot/dry-neck ramp was a gradient in a tiled band.
  out.rough = clamp01(0.93 - 0.10 * fibre + 0.05 * ann);
  out.glow = clamp01(pore * 0.35);
  out.trans = 0.06 + 0.10 * (1 - ann);
}

/**
 * The broad fleshy leaf — marshmerrow, ash yam, kelp, stoneflower pad.
 *
 * This band was the coast blocker: "the closest object in frame at roughly 2 m
 * is a solid flat dark grey-brown with only broad form shading — zero albedo
 * variation, zero veins/ribs, no edge translucency". Every clause of that is a
 * separate defect and all four were in these twenty lines.
 *
 *  VALUE. The band was authored around l = 0.38, i.e. sRGB 0.42, i.e. 0.148 in
 *  LINEAR reflectance — and it is then multiplied by a species tint that was
 *  itself 0.35 linear, so what reached the light was 0.05. Ash is 0.20. The
 *  hero plant was reflecting a QUARTER of what the ground behind it reflects,
 *  which is why the review could measure it darker than the cast shadows around
 *  it. That is not a plant that is in shadow; that is a plant with no shading
 *  information left in it to see. Both halves of the product come up (see the
 *  tints in Flora.ts): the leaf now lands near 0.12 linear, comfortably darker
 *  than the ash it stands on and comfortably inside the range where a normal
 *  map and a transmission term are visible at all.
 *
 *  VARIATION. One four-octave blotch at a tenth of the value's amplitude, on a
 *  surface whose lightest and darkest texel differed by four per cent. A real
 *  fleshy leaf is blotched at the scale of the leaf, mottled at the scale of a
 *  fingernail, and scarred. Three decorrelated fields, all of them carrying real
 *  amplitude, and the coarsest has a wavelength of a fifth of the blade so it
 *  survives to silhouette range instead of mipping to the mean.
 *
 *  RIBS. The vein term went into the ALBEDO, where it is a stripe, and only
 *  0.35 of it into the height, where it would have been a shape. On a lamina
 *  the veins are relief: they catch the light on one flank and shade the other,
 *  and that is what tells the eye it is looking at a membrane rather than at a
 *  painted card. u is the across-blade coordinate at ~0.2 mm per texel, so a
 *  six-millimetre corrugation is thirty texels — comfortably resolvable, and
 *  exactly the 2-4 mm scale band the review asked for.
 *
 *  EDGE. The margin of a leaf is thinner than its middle, so it transmits more
 *  and reflects less. `trans` now rises toward the edge instead of being flat
 *  across the lamina, which is what makes a backlit blade glow along its rim.
 */
function leafSample(u: number, t: number, out: Sample): void {
  // u across the blade (0.5 = midrib), t along it.
  const across = Math.abs(u - 0.5) * 2;
  const rib = 1 - smoothstep(0.0, 0.085, across);
  // Secondary veins, fanning from the midrib toward the tip.
  const ang = (u - 0.5) * 9.0 + t * 2.4;
  const vein = 0.5 + 0.5 * Math.sin(ang * Math.PI * 2 * 2.4);
  const veinMask = smoothstep(0.5, 0.95, vein) * (1 - rib) * smoothstep(0.02, 0.25, across);
  /**
   * The fine corrugation, and the reason it is in u alone.
   *
   * The leaf band is 123 texels tall over a blade a metre and a half long, so
   * ALONG the blade one texel is more than a centimetre and nothing at the
   * scale the review asked for can be represented. ACROSS the blade the same
   * band is 1024 texels over about twenty centimetres — a fifth of a
   * millimetre per texel — so a 6 mm pleat is thirty texels wide and survives
   * three mip levels. Corrugation across the width is also what a strap leaf
   * actually has.
   */
  const pleat = 0.5 + 0.5 * Math.cos((u * 34.0 + t * 1.7) * Math.PI * 2);
  const pleatK = (1 - rib) * smoothstep(0.05, 0.30, across) * (1 - smoothstep(0.72, 1.0, across));
  // Three scales of pigment: blade-scale drift, fingernail-scale mottle, and a
  // sparse hard-edged scar field.
  const drift = fbm2(u * 1.7 + 5.0, t * 2.6 - 9.0, 3);
  const mottle = fbm2(u * 6 + 11.0, t * 9 - 4.0, 4);
  const scar = clamp01((fbm2(u * 13.0 - 21.0, t * 17.0 + 6.0, 3) - 0.62) * 4.4);
  // Dry margin: the outer eighth of a fleshy blade is always older and paler.
  const margin = smoothstep(0.78, 1.0, across);

  /**
   * Verdigris #5f7a63 shading toward chitin #8f7d5a, and nothing greener. The
   * palette allows exactly one green and it is a grey one; the drift field
   * walks the band between the two so a stand is not one flat hue.
   */
  const l = clamp01(
    0.335 + 0.190 * drift + 0.150 * mottle + 0.045 * veinMask + 0.055 * margin - 0.130 * scar,
  );
  // Warmer where the pigment thins (margin, scar), cooler in the deep lamina.
  const warm = 0.55 * margin + 0.45 * scar + 0.30 * drift;
  out.r = clamp01(l * (0.80 + 0.16 * warm) + 0.095);
  out.g = clamp01(l * (0.88 - 0.02 * warm) + 0.112);
  out.bl = clamp01(l * (0.70 - 0.10 * warm) + 0.088);
  // Relief, not stripes: the midrib is the shape, the secondary veins are the
  // detail, the pleat is the micro-relief, and the mottle keeps the lamina from
  // being a perfect plane between them.
  out.height = rib * 0.90 + veinMask * 0.55 + pleat * 0.16 * pleatK + mottle * 0.22 - scar * 0.18;
  out.ao = clamp01(0.62 + 0.30 * (rib + veinMask) + 0.10 * (1 - pleat) * pleatK - 0.16 * scar);
  // No mirror on a membrane: the rib is a rounded fold, not a waxed edge, and a
  // narrow low-roughness line down the spine of a backlit blade is exactly the
  // "blown near-white highlight along their spines" the ridge review measured
  // on the ground-cover band.
  out.rough = clamp01(0.84 - 0.10 * rib + 0.08 * scar - 0.05 * mottle);
  out.glow = 0.0;
  // Thinner at the margin, thickest over the midrib: a backlit blade lights up
  // along its rim, which is the whole art-direction point of the transmission.
  out.trans = clamp01(0.62 - 0.42 * rib + 0.38 * margin + 0.12 * (1 - across));
}

function bladeSample(u: number, t: number, out: Sample): void {
  // Ground cover: ash grass and lichen, sharing a band. u across, t along.
  const across = Math.abs(u - 0.5) * 2;
  /**
   * ONE keel, not three.
   *
   * `cos(3 * 2pi * u)` put three full light/dark cycles across the width of a
   * card three centimetres wide, at a contrast the normal map then amplified —
   * so every blade and every lichen frond in the near field rendered as a
   * black-and-white barcode. A grass blade has a single midrib with the lamina
   * falling away either side of it, and that is a shape whose shading tells the
   * eye which way the card is facing instead of dazzling it.
   */
  const ridge = 1 - smoothstep(0.0, 0.62, across);
  // A little lengthwise corrugation, at a tenth of the amplitude the cross-blade
  // ridging used to carry: enough to keep a wide strap leaf from being a
  // perfectly flat plane, not enough to be read as a pattern.
  const rib = 0.5 + 0.5 * Math.cos(t * Math.PI * 2 * 5.0 + u * 3.0);
  const speck = fbm2(u * 14 + 3.0, t * 30 - 8.0, 3);
  const dry = smoothstep(0.35, 1.0, t); // tips are dead and pale

  // Ash scrub is dry ochre, not meadow green. The old base (0.20) put the whole
  // band at a value below the ash it stands on, so a sunlit sward read as a
  // carpet of black spikes at any distance where the blades were sub-pixel.
  //
  // The dead-tip term is pulled back from 0.26 to 0.17 and the blue channel
  // lifted: at the old weights the tips came out a saturated cream-yellow that
  // was, after bioluminescence and lava, the third most saturated thing in the
  // frame — and the palette allows exactly two.
  /**
   * The dead-tip term is the confetti.
   *
   * At 0.17 the tip of every card came out most of a stop brighter than the ash
   * it stands on, and once a card is two or three pixels across — which is
   * everything past about six metres — a value that far off the ground's is not
   * read as a blade, it is read as a fleck of litter lying on the surface. That
   * is precisely the review's "scattered plastic debris" and "confetti sitting on
   * the ground". Ground cover has to sit INSIDE the ash's value range and let its
   * SHAPE carry it; the dry tips survive as a hint, not as a highlight.
   */
  /**
   * 0.375 -> 0.46, and the reason it was still too dark is a MULTIPLY nobody
   * accounted for here.
   *
   * This band is authored to sit inside the ash's value range, and on its own it
   * does: the base lands at about 0.54 in sRGB, which is #8a7f72's own value.
   * But it is not what gets drawn. Every ground-cover layer multiplies the band
   * by a species tint in LINEAR space — 0.39 linear for scathecraw — so the
   * reflectance that actually reaches the light is a tenth of a linear unit
   * against ash at a quarter. That is a full stop and a half down, and it is the
   * measurement behind "near-black hard-edged triangles", "flat black alpha
   * cards" and "the near-black value makes the cover read as burnt stubble"
   * across four separate shots. The same mistake was found and fixed on the
   * trama root two iterations ago; the ground layers were missed.
   *
   * The tints have been raised toward the ash (see GROUND in Flora.ts) and the
   * band comes up with them, so the product lands at roughly 0.7 of the ash's
   * reflectance: darker than the ground it grows out of, which is correct, but
   * inside its range rather than below it.
   */
  // 0.40, landing at roughly 0.57 of the ash's reflectance once the species tint
  // is applied. 0.46 was measured on the vale capture and overshot: it put the
  // dry tips ABOVE the ash, which is the "confetti" failure the dead-tip note
  // below describes and the opposite error to the one being fixed.
  /**
   * The keel's albedo and occlusion lift come down: 0.09 -> 0.045 and (below)
   * 0.20 -> 0.11.
   *
   * Together they were putting the middle of every card about half a stop above
   * its own lamina, and the two are multiplied (the occlusion is folded into the
   * albedo as contact AND applied to the indirect), so the centre line of a
   * near-field card was reaching about 1.5x the value of its edges. On a card
   * fifteen pixels wide at six metres that is not a midrib, it is a blown spine
   * — the ridge review's "blown near-white highlights along their spines". A
   * keel is a fold: it belongs in the height field, where it is a shape the
   * light answers to, and only faintly in the reflectance.
   */
  const l = 0.40 + 0.20 * speck + 0.045 * ridge + 0.065 * dry;
  out.r = clamp01(l * 0.86 + 0.070);
  out.g = clamp01(l * 0.84 + 0.068);
  out.bl = clamp01(l * 0.68 + 0.058);
  out.height = ridge * 0.55 + rib * 0.10 + speck * 0.3;
  // The occlusion floor comes up with the albedo, and for the same reason: it is
  // multiplied into the diffuse twice (once folded into the albedo as contact,
  // once on the indirect), so a 0.72 floor is really 0.55 on an ambient-lit card.
  out.ao = clamp01(0.80 + 0.11 * ridge) * (1 - 0.10 * across);
  // No specular lobe worth the name on a translucent blade: the review asked
  // for a roughness floor around 0.4 and this band never goes near it, but the
  // dry tip was the one place it came down at all and a glint on a dead tip is
  // the last thing a sward needs.
  out.rough = clamp01(0.88 - 0.08 * dry);
  // Glow-moss. The band carried no bioluminescence mask at all, which is why
  // every night frame had a black landmass under it: the ground cover is the
  // only flora present on open ash, and none of it could light. Colonies live
  // toward the crown of a cushion and the tip of a blade, in blotches — an even
  // wash over the band would turn a night meadow into a fluorescent tube.
  const colony = fbm2(u * 5.0 - 12.0, t * 6.0 + 4.0, 3);
  out.glow = clamp01(smoothstep(0.46, 0.86, colony) * (0.35 + 0.65 * smoothstep(0.15, 0.9, t)));
  out.trans = clamp01(0.70 - 0.35 * dry);
}

/* -------------------------------------------------------------- assembly */

function sampleAtlas(u: number, v: number, out: Sample): void {
  if (v < BAND.blade[1]) {
    bladeSample(u, (v - BAND.blade[0]) / (BAND.blade[1] - BAND.blade[0]), out);
  } else if (v < BAND.leaf[1]) {
    leafSample(u, (v - BAND.leaf[0]) / (BAND.leaf[1] - BAND.leaf[0]), out);
  } else if (v < BAND.stalk[1]) {
    stalkSample(u, (v - BAND.stalk[0]) / (BAND.stalk[1] - BAND.stalk[0]), out);
  } else if (v < BAND.gill[1]) {
    gillSample(u, (v - BAND.gill[0]) / (BAND.gill[1] - BAND.gill[0]), out);
  } else {
    capSample(u, (v - BAND.cap[0]) / (BAND.cap[1] - BAND.cap[0]), out);
  }
}

class Atlas implements FloraAtlas {
  constructor(
    readonly albedo: THREE.Texture,
    readonly normal: THREE.Texture,
    readonly arm: THREE.Texture,
  ) {}
  dispose(): void {
    this.albedo.dispose();
    this.normal.dispose();
    this.arm.dispose();
  }
}

/**
 * Synthesise the atlas. Yields to the event loop between row blocks so the boot
 * progress bar can still repaint — a 1024^2 five-band synthesis is ~0.4 s of
 * solid JS otherwise.
 */
export async function buildFloraAtlas(anisotropy: number): Promise<FloraAtlas> {
  const n = SIZE;
  const alb = new Uint8Array(n * n * 4);
  const nrm = new Uint8Array(n * n * 4);
  const arm = new Uint8Array(n * n * 4);
  const height = new Float32Array(n * n);

  for (let j = 0; j < n; j++) {
    const v = (j + 0.5) / n;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      sampleAtlas(u, v, S);
      const k = j * n + i;
      const o = k * 4;
      alb[o] = b(S.r);
      alb[o + 1] = b(S.g);
      alb[o + 2] = b(S.bl);
      alb[o + 3] = 255;
      arm[o] = b(S.ao);
      arm[o + 1] = b(S.rough);
      arm[o + 2] = b(S.glow);
      arm[o + 3] = b(S.trans);
      height[k] = S.height;
    }
    if ((j & 127) === 127) await new Promise<void>((r) => setTimeout(r, 0));
  }

  // Normals by central difference on the height field. Bands have wildly
  // different physical scales, so the derivative is scaled per band — a gill
  // lamella is a millimetre feature and a cap ring is a centimetre one, and
  // giving them the same normal strength flattens one and shatters the other.
  const strengthFor = (v: number): number => {
    if (v < BAND.blade[1]) return 1.4;
    if (v < BAND.leaf[1]) return 2.0;
    // Bark. The strongest band in the atlas: a dead limb in the near field is
    // the one flora surface whose micro-relief the eye can actually resolve,
    // and at 2.2 the fibre and the annular wrinkles were a suggestion rather
    // than a response.
    if (v < BAND.stalk[1]) return 3.4;
    if (v < BAND.gill[1]) return 5.0;
    /**
     * 2.6 -> 2.0.
     *
     * The cap band's relief is now the SECOND source of relief on a crown: the
     * world-space layer supplies the metre and decimetre bumps analytically and
     * without a mip chain. What is left for the atlas is centimetre grain, and
     * amplifying centimetre grain by 2.6 through a polar parameterisation is
     * exactly what made the mip level steps legible as tone blocks. Less gain on
     * the term that aliases, none lost on the term that does not.
     */
    return 2.0;
  };
  for (let j = 0; j < n; j++) {
    const v = (j + 0.5) / n;
    const k = strengthFor(v);
    // Do not differentiate across a band boundary: the seam would become a
    // bright crease running around every mushroom in the world.
    const jm = j > 0 && strengthFor((j - 0.5) / n) === k ? j - 1 : j;
    const jp = j < n - 1 && strengthFor((j + 1.5) / n) === k ? j + 1 : j;
    for (let i = 0; i < n; i++) {
      const im = (i - 1 + n) % n; // u wraps: every band is a lathe or a strip
      const ip = (i + 1) % n;
      const dx = (height[j * n + ip] - height[j * n + im]) * k;
      const dy = (height[jp * n + i] - height[jm * n + i]) * k;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const o = (j * n + i) * 4;
      nrm[o] = b((-dx / len) * 0.5 + 0.5);
      nrm[o + 1] = b((-dy / len) * 0.5 + 0.5);
      nrm[o + 2] = b(1 / len * 0.5 + 0.5);
      nrm[o + 3] = 255;
    }
    if ((j & 255) === 255) await new Promise<void>((r) => setTimeout(r, 0));
  }

  const make = (data: Uint8Array, srgb: boolean): THREE.DataTexture => {
    const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    // u wraps (lathe angle); v must clamp or a cap would bleed into a stalk.
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
    return t;
  };

  return new Atlas(make(alb, true), make(nrm, false), make(arm, false));
}
