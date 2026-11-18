import { getConnection } from '@/modules/database/connection.js';

/**
 * `session_panel_versions`, as row-level statements: what one chat has put on its panel, a row for each version.
 *
 * Every read and write names the chat (`session_id`, the APP session id) or the account (`user_id`) it acts for in its `WHERE`
 * clause, so an id that belongs to another chat or account reads as no row. The stamps are ISO-8601 UTC with milliseconds,
 * written in JS. A row leaves the table with its chat (the foreign key's cascade, `session-panel-schema.ts`), on a clear, or
 * when the line is trimmed to its newest few; it moves with its chat when a duplicate session row is merged away
 * (`moveToSession`).
 *
 * Consumers: `server/modules/session-panel/session-panel.service.ts`, the lane's only reader and writer, and `sessions.db.ts`,
 * which calls `moveToSession` inside its merge transactions. Reach it through `@/modules/database/index.js`.
 */

/** The four kinds of thing a chat can put on its panel. */
export type SessionPanelKind = 'diagram' | 'picture' | 'page' | 'widget';

/** One `session_panel_versions` row, exactly as the table stores it. */
export type SessionPanelRow = {
  id: number;
  session_id: string;
  user_id: number;
  version: number;
  kind: SessionPanelKind;
  title: string;
  body: string;
  created_at: string;
};

/** A row without its body: what a list answers, since a body can be a whole page. */
export type SessionPanelHeadRow = Omit<SessionPanelRow, 'body'>;

const HEAD_COLUMNS = 'id, session_id, user_id, version, kind, title, created_at';
const ALL_COLUMNS = `${HEAD_COLUMNS}, body`;

export const sessionPanelDb = {
  /** The chat's versions without their bodies, oldest first: the line a reader walks. */
  listHeadsForChat(sessionId: string): SessionPanelHeadRow[] {
    return getConnection()
      .prepare(`SELECT ${HEAD_COLUMNS} FROM session_panel_versions WHERE session_id = ? ORDER BY id`)
      .all(sessionId) as SessionPanelHeadRow[];
  },

  /** The chat's versions that one account owns, without their bodies, oldest first: the reader's door. */
  listHeadsForChatOfUser(sessionId: string, userId: number): SessionPanelHeadRow[] {
    return getConnection()
      .prepare(`SELECT ${HEAD_COLUMNS} FROM session_panel_versions WHERE session_id = ? AND user_id = ? ORDER BY id`)
      .all(sessionId, userId) as SessionPanelHeadRow[];
  },

  /** The chat's newest version, whole, or undefined while its panel is empty: what an update is a new version of. */
  latestForChat(sessionId: string): SessionPanelRow | undefined {
    return getConnection()
      .prepare(`SELECT ${ALL_COLUMNS} FROM session_panel_versions WHERE session_id = ? ORDER BY id DESC LIMIT 1`)
      .get(sessionId) as SessionPanelRow | undefined;
  },

  /** One version, whole, where the account owns it; undefined for an id that is gone or another account's. */
  getForUser(id: number, userId: number): SessionPanelRow | undefined {
    return getConnection()
      .prepare(`SELECT ${ALL_COLUMNS} FROM session_panel_versions WHERE id = ? AND user_id = ?`)
      .get(id, userId) as SessionPanelRow | undefined;
  },

  /**
   * Adds the chat's next version and trims the line to its newest `keep`, in ONE write transaction, so the version number is the
   * chat's highest plus one whatever else is writing. Answers the row as stored.
   */
  addVersion(input: { sessionId: string; userId: number; kind: SessionPanelKind; title: string; body: string; keep: number }): SessionPanelRow {
    const db = getConnection();
    const now = new Date().toISOString();
    return db.transaction(() => {
      const highest = db
        .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM session_panel_versions WHERE session_id = ?')
        .get(input.sessionId) as { version: number };
      const row = db
        .prepare(
          `INSERT INTO session_panel_versions (session_id, user_id, version, kind, title, body, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           RETURNING ${ALL_COLUMNS}`,
        )
        .get(input.sessionId, input.userId, highest.version + 1, input.kind, input.title, input.body, now) as SessionPanelRow;
      db.prepare(
        `DELETE FROM session_panel_versions
         WHERE session_id = ? AND id NOT IN (SELECT id FROM session_panel_versions WHERE session_id = ? ORDER BY id DESC LIMIT ?)`,
      ).run(input.sessionId, input.sessionId, input.keep);
      return row;
    }).immediate();
  },

  /** Empties the chat's panel: every version of it goes. Answers how many went. */
  clearForChat(sessionId: string): number {
    return getConnection().prepare('DELETE FROM session_panel_versions WHERE session_id = ?').run(sessionId).changes;
  },

  /**
   * Moves a chat's panel onto another chat. `sessions.db.ts` calls it INSIDE the transaction that merges a duplicate session row
   * into the surviving one, BEFORE the duplicate row is deleted: the cascade would otherwise take the versions with the row.
   */
  moveToSession(fromSessionId: string, toSessionId: string): void {
    getConnection().prepare('UPDATE session_panel_versions SET session_id = ? WHERE session_id = ?').run(toSessionId, fromSessionId);
  },
};
