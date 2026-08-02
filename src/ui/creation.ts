/**
 * Character creation. Race, class, birthsign, face.
 *
 * The panel holds only the choices. Every time one changes it calls the RPG
 * system's `recreate`, so the character being previewed on the right *is* the
 * character — the attributes, the skills and the starting kit shown are the
 * ones the game will hand you, not a second calculation of them that could
 * disagree. The custom-class editor builds through `buildClass`, which is the
 * same validator the rest of the game uses.
 *
 * The custom-class editor is not an afterthought here: picking your own
 * specialisation, two favoured attributes and ten skills is the first systemic
 * decision the series lets you make, and it is the one that decides what the
 * next forty hours feel like.
 */
import { BIRTHSIGN_BLURBS, RACE_BLURBS } from './flavour';
import { append, button, clear, div, el, span } from './dom';
import { Win, column, field, rule, scroller, slider, type Panel } from './kit';
import {
  ATTRIBUTE_LABELS,
  LIVE_ATTRIBUTES,
  LIVE_BIRTHSIGNS,
  LIVE_CLASSES,
  LIVE_RACES,
  LIVE_SKILLS,
  SKILL_LABELS,
  prettyEffectId,
  type GameLink,
  type LiveAttributeId,
  type LiveClass,
  type LiveSkillId,
  type LiveSpec,
} from './live';
import type { GameState } from './state';

type Step = 'who' | 'class' | 'sign' | 'face';

const STEPS: readonly { readonly id: Step; readonly label: string }[] = [
  { id: 'who', label: 'Name & Blood' },
  { id: 'class', label: 'Calling' },
  { id: 'sign', label: 'Birthsign' },
  { id: 'face', label: 'Face' },
];

const SPECS: readonly { readonly id: LiveSpec; readonly name: string }[] = [
  { id: 'combat', name: 'Combat' },
  { id: 'magic', name: 'Magic' },
  { id: 'stealth', name: 'Stealth' },
];

/** Five of each, as the class validator requires. */
const CLASS_SKILL_COUNT = 5;

/**
 * Flavour text for the races and constellations, keyed by the RPG layer's own
 * ids. The interface keeps these because the RPG system publishes no prose for
 * them; every *number* on this screen comes from the live character. An id with
 * no entry falls back to its own name rather than borrowing someone else's.
 */
function raceBlurb(id: string): { name: string; desc: string } {
  const row = RACE_BLURBS.find((r) => r.id === id);
  return { name: row?.name ?? titleCase(id), desc: row?.desc ?? '' };
}

function signBlurb(id: string): { name: string; desc: string } {
  const row = BIRTHSIGN_BLURBS.find((b) => b.id === id);
  return { name: row?.name ?? `The ${titleCase(id)}`, desc: row?.desc ?? '' };
}

export class CreationPanel implements Panel {
  readonly id = 'creation';
  readonly root: HTMLElement;
  private readonly win: Win;
  private readonly content = div();
  private readonly footer = div();
  private step: Step = 'who';
  /** Appearance is cosmetic and lives on the panel; the RPG layer has no face. */
  private skin = 0.5;
  private hair = 0.4;
  private age = 0.35;

  private name = 'Nerevarine';
  private gender: 'male' | 'female' = 'male';
  private race: string = LIVE_RACES[4];
  private sign: string = LIVE_BIRTHSIGNS[8];
  private klass: string = LIVE_CLASSES[0];
  private useCustom = false;
  private customName = 'Adventurer';
  private customSpec: LiveSpec = 'combat';
  private customFavored: [LiveAttributeId, LiveAttributeId] = ['strength', 'endurance'];
  private customMajor: LiveSkillId[] = ['longBlade', 'block', 'heavyArmor', 'athletics', 'armorer'];
  private customMinor: LiveSkillId[] = ['mediumArmor', 'bluntWeapon', 'restoration', 'alchemy', 'mercantile'];

