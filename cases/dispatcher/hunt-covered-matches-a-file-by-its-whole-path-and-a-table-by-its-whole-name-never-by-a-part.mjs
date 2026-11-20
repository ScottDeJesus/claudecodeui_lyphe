// `dispatcher hunt covered` (hooks/dispatcher/hunt_marks.py `opened`) matches a FILE unit by its path inside the
// project or its absolute path, as a WHOLE path: a tool call reading <proj>/src/a.py names src/a.py and not the root
// a.py whose path is its tail; `cat lib/c.py` names lib/c.py and not the root c.py; `cat lib/d.py.bak` names no unit.
// A TABLE unit (`<database>.<table>`, in a data sitting) is matched by its table name as a whole word: a query of
// `users` names board.users, and `cards_archive` or `scorecards` do not name board.cards.
// Each call in the logs carries its result, as a real stream does: a call with no result yet is the one still running,
// and counts for nothing.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_marks.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py
// writes: none

import path from "node:path";

import { rows, said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { addPass, addSitting, handTo, huntAs, writeLog, marksHouse } from "../lib/hunt_marks_house.mjs";

const FILES = ["a.py", "src/a.py", "c.py", "lib/c.py", "lib/d.py", "web/e.py"];
const NOTE = "walked every branch";

runCase(async (t) => {
  const house = await marksHouse(t, "hunt-covered-whole", { files: FILES });
  const wrong = [];
  const stateOf = async (passId) => Object.fromEntries((await rows(house, "SELECT unit, state FROM hunt_units WHERE pass_id = ?", [passId])).map((r) => [r.unit, r.state]));

  const code = await addPass(house, "code", FILES);
  const L1 = "dispatch-hephaestus-20261119-030000-whole";
  const s1 = await addSitting(house, { hunt: "code", passId: code.passId, launchId: L1 });
  const asked = ["src/a.py", "lib/c.py", "a.py", "c.py", "lib/d.py"];
  await handTo(house, s1, asked.map((u) => code.ids[u]));
  await writeLog(house, L1, [
    { use: { name: "Read", input: { file_path: path.join(house.repo, "src/a.py") } } },
    { result: "x = 1" },
    { use: { name: "Bash", input: { command: `cd ${house.repo} && cat lib/c.py && cat lib/d.py.bak 2>/dev/null` } } },
    { result: "x = 1" },
  ]);
  const ran = await huntAs(house, s1, ["covered", ...asked, "--note", NOTE]);
  const got = await stateOf(code.passId);
  const want = { "src/a.py": "covered", "lib/c.py": "covered", "a.py": "open", "c.py": "open", "lib/d.py": "open" };
  for (const [u, s] of Object.entries(want)) if (got[u] !== s) wrong.push(`${u} went ${got[u]}, not ${s}`);
  if (ran.code !== 2 || !/^COVERED 2$/m.test(ran.out)) wrong.push(`covered of the five files answered ${said(ran)}, not COVERED 2 at exit 2`);

  const data = await addPass(house, "data", ["board.cards", "board.users"]);
  const L2 = "dispatch-sherlock-20261119-030000-tables";
  const s2 = await addSitting(house, { hunt: "data", passId: data.passId, launchId: L2 });
  await handTo(house, s2, [data.ids["board.cards"], data.ids["board.users"]]);
  await writeLog(house, L2, [
    { use: { name: "Bash", input: { command: "sqlite3 -readonly /tmp/x/auth.db 'SELECT count(*) FROM cards_archive; SELECT * FROM users LIMIT 5'" } } },
    { result: "0" },
    { use: { name: "Bash", input: { command: "sqlite3 -readonly /tmp/x/auth.db 'SELECT * FROM scorecards'" } } },
    { result: "0" },
  ]);
  const tabled = await huntAs(house, s2, ["covered", "board.cards", "board.users", "--note", NOTE]);
  const tg = await stateOf(data.passId);
  if (tg["board.users"] !== "covered") wrong.push(`board.users, queried as users, went ${tg["board.users"]}`);
  if (tg["board.cards"] !== "open") wrong.push(`board.cards, named only inside cards_archive and scorecards, went ${tg["board.cards"]}`);
  if (tabled.code !== 2 || !/^COVERED 1$/m.test(tabled.out)) wrong.push(`covered of the two tables answered ${said(tabled)}, not COVERED 1 at exit 2`);

  if (wrong.length) return broken(wrong.join("; "));
  return held("src/a.py (absolute) and lib/c.py (relative) covered while a.py, c.py and lib/d.py (a tail, a tail, a .bak) stayed open; board.users covered and board.cards, inside cards_archive and scorecards only, stayed open");
});
