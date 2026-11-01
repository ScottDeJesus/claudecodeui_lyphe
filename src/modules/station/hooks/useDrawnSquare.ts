import { useLayoutEffect, useState } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import { resizeObserverIn } from '@/shared/utils';

/**
 * The px a square box is drawn at, read off the box as the layout makes it, and the ref callback to put on it. Her face's box is
 * sized by CSS from her column (132 or 200 px by its height in her head, the room her portrait is given in the portrait view),
 * which only the layout knows; her initial, drawn where her face is not made yet, takes the px to fill it. `initialPx` stands
 * until the first reading. A ResizeObserver, so it follows the box: an event, never a poll.
 *
 * Used by this module's StationHeadView (her face's disc) and StationPortraitView (her face, undisced).
 */
export function useDrawnSquare(initialPx: number): [(node: HTMLDivElement | null) => void, number] {
  const hostWindow = useHostWindow();
  // The box as drawn: state, so a box laid out again (a tier change keeps her column) is observed afresh.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  // The px the box is drawn at, read off it as it lays out.
  const [drawnPx, setDrawnPx] = useState(initialPx);
  useLayoutEffect(() => {
    if (node === null) return undefined;
    const observer = resizeObserverIn(hostWindow, ([entry]) => { if (entry) setDrawnPx(Math.round(entry.contentRect.width)); });
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [node, hostWindow]);
  return [setNode, drawnPx];
}
