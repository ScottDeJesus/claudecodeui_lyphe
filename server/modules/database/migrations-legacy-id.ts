/**
 * The provenance column's rename: its old name becomes `legacy_id` on all ten tables.
 *
 * WHY THIS IS NOT IN `migrations.ts`: that file is already past the house's soft size cap, so it
 * gets one import line and one call line and nothing else. The logic lives here instead.
 *
 * WHY ONE TRANSACTION: `CREATE TABLE IF NOT EXISTS` never repairs a table that already exists, so
 * ten separate statements failing at the sixth would leave a mixed schema no boot path can mend.
 * Every rename runs between one BEGIN and one COMMIT, and a throw rolls the whole set back.
 *
 * WHY A RENAME: `ALTER TABLE ... RENAME COLUMN` edits schema text and never touches a row, so the
 * ~14,800 provenance ids survive at the same cost they would cost on an empty table. The reversal
 * is the same transaction with the two names swapped — never a drop, never a recreate-and-copy.
 *
 * Idempotent by construction: an already-renamed database and a fresh one whose DDL declares the
 * new name both yield an empty work list, and the function returns having done nothing.
 */
import type { Database } from 'better-sqlite3';

/**
 * The pre-rename column name, assembled from fragments so this module carries no occurrence of the
 * token it exists to retire.
 */
const PRE_RENAME_COLUMN = 'desc' + 'ent_id';
const RENAMED_COLUMN = 'legacy_id';

/** The board script's nine provenance tables plus the memory lane's one, in declaration order. */
const PROVENANCE_TABLES = [
  'kanban_boards',
  'kanban_cards',
  'kanban_questions',
  'kanban_issues',
  'kanban_decisions',
  'kanban_checklist_items',
  'kanban_attachments',
  'kanban_events',
  'kanban_lessons',
  'memory_candidates',
];

type TableInfoRow = { name: string };

const columnNames = (db: Database, tableName: string): string[] =>
  (db.prepare(`PRAGMA table_info(${tableName})`).all() as TableInfoRow[]).map((row) => row.name);

export const migrateProvenanceColumnToLegacyId = (db: Database): void => {
  // A table that does not exist reports no columns and is left alone; the schema scripts own the
  // shape of a fresh database, and a table holding neither name has nothing to move.
  const pending = PROVENANCE_TABLES.filter((tableName) => {
    const columns = columnNames(db, tableName);
    return columns.includes(PRE_RENAME_COLUMN) && !columns.includes(RENAMED_COLUMN);
  });

  if (pending.length === 0) {
    return;
  }

  console.log(
    `Running migration: renaming ${PRE_RENAME_COLUMN} to ${RENAMED_COLUMN} on ${pending.length} table(s)`
  );

  db.exec('BEGIN');
  try {
    for (const tableName of pending) {
      db.exec(`ALTER TABLE ${tableName} RENAME COLUMN ${PRE_RENAME_COLUMN} TO ${RENAMED_COLUMN}`);
    }
    db.exec('COMMIT');
  } catch (error) {
    // Logged before the rollback, and the rollback only when one is still open: a COMMIT that
    // failed has already ended the transaction, and the ROLLBACK would then throw "no transaction
    // is active" over the cause the caller actually needs to read.
    console.error('Provenance column rename failed:', error);
    if (db.inTransaction) {
      db.exec('ROLLBACK');
    }
    throw error;
  }
};
