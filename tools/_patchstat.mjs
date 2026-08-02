// Local statistic probe for surface-detail review.
//   node tools/_patchstat.mjs img.png x y w h
// Reports mean/std of luminance over the patch, plus a high-pass std that
// removes any smooth lighting gradient (which a plain std would count as
// "detail"). The high-pass is the residual after subtracting a 9x9 box blur,
// so it measures only the texture-scale content the critics said was missing.
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [p, xs, ys, ws, hs] = process.argv.slice(2);
const x = +xs, y = +ys, w = +ws, h = +hs;
const img = PNG.sync.read(readFileSync(p));
const lum = new Float64Array(w * h);
for (let j = 0; j < h; j++) {
  for (let i = 0; i < w; i++) {
    const si = ((y + j) * img.width + (x + i)) * 4;
    lum[j * w + i] = 0.2126 * img.data[si] + 0.7152 * img.data[si + 1] + 0.0722 * img.data[si + 2];
  }
}
let m = 0;
for (const v of lum) m += v;
m /= w * h;
let s2 = 0;
for (const v of lum) s2 += (v - m) * (v - m);
const sd = Math.sqrt(s2 / (w * h));

const R = 4;
let hp2 = 0;
let n = 0;
for (let j = 0; j < h; j++) {
  for (let i = 0; i < w; i++) {
    let acc = 0, c = 0;
    for (let b = -R; b <= R; b++) {
      for (let a = -R; a <= R; a++) {
        const jj = j + b, ii = i + a;
        if (jj < 0 || jj >= h || ii < 0 || ii >= w) continue;
        acc += lum[jj * w + ii];
        c++;
      }
    }
    const d = lum[j * w + i] - acc / c;
    hp2 += d * d;
    n++;
  }
}
console.log(`${p} [${x},${y} ${w}x${h}]  mean=${m.toFixed(2)}  std=${sd.toFixed(3)}  highpass_std=${Math.sqrt(hp2 / n).toFixed(3)}`);
