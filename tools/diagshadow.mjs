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
const p=await b.newPage(); p.on('pageerror',e=>console.log('PAGEERROR:',e.message));
await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('!!window.engine',{timeout:180000});
const framed=await p.evaluate(FRAMING_FN); const fr=framed.framing.dawn;
await p.evaluate((a)=>{const c=window.engine.ctx;c.clock.hour=6.2;c.camera.fov=a.fov;c.camera.updateProjectionMatrix();
  c.get('sky')?.setWeather?.('clear',0);const pl=c.get('player');if(pl)pl.freefly=true;
  pl?.teleport?.(a.x,a.z,a.h);pl?.setLook?.(a.yaw,a.pitch*Math.PI/180);},fr);
await sleep(2500);
const r = await p.evaluate(()=>{
  const ctx=window.engine.ctx, R=ctx.renderer, sky=ctx.get('sky');
  const sun=sky?.sun;
  let casters=0, receivers=0, meshes=0;
  const byName={};
  ctx.scene.traverse(o=>{ if(!(o.isMesh||o.isInstancedMesh||o.isSkinnedMesh))return; meshes++;
    if(o.castShadow)casters++; if(o.receiveShadow)receivers++;
    const k=(o.name||o.type)+(o.castShadow?'|cast':'')+(o.receiveShadow?'|recv':'');
    byName[k]=(byName[k]||0)+1; });
  const sc = sun?.shadow?.camera;
  return {
    shadowMapEnabled:R.shadowMap.enabled, shadowType:R.shadowMap.type, autoUpdate:R.shadowMap.autoUpdate,
    needsUpdate:R.shadowMap.needsUpdate,
    sunExists:!!sun, sunCastShadow:sun?.castShadow, sunIntensity:sun?.intensity,
    sunPos: sun? sun.position.toArray().map(v=>+v.toFixed(1)):null,
    sunTarget: sun? sun.target.position.toArray().map(v=>+v.toFixed(1)):null,
    sunTargetInScene: sun? !!sun.target.parent : null,
    mapSize: sun?.shadow?.mapSize?.toArray?.(),
    mapAllocated: !!sun?.shadow?.map,
    bias: sun?.shadow?.bias, normalBias: sun?.shadow?.normalBias,
    cam: sc? {left:sc.left,right:sc.right,top:sc.top,bottom:sc.bottom,near:sc.near,far:sc.far}:null,
    meshes, casters, receivers,
    byName: Object.fromEntries(Object.entries(byName).slice(0,25)),
  };});
console.log(JSON.stringify(r,null,1));
await b.close(); vite?.kill();
