#!/usr/bin/env node
/**
 * Offline metering simulator.
 *
 * Reads the tile grids captured by tools/_expgrid.mjs and evaluates candidate
 * weighting schemes against them, so a metering change is chosen from the
 * canonical set's real luminance distributions rather than from an argument.
 *
 *   node tools/_metersim.mjs shots/_exp/before/grid.json
 */
import { readFileSync } from 'node:fs';

const j = JSON.parse(readFileSync(process.argv[2] ?? 'shots/_exp/before/grid.json', 'utf8'));
const W = 32, H = 18;

/** Tile centre in UV. Row 0 of the readback is the BOTTOM of the frame. */
const uvOf = (i) => ({ x: (i % W + 0.5) / W, y: (Math.floor(i / W) + 0.5) / H });

const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The shipped weighting: vertical ramp favouring the bottom, mild centre bias. */
const shipped = (uv) => {
  const wy = 0.10 + 0.90 * ss(0.94, 0.32, uv.y);
  const dx = uv.x - 0.5, dy = uv.y - 0.5;
  return wy * (0.35 + 0.65 * Math.exp(-(dx * dx + dy * dy) * 1.7));
};
const ramp = (floor) => (uv) => {
  const wy = floor + (1 - floor) * ss(0.94, 0.32, uv.y);
  const dx = uv.x - 0.5, dy = uv.y - 0.5;
  return wy * (0.35 + 0.65 * Math.exp(-(dx * dx + dy * dy) * 1.7));
};

const logAvg = (L, wfn) => {
  let sl = 0, sw = 0;
  for (let i = 0; i < L.length; i++) { const w = wfn(uvOf(i), L[i]); sl += w * L[i]; sw += w; }
  return sl / Math.max(sw, 1e-5);
};

/** Weighted percentile of tile log-luminance. */
const wpct = (L, wfn, p) => {
  const rows = Array.from(L, (v, i) => ({ v, w: wfn(uvOf(i), v) })).sort((a, b) => a.v - b.v);
  const tot = rows.reduce((a, r) => a + r.w, 0);
  let acc = 0;
  for (const r of rows) { acc += r.w; if (acc >= p * tot) return r.v; }
  return rows[rows.length - 1].v;
};

const KEY = 0.11, ADAPT = 0.78, MINE = 0.25, MAXE = 7.0;
const ev = (logAvgV) => Math.min(MAXE, Math.max(MINE, Math.pow(KEY / Math.max(2 ** logAvgV, 1e-6), ADAPT)));

/**
 * Candidates. Each returns the metered log2 luminance the key is solved against.
 */
const CAND = {
  shipped: (L) => logAvg(L, shipped),
  'ramp.35': (L) => logAvg(L, ramp(0.35)),
  'ramp.55': (L) => logAvg(L, ramp(0.55)),
  flat: (L) => logAvg(L, () => 1),
  p50: (L) => wpct(L, shipped, 0.50),
  p60: (L) => wpct(L, shipped, 0.60),
  p70: (L) => wpct(L, shipped, 0.70),
  // Highlight-guarded log average: the key may not sit more than N stops below
  // the frame's own bright population (weighted p85 of the tile distribution).
  guard3: (L) => Math.max(logAvg(L, shipped), wpct(L, shipped, 0.85) - 3.0),
  guard2_5: (L) => Math.max(logAvg(L, shipped), wpct(L, shipped, 0.85) - 2.5),
  guard2: (L) => Math.max(logAvg(L, shipped), wpct(L, shipped, 0.85) - 2.0),
  // Same idea against the unweighted p85, i.e. the sky counts as a highlight
  // whether or not the framing put it where the ramp discounts it.
  gflat3: (L) => Math.max(logAvg(L, shipped), wpct(L, () => 1, 0.85) - 3.0),
  gflat2_5: (L) => Math.max(logAvg(L, shipped), wpct(L, () => 1, 0.85) - 2.5),
  gflat2: (L) => Math.max(logAvg(L, shipped), wpct(L, () => 1, 0.85) - 2.0),
};

