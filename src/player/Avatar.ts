import * as THREE from 'three';
import type { CharacterController } from './Controller';
import { BAND, buildAvatarTextures, type AvatarTextureSet } from './AvatarTextures';
import { clamp, damp, lerp, smoothstep } from './mathx';

const BONE_NAMES = [
  'hips',
  'spine',
  'chest',
  'head',
  'armLU',
  'armLL',
  'armRU',
  'armRL',
  'legLU',
  'legLL',
  'legRU',
  'legRL',
] as const;

const enum B {
  Hips = 0,
  Spine = 1,
  Chest = 2,
  Head = 3,
  ArmLU = 4,
  ArmLL = 5,
  ArmRU = 6,
  ArmRL = 7,
  LegLU = 8,
  LegLL = 9,
  LegRU = 10,
  LegRL = 11,
}

/** Rest positions in character space: feet on y=0, facing -Z. */
const REST: ReadonlyArray<[number, number, number]> = [
  [0, 0.95, 0],
  [0, 1.14, 0],
  [0, 1.34, 0],
  [0, 1.55, 0],
  [0.19, 1.44, 0],
  [0.245, 1.16, 0],
  [-0.19, 1.44, 0],
  [-0.245, 1.16, 0],
  [0.115, 0.92, 0],
  [0.12, 0.5, 0],
  [-0.115, 0.92, 0],
  [-0.12, 0.5, 0],
];

const PARENT: ReadonlyArray<number> = [-1, 0, 1, 2, 2, 4, 2, 6, 0, 8, 0, 10];
const HIP_PIVOT = 0.95;

type Vec3 = [number, number, number];

class MeshBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uv: number[] = [];
  readonly si: number[] = [];
  readonly sw: number[] = [];
  readonly idx: number[] = [];

  private push(p: Vec3, n: Vec3, u: number, v: number, bA: number, bB: number, w: number): void {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    this.si.push(bA, bB, 0, 0);
    this.sw.push(1 - w, w, 0, 0);
  }

  /**
   * Swept generalised cylinder. Everything on the body except the head, hands
   * and pauldrons is one of these — a robe skirt is just a tube with a bell
   * profile, which keeps the whole avatar to one geometry.
   */
  addTube(
    a: Vec3,
    b: Vec3,
    profile: (t: number) => number,
    radial: number,
    rings: number,
    bA: number,
    bB: number,
    blend: [number, number],
    band: readonly [number, number],
    uRepeat: number,
    capEnd = false,
  ): void {
    const ax = b[0] - a[0];
    const ay = b[1] - a[1];
    const az = b[2] - a[2];
    const len = Math.hypot(ax, ay, az) || 1e-5;
    const dx = ax / len;
    const dy = ay / len;
    const dz = az / len;
    // Any reference not parallel to the axis gives a stable frame; limbs are
    // near-vertical so pick Z for those and Y otherwise.
    const vertical = Math.abs(dy) > 0.9;
    const rx = 0;
    const ry = vertical ? 0 : 1;
    const rz = vertical ? 1 : 0;
    let u1x = ry * dz - rz * dy;
    let u1y = rz * dx - rx * dz;
    let u1z = rx * dy - ry * dx;
    const u1l = Math.hypot(u1x, u1y, u1z) || 1e-5;
    u1x /= u1l;
    u1y /= u1l;
    u1z /= u1l;
    const u2x = dy * u1z - dz * u1y;
    const u2y = dz * u1x - dx * u1z;
    const u2z = dx * u1y - dy * u1x;

    const base = this.pos.length / 3;
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const rad = profile(t);
      const e = 0.02;
      const dr = (profile(Math.min(1, t + e)) - profile(Math.max(0, t - e))) / (Math.min(1, t + e) - Math.max(0, t - e));
      const slope = -dr / len;
      const w = blend[1] > blend[0] ? smoothstep(blend[0], blend[1], t) : 1;
      const cx = a[0] + dx * len * t;
      const cy = a[1] + dy * len * t;
      const cz = a[2] + dz * len * t;
      const v = band[0] + t * (band[1] - band[0]);
      for (let i = 0; i <= radial; i++) {
        const ang = (i / radial) * Math.PI * 2;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const nxr = u1x * ca + u2x * sa;
        const nyr = u1y * ca + u2y * sa;
        const nzr = u1z * ca + u2z * sa;
        let nx = nxr + dx * slope;
        let ny = nyr + dy * slope;
        let nz = nzr + dz * slope;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        this.push(
          [cx + nxr * rad, cy + nyr * rad, cz + nzr * rad],
          [nx, ny, nz],
          (i / radial) * uRepeat,
          v,
          bA,
          bB,
          w,
        );
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let i = 0; i < radial; i++) {
        const p0 = base + r * (radial + 1) + i;
        const p1 = p0 + 1;
        const p2 = p0 + radial + 1;
        const p3 = p2 + 1;
        this.idx.push(p0, p2, p1, p1, p2, p3);
      }
    }

    if (capEnd) {
      const rad = profile(1);
      const c = this.pos.length / 3;
      this.push([b[0], b[1], b[2]], [dx, dy, dz], 0.5 * uRepeat, band[1], bA, bB, 1);
      const ringStart = c + 1;
      for (let i = 0; i <= radial; i++) {
        const ang = (i / radial) * Math.PI * 2;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const nxr = u1x * ca + u2x * sa;
        const nyr = u1y * ca + u2y * sa;
        const nzr = u1z * ca + u2z * sa;
        this.push([b[0] + nxr * rad, b[1] + nyr * rad, b[2] + nzr * rad], [dx, dy, dz], (i / radial) * uRepeat, band[1], bA, bB, 1);
      }
      for (let i = 0; i < radial; i++) this.idx.push(c, ringStart + i, ringStart + i + 1);
    }
  }

  addEllipsoid(
    c: Vec3,
    r: Vec3,
    seg: number,
    rows: number,
    bone: number,
    band: readonly [number, number],
    uRepeat: number,
  ): void {
    const base = this.pos.length / 3;
    for (let y = 0; y <= rows; y++) {
      const ty = y / rows;
      const phi = ty * Math.PI;
      const sp = Math.sin(phi);
      const cp = Math.cos(phi);
      const v = band[0] + ty * (band[1] - band[0]);
      for (let i = 0; i <= seg; i++) {
        const ang = (i / seg) * Math.PI * 2;
        const ux = sp * Math.cos(ang);
        const uy = cp;
        const uz = sp * Math.sin(ang);
        let nx = ux / (r[0] * r[0]);
        let ny = uy / (r[1] * r[1]);
        let nz = uz / (r[2] * r[2]);
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        this.push([c[0] + ux * r[0], c[1] + uy * r[1], c[2] + uz * r[2]], [nx, ny, nz], (i / seg) * uRepeat, v, bone, bone, 0);
      }
    }
    for (let y = 0; y < rows; y++) {
      for (let i = 0; i < seg; i++) {
        const p0 = base + y * (seg + 1) + i;
        const p1 = p0 + 1;
        const p2 = p0 + seg + 1;
        const p3 = p2 + 1;
        this.idx.push(p0, p2, p1, p1, p2, p3);
      }
    }
  }
}

