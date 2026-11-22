// protects: src/modules/analytics/sections/code-mode/CodeModeSection.tsx, src/modules/analytics/sections/code-mode/CodeModeCompare.tsx, src/modules/analytics/sections/code-mode/CodeModeOutcomes.tsx, src/modules/analytics/sections/code-mode/CodeModeCauses.tsx, src/modules/analytics/sections/code-mode/CodeModeTrend.tsx, src/modules/analytics/sections/code-mode/codeModeFigures.ts, /home/lyphe/.claude/hooks/plan_runner/code_mode/switch.py
// writes: none
//
// Who holds the numbers (analytics-code-mode, constraint 4): every figure the Code Mode section draws is the verb's,
// and the kinds are the answer's. No file of the folder names a switch.KINDS key or label as a string or as JSX words,
// and none takes a median (no median named, no middle of a sorted list). The kinds are read from the house's own
// switch.KINDS, so a kind a later plan adds is checked with no change here; the files are read with comments left out.

import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FOLDER = path.join(REPO, "src/modules/analytics/sections/code-mode");
const HOOKS = "/home/lyphe/.claude/hooks";
const KINDS_PY = "import json, sys; sys.path.insert(0, sys.argv[1]); from plan_runner.code_mode import switch; print(json.dumps([[k, v.get('label', '')] for k, v in switch.KINDS.items()]))";
// A median TAKEN: a function defined for it, or the middle of a list. The word itself is the verb's figure's name (the
// Compare part's Median or Total, and its accessor that reads a row's median) and is no computation.
const MEDIAN = /function\s+\w*median\w*\s*\(|\b(?:const|let|var)\s+\w*median\w*\s*=\s*(?:\([^)]*\)|\w+)\s*=>|\.length\s*\/\s*2\b|\.length\s*>>\s*1\b|\.sort\([^)]*\)\s*\[|\[\s*Math\.(?:floor|ceil)\([^\]]*\/\s*2\s*\)\s*\]/i;

const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");

runCase(async () => {
  let kinds;
  try {
    kinds = JSON.parse(execFileSync("python3", ["-I", "-c", KINDS_PY, HOOKS], { encoding: "utf8", timeout: 30000 }));
  } catch (error) {
    return cannotRun("switch.KINDS could not be read: " + String(error.message).split("\n")[0]);
  }
  const names = new Set(kinds.flat().filter((s) => typeof s === "string" && s.length > 0));
  if (names.size < 2) return cannotRun("switch.KINDS read as " + JSON.stringify(kinds));
  let files;
  try {
    files = (await readdir(FOLDER)).filter((f) => /\.(tsx?|mjs)$/.test(f));
  } catch {
    return broken("the folder " + FOLDER + " is not on disk");
  }
  const wrong = [];
  for (const file of files) {
    const text = code(await readFile(path.join(FOLDER, file), "utf8"));
    const strings = [...text.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`$]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3]);
    const jsx = [...text.matchAll(/>\s*([^<>{}\n]+?)\s*</g)].map((m) => m[1]);
    const named = [...new Set([...strings, ...jsx].filter((s) => names.has(s.trim())))];
    if (named.length > 0) wrong.push(file + " names kinds of its own: " + named.join(", "));
    const median = MEDIAN.exec(text);
    if (median) wrong.push(file + " takes a median: " + median[0]);
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(files.length + " files name none of the " + names.size + " kind keys and labels of switch.KINDS and take no median");
});
