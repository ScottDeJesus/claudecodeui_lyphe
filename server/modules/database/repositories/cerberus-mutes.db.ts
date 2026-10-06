import { getCerberusConnection } from '@/modules/database/cerberus-connection.js';

/**
 * `mutes`, as row-level statements — who silenced which check, until when, in the Cerberus store.
 *
 * A mute is Cerberus-side only: the warden never hears of it, so a muted check keeps running and
 * recording. Rows are appended and never deleted; the only update is `lifted_at`, set once when a
 * person unmutes. A mute is IN EFFECT from `from_at` until the earlier of `until_at` and
 * `lifted_at` — an expired mute simply stops matching, nothing writes it down.
 *
 * Rows are exactly as the table stores them: snake_case, times in epoch milliseconds.
 *
 * Consumers: `server/modules/cerberus/` — the mutes service (`insert`, `get`, `lift`) behind
 * `POST /mutes`, the read model (`activeAt` for a check's current mute, `overlapping` for the cells
 * and a lookup's "a mute active then is named", `recent` for What happened). Reach it through
 * `@/modules/database/index.js`. Every statement runs on the caller's connection and opens no
 * transaction of its own.
 */

/** One `mutes` row, exactly as the table stores it. */
export type CerberusMuteRow = {
  id: string;
  node: string;
  check_key: string;
  from_at: number;
  until_at: number;
  reason: string;
  /** Who muted it. */
  by: string;
  /** NULL until a person lifts the mute; the moment they did. */
  lifted_at: number | null;
};

// `by` is a keyword; SQLite tolerates it as a column name, and quoting keeps every statement
// that names it unambiguous.
const MUTE_COLUMNS = 'id, node, check_key, from_at, until_at, reason, "by", lifted_at';

/** When a mute stopped being in effect: its expiry, or the moment it was lifted if that came first. */
const EFFECTIVE_END_SQL = 'MIN(until_at, COALESCE(lifted_at, until_at))';

export const cerberusMutesDb = {
  /** Appends a mute. Throws on a duplicate id. */
  insert(mute: CerberusMuteRow): void {
    getCerberusConnection()
      .prepare(
        `INSERT INTO mutes (${MUTE_COLUMNS})
         VALUES (@id, @node, @check_key, @from_at, @until_at, @reason, @by, @lifted_at)`
      )
      .run(mute);
  },

  /** One mute, or `null` when none carries the id. */
  get(id: string): CerberusMuteRow | null {
    const row = getCerberusConnection()
      .prepare(`SELECT ${MUTE_COLUMNS} FROM mutes WHERE id = ?`)
      .get(id) as CerberusMuteRow | undefined;
    return row ?? null;
  },

  /**
   * Lifts a mute at `at`: sets `lifted_at` once, and only while the mute is still in effect — one
   * already lifted or already expired is left as it was, so the record never says "lifted" of a
   * mute that had simply run out. Answers whether this call lifted it.
   */
  lift(id: string, at: number): boolean {
    const result = getCerberusConnection()
      .prepare('UPDATE mutes SET lifted_at = ? WHERE id = ? AND lifted_at IS NULL AND until_at > ?')
      .run(at, id, at);
    return result.changes > 0;
  },

  /**
   * The mute in effect for a check at moment `at` — `from_at <= at < until_at`, not lifted by then —
   * or `null`. When several overlap, the one that began last.
   */
  activeAt(node: string, key: string, at: number): CerberusMuteRow | null {
    const row = getCerberusConnection()
      .prepare(
        `SELECT ${MUTE_COLUMNS} FROM mutes
          WHERE node = @node AND check_key = @key
            AND from_at <= @at AND until_at > @at AND (lifted_at IS NULL OR lifted_at > @at)
          ORDER BY from_at DESC, id LIMIT 1`
      )
      .get({ node, key, at }) as CerberusMuteRow | undefined;
    return row ?? null;
  },

  /**
   * Every mute of a check in effect at some moment of `[from, to)`, oldest first. A mute lifted
   * before it began, or at the very moment it began, covers nothing and is not returned.
   */
  overlapping(node: string, key: string, from: number, to: number): CerberusMuteRow[] {
    return getCerberusConnection()
      .prepare(
        `SELECT ${MUTE_COLUMNS} FROM mutes
          WHERE node = @node AND check_key = @key
            AND until_at > @from AND from_at < @to
            AND ${EFFECTIVE_END_SQL} > @from AND ${EFFECTIVE_END_SQL} > from_at
          ORDER BY from_at, id`
      )
      .all({ node, key, from, to }) as CerberusMuteRow[];
  },

  /**
   * The mutes that began before `before`, newest activity first, at most `limit` — what the activity
   * feed turns into "muted", "lifted" and "expired" events. A mute is ranked by the newest of its
   * own moments that falls before `before`: its lift or expiry when that is already behind `before`,
   * else its start. The service keeps the events that have actually happened. `limit` is clamped to
   * a whole number of at least 0 — SQLite reads `LIMIT -1` as "no limit", and a negative must not
   * dump the table.
   */
  recent(before: number, limit: number): CerberusMuteRow[] {
    return getCerberusConnection()
      .prepare(
        `SELECT ${MUTE_COLUMNS} FROM mutes
          WHERE from_at < @before
          ORDER BY CASE WHEN COALESCE(lifted_at, until_at) < @before
                        THEN COALESCE(lifted_at, until_at) ELSE from_at END DESC, id
          LIMIT @limit`
      )
      .all({ before, limit: Math.max(0, Math.trunc(limit)) }) as CerberusMuteRow[];
  },
};
