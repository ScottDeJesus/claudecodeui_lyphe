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
 * The first run is a minute after start, so a boot never pays for it; the next ones follow a day
 * apart, each scheduled when the last has finished. A failed run is logged and the next day's still
 * comes. Started by the module's `soleDuties()` — a second process on the same store would only
 * repeat the work — and stopped by its `stop()`.
 *
 * Consumers: `cerberus.module.ts` (`startDailyPrune` from `soleDuties`, `stopDailyPrune` from `stop`).
 */

const FIRST_RUN_DELAY_MS = 60_000;
const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const KEEPALIVE_RETENTION_MS = 90 * RUN_INTERVAL_MS;
const TOKEN_RETENTION_MS = 30 * RUN_INTERVAL_MS;
const RUN_OUTPUT_RETENTION_MS = 90 * RUN_INTERVAL_MS;

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

function scheduleRun(delayMs: number): void {
  pruneTimer = setTimeout(() => {
    pruneOnce();
    scheduleRun(RUN_INTERVAL_MS);
  }, delayMs);
  // A convenience of a running server, never a reason for a process to stay up.
  pruneTimer.unref();
}

/** Starts the daily prune: the first run in a minute. A second call while running does nothing. */
export function startDailyPrune(): void {
  if (pruneTimer) return;
  scheduleRun(FIRST_RUN_DELAY_MS);
}

/** Stops the prune; one already running finishes (it is three synchronous statements). */
export function stopDailyPrune(): void {
  if (pruneTimer) clearTimeout(pruneTimer);
  pruneTimer = null;
}
