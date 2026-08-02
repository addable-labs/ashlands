/**
 * Near-plane architecture check: stand in the settlement and look at it.
 *
 * The canonical shots all view the village (or nothing of it) from hundreds of
 * metres, which is exactly where the footprint gates in the arch shader switch
 * everything off — so they cannot show whether the CLOSE range still has its
 * triplanar detail, its rain streaks and its instanced props.
 *
 *   node tools/diagvillage.mjs --tag arch-after [--url ...]
 */
import { launch } from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const URL = flag('url', 'http://127.0.0.1:5178/');
const TAG = flag('tag', 'village');
const dir = `shots/${TAG}`;
await mkdir(dir, { recursive: true });

const b = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
});
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.engine', { timeout: 600000 });

// The prop batches are the densest part of the settlement; their combined
// bounding centre is the middle of the street network.
const site = await p.evaluate(() => {
  const root = window.engine.ctx.scene.getObjectByName('architecture');
  const c = new (window.RENDER_THREE.Vector3)();
  let n = 0;
  root.traverse((o) => {
    if (!o.isInstancedMesh || !o.boundingSphere) return;
    c.add(o.boundingSphere.center.clone().applyMatrix4(o.matrixWorld));
    n++;
  });
  if (n > 0) c.divideScalar(n);
  return { x: c.x, y: c.y, z: c.z, n };
});
console.log('settlement centre', JSON.stringify(site));

const VIEWS = [
  { name: 'street', hour: 9.0, d: 26, h: 2.0, pitch: 0 },
  { name: 'close', hour: 15.0, d: 9, h: 1.7, pitch: -4 },
  { name: 'night', hour: 22.5, d: 30, h: 2.4, pitch: 0 },
];
for (const v of VIEWS) {
  const r = await p.evaluate((site, v) => {
    const ctx = window.engine.ctx;
    ctx.clock.hour = v.hour;
    ctx.get('sky')?.setWeather?.('clear', 0);
    const t = ctx.get('terrain');
    const pl = ctx.get('player'); if (pl) pl.freefly = true;
    const px = site.x + v.d, pz = site.z + v.d;
    pl?.teleport?.(px, pz, v.h);
    pl?.setLook?.(Math.atan2(site.x - px, site.z - pz) + Math.PI, (v.pitch * Math.PI) / 180);
    return { px, pz, ground: t.heightAt(px, pz) };
  }, site, v);
  await sleep(3200);
  await writeFile(`${dir}/${v.name}.png`, await p.screenshot({ type: 'png' }));
  console.log(`${dir}/${v.name}.png ${JSON.stringify(r)}`);
}
await b.close();
