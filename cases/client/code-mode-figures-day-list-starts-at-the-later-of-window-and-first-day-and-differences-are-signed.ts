// protects: src/modules/analytics/sections/code-mode/codeModeFigures.ts
// writes: none
//
// codeModeFigures.ts's derivations (analytics-code-mode, interface I): the plot's day list runs every day from the later
// of the window's start and first_day to today, oldest first, a day with no row of the kind as zeros, across a month end;
// it reads only rows of the kind asked (null is across kinds); failures read the Code Mode row's thrown above and
// refused + failed below; and the with-against-without difference is a signed share of the figure without, said through
// an analytics.codeMode.units key whose en words carry the sign. The module is imported as written, under node.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FOLDER = path.join(REPO, "src/modules/analytics/sections/code-mode");

function numberKeys(name: string): string[] {
  const src = fs.readFileSync(path.join(REPO, "src/shared/analytics-types.ts"), "utf8");
  const m = new RegExp("(?:type|interface)\\s+" + name + "\\b[^{]*\\{([\\s\\S]*?)\\n\\}").exec(src);
  return m ? [...m[1].matchAll(/^\s*(\w+)\??\s*:\s*number\b/gm)].map((x) => x[1]) : [];
}

async function english() {
  const i18next: any = (await import("i18next")).default;
  const { initReactI18next }: any = await import("react-i18next");
  const en = JSON.parse(fs.readFileSync(path.join(REPO, "src/modules/i18n/locales/en/common.json"), "utf8"));
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({ lng: "en", fallbackLng: "en", ns: ["common"], defaultNS: "common", resources: { en: { common: en } }, interpolation: { escapeValue: false }, react: { useSuspense: false } });
  const at = (key: string) => key.split(".").reduce((n: any, p: string) => (n && typeof n === "object" ? n[p] : undefined), en);
  return { t: i18n.t.bind(i18n), has: (key: string) => typeof at(key) === "string" || typeof at(key + "_one") === "string" || typeof at(key + "_other") === "string" };
}

const dates = (from: string, to: string) => { const out: string[] = []; for (let d = Date.parse(from + "T00:00:00Z"); d <= Date.parse(to + "T00:00:00Z"); d += 86400000) out.push(new Date(d).toISOString().slice(0, 10)); return out; };

runCase(async () => {
  const figures = numberKeys("CodeModeFigures");
  if (figures.length < 10) return cannotRun("src/shared/analytics-types.ts names " + figures.length + " number keys under CodeModeFigures");
  const words = await english();
  const mod: any = await import(path.join(FOLDER, "codeModeFigures.ts"));
  for (const name of ["dayList", "difference"]) if (typeof mod[name] !== "function") return broken("codeModeFigures.ts exports no " + name);
  const zero = Object.fromEntries(figures.map((k) => [k, 0]));
  const wrong: string[] = [];
  const days = (list: any[]) => list.map((d) => d.day);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

  const young = mod.dayList([], null, "launches", { firstDay: "2026-11-10", today: "2026-11-21", days: 30 });
  if (!same(days(young), dates("2026-11-10", "2026-11-21"))) wrong.push("a 30-day window over a history begun 11-10 draws " + young.length + " days from " + young[0]?.day + " to " + young.at(-1)?.day + ", not 11-10..11-21");
  if (young.some((d: any) => d.figures[0] !== 0 || d.figures[1] !== 0)) wrong.push("a day with no row is not zeros");
  const old = mod.dayList([], null, "launches", { firstDay: "2026-09-01", today: "2026-11-21", days: 7 });
  if (!same(days(old), dates("2026-11-15", "2026-11-21"))) wrong.push("a 7-day window over an older history draws " + days(old).join(",") + ", not 11-15..11-21");
  const none = mod.dayList([], null, "launches", { firstDay: null, today: "2026-11-21", days: 7 });
  if (!same(days(none), dates("2026-11-15", "2026-11-21"))) wrong.push("a window with no first_day draws " + none.length + " days, not the window's 7");
  const turn = mod.dayList([], null, "launches", { firstDay: "2026-01-01", today: "2026-03-09", days: 10 });
  if (!same(days(turn), dates("2026-02-28", "2026-03-09"))) wrong.push("a window across February's end and the spring clock change draws " + days(turn).join(","));

  const row = (kind: string | null, codeMode: boolean, over: Record<string, number>) => ({ ...zero, day: "2026-11-19", kind, code_mode: codeMode, ...over });
  const series = [row("zk", true, { launches: 3, thrown: 2, refused: 1, failed: 4 }), row("zk", false, { launches: 1 })];
  const span = { firstDay: "2026-09-01", today: "2026-11-21", days: 7 };
  const zk = mod.dayList(series, "zk", "launches", span);
  const d19 = zk.find((d: any) => d.day === "2026-11-19");
  if (!d19 || d19.figures[0] !== 3 || d19.figures[1] !== 1) wrong.push("kind zk's 11-19 launches read " + JSON.stringify(d19?.figures) + ", not [3,1] (with above, without below)");
  if (zk.filter((d: any) => d.day !== "2026-11-19").some((d: any) => d.figures[0] + d.figures[1] !== 0)) wrong.push("a day kind zk has no row for is not zeros");
  const across = mod.dayList(series, null, "launches", span);
  if (across.some((d: any) => d.figures[0] + d.figures[1] !== 0)) wrong.push("the across-kinds list counted kind zk's rows (it reads only kind null rows)");
  const fails = mod.dayList(series, "zk", "failures", span).find((d: any) => d.day === "2026-11-19");
  if (!fails || fails.figures[0] !== 2 || fails.figures[1] !== 5) wrong.push("failures on 11-19 read " + JSON.stringify(fails?.figures) + ", not thrown 2 above and refused + failed 5 below");

  const say = (w: any) => (w && words.has(w.key) ? words.t(w.key, w.values) : null);
  const fewer = mod.difference(64, 100);
  const more = mod.difference(108, 100);
  const fewerWords = say(fewer?.words);
  const moreWords = say(more?.words);
  if (!fewerWords || !/[−-]\s*36\b/.test(fewerWords)) wrong.push("64 against 100 says " + JSON.stringify(fewerWords ?? fewer) + ", not a signed −36");
  if (!moreWords || !/\+\s*8\b/.test(moreWords)) wrong.push("108 against 100 says " + JSON.stringify(moreWords ?? more) + ", not a signed +8");
  if (fewer && fewer.worse !== false) wrong.push("fewer is read as the worse way round");
  if (more && more.worse !== true) wrong.push("more is not read as the worse way round");
  if (mod.difference(5, 0) !== null || mod.difference(null, 3) !== null) wrong.push("a difference against nothing is not null");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("11-10..11-21 for a 30-day window over a history begun 11-10, the window's 7 days otherwise, 02-28..03-09 across the month end, zeros on empty days; kind zk 11-19 [3,1], failures [2,5]; 64 vs 100 says " + JSON.stringify(fewerWords) + ", 108 vs 100 " + JSON.stringify(moreWords));
});
