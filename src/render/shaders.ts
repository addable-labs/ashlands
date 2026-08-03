import { GLSL_COMMON, GLSL_DEPTH, GLSL_OUT } from './gpu';
import { GLSL_LUT } from './grade';

/* ------------------------------------------------------------------ prepass */

/**
 * Depth/normal/velocity prepass. Built from three's own vertex chunks so that
 * instancing, skinning and morph targets all displace exactly the way the main
 * pass will — an override material that ignored them would desync the G-buffer
 * from the shaded image on every animated mesh in the scene.
 */
export const PREPASS_VERT = /* glsl */ `
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>

uniform mat4 uPrevModel;
uniform mat4 uCurrVP;
uniform mat4 uPrevVP;

out vec3 vViewNormal;
out float vViewDepth;
out vec4 vCurClip;
out vec4 vPrevClip;

void main() {
  #include <beginnormal_vertex>
  #include <morphinstance_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>

  vViewNormal = transformedNormal;
  vViewDepth = -mvPosition.z;

  vec4 objPos = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    objPos = instanceMatrix * objPos;
  #endif
  // Motion vectors are computed from the UNjittered matrices; folding the TAA
  // jitter into velocity would make the resolve chase its own tail.
  vCurClip = uCurrVP * (modelMatrix * objPos);
  vPrevClip = uPrevVP * (uPrevModel * objPos);
}
`;

export const PREPASS_FRAG = /* glsl */ `
precision highp float;
${GLSL_OUT}

in vec3 vViewNormal;
in float vViewDepth;
in vec4 vCurClip;
in vec4 vPrevClip;

layout(location = 1) out vec4 gVelocity;

void main() {
  vec3 n = normalize(vViewNormal);
  if (!gl_FrontFacing) n = -n;
  gl_FragColor = vec4(n, vViewDepth);

  vec2 cur = vCurClip.xy / max(abs(vCurClip.w), 1e-6) * sign(vCurClip.w);
  vec2 prv = vPrevClip.xy / max(abs(vPrevClip.w), 1e-6) * sign(vPrevClip.w);
  // Alpha is the coverage flag: the target clears to 0 so the resolve knows
  // which pixels are sky and must fall back to camera-only reprojection.
  gVelocity = vec4((cur - prv) * 0.5, 0.0, 1.0);
}
`;

/* ------------------------------------------------- half-res depth + normals */

export const HALFRES_FRAG = /* glsl */ `
precision highp float;
${GLSL_COMMON}
${GLSL_DEPTH}

uniform sampler2D tDepth;
uniform sampler2D tND;
uniform vec2 uTexelFull;
in vec2 vUv;

vec3 reconstructNormal(vec2 uv, vec3 P) {
  vec2 ex = vec2(uTexelFull.x, 0.0);
  vec2 ey = vec2(0.0, uTexelFull.y);
  vec3 l = viewPos(uv - ex, linearizeDepth(texture(tDepth, uv - ex).x));
  vec3 r = viewPos(uv + ex, linearizeDepth(texture(tDepth, uv + ex).x));
  vec3 d = viewPos(uv - ey, linearizeDepth(texture(tDepth, uv - ey).x));
  vec3 u = viewPos(uv + ey, linearizeDepth(texture(tDepth, uv + ey).x));
  // Pick the closer neighbour on each axis so silhouettes keep a sharp normal
  // instead of smearing across the depth discontinuity.
  vec3 dx = abs(l.z - P.z) < abs(r.z - P.z) ? (P - l) : (r - P);
  vec3 dy = abs(d.z - P.z) < abs(u.z - P.z) ? (P - d) : (u - P);
  vec3 n = normalize(cross(dx, dy));
  return dot(n, normalize(-P)) < 0.0 ? -n : n;
}

void main() {
  vec2 o = uTexelFull * 0.5;
  vec2 uvs[4];
  uvs[0] = vUv + vec2(-o.x, -o.y);
  uvs[1] = vUv + vec2(o.x, -o.y);
  uvs[2] = vUv + vec2(-o.x, o.y);
  uvs[3] = vUv + vec2(o.x, o.y);

  float best = 1e30;
  vec2 bu = vUv;
  for (int i = 0; i < 4; i++) {
    float d = linearizeDepth(texture(tDepth, uvs[i]).x);
    if (d < best) { best = d; bu = uvs[i]; }
  }

  // Prefer the prepass normal, but never *depend* on it. A pixel the prepass
  // missed — an opted-out mesh whose author has not supplied a prepass material
  // yet, a shader that failed to compile, an alpha object we deliberately hid —
  // used to read back as a flat camera-facing normal, which is exactly the
  // orientation that makes GTAO report full visibility. Whole surfaces would
  // silently lose their ambient occlusion. Falling back to a depth-derived
  // normal degrades to "slightly softer AO" instead of "no AO at all".
  vec3 n = vec3(0.0);
  #ifdef HAS_PREPASS
    vec4 nd = texture(tND, bu);
    if (dot(nd.xyz, nd.xyz) > 1e-5) n = normalize(nd.xyz);
  #endif
  if (dot(n, n) < 0.5) n = reconstructNormal(bu, viewPos(bu, best));

  gl_FragColor = vec4(n, best);
}
`;

/* ------------------------------------------------ GTAO + contact shadows */

export const AO_FRAG = /* glsl */ `
precision highp float;
${GLSL_COMMON}
${GLSL_DEPTH}

uniform sampler2D tHalf;
uniform sampler2D tNoise;
uniform vec2 uHalfSize;
uniform vec2 uNoiseScale;
uniform float uFrame;
uniform float uRadius;
uniform float uPower;
uniform float uProjScale;
uniform vec3 uSunView;
uniform float uCsLength;
uniform float uCsThickness;
/**
 * Minimum contact-trace length expressed in HALF-RES PIXELS.
 *
 * A world-space-only trace is a screen-space trace that shortens as the square
 * of nothing and the reciprocal of distance: at 200 m a 1.25 m ray subtends
 * about three half-res pixels, so every tap along it lands inside the same
 * texel as the shading point, reads the shading point's own depth, and reports
 * no occluder. That is why the contact buffer measured a flat 1.0 over the
 * whole midground on every canonical shot while working perfectly at the near
 * plane — and why "no object in the frame has ground contact" is the one
 * finding that survived every previous round.
 */
uniform float uCsMinPix;
in vec2 vUv;

vec2 projectUV(vec3 vp) {
  vec2 ndc = vec2(vp.x / (uTanHalf.x * max(-vp.z, 1e-4)), vp.y / (uTanHalf.y * max(-vp.z, 1e-4)));
  return (ndc + uJitterNdc) * 0.5 + 0.5;
}

void main() {
  vec4 c0 = texture(tHalf, vUv);
  float d0 = c0.w;
  if (d0 > uNearFar.y * 0.9) { gl_FragColor = vec4(1.0, 1.0, 0.0, 1.0); return; }

  vec3 P = viewPos(vUv, d0);
  vec3 N = normalize(c0.xyz);
  vec3 V = normalize(-P);

  vec3 nz = texture(tNoise, vUv * uNoiseScale).xyz;
  float aNoise = fract(nz.x + r2seq(uFrame));
  float sNoise = fract(nz.y + r2seq(uFrame * 1.6180339887));

  // Screen radius, hard-capped. The old ceiling of 110 half-res pixels (220 at
  // output resolution) meant that everything nearer than about seven metres met
  // the clamp instead of the projection, so the kernel stopped tracking depth
  // and became a *fixed screen-space* footprint — the signature the review
  // caught as "constant screen period on a receding slope". A 40 px cap keeps
  // the kernel local, keeps AO_DIRS x AO_STEPS taps a dense sampling of it
  // rather than a sparse lattice, and stops occlusion crossing whole hillsides.
  float radPix = clamp(uRadius * uProjScale / d0, 3.0, 40.0);
  vec2 radUV = vec2(radPix) / uHalfSize;
  // The world radius the clamp actually leaves us with, which near the camera is
  // a long way short of uRadius. The falloff has to be measured against the
  // distance the kernel can really reach: weighting a sample found 30 cm away as
  // if the kernel spanned 1.4 m means the attenuation term never engages, and
  // every horizon the search finds is taken at full strength.
  float worldRad = max(radPix * d0 / uProjScale, 1e-3);
  float r2max = worldRad * worldRad;
  // Never step closer than one half-res texel — below that the tap reads the
  // shading point's own depth and reports no horizon at all.
  float minFrac = min(1.0 / radPix, 0.5);

  float visibility = 0.0;
  for (int di = 0; di < AO_DIRS; di++) {
    float phi = (float(di) + aNoise) * PI / float(AO_DIRS);
    vec3 dirV = vec3(cos(phi), sin(phi), 0.0);
    vec2 dir2 = dirV.xy;

    vec3 ortho = dirV - dot(dirV, V) * V;
    vec3 axis = normalize(cross(ortho, V));
    vec3 projN = N - axis * dot(N, axis);
    float projLen = length(projN);
    if (projLen < 1e-4) continue;
    float cosN = clamp(dot(projN, V) / projLen, 0.0, 1.0);
    float n = sign(dot(ortho, projN)) * acos(cosN);

    float hc0 = -1.0;
    float hc1 = -1.0;
    for (int s = 0; s < AO_STEPS; s++) {
      // Quadratic step distribution: dense near the shading point where
      // contact darkening actually lives, sparse out at the radius.
      //
      // The floor used to be 1/AO_STEPS — a *fifth of the radius*. At the five
      // steps this tier runs, that put the nearest tap 20% of the way out and
      // collapsed the first three taps onto the same offset, so the kernel had a
      // blind disc around every shading point four half-res pixels across and
      // spent 60% of its samples re-reading its rim. That disc is exactly where
      // a stalk meets the ground, which is why the occlusion buffer measured
      // 0.97 at every contact in the frame while still resolving the underside
      // of a cap correctly: the only occluders it could see were the far ones.
      // The floor is now one texel, which is the real resolution limit.
      float t = (float(s) + sNoise) / float(AO_STEPS);
      vec2 off = dir2 * radUV * max(t * t, minFrac);

      vec2 uA = vUv + off;
      vec3 SA = viewPos(uA, texture(tHalf, uA).w) - P;
      float lA = dot(SA, SA);
      float fA = clamp(1.0 - lA / r2max, 0.0, 1.0);
      float cA = dot(SA, V) * inversesqrt(max(lA, 1e-8));
      hc1 = mix(hc1, max(hc1, cA), fA);

      vec2 uB = vUv - off;
      vec3 SB = viewPos(uB, texture(tHalf, uB).w) - P;
      float lB = dot(SB, SB);
      float fB = clamp(1.0 - lB / r2max, 0.0, 1.0);
      float cB = dot(SB, V) * inversesqrt(max(lB, 1e-8));
      hc0 = mix(hc0, max(hc0, cB), fB);
    }

    // Signed slice angles measured from V, positive toward +dir — the same
    // convention n is built with. Pairing them the other way round collapses
    // both horizons on grazing surfaces and blackens the whole ground plane.
    float h0 = -acos(clamp(hc0, -1.0, 1.0));
    float h1 = acos(clamp(hc1, -1.0, 1.0));
    h0 = n + max(h0 - n, -HALF_PI);
    h1 = n + min(h1 - n, HALF_PI);
    float sinN = sin(n);
    float arc0 = cosN + 2.0 * h0 * sinN - cos(2.0 * h0 - n);
    float arc1 = cosN + 2.0 * h1 * sinN - cos(2.0 * h1 - n);
    visibility += projLen * 0.25 * (arc0 + arc1);
  }
  visibility = clamp(visibility / float(AO_DIRS), 0.0, 1.0);
  float ao = pow(visibility, uPower);

  float cs = 1.0;
  #ifdef CONTACT_SHADOWS
  float facing = dot(N, uSunView);
  if (facing > 0.02 && uCsLength > 0.0) {
    // World metres per half-res pixel at this depth. uProjScale is
    // 0.5 * halfHeight / tan(fovY/2), so d0 / uProjScale is exactly that.
    float wpp = d0 / max(uProjScale, 1.0);
    // The ray must always be worth marching in SCREEN space, or the taps read
    // the shading point's own texel and the trace is a no-op. Near the camera
    // the world length wins and the term stays the sub-metre contact darkening
    // it is meant to be; past ~15 m the pixel floor takes over and it keeps
    // resolving a stalk against the ground it stands on.
    float traceLen = max(uCsLength, uCsMinPix * wpp);
    // Bias and thickness both scale WITH the trace instead of with absolute
    // depth. The old "0.015 + d0 * 0.0035" reached 0.35 m at 100 m — a third of
    // the whole ray — so past a hundred metres no occluder could ever clear it.
    // A fixed fraction of the step is what a depth-buffer trace actually needs:
    // it is the depth the ray itself advances between taps.
    float bias = max(0.012, 0.55 * traceLen / float(CS_STEPS) + 0.06 * traceLen * abs(uSunView.z));
    float thick = max(uCsThickness, 2.5 * traceLen);
    for (int i = 1; i <= CS_STEPS; i++) {
      float t = (float(i) - sNoise) / float(CS_STEPS);
      vec3 sp = P + uSunView * (traceLen * t);
      if (sp.z > -uNearFar.x) break;
      vec2 suv = projectUV(sp);
      if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
      float sceneD = texture(tHalf, suv).w;
      float diff = -sp.z - sceneD;
      if (diff > bias && diff < thick) {
        // Feather along the ray so the shadow dissolves at its FAR end. The
        // ramp used to run smoothstep(1.0, 0.55, t), which returns 1 for every
        // t below 0.55 — i.e. an occluder found in the first half of the trace,
        // which is exactly where a stalk meeting the ground lives, produced no
        // darkening at all, and only a hit at the very last step produced any.
        // The contact term was therefore off everywhere it mattered, which is
        // the "not one object has ground contact" finding on every single shot.
        // Correct sense: near hit -> 0 (occluded), far hit -> 1 (dissolved).
        cs = min(cs, smoothstep(0.55, 1.0, t));
      }
    }
    // Acne guard only. This used to be clamp(facing * 5.0), which halves the
    // contact term at NdotL 0.1 — i.e. at every grazing sun, which is every
    // hour the art direction cares about, and on top of a second NdotL factor
    // downstream in the composite. A trace that starts behind a depth bias
    // cannot self-shadow; all this has to do is fade out on surfaces so nearly
    // edge-on to the sun that the bias can no longer separate them.
    cs = mix(1.0, cs, smoothstep(0.0, 0.05, facing));
  }
  #endif

  gl_FragColor = vec4(ao, cs, 0.0, 1.0);
}
`;

