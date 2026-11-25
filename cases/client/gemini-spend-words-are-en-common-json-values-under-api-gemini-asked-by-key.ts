// protects: src/modules/gemini-spend, src/modules/i18n/locales/en/common.json
// writes: none
//
// Every word the API tab's Gemini panel draws is a value under api.gemini. in en/common.json, asked by key (gemini-spend,
// seam 9: "en/common.json gains api.subtabs.gemini = \"Gemini\" and the panel's words under api.gemini"). A key the module
// asks that the locale does not spell is drawn as its own path on the screen; a key outside api.gemini. is a word
// borrowed from another area's block, which moves when that area's words do.
//
// The module's files are read as text: every literal t('…') call is a key asked. A literal a + follows, as in
// t('api.gemini.keys.holder.' + holder), is the head of a family of keys built at run time: it ends at a dot and the
// locale spells a block of words there, every leaf a string. A key built in a template or by a helper is not judged here.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODULE = path.join(REPO, "src/modules/gemini-spend");
const LOCALE = path.join(REPO, "src/modules/i18n/locales/en/common.json");
const MIN_KEYS = 10;

runCase(async () => {
  let found: string[];
  try {
    found = (await readdir(MODULE)).filter((name) => /\.tsx?$/.test(name)).map((name) => path.join(MODULE, name));
  } catch {
    return broken("src/modules/gemini-spend is not on disk");
  }
  const en = JSON.parse(await readFile(LOCALE, "utf8"));
  const spelled = (key: string): unknown => key.split(".").reduce((node: any, part) => (node && typeof node === "object" ? node[part] : undefined), en);
  const wrong: string[] = [];
  if (spelled("api.subtabs.gemini") !== "Gemini") wrong.push("api.subtabs.gemini reads " + JSON.stringify(spelled("api.subtabs.gemini")) + ', not "Gemini"');
  const asked = new Map<string, string>();
  const heads = new Map<string, string>();
  for (const file of found) {
    const text = await readFile(file, "utf8");
    const rel = path.basename(file);
    for (const m of text.matchAll(/\bt\(\s*(['"])([^'"\n]+)\1(\s*\+)?/g)) (m[3] ? heads : asked).set(m[2], rel);
  }
  if (asked.size < MIN_KEYS) wrong.push("only " + asked.size + " literal keys found in " + found.length + " files: the panel's words are not asked by key");
  for (const [key, rel] of asked) {
    if (!key.startsWith("api.gemini.")) { wrong.push(rel + " asks " + key + ", outside api.gemini."); continue; }
    const ok = typeof spelled(key) === "string" || (typeof spelled(key + "_one") === "string" && typeof spelled(key + "_other") === "string");
    if (!ok) wrong.push(rel + " asks " + key + ", which en/common.json does not spell");
  }
  const words = (node: unknown): boolean => typeof node === "string" || (node !== null && typeof node === "object" && Object.values(node).length > 0 && Object.values(node).every(words));
  for (const [head, rel] of heads) {
    if (!head.startsWith("api.gemini.")) { wrong.push(rel + " builds keys on " + head + ", outside api.gemini."); continue; }
    const block = head.endsWith(".") ? spelled(head.slice(0, -1)) : undefined;
    if (block === null || typeof block !== "object" || !words(block)) wrong.push(rel + " builds keys on " + head + ", where en/common.json spells no block of words");
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(asked.size + " keys and " + heads.size + " families asked across " + found.length + " files, each spelled under api.gemini.; api.subtabs.gemini is Gemini");
});
