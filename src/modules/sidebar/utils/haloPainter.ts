import type { SessionsHaloSlot } from '@/shared/types';

// THE HALO'S PAINTER: every chat of the simple list as one slot on a hoop that stands round the companion's core, seen from a little
// above. A slot says its chat's state by how it stands, in three tracks up the band's face, the same marks a tile on the sessions board
// draws: the top edge lit for a reply not read yet; the square in the middle dark for a chat asleep, lit and still for one awake, a
// ring of dashes turning in it while its turn runs, and filled in the accent, breathing, while it waits on the reader; a bead on the
// lower edge for a subagent still at work. The chats of one folder stand together, a firmer wall and a little air between folders.
// The hoop turns: the slot at the front, over the pointer, is the one that is read out and the one a press opens.
//
// Drawn on a canvas because every slot leans with the hoop as it turns; the component over it (`board/SessionsHalo`) owns the element,
// its events and the words.

type Rgb = readonly [number, number, number];
type Colors = { ink: Rgb; tone: Rgb; muted: Rgb; accent: Rgb; bead: Rgb };

const TAU = Math.PI * 2;
/** How far the hoop leans toward the reader: its depth on screen over its width. */
const TILT = 0.52;
/** The air between two folders, in radians, and the most of a slot's own width its side walls keep clear. */
const FOLDER_GAP = 0.09;
/** The tracks up the band's face, 0 at its foot and 1 at its top: the square, the unread edge, the bead. */
const SQUARE: readonly [number, number] = [0.24, 0.78];
const UNREAD_FROM = 0.84;
const BEAD_AT = 0.11;

const FALLBACK: Colors = { ink: [255, 255, 255], tone: [238, 241, 244], muted: [149, 157, 166], accent: [242, 166, 90], bead: [158, 211, 230] };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const lerp = (from: number, to: number, by: number) => from + (to - from) * by;
/** An angle folded into (-π, π]: how far round from the front, signed. */
const fold = (angle: number) => {
  const turned = ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return turned === -Math.PI ? Math.PI : turned;
};
const rgba = (color: Rgb, alpha: number) => `rgba(${color[0]},${color[1]},${color[2]},${clamp(alpha, 0, 1)})`;

/** A slot's place on the hoop: its middle and its width, in radians, before the hoop's turn. */
type Place = { at: number; width: number };

/** A folder's run of slots, for its name: where it starts, where it ends, and the name (null for the chats in no folder). */
type Run = { from: number; to: number; name: string | null };

/** A press in progress: where it began, how far it has moved, and the hoop's turn when it began. */
type Drag = { x: number; moved: number; rot: number; slot: number };

/** A dealing between the core and one chat: the chat by id, and the way the words go (`in`: read from the chat; `out`: written to it). */
export type HaloLink = { id: string; way: 'in' | 'out' };

/** What a lifted press asks for: the chat at the front was pressed (open it), or nothing more than the turn the painter has already begun. */
export type HaloPress = { open: number } | null;

/**
 * The hoop in a box of `width` by `height`: its middle on the ground, its half-width and its band's height. Room is kept at the foot for
 * the pointer and a hair at the top so the far band's edge is whole. The painter stands the hoop by it, and `board/SessionsHalo` stands
 * the core by it too (`middleOf`), so the two never disagree.
 */
export function haloGeometry(width: number, height: number) {
  const radius = Math.max(24, Math.min(width / 2 - 6, (height - 18) / (2 * TILT + 0.18)));
  const band = clamp(radius * 0.18, 12, 30);
  return { cx: width / 2, cy: 4 + band + radius * TILT, radius, band };
}

/** Where the hoop's opening has its middle, for what stands in it: over the ground's middle by half the band, as the eye reads it. */
export function haloMiddle(width: number, height: number): { x: number; y: number } {
  const { cx, cy, band } = haloGeometry(width, height);
  return { x: cx, y: cy - band / 2 };
}

/** The box's height that holds a hoop as wide as `width` whole, pointer and all: what a caller that knows only the width asks for. */
export function haloHeightFor(width: number): number {
  return Math.round(18 + (2 * TILT + 0.18) * (width / 2 - 6));
}

/**
 * The halo's painter over one canvas. Every method is cheap to call per event; `frame` is the one that draws.
 *
 * Used by `board/SessionsHalo`, which owns the canvas element and its events.
 */
