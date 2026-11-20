// A RED CHECK'S TICKET CARRIES WHAT CERBERUS ALREADY FOUND. When the check's trouble (the red since its last ok,
// `check-trouble.ts`) holds a FINISHED diagnosis, the ticket the red watch files carries it, as the page does
// (`red-watch-diagnosis.ts`): `Likely cause: <its summary>` and `Proposed fix: <name> — <cmd>`. A diagnosis still
// running has found nothing yet and adds no cause. Pages are halted today, and the lookup used to run only on the way to
// a push, after the halt's return: the ticket must have it all the same.
//
// The trouble is laid in the scratch Cerberus store as the store keeps it: an ok row, then the failing row the red began
// with, then the diagnosis rows, started after it.
//
// Scratch Cerberus store and scratch dispatcher home (`lib/red_watch_house.mjs`); nothing of the operator's is touched.
//
// protects: server/modules/cerberus/red-watch-tickets.ts, server/modules/cerberus/red-watch.service.ts, server/modules/cerberus/red-watch-diagnosis.ts
// writes: none

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bug, said } from "../lib/bug_house.mjs";
import { MINUTE, NODE, check, overviewOf, redWatchHouse, ticketLines } from "../lib/red_watch_house.mjs";

const DONE_KEY = "shadow-connector/diagnosed";
const RUNNING_KEY = "shadow-connector/still-looking";
const SUMMARY = "The Gemini key was rotated and the connector still holds the old one.";
const FIX = { name: "Reload the key", cmd: "systemctl restart shadow-connector" };

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  let w: any;
  try {
    w = await redWatchHouse(t, "red-diagnosed");
  } catch (error) {
    return cannotRun(`the scratch red watch would not start: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
  }
  const T = Date.now();
  const since = T - 61 * MINUTE;
  try {
    const result = w.db.prepare("INSERT INTO results (node, check_key, at, status, value, kind) VALUES (?, ?, ?, ?, ?, 'change')");
    const diagnosis = w.db.prepare(
      "INSERT INTO diagnoses (id, node, check_key, asked_by, model, started_at, ended_at, status, summary, proposal)"
      + " VALUES (?, ?, ?, 'case', 'case-model', ?, ?, ?, ?, ?)");
    for (const key of [DONE_KEY, RUNNING_KEY]) {
      result.run(NODE, key, since - 60 * MINUTE, "ok", "200");
      result.run(NODE, key, since, "failing", "down");
    }
    diagnosis.run("case-done", NODE, DONE_KEY, T - 30 * MINUTE, T - 25 * MINUTE, "done", SUMMARY, JSON.stringify(FIX));
    diagnosis.run("case-running", NODE, RUNNING_KEY, T - 5 * MINUTE, null, "running", null, null);
  } catch (error) {
    return cannotRun(`the scratch Cerberus store would not take the trouble's rows: ${String((error as Error)?.message ?? error)}`);
  }

  w.tick(overviewOf(T, [
    check({ key: DONE_KEY, label: "Diagnosed", status: "failing", since, value: "down" }),
    check({ key: RUNNING_KEY, label: "Still looking", status: "failing", since, value: "down" }),
  ]));
  const lines = await ticketLines(w, 2);
  if (lines.length !== 2 || !lines.every((l: string) => l.includes("FILED ticket"))) {
    return broken(`the tick did not file its two red checks: ${JSON.stringify(lines)}`);
  }
  const listed = await bug(w.house, ["list", "--json"]);
  if (listed.code !== 0) return cannotRun(`bug list would not answer — ${said(listed)}`);
  const tickets: any[] = JSON.parse(listed.out || "[]");
  const of = (key: string) => tickets.find((x) => (x.keys ?? []).includes(`check:${NODE}/${key}`));
  const done = of(DONE_KEY);
  const running = of(RUNNING_KEY);

  const wrong: string[] = [];
  if (!done || !running) return broken(`the line holds tickets for ${JSON.stringify(tickets.map((x) => x.keys))}, not both checks`);
  if (!done.words.includes(`Likely cause: ${SUMMARY}`)) wrong.push(`the diagnosed check's words lack 'Likely cause: <summary>': ${JSON.stringify(done.words)}`);
  if (!done.words.includes(`Proposed fix: ${FIX.name} — ${FIX.cmd}`)) wrong.push(`the diagnosed check's words lack 'Proposed fix: <name> — <cmd>': ${JSON.stringify(done.words)}`);
  if (running.words.includes("Likely cause")) wrong.push(`a running diagnosis put a cause in the ticket: ${JSON.stringify(running.words)}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("the diagnosed check's ticket carried its Likely cause and Proposed fix with pages halted; the check whose diagnosis is still running carried no cause");
});
