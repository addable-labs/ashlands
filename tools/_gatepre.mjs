#!/usr/bin/env node
/**
 * Gate-identical pre-grade / post-grade capture pair.
 *
 * `tools/_prelut.mjs` captures the ten-shot set at its own hours; the gate uses
 * five vantage points at hour 9.0, clear, 1600x900. Grading decisions get judged
 * against the gate's numbers, so the frozen input the offline lab iterates on has
 * to be the gate's framing, not the shoot set's. This writes both halves of the
 * pair from one browser session and one scene state:
 *
 *   shots/_gatepre/<shot>.png    RENDER_DEBUG.lut = false
 *   shots/_gatepost/<shot>.png   RENDER_DEBUG.lut = true
 *
 * Feed the first to tools/_gradelab.mjs (--src) and score with tools/palette.mjs.
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';

const PORT = 5211;
const URL = `http://127.0.0.1:${PORT}/`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1600, H = 900;
const SHOTS = ['dawn', 'redmtn', 'vale', 'ridge', 'coast'];
const HOUR = 9.0;
const PRE = 'shots/_gatepre';
const POST = 'shots/_gatepost';

async function serverUp() {
  try { const r = await fetch(URL, { signal: AbortSignal.timeout(800) }); return r.ok; } catch { return false; }
}
let vite = null;
if (!(await serverUp())) {
  vite = spawn('npx', ['vite', '--port', String(PORT), '--host', '127.0.0.1'],
    { cwd: process.cwd(), stdio: 'ignore' });
  for (let i = 0; i < 80 && !(await serverUp()); i++) await sleep(500);
}
await mkdir(PRE, { recursive: true });
await mkdir(POST, { recursive: true });

const browser = await launch({
  executablePath: CHROME, headless: 'new',
  args: [`--window-size=${W},${H}`, '--use-angle=metal', '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization', '--hide-scrollbars', '--mute-audio'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(2500);
const framed = await page.evaluate(FRAMING_FN);

for (const name of SHOTS) {
  const fr = framed.framing[name];
  if (!fr) { console.log(`${name}: no framing`); continue; }
  await page.evaluate((fr, hr) => {
    const ctx = window.engine.ctx, p = ctx.get('player');
    ctx.clock.hour = hr; ctx.clock.scale = 0;
    ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.('clear', 0);
    if (p) p.freefly = true;
    if (fr.absY != null) { p?.teleport?.(fr.x, fr.z, 0); ctx.camera.position.set(fr.x, fr.absY, fr.z); }
    else p?.teleport?.(fr.x, fr.z, fr.h);
    p?.setLook?.(fr.yaw, fr.pitchRad ?? 0);
    window.RENDER_DEBUG.lut = true;
  }, fr, HOUR);
  await sleep(2600);
  await writeFile(`${POST}/${name}.png`, await page.screenshot({ type: 'png' }));
  await page.evaluate(() => { window.RENDER_DEBUG.lut = false; });
  await sleep(500);
  await writeFile(`${PRE}/${name}.png`, await page.screenshot({ type: 'png' }));
  await page.evaluate(() => { window.RENDER_DEBUG.lut = true; });
  console.log(`${name}: pre+post written`);
}
await browser.close();
vite?.kill();
