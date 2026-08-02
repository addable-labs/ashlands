#!/usr/bin/env node
/**
 * Fast single-pose viewmodel capture, for iterating on one hand.
 *
 * tools/viewmodel.mjs is the full sweep and takes minutes; this boots once and
 * grabs four frames — sword at rest, shield block, both fists, and a fist
 * guard — which are the poses where a hand's orientation about its own grip
 * axis is decided by a hand-tuned number rather than by the weapon anchor.
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const URL = 'http://127.0.0.1:5178/';
const OUT = process.env.OUT ?? 'shots/vmpose';

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) {
  vite = spawn('npx', ['vite', '--port', '5178', '--host', '127.0.0.1'], { stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
}
await mkdir(OUT, { recursive: true });

const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1600,900', '--mute-audio'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 240)); });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(1200);

const shot = async (name) => { await writeFile(`${OUT}/${name}.png`, await page.screenshot({ type: 'png' })); console.log('  shot', name); };

await page.evaluate(async () => {
  const ctx = window.engine.ctx, p = ctx.get('player'), t = ctx.get('terrain');
  p.freefly = false;
  ctx.input.pointerLocked = true;
  ctx.clock.hour = 11;
  let best = null;
  for (let x = -400; x <= 400; x += 40) {
    for (let z = -400; z <= 400; z += 40) {
      const h = t.heightAt(x, z);
      if (h < 2 || h > 60) continue;
      const n = t.normalAt(x, z);
      if (!best || n.y > best.flat) best = { x, z, flat: n.y };
    }
  }
  p.teleport(best.x, best.z, 0.2);
  p.setLook(0.7, -0.06);
  await new Promise((r) => setTimeout(r, 1200));
});

const press = (b) => page.evaluate((b) => { window.engine.ctx.input.buttons.add(b); }, b);
const release = (b) => page.evaluate((b) => { window.engine.ctx.input.buttons.delete(b); }, b);

await page.evaluate(() => { window.engine.ctx.get('combat').equip(0); window.engine.ctx.get('combat').setShield('wooden_shield'); });
await sleep(600);
await shot('rest-sword');
await press(2); await sleep(800); await shot('block'); await release(2);
await sleep(500);
await page.evaluate(() => { window.engine.ctx.get('combat').equip(6); window.engine.ctx.get('combat').setShield('none'); });
await sleep(700);
await shot('fists-rest');
await press(2); await sleep(700); await shot('fists-block'); await release(2);
await sleep(400);
await press(0); await sleep(400); await shot('fists-wind'); await release(0);
await sleep(140); await shot('fists-swing');

if (errors.length) { console.log('ERRORS:'); [...new Set(errors)].slice(0, 8).forEach((e) => console.log('  ' + e)); }
await browser.close();
vite?.kill();
