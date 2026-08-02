/**
 * Procedural weather bed. Three filtered noise voices — a low buffet, a mid
 * hiss, and the deep roar that makes an ash storm frightening — plus a
 * high-passed rain voice. No samples: the buffer is pink noise synthesised at
 * boot and looped, and everything else is biquads and gain automation.
 *
 * Browsers refuse to start audio without a gesture, so the context is created
 * lazily on the first interaction and the whole class no-ops until then.
 */
export class WindAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private gains: GainNode[] = [];
  private sources: AudioBufferSourceNode[] = [];
  private filters: BiquadFilterNode[] = [];
  private armed = false;
  private onGesture = () => this.start();

  constructor(private enabled = true) {
    if (!enabled) return;
    addEventListener('pointerdown', this.onGesture, { once: false });
    addEventListener('keydown', this.onGesture, { once: false });
  }

  private start(): void {
    if (this.armed || !this.enabled) return;
    this.armed = true;
    removeEventListener('pointerdown', this.onGesture);
    removeEventListener('keydown', this.onGesture);
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      void ctx.resume();

      const len = ctx.sampleRate * 3;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      // Voss-McCartney-ish pink noise: white noise through a 3-pole filter.
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.0990460;
        b1 = 0.96300 * b1 + w * 0.2965164;
        b2 = 0.57000 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
      }
      // Cross-fade the seam so the loop point is inaudible.
      const fade = (ctx.sampleRate * 0.05) | 0;
      for (let i = 0; i < fade; i++) {
        const a = i / fade;
        d[i] = d[i] * a + d[len - fade + i] * (1 - a);
      }

      this.master = ctx.createGain();
      this.master.gain.value = 0.34;
      this.master.connect(ctx.destination);

      const voice = (type: BiquadFilterType, freq: number, q: number) => {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(f).connect(g).connect(this.master!);
        src.start(ctx.currentTime + Math.random() * 0.3);
        this.sources.push(src);
        this.filters.push(f);
        this.gains.push(g);
      };

      voice('lowpass', 220, 0.9); // 0 wind body
      voice('bandpass', 900, 0.7); // 1 wind hiss
      voice('lowpass', 110, 1.6); // 2 storm roar
      voice('highpass', 2000, 0.6); // 3 rain
    } catch {
      this.enabled = false;
    }
  }

  /** @param gust 0..1 buffeting envelope, drives filter sweep and level. */
  update(wind: number, roar: number, rain: number, gust: number): void {
    const ctx = this.ctx;
    if (!ctx || this.gains.length < 4) return;
    const t = ctx.currentTime;
    const set = (i: number, v: number) => this.gains[i].gain.setTargetAtTime(v, t, 0.4);
    const g = 0.6 + gust * 0.7;
    set(0, wind * 0.85 * g);
    set(1, wind * 0.30 * (0.5 + gust * 0.9));
    set(2, roar * 1.15 * (0.75 + gust * 0.5));
    set(3, rain * 0.55);
    // Sweeping the hiss with the gusts is what sells motion in the air.
    this.filters[1].frequency.setTargetAtTime(700 + gust * 900, t, 0.5);
    this.filters[2].frequency.setTargetAtTime(85 + gust * 70, t, 0.6);
  }

  dispose(): void {
    removeEventListener('pointerdown', this.onGesture);
    removeEventListener('keydown', this.onGesture);
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
    }
    for (const f of this.filters) f.disconnect();
    for (const g of this.gains) g.disconnect();
    this.master?.disconnect();
    void this.ctx?.close();
    this.ctx = null;
    this.sources = [];
    this.filters = [];
    this.gains = [];
  }
}
