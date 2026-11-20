// `dispatcher hunt turns [--turns project|hunter|nightly]` (hooks/dispatcher/cmd/hunt.py) prints the turns in the
// order `hunt_turns.order` gives them now, under the file's `turns` word or the one `--turns` names, and writes
// nothing: no pass is mapped or opened for a turn that has none, no night is opened, and charters/hunts.toml is not
// rewritten (`--turns` reads another rule; only `hunt config --turns` changes the word). A turn line is read as the
// one line naming exactly one hunt and one project, so the case leans on no layout beyond "one turn to a line".
// The store holds an earlier night led by code, so the nightly lead is security and the three rules differ.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py, /home/lyphe/.claude/hooks/dispatcher/hunt_turns.py
// writes: none

import crypto from "node:crypto";
import fs from "node:fs";

import { broken, held, runCase } from "../lib/case.mjs";
import { said } from "../lib/bug_house.mjs";
import { hunt } from "../lib/hunt_house.mjs";
import { lastLine } from "../lib/hunt_map_house.mjs";
import { sayList, turnsHouse, turnsPy } from "../lib/hunt_turns_house.mjs";

const SEED = String.raw`
reset()
night("2000-01-01")
sitting("2000-01-01", "code", "Zulu", "pass done")
pass_("code", "Zulu", 1, "done", "2026-11-01T00:00:00Z")
pass_("security", "Alpha", 1, "open")
print(json.dumps({"seeded": True}))
`;
const SNAPSHOT = String.raw`
names = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")]
print(json.dumps({n: [list(r) for r in conn.execute(f"SELECT * FROM \"{n}\" ORDER BY rowid")] for n in names}))
`;
const WANT = {
  project: ["security·Zulu", "code·Alpha", "security·Alpha", "code·Zulu"],
  hunter: ["code·Alpha", "security·Zulu", "security·Alpha", "code·Zulu"],
  nightly: ["security·Zulu", "security·Alpha", "code·Alpha", "code·Zulu"],
};
const KINDS = ["security", "behaviour", "ui", "data", "code"];
const NAMES = ["Zulu", "Alpha"];

function turnLines(ran) {
  const found = [];
  for (const line of ran.out.split("\n")) {
    const kinds = KINDS.filter((k) => new RegExp(`\\b${k}\\b`).test(line));
    const names = NAMES.filter((n) => new RegExp(`\\b${n}\\b`).test(line));
    if (kinds.length === 1 && names.length === 1) found.push(`${kinds[0]}·${names[0]}`);
  }
  return found;
}

runCase(async (t) => {
  const house = await turnsHouse(t, "turns-verb", {
    projects: [{ name: "Zulu" }, { name: "Alpha" }], order: ["code", "security"], turns: "project",
  });
  const seeded = await turnsPy(house, SEED);
  if (!seeded.json?.seeded) return broken(`the scratch store could not be seeded — ${seeded.json?.import_error ?? lastLine(seeded)}`);
  const before = await turnsPy(house, SNAPSHOT);
  const fileBefore = crypto.createHash("sha256").update(fs.readFileSync(house.config)).digest("hex");
  const wrong = [];
  const runs = [["(the file's word)", [], "project"], ...Object.keys(WANT).map((r) => [`--turns ${r}`, ["--turns", r], r])];
  for (const [label, args, rule] of runs) {
    const ran = await hunt(house, ["turns", ...args]);
    const got = turnLines(ran);
    if (ran.code !== 0) wrong.push(`hunt turns ${label} — ${said(ran)}`);
    else if (JSON.stringify(got) !== JSON.stringify(WANT[rule])) wrong.push(`hunt turns ${label} printed ${sayList(got, WANT[rule])}`);
  }
  const bad = await hunt(house, ["turns", "--turns", "sideways"]);
  if (bad.code !== 2) wrong.push(`hunt turns --turns sideways — ${said(bad)}, not exit 2`);
  const after = await turnsPy(house, SNAPSHOT);
  if (!before.json || !after.json) wrong.push(`the store could not be read back — ${lastLine(after)}`);
  else if (JSON.stringify(before.json) !== JSON.stringify(after.json)) {
    const moved = Object.keys(after.json).filter((n) => JSON.stringify(after.json[n]) !== JSON.stringify(before.json[n]));
    wrong.push(`the store changed under hunt turns: ${moved.join(", ")}`);
  }
  const fileAfter = crypto.createHash("sha256").update(fs.readFileSync(house.config)).digest("hex");
  if (fileAfter !== fileBefore) wrong.push("hunts.toml was rewritten by hunt turns");
  if (wrong.length) return broken(wrong.join("; "));
  return held("hunt turns printed the project walk under the file's word and each rule's walk under --turns (nightly from security, after 2000-01-01's lead code), the re-hunt last; --turns sideways exited 2; the store's rows and hunts.toml's bytes were as before");
});
