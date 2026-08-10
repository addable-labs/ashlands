import * as THREE from 'three';
import type { ITerrain } from '../core/contracts';
import { Surface } from '../core/types';
import { clamp01, smoothstep } from './Noise';

/**
 * Terrain sampled into two GPU-readable fields.
 *
 * Ground cover has to place, sink and orient 200k blades per frame, which rules
 * out any CPU query: the blade's ground height is fetched in the vertex shader
 * from a heightfield texture whose texel centres are aligned exactly with the
 * terrain's own samples, so `texture(uHeightTex, ...)` and `terrain.heightAt()`
 * return the same number. Anything less and grass floats above the ground in
 * some places and sinks into it in others — the single most obvious foliage
 * defect there is.
 *
 * The ecology field is coarser (one texel per ~7.8 m) because habitat is a
 * landscape-scale property, and because `materialAt` is two orders of magnitude
 * more expensive than `heightAt`.
 */

/** Height texture resolution. Matches the terrain heightfield exactly. */
const HRES = 2048;
/** Ecology texture resolution over the same extent. */
const ERES = 512;

export interface EcoSample {
  /** Ground-cover grass and moss. */
  grass: number;
  /** Fungal suitability: sheltered, damp, level ground. */
  fung: number;
  /** Ash and cinder. */
  ash: number;
  /** Exposed rock and basalt. */
  rock: number;
}

export class TerrainField {
  heightTex: THREE.DataTexture | null = null;
  ecoTex: THREE.DataTexture | null = null;
  extent = 2000;

  private eco = new Uint8Array(0);
  private heights = new Float32Array(0);

