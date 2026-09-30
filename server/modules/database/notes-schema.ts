/**
 * The notes lane's table, as one idempotent DDL script.
 *
 * WHY THIS IS NOT IN `kanban-schema.ts`: a note is not a board row — it has no `board_id`, no
 * lane, no frame — and the module that owns it (`modules/notes/`) is not the board. Nor is it a
 * preference document: a note is one card one account wrote, stored one row at a time, not a
 * settings blob read whole and rewritten. The only thing it references is `users`.
 *
 * The only consumer is `runMigrations`, which execs this beside `MEMORY_SCHEMA_SQL` (after the
 * projects rebuild, since no path of this lane crosses `projects`). Every statement is
 * `IF NOT EXISTS`, so a re-run on an existing database is a no-op — that, and not a version
 * counter, is what makes it safe to run at every boot.
 *
 * THE CONSEQUENCE OF THAT NO-OP IS THE TRAP, and it is the same one the memory lane's script
 * warns about: once a database has this table, editing a column here changes NOTHING on it.
 * Adding, renaming or retyping a column later therefore needs an explicit `ALTER TABLE` written
 * with `addColumnToTableIfNotExists` in `migrations.ts` — never by editing a declaration below.
 * A bare edit to the table body still passes every scratch-database check (the scratch file is
 * created empty, so it builds the new shape) and fails only on a real database that already has
 * the old one, as a runtime error in a later phase.
 */
export const NOTES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY NOT NULL,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    -- ISO-8601 UTC with milliseconds, written by the repository.
    -- created_at orders the list and never moves; updated_at is the last save.
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- The one read: an account's notes, newest first.
CREATE INDEX IF NOT EXISTS ix_notes_user_created ON notes(user_id, created_at);
`;
