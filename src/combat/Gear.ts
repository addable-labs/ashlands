import * as THREE from 'three';
import type { IMaterials } from '../core/contracts';
import { AERIAL_GLSL, aerialUniforms } from '../sky/Atmosphere';
import type { PBRSet } from '../core/types';
import type { ClutterDef, WeaponDef } from './Tables';

/**
 * Geometry and materials for everything combat puts in the world: the weapon in
 * the player's hand, arrows in flight and stuck in walls, and the rigid clutter
 * that can be knocked over and broken.
 *
 * All of it is generated. A weapon is a handful of tapered prisms and a lathe;
 * an urn is a profile revolved twelve ways. The point is not to save disk — it
 * is that a weapon's *collision* geometry and its *draw* geometry come from the
 * same numbers, so a blade that looks 1.1 m long has 1.1 m of reach, and an urn
 * that looks like it is resting on the ground is resting on the ground.
 *
 * Every material here imports the shared aerial-perspective chunk rather than
 * relying on three's fog, so a crate at 200 m fades into exactly the haze the
 * terrain behind it fades into. Mismatched fog between two systems is an
 * instant fail on the art bar and it is one line to get right.
 */

/** Which synthesized PBR set dresses each weapon material. */
const WEAPON_SET: Readonly<Record<string, string>> = {
  flesh: 'cloth',
  wood: 'wood_weathered',
  iron: 'iron',
  steel: 'iron',
  silver: 'bronze',
  chitin: 'chitin',
  bonemold: 'bone',
  dwemer: 'bronze',
  glass: 'glass_volcanic',
  ebony: 'basalt',
  daedric: 'basalt',
};

/** Tint and finish per weapon material, over the shared PBR set. */
const WEAPON_LOOK: Readonly<Record<string, { color: number; rough: number; metal: number }>> = {
  flesh: { color: 0x8a7c6c, rough: 0.9, metal: 0 },
  wood: { color: 0x6b5741, rough: 0.85, metal: 0 },
  iron: { color: 0x6e6a66, rough: 0.44, metal: 1 },
  steel: { color: 0x9aa0a6, rough: 0.3, metal: 1 },
  silver: { color: 0xd8d6cc, rough: 0.22, metal: 1 },
  chitin: { color: 0x8a7550, rough: 0.4, metal: 0.1 },
  bonemold: { color: 0xc9b891, rough: 0.55, metal: 0 },
  dwemer: { color: 0xb08a4a, rough: 0.3, metal: 1 },
  glass: { color: 0x4f8f78, rough: 0.16, metal: 0.35 },
  ebony: { color: 0x1a1a1c, rough: 0.2, metal: 0.7 },
  daedric: { color: 0x241d20, rough: 0.26, metal: 0.85 },
};

/* ------------------------------------------------- first-person depth band */

/**
 * The depth band the first-person viewmodel is squeezed into: `(near, span,
 * knee)`, metres. A vertex at view depth `d` is redrawn at
 *
 *     d' = near + span * d / (d + knee)
 *
 * — monotone, so relative depth (and therefore self-occlusion, and the arm
 * behind the blade it holds) survives intact, and BOUNDED, so no part of the
 * viewmodel can ever be further than `near + span` from the eye however long
 * the spear is.
 *
 * The ceiling is 0.28 m and the number it has to clear is 0.34 m, the player
 * capsule's radius — the closest a collider will ever let a wall get to the
 * camera. It is not 0.315: the camera rig bobs laterally by up to 1.6 cm and
 * absorbs stair steps on top of that, so the honest worst case is nearer 0.32,
 * and a 5 mm margin is not a margin. Verified by dropping a slab into the scene
 * at a measured 0.30 m — the whole viewmodel still draws in front of it.
 *
 * The remap scales each vertex ALONG ITS OWN VIEW RAY, so projected x and y are
 * unchanged to the bit: the silhouette, the prepass motion vectors (built from
 * unsquashed world positions) and the swept hit test all still agree with what
 * is on screen. Depth testing and writing stay on.
 *
 * `near <= 0` disables the remap entirely, which is the state every material is
 * in during third person and free-fly.
 *
 * A module singleton, mutated once per frame by the combat system: every
 * material that draws in the band reads the same object, so there is no
 * per-material bookkeeping and no way for the weapon and the hand holding it to
 * end up in different bands.
 */
export const VIEWMODEL_DEPTH: THREE.IUniform<THREE.Vector3> = { value: new THREE.Vector3(0, 0.175, 0.85) };

