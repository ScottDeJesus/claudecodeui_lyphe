import { getConnection } from '@/modules/database/connection.js';

/**
 * `followups`, as row-level statements — the followups lane's own table: one chat's next steps and
 * known gaps.
 *
 * Every read and write names the chat (`session_id`, the APP session id) or the account (`user_id`)
 * it acts for in its `WHERE` clause, so an id that belongs to another chat or account reads as no row
 * and no verb can touch an item its caller does not own. The ONE exception is the completion closer
 * (`listOpenNaming`, `closeForCompletion`): it is the house acting on every chat and every account at once,
 * and reaches a row by the words it carries and its id, never by an owner. The stamps are ISO-8601 UTC with
 * milliseconds, written in JS. A row leaves the table only with its chat (the foreign key's cascade,
 * `followups-schema.ts`) — nothing here deletes one — and moves with its chat when a duplicate row is
 * merged away (`moveToSession`).
 *
 * Consumers: `server/modules/followups/followups.service.ts` — the lane's only reader and writer; the
 * companion reads through the followups barrel's `listOpenFollowups` and `listOpenFollowupGroups`, never this file — and `sessions.db.ts`,
 * which calls `moveToSession` inside its merge transactions. Reach it through
 * `@/modules/database/index.js`. Every statement runs on the caller's connection; only `addMany`
 * opens a transaction of its own, so a batch lands whole or not at all.
 */

/** The two kinds of item a chat files. */
export type FollowupKind = 'next' | 'gap';

/** One `followups` row, exactly as the table stores it — `user_id` and `session_id` included, camelCase left to the service. */
export type FollowupRow = {
  id: number;
  session_id: string;
  user_id: number;
  kind: FollowupKind;
  text: string;
  state: 'open' | 'done';
  created_at: string;
  updated_at: string;
  done_at: string | null;
  closed_by: 'chat' | 'user' | null;
  closed_for: string | null;
};

/** Every column of an item, in one spelling: what a read returns and a write reads back. */
const FOLLOWUP_COLUMNS = 'id, session_id, user_id, kind, text, state, created_at, updated_at, done_at, closed_by, closed_for';

