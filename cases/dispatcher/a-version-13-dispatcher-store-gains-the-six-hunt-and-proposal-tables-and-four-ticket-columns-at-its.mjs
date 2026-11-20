// The live dispatcher store reads schema version 13 when the bug hunters' store lands (measured 2026-11-20). Its next
// connect must give it the four hunt tables (seam 4) and the two proposal tables (seam 8) in the seams' columns, add
// `hunt`, `sitting_id`, `needs_you` and `proposal_id` to `tickets` by ALTER, stamp it 14 or later and keep every row it
// held; a SECOND connect must find it whole and change nothing (every statement of `_SCHEMA` is `IF NOT EXISTS`). The
// six tables carry the board counter's triggers, so CloudCLI's store watch wakes on their writes. A fresh store comes
// up with the same six tables and the same ticket columns, from `_SCHEMA` alone.
//
// A scratch store is built from the version-13 schema as house commit b5022d3 holds it, given one ticket, then opened
// twice by the real `dispatcher cards`; a second scratch home is opened fresh.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/store.py, /home/lyphe/.claude/hooks/dispatcher/store_schema.py, /home/lyphe/.claude/hooks/dispatcher/store_board.py
// writes: none

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bugHouse, dispatcher, exec, rows, said } from "../lib/bug_house.mjs";

const HOUSE = path.join(os.homedir(), ".claude");
const V13 = "b5022d3";
const TABLES = {
  hunt_nights: ["night", "opened_at", "minutes", "state", "closed_at", "why"],
  hunt_passes: ["id", "hunt", "project", "number", "state", "mapped_at", "done_at"],
  hunt_sittings: ["id", "night", "hunt", "project", "pass_id", "soul", "model", "launch_id", "state", "outcome", "cause", "deadline", "started_at", "ended_at"],
  hunt_units: ["id", "pass_id", "unit", "folder", "position", "fingerprint", "state", "note", "sitting_id", "handed_at", "handed", "marked_at"],
  proposals: ["id", "path", "title", "words", "kind", "priority", "state", "reporter", "hunt", "feature", "ticket_id", "reason", "proposed_at", "ended_at"],
  proposal_findings: ["id", "proposal_id", "unit", "words", "reporter", "found_at"],
};
const NEW_TICKET_COLUMNS = ["hunt", "sitting_id", "needs_you", "proposal_id"];

async function shape(house) {
  const wrong = [];
  for (const [table, want] of Object.entries(TABLES)) {
    const cols = (await rows(house, `SELECT name FROM pragma_table_info('${table}')`)).map((r) => r.name);
    if (JSON.stringify(cols) !== JSON.stringify(want)) wrong.push(`${table} has ${JSON.stringify(cols)}, not the seam's ${want.length} columns`);
    const triggers = (await rows(house, `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('board_${table}_insert', 'board_${table}_update', 'board_${table}_delete')`)).length;
    if (triggers !== 3) wrong.push(`${table} carries ${triggers} board-counter triggers, not 3`);
  }
  const ticketCols = (await rows(house, "SELECT name FROM pragma_table_info('tickets')")).map((r) => r.name);
  const missing = NEW_TICKET_COLUMNS.filter((c) => !ticketCols.includes(c));
  if (missing.length) wrong.push(`tickets lacks ${JSON.stringify(missing)}`);
  const fk = (await rows(house, "SELECT \"table\" AS t, \"from\" AS f FROM pragma_foreign_key_list('tickets')")).some((r) => r.t === "proposals" && r.f === "proposal_id");
  if (!fk) wrong.push("tickets.proposal_id does not reference proposals");
  const [version] = await rows(house, "SELECT value FROM meta WHERE key = 'schema_version'");
  if (!(Number(version?.value) >= 14)) wrong.push(`the store reads schema_version ${version?.value}, not 14 or later`);
  return wrong;
}

runCase(async (t) => {
  let text;
  try {
    text = execFileSync("git", ["-C", HOUSE, "show", `${V13}:hooks/dispatcher/store.py`], { encoding: "utf8", timeout: 30000 });
  } catch (error) {
    return cannotRun(`git show ${V13}:hooks/dispatcher/store.py did not answer: ${String(error?.message ?? error).split("\n")[0]}`);
  }
  const schema = text.match(/\n_SCHEMA = """([\s\S]*?)"""/)?.[1];
  if (!schema || !/SCHEMA_VERSION = 13\n/.test(text)) return cannotRun(`commit ${V13}'s store.py holds no version-13 _SCHEMA`);

  const old = await bugHouse(t, "store-v13");
  fs.mkdirSync(path.dirname(old.db), { recursive: true });
  await exec(old, `${schema}\nINSERT INTO meta (key, value) VALUES ('schema_version', '13');\n`
    + "INSERT INTO tickets (id, source, path, title, words, priority, reporter, state, filed_at)"
    + " VALUES (1, 'chat', '/tmp', 'Kept ticket', 'w', 'medium', '{}', 'filed', '2026-11-19T00:00:00Z');");

  const wrong = [];
  for (const time of ["first", "second"]) {
    const opened = await dispatcher(old, ["cards"]);
    if (opened.code !== 0) return broken(`the ${time} dispatcher cards on a version-13 store failed — ${said(opened)}`);
  }
  wrong.push(...(await shape(old)).map((w) => `upgraded: ${w}`));
  const kept = await rows(old, "SELECT * FROM tickets");
  if (kept.length !== 1 || kept[0].title !== "Kept ticket" || NEW_TICKET_COLUMNS.some((c) => kept[0][c] !== null && kept[0][c] !== undefined)) wrong.push(`the ticket was not kept as it was: ${JSON.stringify(kept)}`);

  if (wrong.length === 0) {
    const before = Number((await rows(old, "SELECT value FROM meta WHERE key = 'board_version'"))[0]?.value ?? 0);
    await exec(old, "INSERT INTO hunt_passes (id, hunt, project, number, state, mapped_at) VALUES (1, 'code', '/tmp', 1, 'open', '2026-11-20T00:00:00Z')", []);
    await exec(old, "INSERT INTO hunt_units (pass_id, unit, folder, position, fingerprint, state) VALUES (1, 'a.py', '.', 0, 'f', 'open')", []);
    const after = Number((await rows(old, "SELECT value FROM meta WHERE key = 'board_version'"))[0]?.value ?? 0);
    if (after - before !== 2) wrong.push(`a pass and a unit moved board_version by ${after - before}, not 2`);
  }

  const fresh = await bugHouse(t, "store-fresh");
  const made = await dispatcher(fresh, ["cards"]);
  if (made.code !== 0) wrong.push(`dispatcher cards on a fresh home failed — ${said(made)}`);
  else wrong.push(...(await shape(fresh)).map((w) => `fresh: ${w}`));

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("a version-13 store opened twice reads 14+, keeps its ticket, holds the six tables in the seams' columns with 18 counter triggers and the four ticket columns, and a pass and a unit moved the counter by 2; a fresh store comes up the same");
});
