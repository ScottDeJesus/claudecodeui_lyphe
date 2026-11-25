// protects: src/modules/gemini-spend/GeminiKeys.tsx, src/modules/gemini-spend/GeminiRow.tsx, src/modules/i18n/locales/en/common.json
// writes: none
//
// By key and by process (gemini-spend, seam 9): every key either door listed, by its last four characters and what holds
// it, with its calls and dollars; a key that is held and was not counted in the window is marked so, in words that
// never say never (the doors count a window), and a key nothing holds wears no mark; the connector's processes with
// theirs; and under the keys the one sentence that says what the list is for: a key whose usage at Google is above its
// count here is being spent where no wire sees it. That list is how a key spent outside every wire is ever noticed.
//
// The part is imported in node with the kit's stylesheets answered empty and rendered to static markup over
// en/common.json with three keys and one process. Rows are the part's <li>s; the not-counted mark is found by its
// data-gemini-mark or en's api.gemini.keys.notCounted. A rename of a prop is a change to how this case finds the piece.

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
const KEYS = path.join(REPO, "src/modules/gemini-spend/GeminiKeys.tsx");

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
  let Keys: unknown;
  try {
    Keys = (await import(pathToFileURL(KEYS).href)).GeminiKeys;
  } catch (error) {
    return broken("GeminiKeys.tsx would not load: " + firstLine(error));
  }
  if (typeof Keys !== "function") return broken("GeminiKeys.tsx exports no GeminiKeys");
  const keys = [
    { key: "Q7xZ", envNames: ["GEMINI_API_KEY_SPARE"], meterHolders: [], calls: 0, cost_usd: null },
    { key: "aB12", envNames: ["GEMINI_API_KEY"], meterHolders: ["house"], calls: 57, cost_usd: 1.25 },
    { key: "Lm34", envNames: [], meterHolders: [], calls: 0, cost_usd: null },
  ];
  const processes = [{ process: "shadow-connector.service", calls: 57, cost_usd: 1.25 }];
  let html: string;
  try {
    html = renderToStaticMarkup(createElement(Keys as never, { keys, processes } as never));
  } catch (error) {
    return broken("GeminiKeys would not render: " + firstLine(error));
  }
  const rows = [...html.matchAll(/<li\b[\s\S]*?<\/li>/g)].map((m) => m[0]);
  const rowOf = (needle: string) => rows.find((r) => textOf(r).includes(needle));
  const markWord = String(en?.api?.gemini?.keys?.notCounted ?? "");
  const byAttr = /data-gemini-mark=/.test(html);
  const marked = (r: string): boolean => (byAttr ? /data-gemini-mark="not-counted"/.test(r) : markWord !== "" && textOf(r).includes(markWord));
  const wrong: string[] = [];
  const spare = rowOf("Q7xZ");
  const counted = rowOf("aB12");
  const unheld = rowOf("Lm34");
  const house = String(en?.api?.gemini?.keys?.holder?.house ?? "house");
  if (!spare) wrong.push("no row shows the key ending Q7xZ");
  else {
    if (!textOf(spare).includes("GEMINI_API_KEY_SPARE")) wrong.push("the Q7xZ row does not say GEMINI_API_KEY_SPARE holds it: " + textOf(spare));
    if (!marked(spare)) wrong.push("the held key Q7xZ, not counted in the window, wears no not-counted mark");
    if (/\bnever\b/i.test(markWord)) wrong.push("api.gemini.keys.notCounted says never, and the doors count a window: " + markWord);
  }
  if (!counted) wrong.push("no row shows the key ending aB12");
  else {
    if (!textOf(counted).includes("GEMINI_API_KEY") || !textOf(counted).includes(house)) wrong.push("the aB12 row does not name GEMINI_API_KEY and " + house + ": " + textOf(counted));
    if (marked(counted)) wrong.push("the counted key aB12 wears the not-counted mark");
    if (!textOf(counted).includes("1.25")) wrong.push("the aB12 row draws no 1.25: " + textOf(counted));
  }
  if (!unheld) wrong.push("no row shows the key ending Lm34");
  else if (marked(unheld)) wrong.push("the key Lm34, which nothing holds, wears the not-counted mark: " + textOf(unheld));
  if (!rowOf("shadow-connector.service")) wrong.push("the connector's process is not listed");
  const what = textOf(String(en?.api?.gemini?.keys?.what ?? ""));
  if (!what) wrong.push("en/common.json spells no api.gemini.keys.what");
  else {
    if (!/google/i.test(what) || !/wire/i.test(what)) wrong.push("api.gemini.keys.what does not speak of Google and the wire: " + what);
    const all = textOf(html);
    if (!all.includes(what)) wrong.push("the keys list does not draw api.gemini.keys.what");
    else if (all.indexOf(what) < all.indexOf("aB12")) wrong.push("api.gemini.keys.what stands above the keys, not under them");
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("Q7xZ: " + textOf(spare!) + " | aB12: " + textOf(counted!) + " | Lm34: " + textOf(unheld!) + " | under them: " + what);
});
