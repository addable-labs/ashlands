/**
 * The heads-up display: three vessels, what is in your hands, where you are
 * facing, what is currently happening to you, and what the world just said.
 *
 * Every element here is built once and mutated in place. Rebuilding DOM at
 * frame rate is the one thing that would make a DOM interface cost more than
 * a canvas one, and it is entirely avoidable.
 */
import { append, clamp, div, el, span } from './dom';
import { prettyEffectId, type GameLink } from './live';
import type { MapNote } from './state';

const CARDINALS: readonly { readonly deg: number; readonly label: string; readonly major: boolean }[] = [
  { deg: 0, label: 'N', major: true },
  { deg: 45, label: 'NE', major: false },
  { deg: 90, label: 'E', major: true },
  { deg: 135, label: 'SE', major: false },
  { deg: 180, label: 'S', major: true },
  { deg: 225, label: 'SW', major: false },
  { deg: 270, label: 'W', major: true },
  { deg: 315, label: 'NW', major: false },
];

/** Degrees of heading visible across the compass strip. */
const ARC = 150;

/** Write only on change: an unchanged `textContent` assignment still dirties layout. */
function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/**
 * Slide one compass mark to its place on the strip, hiding it if it has fallen
 * off the visible arc. A module function rather than a closure over the frame's
 * locals, because this used to be re-created on every compass update.
 */
function place(node: HTMLElement, bearing: number, heading: number, w: number, pxPerDeg: number): void {
  let d = bearing - heading;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  if (Math.abs(d) > ARC / 2) {
    if (node.style.display !== 'none') node.style.display = 'none';
    return;
  }
  if (node.style.display !== '') node.style.display = '';
  node.style.left = `${(w / 2 + d * pxPerDeg).toFixed(1)}px`;
}

interface Vessel {
  root: HTMLDivElement;
  fluid: HTMLDivElement;
  num: HTMLSpanElement;
  shown: number;
}

interface Msg {
  node: HTMLDivElement;
  born: number;
}

/**
 * A readied weapon/spell slot with its mutable parts resolved once. Looking
 * these up with `querySelector` on every frame is the classic way to make a DOM
 * HUD expensive for no reason.
 */
interface ReadySlot {
  root: HTMLDivElement;
  glyph: HTMLDivElement;
  lbl: HTMLDivElement;
  cond: HTMLElement;
}

export class Hud {
  readonly root = div('', undefined);
  private readonly vessels: Record<'hp' | 'mp' | 'fp', Vessel>;
  private readonly weaponSlot: ReadySlot;
  private readonly spellSlot: ReadySlot;
  private readonly compass: HTMLDivElement;
  private readonly compassStrip: HTMLDivElement;
  private readonly effectsBox: HTMLDivElement;
  private readonly cross: HTMLDivElement;
  private readonly hoverLabel: HTMLDivElement;
  private readonly log: HTMLDivElement;
  private readonly subtitle: HTMLDivElement;
  private readonly msgs: Msg[] = [];
  private readonly ticks: HTMLDivElement[] = [];
  private readonly cards: HTMLDivElement[] = [];
  private readonly marks: HTMLDivElement[] = [];
  private effectNodes = new Map<string, { root: HTMLDivElement; t: HTMLSpanElement }>();
  /** Scratch set reused by `updateEffects`, which runs at frame rate. */
  private readonly seenEffects = new Set<string>();
  private subtitleUntil = 0;
  private now = 0;

  /**
   * The character's vitals, mirrored from the RPG system's `rpg:stats` event.
   * That event is the live pool including everything combat and spells have
   * done to it, and it is the only source these bars have — with no character
   * bound the vessels read empty rather than showing a plausible number.
   */
  vitals: { hp: number; maxHp: number; mp: number; maxMp: number; fp: number; maxFp: number } | null = null;

  /** Readied gear is re-read at this interval, not every frame. */
  private readyTimer = 0;

