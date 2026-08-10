# Ashlands

An action-RPG set on a volcanic island, in the spirit of *The Elder Scrolls III: Morrowind* — first/third-person exploration, skills that improve by use, spellmaking, topic-based dialogue, and a hand-authored quest graph.

It runs in the browser on Three.js (r185) and WebGL2. **Everything is procedural**: there are no binary assets in this repository — no textures, no meshes, no audio files. Terrain, materials, sky, flora, architecture, creatures, music and sound are all generated at load time from code. Nothing is fetched over the network at runtime.

---

## Requirements

- **Node 20+** (developed on Node 26)
- **Chrome or Chromium**, only for the verification tools — the game itself runs in any WebGL2 browser
- A GPU that can hold a 1920×1080 deferred pass. Developed on an M3 MacBook Air, which is the low-water mark rather than the target

```bash
npm install
```

---

## Play it

```bash
npm run play
```

Builds for production and serves at <http://127.0.0.1:5200>, opening a browser. Use this rather than the dev server when you actually want to *play* — the dev server hot-reloads on file writes, which destroys a session mid-frame.

If you want it to stay up across crashes:

```bash
npm run serve      # supervisor loop, restarts the preview server if it dies
```

### Controls

| | |
|---|---|
| `W` `A` `S` `D` | Move (the default gait is a **run**) |
| `Shift` | Hold to **walk** — the slow modifier, not sprint |
| `Ctrl` | Sneak |
| `Space` | Jump / swim up / ascend while levitating |
| `Mouse 1` / `Mouse 2` | Attack / block (only when armed) |
| `E` | Interact, talk, pick up |
| `V` | Toggle first / third person |
| `T` | Toggle levitation |
| `G` | Toggle water walking |
| `I` `C` `M` `J` `N` | Inventory · Character · Magic · Journal · Map |
| `F1` | Free camera (detaches from the player) |
| `F5` / `F9` | Quicksave / quickload |
| `Esc` | Menu |

Health regenerates by **resting**, not over time — the same rule Morrowind used. Fatigue also recovers by resting, and low fatigue degrades everything you attempt.

---

## Develop it

```bash
npm run dev        # Vite dev server with HMR
npm run check      # tsc --noEmit — must be clean before anything merges
npm run build      # production build
```

`npm test` is **not** configured. Correctness here is enforced by the gate below, not by unit tests.

### Architecture: the system registry

Subsystems never import each other. They register against a shared context and communicate through three things only:

- `src/core/types.ts` — the `Ctx`, the `System` interface, the frame clock
- `src/core/contracts.ts` — the named interface each subsystem must implement (`ITerrain`, `IAtmosphere`, `IPlayer`, `IPipeline`, `IMaterials`, …)
- `ctx.bus` — a typed `EventBus` (`Events` in `contracts.ts`)

Everything resolves by id: `ctx.get('terrain')`, `ctx.get('sky')`, `ctx.get('player')`. This is what allowed the subsystems to be written independently and in parallel, and it is the one architectural rule that must not be bent. **If you find yourself importing another subsystem directly, add to the contract instead.**

```
src/
  core/       Engine, registry, contracts, input, event bus, world clock
  world/      CDLOD terrain, hydraulic erosion, triplanar splat material
  sky/        Rayleigh/Mie atmosphere, weather, clouds, aerial perspective
  render/     Deferred pipeline, CSM, GTAO, TAA, AgX tonemap, grade LUT
  mat/        Procedural material library
  water/      Ocean surface, underwater extinction, caustics
  flora/      Vegetation instancing and impostors
  arch/       Telvanni towers, settlements, interiors
  actors/     Creature and NPC bodies, animation
  combat/     Melee, ranged, blocking, damage resolution
  rpg/        Attributes, 27 skills-by-use, levelling, birthsigns, spellmaking
  quest/      Quest graph, topic dialogue, factions, crime, journal
  audio/      Procedural music and SFX synthesis, reverb
  player/     Controller, camera rig, viewmodel arms
  ui/         Panels, HUD, menus
  vfx/        Particles, volumetrics
```

---

## The verification harness

This is the unusual part of the project, and the part worth understanding before you change anything visual.

