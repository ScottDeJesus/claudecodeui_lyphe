// `dispatcher hunt covered UNIT... --note WORDS` (hooks/dispatcher/hunt_marks.py) must never take the hunter's own
// `hunt covered` call as the evidence that a unit was opened: that call's tool_use line is already in child.log while it
// runs, so if it counts, every unit proves itself. hunt_marks drops a Bash call that runs a hunt verb, but it recognises
// the verb only as the literal text `hunt covered` (`_HUNT_VERB`). MEASURED 2026-11-19: over 300 recent soul logs, 658
// program invocations go through a variable (`DS=~/.claude/scripts/docstore; $DS get …`) and 12 quote the program's
// path. Spelled either way, `hunt covered src/a.py` names src/a.py and nothing in the log opened it.
// A sitting holds three handed units; its child.log holds only three `hunt covered` calls, one per unit: through a
// variable, with the program path quoted, and bare → hunt covered of each → each is REFUSED as not opened, stays open,
// exit 2, COVERED 0.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_marks.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hunt_marks_acts.py
// writes: none

import { rows, said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { addPass, addSitting, handTo, huntAs, refusedLines, writeLog, FILES, marksHouse } from "../lib/hunt_marks_house.mjs";

const NOTE = "read the handler and every caller";
const refusal = (u) => `REFUSED hunt covered: ${u} was not opened in this sitting — open it and hunt it, or mark it skipped with the reason`;

runCase(async (t) => {
  const house = await marksHouse(t, "hunt-covered-own-call");
  const { passId, ids } = await addPass(house, "code", FILES);
  const launch = "dispatch-hephaestus-20261119-030000-ownc";
  const sitting = await addSitting(house, { hunt: "code", passId, launchId: launch });
  const spellings = {
    "src/a.py": `H=~/.claude/scripts/hunt; $H covered src/a.py --note "${NOTE}"`,
    "src/b.py": `"$HOME/.claude/scripts/hunt" covered src/b.py --note "${NOTE}"`,
    "lib/c.py": `~/.claude/scripts/hunt covered lib/c.py --note "${NOTE}"`,
  };
  await handTo(house, sitting, Object.keys(spellings).map((u) => ids[u]));
  await writeLog(house, launch, Object.values(spellings).map((command) => ({ use: { name: "Bash", input: { command } } })));

  const wrong = [];
  for (const [unit, command] of Object.entries(spellings)) {
    const ran = await huntAs(house, sitting, ["covered", unit, "--note", NOTE]);
    const state = (await rows(house, "SELECT state FROM hunt_units WHERE id = ?", [ids[unit]]))[0]?.state;
    if (state !== "open" || ran.code !== 2 || !refusedLines(ran).includes(refusal(unit)) || !/^COVERED 0$/m.test(ran.out)) {
      wrong.push(`${unit}, named only by its own call \`${command.split(" --note")[0]}\`, went ${state} (${said(ran)})`);
    }
  }
  if (wrong.length) return broken(wrong.join("; "));
  return held("each own hunt covered call, through a variable, with the program quoted and bare, was refused as not opened and left its unit open");
});
