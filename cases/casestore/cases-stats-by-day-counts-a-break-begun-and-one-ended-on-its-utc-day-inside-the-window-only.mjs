// `cases stats` counts breaks per UTC day: `broke` is a run that did not hold right after a held run of the same case,
// `held_again` a run that held right after one that did not; a case's first run is neither, and only days of the window
// are named.
//
// In a scratch home (lib/cases_stats_house.mjs), with --days 30: broke 1 on each of D-7, D-4, D-2 and D-1, held_again
// 1 on D-1 (cured-one), nothing else anywhere — the `cant` case's first run is a cannot-run and counts nowhere, and
// old-ruled's break (D-40) and its end (D-39) lie outside. Each named day is unique and inside the 30 days. With
// --days 60 the old break is counted: broke 1 on D-40, held_again 1 on D-39.
//
// protects: /home/lyphe/.claude/hooks/cases/stats.py, /home/lyphe/.claude/hooks/cases/cmd/stats.py
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { said } from "../lib/bug_house.mjs";
import { dayBack, stats, statsHouse } from "../lib/cases_stats_house.mjs";

const show = (o) => JSON.stringify(o);

/** `{ day: [broke, held_again] }` of the non-zero days, or the reason the list is malformed. */
function read(byDay, days) {
  if (!Array.isArray(byDay)) return { why: `by_day is ${show(byDay)}, not a list` };
  const first = dayBack(days - 1);
  const last = dayBack(0);
  const seen = new Set();
  const counts = {};
  for (const e of byDay) {
    if (seen.has(e.day)) return { why: `by_day names ${e.day} twice` };
    seen.add(e.day);
    if (!(e.day >= first && e.day <= last)) return { why: `by_day names ${e.day}, outside the ${days} days ${first}..${last}` };
    if (e.broke || e.held_again) counts[e.day] = [e.broke, e.held_again];
  }
  return { counts };
}

runCase(async (t) => {
  const h = await statsHouse(t, "stats-by-day");

  const ran = await stats(h, ["--days", "30"]);
  if (ran.code !== 0 || !ran.json) return broken(`cases stats --days 30 --json did not answer — ${said(ran)}`);
  const got = read(ran.json.by_day, 30);
  if (got.why) return broken(got.why);
  const want = { [dayBack(7)]: [1, 0], [dayBack(4)]: [1, 0], [dayBack(2)]: [1, 0], [dayBack(1)]: [1, 1] };
  if (show(Object.entries(got.counts).sort()) !== show(Object.entries(want).sort())) {
    return broken(`by_day over 30 days counts ${show(got.counts)} as [broke, held_again], not ${show(want)}`);
  }

  const wide = await stats(h, ["--days", "60"]);
  const got60 = read(wide.json?.by_day, 60);
  if (wide.code !== 0 || got60.why) return broken(got60.why ?? `cases stats --days 60 failed — ${said(wide)}`);
  const want60 = { ...want, [dayBack(40)]: [1, 0], [dayBack(39)]: [0, 1] };
  if (show(Object.entries(got60.counts).sort()) !== show(Object.entries(want60).sort())) {
    return broken(`by_day over 60 days counts ${show(got60.counts)}, not ${show(want60)}`);
  }
  return held(`30 days: broke on ${dayBack(7)}, ${dayBack(4)}, ${dayBack(2)}, ${dayBack(1)} and held again on ${dayBack(1)}, ` +
    `no first run counted; 60 days adds broke ${dayBack(40)} and held again ${dayBack(39)}`);
});
