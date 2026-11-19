// A database made new and one in the shape before the board purge end in the same board shape. The server's
// migrations build an empty file (the declaration in kanban-schema.ts) and migrate a second file holding the old
// tables (the drops in the migrations): kanban_boards, kanban_cards and kanban_lessons then carry the same columns,
// types, defaults, indexes and foreign keys in both; neither has kanban_session_usage or a purged column; no line of
// either schema names the retired board agent; and building the new one took no backup, there being nothing to drop.
//
// Both files live in a scratch folder that is also this process's HOME, so no backup can land beside the live database.
// The new file is opened here and given the server's schema and migrations (what initializeDatabase runs), not through
// getConnection: that copies an install directory's old auth.db into a missing target, so its file is never new.
//
// protects: server/modules/database/kanban-schema.ts, server/modules/database/migrations.ts, server/modules/database/migrations-board-dispatch.ts, server/modules/database/migrations-columns.ts
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { boardShape, OLD_LESSON_SOURCE, PURGED_COLUMNS, PURGED_TABLE, writeOldBoardTables } from "../lib/old_board_shape.mjs";
import { scratchDir } from "../lib/scratch.mjs";

type Db = import("better-sqlite3").Database;

const hasTable = (db: Db, table: string): boolean =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));

function purgedLeft(db: Db, label: string): string[] {
  const wrong: string[] = [];
  if (hasTable(db, PURGED_TABLE)) wrong.push(`the ${label} database has ${PURGED_TABLE}`);
  for (const [table, gone] of Object.entries(PURGED_COLUMNS)) {
    const names = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
    const left = gone.filter((c) => names.includes(c));
    if (left.length > 0) wrong.push(`the ${label} database's ${table} has ${left.join(", ")}`);
  }
  const named = (db.prepare("SELECT name FROM sqlite_master WHERE sql LIKE ?").all(`%${OLD_LESSON_SOURCE}%`) as Array<{ name: string }>).map((r) => r.name);
  if (named.length > 0) wrong.push(`the ${label} database's schema names the retired agent in ${named.join(", ")}`);
  return wrong;
}

function differ(fresh: ReturnType<typeof boardShape>, migrated: ReturnType<typeof boardShape>): string[] {
  const wrong: string[] = [];
  for (const table of Object.keys(fresh)) {
    for (const part of ["columns", "indexes", "keys"] as const) {
      const a = fresh[table][part];
      const b = migrated[table][part];
      const onlyNew = a.filter((x: string) => !b.includes(x));
      const onlyOld = b.filter((x: string) => !a.includes(x));
      if (onlyNew.length > 0 || onlyOld.length > 0) {
        wrong.push(`${table} ${part}: new only [${onlyNew.join("; ")}], migrated only [${onlyOld.join("; ")}]`);
      }
    }
  }
  return wrong;
}

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const home: string = await scratchDir(t, "board-purge-shape");
  const dir = path.join(home, ".cloudcli");
  fs.mkdirSync(dir);
  const freshFile = path.join(dir, "auth.db");
  const oldFile = path.join(home, "old.db");

  const Database = (await import("better-sqlite3")).default;

  // Set before the database modules load, so nothing they resolve reaches the live home.
  process.env.HOME = home;
  process.env.DATABASE_PATH = freshFile;
  const { runMigrations } = await import("../../server/modules/database/migrations.ts");
  const { INIT_SCHEMA_SQL } = await import("../../server/modules/database/schema.ts");
  const fresh = new Database(freshFile);
  t.defer(() => fresh.close());
  fresh.exec(INIT_SCHEMA_SQL);
  runMigrations(fresh);

  const wrong: string[] = [];
  const copies = fs.readdirSync(dir).filter((name) => name !== "auth.db" && !name.startsWith("auth.db-"));
  if (copies.length > 0) wrong.push(`building a new database wrote ${copies.join(", ")} beside it`);
  wrong.push(...purgedLeft(fresh, "new"));
  const freshShape = boardShape(fresh);

  const old = new Database(oldFile);
  t.defer(() => old.close());
  writeOldBoardTables(old);
  old.exec(INIT_SCHEMA_SQL);
  runMigrations(old);
  wrong.push(...purgedLeft(old, "migrated"));
  wrong.push(...differ(freshShape, boardShape(old)));

  if (wrong.length > 0) return broken(wrong.join("; ").slice(0, 380));
  const counts = Object.entries(freshShape).map(([table, s]) => `${table} ${s.columns.length} columns`).join(", ");
  return held(`new and migrated agree (${counts}, their indexes and keys); neither has ${PURGED_TABLE}, a purged column or the old name; no backup beside the new one`);
});
