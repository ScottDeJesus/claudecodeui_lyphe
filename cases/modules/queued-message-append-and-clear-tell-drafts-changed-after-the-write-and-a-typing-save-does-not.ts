// The queued message speaks from its own writes. With the user service on stub stores: a typing save of
// the draft's text tells nothing; appending a queued message tells drafts_changed once, after the store's
// append returns; a clear that removed nothing tells nothing, and one that removed a message tells once.
// The user module wires the real tell, and it reaches an open socket as one frame of kind and at alone.
//
// protects: server/modules/user/user.service.ts, server/modules/user/user.module.ts, server/modules/user/drafts-hint.service.ts, server/shared/paced-hint.service.ts
// writes: none

import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const USER_SERVICE = "../../server/modules/user/user.service.ts";
const USER_MODULE = "../../server/modules/user/user.module.ts";
const DRAFTS_HINT = "../../server/modules/user/drafts-hint.service.ts";
const DATABASE = "../../server/modules/database/index.ts";
const WEBSOCKET = "../../server/modules/websocket/index.ts";
const KIND = "drafts_changed";
const SCOPE = "case-drafts-hint-scope";
const USER_ID = 1;
// Past the hint's 250 ms gap, so a deferred send has landed before the count is read.
const SETTLE_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t: unknown) => {
  const user: any = await import(USER_SERVICE);
  const calls: string[] = [];
  let removed: unknown = null;
  const service = user.createUserService({
    users: { getGitConfig: () => undefined, updateGitConfig() {}, completeOnboarding() {}, hasCompletedOnboarding: () => false },
    preferences: { getPreferences: () => ({}), savePreferences() {} },
    drafts: {
      getDrafts: () => [],
      saveDraft: () => { calls.push("save-text"); },
      appendQueuedMessage: (_user: number, _scope: string, message: unknown) => {
        calls.push("append");
        return { outcome: "stored", queuedMessage: message, appended: false };
      },
      clearQueuedMessage: () => { calls.push("clear"); return removed; },
      deleteDraft: () => { calls.push("delete"); },
    },
    tellDraftsChanged: () => { calls.push("tell"); },
    readSystemGitConfig: async () => ({ git_name: null, git_email: null }),
    applyGlobalGitConfig: async () => {},
    logInfo() {},
    logError() {},
  });

  const steps: Array<[string, () => unknown, string]> = [
    ["a typing save of the draft's text", () => service.saveDraft(USER_ID, SCOPE, { text: "typing" }), "save-text"],
    ["appending a queued message", () => service.appendQueuedMessage(USER_ID, SCOPE, { content: "queued words" }), "append,tell"],
    ["a clear that removed nothing", () => { removed = null; return service.clearQueuedMessage(USER_ID, SCOPE); }, "clear"],
    ["a clear that removed the message", () => { removed = { content: "queued words", attachments: [] }; return service.clearQueuedMessage(USER_ID, SCOPE); }, "clear,tell"],
  ];
  for (const [what, run, wanted] of steps) {
    calls.length = 0;
    run();
    const got = calls.join(",");
    if (got !== wanted) return broken(what + " made the calls " + (got || "(none)") + ", not " + wanted);
  }

  const moduleText = fs.readFileSync(fileURLToPath(new URL(USER_MODULE, import.meta.url)), "utf8");
  if (!moduleText.includes("tellDraftsChanged")) return broken("user.module.ts hands the service no tellDraftsChanged, so the real tell is never wired");

  const dir = await scratchDir(t, "drafts-hint");
  // Set before the database module loads, so nothing the imports open is the live file.
  process.env.DATABASE_PATH = dir + "/auth.db";
  const database: any = await import(DATABASE);
  await database.initializeDatabase();
  const hint: any = await import(DRAFTS_HINT);
  const websocket: any = await import(WEBSOCKET);
  if (typeof hint.tellDraftsChanged !== "function") return cannotRun("drafts-hint.service.ts exports no tellDraftsChanged");
  const frames: any[] = [];
  const socket = {
    readyState: websocket.WS_OPEN_STATE,
    send(text: string) {
      try {
        const frame = JSON.parse(text);
        if (frame?.kind === KIND) frames.push(frame);
      } catch {
        // not a JSON frame: not ours
      }
    },
  };
  websocket.connectedClients.add(socket);
  try {
    hint.tellDraftsChanged();
    await sleep(SETTLE_MS);
  } finally {
    websocket.connectedClients.delete(socket);
  }
  if (frames.length !== 1) return broken("one tellDraftsChanged sent " + frames.length + " drafts_changed frames to an open socket, not 1");
  const keys = Object.keys(frames[0]).sort().join(",");
  if (keys !== "at,kind" || typeof frames[0].at !== "number") return broken("the drafts_changed frame was " + JSON.stringify(frames[0]) + ", not kind and a numeric at alone");
  return held("typing save and empty clear told nothing; append and a clear that removed told once each, after the write; the wired tell sent one {at, kind} frame");
});
