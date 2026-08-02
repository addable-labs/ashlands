/**
 * ASHLANDS — user interface.
 *
 * The whole interface is DOM over the canvas. Browser text is subpixel-sharp at
 * any device pixel ratio, reflows for free and is keyboard-navigable by
 * construction; canvas-drawn glyphs would look like the 2002 original, which is
 * the one thing we are not trying to reproduce.
 *
 * This system owns no character. It used to, and every screen rendered that
 * copy instead of the game — an inventory full of items the character was not
 * carrying, an equip button that equipped nothing. The character belongs to
 * `rpg` and the world's memory to `quest`; panels reach them through `GameLink`
 * (live.ts) and nowhere else. What is left in `GameState` is the surveyed map,
 * the player's own notes and the playtime — see state.ts.
 *
 * Input discipline, which matters more than it looks:
 *   - The engine's input layer listens on `window` in the bubble phase. This
 *     system listens on `document`, also bubbling, so a key reaches the focused
 *     text field first and is then stopped before the engine records it. That
 *     is what lets you type a spell name without walking into the sea.
 *   - Opening a menu dispatches a `blur` event, which is the engine's own
 *     documented path for releasing stranded held keys.
 *   - Pointer lock is released on the first modal and re-requested when the
 *     last one closes.
 */
import * as THREE from 'three';
import type { IPipeline, IPlayer, ITerrain } from '../core/contracts';
import type { Ctx, System } from '../core/types';
import { CSS } from './theme';
import { div, el } from './dom';
import type { Panel } from './kit';
import { GameState, DEFAULT_SETTINGS, type Settings } from './state';
import { Hud } from './hud';
import { InventoryPanel } from './inventory';
import { CharacterPanel, LevelUpPanel } from './character';
import { MagicPanel } from './magic';
import { JournalPanel, BookPanel } from './journal';
import { MapPanel } from './map';
import { DialoguePanel } from './dialogue';
import { CreationPanel } from './creation';
import { PausePanel, SaveLoadPanel, SettingsPanel, TitlePanel, type MenuHooks } from './menus';
import { QUICK_SLOT, SaveStore, Thumbnailer } from './save';
import { GameLink } from './live';

/**
 * The parts of the player system this interface drives. Declared structurally
 * rather than imported, because systems must not import one another; the
 * contract's `IPlayer` covers the rest.
 */
interface PlayerLike extends IPlayer {
  sensitivity: number;
  /** Base FOV. The camera rig rewrites camera.fov each frame from this. */
  fov: number;
  levitate: boolean;
  waterWalk: boolean;
  readonly yaw: number;
  readonly swimming: boolean;
}

interface ActorLike {
  id: number;
  kind: string;
  position: THREE.Vector3;
  faction: string;
  alive: boolean;
  health: number;
  maxHealth: number;
}

interface ActorsLike extends System {
  all(): readonly ActorLike[];
}

/** The subset of the RPG system's published snapshot the HUD mirrors. */
interface RpgStats {
  health: number;
  maxHealth: number;
  magicka: number;
  maxMagicka: number;
  fatigue: number;
  maxFatigue: number;
}

const SETTINGS_KEY = 'ashlands.settings';

/** How far the player can see well enough for it to go on the chart. */
const SURVEY_RADIUS = 190;

/**
 * How long after an NPC has greeted you that pressing E still means "talk to
 * them". The quest system greets whoever is within a few metres and is the only
 * thing that knows which body belongs to which named person, so this is how the
 * interface learns who is standing in front of the player. Matched to that
 * system's own greet cooldown so the window never outlives the greeting.
 */
const GREETING_WINDOW = 25;

export class UISystem implements System {
  readonly id = 'ui';
  readonly order = 200;

  private readonly root = div();
  private readonly scrim = div('ash-scrim');
  /**
   * The live game. Every panel reads the character, the pack and the journal
   * through this — the interface keeps no model of its own, which is the whole
   * point of the module.
   */
  private readonly link = new GameLink();
  /**
   * What is genuinely the interface's own: the surveyed map, the notes the
   * player pinned to it, and how long they have been playing. Nothing about the
   * character lives here.
   */
  private readonly state = new GameState();
  private readonly store = new SaveStore();
  private readonly thumbs = new Thumbnailer();
  private settings: Settings = { ...DEFAULT_SETTINGS };

