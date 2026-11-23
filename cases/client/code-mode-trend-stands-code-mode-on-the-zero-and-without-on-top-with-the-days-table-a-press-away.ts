// CodeModeTrend draws the days with the kit's DayChart: launches as columns on one scale, Code Mode's standing on the
// zero in the full ink and without's on top of them in the pale ink, each legend total the sum of its own days; the last
// column is today, and its figures are what a finger's read line says before any day is tapped; and every day's figures
// are also a table one press away beside the plot (DayBars's rule, kept by DayChart: a mark's figures are never only its
// paint) — analytics-code-mode, interface I.
//
// The part is rendered to static markup with React's server renderer under the en words, handed a window of 7 days
// ending 2026-11-21 whose history began 2026-11-01, every kind, and launches across kinds (and for kind zk) of 3 with
// and 1 without on 11-19, 2 with and 6 without on 11-21. The figure keys are read off src/shared/analytics-types.ts, so a
// figure the wire gains is a zero here. The vv-daychart__* classes, data-mark and aria-controls are how the case finds
// the pieces.
//
// protects: src/modules/analytics/sections/code-mode/CodeModeTrend.tsx, src/modules/analytics/sections/code-mode/codeModeFigures.ts, src/shared/ui/DayChart.tsx
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
  const html = await render(mod.CodeModeTrend, { series, kind: null, kindLabel: "All kinds", span: { firstDay: "2026-11-01", today: "2026-11-21", days: 7 } });

  const wrong: string[] = [];
  const legend = html.split(/(?=<span[^>]*class="[^"]*vv-daychart__series\b)/).slice(1).map((chunk) => ({
    mark: /vv-daychart__key[^>]*data-mark="([^"]*)"/.exec(chunk)?.[1] ?? "",
    label: textOf(/vv-daychart__key[^>]*><\/span>((?:[^<]|<!--.*?-->)*)</.exec(chunk)?.[1] ?? ""),
    total: textOf(/vv-daychart__total[^>]*>([^<]*)</.exec(chunk)?.[1] ?? ""),
  }));
  if (legend.length !== 2) wrong.push(legend.length + " series in the legend, not two");
  else {
    if (legend[0].mark !== "ink" || legend[1].mark !== "pale") wrong.push("legend marks " + legend.map((l) => l.mark).join("/") + ", not the full ink for Code Mode and the pale one for without");
    if (legend[0].total !== "5" || legend[1].total !== "7") wrong.push("legend totals " + legend[0].total + " and " + legend[1].total + ", not Code Mode's 5 and without's 7");
    if (words.has("analytics.codeMode.without") && legend[1].label !== words.t("analytics.codeMode.without")) wrong.push("the second series is \"" + legend[1].label + "\", not the without words \"" + words.t("analytics.codeMode.without") + "\"");
    if (legend[0].label === legend[1].label) wrong.push("both series are named \"" + legend[0].label + "\"");
  }

  const columns = html.split(/(?=<span[^>]*class="[^"]*vv-daychart__day\b)/).slice(1).map((chunk) => {
    const open = chunk.slice(0, chunk.indexOf(">") + 1);
    const parts = [...chunk.matchAll(/class="[^"]*vv-daychart__part\b[^"]*"[^>]*data-mark="([^"]*)"[^>]*style="([^"]*)"/g)].map((m) => ({ mark: m[1], px: px(m[2]) }));
    return { today: /data-today="true"/.test(open), parts };
  });
  const last = columns[columns.length - 1];
  if (columns.length !== 7 || !last) wrong.push(columns.length + " day columns drawn for a 7-day window");
  else {
    if (!last.today) wrong.push("the last column is not marked today");
    const ink = last.parts.find((p) => p.mark === "ink");
    const pale = last.parts.find((p) => p.mark === "pale");
    if (!ink || !pale) wrong.push("today's column is " + JSON.stringify(last.parts) + ": not a Code Mode part and a without part");
    else {
      if (last.parts[0] !== ink) wrong.push("today's Code Mode part is not the first, the one standing on the zero");
      if (!(ink.px > 1 && ink.px < pale.px)) wrong.push("today's parts are " + ink.px + " px with and " + pale.px + " px without: Code Mode's 2 is not a shorter part than without's 6");
    }
  }
  const readLine = textOf(/class="[^"]*vv-daychart__readline\b[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "");
  if (!/\b2\b/.test(readLine) || !/\b6\b/.test(readLine)) wrong.push("the read line \"" + readLine + "\" does not say today's 2 with and 6 without");

  const toggles = [...html.matchAll(/<button\b([^>]*)>/g)].map((m) => m[1]).filter((a) => /aria-expanded=/.test(a))
    .map((a) => /aria-controls="([^"]+)"/.exec(a)?.[1]).filter((id) => id && html.includes("id=\"" + id + "\""));
  if (toggles.length === 0) wrong.push("no press beside the plot controls a day table: no button with aria-expanded controls an element drawn with it");
  const plot = unescape(/role="img"[^>]*aria-label="([^"]*)"/.exec(html)?.[1] ?? /aria-label="([^"]*)"[^>]*role="img"/.exec(html)?.[1] ?? "");
  if (plot === "" || plot.includes("analytics.")) wrong.push("the plot's spoken sentence is \"" + plot + "\"");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("legend " + legend.map((l) => l.mark + " " + l.label + " " + l.total).join(" | ") + "; " + columns.length + " columns, today last with parts " + last.parts.map((p) => p.mark + " " + Math.round(p.px)).join("/") + " px; read line \"" + readLine + "\"; a press controls the day table; plot says \"" + plot.slice(0, 80) + "\"");
});
