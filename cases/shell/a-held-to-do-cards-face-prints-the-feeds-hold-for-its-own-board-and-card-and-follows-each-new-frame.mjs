// A card waiting in To Do on a self-running board prints why the dispatcher is holding it, from the dispatcher's own
// feed (`DispatcherPicture.cards`, matched to the card by board id AND card id), as words on the card and never only on
// hover (INV-10275). The feed's class word is taken off and the sentence reads as a person would say it:
//   `cards: 1 of 1 walking` -> "Held — 1 of 1 cards walking", `waits: <title> goes first` -> "Held — <title> goes first",
//   `queue: Pause all is on` -> "Held — Pause all is on".
// Each new `dispatcher_state` frame is read as it lands: a hold that changes changes on the face with no reload. A card of
// ANOTHER board that happens to carry the same card id never lends its sentence, and a card outside To Do (the walking
// one in Building) prints no hold even when its feed object carries one.
//
// The board is lib/kanban_board.mjs's (every board request answered by the page itself); the feed is lib/kanban_feed.mjs's
// (the seed and the socket frames answered with this case's cards). Read at 1440x900, then at 390x844. Nothing is written.
//
// protects: src/modules/kanban/hooks/useKanbanWalks.ts, src/modules/kanban/utils/walkModel.ts, src/modules/kanban/KanbanPanel.tsx, src/modules/dispatcher/DispatcherFeed.tsx, src/shared/ui/KanbanCard.tsx
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { BOARD, CARDS, faceOf, openBoard } from "../lib/kanban_board.mjs";
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

/** Wait until the face's own words hold `want`; the face's text as it stood when the wait ended. */
async function faceSays(page, id, want) {
  const face = faceOf(page, id);
  await face.getByText(want, { exact: false }).first().waitFor({ timeout: WAIT_MS }).catch(() => {});
  return face.innerText();
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
    for (const [index, hold] of steps.entries()) {
      if (index > 0) await feed.say(cardsHeld(hold.feed));
      const text = await faceSays(page, CARDS.bug.id, hold.face);
      if (!text.includes(hold.face)) {
        const heard = feed.heard();
        return broken(`${width}, with the feed holding "${CARDS.bug.title}" by \`${hold.feed}\`, its To Do face does not print "${hold.face}": ${JSON.stringify(text)} (feed answered: ${heard.seeds} seed read(s), ${heard.sockets} socket(s))`);
      }
      if (text.includes("9 of 9")) return broken(`${width} the face of "${CARDS.bug.title}" prints the hold the feed gives ANOTHER board's card of the same id: ${JSON.stringify(text)}`);
      const sentence = faceOf(page, CARDS.bug.id).getByText(hold.face, { exact: false }).first();
      await sentence.scrollIntoViewIfNeeded();
      const box = await sentence.boundingBox();
      if (!box || box.height < 1) return broken(`${width} the hold "${hold.face}" is in the face's text but not drawn on the card`);
      said.push(`${width}: ${hold.face}`);
    }
    const building = await faceOf(page, CARDS.change.id).innerText();
    if (/\bHeld\b/.test(building)) return broken(`${width} the Building card "${CARDS.change.title}" prints a hold: ${JSON.stringify(building)}`);
  }
  return held(`the To Do face printed each hold the feed gave its own board and card, live from each frame, and nothing for the other board or the Building card — ${said.join("; ")}`);
});
