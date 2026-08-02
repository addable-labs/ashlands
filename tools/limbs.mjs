#!/usr/bin/env node
/**
 * LIMB LAB — silhouette and form test for the viewmodel forearm and hand.
 *
 * Bundles the REAL forearmGeometry()/handGeometry() out of src/combat/Viewmodel.ts
 * (rolldown, in memory; the repo file is untouched), rasterises them in software
 * with an orthographic camera and writes:
 *
 *   shots/limb/fore-sil-<deg>.png   the black-shape-on-white silhouette test
 *   shots/limb/fore-lit-<deg>.png   the same view, shaded, so form is judgeable
 *   shots/limb/hand-<name>.png      hand studies incl. the chirality views
 *
 * and prints, per view, the measured half-width profile down the bone plus the
 * two numbers that decide "pipe or not": how far the widest point of the belly
 * stands PROUD of the straight line joining the ends (convex bulge) and how far
 * the wrist falls INSIDE it (concave tightening). A cone scores 0 on both.
 */
import { rolldown } from 'rolldown';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VM = resolve(ROOT, 'src/combat/Viewmodel.ts');
const OUT = resolve(ROOT, 'tools/_limbprobe.bundle.mjs');
const SHOTS = resolve(ROOT, 'shots/limb');
mkdirSync(SHOTS, { recursive: true });

console.log('Viewmodel.ts md5:', createHash('md5').update(readFileSync(VM)).digest('hex'));

const build = await rolldown({
  input: resolve(ROOT, 'tools/_limbentry.ts'),
  plugins: [{
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
      let out = code;
      for (const s of ['function forearmGeometry(', 'function upperArmGeometry(', 'function handGeometry(',
        'function mirrorZ(', 'function chainPoint(', 'function forearmSection(', 'function forearmRelief(',
        'const FORE =', 'const UPPER =', 'const FOREARM_GIRTH:', 'const FOREARM_RATIO:',
        'const FOREARM_GIRTH_PEAK =', 'const WRIST_RU =', 'const WRIST_RV =', 'const GRIP_LIFT =']) {
        if (!out.includes('\n' + s)) throw new Error('cannot expose: ' + s);
        out = out.replace('\n' + s, '\nexport ' + s);
      }
      return out;
    },
  }],
});
await build.write({ file: OUT, format: 'esm', inlineDynamicImports: true });
await build.close();

const M = await import(OUT);
const THREE = await import('three');

