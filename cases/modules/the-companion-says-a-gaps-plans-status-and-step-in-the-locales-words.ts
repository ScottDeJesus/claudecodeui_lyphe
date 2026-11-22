// protects: server/modules/companion/eyes/panel-words.ts, src/modules/i18n/locales/en/common.json
// writes: none
// The walks-decide-themselves house gives a finished plan with open gap tickets the status gaps, and its feature the step gaps.
// The companion does not read the locale: panel-words.ts keeps its own verbatim copy of dispatcher.status.* and roadmap.step.*,
// and planStatusWord falls back to the raw status word when the copy lacks the key. card-scopes.ts tells the companion each
// card's status through it, so a copy without gaps has the companion say "gaps" where every panel says FINISHED WITH GAPS.

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const ROOT = path.join(os.homedir(), ".claude", "claudecodeui_lyphe");

runCase(async () => {
  let locale: any;
  try { locale = JSON.parse(await readFile(path.join(ROOT, "src/modules/i18n/locales/en/common.json"), "utf8")); }
  catch (error) { return cannotRun("en/common.json did not read: " + String((error as Error)?.message ?? error).split("\n")[0]); }
  const status = locale?.dispatcher?.status?.gaps;
  const step = locale?.roadmap?.step?.gaps;
  if (typeof status !== "string" || typeof step !== "string") return cannotRun("en/common.json phrases no dispatcher.status.gaps or roadmap.step.gaps");
  const words: any = await import(path.join(ROOT, "server/modules/companion/eyes/panel-words.ts"));
  const said = words.planStatusWord("gaps");
  const copied = words.PANEL_WORDS["roadmap.step.gaps"];
  const wrong: string[] = [];
  if (said !== status) wrong.push("planStatusWord(gaps) says " + JSON.stringify(said) + ", the locale " + JSON.stringify(status));
  if (copied !== step) wrong.push("PANEL_WORDS roadmap.step.gaps is " + JSON.stringify(copied ?? null) + ", the locale " + JSON.stringify(step));
  if (wrong.length) return broken(wrong.join("; "));
  return held("the companion says a gaps plan " + JSON.stringify(said) + " and its step " + JSON.stringify(copied) + ", the locale's own words");
});
