export const meta = {
  name: 'ashlands-wave2',
  description: 'Author world-content systems: flora, architecture, creatures, VFX',
  phases: [
    { title: 'Author', detail: 'four content authors, disjoint file ownership' },
    { title: 'Typecheck', detail: 'each author repairs its own type errors' },
  ],
};

const ROOT = '/Users/peter/Development/morrowind';

const COMMON = `
You are authoring ONE subsystem of "Ashlands", a Three.js (r185, WebGL2) action-RPG that must
visually surpass The Elder Scrolls III: Morrowind. TypeScript strict, Vite.

PROJECT ROOT: ${ROOT}

MANDATORY FIRST STEPS:
1. Read ${ROOT}/ART_BIBLE.md — the art direction and the quality bar you are held to.
2. Read ${ROOT}/src/core/types.ts and ${ROOT}/src/core/contracts.ts in full — the integration
   boundary. Implement the exact file path, class name and system id you are given.
3. Skim the existing systems you depend on so you use their real APIs, not invented ones:
   ${ROOT}/src/mat/Materials.ts (PBR texture sets), ${ROOT}/src/world/Terrain.ts (heightAt /
   normalAt / materialAt), ${ROOT}/src/sky/Atmosphere.ts (sun, weather, AERIAL_GLSL +
   aerialUniforms for matched fog).

DO NOT edit src/core/*, src/main.ts, or ANY directory other than the one you own. Other agents
are editing those concurrently.

HARD RULES:
- Everything procedural, generated in code. No binary assets, no network fetches.
- Physically based, linear-space, energy conserving. Every surface gets albedo+normal+rough+AO.
- Import AERIAL_GLSL / aerialUniforms from '../sky/Atmosphere' into any custom shader that
  draws world geometry, so your fog matches the sky exactly. Mismatched fog is an instant fail.
- Read the sun from ctx.get('sky').sun. Never create your own directional light.
- Cast AND receive shadows.
- Instancing + LOD + frustum culling. Target 60fps at 1080p on an Apple M3. Report your budget.
- Strict TypeScript, no \`any\`, no @ts-ignore. GLSL in template literals inside .ts files.
- Comments explain WHY. No banner comments, no narration.
- Dispose GPU resources in dispose().

VERIFY: cd ${ROOT} && npx tsc --noEmit 2>&1 | grep -E "^src/<yourdir>/" — fix every error in
YOUR directory only. Report files written, techniques used, and draw-call/triangle budget.
`;

