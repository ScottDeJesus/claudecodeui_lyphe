// protects: server/modules/dispatch-souls/dispatch-souls.module.ts, server/modules/dispatch-souls/launch-watch.service.ts, server/shared/settled-call.service.ts, server/shared/polled-lane.service.ts
// writes: none
//
// The souls lane (soul_launch_state, the purple dot and the soul pins) reads on a write: the module builds its lane
// with a picture-dependent backstop, settles the launch watch's moves and pokes the lane. This case starts the real
// module over a scratch state root (DISPATCH_SOULS_STATE_DIR, PLAN_RUNNER_PACER_HOME), connects a socket client to the
// websocket fan-out, copies the newest ended launch on the box into the root (its spec.json renamed in, then its
// result.json, each stamped now) and holds the module to a soul_launch_state frame naming that launch within a second of
// each write, and to building its lane with no pollMs, POLL_MS or setInterval.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = "/home/lyphe/.claude/claudecodeui_lyphe";
const MODULE = REPO + "/server/modules/dispatch-souls/dispatch-souls.module.ts";
const WEBSOCKET = REPO + "/server/modules/websocket/index.ts";
const LIVE_SOULS = path.join(os.homedir(), ".claude", "state", "dispatch-souls");
const WITHIN_MS = 1000;
const LOOK_MS = 2500;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const firstLine = (error: any) => String(error && error.message ? error.message : error).split("\n")[0];

/** The newest launch on the box that has both a spec and a receipt: only its two files are copied, never written. */
function newestEndedLaunch(): string | null {
  let best: string | null = null;
  let bestAt = 0;
  for (const name of fs.readdirSync(LIVE_SOULS)) {
    try {
      const at = fs.statSync(path.join(LIVE_SOULS, name, "result.json")).mtimeMs;
      if (at > bestAt && fs.existsSync(path.join(LIVE_SOULS, name, "spec.json"))) {
        best = name;
        bestAt = at;
      }
    } catch {
      // a launch still out has no receipt yet: not one to copy
    }
  }
  return best;
}

function stamped(file: string, keys: string[], nowS: number): string {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const key of keys) if (typeof value[key] === "number") value[key] = nowS;
  return JSON.stringify(value);
}

function putAtomically(file: string, body: string): number {
  const scratch = path.join(path.dirname(file), "." + path.basename(file) + ".tmp");
  fs.writeFileSync(scratch, body);
  const at = Date.now();
  fs.renameSync(scratch, file);
  return at;
}

runCase(async (t: any) => {
  const launchId = newestEndedLaunch();
  if (launchId === null) return cannotRun("no ended launch in " + LIVE_SOULS + " to copy a spec.json and result.json from");
  const source = fs.readFileSync(MODULE, "utf8");
  const root = await scratchDir(t, "souls-frame");
  const souls = path.join(root, "dispatch-souls");
  for (const dir of [souls, path.join(root, "dispatch-chains"), path.join(root, "pacer")]) fs.mkdirSync(dir);
  process.env.DISPATCH_SOULS_STATE_DIR = souls;
  process.env.PLAN_RUNNER_PACER_HOME = path.join(root, "pacer");
  process.env.DATABASE_PATH = path.join(root, "auth.db");

  let websocket: any;
  let soulsModule: any;
  try {
    websocket = await import(WEBSOCKET);
    soulsModule = await import(MODULE);
  } catch (error) {
    return broken("the dispatch-souls module does not load: " + firstLine(error));
  }
  const frames: Array<{ at: number; text: string }> = [];
  websocket.connectedClients.add({
    readyState: websocket.WS_OPEN_STATE,
    send: (message: unknown) => {
      const text = typeof message === "string" ? message : String(message);
      if (text.includes("soul_launch_state")) frames.push({ at: Date.now(), text });
    },
  });
  const frameAfter = async (since: number): Promise<number | null> => {
    const deadline = since + LOOK_MS;
    while (Date.now() < deadline) {
      const hit = frames.find((frame) => frame.at >= since && frame.text.includes(launchId));
      if (hit) return hit.at - since;
      await wait(20);
    }
    return null;
  };

  const wrong: string[] = [];
  const souls_ = soulsModule.createDispatchSoulsModule();
  souls_.start();
  let specMs: number | null = null;
  let resultMs: number | null = null;
  try {
    await wait(800);
    const dir = path.join(souls, launchId);
    const nowS = Date.now() / 1000;
    const specBody = stamped(path.join(LIVE_SOULS, launchId, "spec.json"), ["started_at", "created_at"], nowS);
    const resultBody = stamped(path.join(LIVE_SOULS, launchId, "result.json"), ["ended_at", "finished_at"], nowS + 1);
    fs.mkdirSync(dir);
    specMs = await frameAfter(putAtomically(path.join(dir, "spec.json"), specBody));
    await wait(600);
    resultMs = await frameAfter(putAtomically(path.join(dir, "result.json"), resultBody));
  } finally {
    souls_.stop();
  }
  if (specMs === null) wrong.push("no soul_launch_state frame naming " + launchId + " within " + LOOK_MS + " ms of its spec.json");
  else if (specMs > WITHIN_MS) wrong.push("the frame for spec.json came " + specMs + " ms after it");
  if (resultMs === null) wrong.push("no soul_launch_state frame naming it within " + LOOK_MS + " ms of its result.json");
  else if (resultMs > WITHIN_MS) wrong.push("the frame for result.json came " + resultMs + " ms after it");
  if (/\bPOLL_MS\b|\bpollMs\b|setInterval\(/.test(source)) wrong.push("dispatch-souls.module.ts still builds its lane on a poll (POLL_MS, pollMs or setInterval in its source)");
  if (wrong.length > 0) return broken("the souls lane: " + wrong.join("; "));
  return held("the souls lane: a frame naming " + launchId + " " + specMs + " ms after its spec.json and " + resultMs + " ms after its result.json; the module names no poll");
});
