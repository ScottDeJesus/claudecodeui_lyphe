// protects: server/modules/providers/services/session-subagent-runs.service.ts, server/modules/providers/services/session-agents.service.ts, server/modules/providers/services/running-sessions.lane.ts
// writes: none
// The running-sessions lane has no clock, so the one change nothing writes (an agent stops being believed out
// RUNNING_BELIEVED_FOR_MS after its launch) is a deadline the lane arms to subagentRunsLapseAt(). After a pass that
// answer is null (no transcript agent believed out) or an instant still ahead: after the pass began and no later than
// the window past its end. An instant already past would arm a timer that fires at once, on every reading. The pass runs
// over a scratch copy of the app database and reads the real transcripts it names, writing none of them.

import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SERVICE = path.join(REPO, "server/modules/providers/services/session-subagent-runs.service.ts");
const load = (relative: string) => import(pathToFileURL(path.join(REPO, relative)).href);
const firstLine = (error: unknown) => String((error as Error)?.message ?? error).split("\n")[0];

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const dir: string = await scratchDir(t, "subagent-lapse");
  const copy = path.join(dir, "auth.db");
  try {
    execFileSync("sqlite3", ["-readonly", path.join(os.homedir(), ".cloudcli", "auth.db"), "VACUUM INTO '" + copy + "'"], { timeout: 60000 });
  } catch (error) {
    return cannotRun("the app database could not be copied: " + firstLine(error));
  }
  process.env.DATABASE_PATH = copy;
  const database: any = await load("server/modules/database/index.ts");
  await database.initializeDatabase();
  const { RUNNING_BELIEVED_FOR_MS }: any = await load("server/modules/providers/services/session-agents.service.ts");

  let runs: any;
  try {
    runs = await import(pathToFileURL(SERVICE).href);
  } catch (error) {
    return broken("session-subagent-runs.service.ts would not load: " + firstLine(error));
  }
  if (typeof runs.subagentRunsLapseAt !== "function") return broken("session-subagent-runs.service.ts exports no subagentRunsLapseAt");

  const began = Date.now();
  const ids = await runs.listSubagentRunningSessionIds();
  const ended = Date.now();
  const lapseAt = runs.subagentRunsLapseAt();
  if (lapseAt === null) return held("after a pass naming " + ids.length + " conversations with agents out, subagentRunsLapseAt() answers null: no transcript agent is believed out");
  if (typeof lapseAt !== "number" || !Number.isFinite(lapseAt)) return broken("subagentRunsLapseAt() answered " + JSON.stringify(lapseAt) + ", neither null nor an instant");
  if (lapseAt <= began) return broken("subagentRunsLapseAt() answered an instant already past: " + new Date(lapseAt).toISOString() + ", the pass began " + new Date(began).toISOString());
  if (lapseAt > ended + RUNNING_BELIEVED_FOR_MS) return broken("subagentRunsLapseAt() answered " + new Date(lapseAt).toISOString() + ", further off than the believed window from the pass's end");
  return held("after a pass naming " + ids.length + " conversations, the lapse is " + Math.round((lapseAt - ended) / 60000) + " min ahead, inside the " + RUNNING_BELIEVED_FOR_MS / 3600000 + " h window");
});
