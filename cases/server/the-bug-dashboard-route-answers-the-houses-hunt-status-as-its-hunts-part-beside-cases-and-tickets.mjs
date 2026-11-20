// protects: server/modules/kanban-dispatch/kanban-dispatch.dashboard.ts, server/modules/kanban-dispatch/kanban-dispatch.dashboard-parts.ts, server/modules/kanban-dispatch/kanban-dispatch.module.ts, /home/lyphe/.claude/hooks/dispatcher/hunt_report.py
// writes: none
//
// The Bugs view's dashboard read gains a fifth part (bug-hunters seam 10): GET /api/kanban-dispatch/dashboard answers
// `hunts` beside `cases` and `tickets`, from `dispatcher hunt status --json` through `readDispatcherJson`, as
// { ok: true, value } | { ok: false, error }. Here the house's door answers, so `hunts` is { ok: true } and its value is
// what the door prints: the switch, its start, the minutes, the order and the turns rule, and per hunter its soul and
// whether it runs, and per project its state, pass and the newest pass's total, covered, skipped and open. With no
// token it is 401, as the rest of /api/kanban-dispatch is.
//
// Reads only: the live board and the house's store are read, never written. The door is read before and after the
// call, so a hunter marking a unit in between is not a false break.

import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { api, apiWithNoToken } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const ROUTE = "/api/kanban-dispatch/dashboard?board=all&days=30";
const DISPATCHER = path.join(os.homedir(), ".claude", "scripts", "dispatcher");

function door() {
  try {
    return JSON.parse(execFileSync(DISPATCHER, ["hunt", "status", "--json"], { encoding: "utf8", timeout: 60000, cwd: os.homedir() }));
  } catch {
    return null;
  }
}

/** What both sides must agree on: the head, and each hunter's and project's standing (not the newest-night clock). */
function standing(status) {
  if (!status || typeof status !== "object") return null;
  return JSON.stringify({
    head: [status.nightly, status.start, status.minutes, status.order, status.turns],
    hunts: (status.hunts ?? []).map((h) => [h.hunt, h.soul, h.runs, (h.projects ?? []).map((p) => [p.project, p.state, p.pass, p.total, p.covered, p.skipped, p.open])]),
  });
}

runCase(async () => {
  const before = door();
  if (!before) return cannotRun("the house's `dispatcher hunt status --json` did not answer — never a finding");

  const wrong = [];
  const signedOut = await apiWithNoToken(ROUTE, { judge401: false });
  if (signedOut.status !== 401) wrong.push(`GET ${ROUTE} with no token answered ${signedOut.status}, not 401`);

  const answer = await api(ROUTE);
  const after = door();
  if (answer.status !== 200 || !answer.json || typeof answer.json !== "object") {
    wrong.push(`GET ${ROUTE} answered ${answer.status}${answer.json ? "" : " with no JSON"}`);
    return broken(wrong.join("; ").slice(0, 390));
  }
  const { cases, tickets, hunts } = answer.json;
  if (typeof cases?.ok !== "boolean" || typeof tickets?.ok !== "boolean") wrong.push(`the cases and tickets parts read ${JSON.stringify([cases?.ok, tickets?.ok])}, not each {ok, ...} beside hunts`);
  if (hunts?.ok !== true) wrong.push(`hunts is ${JSON.stringify(hunts)?.slice(0, 160)}, not {ok: true, value} while the door answers`);
  else if (![standing(before), standing(after)].includes(standing(hunts.value))) {
    wrong.push(`hunts.value reads ${standing(hunts.value)?.slice(0, 160)}, the door prints ${standing(before)?.slice(0, 160)}`);
  }

  if (wrong.length > 0) return broken(wrong.join("; ").slice(0, 600));
  const projects = hunts.value.hunts.reduce((n, h) => n + h.projects.length, 0);
  return held(`401 signed out; 200 with cases, tickets and hunts {ok: true}: ${hunts.value.hunts.length} hunters over ${projects} hunter-projects, nightly ${hunts.value.nightly}, turns ${hunts.value.turns}, as the door prints`);
});
