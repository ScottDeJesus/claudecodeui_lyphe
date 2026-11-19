// A burst of the Uploads feed's frames is one read: the feed's open reads the overview at once, and the frames that arrive
// with it are one more read about a second later (the coalesced call's window), never one read per frame and never none.
//
// The feed is this case's own answer. Its first dial is a quiet 200 that ends and asks the browser to re-dial in 2 s; that
// re-dial is answered with three run frames at once and asks for no further reconnect for ten minutes. The overview is an
// empty window, also the case's own. Nothing reaches the engine and nothing is written.
//
// protects: src/shared/hooks/useEventFeed.ts, src/shared/hooks/useCoalescedCall.ts, src/modules/upload-runs/hooks/useRunsFeed.ts, src/modules/upload-runs/hooks/useUploadsRead.ts, src/modules/upload-runs/utils/uploadsFrames.ts
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
const FRAMES = 3;
const LOOK_MS = 3000; // the reads counted after the dial that carries the frames
const COALESCE_MS = 1000; // useUploadsRead's FRAME_COALESCE_MS
const EARLIEST_SECOND_READ_MS = 800; // the coalesced read may not come sooner than this after the dial

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

const frame = (n) => `data: ${JSON.stringify({ type: "run", session_id: `case-burst-${n}`, edge: "state", state: "running", at: new Date().toISOString() })}\n\n`;

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
  await page.route(OVERVIEW, (route) => {
    reads.push(Date.now());
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(emptyOverview(route.request().url())) });
  });
  await page.route(FEED, (route) => {
    dials.push(Date.now());
    const body = dials.length === 1 ? "retry: 2000\n\n" : `retry: 600000\n\n${Array.from({ length: FRAMES }, (_, n) => frame(n)).join("")}`;
    return route.fulfill({ status: 200, contentType: "text/event-stream", body });
  });

  await openUploads(page);
  const deadline = Date.now() + WAIT_MS;
  while (dials.length < 2 && Date.now() < deadline) await page.waitForTimeout(200);
  if (dials.length < 2) return broken(`the feed was dialled ${dials.length} time(s) in ${WAIT_MS / 1000} s; the browser's own re-dial after a quiet stream never came`);
  await page.waitForTimeout(LOOK_MS + 500);

  const at = dials[1];
  const after = reads.filter((r) => r >= at && r - at <= LOOK_MS).map((r) => r - at);
  if (after.length === 1) return broken(`the dial carrying ${FRAMES} frames read the overview once (${after[0]} ms, its open) and the frames read nothing`);
  if (after.length !== 2) return broken(`the dial carrying ${FRAMES} frames was followed by ${after.length} overview reads at ${after.join(", ")} ms, not 2 (the open, then one for the burst)`);
  if (after[1] < EARLIEST_SECOND_READ_MS) return broken(`the burst's read came ${after[1]} ms after the dial, inside the ${COALESCE_MS} ms window it is coalesced over`);
  return held(`the dial carrying ${FRAMES} frames read the overview at +${after[0]} ms (its open) and once more at +${after[1]} ms for the whole burst`);
});
