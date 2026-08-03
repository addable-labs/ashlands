#!/usr/bin/env node
/**
 * Stage-2 fill attribution: paired ablations of the IDENTICAL frame.
 *
 * One browser session, one scene state per vantage, N captures. Each variant
 * flips exactly one thing and everything else is bit-identical, so the
 * difference in whole-frame relative saturation is that thing's share.
 *
 *   base      as shipped
 *   nolut     RENDER_DEBUG.lut = false          (the colour cube's share)
 *   noblack   RENDER_DEBUG.blackPoint = false   (the per-frame value curve's share)
 *   monognd   uGroundAlbedo -> its own luma     (the IBL ground-bounce's chroma)
 *   nobloom   RENDER_DEBUG.bloom = false
 *
 *   node tools/_fill.mjs [shot,shot,...] [variant,variant,...]
 *
 * Writes shots/_fill/<variant>/<shot>.png.
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { Buffer } from 'node:buffer';
import { FRAMING_FN } from './framing.mjs';

const CFG = {
  dawn: { hour: 6.2, weather: 'clear' }, redmtn: { hour: 10.0, weather: 'cloudy' },
  coast: { hour: 17.6, weather: 'clear' }, night: { hour: 23.4, weather: 'clear' },
  ashstorm: { hour: 13.0, weather: 'ashstorm' }, dusk: { hour: 19.8, weather: 'clear' },
  vale: { hour: 12.0, weather: 'clear' }, storm: { hour: 15.0, weather: 'rain' },
  underwater: { hour: 12.0, weather: 'clear' }, ridge: { hour: 8.4, weather: 'clear' },
};
const PORT = 5212;
const URL = `http://127.0.0.1:${PORT}/`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const shots = (process.argv[2] ?? 'ridge,vale,coast').split(',');
const variants = (process.argv[3] ?? 'base,nolut,noblack,monognd').split(',');
const W = 1600, H = 900;

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) {
  vite = spawn('npx', ['vite', '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'ignore' });
  for (let i = 0; i < 90 && !(await up()); i++) await sleep(500);
}
const browser = await launch({
  executablePath: CHROME, headless: 'new',
  args: [`--window-size=${W},${H}`, '--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(2500);
const framed = await page.evaluate(FRAMING_FN);

const APPLY = (v) => {
  const D = window.RENDER_DEBUG;
  const sky = window.engine.ctx.get('sky');
  const u = sky.skyMat.uniforms;
  D.lut = v !== 'nolut';
  D.blackPoint = v !== 'noblack';
  D.bloom = v !== 'nobloom';
  const g = u.uGroundAlbedo.value;
  if (v === 'monognd') {
    const L = 0.2126 * 0.16 + 0.7152 * 0.135 + 0.0722 * 0.11;
    g.setRGB(L, L, L, window.RENDER_THREE.LinearSRGBColorSpace);
  } else {
    g.setRGB(0.16, 0.135, 0.11, window.RENDER_THREE.LinearSRGBColorSpace);
  }
  sky.envSunDir.set(NaN, NaN, NaN);   // force an IBL re-bake
};

for (const v of variants) await mkdir(`shots/_fill/${v}`, { recursive: true });

for (const name of shots) {
  const fr = framed.framing[name];
  const s = CFG[name];
  if (!fr || !s) continue;
  await page.evaluate((s, fr) => {
    const ctx = window.engine.ctx, p = ctx.get('player');
    ctx.clock.hour = s.hour; ctx.clock.scale = 0;
    ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.(s.weather, 0);
    if (p) p.freefly = true;
    if (fr.absY != null) { p?.teleport?.(fr.x, fr.z, 0); ctx.camera.position.set(fr.x, fr.absY, fr.z); }
    else p?.teleport?.(fr.x, fr.z, fr.pitchRad != null ? fr.h : fr.h);
    p?.setLook?.(fr.yaw, fr.pitchRad != null ? fr.pitchRad : (fr.pitch * Math.PI) / 180);
  }, s, fr);
  await sleep(4000);
  for (const v of variants) {
    await page.evaluate(APPLY, v);
    await sleep(2600);
    const buf = await page.screenshot({ type: 'png' });
    await writeFile(`shots/_fill/${v}/${name}.png`, Buffer.from(buf));
    console.log(`shots/_fill/${v}/${name}.png`);
  }
}
await page.evaluate(APPLY, 'base');
await browser.close();
vite?.kill();
process.exit(0);
