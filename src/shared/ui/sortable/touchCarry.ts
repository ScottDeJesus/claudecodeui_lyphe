/**
 * What a lifted touch carry needs from the page, and nothing the browser does for it: the BROWSER scrolls
 * every swipe, and a row that has lifted survives the browser's pan.
 *
 * WHY A LIFTED ROW NEEDS ANYTHING. Some phones dispatch every touch uncancelable from its `touchstart` (measured on a
 * Galaxy Z Fold 8: `cancelable=false` whatever listeners stand), so no `preventDefault` can stop the pan the browser
 * starts when a finger passes its slop. Left alone, that pan takes the touch away (`pointercancel`) and a carry that
 * ended on the cancel put the row back: "fades and goes back". So the page does not fight the pan. It gives it nothing to
 * move (`holdScrollersStill`) and, when the browser still takes the pointer away, follows the same finger on the touch
 * events, which keep arriving (`followTouch`). Before the lift nothing here runs: a swipe that starts on a row is the
 * browser's own scroll and glide, on the compositor, as on every other list.
 *
 * Used by `usePointerDrag`, for every hold-to-drag list: the sidebar's chat list and each `useSortable` list.
 */

/** Whether a computed `overflow` value is one the user scrolls by hand. */
const scrollsByHand = (overflow: string) => /(auto|scroll)/.test(overflow);

/**
 * Holds still every scroller from each element of `from` up to the page — the pane the row lives in, any pane around it, and any
 * scroller between the pressed element and the row (a deck's plan strip) — so the browser's pan has nothing to move: the scroll chain
 * of a touch is exactly its target's ancestors. Returns the function that gives them back, to run on every exit.
 *
 * `from` is the pressed element AND the handle: a re-render can swap the element a finger is on before the lift, and the walk up a
 * node that has left the document finds no pane, where the handle is in the document for as long as the gesture lives. The chains
 * meet, and a node is held once.
 *
 * `overflow: hidden` keeps the scroll offset and still takes a script's `scrollTop` (the carry's edge-scroll). It must
 * therefore be applied AFTER the owner has read its pane (`scrollerOf` finds scrollers by their `overflow`).
 * A pane that shows a classic scrollbar (a touch laptop; a phone's is an overlay and takes no width) loses it to `overflow: hidden`,
 * and every row would widen by its width for the whole carry: such a pane keeps its gutter (`scrollbar-gutter: stable`).
 * The page itself is not one of these: `index.css` clips `html` and `body` and sets `overscroll-behavior-y: contain`
 * on them, so the viewport has no scroll to hold and no pull-to-refresh to show.
 *
 * Used by `usePointerDrag` at a touch hold's lift.
 */
export function holdScrollersStill(...from: Element[]): () => void {
  const held: { node: HTMLElement; overflowX: string; overflowY: string; scrollbarGutter: string }[] = [];
  const walked = new Set<Element>();
  for (const start of from) {
    // Past a node already walked, the rest of the chain is walked too.
    for (let node: Element | null = start; node !== null && !walked.has(node); node = node.parentElement) {
      walked.add(node);
      if (!(node instanceof HTMLElement)) continue;
      const style = getComputedStyle(node);
      if (!scrollsByHand(style.overflowX) && !scrollsByHand(style.overflowY)) continue;
      // Read before the overflow is set: what the scrollbar takes from the box's width, borders aside.
      const scrollbarWidth = node.offsetWidth - node.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
      // The inline values, not the computed ones: what goes back is what the element wore, a class's own overflow included.
      held.push({ node, overflowX: node.style.overflowX, overflowY: node.style.overflowY, scrollbarGutter: node.style.scrollbarGutter });
      node.style.overflowX = 'hidden';
      node.style.overflowY = 'hidden';
      if (scrollbarWidth > 1) node.style.scrollbarGutter = 'stable';
    }
  }
  return () => {
    for (const { node, overflowX, overflowY, scrollbarGutter } of held) {
      node.style.overflowX = overflowX;
      node.style.overflowY = overflowY;
      node.style.scrollbarGutter = scrollbarGutter;
    }
  };
}

/** Where a carried finger is, and how its touch ended. */
export type TouchCarryHandlers = {
  move: (x: number, y: number) => void;
  end: (x: number, y: number) => void;
  cancel: () => void;
};

/**
 * Follows the finger that was last at `from` by its touch events, for a carry the browser took the pointer away from.
 * Returns the function that stops following.
 *
 * BOUND ON `target`, the element the press landed on, and not on the document: a touch's events always target the node
 * it started on, and a list that reorders re-inserts nodes — a document listener never hears a node that has left the
 * document, the node's own does. The listeners are passive and nothing calls `preventDefault`.
 *
 * THE FINGER IS MATCHED BY ITS TOUCH IDENTIFIER, which a pointer event does not carry. The first touch event after the
 * hand-over names it: of the touches it reports, the one nearest `from`, where the pointer last had the finger (a second
 * finger cannot be that close). Every later event is read only through that identifier.
 *
 * Used by `usePointerDrag`, on a `pointercancel` that arrives while a touch hold's carry is lifted.
 */
export function followTouch(target: EventTarget, from: { x: number; y: number }, handlers: TouchCarryHandlers): () => void {
  let identifier: number | null = null;
  let last = from;

  /** The reported touch that is ours, once the first event has named it. */
  const ourTouch = (event: Event): Touch | null => {
    const changed = Array.from((event as TouchEvent).changedTouches);
    if (identifier === null) {
      const nearest = changed.reduce<Touch | null>((best, touch) => (
        best === null || Math.hypot(touch.clientX - last.x, touch.clientY - last.y) < Math.hypot(best.clientX - last.x, best.clientY - last.y) ? touch : best
      ), null);
      identifier = nearest?.identifier ?? null;
    }
    return changed.find((touch) => touch.identifier === identifier) ?? null;
  };

  const onMove = (event: Event) => {
    const touch = ourTouch(event);
    if (touch === null) return;
    last = { x: touch.clientX, y: touch.clientY };
    handlers.move(last.x, last.y);
  };
  const onEnd = (event: Event) => {
    const touch = ourTouch(event);
    if (touch !== null) handlers.end(touch.clientX, touch.clientY);
  };
  const onCancel = (event: Event) => {
    if (ourTouch(event) !== null) handlers.cancel();
  };

  target.addEventListener('touchmove', onMove, { passive: true });
  target.addEventListener('touchend', onEnd, { passive: true });
  target.addEventListener('touchcancel', onCancel, { passive: true });
  return () => {
    target.removeEventListener('touchmove', onMove);
    target.removeEventListener('touchend', onEnd);
    target.removeEventListener('touchcancel', onCancel);
  };
}
