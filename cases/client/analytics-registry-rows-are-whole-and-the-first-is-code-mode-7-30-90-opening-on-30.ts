// protects: src/modules/analytics/sections/registry.ts, src/modules/i18n/locales/en/common.json
// writes: none
//
// The Analytics area's sections are the rows of sections/registry.ts (analytics-code-mode, interface G), and the panel
// draws its strip and its windows from them and nothing else. A row is whole when its id is its own, its name is a key
// under analytics. that en/common.json spells, its windows are whole days in rising order holding the one it opens on,
// and its Body is lazy (its own chunk) and resolves to a component. The first row, where the area opens, is Code Mode:
// code-mode, analytics.sections.codeMode, 7, 30 and 90 days, opening on 30.
//
// The registry is imported in node, its stylesheets answered empty, and each Body's lazy loader is called to show it
// resolves; a browser global node lacks is this process's limit and reads CANNOT RUN.

import { readFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REGISTRY = path.join(REPO, "src/modules/analytics/sections/registry.ts");
const LOCALE = path.join(REPO, "src/modules/i18n/locales/en/common.json");

const firstLine = (error: unknown): string => String((error as Error)?.message ?? error).split("\n")[0];

runCase(async () => {
  register(
    "data:text/javascript," +
      encodeURIComponent("export async function load(url, context, next) { if (/\\.(css|svg|png)(\\?|$)/.test(url)) return { format: 'module', source: 'export default {}', shortCircuit: true }; return next(url, context); }"),
  );
  (globalThis as any).window ??= globalThis;
  const en = JSON.parse(await readFile(LOCALE, "utf8"));
  const spelled = (key: string): unknown => key.split(".").reduce((node: any, part) => (node && typeof node === "object" ? node[part] : undefined), en);
  let registry: any;
  try {
    registry = await import(pathToFileURL(REGISTRY).href);
  } catch (error) {
    return broken("the registry would not load: " + firstLine(error));
  }
  const rows: any[] = registry.ANALYTICS_SECTIONS;
  if (!Array.isArray(rows) || rows.length === 0) return broken("sections/registry.ts holds no ANALYTICS_SECTIONS rows");
  const wrong: string[] = [];
  const ids = new Set<string>();
  for (const row of rows) {
    const id = String(row?.id ?? "");
    if (!id || ids.has(id)) wrong.push("a row's id is empty or repeated: " + JSON.stringify(row?.id));
    ids.add(id);
    if (typeof row.titleKey !== "string" || !row.titleKey.startsWith("analytics.") || typeof spelled(row.titleKey) !== "string") wrong.push(id + "'s titleKey " + JSON.stringify(row.titleKey) + " is not a string under analytics. in en/common.json");
    const w = Array.isArray(row.windows) ? row.windows : [];
    const whole = w.length > 0 && w.every((d: unknown, i: number) => Number.isInteger(d) && (d as number) > 0 && (i === 0 || (d as number) > w[i - 1]));
    if (!whole) wrong.push(id + "'s windows " + JSON.stringify(row.windows) + " are not whole days in rising order");
    if (!w.includes(row.defaultDays)) wrong.push(id + "'s defaultDays " + JSON.stringify(row.defaultDays) + " is not one of its windows");
    const body = row.Body;
    if (body?.$$typeof !== Symbol.for("react.lazy")) { wrong.push(id + "'s Body is not a React lazy"); continue; }
    if (body._payload?._status === -1 && typeof body._payload._result === "function") {
      let loaded: any;
      try {
        loaded = await body._payload._result();
      } catch (error) {
        const message = firstLine(error);
        if (error instanceof ReferenceError && / is not defined$/.test(message)) return cannotRun(id + "'s Body needs a browser global node lacks: " + message);
        wrong.push(id + "'s Body's loader threw: " + message);
        continue;
      }
      const c = loaded?.default;
      if (!(typeof c === "function" || c?.$$typeof === Symbol.for("react.memo") || c?.$$typeof === Symbol.for("react.forward_ref"))) wrong.push(id + "'s Body resolves to " + typeof c + ", not a component");
    }
  }
  const first = rows[0];
  const want = { id: "code-mode", titleKey: "analytics.sections.codeMode", windows: [7, 30, 90], defaultDays: 30 };
  const got = { id: first.id, titleKey: first.titleKey, windows: Array.isArray(first.windows) ? [...first.windows] : first.windows, defaultDays: first.defaultDays };
  if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push("the first row is " + JSON.stringify(got) + ", not " + JSON.stringify(want));

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(rows.length + " row(s); the first " + JSON.stringify(got) + ', named "' + String(spelled(first.titleKey)) + '", its Body lazy and a component');
});
