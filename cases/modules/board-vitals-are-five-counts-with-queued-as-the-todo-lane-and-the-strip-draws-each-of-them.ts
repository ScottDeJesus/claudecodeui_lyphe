// The board's counts are five: building, awaitingAnswer, queued (the board's live To Do cards),
// lessonsPendingEstate and memoryPendingEstate. vitalsCounts reads exactly those keys off a board this
// case fills, and the wire type on both sides (src/shared and server/shared kanban-types.ts) and the
// list of counts the board's Opening draws (BugBoardOpening.tsx's REGISTERS, since the board's redraw to
// the design system on 2026-11-20; the header's strip before it) name exactly those five, so the board
// draws a number for every count the server sends and asks for no key it does not.
//
// The counts are read off a database this case creates in its own scratch folder; the three source files
// are parsed with the TypeScript compiler, never run in a browser.
//
// protects: server/modules/kanban/kanban-vitals.service.ts, server/shared/kanban-types.ts, src/shared/kanban-types.ts, src/modules/kanban/BugBoardOpening.tsx
// writes: none

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const FIVE = ["building", "awaitingAnswer", "queued", "lessonsPendingEstate", "memoryPendingEstate"];

async function parse(relative: string): Promise<ts.SourceFile> {
  const file = path.join(REPO, relative);
  return ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** The member names of `type KanbanVitals = { ... }`, or null when the file declares no such type literal. */
function vitalsTypeKeys(source: ts.SourceFile): string[] | null {
  for (const statement of source.statements) {
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === "KanbanVitals" && ts.isTypeLiteralNode(statement.type)) {
      return statement.type.members.map((member) => (member.name && ts.isIdentifier(member.name) ? member.name.text : "?"));
    }
  }
  return null;
}

/** The `key` of every entry of `const REGISTERS = [ ... ]`, or null when there is no such array. */
function stripKeys(source: ts.SourceFile): string[] | null {
  let keys: string[] | null = null;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "REGISTERS" && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      keys = node.initializer.elements.map((element) => {
        if (!ts.isObjectLiteralExpression(element)) return "?";
        const key = element.properties.find((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "key");
        return key && ts.isPropertyAssignment(key) && ts.isStringLiteral(key.initializer) ? key.initializer.text : "?";
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return keys;
}

const same = (a: string[] | null): boolean => a !== null && a.length === FIVE.length && FIVE.every((key) => a.includes(key));

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder: string = await scratchDir(t, "board-vitals");
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  process.env.KANBAN_ATTACHMENTS_ROOT = path.join(folder, "attachments");

  const { initializeDatabase } = await import("../../server/modules/database/index.ts");
  await initializeDatabase();
  const kanban: any = await import("../../server/modules/kanban/index.ts");
  const { vitalsCounts } = await import("../../server/modules/kanban/kanban-vitals.service.ts");

  const board = kanban.kanbanBoardsService.createBoard({ name: "case board" });
  const make = (title: string, status: string) => kanban.kanbanCardsService.createCard(board.id, { title, status });
  make("queued one", "todo");
  make("queued two", "todo");
  make("being built", "active");
  make("not ready", "not_ready");
  const asking = make("asking", "questions");
  kanban.kanbanQuestionsService.addQuestion(asking.id, { text: "Which screen?" });
  const archived = make("archived todo", "todo");
  kanban.kanbanCardsService.archiveCard(archived.id);

  const wrong: string[] = [];
  const counts: Record<string, number> = vitalsCounts(board.id, { memoryPending: 3 }) as any;
  if (!same(Object.keys(counts))) wrong.push(`vitalsCounts read the keys [${Object.keys(counts).join(", ")}], not the five`);
  const expected: Record<string, number> = { queued: 2, building: 1, awaitingAnswer: 1, memoryPendingEstate: 3 };
  for (const [key, value] of Object.entries(expected)) {
    if (counts[key] !== value) wrong.push(`${key} read ${counts[key]}, not ${value}`);
  }

  const client = vitalsTypeKeys(await parse("src/shared/kanban-types.ts"));
  const server = vitalsTypeKeys(await parse("server/shared/kanban-types.ts"));
  const strip = stripKeys(await parse("src/modules/kanban/BugBoardOpening.tsx"));
  if (!same(client)) wrong.push(`src/shared KanbanVitals names [${(client ?? ["no type literal"]).join(", ")}]`);
  if (!same(server)) wrong.push(`server/shared KanbanVitals names [${(server ?? ["no type literal"]).join(", ")}]`);
  if (!same(strip)) wrong.push(`the strip's REGISTERS name [${(strip ?? ["no array"]).join(", ")}]`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("vitalsCounts reads the five keys (queued 2, building 1, awaitingAnswer 1 over an archived To Do card), and both KanbanVitals types and the strip's registers name the same five");
});
