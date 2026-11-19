import type { DayBucket } from '@/shared/dayBuckets';
import type { SchedulingEntry, SchedulingEntryWhole, SchedulingOverview } from '@/shared/scheduling-report-types';

/*
 * THE SCHEDULING VIEW'S MODEL: the shapes its root hands its parts. Types only, nothing here runs.
 *
 * The root (`SchedulingView`) holds three things of its own: the window, the filters and the open entry's id. Everything
 * else it draws arrives as two shapes, `SchedulingRead` (the window's entries and its two buckets) and `EntrySheetRead`
 * (the one entry its sheet is open on). The wire shapes inside them are `@/shared/scheduling-report-types`, and the day
 * bucket is `@/shared/dayBuckets`'s; this file adds only what the browser derives from them.
 *
 * AN ENTRY is the view's unit: one use of the Schedule-a-visit form from open to close (a form entry), or one change made
 * with no form, on the grid or through the API (a direct entry). On screen it is called a session.
 */

/** The window switch's three lengths, in days: the three the lane's `?days=` takes (`SchedulingWindowDays` on the wire), written out as the contract fixes them. */
export type SchedulingWindow = 7 | 30 | 90;

/**
 * What the view is narrowed to. `by` is one person's stamp (`actor`, `eis:<login>`) or null for everyone; `machines` lists
 * machine calls too. Those two are asked of the server. `bumpsOnly` is the browser's own: it hides the sessions that went
 * clean from the Sessions list and changes no count.
 */
export type SchedulingFilters = { by: string | null; machines: boolean; bumpsOnly: boolean };

/**
 * The window's read. `phase` is the first read's own: `loading` until it answers, `trouble` when the lane failed (`trouble`
 * then holds the lane's sentence). A read that fails after a good one keeps `overview` and sets `stale`. `days` is the
 * window bucketed by local day (a person's entry in its verdict's part, a machine's in the grey `test` part), and `hours`
 * is 24 counts: people's entries by the local hour they started.
 */
export type SchedulingRead = {
  phase: 'loading' | 'ready' | 'trouble';
  overview: SchedulingOverview | null;
  trouble: string | null;
  stale: boolean;
  days: DayBucket[];
  hours: number[];
};

/**
 * The open entry's read. `whole` is the entry with its form's report, its presses, the visit as it stands and what came
 * after; null while the read is out and when it failed (`trouble` then holds the lane's sentence).
 */
export type EntrySheetRead = {
  phase: 'loading' | 'ready' | 'trouble';
  whole: SchedulingEntryWhole | null;
  trouble: string | null;
};

/** The five pills, in the order drawn: each carries the reader to the section its figure counted. */
export type SchedulingPillKey = 'sessions' | 'bumps' | 'booked' | 'closed' | 'last';

/**
 * The window's sessions counted for the head and the pills. PEOPLE's entries only: a machine's is in none of these, listed
 * or not. `bumps` is the ones that did not go clean; `booked`, `changed` and `cancelled` are counted by how each ended,
 * `booked` and `changed` less the ones an Undo took back right after (a visit booked and undone is no visit booked);
 * `closed` is the booking forms that were closed with nothing booked; `last` is the newest of them.
 */
export type SchedulingTally = {
  sessions: number;
  bumps: number;
  booked: number;
  changed: number;
  cancelled: number;
  closed: number;
  last: SchedulingEntry | null;
};
