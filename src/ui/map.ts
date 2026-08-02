/**
 * The map is not a minimap: it is a survey of the island drawn on paper, and
 * you only have the parts of it you have walked.
 *
 * The heightfield is baked once into a parchment plate — hill shading from the
 * analytic gradient, contour lines every 25 metres, an ink wash for the Inner
 * Sea — and the fog mask is composited over it each time it changes. Baking is
 * ~260k heightAt calls, which is why it happens once, off the first open,
 * rather than per frame.
 */
import { PARCHMENT_RAMP } from './theme';
import { Win, column } from './kit';
import { clamp, div, el, hash01 } from './dom';
import { FOG_RES, type GameState } from './state';

const BAKE = 512;
/** Metres between contour lines. */
const CONTOUR = 25;

interface TerrainLike {
  heightAt(x: number, z: number): number;
  readonly extent: number;
  readonly ready: boolean;
}

export class MapView {
  readonly root = div('ash-map');
  private readonly plate = document.createElement('canvas');
  private readonly masked = document.createElement('canvas');
  private readonly fogTex = document.createElement('canvas');
  private readonly view = document.createElement('canvas');
  private readonly you = div('you');
  private readonly noteLayer = div();
  private baked = false;
  private fogDirty = true;
  private extent = 4096;
  /** Highest point found during the bake — the landmark every note is placed against. */
  peak: { x: number; z: number; h: number } = { x: 0, z: 0, h: 0 };

  constructor(private readonly st: GameState, private readonly onPlace: (x: number, z: number) => void) {
    this.plate.width = this.plate.height = BAKE;
    this.masked.width = this.masked.height = BAKE;
    this.fogTex.width = this.fogTex.height = FOG_RES;
    this.view.width = this.view.height = BAKE;
    this.noteLayer.style.position = 'absolute';
    this.noteLayer.style.inset = '0';
    this.noteLayer.style.pointerEvents = 'none';
    this.root.appendChild(this.view);
    this.root.appendChild(this.noteLayer);
    this.root.appendChild(this.you);
    this.root.addEventListener('click', (e) => {
      const r = this.root.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width;
      const v = (e.clientY - r.top) / r.height;
      this.onPlace((u * 2 - 1) * this.extent, (v * 2 - 1) * this.extent);
    });
  }

  get ready(): boolean {
    return this.baked;
  }

  markFogDirty(): void {
    this.fogDirty = true;
  }

