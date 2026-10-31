import { useCallback } from 'react';
import type { RefObject, WheelEvent } from 'react';

/**
 * A mouse's wheel turns a sideways row: the row does not scroll down, so a plain downward turn is read as sideways, and a wheel
 * that counts in lines (Firefox's) is made pixels (a line is 16 px). A trackpad's sideways sweep (`deltaX` the larger) and a
 * Shift+wheel are left to the browser, which already moves the row by them (a Shift+wheel still reports its `deltaY`, so adding it
 * here would turn the row twice).
 *
 * Answers the `onWheel` handler for the row whose scroller `scroller` holds (the node that scrolls: the kit's `ScrollArea` hands its
 * ref to it, while its props go to the box around it, which a wheel over the scroller reaches by bubbling). A row that does not
 * overflow has nothing to turn, and the turn does nothing.
 *
 * Used by the station's two sideways rows: the strip's timeline (`LandedTimeline`) and the shelf of her cards (`StageShelfView`).
 */
export function useSidewaysWheel(scroller: RefObject<HTMLElement | null>): (event: WheelEvent<HTMLElement>) => void {
  return useCallback((event) => {
    const node = scroller.current;
    if (node === null || event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    node.scrollLeft += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  }, [scroller]);
}
