import type { UploadRunSummary } from '@/shared/upload-runs-types';

const HOURS_IN_A_DAY = 24;

/**
 * The window's presses by the hour of the day they fell in, in the BROWSER's local time: 24 counts, midnight first. A press
 * is an armed run, the one still going included (it was pressed); a test run is not one, so it is in none, as it is in none
 * of the view's figures. A run whose `started_at` cannot be read is left out rather than counted in the wrong hour.
 *
 * Used by `useUploadsRead`, which hands the counts to How often as `read.hours`.
 */
export function bucketHours(runs: UploadRunSummary[]): number[] {
  const hours = Array.from({ length: HOURS_IN_A_DAY }, () => 0);
  for (const run of runs) {
    if (run.dry_run) continue;
    const hour = new Date(run.started_at).getHours();
    if (Number.isInteger(hour)) hours[hour] += 1;
  }
  return hours;
}
