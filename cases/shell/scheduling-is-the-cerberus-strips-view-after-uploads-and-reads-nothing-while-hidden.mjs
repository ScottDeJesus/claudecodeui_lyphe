// The Scheduling view is the Cerberus strip's view after Uploads, kept mounted once shown, and it reads only while it is
// shown (MAN-8918's kept-view rule): shown, it reads the overview and dials its feed; hidden behind Fleet, it asks the lane
// nothing at all, its feed closed; shown again, it reads the overview again, for the window it was left on.
//
// The lane's answers are this case's own: an overview holding one person's session, and a feed that answers a quiet stream
// asking the browser to re-dial in 1.5 s, so a feed left open would be seen dialling again while the view is hidden.
// Nothing reaches the backend and nothing is written.
//
// protects: src/modules/cerberus/CerberusPanel.tsx, src/modules/cerberus/hooks/useKeptViews.ts, src/modules/cerberus/KeptView.tsx, src/shared/types.ts, src/modules/scheduling-report/SchedulingView.tsx, src/modules/scheduling-report/index.ts, src/shared/hooks/useEventFeed.ts, src/shared/hooks/useLaneRead.ts
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { FEED, OVERVIEW, isLaneRequest, json, openCerberus, overviewFor, person, schedulingTab } from "../lib/scheduling_report.mjs";

const DESKTOP = { width: 1440, height: 900 };
const WAIT_MS = 30000;
const QUIET_MS = 5000; // how long the hidden view is watched for any request
const SETTLE_MS = 400; // a request already on its way when Fleet is pressed is not the hidden view's
const PANEL = '[role="tabpanel"][aria-label="Scheduling"]';

async function until(page, check, ms = WAIT_MS) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await page.waitForTimeout(150);
  }
  return check();
}

runCase(async (t) => {
  const page = await withPage(t, { viewport: DESKTOP });
  const asked = []; // [ms, path, query] of every scheduling-report request the page makes
  page.on("request", (request) => {
    if (!isLaneRequest(request.url())) return;
    const url = new URL(request.url());
    asked.push({ at: Date.now(), path: url.pathname, days: url.searchParams.get("days") });
  });
  await page.route(OVERVIEW, (route) => route.fulfill(json(overviewFor(route.request().url(), [person(1)]))));
  await page.route(FEED, (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: "retry: 1500\n\n" }));

  await openCerberus(page);
  const names = await page.getByRole("tab").allInnerTexts().then((all) => all.map((name) => name.trim()));
  const uploadsAt = names.indexOf("Uploads");
  const tab = await schedulingTab(page);
  if (tab === null) return broken(`the Cerberus strip holds no Scheduling tab (its tabs: ${names.join(", ")})`);
  if (names.indexOf("Scheduling") !== uploadsAt + 1) return broken(`Scheduling is not the tab right after Uploads (the strip: ${names.join(", ")})`);

  await tab.click({ timeout: WAIT_MS });
  const overviews = () => asked.filter((a) => a.path.endsWith("/overview"));
  const dials = () => asked.filter((a) => a.path.endsWith("/feed"));
  if (!(await until(page, () => overviews().length > 0 && dials().length > 0))) {
    return broken(`shown, the view made ${overviews().length} overview read(s) and ${dials().length} feed dial(s) in ${WAIT_MS / 1000} s; it should make at least one of each`);
  }
  await page.locator(`${PANEL} [data-scheduling-sessions] [data-scheduling-entry]`).first().waitFor({ timeout: WAIT_MS });
  await page.getByRole("radio", { name: "7 days", exact: true }).click({ timeout: WAIT_MS });
  if (!(await until(page, () => overviews().some((a) => a.days === "7"), 10000))) return broken("7 days pressed, the view read no overview for 7 days");

  await page.getByRole("tab", { name: "Fleet", exact: true }).click({ timeout: WAIT_MS });
  const hiddenAt = Date.now();
  await page.waitForTimeout(QUIET_MS + SETTLE_MS);
  const whileHidden = asked.filter((a) => a.at >= hiddenAt + SETTLE_MS && a.at <= hiddenAt + SETTLE_MS + QUIET_MS);
  const mounted = await page.locator(`${PANEL}[hidden] [data-scheduling-view]`).count();
  if (mounted === 0) return broken("behind Fleet, the Scheduling view is not kept mounted under a hidden tabpanel");
  if (whileHidden.length > 0) {
    return broken(`hidden behind Fleet, the view asked the lane ${whileHidden.length} time(s) in ${QUIET_MS / 1000} s: ${whileHidden.map((a) => a.path.split("/").pop()).join(", ")}`);
  }

  const back = Date.now();
  await tab.click({ timeout: WAIT_MS });
  const returned = () => overviews().filter((a) => a.at >= back);
  if (!(await until(page, () => returned().length > 0, 10000))) return broken("shown again, the view read no overview");
  if (returned()[0].days !== "7") return broken(`shown again, the view read the overview for ${returned()[0].days ?? "the default"} days, not the 7 it was left on`);
  return held(`Scheduling stands right after Uploads; hidden behind Fleet it stayed mounted and asked the lane nothing for ${QUIET_MS / 1000} s; shown again it read the 7-day overview`);
});
