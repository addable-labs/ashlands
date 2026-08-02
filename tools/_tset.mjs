// Capture one vantage under a list of terrain budget overrides.
//   node tools/_tset.mjs <shot> "name:KEY=VAL[,KEY=VAL]" ["name2:..."]
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
const shot = process.argv[2];
const variants = process.argv.slice(3);
const OUT = 'shots/tset';
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
  pl?.teleport?.(fr.x, fr.z, fr.h);
  pl?.setLook?.(fr.yaw, fr.pitchRad != null ? fr.pitchRad : (fr.pitch * Math.PI) / 180);
}, hour, weather, fr);
await sleep(3000);
const grab = async (n) => { await sleep(1700); await writeFile(`${OUT}/${shot}-${n}.png`, await p.screenshot({ type: 'png' })); console.log(`${OUT}/${shot}-${n}.png`); };
await grab('base');
for (const v of variants) {
  const [name, list] = v.split(':');
  const pairs = list.split(',').map((s) => s.split('='));
  await p.evaluate((pairs) => { const t = window.engine.ctx.get('terrain'); for (const [k, val] of pairs) t.mats.setBudget(k, val); }, pairs);
  await grab(name);
  await p.evaluate((pairs) => { const t = window.engine.ctx.get('terrain'); for (const [k] of pairs) t.mats.setBudget(k, null); }, pairs);
}
await b.close(); vite?.kill();
