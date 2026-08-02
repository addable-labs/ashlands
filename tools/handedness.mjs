#!/usr/bin/env node
/**
 * THROWAWAY DIAGNOSTIC — is the authored viewmodel hand a right hand or a left?
 *
 * Mirror confusion is not settleable by eye, so this settles it on the actual
 * geometry with a chirality test:
 *
 *   F = wrist -> middle finger, EXTENDED (the hand's long axis; an extended
 *       finger is the metacarpal continued, so wrist -> middle MCP head is the
 *       ray the extended fingertip lies on)
 *   T = wrist -> thumb, ABDUCTED (the radial direction: across the metacarpal
 *       heads from the little finger to the index; an abducted thumb points
 *       along it)
 *   N = the palm's outward normal (out of the palm, away from the back)
 *
 *   normalize(cross(T, F)) . N  >  0  =>  RIGHT hand
 *                                <  0  =>  LEFT hand
 *
 * Convention check, done on a real hand and reproduced by the script below with
 * an explicit reference triad: hold the RIGHT hand palm UP, fingers pointing
 * NORTH. The thumb then points EAST and the palm normal points UP. With
 * East=+X, North=+Y, Up=+Z (right handed), T=+X, F=+Y, N=+Z, and
 * cross(T,F) = X x Y = +Z = +N. Positive. So positive = right hand.
 *
 * Nothing here is measured by eye. It runs the REAL handGeometry() out of
 * src/combat/Viewmodel.ts (rolldown-bundled, with a capture of the solved bone
 * chains injected in memory only -- the repo file is not touched), takes the
 * landmarks off the solved bones AND independently off the vertex buffer, and
 * prints both.
 */
import { rolldown } from 'rolldown';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VM = resolve(ROOT, 'src/combat/Viewmodel.ts');
const OUT = resolve(ROOT, 'tools/_handprobe.bundle.mjs');

console.log('Viewmodel.ts md5:', createHash('md5').update(readFileSync(VM)).digest('hex'));

/* ---- bundle, instrumenting Viewmodel.ts in memory ---------------------- */

const ANCHOR = 'const index = geo.getIndex();';
const CAPTURE = `(globalThis as any).__HAND = {
    chains, tk, palm, heel, wristDir, thenarTh, hypoTh, thumbTip, wrist, axis, ulnar,
    FY, FTH0, FL, FR, lift, fist, grip, gr,
  };
  `;

const build = await rolldown({
  input: resolve(ROOT, 'tools/_handentry.ts'),
  plugins: [{
    // Viewmodel.ts pulls Gear.ts in for material plumbing only; Gear drags the
    // whole renderer (sky/vfx shader chunks) in behind it, and handGeometry()
    // touches none of it. Stubbed so this probe depends on nothing but the
    // geometry code under test.
    name: 'gear-stub',
    resolveId(src) { return src === './Gear' ? '\0gear' : null; },
    load(id) {
      return id === '\0gear'
        ? 'export const gripSection = () => ({ x: 0.013, z: 0.011 });\n'
          + 'export const makeMaterial = () => ({});\n'
          + 'export const patchViewmodelMaterial = () => {};\n'
        : null;
    },
  }, {
    name: 'capture',
    transform(code, id) {
      if (!id.endsWith('combat/Viewmodel.ts')) return null;
      if (!code.includes(ANCHOR)) throw new Error('capture anchor not found in Viewmodel.ts');
      let out = code.replace(ANCHOR, CAPTURE + ANCHOR);
      out += '\nexport { handGeometry, mirrorZ, chainPoint, THA, THB, GRIP_LIFT, WRIST_LEN, WRIST_SOCKET };\n';
      return out;
    },
  }],
});
await build.write({ file: OUT, format: 'esm', inlineDynamicImports: true });
await build.close();

