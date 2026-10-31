import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

import { useDevicePixelRatio } from '@/modules/companion/hooks/useDevicePixelRatio';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import { resizeObserverIn } from '@/shared/utils';

/**
 * Used by this module's CompanionPortrait: the pixels per side that the square element `ref` is drawn at on the screen, its layout
 * width in CSS px times the window's pixel ratio. That is what its canvases' backing stores must be: a canvas of any other size is
 * stretched by the browser, which is the blur. `fallbackSide` stands where the element has no width yet (not laid out, or hidden).
 * A ResizeObserver follows the width and `useDevicePixelRatio` the ratio: events, never a poll.
 */
export function useCanvasBackingSide(ref: RefObject<HTMLElement | null>, fallbackSide: number): number {
  const hostWindow = useHostWindow();
  const ratio = useDevicePixelRatio();
  // The element's layout width in whole CSS px, null until measured. State, because the backing store is an attribute React writes and the loop redraws when it changes.
  const [cssWidth, setCssWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    // Read at once, before the first paint: the observer's first report comes a frame later, and that frame would show the fallback's blur.
    setCssWidth(element.offsetWidth);
    const observer = resizeObserverIn(hostWindow, ([entry]) => {
      if (entry) setCssWidth(Math.round(entry.contentRect.width));
    });
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [ref, hostWindow]);
  return cssWidth ? Math.round(cssWidth * ratio) : fallbackSide;
}
