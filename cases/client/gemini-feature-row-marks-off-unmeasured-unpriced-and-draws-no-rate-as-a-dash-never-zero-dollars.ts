// protects: src/modules/gemini-spend/GeminiFeatureRow.tsx, src/modules/gemini-spend/GeminiRow.tsx, src/modules/gemini-spend/geminiFigures.ts
// writes: none
//
// One row component draws a feature of either door from the one snake_case row shape (gemini-spend, interfaces). Its
// marks are what keeps the dollars honest: cost_usd null means no model of the row has a rate, so the figure is a dash
// and the row says unpriced, never $0 ("absence of measurement is never recorded as zero cost"); unmeasured_calls means
// answers that carried no usage of Google's own, so the dollars are short and the row says so. enabled false is Off with
// its Switch unchecked; a switch whose press is out is held (disabled) until its door reads back.
//
// The row is imported in node with the kit's stylesheets answered empty and rendered to static markup over
// en/common.json. Marks are found by the row's data-gemini-mark, or by en's words when no mark carries one; the switch
// by the kit's role="switch" and aria-checked. A rename of a prop is a change to how this case finds the piece.

import { readFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LOCALE = path.join(REPO, "src/modules/i18n/locales/en/common.json");

const textOf = (html: string): string =>
  html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&nbsp;|&#160;| /g, " ").replace(/\s+/g, " ").trim();
const firstLine = (error: unknown): string => String((error as Error)?.message ?? error).split("\n")[0];
const ROW = path.join(REPO, "src/modules/gemini-spend/GeminiFeatureRow.tsx");

runCase(async () => {
  register(
    "data:text/javascript," +
      encodeURIComponent("export async function load(url, context, next) { if (/\\.(css|svg|png)(\\?|$)/.test(url)) return { format: 'module', source: 'export default {}', shortCircuit: true }; return next(url, context); }"),
  );
  (globalThis as any).window ??= globalThis;
  const kept = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (kept.has(k) ? kept.get(k) : null),
      setItem: (k: string, v: string) => void kept.set(k, String(v)),
      removeItem: (k: string) => void kept.delete(k),
      clear: () => kept.clear(),
      key: (i: number) => [...kept.keys()][i] ?? null,
      get length() { return kept.size; },
    },
  });
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const i18n = (await import("i18next")).default;
  const { initReactI18next } = await import("react-i18next");
  const en = JSON.parse(await readFile(LOCALE, "utf8"));
  await i18n.use(initReactI18next).init({ lng: "en", fallbackLng: "en", defaultNS: "common", ns: ["common"], resources: { en: { common: en } }, interpolation: { escapeValue: false }, react: { useSuspense: false } });
  let Row: unknown;
  try {
    Row = (await import(pathToFileURL(ROW).href)).GeminiFeatureRow;
  } catch (error) {
    return broken("GeminiFeatureRow.tsx would not load: " + firstLine(error));
  }
  if (typeof Row !== "function") return broken("GeminiFeatureRow.tsx exports no GeminiFeatureRow");
  const base = { feature: "tech_activity_parser", label: "Tech activity parser", enabled: true, calls: 40, failures: 0, unmeasured_calls: 0, input_tokens: 1200, output_tokens: 300, cost_usd: 0.42, models: ["gemini-2.5-flash"], last_at: "2026-11-24T10:00:00Z" };
  const rows: Record<string, { row: Record<string, unknown>; held: boolean }> = {
    priced: { row: base, held: false },
    unpriced: { row: { ...base, cost_usd: null, models: ["gemini-unrated-x"], calls: 3 }, held: false },
    offUnmeasured: { row: { ...base, enabled: false, unmeasured_calls: 2 }, held: false },
    held: { row: base, held: true },
  };
  const html: Record<string, string> = {};
  for (const [name, { row, held: isHeld }] of Object.entries(rows)) {
    try {
      html[name] = renderToStaticMarkup(createElement("ul", null, createElement(Row as never, { row, held: isHeld, onSwitch: () => {} } as never)));
    } catch (error) {
      return broken("the " + name + " row would not render: " + firstLine(error));
    }
  }
  const byAttr = Object.values(html).some((h) => /data-gemini-mark=/.test(h));
  const literal = (sentence: unknown): string => String(sentence ?? "").split(/\{\{[^}]*\}\}/).map((s) => s.trim()).sort((a, b) => b.length - a.length)[0] ?? "";
  const words: Record<string, string> = { off: literal(en?.api?.gemini?.row?.off), unmeasured: literal(en?.api?.gemini?.row?.unmeasured), unpriced: literal(en?.api?.gemini?.row?.unpriced) };
  const has = (h: string, mark: string): boolean => (byAttr ? new RegExp('data-gemini-mark="' + mark + '"').test(h) : words[mark] !== "" && textOf(h).includes(words[mark]));
  const sw = (h: string) => {
    const m = h.match(/<\w+\b([^>]*\brole="switch"[^>]*)>/);
    return m ? { checked: /aria-checked="true"/.test(m[1]), disabled: /\sdisabled(=""|\s|>|$)|aria-disabled="true"/.test(m[1]) } : null;
  };
  const wrong: string[] = [];
  for (const name of Object.keys(html)) if (!sw(html[name])) wrong.push("the " + name + " row draws no role=\"switch\"");
  const p = html.priced;
  for (const mark of ["off", "unmeasured", "unpriced"]) if (has(p, mark)) wrong.push("a priced, measured, on row wears the " + mark + " mark");
  if (!textOf(p).includes("0.42")) wrong.push("a row of $0.42 draws no 0.42: " + textOf(p));
  if (sw(p) && (!sw(p)!.checked || sw(p)!.disabled)) wrong.push("an on row's switch is not checked and free");
  const u = html.unpriced;
  if (!has(u, "unpriced")) wrong.push("a called row with cost_usd null wears no unpriced mark");
  if (!textOf(u).includes("—")) wrong.push("a row with no rate draws no dash: " + textOf(u));
  if (/\$\s*0(?:\.0+)?(?![.\d])/.test(textOf(u))) wrong.push("a row with no rate draws zero dollars: " + textOf(u));
  const o = html.offUnmeasured;
  if (!has(o, "off")) wrong.push("a switched-off row wears no Off mark");
  if (!has(o, "unmeasured")) wrong.push("a row with unmeasured calls wears no unmeasured mark");
  if (has(o, "unpriced")) wrong.push("a priced row with unmeasured calls wears the unpriced mark");
  if (sw(o)?.checked) wrong.push("a switched-off row's switch reads checked");
  if (sw(html.held) && !sw(html.held)!.disabled) wrong.push("a row whose press is out has its switch free");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("priced: " + textOf(p) + " | unpriced: " + textOf(u) + " | off+unmeasured: " + textOf(o) + " | held switch disabled");
});
