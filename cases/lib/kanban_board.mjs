// kanban_board.mjs — the Kanban board on a signed-in page, over one made-up self-running board that only this page sees.
//
// Usage (cases/shell/<name>.mjs):
//   import { openBoard, CARDS, openDrawer } from "../lib/kanban_board.mjs";
//   const page = await withPage(t, { viewport });
//   const { requests } = await openBoard(page);          // every /api/kanban* answer is this file's; the tab is the board
//   const opening = await openDrawer(page, CARDS.bug.id); // the card's Opening, hung from its mark on its ring
//
// EVERY BOARD REQUEST IS ANSWERED HERE AND NOTHING REACHES THE SERVER: `/api/kanban/…` and `/api/kanban-dispatch/…`,
// reads and writes alike. A read gets this file's board; a write gets `{}` and is counted in
// `requests`, so a case can say a press wrote nothing. The live board, its cards and its database are never touched.
//
// THE BOARD is one board with autonomy on and one repo, holding one card per lane and one card per flow tag, and the
// four link tags a walk writes (`from:`, `duplicate-of:`, `related:`, `regression-of:`), each naming another card of it
// by id. The vitals are five distinct numbers, so a register drawn from the wrong key reads the wrong number.

const WAIT_MS = 30000;
// Read off src/ and the live page 2026-11-18: the rail's Kanban view, the home's Menu and its Kanban entry. The view is
// named Bugs since a4e2af52 (2026-11-19, `nav.kanban` in en/common.json); both names are found.
const RAIL_KANBAN = 'nav[aria-label="Views"] :is(button[aria-label="Bugs"], button[aria-label="Kanban"])';
const VIEW_NAME = /^\s*(Bugs|Kanban)\s*$/;
const HOME_MENU = 'button[aria-label="Menu"]';
const MENU_ENTRY = ':is([role="menu"], [role="dialog"]) :is(button, [role="menuitem"])';
const KANBAN = /\/api\/kanban(-dispatch)?(\/|$|\?)/;
const AT = "2026-11-18T12:00:00.000Z";

export const BOARD = {
  id: "case-board-0001", name: "Case board", projectId: null, autonomy: true,
  repos: ["/home/lyphe/.claude"], sortOrder: 0, archived: false, createdAt: AT, updatedAt: AT,
};

/** The vitals, one number per register, all different: building 1, answer 2, queued 3, lessons 4, memories 5. */
export const VITALS = { building: 1, awaitingAnswer: 2, queued: 3, lessonsPendingEstate: 4, memoryPendingEstate: 5 };

const card = (id, title, status, tags, extra = {}) => ({
  id, boardId: BOARD.id, title, status, priority: "medium", sortOrder: 0, tags,
  openQuestions: 0, openIssues: 0, checklistDone: 1, checklistTotal: 3, buildTokens: 0,
  archived: false, createdAt: AT, updatedAt: AT, ...extra,
});

/** The cards, by role. Ids are opaque on purpose: no word a reader should see is spelled in one. */
export const CARDS = {
  linked: card("case-card-7f3a", "Sweep refuses the path I gave", "not_ready", []),
  bug: card("case-card-21c9", "Hint says its repo path", "todo", ["bug", "duplicate-of:case-card-7f3a"]),
  change: card("case-card-5d02", "Only show five decisions", "active", ["ui-change", "related:case-card-7f3a"]),
  tweak: card("case-card-9b14", "Rename the autonomy switch", "done", ["tweak", "from:case-card-7f3a"]),
  regress: card("case-card-0e61", "The hint came back", "questions", ["bug", "regression-of:case-card-7f3a"], { openQuestions: 1 }),
};

/** The root-cause step's note: three lines, each a report line as the diagnosis writes it. */
export const NOTE_LINES = [
  "SAME CAUSE: the sweep's path check — 2 places",
  "SIMILAR CARDS: open cards naming the hint — 1 card",
  "BEFORE: done cards of the cases area — nothing similar",
];

/** The open card's detail: the summary and a ledger that would light every control the drawer ever drew. `doneAt` and
 *  `changelog` are on every detail the server answers since the board's two columns (bug-board-ways-in-and-dashboard,
 *  seam 8); the drawer reads `changelog` as a string, so a detail without it is a shape the server no longer sends. */
export function detailOf(summary) {
  return {
    ...summary,
    description: "The hint says its repo path where it means an absolute one.", body: "", plan: "Fix the hint.",
    closingRemarks: "", doneAt: null, changelog: "",
    buildTokensIn: 1200, buildTokensOut: 340, buildTokensCacheRead: 9000, buildTokensCacheCreate: 450,
    questions: [], issues: [], decisions: [], attachments: [],
    checklist: [
      { id: `${summary.id}-s1`, cardId: summary.id, text: "Sort", state: "done", sortOrder: 0, note: "bug — Jev, 0.93 sure", createdAt: AT, doneAt: AT },
      { id: `${summary.id}-s2`, cardId: summary.id, text: "Confirm the bug and find the root cause", state: "done", sortOrder: 1,
        note: NOTE_LINES.join("\n"), createdAt: AT, doneAt: AT },
      { id: `${summary.id}-s3`, cardId: summary.id, text: "Fix", state: "active", sortOrder: 2, note: "", createdAt: AT, doneAt: null },
    ],
  };
}

const all = () => Object.values(CARDS);
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

