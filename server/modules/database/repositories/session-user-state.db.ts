import type { Database } from 'better-sqlite3';

import { getConnection } from '@/modules/database/connection.js';

/**
 * The one written form of the unread rule: a run finished and the chat has not been on screen since.
 * Table-qualified, so one text serves both the page query's `LEFT JOIN` and a single-table `UPDATE ... WHERE`.
 * Consumed by `sessions.db.ts` and `sessionUserStateDb.markReadIfCompleted`.
 */
export const SESSION_UNREAD_SQL =
  'sessions.last_completed_at IS NOT NULL AND (sessions.last_read_at IS NULL OR sessions.last_read_at < sessions.last_completed_at)';

/**
 * The one written form of "the rank above every tagged row, never below now": a row written
 * with it lands first and always outranks the current maximum. Consumed by `sessions.db.ts`
 * (`createAppSession`) and `sessionUserStateDb.moveInSimpleList`.
 */
export const NEXT_TOP_SIMPLE_LIST_RANK_SQL =
  "MAX(julianday('now'), COALESCE((SELECT MAX(top_rank.simple_list_rank) FROM sessions AS top_rank WHERE top_rank.simple_list_at IS NOT NULL), 0) + 0.000001)";

/** The gap left between two neighbours when a row is spliced between them. */
const RANK_EPSILON = 0.000001;

/** One tagged simple-list row; the rank is NULL only for a row no rank was ever written for. */
type TaggedRankRow = { session_id: string; simple_list_rank: number | null };

/** Reads one tagged row's rank, or null when it does not exist or is not tagged. */
function getTaggedRankRow(db: Database, sessionId: string): TaggedRankRow | null {
  const row = db
    .prepare('SELECT session_id, simple_list_rank FROM sessions WHERE session_id = ? AND simple_list_at IS NOT NULL')
    .get(sessionId) as TaggedRankRow | undefined;

  return row ?? null;
}

/**
 * Rewrites every tagged row's rank from its current order, with the moving row spliced in
 * directly after `afterSessionId`. The collapse guard's fallback: once midpoint insertion runs
 * out of room between one pair of neighbours, renumbering restores a clean ladder instead of
 * rounding to a duplicate rank.
 */
function renumberSimpleList(db: Database, sessionId: string, afterSessionId: string): void {
  const rows = db
    .prepare(
      'SELECT session_id, simple_list_rank FROM sessions WHERE simple_list_at IS NOT NULL AND session_id <> ? ORDER BY simple_list_rank DESC, session_id DESC'
    )
    .all(sessionId) as TaggedRankRow[];

  const order = rows.map((row) => row.session_id);
  order.splice(order.indexOf(afterSessionId) + 1, 0, sessionId);

  const topRow = db
    .prepare('SELECT MAX(simple_list_rank) AS rank FROM sessions WHERE simple_list_at IS NOT NULL')
    .get() as { rank: number | null } | undefined;
  const top = topRow?.rank ?? 0;

  const updateRank = db.prepare('UPDATE sessions SET simple_list_rank = ? WHERE session_id = ?');
  order.forEach((id, index) => {
    updateRank.run(top - index * RANK_EPSILON, id);
  });
}

/**
 * Per-session state the sidebar reads and the run registry writes: the manual
 * simple-list order, the chosen icon, and the completion/read stamps. Callers
 * outside the database module reach it through the barrel.
 */
export const sessionUserStateDb = {
  /**
   * Stamps a finished run's session, and the read time in the same statement when the chat
   * was on screen while it finished. One statement, because SQLite gives every `'now'` in
   * it the same value — so a completion written with `alsoRead` cannot land unread by a
   * millisecond.
   */
  markRunCompleted(sessionId: string, alsoRead: boolean): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET last_completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           last_read_at = CASE WHEN ? = 1 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE last_read_at END
       WHERE session_id = ?`
    ).run(alsoRead ? 1 : 0, sessionId);
  },

  /**
   * Marks a session read, but only while it is unread: the guard is what keeps
   * a visible tab's 30 s presence heartbeat from writing, and broadcasting, on
   * every report. Returns whether a row changed, the caller's signal to
   * broadcast.
   */
  markReadIfCompleted(sessionId: string): boolean {
    const db = getConnection();
    const result = db
      .prepare(
        `UPDATE sessions
         SET last_read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE session_id = ? AND (${SESSION_UNREAD_SQL})`
      )
      .run(sessionId);

    return result.changes > 0;
  },

  /** Records a chat's chosen icon, or clears it back to the default. False when no such session exists. */
  setIcon(sessionId: string, icon: string | null): boolean {
    const db = getConnection();
    const result = db.prepare('UPDATE sessions SET icon = ? WHERE session_id = ?').run(icon, sessionId);

    return result.changes > 0;
  },

  /**
   * Moves one tagged session to the top of the simple list, or directly below another tagged
   * session. All of it in one transaction: the read of the neighbours decides the rank that
   * is then written, so a concurrent move would otherwise let two rows claim one slot.
   */
  moveInSimpleList(sessionId: string, afterSessionId: string | null): boolean {
    const db = getConnection();

    return db.transaction(() => {
      if (!getTaggedRankRow(db, sessionId)) {
        return false;
      }

      if (afterSessionId === null) {
        db.prepare(
          `UPDATE sessions SET simple_list_rank = ${NEXT_TOP_SIMPLE_LIST_RANK_SQL} WHERE session_id = ?`
        ).run(sessionId);
        return true;
      }

      // An unknown, untagged or self neighbour leaves nowhere to land: the
      // caller's 404, never a silent move to the top.
      if (afterSessionId === sessionId) return false;
      const afterRow = getTaggedRankRow(db, afterSessionId);
      if (!afterRow) return false;

      // Tagged but never ranked: renumbering the ladder is the repair.
      if (afterRow.simple_list_rank === null) {
        renumberSimpleList(db, sessionId, afterSessionId);
        return true;
      }

      const after = afterRow.simple_list_rank;
      // `below` is the next rank down. `tied` catches another row sharing the
      // target's rank: equal ranks leave no interval to land in, so that case
      // renumbers instead of halving a rank the neighbour already holds.
      const near = db
        .prepare(
          `SELECT MAX(CASE WHEN simple_list_rank < ? THEN simple_list_rank END) AS below,
                  MAX(CASE WHEN simple_list_rank = ? THEN 1 END) AS tied
           FROM sessions
           WHERE simple_list_at IS NOT NULL AND session_id <> ? AND session_id <> ?`
        )
        .get(after, after, sessionId, afterSessionId) as { below: number | null; tied: number | null };
      const below = near.below;

      // Halfway to the neighbour below when there is one, just under the row
      // above otherwise.
      const rank = below === null ? after - RANK_EPSILON : (after + below) / 2;
      if (near.tied !== null || rank >= after || (below !== null && rank <= below)) {
        renumberSimpleList(db, sessionId, afterSessionId);
        return true;
      }

      db.prepare('UPDATE sessions SET simple_list_rank = ? WHERE session_id = ?').run(rank, sessionId);
      return true;
    })();
  },
};
