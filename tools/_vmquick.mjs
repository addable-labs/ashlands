#!/usr/bin/env node
// One rest-sword frame, fast, for iterating on the grip.  OUT=dir node tools/_vmquick.mjs
import { launch } from 'puppeteer-core';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
const OUT = process.env.OUT ?? 'shots/vm-quick';
await mkdir(OUT, { recursive: true });
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1600,900', '--mute-audio'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:5178/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(1200);
await page.evaluate(async () => {
  const ctx = window.engine.ctx, p = ctx.get('player'), t = ctx.get('terrain');
  p.freefly = false; ctx.input.pointerLocked = true; ctx.clock.hour = 11;
  let best = null;
  for (let x = -400; x <= 400; x += 40) for (let z = -400; z <= 400; z += 40) {
    const h = t.heightAt(x, z); if (h < 2 || h > 60) continue;
    const n = t.normalAt(x, z); if (!best || n.y > best.flat) best = { x, z, flat: n.y };
  }
  p.teleport(best.x, best.z, 0.2); p.setLook(0.7, -0.06);
  await new Promise((r) => setTimeout(r, 1200));
});
for (const [i, name] of [[0, 'rest-sword'], [6, 'fists-rest']]) {
  await page.evaluate((i) => window.engine.ctx.get('combat').equip(i), i);
  await sleep(600);
  await writeFile(`${OUT}/${name}.png`, await page.screenshot({ type: 'png' }));
}
await browser.close();
console.log('ok');
