#!/usr/bin/env node
/**
 * EXPOSURE DIAGNOSTIC. One browser, five canonical vantages, hour 9.
 *
 * For each shot it records
 *   - the metered exposure and the value curve's two anchors (readExposure)
 *   - the frame's own 32x18 log-luminance tile map in SCENE radiance
 *     (readMeterGrid) — the thing a metering argument is actually about
 *   - the encoded frame's p1/p50/p99 and the sky-region chroma
 *
 * Writes shots/_exp/<tag>/{shot}.png and shots/_exp/<tag>/grid.json, so a
 * candidate weighting can be evaluated offline over real frames instead of
 * being guessed at and then shipped.
 *
 *   node tools/_expgrid.mjs before
 *   node tools/_expgrid.mjs after '{"exposureKey":0.11}'
 */
import { launch } from 'puppeteer-core';
import { spawn, execSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { Buffer } from 'node:buffer';
import { FRAMING_FN } from './framing.mjs';

const PORT = 5203;
const URL = `http://127.0.0.1:${PORT}/`;
const TAG = process.argv[2] ?? 'before';
const OVERRIDE = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const OUT = `shots/_exp/${TAG}`;
const SHOTS = ['dawn', 'redmtn', 'vale', 'ridge', 'coast'];

execSync('npx vite build --outDir dist-probe --emptyOutDir', { stdio: 'ignore' });
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-probe', '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'ignore' });
const up = async () => { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } };
for (let i = 0; i < 90 && !(await up()); i++) await sleep(500);
if (!(await up())) { console.error('preview server failed'); process.exit(2); }
await mkdir(OUT, { recursive: true });

const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1600,900', '--mute-audio'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(2500);
if (Object.keys(OVERRIDE).length) {
  await page.evaluate((o) => { Object.assign(window.RENDER_PIPELINE, o); }, OVERRIDE);
}
const framed = await page.evaluate(FRAMING_FN);

const out = { tag: TAG, override: OVERRIDE, shots: {} };

for (const name of SHOTS) {
  const fr = framed.framing[name];
  if (!fr) continue;
  await page.evaluate((fr) => {
    const ctx = window.engine.ctx, p = ctx.get('player');
    ctx.clock.hour = 9.0; ctx.clock.scale = 0;
    ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.('clear', 0);
    if (p) p.freefly = true;
    if (fr.absY != null) { p?.teleport?.(fr.x, fr.z, 0); ctx.camera.position.set(fr.x, fr.absY, fr.z); }
    else p?.teleport?.(fr.x, fr.z, fr.h);
    p?.setLook?.(fr.yaw, fr.pitchRad ?? 0);
  }, fr);
  await sleep(2600);

  const probe = await page.evaluate(() => {
    const r = window.RENDER_PIPELINE;
    const e = r.readExposure();
    const g = r.readMeterGrid();
    return { exposure: e.exposure, avgL: e.avgLuminance, gain: e.gain, black: e.black,
             gw: g.w, gh: g.h, logL: Array.from(g.logL) };
  });

  const png = PNG.sync.read(Buffer.from(await page.screenshot({ type: 'png' })));
  await writeFile(`${OUT}/${name}.png`, PNG.sync.write(png));

  const { width: w, height: h, data: d } = png;
  const lums = [];
  let shoulder = 0, npx = 0, clipped = 0;
  for (let k = 0; k < d.length; k += 16) {
    const L = 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
    lums.push(L);
    if (L > 0.90 * 255) shoulder++;
    if (d[k] >= 253 && d[k + 1] >= 253 && d[k + 2] >= 253) clipped++;
    npx++;
  }
  lums.sort((a, b) => a - b);
  const q = (f) => Math.round(lums[Math.min(lums.length - 1, Math.floor(f * lums.length))]);

  // Sky region: top 35% of frame, chroma and hue of patch means.
  const sky = [];
  for (let y = 0; y < Math.floor(h * 0.35); y += 16) {
    for (let x = 0; x < w; x += 40) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 30 && x + dx < w; dx++) {
        const k = ((y + dy) * w + x + dx) * 4;
        r += d[k]; g += d[k + 1]; b += d[k + 2]; n++;
      }
      r /= n; g /= n; b /= n;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sky.push({ c: mx - mn, l: 0.2126 * r + 0.7152 * g + 0.0722 * b });
    }
  }
  const chroma = sky.map((s) => s.c).sort((a, b) => a - b);
  const cq = (f) => +chroma[Math.floor(f * (chroma.length - 1))].toFixed(1);

  out.shots[name] = { ...probe, p1: q(0.01), p50: q(0.5), p99: q(0.99),
    stops: +(Math.log2(Math.max(1, q(0.99)) / Math.max(1, q(0.01)))).toFixed(2),
    shoulderPct: +(100 * shoulder / npx).toFixed(1), clipPct: +(100 * clipped / npx).toFixed(2),
    skyChromaP10: cq(0.1), skyChromaMed: cq(0.5), skyChromaP90: cq(0.9) };

  const s = out.shots[name];
  console.log(`${name.padEnd(8)} ev=${s.exposure.toFixed(3)} avgL=${s.avgL.toFixed(4)} gain=${s.gain.toFixed(3)} black=${s.black.toFixed(3)}` +
    ` | p1=${s.p1} p50=${s.p50} p99=${s.p99} (${s.stops}st) >0.9=${s.shoulderPct}% clip=${s.clipPct}%` +
    ` | skyC ${s.skyChromaP10}/${s.skyChromaMed}/${s.skyChromaP90}`);
}

out.pageErrors = errs;
await writeFile(`${OUT}/grid.json`, JSON.stringify(out));
console.log(`\n-> ${OUT}/grid.json${errs.length ? `  PAGE ERRORS: ${errs[0].slice(0, 120)}` : ''}`);
await browser.close();
server.kill();
