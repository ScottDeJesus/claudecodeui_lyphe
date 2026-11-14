import type { DayBucket } from '@/modules/upload-runs/utils/uploadsModel';
import type { UploadRunSummary } from '@/shared/upload-runs-types';

/** The length of the server's window is counted in whole 24-hour days back from the moment it answered. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A date as the reader's own calendar says it: local `YYYY-MM-DD`, which is what `DayBucket.day` is. */
function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The local calendar day a date falls on, as the day's first moment. */
const startOfDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * The window bucketed by day in the BROWSER's local time: one bucket for each local day the window touches, oldest first, the
 * last one today (the day `now` falls on). The server's window opens at `now` less `days` whole days, which is some hour of a
 * day and not its midnight, so it touches one local day more than `days` (a 7-day window spans eight dates): the first of them
 * is a PARTIAL day, and it has a bucket, because the runs the window holds on it are counted in the Runs figure and the chart
 * must hold what that figure holds. A run lands in the day its `started_at` falls on in the reader's own calendar, so a press
 * at 11 pm is that evening's and never tomorrow's UTC date. The days are stepped by the calendar and not by 24 hours, so a
 * day the clocks change on is still one bucket.
 *
 * Armed runs split into clean and hiccup; a test run counts as `test`; a run still going counts in none, since it has no
 * verdict yet and the next read will place it. A run outside the buckets (older than the window opened, or started after
 * `now`) is left out.
 *
 * Used by `useUploadsRead`, which hands the buckets to How often as `read.days`.
 */
export function bucketDays(runs: UploadRunSummary[], days: number, now: number): DayBucket[] {
  const lastDay = startOfDay(new Date(now));
  const today = localDay(lastDay);
  const buckets = new Map<string, DayBucket>();
  for (let cursor = startOfDay(new Date(now - days * MS_PER_DAY)); cursor <= lastDay; cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)) {
    const day = localDay(cursor);
    buckets.set(day, { day, clean: 0, hiccup: 0, test: 0, today: day === today });
  }
  for (const run of runs) {
    const bucket = buckets.get(localDay(new Date(run.started_at)));
    if (bucket === undefined) continue;
    if (run.dry_run) bucket.test += 1;
    else if (run.verdict === 'clean') bucket.clean += 1;
    else if (run.verdict === 'hiccup') bucket.hiccup += 1;
  }
  return [...buckets.values()];
}
