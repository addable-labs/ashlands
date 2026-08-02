import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';
const URL='http://127.0.0.1:5178/';
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
let vite=null;
if(!(await up())){vite=spawn('npx',['vite','--port','5178','--host','127.0.0.1'],{stdio:'ignore'});for(let i=0;i<60&&!(await up());i++)await sleep(500);}
await mkdir('shots/uniform',{recursive:true});
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',
  args:['--use-angle=metal','--ignore-gpu-blocklist'],defaultViewport:{width:1280,height:720}});
const p=await b.newPage(); p.on('pageerror',e=>console.log('PAGEERROR:',e.message));
await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('!!window.engine',{timeout:180000});
const framed=await p.evaluate(FRAMING_FN); const fr=framed.framing.redmtn;
await p.evaluate((a)=>{const c=window.engine.ctx;c.clock.hour=10;c.camera.fov=a.fov;c.camera.updateProjectionMatrix();
  c.get('sky')?.setWeather?.('clear',0);const pl=c.get('player');if(pl)pl.freefly=true;
  pl?.teleport?.(a.x,a.z,a.h);pl?.setLook?.(a.yaw,a.pitch*Math.PI/180);},fr);
await sleep(2500);
// Find the live terrain material and expose its uniforms.
// Uniforms live on the TerrainSystem instance (private in TS, present at runtime),
// not on the material — it is a MeshStandardMaterial patched via onBeforeCompile.
const keys = await p.evaluate(()=>{const t=window.engine.ctx.get('terrain');
  window.__u=t.uniforms; return Object.keys(t.uniforms||{});});
console.log('uniform keys:', keys?.join(', '));
async function tryset(label, mut){
  await p.evaluate(mut); await sleep(1500);
  await writeFile(`shots/uniform/${label}.png`, await p.screenshot({type:'png'}));
  console.log('wrote', label);
}
await tryset('base', ()=>{});
await tryset('pom0',      ()=>{window.__u.uPomStrength.value=0;});
await tryset('detail0',   ()=>{window.__u.uDetailScale.value=0;});
await tryset('mid0',      ()=>{window.__u.uMidScale.value=0;});
await tryset('macro0',    ()=>{window.__u.uMacroScale.value=0;});
await tryset('restore-all-but-mid', ()=>{const u=window.__u;
  u.uPomStrength.value=0.010; u.uDetailScale.value=1/0.5; u.uMacroScale.value=1/200; u.uMidScale.value=1/8;});
await b.close(); vite?.kill();
