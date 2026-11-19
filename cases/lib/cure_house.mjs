// cure_house.mjs — a scratch dispatcher home holding one regression suite, for the night's cure as the card line keeps it.
//
//   import { cureHouse, py, seedBreak, PRELUDE } from "../lib/cure_house.mjs";
//   const h = await cureHouse(t, "cure-settle", ["case-a"]);   // a bugHouse (bug_house.mjs) + suite `scratchcure` at h.repo
//   const ids = await seedBreak(h, "case-a", { walk: "chain-x", heldAfter: false });   // held, broken, regression triage
//   const ran = await py(h, PRELUDE + "print(json.dumps({...}))", [arg1]);   // { code, out, err, json } — json is the last line
//
// `dispatch(h, args, { input })` runs `dispatcher <args>` (and so `dispatcher bug …`) the way the wrapper does.
//
// EVERY PATH IS SCRATCH: the home, the plan-runner state and the charters are bug_house's, all under the case's own
// folder, so the operator's store, his walk records and his charters are never read or written. Python runs with `-I`
// and the house's hooks put on its path by PRELUDE; `sys.argv[1:]` are the arguments `py` is handed.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { bugHouse, said } from "./bug_house.mjs";

export const CASES = path.join(os.homedir(), ".claude", "scripts", "cases");
/** The house's hooks the Python of a case imports. `CASE_HOOKS_DIR` names a copy (a tree as it stood before a change),
 *  to show a case fails against it; left unset, the live tree. */
export const HOOKS = process.env.CASE_HOOKS_DIR || path.join(os.homedir(), ".claude", "hooks");
const RUN_TIMEOUT_MS = 90000;

/** Python's opening lines: the house's hooks importable, json/os/sys/time in scope. */
export const PRELUDE = String.raw`
import json, os, sys, time
sys.path.insert(0, os.environ.get("CASE_HOOKS_DIR") or os.path.expanduser("~/.claude/hooks"))
`;

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
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

const DISPATCH = PRELUDE + String.raw`
import runpy
sys.argv = ["dispatcher", *sys.argv[1:]]
runpy.run_module("dispatcher", run_name="__main__", alter_sys=True)
`;

/** `dispatcher <args>` in the scratch home, from HOOKS, as the wrapper script runs python3 -m dispatcher: { code, out, err }. */
export function dispatch(h, args, { input = "" } = {}) {
  return runFile("python3", ["-I", "-c", DISPATCH, ...args], { env: h.env, cwd: h.repo, input });
}

/** `cases <args>` in the scratch home: { code, out, err }. */
export function cases(h, args, { input = "" } = {}) {
  return runFile(CASES, args, { env: h.env, cwd: h.dir, input });
}

/** One python3 -I program in the scratch home: { code, out, err, json } — json is its last stdout line parsed, or null. */
export async function py(h, code, args = [], { env = {} } = {}) {
  const ran = await runFile("python3", ["-I", "-c", code, ...args.map(String)], { env: { ...h.env, ...env }, cwd: h.dir });
  let json = null;
  try { json = JSON.parse(ran.out.trim().split("\n").pop() || ""); } catch { json = null; }
  return { ...ran, json };
}

async function must(ran, what) {
  if (ran.code !== 0) throw new Error(`${what}: ${said(ran)}`);
  return ran;
}

/** A bugHouse whose git folder holds the suite `scratchcure`, one case per name (seedBreak makes it active), and a culprit file `culprit.py`. */
export async function cureHouse(t, label, names) {
  const h = await bugHouse(t, label);
  await must(await cases(h, ["init", h.repo, "--name", "scratchcure", "--command", ".mjs=node"]), "cases init scratchcure");
  for (const name of names) {
    await must(await cases(h, ["add", name, "--suite", h.repo, "--by", "athena-case", "--sentence", "-"],
      { input: `The scratch case ${name} holds when its file says so.\n` }), `cases add ${name}`);
  }
  h.culprit = path.join(h.repo, "culprit.py");
  fs.writeFileSync(h.culprit, "VALUE = 1\n");
  h.sentence = (name) => `The scratch case ${name} holds when its file says so.`;
  h.key = (name) => `case:${h.repo}:${name}`;
  return h;
}

const SEED = PRELUDE + String.raw`
import sqlite3
from dispatcher import store
name, walk, held_after = sys.argv[1], sys.argv[2] or None, sys.argv[3] == "1"
conn = store.connect()
intent = conn.execute("SELECT id, state FROM intents WHERE name = ?", (name,)).fetchone()
with conn:
    if intent["state"] != "active":
        conn.execute("UPDATE intents SET state = 'active' WHERE id = ?", (intent["id"],))
    def run(at, word):
        return conn.execute("INSERT INTO case_runs (intent_id, at, trigger, chain_id, word, saw, exit_code, duration_ms, output) "
                            "VALUES (?, ?, 'nightly', NULL, ?, ?, ?, 5, '')",
                            (intent["id"], at, word, word + " (seeded)", {"held": 0, "broken": 1}[word])).lastrowid
    run("2026-11-17T03:00:00Z", "held")
    broke = run("2026-11-18T03:00:00Z", "broken")
    conn.execute("INSERT INTO case_triage (intent_id, run_id, cause, note, cure, by, at) "
                 "VALUES (?, ?, 'regression', 'seeded: culprit.py changed its value', ?, 'athena-case', '2026-11-18T04:00:00Z')",
                 (intent["id"], broke, walk))
    if held_after:
        run("2026-11-19T03:00:00Z", "held")
print(json.dumps({"intent": intent["id"], "broke": broke}))
`;

/** One case's break: held, broken (triaged a regression naming `walk`, or none), and a held run after when `heldAfter`. */
export async function seedBreak(h, name, { walk = "", heldAfter = false } = {}) {
  const ran = await py(h, SEED, [name, walk, heldAfter ? "1" : "0"]);
  if (ran.code !== 0 || !ran.json) throw new Error(`seeding ${name}'s break: ${said(ran)}`);
  return ran.json;
}
