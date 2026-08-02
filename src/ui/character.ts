/**
 * Character sheet and the level-up rite.
 *
 * Every figure here is the RPG system's: attributes and all twenty-seven skills
 * come from `rpg.stats()`, class membership and banked practice from the live
 * character. The sheet exists to make "skills improve by use" legible, which it
 * can only do if the numbers are the ones the simulation is actually using.
 */
import { append, button, clear, coins, div, el, roman, span } from './dom';
import { Tooltip, Win, column, rule, scroller, statRow, type Panel } from './kit';
import {
  ATTRIBUTE_LABELS,
  LIVE_ATTRIBUTES,
  LIVE_SKILLS,
  SKILL_LABELS,
  prettyEffectId,
  type GameLink,
  type LiveAttributeId,
  type LiveSpec,
} from './live';

const SPECS: readonly { readonly id: LiveSpec; readonly name: string }[] = [
  { id: 'combat', name: 'Combat' },
  { id: 'magic', name: 'Magic' },
  { id: 'stealth', name: 'Stealth' },
];

/** Ten major/minor skill-ups is a level; mirrors LEVEL_UP_SKILL_COUNT. */
const LEVEL_BAR = 10;

export class CharacterPanel implements Panel {
  readonly id = 'character';
  readonly root: HTMLElement;
  private readonly win: Win;
  private readonly leftCol = column();
  private readonly rightCol = scroller();
  private readonly tip = new Tooltip();

  constructor(private readonly link: GameLink) {
    this.win = new Win({
      title: 'Character',
      rect: { left: '50%', top: '6vh', width: 'min(880px, 72vw)', height: '80vh' },
    });
    this.win.root.style.transform = 'translateX(-50%)';
    this.root = this.win.root;
    this.leftCol.style.flex = '0 0 320px';
    append(this.win.body, this.leftCol, this.rightCol);
    this.tip.attach(document.body);
  }

  open(): void {
    this.refresh();
  }

  close(): void {
    this.tip.hide();
  }

  refresh(): void {
    clear(this.leftCol);
    clear(this.rightCol);

    const sheet = this.link.sheet();
    const character = this.link.character();
    if (sheet === null || character === null) {
      this.win.sub = '';
      this.leftCol.appendChild(div('ash-blurb', 'No character is bound to this interface.'));
      return;
    }

    this.win.sub = `Level ${roman(sheet.level)} · ${coins(sheet.gold)} septims`;

    const head = div();
    const name = el('h3', undefined, sheet.name);
    name.style.fontFamily = 'var(--uncial)';
    name.style.margin = '0 0 2px';
    name.style.letterSpacing = '.14em';
    head.appendChild(name);
    head.appendChild(div('ash-hint', `${titleCase(sheet.race)} · ${sheet.className} · ${titleCase(sheet.birthsign)}`));
    this.leftCol.appendChild(head);
    this.leftCol.appendChild(rule());

    this.leftCol.appendChild(div('ash-spec', 'Attributes'));
    for (const a of LIVE_ATTRIBUTES) {
      const r = statRow(ATTRIBUTE_LABELS[a], String(Math.round(sheet.attributes[a])));
      r.tabIndex = 0;
      r.addEventListener('pointerenter', () =>
        this.tip.show(r, (into) => {
          into.appendChild(el('h4', undefined, ATTRIBUTE_LABELS[a]));
          const offer = character.levelUpOffers().find((o) => o.attribute === a);
          const g = div('stat');
          append(g, span(undefined, 'Exercised since level'), span(undefined, String(offer?.gains ?? 0)));
          into.appendChild(g);
          const m = div('stat');
          append(m, span(undefined, 'Next level would give'), span(undefined, `×${offer?.multiplier ?? 1}`));
          into.appendChild(m);
        }),
      );
      r.addEventListener('pointerleave', () => this.tip.hide());
      this.leftCol.appendChild(r);
    }

    this.leftCol.appendChild(rule());
    this.leftCol.appendChild(div('ash-spec', 'Condition'));
    this.leftCol.appendChild(statRow('Health', `${Math.round(sheet.health)} / ${Math.round(sheet.maxHealth)}`));
    this.leftCol.appendChild(statRow('Magicka', `${Math.round(sheet.magicka)} / ${Math.round(sheet.maxMagicka)}`));
    this.leftCol.appendChild(statRow('Fatigue', `${Math.round(sheet.fatigue)} / ${Math.round(sheet.maxFatigue)}`));
    this.leftCol.appendChild(
      statRow('Encumbrance', `${Math.round(sheet.encumbrance)} / ${Math.round(sheet.capacity)}`),
    );
    this.leftCol.appendChild(statRow('Armour rating', String(Math.round(sheet.armorRating))));
    this.leftCol.appendChild(statRow('Progress to level', `${sheet.levelProgress} / ${LEVEL_BAR}`));
    this.leftCol.appendChild(statRow('Readied spell', sheet.readySpell ?? '—'));

    this.leftCol.appendChild(rule());
    this.leftCol.appendChild(div('ash-spec', 'Standing effects'));
    const active = character.active;
    if (active.length === 0) {
      this.leftCol.appendChild(div('ash-blurb', 'Nothing is working on you.'));
    }
    for (const e of active) {
      const forever = !Number.isFinite(e.remaining);
      this.leftCol.appendChild(
        statRow(
          prettyEffectId(e.effect),
          forever ? `${Math.round(e.magnitude)} pts` : `${Math.round(e.magnitude)} pts · ${Math.ceil(e.remaining)}s`,
        ),
      );
    }

    const klass = character.klass;
    for (const spec of SPECS) {
      this.rightCol.appendChild(div('ash-spec', `${spec.name}${klass.spec === spec.id ? ' — specialised' : ''}`));
      for (const id of LIVE_SKILLS) {
        const label = SKILL_LABELS[id];
        if (label.spec !== spec.id) continue;
        const kind = character.classOf(id);
        const row = div('ash-skill');
        const line = div('line');
        append(
          line,
          span(`k${kind === 'major' ? ' major' : kind === 'minor' ? ' minor' : ''}`, label.name),
          span('leader'),
          span('v', String(Math.round(sheet.skills[id]))),
        );
        const fraction = this.link.skillProgress(id);
        const prog = div('prog');
        const fill = el('i');
        fill.style.width = `${Math.round(fraction * 100)}%`;
        prog.appendChild(fill);
        append(row, line, prog);
        row.tabIndex = 0;
        row.addEventListener('pointerenter', () =>
          this.tip.show(row, (into) => {
            into.appendChild(el('h4', undefined, label.name));
            const g = div('stat');
            append(g, span(undefined, 'Governed by'), span(undefined, ATTRIBUTE_LABELS[label.attribute]));
            into.appendChild(g);
            const c = div('stat');
            append(
              c,
              span(undefined, 'Class'),
              span(undefined, kind === 'major' ? 'Major' : kind === 'minor' ? 'Minor' : 'Miscellaneous'),
            );
            into.appendChild(c);
            const p = div('stat');
            append(p, span(undefined, 'Toward next point'), span(undefined, `${Math.round(fraction * 100)}%`));
            into.appendChild(p);
          }),
        );
        row.addEventListener('pointerleave', () => this.tip.hide());
        this.rightCol.appendChild(row);
      }
    }
  }

