// protects: deploy/heal/dev-unit.sh
// writes: none
//
// dev-unit.sh judges no unit younger than 40 s: it says how old the unit is, waits until it is 40 s old, then waits its
// 3 s and probes. The age comes from a stood-in systemctl show against /proc/uptime; the canary is a listener of the case's
// own (lib/heal_scripts.mjs).

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { canary, deadUrl, healScript, PARTIAL_CHAIN, runScript, scriptProblem, stubHouse, tokenOf } from "../lib/heal_scripts.mjs";

const UNIT = "case-heal-canary.service";
const WAITING = /^(.+) has been up only (\d+)s, waiting for it to finish starting$/;

runCase(async (t) => {
  const script = healScript("dev-unit.sh");
  const problem = scriptProblem(script);
  if (problem) return problem.broken ? broken(problem.why) : cannotRun(problem.why);
  const house = await stubHouse(t);
  const site = await canary(() => 200);
  try {
    house.setAge(37);
    const started = Date.now();
    const run = await runScript(script, [UNIT, site.base + "/src/main.jsx", "200"], house);
    const seen = WAITING.exec(run.lines[0] ?? "");
    if (!seen || seen[1] !== UNIT) return broken("a unit 37 s old opened " + JSON.stringify(run.lines[0] ?? "") + ", not \"" + UNIT + " has been up only <n>s, waiting for it to finish starting\"");
    const age = Number(seen[2]);
    if (age < 35 || age > 39) return broken("a unit that became active 37 s ago was said to be up " + age + " s");
    if (run.lines.length !== 2 || run.lines[1] !== UNIT + " answers again; not restarting" || run.code !== 0) return broken("after the wait the run printed " + JSON.stringify(run.lines.slice(1)) + " exit " + run.code);
    const first = site.requests[0];
    if (!first) return broken("the run judged the unit without a GET");
    const waited = first.at - started;
    const owed = (40 - age + 3) * 1000 - 500;
    if (waited < owed) return broken("the first GET went " + waited + " ms after the start, before the unit was 40 s old plus 3 s (" + owed + " ms)");
    return held("a unit " + age + " s old was said so, waited, and was first probed " + waited + " ms later, then left alone with exit 0");
  } finally {
    await site.close();
  }
});
