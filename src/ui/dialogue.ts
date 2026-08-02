/**
 * Dialogue. Topics on the right, the conversation on the left, and a
 * disposition bar that is the only thing standing between you and the answer.
 *
 * Nothing on this screen is authored here. The greeting, the disposition, the
 * topics an NPC will entertain and every answer come from `quest.talk()`,
 * `quest.knownTopics()`, `quest.topicLabel()` and `quest.ask()`; persuasion
 * goes through `quest.persuade()` and its result text is printed as written.
 *
 * Topics are global knowledge, not per-conversation options: learning a word
 * from a guard means you can ask a priest about it. That is the series' whole
 * conversational model, and it is why the topic list lives in the quest layer
 * rather than on the speaker.
 */
import { append, button, clear, div, el, hash01, span } from './dom';
import { Tooltip, Win, column, rule, scroller, type Panel } from './kit';
import type { GameLink, LiveNpc } from './live';

/** The four attempts the persuasion rules accept; bribes carry an amount. */
const PERSUASION: readonly {
  readonly kind: 'admire' | 'intimidate' | 'taunt' | 'bribe';
  readonly label: string;
  readonly bribe: number;
  readonly hint: string;
}[] = [
  { kind: 'admire', label: 'Admire', bribe: 0, hint: 'Comparatively safe.' },
  { kind: 'intimidate', label: 'Intimidate', bribe: 0, hint: 'Likely to go badly if you are not very good at this.' },
  { kind: 'taunt', label: 'Taunt', bribe: 0, hint: 'Provocation. Sometimes that is the point.' },
  { kind: 'bribe', label: 'Bribe 10', bribe: 10, hint: 'Small money, small movement.' },
  { kind: 'bribe', label: 'Bribe 100', bribe: 100, hint: 'Enough to be remembered either way.' },
];

export class DialoguePanel implements Panel {
  readonly id = 'dialogue';
  readonly root: HTMLElement;
  private readonly win: Win;
  private readonly portrait = div('ash-portrait');
  private readonly dispBox = div('ash-disp');
  private readonly dispBar = el('i');
  private readonly dispNum = span(undefined, '');
  private readonly resp = scroller('ash-resp');
  private readonly topicList = scroller();
  private readonly tip = new Tooltip();
  private readonly nameEl: HTMLHeadingElement;
  private readonly titleEl: HTMLDivElement;
  /** The NPC id the quest system knows this speaker by. */
  private npc: string | null = null;
  private said = new Set<string>();

  constructor(
    private readonly link: GameLink,
    private readonly notify: (t: string, k?: 'info' | 'warn' | 'quest') => void,
    private readonly onSay: (line: string) => void,
  ) {
    this.win = new Win({
      title: 'Speaking',
      rect: { left: '50%', top: '10vh', width: 'min(880px, 72vw)', height: '72vh' },
    });
    this.win.root.style.transform = 'translateX(-50%)';
    this.root = this.win.root;

    const left = column();
    left.style.flex = '1';
    const top = div();
    top.style.display = 'flex';
    top.style.gap = '14px';
    const who = column();
    who.style.flex = '1';
    this.nameEl = el('h3');
    this.nameEl.style.margin = '0';
    this.nameEl.style.fontFamily = 'var(--uncial)';
    this.nameEl.style.letterSpacing = '.14em';
    this.titleEl = div('ash-hint');
    const bar = div('bar');
    bar.appendChild(this.dispBar);
    const lbl = div('lbl');
    append(lbl, span(undefined, 'Disposition'), this.dispNum);
    append(this.dispBox, bar, lbl);
    append(who, this.nameEl, this.titleEl, this.dispBox);
    append(top, this.portrait, who);
    left.appendChild(top);
    left.appendChild(rule());
    left.appendChild(this.resp);
    left.appendChild(this.buildPersuasion());

    const right = column('ash-topics');
    right.appendChild(div('ash-spec', 'Topics'));
    right.appendChild(this.topicList);
    append(this.win.body, left, right);
    this.tip.attach(document.body);
  }

