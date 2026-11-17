/**
 * The session panel's table, as one idempotent DDL script: what one chat has put on its panel, a row for each version.
 *
 * WHY A ROW IS A VERSION. The panel shows one thing at a time, and each `panel show` or `panel update` is a new version of what
 * it shows: a row here. The newest row of a chat is what its panel shows; the older ones are the line a reader walks back along.
 * `panel clear` deletes the chat's rows, and the service keeps only the newest few (`session-panel.service.ts`), so the line is
 * bounded.
 *
 * WHY THE ROWS HANG ON `sessions`. A panel belongs to ONE chat, keyed on the chat's APP session id (`sessions.session_id`), for
 * the reasons the followups table gives: that id is stable for the chat's whole life, and the cascade is what makes a deleted
 * chat take its panel with it on every path that removes a session row. The merges move the rows first
 * (`sessionPanelDb.moveToSession`, called by `sessions.db.ts`). `user_id` is the account that owned the run when the chat showed
 * the thing, and the reader's door reads only rows that carry its own.
 *
 * `id` is AUTOINCREMENT, never reused: the transcript holds the id a `panel show` answered (the mark in the talk points at it),
 * and a number written there an hour ago must never name a different version today. `version` is the number a reader sees, counted
 * from 1 for each chat and starting again after a clear.
 *
 * The only consumer is `runMigrations`, which execs this beside `FOLLOWUPS_SCHEMA_SQL`. Every statement is `IF NOT EXISTS`, so a
 * re-run is a no-op, and editing a column here changes nothing on a database that already has the table: a later column needs
 * `addColumnToTableIfNotExists` in `migrations.ts`.
 */
export const SESSION_PANEL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS session_panel_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    -- diagram: mermaid source. picture: an http(s) address or an absolute path of an image file on this box.
    -- page: an http(s) address drawn in a frame. widget: an HTML body run in the sandboxed widget frame.
    kind TEXT NOT NULL CHECK (kind IN ('diagram', 'picture', 'page', 'widget')),
    -- One plain line; the service judges it, the table only stores it.
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    -- ISO-8601 UTC with milliseconds, written by the repository.
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

-- The one read: a chat's versions, oldest first.
CREATE INDEX IF NOT EXISTS ix_session_panel_versions_session ON session_panel_versions(session_id, id);
`;
