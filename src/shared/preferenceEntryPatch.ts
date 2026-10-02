import type { PreferenceEntryPatch } from '@/shared/types';

/**
 * The ENTRY PATCH: how a preference that is a document of entry lists is written, so that no
 * device's write can erase an entry another device wrote.
 *
 * WHY IT EXISTS. The `dispatcher` preference holds three lists (the hidden plans, the folded cards and
 * the card order) that every open client writes. Each client's copy is read at sign-in and never again. So when a
 * write sent the WHOLE document, any client that had been open a while (a second tab, a phone, the
 * :5184 build) wrote back its own old copy and erased every hide and fold made elsewhere since. That
 * is how the operator's arc Hide of 2026-09-28 22:17:49 was undone, 11 s later, by another of his
 * clients folding the same arc. A patch names only the entries its press changed, and every entry it
 * does not name stands.
 *
 * ONE RULE ON BOTH SIDES. `applyEntryPatch` is what this device does to its own copy, and the server
 * applies the same rule to the stored one (`mergeEntryLists`,
 * `server/modules/database/repositories/user-preferences.db.ts`), so the two copies converge. The
 * rule: drop every entry the patch names, then append the patch's non-null entries in the patch's
 * order (a re-hidden plan becomes the newest), then keep the newest `ENTRY_LIST_CAP`.
 *
 * The store's other needs live here too, beside the rule they follow: folding two patches queued
 * inside one debounce window (`foldEntryPatches`), rebuilding a failed patch from what the store
 * holds NOW before it is retried (`refreshEntryPatch`), and the OUTBOX that keeps a patch until the
 * server has it (below). Used only by `userSettings.ts`; a sibling file because that file is already
 * past its size ceiling.
 */

/** The most entries one list keeps, newest last. The server's `ENTRY_LIST_CAP` mirrors it. */
const ENTRY_LIST_CAP = 200;

type EntryDocument = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

/** An entry's key: a bare string is its own key, a record's is its `name`. `null` for anything else. */
function entryKeyOf(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  return isRecord(entry) && typeof entry.name === 'string' ? entry.name : null;
}

/** One list with one list-patch applied: the rule in this file's head. */
function patchList(stored: unknown, listPatch: Record<string, unknown>): unknown[] {
  const named = new Set(Object.keys(listPatch));
  const kept = (Array.isArray(stored) ? stored : []).filter((entry) => {
    const key = entryKeyOf(entry);
    return key !== null && !named.has(key);
  });
  // An entry whose own key is not the key it was sent under is malformed and is not stored.
  const added = Object.entries(listPatch)
    .filter(([key, entry]) => entry !== null && entryKeyOf(entry) === key)
    .map(([, entry]) => entry);
  return [...kept, ...added].slice(-ENTRY_LIST_CAP);
}

/** The document with `patch` applied. Lists the patch does not name, and every other key, are carried as they stand. */
export function applyEntryPatch(document: unknown, patch: PreferenceEntryPatch): EntryDocument {
  const next: EntryDocument = isRecord(document) ? { ...document } : {};
  for (const [list, listPatch] of Object.entries(patch)) {
    next[list] = patchList(next[list], listPatch);
  }
  return next;
}

/** Two patches queued before a flush, as one: per entry, the newer (`incoming`) wins. */
export function foldEntryPatches(pending: unknown, incoming: unknown): unknown {
  if (!isRecord(pending) || !isRecord(incoming)) return incoming;
  const folded: Record<string, unknown> = { ...pending };
  for (const [list, listPatch] of Object.entries(incoming)) {
    const earlier = folded[list];
    folded[list] = isRecord(earlier) && isRecord(listPatch) ? { ...earlier, ...listPatch } : listPatch;
  }
  return folded;
}

/**
 * A patch whose send failed, rebuilt for its retry from what the store holds NOW: every entry it
 * named, as `current` has it (or `null` where `current` no longer does), and nothing it did not
 * name. A send can fail late (the request timeout is 30 s), and the old patch re-sent as it was
 * would put back a hide the operator has since shown again.
 */
export function refreshEntryPatch(current: unknown, sent: unknown): unknown {
  if (!isRecord(sent)) return sent;
  const document = isRecord(current) ? current : {};
  const refreshed: Record<string, Record<string, unknown>> = {};
  for (const [list, listPatch] of Object.entries(sent)) {
    if (!isRecord(listPatch)) continue;
    const held = new Map<string, unknown>();
    for (const entry of Array.isArray(document[list]) ? document[list] : []) {
      const key = entryKeyOf(entry);
      if (key !== null) held.set(key, entry);
    }
    refreshed[list] = Object.fromEntries(Object.keys(listPatch).map((key) => [key, held.get(key) ?? null]));
  }
  return refreshed;
}