  constructor(
    private readonly link: GameLink,
    private readonly state: GameState,
    private readonly onDone: () => void,
  ) {
    this.win = new Win({
      title: 'Who are you',
      rect: { left: '50%', top: '6vh', width: 'min(920px, 76vw)', height: '82vh' },
    });
    this.win.root.style.transform = 'translateX(-50%)';
    this.root = this.win.root;
    const col = column();
    col.style.flex = '1';
    const bar = div('ash-tabs');
    for (const s of STEPS) {
      const b = button('ash-tab', s.label, () => {
        this.step = s.id;
        for (const c of bar.children) c.classList.toggle('sel', c === b);
        this.refresh();
      });
      if (s.id === this.step) b.classList.add('sel');
      bar.appendChild(b);
    }
    this.content.style.flex = '1';
    this.content.style.minHeight = '0';
    this.content.style.display = 'flex';
    this.content.style.gap = '16px';
    this.footer.style.display = 'flex';
    this.footer.style.gap = '8px';
    this.footer.style.marginTop = '10px';
    append(col, bar, this.content, this.footer);
    this.win.body.appendChild(col);
  }

  open(): void {
    // Adopt whoever is already alive, so opening the screen does not silently
    // discard the character the player is standing in.
    const sheet = this.link.sheet();
    if (sheet !== null) {
      this.name = sheet.name;
      this.gender = sheet.gender === 'female' ? 'female' : 'male';
      this.race = sheet.race;
      this.sign = sheet.birthsign;
    }
    this.refresh();
  }

  close(): void {
    /* nothing to tear down */
  }

  /**
   * Rebuild the real character from the current choices. Doing this on every
   * change is what makes the preview truthful: there is only one character and
   * the panel is looking straight at it.
   */
  private apply(): void {
    const rpg = this.link.rpg;
    if (rpg === null) return;
    let klass: LiveClass | string = this.klass;
    if (this.useCustom) {
      const built = rpg.buildClass(
        this.customName.trim() === '' ? 'Adventurer' : this.customName.trim(),
        this.customSpec,
        this.customFavored,
        this.customMajor,
        this.customMinor,
      );
      // A rejected custom class keeps the last valid one; the RPG layer has
      // already said why on the bus.
      if (built === null) return;
      klass = built;
    }
    rpg.recreate(this.name, this.race, this.gender, this.sign, klass);
  }

  private refresh(): void {
    clear(this.content);
    const build: Readonly<Record<Step, () => void>> = {
      who: () => this.buildWho(),
      class: () => this.buildCalling(),
      sign: () => this.buildSign(),
      face: () => this.buildFace(),
    };
    build[this.step]();

    clear(this.footer);
    const i = STEPS.findIndex((s) => s.id === this.step);
    const back = button('ash-btn grim', '‹ Back', () => {
      this.step = STEPS[Math.max(0, i - 1)].id;
      this.syncTabs();
      this.refresh();
    });
    back.disabled = i === 0;
    const next =
      i === STEPS.length - 1
        ? button('ash-btn', 'Step ashore', () => this.finish())
        : button('ash-btn', 'Onward ›', () => {
            this.step = STEPS[i + 1].id;
            this.syncTabs();
            this.refresh();
          });
    append(this.footer, back, next);
    const character = this.link.character();
    this.win.sub = `${raceBlurb(this.race).name} · ${character?.klass.name ?? titleCase(this.klass)} · ${signBlurb(this.sign).name}`;
  }

  private syncTabs(): void {
    const bar = this.win.body.querySelector('.ash-tabs');
    if (bar === null) return;
    const i = STEPS.findIndex((s) => s.id === this.step);
    for (let k = 0; k < bar.children.length; k++) bar.children[k].classList.toggle('sel', k === i);
  }

  // ------------------------------------------------------------------ who

