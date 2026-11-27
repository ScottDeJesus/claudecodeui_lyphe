// protects: server/modules/accounts/accounts-lanes.ts, server/shared/paced-hint.service.ts, server/modules/websocket/services/lane-watch.service.ts, server/modules/websocket/services/websocket-state.service.ts
// writes: none
//
// pollers-hooks--client-pushes, seam 8: the accounts lane's store-watch poke tells a paced accounts_changed ({ kind, at }, at
// most one per 2 s, the last tell always sent) to every open socket, and pokes the usage lane only while a socket watches
// accounts_usage, so no socket watching means no read of the vendor. The meter's read is seen as its touch of a scratch
// login's files (no credentials file: each read is a quick degraded one, nothing leaves the box); the store watch is a stand-in.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = "/home/lyphe/.claude/claudecodeui_lyphe";
const LANES = REPO + "/server/modules/accounts/accounts-lanes.ts";
const WEBSOCKET = REPO + "/server/modules/websocket/index.ts";
const PREFIX = "case-accounts-hint-";
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
  r.poke(); r.poke(); r.poke();
  await sleep(300);
  const first = r.kinds("accounts_changed");
  if (first.length !== 1) return broken("three pokes in one breath sent " + first.length + " accounts_changed at once, not 1");
  const keys = Object.keys(first[0]).sort().join(",");
  if (keys !== "at,kind" || typeof first[0].at !== "number") return broken("accounts_changed carried " + JSON.stringify(first[0]) + ", not { kind, at } alone");
  await sleep(2300);
  const told = r.kinds("accounts_changed").length;
  if (told !== 2) return broken(told + " accounts_changed across 2.6 s of a three-poke burst, not one at once and one at the end of the gap");
  if (r.kinds("accounts_usage_state").length > 0) return broken("a poke with no socket watching sent accounts_usage_state");
  if (r.reads.length > 0) return broken("with no socket watching, a poke read the usage meter: " + r.reads[0]);
  r.watch("watch.start");
  const framed = await r.waitFor("accounts_usage_state", 1, 8000);
  if (r.reads.length === 0) return cannotRun("the first watcher's reading touched nothing of the scratch login, so this case cannot see a read of the meter");
  if (!framed) return broken("the first watch.start read the meter but sent no accounts_usage_state within 8 s");
  r.watch("watch.stop");
  await sleep(300);
  const before = r.reads.length;
  r.poke();
  await sleep(1500);
  if (r.reads.length !== before) return broken("after the last watcher left, a poke read the meter again: " + r.reads[before]);
  return held("one accounts_changed at once and one trailing for a three-poke burst, { kind, at } alone; no meter read and no accounts_usage_state while unwatched, one read and frame for the first watcher, none after it left");
});
