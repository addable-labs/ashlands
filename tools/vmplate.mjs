#!/usr/bin/env node
/**
 * ARMOURED VIEWMODEL, ISOLATED — the same arm, the same sun, the same
 * environment map, but with the world hidden, the depth band switched off, and
 * a camera orbited round the right gauntlet and vambrace alone.
 *
 *   OUT=shots/vm-plate node tools/vmplate.mjs
 *
 * Unlike tools/vmiso.mjs this does NOT swap in a neutral material: the whole
 * question is whether the plate reads as metal under the scene's own light, so
 * the materials have to be the real ones.
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const URL = 'http://127.0.0.1:5178/';
const OUT = process.env.OUT ?? 'shots/vm-plate';

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) {
  vite = spawn('npx', ['vite', '--port', '5178', '--host', '127.0.0.1'], { stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
}
await mkdir(OUT, { recursive: true });

const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1100,1100', '--mute-audio'],
  defaultViewport: { width: 1100, height: 1100 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 200)); });

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(1500);

const info = await page.evaluate(async () => {
  const ctx = window.engine.ctx, T = window.RENDER_THREE, p = ctx.get('player'), t = ctx.get('terrain');
  const gear = await import('/src/combat/Gear.ts');
  gear.VIEWMODEL_DEPTH.value.x = 0;                    // draw at true depth
  p.freefly = false;
  ctx.input.pointerLocked = true;
  ctx.clock.hour = 11;
  let best = null;
  for (let x = -400; x <= 400; x += 80) {
    for (let z = -400; z <= 400; z += 80) {
      const h = t.heightAt(x, z);
      if (h < 2 || h > 60) continue;
      const n = t.normalAt(x, z);
      if (!best || n.y > best.flat) best = { x, z, flat: n.y };
    }
  }
  p.teleport(best.x, best.z, 0.2);
  p.setLook(0.7, -0.06);
  await new Promise((r) => setTimeout(r, 1200));
  // The viewmodel group hangs off the combat group, so hide siblings at every
  // level on the way down to it rather than only at the scene root.
  const vm = ctx.scene.getObjectByName('viewmodel');
  const keep = new Set();
  for (let o = vm; o; o = o.parent) keep.add(o);
  const walk = (node) => {
    for (const o of node.children) {
      if (o.isLight || o === vm) continue;
      if (keep.has(o)) { walk(o); continue; }
      o.visible = false;
    }
  };
  walk(ctx.scene);
  ctx.scene.background = new T.Color(0x30323a);
  window.__fog = ctx.scene.fog;
  ctx.scene.fog = null;
  const names = [];
  ctx.scene.getObjectByName('viewmodel').traverseVisible((o) => {
    if (!o.isMesh) return;
    const i = o.geometry.getIndex();
    names.push(o.name + ':' + (i ? i.count / 3 : 0));
  });
  return names;
});
console.log('drawn:', info.join('  '));

// The engine's own RAF loop repaints the canvas the instant we let go of the
// thread, so every frame here is rendered into an offscreen target and read
// back rather than screenshotted.
await page.evaluate(() => {
  const T = window.RENDER_THREE;
  const SZ = 1000;
  window.__rt = {
    SZ,
    rt: new T.WebGLRenderTarget(SZ, SZ, { colorSpace: T.SRGBColorSpace }),
    cv: Object.assign(document.createElement('canvas'), { width: SZ, height: SZ }),
  };
});

const grab = async (name, args) => {
  const png = await page.evaluate(([dx, dy, dz, hand, only]) => {
    const ctx = window.engine.ctx, T = window.RENDER_THREE, { rt, cv, SZ } = window.__rt;
    const box = new T.Box3();
    const want = hand === 2
      ? ['vm-shield', 'vm-gauntlet-strap']
      : hand
        ? [only ? 'vm-fist-r' : 'vm-gauntlet-r']
        : [only ? 'vm-fist-r' : 'vm-gauntlet-r', 'vm-vambrace-r'];
    for (const n of want) {
      const o = ctx.scene.getObjectByName(n);
      if (o && o.visible) box.expandByObject(o);
    }
    const c = box.getCenter(new T.Vector3());
    const r = box.getSize(new T.Vector3()).length() * 0.5;
    const cam = ctx.camera;
    // Camera basis in the aim frame, so "side" means along the aim right.
    const fwd = new T.Vector3();
    cam.getWorldDirection(fwd);
    const right = fwd.clone().cross(new T.Vector3(0, 1, 0)).normalize();
    const up = right.clone().cross(fwd).normalize();
    const dir = new T.Vector3()
      .addScaledVector(right, dx).addScaledVector(up, dy).addScaledVector(fwd, -dz)
      .normalize();
    cam.position.copy(c).addScaledVector(dir, r * 2.3);
    cam.up.copy(Math.abs(dy) > 0.9 ? fwd.clone().negate() : up);
    cam.lookAt(c);
    cam.near = 0.01; cam.far = 60; cam.fov = 32; cam.updateProjectionMatrix();
    ctx.renderer.setRenderTarget(rt);
    ctx.renderer.clear();
    ctx.renderer.render(ctx.scene, ctx.camera);
    const buf = new Uint8Array(SZ * SZ * 4);
    ctx.renderer.readRenderTargetPixels(rt, 0, 0, SZ, SZ, buf);
    ctx.renderer.setRenderTarget(null);
    const g = cv.getContext('2d');
    const img = g.createImageData(SZ, SZ);
    for (let y = 0; y < SZ; y++) {
      const src = (SZ - 1 - y) * SZ * 4;
      img.data.set(buf.subarray(src, src + SZ * 4), y * SZ * 4);
    }
    g.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }, args);
  await writeFile(`${OUT}/${name}.png`, Buffer.from(png.split(',')[1], 'base64'));
  console.log('  iso', name);
};

const views = [
  ['side-lat', 1, 0.10, 0.05],
  ['side-med', -1, 0.10, 0.05],
  ['above', 0.10, 1, 0.10],
  ['below', 0.10, -1, 0.10],
  ['front', 0.10, 0.10, 1],
  ['back', 0.10, 0.10, -1],
  ['three-q', 0.75, 0.45, 0.55],
];

const setWeapon = (i) => page.evaluate((i) => { window.engine.ctx.get('combat').equip(i); }, i);

for (const [idx, label, only] of [[0, 'sword', false], [6, 'fists', true]]) {
  await setWeapon(idx);
  await sleep(700);
  for (const [name, dx, dy, dz] of views) {
    for (const [tag, hand] of (label === 'sword'
      ? [['arm', false], ['hand', true], ['shield', 2]]
      : [['arm', false], ['hand', true]])) {
      await grab(`${label}-${tag}-${name}`, [dx, dy, dz, hand, only]);
    }
  }
}

if (errors.length) { console.log('ERRORS:'); [...new Set(errors)].slice(0, 10).forEach((e) => console.log('  ' + e)); }
await browser.close();
vite?.kill();
