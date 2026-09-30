type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Box = { left: number; top: number; right: number; bottom: number };

/**
 * The drawn disc's width and height. The layout's own `RADIAL_ITEM_PX` (72px) is the room an item is given, the
 * disc and the air around it, which is what keeps neighbours apart in a tight corner; the disc is what stands
 * in that room, and 48px is over the 44px a finger needs. Used by AppSwitcherRadial, which sizes each disc to it.
 */
export const RADIAL_DISC_PX = 48;

/** Which side of its disc an item's label is drawn on. */
export type RadialLabelSide = 'right' | 'left' | 'above' | 'below';

/** The label pill's height: one 16px line of 12px text and 4px of padding above and below. */
const LABEL_HEIGHT_PX = 24;
/** The air between a disc's edge and its label. */
const LABEL_GAP_PX = 6;
/** The gap a label keeps from the viewport's edge, the same 8px the discs keep. */
const LABEL_EDGE_PX = 8;
/** A label's own padding and border, left and right, in the pill: 8px of padding and 1px of border a side. */
const LABEL_PADDING_PX = 18;
/** The room a candidate label is asked to keep clear of a neighbour, so an estimate a few pixels short is not an overlap. */
const LABEL_CLEARANCE_PX = 4;
/** What one Latin character of 12px medium text measures on average; measured on the drawn pills. */
const LATIN_CHAR_PX = 6.4;
/** What one CJK character measures: a full em. */
const WIDE_CHAR_PX = 12;
/** The shortcut chip beside a label: its own padding and border, and the gap that separates it from the word. */
const SHORTCUT_EXTRA_PX = 18;
/** The FAB's catch: a press within 22px of its centre is the FAB's, and a label standing there would be pressed instead. */
const FAB_CATCH_PX = 44;
/** The most a label's WORD may draw when the room is too short for the whole word (the chip beside it is not cut). */
const CLIPPED_TEXT_PX = 64;

const WIDE_CHARACTER = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/;

/**
 * How wide a label's pill will draw, estimated from its text, before the browser has drawn one: a layout cannot
 * wait for a measurement to decide which side a pill stands on. Wide scripts count a full em a character, Latin
 * and Cyrillic about half; a shortcut adds its own chip; `textClip` is the most the word itself may draw (the
 * pill's `truncate` past it). The constants are read off the drawn pills — the radial's fixture measures the
 * two side by side, which is why this is exported — and an estimate a few pixels short only moves where two
 * near-touching labels would have met, since the side is chosen with `LABEL_CLEARANCE_PX` to spare.
 */
export function estimateLabelWidth(label: string, shortcut: string | null, textClip = Infinity): number {
  const text = Array.from(label).reduce(
    (total, character) => total + (WIDE_CHARACTER.test(character) ? WIDE_CHAR_PX : LATIN_CHAR_PX),
    0,
  );
  const chip = shortcut === null ? 0 : Array.from(shortcut).length * LATIN_CHAR_PX + SHORTCUT_EXTRA_PX;
  return Math.ceil(Math.min(text, textClip) + chip + LABEL_PADDING_PX);
}

/** The circle through three points: the arc's centre, which is the FAB. Null for three points in a line. */
function circumcentre(a: Point, b: Point, c: Point): Point | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-6) return null;
  const sa = a.x ** 2 + a.y ** 2;
  const sb = b.x ** 2 + b.y ** 2;
  const sc = c.x ** 2 + c.y ** 2;
  return {
    x: (sa * (b.y - c.y) + sb * (c.y - a.y) + sc * (a.y - b.y)) / d,
    y: (sa * (c.x - b.x) + sb * (a.x - c.x) + sc * (b.x - a.x)) / d,
  };
}

