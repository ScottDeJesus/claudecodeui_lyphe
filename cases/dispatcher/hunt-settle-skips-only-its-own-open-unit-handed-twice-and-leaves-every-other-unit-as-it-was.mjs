// In the same act that closes a sitting, `hunt_sitting.settle` (hooks/dispatcher/hunt_sitting.py) marks `skipped`,
// with the note `handed to two sittings and never marked`, each unit THIS sitting was handed that is still `open` with
// `handed` at 2 or more — so no file pins a pass (INV-78). Every other unit is left exactly as it was: one handed once
// stays open, one already covered stays covered with its note, and one handed three times but last to ANOTHER
// sitting is not this sitting's to skip.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_sitting.py, /home/lyphe/.claude/hooks/dispatcher/store_hunts.py
// writes: none

import { exec, rows } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { addPass, addSitting, FILES } from "../lib/hunt_marks_house.mjs";
import { lastLine } from "../lib/hunt_map_house.mjs";
import { sittingHouse, sittingPy, writeResult } from "../lib/hunt_sitting_house.mjs";

const SETTLE = `
hunt_sitting, why = load_sitting()
if hunt_sitting is None:
    print(json.dumps({"missing": why}))
    raise SystemExit(0)
from dispatcher import store, store_hunts
conn = store.connect()
try:
    line = hunt_sitting.settle(conn, store_hunts.sitting(conn, int(sys.argv[1])))
    print(json.dumps({"line": line}))
except Exception as exc:
    print(json.dumps({"raised": f"{type(exc).__name__}: {exc}"}))
`;

runCase(async (t) => {
  const house = await sittingHouse(t, "hunt-settle-twice");
  const { passId, ids } = await addPass(house, "code", FILES);
  const launch = "dispatch-hunter-case-twice-1";
  const s = await addSitting(house, { hunt: "code", passId, launchId: launch });
  const other = await addSitting(house, { hunt: "code", passId, launchId: null, state: "ended" });
  const set = (unit, fields) => exec(house,
    "UPDATE hunt_units SET sitting_id = ?, handed = ?, state = ?, note = ?, handed_at = '2026-11-19T00:40:00Z', marked_at = ? WHERE id = ?",
    [fields.sitting, fields.handed, fields.state, fields.note ?? null, fields.state === "open" ? null : "2026-11-19T00:50:00Z", ids[unit]]);
  await set("a.py", { sitting: s, handed: 2, state: "open" });
  await set("src/a.py", { sitting: s, handed: 1, state: "open" });
  await set("src/b.py", { sitting: s, handed: 2, state: "covered", note: "read every branch" });
  await set("lib/c.py", { sitting: other, handed: 3, state: "open" });
  await writeResult(house, launch, { status: "failed", cause: "crashed: exit 1" });
  const before = Object.fromEntries((await rows(house, "SELECT * FROM hunt_units WHERE pass_id = ?", [passId])).map((r) => [r.unit, r]));

  const ran = await sittingPy(house, SETTLE, [String(s)]);
  if (ran.json?.missing) return broken(ran.json.missing);
  if (ran.json?.raised) return broken(`settle raised ${ran.json.raised}`);
  if (ran.json?.line === undefined) return broken(`the settle script did not answer — ${lastLine(ran)}`);
  const after = Object.fromEntries((await rows(house, "SELECT * FROM hunt_units WHERE pass_id = ?", [passId])).map((r) => [r.unit, r]));
  const wrong = [];
  const twice = after["a.py"];
  if (twice.state !== "skipped" || twice.note !== "handed to two sittings and never marked" || !twice.marked_at) {
    wrong.push(`the open unit handed twice reads ${twice.state} / ${JSON.stringify(twice.note)}, not skipped / "handed to two sittings and never marked"`);
  }
  for (const unit of FILES.filter((u) => u !== "a.py")) {
    const keep = ["state", "note", "sitting_id", "handed", "marked_at"];
    const moved = keep.filter((k) => before[unit][k] !== after[unit][k]);
    if (moved.length) wrong.push(`${unit} (${before[unit].state}, handed ${before[unit].handed}) changed ${moved.map((k) => `${k} ${JSON.stringify(before[unit][k])}→${JSON.stringify(after[unit][k])}`).join(", ")}`);
  }
  const row = (await rows(house, "SELECT state FROM hunt_sittings WHERE id = ?", [s]))[0];
  if (row.state !== "ended") wrong.push(`the sitting reads ${row.state} after its settle`);
  if (wrong.length) return broken(wrong.join("; "));
  return held("only the open unit handed twice was skipped with its reason; the once-handed, the covered and another sitting's unit kept every column");
});
