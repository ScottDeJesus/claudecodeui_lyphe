/**
 * The Kanban board's tables, as one idempotent DDL script.
 *
 * The only consumer is `runMigrations` in `migrations.ts`, which execs this
 * beside the other table scripts. Every statement is `IF NOT EXISTS`, so a
 * re-run on an existing database is a no-op — that, and not a version
 * counter, is what makes the migration safe to run at every boot.
 *
 * THE CONSEQUENCE OF THAT NO-OP IS THE TRAP: once a database has these
 * tables, editing a column here changes NOTHING on it. Adding, renaming or
 * retyping a column later therefore needs an explicit `ALTER TABLE` — write
 * it with `addColumnToTableIfNotExists` in `migrations.ts`, beside the
 * `sessions` columns — not by editing a declaration below. A bare edit to a
 * table body still passes every scratch-database check (the scratch file is
 * created empty, so it builds the new shape) and fails only on a real
 * database that already has the old one, as a runtime error in a later phase.
 *
 * `descent_id` is `NULL UNIQUE` on purpose, and nullable on every table:
 * SQLite permits many NULLs under one UNIQUE constraint, so locally created
 * rows (no Descent ancestor) sit beside imported ones while the importer's
 * `ON CONFLICT(descent_id)` still keys cleanly on the rows that carry one.
 * A UNIQUE constraint already builds the index for it, so no separate index
 * on `descent_id` is declared below.
 */
