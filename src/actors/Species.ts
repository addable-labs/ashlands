import * as THREE from 'three';
import type { ActorMaterialOpts } from './ActorMaterials';
import { blob, membrane, spike, Spine, SurfaceBuilder, tube, type Mask, type V3 } from './Mesh';
import type { BoneDef } from './Rig';

/**
 * The bestiary.
 *
 * Every creature is authored in rest space with +Z forward and +Y up, at true
 * metric scale, around a bone list that is declared first. Silhouette is the
 * brief: Morrowind's creatures are memorable because you can identify each one
 * from a black cut-out at 200 m, so proportions here are pushed — the racer's
 * tail is absurdly long, the strider's legs are absurdly thin — rather than
 * naturalistic.
 */

export interface LegDef {
  /** IK root — rotates about its head (the hip). */
  upper: string;
  /** IK mid — the knee. */
  lower: string;
  /** Effector bone; its HEAD is what the solver drives onto the target. */
  foot: string;
  /** Gait phase offset in [0,1). */
  phase: number;
  /** Preferred knee/elbow direction in rest space. */
  pole: V3;
  /** Rest position of the effector, in rest space. Defines the stance. */
  rest: V3;
  /** Metres the effector sits above the ground contact point. */
  lift: number;
}

export type Locomotion = 'ground' | 'fly' | 'drift';

export interface SpeciesDef {
  kind: string;
  /** Which of the shared materials each geometry group uses. */
  materials: Record<string, ActorMaterialOpts>;
  bones: BoneDef[];
  build(mb: ModelBuilder): void;
  legs: LegDef[];
  /** Bone chain from pelvis to head, used for the locomotion body wave. */
  spine: string[];
  head: string | null;
  /** Whip chains: tails, tentacles, antennae. Animated by a travelling wave. */
  whips: string[][];
  /** Wing chains, root-first. */
  wings: string[][];
  locomotion: Locomotion;
  /** Root bone height above the ground when standing on the flat. */
  standHeight: number;
  /** Metres per full gait cycle, per leg. Sets stride and kills foot skate. */
  stride: number;
  /** Peak foot lift during swing. */
  step: number;
  /** Fraction of the cycle a foot spends planted. >0.5 keeps a tripod down. */
  duty: number;
  walkSpeed: number;
  runSpeed: number;
  /** Steering radius and separation distance. */
  radius: number;
  maxHealth: number;
  faction: string;
  scaleRange: [number, number];
  /** LOD distance multiplier — a strider stays skinned far longer than a kwama. */
  lodScale: number;
  /** Cruise altitude above terrain for flyers and drifters. */
  altitude?: [number, number];
  /** Terrain surface indices this creature is happy on. Empty = anywhere. */
  surfaces: number[];
  /** Population target across the streaming radius. */
  population: number;
  /**
   * STAGING BAND — [near, far] metres from the camera at which this species is
   * placed, and outside which it is streamed back in.
   *
   * This is a composition parameter, not a performance one. On-screen height is
   * `framedSize / (distance * pixelWorld)`, so distance is the only thing that
   * decides whether a creature reads as a mass with material response or as an
   * unresolvable smudge — and the answer is different for a 0.5 m kwama and a
   * 20 m silt strider. Bands are therefore authored per species against the
   * role the animal plays in the frame:
   *
   *   landmark   silt strider, netch — must subtend enough of the frame to be
   *              read as architecture-scale. Staged in the midground.
   *   midground  guar, cliff racer — mass and silhouette, no surface detail.
   *   near       kwama, nix-hound, dunmer — small, so they have to be close
   *              enough to resolve at all or they contribute nothing.
   *
   * The old scheme placed everything in one 40–420 m band regardless of size,
   * which is how a 15 m netch ended up at 450 m as a thirty-pixel cream blob
   * with no shading, no texture and no silhouette — the exact defect the art
   * bible calls a placeholder.
   */
  stage: [number, number];
}

/* ---------------------------------------------------------- model builder */

export class ModelBuilder {
  readonly b = new SurfaceBuilder();
  readonly groups: { start: number; count: number; key: string }[] = [];
  private open: { start: number; key: string } | null = null;

  use(key: string, mask: Mask): void {
    this.close();
    this.open = { start: this.b.idx.length, key };
    this.b.setMask(mask);
  }

  private close(): void {
    if (this.open === null) return;
    const count = this.b.idx.length - this.open.start;
    if (count > 0) this.groups.push({ start: this.open.start, count, key: this.open.key });
    this.open = null;
  }

  finish(): { geo: THREE.BufferGeometry; keys: string[] } {
    this.close();

    // One group per MATERIAL, not one per `use()` call.
    //
    // three issues a draw per geometry group, even when two groups resolve to
    // the same material index — so a silt strider authored as ten body parts
    // was ten draw calls in the scene pass, ten more in the depth prepass and
    // ten more in every shadow cascade it fell inside. Sorting the index buffer
    // by material first collapses that to one group per material (strider 10 ->
    // 4, guar 6 -> 4, cliff racer 5 -> 3) for exactly the same pixels: triangle
    // order within an opaque, depth-tested mesh is not observable.
    const keys: string[] = [];
    for (const g of this.groups) if (!keys.includes(g.key)) keys.push(g.key);

    const src = this.b.idx;
    const sorted: number[] = new Array(src.length);
    const spans: { start: number; count: number; mi: number }[] = [];
    let w = 0;
    for (let mi = 0; mi < keys.length; mi++) {
      const start = w;
      for (const g of this.groups) {
        if (g.key !== keys[mi]) continue;
        for (let i = 0; i < g.count; i++) sorted[w++] = src[g.start + i];
      }
      if (w > start) spans.push({ start, count: w - start, mi });
    }
    // Any index the group list did not claim (there should be none) must still
    // reach the geometry, or triangles silently vanish.
    if (w !== src.length) {
      for (let i = 0; i < src.length; i++) sorted[i] = src[i];
      const geo = this.b.toGeometry();
      const seen: string[] = [];
      for (const g of this.groups) {
        let mi = seen.indexOf(g.key);
        if (mi < 0) { mi = seen.length; seen.push(g.key); }
        geo.addGroup(g.start, g.count, mi);
      }
      return { geo, keys: seen };
    }

    for (let i = 0; i < sorted.length; i++) src[i] = sorted[i];
    const geo = this.b.toGeometry();
    for (const s of spans) geo.addGroup(s.start, s.count, s.mi);
    return { geo, keys };
  }
}

/* -------------------------------------------------------------- utilities */

const M_HARD: Mask = { trans: 0, irid: 1, wear: 0.4 };
const M_HIDE: Mask = { trans: 0.12, irid: 0.15, wear: 0.5 };
const M_THIN: Mask = { trans: 1, irid: 0.25, wear: 0.1 };
const M_FLESH: Mask = { trans: 0.35, irid: 0, wear: 0.3 };
const M_CLOTH: Mask = { trans: 0.08, irid: 0, wear: 0.6 };

function mirror(p: V3, s: number): V3 {
  return [p[0] * s, p[1], p[2]];
}

/** A bone pair, mirrored across X. Halves the authoring for every limb. */
function bonePair(
  out: BoneDef[],
  name: string,
  parent: (side: string) => string,
  head: V3,
  tail: V3,
  r: number,
  bias?: number,
): void {
  for (const s of ['L', 'R']) {
    const sg = s === 'R' ? 1 : -1;
    out.push({
      name: `${name}.${s}`,
      parent: parent(s),
      head: mirror(head, sg),
      tail: mirror(tail, sg),
      r,
      bias,
    });
  }
}

/** Tapered limb segment through a slightly bowed path. */
function limb(mb: ModelBuilder, a: V3, b: V3, ra: number, rb: number, bow: V3, nu = 8, nv = 8): void {
  const mid: V3 = [
    (a[0] + b[0]) * 0.5 + bow[0],
    (a[1] + b[1]) * 0.5 + bow[1],
    (a[2] + b[2]) * 0.5 + bow[2],
  ];
  tube(mb.b, new Spine([a, mid, b], 20), {
    nu,
    nv,
    radius: (v) => ra + (rb - ra) * v,
    texel: 3,
    capA: true,
    capB: true,
  });
}

/** Segmented insect leg: three tapered links plus a chitin knee knuckle. */
function insectLeg(mb: ModelBuilder, pts: V3[], radii: number[], bows: V3[]): void {
  for (let i = 0; i < pts.length - 1; i++) {
    limb(mb, pts[i], pts[i + 1], radii[i], radii[i + 1], bows[i], 8, 7);
  }
}

/* ------------------------------------------------------------ cliff racer */

