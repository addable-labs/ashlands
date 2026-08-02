import * as THREE from 'three';
import { AERIAL_GLSL, aerialUniforms } from '../sky/Atmosphere';
import type { FloraAtlas } from './Atlas';
import type { BuiltMesh } from './Build';
import { DITHER_GLSL, HASH_GLSL, SSS_GLSL, WIND_GLSL } from './Glsl';
import type { FloraUniforms } from './Materials';

/**
 * Octagonal billboard impostors for the parasols.
 *
 * A 20 m mushroom is still four or five pixels wide at 800 m, and there are
 * hundreds of them on a ridge shot. Eight azimuths per variant, baked once at
 * boot from the LOD1 mesh into an albedo+normal atlas, is enough that the
 * silhouette still turns as the camera orbits — a single cross-quad would strobe
 * as the wide axis swings past the eye, which is exactly the artefact the 2002
 * game is remembered for.
 *
 * The impostors are shaded, not pasted: the baked normal is rotated by the
 * instance yaw and lit by the same sun, so a distant grove goes warm at dawn
 * with everything else instead of staying a flat cut-out.
 */

const NAZ = 8;
const TILE = 192;
/** Horizontal and vertical padding of the baked frustum, as a fraction. */
const PAD = 1.06;
const VPAD = 0.03;

export interface ImpostorSet {
  mesh: THREE.Mesh;
  geometry: THREE.InstancedBufferGeometry;
  material: THREE.ShaderMaterial;
  /** Per-instance buffers, written by the canopy each frame. */
  iPos: THREE.InstancedBufferAttribute;
  iData: THREE.InstancedBufferAttribute;
  capacity: number;
  dispose(): void;
}

