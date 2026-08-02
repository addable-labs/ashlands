#!/usr/bin/env node
/**
 * Measure the weapon hand instead of guessing at it.
 *
 * For each pose it reports, in one line:
 *   - the gauntlet's screen bbox and what fraction of frame HEIGHT it covers
 *   - the wrap angle `th` on the gauntlet that faces the camera (which decides
 *     whether the player is looking at knuckles, thumb, or the back of a slab)
 *   - the luminance histogram of the gauntlet's own pixels, and of the
 *     background immediately around it, so "black blob on bright sky" is a
 *     number and not an opinion.
 *
 * The gauntlet mask is exact: the mesh is temporarily given a flat magenta
 * basic material and re-shot, so every pixel it owns is known.
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { PNG } from 'pngjs';

const URL = 'http://127.0.0.1:5178/';
const OUT = process.env.OUT ?? 'shots/vm-measure';
const W = 1600, H = 900;

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
  defaultViewport: { width: W, height: H },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(1500);

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
  window.__spot = best;
  p.teleport(best.x, best.z, 0.2);
  p.setLook(0.7, -0.06);
  await new Promise((r) => setTimeout(r, 1200));
});

const raw = async () => PNG.sync.read(Buffer.from(await page.screenshot({ type: 'png' })));

/** Screen bbox + camera-facing wrap angle for one named viewmodel mesh. */
const geom = (name) => page.evaluate((nm) => {
  const ctx = window.engine.ctx, cam = ctx.camera, T = window.RENDER_THREE;
  const o = ctx.scene.getObjectByName(nm);
  if (!o || !o.visible) return null;
  o.updateWorldMatrix(true, false);
  const pos = o.geometry.getAttribute('position');
  const v = new T.Vector3();
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, behind = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
    const e = v.clone().project(cam);
    if (e.z > 1) { behind++; continue; }
    x0 = Math.min(x0, e.x); x1 = Math.max(x1, e.x);
    y0 = Math.min(y0, e.y); y1 = Math.max(y1, e.y);
  }
  // Which wrap angle faces the lens. The gauntlet is authored about its local
  // +Y (the haft), with x = cos(th) r, z = sin(th) r.
  const c = new T.Vector3();
  o.geometry.computeBoundingSphere();
  c.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld);
  const toCam = cam.position.clone().sub(c);
  const inv = new T.Matrix4().copy(o.matrixWorld).invert();
  const dir = toCam.clone().transformDirection(inv);
  const th = Math.atan2(dir.z, dir.x);
  return {
    ndc: [x0, y0, x1, y1].map((n) => +n.toFixed(3)),
    th: +th.toFixed(2), behind,
    centre: [+((x0 + x1) / 2).toFixed(2), +((y0 + y1) / 2).toFixed(2)],
  };
}, name);

/**
 * Exact pixel mask for a mesh, by difference.
 *
 * Combat rewrites every viewmodel mesh's `visible` and transform each frame, so
 * the hide has to happen inside the render itself: `Scene.onBeforeRender` runs
 * after the game's update and before three walks the graph, which is the one
 * window where a viewmodel mesh can be taken out of a frame.
 */
async function hidden(name) {
  await page.evaluate((nm) => {
    const ctx = window.engine.ctx;
    ctx.scene.onBeforeRender = () => {
      const o = ctx.scene.getObjectByName(nm);
      if (o) o.visible = false;
    };
  }, name);
  await sleep(240);
  const m = await raw();
  await page.evaluate(() => { window.engine.ctx.scene.onBeforeRender = () => {}; });
  await sleep(240);
  return m;
}

const LUM = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

function stats(shot, mk, ndc) {
  const on = [], near = [];
  const px = new Uint8Array(W * H);
  // The world is never still — ash drifts, the sky animates — so a whole-frame
  // difference is mostly weather. The mask is only ever looked for inside the
  // gauntlet's own projected bounding box, which comes from its vertices.
  const rx0 = Math.max(0, Math.floor((ndc[0] + 1) / 2 * W) - 4);
  const rx1 = Math.min(W - 1, Math.ceil((ndc[2] + 1) / 2 * W) + 4);
  const ry0 = Math.max(0, Math.floor((1 - ndc[3]) / 2 * H) - 4);
  const ry1 = Math.min(H - 1, Math.ceil((1 - ndc[1]) / 2 * H) + 4);
  for (let y = ry0; y <= ry1; y++) {
    for (let x = rx0; x <= rx1; x++) {
      const i = (y * W + x) * 4;
      const d = Math.abs(shot.data[i] - mk.data[i]) + Math.abs(shot.data[i + 1] - mk.data[i + 1])
        + Math.abs(shot.data[i + 2] - mk.data[i + 2]);
      if (d > 26) px[y * W + x] = 1;
    }
  }
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!px[y * W + x]) continue;
      on.push(LUM(shot.data, (y * W + x) * 4));
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (!on.length) return null;
  // Background ring: 26 px out from the mask, not on it.
  const R = 26;
  for (let y = Math.max(0, y0 - R); y < Math.min(H, y1 + R); y++) {
    for (let x = Math.max(0, x0 - R); x < Math.min(W, x1 + R); x++) {
      if (px[y * W + x]) continue;
      let hit = false;
      for (let dy = -R; dy <= R && !hit; dy += 6) {
        for (let dx = -R; dx <= R && !hit; dx += 6) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
          if (px[yy * W + xx]) hit = true;
        }
      }
      if (hit) near.push(LUM(shot.data, (y * W + x) * 4));
    }
  }
  const q = (a, f) => a.slice().sort((p, r) => p - r)[Math.floor(f * (a.length - 1))] | 0;
  return {
    px: on.length,
    frac: +(on.length / (W * H) * 100).toFixed(2),
    hFrac: +(((y1 - y0 + 1) / H) * 100).toFixed(1),
    box: [x0, y0, x1 - x0 + 1, y1 - y0 + 1],
    lum: { p5: q(on, 0.05), p25: q(on, 0.25), med: q(on, 0.5), p75: q(on, 0.75), p95: q(on, 0.95) },
    bg: near.length ? { med: q(near, 0.5) } : null,
    dark: +((on.filter((v) => v < 40).length / on.length) * 100).toFixed(0),
  };
}