  private buildPersuasion(): HTMLElement {
    const box = div();
    box.style.marginTop = '8px';
    box.appendChild(div('ash-spec', 'Persuasion'));
    const row = div();
    row.style.display = 'flex';
    row.style.gap = '6px';
    row.style.flexWrap = 'wrap';
    for (const p of PERSUASION) {
      const b = button('ash-btn', p.label, () => this.persuade(p.kind, p.bribe));
      b.style.padding = '4px 10px';
      b.addEventListener('pointerenter', () =>
        this.tip.show(b, (into) => {
          into.appendChild(el('h4', undefined, p.label));
          const skill = this.link.sheet()?.skills.speechcraft ?? 0;
          const c = div('stat');
          append(c, span(undefined, 'Speechcraft'), span(undefined, String(Math.round(skill))));
          into.appendChild(c);
          if (p.bribe > 0) {
            const g = div('stat');
            append(g, span(undefined, 'Costs'), span(undefined, `${p.bribe} septims`));
            into.appendChild(g);
          }
          into.appendChild(div('desc', p.hint));
        }),
      );
      b.addEventListener('pointerleave', () => this.tip.hide());
      row.appendChild(b);
    }
    box.appendChild(row);
    return box;
  }

  /** Opens a conversation with a real NPC. The greeting is the quest layer's own. */
  begin(npcId: string): void {
    const quest = this.link.quest;
    this.npc = npcId;
    this.said.clear();
    clear(this.resp);
    if (quest === null) return;
    const def = quest.npcDef(npcId);
    this.win.sub = def === undefined ? '' : `${titleCase(def.race)}${def.faction === null ? '' : ` · ${def.faction}`}`;
    const talk = quest.talk(npcId);
    this.refresh();
    this.pushLine(def?.name ?? npcId, talk.greeting);
    this.onSay(talk.greeting);
  }

  open(): void {
    this.refresh();
    this.topicList.querySelector<HTMLElement>('button')?.focus();
  }

  close(): void {
    this.tip.hide();
  }

  private refresh(): void {
    const quest = this.link.quest;
    const npcId = this.npc;
    if (quest === null || npcId === null) return;
    const def = quest.npcDef(npcId);
    this.nameEl.textContent = def?.name ?? npcId;
    this.titleEl.textContent = whereAndWhat(quest.npcLocation(npcId), def);
    this.portrait.innerHTML = portraitSvg(npcId, def?.race ?? 'dunmer');

    const d = Math.round(quest.disposition(npcId));
    this.dispBar.style.width = `${Math.max(0, Math.min(100, d))}%`;
    this.dispNum.textContent = String(d);
    this.dispBox.classList.toggle('warm', d >= 50);

    clear(this.topicList);
    // What this speaker will entertain, intersected with what the player knows —
    // both lists come from the quest layer.
    const offered = quest.talk(npcId).topics;
    if (offered.length === 0) {
      this.topicList.appendChild(div('ash-blurb', 'Nothing you know is worth asking this one.'));
    }
    for (const t of offered) {
      const fresh = !this.said.has(t);
      const b = button(`ash-topic${fresh ? ' fresh' : ' ash-said'}`, quest.topicLabel(t), () => this.ask(t));
      this.topicList.appendChild(b);
    }
  }

  private ask(topic: string): void {
    const quest = this.link.quest;
    const npcId = this.npc;
    if (quest === null || npcId === null) return;
    const answer = quest.ask(npcId, topic);
    this.said.add(topic);
    if (answer === null) {
      this.pushLine(quest.npcDef(npcId)?.name ?? npcId, 'I know nothing about that.');
      this.refresh();
      return;
    }
    this.pushLine(quest.npcDef(npcId)?.name ?? npcId, answer.text);
    this.onSay(answer.text.slice(0, 120));
    for (const t of answer.learned) this.notify(`New topic: ${quest.topicLabel(t)}`, 'quest');
    this.refresh();
  }