/* ------------------------------------------------------------------ png */

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(path, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

/* ----------------------------------------------------------- rasteriser */

/**
 * Orthographic software raster with a 3x3 supersample. `mode` is 'sil' (pure
 * black shape on white — the pipe test) or 'lit' (two-light lambert plus a rim,
 * which is what shows whether a curved profile is actually there).
 */
function render(geos, view, W, H, mode) {
  const SS = 3;
  const w = W * SS, h = H * SS;
  const zb = new Float32Array(w * h).fill(Infinity);
  const cb = new Float32Array(w * h * 3);
  const cov = new Uint8Array(w * h);
  const { eye, up, centre } = view;
  const scale = view.scale * SS;
  const fz = eye.clone().normalize();               // toward the viewer
  const fx = new THREE.Vector3().crossVectors(up, fz).normalize();
  const fy = new THREE.Vector3().crossVectors(fz, fx);
  const L1 = new THREE.Vector3(-0.45, 0.72, 0.53).normalize();
  const L2 = new THREE.Vector3(0.62, -0.2, 0.45).normalize();

  const project = (p) => {
    const d = p.clone().sub(centre);
    return [d.dot(fx) * scale + w / 2, h / 2 - d.dot(fy) * scale, -d.dot(fz)];
  };

  for (const { geo, colour } of geos) {
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    const idx = geo.getIndex();
    const P = [];
    const N = [];
    for (let i = 0; i < pos.count; i++) {
      P.push(project(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))));
      const n = new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      N.push([n.dot(fx), n.dot(fy), n.dot(fz)]);
    }
    const tri = (a, b, c) => {
      const A = P[a], B = P[b], C = P[c];
      const minx = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0])));
      const maxx = Math.min(w - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
      const miny = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1])));
      const maxy = Math.min(h - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
      const area = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
      if (Math.abs(area) < 1e-9) return;
      for (let y = miny; y <= maxy; y++) {
        for (let x = minx; x <= maxx; x++) {
          const px = x + 0.5, py = y + 0.5;
          let w0 = ((B[0] - A[0]) * (py - A[1]) - (px - A[0]) * (B[1] - A[1])) / area;
          let w1 = ((px - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (py - A[1])) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = A[2] * w2 + B[2] * w1 + C[2] * w0;
          const o = y * w + x;
          if (z >= zb[o]) continue;
          zb[o] = z;
          cov[o] = 1;
          if (mode === 'sil') { cb[o * 3] = 0; cb[o * 3 + 1] = 0; cb[o * 3 + 2] = 0; continue; }
          let nx = N[a][0] * w2 + N[b][0] * w1 + N[c][0] * w0;
          let ny = N[a][1] * w2 + N[b][1] * w1 + N[c][1] * w0;
          let nz = N[a][2] * w2 + N[b][2] * w1 + N[c][2] * w0;
          const il = 1 / Math.max(1e-6, Math.hypot(nx, ny, nz));
          nx *= il; ny *= il; nz *= il;
          const d1 = Math.max(0, nx * L1.x + ny * L1.y + nz * L1.z);
          const d2 = Math.max(0, nx * L2.x + ny * L2.y + nz * L2.z);
          const rim = Math.pow(1 - Math.max(0, nz), 3.0);
          const s = 0.10 + 0.95 * d1 + 0.28 * d2 + 0.35 * rim;
          for (let k = 0; k < 3; k++) cb[o * 3 + k] = Math.min(1, colour[k] * s);
        }
      }
    };
    for (let i = 0; i < idx.count; i += 3) tri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
  }

  // Downsample.
  const out = Buffer.alloc(W * H * 3);
  const bg = mode === 'sil' ? 1 : 0.93;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const o = (y * SS + sy) * w + (x * SS + sx);
          if (cov[o]) { r += cb[o * 3]; g += cb[o * 3 + 1]; b += cb[o * 3 + 2]; }
          else { r += bg; g += bg; b += bg; }
        }
      }
      const n = SS * SS;
      const o = (y * W + x) * 3;
      out[o] = Math.round(Math.min(1, Math.pow(r / n, 1 / 2.2)) * 255);
      out[o + 1] = Math.round(Math.min(1, Math.pow(g / n, 1 / 2.2)) * 255);
      out[o + 2] = Math.round(Math.min(1, Math.pow(b / n, 1 / 2.2)) * 255);
    }
  }
  return { rgb: out, cov, w, h, project };
}

/* --------------------------------------------------- silhouette measure */

/**
 * The half-width of the projected silhouette at 21 stations down the bone,
 * measured off the geometry (not the raster), plus the two numbers that decide
 * pipe-or-not against the chord joining the 10% and 95% stations.
 */
function widthProfile(geo, len, viewDir) {
  const pos = geo.getAttribute('position');
  const d = viewDir.clone().normalize();
  const ax = new THREE.Vector3(0, 1, 0);
  const across = new THREE.Vector3().crossVectors(d, ax).normalize();
  const N = 21;
  const lo = new Float64Array(N).fill(Infinity);
  const hi = new Float64Array(N).fill(-Infinity);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const t = v.y / len;
    if (t < 0 || t > 1) continue;
    const k = Math.round(t * (N - 1));
    const a = v.dot(across);
    if (a < lo[k]) lo[k] = a;
    if (a > hi[k]) hi[k] = a;
  }
  const wdt = [];
  for (let k = 0; k < N; k++) wdt.push(hi[k] > lo[k] ? (hi[k] - lo[k]) * 0.5 : 0);
  // TWO chords, because one cannot see both events. A forearm's outline is
  // convex over its proximal half (the bellies bulge OUT of the line joining
  // the ends) and concave over its distal half (it falls fast, then flattens,
  // so it hollows IN). Measured against a single end-to-end chord those two
  // partly cancel; measured separately they are the two numbers that say
  // whether the shape is a limb or a lathe turning.
  const dev = (i0, i1, sign) => {
    let best = 0, at = 0;
    for (let k = i0; k <= i1; k++) {
      const f = (k - i0) / (i1 - i0);
      const line = wdt[i0] + (wdt[i1] - wdt[i0]) * f;
      const dv = (wdt[k] - line) * sign;
      if (dv > best) { best = dv; at = k / (N - 1); }
    }
    return { d: best * sign, at };
  };
  const b = dev(1, 10, 1);     // t 0.05 .. 0.50, convex belly
  const w = dev(10, 18, -1);   // t 0.50 .. 0.90, concave tightening
  return { wdt, bulge: b.d, bulgeAt: b.at, waist: w.d, waistAt: w.at, N };
}

