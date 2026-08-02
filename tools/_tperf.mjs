// Interleaved A/B frame time for one terrain budget override, on one vantage.
//   node tools/_tperf.mjs <shot> "KEY=VAL[,KEY=VAL]"
// The second argument is the state to compare AGAINST (usually the pre-change
// knobs); A is that state, B is the shipping shader. Absolute ms on this machine
// is meaningless — other agents build on it — so only the paired delta is quoted.
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';
const SHOTS = { dawn: [6.2, 'clear'], redmtn: [10, 'cloudy'], vale: [12, 'clear'], ridge: [8.4, 'clear'], coast: [17.6, 'clear'] };
const PORT = process.env.PORT || '5179';
const URL = `http://127.0.0.1:${PORT}/`;
const shot = process.argv[2] || 'vale';
const pairs = (process.argv[3] || '').split(',').map((s) => s.split('='));
async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) { vite = spawn('npx', ['vite', '--port', PORT, '--host', '127.0.0.1'], { stdio: 'ignore' }); for (let i = 0; i < 90 && !(await up()); i++) await sleep(500); }
const b = await launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1920,1080', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } });
const p = await b.newPage();
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.waitForFunction('!!window.engine', { timeout: 240000 });
const framed = await p.evaluate(FRAMING_FN);
const fr = framed.framing[shot];
const [hour, weather] = SHOTS[shot];
await p.evaluate((hour, weather, fr) => {
  const ctx = window.engine.ctx;
  ctx.clock.hour = hour; ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
  ctx.get('sky')?.setWeather?.(weather, 0);
  const pl = ctx.get('player'); if (pl) pl.freefly = true;
  pl?.teleport?.(fr.x, fr.z, fr.h);
  pl?.setLook?.(fr.yaw, fr.pitchRad != null ? fr.pitchRad : (fr.pitch * Math.PI) / 180);
}, hour, weather, fr);
await sleep(3000);
const meas = async () => {
  const runs = [];
  for (let k = 0; k < 5; k++) runs.push(await p.evaluate(async () => {
    let n = 0; const t0 = performance.now();
    await new Promise((r) => { const l = () => { if (++n < 120) requestAnimationFrame(l); else r(); }; requestAnimationFrame(l); });
    return (performance.now() - t0) / n;
  }));
  runs.sort((a, c) => a - c); return runs[2];
};
const set = (kv) => p.evaluate((kv) => { const t = window.engine.ctx.get('terrain'); for (const [k, v] of kv) t.mats.setBudget(k, v); }, kv);
const deltas = [];
for (let i = 0; i < 5; i++) {
  await set(pairs); await sleep(1200); const a = await meas();
  await set(pairs.map(([k]) => [k, null])); await sleep(1200); const bb = await meas();
  deltas.push(bb - a);
  console.log(`  pair ${i}: A(override) ${a.toFixed(2)} ms   B(shipping) ${bb.toFixed(2)} ms   delta ${(bb - a).toFixed(2)} ms`);
}
deltas.sort((x, y) => x - y);
console.log(`${shot}: median delta over 5 paired samples: ${deltas[2].toFixed(2)} ms/frame`);
await b.close(); vite?.kill();
