import { launch } from 'puppeteer-core';
const b = await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',
  args:['--use-angle=metal','--ignore-gpu-blocklist'],defaultViewport:{width:640,height:400}});
const p = await b.newPage();
const errs=[];
p.on('console', m => { const t=m.text(); if(/ERROR|error|Shader|shader/.test(t)) errs.push(t.slice(0,900)); });
p.on('pageerror', e => errs.push('PAGEERROR '+e.message));
await p.goto(process.env.U, {waitUntil:'domcontentloaded', timeout:120000});
await p.waitForFunction('!!window.engine',{timeout:240000});
await new Promise(r=>setTimeout(r,9000));
console.log(errs.length ? errs.join('\n---\n') : 'NO SHADER ERRORS');
await b.close();