/**
 * The viewmodel's opt-out from the depth prepass, and the reason it exists.
 *
 * `Pipeline.renderPrepass` documents `userData.prepassMaterial` as "my vertices
 * do not come from the attributes PREPASS_VERT knows about". A viewmodel's
 * vertices do — but its DEPTH is a fiction. The band above squashes the whole
 * arm into 10-18 cm of view space so it cannot clip a wall, and the prepass
 * override runs without that squash, so the G-buffer describes an arm half a
 * metre away that no pixel on screen actually belongs to.
 *
 * Everything downstream of the G-buffer then believes it. Measured, and this is
 * the whole of the "value separation collapses" finding: GTAO samples at a
 * 1.4 m world radius, and a hand 50 cm from the lens subtends most of the
 * hemisphere at that radius, so the gauntlet occludes ITSELF almost completely
 * — and the contact-shadow march, which reads the same buffer, draws a soft
 * black halo out onto whatever is behind it. The composite applies both as a
 * multiply on the FINAL colour, emissive included, so no amount of light rig
 * can climb out of it. It flickers rather than being constant only because the
 * AO buffer is temporally accumulated: captured across a session the same rest
 * pose measured a median of 115 on the good frames and 65 on the bad ones,
 * against an unchanged background of 117.
 *
 * So the viewmodel contributes nothing to the G-buffer, exactly as the flora
 * impostors do, and takes its occlusion where it has always taken it: from the
 * vertex-colour cavity term the plate builder writes, which is authored at the
 * scale of a lame rather than at the scale of a room.
 */
export const VIEWMODEL_NO_PREPASS = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: 'void main() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }',
  fragmentShader: 'precision highp float;\nvoid main() { discard; }',
  colorWrite: false,
  depthWrite: false,
  blending: THREE.NoBlending,
});

