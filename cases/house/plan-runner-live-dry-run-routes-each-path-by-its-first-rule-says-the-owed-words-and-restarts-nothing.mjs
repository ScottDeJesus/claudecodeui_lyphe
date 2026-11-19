// `charters/live.toml` as shipped, and `plan-runner live --dry-run` over it. The charter names `eis-app-dev` in
// no rule (MAN-849: :5190 is the operator's session), gives no rule a key outside paths, restart, start, ready,
// owed and scope (no recipe can run a line, INV-11894), and gives /opt/eis-app's rule nothing to restart or start.
// The dry run routes a path by its FIRST matching rule: /opt/shadow-connector/eis_backend/main.py prints one
// line, for eis-app alone, with its two timestamps (the unit's start and the file's edit) — `eis_backend/**`
// wins over `**/*.py`, so shadow-connector is not named for it. A file under /opt/eis-app/src prints one line
// carrying the owed deploy words. Both exit 0, and neither restarts a thing: eis-app and shadow-connector keep
// the ActiveEnterTimestamp they had.
//
// Read only: the charter is read, the live units are only shown.
//
// protects: /home/lyphe/.claude/charters/live.toml, /home/lyphe/.claude/hooks/plan_runner/solo/chain_live.py, /home/lyphe/.claude/hooks/plan_runner/solo/chain_live_config.py, /home/lyphe/.claude/hooks/plan_runner/cmd/
// writes: none

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { python, stamp } from "../lib/house_live.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const CHARTER = path.join(os.homedir(), ".claude", "charters", "live.toml");
const RUNNER = path.join(os.homedir(), ".claude", "scripts", "plan-runner");
const BACKEND = "/opt/shadow-connector/eis_backend/main.py";
const SIX = ["paths", "restart", "start", "ready", "owed", "scope"];
const UNIT = (name) => new RegExp(`(^|[^\\w-])${name}(?![\\w-])`);

const READ_CHARTER = String.raw`
import json, sys, tomllib
with open(sys.argv[1], "rb") as handle:
    found = tomllib.load(handle)
print(json.dumps(found))
`;

function firstFile(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isFile()) return full;
  }
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== "node_modules") {
      const found = firstFile(path.join(folder, entry.name));
      if (found) return found;
    }
  }
  return null;
}

function dryRun(file) {
  const ran = spawnSync(RUNNER, ["live", "--dry-run", file], { encoding: "utf8", timeout: 90000, cwd: os.homedir() });
  return { status: ran.status, lines: String(ran.stdout || "").split("\n").map((line) => line.trim()).filter(Boolean), err: String(ran.stderr || "").trim() };
}

runCase(async (t) => {
  const dir = await scratchDir(t, "live-charter");
  if (!fs.existsSync(BACKEND)) return cannotRun(`${BACKEND} is not on this box`);
  const app = fs.existsSync("/opt/eis-app/src") ? firstFile("/opt/eis-app/src") : null;
  if (!app) return cannotRun("/opt/eis-app/src holds no file");
  const wrong = [];

  if (!fs.existsSync(CHARTER)) wrong.push(`${CHARTER} is not there`);
  else {
    const read = python(READ_CHARTER, [CHARTER], { cwd: dir });
    if (read.status !== 0) wrong.push(`the charter is not TOML: ${read.stderr.trim().split("\n").pop()}`);
    else {
      const charter = JSON.parse(read.stdout);
      for (const repo of charter.repo || []) {
        for (const rule of repo.rule || []) {
          const extra = Object.keys(rule).filter((key) => !SIX.includes(key));
          if (extra.length) wrong.push(`a rule of ${repo.path} carries ${extra.join(", ")}`);
          const units = [...(rule.restart || []), ...(rule.start || [])];
          if (units.includes("eis-app-dev")) wrong.push(`a rule of ${repo.path} names eis-app-dev`);
          if (repo.path === "/opt/eis-app" && units.length) wrong.push(`/opt/eis-app's rule restarts or starts ${units.join(", ")}`);
        }
      }
    }
  }

  const before = { eis: stamp("eis-app", { user: false }), connector: stamp("shadow-connector", { user: false }) };
  const backend = dryRun(BACKEND);
  const owed = dryRun(app);
  const after = { eis: stamp("eis-app", { user: false }), connector: stamp("shadow-connector", { user: false }) };

  if (backend.status !== 0) wrong.push(`live --dry-run ${BACKEND} exited ${backend.status}: ${backend.err.split("\n").pop()}`);
  else if (backend.lines.length !== 1) wrong.push(`live --dry-run ${BACKEND} printed ${backend.lines.length} lines, not one: ${backend.lines.join(" | ").slice(0, 300)}`);
  else {
    const line = backend.lines[0];
    if (!UNIT("eis-app").test(line)) wrong.push(`its line does not name eis-app: ${line}`);
    if ((line.match(/\d{1,2}:\d{2}/g) || []).length < 2) wrong.push(`its line does not carry both timestamps: ${line}`);
    if (/\brestarted\b/.test(line)) wrong.push(`a dry run says restarted: ${line}`);
  }
  if (owed.status !== 0) wrong.push(`live --dry-run ${app} exited ${owed.status}: ${owed.err.split("\n").pop()}`);
  else if (owed.lines.length !== 1 || !/next deploy/.test(owed.lines[0])) wrong.push(`live --dry-run ${app} did not print one owed line: ${owed.lines.join(" | ").slice(0, 300)}`);
  if (before.eis !== after.eis || before.connector !== after.connector) {
    wrong.push(`a dry run moved a unit's start: eis-app ${before.eis} → ${after.eis}, shadow-connector ${before.connector} → ${after.connector}`);
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`charter clean; ${BACKEND} → ${backend.lines[0].slice(0, 140)}; ${path.basename(app)} → owed; no unit restarted`);
});
