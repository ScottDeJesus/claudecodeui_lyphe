import { useCallback, useEffect, useRef } from 'react';

import { edgeHoldAt, edgeStep, scrollerOf } from '@/shared/ui/sortable/motion';

/** A carry in progress: the pane it travels in, where the pointer is, the edge it began in, its frame. */
type EdgeCarry = { scroller: HTMLElement; pointerY: number; edgeHold: number; frame: number };

/**
 * The pane scrolling itself under a carried row, so a row can be taken to one that is off screen: while
 * the pointer rests in the pane's top or bottom edge zone, every animation frame scrolls the pane a step
 * toward that edge and tells `onScrolled` the rows have moved under the pointer. The step, the zone and
 * the rule that a carry which BEGAN in a zone does not run toward it until the pointer has left it
 * (`edgeHoldAt`) are the kit's own (`shared/ui/sortable/motion.ts`), the same ones `useSortable` runs its
 * lists on, so a lifted card and a lifted chat row scroll alike.
 *
 * Used by `useSimpleChatDrag` (the sidebar's chat list): `begin` at the lift, `follow` on every move,
 * `end` at the release. A page that scrolls as a whole has no pane to run, and `begin` does nothing.
 */
export function useCarryEdgeScroll(onScrolled: (pointerY: number) => void): {
  begin: (list: Element, pointerY: number) => void;
  follow: (pointerY: number) => void;
  end: () => void;
} {
  // The latest callback, read when a frame runs: written in an effect, never during render.
  const latestOnScrolled = useRef(onScrolled);
  useEffect(() => {
    latestOnScrolled.current = onScrolled;
  });
  const carry = useRef<EdgeCarry | null>(null);

  const end = useCallback(() => {
    if (carry.current !== null) cancelAnimationFrame(carry.current.frame);
    carry.current = null;
  }, []);

  const begin = useCallback((list: Element, pointerY: number) => {
    end();
    const scroller = scrollerOf(list);
    if (scroller === null) return;
    const active: EdgeCarry = { scroller, pointerY, edgeHold: Math.sign(edgeStep(scroller, pointerY)), frame: 0 };
    carry.current = active;
    const frame = () => {
      active.edgeHold = edgeHoldAt(scroller, active.pointerY, active.edgeHold);
      const step = edgeStep(scroller, active.pointerY);
      if (step !== 0 && active.edgeHold === 0) {
        const before = scroller.scrollTop;
        scroller.scrollTop += step;
        // A pane already at its end has not moved, and the rows under the pointer are the ones it had.
        if (scroller.scrollTop !== before) latestOnScrolled.current(active.pointerY);
      }
      active.frame = requestAnimationFrame(frame);
    };
    active.frame = requestAnimationFrame(frame);
  }, [end]);

  const follow = useCallback((pointerY: number) => {
    if (carry.current !== null) carry.current.pointerY = pointerY;
  }, []);

  // A carry cut short by an unmount must not leave its frame loop running.
  useEffect(() => end, [end]);

  return { begin, follow, end };
}
