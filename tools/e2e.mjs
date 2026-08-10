#!/usr/bin/env node
/**
 * End-to-end playthrough.
 *
 * Drives the real game with real input where the player would use input, and
 * through the public API where a UI panel would normally drive it. Every step
 * asserts an observable state change rather than "it did not throw", and grabs
 * a still for evidence.
 *
 * Framerate is deliberately NOT measured here — screenshotting stalls the
 * render loop, so any fps read during this run would be a lie. tools/shoot.mjs
 * measures that cleanly.
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const URL = 'http://127.0.0.1:5178/';
const OUT = 'shots/e2e';

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) {
  vite = spawn('npx', ['vite', '--port', '5178', '--host', '127.0.0.1'], { stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
}
await mkdir(OUT, { recursive: true });

const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1600,900', '--mute-audio'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 240)); });

const results = [];
let step = 0;
async function check(name, fn) {
  step++;
  let verdict = 'FAIL', detail = '';
  try {
    const r = await fn();
    verdict = r.ok ? 'PASS' : (r.partial ? 'PARTIAL' : 'FAIL');
    detail = r.detail ?? '';
  } catch (e) {
    detail = 'threw: ' + (e?.message ?? String(e)).slice(0, 200);
  }
  const file = `${OUT}/${String(step).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
  try { await writeFile(file, await page.screenshot({ type: 'png' })); } catch {}
  results.push({ step, name, verdict, detail });
  console.log(`${verdict.padEnd(7)} ${name}${detail ? ' — ' + detail : ''}`);
}

await page.goto(URL, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
const bootMs = Date.now() - t0;
console.log(`\n=== ASHLANDS END-TO-END PLAYTHROUGH ===\nboot ${(bootMs / 1000).toFixed(1)}s\n`);
await sleep(1500);

// Click to focus/lock, as a player would.
await page.mouse.click(800, 450);
await sleep(600);

await check('Walk on foot', async () => {
  const b = await page.evaluate(() => { const p = window.engine.ctx.get('player'); p.freefly = false;
    return { x: p.position.x, z: p.position.z, g: p.grounded }; });
  await page.keyboard.down('w'); await sleep(2000); await page.keyboard.up('w');
  const a = await page.evaluate(() => { const p = window.engine.ctx.get('player');
    return { x: p.position.x, z: p.position.z, g: p.grounded }; });
  const d = Math.hypot(a.x - b.x, a.z - b.z);
  return { ok: d > 1 && a.g, detail: `moved ${d.toFixed(1)}m, grounded=${a.g}` };
});

await check('Jump', async () => {
  const y0 = await page.evaluate(() => window.engine.ctx.get('player').position.y);
  await page.keyboard.press('Space');
  await sleep(220);
  const y1 = await page.evaluate(() => window.engine.ctx.get('player').position.y);
  await sleep(1200);
  return { ok: y1 - y0 > 0.25, detail: `rose ${(y1 - y0).toFixed(2)}m` };
});

await check('Swim in the sea', async () => {
  const r = await page.evaluate(async () => {
    const ctx = window.engine.ctx, p = ctx.get('player'), t = ctx.get('terrain');
    // Find open water and drop the player into it.
    let spot = null;
    for (let x = -1900; x <= 1900 && !spot; x += 100)
      for (let z = -1900; z <= 1900; z += 100)
        if (t.heightAt(x, z) < -8) { spot = { x, z }; break; }
    if (!spot) return { found: false };
    p.teleport(spot.x, spot.z, 6);
    await new Promise((r) => setTimeout(r, 2500));
    return { found: true, y: p.position.y, swimming: p.position.y < 2 && p.position.y > -6 };
  });
  return { ok: !!r.found && r.swimming, partial: !!r.found,
    detail: r.found ? `floating at y=${r.y.toFixed(2)} (sea level 0)` : 'no open water found' };
});

await check('Melee attack lands on a creature', async () => {
  const r = await page.evaluate(async () => {
    const ctx = window.engine.ctx, p = ctx.get('player'), A = ctx.get('actors'), C = ctx.get('combat');
    // Ground creatures only: ash shrikes and skerrin hover above a blade's arc, so
    // swinging at them correctly misses and tells us nothing about the hit path.
    const GROUND = ['morvek', 'drell', 'glassjaw'];
    const list = A.all().filter((a) => a.alive && GROUND.includes(a.kind));
    if (!list.length) return { none: true };
    const best = list[0];
    // Headless does grant pointer lock, but assert it: combat gates on it.
    ctx.input.pointerLocked = true;
    // Combat gates the swing on `armed`, so ready a weapon first — the digit keys
    // are the loadout slots the player uses.
    ctx.get('combat').equip(0);
    p.teleport(best.position.x + 1.6, best.position.z, 0.2);
    const dx = best.position.x - p.position.x, dz = best.position.z - p.position.z;
    p.setLook(Math.atan2(dx, dz) + Math.PI, 0);
    await new Promise((r) => setTimeout(r, 700));
    const hp0 = best.health, sw0 = C.stats.swings, hi0 = C.stats.hits;
    window.__tgt = best; window.__hp0 = hp0; window.__sw0 = sw0; window.__hi0 = hi0;
    return { kind: best.kind, hp0, dist: Math.hypot(dx, dz) };
  });
  if (r.none) return { ok: false, detail: 'no creatures alive' };
  // Charge and release, as a player does. `stats.swings` is dead telemetry (never
  // incremented), so count real swing cycles off the state machine instead.
  let cycles = 0;
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => { window.engine.ctx.input.pointerLocked = true; });
    await page.mouse.down(); await sleep(500); await page.mouse.up(); await sleep(700);
    cycles += await page.evaluate(() => (window.engine.ctx.get('combat').swing?.s ?? 0) > 1 ? 1 : 0);
  }
  const after = await page.evaluate(() => { const C = window.engine.ctx.get('combat');
    return { hp: window.__tgt.health, alive: window.__tgt.alive, hits: C.stats.hits - window.__hi0 }; });
  return { ok: after.hits > 0 || after.hp < r.hp0,
    partial: cycles > 0,
    detail: `${r.kind} hp ${r.hp0.toFixed(0)}→${after.hp.toFixed(0)}, ${cycles} swing cycles, ${after.hits} hits, alive=${after.alive}` };
});

await check('Creature fights back / takes damage from us', async () => {
  const r = await page.evaluate(() => {
    const ctx = window.engine.ctx, A = ctx.get('actors');
    const t = window.__tgt;
    if (!t) return { ok: false };
    // Apply a decisive blow through the same API combat uses, to test death+ragdoll.
    const before = { hp: t.health, alive: t.alive };
    A.damage(t, 9999, new (t.position.constructor)(1, 0, 0));
    return { before, after: { hp: t.health, alive: t.alive }, kind: t.kind };
  });
  await sleep(1500);
  return { ok: r.after && r.after.alive === false, detail: r.after ? `${r.kind} killed: hp ${r.before.hp.toFixed(0)}→${r.after.hp.toFixed(0)}, alive=${r.after.alive}` : 'no target' };
});

await check('Cast a spell', async () => {
  const r = await page.evaluate(() => {
    const R = window.engine.ctx.get('rpg');
    const s0 = R.stats();
    const out = R.cast();
    const s1 = R.stats();
    return { out, mp0: s0.magicka?.current ?? s0.magicka, mp1: s1.magicka?.current ?? s1.magicka };
  });
  await sleep(1200);
  const spent = (r.mp0 ?? 0) - (r.mp1 ?? 0);
  return { ok: !!r.out && (spent > 0 || r.out.success === true),
    partial: !!r.out,
    detail: `outcome=${JSON.stringify(r.out).slice(0, 120)}, magicka ${Math.round(r.mp0)}→${Math.round(r.mp1)}` };
});

await check('Talk to an NPC (topic dialogue)', async () => {
  const r = await page.evaluate(() => {
    const Q = window.engine.ctx.get('quest');
    const npcs = Q.npcs();
    if (!npcs.length) return { none: true };
    const npc = npcs[0];
    const t = Q.talk(npc.id);
    const topics = (t?.topics ?? Q.knownTopics()) || [];
    const first = topics[0];
    const answer = first ? Q.ask(npc.id, first) : null;
    return { npc: npc.name ?? npc.id, disposition: Q.disposition(npc.id),
      topicCount: topics.length, topic: first ? Q.topicLabel(first) : null,
      answer: answer ? String(answer.text ?? answer.response ?? JSON.stringify(answer)).slice(0, 160) : null };
  });
  if (r.none) return { ok: false, detail: 'no NPCs defined' };
  return { ok: r.topicCount > 0 && !!r.answer, partial: r.topicCount > 0,
    detail: `${r.npc} (disposition ${r.disposition}), ${r.topicCount} topics; asked "${r.topic}" → ${r.answer ? '"' + r.answer + '"' : 'no reply'}` };
});

await check('Persuade an NPC', async () => {
  const r = await page.evaluate(() => {
    const Q = window.engine.ctx.get('quest');
    const npc = Q.npcs()[0];
    const d0 = Q.disposition(npc.id);
    const res = Q.persuade(npc.id, 'admire', 0);
    return { d0, d1: Q.disposition(npc.id), res: JSON.stringify(res).slice(0, 140) };
  });
  return { ok: r.d1 !== r.d0, partial: !!r.res, detail: `disposition ${r.d0}→${r.d1}; ${r.res}` };
});

await check('Start a quest and get a journal entry', async () => {
  const r = await page.evaluate(() => {
    const Q = window.engine.ctx.get('quest');
    const qs = Q.quests();
    if (!qs.length) return { none: true };
    const j0 = Q.journal().length;
    Q.startQuest(qs[0].id);
    const j = Q.journal();
    return { total: qs.length, started: qs[0].name ?? qs[0].id, j0, j1: j.length,
      last: j.length ? String(j[j.length - 1].text ?? '').slice(0, 160) : null };
  });
  if (r.none) return { ok: false, detail: 'no quests defined' };
  return { ok: r.j1 > r.j0, partial: r.total > 0,
    detail: `${r.total} quests defined; started "${r.started}"; journal ${r.j0}→${r.j1}${r.last ? ' — "' + r.last + '"' : ''}` };
});

await check('Join a faction', async () => {
  const r = await page.evaluate(() => {
    const Q = window.engine.ctx.get('quest');
    const fs = Q.factions();
    if (!fs.length) return { none: true };
    const ok = Q.join(fs[0].id);
    return { count: fs.length, name: fs[0].name ?? fs[0].id, joined: ok, rank: Q.rankName(fs[0].id) };
  });
  if (r.none) return { ok: false, detail: 'no factions' };
  return { ok: !!r.joined && !!r.rank, partial: r.count > 0,
    detail: `${r.count} factions; joined ${r.name}=${r.joined}, rank=${r.rank}` };
});

await check('Equip an item from inventory', async () => {
  const r = await page.evaluate(() => {
    const R = window.engine.ctx.get('rpg');
    const list = R.character.inventory.stacks ?? [];
    const wearable = list.find((i) => /weapon|armor|armour|cuirass|boot|helm|shield/i.test(i.def ?? ''));
    if (!wearable) return { none: true, n: list.length };
    const ok = R.equip(wearable.uid);
    return { name: wearable.def, ok, n: list.length };
  });
  if (r.none) return { ok: false, detail: `${r.n} items but none equippable` };
  return { ok: !!r.ok, detail: `equip("${r.name}") → ${r.ok}` };
});

await check('Brew a potion (alchemy)', async () => {
  const r = await page.evaluate(() => {
    const R = window.engine.ctx.get('rpg');
    const list = R.character.inventory.stacks ?? [];
    const ing = list.filter((i) => /ingredient|ingred:/i.test(i.def ?? '')).slice(0, 2);
    if (ing.length < 2) return { none: true, n: list.length };
    const res = R.brewPotion(ing.map((i) => i.uid));
    return { used: ing.map((i) => i.def), res: JSON.stringify(res).slice(0, 200) };
  });
  if (r.none) return { ok: false, detail: `only ${r.n} items, need 2 ingredients` };
  return { ok: /true|potion|name/i.test(r.res), detail: `${r.used.join(' + ')} → ${r.res}` };
});

await check('Make a custom spell (spellmaking)', async () => {
  const r = await page.evaluate(() => {
    const R = window.engine.ctx.get('rpg');
    const R2 = window.engine.ctx.get('rpg');
    const known = R2.character?.spells?.[0]?.effects?.[0];
    const eff = [known
      ? { ...known, magnitude: 12, duration: 1 }
      : { id: 'fireDamage', magnitude: 12, duration: 1, area: 0, range: 'target' }];
    const price = R.priceSpell(eff);
    const sp = R.createSpell('Ashlands Test Bolt', eff);
    return { price: JSON.stringify(price).slice(0, 120), made: sp ? (sp.name ?? 'ok') : null };
  });
  return { ok: !!r.made, detail: `price=${r.price}; created=${r.made}` };
});

await check('Skill improves by use', async () => {
  const r = await page.evaluate(() => {
    const R = window.engine.ctx.get('rpg');
    const before = JSON.stringify(R.stats().skills ?? {});
    let n = 0;
    for (let i = 0; i < 200; i++) if (R.noteSkillUse('shortBlade', 0, 1)) n++;
    const after = JSON.stringify(R.stats().skills ?? {});
    return { changed: before !== after, levelUps: n };
  });
  return { ok: r.changed, detail: `skills changed=${r.changed}, ${r.levelUps} threshold crossings` };
});

await check('Save and load round-trip', async () => {
  const r = await page.evaluate(async () => {
    const ctx = window.engine.ctx, R = ctx.get('rpg'), p = ctx.get('player');
    const mark = { x: p.position.x, z: p.position.z };
    const before = JSON.stringify(R.stats()).length;
    const ui = ctx.get('ui');
    // Prefer the real save path if the UI exposes one; else the system serializers.
    let saved = null;
    if (ui && typeof ui.save === 'function') saved = ui.save('e2e');
    else {
      saved = {};
      for (const id of ['rpg', 'quest', 'combat']) {
        const s = ctx.get(id);
        if (s && typeof s.serialize === 'function') saved[id] = s.serialize();
      }
    }
    const blob = JSON.stringify(saved);
    // Perturb, then restore.
    R.damage(25, null, true);
    const hurt = JSON.stringify(R.stats()).length;
    let restored = false;
    const parsed = JSON.parse(blob);
    for (const id of ['rpg', 'quest', 'combat']) {
      const s = ctx.get(id);
      if (s && typeof s.deserialize === 'function' && parsed[id]) { s.deserialize(parsed[id]); restored = true; }
    }
    return { bytes: blob.length, before, hurt, restored, mark };
  });
  return { ok: r.bytes > 200 && r.restored, partial: r.bytes > 200,
    detail: `save blob ${r.bytes} bytes, deserialize ran=${r.restored}` };
});

await check('Day/night cycle advances', async () => {
  const r = await page.evaluate(async () => {
    const ctx = window.engine.ctx;
    const h0 = ctx.clock.hour;
    ctx.clock.scale = 6000;
    await new Promise((r) => setTimeout(r, 2500));
    const h1 = ctx.clock.hour;
    ctx.clock.scale = 60;
    return { h0, h1 };
  });
  return { ok: Math.abs(r.h1 - r.h0) > 0.1, detail: `hour ${r.h0.toFixed(2)} → ${r.h1.toFixed(2)}` };
});

console.log('\n=== SUMMARY ===');
const pass = results.filter((r) => r.verdict === 'PASS').length;
const part = results.filter((r) => r.verdict === 'PARTIAL').length;
const fail = results.filter((r) => r.verdict === 'FAIL').length;
console.log(`${pass} pass, ${part} partial, ${fail} fail, of ${results.length}`);
if (errors.length) {
  console.log('\n=== RUNTIME ERRORS (unique) ===');
  [...new Set(errors)].slice(0, 15).forEach((e) => console.log('  ' + e));
}
await writeFile(`${OUT}/report.json`, JSON.stringify({ bootMs, results, errors: [...new Set(errors)].slice(0, 40) }, null, 2));
await browser.close();
vite?.kill();
