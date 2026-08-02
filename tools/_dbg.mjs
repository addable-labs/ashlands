import { launch } from 'puppeteer-core';
import { setTimeout as sleep } from 'node:timers/promises';
const browser = await launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args:['--use-angle=metal','--ignore-gpu-blocklist','--window-size=800,800'], defaultViewport:{width:800,height:800} });
const page = await browser.newPage();
page.on('pageerror', e=>console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:5178/', { waitUntil:'domcontentloaded' });
await page.waitForFunction('!!window.engine',{timeout:180000});
await sleep(2500);
console.log(JSON.stringify(await page.evaluate(()=>{
  const ctx=window.engine.ctx, T=window.RENDER_THREE;
  const vm = ctx.scene.getObjectByName('viewmodel');
  const out={found:!!vm, visible:vm&&vm.visible, kids:[]};
  if(vm) vm.traverse(o=>{ if(o.isMesh) out.kids.push({n:o.name||'?', vis:o.visible, tri:o.geometry.index?o.geometry.index.count/3:0}); });
  const fore = vm && vm.getObjectByName('vm-fore-r');
  if (fore){ const b=new T.Box3().setFromObject(fore); out.foreBox={min:b.min.toArray().map(v=>+v.toFixed(2)),max:b.max.toArray().map(v=>+v.toFixed(2))}; }
  const rh = vm && vm.getObjectByName('vm-hand-r');
  if (rh){ const b=new T.Box3().setFromObject(rh); out.handBox={min:b.min.toArray().map(v=>+v.toFixed(2)),max:b.max.toArray().map(v=>+v.toFixed(2))}; }
  out.cam = ctx.camera.position.toArray().map(v=>+v.toFixed(2));
  out.autoClear = ctx.renderer.autoClear;
  return out;
})));
await browser.close();
