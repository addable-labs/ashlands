import * as THREE from 'three';
import type { V3 } from './Mesh';

/**
 * Skeleton authoring and automatic skinning.
 *
 * Bones are declared in rest space by the segment they occupy (head -> tail).
 * Two things fall out of that: local bone transforms are pure translations with
 * identity rotation — so posing is always "rotate this joint about its head",
 * with no rest-pose basis to fight — and skin weights can be derived from the
 * distance of each vertex to each bone *segment*, which is what gives smooth
 * deformation across a joint instead of the rigid-segment look.
 */

export interface BoneDef {
  name: string;
  parent: string | null;
  /** Joint position in rest space. The bone rotates about this point. */
  head: V3;
  /** Far end of the bone. Only used for skinning distance and IK lengths. */
  tail: V3;
  /** Falloff radius in metres. Vertices beyond it get no weight from this bone. */
  r: number;
  /**
   * Multiplier on this bone's computed weight. Below 1 makes the bone yield to
   * its neighbours — used to stop a jaw grabbing the skull, or a wing finger
   * grabbing the torso it folds against.
   */
  bias?: number;
}

const _v = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();

/** Squared distance from p to the segment ab. */
function distSqToSegment(px: number, py: number, pz: number, a: V3, b: V3): number {
  _ab.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  _ap.set(px - a[0], py - a[1], pz - a[2]);
  const l2 = _ab.lengthSq();
  const t = l2 > 1e-12 ? THREE.MathUtils.clamp(_ap.dot(_ab) / l2, 0, 1) : 0;
  const dx = _ap.x - _ab.x * t;
  const dy = _ap.y - _ab.y * t;
  const dz = _ap.z - _ab.z * t;
  return dx * dx + dy * dy + dz * dz;
}

export class Rig {
  readonly bones: THREE.Bone[] = [];
  readonly index = new Map<string, number>();
  readonly defs: readonly BoneDef[];
  readonly root: THREE.Bone;
  readonly skeleton: THREE.Skeleton;
  /** Rest-space head positions, for IK targets and pole vectors. */
  readonly restHead: THREE.Vector3[] = [];
  readonly restTail: THREE.Vector3[] = [];
  /** Rest local translation of each bone, restored every frame before posing. */
  readonly restLocal: THREE.Vector3[] = [];

  constructor(defs: readonly BoneDef[]) {
    this.defs = defs;
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      if (this.index.has(d.name)) throw new Error(`[actors] duplicate bone "${d.name}"`);
      this.index.set(d.name, i);
      const bone = new THREE.Bone();
      bone.name = d.name;
      this.bones.push(bone);
      this.restHead.push(new THREE.Vector3(d.head[0], d.head[1], d.head[2]));
      this.restTail.push(new THREE.Vector3(d.tail[0], d.tail[1], d.tail[2]));
    }
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      const local = this.restHead[i].clone();
      if (d.parent !== null) {
        const pi = this.index.get(d.parent);
        if (pi === undefined) throw new Error(`[actors] unknown parent "${d.parent}"`);
        local.sub(this.restHead[pi]);
        this.bones[pi].add(this.bones[i]);
      }
      this.bones[i].position.copy(local);
      this.restLocal.push(local.clone());
    }
    const rootIdx = defs.findIndex((d) => d.parent === null);
    this.root = this.bones[rootIdx < 0 ? 0 : rootIdx];
    this.root.updateMatrixWorld(true);
    // Constructed with the bones in rest pose, so three computes exactly the
    // bind inverses we want and no explicit bind matrix is needed.
    this.skeleton = new THREE.Skeleton(this.bones);
  }

  idx(name: string): number {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`[actors] unknown bone "${name}"`);
    return i;
  }

  bone(name: string): THREE.Bone {
    return this.bones[this.idx(name)];
  }

  /** Rest length of a bone, used as the IK segment length. */
  length(name: string): number {
    const i = this.idx(name);
    return this.restHead[i].distanceTo(this.restTail[i]);
  }

  /** Reset every joint to rest. Poses are authored as deltas from here. */
  resetPose(): void {
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i];
      b.quaternion.set(0, 0, 0, 1);
      b.position.copy(this.restLocal[i]);
      b.scale.set(1, 1, 1);
    }
  }
}

/**
 * Bone-distance skinning.
 *
 * Weight falls off as a smooth cubic in the distance to the bone segment,
 * normalised by that bone's radius, and the best four win. The reciprocal tail
 * term is what guarantees no vertex is ever left unweighted (which renders as a
 * shard of geometry frozen at the origin) even if an author's radii are too
 * tight.
 */
export function computeSkinning(
  geo: THREE.BufferGeometry,
  defs: readonly BoneDef[],
  sharpness = 2.0,
): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  const nb = defs.length;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);

  const w = new Float64Array(nb);
  const order = new Int32Array(nb);

  for (let vtx = 0; vtx < n; vtx++) {
    const px = pos.getX(vtx);
    const py = pos.getY(vtx);
    const pz = pos.getZ(vtx);

    for (let b = 0; b < nb; b++) {
      const d = defs[b];
      const d2 = distSqToSegment(px, py, pz, d.head, d.tail);
      const dist = Math.sqrt(d2);
      const bias = d.bias ?? 1;
      const t = 1 - Math.min(1, dist / d.r);
      // Cubic core plus a long reciprocal tail. The core does the shaping; the
      // tail only matters where the core is zero everywhere.
      w[b] = (Math.pow(t, sharpness) * t * t + 1e-4 / (d2 + 1e-3)) * bias;
      order[b] = b;
    }

    // Partial selection sort for the top four — cheaper than a full sort at
    // these bone counts and this runs over ~40k vertices at load.
    for (let k = 0; k < 4 && k < nb; k++) {
      let best = k;
      for (let b = k + 1; b < nb; b++) if (w[order[b]] > w[order[best]]) best = b;
      const tmp = order[k];
      order[k] = order[best];
      order[best] = tmp;
    }

    let sum = 0;
    for (let k = 0; k < 4 && k < nb; k++) sum += w[order[k]];
    if (sum <= 0) {
      si[vtx * 4] = order[0];
      sw[vtx * 4] = 1;
      continue;
    }
    for (let k = 0; k < 4; k++) {
      const b = k < nb ? order[k] : 0;
      si[vtx * 4 + k] = b;
      sw[vtx * 4 + k] = k < nb ? w[b] / sum : 0;
    }
  }

  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
}

/* ------------------------------------------------------------------ posing */

const _q = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();

/**
 * Aim a bone's rest direction at a world-space direction, writing the result as
 * a local quaternion. `parentWorldQ` must already be current.
 */
export function aimBone(
  rig: Rig,
  boneIdx: number,
  worldDir: THREE.Vector3,
  parentWorldQ: THREE.Quaternion,
  twist = 0,
): void {
  const bone = rig.bones[boneIdx];
  _from.copy(rig.restTail[boneIdx]).sub(rig.restHead[boneIdx]);
  if (_from.lengthSq() < 1e-12) return;
  _from.normalize();
  // The rest direction lives in rest space; the parent's world rotation maps
  // rest space to world, so cancel it to get the direction the bone must take
  // in its own parent's frame.
  _to.copy(worldDir).normalize().applyQuaternion(_qp.copy(parentWorldQ).invert());
  _q.setFromUnitVectors(_from, _to);
  if (twist !== 0) bone.quaternion.copy(_q).multiply(_qp.setFromAxisAngle(_from, twist));
  else bone.quaternion.copy(_q);
}