export const followupsDb = {
  /** Every item of one chat, oldest first (`id` is the order they were filed in). */
  listForChat(sessionId: string): FollowupRow[] {
    return getConnection()
      .prepare(`SELECT ${FOLLOWUP_COLUMNS} FROM followups WHERE session_id = ? ORDER BY id`)
      .all(sessionId) as FollowupRow[];
  },

  /** Every item of one chat that one account owns, oldest first — the widget's read. */
  listForChatOfUser(sessionId: string, userId: number): FollowupRow[] {
    return getConnection()
      .prepare(`SELECT ${FOLLOWUP_COLUMNS} FROM followups WHERE session_id = ? AND user_id = ? ORDER BY id`)
      .all(sessionId, userId) as FollowupRow[];
  },

  /**
   * The account's OPEN items across every chat, newest first (`id` is the order they were filed in), at most
   * `limit` of them — the companion's read, which names what a chat left for him. `limit` is a whole number of
   * 1 or more; the service holds it there.
   */
  listOpenOfUser(userId: number, limit: number): FollowupRow[] {
    return getConnection()
      .prepare(`SELECT ${FOLLOWUP_COLUMNS} FROM followups WHERE user_id = ? AND state = 'open' ORDER BY id DESC LIMIT ?`)
      .all(userId, limit) as FollowupRow[];
  },

  /**
   * The account's OPEN items grouped by chat, the chat with the newest item first: each chat's NEWEST open item (a whole row) beside how
   * many open items the chat holds. Counted in SQL over every open row of the account, so no ceiling cuts a group — the station's
   * read, which says how many a chat left for him.
   */
  listOpenGroupsOfUser(userId: number): Array<FollowupRow & { open_count: number }> {
    return getConnection()
      .prepare(
        `SELECT ${FOLLOWUP_COLUMNS}, g.open_count
         FROM followups
         JOIN (SELECT MAX(id) AS newest_id, COUNT(*) AS open_count FROM followups WHERE user_id = ? AND state = 'open' GROUP BY session_id) g
           ON g.newest_id = followups.id
         ORDER BY followups.id DESC`
      )
      .all(userId) as Array<FollowupRow & { open_count: number }>;
  },

  /** One item of the chat by id, or `null` when no item of THAT chat carries it. */
  getInChat(sessionId: string, id: number): FollowupRow | null {
    const row = getConnection()
      .prepare(`SELECT ${FOLLOWUP_COLUMNS} FROM followups WHERE id = ? AND session_id = ?`)
      .get(id, sessionId) as FollowupRow | undefined;

    return row ?? null;
  },

  /** One item of the account by id, or `null` when no item of that account carries it. */
  getOfUser(userId: number, id: number): FollowupRow | null {
    const row = getConnection()
      .prepare(`SELECT ${FOLLOWUP_COLUMNS} FROM followups WHERE id = ? AND user_id = ?`)
      .get(id, userId) as FollowupRow | undefined;

    return row ?? null;
  },

  /**
   * Inserts a batch of open items for one chat in ONE transaction and answers the rows as stored, in
   * the order given. `created_at === updated_at` on a fresh row.
   */
  addMany(input: { sessionId: string; userId: number; items: Array<{ kind: FollowupKind; text: string }> }): FollowupRow[] {
    const db = getConnection();
    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO followups (session_id, user_id, kind, text, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?)
       RETURNING ${FOLLOWUP_COLUMNS}`,
    );

    return db.transaction(() =>
      input.items.map((item) => {
        const row = insert.get(input.sessionId, input.userId, item.kind, item.text, now, now) as FollowupRow | undefined;
        if (!row) throw new Error(`Could not insert followup "${item.text}".`);
        return row;
      }),
    )();
  },

  /**
   * Settles items of one chat for the chat's own command. Only an OPEN item changes: a second close of the
   * same id leaves the first one's stamps. Answers the rows as stored after the write, in the ids' order.
   * An id of another chat matches no row, which the service has already judged.
   */
  closeInChat(sessionId: string, ids: number[]): FollowupRow[] {
    const db = getConnection();
    const now = new Date().toISOString();
    const close = db.prepare(
      `UPDATE followups SET state = 'done', done_at = ?, closed_by = 'chat', updated_at = ?
       WHERE id = ? AND session_id = ? AND state = 'open'`,
    );
    const read = db.prepare(`SELECT ${FOLLOWUP_COLUMNS} FROM followups WHERE id = ? AND session_id = ?`);

    return db.transaction(() =>
      ids.map((id) => {
        close.run(now, now, id, sessionId);
        return read.get(id, sessionId) as FollowupRow;
      }),
    )();
  },

  /**
   * Ticks (`done`) or unticks (`open`) one of the account's items for the person at the widget, and
   * answers the row as stored. Ticking an item that is already done changes nothing and keeps the
   * first close's stamps; unticking clears them. `null` when no item of that account carries the id.
   */
  setStateForUser(userId: number, id: number, state: 'open' | 'done'): FollowupRow | null {
    const db = getConnection();
    const now = new Date().toISOString();
    if (state === 'done') {
      db.prepare(
        `UPDATE followups SET state = 'done', done_at = ?, closed_by = 'user', updated_at = ?
         WHERE id = ? AND user_id = ? AND state = 'open'`,
      ).run(now, now, id, userId);
    } else {
      db.prepare(
        `UPDATE followups SET state = 'open', done_at = NULL, closed_by = NULL, closed_for = NULL, updated_at = ?
         WHERE id = ? AND user_id = ? AND state = 'done'`,
      ).run(now, id, userId);
    }

    return followupsDb.getOfUser(userId, id);
  },

  /**
   * The OPEN items of every chat and account whose text contains `name`, case-insensitively, oldest first. A wide
   * net on purpose: the followups service applies the exact rule (a whole slug token or a cue, a pointer at a task) to
   * what this returns. The completion closer's read, in `followups.service.ts` (`closeForCompletions`).
   */
  listOpenNaming(name: string): FollowupRow[] {
    return getConnection()
      .prepare(`SELECT ${FOLLOWUP_COLUMNS} FROM followups WHERE state = 'open' AND instr(lower(text), lower(?)) > 0 ORDER BY id`)
      .all(name) as FollowupRow[];
  },

  /**
   * Settles items because the feature, task or epic they named finished, and answers the rows it changed, as stored.
   * `doneAt` is the completion's own stamp (ISO-8601 UTC with milliseconds), `closedFor` the feature, `<feature>/<task key>`
   * or `epic:<epic>`.
   * Only an OPEN item changes, so a row a person or a chat settled between the read and this write keeps its stamps and
   * is left out of the answer. The completion closer's write, in `followups.service.ts` (`closeForCompletions`).
   */
  closeForCompletion(ids: number[], doneAt: string, closedFor: string): FollowupRow[] {
    const db = getConnection();
    const now = new Date().toISOString();
    const close = db.prepare(
      `UPDATE followups SET state = 'done', done_at = ?, closed_by = NULL, closed_for = ?, updated_at = ?
       WHERE id = ? AND state = 'open'
       RETURNING ${FOLLOWUP_COLUMNS}`,
    );

    return db.transaction(() =>
      ids.flatMap((id) => {
        const row = close.get(doneAt, closedFor, now, id) as FollowupRow | undefined;
        return row ? [row] : [];
      }),
    )();
  },

  /**
   * Moves every item of one chat onto another. `sessions.db.ts` calls it INSIDE the transaction that
   * merges a duplicate session row into the surviving one, BEFORE the duplicate row is deleted — the
   * cascade would otherwise take the items with the row it removes.
   */
  moveToSession(fromSessionId: string, toSessionId: string): void {
    getConnection().prepare('UPDATE followups SET session_id = ? WHERE session_id = ?').run(toSessionId, fromSessionId);
  },
};
