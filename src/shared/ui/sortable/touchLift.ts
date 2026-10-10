import { useCallback, useEffect, useRef } from 'react';

/** How long the lift's pulse lasts: Android's own long-press buzz, which a hand can feel (many vibration motors cannot render 8 ms). A phone on silent, and an iPhone, get none; the item leaving its slot (`carried.ts`) is the cue that does not depend on it. */
const LIFT_PULSE_MS = 20;

/** The sign a finger gets that something has come up: where the device can, it says so in the hand. Used by `useSortable` and `useSimpleChatDrag` at the moment of the lift. */
export function tickLift(): void {
  navigator.vibrate?.(LIFT_PULSE_MS);
}

/**
 * The pane held still under a lifted finger, for any list that lifts on a touch hold
 * (`usePointerDrag`'s `holdMs`). Returns the ref callback for the list's element; while `isLifted()`
 * answers true, a `touchmove` met anywhere under that element is cancelled, so the pane does not
 * scroll out from under the carry.
 *
 * It is set for the element's WHOLE life, never at the lift: `touch-action` cannot be changed under a
 * touch already running, and a listener met only after the touch began is not reliably allowed to
 * cancel. It must say `passive: false` for the same reason — a cancelling listener is ignored unless
 * it declares that it may cancel.
 *
 * Used by `useSortable` (the runner, roadmap and dispatcher lists) and by `useSimpleChatDrag` (the
 * sidebar's chat list), so a lifted card and a lifted chat row are held by the one canceller.
 */
export function useHoldPane(isLifted: () => boolean): (element: HTMLElement | null) => void {
  // The latest answer, read when a touch moves rather than when the list attached: written in an
  // effect, never during render.
  const latestIsLifted = useRef(isLifted);
  useEffect(() => {
    latestIsLifted.current = isLifted;
  });
  const attached = useRef<HTMLElement | null>(null);

  const cancelWhileLifted = useCallback((event: TouchEvent) => {
    if (latestIsLifted.current()) event.preventDefault();
  }, []);

  return useCallback((element: HTMLElement | null) => {
    attached.current?.removeEventListener('touchmove', cancelWhileLifted);
    attached.current = element;
    element?.addEventListener('touchmove', cancelWhileLifted, { passive: false });
  }, [cancelWhileLifted]);
}
