// The board's vitals strip says five counts, in one order: building now, waiting on your answer, queued in To Do, then
// the two estate backlogs, lessons and memories. Nothing on it speaks of approval or of cards to claim: the Approve gate
// and the claim queue are gone from the board (kanban-bug-dispatcher, the board's screens).
//
// The vitals are lib/kanban_board.mjs's, five different numbers (1 to 5 in that order), so a register drawn from the
// wrong key says the wrong number. Read at 1440x900, where the strip stands in the header's row with every register.
// Nothing reaches the board's server and nothing is written.
//
// protects: src/modules/kanban/KanbanVitalsStrip.tsx, src/modules/kanban/hooks/useKanbanLaneFeed.ts, src/shared/kanban-types.ts
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { VITALS, openBoard } from "../lib/kanban_board.mjs";

const DESKTOP = { width: 1440, height: 900 };
const WAIT_MS = 30000;
// The order, each register's number in the fixture and what its words must say.
const EXPECTED = [
  { number: VITALS.building, words: /build/i, name: "building" },
  { number: VITALS.awaitingAnswer, words: /answer/i, name: "waiting on an answer" },
  { number: VITALS.queued, words: /queued|to do/i, name: "queued" },
  { number: VITALS.lessonsPendingEstate, words: /lesson/i, name: "lessons" },
  { number: VITALS.memoryPendingEstate, words: /memor/i, name: "memories" },
];
const GONE = /approv|claim/i;

runCase(async (t) => {
  const page = await withPage(t, { viewport: DESKTOP });
  await openBoard(page);
  const strip = page.getByRole("group", { name: /vitals/i }).first();
  await strip.waitFor({ timeout: WAIT_MS });
  // The reading lands after the header: wait until no register says "not read".
  const end = Date.now() + WAIT_MS;
  let said = [];
  while (Date.now() < end) {
    said = await strip.getByRole("img").evaluateAll((all) => all.filter((e) => e.getClientRects().length > 0).map((e) => e.getAttribute("aria-label") ?? ""));
    if (said.length > 0 && !said.some((s) => /not read/i.test(s))) break;
    await page.waitForTimeout(200);
  }
  const wrong = said.filter((s) => GONE.test(s));
  if (wrong.length > 0) return broken(`the strip still says ${wrong.map((s) => `"${s}"`).join(", ")}`);
  if (said.length !== EXPECTED.length) return broken(`the strip says ${said.length} counts, not ${EXPECTED.length}: ${said.map((s) => `"${s}"`).join(", ")}`);
  for (const [i, want] of EXPECTED.entries()) {
    const number = Number((said[i].match(/^\s*(\d+)/) ?? [])[1]);
    if (number !== want.number || !want.words.test(said[i])) {
      return broken(`count ${i + 1} of the strip says "${said[i]}" where ${want.name} reads ${want.number}`);
    }
  }
  return held(`the strip says, in order: ${said.join(" · ")}`);
});
