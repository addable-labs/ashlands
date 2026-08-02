/**
 * Back-to-back before/after A/B for the arch + actors subsystems.
 *
 * Swaps the five owned source files between a pristine "before" copy and the
 * optimised "after" copy inside ONE browser session, alternating rounds, and
 * reduces every configuration by median. Other agents are optimising the same
 * build on the same machine, so absolute frame time drifts by more than 2x
 * within an hour; alternating and taking medians is the only way a difference
 * this size survives that.
 *
 *   node tools/diagab.mjs --dir <scratchpad> [--rounds 2] [--blocks 4]
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { copyFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';

const ALL_SHOTS = {
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
// Point this at a private snapshot of the repo: other agents edit shared files
// mid-run, and every edit reloads the page and restarts a two-minute boot.
const URL = flag('url', 'http://127.0.0.1:5178/');
const ROOT = flag('root', '.');
const DIR = flag('dir', '');
const PICK = (flag('shots', '') || Object.keys(ALL_SHOTS).join(',')).split(',');
const SHOTS = Object.fromEntries(Object.entries(ALL_SHOTS).filter(([k]) => PICK.includes(k)));
const ROUNDS = +flag('rounds', 2);
const BLOCKS = +flag('blocks', 4);
if (!DIR) { console.error('--dir required'); process.exit(1); }

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) { console.error(`no dev server at ${URL}`); process.exit(1); }

const b = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--window-size=1920,1080', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--hide-scrollbars', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.engine', { timeout: 600000 });
const framed = await p.evaluate(FRAMING_FN);

const INSTALL = () => {
  window.__ab = {
    set(name, v) { const o = window.engine.ctx.scene.getObjectByName(name); if (o) o.visible = v; },
    async block(frames = 34) {
      const r = window.engine.ctx.renderer;
      await new Promise((res) => { let n = 0; const l = () => { if (++n < 8) requestAnimationFrame(l); else res(); }; requestAnimationFrame(l); });
      r.info.autoReset = false; r.info.reset();
      let n = 0; const t0 = performance.now();
      await new Promise((res) => { const l = () => { if (++n < frames) requestAnimationFrame(l); else res(); }; requestAnimationFrame(l); });
      const dt = performance.now() - t0;
      const out = { ms: dt / n, calls: r.info.render.calls / n, tris: r.info.render.triangles / n };
      r.info.autoReset = true;
      return out;
    },
    counts() {
      const scene = window.engine.ctx.scene;
      const o = {};
      for (const g of ['architecture', 'actors']) {
        const root = scene.getObjectByName(g);
        let meshes = 0, tris = 0, casters = 0;
        root?.traverseVisible((x) => {
          if (!(x.isMesh || x.isInstancedMesh || x.isSkinnedMesh)) return;
          const geo = x.geometry; if (!geo) return;
          const cnt = x.isInstancedMesh ? x.count : 1;
          meshes++;
          tris += ((geo.index ? geo.index.count : geo.attributes.position.count) / 3) * cnt;
          if (x.castShadow) casters++;
        });
        o[g] = { meshes, tris: Math.round(tris), casters };
      }
      const a = window.engine.ctx.get('actors');
      o.actStats = a && a.stats ? { ...a.stats } : null;
      return o;
    },
  };
  window.__abFrame = (s, fr) => {
    const ctx = window.engine.ctx;
    ctx.clock.hour = s.hour;
    ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.(s.weather, 0);
    const pl = ctx.get('player'); if (pl) pl.freefly = true;
    pl?.teleport?.(fr.x, fr.z, fr.h);
    pl?.setLook?.(fr.yaw, (fr.pitch * Math.PI) / 180);
  };
};

let cur = null;
async function ev(fn, ...args) {
  for (let i = 0; ; i++) {
    try {
      await p.waitForFunction('!!window.engine', { timeout: 600000 });
      if (await p.evaluate(() => !window.__ab)) {
        await p.evaluate(INSTALL);
        if (cur) { await p.evaluate((s, fr) => window.__abFrame(s, fr), cur.s, cur.fr); await sleep(2600); }
      }
      return await p.evaluate(fn, ...args);
    } catch (e) {
      if (i >= 5) throw e;
      await sleep(4000);
    }
  }
}

async function swap(variant) {
  for (const [name, dest] of FILES) await copyFile(`${DIR}/${variant}/${name}`, `${ROOT}/${dest}`);
  // The page reloads under HMR; boot is async and slow (texture synthesis).
  await sleep(3000);
  cur = null;
  await p.waitForFunction('!!window.engine', { timeout: 600000 });
  await p.evaluate(INSTALL);
  await sleep(2000);
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[(s.length / 2) | 0] : NaN; };
/**
 * Median of PAIRED differences, not the difference of medians.
 *
 * Frame time here drifts by a factor of two inside a single run because three
 * other agents are profiling on the same GPU. Differencing two medians taken
 * minutes apart measures that drift; differencing the two blocks that ran
 * back-to-back within one repetition cancels it, and the median over
 * repetitions then throws away the reps that caught a hitch.
 */
