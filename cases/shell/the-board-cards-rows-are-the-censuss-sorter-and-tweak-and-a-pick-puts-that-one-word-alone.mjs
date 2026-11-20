// protects: src/modules/agent-launch/AgentLaunchPanel.tsx, src/modules/agent-launch/hooks/useAgentLaunch.ts, src/modules/agent-launch/AgentLaunchRowItem.tsx, src/modules/agent-launch/AgentLaunchChoice.tsx
// writes: none
//
// Edit Agent Chains' Board cards section is the launch table's own `sorter` and `tweak` rows, as the census
// (`launch-table show`) prints them, with each row's model list from `choices.sorter_models` / `choices.tweak_models`.
// A pick writes through the agent-launch module's row door with that one word and nothing else: the tweak's model as
// `{ model }` (its effort is not its row's to set), the sorter's effort as `{ effort }`, and never a `null`, which
// the door reads as "clear this pin" and the table refuses for these two rows.
//
// The census is the running server's, read only and reshaped by the page (lib/agents_settings.mjs) so that it cannot
// be mistaken for the table's shipped words: the tweak rides opus, the sorter rides haiku, the sorter's list is haiku
// alone. Every write is answered by the page with the census it would read back; `launch-table set` never runs.

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { answerLaunchTable, CARDS_SECTION, openAgentChains, openAgents, until } from "../lib/agents_settings.mjs";

const TWEAK_SAYS = "CASE: the tweak row as this census holds it";

function reshape(census) {
  const rows = census.rows.map((row) => {
    if (row.kind === "tweak") return { ...row, model: "opus", description: TWEAK_SAYS };
    if (row.kind === "sorter") return { ...row, model: "haiku", effort: "low" };
    return row;
  });
  return { ...census, rows, choices: { ...census.choices, sorter_models: ["haiku"], tweak_models: ["opus", "fable", "sonnet"] } };
}

runCase(async (t) => {
  const page = await withPage(t);
  const { requests } = await answerLaunchTable(page, {
    census: reshape,
    afterWrite: (name, body, census) => ({ ...census, rows: census.rows.map((row) => (row.name === name ? { ...row, ...body } : row)) }),
  });
  await openAgents(page);
  await openAgentChains(page);

  const section = page.locator(CARDS_SECTION).first();
  if ((await section.count()) === 0) return broken("Edit Agent Chains draws no Board cards section over a census holding the sorter and the tweak");
  const said = (name) => section.locator(`.vv-select__trigger[aria-label="${name}"] > span`).first().textContent().then((s) => (s ?? "").trim(), () => "");
  const tweakModel = await said("tweak model");
  if (tweakModel !== "opus") return broken(`the tweak row's model reads "${tweakModel}" where the census says opus`);
  const tweakWords = (await section.locator('[data-agent-row="tweak"]').first().textContent()) ?? "";
  if (!tweakWords.includes(TWEAK_SAYS)) return broken("the tweak row does not carry the census's own description");
  const sorterModel = await said("sorter model");
  if (sorterModel !== "haiku") return broken(`the sorter row's model reads "${sorterModel}" where the census says haiku`);

  await section.locator('.vv-select__trigger[aria-label="sorter model"]').first().click({ timeout: 10000 });
  const offered = await page.getByRole("listbox", { name: "sorter model" }).getByRole("option").allTextContents();
  await page.keyboard.press("Escape");
  if (offered.map((s) => s.trim()).join(",") !== "haiku") return broken(`the sorter's model list offers ${JSON.stringify(offered)}, not the census's [haiku]`);

  const pick = async (list, word) => {
    await section.locator(`.vv-select__trigger[aria-label="${list}"]`).first().click({ timeout: 10000 });
    await page.getByRole("listbox", { name: list }).getByRole("option").filter({ hasText: new RegExp(`^\\s*${word}\\s*$`) }).first().click({ timeout: 10000 });
  };
  await pick("tweak model", "fable");
  if (!(await until(async () => requests.length > 0))) return broken("picking fable for the tweak sent no write");
  await page.waitForTimeout(1200);
  const tweakWrites = [...requests];
  if (tweakWrites.length !== 1 || tweakWrites[0].method !== "PUT" || tweakWrites[0].path !== "/api/agent-launch/rows/tweak"
    || JSON.stringify(tweakWrites[0].body) !== JSON.stringify({ model: "fable" })) {
    return broken(`picking fable for the tweak sent ${JSON.stringify(tweakWrites)}, not one PUT /api/agent-launch/rows/tweak {"model":"fable"}`);
  }
  if (!(await until(async () => (await said("tweak model")) === "fable"))) return broken(`after the write the tweak's model reads "${await said("tweak model")}", not the fable read back`);

  await pick("sorter effort", "medium");
  if (!(await until(async () => requests.length > 1))) return broken("picking medium for the sorter's effort sent no write");
  await page.waitForTimeout(1200);
  const sorterWrites = requests.slice(1);
  if (sorterWrites.length !== 1 || sorterWrites[0].method !== "PUT" || sorterWrites[0].path !== "/api/agent-launch/rows/sorter"
    || JSON.stringify(sorterWrites[0].body) !== JSON.stringify({ effort: "medium" })) {
    return broken(`picking medium for the sorter's effort sent ${JSON.stringify(sorterWrites)}, not one PUT /api/agent-launch/rows/sorter {"effort":"medium"}`);
  }
  return held('the census\'s tweak (opus) and sorter (haiku, list [haiku]) drawn; fable sent PUT rows/tweak {"model":"fable"} and drew fable; medium sent PUT rows/sorter {"effort":"medium"}');
});
