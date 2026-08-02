// Interleaved before/after A/B for the terrain subsystem.
//
// Two frozen snapshots of the tree are served side by side; the harness opens
// one tab on each and alternates between them, bringing the measured one to the
// front so the other's rAF is throttled. Every reported number is a *paired*
// difference taken inside one alternation, so the machine drift that a shared
// M3 produces over a run — tens of milliseconds while other capture harnesses
// come and go — cancels instead of being reported as a result.
//
//   OLD_PORT=5179 NEW_PORT=5180 node tools/diagterra4.mjs
import { launch } from 'puppeteer-core';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';

const OLD = `http://127.0.0.1:${process.env.OLD_PORT || '5179'}/`;
const NEW = `http://127.0.0.1:${process.env.NEW_PORT || '5180'}/`;
const W = 1920, H = 1080;
const REPS = +(process.env.REPS || 6);
const FRAMES = +(process.env.FRAMES || 45);

const b = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: [`--window-size=${W},${H}`, '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});

async function open(url) {
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log(`PAGEERROR[${url}]:`, e.message));
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('!!window.engine', { timeout: 240000 });
  return p;
}
const pOld = await open(OLD);
const pNew = await open(NEW);
const framed = await pOld.evaluate(FRAMING_FN);
const SHOTS = { dawn: [6.2, 'clear'], redmtn: [10, 'cloudy'], vale: [12, 'clear'], ridge: [8.4, 'clear'] };

const ms = async (p) => p.evaluate(async (nf) => {
  let n = 0; const t0 = performance.now();
  await new Promise((r) => { const l = () => { if (++n < nf) requestAnimationFrame(l); else r(); }; requestAnimationFrame(l); });
  return (performance.now() - t0) / n;
}, FRAMES);
const setVis = (p, v) => p.evaluate((v) => {
  window.engine.ctx.scene.traverse((o) => { if (o.name === 'terrain') o.visible = v; });
}, v);
const stats = (p) => p.evaluate(() => {
  const t = window.engine.ctx.get('terrain');
  const q = t && t.qt;
  const g = t && t.geo;
  const vis = q && q.count !== undefined ? q.count : (g ? g.instanceCount : -1);
  const tot = q && q.total !== undefined ? q.total : vis;
  return { nodes: `${vis}/${tot}`, tris: vis * 32 * 32 * 2 };
});
// Minimum, not median.
//
// The machine is shared with three or four other capture harnesses and the
// interference is bursty on a sub-second scale, which is faster than any
// pairing can cancel — a run of this took frame times from 56 ms to 194 ms on
// the same build. Contention can only ever *add* time, so the smallest sample
// out of many short ones is the estimate of the uncontended cost, and it is the
// only statistic here that is stable across runs. Medians are printed beside it
// so the spread is visible rather than hidden.
const mn = (a) => Math.min(...a);
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
async function measure(p, vis) {
  await p.bringToFront();
  await setVis(p, vis);
  await sleep(200);
  return ms(p);
}

const totals = { old: 0, neu: 0 };
for (const name of Object.keys(SHOTS)) {
  const fr = framed.framing[name]; if (!fr) continue;
  const [hour, w] = SHOTS[name];
  for (const p of [pOld, pNew]) {
    await p.bringToFront();
    await p.evaluate((fr, hour, w) => {
      const ctx = window.engine.ctx; ctx.clock.hour = hour; ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
      ctx.get('sky')?.setWeather?.(w, 0);
      const pl = ctx.get('player'); if (pl) pl.freefly = true;
      pl?.teleport?.(fr.x, fr.z, fr.h); pl?.setLook?.(fr.yaw, (fr.pitch * Math.PI) / 180);
    }, fr, hour, w);
    await sleep(2200);
  }
  const fOld = [], fNew = [], hOld = [], hNew = [];
  for (let k = 0; k < REPS; k++) {
    fOld.push(await measure(pOld, true));
    hOld.push(await measure(pOld, false));
    fNew.push(await measure(pNew, true));
    hNew.push(await measure(pNew, false));
  }
  await setVis(pOld, true); await setVis(pNew, true);
  const sOld = await stats(pOld), sNew = await stats(pNew);
  const tOld = mn(fOld) - mn(hOld), tNew = mn(fNew) - mn(hNew);
  totals.old += tOld; totals.neu += tNew;
  console.log(`${name.padEnd(7)} TERRAIN ms  old ${tOld.toFixed(2)}  new ${tNew.toFixed(2)}    `
    + `frame(min) ${mn(fOld).toFixed(1)} -> ${mn(fNew).toFixed(1)}   no-terrain(min) ${mn(hOld).toFixed(1)} / ${mn(hNew).toFixed(1)}   `
    + `frame(med) ${med(fOld).toFixed(1)} -> ${med(fNew).toFixed(1)}   nodes ${sOld.nodes} -> ${sNew.nodes}`);
}
console.log(`TOTAL terrain ms across 4 shots: old ${totals.old.toFixed(2)}  new ${totals.neu.toFixed(2)}  (${(100 * (1 - totals.neu / totals.old)).toFixed(0)}% cut)`);
await b.close();
