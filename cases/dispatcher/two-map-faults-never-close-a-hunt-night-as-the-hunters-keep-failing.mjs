// INV-78, as seam 6 is held to it: "A map fault skips that turn for the night and the sweep goes on. Two failed sittings
// close the night and the next night starts fresh." `hunt_rule` writes an unmappable turn as a sitting `ended`/`failed`
// with no launch (so `hunt_turns` does not take that turn again tonight), and its close rule counts sittings ended
// `failed`. If the map-fault rows are counted, two projects that cannot be mapped — a folder gone, a database that does
// not answer — close the night as "the hunters keep failing: could not be mapped: …" once the first hunter is out, though
// no hunter failed and a mappable project still has its pass open. The sentence is false and the night is lost.
//
// One scratch store (marksHouse: night open, 120 minutes), order ["code"], three projects: "Gone A" and "Gone B", whose
// folders do not exist, then "Proj", a git folder of six files. `hunt_sitting.start` is a recorder installed BEFORE
// hunt_rule is imported, so no hunter is ever launched; the systemd seams are hunt_sitting_house.mjs STUBS. The first
// sweep writes both faults and hands Proj's pass 1 to start. Then Proj's sitting is written as it would have ended —
// `wound down`, its pass still open — and the second sweep must hand that pass to start again, the night still open.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_rule.py, /home/lyphe/.claude/hooks/dispatcher/hunt_turns.py
// writes: none

import fs from "node:fs";
import path from "node:path";

import { exec, rows } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { lastLine, setProjects } from "../lib/hunt_map_house.mjs";
import { FILES, marksHouse } from "../lib/hunt_marks_house.mjs";
import { sittingPy } from "../lib/hunt_sitting_house.mjs";

const SWEEP = `
from dispatcher import hunt_sitting as _hs
STARTS = []
def _start(conn, night, hunt, project, pass_id, *a, **k):
    STARTS.append({"hunt": hunt, "project": project, "pass_id": pass_id})
    return f"hunt sitting stub out — {hunt}"
_hs.start = _start
try:
    from dispatcher import hunt_rule
except Exception as exc:
    print(json.dumps({"missing": f"hooks/dispatcher/hunt_rule.py cannot be imported: {type(exc).__name__}: {exc}"}))
    raise SystemExit(0)
from dispatcher import store
conn = store.connect()
try:
    print(json.dumps({"lines": [str(l) for l in (hunt_rule.sweep(conn, None) or [])], "starts": STARTS}))
except Exception as exc:
    print(json.dumps({"raised": f"{type(exc).__name__}: {exc}", "starts": STARTS}))
`;

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString().replace(/\.\d{3}Z$/, "Z");

async function sweep(house) {
  const ran = await sittingPy(house, SWEEP);
  if (!ran.json) return { fault: `the sweep child printed no answer — ${lastLine(ran)}` };
  if (ran.json.missing) return { fault: ran.json.missing };
  if (ran.json.raised) return { fault: `hunt_rule.sweep raised ${ran.json.raised}` };
  return ran.json;
}

runCase(async (t) => {
  const house = await marksHouse(t, "hunt-two-faults", { files: FILES });
  const goneA = path.join(house.dir, "no-such-folder-a");
  const goneB = path.join(house.dir, "no-such-folder-b");
  setProjects(house, [{ name: "Gone A", path: goneA }, { name: "Gone B", path: goneB }, { name: "Proj", path: house.repo }]);
  fs.writeFileSync(house.config, fs.readFileSync(house.config, "utf8").replace(/^order = \[.*\]$/m, 'order = ["code"]'));
  house.env.DISPATCHER_EPICS_FLAG_PATH = path.join(house.dir, "epics.flag");

  const first = await sweep(house);
  if (first.fault) return broken(`the first sweep: ${first.fault}`);
  const faults = await rows(house, "SELECT outcome, launch_id, cause FROM hunt_sittings WHERE project IN (?, ?)", [goneA, goneB]);
  if (faults.length !== 2 || faults.some((f) => f.outcome !== "failed" || f.launch_id !== null)) {
    return broken(`the first sweep wrote ${JSON.stringify(faults)}, not two map faults — the case cannot judge the close`);
  }
  if (first.starts.length !== 1 || first.starts[0].project !== house.repo) {
    return broken(`the first sweep started ${JSON.stringify(first.starts)}, not Proj's pass — the case cannot judge the close`);
  }
  const passId = first.starts[0].pass_id;

  // Proj's hunter, had it run, wound down with units of its pass still open.
  await exec(house,
    "INSERT INTO hunt_sittings (night, hunt, project, pass_id, soul, model, launch_id, state, outcome, started_at, ended_at) " +
    "VALUES (?, 'code', ?, ?, 'hephaestus', 'sonnet', NULL, 'ended', 'wound down', ?, ?)",
    [house.night, house.repo, passId, iso(-600000), iso(-60000)]);

  const wrong = [];
  const second = await sweep(house);
  if (second.fault) return broken(`the second sweep: ${second.fault}`);
  const night = (await rows(house, "SELECT state, why FROM hunt_nights WHERE night = ?", [house.night]))[0];
  if (night.state !== "open") wrong.push(`two map faults closed the night ${JSON.stringify(night.why)} though no hunter failed and Proj's pass ${passId} is still open`);
  if (second.starts.length !== 1 || second.starts[0].pass_id !== passId) wrong.push(`the second sweep started ${JSON.stringify(second.starts)} (said ${JSON.stringify(second.lines)}), not Proj's open pass ${passId}`);

  if (wrong.length) return broken(wrong.join("; "));
  return held(`two map faults written failed with no launch; the night stayed open and Proj's pass ${passId} was handed to start again`);
});