const BAKE_VERT = /* glsl */ `
varying vec2 vBUv;
varying vec3 vBNormal;
varying vec3 vBPos;
varying vec4 vBParam;
attribute vec4 aParam;
void main() {
  vBUv = uv;
  vBNormal = normal;
  vBPos = position;
  vBParam = aParam;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Octahedral normal encoding.
 *
 * Two channels instead of three, which frees the other two for the glow mask and
 * the subsurface thickness — the impostor needs both if it is to run the same
 * shading model as the mesh it stands in for, and a second render target for one
 * scalar each would be absurd. It is also strictly better precision than xyz*0.5
 * +0.5 in eight bits, because the encoding uses the full square.
 */
const OCT_GLSL = /* glsl */ `
vec2 octEncode(vec3 n) {
  n /= (abs(n.x) + abs(n.y) + abs(n.z) + 1e-6);
  vec2 e = n.xy;
  if (n.z < 0.0) {
    e = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  }
  return e * 0.5 + 0.5;
}
vec3 octDecode(vec2 e) {
  vec2 f = e * 2.0 - 1.0;
  vec3 n = vec3(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
  float t = max(-n.z, 0.0);
  n.x += n.x >= 0.0 ? -t : t;
  n.y += n.y >= 0.0 ? -t : t;
  return normalize(n);
}
`;

const BAKE_ALBEDO_FRAG = /* glsl */ `
uniform sampler2D uAlb;
uniform sampler2D uArmTex;
uniform vec3 uTint;
varying vec2 vBUv;
varying vec4 vBParam;
void main() {
  vec3 c = texture2D(uAlb, vBUv).rgb * uTint;
  // Fold the baked ambient occlusion in: at impostor range there is no shading
  // detail left, so the AO has to live in the albedo or the whole plant flattens.
  float ao = clamp(texture2D(uArmTex, vBUv).r * vBParam.w, 0.0, 1.0);
  gl_FragColor = vec4(c * (0.45 + 0.55 * ao), 1.0);
}
`;

/**
 * rg = octahedral object-space normal, WITH the atlas normal map applied.
 * b  = bioluminescence mask.  a = subsurface thickness.
 *
 * Baking the bare geometric normal is why the billboard read as an unshaded
 * cut-out: the mesh LOD it replaces is normal-mapped and translucent, and the
 * impostor had neither, so the two could not possibly agree about how the plant
 * responds to a light. The tangent frame is analytic rather than derivative
 * based — every band in the flora atlas is a lathe, u IS the azimuth, so the
 * tangent is the azimuthal direction about the plant's own growth axis and the
 * bitangent falls out of the cross product. No derivative extension, no
 * screen-space frame, and exact on the surfaces that matter.
 */
const BAKE_NORMAL_FRAG = /* glsl */ `
uniform sampler2D uArmTex;
uniform sampler2D uNrmTex;
varying vec2 vBUv;
varying vec3 vBNormal;
varying vec3 vBPos;
varying vec4 vBParam;
${OCT_GLSL}
void main() {
  vec3 n = normalize(vBNormal);
  if (!gl_FrontFacing) n = -n;

  vec2 rad = vBPos.xz;
  float rl = length(rad);
  if (rl > 1e-3) {
    vec3 T = vec3(-rad.y, 0.0, rad.x) / rl;   // azimuthal, = d(pos)/du
    T = normalize(T - n * dot(n, T));
    vec3 B = cross(n, T);
    vec3 mn = texture2D(uNrmTex, vBUv).xyz * 2.0 - 1.0;
    n = normalize(mat3(T, B, n) * mn);
  }

  vec4 arm = texture2D(uArmTex, vBUv);
  gl_FragColor = vec4(octEncode(n), arm.b * vBParam.z, arm.a * vBParam.y);
}
`;

const IMPOSTOR_VERT = /* glsl */ `
${HASH_GLSL}
${WIND_GLSL}
uniform vec2  uQuadV[IMPOSTOR_VARIANTS];  // per-variant (radius, height) of the baked box
uniform float uWindAmp;
attribute vec4 iPos;      // xyz = base, w = scale
attribute vec4 iData;     // x = yaw, y = variant, z = seed, w = signed LOD coverage
varying vec2  vBUv;
varying vec3  vBWorld;
varying float vBYaw;
varying float vBSeed;
varying float vBFade;

void main() {
  vec3 origin = iPos.xyz;
  float sc = iPos.w;

  // Cylindrical billboard: yaw-only, so a parasol never tips toward the camera.
  vec2 toCam = cameraPosition.xz - origin.xz;
  float len = max(length(toCam), 1e-4);
  vec2 d = toCam / len;
  vec3 right = vec3(d.y, 0.0, -d.x);

  vec2 box = uQuadV[int(iData.y)];
  float yLocal = (position.y * (1.0 + 2.0 * ${VPAD.toFixed(3)}) - ${VPAD.toFixed(3)}) * box.y;
  vec3 wp = origin + right * (position.x * 2.0 * box.x * ${PAD.toFixed(3)} * sc) + vec3(0.0, yLocal * sc, 0.0);

  // The billboard leans on the same gust the meshes do, so a mixed-LOD grove
  // does not have half its trees moving and half of them frozen.
  vec3 wnd = floraWind(origin.xz, iData.z);
  wp.xz += wnd.xy * (uWindAmp * position.y * position.y * sc);

  // Pick the baked azimuth nearest to the view direction, in the plant's frame.
  float viewAng = atan(toCam.x, toCam.y);
  float rel = viewAng - iData.x;
  float naz = ${NAZ}.0;
  float k = floor(mod(rel / 6.2831853 * naz + 0.5, naz));
  vBUv = vec2((k + position.x + 0.5) / naz, (iData.y + position.y) / IMPOSTOR_ROWS);

  vBWorld = wp;
  vBYaw = iData.x;
  vBSeed = iData.z;
  vBFade = iData.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const IMPOSTOR_FRAG = /* glsl */ `
${HASH_GLSL}
${DITHER_GLSL}
${AERIAL_GLSL}
${OCT_GLSL}
${SSS_GLSL}
uniform sampler2D uImpAlbedo;
uniform sampler2D uImpNormal;
uniform vec3  uGlowColor;
uniform float uGlowNight;
varying vec2  vBUv;
varying vec3  vBWorld;
varying float vBYaw;
varying float vBSeed;
varying float vBFade;

#define IMP_RECIP_PI 0.31830988618

void main() {
  vec4 a = texture2D(uImpAlbedo, vBUv);
  // Hashed coverage rather than a hard cut: a bilinear-filtered alpha edge
  // thresholded at a constant is exactly the crunchy billboard edge we are
  // trying to leave behind, and there is no MSAA here to soften it.
  floraDither(smoothstep(0.18, 0.72, a.a), vBSeed + 0.37);
  floraDither(vBFade, vBSeed);

  vec4 nt = texture2D(uImpNormal, vBUv);
  vec3 n = octDecode(nt.xy);
  float cy = cos(vBYaw);
  float sy = sin(vBYaw);
  n = normalize(vec3(cy * n.x + sy * n.z, n.y, -sy * n.x + cy * n.z));

  /**
   * The same BRDF the mesh LODs use.
   *
   * three's Lambert term is albedo * NdotL * radiance / PI. This shader was
   * using a bare 0.85 in place of that 1/PI — 2.7x brighter than the mesh it
   * hands over from — and a CONSTANT 0.85 * skyRadiance for the ambient. Under
   * an ash storm, where the sun is extinguished and the ambient dome carries
   * almost all the light, "constant ambient times albedo" is literally a flat
   * fill: that is the unshaded cut-out the review found, and no amount of LOD
   * distance would have hidden it.
   *
   * The ambient is now hemispheric, which is what the mesh path actually
   * receives from the sky's PMREM environment: roughly three to one between a
   * surface facing the sky dome and one facing the ash it stands on.
   */
  float ndl = max(dot(n, uSunDirW), 0.0);
  vec3 amb = uSkyRadW * (0.52 + 0.48 * (n.y * 0.5 + 0.5));
  vec3 col = a.rgb * (uSunRadW * ndl + amb) * IMP_RECIP_PI;

  // The identical two-lobe transmission the mesh runs, against the thickness
  // baked into the impostor's own alpha channel. Without this a grove would
  // stop glowing the instant it crossed the LOD boundary at dawn, which is a
  // far louder pop than any silhouette change.
  col += floraSSS(n, vBWorld, nt.a) * (0.35 + 1.20 * a.rgb);

  // Same chroma/intensity split the mesh path uses, so a grove does not change
  // hue as it crosses the impostor boundary.
  vec3 gch = uGlowColor / max(max(uGlowColor.r, uGlowColor.g), max(uGlowColor.b, 1e-4));
  col += gch * min(nt.b * uGlowNight, 1.15);

  vec3 eye = vBWorld - cameraPosition;
  gl_FragColor = vec4(applyAerial(col, length(eye), eye), 1.0);
}
`;

/** Render the variant meshes into an albedo+normal impostor atlas. */
export function bakeImpostors(
  renderer: THREE.WebGLRenderer,
  variants: BuiltMesh[],
  atlas: FloraAtlas,
  tint: THREE.Color,
): { albedo: THREE.WebGLRenderTarget; normal: THREE.WebGLRenderTarget; rows: number } {
  const rows = variants.length;
  const w = TILE * NAZ;
  const h = TILE * rows;

  /**
   * Mipped, deliberately.
   *
   * A 192-pixel tile resolves to forty or fifty pixels at the distance these
   * are actually drawn, so an unmipped bilinear fetch is a 4x minification —
   * every ring and gill in the baked albedo aliases, and a ridge full of
   * impostors crawls as the camera moves. The eight azimuths share a row, so the
   * top of the chain does bleed one azimuth into the next; that shows up as a
   * one-pixel softening of the silhouette at 900 m and is a trade worth making
   * against a shimmering horizon.
   */
  const opts: THREE.RenderTargetOptions = {
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: true,
    depthBuffer: true,
  };
  const rtA = new THREE.WebGLRenderTarget(w, h, { ...opts, type: THREE.HalfFloatType });
  const rtN = new THREE.WebGLRenderTarget(w, h, { ...opts, type: THREE.UnsignedByteType });

  const matA = new THREE.ShaderMaterial({
    vertexShader: BAKE_VERT,
    fragmentShader: BAKE_ALBEDO_FRAG,
    uniforms: {
      uAlb: { value: atlas.albedo },
      uArmTex: { value: atlas.arm },
      uTint: { value: tint.clone() },
    },
    side: THREE.DoubleSide,
  });
  const matN = new THREE.ShaderMaterial({
    vertexShader: BAKE_VERT,
    fragmentShader: BAKE_NORMAL_FRAG,
    uniforms: { uArmTex: { value: atlas.arm }, uNrmTex: { value: atlas.normal } },
    side: THREE.DoubleSide,
  });

  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(variants[0].geometry, matA);
  scene.add(mesh);

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = new THREE.Color();
  renderer.getClearColor(prevClear);
  const prevAlpha = renderer.getClearAlpha();
  const prevAuto = renderer.autoClear;
  const prevScissorTest = renderer.getScissorTest();

  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(rtA);
  renderer.setScissorTest(false);
  renderer.clear(true, true, false);
  // The normal target must NOT clear to zero. Zero decodes, octahedrally, to a
  // normalised (-1,-1,-1) — so every silhouette pixel that bilinear filtering
  // or a mip level blends with the background would acquire a normal pointing
  // down and away, and the plant would get a dark fringe all the way round.
  // Clearing to the encoding of straight up leaves the blend harmless.
  renderer.setClearColor(new THREE.Color(0.5, 1.0, 0.0), 0);
  renderer.setRenderTarget(rtN);
  renderer.setScissorTest(false);
  renderer.clear(true, true, false);
  renderer.autoClear = false;

  // Elevation of 4 degrees: enough that the top of a cap is not perfectly
  // edge-on, small enough that a vertical runtime quad is not visibly wrong.
  const elev = (4 * Math.PI) / 180;
  const ce = Math.cos(elev);
  const se = Math.sin(elev);

  for (let r = 0; r < rows; r++) {
    const v = variants[r];
    mesh.geometry = v.geometry;
    const R = Math.max(v.radius, 0.05) * PAD;
    const H = Math.max(v.height, 0.05);
    cam.left = -R;
    cam.right = R;
    cam.bottom = -VPAD * H;
    cam.top = (1 + VPAD) * H;
    cam.near = 1;
    cam.far = 4000;
    cam.updateProjectionMatrix();

    for (let k = 0; k < NAZ; k++) {
      const phi = (k / NAZ) * Math.PI * 2;
      const D = Math.max(R, H) * 4 + 20;
      cam.position.set(Math.sin(phi) * ce * D, se * D + H * 0.5, Math.cos(phi) * ce * D);
      cam.up.set(0, 1, 0);
      cam.lookAt(0, H * 0.5, 0);
      cam.updateMatrixWorld();

      const x = k * TILE;
      const y = r * TILE;
      for (const [rt, mat] of [
        [rtA, matA],
        [rtN, matN],
      ] as const) {
        mesh.material = mat;
        renderer.setRenderTarget(rt);
        renderer.setViewport(x, y, TILE, TILE);
        renderer.setScissor(x, y, TILE, TILE);
        renderer.setScissorTest(true);
        // Depth must be cleared per tile or the previous azimuth occludes this one.
        renderer.clear(false, true, false);
        renderer.render(scene, cam);
      }
    }
  }

  renderer.setScissorTest(prevScissorTest);
  renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
  renderer.autoClear = prevAuto;
  // Restore the target FIRST: three encodes the clear colour into the colour
  // space of whatever is currently bound, so putting the caller's colour back
  // while a linear render target is still bound writes the wrong value.
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);

  matA.dispose();
  matN.dispose();
  scene.clear();

  return { albedo: rtA, normal: rtN, rows };
}

/** Build the instanced billboard layer that draws the baked atlas. */
export function createImpostorSet(
  baked: { albedo: THREE.WebGLRenderTarget; normal: THREE.WebGLRenderTarget; rows: number },
  shared: FloraUniforms,
  boxes: THREE.Vector2[],
  windAmp: number,
  capacity: number,
): ImpostorSet {
  const geo = new THREE.InstancedBufferGeometry();
  // Unit quad: x across in [-0.5, 0.5], y up in [0, 1].
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3),
  );
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const iData = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  iPos.setUsage(THREE.DynamicDrawUsage);
  iData.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', iPos);
  geo.setAttribute('iData', iData);
  geo.instanceCount = 0;
  // Culled by the canopy, per bucket; a single sphere over the whole world is
  // useless and three's own test would simply never reject.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const uniforms: FloraUniforms = {
    uImpAlbedo: { value: baked.albedo.texture },
    uImpNormal: { value: baked.normal.texture },
    uQuadV: { value: boxes.map((v) => v.clone()) },
    uWindAmp: { value: windAmp },
  };
  for (const k in shared) if (!(k in uniforms)) uniforms[k] = shared[k];
  const aerial = aerialUniforms();
  for (const k in aerial) if (!(k in uniforms)) uniforms[k] = aerial[k];

  const material = new THREE.ShaderMaterial({
    vertexShader: IMPOSTOR_VERT.replace('IMPOSTOR_ROWS', `${baked.rows}.0`).replace(
      'IMPOSTOR_VARIANTS',
      `${boxes.length}`,
    ),
    fragmentShader: IMPOSTOR_FRAG,
    uniforms,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  });

  /**
   * Opt the billboards out of the G-buffer prepass.
   *
   * The render pipeline replaces the material of anything it does not recognise
   * with a generic override that has never heard of `iPos`, which would stamp a
   * pile of coincident quads at the world origin over the normal and velocity
   * buffers. Declaring a prepass material is the sanctioned way to say "skip
   * me", and skipping is the right answer here: impostors live past the shadow
   * cascade and past any useful AO radius, and they are static in world space so
   * TAA's camera-only reprojection fallback is exactly correct for them.
   */
  const nullPrepass = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: 'void main() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }',
    fragmentShader: 'precision highp float;\nvoid main() { discard; }',
    colorWrite: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.name = 'flora:impostor';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.prepassMaterial = nullPrepass;

  return {
    mesh,
    geometry: geo,
    material,
    iPos,
    iData,
    capacity,
    dispose(): void {
      geo.dispose();
      material.dispose();
      nullPrepass.dispose();
      baked.albedo.dispose();
      baked.normal.dispose();
    },
  };
}
