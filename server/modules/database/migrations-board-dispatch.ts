/**
 * The board-dispatch migrations, kept out of `migrations.ts` because that file is past the house's
 * soft size cap and gets one import line and one call line and nothing else.
 *
 * `kanban_boards.repos` is a JSON array of the absolute paths of the git repositories a board's cards
 * are built in. The dispatcher walks a card inside them, and a board with autonomy on must name at
 * least one or the board service refuses it. `kanban-schema.ts` declares the column with
 * `IF NOT EXISTS`, which reaches only a new database; this is the half that reaches the live one.
 *
 * Existing boards take `'[]'`: they name no repository until their owner says which. Idempotent: a
 * database that already has the column is left alone.
 *
 * `purgeRetiredBoardSchema` drops the board columns and table that nothing reads any more: the
 * per-board model switch and session dial, the card's build and plan leases and its approval, and the
 * per-session usage ledger. It also rebuilds `kanban_lessons` so that `source` defaults to `'learn'`,
 * since the default it had named a stager the board no longer has. It runs at every boot and does
 * nothing once nothing is owed. Before the first drop it writes a consistent copy of a file database
 * beside it; if that copy cannot be written, nothing is dropped and the purge is retried at the next
 * boot.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

import type { Database } from 'better-sqlite3';

import {
  addColumnToTableIfNotExists,
  dropColumnIfExists,
  getColumnDefault,
  getTableInfo,
  tableExists,
} from '@/modules/database/migrations-columns.js';

export const migrateKanbanBoardRepos = (db: Database): void => {
  // A database without the board table has nothing to alter; the schema script creates the table
  // with the column already declared.
  if (!tableExists(db, 'kanban_boards')) {
    return;
  }

  const columnNames = getTableInfo(db, 'kanban_boards').map((column) => column.name);
  addColumnToTableIfNotExists(
    db,
    'kanban_boards',
    columnNames,
    'repos',
    "TEXT NOT NULL DEFAULT '[]'"
  );
};

export const purgeRetiredBoardSchema = (db: Database): void => {
  const columnNamesOf = (tableName: string): string[] =>
    tableExists(db, tableName) ? getTableInfo(db, tableName).map((column) => column.name) : [];
  const boardColumns = columnNamesOf('kanban_boards');
  const cardColumns = columnNamesOf('kanban_cards');
  const lessonsColumns = columnNamesOf('kanban_lessons');

  const retiredBoardColumns = ['deepseek_flash', 'concurrency'];
  const retiredCardColumns = [
    'build_lease_at',
    'build_owner',
    'plan_lease_at',
    'plan_owner',
    'approved',
    'approved_at',
  ];
  const boardColumnsOwed = retiredBoardColumns.some((column) => boardColumns.includes(column));
  const cardColumnsOwed = retiredCardColumns.some((column) => cardColumns.includes(column));
  const sessionUsageOwed = tableExists(db, 'kanban_session_usage');
  const lessonsSourceOwed =
    lessonsColumns.includes('source') &&
    getColumnDefault(db, 'kanban_lessons', 'source') !== "'learn'";

  // Nothing owed: return before any backup or write, so a purged database costs nothing at boot.
  if (!boardColumnsOwed && !cardColumnsOwed && !sessionUsageOwed && !lessonsSourceOwed) {
    return;
  }

  // The copy is taken through the open connection, so it is consistent even if another writer
  // holds the file.
  if (!db.memory && db.name !== '') {
    const now = new Date();
    const twoDigits = (value: number): string => String(value).padStart(2, '0');
    const localDate = [now.getFullYear(), twoDigits(now.getMonth() + 1), twoDigits(now.getDate())].join(
      '-'
    );
    const backupPath = `${path.resolve(db.name)}.bak-${localDate}-before-board-purge`;

    if (existsSync(backupPath)) {
      // An earlier boot's copy, made before anything was dropped, is kept rather than replaced.
      console.log(`Reusing board purge backup at ${backupPath}`);
    } else {
      try {
        db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
      } catch (error) {
        console.error(`Board purge backup ${backupPath} failed; nothing dropped`, error);
        return;
      }
    }

    if (!(existsSync(backupPath) && statSync(backupPath).size > 0)) {
      console.error(
        `Board purge backup ${backupPath} failed its check; nothing dropped`,
        new Error('backup file is missing or empty')
      );
      return;
    }
    console.log(`Board purge backup ready at ${backupPath}`);
  }

  if (sessionUsageOwed) {
    console.log('Running migration: Dropping kanban_session_usage table');
    db.exec('DROP TABLE IF EXISTS kanban_session_usage');
  }
  for (const column of retiredBoardColumns) {
    dropColumnIfExists(db, 'kanban_boards', boardColumns, column);
  }
  for (const column of retiredCardColumns) {
    dropColumnIfExists(db, 'kanban_cards', cardColumns, column);
  }

  if (lessonsSourceOwed) {
    console.log("Running migration: Rebuilding kanban_lessons with source defaulting to 'learn'");
    // Rebuilt the way migrations.ts rebuilds projects: SQLite cannot change a column default in place.
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec('BEGIN TRANSACTION');
      db.exec('DROP TABLE IF EXISTS kanban_lessons__new');
      db.exec(`
        CREATE TABLE kanban_lessons__new (
          id TEXT PRIMARY KEY NOT NULL,
          card_id TEXT NULL REFERENCES kanban_cards(id) ON DELETE SET NULL,
          name TEXT NOT NULL DEFAULT '',
          summary TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          trigger TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL DEFAULT 'note',
          tags TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'staged',
          source TEXT NOT NULL DEFAULT 'learn',
          draft_path TEXT NULL,
          created_at TEXT NOT NULL,
          reviewed_at TEXT NULL,
          legacy_id TEXT NULL UNIQUE
        )
      `);
      db.exec(`
        INSERT INTO kanban_lessons__new (
          id, card_id, name, summary, body, trigger, kind,
          tags, status, source, draft_path, created_at, reviewed_at, legacy_id
        )
        SELECT
          id, card_id, name, summary, body, trigger, kind,
          tags, status, source, draft_path, created_at, reviewed_at, legacy_id
        FROM kanban_lessons
      `);
      db.exec('DROP TABLE kanban_lessons');
      db.exec('ALTER TABLE kanban_lessons__new RENAME TO kanban_lessons');
      db.exec(
        'CREATE INDEX IF NOT EXISTS ix_kanban_lessons_status ON kanban_lessons(status, created_at)'
      );
      db.exec('COMMIT');
    } catch (error) {
      if (db.inTransaction) {
        db.exec('ROLLBACK');
      }
      throw error;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
};
