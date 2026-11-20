// protects: src/modules/settings/hooks/useBugBoardSettings.ts, src/modules/settings/tabs/agents-settings/sections/content/RunnerBugBoardRow.tsx, src/shared/api.ts
// writes: none
//
// Picking a number in Cards walked at once writes that one number, `PUT /api/kanban-dispatch/settings` with `{ width }`
// and no threshold (a body that also carried the threshold would write back a number the operator did not touch), and
// the row then draws what the dispatcher read back off its file, not the number picked: the file is the truth.
//
// The dispatcher is the page's (lib/agents_settings.mjs): it reads width 1 and threshold 0.80, and answers the write
// with width 4, as a file another writer moved meanwhile would read back. Nothing reaches the dispatcher.

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { answerCardConfig, openAgents, until, WIDTH_ROW } from "../lib/agents_settings.mjs";

runCase(async (t) => {
  const page = await withPage(t);
  const { requests } = await answerCardConfig(page, {
    get: () => ({ status: 200, body: { width: 1, threshold: 0.8 } }),
    put: () => ({ status: 200, body: { width: 4, threshold: 0.8 } }),
  });
  await openAgents(page);
  const width = () => page.locator(WIDTH_ROW).first().getAttribute("data-runner-bug-board-width");
  if (!(await until(async () => (await width()) === "1"))) return broken(`the row read width ${await width()} where the dispatcher answered 1`);

  await page.locator(`${WIDTH_ROW} .vv-select__trigger`).first().click({ timeout: 10000 });
  await page.locator('[role="option"]', { hasText: /^\s*2 cards\s*$/ }).first().click({ timeout: 10000 });

  const writes = () => requests.filter((r) => r.method !== "GET");
  if (!(await until(async () => writes().length > 0))) return broken("picking 2 cards sent no write to /api/kanban-dispatch/settings");
  await page.waitForTimeout(1500); // a second write, had the pick sent one, has had time to go
  const sent = writes();
  if (sent.length !== 1) return broken(`picking 2 cards sent ${sent.length} writes: ${JSON.stringify(sent)}`);
  const [one] = sent;
  if (one.method !== "PUT" || JSON.stringify(one.body) !== JSON.stringify({ width: 2 })) {
    return broken(`picking 2 cards sent ${one.method} ${JSON.stringify(one.body)}, not PUT {"width":2}`);
  }
  if (!(await until(async () => (await width()) === "4"))) {
    return broken(`the dispatcher read back width 4 and the row still reads ${await width()}`);
  }
  return held('picking 2 cards sent one PUT {"width":2} and the row then drew the 4 read back');
});
