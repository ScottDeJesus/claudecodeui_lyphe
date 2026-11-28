// protects: server/modules/claude-updates/update-job.ts, server/modules/claude-updates/claude-updates.module.ts
// writes: none
//
// spawnUpdateRunner takes an onExit (claude-updates, pollers-hooks--file-watches seam F): the module hands it the call
// that forgets the runner's pid and kicks the reconciler, which is how a runner this process started is heard ending
// with no clock asking. The case spawns the REAL runner on a scratch directory holding no job (it waits for one, gives
// up and exits), reads its process group the instant spawnUpdateRunner answers (detached: it leads its own group), and
// counts the onExit calls once the runner is gone.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODULE_DIR = path.join(REPO, "server/modules/claude-updates");
const EXIT_WAIT_MS = 40_000;
const AFTER_EXIT_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function procState(pid: number): { state: string; pgrp: number } | null {
  try {
    const stat = fs.readFileSync("/proc/" + pid + "/stat", "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return { state: fields[0], pgrp: Number(fields[2]) };
  } catch {
    return null;
  }
}

const running = (pid: number): boolean => {
  const seen = procState(pid);
  return seen !== null && seen.state !== "Z";
};

runCase(async (t: unknown) => {
  const dir = await scratchDir(t, "update-runner-exit");
  const { spawnUpdateRunner } = await import(pathToFileURL(path.join(MODULE_DIR, "update-job.ts")).href);
  let exits = 0;
  // The runner is unref'd by design; this keeps the case itself alive while it waits.
  const keepAlive = setInterval(() => {}, 1_000);
  try {
    const pid = spawnUpdateRunner(REPO, dir, "install", () => {
      exits += 1;
    });
    if (!Number.isInteger(pid) || pid <= 1) return broken("spawnUpdateRunner answered " + String(pid) + ", not a pid");
    const first = procState(pid);
    if (first === null) return cannotRun("runner " + pid + " left no /proc entry to read its process group from");
    if (first.pgrp !== pid) return broken("runner " + pid + " sits in process group " + first.pgrp + ": it was not spawned detached");
    const startedAt = Date.now();
    while (running(pid) && Date.now() - startedAt < EXIT_WAIT_MS) await sleep(100);
    if (running(pid)) {
      process.kill(pid, "SIGKILL");
      return cannotRun("runner " + pid + " was still running " + EXIT_WAIT_MS + " ms after its start with no job to wait for");
    }
    const exitedAfter = Date.now() - startedAt;
    await sleep(AFTER_EXIT_MS);
    if (exits !== 1) {
      return broken("runner " + pid + " exited about " + exitedAfter + " ms after its start and onExit was called " + exits + " times, not once");
    }
    return held("runner " + pid + " led its own process group, exited about " + exitedAfter + " ms after its start with no job, and onExit was called once");
  } finally {
    clearInterval(keepAlive);
  }
});
