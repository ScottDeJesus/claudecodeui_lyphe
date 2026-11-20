// `dispatcher hunt config` is the one writer of charters/hunts.toml, and the file says a project, its folder and its
// databases are added by HAND. A hand edit can go wrong: a TOML typo makes the whole file read the defaults (no
// projects at all), and one bad value in a project block drops that project on the read. The writer renders what it
// READ, so a write over such a file silently rewrites the operator's projects away. The promise: a write over a file
// that does not read whole is refused, one REFUSED line at exit 2, and the file keeps every byte.
//
// Two scratch files, each the seam's four projects with one hand edit gone wrong: an unclosed quote on a project's
// name (not TOML), and a relative path on a project (that project dropped on the read). Each is then written with
// `--turns hunter`, which touches no crontab door.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_config.py, /home/lyphe/.claude/hooks/dispatcher/hunt_config_write.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py
// writes: none

import fs from "node:fs";

import { broken, held, runCase } from "../lib/case.mjs";
import { SEAM_TOML, hunt, huntHouse, liveCrontab, refusals } from "../lib/hunt_house.mjs";

const EDITS = [
  ["a TOML typo", 'name = "Restorly app"\n', 'name = "Restorly app\n'],
  ["a relative project path", 'path = "/opt/eis-app"\n', 'path = "opt/eis-app"\n'],
];

runCase(async (t) => {
  const crontabBefore = await liveCrontab();
  const wrong = [];
  const saw = [];
  for (const [label, from, to] of EDITS) {
    if (!SEAM_TOML.includes(from)) return broken(`the seam's file no longer holds ${JSON.stringify(from)} to edit`);
    const house = await huntHouse(t, `hunt-bad-edit-${label.replace(/\W+/g, "-")}`, { text: SEAM_TOML.replace(from, to) });
    const before = fs.readFileSync(house.config);
    const ran = await hunt(house, ["config", "--turns", "hunter"]);
    const lines = refusals(ran);
    const after = fs.readFileSync(house.config);
    const projects = (after.toString("utf8").match(/^\[\[project\]\]$/gm) ?? []).length;
    if (ran.code !== 2 || lines.length !== 1 || !lines[0].startsWith("REFUSED hunt config: ")) {
      wrong.push(`over ${label}, --turns hunter exited ${ran.code} with ${JSON.stringify(lines)}, not one REFUSED hunt config: line at exit 2`);
    }
    if (!after.equals(before)) wrong.push(`over ${label}, the write changed the file (it now holds ${projects} of the 4 [[project]] blocks)`);
    else saw.push(`${label}: ${lines[0]}`);
  }
  if ((await liveCrontab()) !== crontabBefore) wrong.push("THE OPERATOR'S CRONTAB CHANGED during the case");
  if (wrong.length) return broken(wrong.join("; "));
  return held(`a write over a file that does not read whole was refused and the file kept every byte — ${saw.join(" | ")}`);
});
