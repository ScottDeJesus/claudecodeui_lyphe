// A board database in the shape the live one had before the board purge — the usage ledger table, the board's two
// dropped dials, the card's four lease and two approval columns, lessons whose source defaulted to the retired agent's
// name — is migrated by the server's own migrations, twice. The first run copies it to
// `auth.db.bak-<date>-before-board-purge` beside it (the copy still holds every old row), then drops the table and
// the eight columns and rebuilds the lessons table with `source` defaulting to 'learn', every board, card and lesson
// row kept as it was. The second run changes nothing and takes no second copy.
//
// The database lives in a scratch folder that is also this process's HOME, at <HOME>/.cloudcli/auth.db, so the
// migration's backup lands in scratch whether it is built from DATABASE_PATH or from the home directory.
//
// protects: server/modules/database/migrations.ts, server/modules/database/migrations-board-dispatch.ts, server/modules/database/migrations-columns.ts, server/modules/database/kanban-schema.ts
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { OLD_LESSON_SOURCE, PURGED_COLUMNS, PURGED_TABLE, writeOldBoardTables } from "../lib/old_board_shape.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const BACKUP = /^auth\.db\.bak-(.+)-before-board-purge$/;
const KEPT = {
  kanban_boards: "id, name, project_id, autonomy, repos, sort_order, archived, created_at, updated_at, legacy_id",
  kanban_cards:
    "id, board_id, title, status, priority, description, closing_remarks, plan, body, archived, sort_order, " +
    "build_tokens_in, build_tokens_out, build_tokens_cache_read, build_tokens_cache_create, created_at, updated_at, legacy_id",
  kanban_lessons:
    "id, card_id, name, summary, body, trigger, kind, tags, status, source, draft_path, created_at, reviewed_at, legacy_id",
};

type Db = import("better-sqlite3").Database;

