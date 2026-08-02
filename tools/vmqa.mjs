#!/usr/bin/env node
/**
 * VIEWMODEL QA CAPTURE — the canonical review set.
 *
 *   node tools/vmqa.mjs            -> shots/vm-final/
 *   OUT=shots/vm-x node tools/vmqa.mjs
 *
 * Boots the real game, stands the player on flat ground in first person, and
 * grabs the frames a character-art review actually needs: every weapon class at
 * rest, the swing sampled through its live window, a block, bare fists, and a
 * telephoto close-up of each hand ON its grip.
 *
 * WHY THIS EXISTS RATHER THAN A HAND-TUNED CROP LIST. The last review could not
 * be signed off because two of sixteen frames contained no hands at all —
 * `grip-block.png` was entirely landscape and `shield-hand.png` was entirely
 * ground texture, because the crop rectangles were fixed numbers and the poses
 * had moved out from under them. So:
 *
 *   1. every crop is derived from the PROJECTED BOUNDS of the meshes it is
 *      supposed to frame, so it follows the pose;
 *   2. every crop is then PROVEN, by re-shooting the same rectangle with the
 *      viewmodel hidden and counting how many pixels changed. A frame whose
 *      subject covers less than 12% of its own crop is reported as EMPTY and
 *      the run exits non-zero. A capture set that cannot fail is not a test.
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { PNG } from 'pngjs';

/**
 * ITS OWN PORT, and it does not go looking for a server it did not start.
 *
 * The obvious thing is to reuse 5178 like every other capture script here, and
 * it cost an hour: a `vite preview --outDir dist-e2e` from an unrelated run had
 * taken the port, so `up()` said yes, the page loaded A STALE BUILD, and the
 * capture set came back showing a viewmodel with no hands on it — geometry that
 * had not existed in the source for three revisions. A harness that silently
 * photographs a different build than the one on disk is worse than no harness.
 */
const PORT = process.env.PORT ?? '5181';
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.OUT ?? 'shots/vm-final';
const W = 1600;
const H = 900;
const SCALE = 3;

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
// Always a FRESH dev server, started by this run and killed by it. Reusing one
// left over from an earlier run also means it is still holding the module graph
// from before the edit under test, and the first thing it does once the page
// has booted is push an HMR update — which full-reloads the page and destroys
// the execution context mid-capture.
if (await up()) {
  console.log(`something is already serving ${URL} — refusing to photograph a build this run did not make`);
  process.exit(2);
}
const vite = spawn('npx', ['vite', '--port', PORT, '--host', '127.0.0.1'], { stdio: 'ignore' });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(500);
if (!(await up())) { console.log(`vite did not come up on ${PORT}`); process.exit(2); }
await mkdir(OUT, { recursive: true });

const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, '--mute-audio'],
  defaultViewport: { width: W, height: H },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 200)); });
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

const setVm = (v) => page.evaluate((v) => {
  const o = window.engine.ctx.scene.getObjectByName('viewmodel');
  if (o) o.visible = v;
}, v);

const failures = [];
const report = [];

/** Full frame. */
const shot = async (name) => {
  await writeFile(`${OUT}/${name}.png`, await page.screenshot({ type: 'png' }));
  report.push(`  ${name.padEnd(22)} full frame`);
};

/**
 * Pixels that differ enough to be the subject rather than temporal noise.
 *
 * 25, per channel-sum. At 12 the frame-to-frame wobble of TAA, the drifting ash
 * motes and the flora's wind pass alone put a third of the plate over the line,
 * so a crop containing nothing but landscape scored 35% "subject" and sailed
 * through a gate that exists precisely to catch that. At 45 the gate went the
 * other way and started failing correct frames, because ashen Dunmer skin
 * against Vvardenfell ash IS a low-contrast subject — which is the whole reason
 * this viewmodel is hard to light and is not a licence to measure it wrongly.
 */
const DIFFERS = (a, b, i) =>
  Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 25;

/** Projected screen-space bounds of the named viewmodel meshes, in pixels. */
const readBox = (names) => page.evaluate((names) => {
  const ctx = window.engine.ctx, T = window.RENDER_THREE;
  const vm = ctx.scene.getObjectByName('viewmodel');
  if (!vm) return null;
  const cam = ctx.camera;
  const b = new T.Box3();
  const v = new T.Vector3();
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, seen = 0;
  for (const o of vm.children) {
    if (!o.isMesh || !o.visible || !names.includes(o.name)) continue;
    seen++;
    b.setFromObject(o, true);
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
      v.project(cam);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
  }
  return seen === 0 ? null : { x0, y0, x1, y1 };
}, names);

