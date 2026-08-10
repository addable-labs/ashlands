/**
 * Creature viewer. Spawns one of a species in front of the camera and shoots it
 * from a few angles, including a backlit one — the read the skerrin lives or dies
 * on.
 *
 *   node tools/diagcreature.mjs skerrin [--tag before]
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const URL = 'http://127.0.0.1:5178/';
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const KIND = argv.find((a) => !a.startsWith('--')) ?? 'skerrin';
const TAG = flag('tag', 'creature');

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) { vite = spawn('npx', ['vite', '--port', '5178', '--host', '127.0.0.1'], { stdio: 'ignore' }); for (let i = 0; i < 60 && !(await up()); i++) await sleep(500); }
const dir = `shots/${TAG}`;
await mkdir(dir, { recursive: true });

const b = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--window-size=1280,960', '--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'],
  defaultViewport: { width: 1280, height: 960, deviceScaleFactor: 1 },
});
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.engine', { timeout: 300000 });

// hour, camera azimuth relative to sun so we get a backlit and a front-lit read
const VIEWS = [
  { name: 'backlit', hour: 7.4, back: true, dist: 16 },
  { name: 'front', hour: 12.0, back: false, dist: 16 },
  { name: 'far', hour: 9.0, back: true, dist: 55 },
];

for (const v of VIEWS) {
  const info = await p.evaluate((kind, v) => {
    const ctx = window.engine.ctx;
    ctx.clock.hour = v.hour;
    ctx.get('sky')?.setWeather?.('clear', 0);
    const acts = ctx.get('actors');
    const t = ctx.get('terrain');
    const pl = ctx.get('player');
    if (pl) pl.freefly = true;
    // Somewhere flat and open.
    const cx = 300, cz = -200;
    const a = acts.spawn(kind, cx, cz);
    const sun = ctx.get('sky').sun;
    const sd = sun.position.clone().sub(sun.target.position).normalize();
    // Stand on the far side of the creature from the sun (backlit) or the near
    // side (front lit), at eye level with the body.
    const s = v.back ? -1 : 1;
    const dirXZ = new (sd.constructor)(sd.x, 0, sd.z);
    if (dirXZ.lengthSq() < 1e-4) dirXZ.set(0, 0, 1);
    dirXZ.normalize();
    const px = a.position.x - s * dirXZ.x * v.dist;
    const pz = a.position.z - s * dirXZ.z * v.dist;
    const gy = t.heightAt(px, pz);
    const eye = a.position.y + 1.0;
    pl?.teleport?.(px, pz, Math.max(1.5, eye - gy));
    const yaw = Math.atan2(a.position.x - px, a.position.z - pz);
    pl?.setLook?.(yaw, -0.05);
    return { id: a.id, pos: a.position.toArray(), sun: sd.toArray(), cam: [px, pz] };
  }, KIND, v);
  await sleep(1200);
  // Re-frame against where it actually settled: a drifter moves while the sky
  // and TAA converge, and spawn-time altitude is only the first guess.
  const info2 = await p.evaluate((id, v) => {
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
    // teleport()'s third argument is height above ground for the BODY; the free
    // camera sits 1.6 m over it. Yaw 0 faces -Z, hence the +PI.
    pl?.teleport?.(px, pz, Math.max(0.2, a.position.y - gy - 1.6));
    pl?.setLook?.(Math.atan2(a.position.x - px, a.position.z - pz) + Math.PI, -0.02);
    return { pos: a.position.toArray(), lod: a.lod, gy, camH: a.position.y - gy };
  }, info.id, v);
  await sleep(2200);
  await writeFile(`${dir}/${KIND}-${v.name}.png`, await p.screenshot({ type: 'png' }));
  console.log(`${dir}/${KIND}-${v.name}.png  ${JSON.stringify(info)} -> ${JSON.stringify(info2)}`);
}
await b.close(); vite?.kill();
