#!/usr/bin/env node
/**
 * Offline grade lab.
 *
 * Compiles src/render/grade.ts, bakes the cube exactly as the engine does,
 * applies it to the pre-LUT captures in shots/_prelut with the same trilinear
 * reconstruction the shader uses, and writes the result to shots/_lab. Then
 * `node tools/palette.mjs shots/_lab` scores it.
 *
 * Fidelity is checkable rather than assumed: run with --verify to compare the
 * lab's output against a real engine capture of the same frames pixel by pixel.
 *
 *   node tools/_gradelab.mjs
 *   node tools/_gradelab.mjs --verify shots/iter11
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { PNG } from 'pngjs';

// Emitted inside the project so node's resolver finds 'three' in node_modules.
const TMP = 'node_modules/.cache/gradelab';
mkdirSync(TMP, { recursive: true });
execSync(
  `npx tsc src/render/grade.ts --outDir ${TMP} --module esnext --target es2022 ` +
  `--moduleResolution bundler --skipLibCheck --removeComments --ignoreConfig`,
  { stdio: 'inherit' }
);
const { buildGradeLUT } = await import(new URL('../' + TMP + '/grade.js', import.meta.url).href);

const N = 64;
const tex = buildGradeLUT();
// Half-float -> float. The DataTexture holds Uint16 halves in an N*N x N strip.
const h = tex.image.data;
const cube = new Float32Array(N * N * N * 3);
function fromHalf(u) {
  const s = (u & 0x8000) ? -1 : 1;
  const e = (u >> 10) & 0x1f;
  const m = u & 0x3ff;
  if (e === 0) return s * m * 5.960464477539063e-8;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + m / 1024);
}
for (let i = 0; i < N * N * N; i++) {
  cube[i * 3] = fromHalf(h[i * 4]);
  cube[i * 3 + 1] = fromHalf(h[i * 4 + 1]);
  cube[i * 3 + 2] = fromHalf(h[i * 4 + 2]);
}
/** Strip index for (slice bz, green gy, red rx) — matches the atlas layout. */
const at = (rx, gy, bz) => (gy * (N * N) + bz * N + rx) * 3;

/**
 * The shader's reconstruction: bilinear in r/g inside a slice (with the
 * half-texel inset), linear between the two slices in b.
 */
function applyLUT(out, r, g, b) {
  const sl = b * (N - 1);
  const s0 = Math.floor(sl), s1 = Math.min(s0 + 1, N - 1), f = sl - s0;
  const rx = r * (N - 1), gy = g * (N - 1);
  const r0 = Math.floor(rx), r1 = Math.min(r0 + 1, N - 1), fr = rx - r0;
  const g0 = Math.floor(gy), g1 = Math.min(g0 + 1, N - 1), fg = gy - g0;
  for (let c = 0; c < 3; c++) {
    const lerp2 = (bz) => {
      const a = cube[at(r0, g0, bz) + c] * (1 - fr) + cube[at(r1, g0, bz) + c] * fr;
      const d = cube[at(r0, g1, bz) + c] * (1 - fr) + cube[at(r1, g1, bz) + c] * fr;
      return a * (1 - fg) + d * fg;
    };
    out[c] = lerp2(s0) * (1 - f) + lerp2(s1) * f;
  }
}

const argv = process.argv.slice(2);
const vi = argv.indexOf('--verify');
const SRC = 'shots/_prelut';
const OUT = 'shots/_lab';
mkdirSync(OUT, { recursive: true });
if (!existsSync(SRC)) { console.error(`missing ${SRC} — run tools/_prelut.mjs first`); process.exit(2); }

const px = new Float32Array(3);
for (const f of readdirSync(SRC).filter((x) => x.endsWith('.png'))) {
  const png = PNG.sync.read(readFileSync(join(SRC, f)));
  const d = png.data;
  for (let i = 0; i < d.length; i += 4) {
    applyLUT(px, d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
    d[i] = Math.max(0, Math.min(255, Math.round(px[0] * 255)));
    d[i + 1] = Math.max(0, Math.min(255, Math.round(px[1] * 255)));
    d[i + 2] = Math.max(0, Math.min(255, Math.round(px[2] * 255)));
  }
  writeFileSync(join(OUT, f), PNG.sync.write(png));
}
console.log(`graded ${SRC} -> ${OUT}`);

if (vi >= 0) {
  const ref = argv[vi + 1] ?? 'shots/iter11';
  console.log(`\nfidelity vs real engine capture in ${ref} (mean abs 8-bit error per channel)`);
  for (const f of readdirSync(OUT).filter((x) => x.endsWith('.png'))) {
    if (!existsSync(join(ref, f))) continue;
    const a = PNG.sync.read(readFileSync(join(OUT, f))).data;
    const b = PNG.sync.read(readFileSync(join(ref, f))).data;
    if (a.length !== b.length) continue;
    let e = 0, n = 0;
    for (let i = 0; i < a.length; i += 4) {
      e += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      n += 3;
    }
    console.log(`  ${basename(f, '.png').padEnd(12)} ${(e / n).toFixed(2)}`);
  }
}
