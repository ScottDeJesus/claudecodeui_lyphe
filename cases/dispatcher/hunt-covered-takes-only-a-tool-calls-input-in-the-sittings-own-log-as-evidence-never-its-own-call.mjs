// `dispatcher hunt covered UNIT... --note WORDS` (hooks/dispatcher/hunt_marks.py, cmd/hunt.py) marks a unit covered
// only when the sitting's OWN child.log — found through plan_runner.solo.record from the sitting's launch_id — holds a
// tool call whose INPUT names it. Nothing else is evidence: a unit printed only in a tool RESULT (a grep hit, `hunt
// next`'s own list), named only in the hunter's prose, opened only in another launch's log, or named only by the
// `hunt covered` call itself. That last one is the trap: MEASURED 2026-11-20, a running Bash call's own tool_use line
// is already in child.log while it runs, so the call `hunt covered lib/c.py` names lib/c.py in the very log it is
// judged by. A sitting whose log is missing, or which has no launch at all, covers nothing and does not crash.
// Each refused unit is one REFUSED line and stays open; the exit is 2 when any was refused; COVERED counts the rest.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_marks.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py, /home/lyphe/.claude/hooks/dispatcher/store_hunts.py
// writes: none

import path from "node:path";

import { rows, said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { addPass, addSitting, handTo, huntAs, refusedLines, writeLog, FILES, marksHouse } from "../lib/hunt_marks_house.mjs";

const NOTE = "read the handler and every caller";
const refusal = (u) => `REFUSED hunt covered: ${u} was not opened in this sitting — open it and hunt it, or mark it skipped with the reason`;

runCase(async (t) => {
  const house = await marksHouse(t, "hunt-covered-evidence");
  const abs = (rel) => path.join(house.repo, rel);
  const { ids } = await addPass(house, "code", FILES);
  const L1 = "dispatch-hephaestus-20261119-010000-case1";
  const s1 = await addSitting(house, { hunt: "code", passId: (await rows(house, "SELECT max(id) AS id FROM hunt_passes"))[0].id, launchId: L1 });
  const five = ["src/a.py", "src/b.py", "lib/c.py", "lib/d.py", "web/e.py"];
  await handTo(house, s1, five.map((u) => ids[u]));
  await writeLog(house, L1, [
    { use: { name: "Read", input: { file_path: abs("src/a.py") } } },
    { result: "# src/a.py\nx = 1\n" },
    { use: { name: "Grep", input: { pattern: "x = 1", path: house.repo } } },
    { result: "src/b.py:2:x = 1\nsrc/a.py:2:x = 1\n" },
    { say: "Next I will look at web/e.py." },
    { use: { name: "Bash", input: { command: `~/.claude/scripts/hunt covered ${five.join(" ")} --note "${NOTE}"` } } },
  ]);
  await writeLog(house, "dispatch-hephaestus-20261119-010000-other", [{ use: { name: "Read", input: { file_path: abs("lib/d.py") } } }]);

  const wrong = [];
  const ran = await huntAs(house, s1, ["covered", ...five, "--note", NOTE]);
  const states = Object.fromEntries((await rows(house, "SELECT unit, state, note FROM hunt_units WHERE sitting_id = ?", [s1])).map((r) => [r.unit, r]));
  if (ran.code !== 2) wrong.push(`covered of the five answered ${said(ran)}, not exit 2`);
  if (!/^COVERED 1$/m.test(ran.out)) wrong.push(`covered of the five did not print COVERED 1 (${said(ran)})`);
  if (states["src/a.py"]?.state !== "covered" || states["src/a.py"]?.note !== NOTE) wrong.push(`src/a.py, Read by a tool call, is ${JSON.stringify(states["src/a.py"])}, not covered with the note`);
  const why = { "src/b.py": "named only in a tool result", "lib/c.py": "named only by the hunt covered call itself", "lib/d.py": "opened only in another launch's log", "web/e.py": "named only in the hunter's prose" };
  const refused = refusedLines(ran);
  for (const [u, how] of Object.entries(why)) {
    if (states[u]?.state !== "open") wrong.push(`${u} (${how}) went ${states[u]?.state}`);
    if (!refused.includes(refusal(u))) wrong.push(`${u} (${how}) has no refusal line of its own`);
  }

  const { passId: p2, ids: ids2 } = await addPass(house, "security", ["a.py", "src/a.py"]);
  const s2 = await addSitting(house, { hunt: "security", passId: p2, launchId: "dispatch-argus-20261119-020000-nolog" });
  await handTo(house, s2, [ids2["a.py"]]);
  const nolog = await huntAs(house, s2, ["covered", "a.py", "--note", NOTE]);
  const s3 = await addSitting(house, { hunt: "security", passId: p2, launchId: null });
  await handTo(house, s3, [ids2["src/a.py"]]);
  const nolaunch = await huntAs(house, s3, ["covered", "src/a.py", "--note", NOTE]);
  const p2states = (await rows(house, "SELECT unit, state FROM hunt_units WHERE pass_id = ?", [p2])).map((r) => `${r.unit}:${r.state}`).sort();
  for (const [label, r, u] of [["a sitting whose child.log is missing", nolog, "a.py"], ["a sitting with no launch", nolaunch, "src/a.py"]]) {
    if (r.code !== 2 || !refusedLines(r).includes(refusal(u)) || /Traceback/.test(r.err)) wrong.push(`${label}: covered ${u} answered ${said(r)}, not its refusal at exit 2`);
  }
  if (p2states.join(",") !== "a.py:open,src/a.py:open") wrong.push(`the security pass reads ${p2states.join(",")} after covered with no evidence`);

  if (wrong.length) return broken(wrong.join("; "));
  return held("only src/a.py, Read by a tool call, went covered (COVERED 1, exit 2); a tool result, prose, another launch's log and the hunt covered call itself each refused their unit; a missing log and no launch covered nothing");
});
