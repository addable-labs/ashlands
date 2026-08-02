#!/usr/bin/env node
/**
 * Records a representative play session to mp4.
 *
 * Chrome's screencast is used rather than an OS screen recorder: it works
 * headless, needs no screen-recording permission, and captures the canvas
 * exactly. It does cost frame time — every captured frame stalls the render
 * loop — so the recording runs slightly choppier than real play. True
 * framerate is measured separately by tools/shoot.mjs with no capture running.
 */
import { launch } from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const URL = 'http://127.0.0.1:5178/';
const W = 1280, H = 720;

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) {
  vite = spawn('npx', ['vite', '--port', '5178', '--host', '127.0.0.1'], { stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
}
await mkdir('shots/video', { recursive: true });
await rm('shots/video/play.webm', { force: true });

const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, '--mute-audio', '--hide-scrollbars'],
  defaultViewport: { width: W, height: H },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(2000);

// Put the player somewhere worth filming: low ground with the mountain in view.
await page.evaluate(() => {
  const ctx = window.engine.ctx, t = ctx.get('terrain'), p = ctx.get('player');
  let peak = { x: 0, z: 0, h: -1e9 };
  for (let x = -1900; x <= 1900; x += 100)
    for (let z = -1900; z <= 1900; z += 100) { const h = t.heightAt(x, z); if (h > peak.h) peak = { x, z, h }; }
  let spot = null, bs = -1e9;
  for (let x = -1900; x <= 1900; x += 100)
    for (let z = -1900; z <= 1900; z += 100) {
      const h = t.heightAt(x, z); if (h < 5 || h > 260) continue;
      const d = Math.hypot(x - peak.x, z - peak.z); if (d < 700 || d > 1500) continue;
      const n = t.normalAt(x, z); const s = n.y * 3 - Math.abs(d - 1050) / 800;
      if (s > bs) { bs = s; spot = { x, z }; }
    }
  spot = spot ?? { x: 0, z: 0 };
  ctx.clock.hour = 8.6; ctx.clock.scale = 60;
  ctx.get('sky')?.setWeather?.('clear', 0);
  p.freefly = false;
  p.teleport(spot.x, spot.z, 0.2);
  p.setLook(Math.atan2(peak.x - spot.x, peak.z - spot.z) + Math.PI, -0.03);
  ctx.input.pointerLocked = true;
  window.__peak = peak;
});
await sleep(2500);

const rec = await page.screencast({ path: 'shots/video/play.webm', fps: 30 });
console.log('recording…');

const look = async (dx, ms) => {
  const steps = Math.max(1, Math.round(ms / 50));
  for (let i = 0; i < steps; i++) {
    await page.evaluate((d) => {
      const ctx = window.engine.ctx; ctx.input.pointerLocked = true;
      const p = ctx.get('player');
      p.setLook((p.yaw ?? 0) + d, p.pitch ?? -0.03);
    }, dx / steps).catch(() => {});
    await sleep(50);
  }
};

// 1. Stand and look around the vista.
await sleep(1800);
await page.evaluate(() => { const p = window.engine.ctx.get('player');
  window.__yaw = p.yaw ?? 0; window.__pitch = p.pitch ?? -0.03; });
for (let i = 0; i < 60; i++) {
  await page.evaluate((i) => { const ctx = window.engine.ctx; ctx.input.pointerLocked = true;
    const p = ctx.get('player'); p.setLook(window.__yaw + Math.sin(i / 19) * 0.55, window.__pitch + Math.sin(i / 31) * 0.06); }, i);
  await sleep(55);
}

// 2. Walk forward, then run.
await page.keyboard.down('w'); await sleep(2600);
await page.keyboard.down('Shift'); await sleep(2600); await page.keyboard.up('Shift');
await sleep(600); await page.keyboard.up('w');
await sleep(700);

// 3. Jump.
await page.keyboard.press('Space'); await sleep(1600);

// 4. Ready a weapon and swing a few times.
await page.evaluate(() => { const ctx = window.engine.ctx; ctx.input.pointerLocked = true; ctx.get('combat')?.equip?.(0); });
await sleep(700);
for (let i = 0; i < 4; i++) {
  await page.evaluate(() => { window.engine.ctx.input.pointerLocked = true; });
  await page.mouse.down(); await sleep(430); await page.mouse.up(); await sleep(760);
}

// 5. Cast a spell.
await page.evaluate(() => window.engine.ctx.get('rpg')?.cast?.());
await sleep(1800);

// 6. Open the menus a player would.
for (const [key, hold] of [['i', 2600], ['j', 2200], ['m', 2400]]) {
  await page.keyboard.press(key); await sleep(hold);
  await page.keyboard.press('Escape'); await sleep(900);
}

// 7. Third-person, to show the character and its shadow.
await page.keyboard.press('v'); await sleep(700);
await page.keyboard.down('w'); await sleep(2600); await page.keyboard.up('w');
await sleep(900);
await page.keyboard.press('v'); await sleep(700);

// 8. Fly up for the landscape reveal.
await page.evaluate(() => {
  const ctx = window.engine.ctx, p = ctx.get('player');
  p.freefly = true;
  const pk = window.__peak;
  p.teleport(pk.x + 900, pk.z + 900, 260);
  p.setLook(Math.atan2(pk.x - (pk.x + 900), pk.z - (pk.z + 900)) + Math.PI, -0.12);
});
await sleep(2600);
for (let i = 0; i < 70; i++) {
  await page.evaluate(() => { const ctx = window.engine.ctx, p = ctx.get('player');
    p.setLook((p.yaw ?? 0) + 0.006, p.pitch ?? -0.12); });
  await sleep(55);
}

// 9. Time-lapse into dusk and night, so the sky and moons read.
await page.evaluate(() => { window.engine.ctx.clock.scale = 2600; });
await sleep(9000);
await page.evaluate(() => { window.engine.ctx.clock.scale = 60; });
await sleep(2000);

await rec.stop();
console.log('encoding…');
execFileSync('ffmpeg', ['-y', '-i', 'shots/video/play.webm',
  '-vf', 'scale=1280:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart',
  'shots/video/ashlands.mp4'], { stdio: 'ignore' });
console.log('wrote shots/video/ashlands.mp4');
await browser.close();
vite?.kill();
