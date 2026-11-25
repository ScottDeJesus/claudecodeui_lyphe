// protects: src/modules/analytics/AnalyticsPanel.tsx, src/modules/analytics/sections/registry.ts
// writes: none
//
// The Analytics panel and its sections' Bodies (rnd-adopted-measures, phase 5): every Body is handed the panel's
// openSection beside its days, so a section can open another (the R&D row's press opens the tab its measure names); and a
// section that offers no window (windows empty, the R&D section) draws no window control and is always handed its
// defaultDays, whatever days were kept. Each registry row is kept in turn as the chosen section, with 7 days kept, by a
// localStorage stand-in that answers that choice for any key the panel reads; the row's lazy Body is swapped for a plain
// component that writes the props it was handed into the markup, and the panel is drawn to static markup over
// en/common.json. The registry's rows are put back as they were after each draw.
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PANEL = path.join(REPO, "src/modules/analytics/AnalyticsPanel.tsx");
const REGISTRY = path.join(REPO, "src/modules/analytics/sections/registry.ts");
const LOCALE = path.join(REPO, "src/modules/i18n/locales/en/common.json");
const KEPT_DAYS = 7;

const first = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0];
const radiogroups = (html: string) => (html.match(/role="radiogroup"/g) ?? []).length;

runCase(async () => {
  register(
    "data:text/javascript," +
      encodeURIComponent("export async function load(url, context, next) { if (/\\.(css|svg|png)(\\?|$)/.test(url)) return { format: 'module', source: 'export default {}', shortCircuit: true }; return next(url, context); }"),
  );
  (globalThis as any).window ??= globalThis;
  let kept = "null";
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => kept, setItem: () => undefined, removeItem: () => undefined, clear: () => undefined, key: () => null, length: 0 },
  });
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const i18n = (await import("i18next")).default;
  const { initReactI18next } = await import("react-i18next");
  const en = JSON.parse(await readFile(LOCALE, "utf8"));
  await i18n.use(initReactI18next).init({ lng: "en", fallbackLng: "en", defaultNS: "common", ns: ["common"], resources: { en: { common: en } }, interpolation: { escapeValue: false }, react: { useSuspense: false } });
  let registry: any;
  let panel: any;
  try {
    registry = await import(pathToFileURL(REGISTRY).href);
    panel = await import(pathToFileURL(PANEL).href);
  } catch (e) {
    return broken("the panel or the registry would not load: " + first(e));
  }
  const rows: any[] = Array.isArray(registry.ANALYTICS_SECTIONS) ? registry.ANALYTICS_SECTIONS : [];
  if (!rows.some((r) => Array.isArray(r?.windows) && r.windows.length === 0)) return broken("the registry holds no windowless row: " + JSON.stringify(rows.map((r) => [r?.id, r?.windows])));
  const Probe = (props: any) => createElement("output", { "data-probe-days": String(props.days), "data-probe-open": typeof props.openSection });
  const wrong: string[] = [];
  const said: string[] = [];
  for (const row of rows) {
    const Body = row.Body;
    try { row.Body = Probe; } catch (e) { return broken("the registry's rows cannot take a stand-in Body: " + first(e)); }
    kept = JSON.stringify({ section: row.id, days: KEPT_DAYS });
    let html = "";
    try { html = renderToStaticMarkup(createElement(panel.AnalyticsPanel)); } catch (e) { wrong.push(row.id + ": the panel threw: " + first(e)); }
    finally { row.Body = Body; }
    if (!html) continue;
    const days = (html.match(/data-probe-days="([^"]*)"/) ?? [])[1];
    const open = (html.match(/data-probe-open="([^"]*)"/) ?? [])[1];
    if (days === undefined) { wrong.push(row.id + ": kept as the chosen section, its Body was not drawn"); continue; }
    if (open !== "function") wrong.push(row.id + ": its Body was handed openSection as " + JSON.stringify(open ?? "absent"));
    const windowless = row.windows.length === 0;
    const wantDays = windowless || !row.windows.includes(KEPT_DAYS) ? row.defaultDays : KEPT_DAYS;
    if (Number(days) !== wantDays) wrong.push(row.id + ": its Body was handed " + days + " days, not " + wantDays);
    const groups = radiogroups(html);
    if (groups !== (windowless ? 1 : 2)) wrong.push(row.id + ": the head draws " + groups + " radio group(s), not " + (windowless ? "the strip alone" : "the strip and its windows"));
    said.push(row.id + " " + days + "d" + (windowless ? " no window control" : ""));
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("every Body handed days and openSection: " + said.join(", "));
});
