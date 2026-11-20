// The daemon's third kind of pidfd (hooks/dispatcher/daemon_hunts.py, called in from daemon.py): an `out` sitting's
// launch is watched by a pidfd under the key ("hunt", <sitting id>), the process read by IDENTITY (`record.owns`, as
// `planners.busy` reads a planner) — a pid file naming a stranger is never watched nor signalled (its sitting may be
// settled as gone: that is the launch being over, not this promise). The key is claimed by
// `daemon_hunts.is_key` and by no other kind's (planner, card), and `daemon._answer` routes it BEFORE its own
// `int(key.data)`, so the ending settles the sitting through `hunt_sitting.settle` exactly once, the settle's line is
// written to `<home>/daemon.log`, and no registration is left in the selector.
//
// The launch's process is a stand-in this case starts and ends itself (`python3 -c … soul-run <launch id>` carrying
// PLAN_RUNNER_RUN_ID=<launch id>); the systemd seams are recorders.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/daemon_hunts.py, /home/lyphe/.claude/hooks/dispatcher/daemon.py, /home/lyphe/.claude/hooks/dispatcher/hunt_sitting.py, /home/lyphe/.claude/hooks/dispatcher/daemon_planners.py, /home/lyphe/.claude/hooks/dispatcher/daemon_cards.py
// writes: none

import fs from "node:fs";
import path from "node:path";

import { exec, rows } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { addPass, addSitting } from "../lib/hunt_marks_house.mjs";
import { lastLine } from "../lib/hunt_map_house.mjs";
import { sittingHouse, sittingPy, writeResult } from "../lib/hunt_sitting_house.mjs";

const WATCH = `
import selectors, subprocess
hunt_sitting, why = load_sitting()
if hunt_sitting is None:
    print(json.dumps({"missing": why}))
    raise SystemExit(0)
try:
    from dispatcher import daemon_hunts
except Exception as exc:
    print(json.dumps({"missing": f"hooks/dispatcher/daemon_hunts.py cannot be imported: {type(exc).__name__}: {exc}"}))
    raise SystemExit(0)
from dispatcher import daemon, daemon_cards, daemon_planners, store, store_hunts
from plan_runner.solo import record
stranger_id, own_pass = int(sys.argv[1]), int(sys.argv[2])
own_launch, stranger_launch = sys.argv[3], sys.argv[4]
own_id = -1
SETTLED = []
real_settle = hunt_sitting.settle
def counted(conn, sitting):
    line = real_settle(conn, sitting)
    SETTLED.append([int(sitting["id"]), line])
    return line
hunt_sitting.settle = counted
env = {k: v for k, v in os.environ.items() if k != "PLAN_RUNNER_RUN_ID"}
own = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(300)", "soul-run", own_launch],
                       env={**env, "PLAN_RUNNER_RUN_ID": own_launch}, start_new_session=True)
stranger = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(300)"], env=env, start_new_session=True)
out = {}
try:
    for launch, proc in ((own_launch, own), (stranger_launch, stranger)):
        folder = os.path.dirname(record.path(launch, "child.pid"))
        os.makedirs(folder, exist_ok=True)
        for name in ("launcher.pid", "child.pid"):
            with open(os.path.join(folder, name), "w") as handle:
                handle.write(f"{proc.pid}\\n")
    time.sleep(0.3)
    out["owns"] = record.owns(own_launch, "child.pid")
    conn = store.connect()
    sel = selectors.DefaultSelector()
    watched = {}
    # One hunter is out at a time: the stranger's sitting is out alone first, then it is ended and ours goes out.
    daemon_hunts.watch_all(conn, sel, watched)
    out["stranger_watched"] = [list(k) if isinstance(k, tuple) else k for k in watched]
    with conn:
        conn.execute("UPDATE hunt_sittings SET state = 'ended', outcome = 'failed', cause = 'case: the stranger phase', "
                     "ended_at = ? WHERE id = ? AND state = 'out'", (store.now(), stranger_id))
        night = conn.execute("SELECT night FROM hunt_sittings WHERE id = ?", (stranger_id,)).fetchone()["night"]
        project = conn.execute("SELECT project FROM hunt_sittings WHERE id = ?", (stranger_id,)).fetchone()["project"]
        own_id = store_hunts.write_sitting(conn, night=night, hunt="code", project=project, pass_id=own_pass,
                                           soul="hephaestus", model="opus", launch_id=own_launch, state="out",
                                           deadline="2099-01-01T00:00:00Z")
    out["own_id"] = own_id
    out["first_settled"] = bool(daemon_hunts.watch_all(conn, sel, watched))
    out["watched"] = [list(k) if isinstance(k, tuple) else k for k in watched]
    key = ("hunt", own_id)
    out["is_key"] = {"hunts": daemon_hunts.is_key(key), "planners": daemon_planners.is_key(key),
                     "cards": daemon_cards.is_key(key), "hunts_of_planner": daemon_hunts.is_key(("planner", own_id))}
    out["settled_before_end"] = len([s for s in SETTLED if s[0] == own_id])
    out["stranger_alive"] = stranger.poll() is None
    own.terminate()
    own.wait(timeout=10)
    events = sel.select(timeout=10)
    out["events"] = len(events)
    for ready, _mask in events:
        try:
            daemon._answer(conn, sel, watched, ready)
        except Exception as exc:
            out["answer_raised"] = f"{type(exc).__name__}: {exc}"
    out["left_watched"] = len(watched)
    out["left_registered"] = len(sel.get_map())
    daemon_hunts.watch_all(conn, sel, watched)
    out["settled"] = [s[1] for s in SETTLED if s[0] == own_id]
    out["stranger_alive_end"] = stranger.poll() is None
    out["rewatched"] = [list(k) if isinstance(k, tuple) else k for k in watched]
finally:
    for proc in (own, stranger):
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=10)
print(json.dumps(out))
`;

