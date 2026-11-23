// protects: src/modules/analytics/sections/registry.ts, src/modules/analytics/sections/web-walk/WebWalkSection.tsx, src/modules/i18n/locales/en/common.json
// writes: none
//
// The Analytics area's Web walks section (web-helper, phase 7) is one row of sections/registry.ts with id web-walk, its
// name the key analytics.sections.webWalk that en/common.json spells, windows of 7, 30 and 90 days opening on 30, and a
// lazy Body that resolves to the section's component. Code Mode stays the first row, where the area opens.
//
// The registry is imported in node, its stylesheets answered empty, and the row's lazy loader is called to show it
// resolves; a browser global node lacks is this process's limit and reads CANNOT RUN.

import { readFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REGISTRY = path.join(REPO, "src/modules/analytics/sections/registry.ts");
const LOCALE = path.join(REPO, "src/modules/i18n/locales/en/common.json");
const WANT = { id: "web-walk", titleKey: "analytics.sections.webWalk", windows: [7, 30, 90], defaultDays: 30 };

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
  const rows: any[] = Array.isArray(registry.ANALYTICS_SECTIONS) ? registry.ANALYTICS_SECTIONS : [];
  const at = rows.findIndex((row) => row?.id === WANT.id);
  if (at < 0) return broken("sections/registry.ts holds no web-walk row; its ids are " + JSON.stringify(rows.map((row) => row?.id)));
  const row = rows[at];
  const wrong: string[] = [];
  if (rows.filter((other) => other?.id === WANT.id).length > 1) wrong.push("web-walk is the id of more than one row");
  if (rows[0]?.id !== "code-mode") wrong.push("the first row is " + JSON.stringify(rows[0]?.id) + ", not code-mode");
  const got = { id: row.id, titleKey: row.titleKey, windows: Array.isArray(row.windows) ? [...row.windows] : row.windows, defaultDays: row.defaultDays };
  if (JSON.stringify(got) !== JSON.stringify(WANT)) wrong.push("the web-walk row is " + JSON.stringify(got) + ", not " + JSON.stringify(WANT));
  const name = spelled(WANT.titleKey);
  if (typeof name !== "string" || name.trim() === "") wrong.push(WANT.titleKey + " is not a string in en/common.json");
  const body = row.Body;
  if (body?.$$typeof !== Symbol.for("react.lazy")) {
    wrong.push("the web-walk row's Body is not a React lazy");
  } else if (body._payload?._status === -1 && typeof body._payload._result === "function") {
    let loaded: any;
    try {
      loaded = await body._payload._result();
    } catch (error) {
      const message = firstLine(error);
      if (error instanceof ReferenceError && / is not defined$/.test(message)) return cannotRun("web-walk's Body needs a browser global node lacks: " + message);
      wrong.push("web-walk's Body's loader threw: " + message);
    }
    const c = loaded?.default;
    if (loaded && !(typeof c === "function" || c?.$$typeof === Symbol.for("react.memo") || c?.$$typeof === Symbol.for("react.forward_ref"))) wrong.push("web-walk's Body resolves to " + typeof c + ", not a component");
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("row " + (at + 1) + " of " + rows.length + " is " + JSON.stringify(got) + ', named "' + String(name) + '", after code-mode, its Body lazy and a component');
});
