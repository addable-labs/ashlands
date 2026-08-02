// Terrain QA channel capture. See the TQ_DBG note in TerrainMaterial.
//   node tools/_tdbg.mjs <shot> [modes]
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';

const SHOTS = {
  dawn: [6.2, 'clear'], redmtn: [10, 'cloudy'], coast: [17.6, 'clear'], night: [23.4, 'clear'],
  ashstorm: [13, 'ashstorm'], dusk: [19.8, 'clear'], vale: [12, 'clear'], storm: [15, 'rain'],
  ridge: [8.4, 'clear'],
};
const PORT = process.env.PORT || '5179';
const URL = `http://127.0.0.1:${PORT}/`;
const shot = process.argv[2] || 'vale';
const modes = (process.argv[3] || '1,2,3,4,5').split(',');
const OUT = 'shots/tdbg';

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) { vite = spawn('npx', ['vite', '--port', PORT, '--host', '127.0.0.1'], { stdio: 'ignore' }); for (let i = 0; i < 90 && !(await up()); i++) await sleep(500); }
await mkdir(OUT, { recursive: true });

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
const fr = framed.framing[shot];
const [hour, weather] = SHOTS[shot];
await p.evaluate((hour, weather, fr) => {
  const ctx = window.engine.ctx;
  ctx.clock.hour = hour;
  ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
  ctx.get('sky')?.setWeather?.(weather, 0);
  const pl = ctx.get('player');
  if (pl) pl.freefly = true;
  if (fr.absY != null) { pl?.teleport?.(fr.x, fr.z, 0); ctx.camera.position.set(fr.x, fr.absY, fr.z); }
  else pl?.teleport?.(fr.x, fr.z, fr.h);
  pl?.setLook?.(fr.yaw, fr.pitchRad != null ? fr.pitchRad : (fr.pitch * Math.PI) / 180);
}, hour, weather, fr);
await sleep(3000);

const grab = async (name) => {
  await sleep(1600);
  await writeFile(`${OUT}/${shot}-${name}.png`, await p.screenshot({ type: 'png' }));
  console.log(`${OUT}/${shot}-${name}.png`);
};
await grab('shaded');
for (const m of modes) {
  await p.evaluate((m) => window.engine.ctx.get('terrain').mats.setBudget('TQ_DBG', m), m);
  await grab(`dbg${m}`);
}
await p.evaluate(() => window.engine.ctx.get('terrain').mats.setBudget('TQ_DBG', null));
await b.close();
vite?.kill();
