// The hunter's four verbs (hooks/dispatcher/hunt_marks.py, cmd/hunt.py) read their sitting from
// DISPATCHER_HUNT_SITTING alone: without it each of next, covered, skipped and clock is the one line
// `REFUSED hunt <verb>: no sitting in this environment`, exit 2, and no unit moves. With it, `hunt skipped` marks only
// an open unit HANDED TO THIS SITTING in THIS SITTING's pass and keeps the reason as its note (SKIPPED <n>): a unit never
// handed, one handed to another sitting, and the same-named unit of another hunt's pass are refused and left as they
// were. A --note or --reason is 1 to 300 characters: empty or 301 is refused and writes nothing; 300 is taken.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_marks.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py, /home/lyphe/.claude/hooks/dispatcher/store_hunts.py
// writes: none

import path from "node:path";

import { said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { addPass, addSitting, handTo, huntAs, refusedLines, unitsOf, writeLog, FILES, marksHouse } from "../lib/hunt_marks_house.mjs";

const pick = (u) => Object.fromEntries(Object.entries(u).map(([k, r]) => [k, [r.state, r.note, r.sitting_id, r.handed]]));
const same = (a, b) => JSON.stringify(pick(a)) === JSON.stringify(pick(b));

runCase(async (t) => {
  const house = await marksHouse(t, "hunt-marks-refused");
  const code = await addPass(house, "code", FILES);
  const sec = await addPass(house, "security", ["src/a.py"]);
  const L = "dispatch-hephaestus-20261119-050000-refuse";
  const s = await addSitting(house, { hunt: "code", passId: code.passId, launchId: L });
  const other = await addSitting(house, { hunt: "code", passId: code.passId, launchId: null });
  await handTo(house, s, [code.ids["src/a.py"], code.ids["src/b.py"]]);
  await handTo(house, other, [code.ids["lib/c.py"]]);
  // A call counts as evidence only once its result is in the log (hunt_marks.opened), so the Read carries one.
  await writeLog(house, L, [
    { use: { name: "Read", input: { file_path: path.join(house.repo, "src/b.py") } } },
    { result: "x = 1" },
  ]);
  const wrong = [];

  const before = await unitsOf(house);
  for (const [verb, args] of [["next", []], ["covered", ["src/b.py", "--note", "x"]], ["skipped", ["src/a.py", "--reason", "x"]], ["clock", []]]) {
    const ran = await huntAs(house, null, [verb, ...args]);
    if (ran.code !== 2 || !refusedLines(ran).includes(`REFUSED hunt ${verb}: no sitting in this environment`)) wrong.push(`${verb} with no sitting answered ${said(ran)}`);
  }
  if (!same(await unitsOf(house), before)) wrong.push("a verb run with no sitting moved a unit");

  for (const [label, args] of [
    ["skipped of a unit never handed", ["skipped", "lib/d.py", "--reason", "too big"]],
    ["skipped of a unit handed to another sitting", ["skipped", "lib/c.py", "--reason", "too big"]],
    ["skipped with an empty reason", ["skipped", "src/a.py", "--reason", ""]],
    ["skipped with a 301-character reason", ["skipped", "src/a.py", "--reason", "r".repeat(301)]],
    ["covered with an empty note", ["covered", "src/b.py", "--note", ""]],
    ["covered with a 301-character note", ["covered", "src/b.py", "--note", "n".repeat(301)]],
  ]) {
    const ran = await huntAs(house, s, args);
    if (ran.code !== 2 || refusedLines(ran).length === 0) wrong.push(`${label} answered ${said(ran)}, not a refusal at exit 2`);
  }
  if (!same(await unitsOf(house), before)) wrong.push("a refused mark moved a unit");

  const skip = await huntAs(house, s, ["skipped", "src/a.py", "--reason", "a generated blob, unreadable"]);
  const cov = await huntAs(house, s, ["covered", "src/b.py", "--note", "n".repeat(300)]);
  const after = await unitsOf(house);
  const a = after[`${code.passId}:src/a.py`];
  if (skip.code !== 0 || !/^SKIPPED 1$/m.test(skip.out) || a?.state !== "skipped" || a?.note !== "a generated blob, unreadable") wrong.push(`skipped of its own handed unit answered ${said(skip)} and left it ${JSON.stringify([a?.state, a?.note])}`);
  if (after[`${sec.passId}:src/a.py`]?.state !== "open") wrong.push(`the security pass's src/a.py went ${after[`${sec.passId}:src/a.py`]?.state}`);
  if (cov.code !== 0 || !/^COVERED 1$/m.test(cov.out) || after[`${code.passId}:src/b.py`]?.state !== "covered") wrong.push(`covered with a 300-character note answered ${said(cov)}`);
  for (const u of ["lib/c.py", "lib/d.py"]) if (after[`${code.passId}:${u}`]?.state !== "open") wrong.push(`${u} went ${after[`${code.passId}:${u}`]?.state}`);

  if (wrong.length) return broken(wrong.join("; "));
  return held("with no sitting all four verbs refused in one line at exit 2; unhanded, another sitting's and out-of-bounds marks were refused with no row moved; skipped kept its reason (SKIPPED 1) and left the security pass's src/a.py open; a 300-character note was taken");
});
