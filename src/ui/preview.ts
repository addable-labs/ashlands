/**
 * The live item preview in the inventory.
 *
 * It runs on its own small WebGL context rather than borrowing the main
 * renderer. Rendering into a render target on the shared renderer would mean
 * saving and restoring the pipeline's state (targets, viewport, tone mapping,
 * clear colour) every frame from a system that has no business knowing any of
 * it; an isolated 220px context costs a fraction of a millisecond and cannot
 * corrupt the frame. The window only renders while the inventory is open.
 *
 * Meshes are built from primitives per `ShapeId` — a real object rotating under
 * a real key light is the detail that makes an inventory feel like a game
 * rather than a spreadsheet, and it needs no art pipeline to get there.
 */
import * as THREE from 'three';

import { reducedMotion } from './dom';

/**
 * The procedural meshes this previewer can build. Owned here, next to the
 * builders, so adding a shape is one table entry and one union member.
 */
export type ShapeId =
  | 'blade'
  | 'greatblade'
  | 'dagger'
  | 'axe'
  | 'mace'
  | 'spear'
  | 'bow'
  | 'staff'
  | 'helm'
  | 'cuirass'
  | 'greaves'
  | 'boots'
  | 'gauntlet'
  | 'pauldron'
  | 'shield'
  | 'ring'
  | 'amulet'
  | 'belt'
  | 'potion'
  | 'book'
  | 'scroll'
  | 'ingredient'
  | 'soulgem'
  | 'lockpick'
  | 'coin'
  | 'mortar';

interface Look {
  tint: number;
  metal: number;
  rough: number;
}

function mat(look: Look, tintScale = 1, roughAdd = 0): THREE.MeshStandardMaterial {
  const c = new THREE.Color(look.tint);
  c.multiplyScalar(tintScale);
  return new THREE.MeshStandardMaterial({
    color: c,
    metalness: look.metal,
    roughness: THREE.MathUtils.clamp(look.rough + roughAdd, 0.04, 1),
    envMapIntensity: 1.15,
  });
}

const LEATHER: Look = { tint: 0x4a3520, metal: 0.05, rough: 0.72 };

/** Builders are a table, not a switch: adding an item shape adds one entry. */
type Builder = (g: THREE.Group, look: Look) => void;