function cliffRacer(): SpeciesDef {
  const bones: BoneDef[] = [
    { name: 'root', parent: null, head: [0, 0, 0], tail: [0, 0, -0.28], r: 0.55 },
    { name: 'neck', parent: 'root', head: [0, 0.05, 0.2], tail: [0, 0.11, 0.4], r: 0.3 },
    { name: 'head', parent: 'neck', head: [0, 0.11, 0.4], tail: [0, 0.06, 0.78], r: 0.34 },
    { name: 'tail1', parent: 'root', head: [0, 0.01, -0.28], tail: [0, 0.01, -0.66], r: 0.26 },
    { name: 'tail2', parent: 'tail1', head: [0, 0.01, -0.66], tail: [0, 0, -1.04], r: 0.24 },
    { name: 'tail3', parent: 'tail2', head: [0, 0, -1.04], tail: [0, 0, -1.42], r: 0.22 },
    { name: 'tail4', parent: 'tail3', head: [0, 0, -1.42], tail: [0, 0, -1.86], r: 0.24 },
  ];
  bonePair(bones, 'wingA', () => 'root', [0.11, 0.13, 0.02], [0.52, 0.28, -0.06], 0.34, 0.8);
  bonePair(bones, 'wingB', (s) => `wingA.${s}`, [0.52, 0.28, -0.06], [1.02, 0.34, -0.2], 0.42, 0.9);
  bonePair(bones, 'wingC', (s) => `wingB.${s}`, [1.02, 0.34, -0.2], [1.38, 0.22, -0.46], 0.46, 0.9);

  return {
    kind: 'cliffracer',
    bones,
    materials: {
      hide: { kind: 'chitin', color: 0x6d5941, irid: 0.28, sheen: 0.45, sss: 0.25, sssColor: 0x9c4a28, rough: 0.62, texel: 4 },
      wing: { kind: 'membrane', color: 0x8a5c40, irid: 0.14, sss: 1.5, sssColor: 0xd06a34, rough: 0.5, doubleSided: true, texel: 6 },
      beak: { kind: 'shell', color: 0xbfae87, irid: 0.12, sheen: 0.4, sss: 0.2, sssColor: 0xc06840, rough: 0.42, texel: 6 },
    },
    build(mb) {
      mb.use('hide', M_HARD);
      // Body: a compact keeled torso that runs straight into the tail, so the
      // whole animal reads as one dart in the sky.
      tube(
        mb.b,
        new Spine([[0, 0, -1.9], [0, 0, -1.1], [0, 0.02, -0.4], [0, 0.06, 0.05], [0, 0.07, 0.28], [0, 0.09, 0.42]], 40),
        {
          nu: 14,
          nv: 34,
          radius: (v) => {
            if (v < 0.42) return 0.018 + 0.16 * Math.pow(v / 0.42, 2.1);
            const t = (v - 0.42) / 0.58;
            return 0.178 * Math.pow(Math.max(0.001, 1 - t * t * 0.55), 0.5) * (1 - 0.35 * t);
          },
          section: (a, v) => 1 + 0.28 * Math.cos(a * Math.PI * 2) * (v < 0.5 ? 1 : 0.4),
          texel: 5,
          capA: true,
          capB: true,
        },
      );
      // Barbs down the tail — the detail that makes the silhouette unmistakable.
      for (let i = 0; i < 7; i++) {
        const t = i / 6;
        const z = -0.45 - t * 1.35;
        const up = 0.06 + 0.05 * (1 - t);
        const len = 0.1 + 0.1 * (1 - t);
        spike(mb.b, [0, up * 0.4, z], [0, up + len, z - 0.05], 0.02, 0.02, M_HARD);
        mb.b.setMask(M_HARD);
      }
      // Head: a long hooked beak and a swept crest.
      mb.use('beak', M_HARD);
      tube(mb.b, new Spine([[0, 0.11, 0.38], [0, 0.12, 0.55], [0, 0.05, 0.78], [0, -0.02, 0.9]], 20), {
        nu: 10,
        nv: 14,
        radius: (v) => 0.085 * Math.pow(1 - v, 0.55) + 0.006,
        texel: 6,
        capA: true,
        capB: true,
      });
      mb.use('hide', M_HARD);
      blob(mb.b, { centre: [0, 0.12, 0.4], radii: [0.09, 0.1, 0.12], nu: 14, nv: 10, texel: 6 });
      for (const s of [1, -1]) {
        spike(mb.b, [0.02 * s, 0.16, 0.34], [0.06 * s, 0.34, 0.06], 0.026, -0.02, M_HARD);
      }
      mb.b.setMask(M_HARD);

      // Wings. Bone-following tubes for the fingers, membranes between them.
      const A: V3 = [0.11, 0.13, 0.02];
      const B: V3 = [0.52, 0.28, -0.06];
      const C: V3 = [1.02, 0.34, -0.2];
      const D: V3 = [1.38, 0.22, -0.46];
      for (const s of [1, -1]) {
        mb.use('hide', M_HARD);
        limb(mb, mirror(A, s), mirror(B, s), 0.055, 0.036, [0, 0.02, 0.01], 7, 5);
        limb(mb, mirror(B, s), mirror(C, s), 0.036, 0.024, [0, 0.02, 0.0], 7, 5);
        limb(mb, mirror(C, s), mirror(D, s), 0.024, 0.012, [0, 0.01, -0.01], 6, 5);

        mb.use('wing', M_THIN);
        // Leading edge follows the arm; trailing edge sweeps back to the hip,
        // which is what gives the racer its ragged bat profile.
        const lead: V3[] = [mirror([0.06, 0.11, 0.06], s), mirror(A, s), mirror(B, s), mirror(C, s), mirror(D, s)];
        const trail: V3[] = [
          mirror([0.05, 0.04, -0.3], s),
          mirror([0.4, 0.1, -0.5], s),
          mirror([0.82, 0.16, -0.68], s),
          mirror([1.18, 0.14, -0.72], s),
          mirror(D, s),
        ];
        const sl = new Spine(lead, 24);
        const st = new Spine(trail, 24);
        const pa = new THREE.Vector3();
        membrane(mb.b, {
          nu: 22,
          nv: 8,
          edgeA: (u, out) => sl.point(u, out),
          edgeB: (u, out) => {
            st.point(u, out);
            // Scalloped trailing edge between the finger attachments.
            const sc = Math.sin(u * Math.PI * 3.0);
            out.y -= 0.02 * Math.max(0, sc);
          },
          sag: (u, v) => 0.06 * Math.sin(v * Math.PI) * (0.4 + 0.6 * u),
          thickness: 0.007,
          texel: 1.2,
          mask: () => M_THIN,
        });
        void pa;
      }
    },
    legs: [],
    spine: ['root', 'neck', 'head'],
    head: 'head',
    whips: [['tail1', 'tail2', 'tail3', 'tail4']],
    wings: [
      ['wingA.R', 'wingB.R', 'wingC.R'],
      ['wingA.L', 'wingB.L', 'wingC.L'],
    ],
    locomotion: 'fly',
    standHeight: 0,
    stride: 1,
    step: 0,
    duty: 0.5,
    walkSpeed: 7,
    runSpeed: 14,
    radius: 1.2,
    maxHealth: 40,
    faction: 'wild',
    scaleRange: [0.85, 1.25],
    lodScale: 1.4,
    // Ceiling down from 48 m. A creature whose shadow lands further from it than
    // the frame is wide has no ground reference at all, and at 48 m over a
    // camera staged at 40-300 m the animal is also at an elevation that puts it
    // in bare sky above the whole composition. At 12-36 m the cast shadow (see
    // ActorSystem.contactFor) lands on terrain that is still in shot, which is
    // what turns "an object floating in haze" into "an animal flying over that
    // ridge".
    altitude: [12, 36],
    surfaces: [],
    population: 9,
    stage: [40, 300],   // swarm overhead; mass, not detail
  };
}

/* ------------------------------------------------------------------ netch */

