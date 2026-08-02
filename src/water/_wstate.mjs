// Reads the water system's own gating state at each canonical framing, so
// "is the beach pass even running here?" is answered with the uniform values
// rather than by staring at a screenshot.
//   node src/water/_wstate.mjs
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from '/Users/peter/Development/morrowind/tools/framing.mjs';
const URL='http://127.0.0.1:5178/';
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
let vite=null;
if(!(await up())){vite=spawn('npx',['vite','--port','5178','--host','127.0.0.1'],{cwd:'/Users/peter/Development/morrowind',stdio:'ignore'});for(let i=0;i<60&&!(await up());i++)await sleep(500);}
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',
  args:['--window-size=1920,1080','--use-angle=metal','--ignore-gpu-blocklist','--hide-scrollbars'],defaultViewport:{width:1920,height:1080}});
const p=await b.newPage(); await p.goto(URL,{waitUntil:'networkidle2',timeout:90000});
await p.waitForFunction('!!window.engine',{timeout:180000});
const framed=await p.evaluate(FRAMING_FN);
for(const [name,hour] of [['coast',17.6],['dusk',19.8],['night',23.4],['storm',15]]){
  const fr=framed.framing[name]; if(!fr) continue;
  await p.evaluate((fr,hour)=>{
    const ctx=window.engine.ctx;
    ctx.clock.hour=hour; ctx.camera.fov=fr.fov; ctx.camera.updateProjectionMatrix();
    const pl=ctx.get('player'); if(pl) pl.freefly=true;
    pl?.teleport?.(fr.x,fr.z,fr.h); pl?.setLook?.(fr.yaw,fr.pitchRad);
  },fr,hour);
  await sleep(2500);
  const s=await p.evaluate(()=>{
    const ctx=window.engine.ctx; const w=ctx.get('water');
    const m=ctx.scene.getObjectByName('inner-sea');
    const u=m?.material?.uniforms||{};
    const c=w?.composite?.uniforms||{};
    const num=(v)=>typeof v==='number'?+v.toFixed(4):v;
    return {
      shoreNear:w?.shoreNear, shallowNear:w?.shallowNear, visible:w?.visible,
      compositeNeeded:w?.compositeNeeded, submerged:num(w?.submerged),
      reflValid:num(u.wReflValid?.value), refrValid:num(u.wRefrValid?.value),
      shoreFade:num(c.wShoreFade?.value),
      windSpeed:num(u.wWindSpeed?.value), foamAmount:num(u.wFoamAmount?.value),
      sunAbove:num(u.wSunAbove?.value), keyAngle:num(u.wKeyAngle?.value),
      sunDir:u.wSunDir?.value?.toArray?.().map(v=>+v.toFixed(3)),
      sunCol:u.wSunColor?.value?.toArray?.().map(v=>+v.toFixed(3)),
      amb:u.wAmbient?.value?.toArray?.().map(v=>+v.toFixed(4)),
      camY:+ctx.camera.position.y.toFixed(2),
    };
  });
  console.log(name, JSON.stringify(s));
}
await b.close(); vite?.kill();