  private hud!: Hud;
  private inventory!: InventoryPanel;
  private character!: CharacterPanel;
  private levelUp!: LevelUpPanel;
  private magic!: MagicPanel;
  private journal!: JournalPanel;
  private book!: BookPanel;
  private map!: MapPanel;
  private dialogue!: DialoguePanel;
  private creation!: CreationPanel;
  private title!: TitlePanel;
  private pause!: PausePanel;
  private settingsPanel!: SettingsPanel;
  private saves!: SaveLoadPanel;

  private stack: Panel[] = [];
  private ctx: Ctx | null = null;
  private player: PlayerLike | null = null;
  private actors: ActorsLike | null = null;
  private terrain: ITerrain | null = null;
  private applied = false;
  private surveyTimer = 0;
  private hoverActor: ActorLike | null = null;
  private hoverTimer = 0;
  /** Who last greeted the player, and when — see GREETING_WINDOW. */
  private lastGreeter: string | null = null;
  private lastGreetAt = -1e9;
  private elapsed = 0;
  /** Set when the RPG system says a level is owed, cleared once the rite is shown. */
  private levelOwed = false;
  private lastPos = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly toActor = new THREE.Vector3();
  private offs: (() => void)[] = [];
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private onWheel: ((e: WheelEvent) => void) | null = null;

  // ------------------------------------------------------------------ init

