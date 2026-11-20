// `hooks/dispatcher/hunt_map.py`'s `files` freezes the order a pass is hunted in: folders by the newest commit of the
// last year that touched them (one `git log --since=1.year --format=%ct --name-only`), newest first; folders with no
// such commit after them, by name; files by name inside a folder. A folder is a file's own folder, so fresh/deep/ is not
// fresh/. Over a scratch git project with commits dated two years ago, 40 days ago and an hour ago, plus one folder only
// staged: fresh (now), month (40 days; its two-year commit is older), then alpha, fresh/deep, mid, zeta by name.
// Mapped twice, unchanged, the two maps are the same list.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_map.py
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { commit, git, gitInit, lastLine, mapHouse, put, py, setProjects } from "../lib/hunt_map_house.mjs";

const SCRIPT = String.raw`
import json
from dispatcher import hunt_config, hunt_map
cfg = hunt_config.read()
p = cfg.project("Ordered")
try:
    maps = [[[u.unit, u.folder] for u in hunt_map.files(p, "code", cfg)] for _ in range(2)]
    print(json.dumps({"maps": maps}))
except hunt_map.MapFault as e:
    print(json.dumps({"fault": str(e)}))
`;

runCase(async (t) => {
  const house = await mapHouse(t, "hunt-map-order");
  const repo = await gitInit(house, "ordered");
  for (const rel of ["alpha/x.py", "zeta/z.py", "fresh/deep/x.py", "month/m.py"]) put(repo, rel, `${rel}\n`);
  await commit(repo, "two years ago", { daysAgo: 730 });
  put(repo, "month/m.py", "month again\n");
  await commit(repo, "forty days ago", { daysAgo: 40 });
  put(repo, "fresh/b.py", "b\n");
  put(repo, "fresh/a.py", "a\n");
  await commit(repo, "an hour ago", { daysAgo: 0 });
  put(repo, "mid/s.py", "staged only\n");
  const staged = await git(repo, ["add", "mid/s.py"]);
  if (staged.code !== 0) return broken(`the scratch file could not be staged: ${staged.err.trim()}`);
  setProjects(house, [{ name: "Ordered", path: repo }]);

  const got = await py(house, SCRIPT);
  if (!got.json) return broken(`hunt_map.files could not be run — ${lastLine(got)}`);
  if (got.json.fault) return broken(`the scratch project faulted: ${got.json.fault}`);
  const [first, second] = got.json.maps;
  const want = ["fresh/a.py", "fresh/b.py", "month/m.py", "alpha/x.py", "fresh/deep/x.py", "mid/s.py", "zeta/z.py"];
  const wrong = [];
  const order = first.map((u) => u[0]);
  if (JSON.stringify(order) !== JSON.stringify(want)) wrong.push(`the order reads ${JSON.stringify(order)}, not ${JSON.stringify(want)}`);
  const deep = first.find((u) => u[0] === "fresh/deep/x.py");
  if (deep && deep[1] !== "fresh/deep") wrong.push(`fresh/deep/x.py's folder reads ${JSON.stringify(deep[1])}, not "fresh/deep"`);
  if (JSON.stringify(first) !== JSON.stringify(second)) wrong.push("a second map of the unchanged project differs from the first");
  if (wrong.length) return broken(wrong.join("; "));
  return held(`the map read ${order.join(", ")} — newest folder first, the folders with no commit this year by name — and a second map was the same`);
});
