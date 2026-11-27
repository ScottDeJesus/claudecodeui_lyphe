// protects: server/modules/deepseek/deepseek.module.ts, server/modules/deepseek/deepseek.service.ts, server/modules/deepseek/deepseek.routes.ts
// writes: none
// Every server reading of the DeepSeek balance is broadcast as deepseek_balance_state carrying the body the route
// answers for that same reading, built by the route's own function, not a copy. The real module is created over a
// stand-in vendor (no request leaves the box), a stand-in recorder that notes its calls in a scratch file, and a
// scratch database; its router is mounted on a throwaway listener on 127.0.0.1; one stand-in socket in the real
// registry records what broadcastToAll sends. One GET /balance -> one frame whose keys other than kind and at equal
// the route's JSON, at stamped at the reading, no seq or sessionId, and the recorder still handed the reading.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const MODULE = "../../server/modules/deepseek/deepseek.module.ts";
const STATE = "../../server/modules/websocket/services/websocket-state.service.ts";
const KIND = "deepseek_balance_state";
const VENDOR = "https://api.deepseek.com/";
const SCRATCH_PREFIX = "case-deepseek-balance-";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const canon = (value: any): string => JSON.stringify(value, (_key, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), SCRATCH_PREFIX));
  t.defer(() => { if (path.basename(scratch).startsWith(SCRATCH_PREFIX)) fs.rmSync(scratch, { recursive: true, force: true }); });
  const calls = path.join(scratch, "recorder-calls.txt");
  const recorder = path.join(scratch, "deepseek-usage");
  fs.writeFileSync(recorder, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\necho '{}'\n`, { mode: 0o755 });
  process.env.DATABASE_PATH = path.join(scratch, "auth.db");
  process.env.DEEPSEEK_USAGE_BIN = recorder;
  process.env.DEEPSEEK_API_KEY = "sk-case-stand-in";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (String(url).startsWith(VENDOR)) {
      const vendor = { is_available: true, balance_infos: [{ currency: "USD", total_balance: "12.34", granted_balance: "0.00", topped_up_balance: "12.34" }] };
      return new Response(JSON.stringify(vendor), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  t.defer(() => { globalThis.fetch = realFetch; });

  const state: any = await import(STATE);
  const frames: any[] = [];
  const socket = {
    readyState: state.WS_OPEN_STATE,
    send: (s: string) => {
      let body: any;
      try { body = JSON.parse(s); } catch { return; }
      if (body?.kind === KIND) frames.push(body);
    },
  };
  state.connectedClients.add(socket);
  t.defer(() => state.connectedClients.delete(socket));

  const mod: any = await import(MODULE);
  if (typeof mod.createDeepseekModule !== "function") return broken("deepseek.module.ts exports no createDeepseekModule");
  const router = mod.createDeepseekModule();
  const { default: express }: any = await import("express");
  const app = express();
  app.use("/api/deepseek", router);
  const server: any = await new Promise((resolve, reject) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    listening.on("error", reject);
  });
  t.defer(() => new Promise((resolve) => server.close(() => resolve(null))));

  const before = Date.now();
  const answer = await realFetch(`http://127.0.0.1:${server.address().port}/api/deepseek/balance`);
  const body: any = await answer.json().catch(() => null);
  const after = Date.now();
  await sleep(1_000);
  if (answer.status !== 200 || body?.reachable !== true) return cannotRun(`the stand-in vendor's reading did not read as reachable: HTTP ${answer.status} ${JSON.stringify(body)}`);

  const wrong: string[] = [];
  if (frames.length !== 1) wrong.push(`one reading sent ${frames.length} ${KIND} frames, not 1`);
  const frame = frames[0];
  if (frame) {
    const { kind: _kind, at, ...rest } = frame;
    if (typeof at !== "number" || at < before - 5 || at > after + 5) wrong.push(`its at ${at} is not the reading's moment (${before}..${after})`);
    if ("seq" in frame || "sessionId" in frame) wrong.push("the frame carries seq or sessionId");
    if (canon(rest) !== canon(body)) wrong.push(`the frame's body ${canon(rest)} is not the route's ${canon(body)}`);
  }
  const recorded = fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim() : "";
  if (!recorded) wrong.push("the usage recorder was not handed the reading");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`one GET /balance: one ${KIND} frame equal to the route's body ${canon(body)} past kind and at; no seq or sessionId; the recorder handed it`);
});
