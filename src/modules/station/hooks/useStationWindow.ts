import { useEffect, useState } from 'react';

import { COARSE_POINTER_QUERY } from '@/shared/constants';
import type { StationTier } from '@/shared/types';

/** The house's mobile breakpoint (`useDeviceSettings`' own 768): a window narrower than this is a phone's. */
const PHONE_MAX_WIDTH = 768;
/** A touch window shorter than this is a phone, and when it is also wider than it is tall, a phone on its side (`sideways`). */
const PHONE_LANDSCAPE_MAX_HEIGHT = 500;

/** The width from which the station draws four columns (wide), in CSS pixels. */
const WIDE_MIN_WIDTH = 1360;
/** The width from which it draws three (laptop); below it, compact's one column (narrow). */
const LAPTOP_MIN_WIDTH = 1024;

/** The window as the station arranges itself in it. */
type StationWindow = { tier: StationTier; phone: boolean; sideways: boolean };

/**
 * THE ONE ANSWER TO "IS THIS A PHONE", read now: a window under 768 px wide, or a touch window (a coarse pointer) under 500 px tall,
 * which is a phone on its side. Pure: the window and the pointer query are all it reads.
 */
function isPhoneWindow(): boolean {
  const { innerWidth, innerHeight } = window;
  return innerWidth < PHONE_MAX_WIDTH || (innerHeight < PHONE_LANDSCAPE_MAX_HEIGHT && window.matchMedia(COARSE_POINTER_QUERY).matches);
}

/**
 * Reads the window now: its tier by width, whether it is a phone's (`isPhoneWindow`, above) and whether that phone
 * is on its side (a touch window under 500 px tall and wider than it is tall: the phone's slimmer rows). One reader of the window's
 * shape, so the arrangement and the rows it draws never disagree. "Wider than tall" is what keeps an upright phone whose keyboard
 * shrank the layout viewport (Android) upright, its top row not flipping to the slim one mid-typing; a phone that short is still a phone.
 */
function readStationWindow(): StationWindow {
  const { innerWidth, innerHeight } = window;
  const tier: StationTier = innerWidth >= WIDE_MIN_WIDTH ? 'wide' : innerWidth >= LAPTOP_MIN_WIDTH ? 'laptop' : 'narrow';
  const touch = window.matchMedia(COARSE_POINTER_QUERY).matches;
  const sideways = touch && innerHeight < PHONE_LANDSCAPE_MAX_HEIGHT && innerWidth > innerHeight;
  return { tier, phone: isPhoneWindow(), sideways };
}

/**
 * The window's tier, whether it is a phone's and whether that phone is on its side, kept current. Read on `resize` and on the
 * pointer query's `change` (a touch screen docked or undocked changes the answer without a resize), never on a timer. A resize
 * that moves none of the three keeps the held object, so a drag across the window does not re-render the station per frame.
 *
 * Used by `StationProvider`, which hands all three to every region and every door.
 */
export function useStationWindow(): StationWindow {
  // The window as last measured. State, because the layout and every touch-sized press re-draw when it changes.
  const [measured, setMeasured] = useState<StationWindow>(readStationWindow);

  useEffect(() => {
    const read = () => {
      const next = readStationWindow();
      setMeasured((held) => (held.tier === next.tier && held.phone === next.phone && held.sideways === next.sideways ? held : next));
    };
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

  return measured;
}
