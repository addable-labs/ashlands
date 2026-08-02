#!/usr/bin/env node
/**
 * Sky hue-spread probe: one pixel column, pre-grade vs post-grade.
 *
 * The acceptance criterion for the grade is that the dome's zenith-to-horizon
 * hue rotation SURVIVES the transform. A whole-frame histogram cannot say that —
 * it counts pixels, and a grade that collapses every sky pixel onto one hue still
 * reports plenty of "warm family" mass. A single vertical column through the sky
 * is the direct measurement: read the same column out of the pre-grade and the
 * post-grade capture and compare the hue span.
 *
 *   node tools/_gradecol.mjs [shot] [column]
 *
 * Reads shots/_gatepre and shots/_gatepost (tools/_gatepre.mjs writes both).
 * Pass --lab to read the offline lab's output (shots/_lab) as the post side
 * instead, which is how a candidate cube is judged without a browser.
 */
import { readFileSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const SHOT = argv[0] ?? 'ridge';
const COL = Number(argv[1] ?? 87);
const LAB = process.argv.includes('--lab');
const ROWS = [40, 120, 200, 260, 300, 340];

const PRE = `shots/_gatepre/${SHOT}.png`;
const POST = LAB ? `shots/_lab/${SHOT}.png` : `shots/_gatepost/${SHOT}.png`;
for (const f of [PRE, POST]) {
  if (!existsSync(f)) { console.error(`missing ${f}`); process.exit(2); }
}

const hsv = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-7) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: mx > 0 ? d / mx : 0 };
};

const read = (f) => PNG.sync.read(readFileSync(f));
const a = read(PRE), b = read(POST);
const px = (p, y) => {
  const k = (y * p.width + COL) * 4;
  return [p.data[k], p.data[k + 1], p.data[k + 2]];
};

console.log(`${SHOT} column ${COL}   pre = ${PRE}   post = ${POST}\n`);
console.log('  row   pre-grade                          post-grade');
const spans = { pre: [], post: [] };
for (const y of ROWS) {
  const p = px(a, y), q = px(b, y);
  const hp = hsv(p[0] / 255, p[1] / 255, p[2] / 255);
  const hq = hsv(q[0] / 255, q[1] / 255, q[2] / 255);
  spans.pre.push(hp);
  spans.post.push(hq);
  const f = (c, x) => `(${String(c[0]).padStart(3)},${String(c[1]).padStart(3)},${String(c[2]).padStart(3)}) hue ${x.h.toFixed(0).padStart(3)} sat ${x.s.toFixed(3)}`;
  console.log(`  ${String(y).padStart(3)}   ${f(p, hp)}   ${f(q, hq)}`);
};

/** Total rotation walked down the column, signed-shortest step by step. */
const walk = (hs) => {
  let t = 0;
  for (let i = 1; i < hs.length; i++) {
    let d = hs[i].h - hs[i - 1].h;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    t += Math.abs(d);
  }
  return t;
};
const spread = (hs) => {
  let worst = 0;
  for (let i = 0; i < hs.length; i++) {
    for (let j = i + 1; j < hs.length; j++) {
      let d = Math.abs(hs[i].h - hs[j].h);
      if (d > 180) d = 360 - d;
      if (d > worst) worst = d;
    }
  }
  return worst;
};
const satSpan = (hs) => Math.max(...hs.map((x) => x.s)) - Math.min(...hs.map((x) => x.s));
console.log('');
console.log(`  hue rotation walked   pre ${walk(spans.pre).toFixed(0).padStart(4)}   post ${walk(spans.post).toFixed(0).padStart(4)}`);
console.log(`  max pairwise spread   pre ${spread(spans.pre).toFixed(0).padStart(4)}   post ${spread(spans.post).toFixed(0).padStart(4)}`);
console.log(`  saturation span       pre ${satSpan(spans.pre).toFixed(3)}  post ${satSpan(spans.post).toFixed(3)}`);
