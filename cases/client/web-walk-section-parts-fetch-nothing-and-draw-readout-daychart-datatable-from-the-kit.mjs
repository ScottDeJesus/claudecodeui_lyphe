// protects: src/modules/analytics/sections/web-walk/WebWalkGlance.tsx, src/modules/analytics/sections/web-walk/WebWalkTrend.tsx, src/modules/analytics/sections/web-walk/WebWalkChecks.tsx, src/modules/analytics/sections/web-walk/WebWalkApps.tsx, src/modules/analytics/sections/web-walk/WebWalkSection.tsx, src/modules/analytics/sections/web-walk/webWalkFigures.ts
// writes: none
//
// The Web walks section composes Astrolabe pieces only (web-helper, phase 7): the glance's tiles are the kit's Readout,
// the trend is the kit's DayChart, the checks and the apps are the kit's DataTable, each taken from @/shared/ui. No part
// fetches for itself (each is handed its slice of the one answer the section reads) and neither a part nor the section
// builds a raw table, select, button, input or svg. webWalkFigures.ts is the arithmetic only: it imports types and
// nothing else and reads no clock, storage or page.
//
// The files are read as text, comments left out.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(REPO, "src/modules/analytics/sections/web-walk");
const PARTS = { "WebWalkGlance.tsx": "Readout", "WebWalkTrend.tsx": "DayChart", "WebWalkChecks.tsx": "DataTable", "WebWalkApps.tsx": "DataTable" };
const SECTION = "WebWalkSection.tsx";
const FIGURES = "webWalkFigures.ts";
const READS = /@\/shared\/api\b|useAnalyticsSection|\bfetch\s*\(|authenticatedFetch|EventSource|WebSocket|XMLHttpRequest|\baxios\b/;
const RAW = /<(table|thead|tbody|tr|td|th|select|option|button|input|textarea|svg|dialog)\b/;
const OTHER_MODULE = /from\s+['"]@\/modules\/(?!analytics\/)[^'"]+['"]/;
const IMPURE = /\bfetch\s*\(|Date\.now\s*\(|new Date\s*\(\s*\)|localStorage|sessionStorage|\bwindow\.|\bdocument\./;
const KIT_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"]@\/shared\/ui['"]/g;

const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const kitNames = (text) => [...text.matchAll(KIT_IMPORT)].flatMap((m) => m[1].split(",").map((n) => n.trim().split(/\s+as\s+/)[0])).filter(Boolean);

runCase(async () => {
  const wrong = [];
  const take = async (name) => {
    try {
      return code(await readFile(path.join(DIR, name), "utf8"));
    } catch {
      wrong.push(name + " is not on disk");
      return null;
    }
  };
  for (const [name, piece] of Object.entries(PARTS)) {
    const text = await take(name);
    if (text === null) continue;
    const read = READS.exec(text);
    if (read) wrong.push(name + " reads for itself: " + read[0]);
    const raw = RAW.exec(text);
    if (raw) wrong.push(name + " draws a raw <" + raw[1] + ">, not a kit piece");
    const other = OTHER_MODULE.exec(text);
    if (other) wrong.push(name + " leans on another area: " + other[0]);
    if (!kitNames(text).includes(piece)) wrong.push(name + " does not take " + piece + " from @/shared/ui");
  }
  const section = await take(SECTION);
  if (section !== null) {
    const raw = RAW.exec(section);
    if (raw) wrong.push(SECTION + " draws a raw <" + raw[1] + ">, not a kit piece");
    const other = OTHER_MODULE.exec(section);
    if (other) wrong.push(SECTION + " leans on another area: " + other[0]);
  }
  const figures = (await take(FIGURES)) ?? "";
  const imports = [...figures.matchAll(/^import\s+(?!type\b)[^;]*;/gm)].map((m) => m[0]);
  if (imports.length > 0) wrong.push(FIGURES + " imports more than types: " + imports.join(" "));
  const impure = IMPURE.exec(figures);
  if (impure) wrong.push(FIGURES + " reads outside its arguments: " + impure[0]);
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("Glance takes Readout, Trend DayChart, Checks and Apps DataTable from @/shared/ui; no part reads for itself or draws a raw element; webWalkFigures.ts imports types only and reads no clock, storage or page");
});
