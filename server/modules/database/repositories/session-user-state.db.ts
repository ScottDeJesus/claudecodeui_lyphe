import { getConnection } from '@/modules/database/connection.js';

/**
 * The one written form of the unread rule: a run finished and the chat has not been on screen since.
 * Table-qualified, so one text serves both the page query's `LEFT JOIN` and a single-table `UPDATE ... WHERE`.
 * Consumed by `sessions.db.ts` and `sessionUserStateDb.markReadIfCompleted`.
 */
export const SESSION_UNREAD_SQL =
  'sessions.last_completed_at IS NOT NULL AND (sessions.last_read_at IS NULL OR sessions.last_read_at < sessions.last_completed_at)';

/**
 * Per-session state the sidebar reads and the run registry writes: the chosen
 * icon and the completion/read stamps. Callers outside the database module
 * reach it through the barrel.
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
};
