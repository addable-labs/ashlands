import * as THREE from 'three';
import { AERIAL_GLSL, aerialUniforms } from '../sky/Atmosphere';
import { VFX_BILLBOARD, VFX_COMMON, VFX_FRAG, VFX_NOISE, vfxUniforms } from './glsl';

/**
 * Pooled magic VFX.
 *
 * Every spell burst in flight is one slot in a fixed-size emitter pool, and the
 * whole pool draws in a single instanced call. Spawning costs six vector writes
 * into a uniform array — no geometry allocation, no attribute upload, nothing
 * for the GC. Each particle's trajectory is a closed form of (slot uniforms,
 * instance seed, time), so the CPU never touches a particle again after the
 * spawn frame.
 *
 * Two batches exist because blending is not a per-instance property: hot
 * emissive matter (fire, shock, restoration motes) is ADDITIVE, and cold
 * particulate (frost dust, impact grit, splash) is ALPHA. An effect that needs
 * both simply claims a slot in each.
 */

/** Emitter slots per batch. 6 vec4 arrays x this = the uniform footprint. */
export const SLOTS = 12;
/** Instances drawn per slot. Alpha ramps handle sub-emission over the lifetime. */
export const PER_SLOT = 128;

/** `look` codes, per emitter — how the fragment stage shades the sprite. */
export const LOOK_PLAIN = 0;
export const LOOK_FIRE = 1;
export const LOOK_CRYSTAL = 2;
export const LOOK_SHIMMER = 3;
export const LOOK_SMOKE = 4;

