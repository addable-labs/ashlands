import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';
const URL='http://127.0.0.1:5178/';
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
let vite=null;
if(!(await up())){vite=spawn('npx',['vite','--port','5178','--host','127.0.0.1'],{stdio:'ignore'});for(let i=0;i<60&&!(await up());i++)await sleep(500);}
await mkdir('shots/aerial',{recursive:true});
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',
  args:['--use-angle=metal','--ignore-gpu-blocklist'],defaultViewport:{width:1280,height:720}});
const p=await b.newPage(); p.on('pageerror',e=>console.log('PAGEERROR:',e.message));
await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('!!window.engine',{timeout:180000});
const framed=await p.evaluate(FRAMING_FN); const fr=framed.framing.ridge;
await p.evaluate((a)=>{const c=window.engine.ctx;c.clock.hour=9;c.camera.fov=a.fov;c.camera.updateProjectionMatrix();
  c.get('sky')?.setWeather?.('clear',0);const pl=c.get('player');if(pl)pl.freefly=true;
  pl?.teleport?.(a.x,a.z,a.h);pl?.setLook?.(a.yaw,a.pitch*Math.PI/180);},fr);
await sleep(2500);
const dump = await p.evaluate(async ()=>{
  const m=await import('/src/sky/Atmosphere.ts');
  const u=m.aerialUniforms(); const o={};
  for(const k in u){const v=u[k].value;
    o[k]=(v&&v.toArray)?v.toArray().map(n=>+n.toPrecision(4)):(typeof v==='number'?+v.toPrecision(4):String(v));}
  window.__au=u; return o;});
console.log('--- aerial uniforms ---'); console.log(JSON.stringify(dump,null,1));
async function cap(n,fn){await p.evaluate(fn);await sleep(1500);
  await writeFile(`shots/aerial/${n}.png`,await p.screenshot({type:'png'}));console.log('wrote',n);}
await cap('0-base',()=>{});
await cap('1-nohaze',()=>{window.__au.uAerialHazeDensity.value=0;});
await cap('2-nomie',()=>{window.__au.uAerialMieMul.value=0;});
await cap('3-nobeta',()=>{const u=window.__au;u.uAerialBetaR.value.set(0,0,0);
  u.uAerialBetaMS.value.set(0,0,0);u.uAerialBetaME.value.set(0,0,0);});
await b.close(); vite?.kill();
