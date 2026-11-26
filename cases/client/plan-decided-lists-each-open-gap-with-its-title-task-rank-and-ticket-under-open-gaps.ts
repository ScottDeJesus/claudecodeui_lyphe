// protects: src/modules/dispatcher/PlanDecided.tsx, src/modules/i18n/locales/en/common.json
// writes: none
//
// walks-decide-themselves, phase 6 (the fill): the gaps a feature finished with are read from plan.open_gaps and drawn
// under "Open gaps", outside the fold: each gap's title, its task's title, its rank and "Ticket <number>". They
// stand whether the plan has no decided row (the gaps alone) or has rows whose fold is open (the gaps after the rows).
//
// Rendered as the sibling plan-decided cases render it: node, stylesheets answered empty, an empty localStorage stood in,
// React's server renderer over en/common.json through i18next, inside a MemoryRouter when react-router-dom is installed.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PIECE = path.join(REPO, "src/modules/dispatcher/PlanDecided.tsx");
const LOCALE = path.join(REPO, "src/modules/i18n/locales/en/common.json");
const GAPS = [
  { task: "Fill the decided list", title: "athena-gap-one the fold runs past a phone", ticket: 94242, priority: "high", needs_you: "2 fix rounds did not close this gap" },
  { task: "Wire the reader", title: "athena-gap-two a ruling is read twice", ticket: 94243, priority: "medium", needs_you: null },
];
const ROW = { id: 1, at: "2026-11-20T10:01:00Z", task: "Wire the reader", by: "builder", what: "athena-what-1", choice: "athena-choice-1", why: "athena-why-1", undo: "athena-undo-1" };
const BASE = { name: "athena-case-open-gaps", title: "Athena case feature", status: "gaps", phases: [], events: [] };
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
  const wrong: string[] = [];
  for (const [what, plan] of [["with no decided row", { ...BASE, decided: [], open_gaps: GAPS }], ["with a decided row whose fold is open", { ...BASE, decided: [ROW], open_gaps: GAPS }]] as const) {
    let html: string;
    try {
      html = renderToStaticMarkup(wrap(createElement(Piece, { plan } as never)));
    } catch (error) {
      wrong.push("a plan " + what + " makes it throw: " + firstLine(error));
      continue;
    }
    const text = textOf(html);
    if (text === "") { wrong.push("a plan " + what + " and two open gaps drew nothing: the gaps are not read from plan.open_gaps"); continue; }
    if (!/Open gaps\s*·?\s*2/.test(text)) wrong.push("a plan " + what + ': no "Open gaps" with its count 2');
    for (const g of GAPS) {
      if (!text.includes(g.title)) wrong.push("a plan " + what + ": gap " + g.ticket + "'s title is not drawn");
      if (!text.includes(g.task)) wrong.push("a plan " + what + ": gap " + g.ticket + "'s task title is not drawn");
      if (!new RegExp("Ticket\\s*#?" + g.ticket).test(text)) wrong.push("a plan " + what + ': no "Ticket ' + g.ticket + '"');
      if (!text.includes(g.priority)) wrong.push("a plan " + what + ": gap " + g.ticket + " does not say its rank " + g.priority);
    }
    if (what.startsWith("with a decided") && !text.includes(ROW.choice)) wrong.push("a plan with one new decided row and two gaps does not draw the row beside the gaps");
  }
  if (wrong.length > 0) return broken(wrong.slice(0, 5).join("; ") + (wrong.length > 5 ? " (+" + (wrong.length - 5) + " more)" : ""));
  return held("two open gaps drew Open gaps · 2 with each title, task, rank and Ticket number, alone and under an open fold of rows");
});
