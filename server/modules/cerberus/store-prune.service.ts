import { cerberusEnrollDb, cerberusResultsDb, cerberusRunsDb } from '@/modules/database/index.js';

/**
 * The store's one housekeeping job: once a day, forget what nothing reads any more.
 *
 * Only three things are ever deleted, and all are bookkeeping rather than history: KEEPALIVE rows
 * older than 90 days (the copies ingest writes every five minutes to say "still the same" — a
 * `change` row, which is what a past moment is read from, is never touched), enrollment tokens
 * older than 30 days, spent or not (a token is good for 15 minutes; after a month it only clutters),
 * and the OUTPUT of runs asked for more than 90 days ago ("Runs forever · output 90 days": the
 * `runs` row, which says what ran and how it ended, stays; only its lines go).
 * Each is one statement, so the write lock is held for the length of a `DELETE`, not of a sweep.
 *
 * It runs at 04:10 by the server's local clock — the next one after the duties arm, then every day —
 * and NEVER at start: a server that hands over about 170 times a day would otherwise pay a full-scan
 * `DELETE` at every one of them (56 runs measured on 2026-10-06), and an hour of the day is a fixed
 * point, not a wait that a restart resets. Each run is armed from the clock again once the last has
 * ended (`nextPruneAt`), never as a day's worth of milliseconds, so a daylight-saving change keeps
 * 04:10. A day the server is down at 04:10 is caught up the next day, for the retentions are days and
 * a run deletes everything past them. A failed run is logged and the next day's still comes. Started
 * by the module's `soleDuties()` — whichever process holds the sole duties when 04:10 comes does the
 * work; a second process on the same store would only repeat it — and stopped by its `stop()`.
 *
 * Consumers: `cerberus.module.ts` (`startDailyPrune` from `soleDuties`, `stopDailyPrune` from `stop`).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEPALIVE_RETENTION_MS = 90 * DAY_MS;
const TOKEN_RETENTION_MS = 30 * DAY_MS;
const RUN_OUTPUT_RETENTION_MS = 90 * DAY_MS;

/** The prune runs at this local time of day. */
const PRUNE_HOUR = 4;
const PRUNE_MINUTE = 10;

let pruneTimer: NodeJS.Timeout | null = null;

function pruneOnce(): void {
  const now = Date.now();
  try {
    const keepalives = cerberusResultsDb.pruneKeepalivesBefore(now - KEEPALIVE_RETENTION_MS);
    const tokens = cerberusEnrollDb.pruneOlderThan(now - TOKEN_RETENTION_MS);
    const runOutputLines = cerberusRunsDb.pruneOutputBefore(now - RUN_OUTPUT_RETENTION_MS);
    console.log(
      `[Cerberus] pruned ${keepalives} keepalive row(s), ${tokens} enrollment token(s) and ${runOutputLines} run output line(s)`
    );
  } catch (error) {
    console.error(`[Cerberus] the daily prune failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * The next 04:10 by the local clock, in epoch milliseconds: today's when that is after `now`, else
 * tomorrow's. The hour is set on the calendar date (`setHours`, then `setDate`), so a day of 23 or 25
 * hours still lands on 04:10 rather than an hour off.
 *
 * Consumer: this file's scheduler; exported so a showing can print what the next run is.
 */
export function nextPruneAt(now: number): number {
  const next = new Date(now);
  next.setHours(PRUNE_HOUR, PRUNE_MINUTE, 0, 0);
  if (next.getTime() <= now) {
    next.setDate(next.getDate() + 1);
    next.setHours(PRUNE_HOUR, PRUNE_MINUTE, 0, 0);
  }
  return next.getTime();
}

/** Arms one run at `runAt`; when it ends the next is armed from the clock, so it is always a 04:10 and never a drift. */
function scheduleRun(runAt: number): void {
  pruneTimer = setTimeout(() => {
    pruneOnce();
    // From the later of the clock and this run's own moment: a timer that fires a hair early must not
    // find today's 04:10 still ahead of it and run twice.
    scheduleRun(nextPruneAt(Math.max(Date.now(), runAt)));
  }, Math.max(0, runAt - Date.now()));
  // A convenience of a running server, never a reason for a process to stay up.
  pruneTimer.unref();
}

/** Starts the daily prune: the first run at the next 04:10. A second call while running does nothing. */
export function startDailyPrune(): void {
  if (pruneTimer) return;
  scheduleRun(nextPruneAt(Date.now()));
}

/** Stops the prune; one already running finishes (it is three synchronous statements). */
export function stopDailyPrune(): void {
  if (pruneTimer) clearTimeout(pruneTimer);
  pruneTimer = null;
}
