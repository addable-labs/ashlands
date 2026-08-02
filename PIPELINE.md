# Development Pipeline

How work on this project is sequenced. It exists because the previous approach — fan out ~9
agents on disjoint directories, let a critic panel find defects, let each agent fix its own —
**regressed for ten consecutive rounds**. Score went from 2/8 shots beating Morrowind down to
0/8, while previously-fixed defects (fog wall, chunk seam, halftone) silently returned.

That was not an agent failure. It was a process with no acceptance test.

---

## The three rules

### 1. Nothing merges without passing the gate

`node tools/gate.mjs` is the acceptance test. It runs 28 automated checks over five canonical
vantage points and exits non-zero on any regression:

| check | catches |
|---|---|
| fog wall | a horizontal edge uniform across frame width (draw-distance hack) |
| chunk seam | a 1–3px line running a long span in row or column |
| moiré / screen-door | screen-locked periodic pattern via phase-fold RMS |
| blank frame | dynamic range below 1.2 stops |
| palette | >85% of chroma concentrated in two hue bins |
| AO A/B | toggling AO must change the frame by >1.2/255 |
| shadow A/B | toggling shadows must change the frame by >2.0/255 |
| typecheck / e2e / lattice | build, 16 gameplay checks, terrain autocorrelation |

Plus a **baseline comparison**: every numeric metric is compared against
`tools/gate-baseline.json`, and any that worsens by >15% is a regression regardless of whether
its absolute check still passes. Re-baseline only deliberately, with `--baseline`.

**The gate is the referee, not the critics.** Critics judge taste; the gate judges facts. When
they disagree, the gate wins — it already caught critics reporting moiré that measured 2%, and
"shadowless" frames where toggling shadows moved 10.9/255.

### 2. Verification is serialised. Agents do not each drive Chrome.

Every agent capturing its own screenshots concurrently is what produced load average 148 on an
8-core machine, and it corrupts the very thing being measured: a frame rendered while five other
Chrome instances fight for the GPU is not the frame a player sees, and fps figures taken that way
are meaningless. Several rounds were spent acting on numbers gathered this way.

- **At most ONE agent may drive a browser at a time.** Everything else works from images already
  on disk.
- Capture happens in a dedicated step, before critique and after fixes — never during.
- Anything measuring performance uses `tools/bench.mjs`, which waits for an idle machine and
  builds a static snapshot so hot-reload cannot destroy the page mid-run.
- Run `tools/cleanup.sh` between rounds to reap orphaned browsers and servers.

### 3. One global-appearance change at a time

Grade, exposure, tonemapping, aerial perspective and fog are **shared output**. When several
agents each nudge them toward their own shot's needs, the palette walks somewhere nobody chose —
that is precisely how it reached a washed-out single hue.

- Exactly one owner per round may touch global colour. Everyone else reports and changes nothing.
- A complaint of "reads as untextured / flat / clay" must be answered with **surface detail**
  (albedo variation, normal detail, roughness, cavity), never with a tint. Proof required: a 4×
  crop before and after.
- Subsystem-local work (terrain material, flora meshes, architecture geometry) may still run in
  parallel — it does not share an output surface.

---

## The loop

```
  ┌─ 0. GATE ──────────── establish the current state; refuse to start if broken
  │
  ├─ 1. CAPTURE ───────── one browser. tools/shoot.mjs --tag iterN
  │
  ├─ 2. CRITIQUE ───────── N critics, parallel, READ-ONLY (images from disk, no browser)
  │                        each returns scored findings attributed to one subsystem
  │
  ├─ 3. TRIAGE ──────────  ME, not an agent. Cross-check every finding against the gate.
  │                        Discard findings the gate contradicts. Rank by severity.
  │                        Pick ONE global-appearance item; the rest must be local.
  │
  ├─ 4. FIX ────────────── parallel, but capped at 4 agents, none driving a browser.
  │                        Each has a measurable acceptance criterion set BEFORE it starts.
  │
  ├─ 5. GATE ───────────── the only verification that counts.
  │                        REGRESSION -> revert that change. Do not iterate on it.
  │
  └─ 6. RECORD ─────────── if better, re-baseline. Log what moved and why.
```

