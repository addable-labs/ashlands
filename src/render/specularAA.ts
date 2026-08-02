import * as THREE from 'three';

/**
 * Geometric specular antialiasing, installed renderer-wide.
 *
 * ---------------------------------------------------------------------------
 * The defect
 * ---------------------------------------------------------------------------
 * A specular lobe is a function of the *normal*, and a pixel does not have a
 * normal — it has a distribution of them, because a pixel covers many texels of
 * a normal map and, at distance, many triangles of a mesh. Shading with the one
 * normal that happens to land under the pixel centre samples that distribution
 * at a single point. When the surface is smooth the lobe is narrower than the
 * pixel footprint, so the sample either hits the lobe or misses it entirely,
 * and the answer flips as the surface, the camera or the TAA jitter moves by a
 * fraction of a pixel. That is the "boiling", "crosshatch", "shimmering
 * highlight" family of artefacts, and it is worst exactly where the review
 * found it: distant terrain, where a mip'd normal map compresses metres of
 * relief into one pixel, and water, where the slope distribution is enormous.
 *
 * It cannot be fixed downstream. TAA does not remove it (the signal is not
 * temporally stable, so the history clamp keeps rejecting it — that is what
 * makes it *crawl* rather than average out), a firefly clamp only limits its
 * amplitude, and a sharpen filter amplifies it. The only correct fix is to stop
 * producing it: widen the NDF so the lobe is never narrower than the pixel
 * footprint, which is what the normal *distribution* over that footprint says
 * it should have been in the first place.
 *
 * ---------------------------------------------------------------------------
 * What three already does, and why it is not enough
 * ---------------------------------------------------------------------------
 * three's `lights_physical_fragment` computes
 *
 *     vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
 *     float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
 *     material.roughness += geometryRoughness;
 *
 * Two things are wrong with that for our purposes:
 *
 *  1. It reads `nonPerturbedNormal` — the *interpolated vertex* normal. It
 *     therefore sees mesh curvature and nothing else. Every normal map in the
 *     game, which is where the high-frequency slope variance actually lives, is
 *     invisible to it. Distant terrain shimmer is overwhelmingly normal-map
 *     variance, so the term that exists does not address the case that matters.
 *  2. It adds a first-order slope estimate directly to `roughness`. Roughness
 *     is not the quantity that composes; GGX variance is. Adding a linear
 *     estimate of a derivative to a perceptual roughness parameter over- and
 *     under-corrects in different regimes and has no threshold, so on a
 *     silhouette — where the derivative of the normal is huge and meaningless —
 *     it can drive a polished surface to fully rough in a one-pixel band.
 *
 * ---------------------------------------------------------------------------
 * What this installs instead
 * ---------------------------------------------------------------------------
 * Isotropic NDF filtering (Kaplanyan et al., "Filtering Distributions of Normals
 * for Shading Antialiasing", HPG 2016; refined in Tokuyoshi & Kaplanyan 2019).
 * The screen-space variance of the *final shading normal* — normal map, detail
 * map, geometric curvature, whatever the material ended up with — is converted
 * into a kernel variance and convolved into the GGX lobe:
 *
 *     sigma^2  = SIGMA2 * ( |dN/dx|^2 + |dN/dy|^2 )
 *     alpha'^2 = alpha^2 + min( 2 * sigma^2, KAPPA )
 *
 * Composing in alpha-squared is the point: GGX variance is additive, so this is
 * the correct convolution of the lobe with the pixel footprint rather than a
 * fudge on a roughness slider. `KAPPA` is the clamp that keeps a silhouette or a
 * normal-map discontinuity — where the derivative is not a slope distribution at
 * all, just an edge — from blowing the material to fully rough; 0.18 is the
 * value the paper's authors settled on and it corresponds to roughly a 0.42
 * roughness ceiling on the widening.
 *
 * `SIGMA2` is the variance of the pixel reconstruction filter in pixel units.
 * 0.25 is the standard value for a unit-width filter and is what the reference
 * implementations use.
 *
 * Cost: two `dFdx`/`dFdy` on a vec3 and a handful of ALU, in place of the two
 * `dFdx`/`dFdy` and the `max` chain it replaces. Measurably free — it is the
 * same derivative hardware doing the same work on a different vector.
 *
 * ---------------------------------------------------------------------------
 * Why a ShaderChunk patch, and why at module scope
 * ---------------------------------------------------------------------------
 * Every lit surface in the game that is not a bespoke ShaderMaterial is a
 * MeshStandardMaterial, spread across terrain, flora, architecture, actors and
 * props — five subsystems this one does not own. Shading policy that has to be
 * true of all of them belongs in one place, and three gives exactly one such
 * place. (The sky's cascade patch next door takes the same route for the same
 * reason.)
 *
 * The install runs when this module is evaluated, not from `init()`. A chunk is
 * read at program-*compile* time, and the boot sequence compiles programs from
 * inside several systems' `init()` — env synthesis, impostor bakes, the water
 * reflection views. Module evaluation is the only hook guaranteed to precede
 * all of them.
 */

