/**
 * Inventory: a paperdoll you drag armour onto, a sortable ledger, and a real
 * object turning under a light so that a Glass Claymore is visibly not an Iron
 * Shortsword before you read a single number.
 *
 * Everything on this screen is the character's actual pack, read through
 * `GameLink` from the RPG system each time the panel refreshes. Equipping,
 * using and dropping call that system's own methods and then re-read the
 * result, so what you see is what the character is carrying — never a copy the
 * interface keeps and lets drift.
 */
import { append, button, clamp, clear, coins, div, el, span, weightStr } from './dom';
import { Tooltip, Win, column, scroller, type Panel } from './kit';
import { ItemPreview } from './preview';
import { DOLL_LAYOUT, SLOT_LABELS, labelSkill, type GameLink, type ItemView, type LiveSlotId } from './live';

type SortKey = 'name' | 'weight' | 'value' | 'kind';

/** Filter tabs over the RPG layer's own item kinds. */
const FILTERS: readonly { readonly id: string; readonly label: string; readonly kinds: readonly string[] }[] = [
  { id: 'all', label: 'All', kinds: [] },
  { id: 'weapon', label: 'Arms', kinds: ['weapon'] },
  { id: 'armor', label: 'Armour', kinds: ['armor'] },
  { id: 'clothing', label: 'Attire', kinds: ['clothing'] },
  { id: 'potion', label: 'Potions', kinds: ['potion', 'scroll'] },
  { id: 'ingredient', label: 'Ingredients', kinds: ['ingredient'] },
  { id: 'book', label: 'Books', kinds: ['book'] },
  { id: 'misc', label: 'Sundries', kinds: ['misc', 'apparatus', 'tool'] },
];

const DOLL_SVG =
  '<svg viewBox="0 0 100 220" xmlns="http://www.w3.org/2000/svg">' +
  '<path fill="none" stroke="#3a2a14" stroke-width="1.4" ' +
  'd="M50 8c-9 0-14 7-14 15s5 14 14 14 14-6 14-14S59 8 50 8z' +
  'M30 42c-8 3-12 9-13 18l-3 34 8 2 4-26 1 44h46l1-44 4 26 8-2-3-34c-1-9-5-15-13-18' +
  'c-6 4-12 6-20 6s-14-2-20-6z' +
  'M28 118l3 52 4 42h11l2-58h4l2 58h11l4-42 3-52z"/></svg>';

export class InventoryPanel implements Panel {
  readonly id = 'inventory';
  readonly root: HTMLElement;
  private readonly win: Win;
  private readonly list = scroller();
  private readonly slotEls = new Map<LiveSlotId, HTMLDivElement>();
  private readonly preview = new ItemPreview();
  private readonly previewCap = div('cap', '');
  private readonly encRow = div('ash-enc');
  private readonly encBar = el('i');
  private readonly encNum = span('num', '');
  private readonly tip = new Tooltip();
  private sort: SortKey = 'name';
  private asc = true;
  private filter = 'all';
  private selected = 0;
  private dragUid = 0;
  /** Rebuilt on every refresh; the rows are drawn from this exact order. */
  private rows: ItemView[] = [];

  constructor(
    private readonly link: GameLink,
    private readonly notify: (t: string, k?: 'info' | 'warn' | 'quest') => void,
    private readonly onRead: (defId: string, title: string, text: string) => void,
  ) {
    this.win = new Win({
      title: 'Inventory',
      rect: { left: 'auto', top: '6vh', width: 'min(760px, 62vw)', height: '78vh' },
    });
    this.win.root.style.right = '3vw';
    this.root = this.win.root;

    const left = column();
    left.style.flex = '0 0 212px';
    left.appendChild(this.buildDoll());
    const prev = div('ash-preview');
    prev.appendChild(this.preview.canvas);
    prev.appendChild(this.previewCap);
    left.appendChild(prev);
    left.appendChild(this.buildEncumbrance());

    const right = column('ash-items');
    right.appendChild(this.buildFilters());
    right.appendChild(this.buildColumns());
    right.appendChild(this.list);
    const foot = div();
    foot.style.display = 'flex';
    foot.style.gap = '8px';
    foot.style.marginTop = '8px';
    append(
      foot,
      button('ash-btn', 'Use', () => this.use(this.selected)),
      button('ash-btn', 'Equip', () => this.toggleEquip(this.selected)),
      button('ash-btn', 'Repair', () => this.repair(this.selected)),
      button('ash-btn grim', 'Drop', () => this.drop(this.selected)),
    );
    right.appendChild(foot);

    append(this.win.body, left, right);
    this.tip.attach(document.body);
  }

