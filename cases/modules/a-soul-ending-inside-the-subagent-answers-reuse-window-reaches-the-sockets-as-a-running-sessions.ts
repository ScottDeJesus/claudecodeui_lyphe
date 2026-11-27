// protects: server/modules/providers/services/running-sessions.lane.ts, server/modules/providers/services/session-subagent-runs.service.ts
// writes: none
// The running sessions are told, never polled (pollers-hooks--client-pushes, seam 7), so the last poke of a change must be read
// fresh: no clock comes after it. The subagent pass reuses its answer for ANSWER_TTL_MS, stamped when the pass ENDS; a poke the
// lane replays after a reading, or one that lands just after it, is answered from that reuse and the change it announced never
// reaches a socket. Here a soul launched by a conversation is staged on a scratch soul tree (DISPATCH_SOULS_STATE_DIR) with a
// live child carrying the launcher's needle; the lane is seen to name the conversation in subagentSessionIds; then the soul's
// receipt lands and the launcher's change is announced at once, as dispatch-souls.module.ts does when a soul ends. The database
// and the tree are scratch, the socket is a stand-in in the real registry, the child is the case's own and is killed at the end.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const KIND = "running_sessions_state";
const CHILD_NEEDLE = "claude";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const load = (relative: string) => import(pathToFileURL(path.join(REPO, relative)).href);
const firstLine = (error: unknown) => String((error as Error)?.message ?? error).split("\n")[0];

async function waitFor(test: () => boolean, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (!test() && Date.now() < until) await sleep(25);
}

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const dir: string = await scratchDir(t, "running-sessions-soul-end");
  process.env.DATABASE_PATH = path.join(dir, "auth.db");
  fs.writeFileSync(process.env.DATABASE_PATH, "");
  const souls = path.join(dir, "souls");
  fs.mkdirSync(souls);
  process.env.DISPATCH_SOULS_STATE_DIR = souls;
  const database: any = await load("server/modules/database/index.ts");
  await database.initializeDatabase();

  const state: any = await load("server/modules/websocket/services/websocket-state.service.ts");
  const heard: any[] = [];
  const socket = {
    readyState: state.WS_OPEN_STATE,
    send: (text: string) => {
      try {
        const frame = JSON.parse(text);
        if (frame?.kind === KIND) heard.push(frame);
      } catch { /* not a frame this case reads */ }
    },
  };
  state.connectedClients.add(socket);
  t.defer(() => state.connectedClients.delete(socket));

  let laneModule: any;
  let changes: any;
  try {
    laneModule = await load("server/modules/providers/services/running-sessions.lane.ts");
    changes = await load("server/modules/dispatch-souls/soul-launch-changes.ts");
  } catch (error) {
    return broken("the running-sessions lane or the launcher's change seam would not load: " + firstLine(error));
  }
  if (typeof laneModule.createRunningSessionsLane !== "function") return broken("running-sessions.lane.ts exports no createRunningSessionsLane");
  if (typeof changes.announceSoulLaunchesChanged !== "function") return broken("soul-launch-changes.ts exports no announceSoulLaunchesChanged");

  const conversation = randomUUID();
  const now = new Date().toISOString();
  try {
    // The scratch database holds no project row for the scratch folder; the row stands alone, as the running list allows.
    database.getConnection().exec("PRAGMA foreign_keys = OFF");
    database.getConnection()
      .prepare("INSERT INTO sessions (session_id, provider, project_path, custom_name, isArchived, created_at, updated_at) VALUES (?, 'claude', ?, 'case: soul end', 0, ?, ?)")
      .run(conversation, dir, now, now);
  } catch (error) {
    return cannotRun("could not stage the conversation's row: " + firstLine(error));
  }

  const child = spawn("/bin/sh", ["-c", "sleep 120; : " + CHILD_NEEDLE], { stdio: "ignore" });
  t.defer(() => { try { child.kill(); } catch { /* already gone */ } });
  const launch = path.join(souls, "dispatch-hephaestus-" + Date.now() + "-case");
  fs.mkdirSync(launch);
  fs.writeFileSync(path.join(launch, "spec.json"), JSON.stringify({ launched_by: conversation, started_at: Date.now() / 1000, model: "claude-case-model", soul: "hephaestus" }));
  fs.writeFileSync(path.join(launch, "child.pid"), String(child.pid));

  const lane = laneModule.createRunningSessionsLane();
  lane.start();
  t.defer(() => lane.stop());
  const namesIt = (frame: any) => Array.isArray(frame.subagentSessionIds) && frame.subagentSessionIds.includes(conversation);

  // The lane's first reading names the soul; the frame lands the moment that pass does, so what follows is inside its reuse.
  await waitFor(() => heard.some(namesIt), 6000);
  if (!heard.some(namesIt)) return cannotRun("the staged soul was never read as out: no running_sessions_state named its conversation in subagentSessionIds");

  // The soul ends: its receipt lands, its child exits, and the launcher announces the change — at once, as it does.
  fs.writeFileSync(path.join(launch, "result.json"), JSON.stringify({ status: "done", ended_at: Date.now() / 1000 }));
  try { child.kill(); } catch { /* already gone */ }
  const before = heard.length;
  changes.announceSoulLaunchesChanged();
  await waitFor(() => heard.slice(before).some((frame) => !namesIt(frame)), 6000);
  if (!heard.slice(before).some((frame) => !namesIt(frame))) {
    return broken("a soul's end, announced just after the pass that saw it out, reached no socket in six seconds: the last running_sessions_state still names its conversation with an agent out");
  }
  return held("the soul's end, announced inside the subagent answer's reuse window, reached the socket as a running_sessions_state without its conversation");
});
