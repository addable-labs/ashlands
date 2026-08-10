import * as THREE from 'three';
import { Rng } from './Rng';
import type { TerrainQuery } from '../core/types';

/**
 * Where the buildings go.
 *
 * Two rules do most of the work. First, a settlement is a PATH NETWORK with
 * buildings hung off it — a scatter of houses on a hillside reads as procedural
 * no matter how good the houses are. Second, nothing is placed without asking
 * the terrain: slope, altitude above the sea, and how much fill the foundation
 * would need are all hard gates, so no structure ever ends up on a cliff or
 * hovering over a gully.
 */

export type Style = 'dome' | 'redoran' | 'tower' | 'daedric';

export interface Plot {
  x: number;
  z: number;
  /** Foundation pad height: mostly cut, partly filled. */
  y: number;
  /** Yaw of the front door, radians. */
  facing: number;
  style: Style;
  size: number;
  seed: number;
  /** Local terrain fill needed, metres. Drives how deep the plinth goes. */
  fill: number;
}

export interface PropSite {
  x: number;
  z: number;
  y: number;
  yaw: number;
  kind: 'urn' | 'crate' | 'rack' | 'net' | 'brazier' | 'banner';
  seed: number;
}

/**
 * The three silhouettes the province is made of.
 *
 * `dwemer` is a fallen machine rather than a standing structure: it is the only
 * horizontal landmark mass and the only metal in the world, so it does work
 * neither of the other two can — and a skyline of nothing but mushroom towers
 * reads as one idea repeated.
 */
export type LandmarkKind = 'telvanni' | 'daedric' | 'dwemer';

/**
 * A skyline-breaking structure. Sized by HEIGHT rather than by footprint,
 * because the only thing that matters for a landmark is how much sky it takes.
 */
export interface LandmarkPlot {
  x: number;
  z: number;
  y: number;
  facing: number;
  /**
   * Whole-asset yaw about +Y, radians. Separate from `facing`, which only picks
   * which cell the door is cut in: this rotates the built mesh, which is the
   * only thing that breaks an object-space feature repeating in the same screen
   * direction across every instance.
   */
  yaw: number;
  kind: LandmarkKind;
  /** Overall height in metres, pad to highest point. */
  height: number;
  seed: number;
  /**
   * This landmark stands on a SHOAL, not on dry land: `y` is above the
   * waterline and the terrain under it is seabed. The builder swaps the ash
   * drift for a heavier boulder apron, because there is no wind-blown ash three
   * metres under water and the waterline seam is the one a camera looks
   * straight at. See the offshore pass in `planLandmarks`.
   */
  stack?: boolean;
}

export interface Layout {
  center: THREE.Vector2;
  plots: Plot[];
  props: PropSite[];
  landmarks: LandmarkPlot[];
  /** Street polylines in world XZ. Used for prop placement and dock anchoring. */
  paths: THREE.Vector2[][];
  dock: { from: THREE.Vector2; to: THREE.Vector2 } | null;
}

const SEA = 0;

function slopeAt(t: TerrainQuery, x: number, z: number, out: THREE.Vector3): number {
  t.normalAt(x, z, out);
  return Math.acos(Math.max(-1, Math.min(1, out.y)));
}

/**
 * Pad height for a landmark standing at (x,z).
 *
 * THE fix for "the tower has no ground contact — its legs terminate in midair".
 * This used to be `p.min + (p.mean - p.min) * 0.5` over a ring of radius
 * `height * 0.24` — 26 m for a 110 m tower. On the volcanic cone that ring
 * routinely spans sixty metres of relief, so the pad was authored twenty to
 * SIXTY-SEVEN metres below the ground the tower actually stands on (measured
 * across the live layout: min dy -66.9 m, and only one landmark in fifty-nine
 * within a metre of its own surface). Two failures come straight out of that
 * single number:
 *
 *  - Landmarks on a slope were half-swallowed. The 54 m-sunk tower forty metres
 *    from the ridge vantage rendered as an anonymous dark dome with slab
 *    protrusions growing out of the hillside — the "separate render layer
 *    pasted over the shot" the review measured on the right edge.
 *  - Everything hung off the trunk — roots, plinth, drift — is planted against
 *    the REAL heightfield through the `ground` callback, so with the pad tens of
 *    metres low the roots had to climb steeply out of the ground to reach the
 *    trunk and read as spider legs ending in mid-air rather than as contact.
 *
 * The pad now sits on the surface at the trunk's own axis, embedded just far
 * enough that the base INTERSECTS the ground instead of kissing it. The
 * foundation's plinth already chases the terrain down at every bearing, so the
 * downhill side is covered without sinking the whole asset to meet it.
 */
function padHeight(t: TerrainQuery, x: number, z: number, height: number): number {
  const c = t.heightAt(x, z);
  // Never above the mean of a tight ring: on a knife-edge crest the axis sample
  // is the one point higher than everything around it, and a landmark perched
  // exactly on it would show daylight under its uphill flank.
  const p = pad(t, x, z, Math.min(18, Math.max(6, height * 0.09)));
  // 1.5 m at settlement scale, a little more under a great tower, capped so the
  // door never ends up below grade.
  const embed = Math.min(3.0, Math.max(1.2, height * 0.02));
  return Math.min(c, p.mean + 0.5) - embed;
}

/** Terrain statistics under a circular footprint. */
function pad(t: TerrainQuery, x: number, z: number, r: number): { min: number; max: number; mean: number } {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  for (let a = 0; a < 8; a++) {
    const th = (a / 8) * Math.PI * 2;
    for (const rr of [r * 0.45, r]) {
      const h = t.heightAt(x + Math.cos(th) * rr, z + Math.sin(th) * rr);
      if (h < min) min = h;
      if (h > max) max = h;
      sum += h;
      n++;
    }
  }
  const c = t.heightAt(x, z);
  if (c < min) min = c;
  if (c > max) max = c;
  sum += c;
  n++;
  return { min, max, mean: sum / n };
}

/** Nearest open water within `r`, or null. */
function seaNear(t: TerrainQuery, x: number, z: number, r: number, step: number): THREE.Vector2 | null {
  let best: THREE.Vector2 | null = null;
  let bestH = SEA - 1.5;
  for (let a = 0; a < 16; a++) {
    const th = (a / 16) * Math.PI * 2;
    for (let d = step; d <= r; d += step) {
      const px = x + Math.cos(th) * d;
      const pz = z + Math.sin(th) * d;
      if (Math.abs(px) > t.extent || Math.abs(pz) > t.extent) break;
      const h = t.heightAt(px, pz);
      if (h < bestH) {
        bestH = h;
        best = new THREE.Vector2(px, pz);
      }
    }
  }
  return best;
}

