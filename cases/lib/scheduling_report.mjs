// scheduling_report.mjs — what the Scheduling view's shell cases share: the way to the view, and the lane's answers made
// here (an overview, an entry whole) so a case never leans on the record's own rows, which age out of every window.
//
// Usage (cases/shell/<name>.mjs):
//   import { openCerberus, openScheduling, person, overviewFor, wholeOf, OVERVIEW, ENTRY, FEED } from "../lib/scheduling_report.mjs";
//   await page.route(OVERVIEW, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(overviewFor(route.request().url(), [person(1)])) }));
//   await openScheduling(page);
//
// The shapes are src/shared/scheduling-report-types.ts's, snake_case as the wire carries them. Ids are lowercase uuids,
// as the lane's allowlist demands of an entry id.

const WAIT_MS = 30000;
// Read off src/ and the live page 2026-11-18: the rail, the home's Menu and its Cerberus entry.
const CERBERUS = 'nav[aria-label="Views"] button[aria-label="Cerberus"]';
const HOME_MENU = 'button[aria-label="Menu"]';
const MENU_ENTRY = ':is([role="menu"], [role="dialog"]) :is(button, [role="menuitem"])';

/** The lane's three routes as the page asks them (src/shared/api.ts, api.schedulingReport). */
export const OVERVIEW = "**/api/scheduling-report/overview*";
export const ENTRY = "**/api/scheduling-report/entries/*";
export const FEED = "**/api/scheduling-report/feed*";

/** Whether a request's URL is one of this lane's: what a case counts as the view asking anything at all. */
export const isLaneRequest = (url) => new URL(url).pathname.startsWith("/api/scheduling-report/");

const ACCOUNT = "c0ffee00-0000-4000-8000-00000000ca5e";

/** Cerberus from the rail, or from the home's Menu where the home stands. */
export async function openCerberus(page) {
  await page.locator(`${CERBERUS}:visible, ${HOME_MENU}:visible`).first().waitFor({ timeout: WAIT_MS });
  if ((await page.locator(`${CERBERUS}:visible`).count()) > 0) {
    await page.locator(`${CERBERUS}:visible`).first().click({ timeout: WAIT_MS });
  } else {
    await page.locator(`${HOME_MENU}:visible`).first().click();
    await page.locator(MENU_ENTRY, { hasText: /^\s*Cerberus\s*$/ }).first().click({ timeout: WAIT_MS });
  }
  await page.getByRole("tab", { name: "Uploads", exact: true }).waitFor({ timeout: WAIT_MS });
}

/** The Scheduling tab of the strip, or null when the strip holds none (the view is not wired in). */
export async function schedulingTab(page) {
  const tab = page.getByRole("tab", { name: "Scheduling", exact: true });
  return (await tab.count()) > 0 ? tab : null;
}

/** Cerberus, then its Scheduling tab. Answers false when the strip has no Scheduling tab. */
export async function openScheduling(page) {
  await openCerberus(page);
  const tab = await schedulingTab(page);
  if (tab === null) return false;
  await tab.click({ timeout: WAIT_MS });
  return true;
}

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/**
 * One PERSON's direct entry (a booking through the API), `n` minutes old, clean or a hiccup. A hiccup carries one warn
 * reason, as the verdict's vocabulary words it.
 */
export function person(n, { verdict = "clean", actor = "eis:case-person", minutesAgo = 10 * n } = {}) {
  const started = new Date(Date.now() - minutesAgo * 60000).toISOString();
  const hiccup = verdict === "hiccup";
  return {
    id: uuid(n), form: false, state: "direct", account_id: ACCOUNT, actor, actor_kind: "person",
    kind: "book", result: hiccup ? "nothing" : "booked", opener: null, surface: "api",
    job: { id: uuid(9000 + n), customer_name: `Case Customer ${n}`, project_number: `CASE-${n}`, loss_type: "Water" },
    visit_id: hiccup ? null : uuid(8000 + n), started_at: started, ended_at: started, open_seconds: null,
    presses: { total: 1, ok: hiccup ? 0 : 1, refused: hiccup ? 1 : 0, failed: 0 }, lead: null,
    verdict, tone: hiccup ? "warn" : "positive",
    reasons: hiccup ? [{ code: "request_refused", tone: "warn", count: 1, detail: "validation" }] : [],
  };
}

/** The overview the lane would answer for the asked URL's window and filters, holding `entries` (newest first). */
export function overviewFor(url, entries) {
  const ask = new URL(url).searchParams;
  const days = Number(ask.get("days") ?? 30);
  const now = new Date();
  const kind = (k) => ({
    kind: k,
    clean: entries.filter((e) => e.actor_kind === "person" && e.kind === k && e.verdict === "clean").length,
    hiccups: entries.filter((e) => e.actor_kind === "person" && e.kind === k && e.verdict === "hiccup").length,
    trend: null, last_at: entries.find((e) => e.kind === k)?.started_at ?? null,
  });
  const people = [...new Set(entries.map((e) => e.actor))].map((actor) => ({ actor, entries: entries.filter((e) => e.actor === actor).length }));
  return {
    generated_at: now.toISOString(),
    window: { days, from: new Date(now.getTime() - days * 86400000).toISOString(), to: now.toISOString() },
    filters: { by: ask.get("by"), machines: ask.get("machines") === "1", account: ask.get("account") },
    kinds: [kind("book"), kind("change"), kind("cancel")],
    entries, truncated: false, openers: [], people, accounts: [ACCOUNT],
  };
}

/** The entry whole the lane would answer for a direct entry: its one press, no form report, no visit to read. */
export function wholeOf(entry) {
  const ok = entry.verdict === "clean";
  return {
    entry,
    session: null,
    acts: [{
      id: entry.id, at: entry.started_at, kind: "create", surface: "api", session_id: null, actor: entry.actor, actor_kind: entry.actor_kind,
      status: ok ? 201 : 422, outcome: ok ? "ok" : "invalid", code: ok ? null : "validation", calendar: "none", calendar_reason: null,
      crew_downgraded: false, start_at: null, end_at: null, visit_type: null, lead: null, support: [], touched: [], latency_ms: 40,
    }],
    visit_now: null,
    after: [],
  };
}

/** A JSON answer for route.fulfill. */
export const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