/*
 * THE OUTBOX: every entry patch this device has written and not yet seen the server confirm, per
 * preference key, folded per entry. That covers a patch still queued, one in flight, and one left by a
 * page that closed or reloaded before its PATCH landed.
 *
 * It lives in localStorage beside the mirror because the queue that sends a patch is page memory. A
 * Hide whose PATCH had not landed (the 400 ms debounce, or a retry backing off behind a 5xx or a
 * dropped request) died with the page, and the next sign-in read put the arc back. A sign-in read the
 * server answered before a PATCH landed did the same on the page that sent it. So the hydrate lays
 * every unconfirmed entry over the copy it fetched, and sends again whatever of it that copy does not
 * hold. Sending a patch twice is safe: it names only its own entries.
 */

/** The outbox's localStorage key, beside the mirror's (`user-preferences`). */
const OUTBOX_STORAGE_KEY = 'user-preferences:entry-outbox';

/** The outbox as last written, for a browser whose localStorage cannot be read or written. */
let outboxInMemory: Record<string, unknown> = {};

/** Every unconfirmed patch, by preference key. */
export function readEntryOutbox(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(OUTBOX_STORAGE_KEY);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return outboxInMemory;
  }
}

function writeEntryOutbox(outbox: Record<string, unknown>): void {
  outboxInMemory = outbox;
  try {
    if (Object.keys(outbox).length === 0) localStorage.removeItem(OUTBOX_STORAGE_KEY);
    else localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(outbox));
  } catch {
    // The in-memory copy still carries the page; only a reload loses what could not be stored.
  }
}

/** `patch` added to `key`'s unconfirmed entries, as the newest word on every entry it names. */
export function recordEntryPatch(key: string, patch: PreferenceEntryPatch): void {
  const outbox = readEntryOutbox();
  writeEntryOutbox({ ...outbox, [key]: foldEntryPatches(outbox[key], patch) });
}

/** `key`'s unconfirmed entries replaced by `patch`, or dropped when it is `null`. */
export function replaceEntryOutbox(key: string, patch: PreferenceEntryPatch | null): void {
  const { [key]: _prior, ...rest } = readEntryOutbox();
  writeEntryOutbox(patch === null ? rest : { ...rest, [key]: patch });
}

/**
 * The entries of `settled` (a patch the server stored, or refused for good) taken out of `key`'s
 * unconfirmed ones: each only while the outbox still holds exactly that value, so a newer press on
 * the same entry, written while this one was in flight, stays until its own PATCH settles.
 */
export function settleEntryPatch(key: string, settled: unknown): void {
  const outbox = readEntryOutbox();
  const held = outbox[key];
  if (!isRecord(held) || !isRecord(settled)) return;
  const remaining: PreferenceEntryPatch = {};
  for (const [list, listPatch] of Object.entries(held)) {
    if (!isRecord(listPatch)) continue;
    const sent = isRecord(settled[list]) ? settled[list] : {};
    const left = Object.entries(listPatch).filter(([entryKey, entry]) =>
      !(entryKey in sent) || JSON.stringify(sent[entryKey]) !== JSON.stringify(entry));
    if (left.length > 0) remaining[list] = Object.fromEntries(left) as PreferenceEntryPatch[string];
  }
  replaceEntryOutbox(key, Object.keys(remaining).length === 0 ? null : remaining);
}

/**
 * The part of `patch` that `document` does not already hold as the patch says: an entry the patch
 * sets that the document lacks or holds differently, and an entry it removes that the document still
 * holds. `null` when the document holds all of it, which is the server's confirmation of that patch.
 */
export function unreflectedEntries(document: unknown, patch: unknown): PreferenceEntryPatch | null {
  if (!isRecord(patch)) return null;
  const held = isRecord(document) ? document : {};
  const missing: PreferenceEntryPatch = {};
  for (const [list, listPatch] of Object.entries(patch)) {
    if (!isRecord(listPatch)) continue;
    const stored = new Map<string, string>();
    for (const entry of Array.isArray(held[list]) ? held[list] : []) {
      const key = entryKeyOf(entry);
      if (key !== null) stored.set(key, JSON.stringify(entry));
    }
    const left = Object.entries(listPatch).filter(([key, entry]) => (entry === null
      ? stored.has(key)
      : stored.get(key) !== JSON.stringify(entry)));
    if (left.length > 0) missing[list] = Object.fromEntries(left) as PreferenceEntryPatch[string];
  }
  return Object.keys(missing).length === 0 ? null : missing;
}

/** The outbox emptied: on sign-out, where every unconfirmed patch belongs to the user who left. */
export function clearEntryOutbox(): void {
  writeEntryOutbox({});
}
