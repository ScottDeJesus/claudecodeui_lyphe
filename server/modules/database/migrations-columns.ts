/**
 * The column helpers the migrations share, kept out of `migrations.ts` because that file is past the
 * house's size cap. The sibling migration modules (`migrations-board-dispatch.ts` first) need the same
 * helpers, and importing them from `migrations.ts` would close a circular import back into it.
 */
import type { Database } from 'better-sqlite3';

export type TableInfoRow = {
  name: string;
  pk: number;
};

export const addColumnToTableIfNotExists = (
  db: Database,
  tableName: string,
  columnNames: string[],
  columnName: string,
  columnType: string
) => {
  if (!columnNames.includes(columnName)) {
    console.log(`Running migration: Adding ${columnName} column to ${tableName} table`);
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
  }
};

export const tableExists = (db: Database, tableName: string): boolean =>
  Boolean(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName)
  );

export const getTableInfo = (db: Database, tableName: string): TableInfoRow[] =>
  db.prepare(`PRAGMA table_info(${tableName})`).all() as TableInfoRow[];
