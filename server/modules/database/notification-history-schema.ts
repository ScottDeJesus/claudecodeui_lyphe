/**
 * The notification history's table, as one idempotent DDL script: what the house told one account, kept.
 *
 * WHAT `notification_history` KEEPS. One row for every event the notification orchestrator was handed, written at the
 * listener seam BEFORE any push preference or dedupe: its `code`, `kind` and `severity`, the house's own wording for it
 * (`title`, `body`, with every cost or token figure taken out before it is stored), the chat it belongs to (`session_id`)
 * and the plan it names (`plan`), at the moment it was heard (`at`). It is the house's record of what it said, in the
 * words it said it in, and not a log of the push channels: a kind that is OFF for pushes by default is in it, and so is
 * an event the push dedupe dropped. An ask told AGAIN (every boot re-raises the asks still open) is one row: it replaces the
 * row it repeats. Every row of the last seven days is kept whole and, past that age, the newest 300 of each account; the repository prunes on every insert (`notification-history.db.ts`).
 *
 * WHY IT HANGS ON `users`. A notification belongs to the account the orchestrator was called for, and nothing else of
 * it outlives that account: `ON DELETE CASCADE` takes an account's history away with the account, without any path that
 * removes a user knowing this table exists. A chat is deliberately NOT a foreign key: the history outlives the chat it
 * is about (a deleted chat's "run finished" is still something the house said), so `session_id` is a plain id the
 * reader looks up when it wants the chat's name.
 *
 * `id` is AUTOINCREMENT, never reused, so "newest first" is `id DESC` and an id a reader remembers never names a
 * different row later.
 *
 * The only consumer is `runMigrations`, which execs this beside the companion's script. Every statement is
 * `IF NOT EXISTS`, so a re-run is a no-op — and the consequence is the one the followups script warns about: editing a
 * column here changes NOTHING on a database that already has the table. A later column needs an explicit `ALTER TABLE`
 * through `addColumnToTableIfNotExists` in `migrations.ts`.
 */
export const NOTIFICATION_HISTORY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS notification_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at TEXT NOT NULL, code TEXT NOT NULL, kind TEXT, severity TEXT,
  title TEXT NOT NULL, body TEXT NOT NULL,
  session_id TEXT, plan TEXT);
CREATE INDEX IF NOT EXISTS idx_notification_history_user ON notification_history(user_id, id);
`;
