// The scheduling-report module's public surface is its barrel (src/modules/scheduling-report/index.ts), in the
// upload-runs barrel's idiom: SchedulingView is React.lazy over a dynamic import of the module's own SchedulingView
// file, so the view is its own chunk, loaded the first time Scheduling is shown and never by opening the Cerberus tab.
// A static import of any module file in the barrel would pull the view into the panel's chunk, so the barrel holds none.
//
// The barrel is imported in node, its stylesheets answered empty and `window` stood in by globalThis, and the lazy's own
// loader is called to show it resolves to a component. Nothing is drawn and nothing leaves the process.
//
// protects: src/modules/scheduling-report/index.ts, src/modules/scheduling-report/SchedulingView.tsx
// writes: none

import { readFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/modules/scheduling-report");
const BARREL = path.join(MODULE, "index.ts");
const OWN = /^(@\/modules\/scheduling-report\/|\.\/)SchedulingView(\.tsx)?$/;

runCase(async () => {
  let text: string;
  try {
    text = await readFile(BARREL, "utf8");
  } catch {
    return broken("src/modules/scheduling-report/index.ts is not on disk");
  }
  const ts = (await import("typescript")).default;
  const source = ts.createSourceFile(BARREL, text, ts.ScriptTarget.Latest, true);
  const wrong: string[] = [];

  // The barrel's static imports: React's lazy, and types; nothing of the module's own files.
  for (const st of source.statements) {
    if (!ts.isImportDeclaration(st) && !(ts.isExportDeclaration(st) && st.moduleSpecifier)) continue;
    const from = (st.moduleSpecifier as any).text as string;
    const typeOnly = ts.isImportDeclaration(st) ? st.importClause?.isTypeOnly : st.isTypeOnly;
    if (from !== "react" && !typeOnly) wrong.push(`the barrel imports ${from} statically`);
  }
  const dynamic: string[] = [];
  const visit = (n: any) => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) dynamic.push(n.arguments[0].text);
    ts.forEachChild(n, visit);
  };
  visit(source);
  if (!dynamic.some((d) => OWN.test(d))) wrong.push(`no dynamic import of the module's SchedulingView (found ${JSON.stringify(dynamic)})`);

  // The lazy itself, resolved.
  register(
    "data:text/javascript," +
      encodeURIComponent("export async function load(url, context, next) { if (/\\.(css|svg|png)(\\?|$)/.test(url)) return { format: 'module', source: 'export default {}', shortCircuit: true }; return next(url, context); }"),
  );
  (globalThis as any).window ??= globalThis;
  let barrel: any;
  try {
    barrel = await import(pathToFileURL(BARREL).href);
  } catch (error) {
    return broken(`the barrel would not load: ${String((error as Error).message).split("\n")[0]}`);
  }
  const view = barrel.SchedulingView;
  if (!view) return broken(`the barrel exports no SchedulingView (it exports ${Object.keys(barrel).join(", ") || "nothing"})`);
  if (view.$$typeof !== Symbol.for("react.lazy")) wrong.push(`SchedulingView is ${String(view.$$typeof ?? typeof view)}, not a React lazy`);
  else if (view._payload?._status === -1 && typeof view._payload._result === "function") {
    let loaded: any;
    try {
      loaded = await view._payload._result();
    } catch (error) {
      const message = String((error as Error).message).split("\n")[0];
      // A browser global node lacks is this process's limit, not the view's fault.
      if (error instanceof ReferenceError && / is not defined$/.test(message)) return cannotRun(`the view needs a browser global node lacks: ${message}`);
      return broken(`the lazy's loader threw: ${message}`);
    }
    const component = loaded?.default;
    const kind = typeof component === "function" ? "function" : component?.$$typeof ? String(component.$$typeof) : typeof component;
    if (!(typeof component === "function" || component?.$$typeof === Symbol.for("react.memo") || component?.$$typeof === Symbol.for("react.forward_ref"))) {
      wrong.push(`the lazy resolves to ${kind}, not a component`);
    }
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`SchedulingView is React.lazy over import(${JSON.stringify(dynamic.find((d) => OWN.test(d)))}), resolving to a component; the barrel imports only react statically`);
});