runCase(async (t) => {
  const house = await sittingHouse(t, "hunt-pidfd");
  const { passId } = await addPass(house, "code", ["a.py"]);
  const other = await addPass(house, "security", ["a.py", "src/a.py"]);
  const ownLaunch = "dispatch-hunter-case-pidfd-1";
  const strangerLaunch = "dispatch-hunter-case-pidfd-2";
  const stranger = await addSitting(house, { hunt: "security", passId: other.passId, launchId: strangerLaunch });
  await exec(house, "UPDATE hunt_units SET state = 'covered', note = 'read it', marked_at = '2026-11-19T01:00:00Z', handed = 1 WHERE pass_id = ?", [passId]);
  await writeResult(house, ownLaunch, { status: "done", result_text: "every unit marked" });
  const log = path.join(house.env.DISPATCHER_HOME, "daemon.log");
  const logBefore = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";

  const ran = await sittingPy(house, WATCH, [String(stranger), String(passId), ownLaunch, strangerLaunch]);
  const o = ran.json;
  if (o?.missing) return broken(o.missing);
  if (!o || o.owns === undefined) return broken(`the watch script did not answer — ${lastLine(ran)}`);
  const own = Number(o.own_id);
  if (!o.owns) return broken("the case's stand-in is not read as the launch's own process by record.owns — the case cannot judge");
  const wrong = [];
  const has = (list, id) => list.some((k) => Array.isArray(k) && k[0] === "hunt" && Number(k[1]) === id);
  if (!has(o.watched, own)) wrong.push(`watch_all registered ${JSON.stringify(o.watched)}, not ["hunt", ${own}]`);
  if (has(o.stranger_watched, stranger)) wrong.push("watch_all put a pidfd on the sitting whose pid files name a stranger");
  if (o.first_settled || o.settled_before_end) wrong.push("a live launch's sitting was settled before its process ended");
  if (!o.is_key.hunts || o.is_key.planners || o.is_key.cards || o.is_key.hunts_of_planner) wrong.push(`the key claims read ${JSON.stringify(o.is_key)}`);
  if (o.answer_raised) wrong.push(`daemon._answer raised over the hunt key: ${o.answer_raised}`);
  if (o.settled.length !== 1) wrong.push(`the watched sitting was settled ${o.settled.length} times across the answer and a second watch_all, not once`);
  if (o.left_watched || o.left_registered) wrong.push(`${o.left_watched} watch(es) and ${o.left_registered} registration(s) were left after the answer`);
  if (o.rewatched.length) wrong.push(`a second watch_all registered ${JSON.stringify(o.rewatched)} over an ended sitting`);
  const r = (await rows(house, "SELECT id, state, outcome FROM hunt_sittings WHERE id = ?", [own]));
  if (r[0]?.state !== "ended" || r[0]?.outcome !== "pass done") wrong.push(`the watched sitting reads ${r[0]?.state}/${r[0]?.outcome}, not ended/pass done`);
  if (!o.stranger_alive || !o.stranger_alive_end) wrong.push("the stranger a pid file named was ended");
  const added = (fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "").slice(logBefore.length);
  const line = String(o.settled[0] ?? "").trim();
  if (!line || !added.includes(line)) wrong.push(`daemon.log gained ${JSON.stringify(added.trim().slice(0, 200))}, which does not hold the settle's line ${JSON.stringify(line)}`);
  if (wrong.length) return broken(wrong.join("; "));
  return held(`one pidfd under ["hunt", ${own}], none on the stranger; its ending settled once through daemon._answer ("${line}"), logged, nothing left registered`);
});
