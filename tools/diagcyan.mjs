import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';
import { PNG } from 'pngjs';
import { Buffer } from 'node:buffer';
const URL='http://127.0.0.1:5178/';
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
let vite=null;
if(!(await up())){vite=spawn('npx',['vite','--port','5178','--host','127.0.0.1'],{stdio:'ignore'});for(let i=0;i<60&&!(await up());i++)await sleep(500);}
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',
  args:['--use-angle=metal','--ignore-gpu-blocklist'],defaultViewport:{width:1280,height:720}});
const p=await b.newPage(); p.on('pageerror',e=>console.log('PAGEERROR:',e.message));
await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('!!window.engine',{timeout:180000});
const framed=await p.evaluate(FRAMING_FN); const fr=framed.framing.redmtn;
await p.evaluate((a)=>{const c=window.engine.ctx;c.clock.hour=10;c.camera.fov=a.fov;c.camera.updateProjectionMatrix();
  c.get('sky')?.setWeather?.('clear',0);const pl=c.get('player');if(pl)pl.freefly=true;
  pl?.teleport?.(a.x,a.z,a.h);pl?.setLook?.(a.yaw,a.pitchRad);},fr);
await sleep(2500);
// Count strongly cyan/teal pixels: G and B high, R clearly lower.
const cyan=(buf)=>{const im=PNG.sync.read(Buffer.from(buf));let n=0;
  for(let k=0;k<im.data.length;k+=4){const r=im.data[k],g=im.data[k+1],bl=im.data[k+2];
    if(g>90&&bl>90&&g-r>35&&bl-r>25)n++;}
  return n;};
const shot=async()=>cyan(await p.screenshot({type:'png'}));
console.log('baseline cyan px:', await shot());
// Hide each named group in turn and see which one owns the pixels.
const groups = await p.evaluate(()=>{const s=new Set();window.engine.ctx.scene.traverse(o=>{
  if(o.name)s.add(o.name);});return [...s];});
for (const g of groups) {
  const before = await p.evaluate((g)=>{let f=false;window.engine.ctx.scene.traverse(o=>{
    if(o.name===g){o.userData._v=o.visible;o.visible=false;f=true;}});return f;},g);
  if(!before) continue;
  await sleep(500);
  const n = await shot();
  await p.evaluate((g)=>{window.engine.ctx.scene.traverse(o=>{if(o.name===g&&o.userData._v!==undefined)o.visible=o.userData._v;});},g);
  if (n < 200) console.log(`  hiding "${g}" -> cyan px ${n}   <== OWNER`);
}
await b.close(); vite?.kill();
