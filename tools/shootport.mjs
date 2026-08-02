#!/usr/bin/env node
/**
 * Visual QA capture harness.
 *
 * Drives the running game in real Chrome (Metal-backed ANGLE, not SwiftShader —
 * a software rasteriser would misrepresent every effect we are judging) and
 * writes PNGs to shots/. Every critic agent captures through this script so
 * that comparisons are apples-to-apples.
 *
 *   node tools/shoot.mjs                 # all shots
 *   node tools/shoot.mjs dawn redmtn     # named shots only
 *   node tools/shoot.mjs --tag before    # writes shots/before/<name>.png
 *   node tools/shoot.mjs --w 2560 --h 1440
 */
import { launch } from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = process.env.PORT || '5178';
const URL = `http://127.0.0.1:${PORT}/`;

/**
 * Canonical vantage points. Each exercises a different part of the art
 * direction, so a regression in one system shows up in at least one shot.
 * `cam` is [x, z, yawDeg, pitchDeg, heightAboveGround].
 */
export const SHOTS = {
  dawn:      { hour: 6.2,  weather: 'clear',    note: 'low sun over the ash wastes, long shadows, godrays' },
  redmtn:    { hour: 10.0, weather: 'cloudy',   note: 'Red Mountain silhouette, aerial perspective' },
  coast:     { hour: 17.6, weather: 'clear',    note: 'shoreline, water shading, foam, wet sand, sun glint' },
  night:     { hour: 23.4, weather: 'clear',    note: 'both moons, stars, night ambient, bioluminescence' },
  ashstorm:  { hour: 13.0, weather: 'ashstorm', note: 'signature weather — visibility, particulate, tint' },
  dusk:      { hour: 19.8, weather: 'clear',    note: 'sunset scattering, sky gradient, cloud silver lining' },
  vale:      { hour: 12.0, weather: 'clear',    note: 'sheltered vale — vegetation, ground detail, contact AO' },
  storm:     { hour: 15.0, weather: 'rain',     note: 'wet surfaces, rain, overcast lighting' },
  underwater:{ hour: 12.0, weather: 'clear',    note: 'underwater extinction + caustics' },
  ridge:     { hour: 8.4,  weather: 'clear',    note: 'high vantage — terrain LOD, erosion channels, silhouette' },
};

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const TAG = flag('tag', '');
const W = +flag('w', 1920), H = +flag('h', 1080);
const names = argv.filter((a) => !a.startsWith('--') && SHOTS[a]);
const wanted = names.length ? names : Object.keys(SHOTS);

async function serverUp() {
  try { const r = await fetch(URL, { signal: AbortSignal.timeout(800) }); return r.ok; } catch { return false; }
}

let vite = null;
if (!(await serverUp())) {
  vite = spawn('npx', ['vite', '--port', PORT, '--host', '127.0.0.1'], { cwd: process.cwd(), stdio: 'ignore', detached: false });
  for (let i = 0; i < 60 && !(await serverUp()); i++) await sleep(500);
  if (!(await serverUp())) { console.error('dev server did not come up'); process.exit(1); }
}

const outDir = `shots/${TAG}`.replace(/\/$/, '');
await mkdir(outDir, { recursive: true });

const browser = await launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    `--window-size=${W},${H}`,
    '--use-angle=metal',
    '--enable-unsafe-webgpu',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--disable-features=CalculateNativeWinOcclusion',
    '--hide-scrollbars',
    '--mute-audio',
    '--allow-file-access-from-files',
  ],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE ${m.text()}`); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });

// Boot is async (texture synthesis, erosion); wait for main.ts to publish the engine.
try {
  await page.waitForFunction('!!window.engine', { timeout: 120_000 });
} catch {
  const msg = await page.evaluate(() => document.getElementById('blabel')?.textContent ?? '');
  console.error(`BOOT FAILED: ${msg}`);
  errors.forEach((e) => console.error(e));
  await browser.close(); vite?.kill(); process.exit(2);
}

const renderer = await page.evaluate(() => {
  const gl = window.engine?.ctx?.renderer?.getContext?.();
  const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
  return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log(`GPU: ${renderer}`);
if (/swiftshader|software/i.test(renderer)) console.warn('WARNING: software rasteriser — screenshots are not representative');

// Resolve vantage points against the live heightfield (see tools/framing.mjs).
const framed = await page.evaluate(FRAMING_FN);
console.log(`peak ${JSON.stringify(framed.peak)}  heights ${JSON.stringify(framed.quantiles)}`);
for (const n of wanted) if (!framed.framing[n]) console.warn(`no vantage found for "${n}" — skipping`);

const results = [];
for (const name of wanted) {
  const fr = framed.framing[name];
  if (!fr) continue;
  const s = SHOTS[name];
  // A Vite HMR reload (an agent saving a file mid-capture) tears down the
  // engine. Re-await it each shot rather than crashing the whole run.
  await page.waitForFunction('!!window.engine', { timeout: 180_000 }).catch(() => {});
  await page.evaluate((s, fr) => {
    const ctx = window.engine.ctx;
    ctx.clock.hour = s.hour;
    ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.(s.weather, 0);
    const p = ctx.get('player');
    if (p) p.freefly = true;
    if (fr.absY != null) {
      // Underwater: an absolute Y, since "above the surface" is meaningless here.
      p?.teleport?.(fr.x, fr.z, 0);
      ctx.camera.position.set(fr.x, fr.absY, fr.z);
    } else {
      p?.teleport?.(fr.x, fr.z, fr.h);
    }
    p?.setLook?.(fr.yaw, (fr.pitch * Math.PI) / 180);
  }, s, fr);

  // Let TAA converge, weather blend settle, and streaming LOD resolve.
  await sleep(2600);

  const fps = await page.evaluate(async () => {
    let n = 0; const t0 = performance.now();
    await new Promise((res) => { const l = () => { if (++n < 40) requestAnimationFrame(l); else res(); }; requestAnimationFrame(l); });
    return Math.round((n * 1000) / (performance.now() - t0));
  });

  const buf = await page.screenshot({ type: 'png' });
  const file = `${outDir}/${name}.png`;
  await writeFile(file, buf);
  results.push({ name, file, fps, note: s.note, hour: s.hour, weather: s.weather, framing: fr });
  console.log(`${file}  ${fps}fps  @(${fr.x|0},${fr.z|0})  — ${s.note}`);
}

if (errors.length) {
  console.log('\n--- runtime errors ---');
  [...new Set(errors)].slice(0, 25).forEach((e) => console.log(e));
}

await writeFile(`${outDir}/manifest.json`, JSON.stringify({ gpu: renderer, w: W, h: H, peak: framed.peak, quantiles: framed.quantiles, results, errors: [...new Set(errors)].slice(0, 50) }, null, 2));
await browser.close();
vite?.kill();
console.log(`\n${results.length} shots -> ${outDir}/`);
