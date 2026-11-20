// A night is opened by a verb that writes one row and kicks (`hunt night`), so the night only ever runs if the kick
// starts a daemon and the daemon's pass runs the hunt sweep. Seam 6 wires both ends: `wake._work` asks `hunt_rule.live`
// (an open night, or a sitting out), so a store holding nothing but an open night is work and the kick starts the
// daemon; and `rule.apply`, the daemon's pass, calls `hunt_rule.sweep` after the cards' sweep. A daemon that exits on
// "no work" over an open night, or a pass that never sweeps it, leaves the night open forever and runs no hunter.
//
// One scratch store holds only an open night, over one project whose folder does not exist, so the sweep's whole walk
// is decided without a launch: one map fault, then `nothing left to hunt`. The pass is `rule.apply` in a child Python
// with three seams cut: the account settle (`claude_account.auto.settle`, which acts on the operator's accounts) is a
// no-op, the pacer's context is read read-only, and `pace.arm` (a systemd unit) is a no-op. `hunt_sitting.start` is a
// recorder, so no hunter can launch whatever the pass does. The systemd seams are hunt_sitting_house.mjs's stubs.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/wake.py, /home/lyphe/.claude/hooks/dispatcher/rule.py, /home/lyphe/.claude/hooks/dispatcher/hunt_rule.py
// writes: none

import fs from "node:fs";
import path from "node:path";

import { rows } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { lastLine, setProjects } from "../lib/hunt_map_house.mjs";
import { marksHouse } from "../lib/hunt_marks_house.mjs";
import { sittingPy } from "../lib/hunt_sitting_house.mjs";

const PASS = `
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
from plan_runner import claude_account
import plan_runner.claude_account.auto as _auto
_auto.settle = lambda *a, **k: None
from dispatcher import pace, rule, store, wake
_context = pace.context
pace.context = lambda conn, now=None, read_only=False: _context(conn, now, read_only=True)
pace.arm = lambda *a, **k: None
conn = store.connect()
out = {"starts": STARTS}
try:
    out["before"] = {"work": bool(wake._work(conn)), "live": bool(hunt_rule.live(conn))}
    out["lines"] = [str(l) for l in rule.apply(conn)]
    out["after"] = {"work": bool(wake._work(conn)), "live": bool(hunt_rule.live(conn))}
except Exception as exc:
    out["raised"] = f"{type(exc).__name__}: {exc}"
print(json.dumps(out))
`;

runCase(async (t) => {
  const house = await marksHouse(t, "hunt-night-work");
  const gone = path.join(house.dir, "no-such-folder");
  setProjects(house, [{ name: "Gone", path: gone }]);
  fs.writeFileSync(house.config, fs.readFileSync(house.config, "utf8").replace(/^order = \[.*\]$/m, 'order = ["code"]'));
  house.env.DISPATCHER_EPICS_FLAG_PATH = path.join(house.dir, "epics.flag");

  const ran = await sittingPy(house, PASS);
  const got = ran.json;
  if (!got) return broken(`the pass child printed no answer — ${lastLine(ran)}`);
  if (got.missing) return broken(got.missing);
  const wrong = [];
  if (got.raised) wrong.push(`the daemon's pass raised ${got.raised}`);
  if (got.before && (!got.before.work || !got.before.live)) wrong.push(`over a store holding only an open night wake._work answered ${got.before.work} and hunt_rule.live ${got.before.live}, so a kick would start no daemon for the night`);
  if (got.starts.length) wrong.push(`the pass started a sitting over a project that cannot be mapped: ${JSON.stringify(got.starts)}`);
  const night = (await rows(house, "SELECT state, why FROM hunt_nights WHERE night = ?", [house.night]))[0];
  const fault = await rows(house, "SELECT state, outcome, cause FROM hunt_sittings WHERE project = ?", [gone]);
  if (fault.length !== 1 || fault[0].outcome !== "failed" || !String(fault[0].cause ?? "").startsWith("could not be mapped: ")) {
    wrong.push(`the daemon's pass left the map fault as ${JSON.stringify(fault)} — the hunt sweep did not run in it`);
  }
  if (night.state !== "closed" || night.why !== "nothing left to hunt") wrong.push(`after the daemon's pass the night reads ${JSON.stringify(night)}, not closed "nothing left to hunt"`);
  if (got.after && (got.after.work || got.after.live)) wrong.push(`after the night closed wake._work answered ${got.after.work} and hunt_rule.live ${got.after.live}, so the daemon would not exit`);

  if (wrong.length) return broken(wrong.join("; "));
  return held(`open night alone: work and live; one daemon pass: the map fault failed, the night closed "nothing left to hunt"; after: no work, not live`);
});
