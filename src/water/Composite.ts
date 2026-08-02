import * as THREE from 'three';
import { COMMON_GLSL, GERSTNER_GLSL, TERRAIN_GLSL } from './glsl';
import { FOAM_SIZE } from './textures';

/**
 * One deferred full-screen pass that owns everything the sea does to pixels it
 * does not itself cover:
 *
 *  - the wet-sand darkening band and swash foam on the beach. Doing this in
 *    screen space from the depth buffer avoids a decal mesh fighting the terrain
 *    for z, and gives an exact per-pixel waterline instead of a tessellated one.
 *  - underwater extinction, caustics projected onto whatever the ray actually
 *    hit, and the refraction wobble of the whole frame.
 *
 * It runs in lateUpdate, after the render pipeline has resolved to the canvas,
 * so the source is display-referred sRGB; the shader decodes, composites in
 * linear, and re-encodes.
 */

const VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D wFrame;
uniform sampler2D wDepth;
uniform mat4 wInvVP;
uniform vec2 wNearFar;
uniform vec3 wCamPos;
uniform float wTime;
uniform float wSubmerged;
uniform vec3 wSunDir;
uniform vec3 wSunColor;
uniform vec3 wAmbient;
uniform vec3 wExtinction;
uniform vec3 wScatter;
uniform float wSunAbove;
uniform vec2 wWindDir;
uniform sampler2D wFoam;
uniform vec3 wFoamColor;
uniform float wWetness;
uniform float wShoreFade;
uniform vec2 wDepthTexel;

${COMMON_GLSL}
${GERSTNER_GLSL}
${TERRAIN_GLSL}