async function measure(label, meshName = 'vm-gauntlet-r') {
  const g = await geom(meshName);
  const shot = await raw();
  await writeFile(`${OUT}/${label}.png`, PNG.sync.write(shot));
  const mk = await hidden(meshName);
  const s = g ? stats(shot, mk, g.ndc) : null;
  console.log(label.padEnd(16),
    'ndc', g ? JSON.stringify(g.ndc) : 'null',
    'th', g ? g.th : '-',
    s ? `| h%=${s.hFrac} area%=${s.frac} box=${s.box.join(',')} lum p5/25/50/75/95=${s.lum.p5}/${s.lum.p25}/${s.lum.med}/${s.lum.p75}/${s.lum.p95} bg=${s.bg?.med} <40=${s.dark}%` : '| NO PIXELS');
  return { g, s };
}

const setWeapon = (i) => page.evaluate((i) => window.engine.ctx.get('combat').equip(i), i);
const press = (b) => page.evaluate((b) => window.engine.ctx.input.buttons.add(b), b);
const release = (b) => page.evaluate((b) => window.engine.ctx.input.buttons.delete(b), b);

await setWeapon(0); await sleep(600);
await measure('rest-sword');
await press(0); await sleep(500); await measure('wind'); await release(0);
await sleep(1400);
await press(2); await sleep(700); await measure('block'); await release(2);
await sleep(700);
await page.evaluate(() => window.engine.ctx.get('player').setLook(0.7, -1.15));
await sleep(700); await measure('look-down');
await page.evaluate(() => window.engine.ctx.get('player').setLook(0.7, -0.06));
await sleep(600);

// Against bright sky: pitch up so the hand is silhouetted on nothing but sky.
await page.evaluate(() => window.engine.ctx.get('player').setLook(0.7, 0.55));
await sleep(700); await measure('sky');
await page.evaluate(() => window.engine.ctx.get('player').setLook(0.7, -0.06));
await sleep(600);

// A flat blue slab 30 cm off the lens: the reviewer's black-silhouette case,
// and the one place the world gives the viewmodel nothing to be lit by.
await page.evaluate(() => {
  const ctx = window.engine.ctx, T = window.RENDER_THREE;
  const dir = new T.Vector3();
  ctx.camera.getWorldDirection(dir);
  const slab = new T.Mesh(new T.BoxGeometry(6, 6, 0.4),
    new T.MeshStandardMaterial({ color: 0x2f6ea8, roughness: 0.8 }));
  slab.name = 'vm-test-slab';
  slab.position.copy(ctx.camera.position).addScaledVector(dir, 0.5);
  slab.quaternion.copy(ctx.camera.quaternion);
  ctx.scene.add(slab);
});
await sleep(700);
await measure('slab');
await page.evaluate(() => {
  const o = window.engine.ctx.scene.getObjectByName('vm-test-slab');
  if (o) { o.geometry.dispose(); o.material.dispose(); o.removeFromParent(); }
});
await sleep(500);

await setWeapon(6);
await page.evaluate(() => window.engine.ctx.get('combat').setShield('none'));
await sleep(700);
await measure('fists-rest', 'vm-fist-r');
await press(2); await sleep(700); await measure('fists-block', 'vm-fist-r'); await release(2);
await sleep(600);
await setWeapon(0);
await page.evaluate(() => window.engine.ctx.get('combat').setShield('wooden_shield'));
await sleep(600);

/**
 * The swing is 400 ms end to end; a screenshot plus a mask is 1 s, so the arc
 * cannot be sampled by capture. Poll the projected box instead — that is what
 * "the hand leaves frame" actually means — and report the worst frame.
 */
async function arc(label, hold) {
  await press(0);
  await sleep(hold);
  await release(0);
  const seen = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 900) {
    const g = await geom('vm-gauntlet-r');
    if (g) seen.push(g);
  }
  let worstX = -9, worstY = -9, minTh = 9, maxTh = -9;
  for (const s of seen) {
    worstX = Math.max(worstX, s.ndc[2] - 1, -1 - s.ndc[0]);
    worstY = Math.max(worstY, s.ndc[3] - 1, -1 - s.ndc[1]);
    minTh = Math.min(minTh, s.th); maxTh = Math.max(maxTh, s.th);
  }
  const box = seen.reduce((a, s) => [
    Math.min(a[0], s.ndc[0]), Math.min(a[1], s.ndc[1]),
    Math.max(a[2], s.ndc[2]), Math.max(a[3], s.ndc[3]),
  ], [9, 9, -9, -9]);
  console.log(label.padEnd(16), 'n', seen.length,
    'sweep ndc', box.map((v) => v.toFixed(2)).join(','),
    'overrun', worstX.toFixed(2), worstY.toFixed(2),
    'th', minTh.toFixed(2), '..', maxTh.toFixed(2));
  await sleep(700);
}
await arc('arc-tap', 60);
await arc('arc-charged', 500);
await page.keyboard.down('a'); await sleep(300);
await arc('arc-slash', 500);
await page.keyboard.up('a'); await sleep(400);
await page.keyboard.down('w'); await sleep(300);
await arc('arc-thrust', 500);
await page.keyboard.up('w'); await sleep(400);

await browser.close();
vite?.kill();
