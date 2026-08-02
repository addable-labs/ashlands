/**
 * Named save slots in localStorage, each with a thumbnail lifted from the last
 * rendered frame.
 *
 * The thumbnail has to be grabbed inside the same animation frame as the render
 * — the drawing buffer is not preserved, so a copy taken a tick later is blank.
 * `Thumbnailer.capture` is therefore called from the UI system's `lateUpdate`,
 * which the engine runs after every system's `update`, including the pipeline's.
 */
import type { SaveBlob } from './state';

export interface SlotMeta {
  name: string;
  when: number;
  level: number;
  who: string;
  playtime: number;
  thumb: string;
}

export interface SlotRecord {
  meta: SlotMeta;
  blob: SaveBlob;
}

const PREFIX = 'ashlands.slot.';
export const SLOT_COUNT = 8;
export const QUICK_SLOT = 'quick';

export class SaveStore {
  ids(): string[] {
    const out: string[] = [QUICK_SLOT];
    for (let i = 1; i <= SLOT_COUNT; i++) out.push(String(i));
    return out;
  }

  read(id: string): SlotRecord | null {
    try {
      const raw = localStorage.getItem(PREFIX + id);
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as SlotRecord;
      return parsed.blob === undefined ? null : parsed;
    } catch {
      // A corrupt slot must not take the menu down with it.
      return null;
    }
  }

  write(id: string, meta: SlotMeta, blob: SaveBlob): boolean {
    try {
      localStorage.setItem(PREFIX + id, JSON.stringify({ meta, blob }));
      return true;
    } catch {
      return false;
    }
  }

  remove(id: string): void {
    try {
      localStorage.removeItem(PREFIX + id);
    } catch {
      /* nothing to do; the slot stays as it was */
    }
  }
}

export class Thumbnailer {
  private readonly canvas = document.createElement('canvas');
  private data = '';
  private cooldown = 0;

  constructor(w = 192, h = 108) {
    this.canvas.width = w;
    this.canvas.height = h;
  }

  get latest(): string {
    return this.data;
  }

  capture(source: HTMLCanvasElement, dt: number): void {
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.cooldown = 1.5;
    const ctx = this.canvas.getContext('2d');
    if (ctx === null || source.width === 0) return;
    try {
      ctx.drawImage(source, 0, 0, this.canvas.width, this.canvas.height);
      this.data = this.canvas.toDataURL('image/jpeg', 0.55);
    } catch {
      // Tainted or lost context — a missing thumbnail is not worth an exception.
      this.data = '';
    }
  }
}
