// The nightly switch has three halves on the live box, and they must say one thing: the file's `nightly` (what governs),
// the crontab line that opens the night (written only through cron-registry-sync), and the Schedules registry's
// bug-hunters row (what the Schedules tab shows). On: exactly one line at start's minute and hour every day running the
// night's command, and exactly one row for it. Off: no such line and no such row. Whatever value the operator chose is
// his; this case judges only that the halves agree. Everything is read; nothing is written.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py, /home/lyphe/.claude/hooks/dispatcher/hunt_cron.py, /home/lyphe/.claude/hooks/dispatcher/hunt_config.py, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/schedules/schedules-cli.ts, /home/lyphe/.claude/scripts/cron-registry-sync, /home/lyphe/.claude/charters/hunts.toml
// writes: none

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { LIVE_BOARD, liveHunt, liveRows, parseJson, run, said } from "../lib/hunting_live.mjs";

const NIGHT_COMMAND = "/home/lyphe/.claude/scripts/dispatcher hunt night >> /home/lyphe/.claude/state/dispatcher/hunt.log 2>&1";

runCase(async () => {
  const ran = await liveHunt(["config", "--json"]);
  const config = parseJson(ran);
  if (ran.code !== 0 || config === null) return cannotRun(`dispatcher hunt config --json did not answer — ${said(ran)}`);
  const clock = /^(\d{2}):(\d{2})$/.exec(String(config.start));
  if (!clock) return broken(`the live config's start reads ${JSON.stringify(config.start)}, not HH:MM`);
  const [hour, minute] = [Number(clock[1]), Number(clock[2])];

  const tab = await run("crontab", ["-l"]);
  const tabText = tab.code === 0 ? tab.out : "";
  const lines = tabText.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("hunt night"));
  const rows = await liveRows(LIVE_BOARD,
    "SELECT name, expression, command FROM cron_jobs WHERE name = 'bug-hunters' OR command LIKE '%hunt night%'");

  const wrong = [];
  if (config.nightly === true) {
    const want = `${minute} ${hour} * * * ${NIGHT_COMMAND}`;
    const shaped = lines.map((l) => { const f = l.split(/\s+/); return `${Number(f[0])} ${Number(f[1])} ${f.slice(2, 5).join(" ")} ${f.slice(5).join(" ")}`; });
    if (shaped.length !== 1 || shaped[0] !== want) wrong.push(`nightly is on at ${config.start} but the crontab's night lines read ${JSON.stringify(lines)}, not the one line "${want}"`);
    const good = rows.filter((r) => r.name === "bug-hunters" && r.command.startsWith("/home/lyphe/.claude/scripts/dispatcher hunt night")
      && r.expression.trim().split(/\s+/).map((x, i) => (i < 2 ? String(Number(x)) : x)).join(" ") === `${minute} ${hour} * * *`);
    if (rows.length !== 1 || good.length !== 1) wrong.push(`nightly is on at ${config.start} but the Schedules registry holds ${JSON.stringify(rows)}, not one bug-hunters row at ${minute} ${hour} * * *`);
  } else if (config.nightly === false) {
    if (lines.length) wrong.push(`nightly is off but the crontab still holds ${JSON.stringify(lines)}`);
    if (rows.length) wrong.push(`nightly is off but the Schedules registry still holds ${JSON.stringify(rows)}`);
  } else {
    wrong.push(`the live config's nightly reads ${JSON.stringify(config.nightly)}, not true or false`);
  }
  if (wrong.length) return broken(wrong.join("; "));
  return held(config.nightly
    ? `nightly on at ${config.start}: one crontab line and one bug-hunters registry row, both at ${minute} ${hour} * * *`
    : "nightly off: no night line in the crontab and no bug-hunters row in the Schedules registry");
});
