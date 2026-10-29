/**
 * The companion's five tables, as one idempotent DDL script: Kaylee's per-account state, her
 * exchange, her note cards, the briefs she has relayed into chats, and her record of the actions
 * she prepared for his word.
 *
 * WHY `companion_state`, `companion_log`, `companion_notes` AND `companion_actions` HANG ON `users`.
 * Everything of hers is keyed by the CloudCLI account: the account's own conversation, its own
 * panel, its own cards, its own record of actions. `ON DELETE CASCADE` takes all of them away with
 * the account without any path that removes a user knowing these tables exist.
 *
 * WHAT `companion_actions` KEEPS. One row for each action she prepared: what it was (`action`,
 * `target_json`, the `prompt` and the lines `carried_json` carries), what the prepare pinned
 * (`pin_json`, server-only: the ask and its lock token, the chain, the follow-up), when it was
 * prepared and when it lapses, the line of his that fired it (`said`, `said_at`, `said_log_id`),
 * and how it ended (`ended_at`, `outcome`, and `answer`, the door's own sentence). A row with no
 * `outcome` is the action still waiting; an action ends once. It is a fact about the HOUSE — what
 * was done, on whose word, and when — so Clear, which wipes her memory and her pending action,
 * never deletes it: a pending action Clear finds standing is ended `cancelled` in its row first,
 * so no row is left without an outcome. The pending action itself lives in
 * `companion_state.pending_json`, beside the draft: a column added after the table, by
 * `addCompanionPendingColumn` in `migrations.ts`. So is `companion_state.unanswered_json`, the words of
 * his that no turn of hers has answered yet (`addCompanionUnansweredColumn`): the next process says
 * them to her again.
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
CREATE TABLE IF NOT EXISTS companion_actions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL, target_json TEXT NOT NULL, pin_json TEXT NOT NULL,
  prompt TEXT, carried_json TEXT NOT NULL,
  prepared_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  said TEXT, said_at TEXT, said_log_id INTEGER,
  ended_at TEXT,
  outcome TEXT CHECK (outcome IN ('took','already','refused','cancelled','replaced','expired')),
  answer TEXT);
CREATE INDEX IF NOT EXISTS idx_companion_actions_user ON companion_actions(user_id, prepared_at);
`;
