import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
const URL='http://127.0.0.1:5178/';
async function up(){try{return (await fetch(URL,{signal:AbortSignal.timeout(800)})).ok}catch{return false}}
let vite=null;
if(!(await up())){vite=spawn('npx',['vite','--port','5178','--host','127.0.0.1'],{stdio:'ignore'});for(let i=0;i<60&&!(await up());i++)await sleep(500);}
await mkdir('shots/play',{recursive:true});
const b=await launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',
  args:['--use-angle=metal','--ignore-gpu-blocklist','--window-size=1600,900'],defaultViewport:{width:1600,height:900}});
const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200));});
await p.goto(URL,{waitUntil:'domcontentloaded'});
const t0=Date.now();
await p.waitForFunction('!!window.engine',{timeout:180000});
console.log(`BOOT: ok in ${((Date.now()-t0)/1000).toFixed(1)}s`);

const sys = await p.evaluate(()=>{const c=window.engine.ctx;
  const ids=['materials','sky','terrain','water','flora','arch','vfx','actors','player','rpg','combat','quest','ui','audio','render'];
  return ids.map(i=>({id:i, present: !!c.get(i)}));});
console.log('SYSTEMS:', sys.filter(s=>s.present).map(s=>s.id).join(', '));
console.log('MISSING:', sys.filter(s=>!s.present).map(s=>s.id).join(', ') || '(none)');

// Does the HUD exist in the DOM?
const ui = await p.evaluate(()=>{
  const all=[...document.querySelectorAll('body *')].filter(e=>e.id||e.className);
  const vis=all.filter(e=>{const r=e.getBoundingClientRect();const st=getComputedStyle(e);
    return r.width>4&&r.height>4&&st.display!=='none'&&st.visibility!=='hidden'&&+st.opacity>0.05;});
  return {total:all.length, visible:vis.length,
    ids:[...new Set(vis.map(e=>e.id).filter(Boolean))].slice(0,25),
    classes:[...new Set(vis.flatMap(e=>[...e.classList]))].slice(0,25)};});
console.log('UI DOM: total', ui.total, 'visible', ui.visible);
console.log('  ids:', ui.ids.join(' ') || '(none)');
console.log('  classes:', ui.classes.join(' ') || '(none)');

// Walk forward: hold W and see whether the player position changes on the ground.
const before = await p.evaluate(()=>{const pl=window.engine.ctx.get('player');
  if(pl) pl.freefly=false; return pl?{x:+pl.position.x.toFixed(2),y:+pl.position.y.toFixed(2),z:+pl.position.z.toFixed(2),grounded:pl.grounded,view:pl.view}:null;});
// Real key events: the UI listens on `document`, and synthetic events dispatched
// on `window` never reach it. page.keyboard produces trusted events at the top.
await p.keyboard.down('w'); await sleep(2500); await p.keyboard.up('w');
const after = await p.evaluate(()=>{const pl=window.engine.ctx.get('player');
  return pl?{x:+pl.position.x.toFixed(2),y:+pl.position.y.toFixed(2),z:+pl.position.z.toFixed(2),grounded:pl.grounded,view:pl.view}:null;});
const moved = before&&after? Math.hypot(after.x-before.x, after.z-before.z):0;
console.log(`WALK: ${JSON.stringify(before)} -> ${JSON.stringify(after)}  moved ${moved.toFixed(2)} m`);

// Creatures alive?
const actors = await p.evaluate(()=>{const a=window.engine.ctx.get('actors');
  if(!a?.all) return null; const list=a.all();
  const k={}; for(const x of list) k[x.kind]=(k[x.kind]||0)+1;
  return {count:list.length, kinds:k};});
console.log('ACTORS:', JSON.stringify(actors));

// RPG state?
const rpg = await p.evaluate(()=>{const r=window.engine.ctx.get('rpg');
  if(!r) return null; const out={};
  for(const k of ['level','health','magicka','fatigue','attributes','skills','inventory'])
    if(r[k]!==undefined) out[k]= typeof r[k]==='object'? (Array.isArray(r[k])?r[k].length:Object.keys(r[k]).length) : r[k];
  return out;});
console.log('RPG:', JSON.stringify(rpg));

// Try the usual menu keys and see if anything opens.
for (const [key,label] of [['KeyI','inventory'],['KeyJ','journal'],['KeyM','map'],['Escape','pause'],['Tab','menu']]) {
  const v0 = await p.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();
    return r.width>100&&r.height>100&&getComputedStyle(e).display!=='none';}).length);
  await p.keyboard.press(key === 'Escape' ? 'Escape' : key === 'Tab' ? 'Tab' : key.replace('Key','').toLowerCase());
  await sleep(1000);
  const v1 = await p.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();
    return r.width>100&&r.height>100&&getComputedStyle(e).display!=='none';}).length);
  console.log(`KEY ${key} (${label}): large elements ${v0} -> ${v1} ${v1>v0?'  <== opened something':''}`);
  await writeFile(`shots/play/key-${label}.png`, await p.screenshot({type:'png'}));
  await p.keyboard.press('Escape');
  await sleep(600);
}
await writeFile('shots/play/hud.png', await p.screenshot({type:'png'}));
if (errs.length) { console.log('\nRUNTIME ERRORS:'); [...new Set(errs)].slice(0,12).forEach(e=>console.log('  '+e)); }
await b.close(); vite?.kill();
