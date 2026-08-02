// Side-by-side crop of two captures, for judging a shader change at pixel scale.
//   node tools/_crop.mjs a.png b.png x y w h out.png [scale]
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [aP, bP, xs, ys, ws, hs, outP, scs] = process.argv.slice(2);
const x = +xs, y = +ys, w = +ws, h = +hs, sc = +(scs || 1);
const a = PNG.sync.read(readFileSync(aP));
const b = PNG.sync.read(readFileSync(bP));
const gap = 8;
const out = new PNG({ width: (w * 2 + gap) * sc, height: h * sc });
const put = (src, ox) => {
  for (let j = 0; j < h * sc; j++) {
    for (let i = 0; i < w * sc; i++) {
      const si = ((y + Math.floor(j / sc)) * src.width + (x + Math.floor(i / sc))) * 4;
      const di = (j * out.width + ox * sc + i) * 4;
      out.data[di] = src.data[si]; out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2]; out.data[di + 3] = 255;
    }
  }
};
put(a, 0);
put(b, w + gap);
writeFileSync(outP, PNG.sync.write(out));
console.log(`${outP}  ${out.width}x${out.height}`);
