#!/usr/bin/env node
/**
 * Palette regression check.
 *
 * Three review rounds in a row reported the same three defects in prose —
 * "monochrome", "a mono-hue sepia grade", "the entire image lives in a 0.66
 * stop band" — and three rounds in a row an agent responded by nudging a global
 * tint, because nothing in the repo could say whether the nudge helped. Prose
 * is not a regression test. This is.
 *
 * It reads captured PNGs and reports, per frame:
 *
 *   - Luminance spread. p1 / p50 / p99 of Rec.709 luma over the frame, and the
 *     dynamic range between p1 and p99 in stops. The bible's palette spans
 *     basalt `#141312` (luma 19) to sunlit chitin and a sulphur sky well past
 *     200, so a frame delivering the palette cannot be narrow.
 *   - Hue distribution. Every pixel carrying real chroma is binned into twelve
 *     30-degree buckets. The failing rounds measured 98-100% of chroma mass in
 *     two adjacent orange bins; the bible has seven named colour roles spread
 *     across at least four hue families (warm ash/ember/sulphur, teal and violet
 *     bioluminescence, verdigris, and the blue-grey of sky-lit basalt shadow).
 *   - Mean saturation. The bible's saturation discipline is explicit: the world
 *     is desaturated, and bioluminescence and lava are the only vivid things.
 *     So the *mean* must be low while a small high-saturation tail must exist.
 *
 * Targets are derived from the palette table in ART_BIBLE.md and stated in
 * TARGETS below with the reasoning attached to each. Usage:
 *
 *   node tools/palette.mjs                    # measures shots/iter11
 *   node tools/palette.mjs shots/f-render     # measures a tagged capture
 *   node tools/palette.mjs a b --diff         # compares two capture dirs
 *   node tools/palette.mjs shots/x --json     # machine-readable
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { PNG } from 'pngjs';

// ---------------------------------------------------------------------------
// Targets, each derived from the palette table rather than from a frame we
// happen to like. A target justified by "this is what it measures today" is a
// tautology and cannot detect drift.
// ---------------------------------------------------------------------------
const TARGETS = {
  /**
   * Basalt `#141312` is luma 19 and ash's dark end `#4a423b` is luma 67; the
   * bright end of the palette is sunlit chitin `#d8c9a4` (luma 201) and a
   * sulphur sky that carries the frame's highlight. A frame that renders the
   * palette therefore has to put its 1st percentile down in the basalt/deep-ash
   * region and its 99th up in the lit-chitin region. Stated as a range in
   * stops between p1 and p99 so it is exposure-independent.
   *
   * 2.6 stops is the floor, not the goal: p1 = 24, p99 = 147 already clears it.
   * The failing rounds measured 0.66.
   */
  rangeStopsMin: 2.6,
  /**
   * And the ends have to be in the right places, not merely far apart — a frame
   * could pass a stop test by clipping. p1 must reach the basalt band, p99 must
   * reach the lit band.
   */
  p1Max: 34,   // basalt `#2a2622` is luma 38; p1 must sit at or under it
  p99Min: 186, // under lit chitin `#d8c9a4` (201) with margin for haze

  /**
   * Hue spread. Twelve 30-degree bins over pixels carrying chroma >= CHROMA_MIN.
   * `dominantMax` caps the single biggest bin: the bible's warm family (ash,
   * ember, sulphur, chitin) legitimately occupies most of the frame, so this is
   * not asking for an even distribution — it is asking that the warm family not
   * be literally the only thing present. 100% and 98% were the failing
   * measurements; 72% still reads as an ochre world.
   */
  dominantBinMax: 0.72,
  /**
   * Warm family = bins 0 and 1 (hue 0-60), which is where ember `#c4551f`
   * (h=22), sulphur `#c99a5c` (h=32), ash `#8a7f72` (h=26) and chitin
   * `#d8c9a4` (h=41) all land. Capping the family, not just one bin, is what
   * stops a grade from passing by splitting the same orange across a bin edge.
   */
  warmFamilyMax: 0.88,
  /**
   * Cool mass: bins covering hue 150-300, i.e. bioluminescent teal `#3fd6c0`
   * (h=170), violet `#8f6bff` (h=256), and the blue-grey a basalt face takes on
   * when its only light is sky. At least this fraction of chroma-bearing pixels
   * must live there or the frame has one temperature, which is the defect.
   */
  coolMassMin: 0.06,

  /**
   * Saturation discipline. Mean HSV saturation over the whole frame: the world
   * is "desaturated ochres and greys", and ash `#8a7f72` is itself only 0.17.
   * Frames measured at 0.41 in the failing rounds — that is an orange bath.
   */
  meanSatMax: 0.34,
  /**
   * ...and a FLOOR, which is the check the failing rounds most needed and did
   * not have. Every previous round answered "too much orange" by pulling
   * chroma, and every round the result was a beige bath instead of an orange
   * one — measured at 0.10 to 0.14 mean saturation, i.e. *below* the bible's
   * own ash swatch (`#8a7f72`, 0.174), which means the ground was greyer than
   * the palette says the ground is. A one-sided saturation target cannot tell
   * a disciplined palette from a desaturated one, and "desaturate until the
   * complaint stops" is a local minimum this file exists to prevent the next
   * agent from walking into. Ash 0.17, basalt 0.19, verdigris 0.22, chitin
   * 0.24: a frame made of those cannot honestly mean under 0.16.
   */
  meanSatMin: 0.16,
  /**
   * ...but not by flattening everything to grey. Bioluminescence and lava are
   * *allowed* to be vivid and the bible says that contrast "is the whole look",
   * so the top of the frame's saturation distribution has to actually reach
   * vivid. Both bounds together are the discipline; either alone is satisfiable
   * by a mistake — "desaturate until the complaint stops" passes the ceiling
   * and "leave the orange bath alone" passes the floor.
   *
   * Stated as the 99.9th PERCENTILE of saturation rather than as the fraction
   * of the frame above a threshold, because a fraction confounds two different
   * things: whether the grade preserves an accent, and how much emissive area
   * this particular vantage happens to contain. Red Mountain seen from six
   * kilometres has a few hundred pixels of lava in it and a coastal vantage at
   * dusk has one glow-cap; a fraction target calls both failures while a
   * percentile asks the question actually being asked — when this frame's most
   * saturated pixels are an ember, do they come out as one?
   */
  satP999Min: 0.55,
};

