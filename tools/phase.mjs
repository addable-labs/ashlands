#!/usr/bin/env node
/**
 * Screen-lattice detector.
 *
 * A moire that "crawls" while the world slides under it is not a texture
 * defect — it is a resample or resolve artefact locked to the screen grid. It
 * shows up as a periodic modulation of high-frequency energy in SCREEN
 * coordinates, so: high-pass a midground patch, fold it by (coord mod N), and
 * compare the per-phase RMS. A clean resolve is flat across phases; a bilinear
 * stretch by a non-integer factor, or a half-res buffer that never resolves,
 * is not.
 *
 * Reports, per axis and per period N in 2..8, the spread between the strongest
 * and weakest phase as a percentage of the mean. Under ~4% is noise; the 0.8
 * render scale that produced the last round of "halftone screen" complaints
 * measured 9-10% at N=5.
 *
 *   node tools/phase.mjs shots/tag/ridge.png [x y w h]
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [, , file, ...rest] = process.argv;
if (!file) { console.error('usage: node tools/phase.mjs <png> [x y w h]'); process.exit(2); }
const png = PNG.sync.read(readFileSync(file));
const { width, height, data } = png;
// Default patch: the midground band, avoiding sky and the extreme foreground.
const [px, py, pw, ph] = rest.length === 4
  ? rest.map(Number)
  : [Math.round(width * 0.12), Math.round(height * 0.50), Math.round(width * 0.76), Math.round(height * 0.34)];

const lum = new Float64Array(pw * ph);
for (let y = 0; y < ph; y++) {
  for (let x = 0; x < pw; x++) {
    const i = ((py + y) * width + (px + x)) * 4;
    lum[y * pw + x] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
}
// High-pass: subtract a 3x3 box. Keeps only per-pixel detail, which is where a
// resample lattice lives and where scene content mostly does not.
const hp = new Float64Array(pw * ph);
for (let y = 1; y < ph - 1; y++) {
  for (let x = 1; x < pw - 1; x++) {
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += lum[(y + dy) * pw + (x + dx)];
    hp[y * pw + x] = lum[y * pw + x] - s / 9;
  }
}

console.log(`${file}  patch ${pw}x${ph} at (${px},${py})`);
let worst = 0, worstLabel = '';
for (const axis of ['x', 'y']) {
  for (let N = 2; N <= 8; N++) {
    const sum = new Float64Array(N);
    const cnt = new Float64Array(N);
    for (let y = 1; y < ph - 1; y++) {
      for (let x = 1; x < pw - 1; x++) {
        // Fold by the SCREEN coordinate, not the patch coordinate.
        const p = (axis === 'x' ? (px + x) : (py + y)) % N;
        const v = hp[y * pw + x];
        sum[p] += v * v;
        cnt[p]++;
      }
    }
    const rms = Array.from(sum, (s, i) => Math.sqrt(s / Math.max(cnt[i], 1)));
    const mean = rms.reduce((a, b) => a + b, 0) / N;
    const spread = (Math.max(...rms) - Math.min(...rms)) / Math.max(mean, 1e-9) * 100;
    const flag = spread > 6 ? '  <== LATTICE' : '';
    if (spread > worst) { worst = spread; worstLabel = `${axis} N=${N}`; }
    console.log(`  ${axis} N=${N}  phases ${rms.map((v) => v.toFixed(3)).join(' / ')}   spread ${spread.toFixed(1)}%${flag}`);
  }
}
console.log(`worst: ${worstLabel} at ${worst.toFixed(1)}%`);
