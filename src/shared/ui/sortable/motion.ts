/**
 * The motion of a carry, apart from its logic: how the neighbours slide into the room a reorder makes,
 * how the dropped item settles into its slot, and how the pane scrolls when the carry nears its edge.
 *
 * A DOM MOVE LOSES SCROLL. React puts a list in a new order by re-inserting the nodes it judges out of
 * place — when a card is carried toward the front, the cards it passed, not the carried one — and an
 * element that is removed and inserted again comes back scrolled to 0, with every scroller inside it:
 * a deck's strip (its counter, React state, still says "Card 2 of 2") and an ask band's census region.
 * So the offsets are taken before a reorder and put back after it (`scrollOffsetsWithin`).
 *
 * THE CARRIED ITEM IS BACKED WITH THE SURFACE IT STANDS ON (`surfaceBehind`). A card drawn on a
 * translucent ground (a deck is `bg-muted/40`) would show whatever it is carried over through itself,
 * two heads read at once; the item takes the colour of the ground it was lifted from, so it hides what
 * is beneath it and, over its own ground, looks exactly as it did.
 *
 * NOTHING SLIDES UNDER `prefers-reduced-motion`. The carried item still follows the pointer (that is
 * the carry, not a flourish), but every neighbour and the settling drop land where they land.
 *
 * THE SLIDE IS A FLIP, ON THE NEIGHBOUR'S OWN TRANSFORM: before the reorder each item's drawn box is
 * read, after it each one's new box, and the difference is played back as a translate from where the
 * item WAS to where it now is — through the Web Animations API, so no style attribute is written and
 * no element is added to the page. The slide is the only change a neighbour wears.
 */

/** The slide's length: the kit's `quick` (200 ms), and its `enter` curve spelt out, because the animation API takes no `var()`. */
const SLIDE_MS = 200;
const SLIDE_EASING = 'cubic-bezier(.22,1,.36,1)';

/** How near the pane's edge (px) a carry starts to scroll it, and the most it scrolls in one frame. */
const EDGE_ZONE_PX = 56;
const EDGE_MAX_STEP_PX = 22;

/**
 * How deep into an edge zone a pointer must be pulled, in zone depths (1 is the pane's own edge), for the
 * edge a carry BEGAN in to let go of it: more than two zones' depth past the pane is a pull toward
 * scrolling, which no reorder among the rows in view needs.
 */
const EDGE_HOLD_RELEASE_DEPTH = 3;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Plays `element` from where it was drawn (`from`) to where it now stands, unless the reader asked for no motion. */
export function slideFrom(element: HTMLElement, from: DOMRect): Animation | null {
  if (reducedMotion()) return null;
  const to = element.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return null;
  return element.animate(
    [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }],
    { duration: SLIDE_MS, easing: SLIDE_EASING },
  );
}

/** The nearest ancestor of `element` that scrolls vertically: the pane a carry travels in. `null` when the page itself scrolls. */
export function scrollerOf(element: Element): HTMLElement | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

/** How deep into an edge zone a pointer at `pointerY` is, in zone depths: 0 away from the edges, 1 at the pane's own edge, more past it; signed (negative is the top edge). */
function edgeDepth(scroller: HTMLElement, pointerY: number): number {
  const box = scroller.getBoundingClientRect();
  const top = Math.max(box.top, 0) + EDGE_ZONE_PX;
  const bottom = Math.min(box.bottom, window.innerHeight) - EDGE_ZONE_PX;
  if (pointerY < top) return -(top - pointerY) / EDGE_ZONE_PX;
  return pointerY > bottom ? (pointerY - bottom) / EDGE_ZONE_PX : 0;
}

/** How far the pane scrolls this frame for a pointer at `pointerY`: 0 away from its edges, up to a step near them, signed (negative is up). */
export function edgeStep(scroller: HTMLElement, pointerY: number): number {
  const depth = edgeDepth(scroller, pointerY);
  if (depth === 0) return 0;
  return Math.sign(depth) * Math.max(1, Math.round(EDGE_MAX_STEP_PX * Math.min(Math.abs(depth), 1)));
}

/**
 * The edge a carry still holds, for a pointer at `pointerY`: `held` (-1 the top zone, 1 the bottom, 0 none) while
 * the pointer is in that zone, and 0 once it is out of it or pulled `EDGE_HOLD_RELEASE_DEPTH` zones into it. A carry
 * begins holding the edge its first point is in (the sign of `edgeStep` there), so a row merely drawn in a zone does
 * not run the pane, and a pointer carried far past the pane's edge — or out of the zone and back — does.
 */
export function edgeHoldAt(scroller: HTMLElement, pointerY: number, held: number): number {
  const depth = edgeDepth(scroller, pointerY);
  return Math.sign(depth) === held && Math.abs(depth) < EDGE_HOLD_RELEASE_DEPTH ? held : 0;
}

/** Whether a computed colour is wholly transparent: the keyword, `rgba(…, 0)`, or the `color(… / 0)` form `color-mix` computes to. */
const isClear = (colour: string) => colour === 'transparent' || /^rgba\(.*,\s*0\)$/.test(colour) || /\/\s*0(?:\.0+)?\)$/.test(colour);

/** The colour `element` stands on: the first ancestor background that is not clear, else the page's own. */
export function surfaceBehind(element: Element): string {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const colour = getComputedStyle(node).backgroundColor;
    if (!isClear(colour)) return colour;
  }
  return getComputedStyle(document.body).backgroundColor;
}

/**
 * The corner radius of the card an item is made of: the first descendant, within a few levels, that is
 * rounded and spans the item (a plan's `Card`, a deck's section) — so the item's backing meets that
 * card's corners instead of squaring them. A narrower rounded thing (a pin above the card) is not it.
 */
export function radiusOf(element: Element): string {
  const width = element.getBoundingClientRect().width;
  let level: Element[] = [...element.children];
  for (let depth = 0; depth < 4 && level.length > 0; depth += 1) {
    const deeper: Element[] = [];
    for (const node of level) {
      const { borderRadius } = getComputedStyle(node);
      if (borderRadius !== '0px' && node.getBoundingClientRect().width >= width * 0.9) return borderRadius;
      deeper.push(...node.children);
    }
    level = deeper;
  }
  return '';
}

/** One scrolled element and where it was scrolled to. */
export type ScrollOffset = { node: HTMLElement; left: number; top: number };

/** Every scrolled element in or under `roots`, with its offsets: taken before a reorder, handed to `restoreScrollOffsets` after. */
export function scrollOffsetsWithin(roots: Iterable<HTMLElement>): ScrollOffset[] {
  const held: ScrollOffset[] = [];
  for (const root of roots) {
    for (const node of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
      if (node.scrollLeft !== 0 || node.scrollTop !== 0) held.push({ node, left: node.scrollLeft, top: node.scrollTop });
    }
  }
  return held;
}

/** Puts every scroller back where `scrollOffsetsWithin` found it. */
export function restoreScrollOffsets(held: readonly ScrollOffset[]): void {
  for (const { node, left, top } of held) {
    node.scrollLeft = left;
    node.scrollTop = top;
  }
}