const TASKS = [
  {
    key: 'flora',
    dir: 'src/flora',
    label: 'flora',
    prompt: `${COMMON}

YOUR SUBSYSTEM: vegetation. YOU OWN src/flora/ ONLY.
Write ${ROOT}/src/flora/Flora.ts exporting \`class FloraSystem\` implementing System
(id 'flora', order 20).

Ashenreach flora is FUNGAL and ALIEN. Nothing here may look like an oak or a pine. Species to
generate, all procedurally meshed:
- **Emperor parasol / giant mushroom trees** — bulbous swollen stalks with a wide fleshy cap,
  8–25m tall, gill structures underneath, faintly bioluminescent rim. The signature silhouette.
- **Vaelmyr-style bulb fungus** — smaller, clustered, spore-sac forms.
- **Ash yam / marshmerrow / stoneflower** — harvestable ground plants, sparse.
- **Trama root** — thorny, twisted, grey-black, thrives in ash.
- **Kelp and coral** — below sea level only, reacting to the water's wave motion.
- **Ash grass / lichen mats** — dense ground cover, the thing that sells ground scale.

Requirements:
- Generative meshes: build stalks by lofting a tapered spline with noise-perturbed control
  points; caps as radial lathes with gill geometry. Every instance must differ — seed per
  instance so no two are identical. Do NOT place N copies of one mesh.
- Placement: query ctx.get('terrain') for height/slope/materialAt and place by ecological rule
  — mushrooms in the sheltered vale and near water, trama in ash, nothing on steep basalt,
  density falling off with altitude. Use a blue-noise / Poisson-disc distribution, never
  uniform random (clumping artefacts are an instant tell). Align to terrain normal, and sink
  the base slightly so nothing hovers.
- Ground cover: GPU-instanced grass/lichen with at minimum 200k blades in the near field, with
  distance-based density falloff and a smooth fade (dither or alpha-to-coverage), not a pop.
- Wind: vertex-shader animation driven by the sky system's wind direction and speed, with
  per-instance phase offset, stiffness varying by height up the stalk, and gusts as a
  low-frequency travelling noise wave. Ground cover and canopy must move coherently, as one
  wind field. Static vegetation is a dead giveaway.
- Bioluminescence: emissive rim on fungal caps that becomes genuinely visible at night and
  reads as one of the only saturated colours in the palette. Keep it restrained by day.
- LOD: full mesh near, reduced mesh mid, and camera-facing impostor/billboard far — with a
  cross-fade between tiers, not a pop. Report the tier distances you chose.
- Subsurface scattering approximation on the fleshy caps: they should glow warm when
  backlit by a low sun. This single effect does more for "AAA foliage" than anything else.
- Alpha-tested foliage must use alpha-to-coverage or a hashed alpha to avoid the crunchy
  aliased edges that made Morrowind's billboards look cheap.`,
  },
  {
    key: 'arch',
    dir: 'src/arch',
    label: 'architecture',
    prompt: `${COMMON}

YOUR SUBSYSTEM: architecture and settlements. YOU OWN src/arch/ ONLY.
Write ${ROOT}/src/arch/Architecture.ts exporting \`class ArchitectureSystem\` implementing System
(id 'arch', order 20).

Build a small coastal settlement plus scattered ruins. Cindren architecture is the most
recognisable thing in Morrowind — get the silhouettes right and the whole project reads as
Elder Scrolls.

Styles to generate procedurally:
- **Velothi / ashlander domes** — organic curved shells, chimney vents, rounded doorways, built
  from mud-brick and plaster over a chitin frame. Weathered, streaked, ash-drifted.
- **Korran chitin shells** — buildings shaped from giant crab and beetle carapaces, ribbed and
  segmented, iridescent lamellae, bone buttresses.
- **Velothi towers / Daedric ruins** — tall angular basalt monoliths with sharp asymmetric
  buttresses and carved geometric relief, half-collapsed and partly buried in ash.
- **Docks and walkways** — weathered timber piling out over the water, rope, hanging lanterns.
- Props that sell habitation: clay urns, drying racks, nets, crates, braziers with real
  flickering light, banners moving in the wind, hanging lamps that swing.

Requirements:
- Procedural, parameterised generators — a function per style taking a seed and dimensions and
  returning a THREE.Group. Buildings must vary: no two identical, and the variation must be
  structural (footprint, height, number of vents, degree of collapse), not just scale.
- CSG-ish detailing: cut real window and door openings, add recessed panels, sills, thresholds.
  A building that is a smooth blob with a texture on it is a fail.
- Placement: query the terrain for a buildable site (low slope, above sea level), flatten a
  small foundation pad, and settle each structure into the ground with an ash drift skirt at
  the base so nothing hovers or floats. Lay out the settlement with an actual path network,
  not a scatter.
- Materials: get plaster, cut_stone, chitin, thatch, wood_weathered, bone, bronze from
  ctx.get('materials'). Use triplanar or proper UVs — no stretched texels on curved shells.
- Weathering: vertical rain-streaks below ledges, ash accumulation on upward faces (drive it
  from the world-space normal's Y in the shader), edge wear that lightens exposed corners
  (curvature-driven). This is what makes surfaces look real rather than clean CAD.
- Interiors: at minimum, doorways with real depth and interior darkness so buildings do not
  read as solid props. A single enterable interior is a bonus.
- Emissive: lit windows and braziers at night, with real THREE.PointLight where budget allows
  (cap the count and cull by distance — report your cap).
- Shadows: buildings are the main shadow casters in the scene. They must ground convincingly.`,
  },
  {
    key: 'actors',
    dir: 'src/actors',
    label: 'creatures+NPCs',
    prompt: `${COMMON}

YOUR SUBSYSTEM: creatures, NPCs, rigs and animation. YOU OWN src/actors/ ONLY.
Write ${ROOT}/src/actors/Actors.ts exporting \`class ActorSystem\` implementing System
(id 'actors', order 100).

Also export from src/actors/ a stable API the combat and RPG layers will consume later:
  export interface Actor { id: number; kind: string; position: THREE.Vector3; yaw: number;
    health: number; maxHealth: number; faction: string; alive: boolean;
    root: THREE.Object3D; }
  class ActorSystem { spawn(kind: string, x: number, z: number): Actor;
    all(): readonly Actor[]; nearest(p: THREE.Vector3, maxDist: number): Actor | null;
    damage(a: Actor, amount: number, dir: THREE.Vector3): void; }

Creatures — the bestiary is what makes Morrowind Morrowind. Generate procedurally:
- **Cliff racer** — the infamous flying pest. Long barbed tail, membranous wings, darting flight.
- **Skerrin** — enormous serene floating gasbag with trailing tentacles. Drifts, never touches
  ground. Translucent, backlit membrane. Visually the most striking creature in the game.
- **Morvek forager** — low insectoid scuttler, chitinous, many-legged.
- **Nix-hound** — leaping arthropod predator, hard shell, no eyes.
- **Drell** — bipedal pack lizard, docile, used as livestock.
- **Silt strider** (a set piece, one instance is enough) — a colossal flea-like creature the
  size of a building with impossibly long jointed legs and a hollowed shell. If you build one
  thing exceptionally well, make it this.
- **Cindren NPCs** — humanoid, ashen grey skin, red eyes, robed or armoured, walking the paths.

Requirements:
- Procedural skinned meshes: build a skeleton (THREE.Bone hierarchy), generate the mesh
  around it, and compute skin weights from bone-distance falloff. Real THREE.SkinnedMesh —
  not rigid segments parented together; segmented robots are an instant fail.
- Procedural animation, not baked clips: sinusoidal/phase-driven gait generators with proper
  limb phase offsets per creature morphology (hexapod tripod gait for morvek, bipedal for drell
  and NPCs, wing-flap cycles for ash shrikes, slow buoyant bob and tentacle drift for skerrin).
- Blend between locomotion states (idle / walk / run / turn) with real crossfades and a
  correct root-motion-free footfall — feet must not skate along the ground.
- Two-bone IK foot placement against the terrain heightfield so feet land ON the surface on
  slopes, plus pelvis-drop when the ground under one foot is much lower. This is the single
  clearest AAA-vs-amateur signal in character work.
- Look-at IK for heads: creatures and NPCs turn to track the player within a cone.
- Skin/carapace materials: chitin from ctx.get('materials') with iridescence; NPC skin needs a
  subsurface-scattering approximation (warm transmission at grazing angles and on ears).
- Simple AI: wander, flee, approach, idle-graze, with terrain-aware steering and obstacle
  avoidance. Cliff racers circle and dive. Netches drift on the wind. NPCs follow the paths.
- LOD: skinned near, reduced-bone mid, impostor far. Cap simultaneous skinned actors and
  report the cap.
- Spawn a populated but not crowded world: a few dozen creatures across the region, biome-
  appropriate (skerrin over water and ash flats, morvek near rocks, racers in the air).`,
  },
  {
    key: 'vfx',
    dir: 'src/vfx',
    label: 'vfx+particles',
    prompt: `${COMMON}

YOUR SUBSYSTEM: particles, VFX and magic. YOU OWN src/vfx/ ONLY.
Write ${ROOT}/src/vfx/VFX.ts exporting \`class VFXSystem\` implementing System
(id 'vfx', order 120).

Export a stable API combat/RPG will call:
  spawn(effect: string, position: THREE.Vector3, dir?: THREE.Vector3): void
  beam(from: THREE.Vector3, to: THREE.Vector3, kind: string, seconds: number): void

Ambient world VFX (these run always and do enormous work for atmosphere):
- **Airborne ash motes** — fine particulate drifting in the wind, catching the sun. Density
  scales with the sky system's weather. In an ash storm this becomes a driving opaque wall.
- **Embers** rising from lava fissures and braziers, with buoyant turbulent motion and
  additive glow that lights nothing but reads hot.
- **Dust devils** on the open wastes; **spray and mist** at the shoreline; **rain** with real
  splash impacts and ripple decals on water; **fog banks** pooling in low terrain at dawn.
- **Insect swarms / spore drift** with bioluminescent motes near fungal groves at night.

Magic VFX — Elder Scrolls schools, each visually distinct:
- Destruction: fire (turbulent, additive, with heat-haze refraction), frost (crystalline,
  sharp, blue-white, with a frozen-ground decal), shock (branching procedural lightning with
  correct fork recursion and a bright core + coloured bloom halo).
- Restoration/Alteration: soft golden volumetric motes converging inward.
- Illusion/Mysticism: violet distortion, refractive shimmer, an inverted-normal shell.
- Conjuration: a summoning portal — a rotating Daedric sigil with an emissive edge and a
  particle vortex.
- Spell casting hand glow, charge-up, and release, with matching light flashes.

Requirements:
- GPU particles: simulate in a shader over a data texture (position/velocity ping-pong) or with
  a fully instanced vertex-shader-parametric approach. Do NOT update per-particle attributes on
  the CPU — a CPU particle system caps out far below the density this needs.
- Soft particles: fade against scene depth so nothing shows a hard intersection line with
  terrain or geometry. Requires reading the depth target — coordinate with the render pipeline's
  depth texture (read ${ROOT}/src/render/Pipeline.ts to find how it is exposed; if it is not
  exposed, say so clearly in your report rather than hacking around it).
- Correct blending: additive for emissive/hot, alpha for particulate. Sort or use weighted
  blended OIT where alpha particles overlap.
- Particles must be LIT by the sun for non-emissive types (ash, dust, spray) — unlit white
  billboards are the classic amateur particle tell.
- Heat haze / refraction as a screen-space distortion pass over the scene colour.
- Decals: projected splash, scorch and frost decals on terrain, depth-tested and normal-aligned.
- Every effect must have a defined lifetime and be pooled — no allocation per spawn.
- Report your particle budget and the simulation approach you chose.`,
  },
];

phase('Author');

const results = await pipeline(
  TASKS,
  (t) => agent(t.prompt, { label: t.label, phase: 'Author', effort: 'high' }),
  (report, t) =>
    agent(
      `You authored the "${t.key}" subsystem of Ashlands at ${ROOT}. Your report:
---
${report}
---
VERIFY your work compiles:
  cd ${ROOT} && npx tsc --noEmit 2>&1 | grep -E "^${t.dir}/"
Fix every error in YOUR directory (${t.dir}) only — other agents own the rest and are editing
concurrently. Repeat until clean.
Then re-read your main file and fix anything obviously broken: uniforms declared but never
updated, undefined varyings, GPU resources never disposed, instanced attributes never uploaded,
per-frame allocations in the update loop.
Return "CLEAN" plus one line, or describe what you could not fix and why.`,
      { label: `verify:${t.key}`, phase: 'Typecheck' },
    ),
);

return { authored: TASKS.map((t) => t.key), verify: results };
