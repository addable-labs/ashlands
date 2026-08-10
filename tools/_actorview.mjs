/**
 * Creature viewer with a real frame pump.
 *
 * diagcreature.mjs sleeps between steps, and in headless Chrome the rAF loop
 * only ticks a couple of times a second while nothing forces a composite — so
 * the LOD/staging state never converges and the capture shows a stale tier.
 * This drives N real animation frames instead.
 *
 *   node tools/_actorview.mjs skerrin --tag before [--hour 6.6] [--dist 26]
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://127.0.0.1:5178/';
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const KIND = argv.find((a) => !a.startsWith('--')) ?? 'skerrin';
const TAG = flag('tag', 'view');
const W = 1280, H = 960;

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) { vite = spawn('npx', ['vite', '--port', '5178', '--host', '127.0.0.1'], { stdio: 'ignore' }); for (let i = 0; i < 60 && !(await up()); i++) await sleep(500); }
const dir = `shots/${TAG}`;
await mkdir(dir, { recursive: true });

const b = await launch({
  executablePath: CHROME, headless: 'new',
  args: [`--window-size=${W},${H}`, '--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.waitForFunction('!!window.engine', { timeout: 240000 });

const pump = (n) => p.evaluate(async (n) => {
  let i = 0;
  await new Promise((res) => { const l = () => { if (++i < n) requestAnimationFrame(l); else res(); }; requestAnimationFrame(l); });
}, n);

const VIEWS = [
  { name: 'backlit', hour: +flag('hour', 6.6), back: true, dist: +flag('dist', 26) },
  { name: 'front', hour: 12.0, back: false, dist: +flag('dist', 26) },
];

for (const v of VIEWS) {
  const id = await p.evaluate((kind, v) => {
    const ctx = window.engine.ctx;
    ctx.clock.hour = v.hour;
    ctx.get('sky')?.setWeather?.('clear', 0);
    const pl = ctx.get('player');
    if (pl) pl.freefly = true;
    const a = ctx.get('actors').spawn(kind, 300, -200);
    return a.id;
  }, KIND, v);
  await pump(60);
  const frame = async () => p.evaluate((id, v) => {
    const ctx = window.engine.ctx;
    const acts = ctx.get('actors');
    const a = acts.all().find((x) => x.id === id);
    if (!a) return null;
    const t = ctx.get('terrain');
    const pl = ctx.get('player');
    const sun = ctx.get('sky').sun;
    const sd = sun.position.clone().sub(sun.target.position).normalize();
    const s = v.back ? -1 : 1;
    const d = new (sd.constructor)(sd.x, 0, sd.z);
    if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
    d.normalize();
    const px = a.position.x - s * d.x * v.dist;
    const pz = a.position.z - s * d.z * v.dist;
    const gy = t.heightAt(px, pz);
    pl?.teleport?.(px, pz, Math.max(0.2, a.position.y - gy - 1.6));
    pl?.setLook?.(Math.atan2(a.position.x - px, a.position.z - pz) + Math.PI, -0.02);
    return { pos: a.position.toArray().map((n) => +n.toFixed(1)), lod: a.lod, sun: sd.toArray().map((n) => +n.toFixed(2)) };
  }, id, v);
  await frame();
  await pump(150);
  const info = await frame();
  await pump(90);
  await writeFile(`${dir}/${KIND}-${v.name}.png`, await p.screenshot({ type: 'png' }));
  console.log(`${dir}/${KIND}-${v.name}.png ${JSON.stringify(info)}`);
}
await b.close(); vite?.kill();
