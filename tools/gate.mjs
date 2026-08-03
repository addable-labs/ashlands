#!/usr/bin/env node
/**
 * REGRESSION GATE.
 *
 * Every defect this project fixed and then silently reintroduced is here as an
 * automated check. The critic loop was a random walk because nine agents edited
 * nine directories against a shared visual output with no acceptance test:
 * each fixed its own findings and unknowingly broke something an earlier round
 * had fixed. Critics only see the current frame, so a regression reads as a new
 * defect, gets "fixed" again, and something else breaks. Score went down over
 * ten rounds.
 *
 * This turns "looks worse" into a number that fails loudly.
 *
 *   node tools/gate.mjs                 # run every check
 *   node tools/gate.mjs --baseline      # record current values as the baseline
 *   node tools/gate.mjs --quick         # image checks only, skip e2e/bench
 *
 * Exit code 0 = pass, 1 = regression. Intended to run after EVERY change round.
 */
import { launch } from 'puppeteer-core';
import { spawn, execSync } from 'node:child_process';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import { Buffer } from 'node:buffer';
import { FRAMING_FN } from './framing.mjs';

const PORT = 5201;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = 'shots/gate';
const BASELINE = 'tools/gate-baseline.json';
const argv = process.argv.slice(2);
const RECORD = argv.includes('--baseline');
const QUICK = argv.includes('--quick');
const SHOTS = ['dawn', 'redmtn', 'vale', 'ridge', 'coast'];