  dispose(): void {
    this.tip.root.remove();
  }
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/**
 * The level-up modal. Morrowind's multiplier rule verbatim: how hard you leaned
 * on an attribute's skills between levels decides how much it can rise now. The
 * multipliers are the character's own `levelUpOffers()`, and accepting calls the
 * RPG system's `levelUp` — this screen never raises an attribute itself.
 */
export class LevelUpPanel implements Panel {
  readonly id = 'levelup';
  readonly root: HTMLElement;
  private readonly win: Win;
  private readonly listBox = div();
  private readonly confirm: HTMLButtonElement;
  private chosen: LiveAttributeId[] = [];

  constructor(private readonly link: GameLink, private readonly onDone: () => void) {
    this.win = new Win({
      title: 'You have grown',
      rect: { left: '50%', top: '12vh', width: 'min(560px, 54vw)', height: 'auto' },
      sub: 'Choose three',
    });
    this.win.root.style.transform = 'translateX(-50%)';
    this.root = this.win.root;
    const col = column();
    col.appendChild(
      div(
        'ash-blurb',
        'Sleep brings the change, and the change is shaped by what you spent the last stretch of road doing. Raise three.',
      ),
    );
    col.appendChild(rule());
    col.appendChild(this.listBox);
    this.confirm = button('ash-btn wide', 'Accept', () => this.accept());
    col.appendChild(rule());
    col.appendChild(this.confirm);
    this.win.body.appendChild(col);
  }

  open(): void {
    this.chosen = [];
    this.refresh();
  }

  close(): void {
    /* nothing to tear down */
  }

  private refresh(): void {
    clear(this.listBox);
    const sheet = this.link.sheet();
    const character = this.link.character();
    if (sheet === null || character === null) {
      this.listBox.appendChild(div('ash-blurb', 'No character is bound to this interface.'));
      this.confirm.disabled = true;
      return;
    }
    const offers = new Map(character.levelUpOffers().map((o) => [o.attribute, o.multiplier]));
    for (const a of LIVE_ATTRIBUTES) {
      const mult = offers.get(a) ?? 1;
      const now = Math.round(sheet.attributes[a]);
      const picked = this.chosen.includes(a);
      const row = div('ash-stat');
      row.style.padding = '3px 0';
      const b = button(`ash-choice${picked ? ' sel' : ''}`, '', () => this.toggle(a));
      b.style.display = 'flex';
      b.style.alignItems = 'baseline';
      b.style.gap = '8px';
      append(
        b,
        span('k', ATTRIBUTE_LABELS[a]),
        span('leader'),
        span('v', `${now} → ${Math.min(100, now + mult)}`),
        span('ash-hint', `×${mult}`),
      );
      row.appendChild(b);
      this.listBox.appendChild(row);
    }
    this.confirm.disabled = this.chosen.length !== 3;
    this.win.sub = `${this.chosen.length} of 3 chosen`;
  }

  private toggle(a: LiveAttributeId): void {
    const i = this.chosen.indexOf(a);
    if (i >= 0) this.chosen.splice(i, 1);
    else if (this.chosen.length < 3) this.chosen.push(a);
    this.refresh();
  }

  private accept(): void {
    if (this.chosen.length !== 3) return;
    this.link.rpg?.levelUp(this.chosen);
    this.onDone();
  }
}
