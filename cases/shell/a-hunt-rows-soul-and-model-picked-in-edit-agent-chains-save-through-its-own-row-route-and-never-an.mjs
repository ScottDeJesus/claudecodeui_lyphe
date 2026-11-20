// protects: src/modules/agent-launch/AgentLaunchPanel.tsx, src/modules/agent-launch/AgentLaunchRowItem.tsx, src/modules/agent-launch/hooks/useAgentLaunch.ts, src/modules/agent-launch/AgentLaunchChoice.tsx, src/shared/agent-launch-types.ts
// writes: none
//
// A hunt row's soul and model, picked in Edit Agent Chains, are saved through that row's own route,
// `PUT /api/agent-launch/rows/hunt.<kind>`, which the server hands to `launch-table set hunt.<kind> --soul --model`
// (bug-hunters phase 17). The soul goes as a word, the model as a word or `null` (Default: the pin cleared), and a hunt's
// effort is never sent: it is `souls.effort_for`'s answer and the CLI refuses `--effort` on a hunt row.
//
// The census is the running server's (`launch-table show`, read only) with hunt.data set to sherlock, model unpinned;
// every write is answered by the page with the census that write would leave (lib/agents_settings.mjs answerLaunchTable),
// so `launch-table set` never runs and the row must draw the answer.

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { answerLaunchTable, LAUNCH_PANEL, openAgentChains, openAgents, until } from "../lib/agents_settings.mjs";

const KINDS = ["security", "behaviour", "ui", "data", "code"];
const ROW = "hunt.data";

function reshape(census) {
  const tweak = census.rows.find((row) => row.kind === "tweak") ?? census.rows[0];
  const made = Object.fromEntries(census.rows.filter((row) => row.kind === "hunt").map((row) => [row.name, row]));
  const hunt = (kind) => made[`hunt.${kind}`] ?? { ...tweak, kind: "hunt", name: `hunt.${kind}`, soul: "athena", description: `The ${kind} bug hunter`, shim: null };
  const rows = [...census.rows.filter((row) => row.kind !== "hunt"), ...KINDS.map(hunt)].map((row) =>
    row.name === ROW ? { ...row, soul: "sherlock", model_pinned: false } : row);
  const souls = census.choices.hunt_souls ?? ["argus", "athena", "daedalus", "hephaestus", "iris", "sherlock"];
  return { ...census, rows, choices: { ...census.choices, hunt_souls: souls.includes("daedalus") ? souls : [...souls, "daedalus"] } };
}

// The census a write would leave: the hunt row takes the soul and the model the body names.
function afterWrite(name, body, census) {
  if (!census || !body || typeof body !== "object") return census;
  const rows = census.rows.map((row) => {
    if (row.name !== name) return row;
    const next = { ...row };
    if (typeof body.soul === "string") next.soul = body.soul;
    if (typeof body.model === "string") Object.assign(next, { model: body.model, model_pinned: true });
    if (body.model === null) next.model_pinned = false;
    return next;
  });
  return { ...census, rows };
}

const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  const { requests } = await answerLaunchTable(page, { census: reshape, afterWrite });
  await openAgents(page);
  await openAgentChains(page);
  const row = page.locator(`${LAUNCH_PANEL} [data-agent-row="${ROW}"]`).first();
  if ((await row.count()) === 0) return broken(`Edit Agent Chains draws no ${ROW} row over a census holding it`);
  await row.scrollIntoViewIfNeeded();
  const soulList = row.locator(`.vv-select__trigger[aria-label="${ROW} soul"]`).first();
  const modelList = row.locator(`.vv-select__trigger[aria-label="${ROW} model"]`).first();
  if ((await soulList.count()) === 0 || (await modelList.count()) === 0) return broken(`${ROW} draws no "${ROW} soul" and "${ROW} model" lists`);

  const pick = async (list, option) => {
    await list.click({ timeout: 10000 });
    await page.getByRole("listbox").last().getByRole("option", { name: option }).first().click({ timeout: 10000 });
  };
  const sentAfter = async (from) => until(async () => requests.length > from && requests.slice(from), 6000);

  let from = requests.length;
  await pick(soulList, /^daedalus$/i);
  const soulSent = await sentAfter(from);
  if (!soulSent) return broken(`picking daedalus in ${ROW}'s soul list sent no write`);
  const soulWant = { method: "PUT", path: `/api/agent-launch/rows/${ROW}`, body: { soul: "daedalus" } };
  if (soulSent.length !== 1 || JSON.stringify(soulSent[0]) !== JSON.stringify(soulWant)) return broken(`picking daedalus sent ${JSON.stringify(soulSent)}, not ${JSON.stringify(soulWant)}`);
  if (!(await until(async () => /daedalus/i.test(clean(await soulList.textContent())), 5000))) return broken(`after the answer ${ROW}'s soul list reads "${clean(await soulList.textContent())}", not daedalus`);

  from = requests.length;
  await pick(modelList, /^sonnet$/i);
  const modelSent = await sentAfter(from);
  if (!modelSent || modelSent.length !== 1 || JSON.stringify(modelSent[0].body) !== JSON.stringify({ model: "sonnet" })) {
    return broken(`picking sonnet in ${ROW}'s model list sent ${JSON.stringify(modelSent || [])}, not one { model: "sonnet" }`);
  }

  await page.waitForTimeout(400);
  from = requests.length;
  await pick(modelList, /^Default · /);
  const clearSent = await sentAfter(from);
  if (!clearSent || clearSent.length !== 1 || JSON.stringify(clearSent[0].body) !== JSON.stringify({ model: null })) {
    return broken(`picking Default in ${ROW}'s model list sent ${JSON.stringify(clearSent || [])}, not one { model: null }`);
  }

  await page.waitForTimeout(600);
  const stray = requests.filter((r) => r.path !== `/api/agent-launch/rows/${ROW}` || (r.body && Object.hasOwn(r.body, "effort")));
  if (stray.length > 0) return broken(`a write went elsewhere or carried an effort: ${JSON.stringify(stray)}`);
  return held(`${ROW}: { soul: "daedalus" }, then { model: "sonnet" }, then { model: null }, each one PUT of its own row; the row drew daedalus; no effort, no other row`);
});
