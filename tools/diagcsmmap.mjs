#!/usr/bin/env node
/**
 * Ground-truth cascade map. Raymarches the live heightfield for a grid of screen
 * pixels, evaluates exactly the authority function the shader uses against the
 * live shadow matrices, and writes a false-colour PNG plus a distance map.
 * Red = cascade 0, green = 1, blue = 2, black = outside every cascade box.
 */
import { launch } from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { FRAMING_FN } from './framing.mjs';

const SHOTS = {
  dawn: { hour: 6.2, weather: 'clear' },
  redmtn: { hour: 10.0, weather: 'cloudy' },
  dusk: { hour: 19.8, weather: 'clear' },
  vale: { hour: 12.0, weather: 'clear' },
  ridge: { hour: 8.4, weather: 'clear' },
};
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const TAG = flag('tag', 'csmmap');
const names = argv.filter((a) => !a.startsWith('--') && SHOTS[a]);
const wanted = names.length ? names : ['ridge'];
const URL = 'http://127.0.0.1:5178/';

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) {
  vite = spawn('npx', ['vite', '--port', '5178', '--host', '127.0.0.1'], { stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
}
const out = `shots/${TAG}`;
await mkdir(out, { recursive: true });
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
const framed = await page.evaluate(FRAMING_FN);

const GW = 240, GH = 135;

for (const name of wanted) {
  const fr = framed.framing[name];
  if (!fr) continue;
  const s = SHOTS[name];
  await page.evaluate((s, fr) => {
    const ctx = window.engine.ctx;
    ctx.clock.hour = s.hour;
    ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.(s.weather, 0);
    const p = ctx.get('player');
    if (p) p.freefly = true;
    p?.teleport?.(fr.x, fr.z, fr.h);
    p?.setLook?.(fr.yaw, (fr.pitch * Math.PI) / 180);
  }, s, fr);
  await sleep(2600);

  const data = await page.evaluate(async (GW, GH, BLEND) => {
    const ctx = window.engine.ctx;
    const cam = ctx.camera;
    const t = ctx.get('terrain');
    const csm = ctx.get('sky').csm;
    cam.updateMatrixWorld();
    const mats = csm.lights.map((l) => l.shadow.matrix.elements.slice());
    const M = cam.matrixWorld.elements;
    const ox = M[12], oy = M[13], oz = M[14];
    const tanY = Math.tan((cam.fov * Math.PI) / 360);
    const tanX = tanY * cam.aspect;
    const xf = (m, x, y, z) => {
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [
        (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
        (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
        (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
      ];
    };
    const cells = [];
    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        const ndcX = ((gx + 0.5) / GW) * 2 - 1;
        const ndcY = 1 - ((gy + 0.5) / GH) * 2;
        const cx = ndcX * tanX, cy = ndcY * tanY, cz = -1;
        let vx = M[0] * cx + M[4] * cy + M[8] * cz;
        let vy = M[1] * cx + M[5] * cy + M[9] * cz;
        let vz = M[2] * cx + M[6] * cy + M[10] * cz;
        const il = 1 / Math.hypot(vx, vy, vz);
        vx *= il; vy *= il; vz *= il;
        const below = (d) => oy + vy * d <= t.heightAt(ox + vx * d, oz + vz * d);
        let lo = 0, hi = 0, hit = false, step = 2;
        for (let d = 2; d < 8000; d += step) {
          if (below(d)) { hit = true; hi = d; lo = d - step; break; }
          step = Math.max(2, d * 0.02);
        }
        if (!hit) { cells.push(null); continue; }
        for (let k = 0; k < 24; k++) {
          const mid = (lo + hi) * 0.5;
          if (below(mid)) hi = mid; else lo = mid;
        }
        const px = ox + vx * hi, py = oy + vy * hi, pz = oz + vz * hi;
        const auth = [];
        const inside = [];
        for (const m of mats) {
          const c = xf(m, px, py, pz);
          inside.push(c[0] >= 0 && c[0] <= 1 && c[1] >= 0 && c[1] <= 1 && c[2] >= 0 && c[2] <= 1);
          if (c[2] < 0 || c[2] > 1) { auth.push(0); continue; }
          const q = Math.min(Math.min(c[0], 1 - c[0]), Math.min(c[1], 1 - c[1]));
          const tt = Math.min(1, Math.max(0, q / BLEND));
          auth.push(tt * tt * (3 - 2 * tt));
        }
        cells.push({ d: hi, auth, inside });
      }
    }
    return {
      cells,
      cam: [ox, oy, oz],
      cascades: csm.lights.map((l) => ({
        r: l.shadow.camera.right, near: l.shadow.camera.near, far: l.shadow.camera.far,
        map: l.shadow.mapSize.x,
      })),
    };
  }, GW, GH, 0.09);

  const png = new PNG({ width: GW, height: GH });
  const dpng = new PNG({ width: GW, height: GH });
  const counts = [0, 0, 0, 0];
  let outsideAll = 0;
  for (let i = 0; i < GW * GH; i++) {
    const c = data.cells[i];
    const o = i * 4;
    if (!c) { png.data[o] = png.data[o + 1] = png.data[o + 2] = 30; png.data[o + 3] = 255; dpng.data[o + 3] = 255; continue; }
    let rem = 1;
    const w = [];
    for (let k = 0; k < c.auth.length; k++) {
      const ww = k === c.auth.length - 1 ? rem : Math.min(c.auth[k], rem);
      rem -= ww; w.push(ww);
    }
    // Effective shadow: last cascade contributes nothing if the point is outside its box.
    let cover = 0;
    for (let k = 0; k < w.length; k++) if (c.inside[k]) cover += w[k];
    if (cover < 0.5) outsideAll++;
    png.data[o] = Math.round(255 * (w[0] ?? 0));
    png.data[o + 1] = Math.round(255 * (w[1] ?? 0));
    png.data[o + 2] = Math.round(255 * (w[2] ?? 0));
    png.data[o + 3] = 255;
    for (let k = 0; k < w.length; k++) if (w[k] > 0.5) counts[k]++;
    const dd = Math.min(255, Math.round((c.d / 2000) * 255));
    dpng.data[o] = dd; dpng.data[o + 1] = c.inside[c.inside.length - 1] ? 200 : 0;
    dpng.data[o + 2] = cover > 0.5 ? 200 : 0; dpng.data[o + 3] = 255;
  }
  await writeFile(`${out}/${name}-cascade.png`, PNG.sync.write(png));
  await writeFile(`${out}/${name}-dist.png`, PNG.sync.write(dpng));
  console.log(name, 'cascades', JSON.stringify(data.cascades), 'dominant counts', counts, 'px outside all boxes', outsideAll, '/', GW * GH);
}
await browser.close();
vite?.kill();
