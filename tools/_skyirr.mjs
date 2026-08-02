#!/usr/bin/env node
/**
 * Ground truth for the sky's own irradiance.
 *
 * Reads back the SkyViewPass table — the dome's radiance as a function of
 * direction, with no solar disc, no aureole, no moons and no stars in it — and
 * integrates it against a cosine lobe. That number is what an upward-facing
 * surface in shadow is actually lit by, and its CHROMA is what decides whether
 * this scene has two illuminants or one.
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';

const PORT = 5209;
const URL = `http://127.0.0.1:${PORT}/`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = (process.argv[2] ?? 'vale,ridge,coast').split(',');
const WEATHER = process.argv[3] ?? 'clear';
const HOUR = Number(process.argv[4] ?? 9.0);

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
  const rt = sky.skyView.rt;
  const W = rt.width, H = rt.height;
  const buf = new Uint16Array(W * H * 4);
  ctx.renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
  const f = (h) => THREE.DataUtils.fromHalfFloat(h);
  const f2 = f;

  const PI = Math.PI;
  // Cosine-weighted hemisphere integrals, upper and lower, plus a coarse
  // elevation profile so the shape of the dome is visible and not just its mean.
  const up3 = [0, 0, 0], dn3 = [0, 0, 0];
  const bands = [];
  for (let i = 0; i < 9; i++) bands.push({ el: i * 10, n: 0, r: 0, g: 0, b: 0 });
  const dAz = (2 * PI) / W;
  const dEv = 2 / H;
  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / H;
    const ev = v * 2 - 1;
    const el = Math.sign(ev) * ev * ev * (PI / 2);
    const dEl = PI * Math.abs(ev) * dEv;           // d(el)/d(ev) * dEv
    const sinEl = Math.sin(el), cosEl = Math.cos(el);
    const w = Math.abs(sinEl) * cosEl * dEl * dAz; // |cos theta| * dOmega
    for (let i = 0; i < W; i++) {
      const k = (j * W + i) * 4;
      const r = f(buf[k]), g = f(buf[k + 1]), b = f(buf[k + 2]);
      const t = el >= 0 ? up3 : dn3;
      t[0] += r * w; t[1] += g * w; t[2] += b * w;
      if (el >= 0) {
        const bi = Math.min(8, Math.floor((el * 180) / PI / 10));
        const bd = bands[bi];
        bd.n++; bd.r += r; bd.g += g; bd.b += b;
      }
    }
  }
  const chroma = (c) => {
    const m = Math.max(c[0], c[1], c[2], 1e-9);
    return [+(c[0] / m).toFixed(3), +(c[1] / m).toFixed(3), +(c[2] / m).toFixed(3)];
  };
  const hue = (c) => {
    const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), d = mx - mn;
    if (d <= 0) return -1;
    let h;
    if (mx === c[0]) h = 60 * (((c[1] - c[2]) / d) % 6);
    else if (mx === c[1]) h = 60 * ((c[2] - c[0]) / d + 2);
    else h = 60 * ((c[0] - c[1]) / d + 4);
    return +(h < 0 ? h + 360 : h).toFixed(1);
  };
  // ---- and now the ENVIRONMENT CUBE, which is what surfaces are actually lit
  // by. Same cosine integral, over the six faces this time. Differences between
  // this and the table above are the things the table leaves out: the cloud deck
  // and the ground disc.
  const cube = sky.cubeRT;
  const cs = cube.width;
  const cbuf = new Uint16Array(cs * cs * 4);
  const faceDir = (f, u, v) => {
    // three/WebGL cube face convention: +X,-X,+Y,-Y,+Z,-Z with the usual flips.
    const a = 2 * u - 1, b = 1 - 2 * v;
    switch (f) {
      case 0: return [1, b, -a];
      case 1: return [-1, b, a];
      case 2: return [a, 1, -b];
      case 3: return [a, -1, b];
      case 4: return [a, b, 1];
      default: return [-a, b, -1];
    }
  };
  const cUp = [0, 0, 0], cDn = [0, 0, 0];
  for (let f = 0; f < 6; f++) {
    ctx.renderer.readRenderTargetPixels(cube, 0, 0, cs, cs, cbuf, f);
    for (let j = 0; j < cs; j++) {
      for (let i = 0; i < cs; i++) {
        const u = (i + 0.5) / cs, v = (j + 0.5) / cs;
        const d = faceDir(f, u, v);
        const len = Math.hypot(d[0], d[1], d[2]);
        // Solid angle of a cube texel: (2/N)^2 / len^3 in the [-1,1] face param.
        const dOm = ((2 / cs) * (2 / cs)) / (len * len * len);
        const ny = d[1] / len;
        const k = (j * cs + i) * 4;
        const r = f2(cbuf[k]), g = f2(cbuf[k + 1]), b = f2(cbuf[k + 2]);
        const t = ny >= 0 ? cUp : cDn;
        const w2 = Math.abs(ny) * dOm;
        t[0] += r * w2; t[1] += g * w2; t[2] += b * w2;
      }
    }
  }

  const w = sky.weather;
  const sun = [w.sunColor.r, w.sunColor.g, w.sunColor.b];
  return {
    skyIrradiance: up3.map((x) => +x.toFixed(4)),
    skyChroma: chroma(up3), skyHue: hue(up3),
    groundIrradiance: dn3.map((x) => +x.toFixed(4)),
    groundChroma: chroma(dn3), groundHue: hue(dn3),
    sunRadiance: sun.map((x) => +x.toFixed(4)), sunChroma: chroma(sun), sunHue: hue(sun),
    cubeUp: cUp.map((x) => +x.toFixed(4)), cubeUpChroma: chroma(cUp), cubeUpHue: hue(cUp),
    cubeDn: cDn.map((x) => +x.toFixed(4)), cubeDnChroma: chroma(cDn), cubeDnHue: hue(cDn),
    ambient: [w.ambient.r, w.ambient.g, w.ambient.b].map((x) => +x.toFixed(4)),
    ambHue: hue([w.ambient.r, w.ambient.g, w.ambient.b]),
    bands: bands.map((b) => ({
      el: b.el,
      L: [+(b.r / b.n).toFixed(4), +(b.g / b.n).toFixed(4), +(b.b / b.n).toFixed(4)],
      hue: hue([b.r / b.n, b.g / b.n, b.b / b.n]),
    })),
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
  const m = await page.evaluate(MEASURE);
  console.log(`\n=== ${name} (${WEATHER}, ${HOUR.toFixed(2)}h) ===`);
  console.log(`  SUN   radiance ${JSON.stringify(m.sunRadiance)} chroma ${JSON.stringify(m.sunChroma)} hue ${m.sunHue}`);
  console.log(`  SKY   irradiance ${JSON.stringify(m.skyIrradiance)} chroma ${JSON.stringify(m.skyChroma)} hue ${m.skyHue}`);
  console.log(`  GRND  irradiance ${JSON.stringify(m.groundIrradiance)} chroma ${JSON.stringify(m.groundChroma)} hue ${m.groundHue}`);
  console.log(`  CUBE  up ${JSON.stringify(m.cubeUp)} chroma ${JSON.stringify(m.cubeUpChroma)} hue ${m.cubeUpHue}`);
  console.log(`  CUBE  dn ${JSON.stringify(m.cubeDn)} chroma ${JSON.stringify(m.cubeDnChroma)} hue ${m.cubeDnHue}`);
  console.log(`  amb   ${JSON.stringify(m.ambient)} hue ${m.ambHue}`);
  console.log('  elevation band  mean radiance                 hue');
  for (const b of m.bands) {
    console.log(`   ${String(b.el).padStart(2)}-${String(b.el + 10).padStart(2)} deg   ${JSON.stringify(b.L).padEnd(28)} ${b.hue}`);
  }
}

await browser.close();
vite?.kill();
process.exit(0);
