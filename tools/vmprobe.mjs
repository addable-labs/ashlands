import { launch } from 'puppeteer-core';
import { setTimeout as sleep } from 'node:timers/promises';
const URL='http://127.0.0.1:5178/';
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',
  args:['--use-angle=metal','--ignore-gpu-blocklist'],defaultViewport:{width:1280,height:720}});
const p=await b.newPage(); p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('!!window.engine',{timeout:180000}); await sleep(2500);
await p.evaluate(()=>{const c=window.engine.ctx,pl=c.get('player');
  pl.freefly=false; c.input.pointerLocked=true; c.get('combat')?.equip?.(0);});
await sleep(1500);
console.log(JSON.stringify(await p.evaluate(()=>{
  const c=window.engine.ctx, cam=c.camera;
  const out=[];
  c.scene.traverse(o=>{
    if(!(o.isMesh)) return;
    const n=(o.name||'')+'|'+(o.parent?.name||'');
    if(!/view|arm|hand|gaunt|vamb|finger|weapon|glove/i.test(n)) return;
    const wp=new (cam.position.constructor)(); o.getWorldPosition(wp);
    const d=wp.clone().sub(cam.position);
    const fwd=new (cam.position.constructor)(); cam.getWorldDirection(fwd);
    o.geometry.computeBoundingSphere();
    out.push({name:o.name||'(unnamed)', parent:o.parent?.name||'', vis:o.visible,
      dist:+d.length().toFixed(3), aheadOfCam:+d.dot(fwd).toFixed(3),
      radius:+(o.geometry.boundingSphere?.radius??0).toFixed(3),
      tris:(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3,
      frustumCulled:o.frustumCulled, matVisible:o.material?.visible, opacity:o.material?.opacity});
  });
  return {camNear:cam.near, count:out.length, meshes:out.slice(0,20)};
}),null,1));
await b.close();
