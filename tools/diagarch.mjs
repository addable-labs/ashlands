/**
 * A/B isolation harness for the arch + actors subsystems.
 *
 * Other agents profile on the same machine, so absolute frame time drifts by
 * 2x within a single run. Every configuration is therefore measured in short
 * INTERLEAVED blocks and reduced by median, which cancels the drift; and draw
 * calls are accumulated with info.autoReset off so multi-pass frames are
 * counted whole (prepass + cascades + scene), not just the last pass.
 *
 *   node tools/diagarch.mjs [shot ...] [--reps 7]
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';

const SHOTS = {
  dawn: { hour: 6.2, weather: 'clear' },
  redmtn: { hour: 10.0, weather: 'cloudy' },
  coast: { hour: 17.6, weather: 'clear' },
  night: { hour: 23.4, weather: 'clear' },
  ashstorm: { hour: 13.0, weather: 'ashstorm' },
  dusk: { hour: 19.8, weather: 'clear' },
  vale: { hour: 12.0, weather: 'clear' },
  storm: { hour: 15.0, weather: 'rain' },
  underwater: { hour: 12.0, weather: 'clear' },
  ridge: { hour: 8.4, weather: 'clear' },
};

const URL = 'http://127.0.0.1:5178/';
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const REPS = +flag('reps', 7);
const wanted = argv.filter((a) => !a.startsWith('--') && SHOTS[a]);
const shots = wanted.length ? wanted : ['dawn', 'redmtn', 'vale', 'ridge'];

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) { vite = spawn('npx', ['vite', '--port', '5178', '--host', '127.0.0.1'], { stdio: 'ignore' }); for (let i = 0; i < 60 && !(await up()); i++) await sleep(500); }

const b = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--window-size=1920,1080', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--hide-scrollbars', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.engine', { timeout: 300000 });
const framed = await p.evaluate(FRAMING_FN);

const INSTALL = () => {
  const R = () => window.engine.ctx.renderer;
  window.__ab = {
    set(name, v) { const o = window.engine.ctx.scene.getObjectByName(name); if (o) o.visible = v; return !!o; },
    /** One timed block. Returns ms/frame plus draw calls and triangles per frame. */
    async block(frames = 34) {
      const r = R();
      await new Promise((res) => { let n = 0; const l = () => { if (++n < 8) requestAnimationFrame(l); else res(); }; requestAnimationFrame(l); });
      r.info.autoReset = false;
      r.info.reset();
      let n = 0;
      const t0 = performance.now();
      await new Promise((res) => { const l = () => { if (++n < frames) requestAnimationFrame(l); else res(); }; requestAnimationFrame(l); });
      const dt = performance.now() - t0;
      const calls = r.info.render.calls / n;
      const tris = r.info.render.triangles / n;
      r.info.autoReset = true;
      return { ms: dt / n, calls, tris };
    },
    census(name) {
      const c = window.engine.ctx.camera;
      const scene = window.engine.ctx.scene;
      const root = scene.getObjectByName(name);
      if (!root) return null;
      scene.updateMatrixWorld(true);
      const m = c.projectionMatrix.clone().multiply(c.matrixWorldInverse);
      const me = m.elements;
      const mk = (a, b2, cc, d) => { const l = Math.hypot(a, b2, cc); return [a / l, b2 / l, cc / l, d / l]; };
      const planes = [
        mk(me[3] - me[0], me[7] - me[4], me[11] - me[8], me[15] - me[12]),
        mk(me[3] + me[0], me[7] + me[4], me[11] + me[8], me[15] + me[12]),
        mk(me[3] + me[1], me[7] + me[5], me[11] + me[9], me[15] + me[13]),
        mk(me[3] - me[1], me[7] - me[5], me[11] - me[9], me[15] - me[13]),
        mk(me[3] - me[2], me[7] - me[6], me[11] - me[10], me[15] - me[14]),
        mk(me[3] + me[2], me[7] + me[6], me[11] + me[10], me[15] + me[14]),
      ];
      const inF = (cx, cy, cz, r) => planes.every((pl) => pl[0] * cx + pl[1] * cy + pl[2] * cz + pl[3] > -r);
      let meshes = 0, tris = 0, visMeshes = 0, visTris = 0, casters = 0, visCasters = 0, instanced = 0;
      const seen = [];
      root.traverseVisible((o) => {
        if (!(o.isMesh || o.isInstancedMesh || o.isSkinnedMesh)) return;
        const g = o.geometry; if (!g) return;
        if (!g.boundingSphere) g.computeBoundingSphere();
        const cnt = o.isInstancedMesh ? o.count : 1;
        const t = ((g.index ? g.index.count : g.attributes.position.count) / 3) * cnt;
        meshes++; tris += t;
        if (o.isInstancedMesh) instanced++;
        if (o.castShadow) casters++;
        const bs = o.isInstancedMesh && o.boundingSphere ? o.boundingSphere : g.boundingSphere;
        const wc = bs.center.clone().applyMatrix4(o.matrixWorld);
        const e = o.matrixWorld.elements;
        const sc = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
        const r = bs.radius * sc;
        if (o.frustumCulled === false || inF(wc.x, wc.y, wc.z, r)) {
          visMeshes++; visTris += t; if (o.castShadow) visCasters++;
          seen.push({ n: o.name || o.type, t: Math.round(t), i: cnt, d: Math.round(wc.distanceTo(c.position)) });
        }
      });
      seen.sort((a, b2) => b2.t - a.t);
      return { meshes, tris: Math.round(tris), visMeshes, visTris: Math.round(visTris), casters, visCasters, instanced, top: seen.slice(0, 12) };
    },
  };
  window.__abFrame = (s, fr) => {
    const ctx = window.engine.ctx;
    ctx.clock.hour = s.hour;
    ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.(s.weather, 0);
    const pl = ctx.get('player'); if (pl) pl.freefly = true;
    if (fr.absY != null) { pl?.teleport?.(fr.x, fr.z, 0); ctx.camera.position.set(fr.x, fr.absY, fr.z); }
    else pl?.teleport?.(fr.x, fr.z, fr.h);
    pl?.setLook?.(fr.yaw, (fr.pitch * Math.PI) / 180);
  };
};

