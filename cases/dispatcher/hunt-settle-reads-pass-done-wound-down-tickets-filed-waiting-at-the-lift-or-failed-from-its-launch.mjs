// `hunt_sitting.settle(conn, sitting)` (hooks/dispatcher/hunt_sitting.py) closes an out sitting in ONE act from its
// launch's result.json (`record.read_result`): `pass done` when its pass has no open unit left (and the pass is made
// `done`); `wound down` when it ended done after its clock said STOP for the deadline; `tickets filed` when the STOP was
// the night's ticket cap; `waiting` when the launch met a Claude usage limit (`resets_at`), the cause naming the lift
// and `schedule.arm_retry(home, "hunt", <night>, lift)` arming the wake; `failed` with the cause for anything else.
// Every settle leaves the row `ended` and disarms the sitting's hunt-overdue unit.
//
// The systemd seams are recorders (hunt_sitting_house.mjs STUBS): nothing reaches the user manager.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_sitting.py, /home/lyphe/.claude/hooks/dispatcher/store_hunts.py, /home/lyphe/.claude/hooks/dispatcher/schedule.py, /home/lyphe/.claude/hooks/plan_runner/solo/record.py
// writes: none

import { exec, rows } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { addPass, addSitting, addTicket, FILES } from "../lib/hunt_marks_house.mjs";
import { lastLine } from "../lib/hunt_map_house.mjs";
import { sittingHouse, sittingPy, writeResult } from "../lib/hunt_sitting_house.mjs";

const SETTLE = `
hunt_sitting, why = load_sitting()
if hunt_sitting is None:
    print(json.dumps({"missing": why}))
    raise SystemExit(0)
from dispatcher import store, store_hunts
conn = store.connect()
got = {}
for sid in json.loads(sys.argv[1]):
    CALLS["systemctl"].clear()
    try:
        line = hunt_sitting.settle(conn, store_hunts.sitting(conn, sid))
    except Exception as exc:
        got[str(sid)] = {"raised": f"{type(exc).__name__}: {exc}"}
        continue
    got[str(sid)] = {"line": line, "disarmed": stopped_overdue()}
print(json.dumps({"got": got, "retry": CALLS["arm_retry"], "units": CALLS["systemd_run"]}))
`;

runCase(async (t) => {
  const house = await sittingHouse(t, "hunt-settle", { tickets: 2 });
  const lift = Math.floor(Date.now() / 60000) * 60 + 3 * 3600;        // a round minute three hours on
  const whole = await addPass(house, "code", ["a.py"]);
  const open = await addPass(house, "security", FILES);
  const L = (n) => `dispatch-hunter-case-settle-${n}`;
  const S = {
    passDone: await addSitting(house, { hunt: "code", passId: whole.passId, launchId: L(1) }),
    woundDown: await addSitting(house, { hunt: "security", passId: open.passId, launchId: L(2), minutes: -5 }),
    tickets: await addSitting(house, { hunt: "security", passId: open.passId, launchId: L(3) }),
    waiting: await addSitting(house, { hunt: "security", passId: open.passId, launchId: L(4) }),
    failed: await addSitting(house, { hunt: "security", passId: open.passId, launchId: L(5) }),
  };
  await exec(house, "UPDATE hunt_units SET state = 'covered', note = 'read it', marked_at = ?, sitting_id = ?, handed = 1 WHERE pass_id = ?",
    ["2026-11-19T01:00:00Z", S.passDone, whole.passId]);
  await addTicket(house, { title: "one", sittingId: S.tickets, hunt: "security" });
  await addTicket(house, { title: "two", sittingId: S.tickets, hunt: "security" });
  await writeResult(house, L(1), { status: "done", result_text: "every unit marked" });
  await writeResult(house, L(2), { status: "done", result_text: "the clock said STOP" });
  await writeResult(house, L(3), { status: "done", result_text: "the clock said STOP" });
  await writeResult(house, L(4), { status: "api_error", cause: "api_error: usage limit", api_error_status: 429,
    resets_at: lift, limit: "Claude usage limit reached", limit_source: "ratelimit" });
  await writeResult(house, L(5), { status: "failed", cause: "idle cap: no output for 1200 s" });

  const ran = await sittingPy(house, SETTLE, [JSON.stringify(Object.values(S))]);
  if (ran.json?.missing) return broken(ran.json.missing);
  if (!ran.json?.got) return broken(`the settle script did not answer — ${lastLine(ran)}`);
  const wrong = [];
  const row = async (id) => (await rows(house, "SELECT * FROM hunt_sittings WHERE id = ?", [id]))[0];
  const expect = { passDone: "pass done", woundDown: "wound down", tickets: "tickets filed", waiting: "waiting", failed: "failed" };
  for (const [name, id] of Object.entries(S)) {
    const g = ran.json.got[String(id)];
    const r = await row(id);
    if (g?.raised) { wrong.push(`${name}: settle raised ${g.raised}`); continue; }
    if (r.state !== "ended" || r.outcome !== expect[name] || !r.ended_at) wrong.push(`${name}: the row reads ${r.state}/${r.outcome}/${r.ended_at ?? "no ended_at"}, not ended/${expect[name]}`);
    if (typeof g?.line !== "string" || !g.line.trim()) wrong.push(`${name}: settle answered no line (${JSON.stringify(g?.line)})`);
    if (!g?.disarmed) wrong.push(`${name}: settle stopped no hunt-overdue unit`);
  }
  const pass = (await rows(house, "SELECT state, done_at FROM hunt_passes WHERE id = ?", [whole.passId]))[0];
  if (pass.state !== "done" || !pass.done_at) wrong.push(`the pass with no open unit reads ${pass.state}/${pass.done_at}, not done`);
  const still = (await rows(house, "SELECT state FROM hunt_passes WHERE id = ?", [open.passId]))[0];
  if (still.state !== "open") wrong.push(`the pass with open units was made ${still.state}`);

  const w = await row(S.waiting);
  const d = new Date(lift * 1000);
  const hhmm = (h, m) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const names = [hhmm(d.getUTCHours(), d.getUTCMinutes()), hhmm(d.getHours(), d.getMinutes())];
  if (!names.some((n) => String(w.cause ?? "").includes(n))) wrong.push(`the waiting cause ${JSON.stringify(w.cause)} names neither ${names.join(" nor ")}`);
  const retry = ran.json.retry;
  if (retry.length !== 1 || retry[0].verb !== "hunt" || retry[0].target !== house.night || Math.abs(retry[0].epoch - lift) > 120) {
    wrong.push(`arm_retry was called ${JSON.stringify(retry)}, not once as (home, "hunt", "${house.night}", ${lift})`);
  }
  const f = await row(S.failed);
  if (!String(f.cause ?? "").includes("idle cap")) wrong.push(`the failed cause ${JSON.stringify(f.cause)} does not carry the launch's cause`);

  if (wrong.length) return broken(wrong.join("; "));
  return held(`pass done (pass made done), wound down, tickets filed, waiting ("${w.cause}", one arm_retry at the lift), failed ("${f.cause}"); each ended and disarmed`);
});
