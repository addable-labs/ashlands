import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const URL='http://127.0.0.1:5178/';
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
let vite=null;
if(!(await up())){vite=spawn('npx',['vite','--port','5178','--host','127.0.0.1'],{cwd:'/Users/peter/Development/morrowind',stdio:'ignore'});for(let i=0;i<60&&!(await up());i++)await sleep(500);}
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',
 args:['--window-size=1920,1080','--use-angle=metal','--ignore-gpu-blocklist'],defaultViewport:{width:1920,height:1080}});
const p=await b.newPage(); await p.goto(URL,{waitUntil:'networkidle2',timeout:90000});
await p.waitForFunction('!!window.engine',{timeout:180000});
const { FRAMING_FN } = await import('/Users/peter/Development/morrowind/tools/framing.mjs');
const framed = await p.evaluate(FRAMING_FN);
for (const name of ['coast','dusk','night']) {
  const fr = framed.framing[name];
  const out = await p.evaluate((fr, hour)=>{
    const ctx=window.engine.ctx;
    ctx.clock.hour=hour;
    ctx.camera.fov=fr.fov; ctx.camera.updateProjectionMatrix();
    const pl=ctx.get('player'); if(pl) pl.freefly=true;
    pl?.teleport?.(fr.x,fr.z,fr.h);
    pl?.setLook?.(fr.yaw, fr.pitchRad);
    ctx.camera.updateMatrixWorld(true);
    const f=new ctx.camera.position.constructor(); ctx.camera.getWorldDirection(f);
    const t=ctx.get('terrain');
    const vfov=fr.fov*Math.PI/180;
    const camEl=Math.asin(f.y);
    // screen row of elevation 0 (the sea horizon)
    const rowOf=(el)=> 540 - Math.tan(el-camEl)/Math.tan(vfov/2)*540;
    const camY=ctx.camera.position.y;
    return {camY, groundH:t.heightAt(fr.x,fr.z), camElDeg:+(camEl*180/Math.PI).toFixed(2),
      horizonRow:+rowOf(0).toFixed(0),
      row_at_400m:+rowOf(Math.atan2(-camY,400)).toFixed(0),
      row_at_1km:+rowOf(Math.atan2(-camY,1000)).toFixed(0),
      row_at_100m:+rowOf(Math.atan2(-camY,100)).toFixed(0)};
  }, fr, name==='coast'?18.85:name==='dusk'?19.8:23.4);
  console.log(name, JSON.stringify(out));
}
await b.close(); vite?.kill();
