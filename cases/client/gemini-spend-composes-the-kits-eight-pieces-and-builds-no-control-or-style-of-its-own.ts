// protects: src/modules/gemini-spend
// writes: none
//
// Astrolabe decides which components exist (design-system/README.md; gemini-spend seam 9: "drawn to Astrolabe and
// composed only from the kit in src/shared/ui"). So the Gemini panel takes the window, the total, the days, each section
// head, each switch, each mark, a door's failure and the first read from the kit's barrel (SegmentedControl, Readout,
// DayBars, Rule, Switch, Badge, Banner, Spinner) and builds no control and no paint of its own: no raw interactive or
// drawing element, no style prop, no stylesheet, no palette colour class, no kit file reached past the barrel, no other
// module's parts and no package beyond react, react-i18next and lucide-react, the house's icon set (the kit draws its own glyphs from
// it and exports no Icon). A tone reaches paint through the kit's own props.
//
// The module's files are read as text. index.ts must export GeminiUsagePanel, the one name ApiPanel imports.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODULE = path.join(REPO, "src/modules/gemini-spend");
const PIECES = ["SegmentedControl", "Readout", "DayBars", "Rule", "Switch", "Badge", "Banner", "Spinner"];
const PALETTE = /\b(?:text|bg|border|fill|stroke|ring|from|to|via|divide|outline|decoration|shadow|accent|caret)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white)(?:-\d{2,3})?\b/;
const RAW = /<(button|input|select|textarea|svg|canvas|a)\b/;

runCase(async () => {
  let names: string[];
  try {
    names = (await readdir(MODULE)).filter((name) => /\.(tsx?|css|scss)$/.test(name));
  } catch {
    return broken("src/modules/gemini-spend is not on disk");
  }
  const wrong: string[] = [];
  const used = new Set<string>();
  for (const name of names) {
    if (/\.s?css$/.test(name)) { wrong.push(name + " is a stylesheet"); continue; }
    const text = await readFile(path.join(MODULE, name), "utf8");
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const m of code.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (/\.s?css$/.test(spec)) wrong.push(name + " imports the stylesheet " + spec);
      else if (spec === "react" || spec === "react-i18next" || spec === "lucide-react" || spec === "@/shared/ui") continue;
      else if (spec.startsWith("@/shared/ui/")) wrong.push(name + " reaches the kit past its barrel: " + spec);
      else if (spec.startsWith("@/modules/") && !spec.startsWith("@/modules/gemini-spend")) wrong.push(name + " imports another module: " + spec);
      else if (!spec.startsWith("@/") && !spec.startsWith(".")) wrong.push(name + " imports the package " + spec);
    }
    for (const m of code.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@\/shared\/ui['"]/g)) {
      for (const part of m[1].split(",")) { const piece = part.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, ""); if (piece) used.add(piece); }
    }
    const raw = code.match(RAW);
    if (raw) wrong.push(name + " draws a raw <" + raw[1] + ">");
    if (/\bstyle=\{/.test(code)) wrong.push(name + " sets a style prop");
    const colour = code.match(PALETTE);
    if (colour) wrong.push(name + " names the palette colour class " + colour[0]);
  }
  const missing = PIECES.filter((piece) => !used.has(piece));
  if (missing.length > 0) wrong.push("no file imports " + missing.join(", ") + " from @/shared/ui");
  let index = "";
  try { index = await readFile(path.join(MODULE, "index.ts"), "utf8"); } catch { wrong.push("the module has no index.ts"); }
  if (index && !/export\s+(?:const|function|let)\s+GeminiUsagePanel\b|export\s*\{[^}]*\bGeminiUsagePanel\b[^}]*\}/.test(index)) wrong.push("index.ts exports no GeminiUsagePanel");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(names.length + " files compose " + [...used].sort().join(", ") + " from @/shared/ui and build nothing of their own");
});
