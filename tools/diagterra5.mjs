// Terrain draw-order probe.
//
// The terrain is one draw with renderOrder -10, i.e. it is the first opaque
// thing in the frame, so every terrain pixel that flora, rock or architecture
// later covers has already been shaded. Moving it to the *end* of the opaque
// list (still ahead of every transparent, which three renders as a separate
// list) lets the depth already in the buffer reject those fragments before the
// splat runs. Whether that is worth anything depends entirely on how much of
// the ground the scene covers, which is a measurement, not an argument.
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
await p.waitForFunction('!!window.engine', { timeout: 240000 });
const framed = await p.evaluate(FRAMING_FN);
const SHOTS = { dawn: [6.2, 'clear'], redmtn: [10, 'cloudy'], vale: [12, 'clear'], ridge: [8.4, 'clear'] };
const REPS = +(process.env.REPS || 5);
const FRAMES = +(process.env.FRAMES || 35);

const ms = async () => p.evaluate(async (nf) => {
  let n = 0; const t0 = performance.now();
  await new Promise((r) => { const l = () => { if (++n < nf) requestAnimationFrame(l); else r(); }; requestAnimationFrame(l); });
  return (performance.now() - t0) / n;
}, FRAMES);
const setRO = (v) => p.evaluate((v) => {
  window.engine.ctx.scene.traverse((o) => { if (o.name === 'terrain') o.renderOrder = v; });
}, v);
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
  const d = [];
  const base = [];
  for (let k = 0; k < REPS; k++) {
    await setRO(-10); await sleep(150); const a = await ms();
    await setRO(10); await sleep(150); const c = await ms();
    await setRO(-10); await sleep(150); const a2 = await ms();
    base.push(a, a2);
    d.push((a + a2) * 0.5 - c);
  }
  await setRO(-10);
  console.log(`${name.padEnd(7)} frame ${med(base).toFixed(2)}ms   terrain-last saves ${med(d).toFixed(2)}ms`);
}
await b.close(); vite?.kill();