const VERT = /* glsl */ `
precision highp float;

attribute float aSlot;
attribute vec4  aSeed;

uniform vec4 uEmitA[${SLOTS}];   // origin.xyz, spawn time
uniform vec4 uEmitB[${SLOTS}];   // direction.xyz, dir bias
uniform vec4 uEmitC[${SLOTS}];   // colour.rgb, lifetime
uniform vec4 uEmitD[${SLOTS}];   // size, intensity, seed, turbulence frequency
uniform vec4 uEmitE[${SLOTS}];   // speed, gravity, converge radius, swirl amplitude
uniform vec4 uEmitF[${SLOTS}];   // tile.xy, look, softness

varying vec2  vUv;
varying vec3  vWorld;
varying vec3  vRight;
varying vec3  vUpv;
varying vec4  vTint;      // rgb = colour, a = coverage multiplier
varying vec4  vShape;     // x = normalised age, y = look, z = soft metres, w = intensity
varying vec2  vTile;
varying float vViewDist;
varying float vSeed;

${VFX_NOISE}
${VFX_COMMON}
${VFX_BILLBOARD}

void main() {
  int slot = int(aSlot + 0.5);
  vec4 A = uEmitA[slot];
  vec4 B = uEmitB[slot];
  vec4 C = uEmitC[slot];
  vec4 D = uEmitD[slot];
  vec4 E = uEmitE[slot];
  vec4 F = uEmitF[slot];

  float life = C.w;
  float age = uVfxTime - A.w;

  // Stagger emission across the first third of the burst, then give each
  // particle its own lifetime. One slot therefore reads as a continuous jet
  // rather than a single synchronous pop.
  float birth = aSeed.w * life * 0.34;
  float pt = age - birth;
  float plife = life * (0.5 + 0.5 * aSeed.x) * 0.72;
  float u = pt / max(plife, 1e-3);

  if (life <= 0.0 || pt < 0.0 || u > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vTint = vec4(0.0);
    vShape = vec4(0.0);
    vTile = vec2(0.0);
    vUv = vec2(0.0);
    vWorld = vec3(0.0);
    vRight = vec3(1.0, 0.0, 0.0);
    vUpv = vec3(0.0, 1.0, 0.0);
    vViewDist = 1.0;
    vSeed = 0.0;
    return;
  }

  float sid = D.z + aSeed.z * 91.7 + float(slot) * 13.3;
  vec3 rnd = normalize(vfxHash31(sid) * 2.0 - 1.0 + vec3(1e-4));
  vec3 dir = length(B.xyz) > 1e-4 ? normalize(B.xyz) : vec3(0.0, 1.0, 0.0);
  vec3 emitDir = normalize(mix(rnd, dir, clamp(B.w, 0.0, 1.0)));

  vec3 pos;
  if (E.z > 0.01) {
    // Convergent shell — restoration and alteration draw the world's motes
    // INWARD onto the target. The inward march plus an orbital term is what
    // makes it read as gathering rather than as an explosion played backwards.
    float r = E.z * (1.0 - u) * (0.35 + 0.65 * aSeed.z);
    vec3 tangent = normalize(cross(emitDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-3, 0.0, 0.0));
    float ang = aSeed.x * 6.2831 + u * E.w * 5.0;
    pos = A.xyz + (emitDir * cos(ang) + tangent * sin(ang)) * r
        + vec3(0.0, (1.0 - (1.0 - u) * (1.0 - u)) * E.z * 0.35, 0.0);
  } else {
    pos = A.xyz + emitDir * E.x * pt * (0.35 + 1.3 * aSeed.y);
    pos.y += 0.5 * E.y * pt * pt;
    // Curl, not raw noise: a divergent field tears a flame plume apart.
    pos += vfxCurl(pos * D.w + vec3(0.0, -vfxNoiseT() * 0.8, 0.0), 0.5) * E.w * pt;
  }

  // Never let a burst sink through the floor; ground contact is what sells it.
  float gh = vfxGroundH(pos.xz);
  if (gh > VFX_NO_GROUND * 0.5 && pos.y < gh + 0.05) {
    pos.y = gh + 0.05;
  }

  float size = D.x * (0.45 + 0.9 * aSeed.x) * mix(0.55, 1.55, u);
  float spin = aSeed.w * 6.2831 + pt * (aSeed.z - 0.5) * 2.4;

  vec3 r, up, off;
  vfxBillboard(position.xy, spin, size, r, up, off);
  vec3 world = pos + off;

  vec4 mv = viewMatrix * vec4(world, 1.0);
  float d = max(-mv.z, 0.001);

  // Rise and fall: fast attack, long decay. Squaring the tail keeps embers
  // visible long after the flash has gone.
  float env = smoothstep(0.0, 0.10, u) * (1.0 - u) * (1.0 - u);
  env *= smoothstep(0.2, 1.2, d);

  vUv = uv;
  vWorld = world;
  vRight = r;
  vUpv = up;
  vTint = vec4(C.rgb, env);
  vShape = vec4(u, F.z, F.w, D.y);
  vTile = F.xy;
  vViewDist = d;
  vSeed = aSeed.z;

  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uAtlas;
uniform float uEmissive;

varying vec2  vUv;
varying vec3  vWorld;
varying vec3  vRight;
varying vec3  vUpv;
varying vec4  vTint;
varying vec4  vShape;
varying vec2  vTile;
varying float vViewDist;
varying float vSeed;

${VFX_NOISE}
${AERIAL_GLSL}
${VFX_COMMON}
${VFX_FRAG}

void main() {
  if (vTint.a < 0.002) discard;
  vec2 tuv = vTile + clamp(vUv, 0.008, 0.992) * 0.5;
  vec4 s = texture2D(uAtlas, tuv);
  float cov = s.a;

  float u = vShape.x;
  int look = int(vShape.y + 0.5);
  vec3 col = vTint.rgb;

  if (look == ${LOOK_FIRE} || look == ${LOOK_SMOKE}) {
    // Turbulent combustion. TWO noise domains, and both are load-bearing:
    //  - world space, scrolling upward, so neighbouring sprites tear along the
    //    same flow and the burst reads as one plume rather than as N sprites;
    //  - the sprite's own UV at high frequency, which is what actually destroys
    //    the circular silhouette. With the world term alone every particle kept
    //    a round edge and the whole effect read as a cluster of bokeh discs.
    float nw = vfxFbm(vWorld * 3.0 + vec3(0.0, -vfxNoiseT() * 2.2, 0.0), 3);
    float ns = vfxFbm(vec3(vUv * 6.5, vfxNoiseT() * 0.8 + vSeed * 31.0), 3);
    float n = nw * 0.55 + ns * 0.80;
    float rr = length(vUv * 2.0 - 1.0);
    float edge = rr * (0.50 + 1.10 * n) + u * 0.30;
    cov *= 1.0 - smoothstep(0.36, 0.94, edge);
    float heat = clamp(1.25 - u * 1.6, 0.0, 1.0);
    vec3 soot = vec3(0.055, 0.040, 0.034);
    // Bounded: an unclamped white core on top of an already-HDR tint clipped
    // the whole plume to a flat white blob and threw away every bit of the
    // turbulence above.
    if (look == ${LOOK_FIRE}) col = mix(soot, col, heat) * (0.5 + 1.25 * heat);
  } else if (look == ${LOOK_CRYSTAL}) {
    // Faceted glint: the sprite's own relief drives a sharp specular flash so
    // frost reads as crystal rather than as blue smoke.
    float facet = pow(max(s.z, 0.0), 6.0);
    col += vec3(0.75, 0.92, 1.0) * facet * (0.5 + 0.5 * sin(vSeed * 40.0 + uVfxTime * 9.0));
    cov *= 0.55 + 0.45 * facet;
  } else if (look == ${LOOK_SHIMMER}) {
    // Illusion: a low-frequency interference beat across the sprite, so the
    // violet shimmer has internal structure without reading as hatching. At 34
    // cycles it was literally a screen door.
    float band = 0.5 + 0.5 * sin((vUv.x + vUv.y * 1.7) * 9.0 + uVfxTime * 3.0 + vSeed * 17.0);
    band *= 0.5 + 0.5 * sin((vUv.x - vUv.y) * 5.0 - uVfxTime * 1.7);
    col *= 0.55 + 1.15 * band;
    cov *= 0.55 + 0.55 * band;
  }

  vec3 eye = vWorld - uVfxCamPos;
  float a = cov * vTint.a * vfxSoft(vWorld, vViewDist, vShape.z);
  if (a < 0.0025) discard;

  if (uEmissive > 0.5) {
    col *= vShape.w * vfxAerialT(vViewDist, eye);
  } else {
    vec3 V = -normalize(eye);
    vec2 c = vUv * 2.0 - 1.0;
    float z = sqrt(max(0.0, 1.0 - dot(c, c)));
    vec3 tn = s.xyz * 2.0 - 1.0;
    vec3 N = normalize(vRight * (c.x + tn.x * 0.7) + vUpv * (c.y + tn.y * 0.7) + V * max(z, 0.25));
    col = applyAerial(vfxLitParticle(col, N, V, 0.7, mix(1.0, 0.6, cov), 0.8, 0.6, 1.6), vViewDist, eye);
  }

  gl_FragColor = vec4(col * a, a);
}
`;

