// A re-read of the Scheduling overview that fails after a good one keeps the last answer on screen: Refresh answered 502
// leaves both sessions listed, under the stale strip that says it is the last answer and how old, and the view reads
// `stale`; Try again answered 200 takes the strip away and the view reads `ready`.
//
// The lane's answers are this case's own: two people's sessions, then a 502 in the lane's own failure shape, then the two
// sessions again; the feed is one quiet stream that asks for no reconnect for ten minutes. Nothing reaches the backend and
// nothing is written.
//
// protects: src/shared/hooks/useLaneRead.ts, src/modules/scheduling-report/SchedulingView.tsx, src/modules/scheduling-report/hooks
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { FEED, OVERVIEW, json, openScheduling, overviewFor, person } from "../lib/scheduling_report.mjs";

const DESKTOP = { width: 1440, height: 900 };
const WAIT_MS = 30000;
const ENTRIES = [person(1), person(2, { verdict: "hiccup" })];
const VIEW = "[data-scheduling-view]";
const ROWS = "[data-scheduling-sessions] [data-scheduling-entry]"; // the Sessions list's rows; a kind's list draws the same entries again
const STALE_WORDS = /Showing the last answer/;

runCase(async (t) => {
  const page = await withPage(t, { viewport: DESKTOP });
  let failing = false;
  let reads = 0;
  await page.route(OVERVIEW, (route) => {
    reads += 1;
    if (failing) return route.fulfill(json({ error: "case: the backend did not answer" }, 502));
    return route.fulfill(json(overviewFor(route.request().url(), ENTRIES)));
  });
  await page.route(FEED, (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: "retry: 600000\n\n" }));

  if (!(await openScheduling(page))) return broken("the Cerberus strip holds no Scheduling tab: the view is not wired in");
  const view = page.locator(VIEW).first();
  await page.locator(ROWS).nth(ENTRIES.length - 1).waitFor({ timeout: WAIT_MS });
  await page.waitForTimeout(800); // the feed's open read lands before the failing one is armed

  failing = true;
  const before = reads;
  await page.getByRole("button", { name: "Refresh", exact: true }).click({ timeout: WAIT_MS });
  const end = Date.now() + WAIT_MS;
  while (reads === before && Date.now() < end) await page.waitForTimeout(150);
  if (reads === before) return broken("Refresh pressed, the view read no overview");
  await page.waitForTimeout(1200);
  const state = await view.getAttribute("data-scheduling-view");
  const rows = await page.locator(ROWS).count();
  const strip = await page.getByRole("alert").filter({ hasText: STALE_WORDS }).count();
  if (rows !== ENTRIES.length) return broken(`a failed re-read left ${rows} of the ${ENTRIES.length} rows on screen (the view reads ${state})`);
  if (state !== "stale") return broken(`a failed re-read with the rows kept leaves the view reading ${state}, not stale`);
  if (strip === 0) return broken("a failed re-read kept the rows but drew no stale strip saying it is the last answer");

  failing = false;
  await page.getByRole("alert").filter({ hasText: STALE_WORDS }).getByRole("button", { name: "Try again" }).click({ timeout: WAIT_MS });
  const done = Date.now() + WAIT_MS;
  while ((await view.getAttribute("data-scheduling-view")) !== "ready" && Date.now() < done) await page.waitForTimeout(150);
  const after = await view.getAttribute("data-scheduling-view");
  if (after !== "ready") return broken(`Try again answered 200 left the view reading ${after}, not ready`);
  if ((await page.getByRole("alert").filter({ hasText: STALE_WORDS }).count()) > 0) return broken("Try again answered 200 and the stale strip still stands");
  return held(`Refresh answered 502 kept both rows under the stale strip (view ${state}); Try again answered 200 brought it back to ready`);
});
