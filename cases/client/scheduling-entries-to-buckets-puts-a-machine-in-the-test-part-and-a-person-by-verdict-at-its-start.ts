// The Scheduling view's How often is bucketed from the overview's entries by when each STARTED, a person's entry in its
// verdict's part and a machine's in the grey `test` part, whatever the machine's verdict: so a machine's entry stands in
// its day's column and in no hour, and the hour strip counts people alone.
//
// Judged by handing src/modules/scheduling-report/utils/entriesToBuckets.ts an overview of three entries that each END an
// hour after they start (the hiccup across local midnight), and comparing what it answers with what the shared bucketing
// (src/shared/dayBuckets.ts) makes of the items the promise names. It may answer the items themselves or the days and
// hours made from them; it may take the overview or its entries. The clock is pinned to America/Los_Angeles.
//
// protects: src/modules/scheduling-report/utils/entriesToBuckets.ts, src/shared/dayBuckets.ts
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";

process.env.TZ = "America/Los_Angeles"; // Node re-reads TZ on assignment; nothing below runs before it

type Part = "clean" | "hiccup" | "test" | null;
type Item = { at: string; part: Part };

const GENERATED_AT = "2026-11-04T20:00:00Z"; // noon PST
const DAYS = 7;

function entry(n: number, actorKind: "person" | "machine", verdict: "clean" | "hiccup", started: string, ended: string) {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`, form: false, state: "direct", account_id: "c0ffee00-0000-4000-8000-00000000ca5e",
    actor: actorKind === "person" ? "eis:case-person" : "eis:machine:case", actor_kind: actorKind, kind: "book",
    result: verdict === "clean" ? "booked" : "nothing", opener: null, surface: "api", job: null, visit_id: null,
    started_at: started, ended_at: ended, open_seconds: null, presses: { total: 1, ok: 1, refused: 0, failed: 0 }, lead: null,
    verdict, tone: verdict === "clean" ? "positive" : "warn", reasons: [],
  };
}

const ENTRIES = [
  entry(1, "person", "clean", "2026-11-03T17:00:00Z", "2026-11-03T18:00:00Z"), // 09:00 PST Nov 3, ends 10:00
  entry(2, "person", "hiccup", "2026-11-03T07:30:00Z", "2026-11-03T08:30:00Z"), // 23:30 PST Nov 2, ends 00:30 Nov 3
  entry(3, "machine", "hiccup", "2026-11-02T19:00:00Z", "2026-11-02T20:00:00Z"), // 11:00 PST Nov 2: the test part, in no hour
];
const ITEMS: Item[] = [
  { at: ENTRIES[0].started_at, part: "clean" },
  { at: ENTRIES[1].started_at, part: "hiccup" },
  { at: ENTRIES[2].started_at, part: "test" },
];
const OVERVIEW = {
  generated_at: GENERATED_AT,
  window: { days: DAYS, from: "2026-10-28T20:00:00Z", to: GENERATED_AT },
  filters: { by: null, machines: true, account: null },
  kinds: [], entries: ENTRIES, truncated: false, openers: [], people: [], accounts: [],
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

runCase(async () => {
  let made: { entriesToBuckets?: (input: unknown) => unknown };
  try {
    made = await import("../../src/modules/scheduling-report/utils/entriesToBuckets.ts");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ERR_MODULE_NOT_FOUND" && String((error as Error).message).includes("entriesToBuckets")) {
      return broken("src/modules/scheduling-report/utils/entriesToBuckets.ts is not there: How often has no bucketing of the overview's entries");
    }
    throw error;
  }
  if (typeof made.entriesToBuckets !== "function") return broken("entriesToBuckets.ts exports no entriesToBuckets function");
  const shared = await import("../../src/shared/dayBuckets.ts");

  let answer: unknown;
  try {
    answer = made.entriesToBuckets(OVERVIEW);
  } catch {
    answer = made.entriesToBuckets(ENTRIES);
  }
  if (!Array.isArray(answer) && (answer === null || typeof answer !== "object")) answer = made.entriesToBuckets(ENTRIES);

  if (Array.isArray(answer)) {
    if (!same(answer, ITEMS)) return broken(`the items are ${JSON.stringify(answer)}, not ${JSON.stringify(ITEMS)} (by started_at; clean, hiccup, then the machine's test)`);
    return held("the three entries are items dated by started_at: clean, hiccup and the machine's test");
  }
  const { days, hours } = answer as { days?: unknown; hours?: unknown };
  if (!Array.isArray(days) || !Array.isArray(hours)) return broken(`entriesToBuckets answered neither items nor { days, hours }: ${JSON.stringify(answer).slice(0, 200)}`);
  const wantHours = shared.bucketHours(ITEMS);
  const wantDays = shared.bucketDays(ITEMS, DAYS, Date.parse(GENERATED_AT));
  if (!same(hours, wantHours)) {
    const lit = (h: number[]) => h.map((count, hour) => (count ? `${hour}h:${count}` : "")).filter(Boolean).join(" ");
    return broken(`the hour strip counts ${lit(hours as number[]) || "nothing"}, not ${lit(wantHours)} (people's entries by the hour they started; the machine's in no hour)`);
  }
  if (!same(days, wantDays)) {
    const lit = (d: { day: string; clean: number; hiccup: number; test: number }[]) => d.filter((b) => b.clean + b.hiccup + b.test).map((b) => `${b.day} c${b.clean} h${b.hiccup} t${b.test}`).join(", ");
    return broken(`the day columns read ${lit(days as never)}, not ${lit(wantDays)} (by the local date each started; the machine's as test)`);
  }
  return held("the day columns and the hour strip are the shared bucketing of the entries by started_at: people's by verdict, the machine's as test in no hour");
});