const VIEWMODEL_VERT = /* glsl */ `
  if (uViewmodelBand.x > 0.0) {
    float vmD = max(-mvPosition.z, 0.02);
    float vmT = uViewmodelBand.x + uViewmodelBand.y * vmD / (vmD + uViewmodelBand.z);
    mvPosition.xy *= vmT / vmD;
    mvPosition.z = -vmT;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

/**
 * THE VIEWMODEL LIGHT RIG.
 *
 * The world lights the viewmodel with whatever the player happens to be facing.
 * That is the right answer for the world and the wrong answer for a pair of
 * hands: turn your back on the sun in the Ashlands and the arms have nothing on
 * them but sky ambient, so dark iron in front of a blown-out sky collapses into
 * one black silhouette. Measured, before this existed: sky mean luminance 121,
 * armour median 23, tenth percentile 6. A hole in the frame, not an object.
 *
 * So the viewmodel carries its own three-point rig, fixed in VIEW space, which
 * is what every first-person game does and for exactly this reason. It turns
 * with the camera, so the modelling on a plate face never changes as the player
 * spins, and no facing can leave the arm unlit.
 *
 * - KEY, up-right-and-toward: the light that puts a mid-tone on every plate
 *   face pointed anywhere near the lens.
 * - KICK, from the left and behind the shoulder: the cool side that stops the
 *   unlit half going to zero and separates the far edge of the cuff from the
 *   far edge of the vambrace.
 * - UNDER, straight up off the ground: the bounce a hand held over ash gets.
 * - AMB, a flat floor so a face turned fully away is dark, never black.
 * - RIM, a Fresnel lobe. This is the term that does the separating: on a rolled
 *   lip — and every border in this armour is a rolled lip — the normal grazes
 *   the eye, so the lobe spikes and the edge draws a bright line ABOVE the sky
 *   behind it. Silhouette recovered without touching the silhouette.
 *
 * Every term is scaled by a LEVEL, and the level is a fixed fraction of the KEY
 * LIGHT'S OWN colour, with the scene's indirect light only as the fallback for
 * an hour that has no key at all. That is what makes it a rig and not a glow: a
 * night interior gets a dim version of the same modelling and the Ashlands at
 * noon a bright one, so the arm can never be brighter than the hour it is in.
 * And it is what makes it STABLE — see `sun` below for the measurement that
 * decided it, and RIG_GLSL for the framings where the light actually arriving
 * at the hand goes to nothing while the meter still reads the scene behind it.
 *
 * WHERE THE FALLBACK LEVEL IS READ FROM, IT IS BOTH ACCUMULATORS. Three keeps
 * image-based lighting in a SEPARATE one: `lights_fragment_maps` adds the
 * environment to `iblIrradiance`, never to `irradiance`, which ends up holding
 * only the ambient light and the light probe. This scene has neither. So a term
 * written against `irradiance` alone — which is what the rolled-edge rim in
 * `Viewmodel.patchPlate` was, for eight review rounds — multiplies by zero and
 * does nothing at all, silently, with no warning and no visible error.
 *
 * AND IT IS A FLOOR, NOT AN ADD. The first version of this simply added the
 * rig on top of whatever the world had already done, which fixes the backlit
 * case and ruins the lit one: pointed at the sunlit ash the gauntlet measured
 * 245 against a ground of 110, i.e. exactly the chalky near-white that the
 * plate grade was pulled down to avoid two rounds ago. So the rig fills TOWARD
 * a target instead. `vmFloor / ( vmFloor + direct )` is a soft maximum — where
 * the world already lights the surface it tends to zero, where the world has
 * abandoned it the term tends to the full floor, and it is smooth in between,
 * so there is no seam along a terminator. The number below is therefore the
 * level the plate is guaranteed to reach, not the level it is pushed past.
 */
export const VIEWMODEL_RIG = {
  key: 0.44,
  kick: 0.19,
  under: 0.10,
  amb: 0.032,
  rim: 0.26,
  /**
   * The rig's own LEVEL, as a fraction of the key light's colour.
   *
   * A FIXED fraction of the sun, not a floor under the local indirect light,
   * and that distinction is the whole point. The scene's environment probe
   * ping-pongs between two prefiltered maps; captured at 7 Hz on a still
   * camera, the gauntlet's median luminance alternates 132 / 72 with the
   * background steady at 117, because armour at 0.6 metalness is the most
   * environment-dependent surface in the frame while the ash behind it is
   * lit by the sun and barely notices. Any rig scaled by that light inherits
   * the alternation; a rig scaled by the sun does not, and the soft-max fill
   * below then holds the plate at a stable level whatever the probe is doing.
   */
  sun: 0.42,
  /**
   * The share of the world's own indirect light the rig falls back to when
   * there is no sun at all. Night and deep interiors: without it the level
   * would go to zero with the key and the armour would be a hole again.
   */
  dim: 0.40,
};

const RIG_GLSL = /* glsl */ `
  // Gated on the SAME uniform as the depth band, which is the one flag that
  // says "this is being drawn as a viewmodel right now". A view-space rig is
  // the right answer for a pair of hands 50 cm from the lens and the wrong
  // answer for the same sword seen over a shoulder in third person, where the
  // world's own lighting is all that should touch it.
  if ( uViewmodelBand.x > 0.0 ) {
    // THE LEVEL, and why it is not just the local indirect light.
    //
    // \`irradiance + iblIrradiance\` is what the world happens to be putting on
    // THIS FRAGMENT, and on its own it fails in exactly the frames a viewmodel
    // is judged on: a hand raised against a bright sky, a hand pressed into a
    // wall, a hand in the shadow of the thing the player is about to hit. In
    // all three the arriving light collapses while the exposure meter is still
    // reading the bright scene behind, so the armour prints as a black hole —
    // which is what the last review measured on the slab frames.
    //
    // So the level is floored at a fraction of the SUN'S OWN colour. That is a
    // scene-referred number: it tracks noon, dusk and midnight, and the meter
    // with them, but it does not track what is or is not shadowing the hand
    // this frame. A dedicated viewmodel key light, in other words, which is
    // what every first-person game ships and for this exact reason.
    vec3 vmSun = vec3( 0.0 );
    #if NUM_DIR_LIGHTS > 0
      vmSun = directionalLights[ 0 ].color;
    #endif
    vec3 vmLev = max( vmSun * ${VIEWMODEL_RIG.sun.toFixed(3)},
      ( irradiance + iblIrradiance ) * ${VIEWMODEL_RIG.dim.toFixed(3)} );
    vec3 vmN = geometryNormal;
    float vmKey  = saturate( dot( vmN, vec3(  0.44,  0.62,  0.65 ) ) );
    float vmKick = saturate( dot( vmN, vec3( -0.78,  0.24,  0.58 ) ) );
    float vmUnd  = saturate( dot( vmN, vec3(  0.08, -0.94,  0.33 ) ) );
    float vmFres = pow( 1.0 - saturate( dot( vmN, geometryViewDir ) ), 3.0 );
    vec3 vmFloor = diffuseColor.rgb * vmLev * vec3( 1.05, 1.00, 0.92 ) * (
        vmKey  * ${VIEWMODEL_RIG.key.toFixed(3)}
      + vmKick * ${VIEWMODEL_RIG.kick.toFixed(3)}
      + vmUnd  * ${VIEWMODEL_RIG.under.toFixed(3)}
      + ${VIEWMODEL_RIG.amb.toFixed(3)} );
    totalEmissiveRadiance += vmFloor * vmFloor
      / ( vmFloor + reflectedLight.directDiffuse + reflectedLight.directSpecular + 1e-4 );
    totalEmissiveRadiance += vmLev * vec3( 1.12, 1.04, 0.86 )
      * ( vmFres * ${VIEWMODEL_RIG.rim.toFixed(3)} );
  }
