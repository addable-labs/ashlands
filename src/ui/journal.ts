/**
 * Journal, faction standing, and the book-reading view.
 *
 * The journal is `quest.journal()` rendered verbatim — dated entries appended
 * in the character's own voice, never a checklist with objective markers. This
 * panel groups them by quest and prints them; it does not summarise, reorder or
 * author anything. Faction rank comes from `quest.rankName()` and the
 * requirements still outstanding from `quest.promotionBlockers()`.
 */
import { append, button, clear, div, el, reducedMotion, roman } from './dom';
import { Win, column, rule, scroller, tabs, type Panel } from './kit';
import type { GameLink, LiveJournalEntry } from './live';

const MONTHS: readonly string[] = [
  'Morning Star',
  'Sun\'s Dawn',
  'First Seed',
  'Rain\'s Hand',
  'Second Seed',
  'Mid Year',
  'Sun\'s Height',
  'Last Seed',
  'Hearthfire',
  'Frostfall',
  'Sun\'s Dusk',
  'Evening Star',
];

export function dateString(day: number, hour: number): string {
  const d = Math.max(1, Math.floor(day));
  const month = MONTHS[Math.floor((d - 1) / 30) % 12];
  const dayOfMonth = ((d - 1) % 30) + 1;
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  return `${dayOfMonth} ${month}, ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Entries for one quest, in the order the quest system wrote them. */
interface Thread {
  readonly id: string;
  readonly title: string;
  readonly entries: LiveJournalEntry[];
}

type Tab = 'quests' | 'factions' | 'topics';

export class JournalPanel implements Panel {
  readonly id = 'journal';
  readonly root: HTMLElement;
  private readonly win: Win;
  private readonly listCol = scroller();
  private readonly pageCol = scroller();
  private selected: string | null = null;
  private tab: Tab = 'quests';

  constructor(private readonly link: GameLink) {
    this.win = new Win({
      title: 'Journal',
      rect: { left: '50%', top: '6vh', width: 'min(900px, 74vw)', height: '80vh' },
    });
    this.win.root.style.transform = 'translateX(-50%)';
    this.root = this.win.root;

    const left = column();
    left.style.flex = '0 0 250px';
    const bar = tabs(
      [
        { id: 'quests', label: 'Quests' },
        { id: 'factions', label: 'Factions' },
        { id: 'topics', label: 'Topics' },
      ],
      (id) => {
        this.tab = id as Tab;
        this.selected = null;
        this.refresh();
      },
      'quests',
    );
    append(left, bar.root, this.listCol);
    this.pageCol.classList.add('ash-page');
    append(this.win.body, left, this.pageCol);
  }

  open(): void {
    this.refresh();
  }

  close(): void {
    /* nothing to tear down */
  }

  /** Groups the quest system's flat, chronological journal by quest. */
  private threads(): Thread[] {
    const byId = new Map<string, Thread>();
    for (const e of this.link.journal()) {
      const id = e.quest ?? 'loose';
      let t = byId.get(id);
      if (t === undefined) {
        t = { id, title: e.title === '' ? 'Notes' : e.title, entries: [] };
        byId.set(id, t);
      }
      t.entries.push(e);
    }
    return [...byId.values()];
  }

  refresh(): void {
    clear(this.listCol);
    clear(this.pageCol);
    if (this.link.quest === null) {
      this.win.sub = '';
      this.listCol.appendChild(div('ash-blurb', 'No world is bound to this interface.'));
      return;
    }
    if (this.tab === 'quests') this.refreshQuests();
    else if (this.tab === 'factions') this.refreshFactions();
    else this.refreshTopics();
  }

  private refreshQuests(): void {
    const threads = this.threads();
    this.win.sub = `${threads.length} threads`;
    if (this.selected === null && threads.length > 0) this.selected = threads[0].id;
    for (const t of threads) {
      const b = button(`ash-choice${t.id === this.selected ? ' sel' : ''}`, t.title, () => {
        this.selected = t.id;
        this.refresh();
      });
      this.listCol.appendChild(b);
    }
    if (threads.length === 0) {
      this.listCol.appendChild(div('ash-blurb', 'Nothing yet. You have only just been let off the boat.'));
      return;
    }

    const thread = threads.find((t) => t.id === this.selected) ?? threads[0];
    this.pageCol.appendChild(el('h3', undefined, thread.title));
    const last = thread.entries[thread.entries.length - 1];
    this.pageCol.appendChild(div('ash-hint', `Stage ${last.stage}`));
    this.pageCol.appendChild(rule());
    for (const e of thread.entries) {
      const box = div('ash-entry');
      box.appendChild(div('date', dateString(e.day, e.hour)));
      box.appendChild(el('p', undefined, e.text));
      this.pageCol.appendChild(box);
    }
  }

  private refreshFactions(): void {
    const quest = this.link.quest;
    if (quest === null) return;
    const factions = this.link.factions();
    const joined = factions.filter((f) => this.link.rankName(f.id) !== null);
    this.win.sub = `${joined.length} of ${factions.length} joined`;
    if (this.selected === null && factions.length > 0) this.selected = factions[0].id;

    for (const f of factions) {
      const rank = this.link.rankName(f.id);
      const b = button(`ash-choice${f.id === this.selected ? ' sel' : ''}`, `${f.name}${rank === null ? '' : ' ⟡'}`, () => {
        this.selected = f.id;
        this.refresh();
      });
      this.listCol.appendChild(b);
    }

    const faction = factions.find((f) => f.id === this.selected);
    if (faction === undefined) return;
    const rank = this.link.rankName(faction.id);
    this.pageCol.appendChild(el('h3', undefined, faction.name));
    this.pageCol.appendChild(div('ash-hint', rank === null ? 'Not a member' : rank));
    this.pageCol.appendChild(rule());
    this.pageCol.appendChild(div('ash-blurb', faction.blurb));
    this.pageCol.appendChild(rule());

    if (rank === null) {
      this.pageCol.appendChild(
        button('ash-btn', `Join the ${faction.name}`, () => {
          quest.join(faction.id);
          this.refresh();
        }),
      );
      return;
    }

    const blockers = quest.promotionBlockers(faction.id);
    this.pageCol.appendChild(div('ash-spec', 'Advancement'));
    if (blockers.length === 0) {
      this.pageCol.appendChild(div('ash-blurb', 'You have earned the next rank.'));
      this.pageCol.appendChild(
        button('ash-btn', 'Seek promotion', () => {
          quest.tryPromote(faction.id);
          this.refresh();
        }),
      );
    } else {
      for (const b of blockers) this.pageCol.appendChild(div('ash-blurb', b));
    }

    this.pageCol.appendChild(rule());
    this.pageCol.appendChild(div('ash-spec', 'Ranks'));
    for (let i = 0; i < faction.ranks.length; i++) {
      const r = faction.ranks[i];
      this.pageCol.appendChild(div(r.name === rank ? 'ash-blurb' : 'ash-hint', `${roman(i + 1)} · ${r.name}`));
    }
  }

  private refreshTopics(): void {
    const topics = this.link.knownTopics();
    this.win.sub = `${topics.length} known`;
    this.listCol.appendChild(div('ash-spec', 'Known topics'));
    for (const t of topics) this.listCol.appendChild(div('ash-blurb', this.link.topicLabel(t)));
    if (topics.length === 0) this.listCol.appendChild(div('ash-blurb', 'Nobody has told you anything yet.'));
    this.pageCol.appendChild(
      div('ash-blurb', 'Topics are what you know to ask about, not what any one person will answer. Learn a word from a guard and a priest can be asked the same thing.'),
    );
  }
}

/**
 * Book view. Two columns of justified text with a drop capital, and a real
 * page turn — the animation is what sells the object; without it a book is a
 * modal with serif text in it. The text is the item definition's own; the panel
 * paginates it and nothing more.
 */
export class BookPanel implements Panel {
  readonly id = 'book';
  readonly root: HTMLElement;
  private readonly win: Win;
  private readonly page = div('ash-page two');
  private readonly folio = div('ash-folio');
  private pages: readonly string[] = [];
  private index = 0;
  private title = '';

  constructor(private readonly onClose: () => void) {
    this.win = new Win({
      title: 'Reading',
      rect: { left: '50%', top: '8vh', width: 'min(820px, 66vw)', height: '76vh' },
    });
    this.win.root.style.transform = 'translateX(-50%)';
    this.root = this.win.root;
    const col = column();
    col.style.flex = '1';
    const scroll = scroller();
    scroll.appendChild(this.page);
    append(col, scroll, this.folio);
    this.win.body.appendChild(col);
  }

  /** Text comes from the real book item; blank text says so rather than inventing prose. */
  show(title: string, text: string): void {
    this.title = title;
    this.pages = paginate(text);
    this.index = 0;
    this.render();
  }

  open(): void {
    this.render();
  }

  close(): void {
    /* nothing to tear down */
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      this.turn(1);
      return true;
    }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      this.turn(-1);
      return true;
    }
    return false;
  }

  private turn(d: number): void {
    const next = this.index + d;
    if (next < 0 || next >= this.pages.length) {
      if (next >= this.pages.length) this.onClose();
      return;
    }
    this.index = next;
    this.render(d);
  }

  private render(dir = 0): void {
    this.win.sub = this.title;
    clear(this.page);
    const p = el('p', this.index === 0 ? 'drop' : undefined);
    p.textContent = this.pages[this.index] ?? '';
    this.page.appendChild(p);
    if (dir !== 0 && !reducedMotion()) {
      this.page.classList.remove('ash-turn');
      // Forcing layout is what makes the class re-trigger the animation.
      void this.page.offsetWidth;
      this.page.classList.add('ash-turn');
    }

    clear(this.folio);
    const prev = button('ash-btn', '‹ Back', () => this.turn(-1));
    prev.disabled = this.index === 0;
    const next = button('ash-btn', this.index >= this.pages.length - 1 ? 'Close ›' : 'Onward ›', () => this.turn(1));
    append(this.folio, prev, div('', `— ${roman(this.index + 1)} —`), next);
  }
}

/** Splits a book's text into pages on paragraph boundaries. */
const CHARS_PER_PAGE = 900;

function paginate(text: string): readonly string[] {
  const body = text.trim();
  if (body === '') return ['The pages are water-damaged past reading.'];
  const paras = body.split(/\n\s*\n/);
  const pages: string[] = [];
  let current = '';
  for (const para of paras) {
    if (current !== '' && current.length + para.length > CHARS_PER_PAGE) {
      pages.push(current);
      current = '';
    }
    current = current === '' ? para : `${current}\n\n${para}`;
  }
  if (current !== '') pages.push(current);
  return pages;
}
