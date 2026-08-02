import { Engine } from './core/Engine';
import { MaterialSystem } from './mat/Materials';
import { AtmosphereSystem } from './sky/Atmosphere';
import { TerrainSystem } from './world/Terrain';
import { WaterSystem } from './water/Water';
import { PlayerSystem } from './player/Player';
import { ArchitectureSystem } from './arch/Architecture';
import { VFXSystem } from './vfx/VFX';
import { ActorSystem } from './actors/Actors';
import { FloraSystem } from './flora/Flora';
import { RPGSystem } from './rpg/RPG';
import { CombatSystem } from './combat/Combat';
import { QuestSystem } from './quest/Quests';
import { RenderPipeline } from './render/Pipeline';
import { UISystem } from './ui/UI';
import { AudioSystem } from './audio/Audio';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const boot = document.getElementById('boot')!;
const bar = document.querySelector<HTMLElement>('#bar > i')!;
const blabel = document.getElementById('blabel')!;

const LABELS: Record<string, string> = {
  materials: 'Synthesising materials',
  sky: 'Kindling the sun',
  terrain: 'Raising the ashlands',
  water: 'Flooding the inner sea',
  flora: 'Seeding the ashlands',
  arch: 'Raising the Velothi',
  vfx: 'Binding the elements',
  actors: 'Breathing life into the ash',
  rpg: 'Casting the birthsigns',
  combat: 'Whetting the blades',
  quest: 'Opening the journal',
  player: 'Waking the prisoner',
  render: 'Focusing the lens',
  ui: 'Cutting the bone and the vellum',
  audio: 'Listening to the ash',
  ready: 'Ready',
};

async function boot_() {
  const engine = new Engine(canvas);

  engine.add(
    new MaterialSystem(),
    new AtmosphereSystem(),
    new TerrainSystem(),
    new WaterSystem(),
    new FloraSystem(),
    new ArchitectureSystem(),
    new VFXSystem(),
    new ActorSystem(),
    new RPGSystem(),
    new CombatSystem(),
    new QuestSystem(),
    new PlayerSystem(),
    new AudioSystem(),
    new UISystem(),
    new RenderPipeline(),
  );

  await engine.init((id, pct) => {
    bar.style.width = `${Math.round(pct * 100)}%`;
    blabel.textContent = LABELS[id] ?? id;
  });

  bar.style.width = '100%';
  // One frame before the curtain lifts, so the first thing shown is not black.
  engine.start();
  await new Promise((r) => setTimeout(r, 350));
  boot.classList.add('done');

  Object.assign(globalThis as any, { engine });
}

boot_().catch((e) => {
  console.error(e);
  blabel.textContent = String(e?.message ?? e);
  blabel.style.color = '#a44';
});
