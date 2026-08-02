import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';
const URL='http://127.0.0.1:5178/';
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
let vite=null;
if(!(await up())){vite=spawn('npx',['vite','--port','5178','--host','127.0.0.1'],{stdio:'ignore'});for(let i=0;i<60&&!(await up());i++)await sleep(500);}
await mkdir('shots/skytest',{recursive:true});
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
// Describe every drawable with depth state, so nothing hides behind "(unnamed)".
const inv=await p.evaluate(()=>{const o=[];window.engine.ctx.scene.traverse(x=>{
  if(!(x.isMesh||x.isPoints||x.isSprite))return;const m=Array.isArray(x.material)?x.material[0]:x.material;
  o.push({n:x.name||'(unnamed)',t:x.type,ro:x.renderOrder,vis:x.visible,
    dTest:m?.depthTest,dWrite:m?.depthWrite,transp:m?.transparent,side:m?.side,
    frustumCulled:x.frustumCulled, uuid:x.uuid.slice(0,8)});});return o;});
console.log('--- drawables ---'); inv.forEach(d=>console.log(JSON.stringify(d)));
async function cap(n,fn){await p.evaluate(fn);await sleep(1500);
  await writeFile(`shots/skytest/${n}.png`,await p.screenshot({type:'png'}));console.log('wrote',n);}
await cap('0-base',()=>{});
// Hide the last-drawn opaque scene mesh (renderOrder >= 900) — the sky dome candidate.
// Terrain geometry is a unit grid displaced in the vertex shader, so its CPU
// bounding volume is ~1 unit at the origin while the drawn surface spans 4 km.
// three culls against the CPU volume, so the terrain vanishes once the camera
// leaves the origin — which is exactly what we see.
const before = await p.evaluate(()=>{let r=null;window.engine.ctx.scene.traverse(x=>{
  if(x.name==='terrain'){x.geometry.computeBoundingSphere();
    r={frustumCulled:x.frustumCulled, bs:{c:x.geometry.boundingSphere.center.toArray(),r:x.geometry.boundingSphere.radius}};}});
  return r;});
console.log('terrain cull state:', JSON.stringify(before));
await cap('1-nocull', ()=>{window.engine.ctx.scene.traverse(x=>{if(x.name==='terrain')x.frustumCulled=false;});});
await b.close(); vite?.kill();
