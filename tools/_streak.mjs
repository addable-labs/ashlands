// Directional-streak metric over a crop.
//   node tools/_streak.mjs img.png x y w h
// High-passes luminance (residual after a 5x5 box), then builds the gradient
// structure tensor over the residual. `coh` is the tensor's coherence
// (l1-l2)/(l1+l2): 0 for an isotropic field, 1 for a perfectly parallel comb.
// `ang` is the dominant STREAK direction in degrees (0 = horizontal on screen).
// hp is the high-pass std in levels — the micro-structure amplitude.
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [p, xs, ys, ws, hs] = process.argv.slice(2);
const x = +xs, y = +ys, w = +ws, h = +hs;
const img = PNG.sync.read(readFileSync(p));
const L = new Float64Array(w * h);
for (let j = 0; j < h; j++) {
  for (let i = 0; i < w; i++) {
    const si = ((y + j) * img.width + (x + i)) * 4;
    L[j * w + i] = 0.2126 * img.data[si] + 0.7152 * img.data[si + 1] + 0.0722 * img.data[si + 2];
  }
}
const R = 2;
const HP = new Float64Array(w * h);
for (let j = 0; j < h; j++) {
  for (let i = 0; i < w; i++) {
    let a = 0, c = 0;
    for (let b = -R; b <= R; b++) for (let d = -R; d <= R; d++) {
      const jj = j + b, ii = i + d;
      if (jj < 0 || jj >= h || ii < 0 || ii >= w) continue;
      a += L[jj * w + ii]; c++;
    }
    HP[j * w + i] = L[j * w + i] - a / c;
  }
}
let jxx = 0, jyy = 0, jxy = 0, s2 = 0, n = 0;
for (let j = 1; j < h - 1; j++) {
  for (let i = 1; i < w - 1; i++) {
    const gx = (HP[j * w + i + 1] - HP[j * w + i - 1]) * 0.5;
    const gy = (HP[(j + 1) * w + i] - HP[(j - 1) * w + i]) * 0.5;
    jxx += gx * gx; jyy += gy * gy; jxy += gx * gy;
    s2 += HP[j * w + i] * HP[j * w + i]; n++;
  }
}
jxx /= n; jyy /= n; jxy /= n;
const tr = jxx + jyy;
const disc = Math.sqrt((jxx - jyy) * (jxx - jyy) + 4 * jxy * jxy);
const l1 = 0.5 * (tr + disc), l2 = 0.5 * (tr - disc);
const coh = tr > 1e-9 ? (l1 - l2) / (l1 + l2) : 0;
// Eigenvector of l1 is the gradient direction; the streak runs perpendicular.
const gAng = 0.5 * Math.atan2(2 * jxy, jxx - jyy);
const sAng = ((gAng * 180) / Math.PI + 90 + 180) % 180;
console.log(`${p} [${x},${y} ${w}x${h}]  hp=${Math.sqrt(s2 / n).toFixed(2)}  coh=${coh.toFixed(3)}  streakAng=${sAng.toFixed(1)}deg`);
