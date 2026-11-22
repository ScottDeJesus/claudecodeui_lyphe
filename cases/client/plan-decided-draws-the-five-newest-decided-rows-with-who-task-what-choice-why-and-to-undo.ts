// protects: src/modules/dispatcher/PlanDecided.tsx, src/modules/i18n/locales/en/common.json
// writes: none
//
// walks-decide-themselves, phase 6 (the fill): the feature card's "Decided for you" list draws the plan's own decided rows.
// A plan carrying seven decided rows the operator never looked at opens its fold; the five newest stand newest first, each
// saying who decided (the builder, the designer, a rule), its task's title, what was open, what was chosen, why, and
// "To undo"; a choice about the whole feature (task null) never reads "null"; a choice holding markup reaches the page as
// text; the two older rows wait behind "Show 2 earlier".
//
// Rendered the way plan-decided-draws-nothing-for-a-plan-with-no-decided-rows-and-no-open-gaps renders it: imported in node,
// stylesheets answered empty, window and an empty localStorage stood in, React's server renderer over en/common.json through
// i18next, inside a MemoryRouter when react-router-dom is installed (should the ticket press navigate). The plan is handed as
// plan=; a rename is a change to how this case finds the piece, never to what it checks.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PIECE = path.join(REPO, "src/modules/dispatcher/PlanDecided.tsx");
const LOCALE = path.join(REPO, "src/modules/i18n/locales/en/common.json");
const row = (id: number, by: string, task: string | null, extra: Record<string, string> = {}) => ({
  id, at: "2026-11-20T10:0" + id + ":00Z", task, by,
  what: "athena-what-" + id + " was left open", choice: "athena-choice-" + id + " was taken", why: "athena-why-" + id, undo: "athena-undo-" + id, ...extra,
});
const ROWS = [
  row(1, "builder", "Wire the reader"),
  row(2, "rule", "Wire the reader"),
  row(3, "builder", "Fill the decided list"),
  row(4, "rule", null),
  row(5, "designer", "Fill the decided list"),
  row(6, "builder", "Fill the decided list"),
  row(7, "designer", "Fill the decided list", { choice: "athena-choice-7 kept the <img src=x onerror=alert(1)> literal" }),
];
const PLAN = { name: "athena-case-decided-rows", title: "Athena case feature", status: "running", phases: [], events: [], decided: ROWS, open_gaps: [] };
const firstLine = (error: unknown): string => String((error as Error)?.message ?? error).split("\n")[0];
const decode = (s: string): string => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
const textOf = (html: string): string => decode(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());

runCase(async () => {
  if (!existsSync(PIECE)) return broken("src/modules/dispatcher/PlanDecided.tsx is not on disk");
  register(
    "data:text/javascript," +
      encodeURIComponent("export async function load(url, context, next) { if (/\\.(css|svg|png)(\\?|$)/.test(url)) return { format: 'module', source: 'export default {}', shortCircuit: true }; return next(url, context); }"),
  );
  const kept = new Map<string, string>();
  (globalThis as any).window ??= globalThis;
  (globalThis as any).localStorage ??= {
    getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => { kept.set(k, String(v)); },
    removeItem: (k: string) => { kept.delete(k); }, clear: () => kept.clear(), key: () => null, length: 0,
  };
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const i18n = (await import("i18next")).default;
  const { initReactI18next } = await import("react-i18next");
  const en = JSON.parse(await readFile(LOCALE, "utf8"));
  await i18n.use(initReactI18next).init({ lng: "en", fallbackLng: "en", defaultNS: "common", ns: ["common"], resources: { en: { common: en } }, interpolation: { escapeValue: false }, react: { useSuspense: false } });
  let wrap = (el: any): any => el;
  try {
    const rr: any = await import("react-router-dom");
    if (rr.MemoryRouter) wrap = (el: any) => createElement(rr.MemoryRouter, null, el);
  } catch { /* no router installed: the piece is rendered bare */ }
  let mod: any;
  try {
    mod = await import(pathToFileURL(PIECE).href);
  } catch (error) {
    return broken("PlanDecided.tsx would not load: " + firstLine(error));
  }
  const Piece = mod.PlanDecided ?? mod.default;
  if (Piece == null) return broken("PlanDecided.tsx exports no PlanDecided");
  let html: string;
  try {
    html = renderToStaticMarkup(wrap(createElement(Piece, { plan: PLAN } as never)));
  } catch (error) {
    return broken("a plan with seven decided rows makes it throw: " + firstLine(error));
  }
  const text = textOf(html);
  if (html.trim() === "") return broken("a plan with seven decided rows the operator never looked at drew nothing: its rows are not read from plan.decided");
  const wrong: string[] = [];
  const order = [...html.matchAll(/data-decided-row="(\d+)"/g)].map((m) => Number(m[1]));
  if (order.join(",") !== "7,6,5,4,3") wrong.push("the open fold draws rows " + JSON.stringify(order) + ", not the five newest newest first [7,6,5,4,3]");
  for (const r of ROWS.slice(2)) for (const k of ["what", "choice", "why", "undo"] as const) if (!text.includes((r as any)[k])) wrong.push("row " + r.id + "'s " + k + " is not drawn");
  for (const r of ROWS.slice(0, 2)) if (text.includes(r.what)) wrong.push("row " + r.id + ", older than the five newest, is drawn before Show earlier is pressed");
  for (const who of ["the builder", "the designer", "a rule"]) if (!text.includes(who)) wrong.push('no row says who decided as "' + who + '"');
  if (!text.includes("Fill the decided list")) wrong.push("no row names its task's title");
  if (/\bnull\b|\bundefined\b/.test(text)) wrong.push('a row reads "null" or "undefined" (the whole-feature row?)');
  if ((text.match(/To undo/g) ?? []).length < 5) wrong.push('fewer than five "To undo" lines for five rows');
  if (/<img/i.test(html)) wrong.push("the markup in a choice reached the page as an element, not as text");
  if (!/Decided for you\s*·?\s*7/.test(text)) wrong.push('the fold is not titled "Decided for you" with its count 7');
  if (!/Show 2 earlier/.test(text)) wrong.push('no "Show 2 earlier" under the five rows');
  if (wrong.length > 0) return broken(wrong.slice(0, 5).join("; ") + (wrong.length > 5 ? " (+" + (wrong.length - 5) + " more)" : ""));
  return held("seven decided rows drew an open fold, Decided for you · 7, rows 7..3 newest first with who, task, what, choice, why and To undo, markup as text, Show 2 earlier");
});
