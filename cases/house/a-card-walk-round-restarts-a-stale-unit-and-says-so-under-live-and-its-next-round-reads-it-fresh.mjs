// A card walk makes its fix live before its round is judged: a record carrying `flow = "bug"` whose target was
// edited after the user unit its rule restarts last started has that unit restarted by `chain_cases.run_round`
// (via `chain_live.bring`), keeps `chain["live"]`, and its round file says so under `## Live` as `restarted` —
// though no case covers the target. Round 2, with no edit since, leaves the unit alone and says `fresh`.
//
// The recipe is a scratch file named by LIVE_CONFIG_PATH; the unit a transient user unit this case starts and
// stops (scope = "user", no `ready`, so nothing is fetched); the dispatcher store a scratch DISPATCHER_HOME. The
// round file lands under the house's reviews in a folder named for this case and this pid, removed at the end.
//
// protects: /home/lyphe/.claude/hooks/plan_runner/solo/chain_live.py, /home/lyphe/.claude/hooks/plan_runner/solo/chain_live_config.py, /home/lyphe/.claude/hooks/plan_runner/solo/chain_cases.py, /home/lyphe/.claude/hooks/plan_runner/solo/chain_cases_text.py
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { liveSection, pause, python, reviewFolder, roundDriver, stamp, userUnit } from "../lib/house_live.mjs";
import { scratchDir } from "../lib/scratch.mjs";

runCase(async (t) => {
  const dir = await scratchDir(t, "live-restart");
  const repo = path.join(dir, "repo");
  fs.mkdirSync(path.join(repo, "app"), { recursive: true });
  fs.mkdirSync(path.join(dir, "home"));
  const unit = userUnit(t, "restart");
  const slug = reviewFolder(t, "restart");
  await pause(1300);
  const target = path.join(repo, "app", "fix.py");
  fs.writeFileSync(target, "print('the fix')\n");          // edited after the unit started: the unit is stale
  const recipe = path.join(dir, "live.toml");
  fs.writeFileSync(recipe, `[[repo]]\npath = "${repo}"\n  [[repo.rule]]\n  paths = ["app/**"]\n  restart = ["${unit}"]\n  scope = "user"\n`);
  const env = { DISPATCHER_HOME: path.join(dir, "home"), LIVE_CONFIG_PATH: recipe };
  let chain = { id: slug, slug, flow: "bug", cwd: repo, targets: [{ path: target }] };

  const before = stamp(unit);
  const first = python(roundDriver, [JSON.stringify(chain), "[1]"], { cwd: dir, env });
  if (first.status !== 0) return broken(`round 1's driver exited ${first.status}: ${first.stderr.trim().split("\n").pop()}`);
  const one = JSON.parse(first.stdout);
  const afterOne = stamp(unit);
  chain = one.chain;
  const second = python(roundDriver, [JSON.stringify(chain), "[2]"], { cwd: dir, env });
  if (second.status !== 0) return broken(`round 2's driver exited ${second.status}: ${second.stderr.trim().split("\n").pop()}`);
  const two = JSON.parse(second.stdout);
  const afterTwo = stamp(unit);

  const wrong = [];
  const r1 = one.seen[0];
  const r2 = two.seen[0];
  if (r1.error) wrong.push(`round 1 raised ${r1.error}`);
  if (!(before !== null && afterOne !== null && afterOne > before)) wrong.push(`round 1 did not restart the stale unit (started ${before}, then ${afterOne})`);
  if (!r1.has_live || !r1.live.includes(unit)) wrong.push(`round 1 kept no chain["live"] naming the unit (${r1.live})`);
  const live1 = liveSection(r1.file);
  if (live1 === null) wrong.push(r1.file === null ? "round 1 wrote no round file" : "round 1's round file has no ## Live");
  else if (!(live1.includes(unit) && /\brestarted\b/.test(live1))) wrong.push(`round 1's ## Live does not name the unit restarted: ${live1.trim().slice(0, 200)}`);
  if (afterTwo !== afterOne) wrong.push(`round 2 restarted a unit no edit had made stale (${afterOne}, then ${afterTwo})`);
  const live2 = liveSection(r2.file);
  if (live2 === null) wrong.push("round 2's round file has no ## Live");
  else if (!(live2.includes(unit) && /\bfresh\b/.test(live2))) wrong.push(`round 2's ## Live does not name the unit fresh: ${live2.trim().slice(0, 200)}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`round 1 restarted the stale unit (${before} → ${afterOne}) and said restarted under ## Live; round 2 left it and said fresh`);
});
