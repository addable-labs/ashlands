import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const URL='http://127.0.0.1:5178/';
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
let vite=null;
if(!(await up())){vite=spawn('npx',['vite','--port','5178','--host','127.0.0.1'],{stdio:'ignore'});for(let i=0;i<60&&!(await up());i++)await sleep(500);}
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--use-angle=metal','--ignore-gpu-blocklist'],defaultViewport:{width:1280,height:720}});
const p=await b.newPage();
p.on('pageerror',e=>console.log('PAGEERROR:',e.message));
await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('!!window.engine',{timeout:120000});
const out = await p.evaluate(()=>{
  const ctx=window.engine.ctx, t=ctx.get('terrain'), pl=ctx.get('player'), r=ctx.get('render');
  const pts=[[120,420],[40,900],[620,-1450],[-200,200],[300,100],[-600,-300],[-820,640],[200,-700],[-300,700],[0,0]];
  const heights=pts.map(([x,z])=>[x,z,+t.heightAt(x,z).toFixed(1),t.materialAt(x,z)]);
  let min=1e9,max=-1e9,sum=0,n=0;
  for(let x=-2000;x<=2000;x+=50)for(let z=-2000;z<=2000;z+=50){const h=t.heightAt(x,z);min=Math.min(min,h);max=Math.max(max,h);sum+=h;n++;}
  pl.teleport(620,-1450,8);
  const camAfter={x:+ctx.camera.position.x.toFixed(1),y:+ctx.camera.position.y.toFixed(1),z:+ctx.camera.position.z.toFixed(1)};
  return {heights, extent:t.extent, ready:t.ready, min:+min.toFixed(1), max:+max.toFixed(1), mean:+(sum/n).toFixed(1),
    camAfter, groundThere:+t.heightAt(620,-1450).toFixed(1),
    freefly: pl.freefly, view: pl.view,
    sceneChildren: ctx.scene.children.map(c=>c.name||c.type).slice(0,20),
    tris: ctx.renderer.info.render.triangles, calls: ctx.renderer.info.render.calls,
    debug: window.RENDER_DEBUG ?? null,
  };
});
console.log(JSON.stringify(out,null,1));
await b.close(); vite?.kill();
