// protects: /home/lyphe/.claude/hooks/dispatcher/cmd/status.py, /home/lyphe/.claude/hooks/dispatcher/keeper.py, /home/lyphe/.claude/hooks/dispatcher/keeper_files.py, /home/lyphe/.claude/hooks/dispatcher/cmd/keep.py
// writes: none
//
// A keeper run that raises is said on stderr and the whole derivation is printed instead (pollers-hooks--incremental-status,
// phase 7): a card must always read a document. The run is made to fail for real by putting a plain file where the keeper
// writes its plan files; the keeper records the failure in kept.json, and the next read after the cause is gone keeps a picture.
import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { keptHouse, leafDiff, readJson, said } from "../lib/kept_status_house.mjs";

const HOOKS = "/home/lyphe/.claude/hooks";

runCase(async (t) => {
  const house = await keptHouse(t, "kept-raise", HOOKS);
  const status = path.join(house.home, "status");
  fs.mkdirSync(status, { recursive: true });
  fs.writeFileSync(path.join(status, "plans"), "a file where the plan files go\n");
  const ran = await house.dispatcher(["status", "--json"]);
  if (ran.code !== 0) return broken("status --json over a failing keeper " + said(ran));
  let doc;
  try { doc = JSON.parse(ran.out); } catch { return broken("status --json over a failing keeper printed no JSON: " + ran.out.slice(0, 120)); }
  const names = (doc.plans ?? []).map((p) => p.name);
  if (!["kept-done", "kept-open"].every((n) => names.includes(n))) return broken("the derivation printed carries plans " + JSON.stringify(names));
  if (!/keeper/i.test(ran.err)) return broken("nothing on stderr says the keeper's run failed (stderr: " + JSON.stringify(ran.err.trim().slice(0, 120)) + ")");
  const kept = readJson(path.join(status, "kept.json"));
  if (!kept?.failed) return broken("kept.json does not name what the run failed at: " + JSON.stringify(kept).slice(0, 160));
  fs.rmSync(path.join(status, "plans"));
  const again = await house.dispatcher(["status", "--json"]);
  if (again.code !== 0) return broken("status --json once the cause was gone " + said(again));
  if (!readJson(path.join(status, "index.json"))) return broken("the read after the cause was gone kept no index.json");
  return held("the failing run was said on stderr (" + ran.err.trim().split("\n")[0].slice(0, 90) + "), the derivation printed both plans, kept.json named the failure, the next read kept a picture");
});