  /** Returns false if the terrain is not resident yet, so the caller can retry. */
  bake(terrain: TerrainLike | null): boolean {
    if (this.baked) return true;
    if (terrain === null || !terrain.ready) return false;
    this.extent = terrain.extent;
    const ctx = this.plate.getContext('2d');
    if (ctx === null) return false;

    const step = (2 * this.extent) / BAKE;
    const h = new Float32Array(BAKE * BAKE);
    let maxH = -Infinity;
    for (let j = 0; j < BAKE; j++) {
      const z = -this.extent + (j + 0.5) * step;
      for (let i = 0; i < BAKE; i++) {
        const x = -this.extent + (i + 0.5) * step;
        const v = terrain.heightAt(x, z);
        h[j * BAKE + i] = v;
        if (v > maxH) {
          maxH = v;
          this.peak = { x, z, h: v };
        }
      }
    }

    const img = ctx.createImageData(BAKE, BAKE);
    const d = img.data;
    // The sun is fixed north-west on a chart; a survey is not lit by the real sun.
    const lx = -0.62;
    const lz = -0.62;
    const ly = 0.48;
    for (let j = 0; j < BAKE; j++) {
      for (let i = 0; i < BAKE; i++) {
        const k = j * BAKE + i;
        const hc = h[k];
        const hl = h[j * BAKE + Math.max(0, i - 1)];
        const hr = h[j * BAKE + Math.min(BAKE - 1, i + 1)];
        const hu = h[Math.max(0, j - 1) * BAKE + i];
        const hd = h[Math.min(BAKE - 1, j + 1) * BAKE + i];
        const nx = (hl - hr) / (2 * step);
        const nz = (hu - hd) / (2 * step);
        const inv = 1 / Math.hypot(nx, 1, nz);
        const shade = clamp((nx * lx + ly + nz * lz) * inv * 1.25, 0.18, 1.5);

        let r: number;
        let g: number;
        let b: number;
        if (hc < 0) {
          // Sea: an ink wash that deepens offshore, with a hatched shallow band.
          const deep = clamp(-hc / 90, 0, 1);
          const hatch = hc > -14 && ((i + j) & 7) === 0 ? 22 : 0;
          r = 118 - deep * 46 + hatch;
          g = 128 - deep * 44 + hatch;
          b = 122 - deep * 30 + hatch;
        } else {
          const t = clamp(hc / Math.max(60, maxH * 0.92), 0, 0.999) * (PARCHMENT_RAMP.length - 2) + 1;
          const i0 = Math.floor(t);
          const f = t - i0;
          const c0 = PARCHMENT_RAMP[i0];
          const c1 = PARCHMENT_RAMP[Math.min(PARCHMENT_RAMP.length - 1, i0 + 1)];
          r = (c0[0] + (c1[0] - c0[0]) * f) * shade;
          g = (c0[1] + (c1[1] - c0[1]) * f) * shade;
          b = (c0[2] + (c1[2] - c0[2]) * f) * shade;
          // Contours: darken where the surface crosses a multiple of CONTOUR.
          const band = Math.abs((hc % CONTOUR) - CONTOUR * 0.5);
          const slope = Math.hypot(nx, nz);
          if (band > CONTOUR * 0.5 - 0.9 * Math.max(0.4, slope * 8)) {
            r *= 0.86;
            g *= 0.84;
            b *= 0.8;
          }
        }
        // Paper grain, so the plate is never flat colour.
        const grain = (hash01(k * 0.37) - 0.5) * 13;
        const o = k * 4;
        d[o] = clamp(r + grain, 0, 255);
        d[o + 1] = clamp(g + grain, 0, 255);
        d[o + 2] = clamp(b + grain, 0, 255);
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // The cartographer's flourish: a compass rose, and a scale bar in leagues.
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#42301a';
    ctx.fillStyle = '#42301a';
    ctx.lineWidth = 1.4;
    const cx = BAKE - 62;
    const cy = 62;
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.stroke();
    for (let a = 0; a < 8; a++) {
      const ang = (a * Math.PI) / 4;
      const long = a % 2 === 0;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(ang) * (long ? 32 : 18), cy - Math.cos(ang) * (long ? 32 : 18));
      ctx.stroke();
    }
    ctx.font = '13px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, cy - 36);
    ctx.restore();

    this.baked = true;
    this.fogDirty = true;
    return true;
  }

  /** Recomposites the plate through the explored mask. */
  private composite(): void {
    const fctx = this.fogTex.getContext('2d');
    const mctx = this.masked.getContext('2d');
    const vctx = this.view.getContext('2d');
    if (fctx === null || mctx === null || vctx === null) return;

    const img = fctx.createImageData(FOG_RES, FOG_RES);
    for (let i = 0; i < this.st.fog.length; i++) {
      const o = i * 4;
      img.data[o] = 255;
      img.data[o + 1] = 255;
      img.data[o + 2] = 255;
      img.data[o + 3] = this.st.fog[i];
    }
    fctx.putImageData(img, 0, 0);

    mctx.clearRect(0, 0, BAKE, BAKE);
    mctx.drawImage(this.plate, 0, 0);
    mctx.globalCompositeOperation = 'destination-in';
    mctx.imageSmoothingEnabled = true;
    mctx.imageSmoothingQuality = 'high';
    mctx.drawImage(this.fogTex, 0, 0, BAKE, BAKE);
    mctx.globalCompositeOperation = 'source-over';

    // Unexplored ground is blank aged paper, not black — a chart you have not
    // filled in, rather than a screen someone forgot to draw.
    vctx.fillStyle = '#b8a27a';
    vctx.fillRect(0, 0, BAKE, BAKE);
    vctx.save();
    vctx.globalAlpha = 0.5;
    for (let i = 0; i < 900; i++) {
      const x = hash01(i * 3.1) * BAKE;
      const y = hash01(i * 7.7 + 5) * BAKE;
      vctx.fillStyle = hash01(i * 11.3) > 0.5 ? '#a89066' : '#c6b088';
      vctx.fillRect(x, y, 2 + hash01(i) * 5, 1 + hash01(i * 2) * 3);
    }
    vctx.restore();
    vctx.drawImage(this.masked, 0, 0);

    // A soft burn round the edge of the sheet.
    const g = vctx.createRadialGradient(BAKE / 2, BAKE / 2, BAKE * 0.32, BAKE / 2, BAKE / 2, BAKE * 0.72);
    g.addColorStop(0, 'rgba(60,40,16,0)');
    g.addColorStop(1, 'rgba(48,30,10,0.55)');
    vctx.fillStyle = g;
    vctx.fillRect(0, 0, BAKE, BAKE);

    this.fogDirty = false;
  }

  refresh(px: number, pz: number, yaw: number): void {
    if (!this.baked) return;
    if (this.fogDirty) this.composite();
    const u = (px / this.extent) * 0.5 + 0.5;
    const v = (pz / this.extent) * 0.5 + 0.5;
    this.you.style.left = `${(u * 100).toFixed(2)}%`;
    this.you.style.top = `${(v * 100).toFixed(2)}%`;
    this.you.style.transform = `rotate(${(yaw * 180) / Math.PI + 180}deg)`;
    this.syncNotes();
  }

  private syncNotes(): void {
    const n = this.st.notes.length;
    while (this.noteLayer.childElementCount > n) this.noteLayer.lastElementChild?.remove();
    while (this.noteLayer.childElementCount < n) {
      const el = div('ash-note');
      el.style.pointerEvents = 'auto';
      this.noteLayer.appendChild(el);
    }
    const kids = this.noteLayer.children;
    for (let i = 0; i < n; i++) {
      const note = this.st.notes[i];
      const e = kids[i] as HTMLElement;
      e.textContent = note.text;
      e.style.left = `${((note.x / this.extent) * 0.5 + 0.5) * 100}%`;
      e.style.top = `${((note.z / this.extent) * 0.5 + 0.5) * 100}%`;
      e.onclick = (ev): void => {
        ev.stopPropagation();
        this.st.notes.splice(i, 1);
        this.syncNotes();
      };
      e.title = 'Click to remove this note';
    }
  }
}

/** The map window: the survey, a legend, and the note the player is writing. */
export class MapPanel {
  readonly id = 'map';
  readonly root: HTMLElement;
  private readonly win: Win;
  private readonly view: MapView;
  private readonly noteInput: HTMLInputElement;
  private pending: { x: number; z: number } | null = null;
  private terrain: TerrainLike | null = null;

