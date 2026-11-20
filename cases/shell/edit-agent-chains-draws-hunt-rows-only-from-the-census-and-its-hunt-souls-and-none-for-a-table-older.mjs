// protects: src/modules/agent-launch/AgentLaunchPanel.tsx, src/modules/agent-launch/hooks/useAgentLaunch.ts, src/modules/agent-launch/AgentLaunchRowItem.tsx, src/shared/agent-launch-types.ts
// writes: none
//
// Edit Agent Chains draws the bug hunts from the census alone (bug-hunters phase 17): the rows are the census's own
// `kind: "hunt"` rows, and each one's soul list is `choices.hunt_souls`, never a list written in the client. A launch
// table older than the hunts (no hunt row, no `hunt_souls`) draws no hunt section at all, and the panel still opens ready.
// Two openings of the window over the running server's census (`launch-table show`, read only), reshaped by the page:
// first with the hunts taken out, then with `hunt_souls` cut to three souls. Every write is answered by the page.

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { answerLaunchTable, LAUNCH_PANEL, openAgentChains, openAgents } from "../lib/agents_settings.mjs";

const THREE = ["argus", "sherlock", "hephaestus"];
const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();

function older(census) {
  const choices = { ...census.choices };
  delete choices.hunt_souls;
  return { ...census, rows: census.rows.filter((row) => row.kind !== "hunt" && !String(row.name).startsWith("hunt.")), choices };
}

function threeSouls(census) {
  const tweak = census.rows.find((row) => row.kind === "tweak") ?? census.rows[0];
  const hunts = census.rows.filter((row) => row.kind === "hunt");
  const rows = hunts.length > 0 ? census.rows : [...census.rows, { ...tweak, kind: "hunt", name: "hunt.code", soul: "hephaestus", description: "The code bug hunter", shim: null }];
  return { ...census, rows: rows.map((row) => (row.kind === "hunt" ? { ...row, soul: "sherlock" } : row)), choices: { ...census.choices, hunt_souls: THREE } };
}

async function opened(t, census) {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  const { requests } = await answerLaunchTable(page, { census });
  await openAgents(page);
  await openAgentChains(page);
  return { page, requests, panel: page.locator(LAUNCH_PANEL).first() };
}

runCase(async (t) => {
  const first = await opened(t, older);
  if ((await first.panel.getAttribute("data-agent-state")) !== "ready") return broken(`over a census older than the hunts the panel is "${await first.panel.getAttribute("data-agent-state")}", not ready`);
  const drawnRows = await first.panel.locator('[data-agent-row^="hunt."]').count();
  const section = await first.panel.locator('[data-agent-section="agent-hunts"]').count();
  if (drawnRows > 0 || section > 0) return broken(`a census with no hunt row and no hunt_souls draws ${drawnRows} hunt row(s) and ${section} hunt section(s): rows the table does not hold`);
  await first.page.close();

  const second = await opened(t, threeSouls);
  const rows = second.panel.locator('[data-agent-row^="hunt."]');
  const count = await rows.count();
  if (count === 0) return broken("a census holding hunt rows draws none");
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const name = await row.getAttribute("data-agent-row");
    await row.scrollIntoViewIfNeeded();
    const list = row.locator(`.vv-select__trigger[aria-label="${name} soul"]`).first();
    if ((await list.count()) === 0) return broken(`${name} draws no soul list`);
    await list.click({ timeout: 10000 });
    const offered = (await second.page.getByRole("listbox").last().getByRole("option").allTextContents()).map((s) => clean(s).toLowerCase());
    await second.page.keyboard.press("Escape");
    if (JSON.stringify([...offered].sort()) !== JSON.stringify([...THREE].sort())) return broken(`${name}'s soul list offers ${JSON.stringify(offered)}, not the census's hunt_souls ${JSON.stringify(THREE)}`);
  }
  const writes = [...first.requests, ...second.requests];
  if (writes.length > 0) return broken(`opening the lists wrote ${JSON.stringify(writes)}`);
  return held(`a census older than the hunts draws no hunt section and the panel is ready; over hunt_souls ${JSON.stringify(THREE)} each of ${count} hunt rows offers those three alone; no write`);
});