  init(ctx: Ctx): void {
    this.ctx = ctx;
    this.loadSettings();
    // Bind to the live systems before a panel is built, so the first refresh
    // already reads the real character rather than an empty one.
    this.link.resolve(ctx);

    this.root.id = 'ash-ui';
    const style = el('style');
    style.textContent = CSS;
    this.root.appendChild(style);

    this.hud = new Hud(this.link, this.state.notes);
    this.root.appendChild(this.hud.root);
    this.scrim.style.display = 'none';
    this.scrim.addEventListener('click', () => this.popPanel());
    this.root.appendChild(this.scrim);

    const notify = (t: string, k?: 'info' | 'warn' | 'quest'): void => this.hud.notify(t, k);

    this.inventory = new InventoryPanel(this.link, notify, (_id, title, text) => {
      this.book.show(title, text);
      this.pushPanel(this.book);
    });
    this.character = new CharacterPanel(this.link);
    this.levelUp = new LevelUpPanel(this.link, () => {
      this.hud.notify('You feel the change settle in your bones.', 'quest');
      this.popPanel();
    });
    this.magic = new MagicPanel(this.link, notify);
    this.journal = new JournalPanel(this.link);
    this.book = new BookPanel(() => this.popPanel());
    this.map = new MapPanel(this.state, (t) => notify(t, 'quest'));
    this.dialogue = new DialoguePanel(this.link, notify, (line) => {
      if (this.settings.subtitles) this.hud.say(line);
    });
    this.creation = new CreationPanel(this.link, this.state, () => {
      this.closeAll();
      this.hud.notify('Stand up. There is work to be done.', 'quest');
    });

    const hooks: MenuHooks = {
      newGame: () => {
        this.closeAll();
        this.pushPanel(this.creation);
      },
      resume: () => this.closeAll(),
      openSettings: () => this.pushPanel(this.settingsPanel),
      openSaves: (mode) => {
        this.saves.setMode(mode);
        this.pushPanel(this.saves);
      },
      toTitle: () => {
        this.closeAll();
        this.pushPanel(this.title);
      },
    };
    this.title = new TitlePanel(hooks, this.store);
    this.pause = new PausePanel(hooks, this.link);
    this.settingsPanel = new SettingsPanel(this.settings, {
      quality: (t) => ctx.get<IPipeline>('render')?.setQuality(t),
      fov: (v) => {
        // Must go through the player rig: it rewrites camera.fov from its own
        // base every frame, so assigning camera.fov here is overwritten on the
        // next tick and the slider appears to do nothing.
        const p = this.player;
        if (p !== null) p.fov = v;
        else { ctx.camera.fov = v; ctx.camera.updateProjectionMatrix(); }
      },
      sensitivity: (v) => {
        const p = this.player;
        if (p !== null) p.sensitivity = 0.0022 * v;
      },
      audio: (kind, v) => ctx.bus.emit('audio:volume', { kind, value: v }),
      hud: (v) => this.hud.setVisible(v),
      persist: () => this.saveSettings(),
    });
    this.saves = new SaveLoadPanel(
      this.store,
      {
        save: (slot, name) => this.writeSave(slot, name),
        load: (slot) => this.readSave(slot),
        close: () => this.popPanel(),
      },
      this.link,
      this.state,
    );

    for (const p of this.panels()) {
      p.root.style.display = 'none';
      this.root.appendChild(p.root);
    }
    document.body.appendChild(this.root);

    this.onKeyDown = (e) => this.handleKey(e);
    // Bubble phase on `document`: after the focused field has had the key, and
    // before the engine's window-level listener records it.
    document.addEventListener('keydown', this.onKeyDown);
    this.onWheel = (e) => {
      if (this.stack.length > 0) e.stopPropagation();
    };
    document.addEventListener('wheel', this.onWheel, { passive: true });

    this.offs.push(
      ctx.bus.on<{ text: string; kind?: 'info' | 'warn' | 'quest' }>('notify', (p) => {
        this.hud.notify(p.text, p.kind);
      }),
    );
    // The character's vitals, four times a second, straight from the system
    // that owns them. This is the only source the vessels have.
    this.offs.push(
      ctx.bus.on<RpgStats>('rpg:stats', (s) => {
        this.hud.vitals = {
          hp: s.health,
          maxHp: s.maxHealth,
          mp: s.magicka,
          maxMp: s.maxMagicka,
          fp: s.fatigue,
          maxFp: s.maxFatigue,
        };
      }),
    );
    this.offs.push(
      ctx.bus.on<{ text: string; kind?: 'info' | 'warn' | 'quest' }>('ui:message', (p) => {
        this.hud.notify(p.text, p.kind);
      }),
    );

    // The quest system publishes the journal one entry at a time and never
    // revises it. The panel re-reads `quest.journal()`; this only says so.
    this.offs.push(
      ctx.bus.on<{ title: string }>('quest:journal', (p) => {
        this.journal.refresh();
        this.hud.notify(`Journal: ${p.title}`, 'quest');
      }),
    );
    this.offs.push(
      ctx.bus.on<{ label: string }>('quest:topic', (p) => {
        this.hud.notify(`New topic: ${p.label}`, 'quest');
      }),
    );
    // Who is standing in front of the player. The quest system owns the mapping
    // from actor bodies to named people, so this is the interface's only honest
    // way to know whom the talk key should open a conversation with.
    this.offs.push(
      ctx.bus.on<{ npc: string; name: string; text: string }>('quest:greeting', (p) => {
        this.lastGreeter = p.npc;
        this.lastGreetAt = this.elapsed;
        if (this.settings.subtitles) this.hud.say(p.text);
      }),
    );
    this.offs.push(
      ctx.bus.on<{ level: number }>('rpg:levelup:ready', () => {
        this.levelOwed = true;
      }),
    );
    // The documented way for the world to put a real item in the player's pack.
    this.offs.push(
      ctx.bus.on<{ def: string; count?: number }>('ui:give', (p) => {
        const v = this.link.give(p.def, p.count ?? 1);
        if (v === null) this.hud.notify('Nothing of that name exists.', 'warn');
        else this.hud.notify(`${v.name} taken.`);
      }),
    );

    // Puppeteer drives the screenshot harness; dropping it at a title screen
    // would make every visual-QA capture a picture of a menu.
    if (!navigator.webdriver) this.pushPanel(this.title);
  }

  private panels(): Panel[] {
    return [
      this.inventory,
      this.character,
      this.levelUp,
      this.magic,
      this.journal,
      this.book,
      this.map,
      this.dialogue,
      this.creation,
      this.title,
      this.pause,
      this.settingsPanel,
      this.saves,
    ];
  }

  // ----------------------------------------------------------------- stack

  private get top(): Panel | null {
    return this.stack.length === 0 ? null : this.stack[this.stack.length - 1];
  }

  private pushPanel(p: Panel): void {
    if (this.stack.includes(p)) return;
    if (this.stack.length === 0) this.onFirstOpen();
    this.stack.push(p);
    p.root.style.display = '';
    p.open();
    this.syncScrim();
  }

