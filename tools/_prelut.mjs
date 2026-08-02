#!/usr/bin/env node
/**
 * Capture the canonical shots with the grade LUT bypassed.
 *
 * These are the input to tools/_gradelab.mjs, which applies a candidate cube
 * offline and scores it with tools/palette.mjs. Iterating a grade by capturing
 * the whole set through the engine is a three-minute round trip; iterating it
 * against a frozen pre-LUT capture is a hundred milliseconds, and it is exactly
 * the same arithmetic because the LUT is the last thing in the chain that
 * touches colour (vignette aside, which is a scalar).
 */
import { launch } from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';

// Duplicated from shoot.mjs rather than imported: that module is a script with
// top-level side effects (it launches a browser on import).
const SHOTS = {
  dawn:      { hour: 6.2,  weather: 'clear' },
  redmtn:    { hour: 10.0, weather: 'cloudy' },
  coast:     { hour: 17.6, weather: 'clear' },
  night:     { hour: 23.4, weather: 'clear' },
  ashstorm:  { hour: 13.0, weather: 'ashstorm' },
  dusk:      { hour: 19.8, weather: 'clear' },
  vale:      { hour: 12.0, weather: 'clear' },
  storm:     { hour: 15.0, weather: 'rain' },
  underwater:{ hour: 12.0, weather: 'clear' },
  ridge:     { hour: 8.4,  weather: 'clear' },
};

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://127.0.0.1:5178/';
const W = 1920, H = 1080;
const OUT = 'shots/_prelut';
const REF = 'shots/_postlut';

async function serverUp() {
  try { const r = await fetch(URL, { signal: AbortSignal.timeout(800) }); return r.ok; } catch { return false; }
}
let vite = null;
if (!(await serverUp())) {
  vite = spawn('npx', ['vite', '--port', '5178', '--host', '127.0.0.1'], { cwd: process.cwd(), stdio: 'ignore' });
  for (let i = 0; i < 80 && !(await serverUp()); i++) await sleep(500);
}
await mkdir(OUT, { recursive: true });
await mkdir(REF, { recursive: true });

const browser = await launch({
  executablePath: CHROME, headless: 'new',
  args: [`--window-size=${W},${H}`, '--use-angle=metal', '--ignore-gpu-blocklist',
         '--enable-gpu-rasterization', '--hide-scrollbars', '--mute-audio'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90_000 });
await page.waitForFunction('!!window.engine', { timeout: 120_000 });
const framed = await page.evaluate(FRAMING_FN);

// Other agents are editing src concurrently and every save is a Vite HMR
// reload that destroys the execution context mid-capture. Re-await the engine
// before each step rather than losing a six-minute run to someone else's file
// write.
const ready = async () => {
  for (let i = 0; i < 3; i++) {
    try { await page.waitForFunction('!!window.engine', { timeout: 180_000 }); return; }
    catch { await sleep(1000); }
  }
};

for (const name of Object.keys(SHOTS)) {
  const fr = framed.framing[name];
  if (!fr) continue;
  const s = SHOTS[name];
  await ready();
  await page.evaluate((s, fr) => {
    const ctx = window.engine.ctx;
    ctx.clock.hour = s.hour;
    ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.(s.weather, 0);
    const p = ctx.get('player');
    if (p) p.freefly = true;
    if (fr.absY != null) { p?.teleport?.(fr.x, fr.z, 0); ctx.camera.position.set(fr.x, fr.absY, fr.z); }
    else p?.teleport?.(fr.x, fr.z, fr.h);
    p?.setLook?.(fr.yaw, fr.pitchRad != null ? fr.pitchRad : (fr.pitch * Math.PI) / 180);
    window.RENDER_DEBUG.lut = false;
  }, s, fr);
  await sleep(2600);
  await writeFile(`${OUT}/${name}.png`, await page.screenshot({ type: 'png' }));
  // ...and the same frame WITH the cube, from the identical scene state, so the
  // offline lab's fidelity can be checked against ground truth rather than
  // assumed. Two frames of settle is enough: only the last pass changed.
  await page.evaluate(() => { window.RENDER_DEBUG.lut = true; });
  await sleep(400);
  await writeFile(`${REF}/${name}.png`, await page.screenshot({ type: 'png' }));
  await page.evaluate(() => { window.RENDER_DEBUG.lut = false; });
  console.log(`${OUT}/${name}.png`);
}
await browser.close();
vite?.kill();