  constructor(private readonly link: GameLink, private readonly notes: readonly MapNote[]) {
    this.root.id = 'ash-hud';

    const vbox = div('ash-vessels');
    this.vessels = {
      hp: this.makeVessel('hp', 'Health'),
      mp: this.makeVessel('mp', 'Magicka'),
      fp: this.makeVessel('fp', 'Fatigue'),
    };
    append(vbox, this.vessels.hp.root, this.vessels.mp.root, this.vessels.fp.root);

    const ready = div('ash-readied');
    this.spellSlot = this.makeReady('spell');
    this.weaponSlot = this.makeReady('weapon');
    append(ready, this.spellSlot.root, this.weaponSlot.root);

    this.compass = div('ash-compass');
    this.compassStrip = div('strip');
    this.compass.appendChild(this.compassStrip);
    this.compass.appendChild(div('needle'));
    for (let i = 0; i < 24; i++) {
      const t = div('tick');
      this.ticks.push(t);
      this.compassStrip.appendChild(t);
    }
    for (const c of CARDINALS) {
      const n = div(`card${c.major ? '' : ' minor'}`, c.label);
      if (!c.major) n.style.opacity = '0.55';
      this.cards.push(n);
      this.compassStrip.appendChild(n);
    }

    this.effectsBox = div('ash-effects');

    this.cross = div('ash-cross');
    for (const c of ['n', 's', 'w', 'e']) this.cross.appendChild(el('i', c));
    this.hoverLabel = div('ash-hover');

    this.log = div('ash-log');
    this.subtitle = div('ash-subtitle');
    this.subtitle.style.display = 'none';

    const keys = div('ash-keys');
    keys.innerHTML = 'I inventory · C character · M magic · J journal · N map · Esc menu';

    append(this.root, vbox, ready, this.compass, this.effectsBox, this.cross, this.hoverLabel, this.log, this.subtitle, keys);
  }

  private makeVessel(kind: 'hp' | 'mp' | 'fp', label: string): Vessel {
    const root = div(`ash-vessel ${kind}`);
    const shell = div('shell');
    const well = div('well');
    const fluid = div('fluid');
    well.appendChild(fluid);
    const sheen = div('sheen');
    const num = span('num', '0/0');
    const tag = span('tag', label);
    append(root, shell, well, sheen, tag, num);
    return { root, fluid, num, shown: 1 };
  }

  private makeReady(kind: 'weapon' | 'spell'): ReadySlot {
    const root = div(`ash-ready ${kind}`);
    const glyph = div('glyph', kind === 'spell' ? '✦' : '⚔');
    const lbl = div('lbl', '—');
    append(root, glyph, lbl);
    const cond = div('cond');
    const bar = el('i');
    cond.appendChild(bar);
    root.appendChild(cond);
    return { root, glyph, lbl, cond: bar };
  }

  // ------------------------------------------------------------------ tick

  update(dt: number, yawRad: number, extent: number): void {
    this.now += dt;
    const v = this.vitals;
    this.updateVessel(this.vessels.hp, v?.hp ?? 0, v?.maxHp ?? 0);
    this.updateVessel(this.vessels.mp, v?.mp ?? 0, v?.maxMp ?? 0);
    this.updateVessel(this.vessels.fp, v?.fp ?? 0, v?.maxFp ?? 0);
    // Walking the pack and the effect list is a scan, not a read; four times a
    // second is indistinguishable on screen and free at frame rate.
    this.readyTimer -= dt;
    if (this.readyTimer <= 0) {
      this.readyTimer = 0.25;
      this.updateReadied();
      this.updateEffects();
    }
    this.updateCompass(yawRad, extent);
    this.expireMessages();
    if (this.subtitleUntil > 0 && this.now > this.subtitleUntil) {
      this.subtitle.style.display = 'none';
      this.subtitleUntil = 0;
    }
  }

  private updateVessel(v: Vessel, cur: number, max: number): void {
    const f = clamp(max > 0 ? cur / max : 0, 0, 1);
    if (Math.abs(f - v.shown) > 0.002) {
      v.shown = f;
      v.fluid.style.width = `${(f * 100).toFixed(1)}%`;
      v.root.classList.toggle('low', f < 0.25);
    }
    const txt = max > 0 ? `${Math.max(0, Math.round(cur))}/${Math.round(max)}` : '—';
    if (v.num.textContent !== txt) v.num.textContent = txt;
  }

  /** What is actually in the character's hands, read off the live inventory. */
  private updateReadied(): void {
    const held = this.link.worn().get('weapon') ?? null;
    const w = this.weaponSlot;
    setText(w.glyph, held?.glyph ?? '✊');
    setText(w.lbl, held === null ? 'Hand to hand' : held.name);
    const cond = `${Math.round((held === null || held.condition < 0 ? 1 : held.condition) * 100)}%`;
    if (w.cond.style.width !== cond) w.cond.style.width = cond;

    const book = this.link.character()?.spells ?? null;
    const readied = book === null || book.ready === null ? undefined : book.get(book.ready);
    const s = this.spellSlot;
    setText(s.glyph, '✧');
    setText(s.lbl, readied === undefined ? 'No spell' : `${readied.name} · ${readied.cost}`);
  }

