import type { PreferenceEntryPatch } from '@/shared/types';

/**
 * The ENTRY PATCH: how a preference that is a document of entry lists is written, so that no
 * device's write can erase an entry another device wrote.
 *
 * WHY IT EXISTS. The `dispatcher` preference holds four lists (the hidden plans, the folded cards, the
 * card order and the half-typed answers to open asks) that every open client writes. Each client's copy is read at sign-in and never again. So when a
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
 * A STAMP LIST MOVES FORWARD ONLY (`FORWARD_ONLY_ENTRY_KEYS`). `roadmapSeen` holds, per roadmap, the
 * completion this user last celebrated (`{ name, at }`): a patch carrying an OLDER `at` than the entry
 * it names is a stale device's retry, and it is not applied, so one device can never rewind what the
 * other played. The server's merge (`patchEntryList`) says the same.
 *
 * A STRING LIST HOLDS STRINGS (`STRING_ONLY_ENTRY_KEYS`). `filesPins` is a list of folder paths, each
 * its own key: an entry that is not a string is not stored, and one already stored is dropped by the
 * next patch to its list, so `pinned` never holds a non-string entry. The server's merge says the same,
 * and keeps only the string entries of a list sent whole. `claudePermissions` is the same kind of list
 * (its `allowedTools` and `disallowedTools`, a rule string each), but its callers hold and write the WHOLE
 * document, so its wire value is made from the difference (`entryDocumentDiff`).
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

/** The preference keys whose entries carry an `at` that only moves forward: a patch older than the stored entry is dropped. The server's `FORWARD_ONLY_KEYS` mirrors it. */
const FORWARD_ONLY_ENTRY_KEYS: ReadonlySet<string> = new Set(['roadmapSeen']);

/** The preference keys whose lists hold bare strings only, each its own entry key: any other entry is not stored. The server's `STRING_ONLY_KEYS` mirrors it. */
const STRING_ONLY_ENTRY_KEYS: ReadonlySet<string> = new Set(['filesPins', 'claudePermissions']);

/** What a key's lists hold beyond the common rule: `forwardOnly` (a stamp never moves back) and `stringOnly` (an entry is a bare string). */
export type EntryRule = { forwardOnly: boolean; stringOnly: boolean };

const COMMON_RULE: EntryRule = { forwardOnly: false, stringOnly: false };

/** The rule one preference key's lists follow. */
export function entryRuleOf(key: string): EntryRule {
  return { forwardOnly: FORWARD_ONLY_ENTRY_KEYS.has(key), stringOnly: STRING_ONLY_ENTRY_KEYS.has(key) };
}

/** Whether the list the rule governs may hold this entry. */
const isHeldEntry = (entry: unknown, rule: EntryRule): boolean => !rule.stringOnly || typeof entry === 'string';

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

/** An entry's key: a bare string is its own key, a record's is its `name`. `null` for anything else. */
function entryKeyOf(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  return isRecord(entry) && typeof entry.name === 'string' ? entry.name : null;
}

/** Whether the stored entry carries a later `at` than the one a patch sends under its key: the stamp that must not be rewound. */
function storedIsLater(stored: unknown, sent: unknown): boolean {
  if (!isRecord(stored) || !isRecord(sent)) return false;
  const held = Date.parse(String(stored.at));
  const offered = Date.parse(String(sent.at));
  return !Number.isNaN(held) && !Number.isNaN(offered) && held > offered;
}

/** The entries of a list by key, for the forward-only test. */
function entriesByKey(list: unknown): Map<string, unknown> {
  const held = new Map<string, unknown>();
  for (const entry of Array.isArray(list) ? list : []) {
    const key = entryKeyOf(entry);
    if (key !== null) held.set(key, entry);
  }
  return held;
}

/** One list with one list-patch applied: the rule in this file's head, under the key's own `rule`. */
function patchList(stored: unknown, listPatch: Record<string, unknown>, rule: EntryRule): unknown[] {
  const held = rule.forwardOnly ? entriesByKey(stored) : new Map<string, unknown>();
  const sent = Object.entries(listPatch).filter(([key, entry]) => !(rule.forwardOnly && storedIsLater(held.get(key), entry)));
  const named = new Set(sent.map(([key]) => key));
  const kept = (Array.isArray(stored) ? stored : []).filter((entry) => {
    const key = entryKeyOf(entry);
    return key !== null && !named.has(key) && isHeldEntry(entry, rule);
  });
  // An entry whose own key is not the key it was sent under is malformed and is not stored.
  const added = sent
    .filter(([key, entry]) => entry !== null && entryKeyOf(entry) === key && isHeldEntry(entry, rule))
    .map(([, entry]) => entry);
  return [...kept, ...added].slice(-ENTRY_LIST_CAP);
}