  /**
   * Build both fields. Yields between row blocks: 4.2M height probes plus 262k
   * material probes is roughly half a second of solid JS, and the boot bar has
   * to be able to repaint through it.
   */
  async build(terrain: ITerrain, floatLinear: boolean): Promise<void> {
    this.extent = terrain.extent;
    const E = this.extent;

    // --- heightfield -------------------------------------------------------
    // Sample spacing 2E/(HRES-1) with texel centres ON the samples, which is the
    // alignment `heightAt`'s bilinear filter assumes.
    const step = (2 * E) / (HRES - 1);
    const h = new Float32Array(HRES * HRES);
    for (let j = 0; j < HRES; j++) {
      const z = -E + j * step;
      const row = j * HRES;
      for (let i = 0; i < HRES; i++) {
        h[row + i] = terrain.heightAt(-E + i * step, z);
      }
      if ((j & 63) === 63) await new Promise<void>((r) => setTimeout(r, 0));
    }
    this.heights = h;

    const ht = new THREE.DataTexture(h, HRES, HRES, THREE.RedFormat, THREE.FloatType);
    // Without OES_texture_float_linear a float texture silently samples NEAREST,
    // which would step every blade base onto a 2 m lattice. Fall back to a
    // deliberate NearestFilter in that case so the failure is at least honest,
    // and note it: on the target hardware the extension is always present.
    ht.minFilter = floatLinear ? THREE.LinearFilter : THREE.NearestFilter;
    ht.magFilter = floatLinear ? THREE.LinearFilter : THREE.NearestFilter;
    ht.wrapS = THREE.ClampToEdgeWrapping;
    ht.wrapT = THREE.ClampToEdgeWrapping;
    ht.generateMipmaps = false;
    ht.colorSpace = THREE.NoColorSpace;
    ht.needsUpdate = true;
    this.heightTex = ht;

    // --- ecology -----------------------------------------------------------
    const es = (2 * E) / ERES;
    const data = new Uint8Array(ERES * ERES * 4);
    const n = new THREE.Vector3();
    for (let j = 0; j < ERES; j++) {
      const z = -E + (j + 0.5) * es;
      for (let i = 0; i < ERES; i++) {
        const x = -E + (i + 0.5) * es;
        const y = terrain.heightAt(x, z);
        terrain.normalAt(x, z, n);
        const slope = 1 - clamp01(n.y);
        const surf = terrain.materialAt(x, z);

        const isGrass = surf === Surface.Grass ? 1 : 0;
        const isMud = surf === Surface.Mud ? 1 : 0;
        const isSand = surf === Surface.Sand ? 1 : 0;
        const isAsh = surf === Surface.Ash ? 1 : 0;
        const isRock = surf === Surface.Rock ? 1 : 0;
        const isStone = surf === Surface.Stone ? 1 : 0;
        const isLava = surf === Surface.Lava ? 1 : 0;

        // Altitude falloff: the flanks of Ember Mount are sterile long before
        // the summit, and nothing at all grows in the lava zone.
        const alt = 1 - smoothstep(210, 560, y);
        const level = 1 - smoothstep(0.14, 0.40, slope);
        const dry = 1 - isLava;
        /**
         * `materialAt` is an ARGMAX, and treating its Lava answer as "molten" is
         * what emptied the whole upper third of the map.
         *
         * The terrain splat is a continuous blend of eight layers; materialAt
         * returns whichever has the largest weight. On the flanks of Ember Mount
         * lava_crust wins that vote by a small margin over ash over a very large
         * area — ground that renders, correctly, as grey cinder and reads as ash
         * to the eye. Multiplying every habitat channel by (1 - isLava) therefore
         * declared hundreds of hectares of ordinary cinder to be molten rock and
         * grew nothing on any of it. That is the ridge blocker: "not a single
         * plant in the frame ... detail density in the near 10 m is effectively
         * zero", on a vantage whose ground is not lava at all.
         *
         * Grass and fungus still refuse it outright — they need water and
         * shelter, and neither exists on a clinker field. Ash-adapted scrub does
         * not: scathecraw and trama root are the plants that colonise fresh
         * cinder, and giving them a reduced but non-zero weight there is both
         * ecologically right and the difference between a place and a heightfield.
         */
        const cinder = 0.42 * isLava;

        const grass = clamp01(isGrass + 0.62 * isMud + 0.10 * isSand) * alt * dry * (0.25 + 0.75 * level);
        // Damp, sheltered, level: exactly the terrain the splat calls Grass or
        // Mud, because the terrain derives those from its own shelter and flow
        // channels. Flora inherits that rather than inventing a second ecology.
        const wet = smoothstep(26, -2, y);
        const fung =
          clamp01(0.85 * isGrass + 0.75 * isMud + 0.30 * isSand * wet) *
          alt * dry * (1 - smoothstep(0.16, 0.38, slope));
        const ash = clamp01(isAsh + 0.45 * isSand + cinder) * (1 - smoothstep(0.22, 0.52, slope));
        const rock = clamp01(isRock * 0.8 + isStone + 0.30 * isLava);

        const o = (j * ERES + i) * 4;
        data[o] = (clamp01(grass) * 255) | 0;
        data[o + 1] = (clamp01(fung) * 255) | 0;
        data[o + 2] = (clamp01(ash) * 255) | 0;
        data[o + 3] = (clamp01(rock) * 255) | 0;
      }
      if ((j & 31) === 31) await new Promise<void>((r) => setTimeout(r, 0));
    }
    this.eco = data;

    const et = new THREE.DataTexture(data, ERES, ERES, THREE.RGBAFormat, THREE.UnsignedByteType);
    et.minFilter = THREE.LinearFilter;
    et.magFilter = THREE.LinearFilter;
    et.wrapS = THREE.ClampToEdgeWrapping;
    et.wrapT = THREE.ClampToEdgeWrapping;
    et.generateMipmaps = false;
    et.colorSpace = THREE.NoColorSpace;
    et.needsUpdate = true;
    this.ecoTex = et;
  }

