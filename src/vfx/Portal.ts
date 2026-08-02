import * as THREE from 'three';
import { AERIAL_GLSL, aerialUniforms } from '../sky/Atmosphere';
import { VFX_COMMON, VFX_FRAG, VFX_NOISE, vfxUniforms } from './glsl';

/**
 * Conjuration portal — a rotating Daedric sigil with an emissive edge and a
 * vortex behind it.
 *
 * Three counter-rotating elements, because a single spinning disc reads as a
 * texture on a wheel: the glyph band turns one way, the tick ring the other,
 * and the vortex core shears faster than both. The interior is genuinely dark
 * (it is a hole into somewhere else) with the light pushed entirely onto the
 * rim, which is what stops it looking like a glowing coaster.
 */

const VERT = /* glsl */ `
precision highp float;
varying vec2  vUv;
varying vec3  vWorld;
varying float vViewDist;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * wp;
  vUv = uv;
  vWorld = wp.xyz;
  vViewDist = max(-mv.z, 0.001);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uSigil;
uniform vec3  uColor;
uniform vec3  uCore;
uniform float uOpen;      // 0..1 aperture animation
uniform float uEnergy;

varying vec2  vUv;
varying vec3  vWorld;
varying float vViewDist;

${VFX_NOISE}
${AERIAL_GLSL}
${VFX_COMMON}
${VFX_FRAG}

vec2 rot(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  float ang = atan(c.y, c.x);
  if (r > 1.0) discard;

  float open = clamp(uOpen, 0.0, 1.0);
  float aperture = 0.62 * open;

  // Glyph band and ring structure, counter-rotating.
  vec4 gl0 = texture2D(uSigil, rot(c, uVfxTime * 0.22) * 0.5 + 0.5);
  vec4 gl1 = texture2D(uSigil, rot(c, -uVfxTime * 0.11) * 0.5 + 0.5);
  float glyph = gl0.r;
  float ring = gl1.g;

  // Vortex: angular shear that accelerates toward the centre, so the core
  // spins up like a drain rather than turning as a rigid body.
  float swirl = ang + uVfxTime * (0.7 + 1.8 / max(r, 0.12));
  float vortex = vfxFbm(vec3(cos(swirl) * r * 3.0, sin(swirl) * r * 3.0, vfxNoiseT() * 0.5), 4);
  float core = 1.0 - smoothstep(aperture * 0.85, aperture, r);

  // The rim is where all the energy is.
  float rim = exp(-pow((r - aperture) / 0.055, 2.0)) * open;

  vec3 col = vec3(0.0);
  float a = 0.0;

  // Interior: near-black, lit only by the vortex filaments. Raising the
  // filament contrast is what makes the core read as a hole with something
  // moving in it rather than as a flat violet disc.
  float fil = pow(clamp(vortex * 1.35, 0.0, 1.0), 3.2);
  col += mix(vec3(0.004, 0.003, 0.010), uCore * 2.6, fil) * core;
  a += core * (0.80 + 0.20 * vortex);

  // Structure: glyphs and rings burn on the disc plane. The glyph band is the
  // whole Daedric read, so it gets the strongest emission after the rim.
  float band = smoothstep(aperture * 0.88, aperture * 1.02, r) * (1.0 - smoothstep(0.95, 1.0, r));
  float marks = max(glyph, ring * 0.85) * band * open;
  col += uColor * marks * (4.0 + 2.2 * sin(uVfxTime * 3.1 + r * 9.0));
  a += marks;

  col += uColor * rim * 6.0;
  a += rim * 0.9;

  a = clamp(a, 0.0, 1.0) * uEnergy;
  a *= vfxSoft(vWorld, vViewDist, 0.5);
  if (a < 0.004) discard;

  vec3 eye = vWorld - uVfxCamPos;
  col *= uEnergy * vfxAerialT(vViewDist, eye);
  gl_FragColor = vec4(col * a, a);
}
`;

/** One pooled portal. Constructed at init, never allocated at spawn time. */
export class Portal {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private geo: THREE.PlaneGeometry;
  private expiry = 0;
  private born = 0;
  private life = 0;

  constructor(sigil: THREE.Texture, renderOrder: number) {
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...vfxUniforms(),
        ...aerialUniforms(),
        uSigil: { value: sigil },
        uColor: { value: new THREE.Color(0.55, 0.25, 1.0) },
        uCore: { value: new THREE.Color(0.20, 0.06, 0.42) },
        uOpen: { value: 0 },
        uEnergy: { value: 0 },
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
    this.mesh.frustumCulled = true;
    this.mesh.renderOrder = renderOrder;
    this.mesh.castShadow = false;
    this.mesh.visible = false;
    this.mesh.name = 'vfx:portal';
  }

  get free(): boolean {
    return !this.mesh.visible;
  }

  get expiresAt(): number {
    return this.expiry;
  }

  open(pos: THREE.Vector3, facing: THREE.Vector3, size: number, life: number, now: number): void {
    this.mesh.position.copy(pos);
    // A portal stands in the world; it faces the caster but never tips over.
    const f = facing.lengthSq() > 1e-6 ? facing.clone().setY(facing.y * 0.35).normalize() : new THREE.Vector3(0, 0, 1);
    this.mesh.lookAt(pos.x + f.x, pos.y + f.y, pos.z + f.z);
    this.mesh.scale.setScalar(size);
    this.mesh.visible = true;
    this.born = now;
    this.life = life;
    this.expiry = now + life;
  }

  update(now: number): boolean {
    if (!this.mesh.visible) return false;
    if (now >= this.expiry) {
      this.mesh.visible = false;
      return false;
    }
    const u = (now - this.born) / Math.max(this.life, 1e-3);
    // Snap open, hold, iris shut.
    const open = Math.min(1, u / 0.14) * (1 - THREE.MathUtils.smoothstep(u, 0.78, 1.0));
    this.mat.uniforms.uOpen.value = open;
    this.mat.uniforms.uEnergy.value = Math.min(1, open * 1.3);
    return true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