function netch(): SpeciesDef {
  const bones: BoneDef[] = [
    { name: 'root', parent: null, head: [0, 0, 0], tail: [0, 1.0, 0], r: 1.2 },
    { name: 'bell', parent: 'root', head: [0, 0.4, 0], tail: [0, 2.2, 0], r: 5.0 },
    { name: 'crown', parent: 'bell', head: [0, 2.0, 0], tail: [0, 3.4, 0], r: 2.2, bias: 0.7 },
  ];
  const TENT = 9;
  const ring: V3[] = [];
  /** Tentacle length. Long enough to trail — that is the whole silhouette. */
  const tentLen = (i: number): number => 6.4 + 2.8 * (((i * 7) % 5) / 4);
  for (let i = 0; i < TENT; i++) {
    const a = (i / TENT) * Math.PI * 2 + 0.3;
    // Hung from near the RIM of the bell, not bunched under its axis. A 5 m
    // gasbag with a 1 m tentacle ring reads as a lamp on a stalk; the whole
    // point of the silhouette is a wide canopy with a curtain under its edge.
    const rr = 1.55 + 0.45 * (i % 2);
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr * 1.12;
    ring.push([x, 0.1, z]);
    const len = tentLen(i);
    for (let k = 0; k < 4; k++) {
      const y0 = 0.1 - (len * k) / 4;
      const y1 = 0.1 - (len * (k + 1)) / 4;
      const sp = 1 + k * 0.16;
      bones.push({
        name: `t${i}_${k}`,
        parent: k === 0 ? 'root' : `t${i}_${k - 1}`,
        head: [x * (1 + k * 0.12), y0, z * (1 + k * 0.12)],
        tail: [x * sp, y1, z * sp],
        r: 0.6,
        bias: 0.9,
      });
    }
  }

  return {
    kind: 'netch',
    bones,
    materials: {
      // The bell is the reason netches are the signature creature: a huge
      // translucent sack lit from behind. Everything here is tuned for that one
      // read.
      //
      // What it was tuned for before, and got wrong: roughness 0.58 over the
      // lacquered chitin set put one tight GGX lobe across a five-metre convex
      // shell, and a five-metre shell with a single hard highlight on it is
      // pewter, not membrane — reviewers read the animal as a grey balloon.
      // The fix is not more specular tuning, it is to move the read off the
      // reflection entirely: matte the surface right down, drop the iridescent
      // lamellae that were drawing hard bands across it, and let the membrane
      // transmission term below carry the whole body. Bioluminescent teal is
      // one of the two saturated colours the palette allows, and it belongs
      // here rather than on the albedo, which stays a desaturated grey-green.
      //
      // Albedo sits at the TOP of the ash band (#8a7f72), never above it. At
      // 0x949a8b the bell was 1.4x brighter than the brightest ground value in
      // the palette, which made a drifting netch the single brightest object in
      // the lower two-thirds of every frame it appeared in — the eye went
      // straight to it and read it as an untextured placeholder. The animal is
      // supposed to be lit from INSIDE: the transmission term below is not
      // gated on the albedo, so pulling the surface down into the palette makes
      // the glow the bright part instead of the sack.
      //
      // OLIVE-KHAKI IS NOT IN THE BOOK. The bell sat at 0x7e8376 — green-
      // dominant, which is the one hue family the palette table does not
      // contain anywhere — and against ash and basalt that reads as the muddiest
      // note in the frame rather than as the signature animal. The chitin/bone
      // band (#d8c9a4 -> #8f7d5a) is where a keratinous sack belongs, and its
      // dark end is the same luminance the olive was, so nothing about the
      // value composition moves; only the hue does. The saturated colour the
      // animal is allowed stays where it was, on the bioluminescent
      // transmission, which is the light the bible licenses to be vivid.
      bell: { kind: 'membrane', color: 0x8f7d5a, irid: 0.05, sss: 1.0, sssColor: 0x8fd6c2, rough: 0.86, texel: 2.2 },
      // The mantle is the underside, and the underside was the only pure black
      // in the frame. `sss` up and a real thickness on its mask (see build)
      // means the two-sided wrap term actually has something to work with, so
      // the collar picks up sky and ground bounce through its own wall instead
      // of resolving to a hole punched in the mesh.
      hide: { kind: 'membrane', color: 0x6f6450, irid: 0.06, sheen: 0.2, sss: 1.0, sssColor: 0xc9b48a, rough: 0.84, texel: 4 },
      tent: { kind: 'membrane', color: 0x8a7b5c, irid: 0.05, sheen: 0.3, sss: 0.9, sssColor: 0x9ad4bf, rough: 0.8, texel: 3 },
    },
    build(mb) {
      mb.use('bell', M_THIN);
      // Bladder partition pattern, shared by the geometry and the cavity ramp
      // below so the dark seams land in the creases and not beside them. Five
      // fat lobes with a lighter eleventh harmony on top: five over thirty
      // columns is six segments a lobe, which is enough to read as a swelling
      // rather than as a facet.
      const bladder = (th: number): number => 0.055 * Math.cos(th * 5) + 0.022 * Math.cos(th * 11 + 0.8);
      // Gasbag: an ellipsoid with a flared lower rim and a flattened underside,
      // so the light that passes through it is broken up by internal structure
      // rather than reading as a smooth balloon. Tessellation is down from
      // 40x26 — a smooth ovoid does not need a thousand extra triangles, and
      // this is the heaviest actor mesh in the world.
      blob(mb.b, {
        centre: [0, 1.5, 0],
        radii: [2.5, 1.9, 2.9],
        nu: 30,
        nv: 20,
        texel: 1.4,
        warp: (th, ph, r) => {
          // A sack of gas bladders, not a balloon. The old 3% ripple was
          // 7 cm on a 2.5 m radius — a quarter of a pixel at the staging
          // distance, i.e. authored detail that could never be seen, which is
          // most of why the body read as one uniform value. At 5.5% it is
          // 14 cm, and combined with the latitudinal partition it puts real
          // mid-frequency form on the one surface in the frame that had none.
          const rib = 1 + bladder(th) * (0.55 + 0.45 * Math.sin(ph)) + 0.028 * Math.cos(ph * 7.0);
          // Flare the very bottom of the bell back OUT into a skirt. A closed
          // ovoid has no edge; a jellyfish is legible precisely because its rim
          // is a thin flaring lip you can see the light come through.
          const t = Math.max(0, (ph - Math.PI * 0.55) / (Math.PI * 0.45));
          const belly = 1 - 0.30 * Math.pow(t, 1.7) + 0.34 * Math.pow(t, 5.0);
          r.x *= rib * belly;
          r.z *= rib * belly;
          r.y *= 1 + 0.1 * Math.cos(th * 3);
        },
        // Thickness mask drives the transmission. Thickest — that is, most
        // light through — around the flank and the rim, thinning over the
        // crown where the sack is doubled and its internal float bladder sits.
        //
        // Now lobed around the bell as well as banded down it. A sack of gas
        // bladders is not a surface of revolution, and a transmission that
        // varies only with latitude produces exactly one horizontal gradient and
        // nothing else — the "flat translucent dome with no internal structure"
        // the review measured. The theta term is the bladder partition wall
        // pattern; the shader's own view-parallax density (gasSac) then shows it
        // through the far wall as well as the near one.
        mask: (u, v) => ({
          trans:
            (0.42 + 0.58 * Math.pow(Math.sin(v * Math.PI), 0.65)) *
            (0.72 + 0.28 * Math.pow(Math.abs(Math.cos(u * Math.PI * 5)), 0.5)),
          irid: 0.25,
          // Cavity, in the creases the warp above actually put there. `bladder`
          // is negative in a partition groove, so this darkens the albedo along
          // the seams between bladders and nowhere else — authored surface
          // variation keyed to authored form, which is what stops the shading
          // gradient and the albedo telling two different stories about the same
          // body. Shallow on purpose: wear is squared in the shader, so 0.45 in
          // the deepest crease is a 10% darkening, a crease and not a stripe.
          wear: 0.08 + 0.5 * Math.max(0, -bladder(u * Math.PI * 2) / 0.077),
        }),
      });
      // Dorsal crest — the bull netch's fin, catching the sun edge-on.
      //
      // IT MUST NOT BE PLANAR, and that is the whole of this rewrite. Both edges
      // used to be authored at x = 0, so the sheet between them was a flat plane
      // in x: every vertex normal on it was exactly +/-X, every fragment on it
      // took the same N.L, and a two-metre-wide sail sitting on top of the one
      // softly-shaded five-metre body in the frame resolved as a single hard-
      // edged constant-value plate. That is a shading discontinuity you can see
      // from a hundred metres — the review measured it as an "unlit facet across
      // the top of the bell" — and no amount of material tuning can fix it,
      // because a plane genuinely has one normal.
      //
      // A membranous crest is a RUFFLE that CURLS. Waving the free edge from
      // side to side is not on its own enough — moving both edges still leaves a
      // ruled surface, whose normal is pinned to the plane its two edges span,
      // and measured across the fin after that change the value still varied by
      // under 4/255. The curvature has to be out of plane, which is what `bow`
      // is for: the free edge rolls over sideways and drops as it goes, so the
      // top of the sheet is close to horizontal and faces the sky while its root
      // is vertical and faces the flank. That sweeps the normal through roughly
      // a quadrant, and a shading gradient across the fin is what makes it read
      // as a membrane rather than as a plate glued to the crown.
      mb.use('bell', M_THIN);
      const crestSpan = (u: number): number => Math.sin(u * Math.PI);
      const crestWave = (u: number): number => Math.sin(u * Math.PI * 3.0);
      membrane(mb.b, {
        // Up from 20x6: the ruffle is a 1.5-cycle wave across the span and the
        // curl turns the sheet through a quadrant, and at the old tessellation
        // both would resolve as facets — which is the defect this is fixing.
        nu: 30,
        nv: 9,
        // Rooted just inside the bell's crown and rising clear of it. Sunk any
        // lower it disappears inside the gasbag and reads as a painted stripe.
        edgeA: (u, out) => {
          const w = crestSpan(u);
          out.set(
            0.30 * crestWave(u) * w,
            3.55 + 0.95 * w - 0.11 * w * Math.cos(u * Math.PI * 7.0),
            (u - 0.5) * 4.2,
          );
        },
        edgeB: (u, out) => out.set(0.05 * crestWave(u), 3.05 + 0.15 * Math.sin(u * Math.PI), (u - 0.5) * 4.4),
        // The curl. Concentrated at the free edge (the power on 1-s) so the root
        // stays where the bell is and only the outer third of the sheet rolls;
        // the y term is what turns a shear into a roll, so the rolled part lies
        // over rather than merely leaning.
        bow: (u, s, out) => {
          const w = crestSpan(u);
          const c = Math.pow(1 - s, 1.8);
          const lean = crestWave(u);
          out.set(0.62 * lean * w * c, -0.34 * w * c * Math.abs(lean), 0);
        },
        thickness: 0.05,
        // TEXEL, and this is the second half of the flat-plate defect.
        //
        // `membrane` emits uv = u*texel*2, so at texel 1 the whole fin — 4.2 m
        // by 1.4 m — carried TWO texture repeats. The albedo, normal and ARM
        // maps are all mid-frequency mottle at that scale, so the entire fin
        // landed inside one blotch of the tiled set: one albedo, one normal, one
        // roughness over its whole area. Even with the geometry curled, a
        // surface with no texture variation across it can only ever read as a
        // painted plate. Eight repeats across the span puts the grain at the
        // same metres-per-repeat the bell beside it carries, which is the point:
        // two parts of one animal must not be sampling the same material at a
        // 4x frequency difference.
        texel: 3.6,
        // Thinnest at the free edge, where the light comes through, thickening
        // into the root that disappears into the gasbag. `membrane` puts s = 0
        // on edgeA (the free edge) and s = 1 on edgeB, on both faces.
        mask: (u, v) => {
          const s = v < 0.5 ? v * 2 : (1 - v) * 2;
          return { trans: 1 - 0.45 * s, irid: 0.3, wear: 0.3 * s * s };
        },
      });
      // Mantle: the leathery collar the tentacles hang from. Flatter and wider
      // than before so it reads as the underside of the canopy rather than as a
      // dark ball slung beneath it.
      mb.use('hide', M_HIDE);
      blob(mb.b, {
        centre: [0, 0.38, 0],
        radii: [2.05, 0.44, 2.3],
        nu: 22,
        nv: 10,
        texel: 3,
        warp: (th, ph, r) => {
          const f = 1 + 0.07 * Math.cos(th * 7);
          r.x *= f;
          r.z *= f;
        },
        // The collar is a wall a few centimetres thick like the rest of the
        // animal, and it is the part that faces the ground. Giving it a real
        // thickness — it had M_HIDE's 0.12, which is a hide, not a membrane —
        // is what lets the two-sided wrap in the shader carry sky and ground
        // bounce through it. Thickest at the rim, where the sight line runs
        // along the wall rather than through it.
        mask: (u, v) => ({
          trans: 0.45 + 0.55 * Math.pow(Math.sin(v * Math.PI), 0.5),
          irid: 0.1,
          wear: 0.35,
        }),
      });

      mb.use('tent', M_FLESH);
      for (let i = 0; i < TENT; i++) {
        const p = ring[i];
        const len = tentLen(i);
        const sway = 0.35 * Math.sin(i * 1.7);
        // Trailing, not hanging: the tentacles fall away from the rim, drift
        // outward under their own length and curl back in at the tip.
        const pts: V3[] = [
          [p[0], 0.15, p[2]],
          [p[0] * 1.16 + sway, 0.15 - len * 0.3, p[2] * 1.16],
          [p[0] * 1.34 - sway, 0.15 - len * 0.66, p[2] * 1.34 + sway],
          [p[0] * 1.2 + sway * 0.6, 0.15 - len, p[2] * 1.2],
        ];
        tube(mb.b, new Spine(pts, 24), {
          nu: 7,
          nv: 16,
          // Taper, and it has to be visible as taper. The old profile ran 0.33 m
          // at the root to 0.07 m at the tip through a 0.55 power, which spends
          // almost all of its narrowing in the last tenth of the length: over
          // the eighty percent of the tentacle you actually see it is a
          // near-constant 0.12-0.15 m tube, which is the review's "stiff flat
          // ribbon". A linear-ish 1.25 power over a wider range narrows visibly
          // the whole way down while keeping a tip that still resolves at
          // a hundred metres.
          radius: (v) => 0.30 * Math.pow(1 - v, 1.25) + 0.055,
          texel: 3,
          capA: true,
          capB: true,
          // AO gradient down the length — the other half of "uniform shading
          // along their length". The root disappears up into the mantle and is
          // occluded by the whole canopy above it; the tip hangs in open sky.
          // Thickness runs the other way, so the tip is also where the light
          // gets through.
          mask: (u, v) => ({
            trans: 0.35 + 0.65 * v,
            irid: 0.12,
            wear: 0.92 * Math.pow(1 - v, 1.6),
          }),
        });
      }
    },
    legs: [],
    spine: ['root', 'bell', 'crown'],
    head: null,
    whips: Array.from({ length: TENT }, (_, i) => [`t${i}_0`, `t${i}_1`, `t${i}_2`, `t${i}_3`]),
    wings: [],
    locomotion: 'drift',
    standHeight: 0,
    stride: 1,
    step: 0,
    duty: 0.5,
    walkSpeed: 1.1,
    runSpeed: 2.4,
    radius: 3.2,
    maxHealth: 90,
    faction: 'wild',
    scaleRange: [0.85, 1.35],
    lodScale: 3.0,
    altitude: [7, 15],
    surfaces: [],
    population: 5,
    stage: [70, 200],   // landmark tier — a 15 m gasbag must read as a mass
  };
}

