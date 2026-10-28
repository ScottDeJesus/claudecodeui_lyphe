import { useCallback, useEffect, useRef, useState } from 'react';

import { useCompanion } from '@/modules/companion/context/CompanionContext';
import { PAGE_ANCHOR } from '@/shared/constants';
import { usePageAnchors } from '@/shared/context/PageAnchorsContext';
import type { CompanionPresence } from '@/shared/types';

/** The anchor her button points at, and where it stands now (the viewport's coordinates, as `getBoundingClientRect` reports them). */
type AvatarTarget = { key: string; rect: DOMRect };

/** How long a target holds after the look that chose it ends: long enough to span the gap between two tool calls of one read. */
const TARGET_HOLD_MS = 1500;


/**
 * The anchors her look points at, best first (`PAGE_ANCHOR`); empty when she is looking at nothing. The first one IN SIGHT
 * is the target. The three looks are tried in this order, and the first that applies is the only one tried:
 *   1. a dactyl reading code → the file tree, else the rail's Files button;
 *   2. a chat read, drafted for or walked → that chat's row, else its composer;
 *   3. a send in the last four seconds → the composer it went to.
 */
function anchorKeysOf(looksAtCode: boolean, sessionId: string | null, sentSessionId: string | null): string[] {
  if (looksAtCode) return [PAGE_ANCHOR.filesView, PAGE_ANCHOR.railFiles];
  if (sessionId !== null) return [PAGE_ANCHOR.chatRow(sessionId), PAGE_ANCHOR.composer(sessionId)];
  if (sentSessionId !== null) return [PAGE_ANCHOR.composer(sentSessionId)];
  return [];
}

/** Whether `inner` lies wholly inside `outer`. */
const isInside = (inner: DOMRect, outer: DOMRect): boolean =>
  inner.left >= outer.left && inner.top >= outer.top && inner.right <= outer.right && inner.bottom <= outer.bottom;

/**
 * The anchor's rect when she can point at it, null when she cannot. The registry holds what is MOUNTED, and mounted is not
 * drawn (see `usePageAnchors`), so all of these must hold:
 *   - it is connected, and to THIS page's document: a chat floated into another window is the same node under another
 *     `ownerDocument`, with a rect in that window's coordinates;
 *   - its rect has an area and meets the viewport: a hidden chat view holds its composer at 0x0, a phone's closed drawer
 *     holds every row off to the left;
 *   - `elementFromPoint` at the rect's centre lands on the anchor or something inside it, so nothing stands over it — an
 *     application, a dialog, her own panel — and the sidebar's own scroller has not clipped it away. A centre that is off
 *     screen has no element and so fails: an anchor with its middle out of the viewport is not one to point at;
 *   - it is not wholly inside the button's own rect, where she is already standing on it.
 */
function sightOf(element: HTMLElement | null, buttonRect: DOMRect | null): DOMRect | null {
  if (element === null || !element.isConnected || element.ownerDocument !== document) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) return null;
  const covering = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (covering === null || !element.contains(covering)) return null;
  if (buttonRect !== null && isInside(rect, buttonRect)) return null;
  return rect;
}

/** Whether two targets name the same anchor at the same place, so a re-measure that found nothing new renders nothing. */
const isSameTarget = (a: AvatarTarget | null, b: AvatarTarget | null): boolean =>
  a === b || (a !== null && b !== null && a.key === b.key
    && a.rect.left === b.rect.left && a.rect.top === b.rect.top && a.rect.width === b.rect.width && a.rect.height === b.rect.height);

/**
 * Used by this module's CompanionFab, which stands the button at `avatarPlacement` of the target's rect while one holds and
 * at its rest otherwise. `buttonRect` is the button's own rect (the kit's `onRectChange`), for the fourth in-sight test; left
 * out, nothing is "under the button".
 *
 * WHERE SHE LOOKS comes from the presence's SUBJECT, not its state word: `files` (a dactyl reading) and `session` (a chat
 * read, drafted for or walked) are the activity's, whatever state hides it, so the target holds through the sentences she
 * says WHILE reading — `speaking` or `listening` would otherwise send her home mid-read and bring her back. `reading_code`
 * is also taken as a look at code with no file names. The send is the companion's `recentSend`, which the provider holds
 * for four seconds.
 *
 * ONE TARGET AT A TIME, and only one that is in sight: see `anchorKeysOf` and `sightOf`. An anchor out of sight is no
 * target, and she stays at her rest or goes back to it at once. With a look standing and nothing in sight there is no
 * target, so no scroll or resize listener is attached either: only a registration or a change of look brings her back
 * (an overlay that closes announces neither).
 *
 * HELD, NOT BOUNCED. When the look ends the target stays for `TARGET_HOLD_MS` and is then dropped, so a run of tool calls
 * (each ends, the next begins a moment later) keeps her where she is. A look that returns inside the hold takes the
 * hold back. While it holds, only that anchor is re-tested, and the hold ends early if it leaves sight.
 *
 * EVENTS, NOT WATCHDOGS. The target is measured when the look changes, when the registry announces a registration, and,
 * only while a target holds, on a `scroll` (capture, so any scroller's) or `resize`, on the next animation frame so a
 * burst of scrolls measures once. Nothing is attached while there is neither look nor target. The hold's timer is a
 * deadline the look's end sets, never a clock that asks again.
 */
