#!/usr/bin/env node
/**
 * Leak / degradation probe.
 *
 * The player reports the game becoming progressively sluggish while simply
 * walking around — a few steps, a stall, a few more steps, worsening over time.
 * That is not a framerate ceiling (which would be steady); it is unbounded
 * growth. This walks the character continuously and samples everything that can
 * grow without bound, so the culprit shows up as a rising line rather than a
 * guess.
 */
import { launch } from 'puppeteer-core';
import { spawn, execSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 5202;
const URL = `http://127.0.0.1:${PORT}/`;
const MINUTES = Number(process.argv[2] ?? 6);
const EVERY = 15_000;

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
execSync('npx vite build --outDir dist-leak --emptyOutDir', { stdio: 'ignore' });
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-leak', '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'ignore' });
for (let i = 0; i < 90 && !(await up()); i++) await sleep(500);
await mkdir('shots/leak', { recursive: true });

const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1280,720', '--mute-audio', '--js-flags=--expose-gc'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(3000);

// Walk continuously, as a player exploring would.
await page.evaluate(() => {
  const ctx = window.engine.ctx, p = ctx.get('player');
  p.freefly = false;
  ctx.input.pointerLocked = true;
  // Drive the real input path so every system sees a moving player.
  const held = ctx.input.held;
  held.add('KeyW');
  window.__turn = setInterval(() => {
    const r = ctx.get('player');
    r.setLook((r.yaw ?? 0) + 0.18, -0.03);   // wander so new terrain streams in
  }, 1500);
});

const sample = () => page.evaluate(() => {
  const ctx = window.engine.ctx, r = ctx.renderer, info = r.info;
  let meshes = 0, objects = 0, points = 0;
  ctx.scene.traverse((o) => { objects++; if (o.isMesh) meshes++; if (o.isPoints) points++; });
  const m = performance.memory;
  return {
    t: +(ctx.time.elapsed).toFixed(1),
    fps: 0,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    programs: r.info.programs?.length ?? -1,
    calls: info.render.calls,
    triangles: info.render.triangles,
    objects, meshes, points,
    // Distinct geometries actually resident, as opposed to three's cumulative
    // first-render counter, which only converges upward during warm-up.
    distinctGeo: (() => { const set = new Set();
      ctx.scene.traverse((o) => { if (o.geometry) set.add(o.geometry.uuid); }); return set.size; })(),
    actors: ctx.get('actors')?.all?.().length ?? -1,
    heapMB: m ? +(m.usedJSHeapSize / 1048576).toFixed(1) : -1,
    listeners: ctx.bus?._n ?? -1,
  };
});

const fps = () => page.evaluate(async () => {
  const dts = []; let last = performance.now();
  await new Promise((res) => {
    const loop = () => { const n = performance.now(); dts.push(n - last); last = n;
      if (dts.length < 60) requestAnimationFrame(loop); else res(); };
    requestAnimationFrame(loop);
  });
  dts.sort((a, b) => a - b);
  return +(1000 / dts[dts.length >> 1]).toFixed(1);
});

const rows = [];
console.log('  t(s)   fps   heapMB  geom  tex  prog  objs  mesh  pts  actors  calls   tris');
const steps = Math.round((MINUTES * 60_000) / EVERY);
for (let i = 0; i < steps; i++) {
  const s = await sample();
  s.fps = await fps();
  rows.push(s);
  console.log(`  ${String(Math.round(s.t)).padStart(5)} ${String(s.fps).padStart(6)} ${String(s.heapMB).padStart(8)}` +
    ` ${String(s.geometries).padStart(5)} ${String(s.textures).padStart(4)} ${String(s.programs).padStart(5)}` +
    ` ${String(s.objects).padStart(5)} ${String(s.meshes).padStart(5)} ${String(s.points).padStart(4)}` +
    ` ${String(s.actors).padStart(7)} ${String(s.calls).padStart(6)} ${String(s.triangles).padStart(7)}`);
  await sleep(EVERY - 1200);
}

await page.evaluate(() => { clearInterval(window.__turn); window.engine.ctx.input.held.delete('KeyW'); });

console.log('\n=== GROWTH (first -> last) ===');
// Skip the warm-up: the first samples are still first-rendering resident assets.
const a = rows[Math.min(4, rows.length - 1)], b = rows[rows.length - 1];
const grew = [];
for (const k of ['fps', 'heapMB', 'geometries', 'distinctGeo', 'textures', 'programs', 'objects', 'meshes', 'points', 'actors', 'calls', 'triangles']) {
  if (a[k] < 0 || b[k] < 0) continue;
  const d = b[k] - a[k];
  const pct = a[k] !== 0 ? (d / a[k]) * 100 : 0;
  const bad = k === 'fps' ? pct < -20 : pct > 25 && Math.abs(d) > 4;
  if (bad) grew.push(`${k}: ${a[k]} -> ${b[k]} (${pct > 0 ? '+' : ''}${pct.toFixed(0)}%)`);
  console.log(`  ${k.padEnd(11)} ${String(a[k]).padStart(9)} -> ${String(b[k]).padStart(9)}  ${pct > 0 ? '+' : ''}${pct.toFixed(0)}%${bad ? '   <== UNBOUNDED' : ''}`);
}
console.log(grew.length ? `\n  LEAK SUSPECTS: ${grew.join(' | ')}` : '\n  nothing grew without bound');
await writeFile('shots/leak/leak.json', JSON.stringify(rows, null, 2));
await browser.close();
server.kill();