export const AO_BLUR_FRAG = /* glsl */ `
precision highp float;
${GLSL_COMMON}

uniform sampler2D tAO;
uniform sampler2D tHalf;
uniform vec2 uDir;
uniform float uDepthSigma;
in vec2 vUv;

void main() {
  float d0 = texture(tHalf, vUv).w;
  vec2 acc = texture(tAO, vUv).rg * 0.383;
  float wsum = 0.383;
  const float W[3] = float[3](0.242, 0.061, 0.006);
  for (int i = 1; i <= 3; i++) {
    vec2 o = uDir * float(i) * 1.5;
    for (int s = 0; s < 2; s++) {
      vec2 uv = vUv + (s == 0 ? o : -o);
      float d = texture(tHalf, uv).w;
      // Depth-aware weight keeps the blur from bleeding occlusion across a
      // silhouette — the difference between a grounded rock and a grey halo.
      float w = W[i - 1] * exp(-abs(d - d0) * uDepthSigma);
      acc += texture(tAO, uv).rg * w;
      wsum += w;
    }
  }
  gl_FragColor = vec4(acc / max(wsum, 1e-4), 0.0, 1.0);
}
`;

/* ------------------------------------------------------------ volumetrics */

export const VOL_FRAG = /* glsl */ `
precision highp float;
${GLSL_COMMON}
${GLSL_DEPTH}

uniform sampler2D tHalf;
uniform sampler2D tNoise;
// three configures PCF shadow maps as hardware comparison textures; sampling
// one through a plain sampler2D is a type mismatch on WebGL2, so the sampler
// declaration has to follow whatever the sky system's shadow map actually is.
#ifdef SHADOW_COMPARE
uniform highp sampler2DShadow tShadow;
uniform highp sampler2DShadow tShadowFar;
#else
uniform sampler2D tShadow;
uniform sampler2D tShadowFar;
#endif
uniform mat4 uShadowMat;
uniform mat4 uShadowMatFar;
/** Per-cascade depth bias, each already in its own cascade's normalised depth. */
uniform vec2 uShadowBias;
/**
 * Blend band at a cascade's box wall, as a fraction of the box — so one number
 * is a different world width per cascade, which is what we want. The near
 * cascade uses it to cross-fade into the far one; the far one uses it to fade
 * out to "lit" at the edge of shadow coverage. Both ramps have to exist or the
 * march prints a light-space rectangle across the fog.
 */
uniform float uShadowBand;
uniform mat4 uInvView;
uniform vec2 uNoiseScale;
uniform float uFrame;
uniform vec3 uSunWorld;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
/** Isotropic multiple-scattering source radiance for the medium. */
uniform vec3 uMulti;
uniform float uDensity;
uniform float uHeightFalloff;
uniform float uBaseY;
uniform float uMaxDist;
uniform float uAniso;
/**
 * 0..1 — how much of this march's *bulk* in-scatter and extinction the sky
 * subsystem has already applied elsewhere, and must therefore be subtracted
 * from what this buffer publishes. 1 leaves the shadow residual only.
 */
uniform float uBulkRemove;
in vec2 vUv;

float hg(float c, float g) {
  float g2 = g * g;
  float denom = 1.0 + g2 - 2.0 * g * c;
  return (1.0 - g2) / (4.0 * PI * max(denom * sqrt(max(denom, 1e-5)), 1e-5));
}

vec2 projectUV(vec3 vp) {
  vec2 ndc = vec2(vp.x / (uTanHalf.x * max(-vp.z, 1e-4)), vp.y / (uTanHalf.y * max(-vp.z, 1e-4)));
  return (ndc + uJitterNdc) * 0.5 + 0.5;
}

// Two cascades, not one. The march runs out to ~700 m, which the near cascade
// cannot cover and the far cascade covers at metre-scale texels — so shafts get
// their definition from the near map where the eye is looking and their reach
// from the far one. A single map had to choose, and choosing "far" is what made
// every godray in the review build a soft wash with no occluder shape in it.
//
// How the two are combined is not a detail. An "if outside, use the other one"
// switches map, texel size and bias all at once along the near cascade's ortho
// box wall — a plane in light space — and the fog, being a smooth low-frequency
// term, renders that plane as a crisp axis-aligned rectangle sitting on top of
// the landscape. The weights below are the same authority ramp the lit pass
// uses, so the hand-off is a gradient tens of metres wide and the leftover
// weight past the far cascade fades to lit instead of snapping to it.

/** 1 well inside this cascade's box, ramping to 0 at the lateral wall. */
float cascadeAuthority(vec3 c, float band) {
  if (c.z < 0.0 || c.z > 1.0) return 0.0;
  vec2 d = min(c.xy, 1.0 - c.xy);
  return smoothstep(0.0, band, min(d.x, d.y));
}

float cascadeShadow(vec3 c, float bias, bool near) {
  #ifdef SHADOW_COMPARE
    return near ? texture(tShadow, vec3(c.xy, c.z - bias))
                : texture(tShadowFar, vec3(c.xy, c.z - bias));
  #else
    float d = near ? texture(tShadow, c.xy).x : texture(tShadowFar, c.xy).x;
    return c.z - bias <= d ? 1.0 : 0.0;
  #endif
}

float sunVisibility(vec3 wp, vec3 vp) {
  #ifdef HAS_SHADOWMAP
    vec4 sn = uShadowMat * vec4(wp, 1.0);
    vec3 cn = sn.xyz / max(sn.w, 1e-6);
    float wn = cascadeAuthority(cn, uShadowBand);
    float occ = wn > 0.0 ? wn * (1.0 - cascadeShadow(cn, uShadowBias.x, true)) : 0.0;

    float rem = 1.0 - wn;
    if (rem > 0.0) {
      vec4 sf = uShadowMatFar * vec4(wp, 1.0);
      vec3 cf = sf.xyz / max(sf.w, 1e-6);
      float wf = min(cascadeAuthority(cf, uShadowBand), rem);
      if (wf > 0.0) occ += wf * (1.0 - cascadeShadow(cf, uShadowBias.y, false));
    }
    // Any weight neither cascade claimed is unoccluded — the ramp above is what
    // keeps that from being a wall.
    return 1.0 - occ;
  #else
    // No usable sun shadow map: fall back to camera-depth occlusion, which
    // still carves shafts behind silhouettes but cannot see off-screen casters.
    vec2 suv = projectUV(vp);
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) return 1.0;
    return -vp.z > texture(tHalf, suv).w + 0.75 ? 0.0 : 1.0;
  #endif
}

void main() {
  float sceneD = texture(tHalf, vUv).w;
  vec3 ray = viewRay(vUv);
  float rayLen = length(ray);
  vec3 rd = ray / rayLen;
  vec3 rdW = normalize(mat3(uInvView) * rd);
  vec3 camPos = uInvView[3].xyz;

  float maxT = min(sceneD * rayLen, uMaxDist);
  float dt = maxT / float(VOL_STEPS);
  float jitter = fract(texture(tNoise, vUv * uNoiseScale).z + r2seq(uFrame));

  float phase = hg(dot(rdW, uSunWorld), uAniso);
  vec3 scat = vec3(0.0);
  // The same march with the sun unoccluded everywhere. This is the medium the
  // sky system's applyAerial has ALREADY put into every surface shader and into
  // the sky dome itself, so it is the part of this integral that must not be
  // added a second time. See uBulkRemove.
  vec3 open = vec3(0.0);
  float T = 1.0;

  for (int i = 0; i < VOL_STEPS; i++) {
    float t = (float(i) + jitter) * dt;
    vec3 vp = rd * t;
    vec3 wp = camPos + rdW * t;
    float dens = uDensity * exp(-max(wp.y - uBaseY, 0.0) / uHeightFalloff);
    if (dens < 1e-6) continue;
    float sh = sunVisibility(wp, vp);
    vec3 sun = uSunColor * (phase * 4.0 * PI);
    // Deliberately not named after the GLSL builtin it would otherwise shadow.
    vec3 seg = vec3(T * dens * dt);
    // uMulti is the isotropic multiple-scattering source. Single scattering
    // alone gives a dense medium a saturation radiance of sun * HG * 4pi, which
    // for a side-lit ash cloud is about a quarter of the sun's — so the moment
    // the extinction was applied honestly, an ashstorm stopped being a bright
    // wall of dust and became a dark grey one, 95th percentile 107/255 against
    // 205 before. A thick, high-albedo medium is bright precisely BECAUSE the
    // light in it has scattered many times; leaving that term out and then
    // compensating by not extinguishing properly is how the pass ended up
    // adding light it never removed. It is deliberately not shadow-modulated
    // (multiple scattering is what fills a shadow in), which also means it
    // cancels exactly out of the residual when uBulkRemove is 1.
    scat += seg * (sun * sh + uAmbient + uMulti);
    open += seg * (sun + uAmbient + uMulti);
    T *= exp(-dens * dt);
    if (T < 0.004) break;
  }

  // What this buffer is FOR is the spatial structure of sun visibility — the
  // shaft. The bulk in-scatter it also computes is a second, independent model
  // of the same atmosphere the sky subsystem integrates analytically in
  // applyAerial (Rayleigh + Mie + ash, per surface AND for the dome), and
  // adding it on top was double-counting the whole medium: measured, it was
  // contributing 40% of the ashstorm frame's luminance, pushing 3.1% of the
  // coast frame's red channel to 255 while blue stopped at 252 (a warm wash
  // laid over an already-bright sky, per channel), and flooding the night frame
  // with the moon's warm in-scatter — the fraction of night pixels with B > R
  // fell from 18% to 0.85% purely because of this pass.
  //
  // With uBulkRemove at 1 the residual is sun * (sh - 1), i.e. strictly
  // non-positive: the ambient term cancels exactly, and what is left is the
  // light the shadowed medium is MISSING relative to the open medium the sky
  // already drew. That is what a godray physically is once the bulk term is
  // accounted for elsewhere, and unlike an additive wash it raises contrast
  // rather than flattening it. The transmittance is faded out on the same knob,
  // because extinction and in-scattering belong to one medium and applying half
  // of a medium is what "milky" means.
  vec3 residual = scat - open * uBulkRemove;
  float Tout = mix(T, 1.0, uBulkRemove);
  gl_FragColor = vec4(residual, Tout);
}
`;

