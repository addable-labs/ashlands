/**
 * Magic, spellmaking, enchanting and alchemy — the four windows where the
 * player builds things the designer never wrote down.
 *
 * Every one of them drives the RPG system directly: `createSpell`,
 * `enchantItem` and `brewPotion` are the only ways anything is made here, and
 * every price on screen is `priceSpell` talking. The effect list is what the
 * character actually knows — the union of the effects in their spellbook —
 * because a picker offering effects nobody ever taught you is the same lie as
 * an inventory full of items nobody gave you.
 */
import { append, button, clear, coins, div, el, span } from './dom';
import { Tooltip, Win, column, rule, scroller, slider, type Panel } from './kit';
import {
  LIVE_ATTRIBUTES,
  LIVE_SKILLS,
  labelAttribute,
  labelSkill,
  type EffectFacts,
  type GameLink,
  type LiveEffect,
} from './live';

type Tab = 'spells' | 'make' | 'enchant' | 'alchemy';

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'spells', label: 'Spells' },
  { id: 'make', label: 'Spellmaking' },
  { id: 'enchant', label: 'Enchanting' },
  { id: 'alchemy', label: 'Alchemy' },
];

const RANGES: readonly { readonly id: LiveEffect['range']; readonly label: string }[] = [
  { id: 'self', label: 'on Self' },
  { id: 'touch', label: 'on Touch' },
  { id: 'target', label: 'on Target' },
];

/** The three bindings the enchanter accepts — src/rpg/Items.ts `Enchantment.kind`. */
const TRIGGERS: readonly { readonly id: 'cast' | 'constant' | 'strike'; readonly label: string }[] = [
  { id: 'cast', label: 'Cast when used' },
  { id: 'strike', label: 'Cast on strike' },
  { id: 'constant', label: 'Constant Effect' },
];

/**
 * A constant effect pays for an infinite duration up front. Mirrors
 * CONSTANT_EFFECT_MULT in src/rpg/Effects.ts and is used only to preview the
 * charge before you commit; the binding itself reports the real cost back.
 */
const CONSTANT_EFFECT_MULT = 100;

const MAX_INGREDIENTS = 4;

export class MagicPanel implements Panel {
  readonly id = 'magic';
  readonly root: HTMLElement;
  private readonly win: Win;
  private readonly content = div();
  private readonly tip = new Tooltip();
  private tab: Tab = 'spells';
  /** The effect list being composed, shared by spellmaking and enchanting. */
  private brew: LiveEffect[] = [];
  private brewName = 'Unnamed';
  private enchantTarget = 0;
  private gemUid = 0;
  private trigger: 'cast' | 'constant' | 'strike' = 'cast';
  private mortar: number[] = [];
  private costBox = div('ash-cost');
  /** Effect shapes, probed once per open through the RPG layer. */
  private facts = new Map<string, EffectFacts>();

  constructor(
    private readonly link: GameLink,
    private readonly notify: (t: string, k?: 'info' | 'warn' | 'quest') => void,
  ) {
    this.win = new Win({
      title: 'Magic',
      rect: { left: '50%', top: '6vh', width: 'min(900px, 74vw)', height: '80vh' },
    });
    this.win.root.style.transform = 'translateX(-50%)';
    this.root = this.win.root;

    const col = column();
    const bar = div('ash-tabs');
    for (const t of TABS) {
      const b = button('ash-tab', t.label, () => {
        this.tab = t.id;
        for (const c of bar.children) c.classList.toggle('sel', c === b);
        this.refresh();
      });
      if (t.id === this.tab) b.classList.add('sel');
      bar.appendChild(b);
    }
    this.content.style.flex = '1';
    this.content.style.minHeight = '0';
    this.content.style.display = 'flex';
    this.content.style.gap = '16px';
    append(col, bar, this.content);
    col.style.flex = '1';
    this.win.body.appendChild(col);
    this.tip.attach(document.body);
  }