`;

/**
 * Patch an existing standard material into the shared atmosphere and, when
 * asked, into the viewmodel depth band and the viewmodel light rig. Separated
 * from `makeMaterial` so a material built elsewhere (the skin set, which
 * carries its own generated maps) can join the band on exactly the same terms
 * as the weapon it is holding.
 */
export function patchViewmodelMaterial(m: THREE.MeshStandardMaterial, viewmodel = true): void {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, aerialUniforms());
    if (viewmodel) {
      shader.uniforms.uViewmodelBand = VIEWMODEL_DEPTH;
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'uniform vec3 uViewmodelBand;\nvoid main() {')
        // AFTER project_vertex on purpose: mvPosition is still in scope, and
        // vViewPosition is assigned from it further down, so the specular view
        // vector follows the scaled position — which, being a positive scale
        // along the same ray, is the same direction it always was.
        .replace('#include <project_vertex>', `#include <project_vertex>\n${VIEWMODEL_VERT}`);
      // The rig goes in at `aomap_fragment`, the one point in the chain where
      // the scene's own irradiance, the view-space normal and the view vector
      // are all still in scope and nothing has consumed them yet.
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform vec3 uViewmodelBand;\nvoid main() {')
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${RIG_GLSL}`);
    }
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vCombatW;\nvoid main() {')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vCombatW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${AERIAL_GLSL}\nvarying vec3 vCombatW;\nvoid main() {`)
      .replace(
        '#include <opaque_fragment>',
        'outgoingLight = applyAerial(outgoingLight, vCombatW - cameraPosition);\n#include <opaque_fragment>',
      );
  };
  m.needsUpdate = true;
}

/**
 * Standard material with the shared atmosphere patched in. Small near-field
 * props, so no triplanar: the generated UVs are already even.
 */
export function makeMaterial(
  mats: IMaterials | null,
  setName: string,
  color: number,
  rough: number,
  metal: number,
  viewmodel = false,
): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  let set: PBRSet | null = null;
  if (mats !== null) {
    try {
      set = mats.get(setName);
    } catch {
      // A missing synthesized set must not take combat down; the flat tint is
      // an acceptable stand-in and the console warning is enough of a signal.
      set = null;
    }
  }
  if (set !== null) {
    m.map = set.albedo;
    m.normalMap = set.normal;
    m.roughnessMap = set.arm;
    // metalnessMap is deliberately NOT set either: the ARM map drops metalness
    // to zero wherever it decided there was oxide, so a cast pommel comes out
    // as islands of dielectric in a conductor and reads as porous stone. An
    // iron pommel is iron all over; the oxide is albedo and roughness.
    // aoMap is deliberately NOT set. The ARM map's occlusion channel is authored
    // for architecture at wall scale; baked onto a 5 cm pommel 40 cm from the
    // eye it prints as dark irregular pitting all over a smooth casting, and
    // the thing reads as a lump of scoria rather than as iron. Near-field props
    // get their occlusion from geometry and from the vertex wear instead.
    // The ARM map carries the material's own roughness/metalness in g/b; the
    // scalar above becomes a multiplier, so it has to be re-normalised upward.
    m.roughness = Math.min(1, rough * 1.6);
    m.metalness = Math.min(1, metal * 1.25);
  }
  // A first-person conductor is lit almost entirely by the prefiltered
  // environment, and at unit intensity an iron pommel 40 cm from the eye simply
  // goes black next to ash the exposure is metered on. The viewmodel plate runs
  // hotter for the same reason; the weapon in its fist has to match it.
  m.envMapIntensity = viewmodel && metal > 0.5 ? 1.4 : 1;
  if (viewmodel && metal > 0.5) {
    // And it is not a PURE conductor, for the same reason `Viewmodel.PLATE_METAL`
    // is 0.62 rather than 1: a full conductor has no diffuse response at all, so
    // the light rig — which fills through `diffuseColor` — cannot reach it and
    // the pommel stays the dark ellipse the last review read as a hole punched
    // through the wrist. Three quarters conductor keeps the specular saying
    // forged iron and gives the rig something to hold up.
    m.metalness = Math.min(m.metalness, 0.74);
  }
  patchViewmodelMaterial(m, viewmodel);
  return m;
}

/* ----------------------------------------------------------------- grips */

/**
 * Half-extents of the section of haft the hand actually closes on, per weapon
 * class, in the local space `buildWeapon` authors: X across the flat of the
 * blade, Z through it, and the hand sitting in the first ~9 cm above the
 * anchor. A hilt is a rounded rectangle, not a rod — the flats are what stop a
 * sword rolling in the fist — so the two extents differ and the fingers have to
 * know both.
 *
 * This is exported and consumed by `Viewmodel`, and the haft prisms below are
 * built FROM it, so the surface the fingers close on and the surface that gets
 * drawn are the same numbers. Guessing a radius here is how you get fingers
 * floating a few millimetres off a hilt, or buried in one.
 */
const GRIP_SECTION: Readonly<Record<string, { x: number; z: number }>> = {
  shortblade: { x: 0.0168, z: 0.0134 },
  longblade: { x: 0.0168, z: 0.0134 },
  blunt: { x: 0.0215, z: 0.0215 },
  axe: { x: 0.0205, z: 0.0205 },
  spear: { x: 0.0177, z: 0.0177 },
  marksman: { x: 0.0270, z: 0.0270 },
  thrown: { x: 0.0130, z: 0.0110 },
};

/** The grip the hand closes on. Bare hands report a fist-sized void. */
export function gripSection(def: WeaponDef): { x: number; z: number } {
  return GRIP_SECTION[def.cls] ?? { x: 0.0130, z: 0.0110 };
}

