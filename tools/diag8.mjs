import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';
const URL='http://127.0.0.1:5178/';
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
let vite=null;
if(!(await up())){vite=spawn('npx',['vite','--port','5178','--host','127.0.0.1'],{stdio:'ignore'});for(let i=0;i<60&&!(await up());i++)await sleep(500);}
await mkdir('shots/geo',{recursive:true});
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
// Read back the actual GPU heightfield texture and compare with CPU heightAt.
const cmp = await p.evaluate(()=>{
  const ctx=window.engine.ctx, t=ctx.get('terrain'), r=ctx.renderer;
  const u=t.uniforms, tex=u.uHeight.value;
  const out={ texType:tex?tex.constructor.name:null, w:tex?.image?.width, h:tex?.image?.height,
    fmt:tex?.format, type:tex?.type, cpu:[], gpuStats:null };
  for(const [x,z] of [[-160,-1360],[-240,-880],[0,0],[600,600],[-1440,-80]])
    out.cpu.push({x,z,h:+t.heightAt(x,z).toFixed(1)});
  const d=tex?.image?.data;
  if(d&&d.length){let mn=1e9,mx=-1e9,s=0;
    for(let i=0;i<d.length;i++){const v=d[i];if(v<mn)mn=v;if(v>mx)mx=v;s+=v;}
    out.gpuStats={len:d.length,min:+mn.toFixed(3),max:+mx.toFixed(3),mean:+(s/d.length).toFixed(3)};}
  // What Y does the rendered terrain actually reach? Sample the mesh bounding box.
  let bb=null; ctx.scene.traverse(o=>{if(o.name==='terrain'){o.geometry.computeBoundingBox();
    bb={geo:o.geometry.boundingBox, scale:o.scale.toArray(), pos:o.position.toArray()};}});
  out.meshBox=bb?{min:bb.geo.min.toArray().map(v=>+v.toFixed(2)),max:bb.geo.max.toArray().map(v=>+v.toFixed(2)),scale:bb.scale,pos:bb.pos}:null;
  return out;});
console.log(JSON.stringify(cmp,null,1));
for (const [k,label] of [['showNormals','normals'],['showLinearDepth','depth']]) {
  await p.evaluate((k)=>{const d=window.RENDER_DEBUG; if(d){for(const j in d) if(j.startsWith('show')) d[j]=false; d[k]=true;}},k);
  await sleep(1200);
  await writeFile(`shots/geo/${label}.png`, await p.screenshot({type:'png'}));
  console.log('wrote', label);
}
await b.close(); vite?.kill();
