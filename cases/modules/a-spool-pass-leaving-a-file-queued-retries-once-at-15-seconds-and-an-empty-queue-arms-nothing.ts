// protects: server/shared/spool-watch.service.ts, server/modules/kanban/kanban-spill.service.ts, server/modules/memory-intake/memory-spill.service.ts
// writes: none
//
// A pass that leaves a finished file in a spool queue arms ONE more pass SPILL_RETRY_MS later; a pass that empties
// the queue arms nothing, so an idle queue is never looked at on a clock.

import fs from "node:fs";
import path from "node:path";

import { broken, CannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const SERVER = "/home/lyphe/.claude/claudecodeui_lyphe/server";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls a test every 20 ms until it holds or the time is up; answers whether it held. */
async function waitFor(test: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (test()) return true;
    await sleep(20);
  }
  return test();
}

/** A server module by its path: a file not on disk is null (the promise's own break), a load failure cannot run. */
async function load(file: string): Promise<any> {
  if (!fs.existsSync(file)) return null;
  try {
    return await import(file);
  } catch (error: any) {
    throw new CannotRun(file + " would not load — " + String(error?.message ?? error).split("\n")[0]);
  }
}

const WATCH_FOR_MS = 32000;

runCase(async (t: any) => {
  const spool = await load(SERVER + "/shared/spool-watch.service.ts");
  if (spool === null || typeof spool.watchSpool !== "function") return broken("no watchSpool in server/shared/spool-watch.service.ts: nothing arms a retry after a pass that left a file");
  const wrong: string[] = [];
  if (spool.SPILL_RETRY_MS !== 15000) wrong.push("SPILL_RETRY_MS is " + spool.SPILL_RETRY_MS + ", not 15000");

  const root = await scratchDir(t, "spool-retry");
  const dir = path.join(root, "queue");
  fs.mkdirSync(dir);
  const left = path.join(dir, "1-left.json");
  fs.writeFileSync(left, "{}");
  const calls: number[] = [];
  const errors: string[] = [];
  const t0 = Date.now();
  const watch = spool.watchSpool({
    dir,
    isQueued: (name: string) => name.endsWith(".json"),
    // The first pass leaves the file, as a pass the store deferred does; the second removes it.
    sweep: () => {
      calls.push(Date.now() - t0);
      if (calls.length === 2) fs.unlinkSync(left);
    },
    logError: (message: string) => errors.push(message),
  });
  t.defer(() => watch.close());
  await sleep(WATCH_FOR_MS);

  const [first, second] = calls;
  if (first === undefined || first > 500) wrong.push("no pass at start (passes at " + calls.join(", ") + " ms)");
  if (second === undefined) wrong.push("no second pass in " + WATCH_FOR_MS + " ms with a file left in the queue");
  else if (second < 14000 || second > 16500) wrong.push("the second pass ran at " + second + " ms, not about 15000");
  // The removal itself is heard and settled into one more look; anything later is a clock.
  const late = second === undefined ? [] : calls.slice(2).filter((ms) => ms > second + 1000);
  if (late.length) wrong.push("passes after the queue emptied, at " + late.join(", ") + " ms");
  if (wrong.length) return broken(wrong.join("; ") + (errors.length ? " | logged: " + errors.join("; ") : ""));
  return held("passes at " + calls.join(", ") + " ms: one at start, one retry about 15 s later, none once the queue was empty");
});
