export const meta = {
  name: 'ashlands-critic',
  description: 'Harsh visual QA loop: capture shots, blind-critique vs Morrowind, dispatch fixes',
  phases: [
    { title: 'Critique', detail: 'one harsh critic per vantage point' },
    { title: 'Fix', detail: 'one fixer per blamed subsystem' },
  ],
};

const ROOT = '/Users/peter/Development/morrowind';

// args may arrive as an object or as a JSON string depending on the caller.
// Getting this wrong silently graded a stale capture directory once already,
// producing eight confident critiques of images nobody was looking at — so
// parse defensively and refuse to run rather than fall back to a default.
const A = typeof args === 'string' ? JSON.parse(args) : (args ?? {});
if (A.iter == null) throw new Error('critic-loop: args.iter is required (got ' + JSON.stringify(args) + ')');
const ITER = A.iter;
const SHOTS = A.shots ?? ['dawn', 'redmtn', 'coast', 'night', 'ashstorm', 'dusk', 'vale', 'ridge'];

const OWNER = {
  materials: 'src/mat',
  sky: 'src/sky',
  terrain: 'src/world',
  water: 'src/water',
  render: 'src/render',
  flora: 'src/flora',
  arch: 'src/arch',
  actors: 'src/actors',
  vfx: 'src/vfx',
};

const CRITIC_SCHEMA = {
  type: 'object',
  required: ['verdict', 'scores', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    beatsMorrowind: {
      type: 'string',
      enum: ['ours-clearly', 'ours-narrowly', 'tie', 'morrowind-narrowly', 'morrowind-clearly'],
      description: 'Blind A/B judgement of this frame against a comparable vanilla Morrowind vista',
    },
    oneLine: { type: 'string', description: 'Blunt one-sentence summary of the frame' },
    scores: {
      type: 'object',
      required: ['composition', 'lighting', 'materials', 'atmosphere', 'detailDensity', 'colourGrade', 'artDirection', 'technicalArtifacts'],
      properties: {
        composition: { type: 'integer', minimum: 1, maximum: 10 },
        lighting: { type: 'integer', minimum: 1, maximum: 10 },
        materials: { type: 'integer', minimum: 1, maximum: 10 },
        atmosphere: { type: 'integer', minimum: 1, maximum: 10 },
        detailDensity: { type: 'integer', minimum: 1, maximum: 10 },
        colourGrade: { type: 'integer', minimum: 1, maximum: 10 },
        artDirection: { type: 'integer', minimum: 1, maximum: 10 },
        technicalArtifacts: { type: 'integer', minimum: 1, maximum: 10 },
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['subsystem', 'severity', 'defect', 'where', 'fix'],
        properties: {
          subsystem: { type: 'string', enum: Object.keys(OWNER) },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          defect: { type: 'string', description: 'What is wrong, concretely' },
          where: { type: 'string', description: 'Where in frame, e.g. "lower-left third, the cliff face"' },
          fix: { type: 'string', description: 'Specific, actionable technical remedy' },
        },
      },
    },
  },
};

phase('Critique');

