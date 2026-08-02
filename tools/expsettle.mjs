import { launch } from 'puppeteer-core';
import { spawn, execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';
import { PNG } from 'pngjs'; import { Buffer } from 'node:buffer';
const PORT=5199, URL=`http://127.0.0.1:${PORT}/`;
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
execSync('npx vite build --outDir dist-bench --emptyOutDir',{stdio:'ignore'});
const vite=spawn('npx',['vite','preview','--outDir','dist-bench','--port',String(PORT),'--host','127.0.0.1'],{stdio:'ignore'});
for(let i=0;i<90&&!(await up());i++) await sleep(500);
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',
  args:['--use-angle=metal','--ignore-gpu-blocklist'],defaultViewport:{width:960,height:540}});
const p=await b.newPage(); await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('!!window.engine',{timeout:180000}); await sleep(2500);
const F=await p.evaluate(FRAMING_FN);
const lum=async()=>{const d=PNG.sync.read(Buffer.from(await p.screenshot({type:'png'}))).data;
  let s=0,n=0; for(let k=0;k<d.length;k+=16){s+=0.2126*d[k]+0.7152*d[k+1]+0.0722*d[k+2];n++;} return +(s/n).toFixed(2);};
const place=async(name,hour)=>{const fr=F.framing[name];
  await p.evaluate((fr,h)=>{const c=window.engine.ctx,pl=c.get('player');
    c.clock.hour=h; c.clock.scale=0; c.camera.fov=fr.fov; c.camera.updateProjectionMatrix();
    c.get('sky')?.setWeather?.('clear',0); if(pl)pl.freefly=true;
    pl?.teleport?.(fr.x,fr.z,fr.h); pl?.setLook?.(fr.yaw,fr.pitchRad??0);},fr,hour);};
// Approach the SAME target shot from a bright scene and from a dark one.
for (const [from,fh] of [['coast',12],['night',23.4]]) {
  await place(from,fh); await sleep(6000);
  const before=await lum();
  await place('dawn',6.2);
  const series=[];
  for (const t of [0.5,1,1.5,2,2.6,3.5,5,7,10,14]) { await sleep(t*1000-(series.length?series[series.length-1][0]*1000:0)); series.push([t,await lum()]); }
  console.log(`from ${from} (lum ${before}) -> dawn:`);
  console.log('  ' + series.map(([t,l])=>`${t}s:${l}`).join('  '));
}
await b.close(); vite?.kill();
