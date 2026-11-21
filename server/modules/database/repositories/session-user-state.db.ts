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
 * icon, the pin and the completion/read stamps. Callers outside the database module
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

  /** Pins or unpins a chat. False when no such session exists. Consumed by `sessionUserStateService.setPinnedById` and, through it, Kaylee's `pin_session`. */
  setPinned(sessionId: string, pinned: boolean): boolean {
    const db = getConnection();
    const result = db.prepare('UPDATE sessions SET pinned = ? WHERE session_id = ?').run(pinned ? 1 : 0, sessionId);

    return result.changes > 0;
  },

  /**
   * The tool sets a chat has switched on, or null when it never switched one (the column is NULL).
   * A value that is not a JSON array of strings reads null as well, with one warning naming the
   * session: a hand-edited cell must cost a chat its sets, never its launch. Consumed by the
   * toolsets module, which reads it at every launch and every switch.
   */
  getToolsets(sessionId: string): string[] | null {
    const db = getConnection();
    const row = db.prepare('SELECT toolsets FROM sessions WHERE session_id = ?').get(sessionId) as
      | { toolsets: string | null }
      | undefined;
    if (!row || row.toolsets === null) return null;

    try {
      const parsed: unknown = JSON.parse(row.toolsets);
      if (Array.isArray(parsed) && parsed.every((name) => typeof name === 'string')) return parsed;
    } catch {
      // Falls through to the one warning below, which says the same thing as a parse error would.
    }
    console.warn(`[sessions] session ${sessionId} has an unreadable toolsets value; reading it as never switched`);
    return null;
  },

  /**
   * Records a chat's on-sets: the sorted, de-duplicated list as a JSON array. An empty list is
   * written `[]` and never goes back to NULL, because "switched a set on and off" and "never
   * switched" are different facts to the next launch. False when no row has the id. Consumed by the
   * toolsets module's switch.
   */
  setToolsets(sessionId: string, names: string[]): boolean {
    const db = getConnection();
    const value = JSON.stringify([...new Set(names)].sort());
    const result = db.prepare('UPDATE sessions SET toolsets = ? WHERE session_id = ?').run(value, sessionId);

    return result.changes > 0;
  },

  /**
   * Whether a chat was started in Code Mode. true or false once its first launch stored a word. A chat
   * with no word that already holds a conversation (its row carries the CLI's session id or transcript
   * path — written once a run announces them) was started before its mode was decided, without Code Mode,
   * so it reads false: a conversation never changes mode halfway through. null only for a chat with no
   * word and no conversation yet — its first launch — or no row. A value other than 0 or 1 is read as
   * no word, with one warning naming the session. Consumed by the code-mode module at every launch.
   */
  getCodeMode(sessionId: string): boolean | null {
    const db = getConnection();
    const row = db
      .prepare(
        'SELECT code_mode, (provider_session_id IS NOT NULL OR jsonl_path IS NOT NULL) AS held_conversation FROM sessions WHERE session_id = ?'
      )
      .get(sessionId) as { code_mode: number | null; held_conversation: number } | undefined;
    if (!row) return null;
    if (row.code_mode === 1) return true;
    if (row.code_mode === 0) return false;
    if (row.code_mode !== null) {
      console.warn(`[sessions] session ${sessionId} has an unreadable code_mode value; reading it as undecided`);
    }
    return row.held_conversation === 1 ? false : null;
  },

  /** Records the mode a chat was started in (1 or 0). False when no row has the id. Consumed by the code-mode module, which writes it only for a chat whose row held nothing. */
  setCodeMode(sessionId: string, on: boolean): boolean {
    const db = getConnection();
    const result = db.prepare('UPDATE sessions SET code_mode = ? WHERE session_id = ?').run(on ? 1 : 0, sessionId);

    return result.changes > 0;
  },
};
