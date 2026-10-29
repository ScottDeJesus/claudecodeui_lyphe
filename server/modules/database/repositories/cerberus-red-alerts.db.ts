import { getCerberusConnection } from '@/modules/database/cerberus-connection.js';

/**
 * `cerberus_red_alerts`, as row-level statements — the red watch's memory of which checks it has already
 * woken the operator about, in the Cerberus store.
 *
 * One row is one INCIDENT of one check: opened when the watcher first pages it, closed when the check is
 * `ok` again (`'ok'`), is muted (`'mute'`) or is no longer in the fleet's sight (`'gone'`). A closed row is
 * kept — it is the record that a re-open must wait out (`lastClosed`) — and a check has at most one OPEN row
 * (the partial unique index of migration step 5), so two server processes overlapping at a handover cannot
 * both page the same incident: the second `open` changes nothing and says so.
 *
 * Rows are exactly as the table stores them: snake_case, times in epoch milliseconds (a verb refuses a clock that
 * is not a whole number of them, as its sibling repositories do). `notified_at` is the
 * last push that carried the incident as a new red, `last_reminder_at` the last "still red" push; the
 * reminder cadence counts from the later of the two.
 *
 * Consumers: `server/modules/cerberus/red-watch.service.ts`. Reach it through `@/modules/database/index.js`.
 * Every statement runs on the caller's connection and opens no transaction of its own.
 */

/** Why an incident ended: the check recovered, was muted, or left the fleet's sight (or its node's). */
export type CerberusRedAlertClosedBy = 'ok' | 'mute' | 'gone';

/** One `cerberus_red_alerts` row, exactly as the table stores it. */
export type CerberusRedAlertRow = {
  id: number;
  node: string;
  key: string;
  opened_at: number;
  /** When the check's red began, on center's clock — an hour or more before `opened_at`, which is when the watcher paged. */
  red_since: number;
  notified_at: number;
  /** NULL until the first reminder. */
  last_reminder_at: number | null;
  /** NULL while the incident is open. */
  closed_at: number | null;
  closed_by: CerberusRedAlertClosedBy | null;
};

// `key` is a keyword SQLite tolerates as a column name; quoting keeps every statement that names it unambiguous.
const RED_ALERT_COLUMNS =
  'id, node, "key", opened_at, red_since, notified_at, last_reminder_at, closed_at, closed_by';

/** A time column takes epoch milliseconds only: SQLite's INTEGER affinity would keep text as text, which sorts above every number, and a NaN as NULL. */
function assertEpochMs(what: string, value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what} must be a whole number of epoch milliseconds, got ${JSON.stringify(value)}.`);
  }
}

export const cerberusRedAlertsDb = {
  /**
   * Opens an incident for a check at `at`, notified at `at`, whose red began at `redSince`. Answers the new
   * row, or `null` when the check already has an open one (another process opened it first) — the caller
   * then pages nothing.
   */
  open(node: string, key: string, at: number, redSince: number): CerberusRedAlertRow | null {
    assertEpochMs('at', at);
    assertEpochMs('redSince', redSince);
    const db = getCerberusConnection();
    // No conflict target on purpose: the only uniqueness in the table is the open-incident index, and a
    // NOT NULL or CHECK violation must throw, never read as "already open".
    const result = db
      .prepare(
        `INSERT INTO cerberus_red_alerts (node, "key", opened_at, red_since, notified_at)
         VALUES (@node, @key, @at, @redSince, @at)
         ON CONFLICT DO NOTHING`
      )
      .run({ node, key, at, redSince });
    if (result.changes === 0) return null;
    return db
      .prepare(`SELECT ${RED_ALERT_COLUMNS} FROM cerberus_red_alerts WHERE id = ?`)
      .get(result.lastInsertRowid) as CerberusRedAlertRow;
  },

  /** Every open incident, oldest first. */
  listOpen(): CerberusRedAlertRow[] {
    return getCerberusConnection()
      .prepare(`SELECT ${RED_ALERT_COLUMNS} FROM cerberus_red_alerts WHERE closed_at IS NULL ORDER BY opened_at, id`)
      .all() as CerberusRedAlertRow[];
  },

  /** The newest incident of a check that has ended, or `null` — what a re-open is judged against. */
  lastClosed(node: string, key: string): CerberusRedAlertRow | null {
    const row = getCerberusConnection()
      .prepare(
        `SELECT ${RED_ALERT_COLUMNS} FROM cerberus_red_alerts
          WHERE node = @node AND "key" = @key AND closed_at IS NOT NULL
          ORDER BY closed_at DESC, id DESC LIMIT 1`
      )
      .get({ node, key }) as CerberusRedAlertRow | undefined;
    return row ?? null;
  },

  /** Stamps that the incident was carried as a new red at `at`. */
  markNotified(id: number, at: number): void {
    assertEpochMs('at', at);
    getCerberusConnection().prepare('UPDATE cerberus_red_alerts SET notified_at = ? WHERE id = ?').run(at, id);
  },

  /** Stamps that a "still red" reminder was sent for the incident at `at`. */
  markReminded(id: number, at: number): void {
    assertEpochMs('at', at);
    getCerberusConnection().prepare('UPDATE cerberus_red_alerts SET last_reminder_at = ? WHERE id = ?').run(at, id);
  },

  /** Ends an incident at `at`, once: an incident already closed is left as it was. Answers whether this call closed it. */
  close(id: number, by: CerberusRedAlertClosedBy, at: number): boolean {
    assertEpochMs('at', at);
    const result = getCerberusConnection()
      .prepare('UPDATE cerberus_red_alerts SET closed_at = ?, closed_by = ? WHERE id = ? AND closed_at IS NULL')
      .run(at, by, id);
    return result.changes > 0;
  },
};
