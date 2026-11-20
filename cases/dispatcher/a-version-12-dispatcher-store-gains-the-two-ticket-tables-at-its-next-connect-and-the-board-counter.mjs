// The live dispatcher store is at schema version 12 when the ticket line lands. Its next connect must give it the two
// ticket tables in the seam's columns and their two indexes, stamp it 13 or later (a later version appends its own
// ticket columns after the seam's 21) and keep every row it held; and because CloudCLI
// re-reads the board only when the board counter moves, both tables must carry the counter's triggers (they are
// derived from `store._SCHEMA`, so a ticket table kept out of it would never wake the board).
//
// A scratch store is built from the version-12 schema as commit 476d1a5 of the house holds it, given one card row, then
// opened once by the real `dispatcher cards`; its structure is read back, and one ticket and one key are written
// straight into it to watch `meta.board_version`.
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
const V12 = "476d1a5";
const TICKET_COLUMNS = ["id", "source", "path", "title", "words", "priority", "shots", "reporter", "session", "walk", "state",
  "board", "card", "card_row", "regression_of", "times", "word", "word_told_at", "filed_at", "placed_at", "ended_at"];

runCase(async (t) => {
  let text;
  try {
    text = execFileSync("git", ["-C", HOUSE, "show", `${V12}:hooks/dispatcher/store.py`], { encoding: "utf8", timeout: 30000 });
  } catch (error) {
    return cannotRun(`git show ${V12}:hooks/dispatcher/store.py did not answer: ${String(error?.message ?? error).split("\n")[0]}`);
  }
  const schema = text.match(/\n_SCHEMA = """([\s\S]*?)"""/)?.[1];
  if (!schema || !/SCHEMA_VERSION = 12\n/.test(text)) return cannotRun(`commit ${V12}'s store.py holds no version-12 _SCHEMA`);

  const house = await bugHouse(t, "store-v12");
  fs.mkdirSync(path.dirname(house.db), { recursive: true });
  await exec(house, `${schema}\nINSERT INTO meta (key, value) VALUES ('schema_version', '12');\n`
    + "INSERT INTO cards (board, card, board_name, title, words, priority, actor, repos, state, told_at)"
    + " VALUES ('b-1', 'c-1', 'Case board', 'Kept card', 'w', 'medium', 'operator', '[]', 'done', '2026-11-01T00:00:00Z');");

  const opened = await dispatcher(house, ["cards"]);
  if (opened.code !== 0) return broken(`dispatcher cards on a version-12 store failed — ${said(opened)}`);

  const wrong = [];
  const [version] = await rows(house, "SELECT value FROM meta WHERE key = 'schema_version'");
  if (!(Number(version?.value) >= 13)) wrong.push(`the store reads schema_version ${version?.value}, not 13 or later`);
  const kept = await rows(house, "SELECT title FROM cards");
  if (kept.length !== 1 || kept[0].title !== "Kept card") wrong.push(`the card row was not kept: ${JSON.stringify(kept)}`);
  const cols = (await rows(house, "SELECT name FROM pragma_table_info('tickets')")).map((r) => r.name);
  if (JSON.stringify(cols.slice(0, TICKET_COLUMNS.length)) !== JSON.stringify(TICKET_COLUMNS)) wrong.push(`tickets has the columns ${JSON.stringify(cols)}, not the seam's ${TICKET_COLUMNS.length} first`);
  const keyCols = (await rows(house, "SELECT name, pk FROM pragma_table_info('ticket_keys') ORDER BY cid")).map((r) => `${r.name}:${r.pk}`);
  if (keyCols.join(",") !== "ticket_id:1,key:2") wrong.push(`ticket_keys reads ${keyCols.join(",") || "absent"}, not (ticket_id, key) as its primary key`);
  const indexes = (await rows(house, "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('ticket_keys_by_key', 'tickets_by_session')")).map((r) => r.name).sort();
  if (indexes.join(",") !== "ticket_keys_by_key,tickets_by_session") wrong.push(`the store holds the indexes ${JSON.stringify(indexes)}, not ticket_keys_by_key and tickets_by_session`);
  const triggers = (await rows(house, "SELECT name FROM sqlite_master WHERE type = 'trigger' AND (name LIKE 'board_tickets_%' OR name LIKE 'board_ticket_keys_%')")).length;
  if (triggers !== 6) wrong.push(`the two ticket tables carry ${triggers} board-counter triggers, not 6`);

  if (cols.length && keyCols.length) {
    const before = Number((await rows(house, "SELECT value FROM meta WHERE key = 'board_version'"))[0]?.value ?? 0);
    await exec(house, "INSERT INTO tickets (id, source, path, title, words, priority, reporter, state, filed_at)"
      + " VALUES (1, 'chat', '/tmp', 'T', 'w', 'medium', '{}', 'filed', '2026-11-19T00:00:00Z')", []);
    await exec(house, "INSERT INTO ticket_keys (ticket_id, key) VALUES (1, 'case:k')", []);
    const after = Number((await rows(house, "SELECT value FROM meta WHERE key = 'board_version'"))[0]?.value ?? 0);
    if (after - before !== 2) wrong.push(`a ticket and its key moved board_version by ${after - before}, not 2`);
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`a version-12 store opened once reads version ${version.value} with its card row kept, both ticket tables in the seam's columns (tickets' 21 first), both indexes, six counter triggers, and a ticket with its key moved the counter by 2`);
});
