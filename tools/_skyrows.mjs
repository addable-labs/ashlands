#!/usr/bin/env node
/**
 * Sky structure as a grid of patch means: display RGB, hue and CHROMA, sampled
 * across the top 55% of a capture.
 *
 * The whole-frame hue histograms cannot distinguish "the sky is one warm hue"
 * from "the sky has no chroma left at all", and on the coast vantage the answer
 * is the second one: every sky patch reads 208-246/255 at chroma 2-4, i.e. it is
 * sitting on the tonemapper's shoulder. Printing the chroma beside the hue is
 * what makes that visible.
 *
 *   node tools/_skyrows.mjs shots/_shadow/after/coast.png
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const f = process.argv[2];
const p = PNG.sync.read(readFileSync(f));
const { width: w, height: h, data: d } = p;
for (let y = 0; y < Math.floor(h * 0.55); y += Math.floor(h / 24)) {
  let out = `y=${String(y).padStart(4)} `;
  for (let xf = 0.05; xf < 1; xf += 0.15) {
    const x = Math.floor(xf * w);
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 30; dx++) {
      const k = ((y + dy) * w + x + dx) * 4;
      r += d[k]; g += d[k + 1]; b += d[k + 2]; n++;
    }
    r /= n; g /= n; b /= n;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
    let hh = 0;
    if (c > 0) {
      if (mx === r) hh = 60 * (((g - b) / c) % 6);
      else if (mx === g) hh = 60 * ((b - r) / c + 2);
      else hh = 60 * ((r - g) / c + 4);
      if (hh < 0) hh += 360;
    }
    out += `| ${String(Math.round(r)).padStart(3)},${String(Math.round(g)).padStart(3)},${String(Math.round(b)).padStart(3)} h${String(Math.round(hh)).padStart(3)} c${String(Math.round(c)).padStart(2)} `;
  }
  console.log(out);
}
