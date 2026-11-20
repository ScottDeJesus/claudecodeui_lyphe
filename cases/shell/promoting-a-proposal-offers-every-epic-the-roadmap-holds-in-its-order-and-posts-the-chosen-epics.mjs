// Promote to the roadmap reads its epics from the roadmap itself (bug-hunters, seam 11, wired in phase 16). The dialog
// asks GET /api/roadmap when it opens. The server's 200 that says the roadmap has not been read yet ({ error }) is said
// as could-not-be-read with Try again — never as "no roadmap has an epic yet". Try again asks once more, and the
// picture's epics fill the Epic list: every epic of every milestone of every roadmap, in the roadmap's own order, and
// none of the stand-in's. An epic chosen and Promote pressed twice sends ONE POST /proposals/<id>/promote whose body is
// { arc: <the chosen epic's name> } — the name, never its title — however long the answer takes.
//
// The board is lib/kanban_board.mjs's made-up board; the proposals, the roadmap and the promote are answered by this
// case. Nothing reaches the server's roadmap and nothing is written.
//
// protects: src/modules/kanban/proposed/ProposalPromoteDialog.tsx, src/modules/kanban/proposed/ProposedFeatures.tsx
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { openBoard } from "../lib/kanban_board.mjs";
import { PROPOSALS, PROPOSAL_ACT, QUIET_MS, ROADMAP, WAIT_MS, answer, json, proposal, standInIn, tab, until, watch } from "../lib/bug_hunt_faces.mjs";

const PROPOSAL = proposal(7, "Case proposal: promote me");
const epic = (name, title) => ({ name, title, word: "planned", features: [] });
// Two roadmaps, the first of two milestones, each epic a name that is not its title.
const PICTURE = {
  generated_at: "2026-11-18T12:00:00Z",
  roadmaps: [
    { name: "case-road-a", title: "Case road A", milestones: [
      { name: "case-ms-1", title: "Case milestone one", epics: [epic("case-epic-zeta", "Zeta epic of the case"), epic("case-epic-alpha", "Alpha epic of the case")] },
      { name: "case-ms-2", title: "Case milestone two", epics: [epic("case-epic-mid", "Middle epic of the case")] },
    ] },
    { name: "case-road-b", title: "Case road B", milestones: [
      { name: "case-ms-3", title: "Case milestone three", epics: [epic("case-epic-last", "Last epic of the case")] },
    ] },
  ],
  unplaced: { epics: [], features: [] },
  at: Date.now(),
};
const IN_ORDER = ["Zeta epic of the case", "Alpha epic of the case", "Middle epic of the case", "Last epic of the case"];

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  await openBoard(page);
  await answer(page, PROPOSALS, () => json({ proposals: [PROPOSAL] }));
  // Not read yet until Try again is pressed: the dev server's StrictMode mounts the dialog's effect twice, so a count
  // of answers would hand the second mount the picture.
  let roadmapAnswers = 0;
  let pictureNow = false;
  await answer(page, ROADMAP, () => {
    roadmapAnswers += 1;
    return pictureNow ? json(PICTURE) : json({ error: "the roadmap has not been read yet" });
  });
  const promotes = watch(page, PROPOSAL_ACT);
  await answer(page, PROPOSAL_ACT, async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500)); // held back, so a second press lands while the first is out
    return json({ line: `PROMOTED proposal ${PROPOSAL.id} — ${PROPOSAL.title} — an idea under Alpha epic of the case` });
  });

  await tab(page, "Proposed features").click({ timeout: WAIT_MS });
  // A dispatcher frame or a change re-reads the face; one more read, should the mount's have gone before this route, is asked by All.
  await page.locator('[data-proposed-features] [role="radio"]').filter({ hasText: /^\s*All\s*$/ }).first().click({ timeout: WAIT_MS });
  const row = page.locator(`[data-proposal="${PROPOSAL.id}"]`).filter({ hasText: PROPOSAL.title }).first();
  if (!(await row.waitFor({ timeout: WAIT_MS }).then(() => true, () => false))) return broken(`the face drew no row for the route's "${PROPOSAL.title}"`);
  await row.locator("button[aria-controls]").first().click({ timeout: WAIT_MS });
  await row.locator('[data-proposal-press="promote"]').click({ timeout: WAIT_MS });
  const dialog = page.locator('[data-proposal-dialog="promote"]').first();
  if (!(await dialog.waitFor({ timeout: WAIT_MS }).then(() => true, () => false))) return broken("Promote to the roadmap opened no promote dialog");

  if (!(await until(page, () => roadmapAnswers >= 1))) return broken("the promote dialog opened and never read /api/roadmap");
  const retry = dialog.getByRole("button", { name: "Try again" }).first();
  if (!(await retry.waitFor({ timeout: WAIT_MS }).then(() => true, () => false))) {
    const said = ((await dialog.textContent()) ?? "").replace(/\s+/g, " ").slice(0, 200);
    return broken(`the roadmap answered { error: "the roadmap has not been read yet" } and the dialog offers no Try again; it says: ${said}`);
  }
  if (((await dialog.textContent()) ?? "").includes("No roadmap has an epic yet")) return broken("a roadmap not read yet is said as one with no epic");
  const beforeRetry = roadmapAnswers;
  pictureNow = true;
  await retry.click();
  if (!(await until(page, () => roadmapAnswers > beforeRetry))) return broken("Try again read /api/roadmap no second time");

  const trigger = dialog.locator('button.vv-select__trigger[aria-label="Epic"]').first();
  if (!(await trigger.waitFor({ timeout: WAIT_MS }).then(() => true, () => false))) return broken("with the roadmap's picture answered the dialog draws no Epic list");
  await trigger.click();
  const list = page.locator('[role="listbox"][aria-label="Epic"]').first();
  await list.waitFor({ timeout: WAIT_MS });
  const offered = await list.locator('[role="option"]').allTextContents();
  const titles = offered.map((text) => IN_ORDER.find((title) => text.includes(title)) ?? `«${text.trim()}»`);
  if (titles.join(" | ") !== IN_ORDER.join(" | ")) return broken(`the Epic list offers ${titles.join(" | ")}, not the roadmap's ${IN_ORDER.join(" | ")}`);
  const stale = await standInIn(list);
  if (stale.length > 0) return broken(`the Epic list still offers the stand-in's epics: ${stale.join(" | ")}`);

  await list.locator('[role="option"]').filter({ hasText: "Alpha epic of the case" }).first().click();
  const confirm = dialog.getByRole("button", { name: /^\s*Promote\s*$/ }).last();
  await confirm.click({ timeout: WAIT_MS });
  await page.waitForTimeout(200);
  await confirm.click({ force: true, timeout: 1000 }).catch(() => {});
  await page.waitForTimeout(1500 + QUIET_MS);
  const posted = promotes.filter((r) => r.method === "POST");
  if (posted.length !== 1) return broken(`two presses of Promote sent ${posted.length} promote requests, not one: ${JSON.stringify(posted)}`);
  if (!posted[0].path.endsWith(`/proposals/${PROPOSAL.id}/promote`)) return broken(`Promote posted ${posted[0].path}, not /proposals/${PROPOSAL.id}/promote`);
  if (posted[0].body?.arc !== "case-epic-alpha") return broken(`Promote posted ${JSON.stringify(posted[0].body)}, not { arc: "case-epic-alpha" }`);

  return held(`not-read-yet said with Try again; the list offered ${IN_ORDER.length} epics in the roadmap's order; one promote posted { arc: "case-epic-alpha" }`);
});
