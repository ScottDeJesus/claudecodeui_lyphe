// A card's face says its flow as a word, read from its tag: bug → Bug, ui-change → UI change, tweak → Tweak. A link tag
// (from:, duplicate-of:, related:, regression-of:) is drawn as its word on a press that opens the linked card, and the
// linked card's id is never what the reader reads: no face prints a raw link tag or the bare id (INV-76). Under a finger
// every press is 44 px each way (INV-10275). The linked card's TITLE beside the word is not read here: it is filled from
// the board's cards by a later phase, and this case keeps the word, the press and the absent id.
//
// The board is lib/kanban_board.mjs's: four cards each linking one fifth card by id, every board request answered by
// the page itself. Read at 390x844, where a word set to stand down on a phone would be missing. Nothing is written.
//
// protects: src/modules/kanban, src/shared/ui/KanbanCard.tsx
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { CARDS, faceOf, openBoard } from "../lib/kanban_board.mjs";

const PHONE = { width: 390, height: 844 };
const FINGER_PX = 44;
const LINKED_ID = CARDS.linked.id;
const RAW_LINK = /\b(from|duplicate-of|related|regression-of):/;
const FACES = [
  { card: CARDS.bug, flow: /\bBug\b/, flowWord: "Bug", link: /duplicate/i, linkWord: "duplicate" },
  { card: CARDS.change, flow: /\bUI change\b/, flowWord: "UI change", link: /related/i, linkWord: "related" },
  { card: CARDS.tweak, flow: /\bTweak\b/, flowWord: "Tweak", link: /\bfrom\b/i, linkWord: "from" },
  { card: CARDS.regress, flow: /\bBug\b/, flowWord: "Bug", link: /regression/i, linkWord: "regression" },
];
const PRESS = ':is(button, a[href], [role="button"], [role="link"])';

runCase(async (t) => {
  const page = await withPage(t, { viewport: PHONE });
  const { requests } = await openBoard(page);
  const said = [];
  for (const face of FACES) {
    const el = faceOf(page, face.card.id);
    await el.scrollIntoViewIfNeeded();
    const text = await el.innerText();
    const title = JSON.stringify(face.card.title);
    if (!face.flow.test(text)) return broken(`the face of ${title} (tag ${face.card.tags[0]}) does not say "${face.flowWord}": ${JSON.stringify(text)}`);
    if (RAW_LINK.test(text)) return broken(`the face of ${title} prints its raw link tag: ${JSON.stringify(text)}`);
    if (text.includes(LINKED_ID)) return broken(`the face of ${title} prints the linked card's bare id ${LINKED_ID}`);
    const press = el.locator(PRESS).filter({ hasText: face.link });
    const presses = await press.count();
    if (presses === 0) return broken(`the face of ${title} has no press saying "${face.linkWord}" for its ${face.card.tags[1].split(":")[0]} link`);
    await press.first().scrollIntoViewIfNeeded();
    const box = await press.first().boundingBox();
    if (!box) return broken(`the "${face.linkWord}" press on ${title} is not drawn at 390 wide`);
    if (box.height < FINGER_PX - 0.5 || box.width < FINGER_PX - 0.5) {
      return broken(`the "${face.linkWord}" press on ${title} is ${Math.round(box.width)}x${Math.round(box.height)} px at 390 wide, under the ${FINGER_PX} px a finger needs`);
    }
    said.push(`${face.flowWord} + ${face.linkWord} (${Math.round(box.width)}x${Math.round(box.height)})`);
  }
  const writes = requests.filter((r) => r.method !== "GET");
  if (writes.length > 0) return broken(`drawing the faces wrote ${writes.map((w) => `${w.method} ${w.path}`).join(", ")}`);
  return held(`at 390 wide each face says its flow and its link's word, no raw tag and no bare id: ${said.join("; ")}`);
});