  private buildWho(): void {
    const left = column();
    left.style.flex = '0 0 260px';
    const nameInput = el('input', 'ash-input');
    nameInput.value = this.name;
    nameInput.addEventListener('input', () => {
      this.name = nameInput.value;
      this.apply();
    });
    left.appendChild(field('Name', nameInput));

    const sexBox = div('ash-tabs');
    for (const s of ['male', 'female'] as const) {
      const b = button('ash-tab', s, () => {
        this.gender = s;
        for (const c of sexBox.children) c.classList.toggle('sel', c === b);
        this.apply();
        this.refresh();
      });
      if (this.gender === s) b.classList.add('sel');
      sexBox.appendChild(b);
    }
    left.appendChild(field('Sex', sexBox));
    left.appendChild(rule());
    left.appendChild(div('ash-spec', 'Blood'));
    const list = scroller();
    for (const id of LIVE_RACES) {
      const b = button(`ash-choice${id === this.race ? ' sel' : ''}`, raceBlurb(id).name, () => {
        this.race = id;
        this.apply();
        this.refresh();
      });
      list.appendChild(b);
    }
    left.appendChild(list);

    const right = column();
    right.style.flex = '1';
    const blurb = raceBlurb(this.race);
    right.appendChild(div('ash-spec', blurb.name));
    if (blurb.desc !== '') right.appendChild(div('ash-blurb', blurb.desc));
    right.appendChild(rule());
    right.appendChild(div('ash-spec', 'Attributes'));
    const sheet = this.link.sheet();
    const grid = div('ash-cols2');
    for (const a of LIVE_ATTRIBUTES) {
      const r = div('ash-stat');
      append(
        r,
        span('k', ATTRIBUTE_LABELS[a]),
        span('leader'),
        span('v', sheet === null ? '—' : String(Math.round(sheet.attributes[a]))),
      );
      grid.appendChild(r);
    }
    right.appendChild(grid);
    right.appendChild(rule());
    right.appendChild(div('ash-spec', 'Condition'));
    if (sheet === null) {
      right.appendChild(div('ash-blurb', 'No character is bound to this interface.'));
    } else {
      const rows: readonly [string, string][] = [
        ['Health', String(Math.round(sheet.maxHealth))],
        ['Magicka', String(Math.round(sheet.maxMagicka))],
        ['Fatigue', String(Math.round(sheet.maxFatigue))],
      ];
      for (const [k, v] of rows) {
        const r = div('ash-stat');
        append(r, span('k', k), span('leader'), span('v', v));
        right.appendChild(r);
      }
    }
    append(this.content, left, right);
  }

  // ---------------------------------------------------------------- class

  private buildCalling(): void {
    const left = column();
    left.style.flex = '0 0 240px';
    const modeBox = div('ash-tabs');
    for (const m of [
      { id: false, label: 'Preset' },
      { id: true, label: 'Own devising' },
    ]) {
      const b = button('ash-tab', m.label, () => {
        this.useCustom = m.id;
        for (const c of modeBox.children) c.classList.toggle('sel', c === b);
        this.apply();
        this.refresh();
      });
      if (this.useCustom === m.id) b.classList.add('sel');
      modeBox.appendChild(b);
    }
    left.appendChild(modeBox);
    const list = scroller();
    if (!this.useCustom) {
      for (const id of LIVE_CLASSES) {
        const b = button(`ash-choice${id === this.klass ? ' sel' : ''}`, titleCase(id), () => {
          this.klass = id;
          this.apply();
          this.refresh();
        });
        list.appendChild(b);
      }
    } else {
      const nameInput = el('input', 'ash-input');
      nameInput.value = this.customName;
      nameInput.addEventListener('input', () => {
        this.customName = nameInput.value;
        this.apply();
      });
      list.appendChild(field('Calling', nameInput));
      const specBox = div('ash-tabs');
      for (const s of SPECS) {
        const b = button('ash-tab', s.name, () => {
          this.customSpec = s.id;
          for (const c of specBox.children) c.classList.toggle('sel', c === b);
          this.apply();
          this.refresh();
        });
        if (this.customSpec === s.id) b.classList.add('sel');
        specBox.appendChild(b);
      }
      list.appendChild(field('Specialise', specBox));
      list.appendChild(rule());
      list.appendChild(div('ash-spec', 'Favoured attributes'));
      for (const a of LIVE_ATTRIBUTES) {
        const on = this.customFavored.includes(a);
        const b = button(`ash-choice${on ? ' sel' : ''}`, ATTRIBUTE_LABELS[a], () => {
          if (on) return;
          this.customFavored = [this.customFavored[1], a];
          this.apply();
          this.refresh();
        });
        list.appendChild(b);
      }
    }
    left.appendChild(list);

    const right = column();
    right.style.flex = '1';
    // The class shown is the one the character is actually carrying, blurb and
    // skill lists included, so a preset's contents are never paraphrased here.
    const character = this.link.character();
    const live = character?.klass ?? null;
    right.appendChild(div('ash-spec', live?.name ?? titleCase(this.klass)));
    if (live !== null && live.blurb !== '') right.appendChild(div('ash-blurb', live.blurb));
    right.appendChild(rule());
    right.appendChild(div('ash-spec', `Specialisation — ${live?.spec ?? this.customSpec}`));
    const major = new Set<string>(live?.major ?? this.customMajor);
    const minor = new Set<string>(live?.minor ?? this.customMinor);
    const skillsBox = scroller();
    for (const spec of SPECS) {
      skillsBox.appendChild(div('ash-spec', spec.name));
      for (const id of LIVE_SKILLS) {
        const label = SKILL_LABELS[id];
        if (label.spec !== spec.id) continue;
        const isMajor = major.has(id);
        const isMinor = minor.has(id);
        const tag = isMajor ? 'Major' : isMinor ? 'Minor' : '';
        const row = div('ash-stat');
        if (!this.useCustom) {
          append(
            row,
            span(`k${isMajor ? ' major' : isMinor ? ' minor' : ''}`, label.name),
            span('leader'),
            span('v', tag),
          );
        } else {
          const b = button(`ash-choice${isMajor ? ' sel' : ''}`, `${label.name}${tag === '' ? '' : ` — ${tag}`}`, () => {
            this.cycleSkill(id);
            this.refresh();
          });
          b.style.flex = '1';
          row.appendChild(b);
        }
        skillsBox.appendChild(row);
      }
    }
    right.appendChild(skillsBox);
    append(this.content, left, right);
  }

