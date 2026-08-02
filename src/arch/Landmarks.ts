import * as THREE from 'three';
import {
  apertureFrame,
  baseRing,
  glowPanel,
  pushShell,
  type Emitter,
  type Part,
  type Structure,
} from './Buildings';
import { Rng, noise2 } from './Rng';
import { ashMound, bevelBox, buildShell, mergeParts, placed, sweep, type Opening } from './Shapes';

/**
 * LANDMARKS — the silhouettes that say Vvardenfell.
 *
 * The settlement generators in Buildings.ts top out at a 5 m dome. At the
 * distances the game is actually looked at — a ridge 1.5 km away under aerial
 * perspective — a 5 m dome is two pixels and the frame reads as an abstract
 * noise render with no sense of place and, worse, no sense of SCALE: with
 * nothing of known size in shot the viewer cannot tell whether the ridge is
 * 20 m or 2 km out.
 *
 * These are the other end of the scale ladder: 30-130 m structures placed on
 * topographic prominences, authored so their PROFILE survives being reduced to
 * a flat dark shape against the sky. Everything here is judged on the
 * silhouette first and the surface second, because past ~600 m the surface is
 * gone and the silhouette is the entire asset.
 *
 * Both generators take a `ground` callback in structure-local space. Satellite
 * elements — roots, standing stones, gate pylons, rubble — are planted against
 * the real heightfield rather than against y=0, because a landmark spans tens
 * of metres of terrain and anything assuming a flat pad hovers at one end.
 */

const TAU = Math.PI * 2;
const WINDOW_HUE = new THREE.Color(1.0, 0.62, 0.26);
const EMBER_HUE = new THREE.Color(1.0, 0.42, 0.12);

export interface LandmarkSpec {
  seed: number;
  /** Yaw of the principal face, radians. */
  facing: number;
  /** Overall height in metres, pad to highest point. This is the sizing knob. */
  height: number;
  /**
   * Terrain height at a structure-LOCAL (x,z), relative to the pad. Defaults to
   * a flat pad; the system passes the real heightfield.
   *
   * This is the VISIBLE surface — the one the CPU B-spline reports and the one
   * the near camera sees. Anything that must sit ON the ground (an ash bank, a
   * shed heap, a scatter of rubble) rides this.
   */
  ground?: (x: number, z: number) => number;
  /**
   * The LOWEST surface any terrain LOD level draws at this local (x,z), also
   * relative to the pad. See src/arch/Ground.ts.
   *
   * Anything that must be UNDER the ground — a root tip, a leg foot, a pylon
   * base — is driven under this instead, because past a few hundred metres the
   * drawn terrain sags several metres below the surface `ground` reports and a
   * foot buried against the CPU value comes back out into open air. Defaults to
   * `ground`, so a generator called without it behaves exactly as before.
   */
  groundDeep?: (x: number, z: number) => number;
}

type Surface = (u: number, v: number, out: THREE.Vector3) => void;

/**
 * Quarter-resolution shell used past the LOD switch.
 *
 * It takes the same `erode` predicate as the detail shell, which the village
 * proxies do not: a collapsed daedric crown that grows back at 700 m is a
 * silhouette pop, and the silhouette is the only thing a landmark has at that
 * range.
 */
function silhouetteShell(
  surface: Surface,
  nu: number,
  nv: number,
  erode?: (i: number, j: number, u: number, v: number) => boolean,
  shift = 2,
): THREE.BufferGeometry {
  const r = buildShell({
    nu: Math.max(8, nu >> shift),
    nv: Math.max(4, nv >> shift),
    surface,
    thickness: 0.02,
    erode,
  });
  r.inner?.dispose();
  r.reveal?.dispose();
  return r.outer ?? new THREE.BufferGeometry();
}

// ---------------------------------------------------------------- telvanni

/**
 * Telvanni mushroom tower.
 *
 * The single most recognisable object in the province, and the reason this
 * module exists. Three parts carry it, in order of how far away they still
 * read: the overhanging CAP (a wide disc where a roof has no business being),
 * the bulbous PODS hung off the trunk, and the tapering knotted STALK. Get the
 * cap-to-stalk ratio wrong and it is a lighthouse; the cap has to overhang the
 * trunk by a factor of three or more before the eye calls it fungus.
 *
 * The pod windows and the ring of lamps under the cap rim use the shared glow
 * material, which the system gates on the key light's intensity — so at night
 * the tower is a warm focal point against cold ground, and by day it is just
 * geometry.
 */
