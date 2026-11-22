// protects: src/modules/i18n/locales/en/common.json, src/modules/i18n/locales/de/common.json, src/modules/i18n/locales/es/common.json, src/modules/i18n/locales/fr/common.json, src/modules/i18n/locales/it/common.json, src/modules/i18n/locales/ja/common.json, src/modules/i18n/locales/ko/common.json, src/modules/i18n/locales/ru/common.json, src/modules/i18n/locales/tr/common.json, src/modules/i18n/locales/zh-CN/common.json, src/modules/i18n/locales/zh-TW/common.json, src/modules/dispatcher/PlanFace.tsx, src/modules/roadmap/hooks/useStepPhrase.ts
// writes: none
// PlanStatusBadge draws t('dispatcher.status.<status>') and useStepPhrase t('roadmap.step.<step>'): a status or step with no phrase
// shows the raw key on the card. Walks-decide-themselves adds the plan status gaps and the roadmap step gaps; every locale file that
// phrases statuses or steps phrases gaps, and English says the intent's words.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const LOCALES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/modules/i18n/locales");
const WANT = { "dispatcher.status": "finished with gaps", "roadmap.step": "finished with gaps — being healed" };

runCase(async () => {
  const wrong = [];
  let homes = 0;
  let english = 0;
  for (const lang of fs.readdirSync(LOCALES).sort()) {
    const file = path.join(LOCALES, lang, "common.json");
    if (!fs.existsSync(file)) continue;
    const words = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const [where, home] of [["dispatcher.status", words?.dispatcher?.status], ["roadmap.step", words?.roadmap?.step]]) {
      if (!home || typeof home !== "object") continue;
      homes += 1;
      const said = home.gaps;
      if (typeof said !== "string" || said.trim() === "") { wrong.push(lang + " " + where + ".gaps is " + JSON.stringify(said)); continue; }
      if (lang === "en") {
        english += 1;
        if (said.trim().toLowerCase() !== WANT[where]) wrong.push("en " + where + ".gaps says " + JSON.stringify(said) + ", not " + JSON.stringify(WANT[where]));
      }
    }
  }
  if (homes === 0) return cannotRun("no locale file holds dispatcher.status or roadmap.step");
  if (wrong.length > 0) return broken(wrong.slice(0, 4).join("; ") + (wrong.length > 4 ? " (+" + (wrong.length - 4) + " more)" : ""));
  if (english < 2) return broken("English phrases gaps in " + english + " of its two homes");
  return held("each of the " + homes + " dispatcher.status / roadmap.step homes across the locales phrases gaps, English in the intent's words");
});
