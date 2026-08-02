#!/usr/bin/env node
/**
 * Pass-isolation capture. Frames one shot, then screenshots it once per
 * RENDER_DEBUG variation so an artifact can be attributed to a pass.
 *
 *   node tools/diagiso.mjs ridge --tag iso
 */
import { launch } from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';

const SHOTS = {
  dawn: { hour: 6.2, weather: 'clear' },
  redmtn: { hour: 10.0, weather: 'cloudy' },
  dusk: { hour: 19.8, weather: 'clear' },
  vale: { hour: 12.0, weather: 'clear' },
  ridge: { hour: 8.4, weather: 'clear' },
};
const VARIANTS = [
  ['base', {}, 'none'],
  ['hardsplit', {}, 'hardsplit'],
  ['novol', { volumetrics: false }, 'none'],
  ['noshadow', {}, 'noshadow'],
];

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const TAG = flag('tag', 'iso');
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

for (const name of wanted) {
  const fr = framed.framing[name];
  if (!fr) continue;
  const s = SHOTS[name];
  for (const [vn, over, mode] of VARIANTS) {
    await page.evaluate((s, fr, over, mode) => {
      const ctx = window.engine.ctx;
      const D = globalThis.RENDER_DEBUG;
      for (const k of Object.keys(D)) if (!k.startsWith('show')) D[k] = true;
      Object.assign(D, over);
      const csm = ctx.get('sky')?.csm;
      if (csm) {
        if (!csm.__origUpdate) csm.__origUpdate = csm.update.bind(csm);
        const orig = csm.__origUpdate;
        const clone = (srcIdx) => {
          const src = csm.lights[srcIdx];
          for (const l of csm.lights) {
            if (l === src) continue;
            l.position.copy(src.position);
            l.target.position.copy(src.target.position);
            l.up.copy(src.up);
            const a = l.shadow.camera, b = src.shadow.camera;
            a.left = b.left; a.right = b.right; a.top = b.top; a.bottom = b.bottom;
            a.near = b.near; a.far = b.far; a.updateProjectionMatrix();
            l.shadow.bias = src.shadow.bias;
            l.shadow.normalBias = src.shadow.normalBias;
            l.shadow.radius = src.shadow.radius;
            l.shadow.needsUpdate = true;
          }
          src.shadow.needsUpdate = true;
        };
        if (mode === 'onebox') csm.update = (...a) => { orig(...a); clone(csm.count - 1); };
        else if (mode === 'nearbox') csm.update = (...a) => { orig(...a); clone(0); };
        else csm.update = orig;
        for (const l of csm.lights) l.shadow.intensity = mode === 'noshadow' ? 0 : 1;
      }
      // Reproduce the pre-fix volumetric hand-off: zero blend band (hard box
      // wall) and one shared normalised bias for both cascades.
      const pipe = ctx.get('render');
      const u = pipe?.mVol?.uniforms;
      if (u) {
        for (const key of ['uShadowBand', 'uShadowBias']) {
          const v = u[key].value;
          if (v.__pinned) { delete v.set; delete v.__pinned; }
        }
        if (mode === 'hardsplit') {
          const band = u.uShadowBand.value;
          band.x = 0; band.y = 0; band.__pinned = true; band.set = () => band;
          const bias = u.uShadowBias.value;
          bias.x = 0.0015; bias.y = 0.0015; bias.__pinned = true; bias.set = () => bias;
        }
      }
      ctx.clock.hour = s.hour;
      ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
      ctx.get('sky')?.setWeather?.(s.weather, 0);
      const p = ctx.get('player');
      if (p) p.freefly = true;
      p?.teleport?.(fr.x, fr.z, fr.h);
      p?.setLook?.(fr.yaw, (fr.pitch * Math.PI) / 180);
    }, s, fr, over, mode);
    await sleep(2600);
    await writeFile(`${out}/${name}-${vn}.png`, await page.screenshot({ type: 'png' }));
    console.log('wrote', `${out}/${name}-${vn}.png`);
  }
}
await browser.close();
vite?.kill();
