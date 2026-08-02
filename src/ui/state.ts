/**
 * What the interface actually owns.
 *
 * This module used to hold a whole character — attributes, skills, a pack, a
 * spellbook, a journal — because nothing else in the engine did yet. Something
 * else does now: `src/rpg` owns the character and `src/quest` owns the world's
 * memory. Keeping a second copy here did not make the screens independent, it
 * made them wrong: the inventory listed a sample kit while the character
 * carried an iron longsword, and equipping in the UI equipped nothing.
 *
 * So this is all that is left, and it is all that belongs to a user interface:
 * the surveyed map, the notes the player pinned to it, and how long they have
 * been playing. Everything else is read live through `GameLink` — see live.ts.
 */
import { clamp } from './dom';

export const FOG_RES = 128;

export interface MapNote {
  x: number;
  z: number;
  text: string;
}

export interface Settings {
  quality: 'low' | 'medium' | 'high' | 'ultra';
  sensitivity: number;
  fov: number;
  master: number;
  music: number;
  effects: number;
  crosshair: boolean;
  subtitles: boolean;
  showHud: boolean;
  invertY: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'high',
  sensitivity: 1,
  fov: 65,
  master: 0.8,
  music: 0.55,
  effects: 0.85,
  crosshair: true,
  subtitles: true,
  showHud: true,
  invertY: false,
};

export interface SaveBlob {
  v: 1;
  notes: MapNote[];
  /** The fog mask, base64'd rather than expanded into a 16k-element array. */
  fog: string;
  day: number;
  hour: number;
  playtime: number;
  /**
   * Whatever the game's own systems serialised in response to `save:collect`,
   * keyed by system id. The interface carries this without reading it — the
   * character belongs to whoever answered, not to this file.
   */
  systems?: Record<string, unknown>;
  /**
   * Where the player was standing, and which way they faced. Optional because
   * saves written before this existed do not carry it — those load in place,
   * which is the old behaviour rather than a crash.
   */
  px?: number;
  pz?: number;
  pyaw?: number;
}

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(str: string, out: Uint8Array): void {
  const s = atob(str);
  const n = Math.min(s.length, out.length);
  for (let i = 0; i < n; i++) out[i] = s.charCodeAt(i);
}

export class GameState {
  readonly notes: MapNote[] = [];
  readonly fog = new Uint8Array(FOG_RES * FOG_RES);
  playtime = 0;

  /** A new life starts with an unsurveyed island and an empty margin. */
  resetSurvey(): void {
    this.fog.fill(0);
    this.notes.length = 0;
    this.playtime = 0;
  }

  // ---------------------------------------------------------- fog of war

  /** Marks the disc around a world position as explored. Extent is half-width. */
  reveal(x: number, z: number, extent: number, radiusM: number): boolean {
    const cell = (2 * extent) / FOG_RES;
    const cx = (x + extent) / cell;
    const cz = (z + extent) / cell;
    const r = Math.max(1, radiusM / cell);
    let changed = false;
    const i0 = Math.max(0, Math.floor(cz - r));
    const i1 = Math.min(FOG_RES - 1, Math.ceil(cz + r));
    const j0 = Math.max(0, Math.floor(cx - r));
    const j1 = Math.min(FOG_RES - 1, Math.ceil(cx + r));
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const d = Math.hypot(j + 0.5 - cx, i + 0.5 - cz);
        if (d > r) continue;
        // Soft edge: the mask stores how well the ground is known, so the map
        // fades out at the limit of sight rather than ending in a hard circle.
        const v = Math.round(255 * clamp(1.15 - d / r, 0, 1));
        const k = i * FOG_RES + j;
        if (v > this.fog[k]) {
          this.fog[k] = v;
          changed = true;
        }
      }
    }
    return changed;
  }

  get explored(): number {
    let n = 0;
    for (let i = 0; i < this.fog.length; i++) if (this.fog[i] > 24) n++;
    return n / this.fog.length;
  }

  // ------------------------------------------------------- serialisation

  /**
   * `where` is passed in rather than read, so this file keeps knowing nothing
   * about the engine. Omitting it writes a save that loads in place.
   */
  toJSON(clock: { day: number; hour: number }, where?: { x: number; z: number; yaw: number }): SaveBlob {
    return {
      v: 1,
      px: where?.x,
      pz: where?.z,
      pyaw: where?.yaw,
      notes: this.notes.map((n) => ({ ...n })),
      fog: b64encode(this.fog),
      day: clock.day,
      hour: clock.hour,
      playtime: this.playtime,
    };
  }

  fromJSON(b: SaveBlob): void {
    this.notes.length = 0;
    for (const n of b.notes ?? []) this.notes.push({ ...n });
    this.fog.fill(0);
    if (typeof b.fog === 'string') b64decode(b.fog, this.fog);
    this.playtime = b.playtime ?? 0;
  }
}
