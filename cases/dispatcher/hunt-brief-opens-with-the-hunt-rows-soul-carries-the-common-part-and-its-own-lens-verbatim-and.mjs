// `dispatcher hunt brief HUNT PROJECT` (hooks/dispatcher/cmd/hunt_acts.py over hooks/dispatcher/hunt_brief.py) prints
// the brief a sitting of that hunt would be launched with now. Its first line is `<Soul>: hunt <kind> — <project
// name>`, the soul read from the launch table's hunt row (here a scratch table giving hunt.code to daedalus, so a
// brief that hard-wires the shipped soul is caught); then the live rulebook's common part and the one lens section of
// its kind, each VERBATIM as charters/HUNTING.md holds it, and no line that only another lens's section says. The
// verb writes nothing: every hunt, proposal and ticket row of the scratch store reads the same after it.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_brief.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hunt_acts.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py, /home/lyphe/.claude/charters/HUNTING.md
// writes: none

import path from "node:path";

import { said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { setProjects } from "../lib/hunt_map_house.mjs";
import { KINDS, brief, briefHouse, ownLines, rulebook, snapshot } from "../lib/hunt_brief_house.mjs";

runCase(async (t) => {
  const book = rulebook();
  if (book.fault) return broken(book.fault);
  const house = await briefHouse(t, "hunt-brief-verbatim", [], { code: "daedalus" });
  setProjects(house, [{ name: "Outer", path: path.join(house.dir, "outer") }]);
  const before = await snapshot(house);
  const ran = await brief(house, "code", "Outer");
  const after = await snapshot(house);
  const wrong = [];
  if (ran.code !== 0) return broken(`hunt brief code Outer answered ${said(ran)}`);
  const first = ran.out.split("\n")[0];
  if (first !== "Daedalus: hunt code — Outer") wrong.push(`its first line is ${JSON.stringify(first)}, not "Daedalus: hunt code — Outer"`);
  if (!ran.out.includes(book.common)) wrong.push("it does not hold the rulebook's common part verbatim");
  if (!ran.out.includes(book.lenses.code)) wrong.push("it does not hold the rulebook's ## code section verbatim");
  for (const kind of KINDS.filter((k) => k !== "code")) {
    const theirs = ownLines(book.lenses[kind] ?? "", [book.common, book.lenses.code]);
    const leaked = theirs.filter((l) => ran.out.includes(l));
    if (leaked.length) wrong.push(`it carries ${leaked.length} line(s) only ## ${kind} says, first ${JSON.stringify(leaked[0].slice(0, 80))}`);
  }
  if (before !== after) wrong.push("the store's hunt, proposal or ticket rows changed across it");
  if (wrong.length) return broken(wrong.join("; "));
  return held(`first line "${first}", the common part and ## code verbatim, no other lens's own line, the store unchanged`);
});
