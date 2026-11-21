// protects: src/modules/i18n/locales
// writes: none
//
// The place's label is tabs.analytics (analytics-code-mode, interfaces H and J): "Analytics" in en, and spelled in every
// locale that spells tabs.schedules, so the rail, the wheel and the palette never draw a key path, nor fall to English
// where the views beside it speak the reader's language. Every JSON file of every locale is read; a file that spells
// tabs.schedules must spell tabs.analytics as words.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LOCALES = path.join(REPO, "src/modules/i18n/locales");

runCase(async () => {
  const wrong = [];
  const spelled = [];
  let english;
  const langs = (await readdir(LOCALES, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  for (const lang of langs) {
    for (const file of (await readdir(path.join(LOCALES, lang))).filter((name) => name.endsWith(".json")).sort()) {
      let json;
      try {
        json = JSON.parse(await readFile(path.join(LOCALES, lang, file), "utf8"));
      } catch {
        continue;
      }
      const tabs = json && typeof json.tabs === "object" && json.tabs !== null ? json.tabs : {};
      if (typeof tabs.schedules !== "string") continue;
      const word = tabs.analytics;
      if (typeof word !== "string" || word.trim() === "") wrong.push(lang + "/" + file + " spells tabs.schedules and not tabs.analytics");
      else spelled.push(lang + "=" + word);
      if (lang === "en") english = word;
    }
  }
  if (spelled.length === 0 && wrong.length === 0) return broken("no locale file spells tabs.schedules");
  if (english !== "Analytics") wrong.push("en reads tabs.analytics as " + JSON.stringify(english ?? null) + ", not \"Analytics\"");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(spelled.length + " locale files spell it: " + spelled.join(", "));
});