const names = Object.keys(CAND);
console.log('metered log2 L, and the resulting pre-lift ev, per candidate\n');
console.log('shot     ' + names.map((n) => n.padStart(9)).join(''));
for (const [name, s] of Object.entries(j.shots)) {
  const L = Float32Array.from(s.logL);
  console.log(name.padEnd(9) + names.map((n) => ev(CAND[n](L)).toFixed(2).padStart(9)).join(''));
}

console.log('\nstops vs shipped (negative = darker frame)\n');
console.log('shot     ' + names.map((n) => n.padStart(9)).join(''));
for (const [name, s] of Object.entries(j.shots)) {
  const L = Float32Array.from(s.logL);
  const base = ev(CAND.shipped(L));
  console.log(name.padEnd(9) + names.map((n) => Math.log2(ev(CAND[n](L)) / base).toFixed(2).padStart(9)).join(''));
}

console.log('\nframe structure: weighted log-avg, and tile percentiles (log2 scene L)\n');
console.log('shot      wAvg   flatAvg  wP15   wP50   wP85   flatP85  range(P85-P15)');
for (const [name, s] of Object.entries(j.shots)) {
  const L = Float32Array.from(s.logL);
  const f = (v) => v.toFixed(2).padStart(7);
  console.log(name.padEnd(8) + f(logAvg(L, shipped)) + f(logAvg(L, () => 1)) +
    f(wpct(L, shipped, 0.15)) + f(wpct(L, shipped, 0.5)) + f(wpct(L, shipped, 0.85)) +
    f(wpct(L, () => 1, 0.85)) + f(wpct(L, shipped, 0.85) - wpct(L, shipped, 0.15)));
}

console.log('\nrow profile, mean tile log2 L by frame row (leftmost = TOP of frame)\n');
for (const [name, s] of Object.entries(j.shots)) {
  const L = Float32Array.from(s.logL);
  const out = [];
  for (let r = H - 1; r >= 0; r--) {
    let sum = 0;
    for (let c = 0; c < W; c++) sum += L[r * W + c];
    out.push((sum / W).toFixed(1).padStart(6));
  }
  console.log(`${name.padEnd(8)}${out.join('')}`);
}

/**
 * The exposure pass's own two populations, reconstructed from the tile grid.
 *
 * hiL is the log-average of everything from ~1 stop over the frame's log-mean
 * upward (the weight saturates at 3 stops); darkL is the soft minimum the
 * shadow channel returns. Their ratio is the frame's own dynamic range as the
 * exposure solve sees it, which is the statistic a range-aware key has to be
 * gated on. Printed here so the gate thresholds are chosen from the canonical
 * set rather than guessed.
 */
console.log('\nmeter populations (reconstructed): hiL, darkL, range in stops\n');
console.log('shot      avgL    hiL    darkL   range  geoMid  midVsAvg(stops)');
for (const [name, s] of Object.entries(j.shots)) {
  const L = Float32Array.from(s.logL);
  const lg = logAvg(L, shipped);
  const ref = 2 ** lg;
  let slb = 0, swb = 0, sld = 0, swd = 0;
  for (let i = 0; i < L.length; i++) {
    const l = 2 ** L[i];
    const wb = ss(2.0, 8.0, l / ref);
    slb += wb * L[i]; swb += wb;
    const wd = Math.min(1, Math.max(0, 2 ** (-3 * (Math.log2(l / ref) + 1))));
    sld += wd * L[i]; swd += wd;
  }
  const hi = swb > 1e-4 ? slb / swb : lg;
  const dk = swd > 1e-5 ? sld / swd : lg;
  const mid = (hi + dk) / 2;
  const f = (v) => v.toFixed(2).padStart(7);
  console.log(name.padEnd(8) + f(lg) + f(hi) + f(dk) + f(hi - dk) + f(mid) + f(mid - lg));
}
