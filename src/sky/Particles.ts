import * as THREE from 'three';
import { NOISE_GLSL, buildDustSprite } from './Noise';
import type { SkyParams } from './Weather';

/**
 * Airborne particulate: precipitation, ash, and bioluminescent motes.
 *
 * All three layers live in a box that wraps around the camera modulo its
 * extent, so a fixed particle count covers an infinite world and the vertex
 * shader does the wrapping — zero CPU per particle, one draw call per layer.
 */

const FIELD_VERT = /* glsl */ `
attribute vec3 aRand;
uniform vec3  uBox;
uniform vec3  uCamPos;
uniform vec3  uVel;
uniform float uTime;
uniform float uSwirl;
uniform float uSize;
uniform float uProj;
uniform float uNear;
/**
 * Hard ceiling on the sprite's screen footprint, in pixels at the capture
 * resolution, and the single most important number in this file.
 *
 * A point sprite's radius is a projected WORLD size, so it grows without bound
 * as a particle approaches the eye. With the old 190px clamp a grain a couple of
 * metres away covered a fifth of the frame height, and the review read the
 * result — correctly — as heavy snowfall in a clear night sky, as bokeh discs
 * sitting on a distant ridge, and as pale flecks over six of the eight canonical
 * shots. Nothing here is a bokeh source: these are millimetre grains, and a
 * millimetre grain is never more than a few pixels.
 */
uniform float uMaxPx;
varying float vFade;
varying float vSeed;

void main() {
  vec3 pos = position * uBox;
  pos += uVel * (uTime * (0.55 + aRand.y * 0.9));
  if (uSwirl > 0.0) {
    float ph = aRand.z * 6.28318;
    pos.x += sin(uTime * (0.6 + aRand.y * 1.4) + ph) * uSwirl;
    pos.z += cos(uTime * (0.5 + aRand.x * 1.3) + ph * 1.7) * uSwirl;
    pos.y += sin(uTime * (0.35 + aRand.z) + ph * 2.3) * uSwirl * 0.4;
  }
  pos = mod(pos - uCamPos + uBox * 0.5, uBox) - uBox * 0.5 + uCamPos;

  vec4 mv = viewMatrix * vec4(pos, 1.0);
  float d = max(-mv.z, 0.001);
  gl_Position = projectionMatrix * mv;

  // Unclamped projected diameter. Kept as a value rather than folded straight
  // into gl_PointSize because the FADE is driven by it: clamping alone would
  // hold a near grain at the ceiling and it would still read as a disc, just a
  // smaller one. Fading it out as it approaches the ceiling is the physical
  // statement — a grain that close is inside the lens's near focus and is
  // simply not resolved — and it is what removes the discs entirely rather
  // than shrinking them.
  float ps = uSize * (0.5 + aRand.x * 1.0) * uProj / d;
  gl_PointSize = clamp(ps, 1.0, uMaxPx);

  // Fade at the box edge so wrap-around is invisible; at the near plane so
  // particles do not pop across the camera; and at the size ceiling so no grain
  // ever draws as a readable disc.
  float far = uBox.x * 0.5;
  vFade = smoothstep(far, far * 0.55, d)
        * smoothstep(uNear, uNear * 3.5, d)
        * (1.0 - smoothstep(uMaxPx * 0.55, uMaxPx, ps));
  vSeed = aRand.z;
}
`;

