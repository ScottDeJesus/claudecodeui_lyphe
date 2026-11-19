// A board database in the shape it had before the board learned when a card closed — kanban_cards with no
// done_at and no changelog — is migrated by the server's own migrations, twice. The first run adds done_at
// (TEXT, nullable) and changelog (TEXT NOT NULL DEFAULT ''), and stamps every card already in Done once: the ts
// of the newest event that moved it there, in either vocabulary the log holds (`card.moved` with `to: "done"`,
// the imported board's `feature.moved` with `status: "done"`), else the card's own updated_at. A move into a
// lane that is not Done is no stamp, an event whose payload is not JSON is no move (and does not fail the boot),
// and a card outside Done keeps done_at NULL whatever its history. The second run changes no row.
//
// The database is built new in a scratch folder that is also this process's HOME, then has the two columns
// dropped, which is the live database's shape before this change; the rows are written straight into it.
//
// protects: server/modules/database/migrations.ts, server/modules/database/migrations-kanban-done.ts, server/modules/database/kanban-schema.ts, server/modules/database/migrations-columns.ts
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

type Db = import("better-sqlite3").Database;

const COLUMNS = ["done_at", "changelog"];
const AT = (h: number): string => new Date(Date.UTC(2026, 10, 1, h)).toISOString();

// card id -> its status, its updated_at, the events written for it in order (kind, payload, ts), and the done_at it must end with.
const CARDS: Array<{ id: string; status: string; events: Array<[string, string, string]>; want: string | null }> = [
  { id: "c-moved", status: "done", want: AT(5), events: [
    ["card.moved", '{"from":"todo","to":"done"}', AT(1)],
    ["card.moved", '{"from":"done","to":"todo"}', AT(3)],
    ["card.moved", '{"from":"todo","to":"done"}', AT(5)],
    ["card.updated", '{"title":"x"}', AT(7)],
  ] },
  { id: "c-feature", status: "done", want: AT(6), events: [
    ["feature.moved", '{"status": "active"}', AT(2)],
    ["feature.moved", '{"status": "done"}', AT(6)],
  ] },
  { id: "c-mixed", status: "done", want: AT(9), events: [
    ["feature.moved", '{"status": "done"}', AT(4)],
    ["card.moved", '{"from":"active","to":"done"}', AT(9)],
  ] },
  { id: "c-badjson", status: "done", want: AT(8), events: [
    ["card.moved", '{"from":"todo","to":"done"}', AT(8)],
    ["card.moved", "not json {", AT(10)],
  ] },
  { id: "c-none", status: "done", want: AT(20), events: [] },
  { id: "c-open", status: "todo", want: null, events: [["card.moved", '{"from":"active","to":"done"}', AT(11)]] },
  { id: "c-active", status: "active", want: null, events: [["feature.moved", '{"status": "done"}', AT(12)]] },
];

const columnsOf = (db: Db): Array<{ name: string; type: string; notnull: number; dflt_value: string | null }> =>
  db.prepare("PRAGMA table_info(kanban_cards)").all() as any;

function seed(db: Db): void {
  db.prepare("INSERT INTO kanban_boards (id, name, created_at, updated_at) VALUES ('b-1', 'Case board', ?, ?)").run(AT(0), AT(0));
  const card = db.prepare(
    "INSERT INTO kanban_cards (id, board_id, title, status, created_at, updated_at) VALUES (?, 'b-1', ?, ?, ?, ?)"
  );
  const event = db.prepare("INSERT INTO kanban_events (ts, kind, board_id, card_id, payload) VALUES (?, ?, 'b-1', ?, ?)");
  for (const c of CARDS) card.run(c.id, `title ${c.id}`, c.status, AT(0), AT(20));
  // Interleaved across cards, ids rising with ts, so a read that ignores card_id would take another card's move.
  const all = CARDS.flatMap((c) => c.events.map(([kind, payload, ts]) => ({ id: c.id, kind, payload, ts })));
  all.sort((a, b) => a.ts.localeCompare(b.ts));
  for (const e of all) event.run(e.ts, e.kind, e.id, e.payload);
}

const rows = (db: Db): string =>
  JSON.stringify(db.prepare("SELECT * FROM kanban_cards ORDER BY id").all());

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const home: string = await scratchDir(t, "done-at-migration");
  const dir = path.join(home, ".cloudcli");
  fs.mkdirSync(dir);
  const file = path.join(dir, "auth.db");

  // Set before the database modules load, so nothing they resolve reaches the live home.
  process.env.HOME = home;
  process.env.DATABASE_PATH = file;
  const Database = (await import("better-sqlite3")).default;
  const { runMigrations } = await import("../../server/modules/database/migrations.ts");
  const { INIT_SCHEMA_SQL } = await import("../../server/modules/database/schema.ts");

  const db = new Database(file);
  t.defer(() => db.close());
  db.exec(INIT_SCHEMA_SQL);
  runMigrations(db);
  // The shape before this change: neither column.
  for (const name of COLUMNS) {
    if (columnsOf(db).some((c) => c.name === name)) db.exec(`ALTER TABLE kanban_cards DROP COLUMN ${name}`);
  }
  seed(db);

  runMigrations(db);
  const wrong: string[] = [];
  const cols = columnsOf(db);
  const doneAt = cols.find((c) => c.name === "done_at");
  const changelog = cols.find((c) => c.name === "changelog");
  if (!doneAt) wrong.push("kanban_cards has no done_at after the migrations");
  else if (doneAt.type.toUpperCase() !== "TEXT" || doneAt.notnull !== 0) wrong.push(`done_at is ${doneAt.type} notnull=${doneAt.notnull}, not nullable TEXT`);
  if (!changelog) wrong.push("kanban_cards has no changelog after the migrations");
  else if (changelog.type.toUpperCase() !== "TEXT" || changelog.notnull !== 1 || changelog.dflt_value !== "''") {
    wrong.push(`changelog is ${changelog.type} notnull=${changelog.notnull} default ${changelog.dflt_value}, not TEXT NOT NULL DEFAULT ''`);
  }
  if (wrong.length > 0) return broken(wrong.join("; "));

  const got = new Map(
    (db.prepare("SELECT id, done_at, changelog FROM kanban_cards").all() as Array<{ id: string; done_at: string | null; changelog: string }>)
      .map((r) => [r.id, r])
  );
  for (const c of CARDS) {
    const row = got.get(c.id);
    if (!row) { wrong.push(`${c.id} is gone`); continue; }
    if (row.done_at !== c.want) wrong.push(`${c.id} (${c.status}) done_at ${row.done_at}, not ${c.want}`);
    if (row.changelog !== "") wrong.push(`${c.id} changelog ${JSON.stringify(row.changelog)}, not ''`);
  }

  const first = rows(db);
  runMigrations(db);
  if (rows(db) !== first) wrong.push("the second run changed a card row");

  if (wrong.length > 0) return broken(wrong.join("; ").slice(0, 380));
  return held(`both columns added; ${CARDS.filter((c) => c.status === "done").length} done cards stamped from their newest move into Done in either vocabulary, or updated_at; the not-JSON event ignored; open cards NULL; second run changed nothing`);
});
