/**
 * What does the architecture point-light pool cost the WHOLE frame?
 *
 * The pool is six PointLights resident in the scene for the session. three
 * counts every visible point light into NUM_POINT_LIGHTS regardless of its
 * intensity (verified in WebGLLights.setup — there is no intensity test), so
 * every material in the game — terrain, flora, water, actors, architecture —
 * compiles six point-light lobes and evaluates them at every fragment, in every
 * shot, whether or not a lamp is anywhere near the camera.
 *
 * Toggling `light.visible` changes the count and forces a full program
 * recompile, so this is not a runtime optimisation — but after the recompile
 * settles it measures exactly what the pool costs, which is the number needed
 * to decide whether the pool should be smaller.
 *
 *   node tools/diaglights.mjs --url http://127.0.0.1:5193/
 */
import { launch } from 'puppeteer-core';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';

const SHOTS = {
  dawn: { hour: 6.2, weather: 'clear' },
  redmtn: { hour: 10.0, weather: 'cloudy' },
  vale: { hour: 12.0, weather: 'clear' },
  ridge: { hour: 8.4, weather: 'clear' },
};
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const URL = flag('url', 'http://127.0.0.1:5178/');
const REPS = +flag('reps', 5);

const b = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--window-size=1920,1080', '--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.engine', { timeout: 600000 });
const framed = await p.evaluate(FRAMING_FN);

await p.evaluate(() => {
  window.__L = {
    lights() {
      const out = [];
      window.engine.ctx.scene.traverse((o) => { if (o.isPointLight) out.push(o); });
      return out;
    },
    set(v) { for (const l of this.lights()) l.visible = v; return this.lights().length; },
    async block(frames = 34) {
      await new Promise((res) => { let n = 0; const l = () => { if (++n < 10) requestAnimationFrame(l); else res(); }; requestAnimationFrame(l); });
      let n = 0; const t0 = performance.now();
      await new Promise((res) => { const l = () => { if (++n < frames) requestAnimationFrame(l); else res(); }; requestAnimationFrame(l); });
      return (performance.now() - t0) / n;
    },
    live() {
      let n = 0;
      for (const l of this.lights()) if (l.visible && l.intensity > 0.001) n++;
      return n;
    },
  };
});
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[(s.length / 2) | 0]; };

for (const name of Object.keys(SHOTS)) {
  const fr = framed.framing[name];
  if (!fr) continue;
  await p.evaluate((s, fr) => {
    const ctx = window.engine.ctx;
    ctx.clock.hour = s.hour;
    ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.(s.weather, 0);
    const pl = ctx.get('player'); if (pl) pl.freefly = true;
    pl?.teleport?.(fr.x, fr.z, fr.h);
    pl?.setLook?.(fr.yaw, (fr.pitch * Math.PI) / 180);
  }, SHOTS[name], fr);
  await sleep(2600);
  const nLights = await p.evaluate(() => window.__L.lights().length);
  const live = await p.evaluate(() => window.__L.live());
  const on = [], off = [];
  for (let k = 0; k < REPS; k++) {
    await p.evaluate(() => window.__L.set(true));
    await sleep(900);
    on.push(await p.evaluate(() => window.__L.block()));
    await p.evaluate(() => window.__L.set(false));
    await sleep(900);
    off.push(await p.evaluate(() => window.__L.block()));
  }
  await p.evaluate(() => window.__L.set(true));
  console.log(`${name}: pool ${nLights} lights, ${live} with nonzero intensity — with ${med(on).toFixed(1)}ms, without ${med(off).toFixed(1)}ms => pool costs ${(med(on) - med(off)).toFixed(1)}ms`);
}
await b.close();
