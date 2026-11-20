// The Bugs view has two faces, the board and the dashboard, and the kit's Tabs under the board's header switch them
// (bug-board-ways-in-and-dashboard, seam 11). The face is the panel's own state, like the lane sorts: Board is where a
// visit opens, `data-kanban-face` says which face is drawn, and the lanes are drawn only on Board. Under a finger each
// tab is a 44 px press (INV-10275). The tabs' count and the dashboard's sections are not read here: the count is the
// dashboard's data, and this case keeps only that there are two faces and that the switch between them holds.
//
// The board is lib/kanban_board.mjs's: one made-up self-running board, every board request answered by the page itself,
// so nothing reaches the board's server and nothing is written. Read at 1440x900, then at 390x844, then after a reload.
//
// protects: src/modules/kanban/KanbanPanel.tsx, src/modules/kanban/KanbanBoardFace.tsx, src/shared/ui/Tabs.tsx
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { CARDS, faceOf, headerOf, openBoard } from "../lib/kanban_board.mjs";

const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const FINGER_PX = 43.5; // 44 px, less the half pixel a layout may round away
const FACE = "[data-kanban-face]";

const tabs = (page) => ({
  board: page.locator('[data-kanban-panel] [role="tab"]').filter({ hasText: /^\s*Board\b/ }).first(),
  dashboard: page.locator('[data-kanban-panel] [role="tab"]').filter({ hasText: /^\s*Dashboard\b/ }).first(),
});
const faceNow = (page) => page.locator(FACE).first().getAttribute("data-kanban-face").catch(() => null);
const lanesDrawn = (page) => faceOf(page, CARDS.bug.id).isVisible().catch(() => false);
const settle = (page) => page.waitForTimeout(400);

runCase(async (t) => {
  const page = await withPage(t, { viewport: DESK });
  const { requests } = await openBoard(page);
  const { board, dashboard } = tabs(page);
  if ((await board.count()) === 0 || (await dashboard.count()) === 0) {
    const said = await page.locator('[data-kanban-panel] [role="tab"]').allTextContents();
    return broken(`the board draws no Board and Dashboard tabs (tabs drawn: [${said.join(", ")}])`);
  }
  const headerBox = await headerOf(page).boundingBox();
  // `has` is read from the tablist down, so the tab is named from there: a locator that starts at the panel finds nothing inside it.
  const listBox = await page.locator('[data-kanban-panel] [role="tablist"]')
    .filter({ has: page.locator('[role="tab"]', { hasText: /^\s*Board\b/ }) }).first().boundingBox();
  if (!headerBox || !listBox || listBox.y < headerBox.y + headerBox.height - 1) {
    return broken(`the face tabs are not under the board's header (header ends at ${headerBox && headerBox.y + headerBox.height}, tabs start at ${listBox?.y})`);
  }
  const boxOrder = [await board.boundingBox(), await dashboard.boundingBox()];
  if (boxOrder[0].x >= boxOrder[1].x && boxOrder[0].y >= boxOrder[1].y) return broken("Dashboard is drawn before Board");

  if ((await board.getAttribute("aria-selected")) !== "true") return broken("a visit opens with Board not selected");
  if ((await faceNow(page)) !== "board") return broken(`a visit opens with data-kanban-face=${await faceNow(page)}, not board`);

  await dashboard.click();
  await settle(page);
  if ((await faceNow(page)) !== "dashboard") return broken(`pressing Dashboard leaves data-kanban-face=${await faceNow(page)}`);
  if ((await dashboard.getAttribute("aria-selected")) !== "true") return broken("pressing Dashboard does not select it");
  if (await lanesDrawn(page)) return broken("on the Dashboard face the lanes are still drawn");

  await board.click();
  await settle(page);
  if ((await faceNow(page)) !== "board") return broken(`pressing Board leaves data-kanban-face=${await faceNow(page)}`);
  if (!(await lanesDrawn(page))) return broken("pressing Board again does not bring the lanes back");

  await page.setViewportSize(PHONE);
  await settle(page);
  for (const [name, tab] of Object.entries({ Board: board, Dashboard: dashboard })) {
    const box = await tab.boundingBox();
    if (!box || box.height < FINGER_PX) return broken(`at 390 wide the ${name} tab is ${box ? Math.round(box.height) : "not"} px tall, under a finger's 44`);
  }

  const writes = requests.filter((r) => r.method !== "GET");
  if (writes.length > 0) return broken(`switching faces wrote ${writes.map((w) => `${w.method} ${w.path}`).join(", ")}`);

  await dashboard.click();
  await settle(page);
  await page.reload();
  try {
    await openBoard(page);
  } catch {
    return broken(`after a reload the board's lanes never came back (data-kanban-face=${await faceNow(page)}): the face was remembered across visits`);
  }
  if ((await faceNow(page)) !== "board") return broken(`after a reload the panel opens on data-kanban-face=${await faceNow(page)}, not board`);

  return held("Board then Dashboard under the header; each press switches the face and the lanes with it; both tabs 44 px at 390; a reload opens on Board; nothing written");
});