/**
 * Two frames are optically thick media rather than lit scenes, and the checks
 * that describe a lit scene are the wrong questions to ask them. This is not an
 * exemption list for frames that fail — it is a different, and still failable,
 * target for frames whose physics differ:
 *
 *  - `ashstorm` is the signature weather. From the near plane outward the
 *    frame is suspended ash lit by a diffuse sky; a single-hue, narrow-range
 *    image is what that IS, and manufacturing contrast in it with a grade
 *    would be the "grey fog wall" the bible names as a Morrowind-era defect.
 *    It still has to reach a real black in its foreground and still has to
 *    hold silhouette separation, so range and p1 are kept, just lower.
 *  - `underwater` is twenty metres of water. Water absorbs red first; a
 *    monochrome cyan frame is the material model working, not failing. The
 *    hue checks are meaningless here and the range floor is lower still.
 *
 * Anything not listed gets the full set.
 */
const PER_FRAME = {
  ashstorm: { rangeStopsMin: 1.9, p1Max: 120, hue: false, meanSatMin: 0.12 },
  underwater: { rangeStopsMin: 1.3, p1Max: 60, p99Min: 70, hue: false, satP999Min: 0.30, meanSatMin: 0.12 },
};

/**
 * A pixel enters the hue histogram if it carries this much SATURATION —
 * (max - min) / max, the same quantity the bible's swatches are quoted in —
 * and is at least this bright.
 *
 * The saturation part matters more than it looks. The first version of this
 * script thresholded on absolute chroma (max - min), which scales with
 * luminance, so a shadow at 29,32,37 measures 0.031 and was dropped while the
 * same colour at 190,209,242 measures 0.204 and was kept. The effect is that
 * the histogram could only ever see the bright half of the frame — which in a
 * sunlit exterior is the sky and the lit ground, i.e. exactly the warm mass —
 * and it reported 100% warm on frames whose entire shadow population had
 * already been graded to hue 218. Measured after the fix on the same PNGs,
 * 22.7% of the dawn frame sits under luma 0.24 and 83% of that is cool. A
 * regression check that cannot see shadows is worse than none, because it
 * certifies the defect it was written to catch.
 *
 * The luminance floor is the other half: under 8/255 the 8-bit grid cannot
 * represent a hue to better than about 30 degrees, so those pixels would add
 * quantisation noise to the histogram rather than signal.
 */
