#!/usr/bin/env node
/**
 * First-person viewmodel capture.
 *
 * Boots the real game, drops the player on flat ground in first person with a
 * weapon readied, and grabs the frames that decide whether a viewmodel works:
 * rest, mid-wind, three points across the live arc, blocking, unarmed, two
 * handed, a bow, and standing hard against a wall.
 *
 * Everything is driven through the same input the player uses (buttons on
 * ctx.input) so the swing state machine runs exactly as it does in play.
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const URL = 'http://127.0.0.1:5178/';
const OUT = process.env.OUT ?? 'shots/vm';

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
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 240)); });

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(1200);

const shot = async (name) => { await writeFile(`${OUT}/${name}.png`, await page.screenshot({ type: 'png' })); console.log('  shot', name); };

// Flat, dry ground, noon light, looking at the horizon.
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
      const flat = n.y;
      if (!best || flat > best.flat) best = { x, z, flat, h };
    }
  }
  window.__spot = best;
  p.teleport(best.x, best.z, 0.2);
  p.setLook(0.7, -0.06);
  await new Promise((r) => setTimeout(r, 1200));
});
console.log('spot', await page.evaluate(() => window.__spot));

const setWeapon = (i) => page.evaluate((i) => { window.engine.ctx.get('combat').equip(i); }, i);
const press = (b) => page.evaluate((b) => { window.engine.ctx.input.buttons.add(b); }, b);
const release = (b) => page.evaluate((b) => { window.engine.ctx.input.buttons.delete(b); }, b);
const phase = () => page.evaluate(() => {
  const c = window.engine.ctx.get('combat');
  return { phase: c.swingPhase ?? '?', s: +(c.swingS ?? 0).toFixed(2) };
});

// 0 broadsword, 1 spear, 2 warhammer (two-handed), 5 bow.
for (const [idx, label] of [[0, 'sword'], [2, 'hammer'], [1, 'spear'], [5, 'bow']]) {
  await setWeapon(idx);
  await sleep(500);
  await shot(`rest-${label}`);
}

await setWeapon(0);
await sleep(400);

// Wind: hold the button. The windup pins at full charge while held.
await press(0);
await sleep(400);
await shot('wind');
console.log('  ', JSON.stringify(await phase()));
await release(0);
// The live window is ~0.17 s: sample it tightly.
for (const ms of [40, 90, 150, 240]) {
  await sleep(ms === 40 ? 40 : 50);
  await shot(`swing-${ms}`);
  console.log('  ', ms, JSON.stringify(await phase()));
}
await sleep(900);

// Block.
await press(2);
await sleep(700);
await shot('block');
await release(2);
await sleep(600);

// Unarmed: bare hands are the last loadout slot. Drop the shield too, so both
// hands are fists.
await setWeapon(6);
await page.evaluate(() => window.engine.ctx.get('combat').setShield('none'));
await sleep(600);
await shot('fists-rest');
await press(2); await sleep(600); await shot('fists-block'); await release(2);
await sleep(400);
await press(0);
await sleep(400);
await shot('fists-wind');
await release(0);
await sleep(120);
await shot('fists-swing');
await sleep(900);
await setWeapon(0);
await page.evaluate(() => window.engine.ctx.get('combat').setShield('wooden_shield'));
await sleep(400);

// Looking at the ground: the one view that shows what the viewmodel casts.
await page.evaluate(() => window.engine.ctx.get('player').setLook(0.7, -1.15));
await sleep(700);
await shot('look-down');
await page.evaluate(() => window.engine.ctx.get('player').setLook(0.7, -0.06));
await sleep(500);

// Walking: the bob and the gait phase.
await page.keyboard.down('w');
await sleep(700);
await shot('walk-a');
await sleep(260);
await shot('walk-b');
await page.keyboard.up('w');
await sleep(600);

// Hard against a wall, the decisive version: a slab dropped into the scene at a
// measured distance from the eye. The player capsule is 0.34 m in radius, so no
// real wall can ever be closer than that; this puts one at 0.30 m and then at
// 0.20 m, i.e. strictly worse than anything the collider can produce.
for (const d of [0.30, 0.20]) {
  await page.evaluate((dist) => {
    const ctx = window.engine.ctx, T = window.RENDER_THREE;
    const old = ctx.scene.getObjectByName('vm-test-slab');
    if (old) { old.geometry.dispose(); old.material.dispose(); old.removeFromParent(); }
    const dir = new T.Vector3();
    ctx.camera.getWorldDirection(dir);
    const slab = new T.Mesh(
      new T.BoxGeometry(6, 6, 0.4),
      new T.MeshStandardMaterial({ color: 0x2f6ea8, roughness: 0.8 }),
    );
    slab.name = 'vm-test-slab';
    slab.position.copy(ctx.camera.position).addScaledVector(dir, dist + 0.2);
    slab.quaternion.copy(ctx.camera.quaternion);
    ctx.scene.add(slab);
  }, d);
  await sleep(500);
  await shot(`slab-${String(d).replace('.', '')}`);
  await press(0); await sleep(420); await shot(`slab-${String(d).replace('.', '')}-wind`); await release(0);
  await sleep(110); await shot(`slab-${String(d).replace('.', '')}-swing`);
  await sleep(800);
}
await page.evaluate(() => {
  const o = window.engine.ctx.scene.getObjectByName('vm-test-slab');
  if (o) { o.geometry.dispose(); o.material.dispose(); o.removeFromParent(); }
});
await sleep(400);

// Hard against a wall: stand off a piece of architecture, face it and WALK
// into it, so the collider is what decides how close the camera ends up.
const wall = await page.evaluate(async () => {
  const ctx = window.engine.ctx, p = ctx.get('player'), T = window.RENDER_THREE;
  const arch = ctx.scene.getObjectByName('architecture');
  if (!arch) return null;
  const box = new T.Box3();
  const c = new T.Vector3();
  let best = null;
  arch.traverseVisible((o) => {
    if (!o.isMesh) return;
    box.setFromObject(o);
    box.getCenter(c);
    const size = box.getSize(new T.Vector3());
    if (size.y < 2.5 || Math.max(size.x, size.z) < 2) return;
    const d = Math.hypot(c.x - p.position.x, c.z - p.position.z);
    if (best === null || d < best.d) best = { x: c.x, y: box.min.y, z: c.z, d, sx: size.x, sz: size.z };
  });
  if (best === null) return null;

  // Drop into the middle of the structure and let the collider decide where the
  // player can actually stand; then fan rays around the camera to find the
  // nearest surface and face it. Bounding boxes lie about courtyards.
  p.teleport(best.x, best.z, 0.4);
  await new Promise((r) => setTimeout(r, 1200));
  const origin = ctx.camera.position.clone();
  const dir = new T.Vector3();
  let near = null;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    dir.set(Math.sin(a), 0, Math.cos(a));
    const rc = new T.Raycaster(origin, dir, 0.05, 12);
    const h = rc.intersectObject(arch, true)[0];
    if (h && (near === null || h.distance < near.d)) near = { d: h.distance, a };
  }
  if (near === null) return { ...best, hit: false };
  p.setLook(near.a + Math.PI, 0);
  await new Promise((r) => setTimeout(r, 600));
  return { ...best, hit: true, nearest: +near.d.toFixed(2) };
});
console.log('wall', JSON.stringify(wall));
if (wall) {
  await page.keyboard.down('w');
  await sleep(2600);
  await page.keyboard.up('w');
  await sleep(400);
  // How close did the collider actually let us get? Anything under half a
  // metre is the case the depth band exists for.
  const gap = await page.evaluate(() => {
    const ctx = window.engine.ctx, T = window.RENDER_THREE;
    const arch = ctx.scene.getObjectByName('architecture');
    const dir = new T.Vector3();
    ctx.camera.getWorldDirection(dir);
    const rc = new T.Raycaster(ctx.camera.position.clone(), dir, 0.01, 20);
    const hits = rc.intersectObject(arch, true);
    return hits.length ? +hits[0].distance.toFixed(3) : null;
  });
  console.log('  wall gap:', gap, 'm');
  await shot('wall-rest');
  await press(0); await sleep(400); await shot('wall-wind'); await release(0);
  await sleep(120); await shot('wall-swing');
  await sleep(900);
}

// Third person must be untouched.
await page.evaluate(async () => {
  const p = window.engine.ctx.get('player');
  window.__spot && p.teleport(window.__spot.x, window.__spot.z, 0.2);
  await new Promise((r) => setTimeout(r, 800));
});
await page.keyboard.press('v');
await sleep(1200);
await shot('third');
await page.keyboard.press('v');
await sleep(800);
await shot('back-to-first');

const stats = await page.evaluate(() => {
  const r = window.engine.ctx.renderer.info.render;
  return { calls: r.calls, triangles: r.triangles };
});
console.log('RENDER:', JSON.stringify(stats));
if (errors.length) { console.log('ERRORS:'); [...new Set(errors)].slice(0, 12).forEach((e) => console.log('  ' + e)); }
await browser.close();
vite?.kill();
