#!/usr/bin/env node
/**
 * VIEWMODEL CLOSE-UP + HIERARCHY PROBE.
 *
 * Boots the real game, stands the player on flat ground in first person, and
 * then does two things the ordinary capture cannot:
 *
 *   1. dumps every child of the `viewmodel` group — name, visibility, material
 *      colour, world position, camera-space position and projected screen box —
 *      so "is the upper arm being drawn at all" is answered with numbers rather
 *      than by staring at a stump;
 *   2. narrows the camera FOV to a telephoto and re-frames, so the hand and the
 *      forearm fill the plate at pixel scale.
 *
 * Everything else is exactly the live game: same poser, same materials, same
 * depth band.
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const URL = 'http://127.0.0.1:5178/';
const OUT = process.env.OUT ?? 'shots/vmzoom';
const FOV = +(process.env.FOV ?? 22);

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
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1600,900', '--mute-audio'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 200)); });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(1200);

await page.evaluate(async () => {
  const ctx = window.engine.ctx, p = ctx.get('player'), t = ctx.get('terrain');
  p.freefly = false;
  ctx.input.pointerLocked = true;
  ctx.clock.hour = 11;
  let best = null;
  for (let x = -400; x <= 400; x += 40) {
    for (let z = -400; z <= 400; z += 40) {
      const h = t.heightAt(x, z);
      if (h < 2 || h > 60) continue;
      const n = t.normalAt(x, z);
      if (!best || n.y > best.flat) best = { x, z, flat: n.y, h };
    }
  }
  p.teleport(best.x, best.z, 0.2);
  p.setLook(0.7, -0.06);
  await new Promise((r) => setTimeout(r, 1200));
});

const shot = async (name) => { await writeFile(`${OUT}/${name}.png`, await page.screenshot({ type: 'png' })); console.log('  shot', name); };

/**
 * Close-up on whatever the viewmodel is doing, at 3x device scale so the crop
 * is a real 3x optical zoom rather than an upscale of 1600x900 pixels. The clip
 * is derived from the projected bounds of the named meshes, so it follows the
 * pose instead of being a hand-tuned rectangle that stops framing the hand the
 * moment anything moves.
 */
const closeup = async (name, names, pad = 0.10) => {
  const box = await page.evaluate((names) => {
    const ctx = window.engine.ctx, T = window.RENDER_THREE;
    const vm = ctx.scene.getObjectByName('viewmodel');
    const cam = ctx.camera;
    const b = new T.Box3();
    const v = new T.Vector3();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const o of vm.children) {
      if (!o.isMesh || !o.visible || !names.includes(o.name)) continue;
      b.setFromObject(o, true);
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
        v.project(cam);
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
        y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
    }
    return x1 > x0 ? { x0, y0, x1, y1 } : null;
  }, names);
  if (box === null) { console.log('  (no', name, ')'); return; }
  const W = 1600, H = 900, S = 3;
  const px = (nx) => ((nx + 1) / 2) * W;
  const py = (ny) => ((1 - ny) / 2) * H;
  let x = px(box.x0) - pad * W, y = py(box.y1) - pad * H;
  let w = px(box.x1) - px(box.x0) + 2 * pad * W, h = py(box.y0) - py(box.y1) + 2 * pad * H;
  x = Math.max(0, x); y = Math.max(0, y);
  w = Math.min(W - x, w); h = Math.min(H - y, h);
  await writeFile(`${OUT}/${name}.png`, await page.screenshot({ type: 'png', clip: { x, y, width: w, height: h, scale: S } }));
  console.log('  closeup', name, `${Math.round(w)}x${Math.round(h)} @${S}x`);
};
const setWeapon = (i) => page.evaluate((i) => { window.engine.ctx.get('combat').equip(i); }, i);
const press = (b) => page.evaluate((b) => { window.engine.ctx.input.buttons.add(b); }, b);
const release = (b) => page.evaluate((b) => { window.engine.ctx.input.buttons.delete(b); }, b);
const setFov = (f) => page.evaluate((f) => {
  const c = window.engine.ctx.camera;
  if (window.__fov0 === undefined) window.__fov0 = c.fov;
  c.fov = f === null ? window.__fov0 : f;
  c.updateProjectionMatrix();
  window.engine.ctx.get('player').fovLock = true;
}, f);

