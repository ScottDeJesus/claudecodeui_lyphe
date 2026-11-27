// protects: server/modules/websocket/services/websocket-state.service.ts, server/modules/websocket/index.ts
// writes: none
// broadcastToAll is the one door every server-wide hint frame leaves by (jev_changed, heal_changed and the kinds
// after them): one JSON.stringify, one send to each open socket of connectedClients, a send that throws skipped so
// every other page still gets its frame, a closed socket left alone, and a payload with no JSON form refused
// without a throw. The registry is the real module's; the sockets are stand-ins that record what they were sent,
// removed when the case ends.

import fs from "node:fs";

import { broken, held, runCase } from "../lib/case.mjs";

const BARREL = new URL("../../server/modules/websocket/index.ts", import.meta.url);
const CLOSED_STATE = 3;

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const state: any = await import("../../server/modules/websocket/services/websocket-state.service.ts");
  if (typeof state.broadcastToAll !== "function") return broken("websocket-state.service.ts exports no broadcastToAll");
  const barrel = fs.readFileSync(BARREL, "utf8");
  if (!/export\s*(type\s*)?\{[^}]*\bbroadcastToAll\b[^}]*\}\s*from\s*['"]\.\/services\/websocket-state\.service\.js['"]/.test(barrel)) {
    return broken("server/modules/websocket/index.ts does not export broadcastToAll from ./services/websocket-state.service.js");
  }

  const OPEN = state.WS_OPEN_STATE;
  const got: Record<string, string[]> = { first: [], last: [], closed: [] };
  let throwingAsked = 0;
  const sockets = [
    { readyState: OPEN, send: (s: string) => got.first.push(s) },
    { readyState: OPEN, send: () => { throwingAsked += 1; throw new Error("socket gone mid-send"); } },
    { readyState: OPEN, send: (s: string) => got.last.push(s) },
    { readyState: CLOSED_STATE, send: (s: string) => got.closed.push(s) },
  ];
  for (const socket of sockets) state.connectedClients.add(socket);
  t.defer(() => { for (const socket of sockets) state.connectedClients.delete(socket); });

  const payload = { kind: "case_probe_hint", at: 1764000000000 };
  const realStringify = JSON.stringify;
  let stringified = 0;
  (JSON as any).stringify = function (value: unknown, ...rest: unknown[]) {
    if (value === payload) stringified += 1;
    return (realStringify as any).call(JSON, value, ...rest);
  };
  let threw = "";
  try {
    state.broadcastToAll(payload);
  } catch (error) {
    threw = String((error as Error)?.message ?? error);
  } finally {
    (JSON as any).stringify = realStringify;
  }

  const want = realStringify(payload);
  const wrong: string[] = [];
  if (threw) wrong.push(`broadcastToAll threw: ${threw}`);
  if (stringified !== 1) wrong.push(`JSON.stringify ran ${stringified} times on the payload, not once`);
  if (got.first.length !== 1 || got.first[0] !== want) wrong.push(`the first open socket got ${realStringify(got.first)}`);
  if (throwingAsked !== 1) wrong.push(`the throwing socket was asked ${throwingAsked} times`);
  if (got.last.length !== 1 || got.last[0] !== want) wrong.push(`the open socket after the throwing one got ${realStringify(got.last)}`);
  if (got.closed.length !== 0) wrong.push(`the closed socket got ${got.closed.length} frames`);

  const cyclic: any = { kind: "case_probe_hint" };
  cyclic.self = cyclic;
  const before = got.first.length + got.last.length + got.closed.length;
  try {
    state.broadcastToAll(cyclic);
  } catch (error) {
    wrong.push(`a payload with no JSON form threw: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
  }
  if (got.first.length + got.last.length + got.closed.length !== before) wrong.push("a payload with no JSON form was sent");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("one stringify; both working open sockets got the exact frame once past the throwing one; the closed socket none; a cyclic payload sent nothing and threw nothing");
});
