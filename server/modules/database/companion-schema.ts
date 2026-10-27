/**
 * The companion's four tables, as one idempotent DDL script: Kaylee's per-account state, her
 * exchange, her note cards, and the briefs she has relayed into chats.
 *
 * WHY THE FIRST THREE HANG ON `users`. Everything of hers is keyed by the CloudCLI account: the
 * account's own conversation, its own panel, its own cards. `ON DELETE CASCADE` takes all three
 * away with the account without any path that removes a user knowing these tables exist.
 *
 * WHY `relayed_sends` HANGS ON `sessions`. A relayed send is a fact about a CHAT'S history — "this
 * message came to the chat through Kaylee" — so it follows the chat, keyed on the app session id
 * (`sessions.session_id`, the id that is stable for the chat's whole life), and it survives
 * Kaylee's Clear, which empties only her own side. The cascade removes a deleted chat's rows when
 * the chat is deleted; the merge paths that delete a watcher's duplicate row move nothing of this
 * table, because a send is never recorded on such a row (`relayed-sends.db.ts` says why).
 *
 * `companion_log.id` and `companion_notes.id` are AUTOINCREMENT, never reused: the panel holds
 * ids (a note it asks to dismiss, an entry it has drawn), and a number it remembers must never
 * name a different row today. The log keeps the newest 400 rows per account; the repository
 * prunes on every append (`companion.db.ts`).
 *
 * The only consumer is `runMigrations`, which execs this beside `FOLLOWUPS_SCHEMA_SQL`. Every
 * statement is `IF NOT EXISTS`, so a re-run is a no-op — and the consequence is the one the
 * followups script warns about: editing a column here changes NOTHING on a database that already
 * has the table. A later column needs an explicit `ALTER TABLE` through
 * `addColumnToTableIfNotExists` in `migrations.ts`.
 */
export const COMPANION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS companion_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider_session_id TEXT,     -- her CLI conversation; NULL until her first init and after Clear
  focus_json TEXT,              -- CompanionSessionRef | NULL
  draft_json TEXT,              -- CompanionDraft | NULL
  walk_json TEXT,               -- CompanionWalk | NULL
  floor TEXT,                   -- the client id holding the floor
  updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS companion_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('operator','kaylee','alert','system')),
  via TEXT CHECK (via IN ('typed','spoken')), turn_id TEXT, turn_index INTEGER,
  text TEXT NOT NULL, mood TEXT, sounds_json TEXT);
CREATE INDEX IF NOT EXISTS idx_companion_log_user ON companion_log(user_id, id);
CREATE TABLE IF NOT EXISTS companion_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS relayed_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  via TEXT NOT NULL, text TEXT NOT NULL, sent_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_relayed_sends_session ON relayed_sends(session_id);
`;
