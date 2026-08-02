/**
 * Development-only inspection harness for the material library.
 *
 * Not imported by the game. Served at /src/mat/__lab.html by the dev server so
 * a QA script can synthesize every set headlessly and read the rendered maps
 * back as pixels — the only way to check the spectral bar in Library.ts's header
 * without eyeballing a 1080p frame and guessing which system authored the
 * artifact.
 */
import * as THREE from 'three';
import { MATERIAL_DEFS } from './Library';
import { Synthesizer } from './Synth';

declare global {
  interface Window {
    matlab?: {
      names: string[];
      dump(name: string, which: 'albedo' | 'normal' | 'arm', level?: number): string;
      size: number;
    };
  }
}

const SIZE = 512;

async function main(): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });

  const synth = new Synthesizer(renderer, SIZE, 1);
  const sets = new Map<string, THREE.Texture[]>();
  for (const def of MATERIAL_DEFS) {
    const s = synth.run(def);
    sets.set(def.name, [s.albedo, s.normal, s.arm]);
  }

  // Readback path: blit the finished texture into an RGBA8 target and read it.
  const quad = new THREE.BufferGeometry();
  quad.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  quad.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const blit = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy,0.,1.); }',
    fragmentShader:
      'uniform sampler2D uMap; uniform float uLod; varying vec2 vU;' +
      'void main(){ gl_FragColor = textureLod(uMap, vU, uLod); }',
    uniforms: { uMap: { value: null }, uLod: { value: 0 } },
    depthTest: false,
    depthWrite: false,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(quad, blit));
  const cam = new THREE.Camera();
  // One target per colour space. Reassigning `colorSpace` on a target that the
  // GPU has already allocated does NOT reallocate it, so a single shared target
  // would silently keep whichever internal format it was first bound with and
  // sRGB-encode every subsequent raw readback.
  const makeRT = (cs: THREE.ColorSpace): THREE.WebGLRenderTarget => {
    const t = new THREE.WebGLRenderTarget(SIZE, SIZE, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      colorSpace: cs,
    });
    return t;
  };
  const rtSrgb = makeRT(THREE.SRGBColorSpace);
  const rtLin = makeRT(THREE.NoColorSpace);

  window.matlab = {
    size: SIZE,
    names: MATERIAL_DEFS.map((d) => d.name),
    dump(name, which, level = 0): string {
      const s = sets.get(name);
      if (s === undefined) return '';
      const tex = s[which === 'albedo' ? 0 : which === 'normal' ? 1 : 2];
      const rt = tex.colorSpace === THREE.SRGBColorSpace ? rtSrgb : rtLin;
      blit.uniforms.uMap.value = tex;
      blit.uniforms.uLod.value = level;
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      renderer.setRenderTarget(null);
      const buf = new Uint8Array(SIZE * SIZE * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, SIZE, SIZE, buf);
      const c = document.createElement('canvas');
      c.width = c.height = SIZE;
      const g = c.getContext('2d');
      if (g === null) return '';
      const img = g.createImageData(SIZE, SIZE);
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const si = ((SIZE - 1 - y) * SIZE + x) * 4;
          const di = (y * SIZE + x) * 4;
          img.data[di] = buf[si];
          img.data[di + 1] = buf[si + 1];
          img.data[di + 2] = buf[si + 2];
          img.data[di + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    },
  };
}

void main();
