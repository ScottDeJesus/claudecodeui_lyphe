// protects: server/modules/accounts/accounts-lanes.ts, server/modules/accounts/usage.service.ts, server/shared/polled-lane.service.ts
// writes: none
//
// pollers-hooks--client-pushes, seam 8 joined in seam 16: a watched usage lane reads the meter on its first watcher, on
// a poke and on its backstop, and a reading another caller took (the route's) pokes it once. A reading the lane took
// itself must not poke it again. On a login whose credentials carry no stamp, readUsage keeps no cache, so a reading
// that pokes its own lane reads again at once, without end, and holds the event loop: the timers stop firing. The login
// is a scratch HOME with no credentials file; the store watch's accounts poke (what a switch sends) starts the reading.
// Each vendor read logs one "[usage] reading the usage window from the provider" line. The case counts them and, at a
// cap, stops the watch from inside the count, so a loop that starves the timers still ends and is judged.
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

const CAP = 25;
const BOUND = 2;

runCase(async (t: any) => {
  let vendorReads = 0;
  let stopLane: (() => void) | null = null;
  const realLog = console.log;
  console.log = (...args: unknown[]) => {
    if (String(args[0]).includes("reading the usage window from the provider")) {
      vendorReads += 1;
      if (vendorReads === CAP && stopLane) stopLane();
      return;
    }
    realLog(...args);
  };
  t.defer(() => { console.log = realLog; });
  const r = await rig(t);
  stopLane = () => r.watch("watch.stop");
  r.watch("watch.start");
  await sleep(1000);
  const before = vendorReads;
  r.poke();
  await sleep(3000);
  r.watch("watch.stop");
  await sleep(200);
  const afterPoke = vendorReads - before;
  if (afterPoke === 0) return cannotRun("the store watch's accounts poke read nothing from the scratch login's meter in 3 s");
  if (vendorReads >= CAP) return broken("one accounts poke on a watched lane made " + afterPoke + " vendor reads before the case stopped the watch at its cap of " + CAP + ": the lane's own reading pokes it again (onVendorReading -> poke -> owed replay -> readUsage), and the 3 s wait could not end while it ran");
  if (afterPoke > BOUND) return broken("one accounts poke on a watched lane made " + afterPoke + " vendor reads in 3 s, more than its reading and one owed replay");
  return held("one accounts poke on a watched lane made " + afterPoke + " vendor read(s) in 3 s on a login with no credentials file, and the lane stopped asking");
});
