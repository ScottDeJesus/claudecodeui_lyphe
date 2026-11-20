// The Bugs view's Dashboard face gains the bug hunters' section after the regression cases (bug-hunters, seam 11,
// scaffolded in phase 14). It holds tonight's line with its Run a night now press and, per hunter and project, the
// kit's Meter beside the three figures said in words — covered, skipped, not reached — with the unit's word (files, or
// tables for the data hunter). At 390 px every press in it is 44 px and it stacks inside the screen; only a scrolling
// table may run past the edge (INV-10275).
//
// The numbers are not this case's to judge: the section may draw its own stand-in or the dashboard route's `hunts`
// part, which this case answers with one hunter and one project in `dispatcher hunt status --json`'s shape. The board
// is lib/kanban_board.mjs's made-up board, every board request answered by the page; nothing reaches the server.
//
// protects: src/modules/kanban/dashboard/DashboardHunters.tsx, src/modules/kanban/dashboard/DashboardHunterSkips.tsx, src/modules/kanban/dashboard/DashboardHunterNights.tsx, src/modules/kanban/dashboard/BugDashboard.tsx, src/modules/i18n/locales/en/common.json
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { BOARD, CARDS, openBoard } from "../lib/kanban_board.mjs";

const WAIT_MS = 15000;
const DASHBOARD = /\/api\/kanban-dispatch\/dashboard(\?|$)/;
const AT = "2026-11-18T01:00:00.000Z";

const HUNTS = {
  nightly: false, start: "00:30", minutes: 120, order: ["security"], turns: "project",
  night: { night: "2026-11-18", state: "closed", opened_at: AT, minutes_used: 40, why: "time spent" },
  sitting: null, next: { hunt: "security", project: "/home/lyphe/.claude", rehunt: false },
  hunts: [{ hunt: "security", soul: "argus", model: "opus", runs: true, projects: [{
    project: "/home/lyphe/.claude", name: "The house", unit_word: "files", state: "hunting", pass: 1, total: 40,
    covered: 12, skipped: 3, open: 25, tickets: 2, proposals: 1, nights_left: 3, cause: null,
    last: { night: "2026-11-18", minutes: 40, outcome: "wound down", covered: 12 } }] }],
  skipped: [{ hunt: "security", project: "/home/lyphe/.claude", unit: "hooks/dispatcher/store.py", reason: "too large to open in one sitting", marked_at: AT }],
  sittings: [{ night: "2026-11-18", hunt: "security", soul: "argus", project: "/home/lyphe/.claude", minutes: 40, outcome: "wound down", cause: null, covered: 12, skipped: 3, tickets: 2, proposals: 1 }],
};

function answerFor(days) {
  const oldest = { cardId: CARDS.bug.id, boardId: BOARD.id, boardName: BOARD.name, title: CARDS.bug.title, createdAt: AT, ageDays: 1, priority: "high", status: "todo" };
  return {
    stats: {
      scope: { boardId: BOARD.id, boardName: BOARD.name, days },
      open: { total: 1, byPriority: { high: 1, medium: 0, low: 0 }, byLane: { not_ready: 0, todo: 1, questions: 0, active: 0 } },
      oldestOpenHigh: oldest, oldestOpen: [oldest],
      timeToFix: { all: null, high: null, medium: null, low: null },
      byDay: [], waysIn: [], cameBack: 0,
    },
    changelog: [],
    cases: { ok: false, error: "cases stats did not answer for this case" },
    tickets: { ok: true, value: { days, by_source: [], unplaced: [], came_back: { reopened: 0, regressions: 0 } } },
    hunts: { ok: true, value: HUNTS },
  };
}

const settle = (page) => page.waitForTimeout(500);

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  await openBoard(page);
  await page.route(DASHBOARD, (route) => {
    const days = Number(new URL(route.request().url()).searchParams.get("days")) || 30;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answerFor(days)) });
  });
  // Found by its name, never by its text: with a high card open the tab's text is "Dashboard1".
  await page.locator('[data-kanban-panel] [role="tab"][aria-label="Dashboard"]').first().click({ timeout: WAIT_MS });
  if (!(await page.locator('[data-bug-dashboard="ready"]').first().waitFor({ timeout: WAIT_MS }).then(() => true, () => false))) {
    return broken("the dashboard face never reached its ready state on the case's answer");
  }
  const run = page.locator("[data-bug-dashboard]").getByRole("button", { name: /^\s*Run a night now\s*$/ }).first();
  if (!(await run.waitFor({ timeout: WAIT_MS }).then(() => true, () => false))) return broken("the dashboard draws no Run a night now press");

  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  const read = await run.evaluate((button) => {
    const cases = document.querySelector("[data-dashboard-cases]");
    if (!cases) return { error: "the dashboard draws no regression cases section" };
    const column = cases.parentElement;
    let section = button;
    while (section && section.parentElement !== column) section = section.parentElement;
    if (!section) return { error: "the Run a night now press is not in a section of the dashboard's column" };
    const kids = [...column.children];
    const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
    const scrolls = (el) => { for (let a = el.parentElement; a && a !== section; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === "auto" || o === "scroll") return true; } return false; };
    const all = [...section.querySelectorAll("*")].filter(shown);
    const short = all.filter((el) => el.matches('button, [role="button"], [role="radio"], [role="combobox"], a[href]') && el.getBoundingClientRect().height < 43.5)
      .map((el) => `${(el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40)} (${Math.round(el.getBoundingClientRect().height)} px)`);
    const off = all.filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && !scrolls(el))
      .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || "").trim().slice(0, 30)}" ends at ${Math.round(el.getBoundingClientRect().right)}`);
    return {
      after: kids.indexOf(section) > kids.indexOf(cases),
      text: section.innerText.replace(/\s+/g, " "),
      meters: section.querySelectorAll('[role="meter"]').length,
      short, off: off.slice(0, 5),
    };
  });
  if (read.error) return broken(read.error);
  if (!read.after) return broken("the hunters section is drawn before the regression cases, not after them");
  for (const word of ["covered", "skipped", "not reached"]) {
    if (!new RegExp(`\\b${word}\\b`, "i").test(read.text)) return broken(`the hunters section never says "${word}" in words`);
  }
  if (!/\b(files|tables)\b/.test(read.text)) return broken("the hunters section says its figures with no unit's word (files or tables)");
  if (read.meters === 0) return broken("the hunters section draws no meter");
  if (read.short.length > 0) return broken(`at 390 wide these presses in the hunters section are under 44 px: ${read.short.slice(0, 6).join("; ")}`);
  if (read.off.length > 0) return broken(`at 390 wide the hunters section runs off the screen: ${read.off.join("; ")}`);
  return held(`after the regression cases; covered, skipped and not reached in words with the unit's word; ${read.meters} meter(s); every press 44 px and nothing off the screen at 390`);
});
