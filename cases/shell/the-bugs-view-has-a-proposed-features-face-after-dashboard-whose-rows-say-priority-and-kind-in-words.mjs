// The Bugs view gains a third face, Proposed features, after Board and Dashboard (bug-hunters, seam 11, scaffolded in
// phase 14). Pressed, it draws the proposals and neither the lanes nor the dashboard. Each row says its priority as a
// word (High, Medium, Low) and its kind in words (Too big for a ticket, The design is wrong), never a colour alone; a
// collapsed row opens in place on its press; under a finger every press is 44 px and the face stacks inside 390 px
// (INV-10275). Switching faces and opening a row write nothing.
//
// The data is not this case's to judge: the rows come from the proposals route, which this case answers with two open
// proposals of the route's shape. The panel reads that route once at its mount, inside openBoard and before this
// case's answer is registered, so the mount read is lib/kanban_board.mjs's and the face reads it as not answered; the
// case then presses the face's own Try again, a read, to draw its rows. The board is lib/kanban_board.mjs's made-up
// board, every board request answered by the page; nothing reaches the server.
//
// protects: src/modules/kanban/KanbanPanel.tsx, src/modules/kanban/proposed/ProposedFeatures.tsx, src/modules/kanban/proposed/ProposalRow.tsx, src/modules/kanban/proposed/useProposals.ts, src/modules/i18n/locales/en/common.json
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { BOARD, CARDS, faceOf, openBoard } from "../lib/kanban_board.mjs";

const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const FINGER_PX = 43.5;
const WAIT_MS = 15000;
const PROPOSALS = /\/api\/kanban-dispatch\/proposals(\?|$)/;
const ROADMAP = /\/api\/roadmap(\?|$)/;
const AT = "2026-11-18T12:00:00.000Z";

const proposal = (id, title, kind, priority) => ({
  id, path: BOARD.repos[0], title, words: `${title}: the words of the proposal.`, kind, priority, state: "open",
  hunt: "security", source: "hunter", proposed_at: AT, ended_at: null, feature: null, reason: null,
  findings: [{ unit: "hooks/dispatcher/store.py", words: "The store opens without a timeout.", found_at: AT }],
  stopgaps: [], sent_back: null, boardName: BOARD.name,
});
const ANSWER = { proposals: [proposal(1, "Split the store's writer", "too-big", "high"), proposal(2, "One reader for the night", "design", "low")] };

// A tab is found by its name (the kit's Tabs gives each its label as `aria-label`), never by its text: a tab with a
// count draws the pill straight after the label, so its text is "Proposed features4".
const tab = (page, name) => page.locator(`[data-kanban-panel] [role="tab"][aria-label="${name}"]`).first();
const settle = (page) => page.waitForTimeout(500);

/** The face below the tabs, read in the page: its text, its presses' heights, what runs off the screen, its collapsed rows. */
const readFace = (page) => page.evaluate(() => {
  const panel = document.querySelector("[data-kanban-panel]");
  const header = panel.querySelector("header");
  const strip = panel.querySelector('[role="tablist"]');
  const outside = (el) => (header && header.contains(el)) || (strip && strip.contains(el));
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const scrolls = (el) => { for (let a = el.parentElement; a && a !== panel; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === "auto" || o === "scroll") return true; } return false; };
  const all = [...panel.querySelectorAll("*")].filter((el) => !outside(el) && shown(el));
  const presses = all.filter((el) => el.matches('button, [role="button"], [role="radio"], [role="combobox"], a[href]'));
  const short = presses.filter((el) => el.getBoundingClientRect().height < 43.5)
    .map((el) => `${(el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40)} (${Math.round(el.getBoundingClientRect().height)} px)`);
  const off = all.filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && !scrolls(el))
    .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || "").trim().slice(0, 30)}" ends at ${Math.round(el.getBoundingClientRect().right)}`);
  const text = all.map((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ")).join(" ").replace(/\s+/g, " ");
  const folded = presses.filter((el) => el.getAttribute("aria-expanded") === "false" && !el.hasAttribute("aria-haspopup") && el.getAttribute("role") !== "combobox").length;
  return { text, short, off: off.slice(0, 5), folded, dashboard: !!panel.querySelector("[data-bug-dashboard]") };
});