function seed(db: Db): void {
  const at = "2026-11-01T10:00:00.000Z";
  const board = db.prepare(
    "INSERT INTO kanban_boards (id, name, autonomy, deepseek_flash, concurrency, repos, sort_order, archived, created_at, updated_at, legacy_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  );
  board.run("b-1", "Old board", 1, 1, 3, '["/tmp/x"]', 1, 0, at, at, "LB1");
  board.run("b-2", "Archived board", 0, 0, 1, "[]", 2, 1, at, at, null);
  const card = db.prepare(
    "INSERT INTO kanban_cards (id, board_id, title, status, priority, description, plan, body, approved, approved_at, build_tokens_in, build_lease_at, build_owner, plan_lease_at, plan_owner, created_at, updated_at, legacy_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  );
  card.run("c-1", "b-1", "Approved and leased", "active", "high", "d1", "p1", "", 1, at, 42, at, "owner-a", at, "owner-b", at, at, "LC1");
  card.run("c-2", "b-1", "Queued", "todo", "medium", "", null, "body", 0, null, 0, null, null, null, null, at, at, null);
  card.run("c-3", "b-2", "Done", "done", "low", "", null, "", 0, null, 7, null, null, null, null, at, at, "LC3");
  const lesson = db.prepare(
    "INSERT INTO kanban_lessons (id, card_id, name, summary, trigger, status, source, created_at, legacy_id) VALUES (?,?,?,?,?,?,?,?,?)"
  );
  lesson.run("l-1", "c-1", "one", "s1", "t1", "staged", OLD_LESSON_SOURCE, at, "LL1");
  lesson.run("l-2", null, "two", "s2", "t2", "approved", "learn", at, null);
  lesson.run("l-3", "c-3", "three", "s3", "t3", "rejected", OLD_LESSON_SOURCE, at, null);
  const usage = db.prepare("INSERT INTO kanban_session_usage (session_id, board_id, card_id, tokens_in, updated_at) VALUES (?,?,?,?,?)");
  usage.run("s-1", "b-1", "c-1", 100, at);
  usage.run("s-2", null, null, 5, at);
}

const rows = (db: Db): Record<string, string> =>
  Object.fromEntries(
    Object.entries(KEPT).map(([table, cols]) => [table, JSON.stringify(db.prepare(`SELECT ${cols} FROM ${table} ORDER BY id`).all())])
  );

const columnsOf = (db: Db, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

const hasTable = (db: Db, table: string): boolean =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));

function today(): string[] {
  const now = new Date();
  const local = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")];
  const utc = now.toISOString().slice(0, 10).split("-");
  return [local.join("-"), local.join(""), utc.join("-"), utc.join("")];
}

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const home: string = await scratchDir(t, "board-purge-old");
  const dir = path.join(home, ".cloudcli");
  fs.mkdirSync(dir);
  const file = path.join(dir, "auth.db");

  const Database = (await import("better-sqlite3")).default;
  const fixture = new Database(file);
  writeOldBoardTables(fixture);
  seed(fixture);
  const before = rows(fixture);
  fixture.close();

  // Set before the database module loads: it opens the file this names and no other.
  process.env.HOME = home;
  process.env.DATABASE_PATH = file;
  const database = await import("../../server/modules/database/index.ts");
  const { runMigrations } = await import("../../server/modules/database/migrations.ts");
  t.defer(() => database.closeConnection());
  await database.initializeDatabase();
  const db = database.getConnection() as Db;

  const wrong: string[] = [];
  const backups = fs.readdirSync(dir).filter((name) => BACKUP.test(name));
  if (backups.length !== 1) wrong.push(`${backups.length} backup files named auth.db.bak-<date>-before-board-purge beside the database, not 1 (${fs.readdirSync(dir).join(", ")})`);
  const backup = backups.length === 1 ? path.join(dir, backups[0]) : null;
  if (backup) {
    const stamp = BACKUP.exec(backups[0])![1];
    if (!today().some((day) => stamp.includes(day))) wrong.push(`the backup ${backups[0]} names no form of today's date`);
    const copy = new Database(backup, { readonly: true });
    const usage = hasTable(copy, PURGED_TABLE) ? (copy.prepare(`SELECT COUNT(*) AS n FROM ${PURGED_TABLE}`).get() as { n: number }).n : -1;
    const copied = rows(copy);
    const approved = columnsOf(copy, "kanban_cards").includes("approved");
    copy.close();
    if (usage !== 2 || !approved || JSON.stringify(copied) !== JSON.stringify(before)) {
      wrong.push(`the backup is not the database as it stood before the drops (usage rows ${usage}, cards.approved ${approved}, kept rows ${JSON.stringify(copied) === JSON.stringify(before) ? "equal" : "differ"})`);
    }
  }

  if (hasTable(db, PURGED_TABLE)) wrong.push(`${PURGED_TABLE} is still there`);
  for (const [table, gone] of Object.entries(PURGED_COLUMNS)) {
    const left = gone.filter((c) => columnsOf(db, table).includes(c));
    if (left.length > 0) wrong.push(`${table} still has ${left.join(", ")}`);
  }
  const source = (db.prepare("PRAGMA table_info(kanban_lessons)").all() as Array<{ name: string; dflt_value: string | null; notnull: number }>).find((c) => c.name === "source");
  if (source?.dflt_value !== "'learn'" || source?.notnull !== 1) wrong.push(`kanban_lessons.source is ${JSON.stringify(source)}, not NOT NULL DEFAULT 'learn'`);
  const after = rows(db);
  for (const table of Object.keys(KEPT)) {
    if (after[table] !== before[table]) wrong.push(`${table}'s rows changed: before ${before[table]} after ${after[table]}`);
  }

  if (wrong.length === 0) {
    const shape = JSON.stringify(db.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all());
    const stamps = backups.map((name) => fs.statSync(path.join(dir, name)).mtimeMs);
    runMigrations(db);
    const reshape = JSON.stringify(db.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all());
    const again = fs.readdirSync(dir).filter((name) => BACKUP.test(name) || name.includes("bak"));
    if (reshape !== shape) wrong.push("a second run of the migrations changed the schema");
    if (JSON.stringify(rows(db)) !== JSON.stringify(after)) wrong.push("a second run of the migrations changed the kept rows");
    if (again.length !== backups.length || backups.some((name, i) => fs.statSync(path.join(dir, name)).mtimeMs !== stamps[i])) {
      wrong.push(`a second run, with nothing left to drop, wrote a backup again (${again.join(", ")})`);
    }
  }

  if (wrong.length > 0) return broken(wrong.join("; ").slice(0, 380));
  return held(`one backup ${backups[0]} with the old rows; ${PURGED_TABLE} and the eight columns gone; 2 boards, 3 cards, 3 lessons kept as they were (two still say the old source); source defaults to 'learn'; a second run changed nothing and copied nothing`);
});