export function createHaloPainter(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  let slots: SessionsHaloSlot[] = [];
  let places: Place[] = [];
  let runs: Run[] = [];
  let width = 0;
  let height = 0;
  let ratio = 1;
  // The hoop in the canvas it has: its middle, its half-width, its band's height.
  let cx = 0;
  let cy = 0;
  let radius = 60;
  let band = 18;
  // Whether the folders' names are written round it (a hoop standing small writes none).
  let names = true;
  let colors = FALLBACK;
  let font = 'ui-monospace, monospace';
  // The hoop's turn now and the turn it is settling to. A slot at angle 0 (after the turn) is at the front.
  let rot = 0;
  let target = 0;
  let hover = -1;
  let drag: Drag | null = null;
  let lastAt = 0;
  let wheelAt = 0;
  let still = false;
  // Whether the keyboard's focus is on the hoop: the slot at the front is then outlined.
  let focused = false;
  // The slots as they were last drawn, for a press to land on.
  let paths: Array<Path2D | null> = [];
  // The chat the core is dealing with now, and which way the words go; and how far from the middle the core's own edge is, in px.
  let link: HaloLink | null = null;
  let hole = 0;

  /** A point on the band: `angle` round from the front, `up` the band's face from foot (0) to top (1), `out` its distance from the axis in radii. */
  const point = (angle: number, up: number, out = 1): [number, number] => [
    cx + radius * out * Math.sin(angle),
    cy + radius * out * TILT * Math.cos(angle) - up * band,
  ];

  /** The piece of the band's face between two angles and two heights, as a path. */
  const piece = (from: number, to: number, low: number, high: number) => {
    const path = new Path2D();
    const steps = Math.max(2, Math.ceil(Math.abs(to - from) / 0.12));
    for (let step = 0; step <= steps; step += 1) {
      const [x, y] = point(lerp(from, to, step / steps), low);
      if (step === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    for (let step = steps; step >= 0; step -= 1) {
      const [x, y] = point(lerp(from, to, step / steps), high);
      path.lineTo(x, y);
    }
    path.closePath();
    return path;
  };

  /** Each slot's share of the hoop: equal shares, the chats of a folder side by side, air between one folder and the next. */
  const lay = () => {
    const count = slots.length;
    places = [];
    runs = [];
    if (count === 0) return;
    let folders = 0;
    for (let index = 0; index < count; index += 1) {
      if (index === 0 || slots[index].folder !== slots[index - 1].folder) folders += 1;
    }
    const gap = folders > 1 ? Math.min(FOLDER_GAP, TAU / count / 3) : 0;
    const share = (TAU - folders * gap) / count;
    let at = 0;
    for (let index = 0; index < count; index += 1) {
      const opens = index === 0 || slots[index].folder !== slots[index - 1].folder;
      if (opens) {
        if (index > 0) at += gap;
        runs.push({ from: at, to: at, name: slots[index].folderName });
      }
      places.push({ at: at + share / 2, width: share });
      at += share;
      runs[runs.length - 1].to = at;
    }
  };

  const fit = () => {
    ({ cx, cy, radius, band } = haloGeometry(width, height));
  };

  /** The slot nearest the front under a turn. */
  const frontOf = (turn: number) => {
    let best = -1;
    for (let index = 0; index < places.length; index += 1) {
      if (best === -1 || Math.abs(fold(places[index].at + turn)) < Math.abs(fold(places[best].at + turn))) best = index;
    }
    return best;
  };
  /** Turns the hoop, the short way round, until `index` is at the front. */
  const turnTo = (index: number) => {
    if (index < 0 || index >= places.length) return;
    target = rot - fold(places[index].at + rot);
  };

  const slotAt = (x: number, y: number) => {
    // The near half is in front of the far half, so it is asked first.
    let found = -1;
    for (let index = 0; index < paths.length; index += 1) {
      const path = paths[index];
      if (path === null || !ctx.isPointInPath(path, x * ratio, y * ratio)) continue;
      if (found === -1 || Math.cos(places[index].at + rot) > Math.cos(places[found].at + rot)) found = index;
    }
    return found;
  };

  const drawSlot = (index: number, now: number) => {
    const slot = slots[index];
    const place = places[index];
    const mid = place.at + rot;
    const edge = Math.min(0.02, place.width * 0.1);
    const low = mid - place.width / 2 + edge;
    const high = mid + place.width / 2 - edge;
    // The near half is seen from outside and full on; the far half from inside, quieter, and quieter still side on.
    const near = Math.cos(mid) > 0;
    const shade = lerp(0.45, 1, Math.abs(Math.cos(mid))) * (near ? 1 : 0.62);
    const whole = piece(low, high, 0, 1);
    paths[index] = whole;

    // Its frame: all a chat asleep shows.
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(colors.tone, 0.3 * shade);
    ctx.stroke(whole);

    if (slot.state !== 'asleep') {
      const square = piece(low, high, SQUARE[0], SQUARE[1]);
      if (slot.state === 'waiting') {
        // Stopped on the reader: the square in the accent, breathing. Everything that waits breathes together.
        const breath = still ? 1 : clamp(0.5 + 2.2 * Math.sin((now / 1000) * TAU / 1.15), 0, 1);
        ctx.fillStyle = rgba(colors.accent, lerp(0.3, 0.95, breath) * lerp(0.7, 1, shade));
        ctx.fill(square);
        ctx.strokeStyle = rgba(colors.accent, lerp(0.7, 1, shade));
        ctx.lineWidth = 1.25;
        ctx.stroke(square);
      } else {
        ctx.fillStyle = rgba(colors.tone, 0.2 * shade);
        ctx.fill(square);
        ctx.strokeStyle = rgba(colors.tone, 0.5 * shade);
        ctx.lineWidth = 1;
        ctx.stroke(square);
        if (slot.state === 'working') {
          // At work: twelve accent dashes round a hairline track, lying on the band's face, once round every 2.4 s.
          const span = high - low;
          const reach = Math.min(band * (SQUARE[1] - SQUARE[0]) * 0.42, radius * span * 0.32);
          const across = reach / radius;
          const up = reach / band;
          const middle = (SQUARE[0] + SQUARE[1]) / 2;
          const on = (turn: number) => point(mid + across * Math.cos(turn), middle + up * Math.sin(turn));
          const from = still ? 0 : ((now / 1000) / 2.4) * TAU;
          const part = TAU / 12;
          ctx.beginPath();
          for (let dash = 0; dash < 12; dash += 1) {
            for (let step = 0; step <= 2; step += 1) {
              const [x, y] = on(from + dash * part + (step / 2) * part * 0.56);
              if (step === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
          }
          ctx.strokeStyle = rgba(colors.accent, Math.min(1, shade + 0.25));
          ctx.lineWidth = clamp((reach / 19) * 1.5, 1.1, 1.75);
          ctx.stroke();
        }
      }
    }
    if (slot.unread) {
      ctx.fillStyle = rgba(colors.ink, Math.min(1, shade + 0.25));
      ctx.fill(piece(low, high, UNREAD_FROM, 1));
    }
    if (slot.helpers) {
      const [x, y] = point(mid + (still ? 0 : Math.sin(now / 450 + index) * (high - low) * 0.12), BEAD_AT);
      ctx.beginPath();
      ctx.arc(x, y, clamp(band * 0.08, 1.6, 3), 0, TAU);
      ctx.fillStyle = rgba(colors.bead, Math.min(1, shade + 0.3));
      ctx.fill();
    }
    if (hover === index) {
      ctx.strokeStyle = rgba(colors.ink, 0.9);
      ctx.lineWidth = 1.25;
      ctx.stroke(whole);
    }
  };

  /** A folder's name, lying along the ground beside its slots: outside the hoop on the near half, inside it on the far half, never upside down. */
  const drawName = (run: Run) => {
    if (run.name === null) return;
    const mid = (run.from + run.to) / 2 + rot;
    const facing = Math.cos(mid);
    // Side on, a name would be read edgeways: it waits until its folder has come round.
    if (Math.abs(facing) < 0.3) return;
    const near = facing > 0;
    const out = near ? 1 + 15 / radius : 1 - 15 / radius;
    const [x, y] = point(mid, 0, out);
    const [ax, ay] = point(mid - 0.01, 0, out);
    const [bx, by] = point(mid + 0.01, 0, out);
    const room = radius * (run.to - run.from) * Math.abs(facing) - 6;
    const name = run.name.toUpperCase();
    ctx.font = `500 9px ${font}`;
    if (ctx.measureText(name).width > room) return;
    ctx.save();
    ctx.translate(x, y + (near ? 3 : 0));
    ctx.rotate(Math.atan2(by - ay, bx - ax) + (near ? 0 : Math.PI));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = rgba(colors.muted, near ? 0.95 : 0.6);
    ctx.fillText(name, 0, 0);
    ctx.restore();
  };

  /** The line between the core and the chat it is dealing with, and the bead that travels it the way the words go. */
  const drawLink = (now: number) => {
    if (link === null) return;
    const dealt = link;
    const index = slots.findIndex((slot) => slot.id === dealt.id);
    if (index === -1) return;
    const [sx, sy] = point(places[index].at + rot, 0.5);
    const mx = cx;
    const my = cy - band / 2;
    const reach = Math.hypot(sx - mx, sy - my);
    if (reach <= hole + 4) return;
    // From the core's own edge, not its middle: the line never crosses the core.
    const ex = mx + ((sx - mx) / reach) * hole;
    const ey = my + ((sy - my) / reach) * hole;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(sx, sy);
    ctx.strokeStyle = rgba(colors.accent, 0.55);
    ctx.lineWidth = 1;
    ctx.stroke();
    if (still) return;
    const along = (now % 1100) / 1100;
    const by = dealt.way === 'in' ? 1 - along : along;
    ctx.beginPath();
    ctx.arc(lerp(ex, sx, by), lerp(ey, sy, by), 2.5, 0, TAU);
    ctx.fillStyle = rgba(colors.accent, 1);
    ctx.fill();
  };

  return {
    resize(nextWidth: number, nextHeight: number, nextRatio: number) {
      width = nextWidth;
      height = nextHeight;
      ratio = nextRatio;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      fit();
    },

    /** Reads the colours and the mono face off the page: `from` is an element that wears the theme. */
    readTheme(from: HTMLElement) {
      const style = getComputedStyle(from);
      // Any colour CSS can write is read the one way that needs no parser: painted on one pixel and read off it.
      const probe = canvas.ownerDocument.createElement('canvas');
      probe.width = 1;
      probe.height = 1;
      const pixel = probe.getContext('2d', { willReadFrequently: true });
      const token = (name: string, fallback: Rgb): Rgb => {
        const color = style.getPropertyValue(name).trim();
        if (!color || !pixel) return fallback;
        pixel.clearRect(0, 0, 1, 1);
        pixel.fillStyle = 'rgba(0,0,0,0)';
        pixel.fillStyle = color;
        pixel.fillRect(0, 0, 1, 1);
        const [red, green, blue, alpha] = pixel.getImageData(0, 0, 1, 1).data;
        return alpha === 0 ? fallback : [red, green, blue];
      };
      colors = {
        ink: token('--ink-strong', FALLBACK.ink),
        tone: token('--ink', FALLBACK.tone),
        muted: token('--ink-muted', FALLBACK.muted),
        accent: token('--accent', FALLBACK.accent),
        bead: token('--signal-b', FALLBACK.bead),
      };
      font = style.getPropertyValue('--font-mono').trim() || font;
    },

    /** Whether the reader asked for less motion: nothing breathes or turns in a slot, and the hoop lands on a slot at once. */
    setStill(next: boolean) {
      still = next;
    },
    setNames(next: boolean) {
      names = next;
    },
    setFocused(next: boolean) {
      focused = next;
    },
    /** The chat the core is dealing with (null for none), and the core's own radius in px, where the line to it starts. */
    setLink(next: HaloLink | null, coreRadius: number) {
      link = next;
      hole = coreRadius;
    },

    /** The chats, in the list's order. The slot at the front stays at the front while its chat is still on the hoop. */
    setSlots(next: SessionsHaloSlot[]) {
      const kept = slots[frontOf(target)]?.id ?? null;
      slots = next;
      lay();
      paths = slots.map(() => null);
      hover = -1;
      const at = kept === null ? -1 : slots.findIndex((slot) => slot.id === kept);
      // A hoop first given its chats, or one whose front chat has gone, opens on the first that waits on the reader, else the first.
      const front = at !== -1 ? at : Math.max(0, slots.findIndex((slot) => slot.state === 'waiting'));
      if (places.length > 0) {
        target = -places[front].at;
        if (kept === null || at === -1) rot = target;
        else rot += fold(target - rot) - (target - rot);
      }
    },

    /** Draws one picture and answers which slot is at the front and which is under the pointer (-1 for none). */
    frame(now: number) {
      const elapsed = lastAt === 0 ? 0 : Math.min(0.05, (now - lastAt) / 1000);
      lastAt = now;
      if (drag === null) rot = still || Math.abs(target - rot) < 0.0005 ? target : rot + (target - rot) * (1 - Math.exp(-elapsed * 11));

      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.lineJoin = 'round';

      // The ground the band stands on: a hairline, so a hoop with no chat on it is still a hoop.
      ctx.beginPath();
      ctx.ellipse(cx, cy, radius, radius * TILT, 0, 0, TAU);
      ctx.strokeStyle = rgba(colors.tone, slots.length === 0 ? 0.3 : 0.14);
      ctx.lineWidth = 1;
      ctx.stroke();

      // Far half first, then the near half over it; within each, from the sides in, so what faces the reader is drawn last.
      const order = slots.map((_, index) => index).sort((a, b) => Math.cos(places[a].at + rot) - Math.cos(places[b].at + rot));
      for (const index of order) drawSlot(index, now);
      if (names) for (const run of runs) drawName(run);
      drawLink(now);

      const front = frontOf(rot);
      if (front !== -1) {
        // The pointer under the front, and the front slot's outline while the keyboard is on the hoop.
        const [x, y] = point(0, 0);
        ctx.beginPath();
        ctx.moveTo(x, y + 5);
        ctx.lineTo(x + 4, y + 12);
        ctx.lineTo(x - 4, y + 12);
        ctx.closePath();
        ctx.fillStyle = rgba(colors.muted, 0.8);
        ctx.fill();
        const path = paths[front];
        if (focused && path !== null) {
          ctx.strokeStyle = rgba(colors.ink, 1);
          ctx.lineWidth = 1.5;
          ctx.stroke(path);
        }
      }
      return { front, hover };
    },

    /** A pointer went down. True when it landed on the hoop, so the canvas holds the pointer until it lifts. */
    pointerDown(x: number, y: number) {
      const slot = slotAt(x, y);
      if (slot === -1) return false;
      drag = { x, moved: 0, rot, slot };
      return true;
    },
    /** A pointer moved: it turns the hoop while one is held, and says what it is over while none is. True when it is over a slot. */
    pointerMove(x: number, y: number) {
      if (drag !== null) {
        drag.moved = Math.max(drag.moved, Math.abs(x - drag.x));
        if (drag.moved >= 5) {
          rot = drag.rot + (x - drag.x) / radius;
          target = rot;
        }
        return true;
      }
      hover = slotAt(x, y);
      return hover !== -1;
    },
    /** The pointer lifted. A press that did not move turns its slot to the front, or, on the slot already there, asks for it to be opened. */
    pointerUp(): HaloPress {
      const lifted = drag;
      drag = null;
      if (lifted === null) return null;
      if (lifted.moved >= 5) {
        turnTo(frontOf(rot));
        return null;
      }
      if (lifted.slot === frontOf(target)) return { open: lifted.slot };
      turnTo(lifted.slot);
      return null;
    },
    pointerLeave() {
      hover = -1;
    },
    /** The wheel steps the hoop one slot, not faster than five a second. True when it took the wheel. */
    wheel(delta: number, now: number) {
      if (places.length < 2 || now - wheelAt < 200) return places.length >= 2;
      wheelAt = now;
      const count = places.length;
      turnTo(((frontOf(target) + (delta > 0 ? 1 : -1)) % count + count) % count);
      return true;
    },
    /** The arrows step the hoop; Home and End go to its first and last chat. True when the key was the hoop's. */
    key(key: string) {
      const count = places.length;
      if (count === 0) return false;
      const front = frontOf(target);
      if (key === 'ArrowRight' || key === 'ArrowDown') turnTo((front + 1) % count);
      else if (key === 'ArrowLeft' || key === 'ArrowUp') turnTo((front - 1 + count) % count);
      else if (key === 'Home') turnTo(0);
      else if (key === 'End') turnTo(count - 1);
      else return false;
      return true;
    },
    /** The slot the hoop is settling on: what the words read out. */
    front() {
      return frontOf(target);
    },
  };
}