/**
 * Winding and normal sanity. A mirrored build that forgot to reverse triangle
 * order is a hand-shaped HOLE, and it is invisible in any renderer that does
 * not cull — so it is checked arithmetically instead:
 *
 *   volume   signed volume of the closed islands, sum of (a x b).c / 6. Positive
 *            for outward winding; a mirror with the order left alone flips it.
 *   agree    fraction of triangles whose winding normal agrees with the
 *            interpolated vertex normal. Must be ~1.
 */
function windingCheck(geo) {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const idx = geo.getIndex();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), fn = new THREE.Vector3();
  let vol = 0, agree = 0, n = 0;
  for (let i = 0; i < idx.count; i += 3) {
    const ia = idx.getX(i), ib = idx.getX(i + 1), ic = idx.getX(i + 2);
    a.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia));
    b.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib));
    c.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic));
    vol += a.clone().cross(b).dot(c) / 6;
    fn.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
    if (fn.lengthSq() < 1e-18) continue;
    fn.normalize();
    const vx = (nrm.getX(ia) + nrm.getX(ib) + nrm.getX(ic));
    const vy = (nrm.getY(ia) + nrm.getY(ib) + nrm.getY(ic));
    const vz = (nrm.getZ(ia) + nrm.getZ(ib) + nrm.getZ(ic));
    if (fn.x * vx + fn.y * vy + fn.z * vz > 0) agree++;
    n++;
  }
  return { vol, agree: agree / Math.max(1, n) };
}

/* ------------------------------------------------------------ the runs */

const FORE = M.FORE;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const SKIN = [0.44, 0.41, 0.47];

console.log(`\nFOREARM  len ${(FORE * 100).toFixed(1)} cm`);
{
  const geo = M.forearmGeometry(FORE);
  const tris = geo.getIndex().count / 3;
  console.log(`  triangles ${tris}, vertices ${geo.getAttribute('position').count}`);
  console.log('\n  half-width down the bone, mm (t = 0 elbow .. 1 wrist)');
  const best = { bulge: -1 };
  for (const deg of [0, 30, 60, 90, 120, 150]) {
    const a = (deg * Math.PI) / 180;
    const dir = V(Math.cos(a), 0, Math.sin(a));
    const pr = widthProfile(geo, FORE, dir);
    const row = pr.wdt.filter((_, i) => i % 2 === 0).map((x) => (x * 1000).toFixed(1).padStart(5)).join('');
    console.log(`  view ${String(deg).padStart(3)} deg  ${row}`);
    console.log(`               bulge +${(pr.bulge * 1000).toFixed(2)} mm @ t=${pr.bulgeAt.toFixed(2)}   waist ${(pr.waist * 1000).toFixed(2)} mm @ t=${pr.waistAt.toFixed(2)}`);
    if (pr.bulge > best.bulge) Object.assign(best, pr, { deg });

    const eye = dir.clone();
    const view = { eye, up: V(0, 1, 0), centre: V(0, FORE * 0.5, 0), scale: 3200 };
    const sil = render([{ geo, colour: [0, 0, 0] }], view, 420, 900, 'sil');
    writePNG(resolve(SHOTS, `fore-sil-${deg}.png`), 420, 900, sil.rgb);
    const lit = render([{ geo, colour: SKIN }], view, 420, 900, 'lit');
    writePNG(resolve(SHOTS, `fore-lit-${deg}.png`), 420, 900, lit.rgb);
  }
  console.log(`\n  WORST-CASE READ: strongest belly at ${best.deg} deg — bulge +${(best.bulge * 1000).toFixed(2)} mm, waist ${(best.waist * 1000).toFixed(2)} mm`);
  console.log('  (a lathed cone reads 0.00 / 0.00; anything under ~1.5 mm of bulge is still a pipe)');
  geo.dispose();
}

/* --------------------------------------------------------------- hand */