/* -------------------------------------------------------- kwama forager */

function kwama(): SpeciesDef {
  const bones: BoneDef[] = [
    { name: 'root', parent: null, head: [0, 0.3, 0], tail: [0, 0.3, -0.3], r: 0.42 },
    { name: 'abdomen', parent: 'root', head: [0, 0.3, -0.14], tail: [0, 0.26, -0.55], r: 0.42 },
    { name: 'head', parent: 'root', head: [0, 0.29, 0.2], tail: [0, 0.26, 0.44], r: 0.3 },
  ];
  bonePair(bones, 'mand', () => 'head', [0.05, 0.24, 0.36], [0.09, 0.22, 0.55], 0.1, 0.6);

  // Three pairs, splayed forward/mid/back. Coxa yaws, femur and tibia solve.
  const hips: { z: number; x: number; out: number; ph: number }[] = [
    { z: 0.16, x: 0.14, out: 0.34, ph: 0.0 },
    { z: 0.0, x: 0.15, out: 0.4, ph: 0.5 },
    { z: -0.18, x: 0.14, out: 0.34, ph: 0.0 },
  ];
  const legs: LegDef[] = [];
  hips.forEach((h, i) => {
    for (const s of ['R', 'L']) {
      const sg = s === 'R' ? 1 : -1;
      const n = `leg${i}.${s}`;
      const hip: V3 = [h.x * sg, 0.3, h.z];
      const knee: V3 = [(h.x + h.out) * sg, 0.46, h.z + (i === 0 ? 0.16 : i === 2 ? -0.16 : 0)];
      const ankle: V3 = [(h.x + h.out * 1.55) * sg, 0.12, h.z + (i === 0 ? 0.26 : i === 2 ? -0.26 : 0)];
      const toe: V3 = [(h.x + h.out * 1.8) * sg, 0.0, h.z + (i === 0 ? 0.32 : i === 2 ? -0.32 : 0)];
      bones.push({ name: `${n}.a`, parent: 'root', head: hip, tail: knee, r: 0.2, bias: 1.1 });
      bones.push({ name: `${n}.b`, parent: `${n}.a`, head: knee, tail: ankle, r: 0.2, bias: 1.1 });
      bones.push({ name: `${n}.c`, parent: `${n}.b`, head: ankle, tail: toe, r: 0.16, bias: 1.1 });
      legs.push({
        upper: `${n}.a`,
        lower: `${n}.b`,
        foot: `${n}.c`,
        phase: (h.ph + (s === 'R' ? 0 : 0.5)) % 1,
        pole: [sg, 0.9, 0],
        rest: ankle,
        lift: 0.12,
      });
    }
  });

  return {
    kind: 'kwama',
    bones,
    materials: {
      // Chitin sits in the palette's chitin/bone band (#d8c9a4 -> #8f7d5a). A
      // forager rendered darker than the ash it stands on has no shading
      // gradient left to read at any distance — it can only ever be a
      // silhouette, which is what "reads as a scratch on the image" means.
      // Roughness up from 0.36. At 0.36 a curved shell carries ONE broad GGX
      // lobe across the whole dome and nothing else — which is precisely the
      // review's "smooth lambertian dome with one uniform specular sheen", and
      // it is also what made the legs read as near-white sticks, because a thin
      // cylinder is all grazing angle and therefore all highlight. At 0.46 the
      // lobe breaks up over the plate normals instead of gliding over them, and
      // the shader's down-facing roughness term (FRAG_ROUGH) takes the
      // sand-scuffed underside further still.
      chitin: { kind: 'chitin', color: 0x93815e, irid: 0.5, sheen: 0.42, sss: 0.2, sssColor: 0xd08a40, rough: 0.46, texel: 6 },
      soft: { kind: 'hide', color: 0x7b6b4d, irid: 0.14, sheen: 0.2, sss: 0.5, sssColor: 0xc07a40, rough: 0.72, texel: 8 },
      // Algae in the seams between the plates. Verdigris is in the book for
      // exactly this — "oxidised bronze, sparse vegetation" — and a forager that
      // spends its life in wet ash grows it where water sits, which is the
      // overlap line. It is the only thing on the animal that is not chitin, and
      // that is what stops the carapace reading as one moulded object.
      seam: { kind: 'hide', color: 0x5f7a63, irid: 0.05, sheen: 0.12, sss: 0.3, sssColor: 0x7fa080, rough: 0.78, texel: 10 },
    },
    build(mb) {
      mb.use('chitin', M_HARD);
      // Segmented carapace: overlapping plates rather than one shell.
      //
      // The plates were authored at a crown of y=0.40 while the body tube they
      // are supposed to be plating crowns at y≈0.58 — twenty centimetres inside
      // it on a half-metre animal — so every one of them was buried and the
      // review correctly measured the result as a featureless dome. Same class
      // of error as the silt strider's carapace, and the same fix: derive the
      // plate's height from the body's own profile so it cannot drift out of
      // register with it.
      const shellY = (z: number): number => {
        // Spine height and swept radius at this station, from the tube below.
        const v = THREE.MathUtils.clamp((z + 0.62) / 0.98, 0, 1);
        const spine = 0.29 + 0.06 * Math.sin(v * Math.PI * 0.9);
        return spine + 0.05 + 0.19 * Math.sin(Math.pow(v, 0.75) * Math.PI) + 0.02;
      };
      tube(mb.b, new Spine([[0, 0.29, -0.62], [0, 0.33, -0.35], [0, 0.35, -0.05], [0, 0.33, 0.2], [0, 0.3, 0.36]], 30), {
        nu: 16,
        nv: 26,
        radius: (v) => 0.05 + 0.19 * Math.sin(Math.pow(v, 0.75) * Math.PI) + 0.02,
        // Ridges. The cross-section keel is joined by a low banding down the
        // sweep, so the shell has relief of its own between the plates instead
        // of being a perfectly smooth surface of revolution under them.
        section: (a, v) =>
          (1 - 0.32 * Math.pow(Math.max(0, -Math.cos(a * Math.PI * 2)), 1.4)) *
          (1 + 0.035 * Math.cos(v * Math.PI * 9)),
        texel: 8,
        capA: true,
        capB: true,
      });
      for (let i = 0; i < 4; i++) {
        const z = -0.44 + i * 0.19;
        // 12 mm proud of the shell — a tenth of the plate's own thickness, which
        // at this scale is a plate step you can see and not a bulge.
        const top = shellY(z) + 0.012;
        blob(mb.b, {
          centre: [0, top - 0.115, z],
          radii: [0.205 - i * 0.008, 0.115, 0.125],
          nu: 16,
          nv: 8,
          texel: 8,
          // Cavity darkening under the lip of each plate.
          mask: (u, v) => ({ trans: 0, irid: 1, wear: 0.25 + 0.6 * Math.max(0, v - 0.62) / 0.38 }),
        });
      }
      // Algae in the plate seams. Three flattened rings, one per overlap.
      mb.use('seam', { trans: 0.1, irid: 0, wear: 0.5 });
      for (let i = 0; i < 3; i++) {
        const z = -0.35 + i * 0.19;
        blob(mb.b, {
          centre: [0, shellY(z) - 0.085, z],
          radii: [0.207, 0.085, 0.022],
          nu: 14,
          nv: 6,
          texel: 10,
        });
      }
      mb.use('soft', M_FLESH);
      blob(mb.b, { centre: [0, 0.28, 0.3], radii: [0.13, 0.11, 0.14], nu: 14, nv: 10, texel: 8 });
      mb.use('chitin', M_HARD);
      for (const s of [1, -1]) {
        spike(mb.b, [0.05 * s, 0.25, 0.36], [0.1 * s, 0.21, 0.58], 0.024, -0.01, M_HARD);
        // Antennae.
        spike(mb.b, [0.05 * s, 0.34, 0.34], [0.16 * s, 0.5, 0.58], 0.012, 0.04, M_HARD);
        mb.b.setMask(M_HARD);
      }

      hips.forEach((h, i) => {
        for (const s of [1, -1]) {
          const hip: V3 = [h.x * s, 0.3, h.z];
          const knee: V3 = [(h.x + h.out) * s, 0.46, h.z + (i === 0 ? 0.16 : i === 2 ? -0.16 : 0)];
          const ankle: V3 = [(h.x + h.out * 1.55) * s, 0.12, h.z + (i === 0 ? 0.26 : i === 2 ? -0.26 : 0)];
          const toe: V3 = [(h.x + h.out * 1.8) * s, 0.0, h.z + (i === 0 ? 0.32 : i === 2 ? -0.32 : 0)];
          // Leg links carry a hard lower bound on radius. A 8 mm tibia is
          // sub-pixel from about fifteen metres out, and geometry that thin can
          // only rasterise as an aliased polyline no matter what shades it.
          insectLeg(mb, [hip, knee, ankle, toe], [0.052, 0.043, 0.033, 0.02], [
            [0, 0.02, 0],
            [0.01 * s, 0.01, 0],
            [0, -0.005, 0],
          ]);
        }
      });
    },
    legs,
    spine: ['root', 'head'],
    head: 'head',
    whips: [],
    wings: [],
    locomotion: 'ground',
    standHeight: 0.3,
    stride: 0.42,
    step: 0.09,
    duty: 0.62,
    walkSpeed: 0.9,
    runSpeed: 2.6,
    radius: 0.5,
    maxHealth: 20,
    faction: 'wild',
    scaleRange: [0.8, 1.2],
    lodScale: 0.8,
    surfaces: [0, 1, 3, 4],
    population: 11,
    stage: [14, 130],   // small; the near end is what makes it resolve at all
  };
}

