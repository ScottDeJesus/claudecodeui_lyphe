// protects: src/modules/api-tab/ApiPanel.tsx, src/modules/i18n/locales/en/common.json
// writes: none
//
// The API tab holds three sub-tabs, Jev, DeepSeek and Gemini, in that order (gemini-spend, seam 9): ApiSubTab, isApiSubTab
// and the tabs list each name 'gemini', and Jev stays the default. The sub-tab a browser kept in localStorage.apiSubTab
// opens only when it is exactly one of the three ids; nothing kept, or anything else, opens Jev.
//
// ApiPanel is imported in node with localStorage stood in by an in-memory store, its stylesheets answered empty and its
// three sub-panels (the jev, deepseek-spend and gemini-spend barrels) stood in by components that draw their own name, so
// this case judges the tab and never a panel's body. It is rendered to static markup over en/common.json; the open
// sub-tab is read off the panel's own data-api-subtab and the stand-in drawn, the strip's labels off the kit's role="tab".

import { readFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LOCALE = path.join(REPO, "src/modules/i18n/locales/en/common.json");

const textOf = (html: string): string =>
  html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&nbsp;|&#160;| /g, " ").replace(/\s+/g, " ").trim();
const firstLine = (error: unknown): string => String((error as Error)?.message ?? error).split("\n")[0];
const PANEL = path.join(REPO, "src/modules/api-tab/ApiPanel.tsx");
const STUBS: Record<string, string> = {
  "@/modules/jev": "data:text/javascript," + encodeURIComponent("export const JevPanel = () => '[jev panel]';"),
  "@/modules/deepseek-spend": "data:text/javascript," + encodeURIComponent("export const DeepseekUsagePanel = () => '[deepseek panel]';"),
  "@/modules/gemini-spend": "data:text/javascript," + encodeURIComponent("export const GeminiUsagePanel = () => '[gemini panel]';"),
};

runCase(async () => {
  const hooks =
    "const STUBS = " + JSON.stringify(STUBS) + ";" +
    "export async function resolve(spec, context, next) { if (Object.hasOwn(STUBS, spec)) return { url: STUBS[spec], shortCircuit: true }; return next(spec, context); }" +
    "export async function load(url, context, next) { if (/\\.(css|svg|png)(\\?|$)/.test(url)) return { format: 'module', source: 'export default {}', shortCircuit: true }; return next(url, context); }";
  register("data:text/javascript," + encodeURIComponent(hooks));
  (globalThis as any).window ??= globalThis;
  const kept = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (kept.has(k) ? kept.get(k) : null),
      setItem: (k: string, v: string) => void kept.set(k, String(v)),
      removeItem: (k: string) => void kept.delete(k),
      clear: () => kept.clear(),
      key: (i: number) => [...kept.keys()][i] ?? null,
      get length() { return kept.size; },
    },
  });
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const i18n = (await import("i18next")).default;
  const { initReactI18next } = await import("react-i18next");
  const en = JSON.parse(await readFile(LOCALE, "utf8"));
  await i18n.use(initReactI18next).init({ lng: "en", fallbackLng: "en", defaultNS: "common", ns: ["common"], resources: { en: { common: en } }, interpolation: { escapeValue: false }, react: { useSuspense: false } });
  const wrong: string[] = [];
  if (en?.api?.subtabs?.gemini !== "Gemini") wrong.push("en/common.json api.subtabs.gemini reads " + JSON.stringify(en?.api?.subtabs?.gemini) + ', not "Gemini"');
  let ApiPanel: unknown;
  try {
    ApiPanel = (await import(pathToFileURL(PANEL).href)).ApiPanel;
  } catch (error) {
    return broken("ApiPanel.tsx would not load: " + firstLine(error));
  }
  if (typeof ApiPanel !== "function") return broken("ApiPanel.tsx exports no ApiPanel");
  const draw = (stored: string | null) => {
    kept.clear();
    if (stored !== null) kept.set("apiSubTab", stored);
    const html = renderToStaticMarkup(createElement(ApiPanel as never));
    const open = (html.match(/data-api-subtab="([^"]*)"/) ?? [])[1] ?? "(none)";
    const body = (textOf(html).match(/\[(\w+) panel\]/) ?? [])[1] ?? "(none)";
    const tabs = [...html.matchAll(/<(\w+)\b([^>]*\brole="tab"[^>]*)>([\s\S]*?)<\/\1>/g)].map((m) => textOf(m[3]));
    return { open, body, tabs };
  };
  const expected: [string | null, string][] = [[null, "jev"], ["gemini", "gemini"], ["deepseek", "deepseek"], ["jev", "jev"], ["Gemini", "jev"], ["bogus", "jev"]];
  const seen: string[] = [];
  for (const [stored, want] of expected) {
    let got: { open: string; body: string; tabs: string[] };
    try {
      got = draw(stored);
    } catch (error) {
      wrong.push("kept " + JSON.stringify(stored) + " would not render: " + firstLine(error));
      continue;
    }
    seen.push(JSON.stringify(stored) + " opens " + got.open);
    if (got.open !== want || got.body !== want) wrong.push("kept " + JSON.stringify(stored) + " opens " + got.open + " drawing the " + got.body + " panel, not " + want);
    if (got.tabs.join("|") !== "Jev|DeepSeek|Gemini") wrong.push("kept " + JSON.stringify(stored) + " draws the strip " + JSON.stringify(got.tabs) + ", not Jev, DeepSeek, Gemini");
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("strip Jev, DeepSeek, Gemini; " + seen.join(", "));
});
