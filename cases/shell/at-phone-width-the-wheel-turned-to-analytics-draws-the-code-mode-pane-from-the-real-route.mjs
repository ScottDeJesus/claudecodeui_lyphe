// protects: src/modules/project-workspace/context/PlacesContext.tsx, src/modules/project-workspace/places/PlacesWheel.tsx, src/shared/types.ts, src/modules/project-workspace/WorkspaceMain.tsx, src/modules/analytics/AnalyticsPanel.tsx
// writes: none
// The place on the wheel at phone width: Menu opens the wheel, Analytics is turned to and picked, and the pane
// draws from the real route inside the screen.
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

/** The rail stands in the workspace; the home screen draws none, so the case enters through the wheel's Cerberus place (a read-only view) and presses the rail's Analytics there. */
async function openFromRail(page) {
  const rail = page.locator("[data-view-id=\"analytics\"]").first();
  if (!(await shown(rail))) await pickPlace(page, "cerberus", () => shown(rail));
  if (!(await shown(rail))) return false;
  await rail.click();
  return true;
}

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).split("\n")[0]));
  const seen = watch(page);
  const picked = await pickPlace(page, "analytics", () => seen.find((s) => s.days === 30));
  if (!picked) {
    const places = await page.evaluate(() => [...new Set([...document.querySelectorAll("[data-place]")].map((e) => e.getAttribute("data-place")))]);
    if (!places.includes("analytics")) return broken("at 390 wide the wheel Menu opens offers no Analytics place; it offers " + JSON.stringify(places));
    return broken("the wheel turned to Analytics asked no " + ROUTE_PATH + "?days=30 (asked: " + JSON.stringify(seen.map((s) => s.days)) + ")");
  }
  const got = seen.find((s) => s.days === 30);
  if (got.status !== 200) return broken("the read answered " + got.status);
  if (!(await until(() => shown(option(page, "30 days")), 10000))) return broken("the pane drew no 30 days window at its head");
  await sleep(1500);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  if (wide > 391) return broken("the page is " + wide + " px wide on a 390 px screen");
  if (errors.length) return broken("the page threw: " + errors[0]);
  return held("at 390 wide the wheel's Analytics drew the pane: days=30 answered 200, the 30 days window drawn, page " + wide + " px wide");
});