/* ------------------------------------------------------------- nix-hound */

function nixHound(): SpeciesDef {
  const bones: BoneDef[] = [
    { name: 'root', parent: null, head: [0, 0.62, -0.1], tail: [0, 0.62, 0.3], r: 0.6 },
    { name: 'spine', parent: 'root', head: [0, 0.62, 0.1], tail: [0, 0.66, 0.5], r: 0.55 },
    { name: 'neck', parent: 'spine', head: [0, 0.66, 0.48], tail: [0, 0.6, 0.72], r: 0.35 },
    { name: 'head', parent: 'neck', head: [0, 0.6, 0.72], tail: [0, 0.5, 1.04], r: 0.35 },
    { name: 'tail1', parent: 'root', head: [0, 0.62, -0.22], tail: [0, 0.56, -0.6], r: 0.28 },
    { name: 'tail2', parent: 'tail1', head: [0, 0.56, -0.6], tail: [0, 0.44, -0.95], r: 0.26 },
  ];
  const hips: { z: number; x: number; out: number; ph: number; fwd: number }[] = [
    { z: 0.42, x: 0.19, out: 0.16, ph: 0.0, fwd: 0.24 },
    { z: -0.16, x: 0.21, out: 0.18, ph: 0.5, fwd: -0.2 },
  ];
  const legs: LegDef[] = [];
  hips.forEach((h, i) => {
    for (const s of ['R', 'L']) {
      const sg = s === 'R' ? 1 : -1;
      const n = `leg${i}.${s}`;
      const hip: V3 = [h.x * sg, 0.6, h.z];
      const knee: V3 = [(h.x + h.out) * sg, 0.44, h.z + h.fwd * 0.6];
      const ankle: V3 = [(h.x + h.out * 1.2) * sg, 0.2, h.z + h.fwd * 0.2];
      const toe: V3 = [(h.x + h.out * 1.35) * sg, 0.0, h.z + h.fwd * 0.55];
      bones.push({ name: `${n}.a`, parent: i === 0 ? 'spine' : 'root', head: hip, tail: knee, r: 0.26, bias: 1.1 });
      bones.push({ name: `${n}.b`, parent: `${n}.a`, head: knee, tail: ankle, r: 0.24, bias: 1.1 });
      bones.push({ name: `${n}.c`, parent: `${n}.b`, head: ankle, tail: toe, r: 0.2, bias: 1.1 });
      legs.push({
        upper: `${n}.a`,
        lower: `${n}.b`,
        foot: `${n}.c`,
        phase: (h.ph + (s === 'R' ? 0 : 0.5)) % 1,
        pole: [sg * 0.35, 0, i === 0 ? 1 : -1],
        rest: ankle,
        lift: 0.2,
      });
    }
  });

  return {
    kind: 'nixhound',
    bones,
    materials: {
      shell: { kind: 'chitin', color: 0x8a7a58, irid: 0.55, sheen: 0.65, sss: 0.15, sssColor: 0xb06a34, rough: 0.34, texel: 5 },
      hide: { kind: 'hide', color: 0x5e5747, irid: 0.12, sheen: 0.2, sss: 0.4, sssColor: 0xa05a30, rough: 0.78, texel: 7 },
      // Legs get their own chitin rather than sharing the body hide. They are
      // the thinnest thing on the animal and the first to lose their shading
      // gradient, so they need the brightest albedo and the strongest sheen —
      // the lobe along the limb axis is what turns a stick into a volume.
      limb: { kind: 'chitin', color: 0x93825e, irid: 0.4, sheen: 0.85, sss: 0.2, sssColor: 0xb06a34, rough: 0.35, texel: 6 },
    },
    build(mb) {
      mb.use('hide', M_HIDE);
      tube(mb.b, new Spine([[0, 0.4, -1.0], [0, 0.58, -0.55], [0, 0.64, -0.1], [0, 0.66, 0.36], [0, 0.6, 0.66], [0, 0.52, 0.96]], 36), {
        nu: 14,
        nv: 30,
        radius: (v) => {
          if (v < 0.2) return 0.02 + 0.16 * (v / 0.2);
          if (v > 0.78) return 0.19 * (1 - (v - 0.78) / 0.22) + 0.04;
          return 0.18 + 0.06 * Math.sin((v - 0.2) / 0.58 * Math.PI);
        },
        section: (a) => 1 - 0.18 * Math.pow(Math.max(0, Math.cos(a * Math.PI * 2)), 2),
        texel: 6,
        capA: true,
        capB: true,
      });
      // Dorsal shell: overlapping plates from shoulder to hip. No eyes anywhere
      // on this animal — the head is a smooth wedge of shell and mandibles.
      mb.use('shell', M_HARD);
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        const z = 0.42 - t * 0.85;
        blob(mb.b, {
          centre: [0, 0.7 + 0.02 * Math.sin(t * Math.PI), z],
          radii: [0.2 - 0.03 * t, 0.13, 0.14],
          nu: 16,
          nv: 8,
          texel: 6,
          warp: (th, ph, r) => {
            r.y *= 0.5 + 0.5 * Math.sin(ph);
          },
        });
      }
      blob(mb.b, {
        centre: [0, 0.58, 0.8],
        radii: [0.13, 0.12, 0.2],
        nu: 16,
        nv: 10,
        texel: 6,
        warp: (th, ph, r) => {
          r.y *= 0.85;
        },
      });
      for (const s of [1, -1]) {
        spike(mb.b, [0.06 * s, 0.52, 0.92], [0.11 * s, 0.44, 1.16], 0.035, -0.02, M_HARD);
        spike(mb.b, [0.09 * s, 0.72, 0.28], [0.18 * s, 0.95, 0.1], 0.03, 0.03, M_HARD);
        mb.b.setMask(M_HARD);
      }
      mb.use('limb', M_HARD);
      hips.forEach((h, i) => {
        for (const s of [1, -1]) {
          const hip: V3 = [h.x * s, 0.6, h.z];
          const knee: V3 = [(h.x + h.out) * s, 0.44, h.z + h.fwd * 0.6];
          const ankle: V3 = [(h.x + h.out * 1.2) * s, 0.2, h.z + h.fwd * 0.2];
          const toe: V3 = [(h.x + h.out * 1.35) * s, 0.0, h.z + h.fwd * 0.55];
          insectLeg(mb, [hip, knee, ankle, toe], [0.085, 0.068, 0.05, 0.03], [
            [0, 0.01, h.fwd * 0.1],
            [0, -0.01, 0],
            [0, 0, 0.01],
          ]);
        }
      });
    },
    legs,
    spine: ['root', 'spine', 'neck', 'head'],
    head: 'head',
    whips: [['tail1', 'tail2']],
    wings: [],
    locomotion: 'ground',
    standHeight: 0.62,
    stride: 1.3,
    step: 0.22,
    duty: 0.52,
    walkSpeed: 1.9,
    runSpeed: 7.5,
    radius: 0.7,
    maxHealth: 55,
    faction: 'predator',
    scaleRange: [0.85, 1.15],
    lodScale: 1.0,
    surfaces: [0, 1, 2],
    population: 6,
    stage: [16, 150],
  };
}

/* ------------------------------------------------------------------- guar */

