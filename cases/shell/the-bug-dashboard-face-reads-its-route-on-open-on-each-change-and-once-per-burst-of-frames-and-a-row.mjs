// The Bugs view's Dashboard face is filled from its one route and is told, never asks on a clock
// (bug-board-ways-in-and-dashboard, seams 9 and 11). Turned to the Dashboard face it reads
// /api/kanban-dispatch/dashboard with board=<the open board>&days=30 — once, or twice on the dev server, whose
// React.StrictMode (src/main.tsx) mounts every effect twice and so owes the face one more read — and draws the answer
// (never the could-not-be-read face); picking Last 7 days reads again with days=7, and All boards again with board=all; a burst of
// three kanban_event and two dispatcher_state frames on the app's socket is coalesced: at most two more reads (the one
// the burst's first frame started and one owed for the rest, since with no timer the face cannot know a burst is over),
// never one per frame; and with nothing arriving nothing is read. Pressing a row of the ten oldest open cards turns the
// panel to its Board face with that card's drawer open.
//
// The board is lib/kanban_board.mjs's made-up board, every board request answered by the page; the dashboard's answer
// is this case's, and the app's socket is handed on with the server's own board and dispatcher frames held back, so
// the only frames those listeners hear are the case's. Nothing reaches the board's server and nothing is written.
//
// protects: src/modules/kanban/dashboard/useBugDashboard.ts, src/modules/kanban/dashboard/BugDashboard.tsx, src/modules/kanban/dashboard/DashboardOldest.tsx, src/modules/kanban/KanbanPanel.tsx
// writes: none

import { api, withPage } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { BOARD, CARDS, openBoard } from "../lib/kanban_board.mjs";

const DASHBOARD = /\/api\/kanban-dispatch\/dashboard(\?|$)/;
const APP_SOCKET = /\/ws(\?|$)/;
const PRESENCE_FRAME = "chat.presence";
const HELD_BACK = new Set(["kanban_event", "dispatcher_state"]);
const QUIET_MS = 2500;
const WAIT_MS = 15000;
const DAY = 86400000;

const parse = (frame) => {
  try {
    return typeof frame === "string" ? JSON.parse(frame) : null;
  } catch {
    return null;
  }
};

/** One dashboard answer, every key the face reads, about the case's board: its one open card is the oldest. */
function answerFor(scope, days) {
  const today = Date.now();
  const byDay = Array.from({ length: days }, (_, i) => ({ day: new Date(today - (days - 1 - i) * DAY).toISOString().slice(0, 10), opened: i % 3, fixed: i % 2 }));
  const oldest = { cardId: CARDS.bug.id, boardId: BOARD.id, boardName: BOARD.name, title: CARDS.bug.title, createdAt: new Date(today - 6 * DAY).toISOString(), ageDays: 6, priority: "high", status: "todo" };
  return {
    stats: {
      scope: { boardId: scope === "all" ? null : BOARD.id, boardName: scope === "all" ? null : BOARD.name, days },
      open: { total: 1, byPriority: { high: 1, medium: 0, low: 0 }, byLane: { not_ready: 0, todo: 1, questions: 0, active: 0 } },
      oldestOpenHigh: oldest,
      oldestOpen: [oldest],
      timeToFix: { all: { count: 2, medianHours: 5, p90Hours: 9 }, high: null, medium: { count: 2, medianHours: 5, p90Hours: 9 }, low: null },
      byDay,
      waysIn: [{ source: "chat", opened: 1, open: 1 }],
      cameBack: 0,
    },
    changelog: [],
    cases: { ok: false, error: "cases stats did not answer for this case" },
    tickets: { ok: true, value: { days, by_source: [{ source: "chat", filed: 1, open: 1, fixed: 0, cleared: 0, closed: 0 }], unplaced: [], came_back: { reopened: 0, regressions: 0 } } },
    // The route's fifth part since bug-hunters seam 10, which the face requires as it requires the other two.
    hunts: { ok: false, error: "hunt status did not answer for this case" },
  };
}

