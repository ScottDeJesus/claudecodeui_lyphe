// The Bugs view's dashboard has one read on the running server, behind sign-in like the rest of /api/kanban-dispatch:
// GET /api/kanban-dispatch/dashboard?board=all&days=30 answers { stats, changelog, cases, tickets }. `stats` is the
// board's own numbers over every board not archived (scope days 30, thirty byDay entries, open.total the database's own
// count of open cards); `changelog` is a list; `cases` and `tickets` are the house's two parts, each { ok, value } —
// here both answered, so `cases.value` names the suites `cases stats --days 30 --json` prints and `tickets.value`
// counts by source what `dispatcher bug stats --days 30 --json` prints. With no token it is 401
// (bug-board-ways-in-and-dashboard, seam 9).
//
// Reads only: the live board and the house's stores are read, never written. Each count is read before and after the
// call, so a card or a ticket that moves in between is not a false break.
//
// protects: server/modules/kanban-dispatch/kanban-dispatch.dashboard.ts, server/modules/kanban-dispatch/kanban-dispatch.routes.ts, server/modules/kanban-dispatch/kanban-dispatch.module.ts, server/index.ts
// writes: none

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { api, apiWithNoToken } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const ROUTE = "/api/kanban-dispatch/dashboard?board=all&days=30";
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPTS = path.join(os.homedir(), ".claude", "scripts");

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

/** One house door's JSON, run from the home folder as the server runs it; null when it did not answer. */
function door(bin, args) {
  try {
    return JSON.parse(execFileSync(path.join(SCRIPTS, bin), args, { encoding: "utf8", timeout: 60000, cwd: os.homedir() }));
  } catch {
    return null;
  }
}

const suiteNames = (stats) => (stats?.suites ?? []).map((s) => s.name).sort().join(",");
const sources = (stats) => JSON.stringify((stats?.by_source ?? []).map((s) => [s.source, s.filed, s.open, s.fixed, s.cleared, s.closed]));

runCase(async () => {
  const casesBefore = door("cases", ["stats", "--days", "30", "--json"]);
  const ticketsBefore = door("dispatcher", ["bug", "stats", "--days", "30", "--json"]);
  if (!casesBefore || !ticketsBefore) {
    return cannotRun(`the house's own doors did not answer (cases stats ${casesBefore ? "answered" : "did not"}, dispatcher bug stats ${ticketsBefore ? "answered" : "did not"}) — never a finding`);
  }

  const wrong = [];
  const signedOut = await apiWithNoToken(ROUTE, { judge401: false });
  if (signedOut.status !== 401) wrong.push(`GET ${ROUTE} with no token answered ${signedOut.status}, not 401`);

  const openBefore = openCount();
  const answer = await api(ROUTE);
  const openAfter = openCount();
  const casesAfter = door("cases", ["stats", "--days", "30", "--json"]);
  const ticketsAfter = door("dispatcher", ["bug", "stats", "--days", "30", "--json"]);

  if (answer.status !== 200 || !answer.json || typeof answer.json !== "object") {
    wrong.push(`GET ${ROUTE} answered ${answer.status}${answer.json ? "" : " with no JSON"}`);
    return broken(wrong.join("; ").slice(0, 390));
  }
  const { stats, changelog, cases, tickets } = answer.json;

  if (stats?.scope?.days !== 30 || stats?.scope?.boardId !== null) wrong.push(`stats scope ${JSON.stringify(stats?.scope)}, not every board over 30 days`);
  if (!Array.isArray(stats?.byDay) || stats.byDay.length !== 30) wrong.push(`stats byDay has ${stats?.byDay?.length} entries, not 30`);
  const total = stats?.open?.total;
  if (total !== openBefore && total !== openAfter) wrong.push(`stats open.total ${total}, the database counts ${openBefore} (then ${openAfter})`);
  if (!Array.isArray(changelog)) wrong.push(`changelog is ${JSON.stringify(changelog)?.slice(0, 60)}, not a list`);

  if (cases?.ok !== true) wrong.push(`cases is ${JSON.stringify(cases)?.slice(0, 120)}, not {ok: true} while the door answers`);
  else if (cases.value?.days !== 30 || ![suiteNames(casesBefore), suiteNames(casesAfter)].includes(suiteNames(cases.value))) {
    wrong.push(`cases names suites [${suiteNames(cases.value)}] over ${cases.value?.days} days; the door prints [${suiteNames(casesBefore)}] over 30`);
  }

  if (tickets?.ok !== true) wrong.push(`tickets is ${JSON.stringify(tickets)?.slice(0, 120)}, not {ok: true} while the door answers`);
  else if (![sources(ticketsBefore), sources(ticketsAfter)].includes(sources(tickets.value))) {
    wrong.push(`tickets by_source ${sources(tickets.value)}, the door prints ${sources(ticketsBefore)}`);
  }

  if (wrong.length > 0) return broken(wrong.join("; ").slice(0, 390));
  return held(`401 signed out; 200: open ${total} as the database counts, 30 days, ${changelog.length} changelog lines, ${cases.value.suites.length} suites and ${tickets.value.by_source.length} ticket sources as the doors print`);
});
