// protects: src/modules/settings/hooks/useBugBoardSettings.ts, src/modules/settings/tabs/agents-settings/sections/content/RunnerBugBoardRow.tsx, src/shared/api.ts
// writes: none
//
// Picking a number in "Days before a waiting card moves up a priority" writes that one number,
// `PUT /api/kanban-dispatch/settings` with `{ ageDays }` and neither width nor threshold (a body that carried them would
// write back numbers the operator did not touch), and the row then draws what the dispatcher read back off its file,
// not the number picked: the file is the truth (bug-board-ways-in-and-dashboard, seam 11's fill of `setAgeDays`).
//
// The dispatcher is the page's (lib/agents_settings.mjs): it reads width 1, threshold 0.80 and ageDays 3, and answers
// the write with ageDays 9, as a file another writer moved meanwhile would read back. Nothing reaches the dispatcher.

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { answerCardConfig, openAgents, until } from "../lib/agents_settings.mjs";

const AGE_ROW = "[data-runner-bug-board-age-days]";

runCase(async (t) => {
  const page = await withPage(t);
  const { requests } = await answerCardConfig(page, {
    get: () => ({ status: 200, body: { width: 1, threshold: 0.8, ageDays: 3 } }),
    put: () => ({ status: 200, body: { width: 1, threshold: 0.8, ageDays: 9 } }),
  });
  await openAgents(page);
  const ageDays = () => page.locator(AGE_ROW).first().getAttribute("data-runner-bug-board-age-days");
  if (!(await until(async () => (await ageDays()) === "3"))) return broken(`the row read ageDays ${await ageDays()} where the dispatcher answered 3`);

  await page.locator(`${AGE_ROW} .vv-select__trigger`).first().click({ timeout: 10000 });
  await page.locator('[role="option"]', { hasText: /^\s*5 days\s*$/ }).first().click({ timeout: 10000 });

  const writes = () => requests.filter((r) => r.method !== "GET");
  if (!(await until(async () => writes().length > 0))) return broken("picking 5 days sent no write to /api/kanban-dispatch/settings");
  await page.waitForTimeout(1500); // a second write, had the pick sent one, has had time to go
  const sent = writes();
  if (sent.length !== 1) return broken(`picking 5 days sent ${sent.length} writes: ${JSON.stringify(sent)}`);
  const [one] = sent;
  if (one.method !== "PUT" || JSON.stringify(one.body) !== JSON.stringify({ ageDays: 5 })) {
    return broken(`picking 5 days sent ${one.method} ${JSON.stringify(one.body)}, not PUT {"ageDays":5}`);
  }
  if (!(await until(async () => (await ageDays()) === "9"))) {
    return broken(`the dispatcher read back ageDays 9 and the row still reads ${await ageDays()}`);
  }
  return held('picking 5 days sent one PUT {"ageDays":5} and the row then drew the 9 read back');
});