const M = await import(OUT);
const THREE = (await import('three'));
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ---- reference triad: prove the sign convention on a known right hand -- */
{
  const T = V(1, 0, 0);   // thumb: east
  const F = V(0, 1, 0);   // fingers: north
  const N = V(0, 0, 1);   // palm normal: up
  const s = new THREE.Vector3().crossVectors(T, F).dot(N);
  console.log(`\nCONVENTION CHECK (textbook right hand, palm up / fingers north / thumb east)`);
  console.log(`  cross(T,F).N = ${s.toFixed(4)}  -> positive means RIGHT hand\n`);
}

/* ---- run the real builder --------------------------------------------- */

const SWORD = { x: 0.0168, z: 0.0134 };   // the section Viewmodel.build() uses for a blade
const hand = M.handGeometry(SWORD, false, 0);  // lift 0: keeps bones and mesh in one frame
const H = globalThis.__HAND;
if (!H) throw new Error('capture did not fire');

const cp = (c, k) => M.chainPoint(c, k, new THREE.Vector3());
const F_NAMES = ['index', 'middle', 'ring', 'little'];

/* Wrist: where the forearm is planted. Taken straight off the builder's own
 * output (lift is 0, so bones and mesh are in one frame). */
const wrist = H.wrist.clone();

/* Metacarpal heads (MCP knuckles) — joint 0 of each solved finger chain. */
const mcp = H.chains.map((c) => cp(c, 0));
const tip = H.chains.map((c) => cp(c, 3));

/* ---- vertex-side landmarks, independent of the bone arrays ------------- */
const pos = hand.geo.getAttribute('position');
const verts = [];
for (let i = 0; i < pos.count; i++) verts.push(V(pos.getX(i), pos.getY(i), pos.getZ(i)));

/** Nearest vertex to a point, and its distance. */
const nearest = (p) => {
  let best = null, bd = Infinity;
  for (const v of verts) { const d = v.distanceTo(p); if (d < bd) { bd = d; best = v; } }
  return { v: best, d: bd };
};

/** Palm normal straight off the mesh: the palm shell's vertices all face the
 *  grip axis on their palmar side, so the mean inward radial direction over the
 *  vertices that lie in the palm's angular span IS the palm's outward normal. */
const palmSpanC = H.palm[Math.floor(H.palm.length / 2)].c.clone();
const palmVerts = verts.filter((v) => v.distanceTo(palmSpanC) < 0.030);
const Nmesh = new THREE.Vector3();
for (const v of palmVerts) Nmesh.add(V(-v.x, 0, -v.z).normalize());
Nmesh.normalize();

/** Palm normal off the authored palm rings: -radial at mid palm. */
const Nbone = V(-palmSpanC.x, 0, -palmSpanC.z).normalize();

/* ---- the three vectors ------------------------------------------------- */

// F: hand long axis, wrist -> middle MCP. An EXTENDED middle finger is the
// metacarpal continued, so the extended fingertip lies out along this ray.
const Fv = mcp[1].clone().sub(wrist).normalize();

// T: radial direction, little MCP -> index MCP, taken perpendicular to F. An
// ABDUCTED thumb points along this. (Read off the knuckle line, so the thumb's
// own curl -- which is what is easy to mis-author -- cannot bias the answer.)
const Traw = mcp[0].clone().sub(mcp[3]);
const Tv = Traw.clone().addScaledVector(Fv, -Traw.dot(Fv)).normalize();

// N: palm outward normal.
const Nv = Nmesh.clone().addScaledVector(Fv, -Nmesh.dot(Fv)).normalize();

const chi = new THREE.Vector3().crossVectors(Tv, Fv);
const triple = chi.dot(Nv);

