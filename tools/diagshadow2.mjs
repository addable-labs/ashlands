import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';
const URL='http://127.0.0.1:5178/';
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
let vite=null;
if(!(await up())){vite=spawn('npx',['vite','--port','5178','--host','127.0.0.1'],{stdio:'ignore'});for(let i=0;i<60&&!(await up());i++)await sleep(500);}
await mkdir('shots/shadow',{recursive:true});
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',
  args:['--use-angle=metal','--ignore-gpu-blocklist'],defaultViewport:{width:1280,height:720}});
const p=await b.newPage(); p.on('pageerror',e=>console.log('PAGEERROR:',e.message));
await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('!!window.engine',{timeout:180000});
const framed=await p.evaluate(FRAMING_FN); const fr=framed.framing.dawn;
await p.evaluate((a)=>{const c=window.engine.ctx;c.clock.hour=6.2;c.camera.fov=a.fov;c.camera.updateProjectionMatrix();
  c.get('sky')?.setWeather?.('clear',0);const pl=c.get('player');if(pl)pl.freefly=true;
  pl?.teleport?.(a.x,a.z,a.h);pl?.setLook?.(a.yaw,a.pitch*Math.PI/180);},fr);
await sleep(2500);
async function cap(n,fn){await p.evaluate(fn);await sleep(1800);
  await writeFile(`shots/shadow/${n}.png`,await p.screenshot({type:'png'}));console.log('wrote',n);}
await cap('0-base',()=>{});
// Force the shadow map to re-render every frame.
await cap('1-forceupdate',()=>{const R=window.engine.ctx.renderer;
  R.shadowMap.autoUpdate=true; R.shadowMap.needsUpdate=true;});
// Widen the ortho box and centre it on the camera each frame.
await cap('2-fitted',()=>{const ctx=window.engine.ctx, sun=ctx.get('sky').sun;
  const s=sun.shadow.camera; s.left=-700;s.right=700;s.top=700;s.bottom=-700;s.near=1;s.far=4000;
  s.updateProjectionMatrix(); sun.shadow.bias=-0.0006; sun.shadow.normalBias=0.05;
  window.__fit=()=>{const c=ctx.camera;
    sun.target.position.set(c.position.x,0,c.position.z);
    const d=sun.position.clone().sub(sun.target.position).normalize().multiplyScalar(1500);
    sun.position.copy(sun.target.position).add(d);
    sun.target.updateMatrixWorld(); sun.updateMatrixWorld();};
  const loop=()=>{window.__fit();requestAnimationFrame(loop);}; loop();});
await b.close(); vite?.kill();