const SAT_MIN = 0.10;
const LUMA_MIN = 8 / 255;
/** Sky is excluded from nothing: it is part of the palette and part of the problem. */

const BIN_DEG = 30;
const NBINS = 360 / BIN_DEG;
const BIN_NAME = [
  '  0-30 ember', ' 30-60 sulphur', ' 60-90 olive', ' 90-120 green',
  '120-150 verdigris', '150-180 TEAL', '180-210 cyan', '210-240 BASALT-BLUE',
  '240-270 VIOLET', '270-300 magenta', '300-330 rose', '330-360 red',
];
/** Bins 5..9 — teal, cyan, basalt-blue, violet, magenta. */
const COOL_BINS = [5, 6, 7, 8, 9];
const WARM_BINS = [0, 1];

function quantile(hist, total, q) {
  let acc = 0;
  const want = total * q;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= want) return i;
  }
  return 255;
}

export function analyse(file) {
  const png = PNG.sync.read(readFileSync(file));
  const { data, width, height } = png;
  const lumaHist = new Float64Array(256);
  const hueBins = new Float64Array(NBINS);
  let satSum = 0;
  const satHist = new Float64Array(256);
  let chromaPixels = 0;
  let n = 0;
  // Sub-sample on a 2x2 grid: 500k samples is far more than enough for
  // percentiles and keeps the whole eight-shot set under a second.
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 500_000)));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumaHist[Math.min(255, Math.round(luma * 255))]++;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const c = mx - mn;
      const sat = mx > 1e-6 ? c / mx : 0;
      satSum += sat;
      satHist[Math.min(255, Math.round(sat * 255))]++;
      if (sat >= SAT_MIN && luma >= LUMA_MIN) {
        let h;
        if (mx === r) h = ((g - b) / c) % 6;
        else if (mx === g) h = (b - r) / c + 2;
        else h = (r - g) / c + 4;
        h *= 60;
        if (h < 0) h += 360;
        hueBins[Math.min(NBINS - 1, Math.floor(h / BIN_DEG))]++;
        chromaPixels++;
      }
      n++;
    }
  }

  const p1 = quantile(lumaHist, n, 0.01);
  const p50 = quantile(lumaHist, n, 0.5);
  const p99 = quantile(lumaHist, n, 0.99);
  // Stops between the two ends, in linear light. +1 guards a p1 of zero.
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const rangeStops = Math.log2((lin(p99) + 1e-4) / (lin(p1) + 1e-4));

  const hueFrac = chromaPixels ? Array.from(hueBins, (v) => v / chromaPixels) : new Array(NBINS).fill(0);
  const dominant = Math.max(...hueFrac);
  const dominantBin = hueFrac.indexOf(dominant);
  const warmFamily = WARM_BINS.reduce((s, i) => s + hueFrac[i], 0);
  const coolMass = COOL_BINS.reduce((s, i) => s + hueFrac[i], 0);

  return {
    name: basename(file, '.png'),
    p1, p50, p99, rangeStops,
    hueFrac, dominant, dominantBin, warmFamily, coolMass,
    chromaFrac: chromaPixels / n,
    meanSat: satSum / n,
    satP999: quantile(satHist, n, 0.999) / 255,
  };
}

