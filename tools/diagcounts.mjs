/**
 * Load-independent before/after: draw calls, drawn meshes, shadow casters and
 * triangles attributable to arch and actors.
 *
 * Frame time on this machine is unusable for attribution while three other
 * agents are profiling on it — base frame time moved 55 -> 240 ms inside one
 * hour. Draw calls and drawn geometry do not move with load at all, they are
 * exactly what was cut, and the whole point of cutting them is the frame time,
 * so they are reported as the primary evidence.
 *
 * Counts are accumulated with info.autoReset off so a frame is counted whole:
 * depth prepass + every shadow cascade that redraws + the scene pass.
 *
 *   node tools/diagcounts.mjs --url ... --root <snapshotdir> --dir <variants>
 */
import { launch } from 'puppeteer-core';
import { copyFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';

const SHOTS = {
  dawn: { hour: 6.2, weather: 'clear' },
  redmtn: { hour: 10.0, weather: 'cloudy' },
  vale: { hour: 12.0, weather: 'clear' },
  ridge: { hour: 8.4, weather: 'clear' },
};
const FILES = [
  ['Species.ts', 'src/actors/Species.ts'],
  ['ActorMaterials.ts', 'src/actors/ActorMaterials.ts'],
  ['Actors.ts', 'src/actors/Actors.ts'],
  ['Architecture.ts', 'src/arch/Architecture.ts'],
  ['ArchMaterial.ts', 'src/arch/ArchMaterial.ts'],
];
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const URL = flag('url', 'http://127.0.0.1:5178/');
const ROOT = flag('root', '.');
const DIR = flag('dir', '');

const b = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--window-size=1920,1080', '--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.engine', { timeout: 600000 });
const framed = await p.evaluate(FRAMING_FN);

const INSTALL = () => {
  window.__c = {
    set(n, v) { const o = window.engine.ctx.scene.getObjectByName(n); if (o) o.visible = v; },
    async draws(frames = 20) {
      const r = window.engine.ctx.renderer;
      await new Promise((res) => { let n = 0; const l = () => { if (++n < 6) requestAnimationFrame(l); else res(); }; requestAnimationFrame(l); });
      r.info.autoReset = false; r.info.reset();
      let n = 0;
      await new Promise((res) => { const l = () => { if (++n < frames) requestAnimationFrame(l); else res(); }; requestAnimationFrame(l); });
      const o = { calls: r.info.render.calls / n, tris: r.info.render.triangles / n };
      r.info.autoReset = true;
      return o;
    },
    counts() {
      const scene = window.engine.ctx.scene;
      const cam = window.engine.ctx.camera;
      scene.updateMatrixWorld(true);
      const m = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
      const e = m.elements;
      const mk = (a, b2, c, d) => { const l = Math.hypot(a, b2, c); return [a / l, b2 / l, c / l, d / l]; };
      const pl = [
        mk(e[3] - e[0], e[7] - e[4], e[11] - e[8], e[15] - e[12]),
        mk(e[3] + e[0], e[7] + e[4], e[11] + e[8], e[15] + e[12]),
        mk(e[3] + e[1], e[7] + e[5], e[11] + e[9], e[15] + e[13]),
        mk(e[3] - e[1], e[7] - e[5], e[11] - e[9], e[15] - e[13]),
        mk(e[3] - e[2], e[7] - e[6], e[11] - e[10], e[15] - e[14]),
        mk(e[3] + e[2], e[7] + e[6], e[11] + e[10], e[15] + e[14]),
      ];
      const inF = (x, y, z, r) => pl.every((q) => q[0] * x + q[1] * y + q[2] * z + q[3] > -r);
      const out = {};
      for (const g of ['architecture', 'actors']) {
        const root = scene.getObjectByName(g);
        let meshes = 0, groups = 0, tris = 0, casters = 0;
        let vMeshes = 0, vGroups = 0, vTris = 0;
        root?.traverseVisible((o) => {
          if (!(o.isMesh || o.isInstancedMesh || o.isSkinnedMesh)) return;
          const geo = o.geometry; if (!geo) return;
          if (!geo.boundingSphere) geo.computeBoundingSphere();
          const cnt = o.isInstancedMesh ? o.count : 1;
          const t = ((geo.index ? geo.index.count : geo.attributes.position.count) / 3) * cnt;
          const gr = Math.max(1, geo.groups.length);
          meshes++; groups += gr; tris += t;
          if (o.castShadow) casters++;
          const bs = o.isInstancedMesh && o.boundingSphere ? o.boundingSphere : geo.boundingSphere;
          const wc = bs.center.clone().applyMatrix4(o.matrixWorld);
          const me = o.matrixWorld.elements;
          const sc = Math.max(Math.hypot(me[0], me[1], me[2]), Math.hypot(me[4], me[5], me[6]), Math.hypot(me[8], me[9], me[10]));
          if (o.frustumCulled === false || inF(wc.x, wc.y, wc.z, bs.radius * sc)) { vMeshes++; vGroups += gr; vTris += t; }
        });
        out[g] = { meshes, groups, tris: Math.round(tris), casters, vMeshes, vGroups, vTris: Math.round(vTris) };
      }
      const a = window.engine.ctx.get('actors');
      out.actStats = a && a.stats ? { ...a.stats } : null;
      let pointLights = 0;
      scene.traverse((o) => { if (o.isPointLight && o.visible) pointLights++; });
      out.pointLights = pointLights;
      return out;
    },
  };
  window.__cFrame = (s, fr) => {
    const ctx = window.engine.ctx;
    ctx.clock.hour = s.hour;
    ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.(s.weather, 0);
    const pl = ctx.get('player'); if (pl) pl.freefly = true;
    pl?.teleport?.(fr.x, fr.z, fr.h);
    pl?.setLook?.(fr.yaw, (fr.pitch * Math.PI) / 180);
  };
};

async function ev(fn, ...args) {
  for (let i = 0; ; i++) {
    try {
      await p.waitForFunction('!!window.engine', { timeout: 600000 });
      if (await p.evaluate(() => !window.__c)) await p.evaluate(INSTALL);
      return await p.evaluate(fn, ...args);
    } catch (e) { if (i >= 5) throw e; await sleep(4000); }
  }
}

const res = {};
for (const variant of ['before', 'after']) {
  for (const [name, dest] of FILES) await copyFile(`${DIR}/${variant}/${name}`, `${ROOT}/${dest}`);
  await sleep(3500);
  await p.waitForFunction('!!window.engine', { timeout: 600000 });
  await p.evaluate(INSTALL);
  await sleep(2500);
  res[variant] = {};
  for (const name of Object.keys(SHOTS)) {
    const fr = framed.framing[name];
    if (!fr) continue;
    await ev((s, fr) => window.__cFrame(s, fr), SHOTS[name], fr);
    await sleep(2600);
    const all = await ev(() => window.__c.draws());
    await ev(() => window.__c.set('architecture', false));
    const noArch = await ev(() => window.__c.draws());
    await ev(() => { window.__c.set('architecture', true); window.__c.set('actors', false); });
    const noAct = await ev(() => window.__c.draws());
    await ev(() => window.__c.set('actors', true));
    await sleep(800);
    const counts = await ev(() => window.__c.counts());
    res[variant][name] = {
      calls: Math.round(all.calls),
      archCalls: Math.round(all.calls - noArch.calls),
      actCalls: Math.round(all.calls - noAct.calls),
      tris: Math.round(all.tris),
      counts,
    };
    const r = res[variant][name];
    console.log(`${variant}/${name}: draws ${r.calls} (arch ${r.archCalls}, actors ${r.actCalls})  ` +
      `arch drawn ${counts.architecture.vGroups}g/${counts.architecture.meshes}m/${counts.architecture.casters}c  ` +
      `act drawn ${counts.actors.vGroups}g/${counts.actors.meshes}m/${counts.actors.casters}c  ` +
      `stats ${JSON.stringify(counts.actStats)}  pointLights ${counts.pointLights}`);
  }
}
console.log('\nRESULT ' + JSON.stringify(res));
await b.close();
