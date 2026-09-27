import { useSyncExternalStore } from 'react';

import { readUserPreference, subscribeToUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * Which plans the operator has HIDDEN from the lane, and the two ways to change that.
 *
 * Any plan can be hidden, in any state: the card leaves the grid for the `Hidden` list at the foot
 * of both homes, and `Show` brings it back. That is the whole difference from the dismissal this
 * replaces, which only a complete plan could take and nothing could undo. The list is the operator's,
 * per user, and rides the server-backed preferences under the `dispatcher` key, so a hide made on the
 * phone is there on the desktop at its next load (the store hydrates on sign-in, not by push). Nothing
 * is ever written into a state directory: those belong to the dispatcher.
 *
 * AN ENTRY IS A NAME AND THE MOMENT OF THE PRESS, `{ name, at }`, with `at` in epoch SECONDS on the
 * browser's clock. The moment does two things (`useDispatcherPlans` holds both rules). It pins the
 * hide to the plan that stood under that name at the press, so a plan dropped and opened again under
 * the same name is not born hidden. And it lets a hidden plan come back ON ITS OWN, once: when it ENDS
 * after it was hidden, since a plan that finishes is news the operator never saw. There is one entry
 * per name. Hiding a plan again replaces its entry and moves `at` forward.
 *
 * ONE ID-SPACE, ONE LANE, ONE LIST. Every name is a dispatcher plan's bare name, so every write
 * prunes the stored list WHOLE against the lane the caller can see: an entry the lane no longer
 * carries can never match anything again, and keeping it would only push a live entry off the cap.
 * The lane handed in is the WHOLE lane, hidden plans included (`carriedNames`). Pruning against the
 * drawn cards would drop every earlier hide the moment a second was made. A plan name is a slug alone
 * (`^[a-z0-9][a-z0-9-]{0,99}$`, `hooks/dispatcher/store.py`), so nothing else can be addressed here.
 *
 * THE DISMISSALS THIS REPLACES ARE READ AS HIDES, so nothing waved away before this store existed
 * comes back. The old list held `{ run_id: <plan name>, ended_at: <its completed_at> }`. Read as
 * `{ name: run_id, at: ended_at }`, each one hides that plan through the ending it named and no later,
 * which is exactly what the dismissal did. Every write stores the merged list and drops the old key
 * (and its own retired predecessor, `dismissedRunIds`), so the carry dies on the first press.
 *
 * Each change is ONE write, MERGED into the `dispatcher` blob (MAN-498: a replaced blob drops whatever
 * else lives under the key, and the card folds live there too), and capped so the list cannot grow
 * without bound. A batch (`Hide ended`, an arc's Hide, `Show all`) is one write too, because the last
 * document to write wins (INV-4406) and N writes in a row would race each other.
 *
 * `useHiddenPlans` hands React a STABLE array: `useSyncExternalStore` compares snapshots by identity,
 * and a getter that rebuilt the list on every call would report a change on every render and loop. The
 * cache is keyed on the two raw lists, which the preference store only replaces on a write or a
 * hydrate, so the array is rebuilt exactly when either is.
 */

type HiddenPlan = { name: string; at: number };

type DispatcherPreference = Record<string, unknown>;

const KEY = 'dispatcher' as const;

/** The pre-hide dismissal list's key: read once for the carry, and dropped by every write. */
const LEGACY_KEY = 'dismissedEndings';

/** The most entries kept. A lane holds a few dozen plans at most, so two hundred is a bug's worth. */
const CAP = 200;

const EMPTY: readonly HiddenPlan[] = Object.freeze([]);

function readPreference(): DispatcherPreference {
  const value = readUserPreference<unknown>(KEY, null);
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as DispatcherPreference) : {};
}

function isHiddenPlan(value: unknown): value is HiddenPlan {
  return (
    value !== null && typeof value === 'object'
    && typeof (value as HiddenPlan).name === 'string'
    && typeof (value as HiddenPlan).at === 'number'
  );
}

/** One legacy dismissal `{ run_id, ended_at }` read as the hide it amounts to, or `null` for a malformed row. */
function carriedDismissal(value: unknown): HiddenPlan | null {
  if (value === null || typeof value !== 'object') return null;
  const { run_id: name, ended_at: at } = value as { run_id?: unknown; ended_at?: unknown };
  return typeof name === 'string' && typeof at === 'number' ? { name, at } : null;
}

/**
 * The legacy rows first and the new ones after, collapsed to ONE entry per name holding the LATEST
 * `at`. The latest hides the most, and every earlier moment is contained in it. A name's position is
 * where it first appeared, so the cap trims the oldest names first.
 */
function mergeEntries(raw: unknown, legacy: unknown): readonly HiddenPlan[] {
  const merged = new Map<string, number>();
  const rows = [
    ...(Array.isArray(legacy) ? legacy.map(carriedDismissal) : []),
    ...(Array.isArray(raw) ? raw.filter(isHiddenPlan) : []),
  ];
  for (const row of rows) {
    if (row === null) continue;
    merged.set(row.name, Math.max(row.at, merged.get(row.name) ?? row.at));
  }
  return merged.size === 0 ? EMPTY : [...merged].map(([name, at]) => ({ name, at }));
}

// The snapshot cache `useSyncExternalStore` needs: the two raw lists last read, and the merged array
// built from them, handed back by identity until the store replaces either list.
let lastRaw: unknown = undefined;
let lastLegacy: unknown = undefined;
let lastEntries: readonly HiddenPlan[] = EMPTY;

/** The hidden plans, legacy dismissals included, as a reference that changes only when either list does. */
export function readHiddenPlans(): readonly HiddenPlan[] {
  const preference = readPreference();
  const raw = preference.hiddenPlans;
  const legacy = preference[LEGACY_KEY];
  if (raw === lastRaw && legacy === lastLegacy) return lastEntries;
  lastRaw = raw;
  lastLegacy = legacy;
  lastEntries = mergeEntries(raw, legacy);
  return lastEntries;
}

/** Re-renders the caller when a hide or a show is written here, or arrives with a hydrate. */
export function useHiddenPlans(): readonly HiddenPlan[] {
  return useSyncExternalStore(subscribeToUserPreferences, readHiddenPlans, readHiddenPlans);
}

/**
 * The ONE write every change makes: `entries` pruned to the lane and capped, stored MERGED into the
 * blob, with the legacy list and its retired predecessor dropped from it. `onLane` is every plan name
 * the CALLER's lane carries, hidden or not.
 */
function writeHiddenPlans(entries: readonly HiddenPlan[], onLane: readonly string[]): void {
  const keep = new Set(onLane);
  const next = entries.filter((entry) => keep.has(entry.name)).slice(-CAP);
  const { [LEGACY_KEY]: _legacy, dismissedRunIds: _retired, hiddenPlans: _prior, ...rest } = readPreference();
  writeUserPreference(KEY, { ...rest, hiddenPlans: next });
}

/**
 * Hides every plan in `names` as of this press, in ONE write. A name already hidden gets its moment
 * moved forward and goes to the back of the list, since it is the newest hide.
 */
export function hidePlans(names: readonly string[], onLane: readonly string[]): void {
  if (names.length === 0) return;
  const at = Math.floor(Date.now() / 1000);
  const pressed = new Set(names);
  writeHiddenPlans([
    ...readHiddenPlans().filter((entry) => !pressed.has(entry.name)),
    ...[...pressed].map((name) => ({ name, at })),
  ], onLane);
}

/** Shows every plan in `names` again, in ONE write. */
export function showPlans(names: readonly string[], onLane: readonly string[]): void {
  if (names.length === 0) return;
  const shown = new Set(names);
  writeHiddenPlans(readHiddenPlans().filter((entry) => !shown.has(entry.name)), onLane);
}
