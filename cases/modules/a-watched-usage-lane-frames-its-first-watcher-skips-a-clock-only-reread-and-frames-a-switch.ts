// protects: server/modules/accounts/accounts-lanes.ts, server/modules/accounts/usage.service.ts, server/shared/polled-lane.service.ts, server/modules/websocket/services/lane-watch.service.ts
// writes: none
//
// pollers-hooks--client-pushes, seam 8: while a socket watches accounts_usage, the usage lane reads the meter on its first
// watcher and on every accounts poke, and frames accounts_usage_state only when the reading moved: a reading that differs
// only in the checkedAt readUsage stamps from the clock is no news, a switch of the login (whose window it is) is. The
// login is a scratch HOME with no credentials file, so each read is a quick degraded one naming the identity's account.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = "/home/lyphe/.claude/claudecodeui_lyphe";
const LANES = REPO + "/server/modules/accounts/accounts-lanes.ts";
const WEBSOCKET = REPO + "/server/modules/websocket/index.ts";
const PREFIX = "case-usage-lane-";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A scratch login: HOME, its identity file and no credentials file, so every meter read is a quick degraded one. */
async function rig(t: any) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX));
  t.defer(() => {
    if (path.basename(scratch).startsWith(PREFIX)) fs.rmSync(scratch, { recursive: true, force: true });
  });
  const home = path.join(scratch, "home");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  const identity = path.join(home, ".claude.json");
  const writeIdentity = (uuid: string) =>
    fs.writeFileSync(identity, JSON.stringify({ oauthAccount: { accountUuid: uuid, emailAddress: uuid + "@example.invalid" } }));
  writeIdentity("case-identity-a");
  fs.writeFileSync(path.join(scratch, "auth.db"), "");
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  process.env.PLAN_RUNNER_CLAUDE_IDENTITY_PATH = identity;
  process.env.PLAN_RUNNER_PACER_HOME = path.join(scratch, "pacer");
  process.env.DATABASE_PATH = path.join(scratch, "auth.db");

  // Every touch of the scratch login is the meter reading: readUsage reads the credentials and the identity on each call.
  const reads: string[] = [];
  const note = (name: string, p: unknown) => {
    if (typeof p === "string" && p.startsWith(home) && /\.credentials\.json|\.claude\.json/.test(p)) reads.push(name + " " + p);
  };
  for (const name of ["readFileSync", "statSync", "existsSync", "openSync", "lstatSync", "accessSync", "readFile", "stat"]) {
    const real = (fs as any)[name];
    (fs as any)[name] = function (p: unknown, ...rest: unknown[]) { note(name, p); return real.call(this, p, ...rest); };
  }
  for (const name of ["readFile", "stat", "access", "open", "lstat"]) {
    const real = (fs.promises as any)[name];
    (fs.promises as any)[name] = function (p: unknown, ...rest: unknown[]) { note("promises." + name, p); return real.call(this, p, ...rest); };
  }
  syncBuiltinESMExports();

  const ws: any = await import(WEBSOCKET);
  const { startAccountsLanes } = await import(LANES);
  const frames: any[] = [];
  const socket = { readyState: ws.WS_OPEN_STATE, send: (s: string) => frames.push(JSON.parse(s)) };
  ws.connectedClients.add(socket);
  t.defer(() => ws.connectedClients.delete(socket));
  const pokes: Array<() => void> = [];
  const storeWatch = {
    attach: (lane: string, poke: () => void) => { if (lane === "accounts") pokes.push(poke); return () => {}; },
    followChains() {}, start() {}, stop() {},
  };
  startAccountsLanes(storeWatch, (message: string) => console.error(message));
  const watch = (type: string) => ws.laneWatch.handle(socket, { type, lane: "accounts_usage", key: null });
  t.defer(() => watch("watch.stop"));
  const kinds = (kind: string) => frames.filter((f) => f && f.kind === kind);
  const waitFor = async (kind: string, n: number, ms: number) => {
    const end = Date.now() + ms;
    while (kinds(kind).length < n && Date.now() < end) await sleep(100);
    return kinds(kind).length >= n;
  };
  reads.length = 0;
  return { pokes, poke: () => pokes.forEach((p) => p()), watch, kinds, waitFor, reads, writeIdentity };
}

runCase(async (t: any) => {
  const r = await rig(t);
  if (r.pokes.length !== 1) return broken("startAccountsLanes attached " + r.pokes.length + " pokes to the store watch's accounts lane, not 1");
  r.watch("watch.start");
  if (!(await r.waitFor("accounts_usage_state", 1, 8000))) {
    if (r.reads.length === 0) return cannotRun("the first watcher read nothing of the scratch login and sent no frame");
    return broken("the first watch.start sent no accounts_usage_state within 8 s");
  }
  const one = r.kinds("accounts_usage_state")[0];
  if (!one.usage || typeof one.usage !== "object" || typeof one.at !== "number") return broken("accounts_usage_state carried " + JSON.stringify(one).slice(0, 160) + ", not { kind, at, usage }");
  if ("seq" in one || "sessionId" in one) return broken("accounts_usage_state carries seq or sessionId");
  const accountA = one.usage.account;
  await sleep(1200);
  const before = r.reads.length;
  r.poke();
  await sleep(1500);
  if (r.reads.length === before) return broken("a poke while a socket watches did not read the meter again");
  const states = r.kinds("accounts_usage_state");
  if (states.length !== 1) {
    const moved = Object.keys(states[1].usage).filter((k) => JSON.stringify(states[1].usage[k]) !== JSON.stringify(one.usage[k]));
    return broken("a re-read that moved only the clock sent a second accounts_usage_state (keys that moved: " + moved.join(",") + ")");
  }
  r.writeIdentity("case-identity-b");
  r.poke();
  if (!(await r.waitFor("accounts_usage_state", 2, 5000))) {
    if (!accountA) return cannotRun("the scratch login's reading names no account, so a switch cannot be told from it");
    return broken("a poke after the login changed sent no fresh accounts_usage_state within 5 s");
  }
  const accountB = r.kinds("accounts_usage_state")[1].usage.account;
  if (accountB === accountA) return broken("the frame after the switch still names account " + JSON.stringify(accountA));
  return held("first watcher framed account " + JSON.stringify(accountA) + "; a clock-only re-read sent nothing; the switch framed " + JSON.stringify(accountB));
});
