// `hooks/dispatcher/hunt_map.py`'s `files(project, lens, config)` is the file map a hunt's pass is made from: every
// file git tracks under the project (`git ls-files -s -- .`), each with its index blob id, or with `git hash-object` of
// the working tree when `git diff --name-only` names it. Left out: symlinks (120000) and gitlinks (160000), files git
// does not track, the config's global excludes AT ANY DEPTH (`**/*.md` takes a root README.md, `**/node_modules/**` a
// root node_modules/ — Python 3.12's fnmatch and PurePath.match both miss the root), the project's own excludes, and
// the files under another listed project's path. `cases/**` is anchored at the project's root, so src/cases/ stays. The
// ui lens takes only its four globs. A tracked file deleted from the working tree (diff names it, hash-object cannot
// read it) does not fault the map. Run over a scratch git project by a child Python importing the module.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_map.py
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { commit, git, gitInit, lastLine, mapHouse, put, py, setProjects } from "../lib/hunt_map_house.mjs";

const SCRIPT = String.raw`
import json
from dispatcher import hunt_config, hunt_map
cfg = hunt_config.read()
out = {}
for name, lens in (("Outer", "code"), ("Outer", "ui"), ("Inner", "code")):
    try:
        units = hunt_map.files(cfg.project(name), lens, cfg)
        out[f"{name}/{lens}"] = [[u.unit, u.folder, u.fingerprint] for u in units]
    except hunt_map.MapFault as e:
        out[f"{name}/{lens}"] = {"fault": str(e)}
print(json.dumps(out))
`;

runCase(async (t) => {
  const house = await mapHouse(t, "hunt-map-files");
  const repo = await gitInit(house, "outer");
  for (const [rel, text] of [
    ["src/a.py", "a = 1\n"], ["src/b.py", "b = 2\n"], ["src/gone.py", "gone = 3\n"],
    ["README.md", "# root\n"], ["src/notes.md", "notes\n"], ["node_modules/x.js", "x\n"], ["src/node_modules/y.js", "y\n"],
    ["cases/c.js", "c\n"], ["src/cases/keep.js", "keep\n"], ["skipme/s.py", "s\n"], ["inner/i.py", "i = 1\n"],
    ["App.tsx", "export {}\n"], ["src/s.css", "a {}\n"],
  ]) put(repo, rel, text);
  fs.symlinkSync("a.py", path.join(repo, "src/link.py"));
  await commit(repo, "one", { daysAgo: 3 });
  const head = (await git(repo, ["rev-parse", "HEAD"])).out.trim();
  const link = await git(repo, ["update-index", "--add", "--cacheinfo", `160000,${head},vendor/sub`]);
  if (link.code !== 0) return broken(`the scratch gitlink could not be made: ${link.err.trim()}`);
  put(repo, "src/a.py", "a = 'changed in the working tree'\n");
  fs.rmSync(path.join(repo, "src/gone.py"));
  put(repo, "src/new.py", "untracked\n");
  setProjects(house, [
    { name: "Outer", path: repo, exclude: ["skipme/**"] },
    { name: "Inner", path: path.join(repo, "inner") },
  ]);

  const blob = {};
  for (const line of (await git(repo, ["ls-files", "-s", "--", "."])).out.trim().split("\n")) {
    const [meta, rel] = line.split("\t");
    blob[rel] = meta.split(" ")[1];
  }
  const worktreeA = (await git(repo, ["hash-object", "src/a.py"])).out.trim();

  const got = await py(house, SCRIPT);
  if (!got.json) return broken(`hunt_map.files could not be run — ${lastLine(got)}`);
  const wrong = [];
  const outer = got.json["Outer/code"];
  if (!Array.isArray(outer)) return broken(`the outer project's code map faulted (a tracked file deleted from the working tree, or a gitlink, must not fault it): ${outer?.fault}`);
  const units = new Map(outer.map(([unit, folder, fp]) => [unit, { folder, fp }]));
  const want = ["src/a.py", "src/b.py", "src/cases/keep.js", "App.tsx", "src/s.css"];
  for (const unit of want) if (!units.has(unit)) wrong.push(`${unit} is missing`);
  for (const unit of units.keys()) if (!want.includes(unit) && unit !== "src/gone.py") wrong.push(`${unit} is in the map`);
  if (outer.length !== units.size) wrong.push(`a unit is listed twice (${outer.length} rows, ${units.size} units)`);
  if (units.get("src/b.py") && units.get("src/b.py").fp !== blob["src/b.py"]) wrong.push(`src/b.py's fingerprint ${units.get("src/b.py").fp} is not its index blob ${blob["src/b.py"]}`);
  if (units.get("src/a.py") && units.get("src/a.py").fp !== worktreeA) wrong.push(`the modified src/a.py's fingerprint ${units.get("src/a.py").fp} is not the working tree's ${worktreeA} (its index blob is ${blob["src/a.py"]})`);
  if (units.get("src/b.py") && units.get("src/b.py").folder !== "src") wrong.push(`src/b.py's folder reads ${JSON.stringify(units.get("src/b.py").folder)}, not "src"`);

  const ui = got.json["Outer/ui"];
  const uiUnits = Array.isArray(ui) ? ui.map((u) => u[0]).sort() : ui;
  if (JSON.stringify(uiUnits) !== JSON.stringify(["App.tsx", "src/s.css"])) wrong.push(`the ui lens took ${JSON.stringify(uiUnits)}, not App.tsx and src/s.css`);

  const inner = got.json["Inner/code"];
  const innerUnits = Array.isArray(inner) ? inner.map((u) => u[0]) : inner;
  if (JSON.stringify(innerUnits) !== JSON.stringify(["i.py"])) wrong.push(`the inner project's map reads ${JSON.stringify(innerUnits)}, not ["i.py"]`);

  if (wrong.length) return broken(wrong.join("; "));
  return held(`the outer map held ${want.join(", ")}${units.has("src/gone.py") ? " and the deleted src/gone.py" : ""}; the modified file carried its working-tree hash, the rest their blobs; symlink, gitlink, untracked, root and nested excludes, skipme/ and inner/ left out; ui took two; inner read i.py`);
});
