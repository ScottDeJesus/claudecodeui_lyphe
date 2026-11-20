// `dispatcher hunt next [--count N]` (hooks/dispatcher/hunt_marks.py, store_hunts.next_open/hand) hands the sitting's
// pass's OPEN units: those already handed to this sitting first, then by position, at most N (the config's batch when
// no --count). It stamps sitting_id, handed_at and handed + 1 on the newly handed only — a unit handed to an ended
// sitting is taken over (handed 2); asking again stamps nothing. Under each unit: `  already filed: "<title>"` for each
// OPEN ticket whose title or words name it and each OPEN proposal with a finding on it — a closed ticket and a dismissed
// proposal are not listed. With no open unit left: `NOTHING LEFT — mark what you hold and end your turn`.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_marks.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py, /home/lyphe/.claude/hooks/dispatcher/store_hunts.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/dispatcher/store_proposals.py
// writes: none

import { exec, rows, said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { addPass, addProposal, addSitting, addTicket, handTo, huntAs, FILES, marksHouse } from "../lib/hunt_marks_house.mjs";

// FILES by position: 1 a.py, 2 src/a.py, 3 src/b.py, 4 lib/c.py, 5 lib/d.py, 6 web/e.py
const isUnitLine = (l) => l.length > 0 && !/^\s/.test(l);
const unitLines = (ran) => ran.out.split("\n").filter(isUnitLine).map((l) => l.trim()).filter((l) => FILES.includes(l));
function filedUnder(ran) {
  const under = {};
  let current = null;
  for (const l of ran.out.split("\n")) {
    if (isUnitLine(l) && FILES.includes(l.trim())) { current = l.trim(); under[current] = []; continue; }
    const m = l.match(/^\s+already filed: "(.*)"$/);
    if (m && current) under[current].push(m[1]);
  }
  return under;
}

runCase(async (t) => {
  const house = await marksHouse(t, "hunt-next", { batch: 2 });
  const { passId, ids } = await addPass(house, "code", FILES);
  const gone = await addSitting(house, { hunt: "code", passId, launchId: null, state: "ended" });
  const s = await addSitting(house, { hunt: "code", passId, launchId: "dispatch-hephaestus-20261119-040000-next" });
  await handTo(house, s, [ids["lib/d.py"]]);
  await handTo(house, gone, [ids["a.py"]]);
  await addTicket(house, { title: "crash in lib/d.py on an empty row", words: "seen in lib/d.py line 2" });
  await addTicket(house, { title: "old fault", words: "src/a.py once failed", state: "closed" });
  await addProposal(house, { title: "Rework the parser", unit: "src/a.py" });
  await addProposal(house, { title: "A dismissed idea", unit: "lib/d.py", state: "dismissed" });
  const handed = async () => Object.fromEntries((await rows(house, "SELECT unit, handed, sitting_id FROM hunt_units WHERE pass_id = ?", [passId])).map((r) => [r.unit, `${r.handed}@${r.sitting_id}`]));
  const wrong = [];

  const first = await huntAs(house, s, ["next", "--count", "3"]);
  const order = unitLines(first).join(",");
  if (first.code !== 0 || order !== "lib/d.py,a.py,src/a.py") wrong.push(`next --count 3 answered ${said(first)} — units ${order}, not lib/d.py,a.py,src/a.py`);
  const after1 = await handed();
  const want1 = { "lib/d.py": `1@${s}`, "a.py": `2@${s}`, "src/a.py": `1@${s}`, "src/b.py": "0@null", "lib/c.py": "0@null", "web/e.py": "0@null" };
  for (const [u, w] of Object.entries(want1)) if (after1[u] !== w) wrong.push(`after the first next ${u} is handed ${after1[u]}, not ${w}`);
  const under = filedUnder(first);
  if (JSON.stringify(under["lib/d.py"] ?? []) !== JSON.stringify(["crash in lib/d.py on an empty row"])) wrong.push(`under lib/d.py: ${JSON.stringify(under["lib/d.py"])}, not the open ticket alone (the dismissed proposal is not listed)`);
  if (JSON.stringify(under["src/a.py"] ?? []) !== JSON.stringify(["Rework the parser"])) wrong.push(`under src/a.py: ${JSON.stringify(under["src/a.py"])}, not the open proposal alone (the closed ticket is not listed)`);

  const again = await huntAs(house, s, ["next", "--count", "3"]);
  // All three are now held by this sitting, so they come back by position.
  if (unitLines(again).join(",") !== "a.py,src/a.py,lib/d.py") wrong.push(`asked again, next handed ${unitLines(again).join(",")}, not the three it holds by position`);
  const after2 = await handed();
  if (JSON.stringify(after2) !== JSON.stringify(after1)) wrong.push(`asking again re-stamped: ${JSON.stringify(after2)}`);

  const batch = await huntAs(house, s, ["next"]);
  if (unitLines(batch).join(",") !== "a.py,src/a.py") wrong.push(`next with no --count (batch 2) handed ${unitLines(batch).join(",")}, not a.py,src/a.py`);

  await exec(house, "UPDATE hunt_units SET state = 'covered', note = 'by hand', marked_at = '2026-11-19T00:00:00Z' WHERE pass_id = ?", [passId]);
  const none = await huntAs(house, s, ["next"]);
  if (none.code !== 0 || !none.out.includes("NOTHING LEFT — mark what you hold and end your turn")) wrong.push(`with every unit marked next answered ${said(none)}`);

  if (wrong.length) return broken(wrong.join("; "));
  return held("next handed lib/d.py (held) then a.py and src/a.py, stamping the two new only (a.py taken over at 2); asking again gave back the three it holds by position and stamped nothing; batch 2 was the default; only the open ticket and open proposal were listed as already filed; NOTHING LEFT once all were marked");
});
