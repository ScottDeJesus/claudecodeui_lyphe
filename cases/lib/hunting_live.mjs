// hunting_live.mjs — the bug hunters' state as it stands on THIS box, read and never written.
//
//   import { liveEnv, run, liveRows, liveHunt, parseJson, LIVE_STORE, LIVE_BOARD } from "../lib/hunting_live.mjs";
//   const config = parseJson(await liveHunt(["config", "--json"]));           // the live charters/hunts.toml
//   const units = await liveRows(LIVE_STORE, "SELECT * FROM hunt_units WHERE state = ?", ["covered"]);
//
// LIVE ON PURPOSE, READ ONLY. A case started by a soul inherits the soul's environment, which may name a scratch home;
// liveEnv() drops every variable that moves a reader off the live box (DISPATCHER_HOME, HUNTS_CONFIG_PATH,
// PLAN_RUNNER_STATE_DIR, DATABASE_PATH, LAUNCH_TABLE_PATH) and every one that makes a process a hunter, so a verb run
// here reads what the operator's box holds. Each database is opened `mode=ro` through Python's stdlib: no write, no
// journal, no migration. No verb that writes is run from here: `hunt config` is run only with `--json`, and `hunt map`
// writes nothing by its own rule (which the map case checks).

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const RUN_TIMEOUT_MS = 90000;
const MOVED_OFF_LIVE = ["DISPATCHER_HOME", "HUNTS_CONFIG_PATH", "PLAN_RUNNER_STATE_DIR", "DATABASE_PATH", "LAUNCH_TABLE_PATH",
  "DISPATCHER_HUNT_SITTING", "PLAN_RUNNER_HUNT", "BUGS_CONFIG_PATH", "CARDS_CONFIG_PATH"];

export const HOME_CLAUDE = path.join(os.homedir(), ".claude");
export const HOOKS = path.join(HOME_CLAUDE, "hooks");
export const DISPATCHER = path.join(HOME_CLAUDE, "scripts", "dispatcher");
export const LIVE_STORE = path.join(HOME_CLAUDE, "state", "dispatcher", "dispatcher.db");
export const LIVE_BOARD = path.join(os.homedir(), ".cloudcli", "auth.db");

/** The environment with every scratch pointer and hunter mark taken out; `extra` laid over it. */
export function liveEnv(extra = {}) {
  const env = { ...process.env };
  for (const name of MOVED_OFF_LIVE) delete env[name];
  return { ...env, ...extra };
}

/** Run a program: { code, out, err }; code null when it could not start or was killed at the timeout. */
export function run(file, args, { env = liveEnv(), cwd = os.tmpdir(), input = "" } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      resolve({ code: null, out: "", err: String(error?.message ?? error) });
      return;
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), RUN_TIMEOUT_MS);
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { err += b; });
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: null, out, err: `${err}${error.message}` }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** The answer of a `--json` run: the whole stdout, else its last line; null when neither is JSON. */
export function parseJson(ran) {
  for (const text of [ran.out.trim(), ran.out.trim().split("\n").pop()]) {
    try { return JSON.parse(text); } catch { /* try the next reading */ }
  }
  return null;
}

/** The first line of what a run said, for a broken verdict. */
export function said(ran) {
  return `${ran.err}\n${ran.out}`.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? `exit ${ran.code}`;
}

const READ_ROWS = `import json, sqlite3, sys
c = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)
c.row_factory = sqlite3.Row
print(json.dumps([dict(r) for r in c.execute(sys.argv[2], json.loads(sys.argv[3]))]))`;

/** Rows of one query over a database opened read-only; throws with the reader's sentence when it fails. */
export async function liveRows(db, query, params = []) {
  const ran = await run("python3", ["-I", "-c", READ_ROWS, db, query, JSON.stringify(params)]);
  if (ran.code !== 0) throw new Error(`read of ${path.basename(db)} failed — ${said(ran)}`);
  return JSON.parse(ran.out);
}

/** `dispatcher hunt <args>` against the live box. */
export function liveHunt(args) {
  return run(DISPATCHER, ["hunt", ...args]);
}

/** A Python script with the house's hooks importable, run in `env`; its last stdout line parsed as JSON into `json`. */
export async function housePy(script, args = [], { env = liveEnv() } = {}) {
  const prelude = `import sys\nsys.path.insert(0, ${JSON.stringify(HOOKS)})\n`;
  const ran = await run("python3", ["-c", prelude + script, ...args], { env: { ...env, PYTHONDONTWRITEBYTECODE: "1" } });
  let json = null;
  try { json = JSON.parse(ran.out.trim().split("\n").pop()); } catch { /* left null */ }
  return { ...ran, json };
}
