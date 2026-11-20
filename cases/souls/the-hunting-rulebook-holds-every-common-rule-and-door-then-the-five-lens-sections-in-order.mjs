// charters/HUNTING.md is the bug hunters' rulebook, read whole into every sitting's brief: a common part, then one
// section per lens under `## security`, `## behaviour`, `## ui`, `## data`, `## code`. This case reads the live file
// and holds it to the rules seam 7 says the common part carries and the words each lens section must give its hunter:
// the verbs a hunter types (hunt next, hunt clock, hunt covered --note, hunt skipped --reason), the three doors
// (bug file, bug propose --kind too-big|design with --join and --stopgap-for, bug file --needs-you), the priorities,
// the already-filed rule, the no-Gemini rule, the limits the rail cannot see (git apply among them) and no homeowner's
// name in a ticket. An edit that drops a door, a verb or a lens heading breaks every later sitting's brief.
//
// protects: /home/lyphe/.claude/charters/HUNTING.md
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { KINDS, RULEBOOK, rulebook } from "../lib/hunt_brief_house.mjs";

const COMMON = [
  "hunt next", "hunt clock", "STOP", "bug file", "bug propose", "--kind too-big", "design", "--join", "--stopgap-for",
  "--needs-you", "hunt covered", "--note", "hunt skipped", "--reason", "already filed", "high", "medium", "low",
  "Gemini", "git apply", "homeowner", "read-only", "/tmp",
];
const LENS = {
  security: ["who", "trust", "leak", "credential"],
  behaviour: ["live", "read-only", "says"],
  ui: ["1440", "390", "light", "dark", "--shot"],
  data: ["orphan", "duplicate", "impossible", "source", "door (b)"],
  code: ["branch", "swallowed", "race", "dead"],
};

runCase(async () => {
  const book = rulebook();
  if (book.fault) return broken(book.fault);
  const wrong = [];
  const headings = book.text.split("\n").filter((l) => /^## \S/.test(l)).map((l) => l.slice(3).trim());
  const lensHeadings = headings.filter((h) => KINDS.includes(h));
  if (JSON.stringify(lensHeadings) !== JSON.stringify(KINDS)) wrong.push(`the lens headings read ${JSON.stringify(lensHeadings)}, not each of ${KINDS.join(", ")} once in that order`);
  const missing = COMMON.filter((w) => !book.common.includes(w));
  if (missing.length) wrong.push(`the common part never says ${missing.map((w) => `"${w}"`).join(", ")}`);
  for (const kind of KINDS) {
    const section = book.lenses[kind] ?? "";
    const lacks = LENS[kind].filter((w) => !section.toLowerCase().includes(w.toLowerCase()));
    if (!section) wrong.push(`## ${kind} has no body`);
    else if (lacks.length) wrong.push(`## ${kind} never says ${lacks.map((w) => `"${w}"`).join(", ")}`);
  }
  if (wrong.length) return broken(`${RULEBOOK}: ${wrong.join("; ")}`);
  return held(`${RULEBOOK}: the five lens sections in order, the common part naming all ${COMMON.length} of its rules' words, each lens its own`);
});
