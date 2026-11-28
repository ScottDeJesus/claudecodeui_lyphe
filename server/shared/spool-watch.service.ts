import fs from 'node:fs';

import { watchDirectory } from './directory-watch.service.js';
import { SETTLE_MS, createSettledCall } from './settled-call.service.js';

/**
 * A spool directory swept when something is dropped into it: the trigger the lesson and memory queues share.
 *
 * Only the trigger is shared. What a file in a queue means — its door, its stage verb, where a refusal goes —
 * stays in the module that owns that queue (`kanban-spill.service.ts`, `memory-spill.service.ts`). This file
 * is handed the pass and the queue's own test for a finished name, and spells no file name of its own.
 *
 * The queue is made first, so its watch has a directory to sit on, then watched, then swept once — in that
 * order, so a file renamed in around the first pass is either in its listing or heard by the watch. Every
 * name the watch hears is settled (`SETTLE_MS`) into one pass: a burst of drops, or the pass's own unlinks,
 * is one reason to look, not many.
 *
 * A pass that leaves a finished file behind was deferred by the STORE (a peer's write lock, the boot race
 * before the schema lands), and no event will ever say the store is ready. That one case arms a single pass
 * `SPILL_RETRY_MS` later: a deadline set by a pass, not a tick, and a queue that empties arms nothing.
 */

/** How long a file the store deferred waits for its next pass. Latency only — staging is idempotent at review. */
export const SPILL_RETRY_MS = 15_000;

export type SpoolWatch = { close(): void };

export type SpoolWatchDependencies = {
  dir: string;
  /** The queue's own test for a name its scan reads. */
  isQueued: (name: string) => boolean;
  /** One pass over the queue. Meant never to throw; a throw is reported and the watch stands. */
  sweep: () => void;
  logError: (message: string) => void;
};

export function watchSpool(dependencies: SpoolWatchDependencies): SpoolWatch {
  const { dir, isQueued, sweep, logError } = dependencies;
  let retry: NodeJS.Timeout | null = null;
  let closed = false;

  const leavesQueued = (): boolean => {
    try {
      return fs.readdirSync(dir).some(isQueued);
    } catch {
      // A queue that cannot be listed holds nothing a retry could stage; its watch reports why.
      return false;
    }
  };

  const pass = (): void => {
    if (closed) return;
    try {
      sweep();
    } catch (error) {
      logError(`sweep error (continuing): ${describe(error)}`);
    }
    if (retry !== null || !leavesQueued()) return;
    retry = setTimeout(() => {
      retry = null;
      pass();
    }, SPILL_RETRY_MS);
    retry.unref();
  };

  const settled = createSettledCall({ run: pass, settleMs: SETTLE_MS });

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    // The watch below waits on the parent for the queue to appear; this line says why it is not there.
    logError(`cannot make the queue ${dir}: ${describe(error)}`);
  }
  const watch = watchDirectory({
    dir,
    classify: (_kind, name) => (isQueued(name) ? true : null),
    onInterest: () => settled.request(),
    onRearm: pass,
    logError,
  });
  pass();

  return {
    close(): void {
      closed = true;
      watch.close();
      settled.cancel();
      if (retry !== null) clearTimeout(retry);
      retry = null;
    },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