/**
 * Third-person body. A single SkinnedMesh over twelve bones, posed
 * procedurally from the controller's gait phase — no clips, no keyframes, and
 * one draw call. Hidden entirely in first person so it costs nothing there.
 */
export class PlayerAvatar {
  readonly root = new THREE.Group();
  private readonly tilt = new THREE.Group();
  private readonly bones: THREE.Bone[] = [];
  private mesh: THREE.SkinnedMesh;
  private material: THREE.MeshStandardMaterial;
  private tex: AvatarTextureSet;
  private skeleton: THREE.Skeleton;
  private leanX = 0;
  private crouchDrop = 0;
  private idleT = 0;

  constructor(anisotropy: number) {
    this.root.name = 'player-avatar';
    this.tilt.position.set(0, HIP_PIVOT, 0);
    this.tilt.rotation.order = 'YXZ';
    this.root.add(this.tilt);

    for (let i = 0; i < BONE_NAMES.length; i++) {
      const bone = new THREE.Bone();
      bone.name = BONE_NAMES[i];
      bone.rotation.order = 'YXZ';
      const p = PARENT[i];
      if (p < 0) bone.position.set(0, 0, 0);
      else bone.position.set(REST[i][0] - REST[p][0], REST[i][1] - REST[p][1], REST[i][2] - REST[p][2]);
      this.bones.push(bone);
    }
    for (let i = 0; i < this.bones.length; i++) {
      const p = PARENT[i];
      if (p < 0) this.tilt.add(this.bones[i]);
      else this.bones[p].add(this.bones[i]);
    }

    const geo = buildGeometry();
    this.tex = buildAvatarTextures(512, anisotropy);
    this.material = new THREE.MeshStandardMaterial({
      map: this.tex.albedo,
      normalMap: this.tex.normal,
      aoMap: this.tex.arm,
      roughnessMap: this.tex.arm,
      metalnessMap: this.tex.arm,
      roughness: 1,
      metalness: 1,
      aoMapIntensity: 1,
      envMapIntensity: 1,
    });
    this.material.normalScale.set(1.1, 1.1);

    this.mesh = new THREE.SkinnedMesh(geo, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // The skin deforms well outside the bind bounds when swimming; a padded
    // sphere is cheaper than recomputing bounds every frame.
    geo.computeBoundingSphere();
    if (geo.boundingSphere) geo.boundingSphere.radius *= 1.6;
    this.root.add(this.mesh);

    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
    this.mesh.bind(this.skeleton);
  }

  get object(): THREE.Object3D {
    return this.root;
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  update(ctrl: CharacterController, yaw: number, pitch: number, dt: number): void {
    if (!this.root.visible) return;
    this.idleT += dt;

    const p = ctrl.gaitPhase;
    const gait = clamp(ctrl.gaitAmount, 0, 1.3);
    const runK = smoothstep(ctrl.tuning.walkSpeed * 0.9, ctrl.tuning.runSpeed, ctrl.speed);
    const swing = lerp(0.42, 0.78, runK) * gait;
    const armSwing = lerp(0.34, 0.62, runK) * gait;
    const sp = Math.sin(p);
    const cp = Math.cos(p);

    const airborne = !ctrl.grounded && !ctrl.swimming && !ctrl.levitate;
    const swim = ctrl.swimming ? 1 : 0;
    const lev = ctrl.levitate ? 1 : 0;

    this.crouchDrop = damp(this.crouchDrop, ctrl.crouchBlend * 0.34, 11, dt);
    const targetLean = swim ? -1.15 : lev ? -0.18 : 0;
    this.leanX = damp(this.leanX, targetLean, 6, dt);
    this.tilt.rotation.x = this.leanX;

    const hips = this.bones[B.Hips];
    hips.position.y = -this.crouchDrop;
    hips.rotation.y = sp * 0.06 * gait;
    hips.rotation.x = 0.04 + ctrl.crouchBlend * 0.22;

    const breathe = Math.sin(this.idleT * 1.35) * 0.018 * (1 - gait);
    this.bones[B.Spine].rotation.set(0.03 + ctrl.crouchBlend * 0.2 + breathe, -sp * 0.07 * gait, 0);
    this.bones[B.Chest].rotation.set(0.02 - breathe * 0.5, -sp * 0.05 * gait, 0);
    // Head holds the horizon: it takes most of the camera pitch back out so
    // the body can lean without the face pointing at the ground.
    this.bones[B.Head].rotation.set(clamp(-pitch * 0.42 - this.leanX * 0.75, -0.6, 0.6), 0, 0);

    const legSwingL = swim ? Math.sin(this.idleT * 4.2) * 0.5 : lev ? 0.18 : sp * swing;
    const legSwingR = swim ? Math.sin(this.idleT * 4.2 + Math.PI) * 0.5 : lev ? 0.1 : -sp * swing;
    const crouchBend = ctrl.crouchBlend * 0.55;
    const tuck = airborne ? clamp(-ctrl.velocity.y * 0.045, -0.25, 0.55) : 0;

    this.bones[B.LegLU].rotation.set(legSwingL + crouchBend + tuck, 0, 0.02);
    this.bones[B.LegRU].rotation.set(legSwingR + crouchBend + tuck, 0, -0.02);
    // Knees only fold backwards, and only on the recovery half of the stride.
    const kneeL = swim ? 0.5 + Math.sin(this.idleT * 4.2 + 1.2) * 0.35 : Math.max(0, -Math.sin(p - 0.5)) * swing * 1.5;
    const kneeR = swim ? 0.5 + Math.sin(this.idleT * 4.2 + 1.2 + Math.PI) * 0.35 : Math.max(0, Math.sin(p - 0.5)) * swing * 1.5;
    this.bones[B.LegLL].rotation.x = -(kneeL + crouchBend * 2.0 + tuck * 1.4 + lev * 0.7);
    this.bones[B.LegRL].rotation.x = -(kneeR + crouchBend * 2.0 + tuck * 1.4 + lev * 0.5);

    const armBase = swim ? -0.9 : lev ? -0.35 : 0.0;
    const armL = swim ? Math.sin(this.idleT * 3.1) * 0.35 : -sp * armSwing;
    const armR = swim ? Math.sin(this.idleT * 3.1 + Math.PI) * 0.35 : sp * armSwing;
    this.bones[B.ArmLU].rotation.set(armBase + armL, 0, 0.13 + gait * 0.03 + swim * 0.5);
    this.bones[B.ArmRU].rotation.set(armBase + armR, 0, -0.13 - gait * 0.03 - swim * 0.5);
    const elbow = -0.28 - runK * 0.5 * gait - swim * 0.5;
    this.bones[B.ArmLL].rotation.x = elbow - Math.max(0, armL) * 0.6;
    this.bones[B.ArmRL].rotation.x = elbow - Math.max(0, armR) * 0.6;

    this.root.rotation.y = yaw;
    this.root.position.set(ctrl.position.x, ctrl.position.y + (swim ? 0.28 : 0) - cp * 0.018 * gait, ctrl.position.z);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.tex.dispose();
    this.skeleton.dispose();
    this.root.removeFromParent();
  }
}

function buildGeometry(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const RAD = 12;
  const cloth = BAND.cloth;
  const chitin = BAND.chitin;
  const leather = BAND.leather;
  const skin = BAND.skin;

  // Robe: a bell that flares to the knee, so the silhouette reads Dunmer
  // rather than generic-adventurer even at LOD distance.
  b.addTube(
    [0, 1.02, 0],
    [0, 0.46, 0],
    (t) => 0.225 + t * t * 0.21 + Math.sin(t * 9) * 0.006,
    RAD,
    7,
    B.Hips,
    B.Hips,
    [0, 1],
    cloth,
    3,
  );
  b.addTube([0, 0.96, 0], [0, 1.16, 0], (t) => 0.255 - t * 0.03, RAD, 3, B.Hips, B.Spine, [0.15, 0.85], cloth, 3);
  b.addTube([0, 1.14, 0], [0, 1.42, 0], (t) => 0.225 - t * 0.01 + Math.sin(t * 3.1) * 0.012, RAD, 4, B.Spine, B.Chest, [0.1, 0.8], cloth, 3);
  // Cowl over the shoulders.
  b.addTube([0, 1.38, 0], [0, 1.63, 0], (t) => 0.3 - t * t * 0.16, RAD, 4, B.Chest, B.Chest, [0, 1], cloth, 3);
  // Belt.
  b.addTube([0, 1.02, 0], [0, 0.95, 0], () => 0.262, RAD, 1, B.Hips, B.Hips, [0, 1], leather, 4);

  b.addEllipsoid([0, 1.6, 0], [0.113, 0.132, 0.12], 14, 10, B.Head, skin, 2);
  // Hood, swept back off the brow.
  b.addTube(
    [0, 1.47, 0.028],
    [0, 1.79, 0.075],
    (t) => 0.2 * (1 - t * t * 0.94) + 0.012,
    RAD,
    6,
    B.Head,
    B.Head,
    [0, 0],
    cloth,
    3,
    true,
  );

  for (const s of [1, -1]) {
    const au = s > 0 ? B.ArmLU : B.ArmRU;
    const al = s > 0 ? B.ArmLL : B.ArmRL;
    const lu = s > 0 ? B.LegLU : B.LegRU;
    const ll = s > 0 ? B.LegLL : B.LegRL;

    b.addTube([0.185 * s, 1.45, 0], [0.245 * s, 1.17, 0], (t) => 0.088 - t * 0.017, 10, 4, B.Chest, au, [0.05, 0.5], cloth, 2);
    b.addTube([0.245 * s, 1.17, 0], [0.262 * s, 0.9, 0], (t) => 0.071 - t * 0.014, 10, 4, au, al, [0.1, 0.55], cloth, 2);
    b.addEllipsoid([0.264 * s, 0.875, 0], [0.055, 0.068, 0.05], 10, 7, al, skin, 1);
    // Chitin pauldron, the one hard-surface note against all that cloth.
    b.addEllipsoid([0.215 * s, 1.47, 0], [0.145, 0.104, 0.15], 12, 8, au, chitin, 2);

    b.addTube([0.115 * s, 0.95, 0], [0.12 * s, 0.52, 0], (t) => 0.113 - t * 0.028, 10, 4, B.Hips, lu, [0.05, 0.5], cloth, 2);
    b.addTube([0.12 * s, 0.52, 0], [0.12 * s, 0.13, 0], (t) => 0.085 - t * 0.02, 10, 4, lu, ll, [0.1, 0.5], leather, 2);
    // Boot.
    b.addTube([0.12 * s, 0.115, 0.03], [0.12 * s, 0.05, -0.16], (t) => 0.076 - t * 0.02, 10, 3, ll, ll, [0, 0], leather, 2, true);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(b.si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(b.sw, 4));
  g.setIndex(b.idx);
  return g;
}
