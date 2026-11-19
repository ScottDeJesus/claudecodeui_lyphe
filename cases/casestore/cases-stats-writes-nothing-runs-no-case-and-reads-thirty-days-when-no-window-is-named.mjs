// `cases stats` is pure reads: it writes nothing to the store and runs no case, and its window is 30 days when none is
// named.
//
// In a scratch home (lib/cases_stats_house.mjs) holding a suite, runs, triage rows, walk records and tickets: the
// store's whole content is hashed (every table, `iterdump`), then `cases stats --json` and `cases stats --days 7 --json`
// run; the hash and the count of case runs are the same after, the first answer says days 30 and names at most 30
// days, each inside the last 30, and the second says days 7.
//
// protects: /home/lyphe/.claude/hooks/cases/stats.py, /home/lyphe/.claude/hooks/cases/cmd/stats.py
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { said } from "../lib/bug_house.mjs";
import { dayBack, stats, statsHouse, storeDump } from "../lib/cases_stats_house.mjs";

runCase(async (t) => {
  const h = await statsHouse(t, "stats-pure");
  const before = await storeDump(h);

  const plain = await stats(h, []);
  const seven = await stats(h, ["--days", "7"]);
  const after = await storeDump(h);

  if (plain.code !== 0 || !plain.json) return broken(`cases stats --json with no --days did not answer — ${said(plain)}`);
  if (seven.code !== 0 || !seven.json) return broken(`cases stats --days 7 --json did not answer — ${said(seven)}`);
  if (after.runs !== before.runs) return broken(`the store held ${before.runs} case runs before and ${after.runs} after: a case was run`);
  if (after.hash !== before.hash) return broken("the store's content changed across two reads of cases stats: it wrote");

  if (plain.json.days !== 30) return broken(`with no --days the answer says days ${JSON.stringify(plain.json.days)}, not 30`);
  const days = (plain.json.by_day ?? []).map((e) => e.day);
  const outside = days.filter((d) => !(d >= dayBack(29) && d <= dayBack(0)));
  if (days.length > 30 || outside.length) {
    return broken(`with no --days by_day names ${days.length} days${outside.length ? `, ${outside[0]} outside the last 30` : ""}`);
  }
  if (seven.json.days !== 7) return broken(`--days 7 answers days ${JSON.stringify(seven.json.days)}`);
  return held(`two reads left the store's ${before.runs} runs and its content hash unchanged; no --days reads 30 (${days.length} days named), --days 7 reads 7`);
});
