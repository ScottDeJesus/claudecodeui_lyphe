// The board's two reads on the running server sit behind sign-in like the rest of /api/kanban: GET
// /api/kanban/stats?board=all&days=30 and GET /api/kanban/changelog?board=all&format=md with no token are 401. With
// the checks token, stats is 200 over every board not archived: scope.days 30, thirty byDay entries, and open.total
// the database's own count of cards not archived and not in Done on boards not archived; the changelog in Markdown is
// 200, not JSON, and holds one dated line (YYYY-MM-DD) for each entry the same read answers as JSON; a board id no
// board has is the board's ordinary 404. (The kit's door hands back no headers, so the content type is the review's
// to read with curl, not this case's.)
//
// Reads only: the live board is read, never written. The count is read from the server's database with sqlite3's
// read-only mode, before and after the call, so a card that moves in between is not a false break.
//
// protects: server/modules/kanban/routes/stats.routes.ts, server/modules/kanban/routes/kanban.routes.ts, server/modules/kanban/kanban.module.ts, server/modules/kanban/kanban-stats.service.ts, server/index.ts
// writes: none

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { api, apiWithNoToken } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";

const STATS = "/api/kanban/stats?board=all&days=30";
const CHANGELOG = "/api/kanban/changelog?board=all&format=md";
const CHANGELOG_JSON = "/api/kanban/changelog?board=all&format=json";
const NO_BOARD = "/api/kanban/stats?board=case-no-such-board&days=30";
const REPO = fileURLToPath(new URL("../../", import.meta.url));

/** The database the server reads: DATABASE_PATH from the process, then the repo's .env, then the app's default. */
function databaseFile() {
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
  const env = path.join(REPO, ".env");
  const line = fs.existsSync(env) ? fs.readFileSync(env, "utf8").split("\n").find((l) => /^\s*DATABASE_PATH\s*=/.test(l)) : null;
  if (line) return line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  return path.join(os.homedir(), ".cloudcli", "auth.db");
}

const OPEN_SQL =
  "SELECT COUNT(*) FROM kanban_cards c JOIN kanban_boards b ON b.id = c.board_id " +
  "WHERE c.archived = 0 AND c.status <> 'done' AND b.archived = 0";
const openCount = () => Number(execFileSync("sqlite3", ["-readonly", databaseFile(), OPEN_SQL], { encoding: "utf8" }).trim());

runCase(async () => {
  const wrong = [];
  for (const route of [STATS, CHANGELOG]) {
    const out = await apiWithNoToken(route, { judge401: false });
    if (out.status !== 401) wrong.push(`GET ${route} with no token answered ${out.status}, not 401`);
  }

  const before = openCount();
  const stats = await api(STATS);
  const after = openCount();
  if (stats.status !== 200) {
    wrong.push(`GET ${STATS} answered ${stats.status}`);
  } else {
    // The board's routes answer in an envelope named for what they hold ({ board }, { stats }); a bare body reads too.
    const s = stats.json?.stats ?? stats.json ?? {};
    if (s.scope?.days !== 30 || s.scope?.boardId !== null) wrong.push(`stats scope ${JSON.stringify(s.scope)}, not every board over 30 days`);
    if (!Array.isArray(s.byDay) || s.byDay.length !== 30) wrong.push(`stats byDay has ${s.byDay?.length} entries, not 30`);
    const total = s.open?.total;
    if (total !== before && total !== after) wrong.push(`stats open.total ${total}, the database counts ${before} (then ${after})`);
  }

  const asJson = await api(CHANGELOG_JSON);
  const md = await api(CHANGELOG);
  const entries = Array.isArray(asJson.json) ? asJson.json : (asJson.json?.entries ?? asJson.json?.changelog);
  const dated = (md.text ?? "").split("\n").filter((l) => /\d{4}-\d{2}-\d{2}/.test(l)).length;
  if (asJson.status !== 200 || !Array.isArray(entries)) wrong.push(`GET ${CHANGELOG_JSON} answered ${asJson.status} with no list of entries`);
  else if (md.status !== 200 || md.json !== null || dated !== entries.length) {
    wrong.push(`GET ${CHANGELOG} answered ${md.status}${md.json !== null ? " JSON" : ""} with ${dated} dated lines for ${entries.length} entries`);
  }

  const none = await api(NO_BOARD);
  if (none.status !== 404) wrong.push(`GET ${NO_BOARD} answered ${none.status}, not 404`);

  if (wrong.length > 0) return broken(wrong.join("; ").slice(0, 390));
  return held(`no token: 401 twice; stats: 200, 30 days, open ${(stats.json?.stats ?? stats.json).open.total} as the database counts; changelog md: 200, ${dated} dated lines for as many entries; an unknown board: 404`);
});
