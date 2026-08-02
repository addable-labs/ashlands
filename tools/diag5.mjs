import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';
const URL='http://127.0.0.1:5178/';
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
let vite=null;
if(!(await up())){vite=spawn('npx',['vite','--port','5178','--host','127.0.0.1'],{stdio:'ignore'});for(let i=0;i<60&&!(await up());i++)await sleep(500);}
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',
  args:['--use-angle=metal','--ignore-gpu-blocklist'],defaultViewport:{width:1280,height:720}});
const p=await b.newPage();
p.on('pageerror',e=>console.log('PAGEERROR:',e.message));
await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('!!window.engine',{timeout:180000});
const framed=await p.evaluate(FRAMING_FN); const fr=framed.framing.redmtn;
await p.evaluate((a)=>{const c=window.engine.ctx;c.clock.hour=10;c.camera.fov=a.fov;c.camera.updateProjectionMatrix();
  c.get('sky')?.setWeather?.('clear',0);const pl=c.get('player');if(pl)pl.freefly=true;
  pl?.teleport?.(a.x,a.z,a.h);pl?.setLook?.(a.yaw,a.pitch*Math.PI/180);},fr);
await sleep(2500);
const log = await p.evaluate(async ()=>{
  const r=window.engine.ctx.renderer, orig=r.renderBufferDirect.bind(r);
  const rec=[]; let cap=true;
  r.renderBufferDirect=function(cam,scn,geo,mat,obj,grp){
    if(cap) rec.push({obj:obj.name||obj.type, mat:mat.type, matName:mat.name||'',
      idx:geo.index?geo.index.count:0, pos:geo.attributes.position?geo.attributes.position.count:0,
      inst:obj.isInstancedMesh?obj.count:(geo.instanceCount??-1), ro:obj.renderOrder,
      camType:cam.type, prog:mat.program?.id ?? -1});
    return orig(cam,scn,geo,mat,obj,grp);
  };
  await new Promise(res=>requestAnimationFrame(()=>requestAnimationFrame(res)));
  cap=false; r.renderBufferDirect=orig;
  return rec;
});
console.log(`total draws in 2 frames: ${log.length}`);
const seen=new Map();
for(const d of log){const k=`${d.obj}|${d.mat}|${d.matName}|${d.camType}`;
  const e=seen.get(k)||{...d,n:0};e.n++;seen.set(k,e);}
console.log('--- unique (object|material|camera) ---');
[...seen.values()].sort((a,b)=>b.n-a.n).forEach(d=>
  console.log(`${String(d.n).padStart(4)}x  obj=${d.obj.padEnd(18)} mat=${d.mat.padEnd(22)} name=${(d.matName||'-').padEnd(18)} cam=${d.camType.padEnd(20)} idx=${d.idx} inst=${d.inst} ro=${d.ro}`));
await b.close(); vite?.kill();
