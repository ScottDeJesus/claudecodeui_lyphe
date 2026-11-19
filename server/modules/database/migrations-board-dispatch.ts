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
 */
import type { Database } from 'better-sqlite3';

import {
  addColumnToTableIfNotExists,
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
