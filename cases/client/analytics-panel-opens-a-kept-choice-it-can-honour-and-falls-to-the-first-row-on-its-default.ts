// protects: src/modules/analytics/AnalyticsPanel.tsx, src/modules/analytics/sections/registry.ts
// writes: none
//
// The Analytics panel keeps its choice { section, days } in localStorage under analytics-view and opens on it the next
// visit, as far as the registry can honour it (analytics-code-mode, interface G): a stored section the registry does not
// hold, a window that section does not offer, a value that is not such an object, or storage that refuses, opens the
// registry's first row on its own default window.
//
// The panel is imported in node (stylesheets answered empty, window stood in by globalThis, localStorage by a store this
// case fills), rendered to static markup over en/common.json, and read for the section it opened
// (data-analytics-panel) and the window its second SegmentedControl marks chosen: the option element that says it is
// checked, pressed or selected and whose words begin with that window's label. A reshaped control is a change to how
// this case finds the choice, never to what it checks.

import { readFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PANEL = path.join(REPO, "src/modules/analytics/AnalyticsPanel.tsx");
const REGISTRY = path.join(REPO, "src/modules/analytics/sections/registry.ts");
const LOCALE = path.join(REPO, "src/modules/i18n/locales/en/common.json");
const KEY = "analytics-view";
const CHOSEN = /<[a-zA-Z][\w-]*\b[^>]*\s(?:aria-checked="true"|aria-pressed="true"|aria-selected="true"|data-state="(?:on|active|checked)"|data-selected="true"|checked="")[^>]*>/g;

const textOf = (html: string): string =>
  html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const firstLine = (error: unknown): string => String((error as Error)?.message ?? error).split("\n")[0];

runCase(async () => {
  register(
    "data:text/javascript," +
      encodeURIComponent("export async function load(url, context, next) { if (/\\.(css|svg|png)(\\?|$)/.test(url)) return { format: 'module', source: 'export default {}', shortCircuit: true }; return next(url, context); }"),
  );
  (globalThis as any).window ??= globalThis;
  let stored: string | null = null;
  let refusing = false;
  const storage = {
    getItem: (key: string): string | null => {
      if (refusing) throw new Error("The operation is insecure.");
      return key === KEY ? stored : null;
    },
    setItem: (): void => undefined,
    removeItem: (): void => undefined,
    clear: (): void => undefined,
    key: (): null => null,
    length: 0,
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const i18n = (await import("i18next")).default;
  const { initReactI18next } = await import("react-i18next");
  const en = JSON.parse(await readFile(LOCALE, "utf8"));
  await i18n.use(initReactI18next).init({ lng: "en", fallbackLng: "en", defaultNS: "common", ns: ["common"], resources: { en: { common: en } }, interpolation: { escapeValue: false }, react: { useSuspense: false } });
  let Panel: any;
  let rows: any[];
  try {
    Panel = (await import(pathToFileURL(PANEL).href)).AnalyticsPanel;
    rows = (await import(pathToFileURL(REGISTRY).href)).ANALYTICS_SECTIONS;
  } catch (error) {
    return broken("the panel would not load: " + firstLine(error));
  }
  if (typeof Panel !== "function") return broken("AnalyticsPanel.tsx exports no AnalyticsPanel");
  const first = Array.isArray(rows) ? rows[0] : undefined;
  if (!first) return broken("the registry holds no row");
  const windows: number[] = Array.from(first.windows);
  const kept = windows.find((days) => days !== first.defaultDays);
  if (kept === undefined) return broken("the first row offers no window but its default");
  let unoffered = 14;
  while (windows.includes(unoffered)) unoffered += 1;
  const offered: number[] = Array.from(new Set(rows.flatMap((row: any) => Array.from(row.windows as number[]))));
  const label = (days: number): string => String(i18n.t("analytics.head.days", { days }));
  const loud = { warn: console.warn, error: console.error };

  const opened = (raw: string | null, refuses: boolean): { section: string | null; days: number | null; said: string } => {
    stored = raw;
    refusing = refuses;
    console.warn = () => undefined;
    console.error = () => undefined;
    let html = "";
    try {
      html = renderToStaticMarkup(createElement(Panel));
    } catch (error) {
      return { section: null, days: null, said: "the render threw: " + firstLine(error) };
    } finally {
      refusing = false;
      console.warn = loud.warn;
      console.error = loud.error;
    }
    const section = (html.match(/data-analytics-panel="([^"]*)"/) ?? [])[1] ?? null;
    let days: number | null = null;
    for (const match of html.matchAll(CHOSEN)) {
      const words = textOf(html.slice(match.index ?? 0, (match.index ?? 0) + 400));
      const hit = offered.find((each) => words.startsWith(label(each)));
      if (hit !== undefined) {
        days = hit;
        break;
      }
    }
    return { section, days, said: days === null ? "no window marked chosen in \"" + textOf(html).slice(0, 140) + "\"" : "" };
  };

  const scenes: Array<[string, string | null, boolean, number]> = [
    ["nothing kept", null, false, first.defaultDays],
    ["a choice it can honour (" + first.id + " on " + kept + ")", JSON.stringify({ section: first.id, days: kept }), false, kept],
    ["a section the registry does not hold", JSON.stringify({ section: "athena-no-such-section", days: kept }), false, first.defaultDays],
    ["a window " + first.id + " does not offer (" + unoffered + ")", JSON.stringify({ section: first.id, days: unoffered }), false, first.defaultDays],
    ["days kept as words", JSON.stringify({ section: first.id, days: String(kept) }), false, first.defaultDays],
    ["text that is not JSON", "{not json", false, first.defaultDays],
    ["an array", JSON.stringify([first.id, kept]), false, first.defaultDays],
    ["storage that refuses", JSON.stringify({ section: first.id, days: kept }), true, first.defaultDays],
  ];
  const wrong: string[] = [];
  const said: string[] = [];
  for (const [what, raw, refuses, want] of scenes) {
    const got = opened(raw, refuses);
    if (got.section !== first.id || got.days !== want) wrong.push(what + ": opened " + got.section + " on " + got.days + ", not " + first.id + " on " + want + (got.said ? " (" + got.said + ")" : ""));
    else said.push(what + " -> " + want);
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(first.id + ": " + said.join("; "));
});
