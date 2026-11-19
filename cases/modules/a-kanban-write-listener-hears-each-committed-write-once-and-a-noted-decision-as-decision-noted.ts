// onKanbanWrite, from the kanban barrel, is told of every committed board write once, after its commit,
// with { kind, boardId, cardId, actor, payload, card }: a listener that throws changes no write and no
// other listener's hearing; a write that rolls back is heard by no one; an unsubscribed listener hears
// nothing more. kanbanQuestionsService.noteDecision is one of those writes: one kanban_decisions row on
// the card, heard as decision.noted with the card's summary and the caller's actor.
//
// Every write lands in a database this case creates in its own scratch folder.
//
// protects: server/modules/kanban/kanban-write.service.ts, server/modules/kanban/index.ts, server/modules/kanban/kanban-questions.service.ts, server/modules/database/repositories/kanban-questions.db.ts
// writes: none

import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

type Heard = { kind: string; boardId: string | null; cardId: string | null; actor: string; payload: unknown; card: any };

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder: string = await scratchDir(t, "write-listener");
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  process.env.KANBAN_ATTACHMENTS_ROOT = path.join(folder, "attachments");

  const { initializeDatabase, getConnection } = await import("../../server/modules/database/index.ts");
  await initializeDatabase();
  const kanban: any = await import("../../server/modules/kanban/index.ts");
  if (typeof kanban.onKanbanWrite !== "function") return broken("the kanban barrel exports no onKanbanWrite");

  const heard: Heard[] = [];
  const offThrower = kanban.onKanbanWrite(() => {
    throw new Error("a faulty listener");
  });
  t.defer(offThrower);
  const off = kanban.onKanbanWrite((event: Heard) => heard.push(event));
  if (typeof off !== "function") return broken("onKanbanWrite returned no unsubscribe function");
  t.defer(off);
  // A listener's throw is logged by the seam; that line is expected and is not the case's to show.
  const quiet = console.error;
  console.error = () => {};
  t.defer(() => {
    console.error = quiet;
  });

  const wrong: string[] = [];
  const board = kanban.kanbanBoardsService.createBoard({ name: "case board" });
  const card = kanban.kanbanCardsService.createCard(board.id, { title: "case card", status: "todo" });
  const decision = kanban.kanbanQuestionsService.noteDecision(
    card.id,
    { question: "How many decisions does the drawer show?", choice: "The newest five, with Show more" },
    { actor: "dispatcher" }
  );

  const kinds = heard.map((event) => event.kind);
  if (kinds.join(",") !== "board.created,card.created,decision.noted") {
    wrong.push(`three writes were heard as [${kinds.join(", ")}], not board.created, card.created, decision.noted`);
  }
  const [boardHeard, cardHeard, decisionHeard] = heard;
  if (boardHeard && (boardHeard.boardId !== board.id || boardHeard.cardId !== null || boardHeard.card !== null)) {
    wrong.push(`board.created was heard with boardId ${boardHeard.boardId}, cardId ${boardHeard.cardId}, card ${boardHeard.card === null ? "null" : "set"}`);
  }
  if (cardHeard && (cardHeard.cardId !== card.id || cardHeard.card?.id !== card.id || cardHeard.boardId !== board.id)) {
    wrong.push(`card.created was heard with cardId ${cardHeard.cardId} and card ${cardHeard.card?.id ?? "null"}`);
  }
  if (decisionHeard) {
    if (decisionHeard.actor !== "dispatcher") wrong.push(`decision.noted was heard with actor ${decisionHeard.actor}, not dispatcher`);
    if (decisionHeard.card?.id !== card.id || decisionHeard.boardId !== board.id) {
      wrong.push(`decision.noted was heard with card ${decisionHeard.card?.id ?? "null"} on board ${decisionHeard.boardId}`);
    }
    if (decisionHeard.payload === null || typeof decisionHeard.payload !== "object") wrong.push("decision.noted carried no payload object");
  }

  const rows = getConnection()
    .prepare("SELECT question, choice FROM kanban_decisions WHERE card_id = ?")
    .all(card.id) as Array<{ question: string; choice: string }>;
  if (rows.length !== 1 || !rows[0].question.includes("How many decisions") || !String(rows[0].choice).includes("newest five")) {
    wrong.push(`noteDecision left ${rows.length} kanban_decisions rows on the card: ${JSON.stringify(rows)}`);
  }
  if (typeof decision?.id !== "string") wrong.push("noteDecision returned no decision with an id");
  const events = getConnection()
    .prepare("SELECT COUNT(*) AS n FROM kanban_events WHERE card_id = ? AND kind = 'decision.noted'")
    .get(card.id) as { n: number };
  if (events.n !== 1) wrong.push(`noteDecision wrote ${events.n} decision.noted audit rows, not 1`);

  const before = heard.length;
  try {
    kanban.kanbanBoardsService.updateBoard("b-no-such-board", { name: "nothing" });
    wrong.push("an update of a board that is not there did not throw");
  } catch {
    // the 404 is the point: the write rolled back
  }
  if (heard.length !== before) wrong.push(`a write that rolled back was heard as ${heard.slice(before).map((e) => e.kind).join(", ")}`);

  off();
  kanban.kanbanCardsService.createCard(board.id, { title: "after unsubscribe" });
  if (heard.length !== before) wrong.push("a write after unsubscribe was still heard");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("board.created, card.created and decision.noted (actor dispatcher, its card, one kanban_decisions row) each heard once past a throwing listener; a rolled-back write and a write after unsubscribe heard by no one");
});