/** Per-emitter parameters. Everything a spawn needs to fill one pool slot. */
export interface EmitSpec {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  /** 0 = fully spherical spray, 1 = a tight beam along `dir`. */
  dirBias: number;
  color: THREE.Color;
  life: number;
  size: number;
  intensity: number;
  speed: number;
  gravity: number;
  /** >0 turns the emitter into an inward-converging shell of this radius. */
  converge: number;
  swirl: number;
  turbFreq: number;
  tile: number;
  look: number;
  soft: number;
}

export class SpellBatch {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private a: THREE.Vector4[] = [];
  private b: THREE.Vector4[] = [];
  private c: THREE.Vector4[] = [];
  private d: THREE.Vector4[] = [];
  private e: THREE.Vector4[] = [];
  private f: THREE.Vector4[] = [];
  /** Absolute time at which each slot frees up. */
  private expiry = new Float32Array(SLOTS);
  private next = 0;

  constructor(atlas: THREE.Texture, emissive: boolean, renderOrder: number) {
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

    const n = SLOTS * PER_SLOT;
    const slot = new Float32Array(n);
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      slot[i] = Math.floor(i / PER_SLOT);
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
    }
    this.geo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slot, 1));
    this.geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    this.geo.instanceCount = n;
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    for (let i = 0; i < SLOTS; i++) {
      this.a.push(new THREE.Vector4());
      this.b.push(new THREE.Vector4(0, 1, 0, 0));
      this.c.push(new THREE.Vector4(1, 1, 1, 0));
      this.d.push(new THREE.Vector4(0.2, 1, 0, 0.4));
      this.e.push(new THREE.Vector4());
      this.f.push(new THREE.Vector4(0.5, 0, 0, 0.6));
    }

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...vfxUniforms(),
        ...aerialUniforms(),
        uAtlas: { value: atlas },
        uEmissive: { value: emissive ? 1 : 0 },
        uEmitA: { value: this.a },
        uEmitB: { value: this.b },
        uEmitC: { value: this.c },
        uEmitD: { value: this.d },
        uEmitE: { value: this.e },
        uEmitF: { value: this.f },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      premultipliedAlpha: true,
      blending: emissive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.castShadow = false;
    this.mesh.visible = false;
    this.mesh.name = emissive ? 'vfx:spell:add' : 'vfx:spell:alpha';
  }

  /**
   * Claim a slot. Round-robin over expired slots first, then over the oldest —
   * a fixed pool must degrade by dropping the stalest effect, never by
   * allocating.
   */
  emit(s: EmitSpec, now: number): void {
    let idx = -1;
    for (let i = 0; i < SLOTS; i++) {
      const k = (this.next + i) % SLOTS;
      if (this.expiry[k] <= now) {
        idx = k;
        break;
      }
    }
    if (idx < 0) {
      let oldest = 0;
      for (let i = 1; i < SLOTS; i++) if (this.expiry[i] < this.expiry[oldest]) oldest = i;
      idx = oldest;
    }
    this.next = (idx + 1) % SLOTS;
    this.expiry[idx] = now + s.life;

    this.a[idx].set(s.origin.x, s.origin.y, s.origin.z, now);
    this.b[idx].set(s.dir.x, s.dir.y, s.dir.z, s.dirBias);
    this.c[idx].set(s.color.r, s.color.g, s.color.b, s.life);
    this.d[idx].set(s.size, s.intensity, Math.random() * 500, s.turbFreq);
    this.e[idx].set(s.speed, s.gravity, s.converge, s.swirl);
    this.f[idx].set((s.tile & 1) * 0.5, (s.tile >> 1) * 0.5, s.look, s.soft);
    this.mat.uniformsNeedUpdate = true;
  }

  /** Retire finished slots and hide the whole batch when the pool is idle. */
  update(now: number): number {
    let live = 0;
    for (let i = 0; i < SLOTS; i++) {
      if (this.expiry[i] > now) live++;
      else if (this.c[i].w !== 0) this.c[i].w = 0;
    }
    this.mesh.visible = live > 0;
    return live;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/* ---------------------------------------------------------------- decals */

export const DECALS = 24;

export const DECAL_SCORCH = 0;
export const DECAL_FROST = 1;
export const DECAL_SPLASH = 2;
export const DECAL_RIPPLE = 3;

const DECAL_VERT = /* glsl */ `
precision highp float;

attribute float aSlot;

uniform vec4 uDecA[${DECALS}];   // centre.xyz, spawn time
uniform vec4 uDecB[${DECALS}];   // colour.rgb, lifetime
uniform vec4 uDecC[${DECALS}];   // radius, kind, seed, rotation
uniform vec4 uDecD[${DECALS}];   // surface normal.xyz, unused

varying vec2  vUv;
varying vec3  vWorld;
varying vec3  vN;
varying vec4  vTint;
varying vec3  vInfo;   // x = normalised age, y = kind, z = seed
varying float vViewDist;

${VFX_NOISE}
${VFX_COMMON}

void main() {
  int slot = int(aSlot + 0.5);
  vec4 A = uDecA[slot];
  vec4 B = uDecB[slot];
  vec4 C = uDecC[slot];
  vec4 D = uDecD[slot];

  float age = uVfxTime - A.w;
  float u = age / max(B.w, 1e-3);
  if (B.w <= 0.0 || u < 0.0 || u > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vec2(0.0);
    vWorld = vec3(0.0);
    vN = vec3(0.0, 1.0, 0.0);
    vTint = vec4(0.0);
    vInfo = vec3(0.0);
    vViewDist = 1.0;
    return;
  }

  // Build a tangent frame on the surface normal, so the decal lies in the
  // ground plane instead of being pasted on as a screen-facing card.
  vec3 N = normalize(D.xyz);
  vec3 up = abs(N.y) > 0.95 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 T = normalize(cross(up, N));
  vec3 Bt = cross(N, T);
  float ca = cos(C.w);
  float sa = sin(C.w);
  vec2 q = vec2(position.x * ca - position.y * sa, position.x * sa + position.y * ca);

  // A splash ring grows; a scorch is stamped at full size.
  float grow = int(C.y + 0.5) == ${DECAL_SCORCH} ? 1.0 : mix(0.25, 1.0, sqrt(u));
  vec3 world = A.xyz + (T * q.x + Bt * q.y) * C.x * grow + N * 0.045;

  vec4 mv = viewMatrix * vec4(world, 1.0);
  vUv = uv;
  vWorld = world;
  vN = N;
  vTint = vec4(B.rgb, 1.0);
  vInfo = vec3(u, C.y, C.z);
  vViewDist = max(-mv.z, 0.001);
  gl_Position = projectionMatrix * mv;
}
`;

const DECAL_FRAG = /* glsl */ `
precision highp float;

varying vec2  vUv;
varying vec3  vWorld;
varying vec3  vN;
varying vec4  vTint;
varying vec3  vInfo;
varying float vViewDist;

${VFX_NOISE}
${AERIAL_GLSL}
${VFX_COMMON}
${VFX_FRAG}

void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;

  float u = vInfo.x;
  int kind = int(vInfo.y + 0.5);
  float seed = vInfo.z;
  vec3 albedo = vTint.rgb;
  vec3 emissive = vec3(0.0);
  float a;

  if (kind == ${DECAL_SCORCH}) {
    // Burn: a noisy blot with a cooling ember rim. The rim is what makes a
    // scorch read as *recent* rather than as a texture decal.
    float n = vfxFbm(vec3(vWorld.xz * 1.6 + seed, seed), 4);
    float edge = r * (0.72 + 0.5 * n);
    a = 1.0 - smoothstep(0.55, 0.98, edge);
    albedo = mix(vec3(0.020, 0.017, 0.015), albedo, n * 0.5);
    float rim = smoothstep(0.45, 0.80, edge) * (1.0 - smoothstep(0.80, 0.96, edge));
    emissive = vec3(1.0, 0.34, 0.07) * rim * pow(max(0.0, 1.0 - u * 3.2), 2.0) * 6.0;
    a *= 1.0 - smoothstep(0.75, 1.0, u);
  } else if (kind == ${DECAL_FROST}) {
    // Radial crystal growth: spokes that lengthen over the first half-second.
    float ang = atan(c.y, c.x);
    float spokes = 0.5 + 0.5 * cos(ang * 9.0 + seed * 6.0 + vfxNoise(vec3(vWorld.xz * 3.0, seed)) * 4.0);
    float grow = smoothstep(0.0, 0.22, u);
    float edge = r / max(grow, 0.05) * (0.62 + 0.55 * spokes);
    a = 1.0 - smoothstep(0.62, 1.0, edge);
    albedo = mix(albedo, vec3(0.78, 0.90, 1.0), spokes * 0.75);
    // Rime has to out-value the ash it is sitting on, or a white-on-pale-ochre
    // decal simply is not there.
    emissive = vec3(0.30, 0.52, 0.86) * pow(1.0 - r, 2.0) * 1.6;
    a *= 1.0 - smoothstep(0.55, 1.0, u);
  } else if (kind == ${DECAL_SPLASH}) {
    // Expanding thin ring: the crown of an impact on wet ground.
    float w = 0.10 + 0.16 * u;
    a = exp(-pow((r - (0.35 + 0.6 * u)) / w, 2.0) * 3.0);
    a *= (1.0 - u) * (1.0 - u);
    albedo = mix(albedo, vec3(1.0), 0.4);
    emissive = albedo * 0.15 * a;
  } else {
    // Concentric ripples on standing water.
    float ph = r * 9.0 - u * 11.0;
    a = (0.5 + 0.5 * sin(ph)) * exp(-r * 2.2) * (1.0 - u);
    emissive = albedo * 0.10 * a;
  }

  // NO soft-particle fade here. A decal is coplanar with the surface it is
  // projected onto, so vfxSoft measures its distance to *itself* and drives the
  // alpha to zero — which is exactly what happened: every splash, scorch and
  // frost patch was being erased by the depth test it was supposed to pass.
  // Occlusion by geometry in FRONT of the decal is the depth buffer's job, and
  // the polygon offset keeps it off the surface without lifting it.
  a = clamp(a, 0.0, 1.0);
  if (a < 0.004) discard;

  vec3 eye = vWorld - uVfxCamPos;
  vec3 V = -normalize(eye);
  vec3 lit = vfxLitParticle(albedo, vN, V, kind == ${DECAL_FROST} ? 0.25 : 0.85, 1.0, 0.0, 0.35, 4.0);
  vec3 col = applyAerial(lit, vViewDist, eye);
  // Premultiplied, so the emissive term composites additively over whatever the
  // ground already put down — exactly what a glowing rim should do.
  gl_FragColor = vec4(col * a + emissive * a, a);
}
`;

export interface DecalSpec {
  centre: THREE.Vector3;
  normal: THREE.Vector3;
  radius: number;
  life: number;
  kind: number;
  color: THREE.Color;
}

/** Projected, normal-aligned, depth-tested decal pool. One instanced draw. */
export class DecalPool {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private a: THREE.Vector4[] = [];
  private b: THREE.Vector4[] = [];
  private c: THREE.Vector4[] = [];
  private d: THREE.Vector4[] = [];
  private expiry = new Float32Array(DECALS);
  private next = 0;

  constructor(renderOrder: number) {
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
        3,
      ),
    );
    this.geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    const slot = new Float32Array(DECALS);
    for (let i = 0; i < DECALS; i++) slot[i] = i;
    this.geo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slot, 1));
    this.geo.instanceCount = DECALS;
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    for (let i = 0; i < DECALS; i++) {
      this.a.push(new THREE.Vector4());
      this.b.push(new THREE.Vector4(1, 1, 1, 0));
      this.c.push(new THREE.Vector4(1, 0, 0, 0));
      this.d.push(new THREE.Vector4(0, 1, 0, 0));
    }

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...vfxUniforms(),
        ...aerialUniforms(),
        uDecA: { value: this.a },
        uDecB: { value: this.b },
        uDecC: { value: this.c },
        uDecD: { value: this.d },
      },
      vertexShader: DECAL_VERT,
      fragmentShader: DECAL_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      premultipliedAlpha: true,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      // Coplanar with the terrain by construction; the offset keeps the decal
      // in front of it without lifting it enough to break ground contact.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.castShadow = false;
    this.mesh.visible = false;
    this.mesh.name = 'vfx:decals';
  }

  add(s: DecalSpec, now: number): void {
    let idx = -1;
    for (let i = 0; i < DECALS; i++) {
      const k = (this.next + i) % DECALS;
      if (this.expiry[k] <= now) {
        idx = k;
        break;
      }
    }
    if (idx < 0) {
      let oldest = 0;
      for (let i = 1; i < DECALS; i++) if (this.expiry[i] < this.expiry[oldest]) oldest = i;
      idx = oldest;
    }
    this.next = (idx + 1) % DECALS;
    this.expiry[idx] = now + s.life;

    this.a[idx].set(s.centre.x, s.centre.y, s.centre.z, now);
    this.b[idx].set(s.color.r, s.color.g, s.color.b, s.life);
    this.c[idx].set(s.radius, s.kind, Math.random() * 100, Math.random() * Math.PI * 2);
    this.d[idx].set(s.normal.x, s.normal.y, s.normal.z, 0);
    this.mat.uniformsNeedUpdate = true;
  }

  update(now: number): number {
    let live = 0;
    for (let i = 0; i < DECALS; i++) {
      if (this.expiry[i] > now) live++;
      else if (this.b[i].w !== 0) this.b[i].w = 0;
    }
    this.mesh.visible = live > 0;
    return live;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
