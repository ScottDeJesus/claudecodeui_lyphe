// The Proposed features face is filled from its one route and is told, never asks on a clock (bug-hunters, seam 11,
// wired in phase 16). The panel holds the face's one read (the tab's count and the rows are one answer), so it reads
// GET /api/kanban-dispatch/proposals when the board opens, with board=<the open board>&state=open — once, or twice on the
// dev server, whose React.StrictMode mounts every effect twice. Which proposals → All reads again with state=all, Which
// boards → All boards again with board=all; a burst of three dispatcher_state frames on the app's socket is coalesced
// into one or two more reads (with no timer the face cannot know a burst is over), never one per frame; with nothing
// arriving nothing is read. The face draws the route's proposals and none of the stand-in it drew before it was wired: since
// the board's redraw to the design system (2026-11-20) each is a mark on its state's ring round the board's core, and the
// ended one opens from its mark (lib/kanban_board.mjs's openProposal).
//
// The board is lib/kanban_board.mjs's made-up board; the proposals' answer is this case's, and the app's socket is
// handed on with the server's board and dispatcher frames held back (lib/bug_hunt_faces.mjs). Nothing is written.
//
// protects: src/modules/kanban/proposed/useProposals.ts, src/modules/kanban/proposed/ProposedFeatures.tsx, src/modules/kanban/utils/proposalRings.ts, src/modules/kanban/KanbanPanel.tsx
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { BOARD, openBoard, openProposal } from "../lib/kanban_board.mjs";
import { PROPOSALS, QUIET_MS, WAIT_MS, answer, holdBus, json, proposal, standInIn, tab, until, watch } from "../lib/bug_hunt_faces.mjs";

const OPEN = [proposal(1, "Case proposal: split the case store", { priority: "high" }), proposal(2, "Case proposal: one reader for the case night", { kind: "design", priority: "low" })];
const ENDED = proposal(3, "Case proposal: a dismissed case idea", { state: "dismissed", reason: "the case said no", ended_at: "2026-11-18T13:00:00.000Z" });

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  const reads = watch(page, PROPOSALS);
  const bus = await holdBus(page);
  await openBoard(page);
  const gets = () => reads.filter((r) => r.method === "GET" && r.path.endsWith("/proposals"));
  const said = () => gets().map((r) => `${r.query.board}/${r.query.state}`).join(", ");
  const readsAfter = async (count) => {
    await until(page, () => gets().length >= count);
    await page.waitForTimeout(QUIET_MS); // a second read, had the change sent one, has had time to go
    return gets().length;
  };

  // The mount read went to lib/kanban_board.mjs's route (it answers every board request); it is counted all the same.
  const mounted = await readsAfter(1);
  if (mounted < 1 || mounted > 2 || gets().some((r) => r.query.board !== BOARD.id || r.query.state !== "open")) {
    return broken(`opening the board read the proposals ${mounted} times (${said() || "none"}), not once (twice under the dev double mount) for ${BOARD.id}/open`);
  }

  // From here on the answers are this case's.
  await answer(page, PROPOSALS, (request) => {
    const state = new URL(request.url()).searchParams.get("state");
    return json({ proposals: state === "all" ? [...OPEN, ENDED] : OPEN });
  });
  await tab(page, "Proposed features").click({ timeout: WAIT_MS });
  await page.locator("[data-proposed-features]").first().waitFor({ timeout: WAIT_MS });
  await page.waitForTimeout(QUIET_MS);
  const afterTab = gets().length;

  const radio = (name) => page.locator("[data-proposed-features] [role=\"radio\"]").filter({ hasText: name }).first();
  await radio(/^\s*All\s*$/).click({ timeout: WAIT_MS });
  if ((await readsAfter(afterTab + 1)) !== afterTab + 1 || gets()[afterTab].query.board !== BOARD.id || gets()[afterTab].query.state !== "all") {
    return broken(`Which proposals → All left the reads at ${said()}, not one more for ${BOARD.id}/all`);
  }
  // Each proposal is a mark on its state's ring: the open two on Open, the dismissed one on Dismissed.
  const ringOf = (id) => page.locator(`[data-kanban-panel] [data-bug-instrument] [role="slider"][data-ring-items~="proposal:${id}"]`).first();
  if (!(await ringOf(ENDED.id).waitFor({ state: "attached", timeout: WAIT_MS }).then(() => true, () => false))) {
    return broken(`the route answered three proposals for state=all and the face drew no mark for "${ENDED.title}" (data-proposed-features=${await page.locator("[data-proposed-features]").first().getAttribute("data-proposed-features")})`);
  }
  for (const p of [...OPEN, ENDED]) {
    const ring = await ringOf(p.id).getAttribute("data-ring", { timeout: 2000 }).catch(() => null);
    if (ring !== p.state) return broken(`"${p.title}" is drawn on the ${ring ?? "no"} ring, not its state's (${p.state})`);
  }
  const ended = await openProposal(page, ENDED.id).catch(() => null);
  if (ended === null || !((await ended.textContent()) ?? "").includes(ENDED.title)) return broken(`the dismissed "${ENDED.title}" does not open from its mark`);
  await page.keyboard.press("Escape");
  const face = page.locator("[data-proposed-features]").first();
  const stale = await standInIn(face);
  if (stale.length > 0) return broken(`over the route's answer the face still draws its stand-in: ${stale.join(" | ")}`);

  await radio(/All boards/).click({ timeout: WAIT_MS });
  const scoped = afterTab + 1;
  if ((await readsAfter(scoped + 1)) !== scoped + 1 || gets()[scoped].query.board !== "all" || gets()[scoped].query.state !== "all") {
    return broken(`Which boards → All boards left the reads at ${said()}, not one more for all/all`);
  }

  const beforeBurst = gets().length;
  for (let i = 0; i < 3; i++) bus.dispatcherFrame();
  const afterBurst = await readsAfter(beforeBurst + 1);
  if (afterBurst < beforeBurst + 1 || afterBurst > beforeBurst + 2) {
    return broken(`a burst of three dispatcher frames took the reads from ${beforeBurst} to ${afterBurst} (${said()}), not one or two more`);
  }
  if (gets().slice(beforeBurst).some((r) => r.query.board !== "all" || r.query.state !== "all")) return broken(`the burst's reads asked ${said()}, not all/all`);

  await page.waitForTimeout(QUIET_MS * 2);
  if (gets().length !== afterBurst) return broken(`with nothing arriving the face read the route again: ${said()}`);

  return held(`reads ${said()}: ${mounted} on mount, ${afterTab - mounted} for the tab, once per change, ${afterBurst - beforeBurst} for three frames, none while quiet; the route's three proposals drawn on their rings, no stand-in`);
});
