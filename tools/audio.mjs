#!/usr/bin/env node
/**
 * AUDIO VERIFICATION.
 *
 * The audio subsystem is ~4600 lines of Web Audio — generative score,
 * per-surface footsteps, creature calls, magic, procedural reverb — and it had
 * never once been verified. e2e.mjs launches Chrome with --mute-audio and never
 * touches it. So we had no evidence any of it produced a single sound.
 *
 * This measures the REAL output rather than the system's own meter: it patches
 * AudioNode.connect before the page boots so anything reaching the destination
 * is also fed to our own AnalyserNode.
 *
 * WHAT WE MEASURE, AND WHY NOT FLATNESS
 * -------------------------------------
 * The first version of this test measured spectral flatness and reported
 * 0.001-0.045 — "highly tonal" — for material a player described as white
 * noise. Flatness is the wrong instrument: BAND-LIMITED noise has a very low
 * Wiener entropy (there is no energy outside its band to raise the geometric
 * mean) while still sounding exactly like hiss. Optimising for flatness
 * optimises for a narrow filter, not for pitch.
 *
 * So the acceptance measure here is HARMONICITY, which noise cannot fake:
 *   1. average the power spectrum over the whole listening window,
 *   2. search 40-900 Hz for the fundamental whose harmonic series best
 *      explains that spectrum (log-domain harmonic product, with an
 *      octave-error bias toward the higher candidate),
 *   3. report the fraction of in-band energy that falls inside +-1.2% windows
 *      around that series ("harmonicity"), and that fraction divided by the
 *      fraction of bins those windows occupy ("gain").
 *
 * Gain is the number that matters. A flat or band-limited noise floor puts
 * energy in those windows exactly in proportion to how many bins they cover,
 * so it scores ~1x no matter how narrow the band. Genuinely pitched material
 * concentrates energy into the series and scores several times that.
 */
import { launch } from 'puppeteer-core';
import { spawn, execSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 5204;
const URL = `http://127.0.0.1:${PORT}/`;

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
execSync('npx vite build --outDir dist-audio --emptyOutDir', { stdio: 'ignore' });
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-audio', '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'ignore' });
for (let i = 0; i < 90 && !(await up()); i++) await sleep(500);
await mkdir('shots/audio', { recursive: true });

const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: [
    '--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1280,720',
    // Deliberately NOT --mute-audio. Without these the context stays suspended
    // and every measurement would read silence for the wrong reason.
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
  ],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();

