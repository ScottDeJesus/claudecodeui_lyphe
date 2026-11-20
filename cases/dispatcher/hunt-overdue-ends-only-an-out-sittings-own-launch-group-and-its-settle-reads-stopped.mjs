// `dispatcher hunt overdue SITTING` (hooks/dispatcher/cmd/hunt.py), what the armed hunt-overdue unit runs at the limit
// plus grace: a sitting no longer `out` is said so at exit 0 and nothing is signalled; one still out has its launch
// ended BY IDENTITY — the pid checked through `record.owns` first, then SIGTERM to the launch's process group, so the
// soul and whatever it forked end together. A pid file naming a stranger is never signalled. The ending then settles
// as `stopped` (`hunt_sitting.settle`), never `failed`.
//
// Each launch is a stand-in this case starts in a process group of its own (hunt_sitting_house.mjs `standIn`), with one
// `sleep` forked into that group; every process it started is ended in the case's own cleanup.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py, /home/lyphe/.claude/hooks/dispatcher/hunt_sitting.py, /home/lyphe/.claude/hooks/plan_runner/solo/record.py
// writes: none

import { rows, said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { hunt } from "../lib/hunt_house.mjs";
import { addPass, addSitting, FILES } from "../lib/hunt_marks_house.mjs";
import { alive, endStandIn, sittingHouse, sittingPy, standIn, until, writePids } from "../lib/hunt_sitting_house.mjs";

const SETTLE = `
hunt_sitting, why = load_sitting()
if hunt_sitting is None:
    print(json.dumps({"missing": why}))
    raise SystemExit(0)
from dispatcher import store, store_hunts
conn = store.connect()
row = store_hunts.sitting(conn, int(sys.argv[1]))
try:
    line = hunt_sitting.settle(conn, row) if row["state"] == "out" else "already ended"
    print(json.dumps({"line": line}))
except Exception as exc:
    print(json.dumps({"raised": f"{type(exc).__name__}: {exc}"}))
`;

runCase(async (t) => {
  const house = await sittingHouse(t, "hunt-overdue");
  const { passId } = await addPass(house, "code", FILES);
  const L = (n) => `dispatch-hunter-case-overdue-${n}`;
  // The out sittings' limits passed long ago, grace and the soul's late start (child.pid written now) both counted:
  // a limit still ahead is overdue's NOT YET and re-arm, never a stop (hunt_sitting.overdue).
  const PAST_LIMIT = -24 * 60;
  const out = await addSitting(house, { hunt: "code", passId, launchId: L(1), minutes: PAST_LIMIT });
  const strange = await addSitting(house, { hunt: "code", passId, launchId: L(2), minutes: PAST_LIMIT });
  const ended = await addSitting(house, { hunt: "code", passId, launchId: L(3), state: "ended" });
  const procs = [standIn(house, L(1)), standIn(house, L(2), { identity: false }), standIn(house, L(3))];
  try {
    const kids = await Promise.all(procs.map((p) => p.grandchild));
    if (kids.some((k) => !Number.isInteger(k))) return broken("a stand-in did not start its sleep — the case cannot judge");
    for (const [i, p] of procs.entries()) await writePids(house, L(i + 1), p.pid);
    const wrong = [];

    const notOut = await hunt(house, ["overdue", String(ended)]);
    if (notOut.code !== 0 || !notOut.out.trim()) wrong.push(`overdue of an ended sitting answered ${said(notOut)}, not a line at exit 0`);
    const stranger = await hunt(house, ["overdue", String(strange)]);
    await new Promise((r) => setTimeout(r, 1500));
    if (!alive(procs[1].pid) || !alive(kids[1])) wrong.push(`overdue of a sitting whose pid file names a stranger signalled the stranger (${said(stranger)})`);
    if (!alive(procs[2].pid) || !alive(kids[2])) wrong.push("overdue of an ended sitting signalled its launch's process");

    const ran = await hunt(house, ["overdue", String(out)]);
    const ending = await Promise.race([procs[0].ended, new Promise((r) => setTimeout(() => r(null), 15000))]);
    if (!ending) wrong.push(`overdue of an out sitting answered ${said(ran)} and its launch was still running 15 s later`);
    else if (ending.signal !== "SIGTERM") wrong.push(`the out sitting's launch ended ${JSON.stringify(ending)}, not by SIGTERM`);
    if (!(await until(() => !alive(kids[0]), 10000))) {
      wrong.push("the sleep the launch forked into its group outlived the overdue — the signal was not sent to the group");
    }
    if (ran.code !== 0) wrong.push(`overdue of an out sitting exited ${ran.code}: ${said(ran)}`);

    const settled = await sittingPy(house, SETTLE, [String(out)]);
    if (settled.json?.missing) wrong.push(settled.json.missing);
    else if (settled.json?.raised) wrong.push(`settle after overdue raised ${settled.json.raised}`);
    const row = (await rows(house, "SELECT state, outcome, cause FROM hunt_sittings WHERE id = ?", [out]))[0];
    if (row.state !== "ended" || row.outcome !== "stopped") wrong.push(`after overdue and its settle the sitting reads ${row.state}/${row.outcome} (${JSON.stringify(row.cause)}), not ended/stopped`);

    if (wrong.length) return broken(wrong.join("; "));
    return held(`ended sitting: "${notOut.out.trim()}" at exit 0, nothing signalled; the stranger untouched; the out launch's group ended by SIGTERM and settled stopped`);
  } finally {
    for (const p of procs) await endStandIn(p);
  }
});
