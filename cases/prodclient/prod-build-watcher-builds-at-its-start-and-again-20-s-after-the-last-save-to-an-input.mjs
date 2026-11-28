// protects: deploy/prod-client-watch/watch-build.mjs, deploy/tree-watch/tree-watch.mjs
// writes: none
//
// The production client's build watcher runs the build once at its start, then once more when its inputs have been
// quiet for 20 s after the LAST save (a root file input counts like a directory one), passes the build's own
// "prod client built: <id>" lines through, and exits on SIGTERM. Over a scratch repo with a stand-in build (lib/prod_build_rig.mjs).

import { broken, held, runCase } from "../lib/case.mjs";
import { buildRig, WATCHER } from "../lib/prod_build_rig.mjs";

const QUIET_MS = 20000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t) => {
  const rig = await buildRig(t, { buildSeconds: 1 });
  if (!rig) return broken(WATCHER + " is not in this checkout");
  rig.start();
  try {
    await rig.waitFor(() => rig.builds().some((b) => b.end) || rig.exit(), 15000);
    if (rig.exit()) return broken("the watcher exited " + JSON.stringify(rig.exit()) + " at its start; it printed " + JSON.stringify(rig.lines().slice(-3)));
    if (!rig.builds().some((b) => b.end)) return broken("no build ran within 15 s of the watcher's start; it printed " + JSON.stringify(rig.lines().slice(-3)));
    await sleep(1500);
    const firstSave = rig.save("src/deep/a.ts");
    await sleep(8000);
    const lastSave = rig.save("index.html");
    await rig.waitFor(() => rig.builds().length >= 2, QUIET_MS + 10000);
    const builds = rig.builds();
    if (builds.length < 2) return broken("no build followed a save to src/deep/a.ts and, 8 s later, to index.html, within 30 s of the last");
    const after = builds[1].start - lastSave;
    if (after < QUIET_MS - 1000) return broken("the second build began " + after + " ms after the last save (" + (builds[1].start - firstSave) + " ms after the first), before 20 s of quiet");
    if (after > QUIET_MS + 4000) return broken("the second build began " + after + " ms after the last save, not 20 s after it");
    await rig.waitFor(() => rig.builds()[1].end, 10000);
    await sleep(1500);
    const count = rig.builds().length;
    if (count !== 2) return broken(count + " builds ran, not one at the start and one after the quiet window");
    const out = rig.lines();
    for (const id of ["stand-in-1", "stand-in-2"]) {
      if (!out.some((line) => line.includes("prod client built: " + id))) return broken("the build's line \"prod client built: " + id + "\" did not pass through; the watcher printed " + JSON.stringify(out.slice(-4)));
    }
    const stopAt = rig.terminate();
    await rig.waitFor(() => rig.exit(), 5000);
    if (!rig.exit()) return broken("the watcher, with no build running, had not exited 5 s after SIGTERM");
    return held("built at its start, then " + after + " ms after the last save, both lines passed through, exited " + (rig.exit().at - stopAt) + " ms after SIGTERM");
  } finally {
    rig.kill();
  }
});