function answer(url, method) {
  const { pathname, searchParams } = new URL(url);
  if (method !== "GET") return {};
  if (pathname === "/api/kanban/boards") return { boards: [BOARD], currentBoardId: BOARD.id };
  if (/^\/api\/kanban\/projects\/[^/]+\/board$/.test(pathname)) return { board: BOARD };
  if (pathname === `/api/kanban/boards/${BOARD.id}/lanes`) {
    const totals = new Map();
    for (const c of all()) totals.set(c.status, (totals.get(c.status) ?? 0) + 1);
    return { lanes: [...totals].map(([status, total]) => ({ status, total })) };
  }
  if (pathname === `/api/kanban/boards/${BOARD.id}/vitals`) return { vitals: VITALS };
  if (pathname === `/api/kanban/boards/${BOARD.id}/cards`) {
    const statuses = (searchParams.get("status") ?? "").split(",");
    return { cards: all().filter((c) => statuses.includes(c.status)), nextCursor: null };
  }
  const one = pathname.match(/^\/api\/kanban\/cards\/([^/]+)$/);
  if (one) {
    const found = all().find((c) => c.id === decodeURIComponent(one[1]));
    return found ? { card: detailOf(found) } : null;
  }
  if (pathname.startsWith("/api/kanban/lessons")) return { lessons: [] };
  if (pathname.startsWith("/api/kanban/events")) return { events: [], nextCursor: null };
  return {};
}

/** The board's rings at home: one slider per ring, each naming its cards by id, in order, in `data-ring-items`. The
 *  instrument docked at the foot (another face is the work) is a picture with no sliders, so these are the board's alone. */
const RING_SLIDERS = '[data-kanban-panel] [data-bug-instrument] [role="slider"]';

/**
 * Route every board request to this file's board, open the Kanban view from the rail or the home's Menu, then wait for
 * the board's head and the ring holding its first card. Returns the board requests the page made, `{ method, path }`, oldest first.
 */
export async function openBoard(page) {
  const requests = [];
  await page.route(KANBAN, (route) => {
    const request = route.request();
    requests.push({ method: request.method(), path: new URL(request.url()).pathname });
    const body = answer(request.url(), request.method());
    return route.fulfill(body === null ? json({ error: "no such card" }, 404) : json(body));
  });
  await page.locator(`${RAIL_KANBAN}:visible, ${HOME_MENU}:visible`).first().waitFor({ timeout: WAIT_MS });
  if ((await page.locator(`${RAIL_KANBAN}:visible`).count()) > 0) {
    await page.locator(`${RAIL_KANBAN}:visible`).first().click({ timeout: WAIT_MS });
  } else {
    await page.locator(`${HOME_MENU}:visible`).first().click();
    await page.locator(MENU_ENTRY, { hasText: VIEW_NAME }).first().click({ timeout: WAIT_MS });
  }
  await page.getByRole("combobox", { name: "Board" }).or(page.getByRole("button", { name: "Board" })).first()
    .waitFor({ timeout: WAIT_MS });
  await faceOf(page, CARDS.bug.id).waitFor({ state: "attached", timeout: WAIT_MS });
  return { requests };
}

/** The board's head: the one row that holds the board switcher (its name, which is its picker). */
export const headerOf = (page) => page.locator("header", { has: page.getByRole("combobox", { name: "Board" }).or(page.getByRole("button", { name: "Board" })) }).first();

/**
 * A card's place on the board since its redraw to the design system (2026-11-20): the slider of the ring that holds it, found by
 * the card's id among the ids its ring names. A card is a mark on a ring and has no element of its own; its words are read in its
 * Opening (`openDrawer`). Present only while the board is the face drawn.
 */
export const faceOf = (page, id) => page.locator(`${RING_SLIDERS}[data-ring-items~="${id}"]`).first();

/** The open card's Opening, by its id: what pressing a card opens, hung from its mark. */
export const openingOf = (page, id) => page.locator(`[data-bug-opening="${id}"]`).first();

/**
 * Open a card the way a keyboard does: its ring's slider, Home, as many arrows as the card stands from the first, then Enter
 * (Enter opens the card a ring is coming round to). Waits for its Opening and answers it.
 */
export async function openDrawer(page, id) {
  const ring = faceOf(page, id);
  await ring.waitFor({ state: "attached", timeout: WAIT_MS });
  const at = ((await ring.getAttribute("data-ring-items")) ?? "").split(" ").indexOf(id);
  await ring.focus();
  await page.keyboard.press("Home");
  for (let step = 0; step < at; step += 1) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  const drawer = openingOf(page, id);
  await drawer.waitFor({ timeout: WAIT_MS });
  await drawer.getByText(NOTE_LINES[0], { exact: false }).first().waitFor({ timeout: WAIT_MS }).catch(() => {});
  return drawer;
}

/**
 * Open the board itself, as its core's press does: the core's own button for assistive tech ("Open the board"), pressed from the
 * keyboard (it is drawn under the rings' canvas, so a pointer reaches the core through the canvas). Waits for the board's Opening
 * and answers it: whether it runs itself, its counts, its repositories and its acts.
 */
export async function openBoardItself(page) {
  const core = page.locator('[data-kanban-panel] [data-bug-instrument] [data-ast-rings] > button').first();
  await core.waitFor({ state: "attached", timeout: WAIT_MS });
  await core.focus();
  await page.keyboard.press("Enter");
  const opening = page.locator("[data-bug-board-opening]").first();
  await opening.waitFor({ timeout: WAIT_MS });
  return opening;
}

