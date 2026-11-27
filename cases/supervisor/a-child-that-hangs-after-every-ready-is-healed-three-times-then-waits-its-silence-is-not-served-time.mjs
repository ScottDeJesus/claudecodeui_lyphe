// protects: deploy/dev-supervisor/supervisor.mjs, deploy/dev-supervisor/heal.mjs, server/supervised-boot.ts
// writes: none
// A child that hangs on every boot is healed three times and then left waiting for the next change: the seconds it sat silent before it
// was killed are not time served, so they never clear the heal count. The whole supervisor runs over the "hanging" stand-in
// (lib/dev_supervisor_rig.mjs: READY, beats, then wedged 1 s after READY), heal.mjs's SILENCE_MS shortened to 2 s and STABLE_MS to 2.5 s
// there, so a child that really served ~1 s is judged after ~3 s of wall time.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { startRig } from "../lib/dev_supervisor_rig.mjs";

runCase(async (t) => {
  const rig = await startRig(t, { standIn: "hanging", silenceMs: 2000, stableMs: 2500 });
  if (!rig.silenced) return broken("heal.mjs holds no SILENCE_MS = 45_000 for the rig to shorten");
  const first = await rig.waitFor(/serving pid (\d+)/, 20000);
  if (!first) return cannotRun("the supervisor never served the stand-in: " + rig.tail());
  const done = await rig.waitFor(/it died 3 times on this code, waiting for the next change/, 30000, first.index + 1);
  const heals = rig.lines.slice(first.index + 1).map((line) => line.text.match(/heal (\d+) of 3/)?.[1]).filter(Boolean);
  const silent = rig.lines.slice(first.index + 1).filter((line) => /silent for 2 s, killing it/.test(line.text)).length;
  if (!done) return broken(silent + " hung children judged silent in 30 s, healed as " + heals.join(",") + ", never giving up: each one's 2 s of silence counted as served time");
  if (heals.join(",") !== "1,2,3") return broken("heals " + heals.join(",") + " before it gave up");
  return held("hung 1 s after every READY: silent, heal 1, 2, 3 of 3, then it died 3 times on this code, waiting for the next change");
});
