// protects: src/modules/dispatcher/PlanDecided.tsx, src/modules/i18n/locales/en/common.json, src/modules/i18n/locales/de/common.json, src/modules/i18n/locales/es/common.json, src/modules/i18n/locales/fr/common.json, src/modules/i18n/locales/it/common.json, src/modules/i18n/locales/ja/common.json, src/modules/i18n/locales/ko/common.json, src/modules/i18n/locales/ru/common.json, src/modules/i18n/locales/tr/common.json, src/modules/i18n/locales/zh-CN/common.json, src/modules/i18n/locales/zh-TW/common.json
// writes: none
// walks-decide-themselves, phase 6: every word the "Decided for you" list draws is a locale key under dispatcher.decided,
// read through t(). PlanDecided.tsx, its comments set aside, writes none of its English words in code; every
// dispatcher.decided key it asks resolves in en/common.json to a non-empty string (a plural by its _one/_other pair; a key
// built from a value, like by.<who>, by its parent block); English says the intent's words, "Decided for you",
// "Gaps being healed" and "To undo"; and any other locale file that holds a dispatcher.decided block holds every key asked.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PIECE = path.join(REPO, "src/modules/dispatcher/PlanDecided.tsx");
const LOCALES = path.join(REPO, "src/modules/i18n/locales");
const HOME = "dispatcher.decided";
// English the scaffold wrote in code; a key-like string (dispatcher.decided.earlier) is a key, never a word.
const ENGLISH = /Decided for you|Gaps being healed|To undo|Was open|the builder|the designer|a rule|gaps? below|Show \d+ earlier|whole feature/;
const englishIn = (code) => [...code.matchAll(/(['"])([^'"\n]*)\1/g)].map((m) => m[2]).find((s) => !/^[\w.-]+$/.test(s) && ENGLISH.test(s));

const at = (obj, dotted) => dotted.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
const said = (v) => typeof v === "string" && v.trim() !== "";
const resolves = (words, key) => said(at(words, key)) || (said(at(words, key + "_one")) && said(at(words, key + "_other")));
const flat = (v) => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(flat) : []);

runCase(async () => {
  if (!fs.existsSync(PIECE)) return broken("src/modules/dispatcher/PlanDecided.tsx is not on disk");
  const code = fs.readFileSync(PIECE, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const english = englishIn(code);
  const prefix = (code.match(/keyPrefix:\s*['"]([^'"]+)['"]/) ?? [])[1] ?? "";
  const asked = new Set();
  const blocks = new Set();
  for (const m of code.matchAll(/\bt\(\s*(['"])([^'"]+)\1/g)) asked.add(prefix ? prefix + "." + m[2] : m[2]);
  for (const m of code.matchAll(/\bt\(\s*`([^`]+)`/g)) {
    const whole = prefix ? prefix + "." + m[1] : m[1];
    const cut = whole.indexOf("$" + "{");
    if (cut < 0) asked.add(whole); else blocks.add(whole.slice(0, cut).replace(/\.$/, ""));
  }
  const mine = [...asked].filter((k) => k.startsWith(HOME + "."));
  const myBlocks = [...blocks].filter((k) => k === HOME || k.startsWith(HOME + "."));
  const enFile = path.join(LOCALES, "en", "common.json");
  if (!fs.existsSync(enFile)) return cannotRun("en/common.json is not on disk");
  const en = JSON.parse(fs.readFileSync(enFile, "utf8"));
  const wrong = [];
  if (english) wrong.push("PlanDecided.tsx still writes English in code: " + JSON.stringify(english.slice(0, 60)));
  if (mine.length + myBlocks.length === 0) wrong.push("PlanDecided.tsx asks no " + HOME + " key through t()");
  for (const k of mine) if (!resolves(en, k)) wrong.push("en/common.json has no word for " + k);
  for (const b of myBlocks) { const v = at(en, b); if (!v || typeof v !== "object" || flat(v).length === 0) wrong.push("en/common.json has no block " + b + " for the key built from a value"); }
  const home = flat(at(en, HOME));
  for (const phrase of ["Decided for you", "Gaps being healed", "To undo"]) if (!home.some((v) => v.includes(phrase))) wrong.push('en ' + HOME + ' never says "' + phrase + '"');
  let others = 0;
  for (const lang of fs.readdirSync(LOCALES).sort()) {
    if (lang === "en") continue;
    const file = path.join(LOCALES, lang, "common.json");
    if (!fs.existsSync(file)) continue;
    const words = JSON.parse(fs.readFileSync(file, "utf8"));
    if (at(words, HOME) === undefined) continue;
    others += 1;
    for (const k of mine) if (!resolves(words, k)) wrong.push(lang + "/common.json holds " + HOME + " but no word for " + k);
    for (const b of myBlocks) if (!at(words, b)) wrong.push(lang + "/common.json holds " + HOME + " but no block " + b);
  }
  if (wrong.length > 0) return broken(wrong.slice(0, 4).join("; ") + (wrong.length > 4 ? " (+" + (wrong.length - 4) + " more)" : ""));
  return held(mine.length + " keys and " + myBlocks.length + " blocks under " + HOME + " resolve in en (and in " + others + " other locale files holding the block); no English is written in code");
});
