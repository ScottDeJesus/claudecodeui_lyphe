// protects: src/modules/gemini-spend/, server/modules/gemini-meter/gemini-meter.service.ts, server/modules/gemini-usage/, /opt/shadow-connector/core/gemini_features/summary.py, /opt/shadow-connector/config/parser_features/_gemini_features.py, /opt/shadow-connector/core/restorly_ai.py
// writes: none
//
// Read only: the running app's API -> Gemini view against both REAL doors. Every section's switches are counted on and
// off and set beside what the page's own read of that section's door served (the connector's projects for Restorly and
// shadow-connector, the meter's features for CloudCLI): the same number on and the same number off. Restorly's master-off
// mark is drawn exactly when the connector serves its master (restorly_ai) off. Counting, not order, so a sort of the rows
// is not judged here. No switch is pressed. A connector that is down is CANNOT RUN, never a finding.

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
  const drawn = await page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll("[data-gemini-section]")) {
      const switches = [...el.querySelectorAll('[role="switch"]')];
      const on = switches.filter((s) => s.getAttribute("aria-checked") === "true" || s.getAttribute("data-state") === "checked").length;
      out[el.getAttribute("data-gemini-section")] = { on, off: switches.length - on, masterOff: !!el.querySelector("[data-gemini-master-off]") || el.hasAttribute("data-gemini-master-off") };
    }
    return out;
  });
  const wrong = [];
  const said = [];
  const judge = (name, features, master) => {
    const want = { on: features.filter((f) => f.enabled === true).length, off: features.filter((f) => f.enabled === false).length };
    const got = drawn[name];
    if (!got) { wrong.push("no section " + name + " drawn (sections: " + Object.keys(drawn).join(", ") + ")"); return; }
    if (got.on !== want.on || got.off !== want.off) wrong.push(name + " draws " + got.on + " on / " + got.off + " off; its door served " + want.on + " on / " + want.off + " off");
    if (master) { const off = master.enabled === false; if (got.masterOff !== off) wrong.push(name + "'s master-off mark is " + (got.masterOff ? "drawn" : "absent") + " while the door serves " + master.key + " " + (off ? "off" : "on")); }
    said.push(name + " " + got.on + "/" + got.off);
  };
  for (const p of served.connector.body?.projects ?? []) judge(p.project, p.features ?? [], p.master);
  judge("cloudcli", served.meter.body?.features ?? [], null);
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("switches on/off agree with their doors: " + said.join(", "));
});
