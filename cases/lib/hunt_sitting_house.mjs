// hunt_sitting_house.mjs — a scratch hunt sitting for `hunt_sitting.start`, `hunt_sitting.settle`, `daemon_hunts` and
// `dispatcher hunt overdue`: marksHouse's scratch home, project and open night, a launch's result.json written where
// `plan_runner.solo.record` reads it, stand-in processes that carry a launch's identity, and a Python child whose
// systemd seams are recorders, so nothing a case runs ever reaches the user manager.
//
//   import { sittingHouse, writeResult, sittingPy, standIn, writePids, alive } from "../lib/hunt_sitting_house.mjs";
//   const house = await sittingHouse(t, "sitting", { tickets: 2 });       // marksHouse + scratch ledger + stand-in CLI
//   await writeResult(house, "dispatch-hunter-case-1", { status: "done" });
//   const ran = await sittingPy(house, "print(json.dumps(CALLS))");        // the STUBS prelude, then the script
//   const proc = standIn(house, "dispatch-hunter-case-1");                 // a process `record.owns` reads as the launch's
//   await writePids(house, "dispatch-hunter-case-1", proc.pid);
//
// THE STUBS. `schedule.systemctl`, `schedule._systemd_run`, `schedule.arm_unit` and `schedule.arm_retry` are replaced in the
// child before any hunt module is imported, each recording its call in `CALLS`; a module that took one of them by name
// at its import takes the recorder. PLAN_RUNNER_CLAUDE_BIN names a scratch stand-in that exits at once, and
// DISPATCHER_SCRATCH_DAEMON is never set, so a kick in the scratch home starts no daemon (`wake.declined`).
// EXECUTE_LEDGER_STATE_DIR is scratch, so a launch `prepare` opens is booked in the scratch ledger, never the live one.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { logPathOf, marksHouse } from "./hunt_marks_house.mjs";
import { py } from "./hunt_map_house.mjs";

export const STUBS = `
import json, os, sys, time
from dispatcher import schedule
CALLS = {"arm_unit": [], "arm_retry": [], "systemctl": [], "systemd_run": []}
class _Done:
    returncode = 0
    stdout = ""
    stderr = ""
def _systemctl(*argv, **kw):
    CALLS["systemctl"].append([str(a) for a in argv])
    return _Done()
def _systemd_run(*argv, **kw):
    CALLS["systemd_run"].append([str(a) for a in argv])
    return _Done()
def _arm_unit(unit_name, home, epoch, *words, env=None):
    CALLS["arm_unit"].append({"unit": str(unit_name), "home": str(home), "epoch": float(epoch), "words": [str(w) for w in words]})
    return unit_name
def _arm_retry(home, verb, target, epoch):
    CALLS["arm_retry"].append({"home": str(home), "verb": str(verb), "target": str(target), "epoch": float(epoch)})
    return "dispatcher-retry-case"
schedule.systemctl = _systemctl
schedule._systemd_run = _systemd_run
schedule.arm_unit = _arm_unit
schedule.arm_retry = _arm_retry
def stopped_overdue():
    """Did any recorded systemctl call stop a hunt-overdue unit — the disarm, whatever door said it."""
    return any(any("hunt-overdue-" in a for a in call) for call in CALLS["systemctl"])
def load_sitting():
    """hunt_sitting, or a sentence saying why it cannot be imported."""
    try:
        from dispatcher import hunt_sitting
        return hunt_sitting, None
    except Exception as exc:
        return None, f"hooks/dispatcher/hunt_sitting.py cannot be imported: {type(exc).__name__}: {exc}"
`;

/** marksHouse, plus a scratch ledger root and a stand-in Claude CLI that exits at once. */
export async function sittingHouse(t, label, options = {}) {
  const house = await marksHouse(t, label, options);
  const ledger = path.join(house.dir, "ledger");
  fs.mkdirSync(ledger, { recursive: true });
  const bin = path.join(house.dir, "claude-stand-in");
  fs.writeFileSync(bin, "#!/bin/sh\necho '{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"stand-in\"}'\nexit 0\n");
  fs.chmodSync(bin, 0o755);
  delete house.env.DISPATCHER_SCRATCH_DAEMON;
  Object.assign(house.env, { EXECUTE_LEDGER_STATE_DIR: ledger, PLAN_RUNNER_CLAUDE_BIN: bin });
  return house;
}

/** The STUBS prelude, then `script`, in a child Python of the scratch home; `json` is its last line. */
export function sittingPy(house, script, args = []) {
  return py(house, STUBS + script, args);
}

/** Write a launch's result.json (and make its folder) where `record.read_result` reads it. */
export async function writeResult(house, launchId, result) {
  const file = path.join(path.dirname(await logPathOf(house, launchId)), "result.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(result));
  return file;
}

/** Write both pid files of a launch naming `pid` (a number this case started). */
export async function writePids(house, launchId, pid) {
  const dir = path.dirname(await logPathOf(house, launchId));
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ["launcher.pid", "child.pid"]) fs.writeFileSync(path.join(dir, name), `${pid}\n`);
}

/**
 * A stand-in for a launch's process, in a process group of its own: argv carries `soul-run <launchId>` as its own
 * entries and its environment `PLAN_RUNNER_RUN_ID=<launchId>`, so `record.owns` reads it as that launch's under either
 * pid file. With `identity: false` it carries neither, and is a stranger. It forks one `sleep` into its own group and
 * prints that pid as its first line (`grandchild` resolves to it).
 */
export function standIn(house, launchId, { identity = true } = {}) {
  const code = "import subprocess, sys, time\np = subprocess.Popen(['sleep', '300'])\nprint(p.pid, flush=True)\ntime.sleep(300)";
  const env = { ...house.env };
  delete env.PLAN_RUNNER_RUN_ID;
  if (identity) env.PLAN_RUNNER_RUN_ID = launchId;
  const args = identity ? ["-c", code, "soul-run", launchId] : ["-c", code];
  const proc = spawn("python3", args, { env, detached: true, stdio: ["ignore", "pipe", "ignore"] });
  proc.ended = new Promise((resolve) => proc.on("exit", (exitCode, signal) => resolve({ exitCode, signal })));
  proc.grandchild = new Promise((resolve) => {
    let text = "";
    proc.stdout.on("data", (b) => {
      text += b;
      const m = text.match(/^(\d+)\n/);
      if (m) resolve(Number(m[1]));
    });
    proc.on("exit", () => resolve(null));
  });
  return proc;
}

/** Is `pid` a live process — not gone and not a zombie? Read from /proc, never by a signal. */
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch {
    return false;
  }
}

/** End a stand-in this case started, and its sleep — each checked first to be the very process it started. */
export async function endStandIn(proc) {
  const g = await Promise.race([proc.grandchild, new Promise((r) => setTimeout(() => r(null), 100))]);
  if (Number.isInteger(g) && g > 1 && alive(g)) {
    const cmd = fs.readFileSync(`/proc/${g}/cmdline`, "utf8").split("\0");
    if (cmd[0] === "sleep" && cmd[1] === "300") process.kill(g, "SIGKILL");
  }
  if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
}

/** Wait until `test()` is true, at most `ms`; answers its last value. */
export async function until(test, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await test();
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}
