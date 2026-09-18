/**
 * The memory-intake lane's table, as one idempotent DDL script.
 *
 * WHY THIS IS NOT IN `kanban-schema.ts`: `memory_candidates` is not a board table. It has no
 * `board_id`, no card, no lane and no frame; the module that owns it (`modules/memory-intake/`) is
 * not the board, and the board never reads it. The name carries no `kanban_` prefix for the same
 * reason — a board prefix on a table the board cannot see is a lie in the schema.
 *
 * The only consumer is `runMigrations`, which execs this beside `KANBAN_SCHEMA_SQL` (after it, since
 * both sit behind the projects rebuild). Every statement is `IF NOT EXISTS`, so a re-run on an
 * existing database is a no-op — that, and not a version counter, is what makes it safe to run at
 * every boot.
 *
 * THE CONSEQUENCE OF THAT NO-OP IS THE TRAP, and it is the same one the board's script warns about:
 * once a database has this table, editing a column here changes NOTHING on it. Adding, renaming or
 * retyping a column later therefore needs an explicit `ALTER TABLE` written with
 * `addColumnToTableIfNotExists` in `migrations.ts` — never by editing a declaration below. A bare
 * edit to the table body still passes every scratch-database check (the scratch file is created
 * empty, so it builds the new shape) and fails only on a real database that already has the old one,
 * as a runtime error in a later phase.
 *
 * There is NO CHECK on `status` or `target`: Descent's candidate statuses grew a value twice, and a
 * CHECK a source value violates fails the whole import transaction rather than one row. The doors
 * (`validateMemoryArgs`, and the target list in `memory.service.ts`) validate instead.
 *
 * `descent_id` is `NULL UNIQUE` on purpose, like every imported table's: SQLite permits many NULLs
 * under one UNIQUE constraint, so a locally staged candidate sits beside an imported one while the
 * importer's `ON CONFLICT(descent_id)` still keys cleanly on the rows that carry one.
 */
export const MEMORY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memory_candidates (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    target TEXT NOT NULL,
    project TEXT NULL,
    index_line TEXT NULL,
    rationale TEXT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    source TEXT NOT NULL DEFAULT 'spill',
    session_id TEXT NULL,
    asserted_path TEXT NULL,
    refusal TEXT NULL,
    created_at TEXT NOT NULL,
    reviewed_at TEXT NULL,
    descent_id TEXT NULL UNIQUE
);

-- Both reads are "one status, newest first": the review queue and the filed list.
CREATE INDEX IF NOT EXISTS ix_memory_candidates_status ON memory_candidates(status, created_at);
`;