export const VOL_BLUR_FRAG = /* glsl */ `
precision highp float;
${GLSL_COMMON}

uniform sampler2D tVol;
uniform sampler2D tHalf;
uniform vec2 uDir;
uniform float uDepthSigma;
in vec2 vUv;

void main() {
  float d0 = texture(tHalf, vUv).w;
  vec4 acc = texture(tVol, vUv) * 0.4;
  float wsum = 0.4;
  const float W[3] = float[3](0.24, 0.09, 0.02);
  for (int i = 1; i <= 3; i++) {
    vec2 o = uDir * float(i);
    for (int s = 0; s < 2; s++) {
      vec2 uv = vUv + (s == 0 ? o : -o);
      float w = W[i - 1] * exp(-abs(texture(tHalf, uv).w - d0) * uDepthSigma);
      acc += texture(tVol, uv) * w;
      wsum += w;
    }
  }
  gl_FragColor = acc / max(wsum, 1e-4);
}
`;

/* -------------------------------------------------------------- composite */

export const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
${GLSL_COMMON}
${GLSL_DEPTH}

uniform sampler2D tScene;
uniform sampler2D tAO;
uniform sampler2D tVol;
uniform sampler2D tHalf;
uniform sampler2D tDepth;
uniform vec2 uHalfSize;
uniform vec2 uQuarterSize;
uniform float uAoStrength;
uniform float uAoFloor;
uniform float uCsStrength;
uniform float uCsFloor;
uniform float uVolStrength;
uniform float uVolFog;
uniform float uBilateralK;
uniform float uBilateralLegacy;
uniform vec3 uSunView;
in vec2 vUv;

/**
 * Joint bilateral upsample. The four low-res taps are weighted by both the
 * bilinear footprint and depth agreement with the full-res pixel, which is
 * what stops half-res AO and shafts from leaking one pixel past every edge.
 *
 * dTol is what makes it an upsample rather than a lottery, and it is the fix
 * for the "unresolved half-res comb column at the shoreline" this pass has
 * been reported for. The weight used to be bw / (1e-3 + |dz| * 4) on an
 * ABSOLUTE depth difference in metres, and there are two things wrong with
 * that:
 *
 *  - The reciprocal is unbounded. A tap whose depth agrees to a millimetre
 *    gets weight 1000; a tap 3m off gets 0.08. That is a ratio of 10^4, which
 *    is not a blend — it is a hard nearest-depth *selection*, and which tap
 *    wins is decided by fract(uv * size), i.e. by screen position modulo 2
 *    for the half-res buffer and modulo 4 for the quarter-res one. A selection
 *    driven by a screen-periodic index IS a comb, drawn in whatever the buffer
 *    contains, locked to the screen while the world slides underneath it.
 *  - A fixed tolerance in metres is meaningless across a scene that spans a
 *    metre to a kilometre. tHalf.w is a MIN over a 2x2 block, so even on a
 *    perfectly flat surface it sits nearer than the full-res centre by roughly
 *    one pixel of slope — negligible at the near plane and several metres on a
 *    beach seen edge-on at four hundred. Exactly the shoreline that was
 *    reported.
 *
 * So: an exponential falloff (bounded, and degrading gracefully to plain
 * bilinear when every tap disagrees equally, instead of amplifying whichever
 * disagreed least) over a tolerance that scales with distance AND with the
 * local depth gradient. fwidth(dFull) is precisely "how much should two
 * adjacent pixels differ here", so a grazing plane and a silhouette are told
 * apart by the thing that actually distinguishes them.
 */
vec4 upsample(sampler2D tex, vec2 uv, vec2 size, float dFull, float dTol) {
  vec2 hp = uv * size - 0.5;
  vec2 f = fract(hp);
  vec2 base = (floor(hp) + 0.5) / size;
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(float(i & 1), float(i >> 1));
    vec2 suv = base + o / size;
    float bw = mix(1.0 - f.x, f.x, o.x) * mix(1.0 - f.y, f.y, o.y);
    float dz = abs(texture(tHalf, suv).w - dFull);
    // uBilateralLegacy restores the previous unbounded reciprocal weight. It
    // exists so the two can be captured back to back from one scene state and
    // the phase measurement attributed to the upsample rather than to whatever
    // else moved between two runs; see tools/phase.mjs.
    float w = uBilateralLegacy > 0.5
      ? bw / (1e-3 + dz * 4.0)
      : bw * exp(-dz / dTol);
    acc += texture(tex, suv) * w;
    wsum += w;
  }
  return acc / max(wsum, 1e-5);
}

// Jimenez's multi-bounce fit. Using the shaded colour as an albedo proxy keeps
// AO from turning saturated ochre rock into flat mud.
vec3 multiBounce(float ao, vec3 albedo) {
  vec3 a = 2.0404 * albedo - 0.3324;
  vec3 b = -4.7951 * albedo + 0.6417;
  vec3 c = 2.7552 * albedo + 0.6903;
  return clamp(max(vec3(ao), ((ao * a + b) * ao + c) * ao), 0.0, 1.0);
}

void main() {
  vec3 scene0 = texture(tScene, vUv).rgb;
  vec3 col = scene0;
  float dFull = linearizeDepth(texture(tDepth, vUv).x);
  // Two grids, not one. The occlusion buffer is half res and the volumetric
  // buffer is quarter res; walking both with the half-res footprint meant every
  // fog tap landed two quarter-texels apart with bilateral weights taken from
  // depths that belonged to neither, so in-scattering leaked across silhouettes
  // the depth-aware upsample exists to protect.
  // Depth tolerance for the bilateral taps: a fraction of the distance (the
  // perspective term — a metre at the near plane and a metre at eight hundred
  // are not the same disagreement) plus the local per-pixel depth gradient,
  // which is what separates "this surface is steeply raked" from "there is an
  // edge here". Both are needed; either alone misclassifies half the frame.
  float dTol = uBilateralK * (0.02 * dFull + abs(dFdx(dFull)) + abs(dFdy(dFull))) + 1e-3;
  vec4 ao = upsample(tAO, vUv, uHalfSize, dFull, dTol);
  // The quarter-res buffer's taps are twice as far apart, so they are entitled
  // to twice the depth disagreement before one of them is an edge.
  vec4 vol = upsample(tVol, vUv, uQuarterSize, dFull, dTol * 2.0);

  vec3 N = normalize(texture(tHalf, vUv).xyz + vec3(1e-6));
  float facing = clamp(dot(N, uSunView), 0.0, 1.0);

  #ifdef USE_AO
    vec3 alb = clamp(col / max(luma(col) + 0.35, 0.35), 0.0, 1.0);
    // Floored. Ambient occlusion attenuates *indirect* light; it is not a licence
    // to take a pixel to zero, and letting it do so is half of why the review
    // measured ground darker than the darkest legal ash value. The floor is the
    // fraction of the hemisphere a fully-occluded surface still sees in practice.
    vec3 occ = max(multiBounce(ao.r, alb), vec3(uAoFloor));
    // "Indirect only", as far as a single composited buffer can express it: a
    // surface square-on to the key is mostly direct light and must not be
    // occluded by an ambient term, while a surface turned away from it is
    // essentially all sky and takes the full occlusion. Without this the AO
    // strength has to be dialled down globally to stop it eating the key, and
    // that is what left creases and stalk bases reading flat.
    float aoW = uAoStrength * mix(1.0, 0.55, facing);
    col *= mix(vec3(1.0), occ, aoW);
  #endif

  #ifdef CONTACT_SHADOWS
    // Same argument for the contact term: a shadowed surface is lit by the sky,
    // so the deepest a screen-space occluder may take it is the ambient level.
    //
    // The weight is a *gate* on facing, not a scale by it. Scaling by NdotL is
    // double-dipping — the lit pass has already multiplied the direct term by
    // NdotL — and it fails hardest exactly where the art direction lives: at a
    // 6-degree dawn sun, flat ground has NdotL ~0.1, so a fully occluded pixel
    // came out 0.75 * 0.1 * 0.85 = six percent darker than open ground and every
    // reviewer on every shot correctly reported no ground contact anywhere. The
    // fraction of a pixel's light that is direct is not NdotL, it is
    // NdotL * E_sun / (NdotL * E_sun + sky), which saturates far faster; the
    // smoothstep is that saturation, and uCsFloor is the sky term it leaves.
    col *= mix(1.0, max(ao.g, uCsFloor), uCsStrength * smoothstep(0.0, 0.22, facing));
  #endif

  #ifdef USE_VOLUMETRICS
    // Extinction and in-scattering are one medium and get ONE weight. They used
    // to have two (0.3 on the transmittance, 0.8 on the in-scatter), which is
    // not a partial medium, it is light added without the matching light
    // removed — a monotonic lift of the whole frame that raises the black
    // floor, compresses every value toward the fog colour and cannot help but
    // read as milk. mix(1.0, vol.a, k) with the in-scatter on the same k is
    // the same medium at strength k, and is energy-consistent at every k.
    //
    // The in-scatter is no longer clamped to positive. With the bulk term
    // removed upstream (see uBulkRemove in VOL_FRAG) the residual is the light
    // the shadowed medium is missing, which is negative by construction — a
    // max() here would have thrown away the entire godray and kept nothing.
    col = col * mix(1.0, vol.a, uVolFog) + vol.rgb * uVolStrength;
    // A shaft may carve a value down, never out. This march models the medium
    // with a single forward-scattering HG lobe; the sky's analytic model does
    // not, so the two disagree on the absolute magnitude of the in-scatter the
    // residual is subtracting from. The floor is what keeps that disagreement
    // from ever printing a hole: a shaft may take a pixel to 40% of its lit
    // value and no further. Fog is lit by the sky even where it is lit by
    // nothing else.
    col = max(col, scene0 * 0.40);
  #endif

  gl_FragColor = vec4(col, 1.0);
}
`;

/* --------------------------------------------------------------------- TAA */

export const TAA_FRAG = /* glsl */ `
precision highp float;
${GLSL_COMMON}
${GLSL_DEPTH}

uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform sampler2D tVel;
uniform sampler2D tDepth;
uniform mat4 uPrevVP;
uniform mat4 uInvVP;
uniform vec2 uTexel;
uniform vec2 uSize;
uniform float uFeedback;
uniform float uReset;
uniform float uFireflyClamp;
in vec2 vUv;

vec3 catmullRom(sampler2D tex, vec2 uv) {
  vec2 sp = uv * uSize;
  vec2 tp1 = floor(sp - 0.5) + 0.5;
  vec2 f = sp - tp1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 o12 = w2 / w12;
  vec2 p0 = (tp1 - 1.0) * uTexel;
  vec2 p3 = (tp1 + 2.0) * uTexel;
  vec2 p12 = (tp1 + o12) * uTexel;
  vec3 r = vec3(0.0);
  r += texture(tex, vec2(p12.x, p0.y)).rgb * (w12.x * w0.y);
  r += texture(tex, vec2(p0.x, p12.y)).rgb * (w0.x * w12.y);
  r += texture(tex, vec2(p12.x, p12.y)).rgb * (w12.x * w12.y);
  r += texture(tex, vec2(p3.x, p12.y)).rgb * (w3.x * w12.y);
  r += texture(tex, vec2(p12.x, p3.y)).rgb * (w12.x * w3.y);
  return max(r, vec3(0.0));
}

