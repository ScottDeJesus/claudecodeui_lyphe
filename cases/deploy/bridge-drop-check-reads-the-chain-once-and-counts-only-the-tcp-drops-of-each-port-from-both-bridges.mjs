// protects: deploy/heal/bridge-drop.sh
// writes: none
//
// bridge-drop.sh check reads the INPUT chain once, whatever the number of ports, and counts a drop only when one rule holds
// -A INPUT, -i docker0 or -i br-+, -p tcp, --dport <port> and -j DROP, in whatever order iptables prints them. The chain is a
// scratch file behind a stood-in sudo (lib/heal_scripts.mjs): nothing touches the firewall.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { canary, deadUrl, healScript, PARTIAL_CHAIN, runScript, scriptProblem, stubHouse, tokenOf } from "../lib/heal_scripts.mjs";

const READ = "-n /usr/sbin/iptables -S INPUT";
const RUNS = [
  { ports: ["5183", "5184"], last: "3 of 4 bridge drops in place", code: 1 },
  { ports: ["5183"], last: "2 of 2 bridge drops in place", code: 0 },
  { ports: ["5183", "5184", "59183"], last: "3 of 6 bridge drops in place", code: 1 },
];

runCase(async (t) => {
  const script = healScript("bridge-drop.sh");
  const problem = scriptProblem(script);
  if (problem) return problem.broken ? broken(problem.why) : cannotRun(problem.why);
  const house = await stubHouse(t);
  for (const want of RUNS) {
    house.reset();
    house.setChain(PARTIAL_CHAIN);
    const run = await runScript(script, ["check", ...want.ports], house);
    const said = "check " + want.ports.join(" ");
    const last = run.lines.at(-1) ?? "";
    if (last !== want.last) return broken(said + " ended " + JSON.stringify(last) + ", not " + JSON.stringify(want.last) + (run.stderr ? " (stderr: " + run.stderr.trim().slice(0, 160) + ")" : ""));
    if (run.code !== want.code) return broken(said + " exited " + run.code + " at " + JSON.stringify(last) + ", not " + want.code);
    const calls = house.sudoCalls();
    if (calls.length !== 1 || calls[0] !== READ) return broken(said + " made the sudo calls " + JSON.stringify(calls) + ", not the one read " + JSON.stringify(READ));
  }
  return held("check read the chain once a run and counted 3 of 4, 2 of 2 and 3 of 6, exiting 1, 0 and 1; the udp, port-51840 and ACCEPT rules were not counted");
});
