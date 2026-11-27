// The memory lane speaks from its own writes. With a scratch database and one open socket, staging a
// candidate and then rejecting it each send that socket ONE memory_changed frame whose only keys are kind
// and at, and when each frame is sent the store already holds the row it announces: the hint is told by
// the service after its write returns, never by a route.
//
// protects: server/modules/memory-intake/memory.service.ts, server/shared/paced-hint.service.ts, server/modules/websocket/services/websocket-state.service.ts
// writes: none

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const MEMORY_SERVICE = "../../server/modules/memory-intake/memory.service.ts";
const DATABASE = "../../server/modules/database/index.ts";
const WEBSOCKET = "../../server/modules/websocket/index.ts";
const KIND = "memory_changed";
// Past the hint's own 500 ms gap, so a send it deferred has landed before the count is read.
const SETTLE_MS = 800;
// A frame's at is the wall time of the send; a minute either way is a clock that is not the send's.
const AT_SLACK_MS = 60_000;

type Heard = { keys: string; at: unknown; stored: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One heard frame against the promise; null when it holds. */
function fault(which: string, frame: Heard, wanted: string): string | null {
  if (frame.keys !== "at,kind") return "the " + which + " frame carried the keys " + frame.keys + ", not at and kind alone";
  if (typeof frame.at !== "number" || Math.abs(frame.at - Date.now()) > AT_SLACK_MS) {
    return "the " + which + " frame's at was " + String(frame.at) + ", not the time of the send";
  }
  if (frame.stored !== wanted) return "when the " + which + " frame was sent the store held " + frame.stored + " for the candidate, not " + wanted;
  return null;
}

runCase(async (t: unknown) => {
  const dir = await scratchDir(t, "memory-hint");
  // Set before the database module loads, so the case opens its own file and never the live one.
  process.env.DATABASE_PATH = dir + "/auth.db";
  const database: any = await import(DATABASE);
  await database.initializeDatabase();
  const memory: any = await import(MEMORY_SERVICE);
  const websocket: any = await import(WEBSOCKET);

  const candidates = database.memoryCandidatesDb;
  const realInsert = candidates.insertCandidate;
  let watched: string | null = null;
  // The insert is wrapped only to learn the new row's id, so a frame sent inside the stage can be judged.
  candidates.insertCandidate = function (this: unknown, ...args: unknown[]) {
    const row = realInsert.apply(this, args);
    watched = row?.id ?? null;
    return row;
  };
  const heard: Heard[] = [];
  const socket = {
    readyState: websocket.WS_OPEN_STATE,
    send(text: string) {
      let frame: any = null;
      try {
        frame = JSON.parse(text);
      } catch {
        return;
      }
      if (frame?.kind !== KIND) return;
      const row = watched === null ? null : candidates.getCandidate(watched);
      heard.push({ keys: Object.keys(frame).sort().join(","), at: frame.at, stored: row ? String(row.status) : "nothing" });
    },
  };
  websocket.connectedClients.add(socket);
  try {
    const staged = memory.stageMemoryCandidate(
      { name: "case memory hint", body: "a scratch candidate the case stages and rejects", target: "claude", project: null, indexLine: null, rationale: null, sessionId: null },
      "case",
    );
    await sleep(SETTLE_MS);
    if (heard.length !== 1) return broken("staging a candidate sent " + heard.length + " memory_changed frames to an open socket, not 1");
    const first = fault("staging", heard[0], "pending");
    if (first) return broken(first);

    const reviewed = memory.rejectMemoryCandidate(staged.id);
    if (!reviewed || reviewed.status !== "rejected") return cannotRun("rejecting the scratch candidate answered " + JSON.stringify(reviewed?.status ?? null));
    await sleep(SETTLE_MS);
    if (heard.length !== 2) return broken("rejecting the staged candidate brought the memory_changed frames to " + heard.length + ", not 2");
    const second = fault("review", heard[1], "rejected");
    if (second) return broken(second);
    return held("staging sent one memory_changed {at, kind} with the row pending in the store; rejecting it sent one more with the row rejected");
  } finally {
    websocket.connectedClients.delete(socket);
    candidates.insertCandidate = realInsert;
  }
});
