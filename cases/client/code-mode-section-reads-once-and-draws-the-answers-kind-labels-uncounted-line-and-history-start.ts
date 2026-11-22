// protects: src/modules/analytics/sections/code-mode/CodeModeSection.tsx, src/modules/analytics/sections/code-mode/codeModeFigures.ts, src/modules/analytics/AnalyticsSectionFrame.tsx
// writes: none
//
// The Code Mode Body (analytics-code-mode, interface I) asks useAnalyticsSection ONCE, for ('code-mode', its days), and
// draws the one answer inside AnalyticsSectionFrame: a kind is drawn by the answer's kinds[].label, never by its id or by a
// list of the screen's own; the uncounted kinds are named; a history younger than the window says when it starts, an
// older one says nothing of it; and an empty history draws the no-history empty state, not four empty parts.
// The section is rendered to static markup under the en words; its read hook is stood in for by a module hook that
// narrows the fixture with the section's own narrow (the hook's own states are the frame case's).

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
  const wrong: string[] = [];
  const draw = async (days: number, answer: unknown) => {
    try { return await render(mod.CodeModeSection, days, answer); } catch (error) { wrong.push("days " + days + ": the render threw " + String((error as Error).message).split("\n")[0]); return ""; }
  };

  const young = await draw(30, answerOf(figures));
  const youngText = textOf(young);
  if (g.asked.length !== 1 || g.asked[0][0] !== "code-mode" || g.asked[0][1] !== 30) wrong.push("the Body asked " + JSON.stringify(g.asked) + ", not once for [\"code-mode\",30]");
  if (young && !young.includes('data-analytics-frame="ready"')) wrong.push("a narrowed answer is not drawn in the frame's ready state");
  if (young && !youngText.includes("Zebra probe kind")) wrong.push("the kind's label from kinds[].label is not drawn");
  if (/\bzprobe\b/.test(youngText)) wrong.push("the kind's id zprobe is drawn as words");
  const uncounted = words.t("analytics.codeMode.uncounted", { kinds: "Quokka uncounted kind" });
  if (young && !youngText.includes(uncounted)) wrong.push("the uncounted line " + JSON.stringify(uncounted) + " is not drawn");
  const starts = String(words.t("analytics.codeMode.historyStarts", { date: "\u00a7", count: 12, days: 30 })).split("\u00a7").map((s) => s.trim()).filter(Boolean);
  if (!words.has("analytics.codeMode.historyStarts") || starts.length === 0) wrong.push("en has no analytics.codeMode.historyStarts");
  else if (young && !starts.every((piece) => youngText.includes(piece))) wrong.push("a history begun 11-10 under a 30-day window does not say " + JSON.stringify(starts.join(" … ")));

  const older = await draw(7, answerOf(figures, { days: 7, first_day: "2026-09-01", uncounted: [] }));
  if (g.asked.length !== 1 || g.asked[0][1] !== 7) wrong.push("the 7-day Body asked " + JSON.stringify(g.asked));
  const olderStarts = String(words.t("analytics.codeMode.historyStarts", { date: "\u00a7", count: 7, days: 7 })).split("\u00a7").map((s) => s.trim()).filter(Boolean);
  if (older && olderStarts.length > 0 && olderStarts.every((piece) => textOf(older).includes(piece))) wrong.push("a history older than the window still says when it starts");
  if (older.includes("data-code-mode-notes")) wrong.push("with no young history and no uncounted kind, the notes block is still drawn");

  const empty = await draw(30, answerOf(figures, { first_day: null, groups: [], rollups: [], series: [], causes: [], faults: { total: 0, by_fault: {} }, uncounted: [] }));
  const emptyTitle = words.t("analytics.codeMode.empty.noHistoryTitle");
  if (empty && !textOf(empty).includes(emptyTitle)) wrong.push("an empty history does not draw " + JSON.stringify(emptyTitle));
  if (textOf(empty).includes("Zebra probe kind")) wrong.push("an empty history still draws the parts");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("asked once for [code-mode,30] then [code-mode,7]; drew \"Zebra probe kind\", " + JSON.stringify(uncounted) + " and the history line; none for an older history; " + JSON.stringify(emptyTitle) + " for none");
});
