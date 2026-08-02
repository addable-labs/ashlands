/**
 * Title, pause, settings and the save/load slots.
 *
 * The title screen is not a window: it is the whole frame, because the first
 * thing the game shows should not look like a dialog box over a screenshot.
 */
import { append, button, clear, coins, div, el, roman, span } from './dom';
import { Win, checkbox, column, field, rule, scroller, slider, type Panel } from './kit';
import { QUICK_SLOT, SaveStore, type SlotRecord } from './save';
import type { GameLink } from './live';
import type { GameState, Settings } from './state';
import { dateString } from './journal';

export interface MenuHooks {
  newGame(): void;
  resume(): void;
  openSettings(): void;
  openSaves(mode: 'save' | 'load'): void;
  toTitle(): void;
}

export class TitlePanel implements Panel {
  readonly id = 'title';
  readonly root = div('ash-title');
  private readonly menu = div('menu');

  constructor(private readonly hooks: MenuHooks, private readonly store: SaveStore) {
    const h = el('h1', undefined, 'Ashlands');
    append(this.root, h, div('sub', 'An Elder Scrolls Chapter'), div('rule'), this.menu);
  }

  open(): void {
    clear(this.menu);
    const latest = this.newest();
    if (latest !== null) {
      this.menu.appendChild(
        button('ash-btn wide', 'Continue', () => {
          this.hooks.openSaves('load');
        }),
      );
    }
    append(
      this.menu,
      button('ash-btn wide', 'New Game', () => this.hooks.newGame()),
      button('ash-btn wide', 'Load', () => this.hooks.openSaves('load')),
      button('ash-btn wide', 'Settings', () => this.hooks.openSettings()),
    );
    this.menu.querySelector<HTMLElement>('button')?.focus();
  }

  close(): void {
    /* nothing to tear down */
  }

  private newest(): SlotRecord | null {
    let best: SlotRecord | null = null;
    for (const id of this.store.ids()) {
      const r = this.store.read(id);
      if (r !== null && (best === null || r.meta.when > best.meta.when)) best = r;
    }
    return best;
  }
}

export class PausePanel implements Panel {
  readonly id = 'pause';
  readonly root: HTMLElement;
  private readonly win: Win;

  constructor(private readonly hooks: MenuHooks, private readonly link: GameLink) {
    this.win = new Win({
      title: 'Ashlands',
      rect: { left: '50%', top: '50%', width: 'min(320px, 44vw)', height: 'auto' },
    });
    this.win.root.style.transform = 'translate(-50%,-50%)';
    this.root = this.win.root;
    const col = column();
    append(
      col,
      button('ash-btn wide', 'Return', () => this.hooks.resume()),
      button('ash-btn wide', 'Save', () => this.hooks.openSaves('save')),
      button('ash-btn wide', 'Load', () => this.hooks.openSaves('load')),
      button('ash-btn wide', 'Settings', () => this.hooks.openSettings()),
      rule(),
      button('ash-btn wide grim', 'Abandon', () => this.hooks.toTitle()),
    );
    for (const b of col.children) (b as HTMLElement).style.marginBottom = '7px';
    this.win.body.appendChild(col);
  }

  open(): void {
    // The character's level, from the character.
    const sheet = this.link.sheet();
    this.win.sub = sheet === null ? '' : `Level ${roman(sheet.level)}`;
    this.root.querySelector<HTMLElement>('button')?.focus();
  }

  close(): void {
    /* nothing to tear down */
  }
}

export interface SettingsHooks {
  quality(tier: Settings['quality']): void;
  fov(v: number): void;
  sensitivity(v: number): void;
  audio(kind: 'master' | 'music' | 'effects', v: number): void;
  hud(v: boolean): void;
  persist(): void;
}

const TIERS: readonly Settings['quality'][] = ['low', 'medium', 'high', 'ultra'];

export class SettingsPanel implements Panel {
  readonly id = 'settings';
  readonly root: HTMLElement;
  private readonly win: Win;

