// The board's code needs none of what the board purge dropped. On a database made new, with the eight purged
// columns and kanban_session_usage removed wherever they are still there, every board verb that remains runs: a board
// is created, given a repository and turned self-running; a card is created, edited, tagged and untagged, asked and
// answered, checklisted, given a decision and tokens, moved through the five lanes, archived and restored; the lanes,
// roster, vitals, events and lessons are read. No verb throws (a SELECT naming a dropped column throws "no such
// column"), and no board, card, lane page or vitals object carries a field the purge removed.
//
// The scratch folder is also this process's HOME, so nothing the migrations copy can land beside the live database.
//
// protects: server/modules/kanban/, server/modules/database/repositories/, server/modules/database/kanban-schema.ts, server/shared/kanban-types.ts
// writes: none

import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";
import { PURGED_COLUMNS, PURGED_TABLE } from "../lib/old_board_shape.mjs";
import { scratchDir } from "../lib/scratch.mjs";

type Db = import("better-sqlite3").Database;

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const STATUSES = ["not_ready", "todo", "questions", "active", "done"] as const;
const PURGED_FIELDS = new Set([
  "deepseekFlash",
  "concurrency",
  "approved",
  "approvedAt",
  "awaitingApprove",
  "buildLeaseAt",
  "buildOwner",
  "planLeaseAt",
  "planOwner",
  "leaseState",
  "claimable",
  "claimableCount",
]);

/** Every key on the path of an object that names a purged field, as `where.key`. */
function purgedKeys(value: unknown, where: string, found: string[]): string[] {
  if (Array.isArray(value)) value.forEach((item, i) => purgedKeys(item, `${where}[${i}]`, found));
  else if (value !== null && typeof value === "object") {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (PURGED_FIELDS.has(key)) found.push(`${where}.${key}`);
      purgedKeys(inner, `${where}.${key}`, found);
    }
  }
  return found;
}

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const home: string = await scratchDir(t, "board-purge-verbs");
  // Set before the database module loads: it opens the file this names and no other.
  process.env.HOME = home;
  process.env.DATABASE_PATH = path.join(home, "auth.db");

  const database = await import("../../server/modules/database/index.ts");
  t.defer(() => database.closeConnection());
  await database.initializeDatabase();
  const db = database.getConnection() as Db;
  for (const [table, gone] of Object.entries(PURGED_COLUMNS)) {
    const names = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
    for (const column of gone.filter((c) => names.includes(c))) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
  db.exec(`DROP TABLE IF EXISTS ${PURGED_TABLE}`);

  const kanban = await import("../../server/modules/kanban/index.ts");
  const { vitalsCounts } = await import("../../server/modules/kanban/kanban-vitals.service.ts");
  const boards = kanban.kanbanBoardsService;
  const cards = kanban.kanbanCardsService;
  const questions = kanban.kanbanQuestionsService;
  const checklist = kanban.kanbanChecklistService;

  const seen: Record<string, unknown> = {};
  const failed: string[] = [];
  const step = async (name: string, act: () => unknown): Promise<unknown> => {
    try {
      const out = await act();
      seen[name] = out;
      return out;
    } catch (error) {
      failed.push(`${name}: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
      return undefined;
    }
  };

  const board = (await step("createBoard", () => boards.createBoard({ name: "purge case board" }))) as { id: string } | undefined;
  if (!board) return broken(`createBoard threw — ${failed.join("; ")}`.slice(0, 380));
  await step("updateBoard repos", () => boards.updateBoard(board.id, { repos: [REPO] }));
  await step("updateBoard autonomy", () => boards.updateBoard(board.id, { autonomy: true }));
  await step("updateBoard name", () => boards.updateBoard(board.id, { name: "purge case board, renamed" }));
  await step("listBoards", () => boards.listBoards({ includeArchived: true }));
  await step("getBoard", () => boards.getBoard(board.id));
  await step("laneCounts", () => boards.laneCounts(board.id));

  const card = (await step("createCard", () =>
    cards.createCard(board.id, { title: "purge case card", priority: "high", status: "not_ready", description: "d" })
  )) as { id: string } | undefined;
  if (card) {
    await step("updateCard", () => cards.updateCard(card.id, { title: "purge case card, edited", description: "d2", body: "b" }));
    await step("addTag", () => cards.addTag(card.id, "bug"));
    await step("removeTag", () => cards.removeTag(card.id, "bug"));
    await step("addQuestion", () => questions.addQuestion(card.id, { text: "Which?", options: ["A", "B"] }));
    const asked = (await step("getCard asked", () => cards.getCard(card.id))) as { questions?: Array<{ id: string }> } | undefined;
    const questionId = asked?.questions?.[0]?.id;
    if (questionId) await step("answerQuestion", () => questions.answerQuestion(questionId, { selected: ["A"] }));
    else failed.push("addQuestion left no question on the card");
    await step("noteDecision", () => questions.noteDecision(card.id, { question: "Newest first?", choice: "Yes" }));
    const item = (await step("addChecklistItem", () => checklist.addChecklistItem(card.id, { text: "Sort", note: "bug" }))) as { id: string } | undefined;
    if (item) await step("updateChecklistItem", () => checklist.updateChecklistItem(item.id, { state: "done" }));
    await step("addCardTokens", () => cards.addCardTokens(card.id, { tokensIn: 3, tokensOut: 2, cacheRead: 1, cacheCreate: 1 }));
    for (const status of STATUSES) await step(`moveCard ${status}`, () => cards.moveCard(card.id, { status }));
    await step("archiveCard", () => cards.archiveCard(card.id));
    await step("restoreCard", () => cards.restoreCard(card.id));
    await step("getCard", () => cards.getCard(card.id));
  }
  await step("listLaneCards", () => cards.listLaneCards(board.id, [...STATUSES], { limit: 50 }));
  await step("boardCards", () => kanban.kanbanRosterService.boardCards(board.id));
  await step("vitals", () => vitalsCounts(board.id, { memoryPending: 0 }));
  await step("listEvents", () => boards.listEvents({ boardId: board.id, limit: 100 }));
  await step("stageLesson", () =>
    kanban.kanbanLessonsService.stageLesson({ name: "n", summary: "s", trigger: "t", source: "learn", cardId: card?.id ?? null })
  );
  await step("listLessons", () => kanban.kanbanLessonsService.listLessons({}));

  const carried = purgedKeys(
    Object.fromEntries(Object.entries(seen).filter(([name]) => !["listEvents", "stageLesson", "listLessons"].includes(name))),
    "",
    []
  );
  const steps = Object.keys(seen).length + failed.length;
  if (failed.length > 0 || carried.length > 0) {
    return broken(
      [failed.length > 0 ? `${failed.length} of ${steps} verbs threw: ${failed.join("; ")}` : "", carried.length > 0 ? `purged fields still carried: ${[...new Set(carried.map((k) => k.split(".").pop()))].join(", ")} (first at ${carried[0]})` : ""]
        .filter(Boolean)
        .join(" — ")
        .slice(0, 380)
    );
  }
  return held(`${steps} board verbs ran on the purged tables and no board, card, lane page or vitals object carries a purged field`);
});