void main() {
  // Depth dilation: reproject using the closest of a 5-tap cross so thin
  // silhouettes drag their own motion vector instead of the background's.
  vec2 dilUv = vUv;
  float best = 1.0;
  for (int i = 0; i < 5; i++) {
    vec2 o = i == 0 ? vec2(0.0) : vec2(i == 1 || i == 3 ? -1.0 : 1.0, i < 3 ? -1.0 : 1.0);
    vec2 uv = vUv + o * uTexel;
    float d = texture(tDepth, uv).x;
    if (d < best) { best = d; dilUv = uv; }
  }

  // A null sampler binds three's empty texture, which samples as (0,0,0,1) —
  // an alpha of 1 would masquerade as valid coverage and pin velocity to zero,
  // silently killing reprojection. Gate the fetch on the define instead.
  #ifdef HAS_VELOCITY
    vec4 velRaw = texture(tVel, dilUv);
  #else
    vec4 velRaw = vec4(0.0);
  #endif
  vec2 vel;
  if (velRaw.a > 0.5) {
    vel = velRaw.xy;
  } else {
    // Sky and anything the prepass missed: camera-only reprojection through
    // the depth buffer, which is exact for static geometry.
    //
    // Unproject with the UNJITTERED inverse view-projection, not the jittered
    // one. The history buffer is the accumulated, pixel-centre-referenced
    // image, so the vector we want is the motion of the pixel-centre ray —
    // which is what the prepass velocity buffer (built from unjittered clip
    // positions on both ends) already reports. Feeding the jittered inverse in
    // here made the two paths disagree by exactly the jitter offset, so every
    // surface without prepass coverage had its history resampled a fraction of
    // a pixel away every frame, along whatever direction the Halton sequence
    // had wandered to. That is the fixed-screen-direction streak field the
    // review measured across near slope, valley and far ridge alike, and it is
    // also why the accumulation never converged into an antialiased edge.
    vec4 wp = uInvVP * vec4(vUv * 2.0 - 1.0, best * 2.0 - 1.0, 1.0);
    wp /= wp.w;
    vec4 pc = uPrevVP * wp;
    vel = vUv - ((pc.xy / pc.w) * 0.5 + 0.5);
  }

  vec2 histUv = vUv - vel;
  vec3 cur = max(texture(tCurrent, vUv).rgb, vec3(0.0));

  // Neighbourhood statistics in YCoCg — clipping in a luma/chroma basis is
  // far less prone to hue shimmer than clamping RGB independently.
  vec3 m1 = vec3(0.0), m2 = vec3(0.0);
  vec3 nmin = vec3(1e9), nmax = vec3(-1e9);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec3 s = rgb2ycocg(max(texture(tCurrent, vUv + vec2(float(x), float(y)) * uTexel).rgb, vec3(0.0)));
      m1 += s; m2 += s * s;
      nmin = min(nmin, s); nmax = max(nmax, s);
    }
  }
  m1 /= 9.0; m2 /= 9.0;

  // Firefly clamp, before anything else touches the current sample. A specular
  // highlight on a mipped normal map lands as a single pixel several times
  // brighter than its neighbours; the temporal filter cannot integrate that
  // away, it just makes it crawl. Limiting a pixel to a small multiple of its
  // own 3x3 mean is energy-preserving enough to be invisible on real
  // highlights (which are never one pixel wide) and removes the speckle.
  float curY = rgb2ycocg(cur).x;
  float maxY = m1.x * uFireflyClamp + 0.02;
  if (curY > maxY) cur *= maxY / max(curY, 1e-5);

  bool valid = histUv.x > 0.0 && histUv.x < 1.0 && histUv.y > 0.0 && histUv.y < 1.0 && uReset < 0.5;
  if (!valid) { gl_FragColor = vec4(cur, 1.0); return; }

  vec3 sigma = sqrt(max(m2 - m1 * m1, vec3(0.0)));
  vec3 lo = max(m1 - 1.25 * sigma, nmin);
  vec3 hi = min(m1 + 1.25 * sigma, nmax);

  vec3 hist = rgb2ycocg(catmullRom(tHistory, histUv));
  vec3 clipped = clamp(hist, lo, hi);
  float disocclusion = length(hist - clipped) / max(length(sigma) + 0.02, 0.02);
  hist = clipped;

  vec3 histRgb = max(ycocg2rgb(hist), vec3(0.0));

  float velPix = length(vel * uSize);
  float fb = uFeedback;
  fb = mix(fb, 0.74, clamp(velPix / 28.0, 0.0, 1.0));
  fb *= 1.0 - clamp(disocclusion * 0.55, 0.0, 0.7);

  // Tonemapped-space blend suppresses fireflies without the energy loss of
  // clamping the HDR signal outright.
  float wc = 1.0 / (1.0 + luma(cur));
  float wh = 1.0 / (1.0 + luma(histRgb));
  vec3 outC = (cur * wc * (1.0 - fb) + histRgb * wh * fb) / max(wc * (1.0 - fb) + wh * fb, 1e-5);

  gl_FragColor = vec4(outC, 1.0);
}
`;

/* ------------------------------------------------------------- motion blur */

export const MBLUR_FRAG = /* glsl */ `
precision highp float;
${GLSL_COMMON}
${GLSL_DEPTH}

uniform sampler2D tColor;
uniform sampler2D tVel;
uniform sampler2D tDepth;
uniform mat4 uPrevVP;
uniform mat4 uInvVP;
uniform vec2 uTexel;
uniform vec2 uSize;
uniform float uShutter;
uniform float uMaxRadius;
uniform float uFrame;
in vec2 vUv;

void main() {
  #ifdef HAS_VELOCITY
    vec4 velRaw = texture(tVel, vUv);
  #else
    vec4 velRaw = vec4(0.0);
  #endif
  float d = texture(tDepth, vUv).x;
  vec2 vel;
  if (velRaw.a > 0.5) {
    vel = velRaw.xy;
  } else {
    vec4 wp = uInvVP * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    wp /= wp.w;
    vec4 pc = uPrevVP * wp;
    vel = vUv - ((pc.xy / pc.w) * 0.5 + 0.5);
  }
  vel *= uShutter;

  float px = length(vel * uSize);
  if (px < 0.6) { gl_FragColor = texture(tColor, vUv); return; }
  vel *= min(uMaxRadius / px, 1.0);

  float z0 = linearizeDepth(d);
  float jitter = ign(gl_FragCoord.xy + uFrame * 7.0) - 0.5;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < MB_SAMPLES; i++) {
    float t = (float(i) + 0.5 + jitter) / float(MB_SAMPLES) - 0.5;
    vec2 uv = vUv - vel * t;
    float zi = linearizeDepth(texture(tDepth, uv).x);
    // Reject taps far behind the centre so background does not smear over a
    // sharp foreground silhouette.
    float w = 1.0 - clamp((zi - z0) / max(z0 * 0.25, 0.5) - 1.0, 0.0, 1.0) * 0.85;
    acc += texture(tColor, uv).rgb * w;
    wsum += w;
  }
  gl_FragColor = vec4(acc / max(wsum, 1e-4), 1.0);
}
`;

/* -------------------------------------------------------- depth of field */

const GLSL_COC = /* glsl */ `
uniform float uFocalLen;
uniform float uFStop;
uniform float uFocusDist;
uniform float uCocScale;
uniform float uMaxCoc;
uniform float uCocMin;

/**
 * Thin-lens circle of confusion, signed, in full-res pixels; negative means in
 * front of the focal plane. uFocalLen is derived from the render FOV and
 * uCocScale is pixels per metre of sensor, so this is a real camera and not a
 * depth-remapped blur ramp: stopping down widens the depth of field exactly the
 * way an f-number should, and everything past the hyperfocal distance resolves
 * to a sub-pixel circle on its own.
 *
 * The deadband is the part that matters for gameplay. A CoC of half a pixel is
 * not defocus, it is rounding — but fed to the gather it still drags a
 * low-opacity near-field blur over the whole frame, which is what made the
 * default look permanently veiled. Below uCocMin the circle ramps smoothly to
 * exactly zero, so the composite becomes a pass-through instead of a soft mix.
 */
float cocPixels(float d) {
  float A = uFocalLen / max(uFStop, 0.4);
  float c = A * uFocalLen * (d - uFocusDist) / max(d * (uFocusDist - uFocalLen), 1e-5);
  float px = clamp(c * uCocScale, -uMaxCoc, uMaxCoc);
  return px * smoothstep(uCocMin, uCocMin * 2.0, abs(px));
}
`;

export const DOF_COC_FRAG = /* glsl */ `
precision highp float;
${GLSL_COMMON}
${GLSL_DEPTH}
${GLSL_COC}

uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexelFull;
in vec2 vUv;

void main() {
  vec2 o = uTexelFull * 0.5;
  vec3 col = vec3(0.0);
  float wsum = 0.0;
  float coc = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 uv = vUv + vec2(i == 0 || i == 2 ? -o.x : o.x, i < 2 ? -o.y : o.y);
    vec3 c = texture(tColor, uv).rgb;
    // Karis weighting: one blown pixel must not dominate the bokeh disc.
    float w = 1.0 / (1.0 + luma(c));
    col += c * w;
    wsum += w;
    float ci = cocPixels(linearizeDepth(texture(tDepth, uv).x));
    if (abs(ci) > abs(coc)) coc = ci;
  }
  gl_FragColor = vec4(col / max(wsum, 1e-4), coc / uMaxCoc);
}
`;

export const DOF_GATHER_FRAG = /* glsl */ `
precision highp float;
${GLSL_COMMON}

uniform sampler2D tIn;
uniform vec2 uHalfSize;
uniform float uMaxCoc;
uniform float uFrame;
in vec2 vUv;

layout(location = 1) out vec4 gNear;

// Regular hexagon of unit circumradius — the aperture blade count reads as a
// six-sided bokeh on specular highlights without a separate blur direction.
float hexRadius(float a) {
  float k = PI / 3.0;
  return 0.8660254 / cos(mod(a, k) - k * 0.5);
}

void main() {
  vec2 texel = 1.0 / uHalfSize;
  float maxR = uMaxCoc * 0.5;
  float a0 = (ign(gl_FragCoord.xy) + r2seq(uFrame)) * 6.2831853;

  vec4 farAcc = vec4(0.0);
  vec4 nearAcc = vec4(0.0);
  for (int i = 0; i < DOF_TAPS; i++) {
    float fi = float(i);
    float r = sqrt((fi + 0.5) / float(DOF_TAPS));
    float a = fi * 2.39996323 + a0;
    float rr = r * hexRadius(a);
    vec2 off = vec2(cos(a), sin(a)) * rr * maxR;
    vec4 s = texture(tIn, vUv + off * texel);
    float sc = s.a * maxR;
    float dist = rr * maxR;
    float cover = clamp(abs(sc) - dist + 1.0, 0.0, 1.0);
    // Strict signs. step(0.0, sc) and step(sc, 0.0) both return 1 at sc == 0,
    // so a perfectly focused pixel used to land in the NEAR bucket and bleed a
    // permanent low-alpha blur into the composite. In focus belongs to neither.
    farAcc += vec4(s.rgb, 1.0) * (cover * step(1e-4, sc));
    nearAcc += vec4(s.rgb, 1.0) * (cover * step(sc, -1e-4));
  }

  vec4 centre = texture(tIn, vUv);
  gl_FragColor = vec4(farAcc.a > 1e-4 ? farAcc.rgb / farAcc.a : centre.rgb, 1.0);
  gNear = vec4(
    nearAcc.a > 1e-4 ? nearAcc.rgb / nearAcc.a : centre.rgb,
    clamp(nearAcc.a / (float(DOF_TAPS) * 0.32), 0.0, 1.0));
}
`;

export const DOF_COMPOSITE_FRAG = /* glsl */ `
precision highp float;
${GLSL_COMMON}
${GLSL_DEPTH}
${GLSL_COC}

