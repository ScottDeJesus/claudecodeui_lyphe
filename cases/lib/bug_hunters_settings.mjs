// bug_hunters_settings.mjs — Settings → Agents' bug hunters rows (RunnerBugHuntersRow), found and measured on the page.
//
// Usage (cases/shell/<name>.mjs):
//   import { guardHunts, huntersRegion, pressHeights, NIGHTLY_LABEL } from "../lib/bug_hunters_settings.mjs";
//   const page = await withPage(t);
//   const guard = await guardHunts(page);        // before openAgents: every hunts write is refused here and recorded
//   await openAgents(page);                      // lib/agents_settings.mjs
//   const region = await huntersRegion(page);    // null when no switch named NIGHTLY_LABEL is drawn
//   guard.writes                                 // [{ method, path, body }]: what the page tried to write
//
// NOTHING IS WRITTEN. `/api/kanban-dispatch/hunts/...` is the dispatcher's `hunt config` and `hunt night|stop|reopen`:
// a GET (a read of charters/hunts.toml) goes on to the running server, and every other method is answered 409 here
// and recorded, so the live hunts file, the crontab line and a night are never touched. The route is the browser
// context's, not the page's, for the reason lib/agents_settings.mjs gives (the service worker's fetch).
//
// WHERE THE ROWS ARE, without a data attribute the intent never named: the switch whose accessible name is
// NIGHTLY_LABEL, the `Input type="time"`, the Select whose name says "take turns", and the kit's sortable items
// (`[data-sortable-item]`, which `useSortable`'s itemProps puts on every item). The region is every control of the
// Settings window from the first of those to the last, in document order.

const WAIT_MS = 30000;
const SETTINGS_WINDOW = ".modal-backdrop";
const HUNTS = /\/api\/kanban-dispatch\/hunts(\/|\?|$)/;
export const NIGHTLY_LABEL = "Run the bug hunters nightly";
export const TURNS_LABEL = "How the hunters take turns";
export const KINDS = ["security", "behaviour", "ui", "data", "code"];
// The four [[project]] names charters/hunts.toml ships (bug-hunters seam 1), read off the file 2026-11-20.
export const PROJECTS = ["Restorly connector", "Restorly app", "CloudCLI", "The house"];

export async function guardHunts(page) {
  const writes = [];
  await page.context().route(HUNTS, (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.continue();
    let body = null;
    try { body = request.postDataJSON(); } catch { body = request.postData(); }
    writes.push({ method: request.method(), path: new URL(request.url()).pathname, body });
    return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "CASE: writes are refused here" }) });
  });
  return { writes };
}

/** Wait until the nightly switch is drawn; resolves true when it is, false after WAIT_MS / 3. */
export async function waitForNightly(page) {
  try {
    await page.locator(SETTINGS_WINDOW).getByRole("switch", { name: NIGHTLY_LABEL }).first().waitFor({ timeout: WAIT_MS / 3 });
    return true;
  } catch {
    return false;
  }
}

/**
 * The hunters region as the page draws it now: `{ found, afterBugBoard, controls: [{ i, tag, type, role, name, row, min, max,
 * value, rect }], hunters: [{ text, switches, rect }], projects: [{ text, rect }], turns: { name } | null }`, or `{ found: false }`.
 * `row` is the text of the nearest SettingRow-shaped ancestor (a `justify-between` div), the words a control sits beside.
 */