const FIELD_FRAG = /* glsl */ `
uniform vec3  uColor;
uniform float uAlpha;
uniform vec2  uStreakDir;
uniform float uElong;
varying float vFade;
varying float vSeed;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  // Elongation COMPRESSES the cross-streak axis; it must never stretch the
  // along-streak one. Dividing the parallel axis by uElong pushed the profile
  // out to uElong times the sprite half-width, so the Gaussian was still at
  // 0.6 (ash) to 0.94 (rain) of full strength where the quad ended — the
  // particle was drawing a hard-edged rectangle, which is what put readable
  // pale squares all over the ash storm.
  vec2 r = vec2(dot(c, uStreakDir), dot(c, vec2(-uStreakDir.y, uStreakDir.x)) * uElong);
  float m = exp(-dot(r, r) * 3.0);
  // Radial window on the raw point coord, zero by the quad's inscribed circle.
  // Belt and braces: whatever the elongation and the jitter do, the square
  // silhouette can never be read at any size.
  m *= 1.0 - smoothstep(0.50, 1.0, dot(c, c));
  // Slight per-particle density jitter so a field never reads as clones.
  m *= 0.7 + 0.6 * vSeed;
  float a = m * uAlpha * vFade;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

interface FieldOpts {
  count: number;
  box: THREE.Vector3;
  blending: THREE.Blending;
}

class ParticleField {
  readonly points: THREE.Points;
  readonly mat: THREE.ShaderMaterial;
  private geo: THREE.BufferGeometry;
  private max: number;

  constructor(o: FieldOpts) {
    this.max = o.count;
    const seed = new Float32Array(o.count * 3);
    const rand = new Float32Array(o.count * 3);
    for (let i = 0; i < o.count * 3; i++) {
      seed[i] = Math.random();
      rand[i] = Math.random();
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(seed, 3));
    this.geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 3));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uBox: { value: o.box.clone() },
        uCamPos: { value: new THREE.Vector3() },
        uVel: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uSwirl: { value: 0 },
        uSize: { value: 0.05 },
        uProj: { value: 800 },
        uNear: { value: 0.6 },
        uColor: { value: new THREE.Color(1, 1, 1) },
        uAlpha: { value: 0.5 },
        uStreakDir: { value: new THREE.Vector2(0, 1) },
        uElong: { value: 1 },
        uMaxPx: { value: 16 },
      },
      vertexShader: FIELD_VERT,
      fragmentShader: FIELD_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: o.blending,
      toneMapped: false,
    });

    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1200;
    this.points.visible = false;
  }

  setCount(n: number): void {
    const c = Math.min(this.max, Math.max(0, Math.floor(n)));
    this.geo.setDrawRange(0, c);
    this.points.visible = c > 0;
  }

  u(name: string): THREE.IUniform {
    return this.mat.uniforms[name];
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

const SHEET_VERT = /* glsl */ `
attribute vec4 aInst;   // xyz = cell position in [0,1), w = size
attribute vec3 aRand;
uniform vec3  uBox;
uniform vec3  uCamPos;
uniform vec3  uVel;
uniform float uTime;
varying vec2  vUv;
varying float vFade;
varying float vSeed;

void main() {
  vec3 c = aInst.xyz * uBox + uVel * uTime * (0.7 + aRand.y * 0.6);
  c = mod(c - uCamPos + uBox * 0.5, uBox) - uBox * 0.5 + uCamPos;

  vec4 mv = viewMatrix * vec4(c, 1.0);
  float d = max(-mv.z, 0.001);
  float s = aInst.w * (0.7 + aRand.x * 0.9);
  float rot = aRand.z * 6.28318 + uTime * (aRand.y - 0.5) * 0.08;
  vec2 q = vec2(position.x * cos(rot) - position.y * sin(rot),
                position.x * sin(rot) + position.y * cos(rot));
  mv.xy += q * s;

  gl_Position = projectionMatrix * mv;
  vUv = uv;
  float far = uBox.x * 0.5;
  vFade = smoothstep(far, far * 0.5, d) * smoothstep(2.0, 25.0, d);
  vSeed = aRand.z;
}
`;

const SHEET_FRAG = /* glsl */ `
uniform sampler2D uMask;
uniform vec3  uColor;
uniform float uAlpha;
uniform float uTime;
varying vec2  vUv;
varying float vFade;
varying float vSeed;

${NOISE_GLSL}