/**
 * How far BELOW the hand anchor the bare haft starts.
 *
 * The anchor is the middle of the fist, not its heel. A haft that begins at the
 * anchor therefore begins inside the hand, and the only thing under the little
 * finger is whatever butt cap the weapon happens to carry — which on the old
 * broadsword was a pommel tucked so far up that the gauntlet cuff swallowed it
 * whole. Every weapon whose haft the hand closes on now starts 2.2 cm low, so
 * there is a measured length of grip standing proud of the heel of the fist in
 * every pose, and the butt hangs clear below that.
 */
export const HILT_Y0 = -0.026;

/* ----------------------------------------------------------- primitives */

/**
 * A prism running along +Y, rectangular in section, tapering from (w0,t0) at
 * the base to (w1,t1) at the tip. Every blade, haft and plank in the game is
 * one or two of these.
 */
export function taperedPrism(len: number, w0: number, t0: number, w1: number, t1: number, y0 = 0): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const ring = (y: number, w: number, t: number): number[] => [w, y, t, -w, y, t, -w, y, -t, w, y, -t];
  const a = ring(y0, w0 * 0.5, t0 * 0.5);
  const b = ring(y0 + len, w1 * 0.5, t1 * 0.5);
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number => {
    pos.push(x, y, z);
    nrm.push(nx, ny, nz);
    uv.push(u, v);
    return pos.length / 3 - 1;
  };
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const ax = a[i * 3], ay = a[i * 3 + 1], az = a[i * 3 + 2];
    const bx = a[j * 3], by = a[j * 3 + 1], bz = a[j * 3 + 2];
    const cx = b[j * 3], cy = b[j * 3 + 1], cz = b[j * 3 + 2];
    const dx = b[i * 3], dy = b[i * 3 + 1], dz = b[i * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = dx - ax, vy = dy - ay, vz = dz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const i0 = push(ax, ay, az, nx, ny, nz, 0, 0);
    const i1 = push(bx, by, bz, nx, ny, nz, 1, 0);
    const i2 = push(cx, cy, cz, nx, ny, nz, 1, len);
    const i3 = push(dx, dy, dz, nx, ny, nz, 0, len);
    idx.push(i0, i1, i2, i0, i2, i3);
  }
  // Caps. Cheap, and without them a blade seen edge-on is hollow.
  for (const [r, ny, y] of [[a, -1, y0], [b, 1, y0 + len]] as const) {
    const base = pos.length / 3;
    for (let i = 0; i < 4; i++) push(r[i * 3], y, r[i * 3 + 2], 0, ny, 0, i & 1, (i >> 1) & 1);
    if (ny > 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** A profile revolved about +Y. Used for urns, pots and pommels. */
export function lathe(profile: readonly (readonly [number, number])[], segments: number): THREE.BufferGeometry {
  /**
   * CLOSED at both ends, and that is not tidiness.
   *
   * A `LatheGeometry` whose profile starts and ends off the axis is an open
   * tube: you are looking straight through it, and since backfaces are culled
   * what you see through the opening is whatever is behind — which on a sword
   * pommel is the player's own hand and then the ground. Every close-up in the
   * viewmodel capture set had a bright wedge of ash and hypothenar showing
   * inside the black pommel casting, and it read exactly like a hole punched in
   * the middle of the weapon.
   *
   * Pinning the two ends to the axis costs one vertex each and closes it.
   */
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y));
  if (pts[0].x > 1e-3) pts.unshift(new THREE.Vector2(1e-4, pts[0].y));
  const last = pts[pts.length - 1];
  if (last.x > 1e-3) pts.push(new THREE.Vector2(1e-4, last.y));
  const g = new THREE.LatheGeometry(pts, segments);
  g.computeVertexNormals();
  return g;
}

/* -------------------------------------------------------------- weapons */

export interface WeaponMesh {
  object: THREE.Object3D;
  /** Distance from the hand anchor to the tip, along +Y. */
  reach: number;
  dispose(): void;
}

/**
 * Build the held weapon. Local space is: origin at the hand, +Y along the
 * blade toward the tip, +Z the flat of the blade. The melee sweep uses exactly
 * this axis, so what is drawn and what is tested cannot diverge.
 */
