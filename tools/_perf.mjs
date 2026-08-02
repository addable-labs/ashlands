import { launch } from 'puppeteer-core';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';
const b = await launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new',
  args:['--window-size=1920,1080','--use-angle=metal','--ignore-gpu-blocklist','--enable-gpu-rasterization','--hide-scrollbars','--mute-audio'],
  defaultViewport:{width:1920,height:1080,deviceScaleFactor:1}});
const p = await b.newPage();
await p.goto('http://127.0.0.1:5178/', { waitUntil:'networkidle2', timeout:90_000 });
await p.waitForFunction('!!window.engine', { timeout:180_000 });
const framed = await p.evaluate(FRAMING_FN);
const fr = framed.framing.vale;
await p.evaluate((fr) => {
  const ctx = window.engine.ctx;
  ctx.clock.hour = 12; ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
  ctx.get('sky')?.setWeather?.('clear', 0);
  const pl = ctx.get('player'); if (pl) pl.freefly = true;
  pl?.teleport?.(fr.x, fr.z, fr.h);
  pl?.setLook?.(fr.yaw, fr.pitchRad != null ? fr.pitchRad : (fr.pitch*Math.PI)/180);
}, fr);
await sleep(3000);
const meas = async () => {
  const runs = [];
  for (let k = 0; k < 5; k++) {
    runs.push(await p.evaluate(async () => {
      let n = 0; const t0 = performance.now();
      await new Promise((r) => { const l = () => { if (++n < 120) requestAnimationFrame(l); else r(); }; requestAnimationFrame(l); });
      return (performance.now() - t0) / n;
    }));
  }
  runs.sort((a, c) => a - c);
  return runs[2]; // median of five, in ms/frame
};
// Interleaved A/B/A/B. The machine this runs on is shared with other agents'
// builds, so absolute ms is meaningless and even a sequential A-then-B is
// confounded by drift; paired samples taken seconds apart are not.
const ON  = { blackPoint: true,  bilateralLegacy: false };
const OFF = { blackPoint: false, bilateralLegacy: true  };
const pairs = [];
for (let i = 0; i < 6; i++) {
  await p.evaluate((c) => Object.assign(window.RENDER_DEBUG, c), OFF);
  await sleep(700); const off = await meas();
  await p.evaluate((c) => Object.assign(window.RENDER_DEBUG, c), ON);
  await sleep(700); const on = await meas();
  pairs.push([off, on]);
  console.log(`  pair ${i}: pre-round ${off.toFixed(2)} ms   this round ${on.toFixed(2)} ms   delta ${(on - off).toFixed(2)} ms`);
}
const deltas = pairs.map(([o, n]) => n - o).sort((a, c) => a - c);
console.log(`median delta over 6 paired samples: ${deltas[2].toFixed(2)} ms/frame`);
await b.close();
