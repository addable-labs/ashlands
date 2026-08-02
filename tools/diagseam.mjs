import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { FRAMING_FN } from './framing.mjs';
const URL='http://127.0.0.1:5178/';
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
let vite=null;
if(!(await up())){vite=spawn('npx',['vite','--port','5178','--host','127.0.0.1'],{stdio:'ignore'});for(let i=0;i<60&&!(await up());i++)await sleep(500);}
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',
  args:['--use-angle=metal','--ignore-gpu-blocklist'],defaultViewport:{width:1920,height:1080}});
const p=await b.newPage(); p.on('pageerror',e=>console.log('PAGEERROR:',e.message));
await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('!!window.engine',{timeout:180000});
const framed=await p.evaluate(FRAMING_FN);
const fr=framed.framing.ridge;
await p.evaluate((fr)=>{const ctx=window.engine.ctx;ctx.clock.hour=8.4;ctx.camera.fov=fr.fov;ctx.camera.updateProjectionMatrix();
  ctx.get('sky')?.setWeather?.('clear',0);const pl=ctx.get('player');if(pl)pl.freefly=true;pl?.teleport?.(fr.x,fr.z,fr.h);pl?.setLook?.(fr.yaw,(fr.pitch*Math.PI)/180);},fr);
await sleep(2600);
const r=await p.evaluate(()=>{
  const ctx=window.engine.ctx; const cam=ctx.camera; cam.updateMatrixWorld();
  const t=ctx.get('terrain');
  const m=cam.matrixWorld.elements;
  const fovy=cam.fov*Math.PI/180, ty=Math.tan(fovy/2), tx=ty*cam.aspect;
  const probe=(px,py)=>{
    const ndcx=(px/1920)*2-1, ndcy=-((py/1080)*2-1);
    const cx=ndcx*tx, cy=ndcy*ty, cz=-1;
    let dx=m[0]*cx+m[4]*cy+m[8]*cz, dy=m[1]*cx+m[5]*cy+m[9]*cz, dz=m[2]*cx+m[6]*cy+m[10]*cz;
    const L=Math.hypot(dx,dy,dz); dx/=L;dy/=L;dz/=L;
    const ox=m[12],oy=m[13],oz=m[14];
    let tt=0.2, prev=oy-t.heightAt(ox,oz), step=0.5;
    for(let i=0;i<4000&&tt<6000;i++){
      const nt=tt+step;
      const d=oy+dy*nt-t.heightAt(ox+dx*nt,oz+dz*nt);
      if(prev>0&&d<=0){
        let lo=tt,hi=nt;
        for(let k=0;k<40;k++){const mid=(lo+hi)/2;const dd=oy+dy*mid-t.heightAt(ox+dx*mid,oz+dz*mid);if(dd>0)lo=mid;else hi=mid;}
        return {d:+hi.toFixed(1), x:+(ox+dx*hi).toFixed(1), y:+(oy+dy*hi).toFixed(1), z:+(oz+dz*hi).toFixed(1)};
      }
      prev=d; tt=nt; step=Math.min(step*1.04,8);
    }
    return null;
  };
  const scan=[];
  for(let py=300;py<=420;py+=4) scan.push({py, a:probe(160,py), b:probe(900,py), c:probe(1500,py)});
  // quadtree stats
  const qt=t.qt;
  const stats={count:qt.count, ranges:Array.from(qt.ranges).map(v=>+v.toFixed(1))};
  const byDepth={};
  for(let i=0;i<qt.count;i++){const d=qt.instances[i*4+3]; byDepth[d]=(byDepth[d]||0)+1;}
  stats.byDepth=byDepth;
  stats.camPos=[+cam.position.x.toFixed(1),+cam.position.y.toFixed(1),+cam.position.z.toFixed(1)];
  return {scan,stats};
});
console.log(JSON.stringify(r.stats,null,1));
for(const s of r.scan) console.log(s.py, JSON.stringify(s.a), JSON.stringify(s.b), JSON.stringify(s.c));
await b.close(); vite?.kill();
