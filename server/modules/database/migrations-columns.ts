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

/**
 * SQLite's `DROP COLUMN` refuses a column that is a key, is indexed or is named by a constraint. That
 * refusal is left to rise, not caught here.
 */
export const dropColumnIfExists = (
  db: Database,
  tableName: string,
  columnNames: string[],
  columnName: string
): void => {
  if (columnNames.includes(columnName)) {
    console.log(`Running migration: Dropping ${columnName} column from ${tableName} table`);
    db.exec(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`);
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

type ColumnDefaultRow = {
  name: string;
  dflt_value: string | null;
};

export const getColumnDefault = (
  db: Database,
  tableName: string,
  columnName: string
): string | null =>
  db
    .prepare<[], ColumnDefaultRow>(`PRAGMA table_info(${tableName})`)
    .all()
    .find((row) => row.name === columnName)?.dflt_value ?? null;