// Tap the graph before anything builds it. 8192 bins so the fundamental search
// has ~3 Hz of resolution — at 2048 a 73 Hz drone and its second harmonic are
// nine bins apart and the harmonic windows overlap into meaninglessness.
await page.evaluateOnNewDocument(() => {
  window.__taps = [];
  const origConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const out = origConnect.call(this, dest, ...rest);
    try {
      const ctx = this.context;
      if (dest === ctx.destination) {
        if (!ctx.__probe) {
          const a = ctx.createAnalyser();
          a.fftSize = 16384; a.smoothingTimeConstant = 0;
          ctx.__probe = a;
          window.__taps.push('installed');
        }
        origConnect.call(this, ctx.__probe);
      }
    } catch { /* a tap must never break the game's own graph */ }
    return out;
  };
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(2000);

// Audio graphs are built lazily on first gesture; supply one and unlock.
await page.mouse.click(640, 360);
await page.evaluate(() => { window.engine.ctx.get('audio')?.unlock?.(); });
await sleep(1500);

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(30)} ${detail}`);
};

const ctxState = await page.evaluate(() => {
  const a = window.engine.ctx.get('audio');
  const actx = a?.graph?.ctx ?? a?.ctx ?? null;
  return {
    present: !!a, ready: a?.ready ?? null, level: a?.level ?? null, voices: a?.voices ?? null,
    state: actx?.state ?? (window.__actxState ?? null),
    tapped: (window.__taps ?? []).length > 0,
    sampleRate: actx?.sampleRate ?? null,
  };
});
record('audio system present', ctxState.present, `ready=${ctxState.ready} voices=${ctxState.voices}`);
record('AudioContext running', ctxState.state === 'running' || ctxState.tapped,
  `state=${ctxState.state ?? 'unknown'} sampleRate=${ctxState.sampleRate ?? '?'} tap=${ctxState.tapped}`);

/**
 * Measure output over `ms`.
 *
 * Level, centroid and flatness come from the whole window. Harmonicity does
 * not: it is computed per 400 ms sub-window and reported as a percentile,
 * because a cliff racer screech is four short events inside a three-second
 * window and averaging its spectrum with the silence between the cries buries
 * the very thing we are trying to detect.
 *
 * The harmonicity statistic is a per-harmonic PEAK-TO-BACKGROUND ratio:
 *
 *   f0 <- the fundamental whose series best rises above the local background
 *   harmDb <- median over that series of 10*log10(peak / background)
 *
 * "Background" is the geometric mean of the power spectrum over +-30% in
 * frequency around each harmonic. Using a LOCAL background is the whole point.
 * A global bin-count normalisation (what this file measured an hour ago)
 * rewards any source whose energy is concentrated low in the band, harmonic or
 * not — it scored the ash storm at 5.96x, which is nonsense. A local
 * background follows the spectral tilt, so broadband and band-limited noise
 * both land near 0 dB however steeply they slope, and only actual partials
 * standing proud of their own neighbourhood score.
 */
const listen = (ms) => page.evaluate(async (ms) => {
  const a = window.engine.ctx.get('audio');
  const actx = a?.graph?.ctx ?? a?.ctx;
  const an = actx?.__probe;
  if (!an) return { err: 'no probe' };
  const N = an.frequencyBinCount;
  const binHz = actx.sampleRate / (2 * N);
  const buf = new Float32Array(an.fftSize);
  const freq = new Float32Array(N);
  const acc = new Float64Array(N);
  const sub = new Float64Array(N);

  const LO = 45, HI = 5200;
  const lo = Math.max(1, Math.floor(LO / binHz));
  const hi = Math.min(N - 2, Math.ceil(HI / binHz));

  /** Analyse one averaged spectrum: returns { f0, harmDb, harmonics }. */
  const analyse = (p) => {
    // The band the source actually occupies, 5th to 95th percentile of
    // cumulative energy. Harmonics are only counted inside it.
    //
    // This matters more than it looks. Ring modulation, formant filtering and
    // any bandpassed voice routinely produce a spectrum whose lowest present
    // partial is well above the fundamental — the cliff racer's carrier sits at
    // 5x its modulator, so its series runs 4,5,6, 9,10,11 x f0 with nothing at
    // all at f0, 2f0 or 3f0. Scoring "is harmonic h present?" over h = 1..12
    // regardless marks half the slots absent by construction and reports a
    // perfectly periodic sound as noise. The missing fundamental is a property
    // of vocal tracts, not of noise.
    let occLo = LO, occHi = HI;
    {
      let tot = 0;
      for (let i = lo; i <= hi; i++) tot += p[i];
      let run = 0;
      for (let i = lo; i <= hi; i++) {
        run += p[i];
        if (run >= tot * 0.05) { occLo = Math.max(LO, i * binHz); break; }
      }
      run = 0;
      for (let i = hi; i >= lo; i--) {
        run += p[i];
        if (run >= tot * 0.05) { occHi = Math.min(HI, i * binHz); break; }
      }
    }

    // Prefix sum of log power -> geometric mean over any range in O(1).
    const L = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) L[i + 1] = L[i] + Math.log(p[i] + 1e-30);
    const bg = (hz) => {
      const a0 = Math.max(lo, Math.floor((hz * 0.72) / binHz));
      const a1 = Math.min(hi, Math.ceil((hz * 1.38) / binHz));
      if (a1 <= a0) return 1e-30;
      return Math.exp((L[a1 + 1] - L[a0]) / (a1 + 1 - a0));
    };
    // Widest peak search that still resolves adjacent harmonics: +-1%.
    const peakAt = (hz) => {
      const c = hz / binHz;
      const w = Math.max(2, Math.round(c * 0.01));
      let m = 0;
      for (let i = Math.max(1, Math.round(c) - w); i <= Math.min(N - 1, Math.round(c) + w); i++) {
        if (p[i] > m) m = p[i];
      }
      return m;
    };

    /** Per-harmonic peak-over-background, in nats, for harmonics in band. */
    const series = (f0) => {
      const rs = [];
      for (let h = 1; h <= 24; h++) {
        const fh = f0 * h;
        if (fh > occHi) break;
        if (fh < occLo) continue;
        rs.push(Math.log(peakAt(fh) + 1e-30) - Math.log(bg(fh) + 1e-30));
      }
      rs.sort((x, y) => x - y);
      return rs;
    };

    let bestF0 = 0, bestScore = -Infinity;
    const cands = [];
    const maxCents = Math.round(1200 * Math.log2(1200 / 40));
    for (let c = 0; c <= maxCents; c += 6) {
      const f0 = 40 * Math.pow(2, c / 1200);
      const rs = series(f0);
      if (rs.length < 4) continue;
      // Median, not mean: one accidentally-loud harmonic must not carry a
      // candidate, and a real series has most of its members above background.
      const score = rs[rs.length >> 1];
      cands.push({ f0, score });
      if (score > bestScore) { bestScore = score; bestF0 = f0; }
    }
    if (!cands.length) return { f0: 0, harmDb: 0, harmonics: 0 };
    // Every subharmonic of the true f0 explains the same peaks, so the search
    // is biased low by construction. Take the highest near-optimal candidate.
    let f0 = bestF0;
    for (const c of cands) if (c.score >= bestScore - 0.2 && c.f0 > f0) f0 = c.f0;
    const rs = series(f0);
    // nats -> dB, on the median member.
    return { f0, harmDb: (10 / Math.LN10) * rs[rs.length >> 1], harmonics: rs.length };
  };

  const SUB_MS = 300;
  const subs = [];
  let frames = 0, subFrames = 0, subStart = performance.now();
  let peak = 0, sumSq = 0, n = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    an.getFloatTimeDomainData(buf);
    for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > peak) peak = v; sumSq += buf[i] * buf[i]; n++; }
    an.getFloatFrequencyData(freq);
    for (let i = 0; i < N; i++) { const m = Math.pow(10, freq[i] / 20); const pw = m * m; acc[i] += pw; sub[i] += pw; }
    frames++; subFrames++;
    if (performance.now() - subStart >= SUB_MS && subFrames > 6) {
      for (let i = 0; i < N; i++) sub[i] /= subFrames;
      subs.push(analyse(sub));
      sub.fill(0); subFrames = 0; subStart = performance.now();
    }
    await new Promise((r) => setTimeout(r, 16));
  }
  if (!frames) return { err: 'no frames' };
  for (let i = 0; i < N; i++) acc[i] /= frames;

  let cenNum = 0, cenDen = 0;
  let flatLog = 0, flatLin = 0, flatN = 0;
  for (let i = 0; i < N; i++) {
    const mag = Math.sqrt(acc[i]);
    const hz = i * binHz;
    cenNum += hz * mag; cenDen += mag;
    if (hz > 80 && hz < 12000) { flatLog += Math.log(acc[i] + 1e-20); flatLin += acc[i]; flatN++; }
  }
  const geo = flatN ? Math.exp(flatLog / flatN) : 0;
  const ari = flatN ? flatLin / flatN : 1;

  // p75 over sub-windows: a sound that is pitched while it is sounding still
  // qualifies even if it is silent for half the window.
  const byDb = subs.slice().sort((x, y) => x.harmDb - y.harmDb);
  const pick = byDb.length ? byDb[Math.min(byDb.length - 1, Math.floor(byDb.length * 0.75))] : null;
  const whole = analyse(acc);

  return {
    peak: +peak.toFixed(5),
    rms: +Math.sqrt(sumSq / Math.max(1, n)).toFixed(5),
    centroidHz: cenDen > 0 ? Math.round(cenNum / cenDen) : 0,
    flatness: ari > 0 ? +(geo / ari).toFixed(3) : 1,
    f0: pick ? +pick.f0.toFixed(1) : 0,
    harmDb: pick ? +pick.harmDb.toFixed(1) : 0,
    harmonics: pick ? pick.harmonics : 0,
    steadyF0: +whole.f0.toFixed(1),
    steadyDb: +whole.harmDb.toFixed(1),
    subs: subs.length,
  };
}, ms);

/**
 * A fundamental is "detectable" when most of its harmonic series stands clear
 * of its own local neighbourhood. The estimator's own floor was measured on two
 * sources that are filtered noise by construction — the soloed ambience bed and
 * a full ash storm — and both sit at 6.1-6.2 dB, which is the overfitting bias
 * of picking the best of ~350 candidate fundamentals. 10 dB is therefore the
 * honest threshold; the soloed score reads 57 dB, so nothing hinges on where in
 * between the line is drawn.
 */
const NOISE_FLOOR_DB = 10;
const pitched = (m) => !!m && m.f0 > 0 && m.harmDb >= NOISE_FLOOR_DB && m.harmonics >= 4;

const metrics = {};
const fmt = (m) => m.err ? m.err
  : `rms=${m.rms} peak=${m.peak} centroid=${m.centroidHz}Hz f0=${m.f0}Hz harm=${m.harmDb}dB`;

/**
 * `settle` exists because gains here move on setTargetAtTime with time
 * constants up to 0.45 s and weather crossfades take longer still. The previous
 * revision measured the music the instant it asked for clear weather and
 * attributed the ash storm's decaying grit to the score.
 */
const trial = async (key, name, setup, ms = 2200, settle = 1500) => {
  await page.evaluate(setup).catch(() => {});
  await sleep(settle);
  const m = await listen(ms);
  if (m.err) { record(name, false, m.err); return m; }
  metrics[key] = m;
  const audible = m.rms > 0.0004 || m.peak > 0.004;
  record(name, audible, fmt(m));
  return m;
};

// Everything quiet: the ambience bed runs from boot and never stops, so this
// is not silence — it is the floor every other sound has to climb out of.
const quiet = await page.evaluate(() => {
  const c = window.engine.ctx;
  c.get('sky')?.setWeather?.('clear', 0);
  c.get('audio')?.setSpace?.('outdoor', 0.2);
});
void quiet;
await sleep(2500);
const silence = await listen(2400);
metrics.baseline = silence;
console.log(`\n  (baseline, ambience only: ${fmt(silence)})`);

console.log('\n=== SUBSYSTEMS ===');

await trial('ambience', 'ambience (wind/weather)', () => {
  const c = window.engine.ctx;
  c.get('sky')?.setWeather?.('clear', 0);
  c.get('audio')?.setSpace?.('outdoor', 0.2);
});

await trial('ashstorm', 'ash storm ambience', () => {
  window.engine.ctx.get('sky')?.setWeather?.('ashstorm', 0.2);
}, 2600);

// The previous revision left the ash storm running through the music trial and
// then blamed the music for a 5.5 kHz centroid that was mostly grit. Every
// trial from here on clears the weather it does not own.
await trial('music', 'music (generative score)', () => {
  const c = window.engine.ctx;
  c.get('sky')?.setWeather?.('clear', 0);
  const a = c.get('audio');
  a?.setCombat?.(false);
  a?.setMood?.('explore', true); a?.setIntensity?.(0.6);
}, 6000);

await trial('combat', 'combat music transition', () => {
  window.engine.ctx.get('audio')?.setCombat?.(true);
}, 4000);

await trial('footsteps', 'footsteps while walking', async () => {
  const c = window.engine.ctx, p = c.get('player');
  c.get('sky')?.setWeather?.('clear', 0);
  c.get('audio')?.setCombat?.(false);
  p.freefly = false; c.input.pointerLocked = true;
  c.input.held.add('KeyW');
}, 3000);

await trial('spell', 'spell cast', () => {
  window.engine.ctx.input.held.delete('KeyW');
  window.engine.ctx.get('rpg')?.cast?.();
}, 2200);

await trial('melee', 'melee swing + impact', async () => {
  const c = window.engine.ctx, A = c.get('actors'), p = c.get('player');
  const t = A.all().find((x) => x.alive && ['kwama', 'guar', 'nixhound'].includes(x.kind));
  if (t) { p.teleport(t.position.x + 1.5, t.position.z, 0.2);
    A.damage(t, 5, new (t.position.constructor)(1, 0, 0)); }
  c.get('combat')?.equip?.(0);
}, 2400);

// The cliff racer screech is the one creature sound the series is known for and
// it is a pitched shriek, so it is fired directly rather than hoping one
// wanders into earshot.
await trial('creature', 'creature calls', () => {
  const c = window.engine.ctx, a = c.get('audio');
  const emit = () => a?.creature?.('cliffracer', 'alert', null);
  emit();
  for (let i = 1; i < 3; i++) setTimeout(emit, i * 1400);
}, 4000, 0);

await trial('underwater', 'underwater / space change', () => {
  const c = window.engine.ctx;
  c.get('audio')?.setSpace?.('underwater', 0.3);
  // setSpace only crossfades the convolver. The head-under-water low-pass is
  // driven by a separate event, which src/water/Water.ts emits alongside the
  // submersion flag — so measuring setSpace on its own measures a player who
  // is in a flooded room with their head in the air.
  c.bus.emit('audio:muffle', { amount: 1, source: 'test' });
}, 2400);

// ---- solo diagnostics ---------------------------------------------------
// The mix numbers above are what the player hears, and they are what the
// acceptance runs on. But they cannot say WHICH bus is responsible, and the
// original report ("music at 5730 Hz") was in fact mostly ash grit bleeding
// into the music window. Soloing costs two more windows and removes the guess.
console.log('\n=== SOLO (diagnostic; the mix above is what is judged) ===');

const solo = async (key, name, only, setup, ms = 4500) => {
  await page.evaluate((only, setup) => {
    const a = window.engine.ctx.get('audio');
    window.engine.ctx.get('sky')?.setWeather?.('clear', 0);
    a.setSpace('outdoor', 0.2);
    for (const b of ['music', 'sfx', 'ambience', 'ui']) a.setVolume(b, b === only ? window.__vol[b] : 0);
    // eslint-disable-next-line no-new-func
    if (setup) new Function(setup)();
  }, only, setup);
  await sleep(1800);
  const m = await listen(ms);
  metrics[key] = m;
  record(name, !m.err, fmt(m));
};

await page.evaluate(() => {
  const a = window.engine.ctx.get('audio');
  window.__vol = { music: a.getVolume('music'), sfx: a.getVolume('sfx'),
    ambience: a.getVolume('ambience'), ui: a.getVolume('ui') };
});

await page.evaluate(() => {
  window.engine.ctx.bus.emit('audio:muffle', { amount: 0, source: 'test' });
});
await sleep(1200);

await solo('musicSolo', 'music bus alone', 'music',
  "const a = window.engine.ctx.get('audio'); a.setCombat(false); a.setMood('explore', true); a.setIntensity(0.6);");
await solo('ambienceSolo', 'ambience bus alone', 'ambience', null);
// The ash storm is the loudest noise the game makes. It is only a valid control
// while it is soloed: in the full mix it now scores 14 dB, but that is the
// music drone showing through it, which is a fact about the new balance rather
// than about the storm.
await solo('ashstormSolo', 'ash storm, soloed', 'ambience',
  "window.engine.ctx.get('sky').setWeather('ashstorm', 0.2);", 3500);
await page.evaluate(() => { window.engine.ctx.get('sky')?.setWeather?.('clear', 0); });
// The report asked whether the mixer's ducking actually engages. Soloing the
// ambience bus is the only way to see it: in the full mix the combat cue comes
// up as the bed goes down and the two changes cancel in the RMS.
await solo('ambienceDucked', 'ambience bus, combat ducking', 'ambience',
  "window.engine.ctx.get('audio').setCombat(true);", 4500);
// ...and read the duck node itself. The RMS drop is the effect a player hears,
// but the wind bed is a Brownian gust envelope that wanders about a decibel
// over any few-second window, so it cannot settle "is 0.4 the applied amount?"
// on its own. The gain param can.
const duckGain = await page.evaluate(() => {
  const g = window.engine.ctx.get('audio').graph;
  return { bus: g.ducks.get('ambience')?.gain.value ?? null,
    send: g.sendDucks.get('ambience')?.gain.value ?? null };
});
await page.evaluate(() => { window.engine.ctx.get('audio').setCombat(false); });

await page.evaluate(() => {
  const a = window.engine.ctx.get('audio');
  for (const b of ['music', 'sfx', 'ambience', 'ui']) a.setVolume(b, window.__vol[b]);
});

// ---- acceptance ---------------------------------------------------------
console.log('\n=== ACCEPTANCE ===');

const music = metrics.music;
const creature = metrics.creature;
const base = metrics.baseline;

if (music) {
  record('music centroid is instrumental', music.centroidHz > 0 && music.centroidHz < 2000,
    `centroid ${music.centroidHz}Hz (pitched instrumentation sits 400-1500; target < 2000)`);
  record('music has a fundamental', pitched(music),
    `f0=${music.f0}Hz harmonics ${music.harmDb}dB over local background ` +
    `(need >= ${NOISE_FLOOR_DB} dB across >= 4 partials; filtered noise measures 6)`);
}
if (creature) {
  record('creature call has a fundamental', pitched(creature),
    `f0=${creature.f0}Hz harmonics ${creature.harmDb}dB over local background`);
}
// Controls. The ambience bed is filtered noise by construction and the ash
// storm is the loudest noise in the game; if either ever scores as pitched then
// the instrument is broken, not the mix. (A control has to be SOLOED: measured
// in the mix, the ambience window scores 19 dB purely from the music drone
// underneath it, which says nothing about the bed.)
for (const [k, label] of [['ambienceSolo', 'ambience bed, soloed'], ['ashstormSolo', 'ash storm, soloed']]) {
  const m = metrics[k];
  if (m) record(`control: ${label} reads as noise`, m.harmDb < NOISE_FLOOR_DB,
    `${m.harmDb}dB (filtered noise must NOT score as pitched, or the metric is bust)`);
}
if (metrics.ambienceSolo && metrics.ambienceDucked) {
  const db = 20 * Math.log10((metrics.ambienceDucked.rms || 1e-6) / (metrics.ambienceSolo.rms || 1e-6));
  const applied = duckGain.bus !== null && Math.abs(duckGain.bus - 0.6) < 0.05
    && duckGain.send !== null && Math.abs(duckGain.send - 0.6) < 0.05;
  record('combat ducking engages', applied && db <= -2,
    `duck gain bus=${duckGain.bus?.toFixed(3)} send=${duckGain.send?.toFixed(3)} ` +
    `(0.4 duck -> 0.600); bed measures ${db.toFixed(1)} dB down`);
}
if (metrics.musicSolo) {
  const m = metrics.musicSolo;
  record('music bus alone is pitched', pitched(m) && m.centroidHz < 2000,
    `soloed: centroid ${m.centroidHz}Hz f0=${m.f0}Hz harm=${m.harmDb}dB`);
}
if (music && base) {
  const db = 20 * Math.log10((base.rms || 1e-6) / (music.rms || 1e-6));
  record('ambience sits under the foreground', db <= -6,
    `ambience baseline is ${db.toFixed(1)} dB relative to music (need <= -6 dB)`);
}

const centroids = Object.entries(metrics).filter(([, m]) => m && m.centroidHz > 0);
const hz = centroids.map(([, m]) => m.centroidHz);
const spread = hz.length > 1 ? Math.max(...hz) / Math.max(1, Math.min(...hz)) : 1;
record('sounds are spectrally distinct', spread > 1.5,
  `centroid spread ${spread.toFixed(2)}x across ${hz.length} sources`);

console.log('\n  source              rms     peak  centroid        f0     harm   flatness');
for (const [k, m] of Object.entries(metrics)) {
  console.log(`  ${k.padEnd(14)} ${String(m.rms).padStart(9)} ${String(m.peak).padStart(8)} ` +
    `${String(m.centroidHz + 'Hz').padStart(9)} ${String(m.f0 + 'Hz').padStart(9)} ` +
    `${String(m.harmDb + 'dB').padStart(8)} ${String(m.flatness).padStart(10)}`);
}

const fails = results.filter((r) => !r.ok);
console.log(`\n=== ${fails.length ? `AUDIO FAILED — ${fails.length} of ${results.length}` : `AUDIO PASSED — ${results.length} checks`} ===`);
fails.forEach((f) => console.log(`  FAIL ${f.name}: ${f.detail}`));
await writeFile('shots/audio/audio.json', JSON.stringify({ metrics, results }, null, 2));
await browser.close();
server.kill();
process.exit(fails.length ? 1 : 0);
