import { useSyncExternalStore } from 'react';

import { readUserPreference, subscribeToUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * Which ENDINGS the operator has waved away, and the one way to add to that list.
 *
 * A plan that has completed stays on the lane for a day (`ENDED_KEEP_S`, server side) so the operator
 * sees it finish; dismissing it is theirs, per user, and rides the server-backed preferences under the
 * `dispatcher` key — a merged write, so a dismissal made on the phone is there on the desktop on its
 * next load (the store hydrates on sign-in, not by push). Nothing is ever written into a state
 * directory: those belong to the dispatcher.
 *
 * A DISMISSAL IS OF ONE ENDING, NOT OF A PLAN NAME. A plan cut and walked again ends again with a
 * fresh `completed_at`, and a dismissal keyed on the name alone would swallow that second ending
 * silently — so the key is `{run_id, ended_at}`, the plan's NAME in `run_id` beside the instant it
 * finished, and a plan that ends anew is a new card. `run_id` keeps that field's name for the half of
 * the pair that is an id rather than inventing a third spelling of it.
 *
 * ONE ID-SPACE, ONE LANE, ONE LIST. Every id in it is a dispatcher plan's bare name, so the stored
 * list is pruned WHOLE against the lane the caller can see: an entry the lane no longer carries can
 * never match anything again, and keeping it would only push a live entry off the cap. The lane handed
 * in is the WHOLE lane, dismissed plans included — pruning against the visible list would drop every
 * earlier dismissal the moment a second was made. A plan name is a slug alone
 * (`^[a-z0-9][a-z0-9-]{0,99}$`, `hooks/dispatcher/names.py`), so nothing else can be addressed here.
 *
 * The write is MERGED into the `dispatcher` blob (MAN-498 — a replaced blob drops whatever else lives
 * under the key), and capped so the list cannot grow without bound.
 *
 * `useDismissedEndings` hands React a STABLE array: `useSyncExternalStore` compares snapshots by
 * identity, and a getter that filtered afresh on every call would report a change on every render
 * and loop. The cache is keyed on the raw preference value, which the store only replaces on a
 * write or a hydrate, so the array is rebuilt exactly when the preference is.
 */

export type DismissedEnding = { run_id: string; ended_at: number };

type DispatcherPreference = Record<string, unknown> & { dismissedEndings?: unknown };

const KEY = 'dispatcher' as const;

/** The most endings kept. A day's worth of plans on one box is a handful; a hundred is a bug's worth. */
const CAP = 100;

const EMPTY: readonly DismissedEnding[] = Object.freeze([]);

function readPreference(): DispatcherPreference {
  const value = readUserPreference<unknown>(KEY, null);
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as DispatcherPreference) : {};
}

function isEnding(value: unknown): value is DismissedEnding {
  return (
    value !== null && typeof value === 'object'
    && typeof (value as DismissedEnding).run_id === 'string'
    && typeof (value as DismissedEnding).ended_at === 'number'
  );
}

let lastRaw: unknown = undefined;
let lastEndings: readonly DismissedEnding[] = EMPTY;

/** The dismissed endings, as a reference that changes only when the preference does. */
export function readDismissedEndings(): readonly DismissedEnding[] {
  const raw = readPreference().dismissedEndings;
  if (raw === lastRaw) return lastEndings;
  lastRaw = raw;
  lastEndings = Array.isArray(raw) ? raw.filter(isEnding) : EMPTY;
  return lastEndings;
}

/** Re-renders the caller when a dismissal is written here, or arrives with a hydrate. */
export function useDismissedEndings(): readonly DismissedEnding[] {
  return useSyncExternalStore(subscribeToUserPreferences, readDismissedEndings, readDismissedEndings);
}

/**
 * Dismisses one ending. `onLane` is every plan name the lane the CALLER can see currently carries —
 * dismissed or not — so the stored list is pruned of what the lane will never match again before the
 * new one is appended.
 */
export function dismissEnding(ending: DismissedEnding, onLane: readonly string[]): void {
  const keep = new Set(onLane);
  const next = [
    ...readDismissedEndings().filter((held) => held.run_id === ending.run_id || keep.has(held.run_id)),
    ending,
  ].slice(-CAP);
  // `dismissedRunIds` was this list's first, id-keyed shape; it is dropped rather than carried.
  const { dismissedRunIds: _retired, ...rest } = readPreference();
  writeUserPreference(KEY, { ...rest, dismissedEndings: next });
}
