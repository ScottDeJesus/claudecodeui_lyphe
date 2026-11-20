// Dismissing a proposed feature needs a reason (bug-hunters, seam 11, scaffolded in phase 14): an open proposal's
// Dismiss opens the kit's Dialog with a TextArea for the reason, and the reason is required. While it is empty the
// dialog's own Dismiss press is disabled — or, pressed, the dialog stays open and no dismiss request leaves the page.
// Once a reason is typed the press is enabled. The case closes the dialog with Escape and never confirms.
//
// The row comes from the proposals route, which this case answers with one open proposal of the route's shape. The
// panel reads that route once at its mount, inside openBoard and before this case's answer is registered, so when the
// face says it was not answered the case presses its own Try again, a read. The board is lib/kanban_board.mjs's
// made-up board, every board request answered by the page; nothing reaches the server and nothing is written.
//
// protects: src/modules/kanban/proposed/ProposalDismissDialog.tsx, src/modules/kanban/proposed/ProposalRow.tsx, src/modules/kanban/proposed/ProposedFeatures.tsx, src/modules/kanban/KanbanPanel.tsx
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { BOARD, openBoard } from "../lib/kanban_board.mjs";

const WAIT_MS = 15000;
const PROPOSALS = /\/api\/kanban-dispatch\/proposals(\?|$)/;
const DISMISS = /\/api\/kanban-dispatch\/proposals\/[^/]+\/dismiss$/;
const AT = "2026-11-18T12:00:00.000Z";
const ANSWER = { proposals: [{
  id: 1, path: BOARD.repos[0], title: "Split the store's writer", words: "The store has two writers.", kind: "too-big",
  priority: "medium", state: "open", hunt: "code", source: "hunter", proposed_at: AT, ended_at: null, feature: null,
  reason: null, findings: [], stopgaps: [], sent_back: null, boardName: BOARD.name,
}] };

const settle = (page) => page.waitForTimeout(500);

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  await openBoard(page);
  const dismissals = [];
  await page.route(DISMISS, (route) => { dismissals.push(route.request().method()); return route.fulfill({ status: 200, contentType: "application/json", body: "{}" }); });
  await page.route(PROPOSALS, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ANSWER) }));

  // Found by its name (the kit's Tabs gives each tab its label as `aria-label`), never by its text: the count pill is
  // drawn straight after the label, so the text is "Proposed features1".
  const proposed = page.locator('[data-kanban-panel] [role="tab"][aria-label="Proposed features"]').first();
  if ((await proposed.count()) === 0) return broken("the Bugs view draws no Proposed features tab");
  await proposed.click();
  await settle(page);
  const unread = page.locator('[data-proposed-features="unreachable"]').first();
  if (await unread.isVisible().catch(() => false)) {
    await unread.getByRole("button").first().click({ timeout: 15000 });
    await page.locator('[data-proposed-features="ready"]').first().waitFor({ timeout: 15000 }).catch(() => {});
  }

  const panel = page.locator("[data-kanban-panel]");
  const press = panel.getByRole("button", { name: /^\s*Dismiss\s*$/ }).first();
  if (!(await press.isVisible().catch(() => false))) {
    // The presses may sit inside the row's Collapsible: open the first collapsed row and look again.
    await panel.locator('[aria-expanded="false"]:not([aria-haspopup]):not([role="combobox"]):not([role="tab"])').first().click({ timeout: WAIT_MS }).catch(() => {});
    await settle(page);
  }
  if (!(await press.isVisible().catch(() => false))) return broken("no open proposal on the face offers a Dismiss press");
  await press.click();

  const dialog = page.getByRole("dialog").filter({ has: page.locator("textarea") }).first();
  if (!(await dialog.waitFor({ timeout: WAIT_MS }).then(() => true, () => false))) return broken("pressing Dismiss opens no dialog with a reason field");
  const reason = dialog.locator("textarea").first();
  const confirm = dialog.getByRole("button", { name: /dismiss/i }).last();
  if ((await confirm.count()) === 0) return broken("the dismiss dialog has no Dismiss press to confirm with");
  await reason.fill("");

  if (await confirm.isEnabled()) {
    await confirm.click();
    await settle(page);
    if (!(await dialog.isVisible().catch(() => false))) return broken("with no reason typed, pressing Dismiss closed the dialog: the reason is not required");
    if (dismissals.length > 0) return broken("with no reason typed, pressing Dismiss sent a dismiss request");
  }

  await reason.fill("A duplicate of the store rework already on the roadmap.");
  await settle(page);
  if (!(await confirm.isEnabled())) return broken("with a reason typed, the dialog's Dismiss press is still disabled");
  await page.keyboard.press("Escape");
  await settle(page);
  if (dismissals.length > 0) return broken(`the case never confirmed, yet ${dismissals.length} dismiss request(s) left the page`);
  return held("Dismiss opens a dialog with a reason field; empty, its Dismiss press confirms nothing; with a reason it is enabled");
});
