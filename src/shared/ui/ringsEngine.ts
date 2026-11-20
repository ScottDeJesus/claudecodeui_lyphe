// THE RINGS' ENGINE: the design system's Rings (design-system/astrolabe/components/bundle.js, "Rings: sets of things you turn
// through"), ported line for line to TypeScript for the kit's `Rings`, which owns the canvas, the hands and the words. Nothing here
// touches React: the component keeps one `RingsEngine` and calls `syncRings`, `advanceRing` and `drawRings` from its frame loop.
//
// A ring is a set of things round the core. Its marks are the things; the mark at the pointer is where you are; each thing owns
// the span from its mark to the next and lights it as it advances; the way the span moves says whether it is working, waiting on
// you, done or failed. Rings drift when left alone, hold still the moment one is touched, glide when flicked and lock on the
// nearest mark on the lock spring (ω = 2π·2.2, ζ = 0.62).
//
// THE APP'S TWO ADDITIONS: an item's `weight`, a heavier thing's mark standing taller off its ring (a high-priority bug), a lighter
// one shorter; and a finished span lit green, the app's colour for what is done. Everything else is the design system's, its
// constants included.
//
// EVERY COLOUR IS A TOKEN, read off the host element a few times a second and eased, so a theme switch crossfades.

import type { AstrolabeRing, AstrolabeRingGauge, AstrolabeRingItem, AstrolabeRingState } from '@/shared/types';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
/** The pointer stands at twelve o'clock: the mark there is the one that faces you. */
const HALF = Math.PI / 2;
/** How long a flick carries (duration-glide), how fast a tapped mark comes round (duration-jump), and the hardest flick, in rad/s. */
export const RING_GLIDE = 0.38;
const RING_JUMP = 0.14;
export const RING_VMAX = 14;
/** The lock spring: ω and ζ. */
const LOCK: readonly [number, number] = [TAU * 2.2, 0.62];

type Rgb = [number, number, number];
type Tone = 'halo' | 'b' | 'a' | 'loop';

/** The rig's rings, inside out: its two armillary rings (b, a), its flat loop, and two more for larger sets. Degrees and rad/s. */
const KINDS = {
  halo: { tone: 'halo', iota: 62, omega: 4.1, drift: 0.045, wob: 0 },
  b: { tone: 'b', iota: 68, omega: 0.4, drift: 0.06, wob: 3 },
  a: { tone: 'a', iota: 54, omega: 2.3, drift: -0.035, wob: 0 },
  e: { tone: 'loop', iota: 46, omega: 5.3, drift: -0.05, wob: 0 },
  loop: { tone: 'loop', iota: 0, omega: 0, drift: 0, wob: 0 },
} as const satisfies Record<string, { tone: Tone; iota: number; omega: number; drift: number; wob: number }>;
type Kind = (typeof KINDS)[keyof typeof KINDS];

/** Which kind each ring is and how far out it stands (a share of the outer radius), by how many rings there are. */
const SETS: Record<number, ReadonlyArray<readonly [keyof typeof KINDS, number]>> = {
  1: [['a', 0.9]],
  2: [['b', 0.68], ['a', 0.94]],
  3: [['b', 0.58], ['a', 0.79], ['loop', 1]],
  4: [['halo', 0.4], ['b', 0.6], ['a', 0.8], ['loop', 1]],
  5: [['halo', 0.32], ['b', 0.49], ['a', 0.66], ['e', 0.83], ['loop', 1]],
};

/** The words a slider says for each state. */
export const RING_STATE_WORD: Record<AstrolabeRingState, string> = { idle: 'not started', working: 'working', waiting: 'waiting on you', done: 'done', failed: 'failed' };

export type RingMode = 'rest' | 'held' | 'seek' | 'lock' | 'wheel';

/** One ring as the engine keeps it between frames. Angles in radians; `psi` is its turn, `m` the mark at the pointer. */
export type RingState = {
  id: string;
  def: AstrolabeRing;
  items: AstrolabeRingItem[];
  kind: Kind;
  tone: Tone;
  psi: number;
  vel: number;
  target: number;
  tau: number;
  mode: RingMode;
  m: number;
  n: number;
  omega: number;
  iota: number;
  tilt: number;
  rf: number;
  rfTarget: number;
  life: number;
  act: number;
  dim: number;
  hover: boolean;
  focus: boolean;
  holder: number | null;
  flash: number;
  lockFlash: number;
  pawl: { x: number; v: number };
  plate: number;
  plateUntil: number;
  wheelUntil: number;
  hist: Array<[number, number]>;
  applied: string | undefined;
  reported: string | null;
  sel: number;
  leaving: boolean;
};

