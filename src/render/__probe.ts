/**
 * Standalone harness for src/render. Boots a throwaway scene through the real
 * pipeline so every shader in the chain is actually compiled and linked by the
 * driver — the only way to catch GLSL errors without the rest of the game.
 * Not part of the build; open /src/render/__probe.html under `npm run dev`.
 */
import * as THREE from 'three';
import type { IAtmosphere } from '../core/contracts';
import type { Ctx, EventBus, InputState, System } from '../core/types';
import { RenderPipeline, RENDER_DEBUG } from './Pipeline';

const log: string[] = [];
const out = document.getElementById('out') as HTMLPreElement;
const origError = console.error.bind(console);
const origWarn = console.warn.bind(console);
let errors = 0;

console.error = (...a: unknown[]) => {
  errors++;
  log.push('ERROR ' + a.map(String).join(' ').slice(0, 4000));
  origError(...a);
};
console.warn = (...a: unknown[]) => {
  log.push('WARN  ' + a.map(String).join(' ').slice(0, 800));
  origWarn(...a);
};

function flush(status: string): void {
  out.textContent = status + '\n\n' + log.join('\n\n');
}

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, depth: true });
renderer.setPixelRatio(1);
renderer.setSize(960, 540, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a1c18);
const camera = new THREE.PerspectiveCamera(65, 960 / 540, 0.1, 12000);
camera.position.set(0, 3, 12);

const sun = new THREE.DirectionalLight(0xffb27a, 3);
sun.position.set(60, 90, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -60;
sun.shadow.camera.far = 300;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0x506070, 0x201510, 0.6));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400, 8, 8),
  new THREE.MeshStandardMaterial({ color: 0x6b5b45, roughness: 0.95 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const inst = new THREE.InstancedMesh(
  new THREE.IcosahedronGeometry(1, 1),
  new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.7, metalness: 0.05 }),
  200,
);
const m = new THREE.Matrix4();
for (let i = 0; i < 200; i++) {
  m.makeTranslation((Math.random() - 0.5) * 80, Math.random() * 3, (Math.random() - 0.5) * 80);
  inst.setMatrixAt(i, m);
}
inst.castShadow = true;
inst.receiveShadow = true;
scene.add(inst);

const skinGeo = new THREE.CylinderGeometry(0.4, 0.4, 4, 8, 4);
const bones = [new THREE.Bone(), new THREE.Bone()];
bones[0].add(bones[1]);
bones[1].position.y = 2;
const skinIdx: number[] = [];
const skinW: number[] = [];
const posAttr = skinGeo.getAttribute('position');
for (let i = 0; i < posAttr.count; i++) {
  const t = THREE.MathUtils.clamp((posAttr.getY(i) + 2) / 4, 0, 1);
  skinIdx.push(0, 1, 0, 0);
  skinW.push(1 - t, t, 0, 0);
}
skinGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIdx, 4));
skinGeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW, 4));
const skinned = new THREE.SkinnedMesh(skinGeo, new THREE.MeshStandardMaterial({ color: 0x9aa0a6 }));
skinned.add(bones[0]);
skinned.bind(new THREE.Skeleton(bones));
skinned.position.set(4, 2, 0);
skinned.castShadow = true;
scene.add(skinned);

const glass = new THREE.Mesh(
  new THREE.SphereGeometry(1.5, 24, 16),
  new THREE.MeshStandardMaterial({ color: 0x2fd0c0, transparent: true, opacity: 0.5 }),
);
glass.position.set(-4, 2, 2);
scene.add(glass);

const bus: EventBus = {
  on: () => () => undefined,
  once: () => () => undefined,
  emit: () => undefined,
};
const input: InputState = {
  held: new Set<string>(),
  pressed: new Set<string>(),
  buttons: new Set<number>(),
  mouseDx: 0,
  mouseDy: 0,
  wheel: 0,
  pointerLocked: false,
};

const skyStub: IAtmosphere = {
  id: 'sky',
  sun,
  weather: {
    kind: 'ashstorm',
    blend: 1,
    windDir: new THREE.Vector2(1, 0),
    windSpeed: 6,
    wetness: 0,
    sunColor: new THREE.Color(3.2, 1.9, 1.1),
    sunDir: new THREE.Vector3(0.5, 0.7, 0.4).normalize(),
    ambient: new THREE.Color(0.18, 0.2, 0.26),
    fogDensity: 0.0035,
  },
  setWeather: () => undefined,
};

