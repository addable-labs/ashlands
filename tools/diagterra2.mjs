// Terrain isolation profiler.
//
// Measures the terrain's contribution to the frame by toggling mesh visibility
// (which removes it from the shadow, prepass and shaded passes alike), at two
// viewport scales. The ratio between the two separates per-pixel fragment cost
// from per-vertex / per-triangle cost: a fragment-bound subsystem quarters when
// the pixel count quarters, a vertex-bound one does not move.
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';
const PORT = process.env.PORT || '5178';
const URL = `http://127.0.0.1:${PORT}/`;
async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) { vite = spawn('npx', ['vite', '--port', PORT, '--host', '127.0.0.1'], { stdio: 'ignore' }); for (let i = 0; i < 60 && !(await up()); i++) await sleep(500); }

const argv = process.argv.slice(2);
const HALF = argv.includes('--half');
const W = HALF ? 960 : 1920, H = HALF ? 540 : 1080;

const b = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: [`--window-size=${W},${H}`, '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForFunction('!!window.engine', { timeout: 180000 });
const framed = await p.evaluate(FRAMING_FN);
const SHOTS = { dawn: [6.2, 'clear'], redmtn: [10, 'cloudy'], vale: [12, 'clear'], ridge: [8.4, 'clear'] };

// Frame time in ms, unrounded, from a 90-frame rAF burst.
const msFn = async () => p.evaluate(async () => {
  let n = 0; const t0 = performance.now();
  await new Promise((r) => { const l = () => { if (++n < 90) requestAnimationFrame(l); else r(); }; requestAnimationFrame(l); });
  return (performance.now() - t0) / n;
});

const setVis = (v) => p.evaluate((v) => { window.engine.ctx.scene.traverse((o) => { if (o.name === 'terrain') o.visible = v; }); }, v);
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

const out = [];
for (const name of Object.keys(SHOTS)) {
  const fr = framed.framing[name]; if (!fr) continue;
  const [hour, w] = SHOTS[name];
  await p.evaluate((fr, hour, w) => {
    const ctx = window.engine.ctx; ctx.clock.hour = hour; ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.(w, 0);
    const pl = ctx.get('player'); if (pl) pl.freefly = true;
    pl?.teleport?.(fr.x, fr.z, fr.h); pl?.setLook?.(fr.yaw, (fr.pitch * Math.PI) / 180);
  }, fr, hour, w);
  await sleep(2600);
  const ons = [], offs = [];
  for (let k = 0; k < 5; k++) {
    await setVis(true); await sleep(350); ons.push(await msFn());
    await setVis(false); await sleep(350); offs.push(await msFn());
  }
  await setVis(true);
  const on = med(ons), off = med(offs);
  out.push({ name, on, off, terr: on - off });
  console.log(`${name.padEnd(8)} ${W}x${H}  frame ${on.toFixed(2)}ms   no-terrain ${off.toFixed(2)}ms   TERRAIN ${(on - off).toFixed(2)}ms`);
}
console.log(`TOTAL terrain ms @${W}x${H}: ${out.reduce((a, r) => a + r.terr, 0).toFixed(2)}`);
await b.close(); vite?.kill();
