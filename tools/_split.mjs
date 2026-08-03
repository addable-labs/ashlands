#!/usr/bin/env node
/**
 * Key / fill / air split of a canonical frame.
 *
 * Everything is applied AFTER the sky system's own per-frame step, from an
 * instance-level override of `update`, so the terms it recomputes every frame
 * cannot put them back. Nothing here touches `visible` on any light — see the
 * note on GLOW_LIGHTS in src/flora/Flora.ts; "off" is intensity 0, and the
 * environment is turned off with `environmentIntensity`, which is a uniform and
 * does not change a single program cache key.
 *
 *   base      as shipped
 *   nosun     key light at zero          -> what the FILL alone renders
 *   nofill    environmentIntensity 0     -> what the KEY alone renders
 *   noair     aerial scattering at zero  -> the air's share
 *
 *   node tools/_split.mjs [shot,shot,...] [variant,...]
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
const PORT = 5213;
const URL = `http://127.0.0.1:${PORT}/`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const shots = (process.argv[2] ?? 'ridge,vale,coast').split(',');
const variants = (process.argv[3] ?? 'base,nosun,nofill,noair').split(',');
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

// Install the override once. `mode` is read from a global so switching costs
// nothing and cannot desynchronise from the frame that gets captured.
await page.evaluate(() => {
  const sky = window.engine.ctx.get('sky');
  window.__mode = 'base';
  const orig = sky.update.bind(sky);
  sky.update = (ctx) => {
    orig(ctx);
    const m = window.__mode;
    const noSun = m === 'nosun' || m === 'dark' || m === 'void';
    const noFill = m === 'nofill' || m === 'dark' || m === 'void';
    const noAir = m === 'noair' || m === 'void';
    ctx.scene.environmentIntensity = noFill ? 0 : 1;
    if (noSun) sky.sun.intensity = 0;
    if (noAir) {
      const u = window.__aerial;
      u.uAerialBetaR.value.set(0, 0, 0);
      u.uAerialBetaMS.value.set(0, 0, 0);
      u.uAerialBetaME.value.set(0, 0, 0);
      u.uAerialBetaA.value.set(0, 0, 0);
      u.uAerialHazeDensity.value = 0;
    }
  };
});
// The aerial uniform block is module-level; grab it through the terrain's own
// material, which shares the identical objects.
await page.evaluate(async () => {
  const mod = await import('/src/sky/Aerial.ts');
  window.__aerial = mod.aerialUniforms();
});
const framed = await page.evaluate(FRAMING_FN);
for (const v of variants) await mkdir(`shots/_split/${v}`, { recursive: true });

for (const name of shots) {
  const fr = framed.framing[name];
  const s = CFG[name];
  if (!fr || !s) continue;
  const seat = (v) => page.evaluate((s, fr, v) => {
    window.__mode = v;
    const ctx = window.engine.ctx, p = ctx.get('player');
    ctx.clock.hour = s.hour; ctx.clock.scale = 0;
    ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.(s.weather, 0);
    if (p) p.freefly = true;
    if (fr.absY != null) { p?.teleport?.(fr.x, fr.z, 0); ctx.camera.position.set(fr.x, fr.absY, fr.z); }
    else p?.teleport?.(fr.x, fr.z, fr.h);
    p?.setLook?.(fr.yaw, fr.pitchRad != null ? fr.pitchRad : (fr.pitch * Math.PI) / 180);
  }, s, fr, v);

  // Let the meter settle on the SHIPPED frame, then freeze it. Every ablation
  // below removes light; with the meter live it opens up to compensate and a
  // frame re-exposed by two stops is not the same measurement. That is exactly
  // what made the first run of this script report that killing the key light
  // changed nothing — it changed two stops of exposure and no pixel ratios.
  await page.evaluate(() => { window.RENDER_DEBUG.autoExposure = true; });
  await seat('base');
  await sleep(5000);
  await page.evaluate(() => { window.RENDER_DEBUG.autoExposure = false; });
  await sleep(1500);
  for (const v of variants) {
    // Re-seat for every variant: `noair` zeroes uniforms the sky rewrites only
    // on its own schedule, so the state is re-established rather than assumed.
    await seat(v);
    await sleep(3500);
    const buf = await page.screenshot({ type: 'png' });
    await writeFile(`shots/_split/${v}/${name}.png`, Buffer.from(buf));
    console.log(`shots/_split/${v}/${name}.png`);
  }
  await page.evaluate(() => { window.RENDER_DEBUG.autoExposure = true; });
}
await browser.close();
vite?.kill();
process.exit(0);
