# Ashlands — Art Bible & Quality Bar

Shared reference for every authoring and review agent. Read this before writing rendering code
or judging a screenshot.

## The target

**Ashlands** is a follow-up installment to *The Elder Scrolls III: Morrowind*. Same province
(Ashenreach), same alien sensibility, rendered with a modern physically-based pipeline. The
comparison target is vanilla Morrowind as it ships today on Steam — and the bar is that a
viewer shown both without labels picks ours, on every shot, without hesitation.

## What Morrowind (2002) actually looks like — the baseline we must beat

Know the baseline concretely, or "better" is meaningless:

- 256×256 diffuse textures, no normal maps, no specular workflow, no PBR. Surfaces are flat
  and matte; wet and dry, metal and cloth all shade identically.
- Per-vertex lighting on a sparse mesh. No shadows at all in vanilla (a single blob under the
  player at best). Nothing has ground contact.
- Hard view-distance fog as a draw-distance hack — a grey wall at ~2–3 cells, not atmospheric
  perspective. Objects pop in at the fog line.
- Sky is a flat gradient dome with billboard clouds. No scattering, no aerial perspective.
- Water is a scrolling normal-ish texture with a fixed reflection cube. No depth absorption,
  no refraction, no shoreline interaction.
- Terrain is a low-res heightmap with a hand-painted 3-texture blend; visible tiling
  everywhere; no erosion, no slope-aware materials.
- Foliage is crossed-quad billboards with alpha-tested edges, no wind, no LOD transition.
- ~2000 triangle characters, 30-ish bone rigs, no IK, no blending — animations snap.

**Where Morrowind still wins, and we must not lose:** art *direction*. The silhouettes are
unforgettable — telvanni mushroom towers, silt striders, the ash-choked red sky over Red
Mountain. Alien, coherent, committed. Technical fidelity without that reads as a tech demo.
A photoreal generic hillside is a **failure**, not a win.

## Palette

| Role | Colour | Use |
|---|---|---|
| Ash | `#8a7f72` → `#4a423b` | ground plane, dominant mid-value |
| Basalt | `#2a2622` → `#141312` | cliffs, columnar rock, deep shadow |
| Ember | `#c4551f` / `#ff7a2a` | lava fissures, Ember Mount glow, emissives |
| Sulphur sky | `#c99a5c` → `#7d5a3e` | haze, horizon band, ash storms |
| Bioluminescence | `#3fd6c0` / `#8f6bff` | fungus, glow-moss, magic — the only saturated colours |
| Chitin / bone | `#d8c9a4` → `#8f7d5a` | architecture, armour |
| Verdigris | `#5f7a63` | oxidised bronze, sparse vegetation |

Saturation discipline: the world is desaturated ochres and greys. Bioluminescence and lava are
the *only* things allowed to be vivid. That contrast is the whole look.

## Non-negotiable technical bar

Every one of these must be visibly true in a screenshot:

1. **Ground contact.** Every object darkens where it meets the ground (AO + contact shadows).
   Objects that appear to hover are the #1 amateur tell.
2. **Real shadows.** Cascaded, filtered, no acne, no peter-panning, correct at grazing sun.
3. **Aerial perspective.** Distant geometry desaturates and shifts toward the sky colour —
   physically, not as a grey fog wall.
4. **No visible tiling.** Any repeating texture pattern readable at a glance is a defect.
5. **Material differentiation.** Wet vs dry, rough vs polished, metal vs dielectric must be
   unmistakable from shading alone.
6. **Silhouette hierarchy.** Foreground detail, midground mass, background silhouette. A flat
   composition with everything at one depth is a defect.
7. **Micro-detail at the near plane.** Ground within 5m must hold up: parallax, grain, debris.
8. **Highlight and shadow rolloff.** No clipped white sky, no crushed pure-black shadow.
9. **Consistent lighting.** Every system reads the same sun colour/direction and the same
   fog parameters. Mismatched fog between terrain and water is an instant fail.
10. **Performance target — read this before optimising.** Development is on a **MacBook Air
    M3**, which is fanless and thermally throttles under sustained GPU load. A flat "60fps at
    1080p with everything on" is not achievable on this machine and chasing it has already
    wasted rounds. The target is instead:
    - **`medium` must hold ~60fps at 1080p** and is the default tier. This is the one that
      matters — it is what the game ships at and what gets played.
    - **`high`** may sit in the 40s. **`ultra` is a photo/screenshot tier** and is allowed to be
      well below 60.
    - Frame time must be *steady*: p95 within ~20% of the median. Consistent 45fps feels better
      than 60fps that hitches, and hitching is what makes a build feel broken.
    - Benchmark with `tools/bench.mjs` — it waits for an idle machine and uses a static build,
      because hot-reload and concurrent agents have corrupted almost every ad-hoc fps number
      this project has produced. A figure taken any other way is not evidence.

## Review rubric (critic agents score each 1–10)

`composition` · `lighting` · `materials` · `atmosphere` · `detail-density` · `colour-grade` ·
`art-direction-fidelity` (does it read as *Morrowind*, not generic fantasy) · `technical-artifacts`
(banding, aliasing, ghosting, z-fight, popping, seams)

**Passing is: every axis ≥ 8, no axis below 7, and zero technical artifacts.** A critic that
gives a passing verdict to an image with a visible seam, a tiling repeat, or a hovering object
has failed at its job. Be harsh. Cite pixel locations. Vague praise is worthless.
