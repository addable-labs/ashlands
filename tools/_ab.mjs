#!/usr/bin/env node
/**
 * Back-to-back A/B of a single RENDER_DEBUG flag from one scene state.
 *   node tools/_ab.mjs <flag> <shot> [shot...]
 * Writes shots/_abOff/<shot>.png and shots/_abOn/<shot>.png.
 */
import { launch } from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';

const SHOTS = {
  dawn:{hour:6.2,weather:'clear'}, redmtn:{hour:10.0,weather:'cloudy'}, coast:{hour:17.6,weather:'clear'},
  night:{hour:23.4,weather:'clear'}, ashstorm:{hour:13.0,weather:'ashstorm'}, dusk:{hour:19.8,weather:'clear'},
  vale:{hour:12.0,weather:'clear'}, storm:{hour:15.0,weather:'rain'}, underwater:{hour:12.0,weather:'clear'},
  ridge:{hour:8.4,weather:'clear'},
};
const [flag, ...names] = process.argv.slice(2);
const wanted = names.length ? names : ['dusk'];
await mkdir('shots/_abOff', { recursive: true });
await mkdir('shots/_abOn', { recursive: true });
const browser = await launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new',
  args:['--window-size=1920,1080','--use-angle=metal','--ignore-gpu-blocklist','--enable-gpu-rasterization','--hide-scrollbars','--mute-audio'],
  defaultViewport:{width:1920,height:1080,deviceScaleFactor:1}});
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5178/', { waitUntil:'networkidle2', timeout:90_000 });
await page.waitForFunction('!!window.engine', { timeout:180_000 });
const framed = await page.evaluate(FRAMING_FN);
for (const name of wanted) {
  const fr = framed.framing[name]; if (!fr) continue;
  const s = SHOTS[name];
  await page.evaluate((s, fr) => {
    const ctx = window.engine.ctx;
    ctx.clock.hour = s.hour; ctx.camera.fov = fr.fov; ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.(s.weather, 0);
    const p = ctx.get('player'); if (p) p.freefly = true;
    if (fr.absY != null) { p?.teleport?.(fr.x, fr.z, 0); ctx.camera.position.set(fr.x, fr.absY, fr.z); }
    else p?.teleport?.(fr.x, fr.z, fr.h);
    p?.setLook?.(fr.yaw, fr.pitchRad != null ? fr.pitchRad : (fr.pitch*Math.PI)/180);
  }, s, fr);
  await sleep(2600);
  // Freeze the world clock so the two exposures are of the identical frame.
  await page.evaluate((f) => { window.RENDER_DEBUG[f] = false; }, flag);
  await sleep(700);
  await writeFile(`shots/_abOff/${name}.png`, await page.screenshot({ type:'png' }));
  await page.evaluate((f) => { window.RENDER_DEBUG[f] = true; }, flag);
  await sleep(700);
  await writeFile(`shots/_abOn/${name}.png`, await page.screenshot({ type:'png' }));
  await page.evaluate((f) => { window.RENDER_DEBUG[f] = false; }, flag);
  console.log(name);
}
await browser.close();
