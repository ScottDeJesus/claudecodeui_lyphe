// bug_hunt_faces.mjs — the Bugs view's Proposed features face and the Dashboard's hunters section, filled from routes a
// case answers, on lib/kanban_board.mjs's made-up board, with the app's socket in the case's hands.
//
// Usage (cases/shell/<name>.mjs):
//   const page = await withPage(t, { viewport });
//   const bus = await holdBus(page);                    // reload with the server's board and dispatcher frames held back
//   const watched = watch(page, PROPOSALS);             // every request to a route, its method, query and body, oldest first
//   await openBoard(page);
//   const answers = answer(page, PROPOSALS, (request) => json({ proposals: [...] }));   // registered after openBoard's
//   bus.dispatcherFrame();                              // one dispatcher_state frame, as the dispatcher sends on a write
//
// THE SOCKET IS HANDED ON WHOLE but for the page's presence report and the server's own `kanban_event` and
// `dispatcher_state` frames, so the only frames those listeners hear are the case's. Every board request is
// lib/kanban_board.mjs's; the routes a case answers here are answered by it alone. Nothing reaches the board's server
// and nothing is written.
//
// THE STAND-IN'S WORDS: the made-up rows the phase-14 screens drew before they were wired to their routes. A face
// wired to its route draws none of them over the case's answer.

import { api } from "./app.mjs";
import { CannotRun } from "./case.mjs";
import { BOARD } from "./kanban_board.mjs";

export const PROPOSALS = /\/api\/kanban-dispatch\/proposals(\?|$)/;
export const PROPOSAL_ACT = /\/api\/kanban-dispatch\/proposals\/[^/?]+\/(promote|send-back|dismiss|priority)(\?|$)/;
export const ROADMAP = /\/api\/roadmap\/?(\?|$)/;
export const DASHBOARD = /\/api\/kanban-dispatch\/dashboard(\?|$)/;
export const HUNT_ACT = /\/api\/kanban-dispatch\/hunts\/(night|stop|reopen)(\?|$)/;
export const AT = "2026-11-18T12:00:00.000Z";
export const WAIT_MS = 15000;
export const QUIET_MS = 2500;

export const STAND_IN_WORDS = [
  "Every board route trusts the caller",
  "The photo grid asks for full-size images",
  "Settings saves each field on its own",
  "Who can reach a board",
  "Long chats open at once",
  "git did not answer in 60 seconds in /opt/eis-app",
];

const APP_SOCKET = /\/ws(\?|$)/;
const PRESENCE_FRAME = "chat.presence";
const HELD_BACK = new Set(["kanban_event", "dispatcher_state"]);

const parse = (frame) => {
  try {
    return typeof frame === "string" ? JSON.parse(frame) : null;
  } catch {
    return null;
  }
};

export const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

/** One proposal of `bug proposals --json`'s shape on the case's board, as the route hands it on with `boardName`. */
export function proposal(id, title, extra = {}) {
  return {
    id, path: BOARD.repos[0], title, words: `${title}: the words the hunter wrote.`, kind: "too-big", priority: "medium",
    state: "open", hunt: "code", source: "hunter", proposed_at: AT, ended_at: null, feature: null, reason: null,
    findings: [{ unit: "hooks/dispatcher/case_unit.py", words: "The case's one finding.", found_at: AT }],
    stopgaps: [], sent_back: null, boardName: BOARD.name, ...extra,
  };
}

/** Reload with the app's socket routed: the server's board and dispatcher frames held back, the case's sent. */
export async function holdBus(page) {
  const seed = await api("/api/dispatcher/plans");
  if (seed.status !== 200 || !seed.json || typeof seed.json !== "object") {
    throw new CannotRun(`the running server answered ${seed.status} for the dispatcher's picture — never a finding`);
  }
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
  return {
    sockets,
    dispatcherFrame() {
      if (sockets.length === 0) throw new CannotRun("the page opened no app socket for the case to speak on");
      const frame = JSON.stringify({ kind: "dispatcher_state", ...seed.json, at: Date.now() });
      for (const socket of sockets) socket.send(frame);
    },
  };
}

/** Every request the page makes to `pattern`, routed or not: `{ method, query, body }`, oldest first. */
export function watch(page, pattern) {
  const seen = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!pattern.test(url.pathname + url.search)) return;
    let body = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = request.postData();
    }
    seen.push({ method: request.method(), path: url.pathname, query: Object.fromEntries(url.searchParams), body });
  });
  return seen;
}

/** Answer `pattern` with `respond(request)` (a fulfil's options), awaited, so a case can hold an answer back. */
export async function answer(page, pattern, respond) {
  await page.route(pattern, async (route) => route.fulfill(await respond(route.request())));
}

/** Wait until `test()` is true or the wait runs out; true when it came true. */
export async function until(page, test, ms = WAIT_MS) {
  for (const end = Date.now() + ms; Date.now() < end; await page.waitForTimeout(100)) if (await test()) return true;
  return Boolean(await test());
}

/** The Bugs view's tab by its name (the kit's Tabs gives each its label as `aria-label`). */
export const tab = (page, name) => page.locator(`[data-kanban-panel] [role="tab"][aria-label="${name}"]`).first();

/** The stand-in's words a locator's text holds. */
export async function standInIn(locator) {
  const text = (await locator.textContent({ timeout: 2000 }).catch(() => "")) ?? "";
  return STAND_IN_WORDS.filter((words) => text.includes(words));
}