const BUILD: Readonly<Record<ShapeId, Builder>> = {
  blade: (g, l) => {
    const steel = mat(l);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.5, 0.022), steel);
    blade.position.y = 0.62;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.048, 0.22, 4), steel);
    tip.position.y = 1.48;
    tip.rotation.y = Math.PI / 4;
    tip.scale.z = 0.28;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.06), mat(l, 0.8, 0.1));
    guard.position.y = -0.14;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.34, 10), mat(LEATHER));
    grip.position.y = -0.33;
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), mat(l, 0.85, 0.1));
    pommel.position.y = -0.52;
    g.add(blade, tip, guard, grip, pommel);
  },
  greatblade: (g, l) => {
    BUILD.blade(g, l);
    g.scale.set(1.35, 1.28, 1.35);
  },
  dagger: (g, l) => {
    BUILD.blade(g, l);
    g.scale.set(0.92, 0.58, 0.92);
  },
  axe: (g, l) => {
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 1.5, 10), mat(LEATHER, 1.1));
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.05, 16, 1, false, 0.9, 1.5), mat(l));
    head.rotation.z = Math.PI / 2;
    head.rotation.y = Math.PI / 2;
    head.position.set(0.16, 0.55, 0);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.16, 10), mat(l, 0.8, 0.12));
    collar.position.y = 0.55;
    g.add(haft, head, collar);
  },
  mace: (g, l) => {
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 1.35, 10), mat(LEATHER, 1.1));
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.34, 8), mat(l));
    head.position.y = 0.62;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), mat(l, 0.9));
    cap.position.y = 0.82;
    g.add(haft, head, cap);
  },
  spear: (g, l) => {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 2.1, 10), mat(LEATHER, 1.2));
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.45, 4), mat(l));
    head.position.y = 1.22;
    head.rotation.y = Math.PI / 4;
    head.scale.z = 0.4;
    g.add(shaft, head);
    g.scale.setScalar(0.78);
  },
  bow: (g, l) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.85, 0),
      new THREE.Vector3(0.26, -0.4, 0),
      new THREE.Vector3(0.32, 0, 0),
      new THREE.Vector3(0.26, 0.4, 0),
      new THREE.Vector3(0, 0.85, 0),
    ]);
    const limb = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.033, 8, false), mat(l));
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 1.7, 4), mat({ tint: 0xd8c9a4, metal: 0, rough: 0.9 }));
    g.add(limb, string);
  },
  staff: (g, l) => {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.9, 10), mat(l));
    const knot = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.035, 8, 20), mat(l, 0.8, -0.1));
    knot.position.y = 0.98;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), new THREE.MeshStandardMaterial({
      color: 0x3fd6c0, emissive: 0x1c7d6f, roughness: 0.1, metalness: 0.1,
    }));
    gem.position.y = 0.98;
    g.add(shaft, knot, gem);
  },
  helm: (g, l) => {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), mat(l));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.045, 8, 26), mat(l, 0.85, 0.1));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.06;
    const nasal = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.36, 0.05), mat(l, 0.9));
    nasal.position.set(0, -0.14, 0.44);
    g.add(dome, rim, nasal);
  },
  cuirass: (g, l) => {
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.95, 16, 1, true), mat(l));
    torso.scale.z = 0.62;
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.06, 8, 22), mat(l, 0.85, 0.08));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.46;
    collar.scale.z = 0.62;
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.05, 8, 22), mat(LEATHER));
    belt.rotation.x = Math.PI / 2;
    belt.position.y = -0.44;
    belt.scale.z = 0.62;
    g.add(torso, collar, belt);
  },
  greaves: (g, l) => {
    const left = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.85, 12, 1, true), mat(l));
    left.position.x = -0.19;
    const right = left.clone();
    right.position.x = 0.19;
    const waist = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.055, 8, 20), mat(l, 0.85, 0.06));
    waist.rotation.x = Math.PI / 2;
    waist.position.y = 0.42;
    waist.scale.z = 0.66;
    g.add(left, right, waist);
  },
  boots: (g, l) => {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.6, 12), mat(l));
    shaft.position.y = 0.1;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.46), mat(l, 0.9, 0.05));
    foot.position.set(0, -0.28, 0.11);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.5), mat(LEATHER, 0.7));
    sole.position.set(0, -0.37, 0.11);
    g.add(shaft, foot, sole);
    g.scale.setScalar(1.35);
  },
  gauntlet: (g, l) => {
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.34, 12), mat(l));
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.32, 0.13), mat(l, 0.92, 0.05));
    hand.position.y = 0.3;
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.14, 4, 8), mat(l, 0.92, 0.05));
    thumb.position.set(-0.16, 0.26, 0);
    thumb.rotation.z = 0.5;
    g.add(cuff, hand, thumb);
    g.scale.setScalar(1.5);
  },
  pauldron: (g, l) => {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), mat(l));
    cap.scale.set(1, 0.7, 1);
    const flare = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.42, 18, 1, true), mat(l, 0.9, 0.05));
    flare.position.y = -0.1;
    flare.rotation.x = Math.PI;
    g.add(cap, flare);
    g.scale.setScalar(1.15);
  },
  shield: (g, l) => {
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.07, 6), mat(l));
    face.rotation.x = Math.PI / 2;
    face.rotation.z = Math.PI / 6;
    face.scale.y = 1.25;
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), mat(l, 0.8, -0.1));
    boss.position.z = 0.06;
    boss.scale.z = 0.6;
    g.add(face, boss);
  },
  ring: (g, l) => {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 14, 40), mat(l));
    const stone = new THREE.Mesh(new THREE.OctahedronGeometry(0.15), new THREE.MeshStandardMaterial({
      color: 0x8f6bff, emissive: 0x2a1d55, roughness: 0.08, metalness: 0.2,
    }));
    stone.position.y = 0.46;
    g.add(band, stone);
    g.scale.setScalar(1.25);
  },
  amulet: (g, l) => {
    const chain = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.018, 8, 44), mat(l, 0.85, 0.1));
    chain.rotation.x = 0.35;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 20), mat(l));
    disc.rotation.x = Math.PI / 2;
    disc.position.y = -0.42;
    const inlay = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.022, 8, 20), new THREE.MeshStandardMaterial({
      color: 0x3fd6c0, emissive: 0x11493f, roughness: 0.2, metalness: 0.4,
    }));
    inlay.position.set(0, -0.42, 0.03);
    g.add(chain, disc, inlay);
  },
  belt: (g, l) => {
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 40), mat(LEATHER, 1.1));
    strap.scale.set(1, 1, 0.42);
    const buckle = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 4), mat(l, 1, -0.15));
    buckle.position.z = 0.24;
    buckle.rotation.x = Math.PI / 2;
    buckle.rotation.z = Math.PI / 4;
    g.add(strap, buckle);
  },
  potion: (g, l) => {
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xd8e0d4, roughness: 0.06, metalness: 0, transmission: 0.9, thickness: 0.4,
      ior: 1.5, transparent: true, opacity: 0.55,
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 22, 16), glass);
    body.scale.y = 1.12;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.35, 14), glass);
    neck.position.y = 0.46;
    const fluid = new THREE.Mesh(new THREE.SphereGeometry(0.33, 20, 14, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58), new THREE.MeshStandardMaterial({
      color: l.tint, emissive: new THREE.Color(l.tint).multiplyScalar(0.22), roughness: 0.18, metalness: 0,
    }));
    fluid.scale.y = 1.12;
    const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.14, 12), mat({ tint: 0x8a6a3f, metal: 0, rough: 0.85 }));
    cork.position.y = 0.66;
    g.add(body, neck, fluid, cork);
  },
  book: (g, l) => {
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.98, 0.16), mat(l));
    const pages = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.92, 0.15), mat({ tint: 0xd8c9a4, metal: 0, rough: 0.92 }));
    pages.position.x = 0.03;
    const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.98, 10, 1, false, 0, Math.PI), mat(l, 0.85, 0.05));
    spine.position.x = -0.36;
    spine.rotation.z = 0;
    const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.19), mat({ tint: 0xc8a95e, metal: 1, rough: 0.28 }));
    clasp.position.x = 0.34;
    g.add(cover, pages, spine, clasp);
  },
  scroll: (g, l) => {
    const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.0, 20), mat(l, 1, 0.1));
    paper.rotation.z = Math.PI / 2;
    const rodA = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.2, 10), mat({ tint: 0x6b4a2a, metal: 0, rough: 0.7 }));
    rodA.rotation.z = Math.PI / 2;
    rodA.position.y = 0.16;
    const rodB = rodA.clone();
    rodB.position.y = -0.16;
    g.add(paper, rodA, rodB);
  },
  ingredient: (g, l) => {
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), mat(l, 1, 0.05));
    // Push vertices around so no two ingredients read as the same lump.
    const pos = body.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const s = 0.86 + 0.28 * Math.abs(Math.sin(i * 12.9898 + l.tint * 0.0001));
      pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 1.15, pos.getZ(i) * s);
    }
    body.geometry.computeVertexNormals();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.3, 8), mat({ tint: 0x5f7a63, metal: 0, rough: 0.8 }));
    stem.position.y = 0.44;
    g.add(body, stem);
  },
  soulgem: (g, l) => {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.46, 0), new THREE.MeshPhysicalMaterial({
      color: l.tint, emissive: new THREE.Color(l.tint).multiplyScalar(0.3), roughness: 0.04,
      metalness: 0.1, transmission: 0.7, thickness: 0.6, ior: 2.1, transparent: true, opacity: 0.85,
    }));
    gem.scale.y = 1.5;
    g.add(gem);
  },
  lockpick: (g, l) => {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.5, 10), mat(LEATHER, 1.1));
    handle.position.y = -0.34;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.9, 8), mat(l));
    shaft.position.y = 0.24;
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 6, 12, Math.PI), mat(l));
    hook.position.set(0.07, 0.68, 0);
    hook.rotation.z = Math.PI / 2;
    g.add(handle, shaft, hook);
  },
  coin: (g, l) => {
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 24), mat(l, 0.9 + i * 0.03));
      c.position.set(Math.sin(i * 2.1) * 0.05, -0.2 + i * 0.06, Math.cos(i * 2.1) * 0.05);
      c.rotation.y = i * 0.7;
      g.add(c);
    }
  },
  mortar: (g, l) => {
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.45, 22, 14, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), mat(l));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.04, 8, 26), mat(l, 0.9));
    rim.rotation.x = Math.PI / 2;
    const pestle = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.42, 6, 12), mat(l, 0.95, 0.05));
    pestle.position.set(0.22, 0.2, 0);
    pestle.rotation.z = -0.5;
    g.add(bowl, rim, pestle);
  },
};

