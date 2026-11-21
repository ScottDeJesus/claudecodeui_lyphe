// The Code Mode section's four parts are handed parts of the ONE answer the section read, and fetch nothing; they
// draw only the kit's pieces from src/shared/ui, never a raw table, select, button, input or svg built inside the
// module (analytics-code-mode, interface I; the design language: "screens compose them, never build their own").
// codeModeFigures.ts holds pure derivations only: it imports types and nothing else and reads no clock, storage or page.
//
// The files are read as text, comments left out. A part that fetches names the api door, the section's read hook,
// fetch, an EventSource or a socket; a part that leans on another area imports a module other than analytics.
//
// protects: src/modules/analytics/sections/code-mode/CodeModeCompare.tsx, src/modules/analytics/sections/code-mode/CodeModeOutcomes.tsx, src/modules/analytics/sections/code-mode/CodeModeCauses.tsx, src/modules/analytics/sections/code-mode/CodeModeTrend.tsx, src/modules/analytics/sections/code-mode/codeModeFigures.ts
// writes: none

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(REPO, "src/modules/analytics/sections/code-mode");
const PARTS = ["CodeModeCompare.tsx", "CodeModeOutcomes.tsx", "CodeModeCauses.tsx", "CodeModeTrend.tsx"];
const FIGURES = "codeModeFigures.ts";
const READS = /@\/shared\/api\b|useAnalyticsSection|\bfetch\s*\(|authenticatedFetch|EventSource|WebSocket|XMLHttpRequest|\baxios\b/;
const RAW = /<(table|thead|tbody|tr|td|th|select|option|button|input|textarea|svg|dialog)\b/;
const OTHER_MODULE = /from\s+['"]@\/modules\/(?!analytics\/)[^'"]+['"]/;
const IMPURE = /\bfetch\s*\(|Date\.now\s*\(|new Date\s*\(\s*\)|localStorage|sessionStorage|\bwindow\.|\bdocument\./;

const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

runCase(async () => {
  const wrong = [];
  for (const name of PARTS) {
    let text;
    try {
      text = code(await readFile(path.join(DIR, name), "utf8"));
    } catch {
      wrong.push(name + " is not on disk");
      continue;
    }
    const read = READS.exec(text);
    if (read) wrong.push(name + " reads for itself: " + read[0]);
    const raw = RAW.exec(text);
    if (raw) wrong.push(name + " draws a raw <" + raw[1] + ">, not a kit piece");
    const other = OTHER_MODULE.exec(text);
    if (other) wrong.push(name + " leans on another area: " + other[0]);
    if (!/from\s+['"]@\/shared\/ui['"]/.test(text)) wrong.push(name + " takes nothing from the kit (@/shared/ui)");
  }
  let figures = "";
  try {
    figures = code(await readFile(path.join(DIR, FIGURES), "utf8"));
  } catch {
    wrong.push(FIGURES + " is not on disk");
  }
  const imports = [...figures.matchAll(/^import\s+(?!type\b)[^;]*;/gm)].map((m) => m[0]);
  if (imports.length > 0) wrong.push(FIGURES + " imports more than types: " + imports.join(" "));
  const impure = IMPURE.exec(figures);
  if (impure) wrong.push(FIGURES + " reads outside its arguments: " + impure[0]);
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("4 parts read nothing for themselves, draw no raw element, take their pieces from @/shared/ui; codeModeFigures.ts imports types only and reads no clock, storage or page");
});
