import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * A keyboard keeps its place when the thing it was on is taken down. A card's Dismiss and a walk's End are pressed from the
 * stage's head; the frame that answers them unmounts that thing, and its presses with it, so the focused button is removed and
 * the browser drops the focus on `<body>`, outside the stage: the next Tab starts from the top of the page. This moves the focus
 * to `gone` (the stage's "taken down" or "ended" line, a `tabIndex={-1}` box that stays) when `held` turns false AND the focus
 * has fallen to the body. Focus that is anywhere else (a press made elsewhere took it there) is left where it is, and a stage
 * that opens already gone (a reload) takes no focus: it only follows a thing that was drawn.
 *
 * Used by `NoteStageView` and `WalkStageView`, each with the box its gone line stands in.
 */
export function useKeepFocusWhenGone(held: boolean, gone: RefObject<HTMLElement | null>): void {
  // Whether the thing was drawn at the last render. A ref: the effect decides from it, and nothing is drawn from it.
  const wasHeld = useRef(held);

  // A layout effect, so the focus is back before the browser paints the stage with nothing focused.
  useLayoutEffect(() => {
    const was = wasHeld.current;
    wasHeld.current = held;
    const focused = document.activeElement;
    if (was && !held && (focused === null || focused === document.body)) gone.current?.focus({ preventScroll: true });
  }, [held, gone]);
}
