// Water diagnostic: arbitrary camera placement over the sea.
//   node tools/wdiagX.mjs <tag> "<x>,<z>,<absY>,<yawDeg>,<pitchDeg>,<hour>,<weather>" ...
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
const URL='http://127.0.0.1:5178/';
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
let vite=null;
if(!(await up())){vite=spawn('npx',['vite','--port','5178','--host','127.0.0.1'],{cwd:'/Users/peter/Development/morrowind',stdio:'ignore'});for(let i=0;i<60&&!(await up());i++)await sleep(500);}
const [tag,...specs]=process.argv.slice(2);
const W=1920,H=1080;
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',
  args:[`--window-size=${W},${H}`,'--use-angle=metal','--ignore-gpu-blocklist','--enable-gpu-rasterization','--hide-scrollbars','--mute-audio'],
  defaultViewport:{width:W,height:H,deviceScaleFactor:1}});
const p=await b.newPage();
p.on('pageerror',e=>console.log('PAGEERROR:',e.message));
p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,300))});
await p.goto(URL,{waitUntil:'networkidle2',timeout:90000});
await p.waitForFunction('!!window.engine',{timeout:180000});
const dir=`shots/${tag}`; await mkdir(dir,{recursive:true});
let i=0;
for(const s of specs){
  const [x,z,y,yaw,pitch,hour,weather]=s.split(',');
  await p.evaluate((a)=>{
    const ctx=window.engine.ctx;
    ctx.clock.hour=+a.hour;
    ctx.camera.fov=65; ctx.camera.updateProjectionMatrix();
    ctx.get('sky')?.setWeather?.(a.weather||'clear',0);
    const pl=ctx.get('player'); if(pl) pl.freefly=true;
    pl?.teleport?.(+a.x,+a.z,0);
    ctx.camera.position.set(+a.x,+a.y,+a.z);
    pl?.setLook?.(+a.yaw*Math.PI/180, +a.pitch*Math.PI/180);
  },{x,z,y,yaw,pitch,hour,weather});
  await sleep(2600);
  const info=await p.evaluate(()=>{
    const ctx=window.engine.ctx; const sky=ctx.get('sky');
    const w=sky?.weather; const sd=w?.sunDir;
    const cam=ctx.camera; const f=new cam.position.constructor(); cam.getWorldDirection(f);
    return {sun:sd?[+sd.x.toFixed(3),+sd.y.toFixed(3),+sd.z.toFixed(3)]:null,
      sunAzDeg: sd?+(Math.atan2(sd.x,sd.z)*180/Math.PI).toFixed(1):null,
      sunElDeg: sd?+(Math.asin(sd.y)*180/Math.PI).toFixed(1):null,
      sunCol: w?[+w.sunColor.r.toFixed(3),+w.sunColor.g.toFixed(3),+w.sunColor.b.toFixed(3)]:null,
      amb: w?[+w.ambient.r.toFixed(4),+w.ambient.g.toFixed(4),+w.ambient.b.toFixed(4)]:null,
      fog: w?.fogDensity, wind:w?.windSpeed,
      camAzDeg:+(Math.atan2(f.x,f.z)*180/Math.PI).toFixed(1), camY:+cam.position.y.toFixed(2)};
  });
  console.log('  info', JSON.stringify(info));
  const buf=await p.screenshot({type:'png'});
  const f=`${dir}/${String(i++).padStart(2,'0')}.png`;
  await writeFile(f,buf); console.log(f,s);
}
await b.close(); vite?.kill();
