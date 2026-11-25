// protects: src/modules/analytics/sections/rnd/, src/modules/i18n/locales/en/common.json
// writes: none
//
// The Analytics R&D section's words live under analytics.rnd in en/common.json (rnd-adopted-measures, phase 4), and the
// folder asks for them by key. Every analytics.* key its files name is a string there, or a plural with its _other form;
// the two states a row says in words are asked by key ("No measure named yet" for a feature with no measure, "Not built
// yet" for one whose plan is not complete); and the tab's own name, analytics.sections.rnd, reads "R&D".
//
// The files are read as text, comments left out.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(REPO, "src/modules/analytics/sections/rnd");
const LOCALE = path.join(REPO, "src/modules/i18n/locales/en/common.json");
const FEWEST_KEYS = 6;
const STATE_WORDS = ["No measure named yet", "Not built yet"];
const TAB = { key: "analytics.sections.rnd", word: "R&D" };
const LITERAL = /['"](analytics\.[A-Za-z0-9_.]*[A-Za-z0-9_])['"]/g;

const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

runCase(async () => {
  let names;
  try {
    names = (await readdir(DIR)).filter((name) => /\.(ts|tsx)$/.test(name));
  } catch {
    return broken("src/modules/analytics/sections/rnd is not on disk");
  }
  if (names.length === 0) return broken("the rnd folder holds no .ts or .tsx file");
  const en = JSON.parse(await readFile(LOCALE, "utf8"));
  const at = (key) => key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), en);
  const resolves = (key) => typeof at(key) === "string" || typeof at(key + "_other") === "string";
  const asked = new Map();
  for (const name of names) {
    const text = code(await readFile(path.join(DIR, name), "utf8"));
    for (const m of text.matchAll(LITERAL)) asked.set(m[1], name);
  }
  const wrong = [];
  const own = [...asked.keys()].filter((key) => key.startsWith("analytics.rnd."));
  if (own.length < FEWEST_KEYS) wrong.push("the folder names only " + own.length + " analytics.rnd. key(s); its words are not asked by key");
  const unspelled = [...asked].filter(([key]) => !resolves(key)).map(([key, name]) => key + " (" + name + ")");
  if (unspelled.length > 0) wrong.push(unspelled.length + " of " + asked.size + " key(s) the folder asks are not strings in en/common.json: " + unspelled.slice(0, 8).join(", "));
  const said = new Set(own.map((key) => at(key)));
  for (const word of STATE_WORDS) if (!said.has(word)) wrong.push('no analytics.rnd. key the folder asks reads "' + word + '"');
  if (at(TAB.key) !== TAB.word) wrong.push(TAB.key + " reads " + JSON.stringify(at(TAB.key)) + ", not " + JSON.stringify(TAB.word));
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(asked.size + " analytics key(s) asked across " + names.length + " file(s), " + own.length + " under analytics.rnd., each a string in en/common.json, the two state words among them, the tab named R&D");
});
