// THE WAITING TICKET: the placing pass runs with `--unplaced` at server start and whenever the module's own
// `onKanbanWrite` listener sees `board.created`, or a `board.updated` whose fields hold `repos`, so a ticket no board
// could take is placed the moment a board names its folder — no store write, no timer. A board changed in any other
// way (a rename) runs no `--unplaced` pass.
//
// The dispatcher is the stand-in of lib/board_placing.mjs, holding two `unplaced` tickets that `bug pending` lists only
// under `--unplaced`; the boards live in a database this case makes. The case never pokes the store watch.
//
// protects: server/modules/kanban-dispatch/kanban-dispatch.module.ts, server/modules/kanban-dispatch/kanban-dispatch.tickets.ts, server/modules/kanban-dispatch/kanban-dispatch.apply.ts, server/modules/kanban/kanban-boards.service.ts, server/modules/kanban/kanban-write.service.ts
// writes: none

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { gitFolder, mountBoardDispatch, placingRig, quietJournal } from "../lib/board_placing.mjs";

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const rig = await placingRig(t, "waiting-ticket", {});
  const R = await gitFolder(path.join(rig.folder, "repo-r"));
  const S = await gitFolder(path.join(rig.folder, "repo-s"));
  const seeded = await rig.state();
  seeded.tickets = [
    { id: 7, source: "chat", path: R, title: "waiting on R", description: "words", priority: "medium", shots: [], tags: [], lane: "todo", state: "unplaced" },
    { id: 8, source: "soul", path: S, title: "waiting on S", description: "words", priority: "low", shots: [], tags: [], lane: "todo", state: "unplaced" },
  ];
  await writeFile(path.join(rig.folder, "state.json"), JSON.stringify(seeded));
  quietJournal(t);
  const { kanban } = await rig.open();
  const { kanbanBoardsService: boards, kanbanCardsService: cards } = kanban as any;

  const unplacedPasses = async () =>
    (await rig.calls()).filter((c: any) => c.argv[0] === "bug" && c.argv[1] === "pending" && c.argv.includes("--unplaced")).length;
  const ticket = async (id: number) => (await rig.state()).tickets.find((x: any) => x.id === id);

  const mounted: any = await mountBoardDispatch(t);
  if (mounted.unmounted) return broken(mounted.unmounted);
  await rig.settle();
  const wrong: string[] = [];
  const atStart = await unplacedPasses();
  if (atStart === 0) wrong.push("the server's start ran no `bug pending --unplaced` pass");

  const bare = boards.createBoard({ name: "Board with no folder yet" });
  if (!bare?.id) return cannotRun("the scratch board would not be made");
  await rig.settle();
  const afterBareCreate = await unplacedPasses();
  if (afterBareCreate === atStart) wrong.push("a board created ran no `--unplaced` pass");
  boards.updateBoard(bare.id, { name: "Board renamed" });
  await rig.settle();
  const afterRename = await unplacedPasses();
  if (afterRename !== afterBareCreate) wrong.push(`a rename ran ${afterRename - afterBareCreate} \`--unplaced\` pass(es): only a change of folders should`);
  if ((await ticket(7))?.state !== "unplaced" || (await ticket(8))?.state !== "unplaced") wrong.push("a ticket left unplaced before any board named its folder");

  const naming = boards.createBoard({ name: "Board naming R", repos: [R] });
  await rig.settle();
  const seven = await ticket(7);
  if (seven?.state !== "placed") wrong.push(`the ticket waiting on R is ${seven?.state} after a board naming R was created, not placed`);
  else if (seven.board?.id !== naming.id) wrong.push(`the ticket waiting on R was placed on ${seven.board?.name}, not the board naming R`);
  else {
    const card = cards.getCard(seven.card.id);
    if (card.boardId !== naming.id || card.title !== "waiting on R") wrong.push(`R's ticket's card is ${card.title} on ${card.boardId}`);
  }

  boards.updateBoard(bare.id, { repos: [S] });
  await rig.settle();
  const eight = await ticket(8);
  if (eight?.state !== "placed") wrong.push(`the ticket waiting on S is ${eight?.state} after a board's folders were changed to name S, not placed`);
  else if (eight.board?.id !== bare.id) wrong.push(`the ticket waiting on S was placed on ${eight.board?.name}, not the board whose folders now name S`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`--unplaced passes: ${atStart} at start, +${afterBareCreate - atStart} on a board created, +0 on a rename; R's ticket placed on the board created naming R and S's on the board changed to name S, with no store poke`);
});
