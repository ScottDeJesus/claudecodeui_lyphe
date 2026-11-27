// protects: deploy/heal/bridge-drop.sh
// writes: none
//
// bridge-drop.sh ends with exit 2 and its own sentence when sudo -n /usr/sbin/iptables -S INPUT fails: fix inserts
// nothing blind and check prints no count it never took. The stand-in sudo refuses the read; the chain is a scratch
// file already holding both drops of 5183 (lib/heal_scripts.mjs).

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { healScript, runScript, scriptProblem, stubHouse } from "../lib/heal_scripts.mjs";

const BOTH_5183 = [
  "-P INPUT ACCEPT",
  "-A INPUT -i br-+ -p tcp -m tcp --dport 5183 -j DROP",
  "-A INPUT -i docker0 -p tcp -m tcp --dport 5183 -j DROP",
].join("\n") + "\n";
const COUNT = /^\d+ of \d+ bridge drops in place$/;

runCase(async (t) => {
  const script = healScript("bridge-drop.sh");
  const problem = scriptProblem(script);
  if (problem) return problem.broken ? broken(problem.why) : cannotRun(problem.why);
  const house = await stubHouse(t);
  for (const mode of ["fix", "check"]) {
    house.reset();
    house.setChain(BOTH_5183);
    house.refuse("read");
    const run = await runScript(script, [mode, "5183"], house);
    const said = mode + " 5183 with the chain unreadable";
    if (house.inserts().length > 0) return broken(said + " inserted " + JSON.stringify(house.inserts()) + " blind, over a chain already holding both drops");
    const counted = run.lines.filter((line) => COUNT.test(line));
    if (counted.length > 0) return broken(said + " printed " + JSON.stringify(counted) + ", a count it never took; exit " + run.code);
    if (run.code !== 2) return broken(said + " exited " + run.code + ", not 2");
  }
  return held("an unreadable chain ended fix and check with exit 2, no count line and no insert");
});
