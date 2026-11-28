// protects: server/modules/kanban/kanban-spill.service.ts, server/modules/memory-intake/memory-spill.service.ts, server/shared/spool-watch.service.ts, server/shared/directory-watch.service.ts, server/shared/settled-call.service.ts
// writes: none
//
// A file renamed into the lesson queue or the memory queue, the way /learn and /remember drop one, is swept by
// the queue's own watch within a second: no 15 s clock decides when it is read. The file carries no fields, so the
// door refuses it into failed/ before any store is reached.

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

const WITHIN_MS = 1000;
const LOOK_MS = 3000;
/** After start, so the start's own pass is over before the drop. */
const START_QUIET_MS = 600;

runCase(async (t: any) => {
  const root = await scratchDir(t, "spool-sweep");
  process.env.CLOUDCLI_SPILL_ROOT = root;
  process.env.DATABASE_PATH = path.join(root, "auth.db");
  const lessons = await load(SERVER + "/modules/kanban/kanban-spill.service.ts");
  const memories = await load(SERVER + "/modules/memory-intake/memory-spill.service.ts");
  if (lessons === null || memories === null) throw new CannotRun("a spill module is not on disk");
  lessons.startLessonSpillSweep();
  memories.startMemorySpillSweep();
  await sleep(START_QUIET_MS);

  const wrong: string[] = [];
  const saw: string[] = [];
  for (const [label, folder] of [["lesson", "pending-lessons"], ["memory", "pending-memories"]]) {
    const queue = path.join(root, folder);
    if (!fs.existsSync(queue)) {
      wrong.push(label + ": starting the sweep did not make " + folder);
      fs.mkdirSync(queue, { recursive: true });
      await sleep(START_QUIET_MS);
    }
    const name = Date.now() + "-case-" + label + ".json";
    const tmp = path.join(queue, name + ".tmp");
    // No fields at all: the door refuses it before any store is reached, so nothing is staged anywhere.
    fs.writeFileSync(tmp, "{}");
    const at = Date.now();
    fs.renameSync(tmp, path.join(queue, name));
    const gone = await waitFor(() => !fs.existsSync(path.join(queue, name)), LOOK_MS);
    const took = Date.now() - at;
    if (!gone) wrong.push(label + ": " + name + " still in " + folder + " " + LOOK_MS + " ms after its rename");
    else if (took > WITHIN_MS) wrong.push(label + ": swept " + took + " ms after its rename, past " + WITHIN_MS + " ms");
    else saw.push(label + " swept " + took + " ms after its rename" + (fs.existsSync(path.join(queue, "failed", name)) ? " (refused into failed/)" : ""));
  }
  if (wrong.length) return broken(wrong.join("; "));
  return held(saw.join("; "));
});
