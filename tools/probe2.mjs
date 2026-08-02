import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const URL='http://127.0.0.1:5178/';
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
let vite=null;
if(!(await up())){vite=spawn('npx',['vite','--port','5178','--host','127.0.0.1'],{stdio:'ignore'});for(let i=0;i<60&&!(await up());i++)await sleep(500);}
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--use-angle=metal','--ignore-gpu-blocklist'],defaultViewport:{width:1280,height:720}});
const p=await b.newPage(); await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('!!window.engine',{timeout:180000}); await sleep(1500);
await p.mouse.click(640,360); await sleep(500);
console.log('pointerLocked granted by headless:', await p.evaluate(()=>window.engine.ctx.input.pointerLocked));

// Force the lock flag the way a real browser would set it, then swing for real.
const setup = await p.evaluate(async ()=>{
  const ctx=window.engine.ctx, pl=ctx.get('player'), A=ctx.get('actors'), C=ctx.get('combat');
  ctx.input.pointerLocked = true; pl.freefly=false; C.equip(0);
  const t = A.all().find(a=>a.alive && a.kind!=='dunmer' && a.kind!=='siltstrider' && a.position.y>-20);
  pl.teleport(t.position.x+1.5, t.position.z, 0.2);
  const dx=t.position.x-pl.position.x, dz=t.position.z-pl.position.z;
  pl.setLook(Math.atan2(dx,dz)+Math.PI, 0);
  await new Promise(r=>setTimeout(r,800));
  window.__t=t; return {kind:t.kind, hp:t.health, sw:C.stats.swings, hits:C.stats.hits};
});
// stats.swings is never incremented in Combat.ts (dead counter), so sample the
// actual swing state machine instead.
const trace=[];
await p.mouse.down();
for(let i=0;i<14;i++){ await sleep(120);
  trace.push(await p.evaluate(()=>{const C=window.engine.ctx.get('combat');
    return {phase:C.swing?.phase??null, busy:C.swing?.busy??null, s:+(C.swing?.s??0).toFixed(2), hp:+window.__t.health.toFixed(0)};})); }
await p.mouse.up();
for(let i=0;i<10;i++){ await sleep(120);
  trace.push(await p.evaluate(()=>{const C=window.engine.ctx.get('combat');
    return {phase:C.swing?.phase??null, busy:C.swing?.busy??null, s:+(C.swing?.s??0).toFixed(2), hp:+window.__t.health.toFixed(0)};})); }
console.log('swing trace:', JSON.stringify(trace));
await sleep(300);
console.log('while held:', JSON.stringify(await p.evaluate(()=>{
  const ctx=window.engine.ctx, C=ctx.get('combat'), pl=ctx.get('player');
  return { buttons:[...ctx.input.buttons], pointerLocked:ctx.input.pointerLocked,
    freefly:pl.freefly, combatHasPlayer: C.player!==undefined? C.player!==null : 'n/a',
    swings:C.stats.swings };})));
await p.mouse.up(); await sleep(600);
// Also try dispatching mousedown straight at the canvas element.
await p.evaluate(()=>{const c=document.getElementById('view');
  c.dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true}));});
await sleep(500);
console.log('after direct canvas mousedown:', JSON.stringify(await p.evaluate(()=>{
  const ctx=window.engine.ctx, C=ctx.get('combat');
  return { buttons:[...ctx.input.buttons], swings:C.stats.swings };})));
await p.evaluate(()=>{window.dispatchEvent(new MouseEvent('mouseup',{button:0,bubbles:true}));});
await sleep(800);
console.log('melee:', JSON.stringify(await p.evaluate((s)=>{const C=window.engine.ctx.get('combat');
  return {hp0:s.hp, hp:window.__t.health, alive:window.__t.alive,
    swings:C.stats.swings-s.sw, hits:C.stats.hits-s.hits};},setup)));

// Is the inventory panel wired to the RPG character, or showing its own data?
console.log('inventory wiring:', JSON.stringify(await p.evaluate(()=>{
  const ctx=window.engine.ctx, R=ctx.get('rpg'), U=ctx.get('ui');
  const rpgDefs=(R.character.inventory.stacks||[]).map(s=>s.def);
  const st=U?.state;
  const uiItems = st?.inventory ?? st?.items ?? null;
  return { rpgCount:rpgDefs.length, rpgSample:rpgDefs.slice(0,4),
    uiStateKeys: st?Object.keys(st).slice(0,20):null,
    uiItemCount: Array.isArray(uiItems)?uiItems.length:(uiItems?typeof uiItems:null) };
})));
await b.close(); vite?.kill();