/**
 * Elevation angle, in radians, of the highest terrain along a bearing from an
 * eye — i.e. where the SKYLINE is if you stand here and look that way.
 *
 * This exists because "prominent" and "visible" are different properties and
 * the planner only ever tested the first one. A site measured 8 m above the
 * mean of its own 260 m ring is prominent; if a 90 m ridge stands 300 m in
 * front of it, a hundred-metre tower there is still completely invisible from
 * the beach it was placed to serve. That is exactly what the coast and night
 * frames were: three towers inside the view cone at 780 m, 1.2 km and 1.3 km,
 * every one of them tucked behind the headland in front of it and rendering as
 * dark geometry on a dark slope.
 *
 * Marched to `reach` rather than to the candidate, because what matters is
 * whether the crown clears EVERYTHING between the eye and the horizon, not just
 * the ground up to the tower's own foot.
 */
function skylineAngle(
  t: TerrainQuery,
  ex: number,
  ez: number,
  ey: number,
  dx: number,
  dz: number,
  reach: number,
  step: number,
): number {
  let best = -Math.PI / 2;
  for (let d = step; d <= reach; d += step) {
    const px = ex + dx * d;
    const pz = ez + dz * d;
    if (Math.abs(px) > t.extent || Math.abs(pz) > t.extent) break;
    const a = Math.atan2(t.heightAt(px, pz) - ey, d);
    if (a > best) best = a;
  }
  return best;
}

/**
 * Grow a street: fixed-length steps that turn only gently and prefer to hold
 * their altitude. This is how a real footpath crosses a slope, and it means
 * the buildings hung off it end up on ground that can actually take them.
 */
function growPath(
  t: TerrainQuery,
  start: THREE.Vector2,
  heading: number,
  steps: number,
  step: number,
  rng: Rng,
): THREE.Vector2[] {
  const out: THREE.Vector2[] = [start.clone()];
  let p = start.clone();
  let h = heading;
  const n = new THREE.Vector3();
  for (let i = 0; i < steps; i++) {
    let bestScore = -Infinity;
    let bestH = h;
    let bestP = p;
    for (let k = -3; k <= 3; k++) {
      const th = h + k * 0.20 + rng.jitter(0.03);
      const q = new THREE.Vector2(p.x + Math.cos(th) * step, p.y + Math.sin(th) * step);
      if (Math.abs(q.x) > t.extent - 60 || Math.abs(q.y) > t.extent - 60) continue;
      const hy = t.heightAt(q.x, q.y);
      if (hy < SEA + 1.5 || hy > SEA + 90) continue;
      const s = slopeAt(t, q.x, q.y, n);
      const score = -Math.abs(hy - t.heightAt(p.x, p.y)) * 1.4 - s * 9 - Math.abs(k) * 0.22;
      if (score > bestScore) {
        bestScore = score;
        bestH = th;
        bestP = q;
      }
    }
    if (bestScore === -Infinity) break;
    p = bestP;
    h = bestH;
    out.push(p.clone());
  }
  return out;
}

export interface LayoutOptions {
  seed: number;
  /** Hard cap on settlement buildings. */
  maxBuildings: number;
  /** Hard cap on scattered ruins across the whole map. */
  maxRuins: number;
  /** Hard cap on skyline landmarks across the whole map. */
  maxLandmarks: number;
}

interface Prominence {
  x: number;
  z: number;
  h: number;
  /** Height above the mean of a 260 m ring — how much sky this spot commands. */
  relief: number;
  /** 0 ideal shoulder, 1 usable ground, 2 last resort. */
  tier: number;
  score: number;
}

/**
 * Choose where the skyline landmarks go.
 *
 * The requirement is not "scatter some big things"; it is that a camera
 * standing anywhere and looking in any direction finds one against the sky.
 * Two rules get that:
 *
 *  1. Candidates must be PROMINENT — measurably above the mean of a 260 m ring.
 *     A 90 m tower in a basin is swallowed by the next ridge and buys nothing;
 *     the same tower on a shoulder breaks the horizon from kilometres away.
 *  2. Selection is STRATIFIED over a 4x4 sector grid, not greedy over the whole
 *     map. Pure greedy-by-score clusters every landmark on the one massif with
 *     the highest relief and leaves three quarters of the compass empty, which
 *     is exactly the failure the review caught.
 *
 * On top of that, two placements are forced because named shots depend on them:
 * one great tower on a shoulder of the summit (every peak-facing vantage), and
 * one shrine on a coastal headland (every shoreline vantage).
 */
