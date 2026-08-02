import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';
const URL='http://127.0.0.1:5178/';
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
let vite=null;
if(!(await up())){vite=spawn('npx',['vite','--port','5178','--host','127.0.0.1'],{stdio:'ignore'});for(let i=0;i<60&&!(await up());i++)await sleep(500);}
await mkdir('shots/isolate',{recursive:true});
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',
  args:['--use-angle=metal','--ignore-gpu-blocklist','--window-size=1600,900'],defaultViewport:{width:1600,height:900}});
const p=await b.newPage();
p.on('pageerror',e=>console.log('PAGEERROR:',e.message));
await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('!!window.engine',{timeout:180000});
const framed=await p.evaluate(FRAMING_FN);
const fr=framed.framing.redmtn;
await p.evaluate((fr)=>{const c=window.engine.ctx;c.clock.hour=10;c.camera.fov=fr.fov;c.camera.updateProjectionMatrix();
  c.get('sky')?.setWeather?.('clear',0);const pl=c.get('player');if(pl)pl.freefly=true;
  pl?.teleport?.(fr.x,fr.z,fr.h);pl?.setLook?.(fr.yaw,(fr.pitch*Math.PI)/180);},fr);
await sleep(2500);
// Enumerate what is actually in the scene and its render order.
const inv = await p.evaluate(()=>{
  const out=[];window.engine.ctx.scene.traverse(o=>{if(o.isMesh||o.isPoints||o.isSprite)
    out.push({name:o.name||'(unnamed)',type:o.type,visible:o.visible,ro:o.renderOrder,
      mat:(Array.isArray(o.material)?o.material[0]:o.material)?.type,
      depthTest:(Array.isArray(o.material)?o.material[0]:o.material)?.depthTest,
      transparent:(Array.isArray(o.material)?o.material[0]:o.material)?.transparent,
      parent:o.parent?.name||o.parent?.type});});
  return out;});
console.log('--- scene inventory ---'); inv.forEach(o=>console.log(JSON.stringify(o)));
async function shot(label, fn){
  await p.evaluate(fn); await sleep(1800);
  await writeFile(`shots/isolate/${label}.png`, await p.screenshot({type:'png'}));
  console.log('wrote', label);
}
await shot('00-baseline', ()=>{});
await shot('01-no-water', ()=>{const s=window.engine.ctx.get('water');
  window.engine.ctx.scene.traverse(o=>{if(/water|sea/i.test(o.name||''))o.visible=false;});});
await shot('02-terrain-detached', ()=>{
  // Neutralise the LOD update first: it re-asserts node visibility every frame,
  // which is why toggling .visible looked like the lattice was not the terrain.
  const t=window.engine.ctx.get('terrain'); t.update=()=>{}; t.lateUpdate=()=>{};
  const sc=window.engine.ctx.scene; const kill=[];
  sc.traverse(o=>{if(o.name==='terrain')kill.push(o);});
  kill.forEach(o=>o.parent&&o.parent.remove(o));
  window.__killed=kill.length;
});
await shot('03-only-terrain', ()=>{
  const sc=window.engine.ctx.scene;
  sc.traverse(o=>{if((o.isMesh||o.isPoints)&&o.name!=='terrain'&&o.renderOrder<900)o.visible=false;});
});
console.log('killed nodes:', await p.evaluate(()=>window.__killed));
await b.close(); vite?.kill();
