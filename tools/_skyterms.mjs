#!/usr/bin/env node
/**
 * Which term owns the shadow ambient?
 *
 * `tools/_skyirr.mjs` reports the sky-view table's cosine integral (the
 * cloud-free dome) and the environment cube's (what surfaces are actually lit
 * by) side by side, and the two disagree by a factor of four in magnitude and a
 * hundred and eighty degrees in hue. This ablates the terms that live in the
 * cube but not in the table — the cumulus deck and the high veil — plus the
 * particulate layer, which lives in both, and reports what each is worth.
 *
 *   node tools/_skyterms.mjs [shots] [weather] [hour]
 *
 * Each case pokes the sky material's uniforms, re-renders the table and re-bakes
 * the cube in ONE page evaluation so `step()` cannot overwrite them in between.
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';

const PORT = 5209;
const URL = `http://127.0.0.1:${PORT}/`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = (process.argv[2] ?? 'ridge,coast').split(',');
const WEATHER = process.argv[3] ?? 'clear';
const HOUR = Number(process.argv[4] ?? 9.0);
const CASES = (process.argv[5] ?? 'base,nohaze,nodeck,noveil,domeonly').split(';');

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) {
  vite = spawn('npx', ['vite', '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'ignore' });
  for (let i = 0; i < 90 && !(await up()); i++) await sleep(500);
}
const browser = await launch({
  executablePath: CHROME, headless: 'new', protocolTimeout: 600_000,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1280,720', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(2500);
const framed = await page.evaluate(FRAMING_FN);

const MEASURE = (kase) => {
  const THREE = window.RENDER_THREE;
  const ctx = window.engine.ctx;
  const sky = ctx.get('sky');
  const u = sky.skyMat.uniforms;
  const C = window.RENDER_THREE.Color;
  const saved = {
    h: u.uHazeDensity.value, c: u.uCoverage.value, ci: u.uCirrus.value, km: u.uCloudKeyMax.value,
    hH: u.uHazeH.value, ht: u.uHazeTint.value.clone(), hs: u.uHazeSun.value.clone(), hdp: u.uHazeDeep.value.clone(),
    cs: u.uCloudSun.value.clone(), ca: u.uCloudAmb.value.clone(), cd: u.uCloudAmbDn.value.clone(),
  };
  if (kase === 'nohaze' || kase === 'domeonly') u.uHazeDensity.value = 0;
  if (kase === 'nodeck' || kase === 'domeonly') u.uCoverage.value = 0;
  if (kase === 'noveil' || kase === 'domeonly') u.uCirrus.value = 0;
  if (kase === 'nocloudsun') { u.uCloudSun.value.setRGB(0, 0, 0); u.uCirrus.value = 0; u.uHazeDensity.value = 0; }
  if (kase === 'nocloudamb') { u.uCloudAmb.value.setRGB(0, 0, 0); u.uCloudAmbDn.value.setRGB(0, 0, 0); u.uCirrus.value = 0; u.uHazeDensity.value = 0; }
  if (kase === 'deckonly') { u.uCirrus.value = 0; u.uHazeDensity.value = 0; }
  const km = /^cap:([0-9.]+)$/.exec(kase);
  if (km) {
    const cs2 = u.uCloudSun.value;
    const ceil = Math.max(cs2.r, cs2.g, cs2.b) * Math.max(sky.weather.sunDir.y, 0.02) * 0.96 / Math.PI;
    u.uCloudKeyMax.value = Number(km[1]) * ceil;
  }
  const hm = /^haze:([0-9.eE-]+)$/.exec(kase);
  if (hm) u.uHazeDensity.value = Number(hm[1]);
  const hh = /^hazeH:([0-9.]+)$/.exec(kase);
  if (hh) u.uHazeH.value = Number(hh[1]);
  const ht = /^htint:([0-9.]+)_([0-9.]+)_([0-9.]+)$/.exec(kase);
  if (ht) u.uHazeTint.value.setRGB(Number(ht[1]), Number(ht[2]), Number(ht[3]));
  const hd = /^hdeep:([0-9.]+)_([0-9.]+)_([0-9.]+)$/.exec(kase);
  if (hd) u.uHazeDeep.value.setRGB(Number(hd[1]), Number(hd[2]), Number(hd[3]));
  const hk = /^hkey:([0-9.]+)$/.exec(kase);
  if (hk) u.uHazeSun.value.multiplyScalar(Number(hk[1]));
  const combo = /^combo:([0-9.]+):([0-9.]+)_([0-9.]+)_([0-9.]+):([0-9.eE-]+)$/.exec(kase);
  if (combo) {
    const cs3 = u.uCloudSun.value;
    const ceil = Math.max(cs3.r, cs3.g, cs3.b) * Math.max(sky.weather.sunDir.y, 0.02) * 0.96 / Math.PI;
    u.uCloudKeyMax.value = Number(combo[1]) * ceil;
    u.uHazeTint.value.setRGB(Number(combo[2]), Number(combo[3]), Number(combo[4]));
    u.uHazeDensity.value = Number(combo[5]);
  }
  void C;

  sky.skyView.render(ctx.renderer);
  sky.captureEnv(ctx);

  const rt = sky.skyView.rt;
  const W = rt.width, H = rt.height;
  const buf = new Uint16Array(W * H * 4);
  ctx.renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
  const f = (h) => THREE.DataUtils.fromHalfFloat(h);
  const PI = Math.PI;
  const up3 = [0, 0, 0];
  const bands = [];
  for (let i = 0; i < 9; i++) bands.push({ el: i * 10, n: 0, r: 0, g: 0, b: 0 });
  const dAz = (2 * PI) / W, dEv = 2 / H;
  for (let j = 0; j < H; j++) {
    const ev = ((j + 0.5) / H) * 2 - 1;
    const el = Math.sign(ev) * ev * ev * (PI / 2);
    const w = Math.abs(Math.sin(el)) * Math.cos(el) * (PI * Math.abs(ev) * dEv) * dAz;
    if (el < 0) continue;
    for (let i = 0; i < W; i++) {
      const k = (j * W + i) * 4;
      const r = f(buf[k]), g = f(buf[k + 1]), b = f(buf[k + 2]);
      up3[0] += r * w; up3[1] += g * w; up3[2] += b * w;
      const bd = bands[Math.min(8, Math.floor((el * 180) / PI / 10))];
      bd.n++; bd.r += r; bd.g += g; bd.b += b;
    }
  }

  const cube = sky.cubeRT;
  const cs = cube.width;
  const cbuf = new Uint16Array(cs * cs * 4);
  const faceDir = (fc, uu, vv) => {
    const a = 2 * uu - 1, b = 1 - 2 * vv;
    switch (fc) {
      case 0: return [1, b, -a];
      case 1: return [-1, b, a];
      case 2: return [a, 1, -b];
      case 3: return [a, -1, b];
      case 4: return [a, b, 1];
      default: return [-a, b, -1];
    }
  };
  const cUp = [0, 0, 0];
  let peak = 0;
  for (let fc = 0; fc < 6; fc++) {
    ctx.renderer.readRenderTargetPixels(cube, 0, 0, cs, cs, cbuf, fc);
    for (let j = 0; j < cs; j++) {
      for (let i = 0; i < cs; i++) {
        const d = faceDir(fc, (i + 0.5) / cs, (j + 0.5) / cs);
        const len = Math.hypot(d[0], d[1], d[2]);
        const dOm = ((2 / cs) * (2 / cs)) / (len * len * len);
        const ny = d[1] / len;
        if (ny < 0) continue;
        const k = (j * cs + i) * 4;
        const rr = f(cbuf[k]), gg = f(cbuf[k + 1]), bb2 = f(cbuf[k + 2]);
        peak = Math.max(peak, 0.2126 * rr + 0.7152 * gg + 0.0722 * bb2);
        cUp[0] += rr * ny * dOm;
        cUp[1] += gg * ny * dOm;
        cUp[2] += bb2 * ny * dOm;
      }
    }
  }

  u.uHazeDensity.value = saved.h;
  u.uCoverage.value = saved.c;
  u.uCirrus.value = saved.ci;
  u.uCloudSun.value.copy(saved.cs);
  u.uCloudAmb.value.copy(saved.ca);
  u.uCloudAmbDn.value.copy(saved.cd);
  u.uCloudKeyMax.value = saved.km;
  u.uHazeH.value = saved.hH;
  u.uHazeTint.value.copy(saved.ht);
  u.uHazeDeep.value.copy(saved.hdp);
  u.uHazeSun.value.copy(saved.hs);

  const hue = (c) => {
    const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), d = mx - mn;
    if (d <= 0) return -1;
    let h;
    if (mx === c[0]) h = 60 * (((c[1] - c[2]) / d) % 6);
    else if (mx === c[1]) h = 60 * ((c[2] - c[0]) / d + 2);
    else h = 60 * ((c[0] - c[1]) / d + 4);
    return +(h < 0 ? h + 360 : h).toFixed(1);
  };
  const sat = (c) => { const mx = Math.max(c[0], c[1], c[2]); return +((mx - Math.min(c[0], c[1], c[2])) / Math.max(mx, 1e-9)).toFixed(3); };
  return {
    table: up3.map((x) => +x.toFixed(4)), tableHue: hue(up3), tableSat: sat(up3),
    peak: +peak.toFixed(3),
    cloudSun: [saved.cs.r, saved.cs.g, saved.cs.b].map((x) => +x.toFixed(3)),
    cloudAmb: [saved.ca.r, saved.ca.g, saved.ca.b].map((x) => +x.toFixed(3)),
    sunY: +sky.weather.sunDir.y.toFixed(3),
    sunAz: +(Math.atan2(sky.weather.sunDir.x, sky.weather.sunDir.z) * 180 / Math.PI).toFixed(1),
    camAz: (() => { const f = new (ctx.camera.position.constructor)(); ctx.camera.getWorldDirection(f); return +(Math.atan2(f.x, f.z) * 180 / Math.PI).toFixed(1); })(),
    cube: cUp.map((x) => +x.toFixed(4)), cubeHue: hue(cUp), cubeSat: sat(cUp),
    bands: bands.map((b) => ({ el: b.el, L: [+(b.r / b.n).toFixed(4), +(b.g / b.n).toFixed(4), +(b.b / b.n).toFixed(4)], hue: hue([b.r / b.n, b.g / b.n, b.b / b.n]) })),
  };
};

for (const name of SHOTS) {
  const fr = framed.framing[name];
  if (!fr) continue;
  await page.evaluate((fr, hr, wk) => {
    const ctx = window.engine.ctx, p = ctx.get('player');
    ctx.clock.hour = hr; ctx.clock.scale = 0;
    ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.(wk, 0);
    if (p) p.freefly = true;
    if (fr.absY != null) { p?.teleport?.(fr.x, fr.z, 0); ctx.camera.position.set(fr.x, fr.absY, fr.z); }
    else p?.teleport?.(fr.x, fr.z, fr.h);
    p?.setLook?.(fr.yaw, fr.pitchRad ?? 0);
  }, fr, HOUR, WEATHER);
  await sleep(2600);
  console.log(`\n=== ${name} (${WEATHER}, ${HOUR.toFixed(2)}h) ===`);
  for (const kase of CASES) {
    const m = await page.evaluate(MEASURE, kase);
    console.log(`  ${kase.padEnd(9)} table ${JSON.stringify(m.table).padEnd(26)} hue ${String(m.tableHue).padStart(5)} sat ${m.tableSat}` +
                `   cube ${JSON.stringify(m.cube).padEnd(26)} hue ${String(m.cubeHue).padStart(5)} sat ${m.cubeSat}  peak ${m.peak}`);
    if (kase === CASES[0]) console.log(`      cloudSun ${JSON.stringify(m.cloudSun)}  cloudAmb ${JSON.stringify(m.cloudAmb)}  sunY ${m.sunY}  sunAz ${m.sunAz}  camAz ${m.camAz}`);
    if (kase === CASES[0] || kase === 'domeonly' || CASES.length <= 4) {
      for (const b of m.bands) console.log(`      ${String(b.el).padStart(2)}-${b.el + 10}  ${JSON.stringify(b.L).padEnd(26)} ${b.hue}`);
    }
    await sleep(300);
  }
}

await browser.close();
vite?.kill();
process.exit(0);
