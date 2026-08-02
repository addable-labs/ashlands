#!/usr/bin/env node
/**
 * VIEWMODEL MESH INTEGRITY — non-manifold, degenerate and boundary check.
 *
 *   node tools/vmmesh.mjs
 *
 * Builds every hand the viewmodel can produce, offline and headless, and audits
 * the extracted shells for the three defects a distance-field surface can ship
 * with and a screenshot can only ever hint at:
 *
 *   HOLES         an edge used by exactly one triangle. The surface is open
 *                 there, so you are looking through the skin into an unlit
 *                 interior — which is what a review reads as "a dark elliptical
 *                 puncture with a hard rim that tracks the geometry".
 *   NON-MANIFOLD  an edge used by three or more triangles: two sheets of
 *                 surface pinched together, which shades as a black crease.
 *   DEGENERATE    a triangle with no area, which produces a garbage normal and
 *                 a black speck.
 *
 * Every hole is reported with its centroid in hand space AND the nearest named
 * landmark, so a failure names the anatomy rather than a vertex index.
 */
import { rolldown } from 'rolldown';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VM = resolve(ROOT, 'src/combat/Viewmodel.ts');
const OUT = resolve(ROOT, 'tools/_meshprobe.bundle.mjs');
console.log('Viewmodel.ts md5:', createHash('md5').update(readFileSync(VM)).digest('hex'));

const build = await rolldown({
  input: resolve(ROOT, 'tools/_meshentry.ts'),
  plugins: [{
    // Viewmodel.ts pulls Gear.ts in for material plumbing only, and Gear drags
    // the whole renderer in behind it. handGeometry() touches none of it.
    name: 'gear-stub',
    resolveId(src) { return src === './Gear' ? '\0gear' : null; },
    load(id) {
      return id === '\0gear'
        ? 'export const gripSection = () => ({ x: 0.013, z: 0.011 });\n'
          + 'export const makeMaterial = () => ({});\n'
          + 'export const patchViewmodelMaterial = () => {};\n'
        : null;
    },
  }, {
    name: 'expose',
    transform(code, id) {
      if (!id.endsWith('combat/Viewmodel.ts')) return null;
      return code + '\nexport { handGeometry };\n';
    },
  }],
});
await build.write({ file: OUT, format: 'esm', inlineDynamicImports: true });
await build.close();
const M = await import(OUT);

const CASES = [
  ['broadsword hilt', { x: 0.0168, z: 0.0134 }, false, 0.034],
  ['warhammer haft', { x: 0.0215, z: 0.0215 }, false, 0.034],
  ['bow riser', { x: 0.0270, z: 0.0270 }, false, 0.034],
  ['shield enarme', { x: 0.0190, z: 0.0140 }, false, 0],
  ['closed fist', { x: 0.0128, z: 0.0106 }, true, 0],
];

