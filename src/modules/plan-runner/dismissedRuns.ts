import { useSyncExternalStore } from 'react';

import type { RunnerRunSnapshot } from '@/shared/types';
import { readUserPreference, subscribeToUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * Which ENDINGS the operator has waved away, and the one way to add to that list.
 *
 * An ended run stays on the lane for a day (`ENDED_KEEP_S`, server side) so the operator sees it
 * finish; dismissing it is theirs, per user, and rides the server-backed preferences under the
 * `planRunner` key — a merged write, so a dismissal made on the phone is there on the desktop on
 * its next load (the store hydrates on sign-in, not by push). Nothing is ever written into the
 * runner's own state directory: that directory is the runner's.
 *
 * A DISMISSAL IS OF ONE ENDING, NOT OF A RUN ID. `plan-runner resume` reopens a run in place —
 * same directory, same id — and it ends again with a fresh receipt; both in-place resumes on this
 * host re-ended under one id, one of them with a different outcome. A dismissal keyed on the id
 * alone would swallow that second ending silently, so the key is `{run_id, ended_at}` and a run
 * that ends anew is a new card.
 *
 * The write is MERGED into the `planRunner` blob (MAN-498 — a replaced blob
 * drops whatever else lives under the key), capped so the list cannot grow without bound, and
 * pruned WITHIN THE ENDING'S OWN ID-SPACE: an entry the lane handed in can no longer carry will
 * never match anything again, so keeping it would only push a live entry off the cap. The lane
 * handed in is the WHOLE lane, dismissed runs included — pruning against the visible list would
 * drop every earlier dismissal the moment a second was made.
 *
 * TWO ID-SPACES, ONE LIST. The runner's run ids are one space and the dispatcher's v3 plans the
 * other: a plan dismisses into this same list under `v3:<plan name>` (src/modules/dispatcher).
 * A dismiss site sees one lane or both — the Runner tab's two lists hold both and hand in both,
 * while an arc card is drawn by the run lane alone — so the prune is scoped to the space its ending
 * belongs to, and an entry in the other space is left standing. It has to be scoped here: scoping it
 * at the call sites means an arc card reaching for the plan lane, and the two modules would import
 * each other. Without the scope, a dismissal made where only one lane is visible dropped the other
 * lane's entries, and every plan the operator had waved away came back to their screen.
 *
 * `useDismissedEndings` hands React a STABLE array: `useSyncExternalStore` compares snapshots by
 * identity, and a getter that filtered afresh on every call would report a change on every render
 * and loop. The cache is keyed on the raw preference value, which the store only replaces on a
 * write or a hydrate, so the array is rebuilt exactly when the preference is.
 */

export type DismissedEnding = { run_id: string; ended_at: number };

type PlanRunnerPreference = Record<string, unknown> & { dismissedEndings?: unknown };

const KEY = 'planRunner' as const;

/** The most endings kept. A day's worth of runs on one box is a handful; a hundred is a bug's worth. */
const CAP = 100;

/**
 * The dispatcher lane's own id form for a plan's ending: `v3:<plan name>`. It lives here, in the
 * store the form is stored in, rather than beside the hook that writes it — the prefix is half of
 * this list's own address space (`spaceOf`), and a second spelling of it in the plan lane is how the
 * two lanes would drift apart again.
 */
export const DISPATCHER_ENDING_PREFIX = 'v3:';

/**
 * Which id-space an ending's id belongs to. A run id is minted by the runner from the plan's file
 * name and a stamp; a plan's ending is the dispatcher's `v3:<name>` (a plan name is a slug, so no
 * run id can wear that prefix).
 */
function spaceOf(id: string): 'dispatcher' | 'runner' {
  return id.startsWith(DISPATCHER_ENDING_PREFIX) ? 'dispatcher' : 'runner';
}

const EMPTY: readonly DismissedEnding[] = Object.freeze([]);

function readPreference(): PlanRunnerPreference {
  const value = readUserPreference<unknown>(KEY, null);
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as PlanRunnerPreference) : {};
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

/** True when THIS ending of the run is one the operator dismissed. A run that ended anew is not. */
export function isDismissed(run: RunnerRunSnapshot, dismissed: readonly DismissedEnding[]): boolean {
  return run.state === 'ended'
    && dismissed.some((ending) => ending.run_id === run.run_id && ending.ended_at === run.ended_at);
}

/**
 * Dismisses one ending. `onLane` is every id the lane the CALLER can see currently carries —
 * dismissed or not — so the stored list is pruned of what that lane will never match again before
 * the new one is appended. The prune stops at the ending's own id-space (`spaceOf`): an entry of the
 * other lane is kept, because the lane handed in cannot speak for it.
 */
export function dismissRun(ending: DismissedEnding, onLane: readonly string[]): void {
  const keep = new Set(onLane);
  const space = spaceOf(ending.run_id);
  const next = [
    ...readDismissedEndings().filter((held) =>
      held.run_id !== ending.run_id && (spaceOf(held.run_id) !== space || keep.has(held.run_id))),
    ending,
  ].slice(-CAP);
  // `dismissedRunIds` was this list's first, id-keyed shape; it is dropped rather than carried.
  const { dismissedRunIds: _retired, ...rest } = readPreference();
  writeUserPreference(KEY, { ...rest, dismissedEndings: next });
}
