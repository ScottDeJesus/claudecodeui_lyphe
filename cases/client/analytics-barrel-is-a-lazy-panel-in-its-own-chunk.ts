// protects: src/modules/analytics/index.ts, src/modules/analytics/AnalyticsPanel.tsx
// writes: none
//
// The Analytics module's public surface is its barrel (src/modules/analytics/index.ts), in the Cerberus barrel's idiom
// (analytics-code-mode, interface G): AnalyticsPanel is React.lazy over a dynamic import of the module's own
// AnalyticsPanel file, so the pane is its own chunk, loaded the first time the place is opened. A static import of any
// module file in the barrel would pull the panel into the workspace's chunk, so the barrel holds none.
//
// The barrel is read with the TypeScript compiler for its imports, then imported in node (stylesheets answered empty,
// window stood in by globalThis) and the lazy's own loader called to show it resolves to a component.

import { readFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/modules/analytics");
const BARREL = path.join(MODULE, "index.ts");
const OWN = /^(@\/modules\/analytics\/|\.\/)AnalyticsPanel(\.tsx)?$/;

runCase(async () => {
  let text: string;
  try {
    text = await readFile(BARREL, "utf8");
  } catch {
    return broken("src/modules/analytics/index.ts is not on disk");
  }
  const ts = (await import("typescript")).default;
  const source = ts.createSourceFile(BARREL, text, ts.ScriptTarget.Latest, true);
  const wrong: string[] = [];
  for (const st of source.statements) {
    if (!ts.isImportDeclaration(st) && !(ts.isExportDeclaration(st) && st.moduleSpecifier)) continue;
    const from = (st.moduleSpecifier as any).text as string;
    const typeOnly = ts.isImportDeclaration(st) ? st.importClause?.isTypeOnly : st.isTypeOnly;
    if (from !== "react" && !typeOnly) wrong.push("the barrel imports " + from + " statically");
  }
  const dynamic: string[] = [];
  const visit = (n: any) => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) dynamic.push(n.arguments[0].text);
    ts.forEachChild(n, visit);
  };
  visit(source);
  if (!dynamic.some((d) => OWN.test(d))) wrong.push("no dynamic import of the module's AnalyticsPanel (found " + JSON.stringify(dynamic) + ")");

  register(
    "data:text/javascript," +
      encodeURIComponent("export async function load(url, context, next) { if (/\\.(css|svg|png)(\\?|$)/.test(url)) return { format: 'module', source: 'export default {}', shortCircuit: true }; return next(url, context); }"),
  );
  (globalThis as any).window ??= globalThis;
  let barrel: any;
  try {
    barrel = await import(pathToFileURL(BARREL).href);
  } catch (error) {
    return broken("the barrel would not load: " + String((error as Error).message).split("\n")[0]);
  }
  const view = barrel.AnalyticsPanel;
  if (!view) return broken("the barrel exports no AnalyticsPanel (it exports " + (Object.keys(barrel).join(", ") || "nothing") + ")");
  if (view.$$typeof !== Symbol.for("react.lazy")) wrong.push("AnalyticsPanel is " + String(view.$$typeof ?? typeof view) + ", not a React lazy");
  else if (view._payload?._status === -1 && typeof view._payload._result === "function") {
    let loaded: any;
    try {
      loaded = await view._payload._result();
    } catch (error) {
      const message = String((error as Error).message).split("\n")[0];
      if (error instanceof ReferenceError && / is not defined$/.test(message)) return cannotRun("the panel needs a browser global node lacks: " + message);
      return broken("the lazy's loader threw: " + message);
    }
    const c = loaded?.default;
    if (!(typeof c === "function" || c?.$$typeof === Symbol.for("react.memo") || c?.$$typeof === Symbol.for("react.forward_ref"))) wrong.push("the lazy resolves to " + typeof c + ", not a component");
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("AnalyticsPanel is React.lazy over import(" + JSON.stringify(dynamic.find((d) => OWN.test(d))) + "), resolving to a component; the barrel imports only react statically");
});
