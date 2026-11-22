// A link a walk wrote on a card (`duplicate-of:<id>`, `regression-of:<id>` …) is read as its word and the LINKED CARD'S
// TITLE, never its id (INV-76): the title is the board's own, read off the lanes loaded or by id. Since the board's redraw to
// the design system (2026-11-20) a card is a mark on a ring and its links are read in its Opening, where the old face's and
// drawer's both stood; the ring's own words for the card (its slider's value) name no linked card's id either. The link's
// press opens that card in the same Opening. A link to a card the server answers 404 for is a card that is gone: its row
// says so in words and offers no press.
//
// The board is lib/kanban_board.mjs's: "Hint says its repo path" (To Do) carries duplicate-of: "Sweep refuses the path I
// gave". This case answers that card's detail itself with one more tag, regression-of: an id the board's routes answer
// 404 for. Read at 390x844. Nothing is written.
//
// protects: src/modules/kanban/KanbanPanel.tsx, src/modules/kanban/card-drawer/DrawerLinks.tsx, src/modules/kanban/card-drawer/KanbanCardDrawer.tsx, src/modules/kanban/utils/walkModel.ts, src/modules/kanban/utils/bugHoop.ts
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { CARDS, detailOf, faceOf, openBoard, openDrawer } from "../lib/kanban_board.mjs";

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

  // The ring's words for the card: no linked card's id.
  const ringWords = (await faceOf(page, CARD.id).getAttribute("aria-valuetext")) ?? "";
  if (ringWords.includes(LINKED.id)) return broken(`the ring's words for "${CARD.title}" print the linked card's id ${LINKED.id}: ${JSON.stringify(ringWords)}`);

  // The open card: the duplicate is a press with the title, the gone card words with none.
  await openDrawer(page, CARD.id);
  // The open card's plate, whichever card it shows: a link's press opens the linked card in this same Opening.
  const drawer = page.locator("[data-bug-opening]").first();
  const links = drawer.locator("[data-drawer-links]");
  await links.first().getByText(GONE_WORDS).waitFor({ timeout: WAIT_MS }).catch(() => {});
  if ((await links.count()) === 0) return broken(`the open card "${CARD.title}" draws no links section for its two link tags`);
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
    return broken(`pressing the duplicate link in the open card did not open "${LINKED.title}" in its Opening: it shows ${JSON.stringify(await sheetTitle(drawer))}`);
  }
  return held(`the open card named the duplicate "${LINKED.title}", its press opened it in the same Opening, the 404 card read "${GONE_WORDS}" with no press, and no id was printed on the ring or in the card`);
});
