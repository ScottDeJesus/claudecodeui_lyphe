// The Scheduling view's words are cerberus.scheduling.* in en/common.json, read through t() (MAN-7868). Every closed word
// the scheduling report's wire can carry needs a sentence there: the 20 reason codes, the four results, the four surfaces
// of a direct entry and the eleven doors a form opens from; How often reads the shared picture's leaves under
// cerberus.scheduling.often, where the grey part is a machine call. And every cerberus.scheduling key the module names, as
// a literal or as the fixed head of a template, resolves to words, so the screen never draws a key path.
//
// The closed words are seam 4's (eis_backend/scheduling_report/contracts.py, entries.py, verdict.py), as
// src/shared/scheduling-report-types.ts mirrors them. Matched by the words an object holds, never by where the builder put
// it, except tab, often and openers, which the design names. Read with i18next and the TypeScript compiler.
//
// protects: src/modules/i18n/locales/en/common.json, src/modules/scheduling-report, src/shared/ui/HowOften.tsx
// writes: none

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LOCALE = path.join(REPO, "src/modules/i18n/locales/en/common.json");
const MODULE = path.join(REPO, "src/modules/scheduling-report");
const HOW_OFTEN = path.join(REPO, "src/shared/ui/HowOften.tsx");
const ROOT = "cerberus.scheduling";

const OPENERS = [
  "schedule_new", "schedule_slot", "schedule_drag", "schedule_visit", "calendar_entry", "unscheduled_list",
  "job_schedule_band", "work_list", "call_script", "carrier_region", "unknown",
];
const REASONS = [
  "server_fault", "scheduling_unavailable", "calendar_failed", "no_answer", "crew_refused", "login_required", "request_refused",
  "nobody_offered", "availability_unread", "visit_unreadable", "no_open_times", "gave_up", "undone", "not_reported",
  "closed_without_booking", "calendar_paused", "crew_downgraded", "drive_times_not_checked", "not_best_fit", "own_time",
];
// Each word may stand snake_case, as the wire carries it, or camelCase; `nothing` may be named for its words.
const RESULTS = [["booked"], ["changed"], ["cancelled"], ["nothing", "closed_without_booking", "closedWithoutBooking"]];
const SURFACES = [["grid_move", "gridMove"], ["grid_resize", "gridResize"], ["undo"], ["api"]];

const camel = (w: string) => w.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await filesUnder(full)));
    else if (/\.(ts|tsx)$/.test(ent.name)) out.push(full);
  }
  return out;
}

