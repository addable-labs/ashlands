/**
 * Vantage-point search, evaluated inside the page against the live heightfield.
 *
 * Hardcoded camera coordinates were a mistake: the terrain is procedural and
 * changes whenever the generator is touched, so fixed coordinates drifted into
 * hillsides and buried the camera. Each shot instead declares INTENT, and we
 * search the heightfield for a location that satisfies it. Framing then stays
 * meaningful across terrain edits, which is what the critic loop needs.
 *
 * Returned as a string and eval'd in the browser, so it must be self-contained.
 */
export const FRAMING_FN = `
(function () {
  const ctx = window.engine.ctx;
  const t = ctx.get('terrain');
  const E = t.extent;
  const SEA = 0;

  // Coarse sample grid over the playable region. 80m is fine enough to find
  // every landform we care about and cheap enough to run in a few ms.
  const STEP = 80;
  const pts = [];
  for (let x = -E + STEP; x <= E - STEP; x += STEP) {
    for (let z = -E + STEP; z <= E - STEP; z += STEP) {
      pts.push({ x, z, h: t.heightAt(x, z), m: t.materialAt(x, z) });
    }
  }
  // Quantiles must be over LAND only. Roughly half the region is below sea level,
  // so whole-map quantiles put q(0.45) underwater and made every "low, flat, dry"
  // predicate unsatisfiable — pick() then silently returned the least-bad point,
  // which was the map corner. Every shot framed the same empty corner as a result.
  const H = pts.map((p) => p.h).filter((h) => h > SEA).sort((a, b) => a - b);
  const q = (f) => H.length
    ? H[Math.min(H.length - 1, Math.max(0, Math.round(f * (H.length - 1))))]
    : SEA + 1;

  const slopeAt = (x, z) => {
    const n = t.normalAt(x, z);
    return Math.acos(Math.max(-1, Math.min(1, n.y)));
  };

  // Highest point on the map — the Red Mountain summit, our primary landmark.
  let peak = pts[0];
  for (const p of pts) if (p.h > peak.h) peak = p;

  const yawTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z) + Math.PI;

  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  /** Does open water lie within \`r\` of this point? Returns the wettest neighbour. */
  const seaNear = (p, r) => {
    let best = null;
    for (let a = 0; a < 12; a++) {
      const th = (a / 12) * Math.PI * 2;
      for (let d = STEP; d <= r; d += STEP) {
        const x = p.x + Math.cos(th) * d, z = p.z + Math.sin(th) * d;
        if (Math.abs(x) > E || Math.abs(z) > E) continue;
        const h = t.heightAt(x, z);
        if (h < SEA - 4 && (!best || h < best.h)) best = { x, z, h };
      }
    }
    return best;
  };

  // Scorers return -1 to mean "disqualified". Treating that as a candidate is how
  // an unsatisfiable predicate silently produced a garbage vantage instead of an
  // error, so reject it explicitly and make the failure visible to the caller.
  const pick = (score, label) => {
    let best = null, bs = -Infinity;
    for (const p of pts) {
      const s = score(p);
      if (s > bs && s > -1) { bs = s; best = p; }
    }
    if (!best) console.warn('[framing] no candidate satisfied: ' + label);
    return best;
  };

  const out = {};
  const flat = (p) => 1 - Math.min(1, slopeAt(p.x, p.z) / 0.6);

  // Fixed pitch angles were decapitating the subject: the mountain ran off the
  // top of frame, the Telvanni tower was cropped, and the "high vantage" shot
  // held no horizon at all. Aim at the subject instead and place it deliberately
  // in frame. \`frac\` is where the target should sit vertically, 0 = top edge,
  // 0.5 = centre, 1 = bottom edge.
  const pitchTo = (camX, camZ, camY, tgt, fovDeg, frac) => {
    const d = Math.hypot(tgt.x - camX, tgt.z - camZ);
    const elev = Math.atan2(tgt.y - camY, Math.max(d, 1));
    const vfov = (fovDeg * Math.PI) / 180;
    // Offset from frame centre to the requested fraction, in radians.
    return elev + (frac - 0.5) * vfov;
  };
  const groundY = (x, z) => t.heightAt(x, z);

  // Open ash flat, low and level, with the mountain in view for a silhouette.
  {
    const p = pick((p) => (p.h > SEA + 3 && p.h < q(0.45) ? flat(p) * 2 + (p.m === 0 ? 1.5 : 0) - dist(p, peak) / 4000 : -1), 'ash flat');
    if (p) {
      const camY = p.h + 2.2;
      const tgt = { x: peak.x, z: peak.z, y: peak.h };
      out.dawn = { x: p.x, z: p.z, h: 2.2, yaw: yawTo(p, peak), fov: 62,
                   pitchRad: pitchTo(p.x, p.z, camY, tgt, 62, 0.34) };
      out.ashstorm = { x: p.x, z: p.z, h: 2.2, yaw: yawTo(p, peak), fov: 70,
                       pitchRad: pitchTo(p.x, p.z, camY, tgt, 70, 0.42) };
    }
  }

  // Mid-distance from the summit so the whole cone reads against the sky.
  {
    const p = pick((p) => {
      const d = dist(p, peak);
      if (d < 900 || d > 1700 || p.h < SEA + 2) return -1;
      return flat(p) + (1 - Math.abs(d - 1250) / 700);
    }, 'mountain vista');
    if (p) {
      const camY = p.h + 6;
      // Place the summit 28% down from the top edge so the whole cone plus sky fits.
      out.redmtn = { x: p.x, z: p.z, h: 6, yaw: yawTo(p, peak), fov: 55,
                     pitchRad: pitchTo(p.x, p.z, camY, { x: peak.x, z: peak.z, y: peak.h }, 55, 0.28) };
      // Looking away from the mountain: put the horizon low so the sunset sky dominates.
      const back = { x: p.x - (peak.x - p.x), z: p.z - (peak.z - p.z) };
      out.dusk = { x: p.x, z: p.z, h: 6, yaw: yawTo(p, peak) + Math.PI, fov: 60,
                   pitchRad: pitchTo(p.x, p.z, camY, { x: back.x, z: back.z, y: groundY(back.x, back.z) }, 60, 0.72) };
    }
  }

  // Shoreline: just above sea level with real open water in front of us.
  {
    let best = null, bs = -Infinity;
    for (const p of pts) {
      if (p.h < SEA + 0.5 || p.h > SEA + 6) continue;
      const sea = seaNear(p, 400);
      if (!sea) continue;
      const s = flat(p) * 2 + (-sea.h) / 20;
      if (s > bs) { bs = s; best = { p, sea }; }
    }
    if (best) {
      const camY = best.p.h + 3.0;
      // Aim at open water a good way out so the sea fills the lower half rather
      // than collapsing to a sliver at the horizon.
      const far = { x: best.p.x + (best.sea.x - best.p.x) * 3, z: best.p.z + (best.sea.z - best.p.z) * 3, y: 0 };
      out.coast = { x: best.p.x, z: best.p.z, h: 3.0, yaw: yawTo(best.p, best.sea), fov: 65,
                    pitchRad: pitchTo(best.p.x, best.p.z, camY, far, 65, 0.42) };
      out.storm = { x: best.p.x, z: best.p.z, h: 3.0, yaw: yawTo(best.p, best.sea), fov: 65,
                    pitchRad: pitchTo(best.p.x, best.p.z, camY, far, 65, 0.40) };
      // Night wants sky, but not an empty black lower third — keep the horizon in.
      out.night = { x: best.p.x, z: best.p.z, h: 3.0, yaw: yawTo(best.p, best.sea), fov: 68,
                    pitchRad: pitchTo(best.p.x, best.p.z, camY, far, 68, 0.78) };
      // Sit the camera under the surface, well clear of the bottom.
      const s = best.sea;
      out.underwater = { x: s.x, z: s.z, h: null, absY: Math.max(s.h + 2.5, SEA - 4), yaw: yawTo(s, best.p), pitch: -8, fov: 70 };
    }
  }

  // Sheltered low ground where vegetation should be densest.
  {
    const p = pick((p) => (p.h > SEA + 1 && p.h < q(0.35) ? flat(p) * 2 + (p.m === 3 || p.m === 4 ? 2 : 0) : -1), 'vale');
    if (p) out.vale = { x: p.x, z: p.z, h: 1.8, yaw: yawTo(p, peak), fov: 65,
                        pitchRad: pitchTo(p.x, p.z, p.h + 1.8, { x: peak.x, z: peak.z, y: peak.h }, 65, 0.30) };
  }

  // High shoulder with the summit in view. Aiming at a distant low point put the
  // camera over empty sea with nothing between it and the horizon; the interesting
  // content is the eroded flank BETWEEN the viewer and the peak, so aim at the peak
  // and stand far enough back that the flank fills the lower frame.
  {
    const p = pick((c) => {
      const d = dist(c, peak);
      if (d < 900 || d > 1400) return -1;
      if (c.h < q(0.40)) return -1;              // must genuinely be high ground
      // Reward standing BACK, which the comment above always claimed but the
      // score never implemented: it maximised height alone, so it climbed to the
      // nearest high shoulder inside the 350 m floor and aimed point blank at the
      // peak. Measured from the depth buffer, the resulting frame spanned 15-677 m
      // with 95% of it between 300 and 680 m -- a 380 m slab. This shot's declared
      // intent is terrain LOD, erosion channels and silhouette, and all three need
      // a long sightline; a stage-4 round then burned itself proving aerial
      // perspective cannot show falloff on a frame with no depth to fall off over.
      // Distance is weighted to matter about as much as height so the flank still
      // fills the lower frame rather than the camera fleeing to the 1400 m ceiling.
      return c.h / 1200 + flat(c) * 0.5 + (d / 1400) * 0.8;
    }, 'ridge');
    if (p) {
      out.ridge = { x: p.x, z: p.z, h: 4, yaw: yawTo(p, peak), fov: 55,
                    pitchRad: pitchTo(p.x, p.z, p.h + 4, { x: peak.x, z: peak.z, y: peak.h }, 55, 0.30) };
    }
  }

  return { framing: out, peak: { x: peak.x, z: peak.z, h: peak.h }, extent: E,
           quantiles: { p05: q(0.05), p50: q(0.5), p95: q(0.95), max: q(1) } };
})()
`;