  /** Miscellaneous → major → minor → miscellaneous, respecting the five-each cap. */
  private cycleSkill(id: LiveSkillId): void {
    const major = [...this.customMajor];
    const minor = [...this.customMinor];
    const mi = major.indexOf(id);
    const ni = minor.indexOf(id);
    if (mi >= 0) {
      major.splice(mi, 1);
      if (minor.length < CLASS_SKILL_COUNT) minor.push(id);
    } else if (ni >= 0) {
      minor.splice(ni, 1);
    } else if (major.length < CLASS_SKILL_COUNT) {
      major.push(id);
    } else if (minor.length < CLASS_SKILL_COUNT) {
      minor.push(id);
    }
    this.customMajor = major;
    this.customMinor = minor;
    this.apply();
  }

  // ----------------------------------------------------------------- sign

  private buildSign(): void {
    const left = column();
    left.style.flex = '0 0 240px';
    const list = scroller();
    for (const id of LIVE_BIRTHSIGNS) {
      const btn = button(`ash-choice${id === this.sign ? ' sel' : ''}`, signBlurb(id).name, () => {
        this.sign = id;
        this.apply();
        this.refresh();
      });
      list.appendChild(btn);
    }
    left.appendChild(list);

    const right = column();
    right.style.flex = '1';
    const sign = signBlurb(this.sign);
    right.appendChild(div('ash-spec', sign.name));
    if (sign.desc !== '') right.appendChild(div('ash-blurb', sign.desc));
    right.appendChild(rule());
    right.appendChild(div('ash-spec', 'Standing effects'));
    // What the sign actually grants: the abilities it put on the character.
    const active = this.link.character()?.active ?? [];
    if (active.length === 0) right.appendChild(div('ash-blurb', 'Nothing that shows on the sheet.'));
    for (const e of active) {
      const r = div('ash-stat');
      append(r, span('k', prettyEffectId(e.effect)), span('leader'), span('v', `${Math.round(e.magnitude)}`));
      right.appendChild(r);
    }
    right.appendChild(rule());
    const sheet = this.link.sheet();
    right.appendChild(
      div('ash-blurb', `Magicka under this sign: ${sheet === null ? '—' : Math.round(sheet.maxMagicka)}`),
    );
    append(this.content, left, right);
  }

  // ----------------------------------------------------------------- face

