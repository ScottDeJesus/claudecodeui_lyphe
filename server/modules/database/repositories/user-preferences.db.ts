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

/**
 * The chat-gutter arrangement is the one preference whose value is a document with a section per
 * chat (`{ fallback, sessions: { <sessionId>: … }, order }`). Every other preference is one value
 * one client owns at a time, so replacing the stored value is right for them; here it is not — a
 * write computed on a desktop that has not heard about a chat arranged on a phone would delete that
 * chat's section. So the write unit is the SESSION: incoming sections win, stored sections the
 * writer never saw survive, and the arrangement a chat was given is only ever dropped by the cap.
 *
 * A writer that sends no `sessions` at all — an older build, which stored one arrangement for every
 * chat — updates the fallback and leaves every chat's own arrangement standing.
 */
const GUTTERS_KEY = 'chatGutters';
/** The most chats that keep an arrangement, newest write first. Mirrors the client's own cap. */
const GUTTERS_MAX_SESSIONS = 60;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const sessionsOf = (value: unknown): Record<string, unknown> =>
  isRecord(value) && isRecord(value.sessions) ? value.sessions : {};

const orderOf = (value: unknown): string[] =>
  isRecord(value) && Array.isArray(value.order)
    ? value.order.filter((id): id is string => typeof id === 'string')
    : [];

function mergeGutters(stored: unknown, incoming: unknown): unknown {
  if (!isRecord(incoming)) {
    return incoming;
  }

  const storedSessions = sessionsOf(stored);
  const incomingSessions = isRecord(incoming.sessions) ? incoming.sessions : null;
  if (!incomingSessions) {
    // Says nothing about any chat, so it only moves the fallback: either a fallback-only write from
    // this build, or an older build's flat record, which IS the arrangement it means.
    const fallback = isRecord(incoming.fallback) ? incoming.fallback : incoming;
    return Object.keys(storedSessions).length === 0 && fallback === incoming
      ? incoming
      : { fallback, sessions: storedSessions, order: orderOf(stored) };
  }

  const sessions: Record<string, unknown> = { ...storedSessions, ...incomingSessions };
  // Newest write last: what this writer just touched is the most recent, whatever the other client
  // knew. An id in neither order (a section written before orders were kept) drops first.
  const incomingOrder = orderOf(incoming);
  const ordered = [
    ...Object.keys(sessions).filter((id) => !incomingOrder.includes(id) && !orderOf(stored).includes(id)),
    ...orderOf(stored).filter((id) => !incomingOrder.includes(id) && id in sessions),
    ...incomingOrder.filter((id) => id in sessions),
  ];

  while (ordered.length > GUTTERS_MAX_SESSIONS) {
    const dropped = ordered.shift();
    if (dropped) delete sessions[dropped];
  }

  return { fallback: incoming.fallback ?? (isRecord(stored) ? stored.fallback : undefined), sessions, order: ordered };
}

/**
 * The memory of the Roadmap tab's In flight face (`dispatcher`) is the other document every open client writes: four ENTRY
 * LISTS, `hiddenPlans` (`{ name, at }` per hidden plan), `collapsedCards` (one fold key per folded
 * card), `cardOrder` (`{ name, rank }` per moved card) and `askDrafts` (one half-typed answer per open
 * ask). Replaced whole, it let any client write back the copy it read at sign-in and erase every hide
 * and fold made elsewhere since: on 2026-09-28 the operator's arc Hide (22:17:49) was undone 11 s later
 * by another of his clients folding the same arc. So the write unit is the ENTRY. A list sent as a
 * RECORD is an entry patch (`src/shared/preferenceEntryPatch.ts`, whose rule this mirrors):
 * `{ <entry key>: <entry> | null }` drops every entry it names, appends its non-null entries in its
 * own order (the newest last) and keeps the newest `ENTRY_LIST_CAP`, and every entry it does not name
 * stands. A list sent as an ARRAY is an older build's whole list, and replaces that list alone.
 *
 * `roadmapSeen` is the second document written this way: one `seen` list holding, per roadmap, the
 * completion this user last celebrated (`{ name, at }`). Phone and desktop each stamp it after a
 * celebration, and a whole-document write would let the device that read it last erase the other
 * roadmap's stamp and replay its completions.
 *
 * THE MERGE IS NOT MONOTONIC: the rule is "replace the named entry", so a stamp patch carrying an
 * OLDER `at` than the stored one moves the stamp backward, and the other device would play what it
 * had already played. Nothing here compares `at`, so the writer must never send a stamp older than the
 * one it read (`useCelebrations`); a merge that keeps the newer `at` per roadmap would need the same
 * rule on the client's `applyEntryPatch`, and is its own change to this shared merge.
 */
const ENTRY_LISTED_KEYS: ReadonlySet<string> = new Set(['dispatcher', 'roadmapSeen']);
/** The most entries one list keeps, newest last. Mirrors the client's own cap. */
const ENTRY_LIST_CAP = 200;

/** An entry's key: a bare string is its own key, a record's is its `name`. `null` for anything else. */
const entryKeyOf = (entry: unknown): string | null => {
  if (typeof entry === 'string') return entry;
  return isRecord(entry) && typeof entry.name === 'string' ? entry.name : null;
};

function patchEntryList(stored: unknown, listPatch: Record<string, unknown>): unknown[] {
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

function mergeEntryLists(stored: unknown, incoming: unknown): unknown {
  if (!isRecord(incoming)) {
    return incoming;
  }

  const merged: Record<string, unknown> = isRecord(stored) ? { ...stored } : {};
  for (const [list, value] of Object.entries(incoming)) {
    merged[list] = isRecord(value) ? patchEntryList(merged[list], value) : value;
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
   * `chatGutters` merges one level deeper, per chat, and `dispatcher` and `roadmapSeen` per entry of their lists — see
   * `mergeGutters` and `mergeEntryLists` above for why neither can be replaced wholesale.
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

        if (key === GUTTERS_KEY || ENTRY_LISTED_KEYS.has(key)) {
          const row = readOne.get(userId, key) as PreferenceRow | undefined;
          const stored = row ? decodePreference(row)?.[1] : undefined;
          const merged = key === GUTTERS_KEY ? mergeGutters(stored, value) : mergeEntryLists(stored, value);
          upsert.run(userId, key, JSON.stringify(merged));
          continue;
        }

        upsert.run(userId, key, JSON.stringify(value));
      }
    })();
  },
};
