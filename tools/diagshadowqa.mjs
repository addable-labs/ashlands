#!/usr/bin/env node
/**
 * Shadow QA sweep.
 *
 * For each vantage and each hour, captures the frame twice back-to-back in the
 * same page — once normally, once with every cascade's shadow intensity forced
 * to zero — and writes the difference. That difference IS the shadow term with
 * everything else (terrain shading, flora, fog, grade, exposure) cancelled out,
 * which is the only way to tell a cascade-boundary artifact apart from a
 * landform whose silhouette happens to be straight.
 *
 * It then reports the longest runs of perfectly axis-aligned step edges found in
 * that difference. A cascade box wall is a plane in light space; on a mostly
 * flat receiver it prints as a long straight edge. Real shadow silhouettes
 * essentially never produce runs of more than a few dozen pixels.
 *
 *   node tools/diagshadowqa.mjs --tag qa --shots ridge,dawn --hours 6.2,10,14
 */
import { launch } from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { FRAMING_FN } from './framing.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const TAG = flag('tag', 'shadowqa');
const SHOTS = flag('shots', 'ridge,dawn,redmtn,vale,dusk').split(',');
const HOURS = flag('hours', '').split(',').filter(Boolean).map(Number);
const KEEP = argv.includes('--keep');
const URL = 'http://127.0.0.1:5178/';

const DEFAULT_HOUR = { dawn: 6.2, redmtn: 10.0, dusk: 19.8, vale: 12.0, ridge: 8.4, coast: 17.6 };
const WEATHER = { redmtn: 'cloudy' };
/**
 * Extra hand-placed vantages. `ridge` and friends all sit close to the ground,
 * so nothing in them is far enough away to reach the outermost cascade's wall —
 * which is precisely where the coverage edge lives. These look down a long
 * run of open ground so a shadow-distance artifact has somewhere to print.
 */
const EXTRA = {
  high: { x: -160, z: -1120, h: 220, yaw: 0.95, pitch: -22, fov: 60, hour: 8.4 },
  highnoon: { x: -160, z: -1120, h: 220, yaw: 0.95, pitch: -22, fov: 60, hour: 12 },
  flatlow: { x: 160, z: 160, h: 60, yaw: 0.227, pitch: -8, fov: 70, hour: 7.4 },
};

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) {
  vite = spawn('npx', ['vite', '--port', '5178', '--host', '127.0.0.1'], { stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
}
const out = `shots/${TAG}`;
await mkdir(out, { recursive: true });
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  protocolTimeout: 300_000,
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
// A shader that fails to compile does not throw — three logs it and the frame
// quietly loses whatever that program was drawing. Surfacing it is the only
// thing that separates "the fix worked" from "the shader never ran".
page.on('console', (m) => {
  const t = m.text();
  if (/THREE|shader|GLSL|WebGL/i.test(t)) console.log('CONSOLE', t.slice(0, 400));
});
const QUERIES = flag('queries', '').split(',').filter(Boolean);
const RUNS = QUERIES.length ? QUERIES : [''];
let framed = null;

const setup = async (fr, hour, weather, shadows) => {
  // Another agent saving a file triggers a Vite reload that tears the engine
  // down mid-sweep. Re-await it rather than crashing the run.
  await page.waitForFunction('!!window.engine', { timeout: 180_000 });
  return page.evaluate((fr, hour, weather, shadows) => {
  const ctx = window.engine.ctx;
  ctx.clock.hour = hour;
  ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
  ctx.get('sky')?.setWeather?.(weather, 0);
  const p = ctx.get('player');
  if (p) p.freefly = true;
  p?.teleport?.(fr.x, fr.z, fr.h);
  p?.setLook?.(fr.yaw, (fr.pitch * Math.PI) / 180);
  const csm = ctx.get('sky')?.csm;
  if (csm) for (const l of csm.lights) l.shadow.intensity = shadows ? 1 : 0;
  }, fr, hour, weather, shadows);
};

/** Longest runs of axis-aligned step edges, on a smoothed luminance field. */
function straightEdges(png, thresh) {
  const W = png.width, H = png.height;
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    lum[i] = 0.2126 * png.data[o] + 0.7152 * png.data[o + 1] + 0.0722 * png.data[o + 2];
  }
  const tmp = new Float32Array(W * H), sm = new Float32Array(W * H);
  const R = 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let k = -R; k <= R; k++) { const xx = x + k; if (xx < 0 || xx >= W) continue; s += lum[y * W + xx]; n++; }
    tmp[y * W + x] = s / n;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let k = -R; k <= R; k++) { const yy = y + k; if (yy < 0 || yy >= H) continue; s += tmp[yy * W + x]; n++; }
    sm[y * W + x] = s / n;
  }
  const step = (a, b, f1, f2) => { const d = Math.abs(a - b); return d > thresh && d > 2.2 * Math.max(f1, f2); };
  const cols = [], rows = [];
  for (let x = 9; x < W - 9; x++) {
    let run = 0, best = 0, at = 0;
    for (let y = 0; y < H; y++) {
      const i = y * W + x;
      if (step(sm[i + 3], sm[i - 3], Math.abs(sm[i - 3] - sm[i - 9]), Math.abs(sm[i + 3] - sm[i + 9]))) {
        run++; if (run > best) { best = run; at = y; }
      } else run = 0;
    }
    if (best > 40) cols.push([x, best, at - best + 1]);
  }
  for (let y = 9; y < H - 9; y++) {
    let run = 0, best = 0, at = 0;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (step(sm[i + 3 * W], sm[i - 3 * W], Math.abs(sm[i - 3 * W] - sm[i - 9 * W]), Math.abs(sm[i + 3 * W] - sm[i + 9 * W]))) {
        run++; if (run > best) { best = run; at = x; }
      } else run = 0;
    }
    if (best > 40) rows.push([y, best, at - best + 1]);
  }
  cols.sort((a, b) => b[1] - a[1]); rows.sort((a, b) => b[1] - a[1]);
  return { cols: cols.slice(0, 4), rows: rows.slice(0, 4) };
}

