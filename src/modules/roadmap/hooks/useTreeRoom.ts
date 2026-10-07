import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

/** The gap between the tree and the panel under it in the face's body (`gap-3`), in px: room the tree cannot use. */
const BODY_GAP = 12;

/**
 * The px of height a viewport-fit face can give its tree: the body's content height (its padding left out)
 * less the panel band's height and the gap between them. `null` until the body has been measured, which the
 * tree reads as its natural size. Measured before paint, so the first frame is already at its fitted scale,
 * and again whenever the body or the band changes size (the window, the phone's keyboard or toolbars).
 * The panel is found in the body by its `data-roadmap-panel` mark: in viewport fit it is a fixed band, so
 * its height never follows what it holds, and the room the tree is given never moves as the panel fills.
 *
 * Used by `RoadmapTreeFace`, in viewport fit, with the body that holds the tree and the panel; `active` is
 * whether that body is drawn (it is not while the picture loads, or the roadmap has no milestone).
 */
export function useTreeRoom(bodyRef: RefObject<HTMLElement>, active: boolean): number | null {
  // The measured room, in px. Essential, not derivable: only the laid-out DOM knows the body's height and the band's.
  const [room, setRoom] = useState<number | null>(null);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!active || body === null) return undefined;
    const panel = body.querySelector<HTMLElement>('[data-roadmap-panel]');
    if (panel === null) return undefined;
    const measure = () => {
      const style = getComputedStyle(body);
      const content = body.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const next = Math.max(0, Math.floor(content - panel.offsetHeight - BODY_GAP));
      setRoom((held) => (held === next ? held : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [bodyRef, active]);

  return room;
}
