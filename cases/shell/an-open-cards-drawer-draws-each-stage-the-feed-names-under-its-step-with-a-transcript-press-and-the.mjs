// An open card's drawer draws the walk the dispatcher's feed names for it (`DispatcherPicture.cards`, matched by board id
// and card id): each sitting under the step it belongs to, by its soul's name — `diagnose` under the second step and
// `scenarios` under the third, for a bug or a change — the sitting still out (the feed's status `waiting`) saying
// Working, and each launched sitting offering a Transcript press, 44 px each way under a finger (INV-10275), whose
// press reads THAT launch's transcript (`/api/dispatch-souls/launches/<launch id>/transcript`). The Scenarios section
// lists the cases the walk left, each with its word (`broken` -> Broken).
//
// The board is lib/kanban_board.mjs's; the feed is lib/kanban_feed.mjs's. The launch ids are made up, so the
// transcript the server answers for one is "not found": the case reads that the press asked for the right launch, not
// what the transcript says. Read at 390x844. Nothing is written.
//
// protects: src/modules/kanban/hooks/useKanbanWalks.ts, src/modules/kanban/card-drawer/DrawerChecklist.tsx, src/modules/kanban/card-drawer/DrawerStepStages.tsx, src/modules/kanban/card-drawer/DrawerScenarios.tsx, src/modules/kanban/card-drawer/KanbanCardDrawer.tsx, src/modules/kanban/utils/walkModel.ts, src/modules/dispatcher/DispatcherFeed.tsx
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { CARDS, openBoard, openDrawer } from "../lib/kanban_board.mjs";
import { feedCards, stage, walk } from "../lib/kanban_feed.mjs";

const PHONE = { width: 390, height: 844 };
const FINGER_PX = 44;
const WAIT_MS = 15000;
const CARD = CARDS.change;
const CASE_NAME = "the-sweep-hint-names-an-absolute-path";
const LAUNCH = { diagnose: "case-launch-diagnose-0001", scenarios: "case-launch-scenarios-0001", builder: "case-launch-builder-0001" };
const STEPS = { diagnose: "Confirm the bug and find the root cause", scenarios: "Fix" }; // lib/kanban_board.mjs's 2nd and 3rd steps
const SOULS = { diagnose: "Asclepius", scenarios: "Athena", builder: "Hephaestus" };

const FEED = [
  walk({
    card: CARD.id, title: CARD.title, state: "walking", flow: "change",
    stages: [
      stage("diagnose", "asclepius", LAUNCH.diagnose, "done", "CHANGE"),
      stage("scenarios", "athena", LAUNCH.scenarios, "done"),
      stage("builder", "hephaestus", LAUNCH.builder, "waiting"),
    ],
    cases: [{ suite: "lyphecli", name: CASE_NAME, word: "broken" }],
  }),
];

runCase(async (t) => {
  const page = await withPage(t, { viewport: PHONE });
  await openBoard(page);
  const feed = await feedCards(page, FEED);
  await openBoard(page);
  const asked = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/dispatch-souls/launches/")) asked.push(new URL(request.url()).pathname);
  });

  // The card is a mark on its ring since the board's redraw to the design system (2026-11-20): it opens from the keyboard.
  const drawer = await openDrawer(page, CARD.id);
  await drawer.waitFor({ timeout: WAIT_MS });
  const rows = drawer.locator("[data-stage]");
  await rows.first().waitFor({ timeout: WAIT_MS }).catch(() => {});
  if ((await rows.count()) === 0) {
    const heard = feed.heard();
    return broken(`the drawer of "${CARD.title}" draws no sitting of the walk the feed names (feed answered: ${heard.seeds} seed read(s), ${heard.sockets} socket(s))`);
  }

  // Under which step each sitting is drawn: the step row that holds it.
  const placed = await drawer.evaluate((root) =>
    Object.fromEntries([...root.querySelectorAll("[data-stage]")].map((row) => [row.getAttribute("data-stage"), {
      step: row.closest("li:not([data-stage])")?.innerText ?? "",
      text: row.innerText,
    }])));
  for (const [name, step] of Object.entries(STEPS)) {
    const at = placed[name];
    if (!at) return broken(`the drawer draws no "${name}" sitting: it draws ${JSON.stringify(Object.keys(placed))}`);
    if (!at.step.includes(step)) return broken(`the "${name}" sitting is not drawn under the step "${step}": it stands under ${JSON.stringify(at.step.split("\n")[0])}`);
  }
  for (const [name, soul] of Object.entries(SOULS)) {
    if (!placed[name]?.text.includes(soul)) return broken(`the "${name}" sitting does not name its soul "${soul}": ${JSON.stringify(placed[name]?.text ?? null)}`);
  }
  if (!/\bWorking\b/.test(placed.builder.text)) return broken(`the builder's sitting, still out (status waiting), does not say Working: ${JSON.stringify(placed.builder.text)}`);

  const press = drawer.getByRole("button", { name: `Transcript of ${SOULS.diagnose}, diagnose` });
  if ((await press.count()) === 0) return broken(`the diagnose sitting offers no "Transcript of ${SOULS.diagnose}, diagnose" press`);
  await press.first().scrollIntoViewIfNeeded();
  const box = await press.first().boundingBox();
  if (!box || box.width < FINGER_PX - 0.5 || box.height < FINGER_PX - 0.5) {
    return broken(`the diagnose sitting's Transcript press is ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "not drawn"} at 390 wide, under ${FINGER_PX} px`);
  }

  const scenarios = drawer.locator("[data-drawer-scenarios]");
  const listed = (await scenarios.count()) > 0 ? await scenarios.first().innerText() : "";
  if (!/the sweep hint names an absolute path/i.test(listed) || !/\bBroken\b/.test(listed)) {
    return broken(`the Scenarios section does not list the walk's case with the word Broken: ${JSON.stringify(listed)}`);
  }

  await press.first().click();
  const want = `/api/dispatch-souls/launches/${LAUNCH.diagnose}/transcript`;
  for (let waited = 0; waited < WAIT_MS && !asked.includes(want); waited += 250) await page.waitForTimeout(250);
  if (!asked.includes(want)) return broken(`pressing the diagnose sitting's Transcript did not read ${want}: it asked ${JSON.stringify(asked)}`);

  return held(`diagnose under "${STEPS.diagnose}", scenarios under "${STEPS.scenarios}", the builder Working, a ${Math.round(box.width)}x${Math.round(box.height)} Transcript press that read ${LAUNCH.diagnose}, and the case listed Broken`);
});
