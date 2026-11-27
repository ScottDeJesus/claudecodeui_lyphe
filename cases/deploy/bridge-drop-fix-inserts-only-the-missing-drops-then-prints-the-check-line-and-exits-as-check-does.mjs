// protects: deploy/heal/bridge-drop.sh
// writes: none
//
// bridge-drop.sh fix puts back each missing bridge drop, and only those, with sudo -n /usr/sbin/iptables -I INPUT, says
// one line per rule put back, then the check line, and exits as check does. The stand-in sudo reads the inserted rule's
// parts on their own, so their order is free; the chain is a scratch file (lib/heal_scripts.mjs).

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { canary, deadUrl, healScript, PARTIAL_CHAIN, runScript, scriptProblem, stubHouse, tokenOf } from "../lib/heal_scripts.mjs";

const DONE = "4 of 4 bridge drops in place";
const WANTED_INSERT = "insert tcp 5184 br-+ DROP";

runCase(async (t) => {
  const script = healScript("bridge-drop.sh");
  const problem = scriptProblem(script);
  if (problem) return problem.broken ? broken(problem.why) : cannotRun(problem.why);
  const house = await stubHouse(t);
  house.setChain(PARTIAL_CHAIN);
  const first = await runScript(script, ["fix", "5183", "5184"], house);
  const inserted = house.inserts();
  if (inserted.length !== 1 || inserted[0] !== WANTED_INSERT) return broken("fix 5183 5184 on a chain missing only 5184's br-+ drop inserted " + JSON.stringify(inserted) + ", not [" + JSON.stringify(WANTED_INSERT) + "]; sudo calls " + JSON.stringify(house.sudoCalls()));
  if (first.lines.at(-1) !== DONE || first.code !== 0) return broken("fix 5183 5184 ended " + JSON.stringify(first.lines.at(-1) ?? "") + " exit " + first.code + ", not " + JSON.stringify(DONE) + " exit 0");
  if (first.lines.length !== 2 || !first.lines[0].includes("5184")) return broken("fix 5183 5184 printed " + JSON.stringify(first.lines) + ": one line for the one rule put back, then the check line");
  const stray = house.sudoCalls().filter((call) => !call.startsWith("-n /usr/sbin/iptables -S INPUT") && !call.startsWith("-n /usr/sbin/iptables -I INPUT"));
  if (stray.length > 0) return broken("fix made sudo calls that are neither the read nor an insert: " + JSON.stringify(stray));
  const again = await runScript(script, ["fix", "5183", "5184"], house);
  if (house.inserts().length !== 1) return broken("a second fix on the now complete chain inserted again: " + JSON.stringify(house.inserts()));
  if (again.lines.length !== 1 || again.lines[0] !== DONE || again.code !== 0) return broken("a second fix on the complete chain printed " + JSON.stringify(again.lines) + " exit " + again.code + ", not only " + JSON.stringify(DONE) + " exit 0");
  house.reset();
  house.refuse("insert");
  const refused = await runScript(script, ["fix", "59183"], house);
  if (refused.lines.at(-1) !== "0 of 2 bridge drops in place" || refused.code !== 1) return broken("fix 59183 with every insert refused ended " + JSON.stringify(refused.lines.at(-1) ?? "") + " exit " + refused.code + ", not \"0 of 2 bridge drops in place\" exit 1");
  return held("fix put back only 5184's br-+ drop with one line and ended 4 of 4 exit 0; a second fix inserted nothing; refused inserts ended 0 of 2 exit 1");
});
