import { useCallback, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** How far from the newest line still counts as reading it: a finger's slack, so a pane that settles a pixel short is still followed. */
const FOLLOW_SLACK_PX = 24;

/**
 * Keeps a live pane's reader where they are. The events pane is a reversed column: it rests at its newest line by itself
 * (the scroll origin of a reversed column is its foot), so a reader AT the newest line follows the lines that arrive with
 * nothing done here. A reader who has scrolled UP is another matter: a line arriving at the foot pushes every line above it
 * up by its height, so the same scroll offset would now show a newer line, and the text under the reader's eyes would slide.
 * So when the newest line changes and the reader is not at the foot, the offset is moved by what the pane grew, and the
 * lines they are reading stay put (the Fix output pane's rule, `cerberus/sheet/FixOutput.tsx`). The pane turns the browser's
 * own scroll anchoring off (`overflow-anchor: none`): Chrome and Firefox would move the offset too, and the two moves would
 * add up to twice the growth, while Safari has no anchoring at all, so one rule made here is the only one that holds in all
 * three. A page of OLDER lines
 * arriving at the top (Show earlier) does not move the foot, so the newest key is the same and nothing is done.
 *
 * `newestKey` names the newest line (its event id): the pane is adjusted when it changes. Returns the ref and the scroll
 * listener for the pane: the listener keeps whether the reader is at the foot, which is a ref because it steers the scroll
 * and nothing is drawn from it.
 *
 * Used by this module's `RunEvents`, on its events pane.
 */
export function useFollowNewest(newestKey: string): { paneRef: RefObject<HTMLDivElement>; onScroll: () => void } {
  const paneRef = useRef<HTMLDivElement>(null);
  // Whether the reader is at the newest line; true until they scroll away, so a pane that has just opened is followed.
  const followingRef = useRef(true);
  // The pane's height and its newest line as they were at the last layout, to tell what grew and where.
  const heldRef = useRef({ height: 0, newestKey });

  const onScroll = useCallback(() => {
    const pane = paneRef.current;
    if (pane !== null) followingRef.current = Math.abs(pane.scrollTop) <= FOLLOW_SLACK_PX;
  }, []);

  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (pane === null) {
      heldRef.current = { height: 0, newestKey };
      return;
    }
    const held = heldRef.current;
    const grew = pane.scrollHeight - held.height;
    // The reversed column counts its offset from the foot, upward as negative: moving further up is subtracting.
    if (held.height > 0 && grew > 0 && held.newestKey !== newestKey && !followingRef.current) pane.scrollTop -= grew;
    heldRef.current = { height: pane.scrollHeight, newestKey };
  });

  return { paneRef, onScroll };
}
