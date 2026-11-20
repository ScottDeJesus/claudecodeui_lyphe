// A card walk's closing fix-pass is the last word on the code, and `chain_cases.run_closing` runs the cases once
// more to judge it (`decline_closing` files what it broke). Those cases judge the running system, so the closing
// pass's edit must be live before they run, and the card's `Live:` line (seam 6 reads `chain_live.last`) must say
// what is running now. Round 1 makes the unit live; the closing pass then edits the target; the closing run must
// restart the unit (its start moves past the edit) and leave the newest live list naming it `restarted`.
//
// The recipe is a scratch file named by LIVE_CONFIG_PATH; the unit a transient user unit this case starts and
// stops (scope = "user", no `ready`); the dispatcher store a scratch DISPATCHER_HOME. The round files land under
// the house's reviews in a folder named for this case and this pid, removed at the end.
//
// protects: /home/lyphe/.claude/hooks/plan_runner/solo/chain_live.py, /home/lyphe/.claude/hooks/plan_runner/solo/chain_cases.py, /home/lyphe/.claude/hooks/plan_runner/solo/chain_loop.py
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { pause, python, reviewFolder, roundDriver, stamp, userUnit } from "../lib/house_live.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const closingDriver = String.raw`
import json, sys
from plan_runner.solo import chain_cases, chain_live
chain = json.loads(sys.argv[1])
error = None
try:
    chain_cases.run_closing(chain, 1)
except Exception as exc:
    error = f"{type(exc).__name__}: {exc}"
print(json.dumps({"error": error, "last": [each._asdict() for each in chain_live.last(chain)]}, default=str))
`;

runCase(async (t) => {
  const dir = await scratchDir(t, "live-closing");
  const repo = path.join(dir, "repo");
  fs.mkdirSync(path.join(repo, "app"), { recursive: true });
  fs.mkdirSync(path.join(dir, "home"));
  const unit = userUnit(t, "closing");
  const slug = reviewFolder(t, "closing");
  await pause(1300);
  const target = path.join(repo, "app", "fix.py");
  fs.writeFileSync(target, "print('the fix')\n");
  const recipe = path.join(dir, "live.toml");
  fs.writeFileSync(recipe, `[[repo]]\npath = "${repo}"\n  [[repo.rule]]\n  paths = ["app/**"]\n  restart = ["${unit}"]\n  scope = "user"\n`);
  const env = { DISPATCHER_HOME: path.join(dir, "home"), LIVE_CONFIG_PATH: recipe };
  const chain = { id: slug, slug, flow: "bug", cwd: repo, targets: [{ path: target }] };

  const first = python(roundDriver, [JSON.stringify(chain), "[1]"], { cwd: dir, env });
  if (first.status !== 0) return broken(`round 1's driver exited ${first.status}: ${first.stderr.trim().split("\n").pop()}`);
  const one = JSON.parse(first.stdout);
  const afterRound = stamp(unit);
  if (one.seen[0].error || !one.seen[0].live.includes("restarted")) {
    return broken(`round 1 did not make the unit live first (${one.seen[0].error || one.seen[0].live}), so the closing run cannot be judged`);
  }

  await pause(1300);
  fs.writeFileSync(target, "print('the closing pass')\n");     // the closing fix-pass's edit, after round 1's restart
  const edited = fs.statSync(target).mtimeMs / 1000;

  const second = python(closingDriver, [JSON.stringify(one.chain)], { cwd: dir, env });
  if (second.status !== 0) return broken(`the closing driver exited ${second.status}: ${second.stderr.trim().split("\n").pop()}`);
  const closing = JSON.parse(second.stdout);
  const afterClosing = stamp(unit);

  const wrong = [];
  if (closing.error) wrong.push(`run_closing raised ${closing.error}`);
  if (!(afterClosing !== null && afterClosing > afterRound && afterClosing >= Math.floor(edited))) {
    wrong.push(`the closing run judged the closing pass's edit on a unit that never restarted for it (started ${afterRound}, after the closing run ${afterClosing}, edit at ${Math.floor(edited)})`);
  }
  const named = closing.last.find((each) => each.unit === unit);
  const namedAt = named ? Date.parse(named.at) / 1000 : NaN;
  if (!named || named.action !== "restarted" || !(namedAt >= Math.floor(edited))) {
    wrong.push(`the newest live list the card reads names the unit ${named ? `${named.action} at ${named.at}` : "nowhere"} — before the closing pass's edit`);
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`the closing run restarted the unit for the closing pass's edit (${afterRound} → ${afterClosing}) and the card's live list reads restarted`);
});