export function buildWeapon(def: WeaponDef, mats: IMaterials | null): WeaponMesh {
  const group = new THREE.Group();
  group.name = `weapon:${def.id}`;
  const geos: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  // The held weapon draws in the first-person depth band along with the hand
  // holding it. It has to be the same band as the hand or the two separate the
  // moment the player walks up to a wall; the band is switched off entirely in
  // third person, where the weapon is an ordinary object in the world.
  const look = WEAPON_LOOK[def.material] ?? WEAPON_LOOK.iron;
  const metal = makeMaterial(mats, WEAPON_SET[def.material] ?? 'iron', look.color, look.rough, look.metal, true);
  const wood = makeMaterial(mats, 'wood_weathered', 0x5c4a37, 0.86, 0, true);
  const wrap = makeMaterial(mats, 'cloth', 0x3a3128, 0.95, 0, true);
  /**
   * HILT FURNITURE — pommel, butt cap and ferrules — at three fifths conductor
   * instead of full, and this is the same measurement `Viewmodel.PLATE_METAL`
   * documents rather than a second opinion.
   *
   * A pure conductor has no diffuse response. The viewmodel light rig fills
   * toward `diffuseColor * level`, so on a full metal there is nothing to fill
   * and the part prints as a silhouette. That is right for the blade, which is
   * read against the sky and looks superb as a dark shape — and it is exactly
   * wrong for the two ends of the grip, which are the ONE part of the weapon
   * that has to be read against an armoured hand 50 cm from the lens. Black
   * pommel under black guard on black grip, with a bright gauntlet across the
   * middle of it, is precisely why every review of this arm has reported the
   * hilt vanishing into the fist.
   *
   * Polished furniture on a blued blade is also simply what a hilt looks like.
   */
  const fitting = makeMaterial(mats, WEAPON_SET[def.material] ?? 'iron', look.color, look.rough, look.metal, true);
  if (look.metal > 0.3) {
    // Explicit, and after `makeMaterial`, because the ARM-map renormalisation in
    // there would otherwise put this back where the blade is. Under half
    // conductor and a polished finish: the rig now has a real diffuse term to
    // fill and the furniture holds a mid-tone against the gauntlet instead of
    // going to the blade's silhouette black.
    fitting.metalness = 0.46;
    fitting.roughness = 0.34;
    fitting.envMapIntensity = 1.4;
    // Lifted a third toward white as well. Value, not just shading: two bright
    // collars and a bright pommel on a dark grip are what make the eye resolve
    // the hilt as ONE cylinder going into the fist at the top and coming out at
    // the bottom, which is the entire point of this pass.
    fitting.color.setHex(look.color).lerp(new THREE.Color(1, 1, 1), 0.34);
  }
  materials.push(metal, wood, wrap, fitting);

  const add = (g: THREE.BufferGeometry, m: THREE.Material, y = 0, rx = 0, rz = 0): THREE.Mesh => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.y = y;
    mesh.rotation.x = rx;
    mesh.rotation.z = rz;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    group.add(mesh);
    geos.push(g);
    return mesh;
  };

  const R = def.reach;
  const gs = gripSection(def);
  switch (def.cls) {
    case 'shortblade':
    case 'longblade': {
      // A one-handed grip was capped at 11 cm here, on the grounds that a hand
      // is 11 cm and a longer haft is a sword the hand has been threaded onto.
      // That is true of the SILHOUETTE and false of the read: a hilt exactly as
      // long as the fist closed on it has no visible ends, and eleven review
      // rounds in a row reported the hilt disappearing into the gauntlet.
      //
      // The hilt has to be LONGER THAN THE FIST, and it has to be longer at
      // BOTH ends. The viewmodel gauntlet spans about 10 cm of haft; a hilt of
      // 10.8 cm starting at the anchor left nothing proud of the knuckles and
      // nothing proud of the heel, so the eye never saw the weapon go into the
      // hand — every review of this arm has reported the blade "emerging from
      // the cuff". `HILT_Y0` drops the bare grip below the anchor and the
      // length carries it above, which leaves ~2 cm of haft standing clear at
      // each end of the fist.
      const grip = def.twoHanded ? R * 0.19 : 0.156;
      const y0 = def.twoHanded ? 0 : HILT_Y0;
      add(taperedPrism(grip, gs.x * 2, gs.z * 2, gs.x * 1.9, gs.z * 1.94, y0), wrap);
      // The two FERRULES. Bare grip is dark cloth between a dark guard and a
      // dark pommel, and 2 cm of it reads as nothing at all. An iron collar on
      // each of those two centimetres gives the haft a bright ring going INTO
      // the fist and a bright ring coming OUT of it, and a pair of rings on one
      // axis is what the eye resolves as a single cylinder passing through.
      for (const fy of [y0 + 0.003, y0 + grip - 0.019]) {
        add(taperedPrism(0.016, gs.x * 2.42, gs.z * 2.52, gs.x * 2.42, gs.z * 2.52, fy), fitting);
      }
      // Hung off the bottom of the bare grip, so its top ring meets the haft and
      // its widest ring stands 4.5 cm clear below the heel of the fist. It used
      // to sit tucked against the hand, where the gauntlet cuff — a bell 5 cm
      // in radius — swallowed it whole; see `Viewmodel.WRIST_P`.
      // 22 segments, not 10. A pommel is polished metal 30 cm from the eye: at
      // ten segments each facet is 36 degrees wide, so one of them squares up
      // to the sun and blows to white while its neighbours stay black, and what
      // the viewmodel captures showed was a hard bright wedge inside the
      // casting that looked for all the world like a hole through the weapon.
      // A WHEEL pommel, not a ball. The three stations at the equator give it a
    // turned cylindrical rim with a shoulder above and below, so the light
    // finds two hard edges on it; a smooth ovoid of the same mass sat under the
    // fist reading as a lump of scoria rather than as a forged casting.
    add(lathe([[0.005, 0], [0.021, 0.005], [0.027, 0.013], [0.028, 0.021],
      [0.027, 0.029], [0.020, 0.038], [0.008, 0.045]], 22), fitting, y0 - 0.045);
      add(taperedPrism(0.028, R * 0.22, 0.032, R * 0.2, 0.028, 0), metal, y0 + grip);
      // Fuller-less flat blade: wide at the ricasso, needle at the point.
      add(taperedPrism(R - y0 - grip - 0.030, 0.062, 0.018, 0.012, 0.006, 0), metal, y0 + grip + 0.028);
      break;
    }
    case 'blunt': {
      const haft = R * 0.72;
      // Carried below the anchor and capped, so the butt of the haft is an
      // object under the fist rather than the open end of a pipe.
      add(taperedPrism(haft - HILT_Y0, gs.x * 2, gs.z * 2, 0.05, 0.05, HILT_Y0), wood);
      add(taperedPrism(0.016, gs.x * 2.42, gs.z * 2.52, gs.x * 2.30, gs.z * 2.40, HILT_Y0 - 0.014), fitting);
      add(taperedPrism(R - haft, 0.16, 0.15, 0.13, 0.12, 0), metal, haft);
      break;
    }
    case 'axe': {
      const haft = R * 0.76;
      add(taperedPrism(haft - HILT_Y0, gs.x * 2, gs.z * 2, 0.046, 0.046, HILT_Y0), wood);
      add(taperedPrism(0.016, gs.x * 2.42, gs.z * 2.52, gs.x * 2.30, gs.z * 2.40, HILT_Y0 - 0.014), fitting);
      const head = add(taperedPrism(0.3, 0.06, 0.03, 0.22, 0.012, 0), metal, haft - 0.06);
      head.rotation.z = -0.35;
      add(taperedPrism(R - haft, 0.035, 0.03, 0.008, 0.008, 0), metal, haft);
      break;
    }
    case 'spear': {
      add(taperedPrism(R - 0.34 - HILT_Y0, gs.x * 2, gs.z * 2, 0.03, 0.03, HILT_Y0), wood);
      add(taperedPrism(0.016, gs.x * 2.42, gs.z * 2.52, gs.x * 2.30, gs.z * 2.40, HILT_Y0 - 0.014), fitting);
      add(taperedPrism(0.34, 0.05, 0.016, 0.006, 0.004, 0), metal, R - 0.34);
      break;
    }
    case 'marksman': {
      // A recurve drawn as a tube along a quadratic arc, plus the string.
      const curve = new THREE.CubicBezierCurve3(
        new THREE.Vector3(0, -0.62, 0.0),
        new THREE.Vector3(0, -0.3, 0.16),
        new THREE.Vector3(0, 0.3, 0.16),
        new THREE.Vector3(0, 0.62, 0.0),
      );
      const limb = new THREE.TubeGeometry(curve, 20, 0.016, 6, false);
      add(limb, wood);
      const string = new THREE.CylinderGeometry(0.0035, 0.0035, 1.22, 4);
      const s = add(string, wrap, 0);
      s.position.set(0, 0, 0.005);
      add(lathe([[0.02, -0.1], [0.03, 0], [0.02, 0.1]], 8), wrap, 0);
      break;
    }
    case 'thrown': {
      for (let i = 0; i < 4; i++) {
        const p = taperedPrism(0.12, 0.05, 0.008, 0.004, 0.004, 0);
        const m = add(p, metal, 0);
        m.rotation.z = (i * Math.PI) / 2;
      }
      break;
    }
    default: {
      add(taperedPrism(0.1, 0.06, 0.05, 0.05, 0.045, 0), wrap);
      break;
    }
  }

  return {
    object: group,
    reach: R,
    dispose(): void {
      for (const g of geos) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}

/* --------------------------------------------------------------- arrows */

/** Arrow along +Z, origin at the nock, point at +Z*length. */
export function buildArrow(length: number, mats: IMaterials | null): { object: THREE.Object3D; dispose(): void } {
  const g = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const shaftMat = makeMaterial(mats, 'wood_weathered', 0x6a5843, 0.82, 0);
  const headMat = makeMaterial(mats, 'iron', 0x7d7873, 0.35, 1);
  const fletchMat = makeMaterial(mats, 'cloth', 0x5d5346, 0.9, 0);

  const shaft = new THREE.CylinderGeometry(0.0055, 0.0045, length * 0.86, 6, 1);
  shaft.rotateX(Math.PI / 2);
  shaft.translate(0, 0, length * 0.43);
  geos.push(shaft);
  g.add(new THREE.Mesh(shaft, shaftMat));

  const head = new THREE.ConeGeometry(0.014, length * 0.15, 4);
  head.rotateX(Math.PI / 2);
  head.translate(0, 0, length * 0.93);
  geos.push(head);
  g.add(new THREE.Mesh(head, headMat));

  for (let i = 0; i < 3; i++) {
    const f = taperedPrism(length * 0.16, 0.001, 0.03, 0.001, 0.012, 0);
    f.rotateX(-Math.PI / 2);
    f.translate(0, 0, length * 0.06);
    f.rotateZ((i * Math.PI * 2) / 3);
    geos.push(f);
    g.add(new THREE.Mesh(f, fletchMat));
  }
  for (const c of g.children) c.castShadow = true;

  return {
    object: g,
    dispose(): void {
      for (const x of geos) x.dispose();
      shaftMat.dispose();
      headMat.dispose();
      fletchMat.dispose();
    },
  };
}

/* -------------------------------------------------------------- clutter */

export interface ClutterAsset {
  geo: THREE.BufferGeometry;
  material: THREE.Material;
  /** Support points of the convex hull, in local space. Collision uses these. */
  hull: Float32Array;
  /** Bounding radius, for broad-phase and for sleep thresholds. */
  radius: number;
  /** Inertia proxy: fraction of m*r^2. A crate resists spin more than a shard. */
  inertia: number;
}

const URN_PROFILE: readonly (readonly [number, number])[] = [
  [0.0, 0.0], [0.42, 0.02], [0.55, 0.12], [0.62, 0.34], [0.5, 0.6], [0.3, 0.76], [0.34, 0.86], [0.28, 0.95], [0.0, 0.97],
];
const POT_PROFILE: readonly (readonly [number, number])[] = [
  [0.0, 0.0], [0.5, 0.03], [0.62, 0.2], [0.6, 0.5], [0.44, 0.72], [0.46, 0.82], [0.0, 0.84],
];

export function buildClutter(def: ClutterDef, mats: IMaterials | null): ClutterAsset {
  const s = def.size;
  let geo: THREE.BufferGeometry;
  let inertia = 0.4;

  switch (def.shape) {
    case 'urn':
      geo = lathe(URN_PROFILE.map(([r, y]) => [r * s * 2, y * s * 2.6] as const), 14);
      inertia = 0.35;
      break;
    case 'pot':
      geo = lathe(POT_PROFILE.map(([r, y]) => [r * s * 2, y * s * 2.2] as const), 12);
      inertia = 0.34;
      break;
    case 'crate':
      geo = new THREE.BoxGeometry(s * 2, s * 2, s * 2);
      geo.translate(0, s, 0);
      inertia = 0.66;
      break;
    case 'plank':
      geo = taperedPrism(s * 3, s * 0.5, s * 0.14, s * 0.46, s * 0.12, 0);
      inertia = 0.5;
      break;
    default: {
      // An irregular chunk: a box with each vertex pushed out by a fixed
      // pseudo-random amount, so no two shards read as the same prop.
      const b = new THREE.BoxGeometry(s * 1.6, s * 1.4, s * 1.5, 1, 1, 1);
      const p = b.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = Math.sin(i * 12.9898) * 43758.5453;
        const j = k - Math.floor(k);
        p.setXYZ(i, p.getX(i) * (0.6 + j * 0.8), p.getY(i) * (0.6 + ((j * 7) % 1) * 0.8), p.getZ(i) * (0.6 + ((j * 13) % 1) * 0.8));
      }
      b.computeVertexNormals();
      b.translate(0, s * 0.7, 0);
      geo = b;
      inertia = 0.4;
      break;
    }
  }

  geo.computeBoundingSphere();
  const radius = geo.boundingSphere?.radius ?? s;

  // Hull: the extreme vertex in each of 14 directions (6 axes + 8 diagonals).
  // Fourteen support points is enough for stable resting contact on a
  // heightfield and cheap enough to test every body every frame.
  const dirs: number[] = [
    1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1,
    0.577, 0.577, 0.577, -0.577, 0.577, 0.577, 0.577, 0.577, -0.577, -0.577, 0.577, -0.577,
    0.577, -0.577, 0.577, -0.577, -0.577, 0.577, 0.577, -0.577, -0.577, -0.577, -0.577, -0.577,
  ];
  const pos = geo.attributes.position;
  const hull = new Float32Array((dirs.length / 3) * 3);
  for (let d = 0; d < dirs.length / 3; d++) {
    let best = -Infinity;
    let bx = 0, by = 0, bz = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const dot = x * dirs[d * 3] + y * dirs[d * 3 + 1] + z * dirs[d * 3 + 2];
      if (dot > best) {
        best = dot;
        bx = x; by = y; bz = z;
      }
    }
    hull[d * 3] = bx;
    hull[d * 3 + 1] = by;
    hull[d * 3 + 2] = bz;
  }

  const material = makeMaterial(mats, def.material, def.shape === 'crate' || def.shape === 'plank' ? 0x6a583f : 0x9a8e7a, 0.78, 0);
  return { geo, material, hull, radius, inertia };
}
