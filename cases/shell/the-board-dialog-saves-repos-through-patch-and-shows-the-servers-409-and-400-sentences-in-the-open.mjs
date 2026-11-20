// A board's repositories are written through `PATCH /api/kanban/boards/:boardId` (`repos`), and the server's two
// refusals are said where the fix is, inside the board dialog, never in a toast that leaves:
//   - the Runs itself switch pressed on a board that names no repository answers 409 KANBAN_BOARD_NEEDS_REPOS: the dialog
//     opens on Board repositories with the server's sentence in it;
//   - a Save answered 400 KANBAN_BOARD_REPO_INVALID (a path not inside a git work tree) leaves the dialog open over the
//     path that was typed, with the server's sentence in it;
//   - each Save sends `repos` equal to the list on screen, and a 200 closes the dialog.
//
// The board is lib/kanban_board.mjs's, answered here with autonomy off and no repositories; this case answers the
// board's PATCH itself, with the envelope server/index.ts's error handler writes for an AppError
// ({ success: false, error: { code, message } }) and the two sentences the server writes
// (kanban-boards.service.ts, kanban-board-repos.ts). Nothing reaches the server's board. Read at 1440x900.
//
// protects: src/modules/kanban/KanbanPanel.tsx, src/modules/kanban/KanbanBoardDialog.tsx, src/modules/kanban/KanbanBoardRepos.tsx, src/modules/kanban/hooks/useKanbanBoards.ts, src/modules/kanban/KanbanBoardHeader.tsx
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { BOARD, CARDS, faceOf, openBoard } from "../lib/kanban_board.mjs";

const WAIT_MS = 15000;
// The view is named Bugs since a4e2af52 (2026-11-19); both names are found.
const RAIL_KANBAN = 'nav[aria-label="Views"] :is(button[aria-label="Bugs"], button[aria-label="Kanban"])';
const HOME_MENU = 'button[aria-label="Menu"]';
const MENU_ENTRY = ':is([role="menu"], [role="dialog"]) :is(button, [role="menuitem"])';
const NEEDS = "A board runs itself only once it names at least one repository.";
const BAD_PATH = "/tmp";
const INVALID = `"${BAD_PATH}" is not inside a git work tree.`;
const GOOD_PATH = "/home/lyphe/.claude/claudecodeui_lyphe";
const OFF = { ...BOARD, autonomy: false, repos: [] };

const refusal = (status, code, message) => ({ status, contentType: "application/json", body: JSON.stringify({ success: false, error: { code, message } }) });
const ok = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

/** The Kanban view, opened the way lib/kanban_board.mjs opens it, after a reload left the page on its home. */
async function openKanban(page) {
  await page.locator(`${RAIL_KANBAN}:visible, ${HOME_MENU}:visible`).first().waitFor({ timeout: 30000 });
  if ((await page.locator(`${RAIL_KANBAN}:visible`).count()) > 0) {
    await page.locator(`${RAIL_KANBAN}:visible`).first().click();
  } else {
    await page.locator(`${HOME_MENU}:visible`).first().click();
    await page.locator(MENU_ENTRY, { hasText: /^\s*(Bugs|Kanban)\s*$/ }).first().click();
  }
  await faceOf(page, CARDS.bug.id).waitFor({ timeout: 30000 });
}

runCase(async (t) => {
  const page = await withPage(t);
  await openBoard(page);
  let board = OFF;
  const patches = [];
  await page.route("**/api/kanban/boards", (route) =>
    route.request().method() === "GET" ? route.fulfill(ok({ boards: [board], currentBoardId: board.id })) : route.fallback());
  await page.route(`**/api/kanban/boards/${BOARD.id}`, (route) => {
    const request = route.request();
    if (request.method() !== "PATCH") return route.fallback();
    const body = request.postDataJSON() ?? {};
    patches.push(body);
    if (body.autonomy === true && board.repos.length === 0) return route.fulfill(refusal(409, "KANBAN_BOARD_NEEDS_REPOS", NEEDS));
    if (Array.isArray(body.repos) && body.repos.includes(BAD_PATH)) return route.fulfill(refusal(400, "KANBAN_BOARD_REPO_INVALID", INVALID));
    board = { ...board, ...body };
    return route.fulfill(ok({ board }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openKanban(page);

  // 409: the switch opens the repositories dialog with the server's sentence.
  const autonomy = page.getByRole("switch", { name: "Runs itself" }).first();
  await autonomy.waitFor({ timeout: WAIT_MS });
  await autonomy.click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Board repositories" }).first();
  try {
    await dialog.waitFor({ timeout: WAIT_MS });
  } catch {
    return broken(`the Runs itself switch answered 409 KANBAN_BOARD_NEEDS_REPOS and no "Board repositories" dialog opened (PATCHes sent: ${JSON.stringify(patches)})`);
  }
  if (!(await dialog.innerText()).includes(NEEDS)) return broken(`the repositories dialog opened by the 409 does not say the server's sentence "${NEEDS}"`);

  // 400: the dialog stays open over the typed path, with the server's sentence.
  await dialog.getByPlaceholder("/absolute/path/to/a/repository").fill(BAD_PATH);
  await dialog.getByRole("button", { name: "Save" }).click();
  await dialog.getByText(INVALID).first().waitFor({ timeout: WAIT_MS }).catch(() => {});
  const last = patches.at(-1) ?? {};
  if (JSON.stringify(last.repos) !== JSON.stringify([BAD_PATH])) return broken(`Save over the typed path sent ${JSON.stringify(last)}, not repos ${JSON.stringify([BAD_PATH])}`);
  if (!(await dialog.isVisible())) return broken(`the 400 KANBAN_BOARD_REPO_INVALID closed the dialog: the refused draft is gone`);
  const refusedText = await dialog.innerText();
  if (!refusedText.includes(INVALID)) return broken(`the dialog open over the refused path does not say the server's sentence ${JSON.stringify(INVALID)}: ${JSON.stringify(refusedText)}`);
  const kept = await dialog.evaluate((root, path) => root.innerText.includes(path) || [...root.querySelectorAll("input")].some((field) => field.value === path), BAD_PATH);
  if (!kept) return broken(`the dialog open over the 400 no longer shows the typed path ${BAD_PATH}`);

  // 200: the refused path is replaced by a git repository; the Save closes the dialog.
  const remove = dialog.getByRole("button", { name: `Remove ${BAD_PATH}` });
  if ((await remove.count()) > 0) await remove.first().click();
  await dialog.getByPlaceholder("/absolute/path/to/a/repository").fill(GOOD_PATH);
  await dialog.getByRole("button", { name: "Save" }).click();
  await dialog.waitFor({ state: "hidden", timeout: WAIT_MS }).catch(() => {});
  const saved = patches.at(-1) ?? {};
  if (JSON.stringify(saved.repos) !== JSON.stringify([GOOD_PATH])) return broken(`Save over the list [${GOOD_PATH}] sent ${JSON.stringify(saved)}`);
  if (await dialog.isVisible()) return broken(`the Save answered 200 left the repositories dialog open`);
  return held(`409 opened Board repositories saying "${NEEDS}"; 400 kept the dialog over ${BAD_PATH} saying ${INVALID}; the 200 save of [${GOOD_PATH}] closed it — PATCHes ${JSON.stringify(patches)}`);
});
