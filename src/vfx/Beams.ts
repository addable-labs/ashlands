import * as THREE from 'three';
import { AERIAL_GLSL, aerialUniforms } from '../sky/Atmosphere';
import { VFX_COMMON, VFX_FRAG, VFX_NOISE, vfxUniforms } from './glsl';

/**
 * Beams: branching lightning and continuous elemental rays.
 *
 * The fork structure is a real recursion, evaluated per-vertex. Branch `b` in a
 * binary tree hangs off branch `(b-1)/2` at a hashed parameter along it, so
 * finding where a twig starts means resolving its whole ancestor chain back to
 * the trunk. A shader cannot recurse, so the chain is collected by walking
 * parents and then replayed from the root — which is the same computation, and
 * the reason the forks actually attach to the channel instead of floating
 * beside it the way a flat "N random extra segments" fake always does.
 *
 * The whole pool is one instanced draw of BOLTS * BRANCHES * SEGMENTS quads.
 */

export const BOLTS = 6;
/** Binary tree, depth 2: trunk, 2 limbs, 4 twigs. */
const BRANCHES = 7;
const SEGMENTS = 18;

export const BEAM_LIGHTNING = 0;
export const BEAM_RAY = 1;

const VERT = /* glsl */ `
precision highp float;

attribute vec3 aIdx;    // bolt, branch, segment

uniform vec4 uBeamA[${BOLTS}];   // from.xyz, spawn time
uniform vec4 uBeamB[${BOLTS}];   // to.xyz, lifetime
uniform vec4 uBeamC[${BOLTS}];   // colour.rgb, width
uniform vec4 uBeamD[${BOLTS}];   // kind, intensity, seed, jitter (fraction of span)

varying float vSide;
varying vec4  vTint;     // rgb colour, a envelope
varying vec3  vWorld;
varying vec2  vInfo;     // x = intensity, y = along-parameter
varying float vViewDist;

${VFX_NOISE}
${VFX_COMMON}

/**
 * A point at parameter t along a jittered channel from A to B. Octaves of
 * smooth noise in the plane perpendicular to the run, pinned to zero at both
 * ends so a branch always starts and finishes where it is supposed to.
 */
vec3 boltPoint(vec3 A, vec3 B, float t, float sd, float amp) {
  vec3 d = B - A;
  float L = max(length(d), 1e-4);
  vec3 dir = d / L;
  vec3 up = abs(dir.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 x = normalize(cross(up, dir));
  vec3 y = cross(dir, x);

  vec2 o = vec2(0.0);
  float f = 1.0;
  float a = 1.0;
  for (int i = 0; i < 4; i++) {
    o.x += a * (vfxNoise(vec3(t * f * 5.0, sd + float(i) * 7.3, 0.0)) - 0.5);
    o.y += a * (vfxNoise(vec3(t * f * 5.0, sd + float(i) * 7.3, 5.7)) - 0.5);
    f *= 2.1;
    a *= 0.52;
  }
  float env = sin(t * 3.14159265);
  return A + dir * (t * L) + (x * o.x + y * o.y) * amp * env * L;
}

void main() {
  int bolt = int(aIdx.x + 0.5);
  int branch = int(aIdx.y + 0.5);
  vec4 A = uBeamA[bolt];
  vec4 B = uBeamB[bolt];
  vec4 C = uBeamC[bolt];
  vec4 D = uBeamD[bolt];

  float life = B.w;
  float age = uVfxTime - A.w;
  bool live = life > 0.0 && age >= 0.0 && age <= life;

  int kind = int(D.x + 0.5);
  // A lightning channel is not continuous in time: it re-forms in discrete
  // strokes. Quantising the seed to 22 Hz is what produces that read.
  float strokes = kind == ${BEAM_LIGHTNING} ? mod(floor(uVfxTime * 22.0), 512.0) : 0.0;
  // Wrapped: an ever-growing seed walks the noise lattice out of float32's
  // useful range and the channel dissolves after a minute or two of play.
  float sd = mod(D.z + strokes * 3.13, 89.0);

  vec3 P0 = A.xyz;
  vec3 P1 = B.xyz;
  float amp = D.w;
  float width = C.w;
  float exist = 1.0;

  // A continuous ray is one channel. Only a discharge forks.
  if (kind != ${BEAM_LIGHTNING} && branch > 0) exist = 0.0;

  // Resolve the ancestor chain, root-most last.
  int chain[3];
  int n = 0;
  int cur = branch;
  for (int i = 0; i < 3; i++) {
    if (cur <= 0) break;
    chain[i] = cur;
    n++;
    cur = (cur - 1) / 2;
  }

  for (int i = 2; i >= 0; i--) {
    if (i >= n) continue;
    int c = chain[i];
    float h = vfxHash11(float(c) * 7.31 + sd);
    float h2 = vfxHash11(float(c) * 13.77 + sd + 3.3);
    // Not every fork fires on every stroke.
    if (h2 < 0.22) exist = 0.0;
    float ta = 0.20 + 0.55 * h;
    vec3 P = boltPoint(P0, P1, ta, sd, amp);
    vec3 seg = normalize(P1 - P0);
    vec3 perp = normalize(cross(seg, vec3(h2, 1.0, h)) + vec3(1e-4, 0.0, 0.0));
    float ang = (h - 0.5) * 1.7;
    float L = length(P1 - P0) * (0.28 + 0.30 * h2);
    P0 = P;
    P1 = P + normalize(seg * cos(ang) + perp * sin(ang)) * L;
    amp *= 0.62;
    // Gentle enough that a second-level twig is still a couple of pixels wide
    // at melee range; at 0.55 the forks vanished into sub-pixel noise.
    width *= 0.72;
  }

  float t0 = aIdx.z / float(${SEGMENTS});
  float t1 = (aIdx.z + 1.0) / float(${SEGMENTS});

  // The leader propagates: the channel draws itself from the caster outward.
  float reach = clamp(age / max(life * 0.14, 1e-3), 0.0, 1.0);
  if (t0 > reach) exist = 0.0;

  // The ribbon is built PER VERTEX from the tangent at that vertex's own
  // parameter, not from the segment it happens to belong to. Two quads meeting
  // at t therefore compute an identical side vector and the strip is seamless;
  // taking the side from the segment direction instead left a visible kink and
  // a bright overlap at every joint, which read as a chain of sausages.
  float sdb = mod(sd + float(branch) * 17.0, 89.0);
  float tv = position.x < 0.0 ? t0 : t1;
  float eps = 0.4 / float(${SEGMENTS});
  vec3 P = boltPoint(P0, P1, tv, sdb, amp);
  vec3 Pa = boltPoint(P0, P1, max(tv - eps, 0.0), sdb, amp);
  vec3 Pb = boltPoint(P0, P1, min(tv + eps, 1.0), sdb, amp);

  vec3 run = normalize(Pb - Pa + vec3(1e-5, 0.0, 0.0));
  vec3 toCam = normalize(uVfxCamPos - P);
  vec3 side = normalize(cross(run, toCam));
  // A sustained ray tapers away from the caster; a discharge does not.
  float w = width * (kind == ${BEAM_LIGHTNING} ? 1.0 : 1.0 - 0.55 * tv);
  vec3 world = P + side * position.y * w;

  // Fast decay with a couple of after-flickers, which is what a real stroke
  // does and what a linear fade never captures.
  float u = age / max(life, 1e-3);
  float env = kind == ${BEAM_LIGHTNING}
    ? exp(-u * 3.0) * (0.62 + 0.38 * vfxHash11(strokes + float(bolt) * 5.0))
    : smoothstep(0.0, 0.08, u) * (1.0 - smoothstep(0.75, 1.0, u));
  env *= exist * (live ? 1.0 : 0.0);

  vec4 mv = viewMatrix * vec4(world, 1.0);
  vSide = position.y;
  vTint = vec4(C.rgb, env);
  vWorld = world;
  vInfo = vec2(D.y, tv);
  vViewDist = max(-mv.z, 0.001);

  gl_Position = env < 0.002 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;

varying float vSide;
varying vec4  vTint;
varying vec3  vWorld;
varying vec2  vInfo;
varying float vViewDist;

${VFX_NOISE}
${AERIAL_GLSL}
${VFX_COMMON}
${VFX_FRAG}

void main() {
  if (vTint.a < 0.002) discard;
  float d = abs(vSide);
  // A blown-out white core inside a wide coloured halo. The core is what the
  // bloom chain picks up; the halo is what gives the discharge its element.
  float core = exp(-d * d * 26.0);
  float halo = exp(-d * d * 1.15);
  float a = clamp(core + halo * 0.72, 0.0, 1.0) * vTint.a;
  a *= vfxSoft(vWorld, vViewDist, 0.35);
  if (a < 0.003) discard;

  vec3 eye = vWorld - uVfxCamPos;
  // The core must not out-run the halo by so much that the discharge reads
  // white: an over-bright core swamped the element colour entirely.
  vec3 col = (vec3(1.0, 0.97, 0.94) * core * 1.1 + vTint.rgb * halo * 2.8) * vInfo.x;
  col *= vfxAerialT(vViewDist, eye);
  gl_FragColor = vec4(col * a, a);
}
`;

