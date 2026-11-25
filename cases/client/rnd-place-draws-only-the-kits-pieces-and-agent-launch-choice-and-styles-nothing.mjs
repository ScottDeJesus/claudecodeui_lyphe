// The R&D place composes the design language and builds nothing of its own (rnd-area phase 5, interface G; the requirements:
// "screens compose them, never build their own"). Every file under src/modules/rnd outside its story/ draws no raw control
// (button, input, select, textarea, dialog, table, svg, option), sets no style prop, holds no palette colour class or colour
// literal, is no stylesheet. A file that draws leans on no module but its own and AgentLaunchChoice; the data seams the fill
// wired (RndFeed.tsx, hooks/, startSpikeChat.ts, rndWire.ts: they draw nothing) may lean only on the lanes they read —
// @/modules/live-bus, @/modules/roadmap and @/modules/dispatcher (rnd-area phase 6). The pieces the design names come from
// @/shared/ui: RndPanel its SegmentedControl, ScrollArea, EmptyState, SignalLoop and Button; CandidateRow its Badge;
// CandidateOpening its Opening, KeyValueList and Excerpt; RndSettingsSheet its Sheet and Switch, with
// AgentLaunchChoice from the agent-launch module. One native button is allowed: CandidateRow's whole line as its press, the
// pattern the roadmap's PanelRows rows use; any second one, or one in another file, is a control built by hand.
//
// The files are read as text, comments left out; nothing is imported or run.
//
// protects: src/modules/rnd/
// writes: none

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RND = path.join(REPO, "src/modules/rnd");
const RAW = /<(button|input|select|textarea|dialog|table|svg|option)\b/;
const STYLE = /\sstyle=\{/;
const PALETTE = "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white";
const COLOUR_CLASS = new RegExp("(^|[\\s:'\"])(text|bg|border|fill|stroke|ring|outline|from|via|to|decoration|divide|shadow|accent|caret)-(" + PALETTE + ")(-\\d{2,3})?(\\/\\d+)?(?=$|[\\s'\"])");
const COLOUR_LITERAL = /(#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch|oklab)\()/;
const OTHER_MODULE = /from\s+['"]@\/modules\/(?!rnd\/|agent-launch['"\/])[^'"]+['"]/;
const DATA_LANE = /from\s+['"]@\/modules\/(live-bus|roadmap|dispatcher)['"]/;
const isDataSeam = (rel) => rel === "RndFeed.tsx" || rel === "startSpikeChat.ts" || rel === "rndWire.ts" || rel.startsWith("hooks" + path.sep);
const CHOICE = /import\s*\{[^}]*\bAgentLaunchChoice\b[^}]*\}\s*from\s*['"]@\/modules\/agent-launch(\/AgentLaunchChoice)?['"]/;
const WANTS = {
  "RndPanel.tsx": ["SegmentedControl", "ScrollArea", "EmptyState", "SignalLoop", "Button"],
  "CandidateRow.tsx": ["Badge"],
  "CandidateOpening.tsx": ["Opening", "KeyValueList", "Excerpt"],
  "RndSettingsSheet.tsx": ["Sheet", "Switch"],
};

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

async function filesUnder(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (ent.isDirectory() && ent.name === "story") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await filesUnder(full)));
    else out.push(full);
  }
  return out;
}

runCase(async () => {
  let files;
  try {
    files = await filesUnder(RND);
  } catch {
    return broken("src/modules/rnd is not on disk");
  }
  const wrong = [];
  const kit = {};
  let scanned = 0;
  for (const file of files) {
    const rel = path.relative(RND, file);
    if (/\.(css|scss|sass|less)$/.test(file)) { wrong.push(rel + " is a stylesheet"); continue; }
    if (!/\.(ts|tsx)$/.test(file)) continue;
    scanned += 1;
    const text = code(await readFile(file, "utf8"));
    // The row's own press is the one native button allowed: a whole line as one press, as the roadmap's PanelRows rows are.
    const raw = RAW.exec(path.basename(file) === "CandidateRow.tsx" ? text.replace(/<button\b/, "<row-press") : text);
    if (raw) wrong.push(rel + " draws a raw <" + raw[1] + ">");
    if (STYLE.test(text)) wrong.push(rel + " sets a style prop");
    const cls = COLOUR_CLASS.exec(text);
    if (cls) wrong.push(rel + " names the colour class " + cls[0].trim());
    const lit = COLOUR_LITERAL.exec(text);
    if (lit) wrong.push(rel + " holds the colour " + lit[0]);
    const lean = new RegExp(OTHER_MODULE.source, "g");
    for (const other of text.matchAll(lean)) {
      if (isDataSeam(rel) && DATA_LANE.test(other[0])) continue;
      wrong.push(rel + " leans on another module: " + other[0]);
      break;
    }
    kit[path.basename(file)] = { names: kitNames(text), choice: CHOICE.test(text) };
  }
  for (const [name, wants] of Object.entries(WANTS)) {
    const seen = kit[name];
    if (!seen) { wrong.push(name + " is not on disk"); continue; }
    const missing = wants.filter((w) => !seen.names.has(w));
    if (missing.length > 0) wrong.push(name + " takes no " + missing.join(", ") + " from @/shared/ui");
  }
  if (kit["RndSettingsSheet.tsx"] && !kit["RndSettingsSheet.tsx"].choice) wrong.push("RndSettingsSheet.tsx does not take AgentLaunchChoice");
  if (scanned === 0) wrong.push("the place holds no .ts or .tsx file");
  if (wrong.length > 0) return broken(wrong.slice(0, 8).join("; ") + (wrong.length > 8 ? " (+" + (wrong.length - 8) + ")" : ""));
  return held(scanned + " files: no raw control, style prop, palette class or colour literal; drawn file leaning on a module but its own and AgentLaunchChoice, no data seam on one but live-bus, roadmap and dispatcher; each named piece taken from @/shared/ui");
});
