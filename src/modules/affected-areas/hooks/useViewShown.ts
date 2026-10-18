import { useEffect, useRef, useState, type RefObject } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import { resizeObserverIn } from '@/shared/utils';

/**
 * Whether the element can be seen: a `hidden` ancestor (the Cerberus tab keeps the Tours view mounted and hides it
 * under another view) takes it out of layout, and an element out of layout has no boxes. The Tours view reads on open
 * and on a press and never while hidden, so before it sends a read of its own accord it asks this.
 *
 * Used by the affected-areas module's view root.
 */
export function isInLayout(element: HTMLElement | null): boolean {
  return element !== null && element.getClientRects().length > 0;
}

/**
 * Whether the element is in layout, as state: what must not RUN while the view is away (the search's rest timer) is
 * gated on it, and re-armed by the return, which only a render can do. A resize of the element is what announces a
 * change (it was 0 wide, it is not): nothing polls.
 *
 * Used by the affected-areas module's view root.
 */
export function useViewShown(ref: RefObject<HTMLElement | null>): boolean {
  const hostWindow = useHostWindow();
  // Whether the element is in layout as the observer last saw it. A view mounts on its first show, so it starts shown.
  const [shown, setShown] = useState(true);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const observer = resizeObserverIn(hostWindow, () => setShown(isInLayout(element)));
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [hostWindow, ref]);

  return shown;
}

/**
 * A word each time `shown` turns true again, for a read that was held back while the view was away. A view that never
 * went away is never told.
 *
 * Used by the affected-areas module's view root.
 */
export function useWhenShown(shown: boolean, onShown: () => void): void {
  // The root's latest `onShown`, which the effect below calls after a render that may be long past the one that wrote it.
  const onShownRef = useRef(onShown);
  useEffect(() => {
    onShownRef.current = onShown;
  });
  // Whether the view was shown at the last render: `onShown` is for a return, not for every render.
  const wasShownRef = useRef(true);
  useEffect(() => {
    if (shown && !wasShownRef.current) onShownRef.current();
    wasShownRef.current = shown;
  }, [shown]);
}
