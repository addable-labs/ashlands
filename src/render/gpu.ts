import * as THREE from 'three';

export type Uniforms = Record<string, THREE.IUniform>;

/**
 * A single fullscreen triangle beats a quad: no diagonal seam, one fewer
 * vertex, and the GPU rasterises it as one primitive with perfect quad
 * coverage. UV is derived from clip position so the geometry needs only
 * `position` — which also means it survives three's attribute validation
 * without carrying a dummy normal buffer.
 */
export class Blit {
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.Camera();
  private readonly mesh: THREE.Mesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly idle: THREE.ShaderMaterial;

  constructor() {
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
    this.idle = new THREE.ShaderMaterial({
      vertexShader: 'void main(){ gl_Position = vec4(position.xy,0.0,1.0); }',
      fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); }',
    });
    this.mesh = new THREE.Mesh(this.geo, this.idle);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.scene.add(this.mesh);
  }

  draw(r: THREE.WebGLRenderer, mat: THREE.Material, target: THREE.WebGLRenderTarget | null): void {
    this.mesh.material = mat;
    r.setRenderTarget(target);
    r.render(this.scene, this.cam);
  }

  dispose(): void {
    this.geo.dispose();
    this.idle.dispose();
  }
}

export const FS_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export interface RTOpts {
  count?: number;
  type?: THREE.TextureDataType;
  format?: THREE.PixelFormat;
  filter?: THREE.MagnificationTextureFilter;
  depth?: boolean;
}

export function makeRT(w: number, h: number, o: RTOpts = {}): THREE.WebGLRenderTarget {
  const filter = o.filter ?? THREE.LinearFilter;
  const rt = new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
    count: o.count ?? 1,
    type: o.type ?? THREE.HalfFloatType,
    format: o.format ?? THREE.RGBAFormat,
    minFilter: filter,
    magFilter: filter,
    depthBuffer: o.depth ?? false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  for (const t of rt.textures) {
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    // Every intermediate is scene-referred radiance or raw data; sRGB decode
    // here would corrupt both.
    t.colorSpace = THREE.LinearSRGBColorSpace;
  }
  return rt;
}

/**
 * Under GLSL3 three declines to declare `pc_fragColor` for us, so every
 * fragment shader here opens with its own location-0 output. Aliasing
 * `gl_FragColor` onto it keeps the pass shaders readable and lets MRT passes
 * add higher locations without special-casing attachment zero.
 */
export const GLSL_OUT = /* glsl */ `
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
`;

/** Fullscreen pass material. Depth state off — the triangle owns every pixel. */
export function fsMaterial(fragment: string, uniforms: Uniforms, defines?: Record<string, string>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FS_VERT,
    fragmentShader: GLSL_OUT + fragment,
    uniforms,
    defines: defines ?? {},
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
  });
}

/** Shared GLSL: constants, luminance, and the noise every dithered pass uses. */
export const GLSL_COMMON = /* glsl */ `
#define PI 3.141592653589793
#define HALF_PI 1.5707963267948966

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Interleaved gradient noise (Jimenez). Spectrally close to blue noise for
// free, and the frame offset below turns it into a temporally decorrelated
// sequence that TAA integrates cleanly.
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

// R2 low-discrepancy sequence — the temporal partner to the spatial noise.
float r2seq(float n) { return fract(0.5 + n * 0.7548776662466927); }

vec3 rgb2ycocg(vec3 c) {
  return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
}
vec3 ycocg2rgb(vec3 c) {
  return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}
`;

/**
 * Depth utilities. `uInvProj` is built from the *jittered* projection so that
 * reconstructed positions line up with the pixels that were actually
 * rasterised; `uJitterNdc` lets the cheap tangent-space path do the same.
 */
export const GLSL_DEPTH = /* glsl */ `
uniform vec2 uNearFar;
uniform vec2 uTanHalf;
uniform vec2 uJitterNdc;

float linearizeDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uNearFar.x * uNearFar.y) / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x));
}

vec3 viewRay(vec2 uv) {
  vec2 ndc = uv * 2.0 - 1.0 - uJitterNdc;
  return vec3(ndc.x * uTanHalf.x, ndc.y * uTanHalf.y, -1.0);
}

// d is positive linear view depth, i.e. metres along -Z.
vec3 viewPos(vec2 uv, float d) { return viewRay(uv) * d; }
`;

/* ------------------------------------------------------------- profiling */

interface TimerExt {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

interface PendingQuery {
  readonly name: string;
  readonly query: WebGLQuery;
}

/**
 * Per-pass GPU timing via EXT_disjoint_timer_query_webgl2.
 *
 * Only one TIME_ELAPSED query may be in flight at a time in WebGL2, so the
 * scopes here are strictly sequential and never nested — which is exactly how
 * the pipeline issues its passes. Results are read back two frames later (a
 * query is not available in the frame that issued it without stalling the
 * pipe), and folded into an exponential average so a single hitch does not
 * dominate the report.
 *
 * `supported` is false on drivers that refuse the extension — notably some
 * ANGLE backends. Callers fall back to pass-toggling A/B measurement there.
 */
export class GpuProfiler {
  enabled = false;
  readonly ms = new Map<string, number>();
  private readonly gl: WebGL2RenderingContext | null;
  private readonly ext: TimerExt | null;
  private readonly inflight: PendingQuery[] = [];
  private readonly pool: WebGLQuery[] = [];
  private open: PendingQuery | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    const ctx = renderer.getContext();
    const gl = ctx instanceof WebGL2RenderingContext ? ctx : null;
    this.gl = gl;
    const raw: unknown = gl ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
    this.ext = raw ? (raw as TimerExt) : null;
  }

  get supported(): boolean {
    return this.ext !== null;
  }

  begin(name: string): void {
    const { gl, ext } = this;
    if (!this.enabled || !gl || !ext || this.open) return;
    const q = this.pool.pop() ?? gl.createQuery();
    if (!q) return;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    this.open = { name, query: q };
  }

  end(): void {
    const { gl, ext } = this;
    if (!gl || !ext || !this.open) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    this.inflight.push(this.open);
    this.open = null;
  }

  /** Drain whatever has completed. Call once per frame, after the last pass. */
  collect(): void {
    const { gl, ext } = this;
    if (!gl || !ext) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
    while (this.inflight.length > 0) {
      const p = this.inflight[0];
      if (!gl.getQueryParameter(p.query, gl.QUERY_RESULT_AVAILABLE)) break;
      this.inflight.shift();
      if (!disjoint) {
        const ns = gl.getQueryParameter(p.query, gl.QUERY_RESULT) as number;
        const prev = this.ms.get(p.name);
        const cur = ns / 1e6;
        this.ms.set(p.name, prev === undefined ? cur : prev * 0.9 + cur * 0.1);
      }
      this.pool.push(p.query);
    }
  }

  /** Sorted breakdown in milliseconds, most expensive first. */
  report(): { pass: string; ms: number }[] {
    return [...this.ms.entries()]
      .map(([pass, ms]) => ({ pass, ms: Math.round(ms * 1000) / 1000 }))
      .sort((a, b) => b.ms - a.ms);
  }

  dispose(): void {
    const gl = this.gl;
    if (!gl) return;
    for (const p of this.inflight) gl.deleteQuery(p.query);
    for (const q of this.pool) gl.deleteQuery(q);
    this.inflight.length = 0;
    this.pool.length = 0;
  }
}
