// Crop and upscale one capture, for judging geometry at pixel scale.
//   node tools/_zoom.mjs in.png x y w h out.png [scale]
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [aP, xs, ys, ws, hs, outP, scs] = process.argv.slice(2);
const x = +xs, y = +ys, w = +ws, h = +hs, sc = +(scs || 2);
const a = PNG.sync.read(readFileSync(aP));
const out = new PNG({ width: w * sc, height: h * sc });
for (let j = 0; j < h * sc; j++) {
  for (let i = 0; i < w * sc; i++) {
    const sx = Math.min(a.width - 1, Math.max(0, x + Math.floor(i / sc)));
    const sy = Math.min(a.height - 1, Math.max(0, y + Math.floor(j / sc)));
    const si = (sy * a.width + sx) * 4;
    const di = (j * out.width + i) * 4;
    out.data[di] = a.data[si]; out.data[di + 1] = a.data[si + 1];
    out.data[di + 2] = a.data[si + 2]; out.data[di + 3] = 255;
  }
}
writeFileSync(outP, PNG.sync.write(out));
console.log(`${outP}  ${out.width}x${out.height}`);