export function useAvatarTarget(presence: CompanionPresence, buttonRect: DOMRect | null = null): AvatarTarget | null {
  const anchors = usePageAnchors();
  const { recentSend } = useCompanion();

  // Where the button points now. State because the button redraws on it; set only by `commit`, which also keeps the ref below.
  const [target, setTarget] = useState<AvatarTarget | null>(null);

  // The target as the last `commit` left it, readable by an event handler that closed over an older render.
  const targetRef = useRef<AvatarTarget | null>(null);
  // The anchors her look points at now, best first; the measure reads it, so a scroll measures the look and not a render's copy of it.
  const keysRef = useRef<string[]>([]);
  // The button's own rect, kept current for the measure without making the measure change with it.
  const buttonRectRef = useRef(buttonRect);
  // The animation frame a measure is waiting for, 0 for none; a second event in the same frame joins it.
  const frameRef = useRef(0);

  const looksAtCode = presence.state === 'reading_code' || presence.files !== null;
  const sessionId = presence.session?.sessionId ?? null;
  const looking = looksAtCode || sessionId !== null || recentSend !== null;
  const holding = target !== null;

  const commit = useCallback((next: AvatarTarget | null) => {
    if (isSameTarget(targetRef.current, next)) return;
    targetRef.current = next;
    setTarget(next);
  }, []);

  /** Re-reads the page: the first anchor of the look that is in sight, or, with no look, the held anchor if it still is. */
  const measure = useCallback(() => {
    const keys = keysRef.current;
    if (keys.length === 0) {
      const held = targetRef.current;
      if (held === null) return;
      const rect = sightOf(anchors.element(held.key), buttonRectRef.current);
      commit(rect === null ? null : { key: held.key, rect });
      return;
    }
    for (const key of keys) {
      const rect = sightOf(anchors.element(key), buttonRectRef.current);
      if (rect !== null) {
        commit({ key, rect });
        return;
      }
    }
    commit(null);
  }, [anchors, commit]);

  // The handler is named, and not like its variable (the bundler renames a function that shares its const's name), so a probe
  // can tell this listener from the page's own when it counts what is attached.
  const scheduleMeasure = useCallback(function measureOnNextFrame() {
    if (frameRef.current !== 0) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      measure();
    });
  }, [measure]);

  useEffect(() => {
    buttonRectRef.current = buttonRect;
  }, [buttonRect]);

  // The look changed: measure it now, and when it has ended with a target still standing, start that target's hold.
  useEffect(() => {
    keysRef.current = anchorKeysOf(looksAtCode, sessionId, recentSend);
    measure();
    // Read after the measure: it may have dropped a held target that left sight.
    if (keysRef.current.length > 0 || targetRef.current === null) return undefined;
    const hold = window.setTimeout(() => commit(null), TARGET_HOLD_MS);
    return () => window.clearTimeout(hold);
  }, [looksAtCode, sessionId, recentSend, measure, commit]);

  // While a target holds, the page moving under it moves her: a scroll anywhere, or a resize.
  useEffect(() => {
    if (!holding) return undefined;
    window.addEventListener('scroll', scheduleMeasure, { capture: true, passive: true });
    window.addEventListener('resize', scheduleMeasure);
    return () => {
      window.removeEventListener('scroll', scheduleMeasure, { capture: true });
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [holding, scheduleMeasure]);

  // While she looks or a target holds, a registration may be the thing she was waiting for (the chat opened, its composer mounted).
  useEffect(() => {
    if (!looking && !holding) return undefined;
    return anchors.subscribe(scheduleMeasure);
  }, [looking, holding, anchors, scheduleMeasure]);

  // A measure still waiting for its frame when the button goes would set state on nothing.
  useEffect(() => () => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
  }, []);

  return target;
}
