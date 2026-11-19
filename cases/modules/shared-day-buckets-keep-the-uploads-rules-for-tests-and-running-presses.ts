// The day and hour bucketing two Cerberus views share (src/shared/dayBuckets.ts) keeps the rules the Uploads view drew
// by: one bucket per LOCAL date the window touches, oldest first and the last one today, stepped by the calendar so the
// day the clocks change on is one bucket; a clean or hiccup item counts in its date's column and in its hour; a test
// counts in its column and in no hour; a part of null (a press still going) counts in no column and in its hour; an
// unreadable date, or one on a date outside the window, is in no column.
//
// The clock is pinned to America/Los_Angeles in this process before any date is read, and the window is the 7 days to
// noon on 2026-11-04, which holds 2026-11-01, the day the clocks fall back (25 hours, 01:00-02:00 twice).
//
// protects: src/shared/dayBuckets.ts, src/modules/upload-runs/hooks/useUploadsRead.ts
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";

process.env.TZ = "America/Los_Angeles"; // Node re-reads TZ on assignment; nothing below runs before it

type Part = "clean" | "hiccup" | "test" | null;
type Item = { at: string; part: Part };
type DayBucket = { day: string; clean: number; hiccup: number; test: number; today: boolean };

const NOW = Date.parse("2026-11-04T20:00:00Z"); // noon PST, Wednesday
const DAYS = 7;
// The window opens 2026-10-28 13:00 PDT, so it touches eight dates, the first one partial.
const DATES = ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"];

// Items inside the window: their columns and their hours are both judged.
const INSIDE: readonly Item[] = [
  { at: "2026-11-03T17:00:00Z", part: "clean" }, // 09:00 PST, Nov 3
  { at: "2026-11-03T17:10:00Z", part: "clean" }, // 09:10
  { at: "2026-11-03T17:30:00Z", part: "hiccup" }, // 09:30
  { at: "2026-11-03T19:00:00Z", part: "test" }, // 11:00: in the column, in no hour
  { at: "2026-11-03T21:00:00Z", part: null }, // 13:00: in no column, in the hour
  { at: "2026-11-01T08:30:00Z", part: "clean" }, // 01:30 PDT, Nov 1, the first pass of the repeated hour
  { at: "2026-11-01T09:30:00Z", part: "clean" }, // 01:30 PST, Nov 1, the second pass: the same date, the same hour
  { at: "2026-10-29T06:30:00Z", part: "hiccup" }, // 23:30 PDT, Oct 28: the partial first date, never Oct 29's UTC date
];
// Items no column holds: before the window's first date, after today, and a date that cannot be read.
const OUTSIDE: readonly Item[] = [
  { at: "2026-10-27T17:00:00Z", part: "clean" },
  { at: "2026-11-05T17:00:00Z", part: "hiccup" },
  { at: "not a date", part: "clean" },
];

const EXPECTED_COLUMNS: Record<string, { clean: number; hiccup: number; test: number }> = {
  "2026-10-28": { clean: 0, hiccup: 1, test: 0 },
  "2026-11-01": { clean: 2, hiccup: 0, test: 0 },
  "2026-11-03": { clean: 2, hiccup: 1, test: 1 },
};
const EXPECTED_HOURS: Record<number, number> = { 1: 2, 9: 3, 13: 1, 23: 1 }; // every other hour 0, hour 11 (the test) included

runCase(async () => {
  let shared: { bucketDays: (items: Item[], days: number, now: number) => DayBucket[]; bucketHours: (items: Item[]) => number[] };
  try {
    shared = await import("../../src/shared/dayBuckets.ts");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ERR_MODULE_NOT_FOUND" && String((error as Error).message).includes("dayBuckets")) {
      return broken("src/shared/dayBuckets.ts is not there: the two views have no shared home for the day and hour bucketing");
    }
    throw error;
  }
  if (typeof shared.bucketDays !== "function" || typeof shared.bucketHours !== "function") {
    return broken("src/shared/dayBuckets.ts exports no bucketDays or no bucketHours");
  }

  const wrong: string[] = [];
  const buckets = shared.bucketDays([...INSIDE, ...OUTSIDE], DAYS, NOW);
  const dates = buckets.map((bucket) => bucket.day);
  if (dates.join(",") !== DATES.join(",")) wrong.push(`the window's dates read ${dates.join(",")}, not ${DATES.join(",")}`);
  const todays = buckets.filter((bucket) => bucket.today).map((bucket) => bucket.day);
  if (todays.join(",") !== "2026-11-04") wrong.push(`today is marked on ${todays.join(",") || "no date"}, not 2026-11-04 alone`);
  for (const bucket of buckets) {
    const want = EXPECTED_COLUMNS[bucket.day] ?? { clean: 0, hiccup: 0, test: 0 };
    const got = { clean: bucket.clean, hiccup: bucket.hiccup, test: bucket.test };
    if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push(`${bucket.day} counted ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
  }

  const hours = shared.bucketHours([...INSIDE, OUTSIDE[2]]);
  if (hours.length !== 24) wrong.push(`the hour strip has ${hours.length} hours, not 24`);
  for (let hour = 0; hour < 24; hour += 1) {
    const want = EXPECTED_HOURS[hour] ?? 0;
    if (hours[hour] !== want) wrong.push(`hour ${hour} counted ${hours[hour]}, not ${want}`);
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("8 local dates for 7 days across the fall-back day, today last; a test in its column and no hour, a running press in its hour and no column, an unreadable or out-of-window date in no column");
});
