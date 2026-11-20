// `dispatcher hunt stop [--now]` (hooks/dispatcher/cmd/hunt.py over hunt_sitting.py) is the operator's "Stop tonight's
// hunt". Seam 6: it closes the open night `stopped by the operator`, so the hunter's next `hunt clock` answers STOP and
// it winds down at its own pace; `--now` also ends the sitting "as `overdue` does" — by identity, SIGTERM to the launch's
// process group — and that ending settles `stopped`.
//
// THE TRAP THIS CASE GUARDS: `hunt overdue` re-arms instead of stopping when the sitting is not past its limit (a
// launch held for CPU, a hunter that began late). The operator's --now must end a sitting with an hour still on its
// deadline. Each sitting here has 60 minutes left.
//
// Two scratch homes (sittingHouse): a stand-in launch carrying the launch's identity, its pid files written, its sleep
// in its own group. systemd seams are stubs in the settle child; DISPATCHER_SCRATCH_DAEMON is unset, so no daemon starts
// and the case settles the sitting itself, as the daemon's pidfd would. Every stand-in is ended in `finally`.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py, /home/lyphe/.claude/hooks/dispatcher/hunt_sitting.py
// writes: none

import { rows, said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { hunt } from "../lib/hunt_house.mjs";
import { addPass, addSitting, FILES, huntAs } from "../lib/hunt_marks_house.mjs";
import { alive, endStandIn, sittingHouse, sittingPy, standIn, until, writePids, writeResult } from "../lib/hunt_sitting_house.mjs";

const WHY = "stopped by the operator";

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

async function setUp(t, label, launch) {
  const house = await sittingHouse(t, label);
  const { passId } = await addPass(house, "code", FILES);
  const id = await addSitting(house, { hunt: "code", passId, launchId: launch, minutes: 60 });
  const proc = standIn(house, launch);
  const kid = await proc.grandchild;
  if (Number.isInteger(kid)) await writePids(house, launch, proc.pid);
  return { house, id, proc, kid };
}

const night = async (house) => (await rows(house, "SELECT state, why FROM hunt_nights WHERE night = ?", [house.night]))[0];

runCase(async (t) => {
  const made = [];
  try {
    const wrong = [];

    // Bare stop: the night closes, the clock says STOP, nothing is signalled, the sitting stays out.
    const a = await setUp(t, "hunt-stop-bare", "dispatch-hunter-case-stop-1");
    made.push(a.proc);
    if (!Number.isInteger(a.kid)) return broken("the stand-in did not start its sleep — the case cannot judge");
    const bare = await hunt(a.house, ["stop"]);
    await new Promise((r) => setTimeout(r, 1500));
    const na = await night(a.house);
    if (bare.code !== 0) wrong.push(`hunt stop exited ${bare.code}: ${said(bare)}`);
    if (na.state !== "closed" || na.why !== WHY) wrong.push(`after hunt stop the night reads ${JSON.stringify(na)}, not closed "${WHY}"`);
    const clock = await huntAs(a.house, a.id, ["clock"]);
    if (!clock.out.trim().startsWith("STOP")) wrong.push(`the sitting's hunt clock after hunt stop answered ${said(clock)}, not STOP`);
    if (!alive(a.proc.pid) || !alive(a.kid)) wrong.push("bare hunt stop signalled the hunter's launch; only --now ends it");
    const sa = (await rows(a.house, "SELECT state, cause FROM hunt_sittings WHERE id = ?", [a.id]))[0];
    if (sa.state !== "out" || sa.cause) wrong.push(`bare hunt stop left the sitting ${JSON.stringify(sa)}, not out with no stop written`);

    // stop --now with 60 minutes on the deadline: the night closes and the launch's group ends by SIGTERM; it settles stopped.
    const launch = "dispatch-hunter-case-stop-2";
    const b = await setUp(t, "hunt-stop-now", launch);
    made.push(b.proc);
    if (!Number.isInteger(b.kid)) return broken("the stand-in did not start its sleep — the case cannot judge");
    const now = await hunt(b.house, ["stop", "--now"]);
    const ending = await Promise.race([b.proc.ended, new Promise((r) => setTimeout(() => r(null), 15000))]);
    const nb = await night(b.house);
    if (now.code !== 0) wrong.push(`hunt stop --now exited ${now.code}: ${said(now)}`);
    if (nb.state !== "closed" || nb.why !== WHY) wrong.push(`after hunt stop --now the night reads ${JSON.stringify(nb)}, not closed "${WHY}"`);
    if (!ending) wrong.push(`hunt stop --now answered ${said(now)} and the launch, with 60 minutes left, was still running 15 s later`);
    else if (ending.signal !== "SIGTERM") wrong.push(`the launch ended ${JSON.stringify(ending)}, not by SIGTERM`);
    if (ending && !(await until(() => !alive(b.kid), 10000))) wrong.push("the sleep in the launch's group outlived stop --now — the group was not signalled");
    if (ending) {
      await writeResult(b.house, launch, { status: "done" });
      const settled = await sittingPy(b.house, SETTLE, [String(b.id)]);
      if (settled.json?.missing) wrong.push(settled.json.missing);
      else if (settled.json?.raised) wrong.push(`settle after stop --now raised ${settled.json.raised}`);
      const sb = (await rows(b.house, "SELECT state, outcome, cause FROM hunt_sittings WHERE id = ?", [b.id]))[0];
      if (sb.state !== "ended" || sb.outcome !== "stopped") wrong.push(`after stop --now and its settle the sitting reads ${JSON.stringify(sb)}, not ended/stopped`);
    }

    if (wrong.length) return broken(wrong.join("; "));
    return held(`stop: night closed "${WHY}", clock "${clock.out.trim()}", launch untouched; stop --now: night closed, the launch's group ended by SIGTERM with an hour left, settled stopped`);
  } finally {
    for (const p of made) await endStandIn(p);
  }
});