export class ItemPreview {
  readonly canvas = document.createElement('canvas');
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1.24, 0.1, 40);
  private readonly pivot = new THREE.Group();
  private current: THREE.Group | null = null;
  private env: THREE.Texture | null = null;
  private spin = 0;
  private dragging = false;
  private readonly reduced = reducedMotion();
  private failed = false;

  constructor() {
    this.camera.position.set(0, 0.25, 3.3);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.pivot);

    const key = new THREE.DirectionalLight(0xffe6c0, 2.6);
    key.position.set(2.2, 3.0, 2.4);
    const fill = new THREE.DirectionalLight(0x5b7ea8, 0.8);
    fill.position.set(-2.6, 0.6, -1.2);
    const rim = new THREE.DirectionalLight(0xff9a4a, 1.4);
    rim.position.set(-1.2, 1.4, -2.8);
    this.scene.add(key, fill, rim, new THREE.AmbientLight(0x3b3226, 0.5));

    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointerup', (e) => {
      this.dragging = false;
      this.canvas.releasePointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) this.spin += e.movementX * 0.012;
    });
  }

  private ensure(): boolean {
    if (this.renderer !== null) return true;
    if (this.failed) return false;
    try {
      const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      r.setPixelRatio(Math.min(devicePixelRatio, 2));
      r.setSize(212, 170, false);
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.05;
      this.renderer = r;
      this.env = buildEnv(r);
      this.scene.environment = this.env;
      return true;
    } catch {
      // A second context is a courtesy, not a requirement. If the driver caps
      // us, the inventory still works; it just shows the glyph instead.
      this.failed = true;
      return false;
    }
  }

  show(shape: ShapeId, look: Look): void {
    if (!this.ensure()) return;
    this.clearMesh();
    const g = new THREE.Group();
    BUILD[shape](g, look);
    // Frame whatever was built: item scales differ by 4x and hand-tuning a
    // camera distance per shape would rot the moment a shape changes.
    const box = new THREE.Box3().setFromObject(g);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
    g.position.sub(centre);
    const holder = new THREE.Group();
    holder.add(g);
    holder.scale.setScalar(1.15 / radius);
    this.pivot.add(holder);
    this.current = holder;
  }

  private clearMesh(): void {
    if (this.current === null) return;
    this.current.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) for (const x of m) x.dispose();
        else m.dispose();
      }
    });
    this.pivot.remove(this.current);
    this.current = null;
  }

  render(dt: number): void {
    if (this.renderer === null || this.current === null) return;
    if (!this.reduced && !this.dragging) this.spin += dt * 0.55;
    this.pivot.rotation.y = this.spin;
    this.pivot.rotation.x = this.reduced ? 0.22 : 0.22 + Math.sin(this.spin * 0.5) * 0.06;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.clearMesh();
    this.env?.dispose();
    this.renderer?.dispose();
    this.renderer = null;
  }
}

/**
 * A two-band equirect — sulphur sky over ash ground — pushed through PMREM.
 * Items lit only by punctual lights read as plastic; this is what gives the
 * metal somewhere to reflect.
 */
function buildEnv(r: THREE.WebGLRenderer): THREE.Texture {
  const w = 32;
  const h = 16;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    const sky = [0xc9 / 255, 0x9a / 255, 0x5c / 255];
    const horizon = [0x7d / 255, 0x5a / 255, 0x3e / 255];
    const ground = [0x2a / 255, 0x26 / 255, 0x22 / 255];
    const a = t < 0.5 ? t * 2 : 0;
    const b = t < 0.5 ? 0 : (t - 0.5) * 2;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = sky[c] + (horizon[c] - sky[c]) * a;
        const v = t < 0.5 ? top : horizon[c] + (ground[c] - horizon[c]) * b;
        data[i + c] = Math.round(v * 255);
      }
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const pmrem = new THREE.PMREMGenerator(r);
  const rt = pmrem.fromEquirectangular(tex);
  tex.dispose();
  pmrem.dispose();
  return rt.texture;
}
