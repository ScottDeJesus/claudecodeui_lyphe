// house_live.mjs — what the `house` cases of chain_live share: a scratch user unit, its start stamp, the house's
// Python run as a child, and the review folder a scratch walk's round leaves behind.
//
//   import { userUnit, stamp, python, roundDriver, reviewFolder, liveSection, pause } from "../lib/house_live.mjs";
//
// A unit is a transient user unit (`systemd-run --user --collect`): it has no file on disk, and its stop and
// reset-failed are deferred on `t`, so nothing it is outlives the case. Its name is a literal prefix and this
// process's pid, so two cases running side by side never share one.
//
// Every `systemctl --user` / `systemd-run --user` here runs with `userEnv`: the night's sweep and a detached hand run
// carry no XDG_RUNTIME_DIR, and without it the user manager is unreachable ("Failed to connect to bus: No medium
// found") — the same default chain_live_units.py gives its own calls.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOOKS = path.join(os.homedir(), ".claude", "hooks");
export const REVIEWS = path.join(os.homedir(), ".claude", "state", "pipeline-reviews");
const PREFIX = "case-live-";

export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** This process's environment with XDG_RUNTIME_DIR defaulted to the user's runtime folder, for user systemd. */
export const userEnv = { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}` };

/** The unit's ActiveEnterTimestamp in whole seconds, or null when it has none. */
export function stamp(unit, { user = true } = {}) {
  const found = spawnSync("systemctl", [...(user ? ["--user"] : []), "show", unit, "-p", "ActiveEnterTimestamp",
    "--timestamp=unix", "--value"], { encoding: "utf8", timeout: 30000, env: userEnv });
  const text = String(found.stdout || "").trim().replace(/^@/, "");
  return /^\d+$/.test(text) ? Number(text) : null;
}

/** Start a transient user unit running `sleep`; with `breakFile`, a start after that file exists fails. */
export function userUnit(t, label, { breakFile = null } = {}) {
  const unit = `${PREFIX}${label}-${process.pid}`;
  t.defer(() => {
    spawnSync("systemctl", ["--user", "stop", unit], { timeout: 30000, env: userEnv });
    spawnSync("systemctl", ["--user", "reset-failed", unit], { timeout: 30000, env: userEnv });
  });
  const args = ["--user", `--unit=${unit}`, "--collect", "--quiet"];
  if (breakFile) args.push("-p", `ExecStartPre=/bin/sh -c 'test ! -e ${breakFile}'`);
  execFileSync("systemd-run", [...args, "/bin/sleep", "900"], { encoding: "utf8", timeout: 30000, env: userEnv });
  return unit;
}

/** Run Python with the house's hooks importable; `cwd` is the case's own scratch folder. */
export function python(code, args, { cwd, env = {} }) {
  const found = spawnSync("python3", ["-c", code, ...args], {
    cwd, encoding: "utf8", timeout: 110000,
    env: { ...process.env, PYTHONPATH: HOOKS, ...env },
  });
  return { status: found.status, stdout: String(found.stdout || ""), stderr: String(found.stderr || "") };
}

/** Runs `chain_cases.run_round` for each round named, printing per round what a reviewer and the gate read. */
export const roundDriver = String.raw`
import json, os, sys
from plan_runner.solo import chain_cases
chain = json.loads(sys.argv[1])
seen = []
for n in json.loads(sys.argv[2]):
    error = None
    try:
        line = chain_cases.run_round(chain, n)
    except Exception as exc:
        line, error = None, f"{type(exc).__name__}: {exc}"
    where = chain_cases.round_path(chain, n)
    text = open(where, encoding="utf-8").read() if os.path.exists(where) else None
    gate = [each._asdict() for each in chain_cases.gate(chain, n)]
    seen.append({"round": n, "line": line, "error": error, "file": text, "gate": gate,
                 "has_live": "live" in chain, "live": json.dumps(chain.get("live"), default=str)})
print(json.dumps({"seen": seen, "chain": chain}, default=str))
`;

/** A scratch walk's slug, and the removal of the review folder its rounds write under the house's reviews. */
export function reviewFolder(t, label) {
  const slug = `${PREFIX}${label}-${process.pid}`;
  const folder = path.join(REVIEWS, slug);
  t.defer(() => {
    if (path.dirname(folder) === REVIEWS && path.basename(folder).startsWith(PREFIX)) {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
  return slug;
}

/** The text under a round file's `## Live` heading, up to the next heading; null when it has none. */
export function liveSection(text) {
  if (!text) return null;
  const at = text.search(/^## Live\s*$/m);
  if (at < 0) return null;
  const rest = text.slice(at).split("\n").slice(1);
  const end = rest.findIndex((line) => /^#{1,2} /.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}