const results = [];
const record = (name, ok, value, detail) => {
  results.push({ name, ok, value, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(28)} ${detail}`);
};

/* ------------------------------------------------------------ image helpers */

const lumaOf = (png) => {
  const { width: w, height: h, data: d } = png;
  const L = new Float32Array(w * h);
  for (let i = 0, k = 0; i < L.length; i++, k += 4) {
    L[i] = 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
  }
  return { w, h, L };
};

/**
 * A fog wall is a horizontal edge that is UNIFORM across the whole frame width.
 * A real horizon is also a strong edge, but its strength varies along x because
 * terrain silhouettes vary. So: find the row with the strongest mean vertical
 * gradient, then measure how consistent that gradient is across x. High mean +
 * low relative spread = an artificial wall.
 */
function fogWall({ w, h, L }) {
  let worst = { row: -1, mean: 0, cv: 1 };
  for (let y = Math.floor(h * 0.15); y < Math.floor(h * 0.85); y++) {
    let sum = 0;
    const diffs = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      const dv = Math.abs(L[(y + 1) * w + x] - L[y * w + x]);
      diffs[x] = dv; sum += dv;
    }
    const mean = sum / w;
    if (mean < 3) continue;                       // too weak to be a wall
    let v = 0;
    for (let x = 0; x < w; x++) v += (diffs[x] - mean) ** 2;
    const cv = Math.sqrt(v / w) / mean;           // coefficient of variation
    // Uniform (low cv) AND strong (high mean) is the signature.
    if (cv < worst.cv && mean > worst.mean * 0.6) worst = { row: y, mean, cv };
  }
  return worst;
}

/**
 * A chunk seam is ONE ISOLATED line, not merely a high-contrast one.
 *
 * The first version of this scored `mean|local vertical extremum| x fraction of
 * columns that are extrema` and thresholded it absolutely. That is a near-Nyquist
 * contrast statistic: textured ground scores on it by construction, the value
 * rises monotonically as more ground fills the frame, and the "worst" row sat
 * within 4% of the sixth-best. It produced four false positives and MISSED the
 * one shot with a genuinely isolated line. Corrected to measure isolation —
 * how far the strongest line stands above the bulk of the frame's own rows.
 */
function seam({ w, h, L }) {
  const scan = (len, span, at) => {
    const scores = new Float64Array(len);
    for (let i = 2; i < len - 2; i++) {
      let sum = 0, n = 0;
      for (let j = 0; j < span; j += 2) {
        const a = at(i - 1, j), b = at(i, j), c = at(i + 1, j);
        // A thin line: centre differs from both neighbours in the SAME direction.
        const d1 = b - a, d2 = b - c;
        if (d1 * d2 > 0) { sum += Math.min(Math.abs(d1), Math.abs(d2)); n++; }
      }
      scores[i] = (sum / Math.max(1, n)) * (n / (span / 2));
    }
    const sorted = [...scores].filter((v) => v > 0).sort((a, b) => a - b);
    const p90 = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : 1;
    let idx = -1, raw = 0;
    for (let i = 0; i < len; i++) if (scores[i] > raw) { raw = scores[i]; idx = i; }
    // Isolation: a real boundary towers over its own frame's rows. Broadband
    // ground texture sits at 1.2-1.5.
    //
    // Divide by a FLOORED p90. On a smooth frame (ridge's p90 is 0.50 against
    // 0.87-0.94 elsewhere) the ratio explodes on noise: two runs of an identical
    // build measured 3.73 and 4.17. The floor keeps a weak line in a smooth
    // frame from reading as a strong seam.
    const denom = Math.max(p90, 0.8);
    return { idx, raw, isolation: denom > 0 ? raw / denom : 0 };
  };
  const rows = scan(h, w, (y, x) => L[y * w + x]);
  const cols = scan(w, h, (x, y) => L[y * w + x]);
  return rows.isolation >= cols.isolation ? { axis: 'row', ...rows } : { axis: 'col', ...cols };
}

/**
 * Screen-locked periodic pattern (halftone / moire / screen door). High-pass the
 * image, fold by (coord % N) and compare per-phase RMS. A screen-locked lattice
 * shows a symmetric modulation; real detail does not.
 */
function phaseFold({ w, h, L }, N) {
  const hp = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      hp[i] = L[i] - 0.25 * (L[i - 1] + L[i + 1] + L[i - w] + L[i + w]);
    }
  }
  const best = { n: 0, mod: 0 };
  for (let n = N[0]; n <= N[1]; n++) {
    const acc = new Float64Array(n), cnt = new Float64Array(n);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = x % n; acc[p] += hp[y * w + x] ** 2; cnt[p]++;
      }
    }
    const rms = [...acc].map((s, i) => Math.sqrt(s / Math.max(1, cnt[i])));
    const mx = Math.max(...rms), mn = Math.min(...rms);
    const mod = mx > 0 ? (mx - mn) / mx : 0;
    if (mod > best.mod) { best.mod = mod; best.n = n; }
  }
  return best;
}

/** Palette: how concentrated is chroma in hue, and how much range is there? */
function palette(png) {
  const d = png.data;
  const bins = new Float64Array(12);
  let sat = 0, n = 0, chromaN = 0;
  const lums = [];
  for (let k = 0; k < d.length; k += 16) {
    const r = d[k] / 255, g = d[k + 1] / 255, b = d[k + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
    lums.push(0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]);
    sat += mx > 0 ? c / mx : 0; n++;
    if (c > 0.06) {
      let hdeg;
      if (mx === r) hdeg = 60 * (((g - b) / c) % 6);
      else if (mx === g) hdeg = 60 * ((b - r) / c + 2);
      else hdeg = 60 * ((r - g) / c + 4);
      if (hdeg < 0) hdeg += 360;
      bins[Math.floor(hdeg / 30) % 12] += 1; chromaN++;
    }
  }
  lums.sort((a, b) => a - b);
  const q = (f) => lums[Math.min(lums.length - 1, Math.floor(f * lums.length))];
  // Sum the best CONTIGUOUS pair of bins, not the best two anywhere. Summing the
  // top two regardless of position scores genuine bimodal separation (rock at
  // hue 20, sky at hue 220) identically to a monochrome wash — which is exactly
  // what it did after the atmosphere fix put a 181-degree rotation in the sky.
  let top2 = 0;
  for (let i = 0; i < 12; i++) top2 = Math.max(top2, bins[i] + bins[(i + 1) % 12]);
  // How many bins carry a meaningful share at all: a second, separated hue
  // family should be visible here even when one family dominates by area.
  const totalC = bins.reduce((a, b) => a + b, 0) || 1;
  const liveBins = bins.filter((b) => b / totalC >= 0.05).length;
  return {
    hueConcentration: chromaN ? +(top2 / chromaN).toFixed(3) : 1,   // 1.0 = single-hue wash
    hueFamilies: liveBins,
    meanSat: +(sat / n).toFixed(3),
    p1: Math.round(q(0.01)), p50: Math.round(q(0.5)), p99: Math.round(q(0.99)),
    stops: +(Math.log2(Math.max(1, q(0.99)) / Math.max(1, q(0.01)))).toFixed(2),
  };
}

const meanAbsDiff = (a, b) => {
  let s = 0, n = 0;
  for (let k = 0; k < a.data.length; k += 16) {
    s += Math.abs(a.data[k] - b.data[k]) + Math.abs(a.data[k + 1] - b.data[k + 1]) + Math.abs(a.data[k + 2] - b.data[k + 2]);
    n += 3;
  }
  return +(s / n).toFixed(3);
};

/* --------------------------------------------------------------- run */

console.log('building static snapshot...');
execSync('npx vite build --outDir dist-gate --emptyOutDir', { stdio: 'ignore' });
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-gate', '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'ignore' });
const up = async () => { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } };
for (let i = 0; i < 90 && !(await up()); i++) await sleep(500);
if (!(await up())) { console.error('preview server failed'); process.exit(2); }
await mkdir(OUT, { recursive: true });

const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1600,900', '--mute-audio'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(2500);
const framed = await page.evaluate(FRAMING_FN);

const place = async (name) => {
  const fr = framed.framing[name];
  if (!fr) return false;
  await page.evaluate((fr, hr) => {
    const ctx = window.engine.ctx, p = ctx.get('player');
    ctx.clock.hour = hr; ctx.clock.scale = 0;
    // Cloud motion is driven from ctx.time.elapsed (Atmosphere.ts uTime), which
    // is wall-clock since boot — and boot varies by seconds. That made the coast
    // frame non-reproducible: its single patch of cool sky drifts behind the
    // deck, and the palette check read 2.2 / 0.0 / 4.3% across three captures of
    // an IDENTICAL build. Pin it so the settle below lands on the same phase
    // every run; a flaky check produces false regressions forever.
    ctx.time.elapsed = 1000;
    // Pick an hour that puts the sun ~75 degrees off the view axis, the way
    // shoot.mjs does. The gate previously hardcoded 09:00 for every shot, which
    // left coast — aimed at the open sea — staring within 20 degrees of the sun:
    // its sky is then forward-scattered warm edge to edge and there is genuinely
    // no second hue family in the scene to measure. That is a framing artefact,
    // not a rendering defect.
    if (hr < 20) {
      const sky = ctx.get('sky');
      const fwd = new (ctx.camera.position.constructor)();
      ctx.camera.getWorldDirection(fwd);
      const viewAz = Math.atan2(fwd.x, fwd.z);
      const elevAt = (h) => {
        ctx.clock.hour = h; sky?.update?.(ctx);
        const sd = sky.sun.position.clone().sub(sky.sun.target.position).normalize();
        return Math.asin(Math.max(-1, Math.min(1, sd.y)));
      };
      // Hold the nominal hour's elevation band, exactly as shoot.mjs does — see the
      // ELEV_BAND comment there. Optimising azimuth alone lets a 7am rake outscore
      // the 9am key this gate is supposed to hold fixed, which silently changes what
      // every downstream metric is measuring.
      const elevNominal = elevAt(hr);
      const score = (h) => {
        const elev = elevAt(h);
        if (elev < 0.12) return -1;
        if (Math.abs(elev - elevNominal) > 0.15) return -1;
        const sd = sky.sun.position.clone().sub(sky.sun.target.position).normalize();
        let d = Math.abs(Math.atan2(sd.x, sd.z) - viewAz);
        if (d > Math.PI) d = 2 * Math.PI - d;
        return 1 - Math.abs(d - 1.31) / Math.PI;
      };
      let best = hr, bs = score(hr);
      for (let h = 7; h <= 18; h += 0.25) { const v = score(h); if (v > bs) { bs = v; best = h; } }
      ctx.clock.hour = best; sky?.update?.(ctx);
    }
    ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.('clear', 0);
    if (p) p.freefly = true;
    if (fr.absY != null) { p?.teleport?.(fr.x, fr.z, 0); ctx.camera.position.set(fr.x, fr.absY, fr.z); }
    else p?.teleport?.(fr.x, fr.z, fr.h);
    p?.setLook?.(fr.yaw, fr.pitchRad ?? 0);
  }, fr, name === 'night' ? 23.4 : 9.0);
  await sleep(2600);
  return true;
};
const grab = async () => PNG.sync.read(Buffer.from(await page.screenshot({ type: 'png' })));

console.log('\n=== IMAGE CHECKS ===');
const metrics = {};
for (const name of SHOTS) {
  if (!(await place(name))) continue;
  const png = await grab();
  await writeFile(`${OUT}/${name}.png`, PNG.sync.write(png));
  const lum = lumaOf(png);

  const fw = fogWall(lum);
  const sm = seam(lum);
  const mo = phaseFold(lum, [2, 8]);
  const pal = palette(png);
  metrics[name] = { fogWallCv: +fw.cv.toFixed(3), fogWallMean: +fw.mean.toFixed(2),
    seamIsolation: +sm.isolation.toFixed(3), moire: +mo.mod.toFixed(3), moireN: mo.n, ...pal };

  // A wall is uniform (cv < 0.45) AND strong (mean > 6).
  record(`${name}: no fog wall`, !(fw.cv < 0.45 && fw.mean > 6), fw.cv,
    `edge uniformity cv=${fw.cv.toFixed(2)} strength=${fw.mean.toFixed(1)} @row ${fw.row}`);
  record(`${name}: no chunk seam`, !(sm.isolation >= 3.0 && sm.raw >= 2.0), sm.isolation,
    `isolation ${sm.isolation.toFixed(2)}x, strength ${sm.raw.toFixed(2)} on ${sm.axis} ${sm.idx}` +
    ` (fails only if isolation>=3.0 AND strength>=2.0)`);
  record(`${name}: no moire/screen-door`, mo.mod < 0.09, mo.mod,
    `phase modulation ${(mo.mod * 100).toFixed(1)}% at period ${mo.n}px`);
  record(`${name}: frame not blank`, pal.stops > 1.2, pal.stops,
    `dynamic range ${pal.stops} stops (p1=${pal.p1} p50=${pal.p50} p99=${pal.p99})`);
  // Either a spread of hue, or at least two separated families, counts as not
  // being a single-hue wash.
  // KNOWN OPEN: `coast` fails this legitimately, not from a rendering defect.
  // That vantage sits at sea level looking out over open water; the sea mirrors
  // the sky and the ground is warm basalt, so the scene contains one hue source
  // at any hour — verified after adding sun re-angling, which fixed the other
  // four. Resolving it needs an art-direction decision about what the canonical
  // coast shot should frame, so it is left RED rather than silenced.
  record(`${name}: palette not single-hue`, pal.hueConcentration < 0.85 || pal.hueFamilies >= 3,
    pal.hueConcentration,
    `${(pal.hueConcentration * 100).toFixed(0)}% in the dominant adjacent pair, ` +
    `${pal.hueFamilies} hue families >=5%, meanSat ${pal.meanSat}`);
}

// Shadows and AO must demonstrably affect the image, not merely be "enabled".
console.log('\n=== LIGHTING A/B ===');
await place('dawn');
const base = await grab();
const toggle = async (fn) => { await page.evaluate(fn); await sleep(1600); const p = await grab(); await page.evaluate(fn); await sleep(1200); return p; };
const noAO = await toggle(() => { const d = window.RENDER_DEBUG; if (d) d.ao = !d.ao; });
const aoDelta = meanAbsDiff(base, noAO);
record('AO visibly affects frame', aoDelta > 1.2, aoDelta, `mean |delta| ${aoDelta}/255 when AO toggled`);

const noShadow = await toggle(() => {
  const s = window.engine.ctx.get('sky');
  const l = s?.sun; if (l) l.castShadow = !l.castShadow;
});
const shDelta = meanAbsDiff(base, noShadow);
record('cast shadows visibly present', shDelta > 2.0, shDelta, `mean |delta| ${shDelta}/255 when shadows toggled`);

record('no page errors', pageErrors.length === 0, pageErrors.length,
  pageErrors.length ? pageErrors[0].slice(0, 80) : 'none');

await browser.close();
server.kill();

/* ---------------------------------------------------- external checks */
if (!QUICK) {
  console.log('\n=== BUILD / GAMEPLAY / TERRAIN ===');
  const run = (cmd) => { try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return (e.stdout ?? '') + (e.stderr ?? ''); } };

  const tsc = run('npx tsc --noEmit 2>&1 || true');
  const errs = (tsc.match(/error TS/g) ?? []).length;
  record('typecheck clean', errs === 0, errs, `${errs} type errors`);

  const e2e = run('node tools/e2e.mjs 2>&1 || true');
  const m = e2e.match(/(\d+) pass, (\d+) partial, (\d+) fail/);
  const pass = m ? +m[1] : 0, fail = m ? +m[3] : 99;
  record('gameplay e2e', fail === 0 && pass >= 15, pass, m ? m[0] : 'could not parse e2e output');

  const d7 = run('node tools/diag7.mjs 2>&1 || true');
  const peaks = [...d7.matchAll(/([\d.]+)\s*m\s+([\d.]+)/g)]
    .map(([, m_, v]) => ({ m: +m_, v: +v }))
    .filter((p) => [2.0, 7.75, 15.75, 23.5].some((g) => Math.abs(p.m - g) < 0.4) && p.v > 0.12);
  record('no terrain grid lattice', peaks.length === 0, peaks.length,
    peaks.length ? `peak at ${peaks[0].m}m = ${peaks[0].v}` : 'no autocorrelation peak at a grid multiple');
}

/* ---------------------------------------------------- baseline compare */
const snapshot = { when: new Date().toISOString(), metrics,
  checks: Object.fromEntries(results.map((r) => [r.name, r.value])) };

if (RECORD) {
  await writeFile(BASELINE, JSON.stringify(snapshot, null, 2));
  console.log(`\nbaseline recorded -> ${BASELINE}`);
} else if (existsSync(BASELINE)) {
  const prev = JSON.parse(await readFile(BASELINE, 'utf8'));
  console.log('\n=== VS BASELINE ===');
  const worse = [];
  // Lower is better for these; higher is better for the rest.
  const lowerBetter = /moire|seamIsolation|fogWallCv|hueConcentration/;
  for (const [shot, cur] of Object.entries(metrics)) {
    const old = prev.metrics?.[shot]; if (!old) continue;
    for (const [k, v] of Object.entries(cur)) {
      if (typeof v !== 'number' || old[k] == null) continue;
      const d = v - old[k];
      const bad = lowerBetter.test(k) ? d > Math.max(0.02, Math.abs(old[k]) * 0.15)
                                      : d < -Math.max(0.02, Math.abs(old[k]) * 0.15);
      if (bad) worse.push(`${shot}.${k}: ${old[k]} -> ${v}`);
    }
  }
  if (worse.length) { console.log('  REGRESSIONS:'); worse.forEach((w) => console.log('   - ' + w)); }
  else console.log('  no metric regressed beyond tolerance');
  results.push({ name: 'no metric regressions', ok: worse.length === 0, value: worse.length, detail: `${worse.length} regressed` });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${failed.length ? `GATE FAILED — ${failed.length} of ${results.length}` : `GATE PASSED — ${results.length} checks`} ===`);
failed.forEach((f) => console.log(`  FAIL ${f.name}: ${f.detail}`));
await writeFile(`${OUT}/gate.json`, JSON.stringify({ ...snapshot, results }, null, 2));
process.exit(failed.length ? 1 : 0);