const SWORD = { x: 0.0168, z: 0.0134 };
{
  const r = M.handGeometry(SWORD, false, M.GRIP_LIFT);
  const l = { geo: M.mirrorZ(r.geo) };
  console.log(`\nHAND  triangles ${r.triangles}, vertices ${r.geo.getAttribute('position').count}`);
  const wr = windingCheck(r.geo);
  const wl = windingCheck(l.geo);
  console.log(`  winding  right: volume ${(wr.vol * 1e6).toFixed(1)} cm3, normals agree ${(wr.agree * 100).toFixed(1)}%`);
  console.log(`           left : volume ${(wl.vol * 1e6).toFixed(1)} cm3, normals agree ${(wl.agree * 100).toFixed(1)}%   (both must be POSITIVE)`);
  const centre = V(0, 0.03, 0);
  // Eyes on the hand's OWN palm normal (0.783, -0.075, -0.618), so these stay
  // the views they are named after if the chirality is ever revisited.
  const shots = [
    ['r-palmside', V(0.78, 0.15, -0.62), V(0, 1, 0)],
    ['r-backside', V(-0.78, 0.15, 0.62), V(0, 1, 0)],
    ['r-thumbside', V(0.2, 0.2, -1), V(0, 1, 0)],
    ['r-down', V(0.2, 1, -0.3), V(0, 0, 1)],
  ];
  for (const [name, eye, up] of shots) {
    const view = { eye, up, centre, scale: 3000 };
    writePNG(resolve(SHOTS, `hand-${name}.png`), 640, 720, render([{ geo: r.geo, colour: SKIN }], view, 640, 720, 'lit').rgb);
  }
  const view = { eye: V(0.78, 0.15, 0.62), up: V(0, 1, 0), centre, scale: 3000 };
  writePNG(resolve(SHOTS, 'hand-l-palmside.png'), 640, 720, render([{ geo: l.geo, colour: SKIN }], view, 640, 720, 'lit').rgb);

  /* ---- the decisive view, and it is decided arithmetically, not by eye.
   *
   * Hold a hand PALM TOWARD YOU with the fingers pointing UP. A right hand puts
   * its thumb on the viewer's RIGHT; a left hand on the viewer's LEFT. So put
   * the camera on the palm normal N with the finger axis F as up, and report
   * which side of screen centre the thumb's own vertices land on. Both hands
   * are rendered from their own N/F, so the two images are the same view of two
   * different hands rather than two views of one.
   */
  const axes = (geo, sgn) => {
    // N and F straight off the mesh: N is the mean inward radial over the palm
    // shell (see handedness.mjs), F is wrist -> the mass of the knuckles.
    const pos = geo.getAttribute('position');
    const P = [];
    for (let i = 0; i < pos.count; i++) P.push(V(pos.getX(i), pos.getY(i), pos.getZ(i)));
    const N = new THREE.Vector3();
    let n = 0;
    for (const v of P) {
      // The palm slab: the shell vertices within a centimetre of the mid-palm
      // height and standing 2-4 cm off the grip axis.
      const rho = Math.hypot(v.x, v.z);
      if (v.y < 0.020 || v.y > 0.050 || rho < 0.018 || rho > 0.040) continue;
      N.add(V(-v.x, 0, -v.z).normalize());
      n++;
    }
    N.normalize();
    return { N, n };
  };
  for (const [name, geo, sgn] of [['right', r.geo, 1], ['left', l.geo, -1]]) {
    const { N } = axes(geo, sgn);
    const F = V(0, 1, 0).addScaledVector(N, -N.y).normalize();
    // The thumb: the nail island sits furthest from the grip axis on the far
    // side of the palm. Take it straight off the solved chain instead — exact.
    const thumb = sgn > 0 ? V(0.0291, 0.0582, -0.0249) : V(0.0291, 0.0582, 0.0249);
    const eye = N.clone();
    const fx = new THREE.Vector3().crossVectors(F, eye).normalize();  // screen right
    const side = thumb.clone().sub(V(0, 0.03, 0)).dot(fx);
    console.log(`  palm-toward-viewer, fingers up — ${name.padEnd(5)} hand: thumb falls to the viewer's `
      + `${side > 0 ? 'RIGHT' : 'LEFT'} (${(side * 1000).toFixed(1)} mm off centre)`);
    const v2 = { eye, up: F, centre: V(0, 0.03, 0), scale: 3000 };
    writePNG(resolve(SHOTS, `hand-chirality-${name}.png`), 640, 720, render([{ geo, colour: SKIN }], v2, 640, 720, 'lit').rgb);
  }
}

console.log(`\nwrote ${SHOTS}`);
