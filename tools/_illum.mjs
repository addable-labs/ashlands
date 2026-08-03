#!/usr/bin/env node
/**
 * Illuminant separation probe — one browser session, EVERY canonical shot at its
 * OWN hour and weather.
 *
 * Reports, per vantage: the key light's chroma, the sky-view table's
 * cosine-weighted hemispheric irradiance (what an up-facing shadowed surface is
 * lit by), the environment cube's upper and lower hemisphere integrals (what
 * MeshStandardMaterial actually samples), and the published `weather.ambient`.
 *
 * The stage-2 quantity of interest is the HUE DELTA between the key and the
 * fill. `_skyirr.mjs` answers the same question but only at one hour for all
 * shots, which is useless for a schedule-driven illuminant.
 *
 *   node tools/_illum.mjs [shot,shot,...]
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';

/**
 * Deliberately NOT imported from shoot.mjs. That module runs its whole ten-shot
 * capture at import time, so `import { SHOTS }` costs a full browser session and
 * ten screenshots before this script's first line executes. Kept in step by
 * hand; it is the same table every other diagnostic in this directory carries.
 */
const SHOTS = {
  dawn: { hour: 6.2, weather: 'clear' }, redmtn: { hour: 10.0, weather: 'cloudy' },
  coast: { hour: 17.6, weather: 'clear' }, night: { hour: 23.4, weather: 'clear' },
  ashstorm: { hour: 13.0, weather: 'ashstorm' }, dusk: { hour: 19.8, weather: 'clear' },
  vale: { hour: 12.0, weather: 'clear' }, storm: { hour: 15.0, weather: 'rain' },
  underwater: { hour: 12.0, weather: 'clear' }, ridge: { hour: 8.4, weather: 'clear' },
};

