// Each answer to a proposed feature calls its own route and says what the dispatcher refused where it was asked
// (bug-hunters, seams 10 and 11, wired in phase 16). Promote posts /proposals/<id>/promote { arc }, Send back as a ticket
// posts /proposals/<id>/send-back, Dismiss posts /proposals/<id>/dismiss { reason }, and the proposal's Priority posts
// /proposals/<id>/priority { priority }. A 409 is the dispatcher's refusal: its question stays open and says the
// sentence the route carried (`{ error }`; its `REFUSED <verb>:` lead may be dropped, as the board's
// dispatcherAnswer.plainSentence drops it, so the reason's own words are what is looked for), and a priority, which
// asks no question, says it in the proposal's Opening. A 200 closes
// the question. Each question is answered twice here: first refused, then answered. Since the board's redraw to the design
// system (2026-11-20) a proposal is a mark on a ring and opens from it (lib/kanban_board.mjs's openProposal); its priority is
// the kit's segmented control.
//
// The board is lib/kanban_board.mjs's made-up board; the proposals, the roadmap and every act are answered by this
// case. Nothing reaches the dispatcher and nothing is written.
//
// protects: src/modules/kanban/proposed/ProposedFeatures.tsx, src/modules/kanban/proposed/ProposalOpening.tsx, src/modules/kanban/proposed/ProposalPromoteDialog.tsx, src/modules/kanban/proposed/ProposalDismissDialog.tsx
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { openBoard, openProposal } from "../lib/kanban_board.mjs";
import { PROPOSALS, PROPOSAL_ACT, ROADMAP, WAIT_MS, answer, json, proposal, tab, until, watch } from "../lib/bug_hunt_faces.mjs";

