// protects: src/modules/analytics/sections/rnd/RndFeatureRow.tsx, src/modules/analytics/sections/rnd/rndReadingFigures.ts, src/modules/analytics/sections/registry.ts, src/modules/i18n/locales/en/common.json
// writes: none
//
// One feature adopted from R&D, as the Analytics R&D section draws it (rnd-adopted-measures, phase 4). RndFeatureRow is
// drawn in node over the real en words for features shaped as the dispatcher's RndFeatureReading:
//   - read: the title, the feature's word, says, what was promised, the value with its unit and the detail under it;
//     the same reading toned better, level and worse differs in its markup beyond the words (the tone is drawn);
//   - not_built says "Not built yet", failed shows the fault as the dispatcher wrote it, none says "No measure named yet";
//   - a Button only when measure.section is an id the registry holds (web-walk here; not an unknown id, not null), and
//     pressing it hands that id to the row's open handler.
// The press is found on the element tree the row returns (drawn inside a host component, so its hooks run) and called.

import { readFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ROW = path.join(REPO, "src/modules/analytics/sections/rnd/RndFeatureRow.tsx");
const LOCALE = path.join(REPO, "src/modules/i18n/locales/en/common.json");
const OPENABLE = "web-walk";
const FAULT = "It exited 2: probe-count: no queue named probe-dead";

const firstLine = (error: unknown): string => String((error as Error)?.message ?? error).split("\n")[0];
const textOf = (html: string): string =>
  html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const markupOf = (html: string): string => html.replace(/>[^<]*</g, "><");

const measure = (section: string | null) => ({
  says: "Outdated patterns standing in the probe frontend",
  promised: "41 findings over the probe tree (spike, 2026-11-25)",
  baseline: 41,
  unit: "patterns",
  better: "lower",
  section,
  set_at: "2026-11-25T10:00:00+00:00",
  set_by: "design case-probe",
});
const feature = (over: Record<string, unknown>) => ({
  candidate: "case-probe",
  plan: "case-probe",
  title: "Case probe feature",
  epic: null,
  word: "complete",
  adopted_at: "2026-11-25T09:00:00+00:00",
  measure: measure(null),
  state: "read",
  reading: { value: 38, detail: "probe-ui 12 standing", against: "better" },
  fault: null,
  ...over,
});

function pressOf(node: any): (() => unknown) | null {
  if (node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const each of node) {
      const found = pressOf(each);
      if (found) return found;
    }
    return null;
  }
  if (typeof node.props?.onClick === "function") return node.props.onClick;
  return pressOf(node.props?.children ?? null);
}

runCase(async () => {
  register(
    "data:text/javascript," +
      encodeURIComponent("export async function load(url, context, next) { if (/\\.(css|svg|png)(\\?|$)/.test(url)) return { format: 'module', source: 'export default {}', shortCircuit: true }; return next(url, context); }"),
  );
  (globalThis as any).window ??= globalThis;
  const en = JSON.parse(await readFile(LOCALE, "utf8"));
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const i18n = (await import("i18next")).default;
  const { initReactI18next } = await import("react-i18next");
  await i18n.use(initReactI18next).init({ lng: "en", fallbackLng: "en", defaultNS: "common", ns: ["common"], resources: { en: { common: en } }, interpolation: { escapeValue: false }, react: { useSuspense: false } });
  let mod: any;
  try {
    mod = await import(pathToFileURL(ROW).href);
  } catch (error) {
    const message = firstLine(error);
    if (error instanceof ReferenceError && / is not defined$/.test(message)) return cannotRun("RndFeatureRow needs a browser global node lacks: " + message);
    return broken("RndFeatureRow.tsx would not load: " + message);
  }
  const exported = mod.RndFeatureRow;
  const Row = typeof exported === "function" ? exported : exported?.type;
  if (typeof Row !== "function") return broken("RndFeatureRow.tsx exports no RndFeatureRow component");
  const pressed: string[] = [];
  const open = (id: string) => void pressed.push(id);
  const draw = (f: unknown): { html: string; text: string; press: (() => unknown) | null } => {
    let tree: unknown = null;
    const Host = () => {
      tree = Row({ feature: f, onOpenSection: open, openSection: open });
      return tree as any;
    };
    const html = renderToStaticMarkup(createElement(Host));
    return { html, text: textOf(html), press: pressOf(tree) };
  };
  const wrong: string[] = [];
  let rows: Record<string, ReturnType<typeof draw>>;
  try {
    rows = {
      better: draw(feature({})),
      level: draw(feature({ reading: { value: 38, detail: "probe-ui 12 standing", against: "level" } })),
      worse: draw(feature({ reading: { value: 38, detail: "probe-ui 12 standing", against: "worse" } })),
      notBuilt: draw(feature({ state: "not_built", reading: null })),
      failed: draw(feature({ state: "failed", reading: null, fault: FAULT })),
      none: draw(feature({ state: "none", measure: null, reading: null })),
      openable: draw(feature({ measure: measure(OPENABLE) })),
      unknownSection: draw(feature({ measure: measure("no-such-section") })),
    };
  } catch (error) {
    return broken("the row threw while drawing: " + firstLine(error));
  }
  const read = rows.better.text;
  for (const part of ["Case probe feature", "complete", "Outdated patterns standing in the probe frontend", "41 findings over the probe tree (spike, 2026-11-25)", "38", "patterns", "probe-ui 12 standing"]) {
    if (!read.includes(part)) wrong.push("the read row does not show " + JSON.stringify(part));
  }
  const looks = [rows.better, rows.level, rows.worse].map((row) => markupOf(row.html));
  if (looks[0] === looks[1] || looks[1] === looks[2] || looks[0] === looks[2]) wrong.push("better, level and worse draw the same markup but for their words: the reading is not toned by against");
  if (!rows.notBuilt.text.includes("Not built yet")) wrong.push('the not_built row does not say "Not built yet": ' + rows.notBuilt.text.slice(0, 160));
  if (!rows.failed.text.includes(FAULT)) wrong.push("the failed row does not show its fault as written: " + rows.failed.text.slice(0, 160));
  if (!rows.none.text.includes("No measure named yet")) wrong.push('the none row does not say "No measure named yet": ' + rows.none.text.slice(0, 160));
  if (!rows.none.text.includes("Case probe feature")) wrong.push("the none row does not show the feature's title");
  for (const key of ["better", "notBuilt", "failed", "none", "unknownSection"]) if (/<button\b/.test(rows[key].html)) wrong.push("the " + key + " row draws a button though its measure names no section the registry holds");
  if (!/<button\b/.test(rows.openable.html)) wrong.push("the row whose measure names " + OPENABLE + " draws no button");
  else if (rows.openable.press === null) wrong.push("the " + OPENABLE + " row's button carries no press handler");
  else {
    rows.openable.press();
    if (JSON.stringify(pressed) !== JSON.stringify([OPENABLE])) wrong.push("pressing the " + OPENABLE + " row's button handed " + JSON.stringify(pressed) + ", not [" + JSON.stringify(OPENABLE) + "]");
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("read row shows its seven parts, better/level/worse toned apart, not_built/failed/none say their words, and only the " + OPENABLE + " row's button opens " + JSON.stringify(pressed));
});
