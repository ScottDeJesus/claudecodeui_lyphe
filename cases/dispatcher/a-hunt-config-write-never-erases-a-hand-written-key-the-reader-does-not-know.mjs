// `dispatcher hunt config` is the one writer of charters/hunts.toml, and the file says a project, its folder and its
// databases are edited by HAND. The writer refuses over a file whose read fell back, but a key the reader does not
// know raises no fallback at all: a misspelled project `exlude` reads as "no exclude" with no stderr line, and the
// next write renders only the keys it knows, so the hand-written line is gone, at exit 0, with nothing said.
// The promise: a write over such a file either refuses (one REFUSED hunt config: line at exit 2, the file keeping
// every byte) or keeps both hand-written lines.
//
// One scratch file: the seam's four projects, with `exlude = ["src/**"]` added to CloudCLI's block and
// `note = "hand note"` at the top. It is written with `--turns hunter`, which touches no crontab door.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_config.py, /home/lyphe/.claude/hooks/dispatcher/hunt_config_write.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py
// writes: none

import fs from "node:fs";

import { broken, held, runCase } from "../lib/case.mjs";
import { SEAM_TOML, hunt, huntHouse, liveCrontab, refusals } from "../lib/hunt_house.mjs";

const ANCHORS = [
  ['name = "CloudCLI"\n', 'name = "CloudCLI"\nexlude = ["src/**"]\n'],
  ["nightly = false\n", 'nightly = false\nnote = "hand note"\n'],
];
const HAND_LINES = ['exlude = ["src/**"]', 'note = "hand note"'];

runCase(async (t) => {
  const crontabBefore = await liveCrontab();
  let text = SEAM_TOML;
  for (const [from, to] of ANCHORS) {
    if (!text.includes(from)) return broken(`the seam's file no longer holds ${JSON.stringify(from)} to edit`);
    text = text.replace(from, to);
  }
  const house = await huntHouse(t, "hunt-unknown-key", { text });
  const before = fs.readFileSync(house.config);
  const ran = await hunt(house, ["config", "--turns", "hunter"]);
  const lines = refusals(ran);
  const after = fs.readFileSync(house.config);
  const kept = HAND_LINES.filter((line) => after.toString("utf8").split("\n").includes(line));
  if ((await liveCrontab()) !== crontabBefore) return broken("THE OPERATOR'S CRONTAB CHANGED during the case");
  if (ran.code === 2 && lines.length === 1 && lines[0].startsWith("REFUSED hunt config: ")) {
    if (!after.equals(before)) return broken(`the write was refused (${lines[0]}) but the file changed`);
    return held(`a write over a file with keys the reader does not know was refused and the file kept every byte — ${lines[0]}`);
  }
  if (ran.code === 0 && kept.length === HAND_LINES.length) {
    return held("the write landed and kept both hand-written lines (exlude in CloudCLI's block, note at the top)");
  }
  const lost = HAND_LINES.filter((line) => !kept.includes(line));
  return broken(`--turns hunter exited ${ran.code} with ${JSON.stringify(lines)}, and the file lost ${JSON.stringify(lost)} — `
    + `a hand-written key the reader does not know was erased by the write, with stderr ${JSON.stringify(ran.err.trim())}`);
});