  private persuade(kind: 'admire' | 'intimidate' | 'taunt' | 'bribe', bribe: number): void {
    const quest = this.link.quest;
    const npcId = this.npc;
    if (quest === null || npcId === null) return;
    const gold = this.link.sheet()?.gold ?? 0;
    if (bribe > gold) {
      this.notify('You do not have it to give.', 'warn');
      return;
    }
    const res = quest.persuade(npcId, kind, bribe);
    this.pushLine('', res.text);
    if (res.attacks) this.notify('That was the wrong thing to say.', 'warn');
    this.refresh();
  }

  private pushLine(who: string, text: string): void {
    if (who !== '') this.resp.appendChild(div('who', who));
    const p = el('p', undefined, text);
    this.resp.appendChild(p);
    this.resp.scrollTop = this.resp.scrollHeight;
  }

  dispose(): void {
    this.tip.root.remove();
  }
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/** Subtitle line: where the schedule has them, and what they sell. */
function whereAndWhat(location: string, def: LiveNpc | undefined): string {
  const place = location.replace(/_/g, ' ');
  if (def === undefined) return place;
  return def.faction === null ? place : `${place} · ${def.faction}`;
}

/**
 * A portrait built from the NPC's id, so the same person always has the same
 * face. Silhouette and eye colour do the work; a detailed face at 132px would
 * read worse, not better.
 */
function portraitSvg(id: string, race: string): string {
  let seed = 0;
  for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) % 100003;
  const h = hash01(seed);
  const eyes: Readonly<Record<string, string>> = {
    dunmer: '#c8442c',
    altmer: '#c8a95e',
    bosmer: '#8fae7a',
    khajiit: '#3fd6c0',
    argonian: '#c4551f',
    orc: '#c8a95e',
  };
  const eye = eyes[race] ?? '#d8c9a4';
  const skinTable: Readonly<Record<string, string>> = {
    dunmer: '#5a4a52',
    altmer: '#c8b58e',
    bosmer: '#8a6a44',
    khajiit: '#7a5f38',
    argonian: '#4a5f4a',
    orc: '#5f6b4f',
    nord: '#b8977a',
    redguard: '#6b4a34',
    breton: '#c3a184',
    imperial: '#b3906e',
  };
  const skin = skinTable[race] ?? '#a88a68';
  const hood = h > 0.5 ? '#2c2114' : '#3a2b1d';
  return (
    `<svg viewBox="0 0 132 150" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><radialGradient id="bg" cx="50%" cy="34%" r="72%">` +
    `<stop offset="0" stop-color="#4a3826"/><stop offset="1" stop-color="#120c07"/></radialGradient></defs>` +
    `<rect width="132" height="150" fill="url(%23bg)"/>` +
    `<path d="M8 150c4-34 22-48 58-48s54 14 58 48z" fill="${hood}"/>` +
    `<ellipse cx="66" cy="66" rx="27" ry="33" fill="${skin}"/>` +
    `<path d="M66 24c-24 0-34 16-34 34 0 8 2 14 4 18-6-4-10-14-10-26 0-22 16-36 40-36s40 14 40 36c0 12-4 22-10 26 2-4 4-10 4-18 0-18-10-34-34-34z" fill="${hood}"/>` +
    `<ellipse cx="55" cy="64" rx="4.4" ry="2.8" fill="${eye}"/>` +
    `<ellipse cx="77" cy="64" rx="4.4" ry="2.8" fill="${eye}"/>` +
    `<path d="M58 86q8 5 16 0" stroke="rgba(0,0,0,.45)" stroke-width="2" fill="none"/>` +
    `<rect width="132" height="150" fill="none" stroke="rgba(0,0,0,.6)" stroke-width="2"/>` +
    `</svg>`
  ).replace(/%23/g, '#');
}