const ctx: Ctx = {
  renderer,
  scene,
  camera,
  time: { dt: 1 / 60, elapsed: 0, frame: 0 },
  clock: { hour: 8, day: 1, scale: 60 },
  bus,
  input,
  get: <T extends System>(id: string): T | undefined =>
    id === 'sky' ? (skyStub as unknown as T) : undefined,
  size: { w: 960, h: 540, dpr: 1 },
};

const pipe = new RenderPipeline();

async function run(): Promise<void> {
  await pipe.init(ctx);
  const tiers: Array<'low' | 'medium' | 'high' | 'ultra'> = ['high', 'low', 'medium', 'ultra'];
  for (const tier of tiers) {
    pipe.setQuality(tier);
    for (let i = 0; i < 4; i++) {
      ctx.time.frame++;
      ctx.time.elapsed += 1 / 60;
      camera.position.x = Math.sin(ctx.time.elapsed) * 3;
      camera.lookAt(0, 2, 0);
      camera.updateMatrixWorld(true);
      bones[1].rotation.z = Math.sin(ctx.time.elapsed * 3) * 0.4;
      // three resets renderer.info at the top of every render() call, and one
      // pipeline frame issues ~25 of them — so the counters must be frozen and
      // reset by hand or this only ever reports the final blit.
      if (i === 3) {
        renderer.info.autoReset = false;
        renderer.info.reset();
      }
      pipe.update(ctx);
    }
    log.push(`tier ${tier}: ok, calls=${renderer.info.render.calls}, tris=${renderer.info.render.triangles}`);
    renderer.info.autoReset = true;
  }

  for (const key of ['showAO', 'showContact', 'showNormals', 'showVelocity', 'showVolumetrics', 'showBloom']) {
    RENDER_DEBUG[key] = true;
    ctx.time.frame++;
    pipe.update(ctx);
    RENDER_DEBUG[key] = false;
  }
  for (const key of ['prepass', 'ao', 'contactShadows', 'volumetrics', 'taa', 'motionBlur', 'dof', 'bloom', 'tonemap', 'lut', 'grain', 'chromatic', 'vignette', 'cas']) {
    RENDER_DEBUG[key] = false;
    ctx.time.frame++;
    pipe.update(ctx);
    RENDER_DEBUG[key] = true;
  }

  ctx.size.w = 800;
  ctx.size.h = 600;
  renderer.setSize(800, 600, false);
  camera.aspect = 800 / 600;
  camera.updateProjectionMatrix();
  pipe.resize(ctx);
  pipe.update(ctx);

  const gl = renderer.getContext();
  const glErr = gl.getError();
  if (glErr !== gl.NO_ERROR) log.push(`GL ERROR 0x${glErr.toString(16)}`);

  ctx.size.w = 960;
  ctx.size.h = 540;
  renderer.setSize(960, 540, false);
  camera.aspect = 960 / 540;
  camera.updateProjectionMatrix();
  pipe.setQuality('high');
  pipe.resize(ctx);

  flush(errors === 0 && glErr === gl.NO_ERROR ? 'PROBE OK' : `PROBE FAILED (${errors} errors)`);

  Object.assign(globalThis as Record<string, unknown>, { RENDER_DEBUG, pipe, ctx });

  // Keep rendering so TAA converges and the image can be eyeballed.
  let last = performance.now();
  const tick = (now: number) => {
    requestAnimationFrame(tick);
    ctx.time.dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    ctx.time.elapsed += ctx.time.dt;
    ctx.time.frame++;
    const a = ctx.time.elapsed * 0.8;
    camera.position.set(Math.sin(a) * 16, 3.2 + Math.sin(a * 0.7) * 1.5, Math.cos(a) * 16);
    camera.lookAt(0, 2, 0);
    camera.updateMatrixWorld(true);
    bones[1].rotation.z = Math.sin(ctx.time.elapsed * 2) * 0.4;
    pipe.update(ctx);
  };
  requestAnimationFrame(tick);
}

run().catch((e: unknown) => {
  log.push('THROWN ' + String(e) + '\n' + (e instanceof Error ? e.stack ?? '' : ''));
  flush('PROBE FAILED');
});
