// `chain_live.bring` never raises, and a recipe can never run a line: with LIVE_CONFIG_PATH naming a missing
// file, then a file that is not TOML, then a recipe whose one rule carries keys outside the six (`run`,
// `command`, `exec`, `shell`, each a line that would make a file) for a target that was deleted, each call
// returns a list, the missing and broken recipes bring nothing, and no file of the unknown keys appears.
//
// Each call is its own process, so a recipe read once at import is read anew. Nothing here starts a unit.
//
// protects: /home/lyphe/.claude/hooks/plan_runner/solo/chain_live.py, /home/lyphe/.claude/hooks/plan_runner/solo/chain_live_config.py
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { python } from "../lib/house_live.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const BRING = String.raw`
import json, sys
try:
    from plan_runner.solo import chain_live
    got = chain_live.bring(json.loads(sys.argv[1]), 1)
    print(json.dumps({"ok": isinstance(got, list), "kind": type(got).__name__, "n": len(got) if isinstance(got, list) else None}))
except Exception as exc:
    print(json.dumps({"ok": False, "raised": f"{type(exc).__name__}: {exc}"}))
`;

runCase(async (t) => {
  const dir = await scratchDir(t, "live-recipes");
  const repo = path.join(dir, "repo");
  fs.mkdirSync(path.join(repo, "app"), { recursive: true });
  const target = path.join(repo, "app", "gone.py");
  fs.writeFileSync(target, "x = 1\n");
  fs.unlinkSync(target);                                    // the walk deleted it: it has no mtime
  const marks = ["run", "command", "exec", "shell"].map((key) => [key, path.join(dir, `ran-${key}`)]);
  const rule = marks.map(([key, mark]) => `  ${key} = "touch ${mark}"`).join("\n");
  const recipes = {
    missing: path.join(dir, "no-such-live.toml"),
    "not TOML": path.join(dir, "garbled.toml"),
    "unknown keys": path.join(dir, "unknown.toml"),
  };
  fs.writeFileSync(recipes["not TOML"], "[[repo]\npath = = /opt\n  [[repo.rule]] paths = [\n");
  fs.writeFileSync(recipes["unknown keys"], `[[repo]]\npath = "${repo}"\n  [[repo.rule]]\n  paths = ["app/**"]\n${rule}\n`);
  const chain = { id: "case-live-recipes", slug: "case-live-recipes", flow: "bug", cwd: repo, targets: [{ path: target }] };

  const wrong = [];
  const said = [];
  for (const [label, recipe] of Object.entries(recipes)) {
    const ran = python(BRING, [JSON.stringify(chain)], { cwd: dir, env: { LIVE_CONFIG_PATH: recipe, DISPATCHER_HOME: dir } });
    const last = ran.stdout.trim().split("\n").pop() || "";
    let got;
    try { got = JSON.parse(last); } catch { wrong.push(`${label}: bring printed no answer (exit ${ran.status}: ${ran.stderr.trim().split("\n").pop()})`); continue; }
    if (got.raised) wrong.push(`${label}: bring raised ${got.raised}`);
    else if (!got.ok) wrong.push(`${label}: bring answered a ${got.kind}, not a list`);
    else if (label !== "unknown keys" && got.n !== 0) wrong.push(`${label}: bring brought ${got.n}, not nothing`);
    else said.push(`${label}: ${got.n}`);
  }
  for (const [key, mark] of marks) if (fs.existsSync(mark)) wrong.push(`the rule's ${key} key ran its line`);
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`bring answered a list each time (${said.join(", ")}) and no unknown key ran`);
});