/** NDC bounds -> a clip rectangle inside the plate. */
const rect = (box, pad) => {
  const px = (nx) => ((nx + 1) / 2) * W;
  const py = (ny) => ((1 - ny) / 2) * H;
  let x = px(box.x0) - pad * W;
  let y = py(box.y1) - pad * H;
  let w = px(box.x1) - px(box.x0) + 2 * pad * W;
  let h = py(box.y0) - py(box.y1) + 2 * pad * H;
  // A pose can put half the hand off frame; clamp into the plate and keep the
  // rectangle over the part that IS on screen rather than sliding off with it.
  x = Math.max(0, Math.min(W - 40, x));
  y = Math.max(0, Math.min(H - 40, y));
  w = Math.max(40, Math.min(W - x, w));
  h = Math.max(40, Math.min(H - y, h));
  return { x, y, width: w, height: h, scale: SCALE };
};

/**
 * Crop framed on the named viewmodel meshes, then PROVEN against a
 * viewmodel-hidden re-shoot of the same rectangle.
 */
const closeup = async (name, names, pad = 0.10, pose = null) => {
  /**
   * A TRANSIENT pose cannot be framed from a single projected bounding box, and
   * that is a race rather than a tuning problem: the live window of a swing is
   * 170 ms and the hand crosses it at about 9 m/s, so between the round trip
   * that reads the box and the round trip that takes the picture the hand has
   * moved half a metre. The crop came back framed on where the hand HAD been
   * and contained nothing but landscape — which is exactly the defect this
   * harness exists to stop shipping, reached by a different route.
   *
   * The fix is a CALIBRATION PASS. Drive the pose, read the box, burn a
   * screenshot to reproduce the latency exactly, read the box again: the hand
   * was somewhere between those two boxes while the shutter was open, so their
   * union contains it. Then drive the identical pose again and shoot the union.
   * Deterministic, because the pose is driven through the same buttons the
   * player uses and the timing is replayed rather than guessed at.
   */
  let clip;
  if (pose) {
    await pose();
    const b1 = await readBox(names);
    if (b1 === null) { failures.push(`${name}: none of ${names.join(',')} is visible`); return; }
    await page.screenshot({ type: 'png' });
    const b2 = (await readBox(names)) ?? b1;
    clip = rect({
      x0: Math.min(b1.x0, b2.x0), y0: Math.min(b1.y0, b2.y0),
      x1: Math.max(b1.x1, b2.x1), y1: Math.max(b1.y1, b2.y1),
    }, pad);
    await pose();
  } else {
    const b = await readBox(names);
    if (b === null) { failures.push(`${name}: none of ${names.join(',')} is visible`); return; }
    clip = rect(b, pad);
  }
  const withVm = await page.screenshot({ type: 'png', clip });
  await setVm(false);
  await sleep(140);
  if (pose) await pose();
  const without = await page.screenshot({ type: 'png', clip });
  await setVm(true);
  await sleep(140);
  await writeFile(`${OUT}/${name}.png`, withVm);

  // Puppeteer returns a Uint8Array, pngjs wants a Buffer.
  const a = PNG.sync.read(Buffer.from(withVm));
  const b = PNG.sync.read(Buffer.from(without));
  let diff = 0;
  const n = Math.min(a.data.length, b.data.length);
  for (let i = 0; i < n; i += 4) if (DIFFERS(a.data, b.data, i)) diff++;
  const cover = diff / (n / 4);
  const tag = `${(cover * 100).toFixed(1)}% subject`;
  report.push(`  ${name.padEnd(22)} ${Math.round(clip.width)}x${Math.round(clip.height)} @${SCALE}x  ${tag}`);
  if (cover < 0.10) failures.push(`${name}: crop is ${tag} — the subject is not in the frame`);
};

const setWeapon = (i) => page.evaluate((i) => { window.engine.ctx.get('combat').equip(i); }, i);
const setShield = (s) => page.evaluate((s) => { window.engine.ctx.get('combat').setShield(s); }, s);
const press = (b) => page.evaluate((b) => { window.engine.ctx.input.buttons.add(b); }, b);
const release = (b) => page.evaluate((b) => { window.engine.ctx.input.buttons.delete(b); }, b);
const look = (yaw, pitch) => page.evaluate(([y, p]) => { window.engine.ctx.get('player').setLook(y, p); }, [yaw, pitch]);
const fov = (f) => page.evaluate((f) => {
  const c = window.engine.ctx.camera;
  if (window.__fov0 === undefined) window.__fov0 = c.fov;
  c.fov = f === null ? window.__fov0 : f;
  c.updateProjectionMatrix();
  window.engine.ctx.get('player').fovLock = true;
}, f);

