// `cases stats` says the night's regressions: `ruled` counts the `regression` triage rows in the window, `cured` the
// triaged cases that hold now, `open` every case reading `regressed` with its break's start (`due.break_start`), its cure
// walk, that walk's word (`due.cure_state`) and the OPEN ticket holding `case:<repo>:<name>`, and `theirs` is
// `due.theirs` — a case two of whose cure walks have ended.
//
// In a scratch home (lib/cases_stats_house.mjs), with --days 30: regression rows on D-2, D-4, D-7 (two) and D-40, so
// ruled 4 and cured 1 (cured-one; old-ruled holds too but its row is outside); open is regressed-open (broke at its D-2
// run, walk W1 reading `failed`, the open ticket bug file printed) and theirs-one (broke at its D-7 run, its newest walk
// W3, and NO ticket: the one holding its key was cleared); theirs is theirs-one alone. With --days 60, ruled 5, cured 2.
//
// protects: /home/lyphe/.claude/hooks/cases/stats.py, /home/lyphe/.claude/hooks/cases/cmd/stats.py, /home/lyphe/.claude/hooks/cases/due.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/dispatcher/store_case_cures.py
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { said } from "../lib/bug_house.mjs";
import { stats, statsHouse } from "../lib/cases_stats_house.mjs";

const show = (o) => JSON.stringify(o);
// The ticket may be said as its id or as an object carrying it.
const ticketId = (v) => (v === null || v === undefined ? null : typeof v === "object" ? v.id ?? null : v);

runCase(async (t) => {
  const h = await statsHouse(t, "stats-regressions");

  const ran = await stats(h, ["--days", "30"]);
  const reg = ran.json?.regressions;
  if (ran.code !== 0 || !reg) return broken(`cases stats --days 30 --json gave no regressions — ${said(ran)}`);
  if (reg.ruled !== 4 || reg.cured !== 1) {
    return broken(`ruled ${reg.ruled}, cured ${reg.cured} over 30 days — the window holds 4 regression rows and one triaged case (cured-one) holding now`);
  }

  const open = Object.fromEntries((reg.open ?? []).map((o) => [o.name, o]));
  if (show(Object.keys(open).sort()) !== show(["regressed-open", "theirs-one"])) {
    return broken(`open names ${show(Object.keys(open))}, not the two cases reading regressed (regressed-open, theirs-one)`);
  }
  const ro = open["regressed-open"];
  if (ro.suite !== "scratchstats" || !ro.sentence?.includes("regressed-open")) {
    return broken(`regressed-open's suite or sentence is wrong: ${show({ suite: ro.suite, sentence: ro.sentence })}`);
  }
  if (ro.broke_at !== h.at.rob) return broken(`regressed-open broke_at ${show(ro.broke_at)}, not its break's first run ${h.at.rob}`);
  if (ro.walk !== h.walks.w1 || ro.walk_word !== "failed") {
    return broken(`regressed-open's walk reads ${show([ro.walk, ro.walk_word])}, not [${h.walks.w1}, "failed"] from the walk's own record`);
  }
  if (ticketId(ro.ticket) !== h.ticket) return broken(`regressed-open's ticket reads ${show(ro.ticket)}, not the open ticket ${h.ticket} holding its key`);

  const th = open["theirs-one"];
  if (th.broke_at !== h.at.thb) return broken(`theirs-one broke_at ${show(th.broke_at)}, not ${h.at.thb}`);
  if (ticketId(th.ticket) !== null) return broken(`theirs-one names ticket ${show(th.ticket)}, but the only ticket holding its key was cleared — no open ticket holds it`);
  if (![h.walks.w2, h.walks.w3].includes(th.walk)) return broken(`theirs-one's walk reads ${show(th.walk)}, neither of its two cure walks`);

  const theirs = reg.theirs ?? [];
  if (theirs.length !== 1 || theirs[0].name !== "theirs-one" || theirs[0].broke_at !== h.at.thb || theirs[0].suite !== "scratchstats") {
    return broken(`theirs reads ${show(theirs)}, not theirs-one alone, broke at ${h.at.thb}`);
  }

  const wide = await stats(h, ["--days", "60"]);
  const r60 = wide.json?.regressions;
  if (wide.code !== 0 || !r60 || r60.ruled !== 5 || r60.cured !== 2) {
    return broken(`over 60 days ruled ${r60?.ruled}, cured ${r60?.cured}, not 5 and 2 (old-ruled's D-40 row is inside) — ${said(wide)}`);
  }
  return held(`30 days: ruled 4, cured 1; open regressed-open (broke ${ro.broke_at}, walk failed, ticket ${h.ticket}) and theirs-one ` +
    `(broke ${th.broke_at}, no open ticket); theirs: theirs-one; 60 days: ruled 5, cured 2`);
});
