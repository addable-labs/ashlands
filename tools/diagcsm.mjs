#!/usr/bin/env node
/**
 * Cascade-fit dump. Captures the named shots and prints every cascade's fitted
 * ortho box, depth range, texel size and bias, so a boundary seen in an image
 * can be tied to a number instead of guessed at.
 *
 *   node tools/diagcsm.mjs ridge dawn --tag d1
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
  coast: { hour: 17.6, weather: 'clear' },
};

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const TAG = flag('tag', 'csm');
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

async function run(suffix, query) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await page.goto(URL + query, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.engine', { timeout: 180_000 });
  const framed = await page.evaluate(FRAMING_FN);
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
    const info = await page.evaluate(() => {
      const ctx = window.engine.ctx;
      const sky = ctx.get('sky');
      const csm = sky?.csm;
      const cam = ctx.camera;
      const o = { cam: cam.position.toArray().map((v) => +v.toFixed(1)), fov: cam.fov, cascades: [] };
      if (!csm) return o;
      for (const l of csm.lights) {
        const c = l.shadow.camera;
        o.cascades.push({
          name: l.name,
          r: +c.right.toFixed(2), near: +c.near.toFixed(1), far: +c.far.toFixed(1),
          map: l.shadow.mapSize.x,
          texel: +((c.right * 2) / l.shadow.mapSize.x).toFixed(4),
          bias: l.shadow.bias, normalBias: +l.shadow.normalBias.toFixed(4), radius: +l.shadow.radius.toFixed(2),
          lightPos: l.position.toArray().map((v) => +v.toFixed(1)),
          target: l.target.position.toArray().map((v) => +v.toFixed(1)),
          distCamToTarget: +l.target.position.distanceTo(cam.position).toFixed(1),
        });
      }
      return o;
    });
    console.log(name, suffix, JSON.stringify(info, null, 1));
    await writeFile(`${out}/${name}${suffix}.png`, await page.screenshot({ type: 'png' }));
    console.log('wrote', `${out}/${name}${suffix}.png`);
  }
  await page.close();
}

await run('', '');

await browser.close();
vite?.kill();
