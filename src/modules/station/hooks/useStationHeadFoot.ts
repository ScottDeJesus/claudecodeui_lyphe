import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** The property a sheet that must clear her face reads for its `top` (`CheckStage`, as `var(--station-head-foot)`). This hook is its one writer. */
const HEAD_FOOT_PROPERTY = '--station-head-foot';

/**
 * Writes where her head ends, so a sheet drawn over the page stands below her face: "cards never cover her face". The value is the
 * bottom edge of the box the ref is on, in viewport px (a `fixed` sheet's `top` is measured from the same place).
 *
 * WRITTEN ON THE DOCUMENT'S ROOT, as `--keyboard-height` is, and not on the station's shell: the kit `Sheet` is portalled into the
 * body (`Dialog`'s rule), outside the shell, and a custom property reaches only what it is inherited by. The station owns the page
 * while it is mounted, and the property is removed as it goes, so a sheet drawn from the workspace reads none.
 *
 * WRITTEN ON THE BOX'S OWN EVENTS: a `ResizeObserver` hears the head's size (her state's words wrapping, the row's sideways step,
 * the failed process's banner) and its parent's, since the foot also moves when something ABOVE the head resizes — the bar over
 * compact's column — and then only the column's height changes, never the head's. Both are observed by their BORDER box, the edge
 * the foot is read from: the default content box stays still when a box's padding or border grows. No poll, no timer.
 *
 * Written once as the head mounts, before paint, so a press on "Open the check" never beats the first value. The ref holds
 * the arrangement's head box: compact's head row (her head, the talk button and the count), the phone's top row.
 *
 * Used by this module's StationCompact and StationPhone, once each, which put the ref on their head's box.
 */
export function useStationHeadFoot(): RefObject<HTMLDivElement> {
  const headRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const head = headRef.current;
    const view = head?.ownerDocument.defaultView;
    if (head === null || !view) return undefined;
    const root = head.ownerDocument.documentElement;
    // Up to the next whole pixel: the foot of a fractional box must never leave its last row under the scrim.
    const write = () => root.style.setProperty(HEAD_FOOT_PROPERTY, `${Math.ceil(head.getBoundingClientRect().bottom)}px`);
    write();
    const observer = new view.ResizeObserver(write);
    observer.observe(head, { box: 'border-box' });
    if (head.parentElement !== null) observer.observe(head.parentElement, { box: 'border-box' });
    return () => {
      observer.disconnect();
      root.style.removeProperty(HEAD_FOOT_PROPERTY);
    };
  }, []);

  return headRef;
}