  constructor(private readonly st: GameState, private readonly notify: (t: string) => void) {
    this.win = new Win({
      title: 'The Island',
      rect: { left: '50%', top: '5vh', width: 'min(86vh, 78vw)', height: '86vh' },
    });
    this.win.root.style.transform = 'translateX(-50%)';
    this.root = this.win.root;

    this.view = new MapView(st, (x, z) => {
      this.pending = { x, z };
      this.noteInput.placeholder = `Mark at ${Math.round(x)}, ${Math.round(z)} — name it`;
      this.noteInput.focus();
    });

    const col = column();
    col.style.flex = '1';
    col.appendChild(this.view.root);
    this.noteInput = el('input', 'ash-input');
    this.noteInput.placeholder = 'Click the map to place a note';
    this.noteInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Enter' || this.pending === null) return;
      const text = this.noteInput.value.trim();
      if (text === '') return;
      this.st.notes.push({ x: this.pending.x, z: this.pending.z, text });
      this.notify(`Marked: ${text}`);
      this.noteInput.value = '';
      this.pending = null;
      this.refresh();
    });
    const row = div('ash-field');
    row.style.marginTop = '8px';
    row.appendChild(this.noteInput);
    col.appendChild(row);
    this.win.body.appendChild(col);
  }

  setTerrain(t: TerrainLike | null): void {
    this.terrain = t;
  }

  open(): void {
    if (!this.view.bake(this.terrain)) this.notify('The land is still settling; the survey is not ready.');
    this.view.markFogDirty();
    this.refresh();
  }

  close(): void {
    /* nothing to tear down */
  }

  markFogDirty(): void {
    this.view.markFogDirty();
  }

  /** Written every frame by the UI system so the marker tracks without a redraw. */
  player = { x: 0, z: 0, yaw: 0 };

  tick(): void {
    this.refresh();
  }

  private refresh(): void {
    this.win.sub = `${Math.round(this.st.explored * 100)}% surveyed`;
    this.view.refresh(this.player.x, this.player.z, this.player.yaw);
  }
}