/** The label pill's box on one side of a disc, held inside the viewport the way the drawn pill is (see `labelTranslate`). */
function labelBox(at: Point, width: number, side: RadialLabelSide, viewport: Size): Box {
  const reach = RADIAL_DISC_PX / 2 + LABEL_GAP_PX;
  let left = at.x - width / 2;
  let top = at.y - LABEL_HEIGHT_PX / 2;
  if (side === 'right') left = at.x + reach;
  if (side === 'left') left = at.x - reach - width;
  if (side === 'above') top = at.y - reach - LABEL_HEIGHT_PX;
  if (side === 'below') top = at.y + reach;
  left = Math.min(Math.max(left, LABEL_EDGE_PX), viewport.width - LABEL_EDGE_PX - width);
  top = Math.min(Math.max(top, LABEL_EDGE_PX), viewport.height - LABEL_EDGE_PX - LABEL_HEIGHT_PX);
  return { left, top, right: left + width, bottom: top + LABEL_HEIGHT_PX };
}

function discBox(at: Point): Box {
  const half = RADIAL_DISC_PX / 2;
  return { left: at.x - half, top: at.y - half, right: at.x + half, bottom: at.y + half };
}

/** How much two boxes cover of each other, in square pixels: 0 when they do not meet. */
function coverage(a: Box, b: Box): number {
  const across = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return across > 0 && down > 0 ? across * down : 0;
}

/** The sides an item may take, in order of preference: outward on the axis it leans along most, the far sides last. */
function preferredSides(point: Point, centre: Point): RadialLabelSide[] {
  const opposite = (side: RadialLabelSide): RadialLabelSide =>
    ({ right: 'left', left: 'right', above: 'below', below: 'above' } as const)[side];
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  const horizontal: RadialLabelSide = dx >= 0 ? 'right' : 'left';
  const vertical: RadialLabelSide = dy >= 0 ? 'below' : 'above';
  return Math.abs(dx) >= Math.abs(dy)
    ? [horizontal, vertical, opposite(vertical), opposite(horizontal)]
    : [vertical, horizontal, opposite(horizontal), opposite(vertical)];
}

/**
 * The assignment of a side to every item that covers the least, and how much it covers.
 *
 * Every candidate label is measured against everything it must stay off — every disc (its own too: a label
 * clamped against a wall can be pushed back over its disc), the FAB's catch, and the labels already placed —
 * with `LABEL_CLEARANCE_PX` of margin, and its cost is the area it covers. The search is depth-first in
 * preference order and stops at the first assignment that covers nothing, so items early in the arc keep their
 * outward side and a later item with none left makes an earlier one give way; a greedy pass in arc order
 * cannot do that, because the last item, boxed in by two neighbours, would draw over one of them. Five items
 * and four sides is 1,024 assignments at the worst. When none clears, the least-covering one stands, so a
 * tight corner degrades to the smallest overlap instead of to whichever side was tried first.
 */
function leastCovering(
  points: Point[],
  widths: number[],
  centre: Point,
  viewport: Size,
): { sides: RadialLabelSide[]; cost: number } {
  const discs = points.map(discBox);
  const catchHalf = FAB_CATCH_PX / 2;
  const fab: Box = { left: centre.x - catchHalf, top: centre.y - catchHalf, right: centre.x + catchHalf, bottom: centre.y + catchHalf };
  const preferences = points.map((point) => preferredSides(point, centre));

  const best: { sides: RadialLabelSide[] | null; cost: number } = { sides: null, cost: Infinity };
  const chosen: RadialLabelSide[] = [];
  const placed: Box[] = [];
  const search = (index: number, cost: number): boolean => {
    if (cost >= best.cost) return false;
    if (index === points.length) {
      best.sides = [...chosen];
      best.cost = cost;
      return cost === 0;
    }
    for (const side of preferences[index]) {
      const box = labelBox(points[index], widths[index] ?? 0, side, viewport);
      const wider: Box = {
        left: box.left - LABEL_CLEARANCE_PX,
        top: box.top - LABEL_CLEARANCE_PX,
        right: box.right + LABEL_CLEARANCE_PX,
        bottom: box.bottom + LABEL_CLEARANCE_PX,
      };
      const covered =
        discs.reduce((total, disc) => total + coverage(wider, disc), 0) +
        coverage(wider, fab) +
        placed.reduce((total, taken) => total + coverage(wider, taken), 0);
      chosen[index] = side;
      placed[index] = box;
      if (search(index + 1, cost + covered)) return true;
      placed.length = index;
    }
    return false;
  };
  search(0, 0);
  return { sides: best.sides ?? preferences.map((order) => order[0]), cost: best.cost };
}