const pairedMed = (a, b2) => { const d = []; for (let i = 0; i < Math.min(a.length, b2.length); i++) d.push(a[i] - b2[i]); return med(d); };
const acc = {};   // acc[variant][shot][cfg] = [ms...]
const info = {};  // info[variant][shot] = { calls..., counts }

for (let round = 0; round < ROUNDS; round++) {
  for (const variant of ['before', 'after']) {
    console.log(`\n### round ${round} :: ${variant} — swapping files, waiting for reboot`);
    await swap(variant);
    acc[variant] ??= {};
    info[variant] ??= {};
    for (const name of Object.keys(SHOTS)) {
      const fr = framed.framing[name];
      if (!fr) continue;
      cur = { s: SHOTS[name], fr };
      await ev((s, fr) => window.__abFrame(s, fr), SHOTS[name], fr);
      await sleep(2600);
      acc[variant][name] ??= { base: [], noArch: [], noAct: [] };
      for (let k = 0; k < BLOCKS; k++) {
        for (const [cfg, ar, ac] of [['base', true, true], ['noArch', false, true], ['noAct', true, false]]) {
          const r = await ev((ar, ac) => {
            window.__ab.set('architecture', ar);
            window.__ab.set('actors', ac);
            return window.__ab.block();
          }, ar, ac);
          acc[variant][name][cfg].push(r.ms);
          if (cfg === 'base' && k === 0) info[variant][name] = { calls: Math.round(r.calls), tris: Math.round(r.tris) };
          if (cfg === 'noArch' && k === 0) info[variant][name].callsNoArch = Math.round(r.calls);
          if (cfg === 'noAct' && k === 0) info[variant][name].callsNoAct = Math.round(r.calls);
        }
      }
      await ev(() => { window.__ab.set('architecture', true); window.__ab.set('actors', true); });
      const c = await ev(() => window.__ab.counts());
      info[variant][name].counts = c;
      const m = acc[variant][name];
      process.stdout.write(''); console.log(`  ${variant}/${name}: base ${med(m.base).toFixed(1)}  arch ${(med(m.base) - med(m.noArch)).toFixed(1)}ms  act ${(med(m.base) - med(m.noAct)).toFixed(1)}ms  draws ${info[variant][name].calls}`);
    }
  }
}

console.log('\n================ SUMMARY (medians over interleaved blocks) ================');
for (const name of Object.keys(SHOTS)) {
  const B = acc.before?.[name], A = acc.after?.[name];
  if (!B || !A) continue;
  const bb = med(B.base), ba = med(A.base);
  const archB = pairedMed(B.base, B.noArch), archA = pairedMed(A.base, A.noArch);
  const actB = pairedMed(B.base, B.noAct), actA = pairedMed(A.base, A.noAct);
  const iB = info.before[name], iA = info.after[name];
  console.log(`\n${name}`);
  console.log(`  frame ms      before ${bb.toFixed(1)}   after ${ba.toFixed(1)}`);
  console.log(`  arch ms       before ${archB.toFixed(1)}   after ${archA.toFixed(1)}`);
  console.log(`  actors ms     before ${actB.toFixed(1)}   after ${actA.toFixed(1)}`);
  console.log(`  draws/frame   before ${iB.calls} (arch ${iB.calls - iB.callsNoArch}, act ${iB.calls - iB.callsNoAct})   after ${iA.calls} (arch ${iA.calls - iA.callsNoArch}, act ${iA.calls - iA.callsNoAct})`);
  console.log(`  arch meshes   before ${iB.counts.architecture.meshes}/${iB.counts.architecture.casters}c   after ${iA.counts.architecture.meshes}/${iA.counts.architecture.casters}c`);
  console.log(`  act meshes    before ${iB.counts.actors.meshes}/${iB.counts.actors.casters}c ${JSON.stringify(iB.counts.actStats)}   after ${iA.counts.actors.meshes}/${iA.counts.actors.casters}c ${JSON.stringify(iA.counts.actStats)}`);
}
console.log('\nRAW ' + JSON.stringify({ acc, info }));
await b.close(); vite?.kill();
