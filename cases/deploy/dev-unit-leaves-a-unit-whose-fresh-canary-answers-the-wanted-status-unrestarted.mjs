// protects: deploy/heal/dev-unit.sh
// writes: none
//
// dev-unit.sh does not restart a unit whose canary answers the wanted status on its first probe, and every probe carries a
// fresh t= token joined with ? or with & when the url already holds a query. The unit is a name only: systemctl and sudo are
// stood in for, and the canary is a listener of the case's own (lib/heal_scripts.mjs).

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { canary, deadUrl, healScript, PARTIAL_CHAIN, runScript, scriptProblem, stubHouse, tokenOf } from "../lib/heal_scripts.mjs";

const UNIT = "case-heal-canary.service";

runCase(async (t) => {
  const script = healScript("dev-unit.sh");
  const problem = scriptProblem(script);
  if (problem) return problem.broken ? broken(problem.why) : cannotRun(problem.why);
  const house = await stubHouse(t);
  house.setAge(100);
  const site = await canary(() => 200);
  try {
    const tokens = [];
    for (const [query, joiner] of [["", "?"], ["?v=1", "&"]]) {
      house.reset();
      const url = site.base + "/src/main.tsx" + query;
      const before = site.requests.length;
      const run = await runScript(script, [UNIT, url, "200"], house);
      const said = "dev-unit.sh on " + url + " answering 200";
      if (run.lines.length !== 1 || run.lines[0] !== UNIT + " answers again; not restarting") return broken(said + " printed " + JSON.stringify(run.lines));
      if (run.code !== 0) return broken(said + " exited " + run.code);
      if (house.sudoCalls().length > 0) return broken(said + " called sudo: " + JSON.stringify(house.sudoCalls()));
      const sent = site.requests.slice(before);
      if (sent.length !== 1) return broken(said + " sent " + sent.length + " GETs, not one");
      const head = "/src/main.tsx" + query + joiner + "t=";
      const token = sent[0].url.slice(head.length);
      if (!sent[0].url.startsWith(head) || !/^[A-Za-z0-9]+$/.test(token)) return broken(said + " sent " + sent[0].url + ", not " + head + "<letters and digits>");
      tokens.push(token);
    }
    if (tokens[0] === tokens[1]) return broken("two runs sent the same token " + tokens[0]);
    return held("a healthy canary left the unit alone with its one line, exit 0 and no sudo; the GETs carried ?t= and &t= with two different tokens");
  } finally {
    await site.close();
  }
});
