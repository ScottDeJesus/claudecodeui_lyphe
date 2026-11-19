// What a Scheduling filter asks of the server: Speed bumps only is the browser's own (it takes the clean session off the
// list and reads nothing), Machine calls reads the overview once with `machines=1`, and a window press reads it once for
// that window, the Machine calls answer kept.
//
// The lane's answers are this case's own: one person's clean session and one person's hiccup, whatever is asked; the feed
// is one quiet stream that asks for no reconnect for ten minutes, so no open interleaves a read. Nothing reaches the
// backend and nothing is written.
//
// protects: src/modules/scheduling-report/SchedulingView.tsx, src/modules/scheduling-report/EntryList.tsx, src/modules/scheduling-report/hooks, src/shared/api.ts
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { FEED, OVERVIEW, json, openScheduling, overviewFor, person } from "../lib/scheduling_report.mjs";

const DESKTOP = { width: 1440, height: 900 };
const WAIT_MS = 30000;
const QUIET_MS = 2000;
const CLEAN = person(1);
const HICCUP = person(2, { verdict: "hiccup" });

runCase(async (t) => {
  const page = await withPage(t, { viewport: DESKTOP });
  const reads = [];
  await page.route(OVERVIEW, (route) => {
    const ask = new URL(route.request().url()).searchParams;
    reads.push({ at: Date.now(), days: ask.get("days"), machines: ask.get("machines") });
    return route.fulfill(json(overviewFor(route.request().url(), [CLEAN, HICCUP])));
  });
  await page.route(FEED, (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: "retry: 600000\n\n" }));

  if (!(await openScheduling(page))) return broken("the Cerberus strip holds no Scheduling tab: the view is not wired in");
  await page.locator(`[data-scheduling-sessions] [data-scheduling-entry="${CLEAN.id}"]`).waitFor({ timeout: WAIT_MS });
  await page.waitForTimeout(1000); // the show's read and the feed's open read have both landed

  const pressed = async (name) => {
    const at = Date.now();
    await page.locator("[data-scheduling-sessions]").getByRole("button", { name, exact: true }).first().click({ timeout: WAIT_MS });
    await page.waitForTimeout(QUIET_MS);
    return reads.filter((r) => r.at >= at);
  };

  const bumps = await pressed("Speed bumps only");
  if (bumps.length > 0) return broken(`Speed bumps only read the overview ${bumps.length} time(s); it is the browser's own and reads nothing`);
  if ((await page.locator(`[data-scheduling-sessions] [data-scheduling-entry="${CLEAN.id}"]`).count()) > 0) return broken("Speed bumps only left the clean session on the list");
  if ((await page.locator(`[data-scheduling-sessions] [data-scheduling-entry="${HICCUP.id}"]`).count()) === 0) return broken("Speed bumps only took the hiccup off the list too");

  const machines = await pressed("Machine calls");
  if (machines.length !== 1) return broken(`Machine calls read the overview ${machines.length} time(s), not once`);
  if (machines[0].machines !== "1") return broken(`Machine calls read the overview with machines=${machines[0].machines}, not 1`);

  const at = Date.now();
  await page.getByRole("radio", { name: "7 days", exact: true }).click({ timeout: WAIT_MS });
  await page.waitForTimeout(QUIET_MS);
  const week = reads.filter((r) => r.at >= at);
  if (week.length !== 1) return broken(`7 days read the overview ${week.length} time(s), not once`);
  if (week[0].days !== "7" || week[0].machines !== "1") return broken(`7 days read the overview with days=${week[0].days} machines=${week[0].machines}, not days=7 machines=1`);
  return held("Speed bumps only read nothing and listed only the hiccup; Machine calls read once with machines=1; 7 days read once with days=7 and machines=1");
});
