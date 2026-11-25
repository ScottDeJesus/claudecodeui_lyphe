// gemini_panel.mjs — the API tab's Gemini view (src/modules/gemini-spend/) mounted in the running app's page, both of its
// doors answered by the case, for cases/shell/.
//
//   import { geminiPanel, sleep, until, CONNECTOR_TOTAL, METER_TOTAL } from "../lib/gemini_panel.mjs";
//   const panel = await geminiPanel(t, { serve? });   // { cannot } or { error } when the view would not mount
//   panel.asked                                       // every usage read the page sent: { door: "connector" | "meter", range }
//   panel.puts                                        // every switch press the page sent: { door, feature, method, body }
//   panel.serve.connector = (range) => ({ status, body })   // how a door's read is answered (panel.defaults: 200, a canned body)
//   panel.serve.put = (put) => ({ status, body })     // how a press is answered (default: the state written, read back)
//   panel.putDelayMs = 2500                           // every press's answer held this long
//   await panel.drawn()                               // both doors' places drawn (no first-read spinner)
//   await panel.switches("cloudcli")                  // [{ checked, disabled }] of a section's switches, in the door's order
//   await panel.press("cloudcli", 1)                  // one press on that switch
//   await panel.downAt("connector")                   // the words of that door's down place, or null
//   await panel.visible()                             // the page hidden, then visible again, as a returning tab sets them
//   await panel.window("today")                       // a press on the window control
//   await panel.text() / await panel.usd(3.11)        // what the view says; the view's own words for a dollar figure
//
// NOTHING REAL IS READ OR WRITTEN: every GET and PUT of /api/gemini-usage and /api/gemini-meter the page sends is answered
// here, so no switch moves at the connector or the meter. The view is the real one, imported through the running Vite
// server and mounted under the page's own React, in a host of the case's own laid over the app. hookEdits
// ([RegExp, replacement] pairs) mount the view over a rewritten copy of useGeminiUsage.ts: a copy of a case passes them to
// show the case can fail.

import fs from "node:fs";

import { withPage } from "./app.mjs";

const PANEL_FILE = "/src/modules/gemini-spend/GeminiUsagePanel.tsx";
const HOOK = "/src/modules/gemini-spend/useGeminiUsage.ts";
const FIGURES = "/src/modules/gemini-spend/geminiFigures.ts";
const ENTRY = "/src/main.tsx";
const READS = /\/api\/gemini-(usage|meter)\/usage(\?|$)/;
const PRESSES = /\/api\/gemini-(usage|meter)\/switches\//;
const WORDS = JSON.parse(fs.readFileSync(new URL("../../src/modules/i18n/locales/en/common.json", import.meta.url), "utf8"));

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(check, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) return null;
    await sleep(150);
  }
}

/** The connector's total and CloudCLI's, so the sum (3.53) is a figure no section draws. */
export const CONNECTOR_TOTAL = 3.11;
export const METER_TOTAL = 0.42;
/** [project, feature, label, dollars]: one feature under Restorly, one under shadow-connector. */
export const CONNECTOR_FEATURES = [
  ["restorly", "case_restorly_feature", "Case Restorly Feature", 1.37],
  ["shadowconnector", "case_connector_feature", "Case Connector Feature", 1.74],
];
/** CloudCLI's three, in the meter's order. */
export const METER_FEATURES = [
  ["companion_speech", "Case Companion Speech"],
  ["read_aloud", "Case Read Aloud"],
  ["backup_transcription", "Case Backup Transcription"],
];

const day = () => new Date().toISOString().slice(0, 10);
const row = (feature, label, enabled, cost) => ({
  feature, label, enabled, calls: 2, failures: 0, unmeasured_calls: 0, input_tokens: 120, output_tokens: 40,
  cost_usd: cost, models: ["gemini-2.5-flash"], last_at: new Date().toISOString(),
});

