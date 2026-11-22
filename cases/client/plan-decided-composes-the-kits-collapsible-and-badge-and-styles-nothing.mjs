// protects: src/modules/dispatcher/PlanDecided.tsx
// writes: none
//
// The "Decided for you" list composes the design language and builds nothing of its own (walks-decide-themselves,
// phase 5; the requirements: "screens compose them, never build their own"). PlanDecided.tsx takes Collapsible and
// Badge from @/shared/ui; it draws no raw control (button, input, select, textarea, dialog, table, svg, option, details,
// summary), sets no style prop, names no palette colour class or colour literal, imports no stylesheet and leans on no
// module but the dispatcher's own. A piece the kit lacks belongs in src/shared/ui, never here.
//
// The file is read as text, comments left out; nothing is imported or run.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PIECE = path.join(REPO, "src/modules/dispatcher/PlanDecided.tsx");
const RAW = /<(button|input|select|textarea|dialog|table|svg|option|details|summary)\b/;
const STYLE = /\sstyle=\{/;
const PALETTE = "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white";
const COLOUR_CLASS = new RegExp("(^|[\\s:'\"])(text|bg|border|fill|stroke|ring|outline|from|via|to|decoration|divide|shadow|accent|caret)-(" + PALETTE + ")(-\\d{2,3})?(\\/\\d+)?(?=$|[\\s'\"])");
const COLOUR_LITERAL = /(#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch|oklab)\()/;
const STYLESHEET = /import\s+(?:[^'"]*from\s+)?['"][^'"]+\.(css|scss|sass|less)['"]/;
const OTHER_MODULE = /from\s+['"]@\/modules\/(?!dispatcher\/)[^'"]+['"]/;
const WANTS = ["Collapsible", "Badge"];

const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function kitNames(text) {
  const names = new Set();
  for (const m of text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]@\/shared\/ui['"]/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0];
      if (name) names.add(name);
    }
  }
  return names;
}

runCase(async () => {
  let text;
  try {
    text = code(await readFile(PIECE, "utf8"));
  } catch {
    return broken("src/modules/dispatcher/PlanDecided.tsx is not on disk");
  }
  const wrong = [];
  const raw = RAW.exec(text);
  if (raw) wrong.push("it draws a raw <" + raw[1] + ">");
  if (STYLE.test(text)) wrong.push("it sets a style prop");
  const cls = COLOUR_CLASS.exec(text);
  if (cls) wrong.push("it names the colour class " + cls[0].trim());
  const lit = COLOUR_LITERAL.exec(text);
  if (lit) wrong.push("it holds the colour " + lit[0]);
  if (STYLESHEET.test(text)) wrong.push("it imports a stylesheet");
  const other = OTHER_MODULE.exec(text);
  if (other) wrong.push("it leans on another module: " + other[0]);
  const names = kitNames(text);
  const missing = WANTS.filter((w) => !names.has(w));
  if (missing.length > 0) wrong.push("it takes no " + missing.join(", ") + " from @/shared/ui");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("PlanDecided.tsx takes " + [...names].join(", ") + " from @/shared/ui and draws no raw control, style prop, palette class, colour literal or stylesheet, leaning on no module but the dispatcher's");
});
