// Under a card's questions, its drawer lists the choices a walk took for the reader without asking: the card's own
// `detail.decisions` as the server sends them, newest first, each with its question and its choice. A decision that
// records the answer to a question (its `questionId` set) is not listed again there: that answer already stands in
// its question's own row above. The heading counts what it lists ("Decided for you · 3").
//
// The board is lib/kanban_board.mjs's; this case answers the one card's detail itself, with three noted decisions
// written out of time order and one answered question with its decision row. Read at 390x844. Nothing is written.
//
// protects: src/modules/kanban/card-drawer/DrawerDecisions.tsx, src/modules/kanban/card-drawer/DrawerQuestions.tsx, src/modules/kanban/card-drawer/KanbanCardDrawer.tsx
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { CARDS, detailOf, openBoard, openDrawer } from "../lib/kanban_board.mjs";

const PHONE = { width: 390, height: 844 };
const WAIT_MS = 15000;
const CARD = CARDS.bug;
const AT = "2026-11-18T12:00:00.000Z";

const decision = (id, question, choice, createdAt, questionId = null) => ({ id, cardId: CARD.id, questionId, question, choice: [choice], tags: [], createdAt });
// Written oldest, newest, middle: a list drawn in the order received reads wrong.
const NOTED = [
  decision("case-dec-1", "Which lines of a note are kept?", "Every line, in the order written", "2026-11-18T09:00:00.000Z"),
  decision("case-dec-3", "Is the drag drift the same bug?", "Related, not the same", "2026-11-18T11:00:00.000Z"),
  decision("case-dec-2", "Does the body get the same cure?", "Yes, it is drawn by the same paragraph", "2026-11-18T10:00:00.000Z"),
];
const NEWEST_FIRST = ["Is the drag drift the same bug?", "Does the body get the same cure?", "Which lines of a note are kept?"];
const ANSWERED = decision("case-dec-q", "Which hint wording do you want?", "Name an absolute path", "2026-11-18T11:30:00.000Z", "case-q-1");
const QUESTION = {
  id: "case-q-1", cardId: CARD.id, text: ANSWERED.question, multi: false, options: ["Name an absolute path", "Keep it"],
  selected: ["Name an absolute path"], otherOn: false, other: "", answered: true, sortOrder: 0, createdAt: AT, answeredAt: AT,
};

runCase(async (t) => {
  const page = await withPage(t, { viewport: PHONE });
  await openBoard(page);
  await page.route(`**/api/kanban/cards/${CARD.id}`, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const card = { ...detailOf(CARD), questions: [QUESTION], decisions: [...NOTED, ANSWERED] };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ card }) });
  });

  // The card is a mark on its ring since the board's redraw to the design system (2026-11-20): it opens from the keyboard.
  const drawer = await openDrawer(page, CARD.id);
  await drawer.waitFor({ timeout: WAIT_MS });
  const group = drawer.locator("[data-drawer-decisions]");
  await group.first().waitFor({ timeout: WAIT_MS }).catch(() => {});
  if ((await group.count()) === 0) return broken(`the drawer of "${CARD.title}" lists none of the three decisions its detail carries`);
  // Its words as written: the heading is set in capitals by its type (the design system's caption), which `innerText` reports.
  const text = await group.first().innerText();
  if (!/Decided for you · 3\b/i.test(text)) return broken(`the decisions' heading does not count 3: ${JSON.stringify(text.split("\n")[0])}`);
  if (text.includes(ANSWERED.question)) return broken(`the decisions list repeats the answered question "${ANSWERED.question}", whose answer stands in its own row`);
  const at = NEWEST_FIRST.map((question) => text.indexOf(question));
  if (at.some((index) => index < 0)) return broken(`the decisions list misses a noted decision: ${JSON.stringify(text)}`);
  if (!(at[0] < at[1] && at[1] < at[2])) return broken(`the decisions are not newest first: ${JSON.stringify(text)}`);
  for (const noted of NOTED) {
    if (!text.includes(noted.choice[0])) return broken(`the decision "${noted.question}" is listed without its choice "${noted.choice[0]}"`);
  }
  return held(`the drawer listed the three noted decisions newest first with their choices under "Decided for you · 3", and not the answered question's`);
});
