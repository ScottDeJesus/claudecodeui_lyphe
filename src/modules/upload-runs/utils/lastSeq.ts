import type { UploadRunSummary } from '@/shared/upload-runs-types';

/**
 * The highest `seq` the run has stamped, as far as its summary can say. The wire carries how many bubbles the record HOLDS
 * (`counts.events`) and, as the `events_not_kept` reason's count, how many it let go (`last_seq` less those held), and never
 * `last_seq` itself; the two add up to it. A run that kept every bubble has no such reason and its count is its last `seq`.
 *
 * Used by `useLiveRun` (to open the live stream a little behind the newest event, and to tell the bubbles the row has not
 * counted yet) and `useRunEvents` (to read the newest page of a run's events).
 */
export function lastSeqOf(run: Pick<UploadRunSummary, 'counts' | 'reasons'>): number {
  const notKept = run.reasons.find((reason) => reason.code === 'events_not_kept')?.count ?? 0;
  return run.counts.events + notKept;
}
