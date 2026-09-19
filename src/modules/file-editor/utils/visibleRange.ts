import type { EditorView } from '@codemirror/view';

/**
 * The document lines the reader can actually see, as the window policy's `top` and `bottom`.
 *
 * `view.viewport` is CodeMirror's RENDER viewport: the lines it has drawn, deliberately larger
 * than the visible area by a margin the editor sizes itself. Measured at 1440x900 on the 200,000
 * line file, that range is 79 lines while the visible area holds 31 — so a policy fed the render
 * range asks for text the reader is nowhere near. A prepend fired that way re-fetched the 62 lines
 * an eviction had just dropped, and an append fired from the render bottom kept filling a screen
 * that was already full; both windows were fetched and then evicted, which is what pushed a
 * scroll to line 3,000 past the band the probe allows.
 *
 * The visible area is what the contract means by "the viewport", and it is what V is measured
 * from — `viewportLines` counts the scroller's own height. The bands are in the same units only
 * when both come from the reader's screen. `posAtCoords` is asked in screen coordinates and
 * answers null outside the drawn viewport, so the render range is the fallback.
 */
export function visibleLineRange(view: EditorView): { top: number; bottom: number } {
  const box = view.scrollDOM.getBoundingClientRect();
  const doc = view.state.doc;
  const first = view.posAtCoords({ x: box.left + 1, y: box.top + 1 }, false) ?? view.viewport.from;
  const last = view.posAtCoords({ x: box.left + 1, y: box.bottom - 1 }, false) ?? view.viewport.to;
  return {
    top: doc.lineAt(Math.min(first, doc.length)).number,
    bottom: doc.lineAt(Math.min(last, doc.length)).number,
  };
}
