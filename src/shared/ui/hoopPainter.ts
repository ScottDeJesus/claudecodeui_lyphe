import type { HoopLink, HoopSlot, SubagentDot } from '@/shared/types';

// THE HOOP'S PAINTER: every thing of a set as one slot on a hoop that stands round a core, seen from a little above. A slot says how its
// thing stands in three tracks up the band's face: its top edge lit (whole for a chat's reply not read yet, as far as a bug's checklist
// has got); the square in the middle (dark for a thing asleep, lit and still for one awake, a ring of dashes turning in it while it is
// worked, filled in the accent and breathing while it waits on the reader, green once finished, red when it failed, three dots for a
// run's further things); a bead on the lower edge for each helper still at work, in its model's colour. A slot stands as tall as its
// thing weighs. The slots of one run (a folder, a lane, a state) stand together, a firmer wall and a little air between runs, the run's
// name along the ground beside it. The hoop turns: the slot at the front, over the pointer, is the one that is read out and the one a
// press opens.
//
// Drawn on a canvas because every slot leans with the hoop as it turns; the component over it (`Hoop`) owns the element, its events and
// the words.

type Rgb = readonly [number, number, number];
type Colors = { ink: Rgb; tone: Rgb; muted: Rgb; accent: Rgb; positive: Rgb; danger: Rgb; tube: Rgb; wire: Rgb; plasma: Rgb };

const TAU = Math.PI * 2;
/** How far the hoop leans toward the reader: its depth on screen over its width. */
const TILT = 0.52;
/** The tallest the band stands, in px: a hoop as wide as an instrument at home stands its slots as tall as this. */
const BAND_MOST = 64;
/** The air between two runs, in radians, and the most of a slot's own width its side walls keep clear. */
const RUN_GAP = 0.09;
/** The tracks up the band's face, 0 at its foot and 1 at its top: the square, the lit edge, the bead. */
const SQUARE: readonly [number, number] = [0.24, 0.78];
const EDGE_FROM = 0.84;
/** The most the lit edge stands, in px, however tall the band. */
const EDGE_MOST = 6;
const BEAD_AT = 0.11;
/** The most beads one slot shows, and how much of the slot's width they may spread across. */
const MOST_BEADS = 3;
const BEADS_SPREAD = 0.5;

const FALLBACK: Colors = {
  ink: [255, 255, 255], tone: [238, 241, 244], muted: [149, 157, 166], accent: [242, 166, 90], positive: [111, 214, 171], danger: [255, 123, 107],
  tube: [255, 176, 102], wire: [95, 227, 255], plasma: [185, 162, 255],
};

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

/** A run of slots, for its name: where it starts, where it ends, and the name (null for things in no run). */
type Run = { from: number; to: number; name: string | null };

/** A press in progress: where it began, how far it has moved, and the hoop's turn when it began. */
type Drag = { x: number; moved: number; rot: number; slot: number };

/**
 * What a lifted press asks for: the slot at the front was pressed (open it), another slot was pressed and is turning to the front, or
 * nothing more than the turn the painter has already begun.
 */
type HoopPress = { open: number } | { turned: number } | null;

/**
 * The hoop in a box of `width` by `height`: its middle on the ground, its half-width and its band's height. Room is kept at the foot for
 * the pointer and a hair at the top so the far band's edge is whole. The painter stands the hoop by it, and `Hoop` stands what is in its
 * middle by it too (`hoopMiddle`), so the two never disagree. `lean` is how far the hoop is tipped toward the reader, as the share of
 * its width its depth takes (`TILT` unless the caller says): a hoop round a larger core leans less, so its opening is deeper.
 */
function hoopGeometry(width: number, height: number, lean = TILT) {
  const radius = Math.max(14, Math.min(width / 2 - 6, (height - 18) / (2 * lean + 0.18)));
  // The band keeps its share of the hoop as the hoop grows: a large hoop with a narrow band would read as a thin ring.
  const band = clamp(radius * 0.18, 12, BAND_MOST);
  return { cx: width / 2, cy: 4 + band + radius * lean, radius, band };
}

/**
 * Where the hoop's opening has its middle, for what stands in it: over the ground's middle by half the band, as the eye reads it.
 *
 * Used by the kit's `Hoop`, which stands its middle there, and by project-workspace's `ChatDesk`, which lifts the chat's core by it.
 */