const f4 = (v) => `(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;

console.log('HAND: sword grip section 16.8 x 13.4 mm, gripping (not fist), lift 0');
console.log(`  vertices ${pos.count}, triangles ${hand.triangles}`);
console.log(`  wrist (forearm plant)      ${f4(wrist)}`);
for (let i = 0; i < 4; i++) {
  console.log(`  MCP ${F_NAMES[i].padEnd(7)} ${f4(mcp[i])}   tip ${f4(tip[i])}   nearest vertex to MCP: ${(nearest(mcp[i]).d * 1000).toFixed(1)} mm`);
}
const thumbTip = H.thumbTip.clone();
const thumbBase = cp(H.tk, 0);
console.log(`  thumb base ${f4(thumbBase)}   thumb tip ${f4(thumbTip)}   nearest vertex to tip: ${(nearest(thumbTip).d * 1000).toFixed(1)} mm`);
console.log(`  thenar centre y=${H.thenarTh.toFixed(3)} rad, hypothenar y=${H.hypoTh.toFixed(3)} rad`);

console.log('\nTHE THREE VECTORS (hand local space == held-weapon local space)');
console.log(`  F  wrist -> middle finger, extended   ${f4(Fv)}`);
console.log(`  T  wrist -> thumb, abducted (radial)  ${f4(Tv)}`);
console.log(`  N  palm outward normal (from mesh)    ${f4(Nv)}`);
console.log(`     palm outward normal (from rings)   ${f4(Nbone)}   [agreement: ${Nmesh.dot(Nbone).toFixed(4)}]`);
console.log(`     palm vertices sampled: ${palmVerts.length}`);
console.log(`  orthogonality: F.T = ${Fv.dot(Tv).toFixed(4)}   F.N = ${Fv.dot(Nv).toFixed(4)}   T.N = ${Tv.dot(Nv).toFixed(4)}`);

console.log('\nCHIRALITY');
console.log(`  cross(T,F)            = ${f4(chi)}`);
console.log(`  cross(T,F) . N        = ${triple.toFixed(4)}`);
console.log(`  VERDICT: the authored hand is a ${triple > 0 ? 'RIGHT' : 'LEFT'} HAND`);

/* ---- corroboration 1: thumb tip vs the radial half-space --------------- */
{
  const rel = thumbTip.clone().sub(wrist);
  console.log('\nCORROBORATION 1 — where the actual thumb sits');
  console.log(`  thumb tip . T (radial+) = ${rel.dot(Tv).toFixed(4)}  (a thumb belongs on the radial side, > 0)`);
  console.log(`  thumb tip . N (palmar+) = ${rel.dot(Nv).toFixed(4)}`);
  const relIdx = mcp[0].clone().sub(wrist);
  console.log(`  index MCP  . T          = ${relIdx.dot(Tv).toFixed(4)}`);
  const relLit = mcp[3].clone().sub(wrist);
  console.log(`  little MCP . T          = ${relLit.dot(Tv).toFixed(4)}`);
}

/* ---- corroboration 2: the MCP flexion axis ----------------------------- */
{
  // Fingers close by rotating from the extended ray toward the palm. The axis
  // of that rotation is a real anatomical direction: on a RIGHT hand the MCP
  // flexion axis points toward the THUMB (rotating F toward N is a positive
  // turn about +T, by the right-hand rule). Measure it off the solved chain:
  // proximal phalanx direction at the knuckle vs. the extended ray.
  const prox = cp(H.chains[1], 1).sub(mcp[1]).normalize();
  const flexAxis = new THREE.Vector3().crossVectors(Fv, prox).normalize();
  const rT = V(1, 0, 0), rF = V(0, 1, 0), rN = V(0, 0, 1);
  const rProx = rF.clone().multiplyScalar(Math.cos(1)).addScaledVector(rN, Math.sin(1)); // flexed 57 deg
  const rAxis = new THREE.Vector3().crossVectors(rF, rProx).normalize();
  console.log('\nCORROBORATION 2 — the MCP flexion axis');
  console.log(`  reference right hand, finger flexed 57 deg toward the palm: flex axis . T = ${rAxis.dot(rT).toFixed(4)}`);
  console.log(`  middle proximal phalanx dir ${f4(prox)}`);
  console.log(`  flex axis cross(F, proximal) = ${f4(flexAxis)}`);
  console.log(`  flex axis . T = ${flexAxis.dot(Tv).toFixed(4)}   (RIGHT hand: > 0, flexion axis points thumb-ward)`);
  console.log(`  fingers curl toward the palm? proximal . N = ${prox.dot(Nv).toFixed(4)}  (must be > 0 on either hand)`);
}

/* ---- corroboration 3: pure vertex test, no bone arrays at all ---------- */
{
  // Connected components of the merged buffer: every part was swept separately,
  // so each digit is its own island. Identify the four fingers and the thumb by
  // matching island tips against nothing but geometry: the island whose extreme
  // point is farthest up +Y among the digit-sized islands is the index side.
  const idx = hand.geo.getIndex();
  const n = pos.count;
  const parent = new Int32Array(n).fill(-1);
  const find = (a) => { while (parent[a] >= 0) a = parent[a]; return a; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let i = 0; i < idx.count; i += 3) { uni(idx.getX(i), idx.getX(i + 1)); uni(idx.getX(i + 1), idx.getX(i + 2)); }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  }
  // The digit islands: elongated, 100-400 verts. Find, for each solved chain,
  // the island containing the vertex nearest its tip — pure spatial matching.
  const islandOf = (p) => {
    let best = -1, bd = Infinity;
    for (const [r, list] of groups) {
      for (const i of list) { const d = verts[i].distanceTo(p); if (d < bd) { bd = d; best = r; } }
    }
    return { r: best, d: bd };
  };
  const midVerts = groups.get(islandOf(tip[1]).r).map((i) => verts[i]);
  const thmVerts = groups.get(islandOf(thumbTip).r).map((i) => verts[i]);
  const litVerts = groups.get(islandOf(tip[3]).r).map((i) => verts[i]);
  // Farthest vertex from the wrist inside the middle-finger island == that
  // finger's tip, read from the vertex buffer alone.
  const far = (list) => list.reduce((a, b) => (b.distanceTo(wrist) > a.distanceTo(wrist) ? b : a));
  const midTipV = far(midVerts);
  const cen = (list) => list.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / list.length);
  const thmC = cen(thmVerts.map((v) => v.clone()));
  const litC = cen(litVerts.map((v) => v.clone()));
  // F': wrist -> curled middle fingertip. Curl is a rotation in the F-N plane,
  // which carries no T component, so the sign of the triple product survives it
  // (it scales by cos of the curl angle; printed below, and it is only 26 deg
  // here because the wrist is far proximal of the tip).
  const Fv2 = midTipV.clone().sub(wrist).normalize();
  // T': thumb mass -> across the hand from the little finger's. Whole-island
  // centroids, so the thumb's opposition (which puts its TIP on the palmar side
  // and is what makes a tip-based T degenerate) cannot bias it.
  const Tv2raw = thmC.clone().sub(litC);
  const Tv2 = Tv2raw.clone().addScaledVector(Fv2, -Tv2raw.dot(Fv2)).normalize();
  const Nv2 = Nmesh.clone().addScaledVector(Fv2, -Nmesh.dot(Fv2)).normalize();
  const t2 = new THREE.Vector3().crossVectors(Tv2, Fv2).dot(Nv2);
  console.log('\nCORROBORATION 3 — vertex buffer only (islands, no bone arrays)');
  console.log(`  islands: ${groups.size}; middle ${midVerts.length} verts, thumb ${thmVerts.length}, little ${litVerts.length}`);
  console.log(`  middle tip vertex ${f4(midTipV)}  thumb centroid ${f4(thmC)}  little centroid ${f4(litC)}`);
  console.log(`  F' ${f4(Fv2)}  T' ${f4(Tv2)}  N' ${f4(Nv2)}   (F'.F = ${Fv2.dot(Fv).toFixed(4)}, curl ${(Math.acos(Fv2.dot(Fv)) * 180 / Math.PI).toFixed(1)} deg)`);
  console.log(`  cross(T',F') . N' = ${t2.toFixed(4)}  -> ${t2 > 0 ? 'RIGHT' : 'LEFT'}`);
  console.log('  (T\' is weak here — the thumb is OPPOSED, so its mass lies over the palm and most');
  console.log('   of thumb-minus-little is palmar, not radial. Same islands, cleaner radial axis:)');
  // The radial axis with no thumb in it at all: index island centroid minus
  // little island centroid. Both fingers wrap the haft the same way, so the
  // difference between the two whole islands is the across-the-hand offset and
  // nothing else.
  const idxVerts = groups.get(islandOf(tip[0]).r).map((i) => verts[i]);
  const kIdx = cen(idxVerts.map((v) => v.clone())), kLit = litC;
  const Tv3raw = kIdx.clone().sub(kLit);
  const Tv3 = Tv3raw.clone().addScaledVector(Fv2, -Tv3raw.dot(Fv2)).normalize();
  const t3 = new THREE.Vector3().crossVectors(Tv3, Fv2).dot(Nv2);
  console.log(`  index island centroid ${f4(kIdx)}  little island centroid ${f4(kLit)}`);
  console.log(`  T'' ${f4(Tv3)}  (T''.N' = ${Tv3.dot(Nv2).toFixed(4)})   cross(T'',F') . N' = ${t3.toFixed(4)}  -> ${t3 > 0 ? 'RIGHT' : 'LEFT'}`);
}

