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
   * `chatGutters` merges one level deeper, per chat — see `mergeGutters` above for why that key
   * cannot be replaced wholesale.
   *
   * Runs in one transaction so a multi-key save from the settings dialog can
   * never be observed half-applied. The gutter read-modify-write happens INSIDE it, so two saves
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

        if (key === GUTTERS_KEY) {
          const row = readOne.get(userId, key) as PreferenceRow | undefined;
          const stored = row ? decodePreference(row)?.[1] : undefined;
          upsert.run(userId, key, JSON.stringify(mergeGutters(stored, value)));
          continue;
        }

        upsert.run(userId, key, JSON.stringify(value));
      }
    })();
  },
};