void main() {
  float m = texture2D(uMask, vUv).a;
  // Second, drifting octave breaks the repeat of a single baked sprite.
  float n = fbm3(vec3(vUv * 4.0, uTime * 0.05 + vSeed * 20.0), 3);
  m *= 0.35 + n * 1.3;
  float a = m * uAlpha * vFade;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

/** Large, slow, overlapping sheets — the body of the ash wall. */
class AshSheets {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private mask: THREE.CanvasTexture;

  constructor(count: number, box: THREE.Vector3) {
    this.geo = new THREE.InstancedBufferGeometry();
    // A bare quad; the vertex shader billboards and scales it per instance.
    this.geo.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
        3,
      ),
    );
    this.geo.setAttribute(
      'uv',
      new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2),
    );
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.geo.instanceCount = count;

    const inst = new Float32Array(count * 4);
    const rand = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      inst[i * 4] = Math.random();
      inst[i * 4 + 1] = Math.random();
      inst[i * 4 + 2] = Math.random();
      inst[i * 4 + 3] = 34 + Math.random() * 90;
      rand[i * 3] = Math.random();
      rand[i * 3 + 1] = Math.random();
      rand[i * 3 + 2] = Math.random();
    }
    this.geo.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 4));
    this.geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rand, 3));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.mask = buildDustSprite();
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uBox: { value: box.clone() },
        uCamPos: { value: new THREE.Vector3() },
        uVel: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uMask: { value: this.mask },
        uColor: { value: new THREE.Color(0.5, 0.36, 0.2) },
        uAlpha: { value: 0 },
      },
      vertexShader: SHEET_VERT,
      fragmentShader: SHEET_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1150;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.mask.dispose();
  }
}

const PRECIP_MAX = 42000;
const MOTE_MAX = 6000;

interface KindLook {
  /** Grain DIAMETER in metres. This is a physical size, not a look knob. */
  size: number;
  fall: number;
  drag: number;
  elong: number;
  swirl: number;
  alpha: number;
  color: THREE.Color;
  count: number;
  box: number;
  /** Sprite ceiling in screen pixels at 1080p. See uMaxPx. */
  maxPx: number;
  /** How much of the surrounding medium's radiance the particle carries. */
  mediaMul: number;
}

const LOOKS: Record<'rain' | 'snow' | 'ash', KindLook> = {
  rain: {
    size: 0.030, fall: 22, drag: 0.55, elong: 7, swirl: 0, alpha: 0.40,
    color: new THREE.Color(0.78, 0.86, 1.0), count: PRECIP_MAX, box: 90,
    maxPx: 34, mediaMul: 0.5,
  },
  snow: {
    // 4.5cm, not 11. A flake is under a centimetre; 11cm was a snowball, and at
    // the near plane it projected to a hundred pixels of soft white disc.
    size: 0.045, fall: 2.4, drag: 1.0, elong: 1.1, swirl: 1.6, alpha: 0.72,
    color: new THREE.Color(1.0, 1.0, 1.05), count: 26000, box: 110,
    maxPx: 18, mediaMul: 0.9,
  },
  ash: {
    // 1.4 CENTIMETRES, not 30. Pulverised basalt is a millimetre-to-centimetre
    // grain; 0.30 is a cobble, and the review measured exactly what a field of
    // 30cm cobbles hung around the camera looks like — 8-20px soft discs, dozens
    // of them, drawn over a distant ridge and over both moons, reading as heavy
    // snowfall in a clear night sky and as pale bokeh across six of the eight
    // canonical frames. They were never stars and the star field was never
    // mis-sorted: these are ash grains, correctly depth-tested, at forty times
    // their physical size.
    //
    // Alpha comes up to compensate for the lost area so an ash STORM still reads
    // as a driving grain field; what it can no longer do is read at all when the
    // load is the trace 0.05 that "clear" carries.
    size: 0.014, fall: 1.1, drag: 1.15, elong: 2.4, swirl: 2.2, alpha: 0.34,
    color: new THREE.Color(0.82, 0.76, 0.68), count: PRECIP_MAX, box: 140,
    maxPx: 12, mediaMul: 0.80,
  },
};

