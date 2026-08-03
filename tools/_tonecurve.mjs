#!/usr/bin/env node
/**
 * The display chain in JS, so the tonemapper can be interrogated without a GPU.
 *
 * agx -> sRGB encode -> valueCurve(black, gain). Same constants as
 * src/render/shaders.ts. Used to answer, quantitatively, how much of the coast
 * sky's missing chroma is exposure and how much is the shoulder.
 */
const M = (m, v) => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];
// Column-major, exactly as the GLSL mat3 literals are read.
const SRGB_TO_REC2020 = [0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0113, 0.8956];
const REC2020_TO_SRGB = [1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187];
const AGX_INSET = [0.856627153315983, 0.137318972929847, 0.11189821299995,
  0.0951212405381588, 0.761241990602591, 0.0767994186031903,
  0.0482516061458583, 0.101439036467562, 0.811302368396859];
const AGX_OUTSET = [1.1271005818144368, -0.1413297634984383, -0.14132976349843826,
  -0.11060664309660323, 1.157823702216272, -0.11060664309660294,
  -0.016493938717834573, -0.016493938717834257, 1.2519364065950405];

const contrast = (x) => {
  const x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
};
const MIN_EV = -12.47393, MAX_EV = 4.026069;

export function agx(c) {
  let v = M(SRGB_TO_REC2020, c.map((x) => Math.max(x, 0)));
  v = M(AGX_INSET, v.map((x) => Math.max(x, 0)));
  v = v.map((x) => Math.min(1, Math.max(0, (Math.log2(Math.max(x, 1e-10)) - MIN_EV) / (MAX_EV - MIN_EV))));
  v = v.map(contrast);
  v = M(AGX_OUTSET, v);
  v = v.map((x) => Math.pow(Math.max(x, 0), 2.2));
  v = M(REC2020_TO_SRGB, v);
  return v.map((x) => Math.min(1, Math.max(0, x)));
}
export const encodeSrgb = (c) => c.map((x) =>
  x < 0.0031308 ? x * 12.92 : 1.055 * Math.pow(Math.max(x, 1e-5), 1 / 2.4) - 0.055);
export const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export function valueCurve(c, black, gain, shoulder = 0.70, toeKnee = 0.075) {
  const l0 = Math.max(luma(c), 1e-5);
  const u = l0 - black;
  const l1 = gain * 0.5 * (u + Math.sqrt(u * u + toeKnee * toeKnee));
  let o = c.map((x) => x * (l1 / l0));
  const mx = Math.max(...o);
  if (mx > shoulder) {
    const head = 1 - shoulder;
    const mxs = shoulder + head * (1 - Math.exp(-(mx - shoulder) / head));
    o = o.map((x) => x * (mxs / mx));
  }
  return o.map((x) => Math.min(1, Math.max(0, x)));
}

export const display = (exposedLinear, black, gain, shoulder) =>
  valueCurve(encodeSrgb(agx(exposedLinear)), black, gain, shoulder).map((x) => x * 255);

export const chromaOf = (rgb255) => Math.max(...rgb255) - Math.min(...rgb255);

/** Invert the chain numerically: find the exposed linear RGB that displays as `target`. */
export function invert(target255, black, gain, shoulder = 0.70) {
  let c = [0.3, 0.3, 0.35];
  for (let it = 0; it < 4000; it++) {
    const d = display(c, black, gain, shoulder);
    let moved = false;
    for (let i = 0; i < 3; i++) {
      const err = target255[i] - d[i];
      if (Math.abs(err) > 0.05) { c[i] *= Math.exp(err * 0.004); moved = true; }
      c[i] = Math.max(1e-5, c[i]);
    }
    if (!moved) break;
  }
  return c;
}

if (process.argv[1] && process.argv[1].endsWith('_tonecurve.mjs')) {
  const f = (a) => a.map((x) => x.toFixed(1).padStart(6)).join('');

  console.log('=== the shipped chain, a neutral-ish sky ramp ===');
  console.log('  exposed   ridge-curve(g2.60,b0.275)      coast-curve(g1.85,b0.147)');
  // A representative sulphur-over-blue sky: mildly blue-biased, chroma ratio fixed.
  const sky = [0.86, 0.95, 1.12];
  for (const s of [0.10, 0.15, 0.22, 0.30, 0.35, 0.45, 0.60, 0.70, 0.90, 1.2, 1.6]) {
    const e = sky.map((x) => x * s);
    const r = display(e, 0.275, 2.60), c = display(e, 0.147, 1.852);
    console.log(`  ${s.toFixed(2).padStart(6)}   ${f(r)}  c${chromaOf(r).toFixed(1).padStart(5)}    ` +
      `${f(c)}  c${chromaOf(c).toFixed(1).padStart(5)}`);
  }

  console.log('\n=== where does chroma go as a fixed-chroma colour is pushed up? ===');
  console.log('  agx alone (no value curve), same ramp');
  console.log('  exposed    agx+srgb (0-255)          chroma   ratio b/r');
  for (const s of [0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 1.0, 1.5, 2.5, 4.0, 8.0]) {
    const e = sky.map((x) => x * s);
    const d = encodeSrgb(agx(e)).map((x) => x * 255);
    console.log(`  ${s.toFixed(2).padStart(6)}   ${f(d)}   c${chromaOf(d).toFixed(1).padStart(5)}   ${(d[2] / d[0]).toFixed(3)}`);
  }
}
