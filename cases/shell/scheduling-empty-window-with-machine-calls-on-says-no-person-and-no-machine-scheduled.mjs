// The Scheduling view's empty window, with Machine calls on: the lane answers `filters.machines` as a JSON boolean
// (eis_backend/scheduling_report/read.py writes the ask's bool through, measured on :3011 2026-11-18: `"machines":true`),
// and the empty state must then say that no person and no machine scheduled anything — the machine-aware sentence.
//
// The lane's answers are this case's own: an overview with no entry for every ask, its `filters` echoing the ask the way
// read.py does (overviewFor, a boolean); the feed is one quiet stream that asks for no reconnect for ten minutes. Nothing
// reaches the backend and nothing is written.
//
// protects: src/modules/scheduling-report/SchedulingView.tsx, src/shared/scheduling-report-types.ts
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { FEED, OVERVIEW, json, openScheduling, overviewFor } from "../lib/scheduling_report.mjs";

const DESKTOP = { width: 1440, height: 900 };
const WAIT_MS = 30000;
// common.json's cerberus.scheduling.empty.messageMachines and .message, read 2026-11-18 (.message reworded to speak of people only the same day).
const MACHINES_SAID = "No person and no machine scheduled anything in this window.";
const PEOPLE_SAID = "Nobody booked, changed or cancelled a visit in this window";

runCase(async (t) => {
  const page = await withPage(t, { viewport: DESKTOP });
  const asked = [];
  await page.route(OVERVIEW, (route) => {
    asked.push(new URL(route.request().url()).searchParams.get("machines"));
    return route.fulfill(json(overviewFor(route.request().url(), [])));
  });
  await page.route(FEED, (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: "retry: 600000\n\n" }));

  if (!(await openScheduling(page))) return broken("the Cerberus strip holds no Scheduling tab: the view is not wired in");
  const empty = page.getByText(PEOPLE_SAID).or(page.getByText(MACHINES_SAID)).first();
  await empty.waitFor({ timeout: WAIT_MS });

  const before = asked.length;
  await page.getByRole("button", { name: "Machine calls", exact: true }).first().click({ timeout: WAIT_MS });
  await page.waitForTimeout(1500); // the press's read has landed and the empty state is drawn from its answer
  if (!asked.slice(before).includes("1")) return broken(`Machine calls asked no overview with machines=1 (asked: ${asked.slice(before).join(",") || "nothing"})`);

  if ((await page.getByText(MACHINES_SAID).count()) > 0) return held("an empty window with Machine calls on says no person and no machine scheduled anything");
  if ((await page.getByText(PEOPLE_SAID).count()) > 0) {
    return broken("with Machine calls on and the lane answering filters.machines true, the empty state still says only that no form was opened: the machine-aware sentence never shows");
  }
  return broken("with Machine calls on, the empty window shows neither of its two sentences");
});
