// Dump the terrain albedo array slices to PNG so the source textures can be
// inspected for directional structure.  node tools/_surfdump.mjs [outdir]
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { PNG } from 'pngjs';
const PORT = process.env.PORT || '5178';
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.argv[2] || 'shots/surf';
async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) { vite = spawn('npx', ['vite', '--port', PORT, '--host', '127.0.0.1'], { stdio: 'ignore' }); for (let i = 0; i < 90 && !(await up()); i++) await sleep(500); }
mkdirSync(OUT, { recursive: true });
const b = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=800,600', '--use-angle=metal', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 800, height: 600, deviceScaleFactor: 1 },
});
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.waitForFunction('!!window.engine', { timeout: 240000 });
await p.waitForFunction(() => { const t = window.engine.ctx.get('terrain'); return !!(t && t.ready); }, { timeout: 240000 });
await sleep(1000);
const res = await p.evaluate(() => {
  const scene = window.engine.ctx.scene;
  let uni = null;
  scene.traverse((o) => {
    if (uni) return;
    const pm = o.userData && o.userData.prepassMaterial;
    if (pm && pm.uniforms && pm.uniforms.uAlbArr) { uni = pm.uniforms; return; }
    const m = o.material;
    if (m && m.uniforms && m.uniforms.uAlbArr) uni = m.uniforms;
  });
  if (!uni) return { err: 'no uniforms' };
  const S = 512, N = 8;
  const pick = (key) => {
    const t = uni[key].value;
    const d = t.image.data;
    return { w: t.image.width, h: t.image.height, n: t.image.depth, buf: Array.from(d.slice(0, S * S * 4 * N)) };
  };
  return { alb: pick('uAlbArr'), nrm: pick('uNrmArr'), arm: pick('uArmArr') };
});
await b.close(); vite?.kill();
if (res.err) { console.log(res.err); process.exit(1); }
const names = ['ash', 'ash_coarse', 'volcanic_rock', 'basalt', 'sand', 'lichen_grass', 'mud', 'lava_crust'];
for (const key of ['alb', 'nrm', 'arm']) {
  const { w, h, buf } = res[key];
  for (let l = 0; l < 8; l++) {
    const png = new PNG({ width: w, height: h });
    for (let i = 0; i < w * h; i++) {
      const s = l * w * h * 4 + i * 4;
      png.data[i * 4] = buf[s]; png.data[i * 4 + 1] = buf[s + 1];
      png.data[i * 4 + 2] = buf[s + 2]; png.data[i * 4 + 3] = 255;
    }
    writeFileSync(`${OUT}/${key}-${l}-${names[l]}.png`, PNG.sync.write(png));
  }
}
console.log('wrote', OUT);
