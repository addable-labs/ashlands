/**
 * Shared chrome. Every window in the game is one `Win`: a piece of tooled hide
 * with a torn parchment sheet pinned to it at four bone studs. Building it in
 * one place is what keeps the interface reading as one artefact rather than a
 * dozen dialogs that happen to share a colour.
 */
import { append, button, clear, div, el, span } from './dom';

export interface WinOpts {
  title: string;
  /** CSS `left/top/width/height`, so callers can place windows deliberately. */
  rect: { left: string; top: string; width: string; height: string };
  sub?: string;
}

export class Win {
  readonly root: HTMLDivElement;
  readonly sheet: HTMLDivElement;
  readonly body: HTMLDivElement;
  private readonly subEl: HTMLSpanElement;

  constructor(opts: WinOpts) {
    this.root = div('ash-win ash-hide');
    Object.assign(this.root.style, opts.rect);
    for (const c of ['tl', 'tr', 'bl', 'br']) this.root.appendChild(div(`pin ${c}`));

    this.sheet = div('sheet ash-parch');
    const hdr = div('hdr');
    hdr.appendChild(el('h2', undefined, opts.title));
    this.subEl = span('sub', opts.sub ?? '');
    hdr.appendChild(this.subEl);
    this.body = div('body');
    append(this.sheet, hdr, this.body);
    this.root.appendChild(this.sheet);
  }

  set sub(v: string) {
    this.subEl.textContent = v;
  }

  /** Windows are built once and toggled; rebuilding thrashes focus and scroll. */
  setVisible(v: boolean): void {
    this.root.style.display = v ? 'flex' : 'none';
  }
}

export function column(cls = ''): HTMLDivElement {
  const d = div(cls);
  d.style.display = 'flex';
  d.style.flexDirection = 'column';
  d.style.minWidth = '0';
  d.style.minHeight = '0';
  // Windows lay their body out as a row, so a column that does not claim the
  // space collapses to its widest child — which is how full-width buttons end
  // up 110px wide. Callers that want a fixed rail override this.
  d.style.flex = '1';
  return d;
}

export function scroller(cls = ''): HTMLDivElement {
  const d = div(`scroll ${cls}`);
  d.style.flex = '1';
  d.style.minHeight = '0';
  return d;
}

export function rule(): HTMLDivElement {
  const d = div();
  d.style.height = '1px';
  d.style.margin = '9px 0';
  d.style.background = 'linear-gradient(90deg,rgba(80,58,30,0),rgba(80,58,30,.5),rgba(80,58,30,0))';
  return d;
}

export function tabs(
  items: readonly { readonly id: string; readonly label: string }[],
  onPick: (id: string) => void,
  initial?: string,
): { root: HTMLDivElement; select(id: string): void } {
  const root = div('ash-tabs');
  const btns = new Map<string, HTMLButtonElement>();
  const select = (id: string): void => {
    for (const [k, b] of btns) b.classList.toggle('sel', k === id);
    onPick(id);
  };
  for (const it of items) {
    const b = button('ash-tab', it.label, () => select(it.id));
    b.setAttribute('role', 'tab');
    btns.set(it.id, b);
    root.appendChild(b);
  }
  select(initial ?? items[0].id);
  return { root, select };
}

export function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  fmt: (v: number) => string,
  onInput: (v: number) => void,
): HTMLDivElement {
  const wrap = div('ash-field');
  wrap.appendChild(el('label', undefined, label));
  const s = div('ash-slider');
  const input = el('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.setAttribute('aria-label', label);
  const out = span('val', fmt(value));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = fmt(v);
    onInput(v);
  });
  append(s, input, out);
  wrap.appendChild(s);
  return wrap;
}

export function checkbox(label: string, value: boolean, onChange: (v: boolean) => void): HTMLButtonElement {
  const b = el('button', `ash-check${value ? ' on' : ''}`);
  b.type = 'button';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', String(value));
  const box = el('i');
  b.appendChild(box);
  b.appendChild(span(undefined, label));
  let v = value;
  b.addEventListener('click', () => {
    v = !v;
    b.classList.toggle('on', v);
    b.setAttribute('aria-checked', String(v));
    onChange(v);
  });
  return b;
}

export function field(label: string, control: HTMLElement): HTMLDivElement {
  const wrap = div('ash-field');
  wrap.appendChild(el('label', undefined, label));
  wrap.appendChild(control);
  return wrap;
}

export function statRow(k: string, v: string, cls = ''): HTMLDivElement {
  const r = div('ash-stat');
  append(r, span('k', k), span('leader'), span(`v ${cls}`, v));
  return r;
}

/**
 * One tooltip element for the whole interface, moved and refilled on hover.
 * A tooltip per row would mean thousands of nodes in a full inventory.
 */
export class Tooltip {
  readonly root = div('ash-tt');
  private timer = 0;

  attach(parent: HTMLElement): void {
    parent.appendChild(this.root);
  }

  show(anchor: HTMLElement, build: (into: HTMLElement) => void, delay = 220): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      clear(this.root);
      build(this.root);
      this.root.classList.add('on');
      this.place(anchor);
    }, delay);
  }

  hide(): void {
    clearTimeout(this.timer);
    this.root.classList.remove('on');
  }

  private place(anchor: HTMLElement): void {
    const a = anchor.getBoundingClientRect();
    const t = this.root.getBoundingClientRect();
    // Flip rather than clamp: a tooltip pinned to the viewport edge covers the
    // row it describes, which is worse than opening the other way.
    let x = a.right + 12;
    if (x + t.width > innerWidth - 8) x = a.left - t.width - 12;
    let y = a.top;
    if (y + t.height > innerHeight - 8) y = innerHeight - t.height - 8;
    this.root.style.left = `${Math.max(8, x)}px`;
    this.root.style.top = `${Math.max(8, y)}px`;
  }
}

/** Keyboard roving for a list of choices. Returns the handler to bind. */
export function rovingList(container: HTMLElement): (e: KeyboardEvent) => boolean {
  return (e: KeyboardEvent): boolean => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return false;
    const items = [...container.querySelectorAll<HTMLElement>('button:not([disabled])')];
    if (items.length === 0) return false;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next].focus();
    return true;
  };
}

/**
 * A window the UI system can push on its stack. `modal` panels release the
 * pointer lock and swallow movement keys; the HUD is not one of these.
 */
export interface Panel {
  readonly id: string;
  readonly root: HTMLElement;
  open(): void;
  close(): void;
  tick?(dt: number): void;
  onKey?(e: KeyboardEvent): boolean;
  dispose?(): void;
}
