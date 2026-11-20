// A unit that does not come back refuses the round: a card walk whose target is newer than a user unit that
// will not start again (its ExecStartPre fails once a scratch file exists) has `chain_cases.run_round` return
// without raising, its round file's `## Live` name the unit `failed`, and `chain_cases.gate` answer a Break with
// why "live", the unit as its name and a non-empty `saw` read from that unit's own journal — the line the
// fix-pass is briefed with.
//
// For a user unit the journal is the user's (`journalctl --user -u`); the system journal holds none of its lines.
//
// protects: /home/lyphe/.claude/hooks/plan_runner/solo/chain_live.py, /home/lyphe/.claude/hooks/plan_runner/solo/chain_cases.py, /home/lyphe/.claude/hooks/plan_runner/solo/chain_gate.py, /home/lyphe/.claude/hooks/plan_runner/solo/chain_cases_text.py
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { liveSection, pause, python, reviewFolder, roundDriver, userUnit } from "../lib/house_live.mjs";
import { scratchDir } from "../lib/scratch.mjs";

runCase(async (t) => {
  const dir = await scratchDir(t, "live-failed");
  const repo = path.join(dir, "repo");
  fs.mkdirSync(path.join(repo, "app"), { recursive: true });
  fs.mkdirSync(path.join(dir, "home"));
  const stop = path.join(dir, "will-not-start");
  const unit = userUnit(t, "failed", { breakFile: stop });
  const slug = reviewFolder(t, "failed");
  await pause(1300);
  const target = path.join(repo, "app", "broke.py");
  fs.writeFileSync(target, "raise SystemExit(3)\n");
  fs.writeFileSync(stop, "");                               // from here a start of the unit fails
  const recipe = path.join(dir, "live.toml");
  fs.writeFileSync(recipe, `[[repo]]\npath = "${repo}"\n  [[repo.rule]]\n  paths = ["app/**"]\n  restart = ["${unit}"]\n  scope = "user"\n`);
  const chain = { id: slug, slug, flow: "bug", cwd: repo, targets: [{ path: target }] };

  const ran = python(roundDriver, [JSON.stringify(chain), "[1]"], { cwd: dir, env: { DISPATCHER_HOME: path.join(dir, "home"), LIVE_CONFIG_PATH: recipe } });
  if (ran.status !== 0) return broken(`the driver exited ${ran.status}: ${ran.stderr.trim().split("\n").pop()}`);
  const seen = JSON.parse(ran.stdout).seen[0];

  const wrong = [];
  if (seen.error) wrong.push(`run_round raised ${seen.error}`);
  const live = liveSection(seen.file);
  if (live === null) wrong.push(seen.file === null ? "no round file was written" : "the round file has no ## Live");
  else if (!(live.includes(unit) && /\bfailed\b/.test(live))) wrong.push(`## Live does not name the unit failed: ${live.trim().slice(0, 200)}`);
  const refusal = seen.gate.find((each) => each.why === "live" && each.name === unit);
  if (!refusal) wrong.push(`gate answered no live Break for the unit: ${JSON.stringify(seen.gate).slice(0, 200)}`);
  else if (!String(refusal.saw || "").trim()) wrong.push("the live Break's saw is empty: no journal line reached it");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`failed under ## Live; gate refused with a live Break whose saw is: ${String(refusal.saw).slice(0, 160)}`);
});
