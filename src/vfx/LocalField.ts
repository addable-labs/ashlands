import * as THREE from 'three';
import type { ITerrain } from '../core/contracts';
import { Surface } from '../core/types';

/**
 * Resident local heightfield — the terrain within a `SIZE`-metre box centred on
 * the camera, resampled into a small RGBA-float texture that vertex and
 * fragment shaders can read.
 *
 * Why this exists: `ITerrain` is a CPU query interface (`heightAt`, `normalAt`,
 * `materialAt`) and the terrain's own heightfield texture is private to that
 * subsystem. Without a GPU-readable ground, every ambient effect that has to
 * *know where the ground is* — fog pooling in hollows, embers gated to lava
 * crust, spray gated to the shoreline, and above all the soft fade that stops a
 * particle from slicing into a slope — would have to be driven per-particle
 * from JavaScript. This is the one CPU->GPU bridge that makes the whole
 * subsystem vertex-parametric.
 *
 * Cost: 96x96 samples, refilled a few rows per frame into a back buffer and
 * swapped when complete, so a re-centre never stalls a frame.
 *
 *   r  terrain height, metres
 *   g  lava-crust weight, 0..1 (blurred, so embers do not appear in a hard grid)
 *   b  flatness, = surface normal Y
 *   a  water depth below sea level, metres (0 on land)
 */

const RES = 96;
export const SIZE = 192;
/** Re-centre once the camera has left the middle third of the box. */
const RECENTER = SIZE / 6;
/** Rows resampled per frame. 96 rows => a full refill inside 12 frames. */
const ROWS_PER_FRAME = 8;
const SEA_LEVEL = 0;

export class LocalField {
  readonly texture: THREE.DataTexture;
  /** World XZ centre of the data currently resident in `texture`. */
  readonly origin = new THREE.Vector2();
  /** False until the first full fill has been uploaded. */
  valid = false;

  private front: Float32Array;
  private back: Float32Array;
  private lava: Float32Array;
  private pending = new THREE.Vector2();
  private row = RES;
  private filling = false;

  constructor() {
    this.front = new Float32Array(RES * RES * 4);
    this.back = new Float32Array(RES * RES * 4);
    this.lava = new Float32Array(RES * RES);
    this.texture = new THREE.DataTexture(this.front, RES, RES, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.name = 'vfx:localfield';
  }

  /** Immediate full resample. Called once at init so frame one is already correct. */
  prime(terrain: ITerrain, cx: number, cz: number): void {
    this.pending.set(cx, cz);
    this.row = 0;
    this.fillRows(terrain, RES);
    this.commit();
  }

  update(terrain: ITerrain, cam: THREE.Vector3): void {
    if (!this.filling) {
      const drifted =
        Math.abs(cam.x - this.origin.x) > RECENTER || Math.abs(cam.z - this.origin.y) > RECENTER;
      if (!drifted) return;
      // Lead the camera: by the time the refill lands the camera has moved on,
      // so centring on where it is *now* wastes a third of the box behind it.
      this.pending.set(cam.x, cam.z);
      this.row = 0;
      this.filling = true;
    }
    this.fillRows(terrain, ROWS_PER_FRAME);
    if (this.row >= RES) this.commit();
  }

  private fillRows(terrain: ITerrain, rows: number): void {
    const step = SIZE / (RES - 1);
    const x0 = this.pending.x - SIZE * 0.5;
    const z0 = this.pending.y - SIZE * 0.5;
    const n = new THREE.Vector3();
    const end = Math.min(RES, this.row + rows);
    for (let j = this.row; j < end; j++) {
      const z = z0 + j * step;
      for (let i = 0; i < RES; i++) {
        const x = x0 + i * step;
        const k = (j * RES + i) * 4;
        const h = terrain.heightAt(x, z);
        terrain.normalAt(x, z, n);
        this.back[k] = h;
        this.lava[j * RES + i] = terrain.materialAt(x, z) === Surface.Lava ? 1 : 0;
        this.back[k + 2] = n.y;
        this.back[k + 3] = Math.max(0, SEA_LEVEL - h);
      }
    }
    this.row = end;
  }

  /**
   * Publish the back buffer. The lava mask is blurred on the way in: the
   * terrain's material index is a hard argmax, so using it raw would emit
   * embers in a visible 2-metre grid along the classification boundary.
   */
  private commit(): void {
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        let s = 0;
        let w = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= RES) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            if (ii < 0 || ii >= RES) continue;
            const k = dj === 0 && di === 0 ? 4 : 1;
            s += this.lava[jj * RES + ii] * k;
            w += k;
          }
        }
        this.back[(j * RES + i) * 4 + 1] = s / w;
      }
    }
    this.front.set(this.back);
    this.origin.copy(this.pending);
    this.texture.needsUpdate = true;
    this.valid = true;
    this.filling = false;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
