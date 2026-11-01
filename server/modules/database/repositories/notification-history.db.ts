import { getConnection } from '@/modules/database/connection.js';

/**
 * `notification_history`, as row-level statements — what the house told one account, kept (the table's head,
 * `notification-history-schema.ts`, says what it keeps and why it hangs on `users`).
 *
 * This file speaks in ROWS: snake_case columns, exactly as stored. Every statement names the account it acts for, so an
 * account never reads another's history. The stamp is the ISO-8601 UTC string the caller writes (`toISOString()`, always the
 * same 24 characters), so comparing two stamps as text is comparing them in time. The history is bounded in one way:
 * `record` keeps EVERY row younger than `NOTIFICATION_HISTORY_WINDOW_MS` (seven days) and, past that age, the newest
 * `NOTIFICATION_HISTORY_KEEP` rows per account; it deletes the rest in the same transaction as the insert. A row goes only
 * when it is both older than the window and past the newest 300, so a busy day never costs the week its landings. An ask
 * raised AGAIN (`replaceRepeat`) is the same news, not new news: the row it repeats is removed in that same transaction and
 * the new one stands in its place, so a server restart that re-raises every ask still open leaves one row per ask.
 *
 * Consumers: `server/modules/notifications/services/notification-history.service.ts` — the lane's only writer and
 * reader. Reach it through `@/modules/database/index.js`. Every statement runs on the caller's connection; `record`
 * opens a transaction of its own, so the insert and the prune land whole or not at all.
 */

/**
 * How long a kept row is never pruned: seven days, the week the station's strip "since you last looked" promises. Defined here, in
 * the layer that prunes, and reached through the notifications barrel by the one other reader of the week. Consumed by this
 * repository's `record` (the prune's cut) and by `station-landed.ts`, which reads the history over this window (`stationLanded`).
 */
export const NOTIFICATION_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How many of an account's newest rows are kept whatever their age: `record` deletes a row only when it is older than the window
 * AND past this many. It is also the most `list` answers, the newest-N read of `list_alerts`.
 */
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
   * Inserts one row for the account, then prunes — both in one transaction. The prune finds the 301st-newest id through the
   * `(user_id, id)` index and deletes it and everything older THAT IS ALSO OLDER THAN THE WINDOW, in one statement: a row younger
   * than seven days is never deleted, and past that age the newest 300 stay. With fewer than 301 rows the subselect is NULL and
   * nothing is deleted. With `replaceRepeat`, the account's rows of the same code, chat, plan, title and body are deleted first
   * (a missing chat or plan matches a missing one, `IS`), so the row inserted is the only one of its news and carries the time it
   * was last told. Answers the id of the row inserted, so the caller can hand the row on as stored (`onHistoryKept`).
   */
  record(userId: number, row: NotificationHistoryInput, options: { replaceRepeat?: boolean } = {}): number {
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
         AND at < ?
         AND id <= (SELECT id FROM notification_history WHERE user_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`
    );
    return db.transaction((): number => {
      if (options.replaceRepeat === true) removeRepeat.run(userId, row.code, row.title, row.body, row.session_id, row.plan);
      const { lastInsertRowid } = insert.run(userId, row.at, row.code, row.kind, row.severity, row.title, row.body, row.session_id, row.plan);
      const windowStart = new Date(Date.now() - NOTIFICATION_HISTORY_WINDOW_MS).toISOString();
      prune.run(userId, windowStart, userId, NOTIFICATION_HISTORY_KEEP);
      return Number(lastInsertRowid);
    })();
  },

  /**
   * The account's newest `limit` rows, newest first. `limit` is bound, never interpolated, and held to 1 through 300 (the newest
   * an account always keeps): a number that is not finite (`NaN`, `Infinity`) asks for 300, since the driver refuses to bind it.
   * Consumed through the notifications module by `list_alerts`, which wants the latest and no more.
   */
  list(userId: number, limit: number): NotificationHistoryRow[] {
    const bounded = Number.isFinite(limit) ? Math.min(NOTIFICATION_HISTORY_KEEP, Math.max(1, Math.trunc(limit))) : NOTIFICATION_HISTORY_KEEP;
    return getConnection()
      .prepare(`SELECT ${HISTORY_COLUMNS} FROM notification_history WHERE user_id = ? ORDER BY id DESC LIMIT ?`)
      .all(userId, bounded) as NotificationHistoryRow[];
  },

  /**
   * EVERY row of the account at or after `sinceIso` (an ISO-8601 UTC stamp, compared as text), newest first — no row cap, because
   * the history itself keeps every row of the last seven days whole (`record`). Consumed through the notifications module by
   * `stationLanded`, which reads the strip's week from it.
   */
  listSince(userId: number, sinceIso: string): NotificationHistoryRow[] {
    return getConnection()
      .prepare(`SELECT ${HISTORY_COLUMNS} FROM notification_history WHERE user_id = ? AND at >= ? ORDER BY id DESC`)
      .all(userId, sinceIso) as NotificationHistoryRow[];
  },
};
