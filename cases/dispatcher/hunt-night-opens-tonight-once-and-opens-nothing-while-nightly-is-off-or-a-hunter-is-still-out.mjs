// `dispatcher hunt night [--now] [--minutes N]` (hooks/dispatcher/cmd/hunt.py) opens tonight's night, the one row the
// crontab line and Settings' "Run a night now" both write. Seam 6 states its four answers: nightly off and no --now
// prints `hunt night: nightly is off` (exit 0, nothing written); a sitting still out prints `hunt night: last night's
// hunter is still out — tonight opens nothing` (exit 0, nothing written); otherwise an open night of an earlier date is
// closed `the next night opened` and tonight's row is written with the config's minutes or --minutes; a second run the
// same night changes nothing.
//
// Three scratch homes (huntHouse via mapHouse): the kick each run ends with is declined, because DISPATCHER_SCRATCH_DAEMON
// is never set, so no daemon starts. "Tonight" is the box's local date, read the way the dispatcher reads it.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py, /home/lyphe/.claude/hooks/dispatcher/store_hunts.py
// writes: none

import fs from "node:fs";

import { exec, rows, said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { hunt } from "../lib/hunt_house.mjs";
import { lastLine, mapHouse, py } from "../lib/hunt_map_house.mjs";

const EARLIER = "2026-01-02";
const OFF = "hunt night: nightly is off";
const STILL_OUT = "hunt night: last night's hunter is still out — tonight opens nothing";

async function home(t, label) {
  const house = await mapHouse(t, label);
  delete house.env.DISPATCHER_SCRATCH_DAEMON;
  const made = await py(house, "import datetime, json\nfrom dispatcher import store\nstore.connect().close()\nprint(json.dumps(datetime.date.today().isoformat()))");
  if (made.code !== 0 || typeof made.json !== "string") throw new Error(`the scratch store could not be made — ${lastLine(made)}`);
  house.today = made.json;
  return house;
}

const nights = (house) => rows(house, "SELECT night, minutes, state, opened_at, why FROM hunt_nights ORDER BY night");
const text = (ran) => `${ran.out}\n${ran.err}`;

runCase(async (t) => {
  const wrong = [];

  // 1. Nightly off (the seam's file), no --now: the sentence, exit 0, no night.
  const a = await home(t, "hunt-night-off");
  const off = await hunt(a, ["night"]);
  if (off.code !== 0 || !text(off).includes(OFF)) wrong.push(`bare hunt night with nightly off answered ${said(off)}, not "${OFF}" at exit 0`);
  if ((await nights(a)).length) wrong.push(`bare hunt night with nightly off wrote a night: ${JSON.stringify(await nights(a))}`);

  // 2. Nightly on in the file: a bare run opens tonight with the config's minutes; a second run changes nothing.
  fs.writeFileSync(a.config, fs.readFileSync(a.config, "utf8").replace(/^nightly = false$/m, "nightly = true").replace(/^minutes = \d+$/m, "minutes = 95"));
  const on = await hunt(a, ["night"]);
  const first = (await nights(a)).find((n) => n.night === a.today);
  if (on.code !== 0) wrong.push(`bare hunt night with nightly on exited ${on.code}: ${said(on)}`);
  if (!first || first.state !== "open" || first.minutes !== 95) wrong.push(`bare hunt night with nightly on left tonight (${a.today}) as ${JSON.stringify(first ?? null)}, not open at the config's 95 minutes`);
  const again = await hunt(a, ["night", "--now", "--minutes", "40"]);
  const after = await nights(a);
  if (again.code !== 0) wrong.push(`a second hunt night the same night exited ${again.code}: ${said(again)}`);
  if (JSON.stringify(after) !== JSON.stringify(first ? [first] : [])) wrong.push(`a second hunt night the same night changed the nights: ${JSON.stringify(after)}`);

  // 3. A sitting still out (on an earlier night left open): --now opens nothing; once it ended, the earlier night closes.
  const b = await home(t, "hunt-night-out");
  await exec(b, "INSERT INTO hunt_nights (night, opened_at, minutes, state) VALUES (?, '2026-01-02T08:30:00Z', 120, 'open')", [EARLIER]);
  await exec(b, "INSERT INTO hunt_sittings (night, hunt, project, soul, model, state, started_at, deadline) VALUES (?, 'code', '/nowhere', 'hephaestus', 'sonnet', 'out', '2026-01-02T08:31:00Z', '2026-01-02T10:30:00Z')", [EARLIER]);
  const out = await hunt(b, ["night", "--now", "--minutes", "15"]);
  const whileOut = await nights(b);
  if (out.code !== 0 || !text(out).includes(STILL_OUT)) wrong.push(`hunt night --now with a sitting out answered ${said(out)}, not "${STILL_OUT}" at exit 0`);
  if (whileOut.length !== 1 || whileOut[0].state !== "open") wrong.push(`hunt night --now with a sitting out changed the nights: ${JSON.stringify(whileOut)}`);

  await exec(b, "UPDATE hunt_sittings SET state = 'ended', outcome = 'failed', ended_at = '2026-01-02T09:00:00Z'");
  const next = await hunt(b, ["night", "--now", "--minutes", "15"]);
  const later = await nights(b);
  const earlier = later.find((n) => n.night === EARLIER);
  const tonight = later.find((n) => n.night === b.today);
  if (next.code !== 0) wrong.push(`hunt night --now --minutes 15 exited ${next.code}: ${said(next)}`);
  if (!earlier || earlier.state !== "closed" || earlier.why !== "the next night opened") wrong.push(`the earlier open night reads ${JSON.stringify(earlier ?? null)}, not closed "the next night opened"`);
  if (!tonight || tonight.state !== "open" || tonight.minutes !== 15) wrong.push(`tonight (${b.today}) reads ${JSON.stringify(tonight ?? null)}, not open at --minutes 15`);

  // 4. --now opens a night while nightly is off, with --minutes.
  const c = await home(t, "hunt-night-now");
  const now = await hunt(c, ["night", "--now", "--minutes", "30"]);
  const opened = (await nights(c)).find((n) => n.night === c.today);
  if (now.code !== 0 || !opened || opened.state !== "open" || opened.minutes !== 30) wrong.push(`hunt night --now --minutes 30 with nightly off answered ${said(now)} and left tonight ${JSON.stringify(opened ?? null)}`);

  if (wrong.length) return broken(wrong.join("; "));
  return held(`off: "${OFF}", nothing written; on: tonight open at the config's 95 minutes, unchanged by a second run; a sitting out: nothing opened; then the earlier night closed "the next night opened" and tonight open at 15; --now opens at 30 while off`);
});