runCase(async () => {
  const en = JSON.parse(await readFile(LOCALE, "utf8"));
  const i18n = (await import("i18next")).default.createInstance();
  await i18n.init({ lng: "en", resources: { en: { common: en } }, defaultNS: "common", interpolation: { escapeValue: false } });
  const node = (key: string): unknown => key.split(".").reduce<any>((at, part) => (at && typeof at === "object" ? at[part] : undefined), en);
  const resolves = (key: string) => [undefined, { count: 1 }, { count: 2 }].some((o) => i18n.exists(key, o as any) && i18n.t(key, o as any) !== key);

  const root = node(ROOT);
  if (!root || typeof root !== "object") return broken(`en/common.json holds no ${ROOT} object`);
  const wrong: string[] = [];

  if (i18n.t(`${ROOT}.tab`) !== "Scheduling") wrong.push(`${ROOT}.tab reads ${JSON.stringify(i18n.t(`${ROOT}.tab`))}, not "Scheduling"`);

  // How often: every leaf the shared picture reads, as its own props comment lists them.
  const howOften = await readFile(HOW_OFTEN, "utf8");
  const leaves = /The i18n key prefix whose leaves the picture reads \(([^)]+)\)/.exec(howOften)?.[1].split(",").map((s) => s.trim()) ?? [];
  if (leaves.length < 10) wrong.push(`HowOften.tsx no longer lists the leaves it reads (found ${leaves.length}); this case reads them there`);
  const missingOften = leaves.filter((leaf) => !resolves(`${ROOT}.often.${leaf}`));
  if (missingOften.length > 0) wrong.push(`often lacks ${missingOften.join(", ")}`);
  if (!/machine/i.test(i18n.t(`${ROOT}.often.legend.test`))) wrong.push(`often.legend.test reads ${JSON.stringify(i18n.t(`${ROOT}.often.legend.test`))}, not machine calls`);

  const missingOpeners = OPENERS.filter((o) => !resolves(`${ROOT}.openers.${o}`));
  if (missingOpeners.length > 0) wrong.push(`openers lacks ${missingOpeners.join(", ")}`);

  // The closed vocabularies, wherever under cerberus.scheduling the builder keeps each.
  const objects: [string, Record<string, unknown>][] = [];
  const walk = (at: unknown, where: string) => {
    if (!at || typeof at !== "object") return;
    objects.push([where, at as Record<string, unknown>]);
    for (const [k, v] of Object.entries(at)) walk(v, `${where}.${k}`);
  };
  walk(root, ROOT);
  const holder = (groups: string[][]) =>
    objects.find(([where, obj]) => groups.every((alts) => alts.some((w) => (w in obj || camel(w) in obj) && [w, camel(w)].some((k) => k in obj && resolves(`${where}.${k}`)))));
  const reasonHome = holder(REASONS.map((r) => [r]));
  if (!reasonHome) {
    const best = objects.map(([w, o]) => [w, REASONS.filter((r) => r in o || camel(r) in o)] as const).sort((a, b) => b[1].length - a[1].length)[0];
    wrong.push(`no object under ${ROOT} words all 20 reason codes${best && best[1].length > 0 ? ` (nearest: ${best[0]}, lacking ${REASONS.filter((r) => !best[1].includes(r)).join(", ")})` : ""}`);
  }
  if (!holder(RESULTS)) wrong.push(`no object under ${ROOT} words the four results (booked, changed, cancelled, nothing)`);
  if (!holder(SURFACES)) wrong.push(`no object under ${ROOT} words the four direct surfaces (grid_move, grid_resize, undo, api)`);

  const empty = objects.flatMap(([where, obj]) => Object.entries(obj).filter(([, v]) => typeof v === "string" && v.trim() === "").map(([k]) => `${where}.${k}`));
  if (empty.length > 0) wrong.push(`empty words at ${empty.slice(0, 5).join(", ")}`);

  // Every key the module names: a literal must resolve to words, a template's fixed head must be an object of words.
  let files: string[];
  try {
    files = await filesUnder(MODULE);
  } catch {
    return broken(`src/modules/scheduling-report is not on disk${wrong.length ? `; and ${wrong.join("; ")}` : ""}`);
  }
  const ts = (await import("typescript")).default;
  const named: string[] = [];
  const unresolved: string[] = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n: any) => {
      const rel = path.relative(REPO, file);
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text.startsWith(`${ROOT}.`)) {
        named.push(n.text);
        const at = node(n.text);
        if (!(at && typeof at === "object") && !resolves(n.text)) unresolved.push(`${n.text} (${rel})`);
      } else if (ts.isTemplateExpression(n) && n.head.text.startsWith(`${ROOT}.`)) {
        const head = n.head.text.replace(/\.$/, "");
        named.push(`${n.head.text}…`);
        const at = node(head);
        if (!at || typeof at !== "object") unresolved.push(`${n.head.text}\${…} (${rel}): ${head} is no object of words`);
      }
      ts.forEachChild(n, visit);
    };
    visit(source);
  }
  if (named.length === 0) wrong.push(`no file under src/modules/scheduling-report names a ${ROOT} key`);
  if (unresolved.length > 0) wrong.push(`keys that draw their own path: ${unresolved.slice(0, 8).join("; ")}${unresolved.length > 8 ? ` (+${unresolved.length - 8})` : ""}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`tab, ${leaves.length} often leaves, 11 openers, the 20 reasons (${reasonHome?.[0]}), results and surfaces all worded; ${named.length} keys named across ${files.length} files all resolve`);
});
