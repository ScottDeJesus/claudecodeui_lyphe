// protects: src/modules/project-workspace/hooks/useWorkspaceViews.ts, src/modules/project-workspace/WorkspaceMain.tsx, src/modules/analytics/AnalyticsPanel.tsx, src/modules/analytics/hooks/useAnalyticsSection.ts, src/modules/analytics/sections/code-mode/CodeModeSection.tsx, server/modules/analytics/analytics.routes.ts
// writes: none
// The place opened whole on the real route at desktop width: the rail's Analytics button, then each window of
// the head asked and answered, the controls standing through every switch.
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { withPage } from "../lib/app.mjs";

const ROUTE_PATH = "/api/analytics/code-mode";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const shown = (locator) => locator.isVisible().catch(() => false);

async function until(check, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) return null;
    await sleep(100);
  }
}

/** Every answer the page gets from the Code Mode section route: its days, its status, the response. */
function watch(page) {
  const seen = [];
  page.on("response", (res) => {
    let u;
    try { u = new URL(res.url()); } catch { return; }
    if (u.pathname !== ROUTE_PATH) return;
    seen.push({ days: Number(u.searchParams.get("days")), status: res.status(), res });
  });
  return seen;
}

const option = (page, words) => page.getByRole("radio", { name: words, exact: true })
  .or(page.getByRole("tab", { name: words, exact: true }))
  .or(page.getByRole("button", { name: words, exact: true })).first();

/** Pick one place of the wheel the Menu button opens: a press turns the wheel to it, a second picks it if the first did not. */
async function pickPlace(page, id, arrived) {
  const menu = page.getByRole("button", { name: "Menu", exact: true }).first();
  if (await shown(menu)) await menu.click();
  const place = page.locator("[data-place-name=\"" + id + "\"]").first();
  await place.waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
  if (!(await shown(place))) return false;
  await place.click();
  if (await until(arrived, 5000)) return true;
  if (await shown(place)) await place.click();
  return Boolean(await until(arrived, 10000));
}

/** The rail's Analytics button where the layout draws a rail; where it draws none (measured 2026-11-21: no data-view-id button is visible on /home nor in the Cerberus view at 1440), the wheel's Analytics place, the door a house view has at desktop. */
async function openFromRail(page) {
  const rail = page.locator("[data-view-id=\"analytics\"]").first();
  if (await shown(rail)) {
    await rail.click();
    return true;
  }
  return pickPlace(page, "analytics", () => shown(option(page, "30 days")));
}

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).split("\n")[0]));
  const seen = watch(page);
  if (!(await openFromRail(page))) return broken("at 1440 wide neither a rail button (data-view-id=analytics) nor the wheel Menu opens offers Analytics");
  const first = await until(() => seen.find((s) => s.days === 30), 20000);
  if (!first) return broken("pressing the rail's Analytics asked no " + ROUTE_PATH + "?days=30 within 20 s (asked: " + JSON.stringify(seen.map((s) => s.days)) + ")");
  if (first.status !== 200) return broken("the opening read (days=30) answered " + first.status);
  const steps = [];
  for (const days of [7, 90, 30]) {
    const from = seen.length;
    const choice = option(page, days + " days");
    if (!(await until(() => shown(choice), 5000))) return broken("the window " + days + " days is not drawn at the head (after " + (steps.join(", ") || "the opening") + ")");
    await choice.click();
    const got = await until(() => seen.slice(from).find((s) => s.days === days), 20000);
    if (!got) return broken("pressing " + days + " days asked no read for days=" + days);
    if (got.status !== 200) return broken("the read for days=" + days + " answered " + got.status);
    steps.push(days + " days " + got.status);
  }
  await sleep(1500);
  for (const days of [7, 30, 90]) {
    if (!(await shown(option(page, days + " days")))) return broken("after the switches the window " + days + " days is gone from the head");
  }
  if ((await page.getByRole("button", { name: "Try again" }).count()) > 0) return broken("the frame drew Try again over a route that answered 200");
  if (errors.length) return broken("the page threw: " + errors[0]);
  return held("at 1440 wide the rail's Analytics opened on days=30 (200); the head answered " + steps.join(", ") + "; all three windows still drawn");
});
