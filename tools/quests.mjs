#!/usr/bin/env node
/**
 * QUEST COMPLETABILITY.
 *
 * e2e.mjs only ever checks that a quest can be STARTED. 18 quests are defined
 * and none has been driven to completion, so "the game has 18 quests" has been
 * an unverified claim. This walks every quest through its own declared stages
 * and reports which can actually be finished, which stall, and where.
 *
 * It also exercises the surrounding systems the quest layer depends on and
 * which have never been touched by a test: crime and bounty, NPC schedules,
 * faction rank advancement, and book reading.
 */
import { launch } from 'puppeteer-core';
import { spawn, execSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 5205;
const URL = `http://127.0.0.1:${PORT}/`;

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
execSync('npx vite build --outDir dist-quest --emptyOutDir', { stdio: 'ignore' });
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-quest', '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'ignore' });
for (let i = 0; i < 90 && !(await up()); i++) await sleep(500);
await mkdir('shots/quests', { recursive: true });

const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
  defaultViewport: { width: 1024, height: 576 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(2500);

/* ---------------------------------------------------------- shape discovery */
const shape = await page.evaluate(() => {
  const Q = window.engine.ctx.get('quest');
  const qs = Q.quests();
  const q0 = qs[0];
  return {
    count: qs.length,
    api: Object.getOwnPropertyNames(Object.getPrototypeOf(Q)).filter((n) => typeof Q[n] === 'function'),
    sample: q0 ? JSON.stringify(q0).slice(0, 700) : null,
  };
});
console.log(`quests defined: ${shape.count}`);
console.log(`quest API: ${shape.api.join(', ')}\n`);
console.log(`sample quest shape:\n  ${shape.sample}\n`);

/* ------------------------------------------------------- drive each to done */
// Progression is via takePath: stages carry numbered `paths`, and there is no
// advance()/setStage() at all. The first version of this test looked for one,
// found none, and reported all 18 quests stuck — a bug in the test, not the game.
const run = await page.evaluate(async () => {
  const ctx = window.engine.ctx, Q = ctx.get('quest'), R = ctx.get('rpg');
  // takePath returns the SKILL CHECK result, and a failed check routes back to
  // the same stage by design. A level-1 character therefore looks identical to a
  // broken quest system. Raise the character so checks pass and we are testing
  // the quest graph rather than the dice.
  try {
    const c = R.character;
    for (const k of Object.keys(c.skills ?? {})) c.skills[k] = 100;
    for (const k of Object.keys(c.attributes ?? {})) c.attributes[k] = 100;
    if (c.gold !== undefined) c.gold = 10000;
  } catch { /* best effort — reported below either way */ }
  const out = [];
  for (const def of Q.quests()) {
    const id = def.id;
    const rec = { id, name: def.name ?? id, stages: def.stages?.length ?? 0, reached: 0, path: [], done: false, err: null };
    try {
      Q.startQuest(id);
      rec.startStage = Q.questStage(id);
      // Follow the first available path at each stage until none is offered.
      for (let step = 0; step < 24; step++) {
        const before = Q.questStage(id);
        const offers = (Q.offers() ?? []).filter((o) => o.quest === id);
        if (!offers.length) break;
        // Try every offered path, not just the first: some are gated on `when`
        // or on a skill we still fail, and a dead first option is not a dead quest.
        let took = false;
        for (const o of offers) { if (Q.takePath(id, o.path.id ?? o.path)) { took = true; break; } }
        const after = Q.questStage(id);
        rec.path.push(`${before}->${after}${took ? '' : '(refused)'}`);
        if (after === before) break;          // no progress: stop rather than spin
        rec.reached = after;
      }
      const stages = def.stages ?? [];
      const last = stages.length ? stages[stages.length - 1].n : null;
      rec.finalStage = Q.questStage(id);
      rec.lastDefined = last;
      rec.done = last != null && rec.finalStage >= last;
      const jd = Q.journal().filter((e) => e.quest === id);
      rec.journalEntries = jd.length;
    } catch (e) { rec.err = String(e?.message ?? e).slice(0, 120); }
    out.push(rec);
  }
  return out;
});

console.log('=== QUEST WALKTHROUGH ===');
let done = 0, partial = 0, stuck = 0;
for (const r of run) {
  const verdict = r.done ? 'COMPLETE' : r.reached > 0 ? 'PROGRESS' : 'STUCK';
  if (verdict === 'COMPLETE') done++; else if (verdict === 'PROGRESS') partial++; else stuck++;
  console.log(`  ${verdict.padEnd(8)} ${String(r.name).slice(0, 30).padEnd(31)} stage ${String(r.startStage ?? '?').padStart(3)} -> ${String(r.finalStage ?? '?').padStart(3)} of ${String(r.lastDefined ?? '?').padStart(3)}  journal=${r.journalEntries ?? 0}  ${r.path.slice(0, 4).join(' ')}${r.err ? '  ERR ' + r.err : ''}`);
}
console.log(`\n  ${done} complete, ${partial} progressing, ${stuck} stuck, of ${run.length}`);

/* ------------------------------------------- surrounding systems, never tested */
console.log('\n=== SURROUNDING SYSTEMS ===');
const extra = await page.evaluate(async () => {
  const ctx = window.engine.ctx, Q = ctx.get('quest'), R = ctx.get('rpg');
  const o = {};
  // Crime / bounty
  try {
    const b0 = Q.bounty?.() ?? Q.crime?.()?.bounty ?? null;
    if (typeof Q.reportCrime === 'function') Q.reportCrime('theft', 50);
    else if (typeof Q.addBounty === 'function') Q.addBounty(50);
    o.crime = { before: b0, after: Q.bounty?.() ?? Q.crime?.()?.bounty ?? null };
  } catch (e) { o.crime = { err: String(e?.message ?? e).slice(0, 80) }; }
  // Faction advancement
  try {
    const f = Q.factions()[0];
    const r0 = Q.rankName(f.id);
    const blockers = Q.promotionBlockers?.(f.id) ?? null;
    o.faction = { name: f.name ?? f.id, rank: r0, blockers: Array.isArray(blockers) ? blockers.slice(0, 3) : blockers };
  } catch (e) { o.faction = { err: String(e?.message ?? e).slice(0, 80) }; }
  // NPC schedules: do locations change with the clock?
  try {
    const npcs = Q.npcs().slice(0, 5).map((n) => n.id);
    ctx.clock.hour = 3; const night = npcs.map((n) => Q.npcLocation(n));
    ctx.clock.hour = 13; const day = npcs.map((n) => Q.npcLocation(n));
    o.schedules = { moved: night.filter((l, i) => l !== day[i]).length, of: npcs.length, night: night.slice(0, 3), day: day.slice(0, 3) };
  } catch (e) { o.schedules = { err: String(e?.message ?? e).slice(0, 80) }; }
  // Books
  try {
    const books = (Q.books?.() ?? []);
    o.books = { count: books.length, sample: books.length ? String(books[0].title ?? books[0].id) : null,
      words: books.length ? String(books[0].text ?? '').split(/\s+/).length : 0 };
  } catch (e) { o.books = { err: String(e?.message ?? e).slice(0, 80) }; }
  return o;
});
for (const [k, v] of Object.entries(extra)) console.log(`  ${k.padEnd(10)} ${JSON.stringify(v).slice(0, 170)}`);

if (errs.length) { console.log('\n=== PAGE ERRORS ==='); [...new Set(errs)].slice(0, 8).forEach((e) => console.log('  ' + e)); }
await writeFile('shots/quests/quests.json', JSON.stringify({ shape, run, extra, errs: [...new Set(errs)] }, null, 2));
await browser.close();
server.kill();