function checks(m) {
  const T = { ...TARGETS, ...(PER_FRAME[m.name] ?? {}) };
  const out = [
    ['range', m.rangeStops >= T.rangeStopsMin, `${m.rangeStops.toFixed(2)} stops (>=${T.rangeStopsMin})`],
    ['p1', m.p1 <= T.p1Max, `${m.p1} (<=${T.p1Max})`],
    ['p99', m.p99 >= T.p99Min, `${m.p99} (>=${T.p99Min})`],
  ];
  if (T.hue !== false) out.push(
    ['hue-dom', m.dominant <= T.dominantBinMax, `${(m.dominant * 100).toFixed(1)}% in ${BIN_NAME[m.dominantBin].trim()} (<=${T.dominantBinMax * 100}%)`],
    ['hue-warm', m.warmFamily <= T.warmFamilyMax, `${(m.warmFamily * 100).toFixed(1)}% warm (<=${T.warmFamilyMax * 100}%)`],
    ['hue-cool', m.coolMass >= T.coolMassMin, `${(m.coolMass * 100).toFixed(1)}% cool (>=${T.coolMassMin * 100}%)`],
  );
  out.push(
    ['sat-hi', m.meanSat <= T.meanSatMax, `${m.meanSat.toFixed(3)} (<=${T.meanSatMax})`],
    ['sat-lo', m.meanSat >= T.meanSatMin, `${m.meanSat.toFixed(3)} (>=${T.meanSatMin})`],
    ['sat-vivid', m.satP999 >= T.satP999Min, `p99.9 ${m.satP999.toFixed(3)} (>=${T.satP999Min})`],
  );
  return out;
}

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const dirs = argv.filter((a) => !a.startsWith('--'));
const dir = dirs[0] ?? 'shots/iter11';
if (!existsSync(dir)) { console.error(`no such directory: ${dir}`); process.exit(2); }
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
if (!files.length) { console.error(`no PNGs in ${dir}`); process.exit(2); }

const rows = files.map((f) => analyse(join(dir, f)));

if (JSON_OUT) {
  console.log(JSON.stringify({ dir, targets: TARGETS, rows }, null, 2));
  process.exit(0);
}

console.log(`\nPALETTE CHECK — ${dir}   (${rows.length} frames)\n`);
const W = 11;
console.log(
  'frame'.padEnd(W) + 'p1'.padStart(5) + 'p50'.padStart(5) + 'p99'.padStart(5) +
  'stops'.padStart(7) + 'dom%'.padStart(7) + 'warm%'.padStart(7) + 'cool%'.padStart(7) +
  'sat'.padStart(7) + 'satP999'.padStart(9) + '  verdict'
);
console.log('-'.repeat(W + 5 + 5 + 5 + 7 + 7 + 7 + 7 + 7 + 8 + 12));

let nFail = 0;
const failReasons = new Map();
for (const m of rows) {
  const c = checks(m);
  const bad = c.filter(([, ok]) => !ok);
  if (bad.length) nFail++;
  for (const [k] of bad) failReasons.set(k, (failReasons.get(k) ?? 0) + 1);
  console.log(
    m.name.padEnd(W) +
    String(m.p1).padStart(5) + String(m.p50).padStart(5) + String(m.p99).padStart(5) +
    m.rangeStops.toFixed(2).padStart(7) +
    (m.dominant * 100).toFixed(1).padStart(7) +
    (m.warmFamily * 100).toFixed(1).padStart(7) +
    (m.coolMass * 100).toFixed(1).padStart(7) +
    m.meanSat.toFixed(3).padStart(7) +
    m.satP999.toFixed(3).padStart(9) +
    (bad.length ? `  FAIL ${bad.map(([k]) => k).join(',')}` : '  PASS')
  );
}

console.log('\nhue histogram (fraction of chroma-bearing pixels per 30-degree bin)');
console.log('bin'.padEnd(22) + rows.map((r) => r.name.slice(0, 6).padStart(8)).join(''));
for (let b = 0; b < NBINS; b++) {
  const any = rows.some((r) => r.hueFrac[b] >= 0.005);
  if (!any) continue;
  console.log(
    BIN_NAME[b].padEnd(22) +
    rows.map((r) => (r.hueFrac[b] * 100).toFixed(1).padStart(8)).join('')
  );
}

const agg = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
console.log(
  `\nset means:  stops ${agg((r) => r.rangeStops).toFixed(2)}` +
  `   warm ${(agg((r) => r.warmFamily) * 100).toFixed(1)}%` +
  `   cool ${(agg((r) => r.coolMass) * 100).toFixed(1)}%` +
  `   sat ${agg((r) => r.meanSat).toFixed(3)}`
);

if (nFail) {
  console.log(`\nFAIL — ${nFail}/${rows.length} frames outside palette targets`);
  console.log('  failing checks: ' + [...failReasons].map(([k, v]) => `${k} x${v}`).join(', '));
  process.exit(1);
}
console.log(`\nPASS — ${rows.length}/${rows.length} frames inside palette targets`);