  private popPanel(): void {
    const p = this.stack.pop();
    if (p === undefined) return;
    p.close();
    p.root.style.display = 'none';
    if (this.stack.length === 0) this.onLastClose();
    this.syncScrim();
  }

  private closeAll(): void {
    const had = this.stack.length > 0;
    while (this.stack.length > 0) {
      const p = this.stack.pop();
      p?.close();
      if (p !== undefined) p.root.style.display = 'none';
    }
    // Only re-grab the pointer if something was actually open; closing an
    // already-empty stack must not fire a lock request out of nowhere.
    if (had) this.onLastClose();
    this.syncScrim();
  }

  private syncScrim(): void {
    const open = this.stack.length > 0;
    this.scrim.style.display = open ? '' : 'none';
    // The scrim sits under the topmost window and over everything else.
    if (open) {
      const t = this.top;
      if (t !== null) this.root.appendChild(t.root);
      this.root.insertBefore(this.scrim, this.stack[this.stack.length - 1].root);
    }
    this.hud.setVisible(!open && this.settings.showHud);
  }

  private onFirstOpen(): void {
    document.exitPointerLock();
    // The engine's own recovery path for keys held when focus is taken away.
    dispatchEvent(new Event('blur'));
  }

  private onLastClose(): void {
    const canvas = this.ctx?.renderer.domElement;
    if (canvas === undefined) return;
    // Chrome wants a user gesture; every close path is one, but a rejected
    // request must not become an unhandled rejection.
    void Promise.resolve(canvas.requestPointerLock()).catch(() => undefined);
  }

  // ----------------------------------------------------------------- input

  private handleKey(e: KeyboardEvent): void {
    if (e.repeat) return;
    const target = e.target;
    const typing =
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;

    if (this.stack.length > 0) {
      // The world must not see a single keystroke while a window is open.
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.popPanel();
        return;
      }
      if (typing) return;
      if (this.top?.onKey?.(e) === true) {
        e.preventDefault();
        return;
      }
      // Re-pressing the key that opened a window closes it, as it should.
      const same = this.hotkeyPanel(e.code);
      if (same !== null && same === this.top) {
        e.preventDefault();
        this.popPanel();
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.pushPanel(this.pause);
      return;
    }
    const p = this.hotkeyPanel(e.code);
    if (p !== null) {
      e.preventDefault();
      e.stopPropagation();
      this.pushPanel(p);
      return;
    }
    if (e.code === 'KeyE') {
      e.stopPropagation();
      this.interact();
      return;
    }
    if (e.code === 'F5') {
      e.preventDefault();
      e.stopPropagation();
      this.writeSave(QUICK_SLOT, 'Quicksave');
      return;
    }
    if (e.code === 'F9') {
      e.preventDefault();
      e.stopPropagation();
      this.readSave(QUICK_SLOT);
    }
  }

  private hotkeyPanel(code: string): Panel | null {
    switch (code) {
      case 'KeyI':
        return this.inventory;
      case 'KeyC':
        return this.character;
      case 'KeyM':
        return this.magic;
      case 'KeyJ':
        return this.journal;
      case 'KeyN':
        return this.map;
      default:
        return null;
    }
  }

  /**
   * Talk to whoever just greeted the player. Only the quest system knows which
   * actor body is which named person, and it announces that by greeting; the
   * interface therefore opens the conversation it was told about rather than
   * inventing a speaker for whatever the crosshair is on.
   */
  private interact(): void {
    const npc = this.lastGreeter;
    if (npc === null || this.elapsed - this.lastGreetAt > GREETING_WINDOW) {
      this.hud.notify(this.hoverActor === null ? 'There is nothing within reach.' : 'They have nothing to say to you.');
      return;
    }
    this.dialogue.begin(npc);
    this.pushPanel(this.dialogue);
  }

  // ---------------------------------------------------------------- update