/** The document with `patch` applied. Lists the patch does not name, and every other key, are carried as they stand. `rule` is the key's own (`entryRuleOf`). */
export function applyEntryPatch(document: unknown, patch: PreferenceEntryPatch, rule: EntryRule = COMMON_RULE): EntryDocument {
  const next: EntryDocument = isRecord(document) ? { ...document } : {};
  for (const [list, listPatch] of Object.entries(patch)) {
    next[list] = patchList(next[list], listPatch, rule);
  }
  return next;
}

/**
 * What a device writes when its caller hands it the WHOLE document: the lists as entry patches against the copy this device
 * held (`previous`), each field that is not a list as itself when it differs, and nothing for what did not change. A list
 * the caller rebuilt from a copy older than the server's names only the entries it added and the entries it dropped, so an
 * entry another writer added since is neither asserted nor erased; `{}` when nothing differs. A field `next` lacks is
 * not named, so it stands. Used by `userSettings.ts` for a key whose callers keep the document whole (`claudePermissions`).
 */
export function entryDocumentDiff(previous: unknown, next: unknown): Record<string, unknown> {
  if (!isRecord(next)) return {};
  const before = isRecord(previous) ? previous : {};
  const diff: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(next)) {
    if (!Array.isArray(value)) {
      if (JSON.stringify(before[field]) !== JSON.stringify(value)) diff[field] = value;
      continue;
    }
    const had = new Set((Array.isArray(before[field]) ? before[field] : []).filter((entry): entry is string => typeof entry === 'string'));
    const has = new Set(value.filter((entry): entry is string => typeof entry === 'string'));
    const listPatch: Record<string, string | null> = {};
    for (const entry of has) if (!had.has(entry)) listPatch[entry] = entry;
    for (const entry of had) if (!has.has(entry)) listPatch[entry] = null;
    if (Object.keys(listPatch).length > 0) diff[field] = listPatch;
  }
  return diff;
}

/** The lists of a `entryDocumentDiff` result and only them: what the outbox keeps (a plain value is not an entry). */
export function entryListsOf(diff: Record<string, unknown>): PreferenceEntryPatch {
  return Object.fromEntries(Object.entries(diff).filter(([, value]) => isRecord(value))) as PreferenceEntryPatch;
}

/**
 * Two patches queued before a flush, as one: per entry, the newer (`incoming`) wins, and an entry it
 * names loses its earlier slot first. The fold has to apply as the two applied one after the other
 * (`patchList` drops a named entry before it appends it), so a key named twice sits where the NEWER
 * patch put it: pin A, pin B, pin A inside one flush is `…, B, A` on the server as on the page's mirror.
 */
export function foldEntryPatches(pending: unknown, incoming: unknown): unknown {
  if (!isRecord(pending) || !isRecord(incoming)) return incoming;
  const folded: Record<string, unknown> = { ...pending };
  for (const [list, listPatch] of Object.entries(incoming)) {
    const earlier = folded[list];
    folded[list] = isRecord(earlier) && isRecord(listPatch) ? laidOver(earlier, listPatch) : listPatch;
  }
  return folded;
}

/** `listPatch` laid over `earlier`, newest last: every key the newer names is taken out of the earlier first, so it is re-laid at its new place. */
function laidOver(earlier: Record<string, unknown>, listPatch: Record<string, unknown>): Record<string, unknown> {
  const renamed = new Set(Object.keys(listPatch));
  const kept = Object.entries(earlier).filter(([key]) => !renamed.has(key));
  return Object.fromEntries([...kept, ...Object.entries(listPatch)]);
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
  const refreshed: Record<string, unknown> = {};
  for (const [list, listPatch] of Object.entries(sent)) {
    if (!isRecord(listPatch)) {
      // A plain field riding beside the lists (`claudePermissions.skipPermissions`): the value the store holds now, and nothing if it holds none.
      if (document[list] !== undefined) refreshed[list] = document[list];
      continue;
    }
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
export function unreflectedEntries(document: unknown, patch: unknown, rule: EntryRule = COMMON_RULE): PreferenceEntryPatch | null {
  if (!isRecord(patch)) return null;
  const held = isRecord(document) ? document : {};
  const missing: PreferenceEntryPatch = {};
  for (const [list, listPatch] of Object.entries(patch)) {
    if (!isRecord(listPatch)) continue;
    const entries = entriesByKey(held[list]);
    const stored = new Map<string, string>([...entries].map(([key, entry]) => [key, JSON.stringify(entry)]));
    // A stamp the store already holds LATER is as good as stored: the server drops the older one, so it is never re-sent.
    const left = Object.entries(listPatch).filter(([key, entry]) => (entry === null
      ? stored.has(key)
      : !(rule.forwardOnly && storedIsLater(entries.get(key), entry)) && stored.get(key) !== JSON.stringify(entry)));
    if (left.length > 0) missing[list] = Object.fromEntries(left) as PreferenceEntryPatch[string];
  }
  return Object.keys(missing).length === 0 ? null : missing;
}

/** The outbox emptied: on sign-out, where every unconfirmed patch belongs to the user who left. */
export function clearEntryOutbox(): void {
  writeEntryOutbox({});
}