runCase(async (t) => {
  const seed = await api("/api/dispatcher/plans");
  if (seed.status !== 200 || !seed.json || typeof seed.json !== "object") {
    return cannotRun(`the running server answered ${seed.status} for the dispatcher's picture — never a finding`);
  }
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });

  const sockets = [];
  await page.routeWebSocket(APP_SOCKET, (socket) => {
    sockets.push(socket);
    const server = socket.connectToServer();
    socket.onMessage((frame) => {
      if (parse(frame)?.type !== PRESENCE_FRAME) server.send(frame);
    });
    server.onMessage((frame) => {
      if (!HELD_BACK.has(parse(frame)?.kind)) socket.send(frame);
    });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openBoard(page);

  // Registered after openBoard's own route, so the dashboard's read is answered here and counted.
  const reads = [];
  await page.route(DASHBOARD, (route) => {
    const url = new URL(route.request().url());
    const scope = url.searchParams.get("board");
    const days = Number(url.searchParams.get("days"));
    reads.push({ scope, days });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answerFor(scope, days || 30)) });
  });
  const readsAfter = async (count) => {
    const until = Date.now() + WAIT_MS;
    while (reads.length < count && Date.now() < until) await page.waitForTimeout(100);
    await page.waitForTimeout(QUIET_MS); // a second read, had the change sent one, has had time to go
    return reads.length;
  };
  const said = () => reads.map((r) => `${r.scope}/${r.days}`).join(", ");

  if (sockets.length === 0) return cannotRun("the page opened no app socket for the case to speak on");
  const dashboardTab = page.locator('[data-kanban-panel] [role="tab"]').filter({ hasText: /^\s*Dashboard\b/ }).first();
  await dashboardTab.click({ timeout: WAIT_MS });

  const opened = await readsAfter(1);
  if (opened < 1 || opened > 2 || reads.some((r) => r.scope !== BOARD.id || r.days !== 30)) {
    return broken(`opening the Dashboard face read the route ${opened} times (${said()}), not once (twice under the dev double mount) for ${BOARD.id}/30`);
  }
  const drawn = await page.locator('[data-bug-dashboard="ready"]').first().waitFor({ timeout: WAIT_MS }).then(() => true, () => false);
  if (!drawn) {
    const state = await page.locator("[data-bug-dashboard]").first().getAttribute("data-bug-dashboard").catch(() => null);
    return broken(`the route answered and the face reads data-bug-dashboard=${state}, not ready`);
  }

  // How far back is the kit's segmented control since the board's redraw to the design system (2026-11-20).
  await page.locator('[data-bug-dashboard] [role="radio"]', { hasText: /^\s*7 days\s*$/ }).first().click({ timeout: WAIT_MS });
  if ((await readsAfter(opened + 1)) !== opened + 1 || reads[opened].scope !== BOARD.id || reads[opened].days !== 7) {
    return broken(`picking Last 7 days left the reads at ${said()}, not one more for ${BOARD.id}/7`);
  }

  await page.locator('[data-bug-dashboard] [role="radio"]', { hasText: /All boards/ }).first().click({ timeout: WAIT_MS });
  if ((await readsAfter(opened + 2)) !== opened + 2 || reads[opened + 1].scope !== "all" || reads[opened + 1].days !== 7) {
    return broken(`picking All boards left the reads at ${said()}, not one more for all/7`);
  }
  const beforeBurst = reads.length;

  const boardFrame = (n) => JSON.stringify({ kind: "kanban_event", boardId: BOARD.id, event: { id: 900000 + n, ts: new Date().toISOString(), kind: "card.updated", cardId: null, actor: "operator" }, card: null, at: Date.now() });
  const dispatcherFrame = () => JSON.stringify({ kind: "dispatcher_state", ...seed.json, at: Date.now() });
  const burst = [boardFrame(1), dispatcherFrame(), boardFrame(2), dispatcherFrame(), boardFrame(3)];
  for (const frame of burst) for (const socket of sockets) socket.send(frame);
  const afterBurst = await readsAfter(beforeBurst + 1);
  if (afterBurst < beforeBurst + 1 || afterBurst > beforeBurst + 2) {
    return broken(`a burst of five frames took the reads from ${beforeBurst} to ${afterBurst} (${said()}), not one or two more`);
  }
  if (reads.slice(beforeBurst).some((r) => r.scope !== "all" || r.days !== 7)) return broken(`the burst's reads asked ${said()}, not all/7`);

  await page.waitForTimeout(QUIET_MS * 2);
  if (reads.length !== afterBurst) return broken(`with nothing arriving the face read the route again: ${said()}`);

  const row = page.locator(`[data-dashboard-oldest] [data-dashboard-card="${CARDS.bug.id}"]`)
    .or(page.locator("[data-dashboard-oldest]").getByText(CARDS.bug.title, { exact: true })).first();
  await row.click({ timeout: WAIT_MS });
  const faceNow = () => page.locator("[data-kanban-face]").first().getAttribute("data-kanban-face", { timeout: 2000 }).catch(() => null);
  let face = await faceNow();
  for (const until = Date.now() + WAIT_MS; face !== "board" && Date.now() < until; face = await faceNow()) await page.waitForTimeout(200);
  const drawer = page.getByRole("dialog").filter({ hasText: CARDS.bug.title }).first();
  const drawerOpen = await drawer.waitFor({ timeout: WAIT_MS }).then(() => true, () => false);
  if (face !== "board" || !drawerOpen) {
    return broken(`pressing the oldest card's row left data-kanban-face=${face} and ${drawerOpen ? "its drawer open" : "no drawer naming it open"}`);
  }

  return held(`reads ${said()}: ${opened} on open, once per change, ${afterBurst - beforeBurst} for five frames, none while quiet; the oldest row opened "${CARDS.bug.title}" on the Board face`);
});
