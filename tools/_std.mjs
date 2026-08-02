// Luminance mean / standard deviation over a rectangular crop of a capture.
//   node tools/_std.mjs in.png x y w h
// Prints "mean sd" in 0-255 levels. Used to measure surface detail objectively:
// a flat clay dome sits under ~8 levels, a textured one well over 15.
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [aP, xs, ys, ws, hs] = process.argv.slice(2);
const x = +xs, y = +ys, w = +ws, h = +hs;
const a = PNG.sync.read(readFileSync(aP));
let n = 0, s = 0, s2 = 0;
for (let j = 0; j < h; j++) {
  for (let i = 0; i < w; i++) {
    const si = ((y + j) * a.width + (x + i)) * 4;
    const l = a.data[si] * 0.2126 + a.data[si + 1] * 0.7152 + a.data[si + 2] * 0.0722;
    n++; s += l; s2 += l * l;
  }
}
const mean = s / n;
const sd = Math.sqrt(Math.max(0, s2 / n - mean * mean));
console.log(`${aP} [${x},${y} ${w}x${h}]  mean=${mean.toFixed(2)}  sd=${sd.toFixed(2)}`);