export function telvanniTower(spec: LandmarkSpec): Structure {
  const rng = new Rng(spec.seed ^ 0x7f4a7c15);
  const ground = spec.ground ?? ((): number => 0);
  // The LOD floor. Every foot that has to be UNDER the surface uses this; every
  // heap that has to sit ON it uses `ground`. See LandmarkSpec.
  const deep = spec.groundDeep ?? ground;
  const H = spec.height;
  const capH = H * rng.range(0.15, 0.20);
  const stalkH = H - capH;
  const Rb = H * rng.range(0.065, 0.085);

  const l1 = rng.range(0.05, 0.10);
  const l2 = rng.range(0.02, 0.05);
  const p1 = rng.range(0, TAU);
  const p2 = rng.range(0, TAU);
  const knots = rng.range(2.6, 4.6);
  const kph = rng.range(0, TAU);
  // Grown, not built: a plumb trunk is the fastest way to read as masonry.
  const lean = rng.range(-0.055, 0.055);

  const nu = 40;
  const nv = 26;

  const stalk: Surface = (u, v, out) => {
    const th = u * TAU;
    const flare = 1.25 * Math.exp(-v * 11);
    const taper = 1 - 0.46 * Math.pow(v, 0.85);
    const knot =
      1 + 0.10 * Math.sin(v * Math.PI * knots + kph) + 0.045 * Math.sin(v * Math.PI * knots * 2.3 - kph);
    const lobe = 1 + l1 * Math.sin(3 * th + p1) + l2 * Math.sin(5 * th + p2);
    const r = Rb * (taper + flare) * knot * lobe;
    const y = stalkH * v;
    out.set(Math.cos(th) * r + (lean * y * y) / stalkH, y, Math.sin(th) * r);
  };
  const axisAt = (y: number): number => (lean * y * y) / stalkH;

  // ---- openings in the trunk ----
  // Order matters: door, then bands, then windows. Later openings overwrite
  // earlier cells, so this is what keeps a recessed band from swallowing a lit
  // window, while leaving the door as hole 0 for the emitter below.
  const thickness = Math.max(0.8, Rb * 0.26);
  const doorU = Math.round(((spec.facing / TAU) * nu + nu) % nu);
  const openings: Opening[] = [];
  openings.push({ u0: doorU - 1, u1: doorU + 2, v0: 0, v1: 2, arch: true });
  // Shallow recessed bands: at 400 m these are the only thing giving the trunk
  // any horizontal read, which is what stops it looking like an extruded cone.
  // Depth stays inside the wall or the panel lands behind the interior shell.
  for (let b = 0, n = rng.int(3, 6); b < n; b++) {
    const uu = rng.int(0, nu - 1);
    const v0 = rng.int(2, nv - 4);
    openings.push({ u0: uu, u1: uu + rng.int(3, 6), v0, v1: v0 + 1, recess: thickness * 0.55 });
  }
  const wins = rng.int(8, 14);
  for (let i = 0; i < wins; i++) {
    const uu = rng.int(0, nu - 1);
    // Never in the top four rows.
    //
    // The trunk runs all the way to `stalkH`, which is INSIDE the cap: the top
    // of the shell is enclosed by the cap's underside. A window cut up there
    // still gets its frame built, and the frame's head slab stands proud of the
    // trunk into the gap between trunk and gills — where it reads, correctly, as
    // "an unattached box protrusion floating off the trunk". It is also a lit
    // aperture nobody can ever see into. Both go away by not cutting one there.
    const v0 = rng.int(3, nv - 6);
    openings.push({ u0: uu, u1: uu + rng.int(1, 2), v0, v1: v0 + 1, arch: true });
  }

  const res = buildShell({ nu, nv, surface: stalk, thickness, openings, floor: true });
  const parts: Part[] = [];
  const proxyParts: Part[] = [];
  const occluders: THREE.Vector4[] = [];
  const frames: THREE.BufferGeometry[] = [];
  pushShell(parts, res, 'fungus', 'fungus');

  const emitters: Emitter[] = [];
  for (let i = 0; i < res.holes.length; i++) {
    const f = res.holes[i];
    if (!f.through) continue;
    // Real frame geometry. Without it the hole is a rectangle cut along cell
    // boundaries and reads as a black decal stuck to a curved hull.
    for (const g of apertureFrame(f, thickness, Math.max(0.20, Rb * 0.038))) frames.push(g);
    // Roughly half the rooms are occupied, and the occupied ones vary. A tower
    // whose every window is at one value reads as a lightbox with holes punched
    // in it; a tower with a scatter of lit and dark rooms reads as inhabited,
    // and at dawn — the hour the review measured — that scatter is the only
    // available cue for the settlement's scale and occupancy.
    const lit = rng.chance(0.55) ? rng.range(0.85, 1.6) : rng.range(0.06, 0.20);
    const panel = glowPanel(f, thickness, Rb * 1.6, i === 0 ? 1.3 : lit);
    parts.push({ key: 'glow', geo: panel });
    proxyParts.push({ key: 'glow', geo: panel.clone() });
    emitters.push({
      pos: new THREE.Vector3().copy(f.center).addScaledVector(f.normal, 0.5),
      kind: 'window',
      range: i === 0 ? 16 : 12,
      hue: WINDOW_HUE,
      power: (i === 0 ? 5.0 : 2.6) * Math.min(1.2, lit + 0.2),
    });
  }

  const silhouette: THREE.BufferGeometry[] = [];
  const lampRing: THREE.Vector3[] = [];
  const bioRing: THREE.Vector3[] = [];
  /** Stations along the spore veins; washed onto the stalk via the `aBio` bake. */
  const veinSources: THREE.Vector3[] = [];
  const tmp = new THREE.Vector3();

  // Trunk occluders: a column of spheres along the axis, so anything hung off
  // the trunk darkens where it tucks against it.
  for (let s = 0; s <= 8; s++) {
    const v = s / 8;
    stalk(0, v, tmp);
    const y = stalkH * v;
    occluders.push(new THREE.Vector4(axisAt(y), y, 0, Math.hypot(tmp.x - axisAt(y), tmp.z) * 1.05));
  }

  // ---- pods ----
  // Hung off the trunk at alternating bearings so the tower is asymmetric from
  // every angle. Each is pushed far enough out to break the trunk's outline and
  // near enough in to interpenetrate it — a pod on a stalk is two objects.
  const podCount = rng.int(3, 5);
  for (let i = 0; i < podCount; i++) {
    const v = 0.30 + (i / podCount) * 0.54 + rng.range(-0.03, 0.03);
    const th = rng.range(0, TAU);
    stalk(th / TAU, v, tmp);
    const cy = stalkH * v;
    const ax = axisAt(cy);
    const rs = Math.hypot(tmp.x - ax, tmp.z);
    const Rp = H * rng.range(0.085, 0.130);
    // Taller than wide. At 1.05 the pods came out oblate and, with a band of
    // windows round the equator, read as stacked flying saucers rather than as
    // grown bulbs — the one thing that can make a Telvanni tower look sci-fi.
    const podH = Rp * rng.range(1.55, 2.05);
    const d = rs * 0.55 + Rp * 0.42;
    const cx = ax + Math.cos(th) * d;
    const cz = Math.sin(th) * d;
    const pph = rng.range(0, TAU);

    const podSurf: Surface = (u2, v2, o) => {
      const t2 = u2 * TAU;
      const s = Math.sin(Math.PI * v2);
      const r =
        Rp * Math.pow(s, 0.6) * (1 + 0.09 * Math.sin(3 * t2 + pph) + 0.05 * Math.sin(5 * t2 - pph));
      o.set(cx + Math.cos(t2) * r, cy - Math.cos(Math.PI * v2) * podH * 0.5, cz + Math.sin(t2) * r);
    };

    const pnu = 32;
    const pnv = 18;
    const oU = Math.round(((th / TAU) * pnu + pnu) % pnu);
    const pOpen: Opening[] = [];
    // A ring of shallow growth grooves round the pod's waist. They are cheap,
    // they survive the mid LOD, and they are what keeps the bulb from reading
    // as a blown egg once the texture has mipped away.
    const pth = Math.max(0.7, Rp * 0.13);
    for (let b = 0, bn = rng.int(2, 4); b < bn; b++) {
      const v0 = 3 + b * 3 + rng.int(0, 2);
      if (v0 + 1 >= pnv) break;
      pOpen.push({ u0: 0, u1: pnu, v0, v1: v0 + 1, recess: pth * 0.34 });
    }
    const wn = rng.int(3, 5);
    for (let w = 0; w < wn; w++) {
      const uu = oU + Math.round((w - (wn - 1) / 2) * 4);
      const v0 = rng.int(6, 10);
      pOpen.push({ u0: uu, u1: uu + 2, v0, v1: v0 + rng.int(2, 3), arch: true });
    }
    const pres = buildShell({ nu: pnu, nv: pnv, surface: podSurf, thickness: pth, openings: pOpen });
    pushShell(parts, pres, 'shell', 'shell');
    for (const f of pres.holes) {
      if (!f.through) continue;
      for (const g of apertureFrame(f, pth, Math.max(0.20, Rp * 0.032))) frames.push(g);
      const plit = rng.chance(0.55) ? rng.range(0.85, 1.6) : rng.range(0.06, 0.20);
      const panel = glowPanel(f, pth, Rp, plit);
      parts.push({ key: 'glow', geo: panel });
      // Emissives are the cheapest silhouette-scale cue there is, and the one
      // thing a 90 px pod on the horizon can still show. They survive the LOD
      // switch rather than popping out at it.
      proxyParts.push({ key: 'glow', geo: panel.clone() });
      emitters.push({
        pos: new THREE.Vector3().copy(f.center).addScaledVector(f.normal, 0.5),
        kind: 'window',
        range: 18,
        hue: WINDOW_HUE,
        power: 3.2,
      });
    }

    // Brackets: three short struts from the trunk into the pod's underside.
    // They give the join a mechanical read, they carry scale (a strut is
    // person-sized), and they stop the pod looking stuck on with glue.
    {
      const axC = new THREE.Vector3(ax, cy, 0);
      const brack: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 3; k++) {
        const bt = th + (k - 1) * 0.42;
        const drop = podH * (0.20 + 0.10 * k);
        const from = new THREE.Vector3(
          axC.x + Math.cos(bt) * rs * 0.92,
          cy - drop * 1.15,
          Math.sin(bt) * rs * 0.92,
        );
        const to = new THREE.Vector3(
          cx + Math.cos(bt) * Rp * 0.62,
          cy - podH * 0.30,
          cz + Math.sin(bt) * Rp * 0.62,
        );
        const mid = new THREE.Vector3().lerpVectors(from, to, 0.5).addScaledVector(new THREE.Vector3(0, -1, 0), Rp * 0.16);
        brack.push(sweep([from, mid, to], [Rp * 0.10, Rp * 0.075, Rp * 0.055], 6, rng.jitter(0.3)));
      }
      const bg = mergeParts(brack);
      if (bg) parts.push({ key: 'fungus', geo: bg });
    }

    occluders.push(new THREE.Vector4(cx, cy, cz, Rp * 0.95));
    const podProxy = silhouetteShell(podSurf, pnu, pnv, undefined, 1);
    silhouette.push(podProxy.clone());
    proxyParts.push({ key: 'shell', geo: podProxy });
  }

  // ---- cap ----
  // Two arcs meeting at a hard rim: underside from the trunk out to the rim,
  // crown from the rim up to the apex. The crease at the rim is deliberate —
  // a smooth blend there turns the mushroom back into an onion dome.
  const Rc = H * rng.range(0.17, 0.23);
  const drop = capH * 0.42;
  const gillN = rng.int(11, 17);
  const capAx = axisAt(stalkH);
  /**
   * Six u-cells per gill, always — not a fixed 56.
   *
   * This is the whole of the "gill panels are hard-faceted quads with no
   * smoothed normals" and "the cap rim is visibly faceted rather than
   * elliptical" blockers, and it was an aliasing bug rather than a shading one.
   * The corrugation below is `sin(gillN * th)`; at nu = 56 with up to 22 gills
   * the surface was sampled 2.5 times per PERIOD, which is under Nyquist. The
   * mesh that came out was a random zigzag with no relationship to the flutes,
   * the analytic central-difference normal was measuring that zigzag, and the
   * rim — where the corrugation was deepest — swung +/- 2.7 m between adjacent
   * columns, which is exactly the "silhouette chewed ragged" the review
   * measured from a second vantage.
   *
   * Six samples a period resolves the crest, the trough and both flanks. nv
   * comes down two rows to pay for most of it.
   */
  const cnu = gillN * 6;
  const cnv = 16;
  const capSurf: Surface = (u, v, out) => {
    const th = u * TAU;
    const lobe = 1 + 0.045 * Math.sin(4 * th + p1) + 0.03 * Math.sin(7 * th - p2);
    let r: number;
    let y: number;
    const vr = 0.34;
    if (v <= vr) {
      const t = v / vr;
      r = Rc * Math.pow(t, 0.42) * lobe;
      // Radial gills, cheap: a corrugation in y that only exists underneath.
      //
      // 0.11 of Rc, not 0.035. At 3.5% of the cap radius the corrugation was a
      // few centimetres on a 25 m disc — under a pixel from anywhere the tower
      // is ever framed, which is why the review found "no gill structure on the
      // underside" while the code plainly had some. At 11% the flutes are
      // knee-deep, they catch the lamp ring hanging inside them, and they are
      // the single cue that separates a mushroom from an onion dome when the
      // cap is read from below.
      //
      // Faded OUT at the rim, not ramped in to full depth there. The rim crease
      // is the one closed curve on the asset that is read directly as the
      // silhouette against the sky, and a corrugation carried right onto it
      // makes it a saw blade rather than an ellipse. The flutes are deepest at
      // two thirds of the radius, where they are seen from below and where the
      // lamp ring hangs inside them, and they close to nothing at the edge.
      const gill = t * (1 - Math.pow(t, 5));
      y = stalkH - drop * (0.6 * t * t + 0.4 * t) + 0.155 * Rc * Math.sin(gillN * th) * gill;
    } else {
      const t = (v - vr) / (1 - vr);
      r = Rc * Math.pow(Math.max(0, 1 - Math.pow(t, 1.8)), 0.5) * lobe;
      y = stalkH - drop + (drop + capH * 0.9) * Math.pow(t, 0.8);
    }
    out.set(capAx + Math.cos(th) * r, y, Math.sin(th) * r);
  };
  const capThick = Math.min(0.9, Rc * 0.06);
  const capRes = buildShell({ nu: cnu, nv: cnv, surface: capSurf, thickness: capThick });
  pushShell(parts, capRes, 'cap', 'cap');
  occluders.push(new THREE.Vector4(capAx, stalkH - drop * 0.2, 0, Rc * 0.62));

  // ---- radial gill ribs under the cap ----
  // The corrugation baked into `capSurf` is a few centimetres and vanishes past
  // a couple of hundred metres. Actual ribs from the rim in to the stalk hold
  // the underside's read, catch the bounce off the pods below, and are the one
  // place a mushroom's identity lives if the silhouette is ambiguous.
  // One rib per corrugation crest, not half as many: an odd count against the
  // baked flutes put half the ribs in the troughs, which cancelled the relief
  // instead of doubling it. They also hang lower (0.05 Rc) so they break the
  // underside's own shadow line rather than lying flush inside it.
  {
    const ribs: THREE.BufferGeometry[] = [];
    const n = gillN;
    for (let i = 0; i < n; i++) {
      // Phase-locked to sin(gillN * th) so each rib sits on a crest.
      const th = ((i + 0.25) / n) * TAU;
      const path: THREE.Vector3[] = [];
      const radii: number[] = [];
      const steps = 5;
      for (let s = 0; s <= steps; s++) {
        const v = 0.02 + (s / steps) * 0.30;
        capSurf(th / TAU, v, tmp);
        path.push(new THREE.Vector3(tmp.x, tmp.y - Rc * 0.05 * (0.3 + 0.7 * (s / steps)), tmp.z));
        radii.push(Rc * (0.014 + 0.026 * (s / steps)));
      }
      ribs.push(sweep(path, radii, 5));
    }
    const rg = mergeParts(ribs);
    if (rg) parts.push({ key: 'cap', geo: rg });
  }

  // ---- lamp ring under the rim ----
  // The night focal point. A ring rather than a point because it has to survive
  // being one pixel tall: a horizontal line of emissive holds up where a dot
  // dissolves into the sky.
  const ringR = Rc * 0.78;
  const ringY = stalkH - drop * 0.86;
  {
    // 56 stations and 8 sides, not 28 and 5.
    //
    // This is the only closed circle in the whole asset and it is seen edge-on
    // against the sky, so its tessellation is read directly as a silhouette: at
    // 28x5 the review measured it as a visibly faceted polygon on a landmark
    // that is otherwise all curves. A tube this thin costs ~900 triangles at
    // double the resolution, which is under one percent of the tower.
    const segs = 56;
    const path: THREE.Vector3[] = [];
    const radii: number[] = [];
    for (let s = 0; s <= segs; s++) {
      const th = (s / segs) * TAU;
      path.push(new THREE.Vector3(capAx + Math.cos(th) * ringR, ringY, Math.sin(th) * ringR));
      // Rc*0.016, not Rc*0.030.
      //
      // At 3% of a 22 m cap this was a 1.3 m-diameter tube of emissive, which at
      // the hero framing is a TEN PIXEL wide band held above the display range
      // for its whole length. Measured at dusk it clipped to (242,235,227) —
      // neutral white, no hue left at all, on the object that is supposed to be
      // carrying the one saturated accent the palette allows. A ring of lamps
      // under a parasol is a thin line of small sources; the light it throws is
      // the baked spill below, not the width of the tube.
      radii.push(Math.max(0.11, Rc * 0.016));
    }
    const ringGeo = sweep(path, radii, 8);
    parts.push({ key: 'glow', geo: ringGeo });
    proxyParts.push({ key: 'glow', geo: ringGeo.clone() });
    emitters.push({
      pos: new THREE.Vector3(capAx, ringY, 0),
      kind: 'window',
      range: 40,
      hue: WINDOW_HUE,
      power: 8,
    });
    // The ring is a tube light, so it has to be baked as one: a single source at
    // its centre lights nothing under the cap it encircles. Twelve stations
    // round the ring put the wash on the gills where it belongs.
    for (let s = 0; s < 12; s++) {
      const t2 = (s / 12) * TAU;
      lampRing.push(new THREE.Vector3(capAx + Math.cos(t2) * ringR, ringY, Math.sin(t2) * ringR));
    }
  }

  // ---- bioluminescent spore veins ----
  //
  // The review's redmtn note is the one to answer here: at hour 10 the tower
  // sat "at the same luminance and hue as the mountain directly behind it", so
  // the best silhouette in the game was invisible. Every emissive the asset had
  // was a LAMP, and lamps are gated off in daylight — correctly, but that left
  // the tower with nothing to separate it from a rock face at the same depth.
  //
  // Fungal bioluminescence is not gated (see the 'bio' MatKey). Two forms, both
  // chosen because they survive being ONE PIXEL WIDE, which is the state this
  // detail spends most of its life in:
  //
  //  - a continuous ring following the cap's outer rim. A closed curve seen
  //    edge-on stays a connected bright line at any distance; a ring of
  //    discrete bulbs would dissolve into aliasing well before a kilometre.
  //  - veins up the stalk. Same argument, rotated 90 degrees: a long line
  //    holds where a dot does not, and it gives the trunk a vertical read that
  //    survives after the bark texture has gone.
  {
    const bio: THREE.BufferGeometry[] = [];
    const rimTube = Math.max(0.20, Rc * 0.015);
    const rimSegs = 56;
    {
      const path: THREE.Vector3[] = [];
      const radii: number[] = [];
      for (let s = 0; s <= rimSegs; s++) {
        const th = (s / rimSegs) * TAU;
        const lobe = 1 + 0.045 * Math.sin(4 * th + p1) + 0.03 * Math.sin(7 * th - p2);
        // Just inside and just under the rim crease, so it lights the gills and
        // outlines the cap without standing proud of the silhouette.
        path.push(
          new THREE.Vector3(
            capAx + Math.cos(th) * Rc * lobe * 0.97,
            stalkH - drop + rimTube * 0.6,
            Math.sin(th) * Rc * lobe * 0.97,
          ),
        );
        // Radius swells and thins around the rim. A constant-section tube under
        // a dash mask reads as a stroked dashed line — which is exactly the
        // review's word for it — because every mark is the same weight. Varying
        // the section makes the bright patches differ in thickness as well as in
        // length, and it is also what stops the whole ring dropping under a
        // pixel at once when the tower goes distant.
        radii.push(rimTube * (0.72 + 0.85 * (0.5 + 0.5 * Math.sin(th * 5.0 + p2 * 1.7))));
      }
      // 10 sides, not 6: this is the most-looked-at emissive in the game and it
      // is read against the sky, where a hexagonal tube shows its facets.
      bio.push(sweep(path, radii, 10));
    }
    // ---- spore veins up the stalk ----
    //
    // These are NOT geometry any more, and that is the fix for the blocker.
    //
    // They used to be emissive tubes swept up the trunk. Three iterations of
    // review called the same artefact three different things — "a degenerate
    // emissive sliver", "a z-fighting decal edge", and now "a stretched
    // emissive texel smeared vertically down the trunk, a hard-edged 2-4px teal
    // line" — because the artefact is inherent to the form, not to the tuning.
    // A tube one metre across on a hundred-metre tower is two to four pixels at
    // every distance the asset is ever framed at, it is held at a radiance well
    // over the display range so its core clips, and its cross-section falls off
    // over less than a pixel, so no amount of soft-edge or dash shaping can
    // stop it rasterising as a hard-cored line. A line that hard, that
    // saturated and that thin does not read as light on a surface; it reads as
    // a stroke laid over one, and the reviewer read it — reasonably — as a
    // stretched texel from a broken unwrap.
    //
    // Fungal bioluminescence under a skin is a WASH on the skin, so it is baked
    // as one: each vein path becomes a line of ungated `bio` sources, and
    // `bakeBio` writes the irradiance into the trunk's own `aBio` attribute.
    // The stalk shell then glows cyan along the vein with the falloff its own
    // curvature gives it — no sub-pixel geometry, no clipped core, no aliasing,
    // nothing to z-fight with, and about two thousand triangles a tower cheaper
    // than the tubes it replaces.
    const veins = rng.int(2, 3);
    for (let i = 0; i < veins; i++) {
      const th0 = rng.range(0, TAU);
      // A wander, not a spiral and not a plumb line.
      //
      // At a full radian of drift over nine stations the tube's own frame swung
      // faster than the trunk curved and the result was a lightning bolt stuck
      // to the side of the tower. At a third of a radian — the previous
      // setting — the opposite happened: on a near-vertical trunk the vein
      // projected to a dead-straight vertical, which is what the review read as
      // "a degenerate emissive sliver or a z-fighting decal edge". A vein has to
      // meander enough that it is legibly ON something.
      const drift = rng.range(-0.9, 0.9) + (rng.chance(0.5) ? 0.55 : -0.55);
      // Stations every ~4% of the stalk. Closer than the shell's own v spacing,
      // so the baked wash is a continuous run rather than a string of beads.
      const steps = 24;
      for (let s = 0; s <= steps; s++) {
        const v = 0.12 + (s / steps) * 0.80;
        const th = th0 + drift * v + 0.16 * Math.sin(v * 5.3 + th0) + 0.07 * Math.sin(v * 11.0 - th0);
        stalk(th / TAU, v, tmp);
        // Just INSIDE the skin. A source outside it lights the far lip of every
        // knot as well as the near one and the wash loses its direction.
        veinSources.push(new THREE.Vector3(tmp.x * 0.94, tmp.y, tmp.z * 0.94));
      }
    }
    const bg = mergeParts(bio);
    if (bg) {
      parts.push({ key: 'bio', geo: bg });
      // Survives the LOD switch with the geometry. This is the detail that is
      // doing the most work at exactly the range the mid level covers.
      proxyParts.push({ key: 'bio', geo: bg.clone() });
    }
    // The rim is a tube light and has to be baked as one: sixteen stations round
    // it, reaching far enough to cross the gills above and reach the nearest pod
    // below. A single source at the cap's centre lights neither.
    //
    // This channel is NOT the lamp channel. It is written to `aBio`, which the
    // shader adds without the night gate, because the review's complaint at
    // dusk was that the brightest object in the frame put no light on the
    // surface two metres above it — and gating that on the clock would have
    // fixed it for exactly one hour of the day.
    for (let s = 0; s < 16; s++) {
      const t2 = (s / 16) * TAU;
      bioRing.push(new THREE.Vector3(capAx + Math.cos(t2) * Rc * 0.94, stalkH - drop + 0.4, Math.sin(t2) * Rc * 0.94));
    }
    // One real point light at the rim, ungated. Cyan is the only chroma in the
    // palette nothing else can produce, so a metre of spill from it on the
    // stalk and the nearest pod is worth a pool slot whenever the camera is
    // close enough for the pool to matter at all.
    emitters.push({
      pos: new THREE.Vector3(capAx, stalkH - drop + 0.4, 0),
      kind: 'bio',
      range: Math.max(14, Rc * 1.5),
      hue: new THREE.Color(0x3fd6c0),
      power: 3.0,
    });
  }

  // ---- roots ----
  // Ground contact, and the detail that reads from the near plane. The tips are
  // driven UNDER the sampled terrain, so no root ever ends in mid-air on a slope.
  const rootGeo: THREE.BufferGeometry[] = [];
  /** Per-support ash banks. Kept apart so they get the `ash` material. */
  const ashParts: THREE.BufferGeometry[] = [];
  /** Cheap root silhouettes for the mid LOD. See the note at the sweep below. */
  const rootProxy: THREE.BufferGeometry[] = [];
  const roots = rng.int(6, 9);
  const rFoot = Rb * 2.25;
  for (let i = 0; i < roots; i++) {
    const th = (i / roots) * TAU + rng.jitter(0.22);
    const vTop = rng.range(0.06, 0.13);
    stalk(th / TAU, vTop, tmp);
    const top = tmp.clone();
    const reach = rFoot * rng.range(0.5, 1.15);
    const dx = Math.cos(th);
    const dz = Math.sin(th);
    const at = (k: number): THREE.Vector3 => {
      const r = rFoot + reach * k;
      return new THREE.Vector3(dx * r, 0, dz * r);
    };
    // Monotone climb from a buried tip up into the trunk.
    //
    // The previous path ended with two stations at almost the same XZ and
    // different Y, so the sweep's frame flipped through vertical on the last
    // segment and its end cap — a disc as wide as the root is thick — stood up
    // as a flat pale plate leaning against the trunk. Every station now advances
    // in XZ, and the last one is INSIDE the trunk, so the cap never shows.
    //
    // Seven stations and twelve sides, not four and eight. A root here is three
    // metres thick and twenty long, so at four stations the middle twelve metres
    // were a single straight prism and at eight sides its facets were 1.2 m
    // across — which is exactly the "flat slabs with hard faceting seams down
    // the taper" the review measured. The cost is ~400 triangles a root.
    // Eleven stations, not seven.
    //
    // The path rides `ground` and the sweep joins consecutive stations with a
    // straight chord, so on a slope the chord cuts the CORD of the terrain arc
    // and the root's belly lifts clear of it between samples. At seven stations
    // over a twenty-metre reach that is a three-metre sample spacing and on the
    // volcanic flanks the belly stood a metre or more proud — which is most of
    // why the review measured "tapered legs that narrow to needle points and
    // terminate in midair against the cliff face".
    const STATIONS = 11;
    const path: THREE.Vector3[] = [];
    const radii: number[] = [];
    for (let s = 0; s < STATIONS; s++) {
      const k = s / (STATIONS - 1);
      if (k >= 0.999) {
        // Last station inside the trunk, so no end cap is ever visible.
        path.push(new THREE.Vector3(top.x * 0.84, top.y * 0.70, top.z * 0.84));
        radii.push(Rb * 0.32);
        break;
      }
      // Reversed parameter: k=0 is the buried tip, k=1 the trunk.
      const q = at(1.0 - k);
      // Ride the real ground and climb out of it near the trunk, so the root is
      // buried at the tip and shoulders clear where it meets the flare.
      //
      // -1.35 Rb at the tip, not -0.5. The tip is the thinnest part of the root
      // and the part standing furthest down a slope, so it is the one the eye
      // checks for contact; at half a trunk-radius of burial a chord error or a
      // heightfield LOD difference of a metre puts it back in the air. Driving
      // it a full trunk-radius and a third under costs nothing — it is
      // invisible by construction — and makes "in the ground" true with margin
      // rather than exactly.
      //
      // Measured against the LOD FLOOR, not against `ground`. Burial depth is
      // the one quantity in this asset that has to be true at every viewing
      // distance, and `ground` is only true at the near one: at 900 m the
      // terrain the camera sees is drawn from a 7.8 m lattice and sits metres
      // below the CPU surface, so a tip a trunk-radius under `ground` is a tip
      // hanging a trunk-radius over open air. That is the "legs ending in empty
      // space" blocker, and it is not fixed by burying deeper against the wrong
      // surface — the tower on the summit shoulder needed ten metres.
      const rise = Rb * (-1.35 + 1.9 * k * k);
      const base = k < 0.55 ? Math.min(deep(q.x, q.z), ground(q.x, q.z)) : ground(q.x, q.z);
      path.push(new THREE.Vector3(q.x, base + rise, q.z));
      // Smooth power taper rather than four hand-picked radii: the visible
      // steps between stations are what made it read as stacked slabs.
      //
      // The floor is 0.14 Rb rather than 0.05: a root that tapers to a needle
      // reads as a spider leg touching down on a point, and a buttress that
      // carries a hundred-metre organism does not end in a spike. It is over a
      // metre thick where it enters the ground, which is what makes the entry
      // read as an entry.
      radii.push(Rb * (0.14 + 0.24 * Math.pow(k, 1.35)));
    }
    rootGeo.push(sweep(path, radii, 12, rng.jitter(0.3)));
    // The SAME root, at five sides and every other station, for the mid LOD.
    //
    // Without this the proxy was a trunk that stopped dead at its base ring:
    // every root vanished at the LOD switch, which for a 110 m tower is 880 m —
    // exactly the range the review is looking at. The tower had real contact up
    // close and none at all in the frames anyone complained about, which is why
    // burying the tips deeper never moved the needle. ~50 triangles a root.
    {
      const pp: THREE.Vector3[] = [];
      const pr: number[] = [];
      for (let s2 = 0; s2 < path.length; s2 += 2) {
        pp.push(path[s2]);
        pr.push(radii[s2]);
      }
      const last = path.length - 1;
      if ((last & 1) === 1) {
        pp.push(path[last]);
        pr.push(radii[last]);
      }
      if (pp.length >= 2) rootProxy.push(sweep(pp, pr, 5, rng.jitter(0.3)));
    }

    // A shed skirt at the root's own entry point.
    //
    // Contact is not just "the geometry reaches the surface" — it is a change of
    // material where the two meet. The plinth's rubble ring only covers the
    // trunk's own footprint, so a root running fifteen metres downhill entered
    // bare ground with a clean silhouette edge and nothing to break it. A low
    // heap of shed matter at the entry gives the junction an occluded corner for
    // the AO bake to find and a scatter for the eye to read as buried.
    //
    // ASH FIRST, then the shed stone. The heap of debris is a near-field detail
    // — twelve stones a metre across, gone by 200 m — and the review's complaint
    // is about a silhouette at a kilometre. What survives that far is the BANK:
    // a broad low mound of drift piled where the root goes in, in a different
    // material from the root, wide enough to be several pixels at range. Ash has
    // had an era to pile against these.
    {
      const q = at(1.0);
      const entry = at(0.86);
      ashParts.push(
        ashMound(entry.x, entry.z, ground, {
          radius: Rb * rng.range(1.5, 2.4),
          height: Rb * rng.range(0.40, 0.70),
          seed: (spec.seed + i * 37) % 499,
          deep,
        }),
      );
      const s0 = Rb * 0.34;
      for (let m = 0; m < 3; m++) {
        const a2 = th + rng.jitter(0.5);
        const d2 = rFoot * rng.range(0.12, 0.34) + reach * 0.05;
        const cx = q.x + Math.cos(a2) * d2;
        const cz = q.z + Math.sin(a2) * d2;
        rootGeo.push(
          placed(
            bevelBox(s0 * rng.range(0.9, 1.9), s0 * rng.range(0.5, 1.0), s0 * rng.range(0.9, 1.7), s0 * 0.16),
            new THREE.Vector3(cx, ground(cx, cz) - s0 * rng.range(0.1, 0.4), cz),
            new THREE.Quaternion().setFromEuler(
              new THREE.Euler(rng.range(-0.4, 0.4), rng.range(0, TAU), rng.range(-0.4, 0.4)),
            ),
          ),
        );
      }
    }
  }
  const roots2 = mergeParts(rootGeo);
  if (roots2) parts.push({ key: 'fungus', geo: roots2 });
  const rootAsh = mergeParts(ashParts);
  if (rootAsh) {
    parts.push({ key: 'ash', geo: rootAsh });
    // The banks are already ten quads apiece, so the mid level takes them
    // unchanged: at 900 m the ash collar round a root IS the contact cue, and
    // it costs less than the silhouette it proves.
    proxyParts.push({ key: 'ash', geo: rootAsh.clone() });
  }
  const rootsProxyGeo = mergeParts(rootProxy);
  if (rootsProxyGeo) {
    proxyParts.push({ key: 'fungus', geo: rootsProxyGeo });
    silhouette.push(rootsProxyGeo.clone());
  }

  const frameGeo = mergeParts(frames);
  if (frameGeo) parts.push({ key: 'shell', geo: frameGeo });

  // Mid LOD at half resolution, not a quarter.
  //
  // The old proxy was four smoothed metaballs and a disc: a 26-cell pod dropped
  // to 6 cells is a capsule, which is precisely the "inflatable" the review
  // rejected — and at 900 m these towers are still 300 px tall. Half resolution
  // costs four times nothing and keeps the pod grooves, the cap rim and the
  // knotted trunk, which is everything the silhouette is made of.
  const stalkProxy = silhouetteShell(stalk, nu, nv, undefined, 1);
  const capProxy = silhouetteShell(capSurf, cnu, cnv, undefined, 1);
  silhouette.push(stalkProxy.clone(), capProxy.clone());
  proxyParts.push({ key: 'fungus', geo: stalkProxy }, { key: 'cap', geo: capProxy });

  // Tight: the ring lights the gills it hangs under, not the whole cap. At a
  // metre and a half of reach per lamp the wash is a band under the rim, which
  // is what a ring of lamps actually does.
  // Rc*0.85, not Rc*0.42.
  //
  // At 0.42 the lamp wash died 5 m from a ring hanging under a 25 m cap, so the
  // gills directly above it — the surface the review measured as "flat dark
  // brown with no falloff gradient" — were outside the reach of every source
  // that was supposed to light them. A ring of lamps under a parasol lights the
  // whole underside of the parasol; that is what a parasol is for.
  const spill = lampRing.map((p) => ({ pos: p, range: Rc * 0.85, power: 1.3 }));
  // Rim ring plus the spore veins. The veins are close-range and weak on
  // purpose: what has to read is a soft cyan run under the bark, wide enough
  // that it never resolves to a line, not a filament laid on top of it.
  const bioSpill = [
    ...bioRing.map((p) => ({ pos: p, range: Rc * 1.05, power: 1.2 })),
    ...veinSources.map((p) => ({ pos: p, range: Math.max(2.4, Rb * 0.45), power: 0.5 })),
  ];

  return {
    parts,
    ring: baseRing(stalk, nu),
    emitters,
    radius: Rc * 1.1,
    height: H,
    proxy: mergeParts(silhouette) ?? new THREE.BufferGeometry(),
    proxyKey: 'fungus',
    proxyParts,
    occluders,
    spill,
    bio: bioSpill,
  };
}