const PORT = 5211;
const URL = `http://127.0.0.1:${PORT}/`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const wanted = (process.argv[2] ?? Object.keys(SHOTS).join(',')).split(',');

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) {
  vite = spawn('npx', ['vite', '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'ignore' });
  for (let i = 0; i < 90 && !(await up()); i++) await sleep(500);
}
const browser = await launch({
  executablePath: CHROME, headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1280,720', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(2500);
const framed = await page.evaluate(FRAMING_FN);

const MEASURE = () => {
  const THREE = window.RENDER_THREE;
  const ctx = window.engine.ctx;
  const sky = ctx.get('sky');
  const f = (h) => THREE.DataUtils.fromHalfFloat(h);
  const PI = Math.PI;

  // ---- sky-view table: cosine-weighted hemispheric irradiance, up and down.
  const rt = sky.skyView.rt;
  const W = rt.width, H = rt.height;
  const buf = new Uint16Array(W * H * 4);
  ctx.renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
  const up3 = [0, 0, 0], dn3 = [0, 0, 0];
  const dAz = (2 * PI) / W, dEv = 2 / H;
  for (let j = 0; j < H; j++) {
    const ev = ((j + 0.5) / H) * 2 - 1;
    const el = Math.sign(ev) * ev * ev * (PI / 2);
    const w = Math.abs(Math.sin(el)) * Math.cos(el) * (PI * Math.abs(ev) * dEv) * dAz;
    for (let i = 0; i < W; i++) {
      const k = (j * W + i) * 4;
      const t = el >= 0 ? up3 : dn3;
      t[0] += f(buf[k]) * w; t[1] += f(buf[k + 1]) * w; t[2] += f(buf[k + 2]) * w;
    }
  }

  // ---- environment cube: the term every MeshStandardMaterial samples.
  const cube = sky.cubeRT;
  const cs = cube.width;
  const cbuf = new Uint16Array(cs * cs * 4);
  const faceDir = (fc, u, v) => {
    const a = 2 * u - 1, b = 1 - 2 * v;
    switch (fc) {
      case 0: return [1, b, -a];
      case 1: return [-1, b, a];
      case 2: return [a, 1, -b];
      case 3: return [a, -1, b];
      case 4: return [a, b, 1];
      default: return [-a, b, -1];
    }
  };
  const cUp = [0, 0, 0], cDn = [0, 0, 0];
  for (let fc = 0; fc < 6; fc++) {
    ctx.renderer.readRenderTargetPixels(cube, 0, 0, cs, cs, cbuf, fc);
    for (let j = 0; j < cs; j++) for (let i = 0; i < cs; i++) {
      const d = faceDir(fc, (i + 0.5) / cs, (j + 0.5) / cs);
      const len = Math.hypot(d[0], d[1], d[2]);
      const dOm = ((2 / cs) * (2 / cs)) / (len * len * len);
      const ny = d[1] / len;
      const k = (j * cs + i) * 4;
      const t = ny >= 0 ? cUp : cDn;
      const w2 = Math.abs(ny) * dOm;
      t[0] += f(cbuf[k]) * w2; t[1] += f(cbuf[k + 1]) * w2; t[2] += f(cbuf[k + 2]) * w2;
    }
  }

  const hue = (c) => {
    const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), d = mx - mn;
    if (d <= 1e-9) return -1;
    let h;
    if (mx === c[0]) h = 60 * (((c[1] - c[2]) / d) % 6);
    else if (mx === c[1]) h = 60 * ((c[2] - c[0]) / d + 2);
    else h = 60 * ((c[0] - c[1]) / d + 4);
    return +(h < 0 ? h + 360 : h).toFixed(1);
  };
  const sat = (c) => { const mx = Math.max(c[0], c[1], c[2]); return mx > 0 ? +((mx - Math.min(c[0], c[1], c[2])) / mx).toFixed(3) : 0; };
  const lum = (c) => +(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]).toFixed(4);
  const w = sky.weather;
  const sun = [w.sunColor.r, w.sunColor.g, w.sunColor.b];
  const amb = [w.ambient.r, w.ambient.g, w.ambient.b];
  const pack = (c) => ({ v: c.map((x) => +x.toFixed(4)), hue: hue(c), sat: sat(c), lum: lum(c) });
  return { sun: pack(sun), skyIrr: pack(up3), gndIrr: pack(dn3), cubeUp: pack(cUp), cubeDn: pack(cDn), amb: pack(amb) };
};

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('shot', 11) + pad('term', 8) + pad('rgb', 30) + pad('hue', 8) + pad('sat', 8) + pad('lum', 9));
for (const name of wanted) {
  const cfg = SHOTS[name];
  const fr = framed.framing[name];
  if (!cfg || !fr) continue;
  await page.evaluate((fr, hr, wk) => {
    const ctx = window.engine.ctx, p = ctx.get('player');
    ctx.clock.hour = hr; ctx.clock.scale = 0;
    ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.(wk, 0);
    if (p) p.freefly = true;
    if (fr.absY != null) { p?.teleport?.(fr.x, fr.z, 0); ctx.camera.position.set(fr.x, fr.absY, fr.z); }
    else p?.teleport?.(fr.x, fr.z, fr.h);
    p?.setLook?.(fr.yaw, fr.pitchRad ?? 0);
  }, fr, cfg.hour, cfg.weather);
  await sleep(3000);
  const m = await page.evaluate(MEASURE);
  for (const [k, v] of Object.entries(m)) {
    console.log(pad(k === 'sun' ? name : '', 11) + pad(k, 8) + pad(JSON.stringify(v.v), 30) + pad(v.hue, 8) + pad(v.sat, 8) + pad(v.lum, 9));
  }
  const dh = Math.abs(((m.cubeUp.hue - m.sun.hue) + 540) % 360 - 180);
  console.log(pad('', 11) + `KEY->FILL hue separation ${dh.toFixed(1)} deg\n`);
}

await browser.close();
vite?.kill();
process.exit(0);
