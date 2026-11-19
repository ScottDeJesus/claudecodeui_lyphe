// The Scheduling view's contract with its fill (src/modules/scheduling-report/utils/schedulingModel.ts) is fixed by the
// scaffold cut: the view composes against these four shapes, and the fill's two hooks answer them. A key renamed here
// without the parts and the hooks is a view that quietly reads nothing, so the file's shapes are held key for key.
// It is types only: it imports the wire's types from @/shared/scheduling-report-types and DayBucket from
// @/shared/dayBuckets, and runs nothing.
//
// Read with the TypeScript compiler; nothing is imported or run.
//
// protects: src/modules/scheduling-report/utils/schedulingModel.ts
// writes: none

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/modules/scheduling-report/utils/schedulingModel.ts");

// Each exported shape: its keys exactly, and for some a pattern its type text must match (spaces squeezed out).
const SHAPES: Record<string, Record<string, RegExp | null>> = {
  SchedulingFilters: { by: /^(string\|null|null\|string)$/, machines: /^boolean$/, bumpsOnly: /^boolean$/ },
  SchedulingRead: {
    phase: null,
    overview: /^(SchedulingOverview\|null|null\|SchedulingOverview)$/,
    trouble: /^(string\|null|null\|string)$/,
    stale: /^boolean$/,
    days: /^(DayBucket\[\]|readonlyDayBucket\[\]|Array<DayBucket>)$/,
    hours: /^(number\[\]|readonlynumber\[\]|Array<number>)$/,
  },
  EntrySheetRead: {
    phase: null,
    whole: /^(SchedulingEntryWhole\|null|null\|SchedulingEntryWhole)$/,
    trouble: /^(string\|null|null\|string)$/,
  },
};
const PHASES = "loading|ready|trouble";

runCase(async () => {
  const ts = (await import("typescript")).default;
  let text: string;
  try {
    text = await readFile(FILE, "utf8");
  } catch {
    return broken("src/modules/scheduling-report/utils/schedulingModel.ts is not on disk");
  }
  const source = ts.createSourceFile(FILE, text, ts.ScriptTarget.Latest, true);
  const squeeze = (s: string) => s.replace(/\s+/g, "").replace(/;$/, "");
  const wrong: string[] = [];

  const types = new Map<string, any>();
  const imports = new Map<string, string>(); // a name imported → the module it came from
  for (const st of source.statements) {
    if (ts.isImportDeclaration(st)) {
      const from = (st.moduleSpecifier as any).text as string;
      const clause = st.importClause;
      const typeOnly = clause?.isTypeOnly ?? false;
      const bindings = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : [];
      if (!clause || clause.name || (!typeOnly && bindings.some((b: any) => !b.isTypeOnly))) wrong.push(`it imports values from ${from}, not types only`);
      for (const b of bindings) imports.set(b.name.text, from);
      continue;
    }
    if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) {
      const exported = st.modifiers?.some((m: any) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (exported) types.set(st.name.text, st);
      continue;
    }
    if (ts.isExportDeclaration(st) && st.isTypeOnly) continue;
    wrong.push(`it runs something: ${squeeze(st.getText(source)).slice(0, 60)}`);
  }

  for (const [name, from] of [["SchedulingOverview", "@/shared/scheduling-report-types"], ["SchedulingEntryWhole", "@/shared/scheduling-report-types"], ["DayBucket", "@/shared/dayBuckets"]]) {
    if (imports.get(name) !== from) wrong.push(`${name} comes from ${imports.get(name) ?? "nowhere"}, not ${from}`);
  }

  const win = types.get("SchedulingWindow");
  if (!win || !ts.isTypeAliasDeclaration(win)) wrong.push("no exported type SchedulingWindow");
  else {
    const nums = ts.isUnionTypeNode(win.type) ? win.type.types.map((m: any) => (ts.isLiteralTypeNode(m) && ts.isNumericLiteral(m.literal) ? m.literal.text : "?")) : ["?"];
    if (nums.slice().sort().join("|") !== ["30", "7", "90"].join("|")) wrong.push(`SchedulingWindow is ${squeeze(win.type.getText(source))}, not 7 | 30 | 90`);
  }

  for (const [name, want] of Object.entries(SHAPES)) {
    const decl = types.get(name);
    if (!decl) { wrong.push(`no exported type ${name}`); continue; }
    const members = ts.isInterfaceDeclaration(decl) ? decl.members : ts.isTypeLiteralNode(decl.type) ? decl.type.members : null;
    if (!members) { wrong.push(`${name} is not an object shape`); continue; }
    const got = new Map<string, string>();
    for (const m of members) if (ts.isPropertySignature(m) && m.type) got.set((m.name as any).text, squeeze(m.type.getText(source)));
    const keys = [...got.keys()].sort().join(",");
    if (keys !== Object.keys(want).sort().join(",")) wrong.push(`${name} holds {${keys}}, not {${Object.keys(want).sort().join(",")}}`);
    for (const [key, pattern] of Object.entries(want)) {
      const type = got.get(key);
      if (type === undefined) continue;
      if (key === "phase") {
        const words = type.split("|").map((w) => w.replace(/['"]/g, "")).sort().join("|");
        if (words !== PHASES) wrong.push(`${name}.phase is ${type}, not 'loading' | 'ready' | 'trouble'`);
      } else if (pattern && !pattern.test(type)) wrong.push(`${name}.${key} is ${type}`);
    }
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("schedulingModel.ts is types only, imports its wire types and DayBucket from their homes, and holds SchedulingWindow, SchedulingFilters, SchedulingRead and EntrySheetRead key for key");
});