// ---------------------------------------------------------------- dwemer

/**
 * A fallen Dwemer machine, half swallowed by the ash.
 *
 * The third silhouette Vvardenfell is made of, and the only METAL in the world.
 * Everything else here is stone, plaster or grown tissue and shades like a
 * dielectric; this is the one asset whose whole job is to prove the pipeline can
 * tell a metal from a rock — coloured specular, edge wear where the ash cannot
 * hold, verdigris in the crevices.
 *
 * It is authored as a WRECK, not as a building, because a toppled machine gives
 * three things a standing tower cannot: a horizontal mass in a world of vertical
 * ones, a fracture at the break that reads as story, and a genuine reason for a
 * rubble skirt where it entered the ground.
 *
 * The detail budget goes, in order: the fluted drum's silhouette; the fracture;
 * the greeble layer (rivets, pipe runs, cog housings) at panel scale, which is
 * what separates a finished asset from a blockout; the forge vents.
 */
export function dwemerRuin(spec: LandmarkSpec): Structure {
  const rng = new Rng(spec.seed ^ 0x51d4b3af);
  const ground = spec.ground ?? ((): number => 0);
  // The LOD floor. Every foot that has to be UNDER the surface uses this; every
  // heap that has to sit ON it uses `ground`. See LandmarkSpec.
  const deep = spec.groundDeep ?? ground;
  const H = spec.height;
  // A wreck lies down. Length is the sizing dimension and `height` is read as
  // the crown the planner wants to see against the sky, so the drum is long and
  // its far end is lifted.
  const R = H * rng.range(0.34, 0.46);
  const L = H * rng.range(1.7, 2.2);
  // Shallow. A steeply cocked drum cantilevers its whole length over whatever is
  // standing next to it, and since these are placed by view-cone coverage they
  // routinely land within a hundred metres of a walkable vantage — where a
  // raked hull becomes a ceiling and its struts read as debris hanging in the
  // sky. Half-buried and barely lifted is both safer at any framing and the
  // silhouette the brief actually asks for.
  const pitch = rng.range(0.16, 0.28);
  const yaw = spec.facing;

  // Axis frame. The buried end sits below the pad; the far end is what breaks
  // the skyline.
  const ax = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
  const rt = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
  const bi = new THREE.Vector3().crossVectors(ax, rt).normalize();
  const base = new THREE.Vector3(-ax.x * L * 0.18, -R * 0.62, -ax.z * L * 0.18);

  const flutes = rng.int(12, 20);
  const bands = rng.int(3, 5);
  const nu = 48;
  const nv = 26;

  const drum: Surface = (u, v, out) => {
    const th = u * TAU;
    // Fluting is the Dwemer read at silhouette scale and it is also what gives
    // the metal something for a specular to run along.
    const flute = 1 + 0.045 * Math.cos(th * flutes);
    // Banded collars, and a taper into the far cap.
    const band = 1 + 0.075 * Math.cos(v * Math.PI * bands * 2.0);
    const cap = 1 - 0.30 * Math.pow(Math.max(0, (v - 0.86) / 0.14), 1.6);
    const r = R * flute * band * cap;
    const a = L * v;
    out.set(
      base.x + ax.x * a + (rt.x * Math.cos(th) + bi.x * Math.sin(th)) * r,
      base.y + ax.y * a + (rt.y * Math.cos(th) + bi.y * Math.sin(th)) * r,
      base.z + ax.z * a + (rt.z * Math.cos(th) + bi.z * Math.sin(th)) * r,
    );
  };

  // ---- fracture -------------------------------------------------------------
  // A clean cylindrical end is a pipe. The break is a jagged crown plus a torn
  // gash along one flank, both noise-driven, so no two wrecks part the same way.
  const fSeed = rng.range(0, 100);
  const breakV = (u: number): number =>
    0.80 + 0.20 * noise2(u * 3.1 + fSeed, fSeed) - 0.14 * noise2(u * 7.7 - fSeed, fSeed * 0.5);
  const gashU = rng.next();
  const gashW = rng.range(0.05, 0.11);
  const gashHi = rng.range(0.52, 0.78);
  const gashLo = rng.range(0.20, 0.36);
  const erode = (_i: number, _j: number, u: number, v: number): boolean => {
    if (v > breakV(u)) return true;
    const du = Math.abs(((u - gashU + 1.5) % 1) - 0.5);
    return du < gashW * (0.5 + noise2(v * 6.0 + fSeed, fSeed)) && v > gashLo && v < gashHi;
  };

  // ---- hull panels ----------------------------------------------------------
  // Deliberately at MANY sizes. Three repeated rectangles is the tell that says
  // blockout; real machinery is a hierarchy of plate, hatch and inspection port.
  const thickness = Math.max(0.5, R * 0.13);
  const openings: Opening[] = [];
  for (let b = 0; b < bands + 3; b++) {
    const v0 = 2 + Math.round((b / (bands + 3)) * (nv - 6));
    const rows = rng.int(1, 4);
    let u0 = rng.int(0, nu - 1);
    for (let k = 0, n = rng.int(3, 7); k < n; k++) {
      const w = rng.int(2, 7);
      openings.push({ u0, u1: u0 + w, v0, v1: v0 + rows, recess: thickness * rng.range(0.30, 0.75) });
      u0 += w + rng.int(1, 3);
    }
  }
  // Forge vents: real holes, with a glow panel behind them.
  const vents = rng.int(2, 4);
  for (let i = 0; i < vents; i++) {
    const uu = rng.int(0, nu - 1);
    const v0 = rng.int(4, nv - 6);
    openings.push({ u0: uu, u1: uu + rng.int(1, 3), v0, v1: v0 + rng.int(1, 2) });
  }

  const res = buildShell({ nu, nv, surface: drum, thickness, openings, flat: true, erode });
  const parts: Part[] = [];
  pushShell(parts, res, 'bronze', 'bronze');

  const emitters: Emitter[] = [];
  const bronze: THREE.BufferGeometry[] = [];
  const stone: THREE.BufferGeometry[] = [];
  /** Per-support ash banks; see ashMound. */
  const ashParts: THREE.BufferGeometry[] = [];
  const silhouette: THREE.BufferGeometry[] = [];
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  for (const f of res.holes) {
    if (!f.through) continue;
    for (const g of apertureFrame(f, thickness, Math.max(0.16, R * 0.05))) bronze.push(g);
    parts.push({ key: 'glowFire', geo: glowPanel(f, thickness, R) });
    emitters.push({
      pos: new THREE.Vector3().copy(f.center).addScaledVector(f.normal, 0.6),
      kind: 'brazier',
      range: Math.max(12, R * 2.4),
      hue: EMBER_HUE,
      power: 5.5,
    });
  }

  // ---- greebles -------------------------------------------------------------
  //
  // The layer the review found missing. Every one of these is sized at PANEL
  // scale — a rivet you could put a hand on, a pipe you could stand under —
  // because that is the scale that carries the sense of a machine, and it is
  // also the scale that still catches a highlight at two hundred metres.
  const at = (u: number, v: number, off: number, o: THREE.Vector3): THREE.Vector3 => {
    drum(u, v, o);
    // Outward from the axis, not from the origin: the drum is lying down.
    const a = L * v;
    tmp2.set(base.x + ax.x * a, base.y + ax.y * a, base.z + ax.z * a);
    const dir = o.clone().sub(tmp2).normalize();
    return o.addScaledVector(dir, off);
  };

  // Rivet rows along every band collar.
  {
    const riv: THREE.BufferGeometry[] = [];
    const rr = Math.max(0.09, R * 0.030);
    for (let b = 1; b <= bands; b++) {
      const v = (b / (bands + 1)) * 0.86;
      if (v > breakV(0.25)) continue;
      const count = Math.max(10, Math.round(nu * 0.55));
      for (let i = 0; i < count; i++) {
        const u = i / count;
        if (erode(0, 0, u, v)) continue;
        at(u, v, -rr * 0.2, tmp);
        const a = L * v;
        tmp2.set(base.x + ax.x * a, base.y + ax.y * a, base.z + ax.z * a);
        const dir = tmp.clone().sub(tmp2).normalize();
        riv.push(
          sweep(
            [tmp.clone().addScaledVector(dir, -rr), tmp.clone().addScaledVector(dir, rr * 1.1)],
            [rr * 1.15, rr * 0.85],
            6,
          ),
        );
      }
    }
    const rg = mergeParts(riv);
    if (rg) bronze.push(rg);
  }

  // Pipe runs along the hull, with elbows standing off it.
  {
    const pipes = rng.int(3, 6);
    for (let i = 0; i < pipes; i++) {
      const u0 = rng.next();
      const pr = Math.max(0.14, R * rng.range(0.045, 0.085));
      const v0 = rng.range(0.06, 0.30);
      const v1 = Math.min(0.86, v0 + rng.range(0.30, 0.55));
      const drift = rng.range(-0.10, 0.10);
      const path: THREE.Vector3[] = [];
      const radii: number[] = [];
      const steps = 9;
      for (let s = 0; s <= steps; s++) {
        const k = s / steps;
        const v = v0 + (v1 - v0) * k;
        at(u0 + drift * k, v, pr * (1.15 + 0.5 * Math.sin(k * 6.0 + u0 * 9.0)), tmp);
        path.push(tmp.clone());
        radii.push(pr);
      }
      bronze.push(sweep(path, radii, 7));
      // A junction box where the pipe leaves the hull.
      at(u0, v0, pr * 1.4, tmp);
      bronze.push(
        placed(
          bevelBox(pr * 4.2, pr * 3.0, pr * 3.4, pr * 0.5),
          tmp.clone(),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.jitter(0.5), rng.range(0, TAU), rng.jitter(0.5))),
        ),
      );
    }
  }

  // Cog housings: short thick drums standing proud of the flank. The single
  // most legible "this is a machine" cue at any distance.
  {
    const cogs = rng.int(2, 4);
    for (let i = 0; i < cogs; i++) {
      const u = rng.next();
      const v = rng.range(0.16, 0.72);
      if (erode(0, 0, u, v)) continue;
      const cr = R * rng.range(0.28, 0.46);
      at(u, v, 0, tmp);
      const a = L * v;
      tmp2.set(base.x + ax.x * a, base.y + ax.y * a, base.z + ax.z * a);
      const dir = tmp.clone().sub(tmp2).normalize();
      const p0 = tmp.clone().addScaledVector(dir, -cr * 0.25);
      const p1 = tmp.clone().addScaledVector(dir, cr * 0.34);
      const p2 = tmp.clone().addScaledVector(dir, cr * 0.46);
      // Housing, then a narrower boss, then the toothed rim as a faceted ring.
      bronze.push(sweep([p0, p1], [cr, cr * 0.96], 14));
      bronze.push(sweep([p1, p2], [cr * 0.42, cr * 0.34], 10));
      const teeth = rng.int(9, 14);
      const tg: THREE.BufferGeometry[] = [];
      for (let k = 0; k < teeth; k++) {
        const th = (k / teeth) * TAU;
        const ex = new THREE.Vector3()
          .copy(p1)
          .addScaledVector(rt, Math.cos(th) * cr)
          .addScaledVector(bi, Math.sin(th) * cr);
        tg.push(placed(bevelBox(cr * 0.20, cr * 0.20, cr * 0.34, cr * 0.05), ex));
      }
      const tgm = mergeParts(tg);
      if (tgm) bronze.push(tgm);
      silhouette.push(sweep([p0, p2], [cr, cr * 0.4], 8));
    }
  }

  // ---- struts into the ground ----------------------------------------------
  // Legs sheared off in the fall, driven under the surface. They are what makes
  // the mass read as having SETTLED rather than as having been placed.
  {
    const legs = rng.int(3, 5);
    for (let i = 0; i < legs; i++) {
      const u = rng.next();
      const v = rng.range(0.10, 0.55);
      at(u, v, 0, tmp);
      const from = tmp.clone();
      const outw = new THREE.Vector3(from.x - base.x, 0, from.z - base.z);
      if (outw.lengthSq() < 1e-6) outw.set(1, 0, 0);
      outw.normalize();
      const reach = R * rng.range(0.6, 1.5);
      const tx = from.x + outw.x * reach;
      const tz = from.z + outw.z * reach;
      const lr = R * rng.range(0.09, 0.16);
      // Driven under the LOD FLOOR, not under the CPU surface — a strut buried a
      // quarter-radius against a surface that sags four metres at range is a
      // strut standing in mid-air at range. See LandmarkSpec.groundDeep.
      const to = new THREE.Vector3(tx, Math.min(deep(tx, tz), ground(tx, tz)) - R * 0.25, tz);
      const mid = new THREE.Vector3().lerpVectors(from, to, 0.55).addScaledVector(outw, reach * 0.18);
      const g = sweep([from, mid, to], [lr * 1.25, lr, lr * 0.75], 6, rng.jitter(0.4));
      bronze.push(g);
      silhouette.push(g.clone());
      // The ash has had an era to pile against a fallen machine. Same argument
      // as the Telvanni roots: what reads at range is the bank and the material
      // change, not the buried centimetres.
      ashParts.push(
        ashMound(tx, tz, ground, {
          radius: R * rng.range(0.30, 0.52),
          height: R * rng.range(0.10, 0.18),
          seed: (spec.seed + i * 53) % 499,
          deep,
        }),
      );
    }
  }

  // ---- debris field ---------------------------------------------------------
  // Shed plate near the break, and stone where the machine ploughed in. The
  // fracture end throws metal; the buried end throws rock.
  {
    const shards = rng.int(10, 18);
    for (let i = 0; i < shards; i++) {
      const th = rng.range(0, TAU);
      const d = R * rng.range(1.2, 3.0);
      const a = L * rng.range(0.55, 1.05);
      const cx = base.x + ax.x * a + Math.cos(th) * d;
      const cz = base.z + ax.z * a + Math.sin(th) * d;
      // Small, and BEDDED. A shed plate sized off the drum's own radius came out
      // twenty metres across, and lifting it clear of the sampled ground so its
      // corners would not poke through put a 20 m slab two metres in the air —
      // the hovering-object tell, at landmark scale. Half-sunk is both correct
      // for something that fell an era ago and impossible to read as floating.
      const s = R * rng.range(0.06, 0.16);
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rng.range(-0.7, 0.7), rng.range(0, TAU), rng.range(-0.7, 0.7)),
      );
      bronze.push(
        placed(
          bevelBox(s * rng.range(1.2, 2.4), s * rng.range(0.18, 0.40), s * rng.range(0.9, 1.9), s * 0.06),
          new THREE.Vector3(cx, ground(cx, cz) - s * rng.range(0.10, 0.45), cz),
          q,
        ),
      );
    }
    const rocks = rng.int(12, 22);
    for (let i = 0; i < rocks; i++) {
      const th = rng.range(0, TAU);
      const d = R * rng.range(0.9, 2.4);
      const a = L * rng.range(-0.1, 0.45);
      const cx = base.x + ax.x * a + Math.cos(th) * d;
      const cz = base.z + ax.z * a + Math.sin(th) * d;
      const s = R * rng.range(0.08, 0.24);
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rng.range(-0.5, 0.5), rng.range(0, TAU), rng.range(-0.5, 0.5)),
      );
      stone.push(
        placed(
          bevelBox(s * rng.range(0.8, 2.0), s * rng.range(0.4, 1.1), s * rng.range(0.8, 1.8), s * 0.14),
          new THREE.Vector3(cx, ground(cx, cz) - s * rng.range(0.05, 0.4), cz),
          q,
        ),
      );
    }
  }

  const bm = mergeParts(bronze);
  if (bm) parts.push({ key: 'bronze', geo: bm });
  const sm = mergeParts(stone);
  if (sm) parts.push({ key: 'basalt', geo: sm });
  const am = mergeParts(ashParts);
  if (am) {
    parts.push({ key: 'ash', geo: am });
    silhouette.push(am.clone());
  }

  // Footprint ring for the foundation: the drum's own outline where it enters
  // the ground, so the ash bank is piled against the buried third rather than
  // ringing the whole wreck.
  // Deliberately TIGHT and centred on the buried third. The foundation scales
  // its ash bank off the mean radius of this ring, so handing it the wreck's
  // full 3H length produces a forty-metre pale apron lying round the whole
  // thing — which reads as a car park, not as a machine that ploughed in.
  const ring: THREE.Vector3[] = [];
  for (let i = 0; i < 24; i++) {
    const th = (i / 24) * TAU;
    const a = L * 0.14;
    // Elongated along the axis: it went in nose-first and the trench it cut is
    // longer than it is wide.
    const ex = Math.cos(th) * R * 1.45;
    const ez = Math.sin(th) * R * 0.85;
    const rx = base.x + ax.x * a + rt.x * ez + ax.x * ex;
    const rz = base.z + ax.z * a + rt.z * ez + ax.z * ex;
    // ON the terrain, not on the pad. The foundation skirt hangs from this ring
    // down to the ground, so a ring left at y=0 on a hillside becomes a
    // thirty-metre curtain of plinth — which is most of the frame and none of
    // the asset. A wreck has no plinth; it has a trench and a rubble skirt.
    ring.push(new THREE.Vector3(rx, ground(rx, rz) + R * 0.10, rz));
  }

  silhouette.push(silhouetteShell(drum, nu, nv, erode, 1));

  // Occluders down the axis so the greeble layer darkens where it tucks against
  // the hull, and the hull where it tucks under a cog housing.
  const occluders: THREE.Vector4[] = [];
  for (let s = 0; s <= 8; s++) {
    const a = L * (s / 8);
    occluders.push(new THREE.Vector4(base.x + ax.x * a, base.y + ax.y * a, base.z + ax.z * a, R * 0.92));
  }

  return {
    parts,
    ring,
    emitters,
    radius: L * 0.6,
    height: H,
    proxy: mergeParts(silhouette) ?? new THREE.BufferGeometry(),
    proxyKey: 'bronze',
    occluders,
  };
}

