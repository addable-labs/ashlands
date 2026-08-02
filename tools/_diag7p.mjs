import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const PORT=process.env.PORT||'5178';
const URL=`http://127.0.0.1:${PORT}/`;
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
let vite=null;
if(!(await up())){vite=spawn('npx',['vite','--port',PORT,'--host','127.0.0.1'],{stdio:'ignore'});for(let i=0;i<60&&!(await up());i++)await sleep(500);}
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',
  args:['--use-angle=metal','--ignore-gpu-blocklist'],defaultViewport:{width:800,height:600}});
const p=await b.newPage(); p.on('pageerror',e=>console.log('PAGEERROR:',e.message));
await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('!!window.engine',{timeout:180000});
const r = await p.evaluate(()=>{
  const t=window.engine.ctx.get('terrain');
  // Second difference along a line = curvature. A geometric lattice shows up as a
  // strong periodic component here even when the raw height looks smooth.
  const x0=200, z0=-600, N=1024, dx=0.25;
  const h=[]; for(let i=0;i<N;i++) h.push(t.heightAt(x0+i*dx, z0));
  const d2=[]; for(let i=1;i<N-1;i++) d2.push(h[i-1]-2*h[i]+h[i+1]);
  // Autocorrelation of the curvature signal.
  const mean=d2.reduce((a,b)=>a+b,0)/d2.length;
  const c=d2.map(v=>v-mean);
  const ac=[]; for(let lag=1;lag<220;lag++){let s=0;for(let i=0;i+lag<c.length;i++)s+=c[i]*c[i+lag];ac.push(s/(c.length-lag));}
  const a0=c.reduce((a,b)=>a+b*b,0)/c.length;
  const norm=ac.map(v=>v/a0);
  // Report the strongest peaks (lag in samples -> metres).
  const peaks=[];
  for(let i=1;i<norm.length-1;i++) if(norm[i]>norm[i-1]&&norm[i]>norm[i+1]&&norm[i]>0.12) peaks.push({m:+((i+1)*dx).toFixed(2),v:+norm[i].toFixed(3)});
  peaks.sort((a,b)=>b.v-a.v);
  return {extent:t.extent, peaks:peaks.slice(0,10),
    curvRms:+Math.sqrt(a0).toFixed(4),
    sampleHeights:h.slice(0,12).map(v=>+v.toFixed(3))};
});
console.log(JSON.stringify(r,null,1));
await b.close(); vite?.kill();
