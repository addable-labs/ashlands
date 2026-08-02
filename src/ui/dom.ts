/**
 * Minimal DOM helpers. The UI is DOM/CSS rather than canvas-drawn because text
 * rendered by the browser is subpixel-sharp at any DPR and reflows for free;
 * canvas glyphs at 1080p on a Retina panel look like a 2002 screenshot.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls !== undefined) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function div(cls?: string, text?: string): HTMLDivElement {
  return el('div', cls, text);
}

export function span(cls?: string, text?: string): HTMLSpanElement {
  return el('span', cls, text);
}

/** Button that is keyboard reachable by construction — never a clickable div. */
export function button(cls: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

export function append(parent: Node, ...kids: Node[]): Node {
  for (const k of kids) parent.appendChild(k);
  return parent;
}

export function clear(n: Node): void {
  while (n.firstChild !== null) n.removeChild(n.firstChild);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Roman numerals for level plates and page numbers — the world does not use Arabic. */
const ROMAN: readonly [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

export function roman(n: number): string {
  let v = Math.max(0, Math.floor(n));
  if (v === 0) return '—';
  let out = '';
  for (const [k, s] of ROMAN) {
    while (v >= k) {
      out += s;
      v -= k;
    }
  }
  return out;
}

export function weightStr(w: number): string {
  return w >= 10 ? w.toFixed(0) : w.toFixed(1);
}

export function coins(v: number): string {
  return v.toLocaleString('en-GB');
}

export function reducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Deterministic 0..1 hash. Used for stains and wear so a panel looks the same every open. */
export function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
