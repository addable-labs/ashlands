# Evaluation Report

An assessment of Ashlands as an experiment in agentic software development, written at the end of the build session. It is deliberately weighted toward what went wrong, because that is where the transferable information is.

The brief and the method it follows are in [README.md](README.md#this-is-an-experiment).

---

## 1. What exists

| | |
|---|---|
| TypeScript | ~94,000 lines across 160 files |
| Subsystems | 16, each behind a named contract |
| Tooling | 114 files (34 durable, 79 one-off diagnostics, 1 baseline) |
| Largest single file | `src/world/TerrainMaterial.ts`, 4,317 lines — mostly GLSL and its rationale |
| Quests | 18, with topic dialogue, factions, crime and a journal |
| Binary assets | **Zero.** Terrain, materials, sky, flora, architecture, creatures, music and SFX are all generated from code |
| Verification | 32 gate checks, 17 e2e checks, plus bench / leak / audio / quest harnesses |

Runtime state at close: gate **1 of 32 failing**, typecheck clean, e2e 16/16, 20–35 fps at capture resolution on an M3 MacBook Air.

That the thing runs at all — a physically-based atmosphere, CDLOD terrain with hydraulic erosion, cascaded shadows, GTAO, TAA, AgX tonemapping, an Elder Scrolls-shaped RPG layer and a completable quest graph, with no artist and no assets — is the headline result. The rest of this document is about the parts that did not work, and why they are the more useful half.

---

## 2. What the method got right

**Contract-first decomposition made parallel authoring possible.** Fixing `src/core/types.ts` and `contracts.ts` up front, with each subsystem registering under an id and communicating only through the event bus, meant sub-agents could write terrain, sky, combat and audio simultaneously without reading each other's code. Almost no integration conflicts arose from this. It is the single decision most responsible for the codebase existing.

**Separating builders from critics caught real defects.** Agents grading their own output consistently declared success; independent critics with capture access did not. This is the Gauntlet Loop's central claim and it held.

**Negative results were the highest-value agent output.** Four of six sub-agent rounds in the final phase ended with the agent implementing a change, measuring it, finding it worse, and reverting — while keeping the measurement. Those rounds cost real time and produced no visible improvement, and they were the most useful work done. Each one permanently closed a line of investigation:

- Terrain albedo owns **0.006** of ridge's 0.437 saturation → stage 3 closed
- Tagging all three shadow cascades moves the cliff `134,91,66 → 131,92,66` → stage 2 closed
- Correcting a genuine inverted-falloff bug in aerial perspective made every judged metric *worse*, because the haze is a low-saturation layer opposing the wash rather than causing it → stage 4 closed, and a counterintuitive fact recorded

An agent that reports "I could not fix this, here is what I ruled out" is worth more than one that ships a plausible patch.

---

## 3. What went wrong

### 3.1 The acceptance criterion was never met

The brief's terminal condition is a **blind side-by-side against real Morrowind**. No reference screenshots were ever obtained. Every "beats Morrowind" score in this project was an agent comparing a frame against its own recollection.

This is a deviation from the method, whose third principle is to give the critic a concrete reference to inspect. The likely consequence — inferred, not measured — is that critics with no external anchor drift toward grading whether a frame looks *good* rather than whether it looks *like the target*, which would explain why shots converged on handsome, generic, warm vistas while the palette check stayed red.

**Anyone rerunning this should assemble the reference set before the first critic round.**

### 3.2 The lead agent misattributed defects repeatedly

The most expensive failure mode was not bad code. It was **confident wrong diagnosis by the orchestrator**, which then sent sub-agents to the wrong subsystem.

The clearest case: `ridge` rendered as a flat terracotta wash. Three sub-agent rounds were dispatched at three different stages — terrain material, lighting, atmosphere. All three measured correctly, found nothing, and reverted. The actual cause was in `tools/framing.mjs`: the vantage search scored candidates on height and flatness with **no distance term**, so it climbed to the nearest high shoulder and aimed point-blank at the peak. The depth buffer spanned 15–677 m with 95% of the frame inside a 380 m slab of one crater wall.

No lighting, material or atmosphere change could have fixed a frame with no depth in it. Correcting the vantage moved `meanSat` from 0.407 to 0.272 against an art-bible band of 0.174–0.203, took hue families from 2 to 3, and flipped the palette check to pass — one line of scoring, after three rounds of shader investigation.

The same bug class then appeared in `underwater`: the camera was placed at the *deepest* point within 400 m and aimed level at a shore hundreds of metres away, so extinction was total and the shot rendered as a featureless green card, against a declared intent of "underwater extinction + caustics".

**Rule extracted, now in the README: when a shot looks wrong, check the vantage before the renderer.**

### 3.3 The measuring instruments manufactured false signal

Six defects were found in the verification harness itself — all authored by the lead agent, all silently corrupting the evidence used to make decisions:

| Defect | Effect |
|---|---|
| Cloud phase driven by wall-clock elapsed time | Identical builds produced different frames; one check read 2.2 / 0.0 / 4.3% across three captures |
| Sun re-angling ignored elevation despite a comment claiming otherwise | Swapped mid-morning for a 4.8° sunrise, putting the sun behind the subject |
| `moireN` matched an unanchored `/moire/` and was scored lower-better | Reported a regression against an **unmodified control shader** |
| `seamIsolation` noise exceeded its own effect size | Flip-flopped 2.55 → 3.56 across unchanged builds |
| `meanSat` scored higher-better | Reported movement *toward* the art bible as a regression |
| Chunk-seam strength floor set below the threshold of visibility | Fired at ~2.4 luminance levels of 255, under 1% modulation |

A seventh was found by a sub-agent: a diagnostic tool zeroed a uniform written once at construction, so **only the first shot in any multi-shot run was valid** — silently invalidating an unknown number of prior measurements.

The lesson is uncomfortable and general: **an agentic loop is only as good as its instruments, and the loop has no way to notice when an instrument is lying.** Every one of these was found by accident while chasing something else. A check that flips on an unchanged build is worse than no check, because it trains everyone to ignore the gate.

### 3.4 Specific incorrect claims by the lead agent

Recorded because the pattern matters more than any individual error:

- Called a rising saturation figure an improvement, when the target was a band it was moving away from
- Asserted a hard horizon "fog wall" on `ridge`; measurement showed every large step was a terrain silhouette
- Told a sub-agent the ambient was "as warm as the key"; it is 42–101° of hue separated, and the figure being quoted had measured the airlight
- Briefed a sub-agent that two black silhouettes were flora; they were architecture, and the agent proved it by hiding the entire flora group and getting a byte-identical frame
- Presented a flaky seam reading as a newly-surfaced defect
- Asserted that coast's palette failure was a framing bug; testing it made every metric worse and the change was reverted

In several of these the sub-agent's measurement corrected the orchestrator. That is the loop working — but it only works if agents are briefed to overturn the premise, and if the orchestrator's hypotheses are labelled as hypotheses rather than findings.

---

## 4. Cost and return of the harness

Roughly a third of the total effort went into tooling that renders no pixels: the vantage search, the capture harness, the 32-check gate, the ablation probes, the bench and leak and quest drivers.

It was worth it, but not for the reason expected. The gate caught few genuine regressions. Its real value was **making disagreements decidable**. When an agent claimed a fix and a critic disagreed, a paired ablation settled it in one run instead of several rounds of assertion. The projects where agents thrashed longest — the first-person hand, ~11 rounds — were precisely those with no instrument, where the only signal was a human saying "still wrong".

The corollary: **build the instrument before the loop, not during it.** And measure the instrument's own noise floor. Capture-to-capture spread here is ±0.03 relative saturation on two shots versus ±0.006 on others, which means an unknown number of earlier "improvements" were inside the noise.

---

## 5. Sub-agent economics

The brief says "fan out sub-agents". It is worth being concrete about what that cost and what it bought, because the accounting is not flattering and is the least-documented part of this style of work.

### 5.1 Measured cost of the final phase

Six sub-agents were dispatched in the closing phase. Five completed:

| Agent | Tokens | Tool calls | Wall clock | Outcome |
|---|---|---|---|---|
| Black silhouettes | 241k | 120 | 28 min | Diagnosis; correctly refused to fix (wrong owner) |
| Terrain chevron | 332k | 171 | 69 min | Attribution + two attempts, both reverted |
| Per-projection lattice | 176k | 106 | 37 min | **Shipped the fix** |
| Lighting / ambient | 332k | 151 | 58 min | Negative + reattribution to another stage |
| Aerial perspective | 234k | 106 | 34 min | Negative + found a real inverted-falloff bug + a tool bug |
| Waterline aliasing | — | — | — | **Died immediately: weekly token limit** |
| **Total** | **~1.32M** | **654** | **~3.8 h** | 1 shipped fix, 4 closed investigations |

**~1.32 million tokens produced one shipped visual fix.** The other four rounds closed lines of investigation permanently, which is real value — but anyone budgeting this work should expect roughly 250–330k tokens per agent-round and plan for most rounds to end in a negative.

The session then hit a **weekly account limit**, killing the sixth agent before it read a single file. That is the practical ceiling on this method: it is not bounded by ideas or by model capability, it is bounded by quota, and quota exhaustion arrives without warning mid-investigation.

### 5.2 Fan-out bought almost no wall-clock here

The headline drawback: **in this phase the agents ran effectively serially, so fan-out provided no speedup at all.**

`PIPELINE.md` rule 2 exists because concurrent verification actively corrupts results — every visual agent needs a browser, a GPU and a stable frame rate, and on one thermally-limited laptop those are a single shared resource. When several agents captured simultaneously, both the measured frame rate *and* the rendered image degraded. The earlier waves demonstrated this destructively: load average 37 on 8 cores, 4.7 GB of screenshots, orphaned headless Chrome and Vite processes reparented to launchd, and the play server dying five times. `tools/cleanup.sh` exists solely to reap that wreckage.

So the useful distinction is not "parallel vs serial" but **what the bottleneck actually is**:

- **Verification-bound work does not parallelise.** One instrument, one agent. Everything visual in this project was verification-bound.
- **Read-only analysis parallelises safely.** Reading code, measuring captured PNGs and reasoning about shaders need no browser and could have been fanned out freely.
- **Authoring parallelises if the contract is fixed.** This is what worked in the early waves: 16 subsystems written concurrently against `contracts.ts` with almost no integration conflict.

The early build phase was authoring-bound and fan-out was the right call. The closing phase was verification-bound and fan-out was mostly theatre — the wins came from *sequencing* agents well, not from running them at once.

### 5.3 Did agents step on each other?

Not through the code. The contract-first design worked: no two agents collided in a source file, and merge conflicts were essentially absent across 15 commits.

They collided through **shared physical and epistemic resources**:

- **The GPU and the browser.** Concurrent captures degraded both frame rate and image quality — the user observed this before the tooling did, and it became rule 2.
- **Global appearance state.** Two agents changing lighting and grade simultaneously makes both sets of measurements uninterpretable, since neither can attribute an effect to its own change. Hence rule 3: one global-appearance change at a time, single owner. This is a genuine limit on parallelism that has nothing to do with source-file conflicts.
- **The baseline.** A shared `gate-baseline.json` means one agent re-baselining silently redefines "correct" for everyone else.
- **Inherited premises.** The subtlest collision. Sub-agents defer to the orchestrator's brief, so a wrong premise propagates to every agent downstream — three rounds were spent on `ridge` at three wrong stages because the orchestrator's framing hypothesis was handed down as established fact.

### 5.4 Running this more token-efficiently

Every one of these is a lesson from something that cost tokens here:

1. **Do the cheap orchestrator-side check first.** The "horizon fog wall" I had queued for an agent was disproved by two Python probes over a PNG — a few thousand tokens instead of ~300k. Likewise the coast framing hypothesis. **If a claim can be tested by measuring an existing capture, never spend an agent on it.**
2. **Pack prior findings into the brief.** The lattice agent shipped its fix in 176k — the cheapest successful round — because its brief contained the previous agent's full attribution, both reverted attempts, and the instrumentation to reuse. The diagnosis agent that produced those findings cost 332k. **Front-loading known negatives roughly halved the cost of the round that succeeded.**
3. **Split diagnosis from repair.** Diagnosis is exploratory and expensive; repair against a known cause is cheap. Merging them means paying exploration prices for implementation work, and risks an agent patching before it understands.
4. **Explicitly license negative results.** Agents told "a clean negative is a complete answer" reverted bad changes instead of defending them. Agents not told that will ship a plausible patch to avoid returning empty-handed — which costs a later round to undo.
5. **Label hypotheses as hypotheses.** `T_FLOOR` was handed to an agent as a named suspect and was wrong; because the brief said "verify, don't assume", the agent overturned it and found the real bug next door. Had it been asserted as fact, that round would have produced a confident wrong fix.
6. **Parallelise the read-only, serialise the instrument.** Fan out code reading, image measurement and hypothesis generation; queue anything needing a browser.
7. **Budget for the quota, not the task.** Assume ~300k per investigative round. At five rounds per weekly window, the sequencing of investigations matters more than their individual efficiency — spend the first rounds on whatever most narrows the search space.

The deepest efficiency lesson is upstream of all of this: **~1M of the 1.32M tokens went into `ridge`, and the bug was one missing term in a scoring function in the capture tool.** No amount of per-agent efficiency would have helped. What would have helped is checking the cheapest, dumbest hypothesis — "is the camera pointing at anything?" — before dispatching the first expensive one.

---

## 6. Honest verdict against the brief

| Brief clause | Outcome |
|---|---|
| "action RPG at the level of Morrowind" | Structurally yes — exploration, skills-by-use, spellmaking, dialogue, 18 quests. Not in content volume |
| "utterly perfect" | No. Gate 1/32 failing, visible aliasing, terrain mottling, 20–35 fps |
| "AAA quality, textures to physics" | Uneven. Atmosphere, terrain and audio are strong; the first-person viewmodel took ~11 rounds and remains the weakest surface |
| "sub-agents tackle each individually" | Yes, and this worked well |
| "harsh critic sub-agent" | Yes, and critics reliably outperformed self-assessment |
| "compare side by side blind vs real Morrowind" | **Not done.** No reference imagery ever obtained |
| "don't stop until utterly wowed" | Stopped short, with open defects documented rather than hidden |

The gap between "utterly perfect" and the Current state list in the README is the actual finding. A single prompt produced a large, coherent, running game with a real verification culture — and could not close the last 10% without a human deciding what "correct" meant. The two items still blocked at the end are both judgement calls, not engineering: which reference images to compare against, and whether `coast` keeps a vantage that fails its own stated intent.

---

## 7. If you rerun this

1. **Assemble the reference set first.** The critic loop's terminal condition is meaningless without it.
2. **Build and calibrate the instruments before the build loop.** Inject a synthetic defect of known magnitude and confirm each check fires; measure each metric's run-to-run noise and record it next to the threshold.
3. **Make every capture deterministic.** Pin the clock, the weather, the animation phase and the vantage. A non-reproducible capture poisons every comparison downstream.
4. **Label orchestrator hypotheses as hypotheses.** Sub-agents defer to a confident brief. Every named suspect in this project that was handed down as fact and turned out wrong cost a full round.
5. **Reward negative results explicitly.** Brief agents that "I could not fix this, here is what I ruled out" is a complete answer. Otherwise they ship plausible patches.
6. **Check the camera before the shader.** Two multi-round investigations here were framing bugs.
7. **Serialise verification.** Concurrent browser captures on a thermally limited machine corrupt both the frame rate and the image.

---

*Written by the orchestrating agent, so treat section 3 as self-assessment with the bias that implies. The commit history is the primary source; every claim above is traceable to a commit message or a recorded measurement.*
