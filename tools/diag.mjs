import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const URL='http://127.0.0.1:5178/';
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
let vite=null;
if(!(await up())){vite=spawn('npx',['vite','--port','5178','--host','127.0.0.1'],{cwd:'/Users/peter/Development/morrowind',stdio:'ignore'});for(let i=0;i<60&&!(await up());i++)await sleep(500);}
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--use-angle=metal','--ignore-gpu-blocklist','--window-size=1280,720'],defaultViewport:{width:1280,height:720}});
const p=await b.newPage();
p.on('pageerror',e=>console.log('PAGEERROR:',e.message));
p.on('console',m=>{const t=m.text(); if(m.type()==='error'||/PROBE|boot|init/i.test(t)) console.log(`[${m.type()}]`,t.slice(0,300))});
const t0=Date.now();
await p.goto(URL,{waitUntil:'domcontentloaded'});
for(let i=0;i<40;i++){
  await sleep(3000);
  const s=await p.evaluate(()=>({
    eng: !!window.engine,
    label: document.getElementById('blabel')?.textContent,
    bar: document.querySelector('#bar>i')?.style.width,
    done: document.getElementById('boot')?.className,
    sys: window.engine ? Object.keys(window.engine).length : -1,
  }));
  console.log(`t=${((Date.now()-t0)/1000).toFixed(0)}s`, JSON.stringify(s));
  if(s.eng && s.done==='done') break;
}
await b.close(); vite?.kill();
