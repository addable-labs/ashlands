// Reads the terrain surface arrays back off the live engine and reports, per
// layer and per simulated mip level, how much contrast each channel actually
// carries. This is the measurement behind "reads as untextured clay": a band
// that modulates albedo by a channel can only deliver what that channel has.
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const PORT = process.env.PORT || '5178';
const URL = `http://127.0.0.1:${PORT}/`;
async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
if (!(await up())) { spawn('npx', ['vite', '--port', PORT, '--host', '127.0.0.1'], { stdio: 'ignore' }); for (let i = 0; i < 60 && !(await up()); i++) await sleep(500); }
const b = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=800,600', '--use-angle=metal', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 800, height: 600, deviceScaleFactor: 1 },
});
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
p.on('console', (m) => { const t = m.text(); if (t.startsWith('SURF')) console.log(t); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.waitForFunction('!!window.engine', { timeout: 240000 });
await p.waitForFunction(() => {
  const t = window.engine.ctx.get('terrain');
  return !!(t && t.ready);
}, { timeout: 240000 });
await sleep(1500);

const out = await p.evaluate(() => {
  const scene = window.engine.ctx.scene;
  let uni = null;
  scene.traverse((o) => {
    if (uni) return;
    const pm = o.userData && o.userData.prepassMaterial;
    if (pm && pm.uniforms && pm.uniforms.uAlbArr) { uni = pm.uniforms; return; }
    const m = o.material;
    if (m && m.uniforms && m.uniforms.uAlbArr) uni = m.uniforms;
  });
  if (!uni) return { err: 'no terrain uniforms found' };
  const SIZE = 512;
  const names = ['ash', 'ash_coarse', 'volcanic_rock', 'basalt', 'sand', 'lichen_grass', 'mud', 'lava_crust'];
  const rows = [];
  const grab = (tex, layer) => {
    const d = tex.image.data;
    const off = layer * SIZE * SIZE * 4;
    return d.subarray(off, off + SIZE * SIZE * 4);
  };
  const toLin = (c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  const lumOf = (buf, srgb) => {
    const n = SIZE * SIZE;
    const l = new Float64Array(n);
    for (let q = 0; q < n; q++) {
      const r = buf[q * 4], g = buf[q * 4 + 1], bl = buf[q * 4 + 2];
      l[q] = srgb ? (0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(bl))
                  : (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 255;
    }
    return l;
  };
  const chanOf = (buf, ch) => {
    const n = SIZE * SIZE;
    const l = new Float64Array(n);
    for (let q = 0; q < n; q++) l[q] = buf[q * 4 + ch] / 255;
    return l;
  };
  const down = (src, s) => {
    const h = s >> 1;
    const o = new Float64Array(h * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < h; i++) {
      o[j * h + i] = 0.25 * (src[(2 * j) * s + 2 * i] + src[(2 * j) * s + 2 * i + 1] + src[(2 * j + 1) * s + 2 * i] + src[(2 * j + 1) * s + 2 * i + 1]);
    }
    return o;
  };
  const stats = (a) => {
    let m = 0; for (const v of a) m += v; m /= a.length;
    let s = 0; for (const v of a) s += (v - m) * (v - m);
    return [m, Math.sqrt(s / a.length)];
  };
  const chain = (a0) => {
    const r = [];
    let cur = a0, s = SIZE;
    for (let k = 0; k <= 6; k++) {
      const [m, sd] = stats(cur);
      // relative contrast: std / mean, which is what a multiplicative modulator delivers
      r.push(k === 0 ? `m=${m.toFixed(4)} sd0=${sd.toFixed(4)}` : `sd${k}=${sd.toFixed(4)}`);
      if (s > 2) { cur = down(cur, s); s >>= 1; }
    }
    return r.join(' ');
  };
  for (let L = 0; L < 8; L++) {
    rows.push(`SURF alb ${names[L].padEnd(14)} ${chain(lumOf(grab(uni.uAlbArr.value, L), true))}`);
  }
  for (let L = 0; L < 8; L++) {
    rows.push(`SURF armA ${names[L].padEnd(13)} ${chain(chanOf(grab(uni.uArmArr.value, L), 3))}`);
  }
  for (let L = 0; L < 8; L++) {
    const buf = grab(uni.uNrmArr.value, L);
    rows.push(`SURF nrmX ${names[L].padEnd(13)} ${chain(chanOf(buf, 0))}`);
  }
  return { rows };
});
if (out.err) console.log('ERR', out.err); else for (const r of out.rows) console.log(r);
await b.close();
process.exit(0);
