import { cronJobsDb } from '@/modules/database/index.js';
import type { CronSyncReport } from '@/shared/types.js';

import { readBoxCron } from './schedules-cron-read.service.js';
import { readCronInvocations } from './schedules-journal.service.js';
import { reconcile } from './schedules-reconcile.js';

/**
 * One sync: read the box, decide, write, and say what happened.
 *
 * The shell around `reconcile`, and nothing more than a shell: it owns the four things the pure
 * function cannot — the box read, the journal read, the writes, and the report. Every decision
 * about drift lives in `reconcile`, which is why this file can be read as a sequence of side
 * effects and no rules at all.
 *
 * **The journal is read ONCE.** `readCronInvocations` is called at the top and its Map is handed
 * down to `reconcile`; the alternative — looking a job's last run up while writing it — spawns one
 * journal read per row and a forty-row registry pays forty times for the same week of lines.
 *
 * **One sync at a time.** The cron line and a Refresh click land together sooner or later, and two
 * runs writing the same rows double-count every adoption in the report and can interleave a write
 * with the read that decided it. So a second caller while a run is in flight awaits THAT run —
 * not a second one, and not an error. A caller who asked for a sync gets a sync, and the report of
 * the run that happened is the honest answer to both.
 *
 * **A source that could not be read says so PER ROW.** `readBoxCron` names the sources that would
 * not answer, and such a source contributes no lines — so its tracked rows would otherwise look
 * exactly like rows the box had dropped. They are not the same thing, and the two get the
 * contract's two different words: a row whose source went unread takes state `'failed'` ("a reader
 * could not answer for it") and keeps its place, while a row whose source DID answer and no longer
 * shows the line is marked missing, as the box's word for gone. An unreadable crontab therefore
 * cannot mark the whole registry missing — and because drift is sticky, a line that never left the
 * box never needs a door visit to clear a badge it should never have been given.
 *
 * Nothing here throws. A sync that fails silently is worse than one that says so, so a failure is
 * a report with `ok: false` and the message in `error` — and it is recorded like any other run, so
 * the screen can show the last sync that failed rather than no sync at all.
 */

/** How far back the journal is asked. The read is bounded; a week answers "when did it last run". */
const JOURNAL_WINDOW = '-7 days';

/** How old the newest sync may be before a registry read runs one first: fifteen minutes. */
export const READ_SYNC_AFTER_MS = 900_000;

/** The run in flight, if any. Module-private: the single-flight guard is invisible to callers. */
let inFlight: Promise<CronSyncReport> | null = null;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether a tracked row belongs to a source this run could not read — its `source`, exactly. */
function isUnread(source: string | undefined, failedSources: string[]): boolean {
  if (source === undefined) return false;
  return failedSources.includes(source);
}

/**
 * The whole sync, past the single-flight guard: read, decide, write, report, record.
 *
 * The counts in a failure report are zero rather than half-known on purpose: a run that could not
 * finish has no counts to report, and a number invented from a partial pass reads exactly like a
 * real one on the screen.
 */
async function performSync(): Promise<CronSyncReport> {
  const startedAt = Date.now();
  const ranAt = new Date().toISOString();

  try {
    const { lines, error, failedSources } = await readBoxCron();
    const invocations = await readCronInvocations(JOURNAL_WINDOW);

    const stored = cronJobsDb.listJobs();
    const { upserts, missingIds, counts } = reconcile(stored, lines, invocations, ranAt);

    for (const job of upserts) cronJobsDb.upsertJob(job);

    // The box did not show these rows. Which of them that means "gone" and which "unread" is the
    // whole question here, and it is answered per row, from the source that row came from.
    const gone = new Set(missingIds);
    const unreadIds = new Set<string>();

    for (const job of stored) {
      if (job.kind !== 'cron' || !gone.has(job.id)) continue;
      if (!isUnread(job.source, failedSources)) continue;

      unreadIds.add(job.id);
      cronJobsDb.upsertJob({ ...job, state: 'failed', updatedAt: ranAt });
    }

    const goneIds = missingIds.filter((id) => !unreadIds.has(id));
    cronJobsDb.markMissing(goneIds);

    const report: CronSyncReport = {
      ranAt,
      ok: error === null,
      error,
      seen: counts.seen,
      adopted: counts.adopted,
      missing: goneIds.length,
      changed: counts.changed,
      ms: Date.now() - startedAt,
    };

    cronJobsDb.recordSync(report);
    return report;
  } catch (error) {
    const report: CronSyncReport = {
      ranAt,
      ok: false,
      error: messageOf(error),
      seen: 0,
      adopted: 0,
      missing: 0,
      changed: 0,
      ms: Date.now() - startedAt,
    };

    try {
      cronJobsDb.recordSync(report);
    } catch {
      // The run already failed; a records table that cannot take the failure must not also
      // be the thing that throws out of here. The caller still gets the report.
    }

    return report;
  }
}

/**
 * Sync the registry against the box, joining an in-flight run rather than starting a second.
 *
 * The promise is shared, not just the guard: both callers receive the same report object from the
 * same read of the box, so neither can be told about a state the other already changed.
 */
export function runSync(): Promise<CronSyncReport> {
  if (inFlight !== null) return inFlight;

  const run = performSync().finally(() => {
    inFlight = null;
  });

  inFlight = run;
  return run;
}

/**
 * Sync first when the registry's newest sync is older than `maxAgeMs`, or there is none.
 *
 * A crontab write starts its own sync (the house's crontab on PATH, the door's verbs), so this only
 * covers what no write announces: a line that changed some other way, or a journal that moved. A run
 * already in flight is joined, never doubled. Like runSync this never throws: a sync that failed is
 * its recorded report, and a newest-run read that fails counts as stale so the run records why.
 */
export async function syncWhenStale(maxAgeMs: number = READ_SYNC_AFTER_MS): Promise<void> {
  if (inFlight !== null) {
    await inFlight;
    return;
  }
  if (!isSyncStale(maxAgeMs)) return;
  await runSync();
}

/** Whether the newest `cron_sync_runs` row is older than `maxAgeMs`, absent, or unreadable. */
function isSyncStale(maxAgeMs: number): boolean {
  let newestRanAt: string | null;
  try {
    newestRanAt = cronJobsDb.lastSync()?.ranAt ?? null;
  } catch {
    // The records table would not answer; the sync that follows records the failure it meets.
    return true;
  }
  if (newestRanAt === null) return true;

  const ranAtMs = Date.parse(newestRanAt);
  return Number.isNaN(ranAtMs) || Date.now() - ranAtMs > maxAgeMs;
}
