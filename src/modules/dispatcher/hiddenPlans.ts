import { useSyncExternalStore } from 'react';

import { readUserPreference, subscribeToUserPreferences, writeUserPreferenceEntries } from '@/shared/userSettings';
import type { DispatcherPlan, PreferenceEntryPatch } from '@/shared/types';

/**
 * The operator's DISMISSALS: which DONE cards he has put off the board, and the way back from one
 * (at the foot of this file). Hiding an unfinished plan is NOT here: a hide holds a plan back from the
 * queue, so it is the dispatcher's — `dispatcher hide` and `dispatcher unhide` (`usePutAway`), recorded
 * in its store and carried on every plan as `plan.hidden` — and nothing about it is kept in this list.
 *
 * - DISMISS is the press a DONE card offers (a complete plan, or an arc whose every plan is): the card
 *   leaves the board in both homes, and nothing lists it or counts it. The operator, 2026-09-28: "when
 *   its done i want to dismiss it off the board, and not show that its hidden, otherwise ill have a ton
 *   of hidden cards that are done".
 * - HIDE is the press an UNFINISHED card offers (`putAwayVerb`): the dispatcher pauses the plan and holds it
 *   out of the queue, the card goes to the `Hidden` list at the foot of both homes, and `Show` brings it
 *   back and lets it take its turn, because a plan still to run must stay reachable.
 *
 * An entry is read for a DONE plan only (`useDispatcherPlans`): one that names a plan with work still
 * ahead is none of this list's business and reads as no entry. The list is the operator's, per user, and
 * rides the server-backed preferences as `hiddenPlans` under the `dispatcher` key (named for the press it
 * first held), so a press made on the phone is there on the desktop at its next load (the store hydrates
 * on sign-in, not by push). Nothing is ever written into a state directory: those belong to the
 * dispatcher, which keeps the plan whichever press was made.
 *
 * AN ENTRY IS A NAME AND THE MOMENT OF THE PRESS, `{ name, at }`, with `at` in epoch SECONDS. The
 * moment does two things. It pins the entry to the plan that stood under that name at the press, so a
 * plan dropped and opened again under the same name is not born put away. And it lets a dismissed plan
 * come back ON ITS OWN, once: when it ENDS again after the press, since an ending the operator never saw
 * is news. There is one entry per name. Dismissing a plan again replaces its entry.
 *
 * THE MOMENT IS NEVER EARLIER THAN WHAT THE PRESS SAW (`pressMoment`). It is read against the
 * dispatcher's own stamps, and a browser clock running behind the server stamped a Dismiss BEFORE the
 * ending it was dismissing, so the card read as news and stayed: the button did nothing (measured with
 * a clock 6 h slow). So `at` is at least the server's clock on the newest lane frame this page has
 * received (`noteLaneClock`): every stamp that frame carried is at or before it, and the press came
 * after the frame. A clock running AHEAD still stamps late, which can read a dismissed plan's ending
 * inside the skew as seen; nothing on the page can bound that side.
 *
 * AN ARC'S CORNER IS ONE PRESS, and its entries say so: `{ name, at, arc }`, one `at` for the whole
 * deck. On a MIXED arc (some plans done, some not) that press hides the unfinished plans at the
 * dispatcher (the epic's own `hide`) and dismisses the done ones here, so the `Hidden` list shows only
 * the unfinished ones. Read one entry at a time, `Show` would then bring back a deck missing its done
 * cards, with its progress misstated. So the press lets go as a WHOLE: a `Show` of an epic's plans
 * shows the epic at the dispatcher and releases every entry of it (`releaseDismissed`), and news on any
 * plan of the arc lets every entry of it go (`useDispatcherPlans`). A plan's own press and both
 * `Dismiss done` presses carry no `arc`, and each of their entries reads alone.
 *
 * EVERY CHANGE IS AN ENTRY PATCH (`writeUserPreferenceEntries`): it names only the plans it puts away
 * or shows, and the server lays it over its own copy entry by entry. A client's copy of this list is
 * read at sign-in and never again, so a write that sent the whole list let any client open a while (a
 * phone, a second tab) erase every entry made elsewhere since. That is how the operator's arc Hide of
 * 2026-09-28 was undone 11 s after the press, by another of his clients folding the same arc. A batch
 * (`Dismiss done`, an arc's corner, `Show all`) is one patch.
 *
 * ONE ID-SPACE, ONE LANE. Every name is a dispatcher plan's bare name, so every patch also drops the
 * entries this client holds for plans the lane no longer carries: they can never match anything
 * again, and keeping them would only push a live entry off the cap (200, `preferenceEntryPatch.ts`).
 * The lane only carries a finished plan for a day, so a dismissal is pruned soon after its plan leaves.
 * The lane handed in is the WHOLE lane, put-away plans included (`carriedNames`). Pruning against the
 * drawn cards would drop every earlier entry the moment a second was made. A plan name is a slug alone
 * (`^[a-z0-9][a-z0-9-]{0,99}$`, `hooks/dispatcher/store.py`), so nothing else can be addressed here.
 *
 * `usePutAwayEntries` hands React a STABLE array: `useSyncExternalStore` compares snapshots by
 * identity, and a getter that rebuilt the list on every call would report a change on every render and
 * loop. The cache is keyed on the stored list, which the preference store only replaces on a write or
 * a hydrate.
 */

/** One dismissed plan: its name, the press's moment, and the arc whose corner made the press, if one did. */
type PutAwayEntry = { name: string; at: number; arc?: string };

const KEY = 'dispatcher' as const;

const EMPTY: readonly PutAwayEntry[] = Object.freeze([]);