  private updateCompass(yaw: number, extent: number): void {
    const w = this.compass.clientWidth;
    if (w <= 0) return;
    const pxPerDeg = w / ARC;
    // Yaw 0 faces -Z, which is north here; the strip slides the opposite way.
    const heading = ((-yaw * 180) / Math.PI + 360) % 360;

    for (let i = 0; i < this.ticks.length; i++) {
      const bearing = (i * 360) / this.ticks.length;
      this.ticks[i].classList.toggle('major', bearing % 90 === 0);
      place(this.ticks[i], bearing, heading, w, pxPerDeg);
    }
    for (let i = 0; i < CARDINALS.length; i++) place(this.cards[i], CARDINALS[i].deg, heading, w, pxPerDeg);

    // Player-placed map notes double as compass marks. Nobody planned that; it
    // falls out of both reading the same list, which is the point.
    const notes = this.notes;
    while (this.marks.length < notes.length) {
      const m = div('mark', '▾');
      this.marks.push(m);
      this.compassStrip.appendChild(m);
    }
    for (let i = 0; i < this.marks.length; i++) {
      if (i >= notes.length) {
        this.marks[i].style.display = 'none';
        continue;
      }
      const n = notes[i];
      const bearing = (((Math.atan2(n.x - this.playerX, -(n.z - this.playerZ)) * 180) / Math.PI) + 360) % 360;
      const far = Math.hypot(n.x - this.playerX, n.z - this.playerZ) > extent * 1.5;
      if (far) {
        this.marks[i].style.display = 'none';
        continue;
      }
      this.marks[i].title = n.text;
      place(this.marks[i], bearing, heading, w, pxPerDeg);
    }
  }

  /** Written by the UI system each frame so the compass can place map notes. */
  playerX = 0;
  playerZ = 0;

  /** What is currently working on the character — the RPG system's own list. */
  private updateEffects(): void {
    // Cleared and refilled rather than re-allocated.
    const seen = this.seenEffects;
    seen.clear();
    for (const e of this.link.character()?.active ?? []) {
      seen.add(e.effect);
      let node = this.effectNodes.get(e.effect);
      if (node === undefined) {
        const root = div('ash-eff');
        const t = span('t', '');
        append(root, span('g', '✦'), span('n', prettyEffectId(e.effect)), t);
        this.effectsBox.appendChild(root);
        node = { root, t };
        this.effectNodes.set(e.effect, node);
      }
      // Abilities and constant-effect enchantments never run out.
      if (!Number.isFinite(e.remaining)) {
        node.t.textContent = '∞';
        continue;
      }
      const s = Math.max(0, Math.ceil(e.remaining));
      node.t.textContent = s >= 60 ? `${Math.floor(s / 60)}m` : `${s}s`;
    }
    for (const [k, v] of this.effectNodes) {
      if (seen.has(k)) continue;
      v.root.remove();
      this.effectNodes.delete(k);
    }
  }

  // -------------------------------------------------------------- messages

  notify(text: string, kind: 'info' | 'warn' | 'quest' = 'info'): void {
    const node = div(`ash-msg ${kind}`, text);
    this.log.appendChild(node);
    this.msgs.push({ node, born: this.now });
    // Beyond six lines the log becomes wallpaper and stops being read.
    while (this.msgs.length > 6) {
      const old = this.msgs.shift();
      old?.node.remove();
    }
  }

  say(text: string): void {
    this.subtitle.textContent = text;
    this.subtitle.style.display = '';
    this.subtitleUntil = this.now + 3.2 + text.length * 0.035;
  }

  private expireMessages(): void {
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      const age = this.now - this.msgs[i].born;
      if (age > 7 && !this.msgs[i].node.classList.contains('fade')) this.msgs[i].node.classList.add('fade');
      if (age > 8.2) {
        this.msgs[i].node.remove();
        this.msgs.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------- interaction

  setHover(label: string | null, hostile: boolean): void {
    this.cross.classList.toggle('hot', label !== null && !hostile);
    this.cross.classList.toggle('foe', label !== null && hostile);
    this.hoverLabel.classList.toggle('on', label !== null);
    if (label !== null) this.hoverLabel.textContent = label;
  }

  setCrosshairVisible(v: boolean): void {
    this.cross.style.display = v ? '' : 'none';
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }
}
