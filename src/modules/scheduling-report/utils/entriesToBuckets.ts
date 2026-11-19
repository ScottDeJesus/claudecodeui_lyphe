import { bucketDays, bucketHours } from '@/shared/dayBuckets';
import type { DayBucket, DayBucketItem } from '@/shared/dayBuckets';
import type { SchedulingEntry, SchedulingOverview } from '@/shared/scheduling-report-types';

/**
 * An entry as a day's bucket item, dated by when it started. A machine's entry is the grey `test` part: it stands in
 * its day's column and in no hour, so a machine's calls never swell how often people schedule. A person's entry is its
 * verdict's part, `clean` or `hiccup`.
 *
 * Used by `entriesToBuckets`, which maps the overview's entries through it for both the day columns and the hour strip.
 */
function dayItemOf(entry: SchedulingEntry): DayBucketItem {
  return { at: entry.started_at, part: entry.actor_kind === 'machine' ? 'test' : entry.verdict };
}

/**
 * THE SCHEDULING VIEW'S BUCKETS. The overview's entries as the day columns and the hour strip, in the browser's local time.
 * The days are counted back from the moment the answer was made and not from the browser's own now, because the server counted
 * its window from that moment; the last column is the day its newest entries fell on. A machine's entry is the grey `test` part
 * (in its day's column, in no hour, in no figure); a person's is its verdict's part.
 *
 * Used by this module's `useSchedulingRead`, which hands the two to How often as `read.days` and `read.hours`.
 */
export function entriesToBuckets(overview: SchedulingOverview): { days: DayBucket[]; hours: number[] } {
  const items = overview.entries.map(dayItemOf);
  return {
    days: bucketDays(items, overview.window.days, Date.parse(overview.generated_at)),
    hours: bucketHours(items),
  };
}
