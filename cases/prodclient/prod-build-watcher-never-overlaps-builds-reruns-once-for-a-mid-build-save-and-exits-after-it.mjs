// protects: deploy/prod-client-watch/watch-build.mjs
// writes: none
//
// One build at a time: a save that settles while a build runs starts exactly one more when it ends, never beside it; and
// SIGTERM during a build lets that build end before the watcher exits, starting no other. Over a scratch repo with a
// stand-in build that takes 25 s (lib/prod_build_rig.mjs).

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { buildRig, WATCHER } from "../lib/prod_build_rig.mjs";

const QUIET_MS = 20000;
const BUILD_S = 25;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t) => {
  const rig = await buildRig(t, { buildSeconds: BUILD_S });
  if (!rig) return broken(WATCHER + " is not in this checkout");
  rig.start();
  try {
    await rig.waitFor(() => rig.builds().length >= 1 || rig.exit(), 15000);
    if (!rig.builds().length) return broken("no build started within 15 s of the watcher's start; exit " + JSON.stringify(rig.exit()) + ", printed " + JSON.stringify(rig.lines().slice(-3)));
    const firstStart = rig.builds()[0].start;
    await sleep(Math.max(0, firstStart + 2000 - Date.now()));
    const savedAt = rig.save("src/deep/a.ts");
    await rig.waitFor(() => rig.builds().length >= 2, BUILD_S * 1000 + 8000);
    let builds = rig.builds();
    if (builds.length < 2) return broken("a save that settled during the start build started no build after it");
    if (!builds[0].end || builds[1].start < builds[0].end) return broken("the second build started while the first was running");
    if (savedAt + QUIET_MS > builds[0].end) return cannotRun("the save settled after the first build ended, not during it");
    const wait = builds[1].start - builds[0].end;
    if (wait > 3000) return broken("the build owed by a mid-build save started " + wait + " ms after the running one ended");
    await sleep(3000);
    const stopAt = rig.terminate();
    await rig.waitFor(() => rig.exit(), BUILD_S * 1000 + 10000);
    const exit = rig.exit();
    builds = rig.builds();
    if (!exit) return broken("the watcher had not exited " + (BUILD_S + 10) + " s after SIGTERM");
    if (!builds[1].end || exit.at < builds[1].end) return broken("the watcher exited " + (exit.at - stopAt) + " ms after SIGTERM, before its running build ended");
    if (exit.at > builds[1].end + 5000) return broken("the watcher exited " + (exit.at - builds[1].end) + " ms after its last build ended");
    if (builds.length !== 2) return broken(builds.length + " builds ran, not 2");
    return held("the owed build started " + wait + " ms after the running one ended; after SIGTERM the watcher waited for it and exited " + (exit.at - builds[1].end) + " ms later (code " + exit.code + ", signal " + exit.signal + ")");
  } finally {
    rig.kill();
  }
});
