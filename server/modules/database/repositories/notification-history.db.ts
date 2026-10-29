import { getConnection } from '@/modules/database/connection.js';

/**
 * `notification_history`, as row-level statements — what the house told one account, kept (the table's head,
 * `notification-history-schema.ts`, says what it keeps and why it hangs on `users`).
 *
 * This file speaks in ROWS: snake_case columns, exactly as stored. Every statement names the account it acts for, so an
 * account never reads another's history. The stamp is the ISO-8601 UTC string the caller writes. The history is bounded:
 * `record` keeps the newest `NOTIFICATION_HISTORY_KEEP` rows per account and deletes the rest in the same transaction as
 * the insert, so the table never holds more than that for one account. An ask raised AGAIN (`replaceRepeat`) is the same
 * news, not new news: the row it repeats is removed in that same transaction and the new one stands in its place, so a
 * server restart that re-raises every ask still open leaves one row per ask and spends none of the 300 on repeats.
 *
 * Consumers: `server/modules/notifications/services/notification-history.service.ts` — the lane's only writer and
 * reader. Reach it through `@/modules/database/index.js`. Every statement runs on the caller's connection; `record`
 * opens a transaction of its own, so the insert and the prune land whole or not at all.
 */

/** How many rows an account keeps; `record` prunes everything older than the newest this many. */
const NOTIFICATION_HISTORY_KEEP = 300;

/** One `notification_history` row, exactly as the table stores it. */
export type NotificationHistoryRow = {
  id: number;
  user_id: number;
  at: string;
  code: string;
  kind: string | null;
  severity: string | null;
  title: string;
  body: string;
  session_id: string | null;
  plan: string | null;
};

/** What `record` takes: a row without its id and account. */
export type NotificationHistoryInput = Omit<NotificationHistoryRow, 'id' | 'user_id'>;

/** Every column of a history row, in one spelling: what a read returns. */
const HISTORY_COLUMNS = 'id, user_id, at, code, kind, severity, title, body, session_id, plan';

export const notificationHistoryDb = {
  /**
   * Inserts one row for the account, then prunes it past its newest 300 — both in one transaction. The prune finds the
   * 301st-newest id through the `(user_id, id)` index and deletes it and everything older, so it never scans the table.
   * With `replaceRepeat`, the account's rows of the same code, chat, plan, title and body are deleted first (a missing chat
   * or plan matches a missing one, `IS`), so the row inserted is the only one of its news and carries the time it was last told.
   */
  record(userId: number, row: NotificationHistoryInput, options: { replaceRepeat?: boolean } = {}): void {
    const db = getConnection();
    const removeRepeat = db.prepare(
      `DELETE FROM notification_history
       WHERE user_id = ? AND code = ? AND title = ? AND body = ? AND session_id IS ? AND plan IS ?`
    );
    const insert = db.prepare(
      `INSERT INTO notification_history (user_id, at, code, kind, severity, title, body, session_id, plan)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const prune = db.prepare(
      `DELETE FROM notification_history
       WHERE user_id = ?
         AND id <= (SELECT id FROM notification_history WHERE user_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`
    );
    db.transaction(() => {
      if (options.replaceRepeat === true) removeRepeat.run(userId, row.code, row.title, row.body, row.session_id, row.plan);
      insert.run(userId, row.at, row.code, row.kind, row.severity, row.title, row.body, row.session_id, row.plan);
      prune.run(userId, userId, NOTIFICATION_HISTORY_KEEP);
    })();
  },

  /**
   * The account's newest `limit` rows, newest first. `limit` is bound, never interpolated, and held to 1 through 300 (all an
   * account keeps): a number that is not finite (`NaN`, `Infinity`) asks for everything kept, since the driver refuses to bind it.
   */
  list(userId: number, limit: number): NotificationHistoryRow[] {
    const bounded = Number.isFinite(limit) ? Math.min(NOTIFICATION_HISTORY_KEEP, Math.max(1, Math.trunc(limit))) : NOTIFICATION_HISTORY_KEEP;
    return getConnection()
      .prepare(`SELECT ${HISTORY_COLUMNS} FROM notification_history WHERE user_id = ? ORDER BY id DESC LIMIT ?`)
      .all(userId, bounded) as NotificationHistoryRow[];
  },
};