/** A press on a ring in progress: the ring, the angle it was last at, where and when it began, how far it has moved. */
export type RingGrab = { ring: RingState; last: number; x0: number; y0: number; t0: number; travel: number; moving: boolean; touch: boolean };

/** The palette the rings are drawn in, eased toward the tokens. */
export type RingsPalette = {
  ground: Rgb; a: Rgb; b: Rgb; loop: Rgb; halo: Rgb; accent: Rgb; ink: Rgb; muted: Rgb; danger: Rgb; warn: Rgb; positive: Rgb;
  mono: string;
  plate: number;
};

/** Everything the rings keep between frames. */
export type RingsEngine = {
  rings: RingState[];
  cx: number;
  cy: number;
  Ro: number;
  W: number;
  H: number;
  grabs: Record<number, RingGrab>;
  nGrabs: number;
  clock: number;
  work: number;
  driftK: number;
  idleAt: number;
  palette: RingsPalette | null;
  target: RingsPalette | null;
  paletteAt: number;
  hover: { ring: RingState; j: number } | null;
  core: number;
  started: boolean;
  gaugeR: number;
  gaugeOut: number;
  overGauge: number;
  overCore: boolean;
  coreDown: { x: number; y: number; t: number; gauge: boolean; gi: number } | null;
};

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const ease = (c: number, t: number, dt: number, tau: number) => c + (t - c) * (1 - Math.exp(-dt / Math.max(1e-4, tau)));
export const wrapPi = (a: number) => {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
};
const rgba = (c: Rgb, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a, 0, 1).toFixed(3)})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const reducedMotion = () => {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export function createRingsEngine(): RingsEngine {
  return {
    rings: [], cx: 0, cy: 0, Ro: 0, W: 0, H: 0, grabs: {}, nGrabs: 0, clock: 0, work: 0, driftK: 0, idleAt: 0,
    palette: null, target: null, paletteAt: 0, hover: null, core: 0, started: false, gaugeR: 0, gaugeOut: 0, overGauge: 0, overCore: false, coreDown: null,
  };
}

/* ---------------- palette: the tokens, parsed ---------------- */

let probe: CanvasRenderingContext2D | null = null;
/** Any CSS colour the tokens hold, as an RGB triple, through the canvas's own parser. */
function parseColour(value: string, fallback: string): Rgb {
  if (!probe) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    probe = canvas.getContext('2d');
  }
  if (!probe) return [0, 0, 0];
  probe.fillStyle = '#000000';
  probe.fillStyle = value.trim() || fallback;
  const parsed = String(probe.fillStyle);
  if (parsed.startsWith('#')) {
    const n = parseInt(parsed.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const parts = /rgba?\(([^)]+)\)/.exec(parsed)?.[1].split(',').map(parseFloat) ?? [0, 0, 0];
  return [parts[0], parts[1], parts[2]];
}

/** The app's names for the tokens the rings read (`src/shared/ui/verve/tokens.css`): the ground is `--canvas`. */
const PALETTE_KEYS: ReadonlyArray<readonly [keyof Omit<RingsPalette, 'mono' | 'plate'>, string, string]> = [
  ['ground', 'canvas', '#08090b'], ['a', 'signal-a', '#f2a65a'], ['b', 'signal-b', '#9ed3e6'], ['loop', 'signal-loop', '#ecf2f7'],
  ['halo', 'signal-halo', '#96b4cd'], ['accent', 'accent', '#f2a65a'], ['ink', 'ink', '#eef1f4'], ['muted', 'ink-muted', '#959da6'],
  ['danger', 'danger-dot', '#ff7b6b'], ['warn', 'warn-dot', '#e6c15a'], ['positive', 'pos-dot', '#6fd6ab'],
];

function readPalette(host: HTMLElement): RingsPalette {
  const style = getComputedStyle(host);
  const palette = {} as RingsPalette;
  for (const [key, token, fallback] of PALETTE_KEYS) palette[key] = parseColour(style.getPropertyValue(`--${token}`), fallback);
  palette.mono = style.getPropertyValue('--font-mono').trim() || '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
  palette.plate = 0.8;
  return palette;
}

/** Eases the palette toward the tokens, read again every 400 ms, so a theme switch crossfades over about 0.18 s. */
export function stepPalette(engine: RingsEngine, host: HTMLElement, now: number, dt: number): RingsPalette {
  if (engine.target === null || now - engine.paletteAt > 400) {
    engine.paletteAt = now;
    try {
      engine.target = readPalette(host);
    } catch {
      // Keep the last palette read.
    }
  }
  const target = engine.target as RingsPalette;
  if (engine.palette === null) engine.palette = JSON.parse(JSON.stringify(target)) as RingsPalette;
  const current = engine.palette;
  for (const [key] of PALETTE_KEYS) {
    for (let j = 0; j < 3; j++) {
      let next = ease(current[key][j], target[key][j], dt, 0.18);
      if (Math.abs(next - target[key][j]) < 0.5) next = target[key][j];
      current[key][j] = next;
    }
  }
  current.mono = target.mono;
  current.plate = target.plate;
  return current;
}

/* ---------------- geometry ---------------- */

const mod = (a: number, n: number) => ((a % n) + n) % n;
export const ringStep = (r: RingState) => TAU / r.n;
const align = (r: RingState, x: number) => {
  const st = ringStep(r);
  return HALF + Math.round((x - HALF) / st) * st;
};
/** The thing whose mark sits at the pointer. */
export const ringIndex = (r: RingState) => mod(r.m, r.n);
/** The thing the ring is coming round to: the one at the pointer once it locks (the one there now, at rest or under a hand). */
export const ringHeading = (r: RingState) => (r.mode === 'seek' || r.mode === 'lock' ? mod(Math.round((r.target - HALF) / ringStep(r)), r.n) : ringIndex(r));
/** Where thing j's mark is: things run clockwise, the way progress reads. */
const markAngle = (r: RingState, j: number) => r.psi - j * ringStep(r);
export const findItem = (items: AstrolabeRingItem[], id: string | undefined) => (id === undefined ? -1 : items.findIndex((item) => item.id === id));
export const itemState = (item: AstrolabeRingItem | undefined): AstrolabeRingState => item?.state ?? 'idle';

type Basis = { co: number; so: number; ci: number; si: number };
const basis = (r: RingState): Basis => ({ co: Math.cos(r.omega), so: Math.sin(r.omega), ci: Math.cos(r.iota), si: Math.sin(r.iota) });

/** A point of the ring on screen, and how far it sits toward you (positive) or away. */
function pointAt(E: RingsEngine, B: Basis, rad: number, t: number): [number, number, number] {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [E.cx + rad * (c * B.co - s * B.so * B.ci), E.cy - rad * (c * B.so + s * B.co * B.ci), s * B.si];
}

/** The reverse: where on the ring's own plane a screen point falls, as an angle. It is what keeps a mark under your finger. */
export function angleAt(E: RingsEngine, r: RingState, x: number, y: number): number {
  const B = basis(r);
  const dx = x - E.cx;
  const dy = -(y - E.cy);
  return Math.atan2((-dx * B.so + dy * B.co) / B.ci, dx * B.co + dy * B.so);
}

function nearest(E: RingsEngine, r: RingState, x: number, y: number): { d: number; front: boolean } {
  const B = basis(r);
  const rad = r.rf * E.Ro;
  const samples = 72;
  let best = Infinity;
  let bestT = 0;
  const tryAt = (t: number) => {
    const q = pointAt(E, B, rad, t);
    const d = (q[0] - x) * (q[0] - x) + (q[1] - y) * (q[1] - y);
    if (d < best) {
      best = d;
      bestT = t;
    }
  };
  for (let i = 0; i < samples; i++) tryAt((i / samples) * TAU);
  let span = TAU / samples;
  for (let k = 0; k < 5; k++) {
    span *= 0.5;
    const c = bestT;
    tryAt(c - span);
    tryAt(c + span);
  }
  return { d: Math.sqrt(best), front: Math.sin(bestT) * B.si >= 0 };
}

/** The ring a pointer is on: the closest one inside the grab band, the near side winning where two cross. */
export function ringAt(E: RingsEngine, x: number, y: number, band: number): RingState | null {
  let hit: RingState | null = null;
  let score = Infinity;
  for (const r of E.rings) {
    if (r.leaving || r.life < 0.5 || r.holder !== null) continue;
    const n = nearest(E, r, x, y);
    if (n.d > band) continue;
    const s = n.d - (n.front ? 1.5 : 0);
    if (s < score) {
      score = s;
      hit = r;
    }
  }
  return hit;
}

/** The thing a point on a ring belongs to: each thing owns the span from its mark to the next one. */
export const itemAt = (E: RingsEngine, r: RingState, x: number, y: number) => Math.floor(wrapPi(r.psi - angleAt(E, r, x, y)) / ringStep(r) + 0.18);
export const itemOf = (r: RingState, j: number) => r.items[mod(j, r.n)];
export const isFacing = (r: RingState, j: number) => mod(j, r.n) === ringIndex(r);

/** Where thing j's mark stands in the canvas's own pixels. */
export function markPoint(E: RingsEngine, r: RingState, j: number): { x: number; y: number } {
  const q = pointAt(E, basis(r), r.rf * E.Ro, markAngle(r, j));
  return { x: q[0], y: q[1] };
}

/* ---------------- motion ---------------- */

export function releaseRing(r: RingState, v: number) {
  const st = ringStep(r);
  r.target = align(r, r.psi + v * RING_GLIDE);
  if (Math.abs(r.target - r.psi) < 0.9 * st) {
    r.mode = 'lock';
    r.vel = v;
  } else {
    r.mode = 'seek';
    r.tau = RING_GLIDE;
    r.vel = v;
  }
}

export function jumpRing(r: RingState, target: number) {
  r.target = target;
  if (Math.abs(target - r.psi) < 0.9 * ringStep(r)) r.mode = 'lock';
  else {
    r.mode = 'seek';
    r.tau = reducedMotion() ? 0.07 : RING_JUMP;
  }
}

/** Bring mark j round to the pointer, the short way. */
export const bringRing = (r: RingState, j: number) => jumpRing(r, r.psi + wrapPi(HALF - markAngle(r, j)));

/** The base a key turns from: where the ring is heading, or the mark it rests on. */
export const keyBase = (r: RingState) => (r.mode === 'seek' || r.mode === 'lock' ? r.target : align(r, r.psi));
export const HALF_TURN = HALF;

function springStep(s: { x: number; v: number }, target: number, dt: number) {
  const [w, z] = LOCK;
  const n = Math.max(1, Math.ceil(dt / 0.008));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = -w * w * (s.x - target) - 2 * z * w * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
}

/** One frame of a ring's turn. Answers whether it locked on a mark this frame. */
export function advanceRing(r: RingState, dt: number, now: number): boolean {
  const st = ringStep(r);
  let locked = false;
  if (r.mode === 'wheel' && now > r.wheelUntil) releaseRing(r, 0);
  if (r.mode === 'seek') {
    const d = (r.target - r.psi) * (1 - Math.exp(-dt / r.tau));
    r.vel = d / dt;
    r.psi += d;
    if (Math.abs(r.target - r.psi) < 0.9 * st) r.mode = 'lock';
  } else if (r.mode === 'lock') {
    const n = Math.max(1, Math.ceil(dt / 0.006));
    const h = dt / n;
    const [w] = LOCK;
    const z = reducedMotion() ? 1 : LOCK[1];
    for (let i = 0; i < n; i++) {
      r.vel += (-w * w * (r.psi - r.target) - 2 * z * w * r.vel) * h;
      r.psi += r.vel * h;
    }
    if (Math.abs(r.psi - r.target) < 0.002 && Math.abs(r.vel) < 0.03) {
      r.psi = r.target;
      r.vel = 0;
      r.mode = 'rest';
      r.lockFlash = 1;
      r.plateUntil = now + 1400;
      locked = true;
    }
  }
  const m = Math.round((r.psi - HALF) / st);
  if (m !== r.m) {
    r.m = m;
    r.flash = 1;
  }
  // The pointer lifts while the ring turns and drops in when it locks.
  springStep(r.pawl, r.mode === 'rest' ? 1 : 0, dt);
  return locked;
}

/**
 * Brings the engine's rings into line with the rings given: a new ring is made where its first picture faces (`value`, else
 * `defaultValue`, else the first thing), a ring whose count changed keeps its place and locks on the nearest mark, a ring whose
 * `value` changed brings that thing round, and a ring no longer given leaves. Ring kinds and radii follow how many rings there are.
 */
export function syncRings(E: RingsEngine, defs: AstrolabeRing[]) {
  const given = defs.slice(0, 5);
  const set = SETS[Math.max(1, given.length)];
  const seen = new Set<string>();
  given.forEach((def, i) => {
    const kind = KINDS[set[i][0]];
    const items = def.items;
    const N = Math.max(1, items.length);
    const want = findItem(items, def.value);
    let r = E.rings.find((ring) => ring.id === def.id);
    if (!r) {
      const first = want >= 0 ? want : Math.max(0, findItem(items, def.defaultValue));
      const psi = HALF + first * (TAU / N);
      r = {
        id: def.id, def, items, kind, tone: kind.tone, psi, vel: 0, target: psi, tau: RING_GLIDE, mode: 'rest',
        m: Math.round((psi - HALF) / (TAU / N)), n: N, omega: kind.omega, iota: kind.iota * DEG, tilt: kind.iota, rf: set[i][1], rfTarget: set[i][1],
        life: E.started ? 0 : 1, act: 0, dim: 0, hover: false, focus: false, holder: null, flash: 0, lockFlash: 0, pawl: { x: 1, v: 0 },
        plate: 0, plateUntil: 0, wheelUntil: 0, hist: [], applied: def.value, reported: items[first]?.id ?? null, sel: first, leaving: false,
      };
      E.rings.push(r);
    }
    r.def = def;
    r.items = items;
    r.kind = kind;
    r.tone = kind.tone;
    r.tilt = kind.iota;
    r.rfTarget = set[i][1];
    r.leaving = false;
    if (r.n !== N) {
      r.n = N;
      r.m = Math.round((r.psi - HALF) / (TAU / N));
      if (r.mode !== 'held') {
        r.target = align(r, r.psi);
        r.mode = 'lock';
      }
    }
    if (def.value !== r.applied) {
      r.applied = def.value;
      if (want >= 0 && want !== ringIndex(r) && r.mode !== 'held') bringRing(r, want);
    }
    seen.add(def.id);
  });
  for (const r of E.rings) if (!seen.has(r.id)) r.leaving = true;
  E.rings.sort((left, right) => left.rfTarget - right.rfTarget);
}

/** One frame of every ring's life: drift, tilt, radius, presence, and how loud each is. Answers whether any ring locked this frame. */
export function liveRings(E: RingsEngine, dt: number, now: number, hold: boolean, drift: boolean, onLock: (r: RingState) => void): boolean {
  const rate0 = reducedMotion() ? 0.35 : 1;
  const held = E.nGrabs > 0;
  let busy = held || hold;
  let anyHeld = false;
  let changed = false;
  for (const r of E.rings) {
    if (r.mode !== 'rest' || r.focus) busy = true;
    if (r.mode === 'held' || r.mode === 'wheel') anyHeld = true;
  }
  if (busy) E.idleAt = now + 700;
  E.driftK = held ? 0 : ease(E.driftK, drift && now > E.idleAt ? 1 : 0, dt, 0.45);
  const rate = E.driftK * rate0;
  E.clock += dt * rate;
  E.work += dt * rate0;
  for (const r of E.rings) {
    if (advanceRing(r, dt, now)) {
      r.sel = ringIndex(r);
      changed = true;
      onLock(r);
    }
    r.omega += r.kind.drift * dt * rate;
    r.iota = ease(r.iota, (r.tilt + r.kind.wob * Math.sin(E.clock * 0.31)) * DEG * (r.tilt > 0 ? 1 : 0), dt, 0.18);
    r.rf = ease(r.rf, r.rfTarget, dt, 0.16);
    r.life = ease(r.life, r.leaving ? 0 : 1, dt, r.leaving ? 0.1 : 0.2);
    const actTarget = r.mode === 'held' || r.mode === 'wheel' || r.focus ? 1 : r.mode !== 'rest' ? 0.7 : r.hover ? 0.4 : 0;
    r.act = ease(r.act, actTarget, dt, actTarget > r.act ? 0.06 : 0.24);
    const plateTarget = r.mode !== 'rest' || r.focus || now < r.plateUntil ? 1 : 0;
    r.plate = ease(r.plate, plateTarget, dt, plateTarget > r.plate ? 0.05 : 0.2);
    r.dim = ease(r.dim, anyHeld && actTarget < 0.7 ? 1 : 0, dt, 0.16);
    r.flash *= Math.exp(-dt / 0.16);
    r.lockFlash *= Math.exp(-dt / 0.45);
  }
  for (let i = E.rings.length - 1; i >= 0; i--) if (E.rings[i].leaving && E.rings[i].life < 0.02) E.rings.splice(i, 1);
  return changed;
}

/* ---------------- drawing ---------------- */

const canvasFont = (P: RingsPalette, px: number, weight: number) => `${weight} ${px}px ${P.mono}`;

/** One arc of a ring, on the near side or the far side only, so the far half can sit back. */
function arc(ctx: CanvasRenderingContext2D, E: RingsEngine, B: Basis, rad: number, t0: number, t1: number, front: boolean, flat: boolean) {
  const n = Math.max(2, Math.ceil(Math.abs(t1 - t0) / (TAU / 96)));
  let on = false;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const u0 = lerp(t0, t1, i / n);
    const u1 = lerp(t0, t1, (i + 1) / n);
    if (!flat && (Math.sin((u0 + u1) / 2) >= 0) !== front) {
      on = false;
      continue;
    }
    if (!on) {
      const q = pointAt(E, B, rad, u0);
      ctx.moveTo(q[0], q[1]);
      on = true;
    }
    const q = pointAt(E, B, rad, u1);
    ctx.lineTo(q[0], q[1]);
  }
}