  /** Nearest-texel ecology lookup. The hot path of scatter; must not allocate. */
  ecoAt(x: number, z: number, out: EcoSample): EcoSample {
    const E = this.extent;
    let i = (((x + E) / (2 * E)) * ERES) | 0;
    let j = (((z + E) / (2 * E)) * ERES) | 0;
    if (i < 0) i = 0;
    else if (i >= ERES) i = ERES - 1;
    if (j < 0) j = 0;
    else if (j >= ERES) j = ERES - 1;
    const o = (j * ERES + i) * 4;
    out.grass = this.eco[o] / 255;
    out.fung = this.eco[o + 1] / 255;
    out.ash = this.eco[o + 2] / 255;
    out.rock = this.eco[o + 3] / 255;
    return out;
  }

  /** Bilinear height from the same array the GPU samples. */
  heightAt(x: number, z: number): number {
    const E = this.extent;
    const g = (HRES - 1) / (2 * E);
    let gx = (x + E) * g;
    let gz = (z + E) * g;
    if (gx < 0) gx = 0;
    else if (gx > HRES - 1.0001) gx = HRES - 1.0001;
    if (gz < 0) gz = 0;
    else if (gz > HRES - 1.0001) gz = HRES - 1.0001;
    const i = gx | 0;
    const j = gz | 0;
    const tx = gx - i;
    const tz = gz - j;
    const r0 = j * HRES + i;
    const r1 = r0 + HRES;
    const a = this.heights[r0] + (this.heights[r0 + 1] - this.heights[r0]) * tx;
    const b = this.heights[r1] + (this.heights[r1 + 1] - this.heights[r1]) * tx;
    return a + (b - a) * tz;
  }

  /** (extent, height-texel spacing in metres, 1/(2*extent)) for FIELD_GLSL. */
  params(): THREE.Vector3 {
    return new THREE.Vector3(this.extent, (2 * this.extent) / (HRES - 1), 1 / (2 * this.extent));
  }

  dispose(): void {
    this.heightTex?.dispose();
    this.ecoTex?.dispose();
    this.heightTex = null;
    this.ecoTex = null;
    this.heights = new Float32Array(0);
    this.eco = new Uint8Array(0);
  }
}

/** GLSL for reading the two fields. Shared by ground cover and any future user. */
export const FIELD_GLSL = /* glsl */ `
#ifndef FLORA_FIELD
#define FLORA_FIELD
uniform sampler2D uHeightTex;
uniform sampler2D uEcoTex;
uniform vec3 uFieldParams;   // x = extent, y = height texel step (world m), z = 1/(2*extent)

vec2 fieldUV(vec2 p) {
  // Texel centres sit on the terrain's height samples: uv = (index + 0.5)/RES,
  // index = (p + E) / step.
  float inv = uFieldParams.z;
  return (p * inv + 0.5) * (1.0 - 1.0 / ${HRES}.0) + 0.5 / ${HRES}.0;
}

float fieldHeight(vec2 p) {
  return texture2D(uHeightTex, fieldUV(p)).r;
}

/**
 * Terrain normal from the same texels the terrain mesh is built from.
 *
 * h0 is the height already fetched at p, so this costs two texture reads
 * rather than four. That matters: it runs once per ground-cover VERTEX, and at
 * a quarter of a million blades the two saved fetches are the difference
 * between a two-millisecond field and a three-millisecond one. A forward
 * difference is slightly biased against a central one, by half a texel over a
 * two-metre sample spacing — far below anything a blade of grass can show.
 */
vec3 fieldNormal(vec2 p, float h0) {
  float e = uFieldParams.y;
  float hr = fieldHeight(p + vec2(e, 0.0));
  float hu = fieldHeight(p + vec2(0.0, e));
  return normalize(vec3(h0 - hr, e, h0 - hu));
}

vec4 fieldEco(vec2 p) {
  return texture2D(uEcoTex, p * uFieldParams.z + 0.5);
}
#endif
`;