uniform sampler2D tColor;
uniform sampler2D tFar;
uniform sampler2D tNear;
uniform sampler2D tDepth;
in vec2 vUv;

void main() {
  vec3 sharp = texture(tColor, vUv).rgb;
  float coc = cocPixels(linearizeDepth(texture(tDepth, vUv).x));
  float farW = smoothstep(0.8, 2.6, coc);
  vec3 col = mix(sharp, texture(tFar, vUv).rgb, farW);
  vec4 near = texture(tNear, vUv);
  col = mix(col, near.rgb, near.a);
  gl_FragColor = vec4(col, 1.0);
}
`;

/* ------------------------------------------------------------------- bloom */

const GLSL_DOWN13 = /* glsl */ `
// 13-tap "next generation post" downsample: four overlapping boxes plus a
// centre box, which is stable under motion where a naive 2x2 aliases badly.
vec3 down13(sampler2D t, vec2 uv, vec2 texel, bool karis) {
  vec3 a = texture(t, uv + texel * vec2(-2.0, 2.0)).rgb;
  vec3 b = texture(t, uv + texel * vec2(0.0, 2.0)).rgb;
  vec3 c = texture(t, uv + texel * vec2(2.0, 2.0)).rgb;
  vec3 d = texture(t, uv + texel * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture(t, uv).rgb;
  vec3 f = texture(t, uv + texel * vec2(2.0, 0.0)).rgb;
  vec3 g = texture(t, uv + texel * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture(t, uv + texel * vec2(0.0, -2.0)).rgb;
  vec3 i = texture(t, uv + texel * vec2(2.0, -2.0)).rgb;
  vec3 j = texture(t, uv + texel * vec2(-1.0, 1.0)).rgb;
  vec3 k = texture(t, uv + texel * vec2(1.0, 1.0)).rgb;
  vec3 l = texture(t, uv + texel * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture(t, uv + texel * vec2(1.0, -1.0)).rgb;

  vec3 g0 = (j + k + l + m) * 0.25;
  vec3 g1 = (a + b + d + e) * 0.25;
  vec3 g2 = (b + c + e + f) * 0.25;
  vec3 g3 = (d + e + g + h) * 0.25;
  vec3 g4 = (e + f + h + i) * 0.25;

  if (karis) {
    float w0 = 0.5 / (1.0 + luma(g0));
    float w1 = 0.125 / (1.0 + luma(g1));
    float w2 = 0.125 / (1.0 + luma(g2));
    float w3 = 0.125 / (1.0 + luma(g3));
    float w4 = 0.125 / (1.0 + luma(g4));
    float ws = w0 + w1 + w2 + w3 + w4;
    return (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / ws;
  }
  return g0 * 0.5 + (g1 + g2 + g3 + g4) * 0.125;
}
`;

export const BLOOM_DOWN_FRAG = /* glsl */ `
precision highp float;
${GLSL_COMMON}
${GLSL_DOWN13}

uniform sampler2D tSrc;
uniform sampler2D tExposure;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
uniform float uClamp;
in vec2 vUv;

void main() {
  #ifdef PREFILTER
    // Prefilter in EXPOSED units. With a metered exposure the same scene can be
    // rendered five stops apart, and a threshold in raw scene radiance would
    // bloom the entire frame at one end and nothing at all at the other.
    vec3 c = down13(tSrc, vUv, uTexel, true) * texture(tExposure, vec2(0.5)).x;
    c = min(c, vec3(uClamp));
    // Quadratic soft knee: no hard ring where the threshold bites, so highlight
    // rolloff stays continuous as the sun crosses a mushroom cap.
    float br = max(c.r, max(c.g, c.b));
    float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    rq = rq * rq / (4.0 * uKnee + 1e-5);
    c *= max(rq, br - uThreshold) / max(br, 1e-5);
    gl_FragColor = vec4(max(c, vec3(0.0)), 1.0);
  #else
    gl_FragColor = vec4(down13(tSrc, vUv, uTexel, false), 1.0);
  #endif
}
`;

export const BLOOM_UP_FRAG = /* glsl */ `
precision highp float;
${GLSL_COMMON}

uniform sampler2D tSmall;
uniform sampler2D tBig;
uniform vec2 uTexel;
uniform float uRadius;
in vec2 vUv;

void main() {
  vec2 o = uTexel * uRadius;
  vec3 s = texture(tSmall, vUv + vec2(-o.x, o.y)).rgb
         + texture(tSmall, vUv + vec2(0.0, o.y)).rgb * 2.0
         + texture(tSmall, vUv + vec2(o.x, o.y)).rgb
         + texture(tSmall, vUv + vec2(-o.x, 0.0)).rgb * 2.0
         + texture(tSmall, vUv).rgb * 4.0
         + texture(tSmall, vUv + vec2(o.x, 0.0)).rgb * 2.0
         + texture(tSmall, vUv + vec2(-o.x, -o.y)).rgb
         + texture(tSmall, vUv + vec2(0.0, -o.y)).rgb * 2.0
         + texture(tSmall, vUv + vec2(o.x, -o.y)).rgb;
  s *= 0.0625;
  // Equal-weight blend rather than accumulation: total energy across the chain
  // stays 1, so bloom intensity means the same thing at every quality tier.
  gl_FragColor = vec4(mix(texture(tBig, vUv).rgb, s, 0.5), 1.0);
}
`;

/* -------------------------------------------------- metering / auto-exposure */

/**
 * Stage one of the exposure meter: a coarse tile grid over the resolved HDR
 * frame, each texel holding (sum of w*log2(L), sum of w) for its tile.
 *
 * The weighting is the whole point. Metering the frame mean is what starved
 * every dark shot in the review: in an exterior vista the sky owns most of the
 * histogram but is never the subject, so a mean-metered exposure resolves the
 * sky correctly and leaves the ground — the thing the shot is about — five stops
 * under. Weight collapses toward the top of the frame and rises across the lower
 * two thirds, with a mild centre bias on top, so the meter keys off ground
 * midtones the way a photographer would.
 */
/**
 * AgX and the sRGB encode, shared.
 *
 * These were private to the uber pass, and they are shared now because the
 * exposure pass has to answer one question the uber pass would otherwise have
 * to answer per pixel: given this frame's metered exposure, what display value
 * does the scene's own mean land on? That number is the anchor for the frame's
 * black point (see EXPOSURE_FRAG), it is constant across the frame, and
 * evaluating a tonemapper two million times to compute a constant is not a
 * thing to do at 60fps. It costs one evaluation per frame in a 1x1 target.
 */
export const GLSL_AGX = /* glsl */ `
const mat3 SRGB_TO_REC2020 = mat3(
  0.6274, 0.0691, 0.0164,
  0.3293, 0.9195, 0.0880,
  0.0433, 0.0113, 0.8956);
const mat3 REC2020_TO_SRGB = mat3(
  1.6605, -0.1246, -0.0182,
  -0.5876, 1.1329, -0.1006,
  -0.0728, -0.0083, 1.1187);
const mat3 AGX_INSET = mat3(
  0.856627153315983, 0.137318972929847, 0.11189821299995,
  0.0951212405381588, 0.761241990602591, 0.0767994186031903,
  0.0482516061458583, 0.101439036467562, 0.811302368396859);
const mat3 AGX_OUTSET = mat3(
  1.1271005818144368, -0.1413297634984383, -0.14132976349843826,
  -0.11060664309660323, 1.157823702216272, -0.11060664309660294,
  -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);

vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x
       + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

/**
 * AgX. The log-encoded sigmoid keeps hue stable deep into overexposure, which
 * matters here because the sun is red: an ACES fit would skew it toward pink
 * long before it clips.
 *
 * The look transform that used to sit after the sigmoid is GONE, and that is
 * the point. It was vec3(1.02, 1.0, 0.97) slope, a +0.004 blue offset and a
 * vec3(1.03, 1.0, 1.06) power — a warm tilt of every pixel in the frame at
 * every depth, applied in log space where it bites hardest in the shadows. It
 * is invisible in isolation and it is a second global tint living outside the
 * stage that owns the palette. Two tint stages fighting each other is how
 * three consecutive rounds of grading failed to move a hue histogram. Colour
 * is authored in exactly one place now, and this is not it.
 */
/**
 * The restore argument undoes a controlled fraction of AgX's own highlight
 * desaturation.
 *
 * AgX is a PER-CHANNEL operator: the sigmoid runs on r, g and b independently,
 * so every channel walks toward the same asymptote and a colour loses chroma
 * purely as a function of how far over key it sits. That is a property of the
 * curve, not of the picture, and it is measurable: the same fixed-ratio sky
 * comes out of this function at chroma 12 when it is exposed at 0.2 and chroma
 * 6 when it is exposed at 2.5. The coast vantage looks within a few degrees of
 * the sun, so its sky is genuinely three stops over key, and by the time it
 * reaches the encode there is nothing chromatic left to grade — measured
 * pre-grade at 217-231/255 carrying chroma 5-13, against the same dome at the
 * ridge vantage sitting at 158-195 carrying 15-33. Two vantages, one dome, and
 * the only difference is where on this curve each one landed.
 *
 * The restoration is the standard maximum-chroma projection, and it is HUE
 * EXACT by construction: take the scene's own chromaticity, scale it to the
 * luminance the tonemapper chose, and if that lands outside the display cube,
 * desaturate toward that same luminance by the smallest amount that brings it
 * back in. Nothing rotates; only chroma moves, and only when it has to. Mixed
 * against the per-channel result rather than replacing it, because a real
 * sensor does desaturate its highlights and a frame with none of that reads as
 * a cartoon — this recovers part of the loss, not all of it.
 */
vec3 agx(vec3 c, float restore) {
  const float MIN_EV = -12.47393;
  const float MAX_EV = 4.026069;
  vec3 scene = max(c, vec3(0.0));
  c = SRGB_TO_REC2020 * scene;
  c = AGX_INSET * max(c, vec3(0.0));
  c = clamp((log2(max(c, vec3(1e-10))) - MIN_EV) / (MAX_EV - MIN_EV), 0.0, 1.0);
  c = agxContrast(c);
  c = AGX_OUTSET * c;
  c = pow(max(c, vec3(0.0)), vec3(2.2));
  c = REC2020_TO_SRGB * c;
  c = clamp(c, 0.0, 1.0);

  if (restore > 0.0) {
    float li = luma(scene);
    float lo = luma(c);
    if (li > 1e-6 && lo > 1e-4) {
      vec3 hp = scene * (lo / li);
      float m = max(hp.r, max(hp.g, hp.b));
      // Out of gamut: pull toward the achromatic colour of the SAME luminance,
      // which is the one move that cannot change hue.
      if (m > 1.0) hp = mix(vec3(lo), hp, clamp((1.0 - lo) / max(m - lo, 1e-5), 0.0, 1.0));
      c = clamp(mix(c, max(hp, vec3(0.0)), restore), 0.0, 1.0);
    }
  }
  return c;
}

vec3 encodeSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(1e-5)), vec3(1.0 / 2.4)) - 0.055,
             step(vec3(0.0031308), c));
}
`;

export const METER_FRAG = /* glsl */ `
precision highp float;
${GLSL_COMMON}

uniform sampler2D tSrc;
/** Last frame's exposure texel: .y is the previous metered scene luminance. */
uniform sampler2D tPrev;
uniform vec2 uTileSize;
in vec2 vUv;

