// The door first, the file second: when the registry's door refuses, `dispatcher hunt config` says the door's own
// sentence as its one refusal and leaves hunts.toml as it was. The door is made to refuse by handing it a --tabfile
// that is a directory, which it cannot read (measured 2026-11-20: `cron-registry-sync: EISDIR: illegal operation
// on a directory, read`, exit 1). A scratch hunts.toml and scratch registry; the operator's crontab is only read.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py, /home/lyphe/.claude/scripts/cron-registry-sync
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { said } from "../lib/bug_house.mjs";
import { configJson, hunt, huntHouse, liveCrontab, refusals } from "../lib/hunt_house.mjs";

runCase(async (t) => {
  const house = await huntHouse(t, "hunt-door-refuses");
  const crontabBefore = await liveCrontab();
  const tabDir = path.join(house.dir, "tab-is-a-folder");
  fs.mkdirSync(tabDir);
  const before = fs.readFileSync(house.config);
  const wrong = [];

  const ran = await hunt(house, ["config", "--nightly", "on", "--start", "01:15", "--tabfile", tabDir]);
  const lines = refusals(ran);
  if (ran.code !== 2) wrong.push(`a refused door left hunt config exiting ${ran.code}, not 2 — ${said(ran)}`);
  if (lines.length !== 1 || !lines[0].startsWith("REFUSED hunt config: ")) wrong.push(`it said ${JSON.stringify(lines)}, not one REFUSED hunt config: line`);
  else if (!/EISDIR|directory/i.test(lines[0])) wrong.push(`its refusal ${JSON.stringify(lines[0])} does not carry the door's sentence`);
  if (!fs.readFileSync(house.config).equals(before)) wrong.push("hunts.toml changed though the door refused");
  const read = await configJson(house);
  if (read?.nightly !== false || read?.start !== "00:30") wrong.push(`the file now reads nightly ${read?.nightly}, start ${read?.start}`);

  if ((await liveCrontab()) !== crontabBefore) wrong.push("THE OPERATOR'S CRONTAB CHANGED during the case");
  if (wrong.length) return broken(wrong.join("; "));
  return held(`the door's refusal came back as ${JSON.stringify(lines[0]).slice(0, 140)} at exit 2 and hunts.toml was byte-identical`);
});
