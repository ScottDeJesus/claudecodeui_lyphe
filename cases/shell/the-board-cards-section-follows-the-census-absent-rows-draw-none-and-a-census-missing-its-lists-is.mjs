// protects: src/modules/agent-launch/AgentLaunchPanel.tsx, src/modules/agent-launch/hooks/useAgentLaunch.ts
// writes: none
//
// The Board cards section of Edit Agent Chains is drawn from the census and from nothing else. A census with no
// `sorter` or `tweak` row (a CLI older than the card line) draws the souls and no Board cards section: no stand-in rows.
// A census whose choices lack `tweak_models` (or `sorter_models`) is not a census the panel can draw, because the
// rows map those lists: the panel says the table could not be read and offers its retry, never a blank window.
//
// The census is the running server's, read only and reshaped by the page (lib/agents_settings.mjs). Nothing is written.

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { answerLaunchTable, CARDS_SECTION, LAUNCH_PANEL, openAgentChains, openAgents } from "../lib/agents_settings.mjs";

const WAYS = [
  {
    what: "a census with no sorter or tweak row",
    census: (c) => ({ ...c, rows: c.rows.filter((row) => row.kind !== "sorter" && row.kind !== "tweak") }),
  },
  {
    what: "a census whose choices lack tweak_models",
    census: (c) => {
      const { tweak_models: _gone, ...choices } = c.choices;
      return { ...c, choices };
    },
  },
];

runCase(async (t) => {
  const page = await withPage(t);
  let way = 0;
  const { requests } = await answerLaunchTable(page, { census: (c) => WAYS[way].census(c) });
  const said = [];

  for (way = 0; way < WAYS.length; way += 1) {
    if (way > 0) await page.reload({ waitUntil: "domcontentloaded" });
    await openAgents(page);
    await openAgentChains(page);
    const state = await page.locator(LAUNCH_PANEL).first().getAttribute("data-agent-state");
    const cards = await page.locator(CARDS_SECTION).count();
    const souls = await page.locator('[data-agent-section="agent-souls"]').count();
    if (way === 0) {
      if (state !== "ready") return broken(`over ${WAYS[0].what} the panel is ${state}, not ready`);
      if (souls !== 1) return broken(`over ${WAYS[0].what} the panel draws no souls`);
      if (cards !== 0) {
        const rows = await page.locator(`${CARDS_SECTION} [data-agent-row]`).evaluateAll((all) => all.map((r) => r.getAttribute("data-agent-row")));
        return broken(`over ${WAYS[0].what} the panel still draws a Board cards section, rows ${JSON.stringify(rows)}`);
      }
      said.push("no sorter or tweak row: souls drawn, no Board cards section");
    } else {
      if (state !== "unreadable" || (await page.locator("[data-agent-unreadable]").count()) !== 1) {
        return broken(`over ${WAYS[1].what} the panel is ${state} with ${cards} Board cards section(s), not the could-not-be-read card`);
      }
      said.push("no tweak_models: the could-not-be-read card with its retry");
    }
  }
  if (requests.length > 0) return broken(`opening the panel wrote ${JSON.stringify(requests)}`);
  return held(said.join("; "));
});
