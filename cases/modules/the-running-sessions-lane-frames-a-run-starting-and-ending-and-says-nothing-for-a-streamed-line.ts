// protects: server/modules/providers/services/running-sessions.lane.ts, server/modules/providers/services/sessions.service.ts, server/modules/websocket/services/chat-run-registry.service.ts, server/modules/websocket/services/websocket-state.service.ts, server/shared/polled-lane.service.ts
// writes: none
// The running sessions are told, never polled (pollers-hooks--client-pushes, seam 7): the lane reads the answer of
// GET /api/providers/sessions/running when a run moves and sends it to every open socket as running_sessions_state. A run
// starting sends one frame naming it, a streamed line (onRunChanged with states false) sends none, its completion sends one
// that no longer names it, and a lane nobody pokes sends nothing (backstopMs null). The database is a scratch one; the
// socket is a stand-in in the real registry and the run is the registry's own, both gone when the case ends.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const LANE = path.join(REPO, "server/modules/providers/services/running-sessions.lane.ts");
const KIND = "running_sessions_state";
const FRAME_KEYS = "at,awaitingInputSessionIds,kind,sessions,subagentModels,subagentSessionIds";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const load = (relative: string) => import(pathToFileURL(path.join(REPO, relative)).href);
const firstLine = (error: unknown) => String((error as Error)?.message ?? error).split("\n")[0];

async function waitFor(test: () => boolean, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (!test() && Date.now() < until) await sleep(25);
}

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const dir: string = await scratchDir(t, "running-sessions-lane");
  process.env.DATABASE_PATH = path.join(dir, "auth.db");
  fs.writeFileSync(process.env.DATABASE_PATH, "");
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
  try {
    laneModule = await import(pathToFileURL(LANE).href);
  } catch (error) {
    return broken("the running-sessions lane would not load: " + firstLine(error));
  }
  if (typeof laneModule.createRunningSessionsLane !== "function" || typeof laneModule.readRunningSessions !== "function") {
    return broken("running-sessions.lane.ts exports no createRunningSessionsLane and readRunningSessions");
  }
  const { chatRunRegistry }: any = await load("server/modules/websocket/index.ts");

  const appSessionId = randomUUID();
  const now = new Date().toISOString();
  try {
    database.getConnection()
      .prepare("INSERT INTO sessions (session_id, provider, project_path, custom_name, isArchived, created_at, updated_at) VALUES (?, 'claude', ?, 'case: running sessions lane', 0, ?, ?)")
      .run(appSessionId, dir, now, now);
  } catch { /* the running list names a run with no row of its own as well */ }

  const lane = laneModule.createRunningSessionsLane();
  lane.start();
  t.defer(() => lane.stop());
  await sleep(2500);
  const afterFirst = heard.length;
  await sleep(2000);
  if (heard.length !== afterFirst) return broken("two quiet seconds after the lane's first reading sent " + (heard.length - afterFirst) + " running_sessions_state");
  heard.length = 0;

  const run = chatRunRegistry.startRun({ appSessionId, provider: "claude", providerSessionId: null, connection: null, userId: null });
  if (!run) return cannotRun("chatRunRegistry.startRun answered null for a fresh session id");
  t.defer(() => chatRunRegistry.completeRun(appSessionId, { exitCode: 0 }));
  const names = (frame: any) => Array.isArray(frame.sessions) && frame.sessions.some((s: any) => s?.sessionId === appSessionId);
  const ids = (frame: any) => JSON.stringify((frame.sessions ?? []).map((s: any) => s?.sessionId));

  await waitFor(() => heard.length > 0, 3000);
  if (heard.length === 0) return broken("no running_sessions_state within three seconds of a run starting");
  await sleep(1500);
  if (heard.length !== 1) return broken("a run starting sent " + heard.length + " running_sessions_state, not one");
  if (!names(heard[0])) return broken("the frame sent as the run started does not name it: sessions " + ids(heard[0]));

  const verb = ["send", "sendMessage", "write"].find((name) => typeof run.writer?.[name] === "function");
  if (!verb) return cannotRun("the run's writer has no send verb to stream a line through");
  const seqBefore = run.lastSeq;
  run.writer[verb]({ kind: "text", id: randomUUID(), sessionId: appSessionId, provider: "claude", role: "assistant", content: "a streamed line", timestamp: new Date().toISOString() });
  await sleep(1500);
  if (run.lastSeq === seqBefore) return cannotRun("the writer's " + verb + " recorded no event on the run, so no streamed line was heard");
  if (heard.length !== 1) return broken("a streamed line sent " + (heard.length - 1) + " running_sessions_state");

  chatRunRegistry.completeRun(appSessionId, { exitCode: 0 });
  await waitFor(() => heard.length > 1, 3000);
  if (heard.length === 1) return broken("no running_sessions_state within three seconds of the run completing");
  await sleep(1500);
  if (heard.length !== 2) return broken("the run completing sent " + (heard.length - 1) + " running_sessions_state, not one");
  if (names(heard[1])) return broken("the frame sent at the run's completion still names it");

  const odd = heard.find((frame) => Object.keys(frame).sort().join(",") !== FRAME_KEYS || typeof frame.at !== "number");
  if (odd) return broken("a running_sessions_state is not { kind, at } beside the route's four lists: its keys are " + Object.keys(odd).sort().join(","));
  const { kind: _kind, at: _at, ...body } = heard[1];
  const fresh = await laneModule.readRunningSessions();
  if (JSON.stringify(body) !== JSON.stringify(fresh)) return broken("the last frame's lists differ from readRunningSessions(): " + JSON.stringify(body).slice(0, 160) + " against " + JSON.stringify(fresh).slice(0, 160));
  return held("one frame naming the run at its start, none for its streamed line or two quiet seconds, one without it at its completion; each { kind, at } and the four lists, the last equal to readRunningSessions()");
});
