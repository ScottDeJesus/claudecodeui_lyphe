/*
 * The day and hour bucketing of a view's items in the browser's local time, shared by Cerberus's views.
 */

/** One day of the window, in the browser's local time (`day` is local YYYY-MM-DD): its items by part (clean, hiccup, test), and whether it is today. */
export type DayBucket = { day: string; clean: number; hiccup: number; test: number; today: boolean };

/** One item to bucket: `at` when it happened (an ISO time), `part` the column part it counts in; `null` is in no day's column (e.g. a run with no verdict yet) but is in the hour strip; `test` is in a column and in no hour. */
export type DayBucketItem = { at: string; part: 'clean' | 'hiccup' | 'test' | null };

/** The length of the server's window is counted in whole 24-hour days back from the moment it answered. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const HOURS_IN_A_DAY = 24;

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
 * must hold what that figure holds. An item lands in the day its `at` falls on in the reader's own calendar, so a press
 * at 11 pm is that evening's and never tomorrow's UTC date. The days are stepped by the calendar and not by 24 hours, so a
 * day the clocks change on is still one bucket.
 *
 * An item counts in its `part`; a `null` part counts in none. An item outside the buckets (older than the window opened, or
 * started after `now`) is left out.
 *
 * Used by the upload-runs module's `useUploadsRead` and the scheduling-report module's `entriesToBuckets`, which hand the
 * buckets to How often as `read.days`.
 */
export function bucketDays(items: DayBucketItem[], days: number, now: number): DayBucket[] {
  const lastDay = startOfDay(new Date(now));
  const today = localDay(lastDay);
  const buckets = new Map<string, DayBucket>();
  for (let cursor = startOfDay(new Date(now - days * MS_PER_DAY)); cursor <= lastDay; cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)) {
    const day = localDay(cursor);
    buckets.set(day, { day, clean: 0, hiccup: 0, test: 0, today: day === today });
  }
  for (const item of items) {
    const bucket = buckets.get(localDay(new Date(item.at)));
    if (bucket === undefined) continue;
    if (item.part !== null) bucket[item.part] += 1;
  }
  return [...buckets.values()];
}

/**
 * The window's items by the hour of the day they fell in, in the BROWSER's local time: 24 counts, midnight first. A press is
 * any item but a `test`, a null `part` included (it was pressed); a `test` is not one, so it is in none, as it is in none of
 * the view's figures. An item whose `at` cannot be read is left out rather than counted in the wrong hour.
 *
 * Used by the upload-runs module's `useUploadsRead` and the scheduling-report module's `entriesToBuckets`, which hand the
 * counts to How often as `read.hours`.
 */
export function bucketHours(items: DayBucketItem[]): number[] {
  const hours = Array.from({ length: HOURS_IN_A_DAY }, () => 0);
  for (const item of items) {
    if (item.part === 'test') continue;
    const hour = new Date(item.at).getHours();
    if (Number.isInteger(hour)) hours[hour] += 1;
  }
  return hours;
}
