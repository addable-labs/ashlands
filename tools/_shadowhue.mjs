#!/usr/bin/env node
/**
 * Hue per luminance decile, on the PRE-GRADE buffer.
 *
 * The stage-2 acceptance test for "shadows are lit by the sky, not by a second
 * copy of the sun": the circular-mean hue of the DARKEST pixels must differ from
 * the hue of the sunlit ground by a wide margin. A frame where the two agree has
 * one illuminant in it however many lights are in the scene, and no colour cube
 * downstream can manufacture the separation.
 *
 * Deciles are of DISPLAY luma over the ground half of the frame (the sky is not
 * a shaded surface and would otherwise own the bright end). The report also
 * calls out the two windows the brief names: everything below display luma
 * 0.075 (deep shadow) and the top decile (sunlit ash).
 *
 *   node tools/_shadowhue.mjs [shots] [hour] [tag]
 *
 * Writes shots/_shadow/<tag>/<shot>.png (pre-grade) so the same frames can be
 * re-scored offline, and prints the table.
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { Buffer } from 'node:buffer';
import { FRAMING_FN } from './framing.mjs';

const PORT = 5209;
const URL = `http://127.0.0.1:${PORT}/`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1600, H = 900;
const SHOTS = (process.argv[2] ?? 'dawn,vale,ridge,coast').split(',');
const HOUR = Number(process.argv[3] ?? 9.0);
const TAG = process.argv[4] ?? 'now';
/** `coverage=0,cirrus=0` — mutates the live weather preset before capture. */
const POKE = (process.argv[5] ?? '').split(',').filter(Boolean)
  .map((kv) => kv.split('=')).map(([k, v]) => [k, Number(v)]);
/** `volumetrics=0,bloom=0` — RENDER_DEBUG kill switches, applied before capture. */
const DBG = (process.argv[6] ?? '').split(',').filter(Boolean)
  .map((kv) => kv.split('=')).map(([k, v]) => [k, v !== '0']);
const OUT = `shots/_shadow/${TAG}`;

export function deciles(png, y0f = 0.42) {
  const d = png.data;
  const w = png.width, h = png.height;
  const y0 = Math.floor(h * y0f);
  const px = [];
  for (let y = y0; y < h; y++) {
    for (let x = 0; x < w; x += 2) {
      const k = (y * w + x) * 4;
      const r = d[k] / 255, g = d[k + 1] / 255, b = d[k + 2] / 255;
      px.push([0.2126 * r + 0.7152 * g + 0.0722 * b, r, g, b]);
    }
  }
  px.sort((a, b) => a[0] - b[0]);
  const stat = (arr) => {
    let hs = 0, hc = 0, n = 0, sat = 0, lum = 0;
    for (const [l, r, g, b] of arr) {
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
      lum += l;
      sat += mx > 0 ? c / mx : 0;
      if (c > 1e-4) {
        let hh;
        if (mx === r) hh = 60 * (((g - b) / c) % 6);
        else if (mx === g) hh = 60 * ((b - r) / c + 2);
        else hh = 60 * ((r - g) / c + 4);
        if (hh < 0) hh += 360;
        const a = (hh * Math.PI) / 180;
        // Chroma-weighted so a near-neutral pixel cannot vote as loudly as a
        // saturated one; an unweighted circular mean over near-grey pixels is
        // dominated by quantisation noise.
        hs += Math.sin(a) * c; hc += Math.cos(a) * c; n += c;
      }
    }
    let mh = Math.atan2(hs / Math.max(n, 1e-9), hc / Math.max(n, 1e-9)) * 180 / Math.PI;
    if (mh < 0) mh += 360;
    return {
      n: arr.length,
      lum: +(lum / Math.max(arr.length, 1)).toFixed(4),
      sat: +(sat / Math.max(arr.length, 1)).toFixed(3),
      hue: +mh.toFixed(1),
    };
  };
  const out = [];
  for (let i = 0; i < 10; i++) {
    out.push(stat(px.slice(Math.floor((i * px.length) / 10), Math.floor(((i + 1) * px.length) / 10))));
  }
  const dark = stat(px.filter((p) => p[0] < 0.075));
  const lit = out[9];
  let sep = Math.abs(dark.hue - lit.hue);
  if (sep > 180) sep = 360 - sep;
  return { deciles: out, dark, lit, sep: +sep.toFixed(1) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
  let vite = null;
  if (!(await up())) {
    vite = spawn('npx', ['vite', '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'ignore' });
    for (let i = 0; i < 120 && !(await up()); i++) await sleep(500);
  }
  await mkdir(OUT, { recursive: true });
  const browser = await launch({
    executablePath: CHROME, headless: 'new', protocolTimeout: 600_000,
    args: [`--window-size=${W},${H}`, '--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'],
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.engine', { timeout: 240_000 });
  await sleep(2500);
  const framed = await page.evaluate(FRAMING_FN);

  for (const name of SHOTS) {
    const fr = framed.framing[name];
    if (!fr) { console.log(`${name}: no framing`); continue; }
    await page.evaluate((fr, hr, poke, dbg) => {
      const ctx = window.engine.ctx, p = ctx.get('player');
      ctx.clock.hour = hr; ctx.clock.scale = 0;
      ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
      ctx.get('sky')?.setWeather?.('clear', 0);
      if (p) p.freefly = true;
      if (fr.absY != null) { p?.teleport?.(fr.x, fr.z, 0); ctx.camera.position.set(fr.x, fr.absY, fr.z); }
      else p?.teleport?.(fr.x, fr.z, fr.h);
      p?.setLook?.(fr.yaw, fr.pitchRad ?? 0);
      window.RENDER_DEBUG.lut = false;
      const sky = ctx.get('sky');
      for (const [k, v] of poke) { sky.machine.to[k] = v; sky.machine.from[k] = v; }
      for (const [k, v] of dbg) window.RENDER_DEBUG[k] = v;
    }, fr, HOUR, POKE, DBG);
    await sleep(3000);
    const buf = await page.screenshot({ type: 'png' });
    await writeFile(`${OUT}/${name}.png`, buf);
    const png = PNG.sync.read(Buffer.from(buf));
    const r = deciles(png);
    console.log(`\n=== ${name} @${HOUR} (pre-grade) ===`);
    console.log('  decile   lum     sat    hue');
    r.deciles.forEach((d, i) => console.log(`   d${i}     ${String(d.lum).padEnd(7)} ${String(d.sat).padEnd(6)} ${d.hue}`));
    console.log(`  BELOW luma 0.075: n=${r.dark.n} lum ${r.dark.lum} sat ${r.dark.sat} hue ${r.dark.hue}`);
    console.log(`  TOP decile (sunlit): lum ${r.lit.lum} sat ${r.lit.sat} hue ${r.lit.hue}`);
    console.log(`  SEPARATION: ${r.sep} deg`);
  }
  await page.evaluate(() => { window.RENDER_DEBUG.lut = true; });
  await browser.close();
  vite?.kill();
  process.exit(0);
}