function planLandmarks(
  t: TerrainQuery,
  rng: Rng,
  center: THREE.Vector2,
  plots: readonly Plot[],
  max: number,
  seaDir: THREE.Vector2 | null,
): LandmarkPlot[] {
  const E = t.extent;
  const n = new THREE.Vector3();
  const STEP = 100;
  const RELIEF_R = 260;

  const cands: Prominence[] = [];
  const peak = new THREE.Vector2(0, 0);
  let peakH = -Infinity;
  const clamp = (v: number): number => Math.max(-E, Math.min(E, v));
  // Two grid steps of margin: a 60 m-wide compound hanging off the world edge
  // is worse than no compound.
  for (let x = -E + STEP * 2; x <= E - STEP * 2; x += STEP) {
    for (let z = -E + STEP * 2; z <= E - STEP * 2; z += STEP) {
      const h = t.heightAt(x, z);
      if (h > peakH) {
        peakH = h;
        peak.set(x, z);
      }
      if (h < SEA + 6) continue;
      const s = slopeAt(t, x, z, n);
      let rel = 0;
      for (let a = 0; a < 8; a++) {
        const th = (a / 8) * Math.PI * 2;
        rel += h - t.heightAt(clamp(x + Math.cos(th) * RELIEF_R), clamp(z + Math.sin(th) * RELIEF_R));
      }
      rel /= 8;
      const p = pad(t, x, z, 26);
      const broken = p.max - p.min;

      // Tiered admission rather than one hard gate.
      //
      // A single strict predicate is how the first cut of this produced three
      // landmarks on an eighteen-landmark budget: on a big volcanic cone almost
      // nothing is simultaneously flat, unbroken AND locally prominent, so
      // whole quadrants came back empty — which is precisely the defect this
      // system exists to fix.
      //
      // Tier 0 is the shoulder we want. Tier 1 is ground that merely works.
      // Tier 3 is dry land and nothing more, and it is deliberately unbounded:
      // the plinth chases the ground down at every angle, so a landmark on a
      // steep or broken site costs a deeper skirt and nothing else, and an
      // ugly-but-present silhouette beats an empty horizon every time. Scoring
      // separates the tiers by 1e4, so a worse tier is only ever reached when
      // the sector offers nothing better.
      let tier: number;
      if (s <= 0.30 && rel >= 1.5 && broken <= 16) tier = 0;
      else if (s <= 0.40 && rel >= -2 && broken <= 26) tier = 1;
      else if (s <= 0.55 && broken <= 45) tier = 2;
      else tier = 3;

      cands.push({ x, z, h, relief: rel, tier, score: rel + h * 0.02 - tier * 1e4 });
    }
  }
  cands.sort((a, b) => b.score - a.score);

  // Altitude ceiling for the GENERAL passes only.
  //
  // Left to itself, "highest relief wins" parks landmark after landmark on the
  // upper cone, where each one is kilometres from anywhere a camera stands and
  // resolves to a speck against rock rather than a silhouette against sky. The
  // general passes are therefore held to the inhabited band — but the forced
  // high-approach pass below deliberately opts out, because that band is
  // precisely where the high-vantage shot looks, and filtering it out of the
  // candidate list entirely is what left that shot with a bare slope.
  const ceiling = SEA + Math.max(120, (peakH - SEA) * 0.72);

  const out: LandmarkPlot[] = [];
  // Spacing sets how many landmarks a 60-degree view cone is likely to contain.
  // At 480 m over a 4 km map the expected count out to 2 km was about two, and
  // two is one ridge away from zero — this frame is exactly the one the review
  // rejected. 420 m puts three to four in a typical cone, so an occlusion no
  // longer empties the horizon.
  const MIN_GAP = 420;
  const freeGap = (x: number, z: number, gap: number): boolean => {
    if (Math.hypot(x - center.x, z - center.y) < 260) return false;
    for (const q of out) if (Math.hypot(q.x - x, q.z - z) < gap) return false;
    for (const q of plots) if (Math.hypot(q.x - x, q.z - z) < 90) return false;
    return true;
  };
  const free = (x: number, z: number): boolean => freeGap(x, z, MIN_GAP);
  const commit = (c: Prominence, kind: LandmarkKind, height: number, stack = false): void => {
    out.push({
      x: c.x,
      z: c.z,
      // Snapped to the heightfield at the axis and embedded; see padHeight.
      // A sea stack is the one case where that is wrong: the heightfield there
      // is seabed, and a pad on the seabed is a drowned tower. Its pad is
      // authored above the waterline and the plinth reaches the bottom.
      y: stack ? c.h : padHeight(t, c.x, c.z, height),
      facing: rng.range(0, Math.PI * 2),
      // Yaw is INDEPENDENT of the door's facing. Without it every instance of an
      // asset shares one object-space orientation, so a lean, a vein or a pod
      // cluster lands in the same screen direction on all of them and the
      // repeat reads as a literal duplicate however well the seed varies the
      // rest. The builder counter-rotates the terrain callback, so roots and
      // plinth still plant on the real ground.
      yaw: rng.range(0, Math.PI * 2),
      kind,
      height,
      seed: rng.int(1, 1 << 28),
      stack,
    });
  };
  const take = (
    test: (c: Prominence) => boolean,
    kind: LandmarkKind,
    height: number,
    allowHigh = false,
  ): boolean => {
    if (out.length >= max) return false;
    for (const c of cands) {
      if (!allowHigh && c.h > ceiling) continue;
      if (!free(c.x, c.z) || !test(c)) continue;
      commit(c, kind, height);
      return true;
    }
    return false;
  };

  /**
   * Like `take`, but picks the candidate that maximises `rank` rather than the
   * first in score order. The high-approach pass needs the HIGHEST site in its
   * band, not the best-scoring one — score is dominated by the tier offset, so
   * plain `take` walks down the mountain and puts the shrine on comfortable
   * ground a kilometre below the vantage that was supposed to see it.
   */
  const takeBy = (
    test: (c: Prominence) => boolean,
    rank: (c: Prominence) => number,
    kind: LandmarkKind,
    height: number,
  ): boolean => {
    if (out.length >= max) return false;
    let best: Prominence | null = null;
    let bestR = -Infinity;
    for (const c of cands) {
      if (!free(c.x, c.z) || !test(c)) continue;
      const r = rank(c);
      if (r > bestR) {
        bestR = r;
        best = c;
      }
    }
    if (!best) return false;
    commit(best, kind, height);
    return true;
  };

  // Forced: a ring of great towers in the approach to the mountain.
  //
  // NOT on the summit's own shoulder. Ember Mount is kilometres across, so a
  // tower "near the peak" sits three kilometres from anywhere a camera stands
  // and resolves to a dark speck pasted on the cone — measured, and it is the
  // frame the review rejected twice.
  //
  // The annulus below is where the canonical peak-facing vantages actually
  // live, so a tower here lands in the MIDGROUND of those shots: close enough
  // to read at a couple of hundred pixels, far enough back for aerial
  // perspective to separate it from the mountain behind. Three of them, spread
  // in azimuth, so the ring is entered from any approach.
  for (let i = 0; i < 3; i++) {
    take(
      (c) => {
        const d = Math.hypot(c.x - peak.x, c.z - peak.y);
        return d > 1100 && d < 2600 && out.every((q) => Math.hypot(q.x - c.x, q.z - c.z) > 900);
      },
      'telvanni',
      rng.range(100, 130),
    );
  }

  // ---- silhouette coverage --------------------------------------------------
  //
  // Every pass above places landmarks by where they SIT. This one places them
  // by where they can be SEEN FROM, which is the property the module docstring
  // actually claims and the only one the reviewer can check.
  //
  // The previous version of this was a greedy walk down the shore-adjacent
  // prominences under a 420 m spacing rule. It placed twelve landmarks and it
  // still produced a coast frame and a night frame with, in the reviewer's
  // words, "no culturally identifiable object anywhere". Instrumenting the
  // frame showed why: there WERE three towers in the cone, at 780 m, 1.21 km
  // and 1.32 km — all of them below the ridge line in front of them, rendering
  // as dark shapes on dark ground. Spacing guarantees proximity. It guarantees
  // nothing about visibility, and on a volcanic island of nested ridges those
  // are almost unrelated.
  //
  // So: take a spread of places a camera could plausibly stand, pointed in a
  // spread of directions, and for each (place, direction) that cannot see a
  // landmark against the sky, put one where it can — sizing the tower to the
  // height that actually clears the skyline on that bearing rather than to a
  // number out of a hat.
  //
  // DIRECTION is not a refinement, it is the whole point. The first cut of this
  // pass asked only "can this vantage see a landmark anywhere", reported every
  // vantage covered, and changed the coast frame by nothing — because the
  // landmark it was counting stood behind the camera. A shoreline camera looks
  // out to sea by construction, so the only landmarks that can ever enter its
  // frame are the ones flanking it along the shore.
  {
    // Standable ground, thinned to roughly one vantage per 220 m, plus every
    // stretch of shore at a finer spacing. The shore is oversampled on purpose:
    // it is a one-dimensional set inside a two-dimensional grid, so a spacing
    // that samples the interior well misses most beaches entirely — and three
    // of the ten canonical shots stand on one.
    let placedByCoverage = 0;
    const eyes: { x: number; z: number; y: number }[] = [];
    const pushEye = (x: number, z: number, h: number, minGap: number): void => {
      for (const q of eyes) if (Math.hypot(q.x - x, q.z - z) < minGap) return;
      eyes.push({ x, z, y: h + 2.0 }); // eye height, not ground height
    };
    const VSTEP = 220;
    for (let x = -E + VSTEP; x <= E - VSTEP; x += VSTEP) {
      for (let z = -E + VSTEP; z <= E - VSTEP; z += VSTEP) {
        const h = t.heightAt(x, z);
        if (h < SEA + 0.5) continue;
        if (slopeAt(t, x, z, n) > 0.34) continue;
        pushEye(x, z, h, VSTEP * 0.8);
      }
    }
    const SSTEP = 80;
    for (let x = -E + SSTEP; x <= E - SSTEP; x += SSTEP) {
      for (let z = -E + SSTEP; z <= E - SSTEP; z += SSTEP) {
        const h = t.heightAt(x, z);
        if (h < SEA + 0.4 || h > SEA + 8) continue;
        if (slopeAt(t, x, z, n) > 0.34) continue;
        if (seaNear(t, x, z, 320, 60) === null) continue;
        pushEye(x, z, h, 110);
      }
    }

    // Out to the far side of the island: the skyline a camera sees is made by
    // whatever is highest along the whole ray, not by the nearest hill.
    const REACH = 2600;
    // ~1.4 degrees. At 800 m that is a crown standing 20 m clear of the ridge
    // behind it — unmistakably a structure breaking the horizon rather than
    // something perched on it.
    const MARGIN = 0.024;
    // Nearer than this and the landmark is scenery you are standing in, not a
    // silhouette; further and it is under aerial perspective before it is under
    // scrutiny.
    const NEAR = 220;
    // 2.2 km, not 1.5. The reviewer's own note asks for the landmark in the
    // BACKGROUND band of a coastal frame, and a headland flanking a beach is
    // routinely further off than the beach is wide. Aerial perspective handles
    // the depth read; what matters is that the shape is there at all.
    const FAR = 2200;
    /** Range within which a landmark actually answers for a view cone. */
    const COVER_FAR = 1250;

    // The skyline as a function of bearing, sampled once per eye.
    //
    // Marching per (eye, candidate) pair is the obvious implementation and it
    // is ten million heightfield lookups; the profile is five thousand and is
    // reused by every test that eye makes. 72 bins is a five-degree wedge —
    // fine enough that a tower is judged against the ridge it is actually
    // behind, coarse enough that the whole pass costs a few milliseconds.
    const BINS = 72;
    const profileOf = (e: { x: number; z: number; y: number }): Float32Array => {
      const prof = new Float32Array(BINS);
      for (let b = 0; b < BINS; b++) {
        const th = ((b + 0.5) / BINS) * Math.PI * 2;
        // 25 m steps, from 25 m out. The first cut marched from 40 m and
        // missed exactly the thing that was hiding the landmarks: the low dune
        // a shoreline camera is standing behind. A ridge 30 m in front of the
        // eye occludes more sky than one at 800 m.
        prof[b] = skylineAngle(t, e.x, e.z, e.y, Math.cos(th), Math.sin(th), REACH, 25);
      }
      return prof;
    };
    const skyAt = (prof: Float32Array, dx: number, dz: number): number => {
      let b = Math.floor(((Math.atan2(dz, dx) + Math.PI * 2) / (Math.PI * 2)) * BINS) % BINS;
      if (b < 0) b += BINS;
      return prof[b];
    };

    // Eight view directions per vantage, each judged over a +/-26 degree cone —
    // narrower than any of the canonical fields of view, so anything that
    // satisfies this is comfortably inside the frame rather than clipped by it.
    const VIEWS = 8;
    const COS_CONE = Math.cos(0.46);

    const covered = (
      e: { x: number; z: number; y: number },
      prof: Float32Array,
      vx: number,
      vz: number,
      need: number,
    ): boolean => {
      for (const q of out) {
        const dx = q.x - e.x;
        const dz = q.z - e.z;
        const d = Math.hypot(dx, dz);
        // COVER_FAR, not FAR. A landmark on the far side of a bay at 2 km is
        // real and worth placing, and it is NOT an answer to "this cone has
        // nothing in it": at that range it is four percent of the frame height
        // and most of the way into the haze. Counting it as coverage is what
        // left the coast vantage empty while the planner reported the cone
        // solved. Placement still searches to FAR; only the satisfaction test
        // is tightened.
        if (d < NEAR || d > COVER_FAR) continue;
        if ((dx * vx + dz * vz) / d < COS_CONE) continue;
        if (Math.atan2(q.y + q.height - e.y, d) - skyAt(prof, dx, dz) >= need) return true;
      }
      return false;
    };

    // Two sweeps. The first insists on a clean break of the skyline; the second
    // accepts a crown level with it, because a tower whose cap sits ON the
    // ridge line still reads as architecture and an empty horizon never does.
    for (const need of [MARGIN, -0.006]) {
      for (const e of eyes) {
        if (out.length >= max) break;
        const prof = profileOf(e);
        for (let v = 0; v < VIEWS && out.length < max; v++) {
          const va = (v / VIEWS) * Math.PI * 2;
          const vx = Math.cos(va);
          const vz = Math.sin(va);
          // Note the margin: a cone is only ever counted as SOLVED by a
          // landmark that makes a clean break of the skyline, even on the
          // relaxed sweep. Letting the loose criterion also decide coverage is
          // how a tower tucked behind a dune marked a beach as done and the
          // shot came back empty for a second iteration running.
          if (covered(e, prof, vx, vz, MARGIN)) continue;
          let best: Prominence | null = null;
          let bestScore = -Infinity;
          let bestH = 0;
          for (const c of cands) {
            const dx0 = c.x - e.x;
            const dz0 = c.z - e.z;
            const d = Math.hypot(dx0, dz0);
            if (d < NEAR || d > FAR) continue;
            if ((dx0 * vx + dz0 * vz) / d < COS_CONE) continue;
            // 250 m rather than the global 420 m gap. The general spacing rule
            // exists to stop greedy scoring clustering landmarks on one massif;
            // this pass is not greedy on score, it is answering a specific
            // empty view cone, and refusing it a site because another landmark
            // stands 400 m away — in a completely different direction — is how
            // eleven of these placements were being thrown away.
            if (!freeGap(c.x, c.z, 250)) continue;
          // What is the skyline in this direction, and how tall must the tower
          // be to stand clear of it? Sizing from the answer is the difference
          // between a landmark and a decoration behind a hill.
            const sky = skyAt(prof, dx0, dz0);
            // Same estimate the placement will actually use, or the demand this
            // pass computes is against a pad that never gets built.
            const padY = padHeight(t, c.x, c.z, 100);
            const wantCrown = e.y + Math.tan(sky + need + 0.010) * d;
            // How much tower this site DEMANDS. On a site that already stands
            // clear of the skyline this is small or negative, and those are the
            // sites we want; on one tucked behind a ridge it is the height the
            // crown has to reach to be seen at all.
            const demand = wantCrown - padY;
            // Past 135 m the site is simply wrong and no amount of tower fixes
            // it — that is a triangle bill pretending to be a landmark.
            if (demand > 135) continue;
            // Kind follows the demand, which also keeps the horizon from
            // becoming a mushroom farm: where a site only needs forty metres to
            // stand clear, cyclopean basalt is both the cheaper asset and the
            // better read, and Ashenreach is not Vaelmyr everywhere.
            const height = demand <= 46 ? Math.min(70, Math.max(40, demand)) : Math.min(135, Math.max(72, demand));
            // Prefer sites that need the LEAST help, then prominence, then
            // proximity. A short tower that works beats a tall one propped up
            // to compensate for a bad position every time.
            const score = -Math.max(0, demand) * 0.5 + c.relief * 2 - d * 0.004 - c.tier * 30;
            if (score > bestScore) {
              bestScore = score;
              best = c;
              bestH = height;
            }
          }
          if (best) {
            // Kind follows demand, then a stable per-site roll so the horizon
            // is not one idea repeated: a low site takes cyclopean basalt or a
            // fallen Deshan machine, a tall one takes a Vaelmyr tower.
            const kind: LandmarkKind =
              bestH <= 70 ? (((best.x * 31 + best.z * 17) & 3) === 0 ? 'dwemer' : 'daedric') : 'telvanni';
            commit(best, kind, bestH);
            placedByCoverage++;
          }
        }
      }
      if (out.length >= max) break;
    }
    // ---- offshore stacks ----------------------------------------------------
    //
    // Everything above places landmarks on LAND, and there are frames no amount
    // of that can fill.
    //
    // A shoreline camera looks out to sea by construction, and the vantage the
    // shot harness picks is the one facing the MOST open water — it maximises
    // the depth of the sea in front of it. Measured against the live
    // heightfield at that vantage: past the 80 m dune the camera stands behind,
    // every bearing in a 100-degree cone is water, all the way to the map edge,
    // 2 km out and 82 m deep. There is no site. The coverage sweep above
    // correctly reports the cone as blind and correctly declines to invent a
    // hill, and the frame comes back with no culturally identifiable object in
    // it for the third review running.
    //
    // What Ashenreach puts there is a sea rock. A shoal a couple of hundred
    // metres out, a battered basalt stack on it, a tower grown out of that: it
    // is the canonical image, it is the only thing that can occupy this frame
    // at a MIDGROUND distance rather than looming off the beach, and it costs
    // no new geometry — the foundation's plinth already chases the drawn ground
    // down at every bearing, so a pad set above the waterline over a shallow
    // seabed builds the rock by itself.
    //
    // Strictly gated: only a beach vantage, only a cone with nothing in it at
    // any range, only over genuine shallows with open water between the stack
    // and the shore, and at most STACK_MAX of them on the whole island.
    {
      const STACK_MIN = 230;
      const STACK_MAX_D = 620;
      const STACK_MAX = 4;
      // Above this the shoal is dry land and the land passes own it; below it
      // the plinth is a fifteen-metre pedestal, which reads as a pier.
      const BED_HI = SEA - 0.5;
      const BED_LO = SEA - 18;
      // Half of any canonical field of view, so a stack found at the edge of
      // this sweep is still comfortably inside the frame rather than clipped by
      // it. Measured: the shoal that answers the night vantage sits 30 degrees
      // off the seaward axis, and a sweep narrow enough to miss it finds only
      // open ocean and places nothing.
      const CONE = 0.70;
      // 140 m, not the global 420. The general spacing rule exists to stop
      // greedy scoring clustering landmarks on one massif; this pass is not
      // greedy, it is answering one specific empty view cone, and the landmark
      // it keeps colliding with is a tower on the shore BEHIND the beach that
      // can never enter that cone. Refusing the stack because of it is the
      // "spacing guarantees proximity and nothing about visibility" failure
      // this whole block was written to fix.
      const STACK_GAP = 140;
      let stacks = 0;
      let shoalsSeen = 0;
      let rejGap = 0;
      let rejShore = 0;
      let beaches = 0;
      let occ = 0;
      for (const e of eyes) {
        if (stacks >= STACK_MAX || out.length >= max) break;
        // Only beaches. An inland vantage has no seaward cone to answer.
        if (e.y > SEA + 9) continue;
        const water = seaNear(t, e.x, e.z, 300, 40);
        if (!water) continue;
        const wl = Math.hypot(water.x - e.x, water.y - e.z);
        if (wl < 1e-3) continue;
        const vx = (water.x - e.x) / wl;
        const vz = (water.y - e.z) / wl;

        // Anything already standing in this cone, at ANY range — not the
        // coverage test, which ignores everything inside 220 m and would have
        // us raise a stack in front of a tower on the next headland.
        let occupied = false;
        for (const q of out) {
          const dx = q.x - e.x;
          const dz = q.z - e.z;
          const d = Math.hypot(dx, dz);
          if (d < 1e-3 || d > STACK_MAX_D * 2.2) continue;
          if ((dx * vx + dz * vz) / d >= COS_CONE) {
            occupied = true;
            break;
          }
        }
        if (occupied) {
          occ++;
          continue;
        }
        beaches++;

        let best: { x: number; z: number; bed: number; d: number } | null = null;
        let bestScore = -Infinity;
        for (let d = STACK_MIN; d <= STACK_MAX_D; d += 25) {
          for (let a = -CONE; a <= CONE + 1e-6; a += 0.06) {
            const ux = vx * Math.cos(a) - vz * Math.sin(a);
            const uz = vx * Math.sin(a) + vz * Math.cos(a);
            const x = e.x + ux * d;
            const z = e.z + uz * d;
            if (Math.abs(x) > E - 80 || Math.abs(z) > E - 80) continue;
            const bed = t.heightAt(x, z);
            if (bed > BED_HI || bed < BED_LO) continue;
            shoalsSeen++;
            if (!freeGap(x, z, STACK_GAP)) {
              rejGap++;
              continue;
            }
            // Water on nearly every side, or it is a promontory of the beach
            // and reads as one — the whole value of a stack is that it is
            // SURROUNDED. Tested as a ring round the shoal rather than along
            // the ray from the eye: the first fifty metres of that ray is the
            // dune the camera is standing behind, so a path test rejects every
            // real shoal on the island and places nothing at all.
            let wet = 0;
            for (let k = 0; k < 8; k++) {
              const rt = (k / 8) * Math.PI * 2;
              if (t.heightAt(x + Math.cos(rt) * 55, z + Math.sin(rt) * 55) < SEA - 1.0) wet++;
            }
            if (wet < 6) {
              rejShore++;
              continue;
            }
            // Prefer further out (midground, not looming), shallower (a rock,
            // not a pedestal) and near the axis of the view rather than at the
            // edge of frame.
            const score = d * 0.014 + (bed - BED_LO) * 0.20 - Math.abs(a) * 1.4;
            if (score > bestScore) {
              bestScore = score;
              best = { x, z, bed, d };
            }
          }
        }
        if (!best) continue;
        // Enough of the rock proud of the water to read as one, and no more:
        // the plinth below the pad is what becomes the stack.
        const padY = SEA + 2.2;
        // Sized so the tower subtends a consistent angle whatever range the
        // shoal happened to be at — a fixed height is a monolith at 150 m and a
        // smudge at 600.
        const height = Math.max(62, Math.min(115, best.d * 0.38));
        commit({ x: best.x, z: best.z, h: padY, relief: 0, tier: 0, score: 0 }, 'telvanni', height, true);
        stacks++;
      }
      console.info(
        `[arch] offshore stacks: ${stacks} raised from ${beaches} beach vantage(s); ` +
          `${shoalsSeen} shoal samples, ${rejGap} too near a landmark, ${rejShore} not clear of the shore, ${occ} cones already occupied`,
      );
    }

    // Reported because "how many view cones still cannot see a landmark" is the
    // single number this whole pass exists to drive down, and it is invisible
    // in any screenshot until it is already a defect.
    let blind = 0;
    let total = 0;
    for (const e of eyes) {
      const prof = profileOf(e);
      for (let v = 0; v < VIEWS; v++) {
        const va = (v / VIEWS) * Math.PI * 2;
        total++;
        if (!covered(e, prof, Math.cos(va), Math.sin(va), -0.006)) blind++;
      }
    }
    console.info(
      `[arch] silhouette coverage: ${eyes.length} vantages x ${VIEWS} views, ` +
        `${placedByCoverage} landmark(s) placed to fill gaps, ` +
        `${blind}/${total} cones still without a skyline landmark`,
    );
  }

  // Forced: shrines on the high approaches to the summit, ONE PER OCTANT.
  //
  // This band is where a high vantage looks, and without something in it that
  // shot is a bare slope — a vista with no subject. The previous pass took the
  // two highest sites in the whole annulus, and "highest" is a single place: on
  // a cone both landed within a few hundred metres of each other and left five
  // of the eight approaches empty. That is precisely the frame the review threw
  // out as "a generic hillside" — a camera 250 m off the summit looking
  // downhill found nothing built at any depth.
  //
  // Binding the pass to azimuth sectors about the peak instead guarantees that
  // whichever way a high camera turns, a silhouette is in the cone. Shrines
  // rather than towers: nothing grows at this altitude, and cyclopean basalt on
  // a lava-crusted shoulder is the right read.
  //
  // Note these deliberately ignore the altitude ceiling: the ceiling exists to
  // stop the GENERAL passes climbing the cone, and filtering this band out of
  // the candidate list entirely is what left the high vantage bare.
  const OCT = 8;
  for (let i = 0; i < OCT; i++) {
    const a0 = (i / OCT) * Math.PI * 2 - Math.PI;
    const a1 = ((i + 1) / OCT) * Math.PI * 2 - Math.PI;
    takeBy(
      (c) => {
        const dx = c.x - peak.x;
        const dz = c.z - peak.y;
        const d = Math.hypot(dx, dz);
        if (d < 240 || d > 1500) return false;
        const az = Math.atan2(dz, dx);
        if (az < a0 || az >= a1) return false;
        return out.every((q) => Math.hypot(q.x - c.x, q.z - c.z) > 330);
      },
      // Ranked on PROMINENCE, not on raw altitude. "Highest in the sector" on a
      // cone means "nearest the summit", which puts every shrine uphill of a
      // vantage that is itself near the summit and looking down — behind the
      // camera, or hidden by the shoulder immediately in front of it. Relief is
      // height above the mean of a 260 m ring, so it selects the spur that
      // stands clear of its own surroundings and can actually be seen from the
      // slope below it.
      (c) => c.relief * 3 + c.h * 0.004,
      i % 3 === 1 ? 'telvanni' : 'daedric',
      i % 3 === 1 ? rng.range(64, 86) : rng.range(42, 62),
    );
  }

  // Forced: headland landmarks ringing the whole coastline.
  //
  // A camera on the shore looks OUT TO SEA, so the only landmarks that can
  // enter its frame are the ones flanking it along the same stretch of coast.
  // Three headland picks spread over a four-kilometre shoreline covers perhaps
  // a third of it, which is why the coast and night vantages came back with a
  // bare horizon and no architecture at any depth.
  //
  // One per compass octant instead, ranked by prominence within the octant, so
  // every beach on the island has a silhouette to one side or the other. Half
  // are towers: a mushroom tower against a sunset IS the shot.
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2 - Math.PI;
    const a1 = ((i + 1) / 8) * Math.PI * 2 - Math.PI;
    takeBy(
      (c) => {
        if (c.h > SEA + 70) return false;
        const az = Math.atan2(c.z, c.x);
        if (az < a0 || az >= a1) return false;
        return seaNear(t, c.x, c.z, 420, 60) !== null;
      },
      (c) => c.relief + c.h * 0.05,
      i % 2 === 0 ? 'telvanni' : 'daedric',
      i % 2 === 0 ? rng.range(72, 105) : rng.range(38, 54),
    );
  }

  // Forced: two towers on the headlands the SETTLEMENT'S OWN shore looks across.
  //
  // Every shoreline vantage in the shot list stands on this beach and faces the
  // water, and a landmark cannot be placed in the water — so the octant ring
  // above, which spreads landmarks evenly round the island, put none of them in
  // this particular cone and the coast and night frames came back with nothing
  // built at any depth. What covers a seaward view is a headland flanking it:
  // land, close to the water, in the same half of the compass the camera is
  // pointing. Towers, not shrines: 90 m of mushroom against a sunset over water
  // is the shot those two vantages exist to take.
  if (seaDir) {
    for (let i = 0; i < 2; i++) {
      takeBy(
        (c) => {
          const dx = c.x - center.x;
          const dz = c.z - center.y;
          const d = Math.hypot(dx, dz);
          if (d < 300 || d > 1100 || c.h > SEA + 60) return false;
          // Within ~70 degrees of the way the beach faces, so it lands inside a
          // seaward cone rather than behind the camera.
          if ((dx * seaDir.x + dz * seaDir.y) / d < 0.34) return false;
          return seaNear(t, c.x, c.z, 240, 40) !== null;
        },
        (c) => c.relief - c.h * 0.03,
        'telvanni',
        rng.range(78, 112),
      );
    }
  }

  // Stratified: the best remaining prominence in each sector of a 4x4 grid.
  const SECT = 4;
  const cell = (2 * E) / SECT;
  for (let sx = 0; sx < SECT && out.length < max; sx++) {
    for (let sz = 0; sz < SECT && out.length < max; sz++) {
      const x0 = -E + sx * cell;
      const z0 = -E + sz * cell;
      const telvanni = rng.chance(0.6);
      take(
        (c) => c.x >= x0 && c.x < x0 + cell && c.z >= z0 && c.z < z0 + cell,
        telvanni ? 'telvanni' : 'daedric',
        telvanni ? rng.range(72, 112) : rng.range(38, 54),
      );
    }
  }

  // Whatever budget is left goes to the strongest remaining prominences.
  for (const c of cands) {
    if (out.length >= max) break;
    if (c.h > ceiling || !free(c.x, c.z)) continue;
    const telvanni = rng.chance(0.55);
    commit(c, telvanni ? 'telvanni' : 'daedric', telvanni ? rng.range(66, 100) : rng.range(36, 50));
  }

  return out;
}

