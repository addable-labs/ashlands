#!/usr/bin/env node
/**
 * Which term is painting the frame hue 22?
 *
 * Ablates one illumination path at a time on the PRE-GRADE buffer and reports
 * the hue of the chroma-bearing pixels, over the GROUND ONLY (pixels whose
 * linear depth says they are geometry, not dome). Auto-exposure is pinned so a
 * term that is removed shows up as a change in the image rather than being
 * silently compensated for.
 *
 * The important case is `albedo`: white key, no ambient, no aerial. Whatever hue
 * that frame carries is the material's own, and no illuminant split can move a
 * pixel out of a hue band its albedo already sits deep inside.
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
const OUT = 'shots/_sky/ablate';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = (process.argv[2] ?? 'ridge,vale').split(',');
const CASES = (process.argv[3] ?? 'base,albedo,ibl-only,sun-only,white-env').split(',');

function stat(png, half) {
  const d = png.data;
  const { width: w, height: h } = png;
  // Bottom 55% of the frame only: on every one of these vantages that is
  // geometry, and mixing dome pixels into a statistic about surface shading is
  // how a sky the size of half the frame decides the answer.
  const y0 = half ? Math.floor(h * 0.45) : 0;
  let chroma = 0, warm = 0, hs = 0, hc = 0, lum = 0, sat = 0, n = 0;
  for (let y = y0; y < h; y++) {
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
        chroma++; if (hh < 60) warm++;
        const a = (hh * Math.PI) / 180; hs += Math.sin(a); hc += Math.cos(a);
      }
    }
  }
  let mh = Math.atan2(hs / Math.max(1, chroma), hc / Math.max(1, chroma)) * 180 / Math.PI;
  if (mh < 0) mh += 360;
  return {
    meanLum: +(lum / n).toFixed(4), meanSat: +(sat / n).toFixed(3),
    chromaFrac: +(chroma / n).toFixed(3), meanHue: +mh.toFixed(1),
    outsideWarm: chroma ? +(1 - warm / chroma).toFixed(3) : 0,
  };
}

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
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

/** Install/remove ablations by pinning the properties the sky rewrites each frame. */
const APPLY = (kind) => {
  const ctx = window.engine.ctx;
  const sky = ctx.get('sky');
  const A = sky.constructor === undefined ? null : null;
  const U = window.__AERIAL ?? (window.__AERIAL = (() => {
    // aerialUniforms() is a module singleton; reach it through any consumer.
    const m = sky.skyMat.uniforms;
    return m;
  })());
  const pin = (obj, key, v) =>
    Object.defineProperty(obj, key, { get: () => v, set: () => {}, configurable: true });

  const noSun = () => ctx.scene.traverse((o) => { if (o.isDirectionalLight) pin(o, 'intensity', 0); });
  const whiteSun = () => ctx.scene.traverse((o) => {
    if (o.isDirectionalLight) { const c = o.color; c.setRGB(1, 1, 1); pin(o, 'color', c); }
  });
  const noEnv = () => pin(ctx.scene, 'environment', null);
  window.RENDER_DEBUG.autoExposure = false;
  if (kind === 'albedo') { whiteSun(); noEnv(); }
  if (kind === 'ibl-only') { noSun(); }
  if (kind === 'sun-only') { noEnv(); }
  if (kind === 'white-env') {
    // Neutral IBL at the sky's own magnitude, key light removed: whatever hue
    // survives is the albedo's, because nothing coloured is left in the frame.
    const THREE = window.RENDER_THREE;
    noSun();
    const t = new THREE.DataTexture(new Float32Array([1, 1, 1, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    t.colorSpace = THREE.NoColorSpace; t.mapping = THREE.EquirectangularReflectionMapping; t.needsUpdate = true;
    pin(ctx.scene, 'environment', t);
  }
  return typeof A === 'object' || true;
};

for (const name of SHOTS) {
  const fr = framed.framing[name];
  if (!fr) continue;
  console.log(`\n=== ${name} (ground only, bottom 55%) ===`);
  for (const c of CASES) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction('!!window.engine', { timeout: 180_000 });
    await sleep(2500);
    await page.evaluate(() => {
      window.RENDER_DEBUG.lut = false;
      // The aerial block is a module singleton; grab it off a material that
      // already includes it rather than importing the module.
      const ctx = window.engine.ctx;
      let found = null;
      ctx.scene.traverse((o) => {
        const m = o.material;
        if (!m || found) return;
        const arr = Array.isArray(m) ? m : [m];
        for (const mm of arr) {
          const u = mm.userData && mm.userData.aerial;
          if (u) { found = u; return; }
        }
      });
      window.__AU = found;
    });
    await page.evaluate((fr, hr) => {
      const ctx = window.engine.ctx, p = ctx.get('player');
      ctx.clock.hour = hr; ctx.clock.scale = 0;
      ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
      ctx.get('sky')?.setWeather?.('clear', 0);
      if (p) p.freefly = true;
      if (fr.absY != null) { p?.teleport?.(fr.x, fr.z, 0); ctx.camera.position.set(fr.x, fr.absY, fr.z); }
      else p?.teleport?.(fr.x, fr.z, fr.h);
      p?.setLook?.(fr.yaw, fr.pitchRad ?? 0);
    }, fr, 9.0);
    await sleep(2600);
    const ok = await page.evaluate(APPLY, c);
    await sleep(1600);
    const png = PNG.sync.read(Buffer.from(await page.screenshot({ type: 'png' })));
    await writeFile(`${OUT}/${name}-${c}.png`, PNG.sync.write(png));
    const s = stat(png, true);
    console.log(`  ${c.padEnd(10)} lum ${s.meanLum.toFixed(3)}  sat ${s.meanSat}  chroma ${(s.chromaFrac * 100).toFixed(0)}%  ` +
      `meanHue ${s.meanHue}  outside0-60 ${(s.outsideWarm * 100).toFixed(1)}%  ${ok ? '' : '(APPLY FAILED)'}`);
  }
}

await browser.close();
vite?.kill();
process.exit(0);
