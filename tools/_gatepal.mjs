#!/usr/bin/env node
/**
 * The gate's own palette statistic, offline, on a directory of PNGs.
 *
 * `tools/palette.mjs` scores against the art bible's targets with its own
 * saturation-relative threshold; the gate scores `hueConcentration`,
 * `hueFamilies`, `meanSat` and the luminance percentiles with an ABSOLUTE
 * chroma threshold, and it is the gate's numbers that gate a change. Iterating a
 * cube against the wrong statistic wastes a browser round trip per attempt, so
 * this reimplements the gate's `palette()` byte for byte (including its stride)
 * and runs it on shots/_lab in a hundred milliseconds.
 *
 *   node tools/_gatepal.mjs shots/_lab
 *   node tools/_gatepal.mjs shots/_lab --vs shots/_gatepost
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2);
const DIR = argv.find((a) => !a.startsWith('--')) ?? 'shots/_lab';
const vi = argv.indexOf('--vs');
const VS = vi >= 0 ? argv[vi + 1] : null;
const BASE = JSON.parse(readFileSync('tools/gate-baseline.json', 'utf8')).metrics;

/** Verbatim from tools/gate.mjs. Do not "improve" it — it must match. */
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
  let top2 = 0;
  for (let i = 0; i < 12; i++) top2 = Math.max(top2, bins[i] + bins[(i + 1) % 12]);
  const totalC = bins.reduce((a, b) => a + b, 0) || 1;
  const liveBins = bins.filter((b) => b / totalC >= 0.05).length;
  return {
    hueConcentration: chromaN ? +(top2 / chromaN).toFixed(3) : 1,
    hueFamilies: liveBins,
    meanSat: +(sat / n).toFixed(3),
    p1: Math.round(q(0.01)), p50: Math.round(q(0.5)), p99: Math.round(q(0.99)),
    stops: +(Math.log2(Math.max(1, q(0.99)) / Math.max(1, q(0.01)))).toFixed(2),
    bins: Array.from(bins, (b) => +(b / totalC).toFixed(3)),
  };
}

const NAMES = ['0-30', '30-60', '60-90', '90-120', '120-150', '150-180',
  '180-210', '210-240', '240-270', '270-300', '300-330', '330-360'];

const read = (dir, f) => palette(PNG.sync.read(readFileSync(join(dir, f))));
const files = readdirSync(DIR).filter((f) => f.endsWith('.png')).sort();

console.log(`\nGATE PALETTE — ${DIR}${VS ? `   vs ${VS}` : '   vs tools/gate-baseline.json'}\n`);
console.log('frame        hueConc  (base)   fam  meanSat    p1  p50  p99  stops');
console.log('-'.repeat(70));
for (const f of files) {
  const m = read(DIR, f);
  const name = basename(f, '.png');
  const ref = VS && existsSync(join(VS, f)) ? read(VS, f) : BASE[name];
  const rc = ref ? ref.hueConcentration.toFixed(3) : '  -  ';
  const flag = ref && m.hueConcentration > ref.hueConcentration * 1.15 ? ' REGRESS' : '';
  console.log(
    `${name.padEnd(11)}  ${m.hueConcentration.toFixed(3)}   ${rc}    ${m.hueFamilies}` +
    `   ${m.meanSat.toFixed(3)}   ${String(m.p1).padStart(3)}  ${String(m.p50).padStart(3)}` +
    `  ${String(m.p99).padStart(3)}  ${m.stops.toFixed(2)}${flag}`
  );
}
console.log('\nhue bins (share of chroma-bearing pixels)');
console.log('frame       ' + NAMES.map((n) => n.padStart(8)).join(''));
for (const f of files) {
  const m = read(DIR, f);
  console.log(basename(f, '.png').padEnd(12) +
    m.bins.map((b) => (b >= 0.005 ? (b * 100).toFixed(1) : '  .').padStart(8)).join(''));
}