export interface BeamSpec {
  from: THREE.Vector3;
  to: THREE.Vector3;
  color: THREE.Color;
  width: number;
  life: number;
  kind: number;
  intensity: number;
  /** Lateral jitter as a fraction of the span. 0 gives a straight ray. */
  jitter: number;
}

export class BeamPool {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private a: THREE.Vector4[] = [];
  private b: THREE.Vector4[] = [];
  private c: THREE.Vector4[] = [];
  private d: THREE.Vector4[] = [];
  private expiry = new Float32Array(BOLTS);
  private next = 0;

  constructor(renderOrder: number) {
    this.geo = new THREE.InstancedBufferGeometry();
    // x runs along the segment, y is the ribbon's half-width.
    this.geo.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([-0.5, -1, 0, 0.5, -1, 0, 0.5, 1, 0, -0.5, 1, 0]),
        3,
      ),
    );
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);

    const n = BOLTS * BRANCHES * SEGMENTS;
    const idx = new Float32Array(n * 3);
    let k = 0;
    for (let bo = 0; bo < BOLTS; bo++) {
      for (let br = 0; br < BRANCHES; br++) {
        for (let s = 0; s < SEGMENTS; s++) {
          idx[k * 3] = bo;
          idx[k * 3 + 1] = br;
          idx[k * 3 + 2] = s;
          k++;
        }
      }
    }
    this.geo.setAttribute('aIdx', new THREE.InstancedBufferAttribute(idx, 3));
    this.geo.instanceCount = n;
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    for (let i = 0; i < BOLTS; i++) {
      this.a.push(new THREE.Vector4());
      this.b.push(new THREE.Vector4(0, 0, 0, 0));
      this.c.push(new THREE.Vector4(1, 1, 1, 0.05));
      this.d.push(new THREE.Vector4(0, 1, 0, 0.1));
    }

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...vfxUniforms(),
        ...aerialUniforms(),
        uBeamA: { value: this.a },
        uBeamB: { value: this.b },
        uBeamC: { value: this.c },
        uBeamD: { value: this.d },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      premultipliedAlpha: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.castShadow = false;
    this.mesh.visible = false;
    this.mesh.name = 'vfx:beams';
  }

  fire(s: BeamSpec, now: number): void {
    let idx = -1;
    for (let i = 0; i < BOLTS; i++) {
      const j = (this.next + i) % BOLTS;
      if (this.expiry[j] <= now) {
        idx = j;
        break;
      }
    }
    if (idx < 0) {
      let oldest = 0;
      for (let i = 1; i < BOLTS; i++) if (this.expiry[i] < this.expiry[oldest]) oldest = i;
      idx = oldest;
    }
    this.next = (idx + 1) % BOLTS;
    this.expiry[idx] = now + s.life;

    this.a[idx].set(s.from.x, s.from.y, s.from.z, now);
    this.b[idx].set(s.to.x, s.to.y, s.to.z, s.life);
    this.c[idx].set(s.color.r, s.color.g, s.color.b, s.width);
    this.d[idx].set(s.kind, s.intensity, Math.random() * 400, s.jitter);
    this.mat.uniformsNeedUpdate = true;
  }

  update(now: number): number {
    let live = 0;
    for (let i = 0; i < BOLTS; i++) {
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