**Step 3 is the one that was missing.** Previously every critic finding went straight to a fixer.
Now findings are triaged against measurement first, which would have prevented two entire rounds
spent chasing moiré that was not there and shadows that already worked.

**Step 5's revert rule is the other half.** Previously a regression was discovered rounds later by
a critic and then "fixed" by a different agent, compounding. A change that regresses a metric is
now backed out immediately — the cheapest possible response.

---

## The stage order — why the loop kept undoing itself

The critic loop asked "what looks worst?" every round and fixed that. But a renderer has a strict
dependency chain, and working against it means every fix gets invalidated by the next one:

- The grade applied a 0.46 warm pull to compensate for an image that was **already 99.9% warm** —
  correcting a *lighting* problem in the *colour* stage, which then had to be undone.
- Terrain surface detail was authored and judged under shadows too weak to read, so "flat" and
  "badly lit" were indistinguishable and both got attributed to materials.
- Art direction was scored on frames where the hero subject was cropped out of shot.

Each is work done on top of an unfinished layer. So stages run in dependency order, and **each
freezes when it passes**. Touching a frozen stage means re-running every gate downstream of it.

| # | stage | exit criteria (measured, not judged) | parallel? |
|---|---|---|---|
| 1 | **Geometry correctness** | no chunk seam, no z-fight, nothing floating, no LOD pop, no culling holes | yes — subsystems are independent |
| 2 | **Lighting truth** | shadow A/B > 8/255, AO A/B > 4/255, no acne/peter-panning, exposure stable < 2% on a frozen scene | **no — single owner** |
| 3 | **Material truth** | per-surface pixel σ above threshold; wet/dry, metal/dielectric distinguishable in an A/B | yes — terrain, flora, arch don't share output |
| 4 | **Atmosphere** | aerial perspective continuous (no fog wall), distance desaturates toward sky hue | **no — single owner** |
| 5 | **Colour grade** | palette hue spread, chroma magnitude vs art-bible targets, dynamic range in stops | **no — single owner** |
| 6 | **Art direction** | composition, silhouette hierarchy, palette commitment — critics score here | judged, not fanned out |
| 7 | **Detail & polish** | micro-detail density, VFX, particle budget | yes |

Two consequences worth stating plainly:

**Critics belong at stage 6, not everywhere.** Their taste judgement is only meaningful once 1–5
are objectively correct. Running them earlier produces findings that are true but misattributed —
"reads as clay" when the real fault is that the key light is 3 stops down.

**Stages 2, 4 and 5 are single-owner by construction.** They write to shared output (light, fog,
grade). Fanning them out is what walked the palette to a single hue that nobody chose. Stages 1,
3 and 7 fan out safely because their subsystems own disjoint surfaces.

## Acceptance criteria are written before work starts

Every task specifies how it will be judged, numerically, in advance. Not "make the terrain look
better" but "a 110×100px cliff patch currently has a pixel standard deviation of 1.4/255; get it
above 12 without the lattice autocorrelation exceeding 0.12 at any grid multiple."

This is what turned the vague "untextured clay" complaint into work that could be finished, and
what let the anisotropy bug be found (all three texture arrays built at 8× aniso, silently
multiplying every fetch by eight trilinear taps).

## Known-unreliable signals

Learned the hard way; do not trust these without corroboration:

- **fps from anything but `tools/bench.mjs`** — every ad-hoc figure this project produced was
  taken under contention.
- **GPU timer queries on ANGLE/Metal** — they serialise the command stream; 12 scopes summed to
  5× the frame time. Use paired ablation instead.
- **A critic's claim about something not visible in the frame** — eleven rounds went into arm
  anatomy that was cropped out of shot. Always confirm the subject is *in the picture* first.
- **`.visible = false` on LOD-managed objects** — the LOD pass re-asserts it every frame.
- **Any A/B taken across a hot-reload** — Vite reloads destroy the page mid-measurement.