export function hoopMiddle(width: number, height: number, lean = TILT): { x: number; y: number } {
  const { cx, cy, band } = hoopGeometry(width, height, lean);
  return { x: cx, y: cy - band / 2 };
}

/**
 * The box's height that holds a hoop as wide as `width` whole, pointer and all: what a caller that knows only the width asks for.
 *
 * Used by the kit's `Hoop`, and by project-workspace's `ChatDesk`, the kanban module's `KanbanPanel` and the cerberus module's
 * `CerberusPanel`, which size the box round their hoops by it.
 */
export function hoopHeightFor(width: number, lean = TILT): number {
  return Math.round(18 + (2 * lean + 0.18) * (width / 2 - 6));
}

/**
 * The widest hoop whose box is at most `height` tall: `hoopHeightFor` turned round, for a caller that knows the room it has.
 *
 * Used by the kanban module's `KanbanPanel` and the cerberus module's `CerberusPanel`, which fit their hoops to the scene's room.
 */
export function hoopWidthFor(height: number, lean = TILT): number {
  return Math.max(0, Math.floor(2 * ((height - 18) / (2 * lean + 0.18) + 6)));
}

/**
 * The hoop's painter over one canvas. Every method is cheap to call per event; `frame` is the one that draws.
 *
 * Used by the kit's `Hoop`, which owns the canvas element and its events.
 */
