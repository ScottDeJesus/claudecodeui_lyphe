// A card waiting in To Do on a self-running board prints why the dispatcher is holding it, from the dispatcher's own
// feed (`DispatcherPicture.cards`, matched to the card by board id AND card id), as words and never only on hover
// (INV-10275). Since the board's redraw to the design system (2026-11-20) a card is a mark on a ring and its words are its
// Opening's: the hold is printed there, under the card's course (`[data-bug-walk-note]`). The feed's class word is taken
// off and the sentence reads as a person would say it:
//   `cards: 1 of 1 walking` -> "Held — 1 of 1 cards walking", `waits: <title> goes first` -> "Held — <title> goes first",
//   `queue: Pause all is on` -> "Held — Pause all is on".
// Each new `dispatcher_state` frame is read as it lands: a hold that changes changes in the open card with no reload. A card
// of ANOTHER board that happens to carry the same card id never lends its sentence, and a card outside To Do (the walking
// one in Building) prints no hold even when its feed object carries one.
//
// The board is lib/kanban_board.mjs's (every board request answered by the page itself); the feed is lib/kanban_feed.mjs's
// (the seed and the socket frames answered with this case's cards). Read at 1440x900, then at 390x844. Nothing is written.
//
// protects: src/modules/kanban/hooks/useKanbanWalks.ts, src/modules/kanban/utils/walkModel.ts, src/modules/kanban/KanbanPanel.tsx, src/modules/dispatcher/DispatcherFeed.tsx, src/modules/kanban/card-drawer/KanbanCardDrawer.tsx
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { BOARD, CARDS, openBoard, openDrawer } from "../lib/kanban_board.mjs";
import { feedCards, walk } from "../lib/kanban_feed.mjs";

const WIDE = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const WAIT_MS = 15000;
const BLOCKER = CARDS.linked.title;

const HOLDS = [
  { feed: "cards: 1 of 1 walking", face: "Held — 1 of 1 cards walking" },
  { feed: `waits: ${BLOCKER} goes first`, face: `Held — ${BLOCKER} goes first` },
  { feed: "queue: Pause all is on", face: "Held — Pause all is on" },
];
const DECOY = "cards: 9 of 9 walking";

/** The feed: the To Do card held by `hold`, the same card id on another board held otherwise, the Building card walking. */
const cardsHeld = (hold) => [
  walk({ card: CARDS.bug.id, title: CARDS.bug.title, state: "queued", hold }),
  walk({ board: `${BOARD.id}-other`, card: CARDS.bug.id, title: "A card of another board", state: "queued", hold: DECOY }),
  walk({ card: CARDS.change.id, title: CARDS.change.title, state: "walking", flow: "change", hold: "cards: 2 of 2 walking" }),
];

/** The open card's hold line: its text once it holds `want` (or as it stood when the wait ended), "" for none. */
async function noteSays(opening, want) {
  const note = opening.locator("[data-bug-walk-note]");
  await note.getByText(want, { exact: false }).first().waitFor({ timeout: WAIT_MS }).catch(() => {});
  return (await note.count()) > 0 ? note.first().innerText() : "";
}

runCase(async (t) => {
  const said = [];
  for (const viewport of [WIDE, PHONE]) {
    const page = await withPage(t, { viewport });
    await openBoard(page);
    const feed = await feedCards(page, cardsHeld(HOLDS[0].feed));
    await openBoard(page);
    const width = `at ${viewport.width} wide`;
    const steps = viewport === WIDE ? HOLDS : HOLDS.slice(0, 1);
    const opening = await openDrawer(page, CARDS.bug.id);
    for (const [index, hold] of steps.entries()) {
      if (index > 0) await feed.say(cardsHeld(hold.feed));
      const text = await noteSays(opening, hold.face);
      if (!text.includes(hold.face)) {
        const heard = feed.heard();
        return broken(`${width}, with the feed holding "${CARDS.bug.title}" by \`${hold.feed}\`, its open card does not print "${hold.face}": ${JSON.stringify(text)} (feed answered: ${heard.seeds} seed read(s), ${heard.sockets} socket(s))`);
      }
      if (text.includes("9 of 9")) return broken(`${width} the open card "${CARDS.bug.title}" prints the hold the feed gives ANOTHER board's card of the same id: ${JSON.stringify(text)}`);
      const box = await opening.locator("[data-bug-walk-note]").first().boundingBox();
      if (!box || box.height < 1) return broken(`${width} the hold "${hold.face}" is in the open card's text but not drawn`);
      said.push(`${width}: ${hold.face}`);
    }
    await page.keyboard.press("Escape");
    const building = await openDrawer(page, CARDS.change.id);
    const buildingText = await building.innerText();
    if (/\bHeld\b/.test(buildingText)) return broken(`${width} the Building card "${CARDS.change.title}" prints a hold: ${JSON.stringify(buildingText.slice(0, 300))}`);
  }
  return held(`the open To Do card printed each hold the feed gave its own board and card, live from each frame, and nothing for the other board or the Building card — ${said.join("; ")}`);
});
