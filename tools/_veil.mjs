#!/usr/bin/env node
/**
 * What is the cirrus veil worth, and what colour is it?
 *
 * Bakes the environment cube three times per vantage — as authored, with the
 * high veil ablated, and with every cloud ablated — and integrates each against
 * a cosine lobe. The differences are, by construction, exactly the veil's and
 * exactly the deck's share of the indirect light every surface in the world is
 * lit by, with their own chroma rather than a chroma inferred from the frame.
 *
 * Also dumps the live illuminant uniforms, because the veil's hue is a product
 * of uCloudSun (the beam at cloud altitude), the slab transmittance under it and
 * whatever sky term the veil is given, and knowing which of the three is warm
 * is the whole diagnosis.
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';

const PORT = 5209;
const URL = `http://127.0.0.1:${PORT}/`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = (process.argv[2] ?? 'ridge,vale,coast').split(',');
const WEATHER = (process.argv[3] ?? 'clear').split(',');
const HOUR = Number(process.argv[4] ?? 9);

async function up() {
  try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
}
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

/** Pin a uniform so the per-frame writer cannot put it back. */
const PIN = (names) => {
  const sky = window.engine.ctx.get('sky');
  const u = sky.skyMat.uniforms;
  for (const n of names) {
    const d = Object.getOwnPropertyDescriptor(u[n], 'value');
    if (d && d.get) continue;
    Object.defineProperty(u[n], 'value', { get: () => 0, set: () => {}, configurable: true });
  }
  sky.envRT = null; // force a re-bake on the next frame
};

const CUBE = () => {
  const THREE = window.RENDER_THREE;
  const ctx = window.engine.ctx;
  const sky = ctx.get('sky');
  const cube = sky.cubeRT;
  const cs = cube.width;
  const buf = new Uint16Array(cs * cs * 4);
  const f = (h) => THREE.DataUtils.fromHalfFloat(h);
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
  const up3 = [0, 0, 0];
  // Elevation bands of the UPPER hemisphere, so the veil's share can be seen as
  // a function of where in the dome it sits rather than only in the total.
  const bands = [];
  for (let i = 0; i < 3; i++) bands.push([0, 0, 0, 0]);
  for (let fc = 0; fc < 6; fc++) {
    ctx.renderer.readRenderTargetPixels(cube, 0, 0, cs, cs, buf, fc);
    for (let j = 0; j < cs; j++) {
      for (let i = 0; i < cs; i++) {
        const u = (i + 0.5) / cs, v = (j + 0.5) / cs;
        const d = faceDir(fc, u, v);
        const len = Math.hypot(d[0], d[1], d[2]);
        const dOm = ((2 / cs) * (2 / cs)) / (len * len * len);
        const ny = d[1] / len;
        if (ny < 0) continue;
        const k = (j * cs + i) * 4;
        const w = ny * dOm;
        const r = f(buf[k]), g = f(buf[k + 1]), b = f(buf[k + 2]);
        up3[0] += r * w; up3[1] += g * w; up3[2] += b * w;
        const bi = ny < 0.34 ? 0 : ny < 0.71 ? 1 : 2;
        const bd = bands[bi];
        bd[0] += r * w; bd[1] += g * w; bd[2] += b * w; bd[3] += w;
      }
    }
  }
  return { up: up3, bands };
};

const UNIFORMS = () => {
  const sky = window.engine.ctx.get('sky');
  const u = sky.skyMat.uniforms;
  const c = (n) => { const v = u[n].value; return [+v.r.toFixed(4), +v.g.toFixed(4), +v.b.toFixed(4)]; };
  const out = {
    uCloudSun: c('uCloudSun'), uCloudAmb: c('uCloudAmb'), uCloudAmbDn: c('uCloudAmbDn'),
    uSkyAmbient: c('uSkyAmbient'), uHazeSun: c('uHazeSun'),
    uHazeTint: c('uHazeTint'), uHazeDeep: c('uHazeDeep'),
    uCirrus: u.uCirrus.value, uCoverage: u.uCoverage.value,
    uHazeDensity: u.uHazeDensity.value, uHazeH: u.uHazeH.value,
    uCamY: u.uCamY.value,
    sunDir: [+u.uSunDir.value.x.toFixed(4), +u.uSunDir.value.y.toFixed(4), +u.uSunDir.value.z.toFixed(4)],
    skyIrr: [+sky.skyIrr.r.toFixed(4), +sky.skyIrr.g.toFixed(4), +sky.skyIrr.b.toFixed(4)],
    groundIrr: [+sky.groundIrr.r.toFixed(4), +sky.groundIrr.g.toFixed(4), +sky.groundIrr.b.toFixed(4)],
  };
  if (u.uCirrusSun) out.uCirrusSun = c('uCirrusSun');
  if (u.uCirrusSkyUp) out.uCirrusSkyUp = c('uCirrusSkyUp');
  if (u.uCirrusSkyDn) out.uCirrusSkyDn = c('uCirrusSkyDn');
  return out;
};