// ---------------------------------------------------------------- daedric

/**
 * Daedric shrine at landmark scale.
 *
 * Where the Telvanni tower is grown and asymmetric, this is cut and angular:
 * a faceted basalt mass with a collapsed crown, leaning horn slabs off the
 * shoulder, and — the part that actually carries the identity — a free-standing
 * gate of two pylons and a pointed arch, set out in front of the mass with
 * braziers burning on the pylon caps.
 *
 * The gate is what makes this read as a shrine rather than as a rock. It also
 * gives the frame two objects of known human size (a doorway, a fire) at a
 * known separation, which is the cheapest scale cue available.
 */
export function daedricShrine(spec: LandmarkSpec): Structure {
  const rng = new Rng(spec.seed ^ 0x2f8a1cd3);
  const ground = spec.ground ?? ((): number => 0);
  // The LOD floor. Every foot that has to be UNDER the surface uses this; every
  // heap that has to sit ON it uses `ground`. See LandmarkSpec.
  const deep = spec.groundDeep ?? ground;
  const H = spec.height;
  const sides = rng.int(4, 6);
  const R = H * rng.range(0.30, 0.40);
  const collapse = rng.range(0.10, 0.30);
  // Sized so that what SURVIVES the collapse is the requested height. Setting
  // the intact height to H instead makes every shrine land a third shorter than
  // the planner asked for, which is how a landmark quietly stops being one.
  const coreH = H / (1 - collapse * 0.55);
  const nu = sides * 8;
  const nv = 20;
  const alpha = TAU / sides;
  const taper = rng.range(0.3, 0.48);
  const faceBias: number[] = [];
  for (let i = 0; i < sides; i++) faceBias.push(rng.range(0.88, 1.14));

  const core: Surface = (u, v, out) => {
    const th = u * TAU;
    const fi = ((Math.floor(th / alpha) % sides) + sides) % sides;
    const local = th - (fi + 0.5) * alpha;
    // 1/cos turns the angular sweep into a straight face; the clamp keeps the
    // corner from going singular at the seam.
    const flatR = 1 / Math.max(Math.cos(local), 0.55);
    const shrink = 1 - taper * Math.pow(v, 1.15);
    const step = 1 + 0.075 * Math.cos(v * Math.PI * 3.0);
    const r = R * flatR * shrink * step * faceBias[fi];
    out.set(Math.cos(th) * r, coreH * v, Math.sin(th) * r);
  };

  const cSeed = rng.range(0, 100);
  const crown = (u: number): number =>
    1 - collapse * (0.3 + 0.9 * noise2(u * sides * 1.6 + cSeed, cSeed));
  const erode = (_i: number, _j: number, u: number, v: number): boolean => v > crown(u);

  const thickness = R * rng.range(0.1, 0.16);
  const openings: Opening[] = [];
  const doorU = Math.round(((spec.facing / TAU) * nu + nu) % nu);
  openings.push({ u0: doorU - 3, u1: doorU + 4, v0: 0, v1: Math.round(nv * 0.18) });
  const bands = rng.int(3, 5);
  for (let b = 0; b < bands; b++) {
    const v0 = Math.round(nv * (0.1 + (b / bands) * 0.62));
    const h = rng.int(1, 2);
    for (let f = 0; f < sides; f++) {
      if (rng.chance(0.2)) continue;
      const u0 = f * 8 + 1;
      // Deep relief, but never deeper than the wall it is cut into.
      openings.push({ u0, u1: u0 + 6, v0, v1: v0 + h, recess: thickness * rng.range(0.35, 0.7) });
    }
  }

  const res = buildShell({ nu, nv, surface: core, thickness, openings, flat: true, erode, floor: true });
  const parts: Part[] = [];
  pushShell(parts, res, 'basalt', 'basalt');

  const emitters: Emitter[] = [];
  const extra: THREE.BufferGeometry[] = [];
  const bronze: THREE.BufferGeometry[] = [];
  /** Per-support ash banks; see ashMound. */
  const ashParts: THREE.BufferGeometry[] = [];
  const fire: THREE.BufferGeometry[] = [];
  const silhouette: THREE.BufferGeometry[] = [];
  const tmp = new THREE.Vector3();

  // ---- buttress wings ----
  const wings = rng.int(3, 5);
  for (let i = 0; i < wings; i++) {
    const fi = rng.int(0, sides - 1);
    const th = (fi + 0.5) * alpha + rng.jitter(0.1);
    const topV = rng.range(0.42, 0.78);
    core(th / TAU, topV, tmp);
    const top = tmp.clone();
    core(th / TAU, 0, tmp);
    const foot = tmp.clone();
    const ox = Math.cos(th);
    const oz = Math.sin(th);
    const reach = R * rng.range(0.7, 1.4);
    const fx = foot.x + ox * reach;
    const fz = foot.z + oz * reach;
    const path = [
      new THREE.Vector3(fx, ground(fx, fz) - R * 0.12, fz),
      new THREE.Vector3(foot.x + ox * reach * 0.7, top.y * 0.34, foot.z + oz * reach * 0.7),
      new THREE.Vector3(top.x + ox * reach * 0.22, top.y * 0.8, top.z + oz * reach * 0.22),
      new THREE.Vector3(top.x, top.y, top.z),
    ];
    const g = sweep(path, [R * 0.2, R * 0.15, R * 0.1, R * 0.06], 4, Math.PI * 0.25);
    extra.push(g);
    silhouette.push(g.clone());
  }

  // ---- horns off the shoulder ----
  const horns = rng.int(2, 4);
  for (let i = 0; i < horns; i++) {
    const fi = rng.int(0, sides - 1);
    const th = (fi + 0.5) * alpha + rng.jitter(0.2);
    core(th / TAU, rng.range(0.55, 0.8), tmp);
    const b = tmp.clone();
    // Short and thick. Long thin horns sweep up into whip shapes that read as
    // tentacles, which is a different game entirely; these are shoulders.
    const len = H * rng.range(0.12, 0.22);
    const dir = new THREE.Vector3(Math.cos(th) * 0.55, 1, Math.sin(th) * 0.55).normalize();
    const path = [
      b.clone().addScaledVector(dir, -R * 0.2),
      b.clone().addScaledVector(dir, len * 0.5),
      b.clone().addScaledVector(dir, len),
    ];
    const g = sweep(path, [R * 0.22, R * 0.14, R * 0.05], 4, rng.jitter(0.5));
    extra.push(g);
    silhouette.push(g.clone());
  }

  // ---- the gate ----
  const gd = new THREE.Vector3(Math.cos(spec.facing), 0, Math.sin(spec.facing));
  const lat = new THREE.Vector3(-gd.z, 0, gd.x);
  const gateD = R * rng.range(1.6, 2.2);
  const gateH = H * rng.range(0.32, 0.44);
  const half = R * rng.range(0.55, 0.8);
  const pylonR = R * 0.16;
  const capTop: THREE.Vector3[] = [];
  for (const s of [-1, 1]) {
    const px = gd.x * gateD + lat.x * half * s;
    const pz = gd.z * gateD + lat.z * half * s;
    const gy = ground(px, pz);
    // A pylon foot is the classic "leg ending in empty space": two thin columns
    // set out in FRONT of the mass, well outside the foundation skirt, on
    // whatever the ground happens to do there. Buried against the LOD floor and
    // banked with ash so the entry reads as an entry at every distance.
    const gyDeep = Math.min(deep(px, pz), gy);
    ashParts.push(
      ashMound(px, pz, ground, {
        radius: pylonR * rng.range(2.6, 3.8),
        height: pylonR * rng.range(0.7, 1.2),
        seed: (spec.seed + (s + 2) * 61) % 499,
        deep,
      }),
    );
    const path = [
      new THREE.Vector3(px, gyDeep - R * 0.2, pz),
      new THREE.Vector3(px + gd.x * pylonR * 0.2, gy + gateH * 0.55, pz + gd.z * pylonR * 0.2),
      new THREE.Vector3(px, gy + gateH, pz),
    ];
    const g = sweep(path, [pylonR * 1.25, pylonR * 0.85, pylonR * 0.7], 4, 0.2);
    extra.push(g);
    silhouette.push(g.clone());
    capTop.push(new THREE.Vector3(px, gy + gateH, pz));

    const bowlY = gy + gateH + pylonR * 0.45;
    bronze.push(
      placed(bevelBox(pylonR * 1.9, pylonR * 0.9, pylonR * 1.9, pylonR * 0.3), new THREE.Vector3(px, bowlY, pz)),
    );
    const flameY = bowlY + pylonR * 0.95;
    fire.push(
      placed(bevelBox(pylonR * 1.1, pylonR * 1.5, pylonR * 1.1, pylonR * 0.4), new THREE.Vector3(px, flameY, pz)),
    );
    emitters.push({
      pos: new THREE.Vector3(px, flameY, pz),
      kind: 'brazier',
      range: 30,
      hue: EMBER_HUE,
      power: 9,
    });
  }
  // Pointed lintel. Round it and it is Roman; this profile is the one thing
  // that separates a daedric gate from a stone doorway.
  {
    const a = capTop[0];
    const b = capTop[1];
    const apex = new THREE.Vector3()
      .addVectors(a, b)
      .multiplyScalar(0.5)
      .setY(Math.max(a.y, b.y) + gateH * 0.34);
    const path = [
      a.clone(),
      new THREE.Vector3().lerpVectors(a, apex, 0.55).setY(a.y + gateH * 0.13),
      apex,
      new THREE.Vector3().lerpVectors(b, apex, 0.55).setY(b.y + gateH * 0.13),
      b.clone(),
    ];
    const g = sweep(path, [pylonR * 0.7, pylonR * 0.55, pylonR * 0.62, pylonR * 0.55, pylonR * 0.7], 4);
    extra.push(g);
    silhouette.push(g.clone());
  }

  // ---- standing stones ----
  const stones = rng.int(5, 9);
  const ringR = R * rng.range(1.7, 2.3);
  for (let i = 0; i < stones; i++) {
    const th = (i / stones) * TAU + rng.jitter(0.16);
    const sx = Math.cos(th) * ringR;
    const sz = Math.sin(th) * ringR;
    const sh = H * rng.range(0.2, 0.38);
    // Slabs, not cards. Below about half depth-to-width these turn edge-on to
    // the camera and read as bright flat sheets stuck in the ground.
    const sw = R * rng.range(0.17, 0.27);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.jitter(0.16), -th, rng.jitter(0.18)));
    // Set INTO the LOD floor rather than onto the CPU surface. A ring of slabs
    // is the widest footprint in the asset — twice the mass's own radius — so
    // it is the part that first steps off the drawn ground on a slope, and a
    // standing stone hovering by half a metre is as damaging as the shrine
    // hovering by ten.
    const sy = Math.min(deep(sx, sz), ground(sx, sz));
    const g = placed(
      bevelBox(sw, sh, sw * rng.range(0.55, 0.85), sw * 0.14),
      new THREE.Vector3(sx, sy + sh * 0.5 - sw * 0.55, sz),
      q,
    );
    extra.push(g);
    silhouette.push(g.clone());
    ashParts.push(
      ashMound(sx, sz, ground, {
        radius: sw * rng.range(1.5, 2.4),
        height: sw * rng.range(0.35, 0.6),
        seed: (spec.seed + i * 71) % 499,
        deep,
      }),
    );
  }

  // ---- shed rubble ----
  const rubble = rng.int(10, 20);
  for (let i = 0; i < rubble; i++) {
    const th = rng.range(0, TAU);
    const d = R * rng.range(1.05, 2.8);
    const x = Math.cos(th) * d;
    const z = Math.sin(th) * d;
    const s = R * rng.range(0.08, 0.26);
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rng.range(-0.5, 0.5), rng.range(0, TAU), rng.range(-0.5, 0.5)),
    );
    extra.push(
      placed(
        bevelBox(s * rng.range(0.7, 2.0), s * rng.range(0.4, 1.1), s * rng.range(0.7, 1.8), s * 0.12),
        new THREE.Vector3(x, ground(x, z) - s * rng.range(0.05, 0.35), z),
        q,
      ),
    );
  }

  const basalt = mergeParts(extra);
  if (basalt) parts.push({ key: 'basalt', geo: basalt });
  const brz = mergeParts(bronze);
  if (brz) parts.push({ key: 'bronze', geo: brz });
  const shrineAsh = mergeParts(ashParts);
  if (shrineAsh) {
    parts.push({ key: 'ash', geo: shrineAsh });
    silhouette.push(shrineAsh.clone());
  }
  const flames = mergeParts(fire);
  if (flames) parts.push({ key: 'glowFire', geo: flames });

  silhouette.push(silhouetteShell(core, nu, nv, erode));

  return {
    parts,
    ring: baseRing(core, nu),
    emitters,
    radius: ringR * 1.1,
    height: H,
    proxy: mergeParts(silhouette) ?? new THREE.BufferGeometry(),
    proxyKey: 'basalt',
  };
}
