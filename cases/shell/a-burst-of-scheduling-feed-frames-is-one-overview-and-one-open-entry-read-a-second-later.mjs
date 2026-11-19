// A burst of the Scheduling feed's frames is one read of each thing on screen: with an entry's sheet open, the feed's open
// reads the overview at once, and the three `changed` frames that arrive with it are one more overview read and one read
// of the open entry about a second later (the coalesced call's window), never one read per frame and never none.
//
// The lane's answers are this case's own: an overview of two people's sessions, the opened entry's whole, and a feed whose
// dials are quiet streams asking a re-dial in 2 s until the sheet is open; the next dial then answers three frames at once
// and asks for no reconnect for ten minutes. Nothing reaches the backend and nothing is written.
//
// protects: src/shared/hooks/useEventFeed.ts, src/shared/hooks/useCoalescedCall.ts, src/shared/hooks/useLaneRead.ts, src/modules/scheduling-report/SchedulingView.tsx, src/modules/scheduling-report/hooks
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { ENTRY, FEED, OVERVIEW, json, openScheduling, overviewFor, person, wholeOf } from "../lib/scheduling_report.mjs";

const DESKTOP = { width: 1440, height: 900 };
const WAIT_MS = 30000;
const FRAMES = 3;
const LOOK_MS = 3000; // the reads counted after the dial that carries the frames
const COALESCE_MS = 1000; // the hook's coalescing window, as the brief fixes it
const EARLIEST_COALESCED_MS = 800; // a frame's read may not come sooner than this after the dial

const ENTRIES = [person(1), person(2, { verdict: "hiccup" })];
const FRAME = `data: ${JSON.stringify({ type: "changed" })}\n\n`;

runCase(async (t) => {
  const page = await withPage(t, { viewport: DESKTOP });
  const overviews = [];
  const entries = [];
  const dials = [];
  let armed = false;
  await page.route(OVERVIEW, (route) => {
    overviews.push(Date.now());
    return route.fulfill(json(overviewFor(route.request().url(), ENTRIES)));
  });
  await page.route(ENTRY, (route) => {
    entries.push(Date.now());
    const id = new URL(route.request().url()).pathname.split("/").pop();
    const entry = ENTRIES.find((e) => e.id === id);
    return route.fulfill(entry ? json(wholeOf(entry)) : json({ detail: "no such entry" }, 404));
  });
  await page.route(FEED, (route) => {
    dials.push({ at: Date.now(), armed });
    const body = armed ? `retry: 600000\n\n${FRAME.repeat(FRAMES)}` : "retry: 2000\n\n";
    return route.fulfill({ status: 200, contentType: "text/event-stream", body });
  });

  if (!(await openScheduling(page))) return broken("the Cerberus strip holds no Scheduling tab: the view is not wired in");
  const row = page.locator(`[data-scheduling-sessions] [data-scheduling-entry="${ENTRIES[0].id}"] button`).first();
  await row.waitFor({ timeout: WAIT_MS });
  await row.click();
  await page.locator("[data-scheduling-sheet]").first().waitFor({ timeout: WAIT_MS });
  const end = Date.now() + WAIT_MS;
  while (entries.length === 0 && Date.now() < end) await page.waitForTimeout(150);
  if (entries.length === 0) return broken("the sheet opened and the entry was never read");

  armed = true;
  const deadline = Date.now() + WAIT_MS;
  while (!dials.some((d) => d.armed) && Date.now() < deadline) await page.waitForTimeout(150);
  const burst = dials.find((d) => d.armed);
  if (!burst) return broken(`the feed was dialled ${dials.length} time(s) and never again once the sheet was open; the re-dial after a quiet stream never came`);
  await page.waitForTimeout(LOOK_MS + 500);

  const at = burst.at;
  const since = (list) => list.filter((r) => r >= at && r - at <= LOOK_MS).map((r) => r - at);
  const ov = since(overviews);
  const en = since(entries);
  const lateEntries = en.filter((r) => r >= EARLIEST_COALESCED_MS);
  if (ov.length === 1) return broken(`the dial carrying ${FRAMES} frames read the overview once (+${ov[0]} ms, its open) and the frames read nothing`);
  if (ov.length !== 2) return broken(`the dial carrying ${FRAMES} frames was followed by ${ov.length} overview reads at ${ov.join(", ")} ms, not 2 (the open, then one for the burst)`);
  if (ov[1] < EARLIEST_COALESCED_MS) return broken(`the burst's overview read came +${ov[1]} ms after the dial, inside the ${COALESCE_MS} ms window it is coalesced over`);
  if (lateEntries.length === 0) return broken(`the frames read the open entry ${en.length === 0 ? "never" : `only at ${en.join(", ")} ms, inside the coalescing window`}`);
  if (lateEntries.length > 1) return broken(`the ${FRAMES} frames read the open entry ${lateEntries.length} times (${lateEntries.join(", ")} ms), not once`);
  if (en.length > 2) return broken(`the dial and its ${FRAMES} frames read the open entry ${en.length} times (${en.join(", ")} ms)`);
  return held(`the dial carrying ${FRAMES} frames read the overview at +${ov[0]} ms (its open) and +${ov[1]} ms (the burst), and the open entry once for the burst at +${lateEntries[0]} ms`);
});
