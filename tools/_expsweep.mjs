#!/usr/bin/env node
/**
 * Exposure/tonemap sweep. ONE browser, one build, N parameter sets.
 *
 * Every knob it touches is a plain field on the pipeline, so a candidate can be
 * measured before it is written into a shader constant. Reports, per shot, the
 * metered exposure, the encoded frame's percentiles, and the sky-region chroma
 * split by hue family — which is the statistic the gate's palette check is
 * really made of.
 *
 *   node tools/_expsweep.mjs 'base={} half={"exposure":0.5}'
 */
import { launch } from 'puppeteer-core';
import { spawn, execSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { Buffer } from 'node:buffer';
import { FRAMING_FN } from './framing.mjs';

const PORT = 5204;
const URL = `http://127.0.0.1:${PORT}/`;
const CASES = (process.argv[2] ?? 'base={}').split(' ').filter(Boolean).map((s) => {
  const i = s.indexOf('=');
  return { name: s.slice(0, i), over: JSON.parse(s.slice(i + 1)) };
});
const SHOTS = (process.argv[3] ?? 'coast,ridge,dawn,redmtn,vale').split(',');
const OUT = 'shots/_exp/sweep';

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
const framed = await page.evaluate(FRAMING_FN);
const DEFAULTS = await page.evaluate(() => {
  const r = window.RENDER_PIPELINE, o = {};
  for (const k of Object.keys(r)) if (typeof r[k] === 'number') o[k] = r[k];
  return o;
});

/** Palette statistic, matching tools/gate.mjs exactly. */
function palette(png) {
  const d = png.data;
  const bins = new Float64Array(12);
  let sat = 0, n = 0, chromaN = 0;
  const lums = [];
  for (let k = 0; k < d.length; k += 16) {
    const r = d[k] / 255, g = d[k + 1] / 255, b = d[k + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
    lums.push(0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]);
    sat += mx > 0 ? c / mx : 0; n++;
    if (c > 0.06) {
      let hd;
      if (mx === r) hd = 60 * (((g - b) / c) % 6);
      else if (mx === g) hd = 60 * ((b - r) / c + 2);
      else hd = 60 * ((r - g) / c + 4);
      if (hd < 0) hd += 360;
      bins[Math.floor(hd / 30) % 12] += 1; chromaN++;
    }
  }
  lums.sort((a, b) => a - b);
  const q = (f) => Math.round(lums[Math.min(lums.length - 1, Math.floor(f * lums.length))]);
  let top2 = 0;
  for (let i = 0; i < 12; i++) top2 = Math.max(top2, bins[i] + bins[(i + 1) % 12]);
  const tot = bins.reduce((a, b) => a + b, 0) || 1;
  return { hueConc: chromaN ? +(top2 / chromaN).toFixed(3) : 1,
    families: bins.filter((b) => b / tot >= 0.05).length,
    bins: Array.from(bins, (b) => +(100 * b / tot).toFixed(1)),
    meanSat: +(sat / n).toFixed(3), p1: q(0.01), p50: q(0.5), p99: q(0.99),
    stops: +Math.log2(Math.max(1, q(0.99)) / Math.max(1, q(0.01))).toFixed(2) };
}

/** Sky band (top 35%): chroma percentiles and how much of it is non-warm. */
function skyStat(png) {
  const { width: w, height: h, data: d } = png;
  const ch = [], hues = [];
  for (let y = 0; y < Math.floor(h * 0.35); y += 12) {
    for (let x = 0; x + 30 < w; x += 36) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 30; dx++) {
        const k = ((y + dy) * w + x + dx) * 4; r += d[k]; g += d[k + 1]; b += d[k + 2]; n++;
      }
      r /= n; g /= n; b /= n;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
      ch.push(c);
      if (c > 6) {
        let hd;
        if (mx === r) hd = 60 * (((g - b) / c) % 6);
        else if (mx === g) hd = 60 * ((b - r) / c + 2);
        else hd = 60 * ((r - g) / c + 4);
        if (hd < 0) hd += 360;
        hues.push(hd);
      }
    }
  }
  ch.sort((a, b) => a - b);
  const cq = (f) => +ch[Math.floor(f * (ch.length - 1))].toFixed(1);
  const cool = hues.filter((x) => x > 120 && x < 300).length;
  return { c10: cq(0.1), c50: cq(0.5), c90: cq(0.9),
    coolPct: hues.length ? +(100 * cool / hues.length).toFixed(1) : 0 };
}

const DBG = await page.evaluate(() => ({ ...window.RENDER_DEBUG }));
let maxClip = 0;
for (const cs of CASES) {
  await page.evaluate((d, o, dbg) => {
    const num = {}, flags = {};
    for (const [k, v] of Object.entries(o)) (k.startsWith('dbg:') ? flags : num)[k.replace('dbg:', '')] = v;
    Object.assign(window.RENDER_PIPELINE, d, num);
    Object.assign(window.RENDER_DEBUG, dbg, flags);
  }, DEFAULTS, cs.over, DBG);
  console.log(`\n--- ${cs.name}  ${JSON.stringify(cs.over)}`);
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
    const e = await page.evaluate(() => window.RENDER_PIPELINE.readExposure());
    const png = PNG.sync.read(Buffer.from(await page.screenshot({ type: 'png' })));
    await writeFile(`${OUT}/${cs.name}-${name}.png`, PNG.sync.write(png));
    const p = palette(png), s = skyStat(png);
    // Clipped-to-white: any 8x8 block whose every channel is >= 252.
    let clip = 0, blocks = 0;
    for (let y = 0; y + 8 < png.height; y += 8) for (let x = 0; x + 8 < png.width; x += 8) {
      let all = true;
      for (let dy = 0; dy < 8 && all; dy++) for (let dx = 0; dx < 8 && all; dx++) {
        const k = ((y + dy) * png.width + x + dx) * 4;
        if (png.data[k] < 252 || png.data[k + 1] < 252 || png.data[k + 2] < 252) all = false;
      }
      if (all) clip++; blocks++;
    }
    maxClip = Math.max(maxClip, clip);
    console.log(`  ${name.padEnd(7)} ev=${e.exposure.toFixed(3)} g=${e.gain.toFixed(2)} b=${e.black.toFixed(3)}` +
      ` | p1=${String(p.p1).padStart(3)} p50=${String(p.p50).padStart(3)} p99=${String(p.p99).padStart(3)} ${String(p.stops).padStart(4)}st` +
      ` | hueConc=${p.hueConc} fam=${p.families} sat=${p.meanSat}` +
      ` | skyC ${String(s.c10).padStart(4)}/${String(s.c50).padStart(4)}/${String(s.c90).padStart(4)} cool=${s.coolPct}%` +
      ` | whiteBlocks=${clip}` +
      `\n            hue bins %: ${p.bins.map((b, i) => (b >= 1 ? `${i * 30}:${b}` : null)).filter(Boolean).join(' ')}`);
  }
}
console.log(errs.length ? `\nPAGE ERRORS: ${errs[0].slice(0, 200)}` : '');
await browser.close();
server.kill();