function connectorBody(range, on) {
  return {
    account_id: "case-account", range, from: day(), to: day(), cost_basis: "list prices, an estimate",
    total_usd: CONNECTOR_TOTAL, production_usd: 2.82, budgets_usd: 0.29,
    projects: CONNECTOR_FEATURES.map(([project, feature, label, cost]) => ({
      project, master: project === "restorly" ? { key: "restorly_ai", enabled: true } : null, cost_usd: cost, calls: 2,
      features: [row(feature, label, on[feature], cost)],
    })),
    days: [{ date: day(), production_usd: 2.82, budgets_usd: 0.29 }],
    budgets: [{ budget: "case-plan", calls: 1, cost_usd: 0.29, last_at: new Date().toISOString() }],
    keys: [{ key: "Ab12", held_as: ["GEMINI_API_KEY"], calls: 4, cost_usd: 2.82 }],
    processes: [{ process: "shadow-connector.service", calls: 4, cost_usd: 2.82 }],
    unpriced_models: [],
  };
}

function meterBody(range, on) {
  return {
    range, from: day(), to: day(), cost_basis: "list prices, an estimate", project: "cloudcli", cost_usd: METER_TOTAL, calls: 6,
    features: METER_FEATURES.map(([feature, label]) => row(feature, label, on[feature], 0.14)),
    days: [{ date: day(), cost_usd: METER_TOTAL }],
    keys: [{ key: "Cd34", held_as: ["house"], calls: 6, cost_usd: METER_TOTAL }],
    unpriced_models: [],
  };
}

