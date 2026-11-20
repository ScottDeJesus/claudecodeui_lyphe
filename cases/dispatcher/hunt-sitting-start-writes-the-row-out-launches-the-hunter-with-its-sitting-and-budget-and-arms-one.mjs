// `hunt_sitting.start(conn, night, hunt, project, pass_id)` (hooks/dispatcher/hunt_sitting.py) launches one hunter: the
// hunt row's `(soul, model)` (`launch_table.hunt_of`), `plan_runner.solo.launch.prepare(role="hunter", agent=soul,
// brief=…, cwd=<project path>, model=model, hunt={"kind", "sitting", "seconds"})`, then `detach(prepared, env=…)` with
// DISPATCHER_HUNT_SITTING=<the sitting's id> and GEMINI_BUDGET_PLAN=chain-hunt-<kind>. The sitting row is `out` with the
// launch's id and a deadline of now plus the night's minutes left — its `minutes` less the WORKING minutes of its
// sittings (each one's own span, a sitting that ended `waiting` on a usage limit included), the wait between a
// sitting's ending and the next not counted — and ONE transient unit, `hunt-overdue-<home digest>…`, is armed
// through `schedule.arm_unit` at the deadline plus `grace`, running `hunt overdue <id>`.
//
// The real `prepare` runs (in the scratch state and a scratch ledger); `detach` and every systemd seam are recorders, and
// PLAN_RUNNER_CLAUDE_BIN names a stand-in, so no soul is ever forked. Each worked sitting carries a launch whose
// `child.pid` mtime is its start (`record.child_began_at`), because a span is counted from when its soul began; the
// start child alone opts the scratch home in (`DISPATCHER_SCRATCH_DAEMON=1`), because a scratch home that did not arms
// no overdue unit.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_sitting.py, /home/lyphe/.claude/hooks/dispatcher/schedule.py, /home/lyphe/.claude/hooks/plan_runner/solo/launch.py, /home/lyphe/.claude/hooks/launch_table/table.py, /home/lyphe/.claude/hooks/dispatcher/store_hunts.py
// writes: none

import fs from "node:fs";
import path from "node:path";
import { exec, rows } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { addPass, FILES } from "../lib/hunt_marks_house.mjs";
import { lastLine } from "../lib/hunt_map_house.mjs";
import { sittingHouse, sittingPy, writeResult } from "../lib/hunt_sitting_house.mjs";

const START = `
hunt_sitting, why = load_sitting()
if hunt_sitting is None:
    print(json.dumps({"missing": why}))
    raise SystemExit(0)
import launch_table
from dispatcher import hunt_config, store, store_hunts, wake
from plan_runner.solo import launch as solo_launch
night, repo, pass_id = sys.argv[1], sys.argv[2], int(sys.argv[3])
REC = {"prepare": [], "detach": []}
real_prepare = solo_launch.prepare
def plain(value):
    return value if isinstance(value, (str, int, float, bool, type(None), dict, list)) else str(value)
def prepare(*args, **kw):
    REC["prepare"].append({"args": [plain(a) for a in args], "kw": {k: plain(v) for k, v in kw.items()}})
    return real_prepare(*args, **kw)
def detach(prepared, env=None):
    env = dict(env or {})
    REC["detach"].append({"id": prepared.id, "sitting": env.get("DISPATCHER_HUNT_SITTING"),
                          "budget": env.get("GEMINI_BUDGET_PLAN"), "home": env.get("DISPATCHER_HOME")})
    return 4242
solo_launch.prepare = prepare
solo_launch.detach = detach
soul, model = launch_table.hunt_of("code")
config = hunt_config.read()
conn = store.connect()
before = time.time()
tried = []
answer = None
try:                                    # the project as the store holds it: its path
    answer = hunt_sitting.start(conn, night, "code", repo, pass_id)
    tried.append("ok")
except Exception as exc:
    tried.append(f"{type(exc).__name__}: {exc}")
print(json.dumps({"rec": REC, "calls": CALLS, "tried": tried, "answer": plain(answer), "soul": soul, "model": model,
                  "grace": config.grace, "digest": wake.home_digest(store.home()), "before": before, "after": time.time()}))
`;

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString().replace(/\.\d{3}Z$/, "Z");

/** A launch's result.json, and a `child.pid` whose mtime is the moment its soul began, `msFromNow` from now. */
async function launchBegan(house, id, msFromNow) {
  const file = await writeResult(house, id, { status: "done" });
  const pidFile = path.join(path.dirname(file), "child.pid");
  fs.writeFileSync(pidFile, "999999\n");
  const startSec = (Date.now() + msFromNow) / 1000;
  fs.utimesSync(pidFile, startSec, startSec);
}