export class SkyParticles {
  readonly group = new THREE.Group();
  private precip: ParticleField;
  private motes: ParticleField;
  private sheets: AshSheets;
  private vel = new THREE.Vector3();
  private tmpC = new THREE.Color();
  private hazeC = new THREE.Color();
  private blightC = new THREE.Color(0.55, 0.85, 0.25);
  private streak = new THREE.Vector2(0, 1);
  private cam = new THREE.Vector3();
  private tmpV = new THREE.Vector3();

  constructor() {
    this.precip = new ParticleField({
      count: PRECIP_MAX,
      box: new THREE.Vector3(120, 120, 120),
      blending: THREE.NormalBlending,
    });
    // Fungal spores hug the ground. The box wraps around the CAMERA, not around
    // the terrain, so a 40m vertical extent put motes 20m overhead: at a level
    // camera those project a third of the way up the sky and read as stars
    // punching through a daylit dome. 16m keeps them where spores belong.
    this.motes = new ParticleField({
      count: MOTE_MAX,
      box: new THREE.Vector3(70, 16, 70),
      blending: THREE.AdditiveBlending,
    });
    this.sheets = new AshSheets(30, new THREE.Vector3(220, 160, 220));
    this.group.add(this.precip.points, this.motes.points, this.sheets.mesh);
    this.group.renderOrder = 1100;
  }

  /**
   * @param sunColor Linear radiance of the key light.
   * @param ambient  Sky irradiance estimate.
   * @param toSun    Forward-scattering term in [0,1], 1 when facing the sun.
   * @param media    Radiance of the surrounding particulate medium. Particles
   *                 must be lit by this, not by the sun alone, or an ash storm
   *                 renders its own ash as black specks against a glowing sky.
   */
  update(
    params: SkyParams,
    camera: THREE.PerspectiveCamera,
    wind: THREE.Vector2,
    windSpeed: number,
    time: number,
    viewportH: number,
    sunColor: THREE.Color,
    sunIntensity: number,
    ambient: THREE.Color,
    toSun: number,
    media: THREE.Color,
  ): void {
    const cam = camera.getWorldPosition(this.cam);
    const proj = (0.5 * viewportH) / Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);

    // Pick the dominant precipitation species; they never meaningfully mix.
    let kind: 'rain' | 'snow' | 'ash' = 'ash';
    let amt = params.ash;
    if (params.rain > amt) {
      kind = 'rain';
      amt = params.rain;
    }
    if (params.snow > amt) {
      kind = 'snow';
      amt = params.snow;
    }
    amt = THREE.MathUtils.clamp(amt, 0, 1.4);
    const look = LOOKS[kind];

