/**
 * Adapter for the atmosphere subsystem's aerial-perspective chunk.
 *
 * The water pass has to apply exactly the same distance haze as the sky so the
 * sea and the land meet without a seam, but the two subsystems are authored
 * independently and only the *names* AERIAL_GLSL / aerialUniforms are contracted
 * — not the signature of the function inside. Rather than hard-code a guess that
 * fails to compile, the chunk is introspected: the first `vec3` function whose
 * name mentions "aerial" is bound, with its arguments matched by declared type
 * and name. If nothing matches, a local exponential haze stands in so the water
 * still grades to the horizon instead of rendering a hard edge.
 *
 * The call is parameterised on *distance and direction* rather than on a world
 * position. The sea is an infinite plane, so its far rings are drawn at a
 * compressed depth to stay inside the camera's far plane while the shading has
 * to integrate the real, uncompressed path — tens of kilometres at the horizon.
 * Passing the two separately is what lets the horizon saturate into the sky
 * instead of terminating wherever the tessellation happens to stop.
 */

export interface AerialBinding {
  /** GLSL to inject before use. Either the foreign chunk or the fallback. */
  glsl: string;
  /**
   * Builds the call expression. All arguments are GLSL expressions.
   * `dist` is metres from the eye; `dir` is a normalised vector pointing from
   * the eye toward the shaded point.
   */
  call(color: string, dist: string, dir: string, sunDir: string): string;
  /** False when the fallback is in use — worth logging once at boot. */
  foreign: boolean;
}

interface Param {
  type: string;
  name: string;
}

const FALLBACK_GLSL = /* glsl */ `
uniform vec3 wAerialTint;
uniform float wAerialDensity;

/**
 * Optical depth of an exponential haze layer along a straight ray, in metres of
 * sea-level path. Written as the closed-form integral rather than as
 * density * distance * exp(-something), because the sea asks this for paths of
 * hundreds of kilometres: the old form multiplied the density by a height fade
 * that underflowed to zero first, so a long upward ray came back *unhazed* and
 * the analytic sky the water reflects went black instead of saturating.
 */
float wAerialOD(float dy, float dist){
  const float H = 1200.0;
  float u = dy * dist / H;
  if (abs(u) < 1e-3) return dist;
  return (H / dy) * (1.0 - exp(-clamp(u, -60.0, 60.0)));
}

vec3 wAerialFallback(vec3 col, float dist, vec3 dir){
  float f = 1.0 - exp(-min(wAerialDensity * wAerialOD(dir.y, max(dist, 0.0)), 60.0));
  return mix(col, wAerialTint, wsat(f));
}
`;

function parseParams(sig: string): Param[] {
  const inner = sig.trim();
  if (inner === '' || inner === 'void') return [];
  return inner.split(',').map((raw) => {
    const parts = raw.trim().split(/\s+/).filter((p) => p !== 'in' && p !== 'const' && p !== 'highp' && p !== 'mediump' && p !== 'lowp');
    const type = parts[0] ?? 'float';
    const name = parts[parts.length - 1] ?? '';
    return { type, name };
  });
}

function argFor(p: Param, color: string, dist: string, dir: string, sunDir: string): string | null {
  const n = p.name.toLowerCase();
  if (p.type === 'vec3') {
    if (/col|rgb|radiance|lum|inscat|scene/.test(n)) return color;
    if (/sun|light|ldir/.test(n)) return sunDir;
    if (/cam|eye|origin|ro\b|viewpos/.test(n)) return 'cameraPosition';
    if (/dir|ray|rd\b|view/.test(n)) return `(${dir})`;
    // A world position has to be reconstructed from the ray: the drawn vertex
    // is not where the shading says it is out at the horizon.
    if (/world|pos|wp\b|p\b|point|frag/.test(n)) return `(cameraPosition + (${dir}) * (${dist}))`;
    return `(cameraPosition + (${dir}) * (${dist}))`;
  }
  if (p.type === 'float') return `(${dist})`;
  return null;
}

export function bindAerial(src: unknown): AerialBinding {
  const fallback: AerialBinding = {
    glsl: FALLBACK_GLSL,
    call: (color, dist, dir) => `wAerialFallback(${color}, ${dist}, ${dir})`,
    foreign: false,
  };

  if (typeof src !== 'string' || src.length === 0) return fallback;

  const decl = /\bvec3\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{/g;
  let best: { name: string; params: Param[] } | null = null;
  for (let m = decl.exec(src); m !== null; m = decl.exec(src)) {
    const name = m[1];
    if (!/aerial/i.test(name)) continue;
    const params = parseParams(m[2]);
    // Prefer the richest overload; it is the one that takes the scene colour.
    if (best === null || params.length > best.params.length) best = { name, params };
  }
  if (best === null) return fallback;

  const chosen = best;
  return {
    // texture2D/textureCube are defined by three for both dialects, but a chunk
    // authored against ES 1.00 may still call texture2DLod.
    glsl: src,
    call(color, dist, dir, sunDir) {
      const args: string[] = [];
      for (const p of chosen.params) {
        const a = argFor(p, color, dist, dir, sunDir);
        if (a === null) return color;
        args.push(a);
      }
      return `${chosen.name}(${args.join(', ')})`;
    },
    foreign: true,
  };
}
