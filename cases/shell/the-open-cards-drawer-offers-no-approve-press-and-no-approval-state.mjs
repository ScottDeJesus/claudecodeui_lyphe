// The open card's drawer offers no Approve and no Withdraw approval press, and says nothing of approval: the Approve
// gate is gone from the board (kanban-bug-dispatcher, the board's screens). What the run's ledger still draws stands:
// the checklist, the issues and the closing remarks. (Since the open card's redraw to the design system, 2026-11-20, its
// spend is drawn only once the card has spent something, and this card has not.)
//
// The card is lib/kanban_board.mjs's: not approved, with a plan and no question open, so the drawer as it stood before
// this change drew an enabled Approve press and "Needs approval". Opened at 1440x900 on a board with autonomy on. Every
// board request is answered by the page itself; nothing is written.
//
// protects: src/modules/kanban/card-drawer, src/modules/kanban/KanbanPanel.tsx
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { CARDS, openBoard, openDrawer } from "../lib/kanban_board.mjs";

const DESKTOP = { width: 1440, height: 900 };
const APPROVAL = /approv/i;
const STILL_DRAWN = [/checklist|steps/i, /issues/i, /closing/i];

runCase(async (t) => {
  const page = await withPage(t, { viewport: DESKTOP });
  const { requests } = await openBoard(page);
  const drawer = await openDrawer(page, CARDS.bug.id);
  const presses = await drawer.getByRole("button").evaluateAll((all) => all.map((b) => `${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""}`.trim()));
  const approving = presses.filter((p) => APPROVAL.test(p));
  if (approving.length > 0) return broken(`the drawer still offers ${approving.map((p) => `"${p}"`).join(", ")}`);
  const text = await drawer.innerText();
  const line = text.split("\n").find((l) => APPROVAL.test(l));
  if (line) return broken(`the drawer still says "${line.trim()}"`);
  const missing = STILL_DRAWN.filter((words) => !words.test(text));
  if (missing.length > 0) return broken(`the drawer no longer draws ${missing.map(String).join(", ")}`);
  const writes = requests.filter((r) => r.method !== "GET");
  if (writes.length > 0) return broken(`opening the drawer wrote ${writes.map((w) => `${w.method} ${w.path}`).join(", ")}`);
  return held(`the drawer of an unapproved card with a plan offers no approval press and says nothing of approval; ${presses.length} presses read`);
});
