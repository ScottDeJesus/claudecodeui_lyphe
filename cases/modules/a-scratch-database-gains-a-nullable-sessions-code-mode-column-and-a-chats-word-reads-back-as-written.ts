// protects: server/modules/database/migrations.ts, server/modules/database/repositories/session-user-state.db.ts
// writes: none
//
// A chat's Code Mode word is one nullable INTEGER on its own sessions row: NULL means the chat was never launched
// with a word, and it is the only state in which the code-mode module asks the switch and stores an answer. The
// column is added by CloudCLI's own runMigrations at boot, so nothing is left for the operator to apply.
//
// The case boots a scratch database (DATABASE_PATH set before any database module loads), reads the column's
// shape with PRAGMA, and writes and reads one new chat's word through sessionUserStateDb, the one door the module
// uses. The real database is never opened.

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

type Column = { name: string; type: string; notnull: number; dflt_value: unknown };

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder: string = await scratchDir(t, "code-mode-column");
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  await writeFile(process.env.DATABASE_PATH, "");

  // Loaded in the body, after DATABASE_PATH names the scratch file: no module opens the real database.
  const { initializeDatabase, getConnection, sessionsDb, sessionUserStateDb } = await import("../../server/modules/database/index.ts");
  await initializeDatabase();
  const db = getConnection();

  const wrong: string[] = [];
  const column = (db.prepare("PRAGMA table_info(sessions)").all() as Column[]).find((c) => c.name === "code_mode");
  if (!column) return broken("a booted database's sessions table has no code_mode column");
  if (column.type.toUpperCase() !== "INTEGER") wrong.push(`code_mode is ${column.type}, not INTEGER`);
  if (column.notnull !== 0) wrong.push("code_mode is NOT NULL");
  if (column.dflt_value !== null) wrong.push(`code_mode defaults to ${String(column.dflt_value)}`);

  const store = sessionUserStateDb as Record<string, unknown>;
  if (typeof store.getCodeMode !== "function" || typeof store.setCodeMode !== "function") {
    return broken(`sessionUserStateDb has no getCodeMode / setCodeMode${wrong.length ? `; ${wrong.join("; ")}` : ""}`);
  }
  const getCodeMode = store.getCodeMode as (id: string) => boolean | null;
  const setCodeMode = store.setCodeMode as (id: string, on: boolean) => boolean;

  const id = randomUUID();
  sessionsDb.createAppSession(id, "claude", folder, "code mode column case");
  const cell = () => (db.prepare("SELECT code_mode, toolsets FROM sessions WHERE session_id = ?").get(id) as { code_mode: unknown; toolsets: unknown });

  if (cell().code_mode !== null) wrong.push(`a new chat's code_mode cell is ${String(cell().code_mode)}, not NULL`);
  if (getCodeMode(id) !== null) wrong.push(`a new chat reads getCodeMode ${String(getCodeMode(id))}, not null`);

  for (const on of [true, false]) {
    const answered = setCodeMode(id, on);
    if (answered !== true) wrong.push(`setCodeMode(id, ${on}) answered ${String(answered)} for a row that exists`);
    if (getCodeMode(id) !== on) wrong.push(`after setCodeMode(id, ${on}) getCodeMode reads ${String(getCodeMode(id))}`);
    if (cell().code_mode !== (on ? 1 : 0)) wrong.push(`after setCodeMode(id, ${on}) the cell holds ${String(cell().code_mode)}`);
  }
  if (getCodeMode(randomUUID()) !== null) wrong.push("an id no row has does not read null");
  if (setCodeMode(randomUUID(), true) !== false) wrong.push("setCodeMode on an id no row has did not answer false");
  if (cell().toolsets !== null) wrong.push(`writing the word changed the chat's toolsets cell to ${String(cell().toolsets)}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("sessions.code_mode is a nullable INTEGER with no default; a new chat reads null, true and false read back as written, an unknown id reads null and is not written");
});
