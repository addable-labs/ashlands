/**
 * Actor probe: reproduces one canonical shot and dumps every actor with its
 * screen-space rect, LOD tier and species. Read-only diagnostic.
 *   node tools/_actorprobe.mjs dusk
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';
const SHOTS = {
  dawn:      { hour: 6.2,  weather: 'clear',  relight: true },
  dusk:      { hour: 19.8, weather: 'clear' },
  coast:     { hour: 17.6, weather: 'clear',  relight: true },
};

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://127.0.0.1:5178/';
const name = process.argv[2] ?? 'dusk';
const W = 1920, H = 1080;

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) { vite = spawn('npx', ['vite', '--port', '5178', '--host', '127.0.0.1'], { stdio: 'ignore' }); for (let i = 0; i < 60 && !(await up()); i++) await sleep(500); }

const b = await launch({
  executablePath: CHROME, headless: 'new',
  args: [`--window-size=${W},${H}`, '--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.waitForFunction('!!window.engine', { timeout: 180000 });
const framed = await p.evaluate(FRAMING_FN);
const fr = framed.framing[name];
const s = SHOTS[name];
await p.evaluate((s, fr) => {
  const ctx = window.engine.ctx;
  ctx.clock.hour = s.hour;
  ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
  ctx.get('sky')?.setWeather?.(s.weather, 0);
  const pl = ctx.get('player');
  if (pl) pl.freefly = true;
  if (fr.absY != null) { pl?.teleport?.(fr.x, fr.z, 0); ctx.camera.position.set(fr.x, fr.absY, fr.z); }
  else pl?.teleport?.(fr.x, fr.z, fr.h);
  pl?.setLook?.(fr.yaw, fr.pitchRad != null ? fr.pitchRad : (fr.pitch * Math.PI) / 180);
}, s, fr);
await sleep(3000);

await p.evaluate(async () => { let n = 0; await new Promise((res) => { const l = () => { if (++n < 240) requestAnimationFrame(l); else res(); }; requestAnimationFrame(l); }); });
const live = await p.evaluate(async () => {
  const ctx = window.engine.ctx;
  const acts = ctx.get('actors');
  const snap = () => ({ t: ctx.time.elapsed, dt: ctx.time.dt, d0: acts.sorted[0]?.d, camx: ctx.camera.position.x, n: acts.sorted.length, ready: acts.ready, terrain: !!acts.terrain, sense: !!acts.sense });
  const a = snap();
  await new Promise((r) => setTimeout(r, 1200));
  const b = snap();
  return { a, b };
});
console.log('LIVE', JSON.stringify(live));

const out = await p.evaluate(() => {
  const ctx = window.engine.ctx;
  const acts = ctx.get('actors');
  const cam = ctx.camera;
  cam.updateMatrixWorld();
  const V3 = cam.position.constructor;
  const rows = [];
  const list = acts.all();
  const sky = ctx.get('sky');
  const sd = sky?.sun ? sky.sun.position.clone().sub(sky.sun.target.position).normalize() : null;
  for (const a of list) {
    const g = a.root;
    const box = { min: new V3(1e9, 1e9, 1e9), max: new V3(-1e9, -1e9, -1e9) };
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      const geo = o.geometry;
      if (!geo || !geo.boundingBox) return;
      const bb = geo.boundingBox;
      for (let i = 0; i < 8; i++) {
        const v = new V3(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
        v.applyMatrix4(o.matrixWorld);
        box.min.min(v); box.max.max(v);
      }
    });
    if (box.min.x > 1e8) continue;
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9, anyIn = false;
    const v = new V3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      v.project(cam);
      if (v.z > 1) continue;
      anyIn = true;
      const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (0.5 - v.y * 0.5) * innerHeight;
      minx = Math.min(minx, sx); maxx = Math.max(maxx, sx);
      miny = Math.min(miny, sy); maxy = Math.max(maxy, sy);
    }
    if (!anyIn) continue;
    if (maxx < -50 || minx > innerWidth + 50 || maxy < -50 || miny > innerHeight + 50) continue;
    rows.push({
      kind: a.kind, lod: a.lod, scale: +(a.scale ?? 1).toFixed(2),
      d: +cam.position.distanceTo(a.position).toFixed(1),
      rect: [minx | 0, miny | 0, maxx | 0, maxy | 0],
      px: (maxy - miny) | 0,
      pos: [a.position.x.toFixed(1), a.position.y.toFixed(1), a.position.z.toFixed(1)],
    });
  }
  rows.sort((a, b) => a.d - b.d);
  const assets = [];
  for (const [k, v] of acts.assets) {
    const bb = v.geo.boundingBox;
    assets.push({ kind: k, impostorSize: +v.impostorSize.toFixed(3), centreY: +v.impostorCentreY.toFixed(2),
      bbox: [bb.min.x.toFixed(2), bb.min.y.toFixed(2), bb.min.z.toFixed(2), bb.max.x.toFixed(2), bb.max.y.toFixed(2), bb.max.z.toFixed(2)] });
  }
  const pw = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, ctx.size ? ctx.size.h : innerHeight);
  let A = null;
  ctx.scene.traverse((o) => {
    if (A) return;
    const m = o.material;
    if (m && m.uniforms && m.uniforms.uAerialSkyColor) A = m.uniforms;
  });
  const dump = A ? {
    sky: A.uAerialSkyColor.value.toArray().map((n) => +n.toFixed(4)),
    sun: A.uAerialSunColor.value.toArray().map((n) => +n.toFixed(4)),
    dir: A.uAerialSunDir.value.toArray().map((n) => +n.toFixed(3)),
    haze: A.uAerialHazeDensity.value,
  } : null;
  const bounce = acts.bounce ? acts.bounce.toArray().map((n) => +n.toFixed(4)) : null;
  const sortedDump = acts.sorted.map((e) => ({ kind: e.a.kind, d: +e.d.toFixed(1), px: +e.px.toFixed(1), lod: e.a.lod, vis: e.a.mesh.visible }));
  rows.forEach((r) => { const A = assets.find((x) => x.kind === r.kind); if (A) r.lodPx = +(A.impostorSize * r.scale / (r.d * pw)).toFixed(1); });
  return { aerial: dump, bounce, env: !!ctx.scene.environment, envInt: ctx.scene.environmentIntensity, sortedDump, pixelWorld: (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, ctx.size ? ctx.size.h : innerHeight), fov: cam.fov, sizeH: ctx.size ? ctx.size.h : -1, assets, stats: { ...acts.stats }, sun: sd ? [sd.x.toFixed(2), sd.y.toFixed(2), sd.z.toFixed(2)] : null, cam: [cam.position.x | 0, cam.position.y | 0, cam.position.z | 0], rows };
});
await (await import('node:fs/promises')).writeFile(process.env.PROBE_OUT ?? '/tmp/actorprobe.json', JSON.stringify(out, null, 1));
await (await import('node:fs/promises')).writeFile((process.env.PROBE_OUT ?? '/tmp/actorprobe.json').replace(/\.json$/, '.png'), await p.screenshot({ type: 'png' }));
console.log('wrote', process.env.PROBE_OUT ?? '/tmp/actorprobe.json', out.rows.length, 'rows');
await b.close(); vite?.kill();