runCase(async (t) => {
  const page = await withPage(t, { viewport: DESK });
  const { requests } = await openBoard(page);
  // Registered after openBoard's own route, so these two reads are answered here.
  await page.route(PROPOSALS, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ANSWER) }));
  await page.route(ROADMAP, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ roadmaps: [] }) }));

  const [board, dashboard, proposed] = [tab(page, "Board"), tab(page, "Dashboard"), tab(page, "Proposed features")];
  if ((await proposed.count()) === 0) {
    const said = await page.locator('[data-kanban-panel] [role="tab"]').allTextContents();
    return broken(`the Bugs view draws no Proposed features tab (tabs drawn: [${said.join(", ")}])`);
  }
  const boxes = [await board.boundingBox(), await dashboard.boundingBox(), await proposed.boundingBox()];
  if (!(boxes[0].x < boxes[1].x && boxes[1].x < boxes[2].x)) return broken("the faces' tabs are not Board, Dashboard, Proposed features from left to right");

  await proposed.click();
  await settle(page);
  if ((await proposed.getAttribute("aria-selected")) !== "true") return broken("pressing Proposed features does not select it");
  // The panel's mount read went to lib/kanban_board.mjs's route, which answers `{}`: the face says so with Try again.
  const unread = page.locator('[data-proposed-features="unreachable"]').first();
  if (await unread.isVisible().catch(() => false)) {
    await unread.getByRole("button").first().click({ timeout: WAIT_MS });
    await page.locator('[data-proposed-features="ready"]').first().waitFor({ timeout: WAIT_MS }).catch(() => {});
  }
  if (await faceOf(page, CARDS.bug.id).isVisible().catch(() => false)) return broken("on the Proposed features face the lanes are still drawn");

  await page.setViewportSize(PHONE);
  await page.waitForFunction(() => /High|Medium|Low/.test(document.querySelector("[data-kanban-panel]")?.innerText ?? ""), null, { timeout: WAIT_MS }).catch(() => {});
  await settle(page);
  const face = await readFace(page);
  if (face.dashboard) return broken("on the Proposed features face the dashboard is drawn");
  if (!/\b(High|Medium|Low)\b/.test(face.text)) return broken("no row on the Proposed features face says a priority as the word High, Medium or Low");
  if (!/Too big for a ticket|The design is wrong/.test(face.text)) return broken("no row says its kind as Too big for a ticket or The design is wrong");
  if (face.short.length > 0) return broken(`at 390 wide these presses on the face are under a finger's 44 px: ${face.short.slice(0, 6).join("; ")}`);
  if (face.off.length > 0) return broken(`at 390 wide the face runs off the screen: ${face.off.join("; ")}`);
  if (face.folded === 0) return broken("no row on the face is a collapsed press that opens in place (no aria-expanded=false press)");

  const row = page.locator('[data-kanban-panel] [aria-expanded="false"]:not([aria-haspopup]):not([role="combobox"])')
    .filter({ hasNot: page.locator('[role="tab"]') });
  // The element itself is held, not the locator: the locator picks by `aria-expanded="false"`, so once the row opens
  // it would read the next collapsed row and report the pressed one as still shut.
  const first = await row.first().elementHandle();
  await first.click();
  await settle(page);
  if ((await first.getAttribute("aria-expanded").catch(() => null)) !== "true") return broken("pressing a collapsed row does not open it in place (aria-expanded stays false)");
  const opened = await readFace(page);
  if (opened.short.length > 0) return broken(`opened at 390 wide, these presses are under 44 px: ${opened.short.slice(0, 6).join("; ")}`);
  if (opened.off.length > 0) return broken(`opened at 390 wide, the row runs off the screen: ${opened.off.join("; ")}`);

  const writes = requests.filter((r) => r.method !== "GET");
  if (writes.length > 0) return broken(`switching to the face and opening a row wrote ${writes.map((w) => `${w.method} ${w.path}`).join(", ")}`);
  return held("Board, Dashboard, Proposed features; the face draws no lanes and no dashboard; priority and kind are words; a row opens in place; every press 44 px and nothing off the screen at 390; nothing written");
});
