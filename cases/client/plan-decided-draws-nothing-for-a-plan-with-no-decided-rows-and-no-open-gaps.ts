// protects: src/modules/dispatcher/PlanDecided.tsx, src/modules/dispatcher/PlanFace.tsx
// writes: none
//
// The feature card's "Decided for you" list draws nothing for a plan nothing was decided on (walks-decide-themselves,
// phase 5, "no rows: nothing drawn"). Every plan today reaches the card with no decided and no open_gaps keys, and a
// plan after the fill may carry both as empty lists; either way PlanDecided draws no frame, no heading and no gaps line,
// so the card a plan with no decisions shows is the card it showed before the list existed.
//
// The piece is imported in node, its stylesheets answered empty, window and an empty localStorage stood in, and rendered
// to static markup with React's server renderer over en/common.json through i18next. The plan is handed as plan=, the
// seam's prop; a rename is a change to how this case finds the piece, never to what it checks.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PIECE = path.join(REPO, "src/modules/dispatcher/PlanDecided.tsx");
const LOCALE = path.join(REPO, "src/modules/i18n/locales/en/common.json");
const BASE = { name: "athena-case-empty-plan", title: "Athena case feature", status: "running", phases: [], events: [] };
const firstLine = (error: unknown): string => String((error as Error)?.message ?? error).split("\n")[0];
const textOf = (html: string): string => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

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
  let mod: any;
  try {
    mod = await import(pathToFileURL(PIECE).href);
  } catch (error) {
    return broken("PlanDecided.tsx would not load: " + firstLine(error));
  }
  const Piece = mod.PlanDecided ?? mod.default;
  if (Piece == null) return broken("PlanDecided.tsx exports no PlanDecided");
  const wrong: string[] = [];
  for (const [what, plan] of [["with no decided or open_gaps keys", BASE], ["with both as empty lists", { ...BASE, decided: [], open_gaps: [] }]] as const) {
    let html: string;
    try {
      html = renderToStaticMarkup(createElement(Piece, { plan } as never));
    } catch (error) {
      wrong.push("a plan " + what + " makes it throw: " + firstLine(error));
      continue;
    }
    if (html.trim() !== "") wrong.push("a plan " + what + ' still draws "' + (textOf(html) || html).slice(0, 80) + '"');
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("a plan with no decided or open_gaps keys, and one with both empty, each drew nothing");
});