  constructor(private readonly s: Settings, private readonly hooks: SettingsHooks) {
    this.win = new Win({
      title: 'Settings',
      rect: { left: '50%', top: '10vh', width: 'min(620px, 60vw)', height: 'min(640px, 74vh)' },
    });
    this.win.root.style.transform = 'translateX(-50%)';
    this.root = this.win.root;
    const col = column();
    col.style.flex = '1';
    const body = scroller();

    body.appendChild(div('ash-spec', 'Vision'));
    const tierBox = div('ash-tabs');
    for (const t of TIERS) {
      const b = button('ash-tab', t, () => {
        this.s.quality = t;
        for (const c of tierBox.children) c.classList.toggle('sel', c === b);
        this.hooks.quality(t);
        this.hooks.persist();
      });
      if (t === this.s.quality) b.classList.add('sel');
      tierBox.appendChild(b);
    }
    body.appendChild(field('Detail', tierBox));
    body.appendChild(
      slider('Field of view', 55, 100, 1, this.s.fov, (v) => `${v}°`, (v) => {
        this.s.fov = v;
        this.hooks.fov(v);
        this.hooks.persist();
      }),
    );

    body.appendChild(rule());
    body.appendChild(div('ash-spec', 'Hand'));
    body.appendChild(
      slider('Sensitivity', 0.2, 3, 0.05, this.s.sensitivity, (v) => v.toFixed(2), (v) => {
        this.s.sensitivity = v;
        this.hooks.sensitivity(v);
        this.hooks.persist();
      }),
    );
    body.appendChild(
      field(
        'Invert look',
        checkbox('Invert vertical', this.s.invertY, (v) => {
          this.s.invertY = v;
          this.hooks.persist();
        }),
      ),
    );

    body.appendChild(rule());
    body.appendChild(div('ash-spec', 'Ear'));
    for (const k of ['master', 'music', 'effects'] as const) {
      body.appendChild(
        slider(k, 0, 1, 0.01, this.s[k], (v) => `${Math.round(v * 100)}%`, (v) => {
          this.s[k] = v;
          this.hooks.audio(k, v);
          this.hooks.persist();
        }),
      );
    }

    body.appendChild(rule());
    body.appendChild(div('ash-spec', 'Interface'));
    body.appendChild(
      field(
        'Heads-up display',
        checkbox('Show', this.s.showHud, (v) => {
          this.s.showHud = v;
          this.hooks.hud(v);
          this.hooks.persist();
        }),
      ),
    );
    body.appendChild(
      field(
        'Crosshair',
        checkbox('Show', this.s.crosshair, (v) => {
          this.s.crosshair = v;
          this.hooks.persist();
        }),
      ),
    );
    body.appendChild(
      field(
        'Subtitles',
        checkbox('Show', this.s.subtitles, (v) => {
          this.s.subtitles = v;
          this.hooks.persist();
        }),
      ),
    );
    col.appendChild(body);
    this.win.body.appendChild(col);
  }

  open(): void {
    this.root.querySelector<HTMLElement>('button, input')?.focus();
  }

  close(): void {
    /* nothing to tear down */
  }
}

export interface SaveHooks {
  save(slot: string, name: string): void;
  load(slot: string): void;
  close(): void;
}

export class SaveLoadPanel implements Panel {
  readonly id = 'saves';
  readonly root: HTMLElement;
  private readonly win: Win;
  private readonly grid = div('ash-slots');
  private readonly nameInput = el('input', 'ash-input');
  private readonly actions = div();
  private mode: 'save' | 'load' = 'load';
  private selected = '1';

  constructor(
    private readonly store: SaveStore,
    private readonly hooks: SaveHooks,
    private readonly link: GameLink,
    private readonly st: GameState,
  ) {
    this.win = new Win({
      title: 'Chronicle',
      rect: { left: '50%', top: '10vh', width: 'min(720px, 66vw)', height: 'min(620px, 74vh)' },
    });
    this.win.root.style.transform = 'translateX(-50%)';
    this.root = this.win.root;
    const col = column();
    col.style.flex = '1';
    const scroll = scroller();
    scroll.appendChild(this.grid);
    this.nameInput.placeholder = 'Name this save';
    append(col, scroll, rule(), field('Name', this.nameInput), this.actions);
    this.win.body.appendChild(col);
  }

  setMode(mode: 'save' | 'load'): void {
    this.mode = mode;
    this.refresh();
  }

  open(): void {
    this.refresh();
  }

  close(): void {
    /* nothing to tear down */
  }

  private refresh(): void {
    this.win.sub = this.mode === 'save' ? 'Writing' : 'Reading';
    clear(this.grid);
    for (const id of this.store.ids()) {
      const rec = this.store.read(id);
      const card = el('button', `ash-slotcard${rec === null ? ' empty' : ''}${id === this.selected ? ' sel' : ''}`);
      card.type = 'button';
      const thumb = el('img', 'thumb');
      if (rec !== null && rec.meta.thumb !== '') thumb.src = rec.meta.thumb;
      thumb.alt = '';
      const meta = div('meta');
      const label = id === QUICK_SLOT ? 'Quicksave' : `Slot ${id}`;
      append(
        meta,
        div('nm', rec === null ? `${label} — empty` : rec.meta.name),
        div('dt', rec === null ? '' : `${label} · Level ${rec.meta.level} ${rec.meta.who}`),
        div('dt', rec === null ? '' : dateString(rec.blob.day, rec.blob.hour)),
      );
      append(card, thumb, meta);
      card.addEventListener('click', () => {
        this.selected = id;
        if (rec !== null && this.mode === 'save') this.nameInput.value = rec.meta.name;
        this.refresh();
      });
      card.addEventListener('dblclick', () => this.commit());
      this.grid.appendChild(card);
    }

    clear(this.actions);
    this.actions.style.display = 'flex';
    this.actions.style.gap = '8px';
    this.actions.style.marginTop = '8px';
    const primary = button('ash-btn', this.mode === 'save' ? 'Write' : 'Read', () => this.commit());
    const del = button('ash-btn grim', 'Erase', () => {
      this.store.remove(this.selected);
      this.refresh();
    });
    const back = button('ash-btn grim', 'Back', () => this.hooks.close());
    append(this.actions, primary, del, back);
    if (this.nameInput.value === '') {
      const who = this.link.sheet()?.name ?? 'Ashlands';
      this.nameInput.value = `${who}, ${coins(Math.round(this.st.playtime / 60))} minutes`;
    }
  }

  private commit(): void {
    if (this.mode === 'save') this.hooks.save(this.selected, this.nameInput.value.trim());
    else this.hooks.load(this.selected);
  }
}

/** Small helper used by the pause and title screens for the version line. */
export function footerLine(): HTMLElement {
  return span('ash-hint', 'Ashlands · a chapter of The Elder Scrolls');
}