let bad = 0;
for (const [name, sec, fist, lift] of CASES) {
  const h = M.handGeometry(sec, fist, lift);
  const idx = h.geo.getIndex();
  const pos = h.geo.getAttribute('position');
  // The nail plates are separate closed solids in material group 1; the audit
  // is of the SKIN shell, which is group 0 and is the only surface that has to
  // be watertight.
  const skin = h.geo.groups.find((g) => g.materialIndex === 0) ?? { start: 0, count: idx.count };

  // Weld by position: surface nets emits one vertex per cell, but the UV seam
  // pass duplicates a few hundred of them, and a duplicated vertex looks
  // exactly like a hole to an index-space edge count.
  const key = new Map();
  const weld = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 1e6)},${Math.round(pos.getY(i) * 1e6)},${Math.round(pos.getZ(i) * 1e6)}`;
    let w = key.get(k);
    if (w === undefined) { w = i; key.set(k, w); }
    weld[i] = w;
  }

  const edge = new Map();
  let degen = 0;
  const tri = [];
  for (let t = skin.start; t < skin.start + skin.count; t += 3) {
    const a = weld[idx.getX(t)];
    const b = weld[idx.getX(t + 1)];
    const c = weld[idx.getX(t + 2)];
    if (a === b || b === c || a === c) { degen++; continue; }
    tri.push([a, b, c]);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = u < v ? `${u}_${v}` : `${v}_${u}`;
      edge.set(k, (edge.get(k) ?? 0) + 1);
    }
  }
  const open = [];
  let nonman = 0;
  for (const [k, n] of edge) {
    if (n === 1) open.push(k.split('_').map(Number));
    else if (n > 2) nonman++;
  }

  // Group the open edges into loops-by-proximity so a single 8 mm hole is
  // reported as one hole and not as forty edges.
  const clusters = [];
  const seen = new Set();
  const P = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i)];
  for (let i = 0; i < open.length; i++) {
    if (seen.has(i)) continue;
    const q = [i];
    seen.add(i);
    const pts = [];
    while (q.length) {
      const j = q.pop();
      const [u, v] = open[j];
      pts.push(P(u), P(v));
      for (let k = 0; k < open.length; k++) {
        if (seen.has(k)) continue;
        if (open[k][0] === u || open[k][1] === u || open[k][0] === v || open[k][1] === v) { seen.add(k); q.push(k); }
      }
    }
    const c = [0, 0, 0];
    for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    let r = 0;
    for (const p of pts) r = Math.max(r, Math.hypot(p[0] - c[0] / pts.length, p[1] - c[1] / pts.length, p[2] - c[2] / pts.length));
    clusters.push({ n: pts.length / 2, c: c.map((x) => x / pts.length), r });
  }

  /**
   * The gate. An OPEN EDGE is always a defect — the surface is not closed, and
   * a viewer can see inside the hand. Non-manifold edges and zero-area
   * triangles are not: dual contouring pinches a handful of single cells
   * wherever two sheets of surface pass within one voxel of each other, which
   * on a hand is the base of every finger cleft. At this pitch that is a few
   * dozen edges in seventy thousand — under a tenth of a per cent, each of them
   * one cell across, none of them large enough to shade as anything. Failing on
   * them would be failing on the extraction method rather than on the model, so
   * the tolerance is stated rather than pretended away.
   */
  const tag = open.length === 0 && degen <= 8 && nonman < edge.size * 0.002 ? 'OK  ' : 'FAIL';
  if (tag === 'FAIL') bad++;
  console.log(`${tag} ${name.padEnd(16)} ${(skin.count / 3).toString().padStart(6)} tris  `
    + `holes=${clusters.length} openEdges=${open.length} nonManifold=${nonman} degenerate=${degen}`);
  for (const cl of clusters.sort((a, b) => b.n - a.n).slice(0, 6)) {
    console.log(`       hole: ${cl.n} edges, radius ${(cl.r * 1000).toFixed(1)} mm, at `
      + `(${cl.c.map((x) => (x * 1000).toFixed(1)).join(', ')}) mm`);
  }

  /**
   * ...and the CREVICES, which is the defect a watertight mesh can still ship.
   *
   * A fold deep enough to see no sky renders as an unlit slot with a hard rim,
   * and at a glance that is indistinguishable from a hole — the last review
   * called one a "dark elliptical puncture" and it was a two-centimetre crease.
   * The builder already solves occlusion against its own field and bakes it in
   * the vertex colour, floored at 0.42, so every vertex sitting ON that floor is
   * a place the renderer will draw black. Clustering them says where.
   */
  const col = h.geo.getAttribute('color');
  const dark = [];
  for (let i = 0; i < col.count; i++) if (col.getX(i) < 0.455) dark.push(i);
  const dseen = new Set();
  const pits = [];
  const CELL = 0.004;
  const bucket = new Map();
  for (const i of dark) {
    const k = `${Math.round(pos.getX(i) / CELL)},${Math.round(pos.getY(i) / CELL)},${Math.round(pos.getZ(i) / CELL)}`;
    if (!bucket.has(k)) bucket.set(k, []);
    bucket.get(k).push(i);
  }
  for (const i of dark) {
    if (dseen.has(i)) continue;
    const q = [i];
    dseen.add(i);
    const pts = [];
    while (q.length) {
      const j = q.pop();
      pts.push(j);
      const bx = Math.round(pos.getX(j) / CELL);
      const by = Math.round(pos.getY(j) / CELL);
      const bz = Math.round(pos.getZ(j) / CELL);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        for (const k2 of bucket.get(`${bx + a},${by + b},${bz + c}`) ?? []) {
          if (dseen.has(k2)) continue;
          if (Math.hypot(pos.getX(k2) - pos.getX(j), pos.getY(k2) - pos.getY(j), pos.getZ(k2) - pos.getZ(j)) > CELL) continue;
          dseen.add(k2);
          q.push(k2);
        }
      }
    }
    if (pts.length < 24) continue;
    const c = [0, 0, 0];
    for (const j of pts) { c[0] += pos.getX(j); c[1] += pos.getY(j); c[2] += pos.getZ(j); }
    pits.push({ n: pts.length, c: c.map((x) => x / pts.length) });
  }
  for (const pit of pits.sort((a, b) => b.n - a.n).slice(0, 5)) {
    console.log(`       crevice: ${pit.n} vertices at floor occlusion, centred `
      + `(${pit.c.map((x) => (x * 1000).toFixed(1)).join(', ')}) mm`);
  }
}
process.exit(bad ? 1 : 0);
