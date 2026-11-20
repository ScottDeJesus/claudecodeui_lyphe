// protects: src/modules/agent-launch/AgentLaunchRowItem.tsx, src/modules/agent-launch/AgentLaunchPanel.tsx, src/modules/agent-launch/hooks/useAgentLaunch.ts, src/shared/agent-launch-types.ts, src/modules/i18n/locales/en/common.json
// writes: none
//
// Edit Agent Chains draws the launch table's five hunt rows (`kind: "hunt"`, `hunt.<kind>`, bug-hunters seams 2 and 11)
// as the tweak's row is drawn, with one more list: the soul that wears the hunt, offering `choices.hunt_souls`. The
// hunt's effort is never its row's (`souls.effort_for(soul, model)`), so it is said in words where the list would be,
// as the tweak's is, and those words name whose word it is. The tweak's own-pin sentence names Hephaestus, the one soul
// a tweak wears; a hunt row worn by another soul must not borrow it.
//
// The census is the running server's (`launch-table show`, read only), reshaped by the page so it cannot be mistaken for
// the shipped table: hunt.data is daedalus on sonnet at low, not its soul's pin; hunt.ui is iris on fable at her own pin.
// A census without hunt rows has them made from the tweak's. The lists are opened and closed; nothing is picked, and
// every write under /api/agent-launch/ is answered by the page (lib/agents_settings.mjs).

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { answerLaunchTable, LAUNCH_PANEL, openAgentChains, openAgents } from "../lib/agents_settings.mjs";

const KINDS = ["security", "behaviour", "ui", "data", "code"];
const SOULS = { security: "argus", behaviour: "athena", ui: "iris", data: "daedalus", code: "hephaestus" };
const HUNT_SOULS = ["argus", "athena", "daedalus", "hephaestus", "iris", "sherlock"];

function reshape(census) {
  const tweak = census.rows.find((row) => row.kind === "tweak") ?? census.rows[0];
  const made = Object.fromEntries(census.rows.filter((row) => row.kind === "hunt").map((row) => [row.name, row]));
  const hunt = (kind) => {
    const base = made[`hunt.${kind}`] ?? { ...tweak, kind: "hunt", name: `hunt.${kind}`, description: `The ${kind} bug hunter`, shim: null };
    const row = { ...base, kind: "hunt", soul: SOULS[kind], model: "opus", model_pinned: false, effort: "medium", effort_pinned: false };
    if (kind === "data") return { ...row, model: "sonnet", model_pinned: true, effort: "low", effort_pinned: false };
    if (kind === "ui") return { ...row, model: "fable", effort: "high", effort_pinned: true };
    return row;
  };
  const rows = [...census.rows.filter((row) => row.kind !== "hunt"), ...KINDS.map(hunt)];
  return { ...census, rows, choices: { ...census.choices, hunt_souls: HUNT_SOULS } };
}

const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  const { requests } = await answerLaunchTable(page, { census: reshape });
  await openAgents(page);
  await openAgentChains(page);
  const panel = page.locator(LAUNCH_PANEL).first();

  for (const kind of KINDS) {
    const name = `hunt.${kind}`;
    const row = panel.locator(`[data-agent-row="${name}"]`).first();
    if ((await row.count()) === 0) return broken(`Edit Agent Chains draws no row for ${name} over a census holding it`);
    await row.scrollIntoViewIfNeeded();
    const triggers = row.locator(".vv-select__trigger");
    const labels = await triggers.evaluateAll((all) => all.map((el) => el.getAttribute("aria-label") ?? ""));
    if (labels.some((l) => /effort/i.test(l))) return broken(`${name} offers an effort list (${JSON.stringify(labels)}); a hunt's effort is not its row's`);
    if (!labels.some((l) => /model/i.test(l))) return broken(`${name} draws no model list (its lists: ${JSON.stringify(labels)})`);
    const soulAt = labels.findIndex((l) => !/model|effort/i.test(l));
    if (soulAt < 0 || labels.length !== 2) return broken(`${name} draws ${labels.length} list(s) ${JSON.stringify(labels)}, not a soul list beside its model list`);
    const soulTrigger = triggers.nth(soulAt);
    const soulSaid = clean(await soulTrigger.textContent());
    if (!new RegExp(`\\b${SOULS[kind]}\\b`, "i").test(soulSaid)) return broken(`${name}'s soul list reads "${soulSaid}" where the census says ${SOULS[kind]}`);
    const words = clean(await row.textContent());
    if (SOULS[kind] !== "hephaestus" && /Hephaestus/.test(words)) return broken(`${name}, worn by ${SOULS[kind]}, says "${words.match(/[^.·]*Hephaestus[^.·]*/)?.[0]?.trim()}"`);
    if (kind === "data") {
      if (!/\blow\b/.test(words) || !/sonnet/i.test(words)) return broken(`hunt.data does not say its effort low and why (sonnet's default): "${words.slice(0, 200)}"`);
      await soulTrigger.click({ timeout: 10000 });
      const offered = (await page.getByRole("listbox").last().getByRole("option").allTextContents()).map((s) => clean(s).toLowerCase());
      await page.keyboard.press("Escape");
      const missing = HUNT_SOULS.filter((s) => !offered.some((o) => o.includes(s)));
      if (missing.length > 0 || offered.length < HUNT_SOULS.length) return broken(`hunt.data's soul list offers ${JSON.stringify(offered)}, not the census's hunt_souls ${JSON.stringify(HUNT_SOULS)}`);
    }
    if (kind === "ui" && !/\bhigh\b/.test(words)) return broken(`hunt.ui does not say its effort high: "${words.slice(0, 200)}"`);
  }
  await page.waitForTimeout(800);
  if (requests.length > 0) return broken(`reading the hunt rows wrote ${JSON.stringify(requests)}`);
  return held("five hunt rows, each a soul list reading its soul beside a model list and no effort list; hunt.data says low for sonnet, hunt.ui high, no row borrows Hephaestus's pin; no write");
});
