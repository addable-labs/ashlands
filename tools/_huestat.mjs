#!/usr/bin/env node
/**
 * Hue distribution of the PRE-GRADE buffer.
 *
 * Same statistic the stage-2 ablation reports — mean saturation and the share of
 * chroma-bearing pixels outside hue 0-60 — but over three windows, because the
 * two that matter answer different questions: the bottom 55% is "what colour is
 * the world", the whole frame is "what colour is the picture", and the top 40%
 * is "what colour is the sky". A build whose sky is blue and whose ground is one
 * ochre is a different defect from one where everything is ochre, and a
 * ground-only statistic cannot tell them apart.
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { Buffer } from 'node:buffer';
import { PNG } from 'pngjs';
import { FRAMING_FN } from './framing.mjs';

const PORT = 5209;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = 'shots/_sky/hue';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = (process.argv[2] ?? 'ridge,vale,coast').split(',');
const WEATHER = process.argv[3] ?? 'clear';
const HOUR = Number(process.argv[4] ?? 9);
const TAG = process.argv[5] ?? 'now';

function stat(png, y0f, y1f) {
  const d = png.data;
  const { width: w, height: h } = png;
  const y0 = Math.floor(h * y0f);
  const y1 = Math.floor(h * y1f);
  let chroma = 0, warm = 0, hs = 0, hc = 0, lum = 0, sat = 0, n = 0, cool = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      const r = d[k] / 255, g = d[k + 1] / 255, b = d[k + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
      lum += 0.2126 * r + 0.7152 * g + 0.0722 * b; n++;
      sat += mx > 0 ? c / mx : 0;
      if (c > 0.06) {
        let hh;
        if (mx === r) hh = 60 * (((g - b) / c) % 6);
        else if (mx === g) hh = 60 * ((b - r) / c + 2);
        else hh = 60 * ((r - g) / c + 4);
        if (hh < 0) hh += 360;
        chroma++;
        if (hh < 60) warm++;
        if (hh >= 150 && hh < 300) cool++;
        const a = (hh * Math.PI) / 180; hs += Math.sin(a); hc += Math.cos(a);
      }
    }
  }
  let mh = Math.atan2(hs / Math.max(1, chroma), hc / Math.max(1, chroma)) * 180 / Math.PI;
  if (mh < 0) mh += 360;
  return {
    lum: +(lum / n).toFixed(4), sat: +(sat / n).toFixed(3),
    chromaFrac: +(chroma / n).toFixed(3), hue: +mh.toFixed(1),
    outside: chroma ? +(1 - warm / chroma).toFixed(3) : 0,
    coolFrac: chroma ? +(cool / chroma).toFixed(3) : 0,
  };
}

async function up() {
  try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
}
let vite = null;
if (!(await up())) {
  vite = spawn('npx', ['vite', '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'ignore' });
  for (let i = 0; i < 90 && !(await up()); i++) await sleep(500);
}
await mkdir(OUT, { recursive: true });

const browser = await launch({
  executablePath: CHROME, headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1600,900', '--mute-audio'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(2500);
const framed = await page.evaluate(FRAMING_FN);

for (const name of SHOTS) {
  const fr = framed.framing[name];
  if (!fr) continue;
  await page.evaluate(() => { window.RENDER_DEBUG.lut = false; });
  await page.evaluate((fr, hr, wk) => {
    const ctx = window.engine.ctx, p = ctx.get('player');
    ctx.clock.hour = hr; ctx.clock.scale = 0;
    ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.(wk, 0);
    if (p) p.freefly = true;
    if (fr.absY != null) { p?.teleport?.(fr.x, fr.z, 0); ctx.camera.position.set(fr.x, fr.absY, fr.z); }
    else p?.teleport?.(fr.x, fr.z, fr.h);
    p?.setLook?.(fr.yaw, fr.pitchRad ?? 0);
  }, fr, HOUR, WEATHER);
  await sleep(3200);
  const png = PNG.sync.read(Buffer.from(await page.screenshot({ type: 'png' })));
  await writeFile(`${OUT}/${name}-${WEATHER}-${HOUR}-${TAG}.png`, PNG.sync.write(png));
  const g = stat(png, 0.45, 1.0);
  const f = stat(png, 0.0, 1.0);
  const s = stat(png, 0.0, 0.40);
  const row = (t, m) => `  ${t.padEnd(7)} lum ${m.lum.toFixed(3)}  sat ${m.sat}  chroma ${(m.chromaFrac * 100).toFixed(0)}%` +
    `  hue ${m.hue}  outside0-60 ${(m.outside * 100).toFixed(1)}%  cool150-300 ${(m.coolFrac * 100).toFixed(1)}%`;
  console.log(`\n=== ${name}  ${WEATHER}  ${HOUR}:00  (pre-grade) ===`);
  console.log(row('ground', g));
  console.log(row('frame', f));
  console.log(row('sky', s));
}

await browser.close();
vite?.kill();
process.exit(0);
