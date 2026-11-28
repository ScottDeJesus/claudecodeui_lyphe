// protects: server/modules/claude-updates/update-reconciler.wake.ts, server/modules/claude-updates/update-reconciler.states.ts
// writes: none
//
// The reconciler's one timer (claude-updates, pollers-hooks--file-watches seam F) is whatever nextWakeMs names after a
// pass: a deadline no event announces, or nothing. The case runs the real function over a table of jobs and facts and
// judges every answer; the reboot window is the states file's own constant, which the wake rule imports and never
// defines (its one home).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODULE_DIR = path.join(REPO, "server/modules/claude-updates");
const NOW = 1_800_000_000_000;
const OWN_PID = 4242;
const OTHER_PID = 4343;
const HELD_RUNNER = 5151;
const INHERITED_RUNNER = 6161;

function job(state: string, extra: Record<string, unknown> = {}) {
  return {
    id: "case-job",
    kind: "update",
    state,
    startedAt: NOW - 60_000,
    endedAt: null,
    runnerPid: null,
    steps: [{ key: "restart", state: "running", from: "0.0.1", to: "0.0.2", startedAt: NOW - 60_000, endedAt: null, detail: null }],
    restart: { requestedAt: null, requestedBy: null },
    packageFiles: { cleanAtStart: true, hashesAfterInstall: null },
    logTail: [],
    ...extra,
  };
}

const firstLine = (error: unknown) => String((error as Error)?.message ?? error).split("\n")[0];

runCase(async () => {
  let wake: Record<string, any>;
  let states: Record<string, any>;
  try {
    wake = await import(pathToFileURL(path.join(MODULE_DIR, "update-reconciler.wake.ts")).href);
    states = await import(pathToFileURL(path.join(MODULE_DIR, "update-reconciler.states.ts")).href);
  } catch (error) {
    return broken("the wake rule would not load from " + MODULE_DIR + ": " + firstLine(error));
  }
  const source = fs.readFileSync(path.join(MODULE_DIR, "update-reconciler.wake.ts"), "utf8");
  if (/REBOOT_ANSWER_TIMEOUT_MS\s*=/.test(source)) {
    return broken("update-reconciler.wake.ts defines REBOOT_ANSWER_TIMEOUT_MS itself; its one home is update-reconciler.states.ts");
  }
  const window = states.REBOOT_ANSWER_TIMEOUT_MS;
  if (typeof window !== "number") return broken("update-reconciler.states.ts exports no REBOOT_ANSWER_TIMEOUT_MS");
  if (wake.RUNNER_LIVENESS_MS !== 5_000 || wake.PASS_RETRY_MS !== 5_000) {
    return broken("RUNNER_LIVENESS_MS is " + wake.RUNNER_LIVENESS_MS + " and PASS_RETRY_MS " + wake.PASS_RETRY_MS + ", not 5000 and 5000");
  }

  const facts = (over: Record<string, unknown> = {}) => ({
    now: NOW,
    pid: OWN_PID,
    holdsRunnerExit: (pid: number | null) => pid === HELD_RUNNER,
    lastPassThrew: false,
    ...over,
  });
  const ownRequest = (requestedAt: number | null) => ({ restart: { requestedAt, requestedBy: OWN_PID } });
  type Want = number | null | [number, number];
  const rows: [string, unknown, Record<string, unknown>, Want][] = [
    ["no job", null, facts(), null],
    ["no job after a pass that threw", null, facts({ lastPassThrew: true }), null],
    ["a done job", job("done"), facts(), null],
    ["an interrupted job after a pass that threw", job("interrupted"), facts({ lastPassThrew: true }), null],
    ["an installed job", job("installed"), facts(), null],
    ["installing, runner's exit held", job("installing", { runnerPid: HELD_RUNNER }), facts(), null],
    ["installing, runner inherited", job("installing", { runnerPid: INHERITED_RUNNER }), facts(), 5_000],
    ["rolling-back, runner inherited", job("rolling-back", { runnerPid: INHERITED_RUNNER }), facts(), 5_000],
    ["installing, runner held, the last pass threw", job("installing", { runnerPid: HELD_RUNNER }), facts({ lastPassThrew: true }), 5_000],
    ["restarting on our own request 50 s ago", job("restarting", ownRequest(NOW - 50_000)), facts(), [window - 50_000, window - 50_000 + 1]],
    ["restarting on our own request past its window", job("restarting", ownRequest(NOW - window - 10_000)), facts(), [0, 1]],
    ["restarting on another process's request", job("restarting", { restart: { requestedAt: NOW - 50_000, requestedBy: OTHER_PID } }), facts(), null],
    ["restarting with no request recorded", job("restarting", ownRequest(null)), facts(), null],
  ];
  const misses: string[] = [];
  for (const [label, theJob, theFacts, want] of rows) {
    let got: unknown;
    try {
      got = wake.nextWakeMs(theJob, theFacts);
    } catch (error) {
      misses.push(label + ": threw " + firstLine(error));
      continue;
    }
    const ok = Array.isArray(want)
      ? typeof got === "number" && got >= want[0] && got <= want[1]
      : got === want;
    if (!ok) misses.push(label + ": answered " + JSON.stringify(got) + ", wanted " + JSON.stringify(want));
  }
  if (misses.length > 0) return broken(misses.length + " of " + rows.length + " rows: " + misses.join("; "));
  return held("all " + rows.length + " rows answered as the rule says; the reboot window is the states file's " + window + " ms");
});