  private buildDoll(): HTMLElement {
    const doll = div('ash-doll');
    const fig = div('figure');
    fig.innerHTML = DOLL_SVG;
    doll.appendChild(fig);
    for (const s of DOLL_LAYOUT) {
      const name = SLOT_LABELS[s.slot];
      const e = div('ash-slot');
      // Centred on the layout point; half of .ash-slot's 34px.
      e.style.left = `calc(${s.at[0]}% - 17px)`;
      e.style.top = `calc(${s.at[1]}% - 17px)`;
      e.tabIndex = 0;
      e.setAttribute('role', 'button');
      e.setAttribute('aria-label', name);
      e.appendChild(span('ghost', s.ghost));
      e.addEventListener('dragover', (ev) => {
        if (this.dragUid === 0) return;
        const view = this.link.item(this.dragUid);
        if (view === null || view.slot === null) return;
        ev.preventDefault();
        e.classList.add('drop');
      });
      e.addEventListener('dragleave', () => e.classList.remove('drop'));
      e.addEventListener('drop', (ev) => {
        ev.preventDefault();
        e.classList.remove('drop');
        if (this.dragUid !== 0) this.equipItem(this.dragUid);
      });
      e.addEventListener('click', () => {
        if (this.link.worn().has(s.slot)) {
          this.link.unequipSlot(s.slot);
          this.refresh();
        }
      });
      e.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        if (this.link.worn().has(s.slot)) this.link.unequipSlot(s.slot);
        else this.equipItem(this.selected);
        this.refresh();
      });
      e.addEventListener('pointerenter', () => {
        const view = this.link.worn().get(s.slot);
        this.tip.show(e, (into) => {
          if (view === undefined) {
            into.appendChild(el('h4', undefined, name));
            into.appendChild(div('desc', 'Empty. Drag something here.'));
            return;
          }
          this.buildTooltip(into, view);
        });
      });
      e.addEventListener('pointerleave', () => this.tip.hide());
      this.slotEls.set(s.slot, e);
      doll.appendChild(e);
    }
    return doll;
  }

  private buildEncumbrance(): HTMLElement {
    const bar = div('bar');
    bar.appendChild(this.encBar);
    append(this.encRow, span(undefined, 'Load'), bar, this.encNum);
    return this.encRow;
  }

  private buildFilters(): HTMLElement {
    const row = div('ash-tabs');
    for (const f of FILTERS) {
      const b = button('ash-tab', f.label, () => {
        this.filter = f.id;
        for (const c of row.children) c.classList.toggle('sel', c === b);
        this.refresh();
      });
      if (f.id === this.filter) b.classList.add('sel');
      row.appendChild(b);
    }
    return row;
  }

  private buildColumns(): HTMLElement {
    const row = div('ash-cols');
    const mk = (cls: string, label: string, key: SortKey): HTMLButtonElement => {
      const b = button(cls, label, () => {
        this.asc = this.sort === key ? !this.asc : true;
        this.sort = key;
        for (const c of row.querySelectorAll('button')) c.classList.toggle('sel', c === b);
        this.refresh();
      });
      if (this.sort === key) b.classList.add('sel');
      return b;
    };
    append(row, mk('g', '·', 'kind'), mk('n', 'Item', 'name'), mk('w', 'Wt', 'weight'), mk('v', 'Value', 'value'));
    return row;
  }

  // ------------------------------------------------------------------ data

  private visible(): ItemView[] {
    const f = FILTERS.find((x) => x.id === this.filter);
    const kinds = f === undefined ? [] : f.kinds;
    const out = this.link.items().filter((v) => kinds.length === 0 || kinds.includes(v.kind));
    const dir = this.asc ? 1 : -1;
    out.sort((a, b) => {
      if (this.sort === 'weight') return (a.weight - b.weight) * dir;
      if (this.sort === 'value') return (a.value - b.value) * dir;
      if (this.sort === 'kind') return a.kind.localeCompare(b.kind) * dir || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name) * dir;
    });
    return out;
  }

  refresh(): void {
    clear(this.list);
    this.rows = this.visible();

    if (!this.link.bound) {
      const none = div('ash-blurb', 'No character is bound to this interface.');
      none.style.padding = '14px 8px';
      this.list.appendChild(none);
    } else if (this.rows.length === 0) {
      const empty = div('ash-blurb', 'Nothing of the kind. You came here with less than most.');
      empty.style.padding = '14px 8px';
      this.list.appendChild(empty);
    }

    for (const v of this.rows) {
      const classes =
        `ash-row${v.equippedIn !== null ? ' eq' : ''}` +
        `${v.enchantment !== null ? ' ench' : ''}${v.uid === this.selected ? ' sel' : ''}`;
      const r = div(classes);
      r.draggable = v.slot !== null;
      r.tabIndex = 0;
      const label = v.name + (v.count > 1 ? ` (${v.count})` : '');
      append(
        r,
        span('g', v.glyph),
        span('n', label),
        span('w', weightStr(v.weight * v.count)),
        span('v', coins(v.value * v.count)),
      );
      r.addEventListener('click', () => this.select(v.uid));
      r.addEventListener('dblclick', () => this.toggleEquip(v.uid));
      r.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.toggleEquip(v.uid);
        if (e.key === 'u' || e.key === 'U') this.use(v.uid);
      });
      r.addEventListener('dragstart', (e) => {
        this.dragUid = v.uid;
        r.classList.add('drag');
        e.dataTransfer?.setData('text/plain', String(v.uid));
        if (e.dataTransfer !== null) e.dataTransfer.effectAllowed = 'move';
        this.select(v.uid);
      });
      r.addEventListener('dragend', () => {
        this.dragUid = 0;
        r.classList.remove('drag');
        for (const e of this.slotEls.values()) e.classList.remove('drop');
      });
      r.addEventListener('pointerenter', () => this.tip.show(r, (into) => this.buildTooltip(into, v)));
      r.addEventListener('pointerleave', () => this.tip.hide());
      this.list.appendChild(r);
    }

    const worn = this.link.worn();
    for (const s of DOLL_LAYOUT) {
      const e = this.slotEls.get(s.slot);
      if (e === undefined) continue;
      const v = worn.get(s.slot);
      clear(e);
      e.classList.toggle('filled', v !== undefined);
      e.appendChild(v === undefined ? span('ghost', s.ghost) : span('', v.glyph));
    }

    const sheet = this.link.sheet();
    const load = sheet?.encumbrance ?? 0;
    const max = sheet?.capacity ?? 0;
    const f = clamp(load / Math.max(1, max), 0, 1);
    this.encBar.style.width = `${(f * 100).toFixed(1)}%`;
    this.encNum.textContent = `${weightStr(load)} / ${Math.round(max)}`;
    this.encRow.classList.toggle('near', f > 0.85 && f <= 1);
    this.encRow.classList.toggle('over', f > 1);
    this.win.sub = `${coins(sheet?.gold ?? 0)} septims`;

    if (!this.rows.some((v) => v.uid === this.selected) && this.rows.length > 0) this.select(this.rows[0].uid);
  }

  private select(uid: number): void {
    this.selected = uid;
    const v = this.link.item(uid);
    if (v !== null) {
      this.preview.show(v.shape, { tint: v.tint, metal: v.metal, rough: v.rough });
      this.previewCap.textContent = v.kind;
    }
    this.refreshSelection();
  }

  private refreshSelection(): void {
    const nodes = [...this.list.querySelectorAll<HTMLElement>('.ash-row')];
    for (let i = 0; i < nodes.length && i < this.rows.length; i++) {
      nodes[i].classList.toggle('sel', this.rows[i].uid === this.selected);
    }
  }

  private buildTooltip(into: HTMLElement, v: ItemView): void {
    into.appendChild(el('h4', undefined, v.name));
    const stat = (k: string, value: string): void => {
      const r = div('stat');
      append(r, span(undefined, k), span(undefined, value));
      into.appendChild(r);
    };
    stat('Weight', weightStr(v.weight));
    stat('Value', `${coins(v.value)} septims`);
    if (v.detail !== '') into.appendChild(div('desc', v.detail));
    if (v.def.skill !== undefined) stat('Skill', labelSkill(v.def.skill));
    if (v.slot !== null) {
      stat('Worn', v.equippedIn === null ? 'no' : SLOT_LABELS[v.equippedIn]);
    }
    if (v.condition >= 0) {
      stat('Condition', `${Math.round(v.condition * v.maxCondition)} / ${Math.round(v.maxCondition)}`);
      const cond = div(`cond${v.condition < 0.3 ? ' broken' : v.condition < 0.7 ? ' worn' : ''}`);
      const bar = el('i');
      bar.style.width = `${Math.round(v.condition * 100)}%`;
      cond.appendChild(bar);
      into.appendChild(cond);
    }
    if (v.soul > 0) stat('Soul', `${v.soulName ?? 'trapped'} (${v.soul})`);
    if (v.enchantment !== null) {
      const e = div('ench');
      // The effect lines are the RPG layer's own descriptions, not re-worded.
      const lines = v.enchantment.effects.map((x) => this.link.describeEffect(x));
      const charge = v.maxCharge > 0 ? ` (${Math.round(v.charge)}/${Math.round(v.maxCharge)})` : '';
      e.textContent = `${v.enchantment.name}: ${lines.join(', ')}${charge}`;
      into.appendChild(e);
    }
    // Ingredients and potions read out only as far as the character's Alchemy
    // allows — the RPG system decides how much is legible, not this panel.
    const known = this.link.identify(v.uid);
    for (const line of known) into.appendChild(div('desc', line));
  }

  // --------------------------------------------------------------- actions

  private equipItem(uid: number): void {
    const before = this.link.item(uid);
    if (before === null) return;
    if (!this.link.equip(uid)) {
      this.notify(`${before.name} cannot be worn.`, 'warn');
      this.refresh();
      return;
    }
    const after = this.link.item(uid);
    const where = after?.equippedIn;
    this.notify(where === undefined || where === null ? `${before.name} equipped.` : `${before.name} — ${SLOT_LABELS[where]}.`);
    this.refresh();
  }

  private toggleEquip(uid: number): void {
    const v = this.link.item(uid);
    if (v === null) return;
    if (v.slot === null) {
      this.use(uid);
      return;
    }
    if (v.equippedIn !== null) {
      this.link.unequip(uid);
      this.refresh();
      return;
    }
    this.equipItem(uid);
  }

  /** Potions are drunk, books are read, enchantments fire, gear is worn. */
  private use(uid: number): void {
    const v = this.link.item(uid);
    if (v === null) return;
    if (v.kind === 'book') {
      // `consume` is still the entry point: it is what records the book as read
      // and grants the skill the first time. The text comes back on the bus.
      this.link.use(uid);
      this.onRead(v.defId, v.name, v.def.text ?? '');
      this.refresh();
      return;
    }
    if (v.slot !== null && v.kind !== 'potion' && v.kind !== 'scroll' && v.enchantment === null) {
      this.toggleEquip(uid);
      return;
    }
    if (!this.link.use(uid)) {
      this.notify(`${v.name} does nothing.`, 'warn');
      return;
    }
    this.notify(`You use ${v.name.toLowerCase()}.`);
    this.refresh();
  }

  private repair(uid: number): void {
    const v = this.link.item(uid);
    if (v === null) return;
    if (v.condition < 0) {
      this.notify(`${v.name} cannot be repaired.`, 'warn');
      return;
    }
    // The RPG system reports success, failure and a broken hammer on the bus.
    this.link.repair(uid);
    this.refresh();
  }

  private drop(uid: number): void {
    const v = this.link.item(uid);
    if (v === null) return;
    if (this.link.discard(uid, v.count)) this.notify(`Dropped ${v.name}.`);
    this.refresh();
  }

  // ------------------------------------------------------------ lifecycle

  open(): void {
    this.refresh();
    const first = this.list.querySelector<HTMLElement>('.ash-row');
    first?.focus();
  }

  close(): void {
    this.tip.hide();
  }

  tick(dt: number): void {
    this.preview.render(dt);
  }

  dispose(): void {
    this.preview.dispose();
    this.tip.root.remove();
  }
}
