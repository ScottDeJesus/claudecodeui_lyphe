// The Uploads view's one feed connection, refused, is dialled again: a browser never re-dials an EventSource answered with
// a status, so the feed arms one wait of 1 s, then 2 s (doubling to 30 s), says so once in the console in the Uploads
// view's own words, and the dial that answers reads the overview again, since whatever moved while it was refused is lost.
//
// The feed is this case's own answer (503 twice, then a quiet 200 that asks the browser to wait ten minutes before any
// reconnect of its own), and so is the overview (an empty window). Nothing reaches the engine and nothing is written.
//
// protects: src/shared/hooks/useEventFeed.ts, src/modules/upload-runs/hooks/useRunsFeed.ts, src/modules/upload-runs/hooks/useUploadsRead.ts
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";

const DESKTOP = { width: 1440, height: 900 };
const WAIT_MS = 30000;
// Read off src/ and the live page 2026-11-18: the rail, the home's Menu and its Cerberus entry, the routes the view reads.
const CERBERUS = 'nav[aria-label="Views"] button[aria-label="Cerberus"]';
const HOME_MENU = 'button[aria-label="Menu"]';
const MENU_ENTRY = ':is([role="menu"], [role="dialog"]) :is(button, [role="menuitem"])';
const OVERVIEW = "**/api/upload-runs/overview*";
const FEED = "**/api/upload-runs/feed*";
const REFUSED = 2; // dials answered 503 before the one that answers
const WARNING = "The upload runs feed was refused; dialling it again in 1 s";
// The waits the feed must keep (REDIAL_FIRST_MS, doubled), with room for a loaded box either side.
const FIRST_WAIT = [800, 1800];
const SECOND_WAIT = [1700, 3200];
const OPEN_READ_MS = 2500; // the overview read the answering dial causes must start within this long

function emptyOverview(url) {
  const days = Number(new URL(url).searchParams.get("days") ?? 30);
  const now = new Date();
  const type = (upload_type) => ({ upload_type, clean: 0, hiccups: 0, live: 0, trend: null, last_at: null });
  return {
    generated_at: now.toISOString(),
    window: { days, from: new Date(now.getTime() - days * 86400000).toISOString(), to: now.toISOString() },
    filters: { by: null, tests: 0, account: null }, live: null, types: [type("initial"), type("final")],
    runs: [], truncated: false, people: [], accounts: [],
  };
}

/** Cerberus from the rail, or from the home's Menu where the home stands, then its Uploads tab. */
async function openUploads(page) {
  await page.locator(`${CERBERUS}:visible, ${HOME_MENU}:visible`).first().waitFor({ timeout: WAIT_MS });
  if ((await page.locator(`${CERBERUS}:visible`).count()) > 0) {
    await page.locator(`${CERBERUS}:visible`).first().click({ timeout: WAIT_MS });
  } else {
    await page.locator(`${HOME_MENU}:visible`).first().click();
    await page.locator(MENU_ENTRY, { hasText: /^\s*Cerberus\s*$/ }).first().click({ timeout: WAIT_MS });
  }
  await page.getByRole("tab", { name: "Uploads", exact: true }).click({ timeout: WAIT_MS });
}

runCase(async (t) => {
  const page = await withPage(t, { viewport: DESKTOP });
  const dials = [];
  const reads = [];
  const warnings = [];
  page.on("console", (message) => {
    if (/feed was refused/.test(message.text())) warnings.push(message.text());
  });
  await page.route(OVERVIEW, (route) => {
    reads.push(Date.now());
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(emptyOverview(route.request().url())) });
  });
  await page.route(FEED, (route) => {
    dials.push(Date.now());
    if (dials.length <= REFUSED) return route.fulfill({ status: 503, contentType: "text/plain", body: "the engine is booting" });
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: "retry: 600000\n\n" });
  });

  await openUploads(page);
  const deadline = Date.now() + WAIT_MS;
  while (dials.length <= REFUSED && Date.now() < deadline) await page.waitForTimeout(200);
  if (dials.length <= REFUSED) {
    return broken(`the feed was dialled ${dials.length} time(s) in ${WAIT_MS / 1000} s after ${Math.min(dials.length, REFUSED)} refusal(s): a refused feed was never dialled again`);
  }
  await page.waitForTimeout(OPEN_READ_MS + 500);

  const wrong = [];
  const [first, second, third] = dials;
  const gap1 = second - first;
  const gap2 = third - second;
  if (gap1 < FIRST_WAIT[0] || gap1 > FIRST_WAIT[1]) wrong.push(`the first re-dial came ${gap1} ms after the refusal, not about 1 s`);
  if (gap2 < SECOND_WAIT[0] || gap2 > SECOND_WAIT[1]) wrong.push(`the second re-dial came ${gap2} ms after the refusal, not about 2 s`);
  if (dials.length !== REFUSED + 1) wrong.push(`the feed was dialled ${dials.length} times, not ${REFUSED + 1}: an answered feed was dialled again`);
  if (warnings.length !== 1 || !warnings[0].startsWith(WARNING)) wrong.push(`the console said ${JSON.stringify(warnings)}, not once "${WARNING}…"`);
  const openRead = reads.find((at) => at >= third && at - third <= OPEN_READ_MS);
  if (openRead === undefined) wrong.push(`no overview read followed the dial that answered within ${OPEN_READ_MS} ms`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`refused twice, the feed was dialled again ${gap1} ms then ${gap2} ms later, said "${warnings[0].slice(0, 80)}…" once, and its open read the overview ${openRead - third} ms after the answering dial`);
});
