/**
 * Cross-system API contracts. Each subsystem author implements exactly the
 * interface named here, under exactly the file path and export name given in
 * the comment. Nothing else may be assumed about another subsystem.
 */
import type * as THREE from 'three';
import type { PBRSet, System, TerrainQuery, WeatherState } from './types';

/** src/mat/Materials.ts — `export class MaterialSystem` — id 'materials' */
export interface IMaterials extends System {
  /**
   * Fetch a synthesized PBR set by name. Synchronous after init; throws on an
   * unknown name so typos fail loudly rather than rendering flat grey.
   * Names: ash, ash_coarse, volcanic_rock, basalt, sand, mud, lichen_grass,
   * lava_crust, snow, cut_stone, plaster, chitin, thatch, wood_weathered,
   * bark_fungal, cloth, iron, bronze, glass_volcanic, bone, pumice.
   */
  get(name: string): PBRSet;
  /** Anisotropic-filtered, repeat-wrapped clone at a given world-space tiling. */
  tiled(name: string, repeat: number): PBRSet;
  /** Shared environment map for IBL. Updated by the sky system each dusk/dawn. */
  readonly env: THREE.Texture | null;
}

/** src/world/Terrain.ts — `export class TerrainSystem` — id 'terrain' */
export interface ITerrain extends System, TerrainQuery {
  /** Raycast-ready collision proxy for physics/actors. */
  readonly collider: THREE.Object3D;
  /** True once heightfield data is resident and heightAt() is valid. */
  readonly ready: boolean;
}

/** src/sky/Atmosphere.ts — `export class AtmosphereSystem` — id 'sky' */
export interface IAtmosphere extends System {
  /** Current weather; also broadcast on the bus as 'weather' each time it changes. */
  readonly weather: WeatherState;
  /** Force a weather transition over `seconds`. Used by quests and debug UI. */
  setWeather(kind: WeatherState['kind'], seconds?: number): void;
  /** The directional light every shadow-casting system should read. */
  readonly sun: THREE.DirectionalLight;
}

/** src/render/Pipeline.ts — `export class RenderPipeline` — id 'render' */
export interface IPipeline extends System {
  /** Quality tier; UI settings menu drives this. */
  setQuality(tier: 'low' | 'medium' | 'high' | 'ultra'): void;
  /** Register an object that must render in the transparent/forward pass. */
  readonly composer: unknown;
}

/** src/player/Player.ts — `export class PlayerSystem` — id 'player' */
export interface IPlayer extends System {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly grounded: boolean;
  readonly view: 'first' | 'third';
  /** Noclip free camera. The screenshot harness sets this before framing a shot. */
  freefly: boolean;
  /** Place at (x,z), `height` metres above the terrain surface there. */
  teleport(x: number, z: number, height?: number): void;
  /** Absolute look angles in radians. Yaw 0 faces -Z; positive pitch looks up. */
  setLook(yaw: number, pitch: number): void;
  /** Additive camera shake, for impacts and spell effects. */
  shake(amplitude: number, seconds: number): void;
}

/**
 * Events on the bus. Payload types are the source of truth for publishers and
 * subscribers alike.
 */
export interface Events {
  weather: WeatherState;
  /** Emitted when the player's surface material changes — drives footstep audio. */
  'player:surface': { surface: number };
  'player:moved': { x: number; y: number; z: number };
  /** Emitted by any system that wants a transient message in the corner log. */
  notify: { text: string; kind?: 'info' | 'warn' | 'quest' };
}
