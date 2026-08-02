#!/usr/bin/env node
/**
 * LIGHTING PROBE — hue distribution per luminance decile, measured on the
 * PRE-GRADE buffer (RENDER_DEBUG.lut = false), plus a dump of what the
 * ambient/IBL term actually carries.
 *
 * This is the acceptance measurement for stage 2: a daylit scene with two
 * illuminants of different spectra puts its shadowed deciles in a different hue
 * family from its lit ones. One illuminant, or two that are scalar multiples of
 * each other, cannot.
 *
 *   node tools/_skyprobe.mjs [--tag name] [--lut] [--shots a,b]
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { Buffer } from 'node:buffer';
import { PNG } from 'pngjs';
import { FRAMING_FN } from './framing.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const TAG = arg('--tag', 'probe');
const LUT = argv.includes('--lut');
const SHOTS = arg('--shots', 'dawn,redmtn,vale,ridge,coast').split(',');

const PORT = 5209;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = `shots/_sky/${TAG}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Same framing/time the gate uses, so the numbers are comparable to it. */
const HOUR = Number(arg('--hour', '9.0'));

/* ------------------------------------------------------------- analysis */

function hueOf(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const c = mx - mn;
  if (c <= 0) return { h: -1, c: 0, mx };
  let h;
  if (mx === r) h = 60 * (((g - b) / c) % 6);
  else if (mx === g) h = 60 * ((b - r) / c + 2);
  else h = 60 * ((r - g) / c + 4);
  if (h < 0) h += 360;
  return { h, c, mx };
}

/**
 * Chroma threshold matches tools/gate.mjs palette(): c > 0.06 in 0..1 units.
 * "Warm" is hue 0-60, the band the colour owner measured as 92-100% occupied.
 */
const CHROMA_MIN = 0.06;

function deciles(png) {
  const d = png.data;
  const px = [];
  for (let k = 0; k < d.length; k += 4) {
    const r = d[k] / 255, g = d[k + 1] / 255, b = d[k + 2] / 255;
    px.push({ L: 0.2126 * r + 0.7152 * g + 0.0722 * b, r, g, b });
  }
  px.sort((a, b) => a.L - b.L);
  const rows = [];
  const N = px.length;
  for (let i = 0; i < 10; i++) {
    const lo = Math.floor((i * N) / 10);
    const hi = Math.floor(((i + 1) * N) / 10);
    let chroma = 0, warm = 0, satSum = 0;
    const bins = new Float64Array(12);
    let hs = 0, hc = 0;
    for (let j = lo; j < hi; j++) {
      const { r, g, b } = px[j];
      const { h, c, mx } = hueOf(r, g, b);
      satSum += mx > 0 ? c / mx : 0;
      if (c > CHROMA_MIN) {
        chroma++;
        bins[Math.floor(h / 30) % 12]++;
        if (h < 60) warm++;
        const a = (h * Math.PI) / 180;
        hs += Math.sin(a); hc += Math.cos(a);
      }
    }
    const n = hi - lo;
    let meanHue = Math.atan2(hs / Math.max(1, chroma), hc / Math.max(1, chroma)) * 180 / Math.PI;
    if (meanHue < 0) meanHue += 360;
    rows.push({
      decile: i,
      Lmid: +((px[lo].L + px[hi - 1].L) / 2).toFixed(4),
      chromaFrac: +(chroma / n).toFixed(3),
      warmFrac: chroma ? +(warm / chroma).toFixed(3) : 1,
      outsideWarm: chroma ? +(1 - warm / chroma).toFixed(3) : 0,
      meanHue: +meanHue.toFixed(1),
      meanSat: +(satSum / n).toFixed(3),
      bins: [...bins].map((v) => (chroma ? +(v / chroma).toFixed(3) : 0)),
    });
  }
  // Frame-wide roll-up over chroma-bearing pixels.
  let chroma = 0, warm = 0;
  for (const r of rows) {
    // recompute counts from fractions is lossy; do it directly
  }
  chroma = 0; warm = 0;
  for (let k = 0; k < d.length; k += 4) {
    const { h, c } = hueOf(d[k] / 255, d[k + 1] / 255, d[k + 2] / 255);
    if (c > CHROMA_MIN) { chroma++; if (h < 60) warm++; }
  }
  return {
    rows,
    frameChromaFrac: +(chroma / (d.length / 4)).toFixed(3),
    frameOutsideWarm: chroma ? +(1 - warm / chroma).toFixed(3) : 0,
    darkOutsideWarm: +((rows[0].outsideWarm + rows[1].outsideWarm + rows[2].outsideWarm) / 3).toFixed(3),
    brightOutsideWarm: +((rows[7].outsideWarm + rows[8].outsideWarm + rows[9].outsideWarm) / 3).toFixed(3),
  };
}

