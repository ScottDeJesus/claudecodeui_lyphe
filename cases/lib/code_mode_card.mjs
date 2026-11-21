// code_mode_card.mjs — Settings → Agents' Code Mode card (RunnerCodeModeRow), answered and found on the page.
//
// Usage (cases/shell/<name>.mjs):
//   import { answerCodeMode, codeModeCard, SAYS, waitForCodeMode } from "../lib/code_mode_card.mjs";
//   const page = await withPage(t);
//   const wire = await answerCodeMode(page);       // before openAgents: the card's route answered here, writes recorded
//   await openAgents(page);                        // lib/agents_settings.mjs
//   await waitForCodeMode(page);                   // true once a [data-runner-code-mode] handle is drawn
//   const card = await codeModeCard(page);         // { found, … } — see codeModeCard
//   wire.requests                                  // every /api/settings/code-mode request, { method, body }, oldest first
//
// NOTHING IS WRITTEN. `/api/settings/code-mode` (interface H: `code-mode --status` and `code-mode set … --by app:card`)
// is answered here, a GET with one `builders` kind, ready, off, and a PUT with that kind moved as asked, so no flag
// under ~/.claude/state/code_mode/ is ever touched. While the card draws a fixed reading (the scaffold, before its
// fill wires `useCodeMode`) the route is never asked; once it reads the server, it reads this answer. Either way the
// card draws the same one kind. The route is the browser context's, not the page's, for the reason
// lib/agents_settings.mjs gives (the service worker's fetch).
//
// WHERE THE CARD IS, by the two handles the intent names and no other: the main-session Dactyls row
// (`[data-runner-main-session-dactyls]`) and each kind's `[data-runner-code-mode]`. The card is the child of the
// Agents panel's row list (the `divide-y` wrapper that holds the Dactyls row) standing directly after the Dactyls row.

const WAIT_MS = 30000;
const SETTINGS_WINDOW = ".modal-backdrop";
const ROUTE = /\/api\/settings\/code-mode(\?|$)/;
export const DACTYLS_ROW = "[data-runner-main-session-dactyls]";
export const KIND_HANDLE = "[data-runner-code-mode]";

// `KINDS["builders"]["says"]` in hooks/plan_runner/code_mode/switch.py, interface H's sentence word for word.
export const SAYS =
  "A builder or fix-pass on Claude works with two tools: one search, and one script that does the whole job with the soul's own tools inside it. Each action of a script is put to the house's hooks first, as a tool call would be. A soul with tools of its own (a browser, the connector) is not served yet. Dactyls are off for a launch Code Mode carries. Takes effect on the next launch.";

const json = (status, body) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Answer the card's route; returns `{ requests }`. `enabled` is the builders kind's position the GET answers. */
export async function answerCodeMode(page, { enabled = false } = {}) {
  const requests = [];
  let position = enabled;
  const status = () => ({
    ready: true,
    why: "",
    kinds: [{ kind: "builders", label: "Builders", says: SAYS, enabled: position, report: "" }],
  });
  await page.context().route(ROUTE, (route) => {
    const request = route.request();
    const method = request.method();
    let body = null;
    if (method !== "GET") {
      try { body = request.postDataJSON(); } catch { body = request.postData(); }
      if (body && body.kind === "builders" && typeof body.enabled === "boolean") position = body.enabled;
    }
    requests.push({ method, body });
    return route.fulfill(json(200, status()));
  });
  return { requests };
}

/** Wait until a kind's handle is drawn; resolves true when it is, false after WAIT_MS / 2. */
export async function waitForCodeMode(page) {
  try {
    await page.locator(`${SETTINGS_WINDOW} ${KIND_HANDLE}`).first().waitFor({ timeout: WAIT_MS / 2 });
    return true;
  } catch {
    return false;
  }
}

/**
 * The card as the page draws it now: `{ found, why?, afterDactyls, handles: [<value>], kinds: [{ handle, text, switches:
 * [{ checked, name }], says: { whole, rect } | null }], text, rect, outside: [<what reaches past the screen>],
 * controls: [{ tag, cls, role, name }], viewport }`. `found` is false (with `why`) when there is no Dactyls row or no
 * row list.
 */
export async function codeModeCard(page, says = SAYS) {
  return page.evaluate(({ win, dactyls, handle, says }) => {
    const root = document.querySelector(win) ?? document.body;
    const row = root.querySelector(dactyls);
    if (!row) return { found: false, why: "no main-session Dactyls row is drawn" };
    let child = row;
    while (child.parentElement && !child.parentElement.className.split(/\s+/).includes("divide-y")) child = child.parentElement;
    const list = child.parentElement;
    if (!list) return { found: false, why: "the Dactyls row stands in no divide-y row list" };
    const card = child.nextElementSibling;
    const all = [...root.querySelectorAll(handle)];
    const flat = (el) => (el?.innerText ?? el?.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!card) return { found: true, afterDactyls: false, handles: all.map((e) => e.getAttribute("data-runner-code-mode")), kinds: [], text: "", outside: [], controls: [] };
    const width = document.documentElement.clientWidth;
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), right: Math.round(r.right) }; };
    const kinds = [...card.querySelectorAll(handle)].map((el) => {
      const leaf = [...el.querySelectorAll("p, span, div")].find((n) => flat(n) === says);
      return {
        handle: el.getAttribute("data-runner-code-mode"),
        text: flat(el),
        switches: [...el.querySelectorAll('[role="switch"]')].map((s) => ({ checked: s.getAttribute("aria-checked"), name: s.getAttribute("aria-label") ?? flat(s) })),
        says: leaf ? { whole: leaf.scrollWidth <= leaf.clientWidth + 1, rect: rect(leaf) } : null,
      };
    });
    const outside = [...card.querySelectorAll("*")]
      .filter((el) => el.getClientRects().length > 0)
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -0.5 || r.right > width + 0.5); })
      .slice(0, 6)
      .map((el) => `${el.tagName.toLowerCase()} "${flat(el).slice(0, 30)}" ${Math.round(el.getBoundingClientRect().left)}..${Math.round(el.getBoundingClientRect().right)}`);
    const controls = [...card.querySelectorAll('button, input, select, textarea, a[href], [role="switch"], [role="button"]')]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => ({ tag: el.tagName.toLowerCase(), cls: el.className, role: el.getAttribute("role") ?? "", name: el.getAttribute("aria-label") ?? flat(el).slice(0, 30) }));
    return {
      found: true,
      afterDactyls: all.length > 0 && all.every((el) => card.contains(el)),
      handles: all.map((e) => e.getAttribute("data-runner-code-mode")),
      kinds,
      text: flat(card),
      rect: rect(card),
      outside,
      controls,
      viewport: width,
    };
  }, { win: SETTINGS_WINDOW, dactyls: DACTYLS_ROW, handle: KIND_HANDLE, says });
}
