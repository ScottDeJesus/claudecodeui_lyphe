// CodeModeTrend draws the days with the kit's DayBars, two series on one scale: Code Mode above the rule and without
// hanging below it, each legend total the sum of its own days; the last column is today; and every day's figures
// are also a table one press away beside the plot, as DashboardFlow draws its own (DayBars's rule: a bar's figures
// are never only its title) — analytics-code-mode, interface I.
//
// The part is rendered to static markup with React's server renderer under the en words, handed a window of 7 days
// ending 2026-11-21 whose history began 2026-11-01, and launches across kinds (and for kind zk) of 3 with and 1
// without on 11-19, 2 with and 6 without on 11-21. The figure keys are read off src/shared/analytics-types.ts, so a
// figure the wire gains is a zero here. The vv-daybars__* classes and aria-controls are how the case finds the pieces.
//
// protects: src/modules/analytics/sections/code-mode/CodeModeTrend.tsx, src/modules/analytics/sections/code-mode/codeModeFigures.ts, src/shared/ui/DayBars.tsx
// writes: none

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PART = "../../src/modules/analytics/sections/code-mode/CodeModeTrend.tsx";

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
  return { t: i18n.t.bind(i18n), has: (key: string) => typeof at(key) === "string" || typeof at(key + "_other") === "string" };
}

const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const textOf = (html: string) => unescape(html.replace(/<!--.*?-->/g, "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

async function render(part: any, props: unknown): Promise<string> {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(createElement(part, props as never));
}

const px = (style: string | undefined) => Number(/height:\s*([\d.]+)px/.exec(style ?? "")?.[1] ?? NaN);

runCase(async () => {
  const words = await english();
  const figures = numberKeys("CodeModeFigures");
  if (figures.length < 10) return cannotRun("src/shared/analytics-types.ts names " + figures.length + " number keys under CodeModeFigures");
  const zero = Object.fromEntries(figures.map((k) => [k, 0]));
  const day = (d: string, kind: string | null, codeMode: boolean, launches: number) => ({ ...zero, day: d, kind, code_mode: codeMode, launches, ok: launches });
  const series: unknown[] = [];
  for (const kind of [null, "zk"]) series.push(day("2026-11-19", kind, true, 3), day("2026-11-19", kind, false, 1), day("2026-11-21", kind, true, 2), day("2026-11-21", kind, false, 6));
  const mod: any = await import(PART);
  if (typeof mod.CodeModeTrend !== "function") return broken("CodeModeTrend.tsx exports no CodeModeTrend");
  const html = await render(mod.CodeModeTrend, { series, kinds: [{ kind: "zk", label: "Zebra kind" }], firstDay: "2026-11-01", today: "2026-11-21", days: 7 });

  const wrong: string[] = [];
  const legend = html.split(/(?=<span[^>]*class="[^"]*vv-daybars__series\b)/).slice(1).map((chunk) => ({
    mark: textOf(/vv-daybars__mark[^>]*>([^<]*)</.exec(chunk)?.[1] ?? ""),
    label: textOf(/vv-daybars__mark[^>]*>[^<]*<\/span>((?:[^<]|<!--.*?-->)*)</.exec(chunk)?.[1] ?? ""),
    total: textOf(/vv-daybars__total[^>]*>([^<]*)</.exec(chunk)?.[1] ?? ""),
  }));
  if (legend.length !== 2) wrong.push(legend.length + " series in the legend, not two");
  else {
    if (legend[0].mark !== "▲" || legend[1].mark !== "▼") wrong.push("legend marks " + legend.map((l) => l.mark).join("/") + ", not up above and down below");
    if (legend[0].total !== "5" || legend[1].total !== "7") wrong.push("legend totals " + legend[0].total + " above and " + legend[1].total + " below, not Code Mode's 5 above and without's 7 below");
    if (words.has("analytics.codeMode.without") && legend[1].label !== words.t("analytics.codeMode.without")) wrong.push("the lower series is \"" + legend[1].label + "\", not the without words \"" + words.t("analytics.codeMode.without") + "\"");
    if (legend[0].label === legend[1].label) wrong.push("both series are named \"" + legend[0].label + "\"");
  }

  const columns = html.split(/(?=<span[^>]*class="[^"]*vv-daybars__day\b)/).slice(1).map((chunk) => {
    const open = chunk.slice(0, chunk.indexOf(">") + 1);
    return {
      today: /data-today="true"/.test(open),
      title: unescape(/title="([^"]*)"/.exec(open)?.[1] ?? ""),
      sides: [...chunk.matchAll(/class="[^"]*vv-daybars__side\b[^"]*"[^>]*style="([^"]*)"/g)].map((m) => px(m[1])),
      bars: [...chunk.matchAll(/class="[^"]*vv-daybars__bar\b[^"]*"[^>]*style="([^"]*)"/g)].map((m) => px(m[1])),
    };
  });
  const last = columns[columns.length - 1];
  if (columns.length < 2 || !last) wrong.push(columns.length + " day columns drawn for two days that held launches");
  else {
    if (!last.today) wrong.push("the last column is not marked today");
    if (!/\b2\b/.test(last.title) || !/\b6\b/.test(last.title)) wrong.push("today's title \"" + last.title + "\" does not say its 2 with and 6 without");
    if (!(last.bars[1] === last.sides[1] && last.bars[0] > 1 && last.bars[0] < last.bars[1])) wrong.push("today's bars are " + last.bars.join("/") + " px of " + last.sides.join("/") + " px sides: without's 6 does not fill its side below, or Code Mode's 2 is not a shorter bar above");
  }

  const toggles = [...html.matchAll(/<button\b([^>]*)>/g)].map((m) => m[1]).filter((a) => /aria-expanded=/.test(a))
    .map((a) => /aria-controls="([^"]+)"/.exec(a)?.[1]).filter((id) => id && html.includes("id=\"" + id + "\""));
  if (toggles.length === 0) wrong.push("no press beside the plot controls a day table: no button with aria-expanded controls an element drawn with it");
  const plot = unescape(/role="img"[^>]*aria-label="([^"]*)"/.exec(html)?.[1] ?? /aria-label="([^"]*)"[^>]*role="img"/.exec(html)?.[1] ?? "");
  if (plot === "" || plot.includes("analytics.")) wrong.push("the plot's spoken sentence is \"" + plot + "\"");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("legend " + legend.map((l) => l.mark + " " + l.label + " " + l.total).join(" | ") + "; " + columns.length + " columns, today last with bars " + last.bars.join("/") + " px; a press controls the day table; plot says \"" + plot.slice(0, 80) + "\"");
});
