/**
 * The followups lane's table, as one idempotent DDL script: one open chat's next steps and known gaps.
 *
 * WHY THE ROWS HANG ON `sessions`. An item belongs to ONE chat, keyed on the chat's APP session id
 * (`sessions.session_id`) — the id that is stable for the chat's whole life; the provider's id is not
 * (a chat's provider id changes when its transcript is replaced). The foreign key to `sessions` with
 * `ON DELETE CASCADE` is what makes "a deleted chat takes its items with it" true on EVERY path that
 * removes a session row — one chat deleted, a whole project's chats going, a duplicate row merged away —
 * without any of those paths knowing this table exists. The merges are the one place the cascade would
 * be wrong, and they move the items first (`followupsDb.moveToSession`, called by `sessions.db.ts`).
 * `user_id` is the account that owned the run when the chat filed the item, and the user's door reads
 * only rows that carry its own.
 *
 * `id` is AUTOINCREMENT, never reused: a chat holds ids in its context, and a number it remembers from
 * an hour ago must never name a different item today.
 *
 * The only consumer is `runMigrations`, which execs this beside `NOTES_SCHEMA_SQL`. Every statement is
 * `IF NOT EXISTS`, so a re-run is a no-op — and the consequence is the one the notes script warns about:
 * editing a column here changes NOTHING on a database that already has the table. A later column needs
 * an explicit `ALTER TABLE` through `addColumnToTableIfNotExists` in `migrations.ts`.
 */
export const FOLLOWUPS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS followups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    -- next: something left open for later (a question, an offer, a step put off).
    -- gap: something known to be missing or unverified (an untested case, a limit, a risk).
    kind TEXT NOT NULL CHECK (kind IN ('next', 'gap')),
    -- One line, trimmed, 1-240 characters; the service judges it, the table only stores it.
    text TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'done')),
    -- ISO-8601 UTC with milliseconds, written by the repository.
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    done_at TEXT,
    -- Who settled it: the chat's own command, or the person ticking it in the widget.
    closed_by TEXT CHECK (closed_by IN ('chat', 'user')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

-- The one read: a chat's items, oldest first within each state.
CREATE INDEX IF NOT EXISTS ix_followups_session ON followups(session_id, state, id);
`;
