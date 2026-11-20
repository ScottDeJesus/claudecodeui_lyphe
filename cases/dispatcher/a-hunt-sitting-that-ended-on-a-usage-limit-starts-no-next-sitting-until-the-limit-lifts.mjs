// Seam 6: a sitting whose launch ended on a Claude usage limit settles `waiting`, "the cause naming the lift;
// `schedule.arm_retry(home, "hunt", <night>, lift)` wakes the daemon then, and the wait is not counted in the night's
// working minutes". The wake at the lift only means something if the night WAITS for it: `hunt_sitting.settle` kicks
// the daemon, and a sweep that starts the next sitting at once launches another Claude child into the same wall, which
// ends `waiting` again, kicks again, and so on until the lift — a spin of launches. The pacer weighs only the week, so a
// five-hour wall is not its hold, and the launch layer refuses nothing on a wall ("the try is the check").
//
// One scratch store (marksHouse: project Proj, night open, 120 minutes, order ["code"]), one open code pass, one sitting out whose
// launch's result.json is a usage-limit ending (`status: api_error`, `resets_at`). `hunt_sitting.settle` is run on it as
// the daemon's pidfd answer would; then `hunt_rule.sweep` with `hunt_sitting.start` replaced by a recorder (no hunter is
// ever launched; the systemd seams are hunt_sitting_house.mjs STUBS). Before the lift: no start, the night still open.
// Then the same ending with its lift already past: the sweep starts the next sitting, so the night is not stuck.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_rule.py, /home/lyphe/.claude/hooks/dispatcher/hunt_sitting.py
// writes: none

import fs from "node:fs";

import { exec, rows } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { lastLine } from "../lib/hunt_map_house.mjs";
import { addPass, addSitting, FILES } from "../lib/hunt_marks_house.mjs";
import { sittingHouse, sittingPy, writeResult } from "../lib/hunt_sitting_house.mjs";

const SETTLE = `
hunt_sitting, why = load_sitting()
if hunt_sitting is None:
    print(json.dumps({"missing": why}))
    raise SystemExit(0)
from dispatcher import store, store_hunts
conn = store.connect()
row = store_hunts.sitting(conn, int(sys.argv[1]))
try:
    print(json.dumps({"line": str(hunt_sitting.settle(conn, row)), "retries": CALLS["arm_retry"]}))
except Exception as exc:
    print(json.dumps({"raised": f"{type(exc).__name__}: {exc}"}))
`;

const SWEEP = `
from dispatcher import hunt_sitting as _hs
STARTS = []
def _start(conn, night, hunt, project, pass_id, *a, **k):
    STARTS.append({"hunt": hunt, "pass_id": pass_id})
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
const wallResult = (liftMs) => ({ status: "api_error", cause: "api error 429 after 0 retries", resets_at: (Date.now() + liftMs) / 1000,
  limit_source: "api", ended_at: Date.now() / 1000 });

async function child(house, script, args = []) {
  const ran = await sittingPy(house, script, args);
  if (!ran.json) return { fault: `the child printed no answer — ${lastLine(ran)}` };
  if (ran.json.missing) return { fault: ran.json.missing };
  if (ran.json.raised) return { fault: `it raised ${ran.json.raised}` };
  return ran.json;
}

runCase(async (t) => {
  const house = await sittingHouse(t, "hunt-wall");
  fs.writeFileSync(house.config, fs.readFileSync(house.config, "utf8").replace(/^order = \[.*\]$/m, 'order = ["code"]'));
  const { passId } = await addPass(house, "code", FILES);
  const launch = "dispatch-hunter-case-wall-1";
  const id = await addSitting(house, { hunt: "code", passId, launchId: launch, minutes: 60 });
  await writeResult(house, launch, wallResult(2 * 3600 * 1000));
  const wrong = [];

  const settled = await child(house, SETTLE, [String(id)]);
  if (settled.fault) return broken(`the settle: ${settled.fault}`);
  const s = (await rows(house, "SELECT state, outcome FROM hunt_sittings WHERE id = ?", [id]))[0];
  if (s.state !== "ended" || s.outcome !== "waiting") return broken(`a usage-limit ending settled ${JSON.stringify(s)}, not ended/waiting — the case cannot judge the sweep`);

  const before = await child(house, SWEEP);
  if (before.fault) return broken(`the sweep before the lift: ${before.fault}`);
  if (before.starts.length) wrong.push(`the sweep right after a usage-limit ending, two hours before its lift, started the next sitting (${JSON.stringify(before.starts)}; said ${JSON.stringify(before.lines)}) — a launch into the same wall`);
  const night = (await rows(house, "SELECT state, why FROM hunt_nights WHERE night = ?", [house.night]))[0];
  if (night.state !== "open") wrong.push(`the sweep before the lift closed the night ${JSON.stringify(night)}; a wait is not the night's end`);

  // The lift has passed: the same ending, its reset a minute behind now.
  const lifted = new Date(Date.now() - 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
  await writeResult(house, launch, wallResult(-60000));
  await exec(house, "UPDATE hunt_sittings SET cause = ?, ended_at = ? WHERE id = ?", [`a Claude usage limit — lifts at ${lifted}`, iso(-120000), id]);
  if (night.state === "open") {
    const after = await child(house, SWEEP);
    if (after.fault) wrong.push(`the sweep after the lift: ${after.fault}`);
    else if (after.starts.length !== 1 || after.starts[0].pass_id !== passId) wrong.push(`the sweep once the lift had passed started ${JSON.stringify(after.starts)} (said ${JSON.stringify(after.lines)}), not the open pass ${passId}`);
  }

  if (wrong.length) return broken(wrong.join("; "));
  return held(`settled: "${settled.line}"; before the lift no start and the night open; after it, pass ${passId} handed to start`);
});
