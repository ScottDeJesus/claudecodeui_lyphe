// protects: src/modules/settings/tabs/agents-settings/sections/content/RunnerBugBoardRow.tsx, src/modules/settings/hooks/useBugBoardSettings.ts
// writes: none
//
// Settings → Agents draws the dispatcher's third card number beside the two it already drew: the days a To Do card
// waits before it is taken one priority higher (`age_days` in charters/cards.toml, 0 to 30). 0 turns ageing off, and
// the row says Off for it, never "0 days", which reads as "moves up at once" (bug-board-ways-in-and-dashboard, seam 11).
// An answer carrying the third number must still draw the other two as it did. Under a finger its control is a 44 px
// press (INV-10275).
//
// The read is answered by the page (lib/agents_settings.mjs): width 3, threshold 0.91, ageDays 0. Nothing reaches the
// dispatcher, and the case presses nothing that writes.

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { answerCardConfig, openAgents, THRESHOLD_ROW, until, WIDTH_ROW } from "../lib/agents_settings.mjs";

const LABEL = "Days before a waiting card moves up a priority";
const FINGER_PX = 43.5; // 44 px, less the half pixel a layout may round away
const CONTROL = 'button, input, select, [role="combobox"], [role="spinbutton"]';

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  const { requests } = await answerCardConfig(page, { get: () => ({ status: 200, body: { width: 3, threshold: 0.91, ageDays: 0 } }) });
  await openAgents(page);

  const drawn = await until(async () => {
    const w = await page.locator(WIDTH_ROW).first().getAttribute("data-runner-bug-board-width");
    const th = await page.locator(THRESHOLD_ROW).first().getAttribute("data-runner-bug-board-threshold");
    return w === "3" && th === "0.91" ? [w, th] : null;
  });
  if (!drawn) {
    const w = await page.locator(WIDTH_ROW).first().getAttribute("data-runner-bug-board-width");
    const th = await page.locator(THRESHOLD_ROW).first().getAttribute("data-runner-bug-board-threshold");
    return broken(`an answer carrying ageDays 0 draws width ${w} and threshold ${th}, not 3 and 0.91`);
  }

  const label = page.getByText(LABEL, { exact: true }).first();
  if ((await label.count()) === 0) return broken(`Settings → Agents draws no row named "${LABEL}"`);
  // The SettingRow's root: the nearest ancestor that also holds the control's slot.
  const row = label.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " justify-between ")][1]');
  const slot = row.locator(":scope > div").last();
  const said = await until(async () => {
    const text = ((await slot.textContent()) ?? "").replace(/\s+/g, " ").trim();
    const values = await slot.locator("input").evaluateAll((all) => all.map((i) => i.value));
    return /\bOff\b/.test(text) || values.some((v) => /^\s*Off\s*$/i.test(v)) ? { text, values } : null;
  });
  if (!said) {
    const text = ((await slot.textContent()) ?? "").replace(/\s+/g, " ").trim();
    const values = await slot.locator("input").evaluateAll((all) => all.map((i) => i.value));
    return broken(`with ageDays 0 the row's control says "${text}"${values.length ? ` (field ${values.join(", ")})` : ""}, not Off`);
  }
  if (/\b0\s*days?\b/i.test(said.text)) return broken(`with ageDays 0 the row's control says "${said.text}", a number of days beside Off`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await label.scrollIntoViewIfNeeded();
  const box = await slot.locator(CONTROL).first().boundingBox();
  if (!box || box.height < FINGER_PX) return broken(`at 390 wide the row's control is ${box ? Math.round(box.height) : "not"} px tall, under a finger's 44`);

  const writes = requests.filter((r) => r.method !== "GET");
  if (writes.length > 0) return broken(`reading the rows wrote ${writes.map((w) => JSON.stringify(w.body)).join(", ")}`);
  return held(`3 cards and 0.91 drawn; "${LABEL}" says "${said.text}" for 0; its control ${Math.round(box.height)} px at 390`);
});
