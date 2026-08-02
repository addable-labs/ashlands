// Terrain fragment-cost breakdown.
//
// The machine is shared with other capture harnesses, so absolute frame time
// drifts by tens of ms over a run. Every number below is therefore a *paired*
// difference: the reference config and the test config are measured back to
// back inside one pair, and the median of the per-pair deltas is reported.
// Drift slower than a single pair cancels exactly.
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';
const PORT = process.env.PORT || '5178';
const URL = `http://127.0.0.1:${PORT}/`;
async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) { vite = spawn('npx', ['vite', '--port', PORT, '--host', '127.0.0.1'], { stdio: 'ignore' }); for (let i = 0; i < 60 && !(await up()); i++) await sleep(500); }
const W = 1920, H = 1080;
const b = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: [`--window-size=${W},${H}`, '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.waitForFunction('!!window.engine', { timeout: 180000 });
const framed = await p.evaluate(FRAMING_FN);
const SHOTS = { dawn: [6.2, 'clear'], redmtn: [10, 'cloudy'], vale: [12, 'clear'], ridge: [8.4, 'clear'] };

const REF = ['vis', [0, 0, 0, 0]];
const CFG = [
  ['hidden   ', 'hide', [0, 0, 0, 0]],
  ['no-splat ', 'vis', [1, 0, 0, 0]],
  ['no-pom   ', 'vis', [0, 1, 0, 0]],
  ['no-meso  ', 'vis', [0, 0, 1, 0]],
  ['no-detile', 'vis', [0, 0, 0, 1]],
  ['no-macro ', 'vis', [0, 0, 0, 2]],
];
const REPS = +(process.env.REPS || 7);
const FRAMES = +(process.env.FRAMES || 40);

const msFn = async () => p.evaluate(async (nf) => {
  let n = 0; const t0 = performance.now();
  await new Promise((r) => { const l = () => { if (++n < nf) requestAnimationFrame(l); else r(); }; requestAnimationFrame(l); });
  return (performance.now() - t0) / n;
}, FRAMES);
const apply = (mode, d) => p.evaluate((mode, d) => {
  const ctx = window.engine.ctx;
  ctx.scene.traverse((o) => { if (o.name === 'terrain') o.visible = mode === 'vis'; });
  const t = ctx.get('terrain');
  if (t && t.uniforms && t.uniforms.uDbg) t.uniforms.uDbg.value.set(d[0], d[1], d[2], d[3]);
}, mode, d);
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

for (const name of Object.keys(SHOTS)) {
  const fr = framed.framing[name]; if (!fr) continue;
  const [hour, w] = SHOTS[name];
  await p.evaluate((fr, hour, w) => {
    const ctx = window.engine.ctx; ctx.clock.hour = hour; ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.(w, 0);
    const pl = ctx.get('player'); if (pl) pl.freefly = true;
    pl?.teleport?.(fr.x, fr.z, fr.h); pl?.setLook?.(fr.yaw, (fr.pitch * Math.PI) / 180);
  }, fr, hour, w);
  await sleep(2500);
  const refAll = [];
  const out = [];
  for (const [label, mode, d] of CFG) {
    const deltas = [];
    for (let k = 0; k < REPS; k++) {
      await apply(...REF); await sleep(120); const a = await msFn();
      await apply(mode, d); await sleep(120); const c = await msFn();
      await apply(...REF); await sleep(120); const a2 = await msFn();
      deltas.push((a + a2) * 0.5 - c);
      refAll.push(a, a2);
    }
    out.push(`${label}=${med(deltas).toFixed(2)}`);
  }
  await apply(...REF);
  console.log(`${name}: ref=${med(refAll).toFixed(2)}ms  saved-by: ${out.join('  ')}`);
}
await b.close(); vite?.kill();