/** Where every label stands, and whether their words had to be cut short to make room. */
export type RadialLabelPlan = {
  sides: RadialLabelSide[];
  /** The most a label's word may draw before it truncates, or null when every word draws whole. */
  textClip: number | null;
};

/**
 * Where each item's label goes. Used by AppSwitcherRadial.
 *
 * The whole words first: each label on its outward side where it can stand clear of the discs, the FAB and
 * the other labels (`leastCovering`). Where they cannot all stand clear — a phone's corner, the longest
 * label the radial draws ("Collapse chat" and its chip, 158px), a language with long words — the words are
 * cut to `CLIPPED_TEXT_PX` and the arc is searched again, and the plan that covers less stands. A cut word
 * is a visual truncation only: the button's name is still the whole word.
 *
 * The arc's centre, which is the FAB, is read off the points themselves (the circle through the first, middle
 * and last), so the radial needs no FAB rect: `points` is all it is given.
 */
export function planRadialLabels(
  points: Point[],
  labels: Array<{ label: string; shortcut: string | null }>,
  viewport: Size,
): RadialLabelPlan {
  const count = points.length;
  const centre =
    count >= 3 ? circumcentre(points[0], points[Math.floor(count / 2)], points[count - 1]) : null;
  if (centre === null) return { sides: points.map(() => 'right'), textClip: null };

  const whole = leastCovering(points, labels.map((entry) => estimateLabelWidth(entry.label, entry.shortcut)), centre, viewport);
  if (whole.cost === 0) return { sides: whole.sides, textClip: null };
  const cut = leastCovering(
    points,
    labels.map((entry) => estimateLabelWidth(entry.label, entry.shortcut, CLIPPED_TEXT_PX)),
    centre,
    viewport,
  );
  return cut.cost < whole.cost ? { sides: cut.sides, textClip: CLIPPED_TEXT_PX } : { sides: whole.sides, textClip: null };
}

/**
 * The CSS `transform` that stands a label pill on its side of the disc it hangs from. Used by AppSwitcherRadial.
 *
 * The pill is absolutely positioned at its disc's centre, so the translate is measured from there, and
 * `%` in a translate is the pill's own size — which is how one string places a pill whose width nobody
 * measured. `clamp()` then holds it inside the viewport: the disc's centre stands 44px from a wall, so a
 * pill centred on it (above or below) would run off the screen for any pill wider than 88px. The centre
 * is the disc's own viewport point, so the wall is `100vw - x` away and the clamp is exact with no
 * measurement and no resize listener.
 */
export function labelTranslate(side: RadialLabelSide, at: Point): string {
  const reach = RADIAL_DISC_PX / 2 + LABEL_GAP_PX;
  const across = (preferred: string) =>
    `clamp(${LABEL_EDGE_PX - at.x}px, ${preferred}, calc(100vw - ${LABEL_EDGE_PX + at.x}px - 100%))`;
  const down = (preferred: string) =>
    `clamp(${LABEL_EDGE_PX - at.y}px, ${preferred}, calc(100dvh - ${LABEL_EDGE_PX + at.y}px - 100%))`;

  if (side === 'right') return `translate(${across(`${reach}px`)}, ${down('-50%')})`;
  if (side === 'left') return `translate(${across(`calc(-100% - ${reach}px)`)}, ${down('-50%')})`;
  if (side === 'above') return `translate(${across('-50%')}, ${down(`calc(-100% - ${reach}px)`)})`;
  return `translate(${across('-50%')}, ${down(`${reach}px`)})`;
}