vec3 srgbToLinear(vec3 c){
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c){
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 worldFromDepth(vec2 uv, float rawDepth){
  vec4 ndc = vec4(uv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
  vec4 p = wInvVP * ndc;
  return p.xyz / p.w;
}

void main(){
  vec2 uv = vUv;

  // Refraction wobble of the entire frame while submerged. Two counter-moving
  // low-frequency lobes read as water motion rather than as a screen filter.
  if (wSubmerged > 0.001){
    float t = wTime;
    vec2 w = vec2(
      wvnoise(uv * 5.3 + vec2(t * 0.21, -t * 0.13)),
      wvnoise(uv * 4.1 + vec2(-t * 0.17, t * 0.23))
    ) - 0.5;
    vec2 w2 = vec2(sin(uv.y * 21.0 + t * 1.7), cos(uv.x * 18.0 - t * 1.3));
    uv += (w * 0.010 + w2 * 0.0016) * wSubmerged;
    uv = clamp(uv, 0.0005, 0.9995);
  }

  vec3 col = srgbToLinear(texture2D(wFrame, uv).rgb);

  float raw = texture2D(wDepth, uv).x;
  bool far = raw >= 0.9999;
  vec3 world = worldFromDepth(uv, min(raw, 0.999995));
  float viewDist = far ? wNearFar.y * 2.0 : length(world - wCamPos);

  // Geometric normal from neighbouring *depth texels*, not from screen
  // derivatives: the depth target is half resolution and point-sampled, so
  // dFdx/dFdy of the reconstructed position see a constant-depth surface and
  // return the view direction rather than the ground.
  vec2 uvR = uv + vec2(wDepthTexel.x, 0.0);
  vec2 uvU = uv + vec2(0.0, wDepthTexel.y);
  vec3 wR = worldFromDepth(uvR, min(texture2D(wDepth, uvR).x, 0.999995));
  vec3 wU = worldFromDepth(uvU, min(texture2D(wDepth, uvU).x, 0.999995));
  vec3 gn = normalize(cross(wU - world, wR - world) + vec3(0.0, 1e-9, 0.0));
  if (dot(gn, wCamPos - world) < 0.0) gn = -gn;

  // Screen footprint of this pixel on the ground, and the per-pixel change in
  // ground height — both measured between neighbouring DEPTH TEXELS, not with
  // dFdx/dFdy.
  //
  // This is the same trap the geometric normal above already sidesteps, and it
  // is the actual cause of the shoreline rendering as a scatter of loose bright
  // dots instead of a line. The depth target is half resolution and point
  // sampled, so two neighbouring full-res pixels routinely land on one depth
  // texel: the screen derivative of anything reconstructed from it is then zero
  // for that pair and a whole texel's worth for the next. Every band below is
  // antialiased by dividing its width by these numbers, so a zero here does not
  // just fail to filter — it declares a half-metre swash line perfectly resolved
  // on a beach where one texel spans forty metres, and fires it at full
  // brightness on whichever texels happen to straddle it. Against night sand
  // that is a row of isolated blue-white pixels, which is precisely the "scattered
  // pixel speckle rather than a coherent edge" the shoreline was drawing.
  float fp = max(max(length(wR.xz - world.xz), length(wU.xz - world.xz)), 1e-4);
  float yFw = max(max(abs(wR.y - world.y), abs(wU.y - world.y)), 1e-4);

  // Depth discontinuity, relative so it is scale-free. Across a flora billboard
  // edge or a rock silhouette the half-resolution point-sampled depth jumps,
  // the reconstructed position and normal are meaningless, and the beach terms
  // below fired on some pixels and not their neighbours — which is what threw a
  // 1-bit spray of foam-white pixels up over the whole flora field. Anything
  // sitting on an edge is faded out instead.
  float dR = length(wR - wCamPos);
  float dU = length(wU - wCamPos);
  float disc = max(abs(dR - viewDist), abs(dU - viewDist)) / max(viewDist, 1.0);
  float solid = 1.0 - smoothstep(0.010, 0.045, disc);

  // ---- beach: wet sand + swash foam ---------------------------------------
  if (wSubmerged < 0.999 && !far && wShoreFade > 0.0 && solid > 0.002){
    float bed = wTerrainHeight(world.xz);
    // Same shoaling damp the surface mesh uses, so this gate lines up exactly
    // with the rendered water edge instead of with the undamped open-sea swell.
    float still = -bed;
    float damp = smoothstep(0.0, 1.6, still) * (1.0 + 0.35 * exp(-abs(still - 3.0) * 0.55));
    float surfY = wGerstnerHeight(world.xz, wTime, damp);
    // Every edge in this block is widened by the height one depth texel spans,
    // so a band narrower than the data resolves as a soft, dim, continuous line
    // rather than as whichever texels happened to fall inside it.
    float above = smoothstep(-0.05 - yFw, 0.18 + yFw, world.y - surfY);

    // The run-up line is driven by the offshore swell phase, not by the local
    // (damped) surface: that is what makes the sheet climb the sand and drain.
    float swell = wGerstnerHeight(world.xz, wTime, 1.0);
    float swellLag = wGerstnerHeight(world.xz, wTime - 1.6, 1.0);
    float runUp = 0.20 + 1.10 * wsat(swell * 0.5 + 0.5);
    // Wetness remembers the highest recent reach — sand drains slowly.
    float wetLine = 0.20 + 1.10 * wsat(max(swell, swellLag) * 0.5 + 0.5) + 0.55;
    // The wet band is 1.4 m of vertical run-up either side of the drain line,
    // which on a shallow beach is several metres of sand — the dark collar
    // every real shoreline has and whose absence is what let dry beach and
    // submerged beach read at exactly the same value.
    float wet = wfall(wetLine + 0.25 + yFw, wetLine - 1.40 - yFw, world.y) * above;

    // Up-facing surfaces only; a cliff face does not hold a wet band.
    wet *= wsat(abs(gn.y) * 1.4 - 0.15);
    // And only where the depth buffer's surface actually IS the ground. This pass
    // knows nothing about materials — it reconstructs a world position from depth
    // and asks whether it sits in the run-up band — so a mushroom cap, a boulder
    // or a flora billboard standing anywhere in that metre and a half of height
    // qualified as beach and got a wet collar and a swash line painted on it. At
    // night, foam lit by ambient against near-black sand is fifteen times the
    // value around it, so every one of those became an isolated bright dot: the
    // shoreline reading as a scatter of blue-white pixels instead of an edge. The
    // baked heightfield is the ground truth; anything standing proud of it by more
    // than the depth data's own resolution is not the ground.
    wet *= 1.0 - smoothstep(0.55 + yFw, 1.90 + 2.0 * yFw, abs(world.y - bed));
    // Far enough to cover a whole bay, not just the sand at the viewer's feet.
    // Fades out at the depth pass's own far plane, so the band ends because the
    // data ends and not a kilometre short of it.
    wet *= 1.0 - smoothstep(760.0, 1340.0, viewDist);
    wet *= wShoreFade * (1.0 - wSubmerged) * solid;

    if (wet > 0.002){
      // Wetting fills the pore space: diffuse albedo drops and goes slightly
      // warm-dark, and the surface picks up a specular sheen.
      vec3 wetTint = vec3(0.30, 0.28, 0.27);
      col *= mix(vec3(1.0), wetTint, wet * (0.80 + 0.20 * wWetness));

      vec3 L = normalize(wSunDir);
      vec3 V = normalize(wCamPos - world);
      vec3 H = normalize(L + V);
      // Wet sand is not a mirror but it is far smoother than dry sand; the
      // broader lobe plus a Fresnel-weighted grazing lift is what makes the
      // band read as a *material* change rather than as a painted-on stain.
      float NoV = wsat(dot(gn, V));
      float fres = 0.04 + 0.96 * pow(1.0 - NoV, 5.0);
      float sheen = pow(max(dot(gn, H), 0.0), 60.0) * wsat(dot(gn, L));
      col += wSunColor * sheen * wet * (0.20 + 0.55 * fres) * wSunAbove;

      // Swash foam: a ragged sheet pinned to the run-up line. The erosion
      // threshold tears the near edge, but the texture that drives it is a
      // metre across — past a few tens of metres one pixel spans several
      // repeats, the tap is a mip average, and comparing against it is a coin
      // flip per pixel. Both the band and the compare are therefore integrated
      // against the real screen footprint, so the swash line thins and dims
      // into a continuous thread instead of dissolving into loose white dots.
      vec2 wd = normalize(wWindDir + vec2(1e-5));
      // EXPLICIT mip. Nothing in this pass may rely on an implicit derivative:
      // the coordinate being differentiated is reconstructed from a half-resolution
      // point-sampled depth target, so dFdx/dFdy of it are zero inside a depth
      // texel and a full texel across the boundary. A hardware mip chosen from
      // that lands on level 0 for a one-metre foam texture stretched over a beach
      // whose pixels are tens of metres apart — i.e. it returns uncorrelated white
      // noise per pixel, which is then thresholded into on/off foam. That is the
      // scattered bright speckle along every waterline, and no amount of
      // antialiasing the *bands* can fix it, because the noise is in the tap.
      float lodA = max(0.0, log2(fp * (${FOAM_SIZE}.0 / 3.7)));
      float lodB = max(0.0, log2(fp * (${FOAM_SIZE}.0 / 1.1)));
      vec4 fA = textureLod(wFoam, world.xz / 3.7 + wd * wTime * 0.05, lodA);
      vec4 fB = textureLod(wFoam, wrot(2.4) * world.xz / 1.1 - wd * wTime * 0.09, lodB);
      float band = wBandAA(world.y, runUp - 0.22, runUp + 0.22, yFw);
      float cover = wsat(band * (0.45 + 0.85 * (fA.r * 0.6 + fB.r * 0.4)) * wet);
      float thresh = fA.a * 0.55 + fB.a * 0.45;
      float tRes = wsat(1.0 - fp / 1.1) * 0.45 + wsat(1.0 - fp / 3.7) * 0.55;
      float foam = mix(cover, smoothstep(thresh - 0.17, thresh + 0.17, cover), tRes);
      // The swash line is about a metre and a half of wet sand. Once a pixel
      // spans more than that it can only be partly foam, and drawing it at full
      // value is how a continuous line becomes a row of dashes.
      foam *= wsat(1.6 / (1.6 + fp));
      // Same irradiance the sand next to it gets: a bubble raft is a bright
      // diffuse medium, not a light source, and at night it has to follow the
      // moon down with everything else.
      float wrapN = wsat((dot(gn, L) + 0.35) / 1.35);
      vec3 foamCol = wFoamColor * (wAmbient * 1.15 + wSunColor * wrapN * 0.32 * wSunAbove);
      col = mix(col, foamCol * (0.8 + 0.4 * fB.g), foam * 0.75 * solid);
    }
  }

  // ---- underwater ----------------------------------------------------------
  if (wSubmerged > 0.001){
    float depthBelow = max(-wCamPos.y, 0.0);

    // Caustics ride on whatever surface the ray hit, attenuated by how much
    // water is between it and the surface and by how much sun gets through.
    if (!far){
      float colUnder = max(-world.y, 0.0);
      float c = wcaustics(world.xz * 0.42 + vec2(wTime * 0.05, 0.0), wTime);
      c *= wsat(gn.y * 0.8 + 0.35) * exp(-colUnder * 0.14) * exp(-viewDist * 0.03);
      col += wSunColor * wScatter * c * 3.4 * wSunAbove;
    }

    // Looking sideways you sit in the bright near-surface layer, where multiple
    // scattering returns much of the light the single-scatter coefficients
    // remove; a flat 0.25 path scale stands in for that and keeps useful
    // visibility instead of a wall of soup at four metres.
    vec3 T = exp(-wExtinction * 0.25 * min(viewDist, 400.0));

    // The reconstructed position is already the far-plane point when nothing was
    // hit, so this is the view ray in both cases; the old sky branch built it out
    // of raw NDC and got a direction in no particular space.
    vec3 Vd = normalize(world - wCamPos);

    // The submerged radiance field is strongly anisotropic — every photon in it
    // came in through the surface, so looking up is several times brighter than
    // looking down into the bed, and that gradient is the only cue that tells a
    // viewer which way is up. Driving the murk from one depth-attenuated constant
    // instead paints the identical value over every pixel not resting on
    // geometry, which is why a submerged frame rendered as a solid green fill
    // with nothing in it but a vignette.
    float vertical = 0.45 + 0.85 * smoothstep(-0.65, 0.90, Vd.y);
    vec3 murk = wScatter * (wAmbient + wSunColor * 0.30 * wSunAbove)
              * exp(-depthBelow * 0.035) * vertical;
    vec3 under = col * T + murk * (1.0 - T);

    // A little forward scatter toward the sun keeps the column from reading as
    // flat fog when looking up into the light.
    float fwd = pow(wsat(dot(Vd, normalize(wSunDir))), 8.0);
    under += wSunColor * wScatter * fwd * 0.9 * wSunAbove * (1.0 - T.g);

    float vig = 1.0 - 0.35 * pow(length(vUv - 0.5) * 1.42, 2.2);
    under *= vig;

    col = mix(col, under, wSubmerged);
  }

  gl_FragColor = vec4(linearToSrgb(col), 1.0);
}
`;

export class WaterComposite {
  readonly uniforms: Record<string, THREE.IUniform>;
  private mesh: THREE.Mesh;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  private geometry: THREE.PlaneGeometry;
  private frame: THREE.FramebufferTexture;
  private zero = new THREE.Vector2(0, 0);
  private invVP = new THREE.Matrix4();

  constructor(shared: Record<string, THREE.IUniform>, w: number, h: number) {
    this.frame = new THREE.FramebufferTexture(w, h);
    this.frame.minFilter = THREE.LinearFilter;
    this.frame.magFilter = THREE.LinearFilter;
    this.frame.colorSpace = THREE.NoColorSpace;

    this.uniforms = {
      ...shared,
      wFrame: { value: this.frame },
      wDepth: { value: null },
      wInvVP: { value: this.invVP },
      wNearFar: { value: new THREE.Vector2(0.1, 600) },
      wCamPos: { value: new THREE.Vector3() },
      wSubmerged: { value: 0 },
      wShoreFade: { value: 1 },
      wDepthTexel: { value: new THREE.Vector2(1 / Math.max(1, w >> 1), 1 / Math.max(1, h >> 1)) },
    };

    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      fog: false,
      lights: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  resize(w: number, h: number): void {
    this.frame.dispose();
    this.frame = new THREE.FramebufferTexture(w, h);
    this.frame.minFilter = THREE.LinearFilter;
    this.frame.magFilter = THREE.LinearFilter;
    this.frame.colorSpace = THREE.NoColorSpace;
    this.uniforms.wFrame.value = this.frame;
    (this.uniforms.wDepthTexel.value as THREE.Vector2).set(1 / Math.max(1, w >> 1), 1 / Math.max(1, h >> 1));
  }

  /** Grabs the resolved canvas and re-composites it. Must run after the main
   *  render has landed on the default framebuffer. */
  run(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, refractionVP: THREE.Matrix4): void {
    this.invVP.copy(refractionVP).invert();
    (this.uniforms.wCamPos.value as THREE.Vector3).setFromMatrixPosition(camera.matrixWorld);

    renderer.setRenderTarget(null);
    renderer.copyFramebufferToTexture(this.frame, this.zero);

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.cam);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.frame.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
