// protects: src/modules/analytics/sections/registry.ts, src/modules/analytics/sections/repeats, src/modules/i18n/locales/en/common.json
// writes: none
//
// The client half of the repeats seam, filled: sections/registry.ts holds the section with id 'repeats' (the server's
// reader id), named by analytics.sections.repeats, which en/common.json spells, offering 7, 30 and 90 days and opening on
// 30; its lazy Body is RepeatsSection.tsx's RepeatsSection, which reads its one answer through
// useAnalyticsSection('repeats', days, ...) inside AnalyticsSectionFrame. No file of sections/repeats holds a FILL:
// marker or the repeatsFake stand-in, none reads the server beside useAnalyticsSection, none holds a timer that
// re-reads (the section is fetched on open and on Refresh only), and every literal analytics.repeats.* key its files
// hand t() whole is spelled in en/common.json (a prefix joined to a value at run time is not a key and is not read).
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REGISTRY = path.join(REPO, "src/modules/analytics/sections/registry.ts");
const FOLDER = path.join(REPO, "src/modules/analytics/sections/repeats");
const SECTION = path.join(FOLDER, "RepeatsSection.tsx");
const LOCALE = path.join(REPO, "src/modules/i18n/locales/en/common.json");

const first = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0];

function spelled(tree: any, key: string): boolean {
  const at = (k: string) => k.split(".").reduce((node: any, part) => (node && typeof node === "object" ? node[part] : undefined), tree);
  return ["", "_one", "_other"].some((suffix) => typeof at(key + suffix) === "string");
}

runCase(async () => {
  let registry: any;
  try { registry = await import(pathToFileURL(REGISTRY).href); } catch (e) { return broken("sections/registry.ts would not load: " + first(e)); }
  const rows: any[] = Array.isArray(registry.ANALYTICS_SECTIONS) ? registry.ANALYTICS_SECTIONS : [];
  const row = rows.find((r) => r && r.id === "repeats");
  if (!row) return broken("sections/registry.ts holds no repeats row (its ids: " + rows.map((r) => r && r.id).join(", ") + ")");
  const wrong: string[] = [];
  if (row.titleKey !== "analytics.sections.repeats") wrong.push("its titleKey is " + JSON.stringify(row.titleKey));
  if (JSON.stringify(row.windows) !== "[7,30,90]") wrong.push("its windows are " + JSON.stringify(row.windows));
  if (row.defaultDays !== 30) wrong.push("it opens on " + JSON.stringify(row.defaultDays) + " days");
  if (!row.Body || typeof row.Body !== "object") wrong.push("its Body is not a lazy component");
  const registryText = await readFile(REGISTRY, "utf8");
  if (!registryText.includes("sections/repeats/RepeatsSection") || !registryText.includes("m.RepeatsSection")) wrong.push("its Body does not load sections/repeats/RepeatsSection's RepeatsSection");
  let en: any;
  try { en = JSON.parse(await readFile(LOCALE, "utf8")); } catch (e) { return broken("en/common.json would not parse: " + first(e)); }
  if (!spelled(en, "analytics.sections.repeats")) wrong.push("en/common.json spells no analytics.sections.repeats");

  let sectionText = "";
  try { sectionText = await readFile(SECTION, "utf8"); } catch { return broken("sections/repeats/RepeatsSection.tsx is not on disk"); }
  if (!/useAnalyticsSection\s*(<[^>]*>)?\s*\(\s*['"]repeats['"]/.test(sectionText)) wrong.push("RepeatsSection does not read useAnalyticsSection('repeats', ...)");
  if (!/<AnalyticsSectionFrame\b/.test(sectionText)) wrong.push("RepeatsSection draws no AnalyticsSectionFrame");

  const marked: string[] = [];
  const faked: string[] = [];
  const timed: string[] = [];
  const fetching: string[] = [];
  const unspelled: string[] = [];
  let keys = 0;
  const names = await readdir(FOLDER);
  for (const name of names) {
    if (!/\.(ts|tsx)$/.test(name)) continue;
    const body = await readFile(path.join(FOLDER, name), "utf8");
    if (/\bFILL:/.test(body)) marked.push(name);
    if (/repeatsFake/i.test(name) || /repeatsFake|fakeRepeats/.test(body)) faked.push(name);
    if (/\bsetInterval\s*\(/.test(body) || (/\bsetTimeout\s*\(/.test(body) && /\brefresh\b/.test(body))) timed.push(name);
    if (/\bfetch\s*\(|authenticatedFetch|\/api\/analytics/.test(body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""))) fetching.push(name);
    for (const m of body.matchAll(/\bt\(\s*['"](analytics\.repeats\.[\w.]*\w)['"]/g)) {
      keys += 1;
      if (!spelled(en, m[1])) unspelled.push(m[1]);
    }
  }
  if (marked.length) wrong.push("FILL: markers left in " + marked.join(", "));
  if (faked.length) wrong.push("the stand-in reading is still in " + faked.join(", "));
  if (timed.length) wrong.push("a timer re-reads in " + timed.join(", "));
  if (fetching.length) wrong.push("a read beside useAnalyticsSection in " + fetching.join(", "));
  if (unspelled.length) wrong.push("en/common.json lacks " + [...new Set(unspelled)].slice(0, 5).join(", "));
  if (wrong.length) return broken("the repeats section: " + wrong.join("; "));
  return held("registry row repeats, titled " + JSON.stringify(spelled(en, "analytics.sections.repeats") ? en.analytics.sections.repeats : "") + ", windows 7/30/90 opening on 30; RepeatsSection reads useAnalyticsSection('repeats') inside AnalyticsSectionFrame; " + names.length + " files, no FILL marker, no stand-in, no timer, " + keys + " analytics.repeats keys all spelled");
});