  private buildFace(): void {
    const left = column();
    left.style.flex = '0 0 300px';
    const view = div();
    view.style.height = '260px';
    view.style.border = '1px solid #2b2013';
    view.style.background = 'linear-gradient(180deg,#3a2b1c,#120c07)';
    const draw = (): void => {
      view.innerHTML = faceSvg(this.race, this.gender, this.skin, this.hair, this.age);
    };
    draw();
    left.appendChild(view);

    const right = column();
    right.style.flex = '1';
    right.appendChild(div('ash-spec', 'Aspect'));
    right.appendChild(
      slider('Complexion', 0, 1, 0.01, this.skin, (v) => v.toFixed(2), (v) => {
        this.skin = v;
        draw();
      }),
    );
    right.appendChild(
      slider('Hair', 0, 1, 0.01, this.hair, (v) => v.toFixed(2), (v) => {
        this.hair = v;
        draw();
      }),
    );
    right.appendChild(
      slider('Years', 0, 1, 0.01, this.age, (v) => `${Math.round(18 + v * 60)}`, (v) => {
        this.age = v;
        draw();
      }),
    );
    right.appendChild(rule());
    right.appendChild(
      div(
        'ash-blurb',
        'They will not remember your face. They will remember that you walked into Red Mountain and came out again, or that you did not.',
      ),
    );
    append(this.content, left, right);
  }

  private finish(): void {
    this.apply();
    // A new life starts with an unsurveyed map; the character itself was
    // rebuilt by the RPG system, which is the only place it exists.
    this.state.resetSurvey();
    this.onDone();
  }
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/** A flat, heraldic face — readable at 260px, and cheap to redraw per slider tick. */
function faceSvg(race: string, sex: 'male' | 'female', skin: number, hair: number, age: number): string {
  const tone: Readonly<Record<string, [number, number, number]>> = {
    dunmer: [96, 78, 88],
    altmer: [206, 186, 142],
    bosmer: [150, 116, 78],
    khajiit: [136, 106, 64],
    argonian: [82, 106, 84],
    orc: [104, 118, 88],
    nord: [206, 176, 146],
    redguard: [118, 82, 58],
    breton: [204, 172, 140],
    imperial: [190, 156, 122],
  };
  const base = tone[race] ?? [180, 150, 120];
  const k = 0.72 + skin * 0.5 - age * 0.12;
  const c = `rgb(${Math.round(base[0] * k)},${Math.round(base[1] * k)},${Math.round(base[2] * k)})`;
  const hairColour = `hsl(${Math.round(20 + hair * 40)}, ${Math.round(12 + hair * 26)}%, ${Math.round(46 - hair * 34 + age * 34)}%)`;
  const jaw = sex === 'male' ? 40 : 34;
  const earPoint = race === 'dunmer' || race === 'altmer' || race === 'bosmer' ? 22 : 8;
  return (
    `<svg viewBox="0 0 200 260" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">` +
    `<ellipse cx="100" cy="132" rx="${jaw + 20}" ry="76" fill="${c}"/>` +
    `<path d="M${100 - jaw - 18} 118 l-${earPoint} -${earPoint} l6 26 z" fill="${c}"/>` +
    `<path d="M${100 + jaw + 18} 118 l${earPoint} -${earPoint} l-6 26 z" fill="${c}"/>` +
    `<path d="M${100 - jaw - 22} 106 q${jaw + 22} -${58 - age * 20} ${(jaw + 22) * 2} 0 q-${jaw + 22} -26 -${(jaw + 22) * 2} 0z" fill="${hairColour}"/>` +
    `<ellipse cx="78" cy="126" rx="9" ry="5" fill="#f0e6cf"/><ellipse cx="122" cy="126" rx="9" ry="5" fill="#f0e6cf"/>` +
    `<circle cx="78" cy="126" r="3.4" fill="${race === 'dunmer' ? '#c8442c' : '#3a2a18'}"/>` +
    `<circle cx="122" cy="126" r="3.4" fill="${race === 'dunmer' ? '#c8442c' : '#3a2a18'}"/>` +
    `<path d="M92 158 q8 8 16 0" stroke="rgba(0,0,0,.35)" stroke-width="2.5" fill="none"/>` +
    `<path d="M84 178 q16 ${8 - age * 10} 32 0" stroke="rgba(0,0,0,.45)" stroke-width="3" fill="none"/>` +
    `</svg>`
  );
}
