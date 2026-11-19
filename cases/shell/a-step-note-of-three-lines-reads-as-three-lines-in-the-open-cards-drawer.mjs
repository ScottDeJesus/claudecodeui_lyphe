// A checklist step's note is drawn whole, line by line: the root-cause step's three report lines (what was searched
// for the same cause, for similar cards, and for an earlier fix) each stand on a line of their own in the open card's
// drawer, none run together into one and none cut (kanban-bug-dispatcher, the board's screens).
//
// The note is lib/kanban_board.mjs's NOTE_LINES, joined with newlines as the dispatcher's step note carries them. Read
// as the browser lays the drawer out (innerText follows white-space), at 1440x900 on a board with autonomy on. Every
// board request is answered by the page itself; nothing is written.
//
// protects: src/modules/kanban/card-drawer
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { CARDS, NOTE_LINES, openBoard, openDrawer } from "../lib/kanban_board.mjs";

const DESKTOP = { width: 1440, height: 900 };

runCase(async (t) => {
  const page = await withPage(t, { viewport: DESKTOP });
  await openBoard(page);
  const drawer = await openDrawer(page, CARDS.bug.id);
  const lines = (await drawer.innerText()).split("\n").map((l) => l.trim());
  for (const want of NOTE_LINES) {
    if (lines.includes(want)) continue;
    const near = lines.find((l) => l.includes(want.slice(0, 12)));
    return broken(near === undefined
      ? `the drawer does not draw the note's line "${want}"`
      : `the note's line "${want}" is not a line of its own: the drawer reads "${near}"`);
  }
  return held(`the root-cause step's note reads as its ${NOTE_LINES.length} lines, each on its own`);
});
