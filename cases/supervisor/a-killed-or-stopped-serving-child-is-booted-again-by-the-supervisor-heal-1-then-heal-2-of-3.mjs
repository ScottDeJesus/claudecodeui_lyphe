// protects: deploy/dev-supervisor/supervisor.mjs, deploy/dev-supervisor/heal.mjs, deploy/dev-supervisor/child.mjs
// writes: none
// The dev supervisor heals its own serving child: one killed outright is booted again at once (heal 1 of 3), and one that beat and
// then went silent (SIGSTOP) is killed through its own handle and booted again (heal 2 of 3). The whole supervisor runs as a child
// process over a stand-in API in a scratch repo (lib/dev_supervisor_rig.mjs), heal.mjs's 45 s silence shortened to 2 s there. Each
// pid signalled is read from the supervisor's own serving line and checked to be a plain number above 1 whose parent is it.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { startRig } from "../lib/dev_supervisor_rig.mjs";

const SERVING = /\[supervisor\] serving pid (\d+)/;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t) => {
  const rig = await startRig(t, { standIn: "beating", silenceMs: 2000 });
  const first = await rig.waitFor(SERVING, 20000);
  if (!first) return cannotRun("the supervisor never served the stand-in: " + rig.tail());
  const pid1 = rig.childPid(first.match[1]);
  if (pid1 === null) return broken("serving pid " + first.match[1] + " names no child of the supervisor");
  process.kill(pid1, "SIGKILL");
  const healed = await rig.waitFor(new RegExp("server pid " + pid1 + " exited \\(SIGKILL\\): heal 1 of 3, booting it again"), 5000, first.index + 1);
  if (!healed) return broken("serving pid " + pid1 + " sent SIGKILL, then: " + rig.tail(first.index + 1));
  const second = await rig.waitFor(SERVING, 15000, healed.index + 1);
  if (!second) return broken("heal 1 of 3 logged, then no serving pid: " + rig.tail(healed.index + 1));
  const pid2 = rig.childPid(second.match[1]);
  if (pid2 === null || pid2 === pid1) return broken("the healed serving pid " + second.match[1] + " is no new child of the supervisor");
  if (!rig.silenced) return broken("heal.mjs holds no SILENCE_MS = 45_000 for the rig to shorten");
  await pause(1000); // the stand-in beats every 300 ms, so its deadline is armed
  process.kill(pid2, "SIGSTOP");
  const silent = await rig.waitFor(new RegExp("server pid " + pid2 + " silent for 2 s, killing it"), 8000, second.index + 1);
  if (!silent) return broken("serving pid " + pid2 + " sent SIGSTOP, then: " + rig.tail(second.index + 1));
  const healed2 = await rig.waitFor(new RegExp("server pid " + pid2 + " exited \\(SIGKILL\\): heal 2 of 3, booting it again"), 5000, silent.index + 1);
  if (!healed2) return broken("the silent pid " + pid2 + " was not killed and healed: " + rig.tail(silent.index + 1));
  const third = await rig.waitFor(SERVING, 15000, healed2.index + 1);
  if (!third) return broken("heal 2 of 3 logged, then no serving pid: " + rig.tail(healed2.index + 1));
  return held("SIGKILL of serving pid " + pid1 + " -> heal 1 of 3 -> serving pid " + pid2 + " " + (second.at - healed.at) + " ms later; SIGSTOP of " + pid2 + " -> silent for 2 s, killing it -> heal 2 of 3 -> serving pid " + third.match[1]);
});