export function planSettlement(t: TerrainQuery, opts: LayoutOptions): Layout {
  const rng = new Rng(opts.seed);
  const n = new THREE.Vector3();
  const E = t.extent;

  // ---- pick the coastal site ---------------------------------------------
  let center = new THREE.Vector2(0, 0);
  let water: THREE.Vector2 | null = null;
  let best = -Infinity;
  const STEP = 50;
  for (let x = -E + STEP; x <= E - STEP; x += STEP) {
    for (let z = -E + STEP; z <= E - STEP; z += STEP) {
      const h = t.heightAt(x, z);
      if (h < SEA + 2.5 || h > SEA + 26) continue;
      const s = slopeAt(t, x, z, n);
      if (s > 0.20) continue;
      const sea = seaNear(t, x, z, 190, 25);
      if (!sea) continue;
      const p = pad(t, x, z, 26);
      // Flat, low, close to water, and without a big cut-and-fill bill.
      const score = -s * 22 - (p.max - p.min) * 0.5 - h * 0.05 - sea.distanceTo(new THREE.Vector2(x, z)) * 0.012;
      if (score > best) {
        best = score;
        center = new THREE.Vector2(x, z);
        water = sea;
      }
    }
  }

  // ---- street network -----------------------------------------------------
  const toSea = water ? new THREE.Vector2().subVectors(water, center).normalize() : new THREE.Vector2(1, 0);
  // The main street runs ALONG the shore; spurs run down to the water.
  const along = Math.atan2(toSea.x, -toSea.y);
  const paths: THREE.Vector2[][] = [];
  const main = growPath(t, center, along, 9, 15, rng).reverse().concat(growPath(t, center, along + Math.PI, 9, 15, rng));
  paths.push(main);
  for (let b = 0; b < 3; b++) {
    const anchor = main[Math.floor(((b + 1) / 4) * main.length)];
    if (!anchor) continue;
    paths.push(growPath(t, anchor, along + Math.PI * 0.5 * (b % 2 === 0 ? 1 : -1) + rng.jitter(0.3), rng.int(3, 6), 13, rng));
  }

  // ---- buildings along the streets ---------------------------------------
  const plots: Plot[] = [];
  const tryPlot = (x: number, z: number, facing: number, style: Style, size: number): boolean => {
    if (Math.abs(x) > E - 40 || Math.abs(z) > E - 40) return false;
    const s = slopeAt(t, x, z, n);
    if (s > 0.30) return false;
    const p = pad(t, x, z, size * 1.1);
    if (p.min < SEA + 1.0) return false;
    if (p.max - p.min > size * 1.35) return false; // too broken to found on
    for (const q of plots) {
      const d = Math.hypot(q.x - x, q.z - z);
      if (d < (q.size + size) * 1.15 + 2.5) return false;
    }
    // Mostly cut into the slope, partly filled: the plinth covers the rest.
    const y = p.min + (p.mean - p.min) * 0.4;
    plots.push({ x, z, y, facing, style, size, seed: rng.int(1, 1 << 28), fill: y - p.min });
    return true;
  };

  let placed = 0;
  const styleRoll = (): Style => (rng.chance(0.62) ? 'dome' : rng.chance(0.75) ? 'redoran' : 'tower');
  for (const path of paths) {
    for (let i = 1; i < path.length - 1 && placed < opts.maxBuildings; i++) {
      const a = path[i - 1];
      const b = path[i + 1];
      const dir = new THREE.Vector2().subVectors(b, a).normalize();
      const perp = new THREE.Vector2(-dir.y, dir.x);
      for (const s of rng.chance(0.5) ? [1, -1] : [-1, 1]) {
        if (placed >= opts.maxBuildings) break;
        if (rng.chance(0.22)) continue; // gaps in the frontage: a street, not a terrace
        const off = rng.range(8.5, 13.5);
        const jx = path[i].x + perp.x * s * off + dir.x * rng.jitter(3.5);
        const jz = path[i].y + perp.y * s * off + dir.y * rng.jitter(3.5);
        // Doors face the street.
        const facing = Math.atan2(-perp.x * s, -perp.y * s);
        const style = styleRoll();
        const size = style === 'tower' ? rng.range(2.6, 3.6) : rng.range(3.2, 5.2);
        if (tryPlot(jx, jz, facing, style, size)) placed++;
      }
    }
  }

  // One landmark tower on the highest ground inside the settlement.
  {
    let hx = center.x;
    let hz = center.y;
    let hh = -Infinity;
    for (const path of paths) {
      for (const p of path) {
        const h = t.heightAt(p.x, p.y);
        if (h > hh) {
          hh = h;
          hx = p.x;
          hz = p.y;
        }
      }
    }
    tryPlot(hx + rng.jitter(9), hz + rng.jitter(9), rng.range(0, 6.28), 'tower', rng.range(3.4, 4.6));
  }

  // ---- dock ---------------------------------------------------------------
  let dock: { from: THREE.Vector2; to: THREE.Vector2 } | null = null;
  if (water) {
    // Walk from the settlement toward the water until the ground drops under
    // the sea, then keep going until it is properly deep.
    const d = new THREE.Vector2().subVectors(water, center).normalize();
    let shore: THREE.Vector2 | null = null;
    for (let s = 0; s < 320; s += 2) {
      const px = center.x + d.x * s;
      const pz = center.y + d.y * s;
      if (t.heightAt(px, pz) < SEA + 0.6) {
        shore = new THREE.Vector2(px - d.x * 6, pz - d.y * 6);
        break;
      }
    }
    if (shore) {
      let end = shore.clone();
      for (let s = 6; s < 60; s += 2) {
        const px = shore.x + d.x * s;
        const pz = shore.y + d.y * s;
        end = new THREE.Vector2(px, pz);
        if (t.heightAt(px, pz) < SEA - 3.2) break;
      }
      if (end.distanceTo(shore) > 10) dock = { from: shore, to: end };
    }
  }

  // ---- props along the streets and between the houses --------------------
  const props: PropSite[] = [];
  const propKinds: PropSite['kind'][] = ['urn', 'urn', 'crate', 'rack', 'net', 'brazier', 'banner'];
  for (const path of paths) {
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const count = rng.int(1, 3);
      for (let k = 0; k < count; k++) {
        const tt = rng.next();
        const dir = new THREE.Vector2().subVectors(b, a).normalize();
        const perp = new THREE.Vector2(-dir.y, dir.x);
        const off = rng.range(2.2, 6.5) * (rng.chance(0.5) ? 1 : -1);
        const x = a.x + (b.x - a.x) * tt + perp.x * off;
        const z = a.y + (b.y - a.y) * tt + perp.y * off;
        if (slopeAt(t, x, z, n) > 0.32) continue;
        const h = t.heightAt(x, z);
        if (h < SEA + 1.0) continue;
        props.push({ x, z, y: h, yaw: rng.range(0, 6.28), kind: rng.pick(propKinds), seed: rng.int(1, 1 << 28) });
      }
    }
  }

  // ---- scattered ruins across the whole map ------------------------------
  const ruinRng = rng.fork(0x517cc1b7);
  const accepted: THREE.Vector2[] = [];
  let tries = 0;
  while (plots.length < opts.maxBuildings + opts.maxRuins && tries < 4000) {
    tries++;
    const x = ruinRng.range(-E + 90, E - 90);
    const z = ruinRng.range(-E + 90, E - 90);
    const h = t.heightAt(x, z);
    if (h < SEA + 4) continue;
    const s = slopeAt(t, x, z, n);
    if (s > 0.34) continue;
    if (Math.hypot(x - center.x, z - center.y) < 190) continue;
    let ok = true;
    for (const q of accepted) {
      if (Math.hypot(q.x - x, q.y - z) < 150) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const size = ruinRng.range(2.4, 4.6);
    const p = pad(t, x, z, size * 1.3);
    if (p.max - p.min > size * 1.6) continue;
    const style: Style = ruinRng.chance(0.5) ? 'tower' : ruinRng.chance(0.55) ? 'daedric' : 'dome';
    accepted.push(new THREE.Vector2(x, z));
    plots.push({
      x,
      z,
      y: p.min + (p.mean - p.min) * 0.45,
      facing: ruinRng.range(0, 6.28),
      style,
      size,
      seed: ruinRng.int(1, 1 << 28),
      fill: 0,
    });
  }

  // ---- skyline landmarks --------------------------------------------------
  // Planned last so they can avoid the streets and the scattered ruins, and on
  // their own RNG stream so tuning the settlement never reshuffles the horizon.
  const landmarks = planLandmarks(t, rng.fork(0x1a4d3c7f), center, plots, opts.maxLandmarks, water ? toSea : null);

  return { center, plots, props, landmarks, paths, dock };
}
