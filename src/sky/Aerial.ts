import * as THREE from 'three';
import { HAZE_GLSL } from './Haze';

/**
 * Shared aerial-perspective / height-fog chunk.
 *
 * Every distance-attenuated surface in the game (terrain, water, architecture,
 * flora) must include this and call applyAerial so that a rock at 400m and the
 * sky behind it agree on colour. The uniform objects returned by
 * `aerialUniforms()` are module singletons: the atmosphere system mutates them
 * once per frame and every consumer sees the change, with no per-material
 * bookkeeping.
 *
 * Usage from another subsystem:
 *
 *   material.onBeforeCompile = (shader) => {
 *     Object.assign(shader.uniforms, aerialUniforms());
 *     shader.fragmentShader = AERIAL_GLSL + shader.fragmentShader;
 *     // ...then call applyAerial(color, length(vViewPos), normalize(vWorldPos - cameraPosition))
 *   };
 *
 * `dist` is metres from the eye to the fragment; `viewDir` points FROM the eye
 * TOWARD the fragment and need not be normalised.
 */
export const AERIAL_GLSL = /* glsl */ `
#ifndef ASHLANDS_AERIAL
#define ASHLANDS_AERIAL
${HAZE_GLSL}

uniform vec3  uAerialSunDir;      // world-space, toward the sun
/**
 * Angular RADIUS of that source, radians: 0.0125 for the sun, Masser's 0.075 at
 * night. Every forward lobe below is widened by it (hazeSrcG), which is a no-op
 * for the sun and the difference between a moon reading as a body and as a
 * lantern. The fog and the dome MUST agree about this or the air either side of
 * the horizon line is two different atmospheres.
 */
uniform float uAerialSrcAng;
uniform vec3  uAerialSunColor;    // linear radiance reaching this altitude
uniform vec3  uAerialSkyColor;    // isotropic sky radiance, for multiple scattering
uniform vec3  uAerialBetaR;       // rayleigh scattering, per metre
uniform vec3  uAerialBetaMS;      // mie scattering, per metre (ash-tinted)
uniform vec3  uAerialBetaME;      // mie extinction, per metre
uniform vec3  uAerialBetaA;       // suspended-ash absorption, per metre
uniform vec3  uAerialScaleH;      // scale heights (rayleigh, mie, ash), metres
uniform float uAerialMieG;        // Henyey-Greenstein asymmetry
uniform float uAerialMieMul;      // weather-driven haze multiplier
uniform float uAerialCamY;        // eye altitude, metres above sea level
uniform vec3  uAerialHazeTint;    // albedo of the particulate layer's TOP
uniform vec3  uAerialHazeDeep;    // albedo of its dense base
uniform float uAerialHazeDensity; // extinction per metre at sea level
uniform float uAerialHazeH;       // scale height of the particulate layer
uniform vec2  uAerialHazeWind;    // advection of the storm's sheets
uniform float uAerialLightning;   // 0..1 flash energy, lights the whole medium
/**
 * The sky dome's own radiance as a function of direction, rendered by the sky
 * subsystem once per frame (see SkyViewPass). This is what distant geometry
 * converges on, so terrain at infinity and the sky it is silhouetted against are
 * the same number rather than two models that were tuned to nearly agree.
 */
uniform sampler2D uAerialSkyView;

const float AERIAL_PI = 3.141592653589793;

/** Matches SkyViewPass exactly: wrapping azimuth, sqrt-warped elevation. */
vec2 aerialSkyUV(vec3 v) {
  float az = atan(v.z, v.x) * 0.1591549431 + 0.5;
  float el = asin(clamp(v.y, -1.0, 1.0)) / 1.5707963268;
  return vec2(az, (sqrt(abs(el)) * sign(el)) * 0.5 + 0.5);
}

float aerialHG(float c, float g) { return hazeHG(c, g); }

// Analytic integral of exp(-h/H) along a straight segment. The small-slope
// branch avoids the 1/dy singularity for near-horizontal rays.
float aerialOD(float h0, float dy, float dist, float H) {
  return hazeOD(h0, dy, dist, H);
}

vec3 applyAerial(vec3 color, float dist, vec3 viewDir) {
  vec3 v = normalize(viewDir);
  dist = max(dist, 0.0);

  float odR = aerialOD(uAerialCamY, v.y, dist, uAerialScaleH.x);
  float odM = aerialOD(uAerialCamY, v.y, dist, uAerialScaleH.y) * uAerialMieMul;
  float odA = aerialOD(uAerialCamY, v.y, dist, uAerialScaleH.z) * uAerialMieMul;

  // Ash absorption is extinction only — it never appears in a source term below.
  // It is what makes a ridge at 2km lose its blue and lift toward the sulphur
  // band rather than fading toward a neutral grey, and it uses exactly the same
  // coefficients and scale height as the sky dome so the two can never disagree.
  float c = dot(v, uAerialSunDir);
  float pr = (3.0 / (16.0 * AERIAL_PI)) * (1.0 + c * c);
  // Identical dual-lobe Mie to the dome's: the narrow second lobe is the solar
  // aureole, and if the fog does not carry it the air immediately around the sun
  // reads as two different atmospheres either side of the horizon line.
  float pm = mix(aerialHG(c, hazeSrcG(uAerialMieG, uAerialSrcAng)),
                 aerialHG(c, hazeSrcG(0.94, uAerialSrcAng)), 0.22);

  vec3 sun = uAerialSunColor * (1.0 + uAerialLightning * 6.0);
  // uAerialSkyColor is hemispheric IRRADIANCE; the source term wants radiance.
  vec3 skyRad = uAerialSkyColor * (1.0 / AERIAL_PI);

  // The particulate layer is evaluated by exactly the chunk the sky dome uses,
  // over exactly this view ray, so aerial perspective and the sky it converges
  // on are the same physical quantity by construction rather than by two
  // hand-tuned colours that drift apart every time either is retuned.
  float odH;
  vec3 hazeL = hazeRadiance(uAerialHazeTint, uAerialHazeDeep, uAerialHazeDensity, uAerialHazeH,
                            uAerialCamY, v, dist, uAerialSunDir, uAerialSrcAng, sun, skyRad,
                            uAerialHazeWind, odH);

  vec3 ext = uAerialBetaR * odR + uAerialBetaME * odM + uAerialBetaA * odA + vec3(odH);
  vec3 T = exp(-ext);

  // Molecular and aerosol single scattering, plus an isotropic multiple-scatter
  // pedestal fed by the same sky radiance. Both are per-unit-optical-depth
  // sources, so the particulate joins them as odH * (its radiance).
  vec3 scat = (uAerialBetaR * odR * pr + uAerialBetaMS * odM * pm) * sun
            + (uAerialBetaR * odR + uAerialBetaMS * odM) * skyRad * 1.30
            + hazeL * odH;

  vec3 inscat = scat * (1.0 - T) / max(ext, vec3(1e-7));

  // Hand over to the dome as the path saturates.
  //
  // The local term is a good model of the first optical depth and a bad model of
  // the last: it has no ozone, no curvature, no LUT sun transmittance and no
  // higher scattering orders, so its asymptote is not the sky's. Left alone that
  // is a 21-level step in blue across the horizon line — the sky side and the
  // terrain side visibly evaluating two different functions, which the art bible
  // calls an instant fail. Weighting by (1 - T) per channel is exact at both
  // ends: at T=1 nothing has scattered and the local term is all there is; at
  // T=0 the surface is gone and the answer IS the sky in that direction. In
  // between it moves the fog's chroma toward the sky's rather than toward the
  // sun's, which is also what stops a 1.5km ridge sitting at 23% of the
  // luminance of the sky it is silhouetted against.
  // ...but the table is a function of DIRECTION ALONE, and below the horizon
  // that direction carries a path length the fragment does not have.
  //
  // The table's sub-horizon rows terminate on the ground: from a three-metre eye
  // a ray one degree down hits the surface at 150m, so those rows integrate 150m
  // of air and hand back near-nothing. A far shore at ten kilometres sits in
  // exactly that direction, and it was being told to converge on the airlight of
  // a 150m path. That is the whole of the dusk finding — a flat dark bar at
  // y 591-601 measuring (25,25,29) against sky (42,41,48) and sea (70,68,73),
  // i.e. distant land DARKER than both the sky and the water it lies between —
  // and it is the ridge frame's "grey-blue curtain with a hard upper edge" as
  // well. It looks exactly like extinction-only fog because the in-scatter it
  // converges on is, for those directions, genuinely almost zero.
  //
  // The airlight along a downward ray of length D differs from the airlight
  // along a LEVEL ray of length D only by the layer's vertical gradient over the
  // few hundred metres the ray descends, which is a percent or two. So the
  // handover samples the table at the horizon for anything below it. Continuous
  // by construction (the clamp is C0 and the table is smooth through the
  // horizon), so no band can exist at any elevation, and distant geometry below
  // the skyline now converges on the horizon sky it is silhouetted against
  // rather than on the ground under the eye.
  float rr = 6360000.0 + max(uAerialCamY, 0.0);
  float horizonMu = -sqrt(max(0.0, 1.0 - (6360000.0 * 6360000.0) / (rr * rr)));
  vec3 vSky = vec3(v.x, max(v.y, horizonMu), v.z);
  vec3 skyInf = texture(uAerialSkyView, aerialSkyUV(normalize(vSky))).rgb;
  vec3 fogged = mix(inscat, skyInf, clamp(vec3(1.0) - T, 0.0, 1.0));

  // Contrast floor. The medium is finite and the draw distance is not infinite,
  // so transmittance must not reach zero: at T = 0 a silhouette carries no
  // information at all and the far field is a flat card, which is what the
  // review measured on the emperor parasol (40 levels against the sky, merging
  // into the mountain behind it) and on the right-hand ridge. Remapping T into
  // [T_FLOOR, 1] and scaling the airlight by the complement is energy-conserving
  // — the sum of the two weights is still one at every depth — so this is a
  // floor on CONTRAST, not a brightness lift, and nothing at short range moves.
  const float T_FLOOR = 0.12;
  vec3 Tf = T_FLOOR + (1.0 - T_FLOOR) * T;
  vec3 aw = (1.0 - Tf) / max(1.0 - T, vec3(1e-4));

  return color * Tf + fogged * aw;
}

// Convenience for shaders that already have the eye-to-fragment vector.
vec3 applyAerial(vec3 color, vec3 eyeToFrag) {
  return applyAerial(color, length(eyeToFrag), eyeToFrag);
}
#endif
`;

