#!/usr/bin/env node
/** Screenshot tools/_hand/view.html through vite + headless Chrome. */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const URL = 'http://127.0.0.1:5179/tools/_hand/view.html';
async function up() { try { return (await fetch('http://127.0.0.1:5179/', { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) {
  vite = spawn('npx', ['vite', '--port', '5179', '--host', '127.0.0.1'], { stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
}
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1440,1020'],
  defaultViewport: { width: 1440, height: 1020 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 300)); });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY === true', { timeout: 30000 }).catch(() => {});
await sleep(600);
await writeFile('shots/hand-chirality.png', await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1400, height: 1000 } }));
console.log(errs.length ? errs.join('\n') : 'no page errors');
console.log('wrote shots/hand-chirality.png');
await browser.close();
if (vite) vite.kill();
