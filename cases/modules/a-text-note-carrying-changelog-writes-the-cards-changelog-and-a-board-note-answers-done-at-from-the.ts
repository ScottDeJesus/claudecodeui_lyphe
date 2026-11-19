// THE NOTES: a dispatcher `text` note may carry `changelog` (the finished walk's one plain line), which the board's
// applier writes with `updateCard` — the card's `changelog` column. And the `board` note's answer (the board's roster,
// read by a walk's duplicate check) gives each Done card's `done_at` from the board's own stamp, the `done_at` column
// the move into Done writes, never the card's last edit.
//
// The dispatcher is the stand-in of lib/board_placing.mjs, holding the two notes; the board lives in a database this
// case makes.
//
// protects: server/modules/kanban-dispatch/kanban-dispatch.notes.ts, server/modules/kanban-dispatch/kanban-dispatch.apply.ts, server/modules/kanban-dispatch/kanban-dispatch.cards.ts, server/modules/kanban/kanban-cards.service.ts
// writes: none

import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { gitFolder, mountBoardDispatch, placingRig, quietJournal } from "../lib/board_placing.mjs";

const LINE = "A card dragged back into To Do is walked again.";

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const rig = await placingRig(t, "changelog-note", {});
  const R = await gitFolder(path.join(rig.folder, "repo"));
  quietJournal(t);
  const { kanban } = await rig.open();
  const { kanbanBoardsService: boards, kanbanCardsService: cards } = kanban as any;
  const board = boards.createBoard({ name: "Notes board", repos: [R] });
  const open = cards.createCard(board.id, { title: "the walked card", status: "active" });
  const finished = cards.createCard(board.id, { title: "a finished card", status: "todo" });
  cards.moveCard(finished.id, { status: "done" });
  const doneAt = cards.getCard(finished.id).doneAt;
  if (!doneAt) return cannotRun("a card moved into Done carries no doneAt: the board's stamp is not there to read");
  await new Promise((r) => setTimeout(r, 1500));
  cards.updateCard(finished.id, { title: "a finished card, retitled after it closed" });
  const after = cards.getCard(finished.id);
  if (after.updatedAt === doneAt) return cannotRun("the retitle left updatedAt equal to doneAt, so the two cannot be told apart");

  await rig.addNotes([
    { id: 1, board: board.id, card: open.id, title: "the walked card", kind: "text", payload: { changelog: LINE } },
    { id: 2, board: board.id, card: open.id, title: "the walked card", kind: "board", payload: { board: board.id } },
  ]);
  const mounted: any = await mountBoardDispatch(t);
  if (mounted.unmounted) return broken(mounted.unmounted);
  await rig.settle();

  const wrong: string[] = [];
  const s = await rig.state();
  const stampOf = (id: number) => {
    const raw = s.results[id];
    if (raw === undefined) return { applied: false, value: undefined };
    try {
      return { applied: true, value: raw === null ? null : JSON.parse(raw) };
    } catch {
      return { applied: true, value: raw };
    }
  };
  const text = stampOf(1);
  if (!text.applied) wrong.push("the changelog text note was never stamped applied (a note the board cannot read is skipped)");
  else if (text.value && typeof text.value === "object" && "refused" in text.value) wrong.push(`the changelog note was refused: ${text.value.refused}`);
  const card = cards.getCard(open.id);
  if (card.changelog !== LINE) wrong.push(`the walked card's changelog reads ${JSON.stringify(card.changelog)}, not the note's line`);

  const answer = stampOf(2);
  if (!answer.applied || !answer.value || typeof answer.value !== "object") wrong.push(`the board note was stamped ${JSON.stringify(answer.value)}, not the roster`);
  else {
    const entry = (answer.value.done ?? []).find((c: any) => c.id === finished.id);
    if (!entry) wrong.push(`the board note's done list does not hold the finished card: ${JSON.stringify(answer.value.done)}`);
    else if (entry.done_at !== doneAt) wrong.push(`the finished card's done_at reads ${entry.done_at}, not its doneAt stamp ${doneAt} (its last edit is ${after.updatedAt})`);
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`the changelog note wrote the card's line through updateCard; the board answer's done_at is the doneAt stamp ${doneAt}, not the later edit ${after.updatedAt}`);
});