/**
 * 1x1 mid-grey stand-in for the sky-view table, so that every consumer's shader
 * has a bound sampler from the moment it compiles. A null sampler binds the
 * driver's default texture, which on some drivers is undefined rather than
 * black, and the fog would then converge on garbage for the first frame.
 */
function placeholderSkyView(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([32, 30, 27, 255]), 1, 1);
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

const U: Record<string, THREE.IUniform> = {
  uAerialSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uAerialSrcAng: { value: 0.0125 },
  uAerialSunColor: { value: new THREE.Color(1, 1, 1) },
  uAerialSkyColor: { value: new THREE.Color(0.1, 0.14, 0.2) },
  uAerialBetaR: { value: new THREE.Vector3() },
  uAerialBetaMS: { value: new THREE.Vector3() },
  uAerialBetaME: { value: new THREE.Vector3() },
  uAerialBetaA: { value: new THREE.Vector3() },
  uAerialScaleH: { value: new THREE.Vector3(8000, 2600, 2800) },
  uAerialMieG: { value: 0.68 },
  uAerialMieMul: { value: 1 },
  uAerialCamY: { value: 0 },
  uAerialHazeTint: { value: new THREE.Color(0.55, 0.42, 0.26) },
  uAerialHazeDeep: { value: new THREE.Color(0.55, 0.42, 0.26) },
  uAerialHazeDensity: { value: 0.00004 },
  uAerialHazeH: { value: 420 },
  uAerialHazeWind: { value: new THREE.Vector2() },
  uAerialLightning: { value: 0 },
  uAerialSkyView: { value: placeholderSkyView() },
};

/**
 * The live uniform block. Returns the same objects every call — consumers must
 * spread these into their own uniform maps rather than cloning them.
 */
export function aerialUniforms(): Record<string, THREE.IUniform> {
  return U;
}
