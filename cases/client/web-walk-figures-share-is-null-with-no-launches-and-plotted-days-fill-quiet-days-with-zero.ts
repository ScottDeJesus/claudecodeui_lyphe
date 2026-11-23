// protects: src/modules/analytics/sections/web-walk/webWalkFigures.ts
// writes: none
//
// The Web walks section's arithmetic (web-helper, phase 7), asked of small hand-made answers shaped as web-walk
// reading's rows. The share on the helper is no share when no launch drove a browser (null, never 0% or NaN), 9 of 10
// reads 90, and a part above zero never reads as 0. The trend's days run from the later of the window's start and the
// history's first day to today, a day the answer holds no row for being zero on both series. An app's row counts the
// screens it opened and sums the times one was not reached, the most walked app first.
//
// webWalkFigures.ts imports types only, so it is imported in node as it stands.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIGURES = path.join(REPO, "src/modules/analytics/sections/web-walk/webWalkFigures.ts");

const firstLine = (error: unknown): string => String((error as Error)?.message ?? error).split("\n")[0];
const day = (d: string, walking: number, byHand: number) => ({ day: d, walks: walking * 3, launches_walking: walking, launches_by_hand: byHand, custom_steps: 0, faults: 0 });

runCase(async () => {
  let f: any;
  try {
    f = await import(pathToFileURL(FIGURES).href);
  } catch (error) {
    return broken("webWalkFigures.ts would not load: " + firstLine(error));
  }
  const missing = ["shareWords", "daysCovered", "launchDays", "appRows"].filter((name) => typeof f[name] !== "function");
  if (missing.length > 0) return broken("webWalkFigures.ts exports no " + missing.join(", "));
  const whole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  const wrong: string[] = [];

  const none = f.shareWords(0, 0);
  if (none !== null) wrong.push("a share of no launches is " + JSON.stringify(none) + ", not null");
  const ninety = f.shareWords(9, 10);
  if (!(ninety && String(ninety.key).endsWith(".share") && ninety.values?.value === whole.format(90))) wrong.push("9 of 10 reads " + JSON.stringify(ninety) + ", not 90 under a .share key");
  const tiny = f.shareWords(1, 5000);
  if (!tiny || (String(tiny.key).endsWith(".share") && tiny.values?.value === whole.format(0))) wrong.push("1 of 5000 reads " + JSON.stringify(tiny) + ", a zero");

  const young = f.launchDays([day("2026-11-12", 2, 1)], { firstDay: "2026-11-10", today: "2026-11-22", days: 30 });
  const youngSaid = JSON.stringify([young?.length, young?.[0]?.day, young?.at?.(-1)?.day]);
  if (youngSaid !== JSON.stringify([13, "2026-11-10", "2026-11-22"])) wrong.push("a 30-day window over a history from 2026-11-10 to 2026-11-22 plots " + youngSaid + ", not 13 days from 2026-11-10 to 2026-11-22");
  const quiet = young?.find?.((row: any) => row.day === "2026-11-11");
  if (!quiet || quiet.walking !== 0 || quiet.byHand !== 0) wrong.push("a day with no row reads " + JSON.stringify(quiet) + ", not zero on both series");
  const busy = young?.find?.((row: any) => row.day === "2026-11-12");
  if (!busy || busy.walking !== 2 || busy.byHand !== 1) wrong.push("2026-11-12 reads " + JSON.stringify(busy) + ", not 2 on the helper and 1 by hand");
  const old = f.launchDays([], { firstDay: "2026-10-01", today: "2026-11-22", days: 7 });
  const oldSaid = JSON.stringify([old?.length, old?.[0]?.day]);
  if (oldSaid !== JSON.stringify([7, "2026-11-16"])) wrong.push("a 7-day window over an older history plots " + oldSaid + ", not 7 days from 2026-11-16");

  const covered = [f.daysCovered({ firstDay: "2026-11-10", today: "2026-11-22", days: 30 }), f.daysCovered({ firstDay: "2026-11-10", today: "2026-11-22", days: 7 }), f.daysCovered({ firstDay: null, today: "2026-11-22", days: 30 })];
  if (JSON.stringify(covered) !== JSON.stringify([13, null, null])) wrong.push("days covered read " + JSON.stringify(covered) + ", not [13, null, null]");

  const rows = f.appRows([
    { app: "b", walks: 2, screens: [{ screen: "x", opened: 0, unreached: 1 }, { screen: "y", opened: 3, unreached: 0 }] },
    { app: "a", walks: 5, screens: [{ screen: "z", opened: 1, unreached: 2 }] },
  ]);
  const said = JSON.stringify((rows ?? []).map((row: any) => [row.app, row.walks, row.opened, row.unreached]));
  if (said !== JSON.stringify([["a", 5, 1, 2], ["b", 2, 1, 1]])) wrong.push("the app rows read " + said + ", not a (5 walks, 1 opened, 2 unreached) then b (2, 1, 1)");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("no launches is no share, 9 of 10 reads " + whole.format(90) + ", 1 of 5000 reads " + JSON.stringify(tiny?.values?.value) + "; days plot 13 then 7, quiet days zero; apps a then b with opened and unreached summed");
});
