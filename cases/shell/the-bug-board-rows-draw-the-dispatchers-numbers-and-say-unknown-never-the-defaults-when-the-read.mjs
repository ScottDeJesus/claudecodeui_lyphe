// protects: src/modules/settings/hooks/useBugBoardSettings.ts, src/modules/settings/tabs/agents-settings/sections/content/RunnerBugBoardRow.tsx
// writes: none
//
// Settings → Agents draws the dispatcher's two card numbers as `GET /api/kanban-dispatch/settings` answers them, and
// says it does not know them when that read fails or answers numbers outside their bounds: never the shipped 1 and
// 0.80, which are numbers a reader would believe. Try again reads once more.
//
// The read is answered by the page (lib/agents_settings.mjs): first a 502, then a width of 9 (outside 1-4), then
// width 3 and threshold 0.91, the press of each row's Try again moving it on. Nothing reaches the dispatcher.

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { answerCardConfig, openAgents, THRESHOLD_FIELD, THRESHOLD_ROW, until, WIDTH_ROW } from "../lib/agents_settings.mjs";

const ANSWERS = [
  { status: 502, body: { error: "dispatcher card config did not answer: the case said so" } },
  { status: 200, body: { width: 9, threshold: 0.8 } },
  { status: 200, body: { width: 3, threshold: 0.91 } },
];

runCase(async (t) => {
  const page = await withPage(t);
  let step = 0;
  const { requests } = await answerCardConfig(page, { get: () => ANSWERS[step] });
  const gets = () => requests.filter((r) => r.method === "GET").length;
  await openAgents(page);

  const attrs = () => page.evaluate(([w, th]) => [
    document.querySelector(w)?.getAttribute("data-runner-bug-board-width"),
    document.querySelector(th)?.getAttribute("data-runner-bug-board-threshold"),
  ], [WIDTH_ROW, THRESHOLD_ROW]);
  const retry = page.locator(`${WIDTH_ROW} button:not(.vv-select__trigger)`).first();
  const said = [];

  for (const [at, what] of [[0, "a 502"], [1, "a width of 9"]]) {
    step = at;
    const before = gets();
    if (at > 0) await retry.click({ timeout: 10000 });
    const asked = await until(async () => gets() > before || (at === 0 && gets() > 0));
    if (!asked) return broken(`${at === 0 ? "opening Settings → Agents" : "pressing Try again"} sent no GET /api/kanban-dispatch/settings`);
    await page.waitForTimeout(1200); // the answer is in hand: what the rows draw now is what they made of it
    const unknown = await until(async () => {
      const [w, th] = await attrs();
      const words = (await page.locator(WIDTH_ROW).first().textContent()) ?? "";
      return w === "unknown" && th === "unknown" && /could not be read/i.test(words) ? true : null;
    });
    if (!unknown) {
      const [w, th] = await attrs();
      return broken(`after ${what} the rows read width ${w} and threshold ${th}, not unknown`);
    }
    if ((await retry.count()) === 0) return broken(`after ${what} the Cards walked at once row offers no Try again`);
    const words = (await page.locator(WIDTH_ROW).first().textContent()) ?? "";
    if (!/could not be read/i.test(words)) return broken(`after ${what} the width row does not say its value could not be read: "${words.slice(0, 160)}"`);
    said.push(`${what}: unknown, with Try again`);
  }

  step = 2;
  await retry.click({ timeout: 10000 });
  const good = await until(async () => {
    const [w, th] = await attrs();
    return w === "3" && th === "0.91" ? true : null;
  });
  const [w, th] = await attrs();
  if (!good) return broken(`after width 3 and threshold 0.91 were answered and Try again pressed, the rows read width ${w} and threshold ${th}`);
  const field = await page.locator(THRESHOLD_FIELD).inputValue();
  if (field !== "0.91") return broken(`the confidence field reads "${field}", not 0.91`);
  const select = ((await page.locator(`${WIDTH_ROW} .vv-select__trigger > span`).first().textContent()) ?? "").trim();
  if (!/^3 cards$/.test(select)) return broken(`the width list reads "${select}", not 3 cards`);
  return held(`${said.join("; ")}; then 3 cards and 0.91 drawn after Try again`);
});