export async function huntersRegion(page) {
  return page.evaluate(({ win, nightly, turns, kinds, projects }) => {
    const root = document.querySelector(win) ?? document.body;
    const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const nameOf = (el) => {
      const own = el.getAttribute("aria-label");
      if (own) return own;
      const by = el.getAttribute("aria-labelledby");
      if (by) return by.split(/\s+/).map((id) => text(document.getElementById(id))).join(" ");
      if (el.labels?.length) return [...el.labels].map(text).join(" ");
      return "";
    };
    const rowOf = (el) => text(el.closest('div[class~="justify-between"]'));
    const CONTROLS = 'button, input, select, textarea, [role="switch"], [role="combobox"], [role="spinbutton"]';
    const all = [...root.querySelectorAll(CONTROLS)].filter((el) => el.getClientRects().length > 0);
    const switchEl = all.find((el) => el.getAttribute("role") === "switch" && nameOf(el).trim() === nightly);
    if (!switchEl) return { found: false };
    const after = (a, b) => Boolean(b && a && (b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING));
    const ageRow = root.querySelector("[data-runner-bug-board-age-days]");
    const turnsEl = all.find((el) => /take turns/i.test(nameOf(el))) ??
      [...root.querySelectorAll('div[class~="justify-between"]')].filter((r) => text(r).includes(turns))
        .map((r) => r.querySelector(".vv-select__trigger")).find(Boolean) ?? null;
    const timeEl = all.find((el) => el.tagName === "INPUT" && el.type === "time" && after(el, switchEl)) ?? null;
    const items = [...root.querySelectorAll("[data-sortable-item]")].filter((el) => el.getClientRects().length > 0 && after(el, switchEl));
    const anchors = [switchEl, timeEl, turnsEl, ...items].filter(Boolean);
    const at = (el) => all.indexOf(el);
    const insideItem = (el) => items.some((item) => item.contains(el));
    let lo = Math.min(...anchors.filter((a) => all.includes(a)).map(at));
    let hi = Math.max(...anchors.filter((a) => all.includes(a)).map(at));
    all.forEach((c, i) => { if (insideItem(c)) { lo = Math.min(lo, i); hi = Math.max(hi, i); } });
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    const controls = all.slice(lo, hi + 1).map((el, n) => ({
      i: lo + n, tag: el.tagName.toLowerCase(), type: el.getAttribute("type") ?? "", role: el.getAttribute("role") ?? "",
      name: nameOf(el), row: rowOf(el), min: el.getAttribute("min"), max: el.getAttribute("max"), value: el.value ?? null, rect: box(el),
    }));
    const hunters = items.filter((el) => kinds.filter((k) => new RegExp(`\\b${k}\\b`, "i").test(text(el))).length === 1 && !projects.some((p) => text(el).includes(p)))
      .map((el) => ({ text: text(el), switches: el.querySelectorAll('[role="switch"]').length, parent: [...items].indexOf(el), rect: box(el) }));
    const projectItems = items.filter((el) => projects.some((p) => text(el).includes(p))).map((el) => ({ text: text(el), rect: box(el) }));
    const sameList = (els) => new Set(els.map((el) => el.parentElement)).size === 1;
    const hunterEls = items.filter((el) => hunters.some((h) => h.text === text(el)));
    const projectEls = items.filter((el) => projectItems.some((p) => p.text === text(el)));
    return {
      found: true,
      afterBugBoard: after(switchEl, ageRow),
      controls,
      hunters,
      projects: projectItems,
      huntersOneList: hunterEls.length > 0 && sameList(hunterEls),
      projectsOneList: projectEls.length > 0 && sameList(projectEls),
      listsApart: hunterEls.length > 0 && projectEls.length > 0 && hunterEls[0].parentElement !== projectEls[0].parentElement,
      turns: turnsEl ? { name: nameOf(turnsEl), row: rowOf(turnsEl) } : null,
      viewport: window.innerWidth,
    };
  }, { win: SETTINGS_WINDOW, nightly: NIGHTLY_LABEL, turns: TURNS_LABEL, kinds: KINDS, projects: PROJECTS });
}

/**
 * The height a finger can press each control of the region by, hit-tested: at the control's centre x, every y from its centre up and
 * down until `elementFromPoint` lands on something that is neither the control, inside it, nor a label for it. A `::before` that
 * reaches past the box counts (it is the element's own hit area); a padded wrapper that does nothing on a press does not.
 * Resolves `[{ i, name, row, height }]` for the controls whose index is in `indices`.
 */
export async function pressHeights(page, indices) {
  return page.evaluate(({ win, indices }) => {
    const root = document.querySelector(win) ?? document.body;
    const CONTROLS = 'button, input, select, textarea, [role="switch"], [role="combobox"], [role="spinbutton"]';
    const all = [...root.querySelectorAll(CONTROLS)].filter((el) => el.getClientRects().length > 0);
    const owns = (c, el) => Boolean(el) && (el === c || c.contains(el) || el.closest("label")?.control === c);
    return indices.map((i) => {
      const c = all[i];
      if (!c) return { i, name: "", row: "(no control at this index)", height: 0 };
      c.scrollIntoView({ block: "center" });
      const r = c.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      let up = 0;
      while (up < 60 && owns(c, document.elementFromPoint(x, cy - up - 1))) up += 1;
      let down = 0;
      while (down < 60 && owns(c, document.elementFromPoint(x, cy + down + 1))) down += 1;
      return { i, name: c.getAttribute("aria-label") ?? "", row: (c.closest('div[class~="justify-between"]')?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60), height: up + down + 1 };
    });
  }, { win: SETTINGS_WINDOW, indices });
}
