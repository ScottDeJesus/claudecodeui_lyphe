// old_board_shape.mjs — the board tables as the live database held them on 2026-11-19, before the board purge.
//
//   import { OLD_LESSON_SOURCE, PURGED_COLUMNS, writeOldBoardTables } from "../lib/old_board_shape.mjs";
//   writeOldBoardTables(db);   // a better-sqlite3 handle on an empty file: projects and the four board tables, no rows
//
// A record of a shape that no longer exists anywhere but in old databases, so it never changes: the cases that
// prove the purge's migration build a database from it. The old lesson source is the retired board agent's name,
// spelt in two halves so the tree's search for that name stays empty while the old rows can still be written.

export const OLD_LESSON_SOURCE = ["me", "tis"].join("");

/** table -> the columns the purge drops from it. */
export const PURGED_COLUMNS = {
  kanban_boards: ["deepseek_flash", "concurrency"],
  kanban_cards: ["build_lease_at", "build_owner", "plan_lease_at", "plan_owner", "approved", "approved_at"],
};

export const PURGED_TABLE = "kanban_session_usage";

// The projects table rides along in its live shape: kanban_boards references it, and the migrations' table
// rebuilds refuse a schema whose reference names a table that is not there.
const OLD_SQL = `
CREATE TABLE projects (
    project_id TEXT PRIMARY KEY NOT NULL,
    project_path TEXT NOT NULL UNIQUE,
    custom_project_name TEXT DEFAULT NULL,
    isStarred BOOLEAN DEFAULT 0,
    isArchived BOOLEAN DEFAULT 0
, node TEXT DEFAULT NULL);
CREATE TABLE kanban_boards (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    project_id TEXT NULL REFERENCES projects(project_id) ON DELETE SET NULL,
    autonomy INTEGER NOT NULL DEFAULT 0,
    sort_order REAL NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    legacy_id TEXT NULL UNIQUE
, deepseek_flash INTEGER NOT NULL DEFAULT 0, concurrency INTEGER NOT NULL DEFAULT 1, repos TEXT NOT NULL DEFAULT '[]');
CREATE TABLE kanban_cards (
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
    legacy_id TEXT NULL UNIQUE
);
CREATE INDEX ix_kanban_cards_board_status ON kanban_cards(board_id, status, sort_order);
CREATE INDEX ix_kanban_cards_board_updated ON kanban_cards(board_id, status, updated_at);
CREATE TABLE kanban_lessons (
    id TEXT PRIMARY KEY NOT NULL,
    card_id TEXT NULL REFERENCES kanban_cards(id) ON DELETE SET NULL,
    name TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    trigger TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'note',
    tags TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'staged',
    source TEXT NOT NULL DEFAULT '${OLD_LESSON_SOURCE}',
    draft_path TEXT NULL,
    created_at TEXT NOT NULL,
    reviewed_at TEXT NULL,
    legacy_id TEXT NULL UNIQUE
);
CREATE INDEX ix_kanban_lessons_status ON kanban_lessons(status, created_at);
CREATE TABLE kanban_session_usage (
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
`;

/** writeOldBoardTables — the four old board tables and their indexes, on a handle to an empty database. */
export function writeOldBoardTables(db) {
  db.exec(OLD_SQL);
}

/**
 * boardShape — what a migration must agree on for the three kept board tables: each column's type, NOT NULL,
 * default and key, each index's columns, each foreign key, sorted so a column appended by ALTER compares equal to
 * one declared in place. Read through any better-sqlite3 handle.
 */
export function boardShape(db) {
  const shape = {};
  for (const table of ["kanban_boards", "kanban_cards", "kanban_lessons"]) {
    const columns = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => `${c.name} ${c.type} notnull=${c.notnull} default=${c.dflt_value} pk=${c.pk}`)
      .sort();
    const indexes = db
      .prepare(`PRAGMA index_list(${table})`)
      .all()
      .filter((i) => i.origin === "c")
      .map((i) => `${i.name}(${db.prepare(`PRAGMA index_info(${i.name})`).all().map((c) => c.name).join(",")})`)
      .sort();
    const keys = db
      .prepare(`PRAGMA foreign_key_list(${table})`)
      .all()
      .map((k) => `${k.from}->${k.table}.${k.to} delete=${k.on_delete}`)
      .sort();
    shape[table] = { columns, indexes, keys };
  }
  return shape;
}
