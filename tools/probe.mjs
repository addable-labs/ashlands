import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const URL='http://127.0.0.1:5178/';
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
let vite=null;
if(!(await up())){vite=spawn('npx',['vite','--port','5178','--host','127.0.0.1'],{cwd:'/Users/peter/Development/morrowind',stdio:'ignore'});for(let i=0;i<60&&!(await up());i++)await sleep(500);}
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--use-angle=metal','--ignore-gpu-blocklist'],defaultViewport:{width:1280,height:720}});
const p=await b.newPage(); await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('!!window.engine',{timeout:180000}); await sleep(1500);
console.log(JSON.stringify(await p.evaluate(()=>{
  const R=window.engine.ctx.get('rpg');
  const c=R.character;
  const inv=c?.inventory;
  const out={ rpgKeys:Object.keys(R).slice(0,30), charKeys:c?Object.keys(c).slice(0,25):null,
    invKeys:inv?Object.keys(inv).slice(0,25):null,
    invProto:inv?Object.getOwnPropertyNames(Object.getPrototypeOf(inv)).slice(0,30):null,
    statsKeys:Object.keys(R.stats()).slice(0,30) };
  if(inv){ for(const m of ['all','list','stacks','items','contents']) if(typeof inv[m]==='function'){
    try{ const v=inv[m](); out.sample={method:m, n:Array.isArray(v)?v.length:typeof v,
      first: Array.isArray(v)&&v[0]?JSON.stringify(v[0]).slice(0,220):null}; }catch(e){} } 
    if(Array.isArray(inv.stacks)) out.stacksArr={n:inv.stacks.length, first:JSON.stringify(inv.stacks[0]).slice(0,220)};
  }
  return out;}),null,1));
await b.close(); vite?.kill();
