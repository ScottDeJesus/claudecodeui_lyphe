// CodeModeCompare is the section's answer: per kind its with and without rows across models, then each model's (in
// the table, or one press away behind the Each model choice), and
// the difference with against without said as a signed share of the figure without (analytics-code-mode,
// interface I). The kinds are named by the labels the answer carries, never a locale's (interface J).
//
// The part is rendered to static markup under the en words, handed one kind (zk, "Zebra kind") with one model's pair
// and its rollups, every figure equal but the median turns: 12 with Code Mode, 10 without. The figure keys are read
// off src/shared/analytics-types.ts. The signed share is found as the units.more words for 20, or "+20%".
// The Each model choice is found as a radio named by the compare.modelsEach words.
//
// protects: src/modules/analytics/sections/code-mode/CodeModeCompare.tsx, src/modules/analytics/sections/code-mode/codeModeFigures.ts
// writes: none

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PART = "../../src/modules/analytics/sections/code-mode/CodeModeCompare.tsx";

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

runCase(async () => {
  const words = await english();
  const figures = numberKeys("CodeModeFigures");
  if (figures.length < 10) return cannotRun("src/shared/analytics-types.ts names " + figures.length + " number keys under CodeModeFigures");
  const base = { ...Object.fromEntries(figures.map((k) => [k, 0])), launches: 4, ok: 4, tokens_in: 1000, tokens_out: 200, tokens: 1200, seconds: 60, tokens_in_total: 4000, tokens_out_total: 800, seconds_total: 240 };
  const row = (kind: string | null, codeMode: boolean, model: string | null, turns: number) => ({ ...base, kind, code_mode: codeMode, model, turns, turns_total: turns * 4 });
  const props = {
    kinds: [{ kind: "zk", label: "Zebra kind" }],
    groups: [row("zk", true, "opus-zebra", 12), row("zk", false, "opus-zebra", 10)],
    rollups: [row("zk", true, null, 12), row("zk", false, null, 10), row(null, true, null, 12), row(null, false, null, 10)],
  };
  const mod: any = await import(PART);
  if (typeof mod.CodeModeCompare !== "function") return broken("CodeModeCompare.tsx exports no CodeModeCompare");
  const html = await render(mod.CodeModeCompare, props);
  const text = textOf(html);

  const wrong: string[] = [];
  if (!text.includes("Zebra kind")) wrong.push("the kind is not named by the data's label \"Zebra kind\"");
  const each = words.has("analytics.codeMode.compare.modelsEach") ? words.t("analytics.codeMode.compare.modelsEach") : null;
  const drawsModel = text.includes("opus-zebra");
  const offersEach = each !== null && html.split('role="radio"').slice(1).some((chunk) => textOf(chunk.slice(chunk.indexOf(">") + 1, chunk.indexOf(">") + 400)).startsWith(each));
  if (!drawsModel && !offersEach) wrong.push("the model opus-zebra is neither drawn nor one press away: no radio named \"" + (each ?? "compare.modelsEach") + "\" stands by the table");
  if (!/<table\b|role="table"|role="grid"/.test(html)) wrong.push("no table is drawn");
  const more = words.has("analytics.codeMode.units.more") ? words.t("analytics.codeMode.units.more", { value: 20 }) : null;
  const fewer = words.has("analytics.codeMode.units.fewer") ? words.t("analytics.codeMode.units.fewer", { value: 20 }) : null;
  const saysMore = (more !== null && text.includes(more)) || /\+\s?20(\.0)?\s?%/.test(text);
  const saysFewer = (fewer !== null && text.includes(fewer)) || /[−-]\s?20(\.0)?\s?%/.test(text);
  if (!saysMore) wrong.push("the 12 turns against 10 is not said as a signed +20% share" + (more ? " (\"" + more + "\")" : ""));
  if (saysFewer) wrong.push("the 12 turns against 10 is said as fewer");

  if (wrong.length > 0) return broken(wrong.join("; ") + " | drew: " + text.slice(0, 200));
  return held("Zebra kind drawn in a table, opus-zebra " + (drawsModel ? "drawn with it" : "one press away behind \"" + each + "\"") + "; 12 turns against 10 says \"" + (more ?? "+20%") + "\", never fewer");
});
