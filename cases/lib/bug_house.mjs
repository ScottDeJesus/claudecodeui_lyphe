// bug_house.mjs — a scratch dispatcher home for the house's ticket line, the bug command run in it, and its store read.
//
//   import { bugHouse, bug, rows, exec, said } from "../lib/bug_house.mjs";
//   const house = await bugHouse(t, "tickets", { perSession: 3 });   // home, a git folder, a bugs charter, its env
//   const ran = await bug(house, ["file", "--title", "T"], { input: "words" });  // { code, out, err }
//   const tickets = await rows(house, "SELECT * FROM tickets");
//
// EVERY PATH IS SCRATCH. `DISPATCHER_HOME`, `PLAN_RUNNER_STATE_DIR`, `BUGS_CONFIG_PATH` and `CARDS_CONFIG_PATH` all name
// files under the case's own scratch folder, so the operator's store and his charters are never read or written —
// the environment a soul runs a case in names the LIVE dispatcher home, and this file is what keeps a case off it.
// The reporter's identity is the case's too: `PLAN_RUNNER_CHILD`, `CLAUDE_CODE_AGENT`, `PLAN_RUNNER_RUN_ID` and
// `DISPATCHER_SESSION` are dropped and `CLAUDE_CODE_SESSION_ID` is a made-up id, so a filing reads as a chat's unless
// the case says otherwise (`env` on each call).
//
// The bug command is run through its wrapper, `~/.claude/scripts/bug`, exactly as CloudCLI and a chat run it. A
// wrapper that is not there answers code null and the spawn's own sentence in `err`.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { scratchDir } from "./scratch.mjs";

const RUN_TIMEOUT_MS = 60000;
export const BUG = path.join(os.homedir(), ".claude", "scripts", "bug");
export const DISPATCHER = path.join(os.homedir(), ".claude", "scripts", "dispatcher");
const DROPPED = ["PLAN_RUNNER_CHILD", "CLAUDE_CODE_AGENT", "PLAN_RUNNER_RUN_ID", "DISPATCHER_SESSION"];

function runFile(file, args, { env, cwd, input = "" }) {
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
    child.stdin.on("error", () => {}); // a command that exits before reading its stdin is not a fault here
    child.stdin.end(input);
  });
}

/**
 * A scratch home, a scratch git work tree (`repo`), a folder outside git (`loose`), and a bugs charter naming
 * `per_session` and one service, `scratchsvc`, whose folder is a second git work tree (`svc`).
 */
export async function bugHouse(t, label, { perSession = 20 } = {}) {
  const dir = await scratchDir(t, label);
  const repo = path.join(dir, "repo");
  const svc = path.join(dir, "svc");
  const loose = path.join(dir, "loose");
  for (const folder of [repo, svc, loose]) fs.mkdirSync(folder, { recursive: true });
  for (const folder of [repo, svc]) {
    const init = await runFile("git", ["init", "-q", folder], { env: process.env, cwd: dir });
    if (init.code !== 0) throw new Error(`git init ${folder} failed: ${init.err.trim()}`);
  }
  const charter = path.join(dir, "bugs.toml");
  fs.writeFileSync(charter, `per_session = ${perSession}\n[services]\nscratchsvc = "${svc}"\n`);
  const env = { ...process.env };
  for (const name of DROPPED) delete env[name];
  Object.assign(env, {
    DISPATCHER_HOME: path.join(dir, "home"),
    PLAN_RUNNER_STATE_DIR: path.join(dir, "state"),
    BUGS_CONFIG_PATH: charter,
    CARDS_CONFIG_PATH: path.join(dir, "cards.toml"),
    CLAUDE_CODE_SESSION_ID: `case-session-${path.basename(dir)}`,
  });
  return { dir, repo, svc, loose, charter, env, db: path.join(dir, "home", "dispatcher.db") };
}

/** `bug <args>` from `cwd` (the scratch git folder by default), `env` laid over the house's: { code, out, err }. */
export function bug(house, args, { input = "", env = {}, cwd = house.repo } = {}) {
  return runFile(BUG, args, { env: { ...house.env, ...env }, cwd, input });
}

/** `dispatcher <args>` in the scratch home: { code, out, err }. */
export function dispatcher(house, args) {
  return runFile(DISPATCHER, args, { env: house.env, cwd: house.dir });
}

const SQL = `
import json, sqlite3, sys
db, query, params, write = sys.argv[1], sys.argv[2], json.loads(sys.argv[3]), sys.argv[4] == "1"
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
try:
    if write and params:
        with conn:
            conn.execute(query, params)
        print("[]")
    elif write:
        conn.executescript(query)
        print("[]")
    else:
        print(json.dumps([dict(r) for r in conn.execute(query, params)]))
finally:
    conn.close()
`;

async function sql(db, query, params, write) {
  const ran = await runFile("python3", ["-I", "-c", SQL, db, query, JSON.stringify(params), write ? "1" : "0"],
    { env: process.env, cwd: path.dirname(db) });
  if (ran.code !== 0) throw new Error(ran.err.trim().split("\n").pop() || `python3 exited ${ran.code}`);
  return JSON.parse(ran.out);
}

/** The rows a read of the scratch store answers, each a plain object. */
export function rows(house, query, params = []) {
  return sql(house.db, query, params, false);
}

/** One write (or a script of several) on the scratch store, committed. */
export async function exec(house, query, params = []) {
  await sql(house.db, query, params, true);
}

/** A run said in one line, for a verdict. */
export function said(ran) {
  const text = `${ran.out}${ran.err}`.trim().replace(/\s+/g, " ");
  return `exit ${ran.code}: ${text.slice(0, 240) || "(nothing printed)"}`;
}

/** The lines a run printed on stdout and stderr together that are not blank. */
export function lines(ran) {
  return `${ran.out}\n${ran.err}`.split("\n").map((l) => l.trim()).filter(Boolean);
}