function guar(): SpeciesDef {
  const bones: BoneDef[] = [
    { name: 'root', parent: null, head: [0, 1.02, -0.1], tail: [0, 1.05, 0.25], r: 0.75 },
    { name: 'spine', parent: 'root', head: [0, 1.04, 0.1], tail: [0, 1.12, 0.5], r: 0.7 },
    { name: 'chest', parent: 'spine', head: [0, 1.12, 0.48], tail: [0, 1.2, 0.78], r: 0.6 },
    { name: 'neck', parent: 'chest', head: [0, 1.18, 0.66], tail: [0, 1.52, 1.06], r: 0.5 },
    { name: 'head', parent: 'neck', head: [0, 1.52, 1.06], tail: [0, 1.58, 1.58], r: 0.55 },
    { name: 'tail1', parent: 'root', head: [0, 1.0, -0.28], tail: [0, 0.94, -0.75], r: 0.35 },
    { name: 'tail2', parent: 'tail1', head: [0, 0.94, -0.75], tail: [0, 0.8, -1.2], r: 0.33 },
    { name: 'tail3', parent: 'tail2', head: [0, 0.8, -1.2], tail: [0, 0.62, -1.62], r: 0.3 },
  ];
  bonePair(bones, 'armA', () => 'chest', [0.19, 1.12, 0.62], [0.3, 0.86, 0.72], 0.2, 0.8);
  bonePair(bones, 'armB', (s) => `armA.${s}`, [0.3, 0.86, 0.72], [0.34, 0.66, 0.84], 0.18, 0.8);

  const legs: LegDef[] = [];
  for (const s of ['R', 'L']) {
    const sg = s === 'R' ? 1 : -1;
    const n = `leg.${s}`;
    const hip: V3 = [0.25 * sg, 1.0, -0.02];
    const knee: V3 = [0.28 * sg, 0.62, 0.22];
    const ankle: V3 = [0.27 * sg, 0.3, -0.1];
    const toe: V3 = [0.27 * sg, 0.0, 0.08];
    bones.push({ name: `${n}.a`, parent: 'root', head: hip, tail: knee, r: 0.35, bias: 1.15 });
    bones.push({ name: `${n}.b`, parent: `${n}.a`, head: knee, tail: ankle, r: 0.3, bias: 1.15 });
    bones.push({ name: `${n}.c`, parent: `${n}.b`, head: ankle, tail: toe, r: 0.26, bias: 1.15 });
    legs.push({
      upper: `${n}.a`,
      lower: `${n}.b`,
      foot: `${n}.c`,
      phase: s === 'R' ? 0 : 0.5,
      pole: [sg * 0.2, 0, 1],
      rest: ankle,
      lift: 0.3,
    });
  }

  return {
    kind: 'guar',
    bones,
    materials: {
      hide: { kind: 'hide', color: 0x776b5a, irid: 0.14, sheen: 0.2, sss: 0.5, sssColor: 0xc07a48, rough: 0.8, texel: 4 },
      belly: { kind: 'hide', color: 0x93866d, irid: 0.09, sheen: 0.15, sss: 0.9, sssColor: 0xd08a52, rough: 0.85, texel: 5 },
      horn: { kind: 'shell', color: 0xc9b891, irid: 0.14, sheen: 0.35, sss: 0.4, sssColor: 0xd08a50, rough: 0.42, texel: 6 },
    },
    build(mb) {
      mb.use('hide', M_HIDE);
      // Deep barrel body slung between the hips, heavy tail counterweight —
      // a pack lizard reads as front-heavy or it looks like a raptor.
      tube(mb.b, new Spine([[0, 0.5, -1.75], [0, 0.82, -1.15], [0, 1.02, -0.45], [0, 1.14, 0.2], [0, 1.18, 0.6], [0, 1.16, 0.78]], 40), {
        nu: 18,
        nv: 34,
        radius: (v) => {
          if (v < 0.16) return 0.03 + 0.2 * (v / 0.16);
          if (v > 0.84) return 0.3 * (1 - ((v - 0.84) / 0.16) * 0.45);
          const t = (v - 0.16) / 0.68;
          return 0.26 + 0.25 * Math.sin(Math.pow(t, 0.8) * Math.PI);
        },
        section: (a, v) => 1 - 0.12 * Math.cos(a * Math.PI * 2) * (v > 0.3 ? 1 : 0),
        texel: 5,
        capA: true,
        capB: true,
      });
      // Neck: long and S-curved, carrying the head well clear of the shoulders.
      // Without it the animal reads as a slug with legs.
      tube(mb.b, new Spine([[0, 1.16, 0.5], [0, 1.3, 0.78], [0, 1.48, 1.0], [0, 1.55, 1.16]], 26), {
        nu: 14,
        nv: 18,
        radius: (v) => 0.2 - 0.075 * v,
        texel: 6,
        capA: true,
      });
      // Head: a blunt wedge with a long jaw and paired horn nubs.
      mb.use('hide', M_HIDE);
      blob(mb.b, {
        centre: [0, 1.57, 1.28],
        radii: [0.155, 0.16, 0.28],
        nu: 18,
        nv: 12,
        texel: 6,
        warp: (th, ph, r) => {
          r.y *= 0.92;
        },
      });
      mb.use('belly', M_FLESH);
      blob(mb.b, {
        centre: [0, 1.5, 1.5],
        radii: [0.115, 0.095, 0.2],
        nu: 14,
        nv: 10,
        texel: 7,
      });
      mb.use('horn', M_HARD);
      for (const s of [1, -1]) {
        spike(mb.b, [0.09 * s, 1.66, 1.2], [0.15 * s, 1.92, 1.04], 0.035, 0.02, M_HARD);
        spike(mb.b, [0.12 * s, 1.53, 1.34], [0.19 * s, 1.63, 1.44], 0.022, 0.01, M_HARD);
        mb.b.setMask(M_HARD);
      }
      // Dorsal frill down the spine — the guar's readable top line.
      mb.use('horn', M_THIN);
      // Dorsal frill: a narrow sail that follows the back line and dies away
      // into the tail. It reads on the silhouette; any taller and the animal
      // starts to look like a dimetrodon.
      membrane(mb.b, {
        nu: 22,
        nv: 4,
        edgeA: (u, out) => {
          const z = 0.68 - u * 2.2;
          const back = 1.2 + 0.22 * Math.sin(Math.min(1, u * 1.4) * Math.PI) - 0.5 * Math.max(0, u - 0.75) * 2.2;
          out.set(0, back + 0.18 * Math.sin(u * Math.PI) * (1 - u * 0.6), z);
        },
        edgeB: (u, out) => {
          const z = 0.68 - u * 2.2;
          const back = 1.2 + 0.22 * Math.sin(Math.min(1, u * 1.4) * Math.PI) - 0.5 * Math.max(0, u - 0.75) * 2.2;
          out.set(0, back, z);
        },
        thickness: 0.016,
        texel: 1.6,
        mask: () => ({ trans: 1, irid: 0.4, wear: 0.2 }),
      });

      mb.use('hide', M_HIDE);
      for (const s of [1, -1]) {
        const hip: V3 = [0.25 * s, 1.0, -0.02];
        const knee: V3 = [0.28 * s, 0.62, 0.22];
        const ankle: V3 = [0.27 * s, 0.3, -0.1];
        const toe: V3 = [0.27 * s, 0.0, 0.08];
        limb(mb, [0.22 * s, 1.06, 0.0], knee, 0.25, 0.14, [0.02 * s, 0, 0.03], 11, 9);
        limb(mb, knee, ankle, 0.14, 0.085, [0, 0, -0.03], 10, 9);
        limb(mb, ankle, toe, 0.085, 0.06, [0, -0.01, 0.02], 9, 7);
        // Splayed three-toed foot.
        for (let k = -1; k <= 1; k++) {
          limb(mb, toe, [toe[0] + 0.08 * k * s, 0.015, toe[2] + 0.16 - 0.03 * Math.abs(k)], 0.04, 0.016, [0, 0.01, 0], 6, 4);
        }
        // Vestigial arms.
        limb(mb, [0.19 * s, 1.12, 0.62], [0.3 * s, 0.86, 0.72], 0.07, 0.045, [0.02 * s, 0, 0.02], 8, 6);
        limb(mb, [0.3 * s, 0.86, 0.72], [0.34 * s, 0.66, 0.84], 0.045, 0.025, [0, 0, 0.02], 7, 5);
      }
    },
    legs,
    spine: ['root', 'spine', 'chest', 'neck', 'head'],
    head: 'head',
    whips: [['tail1', 'tail2', 'tail3']],
    wings: [],
    locomotion: 'ground',
    standHeight: 1.02,
    stride: 1.7,
    step: 0.24,
    duty: 0.62,
    walkSpeed: 1.5,
    runSpeed: 4.6,
    radius: 1.0,
    maxHealth: 80,
    faction: 'pack',
    scaleRange: [0.9, 1.18],
    lodScale: 1.2,
    surfaces: [0, 1, 2, 3, 4],
    population: 5,
    stage: [22, 140],
  };
}

/* ------------------------------------------------------------ silt strider */

/**
 * The set piece. A flea the size of a building: a hollowed chitin shell on six
 * jointed legs that span twenty-five metres, walking at a crawl. Everything
 * about it is proportion — the legs must look too thin to hold it up, and the
 * shell must sit high enough that you look up at it from the ground.
 */
