// The R&D picture's types (rnd-area phase 5: "the picture's types go in src/shared/rnd-types.ts from interface C"). The client
// reads what dispatcher rnd show --json prints, as GET /api/rnd and the rnd_state frame hand it on; a key the types leave out
// is a key the place cannot draw, and a word outside the dispatcher's closed lists is one it would never be sent.
//
// Read with the repo's TypeScript compiler; nothing is imported or run.
//
// protects: src/shared/rnd-types.ts
// writes: none

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FILE = path.join(REPO, "src/shared/rnd-types.ts");
const require = createRequire(path.join(REPO, "package.json"));

const KEYS = [
  ["", ["generated_at", "settings", "scout", "standing", "candidates"]],
  ["settings", ["web_search", "schedule", "sources"]],
  ["settings.sources", ["url", "label", "added_at"]],
  ["scout", ["out", "last"]],
  ["scout.out", ["id", "launch", "trigger", "started_at"]],
  ["scout.last", ["id", "launch", "trigger", "started_at", "ended_at", "outcome", "filed"]],
  ["candidates", ["name", "title", "what", "why", "question", "source_url", "source", "word", "filed_at", "filed_by", "scout", "spike", "verdict", "rejected", "adopted", "placing"]],
  ["candidates.spike", ["session", "started_at"]],
  ["candidates.verdict", ["word", "evidence", "dir", "at"]],
  ["candidates.rejected", ["why", "at", "by"]],
  ["candidates.adopted", ["plan", "epic", "at", "word", "why"]],
  ["candidates.placing", ["state", "at", "why"]],
];
const WORDS = [
  ["candidates.word", ["adopted", "proved", "rejected", "spiking", "waiting"]],
  ["candidates.verdict.word", ["no", "unsettled", "yes"]],
  ["scout.out.trigger", ["now", "weekly"]],
  ["scout.last.outcome", ["done", "failed", "lost"]],
];

runCase(async () => {
  const ts = require("typescript");
  let text;
  try {
    text = await readFile(FILE, "utf8");
  } catch {
    return broken("src/shared/rnd-types.ts is not on disk");
  }
  const sf = ts.createSourceFile(FILE, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const alias = new Map();
  for (const st of sf.statements) if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) alias.set(st.name.text, ts.isInterfaceDeclaration(st) ? st : st.type);
  const literals = (node, depth = 0) => {
    if (!node || depth > 10) return [];
    if (ts.isTypeLiteralNode(node) || ts.isInterfaceDeclaration(node)) return [node];
    if (ts.isParenthesizedTypeNode(node)) return literals(node.type, depth + 1);
    if (ts.isArrayTypeNode(node)) return literals(node.elementType, depth + 1);
    if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) return node.types.flatMap((t) => literals(t, depth + 1));
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText(sf);
      if ((name === "Array" || name === "ReadonlyArray") && node.typeArguments) return literals(node.typeArguments[0], depth + 1);
      if (alias.has(name)) return literals(alias.get(name), depth + 1);
    }
    return [];
  };
  const keysOf = (node) => new Set(literals(node).flatMap((l) => l.members.filter((m) => m.name).map((m) => m.name.getText(sf))));
  const typeAt = (node, key) => {
    for (const l of literals(node)) for (const m of l.members) if (m.name && m.name.getText(sf) === key) return m.type;
    return null;
  };
  const words = (node, depth = 0) => {
    if (!node || depth > 10) return [];
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) return [node.literal.text];
    if (ts.isLiteralTypeNode(node)) return [];
    if (ts.isUnionTypeNode(node)) return node.types.flatMap((t) => words(t, depth + 1));
    if (ts.isParenthesizedTypeNode(node)) return words(node.type, depth + 1);
    if (ts.isTypeReferenceNode(node) && alias.has(node.typeName.getText(sf))) return words(alias.get(node.typeName.getText(sf)), depth + 1);
    return [];
  };
  const root = alias.get("RndPicture");
  if (!root) return broken("rnd-types.ts names no RndPicture");
  const at = (where) => where.split(".").filter(Boolean).reduce((node, key) => (node ? typeAt(node, key) : null), root);
  const wrong = [];
  for (const [where, want] of KEYS) {
    const node = where === "" ? root : at(where);
    if (!node) { wrong.push((where || "RndPicture") + " is not typed"); continue; }
    const have = keysOf(node);
    const missing = want.filter((k) => !have.has(k));
    if (missing.length > 0) wrong.push((where || "RndPicture") + " lacks " + missing.join(", "));
  }
  for (const [where, want] of WORDS) {
    const got = [...new Set(words(at(where)))].sort().join(",");
    if (got !== want.join(",")) wrong.push(where + " is [" + got + "], not [" + want.join(",") + "]");
  }
  const standing = at("standing");
  let standingKeys = [];
  const recordWords = (node) => (node && ts.isTypeReferenceNode(node) && node.typeName.getText(sf) === "Record" && node.typeArguments ? words(node.typeArguments[0]) : null);
  if (standing) {
    const direct = recordWords(standing);
    const viaAlias = ts.isTypeReferenceNode(standing) && alias.has(standing.typeName.getText(sf)) ? recordWords(alias.get(standing.typeName.getText(sf))) : null;
    standingKeys = direct || viaAlias || [...keysOf(standing)];
  }
  if ([...new Set(standingKeys)].sort().join(",") !== "adopted,proved,rejected,spiking,waiting") wrong.push("standing is keyed by [" + standingKeys.join(",") + "]");
  if (wrong.length > 0) return broken(wrong.slice(0, 8).join("; "));
  return held("RndPicture carries every key of interface C, the standing is keyed by the five words, and the four closed word lists are exact");
});