const dump = () => page.evaluate(() => {
  const ctx = window.engine.ctx, T = window.RENDER_THREE;
  const vm = ctx.scene.getObjectByName('viewmodel');
  if (!vm) return { error: 'no viewmodel group' };
  const cam = ctx.camera;
  const out = [];
  const box = new T.Box3();
  const v = new T.Vector3();
  for (const o of vm.children) {
    if (!o.isMesh) continue;
    const wp = o.getWorldPosition(new T.Vector3());
    const cp = wp.clone().applyMatrix4(cam.matrixWorldInverse);
    box.setFromObject(o, true);
    let sx0 = 1e9, sy0 = 1e9, sx1 = -1e9, sy1 = -1e9, behind = 0, n = 0;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      const c = v.clone().applyMatrix4(cam.matrixWorldInverse);
      if (c.z > -0.001) behind++;
      v.project(cam);
      sx0 = Math.min(sx0, v.x); sx1 = Math.max(sx1, v.x);
      sy0 = Math.min(sy0, v.y); sy1 = Math.max(sy1, v.y);
      n++;
    }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    out.push({
      name: o.name || '(unnamed)',
      vis: o.visible,
      tris: o.geometry.getIndex() ? o.geometry.getIndex().count / 3 : 0,
      scale: [+o.scale.x.toFixed(3), +o.scale.y.toFixed(3), +o.scale.z.toFixed(3)],
      cam: [+cp.x.toFixed(3), +cp.y.toFixed(3), +cp.z.toFixed(3)],
      ndc: [+sx0.toFixed(2), +sy0.toFixed(2), +sx1.toFixed(2), +sy1.toFixed(2)],
      behindCam: behind,
      mat: mats.map((m) => '#' + m.color.getHexString()).join(','),
    });
  }
  return { near: cam.near, far: cam.far, fov: cam.fov, children: out };
});

// --- sword at rest, wide, then telephoto.
await setWeapon(0);
await sleep(700);
console.log('\nHIERARCHY, sword at rest');
console.log(JSON.stringify(await dump(), null, 1));
await shot('wide-sword');
await closeup('cu-sword-rest', ['vm-hand-r', 'vm-fore-r']);
await closeup('cu-hand-rest', ['vm-hand-r'], 0.03);
await press(0); await sleep(420);
await closeup('cu-sword-wind', ['vm-hand-r', 'vm-fore-r']);
await release(0);
await sleep(90); await closeup('cu-sword-swing', ['vm-hand-r', 'vm-fore-r']);
await sleep(900);
await press(2); await sleep(700);
await shot('wide-block');
await closeup('cu-block', ['vm-hand-r', 'vm-fore-r']);
await release(2);
await sleep(500);

// --- unarmed.
await setWeapon(6);
await page.evaluate(() => window.engine.ctx.get('combat').setShield('none'));
await sleep(700);
console.log('\nHIERARCHY, unarmed');
console.log(JSON.stringify(await dump(), null, 1));
await shot('wide-fists');
await closeup('cu-fist-r', ['vm-fist-r'], 0.05);
await closeup('cu-fist-arm', ['vm-fist-r', 'vm-fore-r']);
await page.evaluate(() => window.engine.ctx.get('player').setLook(0.7, -0.75));
await sleep(500);
await shot('wide-fists-down');
await closeup('cu-fists-down', ['vm-fist-r', 'vm-fore-r']);
await page.evaluate(() => window.engine.ctx.get('player').setLook(0.7, -0.06));

// --- sword, looking down the arm.
await setWeapon(0);
await page.evaluate(() => window.engine.ctx.get('combat').setShield('wooden_shield'));
await sleep(600);
await page.evaluate(() => window.engine.ctx.get('player').setLook(0.7, -0.85));
await sleep(600);
await shot('wide-down');
await closeup('cu-down', ['vm-hand-r', 'vm-fore-r']);
await closeup('cu-grip', ['vm-hand-r'], 0.03);

if (errors.length) { console.log('ERRORS:'); [...new Set(errors)].slice(0, 10).forEach((e) => console.log('  ' + e)); }
await browser.close();
vite?.kill();