function siltStrider(): SpeciesDef {
  const BODY_Y = 8.4;
  const bones: BoneDef[] = [
    { name: 'root', parent: null, head: [0, BODY_Y, 0], tail: [0, BODY_Y, -3], r: 6.5 },
    { name: 'abdomen', parent: 'root', head: [0, BODY_Y + 0.2, -2.2], tail: [0, BODY_Y - 0.6, -7.5], r: 6.0 },
    { name: 'neck', parent: 'root', head: [0, BODY_Y - 0.4, 3.0], tail: [0, BODY_Y - 1.6, 4.6], r: 2.6 },
    { name: 'head', parent: 'neck', head: [0, BODY_Y - 1.6, 4.6], tail: [0, BODY_Y - 2.8, 6.4], r: 2.6 },
    { name: 'probo', parent: 'head', head: [0, BODY_Y - 2.6, 6.0], tail: [0, BODY_Y - 4.6, 8.6], r: 1.8, bias: 0.8 },
  ];

  const hips: { z: number; x: number; ph: number; fwd: number; span: number }[] = [
    { z: 2.4, x: 1.5, ph: 0.0, fwd: 5.2, span: 7.4 },
    { z: -0.4, x: 1.7, ph: 0.5, fwd: 0.6, span: 8.6 },
    { z: -3.4, x: 1.5, ph: 0.0, fwd: -4.4, span: 7.6 },
  ];
  const legs: LegDef[] = [];
  hips.forEach((h, i) => {
    for (const s of ['R', 'L']) {
      const sg = s === 'R' ? 1 : -1;
      const n = `leg${i}.${s}`;
      const hip: V3 = [h.x * sg, BODY_Y - 0.6, h.z];
      // The knee rides ABOVE the body — that inverted-V is the whole strider
      // silhouette, and it is what an insect leg actually does at this scale.
      const knee: V3 = [(h.x + 2.6) * sg, BODY_Y + 3.6, h.z + h.fwd * 0.25];
      const ankle: V3 = [(h.x + h.span * 0.78) * sg, 2.6, h.z + h.fwd * 0.72];
      const toe: V3 = [(h.x + h.span) * sg, 0.0, h.z + h.fwd];
      bones.push({ name: `${n}.a`, parent: 'root', head: hip, tail: knee, r: 2.2, bias: 1.2 });
      bones.push({ name: `${n}.b`, parent: `${n}.a`, head: knee, tail: ankle, r: 2.2, bias: 1.2 });
      bones.push({ name: `${n}.c`, parent: `${n}.b`, head: ankle, tail: toe, r: 1.8, bias: 1.2 });
      legs.push({
        upper: `${n}.a`,
        lower: `${n}.b`,
        foot: `${n}.c`,
        phase: (h.ph + (s === 'R' ? 0 : 0.5)) % 1,
        pole: [sg, 2.2, 0],
        rest: ankle,
        lift: 2.6,
      });
    }
  });

  return {
    kind: 'siltstrider',
    bones,
    materials: {
      shell: { kind: 'chitin', color: 0xa08d68, irid: 0.4, sheen: 0.5, sss: 0.2, sssColor: 0xc07a40, rough: 0.4, texel: 1.1 },
      // Basalt underbelly under a chitin shell. With the domed carapace above it
      // (see build) this material is now the flanks and the belly, and the
      // palette's answer for the shaded mass under a bright shell is basalt,
      // not a second, muddier chitin.
      hide: { kind: 'hide', color: 0x554b3c, irid: 0.12, sheen: 0.2, sss: 0.35, sssColor: 0xb06a38, rough: 0.82, texel: 1.6 },
      bone: { kind: 'shell', color: 0xb3a179, irid: 0.14, sheen: 0.35, sss: 0.3, sssColor: 0xc07840, rough: 0.5, texel: 1.4 },
      // Twenty-five metres of leg, seen from two hundred. Nothing else on the
      // animal is at more risk of dissolving into a black line, so the legs get
      // the brightest chitin in the palette band and the hardest sheen.
      limb: { kind: 'chitin', color: 0x9d8a66, irid: 0.34, sheen: 0.9, sss: 0.2, sssColor: 0xc07a40, rough: 0.36, texel: 1.5 },
    },
    build(mb) {
      const Y = BODY_Y;
      mb.use('hide', M_HIDE);
      // Thorax and abdomen as one swept mass, keeled underneath.
      tube(
        mb.b,
        new Spine(
          [
            [0, Y - 1.9, 5.6],
            [0, Y - 0.9, 3.2],
            [0, Y - 0.1, 0.6],
            [0, Y + 0.2, -2.4],
            [0, Y - 0.5, -5.6],
            [0, Y - 1.6, -7.8],
          ],
          48,
        ),
        {
          nu: 26,
          nv: 40,
          radius: (v) => {
            if (v < 0.14) return 0.5 + 1.4 * (v / 0.14);
            if (v > 0.86) return 1.2 * (1 - (v - 0.86) / 0.14) + 0.12;
            const t = (v - 0.14) / 0.72;
            return 1.9 + 1.5 * Math.sin(Math.pow(t, 0.8) * Math.PI);
          },
          section: (a, v) => 1 - 0.16 * Math.pow(Math.max(0, -Math.cos(a * Math.PI * 2)), 1.5) * (v > 0.25 ? 1 : 0),
          texel: 1.5,
          capA: true,
          capB: true,
        },
      );

      // ------------------------------------------------------- the carapace
      //
      // The one silhouette note that makes a silt strider a silt strider is the
      // high domed shell over the thorax. It had been authored as six plate
      // blobs whose peak sits at Y+2.9 — INSIDE the body tube, whose own crown
      // is at Y+3.4 — so not one of them broke the outline and the animal read,
      // exactly as the review put it, as a triangular scaffold: six legs, a
      // sausage, no hump. A plate that never clears the surface it is plated
      // onto is not plating, it is hidden geometry.
      //
      // So the hump is a single shell that owns the top line, flat-bottomed so
      // it wraps the thorax rather than engulfing it, and the remaining plates
      // ride ON it. Four of them, not six, at lower tessellation: the dome
      // carries the read now, and this is the heaviest mesh in the bestiary.
      mb.use('shell', M_HARD);
      blob(mb.b, {
        centre: [0, Y + 0.55, -0.7],
        radii: [3.85, 3.5, 5.7],
        nu: 26,
        nv: 14,
        texel: 1.2,
        warp: (th, ph, r) => {
          // ph = 0 at the crown. The underside is cut away so the shell is a
          // carapace over the back and not an egg the legs stick out of.
          const low = Math.max(0, -Math.cos(ph));
          r.y *= 1 - 0.74 * low;
          const rib = 1 + 0.045 * Math.cos(th * 10);
          r.x *= rib;
          r.z *= rib;
        },
        // Cavity darkening where the shell rolls under toward the body.
        mask: (u, v) => ({ trans: 0, irid: 1, wear: 0.25 + 0.55 * Math.max(0, v - 0.55) / 0.45 }),
      });
      // Overlapping plates over the crown of the dome, with the passenger
      // cavity cut into the port flank — the detail that makes it a vehicle.
      for (let i = 0; i < 4; i++) {
        const t = i / 3;
        const z = 2.2 - t * 6.6;
        // Follow the dome's own profile rather than a hand-tuned curve, so every
        // plate is proud of the shell by the same 16 cm at every station. This
        // is the whole reason the old plates vanished: their curve and the
        // body's were authored independently and the body won.
        const dz = (z + 0.7) / 5.7;
        const k = Math.sqrt(Math.max(0.05, 1 - dz * dz));
        const w = 3.85 * k * 0.94;
        const top = Y + 0.55 + 3.5 * k + 0.16;
        blob(mb.b, {
          centre: [0, top - 1.35, z],
          radii: [w, 1.35, 1.5],
          nu: 24,
          nv: 10,
          texel: 1.2,
          warp: (th, ph, r) => {
            const rib = 1 + 0.05 * Math.cos(th * 12);
            r.x *= rib;
            r.z *= rib;
          },
          // Dark in the overlap where the next plate laps over this one.
          mask: (u, v) => ({ trans: 0, irid: 1, wear: 0.2 + 0.6 * Math.max(0, v - 0.6) / 0.4 }),
        });
      }
      // Cabin: a hollow scooped into the shell, framed with bone ribs.
      mb.use('bone', M_HARD);
      for (let i = 0; i < 5; i++) {
        const z = 1.4 - i * 1.0;
        const s = i % 2 === 0 ? -1 : -1;
        tube(
          mb.b,
          new Spine(
            [
              [2.4 * s, Y - 1.2, z],
              [3.3 * s, Y + 0.4, z],
              [2.9 * s, Y + 2.2, z],
              [1.2 * s, Y + 3.0, z],
            ],
            18,
          ),
          { nu: 7, nv: 12, radius: () => 0.13, texel: 1.5, capA: true, capB: true },
        );
      }
      mb.use('hide', M_FLESH);
      // Recessed cabin floor and back wall, so the hollow reads as a volume.
      blob(mb.b, {
        centre: [-2.1, Y + 0.6, -0.6],
        radii: [1.2, 1.7, 2.6],
        nu: 16,
        nv: 10,
        texel: 2,
      });

      // Head and proboscis.
      mb.use('shell', M_HARD);
      blob(mb.b, {
        centre: [0, Y - 2.0, 5.1],
        radii: [1.5, 1.5, 1.9],
        nu: 20,
        nv: 12,
        texel: 1.4,
        warp: (th, ph, r) => {
          r.y *= 0.9;
        },
      });
      mb.use('hide', M_HIDE);
      tube(mb.b, new Spine([[0, Y - 2.4, 5.9], [0, Y - 3.4, 7.0], [0, Y - 4.6, 8.4], [0, Y - 5.4, 9.2]], 22), {
        nu: 12,
        nv: 16,
        radius: (v) => 0.85 * Math.pow(1 - v, 0.6) + 0.06,
        texel: 2,
        capA: true,
        capB: true,
      });
      mb.use('bone', M_HARD);
      for (const s of [1, -1]) {
        spike(mb.b, [0.7 * s, Y - 1.2, 5.4], [1.6 * s, Y + 1.6, 4.2], 0.28, 0.2, M_HARD);
        mb.b.setMask(M_HARD);
      }

      // Legs: three tapered links each, absurdly long and thin.
      hips.forEach((h, i) => {
        for (const s of [1, -1]) {
          const hip: V3 = [h.x * s, Y - 0.6, h.z];
          const knee: V3 = [(h.x + 2.6) * s, Y + 3.6, h.z + h.fwd * 0.25];
          const ankle: V3 = [(h.x + h.span * 0.78) * s, 2.6, h.z + h.fwd * 0.72];
          const toe: V3 = [(h.x + h.span) * s, 0.0, h.z + h.fwd];
          mb.use('limb', M_HARD);
          limb(mb, hip, knee, 1.0, 0.58, [0.2 * s, 0.2, 0], 12, 12);
          mb.use('shell', M_HARD);
          blob(mb.b, { centre: knee, radii: [0.76, 0.84, 0.76], nu: 14, nv: 10, texel: 2 });
          mb.use('limb', M_HARD);
          limb(mb, knee, ankle, 0.58, 0.32, [0.1 * s, -0.4, 0], 11, 12);
          // The foot link used to taper to 8.5 cm. At the two hundred metres a
          // strider is normally seen from that is a tenth of a pixel: it can
          // only ever be an aliased line. 20 cm still reads as absurdly thin
          // against a nine-metre body, which is the point of the silhouette.
          limb(mb, ankle, toe, 0.32, 0.2, [0, -0.1, 0.1], 9, 9);
        }
      });
    },
    legs,
    spine: ['root', 'neck', 'head'],
    head: 'head',
    whips: [['probo']],
    wings: [],
    locomotion: 'ground',
    standHeight: BODY_Y,
    stride: 9.5,
    step: 2.4,
    duty: 0.66,
    walkSpeed: 1.3,
    runSpeed: 2.0,
    radius: 8,
    maxHealth: 600,
    faction: 'tame',
    scaleRange: [1, 1],
    lodScale: 8,
    surfaces: [],
    population: 1,
    stage: [110, 260],  // landmark tier — the strider IS the skyline
  };
}

