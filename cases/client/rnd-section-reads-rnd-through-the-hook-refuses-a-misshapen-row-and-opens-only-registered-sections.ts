// protects: src/modules/analytics/sections/rnd/RndReadingsSection.tsx, src/modules/analytics/sections/rnd/rndReadingFigures.ts, src/modules/analytics/sections/registry.ts
// writes: none
//
// The R&D section filled (rnd-adopted-measures, phase 5). RndReadingsSection reads its one answer through
// useAnalyticsSection('rnd', days, narrowRndReadings) inside AnalyticsSectionFrame; no file of sections/rnd holds a FILL:
// marker or a stand-in reading, a timer that re-reads, or a read of the server beside the hook (the tab is read when it is
// opened and on Refresh, nothing wakes on a clock). The narrowing in rndReadingFigures answers a whole document key for
// key and null for a document with one mistyped key anywhere in a row (one misshapen row makes the answer misshapen), and
// ownSectionOf names the registry row a measure's section points at only when ANALYTICS_SECTIONS holds that id, so a press
// is offered only for a tab that exists.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FOLDER = path.join(REPO, "src/modules/analytics/sections/rnd");
const SECTION = path.join(FOLDER, "RndReadingsSection.tsx");
const FIGURES = path.join(FOLDER, "rndReadingFigures.ts");

const measure = (section: string | null) => ({ says: "Outdated patterns standing", promised: "41 findings (spike)", baseline: 41, unit: "patterns", better: "lower", section, set_at: "2026-11-25T10:00:00Z", set_by: "athena" });
const row = (over: Record<string, unknown>) => ({ candidate: "c", plan: "p", title: "T", epic: null, word: "idea", adopted_at: "2026-11-25T09:00:00Z", measure: null, state: "none", reading: null, fault: null, ...over });
const GOOD = {
  generated_at: "2026-11-25T12:00:00Z",
  features: [
    row({ candidate: "a", word: "shipped", measure: measure("web-walk"), state: "read", reading: { value: 12, detail: null, against: "worse" } }),
    row({ candidate: "b" }),
    row({ candidate: "c", word: null, measure: measure(null), state: "failed", fault: "it ran past 20 seconds" }),
  ],
};
const clone = () => JSON.parse(JSON.stringify(GOOD));
const BAD: [string, () => unknown][] = [
  ["a state the dispatcher never prints", () => { const d = clone(); d.features[1].state = "pending"; return d; }],
  ["a reading value that is a string", () => { const d = clone(); d.features[0].reading.value = "12"; return d; }],
  ["a measure better of another word", () => { const d = clone(); d.features[2].measure.better = "down"; return d; }],
  ["a generated_at that is a number", () => { const d = clone(); d.generated_at = 1; return d; }],
];

function canon(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canon).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canon((value as any)[k])).join(",") + "}";
  return JSON.stringify(value === undefined ? "<absent>" : value);
}
const first = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0];
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

runCase(async () => {
  const wrong: string[] = [];
  let section = "";
  try { section = await readFile(SECTION, "utf8"); } catch { return broken("sections/rnd/RndReadingsSection.tsx is not on disk"); }
  if (!/useAnalyticsSection\s*(<[^>]*>)?\s*\(\s*['"]rnd['"]\s*,\s*days\s*,\s*narrowRndReadings\s*\)/.test(section)) wrong.push("RndReadingsSection does not read useAnalyticsSection('rnd', days, narrowRndReadings)");
  if (!/<AnalyticsSectionFrame\b/.test(section)) wrong.push("RndReadingsSection draws no AnalyticsSectionFrame");
  for (const name of (await readdir(FOLDER)).filter((n) => /\.(ts|tsx)$/.test(n))) {
    const body = await readFile(path.join(FOLDER, name), "utf8");
    if (/\bFILL:/.test(body)) wrong.push("a FILL: marker is left in " + name);
    if (/rndFake|fakeRnd|fakeReadings|readingsFake/i.test(body) || /fake/i.test(name)) wrong.push("a stand-in reading is in " + name);
    if (/\bset(Interval|Timeout)\s*\(/.test(code(body))) wrong.push("a timer is in " + name);
    if (/\bfetch\s*\(|authenticatedFetch|\/api\//.test(code(body))) wrong.push("a read beside useAnalyticsSection is in " + name);
  }
  let figures: any;
  try { figures = await import(pathToFileURL(FIGURES).href); } catch (e) { return broken("rndReadingFigures.ts would not load: " + first(e)); }
  if (typeof figures.narrowRndReadings !== "function" || typeof figures.ownSectionOf !== "function") return broken("rndReadingFigures.ts exports no narrowRndReadings or no ownSectionOf");
  const whole = figures.narrowRndReadings(clone());
  if (canon(whole) !== canon(GOOD)) wrong.push("a whole document narrows to " + canon(whole).slice(0, 200));
  for (const [what, make] of BAD) {
    const got = figures.narrowRndReadings(make());
    if (got !== null) wrong.push("a document with " + what + " narrows to an answer, not null");
  }
  const opens = (section: string | null, withMeasure = true) => figures.ownSectionOf(row({ measure: withMeasure ? measure(section) : null }));
  const named = opens("web-walk");
  if (!named || named.id !== "web-walk") wrong.push("a measure naming web-walk is offered " + JSON.stringify(named?.id ?? null));
  if (opens("no-such-tab") !== null) wrong.push("a measure naming an id the registry lacks is still offered a section");
  if (opens(null) !== null || opens(null, false) !== null) wrong.push("a feature with no section or no measure is offered a section");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("RndReadingsSection reads useAnalyticsSection('rnd', days, narrowRndReadings) in its frame, no marker, stand-in, timer or own read; the narrowing carries 3 rows and refuses " + BAD.length + " mistyped documents; only web-walk, a registry id, is offered");
});
