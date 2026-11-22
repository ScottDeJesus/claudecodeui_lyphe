// `dispatcher hunt config` reads the file, runs the crontab door (a tsx start-up: one to several seconds), then writes
// the file whole from what it read before the door. A second write that lands inside that window — Settings sends one
// field at a time — is put back by the first's late write: it exited 0 and said its value, and the file no longer
// holds it. The promise: two writes in the door's window both land.
//
// The window is made certain, not raced: the scratch home's HOME holds a stand-in crontab door at
// ~/.claude/scripts/cron-registry-sync (the path `cron_door.door()` expands) that marks a file when it is called, waits
// two seconds and answers `add ok`. It writes no tab and no registry; the real door is never run, and the operator's
// crontab is only read, to show it never moved.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py, /home/lyphe/.claude/hooks/dispatcher/hunt_config_write.py, /home/lyphe/.claude/hooks/dispatcher/hunt_cron.py
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { said } from "../lib/bug_house.mjs";
import { configJson, hunt, huntHouse, liveCrontab } from "../lib/hunt_house.mjs";

const DOOR_SECONDS = 2;

async function until(check, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

runCase(async (t) => {
  const crontabBefore = await liveCrontab();
  const house = await huntHouse(t, "hunt-config-race");
  const home = path.join(house.dir, "home-dir");
  const mark = path.join(house.dir, "door-called");
  fs.mkdirSync(path.join(home, ".claude", "scripts"), { recursive: true });
  const door = path.join(home, ".claude", "scripts", "cron-registry-sync");
  fs.writeFileSync(door, `#!/bin/sh\n: > '${mark}'\nsleep ${DOOR_SECONDS}\n`
    + `echo "add ok name='bug-hunters' schedule='15 1 * * *' command='x' table=$5 log=none tags=[] crontab=written row=stand-in"\n`);
  fs.chmodSync(door, 0o755);
  house.env.HOME = home;

  let slowEnded = false;
  const slow = hunt(house, ["config", "--nightly", "on", "--start", "01:15", "--tabfile", house.tab]).then((r) => { slowEnded = true; return r; });
  const inWindow = await until(() => fs.existsSync(mark), 30000);
  if (!inWindow) {
    const r = await slow;
    return cannotRun(`hunt config --nightly on never called the stand-in door at ${door} — ${said(r)}`);
  }
  if (slowEnded) return cannotRun("the --nightly on write ended before the second write could start inside its door's window");
  const fast = await hunt(house, ["config", "--minutes", "90"]);
  const first = await slow;

  const wrong = [];
  if (first.code !== 0) wrong.push(`--nightly on --start 01:15 failed — ${said(first)}`);
  if (fast.code !== 0) wrong.push(`--minutes 90 inside the door's window failed — ${said(fast)}`);
  const read = await configJson(house);
  const got = { nightly: read?.nightly, start: read?.start, minutes: read?.minutes };
  if (got.nightly !== true || got.start !== "01:15" || got.minutes !== 90) {
    wrong.push(`after both ended the file reads ${JSON.stringify(got)}, not {"nightly":true,"start":"01:15","minutes":90}`);
  }
  if ((await liveCrontab()) !== crontabBefore) wrong.push("THE OPERATOR'S CRONTAB CHANGED during the case");
  if (wrong.length) return broken(wrong.join("; "));
  return held("a --minutes 90 written while --nightly on waited two seconds on its door kept its 90, and the file reads nightly true, start 01:15");
});
