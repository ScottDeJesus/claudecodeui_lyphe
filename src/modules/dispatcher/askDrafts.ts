import { useSyncExternalStore } from 'react';

import { readUserPreference, subscribeToUserPreferences, writeUserPreferenceEntries } from '@/shared/userSettings';
import type { AskDraft, LockCompose, RoundPick } from '@/shared/types';

/**
 * Where a plan card's HALF-ANSWERED ask is kept: `askDrafts` under the `dispatcher` preference, a list
 * of `{ name, … }` with one entry per open ask — `name` the ask's `askIdentity` — and the rest what the
 * form needs to come back exactly (`AskDraft`): a round's picks with their `Other…` words and whether
 * that field is open, or a lock's Rework notes and whether the notes field is open.
 *
 * WHY IT IS HERE AND NOT IN THE FORM'S STATE (operator: "Plan card answers to questions should
 * save"). The form kept it in component state, so every remount emptied it: a page reload (the dev
 * client's own, a phone browser dropping a background tab), the other surface (the Runner tab and the
 * chat gutter's widget are separate copies of the same card), a widget unmounted below 1500px. The
 * ask's identity is stable for the life of one ask, so the key is not the problem and a different ask
 * — a re-cut — starts empty as it always did.
 *
 * It follows `hiddenPlans.ts` and `cardOrderEntries.ts` in everything that is not the entry's shape:
 *
 * - EVERY WRITE IS AN ENTRY PATCH (`writeUserPreferenceEntries`) naming only the ask it changes, so a
 *   draft saved on the phone and one saved on the desktop cannot erase each other, and the server
 *   needs no registration for the list (both merge paths accept any list name under `dispatcher` and
 *   cap it at 200 entries, dropped from the front).
 * - A DRAFT IS A PICTURE OF THE FORM, NOT AN ANSWER. Nothing here sends anything: a draft is only what
 *   the form starts from, and sending stays the operator's press. A taken answer clears its draft
 *   (`useAskDraft`'s `clear`), and the prune below drops the drafts of every ask the lane no longer
 *   carries — answered elsewhere, retracted, re-cut — so none outlives its ask for long. That prune
 *   is immediate, and it has one known gap: the store hides an ask while a planner outing is live on
 *   its plan or its arc, and the SAME ask (same `asked` id and stamp) is open again when the outing
 *   ends, so a draft can be lost to an outing the operator did not start. Accepted: before drafts
 *   existed those words were lost on every remount, and a draft cannot tell an ask that is gone for
 *   good from one that is only out of sight.
 * - THE READER HANDS REACT A STABLE ENTRY: `useSyncExternalStore` compares snapshots by identity, and
 *   a getter that rebuilt the map on every call would report a change on every render and loop. The
 *   cache is keyed on the stored list, which the preference store only replaces on a write or a hydrate.
 */

const KEY = 'dispatcher' as const;

const EMPTY: ReadonlyMap<string, AskDraft> = new Map();

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

function isRoundPick(value: unknown): value is RoundPick {
  return (
    isRecord(value)
    && (value.picked === null || typeof value.picked === 'string')
    && typeof value.other === 'string'
    && typeof value.otherOpen === 'boolean'
  );
}

/** An entry this build can draw: a name, and a round's picks or a lock's notes. Anything else (another build's shape) is ignored. */
function isAskDraft(value: unknown): value is AskDraft {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name === '') return false;
  if (Array.isArray(value.picks)) return value.picks.every(isRoundPick);
  return typeof value.rework === 'boolean' && typeof value.notes === 'string';
}

/** The stored list as it stands, before any reading of it. */
function storedList(): unknown {
  const value = readUserPreference<unknown>(KEY, null);
  return isRecord(value) ? value.askDrafts : undefined;
}

// The snapshot cache `useSyncExternalStore` needs: the stored list last read, and the drafts read out
// of it, handed back by identity until the store replaces the list.
let lastRaw: unknown = undefined;
let lastDrafts: ReadonlyMap<string, AskDraft> = EMPTY;

function readDrafts(): ReadonlyMap<string, AskDraft> {
  const raw = storedList();
  if (raw === lastRaw) return lastDrafts;
  lastRaw = raw;
  const entries = Array.isArray(raw) ? raw.filter(isAskDraft) : [];
  lastDrafts = entries.length === 0 ? EMPTY : new Map(entries.map((entry) => [entry.name, entry]));
  return lastDrafts;
}

/** The saved draft of one ask, or `null` when it has none. A plain read, for an effect that must see the store as it is NOW. */
export function readAskDraft(identity: string): AskDraft | null {
  return readDrafts().get(identity) ?? null;
}

/** The saved draft of one ask. Re-renders the caller when it is written here, or arrives with a hydrate. */
export function useStoredAskDraft(identity: string): AskDraft | null {
  const read = () => readAskDraft(identity);
  return useSyncExternalStore(subscribeToUserPreferences, read, read);
}

/**
 * The ONE write a draft makes: this ask's entry, or `null` for none. A `null` for an ask with no entry
 * writes nothing at all (the store would otherwise create the list to say it holds nothing).
 */
export function saveAskDraft(identity: string, draft: AskDraft | null): void {
  if (draft === null && !readDrafts().has(identity)) return;
  writeUserPreferenceEntries(KEY, { askDrafts: { [identity]: draft } });
}

/**
 * Drops every saved draft whose ask is not in `carried` (`asksOnLane`: every identity the lane's
 * picture names, put-away plans included), in ONE write. A hidden plan still owes its word and keeps
 * its draft; an ask the lane has dropped is, as far as this page can tell, gone — answered, retracted
 * or re-cut — and its draft would only push a live one off the cap. The one ask that comes BACK under
 * the same identity (an outing ended on its plan, `askDrafts.ts`'s head) loses its draft here.
 */
export function pruneAskDrafts(carried: readonly string[]): void {
  const live = new Set(carried);
  const dropped = [...readDrafts().keys()].filter((identity) => !live.has(identity));
  if (dropped.length === 0) return;
  writeUserPreferenceEntries(KEY, { askDrafts: Object.fromEntries(dropped.map((identity) => [identity, null])) });
}

/**
 * How a form's own state becomes a draft and back. `restore` is handed the form's blank state too,
 * because a saved draft is only usable if it has the shape of THIS ask (a round's picks must be one
 * per question); `null` means "not one I can draw", and the form starts blank. `capture` answers
 * `null` for a state that is blank, so a form emptied back to nothing deletes its entry instead of
 * saving a draft of nothing.
 */
export type AskDraftCodec<State> = {
  restore: (draft: AskDraft, blank: State) => State | null;
  capture: (identity: string, state: State) => AskDraft | null;
};

const isBlankPick = (pick: RoundPick) => pick.picked === null && pick.other === '' && !pick.otherOpen;

/** A round's codec: its state is the list of picks, one per question. */
export const ROUND_DRAFT: AskDraftCodec<RoundPick[]> = {
  restore: (draft, blank) => ('picks' in draft && draft.picks.length === blank.length ? draft.picks : null),
  capture: (identity, picks) => (picks.every(isBlankPick) ? null : { name: identity, picks }),
};

/** A lock's codec: its state is Rework's notes field, open or not, and what is in it. */
export const LOCK_DRAFT: AskDraftCodec<LockCompose> = {
  restore: (draft) => ('notes' in draft ? { rework: draft.rework, notes: draft.notes } : null),
  capture: (identity, state) => (!state.rework && state.notes === '' ? null : { name: identity, rework: state.rework, notes: state.notes }),
};
