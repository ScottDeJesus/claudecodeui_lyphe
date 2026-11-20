// A card says its flow as a word, read from its tag: bug → Bug, ui-change → UI change, tweak → Tweak. A link tag (from:,
// duplicate-of:, related:, regression-of:) is drawn as its word on a press that opens the linked card, and the linked card's
// id is never what the reader reads: no card prints a raw link tag or the bare id (INV-76). Under a finger every press is
// 44 px each way (INV-10275). Since the board's redraw to the design system (2026-11-20) a card is a mark on a ring, and what
// its face said is said where a press on the mark opens it: the flow's word in the Opening's caption, the links as presses
// in its links. The linked card's TITLE beside the word is read by the link case, not here.
//
// The board is lib/kanban_board.mjs's: four cards each linking one fifth card by id, every board request answered by
// the page itself. Read at 390x844, where a word set to stand down on a phone would be missing. Nothing is written.
//
// protects: src/modules/kanban
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { CARDS, openBoard, openDrawer } from "../lib/kanban_board.mjs";

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
    const el = await openDrawer(page, face.card.id);
    // The caption as written (its capitals are the type's): the lane, then the flow's word.
    const caption = (await el.locator(".ast-opening-source").first().textContent()) ?? "";
    const text = await el.evaluate((root) => root.textContent ?? "");
    const title = JSON.stringify(face.card.title);
    if (!face.flow.test(caption)) return broken(`the open card ${title} (tag ${face.card.tags[0]}) does not say "${face.flowWord}" in its caption: ${JSON.stringify(caption)}`);
    if (RAW_LINK.test(text)) return broken(`the open card ${title} prints its raw link tag`);
    if (text.includes(LINKED_ID)) return broken(`the open card ${title} prints the linked card's bare id ${LINKED_ID}`);
    // Each press is judged by its DRAWN text (innerText), never by `hasText`, which reads textContent: there the word and
    // the linked card's title, set in sibling elements, run together ("Split fromSweep…") and a `\bfrom\b` cannot match.
    const all = el.locator(`[data-drawer-links] ${PRESS}`);
    let press = null;
    for (let i = 0; i < (await all.count()); i++) {
      if (face.link.test(await all.nth(i).innerText())) { press = all.nth(i); break; }
    }
    if (press === null) return broken(`the open card ${title} has no press saying "${face.linkWord}" for its ${face.card.tags[1].split(":")[0]} link`);
    await press.scrollIntoViewIfNeeded();
    const box = await press.boundingBox();
    if (!box) return broken(`the "${face.linkWord}" press on ${title} is not drawn at 390 wide`);
    if (box.height < FINGER_PX - 0.5 || box.width < FINGER_PX - 0.5) {
      return broken(`the "${face.linkWord}" press on ${title} is ${Math.round(box.width)}x${Math.round(box.height)} px at 390 wide, under the ${FINGER_PX} px a finger needs`);
    }
    said.push(`${face.flowWord} + ${face.linkWord} (${Math.round(box.width)}x${Math.round(box.height)})`);
    await page.keyboard.press("Escape");
    await el.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  const writes = requests.filter((r) => r.method !== "GET");
  if (writes.length > 0) return broken(`opening the cards wrote ${writes.map((w) => `${w.method} ${w.path}`).join(", ")}`);
  return held(`at 390 wide each open card says its flow and its link's word, no raw tag and no bare id: ${said.join("; ")}`);
});
