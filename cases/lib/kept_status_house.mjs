// kept_status_house.mjs — a scratch dispatcher store with one epic and two plans, for the cases of the kept status read.
//
//   import { keptHouse, leafDiff, readJson, said } from "../lib/kept_status_house.mjs";
//   const house = await keptHouse(t, "kept-read", "/home/lyphe/.claude/hooks");   // { dir, home, env, dispatcher(args) }
//
// EVERY PATH IS SCRATCH: DISPATCHER_HOME, PLAN_RUNNER_STATE_DIR, PLAN_RUNNER_PACER_HOME, the epics flag and the ledger all
// sit under the case's scratch folder, and a scratch home is one the keeper's tell and its unit never touch
// (wake.declined), so a keeper run there is the reading process's own. The dispatcher runs as `python3 -m dispatcher`
// with PYTHONPATH the hooks folder the case names (what scripts/dispatcher does), so a copy of a case can point at
// another tree of the hooks.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { scratchDir } from "./scratch.mjs";

const DROPPED = ["PLAN_RUNNER_CHILD", "CLAUDE_CODE_AGENT", "PLAN_RUNNER_RUN_ID", "DISPATCHER_SESSION", "CLAUDE_CODE_SESSION_ID",
  "DISPATCHER_SCRATCH_DAEMON", "DISPATCHER_KEEPER", "PLAN_RUNNER_DEEPSEEK"];
const RUN_TIMEOUT_MS = 90000;
const IGNORED = new Set(["generated_at", "runtime_s"]);

const SEED = [
  "from dispatcher import store, store_arcs, store_write",
  "ST = '2026-11-20T06:00:00Z'",
  "c = store.connect()",
  "with c:",
  "    aid = store_arcs.open_arc(c, 'kept-epic', repo='/tmp', goal='g', architecture='', delivers='', session=None)",
  "    for name, phase in (('kept-done', 'done'), ('kept-open', 'not started')):",
  "        pid = c.execute(\"INSERT INTO plans (name, state, repo, model, arc_id, approved_at, approved_by, paused, created_at, updated_at) VALUES (?, 'loaded', '/tmp', 'claude', ?, ?, 'x', 0, ?, ?)\", (name, aid, ST, ST, ST)).lastrowid",
  "        c.execute(\"INSERT INTO phases (plan_id, key, position, title, goal, assignee, status) VALUES (?, 'p1', 1, 'p1', 'g', 'hephaestus', ?)\", (pid, phase))",
  "    store_write.mark_complete(c, 'kept-done')",
  "c.close()",
].join("\n");

/** Run a file: { code, out, err }; killed past the timeout. */
export function run(file, args, { env, cwd, timeoutMs = RUN_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    const child = spawn(file, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, out, err: err + String(e) }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

/** The first thing a run said, for a verdict line. */
export function said(ran) {
  const first = (ran.err.trim() || ran.out.trim() || "nothing").split("\n")[0];
  return `exit ${ran.code}: ${first.slice(0, 200)}`;
}

/** A kept file parsed, or null when it is not there or is not JSON. */
export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

/** Every leaf path where a and b differ, keys named in `ignore` skipped; at most eight. */
export function leafDiff(a, b, ignore = IGNORED, at = "", found = []) {
  if (found.length >= 8) return found;
  const isObj = (v) => v !== null && typeof v === "object";
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) {
    if (JSON.stringify(a) !== JSON.stringify(b)) found.push(at || "(root)");
    return found;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (ignore.has(key)) continue;
    leafDiff(a[key], b[key], ignore, `${at}/${key}`, found);
  }
  return found;
}

/** A scratch home seeded with the epic kept-epic, its finished plan kept-done and its open plan kept-open. */
export async function keptHouse(t, label, hooks) {
  const dir = await scratchDir(t, label);
  const home = path.join(dir, "home");
  for (const sub of ["home", "pacer", "state", "ledger"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const env = { ...process.env };
  for (const name of DROPPED) delete env[name];
  Object.assign(env, {
    DISPATCHER_HOME: home,
    PLAN_RUNNER_STATE_DIR: path.join(dir, "state"),
    PLAN_RUNNER_PACER_HOME: path.join(dir, "pacer"),
    DISPATCHER_EPICS_FLAG_PATH: path.join(dir, "epics.flag"),
    EXECUTE_LEDGER_STATE_DIR: path.join(dir, "ledger"),
    PYTHONPATH: hooks,
    PYTHONDONTWRITEBYTECODE: "1",
  });
  const seeded = await run("python3", ["-c", SEED], { env, cwd: dir });
  if (seeded.code !== 0) throw new Error(`seeding the scratch store failed, ${said(seeded)}`);
  return { dir, home, env, hooks, dispatcher: (args) => run("python3", ["-m", "dispatcher", ...args], { env, cwd: dir }) };
}