```bash
npm run gate                    # the regression gate — 32 checks
npm run shot                    # capture all canonical shots to shots/
npm run shot -- ridge vale      # capture named shots only
node tools/bench.mjs            # frame timing, median + p95, idle-gated
node tools/e2e.mjs              # 16 gameplay checks
node tools/quests.mjs           # drive every quest to completion
node tools/audio.mjs            # spectral checks on the synthesised audio
node tools/leak.mjs             # long-run growth probe
bash tools/cleanup.sh           # reap orphaned headless Chrome / Vite
```

**Nothing merges without `npm run gate`.** It drives a real browser, captures the canonical vantages, and measures fog walls, chunk seams, moiré, blank frames, palette conformance, AO and shadow A/B, plus typecheck and e2e — then diffs every metric against `tools/gate-baseline.json`.

Re-baseline with `node tools/gate.mjs --baseline`, and treat that as a deliberate act: it freezes whatever is on screen as "correct".

### Two rules that exist for a reason

1. **One global-appearance change at a time.** Lighting, exposure and grade are single-owner. Two simultaneous changes make every measurement uninterpretable.
2. **Verification is serialised — at most one process may drive a browser.** Concurrent captures on a thermally-limited laptop corrupt both the frame rate *and* the resulting image.

See `PIPELINE.md` for the full stage ordering (geometry → lighting → materials → atmosphere → colour → art direction → polish) and `ART_BIBLE.md` for the palette, the 2002 baseline, and the 8-axis rubric.

### Framing is searched, not hardcoded

`tools/framing.mjs` locates each shot's camera by searching the live heightfield against a declared intent ("shoreline with open water in front of us", "high shoulder with the summit in view"). Hardcoded coordinates rot the moment the terrain generator changes.

This has bitten hard enough to be worth stating plainly: **when a shot looks wrong, check the vantage before you touch the renderer.** Two defects that consumed several rounds of shader investigation each — a flat terracotta wash on `ridge`, a featureless green card on `underwater` — were both the camera being in the wrong place, and no lighting, material or atmosphere change could have fixed either.

### Tools directory

`tools/` contains about eighty files. The durable ones are the unprefixed ones listed above. Everything matching `_*.mjs` or `diag*.mjs` is a one-off diagnostic kept because it documents how a specific question was answered — treat those as an archive, not an API.

---

## Landmines

Hard-won, all of them cost a day or more:

- **`GLOW_LIGHTS` in `src/flora/Flora.ts` must stay constant at runtime.** Three's `projectObject` skips lights whose `visible` is `false`, which changes `numPointLights`, which is part of every material's program cache key. Toggling it produced 357 duplicate shader programs and made walking stutter. "Off" is `intensity = 0`.
- **Shadow map type must be `PCFShadowMap`, not `PCFSoftShadowMap`.** r185 dropped the latter from `shadowMapTypeDefines`, so programs compile with a plain `sampler2D` against a compare-mode depth texture. GLES3 rejects the pairing and silently discards the whole draw — which deleted most of the visible world.
- **Aerial perspective is doing more work than you think.** The haze is a low-saturation layer over a high-saturation surface; removing it *increases* frame saturation. Measure before assuming it is the problem.
- **Capture-to-capture noise is ±0.03 relative saturation on `coast` and `vale`**, versus ±0.006 on `ridge` and `redmtn`, because the framing search re-runs per capture. Any effect smaller than that on those two shots is unmeasurable with the current harness.

---

## Current state

Gate is at **1 of 32 failing**, typecheck clean, e2e 16/16. There are 18 quests; `node tools/quests.mjs` drives each one to its final stage and last reported none stuck — re-run it after touching the quest graph, since that result is not part of the gate.

Known open:

- **`coast` fails the palette check** (97% in one hue pair, 2 hue families). This is a genuine art-direction question, not a bug: that vantage holds almost no water despite an intent naming shoreline, foam, wet sand and glint — but framing it *with* water measured strictly worse, because the sea mirrors the sky and removes the only second hue source. Either the vantage or the intent needs to change.
- Stair-stepping where the water surface meets terrain, visible in `underwater`.
- Cell-scale mottling on terrain at distance — a per-cell mip step in the de-tiling lattice.
- `dawn`'s description promises godrays the frame does not show.
- Frame rate is 20–35 fps at capture resolution on an M3 MacBook Air.

---

## License

None yet — all rights reserved pending a decision. *The Elder Scrolls* and *Morrowind* are trademarks of ZeniMax Media; this project is an independent homage and contains no assets from those games.
