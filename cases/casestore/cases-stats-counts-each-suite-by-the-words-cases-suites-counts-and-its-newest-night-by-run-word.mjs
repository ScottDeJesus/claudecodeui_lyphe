// `cases stats` counts a suite's cases by the very words `cases suites` counts (`store.case_word`), and names the
// suite's newest night — the newest UTC date holding a `nightly` run — with that night's runs counted by run word.
// A suite the store holds whose cases.toml is gone is left out, and the verb still answers.
//
// In a scratch home (lib/cases_stats_house.mjs): eight active cases reading 3 holding, 1 broken, 2 regressed, 1 can't
// run, 1 not run; four nightly runs yesterday (2 held, 1 broken, 1 cannot-run) and one hand run today; a second suite
// whose file is gone. `cases stats --json` exits 0, holds exactly one suite (scratchstats), its six counts equal both
// the seeded truth and `cases suites --json`'s, and its night is yesterday, 4 ran, 2 held, 1 broken, 1 cannot run.
//
// protects: /home/lyphe/.claude/hooks/cases/stats.py, /home/lyphe/.claude/hooks/cases/cmd/stats.py, /home/lyphe/.claude/hooks/cases/suite.py, /home/lyphe/.claude/hooks/dispatcher/store_case_words.py
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { said } from "../lib/bug_house.mjs";
import { cases, stats, statsHouse } from "../lib/cases_stats_house.mjs";

const KEYS = ["active", "holding", "broken", "regressed", "cant_run", "not_run"];
const show = (o) => JSON.stringify(o);

runCase(async (t) => {
  const h = await statsHouse(t, "stats-counts");

  const ran = await stats(h, ["--days", "30"]);
  if (ran.code !== 0 || !ran.json) return broken(`cases stats --json did not answer JSON at exit 0 — ${said(ran)}`);
  const names = (ran.json.suites ?? []).map((s) => s.name);
  if (show(names) !== show(["scratchstats"])) {
    return broken(`suites named ${show(names)}, not only the loadable scratchstats (the suite whose cases.toml is gone must not be one)`);
  }
  const mine = ran.json.suites[0];
  if (mine.repo !== h.repo) return broken(`the suite's repo reads ${show(mine.repo)}, not ${h.repo}`);

  const wrong = KEYS.filter((k) => mine[k] !== h.expect.words[k]);
  if (wrong.length) {
    return broken(`counts ${show(Object.fromEntries(KEYS.map((k) => [k, mine[k]])))} are not the seeded ${show(h.expect.words)}`);
  }

  const listed = await cases(h, ["suites", "--json"]);
  let theirs = null;
  try { theirs = JSON.parse(listed.out).suites.find((s) => s.name === "scratchstats"); } catch { theirs = null; }
  if (!theirs) return broken(`cases suites --json named no scratchstats — ${said(listed)}`);
  const apart = KEYS.filter((k) => mine[k] !== theirs[k]);
  if (apart.length) {
    return broken(`stats and suites disagree on ${apart.map((k) => `${k} ${mine[k]} vs ${theirs[k]}`).join(", ")}`);
  }

  const night = mine.night;
  if (!night || show(night) !== show({ ...h.expect.night, ...night }) ||
      ["day", "ran", "held", "broken", "cannot_run"].some((k) => night[k] !== h.expect.night[k])) {
    return broken(`night reads ${show(night)}, not ${show(h.expect.night)} (the newest date of nightly runs; today's hand run is no night)`);
  }
  return held(`one suite, scratchstats: ${KEYS.map((k) => `${mine[k]} ${k}`).join(", ")}, as cases suites counts; ` +
    `night ${night.day}: ${night.ran} ran, ${night.held} held, ${night.broken} broken, ${night.cannot_run} cannot run`);
});