const hue = (c) => {
  const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), d = mx - mn;
  if (d <= 1e-9) return -1;
  let h;
  if (mx === c[0]) h = 60 * (((c[1] - c[2]) / d) % 6);
  else if (mx === c[1]) h = 60 * ((c[2] - c[0]) / d + 2);
  else h = 60 * ((c[0] - c[1]) / d + 4);
  return +(h < 0 ? h + 360 : h).toFixed(1);
};
const sat = (c) => { const mx = Math.max(c[0], c[1], c[2]); return mx <= 0 ? 0 : +(1 - Math.min(c[0], c[1], c[2]) / mx).toFixed(3); };
const lum = (c) => +(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]).toFixed(4);
const fmt = (c) => `[${c.map((x) => x.toFixed(4)).join(', ')}]`;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

for (const wk of WEATHER) {
  for (const name of SHOTS) {
    const fr = framed.framing[name];
    if (!fr) continue;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction('!!window.engine', { timeout: 180_000 });
    await sleep(2500);
    await page.evaluate((fr, hr, w) => {
      const ctx = window.engine.ctx, p = ctx.get('player');
      ctx.clock.hour = hr; ctx.clock.scale = 0;
      ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
      ctx.get('sky')?.setWeather?.(w, 0);
      if (p) p.freefly = true;
      if (fr.absY != null) { p?.teleport?.(fr.x, fr.z, 0); ctx.camera.position.set(fr.x, fr.absY, fr.z); }
      else p?.teleport?.(fr.x, fr.z, fr.h);
      p?.setLook?.(fr.yaw, fr.pitchRad ?? 0);
    }, fr, HOUR, wk);
    await sleep(2800);

    const un = await page.evaluate(UNIFORMS);
    const all = await page.evaluate(CUBE);
    await page.evaluate(PIN, ['uCirrus']);
    await sleep(1500);
    const noCir = await page.evaluate(CUBE);
    await page.evaluate(PIN, ['uCirrus', 'uCoverage']);
    await sleep(1500);
    const bare = await page.evaluate(CUBE);

    const veil = sub(all.up, noCir.up);
    const deck = sub(noCir.up, bare.up);
    console.log(`\n=== ${name}  ${wk}  ${HOUR}:00 ===`);
    console.log(`  uniforms ${JSON.stringify(un)}`);
    console.log(`  cube up  ALL   ${fmt(all.up)}  lum ${lum(all.up)}  hue ${hue(all.up)}  sat ${sat(all.up)}`);
    console.log(`  cube up  -veil ${fmt(noCir.up)}  lum ${lum(noCir.up)}  hue ${hue(noCir.up)}  sat ${sat(noCir.up)}`);
    console.log(`  cube up  bare  ${fmt(bare.up)}  lum ${lum(bare.up)}  hue ${hue(bare.up)}  sat ${sat(bare.up)}`);
    console.log(`  VEIL     ${fmt(veil)}  lum ${lum(veil)}  hue ${hue(veil)}  sat ${sat(veil)}` +
      `  share R ${(veil[0] / all.up[0] * 100).toFixed(1)}%  share lum ${(lum(veil) / lum(all.up) * 100).toFixed(1)}%`);
    console.log(`  DECK     ${fmt(deck)}  lum ${lum(deck)}  hue ${hue(deck)}  sat ${sat(deck)}` +
      `  share lum ${(lum(deck) / lum(all.up) * 100).toFixed(1)}%`);
    const names = ['el 0-20', 'el 20-45', 'el 45-90'];
    for (let i = 0; i < 3; i++) {
      const a = all.bands[i], n = noCir.bands[i];
      const v = sub(a, n);
      const w = a[3] || 1;
      console.log(`   ${names[i]}  all ${fmt([a[0] / w, a[1] / w, a[2] / w])} hue ${hue(a)}` +
        `   veil ${fmt([v[0] / w, v[1] / w, v[2] / w])} hue ${hue(v)} sat ${sat(v)}` +
        `  share ${(lum(v) / Math.max(lum(a), 1e-6) * 100).toFixed(0)}%`);
    }
  }
}

await browser.close();
vite?.kill();
process.exit(0);
