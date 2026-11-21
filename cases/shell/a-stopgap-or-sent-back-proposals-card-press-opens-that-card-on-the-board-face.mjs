// A proposed feature's cards open on their board (bug-hunters, seam 11, wired in phase 16). An open proposal's stopgap
// ticket, once a board placed it, is a press that turns the Bugs view to its Board face with that card's drawer open;
// so is the card a sent-back proposal became. Since the board's redraw to the design system (2026-11-20) a proposal is a
// mark on a ring and both presses are in its Opening (lib/kanban_board.mjs's openProposal). Pressing writes nothing.
//
// The board is lib/kanban_board.mjs's made-up board, its cards the ones the presses name; the proposals are answered by
// this case. Nothing reaches the server and nothing is written.
//
// protects: src/modules/kanban/proposed/ProposalOpening.tsx, src/modules/kanban/proposed/ProposedFeatures.tsx, src/modules/kanban/KanbanPanel.tsx
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { BOARD, CARDS, openBoard, openProposal } from "../lib/kanban_board.mjs";
import { PROPOSALS, PROPOSAL_ACT, WAIT_MS, answer, json, proposal, tab, watch } from "../lib/bug_hunt_faces.mjs";

const OPEN = proposal(21, "Case proposal: stopgap first", {
  stopgaps: [{ ticket: 501, title: "Case stopgap: stop the harm now", state: "placed", board: BOARD.id, card: CARDS.bug.id }],
});
const SENT = proposal(22, "Case proposal: sent back", {
  state: "sent-back", ended_at: "2026-11-18T13:00:00.000Z", sent_back: { ticket: 502, board: BOARD.id, card: CARDS.change.id },
});

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  const { requests } = await openBoard(page);
  await answer(page, PROPOSALS, (request) => {
    const state = new URL(request.url()).searchParams.get("state");
    return json({ proposals: state === "all" ? [OPEN, SENT] : [OPEN] });
  });
  const acts = watch(page, PROPOSAL_ACT);
  const writesBefore = requests.filter((r) => r.method !== "GET").length;

  const toProposed = async () => {
    await tab(page, "Proposed features").click({ timeout: WAIT_MS });
    await page.locator("[data-proposed-features]").first().waitFor({ timeout: WAIT_MS });
  };
  const opened = async (card) => {
    const faceNow = () => page.locator("[data-kanban-face]").first().getAttribute("data-kanban-face", { timeout: 2000 }).catch(() => null);
    let face = await faceNow();
    for (const end = Date.now() + WAIT_MS; face !== "board" && Date.now() < end; face = await faceNow()) await page.waitForTimeout(200);
    const drawer = await page.getByRole("dialog").filter({ hasText: card.title }).first().waitFor({ timeout: WAIT_MS }).then(() => true, () => false);
    return { face, drawer };
  };

  await toProposed();
  await page.locator('[data-proposed-features] [role="radio"]').filter({ hasText: /^\s*All\s*$/ }).first().click({ timeout: WAIT_MS });
  const openRow = await openProposal(page, OPEN.id).catch(() => null);
  if (openRow === null) return broken(`the face drew no mark that opens the route's "${OPEN.title}"`);
  const stopgap = openRow.locator(`[data-proposal-card="${CARDS.bug.id}"]`).first();
  if (!(await stopgap.waitFor({ timeout: WAIT_MS }).then(() => true, () => false))) return broken("the opened proposal draws no press for its placed stopgap ticket");
  await stopgap.click();
  const first = await opened(CARDS.bug);
  if (first.face !== "board" || !first.drawer) {
    return broken(`the stopgap's press left data-kanban-face=${first.face} and ${first.drawer ? "its drawer open" : `no drawer naming "${CARDS.bug.title}" open`}`);
  }
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").filter({ hasText: CARDS.bug.title }).first().waitFor({ state: "hidden", timeout: WAIT_MS }).catch(() => {});

  await toProposed();
  const sentRow = await openProposal(page, SENT.id).catch(() => null);
  if (sentRow === null) return broken(`the face drew no mark that opens the sent-back "${SENT.title}"`);
  const sentCard = sentRow.locator(`[data-proposal-card="${CARDS.change.id}"]`).first();
  if (!(await sentCard.waitFor({ timeout: WAIT_MS }).then(() => true, () => false))) return broken("the sent-back proposal draws no press for the card it became");
  await sentCard.click();
  const second = await opened(CARDS.change);
  if (second.face !== "board" || !second.drawer) {
    return broken(`the sent-back card's press left data-kanban-face=${second.face} and ${second.drawer ? "its drawer open" : `no drawer naming "${CARDS.change.title}" open`}`);
  }

  const wrote = requests.filter((r) => r.method !== "GET").slice(writesBefore);
  if (wrote.length > 0 || acts.some((r) => r.method !== "GET")) return broken(`pressing the cards wrote: ${JSON.stringify([...wrote, ...acts])}`);

  return held(`the stopgap opened "${CARDS.bug.title}" and the sent-back card "${CARDS.change.title}", each on the Board face; nothing written`);
});