/**
 * Attachment 1: the SHADOW population, (sum w*log2 L, sum w).
 *
 * The meter had a channel for the mean and a channel for the highlights and
 * nothing at all for the bottom of the range, and that omission is a measured
 * defect rather than a theoretical one: the ashstorm frame came back spanning
 * 76 to 192 of 255 — 1.3 stops, never touching the bottom third of the range —
 * because the black point was a fixed fraction of the *mean*, and a frame that
 * is optically thick from the near plane out has a mean sitting on top of its
 * own floor. A fraction of the mean is the right anchor when the frame has
 * blacks in it and no anchor at all when it does not. This channel is what
 * lets the exposure pass tell those two cases apart.
 */
layout(location = 1) out highp vec4 pc_fragDark;

void main() {
  vec2 base = floor(vUv / uTileSize) * uTileSize;
  // Scale-free reference for "bright": the previous frame's own metered
  // average. An absolute threshold cannot work — the whole point of the
  // highlight channel is to discover that a scene has no highlights, and a
  // fixed cut in scene-radiance units answers "no samples" identically for a
  // scene with no highlight population and for one metered five stops down.
  float ref = max(texture(tPrev, vec2(0.5)).y, 1e-5);
  float sl = 0.0;
  float sw = 0.0;
  float slb = 0.0;
  float swb = 0.0;
  float sld = 0.0;
  float swd = 0.0;
  float sn = 0.0;
  float sc = 0.0;
  for (int y = 0; y < METER_TAPS; y++) {
    for (int x = 0; x < METER_TAPS; x++) {
      vec2 f = (vec2(float(x), float(y)) + 0.5) / float(METER_TAPS);
      vec2 uv = base + f * uTileSize;
      vec3 c = max(texture(tSrc, uv).rgb, vec3(0.0));
      // Clamped so neither a black hole nor the sun disc can drag the average
      // off on its own; the log makes both far less violent to begin with.
      float l = clamp(luma(c), 3e-4, 48.0);
      float wy = mix(0.10, 1.0, smoothstep(0.94, 0.32, uv.y));
      vec2 d = uv - 0.5;
      float wc = exp(-dot(d, d) * 1.7);
      float w = wy * (0.35 + 0.65 * wc);
      sl += w * log2(l);
      sw += w;
      // Highlight population: samples between ~1 and ~3 stops over the scene's
      // own log-average. Un-weighted by position — a sky is a highlight whether
      // or not the framing put it at the top of the picture.
      float wb = smoothstep(2.0, 8.0, l / ref);
      slb += wb * log2(l);
      swb += wb;
      // Shadow population — a SOFT MINIMUM rather than a window, and the
      // difference matters for the one frame this channel exists to serve.
      //
      // A window ("everything under x% of the mean") is a percentile in
      // disguise: it assumes the frame's floor sits some known distance below
      // its mean. That is exactly the assumption an optically thick frame
      // breaks. The first version of this used a window and the ashstorm
      // vantage put 1.2% of its weight inside it — under the coverage gate, so
      // the whole mechanism silently did nothing on the only shot that needed
      // it. An exponential weight in log-luminance has no window to fall
      // outside of: it is a smooth minimum whose bias toward the floor is set
      // by the exponent, and it returns the bottom of whatever range the frame
      // has, whether that range is one stop or ten.
      float wd = clamp(exp2(-3.0 * (log2(l / ref) + 1.0)), 0.0, 1.0);
      sld += wd * log2(l);
      swd += wd;
      // Unweighted tile statistics, .zw of attachment 1. These do NOT feed the
      // exposure solve; they exist so readMeterGrid() can pull the frame's own
      // spatial luminance map back to the CPU and a candidate metering scheme
      // can be evaluated offline against real frames instead of guessed at. Two
      // channels that were already being written as zero.
      sn += log2(l);
      sc += 1.0;
    }
  }
  gl_FragColor = vec4(sl, sw, slb, swb);
  pc_fragDark = vec4(sld, swd, sn, sc);
}
`;

/**
 * Stage two: reduce the tile grid to a single texel holding the adapted
 * exposure multiplier, and keep it on the GPU. A CPU readback would be the
 * obvious way to close this loop and is also a full pipeline stall every frame,
 * so the exposure lives in a 1x1 render target that ping-pongs against itself
 * for eye adaptation and is sampled directly by the passes that need it.
 *
 * Adaptation is deliberately partial (uAdapt < 1): full adaptation makes night
 * look like an underexposed noon, which is not the note. A 0.8 exponent lifts a
 * dark scene by four fifths of the way to key and leaves the last fifth as the
 * difference between midnight and midday.
 */
export const EXPOSURE_FRAG = /* glsl */ `
precision highp float;
${GLSL_COMMON}
${GLSL_AGX}

uniform sampler2D tMeter;
/** Attachment 1 of the same grid: the shadow population. See METER_FRAG. */
uniform sampler2D tMeterDark;
/** Black point as a fraction of where the scene's own mean lands on display. */
uniform float uBlackRel;
/**
 * Display value the frame's own shadow population is aimed at. This is the
 * ashstorm case and only the ashstorm case: an optically thick frame whose
 * darkest content is already at display 0.45 has no black for uBlackRel to
 * find, because uBlackRel measures from the mean and the mean is sitting on
 * the floor with everything else.
 */
uniform float uDarkFloor;
/**
 * Ceiling on the value curve's gain. The gain is derived rather than authored
 * (see below), so it needs a rail: a frame with a quarter stop of range in it
 * would otherwise ask for an arbitrarily large one and get back its own
 * sampling noise, magnified.
 */
uniform float uGainMax;
/**
 * Dynamic range, in stops between the frame's own shadow and highlight
 * populations, over which the key stops being solved against the weighted mean
 * and starts being solved against the midpoint of the range. See the key block
 * in main() for the measurements these two are set from.
 */
uniform float uRangeLo;
uniform float uRangeHi;
/** Display ceiling on the bright population, and the gain floor that serves it. */
uniform float uHiCeil;
uniform float uGainMin;
/** Manual exposure trim, so the anchor matches what the uber pass will apply. */
uniform float uTrim;
uniform sampler2D tPrev;
uniform vec2 uMeterSize;
uniform float uKey;
uniform float uAdapt;
uniform float uMinExp;
uniform float uMaxExp;
uniform float uRate;
uniform float uDt;
uniform float uReset;
/** Exposed radiance the highlight population is steered toward. */
uniform float uHiKey;
/** Bounds on the highlight trim, as multiples of the mid-grey solution. */
uniform float uMaxLift;
uniform float uMinLift;
in vec2 vUv;

void main() {
  float sl = 0.0;
  float sw = 0.0;
  float slb = 0.0;
  float swb = 0.0;
  float sld = 0.0;
  float swd = 0.0;
  float tiles = 0.0;
  for (int y = 0; y < METER_H; y++) {
    for (int x = 0; x < METER_W; x++) {
      vec2 uv = (vec2(float(x), float(y)) + 0.5) / uMeterSize;
      vec4 s = texture(tMeter, uv);
      vec2 d = texture(tMeterDark, uv).xy;
      sl += s.x;
      sw += s.y;
      slb += s.z;
      swb += s.w;
      sld += d.x;
      swd += d.y;
      tiles += 1.0;
    }
  }
  float avgL = exp2(sl / max(sw, 1e-5));
  float darkL = exp2(sld / max(swd, 1e-5));

  // WHAT THE KEY IS SOLVED AGAINST, WHEN THE FRAME IS BIMODAL.
  //
  // A log-average is the right key estimator for a frame whose luminances form
  // one population. It is the wrong one for a frame that has two, far apart:
  // the average then lands in the gap between them and describes no part of the
  // picture. Measured over the canonical set at hour 9, as tile log-luminance
  // by frame row, the coast vantage is exactly that frame — its top eight rows
  // sit at -0.8 to -1.9 and its bottom ten at -3.9 to -5.9, a four-stop step at
  // the horizon line — while ridge, which is framed almost identically, spans
  // 0.87 stops end to end. The positional weighting then puts nine tenths of
  // the meter's weight on the dark half, so the exposure that comes out is the
  // one that renders a black ash beach as midtone, and the sky it also has to
  // render is three stops over key with nowhere left to go.
  //
  // The two populations the pass already computes ARE the frame's range: the
  // shadow channel's soft minimum and the highlight channel's log-average. When
  // they are far enough apart that the mean is meaningless, key off the
  // midpoint between them instead — the classic photographic compromise, placed
  // by the frame's own extremes rather than by a constant. Reconstructed over
  // the set the separation is clean: coast measures 4.84 stops, redmtn 3.08,
  // vale 2.60, ridge 2.35, dawn 1.56. The gate is set above every frame that
  // does not have the problem, so those four are left bit-identical, and it is
  // one-sided (max against avgL) because the cure for a dark frame is never to
  // expose it darker still.
  //
  // avgL itself is deliberately NOT touched. It is the honest weighted mean and
  // it anchors the value curve's black point further down; substituting a key
  // statistic for it there would move the frame's floor to satisfy a decision
  // about its exposure, which is how two anchors end up fighting.
  float hiL = swb > 1e-4 ? exp2(slb / swb) : avgL;
  float range = log2(max(hiL, 1e-6) / max(darkL, 1e-6));
  float midL = sqrt(max(hiL, 1e-6) * max(darkL, 1e-6));
  float wide = smoothstep(uRangeLo, uRangeHi, range);
  float keyL = mix(avgL, max(avgL, midL), wide);
  float target = clamp(pow(uKey / max(keyL, 1e-6), uAdapt), uMinExp, uMaxExp);

  // Highlight placement.
  //
  // A pure log-average meter has no opinion about where the top of the range
  // lands, so a scene whose brightest content is only two stops over its own
  // mean is exposed exactly like one whose sun disc is ten stops over: both
  // resolve mid-grey correctly and only one of them has a highlight. Measured
  // across the canonical set that was the failure — the ridge frame's brightest
  // pixel reached 0.30 exposed (sRGB 152) and nothing in the frame, sky
  // included, exceeded it; vale topped out at two thirds of white.
  //
  // So: find the log-average of the population 1-3 stops above the scene mean —
  // the sky, the sunlit faces, the water glint — and pull the exposure toward
  // the setting that lands THAT on the top of the curve. Bounded in both
  // directions and by a coverage gate, so it trims the key rather than
  // replacing it: a scene with no bright population at all is left to the
  // log-average alone (the cure for a scene with no dynamic range is not to
  // overexpose it), and a hundred pixels of sun disc is not a reason to stop
  // down the other two million.
  //
  // Placing the highlight LOWER on a wide-range frame — protecting the top and
  // letting the bottom compress — was built here and measured, and it does not
  // pay: at 0.75 stops of protection the coast frame's median fell 93 -> 70 of
  // 255 and its 99th percentile moved 220 -> 217. Twenty-four levels of midtone
  // for three of highlight, because the value curve below re-anchors on the
  // frame's own mean and takes the black point down with it, so the top barely
  // moves. What DOES move the top on that frame is the gain, which is where the
  // range gate is spent instead. See the third-anchor block further down.
  float hiCover = swb / max(tiles * float(METER_TAPS * METER_TAPS), 1.0);
  float hiWant = uHiKey / max(hiL, 1e-6);
  float lift = clamp(hiWant / max(target, 1e-6), uMinLift, uMaxLift);
  lift = mix(1.0, lift, smoothstep(0.004, 0.030, hiCover));
  target = clamp(target * lift, uMinExp, uMaxExp);

  float prev = texture(tPrev, vec2(0.5)).x;
  float e = target;
  if (uReset < 0.5 && prev > 1e-5) {
    // Adaptation rate scales with how far off we are, in stops. A slow constant
    // rate is right for a cloud crossing the sun and badly wrong for walking out
    // of a cave — or for a capture harness that teleports the camera across the
    // map and gives the frame two seconds to settle before it takes the picture.
    float stops = abs(log2(target / max(prev, 1e-5)));
    float rate = uRate * (1.0 + 1.5 * stops);
    e = mix(prev, target, clamp(1.0 - exp(-uDt * rate), 0.0, 1.0));
  }

  // Where the frame's mean and its floor land on DISPLAY, each run through the
  // exact chain the uber pass is about to run — exposure, AgX, sRGB encode.
  // Both here, in a 1x1 target, precisely because both are constant across the
  // frame: two AgX evaluations per frame instead of four million.
  float meanDisplay = luma(encodeSrgb(agx(vec3(max(avgL, 1e-6) * e * uTrim), 0.0)));
  float darkDisplay = luma(encodeSrgb(agx(vec3(max(darkL, 1e-6) * e * uTrim), 0.0)));
  darkDisplay = min(darkDisplay, meanDisplay - 1e-3);

  // THE VALUE CURVE'S TWO ANCHORS, SOLVED TOGETHER.
  //
  // The curve is display_out = gain * (display_in - black), and there are two
  // things it must do at once: leave the frame's own mean where the exposure
  // meter put it, and put the frame's own floor on a real black. Two
  // conditions, two unknowns - so solve for both rather than fixing one and
  // hoping the other follows, which is what a constant blackRel was doing.
  //
  //   gain * (meanDisplay - black) = meanDisplay      (mean stays put)
  //   gain * (darkDisplay - black) = uDarkFloor       (floor lands on black)
  //
  // Eliminating black gives the gain directly. Note what falls out of it: on
  // a frame whose floor is already well under its mean - every daylight shot -
  // the solution asks for a gain BELOW the nominal 1/(1 - uBlackRel), the
  // clamp holds it there, and black comes back as exactly uBlackRel *
  // meanDisplay. The ordinary frame is bit-identical to what it was. Only a
  // frame with no floor to find asks for more, and gets it up to the rail.
  float gain = clamp((uDarkFloor - meanDisplay) / (darkDisplay - meanDisplay),
                     1.0 / max(1.0 - uBlackRel, 0.15), uGainMax);

  // THE THIRD ANCHOR: the top — AND WHY IT IS GATED RATHER THAN ALWAYS ON.
  //
  // The two conditions above pin the mean and the floor and say nothing about
  // the ceiling, so the gain they agree on is free to drive the bright
  // population clean past display 1.0 and into the uber pass's shoulder, where
  // every ratio inside it is compressed toward white. Completing the pair is
  // the obvious move:
  //
  //   gain * (hiDisplay - black) <= uHiCeil,  black = meanDisplay (1 - 1/gain)
  //
  // and applied unconditionally it is a bad trade at every ceiling value swept
  // (1.00 / 0.96 / 0.92 / 0.88 / 0.86 / 0.80). Every daylight frame in the
  // canonical set already places its highlights near the top of the curve, so
  // the ceiling binds on all of them and pays for one frame's sky with
  // everyone else's contrast: at 0.86, redmtn's gain fell 2.60 -> 1.57, its 1st
  // percentile rose 9 -> 20 of 255 and its dynamic range collapsed from 4.62
  // stops to 3.40 — a frame with no blacks in it, which is the exact defect the
  // dark anchor exists to prevent.
  //
  // So it is gated on the same range measure the key block uses. A frame the
  // curve can hold whole keeps every stop of its contrast and is bit-identical;
  // a frame with nearly five stops in it gives up contrast rather than its sky.
  // That is the same trade the highlight protection above makes, made once more
  // at the other end of the chain, and on the same frames.
  float hiDisplay = luma(encodeSrgb(agx(vec3(max(hiL, 1e-6) * e * uTrim), 0.0)));
  float gainHi = uGainMax;
  if (hiDisplay > meanDisplay + 0.02) {
    gainHi = (uHiCeil - meanDisplay) / (hiDisplay - meanDisplay);
  }
  gainHi = mix(uGainMax, gainHi, wide * smoothstep(0.004, 0.030, hiCover));
  gain = max(min(gain, gainHi), uGainMin);

  float black = clamp(meanDisplay * (1.0 - 1.0 / gain), 0.0, 0.90 * meanDisplay);
  gl_FragColor = vec4(e, avgL, gain, black);
}
`;

/* ------------------------------------------- tonemap, grade, lens, output */

export const UBER_FRAG = /* glsl */ `
precision highp float;
${GLSL_COMMON}
${GLSL_AGX}
${GLSL_LUT}

uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform sampler2D tExposure;
uniform float uBloomIntensity;
uniform float uExposure;
/** Peak per-channel lateral displacement at the extreme corner, in PIXELS. */
uniform float uCaPixels;
uniform vec2 uTexel;
uniform float uVignette;
/** Highlight rolloff knee, display-referred. Nothing below this moves. */
uniform float uShoulder;
/** Width of the smooth-max at the bottom of the value curve. */
uniform float uToeKnee;
/** How much of AgX's per-channel highlight desaturation to undo. See agx(). */
uniform float uHueRestore;
in vec2 vUv;

/**
 * The frame's value curve: black point, gain, soft toe, shoulder.
 *
 * This used to live inside the grade cube as three constants. It is a uniform
 * now because a cube is stateless and the correct black point is not: it is a
 * property of where the exposure meter put this particular frame. Baked at a
 * fixed display value it was simultaneously too weak for the daylight shots
 * (whose 1st percentile measured 55 to 125 of 255 — no black anywhere in the
 * frame, which is why nothing read as a cast shadow and why the grade's own
 * shadow tint, gated on darkness, applied to nothing) and violent enough to
 * crush the underwater and night frames to mud. The exposure pass publishes
 * the anchor in tExposure.w; see EXPOSURE_FRAG.
 *
 * Applied as a common scale driven by luminance, never per channel. A
 * per-channel curve rotates hue as a side effect of changing value, hardest
 * where it is steepest, which is exactly the toe this is trying to hand over
 * to the shadow tint downstream.
 */
vec3 valueCurve(vec3 c, float black, float gain) {
  float l0 = max(luma(c), 1e-5);
  // Smooth max against zero: equals (l0 - black) well above the black point,
  // and stays small-but-positive below it, so the basalt band compresses
  // instead of clipping. The bible forbids a crushed pure black as flatly as
  // it forbids a clipped white, and a hard max() is a clip.
  float u = l0 - black;
  float l1 = gain * 0.5 * (u + sqrt(u * u + uToeKnee * uToeKnee));
  vec3 o = c * (l1 / l0);

  // THE SHOULDER RUNS ON THE MAX CHANNEL, NOT ON LUMINANCE, and that one line
  // is the difference between Red Mountain's lava reading as fire and reading
  // as a scratch on plaster.
  //
  // What was here rolled luminance off and then, separately, handled the case
  // where a channel had nonetheless landed over 1.0 by lerping the pixel toward
  // its own grey. Work an ember through it: exposed, a fissure arrives at
  // roughly (1.40, 0.55, 0.12) with a luminance of 0.70 — which is UNDER the
  // shoulder, so the tone curve declines to touch it, and the whole job falls
  // to the overflow guard, which mixes 57% of vec3(0.70) into it and returns
  // (1.00, 0.64, 0.45). That is sRGB (255, 162, 115): pale pink. Measured in
  // the review as (254, 237, 216) once bloom had been added on top. Every
  // saturated highlight in the game was being desaturated by the mechanism
  // meant to keep it from clipping, and hardest exactly where it was most
  // saturated, because that is where one channel runs away from luminance
  // first.
  //
  // Rolling the MAX channel off instead cannot clip and cannot rotate hue: the
  // triplet is scaled by one number, so every ratio inside it — hue and
  // saturation both — comes out the far side untouched. The same ember returns
  // (0.97, 0.38, 0.08). On low-chroma content, where max and luminance are
  // nearly the same number, the curve this produces is within a couple of LSB
  // of the old one, so the frame's overall value structure is unchanged; it is
  // only the chromatic highlights that behave differently, which is the whole
  // of the intent.
  float mx = max(o.r, max(o.g, o.b));
  if (mx > uShoulder) {
    float head = 1.0 - uShoulder;
    float mxs = uShoulder + head * (1.0 - exp(-(mx - uShoulder) / head));
    o *= mxs / mx;
  }
  return clamp(o, 0.0, 1.0);
}

/**
 * Lateral chromatic aberration.
 *
 * Strictly radial, quadratic in radius, exactly zero on axis, denominated in
 * PIXELS rather than UV, and sampled as a five-tap spectral gather so an edge
 * gets a continuous fringe rather than a hard cyan/orange ghost pair.
 *
 * The part that had to be rebuilt is the mask. Dispersion on high-frequency
 * detail is what reviewers describe as "rainbow banding", and the previous mask
 * failed to catch any of it for two independent reasons:
 *
 *  1. It measured contrast between the two *extreme dispersion taps*, i.e. at
 *     +/- the displacement. On a pattern whose period is near twice the
 *     displacement — mushroom gills, grass blades, any alpha-tested foliage at
 *     the near plane — both taps land at the same phase, the measured contrast
 *     is near zero, and the fringe is applied at full strength to precisely the
 *     content that shows it worst. Contrast is now measured over a fixed
 *     one-pixel cross, which is the scale the artefact actually lives at.
 *  2. It divided an absolute luminance difference by (luma + 0.25) on
 *     *pre-exposure scene radiance*. On a dim frame every luminance in the
 *     buffer is a few hundredths, so the ratio never approached the threshold
 *     and the mask was pinned open. The measure is now (hi - lo) / (hi + lo),
 *     which is invariant to exposure by construction.
 */
vec3 sampleCA(vec2 uv, vec2 d) {
  const float INV_CORNER = 1.41421356; // 1 / length(vec2(0.5))
  float rn = min(length(d) * INV_CORNER, 1.0);
  float px = uCaPixels * rn * rn;
  vec3 centre = texture(tColor, uv).rgb;
  if (px < 0.02) return centre;

  vec3 nx = texture(tColor, uv + vec2(uTexel.x, 0.0)).rgb;
  vec3 nx2 = texture(tColor, uv - vec2(uTexel.x, 0.0)).rgb;
  vec3 ny = texture(tColor, uv + vec2(0.0, uTexel.y)).rgb;
  vec3 ny2 = texture(tColor, uv - vec2(0.0, uTexel.y)).rgb;
  float lc = luma(centre);
  float hi = max(max(luma(nx), luma(nx2)), max(max(luma(ny), luma(ny2)), lc));
  float lo = min(min(luma(nx), luma(nx2)), min(min(luma(ny), luma(ny2)), lc));
  float contrast = (hi - lo) / max(hi + lo, 1e-6);
  float mask = 1.0 - smoothstep(0.05, 0.20, contrast);
  if (mask < 0.004) return centre;

  vec2 dir = d / max(length(d), 1e-6);
  vec2 caStep = dir * px * uTexel;

  // Response lobes centred at -1 (red), 0 (green), +1 (blue) in units of the
  // full displacement, integrated over five evenly spaced taps.
  vec3 acc = vec3(0.0);
  vec3 wsum = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float sp = float(i) * 0.5 - 1.0;
    vec3 c = texture(tColor, uv + caStep * sp).rgb;
    vec3 w = exp(-vec3((sp + 1.0) * (sp + 1.0), sp * sp, (sp - 1.0) * (sp - 1.0)) * 2.2);
    acc += c * w;
    wsum += w;
  }
  vec3 disp = acc / max(wsum, vec3(1e-5));

  return mix(centre, disp, mask);
}