    this.precip.setCount(look.count * Math.min(1, amt));
    if (amt > 0.001) {
      const box = this.precip.u('uBox').value as THREE.Vector3;
      box.setScalar(look.box);
      this.vel.set(
        wind.x * windSpeed * look.drag,
        -look.fall,
        wind.y * windSpeed * look.drag,
      );
      (this.precip.u('uVel').value as THREE.Vector3).copy(this.vel);
      (this.precip.u('uCamPos').value as THREE.Vector3).copy(cam);
      this.precip.u('uTime').value = time;
      this.precip.u('uProj').value = proj;
      // Scale the sprite with the amount, not just the alpha: a trace ash load
      // has to read as fine grain, and a fixed 0.3m mote a few metres from the
      // near plane is a 25-pixel disc that the DOF kernel turns into bokeh.
      this.precip.u('uSize').value =
        look.size * (kind === 'rain' ? 1 + look.elong * 0.25 : 0.4 + 0.6 * Math.min(1, amt));
      this.precip.u('uSwirl').value = look.swirl;
      this.precip.u('uElong').value = look.elong;
      this.precip.u('uMaxPx').value = look.maxPx * (viewportH / 1080);
      this.precip.u('uAlpha').value = look.alpha * Math.min(1, amt * 1.3);

      // Streak orientation in screen space, from the world velocity.
      const v = this.tmpV.copy(this.vel).normalize().transformDirection(camera.matrixWorldInverse);
      const sl = Math.hypot(v.x, v.y);
      this.streak.set(sl > 1e-3 ? v.x / sl : 0, sl > 1e-3 ? v.y / sl : 1);
      (this.precip.u('uStreakDir').value as THREE.Vector2).copy(this.streak);

      // Medium radiance plus a direct-light rim when looking into the sun.
      // Both light terms are IRRADIANCE, so they carry an albedo/pi to become a
      // radiance; without it a single grain rendered several times brighter than
      // the sky behind it and the field read as hot specks rather than as
      // suspended matter.
      this.tmpC.copy(sunColor).multiplyScalar(sunIntensity * (0.25 + toSun * 1.0) * 0.16);
      this.tmpC.r += ambient.r * 0.35;
      this.tmpC.g += ambient.g * 0.35;
      this.tmpC.b += ambient.b * 0.35;
      this.tmpC.add(this.hazeC.copy(media).multiplyScalar(look.mediaMul));
      this.tmpC.multiply(look.color);
      (this.precip.u('uColor').value as THREE.Color).copy(this.tmpC);
    }

    // Motes: always a few, many during blight. Bioluminescent spores are the
    // one thing in this sky that is not grey.
    const moteAmt = THREE.MathUtils.clamp(params.spore, 0, 1);
    this.motes.setCount(MOTE_MAX * moteAmt);
    if (moteAmt > 0.001) {
      (this.motes.u('uCamPos').value as THREE.Vector3).copy(cam);
      (this.motes.u('uVel').value as THREE.Vector3).set(
        wind.x * windSpeed * 0.12,
        0.35,
        wind.y * windSpeed * 0.12,
      );
      this.motes.u('uTime').value = time;
      this.motes.u('uProj').value = proj;
      this.motes.u('uSize').value = 0.045;
      this.motes.u('uSwirl').value = 1.1;
      this.motes.u('uElong').value = 1;
      this.motes.u('uMaxPx').value = 9 * (viewportH / 1080);
      this.motes.u('uAlpha').value = 0.55 * moteAmt;
      // Teal core drifting to violet; blight pushes it toward sick green.
      this.tmpC.setRGB(0.16, 0.85, 0.72, THREE.LinearSRGBColorSpace);
      this.tmpC.lerp(this.blightC, THREE.MathUtils.clamp(params.spore - 0.3, 0, 1));
      (this.motes.u('uColor').value as THREE.Color).copy(this.tmpC);
    }

    const sheetA = THREE.MathUtils.clamp((params.ash - 0.25) * 1.4, 0, 1);
    this.sheets.mesh.visible = sheetA > 0.01;
    if (this.sheets.mesh.visible) {
      const m = this.sheets.mat.uniforms;
      (m.uCamPos.value as THREE.Vector3).copy(cam);
      (m.uVel.value as THREE.Vector3).set(
        wind.x * windSpeed * 0.85,
        -0.2,
        wind.y * windSpeed * 0.85,
      );
      m.uTime.value = time;
      m.uAlpha.value = 0.30 * sheetA;
      this.tmpC.copy(media).multiplyScalar(1.12);
      this.tmpC.r += sunColor.r * sunIntensity * toSun * 0.5;
      this.tmpC.g += sunColor.g * sunIntensity * toSun * 0.5;
      this.tmpC.b += sunColor.b * sunIntensity * toSun * 0.5;
      (m.uColor.value as THREE.Color).copy(this.tmpC);
    }
  }

  dispose(): void {
    this.precip.dispose();
    this.motes.dispose();
    this.sheets.dispose();
    this.group.clear();
  }
}
