// A link a walk wrote on a card (`duplicate-of:<id>`, `regression-of:<id>` …) is read as its word and the LINKED CARD'S
// TITLE, never its id (INV-76): on the face and in the drawer alike, the title is the board's own, read off the lanes
// loaded or by id. The link's press opens that card in the same sheet. A link to a card the server answers 404 for is a
// card that is gone: its row says so in words and offers no press.
//
// The board is lib/kanban_board.mjs's: "Hint says its repo path" (To Do) carries duplicate-of: "Sweep refuses the path I
// gave". This case answers that card's detail itself with one more tag, regression-of: an id the board's routes answer
// 404 for. Read at 390x844. Nothing is written.
//
// protects: src/modules/kanban/KanbanPanel.tsx, src/modules/kanban/card-drawer/DrawerLinks.tsx, src/modules/kanban/card-drawer/KanbanCardDrawer.tsx, src/modules/kanban/utils/walkModel.ts, src/shared/ui/KanbanCard.tsx
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { CARDS, detailOf, faceOf, openBoard } from "../lib/kanban_board.mjs";

const PHONE = { width: 390, height: 844 };
const WAIT_MS = 15000;
const CARD = CARDS.bug;
const LINKED = CARDS.linked;
const GONE_ID = "case-card-dead";
const GONE_WORDS = "a card that is no longer on this board";
const PRESS = ':is(button, a[href], [role="button"], [role="link"])';

/** The open sheet's card title: the drawer's title field, or its heading where the field is not drawn. */
const sheetTitle = (drawer) => drawer.evaluate((root) =>
  [...root.querySelectorAll("input, textarea")].map((field) => field.value).join(" | ") + " | " + root.innerText.split("\n").slice(0, 3).join(" | "));

async function sheetShows(drawer, title) {
  for (let waited = 0; waited < WAIT_MS; waited += 250) {
    if ((await sheetTitle(drawer)).includes(title)) return true;
    await drawer.page().waitForTimeout(250);
  }
  return false;
}

runCase(async (t) => {
  const page = await withPage(t, { viewport: PHONE });
  await openBoard(page);
  await page.route(`**/api/kanban/cards/${CARD.id}`, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const card = { ...detailOf(CARD), tags: [...CARD.tags, `regression-of:${GONE_ID}`] };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ card }) });
  });

  // The face: its duplicate link names the linked card by its title.
  const face = faceOf(page, CARD.id);
  const faceLink = face.locator(PRESS).filter({ hasText: /Duplicate of/ }).first();
  await faceLink.getByText(LINKED.title).waitFor({ timeout: WAIT_MS }).catch(() => {});
  const faceText = await face.innerText();
  if (!faceText.includes(LINKED.title)) return broken(`the face of "${CARD.title}" does not name its duplicate by the title "${LINKED.title}": ${JSON.stringify(faceText)}`);
  if (faceText.includes(LINKED.id)) return broken(`the face of "${CARD.title}" prints the linked card's id ${LINKED.id}`);

  // The drawer: the duplicate is a press with the title, the gone card words with none.
  await face.getByText(CARD.title).first().click({ timeout: WAIT_MS });
  const drawer = page.getByRole("dialog").first();
  await drawer.waitFor({ timeout: WAIT_MS });
  const links = drawer.locator("[data-drawer-links]");
  await links.first().getByText(GONE_WORDS).waitFor({ timeout: WAIT_MS }).catch(() => {});
  if ((await links.count()) === 0) return broken(`the drawer of "${CARD.title}" draws no links section for its two link tags`);
  const linksText = await links.first().innerText();
  if (linksText.includes(LINKED.id) || linksText.includes(GONE_ID)) return broken(`the drawer's links print a card id: ${JSON.stringify(linksText)}`);
  const dupPress = links.first().locator(PRESS).filter({ hasText: LINKED.title });
  if ((await dupPress.count()) === 0) return broken(`the drawer's duplicate link is not a press naming "${LINKED.title}": ${JSON.stringify(linksText)}`);
  if (!/Regression of/.test(linksText) || !linksText.includes(GONE_WORDS)) {
    return broken(`the link to a card the server answers 404 for does not read "Regression of" and "${GONE_WORDS}": ${JSON.stringify(linksText)}`);
  }
  const gonePresses = await links.first().locator(PRESS).filter({ hasText: GONE_WORDS }).count();
  if (gonePresses > 0) return broken(`the gone card's link is a press: opening it could only show that it cannot be read`);

  const before = await sheetTitle(drawer);
  if (before.includes(LINKED.title)) return broken(`cannot tell the sheet's card apart: before the press it already reads ${JSON.stringify(before)}`);
  await dupPress.first().click();
  if (!(await sheetShows(drawer, LINKED.title))) {
    return broken(`pressing the duplicate link in the drawer did not open "${LINKED.title}" in the sheet: it shows ${JSON.stringify(await sheetTitle(drawer))}`);
  }
  return held(`the face and the drawer named the duplicate "${LINKED.title}", its press opened it in the sheet, the 404 card read "${GONE_WORDS}" with no press, and no id was printed`);
});