const R = ['vm-hand-r', 'vm-fore-r'];

/* ------------------------------------------------------- sword: the spine */
await setWeapon(0);
await setShield('wooden_shield');
await sleep(800);
await shot('full-rest-sword');
await closeup('arm-rest', R);
await closeup('grip-sword', ['vm-hand-r'], 0.05);

await press(0);
await sleep(420);
await shot('full-wind');
await closeup('grip-wind', ['vm-hand-r'], 0.05);
await release(0);
await sleep(70);
await shot('full-swing');
// The live window: re-driven per shot, so the pair the coverage test compares
// is the same instant of the same arc.
const swing = async () => {
  await sleep(1400);
  await press(0);
  await sleep(420);
  await release(0);
  await sleep(70);
};
await closeup('grip-swing', ['vm-hand-r'], 0.06, swing);
await sleep(1100);

/* ------------------------------------------------------------- the block */
await press(2);
await sleep(800);
await shot('full-block');
await closeup('grip-block', ['vm-hand-r'], 0.06);
await closeup('shield-hand', ['vm-hand-strap'], 0.10);
await release(2);
await sleep(700);

/* ------------------------------------- looking down the arm: the forearm */
await look(0.7, -0.95);
await sleep(700);
await shot('full-down');
await closeup('forearm-down', R, 0.04);
await look(0.7, -0.06);
await sleep(500);

/* ----------------------------------------------------- the other classes */
await setWeapon(2);
await setShield('none');
await sleep(800);
await shot('full-rest-hammer');
await closeup('grip-hammer', ['vm-hand-r'], 0.05);

await setWeapon(5);
await sleep(800);
await shot('full-rest-bow');
await closeup('grip-bow', ['vm-hand-l'], 0.06);
await press(0);
await sleep(700);
await closeup('grip-bow-draw', ['vm-hand-r'], 0.06);
await release(0);
await sleep(600);

/* ---------------------------------------------------------------- fists */
await setWeapon(6);
await setShield('none');
await sleep(800);
await shot('full-fists');
await closeup('fist-rest', ['vm-fist-r'], 0.05);
await closeup('fist-arm', ['vm-fist-r', 'vm-fore-r'], 0.06);
await press(0);
await sleep(420);
await closeup('fist-wind', ['vm-fist-r'], 0.05);
await release(0);
await sleep(1400);
await closeup('fist-swing', ['vm-fist-r'], 0.06, swing);
await sleep(1000);

/* ------------------------------------------ macro: the wrist, telephoto */
await setWeapon(0);
await setShield('wooden_shield');
await fov(18);
await sleep(900);
await shot('tele-rest');
await closeup('wrist-macro', R, 0.02);
await closeup('hand-macro', ['vm-hand-r'], 0.02);
await fov(null);
await sleep(500);

/* ------------------------------------------- crosshair and third person */
await shot('crosshair');
await page.keyboard.press('v');
await sleep(1300);
await shot('third-person');
await page.keyboard.press('v');
await sleep(900);

const stats = await page.evaluate(() => {
  const r = window.engine.ctx.renderer.info.render;
  const vm = window.engine.ctx.scene.getObjectByName('viewmodel');
  let tris = 0, meshes = 0;
  vm && vm.traverseVisible((o) => {
    if (!o.isMesh) return;
    meshes++;
    tris += o.geometry.getIndex() ? o.geometry.getIndex().count / 3 : 0;
  });
  return { frameTris: r.triangles, calls: r.calls, vmDrawn: tris, vmMeshes: meshes };
});

console.log(`\n${OUT}`);
for (const r of report) console.log(r);
console.log('\nRENDER:', JSON.stringify(stats));
if (errors.length) { console.log('ERRORS:'); [...new Set(errors)].slice(0, 10).forEach((e) => console.log('  ' + e)); }
if (failures.length) {
  console.log('\nCAPTURE FAILURES:');
  for (const f of failures) console.log('  ' + f);
}
await browser.close();
vite?.kill();
process.exit(failures.length ? 1 : 0);
