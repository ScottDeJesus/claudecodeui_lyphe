// Cerberus → Uploads draws How often through the shared picture (src/shared/ui/HowOften.tsx, its data-how-often
// attributes), handed the Uploads words, from the runs bucketed as the Uploads view always bucketed them.
//
// The overview is this case's own answer, so the picture's counts are known: yesterday, in the browser's clock, two clean
// runs and a hiccup at 9, a test run at 11 and a run still going at 13. The feed is answered quiet. Nothing reaches the
// engine and nothing is written.
//
// protects: src/shared/ui/HowOften.tsx, src/shared/ui/index.ts, src/shared/dayBuckets.ts, src/modules/upload-runs/UploadsBody.tsx, src/modules/upload-runs/hooks/useUploadsRead.ts, src/modules/i18n/locales/en/common.json
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";

const DESKTOP = { width: 1440, height: 900 };
const WAIT_MS = 30000;
// Read off src/ 2026-11-18: the rail (console.mjs's RAIL), the tab strip's Uploads tab, the routes the view reads.
const CERBERUS = 'nav[aria-label="Views"] button[aria-label="Cerberus"]';
// The sessions home draws no rail: its Menu button opens a menu whose Cerberus entry opens the tab (read off the live page
// 2026-11-18). Every other page keeps the rail docked from 768.
const HOME_MENU = 'button[aria-label="Menu"]';
const MENU_ENTRY = ':is([role="menu"], [role="dialog"]) :is(button, [role="menuitem"])';
const OVERVIEW = "**/api/upload-runs/overview*";
const FEED = "**/api/upload-runs/feed*";
const PICTURE = "[data-how-often]";
const DAY = "[data-how-often-day]";
const HOUR = "[data-how-often-hour]";
const OLD_PICTURE = "[data-uploads-often]"; // the attribute the picture carried before the lift, named in a broken line only

/** One run as the overview carries it; `part` picks the fields the bucketing reads. */
function run(id, at, part) {
  return {
    session_id: `case-${id}`, account_id: part === "test" ? null : "case-account", dry_run: part === "test", imported: false,
    job_id: part === "test" ? null : `case-job-${id}`, upload_type: "initial", archetype: null, customer_name: "Case Customer",
    project_number: null, job_label: null, generated_by: "eis:case", invocation_id: null, claude_session_id: null, model: null,
    started_at: at, ended_at: part === "live" ? null : at, state: part === "live" ? "running" : "ended", ending: null,
    stop_reason: null, stopped_by: null, terminal_reason: null, rc: null, stderr_head: null,
    counts: { turns: 1, tool_calls: 1, asked: 0, answers: 0, quiet: 0, rate_limited: 0, stream_errors: 0, events: 1, events_dropped: 0 },
    walks: { total: 0, armed: 0, bumpy: 0, halted: 0 },
    verdict: part === "test" ? "clean" : part, tone: part === "hiccup" ? "warn" : part === "live" ? "info" : "positive",
    reasons: part === "hiccup" ? [{ code: "went_quiet", tone: "warn", count: 1 }] : [],
  };
}

function overviewFor(url, runs) {
  const days = Number(new URL(url).searchParams.get("days") ?? 30);
  const now = new Date();
  const type = (upload_type) => ({ upload_type, clean: 0, hiccups: 0, live: 0, trend: null, last_at: null });
  return {
    generated_at: now.toISOString(),
    window: { days, from: new Date(now.getTime() - days * 86400000).toISOString(), to: now.toISOString() },
    filters: { by: null, tests: 0, account: null }, live: null, types: [type("initial"), type("final")],
    runs, truncated: false, people: [], accounts: [],
  };
}

const titleCount = (title) => Number(/(\d+) press/.exec(title ?? "")?.[1] ?? NaN);

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
  // Yesterday in the BROWSER's clock, the clock the picture buckets by.
  const y = await page.evaluate(() => {
    const now = new Date();
    const at = (h, m) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, h, m).toISOString();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { day, runs: [["c1", at(9, 0), "clean"], ["c2", at(9, 10), "clean"], ["h1", at(9, 30), "hiccup"], ["t1", at(11, 0), "test"], ["l1", at(13, 0), "live"]] };
  });
  const runs = y.runs.map(([id, at, part]) => run(id, at, part)).reverse(); // newest first, as the wire carries them
  await page.route(OVERVIEW, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(overviewFor(route.request().url(), runs)) }));
  await page.route(FEED, (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: "retry: 600000\n\n" }));

  await openUploads(page);
  try {
    await page.locator(PICTURE).first().waitFor({ state: "visible", timeout: WAIT_MS });
  } catch (error) {
    if (error.name !== "TimeoutError") throw error;
    const old = await page.locator(OLD_PICTURE).count();
    return broken(`Uploads drew no ${PICTURE} in ${WAIT_MS / 1000} s${old > 0 ? ` (the picture stands under its old ${OLD_PICTURE})` : ""}`);
  }

  const wrong = [];
  const picture = page.locator(PICTURE).first();
  const days = await picture.locator(DAY).evaluateAll((els) => els.map((el) => ({ day: el.getAttribute("data-how-often-day"), today: el.hasAttribute("data-today"), title: el.getAttribute("title") })));
  if (days.length !== 31) wrong.push(`${days.length} day columns for the 30-day window, not the 31 dates it touches`);
  const todays = days.filter((d) => d.today);
  if (todays.length !== 1 || !days.at(-1)?.today) wrong.push(`today is marked on ${todays.length} columns and the last is ${days.at(-1)?.today ? "" : "not "}today`);
  const yesterday = days.find((d) => d.day === y.day);
  if (!/: 2 clean, 1 hiccup, 1 test$/.test(yesterday?.title ?? "")) wrong.push(`yesterday's column reads "${yesterday?.title ?? "missing"}", not 2 clean, 1 hiccup, 1 test`);

  const hours = await picture.locator(HOUR).evaluateAll((els) => els.map((el) => ({ hour: Number(el.getAttribute("data-how-often-hour")), title: el.getAttribute("title") })));
  if (hours.length !== 24) wrong.push(`${hours.length} hour cells, not 24`);
  const at = (h) => titleCount(hours.find((c) => c.hour === h)?.title);
  if (at(9) !== 3 || at(11) !== 0 || at(13) !== 1) wrong.push(`the hours read 9→${at(9)}, 11→${at(11)}, 13→${at(13)}, not 3, 0 (the test) and 1 (the run still going)`);

  const captions = await picture.locator("figcaption").allInnerTexts();
  const words = (await picture.innerText()).replace(/\s+/g, " ");
  if (/\bcerberus\.[a-z]/i.test(words)) wrong.push(`the picture shows an i18n key: "${words.slice(0, 200)}"`);
  if (!/with 3 runs\./.test(captions[0] ?? "")) wrong.push(`the day sentence reads "${captions[0] ?? ""}", not the busiest day with 3 runs`);
  if (!/with 3 presses\./.test(captions[1] ?? "")) wrong.push(`the hour sentence reads "${captions[1] ?? ""}", not the busiest hour with 3 presses`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`How often drew through ${PICTURE}: 31 dates, today last, yesterday 2 clean 1 hiccup 1 test, hours 9→3 11→0 13→1, "${captions[0]}" / "${captions[1]}"`);
});
