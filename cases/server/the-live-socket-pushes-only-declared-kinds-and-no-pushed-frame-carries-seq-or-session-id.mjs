// protects: server/modules/websocket/services/websocket-state.service.ts, server/shared/paced-hint.service.ts, server/shared/types.ts, server/modules/accounts/accounts-lanes.ts
// writes: none
//
// THE PUSHED FRAMES KEEP THEIR SHAPE ON THE LIVE SOCKET (pollers-hooks--client-pushes, seam 16; MAN-453). A hint names
// nothing: it is exactly { kind, at } (subagent_transcript_changed adds key and goes only to its watchers), so a tab
// that hears it reads its own route again; a state frame carries at and its route's body; no pushed frame carries seq
// or sessionId, so none becomes a transcript row. The case's own socket, signed in with the checks token, listens 20 s
// after a watch.start of accounts_usage (the usage lane's first watcher starts it; a lane already running sends on its
// own clock), and judges every frame it heard. A kind outside the plan is declared when GatewayEventKind or a typed
// frame under server/shared names it (the station's StationFrame). A watch lives in memory only and ends with the socket.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { api, appSocketUrl } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HINTS = ["memory_changed", "accounts_changed", "drafts_changed", "claude_updates_changed", "cli_version_changed", "heal_changed", "jev_changed", "deepseek_usage_changed", "subagent_transcript_changed"];
const STATES = ["running_sessions_state", "accounts_usage_state", "deepseek_balance_state", "app_release_state"];
const LISTEN_MS = 20000;
const HINT_KEYS = "at,kind";
const KEYED_HINT_KEYS = "at,key,kind";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function gatewayKinds(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith("export type GatewayEventKind"));
  if (start < 0) return null;
  const kinds = new Set();
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const comment = line.startsWith("//") || line.startsWith("/*") || line.startsWith("*");
    if (i > start && !(line.startsWith("|") || comment || line === "")) break;
    if (comment) continue;
    for (const m of line.matchAll(/'([a-z0-9_]+)'/g)) kinds.add(m[1]);
    if (line.endsWith(";")) break;
  }
  return kinds;
}

runCase(async (t) => {
  let text;
  try {
    text = fs.readFileSync(path.join(REPO, "server/shared/types.ts"), "utf8");
  } catch (error) {
    return cannotRun("server/shared/types.ts could not be read: " + String(error));
  }
  const declared = gatewayKinds(text);
  if (!declared) return broken("server/shared/types.ts declares no GatewayEventKind");
  // A frame outside the gateway (the station's StationFrame) is declared by its own type under server/shared.
  const typedFrames = new Set();
  const sharedDir = path.join(REPO, "server/shared");
  for (const name of fs.readdirSync(sharedDir)) {
    if (!name.endsWith(".ts")) continue;
    for (const m of fs.readFileSync(path.join(sharedDir, name), "utf8").matchAll(/kind:\s*'([a-z0-9_]+)'/g)) typedFrames.add(m[1]);
  }
  const identity = await api("/api/auth/user");
  if (identity.status !== 200) return cannotRun("the server answered " + identity.status + " when asked who the checks token is");
  const { default: WebSocket } = await import("ws");
  const socket = new WebSocket(await appSocketUrl());
  t.defer(() => socket.terminate());
  const frames = [];
  let raw = 0;
  socket.on("message", (data) => {
    raw += 1;
    try {
      frames.push(JSON.parse(String(data)));
    } catch {
      // A frame with no JSON form is not this promise's.
    }
  });
  const opened = await new Promise((resolve) => {
    socket.once("open", () => resolve(true));
    socket.once("error", () => resolve(false));
    setTimeout(() => resolve(false), 5000);
  });
  if (!opened) return cannotRun("the app's socket did not open within 5 s");
  socket.send(JSON.stringify({ type: "watch.start", lane: "accounts_usage", key: null }));
  await sleep(LISTEN_MS);
  socket.send(JSON.stringify({ type: "watch.stop", lane: "accounts_usage", key: null }));
  await sleep(200);

  const faults = [];
  const tally = {};
  for (const frame of frames) {
    if (!frame || typeof frame !== "object" || typeof frame.kind !== "string") continue;
    const kind = frame.kind;
    if (/_(?:changed|state)$/.test(kind) && !declared.has(kind) && !typedFrames.has(kind)) faults.push(kind + " reached the socket but is declared neither in GatewayEventKind nor as a typed frame's kind under server/shared");
    if (HINTS.includes(kind)) {
      tally[kind] = (tally[kind] ?? 0) + 1;
      const keys = Object.keys(frame).sort().join(",");
      const want = kind === "subagent_transcript_changed" ? KEYED_HINT_KEYS : HINT_KEYS;
      if (keys !== want) faults.push(kind + " carries {" + keys + "}, not {" + want + "}");
      if (typeof frame.at !== "number") faults.push(kind + " carries no numeric at");
    }
    if (STATES.includes(kind)) {
      tally[kind] = (tally[kind] ?? 0) + 1;
      if ("seq" in frame || "sessionId" in frame) faults.push(kind + " carries seq or sessionId");
      if (typeof frame.at !== "number") faults.push(kind + " carries no numeric at");
    }
  }
  if (faults.length > 0) return broken([...new Set(faults)].join("; "));
  if (raw === 0) return cannotRun("the socket carried no frame in " + LISTEN_MS / 1000 + " s");
  const judged = Object.values(tally).reduce((sum, n) => sum + n, 0);
  if (judged === 0) return cannotRun("the socket carried " + raw + " frames in " + LISTEN_MS / 1000 + " s and none of the plan's thirteen kinds, even after watch.start of accounts_usage: nothing to judge");
  return held(judged + " frames of the plan's kinds in " + LISTEN_MS / 1000 + " s, each in its shape and declared: " + JSON.stringify(tally));
});