  update(ctx: Ctx): void {
    const dt = ctx.time.dt;
    this.elapsed = ctx.time.elapsed;
    this.link.resolve(ctx);
    if (this.player === null) this.player = ctx.get<PlayerLike>('player') ?? null;
    if (this.actors === null) this.actors = ctx.get<ActorsLike>('actors') ?? null;
    if (this.terrain === null) {
      const t = ctx.get<ITerrain>('terrain');
      // Only hand it over once it actually exists; this ran every frame before
      // terrain registered, re-pushing null into the map each time.
      if (t !== undefined) {
        this.terrain = t;
        this.map.setTerrain(t);
      }
    }
    if (!this.applied) this.applySettings(ctx);

    // The free camera is the screenshot rig; the interface must get out of the
    // frame entirely when it is up.
    const free = this.player?.freefly === true;
    this.root.classList.toggle('hidden', free);
    if (free && this.stack.length > 0) this.closeAll();
    if (free) return;

    this.state.playtime += dt;
    // Fatigue, magicka, the effect clock and the movement flags Levitate and
    // Water Walking set are all the RPG system's. The interface used to run a
    // second copy of that simulation over its own character model; two
    // simulations of one body is how the screens came to disagree with the
    // game, so there is only one now.
    this.survey(dt, ctx);
    this.updateHover(dt, ctx);

    const yaw = this.headingOf(ctx);
    this.hud.playerX = ctx.camera.position.x;
    this.hud.playerZ = ctx.camera.position.z;
    this.hud.update(dt, yaw, this.terrain?.extent ?? 4096);
    this.hud.setCrosshairVisible(this.settings.crosshair && this.stack.length === 0);

    // The RPG system decides when a level is owed and has already said so in
    // the corner log; this only puts the rite in front of the player.
    if (this.levelOwed && this.stack.length === 0) {
      this.levelOwed = false;
      this.pushPanel(this.levelUp);
    }

    // Mutated in place: assigning a fresh literal here allocated once a frame.
    this.map.player.x = ctx.camera.position.x;
    this.map.player.z = ctx.camera.position.z;
    this.map.player.yaw = yaw;
    this.top?.tick?.(dt);
  }

  /** Camera heading in radians, with 0 facing north (-Z), matching the rig. */
  private headingOf(ctx: Ctx): number {
    ctx.camera.getWorldDirection(this.fwd);
    return Math.atan2(-this.fwd.x, -this.fwd.z);
  }

  private survey(dt: number, ctx: Ctx): void {
    this.surveyTimer -= dt;
    if (this.surveyTimer > 0) return;
    this.surveyTimer = 0.4;
    const extent = this.terrain?.extent ?? 4096;
    const p = ctx.camera.position;
    if (this.state.reveal(p.x, p.z, extent, SURVEY_RADIUS)) this.map.markFogDirty();
    // Athletics is credited by the RPG system, which watches the body move.
    // Crediting it here as well would double-count every step walked.
    this.lastPos.copy(p);
  }

  /** What the crosshair is on. Cheap enough at four hertz; pointless faster. */
  private updateHover(dt: number, ctx: Ctx): void {
    this.hoverTimer -= dt;
    if (this.hoverTimer > 0) return;
    this.hoverTimer = 0.12;
    const list = this.actors?.all();
    if (list === undefined) {
      this.hud.setHover(null, false);
      return;
    }
    ctx.camera.getWorldDirection(this.fwd);
    const origin = ctx.camera.position;
    let best: ActorLike | null = null;
    let bestDot = 0.984; // roughly a ten degree cone
    for (const a of list) {
      if (!a.alive) continue;
      this.toActor.copy(a.position).sub(origin);
      this.toActor.y += 1.0;
      const d = this.toActor.length();
      if (d > 6 || d < 0.2) continue;
      this.toActor.multiplyScalar(1 / d);
      const dot = this.toActor.dot(this.fwd);
      if (dot > bestDot) {
        bestDot = dot;
        best = a;
      }
    }
    this.hoverActor = best;
    if (best === null) {
      this.hud.setHover(null, false);
      return;
    }
    const hostile = best.faction === 'hostile' || best.faction === 'wild';
    // Someone is worth talking to when the quest system has just had them greet
    // the player; that is the only place a body is tied to a name.
    const speaks = this.lastGreeter !== null && this.elapsed - this.lastGreetAt <= GREETING_WINDOW;
    const hp = best.maxHealth > 0 ? Math.round((best.health / best.maxHealth) * 100) : 100;
    this.hud.setHover(speaks ? `${best.kind} — speak (E)` : `${best.kind} · ${hp}%`, hostile);
  }

