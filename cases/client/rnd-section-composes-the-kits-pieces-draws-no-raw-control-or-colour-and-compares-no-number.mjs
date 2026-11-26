// protects: src/modules/analytics/sections/rnd/
// writes: none
//
// The Analytics R&D section (rnd-adopted-measures, phase 4) composes Astrolabe's pieces and builds none of its own:
// RndFeatureRow takes Badge and Button from @/shared/ui, RndReadingsSection takes EmptyState from @/shared/ui and draws
// its answer inside AnalyticsSectionFrame. No file of the folder draws a raw control, table, svg or img, sets a style or
// a colour of its own (a tone is the kit's), or leans on another module; and none compares a reading's value with its
// baseline, since how a reading stands (against) is the dispatcher's word and the screen only says it.
//
// The files are read as text, comments left out.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(REPO, "src/modules/analytics/sections/rnd");
const NEEDS = { "RndFeatureRow.tsx": ["Badge", "Button"], "RndReadingsSection.tsx": ["EmptyState"], "rndReadingFigures.ts": [] };
const RAW = /<(table|thead|tbody|tr|td|th|select|option|button|input|textarea|svg|dialog|img)\b/;
const OWN_LOOK = /\bstyle=\{|#[0-9a-fA-F]{3,8}\b|\b(?:text|bg|border|fill|stroke|ring)-(?:red|green|amber|yellow|emerald|rose|orange|lime|sky|blue|slate|gray|zinc|stone)-\d{2,3}\b|\b(?:text|bg|border|fill)-\[/;
const OTHER_MODULE = /from\s+['"]@\/modules\/(?!analytics\/)[^'"]+['"]/;
const COMPARES = /\.(?:value|baseline)\s*(?:<=|>=|<(?![A-Za-z\/])|>|===|!==|-)\s*[\w.?!]*\.(?:baseline|value)\b|Math\.sign\s*\(/;
const KIT_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"]@\/shared\/ui['"]/g;

const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const kitNames = (text) => [...text.matchAll(KIT_IMPORT)].flatMap((m) => m[1].split(",").map((n) => n.trim().split(/\s+as\s+/)[0])).filter(Boolean);

runCase(async () => {
  let names;
  try {
    names = (await readdir(DIR)).filter((name) => /\.(ts|tsx)$/.test(name));
  } catch {
    return broken("src/modules/analytics/sections/rnd is not on disk");
  }
  const wrong = [];
  for (const name of Object.keys(NEEDS)) if (!names.includes(name)) wrong.push(name + " is not in the folder");
  for (const name of names) {
    const text = code(await readFile(path.join(DIR, name), "utf8"));
    const raw = RAW.exec(text);
    if (raw) wrong.push(name + " draws a raw <" + raw[1] + ">, not a kit piece");
    const look = OWN_LOOK.exec(text);
    if (look) wrong.push(name + " sets a look of its own: " + look[0]);
    const other = OTHER_MODULE.exec(text);
    if (other) wrong.push(name + " leans on another module: " + other[0]);
    const compares = COMPARES.exec(text);
    if (compares) wrong.push(name + " compares a reading with its baseline: " + compares[0]);
    const kit = kitNames(text);
    for (const piece of NEEDS[name] ?? []) if (!kit.includes(piece)) wrong.push(name + " does not take " + piece + " from @/shared/ui");
    if (name === "RndReadingsSection.tsx" && !/<AnalyticsSectionFrame\b/.test(text)) wrong.push(name + " does not draw inside AnalyticsSectionFrame");
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(names.length + " file(s): RndFeatureRow takes Badge and Button, RndReadingsSection EmptyState inside AnalyticsSectionFrame; no raw element, own style or colour, other module, or value-to-baseline comparison");
});
