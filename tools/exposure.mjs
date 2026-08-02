#!/usr/bin/env node
/**
 * Exposure stability probe.
 *
 * The architecture agent observed that two frames captured minutes apart in the
 * same session, with no code change, differed from warm ochre to near-monochrome
 * grey. If exposure drifts then every screenshot this project has graded was
 * taken at an effectively random exposure — which makes both the grade work and
 * the critics' colour verdicts unfalsifiable.
 *
 * This holds the camera, clock and weather absolutely fixed and samples the
 * renderer's exposure plus the frame's actual luminance over time.
 */
import { launch } from 'puppeteer-core';
import { spawn, execSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';
import { PNG } from 'pngjs';
import { Buffer } from 'node:buffer';

const PORT = 5199;
const URL = `http://127.0.0.1:${PORT}/`;
const SHOT = process.argv[2] ?? 'dawn';
const SAMPLES = 24;
const EVERY_MS = 2500;

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
execSync('npx vite build --outDir dist-bench --emptyOutDir', { stdio: 'ignore' });
const vite = spawn('npx', ['vite', 'preview', '--outDir', 'dist-bench', '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'ignore' });
for (let i = 0; i < 90 && !(await up()); i++) await sleep(500);
await mkdir('shots/exposure', { recursive: true });

const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1280,720', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(2500);

const framed = await page.evaluate(FRAMING_FN);
const fr = framed.framing[SHOT];

// Freeze everything that could legitimately change the image.
await page.evaluate((fr) => {
  const ctx = window.engine.ctx, p = ctx.get('player');
  ctx.clock.hour = 8.5;
  ctx.clock.scale = 0;               // stop time entirely
  ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
  ctx.get('sky')?.setWeather?.('clear', 0);
  if (p) p.freefly = true;
  p?.teleport?.(fr.x, fr.z, fr.h);
  p?.setLook?.(fr.yaw, fr.pitchRad ?? 0);
}, fr);
await sleep(3000);

const probe = async () => {
  const state = await page.evaluate(() => {
    const ctx = window.engine.ctx, r = ctx.get('render');
    const exp = r?.exposure ?? r?.readExposure?.() ?? r?.cfg?.exposure
      ?? ctx.renderer.toneMappingExposure ?? null;
    return { exposure: typeof exp === 'number' ? +exp.toFixed(4) : exp,
             hour: +ctx.clock.hour.toFixed(3), camY: +ctx.camera.position.y.toFixed(2),
             frame: ctx.time.frame };
  });
  // Measure the encoded frame: readPixels on the default framebuffer comes back
  // empty once the frame has been composited.
  const png = PNG.sync.read(Buffer.from(await page.screenshot({ type: 'png' })));
  const d = png.data;
  let lum = 0, r_ = 0, g_ = 0, b_ = 0, n = 0;
  for (let k = 0; k < d.length; k += 16) {       // stride: every 4th pixel is plenty
    r_ += d[k]; g_ += d[k + 1]; b_ += d[k + 2];
    lum += 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
    n++;
  }
  const mr = r_ / n, mg = g_ / n, mb = b_ / n;
  const mx = Math.max(mr, mg, mb), mn = Math.min(mr, mg, mb);
  return { ...state, lum: +(lum / n).toFixed(2), r: +mr.toFixed(1), g: +mg.toFixed(1),
           b: +mb.toFixed(1), sat: +(mx > 0 ? (mx - mn) / mx : 0).toFixed(4) };
};

console.log(`shot=${SHOT}  camera and clock frozen  ${SAMPLES} samples @ ${EVERY_MS}ms\n`);
console.log('  t(s)   exposure     lum      R     G     B    sat');
const rows = [];
for (let i = 0; i < SAMPLES; i++) {
  const p = await probe();
  rows.push({ t: (i * EVERY_MS) / 1000, ...p });
  console.log(`  ${String((i * EVERY_MS) / 1000).padStart(5)}  ${String(p.exposure).padStart(9)}  ${String(p.lum).padStart(6)}  ${String(p.r).padStart(5)} ${String(p.g).padStart(5)} ${String(p.b).padStart(5)}  ${p.sat}`);
  if (i === 0 || i === SAMPLES - 1 || i === (SAMPLES >> 1)) {
    await writeFile(`shots/exposure/${SHOT}-t${(i * EVERY_MS) / 1000}.png`, await page.screenshot({ type: 'png' }));
  }
  await sleep(EVERY_MS);
}

const lums = rows.map((r) => r.lum);
const exps = rows.map((r) => r.exposure).filter((v) => typeof v === 'number');
const spread = (a) => (a.length ? +(Math.max(...a) - Math.min(...a)).toFixed(3) : null);
const rel = (a) => (a.length && Math.min(...a) > 0 ? +((Math.max(...a) / Math.min(...a) - 1) * 100).toFixed(1) : null);
console.log(`\n  luminance:  min ${Math.min(...lums)}  max ${Math.max(...lums)}  spread ${spread(lums)} (${rel(lums)}%)`);
if (exps.length) console.log(`  exposure:   min ${Math.min(...exps)}  max ${Math.max(...exps)}  spread ${spread(exps)} (${rel(exps)}%)`);
else console.log('  exposure:   not exposed by the render system — could not read it directly');
const stable = rel(lums) !== null && rel(lums) < 2;
console.log(`\n  VERDICT: ${stable ? 'STABLE' : 'DRIFTING'} — a frozen scene must not change at all.`);
await writeFile('shots/exposure/exposure.json', JSON.stringify({ shot: SHOT, rows }, null, 2));
await browser.close();
vite?.kill();
