// protects: src/modules/analytics/sections/code-mode/CodeModeSection.tsx, src/modules/analytics/AnalyticsSectionFrame.tsx
// writes: none
//
// narrow, written beside the Code Mode Body (analytics-code-mode, interface I), checks the answer's top-level keys by type:
// a number days and generated_at, a string today, a string or null first_day, lists of kinds, uncounted, groups,
// rollups, series and causes, and faults as { total: number, by_fault: object }. An answer with any of them absent or
// of another type narrows to null, and the section draws the frame's one sentence and Try again, never a part over a
// shape it cannot read; a whole answer (first_day null included) narrows to the answer. Rendered to static markup under
// the en words with the section's read hook stood in for by a module hook that calls the section's own narrow.

import fs from "node:fs";
import { register } from "node:module";
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

const HOOK_TAIL = "/src/modules/analytics/hooks/useAnalyticsSection.ts";
// The section's one read, stood in for: it records the question asked, narrows the fixture with the section's own narrow,
// and hands the frame ready or unreachable as the real hook does with a narrowed answer or a null.
const STUB = "export function useAnalyticsSection(id, days, narrow) { const g = globalThis.__codeModeCase; g.asked.push([id, days]); const data = narrow(g.answer); g.results.push(data === null ? null : typeof data); return { reading: data === null ? { status: 'unreachable' } : { status: 'ready', data, stale: false }, refresh() {} }; }";
const HOOKS = "const STUB = " + JSON.stringify("data:text/javascript," + encodeURIComponent(STUB)) + ";\n" +
  "export async function resolve(spec, ctx, next) { const r = await next(spec, ctx); return String(r.url).split('?')[0].endsWith(" + JSON.stringify(HOOK_TAIL) + ") ? { url: STUB, format: 'module', shortCircuit: true } : r; }\n" +
  "export async function load(url, ctx, next) { return String(url).split('?')[0].endsWith('.css') ? { format: 'module', source: 'export default {}', shortCircuit: true } : next(url, ctx); }\n";
register("data:text/javascript," + encodeURIComponent(HOOKS));

const g: any = ((globalThis as any).__codeModeCase = { asked: [], results: [], answer: null });
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const textOf = (html: string) => unescape(html.replace(/<!--.*?-->/g, "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

async function render(section: any, days: number, answer: unknown): Promise<string> {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  g.asked = []; g.results = []; g.answer = answer;
  return renderToStaticMarkup(createElement(section, { days }));
}

function answerOf(figures: string[], over: Record<string, unknown> = {}) {
  const zero = Object.fromEntries(figures.map((k) => [k, 0]));
  const row = (kind: string | null, codeMode: boolean, model: string | null, launches: number) => ({ ...zero, kind, code_mode: codeMode, model, launches, ok: launches, turns: 4, turns_total: 4 * launches, tokens_in: 900, tokens_out: 300, tokens: 1200, seconds: 70, seconds_total: 70 * launches, scripts: codeMode ? 5 : 0, thrown: codeMode ? 1 : 0 });
  const day = (kind: string | null, codeMode: boolean) => { const { model, ...rest } = row(kind, codeMode, null, codeMode ? 3 : 2); return { ...rest, day: "2026-11-20" }; };
  return {
    days: 30, generated_at: 1795700000, today: "2026-11-21", first_day: "2026-11-10",
    kinds: [{ kind: "zprobe", label: "Zebra probe kind" }],
    uncounted: [{ kind: "qprobe", label: "Quokka uncounted kind" }],
    groups: [row("zprobe", true, "opus", 3), row("zprobe", false, "opus", 2)],
    rollups: [row("zprobe", true, null, 3), row("zprobe", false, null, 2), row(null, true, null, 3), row(null, false, null, 2)],
    series: [day("zprobe", true), day("zprobe", false), day(null, true), day(null, false)],
    faults: { total: 3, by_fault: { thrown: 3 } },
    causes: [{ fault: "thrown", helper: "bash", hook: "", count: 3, threw: 3, launches: 2, kinds: ["zprobe"], top: [{ cause: "Probe cause sentence alpha", count: 3 }] }],
    ...over,
  };
}

runCase(async () => {
  const figures = numberKeys("CodeModeFigures");
  if (figures.length < 10) return cannotRun("src/shared/analytics-types.ts names " + figures.length + " number keys under CodeModeFigures");
  const words = await english();
  const mod: any = await import(path.join(FOLDER, "CodeModeSection.tsx"));
  if (typeof mod.CodeModeSection !== "function") return broken("CodeModeSection.tsx exports no CodeModeSection");
  const whole = answerOf(figures);
  const without = (key: string) => { const copy: any = { ...whole }; delete copy[key]; return copy; };
  const bad: [string, unknown][] = [
    ["no answer", null], ["a list", []], ["days a string", { ...whole, days: "30" }], ["generated_at null", { ...whole, generated_at: null }],
    ["today a number", { ...whole, today: 20261121 }], ["first_day a number", { ...whole, first_day: 5 }], ["first_day absent", without("first_day")],
    ["kinds an object", { ...whole, kinds: {} }], ["uncounted null", { ...whole, uncounted: null }], ["groups a string", { ...whole, groups: "x" }],
    ["rollups absent", without("rollups")], ["series null", { ...whole, series: null }], ["causes a string", { ...whole, causes: "x" }],
    ["faults null", { ...whole, faults: null }], ["faults.total a string", { ...whole, faults: { total: "3", by_fault: {} } }], ["faults.by_fault absent", { ...whole, faults: { total: 3 } }],
  ];
  const tryAgain = words.t("analytics.frame.tryAgain");
  const wrong: string[] = [];
  for (const [label, answer] of bad) {
    let html = "";
    try { html = await render(mod.CodeModeSection, 30, answer); } catch (error) { wrong.push(label + ": the render threw " + String((error as Error).message).split("\n")[0]); continue; }
    if (g.results.length !== 1) { wrong.push(label + ": narrow ran " + g.results.length + " times"); continue; }
    if (g.results[0] !== null) wrong.push(label + ": narrow answered an object, not null");
    else if (!html.includes('data-analytics-frame="unreachable"') || !textOf(html).includes(tryAgain)) wrong.push(label + ": the section does not draw the frame's sentence and " + JSON.stringify(tryAgain));
  }
  for (const [label, answer] of [["a whole answer", whole], ["a whole answer with first_day null", { ...whole, first_day: null }]] as [string, unknown][]) {
    try {
      const html = await render(mod.CodeModeSection, 30, answer);
      if (g.results[0] !== "object" || !html.includes('data-analytics-frame="ready"')) wrong.push(label + " is refused (narrow answered " + JSON.stringify(g.results) + ")");
    } catch (error) { wrong.push(label + ": the render threw " + String((error as Error).message).split("\n")[0]); }
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(bad.length + " wrongly typed answers narrow to null and draw " + JSON.stringify(tryAgain) + "; a whole answer, and one with first_day null, are drawn ready");
});
