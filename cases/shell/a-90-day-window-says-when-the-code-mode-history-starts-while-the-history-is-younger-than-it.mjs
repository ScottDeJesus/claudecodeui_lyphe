// protects: src/modules/analytics/sections/code-mode/CodeModeSection.tsx, src/modules/analytics/sections/code-mode/codeModeFigures.ts, /home/lyphe/.claude/hooks/plan_runner/code_mode/history.py, /home/lyphe/.claude/hooks/plan_runner/code_mode/analytics.py
// writes: none
// The history-start line on a 90-day window, judged against the answer the page itself got: drawn while the
// history is younger than the window, absent once it covers it, and No history yet while there is none.
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

function dataOf(json) {
  const envelope = json && json.data && typeof json.data === "object" && "section" in json.data ? json.data : json;
  return envelope && typeof envelope === "object" ? envelope.data : undefined;
}

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  const seen = watch(page);
  if (!(await openFromRail(page))) return broken("at 1440 wide neither a rail button (data-view-id=analytics) nor the wheel Menu opens offers Analytics");
  if (!(await until(() => seen.find((s) => s.days === 30), 20000))) return broken("opening Analytics asked no days=30 read");
  const from = seen.length;
  const choice = option(page, "90 days");
  if (!(await until(() => shown(choice), 5000))) return broken("the head draws no 90 days window");
  await choice.click();
  const got = await until(() => seen.slice(from).find((s) => s.days === 90), 20000);
  if (!got) return broken("pressing 90 days asked no days=90 read");
  if (got.status !== 200) return broken("the days=90 read answered " + got.status);
  const data = dataOf(await got.res.json().catch(() => null));
  if (!data || typeof data.today !== "string") return broken("the days=90 answer carries no today");
  await sleep(2000);
  const lines = await page.getByText(/The history starts on/).count();
  if (data.first_day === null) {
    const none = await page.getByText("No history yet").count();
    return none > 0 && lines === 0 ? held("no history: No history yet drawn, no start line") : broken("no history, yet No history yet " + none + ", start lines " + lines);
  }
  const span = Math.round((Date.parse(data.today + "T00:00:00Z") - Date.parse(data.first_day + "T00:00:00Z")) / 86400000) + 1;
  if (span === 90) return cannotRun("the history covers exactly the 90-day window today (" + data.first_day + " to " + data.today + "); the edge is not asked");
  if (span < 90) return lines > 0 ? held("history " + span + " days old (from " + data.first_day + "): the 90-day window says when it starts") : broken("history " + span + " days old (from " + data.first_day + ") on a 90-day window, and no \"The history starts on\" line is drawn");
  return lines === 0 ? held("history " + span + " days old covers the window: no start line") : broken("history " + span + " days old covers the 90-day window, yet the start line is drawn");
});
