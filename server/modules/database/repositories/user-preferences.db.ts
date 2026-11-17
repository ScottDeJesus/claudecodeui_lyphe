import { getConnection } from '@/modules/database/connection.js';

type PreferenceRow = {
  preference_key: string;
  preference_value: string;
};

/**
 * Decodes one stored preference, dropping any row whose JSON no longer parses
 * rather than failing the whole read. A single corrupted value must not cost
 * the user every other setting they have.
 */
function decodePreference(row: PreferenceRow): [string, unknown] | null {
  try {
    return [row.preference_key, JSON.parse(row.preference_value) as unknown];
  } catch {
    console.warn(`[UserPreferences] Dropping unreadable value for "${row.preference_key}"`);
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The memory of the Roadmap tab's In flight face (`dispatcher`) is a document every open client writes: four ENTRY
 * LISTS, `hiddenPlans` (`{ name, at }` per hidden plan), `collapsedCards` (one fold key per folded
 * card), `cardOrder` (`{ name, rank }` per moved card) and `askDrafts` (one half-typed answer per open
 * ask). Replaced whole, it let any client write back the copy it read at sign-in and erase every hide
 * and fold made elsewhere since: on 2026-09-28 the operator's arc Hide (22:17:49) was undone 11 s later
 * by another of his clients folding the same arc. So the write unit is the ENTRY. A list sent as a
 * RECORD is an entry patch (`src/shared/preferenceEntryPatch.ts`, whose rule this mirrors):
 * `{ <entry key>: <entry> | null }` drops every entry it names, appends its non-null entries in its
 * own order (the newest last) and keeps the newest `ENTRY_LIST_CAP`, and every entry it does not name
 * stands. A list sent as an ARRAY is an older build's whole list, and replaces that list alone (under a
 * string-only key, `STRING_ONLY_KEYS` below, with its string entries only).
 *
 * `roadmapSeen` is the second document written this way: one `seen` list holding, per roadmap, the
 * completion this user last celebrated (`{ name, at }`). Phone and desktop each stamp it after a
 * celebration, and a whole-document write would let the device that read it last erase the other
 * roadmap's stamp and replay its completions.
 *
 * `filesPins` is the third: one `pinned` list holding the folders pinned on the Files tab's strip, each a
 * bare string — the folder's absolute path, which is its own entry key (`entryKeyOf`). So
 * `{ pinned: { [path]: path } }` adds a pin, `{ pinned: { [path]: null } }` removes it, and neither
 * touches another pin. It is not forward-only: a pin carries no stamp to rewind. It is STRING-ONLY
 * (`STRING_ONLY_KEYS`): an entry that is not a string is not stored, and one already stored is dropped
 * by the next patch to its list, so `pinned` never holds a non-string entry, however it is sent. The client's `applyEntryPatch`
 * keeps the same rule (`STRING_ONLY_ENTRY_KEYS`).
 *
 * `claudePermissions` is the fourth: its `allowedTools` and `disallowedTools` are lists of rule strings (each its own entry key)
 * that two kinds of writer change, a page (the chat's "always", the Settings autosave) and the server (her "always" receipt,
 * `rememberAllowedTool`), and the page wrote its whole copy back: a page open since before her receipt erased the entry
 * she had remembered. The page now sends the difference from the copy it held (`{ allowedTools: { [rule]: rule } }` adds,
 * `{ [rule]: null }` removes), and its other fields (`skipPermissions`, `permissionMode`) ride beside the lists as plain values,
 * which replace as before. The server's own receipt still sends whole lists, which replace their list alone.
 *
 * A STAMP LIST MOVES FORWARD ONLY (`FORWARD_ONLY_KEYS`). The rule is "replace the named entry", except
 * that a `roadmapSeen` patch carrying an OLDER `at` than the stored entry is a stale device's retry and
 * is not applied: it would move the stamp backward, and the other device would play what it had already
 * played. The client's `applyEntryPatch` keeps the same rule (`FORWARD_ONLY_ENTRY_KEYS`), and the writer
 * still never sends a stamp older than the one it read (`useCelebrations`).
 */
const ENTRY_LISTED_KEYS: ReadonlySet<string> = new Set(['dispatcher', 'roadmapSeen', 'filesPins', 'claudePermissions']);
/** The keys whose entries carry an `at` that only moves forward. Mirrors the client's `FORWARD_ONLY_ENTRY_KEYS`. */
const FORWARD_ONLY_KEYS: ReadonlySet<string> = new Set(['roadmapSeen']);
/** The keys whose lists hold bare strings only, each its own entry key. Mirrors the client's `STRING_ONLY_ENTRY_KEYS`. */
const STRING_ONLY_KEYS: ReadonlySet<string> = new Set(['filesPins', 'claudePermissions']);

/** What one key's lists hold beyond the common rule. Mirrors the client's `EntryRule`. */
type EntryRule = { forwardOnly: boolean; stringOnly: boolean };

const entryRuleOf = (key: string): EntryRule => ({
  forwardOnly: FORWARD_ONLY_KEYS.has(key),
  stringOnly: STRING_ONLY_KEYS.has(key),
});

/** Whether the list the rule governs may hold this entry. */
const isHeldEntry = (entry: unknown, rule: EntryRule): boolean => !rule.stringOnly || typeof entry === 'string';

/** The most entries one list keeps, newest last. Mirrors the client's own cap. */
const ENTRY_LIST_CAP = 200;

/** An entry's key: a bare string is its own key, a record's is its `name`. `null` for anything else. */
const entryKeyOf = (entry: unknown): string | null => {
  if (typeof entry === 'string') return entry;
  return isRecord(entry) && typeof entry.name === 'string' ? entry.name : null;
};

/** Whether the stored entry carries a later `at` than the one a patch sends under its key: the stamp that must not be rewound. */
function storedIsLater(stored: unknown, sent: unknown): boolean {
  if (!isRecord(stored) || !isRecord(sent)) return false;
  const held = Date.parse(String(stored.at));
  const offered = Date.parse(String(sent.at));
  return !Number.isNaN(held) && !Number.isNaN(offered) && held > offered;
}

function patchEntryList(stored: unknown, listPatch: Record<string, unknown>, rule: EntryRule): unknown[] {
  const held = new Map<string, unknown>();
  if (rule.forwardOnly) {
    for (const entry of Array.isArray(stored) ? stored : []) {
      const key = entryKeyOf(entry);
      if (key !== null) held.set(key, entry);
    }
  }
  // Under a forward-only key an entry older than the stored one is a stale retry: it names nothing and adds nothing.
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

/** A list sent whole (an older build's write) replaces the stored one; under a string-only key it keeps its string entries. */
const wholeList = (value: unknown, rule: EntryRule): unknown => (
  rule.stringOnly && Array.isArray(value) ? value.filter((entry) => isHeldEntry(entry, rule)) : value
);

function mergeEntryLists(stored: unknown, incoming: unknown, rule: EntryRule): unknown {
  if (!isRecord(incoming)) {
    return incoming;
  }

  const merged: Record<string, unknown> = isRecord(stored) ? { ...stored } : {};
  for (const [list, value] of Object.entries(incoming)) {
    merged[list] = isRecord(value) ? patchEntryList(merged[list], value, rule) : wholeList(value, rule);
  }
  return merged;
}

export const userPreferencesDb = {
  /**
   * Returns every preference the user has ever set, as one object.
   *
   * The client fetches this once on start-up, so absent keys simply mean "the
   * user never changed this" and the client applies its own default.
   */
  getPreferences(userId: number): Record<string, unknown> {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT preference_key, preference_value
         FROM user_preferences
         WHERE user_id = ?`
      )
      .all(userId) as PreferenceRow[];

    const preferences: Record<string, unknown> = {};
    for (const row of rows) {
      const decoded = decodePreference(row);
      if (decoded) {
        preferences[decoded[0]] = decoded[1];
      }
    }

    return preferences;
  },

  /**
   * Merge-patches preferences: keys present in `updates` are written, keys
   * absent are left alone, and a key given as `undefined` is deleted.
   *
   * `dispatcher`, `roadmapSeen`, `filesPins` and `claudePermissions` merge one level deeper, per entry of their lists — see
   * `mergeEntryLists` above for why they cannot be replaced wholesale.
   *
   * Runs in one transaction so a multi-key save from the settings dialog can
   * never be observed half-applied. Both read-modify-writes happen INSIDE it, so two saves
   * cannot both compute their merge from the same stored value.
   */
  savePreferences(userId: number, updates: Record<string, unknown>): void {
    const db = getConnection();
    const upsert = db.prepare(
      `INSERT INTO user_preferences (user_id, preference_key, preference_value, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, preference_key) DO UPDATE SET
         preference_value = excluded.preference_value,
         updated_at = CURRENT_TIMESTAMP`
    );
    const remove = db.prepare(
      'DELETE FROM user_preferences WHERE user_id = ? AND preference_key = ?'
    );
    const readOne = db.prepare(
      'SELECT preference_key, preference_value FROM user_preferences WHERE user_id = ? AND preference_key = ?'
    );

    db.transaction(() => {
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) {
          remove.run(userId, key);
          continue;
        }

        if (ENTRY_LISTED_KEYS.has(key)) {
          const row = readOne.get(userId, key) as PreferenceRow | undefined;
          const stored = row ? decodePreference(row)?.[1] : undefined;
          const merged = mergeEntryLists(stored, value, entryRuleOf(key));
          upsert.run(userId, key, JSON.stringify(merged));
          continue;
        }

        upsert.run(userId, key, JSON.stringify(value));
      }
    })();
  },
};
