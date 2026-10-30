import { useEffect, useState } from 'react';

import type { StationTier } from '@/shared/types';

/** The width from which the station draws four columns (wide), in CSS pixels. */
const WIDE_MIN_WIDTH = 1360;
/** The width from which it draws three (laptop); below it, one scrolling column (narrow). */
const LAPTOP_MIN_WIDTH = 1024;
/** The house's mobile breakpoint (`useDeviceSettings`): a window narrower than this is a phone's. */
const PHONE_MAX_WIDTH = 768;
/** A touch window shorter than this is a phone on its side, however wide it is. */
const PHONE_LANDSCAPE_MAX_HEIGHT = 500;

const COARSE_POINTER_QUERY = '(pointer: coarse)';

/** The window as the station arranges itself in it. */
type StationWindow = { tier: StationTier; phone: boolean };

/** Reads the window now: its tier by width, and whether it is a phone's (narrow, or a touch window on its side). */
function readStationWindow(): StationWindow {
  const { innerWidth, innerHeight } = window;
  const tier: StationTier = innerWidth >= WIDE_MIN_WIDTH ? 'wide' : innerWidth >= LAPTOP_MIN_WIDTH ? 'laptop' : 'narrow';
  const touch = window.matchMedia(COARSE_POINTER_QUERY).matches;
  return { tier, phone: innerWidth < PHONE_MAX_WIDTH || (touch && innerHeight < PHONE_LANDSCAPE_MAX_HEIGHT) };
}

/**
 * The window's tier and whether it is a phone's, kept current. Read on `resize` and on the pointer query's `change`
 * (a touch screen docked or undocked changes the answer without a resize), never on a timer. A resize that moves
 * neither value keeps the held object, so a drag across the window does not re-render the station per frame.
 *
 * Used by `StationProvider`, which hands both to every region and every door.
 */
export function useStationWindow(): StationWindow {
  // The window as last measured. State, because the layout and every touch-sized press re-draw when it changes.
  const [measured, setMeasured] = useState<StationWindow>(readStationWindow);

  useEffect(() => {
    const read = () => {
      const next = readStationWindow();
      setMeasured((held) => (held.tier === next.tier && held.phone === next.phone ? held : next));
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