const P = proposal(11, "Case proposal: answer me four ways");
const PICTURE = {
  generated_at: "2026-11-18T12:00:00Z",
  roadmaps: [{ name: "case-road", title: "Case road", milestones: [{ name: "case-ms", title: "Case milestone", epics: [{ name: "case-epic-one", title: "The case's one epic", features: [] }] }] }],
  unplaced: { epics: [], features: [] },
};
// The reason's own words, after the lead a face may drop and past the first letter it may capitalise.
const REASON = {
  promote: "he epic case-epic-one is complete, so the case refuses it",
  "send-back": "he case refuses this send-back",
  dismiss: "he case refuses this dismissal",
  priority: "he case refuses this priority",
};
const SENTENCE = Object.fromEntries(Object.entries(REASON).map(([act, words]) => [act, `REFUSED bug proposal ${act}: t${words}`]));

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  await openBoard(page);
  await answer(page, PROPOSALS, () => json({ proposals: [P] }));
  await answer(page, ROADMAP, () => json(PICTURE));
  const acts = watch(page, PROPOSAL_ACT);
  const refuse = { promote: true, "send-back": true, dismiss: true, priority: true };
  await answer(page, PROPOSAL_ACT, (request) => {
    const act = new URL(request.url()).pathname.split("/").pop();
    if (refuse[act]) return json({ error: SENTENCE[act] }, 409);
    return json({ line: `${act.toUpperCase()} proposal ${P.id} — ${P.title}` });
  });
  const posted = (act) => acts.filter((r) => r.method === "POST" && r.path.endsWith(`/proposals/${P.id}/${act}`));

  await tab(page, "Proposed features").click({ timeout: WAIT_MS });
  await page.locator('[data-proposed-features] [role="radio"]').filter({ hasText: /^\s*All\s*$/ }).first().click({ timeout: WAIT_MS });
  const row = await openProposal(page, P.id).catch(() => null);
  if (row === null) return broken(`the face drew no mark that opens the route's "${P.title}"`);
  const press = (act) => row.locator(`[data-proposal-press="${act}"]`).first();
  const shows = (locator, words) => until(page, async () => ((await locator.textContent().catch(() => "")) ?? "").includes(words), 5000);
  const gone = (locator) => locator.waitFor({ state: "hidden", timeout: WAIT_MS }).then(() => true, () => false);

  // PROMOTE: refused, then answered.
  await press("promote").click({ timeout: WAIT_MS });
  const promoteDialog = page.locator('[data-proposal-dialog="promote"]').first();
  await promoteDialog.locator('button.vv-select__trigger[aria-label="Epic"]').first().click({ timeout: WAIT_MS });
  await page.locator('[role="listbox"][aria-label="Epic"] [role="option"]').filter({ hasText: "The case's one epic" }).first().click({ timeout: WAIT_MS });
  const promoteConfirm = promoteDialog.getByRole("button", { name: /^\s*Promote\s*$/ }).last();
  await promoteConfirm.click({ timeout: WAIT_MS });
  if (!(await until(page, () => posted("promote").length === 1))) return broken("Promote sent no POST /promote");
  if (posted("promote")[0].body?.arc !== "case-epic-one") return broken(`Promote posted ${JSON.stringify(posted("promote")[0].body)}, not { arc: "case-epic-one" }`);
  if (!(await shows(promoteDialog, REASON.promote))) return broken(`a 409 on promote did not keep its dialog open saying "${SENTENCE.promote}"`);
  refuse.promote = false;
  await promoteConfirm.click({ timeout: WAIT_MS });
  if (!(await gone(promoteDialog))) return broken("a 200 on promote left its dialog open");

  // SEND BACK: the yes-or-no question.
  await press("send-back").click({ timeout: WAIT_MS });
  const sendDialog = page.getByRole("dialog").filter({ hasText: "Send this back as a ticket?" }).first();
  await sendDialog.waitFor({ timeout: WAIT_MS });
  const sendConfirm = sendDialog.getByRole("button", { name: "Send back as a ticket" }).last();
  await sendConfirm.click({ timeout: WAIT_MS });
  if (!(await until(page, () => posted("send-back").length === 1))) return broken("Send back as a ticket sent no POST /send-back");
  if (!(await shows(sendDialog, REASON["send-back"]))) return broken(`a 409 on send-back did not keep its question open saying "${SENTENCE["send-back"]}"`);
  refuse["send-back"] = false;
  await sendConfirm.click({ timeout: WAIT_MS });
  if (!(await gone(sendDialog))) return broken("a 200 on send-back left its question open");

  // DISMISS: the reason is required, and is what is sent.
  await press("dismiss").click({ timeout: WAIT_MS });
  const dismissDialog = page.locator('[data-proposal-dialog="dismiss"]').first();
  await dismissDialog.locator("textarea").first().fill("The case's reason to dismiss");
  const dismissConfirm = dismissDialog.getByRole("button", { name: /^\s*Dismiss\s*$/ }).last();
  await dismissConfirm.click({ timeout: WAIT_MS });
  if (!(await until(page, () => posted("dismiss").length === 1))) return broken("Dismiss sent no POST /dismiss");
  if (posted("dismiss")[0].body?.reason !== "The case's reason to dismiss") return broken(`Dismiss posted ${JSON.stringify(posted("dismiss")[0].body)}, not the reason typed`);
  if (!(await shows(dismissDialog, REASON.dismiss))) return broken(`a 409 on dismiss did not keep its dialog open saying "${SENTENCE.dismiss}"`);
  refuse.dismiss = false;
  await dismissConfirm.click({ timeout: WAIT_MS });
  if (!(await gone(dismissDialog))) return broken("a 200 on dismiss left its dialog open");

  // PRIORITY: no question; a refusal is said in the proposal's Opening.
  await row.getByRole("radiogroup", { name: "Priority" }).getByRole("radio", { name: "High" }).first().click({ timeout: WAIT_MS });
  if (!(await until(page, () => posted("priority").length === 1))) return broken("setting Priority to High sent no POST /priority");
  if (posted("priority")[0].body?.priority !== "high") return broken(`Priority posted ${JSON.stringify(posted("priority")[0].body)}, not { priority: "high" }`);
  if (!(await shows(row, REASON.priority))) return broken(`a 409 on priority is not said in the proposal's Opening ("${SENTENCE.priority}")`);

  return held("promote { arc }, send-back, dismiss { reason } and priority { priority: high } each posted its route; each 409's sentence was said where it was asked and each 200 closed its question");
});
