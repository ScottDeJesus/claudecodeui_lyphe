// protects: src/modules/analytics/AnalyticsPanel.tsx, src/modules/analytics/sections/registry.ts, src/modules/i18n/locales/en/common.json
// writes: none
//
// The Analytics panel's head is two questions and it stands in every state (analytics-code-mode, interface G): the strip
// of sections, one option per row of sections/registry.ts named by its titleKey, and the chosen section's windows, each
// the kit's SegmentedControl (a radio group). With nothing kept, the area opens on the registry's first row and its
// defaultDays. The chosen Body is lazy, so on a first render it is still on its way and the Suspense's fallback stands
// under the head: the head is drawn all the same.
//
// The panel is imported in node with localStorage stood in by an empty in-memory store, its stylesheets answered empty,
// and rendered to static markup over en/common.json. The radio groups are found by role="radiogroup" and their options
// by role="radio" and aria-checked, the kit's own markup.

import { readFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PANEL = path.join(REPO, "src/modules/analytics/AnalyticsPanel.tsx");
const REGISTRY = path.join(REPO, "src/modules/analytics/sections/registry.ts");
const LOCALE = path.join(REPO, "src/modules/i18n/locales/en/common.json");

const textOf = (html: string): string =>
  html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;|&gt;/g, " ").replace(/\s+/g, " ").trim();
const firstLine = (error: unknown): string => String((error as Error)?.message ?? error).split("\n")[0];

/** Each radio group in the markup: its options' words and which are chosen. */
function groups(html: string): { label: string; options: { text: string; checked: boolean }[] }[] {
  const found: { label: string; options: { text: string; checked: boolean }[] }[] = [];
  for (const m of html.matchAll(/<(\w+)\b([^>]*\brole="radiogroup"[^>]*)>([\s\S]*?)<\/\1>/g)) {
    const label = (m[2].match(/aria-label="([^"]*)"/) ?? [])[1] ?? "";
    const options = [...m[3].matchAll(/<(\w+)\b([^>]*\brole="radio"[^>]*)>([\s\S]*?)<\/\1>/g)].map((o) => ({ text: textOf(o[3]), checked: /aria-checked="true"/.test(o[2]) }));
    found.push({ label, options });
  }
  return found;
}

runCase(async () => {
  register(
    "data:text/javascript," +
      encodeURIComponent("export async function load(url, context, next) { if (/\\.(css|svg|png)(\\?|$)/.test(url)) return { format: 'module', source: 'export default {}', shortCircuit: true }; return next(url, context); }"),
  );
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
  let panel: any;
  let registry: any;
  try {
    registry = await import(pathToFileURL(REGISTRY).href);
    panel = await import(pathToFileURL(PANEL).href);
  } catch (error) {
    return broken("the panel or the registry would not load: " + firstLine(error));
  }
  const rows: any[] = registry.ANALYTICS_SECTIONS;
  if (!Array.isArray(rows) || rows.length === 0) return broken("sections/registry.ts holds no ANALYTICS_SECTIONS rows");
  if (typeof panel.AnalyticsPanel !== "function") return broken("AnalyticsPanel.tsx exports no AnalyticsPanel");

  let html: string;
  try {
    html = renderToStaticMarkup(createElement(panel.AnalyticsPanel));
  } catch (error) {
    return broken("the panel threw while drawing with nothing kept: " + firstLine(error));
  }
  const wrong: string[] = [];
  const title = String(i18n.t("analytics.title"));
  const heading = (html.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/) ?? [])[1];
  if (heading === undefined || textOf(heading) !== title) wrong.push('no heading reads the area\'s title "' + title + '" (found ' + JSON.stringify(heading === undefined ? null : textOf(heading)) + ")");

  const found = groups(html);
  if (found.length !== 2) return broken("the head draws " + found.length + " radio groups, not the strip and the windows: " + JSON.stringify(found));
  const [strip, windows] = found;
  const want = rows.map((r) => String(i18n.t(r.titleKey)));
  if (JSON.stringify(strip.options.map((o) => o.text)) !== JSON.stringify(want)) wrong.push("the strip reads " + JSON.stringify(strip.options.map((o) => o.text)) + ", not the registry's " + JSON.stringify(want));
  const stripChosen = strip.options.map((o, i) => (o.checked ? i : -1)).filter((i) => i !== -1);
  if (JSON.stringify(stripChosen) !== "[0]") wrong.push("with nothing kept the strip's chosen options are " + JSON.stringify(stripChosen) + ", not the first row alone");
  const first = rows[0];
  const offered = windows.options.map((o) => Number((o.text.match(/\d+/) ?? [])[0]));
  if (JSON.stringify(offered) !== JSON.stringify([...first.windows])) wrong.push("the windows read " + JSON.stringify(windows.options.map((o) => o.text)) + ", not " + first.id + "'s " + JSON.stringify(first.windows));
  const windowChosen = windows.options.filter((o) => o.checked).map((o) => Number((o.text.match(/\d+/) ?? [])[0]));
  if (JSON.stringify(windowChosen) !== JSON.stringify([first.defaultDays])) wrong.push("with nothing kept the chosen window is " + JSON.stringify(windowChosen) + ", not " + first.id + "'s default " + first.defaultDays);
  if (!strip.label || !windows.label || strip.label === windows.label) wrong.push("the two groups' names are " + JSON.stringify([strip.label, windows.label]) + ": each needs its own");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held('"' + title + '" over ' + strip.label + " " + JSON.stringify(strip.options) + " and " + windows.label + " " + JSON.stringify(windows.options));
});
