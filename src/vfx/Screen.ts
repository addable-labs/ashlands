import * as THREE from 'three';
import { VFX_BILLBOARD, VFX_COMMON, VFX_FRAG, VFX_NOISE, vfxUniforms } from './glsl';
import { AERIAL_GLSL } from '../sky/Atmosphere';

/**
 * Heat haze and arcane shimmer as a true screen-space refraction.
 *
 * The frame rendered so far is grabbed straight off the bound HDR framebuffer
 * with `copyFramebufferToTexture` immediately before the haze quads draw — the
 * classic grab pass — and re-sampled through a rising turbulence gradient. It
 * is a real refraction of the real scene, not a UV wobble applied to a sprite,
 * which is why the terrain behind a flame actually bends.
 *
 * The grab is guarded: if the bound target is not a floating-point colour
 * buffer (or the driver refuses the copy) the pass disables itself for the rest
 * of the session and the effect simply stops appearing, rather than spraying GL
 * errors every frame.
 */

export const HAZE_SLOTS = 8;

const VERT = /* glsl */ `
precision highp float;

attribute float aSlot;

uniform vec4 uHazeA[${HAZE_SLOTS}];   // centre.xyz, spawn time
uniform vec4 uHazeB[${HAZE_SLOTS}];   // radius, lifetime, strength, seed

varying vec2  vUv;
varying vec3  vWorld;
varying vec3  vInfo;    // x = envelope, y = strength, z = seed
varying float vViewDist;

${VFX_NOISE}
${VFX_COMMON}
${VFX_BILLBOARD}

void main() {
  int slot = int(aSlot + 0.5);
  vec4 A = uHazeA[slot];
  vec4 B = uHazeB[slot];

  float age = uVfxTime - A.w;
  float u = age / max(B.y, 1e-3);
  if (B.y <= 0.0 || u < 0.0 || u > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vec2(0.0);
    vWorld = vec3(0.0);
    vInfo = vec3(0.0);
    vViewDist = 1.0;
    return;
  }

  // Convection column: the disturbance rises and spreads as it cools.
  vec3 centre = A.xyz + vec3(0.0, u * B.x * 0.9, 0.0);
  float size = B.x * (0.7 + 0.8 * u);
  vec3 r, up, off;
  vfxBillboard(position.xy, 0.0, size, r, up, off);
  vec3 world = centre + off;

  vec4 mv = viewMatrix * vec4(world, 1.0);
  vUv = uv;
  vWorld = world;
  vInfo = vec3(smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.45, 1.0, u)), B.z, B.w);
  vViewDist = max(-mv.z, 0.001);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uGrab;
uniform vec2 uGrabTexel;

varying vec2  vUv;
varying vec3  vWorld;
varying vec3  vInfo;
varying float vViewDist;

${VFX_NOISE}
${AERIAL_GLSL}
${VFX_COMMON}
${VFX_FRAG}

void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float mask = 1.0 - smoothstep(0.2, 1.0, length(c));
  float a = mask * vInfo.x * vfxSoft(vWorld, vViewDist, 0.8);
  if (a < 0.006) discard;

  // Gradient of a rising noise field: the refraction normal of hot air.
  vec3 q = vWorld * 2.2 + vec3(0.0, -vfxNoiseT() * 2.6, vInfo.z);
  float e = 0.28;
  float n0 = vfxNoise(q);
  vec2 grad = vec2(vfxNoise(q + vec3(e, 0.0, 0.0)) - n0, vfxNoise(q + vec3(0.0, e, 0.0)) - n0);

  // Offsets are in screen UV, so they must shrink with distance or a plume
  // thirty metres out would smear a third of the frame.
  vec2 off = grad * vInfo.y * mask / (1.0 + vViewDist * 0.12);
  vec2 uv = clamp(gl_FragCoord.xy * uGrabTexel + off, vec2(0.002), vec2(0.998));
  vec3 col = texture2D(uGrab, uv).rgb;

  gl_FragColor = vec4(col * a, a);
}
`;