function tick(ctx: CanvasRenderingContext2D, E: RingsEngine, B: Basis, rad: number, t: number, k0: number, k1: number) {
  const a = pointAt(E, B, rad * k0, t);
  const b = pointAt(E, B, rad * k1, t);
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
}

/** How far a thing's mark stands off its ring, by its weight: a half is the design system's own 1.05. */
const markReach = (item: AstrolabeRingItem | undefined, small: boolean) => {
  const weight = clamp(item?.weight ?? 0.5, 0, 1);
  return 1 + (small ? 0.07 : 0.05) * (0.45 + 1.1 * weight);
};

export function drawRing(ctx: CanvasRenderingContext2D, E: RingsEngine, r: RingState, front: boolean, P: RingsPalette) {
  const B = basis(r);
  const rad = r.rf * E.Ro;
  const tone = P[r.tone];
  const flat = B.si < 0.06;
  // A face-on ring has no far side: it is drawn once.
  if (flat && !front) return;
  const depth = Math.min(1, B.si * 1.15);
  const vis = r.life * (1 - 0.45 * r.dim);
  const act = r.act;
  const near = !flat && !front ? 1 - depth : 1;
  const st = ringStep(r);
  const small = E.Ro < 90;
  const k = ringIndex(r);
  const lw = (r.tone === 'loop' ? 1.25 : 1) + 0.8 * act;
  const sideOk = (t: number) => flat || (Math.sin(t) >= 0) === front;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // The ring itself: a hairline, whisper-quiet.
  arc(ctx, E, B, rad, flat || front ? 0 : Math.PI, flat ? TAU : front ? Math.PI : TAU, front, true);
  if (act > 0.02) {
    ctx.strokeStyle = rgba(tone, 0.05 * act * vis * lerp(0.4, 1, near));
    ctx.lineWidth = lw + 13;
    ctx.stroke();
    ctx.strokeStyle = rgba(tone, 0.1 * act * vis * lerp(0.4, 1, near));
    ctx.lineWidth = lw + 5;
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(tone, lerp(lerp(0.2, 0.34, act), lerp(0.42, 0.7, act), near) * vis);
  ctx.lineWidth = lw;
  ctx.stroke();

  // Each thing's span: how far it has got, and what it is doing.
  const gap = Math.min(0.07, st * 0.16);
  const len = st - gap;
  const per = Math.max(1, Math.round(24 / r.n));
  for (let j = 0; j < r.n; j++) {
    const item = r.items[j];
    const state = itemState(item);
    const t0 = markAngle(r, j) - gap / 2;
    const progress = state === 'done' ? 1 : clamp(item?.progress ?? 0, 0, 1);
    // Finished is green, the app's rule for what is done (the design system lights it in the ring's own tone): quiet, and never mistaken for work in hand.
    const col = state === 'failed' ? P.danger : state === 'done' ? P.positive : tone;
    const head = t0 - len * progress;
    const done = state === 'done';
    if (progress > 0.001) {
      arc(ctx, E, B, rad, t0, head, front, flat);
      // Finished work rests: thinner and quieter than work in hand.
      ctx.strokeStyle = rgba(col, lerp(done ? 0.28 : 0.34, done ? 0.56 : 0.98, near) * vis);
      ctx.lineWidth = done ? (small ? 1.3 : 1.5) : (small ? 1.6 : 2.1) + 0.6 * act;
      ctx.stroke();
    }
    if (state === 'working') {
      // Work in progress: dashes crawl ahead of the head, and a bead rides it.
      const ahead = Math.min(len * (1 - progress), Math.max(0.1, len * 0.3));
      const dash = Math.max(0.03, 7 / Math.max(20, rad));
      const phase = (E.work * 0.42) % dash;
      ctx.strokeStyle = rgba(col, lerp(0.3, 0.9, near) * vis);
      ctx.lineWidth = small ? 1.3 : 1.6;
      for (let u = phase - dash; u < ahead; u += dash) {
        const a0 = Math.max(0, u);
        const a1 = Math.min(ahead, u + dash * 0.5);
        if (a1 > a0) {
          arc(ctx, E, B, rad, head - a0, head - a1, front, flat);
          ctx.stroke();
        }
      }
      if (sideOk(head)) {
        const bead = pointAt(E, B, rad, head);
        ctx.beginPath();
        ctx.arc(bead[0], bead[1], (small ? 2 : 2.6) + 0.9 * act, 0, TAU);
        ctx.fillStyle = rgba(col, lerp(0.45, 1, near) * vis);
        ctx.fill();
      }
      // Helpers at work on it ride behind the bead, one small bead each.
      const helpers = Math.min(5, Math.max(0, Math.round(item?.agents ?? 0)));
      const spacing = Math.max(0.04, 8 / Math.max(20, rad));
      for (let q = 1; q <= helpers && !small; q++) {
        const ta = head + q * spacing;
        if (ta > t0 || !sideOk(ta)) continue;
        const helper = pointAt(E, B, rad * 1.035, ta);
        ctx.beginPath();
        ctx.arc(helper[0], helper[1], 1.5, 0, TAU);
        ctx.fillStyle = rgba(P.ink, lerp(0.4, 0.9, near) * vis);
        ctx.fill();
      }
    } else if (state === 'failed' && sideOk(head)) {
      ctx.beginPath();
      tick(ctx, E, B, rad, head, 0.94, 1.06);
      ctx.strokeStyle = rgba(P.danger, lerp(0.45, 1, near) * vis);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  // The marks: one per thing, with the rig's fine divisions between them.
  ctx.lineWidth = 1;
  if (!small) {
    ctx.beginPath();
    for (let j = 0; j < r.n * per; j++) {
      if (j % per === 0) continue;
      const t = r.psi - (j * st) / per;
      if (sideOk(t)) tick(ctx, E, B, rad, t, 1, 1.022);
    }
    ctx.strokeStyle = rgba(tone, lerp(0.09, lerp(0.2, 0.34, act), near) * vis);
    ctx.stroke();
  }
  ctx.beginPath();
  for (let j = 0; j < r.n; j++) {
    const t = markAngle(r, j);
    if (j === k || itemState(r.items[j]) === 'waiting') continue;
    if (sideOk(t)) tick(ctx, E, B, rad, t, 1, markReach(r.items[j], small));
  }
  ctx.strokeStyle = rgba(tone, lerp(lerp(0.26, 0.36, act), lerp(0.6, 0.95, act), near) * vis);
  ctx.stroke();
  for (let j = 0; j < r.n; j++) {
    const t = markAngle(r, j);
    if (!sideOk(t)) continue;
    if (itemState(r.items[j]) === 'waiting') {
      // Waiting on you: the mark turns accent and holds a gate open, steady, with no blinking.
      const g = Math.min(0.06, st * 0.2);
      ctx.beginPath();
      tick(ctx, E, B, rad, t, 0.93, 1.1);
      tick(ctx, E, B, rad, t - g, 0.965, 1.06);
      tick(ctx, E, B, rad, t + g, 0.965, 1.06);
      ctx.strokeStyle = rgba(P.accent, lerp(0.5, 1, near) * vis);
      ctx.lineWidth = small ? 1.4 : 1.7;
      ctx.stroke();
    } else if (j === k) {
      const hot = clamp(Math.max(r.flash, r.lockFlash, act), 0, 1);
      ctx.beginPath();
      tick(ctx, E, B, rad, t, 1, markReach(r.items[j], small) + 0.035 + 0.02 * act);
      ctx.strokeStyle = rgba(mix(P.ink, P.accent, hot), lerp(0.4, 1, near) * vis);
      ctx.lineWidth = 1.25 + 0.6 * act;
      ctx.stroke();
    }
  }
}

/** A plate: a caption over a name, on a ground plate, kept inside the canvas. */
export function drawPlate(ctx: CanvasRenderingContext2D, E: RingsEngine, P: RingsPalette, x0: number, y0: number, cap: string, label: string, alpha: number, hot: number) {
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = canvasFont(P, 10, 400);
  const wc = cap ? ctx.measureText(cap).width : 0;
  ctx.font = canvasFont(P, 12, 500);
  const wl = label ? ctx.measureText(label).width : 0;
  const pw = Math.max(wc, wl) + 16;
  const ph = cap && label ? 36 : 22;
  const x = clamp(x0, pw / 2 + 2, E.W - pw / 2 - 2);
  const y = clamp(y0, ph / 2 + 2, E.H - ph / 2 - 2);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - pw / 2, y - ph / 2, pw, ph, 2);
  else ctx.rect(x - pw / 2, y - ph / 2, pw, ph);
  ctx.fillStyle = rgba(P.ground, P.plate * alpha);
  ctx.fill();
  if (cap) {
    ctx.font = canvasFont(P, 10, 400);
    ctx.fillStyle = rgba(P.muted, alpha);
    ctx.fillText(cap, x - pw / 2 + 8, y + (label ? -8 : 0.5));
  }
  if (label) {
    ctx.font = canvasFont(P, 12, 500);
    ctx.fillStyle = rgba(mix(P.ink, P.accent, clamp(hot, 0, 1)), alpha);
    ctx.fillText(label, x - pw / 2 + 8, y + (cap ? 8 : 0.5));
  }
}

/** The pointer of a ring: a small triangle where it faces you, lifting while the ring turns; and, while the ring is in use, the plate naming what faces you. */
export function drawPointer(ctx: CanvasRenderingContext2D, E: RingsEngine, r: RingState, P: RingsPalette) {
  const B = basis(r);
  const rad = r.rf * E.Ro;
  const q = pointAt(E, B, rad, HALF);
  const vis = r.life * (1 - 0.45 * r.dim);
  const sc = clamp(E.Ro / 140, 0.5, 1);
  // Straight out from the ring, where it faces you.
  const nx = -B.so;
  const ny = -B.co;
  const off = rad * 0.105 * B.ci + 5 * sc + (1 - r.pawl.x) * 5 * sc;
  const hot = clamp(Math.max(r.act, r.flash, r.lockFlash), 0, 1);
  const tx = q[0] + nx * off;
  const ty = q[1] + ny * off;
  const bx = q[0] + nx * (off + 8 * sc);
  const by = q[1] + ny * (off + 8 * sc);
  const qx = -ny * 4 * sc;
  const qy = nx * 4 * sc;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(bx + qx, by + qy);
  ctx.lineTo(bx - qx, by - qy);
  ctx.closePath();
  ctx.fillStyle = rgba(mix(P.muted, P.accent, hot), lerp(0.7, 1, hot) * vis);
  ctx.fill();
  if (r.plate > 0.01) {
    const item = r.items[ringIndex(r)];
    const cap = (r.def.label || '') + (item?.detail ? `${r.def.label ? ' · ' : ''}${item.detail}` : '');
    drawPlate(ctx, E, P, q[0] + nx * (off + 8 * sc + 26), q[1] + ny * (off + 8 * sc + 26), cap.toUpperCase(), item?.label ?? '', r.plate * vis, r.flash * 1.5);
  }
}

/** The measures worn by the core: hairlines that fill clockwise, quiet until they run high; the one pointed at names itself. */
export function drawGauges(ctx: CanvasRenderingContext2D, E: RingsEngine, P: RingsPalette, gauges: AstrolabeRingGauge[]) {
  const g0 = Math.max(8, E.Ro * 0.27);
  const gstep = Math.max(5, E.Ro * 0.047);
  E.gaugeR = gauges.length ? g0 : 0;
  E.gaugeOut = gauges.length ? g0 + (gauges.length - 1) * gstep : 0;
  gauges.forEach((gauge, gi) => {
    const value = clamp(gauge.value, 0, 1);
    const radius = g0 + gi * gstep;
    const high = value >= (gauge.warn ?? 0.8);
    const full = value >= (gauge.danger ?? 1);
    const colour = full ? P.danger : high ? P.warn : P.muted;
    const pointed = E.overGauge === gi + 1;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(E.cx, E.cy, radius, 0, TAU);
    ctx.strokeStyle = rgba(P.muted, 0.16);
    ctx.lineWidth = 1;
    ctx.stroke();
    if (value > 0.002) {
      ctx.beginPath();
      ctx.arc(E.cx, E.cy, radius, -HALF, -HALF + TAU * value);
      ctx.strokeStyle = rgba(colour, high || pointed ? 0.95 : 0.6);
      ctx.lineWidth = high || pointed ? 2 : 1.4;
      ctx.stroke();
    }
    if (pointed) drawPlate(ctx, E, P, E.cx, E.cy - E.gaugeOut - 20, `${gauge.label} · ${gauge.detail ?? `${Math.round(value * 100)}%`}`.toUpperCase(), '', 1, 0);
  });
}

/** Under a mouse, the mark you point at names itself: you turn to it or click it. */
export function drawHover(ctx: CanvasRenderingContext2D, E: RingsEngine, P: RingsPalette) {
  const hover = E.hover;
  if (!hover || hover.ring.mode !== 'rest' || hover.ring.leaving || isFacing(hover.ring, hover.j)) return;
  const item = itemOf(hover.ring, hover.j);
  if (!item?.label) return;
  const q = pointAt(E, basis(hover.ring), hover.ring.rf * E.Ro * 1.02, markAngle(hover.ring, hover.j));
  drawPlate(ctx, E, P, q[0], q[1] - 20, '', item.label, 1, 0);
}

/** The canvas's backing store at the screen's density, at most twice. */
export function fitCanvas(canvas: HTMLCanvasElement, w: number, h: number): number {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pw = Math.max(1, Math.round(w * dpr));
  const ph = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  return dpr;
}