export async function geminiPanel(t, { serve = {}, hookEdits = [] } = {}) {
  const page = await withPage(t);
  const on = {
    connector: Object.fromEntries(CONNECTOR_FEATURES.map((f) => [f[1], true])),
    meter: Object.fromEntries(METER_FEATURES.map((f) => [f[0], true])),
  };
  const panel = { page, asked: [], puts: [], on, putDelayMs: 0 };
  panel.defaults = {
    connector: (range) => ({ status: 200, body: connectorBody(range, on.connector) }),
    meter: (range) => ({ status: 200, body: meterBody(range, on.meter) }),
    put: (put) => {
      on[put.door][put.feature] = put.body?.enabled === true;
      return { status: 200, body: { feature: put.feature, enabled: on[put.door][put.feature] } };
    },
  };
  panel.serve = { ...panel.defaults, ...serve };
  const answer = (route, { status, body }) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }).catch(() => undefined);
  await page.route(READS, async (route) => {
    const url = new URL(route.request().url());
    const door = url.pathname.includes("/gemini-meter/") ? "meter" : "connector";
    const range = url.searchParams.get("range");
    panel.asked.push({ door, range });
    await answer(route, panel.serve[door](range));
  });
  await page.route(PRESSES, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    let body = null;
    try {
      body = JSON.parse(request.postData() ?? "null");
    } catch {
      body = request.postData();
    }
    const put = { door: pathname.includes("/gemini-meter/") ? "meter" : "connector", feature: decodeURIComponent(pathname.split("/").pop()), method: request.method(), body };
    panel.puts.push(put);
    if (panel.putDelayMs > 0) await sleep(panel.putDelayMs);
    await answer(route, panel.serve.put(put));
  });
  const edits = hookEdits.map(([pattern, replacement]) => ({ source: pattern.source, flags: pattern.flags, replacement }));
  const mounted = await page.evaluate(async ({ panelFile, hookAt, figuresAt, entryAt, edits }) => {
    const source = async (at) => (await fetch(at)).text();
    // A rewritten hook is mounted from a copy of the hook and of the panel that imports it, held as blob modules whose
    // imports name the running server's origin, so every other module is the page's own.
    let panelAt = panelFile;
    let hookText = await source(hookAt);
    if (edits.length > 0) {
      const absolute = (text) => text.replace(/((?:from|import)\s*\(?\s*)"\/(?!\/)/g, "$1\"" + location.origin + "/");
      for (const e of edits) hookText = hookText.replace(new RegExp(e.source, e.flags), e.replacement);
      const hookBlob = URL.createObjectURL(new Blob([absolute(hookText)], { type: "text/javascript" }));
      const panelText = absolute(await source(panelFile)).replace(/"[^"]*\/src\/modules\/gemini-spend\/useGeminiUsage\.ts[^"]*"/g, "\"" + hookBlob + "\"");
      panelAt = URL.createObjectURL(new Blob([panelText], { type: "text/javascript" }));
    }
    const reactAt = (await source(panelFile)).match(/["'](\/node_modules\/\.vite\/deps\/react\.js\?v=[^"']+)["']/);
    const domAt = (await source(entryAt)).match(/["'](\/node_modules\/\.vite\/deps\/react-dom_client\.js\?v=[^"']+)["']/);
    if (!reactAt || !domAt) return { cannot: "the page's React was not found (react in the panel: " + !!reactAt + ", react-dom/client in main.tsx: " + !!domAt + ")" };
    let view;
    let figures;
    try {
      view = await import(panelAt);
      figures = await import(figuresAt);
    } catch (error) {
      return { error: "the Gemini view would not load: " + String(error && error.message).split("\n")[0] };
    }
    if (typeof view.GeminiUsagePanel !== "function") return { error: "src/modules/gemini-spend/GeminiUsagePanel.tsx exports no GeminiUsagePanel" };
    const reactModule = await import(reactAt[1]);
    const React = reactModule.default ?? reactModule;
    const dom = await import(domAt[1]);
    const createRoot = dom.createRoot ?? (dom.default && dom.default.createRoot);
    if (typeof createRoot !== "function") return { cannot: "react-dom/client gave no createRoot" };
    let visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => visibility === "hidden" });
    window.__athenaGemini = {
      visibility: (state) => {
        visibility = state;
        document.dispatchEvent(new Event("visibilitychange"));
      },
      usd: (value) => figures.usdWords(value),
    };
    const host = document.createElement("div");
    host.setAttribute("data-athena-gemini", "");
    host.style.cssText = "position:fixed;inset:0;z-index:2147483000;overflow:auto;background:#fff";
    document.body.appendChild(host);
    createRoot(host).render(React.createElement(view.GeminiUsagePanel));
    return { ok: true, interval: /\bsetInterval\s*\(/.test(hookText) };
  }, { panelFile: PANEL_FILE, hookAt: HOOK, figuresAt: FIGURES, entryAt: ENTRY, edits });
  if (!mounted.ok) return mounted;
  panel.mounted = mounted;

  const host = page.locator("[data-athena-gemini]");
  panel.switches = (name) => page.evaluate((section) => {
    const place = document.querySelector('[data-athena-gemini] [data-gemini-section="' + section + '"]');
    if (!place) return null;
    let found = [...place.querySelectorAll('[role="switch"]')];
    if (found.length === 0) found = [...place.querySelectorAll('input[type="checkbox"]')];
    return found.map((el) => ({
      checked: el.getAttribute("aria-checked") === "true" || el.checked === true || el.getAttribute("data-state") === "checked",
      disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true" || el.hasAttribute("data-disabled"),
    }));
  }, name);
  panel.press = (name, index) => page.evaluate(({ section, at }) => {
    const place = document.querySelector('[data-athena-gemini] [data-gemini-section="' + section + '"]');
    if (!place) return false;
    let found = [...place.querySelectorAll('[role="switch"]')];
    if (found.length === 0) found = [...place.querySelectorAll('input[type="checkbox"]')];
    if (!found[at]) return false;
    found[at].click();
    return true;
  }, { section: name, at: index });
  panel.downAt = (name) => page.evaluate((section) => {
    const place = document.querySelector('[data-athena-gemini] [data-gemini-section="' + section + '"][data-gemini-door-down]');
    return place ? place.textContent : null;
  }, name);
  panel.drawn = () => page.evaluate(() => {
    const view = document.querySelector("[data-athena-gemini]");
    return !!view && !view.querySelector("[data-gemini-reading]") && !!view.querySelector('[data-gemini-section="cloudcli"]');
  });
  panel.visible = async () => {
    await page.evaluate(() => window.__athenaGemini.visibility("hidden"));
    await sleep(500);
    await page.evaluate(() => window.__athenaGemini.visibility("visible"));
  };
  panel.window = (value) => host.locator("[data-gemini-window]").getByText(WORDS?.api?.gemini?.window?.[value] ?? value, { exact: true }).first().click();
  panel.text = () => host.innerText();
  panel.usd = (value) => page.evaluate((v) => window.__athenaGemini.usd(v), value);
  panel.reads = (from) => {
    const out = { connector: [], meter: [] };
    for (const read of panel.asked.slice(from)) out[read.door].push(read.range);
    return out;
  };
  return panel;
}
