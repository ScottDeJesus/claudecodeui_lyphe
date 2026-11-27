// protects: deploy/dev-supervisor/supervisor.mjs, deploy/dev-supervisor/heal.mjs, deploy/dev-supervisor/child.mjs
// writes: none
// A serving child that dies while its predecessor is still retiring is booted again: no boot is on its way then, the retirement only
// waits for the old process to exit. The whole supervisor runs over the "lingering" stand-in (lib/dev_supervisor_rig.mjs): its first boot
// asks for its own handover and it takes 6 s to go on SIGTERM, so the retirement is a 6 s window. The successor, read from the
// supervisor's own handover line and checked to be a plain number above 1 whose parent is it, is sent SIGKILL inside that window.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { startRig } from "../lib/dev_supervisor_rig.mjs";

runCase(async (t) => {
  const rig = await startRig(t, { standIn: "lingering" });
  const handover = await rig.waitFor(/handover: pid (\d+) ready — retiring pid (\d+)/, 20000);
  if (!handover) return cannotRun("the stand-in's reboot request never reached a handover: " + rig.tail());
  const pid = rig.childPid(handover.match[1]);
  if (pid === null) return broken("handover pid " + handover.match[1] + " names no child of the supervisor");
  process.kill(pid, "SIGKILL");
  const exited = await rig.waitFor(new RegExp("server pid " + pid + " exited \\(SIGKILL\\)"), 5000, handover.index + 1);
  if (!exited) return broken("successor pid " + pid + " sent SIGKILL mid-retirement, then: " + rig.tail(handover.index + 1));
  const boot = await rig.waitFor(/\[supervisor\] boot: pid (\d+)/, 15000, exited.index + 1);
  if (!boot) return broken("successor pid " + pid + " killed while pid " + handover.match[2] + " retired, then no boot in 15 s: " + rig.tail(exited.index));
  return held("successor pid " + pid + " killed while pid " + handover.match[2] + " retired -> boot: pid " + boot.match[1] + " " + (boot.at - exited.at) + " ms after its exit line");
});