let cur = null;
async function ev(fn, ...args) {
  for (let i = 0; ; i++) {
    try {
      await p.waitForFunction('!!window.engine', { timeout: 300000 });
      if (await p.evaluate(() => !window.__ab)) {
        await p.evaluate(INSTALL);
        if (cur) { await p.evaluate((s, fr) => window.__abFrame(s, fr), cur.s, cur.fr); await sleep(2600); }
      }
      return await p.evaluate(fn, ...args);
    } catch (e) {
      if (i >= 4) throw e;
      console.log(`  (retry: ${String(e.message).slice(0, 60)})`);
      await sleep(4000);
    }
  }
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[(s.length / 2) | 0]; };

const CONFIGS = [
  ['base', [true, true]],
  ['noArch', [false, true]],
  ['noAct', [true, false]],
  ['noBoth', [false, false]],
];

const out = {};
for (const name of shots) {
  const fr = framed.framing[name];
  if (!fr) continue;
  const s = SHOTS[name];
  cur = { s, fr };
  await ev((s, fr) => window.__abFrame(s, fr), s, fr);
  await sleep(2600);

  const cArch = await ev(() => window.__ab.census('architecture'));
  const cAct = await ev(() => window.__ab.census('actors'));
  const stats = await ev(() => { const a = window.engine.ctx.get('actors'); return a && a.stats ? { ...a.stats } : null; });

  const samples = { base: [], noArch: [], noAct: [], noBoth: [] };
  const calls = {};
  for (let k = 0; k < REPS; k++) {
    for (const [key, [ar, ac]] of CONFIGS) {
      const r = await ev((ar, ac) => {
        window.__ab.set('architecture', ar);
        window.__ab.set('actors', ac);
        return window.__ab.block();
      }, ar, ac);
      samples[key].push(r.ms);
      if (!calls[key]) calls[key] = r;
    }
  }
  await ev(() => { window.__ab.set('architecture', true); window.__ab.set('actors', true); });

  const m = Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, med(v)]));
  out[name] = { ms: m, calls, arch: cArch, act: cAct, actStats: stats, samples };
  console.log(`\n=== ${name} ===`);
  console.log(`  median ms/frame  base ${m.base.toFixed(1)}  noArch ${m.noArch.toFixed(1)}  noAct ${m.noAct.toFixed(1)}  noBoth ${m.noBoth.toFixed(1)}`);
  console.log(`  attributable     arch ${(m.base - m.noArch).toFixed(1)}ms   actors ${(m.base - m.noAct).toFixed(1)}ms   both ${(m.base - m.noBoth).toFixed(1)}ms`);
  console.log(`  draws/frame      base ${calls.base.calls.toFixed(0)}  noArch ${calls.noArch.calls.toFixed(0)}  noAct ${calls.noAct.calls.toFixed(0)}   tris/frame ${(calls.base.tris / 1000).toFixed(0)}k`);
  console.log(`  arch  ${JSON.stringify({ ...cArch, top: undefined })}`);
  console.log(`  arch top ${JSON.stringify(cArch?.top)}`);
  console.log(`  act   ${JSON.stringify({ ...cAct, top: undefined })}`);
  console.log(`  actStats ${JSON.stringify(stats)}`);
}
console.log('\nJSON ' + JSON.stringify(out));
await b.close(); vite?.kill();
