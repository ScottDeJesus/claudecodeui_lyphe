// agents_settings.mjs — Settings → Agents on a signed-in page, with the two board-card numbers and the launch table
// answered by the page itself.
//
// Usage (cases/shell/<name>.mjs):
//   import { answerCardConfig, answerLaunchTable, openAgents, openAgentChains } from "../lib/agents_settings.mjs";
//   const page = await withPage(t);
//   const config = await answerCardConfig(page, { get: () => ({ status: 200, body: { width: 3, threshold: 0.91 } }) });
//   await openAgents(page);                       // the Settings window on its Agents tab, the two board-card rows drawn
//   config.requests                               // every /api/kanban-dispatch/settings request, { method, body }, oldest first
//
// NOTHING IS WRITTEN. `/api/kanban-dispatch/settings` is answered here, reads and writes alike, so the dispatcher's
// `charters/cards.toml` is never touched. `/api/agent-launch` (the census) is fetched from the running server, which
// only reads `charters/launch.toml`, and handed to the case to reshape; every write under `/api/agent-launch/` is
// answered here with the census the case says the table would read back, so `launch-table set` never runs.
//
// THE ROUTES ARE THE BROWSER CONTEXT'S, NOT THE PAGE'S. The app registers a service worker (src/main.tsx), and a request
// that worker answers never reaches a page-level route (measured 2026-11-19 on the dev server's modules). A page route
// that stops firing would let a write through to the live dispatcher; a context route sees the worker's own fetch too.

const WAIT_MS = 30000;
// Read off src/ and the live page 2026-11-19: the rail's Settings view, the home's Menu and its Settings entry, the
// Settings window, its Agents tab, the two rows' own data attributes and the Agent Chains window.
const RAIL_SETTINGS = 'nav[aria-label="Views"] button[aria-label="Settings"]';
const HOME_MENU = 'button[aria-label="Menu"]';
const SETTINGS_WINDOW = ".modal-backdrop";
export const WIDTH_ROW = "[data-runner-bug-board-width]";
export const THRESHOLD_ROW = "[data-runner-bug-board-threshold]";
export const THRESHOLD_FIELD = "#runner-bug-board-threshold";
const CARD_CONFIG = /\/api\/kanban-dispatch\/settings(\?|$)/;
const LAUNCH = /\/api\/agent-launch(\/|\?|$)/;
export const LAUNCH_PANEL = '[role="dialog"] [data-agent-launch-panel]';
export const CARDS_SECTION = '[data-agent-section="agent-cards"]';

const json = (status, body) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

function bodyOf(request) {
  try {
    return request.postDataJSON();
  } catch {
    return request.postData();
  }
}

/**
 * Answer `/api/kanban-dispatch/settings` from `get()` and `put(body)`, each returning `{ status, body }`. The PUT's
 * default answer is the body sent, as the dispatcher would read it back. Returns `{ requests }`, filled as they come.
 */
export async function answerCardConfig(page, { get, put = (body) => ({ status: 200, body }) }) {
  const requests = [];
  await page.context().route(CARD_CONFIG, (route) => {
    const request = route.request();
    const method = request.method();
    const body = method === "GET" ? null : bodyOf(request);
    requests.push({ method, body });
    const answer = method === "GET" ? get() : put(body);
    return route.fulfill(json(answer.status, answer.body));
  });
  return { requests };
}

/**
 * Answer the launch table: a GET is the running server's census passed through `census(real)`; a PUT under
 * `/rows/<name>` is recorded and answered with `afterWrite(name, body, census)` (default: the census unchanged).
 * Returns `{ requests }`, the writes only, each `{ method, path, body }`.
 */
export async function answerLaunchTable(page, { census, afterWrite = (_name, _body, held) => held }) {
  const requests = [];
  let held = null;
  await page.context().route(LAUNCH, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET") {
      const real = await route.fetch();
      held = census(await real.json());
      return route.fulfill(json(200, held));
    }
    const body = bodyOf(request);
    requests.push({ method: request.method(), path, body });
    const name = decodeURIComponent(path.split("/").pop());
    held = afterWrite(name, body, held);
    return route.fulfill(json(200, held));
  });
  return { requests };
}

/** Open the Settings window from the rail or the home's Menu, press its Agents tab, and wait for the two board-card rows. */
export async function openAgents(page) {
  await page.locator(`${RAIL_SETTINGS}:visible, ${HOME_MENU}:visible`).first().waitFor({ timeout: WAIT_MS });
  if ((await page.locator(`${RAIL_SETTINGS}:visible`).count()) > 0) {
    await page.locator(`${RAIL_SETTINGS}:visible`).first().click({ timeout: WAIT_MS });
  } else {
    await page.locator(`${HOME_MENU}:visible`).first().click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click({ timeout: WAIT_MS });
  }
  await page.locator(SETTINGS_WINDOW).getByRole("button", { name: "Agents", exact: true }).first().click({ timeout: WAIT_MS });
  await page.locator(WIDTH_ROW).first().waitFor({ timeout: WAIT_MS });
}

/** From the Agents tab, press Edit Agent Chains and wait until its panel is ready or says the table could not be read. */
export async function openAgentChains(page) {
  const open = page.getByRole("button", { name: "Edit Agent Chains", exact: true });
  await open.scrollIntoViewIfNeeded();
  await open.click({ timeout: WAIT_MS });
  await page.locator(`${LAUNCH_PANEL}:is([data-agent-state="ready"], [data-agent-state="unreadable"])`).first().waitFor({ timeout: WAIT_MS });
}

/** Wait until `read()` returns something truthy, or `ms` passes; resolves to the last reading. */
export async function until(read, ms = 8000) {
  const end = Date.now() + ms;
  let seen = await read();
  while (!seen && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    seen = await read();
  }
  return seen;
}