/** Variance of the pixel reconstruction filter, in pixels squared. */
const SPEC_AA_SIGMA2 = 0.25;
/**
 * Ceiling on the kernel variance the filter may add, in alpha-squared units.
 * This is the silhouette guard: at a depth or normal discontinuity `dFdx` of the
 * normal is not measuring a slope distribution, it is measuring an edge, and
 * without a clamp a polished surface grows a matte outline one pixel wide.
 */
const SPEC_AA_KAPPA = 0.18;

const SPEC_AA_GLSL = /* glsl */ `
material.roughness = max( roughnessFactor, 0.0525 );
float geometryRoughness;
{
  // Screen-space variance of the SHADED normal — this is the line that makes
  // the difference from three's stock term, which measures the interpolated
  // vertex normal and is therefore blind to every normal map in the scene.
  vec3 specAAdx = dFdx( normal );
  vec3 specAAdy = dFdy( normal );
  float specAAvar = ${SPEC_AA_SIGMA2.toFixed(4)} * ( dot( specAAdx, specAAdx ) + dot( specAAdy, specAAdy ) );
  float specAAkernel = min( 2.0 * specAAvar, ${SPEC_AA_KAPPA.toFixed(4)} );
  float specAAalpha = material.roughness * material.roughness;
  float specAAfiltered = sqrt( clamp( specAAalpha + specAAkernel, 0.0, 1.0 ) );
  // Republished as three's own symbol so the clearcoat lobe further down the
  // chunk keeps getting widened by the same amount it always was.
  geometryRoughness = specAAfiltered - material.roughness;
  material.roughness = specAAfiltered;
}
material.roughness = min( material.roughness, 1.0 );
`;

let installed = false;

/**
 * Replace three's geometry-roughness term with variance-based NDF filtering.
 *
 * Idempotent, and located by anchors rather than by a verbatim stanza: three
 * ships these chunks as template literals in source and as whitespace-stripped
 * strings in the bundled build, so a needle that matches one silently fails
 * against the other. Anything unrecognised throws rather than leaving a half
 * patched chunk — a shading policy that fails open is worse than one that fails
 * loudly, because it fails open on somebody else's machine.
 */
export function installSpecularAA(): void {
  if (installed) return;

  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  const src = chunks.lights_physical_fragment;
  if (typeof src !== 'string') {
    throw new Error('specularAA: three lights_physical_fragment chunk is missing');
  }

  // The stanza to replace runs from the derivative of the non-perturbed normal
  // through the roughness clamp, inclusive. Both ends are located by a short
  // distinctive substring; the tail anchor is searched from the head so a later
  // `min( material.roughness, 1.0 )` (the clearcoat one) cannot be picked up.
  const HEAD = 'vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) )';
  const TAIL = 'material.roughness = min( material.roughness, 1.0 );';
  const from = src.indexOf(HEAD);
  const to = from < 0 ? -1 : src.indexOf(TAIL, from);
  if (from < 0 || to < 0) {
    throw new Error('specularAA: three lights_physical_fragment is not the shape this patch expects');
  }

  chunks.lights_physical_fragment =
    src.slice(0, from) + SPEC_AA_GLSL + src.slice(to + TAIL.length);
  installed = true;
}
