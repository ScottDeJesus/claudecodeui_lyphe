// protects: server/modules/claude-updates/update-reconciler.ts, server/modules/claude-updates/update-reconciler.wake.ts, server/modules/claude-updates/update-job.ts
// writes: none
//
// A runner this process did not start (one a server before a handover spawned) announces nothing when it dies: the
// reconciler looks at it on RUNNER_LIVENESS_MS (claude-updates, pollers-hooks--file-watches seam F). The case starts
// the REAL reconciler on a scratch directory holding an installing job whose runner (a process of the case's own) it
// does not hold the exit of, kills that runner, and times the file's turn to interrupted. Once the job has ended the
// reconciler holds no watch and no timer: a job.json renamed in afterwards is nobody's to pass until a kick or a start.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODULE_DIR = path.join(REPO, "server/modules/claude-updates");
const SETTLE_MS = 300;
const FOUND_WITHIN_MS = 5_000 + 2_000;
const DISARMED_FOR_MS = 1_500;

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
  const dir = await scratchDir(t, "reconciler-liveness");
  const { createUpdateReconciler } = await import(pathToFileURL(path.join(MODULE_DIR, "update-reconciler.ts")).href);
  const runner = standInRunner();
  const dead = spawnSync("true").pid ?? null;
  try {
    if (!runner.pid) return cannotRun("the stand-in runner did not start");
    renameIn(dir, job("installing", runner.pid));
    const reconciler = createUpdateReconciler(dependencies(dir, () => false, () => {}));
    reconciler.start();
    try {
      await sleep(SETTLE_MS);
      if (readBack(dir)?.state !== "installing") return broken("the job left installing with its runner alive: " + readBack(dir)?.state);
      const killedAt = Date.now();
      runner.kill("SIGKILL");
      while (Date.now() - killedAt < FOUND_WITHIN_MS && readBack(dir)?.state !== "interrupted") await sleep(50);
      const took = Date.now() - killedAt;
      const ended = readBack(dir);
      if (ended?.state !== "interrupted") {
        return broken("the inherited runner was killed and job.json still read " + ended?.state + " " + took + " ms later");
      }
      if (ended.steps?.[0]?.state !== "failed") return broken("the job read interrupted with its running step " + ended.steps?.[0]?.state + ", not failed");
      renameIn(dir, job("installing", dead));
      await sleep(DISARMED_FOR_MS);
      const after = readBack(dir)?.state;
      if (after !== "installing") {
        return broken("a job.json renamed in after the job ended was passed (" + after + "): the reconciler did not disarm on the end");
      }
      return held("the inherited runner's death read interrupted " + took + " ms after the kill; a job.json renamed in after the end stood " + DISARMED_FOR_MS + " ms untouched");
    } finally {
      reconciler.stop();
    }
  } finally {
    runner.kill("SIGKILL");
  }
});
