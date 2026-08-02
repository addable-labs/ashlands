import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';
const URL='http://127.0.0.1:5178/';
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
let vite=null;
if(!(await up())){vite=spawn('npx',['vite','--port','5178','--host','127.0.0.1'],{stdio:'ignore'});for(let i=0;i<60&&!(await up());i++)await sleep(500);}
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',
  args:['--window-size=1920,1080','--use-angle=metal','--ignore-gpu-blocklist','--enable-gpu-rasterization'],defaultViewport:{width:1920,height:1080,deviceScaleFactor:1}});
const p=await b.newPage(); p.on('pageerror',e=>console.log('PAGEERROR:',e.message));
await p.goto(URL,{waitUntil:'networkidle2'});
await p.waitForFunction('!!window.engine',{timeout:180000});
const framed=await p.evaluate(FRAMING_FN);
const SHOTS={dawn:[6.2,'clear'],redmtn:[10,'cloudy'],vale:[12,'clear'],ridge:[8.4,'clear']};
const fpsFn=async()=>p.evaluate(async()=>{let n=0;const t0=performance.now();
  await new Promise(r=>{const l=()=>{if(++n<50)requestAnimationFrame(l);else r();};requestAnimationFrame(l);});
  return Math.round(n*1000/(performance.now()-t0));});
for(const name of Object.keys(SHOTS)){
  const fr=framed.framing[name]; if(!fr) continue;
  const [hour,w]=SHOTS[name];
  await p.evaluate((fr,hour,w)=>{const ctx=window.engine.ctx;ctx.clock.hour=hour;ctx.camera.fov=fr.fov;ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.(w,0);const pl=ctx.get('player');if(pl)pl.freefly=true;pl?.teleport?.(fr.x,fr.z,fr.h);pl?.setLook?.(fr.yaw,(fr.pitch*Math.PI)/180);},fr,hour,w);
  await sleep(2600);
  const setVis=(v)=>p.evaluate((v)=>{window.engine.ctx.scene.traverse(o=>{if(o.name==='terrain')o.visible=v;});},v);
  const ons=[],offs=[];
  for(let k=0;k<5;k++){
    await setVis(true); await sleep(500); ons.push(1000/await fpsFn());
    await setVis(false); await sleep(500); offs.push(1000/await fpsFn());
  }
  await setVis(true);
  const med=a=>a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)];
  const on=med(ons),off=med(offs);
  console.log(`${name}: frame ${on.toFixed(1)}ms (${(1000/on).toFixed(0)}fps)  no-terrain ${off.toFixed(1)}ms  TERRAIN ${(on-off).toFixed(1)}ms`);
}
await b.close(); vite?.kill();
