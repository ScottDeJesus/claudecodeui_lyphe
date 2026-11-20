// `hunt_rule.sweep(conn, pace_ctx)` (hooks/dispatcher/hunt_rule.py) is the daemon's hunt half, called after the cards'
// sweep, and seam 6 fixes its order: it takes the FIRST of these that applies —
//   no open night: nothing · a sitting out whose launch is gone: settle it · a sitting out and alive: nothing ·
//   minutes left under min_left: close `time spent` · two sittings of the night ended failed: close
//   `the hunters keep failing: <the last cause>` · then the turns, the hold, the start.
// This case walks the first five on one scratch store, each step a fresh sweep in a child Python. `hunt_sitting.start`
// is replaced with a recorder BEFORE hunt_rule is imported, so a step that wrongly fell through to a turn is seen as a
// recorded start and no hunter is ever launched. The systemd seams are stubs (hunt_sitting_house.mjs STUBS). The pacer
// context handed is None: every step here is decided before the hold, and the house's sweeps take `Context | None`.
//
// The live launch is a stand-in carrying the launch's identity (`record.owns`); "gone" is that stand-in ended, its
// result.json written. Every stand-in is ended in `finally`.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_rule.py, /home/lyphe/.claude/hooks/dispatcher/hunt_sitting.py, /home/lyphe/.claude/hooks/dispatcher/daemon_hunts.py
// writes: none

import { exec, rows } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { lastLine } from "../lib/hunt_map_house.mjs";
import { addPass, addSitting, FILES } from "../lib/hunt_marks_house.mjs";
import { alive, endStandIn, sittingHouse, sittingPy, standIn, until, writePids, writeResult } from "../lib/hunt_sitting_house.mjs";

const SWEEP = `
from dispatcher import hunt_sitting as _hs
STARTS = []
def _start(conn, night, hunt, project, pass_id, *a, **k):
    STARTS.append({"night": night, "hunt": hunt, "project": project, "pass_id": pass_id})
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
    lines = hunt_rule.sweep(conn, None)
    print(json.dumps({"lines": [str(l) for l in (lines or [])], "starts": STARTS}))
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

const nightOf = async (house, night) => (await rows(house, "SELECT state, why FROM hunt_nights WHERE night = ?", [night]))[0];

async function twoFailed(house, night, minutes) {
  await exec(house, "INSERT INTO hunt_nights (night, opened_at, minutes, state) VALUES (?, ?, ?, 'open')", [night, iso(-900000), minutes]);
  for (const [n, cause] of [[2, "first cause"], [1, "second cause"]]) {
    await exec(house,
      "INSERT INTO hunt_sittings (night, hunt, project, soul, model, state, outcome, cause, started_at, ended_at) " +
      "VALUES (?, 'code', '/nowhere', 'hephaestus', 'sonnet', 'ended', 'failed', ?, ?, ?)",
      [night, cause, iso(-(n * 120000 + 60000)), iso(-n * 120000)]);
  }
}

runCase(async (t) => {
  const house = await sittingHouse(t, "hunt-sweep-order");
  const launch = "dispatch-hunter-case-sweep-1";
  const proc = standIn(house, launch);
  try {
    const kid = await proc.grandchild;
    if (!Number.isInteger(kid)) return broken("the stand-in did not start its sleep — the case cannot judge");
    const wrong = [];
    const step = async (name, check) => {
      const got = await sweep(house);
      if (got.fault) { wrong.push(`${name}: ${got.fault}`); return null; }
      if (got.starts.length) wrong.push(`${name}: the sweep fell through to a turn and started ${JSON.stringify(got.starts)}`);
      await check(got);
      return got;
    };

    // 1. No open night: nothing.
    await exec(house, "UPDATE hunt_nights SET state = 'closed', closed_at = ?, why = 'case' WHERE night = ?", [iso(0), house.night]);
    await step("no open night", async (got) => {
      if (got.lines.length) wrong.push(`no open night: the sweep said ${JSON.stringify(got.lines)}, not nothing`);
      const n = (await rows(house, "SELECT count(*) AS n FROM hunt_sittings"))[0].n;
      if (n) wrong.push(`no open night: the sweep wrote ${n} sitting row(s)`);
    });
    await exec(house, "UPDATE hunt_nights SET state = 'open', closed_at = NULL, why = NULL WHERE night = ?", [house.night]);

    // 2. A sitting out on a live launch: nothing — one soul at a time.
    const { passId } = await addPass(house, "code", FILES);
    const id = await addSitting(house, { hunt: "code", passId, launchId: launch, minutes: 60 });
    await writePids(house, launch, proc.pid);
    await step("a sitting out and alive", async (got) => {
      if (got.lines.length) wrong.push(`a sitting out and alive: the sweep said ${JSON.stringify(got.lines)}, not nothing`);
      const s = (await rows(house, "SELECT state FROM hunt_sittings WHERE id = ?", [id]))[0];
      const n = await nightOf(house, house.night);
      if (s.state !== "out" || n.state !== "open") wrong.push(`a sitting out and alive: the sweep left the sitting ${s.state} and the night ${JSON.stringify(n)}`);
      if (!alive(proc.pid)) wrong.push("a sitting out and alive: the sweep ended its launch");
    });

    // 3. The same sitting once its launch is gone: settled, and nothing else in that sweep.
    await endStandIn(proc);
    if (!(await until(() => !alive(proc.pid), 10000))) return broken("the stand-in would not end — the case cannot judge");
    await writeResult(house, launch, { status: "done" });
    await step("a sitting out whose launch is gone", async (got) => {
      const s = (await rows(house, "SELECT state, outcome FROM hunt_sittings WHERE id = ?", [id]))[0];
      if (s.state !== "ended") wrong.push(`a sitting out whose launch is gone: the sweep left it ${JSON.stringify(s)}, not settled ended`);
      if (!got.lines.length) wrong.push("a sitting out whose launch is gone: the sweep settled it without a line for the daemon's log");
    });

    // 4. Minutes left under min_left (15 of the seam's 20): closed `time spent`.
    await exec(house, "UPDATE hunt_nights SET minutes = 15 WHERE night = ?", [house.night]);
    await step("minutes under min_left", async () => {
      const n = await nightOf(house, house.night);
      if (n.state !== "closed" || n.why !== "time spent") wrong.push(`a night of 15 minutes under min_left 20 reads ${JSON.stringify(n)}, not closed "time spent"`);
    });

    // 5. Two sittings of the night ended failed (120 minutes, an open pass still waiting): closed with the newer cause.
    await twoFailed(house, "2026-12-01", 120);
    await step("two failed sittings", async () => {
      const n = await nightOf(house, "2026-12-01");
      const want = "the hunters keep failing: second cause";
      if (n.state !== "closed" || n.why !== want) wrong.push(`a night with two failed sittings reads ${JSON.stringify(n)}, not closed "${want}"`);
    });

    // 6. Short AND failing: the earlier rule, `time spent`, is the one taken.
    await twoFailed(house, "2026-12-02", 15);
    await step("short and failing", async () => {
      const n = await nightOf(house, "2026-12-02");
      if (n.state !== "closed" || n.why !== "time spent") wrong.push(`a night both under min_left and twice failed reads ${JSON.stringify(n)}, not closed "time spent" (the earlier rule)`);
    });

    if (wrong.length) return broken(wrong.join("; "));
    return held("no night: nothing; live sitting: nothing; gone sitting: settled, no start; 15 of min_left 20: closed time spent; two failed: closed with the newer cause; short and failing: time spent first");
  } finally {
    await endStandIn(proc);
  }
});
