// The board's five counts, in one order: building now, asking (waiting on your answer), waiting to start (To Do, the vitals' `queued`), then the two estate
// backlogs, lessons and memories, each said to belong to every board. Nothing among them speaks of approval or of cards to
// claim: the Approve gate and the claim queue are gone from the board (kanban-bug-dispatcher, the board's screens). Since the
// board's redraw to the design system (2026-11-20) the counts are no strip in a header: they are the board's own detail, read in
// what its core opens (a key-value list, its label then its number), because the rings already show what is building, asking
// and waiting. The To Do count's words are the operator's ruling, "Waiting to start", never "Queued".
//
// The vitals are lib/kanban_board.mjs's, five different numbers (1 to 5 in that order), so a register drawn from the
// wrong key says the wrong number. Read at 1440x900. Nothing reaches the board's server and nothing is written.
//
// protects: src/modules/kanban/BugBoardOpening.tsx, src/modules/kanban/hooks/useKanbanLaneFeed.ts, src/shared/kanban-types.ts
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { VITALS, openBoard, openBoardItself } from "../lib/kanban_board.mjs";

const DESKTOP = { width: 1440, height: 900 };
const WAIT_MS = 30000;
// The order, each count's number in the fixture and what its label must say.
const EXPECTED = [
  { number: VITALS.building, words: /build/i, name: "building" },
  { number: VITALS.awaitingAnswer, words: /ask/i, name: "asking" },
  { number: VITALS.queued, words: /waiting to start/i, name: "queued" },
  { number: VITALS.lessonsPendingEstate, words: /lesson/i, name: "lessons", estate: true },
  { number: VITALS.memoryPendingEstate, words: /memor/i, name: "memories", estate: true },
];
const GONE = /approv|claim/i;

runCase(async (t) => {
  const page = await withPage(t, { viewport: DESKTOP });
  const { requests } = await openBoard(page);
  const opening = await openBoardItself(page);
  // The reading lands after the board: wait until every count is a number.
  const end = Date.now() + WAIT_MS;
  let rows = [];
  while (Date.now() < end) {
    rows = await opening.locator(".ast-kv").first().evaluate((list) => [...list.querySelectorAll("dt")].map((dt) => [dt.textContent.trim(), dt.nextElementSibling?.textContent.trim() ?? ""]))
      .catch(() => []);
    if (rows.length > 0 && rows.every(([, value]) => /^\d/.test(value))) break;
    await page.waitForTimeout(200);
  }
  const said = rows.map(([label, value]) => `${label} ${value}`);
  const wrong = said.filter((s) => GONE.test(s));
  if (wrong.length > 0) return broken(`the board's counts still say ${wrong.map((s) => `"${s}"`).join(", ")}`);
  if (rows.length !== EXPECTED.length) return broken(`the board's Opening says ${rows.length} counts, not ${EXPECTED.length}: ${said.map((s) => `"${s}"`).join(", ")}`);
  for (const [i, want] of EXPECTED.entries()) {
    const [label, value] = rows[i];
    const number = Number((value.match(/^\s*(\d+)/) ?? [])[1]);
    if (number !== want.number || !want.words.test(label)) return broken(`count ${i + 1} says "${label} ${value}" where ${want.name} reads ${want.number}`);
    if (want.estate && !/every board/i.test(value)) return broken(`count ${i + 1}, ${want.name}, does not say it belongs to every board: "${value}"`);
  }
  const writes = requests.filter((r) => r.method !== "GET");
  if (writes.length > 0) return broken(`opening the board wrote ${writes.map((w) => `${w.method} ${w.path}`).join(", ")}`);
  return held(`the board's Opening says, in order: ${said.join(" · ")}`);
});