export interface HazeSpec {
  centre: THREE.Vector3;
  radius: number;
  life: number;
  strength: number;
}

export class HazePool {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private a: THREE.Vector4[] = [];
  private b: THREE.Vector4[] = [];
  private expiry = new Float32Array(HAZE_SLOTS);
  private next = 0;
  private grab: THREE.FramebufferTexture | null = null;
  private grabW = 0;
  private grabH = 0;
  private broken = false;

  constructor(renderOrder: number) {
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
        3,
      ),
    );
    this.geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    const slot = new Float32Array(HAZE_SLOTS);
    for (let i = 0; i < HAZE_SLOTS; i++) slot[i] = i;
    this.geo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slot, 1));
    this.geo.instanceCount = HAZE_SLOTS;
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    for (let i = 0; i < HAZE_SLOTS; i++) {
      this.a.push(new THREE.Vector4());
      this.b.push(new THREE.Vector4(1, 0, 0.02, 0));
    }

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...vfxUniforms(),
        uGrab: { value: null },
        uGrabTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
        uHazeA: { value: this.a },
        uHazeB: { value: this.b },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      premultipliedAlpha: true,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.castShadow = false;
    this.mesh.visible = false;
    this.mesh.name = 'vfx:haze';
    this.mesh.onBeforeRender = (renderer) => this.capture(renderer);
  }

  private capture(renderer: THREE.WebGLRenderer): void {
    if (this.broken) return;
    const rt = renderer.getRenderTarget();
    // Only ever grab from an offscreen HDR buffer. Copying out of the default
    // framebuffer would sample a tonemapped, gamma-encoded image and the
    // refracted region would jump in exposure.
    if (rt === null || rt.texture.type !== THREE.HalfFloatType) {
      this.mesh.visible = false;
      return;
    }
    if (this.grab === null || this.grabW !== rt.width || this.grabH !== rt.height) {
      this.grab?.dispose();
      const t = new THREE.FramebufferTexture(rt.width, rt.height);
      t.type = THREE.HalfFloatType;
      t.format = THREE.RGBAFormat;
      t.internalFormat = 'RGBA16F';
      t.colorSpace = THREE.LinearSRGBColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      t.name = 'vfx:grab';
      this.grab = t;
      this.grabW = rt.width;
      this.grabH = rt.height;
      this.mat.uniforms.uGrab.value = t;
      this.mat.uniforms.uGrabTexel.value.set(1 / rt.width, 1 / rt.height);
    }
    try {
      renderer.copyFramebufferToTexture(this.grab);
    } catch {
      // One failure is enough: a driver that refuses this copy will refuse it
      // every frame, and an exception per frame is worse than no heat haze.
      this.broken = true;
      this.mesh.visible = false;
    }
  }

  add(s: HazeSpec, now: number): void {
    let idx = -1;
    for (let i = 0; i < HAZE_SLOTS; i++) {
      const k = (this.next + i) % HAZE_SLOTS;
      if (this.expiry[k] <= now) {
        idx = k;
        break;
      }
    }
    if (idx < 0) {
      let oldest = 0;
      for (let i = 1; i < HAZE_SLOTS; i++) if (this.expiry[i] < this.expiry[oldest]) oldest = i;
      idx = oldest;
    }
    this.next = (idx + 1) % HAZE_SLOTS;
    this.expiry[idx] = now + s.life;
    this.a[idx].set(s.centre.x, s.centre.y, s.centre.z, now);
    this.b[idx].set(s.radius, s.life, s.strength, Math.random() * 40);
    this.mat.uniformsNeedUpdate = true;
  }

  update(now: number): number {
    if (this.broken) return 0;
    let live = 0;
    for (let i = 0; i < HAZE_SLOTS; i++) {
      if (this.expiry[i] > now) live++;
      else if (this.b[i].y !== 0) this.b[i].y = 0;
    }
    this.mesh.visible = live > 0;
    return live;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.grab?.dispose();
    this.grab = null;
  }
}
