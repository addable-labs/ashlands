import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './mathx';
import { fbm2, noise2Tiled, worley2 } from './noise';

/**
 * Procedural PBR atlas for the player avatar. Four horizontal bands, addressed
 * by the v coordinate the mesh builder assigns per part:
 *   0.00-0.44 dyed wool / netch-leather robe
 *   0.44-0.62 chitin plate
 *   0.62-0.78 tanned strapping
 *   0.78-1.00 dunmer skin
 * One atlas means one draw call for the whole character.
 */
export const BAND = {
  cloth: [0.02, 0.42] as [number, number],
  chitin: [0.46, 0.60] as [number, number],
  leather: [0.64, 0.76] as [number, number],
  skin: [0.80, 0.98] as [number, number],
};

export interface AvatarTextureSet {
  albedo: THREE.DataTexture;
  normal: THREE.DataTexture;
  /** r = AO, g = roughness, b = metalness, a = height. */
  arm: THREE.DataTexture;
  dispose(): void;
}

const NU = 12; // noise periods around the circumference; keeps u seamless.

function srgbMix(out: [number, number, number], a: number, b: number, c: number): void {
  out[0] = a;
  out[1] = b;
  out[2] = c;
}

export function buildAvatarTextures(size: number, anisotropy: number): AvatarTextureSet {
  const n = size * size;
  const albedo = new Uint8Array(n * 4);
  const arm = new Uint8Array(n * 4);
  const normal = new Uint8Array(n * 4);
  const height = new Float32Array(n);
  const rough = new Float32Array(n);
  const metal = new Float32Array(n);
  const rgb: [number, number, number] = [0, 0, 0];

  const nz = (x: number, y: number, oct: number) => fbm2(x, y, oct, NU, NU);

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const i = y * size + x;
      const su = u * NU;
      const sv = v * NU;

      let h = 0;
      let r = 0.8;
      let m = 0;

      if (v < 0.44) {
        // Wool woven over netch leather. Warp and weft at different pitches so
        // the weave never resolves into a regular grid at grazing angles.
        const warp = 0.5 + 0.5 * Math.sin(su * 26.0);
        const weft = 0.5 + 0.5 * Math.sin(sv * 31.0 + 1.1);
        const weave = warp * 0.55 + weft * 0.45;
        const grime = nz(su * 2.2, sv * 2.2, 4);
        const fibre = noise2Tiled(su * 90, sv * 90, NU * 90, NU * 90);

        // Rust-red madder dye shot through with ochre; ash settles in the hem.
        const dye = smoothstep(0.35, 0.72, grime);
        let cr = lerp(0.088, 0.152, dye);
        let cg = lerp(0.030, 0.072, dye);
        let cb = lerp(0.024, 0.036, dye);
        const dust = clamp(smoothstep(0.30, 0.02, v) * 0.75 + grime * 0.18, 0, 0.8);
        cr = lerp(cr, 0.196, dust);
        cg = lerp(cg, 0.180, dust);
        cb = lerp(cb, 0.161, dust);
        const shade = 0.72 + 0.5 * weave + 0.12 * fibre;
        srgbMix(rgb, cr * shade, cg * shade, cb * shade);

        h = weave * 0.55 + fibre * 0.18 + grime * 0.25;
        r = clamp(0.80 + 0.10 * (1 - weave) + 0.06 * fibre - dust * 0.05, 0.55, 0.98);
      } else if (v < 0.62) {
        // Chitin: jittered plates with hard seams and a wet, lacquered sheen.
        const w = worley2(su * 3.1, sv * 5.0, NU * 3.1, NU * 5.0);
        const edge = clamp((w.f2 - w.f1) * 2.4, 0, 1);
        const plate = smoothstep(0.05, 0.45, edge);
        const tint = nz(su * 1.7, sv * 2.4, 3);
        const bulge = smoothstep(0.0, 0.7, edge);

        const amber = lerp(0.118, 0.245, tint);
        let cr = amber;
        let cg = amber * 0.52;
        let cb = amber * 0.20;
        // Rot glows faintly teal in the seams — the only cool note on the kit.
        const seam = 1 - plate;
        cr = lerp(cr, 0.020, seam);
        cg = lerp(cg, 0.052, seam * 0.9);
        cb = lerp(cb, 0.049, seam * 0.9);
        const spec = 0.85 + 0.35 * bulge;
        srgbMix(rgb, cr * spec, cg * spec, cb * spec);

        h = bulge * 0.85 + nz(su * 22, sv * 22, 2) * 0.1;
        r = clamp(lerp(0.62, 0.24, plate) + nz(su * 8, sv * 8, 2) * 0.08, 0.18, 0.8);
        m = 0.02;
      } else if (v < 0.78) {
        const w = worley2(su * 9.0, sv * 12.0, NU * 9.0, NU * 12.0);
        const crack = clamp((w.f2 - w.f1) * 3.0, 0, 1);
        const grain = nz(su * 14, sv * 14, 3);
        const dark = 0.035 + 0.030 * grain;
        const c = dark * (0.55 + 0.6 * smoothstep(0.0, 0.5, crack));
        srgbMix(rgb, c * 1.15, c * 0.82, c * 0.62);
        h = smoothstep(0.0, 0.6, crack) * 0.7 + grain * 0.2;
        r = clamp(0.58 + 0.22 * (1 - crack) + grain * 0.1, 0.4, 0.92);
      } else {
        // Dunmer skin: ashen grey with a violet undertone, never pink.
        const pore = noise2Tiled(su * 130, sv * 130, NU * 130, NU * 130);
        const blotch = nz(su * 3.4, sv * 4.0, 4);
        const base = lerp(0.105, 0.150, blotch);
        srgbMix(rgb, base * 1.0, base * 0.90, base * 1.03);
        h = pore * 0.35 + blotch * 0.2;
        r = clamp(0.52 + 0.18 * pore + 0.1 * blotch, 0.35, 0.85);
      }

      height[i] = h;
      rough[i] = r;
      metal[i] = m;
      const o = i * 4;
      // Values are authored as linear reflectance; encode to sRGB bytes so the
      // sRGB-tagged texture decodes back to exactly these numbers.
      albedo[o] = encodeSrgb(rgb[0]);
      albedo[o + 1] = encodeSrgb(rgb[1]);
      albedo[o + 2] = encodeSrgb(rgb[2]);
      albedo[o + 3] = 255;
    }
  }

  // Sobel-derived tangent-space normals plus a cavity term for AO. Deriving AO
  // from the same height field is what keeps the weave and the plate seams
  // reading at distance once the normal map mips away.
  const strength = 2.6;
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1) + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = ((x - 1) + size) % size;
      const xp = (x + 1) % size;
      const i = y * size + x;

      const h00 = height[ym * size + xm];
      const h10 = height[ym * size + x];
      const h20 = height[ym * size + xp];
      const h01 = height[y * size + xm];
      const h11 = height[i];
      const h21 = height[y * size + xp];
      const h02 = height[yp * size + xm];
      const h12 = height[yp * size + x];
      const h22 = height[yp * size + xp];

      const gx = h00 + 2 * h01 + h02 - (h20 + 2 * h21 + h22);
      const gy = h00 + 2 * h10 + h20 - (h02 + 2 * h12 + h22);
      let nx = gx * strength;
      let ny = gy * strength;
      let nzc = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nzc * nzc);
      nx *= inv;
      ny *= inv;
      nzc *= inv;

      const avg = (h00 + h10 + h20 + h01 + h11 + h21 + h02 + h12 + h22) / 9;
      const ao = clamp(0.62 + (h11 - avg) * 3.4 + h11 * 0.28, 0.25, 1);

      const o = i * 4;
      normal[o] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[o + 2] = Math.round((nzc * 0.5 + 0.5) * 255);
      normal[o + 3] = 255;

      arm[o] = Math.round(ao * 255);
      arm[o + 1] = Math.round(rough[i] * 255);
      arm[o + 2] = Math.round(metal[i] * 255);
      arm[o + 3] = Math.round(clamp(h11, 0, 1) * 255);
    }
  }

  const mk = (data: Uint8Array, colorSpace: THREE.ColorSpace): THREE.DataTexture => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = colorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
    return t;
  };

  const texAlbedo = mk(albedo, THREE.SRGBColorSpace);
  const texNormal = mk(normal, THREE.NoColorSpace);
  const texArm = mk(arm, THREE.NoColorSpace);
  // Packed ARM is authored against uv0; three defaults aoMap to uv1.
  texArm.channel = 0;

  return {
    albedo: texAlbedo,
    normal: texNormal,
    arm: texArm,
    dispose() {
      texAlbedo.dispose();
      texNormal.dispose();
      texArm.dispose();
    },
  };
}

function encodeSrgb(linear: number): number {
  const c = clamp(linear, 0, 1);
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}
