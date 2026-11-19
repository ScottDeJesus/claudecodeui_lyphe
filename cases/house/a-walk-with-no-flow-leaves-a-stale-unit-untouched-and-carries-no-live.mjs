// Only a card walk is made live: a walk record with no `flow` (a phase, an /inline, a heal, the night's cure)
// whose target is newer than a unit its recipe restarts walks exactly as before — `chain_cases.run_round` leaves
// the unit's ActiveEnterTimestamp as it was, adds no "live" key to the record and writes no `## Live`.
//
// The recipe, the unit and the store are scratch, as in the sibling card-walk case; the unit is a transient
// user unit this case starts and stops.
//
// protects: /home/lyphe/.claude/hooks/plan_runner/solo/chain_cases.py, /home/lyphe/.claude/hooks/plan_runner/solo/chain_live.py
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { liveSection, pause, python, reviewFolder, roundDriver, stamp, userUnit } from "../lib/house_live.mjs";
import { scratchDir } from "../lib/scratch.mjs";

runCase(async (t) => {
  const dir = await scratchDir(t, "live-no-flow");
  const repo = path.join(dir, "repo");
  fs.mkdirSync(path.join(repo, "app"), { recursive: true });
  fs.mkdirSync(path.join(dir, "home"));
  const unit = userUnit(t, "noflow");
  const slug = reviewFolder(t, "noflow");
  await pause(1300);
  const target = path.join(repo, "app", "change.py");
  fs.writeFileSync(target, "print('a phase change')\n");
  const recipe = path.join(dir, "live.toml");
  fs.writeFileSync(recipe, `[[repo]]\npath = "${repo}"\n  [[repo.rule]]\n  paths = ["app/**"]\n  restart = ["${unit}"]\n  scope = "user"\n`);
  const chain = { id: slug, slug, cwd: repo, targets: [{ path: target }] };

  const before = stamp(unit);
  const ran = python(roundDriver, [JSON.stringify(chain), "[1]"], { cwd: dir, env: { DISPATCHER_HOME: path.join(dir, "home"), LIVE_CONFIG_PATH: recipe } });
  if (ran.status !== 0) return broken(`the driver exited ${ran.status}: ${ran.stderr.trim().split("\n").pop()}`);
  const seen = JSON.parse(ran.stdout).seen[0];
  const after = stamp(unit);

  const wrong = [];
  if (seen.error) wrong.push(`run_round raised ${seen.error}`);
  if (before === null) wrong.push("the scratch unit never started");
  if (after !== before) wrong.push(`a walk with no flow restarted the unit (${before} → ${after})`);
  if (seen.has_live) wrong.push(`a walk with no flow gained chain["live"] = ${seen.live}`);
  if (liveSection(seen.file) !== null) wrong.push("a walk with no flow wrote ## Live");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`no flow: the stale unit kept its start (${before}), no "live" key, no ## Live`);
});