export const KANBAN_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS kanban_boards (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    project_id TEXT NULL REFERENCES projects(project_id) ON DELETE SET NULL,
    autonomy INTEGER NOT NULL DEFAULT 0,
    deepseek_flash INTEGER NOT NULL DEFAULT 0,
    concurrency INTEGER NOT NULL DEFAULT 1,
    sort_order REAL NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    descent_id TEXT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS kanban_cards (
    id TEXT PRIMARY KEY NOT NULL,
    board_id TEXT NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_ready'
        CHECK (status IN ('not_ready', 'todo', 'questions', 'active', 'done')),
    priority TEXT NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high')),
    description TEXT NOT NULL DEFAULT '',
    closing_remarks TEXT NOT NULL DEFAULT '',
    plan TEXT NULL,
    body TEXT NOT NULL DEFAULT '',
    approved INTEGER NOT NULL DEFAULT 0,
    approved_at TEXT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    sort_order REAL NOT NULL DEFAULT 0,
    build_tokens_in INTEGER NOT NULL DEFAULT 0,
    build_tokens_out INTEGER NOT NULL DEFAULT 0,
    build_tokens_cache_read INTEGER NOT NULL DEFAULT 0,
    build_tokens_cache_create INTEGER NOT NULL DEFAULT 0,
    build_lease_at TEXT NULL,
    build_owner TEXT NULL,
    plan_lease_at TEXT NULL,
    plan_owner TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    descent_id TEXT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS kanban_card_tags (
    card_id TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (card_id, tag)
);

CREATE TABLE IF NOT EXISTS kanban_questions (
    id TEXT PRIMARY KEY NOT NULL,
    card_id TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE,
    text TEXT NOT NULL DEFAULT '',
    multi INTEGER NOT NULL DEFAULT 0,
    options TEXT NOT NULL DEFAULT '[]',
    selected TEXT NOT NULL DEFAULT '[]',
    other_on INTEGER NOT NULL DEFAULT 0,
    other TEXT NOT NULL DEFAULT '',
    answered INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    answered_at TEXT NULL,
    descent_id TEXT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS kanban_issues (
    id TEXT PRIMARY KEY NOT NULL,
    card_id TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE,
    text TEXT NOT NULL DEFAULT '',
    resolved INTEGER NOT NULL DEFAULT 0,
    filed_at TEXT NOT NULL,
    resolved_at TEXT NULL,
    resolved_by TEXT NULL,
    descent_id TEXT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS kanban_decisions (
    id TEXT PRIMARY KEY NOT NULL,
    card_id TEXT NULL REFERENCES kanban_cards(id) ON DELETE SET NULL,
    question_id TEXT NULL,
    question TEXT NOT NULL DEFAULT '',
    choice TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    descent_id TEXT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS kanban_checklist_items (
    id TEXT PRIMARY KEY NOT NULL,
    card_id TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'active', 'done')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    done_at TEXT NULL,
    descent_id TEXT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS kanban_attachments (
    id TEXT PRIMARY KEY NOT NULL,
    card_id TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE,
    filename TEXT NOT NULL DEFAULT '',
    mime TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    descent_id TEXT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS kanban_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    kind TEXT NOT NULL,
    board_id TEXT NULL,
    card_id TEXT NULL,
    actor TEXT NOT NULL DEFAULT 'operator',
    payload TEXT NOT NULL DEFAULT '{}',
    descent_id TEXT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS kanban_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kanban_id_seq (
    prefix TEXT PRIMARY KEY NOT NULL,
    next INTEGER NOT NULL DEFAULT 0
);

-- The lesson store: what a build learned, staged for a person's review before any later session
-- reads it back. card_id is ON DELETE SET NULL, never CASCADE — a lesson OUTLIVES the card it was
-- learned on, and the pointer to a deleted card simply goes NULL. descent_id carries the ov_lessons
-- row this one came from, like every other imported table here.
-- There is NO CHECK on status, kind or trigger: Descent's lesson vocabulary grew a value twice, and
-- a CHECK would fail the whole import transaction on a value it forbids. The doors validate instead.
CREATE TABLE IF NOT EXISTS kanban_lessons (
    id TEXT PRIMARY KEY NOT NULL,
    card_id TEXT NULL REFERENCES kanban_cards(id) ON DELETE SET NULL,
    name TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    trigger TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'note',
    tags TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'staged',
    source TEXT NOT NULL DEFAULT 'metis',
    draft_path TEXT NULL,
    created_at TEXT NOT NULL,
    reviewed_at TEXT NULL,
    descent_id TEXT NULL UNIQUE
);

-- What one Metis session has spent, read from its transcript: the per-session ledger behind the
-- card's rolled-up token chips. session_id is the primary key because a session has exactly one
-- row, upserted as the transcript grows; byte_offset is how far the reader has consumed it, so a
-- second tick resumes rather than re-counting. board_id and card_id are provenance and may be NULL
-- — a session whose card is deleted keeps its row, and the row's tokens are not the card's.
CREATE TABLE IF NOT EXISTS kanban_session_usage (
    session_id TEXT PRIMARY KEY NOT NULL,
    board_id TEXT NULL,
    card_id TEXT NULL,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cache_read INTEGER NOT NULL DEFAULT 0,
    cache_create INTEGER NOT NULL DEFAULT 0,
    byte_offset INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_kanban_cards_board_status ON kanban_cards(board_id, status, sort_order);
CREATE INDEX IF NOT EXISTS ix_kanban_cards_board_updated ON kanban_cards(board_id, status, updated_at);
CREATE INDEX IF NOT EXISTS ix_kanban_card_tags_tag ON kanban_card_tags(tag);
CREATE INDEX IF NOT EXISTS ix_kanban_questions_card ON kanban_questions(card_id);
CREATE INDEX IF NOT EXISTS ix_kanban_issues_card ON kanban_issues(card_id);
CREATE INDEX IF NOT EXISTS ix_kanban_decisions_card ON kanban_decisions(card_id);
CREATE INDEX IF NOT EXISTS ix_kanban_checklist_card ON kanban_checklist_items(card_id);
CREATE INDEX IF NOT EXISTS ix_kanban_attachments_card ON kanban_attachments(card_id);
CREATE INDEX IF NOT EXISTS ix_kanban_events_board ON kanban_events(board_id, id);
-- The lesson index read is always "this status, newest first"; the whole index read is this one
-- index. kanban_session_usage needs none: its reads are all by its own primary key.
CREATE INDEX IF NOT EXISTS ix_kanban_lessons_status ON kanban_lessons(status, created_at);
`;