/* ------------------------------------------------------------------ run */

async function serverUp() {
  try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
}
let vite = null;
if (!(await serverUp())) {
  vite = spawn('npx', ['vite', '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'ignore' });
  for (let i = 0; i < 90 && !(await serverUp()); i++) await sleep(500);
}
if (!(await serverUp())) { console.error('vite failed to start'); process.exit(2); }
await mkdir(OUT, { recursive: true });

const browser = await launch({
  executablePath: CHROME, headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1600,900', '--mute-audio'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(2500);
const framed = await page.evaluate(FRAMING_FN);

await page.evaluate((useLut) => {
  const d = window.RENDER_DEBUG;
  if (d) d.lut = useLut;
}, LUT);

const out = { tag: TAG, lut: LUT, shots: {} };

for (const name of SHOTS) {
  const fr = framed.framing[name];
  if (!fr) { console.log(`  (no framing for ${name})`); continue; }
  await page.evaluate((fr, hr) => {
    const ctx = window.engine.ctx, p = ctx.get('player');
    ctx.clock.hour = hr; ctx.clock.scale = 0;
    ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.('clear', 0);
    if (p) p.freefly = true;
    if (fr.absY != null) { p?.teleport?.(fr.x, fr.z, 0); ctx.camera.position.set(fr.x, fr.absY, fr.z); }
    else p?.teleport?.(fr.x, fr.z, fr.h);
    p?.setLook?.(fr.yaw, fr.pitchRad ?? 0);
  }, fr, HOUR);
  await sleep(2800);

  const diag = await page.evaluate(() => {
    const ctx = window.engine.ctx;
    const sky = ctx.get('sky');
    const mats = ctx.get('materials');
    const w = sky.weather;
    const cf = (c) => [+c.r.toFixed(4), +c.g.toFixed(4), +c.b.toFixed(4)];
    const norm = (c) => {
      const m = Math.max(c.r, c.g, c.b, 1e-6);
      return [+(c.r / m).toFixed(3), +(c.g / m).toFixed(3), +(c.b / m).toFixed(3)];
    };
    const env = ctx.scene.environment;
    return {
      sunColor: cf(sky.sun.color),
      sunIntensity: +sky.sun.intensity.toFixed(4),
      sunRadiance: cf(w.sunColor),
      sunChroma: norm(w.sunColor),
      ambient: cf(w.ambient),
      ambChroma: norm(w.ambient),
      envIsMaterials: !!(mats && mats.env && env === mats.env),
      envUuid: env ? env.uuid : null,
      matsEnvUuid: mats && mats.env ? mats.env.uuid : null,
      envIntensity: ctx.scene.environmentIntensity,
      lights: ctx.scene.children.filter((o) => o.isLight)
        .map((l) => ({ type: l.type, color: cf(l.color), i: +l.intensity.toFixed(3) })),
    };
  });

  const png = PNG.sync.read(Buffer.from(await page.screenshot({ type: 'png' })));
  await writeFile(`${OUT}/${name}.png`, PNG.sync.write(png));
  const m = deciles(png);
  out.shots[name] = { diag, ...m };

  console.log(`\n--- ${name} (lut=${LUT}) ---`);
  console.log(`  sunChroma  ${JSON.stringify(diag.sunChroma)}   ambChroma ${JSON.stringify(diag.ambChroma)}`);
  console.log(`  ambient    ${JSON.stringify(diag.ambient)}   env=${diag.envIsMaterials ? 'MATERIALS synth dome' : 'sky PMREM/other'}`);
  console.log(`  lights     ${JSON.stringify(diag.lights)}`);
  console.log('  dec  Lmid    chroma%  outside-hue0-60  meanHue  meanSat');
  for (const r of m.rows) {
    console.log(`   ${r.decile}   ${r.Lmid.toFixed(3)}   ${(r.chromaFrac * 100).toFixed(1).padStart(5)}%   ` +
      `${(r.outsideWarm * 100).toFixed(1).padStart(6)}%          ${r.meanHue.toFixed(0).padStart(3)}     ${r.meanSat}`);
  }
  console.log(`  FRAME outside hue0-60: ${(m.frameOutsideWarm * 100).toFixed(1)}%  ` +
    `(dark deciles ${(m.darkOutsideWarm * 100).toFixed(1)}%, bright ${(m.brightOutsideWarm * 100).toFixed(1)}%)`);
}

await writeFile(`${OUT}/probe.json`, JSON.stringify(out, null, 2));
console.log(`\nwrote ${OUT}/probe.json`);
await browser.close();
vite?.kill();
process.exit(0);
