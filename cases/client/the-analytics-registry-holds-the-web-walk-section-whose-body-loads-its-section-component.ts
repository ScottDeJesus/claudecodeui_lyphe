// protects: src/modules/analytics/sections/registry.ts, src/modules/analytics/sections/web-walk/WebWalkSection.tsx, src/modules/analytics/sections/web-walk, src/modules/i18n/locales/en/common.json
// writes: none
//
// The client half of the web-walk seam, filled: sections/registry.ts holds the section with id 'web-walk' (the server's
// reader id), named by analytics.sections.webWalk, which en/common.json spells, offering 7, 30 and 90 days and opening on
// 30; its lazy Body resolves to WebWalkSection.tsx's WebWalkSection, which reads its one answer through
// useAnalyticsSection('web-walk', days, ...) inside AnalyticsSectionFrame; and no file of sections/web-walk imports a fake
// reading (the composition drew a stand-in until its markers were filled).
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REGISTRY = path.join(REPO, "src/modules/analytics/sections/registry.ts");
const FOLDER = path.join(REPO, "src/modules/analytics/sections/web-walk");
const SECTION = path.join(FOLDER, "WebWalkSection.tsx");
const LOCALE = path.join(REPO, "src/modules/i18n/locales/en/common.json");
const FAKE_IMPORT = /\bfrom\s+['"][^'"]*fake[^'"]*['"]/i;

const first = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0];

runCase(async () => {
  let registry: any;
  try { registry = await import(pathToFileURL(REGISTRY).href); } catch (e) { return broken("sections/registry.ts would not load: " + first(e)); }
  const rows: any[] = Array.isArray(registry.ANALYTICS_SECTIONS) ? registry.ANALYTICS_SECTIONS : [];
  const row = rows.find((r) => r && r.id === "web-walk");
  if (!row) return broken("sections/registry.ts holds no web-walk row (its ids: " + rows.map((r) => r && r.id).join(", ") + ")");
  const wrong: string[] = [];
  if (row.titleKey !== "analytics.sections.webWalk") wrong.push("its titleKey is " + JSON.stringify(row.titleKey));
  if (JSON.stringify(row.windows) !== "[7,30,90]") wrong.push("its windows are " + JSON.stringify(row.windows));
  if (row.defaultDays !== 30) wrong.push("it opens on " + JSON.stringify(row.defaultDays) + " days");
  const en = JSON.parse(await readFile(LOCALE, "utf8"));
  const title = en && en.analytics && en.analytics.sections ? en.analytics.sections.webWalk : undefined;
  if (typeof title !== "string" || !title.trim()) wrong.push("en/common.json spells no analytics.sections.webWalk");

  let sectionText = "";
  try { sectionText = await readFile(SECTION, "utf8"); } catch { return broken("sections/web-walk/WebWalkSection.tsx is not on disk"); }
  if (!/useAnalyticsSection\s*(<[^>]*>)?\s*\(\s*['"]web-walk['"]/.test(sectionText)) wrong.push("WebWalkSection does not read useAnalyticsSection('web-walk', ...)");
  if (!/<AnalyticsSectionFrame\b/.test(sectionText)) wrong.push("WebWalkSection draws no AnalyticsSectionFrame");
  const faked: string[] = [];
  for (const name of await readdir(FOLDER)) {
    if (/fake/i.test(name)) faked.push(name + " is in the folder");
    else if (/\.(ts|tsx)$/.test(name) && FAKE_IMPORT.test(await readFile(path.join(FOLDER, name), "utf8"))) faked.push(name + " imports a fake");
  }
  if (faked.length) wrong.push("the section still carries a stand-in reading: " + faked.join(", "));

  const body = row.Body;
  if (!body || body.$$typeof !== Symbol.for("react.lazy")) wrong.push("its Body is not a React lazy");
  else if (typeof body._payload?._result === "function") {
    try {
      const loaded = await body._payload._result();
      const own = await import(pathToFileURL(SECTION).href);
      const section = own.WebWalkSection;
      const got = loaded && loaded.default;
      if (typeof section !== "function" && !(section && typeof section === "object")) wrong.push("WebWalkSection.tsx exports no WebWalkSection");
      else if (!(got === section || (typeof got === "function" && got.name === "WebWalkSection"))) wrong.push("its Body resolves to " + String(got && (got.name || typeof got)) + ", not WebWalkSection");
    } catch (e) {
      wrong.push("the web-walk section would not load: " + first(e));
    }
  }
  if (wrong.length) return broken("the web-walk section: " + wrong.join("; "));
  return held("registry row web-walk, titled " + JSON.stringify(title) + ", windows 7/30/90 opening on 30; its Body is WebWalkSection, which reads useAnalyticsSection('web-walk') inside AnalyticsSectionFrame; no stand-in reading left in the folder");
});
