import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** The clear space, in px, a panel keeps from each side of the window. */
const EDGE_MARGIN_PX = 8;

/**
 * The horizontal nudge, in px, that keeps a panel hung under its trigger inside the window's width.
 * `ActionMenu` (in place) and `Menu` use it: both draw an absolutely positioned panel against a trigger
 * that can stand anywhere in a row, so a panel a few px wider than the room to its right (the Mark screen's
 * 248 px Rename menu, trigger at x=152 in a 390 window) hangs off the edge. Apply the number as
 * `style={{ translate: shift ? `${shift}px` : undefined }}`.
 *
 * `translate`, not `transform`: the panels enter on `vv-pop`, whose `animation-fill-mode: both` holds
 * `transform` for as long as they live and beats an inline `transform`. A `translateX` there never moved
 * the box, so `ActionMenu`'s old correction measured an unmoved panel, "subtracted" a shift that was not
 * applied and flipped between two answers until React gave up ("Maximum update depth exceeded", measured
 * 2026-10-20 opening it near the left edge of a 390 window). `translate` is its own property and moves the box.
 *
 * Measured from the box's own position less the shift already applied, and from the LAYOUT width, because
 * the entrance starts at `scale(.96)` and a bounding rect read then is 4% narrow around the centre.
 * Run after every commit and on the window's resize: both are idempotent, so the effect cannot feed on itself.
 *
 * `active` is whether the panel is up; `hostWindow` is the window it is drawn in (MAN-7451).
 */
export function useEdgeShift(panelRef: RefObject<HTMLElement | null>, active: boolean, hostWindow: Window): number {
  const [shift, setShift] = useState(0);
  // The shift the committed panel wears. State lags the DOM by a render; the measurement needs what is ON the box.
  const appliedRef = useRef(0);

  const place = useCallback(() => {
    const panel = panelRef.current;
    if (!active || !panel) {
      // Only when there is something to take off: a `setState` per commit, even to the value it holds, is a nested
      // update the layout phase counts against React's limit.
      if (appliedRef.current !== 0) {
        appliedRef.current = 0;
        setShift(0);
      }
      return;
    }
    const box = panel.getBoundingClientRect();
    const width = panel.offsetWidth;
    const left = box.left + (box.width - width) / 2 - appliedRef.current;
    const right = left + width;
    let wanted = 0;
    if (right > hostWindow.innerWidth - EDGE_MARGIN_PX) wanted = hostWindow.innerWidth - EDGE_MARGIN_PX - right;
    if (left + wanted < EDGE_MARGIN_PX) wanted = EDGE_MARGIN_PX - left;
    // A rect is a fraction of a pixel and the same box reads 12.3999 on one pass and 12.4 on the next: an exact
    // comparison would re-render on that noise forever (measured: "Maximum update depth exceeded"). Only a half
    // pixel is a move, and the shift is a whole pixel.
    if (Math.abs(wanted - appliedRef.current) > 0.5) {
      appliedRef.current = Math.round(wanted);
      setShift(appliedRef.current);
    }
  }, [panelRef, active, hostWindow]);

  // A layout effect because the correction belongs to the paint that shows the panel: it can be measured only
  // once it has committed, and a frame without it is a frame hanging off the edge.
  useLayoutEffect(() => {
    place();
  });

  useEffect(() => {
    if (!active) return undefined;
    hostWindow.addEventListener('resize', place);
    return () => hostWindow.removeEventListener('resize', place);
  }, [active, hostWindow, place]);

  return shift;
}