const report = [];
for (const query of RUNS) {
const suffix = query ? `-${query.replace(/[^a-z]/gi, '')}` : '';
await page.goto(URL + query, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
framed = await page.evaluate(FRAMING_FN);
for (const name of SHOTS) {
  const fr = framed.framing[name] ?? EXTRA[name];
  if (!fr) { console.warn('no vantage', name); continue; }
  const hours = HOURS.length ? HOURS : [fr.hour ?? DEFAULT_HOUR[name] ?? 12];
  for (const hour of hours) {
    const w = WEATHER[name] ?? 'clear';
    await setup(fr, hour, w, true);
    await sleep(2600);
    const litBuf = await page.screenshot({ type: 'png' });
    await setup(fr, hour, w, false);
    await sleep(1600);
    const flatBuf = await page.screenshot({ type: 'png' });

    const A = PNG.sync.read(Buffer.from(litBuf)), B = PNG.sync.read(Buffer.from(flatBuf));
    const d = new PNG({ width: A.width, height: A.height });
    for (let i = 0; i < A.data.length; i += 4) {
      for (let k = 0; k < 3; k++) d.data[i + k] = Math.min(255, Math.abs(A.data[i + k] - B.data[i + k]) * 4);
      d.data[i + 3] = 255;
    }
    const key = `${name}-h${hour}${suffix}`;
    if (KEEP) await writeFile(`${out}/${key}-lit.png`, litBuf);
    await writeFile(`${out}/${key}-shadow.png`, PNG.sync.write(d));
    const e = straightEdges(d, 10);
    const worst = Math.max(e.cols[0]?.[1] ?? 0, e.rows[0]?.[1] ?? 0);
    report.push({ key, worst, cols: e.cols, rows: e.rows });
    console.log(`${key}  worstStraightRun=${worst}px  cols=${JSON.stringify(e.cols)} rows=${JSON.stringify(e.rows)}`);
  }
}
}
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 1));
await browser.close();
vite?.kill();
