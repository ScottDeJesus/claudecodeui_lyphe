// The client mirror of the scheduling report's wire (src/shared/scheduling-report-types.ts) carries each body's keys as
// the backend sends them (eis_backend/scheduling_report/read.py, internal_routes.py, verdict.py): snake_case, every key
// present — a missing value is null on the wire, never an absent key — except a reason's `count` and `detail`, which the
// verdict leaves out when a reason has none. A key renamed on one side and not the other is a screen that quietly stops
// reading; this case reads the client side against seam 4's list and is updated with the backend when it changes.
//
// Matched by the keys a shape holds, never by its name: an interface, a type alias of an object or an inline object
// type all count, an interface's local `extends` and a local `&` merged in. Read with the TypeScript compiler.
//
// protects: src/shared/scheduling-report-types.ts
// writes: none

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/shared/scheduling-report-types.ts");

// A trailing `?` marks the one optional key; every other key is required.
const SHAPES: Record<string, string[]> = {
  overview: ["generated_at", "window", "filters", "kinds", "entries", "truncated", "openers", "people", "accounts"],
  "overview window": ["days", "from", "to"],
  "overview filters": ["by", "machines", "account"],
  "kind counts": ["kind", "clean", "hiccups", "trend", "last_at"],
  "opener count": ["opener", "entries"],
  "person count": ["actor", "entries"],
  entry: [
    "id", "form", "state", "account_id", "actor", "actor_kind", "kind", "result", "opener", "surface", "job", "visit_id",
    "started_at", "ended_at", "open_seconds", "presses", "lead", "verdict", "tone", "reasons",
  ],
  job: ["id", "customer_name", "project_number", "loss_type"],
  person: ["id", "name"],
  presses: ["total", "ok", "refused", "failed"],
  reason: ["code", "tone", "count?", "detail?"],
  "entry whole": ["entry", "session", "acts", "visit_now", "after"],
  session: ["mode", "opener", "proposal", "offered", "chosen", "presses", "unanswered", "edit_unreadable", "best_fit"],
  act: [
    "id", "at", "kind", "surface", "session_id", "actor", "actor_kind", "status", "outcome", "code", "calendar",
    "calendar_reason", "crew_downgraded", "start_at", "end_at", "visit_type", "lead", "support", "touched", "latency_ms",
  ],
  "visit now": ["status", "start_at", "end_at", "visit_type", "cancelled_at"],
};

const sig = (keys: Iterable<string>) => [...keys].sort().join(",");

runCase(async () => {
  const ts = (await import("typescript")).default;
  let text: string;
  try {
    text = await readFile(FILE, "utf8");
  } catch {
    return broken("src/shared/scheduling-report-types.ts is not on disk");
  }
  const source = ts.createSourceFile(FILE, text, ts.ScriptTarget.Latest, true);

  const named = new Map<string, any>();
  for (const st of source.statements) {
    if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) named.set(st.name.text, st);
  }

  // key → optional, for an object-like node; null when the node is not one this file can resolve.
  const keysOf = (node: any, seen = new Set<string>()): Map<string, boolean> | null => {
    if (!node) return null;
    if (ts.isParenthesizedTypeNode(node)) return keysOf(node.type, seen);
    if (ts.isTypeLiteralNode(node) || ts.isInterfaceDeclaration(node)) {
      const out = new Map<string, boolean>();
      if (ts.isInterfaceDeclaration(node)) {
        for (const clause of node.heritageClauses ?? []) {
          for (const t of clause.types) {
            const base = ts.isIdentifier(t.expression) ? keysOf(named.get(t.expression.text), seen) : null;
            if (!base) return null;
            base.forEach((v, k) => out.set(k, v));
          }
        }
      }
      for (const m of node.members) {
        if (!ts.isPropertySignature(m) || !m.name) return null;
        const name = ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) ? m.name.text : null;
        if (name === null) return null;
        out.set(name, Boolean(m.questionToken));
      }
      return out;
    }
    if (ts.isIntersectionTypeNode(node)) {
      const out = new Map<string, boolean>();
      for (const part of node.types) {
        const k = keysOf(part, seen);
        if (!k) return null;
        k.forEach((v, n) => out.set(n, v));
      }
      return out;
    }
    if (ts.isTypeAliasDeclaration(node)) return keysOf(node.type, seen);
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && !seen.has(node.typeName.text)) {
      seen.add(node.typeName.text);
      return keysOf(named.get(node.typeName.text), seen);
    }
    return null;
  };

  const shapes: Array<Map<string, boolean>> = [];
  const visit = (node: any) => {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node) || (ts.isTypeAliasDeclaration(node) && ts.isIntersectionTypeNode(node.type))) {
      const k = keysOf(node);
      if (k && k.size > 0) shapes.push(k);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  const wrong: string[] = [];
  for (const [what, spec] of Object.entries(SHAPES)) {
    const want = new Map(spec.map((k) => [k.replace(/\?$/, ""), k.endsWith("?")] as [string, boolean]));
    const sameKeys = shapes.filter((s) => sig(s.keys()) === sig(want.keys()));
    if (sameKeys.length === 0) {
      wrong.push(`no shape carries exactly the ${what} keys (${[...want.keys()].join(" ")})`);
      continue;
    }
    const exact = sameKeys.some((s) => [...want].every(([k, opt]) => s.get(k) === opt));
    if (!exact) {
      const s = sameKeys[0];
      const off = [...want].filter(([k, opt]) => s.get(k) !== opt).map(([k, opt]) => `${k} ${opt ? "should be optional" : "should be required"}`);
      wrong.push(`the ${what} shape: ${off.join(", ")}`);
    }
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`all ${Object.keys(SHAPES).length} wire shapes carry exactly their snake_case keys; only a reason's count and detail are optional`);
});
