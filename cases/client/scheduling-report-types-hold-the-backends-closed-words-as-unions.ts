// The client mirror of the scheduling report's wire (src/shared/scheduling-report-types.ts) holds the backend's CLOSED
// words as string-literal unions, so a word the backend adds or drops is a type error on the screen, never a row that
// quietly reads nothing. The words are seam 4's (eis_backend/scheduling_report/contracts.py, entries.py, verdict.py);
// when the backend changes one ON PURPOSE, this case is updated with it, the same day.
//
// Matched by the words a union holds, never by its name: the builder names the types. Read with the TypeScript compiler.
//
// protects: src/shared/scheduling-report-types.ts
// writes: none

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/shared/scheduling-report-types.ts");

// Each must be an EXPORTED type alias whose literals are exactly these.
const EXPORTED: Record<string, string[]> = {
  "entry kind": ["book", "change", "cancel"],
  result: ["booked", "changed", "cancelled", "nothing"],
  state: ["reported", "open", "not_reported", "direct"],
  verdict: ["clean", "hiccup"],
  tone: ["positive", "warn", "danger"],
  "reason code": [
    "server_fault", "scheduling_unavailable", "calendar_failed", "no_answer", "crew_refused", "login_required", "request_refused",
    "nobody_offered", "availability_unread", "visit_unreadable", "no_open_times",
    "gave_up", "undone", "not_reported",
    "closed_without_booking", "calendar_paused", "crew_downgraded", "drive_times_not_checked", "not_best_fit", "own_time",
  ],
  outcome: ["ok", "refused", "not_found", "invalid", "unavailable", "fault"],
  calendar: ["none", "paused", "confirmed", "error"],
  surface: ["form", "grid_move", "grid_resize", "undo", "api"],
  opener: [
    "schedule_new", "schedule_slot", "schedule_drag", "schedule_visit", "calendar_entry", "unscheduled_list",
    "job_schedule_band", "work_list", "call_script", "carrier_region", "unknown",
  ],
};
// Each must be held by some union in the file, exported alias or a property's own type.
const HELD: Record<string, string[]> = {
  "act kind": ["create", "edit", "cancel"],
  "reason tone": ["danger", "warn", "neutral"],
  trend: ["up", "down", "flat"],
};

const key = (words: Iterable<string>) => [...words].sort().join("|");

runCase(async () => {
  const ts = (await import("typescript")).default;
  let text: string;
  try {
    text = await readFile(FILE, "utf8");
  } catch {
    return broken("src/shared/scheduling-report-types.ts is not on disk");
  }
  const source = ts.createSourceFile(FILE, text, ts.ScriptTarget.Latest, true);

  const aliases = new Map<string, any>();
  for (const st of source.statements) if (ts.isTypeAliasDeclaration(st)) aliases.set(st.name.text, st);

  // The string literals a type holds, `null` members passed over; null when it is not a closed set of words.
  const words = (node: any, seen = new Set<string>()): Set<string> | null => {
    if (ts.isParenthesizedTypeNode(node)) return words(node.type, seen);
    if (ts.isUnionTypeNode(node)) {
      const out = new Set<string>();
      for (const member of node.types) {
        if (ts.isLiteralTypeNode(member) && member.literal.kind === ts.SyntaxKind.NullKeyword) continue;
        const part = words(member, seen);
        if (!part) return null;
        part.forEach((w) => out.add(w));
      }
      return out;
    }
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) return new Set([node.literal.text]);
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && aliases.has(node.typeName.text) && !seen.has(node.typeName.text)) {
      seen.add(node.typeName.text);
      return words(aliases.get(node.typeName.text).type, seen);
    }
    return null;
  };

  const exportedSets = new Set<string>();
  for (const decl of aliases.values()) {
    const exported = decl.modifiers?.some((m: any) => m.kind === ts.SyntaxKind.ExportKeyword);
    const set = words(decl.type);
    if (exported && set && set.size > 0) exportedSets.add(key(set));
  }
  const anywhere = new Set<string>(exportedSets);
  const frames: string[] = [];
  const visit = (node: any) => {
    if (ts.isUnionTypeNode(node) || ts.isLiteralTypeNode(node) || ts.isTypeReferenceNode(node)) {
      const set = words(node);
      if (set && set.size > 0) anywhere.add(key(set));
    }
    const members = ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node) ? node.members : null;
    if (members && members.length === 1) {
      const [m] = members;
      if (ts.isPropertySignature(m) && m.name && (m.name as any).text === "type" && m.type && key(words(m.type) ?? []) === "changed") {
        frames.push(ts.isInterfaceDeclaration(node) ? node.name.text : "(an object type)");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  const wrong: string[] = [];
  for (const [what, list] of Object.entries(EXPORTED)) if (!exportedSets.has(key(list))) wrong.push(`no exported union holds exactly the ${what} words`);
  for (const [what, list] of Object.entries(HELD)) if (!anywhere.has(key(list))) wrong.push(`no union holds exactly the ${what} words`);
  if (frames.length === 0) wrong.push("no feed frame type whose one key is type: 'changed'");
  for (const st of source.statements) {
    if ((ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      const spec = st.moduleSpecifier.text;
      if (/(^|\/)server(\/|$)/.test(spec)) wrong.push(`imports ${spec} from the server`);
    }
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`all ${Object.keys(EXPORTED).length} exported vocabularies, the ${Object.keys(HELD).length} held ones and the changed frame are there; nothing from server/`);
});
