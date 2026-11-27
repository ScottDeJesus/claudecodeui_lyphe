// protects: deploy/heal/dev-unit.sh
// writes: none
//
// dev-unit.sh restarts a unit whose canary does not answer the wanted status: reset-failed, then restart, then a probe a
// second for up to 30 s, each sentence as the Cerberus dashboard shows it. sudo and systemctl are stood in for (a restart
// is a mark the case's canary reads) and the canary is a listener of the case's own (lib/heal_scripts.mjs).

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { canary, deadUrl, healScript, PARTIAL_CHAIN, runScript, scriptProblem, stubHouse, tokenOf } from "../lib/heal_scripts.mjs";

const UNIT = "case-heal-canary.service";
const CALLS = ["-n systemctl reset-failed " + UNIT, "-n systemctl restart " + UNIT];

runCase(async (t) => {
  const script = healScript("dev-unit.sh");
  const problem = scriptProblem(script);
  if (problem) return problem.broken ? broken(problem.why) : cannotRun(problem.why);
  const house = await stubHouse(t);
  house.setAge(100);
  const site = await canary(() => (house.restarted() ? 200 : 503));
  try {
    const url = site.base + "/src/main.tsx";
    const run = await runScript(script, [UNIT, url, "200"], house);
    const opening = "restarting " + UNIT + " (" + url + " answered 503, wanted 200)";
    if (run.lines[0] !== opening) return broken("a canary answering 503 opened " + JSON.stringify(run.lines[0] ?? "") + ", not " + JSON.stringify(opening));
    const back = UNIT + " answers again after ";
    if (run.lines.length !== 2 || !run.lines[1].startsWith(back) || !/^\d+s$/.test(run.lines[1].slice(back.length))) return broken("after the restart the run printed " + JSON.stringify(run.lines.slice(1)) + ", not one \"" + back + "<n>s\"");
    if (run.code !== 0) return broken("a unit that answered after its restart exited " + run.code);
    if (JSON.stringify(house.sudoCalls()) !== JSON.stringify(CALLS)) return broken("the restart made the sudo calls " + JSON.stringify(house.sudoCalls()) + ", not " + JSON.stringify(CALLS));
    const tokens = site.requests.map((request) => tokenOf(request.url));
    if (tokens.length < 2 || tokens.some((token) => !token) || new Set(tokens).size !== tokens.length) return broken("the probes carried the tokens " + JSON.stringify(tokens) + ": one fresh token a GET");
    house.reset();
    const dead = await deadUrl();
    const lost = await runScript(script, [UNIT, dead, "200"], house, 100000);
    const want = ["restarting " + UNIT + " (" + dead + " answered nothing, wanted 200)", UNIT + " was restarted but " + dead + " still does not answer"];
    if (JSON.stringify(lost.lines) !== JSON.stringify(want)) return broken("a canary nothing listens on printed " + JSON.stringify(lost.lines) + ", not " + JSON.stringify(want));
    if (lost.code !== 1) return broken("a unit that never answered after its restart exited " + lost.code + ", not 1");
    if (lost.ms < 30000) return broken("the run gave up after " + lost.ms + " ms, before 30 s of probes");
    if (JSON.stringify(house.sudoCalls()) !== JSON.stringify(CALLS)) return broken("the unanswered restart made the sudo calls " + JSON.stringify(house.sudoCalls()));
    return held("503 then 200: reset-failed, restart, \"" + run.lines[1] + "\", exit 0, " + tokens.length + " distinct tokens; no listener: answered nothing, the still-does-not-answer line after " + Math.round(lost.ms / 1000) + " s, exit 1");
  } finally {
    await site.close();
  }
});