/* ------------------------------------------------------------ dunmer NPC */

function dunmer(): SpeciesDef {
  const bones: BoneDef[] = [
    { name: 'root', parent: null, head: [0, 0.95, 0], tail: [0, 1.12, 0], r: 0.34 },
    { name: 'spine', parent: 'root', head: [0, 1.05, 0], tail: [0, 1.3, 0.01], r: 0.34 },
    { name: 'chest', parent: 'spine', head: [0, 1.3, 0.01], tail: [0, 1.5, 0.02], r: 0.36 },
    { name: 'neck', parent: 'chest', head: [0, 1.5, 0.02], tail: [0, 1.62, 0.02], r: 0.16 },
    { name: 'head', parent: 'neck', head: [0, 1.62, 0.02], tail: [0, 1.83, 0.02], r: 0.24 },
  ];
  bonePair(bones, 'armA', () => 'chest', [0.19, 1.45, 0.01], [0.24, 1.18, 0.01], 0.19, 0.85);
  bonePair(bones, 'armB', (s) => `armA.${s}`, [0.24, 1.18, 0.01], [0.26, 0.92, 0.02], 0.17, 0.85);
  bonePair(bones, 'hand', (s) => `armB.${s}`, [0.26, 0.92, 0.02], [0.27, 0.8, 0.03], 0.12, 0.7);

  const legs: LegDef[] = [];
  for (const s of ['R', 'L']) {
    const sg = s === 'R' ? 1 : -1;
    const n = `leg.${s}`;
    const hip: V3 = [0.1 * sg, 0.94, 0];
    const knee: V3 = [0.11 * sg, 0.52, 0.02];
    const ankle: V3 = [0.11 * sg, 0.1, 0];
    const toe: V3 = [0.11 * sg, 0.02, 0.12];
    bones.push({ name: `${n}.a`, parent: 'root', head: hip, tail: knee, r: 0.24, bias: 1.15 });
    bones.push({ name: `${n}.b`, parent: `${n}.a`, head: knee, tail: ankle, r: 0.22, bias: 1.15 });
    bones.push({ name: `${n}.c`, parent: `${n}.b`, head: ankle, tail: toe, r: 0.18, bias: 1.15 });
    legs.push({
      upper: `${n}.a`,
      lower: `${n}.b`,
      foot: `${n}.c`,
      phase: s === 'R' ? 0 : 0.5,
      pole: [sg * 0.15, 0, 1],
      rest: ankle,
      lift: 0.1,
    });
  }

  return {
    kind: 'dunmer',
    bones,
    materials: {
      // Ashen grey skin with a warm subsurface — the transmission is what keeps
      // grey skin from reading as stone, and it blooms on the ears.
      skin: { kind: 'skin', color: 0x7b7674, irid: 0, sss: 1.1, sssColor: 0xa8523c, rough: 0.52, texel: 8 },
      robe: { kind: 'cloth', color: 0x6b5646, irid: 0, sss: 0.35, sssColor: 0x8a5a3a, rough: 0.88, texel: 3 },
      trim: { kind: 'metal', color: 0x6d6a52, irid: 0.22, sss: 0, rough: 0.36, metal: 0.85, texel: 6 },
      eye: { kind: 'skin', color: 0x110604, irid: 0, sss: 0, rough: 0.16, emissive: 0xc42a12, emissiveIntensity: 1.3, texel: 20 },
    },
    build(mb) {
      // Head, hands and forearms are skin; everything else is a robe, which is
      // both correct for a Dunmer commoner and cheap to deform well.
      mb.use('skin', { trans: 0.4, irid: 0, wear: 0.1 });
      blob(mb.b, {
        centre: [0, 1.71, 0.01],
        radii: [0.088, 0.115, 0.098],
        nu: 20,
        nv: 14,
        texel: 8,
        warp: (th, ph, r) => {
          // Narrow jaw, high cheekbones.
          const down = Math.max(0, Math.cos(ph) * -1);
          r.x *= 1 - 0.28 * down;
          r.z *= 1 + 0.12 * Math.max(0, Math.sin(th)) * (1 - down);
        },
      });
      // Ears: long, swept back, and thin enough to glow through.
      for (const s of [1, -1]) {
        membrane(mb.b, {
          nu: 10,
          nv: 5,
          edgeA: (u, out) => out.set(0.078 * s + 0.05 * u * s, 1.72 + 0.13 * u, 0.01 - 0.06 * u),
          edgeB: (u, out) => out.set(0.07 * s + 0.02 * u * s, 1.68 + 0.06 * u, 0.02 - 0.02 * u),
          thickness: 0.006,
          texel: 6,
          mask: () => ({ trans: 1, irid: 0, wear: 0 }),
        });
      }
      mb.use('eye', { trans: 0, irid: 0, wear: 0 });
      for (const s of [1, -1]) {
        blob(mb.b, { centre: [0.034 * s, 1.727, 0.082], radii: [0.011, 0.008, 0.009], nu: 8, nv: 6, texel: 20 });
      }
      mb.use('skin', { trans: 0.5, irid: 0, wear: 0.1 });
      tube(mb.b, new Spine([[0, 1.58, 0.01], [0, 1.64, 0.01]], 8), {
        nu: 10,
        nv: 5,
        radius: () => 0.045,
        texel: 8,
      });
      for (const s of [1, -1]) {
        limb(mb, [0.24 * s, 1.18, 0.01], [0.26 * s, 0.94, 0.02], 0.035, 0.03, [0.01 * s, 0, 0.01], 8, 6);
        blob(mb.b, { centre: [0.265 * s, 0.87, 0.03], radii: [0.035, 0.06, 0.045], nu: 10, nv: 8, texel: 10 });
      }

      mb.use('robe', M_CLOTH);
      // Robe: a bell from the shoulders to the ankles. Skinned across the hips
      // so it swings rather than shearing.
      tube(mb.b, new Spine([[0, 1.5, 0.01], [0, 1.24, 0.01], [0, 0.95, 0], [0, 0.6, 0], [0, 0.22, 0], [0, 0.1, 0]], 40), {
        nu: 20,
        nv: 30,
        radius: (v) => {
          if (v < 0.08) return 0.13 + 0.5 * v;
          const t = (v - 0.08) / 0.92;
          return 0.17 + 0.19 * Math.pow(t, 1.7);
        },
        section: (a) => 1 + 0.035 * Math.cos(a * Math.PI * 2 * 7),
        texel: 3,
        capA: true,
      });
      for (const s of [1, -1]) {
        limb(mb, [0.13 * s, 1.46, 0.01], [0.235 * s, 1.2, 0.01], 0.085, 0.055, [0.02 * s, 0, 0], 9, 7);
        // Pauldron.
        blob(mb.b, { centre: [0.175 * s, 1.46, 0.01], radii: [0.085, 0.07, 0.085], nu: 12, nv: 8, texel: 5 });
      }
      mb.use('trim', { trans: 0, irid: 0.8, wear: 0.3 });
      tube(mb.b, new Spine([[0, 1.5, 0.02], [0, 1.44, 0.02]], 8), {
        nu: 14,
        nv: 4,
        radius: () => 0.145,
        texel: 6,
      });
      tube(mb.b, new Spine([[0, 1.05, 0.0], [0, 0.99, 0.0]], 8), {
        nu: 16,
        nv: 4,
        radius: () => 0.19,
        texel: 6,
      });
      mb.use('robe', M_CLOTH);
      for (const s of [1, -1]) {
        limb(mb, [0.11 * s, 0.9, 0], [0.11 * s, 0.5, 0.02], 0.075, 0.055, [0, 0, 0.01], 8, 6);
        limb(mb, [0.11 * s, 0.5, 0.02], [0.11 * s, 0.11, 0], 0.055, 0.04, [0, 0, -0.01], 8, 6);
        limb(mb, [0.11 * s, 0.08, -0.01], [0.11 * s, 0.03, 0.11], 0.045, 0.035, [0, 0, 0], 7, 5);
      }
    },
    legs,
    spine: ['root', 'spine', 'chest', 'neck', 'head'],
    head: 'head',
    whips: [],
    wings: [],
    locomotion: 'ground',
    standHeight: 0.95,
    stride: 1.45,
    step: 0.14,
    duty: 0.62,
    walkSpeed: 1.35,
    runSpeed: 3.9,
    radius: 0.45,
    maxHealth: 100,
    faction: 'dunmer',
    scaleRange: [0.94, 1.06],
    lodScale: 1.0,
    surfaces: [0, 1, 2, 3, 4, 7],
    population: 6,
    stage: [15, 140],
  };
}

/* --------------------------------------------------------------- registry */

let cache: Map<string, SpeciesDef> | null = null;

export function bestiary(): Map<string, SpeciesDef> {
  if (cache !== null) return cache;
  const list = [cliffRacer(), netch(), kwama(), nixHound(), guar(), siltStrider(), dunmer()];
  cache = new Map(list.map((s) => [s.kind, s]));
  return cache;
}
