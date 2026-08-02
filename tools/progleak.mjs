import { launch } from 'puppeteer-core';
import { spawn, execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const PORT=5203, URL=`http://127.0.0.1:${PORT}/`;
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
execSync('npx vite build --outDir dist-leak --emptyOutDir',{stdio:'ignore'});
const s=spawn('npx',['vite','preview','--outDir','dist-leak','--port',String(PORT),'--host','127.0.0.1'],{stdio:'ignore'});
for(let i=0;i<90&&!(await up());i++) await sleep(500);
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',
  args:['--use-angle=metal','--ignore-gpu-blocklist'],defaultViewport:{width:1280,height:720}});
const p=await b.newPage(); await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('!!window.engine',{timeout:180000}); await sleep(3000);
// Hook material compiles so we learn WHICH materials keep recompiling.
await p.evaluate(()=>{
  const r=window.engine.ctx.renderer;
  window.__compiles={};
  const orig=r.compile?.bind(r);
  // three caches programs on WebGLPrograms; instead watch needsUpdate flips.
  window.__watch=[];
  const seen=new WeakSet();
  window.__scan=()=>{
    window.engine.ctx.scene.traverse(o=>{
      const m=o.material; if(!m) return;
      for(const mm of (Array.isArray(m)?m:[m])){
        if(!seen.has(mm)){ seen.add(mm);
          const key=(mm.name||mm.type)+'|'+(o.name||o.parent?.name||'?');
          window.__compiles[key]=(window.__compiles[key]||0)+1; }
      }
    });
  };
  const pl=window.engine.ctx.get('player'); pl.freefly=false;
  window.engine.ctx.input.pointerLocked=true;
  window.engine.ctx.input.held.add('KeyW');
  window.__turn=setInterval(()=>{const r2=window.engine.ctx.get('player');r2.setLook((r2.yaw??0)+0.2,-0.03);},1500);
});
const snap=()=>p.evaluate(()=>{window.__scan();
  const r=window.engine.ctx.renderer;
  return {programs:r.info.programs.length, geo:r.info.memory.geometries,
    newMats:Object.entries(window.__compiles).sort((a,b)=>b[1]-a[1]).slice(0,6)};});
console.log('t   programs  geom   newly-seen materials (cumulative distinct)');
for(let i=0;i<8;i++){
  const s2=await snap();
  console.log(`${i*20}s  ${String(s2.programs).padStart(4)}  ${String(s2.geo).padStart(5)}   ${s2.newMats.map(([k,v])=>k.slice(0,42)).slice(0,3).join(' | ')}`);
  await sleep(20000);
}
// Which program keys exist? three exposes cacheKey on each program.
console.log('\n--- program cacheKey prefixes (top 12 by count) ---');
console.log(JSON.stringify(await p.evaluate(()=>{
  const ps=window.engine.ctx.renderer.info.programs, m={};
  for(const pr of ps){ const k=(pr.cacheKey||'').slice(0,70); m[k]=(m[k]||0)+1; }
  return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,12);
}),null,1));
await b.close(); s.kill();