void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 1.41421356;

  vec3 hdr = uCaPixels > 1e-4 ? sampleCA(vUv, d) : texture(tColor, vUv).rgb;

  // Exposure first, and the same multiplier the bloom prefilter already applied,
  // so the bright-pass threshold means "this many stops over key" rather than a
  // fixed scene-radiance number that stops being meaningful the moment the meter
  // moves. Metered value times a manual trim; the trim is 1.0 in normal use.
  vec4 expo = texture(tExposure, vec2(0.5));
  float ev = expo.x;
  hdr = max(hdr * (ev * uExposure), vec3(0.0));

  #ifdef USE_BLOOM
    hdr = mix(hdr, max(texture(tBloom, vUv).rgb, vec3(0.0)), uBloomIntensity);
  #endif

  #ifdef USE_TONEMAP
    vec3 c = agx(hdr, uHueRestore);
  #else
    vec3 c = clamp(hdr, 0.0, 1.0);
  #endif

  c = encodeSrgb(c);

  // Value first, colour second. The grade cube's terms are all gated on
  // luminance — the shadow temperature especially — so they have to see the
  // frame's final value structure, not the tonemapper's milky one.
  c = valueCurve(c, expo.w, expo.z);

  #ifdef USE_LUT
    c = applyLUT(c);
  #endif

  // Grain used to be applied here. It is now laid down by the output pass, at
  // canvas resolution and after the sharpen — see the tail of CAS_FRAG. Grain is
  // a property of the image as it is *presented*, so generating it at the
  // internal resolution meant that on any upscaling tier it was resampled by a
  // non-integer factor into correlated blobs on the resampler's lattice, and
  // then amplified several-fold by a sharpen kernel it had no business meeting.
  // Nothing about a film emulation should change when the render scale does.

  #ifdef USE_VIGNETTE
    c *= 1.0 - uVignette * pow(smoothstep(0.46, 1.18, r), 2.0);
  #endif

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

export const CAS_FRAG = /* glsl */ `
precision highp float;
${GLSL_COMMON}
${GLSL_DEPTH}

uniform sampler2D tColor;
uniform sampler2D tDebug;
uniform sampler2D tAO;
uniform sampler2D tVol;
uniform sampler2D tBloomDbg;
uniform sampler2D tDepth;
uniform sampler2D tHalf;
uniform sampler2D tBlue;
/** Texel size of the SOURCE (internal-resolution) colour buffer. */
uniform vec2 uTexel;
/** Source buffer size in pixels; the reconstruction filter needs it directly. */
uniform vec2 uSrcSize;
uniform float uSharpness;
uniform float uGrain;
uniform float uFrame;
uniform int uDebugMode;
in vec2 vUv;

/**
 * AMD FidelityFX CAS. Contrast-adaptive: it sharpens flat regions hard and
 * high-contrast edges barely at all, which is exactly the inverse of what TAA
 * damages, and it never rings.
 *
 * Only ever run at 1:1, i.e. when the source and the canvas are the same size.
 * See the reconstruction path below for why.
 */
vec3 cas(vec2 uv) {
  vec3 a = texture(tColor, uv + vec2(0.0, -uTexel.y)).rgb;
  vec3 b = texture(tColor, uv + vec2(-uTexel.x, 0.0)).rgb;
  vec3 e = texture(tColor, uv).rgb;
  vec3 f = texture(tColor, uv + vec2(uTexel.x, 0.0)).rgb;
  vec3 g = texture(tColor, uv + vec2(0.0, uTexel.y)).rgb;

  vec3 mn = min(min(min(a, b), min(f, g)), e);
  vec3 mx = max(max(max(a, b), max(f, g)), e);

  vec3 amp = clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0);
  amp = sqrt(amp);
  vec3 w = amp * mix(vec3(-0.125), vec3(-0.2), uSharpness);

  // Noise deadzone. This kernel has a gain of (1 - 4w) / (1 + 4w) on anything
  // varying at the pixel period — nearly FOUR at the sharpness this pass runs,
  // and it is largest in flat regions, because amp is a headroom term and
  // headroom is maximal exactly where there is no contrast to protect. So the
  // one thing stock CAS amplifies hardest is a flat surface carrying nothing
  // but the residue of dithered sampling: half-res AO, the volumetric march's
  // jitter, whatever the temporal filter failed to integrate. Multiply
  // sub-visible noise by four across every flat surface in the frame and it
  // stops being noise and starts being a screen-door.
  //
  // A neighbourhood whose entire luminance range is a couple of display LSB has
  // no acutance to recover by definition, so there is nothing to lose by
  // declining to sharpen it. Thresholds are in sRGB-encoded units because that
  // is the space this pass runs in: ~1 LSB to ~5 LSB.
  float range = luma(mx) - luma(mn);
  // Two gates, not one. The low gate is the noise deadzone above. The HIGH gate
  // is the silhouette guard, and it is measured rather than defensive: with the
  // sharpen on, 75% of the frame's >80-level luminance transitions carried one
  // intermediate pixel or none; with it off, 69%. The pass was re-hardening the
  // exact coverage ramp the temporal resolve had just spent sixteen jittered
  // samples building. Acutance belongs to texture and to material detail, both
  // of which live well under a tenth of the range; a sky-to-ridge edge has
  // nothing left to recover and everything to lose.
  w *= smoothstep(0.004, 0.020, range) * (1.0 - smoothstep(0.16, 0.40, range));

  vec3 res = (e + (a + b + f + g) * w) / (1.0 + 4.0 * w);
  // Clamp to the neighbourhood. Stock CAS is *low*-ringing, not ring-free: the
  // adaptive amplitude backs off on high-contrast edges but never forbids
  // overshoot, and on the highest-contrast edge in a frame — a black cap
  // silhouette against a bright sulphur sky — what is left is enough to print a
  // bright band on the sky side and a dark one on the object side. That is the
  // halo the ashstorm review measured. A sharpen that stays inside the values
  // its own neighbourhood already contains still raises acutance; it simply
  // cannot invent a value that was never there, which is what a halo is.
  return clamp(res, min(mn, e), max(mx, e));
}

/**
 * Catmull-Rom reconstruction, five bilinear fetches (the standard 4x4 kernel
 * collapsed onto the hardware filter). Used whenever the source is smaller than
 * the canvas.
 *
 * This replaced a hardware bilinear stretch followed by CAS, and the reason is
 * measured rather than aesthetic. At the 0.8 scale this tier used to run, the
 * canvas is 5 pixels for every 4 of source, so the resampling phase repeats on
 * a 5-pixel lattice: output pixels at phase 0 land exactly on a source texel and
 * pass through untouched, phase 2 lands halfway between two and is a 50/50
 * average. Bilinear's frequency response depends on that phase, so the image's
 * own high-frequency content — grain, dither, surface detail, everything — is
 * attenuated on a fixed 5x5 screen grid. Folding a high-passed midground patch
 * by phase measured 0.81 / 0.77 / 0.75 / 0.76 / 0.82 LSB RMS across the five
 * phases in BOTH axes: an 8% sharpness modulation stamped on the same screen
 * lattice over every surface at every distance, with the sharp corners of the
 * cell reading as a halftone dot. Running an unsharp mask afterwards, with taps
 * spaced one *source* texel apart, then resonated with the same lattice and
 * amplified it. Five critics described the result independently, in the same
 * words: a screen-door dither crawling over the terrain.
 *
 * Catmull-Rom is very nearly flat across the passband and is what the same fold
 * needs to come out even. It also carries a mild negative lobe, so it recovers
 * the acutance the CAS pass was there to provide — which is why the sharpen is
 * skipped entirely on this path rather than layered on top of it.
 */
vec3 reconstruct(vec2 uv) {
  vec2 sp = uv * uSrcSize;
  vec2 tp1 = floor(sp - 0.5) + 0.5;
  vec2 f = sp - tp1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 o12 = w2 / w12;
  vec2 p0 = (tp1 - 1.0) * uTexel;
  vec2 p3 = (tp1 + 2.0) * uTexel;
  vec2 p12 = (tp1 + o12) * uTexel;
  vec3 r = vec3(0.0);
  r += texture(tColor, vec2(p12.x, p0.y)).rgb * (w12.x * w0.y);
  r += texture(tColor, vec2(p0.x, p12.y)).rgb * (w0.x * w12.y);
  r += texture(tColor, vec2(p12.x, p12.y)).rgb * (w12.x * w12.y);
  r += texture(tColor, vec2(p3.x, p12.y)).rgb * (w3.x * w12.y);
  r += texture(tColor, vec2(p12.x, p3.y)).rgb * (w12.x * w3.y);
  return max(r, vec3(0.0));
}

void main() {
  vec3 c;
  if (uDebugMode == 0) {
    #ifdef UPSCALING
      c = reconstruct(vUv);
    #elif defined(USE_CAS)
      c = cas(vUv);
    #else
      c = texture(tColor, vUv).rgb;
    #endif
  } else if (uDebugMode == 1) {
    c = vec3(texture(tAO, vUv).r);
  } else if (uDebugMode == 2) {
    c = vec3(texture(tAO, vUv).g);
  } else if (uDebugMode == 3) {
    c = texture(tDebug, vUv).xyz * 0.5 + 0.5;
  } else if (uDebugMode == 4) {
    c = abs(texture(tDebug, vUv).xy * 40.0).xyy;
  } else if (uDebugMode == 5) {
    // Signed: the volumetric buffer carries a shadow RESIDUAL, which is
    // non-positive by construction. Mid-grey is zero.
    c = vec3(0.5) + texture(tVol, vUv).rgb * 4.0;
  } else if (uDebugMode == 7) {
    // Raw window-space depth, expanded around 1.0 where a near/far of 0.1/12000
    // puts every visible surface. Green = geometry, black = far plane.
    float raw = texture(tDepth, vUv).x;
    c = vec3(raw, clamp((1.0 - raw) * 400.0, 0.0, 1.0), raw * raw * raw);
  } else if (uDebugMode == 8) {
    // Linear view depth from the half-res buffer, log-mapped over 0.5..5000 m.
    float d = texture(tHalf, vUv).w;
    c = vec3(clamp(log2(max(d, 0.5) / 0.5) / 13.3, 0.0, 1.0));
  } else if (uDebugMode == 9) {
    // Same map, but read from the prepass's own -mv.z rather than the depth
    // attachment. Disagreement between 8 and 9 localises a depth-buffer fault.
    float d = texture(tDebug, vUv).w;
    c = vec3(clamp(log2(max(d, 0.5) / 0.5) / 13.3, 0.0, 1.0));
  } else {
    c = texture(tBloomDbg, vUv).rgb;
  }

  // Grain and dither, together, once, at CANVAS resolution, at the very end of
  // the chain and after the sharpen.
  //
  // Both used to happen a pass too early. Grain was laid down in the uber pass,
  // which runs at the *internal* resolution — so on any tier that upscales, a
  // field authored to be one pixel wide was stretched by a non-integer factor
  // into correlated blobs sitting on the resampler's own lattice (nearest-
  // neighbour correlation of the high-passed image measured 0.31 horizontally
  // and 0.25 vertically, against 0.00 and -0.08 at native), which is precisely
  // the "unresolved halftone dither screen" reading. It was then fed through the
  // sharpen, whose gain on pixel-period content is close to four, so it arrived
  // on screen at several times its authored amplitude as well.
  //
  // One field serves both jobs, because they *are* the same field: a triangular
  // PDF built from two decorrelated blue-noise taps, offset per frame along the
  // R2 sequence so it is uncorrelated in time as well as space. Blue noise from
  // a tile rather than interleaved-gradient noise — IGN is a structured diagonal
  // weave and at 1 LSB it was still legible as a crosshatch in flat sky.
  //
  // Amplitude is the larger of the two requirements. Grain is weighted by
  // 4l(1-l) the way film is, which keeps blacks clean and highlights from
  // sparkling; the floor of +/-1 LSB is the dither requirement and is what the
  // grain weight would otherwise fall below in exactly the deep shadows and
  // bright skies that band. +/-1 LSB and not +/-0.5: a TPDF dither only fully
  // decorrelates the quantisation error when each of its two uniform components
  // spans a whole quantisation step, and at half that the night sky still walked
  // in runs of 15-20 rows locked on one 8-bit value.
  vec2 bo = vec2(r2seq(uFrame), r2seq(uFrame * 1.6180339887));
  float n1 = texture(tBlue, gl_FragCoord.xy / 64.0 + bo).r;
  float n2 = texture(tBlue, gl_FragCoord.xy / 64.0 + bo + vec2(0.5, 0.37)).r;
  float l = luma(c);
  float amp = max(uGrain * (4.0 * l * (1.0 - l) + 0.12), 1.0 / 255.0);
  c += (n1 + n2 - 1.0) * amp;

  gl_FragColor = vec4(c, 1.0);
}
`;
