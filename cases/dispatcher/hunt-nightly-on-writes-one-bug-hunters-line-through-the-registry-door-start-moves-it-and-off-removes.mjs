// The night's clock is one crontab line, written and removed only through the registry's door
// (`scripts/cron-registry-sync add` / `remove --name bug-hunters`). `--nightly on --start 01:15` leaves exactly one
// line at minute 15, hour 1, every day, running the night's command, and one registry row named bug-hunters;
// `--start` while on MOVES that one line (never a second); `--nightly off` takes the line and the row away. The FILE
// says nightly and start as each act left it. A scratch tab (--tabfile) and a scratch registry (DATABASE_PATH) carry
// the door's two halves; the operator's crontab is only read, to show it never moved.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py, /home/lyphe/.claude/hooks/dispatcher/hunt_config.py, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/schedules/schedules-cli.ts, /home/lyphe/.claude/scripts/cron-registry-sync
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { said } from "../lib/bug_house.mjs";
import { NIGHT_COMMAND, configJson, hunt, huntHouse, liveCrontab, nightLines, registryRows } from "../lib/hunt_house.mjs";

function looks(lines) {
  return JSON.stringify(lines.map((l) => `${l.minute} ${l.hour} ${l.rest} ${l.command}`));
}

runCase(async (t) => {
  const house = await huntHouse(t, "hunt-nightly");
  const crontabBefore = await liveCrontab();
  const wrong = [];

  const steps = [
    { args: ["--nightly", "on", "--start", "01:15"], line: [15, 1], nightly: true, start: "01:15" },
    { args: ["--start", "02:05"], line: [5, 2], nightly: true, start: "02:05" },
    { args: ["--nightly", "off"], line: null, nightly: false, start: "02:05" },
  ];
  for (const step of steps) {
    const ran = await hunt(house, ["config", ...step.args, "--tabfile", house.tab]);
    const name = step.args.join(" ");
    if (ran.code !== 0) { wrong.push(`${name} failed — ${said(ran)}`); break; }
    const lines = nightLines(house.tab);
    const rows = await registryRows(house);
    if (step.line) {
      const [minute, hour] = step.line;
      const one = lines.length === 1 && lines[0].minute === minute && lines[0].hour === hour && lines[0].rest === "* * *" && lines[0].command === NIGHT_COMMAND;
      if (!one) wrong.push(`after ${name} the tab's night lines read ${looks(lines)}, not one line at ${minute} ${hour} * * * running the night's command`);
      if (rows.length !== 1 || rows[0][1] !== NIGHT_COMMAND) wrong.push(`after ${name} the registry holds ${JSON.stringify(rows)}, not one bug-hunters row for the night's command`);
    } else {
      if (lines.length !== 0) wrong.push(`after ${name} the tab still holds ${looks(lines)}`);
      if (rows.length !== 0) wrong.push(`after ${name} the registry still holds ${JSON.stringify(rows)}`);
    }
    const read = await configJson(house);
    if (read?.nightly !== step.nightly || read?.start !== step.start) wrong.push(`after ${name} the file reads nightly ${read?.nightly}, start ${read?.start}`);
  }

  if ((await liveCrontab()) !== crontabBefore) wrong.push("THE OPERATOR'S CRONTAB CHANGED during the case");
  if (wrong.length) return broken(wrong.join("; "));
  return held("on at 01:15 wrote one 15 1 * * * line and one bug-hunters row; --start 02:05 moved it to 5 2; off removed both; the file followed each act and the live crontab never moved");
});