  open(): void {
    this.facts.clear();
    this.refresh();
  }

  close(): void {
    this.tip.hide();
  }

  private factsFor(id: string): EffectFacts {
    let f = this.facts.get(id);
    if (f === undefined) {
      f = this.link.describeEffectId(id);
      this.facts.set(id, f);
    }
    return f;
  }

  private refresh(): void {
    clear(this.content);
    const sheet = this.link.sheet();
    this.win.sub = sheet === null ? '' : `${coins(sheet.gold)} septims`;
    if (!this.link.bound) {
      this.content.appendChild(div('ash-blurb', 'No character is bound to this interface.'));
      return;
    }
    const build: Readonly<Record<Tab, () => void>> = {
      spells: () => this.buildSpells(),
      make: () => this.buildMake(),
      enchant: () => this.buildEnchant(),
      alchemy: () => this.buildAlchemy(),
    };
    build[this.tab]();
  }

  // --------------------------------------------------------------- spells

  private buildSpells(): void {
    const character = this.link.character();
    const sheet = this.link.sheet();
    if (character === null || sheet === null) return;
    const book = character.spells;

    const list = scroller();
    const castable = book.castable();
    if (castable.length === 0) list.appendChild(div('ash-blurb', 'You know nothing you can cast.'));
    for (const sp of castable) {
      const r = div(`ash-row${sp.id === book.ready ? ' sel' : ''}`);
      append(
        r,
        span('g', '✧'),
        span('n', sp.name),
        span('w', String(sp.cost)),
        span('v', sp.cost <= sheet.magicka ? 'ready' : 'short'),
      );
      r.tabIndex = 0;
      const ready = (): void => {
        // The spellbook is the RPG system's; readying here is what the cast key
        // will actually fire.
        book.ready = sp.id;
        this.notify(`${sp.name} readied.`);
        this.refresh();
      };
      r.addEventListener('click', ready);
      r.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') ready();
      });
      r.addEventListener('pointerenter', () =>
        this.tip.show(r, (into) => {
          into.appendChild(el('h4', undefined, sp.name));
          for (const e of sp.effects) into.appendChild(div('desc', this.link.describeEffect(e)));
          const c = div('stat');
          append(c, span(undefined, 'Cost'), span(undefined, `${sp.cost} magicka`));
          into.appendChild(c);
        }),
      );
      r.addEventListener('pointerleave', () => this.tip.hide());
      list.appendChild(r);
    }

    const left = column();
    left.style.flex = '1';
    const hdr = div('ash-cols');
    append(hdr, span('g', '·'), span('n', 'Spell'), span('w', 'Cost'), span('v', ''));
    append(left, hdr, list);

    const right = column();
    right.style.flex = '0 0 260px';
    right.appendChild(div('ash-spec', 'Magicka'));
    right.appendChild(
      div('ash-blurb', `${Math.round(sheet.magicka)} of ${Math.round(sheet.maxMagicka)} under the ${titleCase(sheet.birthsign)}.`),
    );
    right.appendChild(rule());
    right.appendChild(div('ash-spec', 'Schools'));
    for (const s of ['destruction', 'alteration', 'illusion', 'conjuration', 'mysticism', 'restoration'] as const) {
      const row = div('ash-stat');
      append(row, span('k', labelSkill(s)), span('leader'), span('v', String(Math.round(sheet.skills[s]))));
      right.appendChild(row);
    }
    append(this.content, left, right);
  }

  // ---------------------------------------------------------- spellmaking

  private buildMake(): void {
    const picker = this.effectPicker();
    const editor = column();
    editor.style.flex = '1';

    const nameField = el('input', 'ash-input');
    nameField.value = this.brewName;
    nameField.placeholder = 'Name your spell';
    nameField.addEventListener('input', () => {
      this.brewName = nameField.value;
    });
    const nameRow = div('ash-field');
    nameRow.appendChild(el('label', undefined, 'Name'));
    nameRow.appendChild(nameField);
    editor.appendChild(nameRow);

    const body = scroller();
    for (let i = 0; i < this.brew.length; i++) body.appendChild(this.effectCard(i, () => this.refreshCost()));
    if (this.brew.length === 0) {
      body.appendChild(
        div(
          'ash-blurb',
          'Choose effects on the left. Nothing here stops you asking for a hundred points of anything; it only tells you the price.',
        ),
      );
    }
    editor.appendChild(body);

    this.costBox = div('ash-cost');
    editor.appendChild(this.costBox);
    const actions = div();
    actions.style.display = 'flex';
    actions.style.gap = '8px';
    actions.style.marginTop = '8px';
    append(
      actions,
      button('ash-btn', 'Create', () => this.createSpell()),
      button('ash-btn grim', 'Clear', () => {
        this.brew = [];
        this.refresh();
      }),
    );
    editor.appendChild(actions);
    append(this.content, picker, editor);
    this.refreshCost();
  }

  private refreshCost(): void {
    clear(this.costBox);
    const priced = this.link.priceSpell(this.brew);
    const sheet = this.link.sheet();
    const affordable = sheet !== null && priced.cost <= sheet.maxMagicka;
    append(
      this.costBox,
      cell('Magicka', this.brew.length === 0 ? '—' : String(priced.cost), affordable ? 'safe' : 'risk'),
      cell('Effects', String(this.brew.length)),
      cell('Your pool', sheet === null ? '—' : String(Math.round(sheet.maxMagicka))),
    );
    for (const line of priced.lines) this.costBox.appendChild(div('lbl', line));
  }

  private createSpell(): void {
    if (this.brew.length === 0) {
      this.notify('A spell needs at least one effect.', 'warn');
      return;
    }
    const name = this.brewName.trim() === '' ? 'Unnamed' : this.brewName.trim();
    // The RPG system prices, validates, names and learns it; failure is
    // reported on the bus by that system, not guessed at here.
    const made = this.link.rpg?.createSpell(name, this.brew) ?? null;
    if (made === null) {
      this.refresh();
      return;
    }
    this.brew = [];
    this.refresh();
  }

  // ----------------------------------------------------------- enchanting

  private buildEnchant(): void {
    const picker = this.effectPicker();
    const editor = column();
    editor.style.flex = '1';

    const items = this.link.items();
    const targets = items.filter((v) => v.slot !== null && v.enchantment === null);
    const gems = items.filter((v) => v.def.misc === 'soulgem' && v.soul > 0);

    const sel = el('select', 'ash-sel');
    sel.appendChild(el('option', undefined, '— choose an item —'));
    for (const t of targets) {
      const o = el('option', undefined, `${t.name} · holds ${t.def.enchantPoints ?? 0}`);
      o.value = String(t.uid);
      if (t.uid === this.enchantTarget) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      this.enchantTarget = Number(sel.value);
      this.refreshEnchantCost();
    });
    const itemRow = div('ash-field');
    itemRow.appendChild(el('label', undefined, 'Object'));
    itemRow.appendChild(sel);
    editor.appendChild(itemRow);

    const gem = el('select', 'ash-sel');
    if (gems.length === 0) gem.appendChild(el('option', undefined, '— no filled soul gem —'));
    for (const g of gems) {
      const o = el('option', undefined, `${g.name} — ${g.soulName ?? 'a soul'} (${g.soul})`);
      o.value = String(g.uid);
      if (g.uid === this.gemUid) o.selected = true;
      gem.appendChild(o);
    }
    gem.addEventListener('change', () => {
      this.gemUid = Number(gem.value);
      this.refreshEnchantCost();
    });
    const gemRow = div('ash-field');
    gemRow.appendChild(el('label', undefined, 'Soul gem'));
    gemRow.appendChild(gem);
    editor.appendChild(gemRow);

    const trig = el('select', 'ash-sel');
    for (const t of TRIGGERS) {
      const o = el('option', undefined, t.label);
      o.value = t.id;
      if (t.id === this.trigger) o.selected = true;
      trig.appendChild(o);
    }
    trig.addEventListener('change', () => {
      this.trigger = trig.value as 'cast' | 'constant' | 'strike';
      this.refreshEnchantCost();
    });
    const trigRow = div('ash-field');
    trigRow.appendChild(el('label', undefined, 'Trigger'));
    trigRow.appendChild(trig);
    editor.appendChild(trigRow);

    const body = scroller();
    for (let i = 0; i < this.brew.length; i++) body.appendChild(this.effectCard(i, () => this.refreshEnchantCost()));
    if (this.brew.length === 0) {
      body.appendChild(
        div('ash-blurb', 'A constant effect on a ring is how every memorable character in this series was actually built.'),
      );
    }
    editor.appendChild(body);

    this.costBox = div('ash-cost');
    editor.appendChild(this.costBox);
    const act = div();
    act.style.marginTop = '8px';
    act.appendChild(button('ash-btn', 'Bind', () => this.doEnchant()));
    editor.appendChild(act);
    append(this.content, picker, editor);
    this.refreshEnchantCost();
  }

  private enchantCharge(): number {
    const base = this.link.priceSpell(this.brew).cost;
    return this.brew.length === 0 ? 0 : base * (this.trigger === 'constant' ? CONSTANT_EFFECT_MULT : 1);
  }

  private refreshEnchantCost(): void {
    clear(this.costBox);
    const target = this.enchantTarget === 0 ? null : this.link.item(this.enchantTarget);
    const gem = this.gemUid === 0 ? null : this.link.item(this.gemUid);
    const charge = this.enchantCharge();
    const capacity = target?.def.enchantPoints ?? 0;
    append(
      this.costBox,
      cell('Charge', String(charge)),
      cell('Item holds', String(capacity), charge > capacity && this.trigger === 'constant' ? 'risk' : 'safe'),
      cell('Soul', gem === null ? '—' : String(gem.soul), gem === null || gem.soul < charge ? 'risk' : 'safe'),
    );
    for (const line of this.link.priceSpell(this.brew).lines) this.costBox.appendChild(div('lbl', line));
  }

  private doEnchant(): void {
    const rpg = this.link.rpg;
    if (rpg === null) return;
    if (this.enchantTarget === 0 || this.gemUid === 0 || this.brew.length === 0) {
      this.notify('Choose an object, a filled soul gem and at least one effect.', 'warn');
      return;
    }
    const name = this.brewName.trim() === '' ? 'Binding' : this.brewName.trim();
    const res = rpg.enchantItem(this.enchantTarget, this.gemUid, this.brew, this.trigger, name);
    if (!res.ok) {
      // The RPG layer already said what happened on the bus; add the numbers it
      // returned, which are the authoritative ones.
      if (res.reason === 'too-costly') {
        this.notify(`Too much: ${res.cost} of charge into ${res.capacity} of capacity.`, 'warn');
      }
    } else {
      this.brew = [];
      this.enchantTarget = 0;
      this.gemUid = 0;
    }
    this.refresh();
  }

  // -------------------------------------------------------------- alchemy

  private buildAlchemy(): void {
    const rpg = this.link.rpg;
    if (rpg === null) return;
    const ingredients = this.link.items().filter((v) => v.kind === 'ingredient');

    const left = column();
    left.style.flex = '1';
    left.appendChild(div('ash-spec', 'Ingredients'));
    const list = scroller();
    if (ingredients.length === 0) list.appendChild(div('ash-blurb', 'You are carrying nothing worth grinding.'));
    for (const v of ingredients) {
      const picked = this.mortar.filter((u) => u === v.uid).length;
      const r = div(`ash-row${picked > 0 ? ' sel' : ''}`);
      append(
        r,
        span('g', v.glyph),
        span('n', `${v.name}${picked > 0 ? ` ×${picked}` : ''}`),
        span('v', String(v.count)),
      );
      r.tabIndex = 0;
      const add = (): void => {
        if (this.mortar.length >= MAX_INGREDIENTS) return;
        if (this.mortar.filter((u) => u === v.uid).length >= v.count) return;
        this.mortar.push(v.uid);
        this.refresh();
      };
      r.addEventListener('click', add);
      r.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') add();
      });
      r.addEventListener('pointerenter', () =>
        this.tip.show(r, (into) => {
          into.appendChild(el('h4', undefined, v.name));
          // How much of an ingredient is legible is the RPG layer's ruling on
          // this character's Alchemy, not a guess made here.
          const known = this.link.identify(v.uid);
          if (known.length === 0) into.appendChild(div('desc', 'You cannot tell what this does.'));
          for (const line of known) into.appendChild(div('desc', line));
        }),
      );
      r.addEventListener('pointerleave', () => this.tip.hide());
      list.appendChild(r);
    }
    left.appendChild(list);

    const right = column();
    right.style.flex = '0 0 320px';
    right.appendChild(div('ash-spec', 'Mortar'));
    const mortarBox = div();
    for (let i = 0; i < MAX_INGREDIENTS; i++) {
      const uid = this.mortar[i];
      const v = uid === undefined ? null : this.link.item(uid);
      const b = button('ash-choice', v?.name ?? '— empty —', () => {
        if (i < this.mortar.length) {
          this.mortar.splice(i, 1);
          this.refresh();
        }
      });
      mortarBox.appendChild(b);
    }
    right.appendChild(mortarBox);
    right.appendChild(rule());

    right.appendChild(div('ash-spec', 'Apparatus'));
    const app = rpg.apparatus();
    let anyApparatus = false;
    for (const key of Object.keys(app)) {
      const piece = app[key];
      if (piece != null) anyApparatus = true;
      const row = div('ash-stat');
      append(row, span('k', titleCase(key)), span('leader'), span('v', piece?.name ?? '—'));
      right.appendChild(row);
    }
    if (!anyApparatus) right.appendChild(div('ash-blurb', 'Without a mortar and pestle nothing will grind.'));

    right.appendChild(rule());
    const grind = button('ash-btn wide', 'Grind', () => this.grind());
    grind.disabled = this.mortar.length < 2;
    right.appendChild(grind);
    right.appendChild(
      div('ash-blurb', `Effects you can read: ${rpg.knownIngredientEffects} of 4.`),
    );
    append(this.content, left, right);
  }

  private grind(): void {
    const rpg = this.link.rpg;
    if (rpg === null) return;
    // brewPotion consumes the ingredients and announces the outcome itself; the
    // panel only has to stop showing a mortar that is no longer full.
    rpg.brewPotion([...this.mortar]);
    this.mortar = [];
    this.refresh();
  }

  // ----------------------------------------------------------------- bits

  /**
   * The effects this character may compose from: Morrowind's rule, that
   * spellmaking draws on the magic you already know. Sourced from the live
   * spellbook, so it cannot offer something nobody ever taught you.
   */
  private effectPicker(): HTMLElement {
    const col = column();
    col.style.flex = '0 0 280px';
    col.appendChild(div('ash-spec', 'Known effects'));
    const list = scroller();
    const known = this.link.knownEffects();
    if (known.length === 0) {
      list.appendChild(div('ash-blurb', 'You know no magic to build from. Learn a spell first.'));
    }
    for (const id of known) {
      const f = this.factsFor(id);
      const b = button('ash-choice', f.label, () => this.addEffect(f));
      b.addEventListener('pointerenter', () =>
        this.tip.show(b, (into) => {
          into.appendChild(el('h4', undefined, f.label));
          const one = this.link.priceSpell([this.blank(f)]);
          const c = div('stat');
          append(c, span(undefined, 'At these settings'), span(undefined, `${one.cost} magicka`));
          into.appendChild(c);
          into.appendChild(div('desc', one.lines[0] ?? ''));
        }),
      );
      b.addEventListener('pointerleave', () => this.tip.hide());
      list.appendChild(b);
    }
    col.appendChild(list);
    return col;
  }

  private blank(f: EffectFacts): LiveEffect {
    return {
      effect: f.id,
      magMin: f.usesMagnitude ? 10 : 0,
      magMax: f.usesMagnitude ? 10 : 0,
      duration: f.usesDuration ? 10 : 0,
      area: 0,
      // Start on Self; the range tabs are hidden for effects the RPG layer
      // normalises to self anyway.
      range: 'self',
      attribute: f.usesAttribute ? 'strength' : undefined,
      skill: f.usesSkill ? 'block' : undefined,
    };
  }

  private addEffect(f: EffectFacts): void {
    this.brew.push(this.blank(f));
    this.refresh();
  }

  private effectCard(i: number, onChange: () => void): HTMLElement {
    const inst = this.brew[i];
    const f = this.factsFor(inst.effect);
    const card = div();
    card.style.borderBottom = '1px dotted rgba(80,58,30,.34)';
    card.style.padding = '6px 0 8px';

    const head = div('ash-stat');
    append(head, span('k', f.label), span('leader'));
    const rm = button('ash-btn grim', 'Remove', () => {
      this.brew.splice(i, 1);
      this.refresh();
    });
    rm.style.padding = '2px 9px';
    head.appendChild(rm);
    card.appendChild(head);

    if (!f.selfOnly) {
      const rangeRow = div('ash-tabs');
      for (const r of RANGES) {
        const b = button('ash-tab', r.label, () => {
          inst.range = r.id;
          for (const c of rangeRow.children) c.classList.toggle('sel', c === b);
          onChange();
        });
        if (r.id === inst.range) b.classList.add('sel');
        rangeRow.appendChild(b);
      }
      card.appendChild(rangeRow);
    }

    if (f.usesAttribute) card.appendChild(this.paramPicker(inst, 'attribute', onChange));
    if (f.usesSkill) card.appendChild(this.paramPicker(inst, 'skill', onChange));

    if (f.usesMagnitude) {
      card.appendChild(
        slider('Magnitude', 1, 100, 1, inst.magMax, (v) => `${v} pts`, (v) => {
          inst.magMin = v;
          inst.magMax = v;
          onChange();
        }),
      );
    }
    if (f.usesDuration) {
      card.appendChild(
        slider('Duration', 1, 120, 1, Math.max(1, inst.duration), (v) => `${v} s`, (v) => {
          inst.duration = v;
          onChange();
        }),
      );
    }
    if (f.usesArea) {
      card.appendChild(
        slider('Area', 0, 50, 1, inst.area, (v) => (v === 0 ? 'none' : `${v} m`), (v) => {
          inst.area = v;
          onChange();
        }),
      );
    }
    return card;
  }

  private paramPicker(inst: LiveEffect, which: 'attribute' | 'skill', onChange: () => void): HTMLElement {
    const sel = el('select', 'ash-sel');
    const ids: readonly string[] = which === 'attribute' ? LIVE_ATTRIBUTES : LIVE_SKILLS;
    for (const id of ids) {
      const o = el('option', undefined, which === 'attribute' ? labelAttribute(id) : labelSkill(id));
      o.value = id;
      if (inst[which] === id) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      inst[which] = sel.value;
      onChange();
    });
    const row = div('ash-field');
    row.appendChild(el('label', undefined, which === 'attribute' ? 'Attribute' : 'Skill'));
    row.appendChild(sel);
    return row;
  }

  dispose(): void {
    this.tip.root.remove();
  }
}

function cell(label: string, value: string, cls = ''): HTMLElement {
  const c = div();
  append(c, div(`big ${cls}`, value), div('lbl', label));
  return c;
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
