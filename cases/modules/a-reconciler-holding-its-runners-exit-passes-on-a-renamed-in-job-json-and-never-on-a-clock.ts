// protects: server/modules/claude-updates/update-reconciler.ts, server/modules/claude-updates/update-reconciler.wake.ts, server/modules/claude-updates/update-job.ts, server/shared/directory-watch.service.ts
// writes: none
//
// The reconciler is woken by job.json, a runner's exit or a deadline (claude-updates, pollers-hooks--file-watches
// seam F), never by a tick. The case starts the REAL reconciler on a scratch directory holding an installing job whose
// runner (a process of the case's own) is one the reconciler holds the exit of: nothing then has a deadline, so no
// pass may run while nothing is written - every pass asks isListening first, and the case counts the asks. Then it
// renames a job.json in naming a dead runner: the watch alone must bring the pass that ends it interrupted.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODULE_DIR = path.join(REPO, "server/modules/claude-updates");
const SETTLE_MS = 300;
const QUIET_MS = 2_500;
const WATCH_MS = 1_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A job the reconciler reads: the fields readJob tests, and one running step for an interruption to fail. */
function job(state: string, runnerPid: number | null) {
  const now = Date.now();
  return {
    id: "case-job",
    kind: "update",
    state,
    startedAt: now,
    endedAt: null,
    runnerPid,
    steps: [{ key: "cli", state: "running", from: "0.0.1", to: "0.0.2", startedAt: now, endedAt: null, detail: null }],
    restart: { requestedAt: null, requestedBy: null },
    packageFiles: { cleanAtStart: true, hashesAfterInstall: null },
    logTail: [],
  };
}

/** Renamed in, the way writeJob and the runner land the file: whole on disk under its own name. */
function renameIn(dir: string, body: unknown): void {
  const temp = path.join(dir, ".case-job-" + process.pid + ".tmp");
  fs.writeFileSync(temp, JSON.stringify(body));
  fs.renameSync(temp, path.join(dir, "job.json"));
}

function readBack(dir: string): { state?: string; steps?: { state?: string }[] } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "job.json"), "utf8"));
  } catch {
    return null;
  }
}

/** A stand-in runner: a process of this case's own whose argv names update-runner, as isRunnerAlive asks. */
function standInRunner() {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "update-runner-standin"], { stdio: "ignore" });
}

function dependencies(dir: string, holdsRunnerExit: (pid: number | null) => boolean, onAsk: () => void) {
  return {
    dir,
    appRoot: REPO,
    isListening: () => {
      onAsk();
      return true;
    },
    readInstalledCli: async () => ({}),
    loadedSdkVersion: null,
    requestReboot: () => false,
    onRebootFailed: () => {},
    spawnRunner: () => {
      throw new Error("this case starts no runner through the reconciler");
    },
    runCheck: () => {},
    runGit: async () => ({ code: 0, stdout: "", stderr: "" }),
    holdsRunnerExit,
  };
}

runCase(async (t: unknown) => {
  const dir = await scratchDir(t, "reconciler-watch");
  const { createUpdateReconciler } = await import(pathToFileURL(path.join(MODULE_DIR, "update-reconciler.ts")).href);
  const runner = standInRunner();
  const dead = spawnSync("true").pid ?? null;
  try {
    if (!runner.pid) return cannotRun("the stand-in runner did not start");
    renameIn(dir, job("installing", runner.pid));
    let asked = 0;
    const reconciler = createUpdateReconciler(dependencies(dir, (pid) => pid === runner.pid, () => (asked += 1)));
    reconciler.start();
    try {
      await sleep(SETTLE_MS);
      const before = asked;
      await sleep(QUIET_MS);
      if (asked !== before) {
        return broken((asked - before) + " passes ran in " + QUIET_MS + " ms with nothing written and no deadline: a clock is passing the reconciler");
      }
      if (readBack(dir)?.state !== "installing") return broken("the job left installing with its runner alive: " + readBack(dir)?.state);
      const renamedAt = Date.now();
      renameIn(dir, job("installing", dead));
      while (Date.now() - renamedAt < WATCH_MS && readBack(dir)?.state !== "interrupted") await sleep(25);
      const took = Date.now() - renamedAt;
      const state = readBack(dir)?.state;
      if (state !== "interrupted") return broken("a job.json renamed in naming dead runner " + dead + " still read " + state + " " + took + " ms later");
      return held("no pass in " + QUIET_MS + " ms of quiet; the renamed-in job.json read interrupted " + took + " ms after its rename");
    } finally {
      reconciler.stop();
    }
  } finally {
    runner.kill("SIGKILL");
  }
});