export function createHoopPainter(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  let slots: HoopSlot[] = [];
  let places: Place[] = [];
  let runs: Run[] = [];
  let width = 0;
  let height = 0;
  let ratio = 1;
  // The hoop in the canvas it has: its middle, its half-width, its band's height.
  let cx = 0;
  let cy = 0;
  let radius = 60;
  // How far the hoop is tipped toward the reader (`hoopGeometry`'s `lean`); the caller's, given with its size.
  let lean = TILT;
  let band = 18;
  // The most of the hoop one slot takes, in radians: the whole hoop shared out among a few slots would make each a wall half round it.
  let most = TAU;
  // Whether the runs' names are written round it (a hoop standing small writes none).
  let names = true;
  let colors = FALLBACK;
  let font = 'ui-monospace, monospace';
  // The hoop's turn now and the turn it is settling to. A slot at angle 0 (after the turn) is at the front.
  let rot = 0;
  let target = 0;
  let hover = -1;
  // Where the pointer last was over the hoop, or null while it is off it: what is under it is asked again as the hoop turns beneath it.
  let pointer: [number, number] | null = null;
  let drag: Drag | null = null;
  let lastAt = 0;
  let wheelAt = 0;
  let still = false;
  // Whether the keyboard's focus is on the hoop: the slot at the front is then outlined.
  let focused = false;
  // The slots as they were last drawn, for a press to land on.
  let paths: Array<Path2D | null> = [];
  // The slot the middle is dealing with now, and which way the words go; and how far from the middle the core's own edge is, in px.
  let link: HoopLink | null = null;
  let hole = 0;

  /** What a helper's bead is filled with: its model's material, the bright ink for Mercury, the quiet ink for a model not known. */
  const beadColor = (bead: SubagentDot): Rgb => (
    bead === 'tube' ? colors.tube : bead === 'wire' ? colors.wire : bead === 'plasma' ? colors.plasma : bead === 'mercury' ? colors.ink : colors.muted
  );

  /** A point on the band: `angle` round from the front, `up` the band's face from foot (0) to top (1), `out` its distance from the axis in radii. */
  const point = (angle: number, up: number, out = 1): [number, number] => [
    cx + radius * out * Math.sin(angle),
    cy + radius * out * lean * Math.cos(angle) - up * band,
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

  /** Each slot's share of the hoop: equal shares (never more than `most`), a run's slots side by side, air between one run and the next. */
  const lay = () => {
    const count = slots.length;
    places = [];
    runs = [];
    if (count === 0) return;
    let groups = 0;
    for (let index = 0; index < count; index += 1) {
      if (index === 0 || slots[index].group !== slots[index - 1].group) groups += 1;
    }
    const gap = groups > 1 ? Math.min(RUN_GAP, TAU / count / 3) : 0;
    const share = Math.min(most, (TAU - groups * gap) / count);
    let at = 0;
    for (let index = 0; index < count; index += 1) {
      const opens = index === 0 || slots[index].group !== slots[index - 1].group;
      if (opens) {
        if (index > 0) at += gap;
        runs.push({ from: at, to: at, name: slots[index].groupName });
      }
      places.push({ at: at + share / 2, width: share });
      at += share;
      runs[runs.length - 1].to = at;
    }
  };

  const fit = () => {
    ({ cx, cy, radius, band } = hoopGeometry(width, height, lean));
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

  /** A slot's square, filled and outlined in one colour: steady, or breathing while it waits on the reader. */
  const fillSquare = (square: Path2D, color: Rgb, fill: number, shade: number) => {
    ctx.fillStyle = rgba(color, fill * lerp(0.7, 1, shade));
    ctx.fill(square);
    ctx.strokeStyle = rgba(color, lerp(0.7, 1, shade));
    ctx.lineWidth = 1.25;
    ctx.stroke(square);
  };

  const drawSlot = (index: number, now: number) => {
    const slot = slots[index];
    const place = places[index];
    const tall = clamp(slot.height ?? 1, 0.3, 1);
    const mid = place.at + rot;
    const edge = Math.min(0.02, place.width * 0.1);
    const low = mid - place.width / 2 + edge;
    const high = mid + place.width / 2 - edge;
    // The near half is seen from outside and full on; the far half from inside, quieter, and quieter still side on.
    const near = Math.cos(mid) > 0;
    const shade = lerp(0.45, 1, Math.abs(Math.cos(mid))) * (near ? 1 : 0.62);
    const whole = piece(low, high, 0, tall);
    paths[index] = whole;

    // Its frame: all a thing asleep shows.
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(colors.tone, 0.3 * shade);
    ctx.stroke(whole);

    if (slot.state === 'more') {
      // A run's further things: three dots across the middle of the face, the design system's `more` mark.
      const size = clamp(band * tall * 0.07, 1.3, 2.4);
      for (let dot = -1; dot <= 1; dot += 1) {
        const [x, y] = point(mid + dot * (high - low) * 0.18, tall * (SQUARE[0] + SQUARE[1]) / 2);
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fillStyle = rgba(colors.muted, Math.min(1, shade + 0.2));
        ctx.fill();
      }
    } else if (slot.state !== 'asleep') {
      const square = piece(low, high, SQUARE[0] * tall, SQUARE[1] * tall);
      if (slot.state === 'waiting') {
        // Stopped on the reader: the square in the accent, breathing. Everything that waits breathes together.
        const breath = still ? 1 : clamp(0.5 + 2.2 * Math.sin((now / 1000) * TAU / 1.15), 0, 1);
        ctx.fillStyle = rgba(colors.accent, lerp(0.3, 0.95, breath) * lerp(0.7, 1, shade));
        ctx.fill(square);
        ctx.strokeStyle = rgba(colors.accent, lerp(0.7, 1, shade));
        ctx.lineWidth = 1.25;
        ctx.stroke(square);
      } else if (slot.state === 'done') {
        // Finished: the square green, still.
        fillSquare(square, colors.positive, 0.62, shade);
      } else if (slot.state === 'failed') {
        // Failed: the square in the danger ink, still.
        fillSquare(square, colors.danger, 0.62, shade);
      } else {
        if (slot.state === 'working') {
          // At work: the square in the bright ink, breathing, so the card in hand is found at a glance.
          const pulse = still ? 1 : 0.5 + 0.5 * Math.sin((now / 1000) * TAU / 1.6);
          ctx.fillStyle = rgba(colors.ink, lerp(0.35, 0.8, pulse) * lerp(0.75, 1, shade));
          ctx.fill(square);
          ctx.strokeStyle = rgba(colors.ink, lerp(0.8, 1, shade));
          ctx.lineWidth = 1.5;
          ctx.stroke(square);
        } else {
          ctx.fillStyle = rgba(colors.tone, 0.2 * shade);
          ctx.fill(square);
          ctx.strokeStyle = rgba(colors.tone, 0.5 * shade);
          ctx.lineWidth = 1;
          ctx.stroke(square);
        }
        if (slot.state === 'working') {
          // At work: twelve accent dashes round a hairline track, lying on the band's face, once round every 2.4 s.
          const span = high - low;
          const reach = Math.min(band * tall * (SQUARE[1] - SQUARE[0]) * 0.42, radius * span * 0.32);
          const across = reach / radius;
          const up = reach / band;
          const middle = tall * (SQUARE[0] + SQUARE[1]) / 2;
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
    const lit = clamp(slot.edge, 0, 1);
    if (lit > 0) {
      // The top edge, lit from the slot's start as far as its share: whole for a reply unread, a checklist's share done. It keeps to
      // a hairline's few px on a tall band, where its share of the band would make it a bar.
      const from = Math.max(EDGE_FROM * tall, tall - EDGE_MOST / band);
      if (lit < 1) {
        ctx.fillStyle = rgba(colors.tone, 0.14 * shade);
        ctx.fill(piece(low, high, from, tall));
      }
      ctx.fillStyle = rgba(colors.ink, Math.min(1, shade + 0.25));
      ctx.fill(piece(low, lerp(low, high, lit), from, tall));
    }
    if (slot.beads.length > 0) {
      // One bead for each helper, side by side along the foot of the slot and swaying together, each in its model's colour.
      const beads = slot.beads.slice(0, MOST_BEADS);
      const sway = still ? 0 : Math.sin(now / 450 + index) * (high - low) * 0.12;
      const step = beads.length > 1 ? ((high - low) * BEADS_SPREAD) / (beads.length - 1) : 0;
      const size = clamp(band * 0.08, 1.6, 3);
      beads.forEach((bead, at) => {
        const [x, y] = point(mid + sway + (at - (beads.length - 1) / 2) * step, BEAD_AT * tall);
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fillStyle = rgba(beadColor(bead), Math.min(1, shade + 0.3));
        ctx.fill();
      });
    }
    if (hover === index) {
      ctx.strokeStyle = rgba(colors.ink, 0.9);
      ctx.lineWidth = 1.25;
      ctx.stroke(whole);
    }
  };

  /** A run's name, lying along the ground beside its slots: outside the hoop on the near half, inside it on the far half, never upside down. */
  const drawName = (run: Run) => {
    if (run.name === null) return;
    const mid = (run.from + run.to) / 2 + rot;
    const facing = Math.cos(mid);
    // Side on, a name would be read edgeways: it waits until its run has come round.
    if (Math.abs(facing) < 0.3) return;
    const near = facing > 0;
    const out = near ? 1 + 15 / radius : 1 - 15 / radius;
    const [x, y] = point(mid, 0, out);
    const [ax, ay] = point(mid - 0.01, 0, out);
    const [bx, by] = point(mid + 0.01, 0, out);
    const room = radius * (run.to - run.from) * Math.abs(facing) - 6;
    const name = run.name.toUpperCase();
    ctx.font = `500 9px ${font}`;
    const wide = ctx.measureText(name).width;
    if (wide > room) return;
    // Standing at the front it would lie over the pointer, and the reading under the hoop already names the run there.
    if (near && Math.abs(x - cx) < wide / 2 + 8) return;
    ctx.save();
    ctx.translate(x, y + (near ? 3 : 0));
    ctx.rotate(Math.atan2(by - ay, bx - ax) + (near ? 0 : Math.PI));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = rgba(colors.muted, near ? 0.95 : 0.6);
    ctx.fillText(name, 0, 0);
    ctx.restore();
  };

  /** The line between the middle and the slot it is dealing with, and the bead that travels it the way the words go. */
  const drawLink = (now: number) => {
    if (link === null) return;
    const dealt = link;
    const index = slots.findIndex((slot) => slot.id === dealt.id);
    if (index === -1) return;
    const [sx, sy] = point(places[index].at + rot, 0.5 * clamp(slots[index].height ?? 1, 0.3, 1));
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
    resize(nextWidth: number, nextHeight: number, nextRatio: number, nextLean = TILT) {
      width = nextWidth;
      height = nextHeight;
      ratio = nextRatio;
      lean = nextLean;
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
        positive: token('--pos-dot', FALLBACK.positive),
        danger: token('--danger-dot', FALLBACK.danger),
        tube: token('--tube', FALLBACK.tube),
        wire: token('--wire', FALLBACK.wire),
        plasma: token('--plasma', FALLBACK.plasma),
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
    /** The most of the hoop one slot may take, in radians: the whole hoop (`TAU`) lets a few slots share it out between them. */
    setMost(next: number) {
      if (next === most) return;
      most = next;
      lay();
    },
    /** The slot the middle is dealing with (null for none), and the core's own radius in px, where the line to it starts. */
    setLink(next: HoopLink | null, coreRadius: number) {
      link = next;
      hole = coreRadius;
    },

    /** The slots, in their order. The slot at the front stays where it stands while its thing is still on the hoop: a new order moves the others, never turns the hoop. */
    setSlots(next: HoopSlot[]) {
      const kept = slots[frontOf(target)]?.id ?? null;
      // What is left of a turn under way, carried over so a turn the reader gave still ends where it was going.
      const lead = rot - target;
      slots = next;
      lay();
      paths = slots.map(() => null);
      hover = -1;
      const at = kept === null ? -1 : slots.findIndex((slot) => slot.id === kept);
      // A hoop first given its slots, or one whose front thing has gone, opens on the first that waits on the reader, else the first.
      const front = at !== -1 ? at : Math.max(0, slots.findIndex((slot) => slot.state === 'waiting'));
      if (places.length > 0) {
        target = -places[front].at;
        rot = kept === null || at === -1 ? target : target + lead;
      }
    },

    /** Stands the slot `id` at the front at once, with no turn drawn. False while that slot is not on the hoop. */
    bring(id: string) {
      const at = slots.findIndex((slot) => slot.id === id);
      if (at === -1 || at >= places.length) return false;
      target = -places[at].at;
      rot = target;
      return true;
    },

    /** Where the slot `id` stands in the canvas now, at the middle of its top edge; null while it is not on the hoop. */
    pointOf(id: string): [number, number] | null {
      const at = slots.findIndex((slot) => slot.id === id);
      if (at === -1 || at >= places.length) return null;
      return point(places[at].at + rot, clamp(slots[at].height ?? 1, 0.3, 1));
    },

    /** The slot `id`'s direction from the hoop's middle, in degrees counter-clockwise from three o'clock; null while it is not on the hoop. */
    azimuthOf(id: string): number | null {
      const at = slots.findIndex((slot) => slot.id === id);
      if (at === -1 || at >= places.length) return null;
      const [x, y] = point(places[at].at + rot, 0.5 * clamp(slots[at].height ?? 1, 0.3, 1));
      return (Math.atan2(cy - band / 2 - y, x - cx) * 180) / Math.PI;
    },

    /** Draws one picture and answers which slot is at the front and which is under the pointer (-1 for none). */
    frame(now: number) {
      const elapsed = lastAt === 0 ? 0 : Math.min(0.05, (now - lastAt) / 1000);
      lastAt = now;
      if (drag === null) rot = still || Math.abs(target - rot) < 0.0005 ? target : rot + (target - rot) * (1 - Math.exp(-elapsed * 11));

      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.lineJoin = 'round';

      // The ground the band stands on: a hairline, so a hoop with nothing on it is still a hoop.
      ctx.beginPath();
      ctx.ellipse(cx, cy, radius, radius * lean, 0, 0, TAU);
      ctx.strokeStyle = rgba(colors.tone, slots.length === 0 ? 0.3 : 0.14);
      ctx.lineWidth = 1;
      ctx.stroke();

      // Far half first, then the near half over it; within each, from the sides in, so what faces the reader is drawn last.
      const order = slots.map((_, index) => index).sort((a, b) => Math.cos(places[a].at + rot) - Math.cos(places[b].at + rot));
      for (const index of order) drawSlot(index, now);
      // The hoop may have turned under a pointer that did not move (the wheel, a press on another slot): what it is over is read off this picture.
      if (pointer !== null && drag === null) hover = slotAt(pointer[0], pointer[1]);
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
      pointer = [x, y];
      hover = slotAt(x, y);
      return hover !== -1;
    },
    /** The pointer lifted. A press that did not move turns its slot to the front, or, on the slot already there, asks for it to be opened. */
    pointerUp(): HoopPress {
      const lifted = drag;
      drag = null;
      if (lifted === null) return null;
      if (lifted.moved >= 5) {
        turnTo(frontOf(rot));
        return null;
      }
      if (lifted.slot === frontOf(target)) return { open: lifted.slot };
      turnTo(lifted.slot);
      return { turned: lifted.slot };
    },
    pointerLeave() {
      pointer = null;
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
    /** The arrows step the hoop; Home and End go to its first and last slot. True when the key was the hoop's. */
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
