// "Covered" means opened: no unit the live store holds as covered was marked without its sitting's own transcript
// showing a tool call that opened it (the measured ruling of 2026-11-19 and seam 5's evidence rule). Every covered row
// is read with its sitting; it must name a sitting with a launch, and hunt_marks.opened over that launch's child.log
// must hold it. A log retention has swept is no evidence either way: such rows are counted and named, never judged.
// The judge is proved able to say no first, in a scratch home: a log holding one Read gives that file and not another.
// The live store is opened read-only.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_marks.py, /home/lyphe/.claude/hooks/dispatcher/store_hunts.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py, /home/lyphe/.claude/hooks/dispatcher/hunt_sitting.py, /home/lyphe/.claude/charters/HUNTING.md
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { housePy, liveEnv, said } from "../lib/hunting_live.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const JUDGE = `import json, os, sqlite3
from dispatcher import hunt_marks, store
from plan_runner.solo import record
c = sqlite3.connect("file:" + os.path.join(store.home(), "dispatcher.db") + "?mode=ro", uri=True)
c.row_factory = sqlite3.Row
rows = c.execute("SELECT u.id, u.unit, u.sitting_id, s.hunt, s.project, s.launch_id FROM hunt_units u "
                 "LEFT JOIN hunt_sittings s ON s.id = u.sitting_id WHERE u.state = 'covered' ORDER BY u.id").fetchall()
out = {"covered": len(rows), "judged": 0, "swept": [], "orphans": [], "unproved": []}
by = {}
for r in rows:
    if r["sitting_id"] is None or r["launch_id"] is None or r["hunt"] is None:
        out["orphans"].append(f"{r['unit']} (unit {r['id']}, sitting {r['sitting_id']})")
        continue
    by.setdefault((r["sitting_id"], r["launch_id"], r["project"], r["hunt"]), []).append(r["unit"])
for (sid, launch, project, hunt), units in by.items():
    try:
        log = record.path(launch, "child.log")
    except record.LaunchError as error:
        out["orphans"].append(f"sitting {sid}: launch id {launch!r} refused ({error})")
        continue
    if not os.path.isfile(log):
        out["swept"].append(f"sitting {sid} ({len(units)} units)")
        continue
    seen = hunt_marks.opened(launch, units, root=project, tables=(hunt == "data"))
    out["judged"] += len(units)
    out["unproved"] += [f"{u} (sitting {sid}, {hunt})" for u in units if u not in seen]
print(json.dumps(out))`;

const SELF_PROOF = `import json, sys
from dispatcher import hunt_marks
print(json.dumps(sorted(hunt_marks.opened(sys.argv[1], ["src/a.py", "src/b.py"], root=sys.argv[2], tables=False))))`;

async function judgeCanSayNo(t) {
  const dir = await scratchDir(t, "covered-proof");
  const launch = "dispatch-hephaestus-20261119-000000-ca5e";
  const log = path.join(dir, "state", "dispatch-souls", launch, "child.log");
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const project = path.join(dir, "proj");
  const use = { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: `${project}/src/a.py` } }] } };
  const result = { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "x = 1" }] } };
  fs.writeFileSync(log, `${JSON.stringify(use)}\n${JSON.stringify(result)}\n`);
  const ran = await housePy(SELF_PROOF, [launch, project], { env: liveEnv({ DISPATCHER_HOME: path.join(dir, "state", "dispatcher") }) });
  return JSON.stringify(ran.json) === JSON.stringify(["src/a.py"]) ? null : `the judge over a log of one Read of src/a.py answered ${JSON.stringify(ran.json)} — ${said(ran)}`;
}

runCase(async (t) => {
  const proof = await judgeCanSayNo(t);
  if (proof) return cannotRun(proof);
  const ran = await housePy(JUDGE);
  const got = ran.json;
  if (ran.code !== 0 || got === null) return cannotRun(`the live judge did not answer — ${said(ran)}`);
  const wrong = [];
  if (got.orphans.length) wrong.push(`${got.orphans.length} covered with no sitting or launch to prove it: ${got.orphans.slice(0, 5).join(", ")}`);
  if (got.unproved.length) wrong.push(`${got.unproved.length} covered that their sitting's transcript never opened: ${got.unproved.slice(0, 8).join(", ")}`);
  if (wrong.length) return broken(wrong.join("; "));
  if (got.covered === 0) return held("the live store holds no covered unit yet; the judge, proved on a scratch log, says no to a file no tool call opened");
  return held(`${got.judged} of ${got.covered} covered units proved opened in their own sitting's child.log${got.swept.length ? `; ${got.swept.length} sittings' logs swept by retention, not judged` : ""}`);
});