/* ---- what the mirror does --------------------------------------------- */
{
  const mg = M.mirrorZ(hand.geo.clone());
  const mp = mg.getAttribute('position');
  const mv = (i) => V(mp.getX(i), mp.getY(i), mp.getZ(i));
  // Mirror the landmark points the same way and re-run the test.
  const mz = (v) => V(v.x, v.y, -v.z);
  const wristM = mz(wrist), mcpM = mcp.map(mz), NmeshM = mz(Nmesh);
  const FM = mcpM[1].clone().sub(wristM).normalize();
  const TMraw = mcpM[0].clone().sub(mcpM[3]);
  const TM = TMraw.clone().addScaledVector(FM, -TMraw.dot(FM)).normalize();
  const NM = NmeshM.clone().addScaledVector(FM, -NmeshM.dot(FM)).normalize();
  const tm = new THREE.Vector3().crossVectors(TM, FM).dot(NM);
  console.log('\nTHE OTHER HAND — mirrorZ() of the above, which the viewmodel calls "left"');
  console.log(`  cross(T,F) . N = ${tm.toFixed(4)}  -> ${tm > 0 ? 'RIGHT' : 'LEFT'} HAND`);
  console.log(`  winding after mirror: mirrorZ flips z and must flip triangle order; verts ${mp.count}`);
  void mv;
}

/* ---- dump for the render ----------------------------------------------- */
{
  const lifted = M.handGeometry(SWORD, false, M.GRIP_LIFT);
  const lp = lifted.geo.getAttribute('position');
  const li = lifted.geo.getIndex();
  const ln = lifted.geo.getAttribute('normal');
  mkdirSync(resolve(ROOT, 'tools/_hand'), { recursive: true });
  writeFileSync(resolve(ROOT, 'tools/_hand/hand.json'), JSON.stringify({
    position: Array.from(lp.array).map((x) => +x.toFixed(6)),
    normal: ln ? Array.from(ln.array).map((x) => +x.toFixed(4)) : null,
    index: Array.from(li.array),
    lift: M.GRIP_LIFT,
    grip: SWORD,
    landmarks: {
      wrist: wrist.toArray(),
      mcp: mcp.map((v) => v.toArray()),
      tip: tip.map((v) => v.toArray()),
      thumbTip: thumbTip.toArray(),
      thumbBase: thumbBase.toArray(),
      F: Fv.toArray(), T: Tv.toArray(), N: Nv.toArray(),
      triple,
    },
  }));
  console.log(`\nwrote tools/_hand/hand.json (${lp.count} verts) for the render`);
}