function isPutAwayEntry(value: unknown): value is PutAwayEntry {
  return (
    value !== null && typeof value === 'object'
    && typeof (value as PutAwayEntry).name === 'string'
    && typeof (value as PutAwayEntry).at === 'number'
    && ((value as PutAwayEntry).arc === undefined || typeof (value as PutAwayEntry).arc === 'string')
  );
}

/** The newest server clock (epoch ms) any lane frame this page has received was stamped with. */
let laneClockMs = 0;

/**
 * Records a lane frame's server stamp (`DispatcherLanePicture`'s bus `at`, the API's `Date.now()` at the
 * frame's build). Only ever moves forward, so the order readers report it in does not matter.
 */
export function noteLaneClock(at: number | null | undefined): void {
  if (typeof at === 'number' && Number.isFinite(at) && at > laneClockMs) laneClockMs = at;
}

/** A press's `at`: now on this browser, and never earlier than the newest lane frame it has seen. */
function pressMoment(): number {
  return Math.floor(Math.max(Date.now(), laneClockMs) / 1000);
}

/** The stored list as it stands, before any reading of it. */
function storedList(): unknown {
  const value = readUserPreference<unknown>(KEY, null);
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).hiddenPlans
    : undefined;
}

// The snapshot cache `useSyncExternalStore` needs: the stored list last read, and the entries read
// out of it, handed back by identity until the store replaces the list.
let lastRaw: unknown = undefined;
let lastEntries: readonly PutAwayEntry[] = EMPTY;

function readEntries(): readonly PutAwayEntry[] {
  const raw = storedList();
  if (raw === lastRaw) return lastEntries;
  lastRaw = raw;
  const entries = Array.isArray(raw) ? raw.filter(isPutAwayEntry) : [];
  lastEntries = entries.length === 0 ? EMPTY : entries;
  return lastEntries;
}

/** Every put-away entry. Re-renders the caller when a press or a show is written here, or arrives with a hydrate. */
export function usePutAwayEntries(): readonly PutAwayEntry[] {
  return useSyncExternalStore(subscribeToUserPreferences, readEntries, readEntries);
}

/**
 * The ONE write every change makes: `changes` (a press's entry, or `null` for a show), plus a `null`
 * for every entry this client holds whose plan `onLane` (every plan name the CALLER's lane carries,
 * put away or not) no longer names.
 */
function writeEntries(changes: Record<string, PutAwayEntry | null>, onLane: readonly string[]): void {
  const carried = new Set(onLane);
  const entries: PreferenceEntryPatch[string] = {};
  for (const entry of readEntries()) {
    if (!carried.has(entry.name)) entries[entry.name] = null;
  }
  writeUserPreferenceEntries(KEY, { hiddenPlans: { ...entries, ...changes } });
}

/**
 * Dismisses every plan in `names` as of this press, in ONE write. `arc` is the arc whose corner made the
 * press, which makes its entries one press. A name already dismissed gets its moment moved forward.
 * Used by `usePutAway` (a done card's corner, and the done plans of a mixed epic's corner) and by
 * `doneDismiss`.
 */
export function dismissPlans(names: readonly string[], onLane: readonly string[], arc: string | null = null): void {
  if (names.length === 0) return;
  const at = pressMoment();
  writeEntries(Object.fromEntries(names.map((name) => [name, arc === null ? { name, at } : { name, at, arc }])), onLane);
}

/**
 * Releases the dismissals a Show brings back, in ONE write: every entry for a plan in `names`, and every
 * entry of the arc presses in `arcs` — the done plans that press dismissed come back with the unfinished
 * ones it hid, so a mixed epic's deck returns whole. Used by `usePutAway`, after the dispatcher has shown
 * the plans.
 */
export function releaseDismissed(names: readonly string[], arcs: readonly string[], onLane: readonly string[]): void {
  const named = new Set(names);
  const pressed = new Set(arcs);
  const released = readEntries()
    .filter((entry) => named.has(entry.name) || (entry.arc !== undefined && pressed.has(entry.arc)))
    .map((entry) => entry.name);
  if (released.length === 0) return;
  writeEntries(Object.fromEntries(released.map((name) => [name, null])), onLane);
}

/*
 * THE CORNER'S PRESS AND THE HEADER'S, one rule for each press (`usePutAway`), so no home can drift apart
 * from another about what a press takes. A DONE card offers Dismiss and an unfinished one Hide
 * (`putAwayVerb`): Dismiss is the entry written here, Hide is the dispatcher's verb. `carriedNames` is always
 * the lane's UNFILTERED list of plan names (`useDispatcherPlans`), because that is what the stored list is
 * pruned against. No dialog guards any of them: neither deletes anything, and the dispatcher keeps the plan.
 */

/** The corner's verb for a card holding `plans`: `dismiss` when every one is complete, else `hide`. */
export function putAwayVerb(plans: readonly DispatcherPlan[]): 'dismiss' | 'hide' {
  return plans.length > 0 && plans.every((plan) => plan.status === 'complete') ? 'dismiss' : 'hide';
}

/**
 * `Dismiss done · N`: every COMPLETE plan of `plans` (the drawn ones) off the board in one write, with
 * `count` for the button's word. `null` when none is done, so the button is never drawn over nothing.
 */
export function doneDismiss(
  plans: readonly DispatcherPlan[],
  carriedNames: string[],
): { count: number; dismiss: () => void } | null {
  const done = plans.filter((plan) => plan.status === 'complete').map((plan) => plan.name);
  if (done.length === 0) return null;
  return { count: done.length, dismiss: () => dismissPlans(done, carriedNames) };
}