runCase(async (t) => {
  const house = await sittingHouse(t, "hunt-start");
  const { passId } = await addPass(house, "code", FILES);
  const min = 60000;
  await launchBegan(house, "dispatch-hunter-case-start-1", -40 * min);
  await launchBegan(house, "dispatch-hunter-case-start-2", -70 * min);
  await exec(house, "INSERT INTO hunt_sittings (night, hunt, project, pass_id, soul, model, launch_id, state, outcome, cause, started_at, ended_at) VALUES (?, 'code', ?, ?, 'hephaestus', 'opus', ?, 'ended', 'stopped', 'case: worked thirty minutes', ?, ?)",
    [house.night, house.repo, passId, "dispatch-hunter-case-start-1", iso(-40 * min), iso(-10 * min)]);
  await exec(house, "INSERT INTO hunt_sittings (night, hunt, project, pass_id, soul, model, launch_id, state, outcome, cause, started_at, ended_at) VALUES (?, 'code', ?, ?, 'hephaestus', 'opus', ?, 'ended', 'waiting', 'case: worked twenty minutes, then a usage limit', ?, ?)",
    [house.night, house.repo, passId, "dispatch-hunter-case-start-2", iso(-70 * min), iso(-50 * min)]);
  await exec(house, "UPDATE hunt_nights SET opened_at = ? WHERE night = ?", [iso(-80 * min), house.night]);
  const before = (await rows(house, "SELECT max(id) AS id FROM hunt_sittings"))[0].id;

  // every systemd seam in the child is a STUBS recorder, so the opt-in reaches no user manager; without it `_arm_overdue` arms nothing for a scratch home.
  const ran = await sittingPy({ ...house, env: { ...house.env, DISPATCHER_SCRATCH_DAEMON: "1" } }, START, [house.night, house.repo, String(passId)]);
  const o = ran.json;
  if (o?.missing) return broken(o.missing);
  if (!o?.rec) return broken(`the start script did not answer — ${lastLine(ran)}`);
  if (!o.tried.includes("ok")) return broken(`hunt_sitting.start raised: ${o.tried.join(" | ")}`);
  const wrong = [];
  const made = await rows(house, "SELECT * FROM hunt_sittings WHERE id > ?", [before]);
  if (made.length !== 1) return broken(`start wrote ${made.length} sitting rows, not one; it answered ${JSON.stringify(o.answer)}`);
  const s = made[0];
  if (s.state !== "out" || s.night !== house.night || s.hunt !== "code" || s.project !== house.repo || Number(s.pass_id) !== passId) {
    wrong.push(`the row reads ${JSON.stringify({ state: s.state, night: s.night, hunt: s.hunt, project: s.project, pass_id: s.pass_id })}`);
  }
  if (s.soul !== o.soul || s.model !== o.model) wrong.push(`the row's soul/model ${s.soul}/${s.model} are not hunt_of's ${o.soul}/${o.model}`);
  const deadline = Date.parse(s.deadline ?? "") / 1000;
  const lo = o.before + 70 * 60 - 90;
  const hi = o.after + 70 * 60 + 90;
  if (!(deadline >= lo && deadline <= hi)) wrong.push(`the deadline ${s.deadline} is ${Math.round((deadline - o.before) / 60)} minutes on, not 70 (120 less the 30 and 20 worked; the 10-minute wait between them, and the 80 minutes since the night opened, not counted)`);

  const p = o.rec.prepare;
  if (p.length !== 1) wrong.push(`prepare was called ${p.length} times`);
  else {
    const kw = { ...p[0].kw };
    ["role", "agent", "brief", "cwd"].forEach((k, i) => { if (kw[k] === undefined && p[0].args[i] !== undefined) kw[k] = p[0].args[i]; });
    if (kw.role !== "hunter" || kw.agent !== o.soul || kw.cwd !== house.repo || kw.model !== o.model) {
      wrong.push(`prepare had role ${kw.role}, agent ${kw.agent}, cwd ${kw.cwd}, model ${kw.model}`);
    }
    const h = kw.hunt ?? {};
    const secs = Number(h.seconds);
    if (h.kind !== "code" || Number(h.sitting) !== Number(s.id) || !(secs >= 65 * 60 && secs <= (70 + o.grace) * 60 + 120)) {
      wrong.push(`prepare's hunt was ${JSON.stringify(h)}, not {kind: code, sitting: ${s.id}, seconds ≈ ${70 * 60}}`);
    }
    if (!/hunt code/.test(String(kw.brief ?? "").split("\n")[0])) wrong.push(`the brief opens ${JSON.stringify(String(kw.brief ?? "").split("\n")[0])}`);
  }
  const d = o.rec.detach;
  if (d.length !== 1) wrong.push(`detach was called ${d.length} times`);
  else {
    if (d[0].id !== s.launch_id) wrong.push(`the row's launch_id ${s.launch_id} is not the detached launch ${d[0].id}`);
    if (String(d[0].sitting) !== String(s.id)) wrong.push(`detach's DISPATCHER_HUNT_SITTING is ${d[0].sitting}, not ${s.id}`);
    if (d[0].budget !== "chain-hunt-code") wrong.push(`detach's GEMINI_BUDGET_PLAN is ${d[0].budget}, not chain-hunt-code`);
  }
  const units = o.calls.arm_unit;
  if (units.length !== 1) wrong.push(`arm_unit was called ${units.length} times, not once`);
  else {
    const u = units[0];
    if (!u.unit.startsWith(`hunt-overdue-${o.digest}`)) wrong.push(`the unit is named ${u.unit}, not hunt-overdue-${o.digest}…`);
    if (u.words.join(" ") !== `hunt overdue ${s.id}`) wrong.push(`the unit runs ${JSON.stringify(u.words)}, not hunt overdue ${s.id}`);
    if (Math.abs(u.epoch - (deadline + o.grace * 60)) > 5) wrong.push(`the unit fires ${Math.round(u.epoch - deadline)} s after the deadline, not ${o.grace * 60}`);
  }
  if (o.calls.systemd_run.length) wrong.push(`start reached systemd-run beside arm_unit: ${JSON.stringify(o.calls.systemd_run)}`);
  if (wrong.length) return broken(wrong.join("; "));
  return held(`sitting ${s.id} out on ${s.launch_id}, deadline 70 minutes on (the wait not counted), prepare as hunter ${o.soul}/${o.model}, detach with its sitting and chain-hunt-code, one ${units[0].unit} at deadline + ${o.grace} min`);
});
