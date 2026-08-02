/**
 * Small deterministic PRNG. Loot, potion strength and enchantment rolls all
 * draw from a seeded stream that is part of the save file, so reloading does
 * not let you re-roll the same chest until it gives you daedric.
 */
export class Rng {
  private s: number;

  constructor(seed = 0x9e3779b9) {
    this.s = seed >>> 0 || 1;
  }

  /** xorshift32 — cheap, adequate, and reproducible across platforms. */
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x / 0x100000000;
  }

  int(n: number): number {
    return n <= 0 ? 0 : Math.floor(this.next() * n) % n;
  }

  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  /** Inclusive integer range, the shape damage rolls want. */
  rangeInt(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  get state(): number {
    return this.s;
  }

  set state(v: number) {
    this.s = v >>> 0 || 1;
  }
}
