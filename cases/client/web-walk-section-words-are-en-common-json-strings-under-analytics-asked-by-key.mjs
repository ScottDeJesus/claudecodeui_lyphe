// protects: src/modules/analytics/sections/web-walk/WebWalkSection.tsx, src/modules/analytics/sections/web-walk/WebWalkGlance.tsx, src/modules/analytics/sections/web-walk/WebWalkTrend.tsx, src/modules/analytics/sections/web-walk/WebWalkChecks.tsx, src/modules/analytics/sections/web-walk/WebWalkApps.tsx, src/modules/analytics/sections/web-walk/webWalkFigures.ts, src/modules/i18n/locales/en/common.json
// writes: none
//
// The Web walks section's words live under analytics. in the en/common.json the Code Mode section's words live in
// (web-helper, phase 7), and the folder asks for them by key. Every analytics.* key its files name, as a whole literal
// or as a key prefix constant joined to a word (UNITS + 'share'), is a string there, or a plural with its _other form,
// so no word of the section draws as a raw key.
//
// The files are read as text, comments left out.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(REPO, "src/modules/analytics/sections/web-walk");
const LOCALE = path.join(REPO, "src/modules/i18n/locales/en/common.json");
const FEWEST_KEYS = 5;
const LITERAL = /['"`](analytics\.[A-Za-z0-9_.]*[A-Za-z0-9_])['"`]/g;
const PREFIX = /const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*['"](analytics\.[A-Za-z0-9_.]*\.)['"]/g;

const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

runCase(async () => {
  let names;
  try {
    names = (await readdir(DIR)).filter((name) => /\.(ts|tsx)$/.test(name));
  } catch {
    return broken("src/modules/analytics/sections/web-walk is not on disk");
  }
  if (names.length === 0) return broken("the web-walk folder holds no .ts or .tsx file");
  const en = JSON.parse(await readFile(LOCALE, "utf8"));
  const at = (key) => key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), en);
  const resolves = (key) => typeof at(key) === "string" || typeof at(key + "_other") === "string";
  const asked = new Map();
  for (const name of names) {
    const text = code(await readFile(path.join(DIR, name), "utf8"));
    for (const m of text.matchAll(LITERAL)) asked.set(m[1], name);
    for (const c of text.matchAll(PREFIX)) {
      const joined = new RegExp("\\b" + c[1] + "\\s*\\+\\s*['\"]([A-Za-z0-9_.]+)['\"]", "g");
      for (const u of text.matchAll(joined)) asked.set(c[2] + u[1], name);
    }
  }
  const own = [...asked.keys()].filter((key) => key.startsWith("analytics.webWalk."));
  if (own.length < FEWEST_KEYS) return broken("the folder names only " + own.length + " analytics.webWalk. key(s); its words are not asked by key");
  const unspelled = [...asked].filter(([key]) => !resolves(key)).map(([key, name]) => key + " (" + name + ")");
  if (unspelled.length > 0) return broken(unspelled.length + " of " + asked.size + " key(s) the folder asks are not strings in en/common.json: " + unspelled.slice(0, 8).join(", "));
  return held(asked.size + " analytics key(s) asked across " + names.length + " file(s), " + own.length + " under analytics.webWalk., each a string in en/common.json");
});
