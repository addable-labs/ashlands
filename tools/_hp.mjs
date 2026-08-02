// High-pass + contrast-stretch zoom, for looking at micro-structure directly.
//   node tools/_hp.mjs in.png x y w h out.png [scale] [gain]
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const [p, xs, ys, ws, hs, outP, scs, gs] = process.argv.slice(2);
const x = +xs, y = +ys, w = +ws, h = +hs, sc = +(scs || 1), gain = +(gs || 4);
const img = PNG.sync.read(readFileSync(p));
const L = new Float64Array(w * h);
for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
  const si = ((y + j) * img.width + (x + i)) * 4;
  L[j * w + i] = 0.2126 * img.data[si] + 0.7152 * img.data[si + 1] + 0.0722 * img.data[si + 2];
}
const R = 3;
const HP = new Float64Array(w * h);
for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
  let a = 0, c = 0;
  for (let b = -R; b <= R; b++) for (let d = -R; d <= R; d++) {
    const jj = j + b, ii = i + d;
    if (jj < 0 || jj >= h || ii < 0 || ii >= w) continue;
    a += L[jj * w + ii]; c++;
  }
  HP[j * w + i] = L[j * w + i] - a / c;
}
const out = new PNG({ width: w * sc, height: h * sc });
for (let j = 0; j < h * sc; j++) for (let i = 0; i < w * sc; i++) {
  const v = Math.max(0, Math.min(255, 128 + HP[Math.floor(j / sc) * w + Math.floor(i / sc)] * gain));
  const di = (j * out.width + i) * 4;
  out.data[di] = v; out.data[di + 1] = v; out.data[di + 2] = v; out.data[di + 3] = 255;
}
writeFileSync(outP, PNG.sync.write(out));
console.log(`${outP}  ${out.width}x${out.height}`);
