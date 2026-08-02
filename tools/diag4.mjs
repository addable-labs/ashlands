import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';
const URL='http://127.0.0.1:5178/';
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
let vite=null;
if(!(await up())){vite=spawn('npx',['vite','--port','5178','--host','127.0.0.1'],{stdio:'ignore'});for(let i=0;i<60&&!(await up());i++)await sleep(500);}
await mkdir('shots/isolate2',{recursive:true});
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',
  args:['--use-angle=metal','--ignore-gpu-blocklist','--window-size=1280,720'],defaultViewport:{width:1280,height:720}});
const p=await b.newPage();
p.on('pageerror',e=>console.log('PAGEERROR:',e.message));
await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('!!window.engine',{timeout:180000});
const framed=await p.evaluate(FRAMING_FN);
const fr=framed.framing.redmtn;
const place=(x,z,h,yaw,pitch,fov)=>p.evaluate((a)=>{const c=window.engine.ctx;
  c.clock.hour=10;c.camera.fov=a.fov;c.camera.updateProjectionMatrix();
  c.get('sky')?.setWeather?.('clear',0);const pl=c.get('player');if(pl)pl.freefly=true;
  pl?.teleport?.(a.x,a.z,a.h);pl?.setLook?.(a.yaw,a.pitch);},{x,z,h,yaw,pitch,fov});
async function cap(n){await sleep(2000);await writeFile(`shots/isolate2/${n}.png`,await p.screenshot({type:'png'}));
  const s=await p.evaluate(()=>({calls:window.engine.ctx.renderer.info.render.calls,
    tris:window.engine.ctx.renderer.info.render.triangles,
    hasTerrain:(()=>{let f=false;window.engine.ctx.scene.traverse(o=>{if(o.name==='terrain')f=true;});return f;})(),
    camY:+window.engine.ctx.camera.position.y.toFixed(1)}));
  console.log(n, JSON.stringify(s)); }
await place(fr.x,fr.z,fr.h,fr.yaw,fr.pitch*Math.PI/180,fr.fov); await cap('A-baseline');
// Move the camera far. Live geometry follows; a stale buffer does not.
await place(fr.x+300,fr.z+300,60,fr.yaw+0.6,-0.15,fr.fov); await cap('B-moved');
await place(fr.x,fr.z,fr.h,fr.yaw,fr.pitch*Math.PI/180,fr.fov); await cap('C-back');
// Now detach terrain and move again.
await p.evaluate(()=>{const t=window.engine.ctx.get('terrain');t.update=()=>{};t.lateUpdate=()=>{};
  const k=[];window.engine.ctx.scene.traverse(o=>{if(o.name==='terrain')k.push(o);});k.forEach(o=>o.parent?.remove(o));});
await cap('D-detached');
await place(fr.x+300,fr.z+300,60,fr.yaw+0.6,-0.15,fr.fov); await cap('E-detached-moved');
// Disable TAA, then every post pass, to see what the raw scene looks like.
await p.evaluate(()=>{const d=window.RENDER_DEBUG;if(d)d.taa=false;});await cap('F-noTAA');
await p.evaluate(()=>{const d=window.RENDER_DEBUG;if(d)for(const k in d)d[k]=false;});await cap('G-noPost');
console.log('RENDER_DEBUG keys:', await p.evaluate(()=>window.RENDER_DEBUG?Object.keys(window.RENDER_DEBUG):null));
await b.close(); vite?.kill();
