import { useEffect, useState } from 'react';

import { COARSE_POINTER_QUERY } from '@/shared/constants';

/** The house's mobile breakpoint (`useDeviceSettings`' own 768): a window narrower than this is a phone's. */
const PHONE_MAX_WIDTH = 768;

/**
 * A touch window shorter than this is a phone, and when it is also wider than it is tall, a phone on its side. Read by the station's
 * window (`useStationWindow`) for its `sideways`, which is the same 500 with the window's shape added.
 */
export const PHONE_LANDSCAPE_MAX_HEIGHT = 500;

/**
 * THE ONE ANSWER TO "IS THIS A PHONE", read now: a window under 768 px wide, or a touch window (a coarse pointer) under 500 px tall,
 * which is a phone on its side. Pure: the window and the pointer query are all it reads.
 *
 * Used by `useStationWindow`, which builds the station's `phone` from it inside its one reader, and by `usePhoneWindow` below.
 */
export function isPhoneWindow(): boolean {
  const { innerWidth, innerHeight } = window;
  return innerWidth < PHONE_MAX_WIDTH || (innerHeight < PHONE_LANDSCAPE_MAX_HEIGHT && window.matchMedia(COARSE_POINTER_QUERY).matches);
}

/**
 * True in a window under 768 px wide, or a touch window under 500 px tall (a phone on its side). Read on `resize` and on the pointer
 * query's `change` (a touch screen docked or undocked changes the answer without a resize), never on a timer; a resize that leaves
 * the answer as it was draws nothing again.
 *
 * Consumed by the workspace's two doors into the station, the command palette's "Open Kaylee Station" (`ProjectCommandPalette`) and
 * the head of her panel (`CompanionPanel`), which pass it as `phone` to `openStation`. The station reads the same `isPhoneWindow()`
 * through `useStationWindow`, so the doors and the station's own bar, `phone` where they stand, agree on every window.
 */
export function usePhoneWindow(): boolean {
  // The answer as last read. State, because a door's `phone` and the memo built on it change when the window does.
  const [phone, setPhone] = useState<boolean>(isPhoneWindow);

  useEffect(() => {
    const read = () => setPhone(isPhoneWindow());
    const pointer = window.matchMedia(COARSE_POINTER_QUERY);
    // Read on the way in too: the window may have changed between the first render and this effect.
    read();
    window.addEventListener('resize', read);
    pointer.addEventListener('change', read);
    return () => {
      window.removeEventListener('resize', read);
      pointer.removeEventListener('change', read);
    };
  }, []);

  return phone;
}
