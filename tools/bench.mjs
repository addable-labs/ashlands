#!/usr/bin/env node
/**
 * Clean framerate benchmark.
 *
 * Every fps number this project has produced so far was taken while other
 * agents were driving their own Chrome and Vite instances — load average hit
 * 37 on 8 cores. This waits for the machine to actually be idle, then measures
 * each vantage point at each quality tier, so "can we hit 60" gets a real
 * answer and we learn what the tiers actually buy.
 *
 *   node tools/bench.mjs              # wait for quiet, then bench
 *   node tools/bench.mjs --now        # skip the wait
 *   node tools/bench.mjs --tiers high # subset of tiers
 */
import { launch } from 'puppeteer-core';
import { spawn, execSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';

// A production build served statically, NOT the dev server: an agent saving a
// file triggers a Vite hot-reload that destroys the page mid-measurement, which
// killed the first attempt at this benchmark. This also measures the build we
// would actually ship.
const PORT = 5199;
const URL = `http://127.0.0.1:${PORT}/`;
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const TIERS = flag('tiers', 'low,medium,high,ultra').split(',');
const SHOTS = flag('shots', 'dawn,redmtn,vale,ridge,coast').split(',');
const W = +flag('w', 1920), H = +flag('h', 1080);

const load1 = () => Number(execSync("uptime | sed 's/.*averages: //' | awk '{print $1}'").toString().trim());
// Must exclude this process: `pgrep -f "node tools/"` matches bench.mjs itself,
// so the idle check could never be satisfied and just burned the timeout.
const busy = () => {
  try {
    // Match only the capture scripts by basename. Matching "node tools/" also
    // caught this process and any monitoring shell whose command line mentions
    // it, so the gate could never open.
    const out = execSync('pgrep -fl "tools/(shoot|e2e|playtest|record|viewmodel)\\.mjs" || true').toString();
    return out.split('\n').some((l) => l.trim().length > 0);
  } catch { return false; }
};

if (!argv.includes('--now')) {
  process.stdout.write('waiting for an idle machine');
  for (let i = 0; i < 240; i++) {
    if (load1() < 5.0 && !busy()) break;
    process.stdout.write('.');
    await sleep(15_000);
  }
  console.log(`\nload now ${load1()}`);
}

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
console.log('building a static snapshot...');
execSync('npx vite build --outDir dist-bench --emptyOutDir', { stdio: 'ignore' });
const vite = spawn('npx', ['vite', 'preview', '--outDir', 'dist-bench', '--port', String(PORT), '--host', '127.0.0.1'],
  { stdio: 'ignore' });
for (let i = 0; i < 90 && !(await up()); i++) await sleep(500);
if (!(await up())) { console.error('preview server did not start'); process.exit(1); }
await mkdir('shots/bench', { recursive: true });

const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, '--mute-audio', '--hide-scrollbars'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(2500);

const framed = await page.evaluate(FRAMING_FN);
const gpu = await page.evaluate(() => {
  const gl = window.engine.ctx.renderer.getContext();
  const d = gl.getExtension('WEBGL_debug_renderer_info');
  return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log(`GPU: ${gpu}   ${W}x${H}\n`);

/** Median of per-frame deltas over a window — robust to a single stalled frame. */
const measure = () => page.evaluate(async () => {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const dts = [];
  let last = performance.now();
  await new Promise((res) => {
    const loop = () => {
      const now = performance.now();
      dts.push(now - last); last = now;
      if (dts.length < 120) requestAnimationFrame(loop); else res();
    };
    requestAnimationFrame(loop);
  });
  dts.sort((a, b) => a - b);
  const med = dts[dts.length >> 1];
  const p95 = dts[Math.floor(dts.length * 0.95)];
  return { fps: 1000 / med, ms: med, p95ms: p95 };
});

const rows = [];
for (const tier of TIERS) {
  const okTier = await page.evaluate((t) => {
    const r = window.engine.ctx.get('render');
    if (!r?.setQuality) return false;
    r.setQuality(t); return true;
  }, tier);
  if (!okTier) { console.log(`  (setQuality unavailable — skipping tiers)`); break; }
  await sleep(1800);
  for (const name of SHOTS) {
    const fr = framed.framing[name];
    if (!fr) continue;
    await page.evaluate((fr) => {
      const ctx = window.engine.ctx, p = ctx.get('player');
      ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
      if (p) p.freefly = true;
      if (fr.absY != null) { p?.teleport?.(fr.x, fr.z, 0); ctx.camera.position.set(fr.x, fr.absY, fr.z); }
      else p?.teleport?.(fr.x, fr.z, fr.h);
      p?.setLook?.(fr.yaw, fr.pitchRad ?? 0);
    }, fr);
    await sleep(2200);
    const m = await measure();
    rows.push({ tier, shot: name, fps: +m.fps.toFixed(1), ms: +m.ms.toFixed(2), p95: +m.p95ms.toFixed(2) });
    console.log(`  ${tier.padEnd(7)} ${name.padEnd(8)} ${m.fps.toFixed(1).padStart(5)} fps   ${m.ms.toFixed(1)} ms   p95 ${m.p95ms.toFixed(1)} ms`);
  }
  const t = rows.filter((r) => r.tier === tier);
  console.log(`  ${tier.padEnd(7)} ${'MEAN'.padEnd(8)} ${(t.reduce((a, b) => a + b.fps, 0) / t.length).toFixed(1).padStart(5)} fps\n`);
}

await writeFile('shots/bench/bench.json', JSON.stringify({ gpu, w: W, h: H, load: load1(), rows }, null, 2));
console.log('=== summary (mean fps by tier) ===');
for (const tier of [...new Set(rows.map((r) => r.tier))]) {
  const t = rows.filter((r) => r.tier === tier);
  const mean = t.reduce((a, b) => a + b.fps, 0) / t.length;
  const worst = Math.min(...t.map((r) => r.fps));
  console.log(`  ${tier.padEnd(7)} mean ${mean.toFixed(1).padStart(5)}   worst ${worst.toFixed(1).padStart(5)}   ${mean >= 60 ? 'MEETS 60' : `${(60 - mean).toFixed(1)} short`}`);
}
await browser.close();
vite?.kill();
