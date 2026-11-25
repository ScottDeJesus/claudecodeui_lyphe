// protects: src/modules/gemini-spend/, src/modules/api-tab/ApiPanel.tsx, src/shared/api.ts, server/modules/gemini-usage/, server/modules/gemini-meter/, server/index.ts, /opt/shadow-connector/core/gemini_features/summary.py, /opt/shadow-connector/core/gemini_features/routes.py
// writes: none
//
// The whole crossing, read only: the running app's API -> Gemini view against both REAL doors (no answer stood in), as
// the operator opens it. The page's own reads are watched, and what it draws is judged against what those reads got:
// one section per project the connector's usage answer lists, plus CloudCLI's; no door-down place; one row per feature
// in each section; every budget's name under Builds and sessions; every key tail and every process either answer carries
// under By key and by process. No switch is pressed. A connector that is down is CANNOT RUN, never a finding.

import { api, withPage } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CONNECTOR = "/api/gemini-usage/usage";
const METER = "/api/gemini-meter/usage";

/** The signed-in app on the API tab's Gemini view, with the last answer the page itself got from each door. */
async function openGeminiTab(t) {
  const probe = await api(CONNECTOR + "?range=today");
  if (probe.status >= 500 && probe.json && Object.keys(probe.json).join(",") === "error") {
    return { cannot: "the lane could not reach shadow-connector (" + probe.status + " " + probe.json.error + ") — the connector is down, never a finding" };
  }
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  const served = { connector: null, meter: null };
  page.on("response", async (response) => {
    const url = response.url();
    const door = url.includes(CONNECTOR) ? "connector" : url.includes(METER) ? "meter" : null;
    if (!door || response.request().method() !== "GET") return;
    try { served[door] = { status: response.status(), body: await response.json() }; } catch { served[door] = { status: response.status(), body: null }; }
  });
  await page.evaluate(() => { try { localStorage.setItem("apiSubTab", "gemini"); } catch {} });
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menu", { name: "Places" }).getByRole("menuitem", { name: "API" }).click();
  const until = Date.now() + 20000;
  for (;;) {
    const drawn = await page.evaluate(() => !document.querySelector("[data-gemini-reading]") && !!document.querySelector('[data-gemini-section="cloudcli"]'));
    if (drawn && served.connector && served.meter) break;
    if (Date.now() > until) return { page, served, error: "the Gemini view did not draw CloudCLI's section with both doors read within 20 s of opening API (connector " + (served.connector?.status ?? "unread") + ", meter " + (served.meter?.status ?? "unread") + ")" };
    await sleep(250);
  }
  await sleep(500);
  return { page, served };
}

runCase(async (t) => {
  const tab = await openGeminiTab(t);
  if (tab.cannot) return cannotRun(tab.cannot);
  if (tab.error) return broken(tab.error);
  const { page, served } = tab;
  if (served.connector.status !== 200 || served.meter.status !== 200) return broken("the page's reads answered connector " + served.connector.status + ", meter " + served.meter.status + ", not 200 both");
  const connector = served.connector.body ?? {};
  const meter = served.meter.body ?? {};
  const drawn = await page.evaluate(() => {
    const sections = {};
    for (const el of document.querySelectorAll("[data-gemini-section]")) {
      sections[el.getAttribute("data-gemini-section")] = { rows: el.querySelectorAll("[data-gemini-row]").length, down: el.hasAttribute("data-gemini-door-down"), text: el.textContent ?? "" };
    }
    return { sections, keys: document.querySelector("[data-gemini-keys]")?.textContent ?? null, processes: document.querySelector("[data-gemini-processes]")?.textContent ?? null, down: document.querySelectorAll("[data-gemini-door-down]").length };
  });
  const wrong = [];
  if (drawn.down > 0) wrong.push(drawn.down + " door-down place(s) drawn though both reads answered 200");
  const projects = Array.isArray(connector.projects) ? connector.projects : [];
  if (projects.length === 0) wrong.push("the connector's answer listed no project");
  for (const p of projects) {
    const s = drawn.sections[p.project];
    if (!s) { wrong.push("no section for the connector's project " + JSON.stringify(p.project) + " (sections drawn: " + Object.keys(drawn.sections).join(", ") + ")"); continue; }
    const n = Array.isArray(p.features) ? p.features.length : 0;
    if (s.rows !== n) wrong.push(p.project + " draws " + s.rows + " rows for the " + n + " features its door served");
  }
  const cloud = drawn.sections.cloudcli;
  const meterFeatures = Array.isArray(meter.features) ? meter.features.length : 0;
  if (!cloud) wrong.push("no CloudCLI section");
  else if (cloud.rows !== meterFeatures) wrong.push("CloudCLI draws " + cloud.rows + " rows for the " + meterFeatures + " features the meter served");
  const budgets = drawn.sections.budgets;
  const budgetNames = (connector.budgets ?? []).map((b) => b.budget);
  if (budgetNames.length > 0 && !budgets) wrong.push("no Builds and sessions section for " + budgetNames.length + " budgets");
  else if (budgets) { const missing = budgetNames.filter((b) => !budgets.text.includes(b)); if (missing.length) wrong.push("Builds and sessions leaves out " + missing.slice(0, 4).join(", ")); }
  const tails = [...(connector.keys ?? []), ...(meter.keys ?? [])].map((k) => k.key);
  if (drawn.keys === null) wrong.push("no key list drawn");
  else { const missing = tails.filter((k) => !drawn.keys.includes(k)); if (missing.length) wrong.push("the key list leaves out tail(s) " + missing.join(", ")); }
  const processes = (connector.processes ?? []).map((p) => p.process);
  if (processes.length > 0 && drawn.processes === null) wrong.push("no process list drawn for " + processes.length + " processes");
  else if (drawn.processes !== null) { const missing = processes.filter((p) => !drawn.processes.includes(p)); if (missing.length) wrong.push("the process list leaves out " + missing.slice(0, 3).join(", ")); }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("range " + connector.range + ": sections " + Object.keys(drawn.sections).join(",") + "; rows " + projects.map((p) => p.project + "=" + p.features.length).join(" ") + " cloudcli=" + meterFeatures + "; " + budgetNames.length + " budgets, " + tails.length + " key tails, " + processes.length + " processes all drawn");
});
