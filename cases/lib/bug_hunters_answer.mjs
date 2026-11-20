// bug_hunters_answer.mjs — the bug hunters' settings route answered by the page, for the cases whose promise is what
// Settings → Agents' bug hunters rows READ and WRITE (useBugHunters, bug-hunters phase 17).
//
// Usage (cases/shell/<name>.mjs):
//   import { answerHunts, shippedConfig, huntersDrawn, typeAndLeave } from "../lib/bug_hunters_answer.mjs";
//   const page = await withPage(t);
//   const hunts = await answerHunts(page, { get: () => ({ status: 200, body: shippedConfig() }) });   // before openAgents
//   await openAgents(page);                                                                           // lib/agents_settings.mjs
//   hunts.requests      // every /api/kanban-dispatch/hunts/... request, { method, path, body }, oldest first
//   hunts.writes()      // the same, without the reads
//
// NOTHING IS WRITTEN. Every request under /api/kanban-dispatch/hunts/ is answered here, reads and writes alike:
// `get(n)` answers the n-th read (0 first) and `put(body, held)` answers a PUT of /settings (default: the body applied to
// the config last answered, as `dispatcher hunt config` would read it back, and a 200). Any other write (night, stop,
// reopen) is answered 409 and recorded. So charters/hunts.toml, the crontab line and a night are never touched. The
// route is the browser CONTEXT's, for the service-worker reason lib/agents_settings.mjs gives.
//
// WHERE THE ROWS ARE: each row is `[data-runner-bug-hunters="<field>"]` (RunnerBugHuntersSetting's HunterSetting), its
// refusal `[data-runner-bug-hunters-refusal]`, the typed fields `#runner-bug-hunters-{start,minutes,tickets}`, each list
// item `[data-bug-hunters-item="<kind or project name>"]` (a hunter that sits out also `[data-bug-hunters-out]`), and the
// unreadable state `[data-runner-bug-hunters="unknown"]` — all read off the composition Iris left, 2026-11-20.

const HUNTS = /\/api\/kanban-dispatch\/hunts(\/|\?|$)/;
const SETTINGS_PATH = "/api/kanban-dispatch/hunts/settings";
export const ROW = (field) => `.modal-backdrop [data-runner-bug-hunters="${field}"]`;
export const KINDS = ["security", "behaviour", "ui", "data", "code"];

const json = (status, body) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

function bodyOf(request) {
  try {
    return request.postDataJSON();
  } catch {
    return request.postData();
  }
}

/** `dispatcher hunt config --json` as the live file answered it 2026-11-20 (the file as it ships), with `over` laid on top. */
export function shippedConfig(over = {}) {
  const project = (name, path) => ({ name, path, exclude: [], databases: [] });
  return {
    nightly: false, start: "00:30", minutes: 120, grace: 15, min_left: 20, tickets_per_night: 15, batch: 12,
    order: [...KINDS], turns: "project", exclude: [], lenses: {},
    projects: [
      project("Restorly connector", "/opt/shadow-connector"),
      project("Restorly app", "/opt/eis-app"),
      project("CloudCLI", "/home/lyphe/.claude/claudecodeui_lyphe"),
      project("The house", "/home/lyphe/.claude"),
    ],
    path: "/home/lyphe/.claude/charters/hunts.toml", crontab: null,
    ...over,
  };
}

/** A PUT body applied to a config, as the dispatcher's one writer would read the file back after it. */
export function applyPut(config, body) {
  const next = { ...config };
  if (body.nightly !== undefined) next.nightly = body.nightly;
  if (body.start !== undefined) next.start = body.start;
  if (body.minutes !== undefined) next.minutes = body.minutes;
  if (body.ticketsPerNight !== undefined) next.tickets_per_night = body.ticketsPerNight;
  if (body.turns !== undefined) next.turns = body.turns;
  if (body.order !== undefined) next.order = [...body.order];
  if (body.projects !== undefined) {
    next.projects = body.projects.map((name) => config.projects.find((p) => p.name === name)).filter(Boolean);
  }
  return next;
}

/** Answer every /api/kanban-dispatch/hunts/ request here. Returns `{ requests, writes() }`, filled as they come. */
export async function answerHunts(page, { get, put = (body, held) => ({ status: 200, body: applyPut(held, body) }) }) {
  const requests = [];
  let reads = 0;
  let held = null;
  await page.context().route(HUNTS, (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    const body = method === "GET" ? null : bodyOf(request);
    requests.push({ method, path, body });
    if (method === "GET" && path === SETTINGS_PATH) {
      const answer = get(reads++);
      if (answer.status === 200) held = answer.body;
      return route.fulfill(json(answer.status, answer.body));
    }
    if (method === "PUT" && path === SETTINGS_PATH && body && typeof body === "object") {
      const answer = put(body, held ?? shippedConfig());
      if (answer.status === 200) held = answer.body;
      return route.fulfill(json(answer.status, answer.body));
    }
    return route.fulfill(json(409, { error: "CASE: this write is refused here" }));
  });
  return { requests, writes: () => requests.filter((r) => r.method !== "GET") };
}

/** The hunters as drawn now, in document order: `[{ key, out }]`; and the projects' keys likewise. */
export async function huntersDrawn(page) {
  const read = (field) => page.locator(`${ROW(field)} [data-bug-hunters-item]`).evaluateAll((all) =>
    all.filter((el) => el.getClientRects().length > 0).map((el) => ({ key: el.getAttribute("data-bug-hunters-item"), out: el.hasAttribute("data-bug-hunters-out") })));
  return { hunters: await read("hunters"), projects: (await read("projects")).map((p) => p.key) };
}

/**
 * Put `text` in a typed field, then leave it. Left by blur, not Tab: in Chromium a Tab inside `<input type="time">` moves to
 * the time's next segment and never leaves the field (measured 2026-11-20 on the start time).
 */
export async function typeAndLeave(page, id, text) {
  const field = page.locator(`.modal-backdrop #${id}`).first();
  await field.scrollIntoViewIfNeeded();
  await field.click();
  await field.fill(text);
  await field.evaluate((el) => el.blur());
}

/** The refusal line each row draws now: `{ <field>: words }` for every row that shows one. */
export async function refusalsDrawn(page) {
  return page.locator(".modal-backdrop [data-runner-bug-hunters]").evaluateAll((rows) => Object.fromEntries(
    rows.map((row) => [row.getAttribute("data-runner-bug-hunters"), row.querySelector("[data-runner-bug-hunters-refusal]")?.textContent?.replace(/\s+/g, " ").trim()])
      .filter(([, words]) => words)));
}