  lateUpdate(ctx: Ctx): void {
    // Must run in the same frame as the render: the drawing buffer is not
    // preserved, so a copy taken any later is blank.
    if (this.player?.freefly === true) return;
    this.thumbs.capture(ctx.renderer.domElement, ctx.time.dt);
  }

  resize(): void {
    // Windows are sized in viewport units; only the compass caches pixels, and
    // it re-reads its width every frame.
  }

  // -------------------------------------------------------------- settings

  private applySettings(ctx: Ctx): void {
    const pipeline = ctx.get<IPipeline>('render');
    if (pipeline === undefined) return;
    this.applied = true;
    pipeline.setQuality(this.settings.quality);
    const p = this.player;
    if (p !== null) p.fov = this.settings.fov;
    else { ctx.camera.fov = this.settings.fov; ctx.camera.updateProjectionMatrix(); }
    if (p !== null) p.sensitivity = 0.0022 * this.settings.sensitivity;
    ctx.bus.emit('audio:volume', { kind: 'master', value: this.settings.master });
    this.hud.setVisible(this.settings.showHud && this.stack.length === 0);
  }

  private loadSettings(): void {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw === null) return;
      this.settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      this.hud.notify('Settings could not be written to disk.', 'warn');
    }
  }

  // ------------------------------------------------------------ save/load

  private writeSave(slot: string, name: string): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const p = this.player;
    const where =
      p === null ? undefined : { x: p.position.x, z: p.position.z, yaw: this.headingOf(ctx) };
    const blob = this.state.toJSON(ctx.clock, where);
    // The character, the world's memory and the combat state belong to their
    // own systems. `save:collect` is the engine's shared convention for asking
    // each of them to serialise itself; the interface saves what it owns and
    // carries theirs alongside, rather than writing down its own idea of them.
    const systems: Record<string, unknown> = {};
    ctx.bus.emit('save:collect', { data: systems });
    blob.systems = systems;

    const sheet = this.link.sheet();
    const ok = this.store.write(
      slot,
      {
        name: name === '' ? (sheet?.name ?? 'Ashlands') : name,
        when: Date.now(),
        level: sheet?.level ?? 1,
        who: sheet === null ? 'Traveller' : `${sheet.race} ${sheet.className}`,
        playtime: this.state.playtime,
        thumb: this.thumbs.latest,
      },
      blob,
    );
    this.hud.notify(ok ? 'Saved.' : 'The save could not be written.', ok ? 'info' : 'warn');
    if (ok && this.top === this.saves) this.popPanel();
  }

  private readSave(slot: string): void {
    const rec = this.store.read(slot);
    const ctx = this.ctx;
    if (rec === null || ctx === null) {
      this.hud.notify('That slot is empty.', 'warn');
      return;
    }
    this.state.fromJSON(rec.blob);
    if (rec.blob.systems !== undefined) ctx.bus.emit('save:apply', { data: rec.blob.systems });
    ctx.clock.day = rec.blob.day;
    ctx.clock.hour = rec.blob.hour;
    // Put the body back where the sheet says it was. Saves written before the
    // blob carried a position simply leave the player standing where they are.
    const p = this.player;
    const { px, pz, pyaw } = rec.blob;
    if (p !== null && px !== undefined && pz !== undefined) {
      p.teleport(px, pz);
      if (pyaw !== undefined) p.setLook(pyaw, 0);
    }
    this.map.markFogDirty();
    this.closeAll();
    this.hud.notify(`Loaded — ${rec.meta.name}.`, 'quest');
  }

  // -------------------------------------------------------------- teardown

  dispose(): void {
    if (this.onKeyDown !== null) document.removeEventListener('keydown', this.onKeyDown);
    if (this.onWheel !== null) document.removeEventListener('wheel', this.onWheel);
    this.onKeyDown = null;
    this.onWheel = null;
    for (const off of this.offs) off();
    this.offs = [];
    for (const p of this.panels()) p.dispose?.();
    this.root.remove();
    this.link.release();
    this.ctx = null;
    this.player = null;
    this.actors = null;
    this.terrain = null;
  }
}