const critiques = await parallel(
  SHOTS.map((name) => () =>
    agent(
      `You are a principal art director doing a hostile review pass on a real-time renderer.
You have shipped AAA titles. You are known for being impossible to please and for finding the
one artifact everyone else missed. Vague praise from you is worthless and you know it.

Read these two files first:
  ${ROOT}/ART_BIBLE.md      (the art direction and the rubric you must apply)
  ${ROOT}/shots/iter${ITER}/manifest.json   (fps + any runtime errors for this build)

Now open and LOOK at this frame with the Read tool:
  ${ROOT}/shots/iter${ITER}/${name}.png

Study it properly. Zoom your attention across the frame in quadrants — foreground ground plane,
midground masses, background silhouette, sky. Then judge.

TASK 1 — BLIND COMPARISON. Recall what a comparable vista in vanilla *The Elder Scrolls III:
Morrowind* (2002, as it ships on Steam today) actually looks like at this time of day and
weather. Compare honestly against the frame in front of you. Set \`beatsMorrowind\`. Do not be
charitable to us: if our frame is muddy, flat, untextured, or reads as a grey tech demo, then
Morrowind's committed art direction wins and you must say so. Morrowind winning is a legitimate
and expected verdict on early iterations.

TASK 2 — SCORE against the eight rubric axes in the art bible. Passing requires EVERY axis >= 8
and technicalArtifacts >= 9. Anything less is FAIL.

TASK 3 — FINDINGS. Every defect gets an entry, attributed to the subsystem that owns it:
  materials = texture synthesis / PBR maps      sky = sky, sun, moons, clouds, fog, weather
  terrain   = heightfield, splat, LOD, erosion  water = ocean, shore, underwater
  render    = post stack, AO, TAA, bloom, tonemap, grading, DOF, shafts
  flora     = vegetation    arch = buildings/ruins    actors = creatures/NPCs    vfx = particles
Attribute correctly — a fixer will be dispatched to that directory and nowhere else.
Be specific enough to act on: "the ash plane at the bottom of frame shows an obvious 8m grid
repeat" beats "textures look tiled". Give a real technical remedy in \`fix\`.

Known-fatal defects that are AUTOMATIC blockers if present: a black or blank frame; a flat
untextured surface; a hard fog wall; visible texture tiling; objects with no ground contact
shadow; z-fighting; TAA ghosting or smearing; clipped pure-white sky; banding in the sky
gradient; a seam between terrain chunks; NaN/black pixels.

If the frame is empty or nearly empty (e.g. only sky, or only a flat plane), say so plainly in
\`oneLine\` and mark it FAIL with a blocker — do not invent detail that is not there.`,
      { label: `critic:${name}`, phase: 'Critique', schema: CRITIC_SCHEMA, effort: 'high' },
    ).then((r) => (r ? { shot: name, ...r } : null)),
  ),
);

const ok = critiques.filter(Boolean);
const all = ok.flatMap((c) => c.findings.map((f) => ({ ...f, shot: c.shot })));
const bySub = {};
for (const f of all) (bySub[f.subsystem] ??= []).push(f);

const rank = { blocker: 0, major: 1, minor: 2 };
const summary = ok.map((c) => `${c.shot}: ${c.verdict} [${c.beatsMorrowind}] — ${c.oneLine}`).join('\n');
log(`iter${ITER} verdicts:\n${summary}`);

const failing = ok.filter((c) => c.verdict === 'FAIL').length;
if (!Object.keys(bySub).length) return { iter: ITER, done: true, critiques: ok, summary };

phase('Fix');

const fixes = await parallel(
  Object.entries(bySub).map(([sub, items]) => () => {
    const dir = OWNER[sub];
    const list = items
      .sort((a, b) => rank[a.severity] - rank[b.severity])
      .map((f, i) => `${i + 1}. [${f.severity}] (shot: ${f.shot}) ${f.defect}\n   WHERE: ${f.where}\n   SUGGESTED FIX: ${f.fix}`)
      .join('\n');
    return agent(
      `You own the "${sub}" subsystem of the Ashlands Three.js game at ${ROOT}.
YOU MAY ONLY EDIT FILES UNDER ${ROOT}/${dir}/. Other agents are concurrently editing every other
directory; writing outside yours will destroy their work and yours will be reverted.

Read ${ROOT}/ART_BIBLE.md, then read your own source in ${ROOT}/${dir}/.

A hostile art-direction review of iteration ${ITER} produced these defects against your subsystem.
Fix them. Blockers first.

${list}

Rules:
- Fix the ROOT CAUSE, not the symptom. Do not paper over a defect by darkening the frame,
  cranking fog, or hiding geometry.
- You may look at the offending screenshots yourself at ${ROOT}/shots/iter${ITER}/<shot>.png —
  do so, it is much better than guessing.
- Preserve the interfaces in ${ROOT}/src/core/types.ts and contracts.ts exactly.
- Strict TypeScript. Verify with:
    cd ${ROOT} && npx tsc --noEmit 2>&1 | grep -E "^${dir}/"
  and fix every error in your directory.
- If a defect is genuinely NOT your subsystem's fault, do not make a speculative change — say
  which subsystem you believe owns it and why.

Return a terse list of what you actually changed, and anything still outstanding.`,
      { label: `fix:${sub}`, phase: 'Fix', effort: 'high' },
    );
  }),
);

return {
  iter: ITER,
  failing,
  verdicts: ok.map((c) => ({ shot: c.shot, verdict: c.verdict, beats: c.beatsMorrowind, scores: c.scores, one: c.oneLine })),
  findingCounts: Object.fromEntries(Object.entries(bySub).map(([k, v]) => [k, v.length])),
  fixes: fixes.filter(Boolean),
  summary,
};
