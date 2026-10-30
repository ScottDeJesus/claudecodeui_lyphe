import { useEffect, useState, useSyncExternalStore } from 'react';

import { FAB_SIZE_PX } from '@/shared/constants';
import type { CompanionPresence, CompanionPresenceState } from '@/shared/types';

/**
 * The smallest her disc grows to while she is active: a phone's width gives this. At 28 px her phone corner's catch and the applications
 * button's meet edge to edge; at 48 her disc reaches 2 px into that catch (its drawn disc stays 6 px clear), where the applications
 * button, on the higher layer, takes the press.
 */
const ACTIVE_MIN_PX = 48;

/** The largest it grows to: what a 256 px frame of her portrait draws sharp at twice the pixel density. */
const ACTIVE_MAX_PX = 120;

/** The share of the window's width her disc takes while she is active: 115 px at 1440, 82 at 1024, 48 on a phone. */
const ACTIVE_WIDTH_SHARE = 0.08;

/** How long after the presence leaves the active states the disc shrinks back, so a pause between two turns never makes her pulse. */
const SHRINK_DELAY_MS = 2500;

/**
 * The states that grow her: the ones where something is happening between her and him. `waking` is left out on purpose: she wakes
 * small and grows as she thinks. `cut` is in because it sits between speaking and listening.
 */
const ACTIVE_STATES: ReadonlySet<CompanionPresenceState> = new Set<CompanionPresenceState>([
  'listening',
  'transcribing',
  'thinking',
  'speaking',
  'reading_session',
  'reading_code',
  'drafting',
  'walking',
  'cut',
]);

/**
 * The disc's side in px while she is active, for a window `width` px wide. Used by the hook below and by
 * `.verify/kaylee-fab-growth.mjs`, which asks it what size it should measure. A width that is not a number gives the smallest.
 */
export function activeFabSize(width: number): number {
  if (!Number.isFinite(width)) return ACTIVE_MIN_PX;
  return Math.min(ACTIVE_MAX_PX, Math.max(ACTIVE_MIN_PX, Math.round(width * ACTIVE_WIDTH_SHARE)));
}

/** The window's resize, heard only while she is active: nowhere else does the window's width decide her size. */
function listenToResize(listener: () => void): () => void {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

/** No subscription: at rest, and in the pause before she shrinks, a resize changes nothing she draws. */
function listenToNothing(): () => void {
  return () => {};
}

const readWindowWidth = () => window.innerWidth;

/**
 * Used by this module's CompanionFab: the side of her disc in px, one number for everything that draws or places her. 28 at rest
 * (`FAB_SIZE_PX`, the kit's); while she is active `activeFabSize` of the window's width.
 *
 * SHE GROWS AT ONCE, in the render that finds the presence active, and shrinks `SHRINK_DELAY_MS` after the last active state:
 * the shrink is a deadline set when the presence leaves them and cleared if one returns, never a clock that asks again.
 *
 * The window's width is read on `resize` only while she is active, and the pause before the shrink draws the width the last active
 * render read: a resize in the pause keeps the size she has, whatever else renders her.
 */
export function useCompanionSize(presence: CompanionPresence): number {
  const active = ACTIVE_STATES.has(presence.state);
  // Whether she is drawn large: true from the first active render until the shrink's deadline. State because the deadline ends
  // it long after the presence has changed, and nothing else remembers that she was active a moment ago.
  const [grown, setGrown] = useState(active);
  if (active && !grown) setGrown(true);

  useEffect(() => {
    if (active || !grown) return undefined;
    const deadline = window.setTimeout(() => setGrown(false), SHRINK_DELAY_MS);
    return () => window.clearTimeout(deadline);
  }, [active, grown]);

  const width = useSyncExternalStore(active ? listenToResize : listenToNothing, readWindowWidth);
  // The width the last active render read, drawn through the pause: the store answers the window's live width on every render, so
  // without this a re-render in the pause (any frame the page hears) would resize her before the deadline.
  const [activeWidth, setActiveWidth] = useState(width);
  if (active && width !== activeWidth) setActiveWidth(width);
  return grown ? activeFabSize(active ? width : activeWidth) : FAB_SIZE_PX;
}
